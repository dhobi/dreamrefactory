import { SetFile, Scene, FrameInfo, Transition, ObjectEntry, RIGHTTURNS, LEFTTURNS, roadsAt, turnRing } from "@dreamfactory/engine/df/set";
import { FrameBuffer, decodeFrame, paletteToRGBA, indexedToRGBA } from "@dreamfactory/engine/df/image";
import { displayPalette, screenGammaGeneration } from "./screen-gamma";
import { ShpFrame } from "@dreamfactory/engine/df/shp";
import { ENGINE_STEP_MS, ticksAt } from "@dreamfactory/engine/runtime/clock";
import { Value } from "@dreamfactory/engine/runtime/interp";
import { SetScripts } from "@dreamfactory/engine/runtime/setscripts";
import { GameSession, MOVE_SPEED_MS } from "@dreamfactory/engine/runtime/session";
import { DrawSignature } from "@dreamfactory/engine/runtime/signature";
import { CachedFrame, RingCache } from "./ring-cache";
import { ScreenPresenter } from "./screen-presenter";
import { ClutDim, RoomLayer, ScreenDirector, dimPalette } from "./screen-director";
// the font drawstring() paints and stringwidth() measures with — one definition
// so pen advance matches the glyphs, and so both get the CJK fall-through
import { overlayFont } from "./fonts";
import { screenRules, type ScreenRules } from "./screen-rules";

/**
 * Navigation state machine over a parsed SET file. The decoded scenery frames
 * live in {@link RingCache}, a ring (turn circle / road direction) at a time.
 */

/**
 * Frame interval for turn and walk animation: one frame per service pass.
 *
 * This was 90 ms for a long time — "~11 fps, close to the original feel" — and
 * the feel it was close to was a guess. The original's rate is not a matter of
 * taste, it is a number in the binary: the frame throttle (`0x43a940`) spins
 * until `now >= lastFrame + [0x489efe]`, the tick source (`0x41de90`) is
 * `timeGetTime() * 3 / 50` so a tick is 50/3 ms, and `[0x489efe]` — what
 * `framerate()` reads and `framerate(n)` writes — defaults to **3**
 * (`0x429643`). Three ticks is **50 ms a frame, 20 fps**, which is
 * {@link ENGINE_STEP_MS}: one frame per service pass, exactly.
 *
 * The scripts corroborate it twice, because a script that moves something does
 * not watch it — it spends a fixed budget of passes and then forces the resting
 * state. BEDSIT1's air raid (container 0005, from Scene2):
 *
 *     while currentview () != "view17"      <- the TURN loop waits properly
 *         currentscene ("left")
 *         while currentview () = "moving"
 *             forceupdate ()
 *         endwhile
 *     endwhile
 *     for count = 1 to 10                   <- the ROAD gets ten passes, no wait
 *         forceupdate ()
 *     endfor
 *
 * Ten passes for a road of 7 frames (Road4, Scene2->Scene1) or 6 (Road43,
 * Scene3->Scene1): one frame per pass and a few passes' slack. At 90 ms a road
 * would spend 2n+1 passes on n frames, so the 7-frame road would want 15, and
 * the turn after it would land after `bombit` had played bedex.mov (#40). BOIL.SHP's coal
 * chute is the same shape and the same arithmetic (see `tick`, #15).
 *
 * So scripted and player moves share one constant. A player's turn at 90 ms
 * would be 1.8x slower than the original's: measured over every shipped set, 66%
 * of turns hold one in-motion frame between adjacent standpoints and 33% hold
 * two, so a press would take ~270 ms where TI.EXE takes ~150. (User-reported:
 * "when the real game TI.EXE is run in DosBox, the player movement feels much
 * faster".)
 *
 * A player may ask for a different one for their OWN moves — see {@link SetViewer.playerPace} and
 * `GameSession.moveSpeed` (#222). This stays what a SCRIPT's move is paced at,
 * whatever they ask for, because the paragraphs above are what a script's move
 * has to be paced at.
 */
const FRAME_MS = ENGINE_STEP_MS;

/**
 * Cap on ticks a move waits for a transition fade before going anyway
 * ({@link SetViewer.navigateAsExe}).
 *
 * Waits on the ENGINE's frame, never on real milliseconds, and that is the
 * whole point of the line. `session.fading` clears in `tickFade`, which steps
 * the ramp on the game clock one `ENGINE_STEP_MS` at a time — so polling it
 * with `setTimeout(r, 0)` asked a question about game time on a wall clock,
 * and the two hosts each answered wrong in their own direction:
 *
 * - Headless the pump drives one engine step per `setImmediate`, and an
 *   arbitrary, LOAD-DEPENDENT number of those fit inside the ~1 ms a
 *   `setTimeout(0)` actually takes. So the walk landed a different number of
 *   steps after the fade on every run, which is the whole of why the oracle
 *   was not deterministic: TAOOT's `gstair3` staircase exit arrives at
 *   recept1c and walks in from here, and five frames of slack there moves the
 *   frame stamp Max's `hasattention(4)` is measured from. Measured: two identical runs
 *   diverged first at `attentionspan` 15388 vs 15393 in segment 10 and every
 *   segment after it inherited the drift, and the run that lost the race
 *   failed with `gave up hunting for max in recept1c` — his puppet holding the
 *   dispatch while the navigator paced on the spot. With this on `nextFrame`
 *   the pump's own drain and this loop interleave FIFO in the check phase, one
 *   iteration per engine step, and 27 segments come out bit-identical.
 * - A browser was never measured to break here, and had no margin to spare.
 *   `MAX_FADE_WAIT_TICKS` is named in ticks and was being spent in clamped
 *   timeouts: 240 of them is roughly a second, against a `fading` that holds
 *   for the whole queue — the TAOOT corpus fades in 10 steps (500 ms) almost
 *   everywhere, but `blacktoscreen("set", 60)` is 3 s and one `screentoblack`
 *   is 120, and a to-black/to-screen pair is two ramps deep. Any of those runs
 *   the cap out while `fading` is still true, and `walk()` is gated on exactly
 *   that, so the walk would go missing rather than come late. On rAF the cap
 *   means what its name says.
 */
const MAX_FADE_WAIT_TICKS = 240;
/** DreamFactory 1: the idle machine's turns from a landing to the hi-res still (0x4335f0) */
const DF_SHARP_TURNS = 6;
/** DreamFactory 1: ticks without an event before the main loop sends event 8 (0x411698) */
const DF_QUIET_TICKS = 0x14;

/** smallest absolute difference between two angles in radians */
function angularDistance(a: number, b: number): number {
  const TAU = Math.PI * 2;
  let d = (a - b) % TAU;
  if (d < 0) d += TAU;
  return Math.min(d, TAU - d);
}

/** The session's camera hooks as they stood before a gesture armed its own —
 *  what {@link SetViewer.armNavHooks} hands back for the matching disarm. */
export interface NavHooks {
  onNavigate: (direction: string) => void | Promise<void>;
  onSceneJump: (scene: string) => void | Promise<void>;
  onViewJump: (view: string) => void | Promise<void>;
  active: boolean;
}

/**
 * The navigation state machine over a parsed SET, and one LAYER of the screen
 * rather than its owner.
 *
 * The decoded scenery frames live in {@link RingCache}, a ring (turn circle /
 * road direction) at a time. Everything that decides what reaches the canvas —
 * movies, conversation close-ups, the flat compositor, the fades, the CLUT — is
 * {@link ScreenDirector}'s, which this implements {@link RoomLayer} for. That
 * split is the subject of screen-director.ts's header: a game need not have
 * rooms at all, and *Timelapse* does not.
 */
export class SetViewer implements RoomLayer {
  /** where this engine's screen parts ways with the others (screen-rules.ts) */
  private get rules(): ScreenRules {
    return screenRules(this.session);
  }

  readonly set: SetFile;
  private palette: Uint8ClampedArray;
  /** full 256-entry set palette — props colorize through the set's CLUT. Only
   *  its lower half is the set's own once a stage flat is up; see
   *  {@link bandPropPalette} */
  private propPalette: Uint8ClampedArray;
  // Pristine baselines for the CLUT-mixing opcodes (clut/mixclut). `palette`
  // and `propPalette` above are the EFFECTIVE (possibly dimmed) versions the
  // renderer uses; these are the untouched originals to dim from / restore to.
  private readonly basePalette: Uint8ClampedArray;
  private readonly basePropPalette: Uint8ClampedArray;
  /** active dim of the set CLUT (mixclut "set"/"current"); null = normal */
  private setDim: ClutDim | null = null;
  /** active dim of the stage-flat CLUT (mixclut "stage"/"current"); null = normal */
  private readonly stageDim: ClutDim | null = null;
  /** the set's decoded scenery frames, a ring at a time (see ring-cache.ts) */
  private readonly rings: RingCache;
  /** every ring reachable from this standpoint is decoded — stop rescanning */
  private warmDone = false;

  /**
   * The presented screen — framebuffer, blits, presentation and the
   * signature-skip live in {@link ScreenPresenter}. Owned by the DIRECTOR, so it
   * outlives this viewer: a set change swaps the room, not the screen the player
   * is looking at.
   */
  get screen(): ScreenPresenter {
    return this.dir.screen;
  }

  sceneIdx = 0;
  viewIdx = 0; // index into scene.views
  showMap = false;
  showHotspots = false;

  private animation: CachedFrame[] | null = null;
  private animationPos = 0;
  /** ms per frame for the animation in flight — see {@link FRAME_MS} */
  private animationPace = FRAME_MS;
  private animationDone: (() => void | Promise<void>) | null = null;
  /** frames a pass-stepped move owes the screen, fractional below one a pass ({@link passMotion}) */
  private stepCredit = 0;
  /** low-res landings a pass-stepped turn settles on, sharpened a pass later */
  private readonly softLandings = new WeakSet<CachedFrame>();
  /** the standpoint is showing its low-res landing and is due its hi-res one */
  private sharpenNext = false;
  /**
   * DreamFactory 1: is the standpoint's HI-RES picture the one on screen —
   * DF.EXE's [0x45e51c] = 3? A move starts from it by drawing the departure's
   * low-res picture first (0x433935: step 0), and from the low-res one at step 1
   * — see {@link dfMoveFrames}.
   */
  private dfSharp = true;
  /**
   * DreamFactory 1: idle turns left before the hi-res picture replaces the
   * low-res one a move, a jump or the set's opening left on screen (0 = none
   * pending). DF.EXE's idle machine (0x4335f0) runs on event 8, which the main
   * loop sends only on a turn that took no event, and only once 20 ticks have
   * passed since it last took one (0x411698, 0x411a97 — {@link idleTurn}). It
   * caches the next move's five frames one a turn (states 0 and 1,
   * 0x433635..0x43374d), draws the hi-res still on the sixth (state 2,
   * 0x433831) and then sits in state 3. A move's every step puts it back to
   * state 0 (0x434057), and while one runs it does nothing (0x4335fc).
   */
  private dfSharpIn = 0;
  /**
   * currentscene(dir) turn/walk driver. Installed on `session.onNavigate` for
   * the duration of a user gesture (keyDown / click) so scripts can drive the
   * camera from EITHER a keydown OR a mousedown handler — TAOOT's Morrow
   * kick-out (BRIDGE.STG monkey()) turns you to face Morrow from the OK button's
   * mousedown. Installed only around the gesture, not permanently: navigation
   * calls made later from animation-arrival scripts must stay inert (the
   * original engine's default keydown owns movement).
   */
  private readonly navigate = (dir: string): void | Promise<void> => {
    this.session.navHappened = true;
    // the exes' own order: closescene run, then the move (see navigateAsExe)
    return this.navigateAsExe(dir);
  };

  /**
   * Does this room's camera move one frame a PASS? TI.EXE's frame (0x439b80)
   * steps a running turn or walk once (0x439bbb -> 0x43a440, the frame index
   * at 0x48a634) and nothing else moves it, so a move lasts as many passes as
   * it has frames, at whatever rate the passes run. DF.EXE's frame does the
   * same (0x4334c7 -> 0x433d20): one of a move's five steps a pass, the camera
   * interpolated along the grid ({@link dfMoveFrames}).
   */
  get passStepped(): boolean {
    return this.session.scheduler.scriptPaced;
  }

  /**
   * `currentscene (dir)` as TI.EXE runs it (0x407b70, en build):
   *
   *  - `"strait"` asks for a road first, and a move already running answers
   *    none (0x439ee0 -> -1), so it returns before anything is sent (0x407c99);
   *  - `closescene ()` is sent to the scene being left and RUN, before the move
   *    (0x407cbb -> 0x407e30) — a turn asked for while one is running included,
   *    because the move routine's own bail-out comes after it (0x439c2c);
   *  - a closescene that closed the set (0x407cc9) or moved the scene
   *    (0x407ce6) has the move abandoned;
   *  - then the move starts (0x439c10), drawing its first frame at once for a
   *    walk (0x439e10), and the passes step it from there ({@link passMotion}).
   */
  private async navigateAsExe(dir: string): Promise<void> {
    if (this.rules.dfMoves) return this.navigateAsDf(dir);
    const pace = this.session.navFromScript ? FRAME_MS : this.playerPace;
    if (dir === "strait" && (this.animating || !this.availableRoads().length)) return;
    const sceneIdx = this.sceneIdx;
    await this.scripts.closeScene(sceneIdx);
    if (this.session.navDriver !== this.navigate || this.sceneIdx !== sceneIdx) return;
    if (this.animating) return;
    // a transition fade queued by a changeset earlier in the chain still
    // draining (the port's fade outlives its script; TI.EXE's does not)
    for (let i = 0; i < MAX_FADE_WAIT_TICKS && this.session.fading; i++) await this.session.frameWait();
    if (dir === "strait") this.walk(pace, true);
    else if (dir === "left") this.turn(LEFTTURNS, pace, true);
    else if (dir === "right") this.turn(RIGHTTURNS, pace, true);
  }

