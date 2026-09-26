/**
 * Day five, played: Blackbeard's island (bb1–bb2, disc 2), from Rockfish's dock
 * to the fight with Bone at the end of the mine.
 *
 * The day ends when Bone is down: benemy1.shop's `die` has Blackbeard ask his
 * questions (bbeard2b.pupp afterfight), plays `arrive.move` and calls
 * `advanceday ()`, whose day-five case opens Cartagena's lock. The way there,
 * as the scripts have it:
 *
 *   - **the lift** (bb1 Node18 facing 266°, bb2 Node10 facing 271° →
 *     elevator.stag): its handle, dragged through its slot (`pullTheHandle`).
 *   - **the drink**: Rockfish wants one mixed for Blackbeard (rock2a.pupp
 *     lounge, rockphase 1). Lyle, asked twice, gives sulphur
 *     (lylebbsulph.pupp); the charcoal bin by the dock a coal (charcoal.stag);
 *     the bar the rest (drink.stag, `mixTheDrink`). Carried back past Rockfish,
 *     the mug is tasted and taken up (bb2.sett openscene → rock2a.pupp drink).
 *   - **Blackbeard** comes down roaring (Denton's `rant`, bbeard2.pupp), drinks,
 *     tells of Marquez (BBStory.pupp) and passes out; Jan's men attack
 *     (`jansignal.move`), and Rockfish sends Nick to the mine carts (mc1).
 *   - **the mine** (mc1–mc3, ../mine.ts), the crash, Bone (bone2b.pupp), and the
 *     sword (bcombat.stag).
 */
import { fail, ok, type Headless } from "../harness";
import { duel } from "../fight";
import { rideTheMine } from "../mine";
import { ai, carry, clickOn, closeInventory, drag, openInventory, converse, findOnScreen, global, goTo, upFacing, walkUpTo } from "../route";

/**
 * The lift's handle (elevator.shop handle): held and moved, it steps its
 * `propdeg` along a slot — `movex` on 1–8 and 14–23 (the upper arm the other
 * way round), `movey` on 8–15 and 24–27 — and let go at 1 or 23 it sends the
 * lift to the first floor or the second (`elevate`). Each pass of its
 * `while stilldown ()` loop moves it a step for a pointer that moved.
 */
export async function pullTheHandle(h: Headless, moves: [dx: number, dy: number, n: number][]): Promise<void> {
  const at = findOnScreen(h, "handle", "prop") ?? fail("the handle is not on screen");
  let { x, y } = at;
  h.mouseDown(x, y);
  await h.frame(2);
  for (const [dx, dy, n] of moves) {
    for (let i = 0; i < n; i++) {
      x += dx;
      y += dy;
      h.session.setPointer(x, y);
      await h.frame(2);
    }
  }
  h.mouseUp(x, y);
  await h.frame(3);
}

/** the lift on its way (elevator.shop move → `whichset`), and a click on it once the rope stands idle closes it there */
async function rideTheLift(h: Headless, to: string): Promise<void> {
  const props = h.session.propRuntime;
  await h.until(() => global(h, "whichset") === to && props.get("rope")?.stateName === "idle" && h.running().length === 0, `the lift to ${to}`, 5_000);
  h.click(320, 240);
  // the stage closes after what it starts there: Rockfish's first word upstairs
  await h.until(() => h.room() === to && (h.session.stageName !== "elevator.stag" || h.host.director.awaitingChoice), `off the lift at ${to}`, 1_000);
}

/** the films played since log line `from`, by name */
export const films = (h: Headless, from: number): string[] =>
  h.logs.slice(from).filter((l) => l.startsWith("movie: ")).map((l) => l.split(" ")[1]);

