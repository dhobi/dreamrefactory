/**
 * MALL — level five, and the first level that is three rooms wide.
 *
 *   npx tsx tools/runmachine.mts mall      (from skullcracker/)
 *
 * Level five opens a chapter whose classes this port had none of, and it is laid
 * out unlike anything before it: **three regions side by side**, overlapping,
 * with no `exitroom` between them. You walk out of one and into the next, which
 * is what the mover's side test does (`0x4300cf`): a point past the end of its
 * region's floor, where the region's flag for that side is clear, goes to
 * whichever region's rect holds it (`0x40b940(2, point)`). There is not a single
 * `platform` record in the level; the whole of it stands on those three floors.
 *
 * What the file says, and what this checks:
 *
 *   - **the rooms hand over at the end of the floor.** Region one's floor runs
 *     to x6879, past its own rect's x6729 and into region two's, and the mover
 *     bounds a region by its floor (`0x40bbd0`, `0x40bc66`) — so the walk east
 *     carries on to x6879 and region two takes over there. Its floor stands
 *     ninety-odd higher at that x, and the landing test (`0x42ff5d`) stands the player on it.
 *   - **one wall on the way.** The floor stands up over fifty pixels at x5338,
 *     and `0x42fef3` throws away a move that cannot climb it. Region two's own
 *     step at x6875 is behind the point it is entered at.
 *   - **the goal is in the third region**, 11000 pixels east of the start.
 */
import { CHEATS } from "../../src/cheats";
import { FOES } from "../../src/foes";
import { type Enemy } from "../../src/brains/kit";
import { fail, headless, ok, pass } from "./harness";

const h = await headless("level=5");
const { game } = h;
const room = (): number => game.level!.rooms.indexOf(game.p.room!) + 1;
const go = async (q = ""): Promise<void> => {
  await h.load(`level=5${q}`);
  h.until(() => game.p.onGround, 60);
  h.frame(4);
};
/**
 * What to look at after every TICK the helpers below step. A cel a blow installs
 * is drawn from the tick after the frame's own, and the next frame tick has
 * already moved it on — 8501, the first cel of both rocking tags at a hold of
 * one, is only ever on screen between frame boundaries.
 */
let watch: (() => void) | null = null;
const step = (n = 1): void => {
  for (let i = 0; i < n * 4; i++) {
    game.tick();
    watch?.();
  }
};
/** hold a key until the state holds, then let go */
const walkUntil = (key: "left" | "right", done: () => boolean, max: number): number => {
  h.hold(key, true);
  let f = 0;
  while (!done() && f < max) {
    step();
    f++;
  }
  h.hold(key, false);
  return done() ? f : -1;
};
const nearestOf = (kind: string): Enemy | undefined =>
  game
    .spawnedHere()
    .filter((e) => e.kind === kind)
    .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];

// 1. it opens where its own initplayer stands, in the first of three rooms
await go();
if (game.p.x !== 112) fail(`MALL should open at its own initplayer, x112; got x ${game.p.x}`);
if (room() !== 1) fail(`it should open in the first region; it is in ${room()}`);
if (game.level!.rooms.length !== 3) fail(`MALL has three regions; it has ${game.level!.rooms.length}`);
ok(`MALL opens at x ${game.p.x}, y ${game.p.y}, in room 1 of 3`);

// 2. the floor stands up at x5338, and a walk stops dead against it
await go("&x=5200");
walkUntil("right", () => game.p.x > 5360, 60);
h.frame(6);
const stopped = game.p.x;
if (stopped > 5350) fail(`the step at x5338 should stop a walk; walked on to x ${stopped}`);
ok(`the floor stands up at x5338 and the walk stops at x ${stopped}`);

// 3. ...and a jump clears it
h.hold("right", true);
h.hold("up", true);
h.press("jump");
h.frame(21);
h.hold("right", false);
h.hold("up", false);
if (game.p.x < 5380) fail(`a jump should clear the step; still at x ${game.p.x}`);
ok(`and a jump puts the player over it, x ${game.p.x}`);

// 4. the seam. Region one's floor runs past its own right edge, so the walk
//    carries on to the floor's end, and the region under the point takes over
await go("&x=6600");
if (room() !== 1) fail(`x6600 is in region one; it is in ${room()}`);
const y1 = game.p.y;
// ...on the tick whose move reaches the floor's end, x6879, and the point goes
// on unheld (`0x4300bd`), so it is wherever that tick's move puts it
let lastX = game.p.x;
h.hold("right", true);
for (let t = 0; t < 240 && room() !== 2; t++) {
  lastX = game.p.x;
  game.tick();
}
h.hold("right", false);
if (room() !== 2) fail(`walking east out of region one never reached region two`);
const handed: number = game.p.x;
if (lastX >= 6879 || handed < 6879)
  fail(`0x4300cf hands over on the move that reaches region one's floor end, x6879; it went from x ${lastX} to x ${handed}`);
