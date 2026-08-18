import { PlayHandle } from "./audio";
import { ENGINE_STEP_MS } from "./clock";
import { bearing } from "./geometry";
import type { GameSession } from "./session";

/** TI.EXE's fixed table sizes for scheduled loops and crickets */
const MAX_LOOPS = 32;
const MAX_CRICKETS = 16;
/** after a long stall (suspended tab) replay at most this many service steps */
const MAX_CATCHUP_STEPS = 64;

/**
 * One scheduled callback (makeloop). TI.EXE semantics: the countdown
 * decrements once per 50 ms service step; at zero the slot REMOVES ITSELF
 * and fires sendto<kind>(name, handler()) once — persistent loops re-arm
 * inside their own handler. Identity is (kind, name): re-making replaces.
 */
export interface GameLoop {
  kind: string;
  name: string;
  handler: string;
  count: number;
  /** re-fire interval in ticks; period 1 = a smooth per-DISPLAY-frame loop */
  period: number;
  paused: boolean;
}

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
}

/**
 * The TI.EXE timing runtime: delay-driven loops (makeloop), positional
 * ambient one-shots (makecricket), sound-loop flags, and straight-line actor
 * walks — all serviced on the 50 ms master heartbeat plus a per-display-frame
 * path for smooth loops. Extracted from GameSession, which delegates to it;
 * cross-cutting session state (clock, audio, actors, dispatch) is reached back
 * through the session reference.
 */
export class Scheduler {
  constructor(private readonly session: GameSession) {}

  readonly loops: GameLoop[] = [];
  readonly crickets: Cricket[] = [];
  private soundLoops = new Map<string, PlayHandle>();
  private timeLastTick = 0;
  // Wall-clock anchor + re-entry guard for the game clock (serviceGameClock).
  private clockLastMs = 0;
  private clockDispatching = false;

  // Per-sound-name volume/pan (0..255), set by soundvol()/soundpan() just
  // before the matching singlesound()/etc. — scripts configure a sound then
  // play it (e.g. windgust: `soundpan(n,..); soundvol(n,..); singlesound(n)`).
  // Applied to the play's gain/pan below; unset names play at full/centre.
  private soundVol = new Map<string, number>();
  private soundPan = new Map<string, number>();
  setSoundVol(name: string, v: number): void {
    this.soundVol.set(name.toLowerCase(), v);
  }
  getSoundVol(name: string): number {
    return this.soundVol.get(name.toLowerCase()) ?? 255;
  }
  setSoundPan(name: string, v: number): void {
    this.soundPan.set(name.toLowerCase(), v);
  }
  getSoundPan(name: string): number {
    return this.soundPan.get(name.toLowerCase()) ?? 128;
  }

  // currentsound(1|2): the name playing on each sound channel. The engine has
  // two SFX channels; scripts always test both (`currentsound(1)=x |
  // currentsound(2)=x`) to ask "is x still playing?". We collapse to two slots:
  // non-overlap plays (singlesound/bothsound) land on channel 1, overlapping
  // ones (multiplesound/dualsound and looped sounds) on channel 2. A slot reads
  // back as its name only while its handle is live.
  private soundChannels: ({ name: string; handle: PlayHandle } | null)[] = [null, null];
  currentSound(channel: number): string {
    const slot = this.soundChannels[channel - 1];
    return slot && !slot.handle.done ? slot.name : "";
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

  /** makeloop: (kind, name) identity — replaces an existing loop */
  makeLoop(kind: string, name: string, handler: string, period: number): void {
    this.stopLoop(kind, name);
    if (this.loops.length >= MAX_LOOPS) {
      this.session.onLog(`makeloop: table full (${MAX_LOOPS}), dropping ${kind}/${name}`);
      return;
    }
    this.loops.push({
      kind: kind.toLowerCase(),
      name: name.toLowerCase(),
      handler: handler.toLowerCase(),
      count: Math.max(1, period),
      period: Math.max(1, period),
      paused: false,
    });
  }

  /**
   * Put a loop slot back EXACTLY as a save recorded it — mid-count, no
   * replacement scan, and above all no RNG: `makeLoop` is for scripts, and a
   * restore that drew from `ambientRng` would shift the ambient stream against
   * a run that never loaded (the same hazard the seeded stream exists for).
   */
  restoreLoop(kind: string, name: string, handler: string, remaining: number): void {
    if (this.loops.length >= MAX_LOOPS) {
      this.session.onLog(`loadgame: loop table full (${MAX_LOOPS}), dropping ${kind}/${name}`);
      return;
    }
    const count = Math.max(1, remaining);
    this.loops.push({
      kind: kind.toLowerCase(),
      name: name.toLowerCase(),
      handler: handler.toLowerCase(),
      count,
      period: count,
      paused: false,
    });
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
      if (l.kind === k && (n === "all" || l.name === n)) l.paused = paused;
    }
  }

  isLoop(kind: string, name: string): boolean {
    const k = kind.toLowerCase();
    const n = name.toLowerCase();
    return this.loops.some((l) => l.kind === k && l.name === n);
  }

