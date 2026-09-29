/**
 * What every part of the game runs on: a clock of 1/60 s ticks, the files, the
 * input, the sound and the screen.
 *
 * ## Why generators
 *
 * LUNICUS.EXE is written the way a 1994 Macintosh program is: a film, a step
 * through the maze or a conversation is a loop that runs until it is over,
 * polling the clock and the event queue as it goes. Each such loop here is a
 * generator, and a `yield` is one tick passing — so the code keeps the EXE's
 * shape (a step calls the frame drawer seven times; a conversation calls a
 * line's player, which returns when the line is over), and whoever holds the
 * machine decides how fast ticks go: the page, sixty to the second; a machine
 * test, as fast as the CPU goes.
 */
import { decodeAudioV0 } from "@dreamfactory/engine/df/audio";
import { readBankV0 } from "@dreamfactory/engine/df/banks";
import { SCREEN_H, SCREEN_W } from "./data";
import type { BitmapFont } from "./font";
import { actionOf, defaultSco, type Sco } from "./sco";
import { Screen } from "./screen";

export type Co<T = void> = Generator<void, T, void>;

/**
 * The rip, as the game asks for it. `get` is synchronous — a page fetches in
 * the background after `want`, and the machine waits on {@link Machine.file}
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
  /** the ambience's channel (the EXE's channel 3): these samples round and round, or silence */
  loop?(samples: Float32Array | null, sampleRate: number): void;
  /** Sound ▸ Sound Off … Sound Level 7: the device's volume, 0 to 1 (0x4209a8 → waveOutSetVolume) */
  volume?(level: number): void;
}

export const SILENT: Speaker = { play: () => {}, stop: () => {} };

/**
 * The game's names → the rip's 8.3 names: `lowerbase` is `lowerbas.`,
 * `intro.move` is `intro.mov`, `heisenstein.1` is `heisenst.1`. The EXE asks
 * for a file in the day's folder first, then in `shared\` (0x40a63a).
 */
export function dosName(name: string): string {
  const dot = name.indexOf(".");
  const base = (dot < 0 ? name : name.slice(0, dot)).slice(0, 8);
  const ext = dot < 0 ? "" : name.slice(dot + 1).slice(0, 3);
  return `${base}.${ext}`.toLowerCase();
}

/** a small seeded generator, so a machine test replays the same crew placings */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

export class Machine {
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

  /** the EXE's `41d914(n)`: 1 to n */
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

  /**
   * A file of the rip by the game's name, looked for in the day's folder and
   * then `shared/`; waits while a page fetches it. Throws when the rip has it
   * nowhere — the EXE's "movie file not found".
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

  resolve(name: string, day: number): string | null {
    const file = dosName(name);
    for (const dir of [`day${day}/`, "shared/"]) if (this.files.has(dir + file)) return dir + file;
    return null;
  }

  /**
   * The tick the sounds playing now end on. The EXE asks its two sound
   * channels whether they are idle (0x420975; the ambience's is a third, and
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

  /** a sound is still playing on the two channels (0x420975 answering 0) */
  soundBusy(): boolean {
    return this.ticks < this.soundEnds;
  }

  /** every sound stopped, and nothing left to wait for */
  stopSound(): void {
    this.speaker.stop();
    this.soundEnds = this.ticks;
  }

  /**
   * The bank's ambience (0x419136): its first container counts N sounds, M
   * pieces and a sequence of up to 64 piece numbers; the pieces (containers
   * N + 1 … N + M) are strung in that order and the string played round and
   * round on a channel of its own (0x4195fe, 0x4206a9).
   */
  setAmbience(name: string, bank: Uint8Array[]): void {
    const { sounds: n, pieces, order } = readBankV0(bank[0]);
    if (!order.length) throw new Error(`${name}: no ambience`);
    const decoded = order.map((k) => decodeAudioV0(bank[n + k]));
    const samples = new Float32Array(decoded.reduce((a, d) => a + d.samples.length, 0));
    let at = 0;
    for (const d of decoded) samples.set(d.samples, at), (at += d.samples.length);
    this.ambience = { name, samples, rate: decoded[0].sampleRate };
    this.log(`ambience: ${name}, ${order.length} pieces of ${pieces} round and round`);
  }

