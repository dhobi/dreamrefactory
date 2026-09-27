/**
 * The maze view: where the player stands, the pre-rendered films a step or a
 * turn plays, and the camera the figures in it are drawn with.
 *
 * ## Poses and moves
 *
 * A pose is a cell and a facing (0 north, 1 south, 2 east, 3 west). A move
 * looks up the transition from the pose to the one the key asks for (0x403420);
 * none means a wall. A step's film then plays its frames 1 to 7 and a turn's 1
 * to 6 — the owning film's pair of poses says which: the same facing twice is a
 * step (0x40d200) — each three ticks after the last. The film's first frame is
 * the view already on screen. At rest the view is the first frame of a film
 * leaving the pose (0x4034fe).
 *
 * ## The camera (0x40d37e)
 *
 * The world is 0x1a4 units a cell, a cell's centre at +0xd2. During a step the
 * camera's centre moves a seventh of a cell a frame; during a turn its heading
 * (256 to the turn, 0 east, y down) moves 64/6 a frame. The eye is 0xfc behind
 * the centre and 0xbe up, and a point projects to
 *
 *   depth = (dx·cos + dy·sin) / 0x4000,   across = (dy·cos − dx·sin) / 0x4000
 *   x = 192 + across·375 / depth,         y = 144 − (z − 0xbe)·375 / depth
 *
 * (0x41d9a0). A figure is only drawn inside the corridor the view looks down —
 * its cell no more than a cell to the side and eight ahead, every cell between
 * there — and clipped to the corridor's rect at its depth (0x409e00).
 */
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { FrameBuffer, decodeFrame } from "@dreamfactory/engine/df/image";
import { cellV0, readMazeV0, type MazeTransitionV0, type MazeV0, type PoseV0 } from "@dreamfactory/engine/df/maze-v0";
import { CELL, CELL_CENTRE, FORWARD, FORWARD_DX, FORWARD_DY, HEADING, LEFT, RIGHT, STEP_CLIP, TURN_CLIP, TURN_LEFT, TURN_RIGHT, VIEW_H, VIEW_W } from "./data";
import type { Rect } from "./screen";

export type Pose = PoseV0;

export const samePose = (a: Pose, b: Pose): boolean => a.x === b.x && a.y === b.y && a.dir === b.dir;

/** where a move goes (0x40d0ed): 1 turn left, 2 turn right, 3 forward */
export function moved(p: Pose, move: number): Pose {
  if (move === LEFT) return { ...p, dir: TURN_LEFT[p.dir] };
  if (move === RIGHT) return { ...p, dir: TURN_RIGHT[p.dir] };
  return { x: p.x + FORWARD_DX[p.dir], y: p.y + FORWARD_DY[p.dir], dir: p.dir };
}

/** the tables' sine and cosine, 0x4000 to 1 */
const COS = Array.from({ length: 256 }, (_, a) => Math.round(Math.cos((a * Math.PI) / 128) * 0x4000));
const SIN = Array.from({ length: 256 }, (_, a) => Math.round(Math.sin((a * Math.PI) / 128) * 0x4000));

/** a thing in the world: what 0x41d9a0 and 0x409e00 read of a figure */
export interface Placed {
  angle: number;
  x: number;
  y: number;
  z: number;
  /** its cell, as it was placed; a figure walking up to the player keeps its own */
  cellX: number;
  cellY: number;
}

export interface Camera {
  angle: number;
  /** the centre, what the figures walk to */
  x: number;
  y: number;
  cellX: number;
  cellY: number;
  eyeX: number;
  eyeY: number;
  cos: number;
  sin: number;
  /** the eye's height (`[0x42e0bc]`), the centre's (`[0x42e0a4]`) and the horizon's line on the screen (`[0x42e0e4]`) */
  eyeZ: number;
  z: number;
  horizon: number;
  /** the pose it moves from, the facing it moves to, the frame of the move (0 at rest) and the move */
  from: Pose;
  toDir: number;
  frame: number;
  move: number;
}

/** the base's and a building's heights (0x40ce16, 0x406f79); the city's are lower (0x406f85, 0x406a3a) */
export const INDOORS = { eyeZ: 0xbe, z: 0x76, horizon: 0x90 };
export const OUTDOORS = { eyeZ: 0x82, z: 0x22, horizon: 0x78 };

export function camera(from: Pose, toDir: number, frame: number, move: number, heights = INDOORS): Camera {
  let x = from.x * CELL + CELL_CENTRE;
  let y = from.y * CELL + CELL_CENTRE;
  let angle: number;
  if (from.dir === toDir) {
    const s = Math.trunc((frame * CELL) / 7);
    angle = HEADING[from.dir];
    if (from.dir === 0) y -= s;
    else if (from.dir === 1) y += s;
    else if (from.dir === 2) x += s;
    else x -= s;
  } else {
    const s = Math.trunc((frame << 6) / 6);
    if (from.dir === 0) angle = toDir === 2 ? 0xc0 + s : 0xc0 - s;
    else if (from.dir === 1) angle = toDir === 2 ? 0x40 - s : 0x40 + s;
    else if (from.dir === 2) angle = toDir === 0 ? 0x100 - s : s;
    else angle = toDir === 0 ? 0x80 + s : 0x80 - s;
  }
  angle &= 0xff;
  const cos = COS[angle];
  const sin = SIN[angle];
  return {
    angle, x, y,
    cellX: Math.trunc(x / CELL), cellY: Math.trunc(y / CELL),
    eyeX: x - Math.trunc((cos * 0xfc) / 0x4000), eyeY: y - Math.trunc((sin * 0xfc) / 0x4000),
    cos, sin, from, toDir, frame, move, ...heights,
  };
}

