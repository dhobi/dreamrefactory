import { readContainerFile } from "../df/container";
import { SetFile, readSetFile } from "../df/set";
import { StgFile, readStgFile } from "../df/stg";
import { FrameBuffer, decodeFrame, paletteToRGBA } from "../df/image";
import { readShpFile } from "../df/shp";
import { sniffScript } from "../df/script";
import { parseScript } from "./parser";
import { Interpreter, ScriptInstance, Value, registerCoreBuiltins, toStr } from "./interp";
import { PropRuntime } from "./props";
import { AudioLibrary, AudioSink, NullAudioSink } from "./audio";
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
  /** the active set's script binding (SetScripts) — set by its constructor */
  currentBinding: import("./setscripts").SetScripts | null = null;
  builtinsRegistered = false;

  onLog: (line: string) => void = () => {};
  /** host hook: actually load + display a set (async in the browser) */
  onSetChange: (fileName: string, sceneName: string, viewName: string) => void = () => {};
  /** host hooks for currentscene()/currentview() queries */
  currentSceneName: () => string = () => "";
  currentViewName: () => string = () => "";
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
  loadCoreScripts(): void {
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
        ["themevolume", 255],
      ] as [string, Value][]) {
        this.interp.globals.set(k, v);
      }
    }
    this.loadBootResources();
    // the boot script opens the standard in-game stage at startup and
    // initializes the inventory + interface props
    this.openStageFile("main.stg");
    const inven = this.shopMain("inven.shp");
    if (inven?.script.codes.has("initprops") && !this.interp.globals.has("__propsinit")) {
      this.interp.globals.set("__propsinit", 1);
      try {
        this.interp.runHandler(inven, "initprops", [], { me: "inven.shp", target: "" });
      } catch (e) {
        this.onLog(`initprops: ${(e as Error).message}`);
      }
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
  openStageFile(fileName: string): boolean {
    const key = toStr(fileName).toLowerCase();
    if (this.stageName === key) return true;
    if (this.stageFile) this.closeStageFile();
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
    if (stg.flats.length) this.gotoFlat(stg.flats[0].name);
    return true;
  }

  /** engine primitive: close the current stage (closestagefile) */
  closeStageFile(): void {
    this.fireFlat(this.currentFlat, "closeflat");
    this.currentFlat = "none";
    this.stageFile = null;
    this.stageName = "none";
    this.stage = null;
    this.flatScripts.clear();
    this.flatNames = [];
    this.flatImageCache.clear();
    this.refreshFallbacks();
  }

  /** engine primitive: switch the active flat (gotoflat) */
  gotoFlat(name: string): void {
    const target =
      this.flatNames.find((f) => f.toLowerCase() === toStr(name).toLowerCase()) ?? toStr(name);
    this.fireFlat(this.currentFlat, "closeflat");
    this.currentFlat = target;
    this.fireFlat(target, "openflat");
  }

  private fireFlat(name: string, handler: string): void {
    const inst = this.flatScripts.get(name.toLowerCase());
    if (!inst || !inst.script.codes.has(handler)) return;
    try {
      this.interp.runHandler(inst, handler, [], { me: inst.name, target: "" });
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
  /** host hook: playmovie builtin (viewer plays it; browser may fetch first) */
  onPlayMovie: (fileName: string, startFrame?: number) => void = () => {};

  /**
   * Invoke a globally-callable handler (stage/boot standard library) the way
   * unqualified script calls resolve — first fallback script that defines it.
   */
  runGlobal(handler: string, args: Value[] = []): Value {
    for (const inst of this.interp.fallbackScripts) {
      if (inst.script.codes.has(handler)) {
        return this.interp.runHandler(inst, handler, args, { me: inst.name, target: "" }).value;
      }
    }
    this.onLog(`runGlobal: no handler "${handler}"`);
    return 0;
  }

  /** engine primitive behind boot's changeset(): switch to another set */
  openSetFile(fileName: string, sceneName = "", viewName = ""): void {
    const key = fileName.toLowerCase();
    this.onLog(`opensetfile("${key}", "${sceneName}", "${viewName}")`);
    this.lastRotation = this.currentRotation ? this.currentRotation() : null;
    this.onSetChange(key, sceneName.toLowerCase(), viewName.toLowerCase());
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

  openTrackFile(fileName: string): boolean {
    const key = toStr(fileName).toLowerCase();
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

  /** main script of a loaded shop (sendtoshop target), by file name */
  shopMain(name: string): ScriptInstance | null {
    return this.shopMains.get(name.toLowerCase()) ?? null;
  }

  /** session-scoped sendto* targets (usable before any set is open) */
  findGlobalInstance(name: string): ScriptInstance | null {
    const lower = name.toLowerCase();
    return (
      this.propScripts.get(lower) ??
      this.shopMains.get(lower) ??
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
  openShop(fileName: string): boolean {
    const key = fileName.toLowerCase();
    if (this.shopMains.has(key)) return true;
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
    for (const g of shp.groups) {
      const inst = this.instanceFrom(shp.file.containers[g.scriptContainerLocation]?.data, g.name);
      if (inst) this.propScripts.set(g.name.toLowerCase(), inst);
    }
    const main = this.instanceFrom(shp.file.containers[shp.mainScriptLocation]?.data, key);
    this.shopMains.set(key, main);
    if (main) {
      try {
        this.interp.runHandler(main, "openshop", [], { me: key, target: "" });
      } catch (e) {
        this.onLog(`openshop ${key}: ${(e as Error).message}`);
      }
    }
    this.onLog(`shop loaded: ${key} (${shp.groups.length} props)`);
    return true;
  }

  closeShop(fileName: string): void {
    const key = fileName.toLowerCase();
    const main = this.shopMains.get(key);
    if (main) {
      try {
        this.interp.runHandler(main, "closeshop", [], { me: key, target: "" });
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
  loadBootResources(): void {
    for (const bank of ["inven.trk", "unilib.trk"]) {
      if (this.files(bank)) this.audioLib.openBank(bank, this.files(bank)!);
    }
    for (const shop of ["inven.shp", "house.shp"]) {
      if (this.files(shop)) this.openShop(shop);
    }
  }
}
