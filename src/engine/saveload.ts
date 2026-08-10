/**
 * Saving and loading `.ti` games, at the session level.
 *
 * Writing reproduces bytes by PATCHING a real save (the last one loaded, or a
 * shipped template) rather than serializing from scratch — see
 * docs/formats/savegame.md for why. Loading restores the script globals and
 * then travels into the saved room, letting the game's own openset/openscene
 * scripts rebuild everything else. The df/savegame.ts layer owns the byte
 * format (generic: every DreamFactory title's `.ti` shares it); this module
 * owns what the running game puts in and takes out, and THAT part is
 * TAOOT-specific by nature — which actor/prop owners are player state is a
 * fact about TAOOT's own scripts (its `actorowner`/`propowner` conventions,
 * the inven.shp/house.shp split below), not something the format declares. A
 * second title's save story would need its own actorSnapshot/inventorySnapshot.
 */
import {
  SavedActor,
  SavedProp,
  applyPatch,
  parseSave,
  readSaveFile,
} from "../df/savegame";
import { degVariantFrames, frameIndexForDegree, playSequence } from "./props";
import type { GameSession } from "./session";

/**
 * Produce the bytes of a save capturing the current progress, or null if no
 * base save/template is available to patch. Overwrites the script globals
 * (numbers inline; strings as string-pool references) and the current
 * set/scene/view in a base save, leaving everything the loader ignores
 * untouched.
 */
export function snapshotSave(session: GameSession): Uint8Array | null {
  let base = session.lastSave;
  if (!base && session.saveTemplate) {
    const bytes = session.saveTemplate();
    if (bytes) {
      try {
        base = readSaveFile(bytes);
      } catch (e) {
        session.onLog(`savegame: bad template: ${(e as Error).message}`);
      }
    }
  }
  if (!base) return null;

  const numGlobals = new Map<string, number>();
  const strGlobals = new Map<string, string>();
  for (const [name, val] of session.interp.globals) {
    // the port's own bookkeeping is not game state: `__propsinit` is a
    // once-guard on TAOOT's inven.shp initprops, and a save that carried it would tell
    // the next session that seeding had already happened
    if (name.startsWith("__")) continue;
    if (typeof val === "number") numGlobals.set(name, val);
    else if (typeof val === "string") strGlobals.set(name, val);
  }
  const dropped: string[] = [];
  const bytes = applyPatch(base, {
    numGlobals,
    strGlobals,
    set: session.currentSetFile,
    scene: session.currentSceneName(),
    view: session.currentViewName(),
    inventory: inventorySnapshot(session),
    actors: actorSnapshot(session),
    onDrop: (name, why) => dropped.push(`${name} (${why})`),
  });
  // A base save has only so many free variable slots and only so much string
  // pool, and neither is grown — a save that outgrew its own header would not
  // load in the original engine (see poolIntern). So say what did not fit
  // instead of leaving it to be discovered as a global that "doesn't persist".
  if (dropped.length) session.onLog(`savegame: not written — ${dropped.join(", ")}`);
  return bytes;
}

/**
 * Every loaded actor's `actorowner` and `actorvalue` — the story state the
 * characters themselves carry, which nothing was writing.
 *
 * Neither is decoration. TAOOT's Purser mission-2 errand is a ladder of his owner
 * values, Morrow's permission to enter the wireless room is "enterwireless", and
 * the chief engineer's turbine job is `actorowner("csea")`. A save without them
 * reloads with the crew having forgotten the player: the Purser hands out the
 * telegram errand again and the ladder starts over.
 *
 * `actorvalue` is the same kind of memory kept as a count. `runpuppet` ends every
 * exchange with `actorvalue(target, actorvalue(target) + 1)`, and each idle gates
 * on it — `if actorvalue(me) <= 0 → hasattention(4)`, else `clearattention()`. It
 * lived only in the running session, so it survived a LOAD the one way it must
 * not: talk to Vlad, reload a save from before you met him, and he still would
 * not walk up to you, and clicking him opened the "we have met" branch of his
 * puppet rather than the introduction. Reported against both #19 and #21.
 *
 * These two only — an actor's position and animation are rebuilt by the room's
 * own `initactors` on load, and writing them back would fight it.
 */
