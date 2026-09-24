/**
 * PLAYGR — level four, and the first one that is a fight rather than a route.
 *
 *   npx tsx tools/runmachine.mts playgr      (from skullcracker/)
 *
 * Seventeen records, and that is the whole level: one room, one platform, two
 * `obstacle` walls holding its ends, seven dogs, three pickups and **one**
 * `initwbooly` standing in a territory that runs from x3762 to the edge of the
 * goal rect. Its kill share is the one that stores zero — `0x450156`, which is
 * "everything" — so the goal does not open until the census is empty, and the
 * census is the boss alone: the dog's creator never calls `0x42f870`, so the
 * seven of them are worth points and nothing else.
 *
 * What the file says, and what this checks:
 *
 *   - **the boss counts and the dogs do not.** `0x451080` calls `0x42f870(obj, 1)`
 *     in the boss's creator; nothing in the dog's does.
 *   - **eight hundred health**, from `push 0x320; call 0x40e300` at `0x4510ae`,
 *     which is more than three times the biggest thing in level three.
 *   - **the goal is shut until it is dead**, which is what a 100% share means.
 */
import { fail, headless, ok, pass, recordSound } from "./harness";
import { FOES } from "../../src/foes";

const h = await headless("level=4");
const { game } = h;
const settle = (): void => {
  h.until(() => game.p.onGround, 60);
  h.frame(4);
};
const boss = () => game.spawnedHere().find((e) => e.kind === "initwbooly")!;

// 1. it opens where its own initplayer stands, on flat ground
settle();
if (Math.abs(game.p.x - 1680) > 20) fail(`PLAYGR should open at its own initplayer, x1680; got x ${game.p.x}`);
ok(`PLAYGR opens at x ${game.p.x}, y ${game.p.y}`);

// 2. eight enemies stand up — seven dogs and the one that counts
const all = game.spawnedHere().length;
if (all !== 8) fail(`PLAYGR places seven dogs and one boss; ${all} spawned`);
if (game.stats.census !== 1) fail(`only the boss calls 0x42f870, so the census is 1; got ${game.stats.census}`);
if (game.mission().kill !== 1) fail(`the share that stores zero is everything (0x450156); it is ${game.mission().kill}`);
ok(`${all} enemies stand up and exactly ${game.stats.census} of them is the quota`);

// 3. it is a statue until you come to it. Well clear of its rect it holds cel
//    3040 and does nothing at all — `0x4559e8` tests the player's own point
//    against the record's rect and nothing else wakes it.
await h.load("level=4&x=3400");
settle();
h.frame(30);
const still = new Set<number>();
let statueX = NaN;
for (let i = 0; i < 20; i++) {
  h.frame();
  const b = boss();
  if (!b) fail(`the boss should stand in PLAYGR`);
  if (b.max !== 800 || b.hp !== 800) fail(`0x4510ae gives it 0x320 health; it has ${b.hp}/${b.max}`);
  still.add(game.celOf(b));
  statueX = Math.round(b.x);
}
// the record stands it at x4199; home is the creator's constant 0x122a, 4650
// (`0x4510dd`), converted to a foot x through the same cel
const homeX = statueX + (0x122a - 4199);
if (still.size !== 1 || !still.has(3040)) fail(`a sleeping boss is cel 3040 and nothing else; saw ${[...still].join(" ")}`);
ok(`it stands as cel 3040 with 800 health while the player is outside its rect`);

// 4. walk into the rect and it stirs, climbs out of the ground and comes on
const woke = new Set<number>();
h.hold("right", true);
for (let i = 0; i < 140 && game.p.x <= 3950; i++) {
  h.frame();
  woke.add(game.celOf(boss()));
}
h.hold("right", false);
for (let i = 0; i < 40; i++) {
  h.frame();
  woke.add(game.celOf(boss()));
}
// 3041 is the stir, 3122..3124 the climb out, 3000+ the fight
if (!woke.has(3041)) fail(`it should stir on 3041 before anything else; saw ${[...woke].join(" ")}`);
if (![3122, 3123, 3124].some((c) => woke.has(c))) fail(`it should climb out through 3122..3124; saw ${[...woke].join(" ")}`);
if (![...woke].some((c) => c >= 3000 && c <= 3068)) fail(`and then fight; saw ${[...woke].join(" ")}`);
ok(`walking into its rect wakes it — ${woke.size} cels from the statue to the fight`);

