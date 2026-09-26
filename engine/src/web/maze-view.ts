import { SettFile } from "@dreamfactory/engine/df/sett";
import { depthV5 } from "@dreamfactory/engine/df/image-v5";
import { Value } from "@dreamfactory/engine/runtime/interp";
import { MazeRuntime } from "@dreamfactory/engine/runtime/maze";
import { DEPTH_FAR, FilmFrames, SphereImage } from "@dreamfactory/engine/runtime/maze-render";
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import type { Occlusion, WorldCamera } from "@dreamfactory/engine/runtime/geometry";
import type { DrawSignature } from "@dreamfactory/engine/runtime/signature";
import type { CachedFrame } from "./ring-cache";
import type { ClutDim, RoomLayer, ScreenDirector } from "./screen-director";

/**
 * A DreamFactory 5 room on the screen: the sphere you look around from a node,
 * a scene's view, the film while you walk or turn, and the quads a click can
 * find — RedJack's `.sett`, as a {@link RoomLayer}.
 *
 * The state and the rules are {@link MazeRuntime}'s and the pictures are
 * {@link SphereImage}'s; this is the glue to the screen. The frame it hands the
 * director is true-colour ({@link CachedFrame.rgba}), because every tile of a
 * sphere and every frame of a film carries its own palette and there is no one
 * CLUT to index through.
 *
 * ## Idle
 *
 * The original calls the BOOTFILE's `idle ()` whenever no event is running,
 * and `idle` hittests the pointer and sends `setcursor` to whatever is under it
 * — which is how the set main's `setcursor` gets to scroll the view while the
 * pointer rests near an edge. The port's pointer only reports when it MOVES, so
 * the view runs `idle` itself each frame it stands at a node, and the
 * director's own hover stands aside ({@link ownsHover}).
 */
export class MazeView implements RoomLayer {
  readonly maze: MazeRuntime;
  readonly roomVersion = 4 as const;
  /** actors and props in one list by distance (ScreenDirector.compositeWorld) */
  readonly spritesByDepth = true;
  private readonly width: number;
  private readonly height: number;
  private spheres = new Map<number, SphereImage>();
  private film: { container: number; frames: FilmFrames } | null = null;
  private frame: CachedFrame;
  private rgba: Uint32Array;
  private dirty = true;
  onLog: (line: string) => void = () => {};

