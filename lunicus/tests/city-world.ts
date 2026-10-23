/**
 * The rules every actor of a city level shares (`src/game/city/world.ts`),
 * on a small open square with walls put where each check wants them:
 *
 *   npx vitest run lunicus/tests/city-world.ts
 *
 *   - `sees` (0x41d66d): a vehicle in the player's row or column with nothing
 *     between sees the player, and its heading to them — never once the level
 *     is no longer in play, never on a diagonal, never through a wall
 *   - `downTheLine` (0x41d500): the player straight down an object's own heading
 *   - the DANGER warnings (0x4112a9): ahead, on the left, on the right, behind,
 *     by where the enemy is from the way the player faces, not through walls
 *   - the bars (0x41070e, 0x4107b4, 0x410adb): held within 0 … 10000, and the
 *     message for each crossing — full, empty, low — said once, as it is crossed
 *   - the pressed weapon's ammo; navigation has none
 *   - a palette flash at its hold is kept, one short of it replaced; an unknown CLUT is none,
 *     a missing picture or sound is nothing
 *
 * No rip: the maze is a stand-in that answers which cells there are.
 */
import { expect, test } from "vitest";
import { World, sees } from "../src/game/city/world";
import { newHud } from "../src/game/panel";
import type { Camera, MazeView } from "../src/game/maze";
import type { Machine } from "../src/game/machine";
import type { CombatParams } from "../src/game/city/params";
import type { Obj } from "../src/game/city/world";

/** a 7×7 square, every cell open but `walls`, the player in the middle */
function world(walls: string[] = []) {
  const sounds: Uint8Array[] = [];
  const m = { roll: () => 1, sound: (s: Uint8Array) => void sounds.push(s) } as unknown as Machine;
  const maze = { has: (x: number, y: number) => x >= 0 && x < 7 && y >= 0 && y < 7 && !walls.includes(`${x},${y}`) } as unknown as MazeView;
  const clut = new Uint8ClampedArray(1024);
  const w = new World(m, maze, {} as CombatParams, newHud(), 7, 2, false, [new Uint8Array(1), new Uint8Array(2)], { CLUT131: clut });
  w.cam = { angle: 0, x: 3 * 0x1a4 + 0xd2, y: 3 * 0x1a4 + 0xd2, cellX: 3, cellY: 3 } as Camera;
  return { w, sounds, clut };
}
const at = (cellX: number, cellY: number, angle = 0): Obj => ({ angle, x: 0, y: 0, z: 0, cellX, cellY });

test("sees: down a clear row or column, the heading to the player; not otherwise", () => {
  const { w } = world(["3,1", "5,3"]);
  // not in play: nobody sees anybody
  expect(sees(w, at(3, 6))).toBeNull();
  w.state = 1;
  expect(sees(w, at(3, 6))).toBe(0xc0); // below, looking north (up)
  expect(sees(w, at(3, 2))).toBe(0x40); // above, the wall at 3,1 behind it
  expect(sees(w, at(3, 0))).toBeNull(); // above, the wall between
  expect(sees(w, at(0, 3))).toBe(0); // west, looking east
  expect(sees(w, at(4, 3))).toBe(0x80); // east, nothing between
  expect(sees(w, at(6, 3))).toBeNull(); // east, the wall at 5,3 between
  expect(sees(w, at(5, 5))).toBeNull(); // a diagonal
  const walled = world(["3,4", "1,3"]).w;
  walled.state = 1;
  expect(sees(walled, at(3, 6))).toBeNull(); // below, the wall at 3,4 between
  expect(sees(walled, at(0, 3))).toBeNull(); // west, the wall at 1,3 between
});

test("downTheLine: the player straight down the object's heading, nothing between", () => {
  const { w } = world(["1,3", "3,5"]);
  expect(w.downTheLine(at(2, 3, 0))).toBe(true); // west of the player, heading east
  expect(w.downTheLine(at(0, 3, 0))).toBe(false); // the wall at 1,3 between
  expect(w.downTheLine(at(4, 3, 0))).toBe(false); // east of the player, heading east: away
  expect(w.downTheLine(at(3, 0, 0x40))).toBe(true); // north, heading south
  expect(w.downTheLine(at(2, 0, 0x40))).toBe(false); // another column
  expect(w.downTheLine(at(6, 3, 0x80))).toBe(true); // east, heading west
  expect(w.downTheLine(at(6, 2, 0x80))).toBe(false); // another row
  expect(w.downTheLine(at(3, 4, 0xc0))).toBe(true); // south, heading north
  expect(w.downTheLine(at(3, 6, 0xc0))).toBe(false); // the wall at 3,5 between
  expect(() => w.downTheLine(at(3, 4, 0x20))).toThrow(/no quarter/);
});

