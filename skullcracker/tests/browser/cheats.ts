/**
 * The eight words `SC.EXE` listens for while a level is running.
 *
 *   npm run dev -w skullcracker                   # in one terminal
 *   npm run test:browser:cheats -w skullcracker   # in another
 *
 * `0x403ed0` is the whole recogniser and it is stranger than a cheat table
 * usually is: the accumulator is a nineteen-character ring, the index into it is
 * `[0x46b320]`, and the jump table at `0x404140` is indexed by HOW MANY
 * characters have been typed since the last pause — so there is exactly one
 * candidate word per length and the eight words are eight different lengths.
 * A gap of 0x28 ticks (two thirds of a second, `0x4087c0` being `ms * 3 / 50`)
 * forgets what you were typing.
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
 */
import { BASE, fail, finish, launch } from "./harness";

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => fail(`page threw: ${e.message}`));
const hud = page.locator("#hud");

const say = async (): Promise<string> => (await hud.textContent()) ?? "";
const num = async (re: RegExp): Promise<number> => Number(re.exec(await say())?.[1] ?? NaN);
const lives = (): Promise<number> => num(/· (\d+) (?:life|lives)/);
const health = (): Promise<number> => num(/damage ON (\d+)\//);
const clock = (): Promise<number> => num(/· clock (\d+)/);
const xAt = (): Promise<number> => num(/· x (-?\d+),/);
const rounds = (): Promise<number> => num(/· (?:holding|no) \w+ (\d+)\//);

const go = async (query: string): Promise<void> => {
  await page.goto(`${BASE}/walk.html?${query}`);
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(900);
};

/**
 * Type a word the way the recogniser wants it — after a pause long enough to
 * clear whatever was in the accumulator, and with no gap inside the word.
 *
 * The pause is the point: every keystroke in the level goes into `0x4a02c1`,
 * the movement keys included, so a word only reads as one when nothing else was
 * typed in the two thirds of a second before it.
 */
const type = async (word: string, gapMs = 40): Promise<void> => {
  await page.waitForTimeout(900);
  for (const ch of word) {
    await page.keyboard.press(ch);
    await page.waitForTimeout(gapMs);
  }
  await page.waitForTimeout(400);
};

// 1. the timeout first, because it is the thing that makes the rest a test of
//    the recogniser rather than of eight string compares. `0x403edb` is 0x28
//    ticks, and this splits one word across a gap twice that long.
await go("level=0&damage=1");
const bornWith = await lives();
if (bornWith !== 3) fail(`a level starts with three lives; the panel says ${bornWith}`);
await page.waitForTimeout(900);
for (const ch of "bewit") {
  await page.keyboard.press(ch);
  await page.waitForTimeout(40);
}
await page.waitForTimeout(1400);
for (const ch of "ch") {
  await page.keyboard.press(ch);
  await page.waitForTimeout(40);
}
await page.waitForTimeout(400);
if ((await lives()) !== 3) fail(`0x403edb forgets after 0x28 ticks; a word split over 1.4s still fired`);
console.log(`ok    a gap of 0x28 ticks forgets what was typed, and half a word is not a word`);

// 2. ...and typed without the gap it is. `0x40d400(5)` clamps to five, which is
//    also what it was asked for.
await type("bewitch");
if ((await lives()) !== 5) fail(`bewitch is 0x40d400(5); the panel says ${await lives()} lives`);
if (!/bewitch/.test(await say())) fail(`the panel should name the word it took`);
console.log(`ok    bewitch gives the five lives 0x40d400 allows`);

// 3. harakari takes 500 through `0x402ac0` — the same call a hydraulic press
//    spends its blow through — and marsupial gives 1024 back through `0x402b20`,
//    which caps at `[0x4ac3d8]`, your own maximum and so the difficulty's.
const full = await health();
if (full !== 1200) fail(`the middle difficulty is 1200 health (0x448ac2); the panel says ${full}`);
await type("harakari");
if ((await health()) !== full - 0x1f4) fail(`harakari is 0x402ac0(0x1f4); ${full} became ${await health()}`);
await type("marsupial");
if ((await health()) !== full) fail(`marsupial is 0x402b20(0x400), capped at your own max; the panel says ${await health()}`);
console.log(`ok    harakari spends 500 and marsupial gives 1024 back, up to the cap and no further`);

// 4. jetson gives 850 and `0x40d378` takes back whatever is over the dial's own
//    full scale. STREETS' `timer` record is 4000, so the first word lands under
//    the ceiling and the second cannot get past it.
const STREETS_DIAL = 4000;
const before = await clock();
await type("jetson");
const after = await clock();
if (after <= before) fail(`jetson is 0x40d350(-850), which ADDS; ${before} became ${after}`);
if (after > STREETS_DIAL) fail(`0x4a3b18 is STREETS' own 4000; the clock reached ${after}`);
await type("jetson");
const again = await clock();
if (again > STREETS_DIAL) fail(`a second 850 should be thrown away by the cap; the clock reached ${again}`);
// ...and not `again < after`: both words leave the clock ON the ceiling and the
// countdown then takes the same few ticks off each time, so the two reads agree
if (again > after) fail(`with the clock already at the ceiling only the countdown may move it; ${after} became ${again}`);
console.log(`ok    jetson adds 850 (${before} to ${after}) and the dial's 4000 throws the next one away`);

// 5. zip is the spawn cycler, the same `[0x4ac38a]` and the same `0x402760` the
//    unbound action 10 walks. STREETS has three `initplayer` records.
const wasAt = await xAt();
await type("zip");
const nowAt = await xAt();
if (Math.abs(nowAt - wasAt) < 50) fail(`zip should land on another initplayer point; x went ${wasAt} to ${nowAt}`);
console.log(`ok    zip walks the level's initplayer points — x ${wasAt} to ${nowAt}`);

// 6. ...and the joke, which is the one word with no branch behind it
const jokeLives = await lives();
const jokeAt = await xAt();
await type("myxzltplkt");
if (!/myxzltplkt/.test(await say())) fail(`the word should still be recognised — 0x40411e makes the comparison`);
if ((await lives()) !== jokeLives || Math.abs((await xAt()) - jokeAt) > 30)
  fail(`0x404136 loads 1 into ax either way: nothing should have happened`);
console.log(`ok    myxzltplkt is recognised and does nothing, which is what 0x404136 does`);

// 7. eshs is behind a guard: `0x402ee0` is true only while the player's kind is
//    0x12..0x16, which is the armed set (`0x42e6e0`). Empty-handed it is nothing.
if ((await rounds()) !== 0) fail(`this level starts empty-handed; the panel says ${await rounds()} rounds`);
await type("eshs");
if ((await rounds()) !== 0) fail(`0x402ee0 refuses eshs to an unarmed player; the panel says ${await rounds()}`);
console.log(`ok    eshs does nothing empty-handed, which is 0x402ee0's own test`);

// 8. ...and armed it gives 120, clamped by `0x45ef30` to the weapon's own max —
//    the flare gun's sixteen, which is `record+4` at `0x4a7f14 + id * 12`.
await go("level=5&x=8300&damage=1");
await page.keyboard.down("s");
await page.waitForTimeout(900);
await page.keyboard.up("s");
await page.waitForTimeout(400);
if (!/· holding flaregun 1\/16/.test(await say())) fail(`MALL's flare gun should arm you with one round: ${await say()}`);
await type("eshs");
if ((await rounds()) !== 16) fail(`0x45ef30 adds 0x78 and clamps to the record's max; the panel says ${await rounds()}`);
console.log(`ok    and armed it loads 120 rounds, which the flare gun's own sixteen clamps`);

// 9. ...and cthia, which is the only one that ASKS. `0x404160` fills a dialog
//    with the level you are on — "Enter level (1-16):" is `0x46b469` — and turns
//    the answer into a chapter and a scene: 1-4 are state 3, 5-8 state 4, 9-12
//    state 5 and 13-16 state 6.
let asked = "";
page.on("dialog", (d) => {
  asked = d.message();
  void d.accept("3");
});
await type("cthia");
await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 60_000 });
await page.waitForTimeout(1500);
if (!/Enter level \(1-16\):/.test(asked)) fail(`0x46b469 is the prompt's own text; the dialog said "${asked}"`);
const where = await say();
if (!/WOODS|woods/i.test(where)) fail(`level 3 of the sixteen is WOODS; the panel says ${where.slice(0, 120)}`);
console.log(`ok    cthia asks "${asked.trim()}" and 3 of 16 is WOODS`);

console.log(`\nPASS  eight words, one per length, and a two-thirds-of-a-second memory`);
await finish(browser);
