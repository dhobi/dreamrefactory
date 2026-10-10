import { RawSaveFile } from "../df/savegame";
import { Actor, StarPathPoint } from "../df/set";
import { sniffScript } from "../df/script";
import { DEFAULT_ENCODING, DfEncoding } from "../df/text";
import { parseScript } from "./parser";
import { Frame, Interpreter, ScriptInstance, Value } from "./interp";
import { ActorRuntime } from "./actors";
import type { WorldCamera } from "./geometry";
import { PropRuntime, type PropInstance } from "./props";
import { PluginBus } from "./plugins";
import { seededRng } from "./rng";
import { AudioLibrary, AudioSink, TimedAudio } from "./audio";
import { Clock, ENGINE_STEP_MS, passDue, ticksAt } from "./clock";
import { EventQueue } from "./input";
import { Scheduler } from "./scheduler";
import { PuppetController } from "./puppet";
import { StageController } from "./stage";
import { SessionEvents } from "./session-events";
import { SessionResources } from "./session-resources";
import { SessionBoot } from "./session-boot";
import { SessionCaptions } from "./session-captions";
import { SessionTime } from "./session-time";
import { SessionTransitions } from "./session-transitions";
import { FileProvider } from "./setscripts";
import { loadGame, snapshotSave } from "./saveload";
import { loadGameV1, snapshotSaveV1 } from "./saveload-v1";
import { loadGameV5, snapshotSaveV5 } from "./saveload-v5";
import { packPoint } from "./point";
import { registerGameBuiltins } from "./builtins";
import { PHOTO_H, PHOTO_W, Photo, PhotoAlbum } from "./photos";

/** how a move lands on a standpoint — see {@link GameSession.pictureMode} */
export type PictureMode = "original" | "sharp" | "transition" | "soft";

/** the four, in the order the play page offers them */
export const PICTURE_MODES: PictureMode[] = ["original", "sharp", "transition", "soft"];

export const isPictureMode = (s: unknown): s is PictureMode =>
  typeof s === "string" && (PICTURE_MODES as string[]).includes(s);

/** how fast a move the PLAYER asked for animates — see {@link MOVE_SPEED_MS} */
export type MoveSpeed = "slow" | "original" | "fast" | "instant";

/**
 * The four, in the order the play page offers them, and what each one costs a
 * frame (#222).
 *
 * The original has this knob itself and calls it `framerate`: the frame throttle
 * (`0x43a940`) waits `[0x489efe]` ticks of 50/3 ms between frames, `framerate(n)`
 * writes that word clamped to 0..60, and its shipped value is **3** — the 50 ms
 * that `original` is and that {@link ENGINE_STEP_MS} names. So three of these
 * four are values TI.EXE could have been given: 6 ticks is `slow`, 3 is
 * `original`, and 0 is `framerate(0)`, which the original documents as "don't
 * wait" — `instant` is that, not an invention of the port's. `fast` at 25 ms is
 * the one that is ours: it is 1.5 ticks, a rate the original had no way to ask
 * for (2 ticks is 33 ms, 1 is 17), and it is here because the request named it.
 *
 * Not `session.frameRate`, which is the same number for the script side and is
 * deliberately a different one: scripts WRITE it (the fight stage asks for 5,
 * the turbine drag loops drop it and put it back), and a player's preference is
 * not something a script may overwrite on the way past.
 *
 * Scripted camera moves are not paced by any of this — they stay at the engine
 * step, because the scripts budget passes for them and a slow player would break
 * that arithmetic. See `SetViewer.navigate`.
 */
export const MOVE_SPEED_MS: Record<MoveSpeed, number> = {
  slow: 2 * ENGINE_STEP_MS,
  original: ENGINE_STEP_MS,
  fast: ENGINE_STEP_MS / 2,
  instant: 0,
};

/** the four, in the order the play page offers them */
export const MOVE_SPEEDS: MoveSpeed[] = ["slow", "original", "fast", "instant"];

export const isMoveSpeed = (s: unknown): s is MoveSpeed =>
  typeof s === "string" && (MOVE_SPEEDS as string[]).includes(s);

/**
 * Game-wide state that outlives individual sets: one interpreter (globals
 * persist across rooms), the boot script (the loaded title's standard library —
 * TAOOT's is ~65 helpers: changeset, progress, spotmovie, ...), the master
 * stage script (TAOOT: MAIN.STG — gotospecial etc.), audio banks and props.
 *
 * Set switching bottoms out here: the boot library's `changeset` calls the
 * engine primitives `opensetfile(name, scene, view)` / `closesetfile()`, which
 * are builtins registered by the host (SetScripts wires them to onSetChange).
 */
/**
 * One authored route between two stars, resolved — see
 * {@link GameSession.starPathRegistry}. Names are lowercased; the points are in
 * the record's own `a` -> `b` order, as the SET stores them.
 */
export interface StarRoute {
  a: string;
  b: string;
  points: StarPathPoint[];
}

/** one caption: what is said, and by whom when that is known (#50) */
export interface CaptionLine {
  who?: string;
  text: string;
}

/** a caption for a stretch of a looping theme, in seconds from the loop's start */
export interface TimedCaption extends CaptionLine {
  from: number;
  to: number;
}

export class GameSession {
  readonly interp = new Interpreter();
  readonly audioLib = new AudioLibrary();
  readonly propRuntime = new PropRuntime();
  readonly actorRuntime = new ActorRuntime();
  /**
   * Every star of every set that has been opened, by its own qualified name.
   *
   * A star is named for the set it belongs to — `town.help`, `maydine.cage` —
   * and `walktostar` is handed one of those names by scripts that are not
   * standing in that set. Looking only in the OPEN set answers "not found", and
   * the cost is silent and permanent: `moveactor` is
   *
   *     stopwalk (me) / stoploop ("actor", me) / walktostar (me, where)
   *
   * so a failed lookup leaves the character with no walk AND no idle loop, and
   * nothing ever re-arms them. Dust's Mayor paces `town.mwife1` →
   * `town.marie1` → `town.help` all afternoon; step into a building while he is
   * mid-stride and his arrival fires `endwalk` → `mayoridle` → `moveactor`
   * against whatever room YOU are in, and he is frozen for the rest of the day.
   *
   * The shipped saves settle it rather than any reasoning about the original's
   * memory layout: `D2A_003` is taken inside `undertak.set` and its walk table
   * holds a walk whose destination is **`town.help`**. DF.EXE resolved a star of
   * a set that was not open, so the port has to be able to as well.
   *
   * Accumulated as sets are bound (see the viewer's `settleStars` call), which
   * means a star is findable exactly once its set has been visited — and the
   * town is always visited before anybody walks about in it.
   */
  readonly starRegistry = new Map<string, Actor>();
  /**
   * The AUTHORED ROUTES of every set that has been bound, resolved to their
   * points — the route half of {@link starRegistry}, and it exists for the same
   * reason: the script that starts a walk is frequently not running in the room
   * the walk happens in.
   *
   * Dust's Mayor's Wife is the case that shows it (#394). Her street patrol is
   * started from INSIDE THE SALOON — `SALLOWER.SET`'s `keydown` on the door runs
   * `sendtoactor ("mwife", setupactor ("street"))`, whose body ends in
   * `moveactor ("town.mwife2")`, and only afterwards does `gototown` change the
   * set. The star resolves (that is what {@link starRegistry} is for), but a
   * ROUTE lookup that asked the open set would ask the saloon, so she would set
   * off in a straight line and walk through the buildings. The disc's own saves say
   * that is not what DF.EXE did: `D1E_005` and `D1E_006` are taken during this
   * very patrol and both carry `hasPath` with the star sentinel `walkonpath`.
   *
   * Points rather than the SET: a Dust set is tens of megabytes of scenery and
   * holding one per room visited to keep twelve polylines would be a memory leak
   * with a route table in it.
   *
   * Keyed `a|b` in the record's own order; a lookup tries both ends, exactly as
   * the open set's table is searched.
   */
  readonly starPathRegistry = new Map<string, StarRoute>();
  /**
   * What the native plugin bus is holding — Timelapse's `plugin`/`pluginfx`
   * (engine/src/runtime/plugins.ts). Empty for Titanic and Dust, which name no
   * plugin between them.
   */
  readonly plugins = new PluginBus();

  /**
   * BOOTFILE script containers, in order. Container 1 holds the startup +
   * key-routing script, container 2 the standard library AND the default
   * event handlers (its keydown implements walking/turning via the
   * currentscene() setter). They stay separate: events traverse them in
   * order, and both are unqualified-call fallbacks.
   */
  bootScripts: ScriptInstance[] = [];
  stageScript: ScriptInstance | null = null;

  /**
   * Mutes the sendtostage→boot fallback (see sendEvent). Set by the host's
   * coldBoot around `runGlobal("boot")` so the boot()'s own closing
   * `sendtostage(...)` (TAOOT: `advanceday()`) stays inert and coldBoot performs
   * the day-advance itself, on the right state.
   */
  suppressStageBootFallback = false;

  /**
   * A LOAD is in flight, so the arriving room must not fire its scene-entry event.
   *
   * A load is not an arrival, and in the original it is not even a script. Traced:
   * `openscene` is dispatched from exactly one site (`0x407ea0`, which builds
   * `sendtoscene("SceneNN", openscene())`); that site has exactly one caller
   * (`0x4076d4`, inside `opensetfile`); and `opensetfile`'s implementation
   * (`0x407590`) has exactly one caller — its own command stub, `0x43cad6`. So
   * only a SCRIPT calling `opensetfile` can fire it. The load never does:
   * `ctl.stg`'s button is `opengame ("Titanic 1.0")` and nothing after it but a
   * stage check, and `opengame`'s restore (`0x414080`) rebuilds the room through
   * the engine's own set machinery without ever reaching the script runners. So
   * the original puts the room back from the FILE where we put it back by
   * re-running the room, and the save format is shaped for its way: a prop record
   * carries `view` and `visible` beside its owner, an actor record carries
   * visibility, facing, position, speed and zclip.
   *
   * Arriving by running the game's `changeset` would fire both events — and the
   * scene half is a trigger. LOUNGE1C Scene45's is
   *
   *     if mission = 4 & actorvisible ("zeit") & currentview () = "view49"
   *         sendtoactor ("zeit", mousedown (0))
   *
   * and `openset` would just have made Zeitel visible, so loading the shipped
   * save taken in front of him would open the conversation inside the load (#125).
   *
   * This flag mutes the WHOLE set lifecycle (SetScripts.fireLifecycle):
   * closeset, openset, openscene, closescene. The load restores from the file
   * what those scripts would produce — the cast (with `actorscale` from the
   * record), every prop's visible/view/anchor/deg/dist, the loop and cricket
   * tables, the playing theme — the script-free restore of #143. The scene is
   * still recorded as current, so the first turn or step re-fires `openscene`
   * normally, matching the original (moving off the spot and back still fires
   * it there, #125).
   */
  restoringSave = false;
  /**
   * {@link restoringSave} on a DreamFactory 5 game, where it mutes EVERY script.
   *
   * RedJack.exe's resume (0x43dd80) reopens the casts, shops, tracks, the room
   * and the stage and reaches no script runner at all, so no `opencast`,
   * `openactor`, `openshop`, `openprop`, `openstage`, `openflat`, `openset` or
   * `openscene` runs on a load (docs/engine/formats/savegame-v5.md). The v4
   * and v1 loads mute only the room's lifecycle, as they always have.
   */
  get restoringV5(): boolean {
    return this.restoringSave && this.isV5;
  }

