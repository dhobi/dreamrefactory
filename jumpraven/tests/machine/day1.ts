/**
 * Day one's flight (level 3) to its end, flown by the copilot (flyday.ts).
 *
 *   npm test -w jumpraven -- day1
 */
import { test } from "vitest";
import { flyDay } from "./flyday";
import { pass, haveRip } from "./harness";

test.skipIf(!haveRip())("day1", async () => {
  flyDay(3);
  pass("day1");
});
