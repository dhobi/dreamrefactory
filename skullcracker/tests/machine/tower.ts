/**
 * TOWER — level twelve, the end of chapter three, and the only level in the
 * game that is climbed rather than crossed.
 *
 *   npx tsx tools/runmachine.mts tower      (from skullcracker/)
 *
 * Its five regions stack: the player comes in at (18020, 16285) and the goal is
 * at (17602, 15120), 1165 pixels straight up, with the boss standing on it.
 *
 *   - **the floor** (`initfloor`), five of them, and it is level nine's grave
 *     told the other way round: no health, no blow, and `0x402fa0` at the end.
 *     Four frames whole, three creaking, six caving, and then it is not there.
 *   - **the bishop** (`initvpriest` in the records; `belfry.snd` calls it
 *     `0060 bishopchar[ge]`, `0064 bishopthro[w]`, `0067 bishop die`). Twelve
 *     hundred health, the same number the player has, and no award at all.
 *   - **the surge** (`initsurge`), two tall thin columns down the tower wall,
 *     and the only hazard in the game that GIVES you something: `0x426b21` is a
 *     call to `0x45ef30`, the ammunition adder.
 */
import { fail, headless, ok, pass } from "./harness";
import { FOES } from "../../src/foes";
import { VPRIEST, vpriest, vpriestReacts } from "../../src/brains/vpriest";
import { TICK_SCALE, type BrainCtx, type Enemy } from "../../src/brains/kit";
import { LIGHTFX, SURGE } from "../../src/props";

/**
 * The bishop's machine on its own: handed a stand-in context and called
 * once an engine frame, as `stepFight` calls it.
 */