  /**
   * `currentscene (dir)` as DF.EXE runs it (0x40ee30):
   *
   *  - `closescene ()` is sent to the scene being left and run to its end
   *    (0x40ef5b -> 0x40f100) before anything else is asked — a move already
   *    running, or one with nowhere to go, included ({@link refusedMove});
   *  - a closescene that closed the set or opened another has the move
   *    abandoned (0x40ef69, 0x40ef83 against the set it noted);
   *  - then the move routine (0x4338b0) drops it if a move is running
   *    (`[0x45e52c] >= 0`), finds no transition (0x433ae0) and does nothing, or
   *    arms step 0 or 1 ({@link dfMoveFrames}) — and draws nothing: the passes
   *    step it from the next one ({@link passMotion}).
   *
   * `"backwards"` (0x44547c, direction 4) asks for the cell behind with the
   * same facing (0x434b7a). Its closescene is sent like any other's, but no
   * set on the disc has a transition that goes there — every one of the 486
   * walks in the 35 sets steps forward — so the move routine finds nothing
   * (0x433ae0) and the camera stays.
   */
  private async navigateAsDf(dir: string): Promise<void> {
    const pace = this.session.navFromScript ? FRAME_MS : this.playerPace;
    await this.scripts.closeScene(this.sceneIdx);
    if (this.session.navDriver !== this.navigate) return;
    if (this.animating) return;
    for (let i = 0; i < MAX_FADE_WAIT_TICKS && this.session.fading; i++) await this.session.frameWait();
    if (dir === "strait") this.walk(pace, true);
    else if (dir === "left") this.turn(LEFTTURNS, pace, true);
    else if (dir === "right") this.turn(RIGHTTURNS, pace, true);
  }

  /**
   * ms per animation frame for a move the PLAYER asked for — their own setting
   * (#222), which is {@link FRAME_MS} unless they have moved it.
   *
   * Read per move rather than held, so a change lands on the next press instead
   * of in the next room, and so a `changeset` (which builds a whole new viewer)
   * has nothing to carry over: the answer lives on the session.
   *
   * A SCRIPT's move does not come through here. See {@link navigate}.
   */
  private get playerPace(): number {
    return MOVE_SPEED_MS[this.session.moveSpeed];
  }

  /** buffered currentscene("sceneNNN") teleport target, consumed by the paired
   *  currentview("viewNNN"). Reset at the start of every input gesture. */
  private pendingJumpScene: string | null = null;
  private readonly sceneJump = (scene: string): void | Promise<void> => {
    this.session.navHappened = true;
    if (this.rules.jumpsAtOnce) return this.jumpV1(scene, null);
    this.pendingJumpScene = scene;
  };
  private readonly viewJump = (view: string): void | Promise<void> => {
    this.session.navHappened = true;
    if (this.rules.jumpsAtOnce) return this.jumpV1(null, view);
    const scene = this.pendingJumpScene;
    this.pendingJumpScene = null;
    this.teleport(scene, view);
  };

  /**
   * DreamFactory 1's named jump: each setter moves on its own, and runs the
   * scene events itself, before the script's next line.
   *
   * `currentscene (name)` is DF.EXE 0x40ee30: a scene it cannot find, or the
   * scene you are already in (0x40efaa, row and column against 0x460ba0 /
   * 0x460b9e), does nothing. Otherwise it sends `closescene ()` to the scene
   * being left (0x40f100, which builds `"<scene>", closescene()` and runs it
   * through sendtoscene's 0x40f610 at once), gives up if that changed the set
   * (0x40efff), moves the camera to the new row and column with the DIRECTION
   * kept (0x433960 with -1), and sends `openscene ()` to the scene arrived in
   * (0x40f050, the same with 0x445490 `", openscene()"`).
   *
   * `currentview (dir)` is 0x410170, the same shape: facing that way already
   * (0x410270, against 0x460ba2) does nothing, and a turn runs closescene,
   * 0x433960(-1, -1, dir) and openscene.
   *
   * Nothing is buffered — `currentscene` without a `currentview` moves you, as
   * MINE.SET's wrap-around (`currentscene ("scene e3")` then `("strait")`)
   * needs — and nothing is left to run later: `NEW.FLT`'s demo jumps with
   * `randomscene ()` and then opens a puppet, and TOWN.SET's openscene has
   * already had its chance at the robbery by then.
   */
  private async jumpV1(sceneName: string | null, viewName: string | null): Promise<void> {
    const targetScene = sceneName
      ? this.set.scenes.findIndex((s) => s.sceneName.toLowerCase() === sceneName.toLowerCase())
      : this.sceneIdx;
    if (targetScene < 0) return;
    const scene = this.set.scenes[targetScene];
    // the view kept, or the one asked for, by its direction's name
    const want = viewName ?? this.scene.views[this.viewIdx]?.viewName ?? "";
    const v = scene.views.findIndex((vw) => vw.viewName.toLowerCase() === want.toLowerCase());
    if (viewName !== null && v < 0) return;
    const changed = targetScene !== this.sceneIdx || (v >= 0 && v !== this.viewIdx);
    if (!changed) return;
    // A jump made from inside openscene or closescene runs them again, nested,
    // as DF.EXE's does: neither setter asks whether a scene event is running.
    // What ends it is the "already there" test above (0x40efaa, 0x410270) —
    // HOTUPPER.SET's Scene C4 turns you north from its openscene, and the
    // openscene that turn runs asks again and finds you facing north — and the
    // set check below (0x40efff). See dust/tests/machine/lifecycle-jump.ts for
    // the Dust handlers that jump this way.
    await this.scripts.closeScene(this.sceneIdx);
    // closescene took you to another set: the jump is over (0x40efff)
    if (this.session.sceneJumpDriver !== this.sceneJump) return;
    // and if it jumped within the set, the move goes from where it left you:
    // 0x433960 is handed -1 for whatever this setter does not name, which is
    // the camera's position (or direction) NOW
    const to = sceneName ? targetScene : this.sceneIdx;
    const toScene = this.set.scenes[to];
    const keep = viewName ?? this.scene.views[this.viewIdx]?.viewName ?? "";
    const w = toScene.views.findIndex((vw) => vw.viewName.toLowerCase() === keep.toLowerCase());
    this.sceneIdx = to;
    this.viewIdx = w >= 0 ? w : Math.min(this.viewIdx, toScene.views.length - 1);
    // 0x433960 ends a move in flight (0x433ac7: the step back to -1, so its
    // arrival never comes) and draws the new standpoint's LOW-res picture, step
    // 0 of a transition out of it (0x433a87 -> 0x433d20); the idle machine
    // sharpens it from state 0 (0x434057), six idle turns on
    if (this.dfStepped) {
      this.animation = null;
      this.animationDone = null;
      this.dfLanded();
    }
    this.showView();
    await this.scripts.openScene(this.sceneIdx);
  }

  /**
   * Arm this viewer's nav hooks on the session for the duration of a gesture,
   * and answer the hooks that were live so {@link disarmNavHooks} can put them
   * back. A `changeset` mid-gesture (a door to another set) builds a fresh
   * viewer and re-arms on itself (see the host's activateSet), so the boot's
   * default walk — `currentscene("strait")`, run later in the SAME keydown chain
   * because the script passcodes — drives the arrived-in set (TAOOT: gstair3's
   * grand-staircase exit teleports to recept1c's arrival scene, then walks into
   * the reception hall).
   */
  /**
   * Point the NAMED jump hooks at this viewer, for as long as it is the room.
   *
   * `currentscene ("sceneNNN")` + `currentview ("viewNNN")` is a teleport, and a
   * teleport is not a MOVE. The gesture gate exists to keep an arrival script's
   * `currentscene ("right")` from driving the camera after the keypress that
   * owns movement is over — that is #47, Scotland Road, and every case the
   * disarm's own note cites is a DIRECTION. A name is the script saying where
   * you are, which is the one thing only it can know.
   *
   * `NEW.FLT/0001 initall` is where the difference shows. It saves the
   * standpoint, swaps the day town for the night one, and puts the standpoint
   * back:
   *
   *     if currentset () = newname
   *         thescene = currentscene ()
   *         thedir = currentview ()
   *     endif
   *     ... opensetfile (newset)
   *     if thescene != 0
   *         currentscene (thescene)
   *         currentview (thedir)
   *     endif
   *
   * The restore runs from a `sendtostage` chain that outlives the openscene it
   * was spawned from, so by the time it lands `navGestureActive` is false and
   * both calls went nowhere: Dust's day-4 night arrived at nite.set's default
   * `scene g15` facing north where the original's own save says `scene g5`
   * facing south. Measured — the reads were correct, `scene g5` and `south`; it
   * was the writes that were inert.
   *
   * Runaway jumps are held off by something other than this gate, which is
   * why lifting it here is safe: in DreamFactory 4 by {@link
   * SetScripts.inLifecycle} inside {@link teleport}, and in DreamFactory 1 by
   * DF.EXE's own "already there" tests ({@link jumpV1}), which end the Dust
   * openscene handlers that jump — `hotupper.set`'s among them, which once hung
   * the tab — one level down.
   */
  bindJumpHooks(): void {
    this.pendingJumpScene = null;
    this.session.onSceneJump = this.sceneJump;
    this.session.onViewJump = this.viewJump;
  }

  armNavHooks(): NavHooks {
    const prev: NavHooks = {
      onNavigate: this.session.onNavigate,
      onSceneJump: this.session.onSceneJump,
      onViewJump: this.session.onViewJump,
      active: this.session.navGestureActive,
    };
    this.pendingJumpScene = null;
    this.session.navGestureActive = true;
    this.session.onNavigate = this.navigate;
    this.session.onSceneJump = this.sceneJump;
    this.session.onViewJump = this.viewJump;
    return prev;
  }

  /**
   * End a gesture's nav hooks, so navigation stays scoped to keydown/click and
   * arrival scripts calling currentscene() stay inert.
   *
   * Put back what `armNavHooks` found rather than writing no-ops, because
   * gestures NEST. A modal movie is dismissed by a click, and that click is a
   * gesture of its own — press -> clickDispatch -> movies.click — running while
   * the script that opened the movie is still suspended inside `spotmovie`. So
   * writing no-ops, the inner press would tear down the outer press's hooks and
   * hand the script back a dead camera for the rest of its life.
   *
   * That is #47, Scotland Road. SCOT3's rope close-up ends in
   *
   *     spotmovie ("scotrope.mov")
   *     ...
   *     while currentview () != "view22"
   *         if currentview () != "moving"
   *             currentscene ("right")
   *         endif
   *         forceupdate ()
   *     endwhile
   *
   * to turn you to Hacker before he speaks. Dismiss the close-up and every
   * `currentscene("right")` after it would go to a no-op, so view22 never comes
   * round: the room stops answering with the player still facing the rope —
   * "as if waiting for Hacker to turn me and talk, but he never does". Measured
   * headless: 3000 service steps, 1494 turns asked for and not one taken; with
   * the hooks restored the turn lands on the 12th ask and hack1.pup opens.
   *
   * The scheduler's own {@link Scheduler.withNavDriversArmed} has always been a
   * save/restore pair for this reason. This is the same rule at the other entry
   * point.
   */
  disarmNavHooks(prev?: NavHooks): void {
    this.session.navGestureActive = prev?.active ?? false;
    this.session.onNavigate = prev?.onNavigate ?? (() => {});
    // the NAMED jump outlives the gesture — see bindJumpHooks
    this.session.onSceneJump = prev?.onSceneJump ?? this.sceneJump;
    this.session.onViewJump = prev?.onViewJump ?? this.viewJump;
  }

