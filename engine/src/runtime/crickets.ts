import type { PlayHandle } from "./audio";
import { ScriptError, toNum, toStr, truthy, type Logic, type Value } from "./interp";
import { pauseDepth } from "./pause";
import { schedulerRules } from "./scheduler-rules";
import type { GameSession } from "./session";
import type { SoundChannels } from "./sound-channels";

/** TI.EXE's 16 cricket slots (0x48b830, 0x4a apart) */
const MAX_CRICKETS = 16;

/**
 * A positional ambient one-shot scheduler (makecricket), bound to the set
 * that created it. Fires its sound with distance volume + bearing pan when
 * the countdown ends AND the previous play finished; re-arms with
 * base + random(jitter), or disappears when jitter < 0.
 */
export interface Cricket {
  name: string;
  x: number;
  y: number;
  radius: number;
  base: number;
  jitter: number;
  count: number;
  paused: boolean;
  setName: string;
  handle: PlayHandle | null;
  /** how many `pausecricket`s hold it ({@link pauseDepth}) */
  pauseDepth?: number;
  /** which of the 16 slots (TI.EXE 0x48b830, 0x4a apart); unset in DreamFactory 5 */
  slot?: number;
  /**
   * In earshot since it last came into it (TI.EXE +0x22): the first pass in
   * range sets it and re-arms the count; leaving the radius clears it and
   * stops the sound.
   */
  armed?: boolean;
  /** a looping cricket's volume this pass, for the loudest-two choice (+0x24) */
  loudness?: number;
  /**
   * RedJack.exe keeps the camera point it last measured from (+0x1c, +0x20) and
   * the distance and bearing it measured (+0x24, +0x28), and measures again
   * only when the camera's point has moved (0x41d851..0x41d8d1) — a turn on the
   * spot changes the pan, which is worked from the heading every pass, and not
   * the distance.
   */
  measured?: { camX: number; camY: number; dist: number; bearing: number };
}

/**
 * Where a cricket pans, 0..255, from the camera's facing and the bearing to the
 * sound — TI.EXE 0x444790: the bearing turned so the camera faces 0x80, folded
 * front-to-back into 0x40..0xc0, and that quarter-to-quarter span stretched
 * linearly over 0..255 — 128 dead ahead or behind, 0 and 255 a quarter turn
 * either side. Linear in the ANGLE, not its sine.
 */
export function cricketPan(camDeg: number, bearing: number): number {
  let rel = (bearing - camDeg + 0x80) & 0xff;
  if (rel > 0xc0) rel = 0x180 - rel;
  if (rel < 0x40) rel = 0x80 - rel;
  return Math.max(0, Math.min(0xff, 2 * rel - 0x80));
}

/** a cricket slot as a save records it — what {@link Crickets.restore} puts back */
export interface CricketSlot {
  name: string;
  set: string;
  x: number;
  y: number;
  radius: number;
  base: number;
  jitter: number;
  next: number;
  /** its `pausecricket` count (+2), when the save says */
  pause?: number;
  /** in earshot when saved (+0x22) */
  armed?: boolean;
  /** DreamFactory 5: the measurement the record carries (+0x1c..+0x28, {@link Cricket.measured}) */
  measured?: NonNullable<Cricket["measured"]>;
}

/**
 * The six cricket opcodes as a script calls them (builtins/timing.ts). DF.EXE
 * gave the same ids to its bouncing balls — makeball, stopball, pauseball,
 * isball, countballs, indextoball — so a Dust session answers them from its
 * BallRuntime (CricketsV1.opcodes) and the others from their cricket table.
 */
export interface CricketOpcodes {
  makeCricket(name: string, args: readonly (Value | undefined)[]): void;
  stopCricket(name: string): void;
  /** the setter, or with no flag the getter: what it answers then, undefined for the setter */
  pauseCricket(name: Value | undefined, flag: Value | undefined): number | boolean | Logic | undefined;
  isCricket(name: string): boolean;
  countCrickets(): number;
  indexToCricket(n: number): string;
}

