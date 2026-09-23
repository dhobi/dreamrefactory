/**
 * Do the enemies come at you — and is it the disc's own brain that brings them?
 *
 *   npx tsx tests/machine/fights.ts        (from skullcracker/)
 *
 * `src/fights.ts` has the mechanism and every address it was read from. What
 * this asserts is that the parts of it that can be seen from outside are the
 * exe's parts and not a chase written to look like one:
 *
 *   - **the rect is what wakes it.** `0x44e5fb` is state 0 and the only thing
 *     that ends it is `0x434200` finding the player's own point inside the four
 *     words the creator copied out of the `init` record. So a punk twelve hundred
 *     pixels away in the same room does NOT notice, and the one whose patch you
 *     are standing in does.
 *   - **it closes.** The far bands install the class's walk, so five hundred
 *     pixels of gap have to come down to the last band of the class's own
 *     table. Its rect is 8971..10110 and its point 9540, so standing at x10050
 *     is inside the territory and half a screen from the thing that owns it.
 *   - **it swings at the innermost band.** `initwerea`'s table is `330 200 150
 *     80` (`0x477600`), and inside eighty pixels it plays a cel that carries a
 *     STRIKE BOX — which is the engine's own mark for an attacking frame and the
 *     same flag `0x45efd0` reads at `out+6` to tell whether the PLAYER is
 *     swinging. STREETS holds 1923, 1924, 1931, 1932, 1934, 1935 and 1943 and
 *     they belong to nothing else in the level.
 *   - **it turns to face you.** `0x44e73c` flips the facing when the forward
 *     distance is negative, and that is the whole of the frame.
 *   - **and none of it takes a point of health**, which is the brief. The blow
 *     the cels carry is read and wired, and it sits behind `?foehit=1`.
 *
 * ## The trap
 *
 * "The punk is nearer than it was" proves very little on its own: a patrol walks
 * up and down and half of that is toward you. So the two legs that matter are
 * the pair — the far one must NOT close over the same window in which the near
 * one does, and the near one must cross its own rect edge, which no patrol ever
 * does.
 */
import { FOES } from "../../src/foes";
import { fail, headless, ok, pass } from "./harness";

/** `0x477600` — the punk's own band table, and the last of them is the swing */
const SWING_BAND = 80;
/** STREETS' punk attack cels, the ones carrying a strike box in that book */
const STRIKES = [1923, 1924, 1931, 1932, 1934, 1935, 1943];

const h = await headless("level=1&x=7400");
const { game } = h;
const { p, stats } = game;

/** the nearest thing that claims the panel's bar, which is what a fight is with */
const near = () => {
  const n = game
    .spawnedHere()
    .filter((e) => FOES[e.kind].panel)
    .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
  if (!n) fail(`nothing that fights is spawned near x ${p.x}`);
  return n;
};
const fighting = (): number => game.spawnedHere().filter((e) => e.fighting).length;
const gap = (): number => Math.abs(near().x - p.x);

// 1. out of every rect in the room and nobody has noticed. STREETS' punk
//    territories run 2197..7026 and then 7758..10110, and x7400 is the gap
//    between them — the same room and, in step 2, the same foes
h.frame(45);
if (fighting() !== 0) fail(`nothing should have noticed at x7400: ${fighting()} fighting`);
const idle = near();
if (idle.fighting) fail(`${idle.kind} is fighting from x${idle.x} with the player at x7400`);
ok(`nobody notices from x7400 in 45 frames — the nearest is ${idle.kind} at x ${Math.round(idle.x)}, patrolling`);

// 2. ...and standing in one, the class in it does. The rect is the record's,
//    not a radius: this is the same room and the same foes as step 1
await h.load("level=1&x=10050");
h.frame(16);
/**
 * ...and "the nearest" is not "the one that noticed". A class with a machine of
 * its own moves: `initwerea` leaps, steps in, backs off and goes home when its
 * decision budget runs out, so the punk closest to the player from one frame to
 * the next is not always the one whose rect he is standing in. The count is the
 * assertion; which body happens to be nearest is not.
 */
if (fighting() < 1) fail(`standing at x10050 should wake somebody within 16 frames`);
ok(`standing at x10050 wakes ${fighting()} of them — 0x434200 on the record's own rect`);

// 3. it closes, and it keeps closing past the point a patrol would turn.
//    ...and it takes its time about it. A class with its own machine does not
//    march: `initwerea` leaps in, lands, walks, holds the stance while it spends
//    `AI+4`, taunts on `AI+2`'s beat and only then commits.
const first = gap();
let closest = first;
for (let i = 0; i < 300; i++) {
  h.frame();
  closest = Math.min(closest, gap());
}
if (closest >= first) fail(`it should have closed from ${first}px; the nearest it got was ${closest}px`);
/**
 * ...and what it must reach is the TAUNT band, not the punch band.
 *
 * `0x44e909` spends one of `AI+4` each time the stance comes round and only
 * commits when they run out, `0x44e982` counts `AI+2` down between taunts, and
 * `0x44e7a8` answers a swing by backing off half the time. So a punk crosses
 * the 80px band when its own dice say so. What is not a coin flip is that it
 * gets inside 150 and then swings, and the next check is what proves the swing.
 */
