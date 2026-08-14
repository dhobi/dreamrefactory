/**
 * Saving and loading `.ti` games, at the session level.
 *
 * Loading RESTORES the engine from the file, the way the original does: TI.EXE's
 * `opengame` (0x413860 → 0x414080) rebuilds the room through the engine's own
 * set machinery without ever reaching the script runners — `openset` and
 * `openscene` do not run on a load at all (#143, traced in the disassembly).
 * Everything those scripts would re-derive comes out of the file instead: the
 * cast (placement, scale, visibility), every prop's owner/view/position/z-order,
 * the live `makeloop`/`makecricket` tables, and the playing theme.
 *
 * Writing reproduces bytes by PATCHING a real save (the last one loaded, or a
 * shipped template) rather than serializing from scratch — see
 * docs/formats/savegame.md for why. The df/savegame.ts layer owns the byte
 * format (generic: every DreamFactory title's `.ti` shares it); this module owns
 * what the running game puts in and takes out, and THAT part is TAOOT-specific
 * by nature — which actor/prop owners are player state is a fact about TAOOT's
 * own scripts, not something the format declares. A second title's save story
 * would need its own actorSnapshot/inventorySnapshot.
 */
import {
  SavedActor,
  SavedActorPatch,
  SavedProp,
  SavedPropPatch,
  SaveGame,
  SavePatch,
  ThemePatch,
  applyPatch,
  parseSave,
  readSaveFile,
} from "../df/savegame";
import { degVariantFrames, frameIndexForDegree, playSequence } from "./props";
import { toNum } from "./interp";
import type { GameSession } from "./session";

/**
 * Produce the bytes of a save capturing the current progress, or null if no
 * base save/template is available to patch. Overwrites the script globals, the
 * current set/scene/view, every prop and actor record (both halves), the
 * scheduler's loop/cricket tables and the playing theme — everything our own
 * loader reads back, so a round-trip needs nothing from the room's scripts.
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
  // A walk in flight is not serialized (the original appends the walk's path as
  // a payload container; this writer zeroes the walk table instead) — the
  // actor's position is written, and their idle re-decides after the load.
  for (const name of session.scheduler.walks.keys()) {
    session.onLog(`savegame: ${name} is mid-walk — the walk is not saved, their position is`);
  }
  const dropped: string[] = [];
  const bytes = applyPatch(base, {
    numGlobals,
    strGlobals,
    set: session.currentSetFile,
    scene: session.currentSceneName(),
    view: session.currentViewName(),
    setFile: setFileSnapshot(session),
    inventory: inventorySnapshot(session),
    actors: actorSnapshot(session),
    scheduler: {
      loops: session.scheduler.loops.map((l) => ({
        kind: l.kind,
        name: l.name,
        handler: l.handler,
        // the live countdown, mid-flight — the original dumps its service
        // table verbatim, so the remaining ticks are what the field holds
        period: l.count,
      })),
      crickets: session.scheduler.crickets.map((c) => ({
        name: c.name,
        set: c.setName,
        x: c.x,
        y: c.y,
        radius: c.radius,
        base: c.base,
        jitter: c.jitter,
        next: c.count,
      })),
    },
    theme: themeSnapshot(session),
    onDrop: (name, why) => dropped.push(`${name} (${why})`),
  });
  // A base save has only so many free variable slots and only so much string
  // pool, and neither is grown — a save that outgrew its own header would not
  // load in the original engine (see poolIntern). So say what did not fit
  // instead of leaving it to be discovered as a global that "doesn't persist".
  //
  // And say it about the GLOBALS, not about the save: the file is written and is
  // perfectly loadable, and "savegame: not written" read as though it were not
  // (#85 — "it says not written, but the save appears to have saved
  // successfully"). What is lost is those variables, which keep the base's value.
  if (dropped.length) {
    session.onLog(
      `savegame: written, but ${dropped.length} ` +
        `item${dropped.length === 1 ? "" : "s"} did not fit the base save ` +
        `and keep the base's value — ${dropped.join(", ")}`,
    );
  }
  return bytes;
}

/**
 * The current set FILE with its register container refs. TI.EXE's loader
 * re-opens the room from the manifest path the set id at C1 @544 resolves to
 * and looks the saved scene/view up in the registers at C1 @644/@652 — the set
 * NAME the port writes at C1 @596 is not what it opens. Without this, a save
 * taken in a different room than its base re-opens the BASE's set in the
 * original engine and dies looking up our scene in its register ("Fatal error
 * at line 4248 (code 2)" in DosBox — see SavePatch.setFile in df/savegame.ts).
 */
