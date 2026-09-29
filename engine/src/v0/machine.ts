/**
 * What every part of a DreamFactory 0 game runs on: a clock of 1/60 s ticks, the
 * files, the input, the sound and the screen. *Lunicus* and *Jump Raven* each
 * extend it with what is theirs (lunicus/src/game/machine.ts,
 * jumpraven/src/game/machine.ts).
 *
 * ## Why generators
 *
 * LUNICUS.EXE and RAVEN.EXE are written the way a 1994 Macintosh program is: a
 * film, a step through the maze or a conversation is a loop that runs until it
 * is over, polling the clock and the event queue as it goes. Each such loop here
 * is a generator, and a `yield` is one tick passing — so the code keeps the
 * EXE's shape (a step calls the frame drawer seven times; a conversation calls a
 * line's player, which returns when the line is over), and whoever holds the
 * machine decides how fast ticks go: the page, sixty to the second; a machine
 * test, as fast as the CPU goes.
 */
import { V0_BLOCK_SAMPLES, V0_SAMPLE_RATE, blocksV0, decodeAudioV0 } from "../df/audio";
import type { BitmapFont } from "./font";
import { SCREEN_H, SCREEN_W, Screen } from "./screen";

export type Co<T = void> = Generator<void, T, void>;

/**
 * The rip, as the game asks for it. `get` is synchronous — a page fetches in
 * the background after `want`, and the machine waits on {@link MachineV0.file}
 * until the bytes are there; a test reads the disk and never waits.
 */
export interface GameFiles {
  /** is this file in the rip at all */
  has(path: string): boolean;
  /** its bytes, if they are here yet */
  get(path: string): Uint8Array | null;
  /** start fetching it */
  want(path: string): void;
}

export type InputEvent =
  | { kind: "down"; x: number; y: number }
  | { kind: "up"; x: number; y: number }
  | { kind: "key"; key: string };

/** where a sound goes; a test hands in one that only counts */
export interface Speaker {
  play(samples: Float32Array, sampleRate: number): void;
  stop(): void;
  /** the ambience's channel (Lunicus's channel 3): these samples round and round, or silence */
  loop?(samples: Float32Array | null, sampleRate: number): void;
  /** Sound ▸ Sound Off … Sound Level 7: the device's volume, 0 to 1 (LUNICUS.EXE 0x4209a8 → waveOutSetVolume) */
  volume?(level: number): void;
}

export const SILENT: Speaker = { play: () => {}, stop: () => {} };

/** a small seeded generator, so a machine test replays the same run */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

export abstract class MachineV0 {
  readonly screen = new Screen();
  /** ticks since the machine started */
  ticks = 0;
  readonly events: InputEvent[] = [];
  mouseHeld = false;
  /** where the pointer is, in the screen's pixels — what a held fire button aims at */
  pointer = { x: 0, y: 0 };
  readonly keysHeld = new Set<string>();
  /** what the machine is doing, for a page's status line and a test's failure */
  where = "";
  /** a film is up that waits for a click to go on */
  filmWaiting = false;
  /** the waiting frame's hotspots, in the film's own coordinates (its rect's top-left is 0,0 for all of them) */
  filmHotspots: { type: number; top: number; left: number; bottom: number; right: number; target: number }[] = [];
  /** the film on screen, if one is */
  film: string | null = null;
  font: BitmapFont | null = null;
  private readonly random: () => number;

  constructor(
    readonly files: GameFiles,
    readonly speaker: Speaker = SILENT,
    /** the roll's seed: a run with the same seed and the same gestures is the same run */
    readonly seed = 1994,
    /** false skips decoding pictures: a test that does not look at the screen runs faster */
    readonly draws = true,
    readonly log: (line: string) => void = () => {},
  ) {
    this.random = rng(seed);
  }

  /** the EXEs' `roll(n)` (LUNICUS.EXE 0x41d914): 1 to n */
  roll(n: number): number {
    return 1 + Math.floor(this.random() * n);
  }

  /** one tick */
  *tick(): Co {
    yield;
  }

