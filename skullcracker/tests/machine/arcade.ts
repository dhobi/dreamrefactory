/**
 * ARCADE — level eight, and the end of chapter two.
 *
 *   npx tsx tools/runmachine.mts arcade      (from skullcracker/)
 *
 * Fourteen records, which makes it the smallest level in the game: one room
 * 1845 pixels wide with a flat floor, one boss, seven sprinkler positions, two
 * pickups, a `probe` and a `goal` — and the goal is **thirty pixels from where
 * you start**, because level eight is not a route at all. Chapter two's fourth
 * share is the one stored as zero, so nothing opens until the room is empty, and
 * the room is one thing with a thousand health.
 *
 * What the file says, and what this checks:
 *
 *   - **`initkragg` is a global, not a class.** `0x441bd0` makes the object once
 *     and keeps it at `0x4a6ff8`; `0x436180`, the "creator" the level's spawner
 *     calls, only moves the thing that already exists onto the record's point.
 *   - **a thousand health, a divisor of fifty, and no gravity** — so it hangs
 *     where its record put it, out of reach of anything but a jump.
 *   - **it pays nothing.** There is no `0x40d450` anywhere in its code: the
 *     chapter's last boss is worth the stage and not a point.
 *   - **`0x2d` sorts its takes**: under 45 one of three single cels, 45 or over
 *     the six-cel one.
 *   - **a sprinkler record is not an object** — `0x440800` files each one's point
 *     into a seven-entry table by its own `param`, and nothing stands there
 *     until the boss does.
 */
import { fail, headless, ok, pass, recordSound } from "./harness";
import { FOES, type FoeAnim } from "../../src/foes";
import {
  kragg,
  kraggGate,
  kraggReacts,
  KRAGG,
  seedKraggFall,
} from "../../src/brains/kragg";
import { TICK_SCALE, type BrainCtx, type Enemy } from "../../src/brains/kit";

/**
 * The machine itself, on its own: `kragg` handed a stand-in context and
 * called once an engine frame, as `stepFight` calls it.
 */
