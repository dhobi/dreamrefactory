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
import { fightLyle, fighting, schoolOfDefense, schoolOfDodging, schoolOfStriking } from "./fight";
import { ai, clickOn, converse, drag, face, global, goTo, waitNear } from "./route";

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

// the sword: Lyle's "a cave, underneath the lighthouse". liznite Node36's
// "door l2lh" → lhouse.sett; "door lh2c" at Node11 plays downcave.move into
// rjcave.sett; the "chest" quad at node27 opens trunk.stag, and taking the
// sword takes the pistol with it (inven.shop addinven)
await goTo(h, "Node36");
await clickOn(h, "door l2lh");
await h.settle("the lighthouse door");
if (h.room() !== "lhouse") fail(`the lighthouse door opens onto lhouse.sett; we are in ${h.room()}`);
await goTo(h, "Node11");
await clickOn(h, "door lh2c");
await h.settle("down to the cave");
if (h.room() !== "rjcave") fail(`the cave door leads to rjcave.sett; we are in ${h.room()}`);
await goTo(h, "Node27");
await clickOn(h, "chest");
await h.until(() => !!h.session.propRuntime.get("sword")?.visible && h.running().length === 0, "the trunk to open", 5_000);
await clickOn(h, "sword");
// the sword comes with the pistol (inven.shop addinven)
const owns = (what: string): boolean => h.session.propRuntime.get(what)?.owner === "nick";
await h.until(() => owns("sword") && owns("pistol") && h.running().length === 0, "the sword and pistol into the inventory", 2_000);
const dir = h.host.director as any;
// the lid closes the trunk and the stage (trunk.stag closechest)
await clickOn(h, "lid");
// and Patch, of RedJack's crew, is waiting in the cave (patch1.pupp incave)
await converse(
  h,
  ["Who are you?", "You look like some kind of sailor.", "What happened to the treasure?", "When is the reunion?",
    "Who was the traitor?", "How many Brethren are left?", "Hasn't anyone tried", "Where is this island?",
    "What should I do?"],
  "Patch, in the cave",
);
ok("the sword and the pistol, from the trunk in the cave");

// out the way we came: rjcave "ladder" at node29 (upcave.move → lhouse Node15),
// lhouse "door lh2l" at Node10 → liznite Node36
await goTo(h, "Node29");
await clickOn(h, "ladder");
await h.settle("up the ladder");
if (h.room() !== "lhouse") fail(`the ladder leads up into lhouse.sett; we are in ${h.room()}`);
await goTo(h, "Node10");
await clickOn(h, "door lh2l");
await h.settle("out of the lighthouse");
if (h.room() !== "liznite") fail(`the lighthouse door opens onto liznite; we are in ${h.room()}`);
ok(`back in town at ${h.node()}, armed`);

// Lyle's school, on the dock by Node49 (lyledock2): fight1.pupp learntofight.
// Each lesson is a fight stage, and passing it ("a" or "e") adds it to the
// `classespassed` global that realfight asks for all three of
await goTo(h, "Node49");
await face(h, "lyle");
await waitNear(h, "lyle", 65_000);
await clickOn(h, "lyle");
await converse(h, ["I want to learn defense.", "I'm ready."], "Lyle's school: defense");
await h.until(() => fighting(h, "sdcombat.stag"), "the school of defense to open", 3_000);
await schoolOfDefense(h);
const passed = (lesson: string): boolean => global(h, "classespassed").includes(lesson);
if (!passed("defense")) fail(`the school of defense ends ${await ai(h, "nick", "fightstat")}, not passed`);
ok(`the school of defense, passed "${await ai(h, "nick", "fightstat")}" (${global(h, "totalblocked")} of ${global(h, "totalstrikes")} blocked)`);

// Lyle grades it ("after fight") and offers the school again
await converse(h, ["I want to learn dodging.", "I'm ready."], "Lyle's school: dodging");
await h.until(() => fighting(h, "sdocombat.stag"), "the school of dodging to open", 3_000);
await schoolOfDodging(h);
if (!passed("dodging")) fail(`the school of dodging ends ${await ai(h, "nick", "fightstat")}, not passed`);
ok(`the school of dodging, passed "${await ai(h, "nick", "fightstat")}"`);

await converse(h, ["I want to learn striking.", "Let's fight."], "Lyle's school: striking");
await h.until(() => fighting(h, "sscombat.stag"), "the school of striking to open", 3_000);
await schoolOfStriking(h);
if (!passed("striking")) fail(`the school of striking ends ${await ai(h, "nick", "fightstat")}, not passed`);
ok(`the school of striking, passed "${await ai(h, "nick", "fightstat")}" — all three of Lyle's lessons`);

