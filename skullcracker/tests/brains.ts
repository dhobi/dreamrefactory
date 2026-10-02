/**
 * Class think functions on their own, against a stand-in `BrainCtx`:
 * the states the playthroughs do not happen to reach.
 *
 *   npx vitest run skullcracker/tests/brains.ts
 *
 * A brain is a jump table over `obj+0x18` out of `SC.EXE`, and every branch in
 * `src/brains/` carries the address it was read from. The machine suites play
 * them inside a level, where the dice and the player decide which branch runs;
 * a branch they never roll stays unchecked. Here the dice are the test's and
 * the player is a record, so each branch is taken on purpose and the test
 * asserts what the address says it does: which script goes on, which sound is
 * said, what is thrown. Timing is the brain's own (`run` is the script's length
 * in ticks), so nothing here needs a clock.
 *
 * No rip: the brains read nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { BrainCtx, Enemy, Track } from "../src/brains/kit";
import { batboy, BATBOY } from "../src/brains/batboy";
import { maskboy, MASKBOY } from "../src/brains/maskboy";
import { ox, OX, oxReacts } from "../src/brains/ox";
import { tube, TUBE, TUBE_BREATH, TUBE_SHARDS } from "../src/brains/tube";
import { FOES } from "../src/foes";

/** a context whose dice are a queue, and which writes down what it is asked */
function ctx(track: Partial<Track>, rolls: number[] = [], player: Partial<BrainCtx["player"]> = {}) {
  const heard: string[] = [];
  const k = {
    player: { x: 0, y: 0, top: 0, anchor: 0, vy: 0, swinging: false, down: false, facing: -1, climbing: false,
      crouching: false, character: 0, jolted: false, helpless: false, free: true, ...player },
    track: () => ({ forward: 200, dy: 0, band: 0, side: 1, ...track }),
    roll: (n: number) => {
      const r = rolls.shift();
      if (r === undefined) throw new Error(`an unplanned roll of ${n}`);
      if (r < 1 || r > n) throw new Error(`a roll of ${n} cannot come up ${r}`);
      heard.push(`roll ${n}=${r}`);
      return r;
    },
    say: (_e: Enemy, id: number) => heard.push(`say 0x${id.toString(16)}`),
    shake: (n: number) => heard.push(`shake ${n}`),
    atBound: () => false,
    anchorX: (e: Enemy) => e.x,
    roller: (_e: Enemy, at: { x: number; y: number; vx: number }) => heard.push(`roller ${at.x},${at.y} vx ${at.vx}`),
    cast: (_e: Enemy, kit: unknown) =>
      heard.push(kit === TUBE_BREATH ? "cast breath" : `cast shard ${TUBE_SHARDS.indexOf(kit as never)}`),
  } as unknown as BrainCtx;
  return { k, heard };
}

/** a creature of a class in a given script, facing east, its rect round the player */
function inState(anim: unknown, over: Partial<Enemy> = {}, kind = "inittube"): Enemy {
  const a = anim as Enemy["anim"];
  return { kind, x: 0, y: 0, facing: 1, left: -500, right: 500, top: -500, bottom: 500, clock: 0,
    state: "gait", anim: a, linger: 0, dents: 0, vx: 0, vy: 0, hp: 100, max: 100, script: a.kind, tag: a.tag,
    beat: 0, fighting: true, ...over } as Enemy;
}

const F = FOES.inittube;
const think = (e: Enemy, k: BrainCtx, run = 1_000) => tube(e, F, run, k);
const on = (e: Enemy) => [e.script, e.tag];

