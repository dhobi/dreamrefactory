/**
 * CITY's opening, which was impassable — and the two rules that pass it.
 *
 *   npx tsx tests/machine/city.ts        (from skullcracker/)
 *
 * Level two is a staircase of rooftops with no floor under it (`CITY`'s ground is
 * y7250 for everything east of x691, 2900 pixels below anything it draws), and
 * its first step is the one this page could not take. The file's own numbers:
 *
 *   - a `platform` at `y4041, x1757..1904` — the metal walkway;
 *   - a 103px gap west of it, from the `y4046` platform that ends at x1654;
 *   - a wooden water tank whose roof is a `platform` at `y3920, x1873..2324`;
 *   - and an `obstacle` at `y3852..4160, x1873..1933` — the tank's west wall.
 *
 * So the step up is 121 pixels with a wall in the middle of it, and both of the
 * rules it needs are things this page had wrong:
 *
 * 1. **an obstacle is a point test.** `0x430146` walks the obstacle array against
 *    the object's own point and pushes it out along the smallest of the four
 *    penetrations — so clearing the wall means lifting the ANCHOR past y3852, 101
 *    pixels. Tested as a box it meant lifting all 148 rows of the sprite past it:
 *    189 pixels, which no jump in the game reaches.
 * 2. **the tuck's feet are 19 pixels higher than the standing pose's.** The
 *    engine's `y` is the cel's anchor and what lands is the cel's own collision
 *    box: standing cel 1's reaches 88 rows below the anchor, the airborne tuck's
 *    (cel 200) reaches 69. So a jump whose anchor rises 105 puts the feet at 3917
 *    against a roof at 3920 — three pixels of margin, and the whole level rests
 *    on them.
 *
 * And the planks, which are the other half of the level: twenty `initplank`
 * records, each sitting inside a `platform` record it OWNS (`0x42fb70`), sagging
 * through cels 1050..1053 under the player and giving way on the sixth crossing at
 * three times the player's gravity.
 *
 * The route is walked rather than teleported onto, because `?x=` drops the
 * player at the ground under that column and in CITY that is the void.
 */
import { crowCel, plankCel } from "../../src/props";
import { fail, headless, ok, pass } from "./harness";

const h = await headless("level=2");
const { game } = h;

const at = (): { x: number; y: number } => ({ x: Math.round(game.p.x), y: Math.round(game.p.y) });
const near = (got: number, want: number, slack = 6): boolean => Math.abs(got - want) <= slack;
/** hold east until the player is past `want`, or give up */
const walkTo = (want: number): void => {
  h.hold("right", true);
  h.until(() => game.p.x >= want, 400);
  h.hold("right", false);
};
/**
 * A running jump east with the lift held, braked by LETTING GO.
 *
 * The engine's air control (`0x429fc1`..`0x42a036`) first runs two frames after
 * the launch, and while forward is held it drives `v.x` to 30 pixels a frame —
 * twice the run. Released, the flight coasts on the launch impulse alone, which
 * is 15, and that is the difference between clearing the walkway this route
 * lands on and stopping on it.
 *
 * The press goes in on the run's `run`th frame. The run is 60, 180 or 285 px/s
 * over its first three frames, so which frame the jump comes off is which jump
 * it is — and every one of them is the same jump every time.
 */
const jump = (run: number): void => {
  h.hold("right", true);
  h.hold("up", true);
  h.frame(run);
  h.press("jump");
  if (h.until(() => !game.p.onGround, 8) < 0) fail(`pressing jump never left the ground`);
  h.hold("right", false);
  // and stay in the air until the feet are down again, however long that is
  h.until(() => game.p.onGround, 30);
  h.hold("up", false);
  h.frame(6);
};
const crows = () => game.crowsHere();
const crowSay = (): string =>
  crows()
    .filter((c) => c.state !== "sleep")
    .map((c) => `${c.state} cel ${crowCel(c)} at ${Math.round(c.x)},${Math.round(c.y)}`)
    .join(" · ") || "all asleep";

h.frame(9);
const spawn = at();
if (!near(spawn.x, 610, 40)) fail(`CITY should open at its own initplayer, x610; got x ${spawn.x}`);
ok(`CITY opens on its ledge at x ${spawn.x}, y ${spawn.y}`);

