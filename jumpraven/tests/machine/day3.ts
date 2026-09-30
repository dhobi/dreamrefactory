/**
 * Day three's flight (level 7) to its end, flown by the copilot (flyday.ts).
 *
 *   npm test -w jumpraven -- day3
 */
import { test } from "vitest";
import { flyDay } from "./flyday";
import { pass, haveRip } from "./harness";

test.skipIf(!haveRip())("day3", async () => {
  flyDay(7);
  pass("day3");
});
