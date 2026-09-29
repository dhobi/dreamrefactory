/**
 * The station's crew as the maze view shows them: a figure of sixteen headings
 * (`shared/raife.` and the rest, frame 0 the back, 8 the front) standing in a
 * cell. Click one from their own cell and they walk up to you, turn to face
 * you, and talk; then they walk back.
 *
 * Who stands where, by floor and day (each with a random choice, `41d914`):
 *
 *   the guard     lower: one of (5,9) (9,13) (9,16) (13,13); upper: (9,21)   0x405926
 *   McCallum      upper, days 1–4: day 2 (16,8); else (0,8) or (0,6)         0x40c0b5
 *   Heisenstein   upper: (10,0) or (8,0)                                    0x4077d2
 *   Raife         upper: day 3 (10,2); else (18,6) or (18,8)                0x416416
 *   Molotov       lower: (9,9), (8,9) or (10,9)                             0x40c682
 *   Sasha         lower, days 1–4: (12,5) or (14,5)                         0x4169ed
 *
 * The figure's point in the cell and its heading are each placing's own. A
 * figure is drawn at `0x2a0 / depth` of its size and not at all nearer than
 * 0xb6 (0x416514); its frame is `((view heading − its heading + 8) & 0xff) >> 4`.
 *
 * The walk (0x4165e5): turn 4 a frame toward the heading, cover `1 / (d/6 + 1)`
 * of the way, bob two units down on frames 0–1 and up on 4–5 of eight. It
 * talks once it stands on the view's centre facing back along it and the view
 * is not moving; if the player walked off meanwhile, it goes home instead.
 */
import { decodeFigureV0, type FrameV0 } from "@dreamfactory/engine/df/image-v0";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { CELL, LOWER, UPPER } from "./data";
import type { Co, Machine } from "./machine";
import { corridor, project, type Camera, type Placed } from "./maze";
import { clip, inRect, type Rect } from "@dreamfactory/engine/v0/screen";

export interface Figure {
  /** the talk file's name, and the figure file's */
  name: string;
  file: string;
  at: Placed;
  home: Placed;
  target: Placed;
  /** 0 standing, 1 walking up to talk, 2 walking home */
  state: number;
  bob: number;
  frames: FrameV0[];
}

type Place = { cell: [number, number]; off: [number, number]; angle: number };

const place = (cx: number, cy: number, ox: number, oy: number, angle: number): Place => ({ cell: [cx, cy], off: [ox, oy], angle });

/** each figure's placing for a floor and day; null when they are not there */
export function placings(name: string, floor: number, day: number, roll: (n: number) => number): Place | null {
  switch (name) {
    case "guard":
      if (floor === LOWER) {
        return [place(5, 9, 0x150, 0xd2, 0x80), place(9, 13, 0xd2, 0x150, 0xc0), place(9, 16, 0xd2, 0x54, 0x40), place(13, 13, 0x150, 0xd2, 0x80)][roll(4) - 1];
      }
      return place(9, 0x15, 0xd2, 0x126, 0xc0);
    case "mccallum":
      if (floor !== UPPER || day >= 5) return null;
      return day === 2 ? place(0x10, 8, 0xd2, 0x126, 0xc0) : place(0, roll(2) === 1 ? 8 : 6, 0x7e, 0xd2, 0x80);
    case "heisenstein":
      if (floor !== UPPER) return null;
      return place(roll(2) === 1 ? 0xa : 8, 0, 0xd2, 0x7e, 0xc0);
    case "raife":
      if (floor !== UPPER) return null;
      return day === 3 ? place(0xa, 2, 0x126, 0xd2, 0x80) : place(0x12, roll(2) === 1 ? 6 : 8, 0x126, 0xd2, 0);
    case "molotov": {
      if (floor !== LOWER) return null;
      const r = roll(3);
      return r === 1 ? place(9, 9, 0xd2, 0x7e, 0x40) : r === 2 ? place(8, 9, 0xd2, 0x7e, 0xc0) : place(0xa, 9, 0xd2, 0x7e, 0xc0);
    }
    case "sasha":
      if (floor !== LOWER || day >= 5) return null;
      return place(roll(2) === 1 ? 0xc : 0xe, 5, 0xd2, 0x7e, 0x40);
  }
  return null;
}

/** in the order the EXE sets them up and draws them (0x40cfc5, 0x40d5d5) */
export const CREW = ["guard", "mccallum", "heisenstein", "raife", "molotov", "sasha"];
/** the talk and figure names; the EXE's own spelling is `heisenstein` */
const FILE: Record<string, string> = { heisenstein: "heisenstein" };

