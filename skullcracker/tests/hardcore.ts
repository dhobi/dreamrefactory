/**
 * `inithardcore` — its think `0x43cc60` state by state against a stand-in
 * context.
 *
 *   npx vitest run skullcracker/tests/hardcore.ts
 *
 * The machine suites fight it on its level, where the dice — a roll against
 * its own health every frame among them — decide which branches run. The
 * roar after three throws, the walk stopping at its rect's edge, the low
 * throw, the swipe's grunt, the breather's two sounds and the flinch's coin
 * are taken here on purpose, each against the address in
 * `src/brains/hardcore.ts` it was read from.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { BrainCtx, CastKit, Enemy } from "../src/brains/kit";
import { hardcore, HARDCORE, HARDCORE_THROW, HARDCORE_THROW_LOW } from "../src/brains/hardcore";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.inithardcore;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("inithardcore", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => hardcore(e, F, run, k);
/** `0x43cda8`'s roll against its health: anything at or past four keeps it fighting */
const FIGHT = 100;

describe("the statue, the roar and the walk (0x43ccda, 0x43ceca, 0x43ceea)", () => {
  it("holds the statue until the player is in its rect", () => {
    const e = at(HARDCORE.wake, { fighting: false });
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(HARDCORE.wake));
    e.fighting = true;
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(HARDCORE.stance));
  });

  it("walks when the roar ends", () => {
    const e = at(HARDCORE.roar, { clock: 1 });
    think(e, ctx({}).k, 10);
    expect(on(e)).toEqual(is(HARDCORE.roar));
    e.clock = 10;
    think(e, ctx({}).k, 10);
    expect(on(e)).toEqual(is(HARDCORE.close));
  });

  it("stops the walk at its rect's own edge, east or west (0x43ceee)", () => {
    const east = at(HARDCORE.close, { x: 500, right: 500, facing: 1 });
    think(east, ctx({}).k);
    expect(on(east)).toEqual(is(HARDCORE.stance));
    const west = at(HARDCORE.close, { x: -500, left: -500, facing: -1 });
    think(west, ctx({}).k);
    expect(on(west)).toEqual(is(HARDCORE.stance));
  });

  it("treads on frame 2 of the four and stands as the walk ends (0x43cf1c)", () => {
    const hold = HARDCORE.close.hold;
    const heard: string[] = [];
    const e = at(HARDCORE.close, { facing: -1 });
    for (let clock = 0; clock < 4 * hold; clock++) {
      e.clock = clock;
      const s = ctx({});
      think(e, s.k, 8);
      heard.push(...s.heard);
    }
    expect(heard).toEqual(Array(hold).fill("say 0x48"));
    expect(on(e)).toEqual(is(HARDCORE.close));
    e.clock = 8;
    think(e, ctx({}).k, 8);
    expect(on(e)).toEqual(is(HARDCORE.stance));
  });
});

describe("the throw, state 4 (0x43cf56)", () => {
  it("throws the low one off tag 1 and counts it (0x43cf97, 0x43d1de)", () => {
    const thrown: CastKit[] = [];
    const s = ctx({ band: 1 });
    s.k.cast = (_e, kit) => void thrown.push(kit);
    const e = at(HARDCORE.hurl[1], { clock: 5, decisions: 1 });
    think(e, s.k, 5);
    const hi = at(HARDCORE.hurl[0], { clock: 5, decisions: 0 });
    think(hi, s.k, 5);
    expect(thrown).toEqual([HARDCORE_THROW_LOW, HARDCORE_THROW]);
    expect([e.decisions, ...on(e)]).toEqual([2, ...is(HARDCORE.stance)]);
  });
});