/**
 * 1. the first plank — twenty of CITY's records are `initplank` and its route
 *    crosses them. `0x4531d0` sags one under you (cels 1050..1053), counts the
 *    crossing when that animation ends, and on the SIXTH gives way: three times
 *    the player's gravity and the eight cels of it going.
 */
walkTo(1180);
const board = game.planksHere().find((k) => k.x === 1185);
if (!board || board.state === "fall" || plankCel(board) < 1050 || plankCel(board) > 1059)
  fail(`the plank at x1085..1285 should sag underfoot; it is ${board ? `${board.state} cel ${plankCel(board)}` : "missing"}`);
ok(`the first plank sags underfoot: plank ${board!.state} cel ${plankCel(board!)} x${board!.x} crossed ${board!.crossings}`);

// stand on it and it goes: six crossings is the file's own count
const stoodAt = at().y;
if (h.until(() => board!.state === "fall", 80) < 0) fail(`standing on a plank should break it after 6 crossings; it held (${board!.crossings})`);
h.frame(10);
const dropped = at();
if (dropped.y <= stoodAt + 100) fail(`the plank broke but did not take the player with it: y ${dropped.y}`);
ok(`six crossings and it gives way, dropping the player from y ${stoodAt} to ${dropped.y}`);

/**
 * 2 and 3: back to the route, from the level's start, east to the lip of the
 * 103px gap and across it onto the walkway the file puts at y4041.
 *
 * The press comes with the first frame of the run, from x1590. Two frames
 * later the launch carries on past the walkway into the tank's west wall high
 * enough that `0x430146`'s smallest penetration is UP, and the player comes to
 * rest on the roof at y3920 instead; from nearer the lip a later press is a
 * walk off it — the engine being right about a different jump.
 */
await h.load("level=2");
h.frame(9);
walkTo(1590);
const lip = at();
if (!near(lip.y, 4046, 10)) fail(`the walk east should end on the y4046 platform; got y ${lip.y}`);
ok(`walked east to the gap's lip at x ${lip.x}, y ${lip.y}`);
jump(0);
const walkway = at();
if (!near(walkway.y, 4041, 8)) fail(`the 103px gap should land on the y4041 walkway; got x ${walkway.x}, y ${walkway.y}`);
if (walkway.x < 1760) fail(`the jump did not cross the gap: x ${walkway.x}`);
ok(`jumped the gap onto the walkway at x ${walkway.x}, y ${walkway.y}`);

/**
 * 4. the crows — twelve `initcrow` records, each asleep on its own rect until
 *    the player's point enters it (`0x451ba3`). The walkway is inside the rect
 *    of the one at x1663, so standing here is what wakes it: cels 1835..1838,
 *    then 1840..1853 taking off, then the flight, and it holds a height about a
 *    hundred pixels above the player's own point for as long as it is up.
 */
if (crows().length !== 12) fail(`CITY places twelve crows; the room holds ${crows().length}`);
const awake = () => crows().find((c) => /(wake|rise|fly|strike)/.test(c.state));
if (h.until(() => !!awake(), 135) < 0) fail(`standing on the walkway should wake the crow whose rect covers it; ${crowSay()}`);
ok(`the walkway wakes a crow: ${crowSay()}`);

// and it flies a hundred above the player's point (`0x451aeb`, `ctx+0x12`
// still 0), whatever its pushes do across
const flier = () => crows().find((c) => /(fly|strike)/.test(c.state) && crowCel(c) >= 1700 && crowCel(c) <= 1899);
if (h.until(() => !!flier(), 135) < 0) fail(`the crow should reach its flight cels (1800..1825); ${crowSay()}`);
const height = Math.round(flier()!.y);
const eye = at().y - 88;
if (Math.abs(height - (eye - 100)) > 130) fail(`a crow holds ~100px above the player's point (${eye - 100}); it is at ${height}`);
ok(`and holds its height: crow at y ${height} against the player's point ${eye}`);

// 5. the wall stops a walk — the obstacle ejects west, as `0x430181` does
h.hold("right", true);
h.frame(30);
h.hold("right", false);
h.frame(4);
const stopped = at();
if (stopped.x > 1890) fail(`the tank's west wall should stop a walk at x1873; got x ${stopped.x}`);
if (!near(stopped.y, 4041, 8)) fail(`still on the walkway, please: y ${stopped.y}`);
ok(`and the wall stops the walk at x ${stopped.x}, the file's own x1873`);