  /**
   * Instant cut to a named scene/view within the current set — the
   * currentscene("sceneNNN")/currentview("viewNNN") setter pair. In the engine
   * these are pure index setters, NOT a lifecycle trigger: TAOOT's hall
   * crossover cuts to the mirrored view and then PASSCODEs, so boot's default
   * keydown walks you forward from there (owning the arrival lifecycle). So we only
   * reposition here — synchronously, so a following walk() reads the new spot —
   * and recompute the arrow/sign for the case where no walk follows (a dead-end
   * cut). Firing closescene/openscene here would double up with, and race, that
   * boot walk's own arrival lifecycle.
   */
  private teleport(sceneName: string | null, viewName: string): void {
    const targetScene = sceneName
      ? this.set.scenes.findIndex((s) => s.sceneName.toLowerCase() === sceneName.toLowerCase())
      : this.sceneIdx;
    if (targetScene < 0) return;
    const scene = this.set.scenes[targetScene];
    const v = scene.views.findIndex((vw) => vw.viewName.toLowerCase() === viewName.toLowerCase());
    const changed = targetScene !== this.sceneIdx || (v >= 0 && v !== this.viewIdx);
    this.sceneIdx = targetScene;
    this.viewIdx = v >= 0 ? v : this.viewIdx;
    this.showView();
    // A jump made from INSIDE the scene lifecycle moves you and stops there.
    // Asking for the event again from within its own dispatch is a loop the
    // original cannot have — it pops one event at a time — and Dust has
    // fourteen openscene handlers that jump. `hotupper.set`'s hangs the tab
    // outright: see SetScripts.inLifecycle for the walk-through.
    if (this.scripts.inLifecycle) return;
    // A JUMP is a standpoint change and owes the same scene event a turn does.
    //
    // Boot's closescene is the only thing in the corpus that puts the shared
    // `door` prop away:
    //
    //     code closescene ()
    //         propview ("navarrow", "red")
    //         if propvisible ("door")
    //             sendtoprop ("door", initprop ())
    //         endif
    //
    // One prop serves every doorway in the game (house.shp): `setupprop(where)`
    // shows it in that doorway's state at a fixed screen position, and only
    // closescene closes it again. So a jump that skipped the event left an open
    // door drawn over a view it does not belong to — GSTAIR3's purser's office,
    // which you leave with the door still open:
    //
    //     code dopurser ()
    //         ... the office ...
    //         currentscene ("scene14")
    //         currentview ("view37")
    //         blacktoscreen ("set", 10)
    //
    // and View37 is down the corridor, so the door hung in mid-air beside the
    // stairs (#71). The jump stays inside Scene14, so it is the VIEW changing
    // that owes the event, not the scene.
    if (!changed) {
      // nothing was left, so only the arrival is owed — see viewSettled
      void this.session.track(this.scripts.viewSettled(this.sceneIdx));
      return;
    }
    void this.session.track(
      (async () => {
        await this.scripts.viewChanged(this.sceneIdx);
      })(),
      "jump-viewChanged",
    );
  }
  private lastTick = 0;
  private current: CachedFrame | null = null;

  /**
   * The screen this room is one layer OF: the movie player, the conversation
   * view, the fades, the CLUT and the compositor all live there, and this class
   * reaches them through it. screen-director.ts says why none of them is a
   * room's to own.
   */
  readonly dir: ScreenDirector;

  onHud: (text: string) => void = () => {};
  onLog: (line: string) => void = () => {};
  readonly scripts: SetScripts;

  readonly session: GameSession;

  constructor(
    set: SetFile,
    session: GameSession,
    startScene = "",
    startView = "",
    /**
     * The screen to be a layer of. The host passes its one persistent director;
     * a caller without one (tests driving a bare viewer, `tools/navdump.ts`)
     * gets a private screen with the same behaviour.
     */
    director: ScreenDirector | null = null,
  ) {
    this.set = set;
    this.session = session;
    this.rings = new RingCache(set);
    this.dir = director ?? new ScreenDirector(session);
    this.dir.onLog = (l) => this.onLog(l);
    // the movie player reveals the settled view once a movie sequence ends, and
    // this room is what it reveals
    this.dir.onRoomReveal = () => this.showView();
    this.basePalette = paletteToRGBA(set.paletteRaw, set.colorCount);
    this.basePropPalette = paletteToRGBA(set.paletteRaw, 256);
    this.palette = displayPalette(this.basePalette);
    this.propPalette = displayPalette(this.basePropPalette);
    // ...and this room is the layer it composites. A host that owns the director
    // does this itself on activation (GameHost.activateSet) and undoes it on
    // release; a bare viewer with a director of its own has to say so here.
    if (!director) this.dir.setRoom(this);
    // a bare viewer is its own room, so it owns the named jump too
    if (!director) this.bindJumpHooks();
    this.scripts = new SetScripts(set, session);
    this.scripts.onLog = (l) => this.onLog(l);
    session.currentSceneName = () => (this.dfMovingScene() ?? this.scene).sceneName.toLowerCase();
    // currentview() returns the pseudo-view "moving" while the camera is
    // animating a turn/walk (this.animation in flight), matching TI.EXE — a
    // scripted camera pan waits it out with `while currentview()="moving":
    // forceupdate()` (the bomb window pan, BEDSIT1 gotowin). Only once the
    // motion settles does it report the arrived view name.
    session.currentViewName = () => {
      if (!this.animating) return this.scene.views[this.viewIdx].viewName.toLowerCase();
      // DF.EXE (0x410500) names the bearing of the step last drawn: one of the
      // four is "moving" while a move runs, anything between "turning"
      // (0x410530 -> 0x41054d) — so a turn is "turning" from its second step
      const deg = this.current?.cam?.deg;
      return this.dfStepped && deg !== undefined && deg % 64 !== 0 ? "turning" : "moving";
    };
    session.currentRotation = () => this.scene.views[this.viewIdx].rotation;
    // DF.EXE's `currentdeg ()` (0x410740) answers [0x460baa], the bearing the
    // camera builder wrote for the step last drawn (0x433f8b) — mid-move, the step's
    session.movingDeg = () => {
      const deg = this.animating && this.dfStepped ? this.current?.cam?.deg : undefined;
      return deg ?? null;
    };
    // Persistent nav drivers (the real turn/walk/teleport functions). armNavHooks
    // exposes these as the onNavigate/onSceneJump/onViewJump hooks only during a
    // user gesture; the scheduler arms them independently around a SCENE loop so a
    // scripted camera pan (BEDSIT1 gotowin turning to face the bomb) can drive the
    // camera even though no keydown/click is in flight.
    session.navDriver = this.navigate;
    session.sceneJumpDriver = this.sceneJump;
    session.viewJumpDriver = this.viewJump;
    // canonical set identity = the opened file's basename (see SetScripts)
    session.propRuntime.currentSet = session.currentSetName;
    session.actorRuntime.currentSet = session.currentSetName;
    // remember this set's stars by name, so a script running in another room can
    // still walk somebody here (GameSession.starRegistry)
    for (const a of set.actors) session.starRegistry.set(a.identifier.toLowerCase(), a);
    // ...and put this set's cast and props on their stars, as the engines' set
    // open does before `openset` runs — not on a load, which rebuilds the room
    // without it and keeps the saved positions (ActorRuntime.settleStars)
    if (!session.restoringSave) {
      session.actorRuntime.settleStars(set.actors);
      session.propRuntime.settleStars(set.actors);
    }
    // crickets attenuate/pan against the camera's ground position + facing
    session.listener = () => {
      const sc = this.scene;
      const v = sc?.views[this.viewIdx];
      return v ? { x: sc.xAxisMap, y: sc.zAxisMap, deg: v.rotation8 } : null;
    };
    // ...and the whole camera, for `actordist`: what it answers is whether the
    // actor would be DRAWN through this camera, not how far away they are (#180).
    session.activeCamera = () => this.roomCamera();
    // `hittest` and the two point predicates are the DIRECTOR's: it owns the prop
    // step, the stage step and the fallthrough, and asks this room only for its own
    // zone ({@link roomHitTest}). See the wiring in screen-director.ts.
    // stringwidth() measures against the same font drawTextOverlay paints with
    if (typeof document !== "undefined") {
      const mctx = document.createElement("canvas").getContext("2d");
      if (mctx) {
        session.measureText = (text, size) => {
          mctx.font = overlayFont(size);
          return mctx.measureText(text).width;
        };
      }
    }
    // DF.EXE opens a set through the jump (0x41b3e1 -> 0x433960): the
    // standpoint's LOW-res picture first, sharpened by the idle machine
    if (this.dfStepped) this.dfLanded();
    this.jumpToDefault();
    if (startScene) this.jumpTo(startScene, startView);
    // auto-load sibling resources (the boot script does this in the real game)
    const base = set.setName.toLowerCase();
    for (const bank of [`${base}.trk`, `${base}.sfx`, `${base}.11k`, "unilib.trk"]) {
      const data = session.files(bank);
      if (data) session.audioLib.openBank(bank, data);
    }
    if (session.audioLib.bankNames.length) {
      this.onLog(`audio banks: ${session.audioLib.bankNames.join(", ")}`);
    } else {
      this.onLog(
        `no audio banks — drop UNILIB.TRK and ${base.toUpperCase()}.TRK/.SFX alongside the .SET to hear sound`,
      );
    }
  }

  /**
   * Fire the set's opening lifecycle (openset → openscene). Separate from
   * the constructor because handlers can suspend (delay) or change the set
   * again — the host awaits this from its onSetChange hook.
   *
   * A set does NOT bring a shop of its own name with it. Entering a room used
   * to `openshopfile("<setname>.shp")` here, which is why every log in the game
   * carries a line like `openshopfile: "gstair3.shp" not available` — for almost
   * every room the file does not exist. Five do: boil, cargo, turk, wireless and
   * bridge. Every one of those five is the close-up STAGE's shop, opened by that
   * stage's own `openstage` and closed by its `closestage` (BOIL.STG 0001:3/9,
   * and the same two lines in the other four) — never by the room.
   *
   * Opening them early put the close-up's controls into the room. They are
   * SCREEN-space props that `openshop` parks at 256,192 and makes visible
   * (BOIL.SHP: boilbag, boildoor, boilswitch), and the set view only kept them
   * off screen because it draws boot-UI shops alone. Open any overlay — the CTL
   * save panel — and that filter lifts: the coal-chute door and the cargo hold's
   * painting crate drew over the menu in the panel's own palette and stayed
   * clickable, and clicking the painting handed it to you in mission 1, which
   * has no way back (#17, #18).
   */
  async start(): Promise<void> {
    const from = this.sceneIdx;
    const opened = await this.scripts.openSet();
    // A load restores the room rather than arriving in it, and the original fires
    // no scene entry for one — see GameSession.restoringSave. The scene is still
    // recorded as current, so the first turn or step re-fires it normally.
    if (this.session.restoringSave) {
      this.scripts.lastSceneIdx = this.sceneIdx;
      return;
    }
    /**
     * DreamFactory 1 opens a set in this order, and asks between the events
     * whether you are still where it started. `opensetfile` (0x40e9b0) reads the
     * set (0x40ea80), places the camera at its row, column and direction
     * (0x433960 at 0x40ea50, which the constructor's jumpToDefault is), then
     * 0x40f1b0 sends the events: it notes the set and the camera's CELL
     * ([0x460bb4]/[0x460bb2], written with the bearing by the camera builder at
     * 0x433fdb), sends `openset ()` (0x40fcd0), and stops if the set is gone or
     * the cell moved (0x40f21b–0x40f26b); sends `<floor>, openfloor ()` (0x40f950;
     * no Dust script handles it, so the port does not send it) and asks again
     * (0x40f2b0–0x40f301); and last sends `"<scene>", openscene ()` (0x40f530).
     * There is no openview. The bearing is not asked: DOCTOR2.SET's openset
     * turns you south on day 3 (`currentview ("south")`, which runs closescene,
     * the turn and openscene itself — SetViewer.jumpV1), and the set's own
     * openscene then runs for the same scene a second time. A jump to another
     * scene, or another set, from openset ends it with no second openscene.
     */
    if (this.rules.openSetJumpEndsOpening && (this.session.sceneJumpDriver !== this.sceneJump || this.sceneIdx !== from)) return;
    /**
     * TI.EXE's opening (0x407ea0, en build) asks too, and only about the set:
     * `openset ()` (0x407eca), and an error ends it there; then, if the set was
     * closed or another opened in its place (0x407ed7, 0x407ee6 against the set
     * handle it noted), no `openscene ()` (0x407f45) for this one.
     */
    if (!this.rules.openSetJumpEndsOpening && (!opened || this.session.currentBinding !== this.scripts)) return;
    await this.scripts.openScene(this.sceneIdx);
  }

