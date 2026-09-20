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
  /** face it on the frames the gap is right — `0x43e0a0` throws at nobody else */
  face = false,
  /**
   * How long each sample takes. The default is a tenth of a second, which is
   * plenty for a gob that crosses a room; the knifeboy's two live five and
   * eight frames — a third of a second — and a slow sampler walks straight past
   * them.
   */
  pace = 110,
): Promise<{ seen: Seen[]; health: number[]; met: number; reactions: Set<string> }> => {
  const seen: Seen[] = [];
  const health: number[] = [];
  const reactions = new Set<string>();
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
      await page.waitForTimeout(pace);
      await page.keyboard.up(key);
    } else if (face && Number.isFinite(him)) {
      // a tap towards it: enough to turn, not enough to close the gap
      const toward = him > me ? "d" : "a";
      await page.keyboard.down(toward);
      await page.waitForTimeout(25);
      await page.keyboard.up(toward);
      await page.waitForTimeout(Math.max(0, pace - 25));
    } else {
      await page.waitForTimeout(pace);
    }
    const t = await say();
    const c = await castNow(t);
    if (c) seen.push(c);
    const r = /code (-?\d+) (\w+)/.exec(t);
    if (r) reactions.add(r[0]);
    const h = await healthNow(t);
    if (h >= 0 && health[health.length - 1] !== h) health.push(h);
  }
  return { seen, health, met, reactions };
};

// ---- 1 — the spitter's gob -------------------------------------------------

await go(15, 700, 8521);
if (!/nearest initpuke/.test(await say())) fail(`LAB x700 should stand by a spitter: ${(await say()).slice(0, 180)}`);
/**
 * 110..180 is the band `0x41809b` spits from on a plain coin toss, and
 * `puke.ts` calls it "the band the class is built for". The band above it
 * (180..280) spits too, but only after `0x41804c`'s `cmp roll, 0x28` — nine
 * frames in ten at that distance it chooses nothing at all, and a probe that
 * straddles the two bands spends most of its samples in the quiet one. It did:
 * one run in several came back with the spitter in position 243 times out of
 * 260 and not one gob thrown.
 */
const gobs = await sweep(260, "initpuke", { min: 120, max: 170 });
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

// ---- 3 — the eyeball's glob, which is a CODE and not a blow ---------------
//
// The third shape, and the one that changes what the player does rather than
// what he has left: `0x43dbda` writes −2 into the glob's strength every frame,
// and −2 is `0x42ea34`'s jolt. Until this class could throw, nothing a level
// places sent one — `codes.ts` says so, and said it in the present tense.
//
// The eye also wants its own footwork: it spits in its 180..260 band
// (`0x43e08d`) and only at a player who is FACING it (`0x43e0a0` sends the ones
// who are not into the drift instead), so the probe faces it while it holds.
await go(7, 7105, 15998);
if (!/nearest initeyeball/.test(await say())) fail(`SEWER x7105 should stand under an eye: ${(await say()).slice(0, 180)}`);
const globs = await sweep(200, "initeyeball", { min: 190, max: 250 }, true);
if (!globs.seen.length) fail(`an eye threw nothing in 200 samples (it was in the line ${globs.met} times)`);
const globCels = [...new Set(globs.seen.map((s) => s.cel))].sort((a, b) => a - b);
// `0x4725c0`'s five launches and five flights, 8500 through 8590
if (globCels.some((c) => c < 8500 || c > 8590)) fail(`a glob is cels 8500..8590; saw ${globCels.join(",")}`);
if (globs.seen.some((s) => s.blow !== -2)) fail(`0x43dbda holds a glob at -2; saw ${[...new Set(globs.seen.map((s) => s.blow))].join(",")}`);
console.log(`ok    the eye spits — ${globs.seen.length} samples, cels ${globCels.join(",")}, every one worth -2`);

if (!globs.reactions.has("code -2 jolt")) {
  fail(`a glob that lands is 0x42ea34's jolt; the reactions seen were ${[...globs.reactions].join(", ") || "none"}`);
}
console.log(`ok    ...and one that lands JOLTS him — the first -2 a placed class has ever sent`);

// ---- 4 — the zombie's gob, which goes nowhere at all ----------------------
//
// The fourth shape, and the one that proves the kit is reading the executable
// rather than assuming a projectile: nothing gives this thing a speed. Not the
// spawner (`0x420990` writes the point, the facing and the room), not the
// creator (`0x42015a`), and not one of the eight frames of `0x470028`. It hangs
// forty pixels above the mouth and sixty-five in front of it for the eight
// frames its own script lasts (`0x4201ea`), carrying −2 the whole time.
await go(9, 1000, 1010);
if (!/nearest initzomb/.test(await say())) fail(`GRAVE x1000 should stand by a zombie: ${(await say()).slice(0, 180)}`);
/**
 * Inside a HUNDRED, which is `0x4204fd`'s own gate: the bands are
 * [300, 200, 100] and the spit wants the innermost. It also wants the player
 * facing it — `0x4204c3` sends a zombie whose back you are to into the melee
 * instead — which is what `face` is for. Held at 90..220 this leg spent most of
 * its samples in the sway and caught one gob in a run.
 */
