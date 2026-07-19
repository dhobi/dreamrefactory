import { readContainerFile } from "../df/container";
import { SetFile, readSetFile } from "../df/set";
import { StgFile, readStgFile } from "../df/stg";
import { FrameBuffer, decodeFrame, paletteToRGBA } from "../df/image";
import { readShpFile } from "../df/shp";
import { sniffScript } from "../df/script";
import { parseScript } from "./parser";
import { Interpreter, ScriptInstance, Value, registerCoreBuiltins, toStr } from "./interp";
import { PropRuntime } from "./props";
import { AudioLibrary, AudioSink, NullAudioSink, PlayHandle } from "./audio";
import { FileProvider, registerGameBuiltins } from "./setscripts";

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
  onSetChange: (fileName: string, sceneName: string, viewName: string) => void | Promise<void> =
    () => {};
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

  /** soundloop(name, on/off): a named non-positional looping sound */
  soundLoop(name: string, on: boolean): void {
    const key = name.toLowerCase();
    const existing = this.soundLoops.get(key);
    if (!on) {
      existing?.stop();
      this.soundLoops.delete(key);
      return;
    }
    if (existing && !existing.done) return;
    const audio = this.audioLib.sound(key);
    if (!audio) {
      this.onLog(`soundloop: "${name}" not found`);
      return;
    }
    this.soundLoops.set(key, this.audio.play("sound", audio, { loop: true, overlap: true }));
  }

  /** silence every ambient sound (set change cleans its crickets itself) */
  stopAllAmbient(): void {
    for (const h of this.soundLoops.values()) h.stop();
    this.soundLoops.clear();
  }

  /**
   * Advance game time: resolve delay()s, then run 66 ms service steps —
   * crickets first, then due loops (TI.EXE master service order).
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
    // loops fire one at a time and never re-enter a running script (the
    // original engine is single-threaded; its service is likewise guarded)
    if (!this.scriptBusy) {
      const due = this.loops.filter((l) => !l.paused && --l.count <= 0);
      if (due.length) {
        for (const l of due) this.loops.splice(this.loops.indexOf(l), 1);
        this.track(
          (async () => {
            for (const l of due) await this.fireLoop(l);
          })(),
        );
      }
    }
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
    c.handle = this.audio.play("sound", audio, { overlap: true, volume, pan });
  }

  private async fireLoop(l: GameLoop): Promise<void> {
    const cmd =
      { actor: "sendtoactor", prop: "sendtoprop", scene: "sendtoscene", flat: "sendtoflat" }[
        l.kind
      ] ?? "sendtoprop";
    try {
      await this.sendEvent(cmd, l.name, l.handler, [], `loop:${l.kind}`);
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
    for (const link of chain) {
      if (!link.script.codes.has(handler)) continue;
      ran = true;
      const res = await this.interp.runHandler(link, handler, args, {
        me: link.name,
        target: callerName,
      });
      value = res.value;
      if (this.interp.eventConsumed || (res.handled && !res.passed)) break;
    }
    // the target resolves missing handlers through its CONTAINMENT chain
    // (prop -> shop main, where initprop() lives; then the stage), with
    // me = the target. Deliberately NOT the boot scripts: boot1's keydown
    // routes events via sendtoscene, so resolving a scene's missing
    // keydown back into boot would recurse forever (TURK scene134 has a
    // script without keydown — user-reported OOM).
    if (!ran && inst) {
      const libs: ScriptInstance[] = [];
      for (let p = inst.parent; p; p = p.parent) libs.push(p);
      if (this.stage && this.stage !== inst) libs.push(this.stage);
      for (const lib of libs) {
        if (!lib.script.codes.has(handler)) continue;
        value = (
          await this.interp.runHandler(lib, handler, args, { me: inst.name, target: callerName })
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
        ["themevolume", 255],
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
  async openStageFile(fileName: string): Promise<boolean> {
    const key = toStr(fileName).toLowerCase();
    if (this.stageName === key) return true;
    if (this.stageFile) await this.closeStageFile();
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
    if (stg.flats.length) await this.gotoFlat(stg.flats[0].name);
    return true;
  }

  /** engine primitive: close the current stage (closestagefile) */
  async closeStageFile(): Promise<void> {
    await this.fireFlat(this.currentFlat, "closeflat");
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
  async gotoFlat(name: string): Promise<void> {
    const target =
      this.flatNames.find((f) => f.toLowerCase() === toStr(name).toLowerCase()) ?? toStr(name);
    await this.fireFlat(this.currentFlat, "closeflat");
    this.currentFlat = target;
    await this.fireFlat(target, "openflat");
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
  /** host hook: playmovie builtin (viewer plays it; browser may fetch first) */
  onPlayMovie: (fileName: string, startFrame?: number) => void = () => {};

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

  /** engine primitive behind boot's changeset(): switch to another set */
  async openSetFile(fileName: string, sceneName = "", viewName = ""): Promise<void> {
    const key = fileName.toLowerCase();
    this.onLog(`opensetfile("${key}", "${sceneName}", "${viewName}")`);
    this.lastRotation = this.currentRotation ? this.currentRotation() : null;
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
  async openShop(fileName: string): Promise<boolean> {
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
      if (this.files(shop)) await this.openShop(shop);
    }
  }
}
