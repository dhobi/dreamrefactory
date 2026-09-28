import { DFContainerFile } from "./container";

/**
 * DreamFactory 0's mazes — *Lunicus*'s city, bases, engine rooms and hive.
 *
 * A grid you walk one cell at a time and turn on in quarter turns, every step
 * and every turn a short pre-rendered film. Read out of LUNICUS.EXE, whose loader
 * (0x402ca1) opens the file as `'MAZE'` and keeps three things:
 *
 *   container 0  the TRANSITIONS, 28-byte records (the loader divides its size by
 *                0x1c for the count)
 *   container 1  the GRID
 *   2..          the films' frames, 384x264 in the v4 frame codec — the one
 *                `decodeFrame` reads — each film a delta chain from its first
 *
 * ## A pose
 *
 * `{x, y, dir}`, three i16s in that order, dir 0..3. `x` is the coordinate the
 * grid strides by 32 on; "x" and "y" are this port's names for them, and nothing
 * yet says which way is north.
 *
 * ## The grid
 *
 * i16 width and i16 height (the bounds 0x40359c checks x and y against), then
 * 32x32 cells of four bytes, the cell at (x, y) being the dword at
 * `4 + x*128 + y*4`. A cell of `-1` is not there (0x40359c answers "blocked").
 * Otherwise it holds one byte per facing, dir 0 in its top byte and dir 3 in its
 * bottom one (the jump tables at 0x427418 and 0x427428). The game both reads
 * (0x403602) and writes (0x40367a) those bytes, so they are state and not only
 * layout. In every maze of the rip a byte is 0 exactly where a step forward
 * leaves the cell, so a byte that is not 0 is the wall the pose faces and says
 * what that wall is: what a click on the view acts on. The values are the
 * game's per place (lunicus/src/game/base.ts and city/city.ts, `use`).
 *
 * ## A transition
 *
 *   0x00  pose  from
 *   0x06  pose  to
 *   0x0c  pose, pose  the transition whose FILM this one plays
 *   0x18  i32   that film's first frame, a container index
 *
 * 0x403430 looks a record up by from and to, 0x4034fe by from alone, and both
 * hand back the twelve bytes at 0x0c and the frame at 0x18. The second pair is
 * how films are shared: a record whose 0x0c equals its own from/to owns a film,
 * and every other names one that looks the same from where it stands — a turn in
 * one corridor corner reused in another. Films are not given a length; they run
 * from their first frame to the next film's, and the last to the end of the
 * file.
 */

export interface PoseV0 {
  x: number;
  y: number;
  dir: number;
}

export interface MazeTransitionV0 {
  from: PoseV0;
  to: PoseV0;
  /** the transition whose film is played, which is this one when it owns it */
  film: { from: PoseV0; to: PoseV0 };
  /** the film's first frame, a container index */
  firstFrame: number;
  /** how many frames the film has (the distance to the next film) */
  frames: number;
}

export interface MazeV0 {
  width: number;
  height: number;
  /** 32x32 cells, `-1` where there is none; see {@link cellV0} */
  cells: Int32Array;
  transitions: MazeTransitionV0[];
}

const RECORD = 28;
const GRID_STRIDE = 32;

const pose = (v: DataView, at: number): PoseV0 => ({
  x: v.getInt16(at, true),
  y: v.getInt16(at + 2, true),
  dir: v.getInt16(at + 4, true),
});

export function readMazeV0(file: DFContainerFile): MazeV0 {
  const c0 = file.containers[0].data;
  const c1 = file.containers[1].data;
  if (c0.length % RECORD) throw new Error(`v0 maze: ${c0.length} bytes of transitions is not whole records`);
  const v0 = new DataView(c0.buffer, c0.byteOffset, c0.byteLength);
  const v1 = new DataView(c1.buffer, c1.byteOffset, c1.byteLength);

  const width = v1.getInt16(0, true);
  const height = v1.getInt16(2, true);
  const cells = new Int32Array(GRID_STRIDE * GRID_STRIDE);
  for (let i = 0; i < cells.length && 4 + i * 4 + 4 <= c1.length; i++) cells[i] = v1.getInt32(4 + i * 4, true);

  const raw = Array.from({ length: c0.length / RECORD }, (_, r) => {
    const at = r * RECORD;
    return {
      from: pose(v0, at),
      to: pose(v0, at + 6),
      film: { from: pose(v0, at + 12), to: pose(v0, at + 18) },
      firstFrame: v0.getInt32(at + 24, true),
    };
  });
  const starts = [...new Set(raw.map((t) => t.firstFrame))].sort((a, b) => a - b);
  const length = new Map(starts.map((s, i) => [s, (starts[i + 1] ?? file.containers.length) - s]));
  const transitions = raw.map((t) => ({ ...t, frames: length.get(t.firstFrame)! }));
  return { width, height, cells, transitions };
}

/** the four facing bytes of a cell, dir 0 first, or null where there is no cell */
export function cellV0(maze: MazeV0, x: number, y: number): [number, number, number, number] | null {
  if (x < 0 || y < 0 || x >= maze.width || y >= maze.height) return null;
  const c = maze.cells[x * GRID_STRIDE + y];
  if (c === -1) return null;
  return [(c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff];
}

const samePose = (a: PoseV0, b: PoseV0): boolean => a.x === b.x && a.y === b.y && a.dir === b.dir;

/** 0x403430: the transition from one pose to another, or null when there is none */
export function transitionV0(maze: MazeV0, from: PoseV0, to: PoseV0): MazeTransitionV0 | null {
  return maze.transitions.find((t) => samePose(t.from, from) && samePose(t.to, to)) ?? null;
}

/** does this transition own the film it plays? */
export function ownsFilmV0(t: MazeTransitionV0): boolean {
  return samePose(t.film.from, t.from) && samePose(t.film.to, t.to);
}