describe("inittube's decider, state 3 (0x419453)", () => {
  it("writhes at a player who is off his feet, whatever the band (0x41945f)", () => {
    const { k, heard } = ctx({ band: 3 }, [], { down: true });
    const e = inState(TUBE.stand);
    think(e, k);
    expect(on(e)).toEqual([TUBE.writhe.kind, TUBE.writhe.tag]);
    expect(heard).toEqual([]);
  });

  it("turns to face him and carries on deciding when he is behind it", () => {
    const { k } = ctx({ forward: -300, band: 0 });
    const e = inState(TUBE.stand);
    think(e, k);
    expect(e.facing).toBe(-1);
    expect(on(e)).toEqual([TUBE.dash.kind, TUBE.dash.tag]);
  });

  it("runs at him beyond 260, band 0 (0x419493)", () => {
    const { k, heard } = ctx({ band: 0 });
    const e = inState(TUBE.stand);
    think(e, k);
    expect(on(e)).toEqual([TUBE.dash.kind, 0]);
    expect(heard).toEqual([]);
  });

  it("tosses a coin at 100…140 between the swipe and the charge, saying the mace swish first (0x4195b9)", () => {
    for (const [coin, want] of [[1, TUBE.swipe], [2, TUBE.charge]] as const) {
      const { k, heard } = ctx({ band: 2 }, [coin]);
      const e = inState(TUBE.stand);
      think(e, k);
      expect(on(e)).toEqual([want.kind, want.tag]);
      expect(heard).toEqual([`roll 2=${coin}`, "say 0x17"]);
    }
  });

  it("brings the overhead down inside 100 with no coin at all (0x419622)", () => {
    const { k, heard } = ctx({ band: 3 });
    const e = inState(TUBE.stand);
    think(e, k);
    expect(on(e)).toEqual([TUBE.overhead.kind, TUBE.overhead.tag]);
    expect(heard).toEqual(["say 0x1d"]);
  });
});

describe("inittube's middle band, 140…260 (0x4194a8)", () => {
  it("walks in on a player whose back is turned, saying #0201 test tube (0x4194b1)", () => {
    // it faces east; so does he
    const { k, heard } = ctx({ band: 1 }, [], { facing: 1 });
    const e = inState(TUBE.stand);
    think(e, k);
    expect(on(e)).toEqual([TUBE.walk.kind, TUBE.walk.tag]);
    expect(heard).toEqual(["say 0x19"]);
  });

  it("spends a visit while its beat is still at or above zero, then rolls 2…8 and keeps the roll as its next beat (0x4194df)", () => {
    const e = inState(TUBE.stand);
    // the creator's 0 is read, and 0 is not below zero: the visit is spent
    const first = ctx({ band: 1 });
    think(e, first.k);
    expect(first.heard).toEqual([]);
    expect(e.beat).toBe(-1);
    expect(on(e)).toEqual([TUBE.stand.kind, TUBE.stand.tag]);
    // -1 is: `0x434540(7)` + 1, here a 3, and the swipe
    const second = ctx({ band: 1 }, [2]);
    think(e, second.k);
    expect(second.heard).toEqual(["roll 7=2", "say 0x17"]);
    expect(e.beat).toBe(3);
    expect(on(e)).toEqual([TUBE.swipe.kind, TUBE.swipe.tag]);
  });

  it("picks from 0x419840's seven-wide table by the same roll", () => {
    const picks: Record<number, [typeof TUBE.swipe | typeof TUBE.rear | typeof TUBE.writhe | typeof TUBE.flip, string]> = {
      2: [TUBE.swipe, "say 0x17"],
      3: [TUBE.swipe, "say 0x17"],
      4: [TUBE.swipe, "say 0x17"],
      5: [TUBE.swipe, "say 0x17"],
      6: [TUBE.rear, "say 0x1d"],
      7: [TUBE.writhe, "say 0x1a"],
      8: [TUBE.flip, "say 0x1d"],
    };
    for (const [n, [want, said]] of Object.entries(picks)) {
      const { k, heard } = ctx({ band: 1 }, [Number(n) - 1]);
      const e = inState(TUBE.stand, { beat: -1 });
      think(e, k);
      expect(on(e), `a roll of ${n}`).toEqual([want.kind, want.tag]);
      expect(heard.at(-1)).toBe(said);
      expect(e.beat).toBe(Number(n));
    }
  });
});

