/**
 * `initghengis` — the states of its think `0x4226a0` the machine suites
 * leave, against a stand-in context.
 *
 *   npx vitest run skullcracker/tests/ghengis.ts
 *
 * The idle before the player arrives, the roar over a downed player, the
 * second half of the walk in (whose footfalls are tag 0's alone), and the
 * bull rush waiting out each link are taken here against the addresses in
 * `src/brains/ghengis.ts`.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { BrainCtx, Enemy } from "../src/brains/kit";
import { ghengis, GHENGIS } from "../src/brains/ghengis";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initghengis;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initghengis", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => ghengis(e, F, run, k);

describe("ghengis", () => {
  it("idles until the player is inside its rect (0x4226fc)", () => {
    const e = at(GHENGIS.idle, { fighting: false });
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(GHENGIS.idle));
    e.fighting = true;
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(GHENGIS.stance));
  });

  it("roars over a downed player before anything else (0x42273d)", () => {
    const { k, heard } = ctx({}, [], { down: true });
    const e = at(GHENGIS.stance);
    think(e, k);
    expect(heard).toEqual([`say 0x${GHENGIS.roarSnd.toString(16)}`]);
    expect(on(e)).toEqual(is(GHENGIS.roar));
  });

  it("makes no footfall on the run, tag 1 of the walk in (0x4228e5)", () => {
    const { k, heard } = ctx({});
    think(at(GHENGIS.run, { clock: 1 }), k, 12);
    think(at(GHENGIS.run, { clock: 4 * GHENGIS.run.hold }), k, 12);
    expect(heard).toEqual([]);
  });

  it("waits out every link of the bull rush (0x422970)", () => {
    for (const a of [GHENGIS.windUp, GHENGIS.rush, GHENGIS.rushEnd]) {
      const e = at(a, { clock: 1 });
      think(e, ctx({}).k, 9);
      expect(on(e)).toEqual(is(a));
    }
  });

  it("waits out the flinch before its coin (0x422a25)", () => {
    const e = at({ ...GHENGIS.stance, kind: 8 }, { clock: 1 });
    const s = ctx({});
    think(e, s.k, 3);
    expect([s.heard, e.script]).toEqual([[], 8]);
  });

  it("answers nothing in the page's states past the table", () => {
    const e = at(GHENGIS.stance, { script: 7 });
    expect(think(e, ctx({}).k)).toBe(false);
  });
});
