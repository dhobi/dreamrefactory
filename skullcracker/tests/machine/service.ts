/**
 * SERVICE — level six, and the first level with machinery you can switch on.
 *
 *   npx tsx tools/runmachine.mts service      (from skullcracker/)
 *
 * Every level before this one is a route with things standing in it. SERVICE is
 * a route with a system: six `switch` records, twenty-two `initgoop` records
 * paired to them by `param` 501…506, and a gang who walk to the levers in their
 * own territory and throw them ON — because goop is what heals them.
 *
 * What the file says, and what this checks:
 *
 *   - **two new classes.** `initknifeboy` (25 health, 240 points, plate 13104)
 *     and `inithardcore` (750, 350, 13105), both dormant on one cel until the
 *     player's point is inside their own record's rect.
 *   - **the lever is a two-position toggle.** `0x436820(pos, dir)`: dir 0 throws
 *     an off one on, dir 1 throws an on one off, and nothing else answers. The
 *     player asks for dir 0 by standing at it with no direction held
 *     (`0x42987c`) and dir 1 by holding S (`0x4298ab`).
 *   - **the broadcast.** `0x43c3d0`, at the END of each throw, flips the tag of
 *     every goop on the same `param`.
 *   - **the gang throw them.** `0x438200` finds the first unlit lever inside
 *     the thing's own rect; it walks over and one frame of the reach calls
 *     `0x436820(lever, 0)`. Running east across the level lights them behind you.
 *   - **one cel of nine can touch you.** Only 518, the gob, carries a strike box
 *     and a blow pair, so the rest of the goop is weather.
 */
import { FOES } from "../../src/foes";
import { type Enemy } from "../../src/brains/kit";
import { SKATEBOARD } from "../../src/props";
import { FPS, fail, headless, ok, pass, recordSound } from "./harness";

const h = await headless("level=6");
const { game } = h;
const go = async (x?: number, damage = false): Promise<void> => {
  await h.load(`level=6${x === undefined ? "" : `&x=${x}`}${damage ? "&damage=1" : ""}`);
  h.until(() => game.p.onGround, 60);
  h.frame(4);
};
const lever = (param: number): string => game.switchesHere().find((w) => w.param === param)?.state ?? "?";
const onNow = (): number => game.nestsHere().filter((n) => n.on).length;
const nearestPlated = (): Enemy | undefined =>
  game
    .spawnedHere()
    .filter((e) => FOES[e.kind].panel)
    .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];

// 1. it opens where its own initplayer stands, in the one room it has
await go();
if (game.p.x !== 116) fail(`SERVICE should open at its own initplayer, x116; got x ${game.p.x}`);
if (game.level!.rooms.length !== 1) fail(`SERVICE is one region; it has ${game.level!.rooms.length}`);
ok(`SERVICE opens at x ${game.p.x}, y ${game.p.y}, in its one room`);

// 2. fifteen enemies of five kinds, and every one of them is in the census
const all = game.spawnedHere().length;
if (all !== 15) fail(`SERVICE places 4 + 3 + 3 + 4 + 1 enemies; ${all} spawned`);
const kill = Math.round(game.mission().kill * 100);
if (kill !== 75 || game.stats.census !== 15) fail(`all fifteen call 0x42f870; the census is kill ${kill}% of ${game.stats.census}`);
const quota = Math.max(0, game.aliveNow() - game.stats.allowance);
if (quota !== 11 || game.stats.census - game.stats.allowance !== 11) fail(`75% of 15 is 11: quota ${quota} of ${game.stats.census - game.stats.allowance}`);
ok(`its ${all} enemies are all in the census, and the quota is 11`);

// 3. the one with the knife: 25 health, and a statue on 1841 outside its rect.
//    Its territory is x565..1123, so x1200 is close enough to be the nearest
//    plated thing and far enough to leave it asleep.
await go(1200);
h.frame(22);
const still = new Set<number>();
for (let i = 0; i < 20; i++) {
  h.frame();
  const k = nearestPlated();
  if (k?.kind !== "initknifeboy") fail(`the one with the knife should be the nearest plated thing at x1200; it is ${k?.kind}`);
  if (k.max !== 25) fail(`0x436419 gives it 0x19 health; it has ${k.hp}/${k.max}`);
  still.add(game.celOf(k));
}
if (still.size !== 1 || !still.has(1841)) fail(`a dormant one holds 1841 and nothing else; saw ${[...still].join(" ")}`);
ok(`the one with the knife stands on 1841 with 25 health until you arrive`);

