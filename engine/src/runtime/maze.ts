import {
  MazeFilm,
  MazeFilmFrame,
  MazeNode,
  MazeQuad,
  MazeScene,
  MazeStar,
  SettFile,
  TURN,
  exitsOf,
} from "../df/sett";
import { Frame, ScriptInstance, Value } from "./interp";
import type { SpriteCamera } from "./geometry";
import type { GameSession } from "./session";

/**
 * A DreamFactory 5 room in play — the state RedJack.exe keeps for an open
 * `.sett` and the engine half of the commands its scripts drive it with.
 *
 * Almost none of the navigation is the engine's. The set's main script owns
 * it: `setcursor` scrolls the view when the pointer is near an edge (through
 * the BOOTFILE's `tracknodescroll`), `keydown ("up")` finds the exit nearest the
 * way you face, scrolls to it with `nodescroll` and walks it with `launchexit`,
 * and left/right swing to the next exit round with `gotosaver`. What is left
 * for the engine is the camera, the exits, the walk, and where a click lands —
 * which is this class, with no pixels in it (engine/src/web/maze-view.ts draws).
 *
 * ## The angles
 *
 * Every angle a script sees is a fraction of a turn in {@link TURN} parts:
 * `degmask (-1)` is 2²⁴ − 1, `gotonode`'s `camerafov (cfov * 65536)` takes
 * the 64 its callers pass to 90°, and the films store the same integers beside
 * their radians (a heading of 91.53° next to 4265445). Pitch is kept masked,
 * so looking down is just under a full turn — the BOOTFILE's `tncalcnewturn`
 * clamps it with `if curpitch < simpletodeg (180)`.
 *
 * ## Scenes
 *
 * Some rooms (the shark's rowboat, the darts, hub's flame run) have no spheres
 * but scenes ({@link MazeScene}): a few fixed views, turned between on film.
 * `currentscene ("left")` / `("right")` plays one of the scene's two turning
 * films from the view you are at to the next view it reaches, and
 * `currentscene ("strait")` walks the road ahead of the view, to another
 * scene or a node. While any film plays, `currentview ()` is "moving"; at a
 * node it is "node", and in a scene it is the view's name (RedJack.exe's
 * `0x441e4c`).
 *
 * ## The event chain
 *
 * v4's, with nodes for scenes and quads for hotspots: quad script → node
 * script → set main → stage → boot. A node or scene script belongs to its set
 * the way a v4 scene script does, so its bare calls resolve in the set main.
 */

/** a road being walked, or a scene's turn: the film, and the frame on screen */
export interface MazeWalk {
  film: MazeFilm;
  frame: number;
  /** clock time the frame went up */
  at: number;
  /** a turn wraps round its film and stops at the first view it reaches */
  turn?: boolean;
}

/** a film frame held on screen: where a scene's view shows */
export interface MazeShot {
  film: MazeFilm;
  frame: number;
}

/** the camera, as RedJack.exe's projector takes it (0x435490) */
export interface MazeCamera {
  /** i32 world × 10⁵ */
  x: number;
  y: number;
  z: number;
  /** radians */
  heading: number;
  pitch: number;
  roll: number;
  fov: number;
}

/**
 * How long a road film's frame is held, in milliseconds, at a `framerate` of
 * `ticks`. RedJack.exe draws one film frame per pass of its room loop
 * (0x432b00 steps `0x4c95fc` by one), and the pass ends (0x433041) by spinning
 * on the clock until the last frame's time plus `framerate`'s ticks (1/60 s,
 * set at 0x408c80 and clamped to 0..60). RedJack's BOOTFILE sets 2, so a walk
 * runs at 30 frames a second. 0 is "as fast as it draws", which here is one tick.
 */
export const walkFrameMs = (ticks: number): number => (Math.max(1, Math.round(ticks)) * 1000) / 60;

