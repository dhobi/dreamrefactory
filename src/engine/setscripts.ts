import { SetFile } from "../df/set";
import { sniffScript } from "../df/script";
import { parseScript } from "./parser";
import { Interpreter, ScriptInstance, Value, registerCoreBuiltins, toStr } from "./interp";

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

  constructor(readonly set: SetFile) {
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
    const tokens = sniffScript(this.set.file.containers[containerLoc].data);
    if (!tokens) return null;
    try {
      return new ScriptInstance(owner, parseScript(tokens));
    } catch (e) {
      this.onLog(`parse error in ${owner}: ${(e as Error).message}`);
      return null;
    }
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
    if (this.main && this.main.name.toLowerCase() === lower) return this.main;
    for (let s = 0; s < this.set.scenes.length; s++) {
      if (this.set.scenes[s].sceneName.toLowerCase() === lower) return this.sceneScripts[s];
    }
    for (const inst of this.objectScripts.values()) {
      if (inst.name.toLowerCase() === lower) return inst;
    }
    return null;
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
    r("message", (_i, args) => this.onLog(`msg: ${args.map(String).join(" ")}`));
    for (const snd of ["voicesound", "singlesound", "bothsound", "dualsound", "multiplesound"]) {
      r(snd, (_i, args) => this.onLog(`${snd}: ${args.map(String).join(", ")}`));
    }
    for (const noop of ["forceupdate", "flushevents", "hidecursor", "showcursor", "debugger"]) {
      r(noop, () => {});
    }
  }
}
