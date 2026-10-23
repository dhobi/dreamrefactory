/**
 * MAZE's fans and BARREL's chairs and claws (`src/world/machines.ts`), a frame
 * at a time on a level stood up from the rip, with the player put where each
 * state's test reads him.
 *
 *   npx vitest run skullcracker/tests/world-machines.ts
 *
 * The fan is `0x4153a0` (the horizontal kind) and `0x415960` (the vertical),
 * the chair `0x4179f0`, the claw `0x4171e0`; `src/props.ts` carries every
 * number with its address. The playthroughs ride past them; here each arm is
 * taken on purpose.
 *
 * Needs the rip; skipped without it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CHAIR, CLAW, FAN, type Claw, type Fan } from "../src/props";
import { haveRip, headless, recordSound, type Game, type Headless } from "./machine/harness";

let h: Headless;
let g: Game;

async function boot(query: string): Promise<void> {
  if (!h) h = await headless(query);
  else await h.load(query);
  g = h.game;
}

describe.skipIf(!haveRip())("MAZE's fans (0x4153a0, 0x415960)", () => {
  beforeEach(() => boot("level=13"));

  /** the first fan of a kind, running in `state`, with the player's point `dx` across and `dy` below its own */
  function fan(horizontal: boolean, state: Fan["state"], dx: number, dy = 0): Fan {
    const f = g.level!.fans.flat().find((q) => q.horizontal === horizontal)!;
    f.state = state;
    f.red = false;
    f.count = 10;
    f.clock = 0;
    g.p.act = null;
    g.p.x = f.x + dx;
    g.p.y = f.y + dy + g.p.feet;
    g.p.vx = 0;
    g.p.vyRaw = 0;
    // its own rect, wide enough to hold him
    Object.assign(f, { left: f.x - 1000, right: f.x + 1000, top: f.y - 1000, bottom: f.y + 1000 });
    return f;
  }

  it("a horizontal fan sucking turns him to face it and holds his fall from 140 to 270 (0x415554)", () => {
    const f = fan(true, "suck", 200);
    g.p.vyRaw = 12;
    g.p.facing = 1;
    g.stepFans();
    expect(g.p.vyRaw).toBe(0);
    expect(g.p.facing).toBe(-1);
    expect(g.p.vx).toBeLessThan(0);
    expect(f.red).toBe(false);
  });

  it("...and inside 140 it kills, with 0x16, and the blades run red until they stop (0x4154ae, 0x4156e2)", () => {
    const f = fan(true, "suck", -50);
    const heard = recordSound(g);
    g.stepFans();
    expect(f.red).toBe(true);
    expect(g.p.act).toBe("dying");
    expect(heard).toContainEqual({ call: "effect", args: [FAN.kill, f.x, f.y] });
    expect(g.fanCel(f)).toBe(FAN.h.red.cels[0]);
    for (let i = 0; i < FAN.h.red.cels.length * FAN.h.red.hold; i++) g.stepFans();
    expect(f.red).toBe(false);
    expect(f.state).toBe("stop");
  });

  it("a vertical fan sucks him up, and kills within a hundred of it (0x415a2c, 0x415a6e)", () => {
    fan(false, "suck", 0, 300);
    g.stepFans();
    expect(g.p.vyRaw).toBeLessThan(0);
    const f = fan(false, "suck", 0, 50);
    g.stepFans();
    expect(f.red).toBe(true);
    expect(g.fanCel(f)).toBe(FAN.v.red.cels[0]);
    for (let i = 0; i < FAN.v.red.cels.length * FAN.v.red.hold; i++) g.stepFans();
    expect(f.state).toBe("stop");
  });

  it("blowing, each pushes him away: the horizontal one along, the vertical one down (0x415650, 0x415bf0)", () => {
    fan(true, "blow", 100);
    g.stepFans();
    expect(g.p.vx).toBeGreaterThan(0);
    fan(true, "blow", -100);
    g.stepFans();
    expect(g.p.vx).toBeLessThan(0);
    fan(false, "blow", 0, 300);
    g.stepFans();
    expect(g.p.vyRaw).toBeGreaterThan(0);
  });
});

describe.skipIf(!haveRip())("BARREL's chairs and claws", () => {
  beforeEach(() => boot("level=14"));

  /** a room's chair or claw, and the player put in that room */
  function inRoomOf<T>(pick: (l: NonNullable<Game["level"]>) => T[][]): T {
    const i = pick(g.level!).findIndex((r) => r.length);
    g.p.room = g.level!.rooms[i];
    return pick(g.level!)[i][0];
  }

  it("a chair's third tag sends it to the fourth, which nothing handles, when he comes within 150 (0x417a50, 0x417a08)", () => {
    const c = inRoomOf((l) => l.chairs);
    c.run = 2;
    c.clock = 0;
    g.p.x = c.x + CHAIR.nearPx - 1;
    g.stepChairs();
    expect(c.run).toBe(CHAIR.runs.length);
    expect(g.chairCel(c)).toBe(CHAIR.rest);
    const clock = c.clock;
    g.stepChairs();
    expect(c.clock).toBe(clock);
  });

  /** a claw in `state` at the end of its script */
  function ended(state: Claw["state"]): Claw {
    const c = inRoomOf((l) => l.claws);
    c.state = state;
    c.caught = false;
    const a = { down: CLAW.down, shut: CLAW.shut, up: CLAW.up, dive: CLAW.dive, clamp: CLAW.jaws, lift: CLAW.lift }[state as "down"];
    c.clock = a.cels.length * a.hold - 1;
    return c;
  }

  it("reaches down, shuts with 0x14, comes up and runs again (0x46dd80 tags 1, 2, 4)", () => {
    const heard = recordSound(g);
    const c = ended("down");
    g.stepClaws();
    expect(c.state).toBe("shut");
    expect(heard).toContainEqual({ call: "effect", args: [CLAW.clamp, c.x, c.y] });
    c.clock = CLAW.shut.cels.length * CLAW.shut.hold - 1;
    g.stepClaws();
    expect(c.state).toBe("up");
    c.clock = CLAW.up.cels.length * CLAW.up.hold - 1;
    g.stepClaws();
    expect(c.state).toBe("running");
  });

  it("a dive that caught him clamps, the clamp lifts, and a lift runs on (0x417448, 0x417496)", () => {
    const c = ended("dive");
    c.caught = true;
    g.stepClaws();
    expect(c.state).toBe("clamp");
    expect(c.caught).toBe(false);
    c.clock = CLAW.jaws.cels.length * CLAW.jaws.hold - 1;
    g.stepClaws();
    expect(c.state).toBe("lift");
    c.clock = CLAW.lift.cels.length * CLAW.lift.hold - 1;
    g.stepClaws();
    expect(c.state).toBe("running");
  });

  it("over him on its rail, between the dive's band and 300, it reaches down (0x417289)", () => {
    const c = inRoomOf((l) => l.claws);
    c.state = "running";
    c.clock = 0;
    // stood still where the rail ends, out of the dive's band and inside 300
    g.p.x = c.right + CLAW.reachBand + 20;
    c.x = c.right;
    g.stepClaws();
    expect(c.state).toBe("down");
    expect(g.clawCel(c)).toBe(CLAW.down.cels[0]);
  });
});