/**
 * The cricket table and the builtins over it — `makecricket`, `stopcricket`,
 * `pausecricket` and what a save puts back — and each pass's turn at it. What
 * TI.EXE (Titanic) and RedJack.exe do alike is here; how one cricket is
 * serviced in a pass is each engine's own (crickets-v4.ts, crickets-v5.ts), and
 * DF.EXE (Dust) runs its bouncing balls in that place (crickets-v1.ts).
 */
export abstract class Crickets implements CricketOpcodes {
  constructor(
    /** the 16 slots in slot order, the scheduler's, kept across a change of engine */
    readonly table: Cricket[],
    protected readonly session: GameSession,
    /** the sound effects as the session's engine plays them */
    private readonly soundsNow: () => SoundChannels,
    /** the scheduler's `random (n)`, seeded on the ambient stream */
    protected readonly rand: (n: number) => number,
  ) {}

  protected readonly needsSet: boolean = true;
  /** a position as a cricket record holds it */
  protected abstract word(v: number): number;
  /** one cricket slot, one pass; false when it stops the pass */
  protected abstract service(c: Cricket, loud: Cricket[]): boolean;
  /** what a cricket keeps of the camera when it is made or put back: nothing, before DreamFactory 5 */
  protected measure(_c: Cricket): void {
    // TI.EXE's crickets keep nothing: the distance is worked out again every pass
  }

  /** what answers the cricket opcodes: the table itself, but for DF.EXE's balls */
  get opcodes(): CricketOpcodes {
    return this;
  }

  // ---- the opcodes (CricketOpcodes) ----

  makeCricket(name: string, [x, y, radius, base, jitter]: readonly (Value | undefined)[]): void {
    this.make(name, toNum(x ?? 0), toNum(y ?? 0), toNum(radius ?? 1), toNum(base ?? 0), toNum(jitter ?? -1));
  }
  stopCricket(name: string): void {
    this.stop(name);
  }
  pauseCricket(name: Value | undefined, flag: Value | undefined): number | undefined {
    // one argument is the getter: the pause count (TI.EXE 0x444880). RedJack.exe
    // has none — its pausecricket (0x409210) reads a name and a number and nests
    // the count (pause)
    if (flag === undefined && name !== undefined && schedulerRules(this.session).pauseGetters) return this.depth(toStr(name));
    this.pause(toStr(name ?? "all"), truthy(flag ?? 1));
    return undefined;
  }
  isCricket(name: string): boolean {
    return this.has(name);
  }
  countCrickets(): number {
    return this.table.length;
  }
  indexToCricket(n: number): string {
    return this.table[n - 1]?.name ?? "";
  }

  protected get sounds(): SoundChannels {
    return this.soundsNow();
  }

  /**
   * The pass's turn: the crickets in slot order (TI.EXE 0x442599..0x4425ba;
   * RedJack.exe 0x41b72e..0x41b75a); the looping ones in earshot register, and
   * the two loudest of them play (0x4425c6). False when a cricket stops the pass.
   */
  pass(): boolean {
    this.silenceAbsent();
    const loud: Cricket[] = [];
    for (const c of this.table.slice()) {
      if (!this.table.includes(c)) continue;
      if (!this.service(c, loud)) return false;
    }
    if (loud.length) this.playLoudest(loud);
    return true;
  }