function setFileSnapshot(session: GameSession): SavePatch["setFile"] {
  if (!session.currentSetFile) return undefined;
  const file = `${session.currentSetFile}.set`;
  const set = session.loadSet(file);
  if (!set) {
    session.onLog(`savegame: ${file} is not readable — the base save's set file record is kept`);
    return undefined;
  }
  return {
    file,
    actorRegister: set.actorRegister,
    sceneRegister: set.mainSceneRegister,
    // the register's record count is restored verbatim, never recomputed —
    // a smaller base set's count leaves later scenes unreachable (line 4248)
    sceneCount: set.scenes.length,
    // the set's half of the CLUT the loader restores to the screen — without
    // it a cross-room save comes back in the base room's colours
    clut: set.paletteRaw,
  };
}

/**
 * The playing theme with its bank's loop table. The save's playing/looping
 * lists must be one record per loop chunk — TI.EXE's post-load resume walks
 * the BANK's tables and only takes volume/pan from the save's records, so a
 * list shorter than the bank's runs off both heap blocks in the original
 * engine (the DosBox "Memory error at line 301: Unknown compression format"
 * fatal — see SavePatch.theme in df/savegame.ts). The chunks therefore come
 * from the open bank itself; a bank the library cannot resolve is passed with
 * empty chunks, which applyPatch writes as a silent room and reports.
 */
function themeSnapshot(session: GameSession): ThemePatch | null {
  const name = session.currentThemeName;
  if (name === "none") return null;
  const table = session.audioLib.loopTable(name);
  const volume = Math.max(0, Math.min(255, toNum(session.interp.globals.get("themevolume") ?? 255)));
  return { track: name, volume, chunks: table?.chunks ?? [], order: table?.order ?? [] };
}

/**
 * Every loaded actor's record, both halves: `actorowner` and `actorvalue` (the
 * story state the characters themselves carry — the Purser's errand ladder,
 * Morrow's wireless-room permission, each idle's "have we spoken" gate), and
 * WHERE they stand — set, star, pose, xyz, deg, speed, scale, zclip and
 * `actorvisible`. The load puts all of it back from the file instead of
 * re-running each room's `initactors`/`openset` (#86, #143).
 *
 * The CROWD is included. `setupgroup` makes the deck extras per room from
 * EXTRA.CST, which is why the shipped saves disagree about which of them exist
 * (25 records to 64) — and why the file is the only witness once a load no
 * longer re-runs the room that would remake them. A crowd record the base save
 * lacks is APPENDED (the actor container has no self-declared capacity; TI.EXE's
 * loader takes the count from the container's size — see applyPatch).
 */
function actorSnapshot(session: GameSession): SavedActorPatch[] {
  const out: SavedActorPatch[] = [];
  for (const [name, a] of session.actorRuntime.actors) {
    // scripts only ever count with it, but `actorvalue` is a script value and a
    // cast could put anything in one; a non-number saves as the fresh-game 0
    const value = typeof a.value === "number" && Number.isFinite(a.value) ? a.value : 0;
    out.push({
      name: name.toLowerCase(),
      owner: (String(a.owner) || "none").toLowerCase(),
      value,
      placement: {
        visible: !!a.visible,
        set: a.setName.toLowerCase(),
        star: a.starName.toLowerCase(),
        pose: a.poseName.toLowerCase(),
        x: a.worldX, y: a.worldY, z: a.worldZ,
        deg: a.deg, speed: a.speed, scale: a.scale, zclip: a.zclip,
      },
    });
  }
  return out;
}

/**
 * Every loaded prop's record, both halves — the owner/view and the numeric
 * fields (visible, screen anchor, deg, dist, scale, value, zclip) that say where
 * and how it draws. The original writes exactly this (its writer walks the live
 * prop list with no filtering), and the load reads it back instead of letting
 * `showinterface`/`setupsigns`/`setuparrow` re-derive the band (#143).
 *
 * **This used to be a hand-kept list, and it was short twice** (first the
 * bag/pocketwatch/deck map, then `baby` — #107). Hence no list: every prop, as
 * the original does, so there is no third time.
 *
 * The VIEW is written only for a prop whose state a script has actually set
 * (`stateName` non-empty): an untouched prop is still in its file default, and
 * overwriting the base's real reading with "" would lose it.
 */
