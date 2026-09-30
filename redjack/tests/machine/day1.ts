/**
 * Day one, played: Hangman's Reef at night, from the first room to the crate
 * that carries Nick onto the Marauder. The route is `days/day1.ts`, where the
 * later days start from too.
 *
 *   npm test -w redjack -- day1
 */
import { test } from "vitest";
import { headless, pass, haveRip } from "./harness";
import { playDay1 } from "./days/day1";

test.skipIf(!haveRip())("day1", async () => {
  await playDay1(await headless());
  pass("day1");
});
