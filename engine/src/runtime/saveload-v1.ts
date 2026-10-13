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
 *  - **what a record holds.** v1's cast record is four bytes longer than v4's,
 *    and its tail is DF.EXE's own (value, zclip, hitbox, the pose step — see
 *    df/savegame-v1.ts), so what the v4 shape has no room for is put back after
 *    it ({@link restoreActorExtras}).
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
import { readSetFileV1 } from "../df/set-v1";
import { detectVersion } from "../df/version";
import type { SavedActor, SavedProp } from "../df/savegame";
import type { GameSession } from "./session";
import type { PropInstance } from "./props";
import { resetCast, restoreActors, restoreProps, saveBase, scriptGlobals } from "./saveload";

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
 * Every field is the file's — `value` at +74 and `zclip` at +78 included, both
 * found at their builtins' handlers — and `scale` is load-bearing: a load resets
 * the cast first and a reset actor has scale 0, which the draw list skips. The
 * fields the v4 shape has no room for (the pose step, the hitbox, a screen
 * actor's layer and anchor) are put back by {@link restoreActorExtras}.
 */
function asV4Actor(_session: GameSession, a: SavedActorV1): SavedActor {
  return {
    name: a.name,
    owner: a.owner,
    // `actorvalue` is a number in the record (+74, DF.EXE 0x414933)
    value: a.value,
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
      zclip: a.zclip,
    },
  };
}

/** a v1 prop record in the shape `restoreProps` takes (see {@link asV4Actor}) */
function asV4Prop(_session: GameSession, p: SavedPropV1): SavedProp {
  return {
    name: p.name,
    view: p.view,
    owner: p.owner,
    set: p.set,
    star: p.star,
    visible: p.visible,
    is3d: p.is3d,
    // the screen anchor, which v4 keeps in the same two fields
    x: p.screenX,
    y: p.screenY,
    // the world position: x across and y into the screen are the ground pair
    worldX: p.x,
    worldY: p.y,
    worldZ: p.z,
    deg: p.deg,
    dist: p.dist,
    scale: p.scale,
    value: p.value,
    zclip: p.zclip,
  };
}

/**
 * Load a Dust save.
 *
 * False without side effects for a file that is not a save or is another
 * title's; true once the room has been rebuilt and entered.
 */
/**
 * The sound: the banks the save had open, the theme that was sounding out of one
 * of them, the effect that was, and every sound's script settings.
 *
 * Both halves are audible: load `D1E_002` in DUST.EXE and the saloon theme is
 * there at once, so a load that restored neither would leave the saloon silent.
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
 * The theme and effect words are handles into the open-file manifest, so they
 * name the FILE. Opening those first and then skipping any listed name the open
 * banks already answer to is what puts `D1E_001` back with exactly the two banks
 * it was saved with, `night.snd` and `unilib.snd`.
 *
 * ## The theme is channel 3, and it starts from the top
 *
 * +0xa00 is the theme channel's bank (see C0_THEME in df/savegame-v1.ts); the
 * two words after it are the EFFECT channel's, not the theme's. DF.EXE's loader
 * restarts the theme bank's loop list from its beginning (`0x41b2ec` →
 * `0x429fa0`), which is what the port's one concatenated loop does too
 * (AudioLibrary.theme). Its loudness is the chunks' own `themevol`, saved per
 * chunk record, and that is what the track is given back.
 *
 * ## The effect is replayed
 *
 * `0x41b1aa` hands the saved effect record to `0x42a070`, the play-by-priority
 * entry, while the bank's records are re-registered — so a sound caught
 * mid-play starts again from its beginning, and a sound flagged `soundloop`
 * (`D2M_004`'s hall clock, `largeclock`) loops again.
 *
 * ## Per-sound settings
 *
 * The loader reads `soundvol`, `soundpan` and `soundloop` back off every
 * one-shot record (`0x41b12d`–`0x41b190`), so a script that turned the
 * crickets down or flagged a sound to loop is not undone by a load.
 *
 * What is still missing: a bank with NO loop chunks cannot be a theme, and
 * `currenttheme (1)` — the chunk sounding NOW — cannot be answered by one
 * concatenated buffer. Neither is about loading.
 */
