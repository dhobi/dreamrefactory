/**
 * Timelapse's speedrun verbs (`src/speedrun/actions.ts`, `anasazi.ts`) where
 * there is nothing for them to do, or nothing to do it with: `useOn` with a
 * thing whose script takes it on no frame here, `lever` already in place or
 * with no place on the flat to drag from, `take` on a close-up with nothing on
 * it but its ways out.
 *
 *   npx vitest run --project timelapse timelapse/tests/speedrun-refusals.ts
 *
 * Against a driver that answers each verb's own questions and nothing else, so
 * a refusal that reached for a gesture first would fail here. What a refusal
 * names — the frame and the frames it is taken on, the region and the flat — is
 * what a sheet's author fixes the line from.
 */
import { expect, test } from "vitest";
import type { ActionContext } from "@dreamfactory/speedrun/action";
import type { SpeedrunDriver } from "@dreamfactory/speedrun/driver";
import { parseSheet } from "@dreamfactory/speedrun/sheet";
import { WHERE, global } from "../src/speedrun/gestures";
import { VERBS, resolve } from "../src/speedrun/actions";

/** run a line against a driver answering by these tests, in order; the first that matches answers */
async function play(line: string, answers: [(expr: string) => boolean, unknown][]): Promise<void> {
  const d = {
    evaluate: async (expr: string) => {
      const hit = answers.find(([is]) => is(expr));
      if (!hit) throw new Error(`unexpected question: ${expr.slice(0, 60)}`);
      return hit[1];
    },
  } as unknown as SpeedrunDriver;
  const [step] = parseSheet(line, { verbs: VERBS });
  await resolve(step.verb)!.run({ d, step, wait: "quiet", budget: 1000 } as unknown as ActionContext);
}

const is = (want: string) => (expr: string) => expr === want;
const has = (part: string) => (expr: string) => expr.includes(part);

test("a thing with no script to read is let go on no frame, and says so", async () => {
  await expect(
    play("useOn(invlog)", [
      [is(WHERE), { world: "A", stage: 4, frame: 7 }],
      // the prop's script: there is no such prop in the room
      [has("scriptContainerLocation"), null],
    ]),
  ).rejects.toThrow(/^invlog cannot be let go on frame 7; its script takes it on no frame$/);
});

test("the lever already in its place is left alone, and one with no place to drag from says which", async () => {
  await play("lever(3)", [[is(global("leverpos")), "3"]]);
  await expect(
    play("lever(5)", [
      [is(global("leverpos")), "2"],
      [has("flatRegion("), null],
    ]),
  ).rejects.toThrow(/^no region POS2 on a0001\.157$/);
});

test("a close-up with nothing on it but its ways out has nothing to take", async () => {
  await expect(play("take()", [[has("currentFlatRegions()"), null]])).rejects.toThrow(/^nothing to take here$/);
});