// and the fight itself: realfight sets lylephase 1 (which Bone waits for) and
// runs combat.stag
await converse(h, ["I want to fight !"], "Lyle: the real fight");
await h.until(() => fighting(h, "combat.stag"), "the fight to open", 3_000);
await fightLyle(h);
if ((await ai(h, "nick", "fightstat")) !== "n") fail(`Nick loses the fight with Lyle (fightstat ${await ai(h, "nick", "fightstat")})`);
if ((await ai(h, "lyle", "lylephase")) !== "1") fail("the fight with Lyle sets lylephase 1");
ok("beat Lyle on the dock, sword and bottles (fightstat n, lylephase 1)");

// Lyle has the last word about the fight (fight1.pupp "after fight")
if (h.owner() === "puppet" || h.host.director.awaitingChoice) await converse(h, [], "Lyle, after the fight");
await h.settle("after the fight");

// Bone again, now that Lyle is beaten: bone1.pupp comeback (bonephase 1 → 2),
// then crates, which sends him and Cross out to the ship (stopactor, bonephase 1)
await goTo(h, "Node48");
await face(h, "bone");
await waitNear(h, "bone", 65_000);
await clickOn(h, "bone");
await converse(h, ["This is your ship?"], "Bone comes back");
if ((await ai(h, "bone", "bonephase")) !== "2") fail(`comeback sets bonephase 2; it is ${await ai(h, "bone", "bonephase")}`);
await clickOn(h, "bone");
await converse(h, ["What are you doing?"], "Bone and the crates");
if (h.session.actorRuntime.get("bone")?.visible) fail("crates sends Bone out to the ship");
ok("Bone and Cross have gone out to the ship: the boxes marked with an X go aboard");

// the charcoal, from the fire Lyle put out: lpfirepit at Node58 opens
// firepit.stag once its view is "off", and the stick in it is the charcoal
// (liznite.shop: addinven ("charcoal")); its button closes the stage
await goTo(h, "Node58");
await clickOn(h, "lpfirepit");
await h.until(() => h.session.stageName === "firepit.stag" && h.running().length === 0, "the fire pit to open", 3_000);
await clickOn(h, "stick");
await h.until(() => h.session.propRuntime.get("charcoal")?.owner === "nick" && h.running().length === 0, "the charcoal into the inventory", 2_000);
await clickOn(h, "button10");
await h.until(() => h.session.stageName !== "firepit.stag", "the fire pit to close", 2_000);
await h.settle("the fire pit to close");
ok("the charcoal, from the dead fire");

// the crate at Node47 opens crate.stag ("the crate" sends a click to Bone while
// he is there — he is not, now)
await goTo(h, "Node47");
await clickOn(h, "the crate");
await h.until(() => h.session.stageName === "crate.stag" && h.running().length === 0, "the crate to open", 3_000);
await clickOn(h, "chest");
await h.until(() => !!h.session.propRuntime.get("charcoal")?.visible && h.running().length === 0, "the chest to open", 2_000);
// the charcoal onto the crate's side: inven.shop draws the X (crate.stag drawx),
// and the mark's own endanim turns the crate to "crate1x" and the view to "x"
await drag(h, "charcoal", "crate2");
await h.until(() => h.session.propRuntime.get("the crate")?.stateName === "x" && h.running().length === 0, "the X on the crate", 3_000);
await h.until(() => String(h.session.currentFlat).toLowerCase() === "crate1x 1" && h.running().length === 0, "the marked crate", 3_000);
ok("the crate is marked with an X, as the ones that go aboard are");
await clickOn(h, "crate2x");
await h.until(() => h.running().length === 0, "zooming in on the crate", 3_000);
// ...and in: crate.stag's getin plays incrate.move and loadship.move, sets
// stowed and calls advanceday — day two starts on the Marauder
const films = h.logs.length;
await clickOn(h, "getin");
// advanceday's day-one case: the stowaway is found (nickdisc.move) and Justice
// has words for him (justice1b.pupp) — the first thing day two asks of the player
await h.until(() => global(h, "day") === "2" && h.room() === "ship" && h.host.director.awaitingChoice, "day two, on the ship", 20_000);
const played = h.logs.slice(films).filter((l) => l.startsWith("movie: ")).map((l) => l.split(" ")[1]);
for (const film of ["incrate.move", "loadship.move", "nickdisc.move"]) {
  if (!played.includes(film)) fail(`stowing away plays ${film}; it played ${played.join(", ")}`);
}
ok(`stowed away (${played.join(", ")}): day two begins aboard, found out, with Justice asking`);

pass("day1");
