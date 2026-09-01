import { SetFile, Scene, FrameInfo, Transition, ObjectEntry, RIGHTTURNS, LEFTTURNS, roadsAt, turnRing } from "@dreamfactory/engine/df/set";
import { FrameBuffer, decodeFrame, paletteToRGBA, indexedToRGBA } from "@dreamfactory/engine/df/image";
import { displayPalette, screenGammaGeneration } from "./screen-gamma";
import { ShpFrame } from "@dreamfactory/engine/df/shp";
import { DfVersion } from "@dreamfactory/engine/df/version";
import { ENGINE_STEP_MS } from "@dreamfactory/engine/runtime/clock";
import { Value } from "@dreamfactory/engine/runtime/interp";
import { SetScripts } from "@dreamfactory/engine/runtime/setscripts";
import { GameSession, MOVE_SPEED_MS } from "@dreamfactory/engine/runtime/session";
import { DrawSignature } from "@dreamfactory/engine/runtime/signature";
import { PUPPET_ART_H } from "./puppet-view";
import { CachedFrame, RingCache } from "./ring-cache";
import { ScreenPresenter } from "./screen-presenter";
import { ClutDim, RoomLayer, ScreenDirector, dimPalette } from "./screen-director";
// the font drawstring() paints and stringwidth() measures with — one definition
// so pen advance matches the glyphs, and so both get the CJK fall-through
import { overlayFont } from "./fonts";

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
 * spent 2n+1 passes on n frames, so the 7-frame road wanted 15, and the turn
 * after it landed after `bombit` had played bedex.mov (#40). BOIL.SHP's coal
 * chute is the same shape and the same arithmetic (see `tick`, #15).
 *
 * So it is one constant now, not two. A scripted move used to be paced at 50 ms
 * and a player's at 90 — the split existed only because #40 had to be fixed
 * without reopening the feel decision, and the feel decision turns out to have
 * been the guess. A player's turn was 1.8x slower than the original's: measured
 * over every shipped set, 66% of turns hold one in-motion frame between adjacent
 * standpoints and 33% hold two, so a press was ~270 ms where TI.EXE takes ~150.
 * (User-reported: "when the real game TI.EXE is run in DosBox, the player
 * movement feels much faster".)
 *
 * It is one constant again and not two, but a player may now ask for a different
 * one for their OWN moves — see {@link SetViewer.playerPace} and
 * `GameSession.moveSpeed` (#222). This stays what a SCRIPT's move is paced at,
 * whatever they ask for, because the paragraphs above are what a script's move
 * has to be paced at.
 */
const FRAME_MS = ENGINE_STEP_MS;

/** cap on ticks spent waiting for a transition fade before walking anyway */
const MAX_FADE_WAIT_TICKS = 240;

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
  onNavigate: (direction: string) => void;
  onSceneJump: (scene: string) => void;
  onViewJump: (view: string) => void;
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
  readonly set: SetFile;
  private palette: Uint8ClampedArray;
  /** full 256-entry set palette — props colorize through the set's CLUT. Only
   *  its lower half is the set's own once a stage flat is up; see
   *  {@link bandPropPalette} */
  private propPalette: Uint8ClampedArray;
  // Pristine baselines for the CLUT-mixing opcodes (clut/mixclut). `palette`
  // and `propPalette` above are the EFFECTIVE (possibly dimmed) versions the
  // renderer uses; these are the untouched originals to dim from / restore to.
  private basePalette: Uint8ClampedArray;
  private basePropPalette: Uint8ClampedArray;
  /** active dim of the set CLUT (mixclut "set"/"current"); null = normal */
  private setDim: ClutDim | null = null;
  /** active dim of the stage-flat CLUT (mixclut "stage"/"current"); null = normal */
  private stageDim: ClutDim | null = null;
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
  private animationDone: (() => void) | null = null;
  /**
   * currentscene(dir) turn/walk driver. Installed on `session.onNavigate` for
   * the duration of a user gesture (keyDown / click) so scripts can drive the
   * camera from EITHER a keydown OR a mousedown handler — TAOOT's Morrow
   * kick-out (BRIDGE.STG monkey()) turns you to face Morrow from the OK button's
   * mousedown. Installed only around the gesture, not permanently: navigation
   * calls made later from animation-arrival scripts must stay inert (the
   * original engine's default keydown owns movement).
   */
  private navigate = (dir: string): void => {
    this.session.navHappened = true;
    // A move asked for while one is still running WAITS for it; it does not
    // vanish. `walk()` and `turn()` both open with `if (this.busy) return`,
    // which is right for a player leaning on a key and wrong for a script,
    // because a script is not repeating itself — every call it makes is a step
    // it means to take.
    //
    // BEDSIT1's air raid is where that shows. Its `gotowin` walks you to the
    // window and then turns you to face it:
    //
    //     currentscene ("strait")
    //     for count = 1 to 10
    //         forceupdate ()
    //     endfor
    //     currentscene ("right")
    //
    // Ten passes is the budget the game allows the road, and the roads it walks
    // are 6 and 7 frames. The turn came while the road was still moving, and was
    // dropped. The arrival view is right either way: from Scene2 you land on
    // View36 and one step RIGHT is View31, from Scene3 you land on View37 and one
    // step LEFT is View31, and View31 is the window. Dropping the turn is what
    // left you watching the bombing from the bed or the chair (#40).
    //
    // Waiting is half of it; the other half is the RATE the waited-for road
    // runs at — see {@link FRAME_MS}. Both are needed: at the 90 ms this used to
    // pace at, the 7-frame road spent 15 of its 10 passes, so the deferred turn
    // still landed after `bombit` had played bedex.mov.
    if (this.session.navFromScript) {
      // A player's move is untouched: it still drops when one is already
      // running, which is what keeps a held key from stacking up turns.
      void this.session.track(this.navigateAfterAnimation(dir), `navigate:${dir}`);
      return;
    }
    this.navigateNow(dir, this.playerPace);
  };

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

  /**
   * Let the transition fade finish (the render/tick loop drains it), then walk.
   * Tracked so busy/settle waits for it; capped so a stuck fade can't hang.
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
  private async walkAfterFade(pace: number): Promise<void> {
    for (let i = 0; i < MAX_FADE_WAIT_TICKS && this.session.fading; i++) {
      await this.session.nextFrame();
    }
    this.walk(pace);
  }

  /**
   * Let whatever is running finish, then make this move — see {@link navigate}
   * for why a scripted move waits instead of being dropped.
   *
   * Waits on {@link busy}, not just the animation: a road arrival queues its own
   * fade, and `turn()` is gated on the same flag, so waiting for the frames
   * alone left the turn arriving one step too early and dropped all over again
   * (measured: Scene2 stopped on View36 while Scene3 reached View31).
   *
   * Waits on the ENGINE's frame for the same reason {@link walkAfterFade} does:
   * a wall-clock poll answers a question about game time and makes the headless
   * oracle non-deterministic. Capped by the same tick budget, so an animation
   * that never ends cannot hang the script that asked.
   */
  private async navigateAfterAnimation(dir: string): Promise<void> {
    for (let i = 0; i < MAX_FADE_WAIT_TICKS && this.busy; i++) {
      await this.session.nextFrame();
    }
    if (this.busy) return; // gave up; do not stack a move onto a stuck one
    this.navigateNow(dir, FRAME_MS);
  }

  /** Perform the move — what {@link navigate} runs once it has decided nothing
   *  is in the way. `pace` is the ms per animation frame ({@link FRAME_MS}); it
   *  stays a parameter because a transition's walk sets its own. */
  private navigateNow(dir: string, pace: number): void {
    if (dir === "strait") {
      // A changeset earlier in this keydown chain (a door to another set) queues
      // a blacktoscreen fade that is still draining now — screentoblack/
      // blacktoscreen are non-blocking here, unlike TI.EXE's synchronous fade
      // loop. walk() is gated by session.fading, so wait the fade out first;
      // then walk into the arrived-in room (TAOOT: gstair3's staircase exit
      // lands at recept1c's arrival scene, then walks into the reception hall).
      if (this.session.fading) void this.session.track(this.walkAfterFade(pace), "walkAfterFade");
      else this.walk(pace);
    } else if (dir === "left") this.turn(LEFTTURNS, pace);
    else if (dir === "right") this.turn(RIGHTTURNS, pace);
  }

  /** buffered currentscene("sceneNNN") teleport target, consumed by the paired
   *  currentview("viewNNN"). Reset at the start of every input gesture. */
  private pendingJumpScene: string | null = null;
  private sceneJump = (scene: string): void => {
    this.session.navHappened = true;
    this.pendingJumpScene = scene;
  };
  private viewJump = (view: string): void => {
    this.session.navHappened = true;
    const scene = this.pendingJumpScene;
    this.pendingJumpScene = null;
    this.teleport(scene, view);
  };

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
   * Runaway jumps are held off by {@link SetScripts.inLifecycle} rather than by
   * this gate, which is why lifting it here is safe: the fourteen Dust openscene
   * handlers that jump — `hotupper.set`'s among them, which hangs the tab — are
   * stopped inside {@link teleport} and always were.
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
   * the inner press used to tear down the outer press's hooks and hand the
   * script back a dead camera for the rest of its life.
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
   * `currentscene("right")` after it went to a no-op, so view22 never came
   * round: the room stopped answering with the player still facing the rope —
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
     * gets a private screen with the same behaviour — which is exactly the
     * fallback the `screen` parameter used to be, one level up.
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
    session.currentSceneName = () => this.scene.sceneName.toLowerCase();
    // currentview() returns the pseudo-view "moving" while the camera is
    // animating a turn/walk (this.animation in flight), matching TI.EXE — a
    // scripted camera pan waits it out with `while currentview()="moving":
    // forceupdate()` (the bomb window pan, BEDSIT1 gotowin). Only once the
    // motion settles does it report the arrived view name.
    session.currentViewName = () =>
      this.animating ? "moving" : this.scene.views[this.viewIdx].viewName.toLowerCase();
    session.currentRotation = () => this.scene.views[this.viewIdx].rotation;
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
    // ...and now that this set's star table is the one in hand, seat the actors
    // and props that were placed on it from somewhere else — see
    // ActorRuntime.settleStars and PropRuntime.settleStars
    // ...and remember this set's stars by name, so a script running in another
    // room can still walk somebody here (GameSession.starRegistry)
    for (const a of set.actors) session.starRegistry.set(a.identifier.toLowerCase(), a);
    session.actorRuntime.settleStars(set.actors, (n) => session.scheduler.isWalk(n));
    session.propRuntime.settleStars(set.actors, set.version === 1);
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
    await this.scripts.openSet();
    // A load restores the room rather than arriving in it, and the original fires
    // no scene entry for one — see GameSession.restoringSave. The scene is still
    // recorded as current, so the first turn or step re-fires it normally.
    if (this.session.restoringSave) {
      this.scripts.lastSceneIdx = this.sceneIdx;
      return;
    }
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
   * Which makes it a trap for a TEST, and one that has already been walked into:
   * 21 checks in the suite reach a state with this, and `openscene` is a per-VIEW
   * event that 33 of the 51 shipped handlers gate on `currentview()`. So anything
   * asserted about view-gated behaviour after a `jumpTo` is asserted against a
   * state the game cannot arrive in. Diagnosing #88 that way produced a bug report
   * (#96) for a defect that did not exist: the flag under test still held the value
   * the set's opening `openScene` had left, because nothing here had recomputed it,
   * and 200 further engine steps of watching it never would.
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
    this.viewIdx = v >= 0 ? v : 0;
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
    // NOTE (measured, and left alone deliberately): a press made while a FADE is
    // ramping — and nothing else is — is DROPPED. The queue in `keyDown` asks
    // `movingCamera` (a camera move or a script in flight) and the refusal just
    // below it asks `inputLocked`, and the two differ by exactly
    // `session.fading`: a press in that gap misses the queue, is refused, and
    // then finds `walk()` gated on the same fade. Nothing anywhere says so.
    //
    // It is a real infidelity — TI.EXE's fade is a synchronous loop INSIDE the
    // handler, so the press waits in the OS buffer and the main loop pops it
    // after; ours is deferred to the tick loop and outlives the script that
    // started it, a state the original never has. But both fixes for it move the
    // headless ORACLE, because the routes press during fades constantly and all
    // 29 goldens are recorded with the press dropped: queueing it broke 4 of the
    // 32 headless tests, and waiting it out inside the gesture broke 11. Whoever
    // takes this on should re-record the goldens deliberately rather than as a
    // side effect.
    //
    // What it cost meanwhile, so the shape is on record: segment 23 presses up
    // at TAOOT ENGINE.SET's View120 while the fight's closing fade is still ramping (level
    // 0.4 of 1, ~1.5 s of real time) and NO keydown handler runs at all —
    // `engine.keydown`, the only way into the smokestack, never sees the key. The
    // browser suite reported "pressing up at View120 did not take us into the
    // stack" 120 s later. The tell was accidental: adding 1.5 s of
    // instrumentation before the press made it land.
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

  /** which engine wrote this room — v1 merges actors and world props into one
   *  depth-sorted list, v4 draws them in two passes (compositeWorld) */
  get roomVersion(): DfVersion {
    return this.set.version;
  }

  /** is the camera mid-turn, mid-walk or mid-road? */
  get roomAnimating(): boolean {
    return this.animating;
  }

  /** the view frame on the screen now, or null before the first settle */
  roomFrame(): CachedFrame | null {
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
   * The set half of what used to be the viewer's own `setClut` — the stage half,
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
   * Taking all 256 from the set looked equivalent because 74 of the 75 carry a
   * byte-identical copy of main.stg's upper half — dead bytes in TI.EXE, which
   * is how one of them got to drift without anyone noticing. bridge.set is that
   * one: its copy is uniformly darker (median 0.82x the red channel), so the
   * band's `light` plate, a solid 251x120 rectangle, stopped matching the flat
   * it is drawn over and the middle third of the band grew a seam down both
   * sides of it (#158, reported in the guided tour and only ever there).
   *
   * Memoised like {@link flatPalette}, and on the same three things plus which
   * stage's palette it composed: this runs on every frame that draws a band.
   */
  private worldPal: { stage: Uint8ClampedArray; dim: ClutDim | null; gen: number;
                      out: Uint8ClampedArray } | null = null;
  bandPropPalette(stageBase: Uint8ClampedArray): Uint8ClampedArray {
    const gen = screenGammaGeneration();
    const hit = this.worldPal;
    if (hit && hit.stage === stageBase && hit.dim === this.setDim && hit.gen === gen) return hit.out;
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
      this.session.audio.play("theme", theme, { loop: true });
      this.session.currentThemeName = key;
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
    this.sceneIdx = s >= 0 ? s : 0;
    const scene = this.scene;
    const v = scene.views.findIndex((vw) => vw.viewName === this.set.defaultViewName);
    this.viewIdx = v >= 0 ? v : 0;
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
    const travelDir = reg.frames[reg.frames.length - 1].axisX;
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
        // low-res frame, which is the right-turn ring and nothing else
        return fi.motionInfo === 1 ? both() : [(sharp ?? soft)!];
    }
  }

  /**
   * The standpoint frame image of the current view — hi-res, which is what a
   * settled view is drawn from (#68), unless the player has asked for the
   * low-res one everywhere, which is what "always soft" means: not a soft
   * landing followed by a sharpen, but a room that stays soft (#75).
   */
  private standFrame(): CachedFrame | null {
    const fi = this.standFrameInfo();
    if (!fi) return null;
    const own = this.rings.ensure(this.scene.turns[RIGHTTURNS].frames).get(fi.frameContainerLoc);
    if (this.session.pictureMode === "soft") return own ?? this.hiResImage(fi) ?? null;
    return this.hiResImage(fi) ?? own ?? null;
  }

  private showView(): void {
    this.warmDone = false; // a new standpoint has new neighbours to warm
    this.current = this.standFrame();
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
    if (!f || !f.z) return null;
    const levels = this.set.zLevelCount || 24;
    const scale = this.set.zFarMax / levels;
    if (!(scale > 0)) return null;
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
    // DECKBD 55/m; the old cameraHeight×512 only held for C73's scale and
    // floated deck cameras 2-3× too high).
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
   * Fired, not awaited — the interpreter is async and a synchronous host loop
   * must still see the animation start this tick. In a real host the chain
   * resolves in the microtasks before the next paint, which is all the fix
   * needs. Two divergences from TI.EXE, both accepted: it CANCELS the move if
   * a closescene handler jumps the scene (0x407ce6) — no shipped closescene
   * navigates, so the cancel is not modelled — and a closescene that waits on
   * frames (HALLA's jay-walk spin) overlaps the animation here instead of
   * holding it. {@link settleScene} chains the arrival openscene on this
   * promise so the pair cannot run out of order even then.
   */
  private departScene(label: string): Promise<void> {
    return this.session.track(this.scripts.closeScene(this.sceneIdx), label);
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
   * dark, the warps' changeset still fired but the jumps were dropped, and
   * every deck-b/c climb landed at the arriving set's DEFAULT scene. A
   * changeset in the chain swaps the viewer and re-arms on the new one (host
   * activateSet, keyed on navGestureActive); disarming writes the shared
   * session fields, so doing it through the old viewer is fine.
   */
  private settleScene(departure: Promise<void>, sceneIdx: number, label: string): void {
    void this.session.track(
      departure.then(async () => {
        const prev = this.armNavHooks();
        try {
          await this.scripts.openScene(sceneIdx);
        } finally {
          this.disarmNavHooks(prev);
        }
      }),
      label,
    );
  }

  /** dir: RIGHTTURNS or LEFTTURNS. `pace` defaults to the PLAYER's rate: every
   *  caller that omits it is standing in for a keypress (the arrow fallback in
   *  {@link pressNav}, the headless drivers, the route planner). */
  turn(dir: number, pace = this.playerPace): void {
    if (this.busy) return;
    // shared with the playthrough route planner (df/set.ts) so a planned turn and
    // the turn actually taken can never land on different standpoints
    const ring = turnRing(this.scene, this.viewIdx, dir);
    if (!ring) return;
    const images = this.rings.ensure(this.scene.turns[dir].frames);
    const frames = this.turnFrames(ring.frames, images);
    const target = ring.target;
    // departure closescene BEFORE the first frame — see departScene. TI.EXE
    // fires it for every turn command, ring wrap included (0x407cbb runs for
    // left/right/strait alike), so no `changed` gate here or on the arrival.
    const departure = this.departScene("turn-closescene");
    this.startAnimation(frames, pace, () => {
      // update the facing BEFORE firing openscene — a per-view event — so its
      // handlers see the new currentview() in their guards
      this.viewIdx = target;
      this.showView();
      this.settleScene(departure, this.sceneIdx, "turn-openscene");
    });
  }

  availableRoads(): { road: Transition; register: number; arriveViewID: number }[] {
    return roadsAt(this.set, this.globalViewID);
  }

  /** see {@link turn} for what an omitted `pace` means */
  walk(pace = this.playerPace): void {
    if (this.busy) return;
    const roads = this.availableRoads();
    if (!roads.length) return;
    const { road, register, arriveViewID } = roads[0];
    const reg = road.frameRegisters[register];
    const images = this.rings.ensure(reg.frames);
    const frames = reg.frames
      .map((fi) => images.get(fi.frameContainerLoc))
      .filter((f): f is CachedFrame => !!f);
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
    // reused flight is off by whole decks. The port does present those beats,
    // one tick each, which pasted the crowd 140–210 px down the frame for
    // exactly one frame (shift = 256 * Δy / depth).
    //
    // So each end borrows its standpoint's HEIGHT — the departure end from the
    // view being stood on (whose camera is on screen at that instant), the
    // arrival end from the view the settle is about to show. Height only, and
    // ends only: a no-op for the 1851 rows that already agree, and the interior
    // frames keep their own per-frame heights so a stair road still ramps
    // continuously. Cloned, not patched — the CachedFrames are shared with the
    // ring cache.
    if (frames.length) {
      const pinHeight = (frame: CachedFrame, stand: FrameInfo | null): CachedFrame =>
        !frame.cam || !stand || frame.cam.z === stand.posY16
          ? frame
          : { ...frame, cam: { ...frame.cam, z: stand.posY16 } };
      frames[0] = pinHeight(frames[0], this.standFrameInfo());
      const arrive = arrival
        ? this.standFrameInfoOf(this.set.scenes[arrival.sceneIdx], arrival.viewIdx)
        : null;
      frames[frames.length - 1] = pinHeight(frames[frames.length - 1], arrive);
    }
    if (arrival && this.session.pictureMode === "transition") {
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
    const departure = this.departScene("walk-closescene");
    this.startAnimation(frames, pace, () => {
      if (arrival) {
        this.sceneIdx = arrival.sceneIdx;
        this.viewIdx = arrival.viewIdx;
      }
      // openscene at the settled scene — after the indices update, so its
      // handlers see the new currentview() (gstair's deck-transition scenes
      // forward via changeset from their openscene). A walk that stays in the
      // same scene owes it too: openscene is a per-view event.
      this.settleScene(departure, this.sceneIdx, "walk-openscene");
      this.showView();
    });
  }

  /**
   * hotspot under the given view-pixel position in the current view. When
   * regions OVERLAP, the SMALLEST (most specific) one wins — a small control
   * sitting inside a larger backdrop must be clickable (TAOOT C73's door-ringer
   * is a 19×19 hotspot fully inside the 200×246 "door", so first-in-list order
   * alone left it unreachable).
   */
  hitTest(x: number, y: number): { objIdx: number; obj: ObjectEntry } | null {
    if (this.busy) return null;
    const objects = this.scene.views[this.viewIdx].objects;
    let best: { objIdx: number; obj: ObjectEntry } | null = null;
    let bestArea = Infinity;
    for (let o = 0; o < objects.length; o++) {
      const obj = objects[o];
      const x0 = Math.min(obj.startRegionX, obj.endRegionX);
      const x1 = Math.max(obj.startRegionX, obj.endRegionX);
      const y0 = Math.min(obj.startRegionY, obj.endRegionY);
      const y1 = Math.max(obj.startRegionY, obj.endRegionY);
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
        const area = (x1 - x0) * (y1 - y0);
        if (area < bestArea) {
          bestArea = area;
          best = { objIdx: o, obj };
        }
      }
    }
    return best;
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
   * This used to fall through to {@link clickFlatSurface}, which is the STAGE's
   * answer and belongs to a click in the band. In a room that meant the current
   * flat's mousedown ran for a click on the floor — in TAOOT the current flat is
   * main.stg's `main 1`, whose mousedown is `sendtoshop("house.shp",
   * deactivateinterface())`: clicking the carpet darkened the watch, shut the bag,
   * reset the nav arrow and played `lightoff`. That is the band's own behaviour —
   * click the band background and the interface goes away — reached from the one
   * place the shipped hit test never sends it.
   */
  private async clickScene(): Promise<void> {
    const name = this.scene.sceneName.toLowerCase();
    await this.session.sendEvent(
      "sendtoscene", name, "mousedown", [this.session.pointerPoint()], name,
    );
  }

  /** nothing specific was hit: flat script -> stage script */
  private async clickFlatSurface(): Promise<void> {
    const flat = this.session.flatScripts.get(this.session.currentFlat.toLowerCase());
    const interp = this.session.interp;
    interp.eventConsumed = false;
    for (const inst of [flat, this.session.stageScript]) {
      if (!inst || !inst.script.codes.has("mousedown")) continue;
      try {
        const res = await interp.runHandler(inst, "mousedown", [""], { me: inst.name, target: "" });
        if (interp.eventConsumed || (res.handled && !res.passed)) return;
      } catch (e) {
        this.onLog(`script error in ${inst.name}.mousedown: ${(e as Error).message}`);
      }
    }
  }

  /** the front-most prop sprite under a screen position — world-projected
   *  while the set is visible, screen-space over an overlay flat */
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

  private startAnimation(frames: CachedFrame[], pace: number, done: () => void): void {
    if (!frames.length) {
      done();
      return;
    }
    this.animation = frames;
    this.animationPos = 0;
    this.animationPace = pace;
    this.animationDone = done;
    this.lastTick = 0;
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
    if (this.animation) {
      // The first frame is due NOW, not one interval from now (#352).
      //
      // Backdating the stamp by a whole interval is what makes the frame below
      // due on this very tick. Stamping `now` instead spent the first tick of
      // every animation initialising the clock and drawing nothing, so a move
      // took one interval longer than the frames in it — 200 ms for a 3-frame
      // turn paced at 50.
      //
      // The original draws it inside the gesture: 0x439e10 shows frame 0 before
      // the keypress returns, which is the same disassembly {@link walk} reads
      // for why a register's end rows are never presented. So the interval is
      // the port's, and it is not a rounding error — it is a full standpoint's
      // worth of stillness on every turn and every walk.
      //
      // C59 is where it was reported. Zeitel's entry turns you to face the door
      // with `while currentview() != "view29": currentscene("right")`, and the
      // road lands you four standpoints away, so the loop makes four turns of
      // three frames each. At 200 ms apiece the camera stopped dead on each
      // standpoint for 50 ms and the sweep read as separate turns; at 150 the
      // next turn starts on the tick the last one settles and it is one motion.
      // Measured, turn starts from the keypress: 400/600/800/1000 ms before,
      // 350/500/650/800 after.
      if (!this.lastTick) this.lastTick = now - this.animationPace;
      // ONE frame a tick, normally — and more than one only when the pace asks
      // for a frame more often than the host ticks (#222).
      //
      // At the engine step or slower, one a tick is what the original does: its
      // throttle (`0x43a940`) waits out the period and then draws exactly one
      // frame, so a machine that cannot keep up stretches the move rather than
      // dropping frames out of it, and every host we have ticks at least that
      // often (50 ms headless, the display's refresh in a browser). A stutter is
      // then a late frame, not a missing one, which is what it was before this.
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
          done();
        }
        if (!catchUp) break;
      }
      return this.current;
    }
    // The move has ended and nothing is running: take the next thing the player
    // did while it was, which is where the original's main loop pops its queue.
    // One per tick — the event it dispatches may start another animation, and
    // the next tick will find that and wait again.
    if (!this.dir.movingCamera && this.session.events.length) this.drainOneEvent();
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
    if (e.kind === "keydown") {
      const key = e.key;
      const nav = key === "uparrow" || key === "leftarrow" || key === "rightarrow";
      void this.session.track(
        nav ? this.pressNav(key) : this.keyDown(key, e.special).then(() => {}),
      );
      return;
    }
    void this.session.track(this.click(e.x, e.y), `queued click ${e.x},${e.y}`);
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
