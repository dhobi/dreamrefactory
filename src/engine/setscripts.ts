import { SetFile } from "../df/set";
import { ScriptInstance, Value } from "./interp";
import type { GameSession } from "./session";

// The game-builtin registry lives in ./builtins (split by command family);
// re-exported here so existing imports (`{ registerGameBuiltins }` in
// session.ts) keep resolving from "./setscripts".
export { registerGameBuiltins } from "./builtins";

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
    const chain = [
      sceneIdx >= 0 ? this.sceneScripts[sceneIdx] : null,
      this.main,
      this.session.stage,
      ...this.session.bootScripts,
    ];
    for (const inst of chain) {
      if (!inst) continue;
      try {
        // Consumption is decided by THIS handler's own signal — whether it
        // ran without passcode-ing on. The shared interp.eventConsumed flag
        // must NOT be used here: a passcode-ing handler routinely fires
        // sub-events (sendtoactor(setupactor()), sendtoprop(...)) whose own
        // handlers end in exitcode, which sets that global flag as a side
        // effect. Trusting it would let e.g. recept1c's openset — which does
        // sendtoactor("elev", setupactor()) then passcode — falsely look
        // consumed, skipping boot2's openset (setupsound) and leaving the
        // room silent / on the wrong theme. Reset per iteration so the flag
        // reflects only this dispatch for any code that reads it downstream.
        interp.eventConsumed = false;
        const res = await interp.runHandler(inst, handler, [], { me: inst.name, target: "" });
        if (res.handled && !res.passed) return;
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
   * View change within a scene (turning). Two things happen:
   *  1. the BOOT defaults of closescene run — closes open doors/signs, resets
   *     the nav arrow — WITHOUT the scene script's own scene-exit logic (sounds
   *     etc. keep running across a turn);
   *  2. the current scene's own openscene re-fires. In DreamFactory openscene
   *     is a per-VIEW event, not per-scene: 33 of 51 shipped openscene handlers
   *     gate on currentview() and only act when you turn to face a particular
   *     view (HALLA's "Sasha walks down the hall" at view62; DECKBD's Max
   *     calling you over when you see him; etc.). Firing scene-entry openscene
   *     only left all of those dead on turns. We run ONLY the scene script here
   *     (not main/stage/boot): the boot openscene does per-scene-entry work
   *     (nav-arrow rebuild, the mission-4 doomsday-clock tick) that must NOT
   *     repeat on every turn. The view-gated scene handlers are self-guarded
   *     (actorstar/actorowner/flag checks) so re-entry is idempotent.
   */
  async viewChanged(sceneIdx = -1): Promise<void> {
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
    const scene = sceneIdx >= 0 ? this.sceneScripts[sceneIdx] : null;
    if (scene) {
      interp.eventConsumed = false;
      try {
        await interp.runHandler(scene, "openscene", [], { me: scene.name, target: "" });
      } catch (e) {
        this.onLog(`script error in ${scene.name}.openscene (view change): ${(e as Error).message}`);
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
