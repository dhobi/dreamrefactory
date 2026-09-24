/**
 * WOODS — level three, and the first one whose population is its own.
 *
 *   npx tsx tests/machine/woods.ts        (from skullcracker/)
 *
 * Level three is one room ten thousand pixels wide with no plank, no lift and no
 * ladder in it. What it has instead is twenty enemies of five kinds and a floor
 * that stands up in front of you twice, and both of those were reasons this port
 * could not play it.
 *
 * What the file says, and what this checks:
 *
 *   - **a creator places its object at the record's POINT.** The level's spawner
 *     `0x4503a0` hands every creator the point as one dword and the rect's two
 *     corners as two more, and each creator's first move is
 *     `mov dword [obj+6], eax` with the point (`0x450f90` for the dog,
 *     `0x450a7b` for the punk). The rect is the patrol territory and nothing
 *     else. Standing them on its bottom edge put every foe in WOODS inside the
 *     terrain, and they fell through the world.
 *   - **five kinds, and only four of them count.** The dog's creator never calls
 *     `0x42f870`, the census, and its class never calls `0x40d1c0`, the bar. Six
 *     dogs are worth 200 apiece and nothing to the quota.
 *   - **the CHOPPER hatches.** `0x454690`, in the first tag of the fourth kind's
 *     death, calls `0x450a50` — the punk's own creator — at the dying thing's
 *     own position. So killing one leaves the population where it was; the
 *     bike pays its own 300 (`0x454873`) and FANG its 220 later.
 *   - **a rise over fifty pixels is a wall.** `0x42fedc` adds 0x32 to the floor
 *     under the body's new position and `0x42fef3` throws the move away if that
 *     is still above it. WOODS' ground has exactly two such steps, at x8746 and
 *     x8890, and clearing them is how the level is crossed.
 */
import { WERED } from "../../src/brains/wered";
import { WEREC_SHOT } from "../../src/brains/werec";
import { FOES } from "../../src/foes";
import { GUN_CODES } from "../../src/guns";
import { crushCel } from "../../src/props";
import { fail, headless, ok, pass } from "./harness";

const near = (a: number, b: number, slack = 3): boolean => Math.abs(a - b) <= slack;

/**
 * How close the CHOPPER has to be before a punch at it is worth throwing:
 * **its own maul band**, `0x477c28`'s third entry — the distance at which the
 * thing commits to its one attack, so the distance at which a fight exists.
 * `0x454410` does not home in on anybody: it walks the way it is facing, mauls
 * anything inside 160 in front of it (`0x45456c` takes bands 3 and 4 alike),
 * and turns round only when the player is six hundred pixels BEHIND it
 * (`0x45454a`) or when it bounces off a wall.
 */
const REACH = WERED.bands[2];

const h = await headless("level=3");
const { game } = h;
type Enemy = ReturnType<typeof game.spawnedHere>[number];

const at = (): { x: number; y: number } => ({ x: Math.round(game.p.x), y: Math.round(game.p.y) });
const quota = (): number => Math.max(0, game.aliveNow() - game.stats.allowance);
const nearestPlated = (): Enemy | undefined =>
  game
    .spawnedHere()
    .filter((e) => FOES[e.kind].panel)
    .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];
/** a fresh start on `query`, as each browser page was — facing east, no move remembered */
const go = async (query = ""): Promise<void> => {
  game.p.facing = 1;
  game.blow.move = -1;
  game.inv.armed = false;
  game.inv.rounds = {};
  await h.load(`level=3${query ? `&${query}` : ""}`);
  h.frame(10);
};
const take = (): void => {
  h.hold("down", true);
  h.frame(14);
  h.hold("down", false);
  h.frame(6);
};

// 1. it opens where its own initplayer stands
await go();
const spawn = at();
if (!near(spawn.x, 826, 20)) fail(`WOODS should open at its own initplayer, x826; got x ${spawn.x}`);
ok(`WOODS opens on its path at x ${spawn.x}, y ${spawn.y}`);

