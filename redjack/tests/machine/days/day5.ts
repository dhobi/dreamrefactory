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
 *     elevator.stag): its handle, dragged through its slot (`pullTheHandle`, src/play/bbisland.ts).
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
import { duel } from "../../../src/play/fight";
import { rideTheMine } from "../../../src/play/mine";
import { mixTheDrink, takeTheLift } from "../../../src/play/bbisland";
import { ai, carry, clickOn, converse, global, goTo, upFacing, walkUpTo } from "../../../src/play/route";

/** the films played since log line `from`, by name */
export const films = (h: Headless, from: number): string[] =>
  h.logs.slice(from).filter((l) => l.startsWith("movie: ")).map((l) => l.split(" ")[1]);

export async function playDay5(h: Headless): Promise<void> {
  // Rockfish at the dock (rock2a.pupp preelevator), asking as day five opens
  await converse(h, ["When can I see Blackbeard?", "Are you afraid of him?"], "Rockfish at the dock");
  ok("Rockfish at the dock");
  await goTo(h, "Node18");
  await upFacing(h, 266);
  await takeTheLift(h, "bb2");
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
  await takeTheLift(h, "bb1");
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
  await takeTheLift(h, "bb2");
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