  makeCricket(name: string, x: number, y: number, radius: number, base: number, jitter: number): void {
    this.stopCricket(name);
    if (this.crickets.length >= MAX_CRICKETS) {
      this.session.onLog(`makecricket: table full (${MAX_CRICKETS}), dropping ${name}`);
      return;
    }
    this.crickets.push({
      name: name.toLowerCase(),
      x,
      y,
      radius: Math.max(1, radius),
      base,
      jitter,
      count: jitter >= 0 ? base + this.rand(jitter) : base,
      paused: false,
      setName: this.session.currentSetName,
      handle: null,
    });
  }

  /**
   * Put a cricket slot back exactly as a save recorded it: the saved set (a
   * cricket is per-room ambience and must NOT adopt the room the load happens
   * to be leaving), the saved countdown (no `rand(jitter)` re-roll — see
   * {@link restoreLoop} for why a restore must not draw), no sounding handle.
   */
  restoreCricket(name: string, set: string, x: number, y: number, radius: number, base: number, jitter: number, next: number): void {
    if (this.crickets.length >= MAX_CRICKETS) {
      this.session.onLog(`loadgame: cricket table full (${MAX_CRICKETS}), dropping ${name}`);
      return;
    }
    this.crickets.push({
      name: name.toLowerCase(),
      x,
      y,
      radius: Math.max(1, radius),
      base,
      jitter,
      count: next,
      paused: false,
      setName: set.toLowerCase(),
      handle: null,
    });
  }

  stopCricket(name: string): void {
    const n = name.toLowerCase();
    for (let i = this.crickets.length - 1; i >= 0; i--) {
      const c = this.crickets[i];
      if (n === "all" || c.name === n) {
        c.handle?.stop();
        this.crickets.splice(i, 1);
      }
    }
  }

  pauseCricket(name: string, paused: boolean): void {
    const n = name.toLowerCase();
    for (const c of this.crickets) {
      if (n === "all" || c.name === n) c.paused = paused;
    }
  }

  isCricket(name: string): boolean {
    const n = name.toLowerCase();
    return this.crickets.some((c) => c.name === n);
  }

  /** sound names flagged by soundloop(name, true): they LOOP when played */
  readonly loopFlags = new Set<string>();

  /**
   * soundloop(name, on/off): flag a sound as looping — it does NOT play
   * anything itself. Every call in the TAOOT corpus pairs the flag with a play
   * that follows (`soundloop("hissloop", true); singlesound("hissloop")`, or a
   * makecricket for positional ambience); off clears the flag AND stops the
   * loop if it is sounding (its BOMB stage stops its tick with soundloop(off)
   * alone).
   */
  soundLoop(name: string, on: boolean): void {
    const key = name.toLowerCase();
    if (on) {
      this.loopFlags.add(key);
      return;
    }
    this.loopFlags.delete(key);
    this.soundLoops.get(key)?.stop();
    this.soundLoops.delete(key);
  }

  /**
   * Play a named sound on the sound channel, honouring the loop flag.
   * A flagged play loops and is TRACKED, so haltsound()/soundloop(off) can
   * stop it (an untracked looping source would sound forever — TAOOT's
   * gramophone hiss outlived the whole trunk stage). A flagged sound that
   * is already looping is left alone (no double start on re-entry).
   */
  playSound(name: string, overlap: boolean): void {
    const key = name.toLowerCase();
    const audio = this.session.audioLib.sound(key);
    if (!audio) {
      this.session.onLog(`sound not found: ${name} (banks: ${this.session.audioLib.bankNames.join(", ") || "none"})`);
      return;
    }
    // 0..255 → sink units: linear gain (matching themevol), pan centred at 128
    const volume = Math.max(0, Math.min(1, this.getSoundVol(key) / 255));
    const pan = Math.max(-1, Math.min(1, (this.getSoundPan(key) - 128) / 128));
    if (this.loopFlags.has(key)) {
      const existing = this.soundLoops.get(key);
      if (existing && !existing.done) return;
      const handle = this.session.audio.play("sound", audio, { loop: true, overlap: true, volume, pan });
      this.soundLoops.set(key, handle);
      this.soundChannels[1] = { name: key, handle };
      return;
    }
    const handle = this.session.audio.play("sound", audio, { overlap, volume, pan });
    this.soundChannels[overlap ? 1 : 0] = { name: key, handle };
  }

  /** haltsound(n): stop the sound channel INCLUDING tracked looping sounds */
  haltSounds(): void {
    this.session.audio.halt("sound");
    for (const h of this.soundLoops.values()) h.stop();
    this.soundLoops.clear();
  }

  /**
   * Tear down all timed state — loops, crickets, walks, sound loops and their
   * flags — and silence sounds. Used when loading a saved game before the new
   * room's scripts rebuild everything from scratch.
   */
  reset(): void {
    this.loops.length = 0;
    for (const c of this.crickets) c.handle?.stop();
    this.crickets.length = 0;
    this.walks.clear();
    this.loopFlags.clear();
    this.haltSounds();
  }

  // ---- actor walking (walktostar/walktoxyz/walkonpath) --------------------