// 2. the whole population is there, and the quota is only what enrols
const all = game.spawnedHere().length;
if (all !== 20) fail(`WOODS places 20 enemies this page has cels for; ${all} spawned`);
if (game.stats.census !== 14) fail(`the census should be the 14 that call 0x42f870, not the six dogs too; got ${game.stats.census}`);
if (Math.round(game.mission().kill * 100) !== 55) fail(`WOODS' mission is to kill 55%; it says ${game.mission().kill}`);
ok(`all ${all} of its enemies stand up, and ${game.stats.census} of them are the quota's`);

// 3. and they stand on the ground rather than inside it. The room's own floor
//    ends at y1590; a foe placed on its rect's bottom edge falls past that for
//    ever, which is what the point fixes.
await go("x=10400");
for (let i = 0; i < 180; i++) {
  h.frame();
  const fell = game.spawnedHere().find((e) => e.y > 1700);
  if (fell) fail(`a ${fell.kind} fell out of the level: y ${Math.round(fell.y)}`);
}
const standing = nearestPlated();
ok(`and stay on their feet — ${standing?.kind} still at y ${Math.round(standing?.y ?? 0)} after 12s, and no foe in the level below y1700`);

// 4. the CHOPPER hatches a punk out of itself
await go("x=2200");
const before = game.spawnedHere().length;
const kin = new Set(game.spawnedHere());
const pointsBefore = game.stats.score;
const chopper = game
  .spawnedHere()
  .filter((e) => e.kind === "initwered")
  .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];
if (!chopper) fail(`no CHOPPER near x2200`);
// where it was on the frame before it fell, and where it fell: which way it
// was riding
let riding = chopper.x;
let fell = NaN;
for (let i = 0; i < 600 && Number.isNaN(fell); i++) {
  if (Math.abs(chopper.x - game.p.x) < REACH) h.press("punch");
  riding = chopper.x;
  h.frame();
  if (chopper.state === "dead") fell = chopper.x;
}
if (Number.isNaN(fell)) fail(`never landed the blows to fell a CHOPPER`);
/**
 * ...and the bike is worth 300 of its own: `0x454873` is `0x40d450(0x12c)`
 * on the blow that empties it, before FANG has even climbed out.
 */
const bikePaid = game.stats.score - pointsBefore;
if (bikePaid !== 0x12c) fail(`a CHOPPER pays 0x40d450(0x12c) as it falls; the score moved by ${bikePaid}`);
ok(`the CHOPPER pays ${bikePaid} as it falls`);
/**
 * ...and it dies MOVING. `obj+0xc` is one word that neither `0x454790` nor
 * the death's install writes, and `0x454473` still clamps it in state 5, so
 * a CHOPPER killed at its thirty a frame coasts on under its 5% drag.
 */
const way = Math.sign(fell - riding);
if (!way) fail(`the CHOPPER was standing still when it fell, at x${Math.round(fell)}`);
const coasted = (): boolean => Math.abs(chopper.x - fell) >= 30 && Math.sign(chopper.x - fell) === way;
if (h.until(coasted, 4) < 0)
  fail(`a CHOPPER killed at speed keeps its ride: x${Math.round(fell)} riding from x${Math.round(riding)}, then x${Math.round(chopper.x)} four frames on`);
ok(`the wreck coasts on the way it was riding: x${Math.round(fell)} -> x${Math.round(chopper.x)}`);
/**
 * ...and FANG leaves WITH it: `0x450b11` launches a parented punk at thirty
 * the parent's way and fifty up, in `0x477488`. Standing up at the corpse's
 * feet is what the page did.
 */