describe("inittube's flip and throw", () => {
  it("breathes on frame index 2 of the flip and hands to its tag 1 at the end (0x419403, 0x41941a)", () => {
    const { k, heard } = ctx({});
    const e = inState(TUBE.flip, { clock: 2 * TUBE.flip.hold });
    think(e, k, TUBE.flip.cels.length * TUBE.flip.hold);
    expect(heard).toEqual(["cast breath"]);
    e.clock = TUBE.flip.cels.length * TUBE.flip.hold;
    think(e, k, TUBE.flip.cels.length * TUBE.flip.hold);
    expect(on(e)).toEqual([TUBE.unflip.kind, TUBE.unflip.tag]);
  });

  it("follows him round through the flip, and hands back to the decider when tag 1 ends (0x419433)", () => {
    const { k } = ctx({ forward: -50 });
    const e = inState(TUBE.unflip);
    think(e, k, 10);
    expect(e.facing).toBe(-1);
    expect(on(e)).toEqual([TUBE.unflip.kind, TUBE.unflip.tag]);
    e.clock = 10;
    think(e, k, 10);
    expect(on(e)).toEqual([TUBE.stand.kind, TUBE.stand.tag]);
  });

  it("throws a shard, and another while a fresh roll of 5 beats the count (0x41973e)", () => {
    // two thrown: 5 > 1 asks again, 2 > 2 does not
    const { k, heard } = ctx({}, [1, 5, 2, 2]);
    const e = inState(TUBE.rear, { clock: 8 });
    think(e, k, 8);
    expect(on(e)).toEqual([TUBE.hurl.kind, TUBE.hurl.tag]);
    expect(heard).toEqual(["say 0x1d", "roll 2=1", "cast shard 0", "roll 5=5", "roll 2=2", "cast shard 1", "roll 5=2"]);
  });

  it("hands back to the decider at the end of the hurl, and from the unreachable tag 3 too (0x419771, 0x41978a)", () => {
    for (const a of [TUBE.hurl, TUBE.spare[1]]) {
      const { k } = ctx({});
      const e = inState(a as never, { clock: 4 });
      think(e, k, 4);
      expect(on(e)).toEqual([TUBE.stand.kind, TUBE.stand.tag]);
    }
    // ...and tag 2, which `0x4196fa` has no case for, falls out where it is
    const { k } = ctx({});
    const e = inState(TUBE.spare[0] as never, { clock: 4 });
    think(e, k, 4);
    expect(on(e)).toEqual([8, 2]);
  });

  it("calls both footsteps of the walk, on frames 3 and 7 (0x419385, 0x41939f)", () => {
    const { k, heard } = ctx({});
    const e = inState(TUBE.walk);
    for (let clock = 0; clock < TUBE.walk.cels.length * TUBE.walk.hold; clock++) {
      e.clock = clock;
      think(e, k);
    }
    // each cel is held two frames and the think asks on both
    expect(heard).toEqual(["say 0x1e", "say 0x1e", "say 0x1f", "say 0x1f"]);
  });
});

describe("initox's stand, state 2 (0x43f4f9)", () => {
  const OF = FOES.initox;
  // `beat` left for the brain to seed, as the creator does
  const stand = (over: Partial<Enemy> = {}) => inState(OX.stand, { beat: undefined, ...over }, "initox");
  const think = (e: Enemy, k: BrainCtx, run = 1_000) => ox(e, OF, run, k);

  it("walks away on its patrol from a player who is down, or who has left its widened patch", () => {
    const down = ctx({ band: 3 }, [], { down: true });
    const e = stand();
    think(e, down.k);
    expect(on(e)).toEqual([OX.patrolA.kind, OX.patrolA.tag]);
    // 200 past the rect's own right edge is outside it (0x43f527)
    const away = ctx({ band: 3 }, [], { x: 700 });
    const f = stand();
    think(f, away.k);
    expect(on(f)).toEqual([OX.patrolA.kind, OX.patrolA.tag]);
  });

  it("says a walk sound and walks in beyond 300 (0x43f56a)", () => {
    const { k, heard } = ctx({ band: 0 }, [2]);
    const e = stand();
    think(e, k);
    expect(on(e)).toEqual([OX.walkIn.kind, OX.walkIn.tag]);
    expect(heard).toEqual(["roll 2=2", "say 0x2e"]);
  });

  it("stands nine frames on a fresh 8 at 140…300, counting before the decrement (0x43f596)", () => {
    const e = stand();
    for (let i = 0; i < 9; i++) {
      const { k, heard } = ctx({ band: 1 });
      think(e, k);
      expect(heard, `frame ${i + 1}`).toEqual([]);
    }
    expect(e.beat).toBe(-1);
    // the tenth rolls, re-seeds the 8, and an idle with its own sound: 0x2d + n
    const { k, heard } = ctx({ band: 1 }, [1, 2]);
    think(e, k);
    expect(heard).toEqual(["roll 3=1", "roll 2=2", "say 0x2e"]);
    expect(on(e)).toEqual([OX.taunt[1].kind, OX.taunt[1].tag]);
    expect(e.beat).toBe(8);
  });

  it("says the charge's 0x2c on a 2 and then attacks anyway, the original's missing jmp at 0x43f612", () => {
    const { k, heard } = ctx({ band: 1 }, [2, 3]);
    const e = stand({ beat: -1 });
    think(e, k);
    expect(heard).toEqual(["roll 3=2", "say 0x2c", "roll 3=3", "say 0x31"]);
    expect(on(e)).toEqual([OX.attack[2].kind, OX.attack[2].tag]);
    expect(e.swing).toBe(true);
  });

  it("at 100…140 takes one of three attacks, or on the fourth turns and runs past him (0x43f621)", () => {
    const hit = ctx({ band: 2 }, [2]);
    const e = stand();
    think(e, hit.k);
    expect(hit.heard).toEqual(["roll 4=2", "say 0x30"]);
    expect(on(e)).toEqual([OX.attack[1].kind, OX.attack[1].tag]);
    const flee = ctx({ band: 2 }, [4]);
    const f = stand();
    think(f, flee.k);
    expect(f.facing).toBe(-1);
    expect(on(f)).toEqual([OX.runPast.kind, OX.runPast.tag]);
  });

  it("turns when he is behind it and chooses nothing that frame, the band's -1 falling past 0x43f55a", () => {
    const { k, heard } = ctx({ forward: -80, band: -1 });
    const e = stand();
    think(e, k, 10);
    expect(e.facing).toBe(-1);
    expect(heard).toEqual([]);
    expect(on(e)).toEqual([OX.stand.kind, OX.stand.tag]);
  });
});

