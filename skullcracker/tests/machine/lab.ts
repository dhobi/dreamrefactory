/**
 * LAB — level fifteen.
 *
 *   npx tsx tools/runmachine.mts lab      (from skullcracker/)
 *
 * Forty-five records and three new classes, and `lab.snd` names all three:
 *
 *   - **Puke Boy** (`initpuke`), `#0061 Pukeboy d[ies]` — four hundred health,
 *     440 points, and a run whose eight records carry 186, 93, 186, 93, 279, 93,
 *     279, 93. Nothing else in the game alternates its stride.
 *   - **the arm** (`initarm`), `#2013 arm hit` — ten of them, and no health at
 *     all: `0x418b40` sprays, sounds, pays 113 and subtracts nothing. One blow,
 *     whatever the blow. It does not count towards the census.
 *   - **the test tube** (`inittube`), `#0201 test tube` — one in the game, with
 *     twelve hundred health, the player's own number, and no award.
 */
import { fail, headless, ok, pass, recordSound } from "./harness";
import { FOES } from "../../src/foes";
import { TUBE, TUBE_BREATH, TUBE_SHARDS, tube } from "../../src/brains/tube";
import { armGate } from "../../src/brains/arm";
import type { BrainCtx, CastKit, Enemy } from "../../src/brains/kit";

/**
 * The machines on their own: `tube` handed a stand-in context and called once
 * an engine frame, as `stepFight` calls it; and the two classes' records.
 */
const machines = (): void => {
  // `0x418b58`: an arm that has hold of you turns every blow away
  {
    const blow = { damage: 50, code: 0, by: { player: true } };
    const held = { script: 5 } as unknown as Enemy;
    const loose = { script: 2 } as unknown as Enemy;
    if (armGate(held, FOES.initarm, blow) !== null || armGate(loose, FOES.initarm, blow) !== blow)
      fail(`0x418b58 refuses every blow in state 5, and only there`);
    ok(`an arm that holds you cannot be struck`);
  }
  const casts: CastKit[] = [];
  const said: number[] = [];
  let rolls: number[] = [];
  const k = {
    player: { x: 0, y: 0, top: 0, anchor: 0, vy: 0, swinging: false, down: false, facing: 1 },
    anchorY: (e: Enemy) => e.y,
    anchorX: (e: Enemy) => e.x,
    shake: () => {},
    flash: () => {},
    burn: () => {},
    spray: () => {},
    track: () => ({ forward: 200, dy: 0, band: 1, side: 1 }),
    roll: () => rolls.shift() ?? 1,
    say: (_e: Enemy, id: number) => said.push(id),
    cast: (_e: Enemy, kit: CastKit) => casts.push(kit),
    gravity: 1,
  } as unknown as BrainCtx;
  const T = FOES.inittube;
  const e = (anim: Enemy["anim"], script: number, tag = 0): Enemy => ({
    kind: "inittube",
    x: 0,
    y: 0,
    facing: 1,
    left: -500,
    right: 500,
    top: -500,
    bottom: 500,
    clock: 0,
    state: "gait",
    anim,
    linger: 0,
    dents: 0,
    vx: 0,
    vy: 0,
    hp: 1200,
    max: 1200,
    script,
    tag,
    fighting: true,
  });

  // `0x41973e` — the throw: one, then more while a fresh 0x434540(5) beats
  // the count; each 0x419860 rolls 0x434540(2) between the two scripts
  const rear = e(TUBE.rear, 8);
  rear.clock = TUBE.rear.cels.length * TUBE.rear.hold;
  rolls = [2, 5, 1, 4, 2, 3];
  tube(rear, T, rear.clock, k);
  if (casts.length !== 3 || casts[0] !== TUBE_SHARDS[1] || casts[1] !== TUBE_SHARDS[0])
    fail(`rolls 2,5,1,4,2,3 throw three — slow, fast, slow; threw ${casts.length}`);
  if (rear.anim !== TUBE.hurl || !said.includes(0x1d)) fail(`tag 0's end says 0x1d and puts tag 1 on`);
  const [fast, slow] = TUBE_SHARDS;
  if (fast.speed !== 31 || slow.speed !== 16 || fast.rise !== 8 || fast.pull !== 6 || fast.lift !== 0x8c || fast.ahead !== 0x46)
    fail(`0x46d658's dx 400/200, dy -100 through 13, 0.6 weight, 70 out and 140 up`);
  ok(`the test tube throws one to four shards of glass at dx 400 or 200 (0x41973e, 0x419860)`);

  // `0x41941a` — the flip breathes on its third frame
  casts.length = 0;
  const flip = e(TUBE.flip, 2);
  flip.clock = 2;
  tube(flip, T, TUBE.flip.cels.length, k);
  if (casts[0] !== TUBE_BREATH) fail(`frame index 2 of the flip calls 0x419910`);
  flip.clock = 3;
  tube(flip, T, TUBE.flip.cels.length, k);
  if (casts.length !== 1) fail(`...and only on frame index 2`);
  ok(`and its flip breathes out on its third frame (0x419910)`);

  // `0x419385` / `0x41939f` — the walk's footfalls on its frames 3 and 7
  said.length = 0;
  const walk = e(TUBE.walk, 1);
  for (let f = 0; f < TUBE.walk.cels.length * TUBE.walk.hold - 1; f++) {
    walk.clock = f;
    tube(walk, T, TUBE.walk.cels.length * TUBE.walk.hold, k);
  }
  const steps = said.filter((id) => id === 0x1e || id === 0x1f);
  if (steps.join() !== "30,30,31,31") fail(`0x1e twice on frame 3, 0x1f twice on 7; said ${steps}`);
  ok(`and it steps on 0x1e and 0x1f as its walk passes frames 3 and 7`);

  // `0x419a4c`, `0x419a96`, `0x46da20` — its sounds, and a three-frame flinch
  // that hands back to the decider (`0x4197a3`)
  if (
    JSON.stringify(T.hitSound) !== "[27,28]" ||
    T.deathSound !== 0x18 ||
    T.flinch![0].hold !== 3 ||
    T.gait.kind !== 3
  )
    fail(`tube: 0x1b/0x1c on a blow, 0x18 as it dies, flinch held 3, gait kind 3`);
  // `0x418362`, `0x41837c` — the spitter's takes and its squeal
  const P = FOES.initpuke;
  const blow = (damage: number) => ({ damage, hits: 1, dy: 0, facingAway: false });
  if (P.pick!(blow(20), { max: 400 }) !== 1 || P.pick!(blow(40), { max: 400 }) !== 0)
    fail(`under 0x1e is 0x46cb50 tag 1, and a contact above the feet is tag 0`);
  if (
    JSON.stringify(P.hitSound) !== "[6,7]" ||
    !P.quietKill ||
    P.drag !== 6553 ||
    P.flinch!.some((f) => f.resume?.kind !== 2) ||
    P.wake?.cel !== 3000
  )
    fail(`puke: 6/7 on a blow it lives through, drag 0.8, every flinch back to kind 2, dormant on 3000`);
  ok(`and the spitter's takes, sounds and drag are its own (0x41837c, 0x418362, 0x417e62)`);
};

