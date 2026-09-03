/**
 * A path written short — `move(u,r,u,o)`
 * ([#250](https://github.com/dhobi/dreamrefactory/issues/250)).
 *
 *   npx vitest run taoot/tests/auto/speedrun-move.ts
 *
 * Twenty-one lines of `up()` and `right()` is what a corridor looks like in a
 * sheet, and the one from the F deck stairs to the turbine room appears four
 * times. None of those lines is tuned or ever will be — they are the way there.
 *
 * What is pinned here is that the short form is not a NEW kind of thing: a
 * `move` line is expanded by the parser into the ordinary actions it names, so
 * everything downstream — the report's rows, the pointer's `skip`, the sheet's
 * own summary, a failure naming the action rather than the line — carries on
 * working without having been told. The alternative was a verb that looped
 * inside its own `run`, which would have been one row in the report for
 * twenty-one presses and no way to pause between two of them.
 */
import { test, expect } from "vitest";
import { parseSheet, describeSheet } from "@dreamfactory/engine/web/speedrun/sheet";
import { VERBS, resolve } from "../../src/speedrun/actions";
import { pointerAt, stepsFrom } from "@dreamfactory/engine/web/speedrun/runner";

const parse = (text: string) => parseSheet(text, { verbs: VERBS });
/** the verbs a sheet's actions turn out to be, in order */
const verbs = (text: string) => parse(text).map((s) => s.verb);

test("a path is the actions it names, in order (#250)", () => {
  expect(verbs("move(u,r,u,l,d,o)")).toEqual(["up", "right", "up", "left", "down", "door"]);
});

test("the commas are grouping, so a run of letters is the same path (#250)", () => {
  // `move(o, ururururur, o)` is the corridor with its doors, and reads like one
  expect(verbs("move(uru)")).toEqual(verbs("move(u,r,u)"));
  expect(verbs("move(o,urur,o)")).toEqual(["door", "up", "right", "up", "right", "door"]);
});

test("xN repeats the whole path, not each step of it (#250)", () => {
  expect(verbs("move(u,r,x2)")).toEqual(["up", "right", "up", "right"]);
  // and the other route is still sayable, which is why this is the right way round
  expect(verbs("move(uu,rr)")).toEqual(["up", "up", "right", "right"]);
});

test("every move on the line carries the line's options (#250)", () => {
  const steps = parse("move(u,o, wait: none, confirm: no)");
  expect(steps.map((s) => s.opts)).toEqual([
    { wait: "none", confirm: "no" },
    { wait: "none", confirm: "no" },
  ]);
});

test("the line's comment is the line's, and is echoed once (#250)", () => {
  const steps = parse("move(u,r,u)   # down to the turbine room");
  expect(steps.map((s) => s.note)).toEqual(["down to the turbine room", undefined, undefined]);
});

test("a letter nobody defined is refused at parse, not at minute nineteen (#250)", () => {
  // the whole reason this is a parser hook: `--lint` catches it, and a typo in a
  // path cannot cost a twenty-minute run
  expect(() => parse("move(u,r,z)")).toThrow(/move has no "z"/);
  // ...and a plausible mistake gets told what it wrote as well as what to write
  expect(() => parse("move(up,right)")).toThrow(/move has no "p" \(in "up"\)/);
  expect(() => parse("move(u,r,z)")).toThrow(/l\(eft\), r\(ight\), u\(p\), d\(own\) and o\(pen a door\)/);
  expect(() => parse("move()")).toThrow(/move takes 1 or more arguments/);
});

test("an expanded path is ordinary actions on one line (#250)", () => {
  const steps = parse("door()\nmove(u,r,u)\nleft()");
  // one line, three actions — the shape `left(); up(); left()` already had
  expect(steps.filter((s) => s.line === 2)).toHaveLength(3);
  for (const s of steps) expect(resolve(s.verb)).toBeTruthy();
  // and each is written as what it will do, so the report and its failures name
  // the action rather than the line it was on the end of
  expect(steps.map((s) => s.source)).toEqual(["door()", "up()", "right()", "up()", "left()"]);
});

test("a Pause lands between two moves of a path (#250)", () => {
  const steps = parse("move(u,r,u)\nleft()");
  // the pointer names a place in the TEXT plus how many of that line's actions
  // are already done — which is what makes a path resumable in the middle
  expect(pointerAt(steps, 1)).toEqual({ line: 1, skip: 1 });
  expect(stepsFrom(steps, { line: 1, skip: 2 }).map((s) => s.verb)).toEqual(["up", "left"]);
});

test("the sheet's own summary counts the moves, not the lines (#250)", () => {
  // a run that says `move(o,ururur,o)` has not become a shorter run
  expect(describeSheet(parse("move(o,ururur,o)"))).toBe("8 actions (8 gestures) over 1 split");
  expect(describeSheet(parse("door()\nup()"))).toBe("2 actions (2 gestures) over 1 split");
});

test("every verb's grammar reaches the parser, whatever it is (#250)", () => {
  // `expand` was declared, tested and silently ignored, because the parser's
  // copy of the verb table was built by NAMING the grammar fields. It is built
  // by dropping the execution ones now, and this is what says so: a field added
  // to VerbSpec is a field the parser gets, without a second edit nobody will
  // think of.
  for (const [name, spec] of Object.entries(VERBS)) {
    const action = resolve(name)! as unknown as Record<string, unknown>;
    for (const [field, value] of Object.entries(action)) {
      if (field === "run" || field === "wait" || field === "interruptible") continue;
      expect((spec as unknown as Record<string, unknown>)[field], `${name}.${field}`).toBe(value);
    }
  }
});

test("nothing can run a move, because nothing is ever handed one (#250)", async () => {
  await expect(resolve("move")!.run({} as never)).rejects.toThrow(/expanded when the sheet is parsed/);
});
