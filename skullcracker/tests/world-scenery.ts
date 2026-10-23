/**
 * The scenery that moves by itself (`src/world/scenery.ts`): a girder's
 * passes, a barrel going under mirrored, the roaches ARCADE's boss spills, and
 * SERVICE's goop that feeds only the living.
 *
 *   npx vitest run skullcracker/tests/world-scenery.ts
 *
 * Each step called on its own on a level stood up from the rip, the thing put
 * in the state the address reads, and held to what the address does.
 *
 * Needs the rip; skipped without it.
 */
import { describe, expect, it } from "vitest";
import { BARREL, IBEAM, ROACH, type Barrel } from "../src/props";
import { haveRip, headless, recordSound, type Game, type Headless } from "./machine/harness";

let h: Headless;
let g: Game;

async function boot(query: string): Promise<void> {
  if (!h) h = await headless(query);
  else await h.load(query);
  g = h.game;
}

describe.skipIf(!haveRip())("CITY's girders (0x4537d0)", () => {
  it("flip their side going out and across, say 6 coming back, and do not flip then (0x453894)", async () => {
    await boot("level=2");
    const b = g.level!.ibeams[g.level!.rooms.indexOf(g.p.room!)][0];
    const heard = recordSound(g);
    const end = (state: typeof b.state, side: typeof b.side) => {
      b.state = state;
      b.side = side;
      b.delay = 0;
      b.clock = 1_000;
      g.stepIbeams();
    };
    end("out", 1);
    expect([b.state, b.side]).toEqual(["across", 0]);
    end("across", 0);
    expect([b.state, b.side]).toEqual(["back", 1]);
    end("back", 1);
    expect([b.state, b.side]).toEqual(["out", 1]);
    expect(heard.map((c) => c.args[0])).toEqual([IBEAM.sound, IBEAM.soundBack]);
  });
});

describe.skipIf(!haveRip())("SEWER's barrels (0x43fd99)", () => {
  it("one mirrored goes under down and to the WEST", async () => {
    await boot("level=7");
    const b: Barrel = {
      x: 0, y: 100, homeX: 0, homeY: 100, top: 0, left: -50, bottom: 200, right: 50,
      clock: 0, aclock: 0, wait: 0, sinker: true, tag: "sink", vx: 0, vy: 0, mirror: true, bounced: false,
    };
    g.p.x = 5_000;
    g.barrelFrame(b, 0);
    expect(b.x).toBe(-BARREL.sinkStep);
    expect(b.y).toBe(100 + BARREL.sinkStep);
  });
});

describe.skipIf(!haveRip())("ARCADE's roaches (0x441519)", () => {
  it("spilled ones land and start running without the run's sound, their own speed spent (0x43b35c)", async () => {
    await boot("level=8&foes=0");
    g.setRoaches([]);
    g.spillRoaches({ x: g.p.x, y: g.p.y - 50 }, 3);
    expect(g.roaches).toHaveLength(3);
    const heard = recordSound(g);
    for (let f = 0; f < 60 && !g.roaches.every((r) => r.running); f++) g.stepScenery();
    expect(g.roaches.every((r) => r.running && r.spilled?.vx === 0)).toBe(true);
    expect(heard.filter((c) => c.call === "effect" && c.args[0] === ROACH.runSound)).toHaveLength(0);
    g.setRoaches([]);
  });
});

describe.skipIf(!haveRip())("SERVICE's goop (0x43c3d0's nests)", () => {
  it("feeds a gang member it falls on, but not one whose health is gone", async () => {
    await boot("level=6&foehit=1");
    const i = g.level!.spawned.findIndex((r) => r.some((e) => e.kind === "initbatboy"));
    g.p.room = g.level!.rooms[i];
    const pool = g.level!.spawned[i];
    const e = pool.find((q) => q.kind === "initbatboy")!;
    pool.splice(0, pool.length, e);
    e.state = "gait";
    e.swing = false;
    const box = g.hurtBox(e, g.celRec(g.level!.sbk, g.celOf(e))!, g.level!);
    // the first link of any string whose cel carries a strike box, laid on the body
    const kinds = ["drop", "gob", "splash", "strand", "bead"] as const;
    const live = kinds
      .flatMap((kind) => Array.from({ length: 40 }, (_, clock) => ({ kind, clock, x: 0, y: 0, vx: 0, vy: 5 })))
      .find((d) => g.dripStrike(d)?.strike);
    const strike = g.dripStrike(live!)!.strike!;
    live!.x = Math.round((box.left + box.right) / 2 - (strike.x0 + strike.x1) / 2);
    live!.y = Math.round((box.top + box.bottom) / 2 - (strike.y0 + strike.y1) / 2);
    expect(live).toBeDefined();
    e.hp = 0;
    g.setDrips([{ ...live! }]);
    g.feedTheGang();
    expect(e.hp).toBe(0);
    e.hp = 10;
    g.setDrips([{ ...live! }]);
    g.feedTheGang();
    expect(e.hp).toBeGreaterThan(10);
    g.setDrips([]);
  });
});
