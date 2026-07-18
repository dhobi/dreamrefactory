import { SetFile } from "../df/set";
import { sniffScript } from "../df/script";
import { readShpFile } from "../df/shp";
import { parseScript } from "./parser";
import { Interpreter, ScriptInstance, Value, registerCoreBuiltins, toStr, truthy } from "./interp";
import { PropRuntime } from "./props";
import { AudioLibrary, AudioSink, NullAudioSink } from "./audio";

/** resolves sibling game files (turk.shp etc.) by lowercase basename */
export type FileProvider = (name: string) => Uint8Array | null;

/**
 * Binds a parsed SET file to the script interpreter: the set's main script,
 * per-scene scripts, and per-view-object (hotspot) scripts, with event
 * dispatch as observed in the corpus (openset/closeset, openscene/
 * closescene, mousedown, setcursor, keydown).
 */
export class SetScripts {
  readonly interp: Interpreter;
  readonly main: ScriptInstance | null;
  private sceneScripts: (ScriptInstance | null)[] = [];
  /** key: `${sceneIdx}:${viewIdx}:${objIdx}` */
  private objectScripts = new Map<string, ScriptInstance>();

  /** cursor name requested by the last setcursor handler */
  cursorName = "";
  onLog: (line: string) => void = () => {};
  readonly propRuntime = new PropRuntime();
  /** script instances of loaded prop groups, by lowercase prop name */
  private propScripts = new Map<string, ScriptInstance>();
  /** main-script instances of loaded shops, by shop file name */
  private shopMains = new Map<string, ScriptInstance | null>();

  readonly audioLib = new AudioLibrary();

  constructor(
    readonly set: SetFile,
    readonly files: FileProvider = () => null,
    readonly audio: AudioSink = new NullAudioSink(),
  ) {
    this.interp = new Interpreter();
    registerCoreBuiltins(this.interp);
    this.registerViewerBuiltins();
    this.interp.onUnknown = (name, args) =>
      this.onLog(`? ${name}(${args.map((a) => JSON.stringify(a)).join(", ")})`);

    this.main = this.instance(set.mainScript, set.setName);
    for (const scene of set.scenes) {
      this.sceneScripts.push(this.instance(scene.locationScript, scene.sceneName));
      for (let v = 0; v < scene.views.length; v++) {
        for (let o = 0; o < scene.views[v].objects.length; o++) {
          const obj = scene.views[v].objects[o];
          const inst = this.instance(obj.locationScript, obj.identifier);
          if (inst) this.objectScripts.set(`${scene.index}:${v}:${o}`, inst);
        }
      }
    }
  }

  private instance(containerLoc: number, owner: string): ScriptInstance | null {
    if (!containerLoc) return null;
    return this.instanceFrom(this.set.file.containers[containerLoc].data, owner);
  }

  /** fire an event; returns the handler result or null if nobody handled it */
  fire(inst: ScriptInstance | null, handler: string, args: Value[], target = ""): Value | null {
    if (!inst) return null;
    try {
      const res = this.interp.runHandler(inst, handler, args, { me: inst.name, target });
      return res.handled && !res.passed ? res.value : null;
    } catch (e) {
      this.onLog(`script error in ${inst.name}.${handler}: ${(e as Error).message}`);
      return null;
    }
  }

  openSet(): void {
    this.fire(this.main, "openset", []);
  }
  closeSet(): void {
    this.fire(this.main, "closeset", []);
  }
  openScene(sceneIdx: number): void {
    this.fire(this.sceneScripts[sceneIdx], "openscene", []);
  }
  closeScene(sceneIdx: number): void {
    this.fire(this.sceneScripts[sceneIdx], "closescene", []);
  }

  objectScript(sceneIdx: number, viewIdx: number, objIdx: number): ScriptInstance | null {
    return this.objectScripts.get(`${sceneIdx}:${viewIdx}:${objIdx}`) ?? null;
  }

