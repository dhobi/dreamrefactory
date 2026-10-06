/**
 * A contributed sheet's header (engine/src/web/speedrun/sheet-header.ts): the
 * title on line 1, everything else optional.
 */
import { expect, test } from "vitest";
import { readSheetHeader, sheetSeed } from "../src/web/speedrun/sheet-header";
import type { Step } from "../src/web/speedrun/sheet";

test("the title on line 1 is all a sheet needs", () => {
  expect(readSheetHeader("# title: Any% — seed 360\nreset(seed: 360)\n")).toEqual({
    header: { title: "Any% — seed 360" },
  });
});

test("the optional keys come from the comment block before the first action", () => {
  const text = "# title: Glitchless\n# author: mischlern\n#\n# edition: de\n# STATUS: prose, not a key\n# notes: no clips\nup\n# author: too late\n";
  expect(readSheetHeader(text)).toEqual({
    header: { title: "Glitchless", author: "mischlern", notes: "no clips" },
  });
});

test("a title anywhere but line 1 is refused, and so is none", () => {
  expect(readSheetHeader("# author: me\n# title: Late\nup\n")).toHaveProperty("error");
  expect(readSheetHeader("\n# title: Late\nup\n")).toHaveProperty("error");
  expect(readSheetHeader("up\n")).toHaveProperty("error");
});

test("a byte-order mark in front of line 1 is not part of it", () => {
  expect(readSheetHeader("\uFEFF# title: Saved by Notepad\nup\n")).toEqual({
    header: { title: "Saved by Notepad" },
  });
});

test("the seed is the one reset(seed:) pins, or none", () => {
  const step = (verb: string, opts: Record<string, string> = {}): Step => ({ verb, args: [], opts, repeat: 1, line: 1, source: verb });
  expect(sheetSeed([step("reset", { seed: "360" }), step("up")])).toBe(360);
  expect(sheetSeed([step("reset"), step("up")])).toBeNull();
});