describe("initox's other states", () => {
  const OF = FOES.initox;
  const think = (e: Enemy, k: BrainCtx, run = 1_000) => ox(e, OF, run, k);

  it("turns round and stands at its own walk bound rather than marching into the wall (0x43f48e)", () => {
    const { k } = ctx({});
    (k as unknown as { atBound: () => boolean }).atBound = () => true;
    const e = inState(OX.walkIn, {}, "initox");
    think(e, k);
    expect(e.facing).toBe(-1);
    expect(on(e)).toEqual([OX.stand.kind, OX.stand.tag]);
  });

  it("says 0x32 on frame 2 of its long idle and stands when either idle ends (0x43f6a8)", () => {
    const { k, heard } = ctx({});
    const e = inState(OX.taunt[0], { clock: 2 * OX.taunt[0].hold }, "initox");
    think(e, k);
    expect(heard).toEqual(["say 0x32"]);
    const short = inState(OX.taunt[1], { clock: 50 }, "initox");
    think(short, k, 50);
    expect(on(short)).toEqual([OX.stand.kind, OX.stand.tag]);
  });

  it("hands an attack, and the unreachable charge, back to the stand when it ends", () => {
    for (const a of [OX.attack[0], OX.charge]) {
      const { k } = ctx({});
      const e = inState(a, { clock: 20 }, "initox");
      think(e, k, 20);
      expect(on(e)).toEqual([OX.stand.kind, OX.stand.tag]);
    }
  });

  it("settles its body fifteen into the floor, and falls with 0x3d and a shake on death frame 5 (0x43f885)", () => {
    const death = OF.death!;
    const { k, heard } = ctx({});
    const e = inState(death, { state: "dead", clock: 5 * death.hold }, "initox");
    oxReacts(e, OF, 0, k);
    expect(e.floor).toBe(-15);
    expect(heard).toEqual(["say 0x3d", "shake 3"]);
    // ...and on any other frame only the settling
    const quiet = ctx({});
    oxReacts(inState(death, { state: "dead", clock: 1 }, "initox"), OF, 0, quiet.k);
    expect(quiet.heard).toEqual([]);
  });

  it("answers a blow with the attack's own voice, and the slide's 0x2c on the mixer's channel 0 (0x43fa7e, 0x43fad8)", () => {
    for (const [n, said] of [[0, "say 0x2f"], [2, "say 0x31"], [3, "say 0x2c"]] as const) {
      const { k, heard } = ctx({});
      const e = inState(OF.flinch![n], { state: "flinch", clock: 1 }, "initox");
      oxReacts(e, OF, 0, k);
      expect(heard, `flinch ${n}`).toEqual([said]);
    }
  });
});

