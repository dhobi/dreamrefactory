import { ENGINE_STEP_MS, ticksAt } from "./clock";
import { engineBearing } from "./geometry";
import { schedulerRules, type SchedulerRules } from "./scheduler-rules";
import { SoundBoard, type SoundChannels } from "./sound-channels";
import type { Cricket, Crickets } from "./crickets";
import { CricketsV1 } from "./crickets-v1";
import { CricketsV4 } from "./crickets-v4";
import { CricketsV5 } from "./crickets-v5";
import { pauseDepth } from "./pause";
import { SoundChannelsV1 } from "./sound-channels-v1";
import { SoundChannelsV4 } from "./sound-channels-v4";
import { SoundChannelsV5 } from "./sound-channels-v5";
import type { GameSession } from "./session";
import { ScriptError, type ScriptInstance } from "./interp";

/** TI.EXE's fixed table size for walks (the loops' are a {@link SchedulerRules}, the crickets' crickets.ts's) */
const MAX_WALKS = 16;


/**
 * One walk record (TI.EXE's 0x6e-byte slot at 0x48b150, DF.EXE's 0x52 at
 * 0x45f170): see {@link Scheduler.walks}.
 */
export interface WalkRecord {
  /** which of the 16 slots it sits in (unset in DreamFactory 5) */
  slot?: number;
  /** the record's own facing (TI.EXE +0x0a), which the turn steps and the mover puts back */
  deg?: number;
  sx: number; sy: number; sz: number;
  dx: number; dy: number; dz: number;
  dist: number; progress: number; paused: boolean; pauseDepth?: number; arriveStar?: string;
  /** the facing to reach before moving; undefined once the turn is done */
  turnTo?: number;
  /**
   * An authored route instead of a straight line (`walkonpath`): the
   * polyline's points with the cumulative distance to each. `dist` is the
   * whole route's length.
   */
  path?: { x: number; y: number; z: number; cum: number }[];
  /**
   * A `turntodeg` record (mode 0, TI.EXE +4): a facing target and NO mover. It
   * ends when the facing lands, with `endturn` (0x443d47 -> 0x443da4).
   */
  turnOnly?: boolean;
  /**
   * DreamFactory 1's WAITING walk (record +44 = 0): its walker is not in the
   * open set, so nothing moves. DF.EXE's walk service (0x4396f5) leaves it
   * be until the walker's set (actor +0x64) is the open one (0x43970d,
   * against 0x460bc2) and its star is one of that set's (0x410ce0); then it
   * puts the actor on the star and the walk ends with `endwalk`. A star the
   * open set lacks keeps it waiting (0x43974e). Only a load makes one here.
   */
  waiting?: boolean;
  /** a DreamFactory 4 walk made outside its actor's set: {@link Scheduler.deferWalk} */
  deferred?: () => void;
  /**
   * ...and what its record holds to be built from (TI.EXE 0x443ac0): the
   * mover's mode at +4 (1 `walktostar`, 3 `walkonpath`) and the route's start
   * at +0x5e — the destination is {@link arriveStar}, at +0x4e. A save writes
   * them, and a load builds the walk again from them.
   */
  deferredMode?: number;
  deferredFrom?: string;
  /**
   * A route made from a camera road rather than authored: `walkonroad` (mode 4)
   * walks it with the route mover, `walkonframes` (mode 5) one road frame a
   * pass (TI.EXE 0x443f40 -> 0x444f30). See {@link Scheduler.startWalkRoad}.
   */
  roadMode?: 4 | 5;
}

/**
 * One scheduled callback (makeloop). TI.EXE semantics: the countdown
 * decrements once per service PASS (0x442ae0, every slot, whatever its period);
 * at zero the slot REMOVES ITSELF and fires sendto<kind>(name, handler()) once
 * — persistent loops re-arm inside their own handler. Identity is (kind, name):
 * re-making replaces.
 */
export interface GameLoop {
  kind: string;
  name: string;
  handler: string;
  count: number;
  /** the count it was armed with, in passes — nothing special about 1 (0x442950) */
  period: number;
  /**
   * Which of the 32 slots of the table (TI.EXE 0x48bcd0, 0x2a apart) it sits
   * in: a new loop takes the FIRST FREE one (0x442a80), and a pass services
   * them in slot order. Unset in DreamFactory 5, whose table is not read.
   */
  slot?: number;
  paused: boolean;
  /** how many `pauseloop`s hold it ({@link pauseDepth}); absent = `paused ? 1 : 0` */
  pauseDepth?: number;
  /**
   * RedJack.exe's clock loop: a NEGATIVE period is a time, not a count —
   * `makeloop` (0x41bf05) stores the tick it falls due on (now − period, the
   * clock of 0x469f80 in sixtieths) at +6, and the pass fires it on the first
   * pass at or after that tick, without counting (0x41c001..0x41c010). Here it
   * is the game clock's tick, so it is the same on every host.
   */
  deadline?: number;
}

/**
 * The TI.EXE timing runtime: delay-driven loops (makeloop), positional
 * ambient one-shots (makecricket), sound-loop flags, and straight-line actor
 * walks — serviced in the pass a script runs ({@link Scheduler.pass}; the
 * BOOTFILE's idle is the heartbeat), in every engine. Extracted from GameSession, which delegates to it;
 * cross-cutting session state (clock, audio, actors, dispatch) is reached back
 * through the session reference.
 */
/**
 * How a pass's throttle waits out its ticks: on the clock the host moves
 * (`clock` — the BOOTFILE's idle, which the host itself started), asking the
 * host for frames until it has moved far enough (`frames` — a script's
 * `forceupdate` on a host that draws), or by moving the clock itself (`jump` —
 * a headless `forceupdate`, where nothing else moves it while a script runs).
 */
export type PassWait = "clock" | "frames" | "jump";

export class Scheduler {
  constructor(private readonly session: GameSession) {
    this.soundsByEngine = {
      1: new SoundChannelsV1(this.soundBoard, session),
      4: new SoundChannelsV4(this.soundBoard, session),
      5: new SoundChannelsV5(this.soundBoard, session),
    };
    const sounds = (): SoundChannels => this.sounds;
    const rand = (n: number): number => this.rand(n);
    this.cricketsByEngine = {
      1: new CricketsV1(this.cricketTable, session, sounds, rand),
      4: new CricketsV4(this.cricketTable, session, sounds, rand),
      5: new CricketsV5(this.cricketTable, session, sounds, rand),
    };
  }

  readonly loops: GameLoop[] = [];
  /** the 16 cricket slots, kept across a change of engine */
  private readonly cricketTable: Cricket[] = [];
  private readonly cricketsByEngine: Record<1 | 4 | 5, Crickets>;
  /** the cricket table and its builtins, as this session's engine runs them (crickets.ts) */
  get crickets(): Crickets {
    return this.cricketsByEngine[this.rules.engine];
  }

  /** the sound effects' channels, loop flags, volumes and pans, kept across a change of engine */
  private readonly soundBoard = new SoundBoard();
  private readonly soundsByEngine: Record<1 | 4 | 5, SoundChannels>;
  /** the sound effect builtins, as this session's engine plays them (sound-channels.ts) */
  get sounds(): SoundChannels {
    return this.soundsByEngine[this.rules.engine];
  }

  /**
   * DreamFactory random(n) = 1..n (0 for n <= 0).
   *
   * Draws from `session.ambientRng` — SEEDED, so a re-arm is reproducible, but not
   * the stream scripts draw from. It has to be seeded because a cricket records
   * its name on sound channel 2 when it fires, `currentsound(2)` is script-readable,
   * and that is precisely how TAOOT's bedsit landlady sequences her five lines. It
   * has to be SEPARATE because these draws happen on the clock: `steam1`/`steam2`
   * (TAOOT BOOTFILE container 2) are that corpus's only jittered crickets, they
   * re-arm 4 times over the first five segments, and while they shared the script
   * stream those 4 draws re-valued all 834 of it whenever anything changed how
   * long the engine dwelt. See GameSession.ambientRng for the measurement.
   */
  private rand(n: number): number {
    return n > 0 ? Math.floor(this.session.ambientRng() * n) + 1 : 0;
  }