function actorSnapshot(session: GameSession): SavedActor[] {
  const out: SavedActor[] = [];
  for (const [name, a] of session.actorRuntime.actors) {
    // scripts only ever count with it, but `actorvalue` is a script value and a
    // cast could put anything in one; a non-number saves as the fresh-game 0
    const value = typeof a.value === "number" && Number.isFinite(a.value) ? a.value : 0;
    out.push({
      name: name.toLowerCase(),
      owner: (String(a.owner) || "none").toLowerCase(),
      value,
    });
  }
  return out;
}

/**
 * The current owner + view of every prop that is player state: TAOOT's
 * `inven.shp` collected items, and the `house.shp` interface band's held items
 * — the bag, the pocketwatch and the deck map (see {@link HELD_BAND_PROPS}).
 *
 * The band items matter as much as the inventory, and writing only the shop was
 * a mission-breaking asymmetry: {@link loadGame} restores them (that is what
 * HELD_BAND_PROPS is for — shipped saves carry them), but nothing wrote them, so
 * a save taken mid-voyage came back with no bag. house.shp's initinterface()
 * places the bag from `propowner("bag")`, so an unowned bag is put back on the
 * C73 bed — and with it the trunk key, which `addbag()` is the only source of.
 * Loading your own save at mission 1 therefore left the trunk (and the Enigma
 * machine inside it) permanently unopenable.
 */
function inventorySnapshot(session: GameSession): SavedProp[] {
  const out: SavedProp[] = [];
  const record = (name: string): void => {
    const p = session.propRuntime.get(name);
    if (!p) return;
    out.push({
      name: name.toLowerCase(),
      view: (String(p.stateName) || "large").toLowerCase(),
      owner: (String(p.owner) || "none").toLowerCase(),
    });
  };
  for (const g of session.propRuntime.shops.get("inven.shp")?.shp.groups ?? []) record(g.name);
  // only the held items: the rest of the band is chrome initinterface() rebuilds
  for (const name of HELD_BAND_PROPS) record(name);
  return out;
}

/**
 * Load a `.ti` save. Rather than reconstruct every subsystem from the save's
 * pointer-laden containers, we load the way the game itself does: restore the
 * script globals + clock, tear down the old room's timed state, then travel
 * into the saved set/scene/view and let the normal openset/openscene scripts
 * rebuild loops, props, actors, crickets and music at the restored progress.
 * Returns false (and logs) on a bad/foreign save. See docs/formats/savegame.md.
 *
 * The choreography below is TAOOT's own `initall` (BOOTFILE) taken apart step
 * by step, so its shop/cast names (inven.shp, house.shp, gang.cst) and globals
 * (hallside, savedeck, lockevents…) are that game's boot library, not engine
 * vocabulary — the same as {@link inventorySnapshot}/{@link actorSnapshot} above.
 */
