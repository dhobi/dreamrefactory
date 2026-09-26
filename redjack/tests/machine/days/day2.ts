/**
 * Day two, played: aboard the Marauder, from the crate Justice finds Nick in to
 * the talk in his cabin that sails her to Port Royal.
 *
 * The day ends when Justice, in his cabin, reaches `protect ()` (justice1b.pupp
 * sets `justphase` 2), and his `mousedown` then plays `montage.move` and calls
 * `advanceday ()` (ship.cast, justice). What stands in the way, as the scripts
 * have it:
 *
 *   - **the cabin door** (ship.sett quad "door s2c", Node16) opens only once
 *     the cannons have been tried (`didcannon`) and Sullivan has been met
 *     (`actorvalue ("anne") > 0`);
 *   - **Sullivan** is met through Lyle: lyle1b.pupp `ondeck` → `met` →
 *     `sullivan` calls her over and hands the talk to anne1.pupp, and adds one to
 *     her `actorvalue`;
 *   - **the cannons** are tried by opening cannon.sett at all — its `openset`
 *     sets `didcannon` — and the quad "cannons" at Node18 opens it, after Lyle's
 *     word on them. The route plays them out (`cannons.ts`): four dinghies sunk.
 */
import { fail, ok, type Headless } from "../harness";
import { sinkTheDinghies } from "../cannons";
import { ai, clickOn, converse, global, goTo, walkUpTo } from "../route";

/** day two from Justice's first question to day three's first, each step checked as it goes */
export async function playDay2(h: Headless): Promise<void> {
  // the stowaway, found: justice1b.pupp stowaway → setsail. "I do." sets
  // justphase 1 and sends Justice down to his cabin (setupactor "cabin")
  await converse(
    h,
    ["I really want to join your crew.", "Two men in black robes with scimitars.", "I do."],
    "Justice finds the stowaway",
  );
  if ((await ai(h, "justice", "justphase")) !== "1") fail(`the oath sets justphase 1; it is ${await ai(h, "justice", "justphase")}`);
  // advanceday's `sendtocast ("ship", initactors ())` puts the crew on deck —
  // the cast, not ship.sett, whose main script shares its name
  const crew = ["lyle", "bone", "cross", "anne"];
  const missing = crew.filter((a) => !h.session.actorRuntime.get(a)?.visible);
  if (missing.length) fail(`the crew is on deck; ${missing.join(", ")} not`);
  ok(`sworn in on the ship (justphase 1), the crew on deck: ${crew.join(", ")}`);

  // Lyle, by the cannons: ondeck → met → sullivan, who is Anne, and her own
  // anne1.pupp talk — the letter from her father among it (letter.move waits
  // for a click on its corner)
  await goTo(h, "Node18");
  await clickOn(h, "lyle");
  await converse(
    h,
    [
      "I feel fine.", "No, introduce me.",
      // anne1.pupp, as Sullivan
      "Hello.", "So far.", "Why did you join up?", "What do you mean?", "Snuck on in a crate.",
      "Why do you ask?", "No.", "OK, you go first.", "Really?", "Why did you have to get on the ship?",
      "Is he a pirate?", "Tell me more.", "That letter was written to your mother?", "How did she die?",
      "Is her husband still alive?", "I don't have one.",
    ],
    "Lyle, and Sullivan",
  );
  if ((await ai(h, "nick", "metanne")) !== "1") fail("anne1.pupp ship sets metanne");
  if ((await ai(h, "anne", "annephase")) !== "2") fail(`the letter sets annephase 2; it is ${await ai(h, "anne", "annephase")}`);
  if (Number(h.session.actorRuntime.get("anne")?.value) < 1) fail("Lyle's introduction adds to Anne's actorvalue");
  ok("met Sullivan through Lyle, and read her father's letter (metanne 1, annephase 2)");

  // the cannons: the quad at Node18, Lyle's word on them, and cannon.sett,
  // whose openset sets didcannon. Four dinghies circle the ship, and sinking
  // them all ends the game (cannon.cast endanim → endcannon → ship.sett Node18);
  // `ok` would give up instead
  await clickOn(h, "cannons");
  await converse(h, [], "Lyle on the cannons");
  await h.until(() => h.room() === "cannon" && h.running().length === 0, "the cannon room", 5_000);
  if ((await ai(h, "nick", "didcannon")) !== "1") fail("cannon.sett openset sets didcannon");
  const shots = await sinkTheDinghies(h);
  await h.until(() => h.room() === "ship" && h.idle(), "back on deck from the cannons", 5_000);
  ok(`sank the four dinghies in ${shots} shots (didcannon 1), and back on deck at ${h.node()}`);

  // the cabin: door s2c at Node16 lets Nick down now (ship.sett quad script),
  // to capts.sett Node10, where Justice waits
  await goTo(h, "Node16");
  await clickOn(h, "door s2c");
  await h.until(() => h.room() === "capts" && h.idle(), "Justice's cabin", 5_000);
  ok(`down in Justice's cabin (${h.room()}/${h.node()})`);

  // Justice, at his desk across the cabin: incabin → brethren → later → protect sets justphase
  // 2, and the day ends — montage.move, then advanceday opens Port Royal with
  // justice2.pupp asking
  const films = h.logs.length;
  await walkUpTo(h, "justice");
  await clickOn(h, "justice");
  await converse(
    h,
    ["Tell me about the Brethren.", "Some old man.", "What's different?", "How many Brethren are left?", "Do you protect it?"],
    "Justice in his cabin",
    { thenAsks: true },
  );
  await h.until(
    () => global(h, "day") === "3" && h.room() === "ptroyal" && h.host.director.awaitingChoice,
    "day three, at Port Royal",
    20_000,
  );
  const played = h.logs.slice(films).filter((l) => l.startsWith("movie: ")).map((l) => l.split(" ")[1]);
  if (!played.includes("montage.move")) fail(`the voyage plays montage.move; it played ${played.join(", ")}`);
  ok(`sailed to Port Royal (${played.join(", ")}): day three begins with Justice asking`);
}