machines();

const h = await headless("level=15");
const { game } = h;
const go = async (q: string): Promise<void> => {
  await h.load(`level=15${q}`);
  h.until(() => game.p.onGround, 60);
  h.frame(4);
};
/** the nearest of a kind, plated or not */
const nearest = (kind: string): Enemy | undefined =>
  game
    .spawnedHere()
    .filter((e) => e.kind === kind)
    .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];
/** walk to the nearest of a kind and kick it until it is dead; what it paid */
const fight = (kind: string, frames: number): number => {
  const before = game.stats.score;
  const foe = nearest(kind);
  if (!foe) fail(`no ${kind} to fight near x${game.p.x}`);
  for (let i = 0; i < frames && foe.state !== "dead"; i++) {
    const d = foe.x - game.p.x;
    if (Math.abs(d) < 40 && !game.p.act) {
      // too close: the kick's box hangs ahead of the anchor, past it
      const away = d > 0 ? "left" : "right";
      h.hold(away, true);
      h.frame(3);
      h.hold(away, false);
    } else if (Math.abs(d) < 90 && Math.sign(d) === game.p.facing) {
      if (!game.p.act) h.press("kick");
      h.frame();
    } else {
      const key = d > 0 ? "right" : "left";
      h.hold(key, true);
      h.frame();
      h.hold(key, false);
    }
  }
  if (foe.state !== "dead") fail(`the ${kind} was still standing after ${frames} frames: ${foe.hp}/${foe.max}`);
  h.frame(9);
  return game.stats.score - before;
};