// 5. the goal is shut while it lives. Its share is the one that stores zero
//    (0x450156), so the craft does not come until the census is empty.
await h.load("level=4&x=4500");
settle();
h.frame(12);
if (game.goalReady() || game.craft) fail(`the goal opened with the boss still alive`);
if (game.aliveNow() - game.stats.allowance !== 1) fail(`the one that is left should be counted; ${game.aliveNow()} alive, ${game.stats.allowance} allowed`);
ok(`and the goal stays shut while it lives`);

// 6. eight hundred health, and what killing it is worth
await h.load("level=4&x=4100");
settle();
h.frame(12);
// every x it stands at the frame kind 5 hands to kind 1 — `0x455e7c` puts the
// home dword into `obj+6` as it does
const snaps: number[] = [];
let lastKind: number | undefined;
/**
 * Kick and punch in turn. `0x4029e0` takes 5 off the strength for every frame
 * of a repeated kick (move 6, `0x42a6f9`) inside four seconds, floor 20, so
 * kicks alone land for one to three against its 800; changing move puts it
 * back to 100 (`0x402a5a`). And the reach is the boss's body, not the
 * player's: `0x430680` holds a weight-12 body some 140 pixels off the player's
 * anchor, and the kick's box hangs 95..125 ahead of it.
 */
let blows = 0;
const score0 = game.stats.score;
let frames = 0;
for (; frames < 4000; frames++) {
  const b = boss();
  if (b.state === "dead") break;
  if (b.script === 1 && lastKind === 5) snaps.push(Math.round(b.x));
  lastKind = b.script;
  const d = b.x - game.p.x;
  if (Math.abs(d) < 160) {
    if (!game.p.act) h.press(blows++ % 2 ? "punch" : "kick");
    h.frame();
  } else {
    const key = d > 0 ? "right" : "left";
    h.hold(key, true);
    h.frame();
    h.hold(key, false);
  }
}
if (boss().state !== "dead") fail(`never got the boss down in ${frames} frames`);
/**
 * ...and where it went home to. The melee half ends on kind 5 tag 3, which
 * installs kind 1 and writes AI+0xe into `obj+6` — the constant x4650, not the
 * x4199 the level record stood it at. Knocked down, `0x4564c5` zeroes `AI+4`
 * and the get-up heads straight home, so a fight this long goes home at least
 * once.
 */
if (!snaps.length) fail(`the boss never finished a melee half (kind 5 -> kind 1)`);
// ...read at the end of the frame, after the move: the snap writes `obj+6`
// and leaves `obj+0xc` alone, so a boss that came down at home still sliding
// from the drop moves on by what is left of it — a few pixels at most
const off = snaps.filter((x) => Math.abs(x - homeX) > 4);
if (off.length) fail(`0x455e7c snaps it home to x${homeX} (0x122a); it stood at ${snaps.join(", ")}`);
ok(`each melee half ends with it snapped home to x${homeX}, the constant 0x122a (${snaps.length} time(s)), and it is down in ${frames} frames`);
h.frame(40);
const points = game.stats.score - score0;
if (points < 2500) fail(`0x456420 pays 0x9c4 for it; the score rose ${points}`);
if (game.celOf(boss()) !== 3140) fail(`it burns on 3140 and stays there; showing ${game.celOf(boss())}`);
if (game.aliveNow() > game.stats.allowance) fail(`the census should be clear: ${game.aliveNow()} alive`);
ok(`it falls for ${points} points and burns on cel 3140, and the quota is clear`);

// 7. ...and only then does the television come down
if (h.until(() => game.craft !== null, 60) < 0) fail(`the craft should arrive once the boss is dead`);
ok(`and the television comes down for it`);

