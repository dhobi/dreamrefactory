/**
 * The flying — RAVEN.EXE's levels 3, 5 and 7 (0x40b190): the Raven over a
 * city of four blocks, the view through its canopy, the panels either side.
 * As far as it is ported: the city, the moves through it and the panels
 * around it.
 *
 * ## The city (0x40435c)
 *
 * `citymaze` in the day's folder is a v0 maze (engine/src/df/maze-v0.ts) with
 * Jump Raven's grid: 4 by 4 cells that wrap round, four of them the blocks
 * (1 to 4) and the rest streets. Its 128 transitions are a turn either way and
 * a step forward from every pose on a street, 64 films of 8 frames, and
 * container 2 is the view from the pose the player starts at (0x40495f).
 *
 * ## The view (0x40bd17, 0x40c219)
 *
 * 256 by 310, at (11, 128) in the window: the status strip above it, the
 * weapons strip below, the panels either side. A move plays its film's eight
 * frames, one every 3 ticks at most (0x40c052), and the pose is the move's
 * target once the eighth is up; at rest the view stays as the last frame left
 * it.
 *
 * ## The camera
 *
 * A position is 8.8 fixed point, a cell 256 wide, a cell's centre +0x80
 * (0x40b8d9); a heading is 0 to 255, 0 east, 0x40 south (y down), so facing 0
 * (north) is 0xc0, 1 south 0x40, 2 east 0 and 3 west 0x80 (0x40b93d). A step's
 * frame k puts the craft (k·256 + 256) / 8 along, a turn's swings it
 * (k·64 + 64) / 8 round (0x40bdac, 0x40be78). The eye is 0x80 behind the
 * craft (0x40b9cc) and 0xa0 up. In HOVER the craft also slides across the
 * street, −70 to 70, and rises, 70 to 250 (0x419511) — which the pictures in
 * the view follow (src/game/combat/world.ts); the city's own frames do not.
 *
 * ## The keys (0x40b640)
 *
 * RAVEN.SCO's table (src/game/sco.ts) makes a key 1 up, 2 down, 3 left,
 * 4 right, 5 HOVER/FLY or 6 fire. In FLY, 1, 3 and 4 are a step, a left turn
 * and a right turn, queued eight deep (0x40b728) and taken one at a time when
 * the last is done (0x40b3dd); a held key queues another only when nothing is
 * moving. In HOVER, 1 to 4 slide the craft, 2 a step at a time, 6 with
 * `[0x4378f4]` clear (0x40b69e). A new game starts in HOVER (0x415fbe).
 */
import { readContainerFile, type DFContainerFile } from "@dreamfactory/engine/df/container";
import { FrameBuffer, decodeFrame } from "@dreamfactory/engine/df/image";
import { decodeFrameV0, type FrameV0 } from "@dreamfactory/engine/df/image-v0";
import { transitionV0, type MazeV0, type PoseV0 } from "@dreamfactory/engine/df/maze-v0";
import type { Rect } from "@dreamfactory/engine/v0/screen";
import type { Co, Machine } from "./machine";
import { COS, SIN, VIEW_H as W_VIEW_H, VIEW_W as W_VIEW_W, cosMul, sinMul, type World } from "./combat/world";

/** the view in the window (0x40c315: offset 128 across, 11 down) */
export const VIEW_TOP = 0x0b;
export const VIEW_LEFT = 0x80;
export const VIEW_W = 256;
export const VIEW_H = 310;
export const VIEW: Rect = [VIEW_TOP, VIEW_LEFT, VIEW_TOP + VIEW_H, VIEW_LEFT + VIEW_W];

/** a move (the key table's actions 1–4, and the queue's entries) */
export const UP = 1;
export const DOWN = 2;
export const LEFT = 3;
export const RIGHT = 4;
export const HOVER_FLY = 5;
export const FIRE = 6;

/** frames a move takes, and the ticks between frames (0x40c09a, 0x40c057) */
export const MOVE_FRAMES = 8;
export const FRAME_TICKS = 3;
const QUEUE_DEPTH = 8;

/** a facing's heading (0x40b93d) */
export const HEADING = [0xc0, 0x40, 0, 0x80];
/** a turn: the facing after a left turn and after a right (0x40bc2a, 0x40bc6c) */
const TURN_LEFT = [3, 2, 0, 1];
const TURN_RIGHT = [2, 3, 1, 0];
const FORWARD_DX = [0, 0, 1, -1];
const FORWARD_DY = [-1, 1, 0, 0];

