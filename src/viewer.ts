import { SetFile, Scene, FrameInfo, Transition, ObjectEntry, RIGHTTURNS, LEFTTURNS, roadsAt, turnRing } from "./df/set";
import { FrameBuffer, decodeFrame, paletteToRGBA, indexedToRGBA } from "./df/image";
import { ShpFrame } from "./df/shp";
import { truthy } from "./engine/interp";
import { SetScripts } from "./engine/setscripts";
import { GameSession } from "./engine/session";
import { DrawSignature } from "./engine/signature";
import { MoviePlayer } from "./movie-player";
import { PuppetView } from "./puppet-view";
import { CachedFrame, RingCache } from "./ring-cache";
import { ScreenPresenter } from "./screen-presenter";
import { SCREEN_W, SCREEN_H } from "./screen";
// the font drawstring() paints and stringwidth() measures with — one definition
// so pen advance matches the glyphs, and so both get the CJK fall-through
import { overlayFont } from "./fonts";

/**
 * Navigation state machine over a parsed SET file. The decoded scenery frames
 * live in {@link RingCache}, a ring (turn circle / road direction) at a time.
 */

const FRAME_MS = 90; // ~11 fps for turn/walk animation, close to the original feel

/** cap on ticks spent waiting for a transition fade before walking anyway */
const MAX_FADE_WAIT_TICKS = 240;

/** smallest absolute difference between two angles in radians */
function angularDistance(a: number, b: number): number {
  const TAU = Math.PI * 2;
  let d = (a - b) % TAU;
  if (d < 0) d += TAU;
  return Math.min(d, TAU - d);
}

/** a mixclut(target,"black",lo,hi,amt) request: darken palette entries lo..hi */
interface ClutDim {
  lo: number;
  hi: number;
  amt: number;
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
 * Return a copy of `base` (an RGBA CLUT) with entries [lo..hi] blended toward
 * black by amt/255 — the engine's `mixclut(target,"black",lo,hi,amt)`. amt=255
 * is fully black, 0 leaves it unchanged; entries outside the range are kept.
 * (The darkroom kills the room light with mixclut("set","black",0,127,240).)
 */
function dimPalette(base: Uint8ClampedArray, dim: ClutDim): Uint8ClampedArray {
  const out = base.slice();
  const factor = Math.max(0, Math.min(255, 255 - dim.amt)) / 255;
  const lo = Math.max(0, dim.lo);
  const hi = Math.min(base.length / 4 - 1, dim.hi);
  for (let i = lo; i <= hi; i++) {
    out[i * 4] = base[i * 4] * factor;
    out[i * 4 + 1] = base[i * 4 + 1] * factor;
    out[i * 4 + 2] = base[i * 4 + 2] * factor;
    // alpha (i*4+3) left as-is
  }
  return out;
}

export class SetViewer {
  readonly set: SetFile;
  private palette: Uint8ClampedArray;
  /** full 256-entry set palette — props colorize through the set's CLUT */
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
   * signature-skip live in {@link ScreenPresenter}. Owned by the HOST and
   * handed in, so it outlives this viewer: a set change swaps the viewer, not
   * the screen the player is looking at.
   */
  readonly screen: ScreenPresenter;

  /** the "is this picture already on the canvas?" hash — see {@link render} */
  private readonly sig = new DrawSignature();

  sceneIdx = 0;
  viewIdx = 0; // index into scene.views
  showMap = false;
  showHotspots = false;

  private animation: CachedFrame[] | null = null;
  private animationPos = 0;
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
    // are 6 and 7 frames. Ours spends 2n+1 passes on n frames — the walk/turn
    // animation runs at FRAME_MS (90 ms) against a 50 ms service step — so the
    // road was still moving when the turn came, and the turn was dropped. The
    // arrival view is right either way: from Scene2 you land on View36 and one
    // step RIGHT is View31, from Scene3 you land on View37 and one step LEFT is
    // View31, and View31 is the window. Dropping the turn is what left you
    // watching the bombing from the bed or the chair (#40).
    //
    // Deferring rather than re-timing FRAME_MS keeps every animation in the game
    // at the speed it has, and it is host-independent: `forceupdate` is a 50 ms
    // step headless and a real frame in the browser, so no fixed frame budget
    // could have covered both.
    if (this.session.navFromScript) {
      // A player's move is untouched: it still drops when one is already
      // running, which is what keeps a held key from stacking up turns.
      void this.session.track(this.navigateAfterAnimation(dir), `navigate:${dir}`);
      return;
    }
    this.navigateNow(dir);
  };

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
  private async walkAfterFade(): Promise<void> {
    for (let i = 0; i < MAX_FADE_WAIT_TICKS && this.session.fading; i++) {
      await this.session.nextFrame();
    }
    this.walk();
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
    this.navigateNow(dir);
  }

  /** Perform the move — what {@link navigate} runs once it has decided nothing
   *  is in the way. */
  private navigateNow(dir: string): void {
    if (dir === "strait") {
      // A changeset earlier in this keydown chain (a door to another set) queues
      // a blacktoscreen fade that is still draining now — screentoblack/
      // blacktoscreen are non-blocking here, unlike TI.EXE's synchronous fade
      // loop. walk() is gated by session.fading, so wait the fade out first;
      // then walk into the arrived-in room (TAOOT: gstair3's staircase exit
      // lands at recept1c's arrival scene, then walks into the reception hall).
      if (this.session.fading) void this.session.track(this.walkAfterFade(), "walkAfterFade");
      else this.walk();
    } else if (dir === "left") this.turn(LEFTTURNS);
    else if (dir === "right") this.turn(RIGHTTURNS);
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
    this.session.onSceneJump = prev?.onSceneJump ?? (() => {});
    this.session.onViewJump = prev?.onViewJump ?? (() => {});
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
    this.sceneIdx = targetScene;
    this.viewIdx = v >= 0 ? v : this.viewIdx;
    this.showView();
    void this.session.track(this.refreshStandpointUi());
  }
  private lastTick = 0;
  private current: CachedFrame | null = null;

  /** MOV playback (cutscenes / object close-ups) — see movie-player.ts */
  private readonly movies: MoviePlayer;
  /** puppet-mode rendering (conversation close-ups) — see puppet-view.ts */
  private readonly puppetView: PuppetView;

  onHud: (text: string) => void = () => {};
  onLog: (line: string) => void = () => {};
  readonly scripts: SetScripts;

  readonly session: GameSession;