// 6. and the jump goes over it onto the tank's roof
jump(2);
const roof = at();
if (!near(roof.y, 3920, 8)) fail(`the jump over the wall should land on the y3920 roof; got x ${roof.x}, y ${roof.y}`);
if (roof.x < 1940) fail(`landed short of the wall's east edge: x ${roof.x}`);
ok(`over the wall onto the tank roof at x ${roof.x}, y ${roof.y}`);

// 7. the PROBES, which are triggers rather than objects — CITY carries six of
//    the seventeen in the game and three of the four modes between them.
//
//    `0x4280d2` walks the level's own buffer once a frame, tests the player's
//    point against each record's rect, fires `0x410170` with the record's
//    `param` as a mode and then `0x402e80` shifts the record out of the table,
//    so one fires ONCE per level load. What it fires is scenery on
//    `PLAYER.SBK`'s own cels with no strike box anywhere in it.
//
//    The word that held this up for a long time is `obj+0xe`, the divisor
//    `0x42f8b0` does two `idiv`s by: `0x42f550` zeroes it and nothing in the
//    spawner writes it. It is the class's own constructor message — `0x4103e2`
//    writes 1 — so the script's dx goes into the velocity undivided.
type Seen = { tag: number; x: number; y: number; cel: number };
const fire = async (x: number, y: number): Promise<Seen[]> => {
  await h.load(`level=2&x=${x}&y=${y}`);
  const seen: Seen[] = [];
  for (let i = 0; i < 38; i++) {
    h.frame();
    for (const f of game.flypasts) seen.push({ tag: f.tag, x: Math.round(f.x), y: Math.round(f.y), cel: game.flypastCel(f) });
  }
  return seen;
};
// mode 0 — rect 2240,7930,2600,8000: it comes in from 512 to the WEST
const west = await fire(7960, 2400);
if (!west.length) fail(`the mode-0 probe at x7930..8000 fired nothing`);
if (west.some((v) => v.cel < 20200 || v.cel > 20207))
  fail(`0x46bdf0 tag 0 is 20200..20207; a crossing showed ${[...new Set(west.map((v) => v.cel))].join(" ")}`);
const x0 = west[0].x;
const x1 = west[west.length - 1].x;
if (!(x1 > x0)) fail(`mode 0 spawns 512 WEST and crosses east; it went ${x0} -> ${x1}`);
ok(`a mode-0 probe fires once and crosses west to east, x${x0} to x${x1} on its 20200s`);

// mode 2 — rect 2322,8486,2582,8736: the television, up from under your feet
const under = await fire(8600, 2500);
if (!under.length) fail(`the mode-2 probe at x8486..8736 fired nothing`);
if (under.some((v) => v.cel !== 20210 && v.cel !== 20211))
  fail(`0x46bdf0 tag 1 is 20210 and 20211; it showed ${[...new Set(under.map((v) => v.cel))].join(" ")}`);
const y0 = under[0].y;
const y1 = under[under.length - 1].y;
if (!(y1 < y0)) fail(`mode 2 starts 256 BELOW and rises; it went ${y0} -> ${y1}`);
ok(`...and a mode-2 probe sends the television up past you, y${y0} to y${y1}`);

/**
 * ...and `initwerec` THROWS.
 *
 * `0x452b20` is its own projectile creator and the shot it builds is a DUD:
 * `0x452c67` writes no strength, and cels 6004, 6005 and 6006 carry a strike
 * box with no blow pair. `0x452ec0` writes `0x65` as the burst script
 * `0x477c60` becomes the object's state, and only 7000, 7001 and 7002 carry
 * the `dx 43` that turns it into damage. So what this watches for is both
 * halves: a harmless flight, and a flash worth a hundred and one.
 *
 * The spot is the platform at y3731, x6916..7126, inside the rect of the
 * thrower whose point is x6579 (x6556..7174, y3415..3859). It drops to the
 * y4010 floor under its point and he stands about 380 across and above it —
 * `0x4524cc`'s row test is signed, so being ABOVE is still its own row, and
 * 220..450 is the throwing band (`0x452547`).
 */
