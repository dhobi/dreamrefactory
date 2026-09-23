/**
 * CITY's elevators — the five that are the only way into the top of level two.
 *
 *   npx tsx tests/machine/lift.ts        (from skullcracker/)
 *
 * Level two has no `ladder` record, its goal sits at y1802, and the walk east
 * along the rooftops tops out around y3590. Before `initelevator` was read out of
 * `SC.EXE`, 45 of CITY's 73 platforms were reachable and the goal was not one of
 * them; with the five cars every platform in the book is on the route.
 *
 * What the file says, and what this checks:
 *
 *   - **a car owns its landing.** `0x450dc0` calls `0x42fb70`, the plank's "claim
 *     the platform containing my point", and it lands five times out of five once
 *     the point is taken at the SHAFT'S BOTTOM rather than at the record's stored
 *     point (which is the shaft's middle and is inside nothing). The five it
 *     claims — #53, #54, #55, #79, #103 — are the only platforms in CITY between
 *     120 and 135 pixels wide, one per lift.
 *   - **four pixels an engine frame.** `mov word ptr [esp+8], 0x28` at `0x45351f`
 *     over the class's own divisor of ten (`obj+0xe = 0xa`), which is not the
 *     player's twelve.
 *   - **the rider comes with it**, because the car moves the platform record and
 *     the walk's own "follow the floor" allows more climb per tick than the car
 *     makes.
 *   - **it runs on its own.** `obj+0x46`, which every state waits on, is written
 *     only by the animation stepper and means "my script ended" — so a car
 *     leaves when its eighteen idle frames run out, rider or no rider.
 */
import { ELEVATOR, elevatorCel } from "../../src/props";
import { FPS, fail, headless, ok, pass } from "./harness";

// CITY's ground is the void, so ?x= alone is a death: every stop names its y
const h = await headless("level=2&x=7164&y=3979&foes=0");
const { game } = h;
const at = (): { x: number; y: number } => ({ x: Math.round(game.p.x), y: Math.round(game.p.y) });

// 1. the level places five, and every one of them found a landing to own
h.frame(9);
const cars = game.elevatorsHere();
if (cars.length !== 5) fail(`CITY places five initelevator records; the room holds ${cars.length}`);
ok(`CITY's five cars are on their landings: ${cars.map((e) => `y${Math.round(e.floor.top)}`).join(", ")}`);

/**
 * The car is TWO cels with the rider between them, and the WINCH above it is
 * the one with the script.
 *
 * `obj+0 = 0x47e` at `0x4533c3` is the object's base cel, and reading that as
 * "the car" gave this one cel for a long time. The class's own collector
 * ignores `obj+0` and picks by its argument — `0x45332e` queues `0x47f` (1151)
 * for 0 and `0x45334a` queues `0x47e` (1150) for 1 — and CITY's frame function
 * calls it once each way with the PLAYER queued between them (`0x4517ad`,
 * `0x402980`, `0x4517ed`). So 1151 is the cage's back wall and 1150 its front:
 * 113x190 at 73% opaque against 106x314 at 42%, a frame with a hollow middle
 * and a mesh across its lower front. Drawing 1150 alone, and before the
 * player, put his boots over the mesh he should be standing behind.
 */
if (ELEVATOR.car.back !== 1151) fail(`the cage's BACK is cel 1151 (0x45332e's 0x47f); got ${ELEVATOR.car.back}`);
if (ELEVATOR.car.front !== 1150) fail(`its FRONT is cel 1150 (0x45334a's 0x47e); got ${ELEVATOR.car.front}`);
for (const e of cars) {
  const w = elevatorCel(e);
  if (w < 1160 || w > 1163) fail(`a winch should draw from 0x477db0's 1160..1163; got ${w}`);
}
ok(`each is the cage 1151 behind and 1150 in front, with a winch from 0x477db0's 1160..1163 above it`);

// 2. the car departs on its own — tag 0 is eighteen frames, then it goes —
//    and a rider on the landing goes up with it. A few pixels of slack: the car
//    starts the moment the player is on it
const boarded = at();
if (Math.abs(boarded.y - 3979) > 12) fail(`should be on platform #103 at y3979; got y ${boarded.y}`);
h.frame(37);
const risen = at();
if (risen.y >= boarded.y - 40) fail(`the car should have carried the player up; y went ${boarded.y} to ${risen.y}`);
if (risen.x !== boarded.x) fail(`a ride is vertical; x went ${boarded.x} to ${risen.x}`);
ok(`the car departs of itself and the rider goes with it: y ${boarded.y} to ${risen.y}`);

// 3. `0x28` over the divisor of 10 is an IMPULSE of 4 a frame into obj+0xa,
//    and up is clamped at 13 (`0x4535f2`): 195 pixels a second at 15 frames
const a = at();
h.frame(FPS);
const b = at();
const rate = a.y - b.y;
if (rate !== 195) fail(`the car should climb 195px a second (13 a frame, 0x4535f2); measured ${rate}`);
ok(`and it climbs at ${rate}px a second, 0x4535f2's 13 a frame`);

// 4. it stops 200px SHY of the head of its shaft — `add ecx, 0xc8` at 0x453606,
// which is the winch's room and not travel. Running to the top of the rect
// instead overshoots every lift in the level by exactly that much.
const ride = cars.find((e) => game.ridingElevator(e));
if (!ride) fail(`the player should be riding #102`);
if (h.until(() => ride!.state !== "up" && ride!.state !== "starting", 150) < 0) fail(`the car never finished its climb (${ride!.state})`);
h.frame(2);
const top = at();
if (Math.abs(top.y - 3223) > 8) fail(`elevator #102 should stop at y3223 (top 3038 + 200, less the deck's 15); it stopped at ${top.y}`);
// and it does NOT wait for anyone: tag 0 is eighteen frames of 1160 and then
// `0x453490` sends it back the way it came, rider or no rider
h.frame(7);
const pausing = at();
if (pausing.y !== top.y) fail(`the car should pause at the head for its idle tag; it moved from ${top.y} to ${pausing.y}`);
// eighteen frames of rest and twelve of wind-up (tag 1, four cels at three);
// then it goes down at up to 90 a second (`0x453538`'s 6)
h.frame(36);
const returning = at();
if (returning.y <= top.y + 20) fail(`after its 18-frame pause the car should head back down on its own; it is still at ${returning.y}`);
ok(`it stops 200px shy of the shaft's head at y ${top.y}, pauses its 18 frames, and returns on its own (y ${returning.y})`);

// 5. the one that matters: #78 carries you to the goal's own platform
await h.load("level=2&x=8613&y=2548&foes=0");
h.frame(9);
if (h.until(() => game.p.y <= 2060, 150) < 0) fail(`#78 never lifted the player to y2060; at y ${at().y}`);
h.hold("right", true);
h.until(() => game.p.x > 8700, 60);
h.hold("right", false);
h.frame(10);
const goal = at();
if (!(goal.y >= 2016 && goal.y <= 2032 && goal.x > 8676)) {
  fail(`riding #78 should put the player on platform #108 (y2024, east of x8676); got x ${goal.x}, y ${goal.y}`);
}
ok(`and #78 delivers the player onto the goal's platform at x ${goal.x}, y ${goal.y}`);

pass(`CITY's five lifts carry their riders, and the top of level two can be entered`);