  *wait(n: number): Co {
    for (let i = 0; i < n; i++) yield;
  }

  /** where the rip keeps a file the game names, looking in the day's folder first; null if nowhere */
  abstract resolve(name: string, day: number): string | null;

  /**
   * A file of the rip by the game's name ({@link resolve}); waits while a page
   * fetches it. Throws when the rip has it nowhere — the EXE's "movie file not
   * found".
   */
  *file(name: string, day: number): Co<{ path: string; data: Uint8Array }> {
    const path = this.resolve(name, day);
    if (!path) throw new Error(`${name} is not in the rip (day ${day} or shared)`);
    for (;;) {
      const data = this.files.get(path);
      if (data) return { path, data };
      this.files.want(path);
      yield;
    }
  }

  /**
   * The tick the sounds playing now end on. The EXE asks its two sound
   * channels whether they are idle (LUNICUS.EXE 0x420975; the ambience's is a third, and
   * not asked); the machine keeps the answer as a tick, from each sound's
   * length, so a run waits on it the same way whatever the page's audio does.
   */
  private soundEnds = 0;

  /** a v0 sound container, played */
  sound(data: Uint8Array): void {
    const { sampleRate, samples } = decodeAudioV0(data);
    if (samples.length) this.speaker.play(samples, sampleRate);
    this.soundEnds = Math.max(this.soundEnds, this.ticks + this.soundTicks(data));
  }

  /** a sound is still playing on the two channels (LUNICUS.EXE 0x420975 answering 0) */
  soundBusy(): boolean {
    return this.ticks < this.soundEnds;
  }

  /** every sound stopped, and nothing left to wait for */
  stopSound(): void {
    this.speaker.stop();
    this.soundEnds = this.ticks;
  }

  /** how long a v0 sound runs, in ticks — what the machine waits on instead of the device */
  soundTicks(data: Uint8Array): number {
    const blocks = data.length >= 2 ? blocksV0(data) : 0;
    return Math.ceil((blocks * V0_BLOCK_SAMPLES * 60) / V0_SAMPLE_RATE);
  }

  /** the next event, if one is queued */
  take(): InputEvent | undefined {
    return this.events.shift();
  }

  /** a mouse-up or a key waiting: what ends a held-button walk (LUNICUS.EXE 0x414d99, mask 10) */
  releasedOrKey(): boolean {
    return this.events.some((e) => e.kind === "up" || e.kind === "key") || !this.mouseHeld;
  }

  /**
   * The palette fades the EXE runs around a conversation or a film (LUNICUS.EXE
   * 0x41ca8d out, 0x41cae1 in, both over 10 steps; RAVEN.EXE 0x426d5e and
   * 0x426dad): one step a tick.
   */
  *fadeOut(steps = 10): Co {
    const from = this.screen.palette.slice();
    for (let s = 1; s <= steps; s++) {
      const p = from.slice();
      for (let i = 0; i < 1024; i++) if ((i & 3) !== 3) p[i] = (from[i] * (steps - s)) / steps;
      this.screen.setPalette(p);
      yield;
    }
    this.clear();
  }

  /**
   * LUNICUS.EXE 0x41cb30, RAVEN.EXE 0x426dfc: the whole window painted black — what a fade out ends on, and
   * what the end's films are each followed by. Every palette in the rip has
   * black at 255 (Lunicus's; Jump Raven's, the same), so whatever palette comes next, what a film leaves uncovered
   * stays black.
   */
  clear(): void {
    this.screen.fill([0, 0, SCREEN_H, SCREEN_W], 0xff);
  }

  *fadeIn(to: Uint8ClampedArray, steps = 10): Co {
    for (let s = 1; s <= steps; s++) {
      const p = to.slice();
      for (let i = 0; i < 1024; i++) if ((i & 3) !== 3) p[i] = (to[i] * s) / steps;
      this.screen.setPalette(p);
      yield;
    }
  }

  get width(): number {
    return SCREEN_W;
  }
  get height(): number {
    return SCREEN_H;
  }
}