  get boot(): ScriptInstance | null {
    return this.bootScripts[0] ?? null;
  }
  private setNameNow = "none";
  get currentSetName(): string {
    return this.setNameNow;
  }
  /**
   * Setting it silences any ambience belonging to the set being left, at once.
   *
   * A `soundloop`-flagged cricket loops in place forever, and a title's scripts
   * may only ever bulk-stop crickets in one place (TAOOT: only `initall` calls
   * `stopcricket("all")`), so any other way out of a set would leave the
   * ambience sounding — TAOOT's `advanceday` endgame arm (`closesetfile()` and
   * straight into the flats) would leave the boat deck's five crowd loops talking under
   * leave.mov and the whole closing narration. The scheduler silences them on its
   * next service pass, but that is not soon enough here: the endgame arm goes into
   * `playmovie` in the same script, game time stops for the movie, and the crowd
   * would still be audible half a second in (measured — taoot/tests/browser/endgame.ts's
   * `sounding=[party1,party2,party4]` on the first sample after the deck closed).
   * Hanging it on the name means every path out of a set is covered by
   * construction, rather than each one having to remember.
   */
  set currentSetName(name: string) {
    if (name === this.setNameNow) return;
    this.setNameNow = name;
    // optional: this setter is declared above the `scheduler` field, so a set
    // name assigned during construction would arrive before it exists
    this.scheduler?.silenceAbsentCrickets();
  }
  /**
   * Vertical world→screen projection bias set by the `camerahi` script command
   * (TI.EXE global 0x48a792, subtracted from a point's height in fn 0x43a970:
   * `dyHeight = ptY - camHeight - camerahi`). A title sets it per set from its
   * boot library (TAOOT: `adjustcamera()`, run from `openset` — nonzero ONLY for
   * the A-deck halls: halla 139, hallc 80, halld 150). Without it those halls'
   * world sprites (Sasha/Alex) float above the floor; every other set already
   * grounds because the bias is 0. Applied as `cam.z + cameraHiBias` in the
   * viewer's camera builder (raising the eye drops the feet on screen).
   */
  cameraHiBias = 0;
  /** the active set's script binding (SetScripts) — set by its constructor */
  currentBinding: import("./setscripts").SetScripts | null = null;
  /**
   * The open DreamFactory 5 room, when there is one — RedJack's `.sett` is not a
   * SET and has no {@link currentBinding}; its nodes, quads and camera are
   * here (engine/src/runtime/maze.ts).
   */
  maze: import("./maze").MazeRuntime | null = null;
  builtinsRegistered = false;

  onLog: (line: string) => void = () => {};
  /**
   * host UI hooks for the dialog builtins (notedialog/questiondialog/textdialog)
   * and quit(). The browser wires real alert/confirm/prompt; the headless
   * defaults are safe and non-blocking — note logs, a question answers "no" (so
   * e.g. a quit prompt cancels), a text prompt returns its supplied default, and
   * quit is inert.
   */
  onNoteDialog: (message: string) => void | Promise<void> = (m) => this.onLog(`note: ${m}`);
  onQuestionDialog: (message: string) => boolean | Promise<boolean> = () => false;
  onTextDialog: (prompt: string, initial: string) => string | Promise<string> = (_p, initial) =>
    initial;
  onQuit: () => void | Promise<void> = () => this.onLog("quit()");
  /**
   * host hook: make a game file available before the (synchronous) provider
   * reads it — the browser fetches on demand and returns null on the first
   * miss, so on-demand loaders (puppets, casts, movies) await this first.
   * No-op in tests, where every file is present synchronously.
   */
  ensureFile: (name: string) => Promise<void> = () => Promise.resolve();
  /**
   * host hook: the game swapped CDs. A multi-disc title's `setpath(disk)` writes
   * a volume name into the resource search path at each story transition
   * (TAOOT: `titanic<N>:`, with 93 basenames shipping on both discs — the public
   * rooms, once per act; RedJack: `RJDisk<N>:`, one per day, whose three discs
   * each carry their own `death.move`), so the host's file lookup has to follow
   * which one is mounted. 1-based.
   */
  onDiscChange: ((disc: number) => void) | null = null;

  /**
   * Host hook: a hotspot's `mousedown` chain has run to completion.
   *
   * The moment a click on a painting has been ANSWERED — the object script, the
   * scene, the set main and the stage have all had their turn, and whatever the
   * handler did (a sound, a puppet, a prop stood up, a set change) is done,
   * because {@link SetScripts.fireChain} awaits each one.
   *
   * It exists because "did the game do anything about that click?" cannot be
   * answered from the outside by watching. A page that listens for `pointerdown`
   * is ahead of the dispatch on a touch screen, where a finger is ambiguous
   * until it moves and TouchGestures holds the press back for
   * {@link TAP_HOLD_MS} — so it reads "nothing happened" from a click that is
   * about to happen, and a swipe that merely STARTED on a hotspot looks like a
   * click on one. Polling `scriptBusy` has the same fault from the other end: a
   * handler can begin and finish between two animation frames.
   *
   * Fires for `mousedown` only, and for both ways one is delivered — the pointer
   * and BOOTFILE's SPACE key, which routes through `sendtopainting` to the same
   * chain.
   */
  onHotspotClick:
    | ((hit: {
        /** the hotspot's own name, as `indextopainting` reports it */
        paint: string;
        set: string;
        scene: string;
        view: string;
        /** whether a handler answered it, rather than passing it along */
        consumed: boolean;
      }) => void)
    | null = null;

  /**
   * Host hook: a key delivered to the open set has been answered.
   *
   * The same seam {@link onHotspotClick} is, for the other half of how a room is
   * used. Fires once the boot's `keydown` router and everything it re-routed to
   * have run, with the room and standpoint the press was made at and whether a
   * handler took it.
   *
   * `consumed` does not mean the press did something: a handler that refuses a
   * step consumes it just as firmly as one that takes it, which is the whole
   * shape of a guard like TAOOT's
   * `if currentview () = "view12" & arg = "uparrow" & (tour | mission < 4) →
   * exitcode`. What it means is that the set answered, and a host that wants to
   * know whether anything MOVED should compare the room before and after.
   */
  onSetKey:
    | ((press: { key: string; set: string; scene: string; view: string; consumed: boolean }) => void)
    | null = null;

  /**
   * The CD volume the game has mounted, by its own label — what `currentcd()`
   * answers, set by BOOTFILE's `setpath` (`currentcd("Titanic2")`) and by a load
   * putting back the disc its save names.
   *
   * On the session rather than inside the builtin because a SAVE carries it
   * (container 0 @256) and both halves need it: a load reads it to know which
   * disc to mount, and a save writes it so the file says which disc it was taken
   * on. "" until the boot mounts one — a single-volume game never does.
   */
  mountedCd = "";
  /**
   * The engine's nine path slots, what `path (n)` answers and `path (n, s)` sets.
   * On the session rather than in the builtin because a DreamFactory 5 save
   * carries them (savegame-v5.md, the manifest's `+0x218`).
   */
  readonly pathSlots: string[] = new Array(9).fill("");

  /**
   * Host hook: a movie sequence has fully ended and these are the files it
   * played. A movie is the one resource a game finishes with — TAOOT ships 275
   * of them, 328 MB, and the largest are one-shot cutscenes — so the host gives
   * their bytes back here rather than waiting for a cache budget to force it.
   */
  onMoviesDone: ((names: string[]) => void) | null = null;

