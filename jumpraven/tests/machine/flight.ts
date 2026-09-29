/**
 * The flying's city and its moves (RAVEN.EXE 0x40b190): day one's city,
 * `citymaze` — 4 by 4 cells that wrap round four blocks — from its start pose,
 * FLY by T (the key table's action 5), a step and turns by the arrows, each
 * move eight frames three ticks apart, and a step into a block refused.
 *
 *   npx tsx tests/machine/flight.ts        (from jumpraven/)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { readMazeV0, solidV0 } from "@dreamfactory/engine/df/maze-v0";
import { moved } from "../../src/game/flight";
import { RIP, fail, ok, pass, start } from "./harness";

const { game, m, until, key } = start({ start: { level: 3 } });
until("the flight", () => game.flight !== null);
const f = game.flight!;
const maze = readMazeV0(readContainerFile(new Uint8Array(readFileSync(join(RIP, "DAY1/CITYMAZE")))));
if (JSON.stringify(f.pose) !== JSON.stringify(maze.start)) fail(`starts at ${JSON.stringify(f.pose)}, not the maze's ${JSON.stringify(maze.start)}`);
ok(`day one's city: ${maze.width} by ${maze.height}, from ${JSON.stringify(f.pose)} in HOVER`);

key("t");
until("FLY", () => f.fly);
/** a move by the arrow, and where it ends; the ticks it took */
const fly = (arrow: string, move: number): { at: string; ticks: number } => {
  const before = f.reached.length;
  const t0 = m.ticks;
  key(arrow);
  until(`the move by ${arrow}`, () => f.reached.length > before || (f.move === null && f.queue.length === 0 && m.ticks > t0 + 30));
  void move;
  return { at: f.reached.at(-1) ?? "", ticks: m.ticks - t0 };
};
// turn until a step is open, then step
let turns = 0;
while (solidV0(maze, moved(f.pose, 1).x, moved(f.pose, 1).y)) {
  const r = fly("ArrowRight", 4);
  if (r.ticks < 24) fail(`a turn took ${r.ticks} ticks, not 8 frames of 3`);
  if (++turns > 4) fail("no open street from the start");
}
const from = f.pose;
const step = fly("ArrowUp", 1);
const want = moved(from, 1);
const w = (x: number, n: number) => ((x % n) + n) % n;
if (step.at !== `${w(want.x, 4)},${w(want.y, 4)},${want.dir}` && step.at !== `${want.x},${want.y},${want.dir}`) fail(`a step from ${JSON.stringify(from)} reached ${step.at}`);
ok(`${turns} turn(s), then a step: ${JSON.stringify(from)} → ${step.at} in ${step.ticks} ticks`);

// south, off the grid's edge and back on at its top: the city wraps (0x40c0c8)
while (f.pose.dir !== 1) fly("ArrowRight", 4);
const col = f.pose.x;
const ys: number[] = [];
for (let i = 0; i < 5; i++) {
  if (solidV0(maze, f.pose.x, f.pose.y + 1)) break;
  fly("ArrowUp", 1);
  ys.push(f.pose.y);
}
if (!ys.includes(0) || ys.some((y) => y < 0 || y > 3)) fail(`south down column ${col}: ${ys}, never wrapped`);
ok(`south down column ${col}, round the city's edge: y ${ys.join(" → ")}`);
pass("flight");