// 4. ...and the one at the end of the level: 750, dormant on 6070. Its rect
//    runs x8418..9191, which is the last stretch and the goal with it.
await go(8400);
h.frame(22);
const boss = new Set<number>();
for (let i = 0; i < 20; i++) {
  h.frame();
  const b = nearestPlated();
  if (b?.kind !== "inithardcore") fail(`the one at the end should be the nearest plated thing at x8400; it is ${b?.kind}`);
  if (b.max !== 750) fail(`0x4364b4 gives it 0x2ee health; it has ${b.hp}/${b.max}`);
  boss.add(game.celOf(b));
}
if (boss.size !== 1 || !boss.has(6070)) fail(`it holds 6070 and nothing else; saw ${[...boss].join(" ")}`);
ok(`and the one at the end stands on 6070 with 750 health`);

// 4b. ...and the goal waits for it: `0x43b9ec` asks `[0x472574]`, which only
//     its death writes (`0x43d309`), after the count
if (game.waitsFor() !== "HARDCORE") fail(`SERVICE's goal waits for the one at the end — 0x43b9ec`);
ok(`and SERVICE's goal waits for it as well as for the count`);

/**
 * 4c. hit it, and the flinch hands on to the walk or the swipe — `0x43d062`, a
 * coin between `0x474a38` (kind 3) and `0x4749c8` (kind 6). Never the stance
 * and never back into whatever it was doing.
 */
await go(8700);
const hc = game.spawnedHere().find((e) => e.kind === "inithardcore")!;
let after = -1;
let flinched = false;
for (let i = 0; i < 600 && after < 0; i++) {
  if (hc.state === "flinch") {
    flinched = true;
    h.frame();
    continue;
  }
  // kind 8 is the flinch's own state, held the one frame the coin takes
  if (flinched) {
    if (hc.script !== undefined && hc.script !== 8) after = hc.script;
    else h.frame();
    continue;
  }
  const d = hc.x - game.p.x;
  if (Math.abs(d) < 90) {
    if (Math.sign(d) !== game.p.facing && d !== 0) {
      const key = d > 0 ? "right" : "left";
      h.hold(key, true);
      h.frame();
      h.hold(key, false);
    }
    if (!game.p.act) h.press("kick");
    h.frame();
  } else {
    const key = d > 0 ? "right" : "left";
    h.hold(key, true);
    h.frame();
    h.hold(key, false);
  }
}
if (!flinched) fail(`never landed a blow on the one at the end`);
if (after !== 3 && after !== 6) fail(`0x43d062 hands a flinch to kind 3 or kind 6; it went to kind ${after}`);
ok(`a blow on it flinches, and the flinch hands on to kind ${after}`);

/**
 * 4d. ...and the blow that fells it. `0x43d28b` hands `0x40cba0` no hitter, so
 * its goo goes both ways whatever way the blow went; and state 9 calls
 * `0x42f7f0(obj, 0.7)` (`0x43d0c5`), so the body its death throws up comes
 * down BOUNCING, with 0x3d on every landing that hands speed back (`0x43d0d3`).
 */
await go(8700);
const felled = game.spawnedHere().find((e) => e.kind === "inithardcore")!;
felled.hp = 1;
const heard = recordSound(game);
const gobsWere = game.gobs.length;
game.strikeFoe(felled, 120, { dx: 40, dy: 0 }, 1, felled.y, { top: 0, left: 0, bottom: 1, right: 1 });
const goo = game.gobs.slice(gobsWere);
if (goo.length !== 20 || !goo.some((g) => g.vx < 0) || !goo.some((g) => g.vx > 0))
  fail(`a blow of 120 from the west should throw twenty gobs both ways; ${goo.map((g) => Math.sign(g.vx)).join(" ")}`);
if (felled.state !== "dead") fail(`a blow past its health should fell it; it is ${felled.state}`);
const thuds = (): number => heard.filter((c) => c.call === "effect" && c.args[0] === 0x3d).length;
let rose = false;
for (let i = 0; i < 30; i++) {
  h.frame();
  if (thuds() > 0 && felled.vy < 0) rose = true;
}
const landed = thuds();
if (!rose || landed < 2) fail(`at seven tenths the body should come back up off the floor and land again: ${landed} thuds`);
h.frame(30);
if (thuds() !== landed || felled.vy !== 0) fail(`...and then lie still and quiet: ${thuds() - landed} more thuds, vy ${felled.vy}`);
ok(`it bleeds both ways, and its body bounces with ${landed} thuds before it lies still`);

// 5. six levers, and every one of them starts off
await go();
const levers = game.switchesHere();
if (levers.length !== 6) fail(`SERVICE places six switches; there are ${levers.length}`);
if (!levers.every((l) => l.state === "off")) fail(`they are created on tag 3, which is off: ${levers.map((l) => `${l.param} ${l.state}`).join(", ")}`);
if (game.nestsHere().length !== 22 || onNow() !== 0) fail(`and none of its 22 nests is dripping yet: ${onNow()} of ${game.nestsHere().length} on`);
ok(`its six levers all start off, and none of its 22 nests is running`);

