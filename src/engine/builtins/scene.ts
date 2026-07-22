import { toNum, toStr, truthy } from "../interp";
import { BuiltinCtx } from "./context";

/**
 * Screen / scene / stage state: set switching, the STG stage + flat layer,
 * movie playback, shop/track file open/close, screen transitions + fades, the
 * CLUT palette effect, frame-rate and volume settings, and the assorted
 * no-op / debug-affordance stubs.
 */
export function registerSceneBuiltins(ctx: BuiltinCtx): void {
  const { session, r, log } = ctx;

  // set switching — the engine primitives behind boot's changeset()
  r("opensetfile", async (_i, [name, scene, view]) => {
    await session.openSetFile(toStr(name ?? ""), toStr(scene ?? ""), toStr(view ?? ""));
  });
  r("closesetfile", async () => {
    await session.currentBinding?.closeSet();
    session.currentSetName = "none";
  });
  r("currentset", () => session.currentSetName);
  // camerahi(n) sets / camerahi() reads the vertical projection bias (TI.EXE
  // global 0x48a792). BOOTFILE adjustcamera() drives it per set from openset;
  // the halls need it nonzero or their world sprites float. See session.cameraHiBias.
  r("camerahi", (_i, [n]) => {
    if (n === undefined) return session.cameraHiBias;
    session.cameraHiBias = Number(n) | 0;
  });
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
  // indextoflat(i): inverse of flattoindex — the 1-based flat's name (fencing
  // walks the 16-flat piste by index, stepflat(±1) then indextoflat to move).
  r("indextoflat", (_i, [i]) => session.flatNames[toNum(i) - 1] ?? "none");
  // countflats(): how many flats the current stage has (piste length bound).
  r("countflats", () => session.flatNames.length);
  // transtoflat/transfromflat: enter/leave a full-screen overlay stage (the
  // deck map opens via the "map" prop's open() -> transtoflat("map.stg"))
  r("transtoflat", (_i, [n]) => session.transToFlat(toStr(n ?? "")).then(() => {}));
  r("transfromflat", () => session.transFromFlat().then(() => {}));

  // playmovie is MODAL in TI.EXE: it runs the movie's frame state machine to
  // completion (waiting for the player's clicks on interactive movies) before
  // the script continues. Await the host promise so the script blocks — the
  // purser's `playmovie("mainc.mov")` must not fall through to actionframe()
  // until you've knocked and the window has opened. Only block when the host
  // actually drives frames (the browser's rAF loop); headless (tests) has no
  // loop to advance the movie, so it would deadlock — there we start the movie
  // and continue, exactly as before (like stilldown/voicedone/forceupdate).
  r("playmovie", async (_i, [n]) => {
    const done = session.onPlayMovie(toStr(n ?? ""));
    if (session.hasRealFrames) await done;
  });
  // actionframe(n): did the movie just played reach action frame n? Its frames
  // carry a nonzero action index (mov.ts) recorded as the movie plays; the
  // purser knock/ring frames are 1, so `if actionframe(1)` opens the puppet.
  r("actionframe", (_i, [n]) => (session.movieActions.has(toNum(n ?? 0)) ? 1 : 0));
  r("openshopfile", async (_i, [n]) => {
    await session.openShop(toStr(n));
  });
  r("closeshopfile", async (_i, [n]) => {
    await session.closeShop(toStr(n));
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
  // wavevolume([n]): master volume for sampled audio (SFX + speech), 0..9.
  // Getter with no arg (the CTL.STG "volume" dial reads it on open); setter
  // otherwise (the dial's drag loop writes it live). Scales the sound AND voice
  // channels — theme/music is governed separately by themevol below.
  r("wavevolume", (_i, [n]) => {
    if (n === undefined) return session.waveVolume;
    session.waveVolume = Math.max(0, Math.min(9, Math.round(toNum(n))));
    const g = session.waveVolume / 9;
    session.audio.setChannelVolume("sound", g);
    session.audio.setChannelVolume("voice", g);
    return session.waveVolume;
  });
  // themevol(track, vol): theme (music) loudness, 0..255. The CTL.STG slider
  // sets the global `themevolume` then calls themevol(currenttheme, getthemevolume(...));
  // set entry does the same on arrival, and the turbine hum swells with output.
  // We track a single theme channel, so the track name is informational — apply
  // the level as the theme channel's master gain.
  r("themevol", (_i, [, vol]) => {
    if (vol === undefined) return;
    session.audio.setChannelVolume("theme", Math.max(0, Math.min(1, toNum(vol) / 255)));
  });
  // clut(target)/mixclut(target,color,lo,hi,amt): the DreamFactory colour-
  // lookup-table effect. mixclut blends a palette range toward a colour (only
  // "black" is ever used — a dim-to-dark), clut(target) restores the normal
  // palette. Drives the darkroom light switch (mixclut "set" darkens the cabin,
  // clut "set" brings it back) and various stage/current fades. clut("black")
  // is the ONE exception: it's always paired with blackscreen() in the movie
  // transition path, so it stays a no-op (the black is drawn by blackscreen).
  r("mixclut", (_i, [target, color, lo, hi, amt]) => {
    if (toStr(color ?? "").toLowerCase() !== "black") return; // only black-mix exists
    session.onClut(toStr(target ?? ""), {
      lo: toNum(lo ?? 0),
      hi: toNum(hi ?? 255),
      amt: toNum(amt ?? 0),
    });
  });
  r("clut", (_i, [target]) => {
    const t = toStr(target ?? "").toLowerCase();
    if (t === "black" || t === "") return; // no-op: paired with blackscreen()
    session.onClut(t, null);
  });
  for (const noop of [
    "flushevents", "hidecursor", "showcursor", "debugger",
    "visualeffect",
    "exportclut",
    // *warm: asset preloaders (propwarm/actorwarm/shopwarm). openshopfile/
    // openset already instantiate every prop/actor up front, so warming is a
    // no-op for us — it only mattered on the original's streaming loader.
    "propwarm", "actorwarm", "shopwarm",
    // propscript: opens the script debugger on a prop (debug builds only).
    "propscript",
  ]) {
    r(noop, () => {});
  }

  // modifier-key probes — debug affordances (shift+click dumps a prop's script,
  // option+click drags it). No hardware modifier state in the browser build, so
  // always "not held": the debug branches guarded by `debugging & shiftkey()`
  // stay dormant and the normal gameplay branch runs.
  for (const key of ["shiftkey", "optionkey", "commandkey"]) {
    r(key, () => 0);
  }
}