const TAUNT_BAND = 150;
if (closest > TAUNT_BAND) fail(`0x477600's taunt band is ${TAUNT_BAND}px and it never got nearer than ${closest}px`);
ok(`it closed from ${Math.round(first)}px to ${Math.round(closest)}px in 300 frames — inside the ${TAUNT_BAND}px band, on a table that ends on ${SWING_BAND}`);

// 4. and inside that band it plays a frame that carries a strike box. The CELS
//    are the proof, not the flag: `0x4771d8` and `0x477368` are the only
//    scripts that carry one, so a strike cel appearing at all cannot be chance
const seen = new Set<number>();
let swung = false;
for (let i = 0; i < 90; i++) {
  h.frame();
  const n = near();
  seen.add(game.celOf(n));
  if (n.fighting && n.swing) swung = true;
}
const hits = [...seen].filter((c) => STRIKES.includes(c));
if (!swung && !hits.length) fail(`it never entered a swing: cels ${[...seen].join(" ")}`);
if (hits.length === 0) fail(`a swing has to reach a strike cel; saw ${[...seen].join(" ")}`);
ok(`and it swings on its own strike cels — ${hits.join(", ")}`);

// 5. no health moves. The switch above it is off and so is its own
if (game.damageOn) fail(`this should all happen with damage off`);
if (game.foesHurt) fail(`...and with the creatures' own blow switched off`);
if (stats.health !== stats.maxHealth) fail(`the player's health moved: ${stats.health}/${stats.maxHealth}`);
ok(`and the player's health never enters it — ${stats.health}/${stats.maxHealth}, both switches off`);

// 6. it turns to face you — `0x44e73c`. Get past it and it comes back: the
//    SAME body, not whichever is nearest by then. Walking into it only shoves
//    it west ahead of the player (`bodyPush`, 0x430680), so this goes over the
//    top of it — the running jump, W and J with the direction held
const it = near();
const before = it.x;
if (it.facing < 0 || p.x < before) fail(`meant to start east of it, facing the player: it is at x${before} facing ${it.facing}, the player at x${p.x}`);
h.hold("left", true);
h.hold("up", true);
const over = h.until(() => {
  if (p.onGround && !game.jumpPressed) h.press("jump");
  return p.x < it.x - 100 && p.onGround;
}, 90);
h.hold("left", false);
h.hold("up", false);
if (over < 0) fail(`meant to get west past it; the player is at x${p.x} and it is at x${it.x}`);
const followed = h.until(() => it.facing < 0 && it.x < before - 50, 90);
if (followed < 0) fail(`it should have turned and followed west of x${before}; it is at x${it.x} facing ${it.facing}`);
ok(`jumped past it to x ${p.x} and it turned west and came after — x ${Math.round(before)} to ${Math.round(it.x)}`);

// 7. and a class with a machine of its own is still driven by that one, not
//    the shared brain: level eight's boss has `drives` and reports its own state
await h.load("level=8&x=1500");
h.frame(30);
const boss = game.spawnedHere().find((e) => FOES[e.kind].haunts || FOES[e.kind].preaches || FOES[e.kind].drives);
if (!boss) fail(`level eight should spawn its boss near x1500: ${game.spawnedHere().map((e) => e.kind).join(" ")}`);
if (!boss.mode && boss.script === undefined) fail(`the level-eight boss should report the state its own machine is in`);
if (game.spawnedHere().some((e) => e.kind === "initwbooly" && e.fighting))
  fail(`the boss must not be driven by the shared brain`);
ok(`and the boss keeps its own machine — ${boss.kind} ${boss.mode ? `mode ${boss.mode}` : `kind ${boss.script} tag ${boss.tag ?? 0}`}`);

// the exchange runs only on a nonzero answer from the victim's handler
// (`0x43042b`): kragg's is 1 below state 9 and 0 from there (`0x441d26`), and
// the hydrant's and the CHOPPER's are 0 on every path
{
  const exchanged = (kind: string, script: number): boolean => {
    const foe = FOES[kind];
    const e = {
      kind, x: game.p.x + 60, y: game.p.y, facing: -1, left: 0, right: 99999, top: 0, bottom: 99999,
      clock: 0, state: "gait", anim: foe.gait, linger: 0, dents: 0, vx: 0, vy: 0,
      hp: 5000, max: 5000, script,
    } as Parameters<typeof game.strikeFoe>[0];
    let recoiled = false;
    game.strikeFoe(e, 10, { dx: 40, dy: 0 }, 1, e.x, { top: 0, left: 0, bottom: 1, right: 1 }, 0, undefined,
      { mass: 12, vx: 5, vy: 0, recoil: () => { recoiled = true; } });
    return recoiled;
  };
  if (!exchanged("initkragg", 1)) fail(`kragg flying (state 1) answers 1, and the blow is exchanged`);
  if (exchanged("initkragg", 12)) fail(`kragg grounded (state 12) answers 0 (0x441ef0), and nothing is exchanged`);
  if (exchanged("inithydrant", 1)) fail(`the hydrant's handler answers 0 (0x44fc0d), and nothing is exchanged`);
  if (!exchanged("initzomb", 1)) fail(`an ordinary handler answers 1 (the zombie's 0x420acf), and the blow is exchanged`);
  ok(`the velocity exchange follows the handler's answer: kragg flying yes, grounded no, the hydrant never`);
}

pass("the shared AI notices you on its own rect, closes, swings on its own strike cels, and takes nothing");
