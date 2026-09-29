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
 * the view, not ported yet, follow; the city's own frames do not.
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
import { readMazeV0, transitionV0, type MazeV0, type PoseV0 } from "@dreamfactory/engine/df/maze-v0";
import type { Rect } from "@dreamfactory/engine/v0/screen";
import type { Co, Machine } from "./machine";

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

/** the tables' sine and cosine by heading, 0x4000 to 1 (`[0x43cd64]`, `[0x43cd60]`) */
const COS = Array.from({ length: 256 }, (_, a) => Math.round(Math.cos((a * Math.PI) / 128) * 0x4000));
const SIN = Array.from({ length: 256 }, (_, a) => Math.round(Math.sin((a * Math.PI) / 128) * 0x4000));

/** where a move goes (0x40bbff) */
export function moved(p: PoseV0, move: number): PoseV0 {
  if (move === LEFT) return { ...p, dir: TURN_LEFT[p.dir] };
  if (move === RIGHT) return { ...p, dir: TURN_RIGHT[p.dir] };
  return { x: p.x + FORWARD_DX[p.dir], y: p.y + FORWARD_DY[p.dir], dir: p.dir };
}

/** the craft and its eye: `[0x43cd20]`… 8.8 fixed point, and the heading */
export interface Craft {
  x: number;
  y: number;
  heading: number;
  eyeX: number;
  eyeY: number;
  /** `[0x43cd40]` the eye's height */
  eyeZ: number;
  /** `[0x43cd6c]` HOVER's slide across the street, `[0x43cd28]` its height */
  slide: number;
  rise: number;
}

export interface FlightState {
  pose: PoseV0;
  /** the move under way (its target and frame), or null at rest */
  move: { to: PoseV0; frame: number; first: number } | null;
  queue: number[];
  /** `[0x4378a8]`: FLY, or HOVER */
  fly: boolean;
  craft: Craft;
  /** every move finished, as `x,y,dir` of the pose it reached — what a test reads */
  reached: string[];
}

export class Flight {
  readonly state: FlightState;
  private readonly maze: MazeV0;
  private readonly fb = new FrameBuffer();
  private lastFrame = 0;

  constructor(
    private readonly m: Machine,
    private readonly city: DFContainerFile,
    private readonly panel: FrameV0[],
  ) {
    this.maze = readMazeV0(city);
    const pose = this.maze.start!;
    this.state = {
      pose,
      move: null,
      queue: [],
      fly: false,
      craft: { x: 0, y: 0, heading: HEADING[pose.dir], eyeX: 0, eyeY: 0, eyeZ: 0xa0, slide: 0, rise: 0x50 },
      reached: [],
    };
    this.place(0, 0);
  }

  /** the craft at the pose, `along` into a step or `round` into a turn (0x40bd43 …) */
  private place(along: number, round: number): void {
    const s = this.state;
    const c = s.craft;
    const p = s.pose;
    c.x = p.x * 256 + 0x80;
    c.y = p.y * 256 + 0x80;
    let heading = HEADING[p.dir];
    if (s.move && s.move.to.dir === p.dir) {
      c.x += FORWARD_DX[p.dir] * along;
      c.y += FORWARD_DY[p.dir] * along;
    } else if (s.move) {
      const left = s.move.to.dir === TURN_LEFT[p.dir];
      heading = (heading + (left ? -round : round)) & 0xff;
    }
    // the slide is across the heading (0x4195b1 at rest; 0x40bf32 in a turn)
    const across = (heading + 0x40) & 0xff;
    c.x += Math.trunc((COS[across] * c.slide) / 0x4000);
    c.y += Math.trunc((SIN[across] * c.slide) / 0x4000);
    c.heading = heading;
    c.eyeX = c.x - Math.trunc((COS[heading] * 0x80) / 0x4000);
    c.eyeY = c.y - Math.trunc((SIN[heading] * 0x80) / 0x4000);
  }

  /** the panels round the view (the HUD's own drawing, 0x416025, is not ported yet) */
  drawPanels(): void {
    const m = this.m;
    if (!m.draws) return;
    const p = this.panel;
    m.screen.spriteAt(p[PANEL_LEFT_PIC], 0, 0);
    m.screen.spriteAt(p[PANEL_RIGHT_PIC], 0, 0x180);
    m.screen.spriteAt(p[STATUS_STRIP], 0, VIEW_LEFT);
    m.screen.spriteAt(p[WEAPONS_STRIP], VIEW_TOP + VIEW_H, VIEW_LEFT);
  }

  /** a city frame, container `c`, decoded over the last and put in the view */
  private show(c: number): void {
    const m = this.m;
    if (!m.draws) return;
    const r = decodeFrame(this.city.containers[c].data, this.fb);
    m.screen.put(this.fb.pixels, r.width, r.height, VIEW_TOP, VIEW_LEFT);
  }

  /** the view from where the flight starts (0x40495f: container 2) */
  begin(): void {
    this.drawPanels();
    this.show(2);
    this.lastFrame = this.m.ticks;
  }

  /** a key of the table's (0x40b640); `held` is the held key's repeat (message 7) */
  key(action: number, held: boolean): void {
    const s = this.state;
    if (action === HOVER_FLY) {
      if (!held) s.fly = !s.fly;
      return;
    }
    if (action < UP || action > RIGHT) return;
    if (!s.fly) {
      const by = 6;
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

  /** 0x419511: HOVER's slide and rise, each held within its bounds */
  private slide(across: number, up: number): void {
    const c = this.state.craft;
    if (up) c.rise = Math.min(RISE_MAX, Math.max(RISE_MIN, c.rise + up));
    if (across) {
      c.slide = Math.min(SLIDE_MAX, Math.max(SLIDE_MIN, c.slide + across));
      if (!this.state.move) this.place(0, 0);
    }
  }

  /**
   * 0x40c0c8: a step off the grid's edge is a step onto its other side — the
   * transitions there name the pose past the edge, and the arrival wraps it,
   * moving everything in the world the same whole city across (0x40c184)
   */
  private wrapped(p: PoseV0): PoseV0 {
    const { width: w, height: h } = this.maze;
    const x = p.x >= w ? p.x - w : p.x < 0 ? p.x + w : p.x;
    const y = p.y >= h ? p.y - h : p.y < 0 ? p.y + h : p.y;
    if (x !== p.x || y !== p.y) this.onWrap?.((x - p.x) * 256, (y - p.y) * 256);
    return { x, y, dir: p.dir };
  }

  /** told how far the world moved when the pose wrapped (0x40c184) */
  onWrap: ((dx: number, dy: number) => void) | null = null;

  /** one of the flight's frames (message 13, 0x40b3ce): a move taken off the queue, or the move's next frame */
  *frame(): Co {
    const s = this.state;
    const m = this.m;
    if (!s.move && s.queue.length) {
      const to = moved(s.pose, s.queue.shift()!);
      const t = transitionV0(this.maze, s.pose, to);
      if (t) s.move = { to, frame: 0, first: t.firstFrame };
    }
    if (s.move) {
      const k = s.move.frame;
      this.place(Math.trunc((k * 256 + 256) / MOVE_FRAMES), Math.trunc((k * 64 + 64) / MOVE_FRAMES));
      this.show(s.move.first + k);
    }
    while (m.ticks < this.lastFrame + FRAME_TICKS) yield;
    this.lastFrame = m.ticks;
    if (s.move && ++s.move.frame >= MOVE_FRAMES) {
      s.pose = this.wrapped(s.move.to);
      s.move = null;
      this.place(0, 0);
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