  /** `[0x42c294]` the ambience strung, and whether it plays */
  ambience: { name: string; samples: Float32Array; rate: number } | null = null;
  ambiencePlaying = false;

  /** 0x4195fe: the ambience from its start — if Sound ▸ Theme is on */
  playAmbience(): void {
    if (!this.ambience) return;
    this.ambiencePlaying = true;
    if (this.theme) this.speaker.loop?.(this.ambience.samples, this.ambience.rate);
  }

  /* ---- the menu bar's settings (src/menu.ts) --------------------------- */

  /**
   * Sound ▸ Sound Off … Sound Level 7, `[0x42c160]`, 0 to 7: the DEVICE's
   * volume (0x4209a8 → waveOutSetVolume(n × 0xFFFF / 7)), not the samples'.
   * The EXE starts from the device's own (0x4209c3), 7 where it cannot read
   * one — which a page never can.
   */
  volume = 7;
  /** Sound ▸ Theme, `[0x42c164]`: whether the ambience plays at all */
  theme = true;
  /**
   * Settings ▸ Cache Mazes, `[0x42c16c]`: the EXE copied the mazes to the hard
   * disk (0x40a795). A page has nothing to copy them to; the mark is kept.
   */
  cacheMazes = true;
  /**
   * Menu commands for the level to take between one thing and the next, as the
   * EXE's queue holds event 7 for the state's handler (0x417412) — a film or
   * a conversation leaves them waiting.
   */
  commands: { menu: number; item: number }[] = [];
  /** File ▸ Exit in a game (0x41745e): the title again, and not for a death */
  quitAsked = false;
  /** LUNICUS.SCO's block (src/game/sco.ts): the key table and the high scores */
  sco: Sco = defaultSco();
  /**
   * Settings ▸ Keys (0x418b50), for a level to wait on between one thing and
   * the next; the game (game.ts) puts its dialog here
   */
  keysDialog: () => Co = function* () {};

  /** 0x4173ff: the action a key is in the key table — 0 none, 1–3 a step, 4–7 a mode */
  action(key: string): number {
    return actionOf(this.sco.keys, key);
  }

  setVolume(level: number): void {
    this.volume = level;
    this.speaker.volume?.(level / 7);
  }

  /** 0x4178e8: Theme toggled, and the ambience started or its channel silenced */
  setTheme(on: boolean): void {
    this.theme = on;
    if (!this.ambience || !this.ambiencePlaying) return;
    this.speaker.loop?.(on ? this.ambience.samples : null, this.ambience.rate);
  }

  /** 0x42104b with its second flag: the ambience's channel silenced */
  stopAmbience(): void {
    this.ambiencePlaying = false;
    this.speaker.loop?.(null, 0);
  }

  /** how long a v0 sound runs, in ticks — what the machine waits on instead of the device */
  soundTicks(data: Uint8Array): number {
    const blocks = data.length >= 2 ? data[0] | (data[1] << 8) : 0;
    return Math.ceil((blocks * 370 * 60) / 22050);
  }

  /** the next event, if one is queued */
  take(): InputEvent | undefined {
    return this.events.shift();
  }

  /** a mouse-up or a key waiting: what ends a held-button walk (0x414d99, mask 10) */
  releasedOrKey(): boolean {
    return this.events.some((e) => e.kind === "up" || e.kind === "key") || !this.mouseHeld;
  }

  /**
   * The palette fades the EXE runs around a conversation or a film (0x41ca8d
   * out, 0x41cae1 in, both over 10 steps): one step a tick.
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
   * 0x41cb30: the whole window painted black — what a fade out ends on, and
   * what the end's films are each followed by. Every palette in the rip has
   * black at 255, so whatever palette comes next, what a film leaves uncovered
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