  /**
   * Host hook: end whatever film is on screen, because the game under it is
   * being replaced (see MoviePlayer.abandon).
   *
   * A hook and not a call, for the same reason `onPlayMovie` is one: a film is
   * played by a `SetViewer` and this session deliberately holds no reference to
   * one — the viewer is rebuilt mid-transition and what lives here is what
   * outlives that (the fade, the wipe). A headless session leaves it null and
   * loses nothing, having never played a film.
   */
  onAbandonMovie: (() => void) | null = null;
  /** host hook: actually load + display a set (async in the browser) */
  onSetChange: (fileName: string, sceneName: string, viewName: string) => void | Promise<void> =
    () => {};
  /** host hooks for currentscene()/currentview() queries */
  currentSceneName: () => string = () => "";
  currentViewName: () => string = () => "";
  /**
   * hittest(point): what's under a screen pixel — the object NAME and its
   * result() TYPE ("actor"/"scene"/"painting"/"button"/"flat", "" for nothing).
   * The viewer wires this to its click-resolution geometry. Used by e.g.
   * TAOOT's inventory "use item" flow (INVEN.SHP: thename = hittest(arg);
   * switch result() → sendto<type>(thename, offerobject(what))).
   */
  hitTestAt: (x: number, y: number) => { name: string; type: string } = () => ({
    name: "",
    type: "",
  });
  /** the type from the most recent hittest(), returned by result() */
  lastResult = "";
  /**
   * Is this screen point over the ROOM's own image, and over the STAGE's flat?
   *
   * Separate hooks rather than a reading of {@link hitTestAt}, because they have
   * to answer yes THROUGH whatever is drawn on top. `hittest` asks the
   * screen-space props first and unbounded, so a point over the room with a band
   * prop across it is reported as "prop" — correct for a click, wrong for "is
   * this the room".
   *
   * Both are Dust's, and its inventory is what needs them: `inven.prp`'s drag
   * ends by asking, in this order, whether the item was dropped on an actor, on
   * the room, or on the stage (`pointinactor` / `pointinset` / `pointinstage`).
   * Titanic's inventory asks `hittest` once and switches on `result()` instead, so
   * none of the three existed here.
   */
  pointInSet: (x: number, y: number) => boolean = () => false;
  pointInStage: (x: number, y: number) => boolean = () => false;
  /** what the last `setcursor` handler asked the pointer to look like ("" = the
   *  plain arrow, which is also what a handler that says nothing leaves) */
  cursorName = "";
  /**
   * `hidecursor()` / `showcursor()`, as a DEPTH — Win32's `ShowCursor` counter,
   * because that is literally what the original keeps.
   *
   * `hidecursor` is `ShowCursor(FALSE)` and a decrement of its own tally at
   * `tl.exe` 0x45b418 (0x4087b0); `showcursor` is the increment (0x408790).
   * Visible while this is >= 0, hidden below it, and a counter rather than a flag
   * so that two nested hides need two shows — which is Windows' rule and
   * therefore the rule the scripts were written against.
   *
   * The game hides the pointer where it draws its OWN: Timelapse does it three
   * times, and all three are places where a prop follows the mouse instead of a
   * cursor — the bow being drawn (`a.shp` mousedown, paired on both exits), the
   * camera's viewfinder bevel (`docamera`'s `while not button()`), and the
   * endgame. That last one never calls `showcursor`, which is safe in the
   * original because two of its routines wind this back up to 0 for themselves
   * (0x408750 forcing the arrow back, and 0x40ad2f around a modal window). This
   * port has one such place — {@link prepareRestart} — for the same reason.
   */
  cursorDepth = 0;
  /** is the pointer hidden right now? Win32's rule: visible at zero and above */
  get cursorHidden(): boolean {
    return this.cursorDepth < 0;
  }
  /** facing direction of the current view (radians), for arrival continuity */
  currentRotation: (() => number) | null = null;
  /** facing carried across a set change; the next viewer consumes it */
  lastRotation: number | null = null;

  // ---- screen fades and wipes: SessionTransitions (session-transitions.ts) ----
  readonly transitionCtrl = new SessionTransitions(this);
  get fade() { return this.transitionCtrl.fade; }
  get wipe() { return this.transitionCtrl.wipe; }
  get wiping() { return this.transitionCtrl.wiping; }
  get compositing() { return this.transitionCtrl.compositing; }
  get fading() { return this.transitionCtrl.fading; }
  tickWipe(...a: Parameters<SessionTransitions["tickWipe"]>) { return this.transitionCtrl.tickWipe(...a); }
  endWipe(...a: Parameters<SessionTransitions["endWipe"]>) { return this.transitionCtrl.endWipe(...a); }
  tickFade(...a: Parameters<SessionTransitions["tickFade"]>) { return this.transitionCtrl.tickFade(...a); }

  /**
   * Host hook: rebuild the framebuffer from the game's CURRENT state, now.
   *
   * This is `visualeffect(plain, 0)`, which is not the no-op its name suggests.
   * In `tl.exe` it is effect 24014 and its whole body (0x448630) pushes the
   * screen rect TWICE and calls the offscreen-to-screen blit — a full-screen
   * redraw with no effect over it. Which is why the scripts pair it with every
   * change they want to see immediately:
   *
   *     propvisible ("compass", false)
   *     visualeffect (plain, 0)
   *
   * With it doing nothing, a prop the script had just hidden was still in the
   * framebuffer when the next effect captured it — so Timelapse's compass, hidden
   * before every turn, slid off with the leaving picture instead of simply not
   * being there.
   */
  repaintNow: (() => void) | null = null;

  /** host hook: snapshot the currently displayed frame for fade-outs */
  captureFrame: (() => { rgba: Uint8ClampedArray; width: number; height: number } | null) | null =
    null;

  /** the sound sink, behind {@link TimedAudio} so speedrun time can answer `voicedone` */
  readonly audio: AudioSink;

  constructor(
    readonly files: FileProvider,
    audio: AudioSink,
  ) {
    this.audio = new TimedAudio(audio, () => this.gameNow, () => this.nominalTime);
    registerGameBuiltins(this); // core + game families, see builtins/index.ts
    // a transcript's words arrive with their bank, however it was opened (#50)
    this.audioLib.onBankOpened = (bank, sounds) => {
      const source = this.captionSources.get(bank);
      if (!source || !("words" in source)) return;
      for (const clip of sounds) {
        const line = source.words[clip];
        if (line?.text) this.soundWords.set(clip, line);
      }
    };
    this.interp.realYieldSeq = () => this.realYieldSeq;
    // a watched global reads on the pane like the scripts' own message() lines
    this.interp.onGlobalChange = (name, from, to) =>
      this.onLog(`glob: ${name} = ${JSON.stringify(to)} (was ${JSON.stringify(from)})`);
  }

  /**
   * The source `random()` draws from. Replaceable so a run can be reproduced:
   * a story calls random() at points that decide observable state (TAOOT:
   * BOOTFILE advanceday() seeds the arrival clock with `sec = random(60) -1`,
   * and BEDSIT1's bomb loop fires after `random(100)` service steps). With
   * Math.random those land differently every run, which is the difference
   * between a state trace you can diff and one you have to mask. Read through
   * a closure in registerCoreBuiltins, so assigning it after construction
   * (the builtins register in this constructor) still takes effect.
   *
   * This is the SCRIPT stream: what `random()` in a script draws from, and
   * nothing else. See {@link ambientRng} for why that separation exists, and
   * {@link seedRandom} for how a host seeds both at once.
   */
  rng: () => number = Math.random;

  /**
   * The stream the ENGINE's own ambient timers draw from — today just cricket
   * re-arm jitter (`Scheduler.rand`).
   *
   * Not `rng`, although TI.EXE has one `rand()` and sharing would be the
   * faithful arrangement: the cost is too high, and the measurement (TAOOT) is
   * stark. Over carried
   * segments 1-5, the crickets draw **4 times** and scripts draw **834**; the
   * TAOOT corpus's only jittered crickets (`steam1`/`steam2`, BOOTFILE container
   * 2) re-arm on the CLOCK, so those 4 draws move whenever anything moves the
   * clock — and moving them re-values all 834. On a shared stream, un-shadowing
   * `trackbut` changed the script draw COUNT not at all (834 either side) and
   * still flipped the Gorse/Jones coin and reshuffled the crowd extras, because 4
   * ambient draws had slid into different places in the sequence.
   *
   * Splitting costs a fidelity point that NO SCRIPT CAN OBSERVE: which arbitrary
   * value a draw returns is arbitrary either way, and the original's own sequence
   * came from a time seed nobody can reproduce. What it buys is that an engine
   * change with no effect on what scripts ask for has no effect on what they
   * get. Crickets stay deterministic — that is the real point of seeding them at
   * all, since a cricket writes its name to sound channel 2 and `currentsound(2)`
   * is script-readable (TAOOT's bedsit landlady sequences her five lines on it).
   */
  ambientRng: () => number = Math.random;

  /**
   * Seed both streams from one number — the only way a host should do it, so the
   * two cannot drift apart. The ambient
   * stream is offset rather than shared so it draws a different sequence.
   */
  seedRandom(seed: number): void {
    this.rng = seededRng(seed);
    this.ambientRng = seededRng((seed ^ 0x9e3779b9) >>> 0);
  }

  /**
   * Real event-loop yield hook + counter. forceupdate()/stilldown() call
   * nextFrame() to render a frame and pump input, then bump realYieldSeq; the
   * interpreter's while-guard uses the counter to spare interactive loops. In
   * the browser main.ts points nextFrame at requestAnimationFrame; the default
   * resolves immediately (headless / tests advance the clock manually).
   */
  nextFrame: () => Promise<void> = () => Promise.resolve();
  /**
   * True once the host wires nextFrame to real rendered frames (rAF). Only
   * then do forceupdate/stilldown bump realYieldSeq: in a browser an
   * interactive poll loop genuinely waits on the user, so the while-guard must
   * not trip it. Headless (tests) keeps this false — there forceupdate
   * free-runs (it advances its own clock and nextFrame resolves immediately),
   * so a stuck loop MUST still hit the 100k guard instead of hanging forever.
   */
  hasRealFrames = false;
  /**
   * False when nothing will ever look at a film's pixels — a machine suite
   * (redjack/tests/machine) — so a DreamFactory 5 film reads each frame's size
   * and palette and skips the decode, and a v5 room skips drawing its sphere
   * (maze-view.ts), which between them are most of what a headless run would
   * otherwise spend its time on. Every page leaves it true.
   */
  drawsPictures = true;
  realYieldSeq = 0;
  /**
   * The host advances movie frames, so `playmovie` may block the way TI.EXE's
   * does. Implied by {@link hasRealFrames} — see the playmovie builtin.
   *
   * Modal playback is the engine's actual behaviour; the non-blocking path is
   * the deviation, taken because a host with no frame source would deadlock on
   * the first cutscene. A harness that pumps `viewer.tick()` itself has a frame
   * source and wants the real semantics: without them a boot walks straight
   * past its interactive menu (TAOOT: playmode.mov's GAME/TOUR choice resolves
   * to whatever `actionframe(1)` happens to hold) and every close-up scores
   * without ever being dismissed.
   */
  modalMovies = false;

  // ---- timing runtime (delay / makeloop / makecricket / soundloop) --------

  readonly clock = new Clock();
  /**
   * loop/cricket/walk scheduling + sound-loop handling on the 50 ms heartbeat.
   * Addressed directly — `session.scheduler.makeLoop(...)` — like the stage and
   * puppet controllers; the session carries no forwarding surface for it.
   */
  readonly scheduler = new Scheduler(this);
  /** host hook: listener (camera) ground position + facing for crickets */
  listener: () => { x: number; y: number; deg: number } | null = () => null;
  /**
   * Host hook: the camera the world is being drawn through right now — the
   * motion camera mid-turn, the standpoint's the rest of the time.
   *
   * The listener above is the same camera reduced to a ground position and a
   * facing, which is all a cricket's falloff and pan need. `actordist` needs the
   * whole thing, because the question it really asks is whether the actor would
   * be DRAWN (see {@link ActorRuntime.onScreen}), and that is a projection.
   *
   * A session with no viewer — the unit tests that drive one directly — leaves
   * this null, and `actordist` then falls back to the gates that do not need a
   * camera. "Nobody has told me where the camera is" is not the same claim as
   * "the actor is off screen", and answering the sentinel for it would make
   * every character in a bare session permanently invisible to their own idle.
   */
  activeCamera: () => WorldCamera | null = () => null;

