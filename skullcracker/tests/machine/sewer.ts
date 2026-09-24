/**
 * SEWER — level seven, and the first one that is a map rather than a route.
 *
 *   npx tsx tools/runmachine.mts sewer      (from skullcracker/)
 *
 * Six levels of this game are corridors with things standing in them. The
 * seventh is **thirteen regions** — two vertical shafts, a tube room over the
 * top, a sewer under the floor, a hall of lifts — joined by five `door` records
 * that start shut and solid, each opened by a `switch` somewhere else entirely.
 *
 * What the file says, and what this checks:
 *
 *   - **a shut door is a wall.** `0x435ff0`, from the door's own creator, puts
 *     its rect into the engine's obstacle table, and `0x440060` takes it out
 *     again at the end of the opening animation.
 *   - **the broadcast is the level's, not the room's.** `0x43c430` walks one
 *     linked list for the whole stage, so lever 4 — on a ledge in one region —
 *     opens the door standing in the next.
 *   - **`0x40b940(2, point)` knows nothing about floors.** Past the end of its
 *     region's floor the point goes to the first region whose rect holds it —
 *     its own, often, whose rect runs on past the floor — and level seven's
 *     regions meet where one floor has ended and the next has not begun.
 *   - **the lift never stops.** `0x43d810` is a five-tag cycle between its
 *     record's own top and bottom, rising at the speed its `param` allows and
 *     sinking at a flat six, and the `platform` it owns is what carries you.
 *   - **two new classes**: the floating eye, which has no gravity at all, and the
 *     600-health thing that goes round shutting the doors again.
 */
import { FOES } from "../../src/foes";
import { EYEBALL, eyeball, eyeballReacts } from "../../src/brains/eyeball";
import { OX, OX_PIT, ox as oxBrain, oxReacts } from "../../src/brains/ox";
import { TICK_SCALE, install, type BrainCtx, type CastKit, type Enemy } from "../../src/brains/kit";
import { FPS, fail, headless, ok, pass } from "./harness";
import type { FoeAnim } from "../../src/foes";

/**
 * The machines themselves, on their own: a brain handed a stand-in context and
 * called once an engine frame, as `stepFight` calls it.
 */