const machines = (): void => {
  const said: number[] = [];
  let band = 0;
  let sprinklerX = 100;
  const k = {
    player: { x: 0, y: 0, top: 0, anchor: 0, vy: 0, swinging: false, down: false, facing: 1 },
    anchorY: (e: Enemy) => e.y,
    anchorX: (e: Enemy) => e.x,
    shake: () => {},
    flash: () => {},
    burn: () => {},
    spray: () => {},
    track: () => ({ forward: 1000, dy: 0, band, side: 1 }),
    roll: () => 1,
    scaled: (n: number) => n,
    say: (_e: Enemy, id: number) => said.push(id),
    cast: () => undefined,
    sprinkler: () => ({ x: sprinklerX, y: -0x78 }),
    raise: () => undefined,
    gravity: 1,
  } as unknown as BrainCtx;
  const K = FOES.initkragg;
  const e: Enemy = {
    kind: "initkragg",
    x: 0,
    y: 0,
    facing: 1,
    left: -9999,
    right: 9999,
    top: -9999,
    bottom: 9999,
    clock: 0,
    state: "gait",
    anim: K.gait,
    linger: 0,
    dents: 0,
    vx: 0,
    vy: 0,
    hp: 1000,
    max: 1000,
    script: 1,
  };

  // `0x440df1` — band 0 closes on `0x473850`, played ONCE so its last frame
  // holds and keeps adding its dx (see Foe.accrues, which the class sets)
  kragg(e, K, 5, k);
  if (e.script !== 2 || e.anim !== KRAGG.closeIn || !e.swing || !K.accrues)
    fail(`band 0 installs 0x473850 tag 0 held, on an accruing class: kind ${e.script}, held ${e.swing}`);
  ok(`beyond 250 it closes on 0x473850, held so its dx 120 keeps building (0x45d1a3)`);

  // `0x44155b` — the flare's drag is ceil(d / 50) a frame into the velocity,
  // and the prologue's ±40 (`0x440af2`) holds in state 9 too
  e.state = "flinch";
  e.anim = K.burns!.anim!;
  e.vx = 0;
  e.clock = 1;
  kraggReacts(e, K, 52, k);
  if (Math.abs(e.vx - 2 * TICK_SCALE) > 1e-9)
    fail(`a sprinkler 100 away pulls ceil(100/50) = 2 a frame; vx went to ${e.vx / TICK_SCALE}`);
  sprinklerX = 5000;
  for (let f = 2; f < 40; f++) {
    e.clock = f;
    kraggReacts(e, K, 52, k);
  }
  if (Math.abs(e.vx - 40 * TICK_SCALE) > 1e-9)
    fail(`0x440aff holds obj+0xc at 40 while it is dragged; it reads ${e.vx / TICK_SCALE}`);
  ok(`a flare drags it ceil(d/50) a frame and never past forty (0x44155b, 0x440aff)`);

  // `0x441615` — the fall: tag 0 is weightless and steered, laps five times on
  // `[0x473de0]` saying 0x14 each lap, then tag 1 puts the weight on and lifts
  e.state = "gait";
  e.anim = K.rallies!.fall;
  e.script = 10;
  e.tag = 0;
  e.rallied = true;
  e.hp = 0;
  e.home = 500;
  e.vx = 0;
  e.vy = 0;
  said.length = 0;
  const lap = K.rallies!.fall.cels.length * K.rallies!.fall.hold;
  // `[0x473de0]` as `.data` has it, whatever an earlier fixture spent
  seedKraggFall();
  let weightlessInTag0 = true;
  for (let f = 0; f < 20 && e.tag === 0; f++) {
    e.clock = lap;
    kragg(e, K, lap, k);
    if (e.tag === 0) weightlessInTag0 &&= !!e.weightless;
  }
  const thuds = said.filter((id) => id === 0x14).length;
  if (thuds !== 6 || e.anim !== KRAGG.fallLand)
    fail(`five laps then tag 1, six 0x14s: ${thuds} and ${e.anim.from}`);
  if (!weightlessInTag0 || e.vx <= 0)
    fail(`tag 0 is weightless and steered toward [0x4a7574]: weightless ${weightlessInTag0}, vx ${e.vx}`);
  if (!(e.vy < 0)) fail(`tag 1's first frame lifts 150 (-3 a frame through 50); vy ${e.vy}`);
  e.clock = 1;
  kragg(e, K, 4, k);
  if (e.weightless) fail(`0x4416e6 gives tag 1 its weight`);
  ok(`shot down it laps its fall five times, steered, then lifts and falls under weight (0x441615, 0x4416e6)`);

  // `0x440b31` / `0x440b43` — the ground form keeps no sideways speed and is
  // put back on [0x4a7574] every frame
  e.script = 12;
  e.tag = 0;
  e.anim = KRAGG.stand;
  e.home = 123;
  e.x = 200;
  e.vx = 5;
  band = -1;
  kragg(e, K, 1, k);
  if (e.x !== 123 || e.vx !== 0) fail(`the ground form is pinned to 0x4a7574: x ${e.x}, vx ${e.vx}`);
  if (e.floor !== -15) fail(`0x440b55 writes the ground form's floor offset −15; it is ${e.floor}`);
  ok(`the grounded form stands on [0x4a7574] with no sideways speed`);

  // `0x441e5b`, `0x441ef0` — the takes, in the air and on the ground
  const pick = K.pick!;
  // `behind` puts the player west of a kragg facing east — `0x441fdb` weighs
  // his x against its own, not the blow's direction
  const blow = (damage: number, behind = false) => ({
    damage,
    hits: 1,
    dy: 0,
    facingAway: behind,
    playerX: behind ? 0 : 200,
    pointX: 100,
  });
  if (pick(blow(20), { max: 1000, script: 8 }) !== 4) fail(`mid-dive, under 0x2d, is 0x473a48 tag 4`);
  if (pick(blow(50), { max: 1000, script: 8 }) !== 3) fail(`mid-dive, 0x2d or more, is tag 3`);
  if (!K.flinch![4].resume || K.flinch![4].resume.kind !== 8 || K.flinch![4].resume.tag !== 1)
    fail(`tag 4 hands to the dive's recovery, 0x473950 tag 1 (0x44123b)`);
  const ground = { max: 1000, rallied: true, facing: 1 };
  const first = [pick(blow(20), ground), pick(blow(20), ground), pick(blow(20), ground)];
  if (first.some((i) => i < 5 || i > 7)) fail(`the ground form's first three takes are 0x473ba8: ${first}`);
  if (pick(blow(20, true), ground) !== 8) fail(`the fourth from behind snaps it round, 0x473bd8 tag 2`);
  pick(blow(20), ground);
  pick(blow(20), ground);
  pick(blow(20), ground);
  if (pick(blow(20), ground) !== 10) fail(`the fourth from in front swings back, 0x473cc8 tag 1`);
  ok(`its takes: tag 4 mid-dive, and on the ground three takes then a snap or a swing (0x441f44)`);

  // `0x441f5f` — the ground form's death is 0x473d38 and the body stays
  if (K.death!.cels.at(-1) !== 7117 || K.linger !== Infinity || K.vanishes)
    fail(`0x473d38 ends on 7117 and state 16 never removes it`);
  ok(`and it dies on 0x473d38 and stays down`);

  // `0x44185f`: the ground turn's tag 1 roars while the script's frame index
  // is 0xa — its third record — on a roll under thirty, through `0x40f090`
  const roared: string[] = [];
  const kr = { ...k, say: (_e: Enemy, id: number, way?: string) => roared.push(`${id}:${way}`) } as BrainCtx;
  const turn = KRAGG.groundTurn[1];
  const t: Enemy = { ...e, anim: turn, script: 13, tag: 1, state: "gait", clock: 0 };
  for (t.clock = 0; t.clock < turn.cels.length * turn.hold - 1; t.clock += 1) kragg(t, K, turn.cels.length * turn.hold, kr);
  if (roared.length !== turn.hold || roared.some((r) => r !== `${0x1b + 1}:lead`))
    fail(`0x44189e roars 0x1b + roll(2) on each frame of tag 1's third record; heard ${roared.join(" ")}`);
  ok(`its ground turn roars on the third record of tag 1, through 0x40f090, every frame it shows`);
};

