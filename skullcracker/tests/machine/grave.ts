/**
 * GRAVE — level nine, and the first level of chapter three.
 *
 *   npx tsx tools/runmachine.mts grave      (from skullcracker/)
 *
 * One region, 6131 pixels of graveyard, and three things this port had none of:
 *
 *   - **the zombie** (`0x41eee0`), sixteen of them, and the biggest ordinary
 *     creature in the game so far: two hundred health against chapter two's 25 and
 *     40, a divisor of 10 against their 7, and 310 points each.
 *   - **the grave** (`0x41f0e0`), five of them, which is the only thing in the
 *     game that kills you without a blow. Shut, `0x4210bd` shoves you off it —
 *     but only while you are on your FEET; `0x4210a7` lets a jump through. Come
 *     within a hundred pixels of one and it opens, and from that frame it pulls.
 *   - **the hand** (`0x41f090`), four of them, and the record's `param` says
 *     which of two it is: 0 comes up under your own feet, 1 anywhere in its rect.
 *
 * And the level's own clock, which was in the books all along: a `timer` record,
 * whose `param` is the number. GRAVE's is 2100 against the full dial's 7200.
 */
import { FOES } from "../../src/foes";
import { FPS, fail, headless, ok, pass } from "./harness";

/**
 * The zombie's hit handler, on its own: `0x420ae1` keeps the arms up (tag
 * 3, cel 1846) when it is struck in the claw, the raise or the held guard,
 * `0x420afe` rolls one of the other three anywhere else, and `0x4207e7` ends
 * every one of them back in the guard, kind 2 tag 1.
 */
const machines = (): void => {
  const z = FOES.initzomb;
  const blow = { damage: 20, hits: 1, dy: 0, facingAway: false };
  const state = (script: number, tag = 0) => ({ max: 200, hp: 180, script, tag });
  for (const [s, t] of [[5, 0], [5, 1], [3, 0], [2, 1]] as const)
    if (z.pick!(blow, state(s, t)) !== 3)
      fail(`0x420ae1: struck in kind ${s} tag ${t} it keeps its arms up (tag 3)`);
  for (let i = 0; i < 30; i++)
    if (z.pick!(blow, state(1)) === 3) fail(`0x420afe rolls tags 0..2 on the walk`);
  if (z.flinch!.some((a) => a.resume?.kind !== 2 || a.resume?.tag !== 1))
    fail(`0x4207f2 ends every flinch in kind 2 tag 1`);
  // `0x420ae1` reads `obj+0x18` as the blow finds it, and a flinch puts 6
  // there: struck again in the guard's own 1846, it drops the guard
  if (z.flinch!.some((a, i) => a.kind !== 6 || a.tag !== i)) fail(`0x470248 is kind 6, tags 0..3`);
  for (let i = 0; i < 30; i++)
    if (z.pick!(blow, state(6, 3)) === 3) fail(`0x420afe: struck again in kind 6 it rolls tags 0..2`);
  if (!z.hitsOwn || z.sheds?.mode !== 0 || z.sheds.afterCels !== 3)
    fail(`0x4209f0 turns away only bats, and 0x420832 sheds the head after tag 0's three cels`);
  if (z.death!.cels.join() !== "1863,1864,1865,1866,1867,1868")
    fail(`0x470270 is tag 0 and then tag 1, the corpse`);
  ok(`a zombie keeps its guard when struck in it once, drops it the second time, and every flinch ends in the guard`);
};

machines();

const h = await headless("level=9");
const { game } = h;
/** a fresh page: the lives are the game's, and carry over a load unless named */
const go = async (x?: number): Promise<void> => {
  await h.load(`level=9&lives=3${x === undefined ? "" : `&x=${x}`}`);
  h.until(() => game.p.onGround, 60);
  h.frame(4);
};
const grave = (x: number) => game.hereOf((l) => l.holes).find((q) => q.x === x);
const opening = (x: number): boolean => {
  const g = grave(x);
  return !!g && (g.state === "opening" || g.state === "open") && Math.floor(game.holeCel(g) / 100) === 33;
};

