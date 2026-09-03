/**
 * How a sheet gets OUT of a conversation it has finished with
 * ([#265](https://github.com/dhobi/dreamrefactory/issues/265)).
 *
 *   npx vitest run taoot/tests/auto/speedrun-say.ts
 *
 * A bevel list used to have to run to the end of the conversation. It could not
 * be a prefix: the plaque branch of `converse` had ONE `else` for two unrelated
 * situations — "the plaque offered is not the one I named" and "I have said
 * everything I came to say" — and both threw. So a run that only needs a beat
 * (Sasha hands over Vlad's package on the third answer; the last two turns are
 * pleasantries) had to sit through the rest, or answer `otherwise: last` all the
 * way to the close, which is the same thing more slowly.
 *
 * `then:` is the second question asked separately. What is pinned here is mostly
 * what it must NOT do: a mis-typed bevel must still stop the run rather than
 * quietly walking out of a conversation, and a sheet that does not say `then:`
 * must behave exactly as it did before there was one — six of the shipped run's
 * `say` lines take a short list with `otherwise: last` and mean it.
 *
 * Driven against a scripted puppet rather than the game. What is being tested is
 * the decision — which gesture goes in at which plaque — and that is entirely
 * this loop's; a real conversation would add a browser, a rip and three minutes
 * to a question about four `if`s. The gestures are recorded and asserted, so a
 * press that never happens is as visible as a wrong one.
 */
import { test, expect } from "vitest";
import { VERBS, resolve } from "../../src/speedrun/actions";
import type { ActionContext } from "@dreamfactory/engine/web/speedrun/action";
import type { SpeedrunDriver } from "@dreamfactory/engine/web/speedrun/driver";
import type { Step } from "@dreamfactory/engine/web/speedrun/sheet";

/** one beat of a scripted conversation, in the order the puppet reaches them */
type Beat =
  | { kind: "line" }
  /**
   * The choices are up: their bevel ids, in the order the plaques are drawn.
   *
   * `minusOne` is what the script does when the plaque is answered -1, and it is
   * a BRANCH rather than the next beat along — that is what -1 is. Every
   * `puppetevent` in the tree is a `switch` with a `case -1` arm, so an ESC here
   * does not skip a turn and carry on down the list; it leaves the list. Most
   * arms close the conversation, some say goodbye first, which is the default
   * and the override below.
   */
  | { kind: "plaque"; ids: number[]; minusOne?: Beat[] }
  | { kind: "over" };

/** what the loop did, in order — `click 102`, `esc line`, `esc plaque` */
type Gesture = string;

/**
 * A puppet on rails.
 *
 * `evaluate` answers the three expressions this loop asks — the state probe, the
 * `speaking` test and the compound `done` — off the current beat, and every
 * gesture advances to the next one. Waits return at once: what is being measured
 * is the sequence of presses, and a fake that also modelled their timing would
 * be modelling the driver instead of the decision.
 */
function puppet(script: Beat[]): { d: SpeedrunDriver; gestures: Gesture[] } {
  let beats = script;
  let i = 0;
  const gestures: Gesture[] = [];
  const beat = (): Beat => beats[Math.min(i, beats.length - 1)] ?? { kind: "over" };

  const state = (): Record<string, unknown> => {
    const b = beat();
    if (b.kind === "over") return { conversing: false };
    if (b.kind === "line") return { conversing: true, with: "sasha", speaking: true, awaiting: false };
    return {
      conversing: true,
      with: "sasha",
      speaking: false,
      awaiting: true,
      choices: b.ids.map((id) => ({ id, text: `line ${id}` })),
      // one plaque per row, so a click's y says which index was taken
      rects: b.ids.map((_, k) => ({ x: 100, y: 200 + k })),
    };
  };

  const d = {
    evaluate: async <T,>(expr: string): Promise<T> => {
      // the state probe is the only one that reads the choice rectangles
      if (expr.includes("choiceRects")) return state() as T;
      if (expr.includes("viewer.speaking")) return (beat().kind === "line") as T;
      // the compound "this wait is over" test, and anything else: true, so the
      // loop never parks on a fake
      return true as T;
    },
    hold: async () => {},
    tryHold: async () => true,
    key: async (name: string) => {
      const b = beat();
      gestures.push(`esc ${b.kind}`);
      expect(name).toBe("Escape");
      if (b.kind === "plaque") {
        // -1: the script's own arm, not the turn after this one
        beats = b.minusOne ?? [{ kind: "over" }];
        i = 0;
        return;
      }
      i++;
    },
    clickAt: async (_x: number, y: number) => {
      const b = beat();
      if (b.kind !== "plaque") throw new Error(`clicked at a ${b.kind}`);
      gestures.push(`click ${b.ids[y - 200]}`);
      i++;
    },
    sleep: async () => {},
    hammer: async () => 0,
  };
  // A partial on purpose: a fake that implemented all forty of the driver's
  // methods would be forty chances to describe a browser this test does not use.
  return { d: d as unknown as SpeedrunDriver, gestures };
}