export async function loadGame(session: GameSession, bytes: Uint8Array): Promise<boolean> {
  let save;
  try {
    save = parseSave(bytes);
  } catch (e) {
    session.onLog(`opengame: not a valid saved game file (${(e as Error).message})`);
    return false;
  }
  if (save.title !== "Titanic 1.0") {
    session.onLog(`opengame: saved game is from a different version ("${save.title}")`);
    return false;
  }

  // script globals: numbers (mission/phase/counters/puzzles) and strings
  // (hallside, savedeck, handitem, fusebox, savestage/saveflat stack, …) both
  // restore from the variable records — see decodeVars for the format.
  for (const [k, v] of save.numGlobals) session.interp.globals.set(k, v);
  for (const [k, v] of save.strGlobals) session.interp.globals.set(k, v);
  // `clock` rides those two maps with everything else. It is the variable-list
  // HEAD, whose DFValue sits in the blob header (see decodeVarSlots), and the
  // heuristic that used to guess it out of the location container's savestate
  // stack read the FIRST day event ever pushed rather than the pending one —
  // "startdisk1" on every save taken after the London flat. TAOOT's `advanceday`
  // is a switch on this value, so a save loaded into the flat replayed the whole
  // intro when the bombs went off (datebed.mov, mission=0) instead of advancing
  // to the Titanic, and the restarted flat is the #36 lock all over again.
  // hallside/savedeck fall back to location-stack recovery when the record
  // didn't decode; without a valid side, halla's keydown guard error()s and
  // swallows every key — you couldn't leave the deck.
  if (save.hallside) session.interp.globals.set("hallside", save.hallside);
  if (save.savedeck) session.interp.globals.set("savedeck", save.savedeck);
  // A save is taken from the CTL menu, which sets lockevents=1 to freeze world
  // input while the panel is up — so every save carries lockevents=1. A load
  // returns you to interactive control, so drop it here (before initall, so a
  // set whose openset legitimately re-locks input still wins). Left set, boot's
  // keydown handler exitcodes on every key: you can rotate (the host calls
  // viewer.turn() directly) but ArrowUp is swallowed and you cannot walk.
  session.interp.globals.set("lockevents", 0);

  // drop the previous room's loops/crickets/walks/sounds — the new room's
  // scripts rebuild them from scratch.
  session.scheduler.reset();
  // ...and its MUSIC and its SPEECH, which the scheduler does not own. A load is
  // a day-advance in miniature, so it silences the same way advanceday() does
  // (BOOTFILE 0002:148 halts the theme before opening the next day's room): the
  // arriving room's openset -> setupsound starts from silence and decides the
  // music alone. Leaving it to the destination is not enough, because setupsound
  // sometimes deliberately scores nothing — arriving in C73 at mission 1 phase 0
  // is scored by the Smethells knock, not by a deck theme — and then the room you
  // LEFT keeps playing. Measured: start the game in the London flat, load a save
  // from the CTL menu, and bedrad1.trk (whose loop chunks are the announcer) reads
  // the news over the loaded room. `currentThemeName` has to come down with it or
  // the session reports a theme the new room never chose, and transfromflat's
  // overlay restore keys off exactly that value — closing a later overlay would
  // put the flat's radio BACK. `voice` is the same hole one channel over: the
  // scheduler doesn't touch it and puppet.ts only halts it on skip/stop, so a load
  // taken mid-line let the speaker follow you into the next room.
  session.audio.halt("theme");
  session.currentThemeName = "none";
  session.audio.halt("voice");
  // reuse this save's skeleton as the base for the next savegame.
  session.lastSave = save.raw;

  // leave the control-panel overlay stage and restore the in-game stage before
  // navigating (mirrors the CTL save choreography). A load is a hard reset:
  // drop any transtoflat overlay frames (the ctl.stg the load was launched
  // from) so a later transfromflat can't pop a stale one, and make the room
  // visible again — opening ctl.stg had set setVisible=false, and unlike the
  // normal transfromflat exit this path never restores it, so without this the
  // loaded room stays hidden behind the empty main.stg band (a white screen).
  session.stageCtrl.resetOverlayStack();
  await session.stageCtrl.closeStageFile();
  await session.stageCtrl.openStageFile("main.stg");
  session.setVisible = true;
  // Put the departing room's band away, the way the CTL panel did on the way in
  // (transtoflat -> sendtoshop(house.shp, hideinterface())). It is the half of
  // the choreography that has to happen BEFORE the save's own memo is restored:
  // hideinterface writes what is on screen NOW into the owners, and the restore
  // below overwrites that with what the save recorded. Without it nothing ever
  // hides a piece of chrome the loaded room has no business showing.
  await session.sendEvent("sendtoshop", "house.shp", "hideinterface", [], "loadgame");

  // Who owns what, BEFORE the room opens as well as after.
  //
  // `initall` runs the room's own `openset`/`openscene`, and those scripts READ
  // ownership to decide what the room contains: c73 puts the ring on the table
  // for `propowner("ring") = "trunk"`, the lit car hold branches on `carlights`,
  // and in mission 4 the first-class lounge places Zeitel, whose idle then
  // accosts anyone standing within `hotdist()` — and what he SAYS is chosen by
  // `propowner("painting")`. Restore only after initall and every one of those
  // reads the mission's defaults instead of the save.
  //
  // That is not theoretical: the endgame checkpoint taken next to Zeitel with the
  // painting already traded to him made him open `poison()` — the branch for
  // someone who has not traded yet — which parks on plaques, inside the load,
  // and the load never returned. Restoring twice is cheap and the second pass is
  // still needed, because initall's `inven.shp initprops` deals the mission's
  // default inventory over the top (in mission 4 it hands the boat pass, the baby
  // and the antidote back to Buick, Beatrix and Zeitel).
  restoreProps(session, save.inventory);
  restoreActors(session, save.actors);

  // Navigate + rebuild the room — `initall`, taken apart, because the order it
  // puts its three steps in only works on an engine that defers openset.
  //
  // `initall` is `changeset(...)`, then `sendtocast("gang.cst", initactors())`,
  // then `sendtoshop("inven.shp", initprops())`. And `initactors` sends
  // `initactor()` to EVERY character, which is `putdownactor()`, which is
  // `actorvisible(target, false)` (BOOTFILE 0002:739). So the room is opened
  // first and then everybody in it is put down — which cannot be what the
  // original does, and is exactly what ours did: measured on
  // "16 - Traded Boat Pass for Painting.ti", the boat deck came back with
  // fourteen people on it for a frame and then empty, and re-running the set's
  // own openset by hand put all fourteen back (out/endgame, load-probe).
  //
  // The difference is WHEN the arriving set's openset runs. Ours fires it inside
  // `opensetfile`, so it lands in the middle of initall; TI.EXE must dispatch it
  // after the script that opened the set has returned, which puts it after
  // initactors and makes the room the last word. Deferring ours is an engine
  // change for every changeset in the game; running initall's steps in the order
  // the original ENDS UP in costs nothing and is what a load needs:
  //
  //   put the whole cast down · deal the mission's default inventory · open the
  //   room, which places the people who belong in it
  //
  // (initall's own head — stoploop/stopwalk/stopcricket — is the scheduler reset
  // above.) The saved owners are already in place, and openset reads them: the
  // boat deck only puts Lady Georgia out for `actorowner("ga") != "rescued"`.
  await session.sendEvent("sendtocast", "gang.cst", "initactors", [], "loadgame");
  await session.sendEvent("sendtoshop", "inven.shp", "initprops", [], "loadgame");
  // A load arrives from NOWHERE, and the room it arrives in has to be scored as
  // such. `changeset` records `oldset = currentset()` BEFORE it opens anything,
  // and the arriving room's `setupsound` opens with
  //
  //     if themetype (currentset ()) = themetype (oldset)
  //         exitcode
  //
  // — the guard that keeps the deck theme playing as you walk from room to room.
  // Load a save of the room you are ALREADY standing in and those two are equal,
  // so setupsound scored nothing; and this path has just halted the theme, so
  // "nothing" means silence, and the host's startTheme fallback then plays the
  // SET-NAMED bank. Measured over the shipped saves, reloading in place: gstair3,
  // bind, hallb and sqhall were left silent, and the London flat got `bedsit1.trk`
  // — which is the BOMBING score, not the flat's radio (`bedrad1.trk`).
  //
  // In bedsit1 that is not just wrong music. The room gates its own hotspots on
  // it (BEDSIT1.SET setcursor): memory, paper, cabinet, obit, cards, mantle,
  // poster and radio only take a `cursor("touch")` while `currenttheme(2) !=
  // "bedsit1.trk"`. So loading the game's own first save — "01 - April 14th,
  // 1942", which saves the flat you start in — began the sirens and left nothing
  // but the door and the landlady clickable (#36).
  //
  // Close the departing room HERE, which is what makes `currentset()` "none"
  // before changeset reads it. Its own `closeset` still runs exactly once —
  // changeset would have called the same `closesetfile` a moment later, and now
  // skips it because there is nothing open. GameHost.coldBoot resets the same two
  // fields for the same reason, one entry point over.
  await session.currentBinding?.closeSet();
  session.currentSetName = "none";
  session.currentSetFile = "";
  await session.runGlobal("changeset", [save.set, save.scene, save.view]);

  // initall re-seeds DEFAULT inventory + interface for the mission; overwrite
  // with the player's actual collected items, then rebuild the interface band.
  // The shipped initall only re-runs inven.shp's initprops, never house.shp's,
  // so the band (whose initinterface() places bag/watch/map by propowner) is
  // stale after a load — the bag/clock/map don't appear. Restore ownership
  // first, then re-run house.shp openshop (band placement; pulls props out of
  // any leftover C73-bed world space) + initprops (visibility per ownership),
  // then re-apply the saved views over initinterface's dark defaults.
  restoreProps(session, save.inventory);
  await session.sendEvent("sendtoshop", "house.shp", "openshop", [], "loadgame");
  await session.sendEvent("sendtoshop", "house.shp", "initprops", [], "loadgame");
  restoreProps(session, save.inventory);
  // The band comes back the way it goes away. A load happens from the CTL panel,
  // which is a flat: `transtoflat` hid the band with `hideinterface()` and
  // `transfromflat` puts it back with `showinterface()`, which shows each piece
  // of chrome only if its memo (the owner, just restored from the save) says it
  // was up. Our load path leaves the flat by hand and so never ran the second
  // half — nothing hid the band and nothing consulted the save about it, so
  // whatever the departing room had on screen stayed there. The Help button is
  // the visible one: house.shp only ever sets it up in the London flat or in C73
  // at mission 1, and it followed a load onto the sinking boat deck.
  await session.sendEvent("sendtoshop", "house.shp", "showinterface", [], "loadgame");
  await restoreOpenWatch(session);
  relightNavArrow(session);
  // and the crew's memory of the player, AFTER the rebuild — `initactors` deals
  // the cast out for the mission and would otherwise have the last word. Owners
  // only: the room has just placed its people and must keep them.
  restoreActors(session, save.actors);
  return true;
}