// 1. it opens at its own initplayer, one region, and sixteen of one creature
await go();
if (game.level!.rooms.length !== 1) fail(`GRAVE is one region; it has ${game.level!.rooms.length}`);
const kill = Math.round(game.mission().kill * 100);
if (kill !== 90 || game.stats.census !== 16) fail(`GRAVE places sixteen zombies; the census is kill ${kill}% of ${game.stats.census}`);
const quota = Math.max(0, game.aliveNow() - game.stats.allowance);
if (quota !== 14 || game.stats.census - game.stats.allowance !== 14) fail(`90% of 16 is 14: quota ${quota} of ${game.stats.census - game.stats.allowance}`);
ok(`GRAVE is one region of sixteen zombies, and chapter three wants 90% of them`);

// 2. the level's OWN clock. `0x421e94` hands `0x40d340` the timer record's
//    param and nothing else; GRAVE's is 2100, not the full dial's 7200.
if (game.stats.clockFull !== 2100) fail(`GRAVE's timer record carries 2100; the clock is full at ${game.stats.clockFull}`);
ok(`and its own timer record gives it ${game.stats.clockFull} frames, not the full dial`);

// 3. a zombie stands on the creator's one cel until the player's point is in
//    its rect (`0x4203b3`), and it is two hundred health
h.frame(22);
const nearZomb = () =>
  game
    .spawnedHere()
    .filter((e) => e.kind === "initzomb")
    .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];
const dormant = nearZomb();
const still = new Set<number>();
for (let i = 0; i < 16; i++) {
  h.frame();
  still.add(game.celOf(dormant));
}
if (still.size !== 1 || !still.has(1800)) fail(`a dormant zombie holds 1800 and nothing else; saw ${[...still].join(" ")}`);
if (dormant.hp !== 200 || dormant.max !== 200) fail(`0x41ef34 gives it 0x40e300(0xc8); it has ${dormant.hp}/${dormant.max}`);
ok(`they stand dormant on cel 1800, two hundred health each`);

// 4. ...and one felled, for what `0x420abf` pays
await go(1050);
h.frame(6);
const zomb = nearZomb();
const before = game.stats.score;
for (let i = 0; i < 450 && zomb.state !== "dead"; i++) {
  const d = zomb.x - game.p.x;
  if (Math.abs(d) < 90) {
    if (Math.sign(d) !== game.p.facing && d !== 0) {
      const key = d > 0 ? "right" : "left";
      h.hold(key, true);
      h.frame();
      h.hold(key, false);
    }
    if (!game.p.act) h.press("kick");
    h.frame(3);
  } else {
    const key = d > 0 ? "right" : "left";
    h.hold(key, true);
    h.frame();
    h.hold(key, false);
  }
}
if (zomb.state !== "dead") fail(`never felled a zombie: ${zomb.hp}/${zomb.max}`);
h.frame(10);
const points = game.stats.score - before;
/**
 * ...and it pays 0x136 PER zombie, which is the assertion that survives: a
 * zombie has its own machine (`0x420330`) and the ones nearby close on you while
 * you are finishing the first, so a fixture that swings until something dies
 * can leave two on the ground. What `0x420abf` says is the rate, not the count.
 */
if (points === 0 || points % 310 !== 0) fail(`0x420abf pays 0x136 a zombie; the score rose ${points}`);
ok(`one falls for ${points} points`);

// 5. a grave is SHUT until the player's x comes within a hundred of its own,
//    and `0x42115a` is the whole of that test. x1300 is outside its rect
//    (x1330..1652), where nothing pulls.
await go(1300);
const g1532 = grave(1532);
if (!g1532 || g1532.state !== "shut" || game.holeCel(g1532) !== 3310) fail(`the grave at x1532 opens shut on 3310`);
if (Math.abs(game.p.x - 1532) < 100) fail(`x1300 is 232 from the grave; the test is a hundred`);
await go(1460);
h.frame(6);
if (!opening(1532)) fail(`inside a hundred it should be opening; it is ${grave(1532)?.state} on ${game.holeCel(grave(1532)!)}`);
ok(`it is shut at 232 pixels and opening at 72 — 0x42115a's hundred`);