// 1. three regions — two of them named `lab1` and `lab2` — and a census of
//    seven: six Puke Boys and one test tube. The ten arms do not count.
await go("");
if (game.level!.rooms.length !== 3) fail(`LAB has three regions; it has ${game.level!.rooms.length}`);
const kill = Math.round(game.mission().kill * 100);
if (kill !== 55 || game.stats.census !== 7)
  fail(`six pukes and one tube count and ten arms do not; the census is kill ${kill}% of ${game.stats.census}`);
if (game.stats.clockFull !== 2500) fail(`LAB's timer record carries 2500; the clock is full at ${game.stats.clockFull}`);
const clock = Math.round(game.stats.ticks);
if (clock < 2400 || clock > 2500) fail(`LAB's timer record carries 2500; the clock reads ${clock}`);
ok(`LAB is three regions, a census of seven, and ${clock} frames`);

// 2. Puke Boy — four hundred health, 440 points
await go("&x=560");
const puke = nearest("initpuke")!;
if (!puke || puke.hp !== 400 || puke.max !== 400)
  fail(`0x411753 gives it 0x40e300(0x190); it has ${puke?.hp}/${puke?.max}`);
const pukePay = fight("initpuke", 800);
if (pukePay !== 440) fail(`0x418335 pays 0x1b8 for a Puke Boy; the score rose ${pukePay}`);
ok(`a Puke Boy is four hundred health and ${pukePay} points`);

// 3. an arm — frail, and 113 for it. Spawned ON one: LAB's third arm stands at
//    x2095 with its nearest Puke Boy 479px west. An arm claims no plate —
//    nothing of its class calls `0x40d1c0`.
await go("&x=2095");
const arm = nearest("initarm");
if (!arm || arm.hp !== 1 || arm.max !== 1) fail(`LAB places ten arms, each with no health to subtract; near x2095: ${arm?.hp}/${arm?.max}`);
if (FOES.initarm.panel) fail(`an arm claims no plate (0x40d1c0 is never called for it)`);
if (FOES.initarm.counts) fail(`an arm does not count towards the census`);
const armPay = fight("initarm", 300);
// a kick can take two arms that stand together; each pays the same 113
if (armPay <= 0 || armPay % 113 !== 0) fail(`0x418bc3 pays 0x71 for an arm; the score rose ${armPay}`);
ok(`an arm falls to one blow of any size, for ${armPay} points`);

// 3b. a param-0 arm is on the floor from the start.
//
//    `0x411962`: param 0 gives weight 2, divisor 6 and the stance `0x46cfc8`
//    straight out of the creator, so it is never in the wall — kind 0, the
//    reach, and kind 1, the break-out, are the param-1 arm's alone. LAB's arm
//    at x3616 is param 0.
await go("&x=3616");
const floorKinds = new Set<number>();
const floorArm = nearest("initarm");
if (!floorArm || Math.abs(floorArm.x - 3616) > 200) fail(`no arm near x3616: ${floorArm?.x}`);
for (let i = 0; i < 27; i++) {
  if (floorArm.script !== undefined) floorKinds.add(floorArm.script);
  h.frame();
}
if (!floorKinds.size) fail(`the arm near x3616 plays no script`);
if (floorKinds.has(0) || floorKinds.has(1))
  fail(`the param-0 arm at x3616 played the wall's scripts (kinds ${[...floorKinds].join(", ")})`);
ok(`a param-0 arm starts on the floor (kinds ${[...floorKinds].join(", ")}), never in the wall`);

// 3c. ...and the blaster's bolt fells one. Its think writes −1 into the bolt
//    (`0x413bf9`), and `0x418b47` writes that back onto the bolt as 100 and
//    takes it like any blow — LAB hands out blaster packs among its arms
{
  floorArm.state = "flinch";
  floorArm.anim = { cels: [game.celOf(floorArm)], hold: 10, from: "test" };
  floorArm.clock = 0;
  h.frame();
  const c = game.celRec(game.level!.sbk, game.celOf(floorArm))!;
  const b = game.hurtBox(floorArm, c, game.level!);
  const dir = floorArm.x > game.p.x ? 1 : -1;
  const score = game.stats.score;
  game.bolts.length = 0;
  game.spawnBolt(floorArm.x - dir * 150, (b.top + b.bottom) / 2 + 20, dir);
  h.frame(3);
  if ((floorArm.state as string) !== "dead" || game.stats.score - score !== 113)
    fail(`a blaster bolt should fell an arm for 0x71 (0x418b4e); it is ${floorArm.state}, +${game.stats.score - score}`);
}
ok(`a blaster bolt fells an arm for 113`);

