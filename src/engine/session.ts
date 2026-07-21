import { readContainerFile } from "../df/container";
import { SetFile, readSetFile } from "../df/set";
import { StgFile, StgRegion, readStgFile, readStgRegions } from "../df/stg";
import { FrameBuffer, decodeFrame, paletteToRGBA } from "../df/image";
import { readShpFile } from "../df/shp";
import { sniffScript } from "../df/script";
import { parseScript } from "./parser";
import { readCstFile } from "../df/cst";
import { PupAnimFrame, PupFile, readAnimLogic, readPupFile } from "../df/pup";
import { decodeAudioContainer } from "../df/audio";
import { Interpreter, ScriptInstance, Value, registerCoreBuiltins, toStr } from "./interp";
import { ActorRuntime } from "./actors";
import { PropRuntime } from "./props";
import { AudioLibrary, AudioSink, NullAudioSink, PlayHandle } from "./audio";
import { FileProvider, registerGameBuiltins } from "./setscripts";

/**
 * Stages whose entry handler lives on the FLAT (not the stage main), mirroring
 * the per-stage switch in the boot's transtoflat(): opening the stage file must
 * then call this handler on the current flat. blkjack deals the first hand;
 * fight starts the brawl. (Stage-main setup uses the open<basename> convention
 * handled separately in openStageFile.)
 */
const STAGE_FLAT_ENTRY: Record<string, string> = {
  "blkjack.stg": "initgame",
  "fight.stg": "openfight",
};

/**
 * Canonical basename for a stage's entry/exit handlers + its shop. Usually just
 * the filename stem (wireless.stg → "wireless" → openwireless/closewireless,
 * wireless.shp/hidewireless). The exception is the darkroom: BOTH photo.stg and
 * redphoto.stg (white-light and red-light views of the same room) reuse
 * photo.shp and the openphoto/closephoto/hidephoto/showphoto handlers — the
 * boot's transtoflat/transfromflat switch routes both there — so redphoto maps
 * to "photo".
 */
function stageBase(stageName: string): string {
  const base = stageName.replace(/\.stg$/, "");
  return base === "redphoto" ? "photo" : base;
}

/**
 * Game time. TI.EXE runs scripts against timeGetTime with 1 script tick =
 * 1/60 s (delay(n) waits n×50/3 ms) and services ambient loops/crickets on
 * a 66 ms (~15 Hz) heartbeat. The viewer feeds real/virtual time into
 * advance(); delay() suspends scripts on sleep().
 */
export class Clock {
  now = 0;
  private waiters: { at: number; resolve: () => void }[] = [];

  sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ at: this.now + ms, resolve }));
  }

  advance(now: number): void {
    if (now <= this.now) return;
    this.now = now;
    if (!this.waiters.length) return;
    const due = this.waiters.filter((w) => w.at <= now);
    this.waiters = this.waiters.filter((w) => w.at > now);
    for (const w of due) w.resolve();
  }
}

/**
 * One scheduled callback (makeloop). TI.EXE semantics: the countdown
 * decrements once per 66 ms service step; at zero the slot REMOVES ITSELF
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
 * Game-wide state that outlives individual sets: one interpreter (globals
 * persist across rooms), the boot script (the game's standard library of
 * ~65 helpers — changeset, progress, spotmovie, ...), the master stage
 * script (MAIN.STG — gotospecial etc.), audio banks and props.
 *
 * Set switching bottoms out here: boot's `changeset` calls the engine
 * primitives `opensetfile(name, scene, view)` / `closesetfile()`, which are
 * builtins registered by the host (SetScripts wires them to onSetChange).
 */
export class GameSession {
  readonly interp = new Interpreter();
  readonly audioLib = new AudioLibrary();
  readonly propRuntime = new PropRuntime();
  readonly actorRuntime = new ActorRuntime();

  /**
   * BOOTFILE script containers, in order. Container 1 holds the startup +
   * key-routing script, container 2 the standard library AND the default
   * event handlers (its keydown implements walking/turning via the
   * currentscene() setter). They stay separate: events traverse them in
   * order, and both are unqualified-call fallbacks.
   */
  bootScripts: ScriptInstance[] = [];
  stage: ScriptInstance | null = null;

  get boot(): ScriptInstance | null {
    return this.bootScripts[0] ?? null;
  }
  currentSetName = "none";
  /**
   * Vertical world→screen projection bias set by the `camerahi` script command
   * (TI.EXE global 0x48a792, subtracted from a point's height in fn 0x43a970:
   * `dyHeight = ptY - camHeight - camerahi`). BOOTFILE `adjustcamera()`, run
   * from `openset`, sets it per set — nonzero ONLY for the A-deck halls
   * (halla 139, hallc 80, halld 150), 0 everywhere else. Without it those
   * halls' world sprites (Sasha/Alex) float above the floor; every other set
   * already grounds because the bias is 0. Applied as `cam.z + cameraHiBias`
   * in the viewer's camera builder (raising the eye drops the feet on screen).
   */
  cameraHiBias = 0;
  /** the active set's script binding (SetScripts) — set by its constructor */
  currentBinding: import("./setscripts").SetScripts | null = null;
  builtinsRegistered = false;

  onLog: (line: string) => void = () => {};
  /**
   * host hook: make a game file available before the (synchronous) provider
   * reads it — the browser fetches on demand and returns null on the first
   * miss, so on-demand loaders (puppets, casts, movies) await this first.
   * No-op in tests, where every file is present synchronously.
   */
  ensureFile: (name: string) => Promise<void> = () => Promise.resolve();
  /** host hook: actually load + display a set (async in the browser) */
  onSetChange: (fileName: string, sceneName: string, viewName: string) => void | Promise<void> =
    () => {};
  /** host hooks for currentscene()/currentview() queries */
  currentSceneName: () => string = () => "";
  currentViewName: () => string = () => "";
  /**
   * hittest(point): what's under a screen pixel — the object NAME and its
   * result() TYPE ("actor"/"scene"/"painting"/"button"/"flat", "" for nothing).
   * The viewer wires this to its click-resolution geometry. Used by the
   * inventory "use item" flow (INVEN.SHP: thename = hittest(arg); switch
   * result() → sendto<type>(thename, offerobject(what))).
   */
  hitTestAt: (x: number, y: number) => { name: string; type: string } = () => ({
    name: "",
    type: "",
  });
  /** the type from the most recent hittest(), returned by result() */
  lastResult = "";
  /** facing direction of the current view (radians), for arrival continuity */
  currentRotation: (() => number) | null = null;
  /** facing carried across a set change; the next viewer consumes it */
  lastRotation: number | null = null;

  /**
   * Screen fade (screentoblack/blacktoscreen around gotospecial): 0 = clear,
   * 1 = black. Lives on the session — the viewer is rebuilt mid-transition.
   * While fading OUT the pre-transition frame stays visible via `snapshot`.
   */
  fade = {
    level: 0,
    lastTick: 0,
    queue: [] as { to: number; steps: number }[],
    snapshot: null as { rgba: Uint8ClampedArray; width: number; height: number } | null,
  };
  /** host hook: snapshot the currently displayed frame for fade-outs */
  captureFrame: (() => { rgba: Uint8ClampedArray; width: number; height: number } | null) | null =
    null;

  get fading(): boolean {
    return this.fade.queue.length > 0;
  }

  /** advance the fade one 66 ms engine step at a time */
  tickFade(now: number): void {
    const f = this.fade;
    if (!f.queue.length) {
      f.lastTick = 0;
      return;
    }
    const STEP_MS = 66;
    if (!f.lastTick) f.lastTick = now - STEP_MS;
    while (f.queue.length && now - f.lastTick >= STEP_MS) {
      f.lastTick += STEP_MS;
      const ramp = f.queue[0];
      if (ramp.to === 0) f.snapshot = null; // fading back in reveals the live frame
      const delta = 1 / ramp.steps;
      f.level =
        ramp.to > f.level
          ? Math.min(ramp.to, f.level + delta)
          : Math.max(ramp.to, f.level - delta);
      if (f.level === ramp.to) f.queue.shift();
    }
  }

  constructor(
    readonly files: FileProvider = () => null,
    readonly audio: AudioSink = new NullAudioSink(),
  ) {
    registerCoreBuiltins(this.interp);
    registerGameBuiltins(this);
    this.interp.realYieldSeq = () => this.realYieldSeq;
  }

