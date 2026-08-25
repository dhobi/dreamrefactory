/**
 * The screen, and who owns it — independent of whether the game has a room.
 *
 * This is the half of the old `SetViewer` that was never about a SET. Movies,
 * conversation close-ups, stage flats, the prop and actor layers, the fades, the
 * wipes, the CLUT, the text overlay and the "is this picture already on the
 * canvas?" check are all screen business, and none of them needs a room — but all
 * of them lived on a class whose constructor demanded a `SetFile`, so a game with
 * no SET got none of them.
 *
 * ## What that cost, before this existed
 *
 * Three workarounds in the tree, each of them the same bug wearing a different
 * hat:
 *
 *   - `GameHost.coldBoot`'s no-landing-room path opened a room it did not want
 *     with `skipOpen`, purely so the boot's films had a surface, and said so:
 *     "It still needs a room to draw INTO… Any of the game's rooms will do."
 *   - `DustFiles.serverSetNames` answers `["town.set"]` and explains that the
 *     room doubles as the movie host — the intro films were invisible for as
 *     long as it answered "none".
 *   - `paintWorldInto` already handled `viewShowing === false`. It always knew
 *     the room might be absent; nothing could reach it without one.
 *
 * *Timelapse* (1996) is what forced the issue: 465 game files across four discs
 * and not one `.SET` on any of them. Its rooms ARE stage flats, reached by
 * `gotostage(stage, region, frame)`, with the navigation graph written out as a
 * script table in each stage's own container 1 rather than as a set's turn rings.
 * So there is no room to borrow, and until this file existed that meant no
 * movies, no fades and no compositing at all.
 *
 * ## The split
 *
 * The room is a LAYER this composites, declared by {@link RoomLayer} and
 * implemented by `SetViewer`. `room` is null for a game that has none, and every
 * branch below already reads as if it might be — because it always could be.
 *
 * What stayed in `SetViewer`: the navigation state machine (rings, roads, the
 * camera, turn and walk animation, the nav drivers), the geometry of its own
 * hit-testing, the hotspot overlay and the map. What is here: everything that
 * decides what reaches the canvas, and everything that decides where a click
 * goes.
 *
 * INPUT is here too, and for the same reason: the click priority chain is a
 * SCREEN rule. A live movie takes its own clicks, a shown conversation takes its
 * own, `lockevents` freezes everything, a click made while something is running
 * is queued, and what is left goes to whatever is drawn — none of which is a
 * room's business, and all of which a game with no rooms needs. The room keeps
 * its own zone of it ({@link RoomLayer.roomClickAt}, {@link RoomLayer.roomHitTest})
 * and nothing else.
 *
 * `hittest` is the shape of the whole thing in one function, and it is what makes
 * the split obvious: a PROP first and unbounded, then the room's zone, then the
 * stage's, then "None". Only the middle step needed a room, and it took the other
 * three down with it.
 */
import { indexedToRGBA } from "@dreamfactory/engine/df/image";
import { DfVersion } from "@dreamfactory/engine/df/version";
import { ENGINE_STEP_MS } from "@dreamfactory/engine/runtime/clock";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { DrawSignature } from "@dreamfactory/engine/runtime/signature";
import { Value, truthy } from "@dreamfactory/engine/runtime/interp";
import type { ShpFrame } from "@dreamfactory/engine/df/shp";
import type { Occlusion } from "@dreamfactory/engine/runtime/actors";
import type { WorldCamera } from "@dreamfactory/engine/runtime/props";
import { MoviePlayer } from "./movie-player";
import { PUPPET_ART_H, PuppetView } from "./puppet-view";
import type { CachedFrame } from "./ring-cache";
import { ScreenPresenter } from "./screen-presenter";
import { PHOTO_H, PHOTO_W } from "../runtime/photos";
import { DEFAULT_SCREEN, ScreenSize } from "./screen";
import { displayPalette, screenGammaGeneration } from "./screen-gamma";


/** a mixclut(target,"black",lo,hi,amt) request: darken palette entries lo..hi */
export interface ClutDim {
  lo: number;
  hi: number;
  amt: number;
}

/**
 * Return a copy of `base` (an RGBA CLUT) with entries [lo..hi] blended toward
 * black by amt/255 — the engine's `mixclut(target,"black",lo,hi,amt)`. amt=255
 * is fully black, 0 leaves it unchanged; entries outside the range are kept.
 * (The darkroom kills the room light with mixclut("set","black",0,127,240).)
 */