  /**
   * The handler a loop names, as a NAME.
   *
   * The corpus writes it both ways. Most of it is a bare name —
   * `makeloop("prop", me, "invdockloop", 2)` — but Timelapse writes 21 of its 53
   * as a CALL: `makeloop("flat", baseflat, flatcallback, 0)` where `flatcallback`
   * is the string `"FlatAnimDone()"`, and `"Ambient()"`, `"DoBa()"`,
   * `"DoSwayLantern()"` beside it. The original engine plainly took either, and
   * this port took only the first, so those 21 resolved nothing.
   *
   * It is the tail of the stage animations that shows it: `flattick` walks the
   * cels and then schedules the CALLBACK to put the base flat back. Without this
   * the callback never ran, so the game sat on the last cel of the run — the
   * screen the birds had just left — instead of returning to the picture.
   *
   * Arguments are not accepted, only the empty call: nothing in any of the three
   * corpora writes one, a loop handler is invoked with no arguments anyway, and
   * silently dropping arguments somebody meant would be worse than not resolving.
   */
  private static loopHandlerName(handler: string): string {
    const trimmed = handler.trim();
    const call = /\(\s*\)$/.exec(trimmed);
    if (!call) return handler;
    const name = trimmed.slice(0, call.index).trimEnd();
    return /[\n\r\u2028\u2029]/.test(name) ? handler : name;
  }

  /** makeloop: (kind, name) identity — replaces an existing loop */
  makeLoop(kind: string, name: string, handler: string, period: number): void {
    this.stopLoop(kind, name);
    if (this.loops.length >= this.loopSlots) {
      // RedJack.exe's is error 0x23 (0x41bfa1); TI.EXE's table full is not read
      if (this.rules.loopTableFullThrows) throw new ScriptError(0x23, `loop table full (${this.loopSlots}), ${kind}/${name} not made`);
      this.session.onLog(`makeloop: table full (${this.loopSlots}), dropping ${kind}/${name}`);
      return;
    }
    // RedJack.exe: a negative period is a tick to fall due on (0x41bf05)
    const deadline = this.rules.negativePeriodIsDeadline && period < 0 ? ticksAt(this.session.clock.now) - period : undefined;
    this.insertLoop({
      kind: kind.toLowerCase(),
      name: name.toLowerCase(),
      /**
       * The handler keeps its CASE, and the other two do not, because they are
       * different kinds of name.
       *
       * `kind` and `name` are matched — `stopLoop`, `isLoop` and `makeLoop`'s own
       * replacement all compare them, and the corpus spells them freely
       * (`makeloop("SCENE", …)` in Dust against `makeloop("scene", …)`
       * everywhere else). A handler is not matched, it is CALLED: it ends up at
       * `Script.codes.get(handler)`, and those keys are stored exactly as the
       * 1996 compiler wrote them.
       *
       * So lowercasing it silently lost every loop whose callback has a capital
       * letter. Titanic hid this completely — all 67 of its loop callbacks are
       * lowercase, so the fold was the identity — and the other two discs are
       * where it shows: Timelapse names 9 of its 34 in CamelCase, and Dust one,
       * `SOUNDFXS`, which is CHIN.SET's ambient sound loop re-arming itself.
       *
       * What it looked like on Timelapse is that the stages did not move. Its
       * opening shot arms `makeloop("flat", baseflat, "DelayBirds", 15)` from
       * `enterframe`; the loop came due, fired `sendtoflat(i0001.100,
       * delaybirds)`, resolved nothing and removed itself — and the birds never
       * left the shot. 433 `flatstartanim` calls on those discs are reached
       * through callbacks like that one.
       */
      handler: Scheduler.loopHandlerName(handler),
      count: Math.max(1, period),
      period: Math.max(1, period),
      paused: false,
      deadline,
    });
  }

  /** the loop table's size: 32 slots, RedJack.exe's 64 */
  private get loopSlots(): number {
    return this.rules.loopSlots;
  }

  /** where this session's engine parts ways with the others (scheduler-rules.ts) */
  private get rules(): SchedulerRules {
    return schedulerRules(this.session);
  }

  /**
   * Put a loop slot back EXACTLY as a save recorded it — mid-count, no
   * replacement scan, and above all no RNG: `makeLoop` is for scripts, and a
   * restore that drew from `ambientRng` would shift the ambient stream against
   * a run that never loaded (the same hazard the seeded stream exists for).
   */
  restoreLoop(kind: string, name: string, handler: string, remaining: number, pause = 0): void {
    if (this.loops.length >= this.loopSlots) {
      this.session.onLog(`loadgame: loop table full (${this.loopSlots}), dropping ${kind}/${name}`);
      return;
    }
    const count = Math.max(1, remaining);
    this.insertLoop({
      kind: kind.toLowerCase(),
      name: name.toLowerCase(),
      handler: Scheduler.loopHandlerName(handler), // as written: see makeLoop
      count,
      period: count,
      // the pauseloop count the save holds (+2): a loop paused twice needs two resumes
      paused: pause > 0,
      pauseDepth: pause,
    });
  }

