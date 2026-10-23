/**
 * Where a carried thing may be let go (`dropSpotsIn`, `src/nav.ts`), read off
 * the thing's own `mousedown`, and the stage readers with no stage file to hand.
 *
 *   npx vitest run --project timelapse timelapse/tests/nav-drops.ts
 *
 * A carried thing's script tests the frame and then, inside, either a box of
 * the pointer's offsets, a named region of the flat, or nothing — anywhere on
 * that frame takes it — and only the arm before an `else` belongs to that frame.
 * Each shape is read here from a script written the way the decompiler writes
 * them. And a stage whose file is not served (a world on another disc) has no
 * scripts and an empty table, which is not remembered, so it is read for real
 * once the file arrives.
 */
import { expect, test } from "vitest";
import { dropSpotsIn, stageScripts, tableOf } from "../src/nav";

const MOUSEDOWN = `code mousedown (arg)
  if curframenum = 12
    if dx > 10 & dx < 40 & dy > 20 & dy < 60
      dropit ()
    endif
  else
    if curframenum = 30
      if pointinbutton (currentflat (), "altar", arg)
        dropit ()
      endif
    else
      if curframenum = 31
        dropit ()
      endif
    endif
  endif
endcode
code other ()
  if curframenum = 99
  endif
endcode`;

test("each frame of a carried thing's mousedown is a box, a region, or anywhere", () => {
  expect(dropSpotsIn(MOUSEDOWN)).toEqual([
    { frame: 12, box: [10, 20, 40, 60], region: undefined },
    { frame: 30, box: undefined, region: "altar" },
    { frame: 31, box: undefined, region: undefined },
  ]);
});

test("a stage with no file to hand has no scripts and an empty table, and is read again later", () => {
  let served: Uint8Array | null = null;
  const file = (): Uint8Array | null => served;
  expect(stageScripts(file, "M", 5)).toEqual([]);
  const first = tableOf(file, "M", 5);
  expect(first.size).toBe(0);
  // not remembered: the next ask is a new table
  expect(tableOf(file, "M", 5)).not.toBe(first);
});
