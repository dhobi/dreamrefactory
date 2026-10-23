/**
 * The combat modules' shared geometry (`src/game/combat/lib.ts`, the beam of
 * `src/game/combat/world.ts`), on a stand-in world of a few cells:
 *
 *   npx vitest run jumpraven/tests/combat-lines.ts
 *
 *   - `turnToward` (0x427778): the shorter way round, stopping at the target,
 *     across the circle's seam either way
 *   - `downTheLine` (0x4277e3): the craft in an enemy's row or column ahead of
 *     it, no block between — each of the four headings, blocked and clear
 *   - `callShell` (0x41438a): the pilot calls a shell from behind (0x1a), the
 *     left (0x1c) or the right (0x1b) of the craft's quarter, not from ahead,
 *     not through a block, not five cells off or more
 *   - `burstOver`: the burst's picture by distance, none too near
 *   - the beam (0x40e6c5): a line from end to end with no gap, in each of the
 *     four ways Bresenham's walk takes, clipped to the view, and past
 *     UNMASKED only over the depth layer it is in front of
 *
 * No rip: nothing here reads a game file.
 */
import { expect, test } from "vitest";
import { burstOver, callShell, downTheLine, turnToward } from "../src/game/combat/lib";
import { UNMASKED, VIEW_H, VIEW_W, World, type DrawItem, type Obj } from "../src/game/combat/world";
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";

const at = (cellX: number, cellY: number, angle = 0): Obj => ({ angle, x: cellX * 256 + 0x80, y: cellY * 256 + 0x80, z: 0, cellX, cellY });

/** a stand-in world: the craft at 5,5, `blocks` solid, the jammer off */
function world(blocks: string[] = []) {
  const asked: number[] = [];
  const sprites: { frame: unknown; depth: number }[] = [];
  const w = {
    state: 1,
    speed: 0,
    cam: { angle: 0, cellX: 5, cellY: 5 },
    solid: (x: number, y: number) => blocks.includes(`${x},${y}`),
    pyro: { x41d2cf: () => false, pics: Array.from({ length: 0xd0 }, (_, i) => ({ i })) },
    hud: { x417617: () => [0, 0, 0] },
    comms: { keyframe: () => -1, ask: (_who: number, line: number) => void asked.push(line) },
    project: (o: { depth: number }) => ({ depth: o.depth, y: 10, x: 20 }),
    sprite: (frame: unknown, _y: number, _x: number, depth: number) => void sprites.push({ frame, depth }),
  };
  return { w: w as unknown as Parameters<typeof downTheLine>[0], raw: w, asked, sprites };
}

test("turnToward: the shorter way round, never past the target", () => {
  expect(turnToward(10, 20, 4, 256)).toBe(14);
  expect(turnToward(18, 20, 4, 256)).toBe(20);
  // up across the seam: 250 → 2 is 8 the short way
  expect(turnToward(250, 2, 4, 256)).toBe(254);
  expect(turnToward(254, 1, 4, 256)).toBe(1);
  // down across the seam: 2 → 250
  expect(turnToward(2, 250, 4, 256)).toBe(254);
  expect(turnToward(1, 254, 4, 256)).toBe(254);
  expect(turnToward(20, 10, 4, 256)).toBe(16);
  expect(turnToward(12, 10, 4, 256)).toBe(10);
});

test("downTheLine: the craft ahead along the heading, nothing between", () => {
  const { w, raw } = world(["3,5", "5,7"]);
  expect(downTheLine(w, at(4, 5, 0))).toBe(true);
  expect(downTheLine(w, at(2, 5, 0))).toBe(false); // the block at 3,5
  expect(downTheLine(w, at(5, 2, 0x40))).toBe(true);
  expect(downTheLine(w, at(8, 5, 0x80))).toBe(true);
  expect(downTheLine(w, at(5, 6, 0xc0))).toBe(true);
  expect(downTheLine(w, at(5, 8, 0xc0))).toBe(false); // the block at 5,7
  const walled = world(["5,3", "7,5"]).w;
  expect(downTheLine(walled, at(5, 2, 0x40))).toBe(false);
  expect(downTheLine(walled, at(8, 5, 0x80))).toBe(false);
  // the enemy's sight jammed along it
  raw.pyro.x41d2cf = () => true;
  expect(downTheLine(w, at(4, 5, 0))).toBe(false);
  raw.state = 0;
  raw.pyro.x41d2cf = () => false;
  expect(downTheLine(w, at(4, 5, 0))).toBe(false);
  expect(() => downTheLine({ ...raw, state: 1 } as unknown as typeof w, at(4, 5, 0x20))).toThrow(/no quarter/);
});