describe("initbatboy (0x439240)", () => {
  const BF = FOES.initbatboy;
  const think = (e: Enemy, k: BrainCtx, run = 1_000) => batboy(e, BF, run, k);
  const at = (anim: unknown, over: Partial<Enemy> = {}) => inState(anim, over, "initbatboy");

  it("drops whatever it was doing to gloat the frame the player goes down, turning to face him (0x4392f6)", () => {
    const { k, heard } = ctx({ forward: -40, band: 2 }, [], { down: true });
    const e = at(BATBOY.run, { clock: 3 });
    think(e, k);
    expect(on(e)).toEqual([BATBOY.gloat.kind, BATBOY.gloat.tag]);
    expect(e.facing).toBe(-1);
    // state 8 runs on the same frame, on a script just rewound: nothing more happens
    expect(heard).toEqual([]);
  });

  it("goes straight back to the run the frame he is upright again (0x4397c0)", () => {
    const { k } = ctx({});
    const e = at(BATBOY.gloat);
    think(e, k);
    expect(on(e)).toEqual([BATBOY.run.kind, BATBOY.run.tag]);
  });

  it("trades its two gloats on nine in a hundred each time one ends, and otherwise loops the long one again (0x4397f0)", () => {
    const loop = ctx({}, [10], { down: true });
    const e = at(BATBOY.gloat, { clock: 3 });
    think(e, loop.k, 3);
    expect(on(e)).toEqual([BATBOY.gloat.kind, BATBOY.gloat.tag]);
    expect(e.clock).toBe(0);
    const trade = ctx({}, [9], { down: true });
    think(Object.assign(e, { clock: 3 }), trade.k, 3);
    expect(on(e)).toEqual([BATBOY.gloat2.kind, BATBOY.gloat2.tag]);
    // ...and back, on the same odds; a miss leaves the single cel where it is
    const stay = ctx({}, [50], { down: true });
    think(Object.assign(e, { clock: 1 }), stay.k, 1);
    expect(on(e)).toEqual([BATBOY.gloat2.kind, BATBOY.gloat2.tag]);
    const back = ctx({}, [1], { down: true });
    think(Object.assign(e, { clock: 1 }), back.k, 1);
    expect(on(e)).toEqual([BATBOY.gloat.kind, BATBOY.gloat.tag]);
  });

  it("on its deciding cels backs away inside 85, runs in from further, and covers only from a blow (state 2)", () => {
    const pick = (band: number, swinging: boolean) => {
      const { k } = ctx({ band }, [], { swinging });
      const e = at(BATBOY.read);
      think(e, k);
      return on(e);
    };
    expect(pick(3, false)).toEqual([BATBOY.away.kind, BATBOY.away.tag]);
    expect(pick(1, false)).toEqual([BATBOY.run.kind, BATBOY.run.tag]);
    expect(pick(-1, false)).toEqual([BATBOY.read.kind, BATBOY.read.tag]);
    expect(pick(-1, true)).toEqual([BATBOY.cover.kind, BATBOY.cover.tag]);
  });

  it("holds its cover until he swings again, then takes one of the two deciding cels on a coin (0x43942b)", () => {
    const still = ctx({ band: 2 });
    const e = at(BATBOY.cover);
    think(e, still.k);
    expect(on(e)).toEqual([BATBOY.cover.kind, BATBOY.cover.tag]);
    for (const [coin, want] of [[1, BATBOY.read], [2, BATBOY.read2]] as const) {
      const { k } = ctx({ band: 2 }, [coin], { swinging: true });
      const f = at(BATBOY.cover);
      think(f, k);
      expect(on(f)).toEqual([want.kind, want.tag]);
    }
  });

  it("swings once it is planted — under ten units of glide — saying 0x0d, and steps back when the blow ends (0x4395df, 0x439635)", () => {
    const sliding = ctx({ forward: 50 });
    const e = at(BATBOY.swingHi, { speed: 30 });
    think(e, sliding.k);
    expect(on(e)).toEqual([BATBOY.swingHi.kind, BATBOY.swingHi.tag]);
    const planted = ctx({ forward: 50 });
    e.speed = 5;
    think(e, planted.k);
    expect(planted.heard).toEqual(["say 0xd"]);
    expect(on(e)).toEqual([BATBOY.strikeHi.kind, BATBOY.strikeHi.tag]);
    const over = ctx({});
    e.clock = 2;
    think(e, over.k, 2);
    expect(on(e)).toEqual([BATBOY.back.kind, BATBOY.back.tag]);
  });

  it("runs the leap's three scripts in a row, though nothing on this page starts one (0x439764)", () => {
    const e = at(BATBOY.crouch, { clock: 4 });
    for (const want of [BATBOY.fly, BATBOY.land, BATBOY.back]) {
      think(e, ctx({}).k, 4);
      expect(on(e)).toEqual([want.kind, want.tag]);
      e.clock = 4;
    }
  });
});