const machines = (): void => {
  const casts: CastKit[] = [];
  const said: number[] = [];
  const k = {
    player: { x: 0, y: 0, top: 0, anchor: 0, vy: 0, swinging: false, down: false, facing: 1, climbing: false },
    ladderNear: () => ({ x: 100, y: 300, top: 0, bottom: 400 }),
    anchorY: (e: Enemy) => e.y,
    anchorX: (e: Enemy) => e.x,
    shake: () => {},
    flash: () => {},
    burn: () => {},
    spray: () => {},
    track: () => ({ forward: 200, dy: 0, band: 1, side: 1 }),
    roll: () => 1,
    say: (_e: Enemy, id: number) => said.push(id),
    cast: (_e: Enemy, kit: CastKit) => casts.push(kit),
    gravity: 1,
  } as unknown as BrainCtx;
  const foe = (kind: string, anim: Enemy["anim"], state: Enemy["state"] = "gait"): Enemy => ({
    kind,
    x: 0,
    y: 0,
    facing: 1,
    left: -500,
    right: 500,
    top: -500,
    bottom: 500,
    clock: 0,
    state,
    anim,
    linger: 0,
    dents: 0,
    vx: 0,
    vy: 0,
    hp: 50,
    max: 50,
  });

  // `0x43e6cc`: AI+0x30 is seeded 2 and spent one a frame, so a 21-frame spit
  // sends out a glob on frames 4, 8, 12, 16 and 20 — five
  const eb = FOES.initeyeball;
  const e = foe("initeyeball", EYEBALL.spit);
  e.script = 7;
  e.nerve = 2;
  e.swing = true;
  const run = EYEBALL.spit.cels.length * EYEBALL.spit.hold;
  for (let f = 1; f <= run; f++) {
    e.clock = f;
    eyeball(e, eb, run, k);
  }
  if (casts.length !== 5)
    fail(`a spit is twenty-one frames and a glob every fourth: five, not ${casts.length}`);
  // `0x43e9af`/`0x43e9bc`: the flinch is the cel caught, and the knock-out over 0x46
  const pick = eb.pick!;
  const on = (cel: number) => ({ max: 50, anim: { cels: [cel], hold: 1, from: "" }, clock: 0 });
  const blow = (damage: number) => ({ damage, hits: 1, dy: 0, facingAway: false });
  if (pick(blow(20), on(6207)) !== 1) fail(`cel 6207 answers 0x472878 tag 2`);
  if (pick(blow(20), on(6000)) !== -1) fail(`a cel outside 6206..6208 installs nothing (0x43e9d4)`);
  if (pick(blow(0x47), on(6206)) !== 3) fail(`a blow over 0x46 is the knock-out, 0x4727f0 tag 0`);
  ok(`an eye's spit sends five globs, and the cel it is caught on picks its flinch`);

  // `0x43de45` runs ahead of the jump table in states 3 and 8 too: a struck
  // eye is still dragged at seven towards his height, and a dying one as well
  {
    const struck = foe("initeyeball", eb.flinch![0], "flinch");
    k.player.anchor = 400;
    struck.clock = 1;
    eyeballReacts(struck, eb, 12, k);
    const dying = foe("initeyeball", eb.death!, "dead");
    k.player.anchor = -400;
    dying.clock = 1;
    eyeballReacts(dying, eb, 22, k);
    k.player.anchor = 0;
    if (struck.vy <= 0 || dying.vy >= 0)
      fail(`the hover goes on under a flinch and a death: vy ${struck.vy} with him below, ${dying.vy} with him above`);
  }
  ok(`a flinching or dying eye is still drawn to his height`);

  // `0x43e503`: an eye that has lost him finds the nearest ladder (0x40b660),
  // drifts at it until it is inside fifty, climbs towards a hundred above him
  // inside the ladder's span, and comes off it back to the hover within a
  // hundred of his height — it does not hunt for good
  {
    const me = foe("initeyeball", EYEBALL.hunt);
    me.script = 6;
    me.side = 1;
    const think = () => eyeball(me, eb, 1, k);
    const phase = (): number | undefined => me.side;
    think();
    if (phase() !== 2 || me.ladder?.x !== 100) fail(`phase 1 keeps the nearest ladder and goes to phase 2; phase ${me.side}`);
    think();
    if (phase() !== 2 || me.facing !== 1) fail(`phase 2 faces the ladder and drifts on while it is fifty or more away`);
    me.x = 80;
    think();
    if (phase() !== 3 || me.anim !== EYEBALL.climbUp || me.vx !== 0)
      fail(`inside fifty it stops and climbs tag 1, the point being below it (0x43e5ae); phase ${me.side}, ${me.anim.from}`);
    k.player.anchor = 250;
    me.clock = 5;
    think();
    if (me.anim !== EYEBALL.climbDown || me.clock !== 5)
      fail(`a hundred above him is below it, so tag 2, keeping its frame (0x43e665); ${me.anim.from} at ${me.clock}`);
    me.y = 200;
    think();
    if (phase() !== 0 || me.anim !== EYEBALL.hover || me.vy >= 0)
      fail(`within a hundred of him, off the ladder, it goes back to the hover rising (0x43e635); phase ${me.side}, ${me.anim.from}`);
    k.player.anchor = 0;
  }
  ok(`an eye that loses him finds the nearest ladder, climbs it to him and comes back to the hover`);

  // `0x43fa7e`: a blow is answered with an attack or taken as the slide, and
  // the body lies for ten times the global the ox itself set to 80
  const ox = FOES.initox;
  if (ox.flinch?.length !== 4 || !ox.flinch[3].from.includes("0x4731e0"))
    fail(`the ox's answers are three attacks and 0x4731e0's slide`);
  if (ox.linger !== 800) fail(`0x43fa6f: 10 * [0x46b204] = 800, not ${ox.linger}`);
  said.length = 0;
  const hit = foe("initox", ox.flinch[1], "flinch");
  hit.clock = 1;
  oxReacts(hit, ox, 6, k);
  if (said[0] !== 0x30) fail(`attack tag 1 goes out voiced 0x2f + 1; said ${said.join(",")}`);
  ok(`an ox answers a blow with a voiced attack or slides back, and lies 800 frames`);
  // `0x43f9aa` is the handler's only test — no class, no state — and 5190,
  // the death's first cel, is drawn with a body
  if (!ox.corpseTakesHits || !ox.hitsOwn) fail(`0x43f9a0 turns nothing away but a negative strength`);

  // `0x43f325`: past a hundred pixels of drop, in any state but 0 and 7, the
  // pit — 0x35 at the PLAYER's point, AI+0xe = 2 * 80 (`0x435c73`), and
  // `0x472f00` tag 0; the landing puts on tag 1, and its end says 0x3d, jolts
  // the screen, pays 0x140 and takes the ox out (`0x43f7c9`..`0x43f85a`)
  {
    const shook: number[] = [];
    const gone: number[] = [];
    const pk = { ...k, atBound: () => false, shake: (n: number) => shook.push(n), remove: (_e: Enemy, award: number) => gone.push(award) } as BrainCtx;
    let heardAt: number[] = [];
    pk.say = (who: Enemy, id: number) => {
      said.push(id);
      heardAt.push(who.x);
    };
    pk.player.x = 333;
    said.length = 0;
    const pit = foe("initox", OX.stand);
    pit.script = 2;
    pit.x = 0;
    pit.vy = 30 * TICK_SCALE;
    let calls = 0;
    while (pit.script !== 7 && calls < 10) {
      oxBrain(pit, ox, 1, pk);
      calls += 1;
    }
    if (calls !== 4 || pit.tag !== 0 || Number(said[0]) !== 0x35 || heardAt[0] !== 333 || pit.beat !== 160)
      fail(`thirty a frame passes a hundred on the fourth frame and goes over with 0x35 at the player: ${calls} frames, tag ${pit.tag}, said ${said.join(",")} at x${heardAt[0]}, AI+0xe ${pit.beat}`);
    oxBrain(pit, ox, 1, pk);
    if (pit.tag !== 0) fail(`tag 0 holds while it is still falling`);
    pit.vy = 0;
    oxBrain(pit, ox, 1, pk);
    if (pit.script !== 7 || Number(pit.tag) !== 1) fail(`the landing puts on 0x472f00 tag 1`);
    pit.clock = 3;
    said.length = 0;
    heardAt = [];
    oxBrain(pit, ox, 3, pk);
    if (Number(said[0]) !== 0x3d || heardAt[0] !== 333 || shook[0] !== 3 || gone[0] !== 0x140)
      fail(`the landing's end says 0x3d at the player, shakes 3 and pays 320 as it goes: ${said.join(",")}, shake ${shook.join(",")}, paid ${gone.join(",")}`);
    // ...and not from the patrol, whose state `0x43f336` exempts
    // (with the player out of its widened rect, or the patrol stands at once)
    pk.player.x = 2000;
    const walker = foe("initox", OX.patrolA);
    walker.script = 0;
    walker.vy = 60 * TICK_SCALE;
    for (let i = 0; i < 4; i++) oxBrain(walker, ox, 6, pk);
    if (walker.script === 7) fail(`a patrolling ox does not go into the pit (0x43f339)`);
    // ...and the preamble runs under the flinch and the death as well: the
    // frame the drop passes the mark the reaction hands the page the pit
    pk.player.x = 333;
    said.length = 0;
    const slid = foe("initox", ox.flinch![3], "flinch");
    slid.vy = 60 * TICK_SCALE;
    slid.clock = 2;
    if (oxReacts(slid, ox, 40, pk) !== undefined) fail(`sixty is not yet a hundred`);
    const fromSlide = oxReacts(slid, ox, 40, pk);
    if (fromSlide?.kind !== 7 || fromSlide.tag !== 0 || Number(said[0]) !== 0x35 || slid.beat !== 160)
      fail(`a hundred and twenty under the slide is the pit: ${fromSlide?.from}, said ${said.join(",")}`);
    const dying = foe("initox", ox.death!, "dead");
    dying.vy = 120 * TICK_SCALE;
    dying.clock = 1;
    if (oxReacts(dying, ox, 16, pk)?.kind !== 7) fail(`0x43f325 does not exempt the death: a dying ox that falls a hundred goes in the pit`);
    pk.player.x = 0;
  }
  ok(`an ox that drops more than a hundred goes into the pit, lands, and is gone for 320`);
};