  /**
   * TI.EXE's `makecricket` (0x444130; tl.exe the same code): no set open is
   * error 0x28, a sound no open bank has 0xa (0x4441c0), and a radius under 1,
   * a base under 0 or a jitter under −1 are 0xe (0x44428c..0x4442bd). The count
   * is `base` for a one-shot (jitter < 0) and `base + random (jitter)` otherwise
   * (0x44431b) — a draw a repeating cricket throws away, since its first pass in
   * earshot draws again. A cricket of the same name is replaced (0x442770,
   * without stopping its sound) and the new one takes the first free of the 16
   * slots, or fails with 8 (0x44440b). RedJack.exe's is the same (0x41d530 —
   * the sound 0xa at 0x41d58e, the three 0xe at 0x41d66c..0x41d6a2, 8 at
   * 0x41d7d1), in its own units.
   */
  make(name: string, x: number, y: number, radius: number, base: number, jitter: number): void {
    // RedJack.exe's (0x41d530) has no set test: the cricket takes whatever set is open
    if (this.needsSet && !this.session.currentSetName) throw new ScriptError(0x28, `makecricket (${name}): no set open`);
    const key = name.toLowerCase();
    if (!this.session.audioLib.sound(key)) throw new ScriptError(0xa, `makecricket: no sound "${name}"`);
    if (radius < 1 || base < 0 || jitter < -1) {
      throw new ScriptError(0xe, `makecricket (${name}, radius ${radius}, base ${base}, jitter ${jitter})`);
    }
    const count = jitter < 0 ? base : base + this.rand(jitter);
    const old = this.table.findIndex((c) => c.name === key);
    if (old >= 0) this.table.splice(old, 1);
    const used = new Set(this.table.map((c) => c.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    if (slot >= MAX_CRICKETS) throw new ScriptError(8, `cricket table full (${MAX_CRICKETS}), ${name} not made`);
    const c: Cricket = {
      name: key, x: this.word(x), y: this.word(y), radius, base, jitter, count,
      paused: false, setName: this.session.currentSetName, handle: null, slot, armed: false,
    };
    // RedJack.exe measures the camera at once and keeps it (+0x1c..+0x28, 0x41d71b)
    this.measure(c);
    this.insert(c);
  }

  /** into the table in slot order, as a pass and `indextocricket` read it */
  private insert(c: Cricket): void {
    const at = this.table.findIndex((x) => (x.slot ?? 0) > (c.slot ?? 0));
    if (at < 0) this.table.push(c);
    else this.table.splice(at, 0, c);
  }

  /**
   * Put a cricket slot back exactly as a save recorded it: the saved set (a
   * cricket is per-room ambience and must NOT adopt the room the load happens
   * to be leaving), the saved countdown (no `rand(jitter)` re-roll — see
   * {@link restoreLoop} for why a restore must not draw), no sounding handle.
   */
  restore({ name, set, x, y, radius, base, jitter, next, pause, armed, measured }: CricketSlot): void {
    if (this.table.length >= MAX_CRICKETS) {
      this.session.onLog(`loadgame: cricket table full (${MAX_CRICKETS}), dropping ${name}`);
      return;
    }
    const c: Cricket = {
      name: name.toLowerCase(),
      x,
      y,
      radius,
      base,
      jitter,
      count: next,
      paused: (pause ?? 0) > 0,
      pauseDepth: pause,
      setName: set.toLowerCase(),
      handle: null,
      armed,
      measured,
    };
    if (!measured) this.measure(c);
    const used = new Set(this.table.map((x) => x.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    c.slot = slot;
    this.insert(c);
  }

  stop(name: string): void {
    const n = name.toLowerCase();
    for (let i = this.table.length - 1; i >= 0; i--) {
      const c = this.table[i];
      if (n === "all" || c.name === n) {
        c.handle?.stop();
        this.table.splice(i, 1);
      }
    }
  }

  /**
   * `pausecricket` NESTS, as a loop's and a walk's pause do: a count at +2, one
   * up per pause and one down per resume, never below 0 (TI.EXE 0x4448d0; de
   * 0x43d216; RedJack.exe 0x41dd10, "all" at 0x41dd5b, a name at 0x41ddce —
   * the first slot of that name, and `makecricket` keeps one a name, 0x41d7ba).
   */
  pause(name: string, paused: boolean): void {
    const n = name.toLowerCase();
    for (const c of this.table) {
      if (n !== "all" && c.name !== n) continue;
      pauseDepth(c, paused);
    }
  }

  /** `pausecricket (name)`, the getter: its pause count (TI.EXE 0x444880), 0 for none */
  depth(name: string): number {
    const c = this.table.find((x) => x.name === name.toLowerCase());
    if (!c) return 0;
    return c.pauseDepth ?? (c.paused ? 1 : 0);
  }

  has(name: string): boolean {
    const n = name.toLowerCase();
    return this.table.some((c) => c.name === n);
  }

  /** every cricket gone and its sound stopped — a saved game about to be put back */
  reset(): void {
    for (const c of this.table) c.handle?.stop();
    this.table.length = 0;
  }

  /** a cricket's shot: `multiplesound` on the sound record it has just placed */
  protected fire(c: Cricket): void {
    this.sounds.play(c.name, true, "multiple");
    // the channel it took, so a set left behind can silence it (silenceAbsent);
    // the play itself is published on that channel, which is how the bedsit
    // landlady's five crickets wait on one another (`currentsound`), and captioned (#50)
    c.handle = this.sounds.liveHandle(c.name);
  }

  /**
   * The looping crickets in earshot this pass (TI.EXE 0x4446d0): the loudest
   * (the first of equals, in slot order) and the next loudest get
   * `singlesound`'s play (0x425150 — a sound already sounding is not started
   * again), and with three or more every other one is stopped.
   */
  private playLoudest(loud: Cricket[]): void {
    const pick = (from: Cricket[]): Cricket | undefined =>
      from.reduce<Cricket | undefined>((m, c) => (!m || (c.loudness ?? -1) > (m.loudness ?? -1) ? c : m), undefined);
    const first = pick(loud)!;
    const rest = loud.filter((c) => c !== first);
    const second = rest.length ? pick(rest) : undefined;
    if (loud.length > 2) for (const c of rest) if (c !== second) this.sounds.stopRecord(c.name);
    for (const c of [first, second]) {
      if (!c) continue;
      this.sounds.play(c.name, false, "single");
      c.handle = this.sounds.liveHandle(c.name) ?? c.handle;
    }
  }

  /**
   * Silence any cricket whose set is not the one on screen.
   *
   * A `soundloop`-flagged cricket starts once and then loops in place forever
   * (see playLoudest) — that is how a set runs positional ambience, and nothing
   * in the TAOOT corpus ever stops one: `stopcricket("all")` appears exactly
   * once, in its BOOTFILE `initall`. So every path that leaves a set WITHOUT
   * initall would leave its ambience sounding, positioned in a world that is no
   * longer on screen.
   *
   * TAOOT's `advanceday` endgame arm is that path: it calls `closesetfile()` and
   * goes straight into the flats, so the boat deck's five `party` crowd loops
   * (EXTRA.CST `crowdcrickets`, one per lifeboat star) would talk through
   * leave.mov, debris.mov, the closing narration and prozac.mov. Measured in
   * taoot/tests/browser/endgame.ts without this: `crickets=[party1..party5]` on
   * every sample from the deck to the credits, with `cricket.sfx` already closed —
   * not re-firing, simply never stopped. The re-fire guard below skips them; this
   * stops their audio too.
   *
   * The handle is dropped as well as stopped, so coming back to the set starts
   * the ambience again rather than being blocked by a play that is still "not
   * done". Re-arming is unaffected: a cricket in another set never reaches the
   * loop body, and the loop ambients all have `jitter 0`, which draws no RNG.
   *
   * Called from the service pass AND from `session.currentSetName`'s setter — the
   * setter is what makes it immediate, which the endgame needs: it closes the set
   * and starts a movie in the same script, and game time stops for the movie.
   */
  silenceAbsent(): void {
    for (const c of this.table) {
      if (!c.handle || !c.setName || c.setName === this.session.currentSetName) continue;
      c.handle.stop();
      c.handle = null;
    }
  }
}