  /**
   * One straight-line walk per actor (TI.EXE fn 0x443260 record shape:
   * start position, deltas, total distance, facing = bearing to target).
   * Progress advances with the actor's per-set speed each 50 ms service
   * step while the walk pose cycles; on arrival the actor snaps to the
   * target and returns to "stand".
   */
  readonly walks = new Map<
    string,
    {
      sx: number; sy: number; sz: number;
      dx: number; dy: number; dz: number;
      dist: number; progress: number; paused: boolean; arriveStar?: string;
      /** the facing to reach before moving; undefined once the turn is done */
      turnTo?: number;
      /**
       * An authored route instead of a straight line (`walkonpath`): the
       * polyline's points with the cumulative distance to each. `dist` is the
       * whole route's length, so the progress arithmetic below is unchanged —
       * one scalar over the whole path, which is what the data is shaped for
       * (each point stores its distance from the one before, and the container
       * header stores the total).
       */
      path?: { x: number; y: number; z: number; cum: number }[];
      /**
       * A `turntodeg` record: a facing target and NO mover. TI.EXE writes the
       * mode at record +4 and a turn's is 0 where a straight walk's is 1 and
       * `walkonpath`'s is 3, so the mode is what selects the mover — and a turn
       * has none to select. It ends when the facing lands, firing neither
       * `endturn` (whose handlers all gate on `iswalk`, and a turn is not a
       * walk to be posed for) nor `endwalk` (which would re-arm the idle and,
       * for a character on a patrol, re-target them).
       */
      turnOnly?: boolean;
    }
  >();

