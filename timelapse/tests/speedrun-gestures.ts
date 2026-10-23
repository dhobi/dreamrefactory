/**
 * The gestures Timelapse's speedrun verbs are made of (`src/speedrun/gestures.ts`)
 * where they cannot do what they are asked: a box that is not four numbers, a
 * global that is not what a step needs, a region or prop that is not on screen,
 * a verb's number that is not one, a driver that cannot hover.
 *
 *   npx vitest run --project timelapse timelapse/tests/speedrun-gestures.ts
 *
 * Each refusal names what was there instead — the regions of the flat, the
 * props on screen, the world, stage and frame — because a sheet that stops on
 * one is written again from that message. Driven against a driver that answers
 * the module's own expressions (they are exported, so the fake answers exactly
 * the question the gesture asks and nothing looser).
 */
import { expect, test } from "vitest";
import type { ActionContext } from "@dreamfactory/speedrun/action";
import type { SpeedrunDriver } from "@dreamfactory/speedrun/driver";
import {
  PROPS_ON_SCREEN,
  PROP_HITS,
  REGIONS,
  REGION_MID,
  REGION_POINT,
  SETTLED,
  WHERE,
  boxOf,
  global,
  hover,
  need,
  num,
  propHits,
  regionMid,
  regionPoint,
  settle,
} from "../src/speedrun/gestures";

/** a context whose driver answers these expressions, and records what it was asked to do */
function ctx(answers: Record<string, unknown>, opts: { args?: string[]; hover?: boolean } = {}) {
  const did: string[] = [];
  const d = {
    evaluate: async (expr: string) => {
      if (!(expr in answers)) throw new Error(`unexpected question: ${expr.slice(0, 60)}`);
      return answers[expr];
    },
    hold: async (expr: string, what: string) => void did.push(`hold ${expr === SETTLED ? "SETTLED" : expr} (${what})`),
    settle: async (mode: string, what: string) => void did.push(`settle ${mode} (${what})`),
    ...(opts.hover ? { hover: async (x: number, y: number) => void did.push(`hover ${x},${y}`) } : {}),
  } as unknown as SpeedrunDriver;
  const c = {
    d,
    step: { verb: "glyphs", args: opts.args ?? [], opts: {}, line: 1, source: "" },
    wait: "quiet",
    budget: 1000,
  } as unknown as ActionContext;
  return { c, did };
}

const AT_STAGE = { [WHERE]: { world: "M", stage: 3, frame: 12 } };

test("a box is four numbers, by spaces or commas", () => {
  expect(boxOf("10, 20 30,40")).toEqual([10, 20, 30, 40]);
  expect(() => boxOf("10 20 30")).toThrow(/^a box is four numbers, x0 y0 x1 y1 — not "10 20 30"$/);
  expect(() => boxOf("10 20 30 east")).toThrow(/not "10 20 30 east"$/);
});

test("a global a step needs reads true and 1, false and 0, as the same", async () => {
  const { c } = ctx({ [global("gotkey")]: "false", [global("door")]: "true", ...AT_STAGE });
  await need(c, "gotkey", "0", "the gate");
  await need(c, "door", "1", "the gate");
  await expect(need(c, "door", "0", "the gate")).rejects.toThrow(/^the gate: door is true, not 0 \(M stage 3 frame 12\)$/);
});

test("a global a step needs that is not set at all says unset", async () => {
  const { c } = ctx({ [global("gotkey")]: "", ...AT_STAGE });
  await expect(need(c, "gotkey", "1", "the gate")).rejects.toThrow(/^the gate: gotkey is unset, not 1 \(M stage 3 frame 12\)$/);
});

test("settling quiet waits for the room or a question; any other wait is the driver's", async () => {
  const { c, did } = ctx({});
  await settle(c, "the jab");
  await settle(c, "the jab", "taken");
  expect(did).toEqual(["hold SETTLED (the jab to settle)", "settle taken (the jab)"]);
});

test("a region not on the flat is refused with the regions there are, or none", async () => {
  const found = ctx({ [REGION_POINT("door")]: { x: 5, y: 6 } });
  expect(await regionPoint(found.c, "door")).toEqual({ x: 5, y: 6 });

  const some = ctx({ [REGION_POINT("door")]: null, [REGIONS]: ["left", "right"], ...AT_STAGE });
  await expect(regionPoint(some.c, "door")).rejects.toThrow(/^no region "door" to click on M stage 3 frame 12: left, right$/);
  const none = ctx({ [REGION_POINT("door")]: null, [REGIONS]: [], ...AT_STAGE });
  await expect(regionPoint(none.c, "door")).rejects.toThrow(/: \(none\)$/);

  const mid = ctx({ [REGION_MID("door")]: null, ...AT_STAGE });
  await expect(regionMid(mid.c, "door")).rejects.toThrow(/^no region door on M stage 3 frame 12$/);
});

test("a prop not on screen is refused with the props there are, or none", async () => {
  const found = ctx({ [PROP_HITS("bow", 4)]: [[1, 2]] });
  expect(await propHits(found.c, "bow", 4)).toEqual([[1, 2]]);

  const some = ctx({ [PROP_HITS("bow", 4)]: [], [PROPS_ON_SCREEN]: ["arrow", "spire"], ...AT_STAGE });
  await expect(propHits(some.c, "bow", 4)).rejects.toThrow(/^no prop "bow" on M stage 3 frame 12: arrow, spire$/);
  const none = ctx({ [PROP_HITS("bow", 4)]: [], [PROPS_ON_SCREEN]: [], ...AT_STAGE });
  await expect(propHits(none.c, "bow", 4)).rejects.toThrow(/: \(none\)$/);
});

test("a verb's number is read from its arguments, and a missing or wordy one is refused", () => {
  const { c } = ctx({}, { args: ["12", "north"] });
  expect(num(c, 0, "the row")).toBe(12);
  expect(() => num(c, 1, "the row")).toThrow(/^glyphs wants a number for the row, not "north"$/);
  expect(() => num(c, 2, "the column")).toThrow(/^glyphs wants a number for the column, not ""$/);
});

test("the hand is moved without pressing only by a driver that can", async () => {
  await expect(hover(ctx({}).c, { x: 1, y: 2 })).rejects.toThrow(/^this driver cannot move the hand without pressing$/);
  const can = ctx({}, { hover: true });
  await hover(can.c, { x: 1, y: 2 });
  expect(can.did).toEqual(["hover 1,2"]);
});