const hatched = (): Enemy | undefined => game.spawnedHere().find((e) => !kin.has(e) && e.kind === "initwerea");
if (h.until(() => !!hatched(), 30) < 0) fail(`no punk came out of the CHOPPER to measure`);
const rider = hatched()!;
h.frame(2);
const riderCel = game.celOf(rider);
// `0x477488` and the two tags of `0x477580` it hands to: the leap, not the walk
const leapCels = [4892, 4893, 4894, 4895, 1962, 1950, 1951, 1952, 1953, 1954, 1955, 1956, 1957];
if (rider.state !== "flinch" || !leapCels.includes(riderCel))
  fail(`FANG comes off the bike in 0x477488, not on its feet: ${rider.state} on cel ${riderCel}`);
if ((rider.x - fell) * way < 60)
  fail(`FANG leaves the bike at its speed, on its side: fell x${Math.round(fell)} riding ${way > 0 ? "right" : "left"}, FANG at x${Math.round(rider.x)}`);
ok(`and FANG is thrown the same way, in its leap: x${Math.round(fell)} -> x${Math.round(rider.x)} on cel ${riderCel}`);
h.frame(4);
const after = game.spawnedHere().length;
if (after !== before + 1) fail(`killing a CHOPPER should leave a punk standing: ${before} spawned, then ${after}`);
// the wreck lies up to 125 frames on 4904 before it sinks (`0x4546dc`), and
// what is left once it has gone is the punk `0x450a50` made
// ...and it burns there, `0x4546ac`'s flame that never goes out. `0x453eb7`
// hangs it off the wreck's `obj+8`, its ANCHOR, every frame after the
// CHOPPER's own pass; the page hung it off the middle of the gait cel, 86
// pixels to one side of the bike, and a frame behind it
let burned = 0;
const lvl = game.level!;
if (
  h.until(() => {
    const f = game.flames.find((q) => q.on === chopper);
    if (!f) return !game.spawnedHere().includes(chopper);
    const a = game.foeAnchor(chopper, lvl)!;
    const x = a.x + (chopper.facing < 0 ? -f.dx : f.dx);
    if (f.x !== x || f.y !== a.y + f.dy)
      fail(`the wreck's flame stands at x${f.x} y${f.y}, wanted its anchor x${a.x} y${a.y} plus ${f.dx}, ${f.dy}`);
    if (f.mirror !== chopper.facing < 0) fail(`a flame takes its victim's facing as it catches (0x44ffee)`);
    // and it is ON the bike: inside the lying wreck, 4904, as drawn about that
    // anchor — the cel it caught on and rolled its point in (`0x44ff42`); the
    // sink's cels shrink under it to 39 wide, and the flame stays put
    const c = game.celRec(lvl.sbk, game.celOf(chopper))!;
    const left = chopper.facing < 0 ? a.x - (c.width - c.posX) : a.x - c.posX;
    if (c.id === 4904 && (f.x < left || f.x > left + c.width))
      fail(`the flame at x${f.x} is off the wreck, x${left}..${left + c.width}`);
    burned += 1;
    return !game.spawnedHere().includes(chopper);
  }, 200) < 0
)
  fail(`the CHOPPER's wreck never sank`);
if (!burned) fail(`the wreck never caught — 0x4546ac`);
ok(`the wreck burns on its own anchor for ${burned} frames, then sinks`);
if (!game.spawnedHere().includes(rider)) fail(`the punk out of the CHOPPER should still be standing`);
ok(`blows fell a CHOPPER and an ${rider.kind} climbs out of it — ${before} spawned, then ${after}`);

/**
 * 5. the dog: it SITS until you are inside its rect, ten health, 200 points
 *    and no effect at all on the quota, because it is in nobody's census.
 *
 *    `0x454c13` is the whole of state 0: the player's point inside the four
 *    words of the record's rect, and nothing else, wakes it. WOODS' last two
 *    dogs stand EAST of their own rects — x9423 against a rect that ends at
 *    x9348 — so a player at x9440 is outside both and the nearer one sits on
 *    cel 4800 twenty-odd pixels west.
 */
await go("x=9440");
const quotaWas = quota();
const dog5 = game
  .spawnedHere()
  .filter((e) => e.kind === "initdog")
  .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];