machines();

const h = await headless("level=7");
const { game } = h;
/**
 * Which leg of the play-through is running. The one thing that can end any of
 * them is the player DYING, and without a label all of those failures read the
 * same.
 */
let leg = "the start";
const room = (): string => game.p.room?.name ?? "?";
const door = (n: number): string => game.level!.doors.flat().find((d) => d.param === n)?.state ?? "-";
const go = async (q = ""): Promise<void> => {
  await h.load(`level=7${q ? `&${q}` : ""}`);
  h.until(() => game.p.onGround, 60);
  h.frame(4);
};
type Key = "left" | "right" | "up" | "down";
/**
 * Hold some keys for so many frames, jumping whenever the walk has stalled —
 * or, with `hop`, every fifth frame: the stretch past a bush needs it, because
 * the thing does not stop you, it knocks you off the walkway, and by then there
 * is nothing to be stuck on. Stops early once `until` holds.
 */
const move = (keys: Key[], frames: number, o: { jump?: boolean; hop?: boolean; until?: () => boolean } = {}): boolean => {
  for (const k of keys) h.hold(k, true);
  const lives = game.stats.lives;
  let last = game.p.x;
  let stuck = 0;
  let done = false;
  for (let f = 0; f < frames; f++) {
    if (o.hop && f % 5 === 0) h.press("jump");
    h.frame();
    if (game.stats.lives !== lives) fail(`the player died during "${leg}", at x ${game.p.x}, y ${game.p.y} in ${room()}`);
    if (o.until?.()) {
      done = true;
      break;
    }
    if (o.jump && Math.abs(game.p.x - last) < 2) {
      if (++stuck >= 4) {
        h.press("jump");
        stuck = 0;
      }
    } else stuck = 0;
    last = game.p.x;
  }
  for (const k of keys) h.hold(k, false);
  return done;
};

