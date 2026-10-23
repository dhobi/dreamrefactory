/**
 * `initwbooly`, level five's boss — its think `0x455940`, its hit gate
 * `0x456310`, its death `0x456129`, and the fireball's own handler `0x455751`,
 * each state taken on purpose against a stand-in context.
 *
 *   npx vitest run skullcracker/tests/wbooly.ts
 *
 * `tests/machine/playgr.ts` fights it inside the level, where the dice and the
 * player decide which states run; here the dice are a queue and the player a
 * record, so the rarely-rolled ones — the seventh throw's bellow, the swat at
 * the apex of a jump, the walk home when the melee budget runs out — are
 * checked against the addresses `src/brains/wbooly.ts` was read from.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { BrainCtx, CastKit, CastSelf, Enemy } from "../src/brains/kit";
import { wbooly, WBOOLY, WBOOLY_HIGH, WBOOLY_LOW, WBOOLY_THROW, wboolyGate, wboolyReacts } from "../src/brains/wbooly";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initwbooly;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initwbooly", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => wbooly(e, F, run, k);
/** `0x455ac9`'s 1..413, any figure at or past 29 that does not roar */
const QUIET = 100;

/** a context that names which fireball was thrown */
function thrower(track: Parameters<typeof ctx>[0], rolls: number[] = [], player = {}) {
  const s = ctx(track, rolls, player);
  s.k.cast = (_e: Enemy, kit: CastKit) =>
    void s.heard.push(new Map([[WBOOLY_HIGH, "cast high"], [WBOOLY_LOW, "cast low"]]).get(kit) ?? "cast ?");
  return s;
}

describe("the fireball's hit handler (0x455751)", () => {
  const ball = (over: Partial<CastSelf> = {}): CastSelf => ({ x: 0, y: 0, vx: 42, vy: 5, facing: 1, spent: false, ...over });
  const burns = (self: CastSelf, code: number) => {
    const lit: string[] = [];
    const took = WBOOLY_HIGH.onCode!(self, code, {
      burn: (how) => void lit.push(how?.late ? "late" : "early"),
      burst: () => void lit.push("burst"),
    });
    return { took, lit };
  };

  it("takes the -9 alone: lit late, stopped dead and sent ten up (0x455763, 0x455791, 0x4557af)", () => {
    const b = ball();
    expect(burns(b, WBOOLY_THROW.burns)).toEqual({ took: true, lit: ["late"] });
    expect([b.alight, b.vx, b.vy]).toEqual([true, 0, -WBOOLY_THROW.doused]);
  });

  it("declines any other code, and every code once it is alight (0x455751)", () => {
    expect(burns(ball(), 0x65)).toEqual({ took: false, lit: [] });
    const lit = ball({ alight: true, vx: 9 });
    expect(burns(lit, WBOOLY_THROW.burns)).toEqual({ took: false, lit: [] });
    expect(lit.vx).toBe(9);
  });

  it("is the handler on both throws", () => {
    expect(WBOOLY_LOW.onCode).toBe(WBOOLY_HIGH.onCode);
  });
});

describe("state 0, the statue and the climb (0x4559bb)", () => {
  it("holds the statue until the player is inside its rect (0x4559db)", () => {
    const { k, heard } = ctx({});
    const e = at(WBOOLY.statue, { fighting: false });
    think(e, k);
    expect(on(e)).toEqual(is(WBOOLY.statue));
    expect(heard).toEqual([]);
  });

  it("falls out of any tag kind 0 has no case for (0x4559d1)", () => {
    const { k, heard } = ctx({});
    const e = at(WBOOLY.statue, { tag: 3 });
    expect(think(e, k)).toBe(false);
    expect([e.script, e.tag]).toEqual([0, 3]);
    expect(heard).toEqual([]);
  });
});