/**
 * TAOOT's pocketwatch open dial: the lid and the three digit wheels, at the band's
 * anchor with the dist stack the watch's own `open()` gives them (HOUSE.SHP 0291
 * — lid furthest back, the seconds wheel nearest the front).
 *
 * These four are the one band state `showinterface()` cannot finish on its own.
 * It brings them BACK — `propvisible("lid"/"hrs"/"min"/"sec", true)` when
 * `propview("watch") = "run"` — but it never places them and never gives the lid
 * a state, because in normal play nothing has to: the only route to a visible lid
 * is the watch's `open()`, which places all four and then hands off to `run()`.
 * A load reaches the same screen without going through `open()`.
 *
 * Their view is deliberately left alone. `open()` doesn't set one either — the
 * wheels have a single state ("idle": 31 frames for the hours, 60 each for the
 * minutes and seconds) and `calctime` drives them by `propdeg`, not by view.
 */
const WATCH_ASSEMBLY: readonly (readonly [name: string, dist: number])[] = [
  ["lid", -6],
  ["hrs", -5],
  ["min", -5],
  ["sec", -4],
];
/** the interface band's anchor, where `openshop` puts every piece of it. */
const BAND_ANCHOR_X = 256;
const BAND_ANCHOR_Y = 324;

/**
 * Put an open pocketwatch back together after a load.
 *
 * 17 of the 109 shipped saves record `watch` view "run" — the watch left open
 * with its dial running, which is how the endgame is played, and every one of the
 * 17 is an endgame save. Restoring the band's views (see {@link HELD_BAND_PROPS})
 * is what lets that view survive `initinterface()`, but the dial alone is not the
 * watch: without this the lid and the three wheels come back visible, stateless
 * and unplaced — drawn at the default anchor in the middle of the screen at dist
 * 0 instead of stacked in the band.
 *
 * And a stateless lid is not merely ugly, it is a dead end. `watchidle()` returns
 * false while `propvisible("lid")` and `propview("lid") != "run"`, and every band
 * handler opens with `if not watchidle() exitcode` — so the bag, the map and the
 * lifebuoy all stop answering, and the lifebuoy is the way to the CTL panel. The
 * watch cannot even be shut again: its `mousedown` case "run" closes the lid only
 * `if propview("lid") = "run"`. A player loading one of the 17 got a game they
 * could not save, could not load out of, and could not open the bag in.
 *
 * The placement is mirrored from `open()` rather than restored from the file: the
 * save's prop records are 158 bytes and only the view (+48) and owner (+64) are
 * decoded, so whether the original restores an anchor and dist of its own is an
 * open question (TODO §11a). `run()` is dispatched rather than reimplemented,
 * because the lid's state and the deg that picks the mission's dial face are the
 * script's decision, not ours.
 */