const machines = (): void => {
  const said: number[] = [];
  let bats = 0;
  const k = {
    player: { x: 0, y: 0, top: 0, anchor: 0, vy: 0, swinging: false, down: false, facing: 1 },
    anchorY: (e: Enemy) => e.y,
    anchorX: (e: Enemy) => e.x,
    shake: () => {},
    flash: () => {},
    burn: () => {},
    spray: () => {},
    track: () => ({ forward: 500, dy: 0, band: 0, side: 1 }),
    roll: () => 1,
    count: () => bats,
    nearest: () => null,
    atRear: () => false,
    say: (_e: Enemy, id: number) => said.push(id),
    hatch: () => {
      bats += 1;
    },
  } as unknown as BrainCtx;
  const f = FOES.initvpriest;
  const bishop = (hp: number): Enemy => ({
    kind: "initvpriest",
    x: 0,
    y: 0,
    facing: 1,
    left: -500,
    right: 500,
    top: -500,
    bottom: 500,
    clock: 0,
    state: "gait",
    anim: VPRIEST.float,
    linger: 0,
    dents: 0,
    vx: 0,
    vy: 0,
    hp,
    max: 1200,
    script: 1,
    tag: 0,
    fighting: true,
  });
  const blow = { damage: 30, hits: 1, dy: 0, facingAway: false };

  // `0x426620` weighs what is LEFT against half of AI+6, not the blow
  const whole = bishop(650);
  if (f.pick!(blow, whole) === 2) fail(`650 left of 1200 is not under half; it vanished`);
  const halved = bishop(590);
  if (f.pick!(blow, halved) !== 2 || halved.nerve !== 590)
    fail(`590 is under half of 1200 — the vanish, and AI+6 becomes 590; nerve ${halved.nerve}`);
  const again = bishop(290);
  again.nerve = 590;
  if (f.pick!(blow, again) !== 2) fail(`290 is under half of 590; it should vanish again`);

  // `0x425d86` through `0x42f8b0`: one pixel a frame more every frame, not a quarter
  const drift = bishop(1200);
  vpriest(drift, f, 18, k);
  if (Math.abs(drift.vx / TICK_SCALE - 1) > 1e-9)
    fail(`the float adds 1 px a frame per frame; it added ${drift.vx / TICK_SCALE}`);

  // `0x42615c`: twelve bats once the vanish has run, held until half are gone,
  // then back with 0x1c and the re-form
  const gone = bishop(500);
  gone.state = "flinch";
  gone.anim = f.flinch![2];
  const run = gone.anim.cels.length * gone.anim.hold;
  gone.clock = run;
  vpriestReacts(gone, f, run, k);
  if (bats !== 12) fail(`0x426173 throws twelve bats; ${bats}`);
  if (gone.clock >= run) fail(`with all twelve up it holds`);
  bats = 6;
  gone.clock = run;
  vpriestReacts(gone, f, run, k);
  if (!said.includes(0x1c) || gone.clock < run)
    fail(`at half it re-forms with 0x1c; said ${said.join(",")}`);
  if (f.flinch![2].resume?.cels[0] !== 2681) fail(`the vanish hands to 0x46f370, the re-form`);
  if (f.linger !== 0 || f.vanishes) fail(`0x426308 removes it at the script's end, with no green ball`);
  ok(
    `the bishop vanishes on its health halving, floats at 1 px/frame², and re-forms from twelve bats at half`,
  );

  /**
   * ...and the summon LETS THREE BATS GO, which is the only thing in this game
   * a creature builds that has a mind of its own.
   *
   * `0x425e8a` wants `0x434540(0x2a) <= 13` AND `AI+0` at or under half of
   * `0x40e300(0x4b0)`; `0x42601a` then sets the count to three and `0x426340`
   * makes each one. Asked here of the machine alone, and again below of the
   * running game, where "under half" is only reached THROUGH the vanish.
   */
  let hatched = 0;
  const near = {
    ...k,
    track: () => ({ forward: 120, dy: 0, band: 2, side: 1 }),
    roll: () => 1,
    scaled: (n: number) => n,
    cast: () => {},
    hatch: () => {
      hatched += 1;
    },
  } as unknown as BrainCtx;
  const wounded = bishop(590);
  wounded.nerve = 590;
  vpriest(wounded, f, 1, near);
  if (wounded.script !== 2 || wounded.tag !== 2)
    fail(`inside 170, hurt, on 0x434540(0x2a) = 1 it summons (kind 2 tag 2); it went kind ${wounded.script} tag ${wounded.tag}`);
  wounded.clock = wounded.anim.cels.length * wounded.anim.hold;
  vpriest(wounded, f, wounded.clock, near);
  if (hatched !== 3) fail(`0x42601a lets three go; ${hatched} came out`);
  const healthy = bishop(1200);
  vpriest(healthy, f, 1, near);
  if (healthy.script !== 2 || healthy.tag !== 0)
    fail(`above half its 1200 the same roll casts (kind 2 tag 0); it went kind ${healthy.script} tag ${healthy.tag}`);
  ok(
    `...and hurt it summons, three bats out of 0x42601a; whole, the same roll casts`,
  );
};

machines();

const h = await headless("level=12");
const { game } = h;
const go = async (q: string): Promise<void> => {
  await h.load(`level=12${q}`);
  h.until(() => game.p.onGround, 60);
  h.frame(4);
};
const tap = (key: "left" | "right", frames = 1): void => {
  h.hold(key, true);
  h.frame(frames);
  h.hold(key, false);
};
const roomNo = () => game.level!.rooms.indexOf(game.p.room!) + 1;
const bishop = () => game.spawnedHere().find((e) => e.kind === "initvpriest")!;
const bats = () => game.spawnedHere().filter((e) => e.kind === "initbat" && e.state !== "dead");
const V = FOES.initvpriest;
const vanished = (b: Enemy) => b.anim === V.flinch![2];