// 6. standing at one throws it ON — `0x42987c`, which asks with no direction
//    held — and the broadcast at the end of the throw starts its own goop
await go(400);
if (h.until(() => lever(501) === "on", 48) < 0) fail(`standing at a lever should throw it; it is ${lever(501)}`);
h.frame(6);
if (onNow() !== 2) fail(`501's two nests should now be running: ${onNow()} on`);
let fell = 0;
for (let i = 0; i < 3 * FPS; i++) {
  h.frame();
  fell = Math.max(fell, game.drips.length);
}
if (fell === 0) fail(`a running nest drips 42 frames in 512; nothing fell in three seconds`);
ok(`standing at 501 throws it on, and its two nests drip — ${fell} in the air at once`);

// 7. ...and S throws it back. `0x4298ab` is the only ask that turns one off.
h.hold("down", true);
const seen: string[] = [];
h.until(() => {
  if (seen[seen.length - 1] !== lever(501)) seen.push(lever(501));
  return lever(501) === "off";
}, 20);
h.hold("down", false);
if (lever(501) !== "off") fail(`S should throw a lit lever back; it is ${lever(501)}`);
// five cels at one engine frame each: it is thrown, it does not snap
if (!seen.includes("turningOff")) fail(`and the throw should be seen, not snap: saw ${seen.join(" ")}`);
if (onNow() !== 0) fail(`and the broadcast should stop its goop: ${onNow()} on`);
ok(`and S throws it back (${seen.join(" -> ")}), which stops the two nests it broadcasts to`);

// 8. the gang throw them. x700 is inside the territory of the two that keep 501
//    and outside the lever's own rect, so nothing the player does can account
//    for it going on.
await go(700);
if (h.until(() => lever(501) !== "off", 120) < 0) fail(`a woken keeper should walk to its own lever and throw it; 501 is still off`);
ok(`a woken keeper walks to 501 and throws it on by itself`);

// 9. one with the knife fought and felled, for what its handler pays. The
//    fourth of them, at x7634, is the only one in the level with no other plated
//    thing near it. The reach is AHEAD of the anchor, not on it: the kick's
//    impact cel 655 hangs its strike rect 42..63 in front, and the lunge carries
//    it further out, so the player faces it and kicks while it is 30..200 ahead
await go(7500);
h.frame(10);
const knife = game
  .spawnedHere()
  .filter((e) => e.kind === "initknifeboy")
  .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];
const before = game.stats.score;
let lastX = game.p.x;
let stalled = 0;
for (let i = 0; i < 600 && knife.state !== "dead"; i++) {
  const d = knife.x - game.p.x;
  const dy = knife.y - game.p.y;
  const ahead = d * game.p.facing;
  if (ahead > 30 && ahead < 200 && Math.abs(dy) < 60) {
    if (!game.p.act) h.press("kick");
    h.frame(3);
    stalled = 0;
  } else {
    const key = d > 0 ? "right" : "left";
    h.hold(key, true);
    h.frame();
    h.hold(key, false);
    // a walk that has stopped against a step needs a jump, not more walking
    if (Math.abs(game.p.x - lastX) < 2) {
      if (++stalled >= 3) {
        h.press("jump");
        h.frame(5);
        stalled = 0;
      }
    } else stalled = 0;
  }
  lastX = game.p.x;
}
if (knife.state !== "dead") fail(`never felled one with the knife: ${knife.hp}/${knife.max}`);
h.frame(1);
const points = game.stats.score - before;
if (points !== 240) fail(`0x43a711 pays 0xf0 for it; the score rose ${points}`);
ok(`one with the knife falls for ${points} points`);

/**
 * ...and it leaves its BOARD. `0x43a6f9` calls `0x438450` out of the hit handler
 * on the frame it dies, and what comes out is the one object in the game whose
 * whole life is physics: it hops out on `dx 15 dy -50` over a divisor of five,
 * falls at the birth weight of ten, bounces through a restitution of 0.3 and
 * slides to a stop on a friction of 0.05. `0x4385af` then reads `noskateboards`
 * at its own point and seeds `AI+0xa` with ten frames or a hundred and eighty.
 */