h.frame(2);
if (!game.p.onGround || game.p.y !== game.groundAt(game.p.x) || game.p.y >= y1)
  fail(`0x42ff5d stands the player on region two's higher floor; y ${y1} became ${game.p.y}`);
ok(`walking east hands region one over to region two at x ${handed}, onto its floor ${y1 - game.p.y} higher`);

// 5. sixteen enemies in three kinds, and every one of them counts. MALL's
//    share is 75%, and unlike level three there is no kind here that sits
//    outside the census: all three call `0x42f870`.
await go();
const kill = Math.round(game.mission().kill * 100);
if (kill !== 75 || game.stats.census !== 16) fail(`MALL places 9 + 4 + 3 enemies, all counting; the census is kill ${kill}% of ${game.stats.census}`);
const quota = Math.max(0, game.aliveNow() - game.stats.allowance);
const full = game.stats.census - game.stats.allowance;
if (quota !== 12 || full !== 12) fail(`75% of 16 is 12: quota ${quota} of ${full}`);
ok(`its ${game.stats.census} enemies are all in the census, and the quota is 12`);

// 6. they are statues until you come to them — every enemy in this chapter
//    stands dormant on one cel until the player's point is inside its own
//    record's rect (`0x4388dd`, `0x439365`, `0x437c41`).
//
//    The level's own start is the place to watch from: the player stands at
//    x112 and the westmost enemy's territory begins at x236, so it is close
//    enough to be the nearest and far enough to be asleep.
h.frame(38);
const still = new Set<string>();
for (let i = 0; i < 20; i++) {
  h.frame();
  const near = game
    .spawnedHere()
    .filter((e) => FOES[e.kind].panel)
    .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];
  still.add(`${near.kind} ${game.celOf(near)}`);
}
if (still.size !== 1 || !still.has("initmaskboy 1801")) fail(`a dormant masked one holds cel 1801 and nothing else; saw ${[...still].join(", ")}`);
ok(`and they stand dormant on cel 1801 until the player arrives`);

// 7. ...and one of them fought and felled, for what its handler pays
await go("&x=700");
h.frame(6);
const mask = nearestOf("initmaskboy")!;
if (mask.max !== 40 || mask.hp !== 40) fail(`0x4362d7 gives it 0x28 health; it has ${mask.hp}/${mask.max}`);
const before = game.stats.score;
// it skates back and forth through the player, so stand and turn to it rather
// than chase it. The blow is picked by the distance, anchor to anchor: the
// kick's box hangs 95..125 ahead (`0x40e680`), so it is for a skater further
// off and the punch for one on top of you
for (let i = 0; i < 600 && mask.state !== "dead"; i++) {
  const d = mask.x - game.p.x;
  const toward = d > 0 ? "right" : "left";
  if (Math.abs(d) < 150) {
    if (Math.sign(d) !== game.p.facing) {
      h.hold(toward, true);
      h.frame();
      h.hold(toward, false);
    }
    if (!game.p.act) h.press(Math.abs(d) >= 80 ? "kick" : "punch");
    h.frame(3);
  } else if (Math.abs(d) < 300) {
    h.hold(toward, true);
    h.frame();
    h.hold(toward, false);
  } else h.frame();
}
if (mask.state !== "dead") fail(`never felled a masked one`);
h.frame(10);
const paid = game.stats.score - before;
if (paid !== 220) fail(`0x4390ac pays 0xdc for it; the score rose ${paid}`);
ok(`one falls for ${paid} points`);

// ...and leaves a skateboard, as all four of the gang do: `0x43908e` calls the
// same maker `0x438450` the knot and the knife call
if (!game.skates.length) fail(`0x43908e drops a board where a masked one dies; there is none`);
ok(`...and leaves its skateboard behind, at x ${game.skates[0].x}`);

/**
 * 7b. the gang SKATE. `0x4386c4` gives the class a friction of 0.05
 * (`obj+0x1e` = 409 of 8192), so the six-cel run's strides (9, 10, 12, 18 a
 * frame over the divisor of seven) pile up to forty-odd pixels an engine frame
 * and coast. On the allocator's 70% the same strides never pass twenty-three.
 */
