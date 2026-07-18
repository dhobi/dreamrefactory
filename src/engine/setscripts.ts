import { SetFile } from "../df/set";
import { readShpFile } from "../df/shp";
import { ScriptInstance, Value, toStr, truthy } from "./interp";
import { GameSession } from "./session";

/** resolves sibling game files (turk.shp etc.) by lowercase basename */
export type FileProvider = (name: string) => Uint8Array | null;

/**
 * Binds a parsed SET file to the session's interpreter: the set's main
 * script, per-scene scripts, and per-view-object (hotspot) scripts, with
 * event dispatch as observed in the corpus.
 *
 * The full event chain is: object script → scene script → set main script →
 * stage script → boot script → engine default. `passcode` (or a missing
 * handler) forwards to the next link.
 */
export class SetScripts {
  readonly main: ScriptInstance | null;
  private sceneScripts: (ScriptInstance | null)[] = [];
  /** key: `${sceneIdx}:${viewIdx}:${objIdx}` */
  private objectScripts = new Map<string, ScriptInstance>();

  /** cursor name requested by the last setcursor handler */
  cursorName = "";
  onLog: (line: string) => void = () => {};
  /** script instances of loaded prop groups, by lowercase prop name */
  private propScripts = new Map<string, ScriptInstance>();
  /** main-script instances of loaded shops, by shop file name */
  private shopMains = new Map<string, ScriptInstance | null>();

  constructor(
    readonly set: SetFile,
    readonly session: GameSession,
  ) {
    registerGameBuiltins(session);
    session.currentBinding = this;
    session.currentSetName = set.setName.toLowerCase();
    session.interp.onUnknown = (name, args) =>
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
    return this.session.instanceFrom(this.set.file.containers[containerLoc].data, owner);
  }

