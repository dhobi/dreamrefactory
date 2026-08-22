import { DFContainerFile, readContainerFile } from "../df/container";
import { decodeAudioContainer, DecodedAudio, resampleTo } from "../df/audio";
import { AudioBank, readAudioBank, readBankTables } from "../df/banks";

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
  /**
   * Hold everything where it is, without ending it — the game paused, not the
   * sound stopped. TI.EXE gets this for free: its wave device is fed by its own
   * code (the `WOM_DONE` callback at `0x406e40` only retires finished headers,
   * it never queues the next one), so anything that stops the engine — a modal
   * file dialog owning the thread — drains the queue and goes quiet, and picks
   * up mid-phrase when the engine runs again. Nothing mutes it; it starves.
   */
  setSuspended(on: boolean): void;
}

/**
 * A sink that stands in until a real one can exist. In the browser an
 * AudioContext may only be built from a user gesture, so the session plays into
 * this until {@link attach} hands it the real sink.
 *
 * A dropped one-shot is a moment that has passed — it is simply lost. A LOOP is
 * different: it is *state*. The engine records the theme it started
 * (`currentThemeName`) and a sound loop as flagged on, so nothing would ever
 * restart them: the room stays silent until the next set change. Today the page
 * only opens a set from a click, which unlocks audio first — this is the
 * guarantee that keeps that from being load-bearing (and it holds for any
 * entry that isn't a real gesture: a programmatic start, a future autoplay
 * rule). Loops are held and started on attach, with the handle already handed
 * out forwarding to the real one, so a later haltsound/halttheme still reaches
 * the play it was meant for.
 */
export class DeferredAudioSink implements AudioSink {
  private real: AudioSink | null = null;
  private volumes = new Map<AudioChannel, number>();
  private held = new Map<
    AudioChannel,
    { audio: DecodedAudio; opts?: PlayOpts; real: PlayHandle | null; stopped: boolean }
  >();

  get attached(): boolean {
    return this.real !== null;
  }

  /** the real sink exists now: apply the volumes, start the held loops */
  attach(sink: AudioSink): void {
    this.real = sink;
    if (this.suspended) sink.setSuspended(true);
    for (const [c, v] of this.volumes) sink.setChannelVolume(c, v);
    this.volumes.clear();
    for (const [c, h] of this.held) {
      if (!h.stopped) h.real = sink.play(c, h.audio, h.opts);
    }
    this.held.clear();
  }

  play(channel: AudioChannel, audio: DecodedAudio, opts?: PlayOpts): PlayHandle {
    if (this.real) return this.real.play(channel, audio, opts);
    if (!opts?.loop) return { done: true, stop() {} };
    const h = { audio, opts, real: null as PlayHandle | null, stopped: false };
    this.held.set(channel, h);
    return {
      get done() {
        return h.stopped || (h.real ? h.real.done : false);
      },
      stop() {
        h.stopped = true;
        h.real?.stop();
      },
    };
  }

  halt(channel: AudioChannel): void {
    const h = this.held.get(channel);
    if (h) h.stopped = true;
    this.held.delete(channel);
    this.real?.halt(channel);
  }

  isDone(channel: AudioChannel): boolean {
    return this.real ? this.real.isDone(channel) : !this.held.has(channel);
  }

  setChannelVolume(channel: AudioChannel, volume: number): void {
    if (this.real) this.real.setChannelVolume(channel, volume);
    else this.volumes.set(channel, volume);
  }

  /** nothing is audible yet, so there is nothing to hold — but a real sink
   *  attached mid-suspension must arrive suspended, not blaring. */
  private suspended = false;
  setSuspended(on: boolean): void {
    this.suspended = on;
    this.real?.setSuspended(on);
  }
}

/** one recorded play; `cut` is the question a test usually means to ask */
interface RecordedPlay {
  channel: AudioChannel;
  seconds: number;
  loop: boolean;
  volume: number;
  pan: number;
  /** set when whoever started this play stopped it through its handle */
  stopped: boolean;
  /**
   * Set when the SINK ended it rather than its owner: a `halt`, or a later play
   * taking the channel over. This is the half a no-op sink used to be blind to —
   * see {@link NullAudioSink.play} — and it is how a spoken line gets cut by
   * whatever speaks next without anybody calling stop().
   *
   * It means "the channel was taken from it", NOT "it was audibly cut short":
   * this sink has no clock, so it cannot tell a line stopped mid-word from one
   * that had finished seconds earlier and was merely superseded. ocredits.mov's
   * five spoken lines are all `displaced` and none of them is cut. Answering the
   * audible question needs a real clock — stamp the play, compare the halt
   * against the duration — which is a browser measurement.
   */
  displaced: boolean;
}