await go("&x=700");
const skater = nearestOf("initmaskboy")!;
let peak = 0;
let prev: number | null = null;
for (let i = 0; i < 70; i++) {
  h.frame();
  if (skater.state !== "gait") {
    prev = null;
    continue;
  }
  if (prev !== null) peak = Math.max(peak, Math.abs(skater.x - prev));
  prev = skater.x;
}
if (peak < 30) fail(`a masked one should skate past 30 px a frame on its 0.05 friction; its peak was ${peak}`);
ok(`the masked one skates, peaking at ${peak} px an engine frame`);

// 8. the Coke machine: four cans' worth of punching and then it is empty. Its
//    cels lose their body box at 8505, which is what stops it being hittable.
//
// PUNCH AND KICK IN TURN, not punches alone: a can only comes out of a blow of
// 30 or more (`0x43b6ab`/`0x43b6f5`), and the same move repeated in the same
// facing inside four seconds loses 5 of its strength on every frame of its
// striking tag (`0x4029e0`, floor 20). A different move puts it back to 100
// (`0x402a5a`). And each swing carries the player a few pixels on (its script's
// own dx), so between blows he steps back to where he started and faces it.
await go("&x=700");
h.frame(6);
const blows = ["punch", "kick"] as const;
const stance = (): void => {
  // ...and knocked back WEST of it, which the masked one does to him under
  // `foehit` (`0x430470`), he walks back in, which also faces him east
  if (game.p.x < 685) {
    walkUntil("right", () => game.p.x >= 692, 40);
    step(3);
  }
  if (game.p.x <= 705) return;
  walkUntil("left", () => game.p.x <= 690, 40);
  step(3);
  h.hold("right", true);
  step();
  h.hold("right", false);
  step(3);
};
const coke = nearestOf("initcoke")!;
const cans = new Set<number>();
watch = () => cans.add(game.celOf(coke));
for (let i = 0, n = 0; i < 400 && !cans.has(8505); i++) {
  step();
  if (i % 5 === 0) {
    stance();
    h.press(blows[n++ % 2]);
  }
}
watch = null;
if (!cans.has(8500)) fail(`a Coke machine stands on 8500; saw ${[...cans].join(" ")}`);
if (![8501, 8502].every((c) => cans.has(c))) fail(`punching it should rock it on 8501/8502; saw ${[...cans].join(" ")}`);
if (!cans.has(8505)) fail(`four cans in and it should be showing the emptied 8505; saw ${[...cans].join(" ")}`);
ok(`a Coke machine rocks through ${cans.size} of its own cels and empties on 8505`);

/**
 * ...and the four CANS it was holding, which is what emptying it means.
 *
 * `0x43b6f5` shakes one loose on every third counted blow and `0x43b71a` stops
 * the machine at four. Each is an object of its own — `0x43b780`, cels
 * 8600..8614 — that arcs away from the player at 24 across and 14 up
 * (`0x474ce0` tag 0's `dx 120, dy -70` over the class's divisor of five),
 * settles, and then makes a code-2 pickup where it lies. The pickup itself is
 * invisible, because `0x45afa3` only re-cels 6..17 and no book in the game
 * carries the 14000 a 2 keeps; the can lying there IS the art.
 */
// ...on its own load, because what a can is worth is HEALTH and the switch that
// lets the player lose any is off for the rest of this suite
await go("&x=700&damage=1&foehit=1");
h.frame(8);
const resting = (): boolean => game.cans.length === 4 && game.cans.every((c) => c.rest !== undefined);
for (let i = 0, n = 0; i < 600 && !resting(); i++) {
  h.frame();
  if (i % 4 === 0) {
    stance();
    h.press(blows[n++ % 2]);
  }
}
if (!game.cans.length) fail(`four cans should be lying in front of it — 0x43b6f5; there are none`);
if (game.cans.length !== 4) fail(`0x43b71a stops the machine at four; it gave up ${game.cans.length}`);
if (!resting()) fail(`the four cans should come to rest; ${game.cans.filter((c) => c.rest === undefined).length} still moving`);
const can = game.cans[0];
if (![8600, 8611].includes(game.canCel(can))) fail(`0x474d70 rests a can on 8600 or 8611; this one is on ${game.canCel(can)}`);
// thrown AWAY from the player — `0x43b7e2`, and the machine is at x760
if (game.cans.some((c) => c.x <= 760)) fail(`0x43b7e2 throws a can away from you, so east of x760; they are at ${game.cans.map((c) => c.x).join(" ")}`);
ok(`...and gives up ${game.cans.length} cans, resting on ${game.canCel(can)} east of the machine, at x ${game.cans.map((c) => c.x).join(" ")}`);

