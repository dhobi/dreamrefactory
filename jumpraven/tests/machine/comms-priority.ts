/**
 * The comms box's lines asked for while one plays (RAVEN.EXE 0x4142b9, the
 * priority tables 0x431b20 and 0x431bb4): a pilot's line no more urgent than
 * the one playing, or the same line again, is dropped, a more urgent one cuts
 * in; the fuel station's, the dealer's and the repair bay's lines the same by
 * their own table (the dealer's here), and only while it is their head in the
 * box; the enemy's taunts only over the pilot.
 *
 *   npm test -w jumpraven -- comms-priority
 */
import { test } from "vitest";
import { ENEMY, DEALER, PILOT } from "../../src/game/core/comms";
import { fail, haveRip, ok, pass, start } from "./harness";

test.skipIf(!haveRip())("comms-priority", async () => {
  const { game, until } = start({ start: { level: 3 } });
  until("the flight", () => game.world !== null);
  const c = game.comms;
  /** asked, and started within a few frames */
  const takes = (who: number, line: number, what: string): void => {
    const n = c.spoken.length;
    c.ask(who, line);
    until(what, () => c.spoken.slice(n).includes(`${who}:${line}`) && c.keyframe() >= 0, 300);
  };
  /** asked while another plays, and never started */
  const drops = (who: number, line: number, what: string): void => {
    const n = c.spoken.length;
    c.ask(who, line);
    for (let i = 0; i < 20; i++) game.tick();
    if (c.spoken.slice(n).includes(`${who}:${line}`)) fail(what);
  };
  // the pilot's head in the box, and quiet (the flight opens with the dealer's greeting, then the pilot's)
  until("the pilot's head, quiet", () => c.keyframe() < 0 && !!c.spoken.at(-1)?.startsWith(`${PILOT}:`), 5_000);

  // the pilot: 0x13 (500) playing; 0x12 (1000) cuts in; then 0x13, under it, and 0x12 again are dropped
  takes(PILOT, 0x13, "the pilot's 0x13");
  takes(PILOT, 0x12, "the pilot's 0x12 (1000) cutting in over 0x13 (500)");
  drops(PILOT, 0x13, "the pilot's 0x13 (500) started over 0x12 (1000)");
  drops(PILOT, 0x12, "the pilot's 0x12 started again over itself");
  ok("the pilot: a more urgent line cuts in; a less urgent one, or the same one, is dropped");

  // the dealer: 9 (800); 4 (500) and 9 again dropped, 15 (1000) cuts in
  until("the box quiet", () => c.keyframe() < 0, 5_000);
  takes(DEALER, 9, "the dealer's 9");
  drops(DEALER, 4, "the dealer's 4 (500) started over its 9 (800)");
  drops(DEALER, 9, "the dealer's 9 started again over itself");
  // neither the enemy nor the pilot over the dealer's head
  drops(ENEMY, 1, "the enemy's taunt started over the dealer");
  drops(PILOT, 0x12, "the pilot's 0x12 started over the dealer");
  takes(DEALER, 15, "the dealer's 15 (1000) cutting in over its 9 (800)");
  ok("the dealer: by its own table; neither the enemy nor the pilot over its head");
  pass("comms-priority");
});