//    ...and it grabs. Stood 120 in front of it, the lunge lands (`obj+0x2a`),
//    the hand is within fifty of the point it aimed at, and nobody holds him:
//    `0x418a0b` puts on the hold, `0x418a1b` takes the claim — he is hidden and
//    drawn in its cels — and `0x418a6c` carries him on its point every frame,
//    until the ten beats end and it lets go fifty back (`0x418a98`, `0x418aa1`).
{
  await go("&x=3496&foehit=1&damage=1");
  const grabber = nearest("initarm")!;
  let heldFor = 0;
  let pinned = true;
  let at = 0;
  h.until(() => grabber.script === 5, 60);
  if (grabber.script !== 5 || !game.p.hidden) fail(`the arm near x3616 should have hold of him: kind ${grabber.script}, hidden ${game.p.hidden}`);
  while (grabber.script === 5 && heldFor < 40) {
    at = grabber.x;
    h.frame();
    heldFor++;
    if (grabber.script === 5 && (!game.p.hidden || Math.abs(game.p.x - game.anchorX(grabber)) > 1)) pinned = false;
  }
  if (!pinned) fail(`while it holds him he is hidden and on its point`);
  if (game.p.hidden) fail(`letting go hands him back (0x418aa1)`);
  if (grabber.script !== 2 || Math.round(grabber.x - at) !== 50 * -grabber.facing)
    fail(`it lets go into the stance, fifty back: kind ${grabber.script}, moved ${grabber.x - at}`);
  ok(`an arm whose lunge lands has hold of him for ${heldFor} frames, and lets go fifty back`);
}