if (!game.skates.length) fail(`0x43a6f9 drops a board where one of these dies; there is none`);
const board = game.skates[0];
const boardCels = new Set<number>();
let life = 0;
for (let i = 0; i < 4 * FPS && game.skates.includes(board); i++) {
  // 2311 is `0x473de8` tag 0, the hop, and 2310 tag 1 — where it lies once a
  // surface is under it (`0x4377c4`)
  boardCels.add(board.down ? SKATEBOARD.rest : SKATEBOARD.hop.cel);
  life = Math.max(life, board.life);
  h.frame();
}
if (![...boardCels].every((c) => c === 2310 || c === 2311)) fail(`a board is cel 2311 in the air and 2310 down; saw ${[...boardCels].join(",")}`);
if (!boardCels.has(2310)) fail(`0x4377c4 puts tag 1 on the frame a surface is under it; it never came down`);
if (life > 0xb4) fail(`0x4385d0 seeds it 180 at most; it read ${life}`);
ok(`...and leaves its board — cels ${[...boardCels].sort().join(",")}, lying there ${life} frames`);
// and it is swept up: `0x437809` spends one a frame and removes it at -1
if (h.until(() => !game.skates.includes(board), 200) < 0) fail(`0x437809 removes it when AI+0xa goes negative; it is still there`);
ok(`...and 0x437809 sweeps it up again`);

// 10. the goop hits back, once the switch that lets anything hit back is on.
//     Only cel 518 carries a strike box, so this is the gob and nothing else.
await go(400, true);
if (!game.damageOn || game.stats.health !== 1200 || game.stats.maxHealth !== 1200) fail(`?damage=1 should arm it full; ${game.stats.health}/${game.stats.maxHealth}`);
if (h.until(() => game.stats.health < 1200, 180) < 0) fail(`standing under a running nest should cost health; still ${game.stats.health}`);
ok(`with damage armed, its goop takes the player down to ${game.stats.health}`);

/**
 * 11. the whole level, end to end, over its own steps — and the levers lit
 *     behind it, because every one of the six is somebody's.
 *
 * A step is jumped from a STANDSTILL and steered on to. Held forward into the
 * riser, the launch frame's move asks `0x42fedc` about the floor ahead with the
 * rise already added, finds it more than 50 above, and `0x42ff0c` zeroes the
 * vertical velocity with the move: a jump taken pressed against a step never
 * leaves the ground. With forward released there is no move to ask about, the
 * rise goes up clear, and the air control that starts two frames later carries
 * the player over. The x6222 riser (the floor jumps 8517 -> 8316) wants more
 * than that: its stair is two platforms at x6105 and x6115 whose bodies the
 * walking feet pass BELOW (`0x42fe86` only catches a foot inside a platform's
 * body), so a second try at the same place backs off and takes it at a run.
 * And every jump is HELD — the lift allowance makes it 137 high to a plain
 * one's 80 — because the top of that stair is 98 above its upper platform, and
 * a jump that meets the riser short of it is thrown back (`0x42ff13`).
 */
await go();
const atGoal = (): boolean => {
  const g = game.solids().goal;
  if (game.craftOpened() || game.craft?.state === "open") return true;
  if (!g) return false;
  const box = game.playerBox();
  return box.right > g.left && box.left < g.right && box.bottom > g.top && box.top < g.bottom;
};
h.hold("right", true);
h.hold("up", true);
let arrived = false;
// progress is the furthest east reached: a walk into a wall is thrown back
// frame after frame (`0x42ff13`), so standing still is not what stuck looks like
let best = game.p.x;
let stuck = 0;
let jumps = 0;
let tries = 0;
let stuckAt = -1;
for (let i = 0; i < 900 && !arrived; i++) {
  h.frame();
  if (atGoal()) {
    arrived = true;
    break;
  }
  if (game.p.x < best + 3) {
    stuck += 1;
    if (stuck === 4) {
      tries = Math.abs(game.p.x - stuckAt) < 30 ? tries + 1 : 0;
      stuckAt = game.p.x;
      jumps += 1;
      h.hold("right", false);
      if (tries % 2 === 1) {
        h.hold("left", true);
        h.frame(10);
        h.hold("left", false);
        h.hold("right", true);
        h.frame(6);
        h.hold("jump", true);
        h.frame(4);
        h.hold("jump", false);
      } else {
        h.frame(2);
        h.hold("jump", true);
        h.frame(2);
        h.hold("right", true);
        h.frame(2);
        h.hold("jump", false);
      }
      stuck = 0;
      best = game.p.x;
    }
    if (jumps > 20) break;
  } else {
    stuck = 0;
    best = game.p.x;
  }
}
h.hold("right", false);
h.hold("up", false);
if (!arrived) fail(`never reached SERVICE's goal; stopped at x ${game.p.x}, y ${game.p.y}`);
// four risers (x806, x3830, x6222 with its run-up, x6902) is five jumps
if (jumps > 8) fail(`the level's own risers are four; this took ${jumps} jumps`);
const lit = game.switchesHere().filter((w) => w.state === "on" || w.state === "turningOn").length;
if (lit < 5) fail(`running past every keeper should light nearly all six; ${lit} are lit`);
ok(`ran the level to the goal at x ${game.p.x}, y ${game.p.y}, on ${jumps} jumps, ${lit} of 6 levers lit behind`);

pass(`SERVICE's two new classes stand, its levers pour, and its goal can be reached`);