describe("state 1, the ranged half (0x455aa5)", () => {
  it("mills while the player is off his feet, before any roll (0x455aa5)", () => {
    const { k, heard } = ctx({}, [], { down: true });
    const e = at(WBOOLY.stance);
    think(e, k);
    expect(on(e)).toEqual(is(WBOOLY.mill));
    expect(heard).toEqual([]);
  });

  it("turns to face him and carries on deciding in the same frame (0x455ad6)", () => {
    const { k } = ctx({ forward: -100, band: 6 }, [QUIET]);
    const e = at(WBOOLY.stance);
    think(e, k);
    expect(e.facing).toBe(-1);
    expect(on(e)).toEqual(is(WBOOLY.swat));
  });

  it("after the seventh throw bellows the charge, seeds ten decisions and crouches into the melee (0x455b15)", () => {
    const { k, heard } = ctx({ band: 0 }, [QUIET]);
    const e = at(WBOOLY.stance, { decisions: 7 });
    think(e, k);
    expect(heard).toEqual([`roll 413=${QUIET}`, "say 0x29"]);
    expect(e.decisions).toBe(10);
    expect(on(e)).toEqual(is(WBOOLY.crouch));
  });

  it("does nothing on band -1, the unsigned ja at 0x455b57", () => {
    const { k } = ctx({ band: -1 }, [QUIET]);
    const e = at(WBOOLY.stance);
    think(e, k);
    expect(on(e)).toEqual(is(WBOOLY.stance));
  });

  it("swipes low at a player on the ground at 60…160, and swats one in the air (0x455bfd)", () => {
    const ground = ctx({ band: 5 }, [QUIET], { vy: 0 });
    const e = at(WBOOLY.stance);
    think(e, ground.k);
    expect([...on(e), e.swing]).toEqual([...is(WBOOLY.swipe), true]);
    const air = ctx({ band: 5 }, [QUIET], { vy: -12 });
    const f = at(WBOOLY.stance);
    think(f, air.k);
    expect([...on(f), f.swing]).toEqual([...is(WBOOLY.swat), true]);
  });

  it("answers a swing beyond 160 at once with one of the two throws, the beat untouched (0x455b6c)", () => {
    for (const [coin, want] of [[1, WBOOLY.lob], [2, WBOOLY.hurl]] as const) {
      const { k } = ctx({ band: 2 }, [QUIET, coin], { swinging: true });
      const e = at(WBOOLY.stance, { beat: 4 });
      think(e, k);
      expect(on(e)).toEqual(is(want));
      expect(e.beat).toBe(4);
    }
  });

  it("throws on a lapsed beat, reseeded fifteen: two lobs, then the low one (0x455b99, 0x455bf0)", () => {
    const e = at(WBOOLY.stance, { beat: -1, nerve: 0 });
    const got: string[] = [];
    for (let i = 0; i < 3; i++) {
      e.beat = -1;
      think(e, ctx({ band: 1 }, [QUIET]).k);
      got.push(new Map<unknown, string>([[WBOOLY.lob, "lob"], [WBOOLY.hurl, "hurl"]]).get(e.anim) ?? "?");
      expect(e.beat).toBe(15);
      Object.assign(e, { anim: WBOOLY.stance, script: 1, tag: 0 });
    }
    expect(got).toEqual(["lob", "lob", "hurl"]);
    expect(e.nerve).toBe(0);
    // ...and a beat still at or above zero is only counted down
    const wait = at(WBOOLY.stance, { beat: 0 });
    think(wait, ctx({ band: 1 }, [QUIET]).k);
    expect([wait.beat, ...on(wait)]).toEqual([-1, ...is(WBOOLY.stance)]);
  });
});