  /**
   * Real event-loop yield hook + counter. forceupdate()/stilldown() call
   * nextFrame() to render a frame and pump input, then bump realYieldSeq; the
   * interpreter's while-guard uses the counter to spare interactive loops. In
   * the browser main.ts points nextFrame at requestAnimationFrame; the default
   * resolves immediately (headless / tests advance the clock manually).
   */
  nextFrame: () => Promise<void> = () => Promise.resolve();
  /**
   * True once the host wires nextFrame to real rendered frames (rAF). Only
   * then do forceupdate/stilldown bump realYieldSeq: in a browser an
   * interactive poll loop genuinely waits on the user, so the while-guard must
   * not trip it. Headless (tests) keeps this false — there forceupdate
   * free-runs (it advances its own clock and nextFrame resolves immediately),
   * so a stuck loop MUST still hit the 100k guard instead of hanging forever.
   */
  hasRealFrames = false;
  realYieldSeq = 0;

  // ---- timing runtime (delay / makeloop / makecricket / soundloop) --------

  readonly clock = new Clock();
  readonly loops: GameLoop[] = [];
  readonly crickets: Cricket[] = [];
  private soundLoops = new Map<string, PlayHandle>();
  /** host hook: listener (camera) ground position + facing for crickets */
  listener: () => { x: number; y: number; deg: number } | null = () => null;
  private timeLastTick = 0;

  /** scripts currently executing/suspended (delay) — input waits on these */
  private inflight = new Set<Promise<unknown>>();

  /** run a script dispatch in the background, tracked for busy/settle */
  track<T>(p: Promise<T>): Promise<T> {
    this.inflight.add(p);
    void p.catch((e) => this.onLog(`script error: ${(e as Error).message}`)).then(() => {
      this.inflight.delete(p);
    });
    return p;
  }

  get scriptBusy(): boolean {
    return this.inflight.size > 0;
  }

  /** wait until all in-flight script dispatches finish (tests, shutdown) */
  async settle(maxRounds = 1000): Promise<void> {
    for (let i = 0; i < maxRounds && this.inflight.size; i++) {
      await Promise.allSettled([...this.inflight]);
    }
  }

  /** DreamFactory random(n) = 1..n (0 for n <= 0) */
  private rand(n: number): number {
    return n > 0 ? Math.floor(Math.random() * n) + 1 : 0;
  }