// 1. it opens where its own initplayer stands, in the entrance of thirteen
await go();
if (game.p.x !== 1548) fail(`SEWER should open at its own initplayer, x1548; got x ${game.p.x}`);
if (room() !== "entrance") fail(`it should open in the entrance; it is in ${room()}`);
if (game.level!.rooms.length !== 12) fail(`SEWER has twelve drawn regions; it has ${game.level!.rooms.length}`);
ok(`SEWER opens at x ${game.p.x}, y ${game.p.y}, in its entrance`);

// 2. eleven in the census — nine eyes and two of the big ones, and nothing
//    else in the level counts
const kill = Math.round(game.mission().kill * 100);
if (kill !== 75 || game.stats.census !== 11) fail(`nine eyes and two big ones call 0x42f870; the census is kill ${kill}% of ${game.stats.census}`);
const quota = Math.max(0, game.aliveNow() - game.stats.allowance);
if (quota !== 8 || game.stats.census - game.stats.allowance !== 8) fail(`75% of 11 is 8: quota ${quota} of ${game.stats.census - game.stats.allowance}`);
ok(`its ${game.stats.census} enemies are the census, and the quota is 8`);

// 3. the floating eye: fifty health, and it does not fall. `0x42f850(obj, 0)`
//    is the whole of that — nothing else in the game is given no gravity.
const eye = game
  .spawnedHere()
  .filter((e) => FOES[e.kind].panel)
  .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];
if (eye?.kind !== "initeyeball") fail(`an eye should be the nearest plated thing in the entrance; it is ${eye?.kind}`);
if (eye.max !== 50 || eye.hp !== 50) fail(`0x435a88 gives it 0x32 health; it has ${eye.hp}/${eye.max}`);
const was = { x: eye.x, y: eye.y };
h.frame(4 * FPS);
if (eye.y !== was.y) fail(`it has no gravity and should hold its height; y ${was.y} -> ${eye.y}`);
/**
 * ...and it holds STATION. `0x43dde0` state 0 is `0x472788`, twelve cels of
 * hovering with no stride on any of them, and the only way out of it is
 * `0x434200(player.point, AI+6)` with the player upright. The drift that does
 * travel is kind 1, `0x472aa0`, one cel at `dx 20`, and nothing installs it
 * until you are inside the record's own rect. An eye you have not walked up to
 * hangs where the level hung it.
 */
if (eye.x !== was.x) fail(`an unnoticed eye should hang where it was put; x ${was.x} -> ${eye.x}`);
ok(`an eye holds x ${eye.x}, y ${eye.y} with 50 health, where the level hung it`);

// 3b. a blow while it spits is the knock-out (`0x43e9b5`), and the knock-out is
//     kind 3 — so a second blow finds state 3 on the 6300s, none of the three
//     cels `0x43e9bc` answers, and `0x43e9d4` takes it without a new flinch
{
  const box = { top: 0, left: 0, bottom: 1, right: 1 };
  eye.script = 7;
  game.strikeFoe(eye, 10, { dx: 0, dy: 0 }, 1, eye.y, box);
  const out = FOES.initeyeball.flinch![3];
  if (eye.state !== "flinch" || eye.anim !== out || eye.script !== 3)
    fail(`a blow on a spitting eye is 0x4727f0 tag 0, kind 3: ${eye.state} ${eye.anim.from} kind ${eye.script}`);
  h.frame(3);
  const at = eye.clock;
  game.strikeFoe(eye, 10, { dx: 0, dy: 0 }, 1, eye.y, box);
  if (eye.anim !== out || eye.clock !== at || (eye.hp as number) !== 30)
    fail(`a second blow takes ten and leaves the knock-out running: ${eye.anim.from} at ${eye.clock} (was ${at}), hp ${eye.hp}`);
}
ok(`a knocked-out eye takes a second blow without starting the knock-out again`);

// 4. five doors, all shut, and five levers, all off
const gates = game.level!.doors.flat();
if (gates.length !== 5) fail(`SEWER places five doors; there are ${gates.length}`);
if (!gates.every((g) => g.state === "shut")) fail(`a door is created on tag 1, which is shut: ${gates.map((g) => `${g.param} ${g.state}`).join(", ")}`);
ok(`all five of its doors start shut — ${gates.map((g) => `door ${g.param}`).join(", ")}`);

// 5. ...and a shut one is a wall. The door's rect goes into the same obstacle
//    table the level's walls are read from, so the walk stops at its edge.
move(["right", "up"], 90, { jump: true });
if (game.p.x > 2560) fail(`a shut door should stop the walk at its own x2549; walked on to x ${game.p.x}`);
if (door(1) !== "shut") fail(`and running past a lever must not throw it — a direction held asks nothing`);
// ...and where it stops is NOT the door most runs: the entrance's bush is at
// x1983 and a walk into it ends on the floor below, so this asserts the door is
// never passed rather than pretending to know which pixel stopped the run
ok(`and nothing gets past a shut door: the run ended at x ${game.p.x}, short of its x2549`);

