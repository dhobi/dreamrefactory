/**
 * What the CREATURES throw.
 *
 *   npm run dev -w skullcracker                  # in one terminal
 *   npm run test:browser:casts -w skullcracker   # in another
 *
 * Ten classes in this game fight at a distance and not one of them could reach
 * the player: their brains read the throw, played its animation and its sound,
 * and made no object, because a `Brain` is handed one enemy and has no way to
 * put a second thing in the level. The wiring is `BrainCtx.cast`, called at the
 * instruction each class calls its own spawner at, and this is the proof for the
 * two that are built.
 *
 * ## The two are deliberately the two different SHAPES
 *
 * - **the spitter's gob** (`initpuke`, LAB): `0x418400` stands it 100 ahead and
 *   65 up, its own script's `dx 400` over a divisor of 13 gives it 31 pixels an
 *   engine frame, it cycles five cels, and `0x418621` takes it away once it is
 *   1000 from the player. Dangerous from the frame it leaves.
 * - **the cop's slug** (`initcop`, MAZE): `0x414740` writes the velocity itself
 *   (±35), gives it a hundred FRAMES to live rather than a distance, and — the
 *   part worth a test of its own — holds its strength at ZERO until it is within
 *   130 pixels of the player, when `0x413e79` arms it and puts a second cel on
 *   it. A slug crossing a room hurts nothing.
 *
 * ## Why it walks about
 *
 * Neither class throws on demand. The spitter spits on a coin toss in its 110
 * to 180 band and charges inside that; the cop's gun is one of four things its
 * own `decide` picks. So the probe sweeps the bands — a step towards, a step
 * away — which is what a player does and what puts the thrower in a state where
 * throwing is one of its options. Every assertion below is "within N samples",
 * never "on this frame".
 */
import { BASE, fail, finish, launch } from "./harness";

