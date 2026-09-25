/**
 * Day one, played: Hangman's Reef at night, from the first room to the crate
 * that carries Nick onto the Marauder.
 *
 *   npx tsx tests/machine/day1.ts        (from redjack/)
 *
 * The day ends when `crate.stag`'s inside is clicked: `incrate.move`,
 * `loadship.move`, `setai ("stowed", "1")` and `advanceday ()`. What stands in
 * the way, as the scripts have it:
 *
 *   - **Bone** guards the crates (`the crate` sends a click to him while he is
 *     visible). His third talk sends him and Cross to the ship, and it needs
 *     his second (`bonephase` 1 → 2), which needs Lyle's `lylephase` > 0
 *     (bone1.pupp, day1.run).
 *   - **the charcoal** that marks the crate is in the fire pit, and the pit is
 *     only open once the fire is out (`lpfirepit`, `alephase` != 0), which is
 *     Lyle's doing after he saves Nick from Jan (liznite Node54, `savednick`).
 *
 * Each step checks the flag the script it cites sets, so a route that goes
 * wrong says where.
 */
import { fail, headless, ok, pass } from "./harness";
import { ai, clickOn, converse, face, goTo, waitNear } from "./route";

const h = await headless();
await h.until(() => h.room() === "liznite" && h.owner() === "world", "the first room", 60_000);
await h.settle("the first room");
ok("liznite, Node52");

// Bone, by the crates: bone1.pupp day1 meetbone → pockets → seenlyle → elizabeth
await goTo(h, "Node48");
await clickOn(h, "bone");
await converse(h, ["Who are you?", "My pockets are empty.", "No sir.", "I don't know her."], "meeting Bone");
if ((await ai(h, "bone", "bonephase")) !== "1") fail(`Bone's first talk ends in bonephase 1; it is ${await ai(h, "bone", "bonephase")}`);
ok("met Bone (bonephase 1)");

// Lyle, on the beach: Node58's openscene has him jump Nick the first time
await goTo(h, "Node58");
await converse(h, ["Who are you?", "All right then.", "Nick.", "Were you left behind", "Goodbye."], "meeting Lyle");
if ((await ai(h, "nick", "metlyle")) !== "1") fail("Lyle's intro sets metlyle");
ok(`met Lyle on the beach (metlyle 1, janstalk ${await ai(h, "nick", "janstalk")})`);

// Jan, in the woods: Node54's openscene plays jansave.move once Lyle is met, and
// Lyle's "savednick" puts the fire out (alephase 1, lpfirepit "off")
await goTo(h, "Node54");
await converse(
  h,
  ["Who was that?", "I could have taken care of myself.", "Can you teach me how to fight?",
    "Tell me what else you know.", "Can you tell me where to get a sword?", "I'll bring you some ale."],
  "Lyle saves Nick",
);
if ((await ai(h, "lyle", "alephase")) !== "1") fail(`savednick sets alephase 1; it is ${await ai(h, "lyle", "alephase")}`);
if (h.session.propRuntime.get("lpfirepit")?.stateName !== "off") fail(`the fire is still ${h.session.propRuntime.get("lpfirepit")?.stateName}`);
ok("Lyle saved Nick from Jan and the fire is out (alephase 1)");

// the bar: knock at Node37 (liznite quad "door l2b"), and the bartender's
// door1.pupp lets Nick in (bartendphase 1, gotonode bar.sett scene34)
await goTo(h, "Node37");
await clickOn(h, "door l2b");
await converse(h, ["I want to come inside."], "the bartender's door");
if (h.room() !== "bar") fail(`the door opens onto bar.sett; we are in ${h.room()}/${h.node()}`);
ok(`in the bar at ${h.node()} (bartendphase ${await ai(h, "bartend", "bartendphase")})`);

// the bartender inside (bar1.pupp inbar): the mug of ale for Lyle, then
// Captain Justice (justice1.pupp)
// gang.cast hotdist: 1100000 in the bar; only Scene35 is that near his stars
await goTo(h, "Scene35");
await face(h, "bartend");
await waitNear(h, "bartend", 1_100_000);
await clickOn(h, "bartend");
await converse(
  h,
  ["Where's all the action?", "Could I have a mug of ale?", "Thanks for letting me in.",
    "Have you seen anyone strange", "Introduce me.",
    // justice1.pupp bar → occupation → job → hire → useful: a sword, a fight and the shark
    "Yes, I came to get an ale", "I'm an aspiring pirate.", "Do you need men on your pirate ship?",
    "What does a person have to do", "I want to join your crew.", "A sword and experience.",
    "How long will you be here?"],
  "the bartender and Justice",
);
if (h.session.propRuntime.get("mug")?.owner !== "nick") fail(`the bartender gives Nick the mug; it is ${h.session.propRuntime.get("mug")?.owner}`);
ok(`the mug of ale, and Captain Justice met (justphase ${await ai(h, "justice", "justphase")})`);

// back out to the town (bar.sett quad "door b2l" at Scene34 → liznite Node37)
await goTo(h, "Scene34");
await clickOn(h, "door b2l");
await h.settle("leaving the bar");
if (h.room() !== "liznite") fail(`the bar door opens onto liznite; we are in ${h.room()}`);
ok("back in town");

// the ale to Lyle, who waits in the woods by Node54 after the rescue
// (lyle1.pupp ale: the mug goes to him, alephase 2, and he is off to the dock)
await goTo(h, "Node54");
await face(h, "lyle");
await waitNear(h, "lyle", 65_000); // gang.cast hotdist in liznite
await clickOn(h, "lyle");
await converse(h, [], "the ale for Lyle");
if ((await ai(h, "lyle", "alephase")) !== "2") fail(`the ale sets alephase 2; it is ${await ai(h, "lyle", "alephase")}`);
if (h.session.propRuntime.get("mug")?.owner !== "lyle") fail(`the mug goes to Lyle; it is ${h.session.propRuntime.get("mug")?.owner}`);
ok("Lyle has his ale (alephase 2) and will teach Nick on the dock");

pass("day1");
