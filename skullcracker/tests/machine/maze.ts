/**
 * MAZE — level thirteen, and the first level of chapter four.
 *
 *   npx tsx tools/runmachine.mts maze      (from skullcracker/)
 *
 * Seven regions and none of them wider than 2696 pixels: the level is a ring of
 * corridors rather than a run, and four of its seven region records are named
 * `newroom1`…`newroom4` rather than `newroom`.
 *
 *   - **the TCop** (`initcop`), which `lab.snd` names outright: `#0084 TCop
 *     Dies`, `#0085 TCop eats`, three `TCop punc[h]`es. 250 health and **550
 *     points**, the most any creature outside a boss is worth.
 *   - **the slurp** (`initslurp`), twenty of them, sixty health, worth nothing,
 *     running an eight-state machine of its own (`0x414ae0`).
 *   - **the cage door and the switch**, which is SERVICE's lever told again —
 *     and thrown by the same hand: `0x414664` is inside the COP's think, so
 *     level thirteen's doors are opened by its guards.
 *   - **the fans**, which keep their own counters — sucking, stopped, blowing,
 *     at rest — and **the alarms**, which flash while the vertical fan carrying
 *     their param is sucking (`0x415dc0`).
 */
import { FOES } from "../../src/foes";
import { SLURP, slurp } from "../../src/brains/slurp";
import { COP, cop } from "../../src/brains/cop";
import { TICK_SCALE, install, type BrainCtx, type Enemy } from "../../src/brains/kit";
import { FPS, fail, headless, ok, pass } from "./harness";

/**
 * The two classes' machines on their own, called once an engine frame as
 * `stepFight` calls them.
 */
const machines = (): void => {
  let rolls: number[] = [];
  const k = {
    player: { x: 0, y: 0, top: 0, anchor: 0, vy: 0, swinging: false, down: false, facing: 1 },
    anchorY: (e: Enemy) => e.y,
    anchorX: (e: Enemy) => e.x,
    shake: () => {},
    flash: () => {},
    burn: () => {},
    spray: () => {},
    track: () => ({ forward: 100, dy: 0, band: -1, side: 1 }),
    roll: () => rolls.shift() ?? 1,
    say: () => undefined,
    cast: () => undefined,
    atBound: () => false,
    atRear: () => false,
    scaled: (n: number) => n,
    gravity: 1,
  } as unknown as BrainCtx;
  const one = (kind: string, anim: Enemy["anim"], script: number): Enemy => ({
    kind,
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
    hp: 100,
    max: 100,
    script,
  });

  // `0x414a36` then `0x414b68`: born at −5, then ceil(15/8) = 2 a frame, turned
  // round once past five — a twelve-frame bob, once an engine frame
  const S = FOES.initslurp;
  const b = one("initslurp", SLURP.stance, 4);
  const vys: number[] = [];
  for (let f = 0; f < 14; f++) {
    b.clock = f % 4;
    slurp(b, S, 4, k);
    vys.push(Math.round(b.vy / TICK_SCALE));
  }
  if (vys.slice(0, 7).join() !== "-3,-1,1,3,5,7,5") fail(`0x414b43/0x414b68 walk the vertical speed -3,-1,1,3,5,7,5...; got ${vys}`);
  if (!S.accrues || S.linger !== 0 || S.deathSound !== 13 || S.flinch![0].resume?.kind !== 4)
    fail(`slurp: its drift builds (0x414b79 clamps it), no corpse (0x41507a), 13 as it goes, the flinch back to kind 4`);
  ok(`a brain bobs two a frame from a standing -5 (0x414a36, 0x414b68), and leaves no corpse`);

  // `0x41440e` — after the flinch, one in three winds up and the rest back off
  const C = FOES.initcop;
  const c = one("initcop", C.flinch![0].resume!, 8);
  rolls = [1];
  cop(c, C, 1, k);
  if (c.anim !== COP.wind) fail(`0x434540(3) of 1 after the flinch is 0x46c660 tag 0`);
  c.script = 8;
  rolls = [3];
  cop(c, C, 1, k);
  if (c.anim !== COP.walkOut) fail(`any other roll is 0x46c720 tag 1`);
  if (JSON.stringify(C.hitSound) !== "[15,16,17,18]" || C.linger !== 0 || C.death!.cels.length !== 3 || C.flinch![0].kind !== 8 || !C.flinch![0].decides)
    fail(`cop: 15..18 on a blow (0x4148a1), gone at frame 3 of its death (0x41469c)`);
  ok(`a TCop winds up or backs off after a flinch (0x41440e), and is gone three cels into its death`);
};

