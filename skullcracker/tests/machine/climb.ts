/**
 * Can level one be finished?
 *
 *   npx tsx tests/machine/climb.ts        (from skullcracker/)
 *
 * Gravity is the port's invention and the ONLY one left — every animation script
 * in `SC.EXE` has been enumerated for vertical motion and the player's one
 * record is the launch, `dy -420`, with nothing anywhere that brings them down.
 * The launch, the lift, the climb and both ground speeds are the executable's.
 * WHAT they act on is entirely the disc's, and that is what this asserts. Every
 * number below is a literal out of `STREETS.SBK`:
 *
 *   - W is the RUN and the ladder and the jump's lift, all one flag
 *     (`[0x4ac3fe]`), while J is the jump: different keys in the original, from
 *     the binding table at 0x46b210 joined to the handlers at 0x402d54;
 *   - the street floor under x9700 is y1346;
 *   - `ladder` is the rect (732, 9632, 1223, 9779) with `param 35`, so the climb
 *     is fourteen rungs of 35px and tops out with the ANCHOR at 732, which puts
 *     the feet at 828 — the rect is in anchor space and a climb cel's anchor is at
 *     the hands, 96px above its own boots (see LADDER in src/game.ts);
 *   - `platform` (854, 9272, 901, 9700) is the roof beside the ladder's top,
 *     (980, 8768, 1016, 9273) the next one west, (895, 8251, 929, 8699) the one
 *     across the gap, and (1033, 7752, 1080, 8183) the last;
 *   - `goal` is (794, 7731, 1035, 7874), and the y1033 roof ends inside it.
 *
 * So the test walks STREETS' own route from the foot of its ladder to its goal
 * and checks the player's y against those numbers at every step. Nothing in the
 * port arranged that route: the ladder reaches the first roof, the roofs step
 * west, and the last one ends in the goal rect, all of it out of the file.
 *
 * The one place it is a game rather than a walk is the gap between the y980 roof
 * and the y895 one — 69px across and 85px UP, which has to be jumped from the
 * edge. 30px of early take-off turns a 69px crossing into a 98px one and the
 * apex arrives too late, so the take-off is found frame by frame.
 *
 * ## The route needs the run
 *
 * Two legs of it, and this is the test earning its keep. The launch reaches 77px
 * against the gap's 85, so W has to be held for the lift; and off the far roof's
 * west edge it is 68px of air to the next, which at the walk misses the roof
 * completely. The level is laid out for the run.
 *
 * ## The trap
 *
 * Height alone proves nothing: a game with no gravity at all would report the
 * spawn height forever and "the player is at y1346" would pass. So the first
 * two steps are the A/B — standing still must NOT change y (gravity does not
 * push a standing player through the floor), and a jump MUST, in the same
 * window, with no other input.
 */
import { fail, headless, ok, pass } from "./harness";

/** the foot of STREETS' one ladder */
const START = 9700;

const h = await headless(`level=1&x=${START}`);
const { game } = h;
const { p } = game;

const near = (got: number, want: number, slack = 4): boolean => Math.abs(got - want) <= slack;
const holdFor = (keys: ("up" | "down" | "left" | "right" | "jump")[], frames: number): void => {
  for (const k of keys) h.hold(k, true);
  h.frame(frames);
  for (const k of keys) h.hold(k, false);
};
/**
 * Wait out a jump: first for the player to LEAVE the ground, then to land.
 *
 * Both halves are needed. A standing jump spends its first frames crouched on
 * the floor, so a wait that only looks for the ground sees it already there
 * and returns before the player has left at all.
 */
const settle = (): void => {
  h.until(() => !p.onGround, 10);
  h.until(() => p.onGround, 200);
};

// the level's own cast: 21 of STREETS' init* records in the street room are
// kinds this port has cels for, and they come out of the book, not a list here
const mob = game.spawnedHere().length;
if (mob !== 21) fail(`STREETS' street should spawn 21, got ${mob}`);
ok(`the street spawns ${mob} of the level's own things`);

h.until(() => p.onGround, 30);
const floor = p.y;
if (!near(floor, 1346)) fail(`the street under x${START} should be y1346, got ${floor}`);
ok(`standing on the street at y ${floor}`);

// 1. gravity does not push a standing player anywhere
h.frame(18);
if (p.y !== floor) fail(`standing still moved the player to y ${p.y}`);
ok(`and stays there for 18 frames with no input`);