if (!dog5 || dog5.script !== 0 || game.celOf(dog5) !== 4800)
  fail(`outside its rect a dog sits in state 0 on cel 4800 (0x454c13); got ${dog5 ? `kind ${dog5.script} cel ${game.celOf(dog5)}` : "none"}`);
const seen5 = new Set<number>();
const paid: number[] = [];
let score = game.stats.score;
// face it: it is to the west
const from = game.p.x;
h.hold("left", true);
h.until(() => game.p.x < from, 10);
h.hold("left", false);
for (let i = 0; i < 40 && dog5!.state !== "dead"; i++) {
  seen5.add(game.celOf(dog5!));
  // a DUCKING kick. A sitting dog is 74 pixels tall (cel 4800), and the
  // standing kick's box on 663 is 72..96 above the player's feet: on this
  // slope, with the body pass (`0x430680`) lifting him a few pixels onto the
  // dog, it passes over its back. The duck kick goes in low
  h.hold("down", true);
  h.frame(1);
  h.press("kick");
  h.frame(4);
  h.hold("down", false);
  if (game.stats.score !== score) paid.push(game.stats.score - score);
  score = game.stats.score;
}
if (dog5!.state !== "dead") fail(`a duck kick against a dog's ten health should kill it: ${dog5!.state} ${dog5!.hp}hp`);
seen5.add(game.celOf(dog5!));
if (!paid.includes(200)) fail(`a dog pays 0x40d450(0xc8); the score jumped by ${paid.join(", ") || "nothing"}`);
/**
 * ...and the quota moved by the PUNKS and by nothing the dog did: `initwerea`
 * pays 220 and is in the census; the dog pays 200 and is in nobody's.
 */
const punks = paid.filter((n) => n === 220).length;
if (quota() !== quotaWas - punks) fail(`a dog is in no census: the quota went ${quotaWas} -> ${quota()} with ${punks} punk(s) felled beside it`);
ok(`a dog sits outside its rect, falls to one kick for 200 points (cels ${[...seen5].join(" ")}), and the quota moves only for the ${punks} punk(s) beside it`);

// 6. the floor stands up at x8746, and the walk stops dead against it
await go("x=8600");
h.hold("right", true);
h.until(() => game.p.x > 8760, 90);
h.hold("right", false);
h.frame(6);
const stopped = at();
if (stopped.x > 8770) fail(`the 70px step at x8746 should stop a walk; walked on to x ${stopped.x}`);
ok(`the ground stands up at x8746 and the walk stops at x ${stopped.x}`);

// 7. ...and a jump clears it, which is the whole of how level three is crossed
h.hold("right", true);
h.hold("up", true);
h.press("jump");
h.frame(18);
h.hold("right", false);
h.hold("up", false);
const over = at();
if (over.x < 8790) fail(`a jump should clear the step; still at x ${over.x}`);
if (over.y > 1100) fail(`it should land on the higher ground, y~1060; got y ${over.y}`);
ok(`and a jump puts the player over it, x ${over.x}, y ${over.y}`);

// 8. the three presses: up and watching until the player's point is inside the
//    record's own rect, and then the whole stroke. Every cel of the stroke is
//    held ONE engine frame — the script's ticksPerFrame is 1
await go("x=7000");
if (game.crushesHere().some((c) => c.state !== "idle")) fail(`a press should be idle until someone stands under it`);
h.hold("right", true);
const cels = new Set<number>();
const states = new Set<string>();
for (let i = 0; i < 60; i++) {
  h.frame();
  for (const c of game.crushesHere().filter((c) => c.state !== "idle")) {
    states.add(c.state);
    cels.add(crushCel(c));
  }
}
h.hold("right", false);
if (!states.has("slam") || !states.has("lift")) fail(`a press should run its stroke and come back up; saw ${[...states].join(" ")}`);
// 4382 and 4383 are the only two cels of the stroke that carry a strike box
if (!cels.has(4382) || !cels.has(4383)) fail(`the head should come down through 4382 and 4383; saw ${[...cels].join(" ")}`);
ok(`walking under a press works it — ${[...states].join(" and ")}, ${cels.size} of its own cels`);

