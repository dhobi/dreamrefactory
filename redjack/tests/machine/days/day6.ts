/**
 * Day six, played: Cartagena (disc 2), from the lock Blackbeard's men leave
 * Nick, Anne and Rockfish in to Marquez in his study.
 *
 * The day ends when Nick finds the study's inner door with Jake and Elizabeth
 * free: study.sett's "secret door" (`actorstar ("jake") = "jake"`) plays
 * `armrm.move` and `marqintro.move`, Anne and Marquez speak (anne2.pupp,
 * marquez2.pupp day6), and `advanceday ()` sails for RedJack's island. The way
 * there, as the scripts have it:
 *
 *   - **the lock** (lock1 → lock3): Anne turns the valve on the left with Nick
 *     standing in the drain (anne2.pupp help at Scene13 → `nickdrain`), and he
 *     goes down alone. At the bottom, the lock door (`ldoor`) opens only while
 *     the upper lock is drained, and filling it with the door open drowns him
 *     (cartegena.cast valves `fill`); so he goes through, shuts it behind him,
 *     and through the pipe asks for the fill valve and the raft (lock2.pupp),
 *     then drains the lock himself at the bottom valves (botvalves.stag →
 *     valves `drain`, `ardrain.move`) and the raft brings them down.
 *   - **the chains**: Rockfish speaks his mind (rock2b.pupp ondeck), goes
 *     round to Anne's gate, and each pulls a chain; with both held the sword
 *     cuts the raft's rope at Node13 (inven.shop `sword` → lock3 `raft`,
 *     `exitlock.move`), and the raft runs out to the dock without Rockfish.
 *   - **the hold** (hold.sett): down the stairs, and through the torture
 *     chamber's door into the fight (tcombat.stag, ../fight.ts `whipFight`
 *     and `cauldronFight`); the study key and the hat lie in the chamber.
 *   - **the study** (study.sett), unlocked with the key (inven.shop
 *     `studykey` on the hold's "door h2s"): each of its four shields holds a
 *     symbol (shield.stag, `icon 1`–`icon 4`).
 *   - **the gearboxes** (switch.stag), one at each corner of the hold's
 *     floor: its symbol set in (inven.shop `icon` → `replace`, owner
 *     "switch"), its lever thrown (`switches` 1–4). With all four down the
 *     switch at Scene19 lowers the cage and slides the walkways out
 *     (cartegena.cast switches `lowercage`); pulled any sooner it kills
 *     (`holddeath.move`). Jake and Elizabeth climb out onto the upper floor,
 *     and Elizabeth points Nick at the study's inner door.
 */
import { fail, ok, type Headless } from "../harness";
import { cauldronFight, whipFight } from "../fight";
import { films } from "./day5";
import { ai, clickOn, closeInventory, converse, drag, face, global, goTo, openInventory, pathTo, upFacing, walkUpTo } from "../route";

/** the gearbox each symbol goes in, and the node it is reached from (cartegena.shop gearbox `inreach`) */
const GEARBOXES: [n: number, node: string][] = [
  [1, "Node48"],
  [2, "Scene24"],
  [3, "Scene23"],
  [4, "Scene17"],
];

/** a stage's prop in the view it is waiting for, and no script running */
const shows = (h: Headless, prop: string, view: string): boolean =>
  h.session.propRuntime.get(prop)?.stateName === view && h.running().length === 0;

/** the room has the screen again, or someone asks something */
const settled = (h: Headless): boolean => h.idle() || h.host.director.awaitingChoice;

