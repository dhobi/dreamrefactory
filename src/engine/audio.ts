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

export interface AudioSink {
  play(channel: AudioChannel, audio: DecodedAudio, opts?: { loop?: boolean; overlap?: boolean }): void;
  halt(channel: AudioChannel): void;
  isDone(channel: AudioChannel): boolean;
}

/** headless/no-op sink that still answers isDone(); records calls for tests */
export class NullAudioSink implements AudioSink {
  calls: { channel: AudioChannel; seconds: number; loop: boolean }[] = [];
  play(channel: AudioChannel, audio: DecodedAudio, opts?: { loop?: boolean }): void {
    this.calls.push({
      channel,
      seconds: audio.samples.length / audio.sampleRate,
      loop: !!opts?.loop,
    });
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

  play(channel: AudioChannel, audio: DecodedAudio, opts?: { loop?: boolean; overlap?: boolean }): void {
    if (!opts?.overlap) this.halt(channel);
    const buffer = this.ctx.createBuffer(1, audio.samples.length, audio.sampleRate);
    buffer.copyToChannel(new Float32Array(audio.samples), 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = !!opts?.loop;
    src.connect(this.gains[channel]);
    const entry = { src, done: false };
    src.onended = () => (entry.done = true);
    src.start();
    if (!opts?.overlap) this.playing[channel] = entry;
    if (this.ctx.state === "suspended") void this.ctx.resume();
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
