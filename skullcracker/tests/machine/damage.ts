/**
 * The switch that lets things hit back — off unless you ask for it.
 *
 *   npx tsx tests/machine/damage.ts        (from skullcracker/)
 *
 * Everything under test here is `SC.EXE`'s, and none of it runs by default. The
 * reason is the other suites: with damage on, walking east through WOODS means
 * three hydraulic presses, and a route test becomes a fight. So it ships ready
 * and dark behind `?damage=1` and the page's Shift+H.
 *
 * What the file says, and what this checks:
 *
 *   - **twelve hundred at the middle difficulty.** `0x448ac2`:
 *     `trunc(difficulty * 600.0) + 0x4b0`, so 1800 / 1200 / 600.
 *   - **the damage IS the blow.** `0x4490d5` takes `0x42f910` of the hitter —
 *     the root of its cel's own blow pair — and `0x449209` spends exactly that.
 *     A hydraulic press carries `(dx 64, dy 5)` on cels 4382 and 4383, which is
 *     64, and 64 is over the one threshold there is.
 *   - **`cmp di, 0x3c`** at `0x449115`: sixty or less staggers, more knocks down.
 *   - **the reaction cels have no body box**, which is the whole of this engine's
 *     invulnerability — `0x4303b3` skips a victim whose current cel has none.
 *   - **the life is spent when the dying animation ends**, not when the health
 *     runs out (`0x443dea`).
 */
import { WEAPONS } from "../../src/guns";
import { fail, headless, ok, pass } from "./harness";

// the presses alone: a punk that walks up shoves the player out from under one
const h = await headless("level=3&x=7171&foes=0");
const { game } = h;
const { p, stats, inv } = game;
const go = async (x: number, damage: boolean): Promise<void> => {
  await h.load(`level=3&x=${x}&foes=0${damage ? "&damage=1" : ""}`);
  h.frame(10);
};

// 1. off by default, and it stays off standing in the worst place in the level
h.frame(10);
if (game.damageOn) fail(`the switch should start off`);
h.frame(75);
if (game.damageOn) fail(`it should still be off after five seconds under a press`);
if (stats.health !== stats.maxHealth) fail(`with the switch off a press took health: ${stats.health}/${stats.maxHealth}`);
ok(`the switch starts off, and five seconds under a press cannot touch the player`);

// 2. the page's Shift+H is `setDamageOn(!damageOn)`, at the engine's own figure.
//    (The shift is the page's: plain `h` is the first letter of `harakari`, and
//    `0x403c1b` feeds every lowercase letter to the cheat accumulator first.)
game.setDamageOn(true);
if (!game.damageOn) fail(`the switch did not throw`);
if (stats.maxHealth !== 1200) fail(`0x448ac2 gives 1200 at the middle difficulty; the player has ${stats.maxHealth}`);
ok(`thrown, the player has ${stats.maxHealth} health`);

// 3. ...and so does the query, which is what the other suites would use
await go(7100, true);
if (!game.damageOn || stats.health !== 1200 || stats.maxHealth !== 1200)
  fail(`?damage=1 should arm it full: ${game.damageOn} ${stats.health}/${stats.maxHealth}`);
ok(`and ?damage=1 arms it the same way, 1200/1200`);

// 4. the press lands for exactly the 64 its cels carry, and knocks the player
//    down rather than staggering him, because 64 is over the threshold
h.hold("right", true);
const seen = new Set<number>();
let after = 1200;
for (let i = 0; i < 108; i++) {
  h.frame();
  after = Math.min(after, stats.health);
  seen.add(game.lastCel);
}
h.hold("right", false);
if (after >= 1200) fail(`walking under three presses should cost health; still ${after}`);
if ((1200 - after) % 64 !== 0) fail(`a press costs 64 a time; the player lost ${1200 - after}`);
// 940..949 is `0x4722a8` tag 2, the knockdown taken from behind — CHARACTER
// 0's, which is the player this runs. It read 5940..5944 before, which is
// character 1's `0x476890`; see `src/codes.ts` for the two of them.
const downs = [900, 901, 902, 903, 940, 943, 944, 946, 947, 948, 949].filter((c) => seen.has(c));
if (!downs.length)
  fail(`64 is over 0x3c, so it should knock down, not stagger; saw ${[...seen].filter((c) => c < 1000).join(" ")}`);