// 4. the test tube — the player's own twelve hundred, and nothing for it
await go("&x=8150");
const t = nearest("inittube");
if (!t || Math.abs(t.x - 8204) > 200) fail(`LAB's one test tube stands at x8204; nearest is at ${t?.x}`);
if (t.max !== 1200 || t.hp !== 1200) fail(`0x411be4 gives it 0x40e300(0x4b0); it has ${t.hp}/${t.max}`);
ok(`the test tube carries the player's own twelve hundred health`);
// ...and the blaster's bolt is a blow to it: `0x419999` writes the −1 back as
// 100, and `0x42f910` makes that cel 4000's pair plus the bolt's hundred a
// frame. Only on a cel with a body (`0x4303b3`): its stand, 5350, has none
{
  const shoot = (e: Enemy): void => {
    const c = game.celRec(game.level!.sbk, game.celOf(e))!;
    const b = game.hurtBox(e, c, game.level!);
    const dir = e.x > game.p.x ? 1 : -1;
    // `spawnBolt` lifts it 40 and scatters it back down by up to 40, and puts
    // it 120 ahead: a bolt is tested where it stands, from the frame it is
    // made (`0x430350`), so it is born twenty short of the tube's point and
    // clear of the arm that stands at x8120..8157
    game.spawnBolt(e.x - dir * 140, (b.top + b.bottom) / 2 + 20, dir);
    h.frame(3);
  };
  t.state = "flinch";
  t.anim = FOES.inittube.flinch![0];
  t.clock = 0;
  shoot(t);
  if (t.hp !== 1200 || !game.bolts.length) fail(`a bolt goes on through the tube on its body-less stand; ${t.hp}, ${game.bolts.length} in the air`);
  game.bolts.length = 0;
  t.asleep = false;
  t.state = "flinch";
  // one of its charge's cels held, so the box the bolt is aimed at stays put
  t.anim = { cels: [TUBE.charge.cels[0]], hold: 10, from: "test" };
  t.clock = 0;
  // ...and a frame for the mover to stand it on that cel's own foot
  h.frame();
  shoot(t);
  const pair = game.celRec(game.level!.sbk, 4000)?.blow ?? { dx: 0, dy: 0 };
  const each = Math.floor(Math.hypot(pair.dx + 100, pair.dy));
  if (1200 - t.hp !== each) fail(`a bolt on 5410 takes 0x42f910 at 100, ${each}; it took ${1200 - t.hp}`);
  // `0x41825e`: puke answers a −1 with lab.snd 0xb and takes nothing — and
  // answers it 0 (`0x418278`), so the bolt is not stopped: `0x43042b` moves on
  // and nothing sets the bolt's `obj+0x2a`, and it flies straight through
  const puke = nearest("initpuke")!;
  const had = puke.hp;
  puke.asleep = false;
  // clear of the room's west end at x7150, which is where the bolt would go
  puke.x = game.p.x - 500;
  puke.state = "flinch";
  puke.anim = { cels: [3000], hold: 20, from: "test" };
  puke.clock = 0;
  h.frame();
  const heard = recordSound(game);
  const through = (): { past: boolean; beeps: number } => {
    const c = game.celRec(game.level!.sbk, game.celOf(puke))!;
    const pb = game.hurtBox(puke, c, game.level!);
    const dir = puke.x > game.p.x ? 1 : -1;
    game.bolts.length = 0;
    const mark = heard.length;
    game.spawnBolt(puke.x - dir * 150, (pb.top + pb.bottom) / 2 + 20, dir);
    const fired = game.bolts[0];
    let past = false;
    for (let i = 0; i < 4; i++) {
      h.frame();
      if (game.bolts.includes(fired) && (fired.x - puke.x) * dir > (pb.right - pb.left) / 2 + 20) past = true;
    }
    const beeps = heard.slice(mark).filter((x) => x.call === "effect" && x.args[0] === 0xb).length;
    return { past, beeps };
  };
  const pass1 = through();
  if (puke.hp !== had || !pass1.past || pass1.beeps < 1)
    fail(`a bolt passes through puke with 0xb and takes nothing (0x41825e, 0x418278): hp ${had} -> ${puke.hp}, past ${pass1.past}, 0xb x${pass1.beeps}`);
  const P = FOES.initpuke;
  if (JSON.stringify(P.minusOne) !== '{"sound":11}' || !P.corpseTakesHits || P.lingerPlus !== 1 - 12 || FOES.inittube.lingerPlus !== 1 - 18)
    fail(`puke answers −1 with 0xb, its 3080 takes blows, and both bodies count from the death's first frame`);
  if (!game.SPARES.inittube?.kinds.includes("initarm") || !game.SPARES.inittube.kits.includes(TUBE_BREATH))
    fail(`0x4199c3..0x419a05 turn away the tube's glass, puke's spit and the arm`);
  ok(`a blaster bolt takes ${each} off the tube when it has a body to hit, and goes through a Puke Boy for nothing`);

  // ...and an arm that has hold of you (`0x418b58`) answers 0 AFTER
  // `0x418b4e` has written the 100 onto the bolt, so what stands behind it in
  // the same pass takes a hundred-strength blow — a Puke Boy included
  const holder = game.spawnedHere().find((e) => e.kind === "initarm" && e.state !== "dead")
    ?? game.level!.spawned.flat().find((e) => e.kind === "initarm" && e.state !== "dead")!;
  const dir = puke.x > game.p.x ? 1 : -1;
  holder.x = puke.x - dir * 30;
  holder.y = puke.y;
  holder.script = 5;
  holder.state = "flinch";
  holder.anim = { cels: [3360], hold: 20, from: "test" };
  holder.clock = 0;
  if (!game.spawnedHere().includes(holder)) game.spawnedHere().push(holder);
  const pukeHad = puke.hp;
  through();
  if ((holder.state as string) === "dead" || puke.hp >= pukeHad)
    fail(`the held arm turns the bolt away and the Puke Boy behind takes it at 100: arm ${holder.state}, puke ${pukeHad} -> ${puke.hp}`);
  ok(`an arm that holds you lets the bolt by at a hundred, and the Puke Boy behind it takes ${pukeHad - puke.hp}`);
  t.hp = 1200;
}
// ...and the goal waits for it: `0x416047` asks `[0x46bfbc]` after the count,
// and the tube's fatal blow is what writes it (`0x419ac9`)
for (const e of game.spawnedHere()) if (e.kind === "initpuke") game.killFoe(e, FOES.initpuke);
h.frame(2);
if (game.aliveNow() > game.stats.allowance)
  fail(`the Puke Boys down should meet the count; ${game.aliveNow()} stand against an allowance of ${game.stats.allowance}`);
if (game.goalReady() || game.waitsFor() !== "the test tube")
  fail(`every Puke Boy down meets the count, but 0x416047 wants [0x46bfbc] too; the goal is ${game.goalReady() ? "open" : "shut"}, waiting for ${game.waitsFor()}`);
game.killFoe(t!, FOES.inittube);
if (!game.goalReady()) fail(`the tube's death writes [0x46bfbc] (0x419ac9); the goal is still shut`);
ok(`the goal waits for the test tube whatever the count, and opens when it goes`);

pass("LAB's Puke Boys, its ten arms and its one test tube are all where the records put them");
