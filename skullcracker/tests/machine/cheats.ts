/**
 * The eight words `SC.EXE` listens for while a level is running.
 *
 *   npx tsx tests/machine/cheats.ts        (from skullcracker/)
 *
 * `0x403ed0` is the whole recogniser and it is stranger than a cheat table
 * usually is: the accumulator is a nineteen-character ring, the index into it is
 * `[0x46b320]`, and the jump table at `0x404140` is indexed by HOW MANY
 * characters have been typed since the last pause — so there is exactly one
 * candidate word per length and the eight words are eight different lengths.
 * A gap of 0x28 ticks (two thirds of a second, `0x4087c0` being `ms * 3 / 50`)
 * forgets what you were typing — ten engine frames.
 *
 * What each match does is read at the other end of the call, and two of them are
 * not what this port had them down as:
 *
 *   - **`jetson` is TIME.** `0x40d350`'s argument is signed: positive sets
 *     `[0x4a4d68]` and negative adds to it, and `[0x4a4d68]` is the mission
 *     clock — the same word `0x421e60` fills from the book's `timer` record. The
 *     gift is capped at `[0x4a3b18]`, the dial's own full scale, which is why
 *     typing it at the start of a level does nothing at all.
 *   - **`myxzltplkt` is a joke.** `0x40411e` makes the comparison and `0x404136`
 *     loads 1 into `ax` whether it matched or not.
 *
 * The letters go where the page's keydown puts them: every lowercase letter to
 * the accumulator first (`0x403c1b`), and then to the action it is bound to —
 * so `bewitch` runs and `zip` punches while they are typed, as in the original.
 */
import type { Cheat } from "../../src/cheats";
import { WEAPONS } from "../../src/guns";
import { FPS, fail, headless, ok, pass } from "./harness";

const h = await headless("level=0&damage=1");
const { game } = h;
const { p, stats, inv } = game;

/** the page hands the accumulator `performance.now()`; here it is the frames stepped */
let frames = 0;
const step = (n: number): void => {
  h.frame(n);
  frames += n;
};
const nowMs = (): number => (frames * 1000) / FPS;

/**
 * Type letters the way the page's keydown takes them — one engine frame a key
 * (66 ms, well inside the 0x28-tick gap), each letter to the accumulator and
 * then held for its action, if it has one. Answers the words that fired.
 */
const keys = (letters: string): Cheat[] => {
  const said: Cheat[] = [];
  for (const ch of letters) {
    const c = game.cheats.press(ch, nowMs());
    if (c) {
      said.push(c);
      game.runCheat(c);
    }
    const k = game.KEYS[ch];
    if (k) h.hold(k, true);
    step(1);
    if (k) h.hold(k, false);
  }
  return said;
};
/**
 * ...and a whole word, after a pause long enough to clear whatever was in the
 * accumulator. The pause is the point: every keystroke in the level goes into
 * `0x4a02c1`, the movement keys included, so a word only reads as one when
 * nothing else was typed in the two thirds of a second before it.
 */
const type = (word: string): Cheat[] => {
  step(14);
  const said = keys(word);
  step(6);
  return said;
};

// 1. the timeout first, because it is the thing that makes the rest a test of
//    the recogniser rather than of eight string compares. `0x403edb` is 0x28
//    ticks — ten engine frames — and this splits one word across twenty-one.
step(14);
/** read fresh each time: the words change it under the reader's feet */
const lives = (): number => stats.lives;
const bornWith = lives();
if (bornWith !== 3) fail(`a level starts with three lives; the player has ${bornWith}`);
const split = [...keys("bewit")];
step(21);
split.push(...keys("ch"));
step(6);
if (split.length || lives() !== 3) fail(`0x403edb forgets after 0x28 ticks; a word split over 21 frames still fired`);
ok(`a gap of 0x28 ticks forgets what was typed, and half a word is not a word`);

// 2. ...and typed without the gap it is. `0x40d400(5)` clamps to five, which is
//    also what it was asked for.
const bewitch = type("bewitch");
if (lives() !== 5) fail(`bewitch is 0x40d400(5); the player has ${lives()} lives`);
if (bewitch.map((c) => c.word).join() !== "bewitch") fail(`the recogniser should name the word it took: ${bewitch.map((c) => c.word)}`);
ok(`bewitch gives the five lives 0x40d400 allows`);

// 3. harakari takes 500 through `0x402ac0` — the same call a hydraulic press
//    spends its blow through — and marsupial gives 1024 back through `0x402b20`,
//    which caps at `[0x4ac3d8]`, your own maximum and so the difficulty's.
const full = stats.health;
if (full !== 1200) fail(`the middle difficulty is 1200 health (0x448ac2); the player has ${full}`);
type("harakari");
if (stats.health !== full - 0x1f4) fail(`harakari is 0x402ac0(0x1f4); ${full} became ${stats.health}`);
type("marsupial");
if (stats.health !== full) fail(`marsupial is 0x402b20(0x400), capped at your own max; the player has ${stats.health}`);
ok(`harakari spends 500 and marsupial gives 1024 back, up to the cap and no further`);