// 9. the goal, from the level's own start, on the level's own ground
await go();
const inGoal = (): boolean => {
  const g = game.solids().goal;
  const b = game.playerBox();
  return (!!g && b.right > g.left && b.left < g.right && b.bottom > g.top && b.top < g.bottom) || game.craftOpened();
};
h.hold("right", true);
h.hold("up", true);
let arrived = false;
let last = game.p.x;
let stuck = 0;
for (let i = 0; i < 750 && !arrived; i++) {
  h.frame();
  if (inGoal()) {
    arrived = true;
    break;
  }
  if (i % 2) continue;
  if (Math.abs(game.p.x - last) < 3) {
    stuck += 1;
    // the two steps are jumped, and nothing else on the route needs one
    if (stuck === 3) h.press("jump");
    if (stuck > 30) break;
  } else stuck = 0;
  last = game.p.x;
}
h.hold("right", false);
h.hold("up", false);
if (!arrived) fail(`never reached WOODS' goal; stopped at x ${at().x}, y ${at().y}`);
const end = at();
if (!near(end.x, 11020, 120)) fail(`the goal rect is x11036..11153; arrived at x ${end.x}`);
ok(`ran the level end to end and reached the goal at x ${end.x}, y ${end.y}`);

/**
 * ...and the FLAMER, which crossed sixteen levels touching nothing.
 *
 * `0x453b9b` gives the flame a strength of `0xfff7` — **−9** — and this page
 * read "below 1" as "harmless". It is not damage at all: it is the one code
 * a creature reads, and eight classes have a handler that accepts nothing
 * else. Every one of them starts by calling `0x44ff20`, which sticks a
 * FLAME on the victim at a random point inside its own cel bitmap, and then
 * does something of its own.
 *
 * `initwerec`'s (`0x45296e`) is the one worth watching, because it costs no
 * health: the arm lights the thing and installs `0x477a68` — one cel at five
 * engine frames — and answers 1 before any arithmetic runs. Those five
 * frames are the death throw.
 */
/** the werec on the ledge above WOODS' flamer — its rect is x3475..4370 */
const ledgeWerec = (): Enemy | undefined => game.spawnedHere().find((e) => e.kind === "initwerec" && e.left === 3475);
/**
 * Chase the werec and pour on it, a frame at a time, until `done()`. It paces
 * its own patch and BOLTS on its double stride out of the throwing band
 * (`0x4525a7`), so this walks at it while it is further than `reach` and
 * otherwise faces it and holds the stream open. The flame's box starts 134
 * ahead of the player and reaches 415 (`0x44db90`'s offset and 9508's own
 * strike rect), so anywhere inside that band is in it.
 */