describe("initmaskboy (0x438760)", () => {
  const MF = FOES.initmaskboy;
  const think = (e: Enemy, k: BrainCtx, run = 1_000) => maskboy(e, MF, run, k);
  const at = (anim: unknown, over: Partial<Enemy> = {}) => inState(anim, over, "initmaskboy");
  /** `0x438848`'s roll comes first every frame; 0x44 never beats 3 */
  const NO_ROLLER = MASKBOY.roller.odds[0];

  it("rolls the level's roller from 600 past a player within 300 east of it, at -480 (0x438848)", () => {
    const { k, heard } = ctx({ band: 0 }, [MASKBOY.roller.odds[1] - 1], { x: 200, y: 50 });
    think(at(MASKBOY.run), k);
    expect(heard).toEqual(["roll 68=2", "roller 800,50 vx -480"]);
    // ...and not for one west of it, or one too far off
    for (const x of [-200, 400]) {
      const off = ctx({ band: 0 }, [1], { x });
      think(at(MASKBOY.run), off.k);
      expect(off.heard).toEqual(["roll 68=1"]);
    }
  });

  it("drops what it is doing to gloat over a downed player, and runs again the frame he is up (0x438805, 0x438d39)", () => {
    const down = ctx({ band: 2 }, [NO_ROLLER], { down: true });
    const e = at(MASKBOY.run, { clock: 2 });
    think(e, down.k);
    expect(on(e)).toEqual([MASKBOY.gloat.kind, MASKBOY.gloat.tag]);
    const up = ctx({ band: 2 }, [NO_ROLLER]);
    think(e, up.k);
    expect(on(e)).toEqual([MASKBOY.run.kind, MASKBOY.run.tag]);
  });

  it("trades its two gloats on nine in a hundred as each lap ends (0x438d6e, 0x438da0)", () => {
    const e = at(MASKBOY.gloat, { clock: 10 });
    think(e, ctx({}, [NO_ROLLER, 50], { down: true }).k, 10);
    expect([...on(e), e.clock]).toEqual([MASKBOY.gloat.kind, MASKBOY.gloat.tag, 0]);
    think(Object.assign(e, { clock: 10 }), ctx({}, [NO_ROLLER, 9], { down: true }).k, 10);
    expect(on(e)).toEqual([MASKBOY.gloatB.kind, MASKBOY.gloatB.tag]);
    think(Object.assign(e, { clock: 2 }), ctx({}, [NO_ROLLER, 10], { down: true }).k, 2);
    expect(on(e)).toEqual([MASKBOY.gloatB.kind, MASKBOY.gloatB.tag]);
    think(Object.assign(e, { clock: 2 }), ctx({}, [NO_ROLLER, 3], { down: true }).k, 2);
    expect(on(e)).toEqual([MASKBOY.gloat.kind, MASKBOY.gloat.tag]);
  });

  it("braces from a blow behind it, holds the brace until he swings again, then drops to a pose on a coin (0x438991, 0x4389a9)", () => {
    const quiet = ctx({ band: -1 }, [NO_ROLLER]);
    const e = at(MASKBOY.guard[0]);
    think(e, quiet.k);
    expect(on(e)).toEqual([MASKBOY.guard[0].kind, MASKBOY.guard[0].tag]);
    think(e, ctx({ band: -1 }, [NO_ROLLER], { swinging: true }).k);
    expect(on(e)).toEqual([MASKBOY.brace.kind, MASKBOY.brace.tag]);
    think(e, ctx({ band: 1 }, [NO_ROLLER]).k);
    expect(on(e)).toEqual([MASKBOY.brace.kind, MASKBOY.brace.tag]);
    think(e, ctx({ band: 1 }, [NO_ROLLER, 2], { swinging: true }).k);
    expect(on(e)).toEqual([MASKBOY.guard[1].kind, MASKBOY.guard[1].tag]);
  });

  it("gives ground inside its last band and runs out of it into the first pose (0x4389cc)", () => {
    const e = at(MASKBOY.guard[1]);
    think(e, ctx({ band: 3 }, [NO_ROLLER]).k);
    expect(on(e)).toEqual([MASKBOY.giveGround.kind, MASKBOY.giveGround.tag]);
    e.clock = 4;
    think(e, ctx({ band: 3 }, [NO_ROLLER]).k, 4);
    expect(on(e)).toEqual([MASKBOY.guard[0].kind, MASKBOY.guard[0].tag]);
  });
});