async function restoreOpenWatch(session: GameSession): Promise<void> {
  const watch = session.propRuntime.get("watch");
  if (String(watch?.stateName ?? "").toLowerCase() !== "run") return;
  for (const [name, dist] of WATCH_ASSEMBLY) {
    const p = session.propRuntime.get(name);
    if (!p) continue;
    p.anchorX = BAND_ANCHOR_X;
    p.anchorY = BAND_ANCHOR_Y;
    p.dist = dist;
  }
  // the tail of the open animation: lid view "run", deg per mission.
  await session.sendEvent("sendtoprop", "watch", "run", [], "loadgame");
}

/**
 * Put the nav arrow's lit-or-dark back in step with the rest of the band.
 *
 * The band has two looks and the player switches between them by clicking it:
 * house.shp's `activateinterface` sets the lifebuoy, watch and map to their
 * "light" view, shows the lamp and sets `propdeg("navarrow", 1)`;
 * `deactivateinterface` sets all of them dark and the arrow back to 0. So the
 * arrow is the one piece of the band whose lit state is a DEGREE rather than a
 * view — the SHP bears that out, `navarrow` having green/red/yellow of two frames
 * each where `life`, `watch` and `map` carry separate dark/light states.
 *
 * Which is why {@link HELD_BAND_PROPS} misses it. That set restores the band's
 * look from the save by VIEW, and `initprops` above has just re-run
 * `initinterface` — whose defaults include `propdeg("navarrow", 0)`. The four
 * views come back lit and the arrow stays dark:
 *
 *     after loading "11 - Giving Book to purser"
 *       life=light watch=light map=light lamp=visible     the band is lit
 *       navarrow view=green deg=0                         the arrow is dark
 *
 * and every one of the 109 shipped saves records `life` as "light", because a
 * save is taken from the CTL panel and the way in is a click on the lit
 * lifebuoy — so this fired on every load there is (#4). Clicking the band put it
 * right, which is the report's "cycling the active/inactive in the UI fixes it":
 * activateinterface sets both halves at once.
 *
 * The lifebuoy is the state to read rather than a flag of our own: it is the
 * piece those two routines move in lockstep with the arrow, and its view is
 * restored from the file. Nothing here re-runs `activateinterface` itself, which
 * would be the obvious move and is wrong — it ends in `voicesound("lighton")`,
 * the click, and a load is not a click.
 */