  /**
   * Event chain as used by the original engine: the object's script gets the
   * event first; `passcode` (or a missing handler) forwards it to the scene
   * script, then the set's main script, then the engine default.
   */
  private fireChain(
    sceneIdx: number,
    viewIdx: number,
    objIdx: number,
    handler: string,
    identifier: string,
  ): boolean {
    const chain = [
      this.objectScript(sceneIdx, viewIdx, objIdx),
      this.sceneScripts[sceneIdx],
      this.main,
    ];
    for (const inst of chain) {
      if (!inst) continue;
      try {
        const res = this.interp.runHandler(inst, handler, [identifier], {
          me: inst.name,
          target: identifier,
        });
        if (res.handled && !res.passed) return true;
      } catch (e) {
        this.onLog(`script error in ${inst.name}.${handler}: ${(e as Error).message}`);
      }
    }
    return false;
  }

  /** mouse click on a hotspot; returns true when a handler consumed it */
  mouseDown(sceneIdx: number, viewIdx: number, objIdx: number, identifier: string): boolean {
    return this.fireChain(sceneIdx, viewIdx, objIdx, "mousedown", identifier);
  }

  /** hover: ask the scripts which cursor to show; returns cursor name or "" */
  setCursor(sceneIdx: number, viewIdx: number, objIdx: number, identifier: string): string {
    this.cursorName = "";
    this.fireChain(sceneIdx, viewIdx, objIdx, "setcursor", identifier);
    return this.cursorName;
  }

  /** find any script instance in this set by its owner name */
  findInstance(name: string): ScriptInstance | null {
    const lower = name.toLowerCase();
    const prop = this.propScripts.get(lower);
    if (prop) return prop;
    if (this.main && this.main.name.toLowerCase() === lower) return this.main;
    for (let s = 0; s < this.set.scenes.length; s++) {
      if (this.set.scenes[s].sceneName.toLowerCase() === lower) return this.sceneScripts[s];
    }
    for (const inst of this.objectScripts.values()) {
      if (inst.name.toLowerCase() === lower) return inst;
    }
    return null;
  }

  /** open a TRK/SFX/11K audio bank through the file provider */
  openTrackFile(fileName: string): boolean {
    const key = fileName.toLowerCase();
    const data = this.files(key);
    if (!data) {
      this.onLog(`opentrackfile: "${fileName}" not available`);
      return false;
    }
    if (!this.audioLib.openBank(key, data)) {
      this.onLog(`opentrackfile: "${fileName}" is not an audio bank`);
      return false;
    }
    return true;
  }

