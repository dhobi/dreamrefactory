import { toNum, toStr, truthy } from "../interp";
import { packPoint } from "../point";
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
  /**
   * currentstage() — the stage's OWN name, with its FILE left in `result()`.
   *
   * It used to answer the file, and on Titanic the two are the same string: all
   * fifteen of its stages store their own filename in the name field
   * (`StgFile.refName`), so nothing could tell the difference. Timelapse can.
   * Its `p.stg` is called `"interface"`, and its BOOTFILE's space bar is
   *
   *     if currentstage () = "interface"
   *         endinterface ()
   *     else
   *         begininterface (1)
   *
   * so with the file as the answer the panel opened and could never be closed
   * again — the branch that puts it away was unreachable. Its 155 other stages
   * say `"stagename"`, the authoring default nobody filled in, which is not
   * `"interface"` and so is exactly the right answer for all of them.
   *
   * The pair is the convention `hittest`/`indextoprop` already use, and the game
   * reads both halves: `begininterface` is `laststage = currentstage ()` and then
   * `laststage = result ()`. The `"none"` sentinel when no stage is open is what
   * Dust's own `currentstage () != "none"` asks.
   *
   * Dust used to fall back to the file too, because a v1 `.FLT` was read as having
   * no name field. It has one, 20 bytes before v4's (#325), and three of its own
   * tests were failing on the difference: `HOUSE.PRP`'s inventory-book handler asks
   * for `"scorp"` and `"yunnibox"` where the files are `SCORP.FLT` and
   * `YUNNIBOX.FLT`, and `NEW.FLT`'s asks for `"new"`. Its four other cases
   * (`"fight.flt"`, `"flute.flt"`, `"tumble.flt"`, `"sundial.flt"`) name stages
   * whose own name IS their filename, which is why the gap showed as three
   * unreachable branches rather than as a broken game.
   */
  r("currentstage", () => {
    session.lastResult = session.stageName;
    return session.stageCtrl.stageRefName() || session.stageName;
  });
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
  /**
   * `scenexyz(scene, axis)` — where a standpoint IS, in world units.
   *
   * A DreamFactory 1 primitive: Titanic's 3465 scripts never call it, Dust's call
   * it seventeen times, and it is how that game places anything at a standpoint
   * rather than at a star. `extra.cst` walks its town drunk from `scene g10` to
   * `scene g6` with it, and `nite.set` measures the player's distance to four
   * named corners the same way.
   *
   * The axis numbering is `playerxyz`'s, because the corpus pairs them directly
   * (`calcdist (scenexyz ("scene g8", 4), playerxyz (4))`): 1 is X, 2 is the
   * ground plane's second axis, 4 is the two of them packed into one point. 3
   * would be the height and no script asks for it — a v1 set is flat, and the
   * one script that builds a triple writes the height as a literal
   * (`actorxyz (me, scenexyz (name, 1), scenexyz (name, 2), 0)`).
   *
   * These units are the same 256-per-cell the grid is measured in, which the
   * corpus states outright: `extra.cst`'s crowd router divides by exactly that to
   * get back to cells (`x1 = scenexyz (dest, 1) / 256`). That is a second,
   * independent confirmation of the scale the camera poses were calibrated from.
   */
  r("scenexyz", (_i, [scene, axis]) => {
    const sc = sceneByName(toStr(scene ?? ""));
    if (!sc) return 0;
    switch (toNum(axis ?? 1)) {
      case 1: return sc.xAxisMap;
      case 2: return sc.zAxisMap;
      case 3: return sc.yAxisMap;
      case 4: return packPoint(sc.xAxisMap, sc.zAxisMap);
      default: return 0;
    }
  });
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
  /**
   * screentoblack(surface, steps) / blacktoscreen(surface, steps) — the fades,
   * and they BLOCK.
   *
   * `gotospecial` wraps set changes in the pair; without them stair transitions
   * look like nothing moved. Each is also the script saying what the screen
   * should look like, so it cancels a movie's pending reveal — see
   * {@link GameSession.tickFade}.
   *
   * Blocking is the part that was missing, and it is not a detail. In TI.EXE
   * both are a linear lerp between the named surface's palette and the black
   * one, `steps` increments, and the loop (`0x435b90` / `0x435be0`, reached
   * through `0x43e550` / `0x43e5d0`) BUSY-WAITS one 60 Hz tick per step on the
   * engine's own clock (`0x41de90`, `timeGetTime() * 3 / 50`) with no message
   * pump and no scheduler pass inside it. The interpreter is frozen for the
   * whole ramp, so the statement AFTER a fade cannot run until the fade is over.
   *
   * Ours queued the ramp and returned, and the game noticed. `gang.cst`'s
   * `prepuppet` is `screentoblack("current", 10)`, `openpuppetfile`,
   * `visualeffect(plain, 0)`, `blacktoscreen("puppet", 10)` — and only then does
   * `runpuppet` send the puppet its boot script, which is what speaks the first
   * line. With the fade non-blocking the line started while the screen was still
   * black and rode the ramp up: #6, "actors begin speaking before fade-in".
   *
   * Sleeping the script tick (the same unit and the same primitive `delay(n)`
   * uses) rather than awaiting the queue: the ramp advances one step per tick
   * from the tick it is pushed on, so `steps` ticks is always long enough, and a
   * ramp that is somehow starved cannot wedge the script behind it forever.
   *
   * And blocking is conditional on a frame source, on exactly the test
   * `playmovie` below uses and for exactly its reason: a host that does not
   * advance the clock never ticks the ramp, so awaiting one would deadlock on
   * the first transition. A bare `GameSession` is that host — several savegame
   * tests drive the game's own `transtoflat` with no viewer attached and clear
   * `fade.queue` by hand afterwards — and there the fades stay what they were,
   * a level set and nothing waited on.
   */
  const fade = async (to: 0 | 1, steps: unknown): Promise<void> => {
    const n = Math.max(1, Number(steps) || 10);
    if (to === 1 && !session.fade.snapshot) {
      session.fade.snapshot = session.captureFrame?.() ?? null;
    }
    session.fade.queue.push({ to, steps: n });
    session.fade.pendingReveal = false;
    if (session.hasRealFrames || session.modalMovies) await session.clock.sleep((n * 50) / 3);
  };
  r("screentoblack", (_i, [, steps]) => fade(1, steps));
  /**
   * `blacktoscreen(name, steps)` reveals FROM black — which is what the name
   * says, and it has to be said in code because the screen is not always black
   * when a script asks.
   *
   * Every overlay the games open is `screentoblack`, swap the stage, `visualeffect
   * (plain, 0)`, `blacktoscreen` — and opening a stage file now clears the level,
   * because it replaces the palette the ramp was against (StageController.
   * openStageFile). Ramping from wherever the level happens to be would make
   * that a ramp from 0 to 0: the panel, the map and the CTL would appear
   * instantly instead of fading in. So a reveal with nothing to reveal from
   * starts at black.
   *
   * Guarded on a darkening already in flight, so the ordinary pairing — a
   * `screentoblack` whose ramp is still running — is left exactly as it was.
   */
  r("blacktoscreen", (_i, [, steps]) => {
    const f = session.fade;
    if (f.level === 0 && !f.queue.some((q) => q.to === 1)) f.level = 1;
    return fade(0, steps);
  });
  /** the screen is black from this instant — no ramp, nothing left running */
  const blackNow = (): void => {
    session.fade.queue.length = 0;
    session.fade.snapshot = null;
    session.fade.level = 1;
    session.fade.pendingReveal = false;
  };
  r("blackscreen", blackNow);
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
  // The track NAME is no longer purely informational: the volume is remembered
  // under it, so starting that track later plays it at the level the script asked
  // for (see GameSession.volumeForTrack — Dust's saloon scores the same music at
  // 55 downstairs and 24 through the floor above it).
  r("themevol", (_i, [track, vol]) => {
    if (vol === undefined) return session.themeVolume;
    session.setThemeVolume(toNum(vol), toStr(track ?? "") || undefined);
    return 0;
  });
  // clut(target)/mixclut(target,color,lo,hi,amt): the DreamFactory colour-
  // lookup-table effect. mixclut blends a palette range toward a colour (the
  // TAOOT corpus only ever uses "black" — a dim-to-dark), clut(target) restores the normal
  // palette. Drives the darkroom light switch (mixclut "set" darkens the cabin,
  // clut "set" brings it back) and various stage/current fades.
  r("mixclut", (_i, [target, color, lo, hi, amt]) => {
    if (toStr(color ?? "").toLowerCase() !== "black") return; // only black-mix exists in the corpus
    session.onClut(toStr(target ?? ""), {
      lo: toNum(lo ?? 0),
      hi: toNum(hi ?? 255),
      amt: toNum(amt ?? 0),
    });
  });
  /**
   * `clut(name)` INSTALLS a palette, right now — `0x43dfd0` resolves the name
   * through the same table the fades use and hands it to `0x4363e0`, which is
   * also the call the last step of a `blacktoscreen` ramp makes. So `clut` is
   * the un-ramped fade, and `clut("black")` is the un-ramped `screentoblack`:
   * the all-black palette, from this instant, until something installs another.
   *
   * That is load-bearing and it used to be a no-op here, on the reasoning that
   * `blackscreen()` is always beside it. Not always: `transtoflat`'s `rub.stg`
   * arm is `playmovie("rub.mov")` then `clut("black")` with no `blackscreen`
   * anywhere, and the black it leaves is what the stage is revealed FROM two
   * lines later. The pairing is also not redundant where it does occur — in the
   * original `blackscreen` clears the buffer and `clut("black")` makes every
   * subsequent draw invisible, which is how the scripts hold a screen black
   * across a set or stage swap that keeps repainting underneath.
   */
  r("clut", (_i, [target]) => {
    const t = toStr(target ?? "").toLowerCase();
    if (t === "") return;
    if (t === "black") return blackNow();
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
    if (name === "plain") {
      // NOT a no-op: `plain` is a full-screen redraw (tl.exe 0x448630 blits the
      // screen rect to itself), which is how a script makes a change it just made
      // visible before whatever it does next reads the screen. It still must not
      // clear a pending reveal — see the note above.
      session.repaintNow?.();
      return;
    }
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
    // The wipes the two corpora use are animated: TAOOT asks for wipeleft and
    // wiperight (9 reveals), Dust adds barndooropen and barndoorclose — its map
    // and inventory screens arrive middle-outwards (4 opens, 3 closes, reported
    // from play as "the map and the menu have an opening animation in the real
    // game"). `venetian`, the irises and the scrolls are named in TI.EXE's
    // vocabulary but no script in either game asks for one, so those keep the
    // old instant reveal rather than guessing at geometry.
    /**
     * ...and the TURNS, which are not wipes at all.
     *
     * Timelapse turns by scrolling: `lefttoframeMin` shows the mid-turn flat,
     * asks for `turnhalfleft`, shows the destination, asks for `turnleft`. It is
     * the only game that asks — one call each, all four in those two handlers —
     * and it is the path the game itself takes on a small machine (see
     * freemem/sysmem in helpers.ts). What they do is settled in
     * ScreenDirector.pushTurn, off `tl.exe`.
     */
    const DIR = {
      wipeleft: "left", wiperight: "right",
      barndooropen: "open", barndoorclose: "close",
      turnleft: "turnleft", turnhalfleft: "turnleft",
      turnright: "turnright", turnhalfright: "turnright",
    } as const;
    const dir = DIR[name as keyof typeof DIR];
    if (!dir) return;
    const from = session.captureFrame?.() ?? null;
    if (!from) return;
    /**
     * A turn also captures the picture it is ARRIVING at, here, once. The
     * script has already done `gotoflat`, so the current flat is the one the
     * turn is turning to; painting it now and holding the capture is the
     * port's copy of the original's offscreen surface, which `gotoflat` drew
     * and the modal effect then consumed unchanged. Left to the live frame
     * instead, an animating destination swapped the entering strips mid-ramp
     * (i0001.103's water reached frame 3 before the turn was over), and the
     * between-legs composite drifted with it. See GameSession.wipe.to.
     */
    let to: { rgba: Uint8ClampedArray; width: number; height: number } | null = null;
    if (dir === "turnleft" || dir === "turnright") {
      session.repaintNow?.();
      to = session.captureFrame?.() ?? null;
      if (!to) return;
    }
    session.wipe.from = from;
    session.wipe.to = to;
    session.wipe.dir = dir;
    session.wipe.settled = false;
    // the `half` pair travels half the screen (tl.exe 0x448b48); the rest all of it
    session.wipe.span = name === "turnhalfleft" || name === "turnhalfright" ? 0.5 : 1;
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
      // Gave up (the host stopped ticking): never leave a reveal holding the
      // screen. But ONLY then — a wipe that finished was ended by tickWipe, and
      // a half turn that finished has SETTLED, which must survive this return:
      // the script's next statements are `gotoflat(namedest)` and the second
      // leg's visualeffect, and any frame either yields must keep showing the
      // settled composite for that leg to capture. Ending it here — which this
      // line did unconditionally when only TAOOT's wipes existed — was the left
      // turn's mid-picture jump (see GameSession.wipe.settled).
      if (session.wiping) session.endWipe();
    })();
  });

  /**
   * `hidecursor()` / `showcursor()` — the pointer goes away where the game draws
   * its own.
   *
   * A counter and not a flag, because the original's is: `ShowCursor(FALSE)` plus
   * a decrement of its own tally (`tl.exe` 0x4087b0), `ShowCursor(TRUE)` plus the
   * increment (0x408790). What consumes it is the hover chain — see
   * `GameSession.cursorDepth` for who hides the pointer and why one of them never
   * puts it back.
   */
  r("hidecursor", () => {
    session.cursorDepth--;
    return 0;
  });
  r("showcursor", () => {
    session.cursorDepth++;
    return 0;
  });

  for (const noop of [
    "debugger", // (flushevents no-ops in pointer.ts)
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
