/**
 * A blow landing on a creature (`src/world/foehit.ts`'s `strikeFoe`, the hit
 * handlers): the Coke machine's two counters, PLAYGR's boss going over on every
 * fourth, a hydrant already beaten in, and a burn on a class that has no
 * answer to one.
 *
 *   npx vitest run skullcracker/tests/world-foehit.ts
 *
 * The blow is handed straight to the handler, as `0x430350`'s dispatcher does
 * once the boxes meet, on a creature of a level stood up from the rip.
 *
 * Needs the rip; skipped without it.
 */
import { describe, expect, it } from "vitest";
import type { Enemy } from "../src/brains/kit";
import { FOES } from "../src/foes";
import { haveRip, headless, recordSound, type Game, type Headless } from "./machine/harness";

let h: Headless;
let g: Game;

async function boot(query: string): Promise<void> {
  if (!h) h = await headless(query);
  else await h.load(query);
  g = h.game;
}

/** the first of a class on the level, with the player put in its room */
function first(kind: string): Enemy {
  const i = g.level!.spawned.findIndex((r) => r.some((e) => e.kind === kind));
  g.p.room = g.level!.rooms[i];
  return g.level!.spawned[i].find((e) => e.kind === kind)!;
}

/** a blow of `damage` from the west, at the creature's own middle */
function blow(e: Enemy, damage: number, code = 0): void {
  const box = { left: e.x - 20, right: e.x + 20, top: e.y - 100, bottom: e.y };
  g.strikeFoe(e, { damage, shove: { dx: 10, dy: 0 }, from: 1, mid: e.y - 50, box, code });
}

describe.skipIf(!haveRip())("the Coke machine's cans (0x43b6ab)", () => {
  it("a blow of seventy-five or more throws every can left at once, and then there are none (0x43b755)", async () => {
    await boot("level=5&foehit=1");
    const coke = first("initcoke");
    g.setCans([]);
    blow(coke, 80);
    const holds = FOES.initcoke.shakes!.holds;
    expect(g.cans).toHaveLength(holds);
    expect(coke.shaken).toBe(holds);
    blow(coke, 80);
    expect(g.cans).toHaveLength(holds);
    g.setCans([]);
  });

  it("a middle blow lets one go on the third it counts, and a light one only counts (0x43b6f5)", async () => {
    await boot("level=5&foehit=1");
    const coke = first("initcoke");
    g.setCans([]);
    // each blow rocks it, and a machine rocking takes nothing (0x43b655): it is
    // stood still again between them, as the rock's end does
    const still = () => Object.assign(coke, { state: "gait", anim: FOES.initcoke.gait });
    blow(coke, 10);
    still();
    blow(coke, 40);
    still();
    expect(g.cans).toHaveLength(0);
    blow(coke, 40);
    expect(g.cans).toHaveLength(1);
    expect(coke.beat).toBe(0);
    g.setCans([]);
  });
});

describe.skipIf(!haveRip())("PLAYGR's boss (0x456496)", () => {
  it("goes over on the third blow it counts in state 5, with its own sound, rather than taking it", async () => {
    await boot("level=4&foehit=1");
    const boss = first("initwbooly");
    const over = FOES.initwbooly.knockdown!;
    boss.hp = 10_000;
    // in state 5, two blows already counted (`AI+0x12`, read back out of dents)
    boss.state = "gait";
    boss.script = 5;
    boss.dents = 3;
    const heard = recordSound(g);
    blow(boss, 5);
    expect(boss.anim).toBe(over.anim);
    expect(heard).toContainEqual({ call: "effect", args: [over.sound, boss.x, boss.y] });
  });
});

describe.skipIf(!haveRip())("the hydrant, beaten in (0x44fb43)", () => {
  it("takes a blow past its last stage and shows nothing more", async () => {
    await boot("level=1&foehit=1");
    const e = first("inithydrant");
    e.dents = FOES.inithydrant.flinch!.length;
    const anim = e.anim;
    blow(e, 30);
    expect(e.anim).toBe(anim);
  });
});

describe.skipIf(!haveRip())("a burn (-9) on a class with no answer to it", () => {
  it("does nothing at all: no health, no reaction", async () => {
    await boot("level=9&foehit=1");
    const e = first("initzomb");
    expect(FOES.initzomb.burns).toBeUndefined();
    const { hp, anim, dents } = e;
    blow(e, 0, -9);
    expect([e.hp, e.anim, e.dents]).toEqual([hp, anim, dents]);
  });
});