/** HOVER's slide: across the street and up (0x419511) */
const SLIDE_MIN = -0x46;
const SLIDE_MAX = 0x46;
const RISE_MIN = 0x46;
const RISE_MAX = 0xfa;

/** where a move goes (0x40bbff) */
export function moved(p: PoseV0, move: number): PoseV0 {
  if (move === LEFT) return { ...p, dir: TURN_LEFT[p.dir] };
  if (move === RIGHT) return { ...p, dir: TURN_RIGHT[p.dir] };
  return { x: p.x + FORWARD_DX[p.dir], y: p.y + FORWARD_DY[p.dir], dir: p.dir };
}

export interface FlightState {
  pose: PoseV0;
  /** the move under way (its target and frame), or null at rest */
  move: { to: PoseV0; frame: number; first: number } | null;
  queue: number[];
  /** `[0x4378a8]`: FLY, or HOVER */
  fly: boolean;
  /** every move finished, as `x,y,dir` of the pose it reached — what a test reads */
  reached: string[];
}

export class Flight {
  readonly state: FlightState;
  private readonly maze: MazeV0;
  private readonly fb = new FrameBuffer();
  /** the city frame's depth layer is up (a frame without one keeps the last's, 0x4046b4) */
  private haveZ = false;
  /** the view composed: the city frame, the draw list over it */
  private readonly view = new Uint8Array(W_VIEW_W * W_VIEW_H);
  private lastFrame = 0;
  /** the panels' own drawing (the HUD, src/game/combat/hud.ts) once there is one; the four pictures otherwise */
  hudFrame: (() => void) | null = null;

  constructor(
    private readonly m: Machine,
    readonly w: World,
    private readonly city: DFContainerFile,
    private readonly panel: FrameV0[],
  ) {
    this.maze = w.maze;
    const pose = this.maze.start!;
    this.state = { pose, move: null, queue: [], fly: false, reached: [] };
    // 0x40b8d9 …: the craft on the start's centre, 0x50 up, nothing slid
    w.cam.z = 0x50;
    w.slide = 0;
    w.speed = 0;
    this.place(-1);
  }

  /**
   * The camera for frame k of the move under way, or at rest for −1 (0x40bd43
   * … 0x40c007; 0x40b8d9 at the start): the craft on the pose's centre, `along`
   * a step or swung `round` a turn, and slid across the street; the eye on the
   * street's centre line — the city's frames are drawn from there — 0x80 behind.
   */
  private place(k: number): void {
    const s = this.state;
    const w = this.w;
    const p = s.pose;
    let ex = p.x * 256 + 0x80;
    let ey = p.y * 256 + 0x80;
    let cx = ex;
    let cy = ey;
    let heading = HEADING[p.dir];
    if (k >= 0 && s.move) {
      if (s.move.to.dir === p.dir) {
        w.speed = 0x20;
        const along = Math.trunc((k * 256 + 256) / MOVE_FRAMES);
        ex += FORWARD_DX[p.dir] * along;
        ey += FORWARD_DY[p.dir] * along;
        cx = ex + cosMul(heading + 0x40, w.slide);
        cy = ey + sinMul(heading + 0x40, w.slide);
      } else {
        w.speed = 0;
        const round = Math.trunc((k * 64 + 64) / MOVE_FRAMES);
        heading = (heading + (s.move.to.dir === TURN_LEFT[p.dir] ? -round : round)) & 0xff;
        cx += cosMul(heading + 0x40, w.slide);
        cy += sinMul(heading + 0x40, w.slide);
      }
    } else {
      cx += cosMul(heading + 0x40, w.slide);
      cy += sinMul(heading + 0x40, w.slide);
    }
    const c = w.cam;
    c.angle = heading;
    c.x = cx;
    c.y = cy;
    c.cellX = cx >> 8;
    c.cellY = cy >> 8;
    w.cos = COS[heading];
    w.sin = SIN[heading];
    w.eyeX = ex - cosMul(heading, 0x80);
    w.eyeY = ey - sinMul(heading, 0x80);
    w.eyeZ = 0xa0;
    w.eyeCellX = w.eyeX >> 8;
    w.eyeCellY = w.eyeY >> 8;
    w.moveFrame = k;
    w.poseX = p.x;
    w.poseY = p.y;
    w.poseDir = p.dir;
  }