/** run `say` over a scripted puppet, and give back what it pressed and said */
async function say(
  opts: Record<string, string>,
  bevels: number[],
  beats: Beat[],
): Promise<{ gestures: Gesture[]; said: string[]; error?: string }> {
  const { d, gestures } = puppet(beats);
  const said: string[] = [];
  const step: Step = {
    verb: "say",
    args: [],
    opts,
    bevels,
    repeat: 1,
    line: 42,
    source: `say([${bevels.join(",")}])`,
  };
  const c: ActionContext = {
    d,
    step,
    wait: "none",
    budget: 10_000,
    gap: 16,
    say: (m) => said.push(m),
    suggest: () => {},
    // `say` never parses a line, so the vocabulary is only here because the
    // context carries it — this suite drives ONE verb and not a sheet
    verbs: VERBS,
  };
  try {
    await resolve("say")!.run(c);
  } catch (e) {
    return { gestures, said, error: (e as Error).message };
  }
  return { gestures, said };
}

/** Sasha: three answers worth having, then two turns of pleasantries */
const SASHA: Beat[] = [
  { kind: "plaque", ids: [101, 103] },
  { kind: "line" },
  { kind: "plaque", ids: [102, 103] },
  { kind: "line" },
  { kind: "plaque", ids: [102, 103] },
  { kind: "line" },
  // from here the run has the package and does not care
  { kind: "plaque", ids: [101, 103] },
  { kind: "line" },
  { kind: "plaque", ids: [103] },
  { kind: "over" },
];

test("then: leave answers the plaque -1 and stops taking turns (#265)", async () => {
  const r = await say({ then: "leave" }, [101, 102, 102], SASHA);
  expect(r.error).toBeUndefined();
  expect(r.gestures).toEqual([
    "click 101",
    "esc line",
    "click 102",
    "esc line",
    "click 102",
    "esc line",
    // the fourth plaque is where the list runs out: ONE press, and it is the
    // -1 answer rather than a click on a bevel the sheet never named
    "esc plaque",
  ]);
  expect(r.said[0]).toBe("said 101,102,102, then left (-1)");
});

test("a -1 arm with a parting line is skipped, not clicked through (#265)", async () => {
  // the engine does not set the skip flag on the plaque ESC precisely so the
  // script's own `case -1` can speak — puppet.ts, quoting 0x4418a7
  const r = await say({ then: "leave" }, [101], [
    { kind: "plaque", ids: [101, 103] },
    { kind: "plaque", ids: [102, 103], minusOne: [{ kind: "line" }, { kind: "over" }] },
  ]);
  expect(r.error).toBeUndefined();
  expect(r.gestures).toEqual(["click 101", "esc plaque", "esc line"]);
  expect(r.said[0]).toBe("said 101, then left (-1)");
});

test("then: stop hands back with the plaque still standing (#265)", async () => {
  // what lets a sheet put a split() inside a conversation and close it itself
  const r = await say({ then: "stop" }, [101, 102, 102], SASHA);
  expect(r.error).toBeUndefined();
  expect(r.gestures).toEqual(["click 101", "esc line", "click 102", "esc line", "click 102", "esc line"]);
  expect(r.said[0]).toBe("said 101,102,102 — left them waiting");
});

test("a wrong bevel still stops the run, `then:` or not (#265)", async () => {
  // the whole reason `then:` is not a fourth value of `otherwise:`: a typo must
  // never be answered by walking out of the conversation
  const r = await say({ then: "leave" }, [101, 999], SASHA);
  expect(r.error).toContain("bevel 999 not offered");
  expect(r.gestures).toEqual(["click 101", "esc line"]);
});

test("without `then:` an exhausted list behaves exactly as it did", async () => {
  // the shipped sheet says `say([101,102], otherwise: last)` in six places and
  // means "answer to the end", and `say([101,102])` still refuses to guess
  const kept = await say({ otherwise: "last" }, [101, 102], SASHA);
  expect(kept.error).toBeUndefined();
  expect(kept.gestures).toEqual([
    "click 101",
    "esc line",
    "click 102",
    "esc line",
    "click 103",
    "esc line",
    "click 103",
    "esc line",
    "click 103",
  ]);

  const refused = await say({}, [101, 102], SASHA);
  expect(refused.error).toContain("unplanned choice");
});

test("a `then:` nobody defined is a named refusal, not a silent default", async () => {
  const r = await say({ then: "sideways" }, [101], SASHA);
  expect(r.error).toBe("sheet line 42: then: sideways is not leave|stop");
  expect(r.gestures).toEqual([]);
});

test("an `otherwise:` nobody defined is too", async () => {
  const r = await say({ otherwise: "lsat" }, [101], SASHA);
  expect(r.error).toBe("sheet line 42: otherwise: lsat is not stop|first|last");
  expect(r.gestures).toEqual([]);
});
