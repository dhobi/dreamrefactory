/**
 * What a class's machine is handed (`src/world/enemies.ts`): the floor-edge
 * walk `0x40bcd0`, the gang's crowding count `0x44f020`, and the calls of
 * `BRAIN_CTX` that reach into the level — the sprinkler, the bats' mass death,
 * the drain on the player's health.
 *
 *   npx vitest run skullcracker/tests/world-enemies.ts
 *
 * `tests/brains.ts` drives the brains against a stand-in context; this is the
 * real one, on a level stood up from the rip, each call asked on its own and
 * held to the address it was read from.
 *
 * Needs the rip; skipped without it (the floor-edge walk does not, and runs).
 */
import { describe, expect, it } from "vitest";
import type { SbkRoom } from "@dreamfactory/engine/df/sbk";
import { FOES } from "../src/foes";
import { haveRip, headless, recordSound, type Game, type Headless } from "./machine/harness";

let h: Headless;
let g: Game;

async function boot(query: string): Promise<void> {
  if (!h) h = await headless(query);
  else await h.load(query);
  g = h.game;
}

/** a room of the given extent and floor: `ys[i]` is the floor's y at `x0 + i` */
const room = (left: number, right: number, ground: { x0: number; ys: number[] } | null) =>
  ({ left, right, top: 0, bottom: 1000, ground }) as unknown as SbkRoom;

describe.skipIf(!haveRip())("the floor's edge, 0x40bcd0", () => {
  it("answers 0x7d00 ahead and 0 behind with no region at all", async () => {
    await boot("level=1");
    g.p.room = null;
    expect(g.floorEdge(500, 1, 20)).toBe(0x7d00);
    expect(g.floorEdge(500, -1, 20)).toBe(0);
  });

  it("is the rect fifty in from each end in a region with no floor, and the point itself past an end (0x40bd2e)", () => {
    g.p.room = room(0, 1000, null);
    expect(g.floorEdge(500, 1, 20)).toBe(950);
    expect(g.floorEdge(500, -1, 20)).toBe(50);
    // past the east end: the point ahead, nothing behind
    expect(g.floorEdge(960, 1, 20)).toBe(960);
    expect(g.floorEdge(960, -1, 20)).toBe(0);
    // ...and past the west end the other way round
    expect(g.floorEdge(40, 1, 20)).toBe(0x7d00);
    expect(g.floorEdge(40, -1, 20)).toBe(40);
  });

  it("walks the floor eight pixels a sample and stops at the first step taller than the reach", () => {
    // flat for 100, a 30-pixel step, flat again
    const ys = Array.from({ length: 400 }, (_, i) => (i < 100 ? 500 : 470));
    g.p.room = room(0, 1000, { x0: 100, ys });
    // from x 120 (index 20) east: samples 28, 36, ... 100 is the first past the step
    expect(g.floorEdge(120, 1, 20)).toBe(100 + 100);
    // ...a step under the reach is walked over, out to the 200-pixel limit
    expect(g.floorEdge(120, 1, 40)).toBe(100 + 220);
    // and west to the floor's own start, which ends the walk short of 200
    expect(g.floorEdge(150, -1, 20)).toBe(100);
    // off the floor's ends: the point on the side that has run out
    expect(g.floorEdge(50, 1, 20)).toBe(0x7d00);
    expect(g.floorEdge(50, -1, 20)).toBe(50);
    expect(g.floorEdge(600, 1, 20)).toBe(600);
    expect(g.floorEdge(600, -1, 20)).toBe(0);
  });
});

describe.skipIf(!haveRip())("the gang's crowding, 0x44f020", () => {
  it("counts the far side up and the near side down within two hundred, and flips one whose side is three ahead", async () => {
    await boot("level=1");
    g.p.room = g.level!.rooms[0];
    const pool = g.level!.spawned[0];
    const punks = pool.filter((q) => q.kind === "initwerea").slice(0, 5);
    expect(punks).toHaveLength(5);
    pool.splice(0, pool.length, ...punks);
    for (const q of punks) {
      q.x = g.p.x + 50;
      q.side = 0;
    }
    // five on the near side: -5, under -3
    expect(g.crowded(punks[0])).toBe(true);
    // one that wants the far side is not crowded by them
    punks[0].side = 1;
    expect(g.crowded(punks[0])).toBe(false);
    // four on the far side and one near: +3, not more than three
    for (const q of punks.slice(1, 4)) q.side = 1;
    expect(g.crowded(punks[0])).toBe(false);
    punks[4].side = 1;
    expect(g.crowded(punks[0])).toBe(true);
    // and one out past two hundred is not counted: +4, then +3
    punks[4].x = g.p.x + 500;
    expect(g.crowded(punks[0])).toBe(true);
    punks[3].x = g.p.x - 500;
    expect(g.crowded(punks[0])).toBe(false);
  });
});