function relightNavArrow(session: GameSession): void {
  const arrow = session.propRuntime.get("navarrow");
  if (!arrow) return;
  const lit = String(session.propRuntime.get("life")?.stateName ?? "").toLowerCase() === "light";
  arrow.deg = lit ? 1 : 0;
}

/**
 * Restore each character's `actorowner` and `actorvalue` from a save.
 *
 * Only actors whose cast is loaded exist to restore onto; the rest are dropped
 * silently, which is right — a cast that is not loaded has no state to be wrong,
 * and the one that matters in TAOOT (gang.cst, the whole ship's company) is
 * loaded for the whole voyage.
 *
 * Restoring the count is what makes a load UNDO a conversation, which is the
 * whole point: it has to be written even when it is zero, or a save taken before
 * you met someone would leave the running session's count standing.
 */
function restoreActors(session: GameSession, actors: SavedActor[]): void {
  for (const sa of actors) {
    const a = session.actorRuntime.get(sa.name);
    if (!a) continue;
    a.owner = sa.owner;
    a.value = sa.value;
  }
}

/**
 * TAOOT's band props whose APPEARANCE the save owns: the bag, the pocketwatch,
 * the deck map and the lifebuoy. Their stored view is the band's lit-or-dark state
 * (and, for the watch, whether its dial is open), which no script recomputes on
 * a load — so it has to come back from the file.
 *
 * Everything else in the band is derived chrome whose look is worked out for the
 * room: the nav arrow's colour is road-computed by setuparrow(), the signs are
 * chosen by visdeg() from where you stand, and the lamp's own visibility is
 * decided by showinterface() from its owner. Those get their OWNER restored (for
 * chrome the owner IS the memo) and nothing else.
 */
const HELD_BAND_PROPS = new Set(["bag", "watch", "map", "life"]);

/**
 * Restore player-state props' owner + view from a save, overriding the defaults
 * `initprops` seeded: TAOOT's `inven.shp` inventory items and `house.shp`
 * interface band.
 *
 * Possession (`owner === "frank"`) is what gates item use and what the band's
 * initinterface() checks to place the bag, watch and map — so it must be
 * restored, or a loaded game shows an empty band. For the band's derived chrome
 * the owner is not possession at all but the band's MEMO of what was on screen,
 * written by hideinterface() and read back by showinterface().
 *
 * The view is the inventory slot, or the band's lit-or-dark appearance
 * ({@link HELD_BAND_PROPS}); the bag/band redraw on the next flat-update tick
 * reads these fields. Set-specific props are not restored here — the openset
 * scripts rebuild them. No shipped save holds an in-hand item (`handitem` is
 * empty), so it's cleared.
 */