machines();

const h = await headless("level=13");
const { game } = h;
const room = (): number => game.level!.rooms.indexOf(game.p.room!) + 1;
const go = async (q: string): Promise<void> => {
  await h.load(`level=13${q}`);
  h.until(() => game.p.onGround, 60);
  h.frame(4);
};
/** the nearest thing on the panel — what the right-hand bar is fought over */
const nearestPlated = (): Enemy | undefined =>
  game
    .spawnedHere()
    .filter((e) => FOES[e.kind].panel)
    .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];
/** walk to the nearest of a kind and fight it; what the score rose by */
const fight = (kind: string, frames: number): number => {
  const before = game.stats.score;
  const foe = game
    .spawnedHere()
    .filter((e) => e.kind === kind)
    .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];
  if (!foe) fail(`no ${kind} to fight near x${game.p.x}`);
  for (let i = 0; i < frames && foe.state !== "dead"; i++) {
    const d = foe.x - game.p.x;
    if (Math.abs(d) < 90) {
      // the kick and the punch in turn: `0x4029e0` weakens a move repeated the
      // same way within four seconds, down to a fifth, and a different move
      // lands at full strength. (Not the W kick: W is this level's ladder key.)
      if (Math.sign(d) !== game.p.facing && d !== 0) {
        const key = d > 0 ? "right" : "left";
        h.hold(key, true);
        h.frame();
        h.hold(key, false);
      }
      if (!game.p.act) h.press(i % 2 === 1 ? "punch" : "kick");
      h.frame(3);
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

// 1. seven regions, a census of twenty-seven, and its own clock
await go("");
if (game.level!.rooms.length !== 7) fail(`MAZE has seven regions; it has ${game.level!.rooms.length}`);
const kill = Math.round(game.mission().kill * 100);
if (kill !== 35 || game.stats.census !== 27) fail(`seven cops and twenty slurps count; the census is kill ${kill}% of ${game.stats.census}`);
if (game.stats.clockFull !== 3200) fail(`MAZE's timer record carries 3200; the clock is full at ${game.stats.clockFull}`);
ok(`MAZE is seven regions, a census of 27, and ${game.stats.clockFull} frames on its own clock`);

// 2. the TCop — 250 health and 550 points
await go("&x=3400&y=7300");
// ...and a slurp may be nearer for a moment: its drift builds into its velocity
// (`0x45d1a3`, clamped at `0x414b79`), so the room's brains come to you
h.until(() => nearestPlated()?.kind === "initcop", 30);
const tcop = nearestPlated();
if (tcop?.kind !== "initcop" || tcop.hp !== 250 || tcop.max !== 250)
  fail(`0x4116b5 gives it 0x40e300(0xfa); the nearest is ${tcop?.kind} ${tcop?.hp}/${tcop?.max}`);
const copPay = fight("initcop", 600);
if (copPay !== 550) fail(`0x41490d pays 0x226 for a TCop; the score rose ${copPay}`);
ok(`a TCop is 250 health and ${copPay} points — the most outside a boss`);

// 3. the slurp — sixty health, and a repertoire of its own
await go("&x=2100&y=7600");
const sl = nearestPlated();
if (sl?.kind !== "initslurp" || sl.hp !== 60 || sl.max !== 60)
  fail(`0x411a74 gives it 0x40e300(0x3c); the nearest is ${sl?.kind} ${sl?.hp}/${sl?.max}`);
/**
 * ...and it is NOT one cel. `0x414ae0` is an eight-state machine: its own cels
 * are 2500–2704 — `0x46d288` the drift in, `0x46d2c0` the walk and the two
 * climbs, `0x46d370` the bolt, `0x46d3d8` the hypnosis — and 2550 is only the
 * stance it comes back to. This asks that it is RUNNING the machine, not which
 * frame it is on.
 */
const cels = new Set<number>();
for (let i = 0; i < 12; i++) {
  h.frame();
  cels.add(game.celOf(sl));
}
if (cels.size < 2) fail(`a slurp should run its own machine, not hold one cel; saw only ${[...cels].join(" ")}`);
if ([...cels].some((c) => c < 2500 || c > 2704)) fail(`its cels are 2500..2704; saw ${[...cels].join(" ")}`);
const slurpPay = fight("initslurp", 400);
if (slurpPay !== 0) fail(`0x415100 has no 0x40d450 in it; the score moved by ${slurpPay}`);
ok(`a slurp is sixty health, runs its own cels (${[...cels].sort().join(" ")}), and pays nothing`);

// 3b. ...and it goes up in goo. `0x4150b6`, in the frame after the killing
//     blow: `0x40cba0(point, 0x78, 0)` — the spray's full twenty gobs, and no
//     hitter, so they leave every way at once (`0x40ce7d`)
await go("&x=2100&y=7600");
const pop = nearestPlated();
if (pop?.kind !== "initslurp") fail(`a slurp should be nearest at x2100; it is ${pop?.kind}`);
pop.hp = 1;
const gobsWere = game.gobs.length;
game.strikeFoe(pop, 5, { dx: 0, dy: 0 }, 1, pop.y, { top: 0, left: 0, bottom: 1, right: 1 });
const blood = game.gobs.length - gobsWere;
h.frame(2);
const burst = game.gobs.slice(gobsWere + blood);
if (burst.length !== 20) fail(`0x4150b6 throws 0x78's worth — twenty gobs; ${burst.length} came out`);
if (!burst.some((g) => g.vx < 0) || !burst.some((g) => g.vx > 0))
  fail(`with no hitter they should scatter both ways: ${burst.map((g) => Math.sign(g.vx)).join(" ")}`);
if (game.spawnedHere().includes(pop)) fail(`and the brain itself is gone the same frame (0x41507a answers 1)`);
ok(`a dead slurp bursts into twenty gobs going both ways, and is gone`);

// 4. the cage doors: a shut one is an OBSTACLE, which is `0x411460` appending
//    its own rect to the same table the level's `obstacle` records fill
await go("&x=2100&y=7600");
const cages = game.hereOf((l) => l.cages);
const cageAt = (x: number) => cages.find((c) => c.x === x);
const c1160 = cageAt(1160);
if (!c1160 || c1160.param !== 4 || c1160.state !== "shut" || game.cageCel(c1160) !== 2010) fail(`the cage at x1160 opens shut on 2010`);
const c1859 = cageAt(1859);
if (!c1859 || c1859.param !== 4 || c1859.state !== "open" || game.cageCel(c1859) !== 0)
  fail(`a record with a NEGATIVE param opens open, and draws nothing`);
h.hold("left", true);
h.frame(48);
h.hold("left", false);
h.frame(4);
// the cage at x2061 is shut and its rect runs 2008..2115, so a walk west out of
// x2115 does not start: 0x411460 has already made it wall
if (game.p.x < 2000) fail(`the shut cage at x2061 should stop a walk west; got to x ${game.p.x}`);
ok(`the shut cage at x2061 holds a walk at x ${game.p.x}, and the open one draws nothing`);

// 5. ...and a COP opens one. `0x414664` is inside the cop's own think: within
//    ten pixels of a switch it calls `0x412550`, which hands tag 3 to tag 0.
await go("&x=3400&y=7300");
const seen: string[] = [];
const note = (s: string): void => {
  if (seen[seen.length - 1] !== s) seen.push(s);
};
const sw = game.switchesHere().find((w) => w.param === 1);
const cage1 = game.hereOf((l) => l.cages).find((c) => c.param === 1);
if (!sw || !cage1) fail(`the switch at x3521 and the cage it opens stand here`);
const seenSw: string[] = [];
const noteSw = (s: string): void => {
  if (seenSw[seenSw.length - 1] !== s) seenSw.push(s);
};
h.until(() => {
  noteSw(sw.state);
  note(cage1.state);
  return cage1.state === "open";
}, 110);
if (!seenSw.includes("on")) fail(`a cop should throw the switch at x3521; it went ${seenSw.join(" -> ")}`);
if (cage1.state !== "open") fail(`and the cage at x3382 should open; it went ${seen.join(" -> ")}`);
ok(`a cop walks to the switch and throws it (${seenSw.join(" -> ")}), and the cage opens (${seen.join(" -> ")})`);

// 6. the fans, which nothing in the level starts: the counter is set to 60 for
//    sucking and blowing (`0x4155ef`) and 15 for stopped and at rest
//    (`0x41541d`), and `0x4153fa` tests it BEFORE the decrement — so a state
//    runs its count down to -1, 62 frames and 17 with the frame it began on
await go("&x=3400&y=7300");
const fan = game.hereOf((l) => l.fans).find((f) => f.horizontal);
if (!fan) fail(`a horizontal fan turns in this region`);
const runs: { state: string; frames: number }[] = [];
const fanCels = new Set<number>();
for (let i = 0; i < 400; i++) {
  h.frame();
  fanCels.add(game.fanCel(fan));
  const last = runs[runs.length - 1];
  if (last?.state === fan.state) last.frames++;
  else runs.push({ state: fan.state, frames: 1 });
}
// the first run and the last are cut by the window; the whole ones between are the counters
const whole = runs.slice(1, -1);
const lengths: Record<string, number> = { suck: 62, stop: 17, blow: 62, rest: 17 };
if (!["suck", "stop", "blow", "rest"].every((s) => runs.some((r) => r.state === s)))
  fail(`a fan sucks, stops, blows and rests; it showed ${runs.map((r) => r.state).join(" ")}`);
const wrong = whole.filter((r) => r.frames !== lengths[r.state]);
if (wrong.length) fail(`0x4153fa counts 60 and 15 down past zero — 62, 17, 62, 17; it ran ${whole.map((r) => `${r.state} ${r.frames}`).join(", ")}`);
if ([...fanCels].some((c) => c < 10020 || c > 10024)) fail(`0x46d478 is 10020..10024; saw ${[...fanCels].join(" ")}`);
ok(`a fan turns itself on and off on its own counter: ${whole.map((r) => `${r.state} ${r.frames}`).join(", ")}`);

// 6b. ...and inside 270 of a sucking fan, `0x415588` calls `0x402fa0(0)` every
//     frame, whose `0x402df0` drops every key: a key held or a punch pressed
//     there is gone the next frame. Inside 140 it kills (`0x4154b7`,
//     `0x402fa0(8)`), and that drops them too
{
  const f = fan;
  const side = f.right - f.x > f.x - f.left ? 1 : -1;
  const standAt = (dx: number): void => {
    f.state = "suck";
    f.count = 50;
    game.p.x = f.x + side * dx;
    game.p.y = (f.top + f.bottom) / 2 + game.p.feet;
    game.p.vx = 0;
  };
  standAt(200);
  h.hold(side > 0 ? "right" : "left", true);
  h.press("punch");
  h.frame();
  if (Object.values(game.held).some(Boolean) || game.punchPressed)
    fail(`inside 270 of a sucking fan every key is dropped (0x415588): held ${JSON.stringify(game.held)}, punch ${game.punchPressed}; x ${game.p.x} in ${f.left}..${f.right}`);
  const lives = game.stats.lives;
  standAt(100);
  h.hold("left", true);
  h.press("kick");
  h.frame();
  if (game.stats.lives !== lives - 1 || game.held.left || game.kickPressed)
    fail(`inside 140 it kills and drops the keys (0x4154b7): lives ${lives} -> ${game.stats.lives}, left ${game.held.left}, kick ${game.kickPressed}`);
}
ok(`a sucking fan drops every key inside 270, and its kill drops them too`);

// 7. the big guns — `0x4115b0` makes two objects of one record and `0x4135b0`
//    runs them through eight script kinds. Standing inside the rect takes it
//    the whole way round; the bolt it fires is the BLASTER's, out of the same
//    `0x412a70` the armed player calls, and it goes towards you.
await go("&x=1850&y=7100");
const gun = game.hereOf((l) => l.bigguns)[0];
if (!gun) fail(`a big gun stands over x1850`);
const states: string[] = [];
const gunCels = new Set<number>();
let bolt: number | null = null;
// the shot's own records and where it left the gun — see `GUNBOLT`
const shotCels: number[] = [];
let shotFrom: { x: number; y: number } | null = null;
let shotAt: { gx: number; gy: number } | null = null;
let shot: (typeof game.bolts)[number] | null = null;
for (let i = 0; i < 10 * FPS; i++) {
  h.frame();
  if (states[states.length - 1] !== gun.state) states.push(gun.state);
  const cel = game.gunCel(gun);
  if (cel) gunCels.add(cel);
  if (bolt === null && game.bolts.length) {
    shot = game.bolts[0];
    bolt = shot.vx;
    shotFrom = shot.was ?? { x: shot.x, y: shot.y };
    shotAt = { gx: gun.x, gy: gun.gunY };
  }
  if (shot && game.bolts.includes(shot) && shotCels.length < 6) shotCels.push(game.boltCel(shot));
}
let from = 0;
for (const want of ["arm", "drop", "unfold", "fire", "blink"]) {
  const at = states.indexOf(want, from);
  if (at < 0) fail(`0x413930's kinds should run in order; it did ${states.join(" -> ")}`);
  from = at;
}
if ([...gunCels].some((c) => c < 10080 || c > 10101))
  fail(`the turret's cels are 0x46c350..0x46c3e0's 10080..10101; saw ${[...gunCels].sort().join(" ")}`);
if (bolt === null) fail(`0x41374c fires 0x412a70; no bolt appeared in ten seconds under the gun`);
if (bolt >= 0) fail(`the gun stands at x2167 and the probe at x1850, so its bolt goes LEFT; vx ${bolt}`);
// `0x412af4`: variant 0 — 45 ahead of the gun's own point, no rise, no scatter,
// dx 300 over the divisor of ten, and 10102 once, then 10103, 10104, 10105, 10105
if (bolt !== -30) fail(`0x46c588 tag 0's dx 300 over the divisor of ten is thirty a frame; vx ${bolt}`);
if (!shotFrom || !shotAt || shotFrom.x !== shotAt.gx - 45 || shotFrom.y !== shotAt.gy)
  fail(`the shot starts 45 along the gun's facing at its own height (0x412af4); from ${JSON.stringify(shotFrom)}, gun ${JSON.stringify(shotAt)}`);
if (shotCels[0] !== 10102 || shotCels.slice(1, 5).join() !== "10103,10104,10105,10105")
  fail(`tag 0 is 10102 once, then tag 1 round from its second record; saw ${shotCels.join(" ")}`);
ok(`a big gun drops, unfolds and fires its own shot at you: ${states.slice(0, 6).join(" -> ")}, vx ${bolt}, on ${shotCels.join(" ")}`);

// ...and the shot is a hundred-strength blow to the player (`0x413bed`): the
// hit pass trades its thirty a frame into him, `0x42f910`'s length of it
await go("&x=1850&y=7100&damage=1");
{
  const hp = game.stats.health;
  game.bolts.length = 0;
  game.spawnBolt(game.p.x - 45, game.p.y - 60, 1, 100);
  const one = game.bolts[0];
  h.frame(2);
  if (game.stats.health >= hp || game.bolts.includes(one))
    fail(`the gun's shot meeting him is a blow and is spent; health ${hp} -> ${game.stats.health}, still flying ${game.bolts.includes(one)}`);
  ok(`the gun's shot lands on him for ${hp - game.stats.health} and is spent`);
}

// ...and walking out of the rect folds it away wherever it had got to — every
//    interruptible kind tests the rect first (`0x413692`, `0x4136e3`,
//    `0x4137b4`) and installs `0x46c428` the moment the answer is no
await go("&x=1600&y=7100");
const gun2 = game.hereOf((l) => l.bigguns)[0];
if (h.until(() => gun2.state === "wait", 90) < 0) fail(`x1600 is outside the rect 1775..2610; the gun stayed on ${gun2.state}`);
ok(`...and it folds back up and waits when you are not under it`);

/**
 * ...and its four LADDERS carry you between its regions, both ways.
 *
 * MAZE is the level that proved a ladder is not a region's to hold: all four of
 * its ladders centre in NO region at all — the first misses room 0's bottom
 * edge by one pixel. The engine files nothing: `0x40b940` is its only entity
 * query and it is a linear scan of the whole table, kind 2 asking whether a
 * rect holds a point (`0x434200`), with no reference to a region anywhere in
 * it. So the ladders are kept whole on the level.
 *
 * Each row is the record's own `pointX`, a y at the ladder's HEAD, and the two
 * legs the rect is worth. The head rather than the foot because two of the four
 * END in `newroom1`, which has no region: its floor is the flat one `0x40bbd0`
 * makes from the record's +46, checked below, and the ladders are climbed down
 * into it rather than up out of it.
 */
for (const [x, head, down, up] of [
  [1615, 7126, 1200, 1200],
  [2401, 8021, 400, 420],
  [3678, 7114, 800, 800],
  [5295, 7354, 600, 600],
] as const) {
  await go(`&x=${x}&y=${head}`);
  // where it actually put us: the drop lands on the room's own floor
  const from = game.p.y;
  /**
   * ...and the view goes with the climber. The mount writes `0xffff` into the
   * player's region (`0x42b273`), so `0x4308a0` clamps nothing for the whole
   * climb, and the ladder's rig (`0x42b216`) has no lead: the anchor is held at
   * the chase middle's x, 256, and never leaves the 232 rows.
   */
  const offView: string[] = [];
  const climb = (key: "down" | "up", frames: number): void => {
    h.hold(key, true);
    for (let f = 0; f < frames; f++) {
      h.frame();
      // the first second is the chase closing the walk's lead of 120
      if (f < FPS || !game.p.climbing) continue;
      const sx = game.p.x - game.view.x;
      // the climb cels hang the feet 96 below the anchor
      const sy = game.p.y - 96 - game.view.y;
      if (Math.abs(sx - 256) > 16 || sy < 0 || sy > 232) offView.push(`${game.p.x},${game.p.y} in view ${game.view.x},${game.view.y}`);
    }
    h.hold(key, false);
    h.frame(4);
  };
  climb("down", 11 * FPS);
  const foot = game.p.y;
  const low = room();
  climb("up", 13 * FPS);
  if (offView.length) fail(`climbing the ladder at x${x}, the view lost the climber: ${offView.slice(0, 3).join("; ")}`);
  const top = game.p.y;
  const high = room();
  if (foot - from < down) fail(`the ladder at x${x} should take you ${down}px down; it went ${from} to ${foot}`);
  if (foot - top < up) fail(`the ladder at x${x} should lift you ${up}px; it went ${foot} to ${top}`);
  if (low === high) fail(`the ladder at x${x} reaches out of room ${low}; the player never left it`);
  ok(`the ladder at x${x} runs ${foot - top}px, room ${low} to room ${high}`);
}

/**
 * ...and the two rooms with no region stand the player on a flat floor all the
 * same: `0x40bbd0` answers the room's top plus the word at +46 across its rect
 * less fifty each end — 7869 + 200 and 8280 + 255.
 */
for (const [x, y, want] of [
  [5200, 8000, 8069],
  [2100, 8500, 8535],
]) {
  await h.load(`level=13&x=${x}&y=${y}`);
  h.frame(22);
  if (game.p.y !== want) fail(`the floorless room at x${x} has a flat floor at y ${want} (0x40bc7d); stood at ${game.p.y}`);
  ok(`the floorless room at x${x} stands you on y ${game.p.y}, its top plus +46`);
}

/**
 * The brain's HYPNOSIS — `0x402fa0(4)`, the player's own judder `0x471fc8`.
 *
 * Between 140 and 180 and facing it, an upright player is hypnotised
 * (`0x414fd9`) as the brain goes into its kind 6; one already juddering is
 * bolted instead (`0x414fb4` → `0x415015`). The judder drops his keys
 * (`0x402df0`) and runs out into the idle.
 */
{
  await h.load("level=13");
  h.until(() => game.p.onGround, 60);
  h.frame(4);
  const e = game.level!.spawned.flat().find((q) => q.kind === "initslurp")!;
  const k = game.BRAIN_CTX;
  const stage = (): void => {
    install(e, SLURP.stance);
    e.state = "gait";
    e.asleep = false;
    e.clock = 0;
    e.facing = -1;
    e.x = game.p.x + 140;
    e.y = game.p.y - 20;
    game.p.facing = 1;
  };
  stage();
  game.p.act = null;
  slurp(e, FOES.initslurp, 16, k);
  const hyp = { act: game.p.act, kind: e.script };
  stage();
  slurp(e, FOES.initslurp, 16, k);
  const again = e.script;
  if (hyp.act !== "jolt" || hyp.kind !== 6 || again !== 5)
    fail(`0x414fd9 hypnotises him into the judder, and 0x414fb4 bolts one already in it; ${JSON.stringify(hyp)}, then kind ${again}`);
  game.p.act = null;
  ok(`a brain facing him from 140..180 puts him in the judder, and bolts him if he is already in it (0x414fd9, 0x414fb4)`);
}

pass(`MAZE's cops work its levers, its cages are wall, its fans keep their own time, its big guns fire and its ladders climb`);
