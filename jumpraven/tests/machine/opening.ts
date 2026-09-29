/**
 * The opening and the high scores screen (RAVEN.EXE 0x40f936, 0x426124,
 * 0x420840): a run with nothing to open starts at level 0 — the intro, which
 * chains to the second intro, the first briefing (`bati.pupp`), the tutorial —
 * and goes to the high scores screen. HELP plays its film and comes back; PLAY
 * starts day one's briefings, which run until the first screen not ported yet.
 *
 *   npx tsx tests/machine/opening.ts        (from jumpraven/)
 */
import { SCORE_BUTTONS } from "../../src/game/data";
import { fail, ok, pass, start } from "./harness";

const { game, m, until, click, key } = start();
const centre = (what: string) => {
  const b = SCORE_BUTTONS.find((b) => b.what === what)!;
  return [(b.rect[1] + b.rect[3]) >> 1, (b.rect[0] + b.rect[2]) >> 1] as const;
};

until("the intro", () => game.played.includes("intro.move") && m.film === "intro2.move");
ok("the intro chains to intro2.move");
until("the first briefing", () => game.talkState.talk !== null);
ok(`the first briefing: ${game.talkState.talk!.file}`);
key("Escape");
until("the tutorial", () => m.film === "tutor.move");
ok("the tutorial");
until("the high scores screen", () => game.phase === "scores");
ok(`the high scores screen after ${(m.ticks / 60).toFixed(0)} s: ${game.played.join(", ")}`);

// HELP: its film, and the screen again
const [hx, hy] = centre("help");
click(hx, hy);
until("HELP's film", () => m.film === "help.move");
ok("HELP plays help.move");
key("Escape");
until("back from HELP", () => m.film === null && game.phase === "scores");
ok("and comes back to the high scores");

// PLAY: day one's briefings, as far as they are ported
const [px, py] = centre("play");
click(px, py);
until("bat1", () => game.talkState.talk?.file === "DAY1/BAT1.PUP");
ok("PLAY: day one's first briefing, DAY1/BAT1.PUP");
key("Escape");
until("the enemies' film", () => m.film === "enem.move");
ok("the enemies' film");
key("Escape");
until("bat2", () => game.talkState.talk?.file === "DAY1/BAT2.PUP");
key("Escape");
until("the Mart", () => game.phase === "not-ported");
if (!/the Mart/.test(game.stopped)) fail(`stopped at the wrong place: ${game.stopped}`);
ok(`stops where the port ends: ${game.stopped}`);
pass("opening");