// 2. the same window, jumping — must leave the ground and come back to it.
// A standing jump is tag 2: three frames of crouch (250 251 252) BEFORE 253
// launches — so the whole flight is sampled for its highest point
h.hold("jump", true);
let apex = floor;
for (let i = 0; i < 12; i++) {
  h.frame();
  apex = Math.min(apex, p.y);
}
h.hold("jump", false);
if (apex >= floor) fail(`a jump did not leave the floor: y ${apex}`);
settle();
if (!near(p.y, floor)) fail(`after a jump, landed at y ${p.y} not ${floor}`);
ok(`a jump reaches y ${apex} and falls back to the street`);

// 3. the ladder lifts the player off the street to its own top rung, and puts
// them where the record says: x is `pointX` exactly, not the middle of the
// trigger rect
holdFor(["up"], 135);
const top = p.y;
if (!near(top, 828)) fail(`the ladder's top rung leaves the feet at y828; the climb reached ${top}`);
if (!near(p.x, 9714)) fail(`a ladder puts the player at its own pointX 9714; got x ${p.x}`);
ok(`climbed the ladder to its top rung, y ${top} at x ${p.x}`);

// 3b. at the top rung W installs NOTHING — `0x42afc4` skips its case whole
// when `[0x4ac406]` is 0 — so the cel holds and the tag does not flick
// between 0 and 1
h.hold("up", true);
const tags = new Set<number>();
for (let i = 0; i < 12; i++) {
  h.frame();
  if (!p.climbing) fail(`not climbing at the top: x ${p.x}, y ${p.y}`);
  tags.add(p.climbTag);
}
h.hold("up", false);
if (tags.size !== 1) fail(`the top rung should hold one tag with W down; saw ${[...tags].join(",")}`);
if (!near(p.y, 828)) fail(`W at the top rung moved the player to y ${p.y}`);
ok(`W at the top rung holds tag ${[...tags][0]} for 12 frames — no flicker`);

// 3b'. a jolt on the ladder is no jolt: `0x42ea3c` sees the ladder script
// and knocks him off instead (`0x42ea9c`, `[0x46b1bc]`), which the ladder
// state reads as a key at the end of the rung (`0x42ae6f`) — a hop off with
// nothing held, and the flag spent (`0x42aea1`)
holdFor(["down"], 18);
if (!p.climbing) fail(`should be on the ladder before the jolt; y ${p.y}`);
if (!game.takeCode(-2)) fail(`0x42ea9c answers 1 for a jolt on a ladder`);
if (p.act || !game.knockedOff) fail(`a jolt on a ladder installs nothing and knocks him off: act ${p.act}, flag ${game.knockedOff}`);
const hopped = h.until(() => !p.climbing, 12);
if (hopped < 0 || game.knockedOff) fail(`knocked off, he leaves the ladder at the end of the rung: ${hopped} frames, flag ${game.knockedOff}`);
settle();
ok(`a jolt on the ladder knocks him off ${hopped} frames later, and he lands at y ${p.y}`);
holdFor(["up"], 135);
if (!p.climbing) fail(`back up the ladder after the knock: y ${p.y}`);

// 3c. a direction takes you OFF, and off you stay until you land: `0x42ae98`
// sets `[0x46b1b8]` on the leave and `0x42849c` clears it on the ground, so
// W + D on a ladder is a hop east and a fall to the street, not a faster climb
holdFor(["down"], 18);
if (p.y <= 828 + 60) fail(`S should have taken rungs down from 828; y ${p.y}`);
holdFor(["up", "right"], 37);
settle();
if (p.climbing) fail(`W + D on the ladder should leave it, not climb it`);
if (!near(p.y, floor)) fail(`after hopping off, should be back on the street y${floor}; y ${p.y}`);
ok(`W + D hops off and falls to the street, y ${p.y} at x ${p.x}`);

// 3d. the run does not grab: `0x429872` asks for a ladder from the IDLE state
// only, and W is the run — so run west straight through x9632..9779
h.hold("up", true);
h.hold("left", true);
let grabbed = -1;
h.until(() => {
  if (p.climbing && grabbed < 0) grabbed = p.x;
  return p.x <= 9540;
}, 100);
h.hold("left", false);
h.hold("up", false);
if (grabbed >= 0) fail(`running past the ladder grabbed it at x ${grabbed}`);
h.frame(6);
if (p.x > 9540) fail(`never ran past the ladder; x ${p.x}`);
ok(`running through the ladder's rect with W held does not grab it, x ${p.x}`);

