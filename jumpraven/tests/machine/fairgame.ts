/**
 * The whole game won with no shortcuts, on Intermediate: the intro to the high
 * scores, PLAY, three days and the pilot's ending — played by tests/machine/
 * player.ts through the page's own door, the copilot flying, every pod picked
 * up and every boss killed at full strength.
 *
 * Unlike wholegame.ts nothing is set in the game: the player shops, mends at
 * the repair bay, chooses its copilots and holds the last pod back until the
 * shields are up. It does not win every game — 8 of 32 seeds, measured
 * 2026-09-29 — so this one plays a seed it wins. A change that
 * moves the game's rolls can make that seed a loss without anything being
 * wrong; the lines below say where the lives went, which tells the two apart.
 *
 *   npx tsx tests/machine/fairgame.ts        (from jumpraven/)
 */
import { SCORE_BUTTONS } from "../../src/game/data";
import { PILOTS } from "../../src/game/pilots";
import { fail, ok, pass, start } from "./harness";
import { Player } from "./player";

const SEED = 7;
const { game, m, until, click, input } = start({ seed: SEED });
const player = new Player(game, input);

until("the high scores screen", () => (player.step(), game.phase === "scores"));
const play = SCORE_BUTTONS.find((b) => b.what === "play")!.rect;
click((play[1] + play[3]) >> 1, (play[0] + play[2]) >> 1);
until("PLAY", () => game.phase !== "scores");
ok(`seed ${SEED}: PLAY at tick ${m.ticks}`);

let lost = 0;
let lives = game.records.lives;
const step = (): void => {
  player.step();
  if (game.records.lives < lives) lost++;
  lives = game.records.lives;
};
for (const level of [3, 5, 7]) {
  until(`level ${level}'s flight`, () => (step(), game.world !== null && game.level === level), 2_000_000);
  until(`level ${level} flown`, () => (step(), game.level !== level), 2_000_000);
  if (game.level !== level + 1) fail(`day ${(level - 1) >> 1} lost at tick ${m.ticks}: ${lost} craft lost, copilots ${player.log.copilots.map((k) => PILOTS[k])}`);
  const k = game.records.tally.kills;
  ok(`day ${(level - 1) >> 1} won by tick ${m.ticks} with ${PILOTS[game.records.pilot]}: ${lost} craft lost so far, cash ${game.records.score}, kills ${k.bike}/${k.jeep}/${k.copter}/${k.tank}`);
}
const ending = `trans${game.records.pilot + 1}.move`;
until("the pilot's ending", () => (step(), m.film === ending), 400_000);
until("the high scores again", () => (step(), game.phase === "scores"));
ok(`${ending}, the high scores: the game won in ${(m.ticks / 3600).toFixed(1)} min of game time, score ${game.records.score}; bought ${player.log.bought.length} weapons, mended ${player.log.mended.length} times`);
pass("fairgame");