machines();

const h = await headless("level=8");
const { game } = h;
const go = async (q = ""): Promise<void> => {
  await h.load(`level=8${q}`);
  h.until(() => game.p.onGround, 60);
  h.frame(4);
};
const tap = (key: "left" | "right", frames = 1): void => {
  h.hold(key, true);
  h.frame(frames);
  h.hold(key, false);
};
const boss = () => game.spawnedHere().find((e) => e.kind === "initkragg")!;
const up = () => game.columns.size;
const K = FOES.initkragg;

// 1. one room, one enemy, and a quota of everything
await go();
if (game.level!.rooms.length !== 1) fail(`ARCADE is one region; it has ${game.level!.rooms.length}`);
const all = game.spawnedHere().length;
if (all !== 1) fail(`ARCADE places one enemy and one only; ${all} spawned`);
if (game.mission().kill !== 1 || game.stats.census !== 1)
  fail(`its share is the one stored as zero: kill ${game.mission().kill} of ${game.stats.census}`);
ok(`ARCADE is one room with one thing in it, and the quota is all of it`);

// 2. a thousand health, no gravity, and it HUNTS: over 250 forward is band 0
//    and band 0 is `0x473850`, which closes at the stride that script carries
const first = boss();
if (!first) fail(`the boss should stand in ARCADE`);
if (first.max !== 1000) fail(`0x441c33 gives it 0x3e8; it has ${first.max}`);
const wasX = first.x;
/**
 * ...and the bob is the HOVER's, not the close's.
 *
 * `0x440ce6` puts ±1 into the vertical velocity every frame and flips it at one
 * of two limits — but that is `0x440cc4`, the kind 1 handler, and kind 1
 * alone. While it is closing it is on kind 2, `0x473850`, and it holds its
 * height: the flying form has no gravity (`0x441c1f`) so nothing pulls it down
 * in between.
 */
const ys = new Set<number>();
const kinds = new Set<number>();
for (let i = 0; i < 270; i++) {
  h.frame();
  const b = boss();
  if (b.script !== undefined) kinds.add(b.script);
  // ...and only the hover and the close hold a height: once it arrives, the
  // maul (`0x440ff1`) and the dive (`0x44134a`) home on the player's own point
  // and bring it down to him
  if (b.script === 1 || b.script === 2) ys.add(Math.round(b.y));
}
if (wasX - boss().x < 60) fail(`from a thousand away it should close; x ${wasX} -> ${boss().x}`);
if (!kinds.size) fail(`the boss should be running a machine of its own; it reported no kind`);
ok(`it closes from x ${Math.round(wasX)} to x ${Math.round(boss().x)} under its own machine (kinds ${[...kinds].sort().join(" ")})`);

// 3. ...and it holds the height its own `0x473ddc` asks for: the player some
//    35 pixels below it, with the limits widening when they are not
const lo = Math.min(...ys);
const hi = Math.max(...ys);
if (hi - lo > 90) fail(`the bob is bounded by 0x473dd4/0x473dd8; it ranged y ${lo}..${hi}`);
ok(`and stays inside y ${lo}..${hi}, which is what its own limits allow`);

// 4. seven sprinkler positions, filed by their own param, and none up yet
const sprinklers = game.hereOf((l) => l.sprinklers).length;
if (sprinklers !== 7 || up() !== 0) fail(`ARCADE places seven, all down: ${sprinklers} sprinklers, ${up()} up`);
ok(`its seven sprinkler positions are read off the records, and none is up`);

// 5. the goal is shut while it lives — and the player starts standing in it
await go();
if (game.p.x > 300) fail(`ARCADE starts at its own initplayer, x125; got x ${game.p.x}`);
{
  const g = game.solids().goal!;
  const box = game.playerBox();
  if (!g || !(box.right > g.left && box.left < g.right && box.bottom > g.top && box.top < g.bottom))
    fail(`the player should start inside the goal rect`);
}
if (game.goalReady() || game.craft) fail(`the goal opened with the boss alive`);
if (game.aliveNow() - game.stats.allowance !== 1) fail(`the goal should be counting what is left; ${game.aliveNow()} alive`);
ok(`the player starts at x ${game.p.x}, inside the goal, and it is shut`);