ok(`a press takes ${1200 - after} in 64s and knocks the player down (cels ${downs.join(" ")})`);

// 5. run out of it and a life goes — and NO film, because the film is the last
//    life's. `0x4294a6` reads the count, `0x4294ad` spends one and `0x4294b7`
//    takes the ordinary path while the count before the spend was not
//    negative, so `0x403340`'s vignette is reached only when there is nothing
//    left. Standing under a press is about twenty strokes.
const films: string[] = [];
const film = game.ui.film;
game.ui.film = async (name) => {
  films.push(name);
  await film(name);
};
await go(7171, true);
const began = stats.lives;
const took = h.until(() => stats.lives < began, 1000);
if (took < 0) fail(`standing under a press should eventually cost a life; still ${stats.lives} of ${began}`);
if (films.length) fail(`the KILL film is the last life's — 0x4294b7 — and this was the first of ${began}: ${films.join(" ")}`);
ok(`and running out of it spends a life, ${began} down to ${stats.lives} after ${took} frames, with no film`);
// ...and the red runs out before the checkpoint (`0x429392`, see game.deathRed)
if (h.until(() => !game.deathRed, 200) < 0) fail(`the red after the death never ended`);

// 6. ...and a knockdown takes the gun out of your hands. `0x44911b` asks
//    `0x448bf0` whether the player is one of the five armed kinds, and if it
//    is, `0x45b060` throws the weapon on the floor — the same spawn reaching
//    for a second gun makes — clears `[0x479438]` and redraws the panel. The
//    other player class carries its own copy at `0x42ec07`.
//
//    WOODS is the level that can prove it: its `statflamer` stands at x6980
//    and its three hydraulic presses are two hundred pixels east, and a press
//    is the 64 that step 4 already measured — over `0x3c` by four.
await go(6950, true);
h.hold("down", true);
h.frame(14);
h.hold("down", false);
h.frame(6);
if (!inv.armed || WEAPONS[inv.weapon]?.name !== "flamer")
  fail(`the probe should be armed with the flamer before the press: ${inv.armed} ${WEAPONS[inv.weapon]?.name}`);
const guns = game.hereOf((l) => l.guns).length;
h.hold("right", true);
const dropped = h.until(() => !inv.armed, 120);
h.hold("right", false);
if (dropped < 0) fail(`a press is 64, and 64 knocks down; the flamer stayed in hand at x ${p.x}`);
if (WEAPONS[inv.weapon]?.name !== "flamer") fail(`the weapon record should still be the flamer, only unarmed`);
const lying = game.hereOf((l) => l.guns).length;
if (lying <= guns) fail(`0x45b060 puts the weapon on the FLOOR; the level still holds ${lying} guns against ${guns}`);
ok(`a knockdown disarms: the flamer left the hand and the level went from ${guns} guns to ${lying}`);

// 7. ...and the death drops every key. `0x402ac0` empties the health into
//    `0x402fa0(1)`, whose first call is `0x402df0`: the eight action words
//    zeroed, so a key held as the player dies is let go
h.hold("right", true);
h.press("punch");
game.takeHealth(stats.health);
if (game.held.right || game.punchPressed || p.act !== "dying")
  fail(`dying drops the keys (0x402af4 -> 0x402df0): right ${game.held.right}, punch ${game.punchPressed}, ${p.act}`);
ok(`dying lets go of every key held`);

pass("the damage switch is off by default, and the engine's own numbers when it is not");
