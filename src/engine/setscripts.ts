import { SetFile } from "../df/set";
import { ScriptInstance, Value, toNum, toStr, truthy } from "./interp";
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
    // prefer the opened FILE's basename: DECKBD.SET's internal name field
    // says "decka", but scripts address the set as "deckbd"
    session.currentSetName = session.currentSetFile || set.setName.toLowerCase();
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
  async fire(
    inst: ScriptInstance | null,
    handler: string,
    args: Value[],
    target = "",
  ): Promise<Value | null> {
    if (!inst) return null;
    try {
      const res = await this.session.interp.runHandler(inst, handler, args, {
        me: inst.name,
        target,
      });
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
  private async fireLifecycle(handler: string, sceneIdx: number): Promise<void> {
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
        await interp.runHandler(inst, handler, [], { me: inst.name, target: "" });
        if (interp.eventConsumed) return;
      } catch (e) {
        this.onLog(`script error in ${inst.name}.${handler}: ${(e as Error).message}`);
      }
    }
  }

  async openSet(): Promise<void> {
    await this.fireLifecycle("openset", -1);
  }
  async closeSet(): Promise<void> {
    // leaving a set also leaves its scene
    if (this.lastSceneIdx >= 0) await this.closeScene(this.lastSceneIdx);
    await this.fireLifecycle("closeset", -1);
  }
  async openScene(sceneIdx: number): Promise<void> {
    this.lastSceneIdx = sceneIdx;
    await this.fireLifecycle("openscene", sceneIdx);
  }
  async closeScene(sceneIdx: number): Promise<void> {
    await this.fireLifecycle("closescene", sceneIdx);
    this.lastSceneIdx = -1;
  }

  /**
   * View change within a scene (turning): run only the BOOT defaults of
   * closescene — closes open doors/signs, resets the nav arrow — without
   * the scene script's own scene-exit logic (sounds etc. keep running).
   */
  async viewChanged(): Promise<void> {
    const interp = this.session.interp;
    interp.eventConsumed = false;
    for (const inst of this.session.bootScripts) {
      try {
        await interp.runHandler(inst, "closescene", [], { me: inst.name, target: "" });
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
  private async fireChain(
    sceneIdx: number,
    viewIdx: number,
    objIdx: number,
    handler: string,
    identifier: string,
  ): Promise<boolean> {
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
        const res = await interp.runHandler(inst, handler, [identifier], {
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
  mouseDown(
    sceneIdx: number,
    viewIdx: number,
    objIdx: number,
    identifier: string,
  ): Promise<boolean> {
    return this.fireChain(sceneIdx, viewIdx, objIdx, "mousedown", identifier);
  }

  /** hover: ask the scripts which cursor to show; returns cursor name or "" */
  async setCursor(
    sceneIdx: number,
    viewIdx: number,
    objIdx: number,
    identifier: string,
  ): Promise<string> {
    this.cursorName = "";
    await this.fireChain(sceneIdx, viewIdx, objIdx, "setcursor", identifier);
    return this.cursorName;
  }

  /**
   * Keyboard event. The boot script is the primary receiver — it routes to
   * the current scene itself via sendtoscene(currentscene(), keydown(arg)).
   * Returns true when some handler consumed the event with `exitcode`
   * (a handler merely finishing does NOT suppress the engine default).
   */
  async keyDown(sceneIdx: number, keyName: string): Promise<boolean> {
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
        await interp.runHandler(inst, "keydown", [keyName], { me: inst.name, target: keyName });
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
    const shop = this.session.shopMain(lower);
    if (shop) return shop;
    const flat = this.session.flatScripts.get(lower);
    if (flat) return flat;
    if (lower === "boot") return this.session.boot;
    return null;
  }

  /** shops are session-scoped (boot's house.shp survives set changes) */
  openShop(fileName: string): Promise<boolean> {
    return this.session.openShop(fileName);
  }

  closeShop(fileName: string): Promise<void> {
    return this.session.closeShop(fileName);
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
    "sendtoprop", "sendtoactor", "sendtoscene", "sendtoset", "sendtoshop", "sendtoshopfx",
    "sendtopuppet", "sendtocast", "sendtostage", "sendtobutton", "sendtoflat",
    "sendtopainting", "sendtoboot", "sendtopost", "sendtoserver",
  ]) {
    interp.registerSpecial(cmd, async (ip, argExprs, frame) => {
      // sendtostage(call()) / sendtoboot(call()) take the deferred call as
      // their only argument — the target is implicit
      let targetName: string;
      let deferred = argExprs[1];
      if (argExprs.length === 1 && argExprs[0]?.t === "call") {
        targetName = cmd === "sendtoboot" ? "boot" : (session.stage?.name ?? "main.stg");
        deferred = argExprs[0];
      } else {
        targetName = toStr(await ip.evalExpr(argExprs[0], frame));
      }
      if (!deferred || deferred.t !== "call") {
        log(`${cmd}: no deferred call argument`);
        return 0;
      }
      // arguments of the deferred call ARE evaluated in the caller's frame;
      // resolution + containment-chain forwarding live on the session
      // (shared with makeloop firing)
      const args = await ip.evalArgs(deferred.args, frame);
      return session.sendEvent(cmd, targetName, deferred.name, args, frame.ctx.me);
    });
  }

  r("cursor", (_i, [name]) => {
    if (session.currentBinding) session.currentBinding.cursorName = String(name ?? "");
  });
  r("message", (_i, args) => log(`msg: ${args.map(String).join(" ")}`));

  // set switching — the engine primitives behind boot's changeset()
  r("opensetfile", async (_i, [name, scene, view]) => {
    await session.openSetFile(toStr(name ?? ""), toStr(scene ?? ""), toStr(view ?? ""));
  });
  r("closesetfile", async () => {
    await session.currentBinding?.closeSet();
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
  // stage layer (STG flats): the UI band / inventory / mini-game screens
  r("setvisible", (_i, [v]) => {
    if (v === undefined) return session.setVisible && session.currentSetName !== "none" ? 1 : 0;
    session.setVisible = truthy(v);
  });
  r("stagevisible", () => (session.stageName !== "none" ? 1 : 0));
  r("currentstage", () => session.stageName);
  r("currentflat", () => session.currentFlat);
  r("openstagefile", async (_i, [n]) => ((await session.openStageFile(toStr(n ?? ""))) ? 1 : 0));
  r("closestagefile", () => session.closeStageFile().then(() => {}));
  r("gotoflat", (_i, [n]) => session.gotoFlat(toStr(n ?? "")).then(() => {}));

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
    p.worldSpace = false; // screen placement (band/inventory/flat)
  });
  // world-space placement in a set (bag on the C73 bed, turkwater...) —
  // projection is still an open TI.EXE question, values stored for later
  r("propxyz", (_i, [n, x, y, z]) => {
    const p = prop(n);
    if (!p) return 0;
    p.worldSpace = true;
    p.worldX = Number(x) || 0;
    p.worldY = Number(y) || 0;
    p.worldZ = Number(z) || 0;
  });
  r("propset", (_i, [n, v]) => {
    const p = prop(n);
    if (!p) return "";
    if (v === undefined) return p.setName;
    p.setName = toStr(v).toLowerCase();
  });
  r("propscale", (_i, [n, v]) => {
    const p = prop(n);
    if (!p) return 0;
    if (v === undefined) return p.scale;
    p.scale = Number(v) || 0;
  });
  r("propzclip", (_i, [n, v]) => {
    const p = prop(n);
    if (!p) return 0;
    if (v === undefined) return p.zclip;
    p.zclip = Number(v) || 0;
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
  // z-order: more negative = closer to the viewer (inventory items at -11
  // draw over the UI band at -3)
  r("propdist", (_i, [n, v]) => {
    const p = prop(n);
    if (!p) return 0;
    if (v === undefined) return p.dist;
    p.dist = Number(v) || 0;
  });
  // shop-scoped enumeration (me = the shop file inside its main script)
  const myShop = (frame: { ctx: { me: string } }) =>
    session.propRuntime.shops.get(frame.ctx.me.toLowerCase());
  r("countprops", (_i, _a, _c, frame) => myShop(frame)?.shp.groups.length ?? 0);
  r("indextoprop", (_i, [idx], _c, frame) => myShop(frame)?.shp.groups[Number(idx) - 1]?.name ?? "");
  r("error", (_i, args) => log(`script error(): ${args.map(String).join(", ")}`));
  r("propvalue", (_i, [n, v]) => {
    const p = prop(n);
    if (!p) return 0;
    if (v === undefined) return p.value;
    p.value = v;
  });
  r("playmovie", (_i, [n]) => {
    session.onPlayMovie(toStr(n ?? ""));
  });
  r("openshopfile", async (_i, [n]) => {
    await session.openShop(toStr(n));
  });
  r("closeshopfile", async (_i, [n]) => {
    await session.closeShop(toStr(n));
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
  // screen fades — gotospecial wraps set changes in screentoblack/
  // blacktoscreen; without them stair transitions look like nothing moved
  r("screentoblack", (_i, [, steps]) => {
    if (!session.fade.snapshot) session.fade.snapshot = session.captureFrame?.() ?? null;
    session.fade.queue.push({ to: 1, steps: Math.max(1, Number(steps) || 10) });
  });
  r("blacktoscreen", (_i, [, steps]) => {
    session.fade.queue.push({ to: 0, steps: Math.max(1, Number(steps) || 10) });
  });
  r("blackscreen", () => {
    session.fade.queue.length = 0;
    session.fade.snapshot = null;
    session.fade.level = 1;
  });
  r("currenttheme", () => "none");
  for (const noop of [
    "flushevents", "hidecursor", "showcursor", "debugger",
    "visualeffect", "mixclut",
    "exportclut", "clut",
  ]) {
    r(noop, () => {});
  }

  // ---- timing model (TI.EXE): delay / makeloop / makecricket / soundloop --
  // 1 script tick = 1/60 s; loops+crickets are serviced every 66 ms.

  // delay(n): suspend this script n/60 s while the engine keeps ticking
  r("delay", async (_i, [n]) => {
    await session.clock.sleep((toNum(n ?? 0) * 50) / 3);
  });
  r("makeloop", (_i, [kind, name, handler, period]) => {
    session.makeLoop(toStr(kind ?? ""), toStr(name ?? ""), toStr(handler ?? ""), toNum(period ?? 1));
  });
  r("stoploop", (_i, [kind, name]) => session.stopLoop(toStr(kind ?? ""), toStr(name ?? "")));
  r("pauseloop", (_i, [kind, name, flag]) =>
    session.pauseLoop(toStr(kind ?? ""), toStr(name ?? ""), truthy(flag ?? 1)),
  );
  r("isloop", (_i, [kind, name]) => (session.isLoop(toStr(kind ?? ""), toStr(name ?? "")) ? 1 : 0));
  r("countloops", () => session.loops.length);
  r("indextoloop", (_i, [idx]) => session.loops[toNum(idx ?? 0) - 1]?.name ?? "");

  r("makecricket", (_i, [name, x, y, radius, base, jitter]) => {
    session.makeCricket(
      toStr(name ?? ""), toNum(x ?? 0), toNum(y ?? 0),
      toNum(radius ?? 1), toNum(base ?? 0), toNum(jitter ?? -1),
    );
  });
  r("stopcricket", (_i, [name]) => session.stopCricket(toStr(name ?? "all")));
  r("pausecricket", (_i, [name, flag]) =>
    session.pauseCricket(toStr(name ?? "all"), truthy(flag ?? 1)),
  );
  r("iscricket", (_i, [name]) => (session.isCricket(toStr(name ?? "")) ? 1 : 0));
  r("countcrickets", () => session.crickets.length);
  r("indextocricket", (_i, [idx]) => session.crickets[toNum(idx ?? 0) - 1]?.name ?? "");

  r("soundloop", (_i, [name, flag]) => session.soundLoop(toStr(name ?? ""), truthy(flag ?? 1)));

  // forceupdate(): run the ambient service immediately (transitions do too)
  r("forceupdate", () => session.tickTime(session.clock.now + 66));

  // starxyz(name, axis): named world point from the set's actor/star table.
  // Axes: 1 = x, 2 = y (ground plane, same pair the camera/crickets use),
  // 3 = height, 4 = packed (x << 16 | y).
  const findStar = (name: Value) => {
    const n = toStr(name ?? "").toLowerCase();
    return session.currentBinding?.set.actors.find((a) => a.identifier.toLowerCase() === n);
  };
  r("starxyz", (_i, [name, axis]) => {
    const star = findStar(name);
    if (!star) {
      log(`starxyz: no star "${toStr(name ?? "")}" in ${session.currentSetName}`);
      return 0;
    }
    switch (toNum(axis ?? 1)) {
      case 1: return star.positionX;
      case 2: return star.positionZ;
      case 3: return star.positionY;
      case 4: return ((star.positionX & 0xffff) << 16) | (star.positionZ & 0xffff);
      default: return 0;
    }
  });

  // ---- actors (CST casts) --------------------------------------------------

  const actor = (name: Value) => session.actorRuntime.get(toStr(name));
  r("opencastfile", async (_i, [n]) => ((await session.openCastFile(toStr(n ?? ""))) ? 1 : 0));
  r("closecastfile", (_i, [n]) => session.closeCastFile(toStr(n ?? "")));
  r("actorexists", (_i, [n]) => (actor(n) ? 1 : 0));
  r("actorvisible", (_i, [n, v]) => {
    const a = actor(n);
    if (!a) return 0;
    if (v === undefined) return a.visible ? 1 : 0;
    a.visible = truthy(v);
  });
  r("actorhide", (_i, [n]) => {
    const a = actor(n);
    if (a) a.visible = false;
  });
  // actorset binds an actor to a set; it only draws there (like propset)
  r("actorset", (_i, [n, v]) => {
    const a = actor(n);
    if (!a) return "";
    if (v === undefined) return a.setName;
    a.setName = toStr(v).toLowerCase();
  });
  r("actorxyz", (_i, [n, x, y, z]) => {
    const a = actor(n);
    if (!a) return 0;
    if (x === undefined) return 0;
    // getter form actorxyz(name, axis): axis 1..3 like starxyz, 4 = packed
    if (y === undefined) {
      switch (toNum(x)) {
        case 1: return a.worldX;
        case 2: return a.worldY;
        case 3: return a.worldZ;
        case 4: return ((a.worldX & 0xffff) << 16) | (a.worldY & 0xffff);
        default: return 0;
      }
    }
    a.worldX = toNum(x);
    a.worldY = toNum(y);
    a.worldZ = toNum(z ?? 0);
  });
  // place an actor on a named star point of the current set; the getter
  // form returns the star the actor was last placed on (endwalk checks
  // for "custom" placements)
  r("actorstar", (_i, [n, starName]) => {
    const a = actor(n);
    if (!a) return "";
    if (starName === undefined) return a.starName;
    const star = findStar(starName);
    if (!star) {
      log(`actorstar: ${toStr(n)} -> "${toStr(starName)}" not found`);
      return 0;
    }
    a.worldX = star.positionX;
    a.worldY = star.positionZ;
    a.worldZ = star.positionY;
    a.deg = star.rotation8 & 0xff;
    a.starName = toStr(starName).toLowerCase();
  });
  r("actordeg", (_i, [n, v]) => {
    const a = actor(n);
    if (!a) return 0;
    if (v === undefined) return a.deg;
    a.deg = toNum(v) & 0xff;
  });
  r("actorpose", (_i, [n, v]) => {
    const a = actor(n);
    if (!a) return "";
    if (v === undefined) return a.poseName;
    a.poseName = toStr(v).toLowerCase();
    a.step = 0;
  });
  r("actorscale", (_i, [n, v]) => {
    const a = actor(n);
    if (!a) return 0;
    if (v === undefined) return a.scale;
    a.scale = toNum(v);
  });
  r("actorzclip", (_i, [n, v]) => {
    const a = actor(n);
    if (!a) return 0;
    if (v === undefined) return a.zclip;
    a.zclip = toNum(v);
  });
  r("actorspeed", (_i, [n, v]) => {
    const a = actor(n);
    if (!a) return 0;
    if (v === undefined) return a.speed;
    a.speed = toNum(v);
  });
  r("actorturn", (_i, [n, v]) => {
    const a = actor(n);
    if (!a) return 0;
    if (v === undefined) return a.turn;
    a.turn = toNum(v);
  });
  r("actorvalue", (_i, [n, v]) => {
    const a = actor(n);
    if (!a) return 0;
    if (v === undefined) return a.value;
    a.value = v;
  });
  r("actorowner", (_i, [n, v]) => {
    const a = actor(n);
    if (!a) return "";
    if (v === undefined) return a.owner;
    a.owner = v;
  });
  r("countactors", () => session.actorRuntime.actors.size);
  r("indextoactor", (_i, [idx]) => {
    return [...session.actorRuntime.actors.keys()][toNum(idx ?? 0) - 1] ?? "";
  });
  // walking: straight-line motion at the actor's per-set speed, walk pose
  // cycling, facing the direction of travel (session.startWalk)
  r("walktostar", (_i, [n, starName]) => {
    const star = findStar(starName);
    if (!actor(n) || !star) {
      log(`walktostar: ${toStr(n)} -> "${toStr(starName ?? "")}" not found`);
      return 0;
    }
    session.startWalk(toStr(n), star.positionX, star.positionZ, star.positionY);
    const a = actor(n)!;
    a.starName = toStr(starName).toLowerCase();
  });
  r("walktoxyz", (_i, [n, x, y, z]) => {
    if (!actor(n)) return 0;
    session.startWalk(toStr(n), toNum(x ?? 0), toNum(y ?? 0), toNum(z ?? 0));
  });
  // walkonpath(actor, fromStar|"resume", toStar): straight-line between
  // stars (the authored waypoint paths are a refinement for later)
  r("walkonpath", (_i, [n, from, to]) => {
    const a = actor(n);
    if (!a) return 0;
    const f = toStr(from ?? "").toLowerCase();
    if (f !== "resume") {
      const start = findStar(from);
      if (start) {
        a.worldX = start.positionX;
        a.worldY = start.positionZ;
        a.worldZ = start.positionY;
      }
    }
    const dest = findStar(to);
    if (!dest) {
      log(`walkonpath: star "${toStr(to ?? "")}" not found`);
      return 0;
    }
    session.startWalk(toStr(n), dest.positionX, dest.positionZ, dest.positionY);
    a.starName = toStr(to).toLowerCase();
  });
  r("iswalk", (_i, [n]) => (n !== undefined && session.isWalk(toStr(n)) ? 1 : 0));
  r("stopwalk", (_i, [n]) => {
    if (n !== undefined) session.stopWalk(toStr(n));
  });
  r("pausewalk", (_i, [n, flag]) => {
    if (n !== undefined) session.pauseWalk(toStr(n), truthy(flag ?? 1));
  });
  r("countwalks", () => session.walks.size);
  r("indextowalk", (_i, [idx]) => [...session.walks.keys()][toNum(idx ?? 0) - 1] ?? "");
  r("walkdest", (_i, [n]) => {
    const w = session.walks.get(toStr(n ?? "").toLowerCase());
    if (!w) return 0;
    return (((w.sx + w.dx) & 0xffff) << 16) | ((w.sy + w.dy) & 0xffff);
  });

  // ---- puppets (PUP conversations) ----------------------------------------

  r("openpuppetfile", async (_i, [n]) => ((await session.openPuppetFile(toStr(n ?? ""))) ? 1 : 0));
  r("closepuppetfile", () => session.closePuppetFile());
  r("currentpuppet", () => session.puppet?.name ?? "none");
  r("puppetspeak", (_i, [ident]) => session.puppetSpeak(toStr(ident ?? "")));
  r("puppetclear", () => session.puppetClear());
  r("puppetbevel", (_i, [text, id]) => session.puppetBevel(toStr(text ?? ""), toNum(id ?? 0)));
  r("puppetevent", (_i, [_timeout]) => session.puppetEvent());
  r("countpuppets", () => session.puppet?.scripts.size ?? 0);
  r("indextopuppet", (_i, [idx]) => {
    return [...(session.puppet?.scripts.keys() ?? [])][toNum(idx ?? 0) - 1] ?? "";
  });
  // stance/pose selection by dialogue ident ("bx2.07") — stance switching
  // is part of the lip-sync work; log once for now
  for (const stub of ["puppetbase", "puppetparam", "puppetvisible", "puppetsubtitle", "puppetgrab", "puppetscramble"]) {
    r(stub, () => {});
  }
  // helpers used around conversations that live outside any script
  r("cameraxyz", (_i, [axis]) => {
    const lis = session.listener();
    if (!lis) return 0;
    switch (toNum(axis ?? 1)) {
      case 1: return lis.x;
      case 2: return lis.y;
      case 4: return ((lis.x & 0xffff) << 16) | (lis.y & 0xffff);
      default: return 0;
    }
  });
  // calcdeg(fromPacked, toPacked): bearing between two packed (x<<16|y)
  // points in the engine's 0..255 angle space (turntodeg targets)
  r("calcdeg", (_i, [from, to]) => {
    const fx = (toNum(from ?? 0) >> 16) & 0xffff;
    const fy = toNum(from ?? 0) & 0xffff;
    const tx = (toNum(to ?? 0) >> 16) & 0xffff;
    const ty = toNum(to ?? 0) & 0xffff;
    return Math.round((Math.atan2(ty - fy, tx - fx) * 256) / (2 * Math.PI)) & 0xff;
  });
  r("turntodeg", (_i, [n, deg]) => {
    const a = actor(n);
    if (a) a.deg = toNum(deg ?? 0) & 0xff;
  });
  // primitives behind the cast library's realdist()/facing helpers:
  // playerxyz(4) = the camera's packed ground position, calcdist between
  // two packed (x<<16|y) points
  r("playerxyz", (_i, [axis]) => {
    const lis = session.listener();
    if (!lis) return 0;
    switch (toNum(axis ?? 1)) {
      case 1: return lis.x;
      case 2: return lis.y;
      case 4: return ((lis.x & 0xffff) << 16) | (lis.y & 0xffff);
      default: return 0;
    }
  });
  r("calcdist", (_i, [a, b]) => {
    const ax = (toNum(a ?? 0) >> 16) & 0xffff;
    const ay = toNum(a ?? 0) & 0xffff;
    const bx = (toNum(b ?? 0) >> 16) & 0xffff;
    const by = toNum(b ?? 0) & 0xffff;
    return Math.round(Math.hypot(bx - ax, by - ay));
  });
}
