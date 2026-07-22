import { readContainerFile } from "../df/container";
import { SetFile, readSetFile } from "../df/set";
import { readShpFile } from "../df/shp";
import { sniffScript } from "../df/script";
import { parseScript } from "./parser";
import { readCstFile } from "../df/cst";
import { Interpreter, ScriptInstance, Value, registerCoreBuiltins, toStr } from "./interp";
import { ActorRuntime } from "./actors";
import { PropRuntime } from "./props";
import { AudioLibrary, AudioSink } from "./audio";
import { Clock } from "./clock";
import { Scheduler } from "./scheduler";
import { PuppetController } from "./puppet";
import { StageController } from "./stage";
import { FileProvider, registerGameBuiltins } from "./setscripts";

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
    readonly files: FileProvider,
    readonly audio: AudioSink,
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
  /**
   * loop/cricket/walk scheduling + sound-loop handling on the 66 ms heartbeat.
   * The script-facing surface is delegated below so builtins/viewer keep
   * calling session.<method> unchanged.
   */
  readonly scheduler = new Scheduler(this);
  /** host hook: listener (camera) ground position + facing for crickets */
  listener: () => { x: number; y: number; deg: number } | null = () => null;

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

  // ---- Scheduler delegators (timing surface preserved for builtins/viewer) --
  get loops() { return this.scheduler.loops; }
  get crickets() { return this.scheduler.crickets; }
  get walks() { return this.scheduler.walks; }
  makeLoop(kind: string, name: string, handler: string, period: number): void {
    this.scheduler.makeLoop(kind, name, handler, period);
  }
  stopLoop(kind: string, name: string): void {
    this.scheduler.stopLoop(kind, name);
  }
  pauseLoop(kind: string, name: string, paused: boolean): void {
    this.scheduler.pauseLoop(kind, name, paused);
  }
  isLoop(kind: string, name: string): boolean {
    return this.scheduler.isLoop(kind, name);
  }
  makeCricket(name: string, x: number, y: number, radius: number, base: number, jitter: number): void {
    this.scheduler.makeCricket(name, x, y, radius, base, jitter);
  }
  stopCricket(name: string): void {
    this.scheduler.stopCricket(name);
  }
  pauseCricket(name: string, paused: boolean): void {
    this.scheduler.pauseCricket(name, paused);
  }
  isCricket(name: string): boolean {
    return this.scheduler.isCricket(name);
  }
  soundLoop(name: string, on: boolean): void {
    this.scheduler.soundLoop(name, on);
  }
  playSound(name: string, overlap: boolean): void {
    this.scheduler.playSound(name, overlap);
  }
  haltSounds(): void {
    this.scheduler.haltSounds();
  }
  stopAllAmbient(): void {
    this.scheduler.stopAllAmbient();
  }
  startWalk(name: string, tx: number, ty: number, tz: number, arriveStar?: string): void {
    this.scheduler.startWalk(name, tx, ty, tz, arriveStar);
  }
  stopWalk(name: string): void {
    this.scheduler.stopWalk(name);
  }
  isWalk(name: string): boolean {
    return this.scheduler.isWalk(name);
  }
  pauseWalk(name: string, paused: boolean): void {
    this.scheduler.pauseWalk(name, paused);
  }
  tickTime(now: number): void {
    this.scheduler.tickTime(now);
  }
  serviceFrameLoops(): void {
    this.scheduler.serviceFrameLoops();
  }
  pumpFrameLoops(exceptName: string): void {
    this.scheduler.pumpFrameLoops(exceptName);
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

  // ---- stage layer (STG flats) --------------------------------------------
  // Flat/region/overlay logic lives in StageController (engine/stage.ts); the
  // widely-shared fields below stay here and the session delegates the methods.

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
  /** rebuild the unqualified-call fallback chain (stage main + boot scripts) */
  refreshFallbacks(): void {
    this.interp.fallbackScripts = [this.stage, ...this.bootScripts].filter(
      (x): x is ScriptInstance => !!x,
    );
  }

  /**
   * STG stage layer: flats, click regions, and transtoflat/transfromflat
   * overlays. StageController owns the logic; the session keeps the shared
   * fields (stage, stageName, currentFlat, setVisible, flatScripts, flatNames)
   * and delegates the script/viewer-facing methods below.
   */
  readonly stageCtrl = new StageController(this);
  /** the parsed STG file of the active stage (null when none is open) */
  get stageFile() { return this.stageCtrl.stageFile; }
  openStageFile(fileName: string) { return this.stageCtrl.openStageFile(fileName); }
  closeStageFile() { return this.stageCtrl.closeStageFile(); }
  flatToIndex(ref: string) { return this.stageCtrl.flatToIndex(ref); }
  gotoFlat(name: string) { return this.stageCtrl.gotoFlat(name); }
  transToFlat(fileName: string) { return this.stageCtrl.transToFlat(fileName); }
  transFromFlat() { return this.stageCtrl.transFromFlat(); }
  currentFlatRegions() { return this.stageCtrl.currentFlatRegions(); }
  flatRegion(flatName: string, name: string) { return this.stageCtrl.flatRegion(flatName, name); }
  sendToButton(flatName: string, regionName: string, handler: string, args: Value[], callerName: string) {
    return this.stageCtrl.sendToButton(flatName, regionName, handler, args, callerName);
  }
  stageClickAt(x: number, y: number) { return this.stageCtrl.stageClickAt(x, y); }
  keydownTarget() { return this.stageCtrl.keydownTarget(); }
  flatImage() { return this.stageCtrl.flatImage(); }
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
  // Conversation state + playback live in PuppetController; the session exposes
  // `puppet` and delegates the script/viewer-facing methods unchanged.
  private readonly puppetCtrl = new PuppetController(this);
  get puppet() { return this.puppetCtrl.puppet; }
  openPuppetFile(fileName: string): Promise<boolean> {
    return this.puppetCtrl.openPuppetFile(fileName);
  }
  closePuppetFile(): void {
    this.puppetCtrl.closePuppetFile();
  }
  puppetSpeak(ident: string): Promise<void> {
    return this.puppetCtrl.puppetSpeak(ident);
  }
  puppetFrame() {
    return this.puppetCtrl.puppetFrame();
  }
  puppetClear(): void {
    this.puppetCtrl.puppetClear();
  }
  puppetBase(ident: string): void {
    this.puppetCtrl.puppetBase(ident);
  }
  puppetBevel(text: string, id: number): void {
    this.puppetCtrl.puppetBevel(text, id);
  }
  puppetEvent(): Promise<number> {
    return this.puppetCtrl.puppetEvent();
  }
  puppetChoose(i: number): void {
    this.puppetCtrl.puppetChoose(i);
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