  /**
   * Put a loop in the table: into the first free slot, kept in slot order, in
   * the engines whose table is read (TI.EXE 0x442a80, tl.exe and DF.EXE the
   * same code) — so `indextoloop` and a pass both see slot order, and a loop a
   * handler arms mid-pass lands in a slot the pass has already passed (its own
   * was just freed) and waits for the next one. RedJack.exe the same, in 64
   * slots (0x41bf8d).
   */
  private insertLoop(l: GameLoop): void {
    const used = new Set(this.loops.map((x) => x.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    l.slot = slot;
    const at = this.loops.findIndex((x) => (x.slot ?? 0) > slot);
    if (at < 0) this.loops.push(l);
    else this.loops.splice(at, 0, l);
  }

  stopLoop(kind: string, name: string): void {
    const k = kind.toLowerCase();
    const n = name.toLowerCase();
    for (let i = this.loops.length - 1; i >= 0; i--) {
      const l = this.loops[i];
      if (l.kind === k && (n === "all" || l.name === n)) this.loops.splice(i, 1);
    }
  }

  pauseLoop(kind: string, name: string, paused: boolean): void {
    const k = kind.toLowerCase();
    const n = name.toLowerCase();
    for (const l of this.loops) {
      if (l.kind !== k || (n !== "all" && l.name !== n)) continue;
      // RedJack.exe nests too: 64 slots of 0x9e at 0x4c4a80, the depth at +2
      // (0x41c252/0x41c257 for "all", 0x41c2c3/0x41c2ce for a name), and a new
      // loop's record starts at depth 0 (makeloop 0x41beef)
      pauseDepth(l, paused);
    }
  }

  isLoop(kind: string, name: string): boolean {
    const k = kind.toLowerCase();
    const n = name.toLowerCase();
    return this.loops.some((l) => l.kind === k && l.name === n);
  }

  /**
   * Tear down all timed state — loops, crickets, walks, sound loops and their
   * flags — and silence sounds. Used when loading a saved game before the new
   * room's scripts rebuild everything from scratch.
   */
  reset(): void {
    this.loops.length = 0;
    this.crickets.reset();
    this.walks.clear();
    this.sounds.loopFlags.clear();
    this.session.balls.reset();
    this.sounds.halt();
  }

  // ---- actor walking (walktostar/walktoxyz/walkonpath/turntodeg) ----------

  /**
   * The walk table: one record per actor, in one of 16 slots (TI.EXE 0x48b150,
   * 0x6e apart; tl.exe 0x45fff0; DF.EXE 0x45f170, 0x52 apart). A record is made
   * by removing the actor's old one — no `endwalk`, it is simply cancelled
   * (TI.EXE 0x442640, DF.EXE 0x438910) — and taking the FIRST FREE slot (0x442ea0,
   * DF.EXE 0x439210); a full table is error 7. A pass services the slots in
   * order, so `indextowalk` and the order the walkers' events arrive in are
   * slot order, not the order the walks were made in.
   *
   * RedJack.exe's is the same: 16 slots of 0x80 at 0x4c3d40, the actor's old
   * record removed (0x41b810) and the first free slot taken, else 7 (0x41c3fb).
   */
  readonly walks = new Map<string, WalkRecord>();

  /** the walk records in slot order — what a pass and `indextowalk` walk */
  walkSlots(): [string, WalkRecord][] {
    return [...this.walks].sort((a, b) => (a[1].slot ?? 0) - (b[1].slot ?? 0));
  }

  /**
   * File a new record for `key`, replacing the actor's old one without an
   * `endwalk` (0x442640) and taking the first free slot (0x442ea0); with all 16
   * taken the old record is gone all the same and the command fails with 7.
   */
  private putWalk(key: string, rec: WalkRecord): void {
    this.walks.delete(key);
    const used = new Set([...this.walks.values()].map((w) => w.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    if (slot >= MAX_WALKS) throw new ScriptError(7, `walk table full (${MAX_WALKS}), ${key} not walked`);
    rec.slot = slot;
    this.walks.set(key, rec);
  }

  /** arriveStar: the walk record's destination name (TI.EXE +0x3e) — what
   *  actorstar() settles on when the walk lands, and what walkdest() answers
   *  while it runs. A walk rides a KIND sentinel meanwhile ("walktostar" for a
   *  named walk, "walktoxyz" otherwise); the name only becomes visible on arrival.
   *
   *  The record (TI.EXE 0x4435c0 / 0x4436d0): the actor's facing and position
   *  as they stand, the deltas, `isqrt` of their squares clamped to at least 1
   *  (0x435950, 0x443781), and the facing to turn to first — the table bearing
   *  (0x444b40 -> 0x444b70, {@link heading}). */
  startWalk(name: string, tx: number, ty: number, tz: number, arriveStar?: string): void {
    const a = this.session.actorRuntime.get(name);
    if (!a) return;
    const dx = tx - a.worldX;
    const dy = ty - a.worldY;
    const dz = tz - a.worldZ;
    // floor, not round, and never below 1 — TI.EXE builds the record with its
    // integer sqrt (0x435950, a truncating binary isqrt) and clamps the result
    // the same way (0x443781)
    const dist = Math.max(1, Math.floor(Math.hypot(dx, dy, dz)));
    // The facing is a TARGET, not an assignment, and the pose is not ours to set
    // — see the turn phase in stepWalk and the endturn it ends on.
    this.putWalk(name.toLowerCase(), {
      sx: a.worldX, sy: a.worldY, sz: a.worldZ, deg: a.deg,
      dx, dy, dz, dist, progress: 0, paused: false, arriveStar,
      turnTo: this.heading(dx, dy),
    });
  }

  /**
   * A walk whose actor is not in the open set: TI.EXE's `walktostar` and
   * `walkonpath` (0x442fb4, 0x443235) build the record only when the actor's set
   * (actor +0x60) is the open one (0x489f94); otherwise they file a DEFERRED
   * record (0x443ac0: +6 = 1, the destination at +0x4e and the route's start at
   * +0x5e) that the walk service builds on the first pass the actor's set is open
   * (0x443bef -> 0x443c1c, then the builder by mode, 0x443f80) and that does
   * nothing at all until then — no turn, no step. `build` is that builder, run
   * from the pass; it re-files the record in place of this one.
   */
  deferWalk(name: string, arriveStar: string, build: () => void, mode = 1, from = ""): void {
    const a = this.session.actorRuntime.get(name);
    if (!a) return;
    this.putWalk(name.toLowerCase(), {
      sx: a.worldX, sy: a.worldY, sz: a.worldZ, deg: a.deg,
      dx: 0, dy: 0, dz: 0, dist: 1, progress: 0, paused: false, arriveStar,
      deferred: build, deferredMode: mode, deferredFrom: from,
    });
  }

  /**
   * Put a saved walk back in the table, mid-stride — the load's half of the
   * walks service table (see SavedWalk in engine/src/df/savegame.ts).
   *
   * Not expressible as a `startWalk`: that one measures from where the actor is
   * standing NOW and starts the progress at zero, and a walk restored that way
   * would set off from wherever the save happened to catch them with the whole
   * distance still to run. The record carries its own origin and its own
   * progress, so this seeds both.
   *
   * Keyed on the actor's own name rather than their cast member's, which is what
   * the walk service looks back up — the two differ for an `actorinstance` (the
   * instance shares its source's member object), and the crowd (`ani1a2` and
   * friends) is nothing but instances.
   */
  restoreWalk(
    name: string,
    w: {
      turnOnly?: boolean;
      paused?: boolean;
      pauseDepth?: number;
      turnTo?: number;
      deg?: number;
      sx: number; sy: number; sz: number;
      dx: number; dy: number; dz: number;
      dist: number; progress: number; arriveStar?: string;
      path?: { x: number; y: number; z: number; cum: number }[];
      roadMode?: 4 | 5;
      waiting?: boolean;
    },
  ): boolean {
    const key = name.toLowerCase();
    const a = this.session.actorRuntime.get(key);
    if (!a) return false;
    try {
      this.putWalk(key, {
        sx: w.sx, sy: w.sy, sz: w.sz, deg: w.deg ?? a.deg,
        dx: w.dx, dy: w.dy, dz: w.dz,
        path: w.path,
        // a turn's distance is never read, but a zero here would make the mover's
        // `progress / dist` a NaN the moment a turn was mistakenly given one
        dist: Math.max(1, w.dist),
        progress: w.progress,
        paused: w.paused ?? false,
        pauseDepth: w.pauseDepth,
        arriveStar: w.arriveStar,
        turnTo: w.turnTo,
        turnOnly: w.turnOnly,
        roadMode: w.roadMode,
        waiting: w.waiting,
      });
    } catch {
      return false; // more than 16 in the save: no slot for it
    }
    return true;
  }

  /**
   * `walkonpath`: walk an AUTHORED ROUTE rather than the straight line between
   * two stars. `points` runs from where the actor sets off to the destination.
   *
   * The corpus holds six of these and only three bend, but those three are the
   * whole of #122: Georgia's ten-point curve around the boat deck's structures
   * (`deckbd` `ga.1`→`ga.2`), Sasha's five-point route out of the cabin and down
   * the hall (`halla`), and the hacker's nine (`scot3`). Walking the straight
   * line instead takes Georgia through the second-class stairs and clips Sasha
   * through the corner of a wall.
   *
   * One progress scalar over the whole polyline, as TI.EXE's record keeps it
   * (+0x16): the route's mover (0x444d70) finds the leg the progress has reached
   * and interpolates along it — see {@link moveOnPath}. The opening facing comes
   * from the first two points (0x444980). So no leg re-dispatches `endturn` and
   * only the arrival fires `endwalk` — one walk, as the script asked for.
   */
  /**
   * `walkonroad` / `walkonframes`: a route built from the camera road that
   * leaves a standpoint (TI.EXE 0x43c210 / 0x43c2f0 -> 0x404f90, de build).
   * The record keeps the actor where they stand and turns them first to the
   * route's first leg by `calcdeg`'s bearing (0x43d290 -> 0x43d450, not the
   * walk table's); its arrival star is "custom". Mode 4 then goes by the
   * actor's speed along the route (the route mover, 0x443eff); mode 5 puts
   * them on the next frame of the road each pass, facing from the one before
   * (0x444f30), and has arrived once the progress reaches the frame count.
   */
  startWalkRoad(name: string, path: { x: number; y: number; z: number; cum: number }[], mode: 4 | 5): void {
    const a = this.session.actorRuntime.get(name);
    if (!a || path.length < 2) return;
    this.putWalk(name.toLowerCase(), {
      sx: a.worldX, sy: a.worldY, sz: a.worldZ, deg: a.deg,
      dx: 0, dy: 0, dz: 0,
      dist: Math.max(1, Math.floor(path.at(-1)!.cum)), progress: 0, paused: false, arriveStar: "custom",
      turnTo: engineBearing(path[1].x - path[0].x, path[1].y - path[0].y),
      path, roadMode: mode,
    });
  }

  startWalkPath(
    name: string,
    points: { x: number; y: number; z: number; fromPrev: number }[],
    arriveStar?: string,
  ): void {
    const a = this.session.actorRuntime.get(name);
    if (!a) return;
    if (points.length < 2) {
      const p = points[0];
      if (p) this.startWalk(name, p.x, p.y, p.z, arriveStar);
      return;
    }
    // The leg lengths arrive with the points and are not re-measured here: the
    // author stored them with TI.EXE's truncating integer sqrt, so a re-measure
    // with `Math.hypot` disagrees by a unit here and there (halla's third leg is
    // 277 stored against 278.0 computed) and the total would no longer match the
    // header the original paces the whole route by. A `"resume"` walk arrives
    // having re-measured its own — with that same isqrt, and because trimming
    // the route gave its first leg a length nobody authored.
    const path: { x: number; y: number; z: number; cum: number }[] = [];
    let cum = 0;
    points.forEach((p, i) => {
      if (i > 0) cum += p.fromPrev;
      path.push({ x: p.x, y: p.y, z: p.z, cum });
    });
    const first = path[0];
    const second = path[1];
    // No teleport onto the head of the route. TI.EXE's builder (0x4437f0) records
    // the actor's CURRENT position and leaves them standing on it; the mover
    // (0x443eff -> 0x444d70) reads every later position out of the route, so the
    // first movement pass is what puts them on it — after the turn, not before
    // it (#230).
    this.putWalk(name.toLowerCase(), {
      sx: a.worldX, sy: a.worldY, sz: a.worldZ, deg: a.deg,
      dx: 0, dy: 0, dz: 0,
      dist: Math.max(1, Math.floor(cum)), progress: 0, paused: false, arriveStar,
      turnTo: this.heading(second.x - first.x, second.y - first.y),
      path,
    });
  }

  /**
   * `turntodeg`: turn an actor to face a bearing, over time.
   *
   * A turn is a WALK in the original — `0x443550` builds a record in the same
   * table `iswalk` answers from: the facing target `deg & 0xff` at `+8`, the
   * actor's facing and position as they stand, and `+0x3e` copied from the
   * actor's CURRENT star (`actor+0x70`), so a turn does not change where anyone
   * is going. Only the mode differs — 0 here against a straight walk's 1.
   *
   * That is load-bearing for conversations, because `walktopuppet` (gang.cst 0001)
   * waits on exactly that:
   *
   *     pauseloop ("actor", who, true)
   *     turntodeg (who, calcdeg (actorxyz (who, 4), cameraxyz (4)))
   *     while iswalk (who)  forceupdate ()  endwhile
   *     runpuppet (pupname, pupmessage)
   *
   * Setting the facing outright would leave `iswalk` false, so the wait never
   * spins and `runpuppet` opens in the same breath (#124).
   *
   * It is ALWAYS recorded — there is no "already facing" shortcut — and like any
   * new record it first removes the actor's old one (0x442ea0 -> 0x442640): a
   * walk in progress is cancelled where it stands, with no `endwalk`. DF.EXE's
   * (0x439260 -> 0x439210) the same. The turn lands on the next pass when there is
   * nothing to turn, and sends `endturn` (see {@link stepWalk}).
   */
  startTurn(name: string, deg: number): void {
    const a = this.session.actorRuntime.get(name);
    if (!a) return;
    // RedJack.exe's (0x41c2f0) is the same record in its units: the target
    // `deg & 0xffffff` at +8, mode 0, the actor's facing and point at +0xc, its
    // star at +0x50, the old record removed (0x41c3e2) — always, facing or not
    const target = deg & (this.turnUnits - 1);
    this.putWalk(name.toLowerCase(), {
      sx: a.worldX, sy: a.worldY, sz: a.worldZ, deg: a.deg,
      dx: 0, dy: 0, dz: 0,
      // 1, not 0: nothing divides by it, but a NaN is worse than a 1
      dist: 1, progress: 0, paused: false,
      /**
       * ## WHERE THE ACTOR IS STILL GOING (#289)
       *
       * `+0x3e` copied from the actor's current star, as 0x443550 does — a turn
       * does not change anyone's destination, and this field is the destination.
       * `walkdest` reads it: GANG.CST's `walktopuppet` memorises where a
       * character was going (`savestar = walkdest (who)`) so it can send them
       * back afterwards, and Dust's idles turn constantly — a `"custom"` there
       * would strand the character where they met you (the Mayor's wife
       * blocking the guest-room door on night 1).
       */
      arriveStar: a.starName,
      turnTo: target,
      turnOnly: true,
    });
  }

  /**
   * Step a facing toward `target` by at most `by` — TI.EXE's `0x445080`
   * (DF.EXE `0x43ab40` is the same arithmetic), which the walk service calls
   * once per pass with the actor's `actorturn` and a WRAP of 0xff, not 0x100:
   *
   *   - it goes the way whose distance is shorter, the distances reckoned with
   *     that wrap (`cur − target + 0xff` against `target − cur`);
   *   - stepping down past 0 adds 0xff, and stepping up to 0xff or beyond takes
   *     0xff off — so crossing north lands one unit further round than a
   *     256-turn would, and a turn of 250 → 5 by 10 arrives at once;
   *   - it clamps on the target rather than overshooting it, and a target it
   *     already holds is returned as it is.
   *
   * All in 16-bit words, `by` as given. RedJack.exe's (0x41e300) is the same
   * arithmetic in 32-bit dwords with a wrap of 0xffffff (pushed at 0x41b4dc),
   * the step the actor's `actorturn` as it is — a turn of 0 never lands.
   */
  private stepDeg(cur: number, target: number, by: number): number {
    const { turnWrap: wrap, word: w } = this.rules;
    const c = w(cur);
    const t = w(target);
    const step = w(by);
    if (t > c) {
      if (w(c - t + wrap) > w(t - c)) {
        const ax = w(c + step);
        return Math.min(t, ax);
      }
      let ax = w(c - step);
      if (ax >= 0) return ax;
      ax = w(ax + wrap);
      return Math.max(t, ax);
    }
    if (w(t - c + wrap) > w(c - t)) {
      const ax = w(c - step);
      return Math.max(t, ax);
    }
    let ax = w(c + step);
    if (ax < wrap) return ax;
    ax = w(ax - wrap);
    return Math.min(t, ax);
  }

  /**
   * A position as a walk record holds it: TI.EXE's and DF.EXE's in 16-bit words,
   * RedJack.exe's in dwords (its world is in 10⁻⁵ units, 0x41b5d4).
   */
  private readonly word = (v: number): number => this.rules.word(v);

  /**
   * A whole turn in the units a facing is held in: 256 for the older engines,
   * 2^24 for DreamFactory 5, whose `actordeg`, `calcdeg` and `actorturn` all
   * count in 2^24ths (RedJack's `stdturn` is 1,050,000 a pass, about 22°) (#447).
   */
  private get turnUnits(): number {
    return this.rules.turnUnits;
  }

  /**
   * The facing of a delta vector, in {@link turnUnits}: the engines' table
   * bearing (TI.EXE 0x444b70 with its octant table, the one `calcdeg` reads;
   * DF.EXE 0x43a760) — {@link engineBearing} — or DreamFactory 5's.
   */
  private heading(dx: number, dy: number): number {
    return this.rules.heading(dx, dy);
  }

  /**
   * `stopwalk`: the record is cleared and that is all (TI.EXE 0x43e7a0 ->
   * 0x442640) — no pose: no exe of the four carries the string "stand", so none
   * of them can put anyone back to it. The walker keeps whatever pose its cast
   * last gave it; every `endwalk` and idle in the corpora sets its own.
   */
  stopWalk(name: string): void {
    const key = name.toLowerCase();
    if (key === "all" && this.rules.stopWalkAll) {
      this.walks.clear();
      return;
    }
    this.walks.delete(key);
  }

  isWalk(name: string): boolean {
    return this.walks.has(name.toLowerCase());
  }

  /**
   * Is a TURN in flight — for one actor, or for anyone?
   *
   * `iswalk` cannot answer this and does not try to: TI.EXE's (`0x4427e0`) walks
   * its 16-slot table and tests exactly two fields per slot, the occupied flag
   * at `+0` and the actor name at `+0x2e`. Never the mode. So a turning actor
   * reads as walking to every script — and also what makes `if iswalk (me)
   * exitcode` refuse a click at someone mid-turn, in the original as much as here.
   *
   * A test driver clicks once, so it needs to know when the sub-second window
   * is open; nothing in the game does.
   */
  turning(name?: string): boolean {
    if (name !== undefined) return !!this.walks.get(name.toLowerCase())?.turnOnly;
    for (const w of this.walks.values()) if (w.turnOnly) return true;
    return false;
  }

  /**
   * Is ANYONE in motion — walking or turning? What a click-refusing guard keys
   * off (`if iswalk (me) exitcode`); nothing in the game asks, only the drivers.
   */
  anyoneMoving(): boolean {
    // a waiting (DreamFactory 1) or deferred (4) walk moves nobody until its room opens
    for (const w of this.walks.values()) if (!w.waiting && !w.deferred) return true;
    return false;
  }
  /** `pausewalk`: one walk, or every one for "all" (DF.EXE 0x439a08, TI.EXE 0x43c9b8) */
  pauseWalk(name: string, paused: boolean): void {
    const n = name.toLowerCase();
    // RedJack.exe the same (0x41d440): 16 slots of 0x80 at 0x4c3d40, depth at
    // +2 (0x41d49a "all", 0x41d50e a name), a new walk's record at 0 (0x41c394)
    if (n === "all") {
      for (const w of this.walks.values()) pauseDepth(w, paused);
      return;
    }
    const w = this.walks.get(n);
    if (w) pauseDepth(w, paused);
  }

  /**
   * The walk service as DreamFactory 5 runs it (Scheduler.serviceStep): every
   * record stepped, the events fired after. The other engines walk their table
   * inside a pass instead and send each event before the next slot ({@link pass}).
   */
  private serviceWalks(): void {
    const arrived: string[] = [];
    for (const [key, w] of this.walks) {
      const ev = this.stepWalk(key, w);
      if (ev === "endturn") {
        void this.session.track(this.session.sendEvent("sendtoactor", key, "endturn", [], "walk"));
      } else if (ev === "endwalk") arrived.push(key);
    }
    // Fire each arrived actor's endwalk() — the arrival lifecycle handler. NPCs
    // use it to face the player, resume an idle loop, or start the next leg of a
    // patrol; without it walk-driven actors freeze after one leg. What makes the
    // dispatch safe is the arrival STAR: an engine-driven arrival lands on
    // `"custom"` and every endwalk in the corpus opens by returning on it
    // (#10/#19/#21). Fired after the loop so a new walk it starts doesn't perturb
    // this pass.
    for (const key of arrived) {
      if (this.hasEndwalk(key)) {
        void this.session.track(this.session.sendEvent("sendtoactor", key, "endwalk", [], "walk"));
      }
    }
  }

  private hasEndwalk(key: string): boolean {
    return !!this.session.castScripts.get(key)?.script.codes.has("endwalk");
  }

  /**
   * Step one walk record by one pass — TI.EXE's 0x443ba0 (tl.exe 0x402b20,
   * DF.EXE 0x4395c0) for one slot — and say which event it ended in, if any:
   * `endturn` when its turn lands, `endwalk` on arrival. Sending it is the
   * caller's. A deferred record's build failing throws its error (0x443c64).
   */
  private stepWalk(key: string, w: WalkRecord): "endturn" | "endwalk" | null {
    if (w.paused) return null;
    const a = this.session.actorRuntime.get(key);
    // RedJack.exe looks the walker up first (0x41b3a5) and a walker that is not
    // there is error 0xa, which frees the slot and stops the pass (0x41b7c5)
    if (!a && this.rules.missingWalkerThrows) throw new ScriptError(0xa, `walk: no actor "${key}"`);
    if (!a) {
      this.walks.delete(key);
      return null;
    }
    if (w.deferred) {
      // built on the first pass the actor's set is open, and nothing else this
      // pass (0x443c1c; the builder returns to 0x443cdf)
      if (a.setName.toLowerCase() !== this.session.actorRuntime.currentSet) return null;
      w.deferred();
      return null;
    }
    if (w.waiting) {
      // see the record's `waiting`: the walker's set must be the open one,
      // and the star must be in it ("custom" names no star, 0x439738)
      if (a.setName.toLowerCase() !== this.session.actorRuntime.currentSet) return null;
      const want = (w.arriveStar ?? "").toLowerCase();
      const star = want && want !== "custom"
        ? this.session.currentBinding?.set.actors.find((s) => s.identifier.toLowerCase() === want)
        : undefined;
      if (want && want !== "custom" && !star) return null;
      // ...and it arrives on this pass, through the mover below
      w.sx = star ? star.positionX : a.worldX;
      w.sy = star ? star.positionZ : a.worldY;
      w.sz = star ? star.positionY : a.worldZ;
      w.dx = w.dy = w.dz = 0;
      w.dist = 1;
      w.progress = 0;
      w.turnTo = undefined;
      w.path = undefined;
      w.waiting = false;
    }
    // A walk TURNS before it moves, and does not do both in one pass. While the
    // record's facing target is set (+8, >= 0), the service steps the facing by
    // the actor's `actorturn` (0x443d19) and puts the actor on the record's
    // facing and starting point (0x443d28) — and only once the facing lands
    // does it dispatch `endturn()` (0x443d5b..0x443da4) and let the movement
    // passes begin. A TURN-ONLY record (`turntodeg`, mode 0) is cleared there
    // instead (0x443d4e), and sends `endturn` all the same; DF.EXE's the same
    // (0x439679). So gang.cst's Steph, whose `endturn` re-arms `walkout` when
    // `iswalk` is false, sets off again after the turn a click gave her.
    //
    // The WALK POSE comes out of that dispatch rather than from here, because
    // it is the cast's to choose (`walk`, or `walklj` with the life jackets on).
    //
    // RedJack.exe's pass (0x41b4c4..0x41b571) is TI.EXE's: the record's facing
    // (+0xc) stepped by `actorturn` (0x41e300), the record's facing and point
    // put on the actor (0x41b4f5), and on landing a turn's slot freed (0x41b515)
    // or a walk's target cleared (0x41b51c) and `endturn ()` sent (0x41b561).
    if (w.turnTo !== undefined) {
      // TI.EXE steps the RECORD's facing (+0x0a); DF.EXE the actor's (0x439629)
      const cur = this.rules.turnStepsActor ? a.deg : (w.deg ?? a.deg);
      const turned = this.stepDeg(cur, w.turnTo, a.turn);
      w.deg = turned;
      a.deg = turned & (this.turnUnits - 1);
      if (!w.waiting) {
        a.worldX = w.sx;
        a.worldY = w.sy;
        a.worldZ = w.sz;
      }
      if (turned !== w.turnTo) return null;
      if (w.turnOnly) this.walks.delete(key);
      else w.turnTo = undefined;
      return "endturn";
    }
    if (w.turnOnly) {
      this.walks.delete(key); // a restored turn with nothing left to turn
      return null;
    }
    // One service pass advances the actor's own `actorspeed` in world units —
    // no scaling (#: a ×4 approximation had the whole cast moving at four times
    // its scripted pace). TI.EXE's straight-line mover (0x443e7c), DF.EXE's
    // (0x439880):
    //
    //     [walk+0x16] += actor[0x26]          ; progress += actorspeed
    //     if (dist < progress) progress = dist
    //     pos = start - (start - dest) * progress / dist   ; idiv: truncated
    //     if (dist <= progress) -> arrival, endwalk()
    //
    // in 16-bit words, and the facing put back to the record's every pass.
    //
    // RedJack.exe's movers are the same (0x41b58b straight, 0x41dfe0 the route,
    // 0x41e1c0 the frames) in 32-bit dwords, with the start less the delta
    // times the progress over the distance in doubles, truncated (0x45e540).
    let arrived: boolean;
    if (w.path && w.roadMode === 5) {
      // one frame of the road a pass (0x443f40: progress + 1)
      w.progress += 1;
      arrived = this.moveOnFrames(a, w.path, w.progress);
    } else if (w.path) {
      w.progress += a.speed;
      arrived = this.moveOnPath(a, w.path, w.progress);
    } else {
      w.progress += a.speed;
      if (w.progress > w.dist) w.progress = w.dist;
      const word = this.word;
      a.worldX = word(w.sx + Math.trunc((w.dx * w.progress) / w.dist));
      a.worldY = word(w.sy + Math.trunc((w.dy * w.progress) / w.dist));
      a.worldZ = word(w.sz + Math.trunc((w.dz * w.progress) / w.dist));
      if (w.deg !== undefined) a.deg = w.deg & (this.turnUnits - 1);
      arrived = w.dist <= w.progress;
    }
    if (!arrived) return null;
    // The arrival (0x443de3, DF.EXE 0x439777): the record's star into
    // `actorstar`, the slot freed, `endwalk` sent — and NO pose: the string
    // "stand" is not in any of the exes. The cast's own `endwalk` stands them.
    this.walks.delete(key);
    if (w.arriveStar !== undefined) a.starName = w.arriveStar;
    return "endwalk";
  }

  /**
   * `walkonframes`' mover, TI.EXE 0x444f30 (en): with the progress at or past
   * the frame count the actor is put on the last frame, facing along the last
   * leg, and has arrived; otherwise on frame `progress`, facing from the one
   * before it — no interpolation.
   */
  private moveOnFrames(
    a: { worldX: number; worldY: number; worldZ: number; deg: number },
    path: { x: number; y: number; z: number }[],
    progress: number,
  ): boolean {
    const n = path.length;
    const at = Math.min(progress, n - 1);
    const p = path[at - 1];
    const c = path[at];
    a.worldX = c.x;
    a.worldY = c.y;
    a.worldZ = c.z;
    a.deg = this.heading(c.x - p.x, c.y - p.y);
    return n <= progress;
  }

  /**
   * The route mover, TI.EXE 0x444d70 (DF.EXE 0x43a990 the same): with the
   * progress at or past the route's length the actor is put on its last point,
   * facing along the last leg, and has arrived; otherwise the leg is found by
   * taking each leg's length off the progress while it is longer than the leg
   * (`r <= len` stays in the leg — a point is the END of the leg before it), and
   * the actor goes `P + trunc((C − P) · r / len)` along it, facing it. True on
   * arrival.
   */
  private moveOnPath(
    a: { worldX: number; worldY: number; worldZ: number; deg: number },
    path: { x: number; y: number; z: number; cum: number }[],
    progress: number,
  ): boolean {
    const n = path.length;
    const total = Math.floor(path[n - 1].cum);
    if (total <= progress) {
      const p = path[n - 2];
      const c = path[n - 1];
      a.worldX = c.x;
      a.worldY = c.y;
      a.worldZ = c.z;
      a.deg = this.heading(c.x - p.x, c.y - p.y);
      return true;
    }
    let r = progress;
    for (let k = 1; k < n; k++) {
      const len = path[k].cum - path[k - 1].cum;
      if (r > len) {
        r -= len;
        continue;
      }
      const p = path[k - 1];
      const c = path[k];
      // a zero-length leg is divided by in the original as well; step over it
      const f = (d: number) => (len > 0 ? Math.trunc((d * r) / len) : 0);
      a.worldX = this.word(p.x + f(c.x - p.x));
      a.worldY = this.word(p.y + f(c.y - p.y));
      a.worldZ = this.word(p.z + f(c.z - p.z));
      a.deg = this.heading(c.x - p.x, c.y - p.y);
      return false;
    }
    return true; // legs shorter than the total: 0x444e4d reports and arrives
  }

  // ---- the pass: the original's only heartbeat ----------------------------

  /**
   * Does the world advance only in a PASS that a script runs? TI.EXE's service
   * pass (0x442550) has exactly two callers, `forceupdate` (0x43e3e0, a bare
   * `jmp`) and `visualeffect` (0x43ded0); tl.exe's (0x4014e0) the same two
   * (0x44a9ea, 0x44a58f). Nothing else steps a walk, a cricket or a loop, or
   * draws a frame: `delay` (0x41deb0) and the tick (0x41de90) only pump
   * messages, a film's loop (0x449263) and a puppet's speech (0x440620) only
   * poll events. The heartbeat is SCRIPT — the BOOTFILE's `idle ()`, which the
   * main loop sends between events (0x431c09, event 9) and which opens with
   * `forceupdate ()` — so while a handler, a `delay`, a film or a
   * conversation holds the engine, nothing advances at all.
   *
   * DF.EXE is built the same way (pass 0x438840, callers `forceupdate`
   * 0x4207ba and `visualeffect` 0x42039f, throttle 0x434162; Dust's BOOTFILE
   * `idle ()` opens with `forceupdate ()`), and so is RedJack.exe (pass
   * 0x41b360, callers `forceupdate` 0x408ce0 and `visualeffect` 0x408c43, the
   * throttle in its frame 0x432b00; its BOOTFILE `idle ()` ENDS with
   * `forceupdate ()`). Every engine the port runs is paced this way — see
   * docs/engine/runtime/timing.md. Still asked by the readers that once had a
   * second branch.
   */
  get scriptPaced(): boolean {
    return true;
  }

  /** passes run so far — the clock a prop's frame steps on ({@link passFrame}) */
  private passCount = 0;
  /** how deep in passes we are: a loop handler's `forceupdate` runs one inside another */
  private passDepth = 0;
  /** is a pass running — a handler started now is one the pass sends (a loop, a walk's event, an arrival) */
  get inPass(): boolean {
    return this.passDepth > 0;
  }
  /**
   * The tick the last frame was stamped on — TI.EXE's 0x48a6d8, written by the
   * throttle (0x43a95a). Null before the first frame.
   */
  private frameStamp: number | null = null;

  /**
   * One master pass, TI.EXE's 0x442550 (tl.exe 0x4014e0), and what it runs in
   * this order:
   *
   *  1. the 16 walk slots (0x443ba0), each one's `endturn`/`endwalk` sent and
   *     run to its end before the next slot is looked at;
   *  2. the 16 cricket slots (0x444430), in slot order;
   *  3. the 32 loop slots (0x442ae0): paused → skipped; otherwise the count goes
   *     down by one — every slot, every pass, a period of 1 included — and at 0
   *     the slot is cleared and its handler sent and run to its end, before the
   *     next slot;
   *  4. the frame (0x439b80): the frame counter, every prop and actor stepped,
   *     and the throttle ({@link throttle}).
   *
   * A handler that fails stops the pass where it is: the slot is freed, the
   * rest of the table waits for the next pass and there is no frame
   * (0x442605/0x442621/0x44262a return before 0x4425fc). Returns false then.
   *
   * RedJack.exe's (0x41b360) is the same pass with its own tables — 16 walk
   * slots (0x41b37c..0x41b718), 16 crickets (0x41b72e..0x41b75a), 64 loops
   * (0x41b766..0x41b783) — and two more services before its frame: the
   * `endanim ()` every actor (0x408450) and then every prop (0x42e300) whose
   * view ended in the last frame is owed, each run to its end. See
   * {@link passEndAnims}.
   *
   * `wait` is how the throttle waits ({@link PassWait}).
   */
  async pass(opts: { wait?: PassWait } = {}): Promise<boolean> {
    this.passDepth++;
    try {
      if (!(await this.passServices())) return false;
      this.passFrame();
      // ...and the room's camera, one step of a turn or a walk (TI.EXE 0x439bbb)
      await this.session.onPassMotion();
      await this.throttle(opts.wait ?? "clock");
      return true;
    } finally {
      this.passDepth--;
    }
  }

  /** send one event from inside a pass, as the running script it is; false if it failed */
  private async sendInPass(run: () => Promise<unknown>, label: string): Promise<boolean> {
    try {
      await this.session.track(run(), label);
      return true;
    } catch (e) {
      this.session.onLog(`pass stopped at ${label}: ${(e as Error).message}`);
      return false;
    }
  }

  private async passServices(): Promise<boolean> {
    // walks, in slot order (0x442556..0x442584)
    // — slot by slot, as the record now in each one: a walk an earlier slot's
    // handler made in a later slot is serviced this same pass
    for (let slot = 0; slot < MAX_WALKS; slot++) {
      const found = [...this.walks].find(([, r]) => r.slot === slot);
      if (!found) continue;
      const [key, w] = found;
      let ev: "endturn" | "endwalk" | null;
      try {
        ev = this.stepWalk(key, w);
      } catch (e) {
        // a deferred walk's builder failed (0x443c64), or RedJack.exe's walker
        // is gone (0x41b3ad): the slot is freed and the pass stops there
        // (0x442605, 0x41b7d6)
        this.walks.delete(key);
        this.session.onLog(`pass stopped at walk ${key}: ${(e as Error).message}`);
        return false;
      }
      if (!ev || (ev === "endwalk" && !this.hasEndwalk(key))) continue;
      const ok = await this.sendInPass(
        () => this.session.sendEvent("sendtoactor", key, ev, [], "walk"),
        `${ev} ${key}`,
      );
      if (!ok) {
        this.walks.delete(key); // 0x442618: the failing slot is freed
        return false;
      }
    }
    // the crickets — DF.EXE's balls in their place (0x438870)
    if (!this.crickets.pass()) return false;
    if (!(await this.passLoops())) return false;
    return this.rules.endAnimsOwed ? this.passEndAnims() : true;
  }

  /**
   * The pass's loop table (TI.EXE 0x4425ce, DF.EXE 0x438894, RedJack.exe
   * 0x41b75f → 0x41bff0 for each of its 64 slots). A RedJack clock loop
   * ({@link GameLoop.deadline}) does not count: it fires on the first pass at
   * or after its tick (0x41c008).
   */
  private async passLoops(): Promise<boolean> {
    // loops, slot by slot (0x4425d3..0x4425f0)
    const slots = this.loopSlots;
    for (let slot = 0; slot < slots; slot++) {
      const l = this.loops.find((x) => x.slot === slot);
      if (!l || l.paused) continue;
      if (l.deadline === undefined) {
        if (--l.count > 0) continue;
      } else if (ticksAt(this.session.clock.now) < l.deadline) continue;
      this.loops.splice(this.loops.indexOf(l), 1);
      if (!(await this.sendInPass(() => this.fireLoop(l), `loop ${l.kind}/${l.name}.${l.handler}`))) {
        return false;
      }
    }
    return true;
  }

  /** the actors and props whose `endanim ()` the next pass owes (RedJack.exe's flag 8) */
  private owedEndAnims: { actors: string[]; props: string[] } = { actors: [], props: [] };

  /**
   * RedJack.exe's two end-of-view services, after the loops (0x41b797,
   * 0x41b7a1): every ACTOR whose record carries flag 8 (0x408481) has it cleared
   * and is sent `"name", endanim ()` (0x40850d..), then every PROP the same
   * (0x42e300), each run to its end; one that fails stops the pass (0x41b79f,
   * 0x41b7a9). The flag is set by the frame's step (0x4069b0, flag 0xa at
   * 0x406a70), so an ending is heard in the pass after the frame that drew it.
   */
  private async passEndAnims(): Promise<boolean> {
    const owed = this.owedEndAnims;
    this.owedEndAnims = { actors: [], props: [] };
    const res = this.session.resourceCtrl;
    for (const [cmd, names] of [["sendtoactor", owed.actors], ["sendtoprop", owed.props]] as const) {
      for (const name of res.endAnimTargets(cmd, names)) {
        const ok = await this.sendInPass(() => this.session.sendEvent(cmd, name, "endanim", [], "anim"), `endanim ${name}`);
        if (!ok) return false;
      }
    }
    return true;
  }

  /**
   * The frame (TI.EXE 0x439b80): one on the counter `frame ()` reads
   * (0x489efa), and the picture composed — which is where every prop's view and
   * every actor's pose take their next step, one a pass whatever the
   * framerate. The props step on the pass count, not on the clock: a frame is a
   * pass here.
   */
  private passFrame(): void {
    const s = this.session;
    s.frameCounter += 1;
    this.passCount += 1;
    // DF.EXE's frame (0x433490) steps only the props it draws (0x41eb67), against
    // the camera the room draws with (0x41e828/0x41e834)
    const rules = this.rules;
    const v1 = rules.propsByCamera;
    // RedJack.exe's steps go by the clock's sixtieths since a view began
    // (0x406a03), read in the frame
    const tick = ticksAt(s.clock.now);
    const props = s.propRuntime.tick(
      this.passCount * ENGINE_STEP_MS, ENGINE_STEP_MS, true, v1, v1 ? s.activeCamera() : null, tick,
    );
    const actors = s.actorRuntime.advanceAnimation(tick);
    if (rules.endAnimsOwed) {
      // ...and each ending is owed to the next pass (passEndAnims)
      this.owedEndAnims.actors.push(...actors);
      this.owedEndAnims.props.push(...props);
    }
  }

  /**
   * The frame throttle, TI.EXE 0x43a940 (tl.exe 0x446f40, DF.EXE 0x434162):
   *
   *     call 0x41de90            ; now = timeGetTime() * 3 / 50   (the tick)
   *     mov  ecx, [0x489efe]     ; framerate
   *     add  ecx, [0x48a6d8]     ; + the last frame's stamp
   *     cmp  eax, ecx
   *     jl   0x43a940            ; not yet -> spin
   *     mov  [0x48a6d8], eax     ; stamp
   *
   * It is reached from the compose (0x43a8f2) AFTER the services, so a pass's
   * work is done at once and the wait comes last: one pass per `framerate`
   * ticks, 60/framerate a second — 20 at the default 3 (0x429643), 12 at the
   * fight's 5. `framerate` is clamped 0..60 by its setter (0x43e3a9).
   *
   * `framerate (0)` takes the spin out altogether, and the original then runs
   * a pass as fast as the machine draws one. That rate is the machine's, not
   * the game's; the finest unit the port's clock has is the tick, so 0 waits
   * for the next tick — one pass a tick, the same as 1 — on every host.
   *
   * The stamp is the tick the wait ended on, as the original's is, with one
   * allowance for a host that is only called on screen refreshes: a wait that
   * ended less than a period late keeps the rhythm (`due`), or a 60 Hz refresh
   * landing a hair after a tick boundary would make every pass a tick long. On
   * the speedrun's stepped clock every tick is delivered and the two agree.
   */
  private async throttle(wait: PassWait): Promise<void> {
    const clock = this.session.clock;
    // read afresh on every turn of the wait, as the spin re-reads 0x489efe
    const period = (): number => Math.max(1, Math.round(this.session.frameRate));
    if (this.frameStamp === null) {
      this.frameStamp = ticksAt(clock.now);
      return;
    }
    const stamp = this.frameStamp;
    const due = (): number => stamp + period();
    if (wait === "jump") {
      if (ticksAt(clock.now) < due()) clock.advance(Math.ceil((due() * 50) / 3));
    } else {
      while (ticksAt(clock.now) < due()) {
        if (wait === "frames") await this.session.frameWait();
        else await clock.untilTick(ticksAt(clock.now) + 1);
      }
    }
    const at = ticksAt(clock.now);
    this.frameStamp = at - due() < period() ? due() : at;
  }

  /** the BOOTFILE `idle ()` the host is running right now, if any */
  private idleInst: ScriptInstance | null = null;
  private idling = false;
  /** passes the running idle had seen when it started — a restart needs one to have run */
  private idleFrom = 0;

  /** is the host's idle in flight? The original takes no event until it returns. */
  get idleRunning(): boolean {
    return this.idling;
  }

  /**
   * How a pass a script asks for (`forceupdate`, `visualeffect`) waits out its
   * throttle ({@link PassWait}): the BOOTFILE `idle ()` the host started waits
   * on the host's clock, headless too — the host is the one moving it; any
   * other script asks a drawing host for frames, and moves the clock itself
   * where nothing draws.
   */
  passWait(frame: { script: unknown; handler: string } | undefined): PassWait {
    const idle = !!frame && !!this.idleInst && frame.script === this.idleInst && frame.handler.toLowerCase() === "idle";
    if (idle) return "clock";
    return this.session.hasRealFrames ? "frames" : "jump";
  }

  /**
   * The main loop's idle (TI.EXE 0x431c09 sends event 9; 0x42a2d7 runs the
   * BOOTFILE's `idle ()`): sent whenever nothing else holds the engine and no
   * event is waiting to be taken — the loop is `idle ()`, then at most one
   * event, then `idle ()` again. TAOOT's is `forceupdate ()`, `calctime ()` and
   * every fourth time `hittest` + `setcursor`; Timelapse's adds `EndTimer` and
   * the flat's own idle.
   *
   * A session with no BOOTFILE idle (a bare test session) runs the pass alone.
   */
  serviceIdle(): void {
    if (this.idling || this.session.scriptBusy || this.session.idleHeld()) return;
    const boot = this.session.bootScripts.find((b) => b.script.codes.has("idle")) ?? null;
    this.idling = true;
    this.idleInst = boot;
    this.idleFrom = this.passCount;
    const run = boot
      ? this.session.interp.runHandler(boot, "idle", [], { me: boot.name, target: "" })
      : this.pass();
    void run
      .catch((e) => this.session.onLog(`script error in ${boot?.name ?? "the pass"}.idle: ${(e as Error).message}`))
      .finally(() => {
        this.idling = false;
        this.idleInst = null;
        this.session.onIdle?.();
        // ...and straight round again, as the loop does: the next pass's work
        // follows the last one's stamp. Only after an idle that ran a pass, so
        // one that fails before its forceupdate cannot spin.
        if (this.passCount > this.idleFrom) this.serviceIdle();
      });
  }

  /**
   * The host's turn: it moves the clock, and the world moves in the BOOTFILE
   * idle's pass ({@link serviceIdle}) — nothing else is serviced here.
   */
  tickTime(now: number): void {
    this.session.clock.advance(now);
    this.serviceIdle();
  }

  private async fireLoop(l: GameLoop): Promise<void> {
    const cmd =
      { actor: "sendtoactor", prop: "sendtoprop", scene: "sendtoscene", flat: "sendtoflat" }[
        l.kind
      ] ?? "sendtoprop";
    // A "flat" loop belongs to the ONE active overlay flat, so fire it on the
    // current flat rather than the captured name. TAOOT's blackjack gameover()
    // does makeloop("flat", me, "newgame", 45), but when the hand ends from a click
    // in a flat REGION (hit/stay), `me` is that region's name, not the flat —
    // sendtoflat(region) wouldn't resolve newgame and the play-again prompt
    // never fired. (For the deal-triggered gameover, me already IS the flat.)
    // ...but only when the captured name cannot answer for itself. Timelapse's
    // stage animation is the case that needs the other half: `flattick` walks the
    // cels and then arms the CALLBACK — `makeloop("flat", baseflat,
    // flatcallback, 0)` — to put the base flat back, and by then the current flat
    // is `i0001.100.54`, an animation cel with no script. The captured name is
    // the base flat, which is exactly where `FlatAnimDone` lives. So: prefer the
    // name the script gave, fall back to the current flat when it has nothing to
    // say, which is what leaves the blackjack case above working (a region name
    // has no `newgame`).
    const named = l.kind === "flat" ? this.session.flatScripts.get(l.name) : null;
    const target =
      l.kind === "flat" && !named?.script.codes.has(l.handler) ? this.session.currentFlat : l.name;
    // A SCENE loop may drive the camera via currentscene()/currentview() — a
    // scripted pan (TAOOT BEDSIT1's gotowin: `while currentview()!="view23":
    // currentscene("right")` to face the bomb). The nav hooks are only armed
    // during a user gesture, so arm the persistent drivers around a scene loop;
    // without this currentscene("right") is a no-op, currentview() never reaches
    // the target and the outer while spins to the runaway guard. Arrival scripts
    // (openscene/closescene) stay inert because they don't fire from here.
    const dispatch = async (): Promise<void> => {
      try {
        // caller/target = the loop's own target: a prop loop handler resolved on
        // the shop main dispatches by `target` (TAOOT's fusebox fuseoff/fuseon run
        // loops do propview(target,…)), so it must be the prop name, not a marker.
        await this.session.sendEvent(cmd, target, l.handler, [], target);
      } catch (e) {
        this.session.onLog(`loop ${l.kind}/${l.name}.${l.handler}: ${(e as Error).message}`);
        throw e; // a pass stops on it
      }
    };
    if (l.kind === "scene") await this.withNavDriversArmed(dispatch);
    else await dispatch();
  }

  /** run `fn` with the session's persistent nav drivers armed, restoring the
   *  previous hooks (usually the inert no-ops) afterwards — the save/restore
   *  pair stays symmetric and un-skippable */
  private async withNavDriversArmed(fn: () => Promise<void>): Promise<void> {
    const prev = {
      onNavigate: this.session.onNavigate,
      onSceneJump: this.session.onSceneJump,
      onViewJump: this.session.onViewJump,
      active: this.session.navGestureActive,
      fromScript: this.session.navFromScript,
    };
    this.session.onNavigate = this.session.navDriver;
    this.session.onSceneJump = this.session.sceneJumpDriver;
    this.session.onViewJump = this.session.viewJumpDriver;
    this.session.navGestureActive = true;
    this.session.navFromScript = true;
    try {
      await fn();
    } finally {
      this.session.onNavigate = prev.onNavigate;
      this.session.onSceneJump = prev.onSceneJump;
      this.session.onViewJump = prev.onViewJump;
      this.session.navGestureActive = prev.active;
      this.session.navFromScript = prev.fromScript;
    }
  }
}
