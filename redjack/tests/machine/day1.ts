/**
 * Day one, played: Hangman's Reef at night, from the first room to the crate
 * that carries Nick onto the Marauder. The route is `days/day1.ts`, where the
 * later days start from too.
 *
 *   npx tsx tests/machine/day1.ts        (from redjack/)
 */
import { headless, pass } from "./harness";
import { playDay1 } from "./days/day1";

await playDay1(await headless());
pass("day1");