const browser = await launch({ headless: process.env.HEADED !== "1" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const problems: string[] = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
const hud = page.locator("#hud");
const say = async (): Promise<string> => (await hud.textContent()) ?? "";

/** what the status line says about the nearest thing in the air */
interface Seen {
  cel: number;
  x: number;
  y: number;
  blow: number;
}
const castNow = async (t?: string): Promise<Seen | null> => {
  const m = /· \d+ cast, nearest cel (\d+) at x (-?\d+), y (-?\d+) blow (-?\d+)/.exec(t ?? (await say()));
  return m ? { cel: Number(m[1]), x: Number(m[2]), y: Number(m[3]), blow: Number(m[4]) } : null;
};
const healthNow = async (t?: string): Promise<number> =>
  Number(/damage ON (\d+)\/\d+hp/.exec(t ?? (await say()))?.[1] ?? -1);

const go = async (level: number, x: number, y: number, arm = true): Promise<void> => {
  await page.goto(`${BASE}/walk.html?level=${level}&x=${x}&y=${y}${arm ? "&damage=1&foehit=1" : ""}`);
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
};

/**
 * Hold a thrower at arm's length for a while, gathering everything that flew.
 *
 * The distance is the point, and it has to be STEERED rather than swept. Both
 * of these classes decide by band: a thrower whose target stands still settles
 * into the one state its distance allows, and for both of them that state is a
 * melee — but a fixed there-and-back walk is no better, because the thrower
 * moves too and the two drift apart. So each sample reads where the thrower is
 * and steps towards it or away from it to hold the gap in the middle of the
 * band where throwing is one of its options.
 *
 * Nothing here waits for a particular frame: both classes roll for what they do
 * next, so every assertion downstream is "within N samples".
 */
const sweep = async (
  samples: number,
  who: string,
  hold: { min: number; max: number },
): Promise<{ seen: Seen[]; health: number[]; met: number }> => {
  const seen: Seen[] = [];
  const health: number[] = [];
  let met = 0;
  for (let i = 0; i < samples; i++) {
    const t0 = await say();
    const me = Number(/· x (-?\d+),/.exec(t0)?.[1] ?? 0);
    const him = Number(new RegExp(`nearest ${who} [^·]*at x (-?\\d+),`).exec(t0)?.[1] ?? NaN);
    // towards it when it is too far, away when it is too close, and on the
    // frames it cannot be seen at all, east — which is where both levels' rooms
    // run and so where its own patrol will bring it back
    const gap = Math.abs(him - me);
    if (Number.isFinite(him)) met++;
    const key = !Number.isFinite(him) ? "d" : gap > hold.max ? (him > me ? "d" : "a") : gap < hold.min ? (him > me ? "a" : "d") : null;
    if (key) {
      await page.keyboard.down(key);
      await page.waitForTimeout(110);
      await page.keyboard.up(key);
    } else {
      await page.waitForTimeout(110);
    }
    const t = await say();
    const c = await castNow(t);
    if (c) seen.push(c);
    const h = await healthNow(t);
    if (h >= 0 && health[health.length - 1] !== h) health.push(h);
  }
  return { seen, health, met };
};

// ---- 1 — the spitter's gob -------------------------------------------------

await go(15, 700, 8521);
if (!/nearest initpuke/.test(await say())) fail(`LAB x700 should stand by a spitter: ${(await say()).slice(0, 180)}`);
const gobs = await sweep(260, "initpuke", { min: 130, max: 200 });
if (!gobs.seen.length) fail(`a spitter threw nothing in 260 samples (it was in the line ${gobs.met} times) — 0x418400 is not being called`);
const gobCels = [...new Set(gobs.seen.map((s) => s.cel))].sort((a, b) => a - b);
// `0x46cc28` tag 1 is 3064, 3063, 3062, 3061, 3060 and the gob is drawn out of them
if (gobCels.some((c) => c < 3060 || c > 3064)) fail(`a gob is cels 3060..3064; saw ${gobCels.join(",")}`);
if (gobs.seen.some((s) => s.blow !== 0x64)) fail(`0x41862c holds a gob at 100; saw ${[...new Set(gobs.seen.map((s) => s.blow))].join(",")}`);
console.log(`ok    the spitter spits — ${gobs.seen.length} samples with a gob in the air, cels ${gobCels.join(",")}`);

if (gobs.health.length < 2) fail(`a gob that lands takes health; the player stayed at ${gobs.health[0]}`);
const worst = Math.min(...gobs.health);
if (worst >= gobs.health[0]) fail(`health never fell: ${gobs.health.join(" ")}`);
console.log(`ok    ...and a gob that lands hurts — ${gobs.health[0]} down to ${worst}`);

// ...and the same level with the creature switch off: it still flies, and it
// cannot spend a point. That switch is the BENCH's, and this is what it means.
await go(15, 700, 8521, false);
const quiet = await sweep(140, "initpuke", { min: 120, max: 175 });
if (!quiet.seen.length) fail(`the gob is a creature's blow, not a creature's damage — it should fly with ?foehit off too`);
if (quiet.health.length > 1) fail(`?foehit is off and something still took health: ${quiet.health.join(" ")}`);
console.log(`ok    with the creature switch off it still flies and takes nothing (${quiet.seen.length} samples)`);

// ---- 2 — the cop's slug, and its arming ------------------------------------

await go(13, 1921, 8430);
// the third of MAZE's seven, and the one chosen because it patrols its own
// rect alone: the others share a room with a slurp, which takes the "nearest"
// line away and leaves the probe steering against something that never fires
if (!/nearest initcop/.test(await say())) fail(`MAZE x1921 should stand by a cop: ${(await say()).slice(0, 180)}`);
const slugs = await sweep(240, "initcop", { min: 140, max: 250 });
if (!slugs.seen.length) fail(`a cop fired nothing in 240 samples (it was in the line ${slugs.met} times) — 0x414740 is not being called`);
const slugCels = [...new Set(slugs.seen.map((s) => s.cel))].sort((a, b) => a - b);
if (slugCels.some((c) => c !== 2240 && c !== 2241)) fail(`a slug is cel 2240 or 2241; saw ${slugCels.join(",")}`);
// what makes it a slug rather than a gob: it is worth nothing until it arms,
// and every one the HUD has named here is one that reached the player
for (const s of slugs.seen) {
  if (s.cel === 2240 && s.blow !== 0) fail(`tag 0 holds obj+0x1a at zero (0x413e43); an unarmed slug read blow ${s.blow}`);
  if (s.cel === 2241 && s.blow !== 0x64) fail(`tag 1 writes 0x64 (0x413e79); an armed slug read blow ${s.blow}`);
}
console.log(`ok    the cop fires — ${slugs.seen.length} samples, cels ${slugCels.join(",")}, and the blow follows the tag`);
/**
 * ...and one of them ARMED, which is the only way to know one reached him.
 *
 * Not "it took health": the probe is holding the cop at arm's length on purpose
 * — inside 130 the class stops firing and swings instead — so whether a
 * particular slug lands is the cop's business and the player's footwork. What
 * the arming says is exactly what the test is for: a slug crossed the last
 * hundred and thirty pixels and became worth a hundred points of blow while it
 * did it. That damage flows from a cast at all is the gob's leg, above.
 */
if (!slugs.seen.some((s) => s.cel === 2241)) {
  fail(`no slug ever armed: 0x413e5d arms one inside 130 of the player, and ${slugs.seen.length} flew`);
}
console.log(`ok    ...and ${slugs.seen.filter((s) => s.cel === 2241).length} of them armed on the way in`);

if (problems.length) fail(`the page threw: ${problems.join(" · ")}`);
console.log(`PASS  two classes throw what their own machines throw`);
await finish(browser);
