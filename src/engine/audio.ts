import { DFContainerFile, readContainerFile } from "../df/container";
import { AudioBank, readAudioBank, decodeAudioContainer, DecodedAudio } from "../df/audio";

/**
 * Audio playback behind the script commands. Three channels, mirroring the
 * engine's command families:
 *   sound  — singlesound/multiplesound/haltsound/sounddone
 *   voice  — voicesound/haltvoice/voicedone
 *   theme  — playtheme/halttheme (looping music from a bank's loop chunks)
 */
export type AudioChannel = "sound" | "voice" | "theme";

export interface PlayOpts {
  loop?: boolean;
  overlap?: boolean;
  /** 0..1 (crickets attenuate with distance) */
  volume?: number;
  /** -1 (left) .. 1 (right) — positional ambient sounds */
  pan?: number;
}

/** a single playback — crickets hold onto it to avoid re-firing mid-sound */
export interface PlayHandle {
  readonly done: boolean;
  stop(): void;
}

export interface AudioSink {
  play(channel: AudioChannel, audio: DecodedAudio, opts?: PlayOpts): PlayHandle;
  halt(channel: AudioChannel): void;
  isDone(channel: AudioChannel): boolean;
  /**
   * Persistent per-channel master gain (0..1), multiplied on top of each play's
   * own gain (crickets' distance falloff, etc.). Backs the game's volume
   * settings: wavevolume() drives the sound+voice channels, themevol() the
   * theme channel. Survives across individual plays on the channel.
   */
  setChannelVolume(channel: AudioChannel, volume: number): void;
}

/** headless/no-op sink that still answers isDone(); records calls for tests */
export class NullAudioSink implements AudioSink {
  calls: { channel: AudioChannel; seconds: number; loop: boolean; volume: number; pan: number }[] =
    [];
  /** last master gain set per channel — tests assert the volume plumbing */
  channelVolume: Record<AudioChannel, number> = { sound: 1, voice: 1, theme: 0.6 };
  setChannelVolume(channel: AudioChannel, volume: number): void {
    this.channelVolume[channel] = Math.max(0, Math.min(1, volume));
  }
  play(channel: AudioChannel, audio: DecodedAudio, opts?: PlayOpts): PlayHandle {
    this.calls.push({
      channel,
      seconds: audio.samples.length / audio.sampleRate,
      loop: !!opts?.loop,
      volume: opts?.volume ?? 1,
      pan: opts?.pan ?? 0,
    });
    let stopped = false;
    return {
      get done() {
        return !opts?.loop || stopped;
      },
      stop: () => (stopped = true),
    };
  }
  halt(): void {}
  isDone(): boolean {
    return true;
  }
}

/** browser sink; construct after a user gesture (AudioContext autoplay policy) */
export class WebAudioSink implements AudioSink {
  private ctx: AudioContext;
  private gains: Record<AudioChannel, GainNode>;
  private playing: Partial<Record<AudioChannel, { src: AudioBufferSourceNode; done: boolean }>> = {};

  constructor(ctx?: AudioContext) {
    this.ctx = ctx ?? new AudioContext();
    this.gains = {
      sound: this.ctx.createGain(),
      voice: this.ctx.createGain(),
      theme: this.ctx.createGain(),
    };
    this.gains.theme.gain.value = 0.6;
    for (const g of Object.values(this.gains)) g.connect(this.ctx.destination);
  }

  setChannelVolume(channel: AudioChannel, volume: number): void {
    this.gains[channel].gain.value = Math.max(0, Math.min(1, volume));
  }

  play(channel: AudioChannel, audio: DecodedAudio, opts?: PlayOpts): PlayHandle {
    if (!opts?.overlap) this.halt(channel);
    const buffer = this.ctx.createBuffer(1, audio.samples.length, audio.sampleRate);
    buffer.copyToChannel(new Float32Array(audio.samples), 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = !!opts?.loop;
    let head: AudioNode = src;
    if (opts?.volume !== undefined && opts.volume < 1) {
      const g = this.ctx.createGain();
      g.gain.value = Math.max(0, Math.min(1, opts.volume));
      head.connect(g);
      head = g;
    }
    if (opts?.pan) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      head.connect(p);
      head = p;
    }
    head.connect(this.gains[channel]);
    const entry = { src, done: false };
    src.onended = () => (entry.done = true);
    src.start();
    if (!opts?.overlap) this.playing[channel] = entry;
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return {
      get done() {
        return entry.done;
      },
      stop: () => {
        if (!entry.done) {
          try {
            src.stop();
          } catch {
            /* already stopped */
          }
          entry.done = true;
        }
      },
    };
  }

  halt(channel: AudioChannel): void {
    const p = this.playing[channel];
    if (p && !p.done) {
      try {
        p.src.stop();
      } catch {
        /* already stopped */
      }
    }
    delete this.playing[channel];
  }

  isDone(channel: AudioChannel): boolean {
    const p = this.playing[channel];
    return !p || p.done;
  }
}

/** open audio banks + decoded-sound cache; resolves names across all banks */
export class AudioLibrary {
  private banks = new Map<string, { file: DFContainerFile; bank: AudioBank }>();
  private cache = new Map<string, DecodedAudio>();

  openBank(name: string, data: Uint8Array): boolean {
    const key = name.toLowerCase();
    if (this.banks.has(key)) return true;
    try {
      const file = readContainerFile(data);
      this.banks.set(key, { file, bank: readAudioBank(file) });
      return true;
    } catch {
      return false;
    }
  }

  closeBank(name: string): void {
    this.banks.delete(name.toLowerCase());
  }

  get bankNames(): string[] {
    return [...this.banks.keys()];
  }

  /** find a one-shot sound by identifier in any open bank */
  sound(identifier: string): DecodedAudio | null {
    const key = identifier.toLowerCase().replace(/\.wav$/, "");
    const hit = this.cache.get(key);
    if (hit) return hit;
    for (const { file, bank } of this.banks.values()) {
      const ref = bank.singles.get(key);
      if (!ref) continue;
      const audio = decodeAudioContainer(file.containers[ref.containerLoc]);
      this.cache.set(key, audio);
      return audio;
    }
    return null;
  }

  /** concatenated loop-chunk music of a bank (for playtheme) */
  theme(bankName?: string): DecodedAudio | null {
    const candidates = bankName
      ? [this.banks.get(bankName.toLowerCase())].filter((x) => !!x)
      : [...this.banks.values()];
    for (const b of candidates) {
      if (!b || !b.bank.loopChunks.length) continue;
      const cacheKey = `theme:${b.bank.trackName}`;
      const hit = this.cache.get(cacheKey);
      if (hit) return hit;
      const parts = b.bank.loopChunks.map((loc) => decodeAudioContainer(b.file.containers[loc]));
      const total = parts.reduce((a, p) => a + p.samples.length, 0);
      const samples = new Float32Array(total);
      let off = 0;
      for (const p of parts) {
        samples.set(p.samples, off);
        off += p.samples.length;
      }
      const audio = { sampleRate: Math.max(...parts.map((p) => p.sampleRate)), samples };
      this.cache.set(cacheKey, audio);
      return audio;
    }
    return null;
  }
}