/**
 * One exchange of the fight with the bishop, fought from EAST of the goal.
 *
 * The goal rect runs x17461..17746 and the bishop's own rect 17130..18075, so
 * a chase goes in and out of it — and the craft opens on the player coming
 * BACK into the rect (`leftGoal` in `src/game.ts`), which ends the level in
 * the middle of the fight. So the fight starts east of it and never steps west
 * of {@link EAST_OF_GOAL}; the bishop comes to the player anyway.
 *
 * It floats, the way level eight's boss does: a standing kick passes under a
 * body box that runs from 109 above its anchor to 31 below, so it is the
 * jump-kick.
 */
const EAST_OF_GOAL = 17860;
let swings = 0;
const bishopStep = (): void => {
  const b = bishop();
  const d = Math.max(b.x, EAST_OF_GOAL) - game.p.x;
  if (Math.abs(d) < 90) {
    // the kick is read in the air only once the four-frame wind-up is spent
    // ...and the boot and the fist in turn: `0x4029e0` weakens a move repeated
    // inside four seconds, and a different one lands whole again
    h.press("jump");
    h.frame(5);
    h.press(swings++ % 2 ? "punch" : "kick");
    h.frame(5);
  } else tap(d > 0 ? "right" : "left");
};

// 1. five regions stacked, a census of eight, a share of nothing and no clock
await go("");
if (game.level!.rooms.length !== 5) fail(`TOWER has five regions; it has ${game.level!.rooms.length}`);
if (game.mission().kill !== 0 || game.stats.census !== 8)
  fail(`3 Ghengis, 4 skeletons and one bishop count and its 8 bats do not; the census is kill ${game.mission().kill} of ${game.stats.census}`);
if (game.stats.ticks < 31000) fail(`TOWER carries no timer record, so no limit; the clock reads ${game.stats.ticks}`);
ok(`TOWER is five stacked regions, a census of eight, no kills wanted and no clock`);

// 2. the floor at x17515. `0x426f80` starts it on the player's own point
//    inside its rect, and then it is four frames, three, and six.
await go("&x=17800");
const floor = game.hereOf((l) => l.floors).find((f) => f.x === 17515);
if (!floor || floor.state !== "whole" || game.floorCel(floor) !== 9010) fail(`the floor at x17515 opens whole on 9010; it is ${floor?.state} ${floor && game.floorCel(floor)}`);
h.hold("left", true);
const states = new Set<string>();
let fell = 0;
const from = game.p.y;
for (let i = 0; i < 54; i++) {
  h.frame();
  states.add(floor.state);
  fell = Math.max(fell, game.p.y - from);
}
h.hold("left", false);
for (const want of ["creaking", "caving", "gone"])
  if (!states.has(want)) fail(`a floor goes whole -> creaking -> caving -> gone; it showed ${[...states].join(" ")}`);
if (fell < 100) fail(`and it should drop whoever is on it; the player fell ${fell}`);
ok(`walking onto one runs it ${[...states].join(" -> ")} and drops you ${fell} pixels`);