describe("state 2, the throw (0x455c55)", () => {
  it("abandons the wind-up for a swing when he closes inside 160, overhead past 80 of height (0x455c65)", () => {
    const high = ctx({ band: 5 }, [], { anchor: -200 });
    const e = at(WBOOLY.lob);
    think(e, high.k, 7);
    expect(on(e)).toEqual(is(WBOOLY.swat));
    const level = ctx({ band: 6 }, [], { anchor: -40 });
    const f = at(WBOOLY.lob);
    think(f, level.k, 7);
    expect(on(f)).toEqual(is(WBOOLY.swipe));
  });

  it("throws tag 0's high ball and tag 1's low one as the script ends, and counts the throw (0x455cc3, 0x455d01, 0x455d4f)", () => {
    for (const [a, said] of [[WBOOLY.lob, "cast high"], [WBOOLY.hurl, "cast low"]] as const) {
      const { k, heard } = thrower({ band: 1 });
      const e = at(a, { clock: 7, decisions: 2 });
      think(e, k, 7);
      expect(heard).toEqual([said]);
      expect(e.decisions).toBe(3);
      expect(on(e)).toEqual(is(WBOOLY.stance));
    }
  });

  it("waits for the script to end, and tag 2 throws nothing but still counts (0x455cc1)", () => {
    const waiting = thrower({ band: 1 });
    const e = at(WBOOLY.lob, { clock: 3 });
    think(e, waiting.k, 7);
    expect(waiting.heard).toEqual([]);
    expect(on(e)).toEqual(is(WBOOLY.lob));
    const spare = thrower({ band: 1 });
    const f = at(WBOOLY.unused, { clock: 6, decisions: 0 });
    think(f, spare.k, 6);
    expect(spare.heard).toEqual([]);
    expect(f.decisions).toBe(1);
    expect(on(f)).toEqual(is(WBOOLY.stance));
  });
});

describe("states 3, 4, 6 and 10", () => {
  it("strikes at a hundred percent and stands when the swipe, swat or roar ends (0x455d70)", () => {
    for (const a of [WBOOLY.swipe, WBOOLY.swat, WBOOLY.bellow]) {
      const e = at(a, { clock: 2 });
      think(e, ctx({}).k, 10);
      expect([e.strength, ...on(e)]).toEqual([0x64, ...is(a)]);
      e.clock = 10;
      think(e, ctx({}).k, 10);
      expect(on(e)).toEqual(is(WBOOLY.stance));
    }
  });

  it("mills on while he is down, and snaps home into the stance the frame he is up (0x45609e, 0x4560cd)", () => {
    const e = at(WBOOLY.mill, { clock: 2, x: 100, home: 4650 });
    think(e, ctx({}, [], { down: true }).k, 12);
    expect(on(e)).toEqual(is(WBOOLY.mill));
    e.clock = 12;
    think(e, ctx({}, [], { down: true }).k, 12);
    expect([e.x, ...on(e)]).toEqual([100, ...is(WBOOLY.mill)]);
    e.clock = 12;
    think(e, ctx({}).k, 12);
    expect([e.x, ...on(e)]).toEqual([4650, ...is(WBOOLY.stance)]);
  });

  it("answers false and stays put in a state it has no case for", () => {
    const e = at(WBOOLY.stance, { script: 12, tag: 0 });
    expect(think(e, ctx({}).k)).toBe(false);
    expect(e.script).toBe(12);
  });
});

describe("state 5, the melee half (0x455d9b)", () => {
  it("hands the gather, the swing, the run and any stray tag to the hover when each ends", () => {
    for (const a of [WBOOLY.crouch, WBOOLY.swing, WBOOLY.run, { ...WBOOLY.run, tag: 7 }]) {
      const e = at(a, { clock: 1 });
      think(e, ctx({ band: 0 }).k, 5);
      expect([e.strength, ...on(e)]).toEqual([0x64, a.kind, a.tag]);
      e.clock = 5;
      think(e, ctx({ band: 0 }).k, 5);
      expect(on(e)).toEqual(is(WBOOLY.hover));
    }
  });

  it("grunts and swings out of the middle of the walk once he is inside 160 (0x455df1)", () => {
    const { k, heard } = ctx({ band: 5 });
    const e = at(WBOOLY.walk, { clock: 2 });
    think(e, k, 7);
    expect(heard).toEqual(["say 0x28"]);
    expect([...on(e), e.swing]).toEqual([...is(WBOOLY.swing), true]);
    // short of that the walk plays out into the hover
    const far = at(WBOOLY.walk, { clock: 7 });
    think(far, ctx({ band: 2 }).k, 7);
    expect(on(far)).toEqual(is(WBOOLY.hover));
  });

  it("rises out of the melee home: a shake on 2, the thud, and the home point written outright (0x455e36)", () => {
    const { k, heard } = ctx({});
    const e = at(WBOOLY.rise, { clock: 1, x: 3000, home: 4650 });
    think(e, k, 3);
    expect(heard).toEqual([]);
    e.clock = 3;
    think(e, k, 3);
    expect(heard).toEqual(["shake 2", "say 0x31"]);
    expect([e.x, ...on(e)]).toEqual([4650, ...is(WBOOLY.stance)]);
  });
});

