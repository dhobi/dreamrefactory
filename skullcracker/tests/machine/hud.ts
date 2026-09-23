/**
 * Is the interface panel handed what `SC.EXE`'s panel shows?
 *
 *   npx tsx tests/machine/hud.ts        (from skullcracker/)
 *
 * The panel is `skullcracker/src/hud.ts`, and its module comment carries the
 * addresses every coordinate came out of. The DRAWING is the page's — `paintHud`
 * over a canvas — and whether pixels land where they should is a browser
 * question. What the game owes it is the state: `walk.ts` builds a `HudState`
 * out of `stats`, `aliveNow()`, `buttonMask()`, `inv` and `PREFS` every frame,
 * and this asserts that each of those says what the panel is meant to show —
 * the two bars, the quota, a held key's light, Ctrl+P's window, a landed blow
 * draining the bar its owner claimed and paying for the kill, and the eight
 * labels typeset out of the key map.
 */
import { BUTTONS, CLOCK, WINDOW, buttonBit } from "../../src/hud";
import { PREFS_ACTIONS, keyName, loadPrefs } from "../../src/prefs";
import { fail, headless, memoryStorage, ok, pass } from "./harness";

const store = memoryStorage();
const h = await headless("level=1");
const { game } = h;
const { stats } = game;

// 1. both bars. The player's is his own health against his own maximum, and the
//    right-hand one is whoever `0x40d1c0` last let claim it.
if (stats.health !== stats.maxHealth || stats.maxHealth <= 0)
  fail(`the player's bar should open full: ${stats.health}/${stats.maxHealth}`);
h.frame(2);
if (!stats.shown) fail(`nothing claimed the enemy's bar on STREETS' first frames`);
if (stats.shown.health !== stats.shown.max || !stats.shown.nameCel)
  fail(`the enemy's bar should open full and plated: ${JSON.stringify(stats.shown)}`);
ok(`the bars are handed ${stats.health}/${stats.maxHealth} left and ${stats.shown.health}/${stats.shown.max} (plate ${stats.shown.nameCel}) right`);

// the lower band's own furniture: the kill quota's two numerals and the dial
const quota = Math.max(0, game.aliveNow() - stats.allowance);
if (quota !== 8) fail(`STREETS' quota is 8 of 11 at 75%; the panel would be handed ${quota}`);
if (!(stats.ticks > 0 && stats.ticks < CLOCK.noLimit)) fail(`STREETS has a clock; the panel is handed ${stats.ticks}`);
ok(`the lower band is handed a quota of ${quota} and ${stats.ticks} frames on the dial`);

// 2. Ctrl+P is a mode: `0x40e120` hands `0x430860` a 512x232 window with the
//    panel up and 512x342 without — the window grown down into the panel's space
if (game.viewH() !== WINDOW.h) fail(`with the panel up the level's window is ${game.viewH()} tall, not ${WINDOW.h}`);
game.setIface(false);
const full = game.viewH();
game.setIface(true);
if (full !== 0x156) fail(`with the panel down the window is ${full} tall, not 342 (0x156)`);
ok(`Ctrl+P is a mode: the window is ${WINDOW.h} tall with the panel and ${full} without`);

// 3. a held key lights its own light — the pad's arrow and the label both
const idle = game.buttonMask();
h.hold("right", true);
h.hold("kick", true);
h.frame(1);
const down = game.buttonMask();
h.hold("kick", false);
h.hold("right", false);
h.frame(10);
if (idle !== 0) fail(`standing still with nothing held lights ${idle.toString(2)}`);
if (!(down & buttonBit("right"))) fail(`holding right did not light the right arrow (${down.toString(2)})`);
if (!(down & buttonBit("kick"))) fail(`holding K did not light KICK (${down.toString(2)})`);
for (const b of BUTTONS)
  if (b.name !== "right" && b.name !== "kick" && b.name !== "jump" && down & buttonBit(b.name))
    fail(`holding right and K also lit ${b.name}`);
ok(`the buttons light: ${idle.toString(2).padStart(8, "0")} idle, ${down.toString(2).padStart(8, "0")} with right and K`);

// 4. a landed blow drains the bar its owner claimed, and pays for the kill.
//    Walking east through STREETS with the fist out meets the first punk at
//    x2197, and a punch is cel 602's own 47 against its 250 — so it takes six
//    of them, and the bar must read part full somewhere along the way.
const scoreBefore = stats.score;
let leanest = Infinity;
let steps = 0;
for (; steps < 40 && stats.score <= scoreBefore; steps++) {
  h.hold("right", true);
  h.frame(3);
  h.hold("right", false);
  // three swings per step: the strike box is the fist's own two dozen pixels
  // (SbkCel.strike), not the whole cel, so a blow has to be aimed
  for (let k = 0; k < 3; k++) {
    h.press("punch");
    h.frame(3);
    if (stats.shown) leanest = Math.min(leanest, stats.shown.health / stats.shown.max);
  }
}
if (!(leanest < 1)) fail(`the enemy's bar never drained (${leanest} of full at its leanest)`);
ok(`a blow drains the bar: ${Math.round(leanest * 100)}% of full at its leanest`);
if (stats.score <= scoreBefore) fail(`the score never moved in ${steps} steps — ${scoreBefore} before, ${stats.score} after`);
ok(`and a kill pays: the score went from ${scoreBefore} to ${stats.score} in ${steps} steps`);

// 5. the letters beside the eight buttons are TYPESET out of the key map, not
//    painted into the band. `0x40cf00` finishes by calling `0x40e870(action)`
//    for actions 1..8 and writing each name at its own point in `0x46bd58` —
//    so what the band says is whatever the preferences panel last bound, and a
//    panel with nothing bound says nothing. `walk.ts` hands it
//    `PREFS.keys.map(keyName)`.
const shipped = game.PREFS.keys.map((k) => keyName(k));
if (shipped.length !== 8 || shipped.some((n) => !n)) fail(`the shipped table names all eight; the panel would say ${JSON.stringify(shipped)}`);
if (shipped.join("") !== PREFS_ACTIONS.map((a) => keyName(a.fallback)).join(""))
  fail(`with nothing stored the labels should be 0x46b210's own: ${shipped.join(" ")}`);
ok(`the eight buttons are labelled ${shipped.join(" ")}`);

// ...and with nothing bound there is nothing to say
const bindAll = (keys: string[]): string[] => {
  store.set("skullcracker.prefs", JSON.stringify({ keys }));
  return loadPrefs().keys.map((k) => keyName(k));
};
const bare = bindAll(["", "", "", "", "", "", "", ""]);
if (bare.some((n) => n)) fail(`an unbound panel should name nothing: ${JSON.stringify(bare)}`);
ok(`...and an unbound panel says nothing`);

// ...and a rebinding changes what it says, which is the whole point of it
const rebound = bindAll(["M", "N", "O", "Q", "R", "T", "U", "V"]);
if (rebound.join("") !== "MNOQRTUV") fail(`rebinding all eight should label them MNOQRTUV; got ${rebound.join("")}`);
ok(`and rebinding changes it: ${rebound.join(" ")}`);
store.delete("skullcracker.prefs");

pass(`the panel is handed the game's own state`);