async function restoreThemeV1(session: GameSession, save: SaveGameV1): Promise<void> {
  session.audio.halt("theme");
  session.currentThemeName = "none";
  session.themeStarted(null);
  const theme = save.theme?.bank ?? null;
  const effect = save.effect;
  // the theme's and the effect's banks first: both are files
  const opened: string[] = [];
  for (const file of [theme, effect?.bank]) {
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

  // every one-shot's script settings, and each track's own loudness
  const trackVolume = new Map<string, number>();
  for (const s of save.sounds) {
    if (!s.name) continue;
    if (s.kind === "sound") {
      session.scheduler.setSoundVol(s.name, s.volume);
      session.scheduler.setSoundPan(s.name, s.pan);
      if (s.loop) session.scheduler.soundLoop(s.name, true);
    } else if (s.bank && !trackVolume.has(s.bank.toLowerCase())) {
      trackVolume.set(s.bank.toLowerCase(), s.volume);
    }
  }
  for (const [bank, v] of trackVolume) {
    const track = session.audioLib.trackNameOf(bank);
    if (track && bank !== theme?.toLowerCase()) session.setThemeVolume(v, track);
  }

  if (effect) {
    const name = save.sounds.find(
      (s) => s.kind === "sound" && s.record === effect.record && s.bank.toLowerCase() === effect.bank.toLowerCase(),
    )?.name;
    if (name) {
      session.scheduler.playSound(name, false);
      session.onLog(`opengame: sound "${name}" was playing — started again`);
    } else {
      session.onLog(`opengame: saved sound record ${effect.record} of ${effect.bank} is not a registered sound`);
    }
  }

  if (!theme) {
    session.onLog("opengame: this save was taken with no theme playing");
    return;
  }
  const music = session.audioLib.theme(theme);
  if (!music) {
    session.onLog(`opengame: saved theme bank "${theme}" has no loop to play — the room loads silent`);
    return;
  }
  session.audio.play("theme", music, { loop: true });
  // the name a script gets back from `currenttheme (2)` and hands to `playtheme`,
  // which is the bank's INSIDE name and not the file it came out of
  session.currentThemeName = session.audioLib.trackNameOf(theme) ?? theme;
  session.themeStarted(session.audioLib.bankOf(theme), music.samples.length / music.sampleRate);
  const saved = trackVolume.get(theme.toLowerCase());
  session.setThemeVolume(
    saved ?? session.volumeForTrack(session.currentThemeName) ?? toNum(session.interp.globals.get("themevolume") ?? 255),
    session.currentThemeName,
  );
  session.onLog(`opengame: theme "${session.currentThemeName}" resumed from ${theme}`);
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

  /*
   * The point of no return, and the first thing past it: stop the scripts the
   * abandoned game was running (#344).
   *
   * A suspended script is suspended INSIDE a builtin, and the teardown below
   * releases exactly those — `scheduler.reset()`, `puppetCtrl.closePuppetFile()`,
   * `endWipe()`, `onAbandonMovie`. Released and not stopped, a script runs its
   * next statement in a game that no longer exists, reading the globals the load
   * has just replaced. On the Titanic side that shows as the ending's
   * straight-line script resuming at the next film after a checkpoint load and
   * reaching its `if mission = "good"` branch holding the checkpoint's mission,
   * so the good ending finishes on the bad ending's restart screen.
   *
   * Before the teardown, not after, so nothing is ever woken into the gap. The
   * epoch machinery is `Interpreter.abandonRunning()` — every `Frame` carries the
   * epoch it was made in and `execBlock` checks it before each statement, so a
   * frame from the previous game unwinds at its next statement and its dispatch
   * promise resolves. Frames made after the bump carry the new epoch and are
   * untouched, which is why the load's own scripts are not affected.
   *
   * Dust's lever is a button on the inventory panel rather than TAOOT's control
   * panel, so the caller's tail is worth reading before assuming the abandon is
   * free. There are two, both `mousedown` in `NEW.FLT`, and the abandon reaches
   * both of them — they are frames of the epoch it just closed.
   *
   *     0034:  opengame ("dust 0.3")                                  <- nothing after
   *     0025:  opengame ("dust 0.3")
   *            if currentflat () = "score"
   *                makeloop ("flat", currentflat (), "update", 10)
   *            endif
   *
   * 0025's tail is a no-op on the path that reaches it: a load that got this far
   * has already run `gotoFlat(PLAY_FLAT)` below, so `currentflat ()` is the play
   * flat and the `if` is false. Skipping it and running it come to the same
   * thing. A load that FAILS never gets here — the parse and title checks return
   * above this line — so a failed load still hands its caller back intact.
   */
  session.interp.abandonRunning();
  session.cursorDepth = 0;

  // ---- the state that is not in a room ------------------------------------
  /*
   * Drop what the file is silent about, before restoring what it carries (#344).
   *
   * The variable records are not a patch over the live session, they are the
   * engine's WHOLE variable list, written out and read back wholesale —
   * `df/savegame-v1.ts` shares `save-vars.ts` with v4, "the variable list both
   * versions share". A global with no record did not exist when the game was
   * saved, and after `opengame` it should not exist either. Normally a room
   * cleans up after itself with `dumpglobal` from a teardown, but a load runs no
   * scripts, so nothing is dumped and the abandoned game's value stands under a
   * file that never mentioned it.
   *
   * Measured over the 56 shipped `.RTD`s: 170 distinct globals between them, 79
   * carried by some and not others — the blackjack and poker tables, the fight,
   * the flute puzzle, `borrowgun`, `blackout`, `juglevel`, `bottles`. Loading a
   * save from before a puzzle was touched left that puzzle's live state standing
   * underneath it.
   *
   * The sharper edge is the frame stamps. `session.frameCounter` is set from the
   * file below, and the game reads a stamp only as `frame() - stamp`; shipped
   * counters span 4885 to 261166, so a stamp that survives a load while the
   * counter rewinds under it goes negative and stays there. Dust's own
   * `attentionspan` is carried by all 56 and is safe by luck — the same luck
   * Titanic's `jonesframe` does not have, 8 of 109 (#340).
   *
   * Deleted rather than zeroed: a `global` declaration recreates a missing name
   * at 0, which is what the original hands a script reading a variable its
   * restored list has no node for. `__` names are the port's own bookkeeping and
   * not the file's to speak for — `snapshotSaveV1` skips the same prefix writing.
   *
   * This is safe only because the writer is honest about capacity. Dust's bases
   * are small, and a writer that dropped what would not fit would leave a file
   * silent about a global that DID exist — 164 of them over the playthrough,
   * `handitem` among them — and deleting on top of that would turn every one
   * into lost state. `dust/tests/saves.ts`'s round trip holds the writer to it
   * (#357).
   */
  for (const name of session.interp.globals.keys()) {
    if (name.startsWith("__")) continue;
    if (save.numGlobals.has(name) || save.strGlobals.has(name)) continue;
    session.interp.globals.delete(name);
  }
  for (const [k, v] of save.numGlobals) session.interp.globals.set(k, v);
  for (const [k, v] of save.strGlobals) session.interp.globals.set(k, v);
  /*
   * The frame counter, with the globals rather than after them, because several
   * of them are frame STAMPS and the game only ever reads a stamp as
   * `frame() - stamp`. Dust's own `attentionspan` is the clearest: it is how long
   * the character you are talking to has been waiting, and the shipped saves carry
   * a stamp of 1235 against frame counters of 4885, 13307 and 13745 — one moment,
   * read from three later ones. Left counting from the browser tab's start instead
   * of the saved game's, every one of those intervals is already impossibly long
   * the moment the save loads.
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
    // world positions included: the shooting star is at (2784, 4864) at
    // height 499 and no script puts it back there on a load
    restoreProps(
      session,
      save.props.map((p) => asV4Prop(session, p)),
    );
    restoreActorExtras(session, save);
    restorePropSteps(session, save);

    // the scheduler table, mid-count: the idles that make the town act, the
    // scene's own timer, the star that crosses the sky
    for (const l of save.loops) {
      session.scheduler.restoreLoop(l.kind, l.name, l.handler, l.period);
      // `pauseloop` held it: the record keeps a depth (+2), the port a flag
      const restored = session.scheduler.loops.at(-1);
      if (l.paused && restored?.handler && restored.name === l.name.toLowerCase()) restored.paused = true;
    }

    // the balls in flight, slot for slot (the table at 0x45fbd0 is positional)
    for (const b of save.balls) {
      if (!b.active || b.slot >= session.balls.slots.length) continue;
      session.balls.slots[b.slot] = {
        name: b.name,
        pause: b.pause,
        vx: b.vx,
        vy: b.vy,
        vz: b.vz,
        gravity: b.gravity,
        bounce: b.bounce,
        frames: b.frames,
        deg: b.deg,
        x: b.x,
        y: b.y,
        z: b.z,
        tx: b.tx,
        ty: b.ty,
      };
    }

    /*
     * ...and the walkers, mid-stride.
     *
     * A character caught walking is caught in TWO tables, and restoring only one
     * of them is worse than restoring neither: the cast record gives them the
     * `walk` pose, and an actor steps through its walk animation whether or not a
     * walk is actually running — so Jones would come back marching on the spot
     * in the middle of the street. (AFTERDOG has him 82% of the way to
     * `town.jones2`.)
     *
     * So each walk is resumed from where the save caught it, with only what was
     * left to run — and anyone whose walk CANNOT be resumed is stood up, which is
     * the other half of the same rule, and the one the play page follows (#181).
     */
    const waiting = save.walks.filter((w) => w.waiting && !w.turnOnly);
    for (const w of save.walks) {
      if (waiting.includes(w)) continue;
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
          paused: w.paused,
          path: w.path,
        });
      if (resumed) {
        const route = w.path ? ` on an authored route of ${w.path.length} points` : "";
        session.onLog(
          w.turnOnly
            ? `opengame: ${w.actor} was saved mid-turn — resuming it`
            : `opengame: ${w.actor} was saved walking to "${w.star}" (${w.progress} of ${w.dist})${route}`,
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
     * The shipped saves demonstrate it both ways: twelve of them name "town"
     * and hold `nite.set`, ten name "town" and hold `town.set`. Trusting the
     * name opened the daylight town over a night game. The manifest handle
     * beside it says which file, which is exactly how the original's own loader
     * reopens the room.
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

    /*
     * The walks that were WAITING (their walker not in the open set, +44 = 0)
     * come back waiting: DF.EXE's walk service moves nothing until the walker's
     * set is the open one and the star is in it, then puts the actor there and
     * ends the walk (0x4396f5; see the scheduler's `waiting`). The first pass
     * does that for a walker already at home — the `endwalk` three playthrough
     * rungs wait on — and one in another room waits for its room, where this
     * used to fetch the star from any set's table and place them at once.
     */
    for (const w of waiting) {
      const a = session.actorRuntime.get(w.actor);
      const kept =
        !!a &&
        session.scheduler.restoreWalk(w.actor, {
          sx: a.worldX,
          sy: a.worldY,
          sz: a.worldZ,
          dx: 0,
          dy: 0,
          dz: 0,
          dist: 1,
          progress: 0,
          arriveStar: w.star || undefined,
          paused: w.paused,
          waiting: true,
        });
      if (kept) {
        session.onLog(`opengame: ${w.actor} is waiting to arrive at "${w.star}"`);
        continue;
      }
      standUp(a ?? undefined);
      session.onLog(`opengame: ${w.actor} was waiting for "${w.star}" and is not in the cast — standing them up`);
    }

    // the script settings the standpoint block carries (C1_PUPPET_GRAB in
    // df/savegame-v1.ts): set after the room opens, because DF.EXE's own
    // opensetfile resets two of them and its loader never runs that
    session.puppetGrab = s.puppetGrab;
    session.frameRate = s.frameInterval;
    session.balls.playerHitbox = [s.playerHitbox[0], s.playerHitbox[1]];
    session.setVisible = s.setVisible;
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
  const base = saveBase(session);
  if (!base) return null;

  const { numGlobals, strGlobals } = scriptGlobals(session);

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
      // `propvalue` and `propzclip` (+72, +76): numbers in the record, so a
      // string value is the base's to keep
      value: typeof p.value === "number" ? p.value : undefined,
      zclip: p.zclip,
      step: propStep(p),
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
        value: typeof a.value === "number" ? a.value : undefined,
        zclip: dressed ? a.zclip : undefined,
        hitbox: [a.hitbox[0], a.hitbox[1]] as [number, number],
        step: dressed ? a.step : undefined,
        // a screen actor's layer and anchor; a world actor's +42 is a draw cache
        dist: dressed && !a.worldSpace ? a.dist : undefined,
        anchorX: dressed && !a.worldSpace ? a.anchorX : undefined,
        anchorY: dressed && !a.worldSpace ? a.anchorY : undefined,
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
      paused: w.paused,
      hasPath: !!w.path,
      path: w.path,
      waiting: w.waiting,
    })),
    balls: session.balls.slots.flatMap((b, slot) =>
      b
        ? [
            {
              slot,
              name: b.name,
              pause: b.pause,
              vx: b.vx,
              vy: b.vy,
              vz: b.vz,
              gravity: b.gravity,
              bounce: b.bounce,
              frames: b.frames,
              deg: Number(b.deg) || 0,
              x: b.x,
              y: b.y,
              z: b.z,
              tx: b.tx,
              ty: b.ty,
            },
          ]
        : [],
    ),
    settings: {
      puppetGrab: session.puppetGrab,
      frameInterval: session.frameRate,
      setVisible: session.setVisible,
      playerHitbox: [session.balls.playerHitbox[0], session.balls.playerHitbox[1]],
    },
    loops: session.scheduler.loops.map((l) => ({
      kind: l.kind,
      name: l.name,
      handler: l.handler,
      // the live countdown, mid-flight: the original dumps its service table
      // verbatim, so what the field holds is the ticks that are left
      period: l.count,
      paused: l.paused,
    })),
    ...soundPatch(session),
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
 * What a v1 cast record holds beyond the v4 shape `restoreActors` takes: the
 * step within the pose (+38), the ball hitbox (+80/+82, `actorhitbox`), and for
 * a SCREEN actor its layer (+42, `actordist`) and anchor (+20/+22). A world
 * actor's +42 is only its last projected depth, which the next draw makes again.
 */