/**
 * 6. it stays out of reach WHILE IT HOVERS.
 *
 * `0x440d64` wants the player 35 below it and only ever loosens one of the two
 * climb limits to get there, so a kick from the floor is aimed under its box
 * for as long as it is holding height — kinds 1 and 2. Kind 5, the maul, steers
 * at the player's OWN point every frame (`0x440ff1`), and a boss that has come
 * down to your level is a boss you can kick. So this measures it in the state
 * the claim is about.
 */
await go();
let hovering = 0;
let hoverHit = 0;
for (let i = 0; i < 600 && hovering < 25; i++) {
  const b = boss();
  const d = b.x - game.p.x;
  if (game.p.act || (b.script !== 1 && b.script !== 2)) h.frame();
  else if (Math.abs(d) >= 90) tap(d > 0 ? "right" : "left");
  else if (Math.abs(d) > 10 && Math.sign(d) !== game.p.facing) tap(d > 0 ? "right" : "left");
  else {
    // under it, facing it, on the floor: the standing kick
    hovering += 1;
    const was = b.hp;
    h.press("kick");
    h.frame();
    if (boss().script === 1 || boss().script === 2) hoverHit += was - boss().hp;
  }
}
if (hovering < 5) fail(`the boss should hover within a kick of the player now and then; only ${hovering} chances in 600 frames`);
if (hoverHit) fail(`a kick from the floor cannot reach it while it hovers; it lost ${hoverHit} over ${hovering} tries`);
ok(`${hovering} kicks from the floor at a hovering kragg take nothing off it`);

// 7. the dive. Band 3 is `0x440e9f`, which does nothing at all until the
//    thing has been HURT — so it has to be marked first, and then stood next to.
const cels = new Set<number>();
// from x1300, where it comes down on the player at once
await go("&x=1300");
// ...and it does not stand still to be marked: `0x473850`'s held dx builds to
// the forty `0x440aff` allows and the halt bleeds only one a frame, so it
// overshoots and comes back — chase it until one blow lands
for (let i = 0; i < 400 && boss().hp >= 1000; i++) {
  const d = boss().x - game.p.x;
  if (game.p.act || !game.p.onGround) h.frame();
  else if (Math.abs(d) < 70) {
    // the kick is read in the air only once the four-frame wind-up is spent
    h.press("jump");
    h.frame(5);
    h.press("kick");
    h.frame(5);
  } else tap(d > 0 ? "right" : "left", 2);
}
if (boss().hp >= 1000) fail(`could not mark it at all`);
// and now stand inside eighty of it and let it work
let water = 0;
for (let i = 0; i < 180 && water === 0; i++) {
  const b = boss();
  if (b.state === "dead") break;
  cels.add(game.celOf(b));
  water = up();
  const d = b.x - game.p.x;
  if (Math.abs(d) > 60) tap(d > 0 ? "right" : "left", 2);
  else h.frame();
}
/**
 * ...and what raises one is a FLARE.
 *
 * `0x441b60` has exactly one caller — `0x4415bd`, inside kragg's **state 9**,
 * the reaction to a blow of strength −9, and −9 is the flare's. It drags the
 * boss toward the nearest `initsprinkler` 120px under its own point and lights
 * one on each of four tags. So standing next to it and waiting raises nothing:
 * the water comes up when you burn it, not when it dives.
 */
if (water !== 0) fail(`only a flare raises a sprinkler — 0x4415bd is 0x441b60's only caller; one came up without one`);
ok(`standing beside it raises no sprinkler — 0x441b60 answers to the flare, not the dive`);

/**
 * ...and a flare DOES raise one, and costs the boss nothing doing it.
 *
 * `0x43ac04` is where the flare's own think writes `obj+0x1a = 0xfff7` against
 * the `0x64` it carries otherwise, and `0x441d30` is the first thing kragg's
 * hit handler asks. That arm plays a sound, installs `0x473a88` — state 9 —
 * and **returns at `0x441d94` before any damage is computed**. So the water is
 * the tactic rather than a flourish: sixteen rounds at a hundred would be more
 * than kragg's whole thousand, and you could simply shoot it.
 */