/** 0x41d9a0: the depth, and the point on the screen when it is ahead */
export function project(c: Camera, p: Placed): { depth: number; y: number; x: number } {
  const dx = p.x - c.eyeX;
  const dy = p.y - c.eyeY;
  const dz = p.z - c.eyeZ;
  const depth = Math.trunc((c.cos * dx + c.sin * dy) / 0x4000);
  if (depth <= 0) return { depth, y: 0, x: 0 };
  const across = Math.trunc((c.cos * dy - c.sin * dx) / 0x4000);
  return { depth, x: 0xc0 + Math.trunc((across * 0x177) / depth), y: c.horizon - Math.trunc((dz * 0x177) / depth) };
}

/**
 * 0x409e00: the rect a figure may show in, or null when the walls hide it.
 * `has(x, y)` is whether the maze has that cell (0x40359c).
 */
export function corridor(c: Camera, p: Placed, has: (x: number, y: number) => boolean): Rect | null {
  const cx = c.cellX;
  const cy = c.cellY;
  let table: number[][];
  let dir: number;
  if (c.from.dir === c.toDir) {
    table = STEP_CLIP[c.frame];
    dir = c.from.dir;
  } else {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    if (!dx && !dy) return [0, 0, VIEW_H, VIEW_W];
    dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 3) : dy > 0 ? 1 : 0;
    if (dir !== c.from.dir && dir !== c.toDir) return null;
    table = TURN_CLIP[dir === c.from.dir ? c.frame : 6 - c.frame];
  }
  let ahead: number;
  if (dir === 0 || dir === 1) {
    const s = dir === 0 ? -1 : 1;
    ahead = (p.cellY - cy) * s;
    if (ahead < 0 || ahead > 8 || Math.abs(p.cellX - cx) > 1) return null;
    for (let k = 1; k <= ahead; k++) if (!has(cx, cy + k * s)) return null;
  } else {
    const s = dir === 2 ? 1 : -1;
    ahead = (p.cellX - cx) * s;
    if (ahead < 0 || ahead > 8 || Math.abs(p.cellY - cy) > 1) return null;
    for (let k = 1; k <= ahead; k++) if (!has(cx + k * s, cy)) return null;
  }
  let r = table[ahead] as unknown as [number, number, number, number];
  // a turn's rects are drawn for a turn left: mirrored for the side a right turn sweeps (0x40a33f)
  if ((c.move === LEFT && dir === c.from.dir) || (c.move === RIGHT && dir === c.toDir)) r = [r[0], VIEW_W - r[3], r[2], VIEW_W - r[1]];
  return r[1] < r[3] ? r : null;
}

/** a loaded maze and the view drawn from it */
export class MazeView {
  readonly maze: MazeV0;
  readonly containers: Uint8Array[];
  private readonly fb = new FrameBuffer();
  /** the container on screen */
  shown = -1;

  constructor(readonly name: string, data: Uint8Array) {
    const file = readContainerFile(data);
    this.maze = readMazeV0(file);
    this.containers = file.containers.map((c) => c.data);
  }

  /** the cell's four bytes, by facing (0x403602), or null for no cell */
  cell(x: number, y: number): [number, number, number, number] | null {
    return cellV0(this.maze, x, y);
  }

  /** the byte the pose faces: what a click on the view acts on */
  byte(p: Pose): number {
    return this.cell(p.x, p.y)?.[p.dir] ?? 0;
  }

  has = (x: number, y: number): boolean => this.cell(x, y) !== null;

  /**
   * 0x40367a: the byte a pose faces, rewritten — a cabinet emptied. It writes
   * where there is no cell too: the −1 there takes the byte, and four writes
   * make it a cell of nothing (the final chamber's ring round the queen, 0x4069cb).
   */
  setByte(p: Pose, value: number): void {
    const i = p.x * 32 + p.y;
    const c = this.maze.cells[i];
    const shift = 24 - 8 * p.dir;
    this.maze.cells[i] = (c & ~(0xff << shift)) | ((value & 0xff) << shift);
  }

  /** 0x403420 */
  transition(from: Pose, to: Pose): MazeTransitionV0 | null {
    return this.maze.transitions.find((t) => samePose(t.from, from) && samePose(t.to, to)) ?? null;
  }

  /** 0x4034fe: the view at rest */
  restFrame(p: Pose): number {
    return this.maze.transitions.find((t) => samePose(t.from, p))?.firstFrame ?? -1;
  }

  /** a step's or a turn's frame count after the first (0x40d200) */
  static framesOf(t: MazeTransitionV0): number {
    return t.film.from.dir === t.film.to.dir ? 7 : 6;
  }

  /** decode a container into the view's buffer; answers its 384x264 indices */
  draw(container: number, draws: boolean): Uint8Array | null {
    this.shown = container;
    if (!draws) return null;
    decodeFrame(this.containers[container], this.fb);
    return this.fb.pixels;
  }

  /** every pose the maze can stand in */
  poses(): Pose[] {
    const seen = new Map<string, Pose>();
    for (const t of this.maze.transitions) seen.set(`${t.from.x},${t.from.y},${t.from.dir}`, t.from);
    return [...seen.values()];
  }
}

export { FORWARD };