function restoreActorExtras(session: GameSession, save: SaveGameV1): void {
  for (const sa of save.actors) {
    const a = session.actorRuntime.get(sa.name);
    if (!a) continue;
    a.step = Math.max(0, sa.step);
    a.hitbox = [sa.hitbox[0], sa.hitbox[1]];
    if (!sa.is3d) {
      a.dist = sa.dist;
      a.anchorX = sa.anchorX;
      a.anchorY = sa.anchorY;
    }
  }
}

/**
 * Where in its view each prop's animation stood — the record's +36.
 *
 * DF.EXE's prop draw (0x41eab0) reads the step at +0x24, shows the play list's
 * entry there (`[view + 0x2e + step·2] − 1`, 0x41eb4f), and stores step + 1
 * back, wrapped to 0 at the view's step count (+0x70, 0x41eb67). So the saved
 * step is the one the NEXT draw shows, and `propview` (0x41c13a) zeroes it.
 *
 * The port's `frameIdx` is the step on the screen NOW, an index into the same
 * play list (PropInstance.frameOrder, the view's +0x2e table). So a saved step
 * s > 0 is `frameIdx` s − 1, and the animation goes on from there; 0 is the top
 * of the view, which is where restoreProps has already put it. A held selector
 * (frameLocked) shows a degree, not a step, and is left alone. A step at the
 * end of the view comes round to 0 next, as PropRuntime.tick wraps it.
 */