// 6. standing at the lever with no direction held is what asks — `0x42987c`
await go("x=2270&y=16112");
if (h.until(() => door(1) === "open", 48) < 0) fail(`standing at lever 1 should open door 1; it is ${door(1)}`);
ok(`standing at its lever opens it`);

// 7. the lift cycles on its own and carries whoever is on it. x9276's rect runs
//    y16786..17283 and its param is 2, so it rises at the fastest of the three
//    allowances and sinks at six.
await go("x=9300&y=17327");
const lift = game.elevsHere().find((e) => e.x === 9276);
if (!lift) fail(`the hall's lift at x9276 should stand here`);
const floor = game.p.y;
const heights: number[] = [];
for (let i = 0; i < 90; i++) {
  h.frame();
  heights.push(Math.round(lift.y));
}
const lo = Math.min(...heights);
const hi = Math.max(...heights);
if (lo !== 16786 || hi !== 17283) fail(`it should run its whole shaft, y16786..17283; it covered ${lo}..${hi}`);
ok(`a lift cycles its own shaft, y ${lo} to ${hi}`);

// 8. ...and takes a rider with it — the player stood on the hall floor at its foot
if (floor < 17320) fail(`the probe should start on the hall floor, y17327; it stood at ${floor}`);
h.hold("up", true);
const aboard = h.until(() => {
  if (lift.y > 17150 && game.p.y >= 17320) h.press("jump");
  return game.p.y < 17200;
}, 180);
if (aboard < 0) fail(`never got onto a lift`);
let top = game.p.y;
h.until(() => {
  top = Math.min(top, game.p.y);
  return top < 16800;
}, 150);
h.hold("up", false);
if (top > 16800) fail(`the lift should carry the rider to the head of its shaft, y16786; got y ${top}`);
ok(`and carries a rider from the hall floor, y ${floor}, up to y ${top}`);

/**
 * ...and the BUSH, which is SEWER's and nothing else's.
 *
 * `0x435bf7` hangs it eighty pixels below its record's point, and the last
 * seven cels of its rise carry a strike box and no blow pair at all — the grip
 * signature. So it closes on a player walking underneath it and holds.
 *
 * What ENDS that hold is `0x43ef31`, one test with two arms:
 *
 * ```
 *   43ef31  cmp [obj+0x46], 0        ; has its thirteen-cel script ended?
 *   43ef65  (no)  y -= 0x28          ; forty a frame up, to the top of its travel
 *   43ef4a  (yes) y += 0xa           ; and ten a frame back down again
 *   43f007  at the bottom: install 0x472b70, whose cels carry NO strike box
 * ```
 *
 * Nothing in either arm asks whether it still has hold of anybody. It goes back
 * down with you, and the grip ends because the idle script has no grip — which
 * is the same rule the hand in GRAVE and the claw in BARREL end on.
 *
 * Stood still beside it rather than walked past it. The rise is thirteen cels
 * at one engine frame each and the grip is only on the last seven, and
 * `0x43f017` holds the bush inside its record's x extent (x7652..7738 here), so
 * a player walking by at twelve pixels a frame is past the reach before it
 * closes. Standing at x7700 is inside the seventy that starts it (`0x43ecf3`)
 * and under the box that grips.
 */
await go("x=7700");
const codes: number[] = [];
let heldEver = false;
let topWhileUp = Infinity;
const reactions = Object.values(game.BLOW_CODES);
const bushes = game.hereOf((l) => l.bushes).filter((b) => Math.abs(b.x - 7689) < 300);
if (!bushes.length) fail(`hugeroom's bush at x7689 should hang here`);
const settled = h.until(() => {
  const r = reactions.find((q) => q.act === game.p.act);
  if (r && codes.at(-1) !== r.code) codes.push(r.code);
  if (game.p.heldBy) heldEver = true;
  for (const b of bushes) if (b.state === "rise") topWhileUp = Math.min(topWhileUp, b.y);
  return codes.includes(-3) && codes.includes(-5);
}, 200);
if (!codes.includes(-3)) fail(`walking under hugeroom's bush should be grabbed — 0x43ee9d's -3; it sent ${codes.join(" ") || "nothing"}`);
if (!heldEver) fail(`-3 is a hold, and 0x4720e8's kind 10 is what it puts the player in; the player was never held`);
if (settled < 0 || !codes.includes(-5))
  fail(`0x43eec9 latches the frame after the grab takes and 0x43eedb turns it into -5; it only ever sent ${codes.join(" ")}`);
if (codes.indexOf(-3) > codes.indexOf(-5)) fail(`the grab comes first: it sent ${codes.join(" ")}`);
// -5 is 0x42e8b3's slump — half gravity and no grip — so the hold it started
// with is over almost as soon as it began
h.frame(9);
if (game.p.heldBy) fail(`-5 holds nothing; the player should be down and free, not still held`);
// 0x43ef6f lifts it forty a frame while its thirteen cels play, from its
// resting y17321 to the top of its travel eighty above
if (topWhileUp > 17321 - 40) fail(`it comes UP to grab — 0x43ef65's arm; the highest it got was y${topWhileUp}`);
ok(`its bush comes up to y${topWhileUp}, grabs with ${codes.join(" then ")}, and the slump drops you again`);