const pourOn = (done: () => boolean, reach: number, frames: number): void => {
  for (let i = 0; i < frames && !done(); i++) {
    const w = ledgeWerec();
    const dx = w ? w.x - game.p.x : 1;
    if (!w || w.state === "dead") {
      h.hold("punch", false);
      h.frame();
      continue;
    }
    const key = dx > 0 ? "right" : "left";
    if (Math.abs(dx) > reach) {
      h.hold("punch", false);
      h.hold(key, true);
      h.frame(3);
      h.hold(key, false);
    } else {
      if (Math.sign(dx) !== game.p.facing) {
        h.hold("punch", false);
        h.hold(key, true);
        h.frame(1);
        h.hold(key, false);
      }
      h.hold("punch", true);
      h.frame();
    }
  }
  h.hold("punch", false);
};
await go("x=3800&y=284&foehit=1&damage=1");
// WOODS' one `statflamer` stands at x3822, and a werec paces the same row
for (let i = 0; i < 25 && !game.gunAhead(); i++) {
  h.hold("right", true);
  h.frame(1);
  h.hold("right", false);
  h.frame(1);
}
const ahead = game.gunAhead();
if (!ahead || GUN_CODES[ahead.code]?.name !== "statflamer") fail(`WOODS' statflamer at x3822 should be in reach`);
take();
if (!game.inv.armed || game.inv.weapon !== 10) fail(`could not pick up WOODS' flamer; weapon ${game.inv.weapon}, armed ${game.inv.armed}`);
const werec = ledgeWerec();
if (!werec) fail(`no werec on the flamer's ledge`);
let litCel = -1;
let hpWhenLit = 0;
let threw = false;
pourOn(
  () => {
    const f = game.flames.find((q) => q.on === werec);
    if (f && litCel < 0) {
      litCel = game.flameCel(f);
      hpWhenLit = werec!.hp;
    }
    if (game.celOf(werec!) === 6040 && werec!.state !== "gait") threw = true;
    return litCel >= 0 && threw;
  },
  380,
  600,
);
if (litCel < 0) fail(`the flamer should SET THINGS ON FIRE — 0x44ff20; nothing caught`);
if (litCel < 9600 || litCel > 9699) fail(`a flame is 9600..9629 — 0x4788d0 and 0x478978; it showed ${litCel}`);
if (!threw) fail(`a burning werec goes to state 3, cel 6040 — 0x45298d; it never did`);
// `0x452992` answers 1 before the arithmetic, so the code costs it nothing
if (hpWhenLit !== 180) fail(`0x45296e returns before any damage is computed; it was on ${hpWhenLit} of 180 when it caught`);
ok(`the flamer sets a werec alight (cel ${litCel}), for none of its 180 health, and it throws from cel 6040`);

/**
 * ...and what it throws is thrown INTO the flame.
 *
 * A lob at a player holding the stream crosses it, and the five shots of
 * state 3 leave the burning thing's own point, which is where the stream
 * is. `0x452f80` — the shot's own hit handler — answers a −9 by lighting a
 * flame on it (`0x452fd7`) and bursting it (`0x453003`). Its first arm answers
 * `0x65`, the strength `0x452ec0` gives a burst, so the flash of one shot sets
 * off every other shot it touches (`0x452fbe`).
 */
const shotSelf = () =>
  ({ x: 0, y: 0, vx: 5, vy: 5, facing: 1, spent: false }) as {
    x: number;
    y: number;
    vx: number;
    vy: number;
    facing: number;
    spent: boolean;
    landed?: number;
  };
const handled: string[] = [];
const ctx = { burn: () => void handled.push("burn"), burst: () => void handled.push("burst") };
const handler = WEREC_SHOT.onCode!;
const answers = [
  handler(shotSelf() as never, -9, ctx as never),
  handler(shotSelf() as never, 0x65, ctx as never),
  handler({ ...shotSelf(), landed: 0 } as never, 0x65, ctx as never),
  handler(shotSelf() as never, 0x64, ctx as never),
];
if (handled.join(" ") !== "burn burst burst" || answers.some((a) => !a))
  fail(
    `0x452f80: −9 is a flame and a burst, 0x65 a burst unless already bursting, anything else nothing — and all answer 1; got [${handled.join(" ")}] answering ${answers.join(" ")}`,
  );
