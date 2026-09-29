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
import { PRICES, cell } from "../../src/game/mart";
import { PILOTS, portrait } from "../../src/game/pilots";
import { bandRect } from "../../src/game/music";
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
until("the Mart", () => game.mart !== null);
const mart = game.mart!;
const outOfStock = mart.stock.map((row) => row.filter((s) => !s).length);
if (outOfStock.join() !== "0,1,2,3") fail(`the Mart's stock is out by tier ${outOfStock}, not 0,1,2,3`);
ok(`the Mart: 1000 cash, out of stock by tier ${outOfStock}`);
// a second-tier laser, if the Mart has one, or the first kind in stock there
const kind = mart.stock[1].findIndex((s) => s);
const [ct, cl, cb, cr] = cell(1, kind);
click((cl + cr) >> 1, (ct + cb) >> 1);
until("the selection", () => game.mart?.selected?.tier === 1);
// BUY is picture 1's rect: at its anchor on the left panel, (261, 8), 107 by 32
click(8 + 50, 261 + 16);
until("the purchase", () => game.records.ammo[kind] > 0);
const cash = 1000 - PRICES[kind][1];
if (game.records.score !== cash) fail(`cash ${game.records.score} after a ${PRICES[kind][1]} weapon, not ${cash}`);
ok(`BUY: kind ${kind} tier 1 for ${PRICES[kind][1]}, cash ${game.records.score}`);
// CONTINUE: (329, 8)
click(8 + 50, 329 + 16);
until("out of the Mart", () => game.mart === null);
ok(`CONTINUE, the dealer's lines: ${game.comms.spoken.join(" ")}`);
until("bat3", () => game.talkState.talk?.file === "DAY1/BAT3.PUP");
key("Escape");
until("the pilots", () => game.screen === "pilots");
const here = game.pilots!.here;
if (here.filter((h) => !h).length !== 2) fail(`${here.filter((h) => !h).length} pilots away on Intermediate's first day, not 2`);
const pick = here.lastIndexOf(true);
const [pt, pl, pb, pr] = portrait(pick);
click((pl + pr) >> 1, (pt + pb) >> 1);
until("the pick", () => game.records.pilot === pick);
// CONTINUE: (329, 8)
click(8 + 60, 329 + 16);
until("out of the pilots", () => game.screen !== "pilots");
until("the pilot's head in the comms box", () => game.comms.headFile(0)?.endsWith(`${PILOTS[pick].toUpperCase()}.MUP`) ?? false);
ok(`COPILOT SELECTION: ${PILOTS[pick]}, with ${here.map((h, k) => (h ? "" : PILOTS[k])).filter(Boolean).join(" and ")} away; the comms box has ${game.comms.headFile(0)}`);
until("bat4", () => game.talkState.talk?.file === "DAY1/BAT4.PUP");
key("Escape");
until("the music", () => game.screen === "music");
const [mt, ml, mb, mr] = bandRect(2);
click((ml + mr) >> 1, (mt + mb) >> 1);
until("the band", () => game.band.value === 2);
click(8 + 50, 329 + 16);
until("out of the music", () => game.screen !== "music");
ok("the music: band 2, flannel");
until("bat5", () => game.talkState.talk?.file === "DAY1/BAT5.PUP");
key("Escape");
until("trans.move", () => m.film === "trans.move");
key("Escape");
until("the flying", () => game.phase === "not-ported");
if (!/the flying, day 1/.test(game.stopped)) fail(`stopped at the wrong place: ${game.stopped}`);
ok(`day one's briefings done in ${(m.ticks / 60).toFixed(0)} s of game time: ${game.played.join(", ")}`);
ok(`stops where the port ends: ${game.stopped}`);
pass("opening");