await go("&x=1740");
// ARCADE's one `statflaregun` stands at x1756, which is why the walk starts here
for (let i = 0; i < 20 && !game.gunAhead(); i++) tap("right", 2);
h.hold("down", true);
h.until(() => game.inv.armed, 20);
h.hold("down", false);
h.frame(6);
if (!game.inv.armed || game.inv.weapon !== 9) fail(`could not pick up ARCADE's flare gun; it holds ${game.inv.weapon} armed ${game.inv.armed}`);
let lit = 0;
const hpWas = boss().hp;
let flareFrames = 0;
for (; flareFrames < 1500 && lit === 0; flareFrames++) {
  lit = up();
  if (lit) break;
  const b = boss();
  if (b.state === "dead") break;
  // the gun holds ONE flare, and a boss still on `0x473850` goes past at up to
  // forty a frame — so it is spent only once it is on him: the maul, the dive
  // or the hover (kinds 5, 8, 1)
  if (game.p.act || (b.script !== 1 && b.script !== 5 && b.script !== 8)) {
    h.frame();
    continue;
  }
  if (Math.abs(b.x - game.p.x) > 260) tap(b.x > game.p.x ? "right" : "left", 2);
  else if (Math.sign(b.x - game.p.x) !== game.p.facing) tap(b.x > game.p.x ? "right" : "left");
  else {
    // P is the trigger when a weapon is in your hands, not K
    h.press("punch");
    h.frame();
  }
}
if (lit === 0) fail(`burning kragg should send a sprinkler up — 0x4415bd; ${up()} up after ${flareFrames} frames, ${game.roundsIn(9)} flares left`);
const hpNow = boss().hp;
// the scald is the boss's own three a frame, which is what it is SUPPOSED to
// cost it; a flare landing its hundred would show up as a far bigger drop
if (hpWas - hpNow >= 100) fail(`0x441d94 returns before the damage, so a flare costs kragg nothing; it went ${hpWas} -> ${hpNow}`);
ok(`...and burning it DOES raise one, for ${hpWas - hpNow} health rather than the flare's hundred`);

/**
 * ...and a burning kragg is not set alight AGAIN.
 *
 * `0x441d26` sends every blow to `0x441ef0` once kragg's state is 9 or more,
 * and `0x441ef4`'s branch for 9..11 takes nothing: the −9 arm at `0x441d30` is
 * reached only from states 1..8. So a second flare landing while `0x473a88` is
 * running leaves it running. This keeps the flares coming through two whole
 * burns and watches the burn's own clock: a burn put on again from its first
 * frame is its clock going backwards while the anim stays the burn.
 */
await go("&x=1740&weapon=9&rounds=16");
if (!game.inv.armed || game.inv.weapon !== 9 || game.roundsIn(9) !== 16)
  fail(`?weapon=9&rounds=16 should arm the flare gun with sixteen: ${game.inv.weapon} ${game.roundsIn(9)}`);
// a level opens on the unarmed idle (`0x448bc7`) and the load only sets
// `0x479438` (`0x45e041`): the gun is carried, not out, until INV — which
// tests/machine/guns.ts presses. Here it is simply out, frame for frame as before
game.inv.drawn = true;
let burns = 0;
let whole = 0;
let restarted = "";
let wasBurning = false;
let lastClock = 0;
// flares that ended their flight in the air while it burned: struck something
let landedOnBurn = 0;
const flying = new Set<object>();
for (let i = 0; i < 1500 && game.roundsIn(9) > 0 && !restarted && whole < 2; i++) {
  const b = boss();
  if (b.state === "dead") break;
  const burning = b.anim === K.burns!.anim;
  if (burning && !wasBurning) burns += 1;
  if (!burning && wasBurning && lastClock >= K.burns!.anim!.cels.length * K.burns!.anim!.hold - 2) whole += 1;
  if (burning && wasBurning && b.clock < lastClock) restarted = `clock ${lastClock} -> ${b.clock} on cel ${game.celOf(b)}`;
  wasBurning = burning;
  lastClock = burning ? b.clock : 0;
  for (const f of game.flares) {
    if (f.burn === null && !f.grounded) flying.add(f);
    else if (flying.has(f)) {
      flying.delete(f);
      if (burning && !f.grounded) landedOnBurn += 1;
    }
  }
  if (game.p.act) h.frame();
  else if (Math.abs(b.x - game.p.x) > 260) tap(b.x > game.p.x ? "right" : "left", 2);
  else if (Math.sign(b.x - game.p.x) !== game.p.facing) tap(b.x > game.p.x ? "right" : "left");
  else {
    h.press("punch");
    h.frame();
  }
}
if (!burns) fail(`a flare should set kragg burning on 0x473a88 — 7060 first; none did in 16 rounds`);
if (restarted) fail(`0x441d26 sends a blow in state 9 to 0x441ef0, which takes nothing — the burn restarted: ${restarted}`);
if (!landedOnBurn) fail(`no flare struck it while it burned, so nothing was asked of 0x441d26 (${burns} burns, ${whole} whole, ${game.roundsIn(9)} rounds left)`);
ok(`and a flare into a burning kragg does nothing — ${landedOnBurn} flare(s) struck it through ${burns} burn(s), ${whole} whole, none restarted (0x441d26)`);