function restorePropSteps(session: GameSession, save: SaveGameV1): void {
  for (const sp of save.props) {
    const p = session.propRuntime.get(sp.name);
    if (!p || p.frameLocked || sp.step <= 0) continue;
    const st = p.state();
    const n = st ? p.frameCount(st) : 0;
    if (n <= 1) continue;
    p.frameIdx = Math.min(sp.step - 1, n - 1);
    // and on round from there, the last step included: the view wraps
    p.animating = true;
  }
}

/** the step a prop's next draw shows, as DF.EXE keeps it at +36 — see {@link restorePropSteps} */
function propStep(p: PropInstance): number | undefined {
  if (p.frameLocked) return undefined;
  const st = p.state();
  const n = st ? p.frameCount(st) : 0;
  return n > 1 ? (p.frameIdx + 1) % n : 0;
}

/**
 * The sound, the way DF.EXE's writer asks for it (see C0_THEME in
 * df/savegame-v1.ts): the theme channel's bank, the effect channel's sound, and
 * every open one-shot's `soundvol` / `soundpan` / `soundloop` and each open
 * track's `themevol`.
 *
 * When both effect channels are busy, DF.EXE's writer (0x429e10) saves the one
 * whose sound has the greater priority, channel 2 on a tie (`cmp [0x45e229],
 * [0x45e291]` / `jle` at 0x429e5d). The priority is the dword at +0x39 of the
 * sound record the channel copied (0x42a0d2), and nothing but the bank opener
 * writes it: each record starts with its 1-based record number in the bank
 * (0x429aff, from 0x406e7f), and every `opentrackfile` renumbers all of them
 * as `bank index << 16 | record number` (0x407e50, called at 0x406d45). So a
 * sound from a bank opened later wins, and within a bank the later record —
 * which the port reads off the open-bank order and the bank's own name table.
 */
