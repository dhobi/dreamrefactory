import { SetFile } from "../df/set";
import { ScriptInstance, Value, toNum, toStr, truthy } from "./interp";
import { frameIndexForDegree } from "./props";
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
    "sendtopuppet", "sendtocast", "sendtostage", "sendtoflat",
    "sendtopainting", "sendtoboot", "sendtopost", "sendtoserver",
    // "fx" variants target the same object; our props have a single script,
    // so an fx call resolves the same handler as its non-fx sibling.
    // sendtopuppetfx runs a handler on the loaded puppet and returns its value —
    // blackjack's newgame asks the dealer `sendtopuppetfx("boot script",
    // playagain())` whether to deal again. Without it registered as a deferred
    // form, the playagain() argument evaluated locally and recursed forever, so
    // a finished hand hung instead of offering another.
    "sendtopropfx", "sendtostagefx", "sendtopuppetfx",
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

  // sendtobutton(flat, "name", handler(args)): unlike the generic sendto*,
  // this has THREE args — a flat, a region NAME, then the deferred call. It
  // dispatches to a flat's named click-region ("button"), the drop-target /
  // hotspot system stage mini-games use. sendtobuttonfx resolves the same.
  for (const cmd of ["sendtobutton", "sendtobuttonfx"]) {
    interp.registerSpecial(cmd, async (ip, argExprs, frame) => {
      const flat = toStr(await ip.evalExpr(argExprs[0], frame));
      const name = toStr(await ip.evalExpr(argExprs[1], frame));
      const deferred = argExprs[2];
      if (!deferred || deferred.t !== "call") {
        log(`${cmd}: no deferred call argument`);
        return 0;
      }
      const args = await ip.evalArgs(deferred.args, frame);
      return session.sendToButton(flat, name, deferred.name, args, frame.ctx.me);
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
  r("flattoindex", (_i, [n]) => session.flatToIndex(toStr(n ?? "")));
  // transtoflat/transfromflat: enter/leave a full-screen overlay stage (the
  // deck map opens via the "map" prop's open() -> transtoflat("map.stg"))
  r("transtoflat", (_i, [n]) => session.transToFlat(toStr(n ?? "")).then(() => {}));
  r("transfromflat", () => session.transFromFlat().then(() => {}));

  // prop commands — getter/setter by arity
  const prop = (name: Value) => session.propRuntime.get(toStr(name));
  r("propexists", (_i, [n]) => (prop(n) ? 1 : 0));
  r("propvisible", (_i, [n, v]) => {
    const p = prop(n);
    if (!p) return 0;
    if (v === undefined) return p.visible ? 1 : 0;
    p.visible = truthy(v);
    // clearmessagebox() wipes the drawstring text by flashing an opaque
    // "clean strip" prop over it (visible → forceupdate → invisible). Our
    // props are non-destructive, so instead we drop the text layer when that
    // eraser prop is shown.
    if (p.visible && toStr(n).toLowerCase() === "messageboxclear") session.clearTextOverlay();
  });
  r("propview", (_i, [n, v]) => {
    const p = prop(n);
    if (!p) return "";
    if (v === undefined) return p.stateName;
    p.stateName = toStr(v).toLowerCase();
    p.lastTick = 0;
    const st = p.state();
    // A deg-locked prop entering a small (<=2 frame) VARIANT state keeps its
    // selected variant instead of animating through the alternatives: the life
    // preserver / map / watch-lid "run" hold a mission (deg 0) + tour (deg 1)
    // pair, so auto-animating them ended every click on the last frame (tour).
    // Multi-frame states (open/close swings, 6-12 frames with repeating rotation
    // degrees) are real ANIMATIONS and still play — clearing frameLocked so the
    // tick advances them (this is what un-froze the watch/bag/map close).
    if (p.degVariants && st && st.frames.length <= 2) {
      p.frameIdx = frameIndexForDegree(st, Number(p.deg) || 0);
      p.frameLocked = true;
      p.animating = false;
    } else {
      p.frameIdx = 0;
      p.frameLocked = false;
      // entering a state plays its frames once (a door opens and holds open); a
      // single-frame state has nothing to animate. A prop only made visible
      // (never propview'd) keeps animating=false and holds frame 0.
      p.animating = !!st && st.frames.length > 1;
    }
  });
  r("propxy", (_i, [n, x, y]) => {
    const p = prop(n);
    if (!p || x === undefined) return 0;
    // getter: propxy(name, axis) — 1 = screen x, 2 = screen y. The wireless
    // tuner reads the needle's y this way (its y position IS the frequency:
    // `propvalue("tunerneedle", propxy("tunerneedle", 2))`).
    if (y === undefined) return toNum(x) === 2 ? p.anchorY : p.anchorX;
    p.anchorX = Number(x) || 0;
    p.anchorY = Number(y) || 0;
    p.worldSpace = false; // screen placement (band/inventory/flat)
    return 0;
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
  // propdeg selects a discrete frame of a rotational/selector prop (the deck
  // map's "buttons" highlight: 9 frames, deg 0..7 = deck 1..8, deg 8 = none).
  // The pinned frame overrides auto-animation until propview() changes state.
  r("propdeg", (_i, [n, v]) => {
    const p = prop(n);
    if (!p) return 0;
    if (v === undefined) return p.deg;
    p.deg = v;
    // A world prop's propdeg is an ORIENTATION (0..255), not a frame index: the
    // frame is chosen at draw time from this facing vs. the camera bearing (a
    // 32-view card table, a 21-view fire). Clamping it as a frame index froze
    // blkjacktable/flames on their last frame. Screen-space props keep the
    // direct selector behaviour (deck-map deck highlight, boiler/turbine sliders).
    if (p.worldSpace) {
      p.directional = true;
      return;
    }
    // A selector prop's frames carry stored degrees (SHP +40) that are usually
    // offset from the frame index — the blackjack score readout holds 2,3,…,21,
    // BUST=22, BLACKJACK=23, so propdeg(total) must pick the frame WHOSE DEGREE
    // is `total`, not the total-th frame (which read ~2 high). frameIndexForDegree
    // matches the degree; deck/valve selectors happen to store degree==index.
    p.degVariants = true; // its states are deg-indexed variants (see propview)
    const st = p.state();
    if (st && st.frames.length) {
      p.frameIdx = frameIndexForDegree(st, Number(v) || 0);
      p.frameLocked = true;
    }
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
    // the sound channel honours soundloop() flags + tracks looping handles
    if (channel === "sound") {
      session.playSound(toStr(name), overlap);
      return;
    }
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
  // haltsound(n): stops looping sounds too — the crank cleanup relies on it
  // to end the gramophone hiss (an untracked loop would outlive the stage)
  r("haltsound", () => session.haltSounds());
  r("haltvoice", () => session.audio.halt("voice"));
  r("halttheme", () => session.audio.halt("theme"));
  // sounddone/voicedone: scripts spin `while not voicedone() endwhile` to wait
  // for a line/SFX to finish (the Enigma power switch, many puppet beats). That
  // empty-body loop has no other yield, so the poll itself must give up a real
  // frame — otherwise it spins synchronously and the audio can never progress
  // to "done". Mirrors stilldown; headless returns immediately (NullAudioSink
  // is always done, so the wait resolves at once and stays deterministic).
  const audioDonePoll = (channel: "sound" | "voice") => async () => {
    if (session.hasRealFrames) {
      session.realYieldSeq++;
      await session.nextFrame();
    }
    return session.audio.isDone(channel) ? 1 : 0;
  };
  r("sounddone", audioDonePoll("sound"));
  r("voicedone", audioDonePoll("voice"));
  r("playtheme", (_i, [n]) => {
    const theme = session.audioLib.theme(n === undefined ? undefined : toStr(n));
    if (!theme) {
      log(`playtheme: no theme available${n !== undefined ? ` (${toStr(n)})` : ""}`);
      return;
    }
    session.audio.play("theme", theme, { loop: true });
    session.currentThemeName = n === undefined ? "none" : toStr(n);
  });
  // playnewtheme(name): swap the looping theme to a specific track/bank. Puzzle
  // scripts save the prior theme via currenttheme() and restore it afterwards
  // (the gramophone plays a record over the ambient theme, then puts it back).
  r("playnewtheme", (_i, [n]) => {
    const name = toStr(n ?? "");
    if (name === "none" || name === "") {
      session.audio.halt("theme");
      session.currentThemeName = "none";
      return;
    }
    const theme = session.audioLib.theme(name);
    if (!theme) {
      log(`playnewtheme: no theme "${name}"`);
      return;
    }
    session.audio.play("theme", theme, { loop: true });
    session.currentThemeName = name;
  });
  r("opentrackfile", async (_i, [n]) => {
    await session.openTrackFile(toStr(n));
  });
  r("closetrackfile", (_i, [n]) => {
    // Only unload the bank — do NOT stop the theme. Set travel closes and
    // reopens theme tracks around transitions (BOOTFILE closes deckb/deckc/…
    // then setupsound reopens the destination's), so halting the theme here
    // would silence normal room-to-room music. A theme ends only when
    // explicitly replaced (playnewtheme) or halted (halttheme/playnewtheme "none").
    session.audioLib.closeBank(toStr(n ?? ""));
  });

  // string helper used by boot logic: findword("a,b,c", ",", 2) -> "b"
  // word list = a string split on a separator; an EMPTY (or omitted) delimiter
  // means the default separator, a space (CyberFlix convention). saveprops
  // strings ("1 0 1 …", built by putword) round-trip through this.
  const wordSep = (delim: Value) => {
    const d = delim === undefined ? "" : toStr(delim);
    return d === "" ? " " : d;
  };
  r("findword", (_i, [s, delim, idx]) => {
    const parts = toStr(s ?? "").split(wordSep(delim));
    return parts[(Number(idx) || 1) - 1] ?? "";
  });
  // putword(str, delim, idx, word): replace the idx-th (1-based) word, padding
  // with empty words when idx is past the end so an empty string grows into a
  // fixed-slot list (hideenigma/hidetrunk save each prop's visibility by slot).
  r("putword", (_i, [s, delim, idx, word]) => {
    const sep = wordSep(delim);
    const i = Math.max(1, Number(idx) || 1) - 1;
    const parts = toStr(s ?? "") === "" ? [] : toStr(s ?? "").split(sep);
    while (parts.length <= i) parts.push("");
    parts[i] = toStr(word ?? "");
    return parts.join(sep);
  });
  r("stringlength", (_i, [s]) => toStr(s ?? "").length);
  // variable(name[, val]): dynamic global access by computed name — getter with
  // one arg, setter with two. Blackjack tracks per-side state this way
  // (variable(who @ "count") -> playercount/dealercount, variable(who @
  // "downcard", card)). Reads/writes the same global table as named globals.
  r("variable", (_i, [name, val]) => {
    const key = toStr(name ?? "");
    if (val === undefined) return interp.globals.get(key) ?? 0;
    interp.globals.set(key, val);
    return 0;
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
  // currenttheme([layer]): the looping theme currently playing (the layer arg
  // selects a mix channel in TI.EXE; we track a single theme, so it's ignored).
  r("currenttheme", () => session.currentThemeName);
  // framerate([n]): getter/setter for the engine's target frame cadence. Drag
  // loops save it, drop to a slow rate to pace the rotate (turbine valves:
  // `rate = framerate(); framerate(2); …; framerate(rate)`), then restore. Our
  // poll loops pace on real rAF frames via forceupdate(), so this only needs to
  // round-trip a value — store it so the save/restore reads back consistently.
  r("framerate", (_i, [n]) => {
    if (n === undefined) return session.frameRate;
    session.frameRate = toNum(n);
    return 0;
  });
  // themevol(track, vol): dynamic theme loudness (0..255) — the turbine hum
  // swells with electrical output. No per-channel volume control on the audio
  // sink yet; a no-op that keeps scripts happy (audio-mix polish, not gameplay).
  r("themevol", () => {});
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

  // forceupdate(): advance one engine step, then yield a real frame so the
  // browser renders and delivers pending input. Script poll loops (the crank
  // play loop `while done=0 { forceupdate(); mouse(); button() }`) depend on
  // this yield to ever see the click that ends them — a synchronous tick alone
  // would spin forever. The realYieldSeq bump spares the loop from the guard.
  r("forceupdate", async () => {
    // With real frames, the rAF loop advances the clock with REAL time each
    // frame — self-advancing +66 here on top of that races the sim clock
    // ahead of real time (4x at 60fps), and every later clock.sleep (trackbut
    // after a long crank play) stalls until real time catches back up. So in
    // the browser forceupdate only waits a frame; the tick does the rest.
    // Headless has no frame source, so it self-advances one 66 ms step —
    // which also keeps tests deterministic (one call = one service step).
    if (!session.hasRealFrames) {
      session.tickTime(session.clock.now + 66);
    } else {
      session.realYieldSeq++;
    }
    await session.nextFrame();
  });

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

  // propstar(name, star): place a prop at a named world point of the current
  // set — the world-space twin of propxyz. Set-decoration props (the smoking-
  // room card table, the fireplace flames, cafe/bath tables, potted plants) use
  // it instead of raw coordinates. Without it these stayed screen-space overlays
  // pinned at the anchor centre, floating in the middle of every view. The star
  // table is the SET's actor table (findStar); rotation seeds the facing, which
  // a following propdeg() may override.
  r("propstar", (_i, [n, starName]) => {
    const p = prop(n);
    if (!p) return "";
    if (starName === undefined) return p.starName;
    const star = findStar(starName);
    if (star) {
      p.worldSpace = true;
      p.worldX = star.positionX;
      p.worldY = star.positionZ;
      p.worldZ = star.positionY;
      p.deg = star.rotation8 & 0xff;
    }
    p.starName = toStr(starName).toLowerCase();
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
    // placing at a real star teleports the actor there; a value that isn't a
    // star (the "walkonpath"/"custom"/"resume" sentinels, or a packed point)
    // is just stored — the walk-resume logic reads these back
    const star = findStar(starName);
    if (star) {
      a.worldX = star.positionX;
      a.worldY = star.positionZ;
      a.worldZ = star.positionY;
      a.deg = star.rotation8 & 0xff;
    }
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
  // walkonpath(actor, fromStar|"resume", toStar|point): walk from one star to
  // another. `from`="resume" keeps the current position; otherwise the actor
  // teleports to `from` first. `to` is a star name, or a packed point (the
  // value walkdest() returns — the talk-interrupt/resume path in GANG.CST
  // saves the destination and resumes toward it). While walking, actorstar()
  // reports the sentinel "walkonpath" (how the resume logic detects a path
  // walk); on arrival it settles on the destination star.
  r("walkonpath", (_i, [n, from, to]) => {
    const a = actor(n);
    if (!a) return 0;
    if (toStr(from ?? "").toLowerCase() !== "resume") {
      const start = findStar(from);
      if (start) {
        a.worldX = start.positionX;
        a.worldY = start.positionZ;
        a.worldZ = start.positionY;
      }
    }
    const dest = findStar(to);
    let tx: number, ty: number, tz: number, arriveStar: string;
    if (dest) {
      tx = dest.positionX; ty = dest.positionZ; tz = dest.positionY;
      arriveStar = toStr(to).toLowerCase();
    } else if (to !== undefined && to !== "" && !isNaN(Number(to))) {
      const pt = toNum(to); // packed (x<<16)|y from walkdest(); z stays current
      tx = (((pt >> 16) & 0xffff) ^ 0x8000) - 0x8000;
      ty = ((pt & 0xffff) ^ 0x8000) - 0x8000;
      tz = a.worldZ;
      arriveStar = "walkonpath"; // no named destination; keep the sentinel
    } else {
      log(`walkonpath: star "${toStr(to ?? "")}" not found`);
      return 0;
    }
    a.starName = "walkonpath"; // sentinel while moving
    session.startWalk(toStr(n), tx, ty, tz, arriveStar);
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
  // puppetbase(ident): seat the character in a line's resting pose (bx2 with/
  // without the baby); "" reverts to the neutral opening pose
  r("puppetbase", (_i, [ident]) => session.puppetBase(toStr(ident ?? "")));
  // puppetvisible(v): show/hide the conversation close-up while keeping the
  // puppet LOADED. Blackjack toggles this to swap between the dealer and the
  // table (newgame hides Buick to deal; playagain shows him to ask again).
  // Without it the dealer stayed drawn over the table and the game "hung".
  r("puppetvisible", (_i, [v]) => {
    const p = session.puppet;
    if (!p) return 0;
    if (v === undefined) return p.visible ? 1 : 0;
    p.visible = truthy(v);
  });
  // remaining puppet effects are rare and unverified: puppetparam (gesture
  // params), puppetsubtitle (override text), puppetgrab (hold an item in-frame),
  // puppetscramble (garbled face)
  for (const stub of ["puppetparam", "puppetsubtitle", "puppetgrab", "puppetscramble"]) {
    r(stub, () => {});
  }

  // ---- points & live pointer (mouse/button) --------------------------------
  // Points pack as (x<<16)|y with signed 16-bit halves — the same layout as
  // cameraxyz/actorxyz axis 4. Stage/UI scripts hit-test clicks themselves by
  // reading mouse() (e.g. propxy(me, pointx(mouse()), pointy(mouse()))), so the
  // engine only has to expose the live cursor, not resolve regions.
  const s16 = (v: number): number => ((v & 0xffff) ^ 0x8000) - 0x8000;
  r("makepoint", (_i, [x, y]) => ((toNum(x ?? 0) & 0xffff) << 16) | (toNum(y ?? 0) & 0xffff));
  r("pointx", (_i, [p]) => s16((toNum(p ?? 0) >> 16) & 0xffff));
  r("pointy", (_i, [p]) => s16(toNum(p ?? 0) & 0xffff));
  r("mouse", () => session.pointerPoint());
  // button(): is the mouse button held? Scripts wait for a click with an
  // empty-body poll `while not (button() & pointinprop(...)) endwhile` (the
  // Enigma result dismissal), which has no other yield — so, like stilldown,
  // the poll gives up a real frame so input can arrive. Headless returns at
  // once (button state is set directly; keeps the runaway guard live).
  r("button", async () => {
    if (session.hasRealFrames) {
      session.realYieldSeq++;
      await session.nextFrame();
    }
    return session.pointerDown ? 1 : 0;
  });
  // flushevents(): discard queued input so the click that ended a drag/poll
  // loop doesn't leak into the next interaction. Our host dispatches clicks one
  // at a time (a mousedown handler runs to completion before the next click),
  // so there is no queue to drain — a no-op that keeps scripts happy.
  r("flushevents", () => {});
  // mousedown(point): synthesise a click at a point. Only reached by scripts
  // that replay a press (wireless rx()'s ok-interrupt); return the point.
  r("mousedown", (_i, [p]) => toNum(p ?? 0));
  // ---- persistent text (drawstring/stringwidth) ----------------------------
  // drawstring(text, point, color, size): paint text at a screen point into
  // the persistent text layer (composited after props, cleared per flat).
  r("drawstring", (_i, [text, point, color, size]) => {
    const t = toStr(text ?? "");
    const pt = toNum(point ?? 0);
    const x = s16((pt >> 16) & 0xffff);
    const y = s16(pt & 0xffff);
    const sz = toNum(size ?? 12);
    const col = toNum(color ?? 0);
    const ov = session.textOverlay;
    const i = ov.findIndex((e) => e.x === x && e.y === y && e.size === sz);
    const entry = { text: t, x, y, color: col, size: sz };
    if (i >= 0) ov[i] = entry;
    else ov.push(entry);
    return 0;
  });
  // stringwidth(text, color, size): pixel width for pen advance. Must match
  // what drawstring actually paints, so measure with the render font.
  r("stringwidth", (_i, [text, , size]) => {
    const t = toStr(text ?? "");
    const sz = toNum(size ?? 12);
    return session.measureText
      ? Math.round(session.measureText(t, sz))
      : Math.ceil(t.length * sz * 0.6);
  });
  // stilldown(): true while the mouse button is held. Drag loops spin on it
  // (`while stilldown() { propdeg(me, ...); forceupdate() }`), so each check
  // yields one frame — letting the rAF loop advance the clock, deliver the
  // next pointermove/pointerup, and repaint before the next iteration.
  r("stilldown", async () => {
    await session.clock.sleep(16);
    if (session.hasRealFrames) session.realYieldSeq++;
    return session.pointerDown ? 1 : 0;
  });
  // a "button" is a prop drawn at (x,y); its screen rect comes from the frame's
  // stored offset (rect = anchor - offset, size = frame w/h)
  const buttonRect = (name: string, x: number, y: number) => {
    const p = session.propRuntime.get(name);
    const st = p?.state();
    if (!p || !st || !st.frames.length) return null;
    const f = p.shop.frame(st.frames[Math.min(p.frameIdx, st.frames.length - 1)]);
    return { p, x0: x - f.posXraw, y0: y - f.posYraw, w: f.width, h: f.height };
  };
  const inButton = (name: string, x: number, y: number) => {
    const r0 = buttonRect(name, x, y);
    return !!r0 && session.pointerX >= r0.x0 && session.pointerX < r0.x0 + r0.w &&
      session.pointerY >= r0.y0 && session.pointerY < r0.y0 + r0.h;
  };
  // pointinbutton(flat, name, point): is `point` inside the flat's named
  // click-region? This is the stage "button" system (drop targets, OK, dials);
  // scripts pass currentflat() and either the click arg or mouse() as the point.
  r("pointinbutton", (_i, [flat, name, point]) => {
    const region = session.flatRegion(toStr(flat ?? ""), toStr(name ?? ""));
    if (!region) return 0;
    const pt = toNum(point ?? 0);
    const x = s16((pt >> 16) & 0xffff), y = s16(pt & 0xffff);
    return x >= region.left && x <= region.right && y >= region.top && y <= region.bottom ? 1 : 0;
  });
  // pointinprop(name, point): is `point` inside the prop's drawn screen rect?
  // (rect = anchor - frame offset, size = frame w/h — the same geometry as a
  // UI button prop.) Used for grabbing draggable props (crank, inventory bags).
  r("pointinprop", (_i, [n, point]) => {
    const p = prop(n);
    const st = p?.state();
    if (!p || !st || !st.frames.length) return 0;
    const f = p.shop.frame(st.frames[Math.min(p.frameIdx, st.frames.length - 1)]);
    const x0 = p.anchorX - f.posXraw, y0 = p.anchorY - f.posYraw;
    const pt = toNum(point ?? 0);
    const x = s16((pt >> 16) & 0xffff), y = s16(pt & 0xffff);
    return x >= x0 && x < x0 + f.width && y >= y0 && y < y0 + f.height ? 1 : 0;
  });
  // trackbut(name, x, y): a push-button. Called from a button's mousedown (so
  // the button is already pressed); tracks the hold (showing the prop as the
  // pressed highlight) and returns 1 iff released while still over it.
  r("trackbut", async (_i, [n, x, y]) => {
    const name = toStr(n ?? "");
    const ax = toNum(x ?? 256), ay = toNum(y ?? 192);
    const p = session.propRuntime.get(name);
    if (!p) return 0;
    p.anchorX = ax;
    p.anchorY = ay;
    p.worldSpace = false;
    const wasVisible = p.visible;
    let inside = inButton(name, ax, ay);
    while (session.pointerDown) {
      inside = inButton(name, ax, ay);
      p.visible = inside; // pressed highlight only while held over the button
      await session.clock.sleep(16);
    }
    p.visible = wasVisible;
    return inside ? 1 : 0;
  });
  r("numtostring", (_i, [n]) => String(toNum(n ?? 0)));
  r("lowmemory", () => 0); // we never simulate the CD-era low-memory path
  // heapsize(): free memory in bytes. BOOTFILE defines its own lowmemory()
  // (which shadows the builtin above) as `heapsize() < 6144000` — and every
  // setupsound() case for a memory-heavy deck (decka/deckb/decke/deckf/cargo)
  // then loads the 11 kHz `.11k` bank instead of the full `.trk`, while still
  // calling playnewtheme("<deck>.trk"). Left at 0, heapsize() reported "low
  // memory", the .trk bank was never opened, and those rooms were silent.
  // We run in a browser with ample memory: report plenty so the full path runs.
  r("heapsize", () => 64 * 1024 * 1024);
  // stageparam(idx[, val]): per-stage scratch parameters, getter/setter by arity
  const stageParams = new Map<number, Value>();
  r("stageparam", (_i, [idx, val]) => {
    const k = toNum(idx ?? 0);
    if (val === undefined) return stageParams.get(k) ?? 0;
    stageParams.set(k, val);
    return 0;
  });

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