// 4. jetson gives 850 and `0x40d378` takes back whatever is over the dial's own
//    full scale. STREETS' `timer` record is 4000, so the first word lands under
//    the ceiling and the second cannot get past it.
const STREETS_DIAL = 4000;
if (stats.clockFull !== STREETS_DIAL) fail(`STREETS' dial is ${STREETS_DIAL}; it reads ${stats.clockFull}`);
const before = stats.ticks;
type("jetson");
const after = stats.ticks;
if (after <= before) fail(`jetson is 0x40d350(-850), which ADDS; ${before} became ${after}`);
if (after > STREETS_DIAL) fail(`0x4a3b18 is STREETS' own 4000; the clock reached ${after}`);
type("jetson");
const again = stats.ticks;
if (again > STREETS_DIAL) fail(`a second 850 should be thrown away by the cap; the clock reached ${again}`);
// both words leave the clock ON the ceiling and the countdown then takes the
// same frames off each time, so the two reads agree exactly
if (again !== after) fail(`with the clock already at the ceiling only the countdown may move it; ${after} became ${again}`);
ok(`jetson adds 850 (${before} to ${after}) and the dial's 4000 throws the next one away`);

// 5. zip is the spawn cycler, the same `[0x4ac38a]` and the same `0x402760` the
//    unbound action 10 walks. STREETS has three `initplayer` records.
const wasAt = p.x;
type("zip");
if (Math.abs(p.x - wasAt) < 50) fail(`zip should land on another initplayer point; x went ${wasAt} to ${p.x}`);
ok(`zip walks the level's initplayer points — x ${wasAt} to ${p.x}`);

// 6. ...and the joke, which is the one word with no branch behind it
const jokeLives = stats.lives;
const jokeAt = p.x;
const joke = type("myxzltplkt");
if (joke.map((c) => c.word).join() !== "myxzltplkt") fail(`the word should still be recognised — 0x40411e makes the comparison`);
if (stats.lives !== jokeLives || Math.abs(p.x - jokeAt) > 30)
  fail(`0x404136 loads 1 into ax either way: nothing should have happened (x ${jokeAt} -> ${p.x})`);
ok(`myxzltplkt is recognised and does nothing, which is what 0x404136 does`);

// 7. eshs is behind a guard: `0x402ee0` is true only while the player's kind is
//    0x12..0x16, which is the armed set (`0x42e6e0`). Empty-handed it is nothing.
if (inv.armed || game.roundsIn(inv.weapon) !== 0) fail(`this level starts empty-handed; ${game.roundsIn(inv.weapon)} rounds`);
type("eshs");
if (game.roundsIn(inv.weapon) !== 0) fail(`0x402ee0 refuses eshs to an unarmed player; ${game.roundsIn(inv.weapon)} rounds`);
ok(`eshs does nothing empty-handed, which is 0x402ee0's own test`);

// 8. ...and armed it gives 120, clamped by `0x45ef30` to the weapon's own max —
//    the flare gun's sixteen, which is `record+4` at `0x4a7f14 + id * 12`.
await h.load("level=5&x=8300&damage=1");
step(14);
// the words above were typed with the walk keys and left the player facing
// west, and a level load keeps the facing: turn round, since the reach is
// forward (`0x42f081` probes 35 pixels in front)
if (p.facing < 0) {
  h.hold("right", true);
  step(1);
  h.hold("right", false);
  step(6);
}
h.hold("down", true);
step(14);
h.hold("down", false);
step(6);
const gun = WEAPONS[inv.weapon];
if (!inv.armed || gun?.name !== "flaregun" || game.roundsIn(inv.weapon) !== 1 || gun.max !== 16)
  fail(`MALL's flare gun should arm you with one round of 16: ${inv.armed} ${gun?.name} ${game.roundsIn(inv.weapon)}/${gun?.max}`);
type("eshs");
if (game.roundsIn(inv.weapon) !== 16) fail(`0x45ef30 adds 0x78 and clamps to the record's max; ${game.roundsIn(inv.weapon)} rounds`);
ok(`and armed it loads 120 rounds, which the flare gun's own sixteen clamps`);

// 9. ...and cthia, which is the only one that ASKS. `0x404160` fills a dialog
//    with the level you are on — "Enter level (1-16):" is `0x46b469` — and turns
//    the answer into a chapter and a scene: 1-4 are state 3, 5-8 state 4, 9-12
//    state 5 and 13-16 state 6.
let asked = "";
let offered = "";
(globalThis as { prompt?: (m: string, d?: string) => string }).prompt = (m, d = "") => {
  asked = m;
  offered = d;
  return "3";
};
type("cthia");
// the answer's `loadLevel` is asynchronous: let it read its book off the disc
for (let i = 0; i < 2000 && game.levelIndex !== 2; i++) await new Promise((r) => setTimeout(r, 5));
if (!/Enter level \(1-16\):/.test(asked)) fail(`0x46b469 is the prompt's own text; the dialog said "${asked}"`);
if (offered !== "5") fail(`the dialog is filled in with the level you are on, MALL's 5; it offered "${offered}"`);
if (game.levelIndex !== 2 || !/woods/i.test(game.level?.name ?? "")) fail(`level 3 of the sixteen is WOODS; running ${game.levelIndex + 1} ${game.level?.name}`);
ok(`cthia asks "${asked.trim()}" (offering ${offered}) and 3 of 16 is ${game.level?.name}`);

pass(`eight words, one per length, and a two-thirds-of-a-second memory`);
