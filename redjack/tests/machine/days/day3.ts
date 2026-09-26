/**
 * Day three, played: Port Royal, from Justice's word on the docks to the
 * street fight that ends in the trial at sea.
 *
 * The day ends when the third wave of Jan's men is down: bfight.cast
 * `nextphase` → `endfight` plays `endfight.move` and calls `advanceday ()`,
 * whose day-three case holds the trial (common.shop `trialatsea`) and opens
 * RedJack's beach. The way there, as the scripts have it:
 *
 *   - **Erzulie** (erzulie.sett, through ptroyal's `door pr2e` at Scene16)
 *     talks on the way in; her door out sends Justice to his death
 *     (`sendtoactor ("justice", runfight ())`): the alley, `juskill.move`, and
 *     the fight with Jan and his second (`jcombat.stag`, J1.shop and J2.shop).
 *   - **the jail** (const2.pupp `alley` → jail1.sett): the cup rattled at the
 *     window calls Anne, whose rum the constable drinks himself asleep on
 *     (`walktodesk` → `drink` → jail2); a rock raked out of the wall with the
 *     spoon brings the rifle down (`throwrock` → jail3), and the keys it knocks
 *     to the floor open the lock (jail4); the trunk gives back the sword and
 *     pistol (jail5), and the soldier at the door lets Nick go.
 *   - **the street fight** (jail5 `door j2pr` → ptroyal scene23, `bfight`).
 */
import { fail, ok, type Headless } from "../harness";
import { duel, shootout } from "../fight";
import { ai, carry, clickOn, converse, face, findOnScreen, global, goTo, rattle } from "../route";

