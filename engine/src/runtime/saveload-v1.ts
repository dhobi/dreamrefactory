/**
 * Saving and loading a Dust game: what the session puts into a `.rtd` and takes
 * out of one.
 *
 * *Prerequisite: [`../df/savegame-v1.ts`](../df/savegame-v1.ts), the byte format,
 * and [`saveload.ts`](saveload.ts), the same two halves for Titanic.*
 *
 * The division of labour is the play page's: the format module knows the bytes
 * and nothing about a session, this one knows the session and asks the format
 * module for the bytes. And the CHOREOGRAPHY is the play page's too — reset the
 * timed world, apply the file's records with the script runners muted, then
 * arrive through the engine's own set machinery — because that sequence is not
 * about Titanic. It is about what a load is: the room you arrive in was never
 * entered, so nothing re-derives anything and the file has to carry the screen.
 *
 * What is genuinely different is the two ends:
 *
 *  - **where you are.** A `.ti` names the scene and the view; a `.rtd` gives a
 *    grid cell and one of four facings, which is how Dust's SET addresses a
 *    standpoint in the first place. So the cell is resolved against the set's own
 *    scene table to get the name the engine wants ({@link sceneAtCell}).
 *  - **what a record holds.** v1's cast record is four bytes longer than v4's and
 *    its numeric tail is not mapped, so the fields this port does not know are
 *    filled from the LIVE object rather than guessed at — a restore then leaves
 *    them exactly as the running game had them instead of zeroing them. See
 *    {@link asV4Actor}.
 *
 * There is no disc to mount (Dust is one CD), no cast crowd to re-instance from
 * a numbered source, and no track containers to reopen — Dust's ambience is one
 * looping bank chunk, recorded in container 0 and in the `loopsound` global
 * alike, and the room's own scene loop restarts it.
 */

import {
  DUST_SAVE_TITLE,
  SavedActorV1,
  SavedPropV1,
  type SaveGameV1,
  type SavePatchV1,
  applyPatchV1,
  describeSaveV1,
  parseSaveV1,
  saveTitleMatches,
} from "../df/savegame-v1";
import { toNum } from "./interp";
import { readSaveFile } from "../df/savegame";
import { readSetFileV1 } from "../df/set-v1";
import { detectVersion } from "../df/version";
import type { SavedActor, SavedProp } from "../df/savegame";
import type { GameSession } from "./session";
import { resetCast, restoreActors, restoreProps } from "./saveload";

/** the flat the game plays under — the in-game panel, not the menu you saved from */
const PLAY_FLAT = "mainpanel";
/** world units per grid cell, and the offset of a cell's centre */
const CELL_UNITS = 256;
const CELL_MID = 128;

/**
 * The scene name for a grid cell, out of the set's own table.
 *
 * A v1 scene's position is carried into the translated set as world units
 * (`xAxisMap = x·256 + 128`, see `set-v1-to-v4.ts`), so the cell the save records
 * is matched by arithmetic rather than by name — and the name that comes back
 * ("Scene G14") is the one the engine's scene lookup wants.
 *
 * Null when the set has no scene there, which is a real possibility and not a
 * bug to swallow: the caller then opens the set at its own default standpoint and
 * says so, which is a playable room rather than a failed load.
 */
export function sceneAtCell(session: GameSession, setFile: string, cellX: number, cellZ: number): string | null {
  const set = session.loadSet(setFile);
  if (!set) return null;
  const x = cellX * CELL_UNITS + CELL_MID;
  const z = cellZ * CELL_UNITS + CELL_MID;
  for (const s of set.scenes) {
    if (s.xAxisMap === x && s.zAxisMap === z) return s.sceneName;
  }
  return null;
}

/** the cell a set's scene name sits on — the inverse, for writing a save */
function cellOfScene(session: GameSession, setFile: string, sceneName: string): { x: number; z: number } | null {
  const set = session.loadSet(setFile);
  if (!set) return null;
  const want = sceneName.toLowerCase();
  for (const s of set.scenes) {
    if (s.sceneName.toLowerCase() === want) {
      return {
        x: Math.round((s.xAxisMap - CELL_MID) / CELL_UNITS),
        z: Math.round((s.zAxisMap - CELL_MID) / CELL_UNITS),
      };
    }
  }
  return null;
}