/**
 * ...and the rest of the gate, state by state, against the function itself.
 * `0x441ef4` — 9, 10 and 11 take nothing at all, whatever the blow;
 * `0x441efa` — from 12 up a negative strength is a flat 0x46 and nothing else,
 * so a flare on the ground form is seventy and no fire.
 */
{
  const kr = (over: Partial<Enemy>): Enemy => ({ kind: "initkragg", hp: 1000, anim: K.gait, script: 1, ...over }) as Enemy;
  const flare = { damage: 0, code: -9 };
  const kick = { damage: 55, code: 0 };
  const gated = [
    ["state 5, a flare", kraggGate(kr({ script: 5 }), K, flare), flare],
    ["state 9, a flare", kraggGate(kr({ script: 6, anim: K.burns!.anim }), K, flare), null],
    ["state 9, a kick", kraggGate(kr({ script: 6, anim: K.burns!.anim }), K, kick), null],
    ["state 10, a kick", kraggGate(kr({ script: 10, rallied: true, hp: 0 }), K, kick), null],
    ["state 11, a flare", kraggGate(kr({ script: 11, rallied: true }), K, flare), null],
    ["state 12, a flare", kraggGate(kr({ script: 12, rallied: true }), K, flare), { damage: 0x46, code: 0 }],
    ["state 14, a kick", kraggGate(kr({ script: 14, rallied: true }), K, kick), kick],
  ] as const;
  const wrong = gated.filter(([, got, want]) => JSON.stringify(got) !== JSON.stringify(want));
  if (wrong.length)
    fail(`0x441d26 / 0x441ef4 / 0x441efa: ${wrong.map(([what, got, want]) => `${what} gave ${JSON.stringify(got)}, not ${JSON.stringify(want)}`).join("; ")}`);
  ok(`and 9..11 take nothing, while 12 up take a flare as seventy (0x441ef4, 0x441efa)`);
}

/**
 * 8. ...and felling it is TWO fights, because it stands up once.
 *
 * `0x441e4a` is the frame its health runs out and it does not install the
 * death: it installs `0x473b60`, the fall. `0x441747` catches the landing and
 * `0x441787` writes `0x40e300(0x3e8)` straight back into the health word, so
 * it comes up whole as its grounded second form — everything at or above kind
 * 11, which `0x440b1c` splits the whole think function on. The ground form
 * cannot move sideways at all: its prologue pins `obj+8` to `[0x4a7574]`.
 *
 * The run is deterministic, so this fights it to the end: the bar goes to
 * nothing, falls on `0x473b60`'s own cels, comes back whole, and goes to
 * nothing again.
 */
// ...from a fresh load, with empty hands: what you carry is the chapter's and
// outlives a load in this process (`0x4511f0` runs per CHAPTER), where the
// page came back to a new game — so the flare gun above is put down first
game.inv.armed = false;
game.inv.rounds = {};
await go();
const score0 = game.stats.score;
let rallied = false;
let lowest = 1000;
let fightFrames = 0;
let blows = 0;
for (; fightFrames < 20000; fightFrames++) {
  const b = boss();
  cels.add(game.celOf(b));
  if (b.state === "dead") break;
  if (b.hp > lowest + 100) rallied = true;
  lowest = Math.min(lowest, b.hp);
  const d = b.x - game.p.x;
  // it floats, so the boot has to leave the ground — the standing kick above is
  // the one that measures it staying out of reach. The ground form does not.
  const ad = Math.abs(d);
  const toward = d > 0 ? "right" : "left";
  const away = d > 0 ? "left" : "right";
  if (game.p.act || !game.p.onGround) h.frame();
  else if (b.script === 2 && b.tag === 1 && ad < 160) {
    // the stop (`0x440f4a`) holds until its drift is exactly gone, and a body
    // pressed against it at a wall shoves that drift back in (`0x430680`) —
    // so give it room
    tap(away, 2);
  } else if (ad < 50) {
    // too close: the boot's box hangs 95..125 ahead of the anchor, past it
    tap(away, 2);
  } else if (ad > 110) tap(toward, 2);
  else if (Math.sign(d) !== game.p.facing) tap(toward);
  else {
    // alternate the boot and the fist: `0x4029e0` weakens a move repeated
    // inside four seconds, and a different one lands whole again
    const move = blows++ % 2 ? "punch" : "kick";
    // standing when it has come down to him — the maul (kind 5) and the
    // ground form (11 up) — and off the floor while it holds its height
    const low = b.script === 5 || (b.script ?? 0) >= 11;
    if (low) {
      h.press(move);
      h.frame();
    } else {
      h.press("jump");
      h.frame(5);
      h.press(move);
      h.frame(5);
    }
  }
}
if (lowest >= 1000) fail(`a jumping attack should reach it; it never dropped below ${lowest}`);
if (!rallied) fail(`0x441787 puts a full bar back when it lands; it had ${lowest} left and never stood up`);
// 7033..7036 is `0x473b60` tag 0, the FALL
if (![7033, 7034, 7035, 7036].some((c) => cels.has(c)))
  fail(`with its first bar gone it should fall on 0x473b60's own cels; saw ${[...cels].sort().join(" ")}`);