// ...and a player it closes on DEAD is swallowed: with the latch at 2,
// `0x43ef0a` takes the draw gate every frame he is dying and plays 0x2a, and
// the bottom of its travel hands it back (`0x43ef57`). Here the latch closes
// on the sink's last step (5030 is late in the rise), so the gate is taken and
// handed back in the same frame, as `0x43ec80` would; the bush is put back at
// the top of its travel as it closes so that the sink has frames to see.
{
  await go("x=7700&damage=1");
  const bush = game.hereOf((l) => l.bushes).filter((b) => Math.abs(b.x - 7689) < 300)[0];
  if (h.until(() => bush.phase === 1, 200) < 0) fail(`the bush never had hold of him (phase ${bush.phase})`);
  game.takeHealth(game.stats.health);
  if (h.until(() => bush.phase === 2, 40) < 0) fail(`the bush's latch never closed`);
  bush.y = bush.top;
  let hidden = 0;
  h.until(() => {
    if (game.p.hidden) hidden++;
    return bush.state === "idle";
  }, 80);
  if (hidden < 5 || game.p.hidden || game.p.act !== "dying")
    fail(`a closed bush hides a dead player all the way down and shows him at the bottom: hidden ${hidden} frames, then ${game.p.hidden}, ${game.p.act}`);
  ok(`a bush closed on a dead player swallows him for ${hidden} frames, and gives him back at the bottom`);
}

// 9. the level, played through: five regions, three levers and a ride. Every
//    one of those levers is in a different region from its door bar the first,
//    which is what `0x43c430` walking the LEVEL's list is for.
await go();
/**
 * Walk up to a lever and STAND inside its rect, the way a player does, trying
 * again if it turns out to be standing just outside. A lever nobody is standing
 * in is a lever nobody throws.
 */
const standAtLever = (n: number, lo: number, hi: number): void => {
  for (let i = 0; i < 8 && door(n) !== "open"; i++) {
    if (game.p.x < lo) move(["right"], 14, { jump: true });
    else if (game.p.x > hi) move(["left"], 8);
    move([], 38, { until: () => door(n) === "open" });
  }
};
/**
 * East to lever 1 — RUNNING AND JUMPING, which is what the entrance is for.
 *
 * Walking it puts the player into the bush at x1983, and the bush slumps them
 * off the lower walkway into the pit at y16445, which has no way out. Jumping
 * takes the upper platform at y16111 instead — `platform` (16111, 1514, 16156,
 * 1886) — which runs over the bush's head and on to the lever.
 */
leg = "east to lever 1";
move(["right", "up"], 210, { hop: true, until: () => game.p.x >= 2200 && game.p.x < 2400 && game.p.y >= 16100 && game.p.y < 16200 });
standAtLever(1, 2230, 2330);
if (door(1) !== "open") fail(`lever 1 did not open door 1 — it is ${door(1)} and the player is at x${game.p.x}`);
// east over the walkway that bridges the seam, and stop ON the ladder,
// x2845..2996, because that is the only way down out of this walkway: east of
// it is door 2, which is shut and whose lever is up in the tube room
leg = "east to the first shaft's ladder";
if (!move(["right"], 450, { jump: true, until: () => game.p.x >= 2900 && game.p.x < 3000 }))
  fail(`through door 1 is the first shaft's ladder; the player is at x${game.p.x} in ${room()}`);
if (room() !== "shaftone") fail(`through door 1 is the first shaft; the player is in ${room()}`);
leg = "down the first shaft";
move(["down"], 135);
move([], 30);
leg = "east to lever 7";
move(["right"], 135, { jump: true, until: () => game.p.x >= 3150 && game.p.x < 3200 && game.p.y >= 16600 && game.p.y < 16700 });
standAtLever(7, 3150, 3260);
if (door(7) !== "open") fail(`lever 7 did not open door 7 — ${room()} x ${game.p.x}, y ${game.p.y}`);
// ...and east of lever 7 the walkway has two bushes of its own on it, at x3354
// and x4734. They do not stop the player — they slump them off the walkway onto
// the floor below, where door 8's lower lip is a wall and nothing can climb
// back. So this stretch is RUN AND JUMPED rather than walked.
leg = "the walkway east to door 7";
if (!move(["right", "up"], 300, { jump: true, hop: true, until: () => room() === "shafttwo" }))
  fail(`through door 7 is the second shaft; the player is at x${game.p.x}, y ${game.p.y} in ${room()}`);
leg = "up the second shaft";
move(["up"], 135);
leg = "east through roomtwo";
move(["right"], 90, { jump: true });
// ...and again, as far as the LADDER rather than as far as the room: the big
// shaft starts at x6609 and its ladder is at x6830..6983, and a down pressed
// anywhere else on that floor climbs nothing
if (!move(["right", "up"], 300, { jump: true, until: () => game.p.x >= 6900 && game.p.x < 7000 }))
  fail(`east of the second shaft is the big one's ladder; the player is at x${game.p.x} in ${room()}`);