/**
 * A v1 cast record in the shape `restoreActors` takes.
 *
 * The two fields still unmapped in the v1 record — `value` and `zclip` — are
 * filled from the LIVE actor, so applying the record cannot change a field whose
 * offset this port has not proven. Everything else is the file's, `scale`
 * included, and that one is load-bearing: a load resets the cast first and a
 * reset actor has scale 0, which the draw list skips.
 */
function asV4Actor(session: GameSession, a: SavedActorV1): SavedActor {
  const live = session.actorRuntime.get(a.name);
  return {
    name: a.name,
    owner: a.owner,
    // the live field is `string | number` (a prop or actor can be owned by a
    // number); a v1 record holds it as a Pascal string, so keep whatever the
    // running object has for the half this port cannot place
    value: Number(live?.value ?? 0) || 0,
    placement: {
      visible: a.visible,
      set: a.set,
      star: a.star,
      pose: a.pose,
      x: a.x,
      y: a.y,
      z: a.z,
      deg: a.deg,
      speed: a.speed,
      turn: a.turn,
      scale: a.scale,
      zclip: live?.zclip ?? 0,
    },
  };
}

/** a v1 prop record in the shape `restoreProps` takes (see {@link asV4Actor}) */
function asV4Prop(session: GameSession, p: SavedPropV1): SavedProp {
  const live = session.propRuntime.get(p.name);
  return {
    name: p.name,
    view: p.view,
    owner: p.owner,
    visible: p.visible,
    is3d: p.is3d,
    // the screen anchor, which v4 keeps in the same two fields
    x: p.screenX,
    y: p.screenY,
    deg: p.deg,
    dist: p.dist,
    scale: p.scale,
    value: Number(live?.value ?? 0) || 0,
    zclip: live?.zclip ?? 0,
  };
}

/**
 * Load a Dust save.
 *
 * False without side effects for a file that is not a save or is another
 * title's; true once the room has been rebuilt and entered.
 */
/**
 * The sound: the banks the save had open, and the loop that was sounding out of
 * one of them.
 *
 * The v1 loader restored neither, and both halves were audible. Reported as
 * "loading a game does not restore the playing theme": load `D1E_002` in DUST.EXE
 * and the saloon theme is there at once, load it here and the saloon was silent.
 *
 * ## The banks come first, and not only for the theme
 *
 * A load re-arms the scheduler from the file and runs no `openset` (see the note
 * on GameSession.restoringSave), so the room's ambience comes back as a restored
 * LOOP — `D1E_001` carries `scene:scene g14.nightfxs`, which is NITE.SET's night
 * chorus: it picks a sound by distance, `soundloop`s it and fires the occasional
 * owl, distant dog or coyote over the top. Every one of those is an identifier in
 * a bank, and with no bank open `singlesound` had nothing to find. That is why
 * the night was completely silent and not merely music-less.
 *
 * ## Which bank is "town.snd"
 *
 * `NIGHT.SND` calls itself `town.snd`, exactly as `TOWN.SND` does — DF.EXE's
 * banks are named twice and the scripts use both names (AudioLibrary.find) —
 * and NITE.SET's `openset` is `opentrackfile ("night.snd")`, `playtheme
 * ("town.snd")`. So the save's bank LIST, which holds those inside names, says
 * "town.snd" for a night game, and opening a file by that name would fetch the
 * daylight bank: no owl, no night wind, and a day theme under a night sky.
 *
 * The theme record's words are handles into the open-file manifest, so they name
 * the FILE. Opening that first and then skipping any listed name the open banks
 * already answer to is what puts `D1E_001` back with exactly the two banks it
 * was saved with, `night.snd` and `unilib.snd`.
 *
 * ## What is not restored, and said
 *
 * The third word, and it is NOT a hole in this. It is an index into the loop that
 * was sounding — not a container location of one: `D1E_002` carries 6 against
 * `saloon2.snd`, whose seven loop chunks are `newrag 1`..`newrag 7` at locations
 * 8..14, while location 6 there is a one-shot crowd yell. Nothing resumes from
 * it: DF.EXE restarts the loop from its beginning on a load (checked in the
 * original — `D1E_002` comes back with the ragtime from the top), and the port
 * plays a bank's loop chunks as one concatenation (AudioLibrary.theme) and does
 * the same. The word is recorded and unused on both sides.
 *
 * What IS missing is neither of those:
 *
 *   - a bank with NO loop chunks cannot be resumed at all. `D2M_004` is one
 *     (`mayor.snd`, the hall clock), and it loads silent with a line saying so.
 *   - `currenttheme (1)` is the name of the chunk sounding NOW, which a script
 *     reads while the loop RUNS — `if currenttheme (1) != "nightwind3"` is what
 *     gates NITE.SET's random owl and coyote — and a single concatenated buffer
 *     cannot answer it. Nothing to do with loading; its own fix.
 */