describe("the swipe, the breather and the flinch's exit", () => {
  it("grunts two times in ten as the swipe ends, and not before (0x43cfcd)", () => {
    const early = ctx({});
    const e = at(HARDCORE.swipe, { clock: 2 });
    think(e, early.k, 8);
    expect(early.heard).toEqual([]);
    const grunt = ctx({}, [2]);
    e.clock = 8;
    think(e, grunt.k, 8);
    expect(grunt.heard).toEqual(["roll 10=2", "say 0x43"]);
    expect(on(e)).toEqual(is(HARDCORE.stance));
    const quiet = ctx({}, [3]);
    const f = at(HARDCORE.swipe, { clock: 8 });
    think(f, quiet.k, 8);
    expect(quiet.heard).toEqual(["roll 10=3"]);
  });

  it("pants on even frames and sighs on the lead channel as the breather ends (0x43cffe, 0x43d045)", () => {
    const hold = HARDCORE.pant.hold;
    const even = ctx({});
    think(at(HARDCORE.pant, { clock: 2 * hold }), even.k, 30);
    expect(even.heard).toEqual(["say 0x44"]);
    const odd = ctx({});
    think(at(HARDCORE.pant, { clock: hold }), odd.k, 30);
    expect(odd.heard).toEqual([]);
    const end = ctx({}, [2]);
    const e = at(HARDCORE.pant, { clock: 30 });
    think(e, end.k, 30);
    expect(end.heard).toEqual(["roll 2=2", "say 0x40 lead"]);
    expect(on(e)).toEqual(is(HARDCORE.stance));
  });

  it("after the flinch walks with 0x48 on heads and swipes with 0x47 on tails (0x43d06d)", () => {
    const flinchEnd = { ...HARDCORE.stance, kind: 8 };
    const heads = ctx({}, [1]);
    const e = at(flinchEnd);
    think(e, heads.k);
    expect(heads.heard).toEqual(["roll 2=1", "say 0x48"]);
    expect(on(e)).toEqual(is(HARDCORE.close));
    const tails = ctx({}, [2]);
    const f = at(flinchEnd);
    think(f, tails.k);
    expect(tails.heard).toEqual(["roll 2=2", "say 0x47"]);
    expect([...on(f), f.swing]).toEqual([...is(HARDCORE.swipe), true]);
  });

  it("does nothing in state 5, which has no script, nor in one past the table", () => {
    for (const script of [5, 9]) {
      const e = at(HARDCORE.stance, { script });
      expect(think(e, ctx({}).k)).toBe(false);
      expect(e.script).toBe(script);
    }
  });
});

describe("the stance, state 1 (0x43cd0d)", () => {
  it("breathes and pants over a downed player, facing him (0x43cd3a)", () => {
    for (const [px, facing] of [[-50, 1], [50, -1]] as const) {
      const { k, heard } = ctx({}, [], { down: true, x: px });
      const e = at(HARDCORE.stance, { facing: -facing });
      think(e, k);
      expect(heard).toEqual(["say 0x44"]);
      expect([e.facing, ...on(e)]).toEqual([facing, ...is(HARDCORE.pant)]);
    }
  });

  it("roars after its third throw unless he is on top of it, and zeroes the count (0x43cd6b)", () => {
    const { k, heard } = ctx({ band: 1, forward: -1 });
    const e = at(HARDCORE.stance, { decisions: 3 });
    think(e, k);
    expect(heard).toEqual(["say 0x46"]);
    expect([e.facing, e.decisions, ...on(e)]).toEqual([-1, 0, ...is(HARDCORE.roar)]);
    // inside 160 the count is ignored and the roll goes on
    const close = ctx({ band: 4 }, [FIGHT, 1]);
    const c = at(HARDCORE.stance, { decisions: 3 });
    think(c, close.k);
    expect(c.decisions).toBe(3);
    expect(on(c)).toEqual(is(HARDCORE.close));
  });

  it("pants on a roll under four against twice its health (0x43cda8)", () => {
    const { k, heard } = ctx({ band: 0 }, [3]);
    const e = at(HARDCORE.stance, { hp: 50 });
    think(e, k);
    expect(heard).toEqual(["roll 100=3", "say 0x44"]);
    expect(on(e)).toEqual(is(HARDCORE.pant));
  });

  it("at 160…220 walks in, swipes or shouts and throws on one roll of three (0x43ce4a, 0x43ce53, 0x43ce6f)", () => {
    const walk = at(HARDCORE.stance);
    think(walk, ctx({ band: 3 }, [FIGHT, 1]).k);
    expect(on(walk)).toEqual(is(HARDCORE.close));
    const swipe = ctx({ band: 3 }, [FIGHT, 2]);
    const s = at(HARDCORE.stance);
    think(s, swipe.k);
    expect(swipe.heard.at(-1)).toBe("say 0x47");
    expect(on(s)).toEqual(is(HARDCORE.swipe));
    const shout = ctx({ band: 4 }, [FIGHT, 3, 1, 2]);
    const h = at(HARDCORE.stance);
    think(h, shout.k);
    expect(shout.heard.slice(2)).toEqual(["roll 2=1", "say 0x41", "roll 2=2"]);
    expect(on(h)).toEqual(is(HARDCORE.hurl[1]));
  });

  it("does nothing behind it but re-take the stance as it ends, the unsigned ja at 0x43cde3", () => {
    const e = at(HARDCORE.stance, { clock: 1, swing: true });
    think(e, ctx({ band: -1 }, [FIGHT]).k, 4);
    expect(e.swing).toBe(true);
    e.clock = 4;
    think(e, ctx({ band: -1 }, [FIGHT]).k, 4);
    expect([e.swing, ...on(e)]).toEqual([false, ...is(HARDCORE.stance)]);
  });
});