if (room() !== "bigshaft") fail(`east of the second shaft is the big one; the player is in ${room()}`);
leg = "down the big shaft";
move(["down"], 180, { until: () => game.p.y >= 17000 && game.p.y < 17060 });
leg = "west to lever 4";
move(["left"], 120, { until: () => game.p.x >= 6450 && game.p.x < 6500 && game.p.y >= 17000 && game.p.y < 17100 });
standAtLever(4, 6450, 6560);
if (door(4) !== "open") fail(`lever 4, one region west of its door, did not open it — the player is at x${game.p.x} in ${room()}`);
ok(`three levers thrown, and the last of them opened a door in the next region`);

leg = "through door 4";
if (!move(["right"], 240, { jump: true, until: () => room() === "hugeroom" }))
  fail(`through door 4 is the hall of lifts; the player is at x${game.p.x} in ${room()}`);
/**
 * ...and this is as far as the level is WALKED here. The hall's own floor is
 * `platform` (17327, 6147, 17375, 9471) and eight `initbush` hang along it at
 * y17241, their rects straddling it; the ride itself is section 8's, from the
 * floor it belongs to.
 */
ok(`...and the hall of lifts is reached, at x ${game.p.x}, y ${game.p.y}`);

// ...and a blow on the death's first cel is the whole handler again: 0x33,
// 0x34, the death from its first frame and another 0x140 (`0x43fa36`)
{
  const ox = game.level!.spawned.flat().find((e) => e.kind === "initox");
  if (!ox) fail(`SEWER places an ox`);
  ox.hp = 0;
  game.killFoe(ox, FOES.initox);
  const paid = game.stats.score;
  ox.clock = 1;
  const a = game.foeAnchor(ox, game.level!) ?? { x: ox.x, y: ox.y };
  game.strikeFoe(ox, 47, { dx: 20, dy: 0 }, 1, a.y, { left: a.x - 20, right: a.x + 20, top: a.y - 20, bottom: a.y + 20 }, 0, a);
  if (game.stats.score - paid !== 320 || ox.clock !== 0 || ox.state !== "dead")
    fail(`an ox struck on 5190 dies again and pays again; the score rose ${game.stats.score - paid}`);
  ok(`an ox struck as it falls dies again from the top and pays another 320`);
}

// ...and the census. Nothing in the ox's class calls `0x42f870(obj, 0)`, so
// its body keeps `obj+0x1c` and counts until the object is freed — `0x42f750`
// takes it off `[0x4a6e88]` then (`0x42f778`). The pit's end frees it at once
{
  const dead = game.level!.spawned.flat().find((e) => e.kind === "initox" && e.state === "dead")!;
  const counted = game.aliveNow();
  if (!game.inCensus(dead)) fail(`a dead ox still holds its census flag until it is freed`);
  const other = game.level!.spawned.flat().find((e) => e.kind === "initox" && e.state !== "dead");
  if (!other) fail(`SEWER places two oxen`);
  await h.load(`level=7&x=${Math.round(other.x)}&y=${Math.round(other.y) - 20}`);
  h.until(() => game.p.onGround, 60);
  const ox2 = game.spawnedHere().find((e) => e.kind === "initox")!;
  // killed — and still counted — and then knocked off a ledge as it dies:
  // `0x43f325` exempts only 0 and 7, so the body goes into the pit
  game.killFoe(ox2, FOES.initox);
  const before = game.aliveNow();
  const score = game.stats.score;
  ox2.fell = 200;
  ox2.y -= 400;
  ox2.vy = 5 * TICK_SCALE;
  h.frame();
  if (ox2.state !== "gait" || ox2.script !== 7) fail(`a dying ox past a hundred of drop goes in the pit: ${ox2.state}, kind ${ox2.script}`);
  ox2.state = "gait";
  ox2.anim = OX_PIT.land;
  ox2.script = 7;
  ox2.tag = 1;
  ox2.clock = OX_PIT.land.cels.length;
  h.frame(2);
  if (game.spawnedHere().includes(ox2) || game.aliveNow() !== before - 1 || game.stats.score - score !== 0x140)
    fail(`the pit's end frees the ox, takes it out of the census and pays 320: alive ${before} -> ${game.aliveNow()}, +${game.stats.score - score}`);
  if (counted < 1) fail(`the corpse was counted: ${counted}`);
}
ok(`an ox's body counts until it is freed, and the pit frees it and takes it off the count`);

/**
 * A reaction that is a state of the machine — {@link FoeAnim.decides} — hands
 * its own case the frame the script ends, and the next script goes on then:
 * exactly the script's own frames, and nothing between. A fresh one of `kind`
 * near where the level puts it, given the reaction by hand.
 */