// 5b. ...and a shut grave DRAWS a grounded player in: inside its rect,
//     `0x4210bd` pushes them toward its point by their distance less half the
//     rect's width less one (`0x4210f7`: east when they are west of it) —
//     until they are inside its hundred and it opens. At x1380 that is
//     |152 - 161 - 1| = 10 through `0x42f8b0`'s divisor of 12 — ONE pixel a
//     frame at first, growing as the gap closes
await go(1380);
const put = game.p.x;
if (h.until(() => game.p.x > 1432 && opening(1532), 80) < 0)
  fail(`0x4210bd pulls a player put down at x1380 toward the grave at x1532 until it opens; they stand at ${game.p.x}`);
ok(`and inside its rect it draws you in: put down at x${put}, drawn to ${game.p.x} and it opened`);

// 6. ...but standing NEAR one, on solid ground, is not falling into one.
//
//    Every test in this class is against the player's POINT — `0x421083` hands
//    `[player+6]` to `0x434200` and `0x421211` subtracts the grave's own — and
//    that point is the ANCHOR, 88 above this port's `p.y`. Against the anchor,
//    none of the five has a single killing column that is not the pit itself.
await go(2900);
h.frame(3 * FPS);
if (game.stats.lives !== 3) fail(`standing on solid ground beside a grave must not take a life (0x421211 reads the ANCHOR); lives ${game.stats.lives}`);
if (!opening(2842)) fail(`x2900 is inside the x2842 grave's hundred and it should be open: ${grave(2842)?.state}`);
ok(`...and standing beside an OPEN one on solid ground costs nothing`);

// 7. ...and then it takes you. Falling in is what does it: there is no health
//    in the class at all, and `0x402fa0(5)` is a death rather than a blow — and
//    only in the ten frames it is opening (`0x42120c`); once open, its lid
//    carries you (`0x421470`). So start outside its rect, where nothing has
//    drawn you in and opened it yet.
await go(1300);
h.hold("right", true);
const took = h.until(() => game.stats.lives !== 3, 60);
h.hold("right", false);
if (took < 0) fail(`walking into a grave should cost a life; still ${game.stats.lives} lives`);
ok(`and walking at one costs a life, with no blow anywhere in it`);

// 7b. the jump is the answer, and `0x4210a7` is why: off the ground, the pull
//     does not apply
await go(1300);
h.hold("up", true);
h.hold("right", true);
h.until(() => {
  if (game.p.x > 1360 && game.p.x < 1460 && game.p.onGround) h.press("jump");
  return game.stats.lives !== 3 || game.p.x > 1700;
}, 90);
h.hold("right", false);
h.hold("up", false);
h.frame(6);
if (game.stats.lives !== 3) fail(`a jump should clear a grave; it still took a life`);
if (game.p.x < 1650) fail(`a jump should clear the grave at x1532; stopped at x ${game.p.x}`);
const behind = grave(1532)!;
if (behind.state !== "open" || game.holeCel(behind) !== 3319) fail(`and it should be standing open behind you; it is ${behind.state} on ${game.holeCel(behind)}`);
ok(`a jump clears it, and leaves it open at x ${game.p.x}`);

// 8. the hands. The one at x794 is a param 0 — it comes up under your own
//    feet, wherever those are. Its whole round is six frames up, eleven held
//    (`0x420dc6`) and six down, and it only comes up again under a player
//    standing on the ground inside its rect (`0x420ca9`)
await go(760);
const upHand = () => game.hereOf((l) => l.hands).find((q) => q.underfoot && ["up", "held", "sinking"].includes(q.state));
if (h.until(() => !!upHand(), 60) < 0) fail(`the hand at x794 should come up under the player`);
const hand = upHand()!;
if (hand.atX < 740 || hand.atX > 790) fail(`a param-0 hand takes the player's own x; it came up at x${hand.atX}`);
const handCel = game.handCel(hand);
if (handCel < 1550 || handCel > 1556) fail(`0x470400 tag 0 is 1550..1556; it is showing ${handCel}`);
ok(`a hand comes up under the player's own feet at x${hand.atX}, on cel ${handCel}`);