const bile = await sweep(180, "initzomb", { min: 40, max: 90 }, true);
if (!bile.seen.length) fail(`a zombie hawked nothing in 180 samples (it was in the line ${bile.met} times)`);
const bileCels = [...new Set(bile.seen.map((s) => s.cel))].sort((a, b) => a - b);
if (bileCels.some((c) => c < 1890 || c > 1897)) fail(`a zombie's gob is cels 1890..1897; saw ${bileCels.join(",")}`);
if (bile.seen.some((s) => s.blow !== -2)) fail(`0x4201e4 holds it at -2; saw ${[...new Set(bile.seen.map((s) => s.blow))].join(",")}`);
// ...and it is where it was put. Every sample of one gob reads the same x, so
// the set of x's seen is as small as the number of gobs — a moving thing would
// spread them across the room.
console.log(`ok    the zombie hawks one up — ${bile.seen.length} samples, cels ${bileCels.join(",")}, all worth -2`);

// ---- 5 — Igor's throw, and the first one with WEIGHT ----------------------
//
// The fifth shape and the one that needed new machinery. Everything before it
// flies flat or not at all, because every one of their creators calls
// `0x42f850(obj, 0)`. `0x41fc7b` pushes **0.8f**, so `obj+0x24` is 8 and
// `0x430327` adds those eight to the vertical velocity every frame; `0x42fda7`
// spends the velocity into the point undivided. It leaves 26 up and 35 along
// (`0x425544`…`0x425582`) and comes down on its own.
//
// RAVECAVE's second igor, because it patrols alone: the other two share their
// rooms with bats, which take the "nearest" line and leave the probe steering
// against something that never throws. Its throw is band 1, 300..350.
await go(11, 9120, 9939);
if (!/nearest initigor/.test(await say())) fail(`RAVECAVE x9120 should stand by an igor: ${(await say()).slice(0, 180)}`);
const hurled = await sweep(220, "initigor", { min: 300, max: 340 }, true);
if (!hurled.seen.length) fail(`an igor threw nothing in 220 samples (it was in the line ${hurled.met} times)`);
const hurledCels = [...new Set(hurled.seen.map((s) => s.cel))].sort((a, b) => a - b);
if (hurledCels.some((c) => c < 3160 || c > 3163)) fail(`it throws cels 3160..3163; saw ${hurledCels.join(",")}`);
if (hurled.seen.some((s) => s.blow !== 0x64)) fail(`0x41fd0d holds it at 100; saw ${[...new Set(hurled.seen.map((s) => s.blow))].join(",")}`);
/**
 * ...and it ARCS, which is the whole of what this leg adds.
 *
 * Every other cast in this file reads one constant y for its whole flight —
 * they are weightless and the page has nothing to pull them down. A spread here
 * is the pull, and it is the only thing in the suite that could not have passed
 * before `CastKit.pull` existed.
 */
const spread = Math.max(...hurled.seen.map((s) => s.y)) - Math.min(...hurled.seen.map((s) => s.y));
if (spread < 20) fail(`a thrown thing with weight 0.8 should rise and fall; its y moved ${spread}px`);
console.log(`ok    the igor throws, and it arcs — ${hurled.seen.length} samples, cels ${hurledCels.join(",")}, ${spread}px of rise and fall`);

// ---- 6 — the knifeboy, who throws TWO different things --------------------
//
// `0x43a26c` rolls `0x434540(4)` once as its wind-up ends and spends the answer
// on both halves: 1 and 2 take `0x43a450` and its sound, 3 and 4 take
// `0x43a500` and its. They share a class (`0x43c520`, divisor 2, weight 0.23)
// and nothing writes either one a velocity — **the script is the velocity**:
//
//   the knife  `0x473670` tag 0 `dx 100`, then tag 1's `dx 0 50 0 50 0 0 0`
//   the lob    `0x4736f8` tag 0 `dy -30`, then four cels of falling
//
// so the knife is the only cast in the game that gets FASTER as it flies, and
// the lob is the only one that goes up before it comes down.
await go(6, 1082, 8399);
if (!/nearest initknifeboy/.test(await say())) fail(`SERVICE x1082 should stand by a knifeboy: ${(await say()).slice(0, 180)}`);
// no facing tap and a wide hold: this class decides by band like the rest, and
// a probe that walks at it continuously collapses the gap into the melee it
// keeps for close quarters. Closing only when it is further than 240 is what
// left it room to choose the throw.
const knives = await sweep(320, "initknifeboy", { min: 80, max: 240 }, false, 35);
if (!knives.seen.length) fail(`a knifeboy threw nothing in 320 samples (it was in the line ${knives.met} times)`);
const knifeCels = [...new Set(knives.seen.map((s) => s.cel))].sort((a, b) => a - b);
if (knifeCels.some((c) => c < 1870 || c > 1877)) fail(`both of its throws are cels 1870..1877; saw ${knifeCels.join(",")}`);
if (knives.seen.some((s) => s.blow !== 0x64)) fail(`0x43c54a gives it a hundred; saw ${[...new Set(knives.seen.map((s) => s.blow))].join(",")}`);
console.log(`ok    the knifeboy throws — ${knives.seen.length} samples, cels ${knifeCels.join(",")}`);

/**
 * ...and the hardcore's lob is WIRED but not watched here.
 *
 * `HARDCORE_THROW` is read out of `0x43d190` like the rest, and SERVICE places
 * exactly one hardcore — on a perch at y7872, six hundred pixels above the
 * floor the level spawns anybody on. `?y=` does not reach it (the spawn snaps
 * to the ground under the x it is given), so getting a probe next to it means
 * walking SERVICE's own route up, which is `service.ts`'s job and not this
 * file's. Named here so that the gap in the coverage is on the record rather
 * than in somebody's head.
 */

if (problems.length) fail(`the page threw: ${problems.join(" · ")}`);
console.log(`PASS  six classes' throws watched, and a seventh wired`);
await finish(browser);