  constructor(
    set: SetFile,
    session: GameSession,
    startScene = "",
    startView = "",
    screen: ScreenPresenter | null = null,
  ) {
    this.set = set;
    this.session = session;
    this.rings = new RingCache(set);
    // the host passes its one persistent screen; a caller without one (tests
    // driving a bare viewer) gets a private surface with the same behaviour
    this.screen = screen ?? new ScreenPresenter();
    // the movie player reveals the settled view once a movie sequence ends
    this.movies = new MoviePlayer(session, () => this.showView());
    this.movies.onLog = (l) => this.onLog(l);
    this.puppetView = new PuppetView(session);
    this.basePalette = paletteToRGBA(set.paletteRaw, set.colorCount);
    this.basePropPalette = paletteToRGBA(set.paletteRaw, 256);
    this.palette = this.basePalette.slice();
    this.propPalette = this.basePropPalette.slice();
    // clut/mixclut palette dimming (darkroom light switch etc.)
    session.onClut = (target, dim) => this.setClut(target, dim);
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
    // crickets attenuate/pan against the camera's ground position + facing
    session.listener = () => {
      const sc = this.scene;
      const v = sc?.views[this.viewIdx];
      return v ? { x: sc.xAxisMap, y: sc.zAxisMap, deg: v.rotation8 } : null;
    };
    // hittest(point): resolve a screen pixel to an object name + kind. Every
    // script that dispatches a click or a cursor switches on this (BOOTFILE's
    // mousedown and idle, INVEN.SHP's handleselect and its drop flow, HOUSE.SHP's
    // band props), so its six answers ARE the port's click priority.
    //
    // Read out of TI.EXE rather than inferred, because the two labels it hands a
    // room were both wrong here and the corpus distinguishes them (id 20070 →
    // 0x4277f0):
    //
    //   1. one draw-ordered SPRITE list, asked before anything else and wherever
    //      the point is (0x43abc0); whatever it finds is then named by lookup —
    //      in a cast it is an "actor", in a shop a "prop"
    //   2. else, set open + visible + the point inside the SET's own screen rect
    //      (0x43ad50 → 0x435410): a hotspot of the current scene/view is a
    //      "painting" (0x409910), and where there is none the answer is the
    //      SCENE ITSELF, by name — not nothing, and not the flat behind it
    //   3. else, stage open + visible + inside the STAGE's rect (0x43ad20): a
    //      named click-region is a "button" (0x446fb0), else the current FLAT
    //   4. else "None" (the engine capitalises it; comparisons are caseless)
    //
    // A PROP first, in a room exactly as over a flat, and through the same
    // {@link propAtPointer} the click path uses, so the two agree by construction
    // rather than by two hit tests happening to match: that function is where a
    // room's camera, occlusion mask and opaque-pixel test live, and where an
    // overlay's absence of all three does. In a room this step was missing
    // entirely, so every prop in the world (TAOOT: the bag on the bed, the watch
    // on the table) answered for the room instead, and `case "prop"` was
    // unreachable.
    session.hitTestAt = (x, y) => {
      const prop = this.propAtPointer(x, y);
      if (prop) return { name: prop.group.name, type: "prop" };
      // the SET, while the point is inside the image it draws. In-game that image
      // is the top 264 rows and the interface band below it belongs to the stage,
      // which is how a band click reaches "main 1" at all (its mousedown is the
      // one that puts the interface away) while a click in the ROOM does not.
      if (this.inSetImage(x, y)) {
        // an actor stands in front of the view's hotspots — and ONLY inside this
        // image, because that is the only place one is drawn. A projected sprite
        // reaches past the bottom of it for anyone standing close to the camera,
        // so asking the actors first and everywhere answered "actor" over the
        // interface band: measured in TAOOT at 1558 band points in gstair2
        // (trask, elev), 1275 in b59 (conk), 1299 in recept1c. A prop is asked
        // first and unbounded, which is right — the band's own props ARE
        // screen-space.
        const cam = this.worldCamera();
        const act = cam ? this.session.actorRuntime.actorAt(x, y, cam, this.occlusion()) : null;
        if (act) return { name: act.member.name, type: "actor" };
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
      // `currentFlat` is "none" between openstagefile and the first flat, and a
      // stage standing on no flat has no regions and no surface to name.
      // The stage is OPEN or it is not — not "has a main script"; see
      // GameSession.stageOpen for the demo inventory that has no main.
      if (this.session.stageOpen && this.session.currentFlat !== "none") {
        const r = this.flatRegionAt(x, y); // same test hover() uses, so they agree
        if (r) return { name: r.name, type: "button" };
        return { name: this.session.currentFlat, type: "flat" };
      }
      // the engine capitalises this one ("None" at 0x45b1e4); script comparisons
      // are caseless, so a `case "none"` matches either way
      return { name: "", type: "none" };
    };
    // Snapshot the frame that is actually on screen. captureFrame runs from a
    // script (screentoblack) during tick(), i.e. BEFORE this frame's render, so
    // the screen still holds the last presented composite — the pre-transition
    // image the fade-out should hold. It is the pre-fade composite (applyFade
    // paints on the canvas, not into the framebuffer), so ramping the fade over
    // it can't double-darken. Before the first composite there is nothing on the
    // screen yet, so fall back to the bare set frame. The screen outlives this
    // viewer, so mid-set-change the snapshot is still the room being left.
    session.captureFrame = () => {
      const shot = this.screen.capture();
      if (shot) return shot;
      const f = this.current;
      if (!f) return null;
      const rgba = new Uint8ClampedArray(f.width * f.height * 4);
      indexedToRGBA(f.pixels, f.width, f.height, this.palette, rgba);
      return { rgba, width: f.width, height: f.height };
    };
    // return the promise so playmovie() blocks the script until the movie ends
    // (main.ts overrides this with a fetch-first version for on-demand movies)
    session.onPlayMovie = (name, startFrame) => this.playMovie(name, startFrame);
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

  /** position at a named scene/view (case-insensitive), e.g. from changeset() */
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
   * Keyboard event into the script chain. Boot's default keydown performs
   * walking/turning itself via the currentscene() setter (onNavigate), so
   * the return value covers both "a script exitcoded" and "we navigated".
   */
  async keyDown(keyName: string, special = false): Promise<boolean> {
    // A live movie owns the screen and its INPUT — the same precedence clicks
    // already get in click(), and for the same reason: the original has one
    // event queue and the movie loop is the one popping it while a movie
    // plays. So the key is consumed here whatever it is (ESC aborts, anything
    // else is eaten), and the script chain never sees it. `special` is
    // TI.EXE's 0x1fa0 marker — the key is ESC, or was held with Ctrl — which
    // its movie key filter requires; see MoviePlayer.key.
    if (this.movies.playing) {
      this.movies.key(keyName, special);
      return true;
    }
    if (this.inputLocked) return false;
    // a full-screen overlay stage (TAOOT's deck map) handles keys itself — page
    // decks with arrows/letters — instead of the world turn/walk navigation
    const target = this.session.stageCtrl.keydownTarget();
    if (!this.session.viewShowing && target) {
      try {
        await this.session.interp.runHandler(target, "keydown", [keyName], {
          me: target.name,
          target: "",
        });
      } catch (e) {
        this.onLog(`stage keydown: ${(e as Error).message}`);
      }
      return true;
    }
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
   * A press made while a move is already running is QUEUED, not dropped (see
   * {@link EventQueue}) — that is what makes holding a movement key walk a
   * corridor instead of one room. It is posted coalescing, so a held key keeps
   * exactly one press pending however long it is held, and letting go leaves at
   * most one more move to come. A movie or a conversation is NOT this case: both
   * consume keys themselves (ESC aborts a clip), so those go straight through.
   */
  async pressNav(key: "uparrow" | "leftarrow" | "rightarrow"): Promise<void> {
    // NOTE (measured, and left alone deliberately): a press made while a FADE is
    // ramping — and nothing else is — is DROPPED. This queue asks `movingCamera`
    // (a camera move or a script in flight) while `keyDown` refuses on
    // `inputLocked`, and the two differ by exactly `session.fading`: a press in
    // that gap misses the queue, is refused by keyDown, and then finds `walk()`
    // gated on the same fade. Nothing anywhere says so.
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
    if (this.movingCamera && !this.movies.playing && !this.session.puppet?.visible) {
      this.session.events.post({ kind: "keydown", key, special: false }, { coalesce: true });
      return;
    }
    if (await this.keyDown(key)) return;
    if (key === "uparrow") this.walk();
    else this.turn(key === "leftarrow" ? LEFTTURNS : RIGHTTURNS);
  }

  /**
   * A turn or walk is on screen, so a movement key cannot be acted on yet —
   * exactly the condition `turn()`/`walk()` refuse on. Deliberately NOT
   * {@link inputLocked}: that also covers movies, conversations and fades, which
   * take their own input rather than making the player wait.
   */
  private get movingCamera(): boolean {
    return this.animating || this.session.scriptBusy;
  }

  // ---- movies (playback lives in movie-player.ts) --------------------------

  get moviePlaying(): boolean {
    return this.movies.playing;
  }

  /** which clip is on screen (lowercase), or null — see MoviePlayer.playingFile */
  get movieFile(): string | null {
    return this.movies.playingFile;
  }

  /** play a movie modally — resolves when the whole chain ends (MoviePlayer) */
  playMovie(fileName: string, startFrame = 0): Promise<void> {
    return this.movies.play(fileName, startFrame);
  }

  /**
   * clut(target)/mixclut(target,…) host hook. `dim` null = restore the target's
   * normal palette (clut), a spec = darken it (mixclut). "current" resolves to
   * the set when the 3D view is showing, else the stage flat. The set CLUT is
   * rebuilt eagerly (set + world-prop palettes); the stage dim is applied to
   * the flat palette at render time (flats are cached per-name, so we mustn't
   * mutate the cache). clut("black") never reaches here — it's a no-op paired
   * with blackscreen() in movie transitions.
   */
  private setClut(target: string, dim: ClutDim | null): void {
    let t = target.toLowerCase();
    if (t === "current") t = this.session.viewShowing ? "set" : "stage";
    if (t === "set") {
      this.setDim = dim;
      this.palette = dim ? dimPalette(this.basePalette, dim) : this.basePalette.slice();
      this.propPalette = dim ? dimPalette(this.basePropPalette, dim) : this.basePropPalette.slice();
    } else if (t === "stage") {
      this.stageDim = dim; // consumed by flatPalette() during render
    }
    // A clut on the surface the SCREEN IS SHOWING is a repaint of what you are
    // looking at, and in TI.EXE that ends a transition black by construction:
    // a fade is a palette ramp there, and the clut writes the palette. TAOOT's
    // darkroom is the shipped case — `transtoflat("redphoto.stg")` puts up
    // `screentoblack("current")` and ends on `mixclut("stage", …, 245)` with
    // NO blacktoscreen, the dim palette itself being the reveal; our held
    // overlay fade kept it pitch black, red lamp and all. A clut on a surface
    // that is NOT showing stores palette state and reveals nothing — its CTL
    // exit runs `clut("set")` between a stage's screentoblack and its
    // blacktoscreen, and lifting the black there would flash the room in
    // early (same reasoning as visualeffect's reveal, one function up).
    const showing = this.session.viewShowing ? "set" : this.session.currentFlat !== "none" ? "stage" : "";
    if (t === showing && !this.session.puppet?.visible) {
      this.session.fade.queue.length = 0;
      this.session.fade.snapshot = null;
      this.session.fade.pendingReveal = false;
      this.session.fade.level = 0;
    }
  }

  /** the stage flat's effective palette, dimmed if a stage mixclut is active */
  private flatPalette(base: Uint8ClampedArray): Uint8ClampedArray {
    return this.stageDim ? dimPalette(base, this.stageDim) : base;
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
    const ring = this.scene.turns[RIGHTTURNS].frames;
    return ring.find((f) => f.viewID === this.viewIdx && f.motionInfo > 0) ?? null;
  }

  /** the standpoint frame image of the current view */
  private standFrame(): CachedFrame | null {
    const fi = this.standFrameInfo();
    if (!fi) return null;
    return this.rings.ensure(this.scene.turns[RIGHTTURNS].frames).get(fi.frameContainerLoc) ?? null;
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

  /**
   * Engine-side busy: something visual is in flight. Checked by walk/turn —
   * deliberately WITHOUT scriptBusy, because the engine default movement is
   * itself invoked from inside a running script (boot's keydown).
   */
  get busy(): boolean {
    return (
      this.animating ||
      this.movies.playing ||
      (this.session.puppet?.visible ?? false) || // conversation in progress
      this.session.fading
    );
  }

  /** a turn/walk camera animation is in flight */
  private get animating(): boolean {
    return this.animation !== null;
  }

  /** gate for NEW user input: also waits for running/suspended scripts */
  get inputLocked(): boolean {
    return this.busy || this.session.scriptBusy;
  }

  /**
   * The regions a parked movie is waiting on — see MoviePlayer.waitingRegions.
   * `type`, `target` and `event` come along because they say what a region DOES
   * (1 exit · 2 jump to the named frame · 3/4 chain to the movie named `event` ·
   * 6/7 step), and "where the exit is" is not answerable from the rectangles
   * alone: TAOOT's wireless message stack pages through telegrams on a type-2
   * region and only leaves on the plaque.
   *
   * `event` matters as much as the other two. TAOOT's Purser's desk
   * (`maino2.mov`) parks with TWO type-4 regions that share the target "win 1" —
   * one chains to `key.mov` and one to `purspost.mov` — and only the first leads
   * to the car keys, because `key.mov` is where action frame 1 is declared.
   * Without the chained movie's name the two are indistinguishable, and a caller
   * has nothing to name the gesture by but a rectangle.
   */
  get movieRegions(): readonly {
    type: number;
    target: string;
    event: string;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }[] {
    return this.movies.waitingRegions;
  }

  /** the engine has stopped and is waiting for the player to click something */
  get awaitingInput(): boolean {
    return this.movies.waitingRegions.length > 0 || this.awaitingChoice;
  }

  /**
   * A conversation is parked on a choice. `puppetevent` suspends the PUP
   * script until a bevel is clicked, so — like an interactive movie — the
   * engine is "busy" and will stay that way until the player answers.
   */
  get awaitingChoice(): boolean {
    return !!this.session.puppet?.eventWaiter;
  }

  /** the choices a parked conversation is offering, in bevel order */
  get choices(): { text: string; id: number }[] {
    return this.awaitingChoice ? [...(this.session.puppet?.bevels ?? [])] : [];
  }

  /**
   * Where those choices are on screen. A conversation is answered by clicking
   * a plaque, so anything driving the game — a test, a replay, a demo — needs
   * the rectangles, not just the text.
   */
  get choiceRects(): { x: number; y: number; w: number; h: number }[] {
    return this.awaitingChoice ? this.puppetView.bevelRects() : [];
  }

  /** a conversation close-up is on screen (speaking or waiting) */
  get conversing(): boolean {
    return this.session.puppet?.visible ?? false;
  }

  /**
   * WHO is on screen — the open puppet's name (`currentpuppet()`), or "" when
   * nobody is. The harness reports a conversation it could not get past, and
   * "a conversation is open in gstair3" leaves you to guess which of the four
   * people in that room it was; the name is already right here.
   */
  get conversingWith(): string {
    return this.conversing ? (this.session.puppet?.name ?? "") : "";
  }

  /**
   * The engine is not going to move again on its own — the point at which a
   * scripted playthrough may take its next step or sample a state trace.
   *
   * This is NOT `!inputLocked`. An interactive movie parked on its exit region
   * is `busy` (it is "playing") AND `scriptBusy` (the spotmovie() that opened
   * it is suspended), so by that measure the boot's own main menu never
   * settles — waiting for it is a guaranteed timeout, which is exactly what a
   * naive harness does before falling back to sleeps.
   *
   * It deliberately does NOT ask whether the event queue is empty, though a
   * queued press is something the engine has accepted and not yet acted on.
   * Making it wait for that shifts when a beat is sampled — measured, it moved
   * four of the headless goldens (22, 24, 26 and 29) — and the oracle is not
   * worth moving for it. `pressNav` keeps its own gesture atomic instead: what it
   * cannot act on yet it either waits out (a fade) or posts and lets the caller's
   * `scriptBusy` cover (a move already running).
   */
  get quiescent(): boolean {
    return this.awaitingInput || !this.inputLocked;
  }

  /**
   * the current view's depth map for occluding world sprites behind scenery.
   * scale (units/level) = zFarMax / zLevelCount from the SET's SCDO chunk.
   */
  private occlusion(): import("./engine/actors").Occlusion | null {
    const f = this.current;
    if (!f || !f.z) return null;
    const levels = this.set.zLevelCount || 24;
    const scale = this.set.zFarMax / levels;
    if (!(scale > 0)) return null;
    return { z: f.z, w: f.width, h: f.height, scale, levels };
  }

  /** camera of the current view, for world-space (propxyz) props */
  worldCamera(): import("./engine/props").WorldCamera | null {
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
  }): import("./engine/props").WorldCamera {
    const w = this.set.viewPortWidth || 512;
    const h = this.set.viewPortHeight || 264;
    return {
      x: pose.x,
      y: pose.y,
      // TI.EXE projection subtracts the `camerahi` bias from the point height
      // (dyHeight = ptY - camHeight - camerahi); adding it to the camera eye
      // here is equivalent and drops the halls' floating sprites onto the floor.
      z: pose.z + this.session.cameraHiBias,
      deg: pose.deg,
      f: Math.max(w, h) / 2,
      cx: w / 2,
      cy: h / 2,
      clipW: w,
      clipH: h,
    };
  }

  /** camera to project world sprites onto the frame shown right now — the
   *  moving motion-frame camera during a turn/walk, else the standpoint */
  private activeCamera(): import("./engine/props").WorldCamera | null {
    if (this.animating) {
      return this.current?.cam ? this.cameraFrom(this.current.cam) : null;
    }
    return this.worldCamera();
  }

  /**
   * Recompute the nav-arrow colour for the current (settled) view by running
   * the interface shop's setuparrow() (TAOOT: house.shp). Turns fire
   * viewChanged(), which deliberately SKIPS boot's openscene — and setuparrow
   * lives there — so without this an arrow left "red" by closescene() never
   * updates after a turn (walks were fine because they run the full openScene).
   * Called at movement END so the colour reflects where you ended up, not
   * closescene's default.
   */
  private refreshNavArrow(): Promise<unknown> {
    return this.session.sendEvent("sendtoprop", "navarrow", "setuparrow", [], "navarrow-refresh");
  }

  /**
   * Rebuild the top-right destination sign for the current (settled) view by
   * running the interface shop's setupsigns(). Same problem as the nav arrow:
   * boot's closescene() hides the sign (initprop) on every scene event, but
   * setupsigns lives in boot's openscene, which viewChanged() and same-scene walks skip —
   * so without this the sign vanishes on a turn (or in-scene walk) and never
   * comes back. setupsigns() re-hides then re-picks the sign for currentset()/
   * currentview(), so it's safe to call at every movement END.
   */
  private refreshSigns(): Promise<unknown> {
    return this.session.sendEvent("sendtoprop", "signs", "setupsigns", [], "signs-refresh");
  }

  /** movement-END housekeeping: the nav arrow and the destination sign are
   *  always recomputed together for the settled standpoint (see the two
   *  methods above for why the boot scripts don't do it themselves) */
  private async refreshStandpointUi(): Promise<void> {
    await this.refreshNavArrow();
    await this.refreshSigns();
  }

  /** dir: RIGHTTURNS or LEFTTURNS */
  turn(dir: number): void {
    if (this.busy) return;
    // shared with the playthrough route planner (df/set.ts) so a planned turn and
    // the turn actually taken can never land on different standpoints
    const ring = turnRing(this.scene, this.viewIdx, dir);
    if (!ring) return;
    const images = this.rings.ensure(this.scene.turns[dir].frames);
    const frames = ring.frames
      .map((fi) => images.get(fi.frameContainerLoc))
      .filter((f): f is CachedFrame => !!f);
    const target = ring.target;
    this.startAnimation(frames, () => {
      const changed = target !== this.viewIdx;
      // update the facing BEFORE firing viewChanged so the scene's openscene
      // (a per-view event) sees the new currentview() in its guards
      this.viewIdx = target;
      this.showView();
      if (changed) {
        void this.session.track(
          (async () => {
            await this.scripts.viewChanged(this.sceneIdx);
            // viewChanged runs closescene (→ arrow red, sign hidden) but not
            // boot's openscene (→ setuparrow/setupsigns), so recompute both.
            await this.refreshStandpointUi();
          })(),
        );
      }
    });
  }

  availableRoads(): { road: Transition; register: number; arriveViewID: number }[] {
    return roadsAt(this.set, this.globalViewID);
  }

  walk(): void {
    if (this.busy) return;
    const roads = this.availableRoads();
    if (!roads.length) return;
    const { road, register, arriveViewID } = roads[0];
    const reg = road.frameRegisters[register];
    const images = this.rings.ensure(reg.frames);
    const frames = reg.frames
      .map((fi) => images.get(fi.frameContainerLoc))
      .filter((f): f is CachedFrame => !!f);
    this.startAnimation(frames, () => {
      // arrival scene: the register's `destination` is the container index
      // of the arrival scene's view table; fall back to the scene owning the
      // road's far-end global view id
      let sceneIdx = this.set.scenes.findIndex((s) => s.locationViews === reg.destination);
      if (sceneIdx < 0) {
        sceneIdx = this.set.scenes.findIndex((s) =>
          s.views.some((vw) => vw.viewID === arriveViewID),
        );
      }
      if (sceneIdx >= 0) {
        const prevScene = this.sceneIdx;
        this.sceneIdx = sceneIdx;
        // arrival view: keep facing the direction of travel — the road's
        // endpoint view faces BACK along the road, so match the last walked
        // frame's camera angle against the scene's view rotations instead
        const travelDir = reg.frames[reg.frames.length - 1].axisX;
        this.viewIdx = this.nearestView(this.scene, travelDir);
        // lifecycle events fire AFTER arrival — openscene handlers check
        // currentview() (gstair's deck-transition scenes forward via
        // changeset from their openscene)
        if (sceneIdx !== prevScene) {
          void this.session.track(
            (async () => {
              // The arrival scripts DRIVE THE CAMERA in the original —
              // currentscene()/currentview() are unconditional setters there —
              // so arm the nav hooks around this lifecycle the way keydown and
              // press do around theirs. Only three openscene handlers in the
              // whole TAOOT corpus set the camera, and each one needs it live:
              // the demo's grand-staircase deck warps (gstair2 Scene64/Scene65,
              // `changeset(theset); currentscene(thescene); currentview(theview)`
              // — the demo build's script style; the full game passes the pair
              // INSIDE changeset instead) and C59's Zeitel entry, which turns
              // you to face him with a currentscene("right") loop. With the
              // hooks dark, the warps' changeset still fired but the jumps
              // were dropped, and every deck-b/c climb landed at the arriving
              // set's DEFAULT scene — the reported "wrong location" walking
              // forward from gstair2 Scene50/View53. A changeset in the chain
              // swaps the viewer and re-arms on the new one (host activateSet,
              // keyed on navGestureActive); disarming writes the shared
              // session fields, so doing it through the old viewer is fine.
              const prev = this.armNavHooks();
              try {
                await this.scripts.closeScene(prevScene);
                await this.scripts.openScene(sceneIdx);
              } finally {
                this.disarmNavHooks(prev);
              }
              await this.refreshStandpointUi();
            })(),
          );
        } else {
          // a walk that stays in the same scene fires no openscene, so the arrow
          // and sign would keep the previous view's — recompute for the arrival.
          void this.session.track(this.refreshStandpointUi());
        }
      }
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

  /**
   * A whole click — press then release at the same point.
   *
   * Kept for callers that have no press/release of their own to give (the
   * headless drivers, scripted input). Real input goes through
   * {@link press} / {@link release}, because a conversation answers on the
   * RELEASE and only if it lands on the row the press started on.
   */
  async click(x: number, y: number): Promise<void> {
    await this.press(x, y);
    this.release(x, y);
  }

  async press(x: number, y: number): Promise<void> {
    // publish the cursor position so scripts that hit-test themselves (stage
    // flats, draggable props) read the click via mouse()/pointx/pointy. The
    // caller (pointerdown) has already set pointerDown, so held-button drag
    // loops (`while stilldown()`) see the button held.
    this.session.setPointer(x, y);
    // let mousedown handlers drive the camera via currentscene() (the bridge's
    // Morrow kick-out turns you to face him from the OK button); restored to a
    // no-op on exit so navigation stays scoped to this gesture.
    const prevHooks = this.armNavHooks();
    try {
      // TRACKED, because a click is a script and the engine is single-threaded.
      // Nothing else held the engine for the length of one: `session.track` is
      // what `scriptBusy` counts, and a click went untracked — so while a
      // hotspot's `spotmovie` sat modal on the screen, `inflight` was 0 and the
      // scheduler read the engine as free and dispatched loops over it.
      //
      // Which is a softlock in the London flat (#33). The air raid arms
      // `makeloop("scene", "scene1", "bomb", random (100))` the moment
      // bombpoints passes 10 — so it comes due while you are still looking at
      // whatever you clicked to score that point — and `bomb` -> `gotoship` ->
      // the scene's `gotowin` turns you to the window with a bare
      //
      //     while currentview () != "view23"
      //         currentscene ("right")
      //         …
      //     endwhile
      //
      // A movie owns the screen, so `currentscene()` cannot turn, so that view
      // never comes round and the loop never ends: the sirens play (the loop
      // that started them fired) over a room that has stopped answering, with
      // the movie's watch cursor still up. Measured from the reporter's own
      // standpoint, Scene3/View22, and from Scene2/View14; Scene1 escapes it
      // because its `gotowin` is already on the window and never turns.
      //
      // `fireDueLoops` was always going to be the thing that fixed it — it has
      // held firing on `scriptBusy` all along, and keeps counting down while it
      // waits, so nothing is slowed. It simply was not being told.
      return await this.session.track(this.clickDispatch(x, y), "click");
    } finally {
      this.disarmNavHooks(prevHooks);
    }
  }

  /**
   * The button came up. Only a conversation cares: it is the release, not the
   * press, that answers, and only on the row the press began on.
   */
  release(x: number, y: number): void {
    if (!this.session.puppet?.visible) return;
    this.session.puppetCtrl.puppetRelease(this.puppetView.bevelAt(x, y));
  }

  /**
   * The click priority chain — who gets a click, front to back:
   * movie → puppet bevels → overlay-stage regions → props → actors →
   * view hotspots → the flat/stage surface itself.
   */
  private async clickDispatch(x: number, y: number): Promise<void> {
    // Capture busy state up front: this dispatch is itself tracked (adds to
    // inflight), and in an overlay stage the `await stageClickAt` below
    // suspends us long enough for our own promise to register — which would
    // otherwise make the inputLocked gate reject the prop path spuriously.
    const busyOnEntry = this.inputLocked;
    // A live movie owns the screen and its clicks — even over a suspended
    // conversation (spotmovie's interactive penote.mov in the Smethells
    // briefing): an interactive movie waits for a click to step/finish, so this
    // must be checked before the puppet branch or the movie can never advance.
    if (this.movies.playing) {
      this.movies.click(x, y);
      return;
    }
    // conversation clicks reach the puppet even while its script is
    // suspended in puppetevent/puppetspeak — but only while it is shown; a
    // hidden puppet (blackjack table between prompts) lets clicks reach the flat
    if (this.session.puppet?.visible) {
      this.session.puppetCtrl.puppetPress(this.puppetView.bevelAt(x, y));
      return;
    }
    // `lockevents` freezes the world: the scripts set it when the game is doing
    // something to you and a click must not interrupt. The BOOTFILE's own
    // mousedown exitcodes on it before hittest, in exactly this position — after
    // the puppet branch, so a conversation still answers while locked (TAOOT:
    // the turbine's OK locks and then csea thanks you through a puppet). Keys
    // have always honoured it, because the boot's keydown tests it and keys go
    // through the chain; clicks are dispatched here instead of by that handler,
    // so the gate has to be here too. Eight TAOOT windows rely on it, and two
    // are places a player will click: the London air raid, where `gotowin`
    // takes the camera off you for a second, and the turbine puzzle's OK, whose
    // trigger loop runs with the world frozen. A save taken from the CTL panel
    // carries lockevents=1,
    // which is why loadGame clears it (see saveload) — otherwise the restored
    // game would come up unclickable.
    if (truthy(this.session.interp.globals.get("lockevents") ?? 0)) return;
    // a full-screen overlay stage (the deck map) resolves clicks through its
    // own click-logic regions — deck buttons, OK, red-area jumps. But when a
    // script is already suspended in an interactive poll loop (the crank play
    // loop, drag loops), that loop OWNS the input: it reads mouse()/button()
    // itself and dispatches the button by name (sendtobutton). Dispatching the
    // region here too would run the same handler twice concurrently (the trunk
    // OK would close the flat while the play loop's cleanup still runs). The
    // original engine is single-threaded: a modal loop pumps input, nothing
    // interleaves — so while busy, just publish the pointer and stand back.
    // ...and a click made while something IS running waits its turn instead of
    // being thrown away (TI.EXE queues it — see EventQueue). This is the case
    // `flushevents()` exists for: a poll loop reads the press itself, so the copy
    // in the queue is a leak into whatever comes next, and the loops that end on
    // a press discard it (all 92 call sites in the TAOOT corpus — its trunk play
    // loop, the Enigma keys, the inventory, the CTL panel). What it buys is the
    // ordinary case: a click during a door's animation, or during a walk, is not
    // lost.
    if (busyOnEntry) {
      // ...unless a script is polling the button right now, in which case this
      // press IS its input and queueing a second copy would replay it into
      // whatever comes next (GameSession.pollingInput).
      if (!this.session.pollingInput()) this.session.events.post({ kind: "mousedown", x, y });
      return;
    }
    // Over an overlay flat, a PROP outranks a click region, and this order is
    // not a guess — the BOOTFILE's own mousedown (TAOOT container 0001) is the
    // whole rule:
    //
    //     thename = hittest (thepoint)
    //     switch result ()
    //     case "prop"    sendtoprop (thename, mousedown (thepoint))
    //     case "button"  sendtobutton (currentflat (), thename, mousedown (…))
    //     case "flat"    sendtoflat (thename, mousedown (thepoint))
    //
    // so it is also the order {@link SetViewer.hitTestAt} already answers in, and
    // the two used to disagree: this dispatched the region first, so anything
    // aiming by hit test was told a prop would take the click and then it didn't.
    //
    // Two TAOOT flats say it out loud. FUSE.SHP's `fuseokdark` script is one line
    // — `sendtobutton(currentflat(), me, mousedown(0))` — a prop hand-forwarding
    // its click to its own region BY NAME, which is only ever written if the prop
    // is what the click reached; region-first made it dead code. And PATTY.STG's
    // `"patty 1"` cannot be played at all the other way round: its `doll1` and
    // `dial` regions between them cover the left half of the doll sprite, so the
    // matryoshka — whose whole interaction is clicking its left half to open it
    // (PATTY.SHP 0003) — was unclickable, which is where this was found.
    //
    // The regions still get everything no prop's opaque pixels are under, which
    // is how `doll1` is reached at all: the doll is invisible until the
    // combination is right, so the region takes the click, and once the doll is
    // out it covers its own region. Same shape in the fusebox, where `fusedoor`
    // closed spans x 91..346 and so covers all four fuse regions — region-first
    // let a player flip fuses through a shut door.
    //
    // Below the sprites the shipped hittest asks the SET first and the STAGE only
    // where the set's image is not — so the three zones here are the three
    // {@link SetViewer.hitTestAt} answers in, in the same order.
    //
    // ...except that a game SHIPS this rule and can run it itself: the BOOTFILE
    // `mousedown` is the six-case switch above, and everything it dispatches
    // through is an opcode we have. Where the title provides one, it decides where
    // a click goes; the transcription below is the fallback for a title that does
    // not (and the reference the port was built from).
    const dispatcher = this.session.bootScripts.find((b) => b.script.codes.has("mousedown"));
    if (dispatcher) {
      try {
        await this.session.interp.runHandler(
          dispatcher, "mousedown", [this.session.pointerPoint()],
          { me: dispatcher.name, target: "" },
        );
      } catch (e) {
        this.onLog(`script error in ${dispatcher.name}.mousedown: ${(e as Error).message}`);
      }
      return;
    }
    if (await this.clickProp(x, y)) return;
    if (await this.clickActor(x, y)) return;
    if (this.inSetImage(x, y)) {
      if (await this.clickHotspot(x, y)) return;
      await this.clickScene();
      return;
    }
    // again the stage itself, not its main script (GameSession.stageOpen)
    if (this.session.stageOpen) {
      if (await this.session.stageCtrl.stageClickAt(x, y)) return;
    }
    await this.clickFlatSurface();
  }

  /** is the point inside the image the SET draws? In-game the room occupies the
   *  top 264 rows and the interface band below belongs to the stage — which is
   *  what makes a band click a flat click and a room click neither. */
  private inSetImage(x: number, y: number): boolean {
    return (
      this.session.viewShowing && !!this.current &&
      x >= 0 && y >= 0 && x < this.current.width && y < this.current.height
    );
  }

  /** props (UI band, inventory items) sit in front of everything */
  private async clickProp(x: number, y: number): Promise<boolean> {
    const prop = this.propAtPointer(x, y);
    if (!prop) return false;
    const name = prop.group.name;
    // A prop's mousedown may live on its own script (TAOOT: the trunk's
    // gramdrawer) OR only on the owning shop's main, which dispatches by
    // `switch target` for a whole bank of props (the Enigma switch/wires/dials
    // share one handler). Try the prop script first, then fall through to the
    // shop main, with target = the prop name so that dispatcher matches.
    //
    // The chain STOPS at the shop, and TAOOT's fusebox is the proof rather than
    // the counter-example it looks like. Turning a fuse off lives in FUSE.STG's
    // main and turning it on in FUSE.SHP's, for the same four props — which reads like
    // one click having to reach both. It isn't: the two are reached by the two
    // DIFFERENT dispatch paths above, and which one a click takes is decided by
    // the sprite currently showing.
    //
    //   fuse14 showing "light"  the 13x12 lamp at 280..293, 70..82 — MISSES the
    //                           region (264..295, 31..56), so hittest says
    //                           "button" and FUSE.STG's main turns it off
    //   fuse14 showing "off"    the 128x57 switch body at 168..296, 11..68 —
    //                           covers it, so it is a prop and FUSE.SHP's main
    //                           turns it on
    //
    // A chain that ran the flat/stage main after the shop would break TAOOT's
    // inventory instead: flat "inven 1"'s own mousedown is the BACKGROUND
    // handler (`handitem = ""`), which the boot reaches only via `case "flat"`,
    // so folding it into a prop's chain deselects the item you just picked up.
    const own = this.session.propScripts.get(name.toLowerCase());
    const shopMain = this.session.shopMain(prop.shop.name);
    const chain = [own, shopMain].filter(
      (s): s is NonNullable<typeof s> => !!s && s.script.codes.has("mousedown"),
    );
    if (!chain.length) return false;
    // mousedown's ARGUMENT is the click point, not the prop name — the
    // original boot routes `sendtoprop(name, mousedown(thepoint))`, so a
    // handler like TAOOT's bomb switches' `pointinbutton(currentflat(), "3B",
    // arg)` can hit-test the sub-region under the cursor. The prop NAME is
    // carried in the me/target context (the shop-main dispatcher keys on
    // target). Passing the name as the arg silently broke point-reading
    // props (every switch click was a no-op at point 0,0).
    const point = this.session.pointerPoint();
    this.session.interp.eventConsumed = false;
    for (const inst of chain) {
      try {
        const res = await this.session.interp.runHandler(inst, "mousedown", [point], {
          me: name,
          target: name,
        });
        if (this.session.interp.eventConsumed || (res.handled && !res.passed)) break;
      } catch (e) {
        this.onLog(`script error in ${name}.mousedown: ${(e as Error).message}`);
        break;
      }
    }
    this.onLog(`click prop ${name}`);
    return true;
  }

  /** actors stand in the world between the props and the view hotspots */
  private async clickActor(x: number, y: number): Promise<boolean> {
    if (!this.session.viewShowing || !this.current || y >= this.current.height) return false;
    const cam = this.worldCamera();
    const act = cam ? this.session.actorRuntime.actorAt(x, y, cam, this.occlusion()) : null;
    if (!act) return false;
    const inst = this.session.castScripts.get(act.member.name);
    if (!inst?.script.codes.has("mousedown")) return false;
    try {
      await this.session.interp.runHandler(inst, "mousedown", [act.member.name], {
        me: act.member.name,
        target: act.member.name,
      });
    } catch (e) {
      this.onLog(`script error in ${act.member.name}.mousedown: ${(e as Error).message}`);
    }
    this.onLog(`click actor ${act.member.name}`);
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
  propUnder(x: number, y: number): ReturnType<typeof this.session.propRuntime.propAt> {
    return this.propAtPointer(x, y);
  }

  /**
   * The prop a click at this point would actually dispatch to — world camera,
   * occlusion and opaque-pixel mask included. Public as {@link propUnder}
   * because anything looking for something to click has to ask the same
   * question the click will: a bare propRuntime.propAt() finds a prop over its
   * transparent pixels too, and clicking there dispatches nothing.
   */
  private propAtPointer(x: number, y: number): ReturnType<typeof this.session.propRuntime.propAt> {
    return this.session.propRuntime.propAt(
      x, y, this.session.viewShowing ? this.worldCamera() : null, this.session.viewShowing,
      this.session.viewShowing ? this.occlusion() : null,
    );
  }

  // ---- puppet mode (rendering + bevel hit-testing live in puppet-view.ts) --

  /** decode (cached per pup) a layer sprite of the active puppet */
  puppetLayerFrame(loc: number): ShpFrame | null {
    return this.puppetView.layerFrame(loc);
  }

  /** the active overlay flat's named click-region under a point, or null */
  private flatRegionAt(x: number, y: number): { name: string } | null {
    return (
      this.session
        .stageCtrl.currentFlatRegions()
        .find((rg) => x >= rg.left && x <= rg.right && y >= rg.top && y <= rg.bottom) ?? null
    );
  }

  /**
   * The DreamFactory cursor name for this position ("" = the plain arrow).
   *
   * This is the cursor half of BOOTFILE 0001's `idle()`, and it asks the GAME
   * rather than deciding: `hittest` the point, then send `setcursor` to whatever
   * it answered, exactly as the shipped handler does —
   *
   *     thepoint = mouse ()
   *     thename = hittest (thepoint)
   *     switch result ()
   *     case "actor"     sendtoactor (thename, setcursor (thepoint))
   *     case "prop"      sendtoprop (thename, setcursor (thepoint))
   *     case "button"    sendtobutton (currentflat (), thename, setcursor (…))
   *     case "scene"     sendtoscene (thename, setcursor (thepoint))
   *     case "painting"  sendtopainting (currentscene (), currentview (), …)
   *     case "flat"      sendtoflat (thename, setcursor (thepoint))
   *     case "none"
   *     endswitch
   *
   * so the cursor and the click now answer from ONE hit test, and neither can
   * promise what the other won't do.
   *
   * What this stopped inventing, and it was inventing plenty. A prop used to be
   * `"touch"` whatever it was and wherever it was; an actor was `"talk"`; a flat
   * region was `"touch"` for having a region at all. None of those names come
   * from the game: the whole TAOOT corpus emits five — `touch` (809), `arrow`
   * (75), `hand` (36), `watch` (18) and `fist` (2) — and the hand over a takeable
   * thing is `inven.shp`'s shop main, which gates it:
   *
   *     if propview (target) = "small"
   *         if realdist (target) < hotdist ()   cursor ("touch")   exitcode
   *         endif
   *         passcode
   *     endif
   *     cursor ("touch")
   *
   * The story cast's main (gang.cst) says the same for people. So an object across the room is
   * NOT a hand in the original, and now isn't here either — which needs both
   * halves of this to be true: `target` is the addressee (so `realdist(target)`
   * asks about the thing under the pointer), and a `passcode` climbs the
   * containment chain (so the shop main is reached at all).
   *
   * Still transcribed, deliberately: the HEARTBEAT. The shipped `idle()` also
   * calls `forceupdate()` and its clock handler every pass and only does the
   * cursor every 4th, and running it whole is what the port cannot do yet —
   * headless `forceupdate` self-advances the session clock 50 ms, so an `idle`
   * on the clock service would feed its own elapsed time and race. The clock
   * half is already the game's (`Scheduler.serviceGameClock` dispatches the
   * boot's calctime); the cadence is ours, and this is called from pointermove
   * instead.
   */
  async hover(x: number, y: number): Promise<string> {
    this.session.setPointer(x, y); // keep mouse() current as the cursor moves
    // Screen ownership first, and it is the port's own: a movie or a shown puppet
    // is not something `hittest` can answer for (the original's idle doesn't run
    // while either holds the screen). Same order as clickDispatch — a live movie
    // outranks a suspended conversation.
    if (this.movies.playing) return this.movies.clickableAt(x, y) ? "touch" : "";
    if (this.session.puppet?.visible) {
      return this.puppetView.bevelAt(x, y) >= 0 ? "touch" : "";
    }
    // frozen world: idle() answers `cursor("watch")` while lockevents is set
    // instead of asking anything what it would like to be, and that is the whole
    // feedback a player gets that the game is doing something rather than
    // ignoring them. Same position as the gate in clickDispatch, and for the same
    // reason: the puppet above it still answers.
    if (truthy(this.session.interp.globals.get("lockevents") ?? 0)) return "watch";
    const hit = this.session.hitTestAt(x, y);
    const point = this.session.pointerPoint();
    const caller = this.session.boot?.name ?? "boot script";
    this.session.cursorName = "";
    try {
      switch (hit.type) {
        case "actor":
        case "prop":
        case "scene":
        case "flat":
          await this.session.sendEvent(`sendto${hit.type}`, hit.name, "setcursor", [point], caller);
          break;
        case "button":
          await this.session.stageCtrl.sendToButton(
            this.session.currentFlat, hit.name, "setcursor", [point], caller,
          );
          break;
        case "painting":
          await this.session.sendToPainting(
            this.scene.sceneName, this.scene.views[this.viewIdx].viewName,
            hit.name, "setcursor", [point],
          );
          break;
      }
    } catch {
      /* a cursor is cosmetic: a handler that throws leaves the plain arrow */
    }
    return this.session.cursorName;
  }

  private startAnimation(frames: CachedFrame[], done: () => void): void {
    if (!frames.length) {
      done();
      return;
    }
    this.animation = frames;
    this.animationPos = 0;
    this.animationDone = done;
    this.lastTick = 0;
  }

  /** advance animation; returns the frame to draw this tick */
  tick(now: number): CachedFrame | null {
    this.session.propRuntime.tick(now, FRAME_MS);
    this.session.tickFade(now);
    this.session.tickTime(now); // delay() clock + coarse loop/cricket service
    this.session.scheduler.serviceFrameLoops(); // smooth per-frame loops (sky drift, fence idle)
    if (this.movies.playing) {
      // a self-paced movie may finish mid-tick; fall back to the settled view
      return this.movies.tick(now) ?? this.current;
    }
    if (this.animation) {
      if (!this.lastTick) this.lastTick = now;
      if (now - this.lastTick >= FRAME_MS) {
        this.lastTick = now;
        this.current = this.animation[this.animationPos++];
        if (this.animationPos >= this.animation.length) {
          const done = this.animationDone!;
          this.animation = null;
          this.animationDone = null;
          done();
        }
      }
      return this.current;
    }
    // The move has ended and nothing is running: take the next thing the player
    // did while it was, which is where the original's main loop pops its queue.
    // One per tick — the event it dispatches may start another animation, and
    // the next tick will find that and wait again.
    if (!this.movingCamera && this.session.events.length) this.drainOneEvent();
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
   * Hash everything {@link paint} is about to read. Over-hashing costs a
   * redraw nobody needed; under-hashing costs one that WAS needed, so where
   * the two are in tension this leans on the first — the camera, the palettes
   * and the hotspot overlay go in whether or not the branch about to run will
   * look at them.
   *
   * The canvas dimensions are in here because assigning `canvas.width` clears
   * the backing store: a resize is a repaint even when the game has not moved.
   */
  private buildSignature(ctx: CanvasRenderingContext2D): DrawSignature {
    const s = this.session;
    const sig = this.sig.reset();
    sig.num(ctx.canvas.width).num(ctx.canvas.height);
    // which of paint()'s five branches, and the source each of them blits
    sig.bool(!!s.puppet?.visible).bool(s.viewShowing);
    sig.ref(s.fade.snapshot).num(s.fade.level);
    sig.str(this.movies.playingFile ?? "").num(this.movies.framePos);
    sig.ref(this.current).ref(s.stageCtrl.flatImage());
    // CLUTs are replaced wholesale by setClut, never written through, so which
    // array it is IS which colours they are; stageDim is applied at paint time
    sig.ref(this.palette).ref(this.propPalette).ref(this.stageDim);
    // the world sprites, and the camera they are projected through
    const cam = this.activeCamera();
    if (!cam) sig.bool(false);
    else {
      sig.num(cam.x).num(cam.y).num(cam.z).num(cam.deg);
      sig.num(cam.f).num(cam.cx).num(cam.cy).num(cam.clipW).num(cam.clipH);
    }
    sig.bool(this.animating);
    s.actorRuntime.drawSignature(sig);
    s.propRuntime.drawSignature(sig);
    this.puppetView.drawSignature(sig);
    // the canvas-drawn overlays that sit on top of the blit
    sig.num(s.textOverlay.length);
    for (const e of s.textOverlay) sig.str(e.text).num(e.x).num(e.y).num(e.size).num(e.color);
    sig.bool(this.showHotspots).num(this.sceneIdx).num(this.viewIdx);
    return sig;
  }

  /**
   * Present the current state of the world — redrawing it only when it is not
   * already on the screen.
   *
   * A composite is ~7 ms on a slow machine (palette-expand the flat, expand the
   * view over it, walk every prop and actor, upload 768 KB), and the frame loop
   * asks for one 60 times a second. An adventure game standing in a room is
   * identical frame to frame: measured at the bedsit standpoint, 0 of 173
   * consecutive composites differed by a single byte, for 60% of a core. So the
   * work is not made faster here, it is not done — {@link buildSignature} hashes
   * what the picture is drawn FROM, and an unchanged hash means the canvas
   * already shows it.
   *
   * The hash is the ONLY test. `scriptBusy` looks like the obvious safety
   * override — "a script is running, so the world is moving, so just paint" —
   * and it is worthless here: it means a script has not RETURNED, not that it
   * is doing anything. A script blocked in `playmovie` on an interactive clip
   * parked waiting for a click holds `inflight` at 1 for as long as the player
   * looks at it, which is precisely one of the still screens this exists to
   * stop redrawing. Measured on the boot standpoint, that override alone kept
   * 100% of frames compositing while every part of the signature sat perfectly
   * still.
   *
   * The presenter's REPAINT_EVERY is the one net: an unconditional composite
   * once a second. Hashing live fields cannot be forgotten at a write site the
   * way a dirty flag can, but it CAN be incomplete — a field added to a prop
   * later, a collision across both halves. This bounds either to a second of
   * staleness rather than a screen frozen until the player does something, and
   * costs ~1% of the 60% it insures. tests/browser/repaint.ts is the check
   * that it is never actually needed: it recomposites every skipped frame and
   * asserts the pixels match what was left on the canvas.
   */
  render(ctx: CanvasRenderingContext2D): void {
    if (this.screen.shouldPaint(this.buildSignature(ctx))) this.paint(ctx);
  }

  /**
   * Who owns the screen right now, front to back — the painter's priority, kept
   * in one place because it is the same rule the INPUT path keeps (clickDispatch:
   * a live movie beats even a suspended conversation) and the two had drifted.
   *
   * A movie owns the screen outright. It carries its own palette and its own
   * pixels, and a fade is not a layer over it — so a fade-out the script left
   * standing must not survive into it. TAOOT's demo Smethells briefing is where
   * that showed: `screentoblack("puppet", 15); puppetvisible(false);
   * playmovie("penote.mov")` — no `blackscreen()` between, so the held snapshot
   * kept the screen and penote.mov played, clickable, behind a black rectangle.
   * The full game has the same shape twice: the darkroom's
   * `playmovie("photobox.mov")` (PHOTO.STG 0012) and the wireless portrait
   * (WIRELESS.SHP 0120), whose `clut("black")` is a no-op here precisely because
   * it is normally paired with the `blackscreen()` that is missing there.
   */
  screenOwner(): "movie" | "puppet" | "faded" | "world" {
    if (this.movies.frame) return "movie";
    // a conversation close-up replaces the world display, but only while shown:
    // puppetvisible(false) keeps the puppet loaded and reveals the flat behind it
    // (the blackjack table between "play again?" prompts)
    if (this.session.puppet?.visible && !this.session.fade.snapshot) return "puppet";
    // a frozen pre-transition frame while fading out — the set may already have
    // changed underneath (gotospecial fades around changeset)
    if (this.session.fade.snapshot) return "faded";
    return "world";
  }

  private paint(ctx: CanvasRenderingContext2D): void {
    const owner = this.screenOwner();
    if (owner === "puppet") {
      // The answer rows are text drawn ON the interface band, so the band has
      // to be under them: paint the stage flat and its persistent props (TAOOT:
      // the lifesaver, the watch, the held item) first, exactly as the flat path
      // does, then let the close-up own the view region above it. The original
      // gets this for free — its bevel redraw restores that strip of screen
      // from a stored copy of the background before every DrawString.
      this.screen.clearFrame();
      const flat = this.session.stageCtrl.flatImage();
      if (flat) {
        const flatPal = this.flatPalette(flat.palette);
        const fbuf = this.screen.scratchFor(flat.width * flat.height * 4);
        indexedToRGBA(flat.pixels, flat.width, flat.height, flatPal, fbuf);
        this.screen.blitTop(fbuf, flat.width, flat.height);
        this.compositeWorld(this.screen.frame, SCREEN_W, SCREEN_H, flatPal, null);
      }
      const cur = this.current;
      this.puppetView.composite(
        this.screen.frame,
        cur ? { pixels: cur.pixels, width: cur.width, height: cur.height, palette: this.palette } : null,
      );
      this.screen.frameValid = true;
      this.screen.blit(ctx);
      // the subtitle band and choice bevels sit UNDER the fade, as they did
      // when PuppetView drew them itself and the viewer faded afterwards
      this.puppetView.drawOverlay(ctx);
      this.screen.applyFade(ctx, this.session.fade.level);
      return;
    }
    const movieFrame = owner === "movie" ? this.movies.frame : null;
    if (movieFrame) {
      const f = movieFrame;
      // A clip is a RECTANGLE PAINTED OVER THE SCREEN, not a screen of its own.
      // WHERE it sits is the segment's own header field (MovSegment.originX/Y),
      // and the engine writes only those pixels — so whatever the screen was
      // showing is still there around it.
      //
      // Most clips make the distinction moot by covering the screen: 302 of
      // TAOOT's 327 segments are the full 512×384. The 25 that are not divide
      // in two, and both need this. Its in-room transitions — the lifts, the
      // smokestack climbs, `hallf3c` — are 512×264 at (0,0), which is exactly
      // the room-view region, and they are played straight out of a keydown
      // with nothing hiding the interface (`playmovie("stackup.mov");
      // changeset(...)`), so the band belongs UNDER them and clearing the
      // screen first blacked it out for the length of the ride. The demo's
      // cutscenes are 512×264 at (0,60), centred, and play behind a fade the
      // script has already raised — so what belongs in their letterbox bands
      // is that black, which is now the fade's doing rather than a clear's.
      const covers =
        f.originX <= 0 && f.originY <= 0 && f.width >= SCREEN_W && f.height >= SCREEN_H;
      // ...so only a clip that leaves screen showing pays for the screen under
      // it (short-circuit: the full-screen 302 never build one), and where
      // there is no screen to show, black — which is what the clear used to do
      // for every clip, wanted or not.
      if (covers || !this.paintWorldInto()) this.screen.clearFrame();
      const buf = this.screen.scratchFor(f.width * f.height * 4);
      indexedToRGBA(f.pixels, f.width, f.height, f.palette, buf);
      this.screen.blitAt(buf, f.width, f.height, f.originX, f.originY);
      this.screen.frameValid = true;
      this.screen.blit(ctx);
      // A live movie presents its own pixels at full brightness — it is NOT
      // dimmed by the persistent fade level, and a preceding blackscreen() is a
      // one-shot clear it draws over. Do NOT fade the clip, or an intro movie
      // after blackscreen renders black. Around it the fade still applies,
      // which is what blacks a letterboxed cutscene's bands: in TI.EXE the
      // fade is the PALETTE, and a movie carries its own, so the clip is bright
      // while everything drawn in the faded palette is not.
      if (!covers) {
        this.screen.applyFadeExcept(ctx, this.session.fade.level, {
          x: f.originX, y: f.originY, w: f.width, h: f.height,
        });
      }
      return;
    }
    // the fade-out's frozen frame, which the movie above outranks: a script that
    // fades out and then plays a clip means the clip to be seen, and when the clip
    // ends the screen is this black again for the blacktoscreen that follows
    const snap = owner === "faded" ? this.session.fade.snapshot : null;
    if (snap) {
      this.screen.clearFrame();
      this.screen.blitTop(snap.rgba, snap.width, snap.height);
      this.screen.frameValid = true;
      this.screen.blit(ctx);
      this.screen.applyFade(ctx, this.session.fade.level);
      return;
    }
    const drew = this.paintWorldInto();
    if (!drew) return; // nothing to draw: leave the canvas as it stands
    this.screen.frameValid = true;
    this.screen.blit(ctx);
    this.screen.drawTextOverlay(ctx, this.session.textOverlay);
    this.screen.applyFade(ctx, this.session.fade.level);
    // over a flat the hotspots belong to the room, so only when it is showing;
    // on the bare room there is nothing else they could belong to
    if (drew === "set" || this.session.viewShowing) this.drawHotspots(ctx);
  }

  /**
   * Build the ordinary screen into the framebuffer — the stage flat with the
   * room composited into its top region and the sprites over both ("flat"), or
   * the bare room when no flat is up ("set"). Null when there is nothing to
   * draw at all, and then the framebuffer is left alone: a caller that has
   * something of its own to put up decides what the rest of the screen is.
   *
   * Its own method because a MOVIE needs it too. A clip is a rectangle painted
   * over the screen, not a screen of its own (see {@link paint}).
   */
  private paintWorldInto(): "flat" | "set" | null {
    // stage flat active: full 512×384 screen — flat image as background,
    // the set view composited into the top region, props over everything
    const flat = this.session.stageCtrl.flatImage();
    if (flat) {
      this.screen.clearFrame();
      const flatPal = this.flatPalette(flat.palette);
      const fbuf = this.screen.scratchFor(flat.width * flat.height * 4);
      indexedToRGBA(flat.pixels, flat.width, flat.height, flatPal, fbuf);
      this.screen.blitTop(fbuf, flat.width, flat.height);
      const f = this.current;
      if (this.session.viewShowing && f) {
        // straight over the flat's top rows — scratch is free again, the flat
        // is already in the framebuffer
        const vbuf = this.screen.scratchFor(f.width * f.height * 4);
        indexedToRGBA(f.pixels, f.width, f.height, this.palette, vbuf);
        this.screen.blitTop(vbuf, f.width, f.height);
      }
      const propPal = this.session.viewShowing ? this.propPalette : flatPal;
      // world sprites follow the motion-frame camera during movement too, so
      // actors/world props stay visible over the composited set region
      const cam = this.session.viewShowing ? this.activeCamera() : null;
      this.compositeWorld(this.screen.frame, SCREEN_W, SCREEN_H, propPal, cam);
      return "flat";
    }
    // bare set view (currentFlat "none"): the room view alone, occupying the
    // top region of an otherwise black screen
    const f = this.current;
    if (!f) return null;
    this.screen.clearFrame();
    const buf = this.screen.scratchFor(f.width * f.height * 4);
    indexedToRGBA(f.pixels, f.width, f.height, this.palette, buf);
    this.screen.blitTop(buf, f.width, f.height);
    this.compositeWorld(this.screen.frame, SCREEN_W, SCREEN_H, this.propPalette, this.activeCamera());
    return "set";
  }

  /**
   * Composite the world sprites — actors, then props — over an RGBA frame.
   * Shared by the bare-set and stage-flat render paths.
   *
   * World sprites (actors + propxyz/propstar props) track the camera even
   * mid-turn/walk via the motion frame's own pose (see activeCamera), so
   * people no longer vanish during movement.
   *
   * Persistent HUD props (TAOOT: the nav arrow, the interface band) keep
   * drawing through turns and walks so the direction indicator doesn't blink
   * out for the whole animation and only reappear when it settles — they draw
   * regardless of anchor Y (a y-based filter dropped the nav arrow, which is
   * anchored inside the set-view region). Set-local screen props are still
   * suppressed while animating — anchored to the standpoint, they'd float
   * over the rotating scene — by restricting the draw to persistent shops
   * mid-motion. The standpoint-bound interface overlays (house.shp's open
   * door / signs) are persistent too, so `animating` also drops those via
   * hideMotionOverlays — else the open door stayed glued to the screen
   * (position:absolute) while the room turned behind it.
   */
  private compositeWorld(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    palette: Uint8ClampedArray,
    cam: import("./engine/props").WorldCamera | null,
  ): void {
    if (cam) {
      this.session.actorRuntime.composite(data, width, height, palette, cam, this.occlusion());
    }
    this.session.propRuntime.composite(
      data, width, height, palette, -Infinity, cam,
      this.animating || this.session.viewShowing,
      this.occlusion(),
      this.animating,
    );
  }

  private drawHotspots(ctx: CanvasRenderingContext2D): void {
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
    const pal = paletteToRGBA(this.set.paletteRaw, 256);
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
