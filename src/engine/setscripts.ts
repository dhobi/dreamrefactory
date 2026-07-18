import { SetFile } from "../df/set";
import { ScriptInstance, Value, toStr, truthy } from "./interp";
import type { GameSession } from "./session";

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

  constructor(
    readonly set: SetFile,
    readonly session: GameSession,
  ) {
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

  /** most recently opened scene (for closesetfile's implicit closescene) */
  lastSceneIdx = -1;

  /**
   * Lifecycle events run through the chain like keydown: scene script →
   * set main → stage → boot scripts. Boot's defaults matter — e.g. its
   * closescene closes any open door (sendtoprop("door", initprop())).
   */
  private fireLifecycle(handler: string, sceneIdx: number): void {
    const interp = this.session.interp;
    interp.eventConsumed = false;
    const chain = [
      sceneIdx >= 0 ? this.sceneScripts[sceneIdx] : null,
      this.main,
      this.session.stage,
      ...this.session.bootScripts,
    ];
    for (const inst of chain) {
      if (!inst) continue;
      try {
        interp.runHandler(inst, handler, [], { me: inst.name, target: "" });
        if (interp.eventConsumed) return;
      } catch (e) {
        this.onLog(`script error in ${inst.name}.${handler}: ${(e as Error).message}`);
      }
    }
  }

  openSet(): void {
    this.fireLifecycle("openset", -1);
  }
  closeSet(): void {
    // leaving a set also leaves its scene
    if (this.lastSceneIdx >= 0) this.closeScene(this.lastSceneIdx);
    this.fireLifecycle("closeset", -1);
  }
  openScene(sceneIdx: number): void {
    this.lastSceneIdx = sceneIdx;
    this.fireLifecycle("openscene", sceneIdx);
  }
  closeScene(sceneIdx: number): void {
    this.fireLifecycle("closescene", sceneIdx);
    this.lastSceneIdx = -1;
  }

  /**
   * View change within a scene (turning): run only the BOOT defaults of
   * closescene — closes open doors/signs, resets the nav arrow — without
   * the scene script's own scene-exit logic (sounds etc. keep running).
   */
  viewChanged(): void {
    const interp = this.session.interp;
    interp.eventConsumed = false;
    for (const inst of this.session.bootScripts) {
      try {
        interp.runHandler(inst, "closescene", [], { me: inst.name, target: "" });
        if (interp.eventConsumed) return;
      } catch (e) {
        this.onLog(`script error in ${inst.name}.closescene: ${(e as Error).message}`);
      }
    }
  }

  objectScript(sceneIdx: number, viewIdx: number, objIdx: number): ScriptInstance | null {
    return this.objectScripts.get(`${sceneIdx}:${viewIdx}:${objIdx}`) ?? null;
  }

  /**
   * Pointer-event chain over a hotspot: object → scene → set main → stage.
   * A handler that runs to completion (without `passcode`) answers the
   * event; `passcode`/missing handler forwards. Boot's generic defaults do
   * NOT run for hotspot events — they'd overwrite e.g. the object's cursor
   * choice. (keydown works differently: see keyDown.)
   */
  private fireChain(
    sceneIdx: number,
    viewIdx: number,
    objIdx: number,
    handler: string,
    identifier: string,
  ): boolean {
    const interp = this.session.interp;
    interp.eventConsumed = false;
    const chain = [
      this.objectScript(sceneIdx, viewIdx, objIdx),
      this.sceneScripts[sceneIdx],
      this.main,
      this.session.stage,
    ];
    for (const inst of chain) {
      if (!inst) continue;
      try {
        const res = interp.runHandler(inst, handler, [identifier], {
          me: inst.name,
          target: identifier,
        });
        if (interp.eventConsumed || (res.handled && !res.passed)) return true;
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

  /**
   * Keyboard event. The boot script is the primary receiver — it routes to
   * the current scene itself via sendtoscene(currentscene(), keydown(arg)).
   * Returns true when some handler consumed the event with `exitcode`
   * (a handler merely finishing does NOT suppress the engine default).
   */
  keyDown(sceneIdx: number, keyName: string): boolean {
    const interp = this.session.interp;
    interp.eventConsumed = false;
    // boot1 routes to the scene itself (sendtoscene); boot2 implements the
    // default movement. Without a boot script, fall back to scene + main.
    const chain = this.session.bootScripts.length
      ? this.session.bootScripts
      : [this.sceneScripts[sceneIdx], this.main];
    for (const inst of chain) {
      if (!inst) continue;
      try {
        interp.runHandler(inst, "keydown", [keyName], { me: inst.name, target: keyName });
        if (interp.eventConsumed) break;
      } catch (e) {
        this.onLog(`script error in ${inst.name}.keydown: ${(e as Error).message}`);
      }
    }
    return interp.eventConsumed;
  }

  /** find any script instance in this set by its owner name */
  findInstance(name: string): ScriptInstance | null {
    const lower = name.toLowerCase();
    const prop = this.session.propScripts.get(lower);
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

  /** shops are session-scoped (boot's house.shp survives set changes) */
  openShop(fileName: string): boolean {
    return this.session.openShop(fileName);
  }

  closeShop(fileName: string): void {
    this.session.closeShop(fileName);
  }
}

/**
 * Register all game builtins on the session interpreter (idempotent).
 * Called from the GameSession constructor — must happen before any script
 * runs (shop openshop handlers fire during loadBootResources, before the
 * first set binding exists). Set-specific commands delegate through
 * session.currentBinding so they always act on the active set.
 */
export function registerGameBuiltins(session: GameSession): void {
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
      // sendtostage(call()) / sendtoboot(call()) take the deferred call as
      // their only argument — the target is implicit
      let targetName: string;
      let deferred = argExprs[1];
      if (argExprs.length === 1 && argExprs[0]?.t === "call") {
        targetName = cmd === "sendtoboot" ? "boot" : (session.stage?.name ?? "main.stg");
        deferred = argExprs[0];
      } else {
        targetName = toStr(ip.evalExpr(argExprs[0], frame));
      }
      if (!deferred || deferred.t !== "call") {
        log(`${cmd}: no deferred call argument`);
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
  // currentscene(dir) is a SETTER too: boot's default keydown implements
  // movement with currentscene("strait"/"left"/"right")
  r("currentscene", (_i, [dir]) => {
    if (dir === undefined) return session.currentSceneName();
    session.onNavigate(toStr(dir).toLowerCase());
  });
  r("currentview", () => session.currentViewName());
  // boot's keydown routing gates on these before forwarding to the scene
  r("setvisible", () => (session.currentSetName !== "none" ? 1 : 0));
  r("stagevisible", () => 0);
  r("currentstage", () => "none");
  r("currentflat", () => "none");

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
  r("propdeg", (_i, [n, v]) => {
    const p = prop(n);
    if (!p) return 0;
    if (v === undefined) return p.deg;
    p.deg = v;
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
    // ambient loop system — TODO real timers; stubs keep door/prop scripts running
    "stoploop", "stopcricket", "stopwalk", "pauseloop", "pausecricket", "pausewalk",
  ]) {
    r(noop, () => {});
  }
  for (const q of ["isloop", "iscricket", "iswalk"]) r(q, () => 0);
  r("makeloop", (_i, args) => log(`makeloop(${args.map(String).join(", ")}) — loops not implemented yet`));
  r("makecricket", (_i, args) => log(`makecricket(${args.map(String).join(", ")}) — crickets not implemented yet`));
}
