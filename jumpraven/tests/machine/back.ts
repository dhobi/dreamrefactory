/**
 * The way back from a flight (RAVEN.EXE 0x426124, levels 4 and 8): the drop,
 * the briefings, the damage screen, the debrief — `bata.pupp` for an accuracy
 * of 60% or better and its LEVEL BONUS, `batb.pupp` under it — and then the
 * next day's briefings, or for a Training game `training.move` and the high
 * scores. Each run opens its level straight away with the flying's tally made
 * up (JumpRavenOptions.start), so the way back is played without the flight.
 *
 *   npx tsx tests/machine/back.ts        (from jumpraven/)
 */
import { newTally } from "../../src/game/records";
import { fail, ok, pass, start } from "./harness";

/** press CONTINUE at (329, 8) on a screen with one */
const cont = (click: (x: number, y: number) => void) => click(8 + 50, 329 + 16);

// Intermediate, 3 of 4 hits: 75%, a bonus
{
  const tally = newTally();
  tally.shots[0] = 4;
  tally.hits[0] = 3;
  tally.kills.tank = 2;
  const { game, m, until, click, key } = start({ start: { level: 4, records: { tally } } });
  until("drop.move", () => m.film === "drop.move");
  const score = game.records.score;
  key("Escape");
  until("batg", () => game.talkState.talk?.file === "DAY2/BATG.PUP");
  key("Escape");
  until("anim.move", () => m.film === "anim.move");
  key("Escape");
  until("bate", () => game.talkState.talk?.file === "DAY2/BATE.PUP");
  key("Escape");
  until("the damage", () => game.screen === "damage");
  cont(click);
  until("the debrief", () => game.talkState.talk !== null);
  if (game.talkState.talk!.file !== "DAY2/BATA.PUP") fail(`75% gets ${game.talkState.talk!.file}, not BATA`);
  key("Escape");
  until("the accuracy", () => game.screen === "accuracy");
  cont(click);
  until("the next day's first briefing", () => game.talkState.talk?.file === "DAY2/BAT1.PUP");
  if (game.records.score !== score + 1000) fail(`score ${game.records.score} after the bonus, not ${score + 1000}`);
  ok(`75% accuracy: bata.pupp and the bonus (${score} → ${game.records.score}), then DAY2/BAT1.PUP`);
}

// Intermediate, nothing fired: batb, no bonus
{
  const { game, m, until, click, key } = start({ start: { level: 4 } });
  const skip = () => (m.film || game.talkState.talk) && key("Escape");
  until("the damage", () => (skip(), game.screen === "damage"));
  const score = game.records.score;
  cont(click);
  until("the debrief", () => game.talkState.talk !== null);
  if (game.talkState.talk!.file !== "DAY2/BATB.PUP") fail(`0% gets ${game.talkState.talk!.file}, not BATB`);
  key("Escape");
  until("the accuracy", () => game.screen === "accuracy");
  cont(click);
  until("the next day's first briefing", () => game.talkState.talk?.file === "DAY2/BAT1.PUP");
  if (game.records.score !== score) fail(`score ${game.records.score} with no bonus, not ${score}`);
  ok("0% accuracy: batb.pupp, no bonus");
}

// Training: the game is over after the first day
{
  const { game, m, until, click, key } = start({ start: { level: 4, difficulty: 1 } });
  const skip = () => (m.film || game.talkState.talk) && key("Escape");
  until("the damage", () => (skip(), game.screen === "damage"));
  cont(click);
  until("the accuracy", () => (skip(), game.screen === "accuracy"));
  cont(click);
  until("training.move", () => m.film === "training.move");
  key("Escape");
  until("the high scores", () => game.phase === "scores");
  ok("Training: training.move after the first day, then the high scores");
}
pass("back");
