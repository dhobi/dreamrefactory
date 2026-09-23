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
import { fail, headless, ok, pass } from "./harness";
import { FOES } from "../../src/foes";
import { TUBE, TUBE_BREATH, TUBE_SHARDS, tube } from "../../src/brains/tube";
import type { BrainCtx, CastKit, Enemy } from "../../src/brains/kit";

/**
 * The machines on their own: `tube` handed a stand-in context and called once
 * an engine frame, as `stepFight` calls it; and the two classes' records.
 */
const machines = (): void => {
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

// 4. the test tube — the player's own twelve hundred, and nothing for it
await go("&x=8150");
const t = nearest("inittube");
if (!t || Math.abs(t.x - 8204) > 200) fail(`LAB's one test tube stands at x8204; nearest is at ${t?.x}`);
if (t.max !== 1200 || t.hp !== 1200) fail(`0x411be4 gives it 0x40e300(0x4b0); it has ${t.hp}/${t.max}`);
ok(`the test tube carries the player's own twelve hundred health`);

pass("LAB's Puke Boys, its ten arms and its one test tube are all where the records put them");