const mask = (x: number): number => ((Math.round(x) % TURN) + TURN) % TURN;
/** a masked angle as a signed one, in (−½, ½] of a turn */
const signed = (x: number): number => {
  const m = mask(x);
  return m > TURN / 2 ? m - TURN : m;
};
export const turnToRad = (x: number): number => (signed(x) * 2 * Math.PI) / TURN;

export const degMask = mask;
export const degDiff = (a: number, b: number): number => {
  const d = mask(a - b);
  return Math.min(d, TURN - d);
};
export const simpleToDeg = (d: number): number => Math.trunc((d * TURN) / 360);
export const degToSimple = (x: number): number => Math.trunc((x * 360) / TURN);
/** step `cur` toward `target` by at most |step|, the short way round */
export const calcTurn = (cur: number, target: number, step: number): number => {
  const d = signed(target - cur);
  const s = Math.abs(step);
  return mask(cur + (Math.abs(d) <= s ? d : Math.sign(d) * s));
};

export class MazeRuntime {
  readonly main: ScriptInstance | null;
  private nodeScripts = new Map<string, ScriptInstance>();
  private quadScripts = new Map<string, ScriptInstance>();

  node: MazeNode | null = null;
  /** the scene you stand in, when it is not a node */
  scene: MazeScene | null = null;
  /** the view of {@link scene} you stand at, as its name */
  sceneView = "";
  /** the picture a scene's view shows */
  shot: MazeShot | null = null;
  heading = 0;
  pitch = 0;
  fov = TURN / 4;
  walk: MazeWalk | null = null;
  /**
   * `nodequality`'s middle argument: 16 at rest and 8 while the BOOTFILE's
   * `tracknodescroll` is moving the view. Below 16 the view draws coarse.
   */
  detail = 16;
  /** the picture the camera projects onto: the game's screen, set by its view */
  size = { width: 640, height: 480 };
  /** told when the camera or the node changed, so the view redraws */
  onChange: () => void = () => {};
  onLog: (line: string) => void = () => {};

  constructor(
    readonly sett: SettFile,
    readonly session: GameSession,
  ) {
    const inst = (loc: number, owner: string): ScriptInstance | null => {
      const d = loc > 0 ? sett.file.containers[loc]?.data : undefined;
      return d && d.length > 8 ? session.instanceFrom(d, owner) : null;
    };
    this.main = inst(sett.mainScript, sett.name);
    for (const n of [...sett.nodes, ...sett.scenes]) {
      const s = inst(n.script, n.name);
      if (s) {
        s.parent = this.main;
        this.nodeScripts.set(n.name.toLowerCase(), s);
      }
    }
    for (const q of sett.quads) {
      const s = inst(q.script, q.name);
      if (s) {
        s.parent = this.main;
        this.quadScripts.set(q.name.toLowerCase(), s);
      }
    }
  }

  get view(): string {
    if (this.walk) return "moving";
    return this.scene ? this.sceneView.toLowerCase() : "node";
  }

  get sceneName(): string {
    return this.node?.name ?? this.scene?.name ?? "none";
  }

  findNode(name: string): MazeNode | undefined {
    const n = name.toLowerCase();
    return this.sett.nodes.find((x) => x.name.toLowerCase() === n);
  }

  findScene(name: string): MazeScene | undefined {
    const n = name.toLowerCase();
    return this.sett.scenes.find((x) => x.name.toLowerCase() === n);
  }

  nodeScript(name = this.sceneName): ScriptInstance | null {
    return this.nodeScripts.get(name.toLowerCase()) ?? null;
  }

  /** any of this room's scripts by owner name: a quad, a node, the set */
  findInstance(name: string): ScriptInstance | null {
    const n = name.toLowerCase();
    if (this.main && (n === this.main.name.toLowerCase() || n === this.session.currentSetName)) return this.main;
    return this.nodeScripts.get(n) ?? this.quadScripts.get(n) ?? null;
  }