/** headless/no-op sink that still answers isDone(); records calls for tests */
export class NullAudioSink implements AudioSink {
  calls: RecordedPlay[] = [];
  /** last master gain set per channel — tests assert the volume plumbing */
  channelVolume: Record<AudioChannel, number> = { sound: 1, voice: 1, theme: 0.6 };
  /** the call holding each channel: what a halt or the next play ends */
  private holding: Partial<Record<AudioChannel, RecordedPlay>> = {};

  setChannelVolume(channel: AudioChannel, volume: number): void {
    this.channelVolume[channel] = Math.max(0, Math.min(1, volume));
  }

  /**
   * A channel carries one sound at a time unless the caller asked to overlap —
   * {@link WebAudioSink.play} halts the channel before it starts, which cuts
   * whatever was there. This sink models that, because a test sink that doesn't
   * cannot see the whole class of bug where one sound ends another: a line cut by
   * the next line, a bed cut by an effect that happens to share its channel. It
   * recorded a tidy list of plays in which nothing ever ended, and every question
   * about being cut short came back "no".
   */
  play(channel: AudioChannel, audio: DecodedAudio, opts?: PlayOpts): PlayHandle {
    const call: RecordedPlay = {
      channel,
      seconds: audio.samples.length / audio.sampleRate,
      loop: !!opts?.loop,
      volume: opts?.volume ?? 1,
      pan: opts?.pan ?? 0,
      stopped: false,
      displaced: false,
    };
    if (!opts?.overlap) {
      this.endHolder(channel);
      this.holding[channel] = call;
    }
    this.calls.push(call);
    return {
      get done() {
        return !opts?.loop || call.stopped || call.displaced;
      },
      stop: () => (call.stopped = true),
    };
  }

  /** channels halted, in order — tests assert that a stop actually reached the
   *  sink (a looping play would otherwise outlive whatever started it) */
  halts: AudioChannel[] = [];
  halt(channel: AudioChannel): void {
    this.halts.push(channel);
    this.endHolder(channel);
  }

  /** the channel is being taken away from whoever holds it */
  private endHolder(channel: AudioChannel): void {
    const held = this.holding[channel];
    if (held && !held.stopped) held.displaced = true;
    delete this.holding[channel];
  }

  isDone(): boolean {
    return true;
  }

  /** whether the world is frozen — recorded, not acted on: this sink's plays
   *  are already instantaneous. */
  suspended = false;
  setSuspended(on: boolean): void {
    this.suspended = on;
  }
}

/** browser sink; construct after a user gesture (AudioContext autoplay policy) */
export class WebAudioSink implements AudioSink {
  private ctx: AudioContext;
  private gains: Record<AudioChannel, GainNode>;
  private playing: Partial<Record<AudioChannel, { src: AudioBufferSourceNode; done: boolean }>> = {};

  /** true while the page is hidden or frozen; see {@link followPageLifecycle} */
  private pageHidden = false;
  private stopFollowing: (() => void) | null = null;

  constructor(ctx?: AudioContext) {
    this.ctx = ctx ?? new AudioContext();
    this.gains = {
      sound: this.ctx.createGain(),
      voice: this.ctx.createGain(),
      theme: this.ctx.createGain(),
    };
    this.gains.theme.gain.value = 0.6;
    for (const g of Object.values(this.gains)) g.connect(this.ctx.destination);
    this.followPageLifecycle();
  }