function inventorySnapshot(session: GameSession): SavedPropPatch[] {
  const out: SavedPropPatch[] = [];
  for (const [name, p] of session.propRuntime.props) {
    const view = String(p.stateName ?? "").toLowerCase();
    const value = typeof p.value === "number" && Number.isFinite(p.value) ? p.value : 0;
    out.push({
      name,
      owner: (String(p.owner) || "none").toLowerCase(),
      ...(view ? { view } : {}),
      visible: !!p.visible,
      // `propis3d` — the record's own world-vs-screen flag, so the loader can
      // tell whether the x/y below mean anything (TAOOT's watch/bag are world
      // props on the cabin furniture until picked up, band props after)
      is3d: p.worldSpace,
      // a world-space prop's place is its world xyz, which the room's own shop
      // re-creates; the record's x/y are the screen anchor and only meaningful
      // for the screen-space props (all 72 in the boot shops are)
      ...(p.worldSpace ? {} : { x: p.anchorX, y: p.anchorY }),
      deg: Number(p.deg) || 0,
      dist: p.dist,
      scale: p.scale,
      value,
      zclip: p.zclip,
    });
  }
  return out;
}

/**
 * Load a `.ti` save — by restoring the serialized engine, not by re-running the
 * room. The original's load never reaches the script runners (see the module
 * note), so neither does this: the departing room's `closeset` does not run, the
 * arriving room's `openset`/`openscene` do not run (GameSession.restoringSave
 * mutes the whole lifecycle), and everything they would produce comes from the
 * file — cast, props, loops, crickets, music. The scene is still recorded as
 * current, so the first turn or step re-fires `openscene` normally.
 *
 * Returns false (and logs) on a bad/foreign save. See docs/formats/savegame.md.
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
  // `clock` rides those two maps with everything else. hallside decodes from
  // its record alone (the 4 shipped saves without one never entered a hall —
  // measured; an unset side is what a fresh game has too); savedeck keeps a
  // set-derived deck-letter fallback. Without a valid side, halla's keydown
  // guard error()s and swallows every key.
  if (save.hallside) session.interp.globals.set("hallside", save.hallside);
  if (save.savedeck) session.interp.globals.set("savedeck", save.savedeck);
  // A save is taken from the CTL menu, which sets lockevents=1 to freeze world
  // input while the panel is up — so every save carries lockevents=1. A load
  // returns you to interactive control, so drop it here. Left set, boot's
  // keydown handler exitcodes on every key: you can rotate (the host calls
  // viewer.turn() directly) but ArrowUp is swallowed and you cannot walk.
  session.interp.globals.set("lockevents", 0);

  // drop the previous room's timed state; the file's tables are restored below.
  session.scheduler.reset();
  // ...and any speech mid-line — a voice does not follow a load into another
  // room (puppet.ts only halts it on skip/stop, so it used to).
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

  // The rebuild proper, with the script runners muted (restoringSave gates
  // SetScripts.fireLifecycle): the whole point of #143 is that nothing below
  // is a script.
  session.restoringSave = true;
  try {
    // The departing room is DETACHED, not closed: its closeset does not run (the
    // original runs no scripts on a load — ENGINE.SET's closeset putting Vlad
    // down mid-load was half of #86), its timed state died with the scheduler
    // reset above, and the host releases its files when the new set activates.
    session.currentSetName = "none";
    session.currentSetFile = "";

    // The cast FILES the save had open, before any record is applied. A room's
    // crowd is not in the boot cast: lounge1c, smoke and deckbd2 each
    // `opencastfile("extra.cst")` from their openset, and a load runs no openset
    // (#143) — so the eight members the extras are instanced from were missing,
    // and restoreActors dropped every crowd record it could not find a source
    // for. 344 of them, across 39 of the 109 shipped saves (#186).
    //
    // The list is the file's own (SaveGame.castFiles), not a guess from the set
    // being entered: the save records what was open, which is exactly the
    // question, and `openCastFile` is idempotent so the boot cast costs nothing.
    //
    // A cast file the PREVIOUS room had open and this save does not name is left
    // open rather than closed. It is inert: resetCast puts every member down, and
    // a member the file has no record for stays that way.
    for (const file of save.castFiles) await session.openCastFile(file);

    // The cast, wholesale from the file — the original replaces its live actor
    // list with the read container (0x4143d2), so first everything not in the
    // file must go: instances are removed, members put down. Then every record
    // is applied, re-instancing the crowd extras the file names.
    resetCast(session);
    restoreActors(session, save.actors);

    // Every prop, both halves, from the file. This replaces the whole family of
    // script re-runs the old load fought with: initprops' mission defaults, the
    // house.shp openshop/initprops/showinterface dance, the hand-mirrored open
    // pocketwatch (its lid/hrs/min/sec anchor and z-order are IN the record:
    // x/y = the band anchor, dist = −6/−5/−5/−4), the nav arrow's lit deg (#4).
    restoreProps(session, save.inventory);

    // The scheduler tables, mid-count. This is what used to need the arriving
    // room's openset: the idles that make characters act, the scene timers, the
    // room's positional ambience.
    for (const l of save.loops) session.scheduler.restoreLoop(l.kind, l.name, l.handler, l.period);
    for (const c of save.crickets) {
      session.scheduler.restoreCricket(c.name, c.set, c.x, c.y, c.radius, c.base, c.jitter, c.next);
    }
    // A walk in flight is dropped, and said: its record's arrival dispatch is
    // not understood well enough to resume, the actor's position is already
    // restored, and their idle loop (also restored) re-decides. 3 of the 109
    // shipped saves carry one.
    for (const w of save.walks) {
      session.onLog(`loadgame: ${w.actor} was saved mid-walk — standing them at their saved position`);
    }

    // The music, from the file's track state — the track whose playing/looping
    // arrays are non-empty is the live theme (measured: exactly one track in
    // every shipped save; `savetheme`, the global, lags the file by up to a
    // whole act in 91 of 109 and is NOT it). No setupsound re-score, no
    // "currentset = none" guard games: the room comes back sounding as saved.
    await restoreTheme(session, save);

    // The arrival, through the engine's set machinery alone.
    await session.openSetFile(`${save.set}.set`, save.scene, save.view);
  } finally {
    session.restoringSave = false;
  }
  return true;
}

/**
 * Wipe the live cast before the file's records are applied: `actorinstance`
 * copies are removed (script and all — the file names the copies IT had), and
 * every cast member is put down and forgotten, exactly as if the engine's actor
 * list had been replaced. A member the file has no record for stays reset —
 * a record-less actor was never placed or spoken to in that game.
 */