async function restoreThemeV1(session: GameSession, save: SaveGameV1): Promise<void> {
  session.audio.halt("theme");
  session.currentThemeName = "none";
  const t = save.theme;
  // the playing bank first, then the one the loop belongs to: both are files
  const opened: string[] = [];
  for (const file of [t?.playingBank, t?.loopBank]) {
    if (file && !opened.includes(file.toLowerCase()) && (await session.openTrackFile(file))) {
      opened.push(file.toLowerCase());
    }
  }
  // ...and the rest of the list, minus whatever the open banks already are —
  // by either of their two names, which is what keeps a night save's "town.snd"
  // from dragging the daylight bank in beside night.snd
  for (const name of save.bankFiles) {
    if (session.audioLib.trackNameOf(name) !== null) continue;
    if (await session.openTrackFile(name)) opened.push(name.toLowerCase());
  }
  if (opened.length) session.onLog(`opengame: sound banks restored: ${opened.join(", ")}`);

  const playing = t?.playingBank;
  if (!playing) {
    // Not a failure and worth saying: D1E_001 is saved with the theme stopped,
    // so the night comes back as the room's own loops and nothing else.
    session.onLog("opengame: this save was taken with no theme playing");
    return;
  }
  const theme = session.audioLib.theme(playing);
  if (!theme) {
    session.onLog(`opengame: saved theme bank "${playing}" has no loop to play — the room loads silent`);
    return;
  }
  session.audio.play("theme", theme, { loop: true });
  // the name a script gets back from `currenttheme (2)` and hands to `playtheme`,
  // which is the bank's INSIDE name and not the file it came out of
  session.currentThemeName = session.audioLib.trackNameOf(playing) ?? playing;
  session.setThemeVolume(toNum(session.interp.globals.get("themevolume") ?? 255));
  session.onLog(`opengame: theme "${session.currentThemeName}" resumed from ${playing}`);
}