await h.load("level=2&x=7000&y=3731&foehit=1");
h.frame(12);
const shots = new Set<string>();
for (let i = 0; i < 290; i++) {
  for (const c of game.casts) shots.add(`${game.castCel(c)}/${game.castBlow(c)}`);
  h.frame();
}
const flight = [...shots].filter((s) => Number(s.split("/")[0]) < 7000);
const burst = [...shots].filter((s) => Number(s.split("/")[0]) >= 7000);
if (!flight.length) fail(`initwerec should throw on its own row — 0x4527fd; nothing flew`);
if (flight.some((s) => s.split("/")[1] !== "0")) fail(`0x452c67 writes no strength, so the flight is a dud; it showed ${flight.join(" ")}`);
if (flight.some((s) => !["6004", "6005", "6006"].includes(s.split("/")[0])))
  fail(`0x477c38 is 6004, 6005 and 6006; the flight showed ${flight.join(" ")}`);
if (!burst.length) fail(`and it should BURST where it lands — 0x452e00 installs 0x477c60; it never did`);
if (burst.some((s) => s.split("/")[1] !== "101")) fail(`0x452ec0 writes 0x65 as the burst comes up; it showed ${burst.join(" ")}`);
ok(`and initwerec throws: ${flight.length} flight cels worth nothing, bursting into ${burst.length} worth 101`);

/**
 * ...and a crow BURNS, which is the eighth reader of the −9.
 *
 * `0x4519d8` writes `0x4520d0` into the `+0x12` of a class with no `init*`
 * string at all — CITY's own `0x451990` registers it — so the owner had to be
 * read off the descriptor. It is `initcrow`, and the chapter agrees: the
 * flamer is CITY's weapon and CITY is the level that perches twelve of these.
 *
 * The spot is the file's. A `statflamer` sits at x8899 on the platform that
 * runs x8791..8998, and the crow whose point is x9086 owns the rect
 * x8901..9271 — so standing on the pickup is inside it. A crow faces east
 * for good (`0x45095c`) and its flight pushes it WEST while the player is
 * less than 350 east of it (`0x451d70`), so it comes over and past the
 * pickup a hundred above the player's point, and the flame goes west to
 * meet it.
 *
 * What the arm does is a flame, `0x476e58` and nothing else: no damage, no
 * feathers. `0x451e5a` then ends those eight frames with gravity 1.0, the
 * tumble and the same eighty a punch pays.
 */
await h.load("level=2&x=8905&y=3600&weapon=10&rounds=120");
h.frame(10);
h.hold("down", true);
h.frame(12);
h.hold("down", false);
h.frame(4);
if (!game.inv.armed || game.inv.weapon !== 10) fail(`CITY's statflamer at x8899 should arm you: weapon ${game.inv.weapon}, armed ${game.inv.armed}`);
// up first, so the flame meets something that is flying rather than perched
if (h.until(() => !!flier(), 145) < 0) fail(`the crow at x9086 should wake and fly with the player inside its rect; ${crowSay()}`);
h.hold("left", true);
h.frame(1);
h.hold("left", false);
h.hold("punch", true);
const falling = () => crows().find((c) => c.state === "fall" && crowCel(c) >= 1884 && crowCel(c) <= 1887);
const litAt = h.until(() => !!falling(), 240);
const lit = crowSay();
const alight = game.flames.length;
h.hold("punch", false);
if (litAt < 0) fail(`-9 puts a crow on 0x476e58 — "fall", cels 1884..1887; ${crowSay()}`);
if (!alight) fail(`0x44ff20(self, 3, 0) should hang a flame on it; nothing is alight`);
ok(`the flamer sets a crow alight: ${lit}`);
const tumbling = () => crows().find((c) => c.state === "tumble" && crowCel(c) >= 1830 && crowCel(c) <= 1839);
if (h.until(() => !!tumbling(), 90) < 0) fail(`0x451e5a ends the fall in the tumble, 1830..1834; ${crowSay()}`);
ok(`...and the fall ends in the tumble: ${crowSay()}`);

pass(`CITY's planks give way, its crows wake and burn, its probes fire, its werecs throw and its first step is passable`);
