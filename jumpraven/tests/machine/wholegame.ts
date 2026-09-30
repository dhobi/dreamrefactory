/**
 * The whole game, chained (RAVEN.EXE 0x40f936 … 0x4268b3): a run with nothing
 * to open, the intro to the high scores, PLAY, and then day one's briefings,
 * its flight, the way back, days two and three the same, and the pilot's own
 * ending (`trans<n>.move`) back to the high scores — nothing opened straight
 * at a level.
 *
 * Films and briefings are skipped as Esc skips them, each screen between the
 * briefings is left by its CONTINUE, and each flight is flown by the copilot
 * with flyday.ts's two shortcuts (PODS one pod from empty, the boss weak).
 *
 *   npm test -w jumpraven -- wholegame
 */
import { test } from "vitest";
import { SCORE_BUTTONS } from "../../src/game/data";
import type { World } from "../../src/game/combat/world";
import { UP } from "../../src/game/flight";
import { fail, ok, pass, start, haveRip } from "./harness";

test.skipIf(!haveRip())("wholegame", async () => {
  const { game, m, until, click, key } = start();

  /** one step of the player's hands: skip what plays, CONTINUE what waits, set up a new flight */
  let flown: World | null = null;
  const flights: number[] = [];
  /**
   * The copilot waits a cell short of the beacon while the boss is up (0x406361)
   * — on the diagonal that is out of the boss's street, where neither sees the
   * other. The step on into its street is put in the move queue as the
   * copilot's own steps are (the keys are the copilot's while it navigates),
   * and the copilot turns to the boss.
   */
  let waited = "";
  const stepToBoss = (w: World): void => {
    const c = w.cam;
    const b = game.hudState.beacon;
    const at = `${c.cellX},${c.cellY},${c.angle}`;
    const diagonal = Math.abs(c.cellX - b.cellX) === 1 && Math.abs(c.cellY - b.cellY) === 1;
    const [ax, ay] = [[1, 0], [0, 1], [-1, 0], [0, -1]][c.angle >> 6];
    const intoItsStreet = c.cellX + ax === b.cellX || c.cellY + ay === b.cellY;
    if (w.state === 2 && w.boss.up() && diagonal && at === waited && intoItsStreet && !w.solid(c.cellX + ax, c.cellY + ay)) game.flight!.queue = [UP];
    waited = at;
  };
  const hands = (): void => {
    const w = game.world;
    if (w && w !== flown) {
      flown = w;
      flights.push(game.level);
      (w as { params: typeof w.params }).params = { ...w.params, x43cfbe: 0x100 };
      Object.assign(game.hudState, { nav: 1, hover: 1, arms: 1 });
      game.records.bars[1] = Math.min(game.records.bars[1], 0x258);
    }
    if (w && m.ticks % 600 === 0) stepToBoss(w);
    if (m.ticks % 30 !== 0) return;
    if (game.screen) click(8 + 50, 329 + 16);
    else if (!w && (m.film || game.talkState.talk)) key("Escape");
  };

  until("the high scores screen", () => (hands(), game.phase === "scores"));
  ok(`the opening to the high scores at tick ${m.ticks}: ${game.played.join(", ")}`);
  const play = SCORE_BUTTONS.find((b) => b.what === "play")!.rect;
  click((play[1] + play[3]) >> 1, (play[0] + play[2]) >> 1);
  until("PLAY", () => game.phase !== "scores");

  for (const level of [3, 5, 7]) {
    until(`level ${level}'s flight`, () => (hands(), game.world !== null && game.level === level), 400_000);
    ok(`day ${(level - 1) >> 1}'s briefings done, the flight at tick ${m.ticks}`);
    until(`level ${level} flown`, () => (hands(), game.level !== level), 200_000);
    if (game.level !== level + 1) fail(`level ${level}'s flight ended at level ${game.level}: lives ${game.records.lives}, ${game.played.slice(-6).join(" ")}`);
    const k = game.records.tally.kills;
    ok(`level ${level} flown by tick ${m.ticks}: lives ${game.records.lives}, cash ${game.records.score}, kills ${k.bike}/${k.jeep}/${k.copter}/${k.tank}`);
  }

  const ending = `trans${game.records.pilot + 1}.move`;
  until("the pilot's ending", () => (hands(), m.film === ending), 400_000);
  ok(`day three's way back and bath.pupp, then ${ending}`);
  until("the high scores again", () => (hands(), game.phase === "scores"));
  if (flights.join() !== "3,5,7") fail(`the flights were levels ${flights}, not 3,5,7`);
  ok(`the whole game in ${(m.ticks / 3600).toFixed(1)} min of game time, score ${game.records.score}`);
  pass("wholegame");
});