function resetCast(session: GameSession): void {
  for (const [key, a] of [...session.actorRuntime.actors]) {
    if (a.member.name.toLowerCase() !== key.toLowerCase()) {
      session.actorRuntime.remove(key);
      session.dropInstancedScript(key);
      continue;
    }
    a.visible = false;
    a.owner = "none";
    a.value = 0;
    a.setName = "";
    a.starName = "";
    a.poseName = "stand";
    a.scale = 0;
  }
}

/**
 * Apply every actor record from the file: memory of the player (owner, value)
 * and the placement half — set, star, pose, xyz, deg, speed, zclip, `visible`
 * and `actorscale`.
 *
 * `visible` verbatim is what makes wholesale restore safe: `putdownactor` hides
 * a character without touching `actorset`, so "place anyone whose set matches"
 * would resurrect everyone who ever passed through the room.
 *
 * `actorscale` comes from the record (+42) — the field that makes a restored
 * character DRAWABLE (`visibleActors` skips scale 0), including the two script
 * overrides `stdscale(set)` can't reproduce (the stoker's 9000, extra.cst's
 * 2700). The old `sendtocastfx("gang.cst", stdscale(set))` round-trip is gone
 * with it.
 *
 * A record whose name is not a live actor is a CROWD instance (`setupgroup`
 * extras, the lifeboat line) — re-instanced from its cast member here, the same
 * `actorinstance` gesture the scripts use, with the member found by the names'
 * own convention (extras are `<member><suffix>`: brown1a1 ← brown1, stok4 ←
 * stok1, life12 ← life1).
 */
function restoreActors(session: GameSession, actors: SavedActor[]): void {
  for (const sa of actors) {
    let a = session.actorRuntime.get(sa.name);
    if (!a) {
      const src = instanceSource(session, sa.name);
      if (!src) {
        session.onLog(`loadgame: no cast member to re-instance "${sa.name}" from — dropped`);
        continue;
      }
      session.actorRuntime.instance(src, sa.name);
      session.instanceCastScript(src, sa.name);
      a = session.actorRuntime.get(sa.name);
      if (!a) continue;
    }
    a.owner = sa.owner;
    a.value = sa.value;
    const p = sa.placement;
    // A record with no set was never placed in this game — leave the actor as
    // resetCast left them rather than moving them to the origin.
    if (!p.set) continue;
    a.setName = p.set;
    a.starName = p.star;
    // an empty pose would draw nothing; the boot library's own default is "stand"
    a.poseName = p.pose || "stand";
    a.worldX = p.x;
    a.worldY = p.y;
    a.worldZ = p.z;
    a.deg = p.deg & 0xff;
    if (p.speed) a.speed = p.speed;
    a.zclip = p.zclip;
    a.visible = p.visible;
    if (p.scale > 0) a.scale = p.scale;
  }
}