// its own run at it, in the flame and firing throughout: every shot it lobs
// at you crosses the stream on the way, and the five of the death throw leave
// from inside it
await go("x=3800&y=284&foehit=1&damage=1&weapon=10&rounds=160");
// a level opens on the unarmed idle (`0x448bc7`) and the load only sets
// `0x479438` (`0x45e041`): the gun is carried, not out, until INV — which
// tests/machine/guns.ts presses. Here it is simply out, frame for frame as before
game.inv.drawn = true;
let shotsLit = 0;
let shotsSetOff = 0;
pourOn(
  () => {
    shotsLit = Math.max(shotsLit, game.casts.filter((c) => game.flames.some((f) => f.on === c)).length);
    shotsSetOff = Math.max(shotsSetOff, game.casts.filter((c) => c.setOff).length);
    return (shotsLit > 0 && shotsSetOff > 0) || (!ledgeWerec() && !game.casts.length);
  },
  380,
  600,
);
if (!shotsLit) fail(`a werec's shot in the flame should catch — 0x452fcc lights it with 0x44ff20; none did`);
if (!shotsSetOff) fail(`a shot's burst is strength 0x65 and 0x452f8d sets off the shots it touches; none was`);
ok(`its shots catch in the flame and burst (0x452fcc), and each burst sets off its neighbours (0x452f8d): ${shotsLit} lit, ${shotsSetOff} set off`);

/**
 * ...and a burn that is FATAL ends in the death, once, and pays for it.
 *
 * The dog's arm (`0x4550d3`) is its death path word for word: sound 0x18,
 * `0x478208`, and `0x40d450(0xc8)` at `0x455115` — with the health left as
 * it was.
 *
 * Where the flame can MEET a dog is the whole of the staging. The flame's box
 * hangs 103..152 above the feet of the player holding it, and a dog is 74
 * tall: a dog on the same ground as the player runs under it, and meets it
 * only mid-pounce. So the player stands one ledge DOWN from a dog — WOODS'
 * dog at x3238 sits on the y711 ledge, its rect is x2987..3748 by y562..871,
 * and the y820 walkway at x3591..3756 puts the player's point inside that
 * rect with the flame at exactly the dog's height, 405..540 to the west. The
 * dog wakes, charges along its ledge into the stream, and dies of it.
 */
await go("x=3680&y=820&weapon=10&rounds=160");
// a level opens on the unarmed idle (`0x448bc7`) and the load only sets
// `0x479438` (`0x45e041`): the gun is carried, not out, until INV — which
// tests/machine/guns.ts presses. Here it is simply out, frame for frame as before
game.inv.drawn = true;
game.p.facing = -1;
const dog = game.spawnedHere().find((e) => e.kind === "initdog" && e.left === 2987);
if (!dog) fail(`no dog on the y711 ledge (rect x2987..3748)`);
const dogX0 = dog!.x;
const scoreBefore = game.stats.score;
const dogSeen: { hp: number; state: string; cel: number }[] = [];
h.hold("punch", true);
for (let i = 0; i < 60 && dog!.state !== "dead"; i++) {
  h.frame();
  dogSeen.push({ hp: dog!.hp, state: dog!.state, cel: game.celOf(dog!) });
}
h.hold("punch", false);
if (dog!.state !== "dead") fail(`a dog in the flame dies — 0x4550fc installs 0x478208; it went ${[...new Set(dogSeen.map((s) => s.state))].join(", ")}`);
if (dog!.x === dogX0) fail(`the dog should have woken and come along its ledge before it caught; it never moved from x${dogX0}`);
for (let i = 0; i < 8 && game.spawnedHere().includes(dog!); i++) {
  h.frame();
  dogSeen.push({ hp: dog!.hp, state: dog!.state, cel: game.celOf(dog!) });
}
const dogDead = dogSeen.findIndex((s) => s.state === "dead");
if (dogSeen.slice(dogDead).some((s) => s.state !== "dead"))
  fail(`a burnt dog stays dead; it went ${dogSeen.slice(dogDead).map((s) => s.state).join(" ")}`);
if (!dogSeen.some((s) => s.state === "dead" && s.cel >= 4850 && s.cel <= 4855))
  fail(`0x478208 is cels 4850..4855; the dead dog showed ${dogSeen.filter((s) => s.state === "dead").map((s) => s.cel).join(" ")}`);