  constructor(
    readonly sett: SettFile,
    readonly session: GameSession,
    private readonly dir: ScreenDirector,
    size: { width: number; height: number },
  ) {
    this.width = size.width;
    this.height = size.height;
    this.rgba = new Uint32Array(this.width * this.height);
    this.frame = {
      pixels: new Uint8Array(0),
      width: this.width,
      height: this.height,
      rgba: new Uint8ClampedArray(this.rgba.buffer),
    };
    this.pointerAtOpen = [session.pointerX, session.pointerY];
    this.maze = new MazeRuntime(sett, session);
    this.maze.size = { width: this.width, height: this.height };
    this.maze.onChange = () => {
      this.dirty = true;
    };
    this.maze.onLog = (l) => this.onLog(l);
    session.maze = this.maze;
    session.currentSetName = sett.name.toLowerCase() || session.currentSetFile;
    // a prop or actor `propset` to this room is drawn in it, as a v4 set's (viewer.ts)
    session.propRuntime.currentSet = session.currentSetName;
    session.actorRuntime.currentSet = session.currentSetName;
    session.currentSceneName = () => this.maze.sceneName.toLowerCase();
    session.currentViewName = () => this.maze.view;
    session.interp.onUnknown = (name, args) =>
      this.onLog(`? ${name}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
  }

  /**
   * Open the set and stand at `scene` (its first when it names none), at `view`
   * in a scene.
   *
   * A name the set does not have opens it at its first too. The shipped scripts
   * name one: after Patch vanishes in the cave, patch1.pupp runs `opensetfile
   * ("rjcave.sett", "node21", "node")`, and rjcave has only nodes 27 to 29 — so
   * without this the room stood nowhere, with nothing to click and no way out.
   * rjcave's first is Node27, the chest Nick was standing at. This is a reading
   * of what the game needs, not yet traced in RedJack.exe's Scen.c (0x43f6e0).
   */
  async start(scene: string, view = ""): Promise<void> {
    await this.maze.openSet();
    if (!(await this.maze.enterNode(scene, view)) && scene) await this.maze.enterNode("", view);
  }

  private sphere(container: number): SphereImage {
    let s = this.spheres.get(container);
    if (!s) {
      s = new SphereImage(this.sett.file, container);
      this.spheres.set(container, s);
      // a room keeps only the node it is at and the one it came from
      if (this.spheres.size > 2) this.spheres.delete(this.spheres.keys().next().value!);
    }
    return s;
  }

  private redraw(): void {
    const m = this.maze;
    // nobody looks (session.drawsPictures): the frame changes identity and
    // nothing else — the depth a hit test asks for is roomOcclusion's own render
    if (!this.session.drawsPictures) {
      this.frame = { ...this.frame, pixels: new Uint8Array(0) };
      this.dirty = false;
      return;
    }
    // a walk, a turn, or a scene's view: a film frame
    const w = m.walk ?? m.shot;
    if (w) {
      if (this.film?.container !== w.film.container) {
        this.film = {
          container: w.film.container,
          frames: new FilmFrames(this.sett.file, w.film.frames.map((f) => f.picture)),
        };
      }
      // a frame with no picture (darts' second scene has only those) is black
      if (!this.film.frames.render(w.frame, this.rgba, this.width, this.height)) this.rgba.fill(0xff000000);
    } else {
      this.film = null;
      const cam = m.camera();
      if (!cam || !m.node) return;
      this.sphere(m.node.sphere).render(
        this.rgba, this.width, this.height, cam.heading, cam.pitch, cam.fov, m.detail < 16,
      );
    }
    // a new object each time: the director's "is this already on screen?" is by
    // identity, and a close-up's backdrop cache keys on `pixels`
    this.frame = { ...this.frame, pixels: new Uint8Array(0) };
    this.dirty = false;
  }

  // ---- RoomLayer ----------------------------------------------------------

  get roomAnimating(): boolean {
    return !!this.maze.walk;
  }

  roomFrame(): CachedFrame | null {
    if (this.dirty) this.redraw();
    return this.maze.node || this.maze.scene || this.maze.walk ? this.frame : null;
  }

  /** there is no CLUT; the frame is true-colour */
  roomPalette(): Uint8ClampedArray {
    return NO_CLUT;
  }
  roomPropPalette(): Uint8ClampedArray {
    return NO_CLUT;
  }
  bandPropPalette(stageBase: Uint8ClampedArray): Uint8ClampedArray {
    return stageBase;
  }
  /** the camera props and actors placed in the room are drawn through ({@link MazeRuntime.spriteCamera}) */
  roomCamera(): WorldCamera | null {
    const cam = this.maze.camera();
    const v5 = this.maze.spriteCamera(this.width, this.height);
    if (!cam || !v5) return null;
    return {
      x: cam.x, y: cam.y, z: cam.z, deg: 0, f: 0,
      cx: this.width / 2, cy: this.height / 2, clipW: this.width, clipH: this.height,
      v5,
    };
  }
  /**
   * What hides a sprite at a node: the sphere's depth maps, drawn through the
   * same camera as its pictures, one distance per pixel. A sprite pixel is not
   * drawn where the scenery under it is nearer than the sprite less its
   * `propzclip`, the sprite taken at one depth along the view (geometry.ts,
   * `hiddenBy`). RedJack.exe's placement asks the depths under a sprite's
   * rectangle (`0x436350` → `0x497510`) and drops a sprite that is behind all of
   * them (0x42ce18); the frame pass then sends one that is behind only some
   * through the depth buffer (0x4331a0 → 0x435d40), which is this comparison
   * pixel by pixel.
   *
   * On film (a walk, a turn, a scene) the picture on the screen carries its own
   * depths behind its pixels ({@link depthV5}), and the placement asks those
   * instead while a film is running (0x4363bd → 0x44c000).
   */
  roomOcclusion(): Occlusion | null {
    const m = this.maze;
    const cam = m.camera();
    const shot = m.walkFrame() ?? (m.shot ? m.shot.film.frames[m.shot.frame] : null);
    if (shot) {
      const key = `film:${shot.picture}`;
      if (this.depth?.key !== key) {
        const d = this.sett.file.containers[shot.picture]?.data;
        const map = d ? depthV5(d) : null;
        if (!map) return null;
        this.depth = { key, occ: { z: map.z, w: map.w, h: map.h, scale: 1, levels: DEPTH_FAR } };
      }
      return this.depth.occ;
    }
    if (!m.node || !cam) return null;
    const key = `${m.node.sphere}:${cam.heading}:${cam.pitch}:${cam.fov}`;
    if (this.depth?.key !== key) {
      let s = this.depthSpheres.get(m.node.sphere);
      if (!s) {
        s = new SphereImage(this.sett.file, m.node.sphere, true);
        this.depthSpheres.clear();
        this.depthSpheres.set(m.node.sphere, s);
      }
      // the film's map is its own; a sphere renders into a buffer of the view's size
      const z = this.depth?.key.startsWith("film:") === false ? (this.depth.occ.z as Uint32Array) : new Uint32Array(this.width * this.height);
      s.render(z, this.width, this.height, cam.heading, cam.pitch, cam.fov);
      this.depth = { key, occ: { z, w: this.width, h: this.height, scale: 1, levels: DEPTH_FAR } };
    }
    return this.depth.occ;
  }
  private depth: { key: string; occ: Occlusion } | null = null;
  private depthSpheres = new Map<number, SphereImage>();
  applyRoomClut(_dim: ClutDim | null): void {}
  refreshRoomGamma(): void {}

  advanceRoom(now: number): CachedFrame | null {
    if (this.maze.walkStep(now)) this.dirty = true;
    else if (
      // between scripts, as the original's event loop calls it: a loop this
      // pass fired and ran to its end is part of the pass, not a script holding
      // the engine. The mine's harpoons fly on a loop every pass, and asking
      // `inputLocked` here stopped idle — and the view's turning — at the first
      // shot (ScreenDirector.lockedAtPass)
      !this.maze.walk && !this.idling && !this.dir.lockedAtPass && !this.session.puppet?.visible && this.pointerInside()
    ) {
      void this.idle();
    }
    return this.roomFrame();
  }

  /** the pointer is the room's while it stands at a node — see {@link idle} */
  readonly ownsHover = true;

  /**
   * One run of the BOOTFILE's `idle ()`, the way the original's event loop
   * calls it when nothing else is running: it hittests the pointer and sends
   * `setcursor` to what is under it (the set, near an edge — which scrolls; a
   * quad; an actor or prop), fades the inventory chest in and out, and ends
   * with a `forceupdate ()`.
   */
  private async idle(): Promise<void> {
    const boot = this.session.bootScripts.find((b) => b.script.codes.has("idle"));
    if (!boot) return;
    this.idling = true;
    try {
      await this.session.interp.runHandler(boot, "idle", [], { me: boot.name, target: "" });
    } catch (e) {
      this.onLog(`script error in ${boot.name}.idle: ${(e as Error).message}`);
    } finally {
      this.idling = false;
    }
  }
  private idling = false;

  /**
   * Is the pointer over the room — and has it been moved since the room
   * opened? A pointer the page has never heard from sits at (0, 0), which is
   * inside the set main's scroll margin, and idling there spun the view round.
   */
  private pointerInside(): boolean {
    const { pointerX: x, pointerY: y } = this.session;
    if (!this.pointerMoved) this.pointerMoved = x !== this.pointerAtOpen[0] || y !== this.pointerAtOpen[1];
    // ...or over a stage that has the screen: the boot's idle runs there too,
    // and it is what fades the inventory chest in under the pointer (boot
    // `chest`); its scrolling asks `scrollmargin`, which is false with the room
    // hidden, so the room behind cannot turn
    return this.pointerMoved && (this.pointInRoomImage(x, y) || !this.session.setVisible);
  }
  private pointerMoved = false;
  private readonly pointerAtOpen: [number, number];

  /** outline the quads over the picture (a debugging aid, as SetViewer's) */
  showHotspots = false;

  drawRoomHotspots(ctx: CanvasRenderingContext2D): void {
    if (!this.showHotspots || this.maze.walk) return;
    ctx.save();
    ctx.strokeStyle = "rgba(0,255,255,0.9)";
    for (const q of this.sett.quads) {
      const poly = this.maze.quadOutline(q, this.width, this.height);
      if (!poly) continue;
      ctx.beginPath();
      poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = "rgba(0,255,255,0.9)";
      ctx.fillText(q.name, poly[0][0] + 4, poly[0][1] + 12);
    }
    ctx.restore();
  }

  roomSignature(sig: DrawSignature): void {
    if (this.dirty) this.redraw();
    sig.ref(this.frame).bool(this.showHotspots);
  }

  pointInRoomImage(x: number, y: number): boolean {
    return this.session.viewShowing && x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** a click reaches the room through the boot's `mousedown`; nothing to do here */
  async roomClickAt(_x: number, _y: number): Promise<boolean> {
    return false;
  }

  /** a quad, and where there is none, the node you stand at */
  roomHitTest(x: number, y: number): { name: string; type: string } | null {
    if (!this.pointInRoomImage(x, y)) return null;
    const q = this.maze.quadAt(x, y, this.width, this.height);
    if (q) return { name: q.name, type: "quad" };
    return { name: this.maze.sceneName.toLowerCase(), type: "scene" };
  }

  /**
   * The sprite `hittest` finds at (x, y). RedJack.exe (0x418930) asks one sprite
   * hit (0x4324d0), which gathers the actors (0x4069b0) and props (0x42c860)
   * into the list they are drawn from and takes the nearest whose pixels cover
   * the point, then answers "actor" or "prop" by what it got. Screen props are
   * drawn over the room, so they come first.
   */
  spriteHitTest(x: number, y: number): { name: string; type: string } | null {
    const s = this.session;
    const showing = s.viewShowing;
    // every screen prop is clickable, as every one is drawn: a v5 room has no
    // v4 split between the boot's UI shops and the room's (ScreenDirector's
    // composite passes persistentOnly false for v5) — the cannon room's `ok`
    // (cannon.shop) is a set shop's screen prop, and the only way out of it
    const onScreen = s.propRuntime.propAt(x, y, null, false);
    const asProp = (p: NonNullable<typeof onScreen>) => ({ name: p.name || p.group.name, type: "prop" });
    if (onScreen) return asProp(onScreen);
    const cam = showing ? this.roomCamera() : null;
    if (!cam) return null;
    // Occlusion only ever takes a hit away, so with no sprite under the point
    // there is nothing for it to decide — and it is a render of the view's depth
    // whenever the camera has moved, which `idle ()` hit-testing the pointer every
    // frame of a scroll or a walk would otherwise pay each frame.
    if (!s.propRuntime.propAt(x, y, cam, false) && !s.actorRuntime.actorAt(x, y, cam)) return null;
    const occ = this.roomOcclusion();
    const prop = s.propRuntime.propAt(x, y, cam, false, occ);
    const actor = s.actorRuntime.actorAt(x, y, cam, occ);
    if (actor && prop) {
      // an actor drawn over the world (not in the camera's list) is in front
      const ad = s.actorRuntime.drawList(cam).find((e) => e.a === actor)?.proj.depth ?? -Infinity;
      const pd = s.propRuntime.worldDrawList(cam).find((e) => e.p === prop)?.proj.depth ?? Infinity;
      if (pd < ad) return asProp(prop);
    }
    if (actor) return { name: actor.name || actor.member.name, type: "actor" };
    return prop ? asProp(prop) : null;
  }

  async sendRoomPainting(name: string, handler: string, point: Value): Promise<void> {
    await this.maze.quadEvent(name, handler, [point]);
  }

  /** the boot routes a key itself: `sendtoscene (currentscene (), keydown (arg))` */
  async roomKeyDown(keyName: string): Promise<boolean> {
    const router = this.session.bootScripts.find((b) => b.script.codes.has("keydown"));
    if (!router) return false;
    const interp = this.session.interp;
    interp.eventConsumed = false;
    try {
      await interp.runHandler(router, "keydown", [keyName], { me: router.name, target: keyName });
    } catch (e) {
      this.onLog(`script error in ${router.name}.keydown: ${(e as Error).message}`);
    }
    return interp.eventConsumed;
  }

  armRoomNav(): unknown {
    return null;
  }
  disarmRoomNav(_prev: unknown): void {}

  /** give the session back when the room is left */
  release(): void {
    if (this.session.maze === this.maze) this.session.maze = null;
    this.spheres.clear();
    this.depthSpheres.clear();
  }
}

const NO_CLUT = new Uint8ClampedArray(256 * 4);
