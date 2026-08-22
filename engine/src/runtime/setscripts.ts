import { SetFile } from "../df/set";
import { Frame, ScriptInstance, Value } from "./interp";
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

  onLog: (line: string) => void = () => {};

  constructor(
    readonly set: SetFile,
    readonly session: GameSession,
  ) {
    session.currentBinding = this;
    /**
     * The set's OWN name, falling back to the opened file's basename.
     *
     * This used to prefer the file, on the belief that TAOOT's `DECKBD.SET` calls
     * itself "decka" while scripts address it as "deckbd". It does not: across the
     * seven editions in `gamefiles/`, all 495 sets carry an internal name and not
     * one of them differs from its file's basename. So on Titanic the two rules
     * are the same rule.
     *
     * Dust separates them on purpose. `nite.set` calls itself **town** and
     * `nitecour.set` **court** — each is the same place after dark — and its stage
     * turns on the distinction: `initall`'s
     *
     *     if currentset () = newname       (newname is "town", the set is nite.set)
     *
     * is what carries your standpoint across a day/night change, and the whole town
     * cast is bound with `actorset (me, "town")`, so under the file's name nobody
     * is standing in the night town at all. Four rooms differ the other way
     * (`apoth.set` is "drugs", `undertak.set` is "under").
     */
    session.currentSetName = set.setName.toLowerCase() || session.currentSetFile;
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
   * set main → stage → boot scripts. Boot's defaults matter — e.g. TAOOT's
   * closescene closes any open door (sendtoprop("door", initprop())).
   */
  private async fireLifecycle(handler: string, sceneIdx: number): Promise<void> {
    // A load fires NO lifecycle at all — not the departing room's closeset, not
    // the arriving room's openset/openscene. The original's load rebuilds the
    // room through the engine's set machinery without ever reaching the script
    // runners (opengame's restore at 0x414080; see GameSession.restoringSave),
    // and everything those scripts would produce comes out of the file instead
    // (#143). The scene is still recorded as current, so the first turn or step
    // re-fires openscene normally.
    if (this.session.restoringSave) return;
    const interp = this.session.interp;
    const chain = [
      sceneIdx >= 0 ? this.sceneScripts[sceneIdx] : null,
      this.main,
      this.session.stageScript,
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
        // effect. Trusting it would let e.g. TAOOT's recept1c openset — which does
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
   * The lifecycle a JUMP owes — `SetViewer.teleport`'s cross-view cut. The
   * BOOT defaults of closescene run (closes open doors/signs, reds the nav
   * arrow — #71's mid-air door is what firing nothing looked like), then the
   * full openscene chain for the view now being stood at.
   *
   * A turn or walk no longer comes through here: TI.EXE's movement fires the
   * full closescene chain at the move's START and the full openscene chain at
   * its settle (see `SetViewer.departScene` for the disassembly), so the
   * viewer's turn()/walk() call closeScene/openScene directly. What this keeps
   * from that era is the evidence that `openscene` is a per-VIEW event, which
   * is why every settle re-fires it:
   *
   *  - 33 of 51 shipped openscene handlers gate on currentview() and only act
   *    when you come to face a particular view (HALLA's "Sasha walks down the
   *    hall" at view62; DECKBD's Max calling you over when you see him). The
   *    view-gated handlers are self-guarded (actorstar/actorowner/flag
   *    checks), so re-entry is idempotent.
   *  - BOOTFILE's arm does setuparrow(), setupsigns() and the mission-4
   *    sinking clock's `sec = sec + 1` — the last is what makes the original's
   *    watch run at double speed while you spin in place (#127).
   *  - The smokestack maze's openscene is on the SET MAIN and reads the view —
   *    `blocked = pathblocked(currentscene(), currentview())` — and the set's
   *    keydown swallows `uparrow` while `blocked` (#88).
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
    await this.viewSettled(sceneIdx);
  }

  /**
   * The ARRIVAL half on its own: re-run `openscene` for the view now being stood
   * at, without the `closescene` that {@link viewChanged} runs first.
   *
   * For a jump that did not leave anywhere — a script cut onto the standpoint
   * you are already on. `closescene` is what puts the shared `door` prop away
   * and reds the arrow, and firing it for an arrival that left nothing both
   * races the boot walk's own lifecycle (see `SetViewer.teleport`) and closes
   * a door that is legitimately open. (Turns and walks fire their own
   * closescene at the move's start — `SetViewer.departScene` — and settle
   * through openScene, so this is the jump path's half only.)
   */
  async viewSettled(sceneIdx = -1): Promise<void> {
    const interp = this.session.interp;
    const scene = sceneIdx >= 0 ? this.sceneScripts[sceneIdx] : null;
    for (const inst of [scene, this.main, this.session.stageScript, ...this.session.bootScripts]) {
      if (!inst) continue;
      interp.eventConsumed = false;
      try {
        const res = await interp.runHandler(inst, "openscene", [], { me: inst.name, target: "" });
        // handled and not passed on: the chain ends here, as it does on entry
        // (fireLifecycle). A `passcode` carries on to the next link.
        if (res.handled && !res.passed) return;
      } catch (e) {
        this.onLog(`script error in ${inst.name}.openscene (view change): ${(e as Error).message}`);
      }
    }
  }

  objectScript(sceneIdx: number, viewIdx: number, objIdx: number): ScriptInstance | null {
    return this.objectScripts.get(`${sceneIdx}:${viewIdx}:${objIdx}`) ?? null;
  }

  /**
   * sendtopainting(scene, view, paint, handler(args)): dispatch an event to a
   * named hotspot (2D "painting" object) in a specific view, resolving the same
   * object → scene → main → stage chain a real click uses. Boot's keydown does
   * this for SPACE (the door opener): `sendtopainting(currentscene(),
   * currentview(), "door", mousedown(0))`. Returns whether a handler consumed it.
   */
  async paintingEvent(
    sceneName: string,
    viewName: string,
    paintName: string,
    handler: string,
    args: Value[],
    /** the frame the `sendtopainting` was written in — see {@link Frame.dispatch} */
    parent?: Frame,
  ): Promise<boolean> {
    const sceneIdx = this.set.scenes.findIndex(
      (s) => s.sceneName.toLowerCase() === sceneName.toLowerCase(),
    );
    if (sceneIdx < 0) return false;
    const views = this.set.scenes[sceneIdx].views;
    const viewIdx = views.findIndex((v) => v.viewName.toLowerCase() === viewName.toLowerCase());
    if (viewIdx < 0) return false;
    const objIdx = views[viewIdx].objects.findIndex(
      (o) => o.identifier.toLowerCase() === paintName.toLowerCase(),
    );
    if (objIdx < 0) return false;
    return this.fireChain(sceneIdx, viewIdx, objIdx, handler, paintName, args, parent);
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
    args: Value[] = [identifier],
    parent?: Frame,
  ): Promise<boolean> {
    const interp = this.session.interp;
    interp.eventConsumed = false;
    const chain = [
      this.objectScript(sceneIdx, viewIdx, objIdx),
      this.sceneScripts[sceneIdx],
      this.main,
      this.session.stageScript,
    ];
    for (const inst of chain) {
      if (!inst) continue;
      try {
        const res = await interp.runHandler(inst, handler, args, {
          me: inst.name,
          target: identifier,
        }, parent);
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
    this.session.cursorName = "";
    await this.fireChain(sceneIdx, viewIdx, objIdx, "setcursor", identifier);
    return this.session.cursorName;
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
    // Only the ROUTER is dispatched here — the boot's own keydown, which maps the
    // player's movement keys and then re-routes with `sendtoscene(currentscene(),
    // keydown(arg))`. Everything else the press reaches, the scene and the boot's
    // default movement included, it reaches along that re-route, which is what
    // carries the MAPPED key (see Session.sendEvent). Running every boot container
    // here instead gave the default the raw key and left the panel's A/W/D
    // bindings dead (#14).
    const router = this.session.bootScripts.find((b) => b.script.codes.has("keydown"));
    const chain = router ? [router] : [this.sceneScripts[sceneIdx], this.main];
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
    if (this.session.stageScript && lower === this.session.stageScript.name.toLowerCase()) {
      return this.session.stageScript;
    }
    const shop = this.session.shopMain(lower);
    if (shop) return shop;
    const flat = this.session.flatScripts.get(lower);
    if (flat) return flat;
    if (lower === "boot") return this.session.boot;
    return null;
  }

  /** shops are session-scoped (TAOOT: boot's house.shp survives set changes) */
  openShop(fileName: string): Promise<boolean> {
    return this.session.openShop(fileName);
  }

  closeShop(fileName: string): Promise<void> {
    return this.session.closeShop(fileName);
  }
}