  /** scripts currently executing/suspended (delay) — input waits on these */
  private readonly inflight = new Set<Promise<unknown>>();
  /**
   * The idle heartbeat's own dispatches — awaited by {@link settle} but NOT by
   * {@link scriptBusy}, because they are not scripts the player started.
   *
   * A boot library's `idle()` calls its clock handler (TAOOT: `calctime()`)
   * straight through, synchronously, once per main-loop pass: in the original it
   * cannot possibly overlap the event
   * dispatch further down the same handler. Here it is an async dispatch, so
   * putting it in `inflight` would make the engine look busy for the microtask it
   * takes to settle — and `scriptBusy` is what the input queue waits on. The
   * clock would then eat keys and clicks: measured with the heartbeat in
   * `inflight` on both hosts, a press made during a walk went `posted=3 taken=0
   * dropped=2`. Separating the two sets is what lets the clock tick without
   * the player's input paying for it.
   */
  private readonly idleInflight = new Set<Promise<unknown>>();

  /**
   * What each in-flight dispatch IS, for the one question a stall asks: the
   * engine refuses input while `scriptBusy`, and a set of anonymous promises
   * cannot say which one is not coming back. A hung run could report "the engine
   * would not take an arrow" and nothing more; now it can name the dispatch.
   */
  private readonly labels = new WeakMap<Promise<unknown>, string>();

  /** run a script dispatch in the background, tracked for busy/settle */
  track<T>(p: Promise<T>, label = ""): Promise<T> {
    return this.trackIn(this.inflight, p, label);
  }

  /** as {@link track}, for the idle heartbeat — settle waits, scriptBusy doesn't */
  trackIdle<T>(p: Promise<T>, label = ""): Promise<T> {
    return this.trackIn(this.idleInflight, p, label);
  }

  private trackIn<T>(set: Set<Promise<unknown>>, p: Promise<T>, label = ""): Promise<T> {
    set.add(p);
    if (label) this.labels.set(p, label);
    void p.catch((e) => this.onLog(`script error: ${(e as Error).message}`)).then(() => {
      set.delete(p);
    });
    return p;
  }

  /** the dispatches holding the engine right now, named where the caller said so
   *  ("?" for a call site that has not been given a label yet) */
  pending(): string[] {
    return [...this.inflight].map((p) => this.labels.get(p) ?? "?");
  }

  get scriptBusy(): boolean {
    return this.inflight.size > 0;
  }

  /** wait until all in-flight script dispatches finish (tests, shutdown) */
  async settle(maxRounds = 1000): Promise<void> {
    for (let i = 0; i < maxRounds && (this.inflight.size || this.idleInflight.size); i++) {
      await Promise.allSettled([...this.inflight, ...this.idleInflight]);
    }
  }

  /**
   * Monotonic DISPLAYED-frame counter behind frame().
   *
   * `framerate()` is ticks per displayed frame against a 60 Hz base — which is
   * why scripts pass 0 for "unthrottled" and 5 for slow, deliberate frames
   * (TAOOT's fight stage), and why forceupdate() holds that many ticks per call.
   * frame() counts the same unit, so it advances once per `frameRate` ticks,
   * not once per tick. Read off the cast's own seconds→frames conversion,
   * `(seconds * 60) / framerate()`, which only comes out in seconds if frame()
   * runs at 60/framerate() Hz — and confirmed since in TI.EXE itself, where
   * `framerate` is the value added to the last frame's timestamp (0x43a940).
   *
   * Counting raw ticks instead made every timer built on frame() run
   * `frameRate`× fast. The visible one was TAOOT's hasattention(): characters
   * who should speak up after you linger near them for four seconds — Georgia
   * and Morrow on the boat deck — accosted you inside a second and a half, i.e.
   * while you were still walking past.
   *
   * {@link advanceFrames} is where the "per `frameRate` ticks" is enforced, and
   * it counts TICKS OF THE CLOCK rather than calls, so the rate is the same on
   * a browser at any refresh rate and on the pumped-clock host.
   */
  frameCounter = 0;

  /**
   * Witness every write to a named prop's owner — off unless a host asks.
   *
   * Here rather than in either harness, and FORMATTED here too, because the whole
   * value of it is that the two hosts produce lines that can be diffed. The last
   * attempt at this question used a `sendEvent` wrapper headless and a
   * once-per-rAF sampler in the browser, and the two could not be compared at
   * all: the sampler only saw values that survived to a frame boundary, so it
   * reported that the browser never writes `"off"` when in fact it does — just
   * not in the two runs that were measured. A hook on the write itself cannot
   * miss one.
   *
   * `@frame=` is deliberately LAST on the line. It is harness-paced (the two
   * hosts count frames differently by design — runtime/masks.ts), so a
   * comparison strips it and keeps the causal columns:
   *
   *     sed 's| @frame=.*||' both files, then diff
   *
   * Cheap enough to leave on the write path: `propowner` with a value is a script
   * doing bookkeeping, not something a frame loop does. Set `propTrace` to the
   * lowercased prop names to watch and point `onPropTrace` at a sink.
   */
  readonly propTrace = new Set<string>();
  onPropTrace: ((line: string) => void) | null = null;
  private propTraceSeq = 0;

  /** Record one owner write, if it is being witnessed and actually changes it. */
  tracePropOwner(name: string, from: string, to: string, frame: Frame): void {
    if (!this.onPropTrace || from === to) return;
    if (!this.propTrace.has(name.toLowerCase())) return;
    const at = `set=${this.currentSetName} flat=${this.currentFlat} vis=${this.setVisible ? 1 : 0}`;
    this.onPropTrace(
      `#${String(++this.propTraceSeq).padStart(3, "0")} ${name} ${from || "-"} -> ${to || "-"}` +
        ` by=${frame.script.name}.${frame.handler || "?"} me=${frame.ctx.me || "-"} ${at}` +
        ` @frame=${this.frameCounter}`,
    );
  }

  /** wall-clock tick stamp of the last displayed frame — TI.EXE's 0x48a6d8 */
  private lastFrameTick: number | null = null;
  tickTime(now: number): void {
    this.advanceFrames(now);
    this.scheduler.tickTime(now);
  }

  // ---- the game's clock: SessionTime (session-time.ts) -----------------------
  readonly timeCtrl = new SessionTime(this);
  get nominalTime() { return this.timeCtrl.nominalTime; }
  set nominalTime(v: SessionTime["nominalTime"]) { this.timeCtrl.nominalTime = v; }
  get sheetClock() { return this.timeCtrl.sheetClock; }
  set sheetClock(v: SessionTime["sheetClock"]) { this.timeCtrl.sheetClock = v; }
  get sheetPasses() { return this.timeCtrl.sheetPasses; }
  set sheetPasses(v: SessionTime["sheetPasses"]) { this.timeCtrl.sheetPasses = v; }
  get sheetHalted() { return this.timeCtrl.sheetHalted; }
  set sheetHalted(v: SessionTime["sheetHalted"]) { this.timeCtrl.sheetHalted = v; }
  get sheetWatchPasses() { return this.timeCtrl.sheetWatchPasses; }
  set sheetWatchPasses(v: SessionTime["sheetWatchPasses"]) { this.timeCtrl.sheetWatchPasses = v; }
  get sheetHolds() { return this.timeCtrl.sheetHolds; }
  get sheetWatches() { return this.timeCtrl.sheetWatches; }
  get sheetWatchHolds() { return this.timeCtrl.sheetWatchHolds; }
  get gameNow() { return this.timeCtrl.gameNow; }
  get runMs() { return this.timeCtrl.runMs; }
  get frozen() { return this.timeCtrl.frozen; }
  get loadingFiles() { return this.timeCtrl.loadingFiles; }
  gameTime(...a: Parameters<SessionTime["gameTime"]>) { return this.timeCtrl.gameTime(...a); }
  countRun(...a: Parameters<SessionTime["countRun"]>) { return this.timeCtrl.countRun(...a); }
  freezeTime(...a: Parameters<SessionTime["freezeTime"]>) { return this.timeCtrl.freezeTime(...a); }
  thawTime(...a: Parameters<SessionTime["thawTime"]>) { return this.timeCtrl.thawTime(...a); }
  whileLoading<T>(load: Promise<T>): Promise<T> { return this.timeCtrl.whileLoading(load); }

  /**
   * Advance frame() the way TI.EXE does — off the CLOCK, not off how often the
   * host happened to call us.
   *
   * The original increments its counter (0x489efa, all `frame()` returns) once
   * per displayed frame at 0x439b80, and the very next thing it does is spin
   * until real time catches up (0x43a940):
   *
   *     call 0x41de90            ; now = timeGetTime() * 3 / 50
   *     mov  ecx, [0x489efe]     ; framerate  (initialised to 3 at 0x429643)
   *     add  ecx, [0x48a6d8]     ; + last frame's stamp
   *     cmp  eax, ecx
   *     jl   0x43a940            ; not yet -> spin
   *     mov  [0x48a6d8], eax     ; stamp this frame
   *
   * `framerate` is ADDED TO A TIMESTAMP, so a frame is every `framerate` ticks
   * of time — 60/framerate Hz, pinned to the clock however fast the machine
   * draws. That makes the unit a DURATION, which is why it is the same rule on
   * every host and this function has no host special case.
   *
   * Counting the calls instead only agrees when the caller arrives exactly 60
   * times a second, and neither host does:
   *
   *  * the browser delivers whatever rAF gives. At 38 fps every frame()-based
   *    timer would run 37% slow; on a 120 Hz panel twice as fast.
   *  * the pumped-clock host advances 50 ms per forceupdate — which already IS
   *    one displayed frame at the default framerate of 3 (3 ticks = 50 ms), so
   *    dividing by framerate again would count every frame three times. That the two
   *    coincide is not luck: the boot's clock handler (TAOOT: calctime) fixes a
   *    main-loop pass at 50 ms (20 passes to the pocketwatch's second), and at
   *    framerate 3 a pass is a frame.
   */
  private advanceFrames(now: number): void {
    const period = Math.max(1, Math.round(this.frameRate));
    const t = ticksAt(now);
    if (this.lastFrameTick === null) {
      this.lastFrameTick = t;
      return;
    }
    // one displayed frame at most, and a late one is not made up (passDue)
    const pass = passDue(this.lastFrameTick, t, period);
    if (!pass.due) return;
    this.frameCounter += 1;
    this.lastFrameTick = pass.next;
  }