  /** is this one of this room's scripts? */
  owns(inst: ScriptInstance): boolean {
    if (inst === this.main) return true;
    for (const s of this.nodeScripts.values()) if (s === inst) return true;
    for (const s of this.quadScripts.values()) if (s === inst) return true;
    return false;
  }

  quadScript(name: string): ScriptInstance | null {
    return this.quadScripts.get(name.toLowerCase()) ?? null;
  }

  // ---- the camera ---------------------------------------------------------

  camera(): MazeCamera | null {
    const f = this.walkFrame() ?? (this.shot ? this.shot.film.frames[this.shot.frame] : null);
    if (f) return { x: f.x, y: f.y, z: f.z, heading: f.heading, pitch: f.pitch, roll: f.roll, fov: f.fov };
    if (!this.node) return null;
    return {
      x: this.node.x,
      y: this.node.y,
      z: this.node.z,
      heading: turnToRad(this.heading),
      pitch: turnToRad(this.pitch),
      roll: 0,
      fov: turnToRad(this.fov),
    };
  }

  setHeading(v: number): void {
    this.heading = mask(v);
    this.onChange();
  }
  setPitch(v: number): void {
    this.pitch = mask(v);
    this.onChange();
  }
  setFov(v: number): void {
    // a field of view is never a wrapped angle; keep it on screen
    this.fov = Math.max(TURN / 360, Math.min(TURN / 2 - 1, Math.round(v)));
    this.onChange();
  }

  /**
   * `nodescroll (head, pitch, fov, step)`: move the camera one step toward a
   * view, and say whether it is still on the way — the scripts loop on it with
   * a `forceupdate ()` between steps.
   */
  nodeScroll(head: number, pitch: number, fov: number, step: number): boolean {
    const h = calcTurn(this.heading, head, step);
    const p = calcTurn(this.pitch, pitch, step);
    const f = calcTurn(this.fov, fov, step);
    const moved = h !== this.heading || p !== this.pitch || f !== mask(this.fov);
    this.heading = h;
    this.pitch = p;
    this.fov = f;
    if (moved) this.onChange();
    return moved;
  }

  // ---- exits --------------------------------------------------------------

  exits(scene = this.sceneName): MazeFilm[] {
    const n = this.findNode(scene);
    return n ? exitsOf(this.sett, n) : [];
  }

  /**
   * `indextoexit (scene, i, what)`: exit `i` (from 1)'s heading, pitch or
   * field of view — the view its film starts on. Exit 0 is the scene's own
   * `specialexit`, which the scripts ask for themselves; asked here it is the
   * camera as it stands, so a node with no exits never turns.
   */
  exitField(scene: string, i: number, what: number): number {
    const f = this.exits(scene)[i - 1]?.frames[0];
    if (!f) return what === 1 ? this.heading : what === 2 ? this.pitch : this.fov;
    return what === 1 ? mask(f.headDeg) : what === 2 ? mask(f.pitchDeg) : f.fovDeg;
  }

  /** `nearexit (scene, deg)`: the exit whose heading is closest, or 0 */
  nearExit(scene: string, deg: number): number {
    let best = 0;
    let bestD = Infinity;
    this.exits(scene).forEach((f, i) => {
      const d = degDiff(f.frames[0]?.headDeg ?? 0, deg);
      if (d < bestD) {
        bestD = d;
        best = i + 1;
      }
    });
    return best;
  }

  // ---- entering and leaving ----------------------------------------------

  /** fire a lifecycle handler on one script, never throwing */
  private async fire(inst: ScriptInstance | null, handler: string): Promise<void> {
    if (!inst?.script.codes.has(handler)) return;
    try {
      await this.session.interp.runHandler(inst, handler, [], { me: inst.name, target: "" });
    } catch (e) {
      this.onLog(`script error in ${inst.name}.${handler}: ${(e as Error).message}`);
    }
  }

  async openSet(): Promise<void> {
    await this.fire(this.main, "openset");
  }

  async closeSet(): Promise<void> {
    if (this.node) await this.fire(this.nodeScript(), "closescene");
    await this.fire(this.main, "closeset");
  }

