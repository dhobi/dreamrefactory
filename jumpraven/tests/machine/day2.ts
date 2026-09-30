/**
 * Day two's flight (level 5) to its end, flown by the copilot (flyday.ts).
 *
 *   npm test -w jumpraven -- day2
 */
import { test } from "vitest";
import { flyDay } from "./flyday";
import { pass, haveRip } from "./harness";

test.skipIf(!haveRip())("day2", async () => {
  flyDay(5);
  pass("day2");
});