/**
 * ...and one is worth a hundred and fifty health. `GUN_CODES[2]` has carried
 * `0x428868`'s case since before anything in the game dropped one, and this is
 * the thing that does: `0x43af80` asks `0x45af60` for a code 2, and `0x43aff0` —
 * the callback it hands over with it — is what takes the can off the floor
 * again when the pickup is taken.
 */
const guns = (): number => game.hereOf((l) => l.guns).length;
// the health has to be DOWN for a can to show what it is worth, so `harakari`
// takes 500 — `0x402ac0(0x1f4)`, see cheats.ts
h.frame(14);
game.runCheat(CHEATS.find((c) => c.word === "harakari")!);
h.frame(6);
const wasGuns = guns();
const wasCans = game.cans.length;
for (let i = 0; i < 30 && !game.gunAhead(); i++) {
  h.hold("right", true);
  h.frame(2);
  h.hold("right", false);
  h.frame(2);
}
if (!game.gunAhead()) fail(`a resting can should come into reach walking east from x700`);
const hurtTo = game.stats.health;
h.hold("down", true);
h.frame(10);
h.hold("down", false);
h.frame(6);
const nowCans = game.cans.length;
// ...and the invariant is that the two lists move TOGETHER: what `0x43aff0`
// guarantees is that a can leaves the floor for every pickup taken
if (nowCans >= wasCans) fail(`taking a pickup should lift its can — 0x43aff0; ${wasCans} cans became ${nowCans}`);
if (wasGuns - guns() !== wasCans - nowCans)
  fail(`a can and its pickup go together: ${wasCans - nowCans} cans went and ${wasGuns - guns()} pickups did`);
const healed = game.stats.health;
if (healed - hurtTo !== 150 * (wasCans - nowCans))
  fail(`0x428868 pays 150 health for a code 2; ${wasCans - nowCans} took it ${hurtTo} -> ${healed}`);
ok(`...and taking ${wasCans - nowCans} is worth health, ${hurtTo} to ${healed}, and lifts the cans with them`);

/**
 * 9. the ROLLER, which is the one hazard a creature in this game builds.
 *
 * `0x438848` sits in the keeper's preamble: two in sixty-eight an engine frame,
 * with the player inside 300 in x and the keeper WEST of him, sends `0x43a790`
 * to build one at the player's own y, six hundred pixels the far side of him.
 * x1200 is the place to stand for it — the masked one at x1146 is 54 west and
 * well inside the 300.
 *
 * Then `0x43a99b` counts `AI+8` down from forty before `0x42f8b0` spends the
 * stored velocity, so it sits on cel 1970 for forty-one frames and only then
 * rolls. It is worth a hundred while it is quick and nothing when it is not
 * (`0x43a993` against `0x43aa34`).
 */
await go("&x=1200");
if (h.until(() => game.rollers.some((r) => r.wait >= 0), 750) < 0)
  fail(`0x438848 should build a roller with the player at x1200; none came in 750 frames`);
const roller = game.rollers.find((r) => r.wait >= 0)!;
if (roller.x !== game.p.x + 0x258) fail(`0x43889c builds it 600 east of the player; he is at x ${game.p.x} and it is at x ${roller.x}`);
if (game.rollerCel(roller) !== 1970) fail(`0x43a8e5 stands it on cel 1970; it showed ${game.rollerCel(roller)}`);
// `0x43887d`'s -480 is not a velocity yet: `0x43a818` stores it in AI+4 and
// nothing writes `obj+0xc` until `0x43a9c4` hands it to `0x42f8b0`
if (roller.vx !== 0) fail(`0x43a818 keeps the -480 in AI+4 until the launch; a waiting roller read vx ${roller.vx}`);
if (game.rollerBlow(roller) !== 0) fail(`a roller that has not been launched is worth nothing; it read ${game.rollerBlow(roller)}`);
ok(`a keeper west of you builds a roller at x ${roller.x}, 600 the far side, waiting on cel 1970`);