  /** fire an event; returns the handler result or null if nobody handled it */
  fire(inst: ScriptInstance | null, handler: string, args: Value[], target = ""): Value | null {
    if (!inst) return null;
    try {
      const res = this.session.interp.runHandler(inst, handler, args, { me: inst.name, target });
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

  /** the passcode chain: object → scene → set main → stage → boot */
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
      this.session.stage,
      this.session.boot,
    ];
    for (const inst of chain) {
      if (!inst) continue;
      try {
        const res = this.session.interp.runHandler(inst, handler, [identifier], {
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

  /** keyboard event through the chain of the current scene (no object) */
  keyDown(sceneIdx: number, keyName: string): boolean {
    const chain = [this.sceneScripts[sceneIdx], this.main, this.session.stage, this.session.boot];
    for (const inst of chain) {
      if (!inst) continue;
      try {
        const res = this.session.interp.runHandler(inst, "keydown", [keyName], {
          me: inst.name,
          target: keyName,
        });
        if (res.handled && !res.passed) return true;
      } catch (e) {
        this.onLog(`script error in ${inst.name}.keydown: ${(e as Error).message}`);
      }
    }
    return false;
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
    if (this.session.stage && lower === this.session.stage.name.toLowerCase()) {
      return this.session.stage;
    }
    if (lower === "boot") return this.session.boot;
    return null;
  }

  /** load a SHP file: register its props, prop scripts, and fire openshop */
  openShop(fileName: string): boolean {
    const key = fileName.toLowerCase();
    if (this.shopMains.has(key)) return true;
    const data = this.session.files(key);
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
    this.session.propRuntime.addShop(key, shp);
    for (const g of shp.groups) {
      const inst = this.session.instanceFrom(
        shp.file.containers[g.scriptContainerLocation]?.data,
        g.name,
      );
      if (inst) this.propScripts.set(g.name.toLowerCase(), inst);
    }
    const main = this.session.instanceFrom(shp.file.containers[shp.mainScriptLocation]?.data, key);
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
    const shop = this.session.propRuntime.shops.get(key);
    if (shop) {
      for (const g of shop.shp.groups) this.propScripts.delete(g.name.toLowerCase());
    }
    this.session.propRuntime.removeShop(key);
  }
}

/**
 * Register all game builtins on the session interpreter (idempotent).
 * Set-specific commands delegate through session.currentBinding so they
 * always act on the active set.
 */
function registerGameBuiltins(session: GameSession): void {
  if (session.builtinsRegistered) return;
  session.builtinsRegistered = true;

  const interp = session.interp;
  const r = interp.register.bind(interp);
  const log = (l: string) => session.currentBinding?.onLog(l) ?? session.onLog(l);

  // sendto*("name", handler(args)): the second argument is a DEFERRED call,
  // executed against the target object's script — not evaluated locally
  for (const cmd of [
    "sendtoprop", "sendtoactor", "sendtoscene", "sendtoset", "sendtoshop",
    "sendtopuppet", "sendtocast", "sendtostage", "sendtobutton", "sendtoflat",
    "sendtopainting", "sendtoboot", "sendtopost", "sendtoserver",
  ]) {
    interp.registerSpecial(cmd, (ip, argExprs, frame) => {
      const targetName = toStr(ip.evalExpr(argExprs[0], frame));
      const deferred = argExprs[1];
      if (!deferred || deferred.t !== "call") {
        log(`${cmd}: second argument is not a call`);
        return 0;
      }
      let inst = session.currentBinding?.findInstance(targetName) ?? null;
      if (!inst && cmd === "sendtostage") inst = session.stage;
      if (!inst && cmd === "sendtoboot") inst = session.boot;
      if (!inst) {
        log(`${cmd}("${targetName}", ${deferred.name}(..)) — target not loaded`);
        return 0;
      }
      // arguments of the deferred call ARE evaluated in the caller's frame
      const args = deferred.args.map((a) => ip.evalExpr(a, frame));
      return ip.runHandler(inst, deferred.name, args, { me: inst.name, target: frame.ctx.me })
        .value;
    });
  }

  r("cursor", (_i, [name]) => {
    if (session.currentBinding) session.currentBinding.cursorName = String(name ?? "");
  });
  r("message", (_i, args) => log(`msg: ${args.map(String).join(" ")}`));

  // set switching — the engine primitives behind boot's changeset()
  r("opensetfile", (_i, [name, scene, view]) => {
    session.openSetFile(toStr(name ?? ""), toStr(scene ?? ""), toStr(view ?? ""));
  });
  r("closesetfile", () => {
    session.currentBinding?.closeSet();
    session.currentSetName = "none";
  });
  r("currentset", () => session.currentSetName);
  r("currentscene", () => session.currentSceneName());
  r("currentview", () => session.currentViewName());

  // prop commands — getter/setter by arity
  const prop = (name: Value) => session.propRuntime.get(toStr(name));
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
    if (!p || x === undefined) return 0;
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
    session.currentBinding?.openShop(toStr(n));
  });
  r("closeshopfile", (_i, [n]) => {
    session.currentBinding?.closeShop(toStr(n));
  });

  // sound playback
  const playNamed = (name: Value, channel: "sound" | "voice", overlap = false) => {
    const audio = session.audioLib.sound(toStr(name));
    if (!audio) {
      log(`sound not found: ${toStr(name)} (banks: ${session.audioLib.bankNames.join(", ") || "none"})`);
      return;
    }
    session.audio.play(channel, audio, { overlap });
  };
  r("voicesound", (_i, [n]) => playNamed(n, "voice"));
  r("singlesound", (_i, [n]) => playNamed(n, "sound"));
  r("multiplesound", (_i, [n]) => playNamed(n, "sound", true));
  r("bothsound", (_i, [n]) => playNamed(n, "sound"));
  r("dualsound", (_i, [n]) => playNamed(n, "sound", true));
  r("haltsound", () => session.audio.halt("sound"));
  r("haltvoice", () => session.audio.halt("voice"));
  r("halttheme", () => session.audio.halt("theme"));
  r("sounddone", () => (session.audio.isDone("sound") ? 1 : 0));
  r("voicedone", () => (session.audio.isDone("voice") ? 1 : 0));
  r("playtheme", (_i, [n]) => {
    const theme = session.audioLib.theme(n === undefined ? undefined : toStr(n));
    if (!theme) {
      log(`playtheme: no theme available${n !== undefined ? ` (${toStr(n)})` : ""}`);
      return;
    }
    session.audio.play("theme", theme, { loop: true });
  });
  r("opentrackfile", (_i, [n]) => {
    session.openTrackFile(toStr(n));
  });
  r("closetrackfile", (_i, [n]) => {
    session.audioLib.closeBank(toStr(n));
  });

  // string helper used by boot logic: findword("a,b,c", ",", 2) -> "b"
  r("findword", (_i, [s, delim, idx]) => {
    const parts = toStr(s ?? "").split(toStr(delim ?? ","));
    return parts[(Number(idx) || 1) - 1] ?? "";
  });

  // screen transitions: visual polish for later — behave as instant for now
  for (const t of [
    "plain", "nodraw", "barndoorclose", "barndooropen", "irisclose", "irisopen",
    "scrolldown", "scrollup", "scrollright", "scrolleft", "venetian",
    "wipedown", "wipeup", "wiperight", "wipeleft",
    "turnright", "turnleft", "turnup", "turndown", "turnhalfleft", "turnhalfright",
  ]) {
    r(t, () => t);
  }
  for (const noop of [
    "forceupdate", "flushevents", "hidecursor", "showcursor", "debugger",
    "visualeffect", "screentoblack", "blacktoscreen", "blackscreen", "mixclut",
    "exportclut", "clut",
  ]) {
    r(noop, () => {});
  }
}