/** day three from Justice's first question to the beach, each step checked as it goes */
export async function playDay3(h: Headless): Promise<void> {
  const props = h.session.propRuntime;
  const films = (from: number): string[] =>
    h.logs.slice(from).filter((l) => l.startsWith("movie: ")).map((l) => l.split(" ")[1]);

  // the docks: justice2.pupp docks, and his watch
  await converse(h, ["When should we be back?"], "Justice on the docks");
  if (props.get("watch")?.owner !== "nick") fail(`Justice gives Nick his watch; its owner is ${props.get("watch")?.owner}`);
  ok("ashore at Port Royal, with Justice's watch");

  // Erzulie: erzulie.sett's openset plays erzintro.move and her talk
  // (erzulie2.pupp day3), which ends with her gone (erzulphase 1)
  await goTo(h, "Scene16");
  await clickOn(h, "door pr2e", "quad");
  await converse(
    h,
    [
      "How do you know my name?", "Yes.", "Tell me about the Brethren.", "Yes.",
      "Was that a vision of the future or the past?", "What about the Brethren?", "Where is the condemned man?",
      "What can I do about this curse?", "What about the treasure?", "What about RedJack?", "You know Blackbeard?",
    ],
    "Erzulie",
  );
  if ((await ai(h, "erzulie", "erzulphase")) !== "1") fail("Erzulie's talk ends in erzulphase 1");
  ok("Erzulie has read Nick's fortune and vanished (erzulphase 1)");

  // her door out, and the alley: Justice's runfight → juskill.move → jcombat.stag
  let from = h.logs.length;
  await goTo(h, "Node10");
  await clickOn(h, "door e2pr", "quad");
  await converse(h, ["Who are you meeting?"], "Justice in the alley");
  await h.until(() => h.session.stageName === "jcombat.stag" && h.running().length <= 1, "the fight in the alley", 20_000);
  if (!films(from).includes("juskill.move")) fail(`the alley plays juskill.move; it played ${films(from).join(", ")}`);
  ok("Justice is ambushed in the alley (juskill.move), and Nick draws on Jan");

  // Jan and then his second: J1.shop's death plays jswitch.move and opens J2.shop
  from = h.logs.length;
  await duel(h, "jcombat.stag", "the fight with Jan");
  if (global(h, "wonfight") !== "1") fail("the alley is won (wonfight)");
  if (!films(from).includes("jswitch.move")) fail(`Jan's death plays jswitch.move; it played ${films(from).join(", ")}`);
  ok("beat Jan and his second in the alley (wonfight)");

  // postfight: justicedead.move, and the constable's questions (const2.pupp alley)
  await converse(h, ["I just found this dead body.", "He gave it to me."], "the constable in the alley");
  await h.until(() => h.room() === "jail1" && h.idle(), "the jail", 5_000);
  if (!films(from).includes("justicedead.move")) fail(`the constable finds Justice (justicedead.move); it played ${films(from).join(", ")}`);
  ok("arrested for Justice's murder, in jail1");

  // Anne at the window: the cup scraped along its bars (jail.shop stdmove,
  // flag "anne") calls her, and her rum comes in (anne2b.pupp injail1)
  await clickOn(h, "tray", "quad");
  await h.until(() => h.session.stageName === "jail.stag" && props.get("lid")?.stateName === "open" && h.running().length === 0, "the tray", 3_000);
  await rattle(h, "jmug", findOnScreen(h, "window", "button") ?? fail("no window on the tray's flat"));
  await converse(h, ["What are you doing here?", "Rum?"], "Anne at the window");
  if (!props.get("rum")?.visible) fail("Anne's rum is on the tray");
  ok("Anne found Nick at the window and passed him rum");

  // the constable: the rum shown to him (takerum), then "I'm thirsty." sends him
  // to his desk (walktodesk), where he drinks himself asleep: drunk.move, jail2
  await clickOn(h, "lid", "prop");
  await h.until(() => h.session.stageName !== "jail.stag" && h.running().length === 0, "the tray to close", 3_000);
  await clickOn(h, "constable", "actor");
  await converse(h, ["Let me out.", "I'm hungry.", "I'm thirsty."], "the constable and the rum");
  await h.until(() => h.room() === "jail2" && h.idle(), "the constable to drink", 5_000);
  ok("the constable drank Anne's rum and sleeps (jail2)");

  // a rock out of the wall: the spoon rakes it loose (jail.shop rake, the point
  // 38 left of and 39 below the pointer), Nick takes it, and thrown at the
  // rifle it brings it down (throwrock → riflefall.move → jail3)
  await clickOn(h, "tray", "quad");
  await h.until(() => h.session.stageName === "jail.stag" && props.get("lid")?.stateName === "open" && h.running().length === 0, "the tray", 3_000);
  const rock = findOnScreen(h, "rock 3", "prop") ?? fail("rock 3 is not in the wall");
  await carry(h, "spoon", { x: rock.x + 38, y: rock.y - 39 });
  await h.until(() => props.get("rock 3")?.owner === "loose" && h.running().length === 0, "rock 3 to come loose", 400);
  await carry(h, "rock 3", { x: 560, y: 220 }, "prop");
  if (props.get("nrock 3")?.owner !== "nick") fail("Nick holds the rock");
  await clickOn(h, "lid", "prop");
  await h.until(() => h.session.stageName !== "jail.stag" && h.running().length === 0, "the tray to close", 3_000);
  await carry(h, "nrock 3", await face(h, "rifle", "quad"), "prop");
  await h.until(() => h.room() === "jail3" && h.running().length === 0, "the rifle to fall", 3_000);
  ok("a rock from the wall brought the rifle down (jail3)");

  // the keys on the floor (propis3d: to pick up), and onto the lock:
  // nickesc.move → jail4
  await clickOn(h, "keys", "prop");
  await h.until(() => !!props.get("ikeys")?.visible && h.running().length === 0, "the keys in hand", 500);
  await carry(h, "ikeys", await face(h, "lock", "quad"), "prop");
  await h.until(() => h.room() === "jail4" && h.running().length === 0, "out of the cell", 3_000);
  ok("the keys opened the cell (jail4)");

  // the trunk gives back the sword and pistol (jail5), and the soldier at the
  // door lets Nick out (soldier2b.pupp leaving) into the street, and the fight
  await clickOn(h, "trunk", "quad");
  await h.until(() => h.room() === "jail5" && h.running().length === 0, "the trunk", 2_000);
  await goTo(h, "Node13");
  await clickOn(h, "door j2pr", "quad");
  await converse(h, ["All right."], "the soldier at the door");
  await h.until(() => h.room() === "ptroyal" && h.running().length === 0, "the street", 5_000);
  ok(`out of the jail with sword and pistol, into the street at ${h.node()}`);

  // the street fight, three waves, and the day's end: endfight.move, the trial
  // at sea, and RedJack's beach
  from = h.logs.length;
  const shots = await shootout(h, () => global(h, "day") === "4");
  await h.until(() => h.room() === "rjbeach" && (h.idle() || h.host.director.awaitingChoice), "day four, on the beach", 20_000);
  const played = films(from);
  for (const film of ["endfight.move", "trialset.move", "endtrial.move"]) {
    if (!played.includes(film)) fail(`the day's end plays ${film}; it played ${played.join(", ")}`);
  }
  ok(`won the street fight in ${shots} shots, and the trial at sea (${played.join(", ")}): day four on RedJack's beach`);
}