export function dimPalette(base: Uint8ClampedArray, dim: ClutDim): Uint8ClampedArray {
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

/**
 * The room, as the screen sees it — one optional layer, not the screen's owner.
 *
 * Every member is something {@link ScreenDirector} has to ask a room for and
 * cannot work out for itself. Implemented by `SetViewer`; a game with no SET
 * simply leaves {@link ScreenDirector.room} null, and each branch that would
 * have consulted it composites without it.
 *
 * The method names all say `room` rather than `world`, because `world` already
 * means something narrower here: the sprites projected into 3D space
 * (`worldDrawList`, `WorldCamera`, {@link ScreenDirector.compositeWorld}).
 */
export interface RoomLayer {
  /** which engine wrote the room — v1 merges actors and props into one depth list */
  readonly roomVersion: DfVersion;
  /** is the camera mid-turn, mid-walk or mid-road? */
  readonly roomAnimating: boolean;
  /** the view frame on the screen now, or null before the first settle */
  roomFrame(): CachedFrame | null;
  /** the view's own palette, dim and gamma applied */
  roomPalette(): Uint8ClampedArray;
  /** the palette the room's props colorize through */
  roomPropPalette(): Uint8ClampedArray;
  /**
   * The prop CLUT for a screen with a stage flat on it: the room's own colours
   * below the set's `colorCount`, the flat's above. One screen CLUT, two owners —
   * see the implementation for why that is a fact about TI.EXE and not a choice.
   */
  bandPropPalette(stageBase: Uint8ClampedArray): Uint8ClampedArray;
  /** the camera world sprites are projected through, or null while there is none */
  roomCamera(): WorldCamera | null;
  /** the view's depth map, for occluding sprites behind scenery */
  roomOcclusion(): Occlusion | null;
  /** `clut("set")` / `mixclut("set", …)`: rebuild the room's palettes */
  applyRoomClut(dim: ClutDim | null): void;
  /** rebuild them because the display gamma moved (see screen-gamma.ts) */
  refreshRoomGamma(): void;
  /**
   * The room's own per-frame work — advance a turn or walk, pump one queued
   * gesture, warm the ring next door — and the frame that leaves it on screen.
   * Called by {@link ScreenDirector.tick} once the session-wide service is done,
   * and NOT while a movie owns the screen.
   */
  advanceRoom(now: number): CachedFrame | null;
  /** the hotspot debug overlay, drawn on the canvas over the composited frame */
  drawRoomHotspots(ctx: CanvasRenderingContext2D): void;
  /** everything room-side that {@link ScreenDirector.paint} is about to read */
  roomSignature(sig: DrawSignature): void;

  // ---- and what the INPUT chain has to ask a room -------------------------

  /**
   * Is this screen point over the image the room draws?
   *
   * In-game that image is the top rows and the interface band below belongs to
   * the stage — which is what makes a band click a flat click and a room click
   * neither. False for every point when there is no room, which is why the
   * director asks rather than assuming a rectangle.
   */
  pointInRoomImage(x: number, y: number): boolean;
  /**
   * The room's own click zone: an actor, then a view hotspot, then the scene
   * itself. True when the room took the click.
   *
   * Third in the priority chain, after a movie and a conversation and after
   * PROPS — which are the director's, because a prop is screen-space unless a
   * room is showing (see {@link ScreenDirector.propUnder}).
   */
  roomClickAt(x: number, y: number): Promise<boolean>;
  /**
   * The room's own zone of `hittest`: an actor in front of the view's hotspots,
   * a hotspot as a "painting", and where there is neither, the SCENE ITSELF by
   * name. Null where the point is not over the room's image at all.
   */
  roomHitTest(x: number, y: number): { name: string; type: string } | null;
  /**
   * Route a `setcursor` (or any handler) at one of the room's own hotspots.
   *
   * The room resolves it, because `sendtopainting` is answered in the scene and
   * view you are LOOKING at and only the room knows which those are.
   */
  sendRoomPainting(name: string, handler: string, point: Value): Promise<void>;
  /** the key, through the room's own script chain; true when it was consumed */
  roomKeyDown(keyName: string): Promise<boolean>;
  /**
   * Let a `mousedown` handler drive the camera for the length of one gesture
   * (`currentscene()` — the bridge's Morrow kick-out turns you to face him from
   * the OK button), and put it back afterwards. The opaque token is whatever the
   * room needs to restore.
   */
  armRoomNav(): unknown;
  disarmRoomNav(prev: unknown): void;
}

export class ScreenDirector {
  /**
   * The one surface everything composites into. Owned here rather than by a
   * viewer, which is the lifetime it always wanted: a set change swaps the room
   * and must not swap the screen out from under the frame the player is looking
   * at (`GameSession.captureFrame`, the fade snapshot).
   */
  readonly screen: ScreenPresenter;
  /** MOV playback (cutscenes / object close-ups) — see movie-player.ts */
  readonly movies: MoviePlayer;
  /** puppet-mode rendering (conversation close-ups) — see puppet-view.ts */
  readonly puppetView: PuppetView;

  onLog: (line: string) => void = () => {};

  /** the reused signature accumulator — no per-frame garbage */
  private readonly sig = new DrawSignature();
  /** a stage `mixclut`, applied to the flat palette at render time */
  private stageDim: ClutDim | null = null;
  private room: RoomLayer | null = null;

  constructor(
    readonly session: GameSession,
    size: ScreenSize = DEFAULT_SCREEN,
  ) {
    this.screen = new ScreenPresenter(size);
    // the movie player reveals the settled room once a movie sequence ends —
    // and does nothing where there is no room to reveal
    this.movies = new MoviePlayer(session, () => this.revealRoom());
    this.movies.onLog = (l) => this.onLog(l);
    this.puppetView = new PuppetView(session);
    // clut/mixclut palette dimming (the darkroom light switch, and Dust's map)
    session.onClut = (target, dim) => this.setClut(target, dim);
    // Snapshot the frame that is actually on screen. captureFrame runs from a
    // script (screentoblack) during tick(), i.e. BEFORE this frame's render, so
    // the screen still holds the last presented composite — the pre-transition
    // image the fade-out should hold. It is the pre-fade composite (applyFade
    // paints on the canvas, not into the framebuffer), so ramping the fade over
    // it can't double-darken. Before the first composite there is nothing on the
    // screen yet, so fall back to the bare room frame. The screen outlives any
    // one room, so mid-set-change the snapshot is still the room being left.
    // `visualeffect(plain, 0)` — the scripts' "redraw now" (see repaintNow)
    session.repaintNow = () => {
      this.paintWorldInto();
    };
    /**
     * The shutter. `docamera` clamps the viewfinder so a 320x240 window centred
     * on the point always fits the screen; this clamps again rather than trust
     * it, because a shell on a smaller screen would otherwise read off the end
     * of the row.
     */
    session.grabPhoto = (cx, cy) => {
      const { width, height, frame } = this.screen;
      if (!this.screen.frameValid || width < PHOTO_W || height < PHOTO_H) return null;
      const x0 = Math.max(0, Math.min(width - PHOTO_W, Math.round(cx) - (PHOTO_W >> 1)));
      const y0 = Math.max(0, Math.min(height - PHOTO_H, Math.round(cy) - (PHOTO_H >> 1)));
      const rgba = new Uint8ClampedArray(PHOTO_W * PHOTO_H * 4);
      for (let y = 0; y < PHOTO_H; y++) {
        const from = ((y0 + y) * width + x0) * 4;
        rgba.set(frame.subarray(from, from + PHOTO_W * 4), y * PHOTO_W * 4);
      }
      return { rgba, width: PHOTO_W, height: PHOTO_H };
    };
    session.captureFrame = () => {
      // ...with one exception, and it is a conversation. TI.EXE has no snapshot
      // at all: `screentoblack` (0x43e550 -> 0x435b90) dims the LIVE screen in
      // place, `steps` times, and returns — so what it fades is whatever the
      // picture is at that instant. The last presented composite is not that
      // picture here, because a line ends by clearing the subtitle
      // (PuppetController.puppetSpeak) and the script's screentoblack runs in
      // the same tick, before any render: the buffer still holds the frame
      // composited while the caption was up, with the character's lower 40 px
      // clipped away for it (see PuppetView.composite). Fading that showed the
      // room through a band across the character's waist for the whole ramp —
      // subtitles-only, because with them off nothing is ever clipped. So
      // rebuild the conversation screen from what is true NOW.
      //
      // Everything else keeps the stale frame deliberately, and must: a set
      // change fades around `changeset`, so by the time the ramp runs the set
      // underneath has already been replaced and only the buffer still holds
      // the room being left.
      if (this.session.puppet?.visible && !this.session.fade.snapshot) {
        this.compositePuppetScreen();
      }
      const shot = this.screen.capture();
      if (shot) return shot;
      const f = this.room?.roomFrame();
      if (!f) return null;
      const rgba = new Uint8ClampedArray(f.width * f.height * 4);
      indexedToRGBA(f.pixels, f.width, f.height, this.room!.roomPalette(), rgba);
      return { rgba, width: f.width, height: f.height };
    };
    // return the promise so playmovie() blocks the script until the movie ends
    // (a shell overrides this with a fetch-first version for on-demand movies —
    // GameHost.activateSet, and every game's main.ts)
    session.onPlayMovie = (name, startFrame) => this.playMovie(name, startFrame);
    /*
     * `hittest(point)`: what is under a screen pixel, and the port's click
     * priority in one place.
     *
     * Read out of TI.EXE rather than inferred (id 20070 -> 0x4277f0):
     *
     *   1. one draw-ordered SPRITE list, asked before anything else and wherever
     *      the point is (0x43abc0); whatever it finds is then named by lookup —
     *      in a cast it is an "actor", in a shop a "prop"
     *   2. else, set open + visible + the point inside the SET's own screen rect
     *      (0x43ad50 -> 0x435410): a hotspot of the current scene/view is a
     *      "painting" (0x409910), and where there is none the answer is the
     *      SCENE ITSELF, by name — not nothing, and not the flat behind it
     *   3. else, stage open + visible + inside the STAGE's rect (0x43ad20): a
     *      named click-region is a "button" (0x446fb0), else the current FLAT
     *   4. else "None" (the engine capitalises it; comparisons are caseless)
     *
     * A PROP first, in a room exactly as over a flat, and through the same
     * {@link propAtPointer} the click path uses, so the two agree by
     * construction rather than by two hit tests happening to match.
     *
     * Step 2 is the ROOM's, and the only part of this that is — which is why the
     * whole thing is here and not on a viewer. A game with no room simply has no
     * step 2, and its clicks resolve against the stage, which is exactly what
     * Timelapse's do.
     */
    session.hitTestAt = (x, y) => {
      const prop = this.propAtPointer(x, y);
      // the INSTANCE's name, which is what the group's script switches on
      if (prop) return { name: prop.name || prop.group.name, type: "prop" };
      const inRoom = this.room?.roomHitTest(x, y);
      if (inRoom) return inRoom;
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
    // ...and the two predicates Dust's inventory drops an item against, which
    // have to answer through whatever is drawn over them — see the note on
    // GameSession.pointInSet
    session.pointInSet = (x, y) => this.room?.pointInRoomImage(x, y) ?? false;
    session.pointInStage = () =>
      this.session.stageOpen && this.session.currentFlat !== "none";
  }

  /**
   * Attach or detach the room layer.
   *
   * `null` on release, so a game between rooms — or one that never has any —
   * composites without one rather than holding a stale reference to the room it
   * has left.
   *
   * The stage dim is dropped on every change, and that is DELIBERATELY the
   * behaviour it had when it was a field on the viewer: a new `SetViewer` used to
   * re-wire `session.onClut` and start with `stageDim` unset, so a set change
   * cleared it. Keeping the screen across a set change would otherwise carry a
   * `mixclut("stage", …)` — the darkroom's — into the next room, which is a
   * change this refactor has no business making. In practice nothing notices
   * either way: `openStageFile` clears the stage dim itself on every open.
   */
  setRoom(room: RoomLayer | null): void {
    this.room = room;
    this.stageDim = null;
    this.flatPal = null;
  }

  /** the room layer now attached, if any */
  get currentRoom(): RoomLayer | null {
    return this.room;
  }

  /** reveal the settled room once a movie sequence ends (see {@link movies}) */
  private revealRoom(): void {
    this.onRoomReveal?.();
  }
  /**
   * What a finished movie hands the screen back to. Set by the room layer, whose
   * `showView` re-seats the camera on the standpoint; a shell with no room leaves
   * it unset and the movie's last frame simply stands (`screenOwner`'s "held").
   */
  onRoomReveal: (() => void) | null = null;

  // -------------------------------------------------------------------------
  // The frame
  // -------------------------------------------------------------------------

  /**
   * One frame of everything that is not a script: the session's own services,
   * then the movie or the room.
   *
   * This is the loop body every shell's `requestAnimationFrame` calls, and it
   * used to be `SetViewer.tick` — where the whole session's per-frame service
   * (the fade, the wipe, the delay clock, the prop animation, the frame loops)
   * ran inside the ROOM's tick and therefore not at all without one.
   *
   * Returns the room frame now showing, or null, because that is what
   * `SetViewer.tick` returned and a hundred test call sites read it.
   */
  tick(now: number): CachedFrame | null {
    // Real time in, game time out: while a host modal owns the screen the
    // reading stops moving and every delta below it is zero, which is the
    // original's own state under a blocking file dialog (GameSession.gameTime).
    now = this.session.gameTime(now);
    this.room?.refreshRoomGamma();
    // A prop animates one frame per SERVICE PASS, not at the camera's rate — see
    // the census in SetViewer.advanceRoom for why that is 50 ms and not 90.
    this.session.propRuntime.tick(now, ENGINE_STEP_MS);
    this.session.tickFade(now);
    this.session.tickWipe(now);
    this.session.tickTime(now); // delay() clock + coarse loop/cricket service
    this.session.scheduler.serviceFrameLoops(); // sky drift, fence idle
    this.serviceCursor();
    if (this.movies.playing) {
      // a self-paced movie may finish mid-tick; fall back to the settled room
      return this.movies.tick(now) ?? this.room?.roomFrame() ?? null;
    }
    return this.room?.advanceRoom(now) ?? null;
  }

  /**
   * Present the current state of the screen — redrawing it only when it is not
   * already on the canvas.
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
   * costs ~1% of the 60% it insures. taoot/tests/browser/repaint.ts is the check
   * that it is never actually needed: it recomposites every skipped frame and
   * asserts the pixels match what was left on the canvas.
   */
  render(ctx: CanvasRenderingContext2D): void {
    // Nothing repaints while the screen is HELD — see screenOwner. Returning
    // before shouldPaint deliberately leaves the cached signature alone, so the
    // first frame after the hold still differs from the last one painted and
    // composites; skipping through shouldPaint instead would cache the held
    // picture's signature and could strand it on the canvas.
    if (this.screenOwner() === "held") return;
    if (this.screen.shouldPaint(this.buildSignature(ctx))) this.paint(ctx);
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
    sig.ref(this.room?.roomFrame() ?? null).ref(s.stageCtrl.flatImage());
    // the xray aperture — a drag moves nothing else on the screen, so without
    // this the reveal would be painted once and then hold while the light moved
    const xr = s.plugins.xray;
    if (!xr?.aimed) sig.bool(false);
    else sig.str(xr.hidden).str(xr.mask).num(xr.x).num(xr.y);
    // CLUTs are replaced wholesale by setClut, never written through, so which
    // array it is IS which colours they are; stageDim is applied at paint time.
    // worldPalette's composition needs nothing more here — its other input is
    // the flat, hashed by identity a line above.
    sig.ref(this.stageDim);
    // the world sprites, and the camera they are projected through
    const cam = this.room?.roomCamera() ?? null;
    if (!cam) sig.bool(false);
    else {
      sig.num(cam.x).num(cam.y).num(cam.z).num(cam.deg);
      sig.num(cam.f).num(cam.cx).num(cam.cy).num(cam.clipW).num(cam.clipH);
    }
    // the room's palettes, its scene/view and its hotspot toggle
    this.room?.roomSignature(sig);
    s.actorRuntime.drawSignature(sig);
    s.propRuntime.drawSignature(sig);
    this.puppetView.drawSignature(sig);
    // the photograph the album is showing, which is part of the picture
    sig.ref(s.photoOverlay?.photo ?? null);
    // the canvas-drawn overlays that sit on top of the blit
    sig.num(s.textOverlay.length);
    for (const e of s.textOverlay) sig.str(e.text).num(e.x).num(e.y).num(e.size).num(e.color);
    // a reveal moves the seam every pass while everything behind it stands still,
    // so the step has to be in here or the frame is skipped as already-drawn
    sig.num(s.wipe.step).str(s.wipe.dir).num(s.wipe.span).bool(s.wipe.settled);
    return sig;
  }

  /**
   * Who owns the screen right now, front to back — the painter's priority, kept
   * in one place because it is the same rule the INPUT path keeps (the viewer's
   * click dispatch: a live movie beats even a suspended conversation) and the two
   * had drifted.
   *
   * A movie owns the screen outright. It carries its own palette and its own
   * pixels, and a fade is not a layer over it — so a fade-out the script left
   * standing must not survive into it. TAOOT's demo Smethells briefing is where
   * that showed: `screentoblack("puppet", 15); puppetvisible(false);
   * playmovie("penote.mov")` — no `blackscreen()` between, so the held snapshot
   * kept the screen and penote.mov played, clickable, behind a black rectangle.
   * The full game has the same shape twice: the darkroom's
   * `playmovie("photobox.mov")` (PHOTO.STG 0012) and the wireless portrait
   * (WIRELESS.SHP 0120).
   *
   * **held** is the frame after a movie, and it is the one state in which the
   * screen belongs to nobody. `playmovie` in TI.EXE returns having freed its
   * buffers and restored nothing (`0x448b00`'s exit path, `0x44969e`–
   * `0x4496c7`): the clip's last frame is simply still in the framebuffer, and
   * the palette is still the clip's, until a script says otherwise. Ours handed
   * the screen straight back to `world` on the frame the movie ended, and with
   * the script resuming a rAF later that is one fully-lit frame of the room
   * between a movie and whatever the script does next — #209, measured at
   * exactly one 16 ms frame of the un-bombed apartment between `bedex.mov` and
   * `ocredits.mov`. `fade.pendingReveal` already means precisely "a movie ended
   * and nothing has said what the screen should look like", so it is also the
   * answer to "is the screen still the movie's": hold until the script draws
   * (`blackscreen`, `clut`, either fade — all of which clear it) or falls quiet
   * (tickFade). The boot is the long case and it is the original's: `boot()`
   * plays `playmode.mov` and then loads the cast, four shops and a stage before
   * `advanceday` reaches `datebed.mov`, with no screen statement in between, so
   * the menu's last frame is what stays up through the load.
   */
  screenOwner(): "movie" | "puppet" | "faded" | "world" | "held" {
    if (this.movies.frame) return "movie";
    if (this.session.fade.pendingReveal) return "held";
    // a conversation close-up replaces the world display, but only while shown:
    // puppetvisible(false) keeps the puppet loaded and reveals the flat behind it
    // (the blackjack table between "play again?" prompts)
    if (this.session.puppet?.visible && !this.session.fade.snapshot) return "puppet";
    // a frozen pre-transition frame while fading out — the room may already have
    // changed underneath (gotospecial fades around changeset)
    if (this.session.fade.snapshot) return "faded";
    return "world";
  }

  /**
   * Build the conversation screen into the framebuffer: the stage flat and its
   * persistent props (TAOOT: the lifesaver, the watch, the held item) first,
   * exactly as the flat path does, then the close-up over the view region above
   * it. The answer rows are text drawn ON the interface band, so the band has to
   * be under them; the original gets that for free, because its bevel redraw
   * restores that strip of screen from a stored copy of the background before
   * every DrawString.
   *
   * Split out of {@link paint} because {@link GameSession.captureFrame} needs it
   * too — see the note there on why a fade-out over a conversation cannot use
   * the frame that happens to be sitting in the buffer.
   */
  compositePuppetScreen(): void {
    this.screen.clearFrame();
    const flat = this.session.stageCtrl.flatImage();
    if (flat) {
      const flatPal = this.flatPalette(flat.palette);
      const fbuf = this.screen.scratchFor(flat.width * flat.height * 4);
      indexedToRGBA(flat.pixels, flat.width, flat.height, flatPal, fbuf);
      this.screen.blitTop(fbuf, flat.width, flat.height);
      this.compositeWorld(this.screen.frame, flatPal, null);
    }
    const cur = this.room?.roomFrame() ?? null;
    this.puppetView.composite(
      this.screen.frame,
      cur
        ? {
            pixels: cur.pixels,
            width: cur.width,
            height: cur.height,
            palette: this.room!.roomPalette(),
          }
        : null,
    );
    this.screen.frameValid = true;
  }

  private paint(ctx: CanvasRenderingContext2D): void {
    const owner = this.screenOwner();
    if (owner === "puppet") {
      this.compositePuppetScreen();
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
        f.originX <= 0 &&
        f.originY <= 0 &&
        f.width >= this.screen.width &&
        f.height >= this.screen.height;
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
          x: f.originX,
          y: f.originY,
          w: f.width,
          h: f.height,
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
    this.coverWithWipe();
    /**
     * The album's photograph, INTO the framebuffer rather than onto the canvas.
     *
     * `tz.dll` writes the shot to the screen buffer a pixel at a time and then
     * hands back the rect it touched, so the photograph is part of the picture:
     * the fade dims it, and a `visualeffect` that captures the screen captures
     * it too. Drawn after the wipe for the same reason the flat is drawn before
     * one — a transition composites over whatever the world last painted.
     */
    const shot = this.session.photoOverlay;
    if (shot && shot.photo.width && shot.photo.height) {
      this.screen.blitAt(shot.photo.rgba, shot.photo.width, shot.photo.height, shot.x, shot.y);
    }
    this.screen.frameValid = true;
    this.screen.blit(ctx);
    this.screen.drawTextOverlay(ctx, this.session.textOverlay);
    this.screen.applyFade(ctx, this.session.fade.level);
    // over a flat the hotspots belong to the room, so only when it is showing;
    // on the bare room there is nothing else they could belong to
    if (drew === "set" || this.session.viewShowing) this.room?.drawRoomHotspots(ctx);
  }

  /**
   * A reveal in progress: put the part of the OLD screen back that the new one
   * has not uncovered yet.
   *
   * The new screen is whatever was just painted, so the wipe is subtractive —
   * only the leaving screen has to be held (`session.wipe.from`), and the arriving
   * one needs no special handling at all. `wipeleft` uncovers from the right edge
   * leftwards and `wiperight` from the left edge rightwards, which is the reading
   * of the two names I could not settle from the disassembly: the effect ids are
   * in TI.EXE's vocabulary (24012 wiperight, 24013 wipeleft) but not compared as
   * plain immediates anywhere, and the whole corpus asks for only these two. If a
   * side-by-side against the original shows them the other way round, the two
   * branches here swap and nothing else moves.
   */
  /**
   * A TURN: both pictures move, at the same rate, in the same direction.
   *
   * The wipe below is subtractive — the arriving screen is already painted, so
   * only the part of the leaving one it has not uncovered has to be put back. A
   * turn cannot work that way, because the arriving picture MOVES too: what you
   * see is a strip of it at one edge, sliding in as the old one leaves by the
   * other. Hence its own routine.
   *
   * ## What the original does, from `tl.exe`
   *
   * `visualeffect` dispatches on the effect id through a 21-entry jump table at
   * 0x447c18 (ids 24001..24021, a slot each), and its one caller (0x44a5ab)
   * hands every effect the SCREEN rect, 0x465f30 — the same rect the blits clip
   * against — with the step count clamped 1..1000.
   *
   * The four turn slots are the only ones that call 0x448cb0, and 0x448cb0 clips
   * BOTH of its rects against that screen rect, which is what a copy has to do
   * when source and destination are one surface. The wipes never touch it: they
   * call the offscreen-to-screen blit 0x448c20 twice. So each pass of a turn is
   * a screen-to-screen block move of `width - di` columns — the picture sliding
   * sideways — followed by one `di`-wide strip of the arriving picture into the
   * edge that move vacated, with `di = travel / steps + 1` (0x44868b).
   *
   * ## Where the strip comes from
   *
   * The source is a zero-width CURSOR that widens by `di` a pass, and where it
   * starts is the part worth writing down, because it explains the art.
   *
   * A full turn starts it at the arriving picture's own edge. A HALF turn starts
   * it a quarter of the way in: `turnhalfleft` computes `half = width / 2` (the
   * travel), then `half / 2` again, and does `P.right -= width/4` followed by
   * `P.left = P.right` (0x448b66..0x448b73) — a cursor at column 480 of 640,
   * sweeping left across 320 columns to land on 160.
   *
   * Which is exactly where the art is. A mid-turn flat — frametype `1`, what
   * `framename("1", …)` builds — is not a whole picture: measured across
   * `i001.stg`, every one is 320 content columns at x=160..479 of a 640 canvas,
   * blank either side. The artists centred it because the engine's cursor starts
   * a quarter in, and a port that sourced from the edge would slide that blank
   * margin across the screen instead of the picture.
   */
  private pushTurn(dir: "turnleft" | "turnright"): void {
    const w = this.session.wipe;
    const from = w.from;
    // Both pictures are HELD (GameSession.wipe.to): the arriving one is the
    // capture the effect took right after `gotoflat`, not this frame's world
    // paint, so an animating destination cannot swap the entering strips
    // mid-ramp — in the original the effect is modal and nothing can redraw
    // its offscreen, and these two captures are that stability, ported.
    const to = w.to;
    if (!from || !to) return;
    const { rgba, width, height } = from;
    if (width !== this.screen.width || height !== this.screen.height) return;
    if (to.width !== width || to.height !== height) return;
    const travel = Math.max(1, Math.round(width * w.span));
    // the original's per-pass delta over the TRAVEL, not a proportion of the whole
    const per = Math.floor(travel / Math.max(1, w.steps)) + 1;
    const off = Math.max(0, Math.min(travel, w.step * per));
    /**
     * Note there is no early-out at `off === 0`.
     *
     * The first pass of a turn has moved nothing yet, so the screen must still be
     * the picture being LEFT — and returning here instead would leave whatever
     * `paintWorldInto` had just drawn, which on the first leg is the mid-turn flat
     * drawn whole: 320 columns of art in a 640 canvas, blank either side. That is
     * the white flash at both edges as a turn begins, and it was intermittent
     * rather than constant because it only appeared when the frame happened to be
     * repainted on that step at all.
     *
     * With the guard gone the arithmetic below already says the right thing: a
     * zero offset copies nothing and fills the whole width from the leaving
     * picture.
     */
    const keep = width - off;
    // the cursor's origin: the picture's own edge for a full turn, a quarter in
    // for a half one
    const quarter = w.span < 1 ? width >> 2 : 0;
    const frame = this.screen.frame;
    const rowBytes = width * 4;
    for (let y = 0; y < height; y++) {
      const row = y * rowBytes;
      if (dir === "turnright") {
        // the picture slides LEFT and the new one enters at the right edge,
        // consumed from its cursor forwards
        frame.set(to.rgba.subarray(row + quarter * 4, row + (quarter + off) * 4), row + keep * 4);
        for (let x = 0; x < keep; x++) {
          const d = row + x * 4;
          const sx = row + (off + x) * 4;
          frame[d] = rgba[sx];
          frame[d + 1] = rgba[sx + 1];
          frame[d + 2] = rgba[sx + 2];
        }
      } else {
        // ...and the mirror: the picture slides RIGHT, the new one enters at the
        // left edge, consumed backwards from a cursor at `width - quarter`
        const end = width - quarter;
        frame.set(to.rgba.subarray(row + (end - off) * 4, row + end * 4), row);
        for (let x = 0; x < keep; x++) {
          const d = row + (off + x) * 4;
          const sx = row + x * 4;
          frame[d] = rgba[sx];
          frame[d + 1] = rgba[sx + 1];
          frame[d + 2] = rgba[sx + 2];
        }
      }
    }
  }

  private coverWithWipe(): void {
    const w = this.session.wipe;
    if (!this.session.compositing || !w.from) return;
    if (w.dir === "turnleft" || w.dir === "turnright") return this.pushTurn(w.dir);
    if (!this.session.wiping) return;
    const { rgba, width, height } = w.from;
    // how much of the old screen is still standing, in columns
    const kept = Math.max(0, Math.min(width, Math.round((width * (w.steps - w.step)) / w.steps)));
    if (kept <= 0) return;
    const put = (srcX: number, cols: number): void => {
      if (cols <= 0) return;
      const strip = this.screen.scratchFor(cols * height * 4);
      for (let y = 0; y < height; y++) {
        const from = (y * width + srcX) * 4;
        strip.set(rgba.subarray(from, from + cols * 4), y * cols * 4);
      }
      this.screen.blitAt(strip, cols, height, srcX, 0);
    };
    /**
     * The BARN DOORS are the same subtraction split at the centre. `open`
     * reveals the new screen middle-outwards, so what still stands of the old
     * one is its two edges — half the kept columns against each side. `close`
     * reveals edges-inwards, so the old screen's remainder is a centre band.
     * Dust's map and inventory arrive through these (visualeffect
     * barndooropen/barndoorclose, NEW.FLT).
     */
    if (w.dir === "open") {
      const half = kept >> 1;
      put(0, half);
      put(width - (kept - half), kept - half);
      return;
    }
    if (w.dir === "close") {
      put((width - kept) >> 1, kept);
      return;
    }
    put(w.dir === "left" ? 0 : width - kept, kept);
  }

  /**
   * Is this flat's view region a MATTE — one flat colour, a hole the room view
   * is composited into — rather than artwork of its own? See the note in
   * {@link paintWorldInto} for what it decides and why the test is on the
   * pixels rather than on engine state.
   *
   * Memoised on the pixel array's identity: a flat is decoded once and kept, so
   * identity is a sound key, and the scan bails on the first differing pixel —
   * which for a real flat is within the first row or two.
   */
  private matteSeen: { pixels: Uint8Array; matte: boolean } | null = null;

  private flatIsMatte(flat: { pixels: Uint8Array; width: number; height: number }): boolean {
    // A matte is a HOLE for a room view, so a game with no rooms cannot have
    // one — and asking would be worse than pointless. The scan below is sized in
    // the 512×384 conversation geometry (see PUPPET_ART_H), which is the geometry
    // of the two games that HAVE rooms rather than of any DreamFactory version;
    // a SET-less game is exactly the case where it is not this game's. Timelapse's
    // flats are 640×480, and the top 264 rows of one being uniform would have
    // declared a hole in a picture that is the whole screen.
    if (!this.room) return false;
    if (this.matteSeen?.pixels === flat.pixels) return this.matteSeen.matte;
    // PUPPET_ART_H is the interface-band split (SCREEN_H - BAND_H = 264) — the
    // rows a room view occupies, which is exactly the region a matte fills.
    let matte = flat.width >= this.screen.width && flat.height >= PUPPET_ART_H;
    if (matte) {
      const first = flat.pixels[0];
      scan: for (let y = 0; y < PUPPET_ART_H; y++) {
        const row = y * flat.width;
        for (let x = 0; x < this.screen.width; x++) {
          if (flat.pixels[row + x] !== first) {
            matte = false;
            break scan;
          }
        }
      }
    }
    this.matteSeen = { pixels: flat.pixels, matte };
    return matte;
  }

  /**
   * Timelapse's `plugin("xray", …)` — let a second flat through a moving hole.
   *
   * The reveal is armed and driven by script (engine/src/runtime/plugins.ts);
   * this is the half that draws it. The hidden flat is blitted only where the
   * MASK prop's opaque pixels fall, using the same
   * `anchor - storedOffset` placement `PropRuntime.composite` uses for the prop
   * itself — so the hole is exactly the shape the artist drew, in exactly the
   * place the prop would have been drawn had it been visible.
   *
   * The mask is a stencil and never a picture: only `f.opaque` is read, never
   * `f.indexed`. Its own `visible` is irrelevant — the scripts keep it false, and
   * `a.shp`'s `clearme` flashes it visible for one frame for a different purpose
   * entirely (erasing the glow on the way out).
   *
   * Both flats share the stage's palette, so the caller's already-dimmed
   * `flatPalette` result is passed in rather than recomputed: the revealed pixels
   * must go through the same CLUT and the same gamma as the ones around them, or
   * the hole would read as a colour shift rather than as light.
   */
  private compositeXRay(flatPal: Uint8ClampedArray): void {
    const xr = this.session.plugins.xray;
    if (!xr || !xr.aimed) return;
    const hidden = this.session.stageCtrl.flatImage(xr.hidden);
    const mask = this.session.propRuntime.get(xr.mask);
    const st = mask?.state();
    if (!hidden || !mask || !st?.frames.length) return;
    const f = mask.shop.frame(mask.currentFrame(st));
    // the aperture's own placement rule, and the prop's: the point the script
    // drives is the prop's ANCHOR, and the frame carries the offset from anchor
    // to top-left
    const dx = xr.x - f.posXraw;
    const dy = xr.y - f.posYraw;
    const { frame, width: sw, height: sh } = this.screen;
    for (let y = 0; y < f.height; y++) {
      const ty = dy + y;
      if (ty < 0 || ty >= sh || ty >= hidden.height) continue;
      for (let x = 0; x < f.width; x++) {
        const tx = dx + x;
        if (tx < 0 || tx >= sw || tx >= hidden.width) continue;
        if (!f.opaque[y * f.width + x]) continue;
        const pal = hidden.pixels[ty * hidden.width + tx] * 4;
        const d = (ty * sw + tx) * 4;
        frame[d] = flatPal[pal];
        frame[d + 1] = flatPal[pal + 1];
        frame[d + 2] = flatPal[pal + 2];
      }
    }
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
  paintWorldInto(): "flat" | "set" | null {
    // stage flat active: the full screen — flat image as background, the room
    // view composited into the top region, props over everything
    const flat = this.session.stageCtrl.flatImage();
    const cur = this.room?.roomFrame() ?? null;
    if (flat) {
      // A MATTE must never be shown bare. main.stg fills its whole 512x264 view
      // region with one palette index (253, which in that flat's own palette is
      // (246,242,219) — a cream): it is a hole for the room view to be
      // composited into, not a picture. Whenever there is no view to cover it,
      // painting it is the "white flash" of #146 — measured off the report's
      // video at (247,241,222), and reproduced walking gstair3 Scene50/View53
      // into the next set, where 109 of 120 sampled frames were matte.
      //
      // Two different windows uncover it, which is why fixing one did not fix
      // the bug. `changeset` runs `closesetfile` FIRST — that sets
      // currentSetName to "none", so viewShowing goes false while the departing
      // room's frame is still in hand and the blit below is skipped — and then
      // the host's load runs before the arriving viewer exists. The rule here
      // covers both, and anything else that leaves the hole uncovered.
      //
      // TI.EXE never shows it, and not because it is faster: `screentoblack` is
      // a palette ramp (0x435b90; see the note in captureFrame), so the
      // departing room's PIXELS stay in the framebuffer until the arriving
      // room's overwrite them. The matte is only ever uncovered for the instant
      // between the flat being blitted and the view landing on top of it.
      // Holding the screen is that behaviour: returning null leaves the canvas
      // exactly as it stands.
      //
      // Testing the FLAT rather than the engine's state is what makes this
      // safe. `set === "none"` would also catch the endgame, where advanceday()
      // closes the set and then transtoflat()s to the closing narration, which
      // must keep painting. Measured across the 15 stage flats on disc 1,
      // main.stg's view region is 100.0% one index and every other flat is
      // 3.4%-22.4% — narend (the ending) is 4.9%, map 3.4%, ctl 7.7%. Only a
      // hole looks like a hole.
      if (!(this.session.viewShowing && cur) && this.flatIsMatte(flat)) return null;
      this.screen.clearFrame();
      const flatPal = this.flatPalette(flat.palette);
      const fbuf = this.screen.scratchFor(flat.width * flat.height * 4);
      indexedToRGBA(flat.pixels, flat.width, flat.height, flatPal, fbuf);
      this.screen.blitTop(fbuf, flat.width, flat.height);
      if (this.session.viewShowing && cur) {
        // straight over the flat's top rows — scratch is free again, the flat
        // is already in the framebuffer
        const vbuf = this.screen.scratchFor(cur.width * cur.height * 4);
        indexedToRGBA(cur.pixels, cur.width, cur.height, this.room!.roomPalette(), vbuf);
        this.screen.blitTop(vbuf, cur.width, cur.height);
      }
      // ...and the xray aperture, between the picture and the props: what it lets
      // through is part of the PICTURE, and the light the player is holding has
      // to land on top of its own glow.
      this.compositeXRay(flatPal);
      // the band's props share the flat's half of the CLUT, the room's props the
      // set's — one CLUT, two owners (see bandPropPalette). Without a room to
      // composite there is no set half in play and the flat owns all of it.
      const propPal =
        this.session.viewShowing && this.room ? this.room.bandPropPalette(flat.palette) : flatPal;
      // world sprites follow the motion-frame camera during movement too, so
      // actors/world props stay visible over the composited set region
      const cam = this.session.viewShowing ? (this.room?.roomCamera() ?? null) : null;
      this.compositeWorld(this.screen.frame, propPal, cam);
      return "flat";
    }
    // bare room view (currentFlat "none"): the view alone, occupying the top
    // region of an otherwise black screen
    if (!cur) return null;
    this.screen.clearFrame();
    const buf = this.screen.scratchFor(cur.width * cur.height * 4);
    indexedToRGBA(cur.pixels, cur.width, cur.height, this.room!.roomPalette(), buf);
    this.screen.blitTop(buf, cur.width, cur.height);
    this.compositeWorld(this.screen.frame, this.room!.roomPropPalette(), this.room!.roomCamera());
    return "set";
  }

  /**
   * Composite the world sprites — actors, then props — over the framebuffer.
   * Shared by the bare-room and stage-flat render paths.
   *
   * World sprites (actors + propxyz/propstar props) track the camera even while
   * the camera is moving, which is what `animating` below is doing in the
   * "visible" argument.
   */
  private compositeWorld(
    data: Uint8ClampedArray,
    palette: Uint8ClampedArray,
    cam: WorldCamera | null,
  ): void {
    const width = this.screen.width;
    const height = this.screen.height;
    const animating = this.room?.roomAnimating ?? false;
    const occ = this.room?.roomOcclusion() ?? null;
    /**
     * A v1 set draws actors and world props as ONE list, far to near.
     *
     * DF.EXE's frame loop (0x4340d0) blits a single array of draw records
     * ([0x45e528]), each stamped with its projection depth at +0xc by
     * whichever renderer built it — actors (0x41e94c) and props alike — so a
     * walker passing in front of a prop covers it, and behind it is covered.
     * The port drew all actors and THEN all world props, which handed every
     * prop the nearer role whatever the depths: leroy ambling out of town
     * walked BEHIND his own whiskey jug. Reported from play.
     *
     * v4 keeps the two-pass order it always had — its pass structure is
     * measured against TAOOT and no TI.EXE evidence has been read either way —
     * so the merge is gated on the room's own version.
     */
    if (cam && this.room?.roomVersion === 1) {
      const ar = this.session.actorRuntime;
      const pr = this.session.propRuntime;
      const jobs = [
        ...ar.drawList(cam).map((e) => ({
          depth: e.proj.depth,
          draw: () => ar.compositeOne(e, data, width, height, palette, cam, occ),
        })),
        ...pr.worldDrawList(cam).map((e) => ({
          depth: e.proj.depth,
          draw: () => pr.compositeWorldOne(e, data, width, height, palette, cam, occ),
        })),
      ].sort((x, y) => y.depth - x.depth);
      for (const j of jobs) j.draw();
      // the screen-space props still ride on top: cam = null skips the world
      // half, which the merge above has already drawn
      pr.composite(
        data, width, height, palette, -Infinity, null,
        animating || this.session.viewShowing, occ,
      );
      return;
    }
    if (cam) {
      this.session.actorRuntime.composite(data, width, height, palette, cam, occ);
    }
    this.session.propRuntime.composite(
      data, width, height, palette, -Infinity, cam,
      animating || this.session.viewShowing,
      occ,
    );
  }


  // -------------------------------------------------------------------------
  // Input — who gets a click, and who gets a key
  //
  // The other half of the same inversion the rest of this file is about. The
  // priority chain is a SCREEN rule — a live movie takes its own clicks, a shown
  // conversation takes its own, and what is left goes to whatever is drawn — and
  // it lived on `SetViewer`, so a game with no room had no way to be clicked at
  // all. The Timelapse page routed its own clicks straight at
  // `StageController.stageClickAt` for exactly as long as that was true, which
  // skipped the movie branch, the `lockevents` gate, the queue and the game's own
  // shipped `mousedown`.
  //
  // Only the room's own zone is delegated ({@link RoomLayer.roomClickAt},
  // {@link RoomLayer.roomHitTest}) — everything above and below it is here.
  // -------------------------------------------------------------------------

  /** a turn or walk is on screen, or a script is in flight — the condition a
   *  movement key is QUEUED behind rather than refused on */
  get movingCamera(): boolean {
    return (this.room?.roomAnimating ?? false) || this.session.scriptBusy;
  }

  /**
   * Engine-side busy: something visual is in flight. Checked by walk/turn —
   * deliberately WITHOUT scriptBusy, because the engine default movement is
   * itself invoked from inside a running script (boot's keydown).
   */
  get busy(): boolean {
    return (
      (this.room?.roomAnimating ?? false) ||
      this.movies.playing ||
      (this.session.puppet?.visible ?? false) || // conversation in progress
      this.session.fading
    );
  }

  /** gate for NEW user input: also waits for running/suspended scripts */
  get inputLocked(): boolean {
    return this.busy || this.session.scriptBusy;
  }

  /**
   * A key, through the whole chain: a movie, then a conversation, then the queue,
   * then a stage that handles its own keys, then the room.
   */
  async keyDown(keyName: string, special = false): Promise<boolean> {
    // A live movie owns the screen and its INPUT — the same precedence clicks
    // already get, and for the same reason: the original has one event queue and
    // the movie loop is the one popping it while a movie plays. So the key is
    // consumed here whatever it is (ESC aborts, anything else is eaten), and the
    // script chain never sees it. `special` is TI.EXE's 0x1fa0 marker — the key is
    // ESC, or was held with Ctrl — which its movie key filter requires; see
    // MoviePlayer.key.
    if (this.movies.playing) {
      this.movies.key(keyName, special);
      return true;
    }
    // A suspended conversation owns its keys the same way, and for the same
    // reason: in the original the puppet's own wait is the loop popping the
    // event queue, so ESC reaches the line being spoken and not the scripts.
    // Ahead of the inputLocked gate below, which a suspended puppetspeak trips.
    if (this.session.puppetCtrl.key(keyName, special)) return true;
    // A press made while a move is already running is QUEUED, not dropped (see
    // {@link EventQueue}) — that is what makes holding a movement key walk a
    // corridor instead of one room. It is posted coalescing, so a held key keeps
    // exactly one press pending however long it is held, and letting go leaves at
    // most one more move to come. Queued counts as consumed: the caller's default
    // walk/turn must not also run, or the press would happen twice.
    //
    // EVERY key, not just the movement arrows, because that is where the original
    // keeps its queue: TI.EXE's window proc posts the record and the main loop
    // pops it, both of them above any notion of WHICH key it was — BOOTFILE 0001's
    // `keydown` only translates the letter afterwards, and it reads the bindings,
    // so the key that means "walk forward" is whatever the control panel last set
    // (`keynorth`/`keywest`/`keyeast`, W/A/D by default). The port had this gate
    // in `pressNav` instead, which only the three arrow names ever reach, so W/A/D
    // pressed during a turn or a walk were dropped while the arrows were kept.
    // The movie and the conversation above are deliberately ahead of it: both own
    // their keys outright (ESC aborts a clip), so those are consumed, not deferred.
    if (this.movingCamera) {
      this.session.events.post({ kind: "keydown", key: keyName, special }, { coalesce: true });
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
    // ...and now the game's own `keydown` ROUTER, which is the entry point for a
    // key exactly as its `mousedown` is for a click.
    //
    // WITH a room, the room runs it: `SetScripts.keyDown` dispatches the same
    // router, and it has to happen inside the room's own nav-hook arming, because
    // the boot's default movement drives the camera through `currentscene()`.
    //
    // With NO room there is nothing to arm and nobody else to run it — and until
    // this branch existed, a roomless game's keys reached nothing. That was the
    // click path's asymmetric twin: `clickDispatch` looks the `mousedown` router up
    // itself and always has, while the `keydown` one was reachable only through a
    // room. Timelapse is where it shows, because its BOOTFILE's `keydown` is its
    // whole navigation — it maps `uparrow` to "forward" and walks the
    // `getframeaction` table.
    if (this.room) return this.room.roomKeyDown(keyName);
    return this.runBootKeyRouter(keyName);
  }

  /**
   * The BOOTFILE's own `keydown`, run directly — the roomless half of
   * {@link keyDown}.
   *
   * Only the ROUTER, for the reason `SetScripts.keyDown` gives: the boot's keydown
   * maps the player's movement keys and then re-routes with
   * `sendtoscene(currentscene(), keydown(arg))`, so everything else the press
   * reaches, it reaches along that re-route carrying the MAPPED key. Running every
   * boot container here instead would hand the default the raw key.
   */
  private async runBootKeyRouter(keyName: string): Promise<boolean> {
    const router = this.session.bootScripts.find((b) => b.script.codes.has("keydown"));
    if (!router) return false;
    const interp = this.session.interp;
    interp.eventConsumed = false;
    try {
      await interp.runHandler(router, "keydown", [keyName], {
        me: router.name,
        target: keyName,
      });
    } catch (e) {
      this.onLog(`script error in ${router.name}.keydown: ${(e as Error).message}`);
    }
    return interp.eventConsumed;
  }

  /** press and release at one point */
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
    // no-op on exit so navigation stays scoped to this gesture. Nothing to arm
    // where there is no room, and nothing that could ask.
    const prevHooks = this.room?.armRoomNav();
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
      if (prevHooks !== undefined) this.room?.disarmRoomNav(prevHooks);
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
   * movie → puppet bevels → overlay-stage regions → props → the ROOM (actors,
   * hotspots, the scene) → the flat/stage surface itself.
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
      // above the answer band = on the picture, which is the repeat (#3)
      this.session.puppetCtrl.puppetPress(this.puppetView.bevelAt(x, y), y < PUPPET_ART_H);
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
    // so it is also the order {@link hitTestAt} already answers in, and the two
    // used to disagree: this dispatched the region first, so anything aiming by
    // hit test was told a prop would take the click and then it didn't.
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
    // {@link hitTestAt} answers in, in the same order.
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
    // the room's own zone — an actor, a hotspot, or the scene itself. A game with
    // no room skips straight past it to the stage, which is the whole of what a
    // SET-less game's clicking is.
    if (await this.room?.roomClickAt(x, y)) return;
    // again the stage itself, not its main script (GameSession.stageOpen)
    if (this.session.stageOpen) {
      if (await this.session.stageCtrl.stageClickAt(x, y)) return;
    }
    await this.clickFlatSurface();
  }

  /**
   * Props (UI band, inventory items) sit in front of everything.
   *
   * Here and not in the room, because a prop is not a room's: it is screen-space
   * unless a room is showing, which is exactly what {@link propAtPointer} says by
   * passing a camera only then. Timelapse's inventory is 25 props across two shops
   * and no room at all.
   */
  private async clickProp(x: number, y: number): Promise<boolean> {
    const prop = this.propAtPointer(x, y);
    if (!prop) return false;
    const name = prop.name || prop.group.name;
    // A prop's mousedown may live on its own script (TAOOT: the trunk's
    // gramdrawer) OR only on the owning shop's main, which dispatches by
    // `switch target` for a whole bank of props (the Enigma switch/wires/dials
    // share one handler). Try the prop script first, then fall through to the
    // shop main, with target = the prop name so that dispatcher matches.
    //
    // The chain STOPS at the shop, and TAOOT's fusebox is the proof rather than
    // the counter-example it looks like. Turning a fuse off lives in FUSE.STG's
    // main and turning it on in FUSE.SHP's, for the same four props — which reads
    // like one click having to reach both. It isn't: the two are reached by the two
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
    // by GROUP, because that is where a sprite's script lives — an instanced
    // copy has a name of its own and shares the group's script (PropInstance.name)
    const own = this.session.propScripts.get(prop.group.name.toLowerCase());
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
   *  while the room is visible, screen-space over an overlay flat */
  propUnder(x: number, y: number): ReturnType<GameSession["propRuntime"]["propAt"]> {
    return this.propAtPointer(x, y);
  }

  /**
   * The prop a click at this point would actually dispatch to — world camera,
   * occlusion and opaque-pixel mask included. Public as {@link propUnder}
   * because anything looking for something to click has to ask the same
   * question the click will: a bare propRuntime.propAt() finds a prop over its
   * transparent pixels too, and clicking there dispatches nothing.
   */
  private propAtPointer(x: number, y: number): ReturnType<GameSession["propRuntime"]["propAt"]> {
    const showing = this.session.viewShowing;
    return this.session.propRuntime.propAt(
      x, y,
      showing ? (this.room?.roomCamera() ?? null) : null,
      showing,
      showing ? (this.room?.roomOcclusion() ?? null) : null,
    );
  }

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
   * A shell that wants the cursor to change WITHOUT the player moving the mouse.
   *
   * A shell asks {@link hover} on pointer movement, which is the only thing the
   * browser tells it about — and the cursor here does not depend on the pointer
   * alone. The `watch` while `lockevents` freezes the world is the case that
   * shows it: an actor starts walking towards you, the boot locks events, and in
   * the original the hourglass appears at once, because its idle loop calls
   * `cursor("watch")` and `SetCursor` every pass. Here the pointer kept whatever
   * it was last told until the player jiggled the mouse — and a player waiting
   * for a character to arrive is a player with a still hand.
   *
   * Set this and the director re-asks on its own whenever the answer could have
   * changed for a reason that is not the pointer.
   */
  onCursor: ((name: string) => void) | null = null;

  /** what the cursor depends on besides where the pointer is */
  private cursorGate = "";

  /**
   * Re-ask for the cursor when the SCREEN's owner changes.
   *
   * Deliberately a cheap string of the four things that decide it over the
   * player's head — the film on screen, a shown puppet, the events lock, and
   * which flat is up — compared once a frame, so the `setcursor` chain runs only
   * when one of them actually flips rather than sixty times a second. Not the
   * pointer, which the shell already reports; and not the props, whose own
   * changes reach it through the flat or through a move.
   */
  private serviceCursor(): void {
    if (!this.onCursor) return;
    const s = this.session;
    const gate = `${this.movies.playingFile ?? ""}|${s.puppet?.visible ? 1 : 0}` +
      `|${truthy(s.interp.globals.get("lockevents") ?? 0) ? 1 : 0}|${s.currentFlat}|${s.currentSetName}`;
    if (gate === this.cursorGate) return;
    this.cursorGate = gate;
    void this.hover(s.pointerX, s.pointerY)
      .then((name) => this.onCursor?.(name))
      .catch(() => {
        /* a cursor is cosmetic; a handler that throws leaves the last one */
      });
  }

  /**
   * The cursor the thing under the pointer asks for — `setcursor` at whatever
   * `hittest` names, in the same priority order a click takes.
   */
  async hover(x: number, y: number): Promise<string> {
    this.session.setPointer(x, y); // keep mouse() current as the cursor moves
    /**
     * `hidecursor()` outranks everything, and the chain is not run at all.
     *
     * The three places Timelapse hides the pointer are the three where it draws
     * its own instead — the bow, the camera's viewfinder bevel, the endgame — and
     * each is a `while stilldown()` / `while not button()` loop that owns the
     * world while a prop follows the mouse. Asking a `setcursor` handler what the
     * pointer should look like there answers a question nobody asked, in a script
     * call interleaved with the loop that is holding the game. `none` rather than
     * `""`: it is the name of the game's own blank cursor (`CURS.NONE`), so a
     * shell needs to know nothing new to honour it.
     */
    if (this.session.cursorHidden) return "none";
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
          // resolved in the scene and view you are LOOKING at, which only the
          // room knows — so the room routes it
          await this.room?.sendRoomPainting(hit.name, "setcursor", point);
          break;
      }
    } catch {
      /* a cursor is cosmetic: a handler that throws leaves the plain arrow */
    }
    return this.session.cursorName;
  }

  // ---- what a driver has to know about a screen it is waiting on -----------

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

  /** the screen is parked on something only the player can answer */
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
   * A LINE is being spoken right now — the only state ESC skips.
   *
   * Exposed because ESC is no longer harmless anywhere else in a conversation:
   * at a plaque it answers with -1 and walks the player out (#131). So anything
   * driving the game has to aim its skip rather than hammer it, and this is the
   * aim. `speakSkip` is set for exactly the length of the race in `playLine`.
   */
  get speaking(): boolean {
    return !!this.session.puppet?.speakSkip;
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

  // -------------------------------------------------------------------------
  // Palettes and the CLUT
  // -------------------------------------------------------------------------

  /**
   * clut(target)/mixclut(target,…) host hook. `dim` null = restore the target's
   * normal palette (clut), a spec = darken it (mixclut). "current" resolves to
   * the room when the 3D view is showing, else the stage flat. The room CLUT is
   * rebuilt eagerly by the layer that owns it; the stage dim is applied to the
   * flat palette at render time (flats are cached per-name, so we mustn't
   * mutate the cache). clut("black") never reaches here — it's a no-op paired
   * with blackscreen() in movie transitions.
   */
  private setClut(target: string, dim: ClutDim | null): void {
    let t = target.toLowerCase();
    if (t === "current") t = this.session.viewShowing ? "set" : "stage";
    if (t === "set") {
      this.room?.applyRoomClut(dim);
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
    const showing = this.session.viewShowing
      ? "set"
      : this.session.currentFlat !== "none"
        ? "stage"
        : "";
    if (t === showing && !this.session.puppet?.visible) {
      this.session.fade.queue.length = 0;
      this.session.fade.snapshot = null;
      this.session.fade.pendingReveal = false;
      this.session.fade.level = 0;
    }
  }

  /**
   * The stage flat's effective palette: dimmed if a stage mixclut is active, then
   * through the display gamma — that order, for the reason in screen-gamma.ts.
   *
   * Memoised on the three things it depends on, because this runs on EVERY frame
   * that draws a flat and both steps allocate. The flat's own decoded palette is a
   * stable object per flat, so identity is a sound key for it.
   */
  private flatPal: {
    base: Uint8ClampedArray;
    dim: ClutDim | null;
    gen: number;
    out: Uint8ClampedArray;
  } | null = null;
  private flatPalette(base: Uint8ClampedArray): Uint8ClampedArray {
    const gen = screenGammaGeneration();
    const hit = this.flatPal;
    if (hit && hit.base === base && hit.dim === this.stageDim && hit.gen === gen) return hit.out;
    const out = displayPalette(this.stageDim ? dimPalette(base, this.stageDim) : base);
    this.flatPal = { base, dim: this.stageDim, gen, out };
    return out;
  }

  // -------------------------------------------------------------------------
  // Movies — the screen's, not a room's
  // -------------------------------------------------------------------------

  /** is a movie on the screen? */
  get moviePlaying(): boolean {
    return this.movies.playing;
  }

  /** which file, if one is playing */
  get movieFile(): string | null {
    return this.movies.playingFile;
  }

  /** play a movie (chain) to its end; resolves when the sequence finishes */
  playMovie(fileName: string, startFrame = 0): Promise<void> {
    return this.movies.play(fileName, startFrame);
  }

  /** drop the movie on screen — a load replaces the screen under it */
  abandonMovie(): void {
    this.movies.abandon();
  }
}