if (dogSeen[dogDead].hp !== 10) fail(`0x4550d3 returns before any damage; the dog died on ${dogSeen[dogDead].hp} of 10`);
if (game.stats.score - scoreBefore !== 0xc8) fail(`0x455115 pays 0x40d450(0xc8), once; the score moved by ${game.stats.score - scoreBefore}`);
ok(`the flame kills a dog outright as it charges along its ledge, x${Math.round(dogX0)} -> x${Math.round(dog!.x)}, on its own death cels, for 200 and none of its health`);

/**
 * ...and werec's (`0x45296e`) is a flinch that ends in it. `0x4526ef`: when
 * `0x477a68`'s five frames run out the think squeals `0x21`, clears the bar,
 * installs `0x477a78` and pays `0x40d450(0x104)` (`0x452737`). The stream is
 * stopped the moment the thing reacts, so that nothing re-lights it:
 * `0x45d090` restarts a script it is handed, so a flame held on a burning
 * werec keeps it in state 3 for as long as it is held.
 */
await go("x=3800&y=284&weapon=10&rounds=160");
// a level opens on the unarmed idle (`0x448bc7`) and the load only sets
// `0x479438` (`0x45e041`): the gun is carried, not out, until INV — which
// tests/machine/guns.ts presses. Here it is simply out, frame for frame as before
game.inv.drawn = true;
const w = ledgeWerec();
if (!w) fail(`no werec on the flamer's ledge`);
const wScore = game.stats.score;
pourOn(() => w!.state !== "gait", 380, 600);
if (!(game.celOf(w!) === 6040 && w!.state !== "gait")) fail(`a werec in the flame goes to 0x477a68, cel 6040; it shows ${w!.state} ${game.celOf(w!)}`);
const died: { hp: number; cel: number }[] = [];
for (let i = 0; i < 60 && game.spawnedHere().includes(w!); i++) {
  h.frame();
  if (w!.state === "dead") died.push({ hp: w!.hp, cel: game.celOf(w!) });
  if (died.length > 20) break;
}
if (!died.some((s) => s.cel >= 6030 && s.cel <= 6037))
  fail(`0x452721 installs 0x477a78, cels 6030..6037, as the burn ends; showed ${died.map((s) => s.cel).join(" ") || "no death"}`);
if (died[0].hp !== 180) fail(`neither 0x45296e nor 0x4526ef touches the health; it died on ${died[0].hp} of 180`);
if (game.stats.score - wScore !== 0x104) fail(`0x452737 pays 0x40d450(0x104); the score moved by ${game.stats.score - wScore}`);
ok(`and a werec's burn ends in its death, cels ${[...new Set(died.map((s) => s.cel))].join(" ")}, for 260`);

// a dog that charges off a ledge falls with its charge: `obj+0xc` is one word
// and nothing on the way off a floor clears it, so the jam test (`0x454f53`)
// sees it still running its own way. A wall it meets in the air turns it once
// — the wall hands back its speed times −0.3 — but it never turns on two frames
// running, which is what a fall with no speed did all the way down
await h.load("level=3&x=9000");
{
  const dogs = h.game.spawnedHere().filter((e) => e.kind === "initdog");
  const was = new Map(dogs.map((d) => [d, d.facing]));
  const turned = new Map(dogs.map((d) => [d, false]));
  let falls = 0;
  let spins = 0;
  for (let f = 0; f < 300; f++) {
    h.frame();
    for (const d of dogs) {
      const turn = d.facing !== was.get(d);
      if (d.vy > 0 && d.script === 4) {
        falls += 1;
        if (turn && turned.get(d)) spins += 1;
      }
      turned.set(d, turn);
      was.set(d, d.facing);
    }
  }
  if (falls === 0) fail(`a WOODS dog east of x9000 should charge off a ledge in twenty seconds; none fell charging`);
  if (spins > 0) fail(`a charging dog turned round on consecutive frames ${spins} times in ${falls} falling frames`);
  ok(`a charging dog runs off its ledge and down, ${falls} frames in the air, without spinning`);
}

pass(`WOODS is populated by its own records, burns, and can be crossed to its goal`);