// 3. the bishop, on the goal, with the player's own twelve hundred health
await go("&x=17600&y=15300");
{
  const b = bishop();
  if (!b || b.hp !== 1200 || b.max !== 1200) fail(`0x41ebc4 gives it 0x40e300(0x4b0); it has ${b?.hp}/${b?.max}`);
  const g = game.solids().goal!;
  const box = game.playerBox();
  if (!g || !(box.right > g.left && box.left < g.right && box.bottom > g.top && box.top < g.bottom))
    fail(`the bishop stands ON the goal, and the player beside it should be in the goal rect`);
  // ...and standing in it is not enough: `0x421a38` asks `[0x46ece0]` and
  // nothing else, and only the bishop's death writes it (`0x426600`)
  h.frame(4);
  if (game.goalReady() || game.waitsFor() !== "the bishop")
    fail(`0x421a38 waits for [0x46ece0]; the goal is ${game.goalReady() ? "open" : "shut"} with the bishop standing, waiting for ${game.waitsFor()}`);
  game.killFoe(b, FOES.initvpriest);
  if (!game.goalReady()) fail(`the bishop's death writes [0x46ece0] (0x426600); the goal is still shut`);
  ok(`the goal waits for the bishop, whatever the count says, and opens when it dies`);
}
// a bat thrown past the room's east wall stays in the fight: the creator gives
// it region -1 (`0x426378`) and the mover files it by its point only once that
// is inside a region (`0x43000a`) — not in the first room of the level
{
  const b = bishop();
  const r = game.p.room!;
  const n0 = bats().length;
  game.hatchAt(b, "initbat", { x: r.right + 40, y: b.y, facing: 1 });
  if (bats().length !== n0 + 1)
    fail(`a bat let go past x${r.right} should fly with the bishop's room; ${bats().length - n0} joined it`);
  game.spawnedHere().pop();
  ok(`a bat thrown past the east wall, x${r.right + 40}, stays in the bishop's room`);
}
// ...and fought from east of the goal — see {@link bishopStep}
await go("&x=17950&y=15300");
const before = game.stats.score;
let low = 1200;
let steps = 0;
for (; steps < 900 && low > 900; steps++) {
  bishopStep();
  low = Math.min(low, bishop().hp);
  if (bishop().state === "dead") break;
}
if (low >= 1200) fail(`the bishop should be taking damage; it never dropped below ${low}`);
/**
 * The bishop itself pays nothing — `0x4264f0` has no `0x40d450` in it at all
 * and `initvpriest`'s own award is 0. Beating it hard enough sends it to the
 * VANISH (`0x426633`'s half-of-`AI+6` bar) and twelve bats come out of it.
 * Those DO pay: `0x42640c` is `0x40d450(0x46)`, seventy apiece. So every point
 * earned here is a whole bat, and none of them is the bishop.
 */
const paid = game.stats.score - before;
if (paid % 70 !== 0) fail(`0x4264f0 pays nothing and a bat pays seventy; the score moved by ${paid}`);
ok(`the bishop is 1200 health, stands on the goal, and pays nothing itself — down to ${low}, ${paid / 70} bats`);

/**
 * ...and the SUMMON, in the running game.
 *
 * "Under half" is only reached THROUGH the vanish — the blow that takes it
 * below 600 is the one `0x426620` answers with `0x46f308` — so the fight goes
 * on to the vanish. Then it holds until the bats' count has fallen to half of
 * what it was after the throw (`0x4261f8`). Hunting them down on foot is a
 * chase round the whole tower, so they are killed here straight through the
 * game's own `killFoe` — the same death, award and all, a blow would give
 * them — and the rest is the game's: the re-form (`0x426218`, kind 5), the
 * float, and a wounded bishop inside 170 that rolls `0x434540(0x2a) <= 13`
 * and lets three bats go out of `0x42601a`.
 */
