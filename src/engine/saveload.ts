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
  SavedWalk,
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
  const dropped: string[] = [];
  const bytes = applyPatch(base, {
    numGlobals,
    strGlobals,
    set: session.currentSetFile,
    scene: session.currentSceneName(),
    view: session.currentViewName(),
    // The CD in play, which the skeleton being patched cannot be trusted for:
    // it is a shipped save or the last one loaded, and the story crosses back to
    // disc 1 at mission 4 without either changing. "" is a game that has mounted
    // no volume at all, and keeps the base's field. See SavePatch.disk.
    disk: session.mountedCd || undefined,
    // the frame counter, on the same scale as the frame stamps the globals
    // above carry (`paintframe`, `lastsail`, `secframe`) — the game reads the
    // two as a difference, so one without the other is meaningless (#221)
    frame: session.frameCounter,
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
      walks: walkSnapshot(session),
    },
    theme: themeSnapshot(session),
    onDrop: (name, why) => dropped.push(`${name} (${why})`),
  });
  // A base save has only so many free variable slots and only so much string
  // pool, and neither is grown — a save that outgrew its own header would not
  // load in the original engine (see poolIntern). So say what did not fit
  // instead of leaving it to be discovered as a global that "doesn't persist".
  //
  // And say it about the ITEMS, not about the save: the file is written and is
  // perfectly loadable, and "savegame: not written" read as though it were not
  // (#85 — "it says not written, but the save appears to have saved
  // successfully"). What becomes of a dropped item differs by kind — a global
  // keeps the base's value, a dropped walk is simply absent (#191) — so the
  // per-item reason is the message and the sentence claims nothing more.
  if (dropped.length) {
    session.onLog(
      `savegame: written, but ${dropped.length} ` +
        `item${dropped.length === 1 ? "" : "s"} could not be carried — ${dropped.join(", ")}`,
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
 * The walks table: every walk in flight, as the record TI.EXE's mover reads
 * (#191).
 *
 * This used to be a log line saying the walk was lost. The loader half arrived
 * first (#189) — a shipped save that catches someone mid-stride puts them back
 * on their own route — so the round trip was asymmetric: load save 17 and Daisy
 * finishes crossing the Grand Staircase, save that same moment through our own
 * writer and reload, and she is standing still. It shows the moment a player
 * saves mid-conversation-approach, because `walktopuppet` is a walk and it is
 * how most characters reach you.
 *
 * Three shapes, and the TYPE is which mover the original selects: a `turntodeg`
 * is 0 (a facing target and no movement at all), a straight line is 1, and an
 * authored `walkonpath` is 3 and carries its waypoints in a payload container.
 *
 * Two sign conventions have to be crossed here. The mover SUBTRACTS its deltas,
 * so the record's destination is `start - delta` while the scheduler holds
 * `dest - start`; applyPatch takes destinations and does that flip itself. And
 * `turnTo` is a number in the record where the scheduler has an absent one, -1
 * being what all three shipped routes carry for a turn already finished.
 */
function walkSnapshot(session: GameSession): SavedWalk[] {
  const out: SavedWalk[] = [];
  for (const [name, w] of session.scheduler.walks) {
    const a = session.actorRuntime.get(name);
    const path = w.path?.map((p) => ({ ...p }));
    const type = w.turnOnly ? 0 : path && path.length > 1 ? 3 : 1;
    out.push({
      actor: name,
      type,
      hasPayload: type === 3,
      paused: w.paused,
      turnTo: w.turnTo ?? -1,
      // the walk's own copy of the facing, which the record carries at +0x0a;
      // the actor's is the live one and the walk is stepping it
      deg: a?.deg ?? 0,
      startX: w.sx, startY: w.sy, startZ: w.sz,
      destX: w.sx + w.dx, destY: w.sy + w.dy, destZ: w.sz + w.dz,
      progress: Math.round(w.progress),
      dist: w.dist,
      // A TURN has no arrival, so the scheduler holds no star for one — but the
      // record does: TI.EXE's turn builder (0x443550) copies the actor's CURRENT
      // star into +0x3e, "so a turn does not change where anyone is going", and
      // all 12 shipped type-0 slots carry one. An empty star here would be a
      // shape no save TI.EXE ever wrote, and its arrival path sets `actorstar`
      // from the field unconditionally (#191 review).
      star: w.arriveStar ?? (w.turnOnly ? a?.starName ?? "" : ""),
      path,
    });
  }
  return out;
}

/**
 * Every loaded actor's record, both halves: `actorowner` and `actorvalue` (the
 * story state the characters themselves carry — the Purser's errand ladder,
 * Morrow's wireless-room permission, each idle's "have we spoken" gate), and
 * WHERE they stand — set, star, pose, xyz, deg, speed, `actorturn`, scale, zclip
 * and `actorvisible`. The load puts all of it back from the file instead of
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
        deg: a.deg, speed: a.speed, turn: a.turn, scale: a.scale, zclip: a.zclip,
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
 * Put back the DISC the save was taken on — the half of a load that is not game
 * state at all but where that state's files live.
 *
 * 93 basenames ship on both CDs, the public rooms once per act, and **70 of them
 * differ byte for byte** — 19 of those are `.set` rooms. Which copy the engine
 * reads is `setpath(disk)`'s to say, and BOOTFILE only ever calls it on a story
 * transition (`advanceday`: disc 1 for the 1942 prologue, disc 2 the moment you
 * board, disc 1 again when the iceberg is struck) or when the tour starts. A load
 * is none of those, so nothing re-stated it and the file store stayed wherever the
 * session happened to be — disc 1 after a cold boot, which is 78 of the 109
 * shipped saves opening the wrong act's rooms.
 *
 * The save says so itself. `setpath` mounts its volume by label —
 * `currentcd("Titanic2")` — and that label is the first thing in the file
 * (container 0 @256, {@link SaveGame.disk}); the original's own loader restores
 * the whole resource path table with it, `titanic2:data:` and all, which is
 * visible in the bytes of every shipped save. Matching it against the volumes the
 * game's own `setpath` names ({@link GameSession.discVolumes}) keeps the disc
 * order the game's, not a `titanic([12])` regex's.
 *
 * What it looked like: the vestibule door out of `veststbd` view18 (#231). Disc
 * 2's copy of that room sends you to `deckbd scene36/view110`, the promenade
 * outside the door; disc 1's older copy still names `scene379`, a scene deckbd
 * does not have — and an unresolvable scene falls back to the set's FIRST, which
 * in deckbd is the `Scene30` stub whose whole openscene is
 * `gotospecial ("decka", "scene354", "view357")`. So the player was handed
 * straight through the boat deck and out the other side onto A deck, having been
 * in deckbd for one frame. (Both engines fall back the same way — TI.EXE's scene
 * lookup at 0x409e50 returns "not found" and 0x40a880 adopts record 0 — so the
 * fallback was never the bug; reading the wrong disc's room was.)
 */
function mountSavedDisc(session: GameSession, disk: string): void {
  if (!disk) return;
  const disc = session.discVolumes.indexOf(disk.trim().toLowerCase()) + 1;
  if (disc === 1 || disc === 2) {
    session.onDiscChange?.(disc);
    // and it is now the mounted one, as far as the game is concerned — the
    // original restores the whole path table and its CD with it, and the next
    // save has to say which disc it was taken on (SavePatch.disk)
    session.mountedCd = disk;
    return;
  }
  // A single-volume game has no disc to put back and says so with no volumes at
  // all (the demo). A volume this game does not mount is worth a line: it means
  // the save came from another title's tree, and every both-discs room it opens
  // will be whichever copy happens to be selected.
  if (session.discVolumes.length) {
    session.onLog(`loadgame: saved on "${disk}", which is not a disc this game mounts`);
  }
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
  // The DISC, before anything reads a byte off one. See mountSavedDisc.
  mountSavedDisc(session, save.disk);

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
  // The displayed-frame counter, which the original restores with the rest of
  // container 1 (see C1_FRAME). It is not decoration: several of the globals
  // just restored are absolute frame stamps, and the game only ever reads them
  // as `frame() - stamp` — the cargo hold's ten minutes to reach the painting
  // (#221), the deck's Jones cooldown, the boot clock's own heartbeat. Left
  // counting from the browser tab's start instead of the saved game's, every
  // one of those deadlines was already long past the moment the save loaded.
  session.frameCounter = save.frame;
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
    // A walk in flight comes back mid-stride, because the original's does: load
    // save 17 in TI.EXE and Daisy finishes crossing the Grand Staircase to the
    // middle of the room. (User-reported, against a build that stood her still.)
    //
    // The record carries its own origin, deltas, distance and progress — and an
    // authored route carries its waypoints in a payload container of its own —
    // so this is a restore and not a fresh `walktostar`: the walker sets off from
    // where the save caught them with only what was left to run. See
    // `Scheduler.restoreWalk`.
    //
    // A walk that cannot be put back is DROPPED and its walker stood up, which
    // this only claimed to do before: the actor record restores the pose it was
    // saved in, that pose is `walk`, and an actor steps through its play script
    // whether a walk is running or not (#181) — so a drop that left the pose
    // alone left them treadmilling.
    for (const w of save.walks) {
      const a = session.actorRuntime.get(w.actor);
      const usable = w.type === 0 || w.type === 1 || (w.type === 3 && !!w.path);
      const resumed =
        !!a &&
        usable &&
        session.scheduler.restoreWalk(w.actor, {
          // type 0 is a `turntodeg`: a facing target and no mover at all
          turnOnly: w.type === 0,
          paused: w.paused,
          turnTo: w.turnTo >= 0 ? w.turnTo : undefined,
          sx: w.startX, sy: w.startY, sz: w.startZ,
          dx: w.destX - w.startX, dy: w.destY - w.startY, dz: w.destZ - w.startZ,
          dist: w.dist,
          progress: w.progress,
          arriveStar: w.star || undefined,
          path: w.path,
        });
      if (resumed) {
        session.onLog(
          w.type === 0
            ? `loadgame: ${w.actor} was saved mid-turn — resuming it`
            : `loadgame: ${w.actor} was saved walking to "${w.star}" — resuming it`,
        );
        continue;
      }
      if (a?.poseName.startsWith("walk")) {
        const lj = `stand${a.poseName.slice(4)}`; // walklj -> standlj, walk -> stand
        a.poseName = a.member.poses.some((p) => p.name === lj) ? lj : "stand";
        a.step = 0;
      }
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
    // `actorturn`, guarded the way `speed` is: only a script ever sets it and a
    // load runs no `openset` to set it again, so without this every restored
    // character turned at `stepDeg`'s floor of 1 instead of the 10 the file
    // records — a sub-second turn stretched to several seconds, and a
    // `walktopuppet` approach spent them rotating before anyone spoke.
    if (p.turn) a.turn = p.turn;
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
 * Put the sound back from the file: every bank that was open, then the theme
 * that was playing out of one of them.
 *
 * The theme half replaced an older path that halted the music and let the
 * arriving room's `setupsound` re-score it, which needed `currentset` forced to
 * "none" to beat the `themetype` guard and still left rooms silent where
 * setupsound deliberately scores nothing (#36's flat, gstair3, bind…). The file
 * simply says what was playing.
 *
 * The BANKS are a separate question, and opening only the theme's was #199. A
 * restored loop plays out of a bank that need not be sounding at the moment the
 * save was taken: BOOTFILE's `playcrickets` opens `insddest.sfx` once when
 * mission 4 starts and then picks a random one-shot out of it every few
 * seconds, so the sinking's groaning metal is a live `makeloop` over a SILENT
 * bank. Restoring the loop without the bank gave `countsounds` 0 →
 * `indextosound` "" → `sound not found: ` on every tick, for the rest of the
 * game: `setupsound` only re-opens it when `crickettype` changes, and lnghall,
 * lounge1c and smoke are all "insd".
 *
 * The list is the file's own, like the cast files above, and `openTrackFile` is
 * idempotent. A bank the PREVIOUS room had open and this save does not name is
 * left open rather than closed — the original's `opengame` re-opens exactly its
 * manifest and drops the rest, and ours accumulates (the load in #199 still had
 * the London flat's bedsit1/bedrad1 mounted). Inert, and its own question.
 *
 * What is NOT restored — and said: positional sound loops beyond the theme
 * (`save.theme.extras`, e.g. the smokestack maze's wind — the maze re-arms them
 * on the next movement), and the record's own channel volume (255 in every
 * shipped theme record; the player's themevolume global is applied instead).
 */
async function restoreTheme(session: GameSession, save: SaveGame): Promise<void> {
  session.audio.halt("theme");
  session.currentThemeName = "none";
  for (const bank of save.trackFiles) await session.openTrackFile(bank);
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