  /** load a SHP file: register its props, prop scripts, and fire openshop */
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
    this.fire(main, "openshop", []);
    this.onLog(`shop loaded: ${key} (${shp.groups.map((g) => g.name).join(", ")})`);
    return true;
  }

  closeShop(fileName: string): void {
    const key = fileName.toLowerCase();
    const main = this.shopMains.get(key);
    if (main !== undefined) this.fire(main, "closeshop", []);
    this.shopMains.delete(key);
    const shop = this.propRuntime.shops.get(key);
    if (shop) {
      for (const g of shop.shp.groups) this.propScripts.delete(g.name.toLowerCase());
    }
    this.propRuntime.removeShop(key);
  }

  private instanceFrom(data: Uint8Array | undefined, owner: string): ScriptInstance | null {
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

  private registerViewerBuiltins(): void {
    const r = this.interp.register.bind(this.interp);

    // sendto*("name", handler(args)): the second argument is a DEFERRED call,
    // executed against the target object's script — not evaluated locally
    for (const cmd of [
      "sendtoprop", "sendtoactor", "sendtoscene", "sendtoset", "sendtoshop",
      "sendtopuppet", "sendtocast", "sendtostage", "sendtobutton", "sendtoflat",
      "sendtopainting", "sendtoboot", "sendtopost", "sendtoserver",
    ]) {
      this.interp.registerSpecial(cmd, (interp, argExprs, frame) => {
        const targetName = toStr(interp.evalExpr(argExprs[0], frame));
        const deferred = argExprs[1];
        if (!deferred || deferred.t !== "call") {
          this.onLog(`${cmd}: second argument is not a call`);
          return 0;
        }
        const inst = this.findInstance(targetName);
        if (!inst) {
          this.onLog(`${cmd}("${targetName}", ${deferred.name}(..)) — target not loaded`);
          return 0;
        }
        // arguments of the deferred call ARE evaluated in the caller's frame
        const args = deferred.args.map((a) => interp.evalExpr(a, frame));
        return interp.runHandler(inst, deferred.name, args, {
          me: inst.name,
          target: frame.ctx.me,
        }).value;
      });
    }
    r("cursor", (_i, [name]) => {
      this.cursorName = String(name ?? "");
    });

    // prop commands — getter/setter by arity
    const prop = (name: Value) => this.propRuntime.get(toStr(name));
    r("propexists", (_i, [n]) => (prop(n) ? 1 : 0));
    r("propvisible", (_i, [n, v]) => {
      const p = prop(n);
      if (!p) return 0;
      if (v === undefined) return p.visible ? 1 : 0;
      p.visible = truthy(v);
    });
    r("propview", (_i, [n, v]) => {
      const p = prop(n);
      if (!p) return "";
      if (v === undefined) return p.stateName;
      p.stateName = toStr(v).toLowerCase();
      p.frameIdx = 0;
      p.lastTick = 0;
    });
    r("propxy", (_i, [n, x, y]) => {
      const p = prop(n);
      if (!p) return 0;
      if (x === undefined) return 0;
      p.anchorX = Number(x) || 0;
      p.anchorY = Number(y) || 0;
    });
    r("propowner", (_i, [n, v]) => {
      const p = prop(n);
      if (!p) return "";
      if (v === undefined) return p.owner;
      p.owner = v;
    });
    r("propvalue", (_i, [n, v]) => {
      const p = prop(n);
      if (!p) return 0;
      if (v === undefined) return p.value;
      p.value = v;
    });
    r("openshopfile", (_i, [n]) => {
      this.openShop(toStr(n));
    });
    r("closeshopfile", (_i, [n]) => {
      this.closeShop(toStr(n));
    });
    r("message", (_i, args) => this.onLog(`msg: ${args.map(String).join(" ")}`));

    // sound playback
    const playNamed = (name: Value, channel: "sound" | "voice", overlap = false) => {
      const audio = this.audioLib.sound(toStr(name));
      if (!audio) {
        this.onLog(`sound not found: ${toStr(name)} (banks: ${this.audioLib.bankNames.join(", ") || "none"})`);
        return;
      }
      this.audio.play(channel, audio, { overlap });
    };
    r("voicesound", (_i, [n]) => playNamed(n, "voice"));
    r("singlesound", (_i, [n]) => playNamed(n, "sound"));
    r("multiplesound", (_i, [n]) => playNamed(n, "sound", true));
    r("bothsound", (_i, [n]) => playNamed(n, "sound"));
    r("dualsound", (_i, [n]) => playNamed(n, "sound", true));
    r("haltsound", () => this.audio.halt("sound"));
    r("haltvoice", () => this.audio.halt("voice"));
    r("halttheme", () => this.audio.halt("theme"));
    r("sounddone", () => (this.audio.isDone("sound") ? 1 : 0));
    r("voicedone", () => (this.audio.isDone("voice") ? 1 : 0));
    r("playtheme", (_i, [n]) => {
      const theme = this.audioLib.theme(n === undefined ? undefined : toStr(n));
      if (!theme) {
        this.onLog(`playtheme: no theme available${n !== undefined ? ` (${toStr(n)})` : ""}`);
        return;
      }
      this.audio.play("theme", theme, { loop: true });
    });
    r("opentrackfile", (_i, [n]) => {
      this.openTrackFile(toStr(n));
    });
    r("closetrackfile", (_i, [n]) => {
      this.audioLib.closeBank(toStr(n));
    });
    for (const noop of ["forceupdate", "flushevents", "hidecursor", "showcursor", "debugger"]) {
      r(noop, () => {});
    }
  }
}