if (boss().state !== "dead") fail(`two bars of a thousand should be spent inside ${fightFrames} frames; it has ${boss().hp} (rallied ${rallied})`);
ok(`and it fights back under its own machine — down, stood up whole (0x441787), and felled in ${fightFrames} frames`);
// ...and the census only clears when the SECOND bar is gone too
if (game.aliveNow() > game.stats.allowance) fail(`the census should be clear: ${game.aliveNow()} alive`);
ok(`it fights on its own book — ${cels.size} of its own cels, and the quota is clear`);

// 9. ...and it pays nothing at all, which no other boss in the game does
h.frame(22);
const points = game.stats.score - score0;
if (points !== 0) fail(`there is no 0x40d450 in its code; the score rose ${points}`);
ok(`and pays ${points} points, because nothing in its code awards any`);

// 10. only then does the craft come, and the goal is where you began
if (h.until(() => game.craft !== null, 60) < 0) fail(`the craft should arrive once the room is empty`);
ok(`and the craft comes down for it`);

/**
 * 11. what a blow DOES to it, through the page's own hit path.
 *
 * - the −9 arm `0x441d30` lights no flame (no `0x44ff20` anywhere in the
 *   class): it plays the hit sound (`0x441d41`), sparks (`0x441d60`) and plays
 *   0x13 (`0x441d72`);
 * - the flying form sparks and does not bleed (`0x441db8`, no `0x40cba0`);
 * - the ground takes are kind 11, which `0x441ef4` takes nothing in;
 * - `0x441f56` is `jge`: a blow that leaves nothing is a take;
 * - the death that sticks spills fifteen roaches with 0x1b as tag 0 ends
 *   (`0x441a42`), and a corpse struck on cel 7114 dies again from the top
 *   (`0x441f58`).
 */
{
  await go();
  let b = boss();
  // read fresh: the checks below each follow a blow the compiler cannot see
  const state = (): string => b.state;
  const script = (): number | undefined => b.script;
  const hit = (damage: number, code = 0): void => {
    const a = game.foeAnchor(b, game.level!)!;
    const box = { left: a.x - 20, right: a.x + 20, top: a.y - 20, bottom: a.y + 20 };
    game.strikeFoe(b, damage, { dx: 20, dy: 0 }, 1, a.y, box, code, { x: a.x, y: a.y }, { mass: 5, vx: 0, vy: 0 });
  };
  const calls = recordSound(game);
  const effects = (): number[] => calls.filter((c) => c.call === "effect").map((c) => c.args[0] as number);
  const flames0 = game.flames.length;
  const sparks0 = game.sparks.length;
  hit(0, -9);
  const heard = effects();
  if (game.flames.length !== flames0) fail(`0x441d30 calls no 0x44ff20: a flame was lit on kragg`);
  if (game.sparks.length !== sparks0 + 1) fail(`0x441d60 throws one spark: ${game.sparks.length - sparks0}`);
  if (heard.length !== 2 || ![24, 25].includes(heard[0]) || heard[1] !== 0x13)
    fail(`0x441d41 then 0x441d72: its hit sound and 0x13; heard ${heard.join(",")}`);
  if (b.anim !== K.burns!.anim || b.script !== 9) fail(`and 0x473a88 goes on, kind 9: script ${b.script}`);
  ok(`a flare on kragg lights nothing, sparks once and plays ${heard.join(" then ")} (0x441d30)`);

  await go();
  b = boss();
  const gobs0 = game.gobs.length;
  const sparks1 = game.sparks.length;
  hit(40);
  if (game.gobs.length !== gobs0 || game.sparks.length !== sparks1 + 1)
    fail(`the flying form sparks and does not bleed (0x441db8): gobs +${game.gobs.length - gobs0}, sparks +${game.sparks.length - sparks1}`);
  if (script() !== 7) fail(`a take on the wing is kind 7 (0x473a28/0x473a48): ${b.script}`);
  ok(`a blow on the wing throws a spark and no goo, and the take reads kind 7`);

  // the ground form, as the landing leaves it
  const ground = (): void => {
    b.rallied = true;
    b.state = "gait";
    b.anim = K.rallies!.rise;
    b.script = 12;
    b.tag = 0;
    b.clock = 0;
  };
  ground();
  b.hp = 1000;
  let took = false;
  for (let i = 0; i < 8 && !took; i++) {
    hit(30);
    took = script() === 11;
    if (!took) ground();
  }
  if (!took) fail(`a ground blow should put on one of 0x473ba8's takes, kind 11`);
  const during = b.hp;
  hit(30);
  if (b.hp !== during) fail(`0x441ef4: a blow during a ground take (kind 11) takes nothing; ${during} -> ${b.hp}`);
  ok(`the ground takes are kind 11, and a blow during one lands as nothing (0x441ef4)`);

  ground();
  b.hp = 30;
  hit(30);
  if (state() === "dead" || b.hp !== 0) fail(`0x441f56 is jge: a blow that leaves nothing is a take; ${b.state} at ${b.hp}`);
  ground();
  calls.length = 0;
  hit(30);
  if (state() !== "dead" || script() !== 16) fail(`below nothing it dies on 0x473d38, kind 16: ${b.state} ${b.script}`);
  ok(`health at exactly nothing is a take, and below it the death (0x441f56)`);

  const roaches0 = game.roaches.length;
  calls.length = 0;
  h.frame(8 * K.death!.hold + 2);
  if (game.roaches.length - roaches0 !== 15 || !effects().includes(0x1b))
    fail(`0x441a42 spills fifteen roaches with 0x1b as tag 0 ends: ${game.roaches.length - roaches0}, heard ${effects().join(",")}`);
  ok(`the death that sticks lets fifteen roaches out with 0x1b (0x441a42, 0x4423a0)`);

  b.clock = 4 * K.death!.hold;
  if (game.celOf(b) !== 7114) fail(`cel 7114 is the death's fifth: ${game.celOf(b)}`);
  calls.length = 0;
  hit(30);
  if (state() !== "dead" || b.clock !== 0 || b.threw || !effects().includes(FOES.initkragg.deathSound!))
    fail(`a corpse struck on 7114 dies again from the top with 0x1a (0x441f58): clock ${b.clock}, heard ${effects().join(",")}`);
  ok(`and struck on 7114 it dies again from the top, 0x1a and all (0x441f58)`);

  // `0x441fdb` / `0x441fed`: the fourth ground blow weighs the PLAYER's x
  // against its own mirror flag — in front, it swings; behind, it turns
  const fourth = (facing: number, playerX: number): number => {
    const e = { max: 1000, rallied: true, facing };
    for (let i = 0; i < 8; i++) {
      const r = K.pick!({ damage: 30, hits: 1, dy: 0, facingAway: false, playerX, pointX: 100 }, e);
      if (r >= 8) return r;
    }
    return -1;
  };
  const picks = [fourth(-1, 0), fourth(1, 0), fourth(1, 200), fourth(-1, 200)];
  if (picks.join() !== "10,8,10,9")
    fail(`the fourth ground blow: swing in front, turn on tag mirror + 2 behind; got ${picks.join()}`);
  ok(`the fourth ground blow swings at a player in front and turns from one behind (0x441fed)`);
  game.setSound(null);
}