// 3e. standing still outside the standing cel's reach — its bitmap ends 57px
// east of the anchor and the rect starts at 9632 — W grabs nothing; from the
// foot, it does
const shy = p.x;
if (shy >= 9575) fail(`meant to stand short of the ladder's reach; x ${shy}`);
holdFor(["up"], 15);
if (p.climbing) fail(`W at x ${shy} grabbed a ladder 57px out of reach`);
ok(`W at x ${shy} grabs nothing — the standing cel does not reach the rect`);
h.hold("right", true);
h.until(() => p.x >= START, 100);
h.hold("right", false);
h.frame(6);
holdFor(["up"], 135);
if (!near(p.y, 828)) fail(`the second climb should top out at y828; got ${p.y}`);
ok(`and from the foot the same key climbs it again, y ${p.y}`);

// 4. stepping off west lands on the roof the file puts there
holdFor(["left"], 24);
h.frame(9);
if (!near(p.y, 854)) fail(`stepping off should land on the y854 roof; got y ${p.y}`);
ok(`stepped off onto the roof at y ${p.y}, x ${p.x}`);

// 5. and on west to the next platform, one the file puts 126px lower
h.hold("left", true);
h.until(() => p.x <= 9100, 200);
h.hold("left", false);
h.frame(9);
if (!near(p.y, 980)) fail(`the next roof west is y980; got y ${p.y}`);
ok(`and on west to y ${p.y}, x ${p.x}`);

/**
 * 6. the gap — and this is the leg that needs the game's own mechanic.
 *
 * 85px up, and the launch alone reaches 77: `dy -420` over the player's
 * divisor of 12 is 35px in one frame, and gravity — the one number `SC.EXE`
 * genuinely does not contain — is set from the engine's own vertical rate
 * rather than from whatever clears this gap. So W has to be HELD, which is
 * what `0x429f00` spends `0x4723f0` on: 10.4px a frame of extra lift while the
 * key is down, twice, and 77 + 21 clears 85.
 *
 * Holding W is also the run, which is the same key and no accident — a running
 * jump is how you cross this, and the jump script's tag 3 is the running
 * launch with `dx 95` where the standing one has `dx 0`.
 *
 * Approach at the WALK and only then hold W, and J is read by the engine
 * FRAME: the engine's run state does nothing with J in the air, so take off
 * short of the edge rather than on it.
 */
h.hold("left", true);
h.until(() => p.x <= 8800, 300);
const edge = p.x;
if (edge > 8830) fail(`never reached the roof's west edge; stopped at x ${edge}`);
const still = p.y;
if (!near(still, 980, 8)) fail(`walked off the roof before jumping: x ${edge}, y ${still}`);
h.hold("up", true);
h.hold("jump", true);
h.frame(1);
h.hold("jump", false);
settle();
// and W STAYS down for the rest of the route. Off the y895 roof's west edge
// it is 68px of air to the y1033 one, and at the walk that falls past the roof
// entirely; at the run the roof is where it should be
if (!near(p.y, 895, 6))
  fail(`the jump across the gap should land on y895; got y ${p.y}, x ${p.x} (took off from x ${edge}, y ${still})`);
ok(`jumped the gap from x ${edge} onto y ${p.y}`);

// 7. and on west, down the last roofs, into the goal rect.
//
//    Standing in it is arrival and not victory: the goal is shut until the
//    mission's share of STREETS is dead (src/mission.ts), and this test is about
//    the ROUTE — that the disc's own platforms lead from the ladder to the rect.
const inGoal = (): boolean => {
  const g = game.solids().goal;
  if (!g) return false;
  const b = game.playerBox();
  return b.right > g.left && b.left < g.right && b.bottom > g.top && b.top < g.bottom;
};
const arrived = h.until(() => inGoal() || game.craftOpened(), 360);
h.hold("left", false);
h.hold("up", false);
if (arrived < 0) fail(`never reached the goal; stopped at x ${p.x}, y ${p.y}`);
if (!near(p.y, 1033, 4)) fail(`the goal is entered from the y1033 roof; standing at y ${p.y}`);
ok(`reached the goal at x ${p.x}, y ${p.y} — the route through STREETS holds`);

pass("STREETS' goal can be walked to, and the way through is the level's own");