for (let i = 0; i < 3000 && !(vanished(bishop()) && bishop().hatched); i++) bishopStep();
{
  const b = bishop();
  if (!vanished(b) || !b.hatched) fail(`the fight never sent the bishop into its vanish; it is at ${b.hp}hp`);
  if (b.hp > 600) fail(`the vanish is under half of 1200 (0x426633); it vanished at ${b.hp}`);
  const side = b.side ?? 0;
  if (bats().length !== side) fail(`0x4261eb counts the bats after the throw; it holds ${side}, ${bats().length} are up`);
  // still more than half up: it holds
  h.frame(15);
  if (!vanished(bishop()) || bishop().script === 5) fail(`with every bat up it should hold its vanish (0x4261f8)`);
  // ...kill down to half — and one frame later it comes back
  while (bats().length > Math.floor(side / 2)) game.killFoe(bats()[0], FOES.initbat);
  if (h.until(() => b.script === 5, 3) < 0) fail(`at half the bats (${bats().length} of ${side}) it should re-form, kind 5; it is kind ${b.script}`);
  const hurt = b.hp;
  const count = bats().length;
  // stand within 170 of it: it comes to the player, level, and considers
  let summoned = -1;
  for (let i = 0; i < 600 && summoned < 0; i++) {
    if (b.script === 2 && b.tag === 2) summoned = i;
    else if (b.script === 1 && Math.abs(b.x - game.p.x) > 150) tap(b.x > game.p.x ? "right" : "left");
    else h.frame();
  }
  if (summoned < 0) fail(`a bishop at ${hurt} of 1200 inside 170 never summoned (kind 2 tag 2, 0x425e8a)`);
  if (b.hp > 600) fail(`the summon wants AI+0 at or under half its 1200 (0x425e99); it is at ${b.hp}`);
  h.until(() => b.tag !== 2, 40);
  if (b.tag !== 3) fail(`the summon hands to the settle, tag 3 (0x4260a7); it went kind ${b.script} tag ${b.tag}`);
  if (bats().length !== count + 3) fail(`0x42601a lets three go; the bats went ${count} -> ${bats().length}`);
  ok(`...and in the game, past the vanish and half its bats, a bishop at ${hurt} summons ${summoned} frames on and three bats come out (${count} -> ${bats().length})`);
}

// 4. the two surges, switched on by the lightning's counter as it wraps
//    (`0x42682b`) and hopping 75 down their column each run of six cels
//    (`0x426b5a`). The object stands at its rect's top-left (`0x41ec66`), so
//    the first is at x17936. A period is 202 frames, 13.5 seconds.
await go("&x=17900&y=15300");
const surge = game.hereOf((l) => l.surges).find((q) => q.x === 17936);
if (!surge) fail(`no surge at x17936`);
const arcs = new Set<number>();
const ys: number[] = [];
const onAt: number[] = [];
let wasOn = !!surge.on;
for (let f = 0; f < 3 * LIGHTFX.period && onAt.length < 3; f++) {
  h.frame();
  if (surge.on) {
    arcs.add(game.surgeCel(surge));
    if (ys[ys.length - 1] !== surge.y) ys.push(surge.y);
    if (!wasOn) onAt.push(f);
  }
  wasOn = !!surge.on;
}
if (arcs.size !== 6 || [...arcs].some((c) => c < 9060 || c > 9065))
  fail(`0x46f648 is six cels at one frame each, 9060..9065; the surge showed ${[...arcs].join(" ")}`);
if (ys.length < 3 || ys.some((y, i) => (y - 14587) % 75 !== 0 || (i > 0 && y - ys[i - 1] !== SURGE.hop && y !== surge.top)))
  fail(`0x426b5a hops the arc 75 at a time down from y14587; saw ${ys.join(" ")}`);
if (onAt.length < 2) fail(`the surge should switch on every period; it switched on at ${onAt.join(", ")}`);
const surgePeriods = onAt.slice(1).map((f, i) => f - onAt[i]);
if (surgePeriods.some((d) => d !== 202)) fail(`the lightning's wrap switches it on every 202 frames (0x42682b); it came on at ${onAt.join(", ")}`);
ok(`and its surges arc through all six of 9060..9065, hopping down ${[...new Set(ys)].slice(0, 4).join(" ")}..., switched on every ${surgePeriods[0]} frames`);

/**
 * ...and the bishop has a MACHINE.
 *
 * `0x425c90`, the same tracker again, banded against `0x46f4c0`'s 220, 170 and
 * 100. At band 1 it commits on EIGHT in ten — `0x434540(10)` answers 1..10 and
 * `cmp eax, 3; jl` is the branch that walks away — inside 170 it always
 * considers, and then `0x434540(0x2a) <= 13` picks the sixteen-cel summon over
 * the cast. Its recoil is the animation's own dx: -30, -20, -10.
 *
 * The states are `obj+0x18`, the kind of the script it is playing: 1 is the
 * float, `0x46f170`, and 2 is `0x46f1c0`, all four attack tags.
 */