export async function playDay6(h: Headless): Promise<void> {
  if (h.room() !== "lock1") fail(`day six opens in Cartagena's lock (lock1); the game is at ${h.room()}`);

  // Anne first (anne2.pupp bigintro, annephase 1), then the valve on the left
  // with Nick in the drain: `nickdrain` plays ndrain.move and he is at the
  // bottom alone (lock3 Node10)
  await walkUpTo(h, "anne");
  await clickOn(h, "anne", "actor");
  await converse(h, ["Rockfish.", "What should we do?"], "Anne in the lock");
  await goTo(h, "Scene13");
  await clickOn(h, "anne", "actor");
  await converse(h, ["Turn the valve on the left."], "Anne at the valves");
  await h.until(() => h.room() === "lock3" && h.idle(), "Nick drained down to the bottom of the lock", 3_000);
  ok("Anne turned the valve with Nick in the drain: he is at the bottom of the lock alone");

  // the door, the pipe and the bottom valves, in the one order that works
  await goTo(h, "Node11");
  await clickOn(h, "ldoor", "prop");
  await h.until(() => h.session.propRuntime.get("ldoor")?.value === 1 && h.idle(), "the lock door open", 600);
  await goTo(h, "Node12");
  await clickOn(h, "ldoor", "prop");
  await h.until(() => h.session.propRuntime.get("ldoor")?.value === 0 && h.idle(), "the lock door shut behind", 600);
  await goTo(h, "Node16");
  await clickOn(h, "pipe", "quad");
  await converse(h, ["Turn the fill valve."], "the pipe: the fill valve");
  await clickOn(h, "pipe", "quad");
  await converse(h, ["Get on the raft."], "the pipe: the raft");
  if ((await ai(h, "anne", "onraft")) !== "1") fail("Anne and Rockfish did not get on the raft");
  await clickOn(h, "valves", "quad");
  await h.until(() => h.session.stageName === "botvalves.stag" && h.running().length === 0, "the bottom valves", 2_000);
  await clickOn(h, "drain", "prop");
  await h.until(() => h.session.stageName !== "botvalves.stag" && settled(h), "the lock drained", 3_000);
  if (h.session.actorRuntime.get("anne")?.poseName === undefined) fail("Anne is not in the lock");
  ok("through the lock door, the lock filled, and drained again with Anne and Rockfish on the raft");

  // Rockfish comes over to talk (cartegena.cast rockfish endwalk at "rockfish 3"),
  // and goes round to Anne's gate; each pulls a chain at Node13
  await h.until(() => h.host.director.awaitingChoice, "Rockfish on the raft", 3_000);
  await converse(h, ["How long before we get there?", "Thank you.", "Go around and help Anne"], "Rockfish on the raft");
  const at = (who: string, star: string): boolean => h.session.actorRuntime.get(who)?.starName === star;
  await h.until(() => at("anne", "anne 5") && at("rockfish", "rockfish 5") && h.idle(), "Anne and Rockfish at the chains", 3_000);
  await goTo(h, "Node13");
  await clickOn(h, "anne", "actor");
  await converse(h, ["Pull the chain."], "Anne at her chain");
  await clickOn(h, "rockfish", "actor");
  await converse(h, ["Pull the chain."], "Rockfish at his chain");
  // both held: the sword on the raft's rope (inven.shop `sword`)
  await face(h, "rope", "quad");
  await openInventory(h);
  await drag(h, "sword", "rope", "quad");
  await h.until(() => h.room() === "dock" && settled(h), "the raft out of the lock", 5_000);
  ok(`both chains held and the rope cut: the raft ran out of the lock to the ${h.room()}`);

  // Anne mourns Rockfish on the dock (dock.sett openscene, anne2.pupp
  // rockdead), and the hold's door is at Node13
  for (const n of pathTo(h, "Node13")) {
    await goTo(h, n);
    if (h.owner() === "puppet") await h.settle("Anne on the dock");
  }
  await clickOn(h, "door", "quad");
  await h.until(() => h.room() === "hold" && settled(h), "into the hold", 3_000);
  ok(`Anne spoke for Rockfish on the dock; into the hold at ${h.node()}`);

  // down the stairs (hold.sett keydown: Scene11 facing 171° → `stairs`), and
  // through the torture chamber's door (hold.sett Node25 → whipsword.move,
  // tcombat.stag)
  await goTo(h, "Scene11");
  await upFacing(h, 171);
  if (h.node() !== "Scene21") fail(`the stairs lead down to Scene21; Nick is at ${h.node()}`);
  await goTo(h, "Node25");
  await clickOn(h, "door h2t", "quad");
  await h.until(() => h.session.stageName === "tcombat.stag" && h.running().length <= 1, "the fight in the torture chamber", 5_000);
  await whipFight(h);
  await cauldronFight(h);
  await h.until(() => h.room() === "torture" && settled(h), "into the torture chamber", 3_000);
  if (global(h, "wonfight") !== "1") fail("the torturer won");
  ok(`dodged the whip, took up the sword and beat the torturer: in the torture chamber at ${h.node()}`);

  // the study key and the hat, on the chamber's floor (torture.sett openset)
  await goTo(h, "Node18");
  await clickOn(h, "study key", "prop");
  await h.settle("the study key");
  await goTo(h, "Node21");
  await clickOn(h, "hat", "prop");
  await h.settle("the hat");
  for (const p of ["study key", "hat"]) if (h.session.propRuntime.get(p)?.owner !== "nick") fail(`Nick did not pick up the ${p}`);
  ok("picked up the study key and the hat in the torture chamber");

  // back to the hold, up the far stairs (Scene16 facing 8°), and the key in
  // the study's door at Scene15
  await goTo(h, "Node14");
  await clickOn(h, "door t2h", "quad");
  await h.until(() => h.room() === "hold" && h.idle(), "back in the hold", 2_000);
  await goTo(h, "Scene16");
  await upFacing(h, 8);
  await goTo(h, "Scene15");
  await face(h, "door h2s", "quad");
  await openInventory(h);
  await drag(h, "study key", "door h2s", "quad");
  if (h.session.propRuntime.get("study key")?.owner !== "used") fail("the study key did not open the study's door");
  await closeInventory(h);
  await clickOn(h, "door h2s", "quad");
  await h.until(() => h.room() === "study" && h.idle(), "the study", 2_000);

  // the four shields (study.sett Node12): the door opened, the symbol taken
  // (shield.shop icons → `addinven`), and the stage's button closes it
  await goTo(h, "Node12");
  for (let i = 1; i <= 4; i++) {
    await clickOn(h, `shield ${i}`, "quad");
    await h.until(() => h.session.stageName === "shield.stag" && h.running().length === 0, `shield ${i}`, 1_000);
    await clickOn(h, "sdoor", "prop");
    await h.until(() => shows(h, "sdoor", "open"), `shield ${i} open`, 1_000);
    await clickOn(h, "icons", "prop");
    await h.frame(5);
    await clickOn(h, "Button11", "button");
    await h.until(() => h.session.stageName !== "shield.stag" && h.idle(), `shield ${i} closed`, 1_000);
    if (h.session.propRuntime.get(`icon ${i}`)?.owner !== "nick") fail(`the symbol of shield ${i} is not Nick's`);
  }
  ok("took the four symbols from the study's shields");

  // down again (Scene13 facing 8°), and each gearbox: its door, its symbol,
  // its lever, and the stage's button
  await goTo(h, "Node10");
  await clickOn(h, "door", "quad");
  await h.until(() => h.room() === "hold" && h.idle(), "back in the hold", 2_000);
  await goTo(h, "Scene13");
  await upFacing(h, 8);
  for (const [i, node] of GEARBOXES) {
    await goTo(h, node);
    await clickOn(h, `gearbox ${i}`, "prop");
    await h.until(() => h.session.stageName === "switch.stag" && h.running().length === 0, `gearbox ${i}`, 1_000);
    await clickOn(h, "sdoor", "prop");
    await h.until(() => shows(h, "sdoor", "open"), `gearbox ${i} open`, 1_000);
    await openInventory(h);
    await drag(h, `icon ${i}`, "mounts", "prop");
    await closeInventory(h);
    await clickOn(h, "switch2", "prop");
    await h.until(() => shows(h, "switch2", "down"), `gearbox ${i}'s lever`, 1_000);
    await clickOn(h, "Button10", "button");
    await h.until(() => h.session.stageName !== "switch.stag" && h.idle(), `gearbox ${i} closed`, 1_000);
    if ((await ai(h, "switches", String(i))) !== "1") fail(`gearbox ${i}'s lever is not down`);
  }
  ok("set the four symbols in the gearboxes and threw their levers");

  // the switch lowers the cage; Jake and Elizabeth climb out (setupactor
  // "escape", walking to their stars on the upper floor)
  await goTo(h, "Scene19");
  const from = h.logs.length;
  await clickOn(h, "switch", "prop");
  const A = h.session.actorRuntime;
  await h.until(() => A.get("jake")?.starName === "jake" && A.get("elizabeth")?.starName === "elizabeth" && h.idle(), "Jake and Elizabeth out of the cage", 3_000);
  const played = films(h, from);
  if (!played.includes("lowercage.move")) fail(`the switch plays lowercage.move; it played ${played.join(", ")}`);
  ok(`the switch lowered the cage (${played.join(", ")}): Jake and Elizabeth are free`);

  // Elizabeth, up the stairs (elizncage.pupp solvedpuzzle, elizphase 2)
  await goTo(h, "Scene16");
  await upFacing(h, 8);
  await walkUpTo(h, "elizabeth");
  await clickOn(h, "elizabeth", "actor");
  await converse(h, ["This is Anne."], "Elizabeth out of the cage");
  if ((await ai(h, "elizabeth", "elizphase")) !== "2") fail("Elizabeth's talk did not end (elizphase)");
  ok("Elizabeth told Nick where the Viceroy went");

  // the study's inner door, with Jake free (study.sett: `actorstar ("jake") =
  // "jake"` at Node13): Marquez in his armoury and his study (armrm.move,
  // marqintro.move, marquez2.pupp day6), and `advanceday ()`, which takes the
  // day to RedJack's island (rjbeach, disc 3) and its first question
  await goTo(h, "Scene15");
  await clickOn(h, "door h2s", "quad");
  await h.until(() => h.room() === "study" && h.idle(), "back in the study", 2_000);
  await goTo(h, "Node13");
  const into = h.logs.length;
  await clickOn(h, "secret door", "quad");
  await converse(
    h,
    [
      "You're the one who hired the Janizaries?", "What do you want to talk about?", "Do you believe in ghosts?",
      "You don't seem so sure.", "How did you know about me?", "What do you mean?", "Why are you doing this?", "Why?",
      "I'll take you to the island.",
    ],
    "Marquez",
    { thenAsks: true },
  );
  await h.until(() => global(h, "day") === "7" && settled(h), "day seven", 20_000);
  const ended = films(h, into);
  for (const film of ["armrm.move", "marqintro.move"]) if (!ended.includes(film)) fail(`the study plays ${film}; it played ${ended.join(", ")}`);
  ok(`Marquez in his study, and the day ends (${[...new Set(ended)].join(", ")}): day seven at ${h.room()}`);
}