/**
 * The cast member a crowd record re-instances from: the longest name prefix
 * that is a live actor, or that prefix + "1" (the member the numbered copies of
 * a group are made from — stok4 ← stok1, life12 ← life1).
 */
function instanceSource(session: GameSession, name: string): string | null {
  for (let n = name.length - 1; n >= 2; n--) {
    const prefix = name.slice(0, n);
    for (const src of [prefix, `${prefix}1`]) {
      if (src !== name && session.actorRuntime.get(src)) return src;
    }
  }
  return null;
}

/**
 * Apply every prop record from the file: owner, view, and the numeric half —
 * visibility, screen anchor, deg, z-order, scale, value, zclip.
 *
 * This is the read-back of the two fields the port used to parse and discard
 * (`propvisible` and the view) plus the ones it never read at all, and it is
 * what lets a load skip `showinterface`/`setupsigns`/`setuparrow`: the band's
 * lit-or-dark, the nav arrow's colour AND its lit deg, the destination signs,
 * the open pocketwatch's assembly (anchor + dist stack + wheel degs) all come
 * back exactly as the original engine recorded them. The old special cases —
 * HELD_BAND_PROPS, restoreOpenWatch, relightNavArrow — are this, generalized.
 */
function restoreProps(session: GameSession, inventory: SavedProp[]): void {
  for (const sp of inventory) {
    const p = session.propRuntime.get(sp.name);
    if (!p) continue;
    p.owner = sp.owner;
    p.value = sp.value;
    p.visible = sp.visible;
    // world-vs-screen comes from the RECORD (`propis3d`), not from whatever the
    // running game last did with the prop: the London flat and the two cabins
    // place TAOOT's watch/bag in the world (`setuprop`'s propxyz), and a load
    // taken after they moved to the band must put them back ON it — a stale
    // worldSpace left the band's watch and bag restored but never drawn.
    // A world prop's place is not in the record (no xyz); its room re-derives
    // it, exactly as the original does — the 4 pre-boarding shipped saves are
    // the measured case (watch/bag is3d=1, view=small).
    p.worldSpace = sp.is3d;
    if (!sp.is3d) {
      p.anchorX = sp.x;
      p.anchorY = sp.y;
    }
    p.deg = sp.deg;
    p.dist = sp.dist;
    if (sp.scale) p.scale = sp.scale;
    p.zclip = sp.zclip;
    // mimic propview(name, view): enter the state, reset its animation. The deg
    // is already set, so a deg-selector state holds the right frame (the watch
    // wheels come back showing the saved time, the arrow its saved colour).
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
}

/**
 * Put the music back from the file. The old path halted the theme and let the
 * arriving room's `setupsound` re-score it, which needed `currentset` forced to
 * "none" to beat the `themetype` guard and still left rooms silent where
 * setupsound deliberately scores nothing (#36's flat, gstair3, bind…). The file
 * simply says what was playing.
 *
 * What is NOT restored — and said: positional sound loops beyond the theme
 * (`save.theme.extras`, e.g. the smokestack maze's wind — the maze re-arms them
 * on the next movement), and the record's own channel volume (255 in every
 * shipped theme record; the player's themevolume global is applied instead).
 */
async function restoreTheme(session: GameSession, save: SaveGame): Promise<void> {
  session.audio.halt("theme");
  session.currentThemeName = "none";
  const t = save.theme;
  if (!t) return;
  await session.openTrackFile(t.track);
  const theme = session.audioLib.theme(t.track);
  if (!theme) {
    session.onLog(`loadgame: saved theme "${t.track}" is not available — the room loads silent`);
    return;
  }
  session.audio.play("theme", theme, { loop: true });
  session.currentThemeName = t.track;
  session.setThemeVolume(toNum(session.interp.globals.get("themevolume") ?? 255));
  if (t.extras > 0) {
    session.onLog(`loadgame: ${t.extras} additional saved sound loop(s) not restored (re-armed by the room)`);
  }
}