  /**
   * Go quiet when the page does.
   *
   * An AudioContext is not tied to the page's animation clock: the frame loop
   * stops the moment a tab is backgrounded, but a looping theme keeps playing —
   * on a phone, the music followed you out of the browser and went on over
   * whatever you did next, because nothing here ever suspended the context. It
   * survives navigation too, since a page swiped away goes into the back/forward
   * cache alive rather than being torn down.
   *
   * Suspending is the right lever rather than halting the channels: it freezes
   * the context clock, so nothing "ends" while away and the theme picks up mid-bar
   * on return, which is what coming back to a game that was merely paused should
   * sound like. Both signals are needed — `pagehide` is what iOS delivers when the
   * page is frozen, and `visibilitychange` covers a tab switch that never hides
   * the page.
   */
  private followPageLifecycle(): void {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    const hide = (): void => {
      this.pageHidden = true;
      void this.ctx.suspend().catch(() => {});
    };
    const show = (): void => {
      this.pageHidden = false;
      // ...unless the game itself is frozen: coming back to a tab must not
      // start the music under a modal that is still up.
      if (!this.gameSuspended) void this.ctx.resume().catch(() => {});
    };
    const onVisibility = (): void => (document.hidden ? hide() : show());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    this.stopFollowing = () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
    };
  }

  /** drop the page listeners and the context (a sink being replaced) */
  async dispose(): Promise<void> {
    this.stopFollowing?.();
    this.stopFollowing = null;
    for (const channel of Object.keys(this.playing) as AudioChannel[]) this.halt(channel);
    await this.ctx.close().catch(() => {});
  }

  setChannelVolume(channel: AudioChannel, volume: number): void {
    this.gains[channel].gain.value = Math.max(0, Math.min(1, volume));
  }

  /**
   * The world is frozen (a host modal owns the screen). Suspending the context
   * is the same lever the page-hidden path takes, and for the same reason: it
   * stops the context clock, so nothing *ends* while the game is not running
   * and the theme picks up mid-bar. That is what the original does by accident
   * — see {@link AudioSink.setSuspended}.
   */
  private gameSuspended = false;
  setSuspended(on: boolean): void {
    this.gameSuspended = on;
    if (on) void this.ctx.suspend().catch(() => {});
    else if (!this.pageHidden) void this.ctx.resume().catch(() => {});
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
    // unblock a context the autoplay policy parked — but NOT one suspended
    // because the page is away or the world is frozen, or a sound started by
    // some timer that outlived the frame loop would wake the whole mix back up
    // in the background.
    if (!this.pageHidden && !this.gameSuspended && this.ctx.state === "suspended") void this.ctx.resume();
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

  /**
   * A bank is named by the FILE it was opened from *and* by the track name
   * inside it, and the scripts use both.
   *
   * Measured over TAOOT's shipped banks: 27 of 92 disagree. Every `.11k` low-memory
   * song calls itself the `.trk` it stands in for (`sink1.11k` → "sink1.trk"),
   * the radio's three stations are all "bedrad1.trk", the three gossip banks are
   * all "gossip", and — the one that broke the ending — `pnarend.trk` and
   * `bnarend.trk` are both "narend.trk". So NAREND.STG's
   * `opentrackfile("pnarend.trk"); playnewtheme("narend.trk")` names the file to
   * open and the TRACK to play, and a lookup by file name alone finds nothing:
   * the closing narration played in silence, under whatever the sinking had
   * left running. Same for `closetrackfile("gossip")` (GANG.CST) and
   * `opentrackfile("sink0.11k"); playnewtheme("sink0.trk")` (BOOTFILE).
   */
  private find(name: string): { key: string; entry: { file: DFContainerFile; bank: AudioBank } } | null {
    const want = name.toLowerCase();
    const direct = this.banks.get(want);
    if (direct) return { key: want, entry: direct };
    for (const [key, entry] of this.banks) {
      if (entry.bank.trackName.toLowerCase() === want) return { key, entry };
    }
    return null;
  }

  /** the track name a bank calls itself, whichever of its two names is asked */
  trackNameOf(name: string): string | null {
    return this.find(name)?.entry.bank.trackName.toLowerCase() ?? null;
  }

  /** close by file name or track name; the file names actually dropped */
  closeBank(name: string): string[] {
    const want = name.toLowerCase();
    const dropped: string[] = [];
    const entry = this.banks.get(want);
    if (entry) {
      this.banks.delete(want);
      dropped.push(want);
      this.forget(want, entry.bank.trackName);
    } else {
      for (const [key, e] of [...this.banks]) {
        if (e.bank.trackName.toLowerCase() !== want) continue;
        this.banks.delete(key);
        dropped.push(key);
        this.forget(key, e.bank.trackName);
      }
    }
    return dropped;
  }

  /** drop a closed bank's decodes — an unloaded bank must go quiet, see sound() */
  private forget(bankKey: string, trackName: string): void {
    for (const k of [...this.cache.keys()]) {
      if (k.startsWith(`${bankKey}|`)) this.cache.delete(k);
    }
    this.cache.delete(`theme:${trackName}`);
  }

  get bankNames(): string[] {
    return [...this.banks.keys()];
  }

  /** one-shot sound identifiers in a named bank (countsounds/indextosound) */
  soundNames(bankName: string): string[] {
    return [...(this.find(bankName)?.entry.bank.singles.keys() ?? [])];
  }

  /** open banks that carry looping music (counttracks/indextotrack) */
  trackNames(): string[] {
    return [...this.banks.entries()].filter(([, b]) => b.bank.loopChunks.length).map(([k]) => k);
  }

  /**
   * A bank's loop table for the save writer: the records in table order
   * (container location + identifier) and the 1-based play order over them.
   * The save's playing/looping lists must mirror these record for record —
   * TI.EXE's post-load resume walks the bank's tables, not the save's counts
   * (see SavePatch.theme in df/savegame.ts) — so the writer takes them from
   * the bank itself rather than inventing records.
   */
  loopTable(name: string): { chunks: { index: number; name: string }[]; order: number[] } | null {
    const found = this.find(name);
    if (!found) return null;
    const tables = readBankTables(found.entry.file);
    return {
      chunks: tables.loopRecords.map((r) => ({ index: r.containerLoc, name: r.identifier })),
      order: tables.loopOrder,
    };
  }

  /**
   * Find a one-shot sound by identifier in any OPEN bank.
   *
   * The cache is keyed by bank as well as by name, and that is the whole point:
   * keyed by name alone it answered for banks that had been closed, and a decode
   * is not a licence to keep playing something the game has unloaded. Measured
   * at TAOOT's ending — the boat deck's `party1`..`party5` crowd murmurs are
   * positional crickets (makecricket) that nothing stops, and DECKBD2's closeset
   * closes the bank they come from, so they SHOULD fall silent when the ship is
   * left. Instead they were still being decoded out of the cache and were still
   * talking over debris.mov and the closing narration.
   */
  sound(identifier: string): DecodedAudio | null {
    const key = identifier.toLowerCase().replace(/\.wav$/, "");
    for (const [bankKey, { file, bank }] of this.banks) {
      const ref = bank.singles.get(key);
      if (!ref) continue;
      const ck = `${bankKey}|${key}`;
      const hit = this.cache.get(ck);
      if (hit) return hit;
      const audio = decodeAudioContainer(file.containers[ref.containerLoc].data);
      this.cache.set(ck, audio);
      return audio;
    }
    return null;
  }

  /** concatenated loop-chunk music of a bank (for playtheme) */
  theme(bankName?: string): DecodedAudio | null {
    const candidates = bankName
      ? [this.find(bankName)?.entry].filter((x) => !!x)
      : [...this.banks.values()];
    for (const b of candidates) {
      if (!b || !b.bank.loopChunks.length) continue;
      const cacheKey = `theme:${b.bank.trackName}`;
      const hit = this.cache.get(cacheKey);
      if (hit) return hit;
      const parts = b.bank.loopChunks.map((loc) => decodeAudioContainer(b.file.containers[loc].data));
      // A bank's loop chunks are not all at one rate, and the concatenation can
      // only be played at one — so bring them all UP to the highest rather than
      // labelling the join with it and leaving the slower chunks to play at
      // double speed. TAOOT's bedrad1.trk, the bedsit radio, is the loud case: two of
      // its fifteen chunks are 11025 in English and NINE are in German, which
      // is why the German announcer was the one who sounded like a chipmunk.
      const rate = Math.max(...parts.map((p) => p.sampleRate));
      const resampled = parts.map((p) => resampleTo(p.samples, p.sampleRate, rate));
      const total = resampled.reduce((a, s) => a + s.length, 0);
      const samples = new Float32Array(total);
      let off = 0;
      for (const s of resampled) {
        samples.set(s, off);
        off += s.length;
      }
      const audio = { sampleRate: rate, samples };
      this.cache.set(cacheKey, audio);
      return audio;
    }
    return null;
  }
}
