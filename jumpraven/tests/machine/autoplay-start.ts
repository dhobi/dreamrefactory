/**
 * The page's autoplay (`?autoplay`, src/main.ts) from the high scores screen:
 * the player (src/player.ts) with `playsOnce` waits for the bar to be up and
 * no dialog asking, presses PLAY once — through the page's own door, on its
 * beat of 30 ticks — and the game is day one's story; it does not press it
 * again when the game comes back to the screen.
 *
 *   npm test -w jumpraven -- autoplay-start
 */
import { test } from "vitest";
import { Player } from "../../src/player";
import { fail, haveRip, ok, pass, start } from "./harness";

test.skipIf(!haveRip())("autoplay-start", async () => {
  let answer: ((name: string | null) => void) | null = null;
  const { game, m, input } = start({
    start: { level: 1, records: { score: 9_999_999 } },
    // the high score's name dialog stays up until the test answers it
    askName: (done) => void (answer = done),
  });
  const player = Object.assign(new Player(game, input), { playsOnce: true });
  /** the page's loop: the player's hands, then the tick */
  const play = (what: string, done: () => boolean, limit = 20_000): void => {
    for (let i = 0; i < limit && !done(); i++) {
      player.step();
      game.tick();
    }
    if (!done()) fail(`${what}: not after ${limit} ticks (${game.phase})`);
  };
  const step = (): void => {
    player.step();
    game.tick();
  };
  play("the name asked for", () => answer !== null);
  for (let i = 0; i < 90; i++) step();
  if (game.phase !== "scores" || !player.playsOnce) fail("PLAY was pressed while the name dialog was up");
  ok("the high score's dialog up: no PLAY");
  answer!(null);
  play("day one's story", () => game.level === 2 && game.phase === "story");
  if (player.playsOnce) fail("playsOnce still set after PLAY");
  const phase = (): string => game.phase;
  if (phase() !== "story") fail(`after PLAY: ${phase()}`);
  ok(`PLAY pressed once the bar was up: day one at tick ${m.ticks}`);
  pass("autoplay-start");
});