  // ---- sendto* event dispatch: SessionEvents (session-events.ts) ----------
  readonly eventCtrl = new SessionEvents(this);
  sendEvent(...a: Parameters<SessionEvents["sendEvent"]>) { return this.eventCtrl.sendEvent(...a); }
  runHandlerChain(...a: Parameters<SessionEvents["runHandlerChain"]>) { return this.eventCtrl.runHandlerChain(...a); }
  sendToPainting(...a: Parameters<SessionEvents["sendToPainting"]>) { return this.eventCtrl.sendToPainting(...a); }

  /** parse a script container into an instance bound to `owner` */
  instanceFrom(data: Uint8Array | undefined, owner: string): ScriptInstance | null {
    if (!data) return null;
    const tokens = sniffScript(data);
    if (!tokens) return null;
    // a container with no statement in it at all is no script: Atlantis's flat
    // z0001.143 holds sixteen bytes and a lone integer, the authoring tool's
    // stub, and parsing it logged an error at every visit (tools/dumpscripts.ts
    // skips the same containers, for the same reason)
    if (!tokens.some((t) => t.kind === "op")) return null;
    try {
      const script = parseScript(tokens);
      return new ScriptInstance(owner, script);
    } catch (e) {
      this.onLog(`parse error in ${owner}: ${(e as Error).message}`);
      return null;
    }
  }

  // ---- booting and restarting: SessionBoot (session-boot.ts) ---------------
  readonly bootCtrl = new SessionBoot(this);
  private get coreLoaded() { return this.bootCtrl.coreLoaded; }
  private set coreLoaded(v: boolean) { this.bootCtrl.coreLoaded = v; }
  get discVolumes() { return this.bootCtrl.discVolumes; }
  ensureBooted(...a: Parameters<SessionBoot["ensureBooted"]>) { return this.bootCtrl.ensureBooted(...a); }
  bootedByGame(...a: Parameters<SessionBoot["bootedByGame"]>) { return this.bootCtrl.bootedByGame(...a); }
  prepareRestart(...a: Parameters<SessionBoot["prepareRestart"]>) { return this.bootCtrl.prepareRestart(...a); }

  // ---- stage layer (STG flats) --------------------------------------------
  // Flat/region/overlay logic lives in StageController (runtime/stage.ts); the
  // widely-shared fields below stay here and the session delegates the methods.

  stageName = "none";
  /** flat script instances of the current stage, by lowercase flat name */
  readonly flatScripts = new Map<string, ScriptInstance>();
  flatNames: string[] = [];
  currentFlat = "none";
  /** whether the set view draws over the flat (setvisible builtin) */
  setVisible = true;
  /**
   * Is there a room on the screen? `setVisible` is only the flag the scripts
   * raise and lower; a set also has to be OPEN for it to mean anything, which
   * is why `setvisible()`'s getter answers with both. The renderer and the hit
   * tests have to ask the same question the scripts get an answer to.
   *
   * TAOOT's endgame is where the difference is visible. `advanceday()` runs
   * `closesetfile()` and only then transtoflat()s to the closing narration — so
   * the boot's own `if currentset() != "none": setvisible(false)` does NOT fire,
   * the flag stays raised over a set that no longer exists, and the viewer would
   * go on compositing the room's last decoded frame over the top of every
   * newspaper flat and the final movie: the boat deck you left, with the ending
   * showing in the strip of screen below it.
   */
  get viewShowing(): boolean {
    return this.setVisible && this.currentSetName !== "none";
  }
  /**
   * Is a stage OPEN? The same question the `stagevisible` builtin answers, and
   * the one the input path has to ask before it can resolve a click to a flat
   * or one of its button regions.
   *
   * A stage having a MAIN SCRIPT is a different question, and asking that one
   * instead is a bug the demo found. `openstagefile` parses container 1 as the
   * stage main, and a stage need not have one — TAOOT's `inven1.stg` does, its
   * 1996-demo counterpart `inven.stg` does NOT, because there the FLAT carries
   * the handlers (openflat/closeflat/mousedown/showprop/…). The hit test and
   * the click dispatch both gated the whole stage branch on `stageScript`, so
   * in the demo `hittest` over the open inventory answered "none" instead of
   * `("ok", "button")`, the boot's `mousedown` switch had no case to take, and
   * the bag's OK and Examine buttons did nothing at all — no dispatch, nothing
   * in the log. A stage with no main is still a stage.
   */
  get stageOpen(): boolean {
    return this.stageName !== "none";
  }
  /** name of the looping theme currently playing (currenttheme getter) */
  currentThemeName = "none";
  /**
   * TI.EXE puppet render params by slot (puppetparam builtin), seeded with the
   * defaults `openpuppetfile` writes at 0x4296e4. They are not decoration: the
   * puppet renderer reads 3, 4, 6 and 10 for the colour, size and margin of
   * every line of conversation text, so a wrong default is a visibly wrong
   * screen.
   *
   * | slot | default | what |
   * |-----:|--------:|------|
   * | 1, 2 | 0, 128  | clut range the puppet palette mixes into |
   * | 3    | 250     | answer text colour |
   * | 4    | 251     | frame around the answer you picked |
   * | 5    | 888     | font id (anything but 16 realises as Arial) |
   * | 6    | 12      | text size |
   * | 7    | 0       | subtitles on — see below |
   * | 8    | 0       | (TAOOT sets it around two puppets' lines: ZEIT1, BX2, SHAHACK2) |
   * | 9    | 2       | ticks per byte a text-paced line is held for |
   * | 10   | 8       | left margin of the answer rows (NOT the subtitle, which hardcodes 8) |
   *
   * Two of these TAOOT's shipped data overrides immediately and never puts
   * back — its BOOTFILE `boot()` opens with `puppetparam(9, 1)` and
   * `puppetparam(10, 25)` — so the answer rows a player actually sees are
   * indented 25, and 8 is only what a puppet opened outside the boot would use.
   * The subtitle is unaffected either way: it hardcodes its own 8.
   *
   * Slot 7 is the exception to "seeded with TI.EXE's defaults": the original
   * starts subtitles OFF and lets the title's settings panel turn them on
   * (TAOOT: the CTL.STG subtoggle lever), and this port starts them ON.
   */
  readonly puppetParams = new Map<number, number>([
    [1, 0], [2, 128], [3, 250], [4, 251], [5, 888], [6, 12], [7, 1], [8, 0], [9, 2], [10, 8],
  ]);

  // ---- captions: SessionCaptions (session-captions.ts) -----------------------
  readonly captionCtrl = new SessionCaptions(this);
  get everyLineSubtitled() { return this.captionCtrl.everyLineSubtitled; }
  set everyLineSubtitled(v: SessionCaptions["everyLineSubtitled"]) { this.captionCtrl.everyLineSubtitled = v; }
  get preferPortCaptions() { return this.captionCtrl.preferPortCaptions; }
  set preferPortCaptions(v: SessionCaptions["preferPortCaptions"]) { this.captionCtrl.preferPortCaptions = v; }
  get speakerOf() { return this.captionCtrl.speakerOf; }
  set speakerOf(v: SessionCaptions["speakerOf"]) { this.captionCtrl.speakerOf = v; }
  get captions() { return this.captionCtrl.captions; }
  set captions(v: SessionCaptions["captions"]) { this.captionCtrl.captions = v; }
  get captionSources() { return this.captionCtrl.captionSources; }
  get themeCaptionSources() { return this.captionCtrl.themeCaptionSources; }
  get movieCaptionSources() { return this.captionCtrl.movieCaptionSources; }
  get movieSoundSources() { return this.captionCtrl.movieSoundSources; }
  get movieSoundWords() { return this.captionCtrl.movieSoundWords; }
  get movieBedSources() { return this.captionCtrl.movieBedSources; }
  get soundWords() { return this.captionCtrl.soundWords; }
  subtitlesOn(...a: Parameters<SessionCaptions["subtitlesOn"]>) { return this.captionCtrl.subtitlesOn(...a); }
  themeStarted(...a: Parameters<SessionCaptions["themeStarted"]>) { return this.captionCtrl.themeStarted(...a); }
  movieCaption(...a: Parameters<SessionCaptions["movieCaption"]>) { return this.captionCtrl.movieCaption(...a); }
  prepareMovieCaptions(...a: Parameters<SessionCaptions["prepareMovieCaptions"]>) { return this.captionCtrl.prepareMovieCaptions(...a); }
  captionMovieBed(...a: Parameters<SessionCaptions["captionMovieBed"]>) { return this.captionCtrl.captionMovieBed(...a); }
  captionMovieSound(...a: Parameters<SessionCaptions["captionMovieSound"]>) { return this.captionCtrl.captionMovieSound(...a); }
  captionClip(...a: Parameters<SessionCaptions["captionClip"]>) { return this.captionCtrl.captionClip(...a); }
  captionLines(...a: Parameters<SessionCaptions["captionLines"]>) { return this.captionCtrl.captionLines(...a); }
  /**
   * wave (sampled-audio) master volume, 0..9 — the CTL.STG settings dial reads
   * back wavevolume() and writes it live. Drives the sound + voice channels'
   * master gain. Music is separate (global themevolume + themevol). Default 9
   * (full) matches the sink's unity channel gain.
   */
  waveVolume = 9;
  /**
   * Set it and apply it — the one place that does, because three things write it
   * and they have to agree: the scripts' `wavevolume(n)` (TAOOT's CTL.STG dial),
   * the digit keys during a line or a movie, and the play page's own control.
   *
   * TI.EXE has the same single funnel: `0x4249b0` is the setter, and its call
   * sites are `wavevolume`'s own (0x43de4c) plus the ten digit arms in each of
   * the two key filters (0x441dca.. and 0x44a4b1..) — twenty-one callers, one
   * value. The reader `0x424980` answers `wavevolume()` and nothing else.
   */
  setWaveVolume(n: number): number {
    this.waveVolume = Math.max(0, Math.min(9, Math.round(n)));
    const g = this.waveVolume / 9;
    this.audio.setChannelVolume("sound", g);
    this.audio.setChannelVolume("voice", g);
    return this.waveVolume;
  }
  /**
   * Theme (music) loudness as the scripts see it, 0..255 — what `themevol(track)`
   * reads back and `themevol(track, v)` writes. Held here because it has to be
   * READABLE: the scripts duck the score with a read-modify-write.
   *
   * `themevol(currenttheme(2), themevol(currenttheme(2)) / 4)` is the idiom, and
   * with the getter answering 0 it means "set the music to zero and, on the way
   * back up, multiply zero by four". TAOOT's 1996 demo does exactly that around
   * every conversation (gang.cst `prepuppet`/`postpuppet`), so its music would
   * die at the first puppet and never come back; NAREND.STG's bad-ending narration
   * ducks in three stages the same way and would go silent at the first newspaper.
   *
   * A single channel, so the track name is informational (see the themevol
   * builtin). Starts at 255 — the engine's own full-volume default, which is
   * what a script reading before anything has set it should see.
   */
  themeVolume = 255;
  /**
   * ...and per TRACK, which is what the name argument is for after all.
   *
   * `themevol(track, v)` is not only a channel gain: the volume belongs to the
   * TRACK, and a script sets it BEFORE playing that track. Dust's saloon is the
   * case that proves it, because the same music is scored at two loudnesses by
   * two different rooms:
   *
   *     SALLOWER  themevol ("saloonsep.snd", 55) ; playtheme ("saloonsep.snd")
   *     SALUPPER  themevol ("saloonsep.snd", 24) ; playtheme ("saloonsep.snd")
   *
   * — the piano heard from the bar, and the same piano heard through the floor
   * from the landing above it. Finishing `playtheme` by applying the master
   * `themevolume` global would throw both of those away: the score would come
   * back at 255 the instant it started. Downstairs that would be invisible,
   * because SALLOWER runs a scene loop that re-sets the volume from your distance
   * to the piano every two ticks — so the clobber is corrected before anyone can
   * hear it. Upstairs nothing corrects it, and the music would stay at full
   * volume through every conversation on that landing.
   *
   * So a track's volume is remembered under its name, and starting a track
   * applies what the script asked for that track. TAOOT is unaffected in
   * practice: its idiom is the other order — `playtheme(x)` and then
   * `themevol(currenttheme(2), themevolume)` — so the value it remembers is the
   * slider's, which is what it wanted the play to apply anyway.
   */
  private readonly trackVolume = new Map<string, number>();
  /** Set the theme loudness (0..255) and apply it to the audio channel. The one
   *  way it is written, so the value a script reads back is the one in effect.
   *  `track` names the track it belongs to, so starting that track can restore it. */
  setThemeVolume(v: number, track?: string): void {
    this.themeVolume = Math.max(0, Math.min(255, Math.round(v)));
    if (track) this.trackVolume.set(track.toLowerCase(), this.themeVolume);
    this.audio.setChannelVolume("theme", this.themeVolume / 255);
  }
  /** What a script last asked THIS track to play at, or undefined if it never
   *  said — see {@link trackVolume}. */
  volumeForTrack(track: string): number | undefined {
    return this.trackVolume.get(track.toLowerCase());
  }
  /** framerate() target cadence; drag loops save/drop/restore it (turbine dials) */
  frameRate = 3;