  /** makeloop: (kind, name) identity — replaces an existing loop */
  makeLoop(kind: string, name: string, handler: string, period: number): void {
    this.stopLoop(kind, name);
    if (this.loops.length >= 32) {
      this.onLog(`makeloop: table full (32), dropping ${kind}/${name}`);
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
    if (this.crickets.length >= 16) {
      this.onLog(`makecricket: table full (16), dropping ${name}`);
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
      setName: this.currentSetName,
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
   * anything itself. Every corpus call pairs the flag with a play that
   * follows (`soundloop("hissloop", true); singlesound("hissloop")`, or a
   * makecricket for positional ambience); off clears the flag AND stops the
   * loop if it is sounding (BOMB stops its tick with soundloop(off) alone).
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
   * stop it (an untracked looping source would sound forever — the
   * gramophone hiss outliving the whole trunk stage). A flagged sound that
   * is already looping is left alone (no double start on re-entry).
   */
  playSound(name: string, overlap: boolean): void {
    const key = name.toLowerCase();
    const audio = this.audioLib.sound(key);
    if (!audio) {
      this.onLog(`sound not found: ${name} (banks: ${this.audioLib.bankNames.join(", ") || "none"})`);
      return;
    }
    if (this.loopFlags.has(key)) {
      const existing = this.soundLoops.get(key);
      if (existing && !existing.done) return;
      this.soundLoops.set(key, this.audio.play("sound", audio, { loop: true, overlap: true }));
      return;
    }
    this.audio.play("sound", audio, { overlap });
  }

  /** haltsound(n): stop the sound channel INCLUDING tracked looping sounds */
  haltSounds(): void {
    this.audio.halt("sound");
    for (const h of this.soundLoops.values()) h.stop();
    this.soundLoops.clear();
  }

  /** silence every ambient sound (set change cleans its crickets itself) */
  stopAllAmbient(): void {
    for (const h of this.soundLoops.values()) h.stop();
    this.soundLoops.clear();
  }

  // ---- actor walking (walktostar/walktoxyz/walkonpath) --------------------

  /**
   * One straight-line walk per actor (TI.EXE fn 0x443260 record shape:
   * start position, deltas, total distance, facing = bearing to target).
   * Progress advances with the actor's per-set speed each 66 ms service
   * step while the walk pose cycles; on arrival the actor snaps to the
   * target and returns to "stand".
   */
  readonly walks = new Map<
    string,
    { sx: number; sy: number; sz: number; dx: number; dy: number; dz: number; dist: number; progress: number; paused: boolean; arriveStar?: string }
  >();

  /** arriveStar: the value actorstar() should report once the walk lands
   *  (walkonpath rides the "walkonpath" sentinel while moving, then settles
   *  on the destination star so pacing loops can tell where the actor is). */
  startWalk(name: string, tx: number, ty: number, tz: number, arriveStar?: string): void {
    const a = this.actorRuntime.get(name);
    if (!a) return;
    const dx = tx - a.worldX;
    const dy = ty - a.worldY;
    const dz = tz - a.worldZ;
    const dist = Math.max(1, Math.round(Math.hypot(dx, dy, dz)));
    a.deg = Math.round((Math.atan2(dy, dx) * 256) / (2 * Math.PI)) & 0xff;
    if (a.member.poses.some((p) => p.name === "walk")) {
      a.poseName = "walk";
      a.step = 0;
    }
    this.walks.set(a.member.name, {
      sx: a.worldX, sy: a.worldY, sz: a.worldZ,
      dx, dy, dz, dist, progress: 0, paused: false, arriveStar,
    });
  }

  stopWalk(name: string): void {
    const key = name.toLowerCase();
    const a = this.actorRuntime.get(key);
    if (this.walks.delete(key) && a && a.poseName === "walk") {
      a.poseName = "stand";
      a.step = 0;
    }
  }

  isWalk(name: string): boolean {
    return this.walks.has(name.toLowerCase());
  }

  pauseWalk(name: string, paused: boolean): void {
    const w = this.walks.get(name.toLowerCase());
    if (w) w.paused = paused;
  }

  private serviceWalks(): void {
    const arrived: string[] = [];
    for (const [key, w] of this.walks) {
      if (w.paused) continue;
      const a = this.actorRuntime.get(key);
      if (!a) {
        this.walks.delete(key);
        continue;
      }
      // units per 66 ms step: actorspeed × 4 — APPROXIMATION (the exact
      // TI stepping lives in fn 0x443730's per-type movers; stdspeed is
      // per-set, so this constant only tunes overall walking pace)
      w.progress += Math.max(1, a.speed) * 4;
      const t = Math.min(1, w.progress / w.dist);
      a.worldX = Math.round(w.sx + w.dx * t);
      a.worldY = Math.round(w.sy + w.dy * t);
      a.worldZ = Math.round(w.sz + w.dz * t);
      a.step++; // walk pose cycle advances per service tick
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
    // fire each arrived actor's endwalk() — the arrival lifecycle handler.
    // NPCs use it to face the player, resume an idle loop, or start the next
    // leg of a patrol; without it walk-driven actors freeze after one leg.
    // (Fired after the loop so a new walk it starts doesn't perturb this pass.)
    for (const key of arrived) {
      if (this.castScripts.get(key)?.script.codes.has("endwalk")) {
        void this.track(this.sendEvent("sendtoactor", key, "endwalk", [], "walk"));
      }
    }
  }

  /**
   * Advance game time: resolve delay()s, then run 66 ms service steps —
   * walks, then crickets, then due loops (TI.EXE master service order).
   */
  tickTime(now: number): void {
    this.clock.advance(now);
    const STEP_MS = 66;
    if (!this.timeLastTick) this.timeLastTick = now;
    let steps = Math.floor((now - this.timeLastTick) / STEP_MS);
    if (steps <= 0) return;
    this.timeLastTick += steps * STEP_MS;
    // after a long stall (suspended tab) don't replay the whole gap
    if (steps > 64) steps = 64;
    for (let s = 0; s < steps; s++) this.serviceStep();
  }

  private serviceStep(): void {
    this.serviceWalks();
    for (let i = this.crickets.length - 1; i >= 0; i--) {
      const c = this.crickets[i];
      if (c.paused) continue;
      if (c.count > 0) c.count--;
      if (c.count > 0) continue;
      if (c.setName && c.setName !== this.currentSetName) continue;
      if (c.handle && !c.handle.done) continue; // previous play still sounding
      this.fireCricket(c);
      if (c.jitter < 0) this.crickets.splice(i, 1);
      else c.count = c.base + this.rand(c.jitter);
    }
    // Coarse timer loops (period >= 2) fire on the 66 ms master service.
    // Smooth per-frame loops (period 1) are serviced separately at the DISPLAY
    // frame rate (serviceFrameLoops) so animation-rate loops — the bridge's
    // sky drift, the fencer's idle/parry pose — actually run at frame rate in
    // the browser rather than crawling at 15 Hz. (Headless has one frame per
    // tick, so both paths fire once per tick and tests are unaffected.)
    this.fireDueLoops((l) => l.period > 1);
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
    const due = this.loops.filter(
      (l) => !l.paused && l.period <= 1 && l.name !== ex && --l.count <= 0,
    );
    if (!due.length) return;
    for (const l of due) this.loops.splice(this.loops.indexOf(l), 1);
    this.track(
      (async () => {
        for (const l of due) await this.fireLoop(l);
      })(),
    );
  }

  /** loops fire one at a time and never re-enter a running script (the
   * original engine is single-threaded; its service is likewise guarded) */
  private fireDueLoops(select: (l: GameLoop) => boolean): void {
    if (this.scriptBusy) return;
    const due = this.loops.filter((l) => !l.paused && select(l) && --l.count <= 0);
    if (!due.length) return;
    for (const l of due) this.loops.splice(this.loops.indexOf(l), 1);
    this.track(
      (async () => {
        for (const l of due) await this.fireLoop(l);
      })(),
    );
  }

  private fireCricket(c: Cricket): void {
    const audio = this.audioLib.sound(c.name);
    if (!audio) return;
    let volume = 1;
    let pan = 0;
    const lis = this.listener();
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
    // this is how the sets run positional ambience: soundloop("motor", true)
    // + makecricket("motor", ...) on deckbd
    c.handle = this.audio.play("sound", audio, {
      overlap: true, volume, pan, loop: this.loopFlags.has(c.name),
    });
  }

  private async fireLoop(l: GameLoop): Promise<void> {
    const cmd =
      { actor: "sendtoactor", prop: "sendtoprop", scene: "sendtoscene", flat: "sendtoflat" }[
        l.kind
      ] ?? "sendtoprop";
    // A "flat" loop belongs to the ONE active overlay flat, so fire it on the
    // current flat rather than the captured name. blackjack's gameover() does
    // makeloop("flat", me, "newgame", 45), but when the hand ends from a click
    // in a flat REGION (hit/stay), `me` is that region's name, not the flat —
    // sendtoflat(region) wouldn't resolve newgame and the play-again prompt
    // never fired. (For the deal-triggered gameover, me already IS the flat.)
    const target = l.kind === "flat" ? this.currentFlat : l.name;
    try {
      // caller/target = the loop's own target: a prop loop handler resolved on
      // the shop main dispatches by `target` (the fusebox's fuseoff/fuseon run
      // loops do propview(target,…)), so it must be the prop name, not a marker.
      await this.sendEvent(cmd, target, l.handler, [], target);
    } catch (e) {
      this.onLog(`loop ${l.kind}/${l.name}.${l.handler}: ${(e as Error).message}`);
    }
  }

  /**
   * sendto* resolution + containment-chain forwarding, shared by the
   * sendto special forms and loop firing. Events sent to a scene forward
   * along scene → set main → stage when unhandled/passed (or when the
   * scene has no script at all).
   */
  async sendEvent(
    cmd: string,
    targetName: string,
    handler: string,
    args: Value[],
    callerName: string,
  ): Promise<Value> {
    let inst =
      this.currentBinding?.findInstance(targetName) ?? this.findGlobalInstance(targetName);
    if (!inst && cmd === "sendtostage") inst = this.stage;
    if (!inst && cmd === "sendtoboot") inst = this.boot;
    // a flat is contained in its stage: an event to a flat with no own script
    // (fencing's per-flat click regions carry the scripts, not the flat itself)
    // resolves on the stage main, where handlers like pointgoesto()/centerstage()
    // /setupsmallprops live. (findInstance already returns the flat's own script
    // when one exists, so this fallback only fires when it doesn't.)
    if (!inst && cmd === "sendtoflat") inst = this.stage;
    // a prop with no script of its own (a fuse in the fusebox bank) resolves on
    // its owning shop's main, where the shared handler dispatches by `target`
    // (fuseoff/fuseon do propview(target,…)). Mirrors the viewer's prop-click
    // dispatch so prop RUN LOOPS — makeloop("prop", name, handler) — resolve too;
    // without it a scriptless prop's loop fired into nothing (fuse never settled).
    if (!inst && cmd === "sendtoprop") {
      const pi = this.propRuntime.get(targetName);
      if (pi) inst = this.shopMain(pi.shop.name);
    }
    const chain = inst ? [inst] : [];
    if (cmd === "sendtoscene" || cmd === "sendtoset") {
      const main = this.currentBinding?.main;
      if (main && main !== inst) chain.push(main);
      if (this.stage && this.stage !== inst) chain.push(this.stage);
    }
    if (!chain.length) {
      this.onLog(`${cmd}("${targetName}", ${handler}(..)) — target not loaded`);
      return 0;
    }
    let value: Value = 0;
    let ran = false;
    // For sendtoactor the event TARGET is the actor itself: the boot lifecycle
    // helpers read `target` (putdownactor -> actorvisible(target,false)), and
    // the cast walktopuppet does `who = target`. Everywhere else `target` is the
    // caller-supplied context (region/prop name for the shop-main dispatchers).
    const evTarget = cmd === "sendtoactor" ? targetName : callerName;
    for (const link of chain) {
      if (!link.script.codes.has(handler)) continue;
      ran = true;
      const res = await this.interp.runHandler(link, handler, args, {
        me: link.name,
        target: evTarget,
      });
      value = res.value;
      if (this.interp.eventConsumed || (res.handled && !res.passed)) break;
    }
    // the target resolves missing handlers through its CONTAINMENT chain
    // (prop -> shop main, where initprop() lives; then the stage), with
    // me = the target. Deliberately NOT the boot scripts in general: boot1's
    // keydown routes events via sendtoscene, so resolving a scene's missing
    // keydown back into boot would recurse forever (TURK scene134 has a
    // script without keydown — user-reported OOM). EXCEPTION: actor-lifecycle
    // helpers (putdownactor/moveactorstar/moveactorxyz) live in the BOOTFILE and
    // are dispatched via sendtoactor(name, putdownactor()); most casts don't
    // override them, so an actor's putdownactor must reach the boot fallback —
    // without it the officer/Sasha never hid ("actor doesn't leave"). Scoped to
    // sendtoactor so the keydown/scene recursion above is unaffected.
    if (!ran && inst) {
      const libs: ScriptInstance[] = [];
      for (let p = inst.parent; p; p = p.parent) libs.push(p);
      if (this.stage && this.stage !== inst) libs.push(this.stage);
      if (cmd === "sendtoactor") for (const b of this.bootScripts) if (!libs.includes(b)) libs.push(b);
      for (const lib of libs) {
        if (!lib.script.codes.has(handler)) continue;
        value = (
          await this.interp.runHandler(lib, handler, args, { me: inst.name, target: evTarget })
        ).value;
        break;
      }
    }
    return value;
  }

  /** parse a script container into an instance bound to `owner` */
  instanceFrom(data: Uint8Array | undefined, owner: string): ScriptInstance | null {
    if (!data) return null;
    const tokens = sniffScript(data);
    if (!tokens) return null;
    try {
      return new ScriptInstance(owner, parseScript(tokens));
    } catch (e) {
      this.onLog(`parse error in ${owner}: ${(e as Error).message}`);
      return null;
    }
  }

  /** load BOOTFILE and the MAIN.STG stage if available */
  async loadCoreScripts(): Promise<void> {
    const boot = this.files("bootfile");
    if (boot && !this.bootScripts.length) {
      try {
        const file = readContainerFile(boot);
        for (let i = 1; i < file.containers.length; i++) {
          const inst = this.instanceFrom(file.containers[i].data, `boot${i}`);
          if (inst) this.bootScripts.push(inst);
        }
        this.onLog(
          `boot scripts loaded (${this.bootScripts.map((b) => b.script.codes.size).join("+")} handlers)`,
        );
      } catch (e) {
        this.onLog(`bootfile: ${(e as Error).message}`);
      }
    }
    this.refreshFallbacks();
    // boot()'s variable initialization — scripts test these with != ""
    // and text-compares would treat the uninitialized 0 as "0"
    if (!this.interp.globals.has("handitem")) {
      for (const [k, v] of [
        ["handitem", ""], ["savestage1", ""], ["savestage2", ""], ["savestage3", ""],
        ["saveflat1", ""], ["saveflat2", ""], ["saveflat3", ""],
        ["jumpset", ""], ["playerdeath", ""], ["loopsound", ""], ["seldir", "north"],
        ["twocount", 1], ["threecount", 1], ["fourcount", 1], ["fivecount", 1],
        // music (theme) starts very quiet by default — the ambient themes at
        // full volume (the boot's 255) are wearing over a long session; the
        // player raises it with the CTL.STG theme lever. wavevolume (SFX/voice)
        // stays at full. The theme lever's rest position is synced to this
        // below so the panel doesn't show a high lever over quiet music.
        ["themevolume", 24],
      ] as [string, Value][]) {
        this.interp.globals.set(k, v);
      }
    }
    await this.loadBootResources();
    // the boot script opens the standard in-game stage at startup and
    // initializes the inventory + interface props
    await this.openStageFile("main.stg");
    const inven = this.shopMain("inven.shp");
    if (inven?.script.codes.has("initprops") && !this.interp.globals.has("__propsinit")) {
      this.interp.globals.set("__propsinit", 1);
      try {
        await this.interp.runHandler(inven, "initprops", [], { me: "inven.shp", target: "" });
      } catch (e) {
        this.onLog(`initprops: ${(e as Error).message}`);
      }
    }
    // Sync the theme lever's rest position to our low default themevolume
    // (house.shp openshop hardcodes deg 5 = loud; CTL.STG's slider maps
    // themevolume = 8·x, deg = x/6, so deg = themevolume/48). Without this the
    // panel would show the lever near the top over deliberately quiet music.
    const lever = this.propRuntime.get("themetoggle");
    if (lever) {
      const vol = Number(this.interp.globals.get("themevolume") ?? 0);
      lever.deg = Math.max(0, Math.min(5, Math.floor(vol / 8 / 6)));
    }
  }

  // ---- stage layer (STG flats) -------------------------------------------

  stageFile: StgFile | null = null;
  stageName = "none";
  /** flat script instances of the current stage, by lowercase flat name */
  readonly flatScripts = new Map<string, ScriptInstance>();
  flatNames: string[] = [];
  currentFlat = "none";
  /** whether the set view draws over the flat (setvisible builtin) */
  setVisible = true;
  /** name of the looping theme currently playing (currenttheme getter) */
  currentThemeName = "none";
  /**
   * TI.EXE puppet render params by slot (puppetparam builtin). Slot 7 is the
   * subtitles-enabled flag (the CTL.STG subtoggle lever), defaulting to ON.
   */
  readonly puppetParams = new Map<number, number>([[7, 1]]);
  /** subtitles-enabled (puppetparam slot 7); the viewer gates subtitle text on it */
  subtitlesOn(): boolean {
    return (this.puppetParams.get(7) ?? 1) !== 0;
  }
  /**
   * wave (sampled-audio) master volume, 0..9 — the CTL.STG settings dial reads
   * back wavevolume() and writes it live. Drives the sound + voice channels'
   * master gain. Music is separate (global themevolume + themevol). Default 9
   * (full) matches the sink's unity channel gain.
   */
  waveVolume = 9;
  /** framerate() target cadence; drag loops save/drop/restore it (turbine dials) */
  frameRate = 3;

  // ---- persistent text layer (drawstring/stringwidth builtins) ------------
  /** text drawn by drawstring(), composited over the screen after props.
   *  DreamFactory draws into a persistent buffer; we recomposite each frame,
   *  so we keep the drawn strings and re-apply them. Later draws at the same
   *  (x,y,size) replace earlier ones (CTL redraws its direction letters every
   *  update(); wireless writes each morse glyph at a fresh x). Cleared on flat
   *  change and by clearmessagebox() (see the messageboxclear hook). */
  readonly textOverlay: { text: string; x: number; y: number; color: number; size: number }[] = [];
  /** measure a drawstring in device pixels using the render font; set by the
   *  viewer so stringwidth() matches what actually paints. null in headless
   *  tests, where stringwidth() falls back to a fixed-pitch estimate. */
  measureText: ((text: string, size: number) => number) | null = null;
  clearTextOverlay(): void {
    this.textOverlay.length = 0;
  }

  // ---- pointer state (mouse()/button()/pointx/pointy builtins) ------------
  /** last pointer position in 512×384 screen space; scripts read it via mouse() */
  pointerX = 0;
  pointerY = 0;
  /** whether a mouse button is currently held (button() builtin) */
  pointerDown = false;

  /** update the cursor position scripts see (called by the viewer on move/click) */
  setPointer(x: number, y: number): void {
    this.pointerX = x;
    this.pointerY = y;
  }

  /** the pointer as the engine's packed point: (x<<16)|y, 16-bit halves */
  pointerPoint(): number {
    return ((this.pointerX & 0xffff) << 16) | (this.pointerY & 0xffff);
  }
  private flatImageCache = new Map<
    string,
    { pixels: Uint8Array; width: number; height: number; palette: Uint8ClampedArray }
  >();

  private refreshFallbacks(): void {
    this.interp.fallbackScripts = [this.stage, ...this.bootScripts].filter(
      (x): x is ScriptInstance => !!x,
    );
  }

  /** engine primitive: load an STG stage and activate its first flat */
  async openStageFile(fileName: string): Promise<boolean> {
    const key = toStr(fileName).toLowerCase();
    if (this.stageName === key) return true;
    if (this.stageFile) await this.closeStageFile();
    // a fresh stage starts un-dimmed: clear any leftover stage CLUT dim so the
    // darkroom's mixclut("stage") (re-applied right after this in transtoflat)
    // doesn't bleed into the next stage you open (e.g. after leaving redphoto).
    this.onClut("stage", null);
    await this.ensureFile(key); // lazy browser provider: fetch before first read
    const data = this.files(key);
    if (!data) {
      this.onLog(`openstagefile: "${fileName}" not available`);
      return false;
    }
    let stg: StgFile;
    try {
      stg = readStgFile(data);
    } catch (e) {
      this.onLog(`openstagefile: ${fileName}: ${(e as Error).message}`);
      return false;
    }
    this.stageFile = stg;
    this.stageName = key;
    this.stage = this.instanceFrom(stg.file.containers[1]?.data, key);
    this.refreshFallbacks();
    for (const f of stg.flats) {
      const inst = this.instanceFrom(stg.file.containers[f.locationScript]?.data, f.name);
      if (inst) this.flatScripts.set(f.name.toLowerCase(), inst);
      this.flatNames.push(f.name);
    }
    this.onLog(`stage loaded: ${key} (${stg.flats.length} flat(s))`);
    this.currentFlat = "none";
    // the stage's openstage handler runs first (the map pages to the player's
    // current deck via gotopage(currentpage()) there); if it didn't pick a
    // flat, fall back to the first one
    if (this.stage?.script.codes.has("openstage")) {
      try {
        await this.interp.runHandler(this.stage, "openstage", [], { me: key, target: "" });
      } catch (e) {
        this.onLog(`${key}.openstage: ${(e as Error).message}`);
      }
    }
    if (this.currentFlat === "none" && stg.flats.length) await this.gotoFlat(stg.flats[0].name);
    // The boot's transtoflat() dispatches a per-stage entry handler after
    // opening the file: sendtostage(open<basename>()) — e.g. openwireless()
    // opens the stage's shop + track and sets up its props. We mirror that
    // dispatch generically (the map uses openstage instead, so this only
    // fires when a matching handler exists).
    const entry = `open${stageBase(key)}`;
    if (entry !== "openstage" && this.stage?.script.codes.has(entry)) {
      try {
        await this.interp.runHandler(this.stage, entry, [], { me: key, target: "" });
      } catch (e) {
        this.onLog(`${key}.${entry}: ${(e as Error).message}`);
      }
    }
    // The boot's transtoflat() ALSO runs a per-stage FLAT entry handler for a
    // few stages (BOOTFILE transtoflat switch): blkjack deals the opening hand
    // via sendtoflat(currentflat(), initgame()), fight starts via openfight().
    // Unlike the open<basename> setup above these live on the FLAT, not the
    // stage main — without mirroring them, entering blkjack.stg from the Buick
    // conversation opened the table but never dealt a hand.
    const flatEntry = STAGE_FLAT_ENTRY[key];
    if (flatEntry) await this.fireFlat(this.currentFlat, flatEntry);
    // The boot's transtoflat() also darkens the darkroom on entry
    // (`case "redphoto.stg": mixclut("stage","black",0,255,245)`): with the
    // white light off it's black until you switch on the red safelight (the
    // switch toggles the stage CLUT itself). Handling photos is gated on the
    // safelight being on, so this darkness is the cue to find the switch. Mirror
    // that one entry effect (openphoto has already set whitelight + props).
    if (
      key === "redphoto.stg" &&
      toStr(this.interp.globals.get("whitelight") ?? 0) === "off" &&
      !this.propRuntime.get("redlamp")?.visible
    ) {
      this.onClut("stage", { lo: 0, hi: 255, amt: 245 });
    }
    return true;
  }

  /** engine primitive: close the current stage (closestagefile) */
  async closeStageFile(): Promise<void> {
    // mirror the per-stage entry dispatch: close<basename>() tears down the
    // stage's shop + track (e.g. closewireless -> closeshopfile/closetrackfile)
    const exit = `close${stageBase(this.stageName)}`;
    if (exit !== "closestage" && this.stage?.script.codes.has(exit)) {
      try {
        await this.interp.runHandler(this.stage, exit, [], { me: this.stageName, target: "" });
      } catch (e) {
        this.onLog(`${this.stageName}.${exit}: ${(e as Error).message}`);
      }
    }
    if (this.stage?.script.codes.has("closestage")) {
      try {
        await this.interp.runHandler(this.stage, "closestage", [], {
          me: this.stageName,
          target: "",
        });
      } catch (e) {
        this.onLog(`${this.stageName}.closestage: ${(e as Error).message}`);
      }
    }
    await this.fireFlat(this.currentFlat, "closeflat");
    this.currentFlat = "none";
    this.stageFile = null;
    this.stageName = "none";
    this.stage = null;
    this.flatScripts.clear();
    this.flatNames = [];
    this.flatImageCache.clear();
    this.regionCache.clear();
    this.refreshFallbacks();
  }

  /** resolve a flat reference — a name ("Map 3") or a 1-based index (3) */
  private resolveFlat(ref: string): string {
    const byName = this.flatNames.find((f) => f.toLowerCase() === ref.toLowerCase());
    if (byName) return byName;
    const idx = Number(ref);
    if (Number.isInteger(idx) && idx >= 1 && idx <= this.flatNames.length) {
      return this.flatNames[idx - 1];
    }
    return ref;
  }

  /** 1-based index of a flat (flattoindex builtin), 0 when unknown */
  flatToIndex(ref: string): number {
    const name = this.resolveFlat(ref);
    return this.flatNames.findIndex((f) => f.toLowerCase() === name.toLowerCase()) + 1;
  }

  /** engine primitive: switch the active flat (gotoflat) — by name or index */
  async gotoFlat(name: string): Promise<void> {
    const target = this.resolveFlat(toStr(name));
    await this.fireFlat(this.currentFlat, "closeflat");
    this.currentFlat = target;
    this.clearTextOverlay(); // a new flat starts with a blank text layer
    await this.fireFlat(target, "openflat");
  }

  /**
   * Stack of stages an overlay was opened OVER (transtoflat), restored in
   * reverse by transfromflat — mirrors the boot's savestage1..3/saveflat1..3.
   * Each frame remembers the stage, its active flat, and the ambient theme so a
   * nested overlay — the inventory bag (inven1.stg) opened MID-puzzle to swap an
   * item — returns to the exact prior screen (the opened matryoshka on "patty 3")
   * instead of re-initialising the puzzle to its first flat. A single string
   * couldn't express the patty.stg → inven1.stg → patty.stg nesting.
   */
  private stageStack: { name: string; flat: string; theme: string }[] = [];

  /**
   * Save + hide the underlying stage's props before an overlay covers it (the
   * boot's transtoflat calls sendtoshop(hide<stage>()) here). Each puzzle shop
   * stashes its prop visibility (patty.shp hidepatty -> saveprops1) so the
   * matching show<stage> can restore it after the overlay closes. main.stg is
   * special: its band lives on house.shp via hide/showinterface.
   */
  private async saveStageProps(stageName: string): Promise<void> {
    if (!stageName || stageName === "none") return;
    if (stageName === "main.stg") {
      await this.sendEvent("sendtoshop", "house.shp", "hideinterface", [], "transtoflat");
      return;
    }
    const base = stageBase(stageName);
    if (this.shopMain(`${base}.shp`)?.script.codes.has(`hide${base}`)) {
      await this.sendEvent("sendtoshop", `${base}.shp`, `hide${base}`, [], "transtoflat");
    }
  }

  /** restore what saveStageProps hid, once the previous stage is re-open */
  private async restoreStageProps(stageName: string): Promise<void> {
    if (!stageName || stageName === "none") return;
    if (stageName === "main.stg") {
      await this.sendEvent("sendtoshop", "house.shp", "showinterface", [], "transfromflat");
      return;
    }
    const base = stageBase(stageName);
    if (this.shopMain(`${base}.shp`)?.script.codes.has(`show${base}`)) {
      await this.sendEvent("sendtoshop", `${base}.shp`, `show${base}`, [], "transfromflat");
    }
  }

  /**
   * transtoflat: open a stage full-screen (e.g. the deck map) over the game,
   * remembering the stage it replaced so transfromflat can restore it.
   */
  async transToFlat(fileName: string): Promise<void> {
    // Save + hide the underlying stage's props (the boot's transtoflat does
    // sendtoshop(hide<stage>()) before closing), then push it — with its active
    // flat and ambient theme — so transfromflat returns to the exact prior
    // screen. Overlay stages don't go through changeset, so setupsound never
    // runs for them; fencing's openstage does playnewtheme("fence.trk"), and the
    // remembered theme lets transfromflat restore the room's ambient after.
    await this.saveStageProps(this.stageName);
    this.stageStack.push({
      name: this.stageName,
      flat: this.currentFlat,
      theme: this.currentThemeName,
    });
    // Entering an overlay presents fresh content, so lift any leftover
    // transition-black from the previous screen. HOUSE fades the blackjack
    // dealer puppet out — screentoblack("puppet") — and THEN transtoflat()s to
    // the game; the reveal is a wipe visualeffect we render as instant, so
    // without this the game table stayed black. The flat's own openstage may
    // re-establish a fade (bomb: blackscreen + intro movie), which still runs
    // after this because openStageFile fires the openstage lifecycle.
    this.fade.level = 0;
    this.fade.queue.length = 0;
    this.fade.snapshot = null;
    if (await this.openStageFile(fileName)) {
      this.setVisible = false;
      // Mirror the boot's transtoflat (BOOTFILE 0002:1418): a flat opened while a
      // conversation is live hides the puppet close-up, so the flat shows and its
      // own input loop takes the clicks (the purser "check in" hand-select runs
      // inven.shp's handleselect() over inven1.stg; blackjack reveals the table).
      // transFromFlat restores it. Without this the puppet stayed drawn on top and
      // ate every click — you could open the inventory but never hand an item over.
      if (this.puppet) this.puppet.visible = false;
    }
  }

  /**
   * transfromflat: leave the overlay stage and restore the in-game stage. The
   * boot's full version does this via restorescreen(); we mirror its essential
   * step — completing a pending map jump by changeset()-ing to the destination
   * the red-area click stashed in jumpset/jumpscene/jumpview.
   */
  async transFromFlat(): Promise<void> {
    const frame = this.stageStack.pop();
    const prev = frame?.name ?? "none";
    // The set shows through only under main.stg's in-game band or when no stage
    // remains; every other stage is a full-screen overlay that must keep the set
    // hidden. Returning from the inventory bag to the matryoshka (patty.stg) is
    // an overlay-over-overlay, so setVisible stays false — otherwise the A14 room
    // rendered behind the doll-tray flat (the overlap the swap showed).
    this.setVisible = prev === "none" || prev === "" || prev === "main.stg";
    if (prev && prev !== "none") {
      // Re-open the underlying stage (the boot re-runs openstagefile too), then
      // restore its saved flat and prop visibility so a mid-puzzle overlay comes
      // back to the exact screen it left — the opened matryoshka, not "patty 1".
      if (prev !== this.stageName) {
        await this.openStageFile(prev);
        if (frame && frame.flat && frame.flat !== "none") await this.gotoFlat(frame.flat);
      }
      await this.restoreStageProps(prev);
    } else {
      await this.closeStageFile();
    }
    // Mirror restorescreen (BOOTFILE 0002:1650): returning to the in-game main
    // stage with a conversation still loaded brings the puppet back — the purser
    // resumes after the inventory hand-select so you can pick the "check <item>"
    // bevel that actually gifts it. Only for main.stg (the boot gates on the same
    // condition), so an overlay-over-overlay return doesn't flash the puppet.
    if (this.puppet && this.setVisible && this.stageName === "main.stg") {
      this.puppet.visible = true;
    }
    // restore the ambient theme if the overlay stage replaced it with its own
    // (fence.trk). Only when it actually changed, so closing a themeless overlay
    // (the deck map) doesn't restart the room's music. If the prior bank is gone
    // just stop the overlay theme — better silence than the wrong track leaking.
    const savedTheme = frame?.theme ?? "none";
    if (this.currentThemeName !== savedTheme) {
      const theme = savedTheme !== "none" && savedTheme !== "" ? this.audioLib.theme(savedTheme) : null;
      if (theme) {
        this.audio.play("theme", theme, { loop: true });
        this.currentThemeName = savedTheme;
      } else {
        this.audio.halt("theme");
        this.currentThemeName = "none";
      }
    }
    const jumpset = toStr(this.interp.globals.get("jumpset") ?? "");
    if (jumpset) {
      const jumpscene = toStr(this.interp.globals.get("jumpscene") ?? "");
      const jumpview = toStr(this.interp.globals.get("jumpview") ?? "");
      this.interp.globals.set("jumpset", "");
      await this.runGlobal("changeset", [jumpset, jumpscene, jumpview]);
    }
  }

  /** clickable regions of the current flat (parsed from its click-logic), cached */
  private regionCache = new Map<string, StgRegion[]>();

  /** clickable regions of an arbitrary flat by name (current flat included) */
  private regionsFor(flatName: string): StgRegion[] {
    const stg = this.stageFile;
    if (!stg || flatName === "none") return [];
    const key = `${this.stageName}:${flatName}`;
    let regs = this.regionCache.get(key);
    if (!regs) {
      const flat = stg.flats.find((f) => f.name.toLowerCase() === flatName.toLowerCase());
      const data = flat && stg.file.containers[flat.locationClickLogic]?.data;
      regs = data ? readStgRegions(data) : [];
      this.regionCache.set(key, regs);
    }
    return regs;
  }

  currentFlatRegions(): StgRegion[] {
    return this.regionsFor(this.currentFlat);
  }

  /** a flat's named clickable region (the stage "button" system), or null */
  flatRegion(flatName: string, name: string): StgRegion | null {
    const lower = name.toLowerCase();
    return this.regionsFor(flatName).find((r) => r.name.toLowerCase() === lower) ?? null;
  }

  /**
   * Dispatch a deferred handler (mousedown/setcursor/…) to a flat's named
   * region — the "button" system stage mini-games use via sendtobutton. Like
   * a click on that region (stageClickAt), but invoked by name from a script
   * rather than resolved from a cursor position.
   */
  async sendToButton(
    flatName: string,
    regionName: string,
    handler: string,
    args: Value[],
    callerName: string,
  ): Promise<Value> {
    const stg = this.stageFile;
    if (!stg) return 0;
    const region = this.flatRegion(flatName, regionName);
    if (!region) {
      this.onLog(`sendtobutton: no region "${regionName}" in flat ${flatName}`);
      return 0;
    }
    const inst = this.instanceFrom(stg.file.containers[region.script]?.data, region.name || "region");
    if (!inst || !inst.script.codes.has(handler)) return 0;
    inst.parent = this.flatScripts.get(this.currentFlat.toLowerCase()) ?? this.stage;
    const res = await this.interp.runHandler(inst, handler, args, {
      me: region.name,
      target: callerName,
    });
    return res.value;
  }

  /**
   * Route a click on a full-screen overlay stage (the deck map) to the region
   * it lands in: hit-test the current flat's click-logic rects (Y-first) and
   * run that region's mousedown script — gotopage(n) for the deck buttons,
   * exitmap for OK, jumpbaby(...) for the red areas. Returns true if handled.
   */
  async stageClickAt(x: number, y: number): Promise<boolean> {
    const stg = this.stageFile;
    if (!stg) return false;
    const hit = this.currentFlatRegions().find(
      (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
    );
    if (!hit) return false;
    const region = this.instanceFrom(stg.file.containers[hit.script]?.data, hit.name || "region");
    // A region with no backing script is a bare hotspot. Two things may still
    // want the click: the flat/stage main can DISPATCH it by target (the
    // fusebox's fuse regions carry no script of their own — the FUSE.STG main
    // switches that fuse light->off keyed on `target`), and the prop beneath
    // handles the rest (its shop main does the off->on half). Run the stage-main
    // dispatch here, then fall through (return false) so propAt runs too. The
    // handlers switch on target, so a stage whose main doesn't know this hotspot
    // (the gramophone's horn/wax drop-zones) no-ops and the drag prop still gets it.
    if (!region) {
      const flat0 = this.flatScripts.get(this.currentFlat.toLowerCase());
      this.setPointer(x, y);
      for (const link of [flat0, this.stage]) {
        if (!link || !link.script.codes.has("mousedown")) continue;
        try {
          await this.interp.runHandler(link, "mousedown", [hit.name], { me: link.name, target: hit.name });
        } catch (e) {
          this.onLog(`stage hotspot ${hit.name}: ${(e as Error).message}`);
        }
      }
      return false;
    }
    // The region HAS its own script — but a visible prop with its own mousedown
    // script is a foreground sprite drawn ON TOP of the flat art, so when one
    // covers this point it owns the click and the region beneath it must not
    // steal it. The matryoshka (patty.stg): the doll prop overlaps the doll1/dial
    // hotspots that revealed it, so every "open a layer" click on the doll's left
    // half was being swallowed by those regions (the doll only ever closed).
    // Defer to the prop path (return false → the viewer's propAt dispatch runs).
    // Only applies to scripted regions: scriptless fusebox fuses (handled above)
    // cooperate with their prop and must not be diverted.
    const over = this.propRuntime.propAt(x, y, null, false);
    if (over && this.propScripts.get(over.group.name.toLowerCase())?.script.codes.has("mousedown")) {
      return false;
    }
    // resolve unqualified calls through the current FLAT script first (it
    // defines jumpbaby for the map's red areas), which chains to the stage main
    const flat = this.flatScripts.get(this.currentFlat.toLowerCase());
    region.parent = flat ?? this.stage;
    this.setPointer(x, y);
    this.interp.eventConsumed = false;
    // region → flat → stage main, with target = the region name: a button
    // region may only set the cursor and leave the mousedown to the stage main,
    // keyed by target (trunk's gramdrawerbut -> sendtoprop(gramdrawer, open())).
    const chain: ScriptInstance[] = [];
    for (const link of [region, flat, this.stage]) {
      if (link && !chain.includes(link)) chain.push(link);
    }
    for (const link of chain) {
      if (!link.script.codes.has("mousedown")) continue;
      try {
        const res = await this.interp.runHandler(link, "mousedown", [hit.name], {
          me: link.name,
          target: hit.name,
        });
        if (this.interp.eventConsumed || (res.handled && !res.passed)) break;
      } catch (e) {
        this.onLog(`stage region ${hit.name}: ${(e as Error).message}`);
        break;
      }
    }
    return true;
  }

  /** the script that should receive a keyboard event on an overlay stage:
   *  the current flat if it defines keydown (wireless TX lives in the flat),
   *  else the stage main (the deck map's keydown lives there). */
  keydownTarget(): ScriptInstance | null {
    const flat = this.flatScripts.get(this.currentFlat.toLowerCase());
    if (flat?.script.codes.has("keydown")) return flat;
    if (this.stage?.script.codes.has("keydown")) return this.stage;
    return null;
  }

  private async fireFlat(name: string, handler: string): Promise<void> {
    const inst = this.flatScripts.get(name.toLowerCase());
    if (!inst || !inst.script.codes.has(handler)) return;
    try {
      await this.interp.runHandler(inst, handler, [], { me: inst.name, target: "" });
    } catch (e) {
      this.onLog(`${name}.${handler}: ${(e as Error).message}`);
    }
  }

  /** decoded image of the active flat (background layer), cached */
  flatImage(): { pixels: Uint8Array; width: number; height: number; palette: Uint8ClampedArray } | null {
    const stg = this.stageFile;
    if (!stg || this.currentFlat === "none") return null;
    const key = `${this.stageName}:${this.currentFlat}`;
    let img = this.flatImageCache.get(key);
    if (!img) {
      const flat = stg.flats.find((f) => f.name === this.currentFlat);
      if (!flat) return null;
      try {
        const fb = new FrameBuffer();
        const d = decodeFrame(stg.file.containers[flat.locationFrame], fb);
        img = {
          pixels: fb.pixels.slice(0, d.width * d.height),
          width: d.width,
          height: d.height,
          palette: paletteToRGBA(stg.paletteRaw, 256),
        };
        this.flatImageCache.set(key, img);
      } catch (e) {
        this.onLog(`flat image ${key}: ${(e as Error).message}`);
        return null;
      }
    }
    return img;
  }

  /** host hook: default navigation from boot's keydown (currentscene setter) */
  onNavigate: (direction: string) => void = () => {};
  /**
   * host hook: playmovie builtin. Returns a promise that resolves when the
   * whole movie (including any chained sub-movies) finishes, so the script
   * BLOCKS on playmovie the way TI.EXE's modal movie loop does — essential for
   * interactive movies (the purser window: knock -> lid opens -> only then does
   * the script read actionframe() and open the conversation). Headless / the
   * default no-op resolve at once (movies don't render in tests).
   */
  onPlayMovie: (fileName: string, startFrame?: number) => void | Promise<void> = () => {};

  /**
   * Action-frame indices the currently/most-recently played movie reached — the
   * nonzero `action` field of every frame the movie passed through. Cleared at
   * the start of each top-level playmovie and accumulated across a chain; the
   * `actionframe(n)` opcode queries membership. (The purser's knock frame sets 1.)
   */
  movieActions = new Set<number>();

  /**
   * host hook: clut/mixclut palette effect. `dim` null restores the target's
   * normal palette (clut(target)); a spec darkens entries lo..hi toward black
   * by amt/255 (mixclut(target,"black",lo,hi,amt)). Targets: "set", "stage",
   * "current". The viewer rebuilds the rendered CLUT. (Darkroom light switch.)
   */
  onClut: (target: string, dim: { lo: number; hi: number; amt: number } | null) => void = () => {};

  /**
   * Invoke a globally-callable handler (stage/boot standard library) the way
   * unqualified script calls resolve — first fallback script that defines it.
   */
  async runGlobal(handler: string, args: Value[] = []): Promise<Value> {
    for (const inst of this.interp.fallbackScripts) {
      if (inst.script.codes.has(handler)) {
        return (await this.interp.runHandler(inst, handler, args, { me: inst.name, target: "" }))
          .value;
      }
    }
    this.onLog(`runGlobal: no handler "${handler}"`);
    return 0;
  }

  /**
   * Canonical name of the set being opened = the FILE basename. The
   * internal setName field can differ (DECKBD.SET says "decka"), but
   * scripts bind actors/props/crickets to the name they opened.
   */
  currentSetFile = "";

  /** engine primitive behind boot's changeset(): switch to another set */
  async openSetFile(fileName: string, sceneName = "", viewName = ""): Promise<void> {
    const key = fileName.toLowerCase();
    this.onLog(`opensetfile("${key}", "${sceneName}", "${viewName}")`);
    this.lastRotation = this.currentRotation ? this.currentRotation() : null;
    this.currentSetFile = key.replace(/\.set$/, "");
    await this.onSetChange(key, sceneName.toLowerCase(), viewName.toLowerCase());
  }

  /** try to parse a set through the provider (null if not available yet) */
  loadSet(fileName: string): SetFile | null {
    const data = this.files(fileName.toLowerCase());
    if (!data) return null;
    try {
      return readSetFile(data);
    } catch (e) {
      this.onLog(`${fileName}: ${(e as Error).message}`);
      return null;
    }
  }

  async openTrackFile(fileName: string): Promise<boolean> {
    const key = toStr(fileName).toLowerCase();
    // Theme tracks are named by DECK, not by set — recept1c's theme is
    // deckd.trk, halla's is decka.trk (see BOOTFILE setupsound/themetype).
    // The set-change prefetch only pulls <setName>.trk, so the real theme
    // bank is usually absent here. Fetch it on demand (browser provider),
    // exactly as opensetfile/puppets/casts do — otherwise playnewtheme finds
    // no theme and the room is silent (or the wrong theme keeps playing).
    await this.ensureFile(key);
    const data = this.files(key);
    if (!data) {
      this.onLog(`opentrackfile: "${fileName}" not available`);
      return false;
    }
    return this.audioLib.openBank(key, data);
  }

  /** prop-group script instances of loaded shops, by lowercase prop name */
  readonly propScripts = new Map<string, ScriptInstance>();
  private shopMains = new Map<string, ScriptInstance | null>();

  /** per-character script instances of loaded casts, by actor name */
  readonly castScripts = new Map<string, ScriptInstance>();
  private castMains = new Map<string, ScriptInstance | null>();

  /** main script of a loaded cast (sendtocast target), by file name */
  castMain(name: string): ScriptInstance | null {
    return this.castMains.get(name.toLowerCase()) ?? null;
  }

  // ---- puppet mode (PUP conversation close-ups) ---------------------------

  /**
   * Active conversation. While set, the viewer renders the puppet screen
   * (stance layers + subtitle + choice bevels) instead of the world.
   * puppetspeak() suspends the running script for the line's duration;
   * puppetevent() suspends until the player clicks a bevel.
   */
  puppet: {
    name: string;
    pup: PupFile;
    scripts: Map<string, ScriptInstance>;
    stanceIdx: number;
    /**
     * puppetvisible: whether the conversation close-up is drawn. A puppet stays
     * LOADED (so its scripts keep running) while hidden — blackjack hides the
     * dealer with puppetvisible(false) to reveal the table during a hand, then
     * puppetvisible(true) to bring Buick back for the "play again?" prompt.
     */
    visible: boolean;
    subtitle: string;
    bevels: { text: string; id: number }[];
    /** puppetevent resolver — a bevel click ends the wait */
    eventWaiter: ((id: number) => void) | null;
    /** click-to-skip resolver for the line currently being spoken */
    speakSkip: (() => void) | null;
    /** animLogic playback of the line being spoken (~30 records/s) */
    anim: { frames: PupAnimFrame[]; start: number } | null;
    /** layer state held between lines (the last played record) */
    pose: PupAnimFrame | null;
    /** the neutral opening pose (puppetbase("") reverts to it) */
    defaultPose: PupAnimFrame | null;
  } | null = null;

  async openPuppetFile(fileName: string): Promise<boolean> {
    const key = toStr(fileName).toLowerCase();
    await this.ensureFile(key);
    const data = this.files(key);
    if (!data) {
      this.onLog(`openpuppetfile: "${fileName}" not available`);
      return false;
    }
    let pup: PupFile;
    try {
      pup = readPupFile(data);
    } catch (e) {
      this.onLog(`openpuppetfile: ${fileName}: ${(e as Error).message}`);
      return false;
    }
    const scripts = new Map<string, ScriptInstance>();
    let main: ScriptInstance | null = null;
    for (const s of pup.scripts) {
      const inst = this.instanceFrom(pup.file.containers[s.location]?.data, s.name);
      if (!inst) continue;
      scripts.set(s.name, inst);
      if (s.name === "boot script") main = inst;
    }
    // branch scripts resolve shared helpers through the boot script
    for (const inst of scripts.values()) if (inst !== main) inst.parent = main;
    // neutral opening pose: the first record of the first line's animLogic
    let pose: PupAnimFrame | null = null;
    const firstLine = pup.dialogue.values().next().value;
    if (firstLine) pose = readAnimLogic(pup, firstLine.animLogicLocation)[0] ?? null;
    this.puppet = {
      name: key,
      pup,
      scripts,
      stanceIdx: 0,
      visible: true,
      subtitle: "",
      bevels: [],
      eventWaiter: null,
      speakSkip: null,
      anim: null,
      pose,
      defaultPose: pose,
    };
    this.onLog(`puppet opened: ${key} (${pup.dialogue.size} lines, ${pup.scripts.length} scripts)`);
    return true;
  }

  closePuppetFile(): void {
    if (!this.puppet) return;
    this.puppet.eventWaiter?.(-1);
    this.puppet.speakSkip?.();
    this.audio.halt("voice");
    this.puppet = null;
  }

  /** play one dialogue line: voice + subtitle, suspend until it ends */
  async puppetSpeak(ident: string): Promise<void> {
    const p = this.puppet;
    if (!p) return;
    const line = p.pup.dialogue.get(toStr(ident).toLowerCase());
    if (!line) {
      this.onLog(`puppetspeak: no line "${ident}" in ${p.name}`);
      return;
    }
    p.subtitle = line.text;
    // TI paces a missing-audio line by text length (min 1 s)
    let seconds = Math.max(1, line.text.length / 15);
    try {
      const audio = decodeAudioContainer(p.pup.file.containers[line.audioLocation]);
      seconds = audio.samples.length / audio.sampleRate;
      this.audio.play("voice", audio);
    } catch (e) {
      this.onLog(`puppetspeak ${ident}: ${(e as Error).message}`);
    }
    // lip-sync/gesture playback: the line's animLogic records run at
    // ~30/s alongside the voice; the last record stays as the idle pose
    const frames = readAnimLogic(p.pup, line.animLogicLocation);
    if (frames.length) p.anim = { frames, start: this.clock.now };
    // a click skips the rest of the line (halting the voice)
    await Promise.race([
      this.clock.sleep(seconds * 1000 + 150),
      new Promise<void>((resolve) => (p.speakSkip = resolve)),
    ]);
    p.speakSkip = null;
    if (this.puppet === p) {
      p.subtitle = "";
      if (p.anim) {
        p.pose = p.anim.frames[p.anim.frames.length - 1];
        p.anim = null;
      }
    }
  }

  /** the layer state to draw right now (animLogic playback or held pose) */
  puppetFrame(): PupAnimFrame | null {
    const p = this.puppet;
    if (!p) return null;
    if (p.anim) {
      const idx = Math.floor((this.clock.now - p.anim.start) / 33.3);
      return p.anim.frames[Math.max(0, Math.min(idx, p.anim.frames.length - 1))];
    }
    return p.pose;
  }

  puppetClear(): void {
    if (!this.puppet) return;
    this.puppet.bevels = [];
    this.puppet.subtitle = "";
  }

  /**
   * puppetbase(ident): seat the character in a resting pose taken from a
   * dialogue line's first animLogic record (the game calls this before a
   * branch — e.g. bx2 posed with vs without the baby). "" reverts to the
   * neutral opening pose. Unknown idents are ignored (some scenarios name a
   * line from a companion puppet we don't have loaded).
   */
  puppetBase(ident: string): void {
    const p = this.puppet;
    if (!p) return;
    if (!ident) {
      p.pose = p.defaultPose;
      p.anim = null;
      return;
    }
    const line = p.pup.dialogue.get(toStr(ident).toLowerCase());
    if (!line) {
      this.onLog(`puppetbase: no line "${ident}" in ${p.name}`);
      return;
    }
    const frames = readAnimLogic(p.pup, line.animLogicLocation);
    if (frames.length) {
      p.pose = frames[0];
      p.anim = null;
    }
  }

  puppetBevel(text: string, id: number): void {
    this.puppet?.bevels.push({ text, id });
  }

  /** modal wait for a choice; resolves with the clicked bevel's id */
  puppetEvent(): Promise<number> {
    const p = this.puppet;
    if (!p) return Promise.resolve(-1);
    if (!p.bevels.length) return Promise.resolve(-1);
    return new Promise<number>((resolve) => {
      p.eventWaiter = (id) => {
        p.eventWaiter = null;
        p.bevels = [];
        resolve(id);
      };
    });
  }

  /** viewer hook: player clicked bevel index i (or -1 = skip the line) */
  puppetChoose(i: number): void {
    const p = this.puppet;
    if (!p) return;
    if (i >= 0 && i < p.bevels.length && p.eventWaiter) {
      p.eventWaiter(p.bevels[i].id);
      return;
    }
    p.speakSkip?.(); // click during speech: skip the line
  }

  /**
   * Load a CST cast file session-wide: register its characters (actors) and
   * their scripts. Idempotent — sets call opencastfile("extra.cst") freely.
   */
  async openCastFile(fileName: string): Promise<boolean> {
    const key = fileName.toLowerCase();
    if (this.castMains.has(key)) return true;
    await this.ensureFile(key);
    const data = this.files(key);
    if (!data) {
      this.onLog(`opencastfile: "${fileName}" not available`);
      return false;
    }
    let cst;
    try {
      cst = readCstFile(data);
    } catch (e) {
      this.onLog(`opencastfile: ${fileName}: ${(e as Error).message}`);
      return false;
    }
    this.actorRuntime.addCast(key, cst);
    const main = this.instanceFrom(cst.file.containers[1]?.data, key);
    this.castMains.set(key, main);
    for (const m of cst.members) {
      const inst = this.instanceFrom(cst.file.containers[m.scriptLocation]?.data, m.name);
      if (inst) {
        inst.parent = main; // stdactor/stdscale/endwalk live in the cast main
        this.castScripts.set(m.name, inst);
      }
    }
    if (main) {
      try {
        await this.interp.runHandler(main, "opencast", [], { me: key, target: "" });
      } catch (e) {
        this.onLog(`opencast ${key}: ${(e as Error).message}`);
      }
    }
    this.onLog(`cast loaded: ${key} (${cst.members.length} characters)`);
    return true;
  }

  closeCastFile(fileName: string): void {
    const key = fileName.toLowerCase();
    const cast = this.actorRuntime.casts.get(key);
    if (cast) {
      for (const m of cast.cst.members) this.castScripts.delete(m.name);
    }
    this.castMains.delete(key);
    this.actorRuntime.removeCast(key);
  }

  /** main script of a loaded shop (sendtoshop target), by file name */
  shopMain(name: string): ScriptInstance | null {
    return this.shopMains.get(name.toLowerCase()) ?? null;
  }

  /** session-scoped sendto* targets (usable before any set is open) */
  findGlobalInstance(name: string): ScriptInstance | null {
    const lower = name.toLowerCase();
    return (
      this.puppet?.scripts.get(lower) ??
      this.propScripts.get(lower) ??
      this.castScripts.get(lower) ??
      this.shopMains.get(lower) ??
      this.castMains.get(lower) ??
      this.flatScripts.get(lower) ??
      (this.stage && this.stage.name.toLowerCase() === lower ? this.stage : null) ??
      (lower === "boot" ? this.boot : null)
    );
  }

  /**
   * Load a SHP file session-wide: register its props + prop scripts and fire
   * its openshop handler. Shops opened by the boot script (house.shp,
   * inven.shp) stay loaded across set changes.
   */
  async openShop(fileName: string): Promise<boolean> {
    const key = fileName.toLowerCase();
    // Already loaded: re-run its openshop handler without rebuilding the props
    // (which would drop their state). A stage opens its shop on entry via
    // open<basename>() — e.g. openwireless -> openshopfile("wireless.shp") —
    // and openshop() ends by pushing the per-entry view setup to the active
    // flat (setupsmallprops). Re-firing it here makes that run in the stage's
    // context even when the shop was first opened at set-load.
    if (this.shopMains.has(key)) {
      const loaded = this.shopMains.get(key);
      if (loaded?.script.codes.has("openshop")) {
        try {
          await this.interp.runHandler(loaded, "openshop", [], { me: key, target: "" });
        } catch (e) {
          this.onLog(`openshop ${key} (re-entry): ${(e as Error).message}`);
        }
      }
      return true;
    }
    await this.ensureFile(key); // lazy browser provider: fetch before first read
    const data = this.files(key);
    if (!data) {
      this.onLog(`openshopfile: "${fileName}" not available`);
      return false;
    }
    let shp;
    try {
      shp = readShpFile(data);
    } catch (e) {
      this.onLog(`openshopfile: ${fileName}: ${(e as Error).message}`);
      return false;
    }
    this.propRuntime.addShop(key, shp);
    const main = this.instanceFrom(shp.file.containers[shp.mainScriptLocation]?.data, key);
    this.shopMains.set(key, main);
    for (const g of shp.groups) {
      const inst = this.instanceFrom(shp.file.containers[g.scriptContainerLocation]?.data, g.name);
      if (inst) {
        inst.parent = main; // unqualified calls resolve via the shop main
        this.propScripts.set(g.name.toLowerCase(), inst);
      }
    }
    if (main) {
      try {
        await this.interp.runHandler(main, "openshop", [], { me: key, target: "" });
      } catch (e) {
        this.onLog(`openshop ${key}: ${(e as Error).message}`);
      }
    }
    this.onLog(`shop loaded: ${key} (${shp.groups.length} props)`);
    return true;
  }

  async closeShop(fileName: string): Promise<void> {
    const key = fileName.toLowerCase();
    const main = this.shopMains.get(key);
    if (main) {
      try {
        await this.interp.runHandler(main, "closeshop", [], { me: key, target: "" });
      } catch {
        /* tolerated */
      }
    }
    this.shopMains.delete(key);
    const shop = this.propRuntime.shops.get(key);
    if (shop) {
      for (const g of shop.shp.groups) this.propScripts.delete(g.name.toLowerCase());
    }
    this.propRuntime.removeShop(key);
  }

  /**
   * Resources the boot sequence loads at game start (BOOTFILE script:
   * inven/house shops, inven/unilib banks). We mirror the resource loads
   * without running the boot game-flow (movies, day cycle).
   */
  async loadBootResources(): Promise<void> {
    for (const bank of ["inven.trk", "unilib.trk"]) {
      if (this.files(bank)) this.audioLib.openBank(bank, this.files(bank)!);
    }
    for (const shop of ["inven.shp", "house.shp"]) {
      if (this.files(shop)) {
        await this.openShop(shop);
        // boot UI shops: their screen props (interface band, inventory) draw on
        // top of the set view; every other shop's screen props are overlay-only
        const loaded = this.propRuntime.shops.get(shop.toLowerCase());
        if (loaded) loaded.persistent = true;
      }
    }
    // the boot script opens the story cast at startup (opencastfile)
    if (this.files("gang.cst")) await this.openCastFile("gang.cst");
  }
}