test("callShell: behind, left or right of the craft's quarter, within five cells, not through a block", () => {
  const call = (o: Obj, blocks: string[] = [], angle = 0): number[] => {
    const { w, raw, asked } = world(blocks);
    raw.cam.angle = angle;
    callShell(w, o);
    return asked;
  };
  // heading east (0): west is behind, north the left, south the right
  expect(call(at(3, 5))).toEqual([0x1a]);
  expect(call(at(5, 3))).toEqual([0x1c]);
  expect(call(at(5, 8))).toEqual([0x1b]);
  expect(call(at(8, 5))).toEqual([]);
  expect(call(at(0, 5))).toEqual([]);
  expect(call(at(3, 5), ["4,5"])).toEqual([]);
  expect(call(at(5, 3), ["5,4"])).toEqual([]);
  expect(call(at(5, 8), ["5,7"])).toEqual([]);
  // heading south (0x40): north is behind, east the left, west the right
  expect(call(at(5, 2), [], 0x40)).toEqual([0x1a]);
  expect(call(at(7, 5), [], 0x40)).toEqual([0x1c]);
  expect(call(at(2, 5), [], 0x40)).toEqual([0x1b]);
  // not while the craft moves, a line plays or the copilot navigates
  const { w, raw, asked } = world();
  raw.speed = 4;
  callShell(w, at(3, 5));
  raw.speed = 0;
  raw.comms.keyframe = () => 0;
  callShell(w, at(3, 5));
  raw.comms.keyframe = () => -1;
  raw.hud.x417617 = () => [1, 0, 0];
  callShell(w, at(3, 5));
  expect(asked).toEqual([]);
});

test("burstOver: none nearer than 0x40, then a picture a 0x80 of distance, the farthest from 0x7c0 on", () => {
  const { w, sprites } = world();
  burstOver(w, { depth: 0x3f } as unknown as Obj);
  burstOver(w, { depth: 0x40 } as unknown as Obj);
  burstOver(w, { depth: 0x140 } as unknown as Obj);
  burstOver(w, { depth: 0x5000 } as unknown as Obj);
  expect(sprites.map((s) => (s.frame as { i: number }).i)).toEqual([0xc0, 0xc2, 0xcf]);
});

/* ---- the beam ---- */

const dot: FrameV0 = { width: 1, height: 1, anchorX: 0, anchorY: 0, indexed: new Uint8Array([7]), opaque: new Uint8Array([1]) } as unknown as FrameV0;

function beam(y: number, x: number, y2: number, x2: number, depth = 0, z: Uint8Array | null = null): Set<string> {
  const w = Object.create(World.prototype) as World;
  (w as unknown as { items: DrawItem[] }).items = [{ kind: 0, frame: dot, y, x, y2, x2, mirror: false, depth } as DrawItem];
  const view = new Uint8Array(VIEW_W * VIEW_H);
  w.drawItems(view, z);
  const lit = new Set<string>();
  view.forEach((v, i) => v && lit.add(`${Math.trunc(i / VIEW_W)},${i % VIEW_W}`));
  return lit;
}

/** every point lit is next to another, and both ends are lit: a line with no gap */
function connected(lit: Set<string>, a: string, b: string): boolean {
  if (!lit.has(a) || !lit.has(b)) return false;
  for (const p of lit) {
    const [y, x] = p.split(",").map(Number);
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dy || dx) && lit.has(`${y + dy},${x + dx}`)) n++;
    if (n === 0 || (n > 2 && lit.size > 2)) return false;
  }
  return true;
}

test("the beam: a line from end to end in each of Bresenham's four ways", () => {
  // shallow down, steep down, shallow up, steep up — and given right to left
  for (const [y, x, y2, x2] of [[10, 10, 20, 50], [10, 10, 60, 30], [60, 10, 40, 70], [80, 10, 20, 30], [20, 50, 10, 10], [40, 70, 60, 10]]) {
    const lit = beam(y, x, y2, x2);
    expect(lit.size).toBe(Math.max(Math.abs(y2 - y), Math.abs(x2 - x)));
    // the walk stops one short of the far end, as the EXE's does
    const near = `${x <= x2 ? y : y2},${Math.min(x, x2)}`;
    expect(lit.has(near)).toBe(true);
    const far = [...lit].sort((a, b) => Number(b.split(",")[1]) - Number(a.split(",")[1]))[0];
    expect(connected(lit, near, far)).toBe(true);
  }
});

test("the beam: clipped to the view, and past UNMASKED drawn only where it is in front", () => {
  const off = beam(10, VIEW_W - 5, 12, VIEW_W + 20);
  expect([...off].every((p) => Number(p.split(",")[1]) < VIEW_W)).toBe(true);
  expect(off.size).toBe(5);
  // a depth layer that is near (0) on the left half and far (0xff) on the right
  const z = new Uint8Array(VIEW_W * VIEW_H);
  for (let i = 0; i < z.length; i++) if (i % VIEW_W >= 40) z[i] = 0xff;
  const depth = UNMASKED + 0x80;
  const masked = beam(30, 10, 30, 70, depth, z);
  expect([...masked].every((p) => Number(p.split(",")[1]) >= 40)).toBe(true);
  expect(masked.size).toBe(30);
  // nearer than UNMASKED it is drawn whole over the buildings
  expect(beam(30, 10, 30, 70, UNMASKED, z).size).toBe(60);
});