// the ground form's two blow-takes that are states of its own machine — the
// snap round (`0x473bd8` tag 2/3, state 13) and the swing back (`0x473cc8` tag
// 1, state 15). Each state stands it up the frame its script ends (`0x4418b6`
// after `0x441855`'s `obj+0x46` test), so the stand goes on after exactly the
// script's own frames, with nothing between
{
  await go();
  const b = boss();
  const take = (anim: FoeAnim): number => {
    b.rallied = true;
    b.state = "flinch";
    b.anim = anim;
    b.clock = 0;
    b.script = anim.kind;
    b.tag = anim.tag;
    let f = 0;
    while (b.state === "flinch" && b.anim === anim && f < 40) {
      h.frame();
      f += 1;
    }
    return f;
  };
  const turn = K.flinch!.find((a) => a.kind === 13)!;
  const faced = b.facing;
  const tf = take(turn);
  if (tf !== turn.cels.length * turn.hold || b.anim !== KRAGG.stand || b.facing !== -faced)
    fail(`the snap round is ${turn.cels.length * turn.hold} frames and then the stand, turned; ${tf} frames, then ${b.anim.from}`);
  const swing = K.flinch!.find((a) => a.kind === 15)!;
  const sf = take(swing);
  if (sf !== swing.cels.length * swing.hold || b.anim !== KRAGG.stand)
    fail(`the swing back is 0x473cc8 tag 1's ${swing.cels.length} frames and then the stand; ${sf} frames, then ${b.anim.from}`);
  ok(`its snap round stands it up after ${tf} frames and its swing back after ${sf}, the frame each script ends`);
}

pass("ARCADE is one room, one boss out of reach, and a goal that waits for it");