export async function loadGameV1(session: GameSession, bytes: Uint8Array): Promise<boolean> {
  let save;
  try {
    save = parseSaveV1(bytes);
  } catch (e) {
    session.onLog(`opengame: not a valid Dust save (${(e as Error).message})`);
    return false;
  }
  if (!saveTitleMatches(save.title, DUST_SAVE_TITLE)) {
    session.onLog(`opengame: saved game is from a different version ("${save.title}")`);
    return false;
  }
  session.onLog(`opengame: ${describeSaveV1(save)}`);

  // ---- the state that is not in a room ------------------------------------
  for (const [k, v] of save.numGlobals) session.interp.globals.set(k, v);
  for (const [k, v] of save.strGlobals) session.interp.globals.set(k, v);
  /*
   * The frame counter, with the globals rather than after them, because several
   * of them are frame STAMPS and the game only ever reads a stamp as
   * `frame() - stamp`. Dust's own `attentionspan` is the clearest: it is how long
   * the character you are talking to has been waiting, and the five shipped saves
   * carry 0, 235, 591, 828 against frame counters of 167, 312, 705, 958. Left
   * counting from the browser tab's start instead of the saved game's, every one
   * of those intervals is already impossibly long the moment the save loads.
   */
  session.frameCounter = save.frame;
  /*
   * `lockevents` is NOT forced clear here, unlike the play page's load.
   *
   * There it always has to be: TAOOT's save lever is on a control panel that
   * freezes world input, so every `.ti` carries `lockevents=1` and a load that
   * honoured it would leave the player unable to walk. Dust's save lever is a
   * button on the inventory panel and sets nothing of the kind — the variable is
   * a scene script's, used by MAYROOM and NITE to hold the player still through a
   * scripted beat — so here it is genuine game state and the file's answer is the
   * right one. Said out loud when it is set, because a save taken mid-beat comes
   * back mid-beat and that is worth knowing from a log rather than from a stuck
   * arrow key.
   */
  if (session.interp.globals.get("lockevents")) {
    session.onLog("opengame: this save was taken with lockevents set — input stays locked until a script clears it");
  }

  // ---- drop what belonged to the screen being left ------------------------
  session.scheduler.reset();
  session.audio.halt("voice");
  session.puppetCtrl.closePuppetFile();
  session.endWipe();
  session.onAbandonMovie?.();
  // this file is the base the next save is patched into
  session.lastSave = save.raw;

  // The panel comes down and the room comes back. A save is taken from the menu
  // flat (`score`), so that is the flat a save was taken ON — and it is not the
  // flat a loaded game should arrive in.
  session.stageCtrl.resetOverlayStack();
  if (session.stageCtrl.stageFile) await session.stageCtrl.gotoFlat(PLAY_FLAT);
  session.setVisible = true;

  // ---- the rebuild, with the script runners muted -------------------------
  session.restoringSave = true;
  try {
    // the departing room is detached rather than closed: no `closeset` runs on a
    // load, in this engine or the original
    session.currentSetName = "none";
    session.currentSetFile = "";

    // the cast and prop FILES the save had open, by the names the manifest gives
    // them — a v1 list carries no extension of its own
    for (const file of save.castFiles) await session.openCastFile(file);
    for (const file of save.propFiles) await session.openShop(file);
    await restoreThemeV1(session, save);

    resetCast(session);
    restoreActors(
      session,
      save.actors.map((a) => asV4Actor(session, a)),
    );
    restoreProps(
      session,
      save.props.map((p) => asV4Prop(session, p)),
    );
    /*
     * ...and then the world positions, which `restoreProps` does not carry.
     *
     * A v4 prop record has no world coordinates at all — TAOOT's world props are
     * placed by the room's own `openset` — so the shared restore has nothing to
     * apply. Dust's record does have them, and its world props need them: the
     * shooting star is at (2784, 4864) at height 499 and no script puts it back
     * there on a load.
     */
    for (const sp of save.props) {
      if (!sp.is3d) continue;
      const p = session.propRuntime.get(sp.name);
      if (!p) continue;
      p.worldX = sp.x;
      p.worldY = sp.y;
      p.worldZ = sp.z;
    }

    // the scheduler table, mid-count: the idles that make the town act, the
    // scene's own timer, the star that crosses the sky
    for (const l of save.loops) session.scheduler.restoreLoop(l.kind, l.name, l.handler, l.period);

    /*
     * ...and the walkers, mid-stride.
     *
     * A character caught walking is caught in TWO tables, and restoring only one
     * of them is worse than restoring neither: the cast record gives them the
     * `walk` pose, and an actor steps through its walk animation whether or not a
     * walk is actually running — so Jones came back marching on the spot in the
     * middle of the street. (Reported after loading AFTERDOG, which has him 82%
     * of the way to `town.jones2`.)
     *
     * So each walk is resumed from where the save caught it, with only what was
     * left to run — and anyone whose walk CANNOT be resumed is stood up, which is
     * the other half of the same bug. The play page learned this one first (#181).
     */
    for (const w of save.walks) {
      const a = session.actorRuntime.get(w.actor);
      const resumed =
        !!a &&
        session.scheduler.restoreWalk(w.actor, {
          turnOnly: w.turnOnly,
          turnTo: w.turnTo >= 0 ? w.turnTo : undefined,
          sx: w.startX,
          sy: w.startY,
          sz: w.startZ,
          dx: w.dx,
          dy: w.dy,
          dz: w.dz,
          dist: w.dist,
          progress: w.progress,
          arriveStar: w.star || undefined,
        });
      if (resumed) {
        session.onLog(
          w.turnOnly
            ? `opengame: ${w.actor} was saved mid-turn — resuming it`
            : `opengame: ${w.actor} was saved walking to "${w.star}" ` +
              `(${w.progress} of ${w.dist})${w.hasPath ? " on an authored route, resumed as a straight line" : ""}`,
        );
        continue;
      }
      standUp(a ?? undefined);
      session.onLog(`opengame: ${w.actor} was saved mid-walk and could not be resumed — standing them up`);
    }

    // ---- the arrival ----------------------------------------------------
    const s = save.standpoint;
    /*
     * The room is the FILE the save had open, not the set it names.
     *
     * Dust's town exists twice — `town.set` by day, `nite.set` by night — and
     * both call themselves "town", so the name field cannot tell them apart.
     * All five shipped saves were taken at night and every one of them names
     * "town": trusting it opened the daylight town, with the day palette over a
     * night game. The manifest handle beside it says which file, which is
     * exactly how the original's own loader reopens the room.
     */
    const file = s.setFile || `${s.set}.set`;
    /*
     * The bytes, before anything asks the set a question.
     *
     * `sceneAtCell` reads the set's own grid to turn the saved cell into a scene
     * name, and it does that through `GameSession.loadSet`, which is SYNCHRONOUS:
     * it asks the provider for the file and gets null when the file has not been
     * fetched. In the browser that is the ordinary state of any room the player
     * has not been in yet — so on a FRESHLY BOOTED game the cell resolved to
     * nothing, the loader fell back to "open it at its own standpoint", and the
     * save came back in the right room at the wrong place. Reported from play, and
     * exactly as narrow as it sounds: load `D1E_002` after visiting the saloon and
     * the standpoint is right, load it as the first thing a boot does and it is
     * `sallower.set`'s own opening view (Scene D1) instead of the saved Scene C4.
     *
     * Invisible on disk, which is why no test had it: a headless provider answers
     * from the filesystem on the spot and `loadSet` always succeeds. The test that
     * covers it now models the browser's provider — nothing answers until it has
     * been fetched.
     */
    await session.ensureFile(file);
    const scene = sceneAtCell(session, file, s.cellX, s.cellZ);
    if (!scene) {
      session.onLog(
        `opengame: ${file} has no scene at cell (${s.cellX},${s.cellZ}) — opening it at its own standpoint`,
      );
    }
    await session.openSetFile(file, scene ?? "", scene ? s.view : "");
  } finally {
    session.restoringSave = false;
  }
  return true;
}