const handOff = async (lv: number, kind: string, take: FoeAnim, next: readonly FoeAnim[], hp?: number): Promise<number> => {
  await h.load(`level=${lv}`);
  const at = game.level!.spawned.flat().find((q) => q.kind === kind);
  if (!at) fail(`level ${lv} places no ${kind}`);
  await h.load(`level=${lv}&x=${Math.round(at.x)}&y=${Math.round(at.y) - 20}`);
  h.until(() => game.p.onGround, 60);
  const e = game
    .spawnedHere()
    .filter((q) => q.kind === kind && q.state !== "dead")
    .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];
  if (!e) fail(`no ${kind} near x${at.x}`);
  e.asleep = false;
  if (hp !== undefined) e.hp = hp;
  e.state = "flinch";
  e.anim = take;
  e.clock = 0;
  e.script = take.kind;
  e.tag = take.tag;
  let f = 0;
  while (e.state === "flinch" && e.anim === take && f < 60) {
    h.frame();
    f += 1;
  }
  if (f !== take.cels.length * take.hold || !next.includes(e.anim))
    fail(`${kind}: ${take.from} is ${take.cels.length * take.hold} frames and then ${next.map((a) => a.from).join(" or ")}; ${f} frames, then ${e.anim.from}`);
  return f;
};

{
  // every eyeball reaction is kind 3, and `0x43dfee` puts the hover on at `obj+0x46`
  const E = FOES.initeyeball.flinch!;
  const f = [await handOff(7, "initeyeball", E[0], [EYEBALL.hover]), await handOff(7, "initeyeball", E[3], [EYEBALL.hover])];
  ok(`an eyeball's shut eye and its knock-out hand to the hover after ${f.join(" and ")} frames (0x43dff5)`);
}

/**
 * The eyeball's SWOOP, and what it does to him.
 *
 * `0x43e06c` is its door: he is in the judder, kind 9 — which is what the
 * glob's own −2 puts him in — and no other eye is already swooping
 * (`0x43e880`). The carry (`0x43e259`) holds him a hundred and twenty below
 * it in the spawn pose, `0x402fa0(-1)` every frame, undrawn (`[0x46b1b4]`),
 * rising with it; the shake (`0x43e2f5`) takes ten a frame (`0x402ac0(0xa)`);
 * and it lets him go into the knockdown, `0x402fa0(2)`, drawn again.
 */
{
  await go("damage=1");
  const eyes = game.level!.spawned.flat().filter((q) => q.kind === "initeyeball");
  const e = eyes[0];
  const E = FOES.initeyeball;
  const k = game.BRAIN_CTX;
  const stage = (): void => {
    install(e, EYEBALL.hover);
    e.state = "gait";
    e.clock = 0;
    e.facing = -1;
    e.x = game.p.x + 120;
    e.y = game.p.y - 60;
  };
  stage();
  game.p.act = null;
  eyeball(e, E, 16, k);
  const calm = e.script;
  stage();
  game.p.act = "jolt";
  eyeball(e, E, 16, k);
  if (calm === 5 || e.script !== 5 || e.tag !== 0)
    fail(`0x43e06c: the swoop opens on a juddering player and not otherwise; calm ${calm}, jolted ${e.script}/${e.tag}`);
  ok(`an eye swoops on a man in the judder, and only then (0x43e06c)`);

  game.p.act = null;
  const hp0 = game.stats.health;
  install(e, EYEBALL.carryA);
  e.clock = 0;
  let posed = 0;
  let under = 0;
  const frames = EYEBALL.carryA.cels.length * EYEBALL.carryA.hold + EYEBALL.shakeA.cels.length * EYEBALL.shakeA.hold + 2;
  for (let f = 0; f < frames; f++) {
    eyeball(e, E, e.anim.cels.length * e.anim.hold, k);
    if (e.script !== 5) break;
    if (game.p.act === "posed" && game.p.hidden) posed += 1;
    if (Math.abs(game.p.x - k.anchorX(e)) < 1 && Math.abs(k.player.anchor - (k.anchorY(e) + 0x78)) < 1) under += 1;
    e.clock += 1;
  }
  if (!posed || posed !== under) fail(`0x43e26c / 0x43e2ab: held in the spawn pose, undrawn, 120 under it; posed ${posed}, under ${under}`);
  if (game.stats.health >= hp0) fail(`0x43e2fc: the shake takes ten a frame; health ${hp0} -> ${game.stats.health}`);
  if (game.p.hidden || game.p.act !== "downFront") fail(`0x43e38c / 0x43e3a1: let go into the knockdown and drawn again; ${game.p.act}, hidden ${game.p.hidden}`);
  ok(`and it carries him ${posed} frames in the spawn pose, shakes ${hp0 - game.stats.health} health out of him and drops him down (0x43e259, 0x43e2f5)`);
}

pass(`SEWER's doors are locks, its levers are keys, and three of them can be walked to`);