await go("&x=17620&y=15200");
const modes = new Set<string>();
const cels = new Set<number>();
for (let i = 0; i < 250; i++) {
  const b = bishop();
  if (b.script !== undefined) modes.add(`${b.script} tag ${b.tag ?? 0}`);
  cels.add(game.celOf(b));
  h.frame();
}
// kind 2 is `0x46f1c0` — tag 0 the cast, tag 1 the recoil, tag 2 the summon,
// tag 3 the settle every one of them ends on
if (![...modes].some((m) => m.startsWith("2 tag"))) fail(`inside 170 it always considers an attack; it only did ${[...modes].join(", ")}`);
/**
 * ...and every attack hands back to the FLOAT. `0x4527cc` ends tag 0, the
 * cast, on tag 1, the recoil, and tag 1 installs `0x46f170` — kind 1, the
 * state that decides.
 */
if (!modes.has("1 tag 0")) fail(`every attack hands back to the float, kind 1; it did ${[...modes].join(", ")}`);
if (![...cels].some((c) => (c >= 2600 && c <= 2614) || (c >= 2650 && c <= 2658)))
  fail(`it should fight on its 2600s or 2650s; saw ${[...cels].join(" ")}`);
ok(`and its bishop works its own bands — ${[...modes].sort().join(", ")} — on its 2500s, 2600s and 2650s`);

// the LIGHTNING — `initlightfx`, the one class in the game that nothing places
// and nothing triggers. `0x426800` is a metronome on the level's own counter:
// 202 engine frames a period, the strike on 195, and the two records carry
// params 1 and -1 so both play tag 0 of `0x46f588` and one of them is flipped.
// (from the floor BELOW the bolts' points, y14755: above them they strike you)
await h.load("level=12&x=17600&y=15300");
const lit = game.level!.lights.flat();
if (lit.length !== 2) fail(`TOWER places two lightfx records; it has ${lit.length}`);
if (LIGHTFX.period !== 202 || LIGHTFX.strikeAt !== 195) fail(`0x426815's counter runs 0..201 and 0x426837 strikes on 0xc3`);
const struck: number[] = [];
const bolts = new Map<number, string>();
let wrapped = -1;
let maxClock = 0;
for (let f = 0; f < 3 * LIGHTFX.period; f++) {
  const was = game.levelClock;
  h.frame();
  maxClock = Math.max(maxClock, game.levelClock);
  if (game.levelClock < was && wrapped < 0) wrapped = f;
  const cels = lit.map((q) => game.lightCel(q));
  if (cels.some((c) => c !== 0)) {
    if (game.levelClock === LIGHTFX.strikeAt) struck.push(f);
    bolts.set(game.levelClock, cels.join(","));
  }
}
if (maxClock !== 201) fail(`0x426815's counter runs 0..201; it reached ${maxClock}`);
if (struck.length < 2) fail(`nothing struck twice in three periods — 0x426800 strikes every 202 frames; struck at ${struck.join(", ")}`);
const strikes = struck.slice(1).map((f, i) => f - struck[i]);
if (strikes.some((d) => d !== 202)) fail(`0x426800 strikes every 202 frames; it struck at ${struck.join(", ")}`);
if (!bolts.has(195)) fail(`0x426837 strikes on 0xc3; it struck on ${[...bolts.keys()].join(" ")}`);
const drawn = new Set([...bolts.values()].flatMap((v) => v.split(",").map(Number)));
const stray = [...drawn].filter((c) => c !== 0 && (c < 9081 || c > 9086));
if (stray.length) fail(`0x46f588 tag 0 is 9081..9086; saw ${stray.join(" ")}`);
if ([...bolts.values()].some((v) => v.split(",")[0] !== v.split(",")[1]))
  fail(`both records play the same tag, one flipped — they should never disagree on the cel`);