function restoreProps(session: GameSession, inventory: SavedProp[]): void {
  if (!inventory.length) return;
  for (const sp of inventory) {
    const p = session.propRuntime.get(sp.name);
    if (!p) continue;
    const shop = p.shop?.name?.toLowerCase();
    if (shop === "house.shp") {
      // Every band prop's OWNER comes back, held item or chrome, because for the
      // chrome the owner IS the band's memo: `hideinterface()` writes each one's
      // visibility into it ("vis"/"notvis") and `showinterface()` reads it back
      // (HOUSE.SHP 0001). Skipping them left the memo belonging to whatever room
      // the session was standing in — load a mission-4 save from the London flat
      // and the flat's Help button, which the save records as "notvis", came back
      // up on the boat deck. (Measured across the 109 shipped saves: `invenhelp`
      // is "notvis" in 105 and "vis" in exactly the four earliest — the ones with
      // no bag, watch or map yet, i.e. the London flat, which is where
      // `initprops` sets Help up and the only place it belongs.) For chrome that
      // is ALL that comes back: the nav arrow's colour is road-computed and the
      // signs are chosen by where you stand, so a saved view would clobber what
      // setuparrow()/visdeg() work out for the room.
      if (!HELD_BAND_PROPS.has(sp.name)) {
        p.owner = sp.owner;
        continue;
      }
      // ...and for the four whose looks the save owns, the VIEW comes back too,
      // through the same code as an inventory item (below).
      //
      // This used to restore possession only, on the reading that a loaded game
      // should show the DARK band and that `initinterface()` — which sets
      // bag "darkclosed", watch/map/life "dark" — was therefore the last word.
      // That reading is wrong, and the shipped saves say so unanimously: the CTL
      // panel is reached by clicking the lifebuoy, and clicking the lifebuoy is
      // `activateinterface()`, so a save can only ever be taken with the band LIT.
      // All 109 record `light` (the lamp) owner "on" and `life` view "light"; 105
      // of them (every save past the London flat) record bag "lightclosed" and
      // map "light". `showinterface()` restores the LAMP from its owner but never
      // touches a view, so leaving initinterface's dark defaults in place put a
      // lit lamp above a dark band — visible as the lifebuoy alone staying dark.
      //
      // It also loses the pocketwatch: `showinterface()` brings the open dial
      // back only `if propview("watch") = "run"`, which 17 of the 109 saves
      // record, and which initinterface had already overwritten with "dark".
      // Our sequence restores before showinterface, so the view is there to read.
      //
      // Safe now in a way it was not: `map`/`life` "dark"/"light" are 2-frame
      // deg-selector states (no play script, `animated` false), so the frame
      // logic below HOLDS the deg-matched frame instead of animating — which is
      // what once walked the map to its guided-tour icon on load.
    } else if (shop !== "inven.shp") {
      continue;
    }
    p.owner = sp.owner;
    // mimic propview(name, view): enter the state, reset its animation.
    p.stateName = sp.view;
    p.lastTick = 0;
    p.frameLocked = false;
    const st = p.state();
    // Hold the deg-matched frame for a deg-selector prop OR a 2-frame state
    // that is not a real animation (the same twoFrameSelector rule as the
    // propview() builtin — see there). Only genuine animations play.
    const twoFrameSelector = !!st && st.frames.length === 2 && !st.animated;
    if (p.degVariants || twoFrameSelector) {
      p.frameOrder = null; // a raw index into st.frames
      p.frameIdx = st ? frameIndexForDegree(st, Number(p.deg) || 0) : 0;
      p.frameLocked = true;
      p.animating = false;
    } else {
      p.frameIdx = 0;
      // a state holding one animation per degree plays only its own variant
      p.frameOrder = st ? playSequence(st, degVariantFrames(st, Number(p.deg) || 0)) : null;
      p.animating = !!st && p.frameCount(st) > 1;
    }
  }
  session.interp.globals.set("handitem", "");
}