describe("state 5 tag 4, the frame that decides (0x455e87)", () => {
  it("zeroes the budget and holds the hover over a downed player (0x455e91)", () => {
    const e = at(WBOOLY.hover, { decisions: 6, clock: 0 });
    think(e, ctx({}, [], { down: true }).k, 1);
    expect([e.decisions, ...on(e)]).toEqual([0, ...is(WBOOLY.hover)]);
    e.clock = 1;
    e.anim = WBOOLY.walk;
    think(Object.assign(e, { script: 5, tag: 4 }), ctx({}, [], { down: true }).k, 1);
    expect(on(e)).toEqual(is(WBOOLY.hover));
  });

  it("spends one decision a pass and, on its last, waits for the cel to end before heading home", () => {
    const e = at(WBOOLY.hover, { decisions: 1, x: 3000, home: 4650 });
    think(e, ctx({ band: 2 }).k, 1);
    expect([e.decisions, ...on(e)]).toEqual([0, ...is(WBOOLY.hover)]);
  });

  it("runs home, saying the charge, when out of decisions and more than 110 from home (0x455ec4, 0x455f03)", () => {
    const { k, heard } = ctx({ band: 2 });
    const e = at(WBOOLY.hover, { decisions: 1, x: 3000, home: 4650, clock: 1, facing: -1 });
    think(e, k, 1);
    expect(heard).toEqual(["say 0x29"]);
    expect(e.facing).toBe(1);
    expect(on(e)).toEqual(is(WBOOLY.run));
    // home to the west: it turns west
    const west = at(WBOOLY.hover, { decisions: 1, x: 6000, home: 4650, clock: 1 });
    think(west, ctx({ band: 2 }).k, 1);
    expect(west.facing).toBe(-1);
  });

  it("rises, due west, when within 110 of home (0x455ee7, 0x455ef2)", () => {
    const e = at(WBOOLY.hover, { decisions: 0, x: 4600, home: 4650, clock: 1 });
    think(e, ctx({ band: 2 }).k, 1);
    expect([e.decisions, e.facing, ...on(e)]).toEqual([0, -1, ...is(WBOOLY.rise)]);
  });

  it("with decisions left: faces him, holds on band -1, swings inside 160 and closes beyond it (0x455f19, 0x455f25)", () => {
    const behind = at(WBOOLY.hover, { decisions: 5, clock: 1 });
    think(behind, ctx({ band: -1, forward: -50 }).k, 1);
    expect([behind.facing, ...on(behind)]).toEqual([-1, ...is(WBOOLY.hover)]);
    const waiting = at(WBOOLY.hover, { decisions: 5, clock: 0 });
    expect(think(waiting, ctx({ band: -1 }).k, 1)).toBe(false);

    const close = ctx({ band: 6 });
    const c = at(WBOOLY.hover, { decisions: 5 });
    think(c, close.k, 1);
    expect(close.heard).toEqual(["say 0x28"]);
    expect([...on(c), c.swing]).toEqual([...is(WBOOLY.swing), true]);
  });

  it("closes at a walk facing west and at a run facing east, the mirror flag at 0x455f55", () => {
    const west = ctx({ band: 2 });
    const w = at(WBOOLY.hover, { decisions: 5, facing: -1 });
    think(w, west.k, 1);
    expect(west.heard).toEqual(["say 0x29"]);
    expect(on(w)).toEqual(is(WBOOLY.walk));
    const e = at(WBOOLY.hover, { decisions: 5, facing: 1 });
    think(e, ctx({ band: 2 }).k, 1);
    expect(on(e)).toEqual(is(WBOOLY.run));
  });
});