function soundPatch(session: GameSession): Pick<SavePatchV1, "theme" | "effect" | "sounds"> {
  const lib = session.audioLib;
  const theme = session.currentThemeName !== "none" ? lib.bankOf(session.currentThemeName) : null;
  const bankOfSound = (name: string): string | null =>
    lib.bankNames.find((b) => lib.soundNames(b).includes(name.toLowerCase())) ?? null;
  const busy: { bank: string; name: string; priority: number }[] = [];
  for (const channel of [1, 2]) {
    const name = session.scheduler.currentSound(channel);
    const bank = name !== "none" ? bankOfSound(name) : null;
    if (!bank) continue;
    const record = lib.soundRecordV1(bank, name);
    busy.push({ bank, name, priority: lib.bankNames.indexOf(bank) * 0x10000 + record });
  }
  // channel 1 only if it outranks channel 2 outright (0x429e6a)
  let pick = busy[0];
  if (busy.length === 2 && busy[0].priority <= busy[1].priority) pick = busy[1];
  const effect: SavePatchV1["effect"] = pick ? { bank: pick.bank, name: pick.name } : null;
  const sounds: NonNullable<SavePatchV1["sounds"]> = [];
  for (const bank of lib.bankNames) {
    for (const name of lib.soundNames(bank)) {
      sounds.push({
        bank,
        kind: "sound",
        name,
        volume: session.scheduler.getSoundVol(name),
        pan: session.scheduler.getSoundPan(name),
        loop: session.scheduler.loopFlags.has(name),
      });
    }
    const track = lib.trackNameOf(bank);
    const volume = track ? session.volumeForTrack(track) : undefined;
    if (volume !== undefined) sounds.push({ bank, kind: "chunk", name: "", volume, pan: 128, loop: false });
  }
  return { theme, effect, sounds };
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
  if (!a?.poseName.startsWith("walk")) return;
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