  /** arriveStar: the walk record's destination name (TI.EXE +0x3e) — what
   *  actorstar() settles on when the walk lands, and what walkdest() answers
   *  while it runs. A walk rides a KIND sentinel meanwhile ("defer" for a named
   *  walk, "walktoxyz" otherwise); the name only becomes visible on arrival. */
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
    // — see the turn phase in serviceWalks and the endturn it ends on.
    this.walks.set(name.toLowerCase(), {
      sx: a.worldX, sy: a.worldY, sz: a.worldZ,
      dx, dy, dz, dist, progress: 0, paused: false, arriveStar,
      turnTo: bearing(dx, dy),
    });
  }

  /**
   * Put a saved walk back in the table, mid-stride — the load's half of the
   * walks service table (see SavedWalk in src/df/savegame.ts).
   *
   * Not expressible as a `startWalk`: that one measures from where the actor is
   * standing NOW and starts the progress at zero, and a walk restored that way
   * would set off from wherever the save happened to catch them with the whole
   * distance still to run. The record carries its own origin and its own
   * progress, so this seeds both.
   *
   * Keyed on the actor's own name rather than their cast member's, which is what
   * `serviceWalks` looks back up — the two differ for an `actorinstance` (the
   * instance shares its source's member object), and the crowd (`ani1a2` and
   * friends) is nothing but instances. The start functions key the same way
   * since #212; they used to file an instance's walk under its SOURCE, so the
   * mover stepped the wrong character and `iswalk(instance)` answered false.
   */
  restoreWalk(
    name: string,
    w: {
      turnOnly?: boolean;
      paused?: boolean;
      turnTo?: number;
      sx: number; sy: number; sz: number;
      dx: number; dy: number; dz: number;
      dist: number; progress: number; arriveStar?: string;
      path?: { x: number; y: number; z: number; cum: number }[];
    },
  ): boolean {
    const key = name.toLowerCase();
    if (!this.session.actorRuntime.get(key)) return false;
    this.walks.set(key, {
      sx: w.sx, sy: w.sy, sz: w.sz,
      dx: w.dx, dy: w.dy, dz: w.dz,
      path: w.path,
      // a turn's distance is never read, but a zero here would make the mover's
      // `progress / dist` a NaN the moment a turn was mistakenly given one
      dist: Math.max(1, w.dist),
      progress: w.progress,
      paused: w.paused ?? false,
      arriveStar: w.arriveStar,
      turnTo: w.turnTo,
      turnOnly: w.turnOnly,
    });
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
   * line instead took Georgia through the second-class stairs and clipped Sasha
   * through the corner of a wall.
   *
   * Modelled as one progress scalar over the whole polyline, because that is what
   * the data is shaped for and what TI.EXE's record says: it keeps the same
   * `progress` field a straight walk uses (+0x16), the path's own container header
   * carries the TOTAL length and every point its distance from the one before, and
   * the opening facing comes from the first two points (`0x444980` reads the path
   * at +0x14 and +0x1c). So no leg re-dispatches `endturn` and only the arrival
   * fires `endwalk` — one walk, as the script asked for.
   */
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
    // it. Snapping here moved them a pass early and, for a `"resume"` walk, to
    // the wrong place entirely: the route's own first point rather than the one
    // resumeFrom had just trimmed it to (#230).
    this.walks.set(name.toLowerCase(), {
      sx: a.worldX, sy: a.worldY, sz: a.worldZ,
      dx: 0, dy: 0, dz: 0,
      dist: Math.max(1, Math.floor(cum)), progress: 0, paused: false, arriveStar,
      turnTo: bearing(second.x - first.x, second.y - first.y),
      path,
    });
  }

  /**
   * `turntodeg`: turn an actor to face a bearing, over time.
   *
   * A turn is a WALK in the original — `0x443550` builds a record in the same
   * table `iswalk` answers from, with the same shape a straight walk gets: the
   * facing target at `+8` (this port's `turnTo`), the actor's current position,
   * and `+0x3e` copied from the actor's CURRENT star (`actor+0x70`), so a turn
   * does not change where anyone is going. Only the mode differs — 0 here
   * against `walkonpath`'s 3.
   *
   * That is load-bearing for conversations, because `walktopuppet` (gang.cst 0001)
   * waits on exactly that:
   *
   *     pauseloop ("actor", who, true)
   *     turntodeg (who, calcdeg (actorxyz (who, 4), cameraxyz (4)))
   *     while iswalk (who)  forceupdate ()  endwhile
   *     runpuppet (pupname, pupmessage)
   *
   * Setting the facing outright — which is what this did — left `iswalk` false,
   * so the wait never spun and `runpuppet` opened in the same breath: Zeitel took
   * your approach in the first-class lounge without ever turning round, and the
   * conversation began with his back to you (#124). 86 calls in the corpus reach
   * here, most of them an idle loop facing the player.
   *
   * A turn to the facing the actor ALREADY has records nothing. That is what keeps
   * the idles convergent: a completed turn fires `endwalk`, whose handlers re-arm
   * the idle (`zeitidle`), which turns again — and the second turn asks for a
   * bearing already held, so it stops there instead of recurring.
   */
  startTurn(name: string, deg: number): void {
    const a = this.session.actorRuntime.get(name);
    if (!a) return;
    const target = deg & 0xff;
    if ((a.deg & 0xff) === target) {
      // nothing to turn: leave any running walk alone and record no turn
      return;
    }
    // A JOURNEY IN PROGRESS keeps it, and the facing is set outright instead.
    //
    // One record per actor is all there is, so recording a turn over a running
    // walk would discard its destination and deltas and strand whoever was
    // walking. The scripted ways in already prevent the combination — the boot's
    // `moveactorstar` runs `stoploop ("actor", target)` before `walktostar`, and
    // `walktopuppet` opens with `pauseloop ("actor", who, true)`, both of which
    // silence the idle that would otherwise turn someone mid-stride — so the
    // original never has to answer this question. Where it does arise (a walk
    // started without stopping the idle first) the old outright set is the
    // conservative answer: it cannot cancel a journey, and no script waits on
    // `iswalk` for a turn issued during a walk.
    if (this.walks.has(name.toLowerCase())) {
      a.deg = target;
      return;
    }
    this.walks.set(name.toLowerCase(), {
      sx: a.worldX, sy: a.worldY, sz: a.worldZ,
      dx: 0, dy: 0, dz: 0,
      // 1, not 0: the mover divides by it. With no deltas the first movement pass
      // after the turn lands on the arrival, which is the point — a turn goes
      // nowhere and ends as soon as the facing does.
      dist: 1, progress: 0, paused: false,
      turnTo: target,
      turnOnly: true,
    });
  }

  /**
   * Step a 0..255 facing toward `target` by at most `by`, the short way round.
   *
   * TI.EXE's `0x445080`, which the walk service calls once per pass with the
   * actor's `actorturn` and a wrap of 0xff: it compares "forwards the long way"
   * against "backwards the short way" and takes the smaller, clamping on the
   * target rather than overshooting it.
   *
   * `by` is floored at 1 so a cast that never ran `stdactor` cannot turn for
   * ever. The original would spin there too — `stdturn` returns 10 for every set
   * in TAOOT and nothing ships a zero — but a walk that never starts is a worse
   * failure here than a character who turns a little faster than asked.
   */
  private stepDeg(cur: number, target: number, by: number): number {
    const step = Math.max(1, Math.abs(Math.trunc(by)));
    const diff = (target - cur) & 0xff;
    if (diff === 0) return target;
    if (diff <= step || 256 - diff <= step) return target;
    return (cur + (diff < 128 ? step : -step)) & 0xff;
  }

  stopWalk(name: string): void {
    const key = name.toLowerCase();
    const a = this.session.actorRuntime.get(key);
    if (this.walks.delete(key) && a && a.poseName === "walk") {
      a.poseName = "stand";
      a.step = 0;
    }
  }

  isWalk(name: string): boolean {
    return this.walks.has(name.toLowerCase());
  }

  /**
   * Is a TURN in flight — for one actor, or for anyone?
   *
   * `iswalk` cannot answer this and does not try to: TI.EXE's (`0x4427e0`) walks
   * its 16-slot table at `0x48b150` in strides of `0x6e` and tests exactly two
   * fields per slot, the occupied flag at `+0` and the actor name at `+0x2e`.
   * Never the mode. So a turning actor reads as walking to every script, which is
   * what `walktopuppet` relies on — and also what makes `if iswalk (me) exitcode`
   * (gang.cst 0442, turkstrs.set 0007) refuse a click at someone mid-turn, in the
   * original as much as here.
   *
   * A player answers that by clicking again. A test driver clicks once, so it
   * needs to know when the sub-second window is open; nothing in the game does.
   */
  turning(name?: string): boolean {
    if (name !== undefined) return !!this.walks.get(name.toLowerCase())?.turnOnly;
    for (const w of this.walks.values()) if (w.turnOnly) return true;
    return false;
  }

  /**
   * Is ANYONE in motion — walking or turning?
   *
   * What a click-refusing guard actually keys off. `if iswalk (me) exitcode`
   * cannot tell a turn from a journey and neither can the driver reading it: the
   * outer `realdist (me) < hotdist ()` and the inner `iswalk` refusal are
   * indistinguishable from outside, which is why the browser route logged "out of
   * reach (hotdist)" for a seaman who was merely mid-stride and then turned the
   * camera to compensate — landing on a different view from the headless golden.
   *
   * Waiting on this instead of on {@link turning} alone is what makes the two
   * hosts click at the same moment: stationary. Nothing in the game asks the
   * question, only the drivers.
   */
  anyoneMoving(): boolean {
    return this.walks.size > 0;
  }

  pauseWalk(name: string, paused: boolean): void {
    const w = this.walks.get(name.toLowerCase());
    if (w) w.paused = paused;
  }

  private serviceWalks(): void {
    const arrived: string[] = [];
    for (const [key, w] of this.walks) {
      if (w.paused) continue;
      const a = this.session.actorRuntime.get(key);
      if (!a) {
        this.walks.delete(key);
        continue;
      }
      // A walk TURNS before it moves, and does not do both in one pass. The
      // record carries a facing target (TI.EXE walk record +8, built at
      // 0x4436d0); while it is set, the service steps the facing by the actor's
      // `actorturn` and returns (0x443cfa), and only once it lands does it
      // dispatch `endturn()` and let the movement passes begin.
      //
      // `stdturn` is 10 for every set in TAOOT, so a half-circle is 128/10 = 13
      // passes — about 0.65 s of standing and turning before anyone sets off.
      //
      // The WALK POSE comes out of that dispatch rather than from here, because
      // it is the cast's to choose and it is not always "walk":
      //
      //     code endturn ()
      //         if iswalk (me)
      //             if mission < 4 | tour
      //                 actorpose (me, "walk")
      //             else
      //                 actorpose (me, "walklj")     ; life jackets, mission 4
      //
      // which the engine setting `poseName = "walk"` could not express at all.
      if (w.turnTo !== undefined) {
        const turned = this.stepDeg(a.deg, w.turnTo, a.turn);
        const done = turned === w.turnTo;
        a.deg = turned;
        if (done && w.turnOnly) {
          // a turn is over when the facing is: no mover, no arrival, no dispatch
          this.walks.delete(key);
          continue;
        }
        if (done) {
          w.turnTo = undefined;
          // Dispatched at once, like the arrival below and like the original:
          // the pose has to be right for the walk the caller is watching, and
          // every `endturn` in the corpus is one `iswalk` test and an
          // `actorpose`.
          void this.session.track(
            this.session.sendEvent("sendtoactor", key, "endturn", [], "walk"),
          );
        }
        continue;
      }
      // One service pass advances the actor's own `actorspeed` in world units —
      // no scaling. Recovered from TI.EXE's straight-line mover (0x443e7c),
      // which is this arithmetic exactly:
      //
      //     [walk+0x16] += actor[0x26]          ; progress += actorspeed
      //     if (dist < progress) progress = dist
      //     pos = start - delta * progress / dist
      //     if (dist <= progress) -> arrival, endwalk()
      //
      // and its pass rate is ours: the master service (0x442550) ends by drawing
      // a frame (0x439b80), which spins until `framerate` ticks have elapsed —
      // 3 ticks by default, the 50 ms this loop already runs at.
      //
      // A ×4 approximation had stood here, so the whole cast moved at four times
      // its scripted pace: Penny crossing the gym in 0.40 s against 1.60 s,
      // Max pacing A-deck in 3.70 s a leg against 14.65 s. (User-reported.)
      w.progress += Math.max(1, a.speed);
      const t = Math.min(1, w.progress / w.dist);
      if (w.path) {
        // Which leg the one progress scalar has reached, and how far along it.
        // The facing is re-aimed per leg rather than only at the start: an
        // authored route turns corners, and holding the opening bearing would
        // walk the whole of Georgia's curve sideways.
        const at = t * w.path[w.path.length - 1].cum;
        let i = 1;
        while (i < w.path.length - 1 && w.path[i].cum < at) i++;
        const from = w.path[i - 1];
        const to = w.path[i];
        const leg = to.cum - from.cum;
        const u = leg > 0 ? Math.min(1, Math.max(0, (at - from.cum) / leg)) : 1;
        a.worldX = Math.round(from.x + (to.x - from.x) * u);
        a.worldY = Math.round(from.y + (to.y - from.y) * u);
        a.worldZ = Math.round(from.z + (to.z - from.z) * u);
        a.deg = bearing(to.x - from.x, to.y - from.y);
      } else {
        a.worldX = Math.round(w.sx + w.dx * t);
        a.worldY = Math.round(w.sy + w.dy * t);
        a.worldZ = Math.round(w.sz + w.dz * t);
      }
      if (t >= 1) {
        this.walks.delete(key);
        if (a.poseName === "walk") {
          a.poseName = "stand";
          a.step = 0;
        }
        if (w.arriveStar !== undefined) a.starName = w.arriveStar;
        arrived.push(key);
      }
    }
    // Fire each arrived actor's endwalk() — the arrival lifecycle handler. NPCs
    // use it to face the player, resume an idle loop, or start the next leg of a
    // patrol; without it walk-driven actors freeze after one leg.
    //
    // Dispatched at once, from inside whatever is running, exactly as TI.EXE's
    // walk service does (0x443de3 sets actorstar and then dispatches). What
    // makes that safe is the arrival STAR, not a rule in here: an engine-driven
    // arrival lands on `"custom"` (see the walktoxyz builtin) and every endwalk
    // in the corpus opens by returning on it, so `walktopuppet`'s approach walk
    // runs no idle and starts no patrol. `"custom"` is compared in 29 script
    // files; the port used to leave the old star in place, and the guard never
    // fired — which is the whole of #10/#19/#21.
    //
    // (Fired after the loop so a new walk it starts doesn't perturb this pass.)
    for (const key of arrived) {
      if (this.session.castScripts.get(key)?.script.codes.has("endwalk")) {
        void this.session.track(this.session.sendEvent("sendtoactor", key, "endwalk", [], "walk"));
      }
    }
  }

  /**
   * Advance game time: resolve delay()s, then run 50 ms service steps —
   * walks, then crickets, then due loops (TI.EXE master service order).
   *
   * The pocketwatch is wound LAST, and that ordering is the whole of a bug that
   * froze every coarse timer loop in the browser.
   *
   * `serviceGameClock` dispatches the boot's clock handler (TAOOT: calctime)
   * through `session.track`,
   * which adds to `inflight` SYNCHRONOUSLY while the promise settles in a
   * microtask. Run it first and `serviceStep` — same task, microtasks not yet
   * drained — sees `scriptBusy` true because of the dispatch the scheduler itself
   * started microseconds earlier, and `fireDueLoops` skips firing. Since
   * CALCTIME_MS and ENGINE_STEP_MS are both 50, the two are phase-locked: the
   * heartbeat poisons its own service pass, on most passes.
   *
   * What that looks like from outside is a game where input works and time does
   * not (TAOOT). The inventory bag sets `lightopen` and arms `makeloop("prop",
   * me, "doinven", 6)`; the flat opens from the LOOP, so the bag simply never
   * opens and further clicks are ignored by design (`bagidle()` is false
   * meanwhile). BEDSIT1's air raid never comes. And it reads as intermittent,
   * because whether
   * the clock dispatches on a given pass depends on phase. Measured on a run that
   * froze: the loop was seen due 569 times and fired 0.
   *
   * It also hides from every obvious check. Sample `scriptBusy` from outside the
   * tick — a test, a devtools expression — and it is false, because by then the
   * microtask has run and `inflight` is empty. It is only ever true at the one
   * moment that matters.
   */
  tickTime(now: number): void {
    this.session.clock.advance(now);
    if (!this.timeLastTick) this.timeLastTick = now;
    let steps = Math.floor((now - this.timeLastTick) / ENGINE_STEP_MS);
    if (steps > 0) {
      this.timeLastTick += steps * ENGINE_STEP_MS;
      // after a long stall (suspended tab) don't replay the whole gap
      if (steps > MAX_CATCHUP_STEPS) steps = MAX_CATCHUP_STEPS;
      for (let s = 0; s < steps; s++) this.serviceStep();
    }
    // last, so its dispatch cannot be in flight while this pass fires its loops.
    // By the next pass the microtask has settled and inflight is empty again.
    this.serviceGameClock(now);
  }

  /**
   * Drive the game clock — the real engine's boot `idle()` ran its clock
   * handler every event-loop pass, and TAOOT's `calctime` advances one
   * game-second every 20 calls (BOOTFILE 0002:40). So ~20 calls per real second
   * makes its menu-band pocketwatch's second-hand tick once per real second,
   * and (mission 4) progresses the sinking countdown through `advancephase()`.
   *
   * Runs on BOTH hosts, off whatever `now` the host feeds `tickTime` — wall time
   * in a browser, the pumped virtual clock headless. It used to be gated on
   * `hasRealFrames` for fear that an auto-advancing clock would fire the
   * mission-4 sinkmovie/death chain mid-run, and the gate cost more than it
   * bought: TAOOT's `calctime` is where `sinkflag` turns into `advancephase()`,
   * so headless the sinking never started at all and the mission-4 goldens were
   * traces of a ship that isn't sinking. `clock` kept the pending event name the
   * save restored ("startdisk1") because nothing ever overwrote it with the
   * BOOTFILE's `clock = hrs * 100 + min`.
   *
   * The fear was misplaced on its own terms. Outside mission 4 `sinkflag` is
   * false, and calctime's not-sinking arm only winds `clockcount`/`sec` and the
   * pocketwatch's `propdeg` — no phase, no script dispatch, nothing a test can
   * see beyond the second hand. Inside mission 4 the chain is the level.
   *
   * We skip while a script is mid-flight (movie, conversation, walk) — the
   * original idle() likewise only ran between events — and resync the anchor so
   * a long pause (or a suspended tab) doesn't replay as a burst of ticks.
   */
  private serviceGameClock(now: number): void {
    if (this.session.scriptBusy || this.clockDispatching || !this.clockLastMs) {
      this.clockLastMs = now;
      return;
    }
    const CALCTIME_MS = 50; // 20 calls / real second -> 1 second-hand tick / sec
    let calls = Math.floor((now - this.clockLastMs) / CALCTIME_MS);
    if (calls <= 0) return;
    this.clockLastMs += calls * CALCTIME_MS;
    if (calls > 20) calls = 20; // cap a stall's catch-up to one game-second
    this.clockDispatching = true;
    // trackIdle, not track: the heartbeat must not read as a busy player script
    // or the input queue drops what was posted while it settles (see session.ts)
    this.session.trackIdle(
      (async () => {
        try {
          for (let i = 0; i < calls; i++) await this.session.runGlobal("calctime");
        } finally {
          this.clockDispatching = false;
        }
      })(),
    );
  }

  private serviceStep(): void {
    this.serviceWalks();
    this.silenceAbsentCrickets();
    for (let i = this.crickets.length - 1; i >= 0; i--) {
      const c = this.crickets[i];
      if (c.paused) continue;
      if (c.count > 0) c.count--;
      if (c.count > 0) continue;
      if (c.setName && c.setName !== this.session.currentSetName) continue;
      if (c.handle && !c.handle.done) continue; // previous play still sounding
      this.fireCricket(c);
      if (c.jitter < 0) this.crickets.splice(i, 1);
      else c.count = c.base + this.rand(c.jitter);
    }
    // Coarse timer loops (period >= 2) fire on the 50 ms master service.
    // Smooth per-frame loops (period 1) are serviced separately at the DISPLAY
    // frame rate (serviceFrameLoops) so animation-rate loops — the bridge's
    // sky drift, the fencer's idle/parry pose — actually run at frame rate in
    // the browser rather than crawling at the 20 Hz service rate. (Headless has one frame per
    // tick, so both paths fire once per tick and tests are unaffected.)
    this.fireDueLoops((l) => l.period > 1);
    // Last, where the master service ends: TI.EXE's pass finishes by drawing a
    // frame (0x442550 -> 0x439b80), and the actor animation advances at the head
    // of that draw. Deliberately NOT in serviceFrameLoops — that path runs at the
    // browser's display rate, and a walk cycle is paced by the 50 ms pass in the
    // original, not by how fast the host can paint.
    this.session.actorRuntime.advanceAnimation();
  }

  /**
   * Fire due period-1 (per-display-frame) loops. Called once per rendered
   * frame from the viewer — ~60 Hz in the browser, once per tick headless.
   */
  serviceFrameLoops(): void {
    this.fireDueLoops((l) => l.period <= 1);
  }

  /**
   * Fire period-1 loops from within a forceupdate() cooperative yield, so a
   * long-running drag/animation loop (the bridge wheel's stilldown loop) still
   * lets independent per-frame loops (the sky drift) advance while it runs —
   * otherwise the drag holds scriptBusy and the sky freezes until release.
   * Excludes the caller's OWN loop so a handler can't re-enter itself mid-swing
   * (the fencer's attack sets its player-prop pose in a forceupdate loop and
   * must not trip that same prop's idle/defend loop). Called only in the
   * browser (real frames); headless forceupdate keeps its deterministic step.
   */
  pumpFrameLoops(exceptName: string): void {
    const ex = String(exceptName).toLowerCase();
    // NOT gated on scriptBusy: the caller IS the busy script, yielding a frame
    this.fireLoops((l) => l.period <= 1 && l.name !== ex);
  }

  /**
   * Service the matching timer loops: count them down, then fire the ones that
   * have come due.
   *
   * The countdown runs whether or not a script is in flight — only the FIRING
   * waits, because the original engine is single-threaded and its service
   * likewise never re-enters a running script. That distinction is the whole
   * point of this method: skipping the DECREMENT while busy made every scripted
   * delay in the game run slow, and by a lot. Measured in a browser: TAOOT
   * BEDSIT1's air raid arms `makeloop("scene", "scene1", "gotoship", 320)` — 320 × 50 ms,
   * so ~21 s from the sirens to the bomb — and it took 49 s. The heartbeat was
   * fine at 15.1 steps/s; what went missing was 29 service passes a second,
   * thrown away as "busy" and never counted. The pocketwatch is what makes them
   * busy: serviceGameClock dispatches calctime 20 times a second through
   * session.track, and suppressing it took the skipped passes to exactly zero.
   *
   * So a loop that comes due mid-script now sits at 0 and fires on the next
   * free pass, instead of losing that tick outright.
   */
  private fireDueLoops(select: (l: GameLoop) => boolean): void {
    const matched = this.loops.filter((l) => !l.paused && select(l));
    for (const l of matched) if (l.count > 0) l.count--;
    if (this.session.scriptBusy) return; // due loops wait at 0; they don't lose the tick
    this.fireNow(matched.filter((l) => l.count <= 0));
  }

  /** decrement the countdown of every matching loop and fire the ones that
   *  reach zero, script in flight or not — the forceupdate() pump (see
   *  {@link pumpFrameLoops}), whose caller IS the busy script */
  private fireLoops(select: (l: GameLoop) => boolean): void {
    this.fireNow(this.loops.filter((l) => !l.paused && select(l) && --l.count <= 0));
  }

  /** fire due loops one at a time; they remove themselves first, and a
   *  persistent one re-arms in its own handler (TI.EXE semantics, see GameLoop) */
  private fireNow(due: GameLoop[]): void {
    if (!due.length) return;
    this.session.track(
      (async () => {
        for (const l of due) {
          // Take each loop out of the table IMMEDIATELY BEFORE running it, not
          // the whole batch up front, and skip one that is no longer there.
          //
          // TI.EXE services the table slot by slot (0x442ae0 per slot): it clears
          // the slot, runs that handler to completion, and only then looks at the
          // next slot. So a handler that `makeloop`s over a LATER slot — makeloop
          // removes the (kind, name) match before appending, 0x4426e0 — means that
          // slot is simply never serviced this pass.
          //
          // Pre-splicing the batch inverts that, and it is a softlock in the London
          // flat (#74). BEDSIT1 Scene3 runs `sfx` on ("scene", "scene3") every 2
          // passes, re-arming itself at the top of its own handler, and the air
          // raid's `gotoship` arms `gotowin` on that SAME (kind, name) via the
          // scene's openscene. Both come due on one pass, and with the batch
          // already spliced out:
          //
          //   gotoship -> openscene -> makeloop(scene, scene3, gotowin, 10)
          //                            (finds no sfx to replace: already spliced)
          //   sfx      -> makeloop(scene, scene3, sfx, 2)
          //                            (replaces gotowin, which never fires)
          //
          // so the sirens play over a room that never turns you to the window.
          // Serviced in table order, `gotowin` replaces the sfx entry that is still
          // in the table and sfx is skipped, which is what the original does.
          // Measured from the reporter's standpoint, Scene3/View22: gotowin fires
          // 10 passes after openscene and the raid ends in bombit.
          const i = this.loops.indexOf(l);
          if (i < 0) continue;
          this.loops.splice(i, 1);
          await this.fireLoop(l);
        }
      })(),
    );
  }

  /**
   * Silence any cricket whose set is not the one on screen.
   *
   * A `soundloop`-flagged cricket starts once and then loops in place forever
   * (see fireCricket) — that is how a set runs positional ambience, and nothing
   * in the TAOOT corpus ever stops one: `stopcricket("all")` appears exactly
   * once, in its BOOTFILE `initall`. So every path that leaves a set WITHOUT
   * initall left its ambience sounding, positioned in a world that is no longer
   * on screen.
   *
   * TAOOT's `advanceday` endgame arm is that path: it calls `closesetfile()` and
   * goes straight into the flats, so the boat deck's five `party` crowd loops
   * (EXTRA.CST `crowdcrickets`, one per lifeboat star) talked through leave.mov,
   * debris.mov, the closing narration and prozac.mov. Measured in
   * tests/browser/endgame.ts: `crickets=[party1..party5]` on every sample from
   * the deck to the credits, with `cricket.sfx` already closed — they could no
   * longer re-fire, they simply never stopped. The re-fire guard below has
   * always skipped them; only the audio was missing from it.
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
  silenceAbsentCrickets(): void {
    for (const c of this.crickets) {
      if (!c.handle || !c.setName || c.setName === this.session.currentSetName) continue;
      c.handle.stop();
      c.handle = null;
    }
  }

  private fireCricket(c: Cricket): void {
    const audio = this.session.audioLib.sound(c.name);
    if (!audio) return;
    let volume = 1;
    let pan = 0;
    const lis = this.session.listener();
    if (lis) {
      const dx = c.x - lis.x;
      const dy = c.y - lis.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= c.radius) return; // out of earshot (counts as fired)
      // linear falloff (exact TI curve unrecovered); pan = sine of the
      // bearing relative to the camera facing, same convention as the
      // projection's lateral axis (positive = right of screen)
      volume = 1 - dist / c.radius;
      if (dist > 1) {
        const th = ((lis.deg & 0xff) / 256) * 2 * Math.PI;
        const lateral = dy * Math.cos(th) - dx * Math.sin(th);
        pan = Math.max(-1, Math.min(1, lateral / dist));
      }
    }
    // a soundloop-flagged cricket starts once and keeps looping in place
    // (handle.done stays false, so the re-fire check never triggers again) —
    // this is how sets run positional ambience: soundloop("motor", true)
    // + makecricket("motor", ...) on TAOOT's deckbd
    c.handle = this.session.audio.play("sound", audio, {
      overlap: true, volume, pan, loop: this.loopFlags.has(c.name),
    });
    // A cricket is an overlapping play, so it occupies sound channel 2 — and it
    // has to SAY so, because currentsound() is the only way a script can tell
    // whether one has finished. TAOOT's bedsit landlady is a chain of crickets
    // sequenced entirely by that question: lady() re-arms itself every few
    // ticks and starts the next line only `if currentsound(1) = curlady |
    // currentsound(2) = curlady` is false. Firing without recording the name
    // left both channels reading empty, so the gate never held and all five of
    // her lines started 1.3 s apart over each other.
    this.soundChannels[1] = { name: c.name, handle: c.handle };
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
    const target = l.kind === "flat" ? this.session.currentFlat : l.name;
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