ok(`and its lightning strikes every ${strikes[0]} frames on 195 of its 0..201, ${bolts.size} counter values lit on 9081..9086`);

/**
 * ...and it strikes YOU, from above its own point. `0x426780` asks on the
 * bolt's first frame whether its point is below the player's (`0x42679c`) —
 * no x at all — and then: the scepter drawn (`0x402ee0`, weapon 16) is
 * `0x402fa0(6)`, the charge; anything else is `0x402fa0(7)`, the shock
 * (`0x4721a0` tag 3) and the death. At x17600 on the ledge at y14700 the
 * player stands above both bolts, whose points are at y14755.
 */
{
  const toStrike = (): void => {
    for (let i = 0; i < LIGHTFX.period + 2 && game.levelClock !== LIGHTFX.strikeAt - 1; i++) h.frame();
  };
  await h.load("level=12&x=17600&y=14700&lives=3");
  h.frame(4);
  toStrike();
  h.hold("right", true);
  h.frame();
  if (game.p.act !== "dying" || game.p.dyingTag !== 3 || game.stats.lives !== 2 || game.held.right)
    fail(`struck unarmed above a bolt: the tag-3 death, a life, and the keys dropped; ${game.p.act} tag ${game.p.dyingTag}, lives ${game.stats.lives}, right ${game.held.right}`);
  h.hold("right", false);
  // ...and on the bolt's second frame on its first cel it asks again, and
  // `0x45d090` puts tag 3 on from its first frame again: the shock starts over
  // one frame late, and the life is not spent twice
  const first = game.p.actClock;
  h.frame();
  if (game.p.actClock !== first || game.stats.lives !== 2)
    fail(`the second ask restarts the shock and costs nothing more: clock ${first} then ${game.p.actClock}, lives ${game.stats.lives}`);
  ok(`struck from above its point with no scepter, the player dies on the shock's tag 3, started over by the bolt's second frame`);

  await h.load("level=12&x=17600&y=14700&lives=3");
  h.frame(4);
  game.inv.weapon = LIGHTFX.rod;
  game.inv.armed = true;
  game.inv.drawn = true;
  game.inv.rounds[LIGHTFX.rod] = 40;
  const guns = game.hereOf((l) => l.guns).length;
  toStrike();
  h.frame();
  if ((game.p.act as string) !== "struck" || (game.stats.lives as number) !== 3) fail(`with the scepter drawn a strike is the charge, 0x470c40 tag 18: ${game.p.act}, lives ${game.stats.lives}`);
  const beams: number[] = [];
  for (let i = 0; i < 20 && (game.p.act as string) === "struck"; i++) {
    h.frame();
    for (const q of game.streams) if (q.variant !== undefined && q.clock === 1) beams.push(q.variant);
  }
  if (beams.join(",") !== "3,4,3,4") fail(`tags 18..21 each let a beam go, variants 3, 4, 3, 4 (0x42d93e / 0x42d98a); saw ${beams.join(",")}`);
  if ((game.p.act as string) !== "downFront" || game.inv.armed || game.inv.drawn || game.inv.rounds[LIGHTFX.rod] !== 160 || game.hereOf((l) => l.guns).length !== guns + 1)
    fail(`and tag 22 fills it, throws it down and knocks you over (0x42d9d7): ${game.p.act}, armed ${game.inv.armed}, rounds ${game.inv.rounds[LIGHTFX.rod]}, guns ${guns} -> ${game.hereOf((l) => l.guns).length}`);
}
ok(`struck with the scepter drawn, it lets the bolt out four times, fills, and is knocked out of your hands`);