/**
 * 8. what a blow does to it, through the page's own hit path — `0x456310`.
 *
 * - in states 2, 8 and 9 it is taken with the goo (`0x4563a0`) and the grunt
 *   (`0x456459`) and answered 1 (`0x456518`), so it is shoved, and nothing
 *   goes on;
 * - the grunt is on the path that survives (`0x4563ce jg`): the killing blow
 *   plays 0x33 alone;
 * - the take reads kind 9 (`0x478358`), so a blow during it is state 9;
 * - dead, tag 1's end plays 0x32 (`0x456134`), and the wreck crackles index 0
 *   or 1 at the player every 13..20 frames for good (`0x456171`).
 */
{
  await h.load("level=4&x=4100");
  settle();
  const W = FOES.initwbooly;
  const b = boss();
  const state = (): string => b.state;
  const hit = (damage: number): void => {
    const a = game.foeAnchor(b, game.level!)!;
    const box = { left: a.x - 20, right: a.x + 20, top: a.y - 20, bottom: a.y + 20 };
    game.strikeFoe(b, damage, { dx: 30, dy: 0 }, 1, a.y, box, 0, { x: a.x, y: a.y }, { mass: 12, vx: 30, vy: 0 });
  };
  const calls = recordSound(game);
  const effects = (): number[] => calls.filter((c) => c.call === "effect").map((c) => c.args[0] as number);
  b.asleep = false;
  b.state = "gait";
  b.script = 2;
  b.vx = 0;
  const hp0 = b.hp;
  const gobs0 = game.gobs.length;
  const dents0 = b.dents;
  hit(40);
  const grunt = effects().filter((n) => n >= 45 && n <= 47).length;
  if (b.hp !== hp0 - 40 || game.gobs.length === gobs0 || grunt !== 1 || b.vx === 0 || state() !== "gait" || b.dents !== dents0)
    fail(`0x456470: taken, with goo, a grunt and the exchange, and no reaction; hp ${hp0} -> ${b.hp}, gobs +${game.gobs.length - gobs0}, grunts ${grunt}, vx ${b.vx}, ${b.state}, dents ${dents0} -> ${b.dents}`);
  ok(`a blow mid-throw comes off the bar with goo, a grunt and a shove, and it goes on throwing (0x456470)`);

  b.script = 5;
  hit(40);
  if (state() !== "flinch" || b.script !== 9 || b.tag !== 0) fail(`a blow in the melee half is 0x478358 tag 0, kind 9: ${b.state} ${b.script}/${b.tag}`);
  ok(`the take reads kind 9, so a second blow is state 9's`);

  b.state = "gait";
  b.script = 1;
  b.hp = 10;
  calls.length = 0;
  hit(40);
  if (state() !== "dead" || effects().some((n) => n >= 45 && n <= 47) || !effects().includes(51))
    fail(`0x4563ce: the killing blow plays 0x33 alone; heard ${effects().join(",")}`);
  ok(`and the killing blow plays its death alone (0x4563ce, 0x456411)`);

  calls.length = 0;
  const heardAt: [number, number][] = [];
  for (let f = 0; f < 18 * W.death!.hold + 120; f++) {
    const n = calls.length;
    h.frame();
    for (const c of calls.slice(n)) if (c.call === "effect") heardAt.push([f, c.args[0] as number]);
  }
  const tail = heardAt.filter(([, id]) => id === 0x32);
  const crackle = heardAt.filter(([, id]) => id === 0 || id === 1);
  const gaps = crackle.slice(1).map(([f], i) => f - crackle[i][0]);
  if (tail.length !== 1 || crackle.length < 4 || gaps.some((g) => g < 13 || g > 21))
    fail(`0x456134 plays 0x32 once and 0x456171 crackles every 13..20 frames: 0x32 x${tail.length}, crackles at ${crackle.map(([f]) => f).join(",")}`);
  ok(`dead, it plays 0x32 as tag 1 ends and crackles ${crackle.length} times, ${Math.min(...gaps)}..${Math.max(...gaps)} frames apart (0x456171)`);
  game.setSound(null);
}

pass("PLAYGR is its seven dogs, its one boss, and a goal that waits for it");