  /**
   * Stand at a node or in a scene — the room's first when `name` is empty —
   * and run its `openscene`. At a node the camera keeps its angles: `gotonode`
   * sets them after `changeset` returns, and a walk arriving hands over its
   * last frame's. In a scene you stand at the view called `view`, or where
   * there is none, the view nearest the way the camera faces (`0x444ee0`).
   */
  async enterNode(name: string, view = ""): Promise<boolean> {
    const want = name || this.sett.first;
    const n = this.findNode(want);
    const sc = n ? undefined : this.findScene(want);
    if (!n && !sc) {
      this.onLog(`${this.sett.name}: no node or scene "${name}"`);
      return false;
    }
    this.node = n ?? null;
    this.scene = sc ?? null;
    this.shot = null;
    if (sc) this.standAt(sc, this.viewIndex(sc, view));
    this.onChange();
    await this.fire(this.nodeScript(), "openscene");
    return true;
  }

  /**
   * `currentscene (name)`: go to another node or scene of this room, keeping
   * the view's name. Naming the one you are in does nothing; otherwise the
   * scene you leave hears `closescene` (RedJack.exe's `0x43ffd0`).
   */
  async setScene(name: string): Promise<void> {
    if (name.toLowerCase() === this.sceneName.toLowerCase()) return;
    if (!this.findNode(name) && !this.findScene(name)) {
      this.onLog(`${this.sett.name}: no node or scene "${name}"`);
      return;
    }
    const view = this.sceneView;
    await this.fire(this.nodeScript(), "closescene");
    await this.enterNode(name, view);
  }

  /** a view of `sc` by name, and where it has none, the one nearest the camera's heading */
  private viewIndex(sc: MazeScene, name: string): number {
    const n = name.toLowerCase();
    const named = sc.views.findIndex((v) => v.name.toLowerCase() === n);
    if (named >= 0 || !sc.views.length) return named;
    let best = 0;
    sc.views.forEach((v, i) => {
      if (degDiff(v.heading, this.heading) < degDiff(sc.views[best].heading, this.heading)) best = i;
    });
    return best;
  }

  /** stand at view `i` of `sc`, on the second film's first frame marked with it (`0x434550`) */
  private standAt(sc: MazeScene, i: number, shot?: MazeShot): void {
    this.sceneView = sc.views[i]?.name ?? "";
    const film = sc.films[1] ?? sc.films[0];
    const frame = film ? film.frames.findIndex((f) => f.view === i) : -1;
    this.shot = shot ?? (film && frame >= 0 ? { film, frame } : null);
    const f = this.shot?.film.frames[this.shot.frame];
    if (f) this.lookAs(f);
  }

  /** the camera's angles as a film frame has them */
  private lookAs(f: MazeFilmFrame): void {
    this.heading = mask(f.headDeg);
    this.pitch = mask(f.pitchDeg);
    this.fov = f.fovDeg || TURN / 4;
  }

  /** `roadahead (scene, view)`: the film ahead of a scene's view, as its container; 0 for none */
  roadAhead(scene: string, view: string): number {
    const v = view.toLowerCase();
    return this.findScene(scene)?.views.find((x) => x.name.toLowerCase() === v)?.road?.container ?? 0;
  }

  /**
   * `currentscene ("left" | "right" | "strait")` in a scene: turn to the next
   * view round, or walk the road ahead. The scene hears `closescene` first,
   * and the one you end in `openscene` when the film has played — except that
   * with no road ahead, "strait" does nothing at all (`0x43ffd0`, `0x433c90`).
   */
  async move(dir: "left" | "right" | "strait"): Promise<void> {
    const sc = this.scene;
    if (!sc || this.walk) return;
    const i = sc.views.findIndex((v) => v.name === this.sceneView);
    if (dir === "strait") {
      const road = sc.views[i]?.road;
      if (!road?.frames.length) return;
      await this.fire(this.nodeScript(), "closescene");
      this.walk = { film: road, frame: 0, at: this.session.clock.now };
      this.onChange();
      return;
    }
    await this.fire(this.nodeScript(), "closescene");
    const film = sc.films[dir === "right" ? 0 : 1];
    const frame = film ? film.frames.findIndex((f) => f.view === i) : -1;
    if (!film || frame < 0) return;
    this.walk = { film, frame, at: this.session.clock.now, turn: true };
    this.onChange();
  }

