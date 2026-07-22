import { readContainerFile } from "../df/container";
import { SetFile, readSetFile } from "../df/set";
import { StgFile, StgRegion, readStgFile, readStgRegions } from "../df/stg";
import { FrameBuffer, decodeFrame, paletteToRGBA } from "../df/image";
import { readShpFile } from "../df/shp";
import { sniffScript } from "../df/script";
import { parseScript } from "./parser";
import { readCstFile } from "../df/cst";
import { Interpreter, ScriptInstance, Value, registerCoreBuiltins, toStr } from "./interp";
import { ActorRuntime } from "./actors";
import { PropRuntime } from "./props";
import { AudioLibrary, AudioSink, NullAudioSink } from "./audio";
import { Clock } from "./clock";
import { Scheduler } from "./scheduler";
import { PuppetController } from "./puppet";
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