// ...and it waits, and then it rolls — west, launched at 480 over a divisor of 7
// (it is seen first on the frame it was built, its count already spent once)
const w0 = roller.wait;
const waited = h.until(() => roller.wait < 0, 60);
if (w0 !== 39 || waited !== 40) fail(`0x43a99b counts AI+8 down from forty before the launch; it read ${w0} and launched ${waited} frames later`);
const cels = new Set<number>();
const vxs: number[] = [];
let armed = 0;
for (let i = 0; i < 10; i++) {
  vxs.push(roller.vx);
  cels.add(game.rollerCel(roller));
  armed = Math.max(armed, game.rollerBlow(roller));
  h.frame();
}
/**
 * `0x43a9c4` hands AI+4's -480 to `0x42f8b0`, which adds it over the divisor of
 * 7, rounded away from zero: 69 a frame. And the ground takes it back:
 * `0x43a7c8` calls `0x42f7a0(obj, 0.1)`, which writes a tenth (819/8192) to the
 * drag word `obj+0x1e`, and the mover spends that on every frame that ends on a
 * floor (`0x4302c0`). So it leaves at 69, holds that while it is in the air,
 * and slows by a tenth a frame once it is down.
 */
if (vxs[0] !== -69) fail(`0x42f8b0 launches it at -480/7 = -69; the first rolling vx was ${vxs[0]}`);
if (!vxs.every((v, i) => i === 0 || (v < 0 && Math.abs(v) <= Math.abs(vxs[i - 1]))))
  fail(`nothing but the ground's drag touches a roller, so its speed never grows; vx went ${vxs.join(",")}`);
if (Math.abs(vxs[vxs.length - 1]) >= 69) fail(`0x42f7a0's tenth, spent at 0x4302c0, slows it on the ground; vx stayed at ${vxs.join(",")}`);
if (![...cels].every((c) => c === 1970 || c === 1971) || cels.size !== 2) fail(`0x4747e8 tag 0 is cels 1970 and 1971; saw ${[...cels].join(",")}`);
if (armed !== 0x64) fail(`0x43a993 makes a moving one worth 0x64; it read ${armed}`);
ok(`...and it waits its forty frames, then rolls west from 69 a frame, slowing on the ground (vx ${vxs.join(",")}) on ${[...cels].sort().join(",")}, worth ${armed}`);

// 10. the whole level, end to end, on its own jumps
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
for (let i = 0; i < 1000 && !arrived; i++) {
  h.frame();
  if (atGoal()) {
    arrived = true;
    break;
  }
  if (game.p.x < best + 3) {
    stuck += 1;
    /**
     * ...and a wall is jumped with a RUN-UP, not from standing against it.
     * `0x42fee8` asks the whole frame's move of the floor ahead, and where that
     * floor stands more than fifty above the new point `0x42fef7` puts the
     * point back and zeroes `obj+0xa` — the rise with it. So: back off, and
     * jump on the way in, a little short of where the wall stopped him.
     */
    if (stuck === 4) {
      const wall = game.p.x;
      h.hold("right", false);
      walkUntil("left", () => game.p.x <= wall - 140, 40);
      h.hold("right", true);
      h.until(() => game.p.x >= wall - 60, 60);
      h.press("jump");
      jumps += 1;
      stuck = 0;
      best = game.p.x;
    }
    if (stuck > 30) break;
  } else {
    stuck = 0;
    best = game.p.x;
  }
}
h.hold("right", false);
h.hold("up", false);
if (!arrived) fail(`never reached MALL's goal; stopped at x ${game.p.x}, y ${game.p.y}`);
if (jumps > 2) fail(`the level's own wall is one; this took ${jumps} jumps`);
if (room() !== 3) fail(`the goal is in the third region; it is in ${room()}`);
ok(`ran all three rooms to the goal at x ${game.p.x}, y ${game.p.y}, on ${jumps} jump${jumps === 1 ? "" : "s"}`);

// the roaches. The nest at x6004 lets them out beside a ramp, and a roach that
// runs off its top end falls: `0x43b1be` gave it a gravity of 0.6 and the mover
// spends it whenever there is no floor, running or not. They used to keep the
// height of the ramp's end and run on across the air
{
  await go("&foes=0&x=6004&y=8221");
  let offRamp = 0;
  for (let f = 0; f < 300; f++) {
    h.frame(1);
    for (const r of game.roaches) {
      if (r.onGround && game.surfaceUnder(r.x, r.y - 2, r.y + 2) === null)
        fail(`a roach stands at x${Math.round(r.x)}, y${Math.round(r.y)} with no floor under it`);
      if (r.running && !r.onGround) offRamp += 1;
    }
  }
  if (!offRamp) fail(`no roach ran off the ramp's end in 300 frames`);
  ok(`the roaches stand on floor or fall to it, ${offRamp} roach-frames of them in the air off the ramp`);
}

pass(`MALL's three regions hand over on foot, and its goal can be reached`);