  // ---- persistent text layer (drawstring/stringwidth builtins) ------------
  /** text drawn by drawstring(), composited over the screen after props.
   *  DreamFactory draws into a persistent buffer; we recomposite each frame,
   *  so we keep the drawn strings and re-apply them. Later draws at the same
   *  (x,y,size) replace earlier ones (TAOOT: CTL redraws its direction letters
   *  every update(); the wireless writes each morse glyph at a fresh x).
   *  Cleared on flat change, and where a prop is drawn over it — see
   *  {@link eraseTextUnderProp}, which is how a script erases a field. */
  readonly textOverlay: { text: string; x: number; y: number; color: number; size: number }[] = [];
  /**
   * The photograph the album is showing, composited over the flat.
   *
   * `plugin("camera", path, id)` sets it and the renderer draws it until
   * something replaces it — which is the same contract as {@link textOverlay},
   * and for the same reason: the original's plugin writes into a persistent
   * screen buffer, this port rebuilds the picture every frame. The album's
   * `updateflat` loop re-issues both every other tick.
   *
   * Cleared with the text layer on a flat change, so leaving the album does not
   * leave a photograph floating over the next picture.
   */
  photoOverlay: { photo: Photo; x: number; y: number } | null = null;
  /**
   * The player's photographs. See {@link PhotoAlbum} — the store behind it is
   * the host's business, and there is none in a headless run.
   */
  readonly photos = new PhotoAlbum();
  /**
   * Host hook: grab a {@link PHOTO_W}x{@link PHOTO_H} photograph centred on a
   * point of the CURRENT screen.
   *
   * The renderer owns the framebuffer, so only it can answer. `docamera` hides
   * the viewfinder bevel, shows the cursor and calls `forceupdate()` before the
   * shutter, so what this grabs is the clean picture the player framed.
   */
  grabPhoto: ((cx: number, cy: number) => Photo | null) | null = null;
  /** measure a drawstring in device pixels using the render font; set by the
   *  viewer so stringwidth() matches what actually paints. null in headless
   *  tests, where stringwidth() falls back to a fixed-pitch estimate. */
  measureText: ((text: string, size: number) => number) | null = null;
  /**
   * The character set the loaded tree's text bytes are in — subtitles, choice
   * bevels, drawstring. A function rather than a value because the language is
   * the file source's business and can change under a live session; the host
   * points this at {@link FileStore.activeEdition}. Defaults to the same Mac OS
   * Roman a tree with no language reports (engine/src/df/text.ts).
   */
  textEncoding: () => DfEncoding = () => DEFAULT_ENCODING;
  clearTextOverlay(): void {
    this.textOverlay.length = 0;
    this.photoOverlay = null;
  }

  /** what a drawstring occupies on screen — `y` is its BASELINE, so the box
   *  runs a size up from it and a little below (screen-presenter.ts paints it
   *  with an alphabetic baseline, QuickDraw's own convention) */
  private textEntryBox(e: { text: string; x: number; y: number; size: number }) {
    return {
      x: e.x,
      y: e.y - e.size,
      w: this.textWidth(e.text, e.size),
      h: e.size + Math.ceil(e.size / 4),
    };
  }

  /** the width stringwidth() answers — the render font's when a host has one */
  textWidth(text: string, size: number): number {
    return this.measureText
      ? Math.round(this.measureText(text, size))
      : Math.ceil(text.length * size * 0.6);
  }

  /**
   * A prop has just been drawn over the screen: whatever `drawstring` left
   * under it is gone.
   *
   * This is how a DreamFactory script ERASES text, and it has to be modelled
   * because our text layer is retained and the original's is not. In TI.EXE and
   * DUST.EXE a `drawstring` paints into the composited screen, and the pixels
   * stand until something composites over that region — so a script that wants
   * a field cleared flashes an opaque patch across it: show, `forceupdate`,
   * hide, `forceupdate`, and the old string is painted over on the way in and
   * restored-from-flat on the way out. Ours recomposites every frame with the
   * text ON TOP, so the patch alone would be invisible and every value a field
   * ever held would stay on screen, stacked.
   *
   * Both games do it, which is why this is a rule about props and not a name:
   *
   *   - TAOOT's wireless, `clearmessagebox()`: `propvisible ("messageboxclear",
   *     true)`, `forceupdate ()`, `propvisible ("messageboxclear", false)`.
   *   - Dust's saloon, `lowdrawcash(num, x, y)` in SALGAMES.FLT: the same four
   *     statements over `blankscore`, moved to the field being rewritten with
   *     `propxy` first, and only THEN `drawstring ("$" @ num, …)`. Both fields
   *     are right-aligned by shifting x by 4 px per missing digit, so the new
   *     value never lands where the old one did, and without the patch nothing
   *     replaces it: #288,
   *     "$100" and "$10" and "$0" all at once in the WAGER box.
   *
   * By RECT and not the whole layer, because the patch is a patch: TAOOT's
   * `messageboxclear` covers x 65..350, y 339..362 of the wireless slip and
   * nothing else on that flat, and Dust's `blankscore` is 60x15 over one of two
   * fields 40 px apart — clearing everything would take the CASH readout with
   * the WAGER one.
   *
   * On the show TRANSITION only. Showing a prop that is already shown
   * composites nothing in the original (nothing is dirty), and a prop being
   * HIDDEN restores the flat under it, which would also wipe text — but no
   * script in the three corpora draws under a prop it then hides, and taking
   * that on would put every disappearing prop in reach of a field it never
   * touched.
   */
  eraseTextUnderProp(p: PropInstance): void {
    const r = p.screenRect(this.propRuntime.origin);
    if (!r) return;
    for (let i = this.textOverlay.length - 1; i >= 0; i--) {
      const b = this.textEntryBox(this.textOverlay[i]);
      if (b.x < r.x + r.w && r.x < b.x + b.w && b.y < r.y + r.h && r.y < b.y + b.h) {
        this.textOverlay.splice(i, 1);
      }
    }
  }

  /**
   * Input the player made while the engine was mid-gesture, waiting its turn —
   * TI.EXE's event queue, see {@link EventQueue}. The viewer posts to it instead
   * of dropping the gesture, and drains it as it settles; `flushevents()` throws
   * it away, which is the whole reason scripts call that (92 places in the
   * TAOOT corpus).
   */
  readonly events = new EventQueue();