/**
 * Blackbeard's drink (inven.shop `checkmix`): what went into the mug is counted
 * by ingredient against `001211112` — none of bottles 1 and 2, one of 3, two of
 * the salt (4), one each of 5, 6, the sulphur (7) and the coal (8), and two
 * pulls of ale (9, the spigot, drink.shop). A bottle is carried from the bar
 * and let go over the mug (`pour`, while the mug stands on the bar); the
 * sulphur and coal come out of the chest the same way; the ale runs while the
 * mug stands under the keg. Order does not matter, only the count.
 */
async function mixTheDrink(h: Headless): Promise<void> {
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

export async function playDay5(h: Headless): Promise<void> {
  // Rockfish at the dock (rock2a.pupp preelevator), asking as day five opens
  await converse(h, ["When can I see Blackbeard?", "Are you afraid of him?"], "Rockfish at the dock");
  ok("Rockfish at the dock");
  await goTo(h, "Node18");
  await upFacing(h, 266);
  await h.until(() => h.session.stageName === "elevator.stag" && h.running().length === 0, "the lift", 3_000);
  await pullTheHandle(h, [[-1, 0, 7], [0, -1, 7], [1, 0, 8]]);
  await rideTheLift(h, "bb2");
  await converse(h, ["What kind of drink?"], "Rockfish in the lounge");
  if ((await ai(h, "rockfish", "rockphase")) !== "1") fail("Rockfish asks for a drink (rockphase 1)");
  ok("up the lift to the lounge: Rockfish wants a drink mixed for Blackbeard");

  // Lyle and his sulphur pot (lylebbsulph.pupp): the first talk ends in
  // lylephase 1, and the second, now that Rockfish wants a drink, gives sulphur
  await walkUpTo(h, "lyle");
  await clickOn(h, "lyle", "actor");
  await converse(h, ["What are you doing?", "I don't want to know."], "Lyle at his sulphur pot");
  await clickOn(h, "lyle", "actor");
  await converse(h, ["Can I have some of your sulphur?"], "Lyle's sulphur");
  if (h.session.propRuntime.get("sulphur")?.owner !== "nick") fail("Lyle gives Nick sulphur");
  ok("Lyle gave Nick some of his sulphur");

  // the coal: down the lift (bb2.sett Node10 facing 271°) to the charcoal bin
  // by the dock (bb.shop charcoal bin → charcoal.stag), where a click on the
  // open bin takes a coal (charcoal.shop), and a second closes it
  await goTo(h, "Node10");
  await upFacing(h, 271);
  await h.until(() => h.session.stageName === "elevator.stag" && h.running().length === 0, "the lift", 3_000);
  await pullTheHandle(h, [[-1, 0, 8], [0, 1, 7], [1, 0, 7]]);
  await rideTheLift(h, "bb1");
  await h.settle("the dock");
  await clickOn(h, "charcoal bin", "prop");
  await h.until(() => h.session.stageName === "charcoal.stag" && h.running().length === 0, "the charcoal bin", 2_000);
  await clickOn(h, "bin", "prop");
  await h.until(() => h.session.propRuntime.get("coal")?.owner === "nick" && h.running().length === 0, "a coal", 500);
  // it waits in the middle of the screen until it is carried to the chest in
  // the corner (inven.shop stdmove: `mouseonchest`)
  await carry(h, "coal", { x: 80, y: 420 }, "prop");
  await h.until(() => h.running().length === 0, "the coal into the chest", 500);
  if (h.session.propRuntime.get("coal")?.stateName !== "chest") fail(`the coal goes into the chest; it is at ${h.session.propRuntime.get("coal")?.stateName}`);
  await clickOn(h, "bin", "prop");
  await h.until(() => h.session.stageName !== "charcoal.stag" && h.running().length === 0, "the bin to close", 2_000);
  ok("a coal from the charcoal bin on the dock");
  await goTo(h, "Node18");
  await upFacing(h, 266);
  await h.until(() => h.session.stageName === "elevator.stag" && h.running().length === 0, "the lift", 3_000);
  await pullTheHandle(h, [[-1, 0, 7], [0, -1, 7], [1, 0, 8]]);
  await rideTheLift(h, "bb2");
  await h.settle("the lounge");

  // the drink, behind the bar (bb2 Node17, drink.stag)
  await goTo(h, "Node17");
  await clickOn(h, "set drinks", "prop");
  await h.until(() => h.session.stageName === "drink.stag" && h.running().length === 0, "the bar", 2_000);
  await mixTheDrink(h);
  await clickOn(h, "ok", "prop");
  await h.until(() => h.session.stageName !== "drink.stag" && h.running().length === 0, "out from behind the bar", 1_000);
  ok(`Blackbeard's drink mixed: ${global(h, "themix")}`);

  // Rockfish tastes it as Nick comes back through Node15 with the mug and a new
  // mix (bb2.sett's openscene there: rock2a.pupp drink), and takes it up to
  // Blackbeard; Denton rants (bb.cast denton rant, pirate2.pupp) and Blackbeard
  // comes down to talk (bbeard2.pupp)
  await goTo(h, "Node15");
  let from = h.logs.length;
  await converse(
    h,
    [
      "I hope so, I really need to see him.", "Yes, I made it.", "I'm Nick Dove.", "It's true.",
      "He told me to look for you.", "They carry scimitars.", "It's not your fault.",
      "Do you think RedJack will really come back?",
    ],
    "Denton and Blackbeard",
    { thenAsks: true },
  );
  // his story ends with him out cold on the table (BBStory.pupp: endstory.move,
  // `passedout`), and the attack: jansignal.move, Rockfish's "You take the
  // minecar!" (rock2a.pupp attack) and the mine (safe turner minecar → mc1.sett)
  await h.until(() => h.room() === "mc1" && (h.idle() || h.host.director.awaitingChoice), "the mine carts", 5_000);
  const played = films(h, from);
  for (const film of ["endstory.move", "jansignal.move"]) if (!played.includes(film)) fail(`Blackbeard's story plays ${film}; it played ${played.join(", ")}`);
  ok(`Blackbeard drank, told his story and passed out; the attack sent Nick to the mine carts (${[...new Set(played)].join(", ")})`);

  // the mine carts, three sets of Jan's men, and the crash (mine.shop nextset:
  // nikcrash.move, and Bone there, bone2b.pupp)
  from = h.logs.length;
  const shots = await rideTheMine(h, () => h.owner() === "puppet" || h.host.director.awaitingChoice || h.session.stageName === "bcombat.stag");
  const rode = films(h, from);
  for (const film of ["minecart2.move", "minecart3.move", "nikcrash.move"]) if (!rode.includes(film)) fail(`the mine plays ${film}; it played ${rode.join(", ")}`);
  ok(`rode the mine carts through three sets of Jan's men in ${shots} harpoons, hit ${global(h, "nickhits")} times`);

  // Bone, and the sword (bdraw.move, bcombat.stag, bCombat.shop and benemy1.shop)
  await converse(h, ["I'm going to kill you."], "Bone at the crash");
  await h.until(() => h.session.stageName === "bcombat.stag" && h.running().length <= 1, "the fight with Bone", 20_000);
  from = h.logs.length;
  await duel(h, "bcombat.stag", "the fight with Bone");
  // Blackbeard comes down (bbeard2b.pupp afterfight), and the day ends:
  // arrive.move and advanceday, which opens Cartagena's lock (lock1, disc 2)
  await converse(h, ["Who are they?", "What now?"], "Blackbeard after the fight", { thenAsks: true });
  await h.until(() => global(h, "day") === "6" && (h.idle() || h.host.director.awaitingChoice), "day six", 20_000);
  const ended = films(h, from);
  if (!ended.includes("arrive.move")) fail(`the day ends on arrive.move; it played ${ended.join(", ")}`);
  ok(`beat Bone in the mine, and Blackbeard sends Nick to Cartagena (${[...new Set(ended)].join(", ")}): day six at ${h.room()}`);
}
