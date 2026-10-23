/**
 * `initwerea`, the street punk — the states of its think `0x44e580` the
 * machine suites leave, and the burn (`wereaReacts`, `0x44ed8c`), against a
 * stand-in context.
 *
 *   npx vitest run skullcracker/tests/werea.ts
 *
 * The punk is the worked example the other classes are read against, and the
 * city suites fight plenty of them; what they do not happen to reach is here,
 * taken on purpose: the mill and the walk home, the leap steered round him
 * from either side, the burn running out into a stance or a corpse, and the
 * stance turning away from a downed player or a crowded side. Each check
 * names the address in `src/brains/werea.ts` it was read from.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import { TICK_SCALE, type BrainCtx, type Enemy } from "../src/brains/kit";
import { werea, WEREA, wereaReacts } from "../src/brains/werea";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initwerea;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initwerea", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => werea(e, F, run, k);

describe("the mill, state 6 (0x44ebf7)", () => {
  it("mills again while he is down and goes home to patrol the frame he is up", () => {
    const e = at(WEREA.mill, { clock: 1, x: 5, home: 250 });
    think(e, ctx({}, [], { down: true }).k, 6);
    expect(on(e)).toEqual(is(WEREA.mill));
    e.clock = 6;
    think(e, ctx({}, [], { down: true }).k, 6);
    expect([e.clock, ...on(e)]).toEqual([0, ...is(WEREA.mill)]);
    e.clock = 6;
    think(e, ctx({}).k, 6);
    expect([e.x, e.fighting, ...on(e)]).toEqual([250, false, ...is(WEREA.patrol)]);
    const homeless = at(WEREA.mill, { clock: 6, x: 5 });
    think(homeless, ctx({}).k, 6);
    expect(homeless.x).toBe(5);
  });
});

describe("the hop, state 7 tag 2 (0x44ecb5)", () => {
  it("steers ten a frame toward the side it wants while within thirty of his height (0x44ecc9)", () => {
    // wanting the west side (AI+6 set): +10 facing east, -10 facing west
    for (const [side, facing, vx] of [[1, 1, 10], [1, -1, -10], [0, 1, -10], [0, -1, 10]] as const) {
      const e = at(WEREA.hop, { side, facing, y: 0, clock: 1, vy: -3 });
      think(e, ctx({}, [], { anchor: 0 }).k, 6);
      expect(e.vx / TICK_SCALE, `side ${side} facing ${facing}`).toBe(vx);
    }
    // ...and lands once the script is done and it has stopped falling
    const e = at(WEREA.hop, { side: 0, y: 0, clock: 6, vy: 0 });
    think(e, ctx({}, [], { anchor: 500 }).k, 6);
    expect(on(e)).toEqual(is(WEREA.land));
  });
});

describe("the burn (0x44ed8c)", () => {
  it("bites ten a frame with a growl, then stands with health left or lies two hundred frames dead (0x44edae, 0x44edce)", () => {
    const burn = F.burns!.anim!;
    const { k, heard } = ctx({});
    const e = at(burn, { state: "flinch", hp: 12 });
    wereaReacts(e, F, 99, k);
    expect([e.hp, heard]).toEqual([2, ["say 0x23"]]);
    const left = at({ ...WEREA.stance, kind: 8, tag: 0 }, { hp: 2 });
    think(left, ctx({}).k);
    expect(on(left)).toEqual(is(WEREA.stance));
    const out = at({ ...WEREA.stance, kind: 8, tag: 0 }, { hp: -8, swing: true, clock: 4 });
    think(out, ctx({}).k);
    expect([out.state, out.anim, out.clock, out.swing, out.linger]).toEqual(["dead", F.death, 0, false, 200]);
    const bare = at({ ...WEREA.stance, kind: 8, tag: 0 }, { hp: 0 });
    werea(bare, { ...F, death: undefined }, 1_000, ctx({}).k);
    expect(bare.state).toBe("gait");
  });

  it("does nothing in a state the table has no case for", () => {
    const e = at(WEREA.stance, { script: 9 });
    expect(think(e, ctx({}).k)).toBe(false);
  });
});

describe("the stance, state 1 (0x44e6e7)", () => {
  it("walks away from a downed player, whichever side he fell (0x44e710)", () => {
    for (const [px, facing] of [[50, -1], [-50, 1]] as const) {
      const e = at(WEREA.stance, { x: 0 });
      think(e, ctx({}, [], { down: true, x: px }).k);
      expect([e.facing, ...on(e)]).toEqual([facing, ...is(WEREA.mill)]);
    }
  });

  it("wants the other side of him when this one is crowded (0x44e75b)", () => {
    for (const side of [0, 1]) {
      const s = ctx({ band: -1 });
      s.k.crowded = () => true;
      const e = at(WEREA.stance, { side, facing: side === 0 ? -1 : 1 });
      think(e, s.k);
      expect(e.side).toBe(side === 0 ? 1 : 0);
    }
  });
});