// ...and the second character: its own dispatcher `0x449700` sends mode 7 to
// `0x476758` tag 3 (`0x449856`) and mode 6 to `0x4752f0` tag 18 (`0x449836`),
// and its armed machine `0x4478b0` runs tags 18..22 exactly as the first's
// (`0x447e5b`, `0x447ea7`, `0x447ee4`), down on its own `0x476890`
{
  const toStrike = (): void => {
    for (let i = 0; i < LIGHTFX.period + 2 && game.levelClock !== LIGHTFX.strikeAt - 1; i++) h.frame();
  };
  await h.load("level=12&x=17600&y=14700&lives=3&char=1");
  h.frame(4);
  toStrike();
  h.frame();
  if (game.CHARACTER !== 1 || game.p.act !== "dying" || game.actOf("dying")?.cels[0] !== 9700)
    fail(`the second, struck unarmed: 0x476758 tag 3, from 9700; ${game.CHARACTER} ${game.p.act} ${game.actOf("dying")?.cels[0]}`);
  await h.load("level=12&x=17600&y=14700&lives=3&char=1");
  h.frame(4);
  game.inv.weapon = LIGHTFX.rod;
  game.inv.armed = true;
  game.inv.drawn = true;
  toStrike();
  h.frame();
  const cel = game.actOf("struck")?.cels[0];
  const beams: number[] = [];
  for (let i = 0; i < 20 && (game.p.act as string) === "struck"; i++) {
    h.frame();
    for (const q of game.streams) if (q.variant !== undefined && q.clock === 1) beams.push(q.variant);
  }
  if (cel !== 8324 || beams.join(",") !== "3,4,3,4" || (game.p.act as string) !== "downFront" || game.inv.rounds[LIGHTFX.rod] !== 160)
    fail(`the second, struck with the scepter: 8324, beams 3,4,3,4, full and down; ${cel} ${beams.join(",")} ${game.p.act} ${game.inv.rounds[LIGHTFX.rod]}`);
  await h.load("level=12&char=0");
}
ok(`and the second character is struck the same way, on its own cels`);

/**
 * ...and its three LADDERS carry you between its regions, both ways.
 *
 * All three of TOWER's span more than one region — two, three and four of them.
 * The engine files nothing: `0x40b940` is its only entity query and it is a
 * linear scan of the whole table, kind 2 asking whether a rect holds a point
 * (`0x434200`), with no reference to a region anywhere in it. So the ladders
 * are kept whole on the level.
 *
 * Each row is the record's own `pointX`, a y at the ladder's HEAD, and the two
 * legs the rect is worth — where the head can be stood on. Two of the three
 * cannot: the second's is a floor that gives way under a player who waits on
 * it, and the third's is inside an `initsurge` arc, and a shocked player is in
 * `p.act` and can take hold of nothing. Those two start at the foot instead
 * and their descent is worth nothing.
 */
for (const [x, head, down, up] of [
  [16242, 15850, 340, 480],
  [17222, 15690, -20, 780],
  [17974, 15900, -20, 660],
] as const) {
  await go(`&x=${x}&y=${head}`);
  // where it actually put us: the load drops the player onto the room's own
  // floor, which is not the y asked for
  const from = game.p.y;
  h.hold("down", true);
  h.frame(165);
  h.hold("down", false);
  h.frame(5);
  const foot = game.p.y;
  const lowRoom = roomNo();
  h.hold("up", true);
  h.frame(195);
  h.hold("up", false);
  h.frame(5);
  const top = game.p.y;
  const highRoom = roomNo();
  if (foot - from < down) fail(`the ladder at x${x} should take you ${down}px down; it went ${from} to ${foot}`);
  if (foot - top < up) fail(`the ladder at x${x} should lift you ${up}px; it went ${foot} to ${top}`);
  if (lowRoom === highRoom) fail(`the ladder at x${x} reaches out of room ${lowRoom}; the player never left it`);
  ok(`the ladder at x${x} runs ${foot - top}px, room ${lowRoom} to room ${highRoom}`);
}

pass("TOWER's floors give way, its bishop stands on the goal and summons, its surges arc, its lightning strikes and its ladders climb");