describe("the hit gate (0x456310)", () => {
  const blow = { damage: 10, code: 100 };
  const flinch = F.flinch![0];
  const down = F.knockdown!.anim;

  it("passes a burning code straight through (0x45631e)", () => {
    const e = at(WBOOLY.stance, { dents: 2 });
    const burn = { damage: 0, code: -9 };
    expect(wboolyGate(e, F, burn)).toBe(burn);
    expect(e.dents).toBe(2);
  });

  it("takes a blow in the throw, the get-up or a flinch with no reaction, unless it kills (0x456470, 0x4563ce)", () => {
    for (const e of [
      at(WBOOLY.lob, { dents: 2 }),
      at(down.next!, { state: "flinch", dents: 2 }),
      at(flinch, { state: "flinch", dents: 2 }),
    ]) {
      expect(wboolyGate(e, F, blow)).toEqual({ ...blow, still: true });
      expect(e.dents).toBe(1);
    }
    const dying = at(WBOOLY.lob, { hp: 10, dents: 2 });
    expect(wboolyGate(dying, F, blow)).toBe(blow);
    expect(dying.dents).toBe(2);
  });

  it("counts blows only in the melee half, and knocks it down on the third, zeroing its budget (0x456461, 0x456496)", () => {
    // dents is one more than AI+0x12 after the page's step
    const melee = at(WBOOLY.hover, { dents: 0, decisions: 6 });
    const counts: number[] = [];
    for (let i = 0; i < 3; i++) {
      wboolyGate(melee, F, blow);
      counts.push(melee.dents);
      melee.dents += 1; // the page's step
    }
    expect(counts).toEqual([1, 2, 3]);
    expect(melee.decisions).toBe(0);
    // outside the melee the count stands still
    const ranged = at(WBOOLY.stance, { dents: 2 });
    wboolyGate(ranged, F, blow);
    expect(ranged.dents).toBe(1);
    // ...and the knockdown itself (state 7) reads a reset count
    const over = at(down, { state: "flinch", dents: 4 });
    wboolyGate(over, F, blow);
    expect(over.dents).toBe(0);
  });
});

describe("the wreck burning (0x456129, 0x456171)", () => {
  const death = F.death!;
  it("does nothing alive, or before the eighteenth cel", () => {
    const { k, heard } = ctx({});
    wboolyReacts(at(WBOOLY.stance), F, 0, k);
    wboolyReacts(at(death, { state: "dead", clock: 17 * death.hold }), F, 0, k);
    expect(heard).toEqual([]);
  });

  it("says 0x32 on the lead channel with a shake on 3, then crackles at the player on a wait of 13…20 (0x45613f, 0x45618a)", () => {
    const e = at(death, { state: "dead", clock: 18 * death.hold });
    const first = ctx({});
    wboolyReacts(e, F, 0, first.k);
    expect(first.heard).toEqual(["say 0x32 lead", "shake 3"]);
    expect(e.decisions).toBe(5);
    for (let i = 0; i < 5; i++) {
      const quiet = ctx({});
      wboolyReacts(e, F, 0, quiet.k);
      expect(quiet.heard).toEqual([]);
    }
    const crackle = ctx({}, [2, 3]);
    wboolyReacts(e, F, 0, crackle.k);
    expect(crackle.heard).toEqual(["roll 2=2", "say 0x1 lead", "roll 8=3"]);
    expect(e.decisions).toBe(15);
  });
});
