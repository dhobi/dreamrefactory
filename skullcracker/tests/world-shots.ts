/**
 * The pickups and the shots (`src/world/shots.ts`, `src/world/rooms.ts`): the
 * can taken off the floor for its health, the bolt let go out of range, and the
 * mover's side walls.
 *
 *   npx vitest run skullcracker/tests/world-shots.ts
 *
 * Each is called on its own on a level stood up from the rip, the thing placed
 * where the address reads it, and held to what `0x428868`, `0x413b95` and
 * `0x430064` do.
 *
 * Needs the rip; skipped without it.
 */
import { describe, expect, it } from "vitest";
import type { SbkRoom } from "@dreamfactory/engine/df/sbk";
import { haveRip, headless, recordSound, type Game, type Headless } from "./machine/harness";

let h: Headless;
let g: Game;

async function boot(query: string): Promise<void> {
  if (!h) h = await headless(query);
  else await h.load(query);
  g = h.game;
}

describe.skipIf(!haveRip())("a can's pickup, code 2 (0x428868)", () => {
  /** a can resting a reach ahead of him, with its pickup on the same point */
  function canAhead() {
    const i = g.level!.rooms.indexOf(g.p.room!);
    g.p.facing = 1;
    const x = g.p.x + 35;
    const y = g.p.y;
    g.level!.guns[i].push({ code: 2, x, y, left: x - 55, right: x + 55, clock: 0 });
    const can = { x, y, vx: 0, vy: 0, clock: 0, tag: 2, drag: 0, rest: 8510 };
    g.setCans([can, { ...can }]);
    return i;
  }

  it("gives 150 health up to the tank's top, takes ONE can off the floor, and says 0xa (0x43aff0, 0x428893)", async () => {
    await boot("level=5&foes=0");
    const i = canAhead();
    g.stats.health = g.stats.maxHealth - 100;
    const heard = recordSound(g);
    g.inv.drawn = true;
    g.takeGun();
    expect(g.stats.health).toBe(g.stats.maxHealth);
    expect(g.cans).toHaveLength(1);
    expect(g.level!.guns[i].some((q) => q.code === 2)).toBe(false);
    expect(g.inv.drawn).toBe(false);
    expect(heard).toContainEqual({ call: "own", args: [0xa, g.p.x, g.p.y] });
    g.setCans([]);
  });

  it("the other player says 8 for it (0x443319)", async () => {
    await boot("level=5&foes=0&char=1");
    canAhead();
    const heard = recordSound(g);
    g.takeGun();
    expect(heard).toContainEqual({ call: "own", args: [8, g.p.x, g.p.y] });
    g.setCans([]);
    g.useCharacter(0);
  });

  it("with nothing ahead there is nothing to take", async () => {
    await boot("level=5&foes=0");
    const i = g.level!.rooms.indexOf(g.p.room!);
    g.level!.guns[i].length = 0;
    const health = (g.stats.health = 10);
    g.takeGun();
    expect(g.stats.health).toBe(health);
  });
});

describe.skipIf(!haveRip())("the bolts' think (0x413b95)", () => {
  it("lets go of one more than a thousand across from him, where it stands", async () => {
    await boot("level=13&foes=0");
    const far = { x: g.p.x + 1001, y: g.p.y, vx: 100, facing: 1, spent: false, code: -1 as const, age: 0 };
    const near = { ...far, x: g.p.x + 500 };
    g.setBolts([far, near]);
    g.stepBolts();
    expect(far.spent).toBe(true);
    expect(far.x).toBe(g.p.x + 1001);
    expect(near.spent).toBe(false);
    expect(near.x).toBe(g.p.x + 600);
    g.setBolts([]);
  });
});

describe.skipIf(!haveRip())("the mover's side walls (0x430064, 0x4300db)", () => {
  const room = (flags: number, ground: { x0: number; ys: number[] } | null) =>
    ({ left: 0, right: 1000, top: 0, bottom: 1000, flags, ground }) as unknown as SbkRoom;

  it("puts a point at or past a walled side one pixel inside the floor's extent", async () => {
    await boot("level=1&foes=0");
    const floor = { x0: 100, ys: new Array<number>(500).fill(800) };
    expect(g.insideSides(room(2, floor), 50)).toBe(101);
    expect(g.insideSides(room(8, floor), 700)).toBe(599);
    // an open side lets it be
    expect(g.insideSides(room(8, floor), 50)).toBe(50);
    expect(g.insideSides(room(2, floor), 700)).toBe(700);
    // with no floor the extent is the rect less fifty each end
    expect(g.insideSides(room(10, null), 10)).toBe(51);
    expect(g.insideSides(room(10, null), 990)).toBe(949);
  });
});