  // ---- pointer state (mouse()/button()/pointx/pointy builtins) ------------
  /** last pointer position in 512×384 screen space; scripts read it via mouse() */
  pointerX = 0;
  pointerY = 0;
  /** whether a mouse button is currently held (button() builtin) */
  pointerDown = false;
  /**
   * Which button the last press was: 1 the left, 2 the right. DreamFactory 5's
   * `sysparam (7)`, which RedJack's rooms ask in `mousedown` to zoom on a
   * right-click. The page sets it; v4 has no way to ask.
   */
  pointerButton = 1;
  /**
   * Whether SHIFT was held for the press being handled — the `shiftkey()` builtin.
   *
   * Snapshotted when the press arrives rather than tracked as live keyboard state,
   * because that is how the original asks: `shiftkey()` is read INSIDE a mousedown
   * handler (house.shp's HELP button), so what matters is the modifier the click
   * carried and not whether the key happens to still be down two frames later.
   *
   * {@link altDown} and {@link metaDown} are the same snapshot for the other two
   * probes — see the census where all three are registered (builtins/scene.ts).
   */
  shiftDown = false;
  /**
   * Whether OPTION (alt) and COMMAND (meta) were held — `optionkey()` and
   * `commandkey()`.
   *
   * These stay `false` for a player, and the page that runs the game is what
   * decides: nothing in the engine ever sets them. Titanic's play page feeds
   * `shiftDown` from the press and leaves these alone, so `optionkey()` answers 0
   * there exactly as it did when it was hardwired to — which is the behaviour to
   * keep, because the three ungated `optionkey` branches in the shipping game are
   * dev tools that move the cricket in Z, rescale a smokestack prop and open
   * `debugger()`, and none of those is a thing a player should be able to do to
   * their own game by accident.
   *
   * The developer-mode page (taoot/devmode/) is what sets them, because the whole
   * point of that page is to reach what the 1996 debug build could reach: nearly
   * every `debugging` branch in the corpus is gated `optionkey () & debugging`,
   * so with these two stuck at 0 the flag alone opens almost nothing.
   */
  altDown = false;
  metaDown = false;
  /**
   * DreamFactory 5's `spacebar ()`: is the space bar down NOW. Live state, not a
   * press snapshot like {@link shiftDown} — RedJack.exe asks
   * `GetAsyncKeyState`, and the scripts poll it from loops that play a chest or
   * a crate open until it is. The page that runs the game keeps it.
   */
  spaceDown = false;
  /** DreamFactory 5's `screenbrightness`: added to every channel of the screen, -255..255 */
  screenBright: [number, number, number] = [0, 0, 0];
  /** DreamFactory 5's `screencontrast`: a gamma per channel, -128..128, 0 as painted */
  screenContrast: [number, number, number] = [0, 0, 0];
  /**
   * DreamFactory 5's `stageorigin`: where the open stage's top-left is drawn.
   * A fight moves it to shake the screen; props with `propsnap` go with it.
   */
  get stageOrigin(): { x: number; y: number } {
    return { ...this.propRuntime.origin };
  }
  set stageOrigin(at: { x: number; y: number }) {
    Object.assign(this.propRuntime.origin, at);
  }
  /** the colour depth `doublebuffer` last asked for, which `sysparam (10)` answers */
  screenDepth = 32;
  /** engine time of the last `button()`/`stilldown()` — see {@link pollingInput} */
  private lastInputPoll = -Infinity;
  /** a script just read the button state: it owns this press (`button`, `stilldown`) */
  inputPolled(): void {
    this.lastInputPoll = this.clock.now;
  }
  /**
   * Is a script sitting in an input poll loop right now?
   *
   * The press that drives such a loop must NOT also go in the event queue. The
   * loop consumes it by polling — `while stilldown()`, `while not button()` — and
   * a queued copy is dispatched again when the loop ends, into whatever is on
   * screen by then. That is what `flushevents()` is for and why scripts call it
   * in 92 places (TAOOT corpus), but not all of them do: TAOOT's INVEN1.STG
   * `dobook()` (hiding the Rubaiyat in a coal bunker) ends without one, and the
   * replayed press then ate the very next click — the bunker flat's OK stopped
   * closing it, in a browser only, because only there does the press outlive a
   * frame.
   *
   * A poll within the last few engine steps means the loop is still going round:
   * each iteration yields a frame, so the gap between polls is one frame, not one
   * step. Anything older is a script that merely takes time (a door animation, a
   * walk), and a click made during THAT is exactly what the queue is for.
   */
  pollingInput(): boolean {
    return this.clock.now - this.lastInputPoll <= 4 * ENGINE_STEP_MS;
  }

  /** update the cursor position scripts see (called by the viewer on move/click) */
  setPointer(x: number, y: number): void {
    this.pointerX = x;
    this.pointerY = y;
  }

  /** the pointer as the engine's packed point — see runtime/point.ts */
  pointerPoint(): number {
    return packPoint(this.pointerX, this.pointerY);
  }
  /** rebuild the unqualified-call fallback chain (stage main + boot scripts) */
  refreshFallbacks(): void {
    this.interp.fallbackScripts = [this.stageScript, ...this.bootScripts].filter(
      (x): x is ScriptInstance => !!x,
    );
  }

  /**
   * STG stage layer: flats, click regions, and transtoflat/transfromflat
   * overlays. StageController owns the logic and is addressed directly
   * (`session.stageCtrl.gotoFlat(...)`); the session keeps the shared fields
   * (stageName, currentFlat, setVisible, flatScripts, flatNames).
   */
  readonly stageCtrl = new StageController(this);
  /**
   * Enter/leave a full-screen overlay stage — by running the GAME's own
   * `transtoflat`/`transfromflat`, which is where that whole sequence lives:
   * pausing the walks and crickets, fading out, hiding the departing stage's
   * props, stacking it in savestage1..3, opening the new one and running its
   * setup, then fading back in.
   *
   * Reimplementing it would mean transcribing its two per-stage switches into
   * tables of TAOOT stage names — and reimplementing it less well: TAOOT's
   * shipped `restorescreen` handles a dead player, the unlit cabin, the guided
   * tour and the long fade after the Vlad fight, none of which a transcription
   * would.
   *
   * These stay as methods rather than becoming bare `runGlobal` calls at each
   * caller because the host, the dev bar and the suite all reach the overlay
   * system through them, and what they mean ("go to this flat") is stable even
   * though what performs it lives in the data.
   */
  transToFlat(fileName: string) { return this.runGlobal("transtoflat", [fileName]); }
  transFromFlat() { return this.runGlobal("transfromflat"); }
  /** host hook: default directional navigation from boot's keydown — the
   * currentscene("strait"/"left"/"right") setter (walk/turn). */
  onNavigate: (direction: string) => void = () => {};
  /**
   * host hook: the currentscene("sceneNNN")/currentview("viewNNN") teleport
   * setters. Unlike a direction, these name a specific scene+view to cut to —
   * the hall "cross to the other side of the ship" move toggles hallside then
   * currentscene(...)/currentview(...) to the mirrored view (HALLC.SET keydown).
   * The viewer buffers the scene and executes the jump on the paired view call.
   */
  onSceneJump: (scene: string) => void = () => {};
  onViewJump: (view: string) => void = () => {};
  /**
   * Persistent nav drivers: the viewer's real turn/walk/teleport functions,
   * always bound (unlike the on* hooks above, which are no-ops outside a
   * gesture). The scheduler arms these around a SCENE loop so a scripted camera
   * pan (BEDSIT1 gotowin turning to face the bomb) drives the camera without a
   * user gesture in flight. Set by the viewer's constructor.
   */
  navDriver: (direction: string) => void = () => {};
  sceneJumpDriver: (scene: string) => void = () => {};
  viewJumpDriver: (view: string) => void = () => {};
  /**
   * True while a user gesture (keyDown / click) is being dispatched — the window
   * in which the nav hooks above are armed. A `changeset` mid-gesture (a door
   * that leads to another set: gstair3's grand-staircase exit) builds a NEW
   * viewer; it reads this to re-arm the hooks on itself so boot's default walk
   * (`currentscene("strait")`, run later in the SAME keydown chain after the
   * script passcodes) drives the NEW viewer instead of the old, discarded one.
   */
  navGestureActive = false;
  /**
   * True while the SCHEDULER is driving navigation for a scene loop, as opposed
   * to a player's keydown or click. Only a script's moves are deferred when one
   * is already running (SetViewer.navigate): a script means every step it asks
   * for, while a player leaning on a key means the one that lands.
   */
  navFromScript = false;
  /**
   * Player setting: which of a standpoint's two versions a move lands on
   * (SetViewer.standpointFrames / SetViewer.standFrame).
   *
   * Every standpoint ships twice, low-res and hi-res (#68), and the original's
   * landings are not uniform: a RIGHT turn ends on its ring's low-res frame and
   * sharpens a beat later, a LEFT turn ends on the hi-res one, and a walk ends on
   * an in-motion frame (measured: all 722 road registers in gamefiles/en do) and
   * so lands sharp with no soft beat at all. `original` is that, and the default.
   *
   * The other three make every direction land the same way, which is #75 — the
   * asymmetry reads as a bug to players who have watched it for years, and the
   * quality change itself is what makes some people motion-sick:
   *
   *   - `sharp`      — no soft beat anywhere
   *   - `transition` — soft for one beat, then sharp, in every direction
   *   - `soft`       — the low-res standpoint, and it stays: the port's own
   *                    behaviour before #68, which is what the engine drew
   *
   * None of them can touch the movement itself: in-motion frames are
   * quarter-resolution in both rings and no hi-res version was ever made.
   *
   * Lives on the session rather than the viewer because a `changeset` builds a
   * fresh viewer and the setting has to outlive the room.
   */
  pictureMode: PictureMode = "original";
  /**
   * Player setting: how fast a move the PLAYER asked for animates (#222).
   *
   * The rate itself is not a preference — it is a number in the binary, and
   * getting it wrong by 1.8x is #205 (see `SetViewer.FRAME_MS`).
   * `original` is that number and the default, so nothing here reopens it. What
   * this adds is the choice the ORIGINAL also offered, under the name
   * `framerate`: the request (#222) is from players who get motion-sick at 20
   * fps and want either a slower walk or no transition at all, and "no
   * transition" is `framerate(0)`, which TI.EXE already means by it.
   *
   * Only the player's own moves. A script's stay at the engine step whatever
   * this says, because the scripts budget passes for the moves they ask for —
   * BEDSIT1's air raid gives a 7-frame road ten passes and no wait — so a slow
   * player would put the air raid back where #40 found it. See
   * `SetViewer.navigate` / `SetViewer.playerPace`.
   *
   * Lives on the session for the reason {@link pictureMode} does: a `changeset`
   * builds a fresh viewer and the setting has to outlive the room.
   */
  moveSpeed: MoveSpeed = "original";
  /**
   * Player setting: report a 1996 machine's free RAM, so the GAME turns itself
   * down (`heapsize`, in builtins/helpers.ts).
   *
   * Nothing in the engine reads this. BOOTFILE defines its own `lowmemory()` as
   * `heapsize() < 6144000` — under 6 MB — and five script sites branch on it:
   *
   *   - `setupdecksound` / `setupsinksound` open the `.11k` bank instead of the
   *     `.trk` one. Despite the name these are not 11 kHz: same codec, same
   *     22050 Hz, roughly HALF the loop chunks (decka 11 → 6, deckb 17 → 8,
   *     decke 20 → 10). They are the short versions of the songs, and each one
   *     calls itself by its `.trk` name inside, which is how the following
   *     `playnewtheme("decka.trk")` still finds it (see AudioLibrary.find).
   *   - `setupboatdeck` skips `crowdcrickets()` — five positional party loops
   *     around the boat deck's `life*` stars, so mission 4 loses its crowd.
   *   - `openset` and `MAP.STG`'s `openstage` zero `setparam`/`stageparam` 1 and
   *     2. Those are engine cache knobs, not anything you can see: in TI.EXE
   *     they live at 0x489f5c/0x489f5e and are read only in the set-open path
   *     (0x43aa30), where 2 gates a look-ahead load and 1 picks between two
   *     otherwise identical loaders that differ in whether the last reference
   *     dropped frees the resource. The port has its own LRU and warms its own
   *     rings, so they stay the scratch words they already were.
   *
   * So in the port everything it reaches is sound, and the page still names the
   * row for the CONDITION rather than for the result: what a small machine got
   * is the game's answer, not ours, and it is not the same answer everywhere.
   * `lowmemory()` is re-read per `openset`, so a change lands in the next room.
   */
  lowMemory = false;
  /**
   * Set by the nav hooks when any navigation (walk/turn/teleport) happens during
   * a gesture. Session-scoped (not per-viewer) so it survives a mid-gesture set
   * change: the walk fires on the new viewer but keyDown, running on the old
   * viewer, still reads it to report "we navigated" and suppress the caller's
   * default walk fallback. Reset at the start of each gesture.
   */
  navHappened = false;
  /**
   * host hook: playmovie builtin. Returns a promise that resolves when the
   * whole movie (including any chained sub-movies) finishes, so the script
   * BLOCKS on playmovie the way TI.EXE's modal movie loop does — essential for
   * interactive movies (the purser window: knock -> lid opens -> only then does
   * the script read actionframe() and open the conversation). Headless / the
   * default no-op resolve at once (movies don't render in tests).
   */
  onPlayMovie: (fileName: string, startFrame?: number) => void | Promise<void> = () => {};