export function* loadCrew(m: Machine, floor: number, day: number): Co<Figure[]> {
  const out: Figure[] = [];
  for (const name of CREW) {
    const p = placings(name, floor, day, (n) => m.roll(n));
    if (!p) continue;
    const { data } = yield* m.file(FILE[name] ?? name, day);
    const frames = readContainerFile(data).containers.slice(0, 16).map((c) => decodeFigureV0(c.data));
    const at: Placed = { angle: p.angle, x: p.cell[0] * CELL + p.off[0], y: p.cell[1] * CELL + p.off[1], z: 0x78, cellX: p.cell[0], cellY: p.cell[1] };
    out.push({ name, file: FILE[name] ?? name, at, home: { ...at }, target: { ...at }, state: 0, bob: 0, frames });
  }
  return out;
}

/** 0x41d493: a heading turned `step` toward another, the short way round */
export function turnToward(angle: number, target: number, step: number): number {
  let t = target;
  if (target === 0 && angle > 0x80) t = 0x100;
  else if (target === 0x40 && angle > 0xc0) t = 0x140;
  else if (target === 0xc0 && angle < 0x40) t = -0x40;
  let a = angle;
  if (a < t) a = Math.min(a + step, t);
  else a = Math.max(a - step, t);
  return a & 0xff;
}

/** one frame of a figure's walk (0x416700) */
function walk(f: Figure): void {
  const a = f.at;
  a.angle = turnToward(a.angle, f.target.angle, 4);
  const dx = f.target.x - a.x;
  const dy = f.target.y - a.y;
  const n = Math.trunc(Math.sqrt(dx * dx + dy * dy) / 6) + 1;
  a.x += Math.trunc(dx / n);
  a.y += Math.trunc(dy / n);
  a.z = 0x78 + (f.bob < 2 ? -2 : f.bob === 4 || f.bob === 5 ? 2 : 0);
  f.bob = (f.bob + 1) % 8;
}

const arrived = (f: Figure): boolean => f.at.x === f.target.x && f.at.y === f.target.y && f.at.angle === f.target.angle;

/**
 * A frame of a figure's life, run as it is drawn (0x4165e5). Answers true when
 * it has just come up to the player: the caller talks, then sends it home.
 */
export function live(f: Figure, c: Camera): boolean {
  if (f.state === 1) {
    if (c.frame === 0 && arrived(f)) {
      const facing = f.at.x === c.x && f.at.y === c.y && ((c.angle + 0x80) & 0xff) === f.at.angle;
      f.target = { ...f.home };
      f.state = 2;
      return facing;
    }
    walk(f);
  } else if (f.state === 2) {
    if (arrived(f)) {
      f.state = 0;
      f.at.z = 0x78;
    } else walk(f);
  }
  return false;
}

export interface Drawn {
  figure: Figure;
  depth: number;
  rect: Rect;
  clip: Rect;
  frame: FrameV0;
}

/** where a figure is on the screen, if it is (0x416514 and the click test 0x4167d8) */
export function drawnAt(f: Figure, c: Camera, has: (x: number, y: number) => boolean): Drawn | null {
  const within = corridor(c, f.at, has);
  if (!within) return null;
  const pt = project(c, f.at);
  if (pt.depth < 0xb6) return null;
  const frame = f.frames[(((c.angle - f.at.angle + 8) & 0xff) >> 4) & 15];
  const h = Math.trunc((frame.height * 0x2a0) / pt.depth);
  const w = Math.trunc((frame.width * 0x2a0) / pt.depth);
  const top = pt.y - Math.trunc((frame.anchorY * h) / frame.height);
  const left = pt.x - Math.trunc((frame.anchorX * w) / frame.width);
  return { figure: f, depth: pt.depth, rect: [top, left, top + h, left + w], clip: within, frame };
}

/** 0x4167d8: a click on a figure from its own cell starts its walk; answers whether it did */
export function clickFigure(f: Figure, c: Camera, has: (x: number, y: number) => boolean, y: number, x: number): boolean {
  if (f.state !== 0 || f.home.cellX !== c.cellX || f.home.cellY !== c.cellY) return false;
  const d = drawnAt(f, c, has);
  if (!d) return false;
  const r = clip(d.rect, d.clip);
  if (r[0] >= r[2] || r[1] >= r[3] || !inRect(r, y, x)) return false;
  f.bob = 0;
  f.state = 1;
  f.target = { angle: (c.angle + 0x80) & 0xff, x: c.x, y: c.y, z: 0x78, cellX: c.cellX, cellY: c.cellY };
  return true;
}
