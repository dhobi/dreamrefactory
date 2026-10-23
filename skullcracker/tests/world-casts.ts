/**
 * The gang's skateboards (`src/world/casts.ts`): where one is dropped against
 * the ends of the floor, and what it does to a player who steps off it — the
 * board kicked out from under him, `0x437936`..`0x4379aa`.
 *
 *   npx vitest run skullcracker/tests/world-casts.ts
 *
 * On MALL stood up from the rip, the board put where the address reads it and
 * the step called on its own. `src/props.ts`'s `SKATEBOARD` carries the numbers.
 *
 * Needs the rip; skipped without it.
 */
import { describe, expect, it } from "vitest";
import { FLAME, SKATEBOARD, type Board } from "../src/props";
import { WEREC_SHOT } from "../src/brains/werec";
import { FOES } from "../src/foes";
import { haveRip, headless, type Game, type Headless } from "./machine/harness";

let h: Headless;
let g: Game;

async function boot(query: string): Promise<void> {
  if (!h) h = await headless(query);
  else await h.load(query);
  g = h.game;
  g.setSkates([]);
}

describe.skipIf(!haveRip())("a board dropped (0x438497)", () => {
  it("past the floor's far end goes fifty inside it, and short of its near end fifty past the FAR end", async () => {
    await boot("level=5");
    const e = g.level!.spawned.flat().find((q) => q.kind === "initknotboy")!;
    g.p.room = g.level!.rooms.find((r) => r.ground)!;
    const floor = g.p.room.ground!;
    const end = floor.x0 + floor.ys.length;
    for (const [x, want] of [[end + 300, end - 0x32], [floor.x0 - 300, end + 0x32]]) {
      g.setSkates([]);
      g.dropBoard({ ...e, x });
      expect(g.skates.map((d) => d.x)).toEqual([want]);
    }
    g.setSkates([]);
  });
});

describe.skipIf(!haveRip())("a board he steps off (0x437936)", () => {
  /** a board he was riding, facing east at `vx`, and him off it on the side `dx` */
  function stepOff(vx: number, dx: number): Board {
    const d: Board = { x: g.p.x, y: g.p.y - 10, vx, vy: 0, bornY: g.p.y, down: true, life: 100, facing: 1, stood: true };
    g.setSkates([d]);
    g.p.x += dx;
    g.p.onGround = false;
    return d;
  }

  it("left behind as it goes on ahead, it hops, spends forty of its life and trips him at speed, gun and all (0x43798d, 0x4379a3)", async () => {
    await boot("level=5&foes=0");
    g.inv.weapon = 10;
    g.inv.rounds[10] = 50;
    g.openStream();
    g.p.act = "fire";
    g.inv.drawn = true;
    const d = stepOff(SKATEBOARD.ride.maxSpeed, -300);
    g.stepBoards();
    expect(d.stood).toBe(false);
    expect(d.down).toBe(false);
    expect(d.life).toBe(100 - SKATEBOARD.ride.kickedLife);
    expect(g.p.act).toBe("downFront");
    expect(g.inv.drawn).toBe(false);
    expect(g.streams.every((q) => q.state === "stop")).toBe(true);
    g.killStreams();
  });

  it("stepped off ahead of it, it only slows on the floor", async () => {
    await boot("level=5&foes=0");
    g.p.act = null;
    const d = stepOff(10, 300);
    g.stepBoards();
    expect(d.stood).toBe(false);
    expect(d.down).toBe(true);
    expect(d.life).toBe(99);
    expect(g.p.act).toBeNull();
  });

  it("is taken away once it has fallen out of the world without landing", async () => {
    await boot("level=5&foes=0");
    const d: Board = { x: -50_000, y: 99_000, vx: 0, vy: 0, bornY: 0, down: false, life: 100, facing: 1 };
    g.setSkates([d]);
    g.stepBoards();
    expect(g.skates).toHaveLength(0);
  });
});

describe.skipIf(!haveRip())("werec's shot going off (0x452f38)", () => {
  it("shakes the view by the nearest band that holds him: 3 close, then 2, then 1, then nothing", async () => {
    await boot("level=3&foes=0");
    const bands: (readonly number[])[] = [];
    for (const n of [1, 2, 3] as const) {
      g.shake(n);
      bands[n] = g.shaking;
    }
    // the view is put on a band the shot should NOT choose first, so a change shows
    const at = (dx: number, from: 1 | 3) => {
      g.shake(from);
      const before = g.shaking;
      g.burstCast({ kit: WEREC_SHOT, x: g.p.x + dx, y: g.p.y, vx: 0, vy: 0, facing: 1, clock: 0, bornX: 0, bornY: 0, armed: true, fromX: 0, fromY: 0, spent: false });
      return g.shaking === before ? "none" : bands.indexOf(g.shaking);
    };
    // 0x200 across is the edge of "near"; 0x2ee and 0x4b0 the next two
    expect(at(0x100, 1)).toBe(3);
    expect(at(0x250, 1)).toBe(2);
    expect(at(0x400, 3)).toBe(1);
    expect(at(0x600, 3)).toBe("none");
  });
});

describe.skipIf(!haveRip())("a flame on the player (0x41a019)", () => {
  it("sits mirrored off his point when he faces west, and one lit to last goes round its third stage for ever (0x453f76)", async () => {
    await boot("level=16&foes=0");
    g.p.facing = -1;
    g.p.act = null;
    const f = { on: g.p, dx: 30, dy: -40, stage: 2 as const, clock: 0, forever: true, mirror: false, x: 0, y: 0 };
    g.setFlames([f]);
    g.stepFlames();
    expect(f.x).toBe(g.p.x - 30);
    expect(f.y).toBe(g.p.y - g.p.feet - 40);
    for (let i = 0; i < FLAME.fade.cels.length * FLAME.fade.hold + 2; i++) g.stepFlames();
    expect(g.flames).toHaveLength(1);
    expect(f.stage).toBe(2);
    g.setFlames([]);
    g.p.facing = 1;
  });
});

describe.skipIf(!haveRip())("a class's own walk carrying a stride", () => {
  it("is what lets it travel: LAB's arm has none, the punk has one", async () => {
    await boot("level=15&foes=0");
    expect(g.travels(FOES.initarm)).toBe(false);
    expect(g.travels(FOES.initwerea)).toBe(true);
  });
});
