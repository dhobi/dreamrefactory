import { ScriptError, toNum, toStr, truthy, type Value } from "../interp";
import { RAMP_STEP_MS, ticksAt } from "../clock";
import { packPoint } from "../point";
import { dfPlan, isDfEffect, isExeEffect, type DfEffect, type ExeEffect } from "../visual-effects";
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
    await session.maze?.closeSet();
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
  r("currentscene", async (i_, [dir]) => {
    if (dir === undefined) return session.currentSceneName();
    // a DreamFactory 5 room: a direction turns or walks a scene's views, a
    // name goes to another node or scene (engine/src/runtime/maze.ts)
    if (session.maze) {
      const d = toStr(dir);
      const low = d.toLowerCase();
      if (low === "left" || low === "right" || low === "strait") await session.maze.move(low);
      else await session.maze.setScene(d);
      return;
    }
    const d = toStr(dir).toLowerCase();
    // DreamFactory 1 looks the word up in the set's scene table first
    // (0x40ee66 -> 0x410c50) — TOWN.SET's "chicken" is a scene — and only
    // then reads it as a direction; the others jump to a "sceneNNN"
    const set = session.isV1 ? session.currentBinding?.set : undefined;
    const isScene = set ? set.scenes.some((sc) => sc.sceneName.toLowerCase() === d) : d.startsWith("scene");
    if (isScene) {
      // a DreamFactory 1 jump runs its scene events before the next line
      // (SetViewer.jumpV1); the others' return nothing to wait on
      const jump = session.onSceneJump(d);
      if (jump) await jump;
      return;
    }
    // a word that names no direction is a bad argument (TI.EXE 0x407c84;
    // DF.EXE 0x40ef44, which knows a fourth, "backwards")
    const known = d === "left" || d === "right" || d === "strait" || (session.isV1 && d === "backwards");
    if (i_.classic && !known) throw new ScriptError(0xa, `currentscene(${d})`);
    await session.onNavigate(d);
  });
  // currentview() reads the current view; currentview("viewNNN") SETS it — the
  // teleport's destination view (executes a buffered currentscene jump). Was
  // getter-only, so TAOOT's hall crossover currentview(...) was silently dropped
  // and the move never happened.
  r("currentview", async (_i, [view]) => {
    if (view === undefined) return session.currentViewName();
    const jump = session.onViewJump(toStr(view).toLowerCase());
    if (jump) await jump;
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
   * Answering the file would pass on Titanic, where the two are the same string:
   * all fifteen of its stages store their own filename in the name field
   * (`StgFile.refName`), so nothing there can tell the difference. Timelapse can.
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
   * Dust needs the name too: a v1 `.FLT` has a name field, 20 bytes before v4's
   * (#325), and three of its own tests depend on the difference: `HOUSE.PRP`'s inventory-book handler asks
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
  //
  // ...except in DreamFactory 1, where ids 20017/20018 are `setwidth ()` and
  // `setheight ()`: the open set's grid size in cells, the header words at
  // +0x26/+0x28 (V1 C0.gridWidth/gridHeight, carried as mapWidth/mapHeight).
  // DF.EXE's value dispatch (0x42a5e0, `jmp [eax*4 + 0x42ba6c]`, base 20002)
  // sends them to 0x4108e0 and 0x410930: pure getters that read no argument,
  // and with no set open (word 0x460b64 = 0) fail with error 0x28 — answered 0
  // here. Dust's cow-menu demo (`randomscene`) picks a random cell with them.
  const setGrid = (dim: "mapWidth" | "mapHeight", cmd: string): number => {
    const set = session.currentBinding?.set;
    if (!set) {
      session.onLog(`${cmd}: no set open`);
      return 0;
    }
    return set[dim];
  };
  r("countpaintings", (_i, [scene, view]) =>
    session.isV1
      ? setGrid("mapHeight", "setheight")
      : (viewByName(toStr(scene ?? ""), toStr(view ?? ""))?.objects.length ?? 0),
  );
  // v4's own `pointinpainting` has no semantics here: off DreamFactory 1 it stays
  // the unknown command it was
  r("pointinpainting", (i, args) => {
    if (session.isV1) return setGrid("mapWidth", "setwidth");
    i.onUnknown("pointinpainting", args);
    return 0;
  });
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

  // the effect names `visualeffect` takes — each evaluates to itself, and what
  // it draws is `visualeffect`'s business (below)
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
   * Blocking is the part that matters, and it is not a detail. In TI.EXE
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
    // step 1 is drawn on the tick it is asked on (0x435b90) — see tickFade
    if (!session.fade.queue.length) session.fade.lastTick = ticksAt(session.clock.now) - 1;
    session.fade.queue.push({ to, steps: n });
    session.fade.pendingReveal = false;
    // a ramp is a ramp of a named palette — see GameSession.fade.blanked
    session.fade.blanked = false;
    if (session.hasRealFrames || session.modalMovies) await session.transitionCtrl.ramp((n * 50) / 3);
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
    session.fade.blanked = true;
  };
  r("blackscreen", blackNow);
  // currenttheme([layer]): the looping theme currently playing (the layer arg
  // selects a mix channel in TI.EXE; we track a single theme, so it's ignored).
  //
  // DreamFactory 1 asks it two questions (0x407b50): `currenttheme(2)` is the
  // playing bank's own name (+0x16, copied from its header +0x9e at 0x406dc8,
  // via 0x407df0) — what CREDITS.FLT saves to `playtheme` again on the way
  // out — and anything else the loop CHUNK playing (0x429d10: the record's
  // +0x45), which TOWN.SET and NITE.SET test against "daymusic5" and
  // "nightwind3" to let their dog barks and owls in. "none" when no theme plays.
  r("currenttheme", (_i, [n]) => {
    if (!session.isV1) return session.currentThemeName;
    const playing = session.currentThemeName;
    if (playing === "none") return "none";
    if (toNum(n ?? 0) === 2) return session.audioLib.trackNameOf(playing) ?? playing;
    const since = session.themeSince;
    const bank = session.audioLib.bankOf(playing);
    if (!since || !bank || since.bank !== bank) return "none";
    return session.audioLib.themeChunkAt(bank, (session.clock.now - since.at) / 1000) ?? "none";
  });
  // framerate([n]): getter/setter for the engine's target frame cadence. Drag
  // loops save it, drop to a slow rate to pace the rotate (TAOOT's turbine valves:
  // `rate = framerate(); framerate(2); …; framerate(rate)`), then restore. Our
  // poll loops pace on real rAF frames via forceupdate(), so this only needs to
  // round-trip a value — store it so the save/restore reads back consistently.
  //
  // It is the pass rate: the frame throttle waits `framerate` ticks after every
  // pass (Scheduler.throttle). The setter clamps to 0..60 — TI.EXE 0x43e3a9,
  // tl.exe 0x44a9ad, DF.EXE 0x42077d, RedJack.exe 0x408cae, all four the same.
  r("framerate", (_i, [n]) => {
    if (n === undefined) return session.frameRate;
    session.frameRate = Math.max(0, Math.min(60, Math.trunc(toNum(n))));
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
  // The getter is not optional: the scripts duck the score with a
  // READ-MODIFY-WRITE, `themevol(t, themevol(t) / 4)`, so answering nothing
  // would answer 0 — the music set to silence and then multiplied back up from
  // zero. See GameSession.themeVolume for the two places that would bite.
  // The track NAME is not purely informational, though: the volume is remembered
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
   * That is load-bearing, not a no-op on the reasoning that `blackscreen()` is
   * always beside it. It is not always: `transtoflat`'s `rub.stg`
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
   * Every effect but `plain` and `nodraw` is a reveal — the new screen is wiped,
   * irised, scrolled or pushed in over the old one, one strip per 60 Hz tick
   * over `steps` passes. A reveal also ENDS the transition-black the script put
   * up to hide the change; an effect treated as a no-op would leave nothing
   * ending it.
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
  r("visualeffect", (_i, [effect, steps], _c, frame) => {
    // DF.EXE and RedJack.exe check the id's band BEFORE anything else, and an id
    // outside it is error 0xe with no pass and no effect: DF.EXE's band is
    // 24001..24014 (0x4202fa..0x42030a -> 0x4203cd), so the turns and `nodraw`
    // are not effects there at all, and RedJack.exe's is 24001..24020
    // (0x408ba2..0x408bb6 -> 0x408c6f), so `turnhalfright` (24021) is not one.
    const id = toStr(effect ?? "").toLowerCase();
    if (session.isV1 ? NOT_DF.has(id) : session.isV5 && id === "turnhalfright") {
      throw new ScriptError(0xe, `visualeffect: ${id} is not an effect here`);
    }
    // A PASS first, with its screen copy held back (TI.EXE 0x43df85 raises
    // 0x489ef6, which 0x43a8f7 tests before the blit; tl.exe 0x44a585;
    // RedJack.exe 0x408c3c raises 0x4c7846 round its pass 0x408c43) — the
    // loops, walks and crickets run and the throttle is waited out — and the
    // effect only if that pass did not fail (0x43df9e, 0x408c4f).
    const sched = session.scheduler;
    session.effectPassHeld = true;
    return sched.pass({ wait: sched.passWait(frame) }).then(
      (ok) => {
        // the effect reads the held screen as the picture it leaves, and draws
        // from there on (GameSession.effectPassHeld)
        try {
          return ok ? visualEffect(effect, steps) : undefined;
        } finally {
          session.effectPassHeld = false;
        }
      },
      (e: unknown) => {
        session.effectPassHeld = false;
        throw e;
      },
    );
  });
  /** TI.EXE's effect names DF.EXE's command table does not have (see the band check above) */
  const NOT_DF: ReadonlySet<string> = new Set([
    "turnright", "turnleft", "turnup", "turndown", "nodraw", "turnhalfleft", "turnhalfright",
  ]);
  const visualEffect = (effect: Value | undefined, steps: Value | undefined): Promise<void> | void => {
    const name = toStr(effect ?? "plain").toLowerCase();
    if (name === "plain") {
      // NOT a no-op: `plain` is a full-screen redraw (tl.exe 0x448630 blits the
      // screen rect to itself), which is how a script makes a change it just made
      // visible before whatever it does next reads the screen. It still must not
      // clear a pending reveal — see the note above.
      session.repaintNow?.();
      return;
    }
    // `nodraw` (24019) is no reveal at all: the jump table sends it to the
    // dispatcher's bare `ret` (TI.EXE 0x43b615; RedJack.exe's slot 18 is its
    // epilogue, 0x436a09), so the pass ran with its screen copy held back
    // (0x489ef6) and nothing is copied after it — the screen keeps what it had,
    // black included. The glowstick's x-ray asks for it every drag step
    // (plugins.ts) and draws the picture itself. So it must not lift the
    // transition-black the way a reveal does. (DF.EXE has no 24019.)
    if (name === "nodraw") return;
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
    // TAOOT asks for wipeleft and wiperight (9 reveals), Dust adds barndooropen
    // and barndoorclose — its map and inventory screens arrive middle-outwards
    // (4 opens, 3 closes, reported from play as "the map and the menu have an
    // opening animation in the real game"). `venetian`, the irises, the scrolls,
    // wipeup/wipedown and turnup/turndown are in the vocabulary although no
    // shipped script asks for them, and they are ported all the same, read off
    // each exe's functions rather than guessed (runtime/visual-effects.ts has
    // the addresses). TI.EXE, tl.exe and RedJack.exe draw them alike, strip for
    // strip; DF.EXE has its own plan for its thirteen — a fixed number of passes
    // with `steps` only setting how long each is held — so a Dust reveal is
    // DF.EXE's (`draws: "df"`).
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
      turnleft: "turnleft", turnhalfleft: "turnleft",
      turnright: "turnright", turnhalfright: "turnright",
    } as const;
    /**
     * ...except in a DreamFactory 5 game, where 24020 is not `turnhalfleft` but
     * `photodissolve` — RedJack.exe's own command table names it so, and v5
     * has no 24021. It is how RedJack brings up its control panel and crosses
     * into a new day, and read as the first leg of a Timelapse turn it held the
     * screen on a half-pushed picture waiting for a second leg that never came.
     *
     * RedJack.exe's turnleft/turnright/turnup/turndown (0x4379a0, 0x4376a0,
     * 0x437ca0, 0x437fa0) push exactly as TI.EXE's do, pass for pass, so v5
     * takes TI.EXE's turns too. (Each first checks there is memory for a
     * snapshot of the screen, 0x46ce10, and is a plain copy without it; the port
     * always has it.)
     */
    let exe: ExeEffect | DfEffect | null = null;
    if (session.isV1 ? isDfEffect(name) : isExeEffect(name)) exe = name as ExeEffect | DfEffect;
    let dir: typeof session.wipe.dir | undefined = DIR[name as keyof typeof DIR];
    if (exe) dir = "exe";
    else if (session.isV5 && name === "turnhalfleft") dir = "dissolve";
    if (!dir) return;
    const from = session.captureFrame?.() ?? null;
    if (!from) return;
    /**
     * A reveal also captures the picture it is ARRIVING at, here, once. The
     * script has already done `gotoflat`, so the current flat is the one the
     * effect is arriving at; painting it now and holding the capture is the
     * port's copy of the original's offscreen surface, which `gotoflat` drew
     * and the modal effect then consumed unchanged. Left to the live frame
     * instead, an animating destination swapped the entering strips mid-ramp
     * (i0001.103's water reached frame 3 before the turn was over), and the
     * between-legs composite drifted with it. Every effect is modal the same
     * way in all three exes. See GameSession.wipe.to.
     */
    session.repaintNow?.();
    const to = session.captureFrame?.() ?? null;
    if (!to) return;
    session.wipe.from = from;
    session.wipe.to = to;
    session.wipe.dir = dir;
    session.wipe.effect = exe ?? "";
    session.wipe.settled = false;
    // the `half` pair travels half the screen (tl.exe 0x448b48); the rest all of it
    const half = dir !== "dissolve" && (name === "turnhalfleft" || name === "turnhalfright");
    session.wipe.span = half ? 0.5 : 1;
    // clamped the way TI.EXE clamps it, 1..1000 (0x43df60..0x43df7a; DF.EXE
    // 0x420370..0x42038a, RedJack.exe 0x408c0c..0x408c25)
    const clamped = Math.min(1000, Math.max(1, toNum(steps ?? 0) || 1));
    if (session.isV1 && exe) {
      // DF.EXE: its fixed passes, each held its own length, and one more step
      // for the hold after the last pass (see dfPlan)
      const plan = dfPlan(exe as DfEffect, clamped, to.height);
      session.wipe.draws = "df";
      session.wipe.passMs = plan.passMs;
      session.wipe.steps = plan.passes + 1;
    } else {
      session.wipe.draws = "ti";
      session.wipe.passMs = 0;
      session.wipe.steps = clamped;
    }
    session.wipe.step = 0;
    session.wipe.lastTick = 0;
    // the pacer's `timeBase`: the tick the effect begins on (see tickWipe)
    session.wipe.baseTick = ticksAt(session.clock.now);
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
      // (a DF.EXE ramp's steps are its holds, which can be many ticks long)
      const ticks = Math.ceil((session.wipe.steps * (session.wipe.passMs || RAMP_STEP_MS)) / RAMP_STEP_MS);
      const cap = ticks * 4 + 60;
      for (let i = 0; i < cap && session.wiping; i++) await session.frameWait();
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
  };

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

  // The *script family opened the in-engine script editor on a named object
  // (`propscript(me)`, `buttonscript(currentflat(), me)`). The shipped TI.EXE
  // has the editor compiled out — every handler ends in 0x42b490, which only
  // copies a string and returns — but each still checks what it was handed
  // first, and that is ported here, reachable or not (every call in the TAOOT
  // tree sits behind `if debugging`, which nothing sets true):
  //
  //   bootscript, postscript, serverscript  nothing to check      0x42a880/8b0/8e0
  //   setscript ()               a set open, else 0x28          0x4086e0
  //   scenescript (scene)        set 0x28, scene 0xa            0x408750 -> 0x409e50
  //   paintingscript (s, v, p)   set 0xb, scene, view, painting 0xa  0x409330
  //   stagescript ()             a stage open, else 0xb         0x446250
  //   flatscript (flat)          stage 0xb, flat 0xa            0x4462c0 -> 0x447440
  //   buttonscript (flat, btn)   stage 0xb, flat, button 0xa    0x446380 -> 0x447530
  //   puppetscript (script)      a puppet open 0x2d, script 0xa 0x43fd80 -> 0x440470
  //   propscript (prop)          prop 0xa                       0x417d90 -> 0x418870
  //   castscript (file)          cast file 0xa                  0x40fdf0 -> 0x410e50
  //   actorscript (actor)        actor 0xa                      0x40fd40 -> 0x410d00
  //   shopscript (file)          shop file 0xa                  0x417e40 -> 0x4189d0
  //
  // tl.exe's fourteen are the same (0x42cd90, 0x40cc10, 0x435180 …). The other
  // two engines differ in three places, and only there:
  //
  //  - id 12037 is DF.EXE's `floorscript (n)` (its own name table says so):
  //    a set open, else 0x28; an integer 0..31, else 0xe (0x410000-0x410062).
  //    RedJack.exe's `paintingscript` wants a set open too, else 0x28 (0x4425b6).
  //  - DF.EXE has no 12089 or 12091 — its statement band stops at 12088
  //    (`cmp eax, 0x57`, 0x41ee7a) — so `postscript` and `serverscript` are
  //    error 1 there (0x41ee97), as any id past the band is: the interpreter
  //    raises it before the call reaches a builtin (value-types.ts dispatches).
  //  - DF.EXE's scenescript, after the stub, re-stores the scene (0x428450,
  //    0x4114c0, an alert 0x1521 if that fails): the script the compiled-out
  //    editor could not change. Not modelled; nothing it stores is new.
  //
  // RedJack.exe: 0x42b2e0 propscript, 0x441000 scenescript, 0x404d80
  // actorscript, 0x404e10 castscript, 0x42b370 shopscript, 0x42fa50
  // puppetscript, 0x4144d0/0x414530/0x414690 stage/flat/buttonscript — the
  // same tests and codes, its editor 0x43beb0 compiled out the same way.
  const lc = (v: Value | undefined): string => toStr(v ?? "").toLowerCase();
  const has = (keys: Iterable<string>, name: Value | undefined): boolean => {
    const n = lc(name);
    for (const k of keys) if (k.toLowerCase() === n) return true;
    return false;
  };
  const miss = (cmd: string, what: string, name: Value | undefined): never => {
    throw new ScriptError(0xa, `${cmd}: no ${what} "${toStr(name ?? "")}"`);
  };
  const needSet = (cmd: string, code: number): void => {
    if (!session.currentBinding) throw new ScriptError(code, `${cmd}: no set open`);
  };
  const needStage = (cmd: string): void => {
    if (!session.stageOpen) throw new ScriptError(0xb, `${cmd}: no stage open`);
  };
  const needFlat = (cmd: string, flat: Value | undefined): void => {
    if (!has(session.flatNames, flat)) miss(cmd, "flat", flat);
  };
  const editorChecks: Record<string, (args: Value[]) => void> = {
    bootscript: () => {},
    // in DF.EXE these two are error 1 before they get here (value-types.ts dispatches)
    postscript: () => {},
    serverscript: () => {},
    setscript: () => needSet("setscript", 0x28),
    scenescript: ([scene]) => {
      needSet("scenescript", 0x28);
      if (!sceneByName(toStr(scene ?? ""))) miss("scenescript", "scene", scene);
    },
    paintingscript: ([scene, view, painting]) => {
      if (session.isV1) {
        // DF.EXE's floorscript (n)
        needSet("floorscript", 0x28);
        if (typeof scene !== "number" || scene < 0 || scene >= 32) {
          throw new ScriptError(0xe, `floorscript: floor ${toStr(scene ?? "")} is not 0..31`);
        }
        return;
      }
      needSet("paintingscript", session.isV5 ? 0x28 : 0xb);
      if (!sceneByName(toStr(scene ?? ""))) miss("paintingscript", "scene", scene);
      const v = viewByName(toStr(scene ?? ""), toStr(view ?? ""));
      if (!v) miss("paintingscript", "view", view);
      if (!v!.objects.some((o) => o.identifier.toLowerCase() === lc(painting))) miss("paintingscript", "painting", painting);
    },
    stagescript: () => needStage("stagescript"),
    flatscript: ([flat]) => {
      needStage("flatscript");
      needFlat("flatscript", flat);
    },
    buttonscript: ([flat, button]) => {
      needStage("buttonscript");
      needFlat("buttonscript", flat);
      if (!has(session.stageCtrl.flatButtonNames(toStr(flat ?? "")), button)) miss("buttonscript", "button", button);
    },
    puppetscript: ([script]) => {
      if (!session.puppet) throw new ScriptError(0x2d, "puppetscript: no puppet open");
      if (!has(session.puppet.scripts.keys(), script)) miss("puppetscript", "puppet script", script);
    },
    propscript: ([prop]) => {
      if (!session.propRuntime.get(toStr(prop ?? ""))) miss("propscript", "prop", prop);
    },
    castscript: ([file]) => {
      if (!has(session.actorRuntime.casts.keys(), file)) miss("castscript", "cast file", file);
    },
    actorscript: ([actor]) => {
      if (!session.actorRuntime.get(toStr(actor ?? ""))) miss("actorscript", "actor", actor);
    },
    shopscript: ([file]) => {
      if (!has(session.propRuntime.shops.keys(), file)) miss("shopscript", "shop file", file);
    },
  };
  for (const [cmd, check] of Object.entries(editorChecks)) {
    r(cmd, (_i, args) => {
      check(args);
    });
  }

  /*
   * The modifier-key probes.
   *
   * `shiftkey()` answers for real, and exactly one thing in the shipping game
   * changes as a result. Census of the English tree — generated, and the whole of
   * it is `docs/taoot/devmode-census.md` (`npx tsx taoot/tools/devcensus.ts`):
   * **324 probe calls across 211 script containers**, and all but FOUR are gated
   * on `debugging` — which is assigned once in the whole corpus, `debugging =
   * false` in BOOTFILE, so those stay as dormant as they would be if this
   * returned 0.
   *
   * Of the four ungated ones,
   * three are `optionkey` (option-drag moves the cricket in Z, scales a smokestack
   * prop, and opens `debugger()` in PHOTO.SHP) and the fourth is the one worth
   * having: house.shp's "help" prop answers a shift-click with the game's own
   * state readout, `notedialog("Mission=" @ … @ ", Phase=" @ …)`, with Maze and
   * Level added in the three smokestack sets. That is #8, and it is reachable
   * only because this can answer "held".
   *
   * So the other two answer from the session and the session leaves them false.
   * That is not the same as hardwiring them to 0:
   * nothing in the shipping game reaches them except those three dev tools, and
   * "option-drag rescales the artwork" is not a thing a player should be able to
   * do to their own game by accident — but it IS the thing the 1996 debug build
   * could do, and a page whose whole purpose is to be that build should be able
   * to ask for it. So the decision moves to the page: Titanic's play page sets
   * `shiftDown` and nothing else, so `optionkey()` answers 0 there exactly as a
   * hardwired 0 would, and only `taoot/devmode/` ever raises these two.
   *
   * That matters more than the count suggests. Of those probes, the ones behind
   * `debugging` are overwhelmingly `optionkey () & debugging` — the placement
   * mode, the bedsit's item grab, the coordinate readouts, `debugger()` — so with
   * these stuck at 0 the flag on its own opens almost nothing.
   */
  r("shiftkey", () => (session.shiftDown ? 1 : 0));
  r("optionkey", () => (session.altDown ? 1 : 0));
  r("commandkey", () => (session.metaDown ? 1 : 0));
}