  /** the view of `scene` whose facing is angularly closest to `rotation` —
   *  the continuity rule shared by stale-name jumps and road arrival */
  private nearestView(scene: Scene, rotation: number): number {
    let best = 0;
    let bestDist = Infinity;
    scene.views.forEach((vw, i) => {
      const d = angularDistance(vw.rotation, rotation);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  /**
   * Position at a named scene/view (case-insensitive) — and NOTHING else.
   *
   * No scene lifecycle: no closescene, no openscene, no `viewChanged`. That is
   * right for its one caller in the engine, the constructor placing the camera at
   * a set's start scene before {@link start} runs the lifecycle over it. It is
   * also why this is not the scripted jump: `currentscene()`/`currentview()` as
   * setters go through `onSceneJump`/`onViewJump` to {@link teleport}, which fires
   * the event a standpoint change owes (#71 — the purser's door, left hanging down
   * the corridor when it did not).
   *
   * Which makes it a trap for a TEST: `openscene` is a per-VIEW event that 33 of
   * the 51 shipped handlers gate on `currentview()`, so anything asserted about
   * view-gated behaviour after a `jumpTo` is asserted against a state the game
   * cannot arrive in. Diagnosing that way reports defects that do not exist
   * (#96): the flag under test still holds the value the set's opening
   * `openScene` left, because nothing here recomputes it, and 200 further engine
   * steps of watching it never would.
   *
   * A test that owes the lifecycle should drive the script path — `armNavHooks()`,
   * then `onSceneJump`/`onViewJump` — the way the #71 regression test does.
   */
  jumpTo(sceneName: string, viewName = ""): boolean {
    const s = this.set.scenes.findIndex(
      (sc) => sc.sceneName.toLowerCase() === sceneName.toLowerCase(),
    );
    if (s < 0) return false;
    const scene = this.set.scenes[s];
    let v = viewName
      ? scene.views.findIndex((vw) => vw.viewName.toLowerCase() === viewName.toLowerCase())
      : -1;
    if (v < 0 && viewName) {
      // authored view names can be stale (TAOOT: gstair3's changeset targets
      // the typo "view79" in scene65): keep the current facing direction, the
      // same continuity rule road arrival uses. Across a set change the
      // previous viewer's facing is carried in session.lastRotation.
      const rot = this.session.lastRotation ?? this.scene?.views[this.viewIdx]?.rotation;
      this.session.lastRotation = null;
      if (rot !== undefined && rot !== null) v = this.nearestView(scene, rot);
    }
    this.sceneIdx = s;
    this.viewIdx = Math.max(0, v);
    this.showView();
    return true;
  }

  /**
   * The key, once the screen has had its say: this room's own script chain.
   *
   * The chain above it — a movie, a suspended conversation, the queue, the
   * `inputLocked` gate, a stage that handles its own keys — is
   * {@link ScreenDirector.keyDown}'s, because every one of those is true of a
   * game with no rooms too.
   */
  async roomKeyDown(keyName: string): Promise<boolean> {
    this.session.navHappened = false;
    const prevHooks = this.armNavHooks();
    try {
      const consumed = await this.scripts.keyDown(this.sceneIdx, keyName);
      // navHappened is session-scoped so a mid-gesture changeset (a door to
      // another set) that walks on the NEW viewer still reports back here — we
      // return consumed so the caller's default-walk fallback stays suppressed.
      return consumed || this.session.navHappened;
    } finally {
      this.disarmNavHooks(prevHooks);
    }
  }

  /** the whole key gesture — {@link ScreenDirector.keyDown}, delegated */
  keyDown(keyName: string, special = false): Promise<boolean> {
    return this.dir.keyDown(keyName, special);
  }

  /**
   * One press of a movement arrow — the whole gesture, script chain included.
   *
   * All three arrows go through the scripts FIRST. A boot's first script routes
   * the key to the scene (`sendtoscene(currentscene(), keydown(arg))`) and its
   * second script's keydown is the default move at the end of the chain —
   * uparrow → `currentscene("strait")`, leftarrow/rightarrow →
   * `currentscene("left"/"right")`. So turning is a *scripted* action in the
   * original, and a set can intercept it.
   *
   * Exactly one TAOOT set does: STAIR2C (the 2nd class staircase) is the only
   * SET in that game whose keydown takes leftarrow/rightarrow. Its two landing scenes
   * have eight views — the four standpoints interleaved with four in-between
   * corners — so it turns TWICE per press and exitcodes, which is what keeps you
   * off the corners. Turning the viewer directly from the key handler skipped
   * that: half your stops became corners where the nav arrow is red and forward
   * does nothing, and the first arrow that isn't red as you turn away from the
   * landing's corridor became View51's green — the flight UP, one deck. So
   * trying to walk down the ship walked you up it, until the deck wrap ran out
   * at A deck and the flight above the landing let you out on the boat deck.
   * Same bypass dropped the landing's `runcsea()` cue and boot1's `lockevents`
   * gate.
   *
   * The engine default only runs when nothing consumed the key, which is how a
   * set with no boot (the dev set picker) still walks and turns.
   *
   * A press made while a move is already running is QUEUED, not dropped — that
   * lives in {@link keyDown} now, so the movement LETTERS queue the same way.
   */
  async pressNav(key: "uparrow" | "leftarrow" | "rightarrow"): Promise<void> {
    // A press made while a FADE ramps is QUEUED and taken once the fade is over
    // (ScreenDirector.keyNow / inputDrainable), as TI.EXE's synchronous fade loop
    // leaves it in the OS queue. It used to be dropped: segment 23 pressed up at
    // TAOOT ENGINE.SET's View120 while the fight's closing fade was ramping and no
    // keydown handler ran at all, so the smokestack was never entered.
    if (await this.keyDown(key)) return;
    if (key === "uparrow") this.walk();
    else this.turn(key === "leftarrow" ? LEFTTURNS : RIGHTTURNS);
  }


  // ---- movies (playback lives in movie-player.ts) --------------------------

  get moviePlaying(): boolean {
    return this.dir.movies.playing;
  }

  /** which clip is on screen (lowercase), or null — see MoviePlayer.playingFile */
  get movieFile(): string | null {
    return this.dir.movies.playingFile;
  }

  /** play a movie modally — resolves when the whole chain ends (MoviePlayer) */
  playMovie(fileName: string, startFrame = 0): Promise<void> {
    return this.dir.movies.play(fileName, startFrame);
  }

  /** the game is being replaced under this viewer — see MoviePlayer.abandon */
  abandonMovie(): void {
    this.dir.movies.abandon();
  }



  // -------------------------------------------------------------------------
  // The {@link RoomLayer} contract — what the screen asks a room for.
  //
  // Accessors rather than public fields, because the director must not be able
  // to write any of it: a palette here is replaced wholesale by
  // {@link applyRoomClut} and hashed by identity, and a frame is the ring
  // cache's to hand out.
  // -------------------------------------------------------------------------

  /** a v1 room merges actors and world props into one depth-sorted list (RoomLayer) */
  get spritesByDepth(): boolean {
    return this.set.version === 1;
  }

  /** is the camera mid-turn, mid-walk or mid-road? */
  get roomAnimating(): boolean {
    return this.animating;
  }

  /** the view frame on the screen now, or null before the first settle */
  roomFrame(): CachedFrame | null {
    return this.current;
  }

  /**
   * A frame that ran no tick (#542): take a queued gesture exactly where
   * {@link advanceRoom} would, and move nothing — no animation is advanced or
   * started on its clock here, so nothing anchors on a frame one host draws and
   * another does not.
   */
  takeInputOnly(): CachedFrame | null {
    if (!this.animation && !this.dir.movingCamera && this.session.events.length) this.drainOneEvent();
    return this.current;
  }

  /** the view's own palette, dim and gamma applied */
  roomPalette(): Uint8ClampedArray {
    return this.palette;
  }

  /** the palette this room's props colorize through */
  roomPropPalette(): Uint8ClampedArray {
    return this.propPalette;
  }

  /**
   * `clut("set")` / `mixclut("set", …)`: rebuild this room's palettes.
   *
   * The set half of the CLUT work — the stage half,
   * and the decision about which target a bare `clut("current")` means, are the
   * director's, because the stage outlives any one room.
   *
   * Rebuilt EAGERLY (both the view's palette and the props') where the stage dim
   * is applied at render time: a flat's palette is cached per name and must not
   * be mutated, and a room's is this object's own.
   */
  applyRoomClut(dim: ClutDim | null): void {
    this.setDim = dim;
    this.palette = displayPalette(dim ? dimPalette(this.basePalette, dim) : this.basePalette);
    this.propPalette = displayPalette(
      dim ? dimPalette(this.basePropPalette, dim) : this.basePropPalette,
    );
  }

  /**
   * The CLUT the world sprites colorize through while a stage flat is
   * composited with the room view — the set's own colours below
   * {@link SetFile.colorCount}, the STAGE's above it.
   *
   * TI.EXE has one screen CLUT and the two halves of it come from different
   * files. A set supplies only its own, and that is not an inference: the loop
   * that copies a set's palette block (container 0 + 0xf2, 8 bytes an entry)
   * runs from the entry in `0x48a00c` to the one in `0x48a00e` (0x440cc2), and
   * the startup block seeds those with 0 and 0x80 (0x429723, 0x4296e4) — so
   * `opensetfile` writes CLUT entries 0..127 and never touches the rest. It
   * agrees with the art: of the 75 sets on the two discs, 72 draw their views
   * from 0..127 alone and the three that stray (c73, lnghall on either disc) do
   * so on under 0.06% of their pixels.
   *
   * Everything in the interface band lives in the half above: main.stg's flat
   * art is entirely >=128 bar 499 pixels of index 0, and so is every HUD prop
   * in house.shp — the pocketwatch, the bag, the deck map, the lifebuoy, the
   * `light` plate and the nav arrow are all 97%-100% up there, while the props
   * authored per room (house.shp's `door` and `plant`, and each room's own
   * shop) are 48%-99.8% below it.
   *
   * Taking all 256 from the set looks equivalent because 74 of the 75 carry a
   * byte-identical copy of main.stg's upper half — dead bytes in TI.EXE, which
   * is how one of them can drift without anyone noticing. bridge.set is that
   * one: its copy is uniformly darker (median 0.82x the red channel), so the
   * band's `light` plate, a solid 251x120 rectangle, would stop matching the
   * flat it is drawn over and the middle third of the band grow a seam down both
   * sides of it (#158, seen in the guided tour and only there).
   *
   * Memoised like {@link flatPalette}, and on the same three things plus which
   * stage's palette it composed: this runs on every frame that draws a band.
   */
  private worldPal: { stage: Uint8ClampedArray; dim: ClutDim | null; gen: number;
                      out: Uint8ClampedArray } | null = null;
  bandPropPalette(stageBase: Uint8ClampedArray): Uint8ClampedArray {
    const gen = screenGammaGeneration();
    const hit = this.worldPal;
    if (hit?.stage === stageBase && hit.dim === this.setDim && hit.gen === gen) return hit.out;
    const composed = this.basePropPalette.slice();
    composed.set(stageBase.subarray(this.set.colorCount * 4), this.set.colorCount * 4);
    const out = displayPalette(this.setDim ? dimPalette(composed, this.setDim) : composed);
    this.worldPal = { stage: stageBase, dim: this.setDim, gen, out };
    return out;
  }

  /** the gamma the effective palettes were built at (see screen-gamma.ts) */
  private paletteGen = screenGammaGeneration();
  /**
   * Rebuild the effective set/prop palettes when the player has moved the display
   * gamma (F1-F9, or the brightness control).
   *
   * The bases stay raw, so this is the same expression `setClut` uses — dim first,
   * then gamma. Replacing the arrays is also what makes the change VISIBLE:
   * `buildSignature` refs both palettes by identity, so a new one is a repaint,
   * and without that the picture would not change until the next camera move.
   */
  refreshRoomGamma(): void {
    const gen = screenGammaGeneration();
    if (gen === this.paletteGen) return;
    this.paletteGen = gen;
    const dim = this.setDim;
    this.palette = displayPalette(dim ? dimPalette(this.basePalette, dim) : this.basePalette);
    this.propPalette = displayPalette(dim ? dimPalette(this.basePropPalette, dim) : this.basePropPalette);
  }

  /** start looping background music if a theme bank is available */
  startTheme(): void {
    // Authentic theme control lives in the boot library (TAOOT: setupsound()),
    // which openset runs from viewer.start(): it plays the REGION theme
    // (TAOOT names tracks by deck, not by set: recept1c -> deckd.trk, halla ->
    // decka.trk) and, just as important, LEAVES the theme untouched when the
    // region is unchanged, so same-deck travel (halla -> lnghall) keeps
    // decka.trk playing seamlessly.
    // Don't fight it: never replace an already-playing theme, and never fall
    // back to "any loaded bank" (that bleeds inven/unilib over the room). Only
    // best-effort start the set-named bank when nothing is playing at all —
    // which is why the host calls this AFTER viewer.start() (main.ts), so
    // setupsound has already had its say and this covers just the sets it has
    // no case for. Called first, it audibly blipped the set-named bank before
    // the deck theme replaced it.
    if (this.session.currentThemeName !== "none") return;
    const key = `${this.set.setName.toLowerCase()}.trk`;
    const theme = this.session.audioLib.theme(key);
    if (theme) {
      this.session.playThemeAudio(theme);
      this.session.currentThemeName = key;
      this.session.themeStarted(key, theme.samples.length / theme.sampleRate);
    }
  }

  /** wire a file added after construction (audio bank or this set's shop) */
  addResource(name: string, data: Uint8Array): boolean {
    const key = name.toLowerCase();
    if (/\.(trk|sfx|11k)$/.test(key)) {
      if (this.session.audioLib.openBank(key, data)) {
        this.onLog(`audio bank opened: ${key}`);
        return true;
      }
      return false;
    }
    if (key === `${this.set.setName.toLowerCase()}.shp`) {
      void this.session.track(this.scripts.openShop(key), `openShop ${key}`);
      return true;
    }
    return false;
  }

  /**
   * Decode one not-yet-decoded ring reachable from where the player is
   * standing — the other turn direction, the roads leading out. Called from
   * {@link tick} while nothing is animating, one ring per frame, so the first
   * turn or walk at a new standpoint finds its images already there instead of
   * paying 20–75 ms for them.
   */
  private warmNeighbourRing(): void {
    if (this.warmDone) return; // nothing left to warm from this standpoint
    const candidates: FrameInfo[][] = [
      this.scene.turns[RIGHTTURNS].frames,
      this.scene.turns[LEFTTURNS].frames,
      ...this.availableRoads().map((r) => r.road.frameRegisters[r.register].frames),
    ];
    for (const frames of candidates) {
      if (!this.rings.needsDecode(frames)) continue;
      this.rings.ensure(frames);
      return; // one per frame
    }
    this.warmDone = true; // reset by showView when the standpoint changes
  }

  private jumpToDefault(): void {
    const s = this.set.scenes.findIndex((sc) => sc.sceneName === this.set.defaultSceneName);
    this.sceneIdx = Math.max(0, s);
    const scene = this.scene;
    const v = scene.views.findIndex((vw) => vw.viewName === this.set.defaultViewName);
    this.viewIdx = Math.max(0, v);
    this.showView();
  }

  get scene(): Scene {
    return this.set.scenes[this.sceneIdx];
  }

  /** re-emit the HUD line for the current view (e.g. after wiring onHud) */
  refreshHud(): void {
    this.showView();
  }

  get globalViewID(): number {
    return this.scene.views[this.viewIdx].viewID;
  }

  /** the FrameInfo of the current view's standpoint (from the right-turn
   *  ring — every view has a stand frame there; vista views ride it too) */
  private standFrameInfo(): FrameInfo | null {
    return this.standFrameInfoOf(this.scene, this.viewIdx);
  }

  /** the same question about a scene the player is not standing in yet — where a
   *  road is about to arrive ({@link roadArrival}) */
  private standFrameInfoOf(scene: Scene, viewIdx: number): FrameInfo | null {
    const ring = scene.turns[RIGHTTURNS].frames;
    return ring.find((f) => f.viewID === viewIdx && f.motionInfo > 0) ?? null;
  }

  /**
   * Where a road register puts the player: the arrival scene and the view they
   * face on getting there. Null when neither lookup finds a scene.
   *
   * The scene is the register's `destination`, which is the container index of
   * the arrival scene's view table; the fallback is the scene owning the road's
   * far-end global view id. The VIEW is not the road's endpoint view — that one
   * faces back along the road — but the one nearest the direction of travel, so
   * the player keeps facing the way they walked.
   *
   * Pure, and that is the point: {@link walk} needs the answer before the
   * animation starts (to end it on the arrival standpoint) and again when the
   * animation finishes, and one function means those two cannot disagree.
   */
  private roadArrival(
    reg: { destination: number; frames: FrameInfo[] },
    arriveViewID: number,
  ): { sceneIdx: number; viewIdx: number } | null {
    let sceneIdx = this.set.scenes.findIndex((s) => s.locationViews === reg.destination);
    if (sceneIdx < 0) {
      sceneIdx = this.set.scenes.findIndex((s) => s.views.some((vw) => vw.viewID === arriveViewID));
    }
    if (sceneIdx < 0) return null;
    const travelDir = reg.frames.at(-1)!.axisX;
    return { sceneIdx, viewIdx: this.nearestView(this.set.scenes[sceneIdx], travelDir) };
  }

  /**
   * The hi-res twin of a standpoint frame, which is what a settled view is
   * DRAWN from (#68).
   *
   * A scene ships each standpoint twice, and the two rings are not
   * interchangeable: `motionInfo` is 1 (low-res standpoint) throughout the
   * right-turn ring and 2 (hi-res) throughout the left-turn one. Measured over
   * gamefiles/en: all 546 scenes of all 78 sets are shaped that way, all 3048
   * standpoints have a twin, and `framePairID` names it (viewID agrees on every
   * one). The hi-res art is 164.6 MB against the low-res 59.4 MB — 2.77x, at the
   * same pixel dimensions, so it is detail rather than size.
   *
   * We drew the low-res one everywhere, because the settled frame came from the
   * right-turn ring — which is why the whole game looked like it was permanently
   * mid-turn. The original's asymmetry falls out of this for free: a right turn
   * ends on its ring's low-res standpoint and visibly sharpens when it settles, a
   * left turn ends on the hi-res one and never appears to change.
   *
   * Only the IMAGE comes from the twin. The camera still reads the right-turn
   * ring's FrameInfo, which is safe because the twins carry identical position
   * and rotation — measured, 0 of 3048 differ — and identical dimensions and Z
   * layer, so nothing about projection or prop occlusion moves.
   */
  private hiResTwin(fi: FrameInfo, scene: Scene = this.scene): FrameInfo | null {
    const ring = scene.turns[LEFTTURNS]?.frames ?? [];
    return ring.find((f) => f.motionInfo === 2 && f.framePairID === fi.framePairID) ?? null;
  }

  /** the low-res twin — the same pairing read the other way, for a frame taken
   *  from the LEFT-turn ring (#75's "always soft" and "always transition") */
  private lowResTwin(fi: FrameInfo, scene: Scene = this.scene): FrameInfo | null {
    const ring = scene.turns[RIGHTTURNS]?.frames ?? [];
    return ring.find((f) => f.motionInfo === 1 && f.framePairID === fi.framePairID) ?? null;
  }

  /** the decoded image of a standpoint's hi-res twin, if it has one */
  private hiResImage(fi: FrameInfo, scene: Scene = this.scene): CachedFrame | undefined {
    const hi = this.hiResTwin(fi, scene);
    if (!hi) return undefined;
    return this.rings.ensure(scene.turns[LEFTTURNS].frames).get(hi.frameContainerLoc);
  }

  /** the decoded image of a standpoint's low-res twin, if it has one */
  private lowResImage(fi: FrameInfo, scene: Scene = this.scene): CachedFrame | undefined {
    const lo = this.lowResTwin(fi, scene);
    if (!lo) return undefined;
    return this.rings.ensure(scene.turns[RIGHTTURNS].frames).get(lo.frameContainerLoc);
  }

  /**
   * The frames of a turn, with the landing standpoint's two versions in the
   * order the original shows them (#68).
   *
   * A right turn's ring ends on the LOW-res standpoint and a left turn's on the
   * hi-res one, so in the original a right turn lands soft and sharpens a beat
   * later while a left turn lands sharp. Reproducing that needs the soft frame to
   * be a frame of the animation: the settle runs inside the same tick that draws
   * the last one (`startAnimation`'s done callback → showView), so a soft frame
   * left at the end of the ring reaches the screen for exactly zero ticks. It
   * went unnoticed while the settled view was drawn from the same low-res art —
   * the two images were identical, so swallowing one changed nothing.
   *
   * So the soft standpoint is followed by its sharp twin, and the beat is one
   * animation interval. {@link standpointFrames} is where the player's setting
   * decides whether that beat happens in this direction (#75).
   *
   * `turnRing` stops at the first standpoint it reaches, so this touches the
   * frame being landed on and never one the turn passes through. It cannot
   * sharpen the turn ITSELF: in-motion frames are quarter-resolution in both
   * rings (measured, bedsit1/Scene2: 100.0% and 99.9% of 2x2 pixel blocks flat,
   * against 16.0% for a hi-res standpoint) and no sharp version of them shipped.
   */
  private turnFrames(ring: FrameInfo[], images: Map<number, CachedFrame>): CachedFrame[] {
    const out: CachedFrame[] = [];
    for (const fi of ring) {
      const own = images.get(fi.frameContainerLoc);
      if (fi.motionInfo > 0) {
        const landing = this.standpointFrames(fi, own);
        if (landing.length) {
          out.push(...landing);
          continue;
        }
      }
      if (own) out.push(own);
    }
    return out;
  }

  /**
   * The frames an animation ends with to land on standpoint `fi`, under the
   * player's picture setting (#75).
   *
   * The trailing frame is always the one the settled view will be drawn from, so
   * that {@link showView} — which runs in the same tick that draws it — replaces
   * it with an identical image and nothing flickers. A soft frame ahead of a
   * sharp one is therefore the ONLY way to show the soft version at all, and it
   * shows for exactly one animation interval.
   *
   * `own` is `fi`'s own image, which is low-res in the right-turn ring and hi-res
   * in the left-turn one; the twin comes from the other ring by `framePairID`.
   * Where a twin is missing (nothing in gamefiles/en is, but a set need not
   * oblige) the pair collapses to whatever there is.
   */
  private standpointFrames(
    fi: FrameInfo,
    own: CachedFrame | undefined,
    scene: Scene = this.scene,
  ): CachedFrame[] {
    const soft = fi.motionInfo === 1 ? own : this.lowResImage(fi, scene);
    const sharp = fi.motionInfo === 2 ? own : this.hiResImage(fi, scene);
    const both = (): CachedFrame[] => (soft && sharp ? [soft, sharp] : [(sharp ?? soft)!]);
    if (!soft && !sharp) return [];
    switch (this.session.pictureMode) {
      case "sharp":
        return [(sharp ?? soft)!];
      case "soft":
        return [(soft ?? sharp)!];
      case "transition":
        return both();
      default:
        // the original: a soft beat only where the ring itself ends on the
        // low-res frame, which is the right-turn ring and nothing else. Where
        // the pass steps the move, that frame IS the landing: it settles in
        // the pass that draws it (TI.EXE 0x43a510 -> 0x43a612) and sharpens
        // once the idle has returned (0x42a2c3 -> 0x439bd0, after the settle
        // cleared 0x48a5a0) — see passMotion
        if (fi.motionInfo !== 1) return [(sharp ?? soft)!];
        if (!this.passStepped || !soft) return both();
        this.softLandings.add(soft);
        return [soft];
    }
  }

  /**
   * The standpoint frame image of the current view — hi-res, which is what a
   * settled view is drawn from (#68), unless the player has asked for the
   * low-res one everywhere, which is what "always soft" means: not a soft
   * landing followed by a sharpen, but a room that stays soft (#75).
   */
  /** the standpoint's LOW-res picture — the right ring's own, see {@link standFrame} */
  private softStandFrame(): CachedFrame | null {
    const fi = this.standFrameInfo();
    if (!fi) return null;
    return this.rings.ensure(this.scene.turns[RIGHTTURNS].frames).get(fi.frameContainerLoc) ?? this.standFrame();
  }

  private standFrame(): CachedFrame | null {
    const fi = this.standFrameInfo();
    if (!fi) return null;
    const own = this.rings.ensure(this.scene.turns[RIGHTTURNS].frames).get(fi.frameContainerLoc);
    if (this.session.pictureMode === "soft") return own ?? this.hiResImage(fi) ?? null;
    return this.hiResImage(fi) ?? own ?? null;
  }

  private showView(): void {
    this.warmDone = false; // a new standpoint has new neighbours to warm
    this.current = this.dfStepped && !this.dfSharp ? this.softStandFrame() : this.standFrame();
    const v = this.scene.views[this.viewIdx];
    const roads = this.availableRoads();
    this.onHud(
      `${this.set.setName} — ${this.scene.sceneName} / ${v.viewName}` +
        (roads.length ? `  ·  ↑ ${roads.map((r) => r.road.transitionName).join(", ")}` : "") +
        (v.objects.length ? `  ·  ${v.objects.length} hotspot(s)` : ""),
    );
  }

  /** engine-side busy: something visual is in flight — the director's, which
   *  is where the movie and the conversation it also counts live */
  get busy(): boolean {
    return this.dir.busy;
  }

  /** a turn/walk camera animation is in flight */
  private get animating(): boolean {
    return this.animation !== null;
  }

  /** gate for NEW user input: also waits for running/suspended scripts */
  get inputLocked(): boolean {
    return this.dir.inputLocked;
  }

  /** the regions a parked movie is waiting on — the director's */
  get movieRegions(): ScreenDirector["movieRegions"] {
    return this.dir.movieRegions;
  }

  /** the engine has stopped and is waiting for the player to click something */
  get awaitingInput(): boolean {
    return this.dir.awaitingInput;
  }

  get awaitingChoice(): boolean {
    return this.dir.awaitingChoice;
  }

  /** the choices a parked conversation is offering, in bevel order */
  get choices(): { text: string; id: number }[] {
    return this.dir.choices;
  }

  get choiceRects(): { x: number; y: number; w: number; h: number }[] {
    return this.dir.choiceRects;
  }

  /** a conversation close-up is on screen (speaking or waiting) */
  get conversing(): boolean {
    return this.dir.conversing;
  }

  get speaking(): boolean {
    return this.dir.speaking;
  }

  get conversingWith(): string {
    return this.dir.conversingWith;
  }

  /** the engine is not going to move again on its own — the director's */
  get quiescent(): boolean {
    return this.dir.quiescent;
  }

  /**
   * the current view's depth map for occluding world sprites behind scenery.
   * scale (units/level) = zFarMax / zLevelCount from the SET's SCDO chunk.
   */
  roomOcclusion(): import("@dreamfactory/engine/runtime/actors").Occlusion | null {
    const f = this.current;
    if (!f?.z) return null;
    const levels = this.set.zLevelCount || 24;
    // an integer, as TI.EXE's `idiv` at 0x4077e1 leaves it (64 on every Dust set)
    const scale = Math.trunc(this.set.zFarMax / levels);
    if (Number.isNaN(scale) || scale <= 0) return null;
    return {
      z: f.z, w: f.width, h: f.height, scale, levels,
      // v1 z-tests sprites 128 units deep of where they stand (DF.EXE's +0x80,
      // see set-v1-to-v4.ts); v4 leaves the bias unset
      groundBias: this.set.spriteZBias ?? 0,
    };
  }

  /** camera of the current view, for world-space (propxyz) props */
  worldCamera(): import("@dreamfactory/engine/runtime/props").WorldCamera | null {
    const sc = this.scene;
    const v = sc?.views[this.viewIdx];
    if (!v) return null;
    // the view's stand frame carries the camera's true world position
    // (posX16/posZ16/posY16) — scale-free across sets (C73 is 150 units/m,
    // DECKBD 55/m; a cameraHeight×512 rule holds only for C73's scale and
    // floats deck cameras 2-3× too high).
    const fi = this.standFrameInfo();
    return this.cameraFrom({
      x: fi ? fi.posX16 : sc.xAxisMap,
      y: fi ? fi.posZ16 : sc.zAxisMap,
      z: fi ? fi.posY16 : Math.round(v.cameraHeight * 512),
      deg: v.rotation8,
    });
  }

  /** build a full WorldCamera (viewport focal/centre/clip) from a camera pose —
   *  shared by the still standpoint camera and the per-frame motion cameras */
  private cameraFrom(pose: {
    x: number;
    y: number;
    z: number;
    deg: number;
  }): import("@dreamfactory/engine/runtime/props").WorldCamera {
    const w = this.set.viewPortWidth || 512;
    const h = this.set.viewPortHeight || 264;
    /**
     * v1 pulls the camera BACK along the view bearing before projecting —
     * DF.EXE 0x433fd4..0x43401e, by the set's own header amount (64 on every
     * Dust set; see set-v1-to-v4.ts). The displacement is along the same
     * (cos, sin) the projection's depth axis uses, so every depth simply
     * grows by the setback. v4 sets carry no setback and are untouched.
     */
    const sb = this.set.cameraSetback ?? 0;
    const th = (2 * Math.PI * (pose.deg & 0xff)) / 256;
    return {
      x: pose.x - Math.round(sb * Math.cos(th)),
      y: pose.y - Math.round(sb * Math.sin(th)),
      // TI.EXE projection subtracts the `camerahi` bias from the point height
      // (dyHeight = ptY - camHeight - camerahi); adding it to the camera eye
      // here is equivalent and drops the halls' floating sprites onto the floor.
      z: pose.z + this.session.cameraHiBias,
      deg: pose.deg,
      // v1 names its own focal length (DF.EXE hard-codes 310 — see
      // set-v1-to-v4.ts); v4 sets leave it unset and keep the measured default
      f: this.set.focalLength ?? Math.max(w, h) / 2,
      cx: w / 2,
      cy: h / 2,
      clipW: w,
      clipH: h,
      depthWindow: this.depthWindow(),
    };
  }

  /** see WorldCamera.depthWindow: v1 sets carry a camera setback, v4 sets do not */
  private depthWindow(): { minDepth: number; far: number; bias: number } | undefined {
    const levels = this.set.zLevelCount;
    if (!this.set.zFarMax || !levels) return undefined;
    const v1 = this.set.cameraSetback !== undefined;
    return {
      minDepth: v1 ? 32 : Math.trunc(Math.trunc(this.set.zFarMax / levels) / 4) + 1,
      far: this.set.zFarMax,
      bias: this.set.spriteZBias ?? 0,
    };
  }

  /** camera to project world sprites onto the frame shown right now — the
   *  moving motion-frame camera during a turn/walk, else the standpoint */
  roomCamera(): import("@dreamfactory/engine/runtime/props").WorldCamera | null {
    if (this.animating) {
      return this.current?.cam ? this.cameraFrom(this.current.cam) : null;
    }
    return this.worldCamera();
  }

  /**
   * TI.EXE's movement lifecycle, in ITS order — the disassembled currentscene
   * setter (0x407b70), which is what boot's default keydown calls for every
   * turn and walk:
   *
   *   1. `closescene` fires when the move STARTS — before the first frame,
   *      with the departing view still current (0x407cbb, ahead of the
   *      animation at 0x407cfd);
   *   2. the frames play (currentview() answers "moving");
   *   3. `openscene` fires when the motion SETTLES, after the view globals
   *      update (the turn settle's 0x43a612, the walk settle's 0x43a835).
   *
   * Both halves are dispatched as a Scene Message at the current scene
   * (0x408000 synthesizes `"<scene>", closescene()` and sends it there), so
   * both run the FULL chain — scene → set main → stage → boot.
   *
   * Firing closescene at arrival instead held the departed standpoint's state
   * across the whole animation, which was three bugs wearing one cause: the
   * walk out of gstair2's Scene64 kept its openscene's actorzclip(-8100) in
   * force so the stairwell crowd was erased for every road frame (the original
   * restores -1500 before the first one); boot's door/signs cleanup ran one
   * paint too late, blipping the open door and its destination plaque onto the
   * arrival view for exactly one frame; and the nav arrow carried the departed
   * view's colour through every move.
   *
   * A script's `currentscene (dir)` does not come through here: it takes
   * {@link navigateAsExe}, which runs closescene to its end before the first
   * frame, so HALLA's jay-walk spin holds the move, and drops the move when
   * the handler closed the set (0x407cc9) or moved the scene (0x407ce6). What
   * is left here is the engine default for a room with no boot (the dev set
   * picker), where closescene is fired, not awaited, and overlaps the
   * animation. {@link settleScene} chains the arrival openscene on this
   * promise so the pair cannot run out of order even then.
   */
  private departScene(label: string): Promise<void> {
    // the same promise, not a `.then` of it: one more microtask here would move
    // the departure against everything else in flight
    return this.session.track(this.scripts.closeScene(this.sceneIdx) as Promise<unknown> as Promise<void>, label);
  }

  /**
   * The arrival half: fire `openscene` for the settled scene, after the
   * departure's closescene has finished (see {@link departScene} for the
   * ordering evidence). `openScene` rather than `viewSettled` because the
   * departure's closeScene cleared `lastSceneIdx`, and the arrival is what
   * puts it back for closesetfile's implicit closescene.
   *
   * The arrival scripts DRIVE THE CAMERA in the original —
   * currentscene()/currentview() are unconditional setters there — so the nav
   * hooks are armed around the dispatch the way keydown and press do around
   * theirs. Only three openscene handlers in the whole TAOOT corpus set the
   * camera, and each one needs it live: the demo's grand-staircase deck warps
   * (gstair2 Scene64/Scene65, `changeset(theset); currentscene(thescene);
   * currentview(theview)` — the demo build's script style; the full game
   * passes the pair INSIDE changeset instead) and C59's Zeitel entry, which
   * turns you to face him with a currentscene("right") loop. With the hooks
   * dark, the warps' changeset would still fire but the jumps be dropped, and
   * every deck-b/c climb land at the arriving set's DEFAULT scene. A
   * changeset in the chain swaps the viewer and re-arms on the new one (host
   * activateSet, keyed on navGestureActive); disarming writes the shared
   * session fields, so doing it through the old viewer is fine.
   */
  private settleScene(departure: Promise<void> | null, sceneIdx: number, label: string): void | Promise<void> {
    const arrive = async (): Promise<void> => {
      const prev = this.armNavHooks();
      try {
        await this.scripts.openScene(sceneIdx);
      } finally {
        this.disarmNavHooks(prev);
      }
    };
    // stepped by the pass: the arrival is the pass's, and runs inside it
    // (TI.EXE 0x43a510 -> the settle, from the frame). In DreamFactory 1 it is
    // a running script like the pass's loop handlers (Scheduler.sendInPass):
    // DF.EXE's main loop takes no event until the idle that runs it has
    // returned (0x4115f0), so a press made meanwhile waits for it
    if (!departure) return this.rules.arrivalIsScript ? this.session.track(arrive(), label) : arrive();
    void this.session.track(departure.then(arrive), label);
  }

  /** dir: RIGHTTURNS or LEFTTURNS. `pace` defaults to the PLAYER's rate: every
   *  caller that omits it is standing in for a keypress (the arrow fallback in
   *  {@link pressNav}, the headless drivers, the route planner). */
  turn(dir: number, pace = this.playerPace, departed = false): void {
    if (departed ? this.animating : this.busy) return;
    // shared with the playthrough route planner (df/set.ts) so a planned turn and
    // the turn actually taken can never land on different standpoints
    const ring = turnRing(this.scene, this.viewIdx, dir);
    if (!ring) {
      // `departed`: the closescene a refusal owes was sent already
      if (!departed) this.refusedMove("turn-closescene");
      return;
    }
    const images = this.rings.ensure(this.scene.turns[dir].frames);
    const frames = this.dfStepped
      ? this.dfMoveFrames(ring.frames, images)
      : this.turnFrames(ring.frames, images);
    const target = ring.target;
    // departure closescene BEFORE the first frame — see departScene. TI.EXE
    // fires it for every turn command, ring wrap included (0x407cbb runs for
    // left/right/strait alike), so no `changed` gate here or on the arrival.
    // `departed`: closescene was sent and run already (navigateAsExe)
    const departure = departed ? null : this.departScene("turn-closescene");
    // a turn draws its starting standpoint (0x439da9), so its first pass shows
    // the first frame past it; DF.EXE draws nothing until the pass (0x4338b0)
    this.startAnimation(frames, pace, false, () => {
      // update the facing BEFORE firing openscene — a per-view event — so its
      // handlers see the new currentview() in their guards
      this.viewIdx = target;
      this.showView();
      return this.settleScene(departure, this.sceneIdx, "turn-openscene");
    });
  }

  /**
   * A move with nowhere to go still LEAVES the scene in DreamFactory 1, and
   * never arrives back. DF.EXE's `currentscene (dir)` (0x40ee30) sends
   * closescene first (0x40ef5b -> 0x40f100) and only then asks the move routine
   * 0x4338b0, which finds no destination (0x433ae0) and returns — no motion, so
   * no settle and no openscene. Every Dust move is that call, the boot's
   * `currentscene ("strait")` included: 0x4338b0 has no other caller.
   *
   * TI.EXE asks first, for a walk: `"strait"` checks for a road (0x439ee0 at
   * 0x407c99) and returns before its closescene (0x407cbb, en build), so a
   * blocked walk in Titanic or Timelapse fires nothing — which is why this is
   * v1 only.
   */
  private refusedMove(label: string): void {
    if (this.rules.refusedMoveDeparts) void this.departScene(label);
  }

  availableRoads(): { road: Transition; register: number; arriveViewID: number }[] {
    return roadsAt(this.set, this.globalViewID);
  }

  /** see {@link turn} for what an omitted `pace` means */
  walk(pace = this.playerPace, departed = false): void {
    if (departed ? this.animating : this.busy) return;
    const roads = this.availableRoads();
    if (!roads.length) {
      if (!departed) this.refusedMove("walk-closescene");
      return;
    }
    const { road, register, arriveViewID } = roads[0];
    const reg = road.frameRegisters[register];
    const images = this.rings.ensure(reg.frames);
    const frames = this.dfStepped
      ? this.dfMoveFrames(reg.frames, images)
      : reg.frames.map((fi) => images.get(fi.frameContainerLoc)).filter((f): f is CachedFrame => !!f);
    // Worked out before the walk starts, not in the callback below, because
    // "always transition" needs the standpoint being walked TO in order to end
    // the animation on it. Both answers are pure functions of the register, so
    // the callback reads the same ones rather than working them out again.
    const arrival = this.roadArrival(reg, arriveViewID);
    // A register's END rows are bookkeeping the original never PRESENTS. Every
    // register opens with a motionInfo-1 STANDPOINT record (972 of 972 in
    // gamefiles/en, both discs) — the "from here" row, not a motion frame —
    // and TI.EXE consumes both ends off screen: the first beat plays inside
    // the keypress (0x439e10 shows frame 0 before the gesture returns) and the
    // last inside the settle that replaces it with the arrival view (0x43a6cd).
    // Never being seen is how their pose copies went stale on the disc: 92 of
    // 1944 end rows record a height that disagrees with the standpoint they
    // stand on — gstair2's Road58.0/Road62.0/Road61.0 carry the UPPER landing's
    // 7645 against the A-deck's 5976 (#253), gstair3 mirrors it, and stair2c's
    // reused flight is off by whole decks. The port presents those beats, one
    // tick each, which would paste the crowd 140–210 px down the frame for
    // exactly one frame (shift = 256 * Δy / depth).
    //
    // So each end borrows its standpoint's HEIGHT — the departure end from the
    // view being stood on (whose camera is on screen at that instant), the
    // arrival end from the view the settle is about to show. Height only, and
    // ends only: a no-op for the 1851 rows that already agree, and the interior
    // frames keep their own per-frame heights so a stair road still ramps
    // continuously. Cloned, not patched — the CachedFrames are shared with the
    // ring cache.
    if (frames.length && !this.dfStepped) {
      const pinHeight = (frame: CachedFrame, stand: FrameInfo | null): CachedFrame =>
        !frame.cam || !stand || frame.cam.z === stand.posY16
          ? frame
          : { ...frame, cam: { ...frame.cam, z: stand.posY16 } };
      frames[0] = pinHeight(frames[0], this.standFrameInfo());
      const arrive = arrival
        ? this.standFrameInfoOf(this.set.scenes[arrival.sceneIdx], arrival.viewIdx)
        : null;
      frames[frames.length - 1] = pinHeight(frames.at(-1)!, arrive);
    }
    if (arrival && this.session.pictureMode === "transition" && !this.dfStepped) {
      // A road ends on an IN-MOTION frame — measured, all 722 registers in
      // gamefiles/en — so a walk has no landing standpoint of its own to soften
      // and lands sharp in the original. Appending the pair gives it the beat a
      // right turn has, which is what "every direction the same" asks for.
      const scene = this.set.scenes[arrival.sceneIdx];
      const fi = this.standFrameInfoOf(scene, arrival.viewIdx);
      if (fi) {
        const own = this.rings.ensure(scene.turns[RIGHTTURNS].frames).get(fi.frameContainerLoc);
        frames.push(...this.standpointFrames(fi, own, scene));
      }
    }
    // The departing scene's closescene fires BEFORE the first road frame —
    // see departScene for the disassembly. This is what restores gstair2
    // Scene64's actorzclip(-1500) ahead of the walk out, so the stairwell
    // crowd stays drawn during the move as it does in the original.
    const departure = departed ? null : this.departScene("walk-closescene");
    // a walk draws its first row inside the gesture (0x439e10); DF.EXE's
    // draws nothing until the pass (0x4338b0)
    this.startAnimation(frames, pace, !this.dfStepped, () => {
      if (arrival) {
        this.sceneIdx = arrival.sceneIdx;
        this.viewIdx = arrival.viewIdx;
      }
      // openscene at the settled scene — after the indices update, so its
      // handlers see the new currentview() (gstair's deck-transition scenes
      // forward via changeset from their openscene). A walk that stays in the
      // same scene owes it too: openscene is a per-view event.
      const settled = this.settleScene(departure, this.sceneIdx, "walk-openscene");
      this.showView();
      return settled;
    });
  }

  /**
   * The hotspot under a view-pixel position in the current view, as TI.EXE finds
   * it (0x409910, en build): the view's paintings scanned from the LAST to the
   * first, and the first whose rectangle holds the point wins. The rectangle is
   * half-open — top <= y < bottom, left <= x < right (0x435410) — and taken as
   * stored: one written backwards holds nothing.
   *
   * So a hotspot inside another is reached by being listed after it, which is
   * how the shipped sets are drawn: C73's door-ringer (19x19, inside the 200x246
   * door) comes later in its list. Of the nine overlapping pairs in the English
   * Titanic sets one is the other way round — recept1c Scene11 View25, where the
   * Painting (#3) lies over cufflink2 (#0) and takes the click in their overlap;
   * the smallest-area rule this replaces gave it to the cufflink.
   */
  hitTest(x: number, y: number): { objIdx: number; obj: ObjectEntry } | null {
    if (this.busy) return null;
    const objects = this.scene.views[this.viewIdx].objects;
    for (let o = objects.length - 1; o >= 0; o--) {
      const obj = objects[o];
      if (y >= obj.startRegionY && y < obj.endRegionY && x >= obj.startRegionX && x < obj.endRegionX) {
        return { objIdx: o, obj };
      }
    }
    return null;
  }

  /** press and release at one point — the director's, delegated */
  click(x: number, y: number): Promise<void> {
    return this.dir.click(x, y);
  }

  /** a click, through the whole priority chain — the director's, delegated */
  press(x: number, y: number): Promise<void> {
    return this.dir.press(x, y);
  }

  /** arm/disarm this room's camera hooks for the length of one gesture — see
   *  {@link RoomLayer.armRoomNav} */
  armRoomNav(): unknown {
    return this.armNavHooks();
  }
  disarmRoomNav(prev: unknown): void {
    this.disarmNavHooks(prev as NavHooks);
  }

  /** the button came up — {@link ScreenDirector.release}, delegated */
  release(x: number, y: number): void {
    this.dir.release(x, y);
  }

  /**
   * This room's own zone of a click: an actor, then a view hotspot, then the
   * scene itself. True when the room took it.
   *
   * The rest of the chain — a movie, a conversation, the `lockevents` gate, the
   * queue, the game's own shipped `mousedown`, props, and the stage below — is
   * {@link ScreenDirector.clickDispatch}'s, because none of it is a room's and a
   * game may have no rooms at all.
   */
  async roomClickAt(x: number, y: number): Promise<boolean> {
    if (await this.clickActor(x, y)) return true;
    if (!this.pointInRoomImage(x, y)) return false;
    if (await this.clickHotspot(x, y)) return true;
    await this.clickScene();
    return true;
  }

  /**
   * ...and the same zone of `hittest`: an actor in front of the view's hotspots,
   * a hotspot as a "painting", and where there is neither, the SCENE ITSELF by
   * name — not nothing, and not the flat behind it.
   */
  roomHitTest(x: number, y: number): { name: string; type: string } | null {
    if (!this.pointInRoomImage(x, y)) return null;
    // an actor stands in front of the view's hotspots — and ONLY inside this
    // image, because that is the only place one is drawn. A projected sprite
    // reaches past the bottom of it for anyone standing close to the camera,
    // so asking the actors first and everywhere answered "actor" over the
    // interface band: measured in TAOOT at 1558 band points in gstair2
    // (trask, elev), 1275 in b59 (conk), 1299 in recept1c. A prop is asked
    // first and unbounded, which is right — the band's own props ARE
    // screen-space, and that step is the director's.
    const cam = this.worldCamera();
    const act = cam ? this.session.actorRuntime.actorAt(x, y, cam, this.roomOcclusion()) : null;
    // the INSTANCE's name, not its cast member's: three of Dust's shooting-range
    // targets are `actorinstance` copies of one member, and naming the member
    // told the range that the left-hand bottle was hit whichever one was
    // (ActorInstance.name)
    if (act) return { name: act.name || act.member.name, type: "actor" };
    const hit = this.hitTest(x, y); // smallest-region-wins, same as clicks
    // A hotspot is a PAINTING — countpaintings/indextopainting enumerate
    // exactly these, and both handlers that route one send it through
    // `sendtopainting(currentscene(), currentview(), thename, …)`, which
    // resolves it in the view you are looking at. Labelling it "scene" sent
    // it through `sendtoscene(thename, …)` instead, which resolves a name
    // against the whole set: 141 hotspot names in TAOOT's tree carry more
    // than one script (bedsit1's `cabinet` has eight, one per standpoint), so
    // the wrong standpoint's script could answer, and the scene script — where
    // twelve of them keep their handler — was skipped entirely.
    if (hit) return { name: hit.obj.identifier, type: "painting" };
    return { name: this.scene.sceneName.toLowerCase(), type: "scene" };
  }

  /** is the point inside the image the SET draws? In-game the room occupies the
   *  top 264 rows and the interface band below belongs to the stage — which is
   *  what makes a band click a flat click and a room click neither. */
  /**
   * Is the point inside the image this room draws?
   *
   * In-game the room occupies the top 264 rows and the interface band below
   * belongs to the stage — which is what makes a band click a flat click and a
   * room click neither.
   */
  pointInRoomImage(x: number, y: number): boolean {
    return (
      this.session.viewShowing && !!this.current &&
      x >= 0 && y >= 0 && x < this.current.width && y < this.current.height
    );
  }

  /** props (UI band, inventory items) sit in front of everything */

  /** actors stand in the world between the props and the view hotspots */
  private async clickActor(x: number, y: number): Promise<boolean> {
    if (!this.session.viewShowing || !this.current || y >= this.current.height) return false;
    const cam = this.worldCamera();
    const act = cam ? this.session.actorRuntime.actorAt(x, y, cam, this.roomOcclusion()) : null;
    if (!act) return false;
    // ...and a COPY answers on its own script under its own name — see
    // GameSession.instanceCastScript, which registers one per instance
    const who = act.name || act.member.name;
    const inst = this.session.castScripts.get(who);
    if (!inst?.script.codes.has("mousedown")) return false;
    try {
      await this.session.interp.runHandler(inst, "mousedown", [who], {
        me: who,
        target: who,
      });
    } catch (e) {
      this.onLog(`script error in ${who}.mousedown: ${(e as Error).message}`);
    }
    this.onLog(`click actor ${who}`);
    return true;
  }

  /** inside the set view: the usual hotspot script chain */
  private async clickHotspot(x: number, y: number): Promise<boolean> {
    if (!this.session.viewShowing || !this.current || y >= this.current.height) return false;
    const hit = this.hitTest(x, y);
    if (!hit) return false;
    const consumed = await this.scripts.mouseDown(
      this.sceneIdx, this.viewIdx, hit.objIdx, hit.obj.identifier,
    );
    this.onLog(`click ${hit.obj.identifier}${consumed ? "" : " (unhandled)"}`);
    return true;
  }

  /**
   * Nothing in the room but the room. The scene answers for itself — the boot's
   * `case "scene": sendtoscene(thename, mousedown(thepoint))`, with `thename` the
   * scene hittest just named — and the event forwards along scene → set main →
   * stage the way every other scene event does.
   *
   * Not the director's `clickFlatSurface`, which is the STAGE's answer and
   * belongs to a click in the band. In a room that would run the current flat's
   * mousedown for a click on the floor — in TAOOT the current flat is
   * main.stg's `main 1`, whose mousedown is `sendtoshop("house.shp",
   * deactivateinterface())`: clicking the carpet would darken the watch, shut
   * the bag, reset the nav arrow and play `lightoff`. That is the band's own behaviour —
   * click the band background and the interface goes away — reached from the one
   * place the shipped hit test never sends it.
   */
  private async clickScene(): Promise<void> {
    const name = this.scene.sceneName.toLowerCase();
    await this.session.sendEvent(
      "sendtoscene", name, "mousedown", [this.session.pointerPoint()], name,
    );
  }

  /** the front-most prop sprite under a screen position — the director's, and
   *  its own, because a prop is screen-space unless a room is showing */
  propUnder(x: number, y: number): ReturnType<GameSession["propRuntime"]["propAt"]> {
    return this.dir.propUnder(x, y);
  }

  // ---- puppet mode (rendering + bevel hit-testing live in puppet-view.ts) --

  /** decode (cached per pup) a layer sprite of the active puppet */
  /** decode (cached per pup) a layer sprite of the active puppet */
  puppetLayerFrame(loc: number): ShpFrame | null {
    return this.dir.puppetLayerFrame(loc);
  }

  /** the active overlay flat's named click-region under a point, or null */

  /** the cursor under the pointer — {@link ScreenDirector.hover}, delegated */
  hover(x: number, y: number): Promise<string> {
    return this.dir.hover(x, y);
  }

  /**
   * Route a handler at one of this room's own hotspots.
   *
   * `sendtopainting` is answered in the scene and view you are LOOKING at, so
   * only the room can resolve it — which is why the director asks rather than
   * reading a scene name off the session (that one says "moving" mid-turn).
   */
  async sendRoomPainting(name: string, handler: string, point: Value): Promise<void> {
    await this.session.sendToPainting(
      this.scene.sceneName, this.scene.views[this.viewIdx].viewName, name, handler, [point],
    );
  }

  /**
   * DreamFactory 1's `currentscene ()` while a move runs: the scene of the cell
   * the camera stands in at the step last drawn (0x410870 reads the cell
   * 0x433fdb wrote, `pos >> 8`), so a walk is in the next scene from its third
   * step on when it heads up the grid and its fourth when it heads down. Null
   * when no move runs or the cell has no scene.
   */
  private dfMovingScene(): Scene | null {
    const cam = this.animating && this.dfStepped ? this.current?.cam : undefined;
    if (!cam) return null;
    const cx = cam.x >> 8;
    const cz = cam.y >> 8;
    return this.set.scenes.find((sc) => sc.xAxisMap >> 8 === cx && sc.zAxisMap >> 8 === cz) ?? null;
  }

  /** a DreamFactory 1 room whose camera the pass steps — DF.EXE's 0x433d20 */
  private get dfStepped(): boolean {
    return this.rules.passStepsCamera && this.passStepped;
  }

  /**
   * The pictures of a DreamFactory 1 move, as DF.EXE's step (0x433d20) draws
   * them: a transition is five pictures, `k` = 0..4 (the slot's base + k,
   * 0x433d20 -> 0x4344e0), each with the camera `k / 4` of the way along
   * (set-v1-to-v4.ts), and the move runs from step 0 when the standpoint's
   * hi-res picture is on screen and from step 1 when its low-res one is
   * (0x433935: `[0x45e51c] = 3`) — picture 0 IS the departure's low-res one,
   * so the move first takes the sharp picture back. The fifth is the arrival's
   * low-res picture: a left turn's ring ends on the hi-res still instead, and
   * the arrival is drawn soft from its twin.
   */
  private dfMoveFrames(ring: FrameInfo[], images: Map<number, CachedFrame>): CachedFrame[] {
    const out: CachedFrame[] = [];
    for (const [i, fi] of ring.entries()) {
      const landing = i === ring.length - 1 && fi.motionInfo === 2;
      const image = landing ? this.lowResImage(fi) : images.get(fi.frameContainerLoc);
      if (image) out.push(image);
    }
    return this.dfSharp ? out : out.slice(1);
  }

  /**
   * A DreamFactory 1 move, jump or set opening has left the LOW-res picture on
   * screen. In the original the hi-res one comes on the sixth quiet idle turn
   * ({@link idleTurn}); "sharp" has it at once, "transition" on the next pass
   * whatever the player is doing, and "soft" never. A set with no hi-res
   * stills (MINE.SET) keeps the low-res picture in every mode, as DF.EXE's
   * machine parks in state 4 there (0x433787) — so its moves always start at
   * step 1.
   */
  private dfLanded(): void {
    const mode = this.session.pictureMode;
    const stills = !this.set.noHiResStills;
    this.dfSharp = stills && mode === "sharp";
    this.dfSharpIn = 0;
    if (!stills) return;
    if (mode === "original") this.dfSharpIn = DF_SHARP_TURNS;
    else if (mode === "transition") this.dfSharpIn = 1;
  }

  /** one turn of DreamFactory 1's sharpening count; the hi-res still on the last */
  private dfSharpTurn(): void {
    if (this.animation || this.dfSharpIn <= 0 || --this.dfSharpIn > 0) return;
    this.dfSharp = true;
    this.current = this.standFrame();
  }

  /**
   * A turn of the main loop has ended — the BOOTFILE idle has returned. In
   * DreamFactory 1 that is where DF.EXE's event 8 goes, on a turn that took no
   * event and once {@link DF_QUIET_TICKS} have passed since one was taken
   * (0x411a97: `tick >= ebx`, `ebx` set to `now + 0x14` at 0x411698 by every
   * event the loop takes): the idle machine's turn (0x4335f0), which does
   * nothing while a move runs or the set is not showing (0x433610). So input
   * holds the sharpening off — a held arrow key repeats, and the moves it makes
   * all start at step 1. Counted on the game's clock, so it is deterministic.
   */
  idleTurn(): void {
    if (!this.dfStepped || this.session.pictureMode !== "original") return;
    const s = this.session;
    if (!s.viewShowing || s.events.length) return;
    if (ticksAt(s.clock.now) < s.lastEventTick + DF_QUIET_TICKS) return;
    this.dfSharpTurn();
  }

  private startAnimation(frames: CachedFrame[], pace: number, drawnAtStart: boolean, done: () => void | Promise<void>): void {
    if (!frames.length) {
      void done();
      return;
    }
    this.animation = frames;
    this.animationPos = 0;
    this.animationPace = pace;
    this.animationDone = done;
    this.lastTick = 0;
    this.stepCredit = 0;
    this.dfSharpIn = 0;
    if (this.passStepped && drawnAtStart) this.current = frames[this.animationPos++];
  }

  /**
   * The pass's step of a turn or a walk (TI.EXE 0x439bbb -> 0x43a440 / 0x43a640):
   * the next frame, and on the last one the arrival, run inside the pass — its
   * view set and its `openscene` sent (0x43a510 / 0x43a71d). One frame a pass at
   * the original pace; a player's own move speed (#222) spends its frames
   * against the passes instead of the clock (`slow` one every other pass,
   * `fast` two, `instant` all).
   */
  async passMotion(): Promise<void> {
    if (!this.passStepped) return;
    // "transition": the soft beat is one pass, whatever the player does
    if (this.dfStepped && this.session.pictureMode === "transition") this.dfSharpTurn();
    if (this.sharpenNext) {
      this.sharpenNext = false;
      if (!this.animation) this.current = this.standFrame();
    }
    if (!this.animation) return;
    const pace = this.animationPace;
    this.stepCredit += pace > 0 ? ENGINE_STEP_MS / pace : Infinity;
    // `instant` draws nothing of the move, its landing included
    while (this.animation && this.stepCredit >= 1) {
      this.stepCredit -= 1;
      const landing = this.animation[this.animationPos++];
      this.current = landing;
      if (this.animationPos < this.animation.length) continue;
      const done = this.animationDone!;
      this.animation = null;
      this.animationDone = null;
      // DF.EXE's fifth step lands on the arrival's LOW-res picture, the camera
      // moves there and `openscene ()` is sent, inside the pass (0x434067 ->
      // 0x40f050); the idle machine starts over from state 0 (0x434057), and
      // its first turn can be this one's (idleTurn)
      if (this.dfStepped) this.dfLanded();
      await done();
      // a low-res landing stays on screen for this pass (see standpointFrames)
      if (this.softLandings.has(landing) && !this.animation && pace > 0) {
        this.current = landing;
        this.sharpenNext = true;
      }
    }
  }

  /**
   * One frame of the whole game — the director's, delegated.
   *
   * This method WAS the frame loop, and that was the inversion: the session's own
   * per-frame service (the fade, the wipe, the delay clock, the prop animation,
   * the frame loops) ran inside the ROOM's tick, so a game with no room got none
   * of it. {@link ScreenDirector.tick} runs it and then calls
   * {@link advanceRoom} below for the part that really is a room's.
   *
   * Kept as a delegation, with the same signature and the same return, because a
   * hundred test call sites and two frame loops read the frame back out of it.
   */
  tick(now: number): CachedFrame | null {
    return this.dir.tick(now);
  }

  /**
   * The room's own frame: advance a turn or a walk, pump one queued gesture,
   * warm the ring next door. Called by the director once the session-wide
   * service is done, and never while a movie owns the screen.
   *
   * A prop animates one frame per SERVICE PASS, not at the camera's rate — that
   * census is in {@link ScreenDirector.tick}, which is where the prop tick now
   * runs.
   */
  advanceRoom(now: number): CachedFrame | null {
    if (this.animation && this.passStepped) return this.current;
    if (this.animation) {
      // The first frame is due NOW, not one interval from now (#352).
      //
      // Backdating the stamp by a whole interval is what makes the frame below
      // due on this very tick. Stamping `now` instead would spend the first tick
      // of every animation initialising the clock and drawing nothing, so a move
      // would take one interval longer than the frames in it — 200 ms for a
      // 3-frame turn paced at 50.
      //
      // The original draws it inside the gesture: 0x439e10 shows frame 0 before
      // the keypress returns, which is the same disassembly {@link walk} reads
      // for why a register's end rows are never presented. So the interval is
      // the port's, and it is not a rounding error — it is a full standpoint's
      // worth of stillness on every turn and every walk.
      //
      // C59 shows it. Zeitel's entry turns you to face the door with
      // `while currentview() != "view29": currentscene("right")`, and the road
      // lands you four standpoints away, so the loop makes four turns of three
      // frames each. At 200 ms apiece the camera stops dead on each standpoint
      // for 50 ms and the sweep reads as separate turns; at 150 the next turn
      // starts on the tick the last one settles and it is one motion. Measured,
      // turn starts from the keypress: 400/600/800/1000 ms stamping `now`,
      // 350/500/650/800 backdated.
      if (!this.lastTick) this.lastTick = now - this.animationPace;
      // ONE frame a tick, normally — and more than one only when the pace asks
      // for a frame more often than the host ticks (#222).
      //
      // At the engine step or slower, one a tick is what the original does: its
      // throttle (`0x43a940`) waits out the period and then draws exactly one
      // frame, so a machine that cannot keep up stretches the move rather than
      // dropping frames out of it, and every host we have ticks at least that
      // often (50 ms headless, the display's refresh in a browser). A stutter is
      // then a late frame, not a missing one.
      //
      // Below the step there is no tick to hang each frame on: `fast` wants a
      // frame every 25 ms and headless offers one every 50, `instant` wants all
      // of them now. So time decides instead, and the frames it passes over are
      // simply not drawn. That is the whole of what "faster than the host" can
      // mean, and the duration stays exact either way — which is the part a
      // player asked to be able to change.
      const pace = this.animationPace;
      const catchUp = pace < ENGINE_STEP_MS;
      while (this.animation && now - this.lastTick >= pace) {
        // count the interval off rather than restarting it, so a pace that does
        // not divide the tick (25 ms against a 16.7 ms rAF) does not drift long
        this.lastTick = catchUp && pace > 0 ? this.lastTick + pace : now;
        this.current = this.animation[this.animationPos++];
        if (this.animationPos >= this.animation.length) {
          const done = this.animationDone!;
          this.animation = null;
          this.animationDone = null;
          // The settle runs INSIDE this tick, so it is the settled standpoint
          // that reaches the screen and not the animation's last frame — see
          // {@link standpointFrames}. At `instant` that is the whole effect:
          // the ring is walked in one tick and only the arrival is ever drawn.
          void done();
        }
        if (!catchUp) break;
      }
      return this.current;
    }
    // The move has ended and nothing is running: take the next thing the player
    // did while it was, which is where the original's main loop pops its queue.
    // One per tick — the event it dispatches may start another animation, and
    // the next tick will find that and wait again.
    // ...and not inside the BOOTFILE idle, which runs to its end first (TI.EXE en 0x431c43)
    if (!this.dir.movingCamera && !this.session.scheduler.idleRunning && this.session.events.length) this.drainOneEvent();
    // standing still: decode one ring the player could reach from here, so the
    // move they make next doesn't wait for it (see warmNeighbourRing)
    if (!this.session.scriptBusy) this.warmNeighbourRing();
    return this.current;
  }

  /**
   * Dispatch one queued event. Fired, not awaited — a tick cannot block, and the
   * gesture is tracked so `scriptBusy`/settle waits for it exactly as it would
   * for a live press.
   */
  private drainOneEvent(): void {
    const e = this.session.events.take();
    if (!e) return;
    this.session.noteEvent();
    const over = (): void => e.taken?.();
    if (e.kind === "keydown") {
      const key = e.key;
      const nav = key === "uparrow" || key === "leftarrow" || key === "rightarrow";
      void this.session.track(
        (nav ? this.pressNav(key) : this.keyDown(key, e.special).then(() => {})).finally(over),
      );
      return;
    }
    void this.session.track(this.click(e.x, e.y).finally(over), `queued click ${e.x},${e.y}`);
  }

  /**
   * The room's half of the screen's draw signature — what
   * {@link ScreenDirector.paint} is about to read from THIS layer.
   *
   * Over-hashing costs a redraw nobody needed; under-hashing costs one that WAS
   * needed, so where the two are in tension this leans on the first: the
   * palettes and the hotspot overlay go in whether or not the branch about to
   * run will look at them.
   */
  roomSignature(sig: DrawSignature): void {
    // CLUTs are replaced wholesale by applyRoomClut, never written through, so
    // which array it is IS which colours they are.
    sig.ref(this.palette).ref(this.propPalette);
    sig.bool(this.animating);
    sig.bool(this.showHotspots).num(this.sceneIdx).num(this.viewIdx);
  }

  /** present the screen — the director's work. Delegated because two frame
   *  loops and a hundred test call sites say `viewer.render(ctx)`. */
  render(ctx: CanvasRenderingContext2D): void {
    this.dir.render(ctx);
  }

  /** who owns the screen: {@link ScreenDirector.screenOwner}, delegated because
   *  the regression suite asks the viewer */
  screenOwner(): "movie" | "puppet" | "faded" | "world" | "held" {
    return this.dir.screenOwner();
  }




  /** build the ordinary screen into the framebuffer — the director's work, and
   *  delegated because the regression suite reaches for it through the viewer */
  paintWorldInto(): "flat" | "set" | null {
    return this.dir.paintWorldInto();
  }


  drawRoomHotspots(ctx: CanvasRenderingContext2D): void {
    if (!this.showHotspots || this.animating) return;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 220, 120, 0.9)";
    ctx.fillStyle = "rgba(255, 220, 120, 0.9)";
    ctx.font = "10px sans-serif";
    for (const o of this.scene.views[this.viewIdx].objects) {
      const x = Math.min(o.startRegionX, o.endRegionX);
      const y = Math.min(o.startRegionY, o.endRegionY);
      const w = Math.abs(o.endRegionX - o.startRegionX);
      const h = Math.abs(o.endRegionY - o.startRegionY);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      ctx.fillText(o.identifier, x + 2, y + 10);
    }
    ctx.restore();
  }

  /** decode a map container on demand (256-color palette) */
  renderMap(ctx: CanvasRenderingContext2D): void {
    const fb = new FrameBuffer();
    const d = decodeFrame(this.set.file.containers[this.set.mapLight].data, fb);
    const pal = displayPalette(paletteToRGBA(this.set.paletteRaw, 256));
    ctx.canvas.width = d.width;
    ctx.canvas.height = d.height;
    const img = ctx.createImageData(d.width, d.height);
    indexedToRGBA(fb.pixels, d.width, d.height, pal, img.data);
    ctx.putImageData(img, 0, 0);

    // scene markers via their map-pixel coordinates
    ctx.font = "9px sans-serif";
    for (const s of this.set.scenes) {
      // where you are in brass, everywhere else in ice — the page's own two
      // colours rather than a red/blue debug pair, and both stay legible over
      // the map flat's own palette
      ctx.fillStyle = s === this.scene ? "#d89c24" : "#60c0f0";
      ctx.beginPath();
      ctx.arc(s.xAxisMap, s.zAxisMap, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