  /** the panels round the view, which the HUD draws its gauges over each frame (0x416025, src/game/combat/hud.ts) */
  drawPanels(): void {
    const m = this.m;
    if (!m.draws) return;
    const p = this.panel;
    m.screen.spriteAt(p[PANEL_LEFT_PIC], 0, 0);
    m.screen.spriteAt(p[PANEL_RIGHT_PIC], 0, 0x180);
    m.screen.spriteAt(p[STATUS_STRIP], 0, VIEW_LEFT);
    m.screen.spriteAt(p[WEAPONS_STRIP], VIEW_TOP + VIEW_H, VIEW_LEFT);
  }

  /** a city frame, container `c`, decoded over the last (0x40454c, 0x404693: its depth layer too) */
  private show(c: number): void {
    const r = decodeFrame(this.city.containers[c].data, this.fb, undefined, "v0");
    if (r.hasZ) this.haveZ = true;
  }

  /**
   * The view's frame (0x40c00c … 0x40c08f; at rest 0x40c253 … 0x40c350): every
   * module's frame (0x40c517), the list sorted and drawn over the city frame
   * (0x40e1e1, 0x40e634), the view put in the window — shaken if a hit asked
   * (0x40c35a) — and the panels after
   */
  private compose(): void {
    const m = this.m;
    const w = this.w;
    w.items = [];
    for (const mod of w.frameList) mod.frame();
    w.sortItems();
    if (m.draws) {
      this.view.set(this.fb.pixels.subarray(0, this.view.length));
      w.drawItems(this.view, this.haveZ ? this.fb.zPixels : null);
      // 0x40c3e5: shaken, the view drawn 8 or 16 lower and the rows above it black
      const drop = w.jolt === 1 ? 8 : w.jolt === 2 ? 16 : 0;
      if (drop) m.screen.fill([VIEW_TOP, VIEW_LEFT, VIEW_TOP + drop, VIEW_LEFT + VIEW_W], 0xff);
      m.screen.put(this.view.subarray(0, (VIEW_H - drop) * VIEW_W), VIEW_W, VIEW_H - drop, VIEW_TOP + drop, VIEW_LEFT);
    }
    w.jolt = 0;
  }

  /** the flight's palette and the CLUTs its flashes go toward (0x40ed51) */
  private base: Uint8ClampedArray | null = null;
  private cluts: Record<number, Uint8ClampedArray> = {};
  /** `[0x43ab50]`: a flash is on the screen, to be put back next frame */
  private flashed = false;

  palettes(base: Uint8ClampedArray, cluts: Record<number, Uint8ClampedArray>): void {
    this.base = base;
    this.cluts = cluts;
  }

  /**
   * 0x426b9b: a flash asked for this frame shown — the palette taken a/b of
   * the way to its CLUT (0x426c01) — or, the frame after one, the palette put back
   */
  private showFlash(): void {
    const w = this.w;
    const base = this.base;
    if (!base) return;
    if (w.flash) {
      const to = this.cluts[w.flash.clut];
      const a = Math.max(1, w.flash.a);
      const b = Math.max(1, w.flash.b);
      if (to && a < b) {
        const p = base.slice();
        for (let i = 0; i < 1024; i++) if ((i & 3) !== 3) p[i] = base[i] + Math.trunc(((to[i] - base[i]) * a) / b);
        this.m.screen.setPalette(p);
      } else if (to) this.m.screen.setPalette(to);
      this.flashed = true;
      w.flash = null;
    } else if (this.flashed) {
      this.m.screen.setPalette(base);
      this.flashed = false;
    }
  }

  /** the window put back after a screen of its own (0x40b53e: the view and the panels whole) */
  redraw(): void {
    this.drawPanels();
    this.compose();
    this.panels();
    this.lastFrame = this.m.ticks;
  }

  /** 0x40bb7a: a film played over the flight (`pods.move`), and the window as it was */
  *overView(play: () => Co): Co {
    const saved = this.m.screen.pixels.slice();
    yield* play();
    this.m.screen.pixels.set(saved);
    this.m.screen.version++;
  }

