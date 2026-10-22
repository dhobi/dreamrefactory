/**
 * Blackbeard's island (bb1–bb2, day five): the lift between the dock and the
 * lounge, and the drink Rockfish wants mixed for Blackbeard.
 */
import { fail, type Player } from "./player";
import { ai, carry, clickOn, closeInventory, drag, findOnScreen, global, openInventory } from "./route";

/**
 * The lift's handle (elevator.shop handle): held and moved, it steps its
 * `propdeg` along a slot — `movex` on 1–8 and 14–23 (the upper arm the other
 * way round), `movey` on 8–15 and 24–27 — and let go at 1 or 23 it sends the
 * lift to the first floor or the second (`elevate`). Each pass of its
 * `while stilldown ()` loop moves it a step for a pointer that moved.
 */
export async function pullTheHandle(h: Player, moves: [dx: number, dy: number, n: number][]): Promise<void> {
  const at = findOnScreen(h, "handle", "prop") ?? fail("the handle is not on screen");
  let { x, y } = at;
  h.mouseDown(x, y);
  await h.frame(2);
  for (const [dx, dy, n] of moves) {
    for (let i = 0; i < n; i++) {
      x += dx;
      y += dy;
      h.point(x, y);
      await h.frame(2);
    }
  }
  h.mouseUp(x, y);
  await h.frame(3);
}

/** the lift on its way (elevator.shop move → `whichset`), and a click on it once the rope stands idle closes it there */
export async function rideTheLift(h: Player, to: string): Promise<void> {
  const props = h.session.propRuntime;
  await h.until(() => global(h, "whichset") === to && props.get("rope")?.stateName === "idle" && h.running().length === 0, `the lift to ${to}`, 5_000);
  h.click(320, 240);
  // the stage closes after what it starts there: Rockfish's first word upstairs
  await h.until(() => h.room() === to && (h.session.stageName !== "elevator.stag" || h.host.director.awaitingChoice), `off the lift at ${to}`, 1_000);
}

/** the handle's way through its slot to each floor: up to the lounge (bb2), down to the dock (bb1) */
const SLOT: Record<string, [dx: number, dy: number, n: number][]> = {
  bb2: [[-1, 0, 7], [0, -1, 7], [1, 0, 8]],
  bb1: [[-1, 0, 8], [0, 1, 7], [1, 0, 7]],
};

/** the lift stage open (elevator.stag), the handle pulled to `to`'s end of its slot, and off there */
export async function takeTheLift(h: Player, to: string): Promise<void> {
  const slot = SLOT[to] ?? fail(`the lift goes to bb1 or bb2, not ${to}`);
  await h.until(() => h.session.stageName === "elevator.stag" && h.running().length === 0, "the lift", 3_000);
  await pullTheHandle(h, slot);
  await rideTheLift(h, to);
}

/**
 * Blackbeard's drink (inven.shop `checkmix`): what went into the mug is counted
 * by ingredient against `001211112` — none of bottles 1 and 2, one of 3, two of
 * the salt (4), one each of 5, 6, the sulphur (7) and the coal (8), and two
 * pulls of ale (9, the spigot, drink.shop). A bottle is carried from the bar
 * and let go over the mug (`pour`, while the mug stands on the bar); the
 * sulphur and coal come out of the chest the same way; the ale runs while the
 * mug stands under the keg. Order does not matter, only the count.
 */
export async function mixTheDrink(h: Player): Promise<void> {
  for (const b of ["3", "4", "4", "5", "6"]) {
    await drag(h, b, "mug", "button");
    await h.until(() => h.running().length === 0, `bottle ${b} poured`, 1_000);
  }
  await openInventory(h);
  for (const c of ["sulphur", "coal"]) {
    await drag(h, c, "mug", "button");
    await h.until(() => h.running().length === 0, `the ${c} in`, 1_000);
  }
  await closeInventory(h);
  const props = h.session.propRuntime;
  await drag(h, "dmug", "keg", "button");
  if (props.get("dmug")?.stateName !== "keg") fail(`the mug goes under the keg; it is at ${props.get("dmug")?.stateName}`);
  for (let i = 0; i < 2; i++) {
    await clickOn(h, "spigot", "prop");
    await h.until(() => h.running().length === 0 && props.get("spigot")?.stateName === "closed", "the ale to run", 1_000);
  }
  if ((await ai(h, "nick", "mixdrink")) !== "1") fail(`the drink is mixed right (mixdrink); it holds ${global(h, "themix")}`);
  // the mug, full, into the chest (inven.shop dmug: `mouseonchest`)
  await carry(h, "dmug", { x: 80, y: 420 }, "prop");
  await h.until(() => h.running().length === 0, "the mug into the chest", 500);
  if (props.get("dmug")?.owner !== "nick") fail("Nick has the drink");
}