/**
 * Write the running game into a save.
 *
 * Null when there is nothing to patch — no file has been loaded this session and
 * no template was lent (see `dust-saves.ts`), which is the one case where saving
 * genuinely cannot produce a file. The caller logs it; the builtin says so.
 */
export function snapshotSaveV1(session: GameSession): Uint8Array | null {
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
    // the port's own bookkeeping is not game state (see the play page's snapshot)
    if (name.startsWith("__")) continue;
    if (typeof val === "number") numGlobals.set(name, val);
    else if (typeof val === "string") strGlobals.set(name, val);
  }

  // where the player is, in the file's own terms: the cell under the scene the
  // viewer is standing in, and the heading it looks along
  const setFile = session.currentSetFile ? `${session.currentSetFile}.set` : "";
  const cell = setFile ? cellOfScene(session, setFile, session.currentSceneName()) : null;
  const deg = Math.round(((session.currentRotation?.() ?? 0) * 128) / Math.PI) & 0xff;
  const standpoint = cell
    ? {
        set: session.currentSetFile,
        // the FILE as well as the name: a load reopens the room from the
        // manifest, so a save taken in another room has to say so there too
        setFile: setFile,
        cellX: cell.x,
        cellZ: cell.z,
        // the facing the set itself numbers this heading with, which the port
        // does not track separately — the heading is the authority and the
        // original's own second copy of the triple is written from it
        facing: FACING_OF_DEG[deg] ?? 1,
        deg,
        camX: cell.x * CELL_UNITS + CELL_MID,
        camY: cell.z * CELL_UNITS + CELL_MID,
      }
    : undefined;

  /**
   * What the room contributes to the file beyond its name: the two registers a
   * load re-acquires, and the palette it comes back in.
   *
   * Read off the set FILE rather than the live binding, because the binding is
   * the v1 set translated into the v4 shape and the translation reads the two
   * register tables directly instead of carrying their indices — so it zeroes
   * them (see set-v1-to-v4.ts). The bytes are in the store whenever the room is
   * open, which is whenever there is something to save.
   */
  const openSet = ((): SavePatchV1["openSet"] => {
    if (!setFile) return undefined;
    const raw = session.files(setFile.toLowerCase());
    if (!raw) {
      session.onLog(`savegame: ${setFile} is not in the store — its registers keep the base's`);
      return undefined;
    }
    try {
      if (detectVersion(raw) !== 1) return undefined;
      const set = readSetFileV1(raw);
      return {
        transitionRegister: set.transitionRegister,
        actorRegister: set.actorRegister,
        // the camera the original projects its cast through — per room, and a
        // hover on every restored character when left as the base room's
        eyeHeight: set.eyeHeight,
        cameraSetback: set.cameraSetback,
        clut: set.paletteRaw,
      };
    } catch (e) {
      session.onLog(`savegame: ${setFile}: ${(e as Error).message}`);
      return undefined;
    }
  })();

  const dropped: string[] = [];
  const bytes = applyPatchV1(base, {
    numGlobals,
    strGlobals,
    standpoint,
    openSet,
    frame: session.frameCounter,
    /*
     * ---- WHAT THE PORT KNOWS, AND ONLY THAT --------------------------------
     *
     * A patch field left `undefined` keeps the base save's value (every write in
     * `applyPatchV1` is guarded), and that is the whole design of this list.
     *
     * This port does not model everything a record holds, and where it does not,
     * its own default is not a decision — it is an absence. Writing those
     * absences over a real save is what a port save did to the original:
     * measured against the base it was patched from, 73 of 73 prop records and
     * 40 of 54 cast records came out worse —
     *
     *     avatar     scale 1000 -> 0        the panel portrait, at no size
     *     slider     screen (117,323) -> (256,192)   into the middle of the room
     *     inven day  view "base" -> ""     no state to pick a sprite from
     *     Jug        dist 148 -> 0
     *     Mwife      scale 1000 -> 0, speed 4 -> 0   (she loaded hovering)
     *     Help       set "town" -> "", star "walktostar" -> "", x 1732 -> 0
     *
     * So each field below is written only where the port has a positive value
     * for it: a scale it was given, an anchor a script placed (`screenPlaced`),
     * a name a script set, a world position for something actually in the world.
     * The rest is the base's, which is the only other thing it could truthfully
     * be.
     *
     * The map's KEY is the prop's name — a PropInstance does not carry it, the
     * same reason the play page's snapshot destructures the entry.
     */
    props: [...session.propRuntime.props].map(([name, p]) => ({
      name,
      owner: String(p.owner),
      visible: p.visible,
      is3d: p.worldSpace,
      deg: Number(p.deg) || 0,
      // a state the script chose, not the empty string this starts as
      view: p.stateName || undefined,
      set: p.setName || undefined,
      star: p.starName || undefined,
      // the port ignores `scale` for a screen prop, so 0 means "never told"
      scale: p.scale > 0 ? p.scale : undefined,
      // ...and 0 is this port's default where the original's is -1
      dist: p.dist !== 0 ? p.dist : undefined,
      // only a prop a script actually placed on the screen has an anchor to save
      screenX: p.screenPlaced ? p.anchorX : undefined,
      screenY: p.screenPlaced ? p.anchorY : undefined,
      // ...and only a prop in the world has a world position
      x: p.worldSpace ? p.worldX : undefined,
      y: p.worldSpace ? p.worldY : undefined,
      z: p.worldSpace ? p.worldZ : undefined,
    })),
    actors: [...session.actorRuntime.actors.values()].map((a) => {
      /**
       * Has this port SET THIS ACTOR UP? `stdactor` — the handler every cast
       * member's `setupactor` calls — is what gives an actor its scale, and
       * nothing else does. So a scale is the port's word for "I have placed and
       * dressed this character"; without one, its position, pace and turn rate
       * are construction defaults and the base's are worth more.
       */
      const dressed = a.scale > 0;
      return {
        name: a.member.name,
        owner: String(a.owner),
        visible: a.visible,
        // in the world at all: the original's draw gate reads this before
        // anything else, and a visible actor without it is drawn screen-anchored
        // at the top-left in every room (#319, #320). Asserted only where the
        // port has placed the character; an undressed one keeps the base's
        // sticky bit, which is what the original itself does.
        is3d: dressed || a.visible ? true : undefined,
        deg: a.deg & 0xff,
        set: a.setName || undefined,
        star: a.starName || undefined,
        pose: a.poseName || undefined,
        scale: dressed ? a.scale : undefined,
        speed: dressed ? a.speed : undefined,
        turn: dressed ? a.turn : undefined,
        x: dressed ? a.worldX : undefined,
        y: dressed ? a.worldY : undefined,
        z: dressed ? a.worldZ : undefined,
      };
    }),
    walks: [...session.scheduler.walks].map(([actor, w]) => ({
      actor,
      star: w.arriveStar ?? "",
      startX: w.sx,
      startY: w.sy,
      startZ: w.sz,
      dx: w.dx,
      dy: w.dy,
      dz: w.dz,
      dist: w.dist,
      progress: w.progress,
      turnTo: w.turnTo ?? -1,
      deg: session.actorRuntime.get(actor)?.deg ?? 0,
      turnOnly: !!w.turnOnly,
      hasPath: !!w.path,
    })),
    loops: session.scheduler.loops.map((l) => ({
      kind: l.kind,
      name: l.name,
      handler: l.handler,
      // the live countdown, mid-flight: the original dumps its service table
      // verbatim, so what the field holds is the ticks that are left
      period: l.count,
    })),
    onDrop: (name, why) => dropped.push(`${name} (${why})`),
  });
  if (!standpoint) {
    session.onLog("savegame: written, but the standpoint could not be placed on the set's grid");
  }
  if (dropped.length) {
    session.onLog(
      `savegame: written, but ${dropped.length} ` +
        `item${dropped.length === 1 ? "" : "s"} could not be carried — ${dropped.join(", ")}`,
    );
  }
  return bytes;
}

/**
 * Stop a character treadmilling: put them in the standing pose of whatever walk
 * pose they came back in.
 *
 * `walk` → `stand`, and a suffixed pose keeps its suffix (`walklj` → `standlj`)
 * if the cast member has one, because an actor plays its pose regardless of
 * whether anything is moving it.
 */
function standUp(a: { poseName: string; step: number; member: { poses: { name: string }[] } } | undefined): void {
  if (!a || !a.poseName.startsWith("walk")) return;
  const suffixed = `stand${a.poseName.slice(4)}`;
  a.poseName = a.member.poses.some((p) => p.name === suffixed) ? suffixed : "stand";
  a.step = 0;
}

/**
 * Which of the set's four facings a heading is.
 *
 * The jump table at DF.EXE `0x4340a8` gives the bearings {1: 192, 2: 64, 3: 0,
 * 4: 128}, so this is that table read backwards. A heading that is not one of the
 * four means the camera was caught mid-turn, and the caller falls back to facing
 * 1 — the file's facing field is the engine's own bookkeeping and the cell plus
 * the heading are what a load actually reads.
 */
const FACING_OF_DEG: Record<number, number> = { 192: 1, 64: 2, 0: 3, 128: 4 };