// 9. ...and the zombies do NOT go in after you, at any of the five.
//
//    GRAVE's rasterised floor really does fall 320 to 370 pixels at each of its
//    five graves, and nine of the sixteen zombie patrol rects span one. What
//    keeps them out is the grave's own ledge: `0x4212bb` appends a synthetic
//    `platform` record to the engine's platform table — `top = y+0x4c`, `left =
//    x-0x64`, `bottom = y+0x7e`, `right = x+0x64`. The port gives foes that
//    ledge in EVERY state rather than only the open one (see `graveLidUnder`),
//    because a grave more than a hundred from the player is shut and its pit is
//    still a pit.
//
//    Run end to end, jumping every mouth, and every zombie watched on every frame.
await go();
let deepest = 0;
let where = "";
h.hold("right", true);
h.hold("up", true);
for (let i = 0; i < 28 * FPS; i++) {
  // ...and jump the mouths, which is what level nine asks of the player
  if (game.p.onGround && [1532, 2446, 2842, 3301, 5522].some((gx) => game.p.x > gx - 190 && game.p.x < gx - 90)) h.press("jump");
  h.frame();
  for (const z of game.spawnedHere()) {
    if (z.kind === "initzomb" && z.state !== "dead" && z.y > deepest) {
      deepest = z.y;
      where = `a zombie at x${Math.round(z.x)}`;
    }
  }
}
h.hold("right", false);
h.hold("up", false);
if (game.p.x < 6000 || game.stats.lives !== 3) fail(`the run should reach the far end of the graveyard on one life; it is at x ${game.p.x} with ${game.stats.lives} lives`);
// the five pit floors are y1232..1346; the ledges sit at y978..990
if (deepest > 1100) fail(`a zombie fell into a grave — ${where} reached y ${deepest}, and the pit floors are y1232..1346`);
ok(`...and no zombie goes into any of the five — deepest y ${deepest}, and the run reached x ${game.p.x}`);

/**
 * 7. ...and what a zombie leaves: its HEAD. `0x420832` calls `0x4208e0` as the
 *    death's tag 0 ends, thirty above its point with `vy -10` and one pixel
 *    backwards; `0x420010` hops it on every landing; and `0x420090` pays 400
 *    to the player's foot (see `HEAD` in props.ts).
 */
await go(1050);
h.frame(6);
const shedder = nearZomb();
game.killFoe(shedder, FOES.initzomb);
if (h.until(() => game.heads.length > 0, 14) < 0) fail(`0x420832 sheds a head as the death's tag 0 ends`);
const head = game.heads[0];
const at = game.foeAnchor(shedder, game.level!)!;
if (head.mode !== 0 || Math.round(head.y) !== Math.round(at.y - 30) || head.west !== shedder.facing > 0)
  fail(`0x420842: thirty above the point, going backwards; it is at y${head.y} (point y${at.y}), west ${head.west}`);
let hops = 0;
let wasDown = false;
for (let i = 0; i < 60 && game.heads.includes(head); i++) {
  h.frame();
  if (wasDown && head.vy < 0) hops++;
  wasDown = head.down;
}
if (hops < 2) fail(`0x420010 reinstalls tag 0 on every landing, and dy -55 lifts it again; it hopped ${hops} times`);
ok(`a felled zombie sheds its head thirty above itself, and the head hops (${hops} hops)`);

// ...and a punch on it: 0135 basketball, four hundred, a green ball — away
// from x1050, where a hand has the player before the fist is out
await go(2900);
h.frame(6);
const ball = { x: 0, y: 0, vx: 0, vy: 0, west: false, mode: 0 as const, clock: 0, down: false };
game.heads.push(ball);
const paid = game.stats.score;
const pops = game.pops.length;
h.press("punch");
for (let i = 0; i < 12 && game.stats.score === paid; i++) {
  // held in front of the fist until the impact frame comes round
  ball.x = game.p.x + 80 * game.p.facing;
  ball.y = game.p.y - 120;
  ball.vx = 0;
  ball.vy = 0;
  ball.west = game.p.facing < 0;
  h.frame();
}
if (game.stats.score - paid !== 400 || game.pops.length <= pops)
  fail(`0x420090 pays 0x190 and leaves a green ball for the player's blow; the score rose ${game.stats.score - paid}`);
ok(`a head struck by the player pays 400 and leaves a green ball`);

pass(`GRAVE's zombies stand, its graves open and take, its hands come up, and its heads come off`);
