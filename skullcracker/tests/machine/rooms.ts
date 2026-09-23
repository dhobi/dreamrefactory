/**
 * Do the level's own rooms hold, and how is a door taken?
 *
 *   npx tsx tests/machine/rooms.ts        (from skullcracker/)
 *
 * The rooms and the door between them are read off STREETS.SBK — the street is
 * `newroom` param 3, the basement below it `newroom` param 1, and the `exitroom`
 * at x4522…4767 in the street carries param 1. `engine/tests/sbk.ts` asserts
 * that binding across all sixteen books; what it cannot assert is what happens
 * when a player reaches one.
 *
 * ## What went wrong twice, and is asserted here
 *
 * Two builds triggered a door by TOUCHING it. Plain contact bounced the player
 * between the two rooms for as long as an arrow was held. Contact plus the
 * direction the door's stored point implies stopped the bouncing and trapped the
 * player in the basement instead — and that one shipped for an afternoon before
 * someone walked right from the spawn and could not get back out.
 *
 * The file says why neither can be right. STREETS' street door stands between
 * the spawn at x1840 and the goal at x7731, so walking right always enters it;
 * and the arrival point beside it is x4775, **eight pixels** past its right edge,
 * against a player about a hundred pixels wide. You come out of every door still
 * standing in it. So the first assertion here is the negative one: walking
 * through a door does nothing at all.
 */
import { fail, headless, ok, pass } from "./harness";

/** short of the street door at x4522 */
const START = 4300;

// no creatures: STREETS' werewolves stand in the way east of the spawn, and
// since `bodyPush` (0x430680) their weight shoves the player back as they
// walk, so the walk measured the fight rather than the doors
const h = await headless(`level=1&x=${START}&foes=0`);
const { game } = h;
const { p } = game;

const room = (): string => (p.room ? `${p.room.name}/p${p.room.param}` : "nowhere");
/** the player's box overlapping one of the room's exits — where a press would take it */
const inDoorway = (): boolean => {
  const b = game.playerBox();
  return (
    p.room?.exits.some((e) => b.right > e.left && b.left < e.right && b.bottom > e.top && b.top < e.bottom) ?? false
  );
};
/** hold a key until x passes `to`, then let the slide finish */
const walkTo = (key: "left" | "right", to: number): void => {
  h.hold(key, true);
  h.until(() => (key === "left" ? p.x <= to : p.x >= to), 150);
  h.hold(key, false);
  // a walk is a velocity the ground drags down over three frames (12, 4, 1),
  // and a door taken mid-slide arrives mid-slide
  h.frame(4);
};
const tapUp = (): void => {
  h.hold("up", true);
  h.frame(1);
  h.hold("up", false);
  h.frame(4);
};

if (room() !== "newroom/p3") fail(`expected to start in the street, got ${room()}`);
ok(`starts in the street at x ${p.x}`);

// 1. walking through the door must do NOTHING — this is the trap regression
walkTo("right", 5100);
if (room() !== "newroom/p3") fail(`walking through the door teleported to ${room()}`);
if (p.x < 5000) fail(`the walk east stopped at x ${p.x}, short of the door's far side`);
ok(`walked straight through the door to x ${p.x}, still in the street`);

// 2. and standing in the doorway, a press would take it
walkTo("left", 4650);
if (!inDoorway()) fail(`standing at x ${p.x}, the player is not in the doorway`);
ok(`standing in the doorway at x ${p.x}`);

// 3. pressing up takes it: the door back's point goes into the ANCHOR, x4395
//    y2667 (`0x428fdb`), and the player drops the 28px from there onto the
//    basement floor at y2785. An arrival that is merely "somewhere in the
//    basement" would mean the keypress that opened the door also jumped,
//    which is what it used to do.
h.hold("up", true);
h.frame(1);
h.hold("up", false);
if (room() !== "newroom/p1") fail(`pressing up gave ${room()}, wanted the basement`);
if (p.onGround || Math.round(p.y - p.feet) > 2667 + 10)
  fail(`a door puts the anchor on its point and drops the player (0x428fdb); arrived at y ${p.y}, ${p.onGround ? "standing" : "falling"}`);
h.frame(4);
if (Math.round(p.x) !== 4395) fail(`arrived at x ${p.x}, not beside the door back at 4395`);
if (Math.round(p.y) !== 2785) fail(`arrived at y ${p.y}, not standing on the basement floor at 2785`);
ok(`pressing up went to the basement, x ${p.x}, y ${p.y}`);

// 4. and holding up does not immediately bounce back out again
h.hold("up", true);
h.frame(18);
h.hold("up", false);
if (room() !== "newroom/p1") fail(`holding up bounced back to ${room()}`);
ok(`holding up for 18 frames does not bounce back out`);

// 5. the way back, which is the door in the basement
walkTo("right", 4600);
tapUp();
if (room() !== "newroom/p3") fail(`the door back gave ${room()}, wanted the street`);
// x4775 is the street door's own point, y1363 the pavement under it
if (Math.round(p.x) !== 4775) fail(`came back to x ${p.x}, not the door's point 4775`);
if (Math.round(p.y) !== 1363) fail(`came back at y ${p.y}, not standing on the pavement at 1363`);
ok(`and back into the street at x ${p.x}, y ${p.y}`);

pass("STREETS' two rooms, and a door you have to mean");
