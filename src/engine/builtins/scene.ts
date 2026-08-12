import { toNum, toStr, truthy } from "../interp";
import { BuiltinCtx } from "./context";

/**
 * Screen / scene / stage state: set switching, the STG stage + flat layer,
 * movie playback, shop/track file open/close, screen transitions + fades, the
 * CLUT palette effect, frame-rate and volume settings, and the assorted
 * no-op / debug-affordance stubs.
 */
export function registerSceneBuiltins(ctx: BuiltinCtx): void {
  const { session, r } = ctx;

  // set switching — the engine primitives behind the boot library's set change
  // (TAOOT: boot's changeset())
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
  // TAOOT's halls need it nonzero or their world sprites float. See session.cameraHiBias.
  r("camerahi", (_i, [n]) => {
    if (n === undefined) return session.cameraHiBias;
    session.cameraHiBias = Number(n) | 0;
  });
  // currentscene(x) is a SETTER too, with two forms: a DIRECTION
  // ("strait"/"left"/"right") drives boot's default keydown walk/turn, while a
  // SCENE NAME ("sceneNNN") teleports to that scene — paired with the following
  // currentview("viewNNN") it's how TAOOT's halls cross to the other side of the ship
  // (HALLC/HALLA keydown toggle hallside then cut to the mirrored view).
  r("currentscene", (_i, [dir]) => {
    if (dir === undefined) return session.currentSceneName();
    const d = toStr(dir).toLowerCase();
    if (d.startsWith("scene")) session.onSceneJump(d);
    else session.onNavigate(d);
  });
  // currentview() reads the current view; currentview("viewNNN") SETS it — the
  // teleport's destination view (executes a buffered currentscene jump). Was
  // getter-only, so TAOOT's hall crossover currentview(...) was silently dropped
  // and the move never happened.
  r("currentview", (_i, [view]) => {
    if (view === undefined) return session.currentViewName();
    session.onViewJump(toStr(view).toLowerCase());
  });
  // stage layer (STG flats): the UI band / inventory / mini-game screens
  r("setvisible", (_i, [v]) => {
    if (v === undefined) return session.viewShowing ? 1 : 0;
    session.setVisible = truthy(v);
  });
  r("stagevisible", () => (session.stageName !== "none" ? 1 : 0));
  r("currentstage", () => session.stageName);
  r("currentflat", () => session.currentFlat);
  r("openstagefile", async (_i, [n]) => ((await session.stageCtrl.openStageFile(toStr(n ?? ""))) ? 1 : 0));
  r("closestagefile", () => session.stageCtrl.closeStageFile().then(() => {}));
  r("gotoflat", (_i, [n]) => session.stageCtrl.gotoFlat(toStr(n ?? "")).then(() => {}));
  r("flattoindex", (_i, [n]) => session.stageCtrl.flatToIndex(toStr(n ?? "")));
  // indextoflat(i): inverse of flattoindex — the 1-based flat's name (TAOOT's
  // fencing walks the 16-flat piste by index, stepflat(±1) then indextoflat).
  r("indextoflat", (_i, [i]) => session.flatNames[toNum(i) - 1] ?? "none");
  // countflats(): how many flats the current stage has (piste length bound).
  r("countflats", () => session.flatNames.length);

  // scene / view enumeration over the current set — BOOTFILE walks every scene
  // × view to relocate 2D props on set entry; the debug menu dumps them.
  const scenes = () => session.currentBinding?.set.scenes ?? [];
  const sceneByName = (name: string) => {
    const n = name.toLowerCase();
    return scenes().find((s) => s.sceneName.toLowerCase() === n);
  };
  const viewByName = (scene: string, view: string) => {
    const vn = view.toLowerCase();
    return sceneByName(scene)?.views.find((x) => x.viewName.toLowerCase() === vn);
  };
  r("countscenes", () => scenes().length);
  r("indextoscene", (_i, [idx]) => scenes()[toNum(idx ?? 0) - 1]?.sceneName ?? "");
  r("countviews", (_i, [scene]) => sceneByName(toStr(scene ?? ""))?.views.length ?? 0);
  r("indextoview", (_i, [scene, idx]) =>
    sceneByName(toStr(scene ?? ""))?.views[toNum(idx ?? 0) - 1]?.viewName ?? "",
  );
  // countshops()/indextoshop(n): open shop files, 1-based (TAOOT's CTL.STG lists them).
  r("countshops", () => session.propRuntime.shops.size);
  r("indextoshop", (_i, [idx]) => [...session.propRuntime.shops.keys()][toNum(idx ?? 0) - 1] ?? "");
  // countbuttons(flat)/indextobutton(flat, n): a flat's clickable regions.
  r("countbuttons", (_i, [flat]) => session.stageCtrl.flatButtonNames(toStr(flat ?? "")).length);
  r("indextobutton", (_i, [flat, idx]) =>
    session.stageCtrl.flatButtonNames(toStr(flat ?? ""))[toNum(idx ?? 0) - 1] ?? "",
  );
  // countpaintings(scene, view)/indextopainting(scene, view, n): the view's
  // "paintings" — its clickable 2D hotspot objects (SceneView.objects). Their
  // identifiers drive the nav arrow: TAOOT's HOUSE.SHP setuparrow() scans them and
  // turns the arrow YELLOW on a "door"/"locked"/"knock" ahead (before the
  // green/red road test), so these must report the real objects, not 0.
  r("countpaintings", (_i, [scene, view]) =>
    viewByName(toStr(scene ?? ""), toStr(view ?? ""))?.objects.length ?? 0,
  );
  r("indextopainting", (_i, [scene, view, idx]) =>
    viewByName(toStr(scene ?? ""), toStr(view ?? ""))?.objects[toNum(idx ?? 0) - 1]?.identifier ?? "",
  );
  // roadahead(scene, view): is there a walkable road leaving `scene` while
  // facing `view`? A SET transition ("road") connects two view IDs; roads are
  // bidirectional — walk()/availableRoads() take a road from EITHER endpoint
  // (viewIDstart or viewIDend). Match both so the arrow goes GREEN wherever you
  // can actually walk forward (checking only viewIDstart left it red at a road's
  // far end even though ArrowUp walks it). TAOOT's setuparrow() calls this via
  // myroadahead(), which also hardcodes a few scripted exceptions on top.
  r("roadahead", (_i, [scene, view]) => {
    const v = viewByName(toStr(scene ?? ""), toStr(view ?? ""));
    if (!v) return 0;
    const trans = session.currentBinding?.set.transitions ?? [];
    return trans.some((t) => t.viewIDstart === v.viewID || t.viewIDend === v.viewID) ? 1 : 0;
  });
  // transtoflat/transfromflat: enter/leave a full-screen overlay stage (TAOOT:
  // the deck map opens via the "map" prop's open() -> transtoflat("map.stg"))
  // transtoflat/transfromflat are NOT registered here, deliberately. They are not
  // engine commands — they have no opcode id — they are ~200 lines of BOOTFILE
  // script, and a builtin of the same name shadowed them (evalCall tries builtins
  // before the fallback chain), which is what forced the port to transcribe their
  // per-stage switches into tables of TAOOT stage names. The game's own version
  // runs now; GameSession.transToFlat is how the host and the tests reach it.

  // playmovie is MODAL in TI.EXE: it runs the movie's frame state machine to
  // completion (waiting for the player's clicks on interactive movies) before
  // the script continues. Await the host promise so the script blocks — TAOOT's
  // purser `playmovie("mainc.mov")` must not fall through to actionframe()
  // until you've knocked and the window has opened. Only block when the host
  // actually drives frames — the browser's rAF loop, or a harness that pumps
  // viewer.tick() and says so with session.modalMovies. A host with neither
  // has nothing to advance the movie, so it would deadlock; there we start the
  // movie and continue (like stilldown/voicedone/forceupdate).
  r("playmovie", async (_i, [n]) => {
    const done = session.onPlayMovie(toStr(n ?? ""));
    if (session.hasRealFrames || session.modalMovies) await done;
  });
  // actionframe(n): did the movie just played reach action frame n? Its frames
  // carry a nonzero action index (mov.ts) recorded as the movie plays; TAOOT's
  // purser knock/ring frames are 1, so `if actionframe(1)` opens the puppet.
  r("actionframe", (_i, [n]) => (session.movieActions.has(toNum(n ?? 0)) ? 1 : 0));
  r("openshopfile", async (_i, [n]) => {
    await session.openShop(toStr(n));
  });
  r("closeshopfile", async (_i, [n]) => {
    await session.closeShop(toStr(n));
  });

  // fileexists(name): 1 if the named game file is available, else 0. Scripts
  // guard optional loads with it — TAOOT's guided tour plays only the movie
  // segments present (`if fileexists("tour1.mov") ... playmovie(...)`), and
  // conversation setups probe for a character's puppet before opening it. We
  // resolve it exactly like the open*file commands: ask the (possibly lazy,
  // browser-fetching) provider to make the file available, then report whether
  // it's there. In TI.EXE the handler (0x427bc0) opens the file and returns the
  // success flag — same observable result.
  r("fileexists", async (_i, [name]) => {
    const key = toStr(name ?? "").toLowerCase();
    if (!key) return 0;
    await session.ensureFile(key);
    return session.files(key) ? 1 : 0;
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
  // (each of these is the script saying what the screen should look like, so
  // it cancels a movie's pending reveal — see session.tickFade)
  r("screentoblack", (_i, [, steps]) => {
    if (!session.fade.snapshot) session.fade.snapshot = session.captureFrame?.() ?? null;
    session.fade.queue.push({ to: 1, steps: Math.max(1, Number(steps) || 10) });
    session.fade.pendingReveal = false;
  });
  r("blacktoscreen", (_i, [, steps]) => {
    session.fade.queue.push({ to: 0, steps: Math.max(1, Number(steps) || 10) });
    session.fade.pendingReveal = false;
  });
  r("blackscreen", () => {
    session.fade.queue.length = 0;
    session.fade.snapshot = null;
    session.fade.level = 1;
    session.fade.pendingReveal = false;
  });
  // currenttheme([layer]): the looping theme currently playing (the layer arg
  // selects a mix channel in TI.EXE; we track a single theme, so it's ignored).
  r("currenttheme", () => session.currentThemeName);
  // framerate([n]): getter/setter for the engine's target frame cadence. Drag
  // loops save it, drop to a slow rate to pace the rotate (TAOOT's turbine valves:
  // `rate = framerate(); framerate(2); …; framerate(rate)`), then restore. Our
  // poll loops pace on real rAF frames via forceupdate(), so this only needs to
  // round-trip a value — store it so the save/restore reads back consistently.
  r("framerate", (_i, [n]) => {
    if (n === undefined) return session.frameRate;
    session.frameRate = toNum(n);
    return 0;
  });
  // wavevolume([n]): master volume for sampled audio (SFX + speech), 0..9.
  // Getter with no arg (TAOOT's CTL.STG "volume" dial reads it on open); setter
  // otherwise (the dial's drag loop writes it live). Scales the sound AND voice
  // channels — theme/music is governed separately by themevol below.
  r("wavevolume", (_i, [n]) => {
    if (n === undefined) return session.waveVolume;
    // through the session's setter, which the digit keys and the page's own
    // control also go through — see GameSession.setWaveVolume
    return session.setWaveVolume(toNum(n));
  });
  // themevol(track[, vol]): theme (music) loudness, 0..255 — GETTER with one
  // argument, setter with two. TAOOT's CTL.STG slider sets the global
  // `themevolume` then calls themevol(currenttheme, getthemevolume(...)); set
  // entry does the same on arrival, and the turbine hum swells with output.
  // We track a single theme channel, so the track name is informational.
  //
  // The getter was missing, and here that is not a missing feature but a broken
  // one: the scripts duck the score with a READ-MODIFY-WRITE,
  // `themevol(t, themevol(t) / 4)`, so answering nothing answered 0 — the music
  // was set to silence and then multiplied back up from zero. See
  // GameSession.themeVolume for the two places that bit.
  r("themevol", (_i, [, vol]) => {
    if (vol === undefined) return session.themeVolume;
    session.setThemeVolume(toNum(vol));
    return 0;
  });
  // clut(target)/mixclut(target,color,lo,hi,amt): the DreamFactory colour-
  // lookup-table effect. mixclut blends a palette range toward a colour (the
  // TAOOT corpus only ever uses "black" — a dim-to-dark), clut(target) restores the normal
  // palette. Drives the darkroom light switch (mixclut "set" darkens the cabin,
  // clut "set" brings it back) and various stage/current fades. clut("black")
  // is the ONE exception: it's always paired with blackscreen() in the movie
  // transition path, so it stays a no-op (the black is drawn by blackscreen).
  r("mixclut", (_i, [target, color, lo, hi, amt]) => {
    if (toStr(color ?? "").toLowerCase() !== "black") return; // only black-mix exists in the corpus
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
  /**
   * visualeffect(effect, steps): how the NEXT screen arrives.
   *
   * Every effect but `plain` is a reveal — the new screen is wiped, irised or
   * scrolled in over the old one — and this port draws them instantly. Drawing
   * them instantly is only half a translation, though: a reveal also ENDS the
   * transition-black the script put up to hide the change, and with the effect
   * itself a no-op nothing was ending it.
   *
   * TAOOT's blackjack is where that shows. HOUSE fades the dealer out with
   * `screentoblack("puppet")` and then `transtoflat("blkjack.stg")`, which is the
   * one stage the boot deliberately does NOT black out or fade back in (it is
   * already black) — the table is revealed by `newgame`'s own
   * `visualeffect(wiperight, 20)`. Without this the deal ran perfectly behind a
   * screen that stayed dark: "black screen after the talk".
   *
   * `plain` is excluded because it is the opposite instruction — the scripts call
   * it to CLEAR a pending effect immediately before `blacktoscreen`, which is the
   * fade that then does the revealing. Lifting the black there would cancel the
   * fade-in on every overlay the game opens.
   */
  r("visualeffect", (_i, [effect, steps]) => {
    const name = toStr(effect ?? "plain").toLowerCase();
    if (name === "plain") return;
    session.fade.queue.length = 0;
    session.fade.snapshot = null;
    session.fade.pendingReveal = false;
    session.fade.level = 0;
    // A WIPE is animated, over `steps` engine passes (see GameSession.wipe).
    //
    // The screen being left is captured HERE, which is late enough to be right:
    // the scripts change the screen first and ask for the effect second, and
    // nothing has repainted in between — the change lands on the next frame.
    // TAOOT's ending scrapbook turns its pages this way (narend.stg, 5 of the
    // corpus's 9 reveals):
    //
    //     gotoflat (findword (worldwar1 (), ",", count))
    //     voicesound ("paper")
    //     visualeffect (wipeleft, 30)
    //     voicesound ("n." @ findword (worldwar1 (), ",", count))
    //     voicewait ()
    //
    // and the pages that are a CONTINUATION of one picture ("11b", "33b", "51b"
    // …) ask for `visualeffect(plain, 0)` instead, so honouring the difference is
    // what makes the flips land on the page turns and nowhere else (#12).
    //
    // Only the two wipes the corpus uses are animated. `venetian`, the irises and
    // the scrolls are named in TI.EXE's vocabulary but no script asks for one, so
    // they keep the old instant reveal rather than guessing at geometry.
    if (name !== "wipeleft" && name !== "wiperight") return;
    const from = session.captureFrame?.() ?? null;
    if (!from) return;
    session.wipe.from = from;
    session.wipe.dir = name === "wipeleft" ? "left" : "right";
    // clamped the way TI.EXE clamps it, 1..1000 (0x43df60..0x43df7a)
    session.wipe.steps = Math.min(1000, Math.max(1, toNum(steps ?? 0) || 1));
    session.wipe.step = 0;
    session.wipe.lastTick = 0;
    // The script WAITS for the reveal, as it does in the original: visualeffect
    // performs the whole effect inside the command (0x43b480 off the back of a
    // service pass) and its pacer spins until each strip's tick is due, so the
    // statements after it run when the screen has finished arriving. For the
    // scrapbook that is the difference between the narration starting under a
    // turning page and starting on the page it belongs to.
    //
    // Bounded, and on the ENGINE's frame rather than a wall clock, for the same
    // reasons walkAfterFade is: a host that stops ticking must not hang a script,
    // and a poll on real milliseconds makes the headless oracle non-deterministic.
    return (async () => {
      const cap = session.wipe.steps * 4 + 60;
      for (let i = 0; i < cap && session.wiping; i++) await session.nextFrame();
      session.endWipe(); // gave up: never leave a reveal holding the screen
    })();
  });

  for (const noop of [
    "hidecursor", "showcursor", "debugger", // (flushevents no-ops in pointer.ts)
    "exportclut",
    // *warm: asset preloaders (propwarm/actorwarm/shopwarm). openshopfile/
    // openset already instantiate every prop/actor up front, so warming is a
    // no-op for us — it only mattered on the original's streaming loader.
    "propwarm", "actorwarm", "shopwarm",
  ]) {
    r(noop, () => {});
  }

  // The *script family opens the in-engine script editor/debugger on a named
  // object (its script), e.g. `propscript(me)`, `buttonscript(currentflat(),
  // me)`, `scenescript(currentscene())`. In TI.EXE each handler first tests a
  // global "editor available" flag (0x489f2c / 0x489fd8) and, when it's clear —
  // as in every shipping build — returns an error and does nothing. Scripts
  // only ever reach them behind `if debugging & shiftkey()` (or a hidden debug
  // menu), and our shiftkey() is already 0, so these never fire in normal play;
  // register them as no-ops so the debug branches stay inert instead of logging
  // as unknown. (serverscript is the same, for the cut networking debugger.)
  for (const dbg of [
    "propscript", "buttonscript", "scenescript", "flatscript", "stagescript",
    "bootscript", "postscript", "setscript", "paintingscript", "puppetscript",
    "castscript", "actorscript", "shopscript", "serverscript",
  ]) {
    r(dbg, () => {});
  }

  /*
   * The modifier-key probes.
   *
   * `shiftkey()` answers for real, and exactly one thing in the shipping game
   * changes as a result. Census of the English tree: 383 probe calls across 248
   * script containers, and all but FOUR are gated on `debugging` — which is
   * assigned once in the whole corpus, `debugging = false` in BOOTFILE, so those
   * stay as dormant as they were when this returned 0. Of the four ungated ones,
   * three are `optionkey` (option-drag moves the cricket in Z, scales a smokestack
   * prop, and opens `debugger()` in PHOTO.SHP) and the fourth is the one worth
   * having: house.shp's "help" prop answers a shift-click with the game's own
   * state readout, `notedialog("Mission=" @ … @ ", Phase=" @ …)`, with Maze and
   * Level added in the three smokestack sets. That is #8, and it was never missing
   * — only unreachable, because this said "not held".
   *
   * So the other two keep answering 0. Not for want of a browser event to read
   * them from: nothing in the shipping game reaches them except those three
   * dev tools, and "option-drag rescales the artwork" is not a thing a player
   * should be able to do to their own game by accident.
   */
  r("shiftkey", () => (session.shiftDown ? 1 : 0));
  for (const key of ["optionkey", "commandkey"]) {
    r(key, () => 0);
  }
}