  /** the view from where the flight starts (0x40495f: container 2), and its first frame (0x40ba97 …) */
  begin(): void {
    this.drawPanels();
    this.show(2);
    this.compose();
    this.panels();
    this.lastFrame = this.m.ticks;
  }

  private panels(): void {
    if (this.hudFrame) this.hudFrame();
    else this.drawPanels();
  }

  /** a key of the table's (0x40b640); `held` is the held key's repeat (message 7) */
  key(action: number, held: boolean): void {
    const s = this.state;
    const w = this.w;
    if (action === FIRE) {
      if (!held) w.pyro?.fire();
      return;
    }
    if (action === HOVER_FLY) {
      // 0x4175ea: the HUD's `[0x4378a8]`, which the copilots may hold
      if (held) return;
      if (w.hud) {
        w.hud.toggleMode();
        s.fly = w.hud.mode() === 1;
      } else s.fly = !s.fly;
      return;
    }
    if (action < UP || action > RIGHT) return;
    if (!s.fly) {
      const by = w.hud?.enginesHit() ? 2 : 6;
      if (action === UP) this.slide(0, by);
      if (action === DOWN) this.slide(0, -by);
      if (action === LEFT) this.slide(-by, 0);
      if (action === RIGHT) this.slide(by, 0);
      return;
    }
    if (action === DOWN) return;
    if (held && (s.queue.length > 0 || s.move)) return;
    if (s.queue.length >= QUEUE_DEPTH) s.queue.shift();
    s.queue.push(action);
  }

  /** 0x419511: HOVER's slide and rise — the craft's own (src/game/combat/pyro.ts) once it is there */
  private slide(across: number, up: number): void {
    const w = this.w;
    if (w.pyro) return w.pyro.slide(across, up);
    const c = w.cam;
    if (up) c.z = Math.min(RISE_MAX, Math.max(RISE_MIN, c.z + up));
    if (across) {
      w.slide = Math.min(SLIDE_MAX, Math.max(SLIDE_MIN, w.slide + across));
      if (!this.state.move) this.place(-1);
    }
  }

  /**
   * 0x40c0c8: a step off the grid's edge is a step onto its other side — the
   * transitions there name the pose past the edge, and the arrival wraps it,
   * moving everything in the world the same whole city across (0x40c184)
   */
  private wrapped(p: PoseV0): PoseV0 {
    const { width: wd, height: h } = this.maze;
    const x = p.x >= wd ? p.x - wd : p.x < 0 ? p.x + wd : p.x;
    const y = p.y >= h ? p.y - h : p.y < 0 ? p.y + h : p.y;
    if (x !== p.x || y !== p.y) this.w.shift((x - p.x) * 256, (y - p.y) * 256);
    return { x, y, dir: p.dir };
  }

  /** one of the flight's frames (message 13, 0x40b3ce): a move taken off the queue, and the move's next frame or the view at rest */
  *frame(): Co {
    const s = this.state;
    const m = this.m;
    const w = this.w;
    if (w.jammer > 0) w.jammer--;
    if (!s.move && s.queue.length) {
      const to = moved(s.pose, s.queue.shift()!);
      const t = transitionV0(this.maze, s.pose, to);
      if (t) s.move = { to, frame: 0, first: t.firstFrame };
    }
    if (s.move) {
      const k = s.move.frame;
      this.show(s.move.first + k);
      this.place(k);
    } else w.speed = 0; // 0x40c244: at rest the craft is still
    this.compose();
    while (m.ticks < this.lastFrame + FRAME_TICKS) yield;
    this.lastFrame = m.ticks;
    this.panels();
    this.showFlash();
    if (s.move && ++s.move.frame >= MOVE_FRAMES) {
      s.pose = this.wrapped(s.move.to);
      s.move = null;
      this.place(-1);
      s.reached.push(`${s.pose.x},${s.pose.y},${s.pose.dir}`);
    }
  }
}

/** `panel`'s pictures (SHARED\PANEL): the left and right panels and the strips above and below the view */
const PANEL_LEFT_PIC = 0;
const STATUS_STRIP = 13;
const WEAPONS_STRIP = 14;
const PANEL_RIGHT_PIC = 21;

/** `panel` read (0x415078) */
export function readPanel(data: Uint8Array): FrameV0[] {
  return readContainerFile(data).containers.map((c) => decodeFrameV0(c.data));
}