  /**
   * `launchexit (scene, i)`: walk exit `i`'s road. The view is "moving" until
   * its film has played; then the camera stands at the far node looking the way
   * the film ended, and that node's `openscene` runs.
   */
  async launchExit(scene: string, i: number): Promise<void> {
    const film = this.exits(scene)[i - 1];
    if (!film || this.walk) return;
    await this.fire(this.nodeScript(), "closescene");
    this.walk = { film, frame: 0, at: this.session.clock.now };
    this.onChange();
  }

  walkFrame(): MazeFilmFrame | null {
    return this.walk ? (this.walk.film.frames[this.walk.frame] ?? null) : null;
  }

  /**
   * Advance a walk by the clock; true when the frame on screen changed.
   *
   * A frame is held for the game's `framerate`; see {@link walkFrameMs}.
   */
  walkStep(now: number): boolean {
    const w = this.walk;
    if (!w || now - w.at < walkFrameMs(this.session.frameRate)) return false;
    if (w.turn) {
      // round and round the film until a frame marked with a view (0x434b00)
      w.frame = (w.frame + 1) % w.film.frames.length;
      w.at = now;
      const f = w.film.frames[w.frame];
      this.lookAs(f);
      if (f.view >= 0 && this.scene) {
        this.walk = null;
        this.standAt(this.scene, f.view, { film: w.film, frame: w.frame });
        void this.fire(this.nodeScript(), "openscene");
      }
      this.onChange();
      return true;
    }
    if (w.frame + 1 < w.film.frames.length) {
      w.frame++;
      w.at = now;
      return true;
    }
    const last = w.film.frames[w.frame];
    const to = this.sett.nodes.find((n) => n.node === w.film.to);
    const toScene = w.film.toScene ? this.sett.scenes.find((s) => s.scen === w.film.toScene) : undefined;
    const fromScene = !!this.scene;
    this.walk = null;
    this.lookAs(last);
    if (to) {
      this.scene = null;
      this.shot = null;
      void this.enterNode(to.name);
    } else if (toScene) {
      // into a scene: at the view nearest the way the film ended. From a scene
      // its last frame stays up (0x434d40); from a node the view's own picture
      // does (0x432b00 → 0x434550)
      this.node = null;
      this.scene = toScene;
      this.standAt(toScene, this.viewIndex(toScene, ""), fromScene ? { film: w.film, frame: w.frame } : undefined);
      this.onChange();
      void this.fire(this.nodeScript(), "openscene");
    } else this.onChange();
    return true;
  }

  // ---- what a click finds -------------------------------------------------