test("DANGER: ahead, left, right and behind by the way the player faces, not through walls", () => {
  const { w } = world(["3,0"]);
  const warn = (o: Obj, angle: number): number[] => {
    w.said = [];
    w.cam.angle = angle;
    w.warnFrom(o);
    return w.said;
  };
  // facing east (angle 0): east ahead, north left, south right, west behind
  expect(warn(at(5, 3), 0)).toEqual([1]);
  expect(warn(at(3, 1), 0)).toEqual([2]);
  expect(warn(at(3, 6), 0)).toEqual([3]);
  expect(warn(at(0, 3), 0)).toEqual([4]);
  // facing south (0x40): south ahead, west behind its right… east is on the left
  expect(warn(at(3, 6), 0x40)).toEqual([1]);
  expect(warn(at(6, 3), 0x40)).toEqual([2]);
  expect(warn(at(0, 3), 0x40)).toEqual([3]);
  expect(warn(at(3, 1), 0x40)).toEqual([4]);
  // through a wall, and off the lines: nothing
  expect(warn(at(3, 0), 0)).toEqual([]);
  expect(warn(at(5, 5), 0)).toEqual([]);
  // the walls along each way stop the warning
  const walled = world(["4,3", "2,3", "3,4", "3,2"]).w;
  for (const o of [at(5, 3), at(1, 3), at(3, 5), at(3, 1)]) {
    walled.said = [];
    walled.warnFrom(o);
    expect(walled.said).toEqual([]);
  }
});

test("the bars: held within 0 … 10000, and the message as each line is crossed", () => {
  const { w } = world();
  const g = w.g;
  const said = (f: () => void): number[] => ((w.said = []), f(), w.said);
  g.energy = 9000;
  expect(said(() => w.energyBy(5000))).toEqual([14]);
  expect(g.energy).toBe(10000);
  expect(said(() => w.energyBy(100))).toEqual([]);
  expect(said(() => w.energyBy(-8000))).toEqual([11]);
  expect(said(() => w.energyBy(-5000))).toEqual([12]);
  expect(g.energy).toBe(0);
  expect(said(() => w.energyBy(-1))).toEqual([]);

  g.shields = 9000;
  expect(said(() => w.shieldsBy(2000))).toEqual([13]);
  expect(said(() => w.shieldsBy(-8000))).toEqual([8]);
  expect(said(() => w.shieldsBy(-3000))).toEqual([10]);
  expect(g.shields).toBe(0);

  w.enemiesBy(20000);
  expect(g.enemies).toBe(10000);
  w.enemiesBy(-30000);
  expect(g.enemies).toBe(0);
  w.scoreBy(25);
  expect(g.score).toBe(25);
});

test("the pressed weapon's ammo, and its messages", () => {
  const { w } = world();
  const g = w.g;
  Object.assign(g, { bullets: 9000, grenades: 3000, rockets: 100 });
  const said = (f: () => void): number[] => ((w.said = []), f(), w.said);
  g.mode = 2;
  expect(w.ammo()).toBe(0);
  expect(said(() => w.ammoBy(-500))).toEqual([]);
  expect([g.bullets, g.grenades, g.rockets]).toEqual([9000, 3000, 100]);
  g.mode = 3;
  expect(w.ammo()).toBe(9000);
  expect(said(() => w.ammoBy(5000))).toEqual([15]);
  g.mode = 4;
  expect(w.ammo()).toBe(3000);
  expect(said(() => w.ammoBy(-1000))).toEqual([7]);
  g.mode = 5;
  expect(w.ammo()).toBe(100);
  expect(said(() => w.ammoBy(-500))).toEqual([9]);
  expect(g.rockets).toBe(0);
  expect(said(() => w.ammoBy(50))).toEqual([]);
});

test("flashes, pictures and sounds that are not there", () => {
  const { w, sounds, clut } = world();
  w.flashWith("CLUT999", 1, 1);
  expect(w.flash).toBeNull();
  w.flashWith("CLUT131", 1, 3);
  expect(w.flash).toEqual({ clut, frames: 1, hold: 3 });
  // short of its hold, the next one takes its place
  w.flashWith("CLUT131", 1, 1);
  expect(w.flash).toEqual({ clut, frames: 1, hold: 1 });
  // at its hold it stays
  w.flashWith("CLUT131", 2, 5);
  expect(w.flash).toEqual({ clut, frames: 1, hold: 1 });

  w.addFixed([0, 0, 264, 384], 0, 10, 10, undefined, false);
  expect(w.draws).toEqual([]);
  w.sound(0);
  w.sound(5);
  expect(sounds).toHaveLength(1);
  w.shakeAt(2);
  w.shakeAt(1);
  expect(w.shake).toBe(2);
});