  /**
   * Action-frame indices the currently/most-recently played movie reached — the
   * nonzero `action` field of every frame the movie passed through. Cleared at
   * the start of each top-level playmovie and accumulated across a chain; the
   * `actionframe(n)` opcode queries membership. (The purser's knock frame sets 1.)
   */
  movieActions = new Set<number>();

  /**
   * host hook: clut/mixclut palette effect. `dim` null restores the target's
   * normal palette (clut(target)); a spec darkens entries lo..hi toward black
   * by amt/255 (mixclut(target,"black",lo,hi,amt)). Targets: "set", "stage",
   * "current". The viewer rebuilds the rendered CLUT. (Darkroom light switch.)
   */
  onClut: (target: string, dim: { lo: number; hi: number; amt: number } | null) => void = () => {};

  // ---- save / load game (.ti) ---------------------------------------------

  /**
   * host hook: the `savegame` builtin. Present the produced `.ti` bytes to the
   * user (browser: download; native: a Save As dialog). Resolves when done.
   */
  onSaveGame: (bytes: Uint8Array, version: string) => void | Promise<void> = () => {};
  /**
   * host hook: the `opengame` builtin. Return the chosen `.ti` file's bytes, or
   * null if the user cancelled (the CTL load lever treats null as "stay put").
   */
  onLoadGame: (version: string) => Promise<Uint8Array | null> = () => Promise.resolve(null);
  /**
   * host hook: raw bytes of a base `.ti` to patch when writing a save for a game
   * that was never loaded from a file (a fresh playthrough). Saving reproduces
   * bytes by patching a real save (see `docs/engine/formats/savegame.md`); once a game
   * has been loaded, {@link lastSave} supersedes this.
   */
  saveTemplate: (() => Uint8Array | null) | null = null;
  /**
   * The container skeleton of the most recently loaded save — reused as the base
   * for the next {@link snapshotSave} so untouched containers round-trip exactly.
   */
  lastSave: RawSaveFile | null = null;

  /**
   * Which DreamFactory the game being run is, declared by the page at boot.
   *
   * The engine does not otherwise ask — a v1 set is translated into the v4 shape
   * before anything downstream sees it (`df/set-v1-to-v4.ts`), which is what
   * keeps one renderer, one interpreter and one scheduler serving both games.
   * SAVES are the exception, and unavoidably so: a save is a dump of the engine's
   * own tables, and those tables are the two engines' rather than the port's.
   *
   * Defaulted to 4, so the play page and every existing test say nothing. The
   * getter below falls back to the bound set's own version, so a headless session
   * that opened a Dust room and forgot to declare itself still saves a Dust save.
   */
  dfVersion: 1 | 4 = 4;

  /**
   * Is this a DreamFactory 5 game (RedJack)? Read off the BOOTFILE when its
   * scripts load. Only what the scripts' ids MEAN hangs on it — a handful of
   * ids v5 gave new jobs (see engine/src/df/opcodes.ts); the rooms announce
   * themselves ({@link maze}).
   */
  isV5 = false;

  /** is this a DreamFactory 1 game? — see {@link dfVersion} */
  get isV1(): boolean {
    return this.dfVersion === 1 || this.currentBinding?.set.version === 1;
  }

  /** produce the bytes of a save capturing the current progress — the
   *  logic lives in runtime/saveload.ts (and saveload-v1.ts, saveload-v5.ts).
   *  `version` is what `savegame` was given, which a v5 save stamps. */
  snapshotSave(version?: string): Uint8Array | null {
    if (this.isV5) return snapshotSaveV5(this, version || undefined);
    return this.isV1 ? snapshotSaveV1(this) : snapshotSave(this);
  }

  /** load a save (restore globals, travel to the saved room) — the restore
   *  choreography lives in runtime/saveload.ts (and saveload-v1.ts, saveload-v5.ts).
   *  `version` is what `opengame` was given, which a v5 load compares. */
  loadGame(bytes: Uint8Array, version?: string): Promise<boolean> {
    if (this.isV5) return loadGameV5(this, bytes, version || undefined);
    return this.isV1 ? loadGameV1(this, bytes) : loadGame(this, bytes);
  }

  /** does any fallback script define this handler? — {@link runGlobal} without
   *  running it, for a caller that would rather not ask at all than miss */
  hasGlobal(handler: string): boolean {
    return this.interp.fallbackScripts.some((inst) => inst.script.codes.has(handler));
  }

  /**
   * Invoke a globally-callable handler (stage/boot standard library) the way
   * unqualified script calls resolve — first fallback script that defines it.
   */
  async runGlobal(handler: string, args: Value[] = []): Promise<Value> {
    for (const inst of this.interp.fallbackScripts) {
      if (inst.script.codes.has(handler)) {
        return (await this.interp.runHandler(inst, handler, args, { me: inst.name, target: "" }))
          .value;
      }
    }
    this.onLog(`runGlobal: no handler "${handler}"`);
    return 0;
  }

  /**
   * Fire a lifecycle handler (openshop/opencast/openstage/openflat/…) on a
   * script that may not define it: run it with `me` = the owning object and
   * log — never throw — a script error under `label`. The one idiom every
   * resource open/close shares. This is NOT event traversal: an event walks a
   * chain and honours passcode/exitcode ({@link sendEvent}); a lifecycle fire
   * addresses exactly one script and only needs to survive its errors.
   */
  async fireHandler(
    inst: ScriptInstance | null | undefined,
    handler: string,
    me: string,
    label = `${me}.${handler}`,
  ): Promise<void> {
    if (!inst?.script.codes.has(handler)) return;
    if (this.restoringV5) return;
    try {
      await this.interp.runHandler(inst, handler, [], { me, target: "" });
    } catch (e) {
      this.onLog(`${label}: ${(e as Error).message}`);
    }
  }

  // ---- sets, tracks, casts and shops: SessionResources (session-resources.ts) ----
  readonly resourceCtrl = new SessionResources(this);
  get currentSetFile() { return this.resourceCtrl.currentSetFile; }
  set currentSetFile(v: string) { this.resourceCtrl.currentSetFile = v; }
  get propScripts() { return this.resourceCtrl.propScripts; }
  get castScripts() { return this.resourceCtrl.castScripts; }
  private get shopMains() { return this.resourceCtrl.shopMains; }
  typedName(...a: Parameters<SessionResources["typedName"]>) { return this.resourceCtrl.typedName(...a); }
  endAnim(...a: Parameters<SessionResources["endAnim"]>) { return this.resourceCtrl.endAnim(...a); }
  openSetFile(...a: Parameters<SessionResources["openSetFile"]>) { return this.resourceCtrl.openSetFile(...a); }
  loadSet(...a: Parameters<SessionResources["loadSet"]>) { return this.resourceCtrl.loadSet(...a); }
  rememberStarPaths(...a: Parameters<SessionResources["rememberStarPaths"]>) { return this.resourceCtrl.rememberStarPaths(...a); }
  openTrackFile(...a: Parameters<SessionResources["openTrackFile"]>) { return this.resourceCtrl.openTrackFile(...a); }
  instanceCastScript(...a: Parameters<SessionResources["instanceCastScript"]>) { return this.resourceCtrl.instanceCastScript(...a); }
  dropInstancedScript(...a: Parameters<SessionResources["dropInstancedScript"]>) { return this.resourceCtrl.dropInstancedScript(...a); }
  openCastFile(...a: Parameters<SessionResources["openCastFile"]>) { return this.resourceCtrl.openCastFile(...a); }
  closeCastFile(...a: Parameters<SessionResources["closeCastFile"]>) { return this.resourceCtrl.closeCastFile(...a); }
  shopMain(...a: Parameters<SessionResources["shopMain"]>) { return this.resourceCtrl.shopMain(...a); }
  openShop(...a: Parameters<SessionResources["openShop"]>) { return this.resourceCtrl.openShop(...a); }
  closeShop(...a: Parameters<SessionResources["closeShop"]>) { return this.resourceCtrl.closeShop(...a); }

  // ---- puppet mode (PUP conversation close-ups) ---------------------------
  // Conversation state + playback live in PuppetController, addressed directly
  // (`session.puppetCtrl.puppetSpeak(...)`). Only the active-conversation STATE
  // keeps a session accessor: `session.puppet` is read in two dozen places for
  // "is a close-up holding the screen?".
  readonly puppetCtrl = new PuppetController(this);
  get puppet() { return this.puppetCtrl.puppet; }
}