  /**
   * A quad's outline on the screen, or null when it is not in front of the
   * camera — RedJack.exe's `0x497160`, step for step.
   *
   * The quad is a w × h rectangle in its own XY plane, pitched (about X, by
   * `0x4a9210`) and turned (about Y, `0x4a9180`), then moved to its point less
   * the camera's. The camera's point is its i32 position taken as
   * (−y, −z, x): Y is up-and-down with down positive, and the ground plane is
   * X/Z. The camera then turns the result by its heading, pitch and roll and
   * divides by depth at a focal length of width / (2 tan(fov / 2)).
   */
  quadOutline(q: MazeQuad, width: number, height: number): [number, number][] | null {
    const cam = this.camera();
    if (!cam) return null;
    const rotX = (p: number[], a: number): void => {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const y = p[1] * c + p[2] * s;
      p[2] = p[2] * c - p[1] * s;
      p[1] = y;
    };
    const rotY = (p: number[], a: number): void => {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const x = p[0] * c + p[2] * s;
      p[2] = p[2] * c - p[0] * s;
      p[0] = x;
    };
    const rotZ = (p: number[], a: number): void => {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const x = p[0] * c - p[1] * s;
      p[1] = p[1] * c + p[0] * s;
      p[0] = x;
    };
    const w = q.w / 2;
    const h = q.h / 2;
    const focal = width / (2 * Math.tan(cam.fov / 2));
    const out: [number, number][] = [];
    for (const [lx, ly] of [[-w, -h], [w, -h], [w, h], [-w, h]]) {
      const p = [lx, ly, 0];
      rotX(p, q.pitch);
      rotY(p, q.heading);
      p[0] += q.x + cam.y;
      p[1] += q.y + cam.z;
      p[2] += q.z - cam.x;
      rotY(p, cam.heading);
      rotX(p, cam.pitch);
      rotZ(p, cam.roll);
      if (p[2] <= 1) return null;
      out.push([(p[0] / p[2]) * focal + width / 2, (p[1] / p[2]) * focal + height / 2]);
    }
    return out;
  }

  /** a star by name, as `0x444550` finds it: the first in MARK's order */
  star(name: string): MazeStar | undefined {
    const n = name.toLowerCase();
    return this.sett.stars.find((s) => s.name.toLowerCase() === n);
  }

  /**
   * The camera sprites are drawn through — props and actors placed in the
   * room, `propxyz` or `propstar`.
   *
   * RedJack.exe's `0x435a40` builds a matrix from the camera's heading H, pitch
   * P and roll R, and `0x435740` puts a point through it: the point less the
   * camera, taken as (x, z, y), gives down-the-screen, across and depth,
   *
   *   v     = dx (sH sR − sP cH cR) + dz cR cP + dy (−cH sR − sP sH cR)
   *   h     = dx (−sH cR − sP cH sR) + dz sR cP + dy (cH cR − sP sH sR)
   *   depth = dx cH cP + dz sP + dy sH cP
   *
   * and the screen point is the view's centre less focal × v / depth (and
   * h), the focal length being half the view's width over tan(fov / 2) — the
   * quads' camera ({@link quadOutline}), written the other way round. Sprites
   * sort by the point's distance (`0x42caa0` keeps it at +0x44), far first.
   *
   * The size is `0x4358d0`'s: a frame is drawn scale × focal / (depth′ × 1000)
   * times its own size, where depth′ is the depth of the point lowered by
   * ref × scale / 1000 (`ref` the prop group's i16 at 0x14 — PropGroup.depthRef),
   * clamped to 0..4096 pixels. `camerahi` plays no part: RedJack.exe keeps it
   * (0x408895) and reads it back (0x418b70) and nothing else, so neither does
   * the port.
   *
   * A sprite that faces (`propdeg`) shows the frame nearest its facing less
   * the bearing from it to the camera (`0x41df00`, `0x42d0e0`) — in the frames'
   * 0..255, which is the high byte of a {@link TURN}.
   */
  spriteCamera(width: number, height: number): SpriteCamera | null {
    const cam = this.camera();
    if (!cam) return null;
    const [sH, cH] = [Math.sin(cam.heading), Math.cos(cam.heading)];
    const [sP, cP] = [Math.sin(cam.pitch), Math.cos(cam.pitch)];
    const [sR, cR] = [Math.sin(cam.roll), Math.cos(cam.roll)];
    const m = [
      sH * sR - sP * cH * cR, -sH * cR - sP * cH * sR, cH * cP,
      cR * cP, sR * cP, sP,
      -cH * sR - sP * sH * cR, cH * cR - sP * sH * sR, sH * cP,
    ];
    const focal = width / 2 / Math.tan(cam.fov / 2);
    const cx = width / 2;
    const cy = height / 2;
    const depthOf = (dx: number, dy: number, dz: number): number => dx * m[2] + dz * m[5] + dy * m[8];
    return {
      project: (x, y, z) => {
        const dx = x - cam.x;
        const dy = y - cam.y;
        const dz = z - cam.z;
        const depth = depthOf(dx, dy, dz);
        if (depth <= 0) return null;
        return {
          x: cx - Math.trunc((focal * (dx * m[1] + dz * m[4] + dy * m[7])) / depth),
          y: cy - Math.trunc((focal * (dx * m[0] + dz * m[3] + dy * m[6])) / depth),
          depth: Math.hypot(dx, dy, dz),
          axial: depth,
        };
      },
      size: (x, y, z, scale, ref) => {
        const lower = Math.trunc((ref * scale) / 1000);
        const depth = depthOf(x - cam.x, y - cam.y, z - cam.z - lower);
        return depth > 0 ? (scale * focal) / (depth * 1000) : 0;
      },
      far: this.sett.far,
      ray: (sx, sy) => {
        // the way through screen point (sx, sy), scaled so its depth is 1 —
        // `project` read backwards
        const u = -(sx - cx) / focal;
        const v = -(sy - cy) / focal;
        return {
          x: cam.x, y: cam.y, z: cam.z,
          dx: m[2] + u * m[1] + v * m[0],
          dy: m[8] + u * m[7] + v * m[6],
          dz: m[5] + u * m[4] + v * m[3],
        };
      },
      facing: (x, y, deg) => {
        const toCam = Math.trunc((Math.atan2(cam.y - y, cam.x - x) * TURN) / (2 * Math.PI));
        return (mask(deg - toCam) >> 16) & 0xff;
      },
    };
  }