describe.skipIf(!haveRip())("BRAIN_CTX, the context the machines are handed", () => {
  it("drains health only with the damage switch on (0x441cb0)", async () => {
    await boot("level=8");
    const health = g.stats.health;
    g.BRAIN_CTX.drain(10);
    expect(g.stats.health).toBe(health);
    g.setDamageOn(true);
    g.BRAIN_CTX.drain(10);
    expect(g.stats.health).toBe(health - 10);
    g.setDamageOn(false);
  });

  it("finds ARCADE's sprinkler nearest in Manhattan distance, and none where there are none (0x40b756)", async () => {
    await boot("level=8");
    g.p.room = g.level!.rooms[0];
    const boss = g.level!.spawned[0].find((q) => q.kind === "initkragg")!;
    const all = g.level!.sprinklers[0];
    const want = all.reduce((a, b) => (Math.abs(b.y - boss.y) + Math.abs(b.x - boss.x) < Math.abs(a.y - boss.y) + Math.abs(a.x - boss.x) ? b : a));
    expect(g.BRAIN_CTX.sprinkler!(boss)).toEqual({ x: want.x, y: want.y });
    await boot("level=1");
    g.p.room = g.level!.rooms[0];
    expect(g.BRAIN_CTX.sprinkler!(g.level!.spawned[0][0])).toBeNull();
  });

  it("takes every living bat on the level at once: thrown up, its award, belfry's record 1 (0x4263e0)", async () => {
    await boot("level=10");
    const bats = g.level!.spawned.flat().filter((q) => q.kind === "initbat");
    expect(bats.length).toBeGreaterThan(1);
    const heard = recordSound(g);
    const score = g.stats.score;
    g.BRAIN_CTX.slayAll!("initbat");
    expect(bats.every((q) => q.state === "dead" && q.threw && q.vy < 0)).toBe(true);
    expect(g.stats.score).toBeGreaterThan(score);
    expect(heard.filter((c) => c.call === "effect" && c.args[0] === 1)).toHaveLength(bats.length);
    // ...and the dead are not taken twice
    const after = g.stats.score;
    g.BRAIN_CTX.slayAll!("initbat");
    expect(g.stats.score).toBe(after);
  });

  it("counts and lists the living of a class, and removes one for its award", async () => {
    await boot("level=1");
    g.p.room = g.level!.rooms[0];
    const pool = g.level!.spawned[0];
    const punks = pool.filter((q) => q.kind === "initwerea");
    expect(g.BRAIN_CTX.count!("initwerea")).toBe(punks.length);
    expect(g.BRAIN_CTX.every!("initwerea").length).toBeGreaterThanOrEqual(punks.length);
    const score = g.stats.score;
    g.BRAIN_CTX.remove!(punks[0], 25);
    expect(g.stats.score).toBe(score + 25);
    expect(pool.includes(punks[0])).toBe(false);
    // removing one already gone changes the pool no further
    const n = pool.length;
    g.BRAIN_CTX.remove!(punks[0], 0);
    expect(pool).toHaveLength(n);
  });
});

describe.skipIf(!haveRip())("a reaction ending (stepEnemies)", () => {
  /** the first of a class, alone in its room with the player */
  function alone(kind: string) {
    const i = g.level!.spawned.findIndex((r) => r.some((e) => e.kind === kind));
    g.p.room = g.level!.rooms[i];
    const pool = g.level!.spawned[i];
    const e = pool.find((q) => q.kind === kind)!;
    pool.splice(0, pool.length, e);
    return { e, pool };
  }

  it("the hydrant's last stage ending lets the water out 25 to its facing side, with its sound, and stands it whole (0x44fb20, 0x44fb94)", async () => {
    await boot("level=1&foehit=1");
    const { e, pool } = alone("inithydrant");
    const foe = FOES.inithydrant;
    e.facing = -1;
    e.state = "flinch";
    e.anim = foe.flinch!.at(-1)!;
    e.dents = foe.flinch!.length;
    e.clock = 1_000;
    const heard = recordSound(g);
    g.stepEnemies();
    const water = pool.find((q) => q.state === "burst")!;
    expect(water.x).toBe(e.x - foe.burst!.dx);
    expect(e.dents).toBe(0);
    expect(e.state).toBe("gait");
    expect(heard.filter((c) => c.call === "effect").map((c) => c.args[0])).toContain(foe.burst!.sound);
  });

  it("werec's fatal burn ends in its death, lying the burn's own 200 frames (0x452731)", async () => {
    await boot("level=3&foehit=1");
    const { e } = alone("initwerec");
    const burns = FOES.initwerec.burns!;
    e.state = "flinch";
    e.anim = burns.anim!;
    e.clock = 1_000;
    g.stepEnemies();
    expect(e.state).toBe("dead");
    expect(e.linger).toBeLessThanOrEqual(burns.linger!);
    expect(e.linger).toBeGreaterThan(burns.linger! - 2);
  });

  it("ARCADE's boss comes out of a flinch back into its combat loop, hovering (0x456058)", async () => {
    await boot("level=8&foehit=1");
    const { e } = alone("initkragg");
    const foe = FOES.initkragg;
    e.state = "flinch";
    e.mode = "charge";
    e.anim = foe.flinch![0];
    e.clock = 1_000;
    g.stepEnemies();
    expect(e.state).toBe("gait");
    expect(e.mode).toBe("hover");
  });
});