  /** the quad under a screen point, topmost (last) first as `0x4468b0` asks */
  quadAt(x: number, y: number, width: number, height: number): MazeQuad | null {
    if (this.walk) return null;
    const polys = this.quadOutlines(width, height);
    for (let i = this.sett.quads.length - 1; i >= 0; i--) {
      const poly = polys[i];
      if (poly && inPolygon(poly, x, y)) return this.sett.quads[i];
    }
    return null;
  }

  /**
   * Every quad's outline for the camera as it stands, kept until the camera
   * moves: `idle ()` hit-tests the pointer every frame, and each test used to
   * project every quad in the room again.
   */
  private quadOutlines(width: number, height: number): ([number, number][] | null)[] {
    const cam = this.camera();
    const key = cam ? `${cam.x},${cam.y},${cam.z},${cam.heading},${cam.pitch},${cam.roll},${cam.fov},${width},${height}` : "";
    if (this.outlines?.key !== key) {
      this.outlines = { key, polys: this.sett.quads.map((q) => this.quadOutline(q, width, height)) };
    }
    return this.outlines.polys;
  }
  private outlines: { key: string; polys: ([number, number][] | null)[] } | null = null;

  /**
   * An event to a quad, along its chain: the quad's script, the node you
   * stand at, the set, the stage. Answered when a handler runs without
   * passing it on.
   */
  async quadEvent(name: string, handler: string, args: Value[], parent?: Frame): Promise<boolean> {
    const interp = this.session.interp;
    interp.eventConsumed = false;
    const chain = [this.quadScript(name), this.nodeScript(), this.main, this.session.stageScript];
    for (const inst of chain) {
      if (!inst) continue;
      // the room may have been left by an earlier link (a door); see runHandlerChain
      if (this.session.maze !== this && this.owns(inst)) continue;
      try {
        const res = await interp.runHandler(inst, handler, args, { me: inst.name, target: name }, parent);
        if (interp.eventConsumed || (res.handled && !res.passed)) return true;
      } catch (e) {
        this.onLog(`script error in ${inst.name}.${handler}: ${(e as Error).message}`);
      }
    }
    return false;
  }
}

/** point in polygon by crossings — `0x4a9330` counts quadrant windings, the same test */
export function inPolygon(poly: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
