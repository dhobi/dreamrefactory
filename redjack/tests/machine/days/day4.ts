/**
 * Day four, played: RedJack's island, from the beach the trial left Nick on to
 * the fire that calls Rockfish, who takes him to Blackbeard.
 *
 * The day ends when the beach's fire pit is lit with the torch (inven.shop
 * `torch` → safe turner `callrockfish`): rockfish.move, his talk (rock3.pupp
 * day4), and `advanceday ()`. The torch lies in the horn caves behind the squid
 * door, which opens once the horn is set at horn3's Scene73; the horn is in the
 * crate on the beach, and the way to the caves is link1's lock, which takes
 * the scepter. The scepter is in the skull: through its teeth (the gem lifts),
 * across the lava, past the flame corridor's switch and the swinging chain, and
 * held by a skeleton. Leaving the skull the other way, by the lava's mouth, is
 * open only once Nick has been to the top (`wenttop`), and the top's own door
 * down only once he holds RedJack's key and journal — the dream by the skeleton
 * up there, and the lockbox.
 *
 * On the way: the totems set asleep, or the darts at Scene129 kill.
 */
import { fail, ok, type Headless } from "../harness";
import { playGems } from "../gems";
import { crossTheLava, pullTheVine, runTheFlames, swingTheChain } from "../lava";
import {
  ai, clickFilm, clickOn, closeInventory, converse, drag, face, filmWaits, findOnScreen, global, goTo, openInventory,
  upFacing, walkScenes,
} from "../route";

/** day four from the beach to day five at Blackbeard's, each step checked as it goes */
export async function playDay4(h: Headless): Promise<void> {
  const props = h.session.propRuntime;
  const films = (from: number): string[] =>
    h.logs.slice(from).filter((l) => l.startsWith("movie: ")).map((l) => l.split(" ")[1]);
  const owns = (what: string): boolean => props.get(what)?.owner === "nick";

  // the totems at Scene94 guard the path: both must sleep (rjbeach.sett Scene129
  // openscene fires the darts otherwise). The top head sleeps on its own click;
  // the bottom one turns both (totem.shop)
  await goTo(h, "Scene94");
  await clickOn(h, "set totem 1", "prop");
  await h.until(() => h.session.stageName.startsWith("totem") && h.running().length === 0, "the totems", 2_000);
  const top = findOnScreen(h, "top head", "prop") ?? fail("no top head on the totems");
  h.click(top.x, top.y);
  await h.until(() => props.get("top head")?.stateName === "sleep" && h.running().length === 0, "the top head to sleep", 400);
  await clickOn(h, "ok", "prop");
  await h.until(() => h.session.stageName === "none" && h.running().length === 0, "the totems to close", 400);
  if (global(h, "totem1") !== "sleep" || global(h, "totem2") !== "sleep") fail(`the totems sleep; they are ${global(h, "totem1")} ${global(h, "totem2")}`);
  ok("the totems asleep (totem1, totem2 sleep): no darts on the way to the skull");

  // the skull's teeth: the gem lifts. Anne's lift answers only once she offers
  // to help, which she does after a first try alone (gem.shop wait → firsttry,
  // which opens the lifts again)
  await goTo(h, "Scene130");
  await clickOn(h, "gem", "quad");
  await h.until(() => h.session.stageName === "gem.stag" && h.running().length === 0, "the gem lifts", 3_000);
  h.click(350, 430); // the panel's button: this try is over
  await h.until(
    () => global(h, "endgem") === "0" && h.session.stageName === "gem.stag" && h.running().length === 0 && props.get("nick")?.stateName === "1",
    "the lifts to open again, with Anne's help",
    3_000,
  );
  if ((await ai(h, "anne", "annehelp")) !== "1") fail("a first try alone has Anne offer to help (annehelp 1)");
  let from = h.logs.length;
  const clicks = await playGems(h);
  await h.until(() => h.room() === "lava" && h.idle(), "into the skull", 5_000);
  if (!films(from).includes("gemmouth.move")) fail(`the gems open the mouth (gemmouth.move); it played ${films(from).join(", ")}`);
  ok(`the gem lifts solved in ${clicks} clicks: into the skull (gemmouth.move)`);

  // the lava: pillar to pillar to Scene23, and up facing 241 degrees into the hub
  const hops = await crossTheLava(h);
  await upFacing(h, 241);
  await h.until(() => h.room() === "hub" && h.idle(), "the hub", 5_000);
  ok(`across the lava in ${hops.length} hops, into the hub`);

  // the flame corridor: Node191's third exit is a film into old-style scenes;
  // step between the bursts to the switch, which drops door 2, and walk back
  await upFacing(h, 270);
  if (!h.session.maze?.scene) fail("Node191's third exit leads into the flame corridor");
  const steps = await runTheFlames(h, () => /^scene4[67]$/i.test(h.session.maze?.sceneName ?? ""));
  await h.settle("the switch");
  await clickOn(h, "switch", "prop");
  await h.until(() => props.get("switch")?.stateName === "down" && h.running().length === 0, "the switch", 400);
  if (props.get("door 2")?.visible) fail("the switch drops door 2");
  const sett = (h.session.maze as unknown as { sett: { scenes: { name: string; scen: number }[] } }).sett;
  const num = (name: string): number => sett.scenes.find((s) => s.name === name)?.scen ?? 0;
  await walkScenes(h, (road, scene) => road.to !== 0 || (road.toScene !== 0 && road.toScene < num(scene)));
  ok(`through the flames in ${steps} steps to the switch, and back: door 2 is down`);

  // the chain to Node196, the skeleton and the scepter
  await goTo(h, "Node195");
  await swingTheChain(h, "Node196");
  await goTo(h, "Node199");
  await clickOn(h, "set scepter", "prop");
  await h.until(() => h.session.stageName === "scombat2.stag" && h.running().length <= 1, "the skeleton", 20_000);
  from = h.logs.length;
  await pullTheVine(h);
  await h.settle("after the skeleton");
  if (!owns("scepter")) fail("the scepter is Nick's");
  if (!films(from).includes("swin1.move")) fail(`the vine brings the skeleton down (swin1.move); it played ${films(from).join(", ")}`);
  ok("swung over the lava, and the vine brought the skeleton down: the scepter is Nick's");

  // back over the chain, and up to the top (door h2t takes the scepter; wenttop)
  await goTo(h, "Node196");
  await swingTheChain(h, "Node195");
  await goTo(h, "Node192");
  await clickOn(h, "door h2t", "quad");
  await converse(h, ["I got in a fight.", "I don't want to talk about it."], "Anne at the top");
  if ((await ai(h, "safe turner", "wenttop")) !== "1") fail("the door to the top sets wenttop");
  ok("up on the top, where Anne waits (wenttop)");

  // the skeleton's dream: dream1.move asks for two clicks, and dream2.move's
  // action frame is what gives Nick RedJack's key (top.sett skeleton)
  await goTo(h, "Scene25");
  await clickOn(h, "skeleton", "quad");
  await h.until(() => filmWaits(h), "the dream", 400);
  await clickFilm(h);
  await h.until(() => filmWaits(h), "the dream's key", 400);
  await clickFilm(h);
  // dream2, RedJack's word (redjack3.pupp dream), dream3 and dream4, and the key
  await h.until(() => owns("rjkey") || h.host.director.awaitingChoice, "the dream to end", 5_000);
  await converse(
    h,
    ["I think I fell asleep.", "I have something to tell you about your father.", "I saw RedJack. He was your father."],
    "Anne after the dream",
  );
  if (!owns("rjkey")) fail("the dream gives Nick RedJack's key");
  ok("dreamt of RedJack by his skeleton, and woke with his key");

  // the lockbox: the key onto it (inven.shop rjkey), and the journal in it
  await goTo(h, "Scene56");
  await face(h, "lockbox", "quad");
  await openInventory(h);
  await drag(h, "rjkey", "lockbox", "quad");
  await h.until(() => h.session.stageName.startsWith("lockbox") && !!props.get("book")?.visible && h.running().length === 0, "the lockbox open", 3_000);
  const book = findOnScreen(h, "book", "prop") ?? fail("no book in the lockbox");
  h.click(book.x, book.y);
  await h.until(() => owns("journal") && h.running().length === 0, "the journal", 1_000);
  h.click(560, 430); // the lockbox's close
  await h.until(() => h.session.stageName === "none" && h.running().length === 0, "the lockbox to close", 1_000);
  await converse(h, ["A book."], "Anne on the lockbox");
  await closeInventory(h);
  ok("RedJack's key opened his lockbox: the journal");

  // down again: the top's door (journal and key), the hub, the lava's jump at
  // Node191 (0 degrees), and the lava's mouth to the beach (node10, 88 degrees)
  await goTo(h, "Scene10");
  await clickOn(h, "door t2h", "quad");
  await h.until(() => h.room() === "hub" && h.idle(), "back in the hub", 5_000);
  await goTo(h, "Node191");
  await upFacing(h, 0);
  await h.until(() => h.room() === "lava" && h.idle(), "the lava", 5_000);
  await goTo(h, "node10");
  await upFacing(h, 88);
  await h.until(() => h.room() === "rjbeach" && h.idle(), "the beach", 5_000);
  ok(`out of the skull's mouth, onto the beach at ${h.node()}`);

  // the crate at Scene11: its crowbar breaks its lock (inven.shop crowbar), and
  // the horn is inside
  await goTo(h, "Scene11");
  await clickOn(h, "the crate", "prop");
  await h.until(() => h.session.stageName === "bcrate.stag" && h.running().length === 0, "the crate", 2_000);
  await clickOn(h, "crowbar", "prop");
  await h.until(() => owns("crowbar") && h.running().length === 0, "the crowbar", 1_000);
  await openInventory(h);
  await drag(h, "crowbar", "lock", "button");
  await h.until(() => !!props.get("crate horn")?.visible && h.running().length === 0, "the crate to open", 2_000);
  await closeInventory(h);
  await clickOn(h, "crate horn", "prop");
  await h.until(() => owns("horn") && h.running().length === 0, "the horn", 1_000);
  await clickOn(h, "ok", "prop");
  await h.until(() => h.session.stageName === "none" && h.running().length === 0, "the crate to close", 1_000);
  await converse(h, ["I found this thing in the crate."], "Anne on the horn");
  ok("the crowbar opened the crate on the beach: the horn");

  // link1, whose lock takes the scepter (oscepter.move → link2, dooropen)
  await goTo(h, "scene22");
  await upFacing(h, 280);
  await h.until(() => h.room() === "link1" && h.idle(), "link1", 5_000);
  await face(h, "scepter lock", "quad");
  await openInventory(h);
  await drag(h, "scepter", "scepter lock", "quad");
  await h.until(() => h.room() === "link2" && h.idle(), "link2", 5_000);
  await closeInventory(h);
  ok("the scepter opened link1's lock, into link2");

  // the horn caves: horn1, on to horn3 by Scene57, the horn onto its place at
  // Scene73 (horn4: the horn set, the squid door open), and back into horn2
  await upFacing(h, 196);
  await h.until(() => h.room() === "horn1" && h.idle(), "horn1", 5_000);
  await goTo(h, "Scene57");
  await upFacing(h, 354);
  await h.until(() => h.room() === "horn3" && h.idle(), "horn3", 5_000);
  await goTo(h, "Scene73");
  await face(h, "horn", "quad");
  await openInventory(h);
  await drag(h, "horn", "horn", "quad");
  await h.until(() => h.room() === "horn4" && h.idle(), "horn4", 5_000);
  await closeInventory(h);
  if (props.get("horn")?.owner !== "set" || (await ai(h, "extra", "squiddoor")) !== "1") fail("the horn is set and the squid door open");
  await goTo(h, "Scene57");
  await upFacing(h, 97);
  await h.until(() => h.room() === "horn2" && h.idle(), "horn2", 5_000);
  await goTo(h, "Scene41");
  await clickOn(h, "torch", "prop");
  await h.until(() => owns("torch") && h.running().length === 0, "the torch", 1_000);
  ok("the horn set at horn3 opened the squid door: the torch from horn2");

  // back to the beach's fire pit, and the torch to it: Rockfish
  await goTo(h, "Scene10");
  await h.until(() => h.room() === "link2" && h.idle(), "link2", 3_000);
  await goTo(h, "Node121");
  await upFacing(h, 150);
  await h.until(() => h.room() === "rjbeach" && h.idle(), "the beach", 3_000);
  await goTo(h, "Scene10");
  await face(h, "firepit", "prop");
  await openInventory(h);
  from = h.logs.length;
  await drag(h, "torch", "firepit", "prop");
  await converse(
    h,
    [
      "We got marooned.", "No.", "To some.", "Murder.", "Yes.", "He's dead.", "You've got to help me.",
      "What do you think of this tattoo.", "When can I see Blackbeard?", "Are you afraid of him?",
    ],
    "Rockfish",
    { thenAsks: true },
  );
  await h.until(() => global(h, "day") === "5" && h.room() === "bb1" && (h.idle() || h.host.director.awaitingChoice), "day five, at Blackbeard's", 20_000);
  const played = films(from);
  for (const film of ["rockfish.move", "rjbb.move"]) if (!played.includes(film)) fail(`the fire's end plays ${film}; it played ${played.join(", ")}`);
  ok(`the fire called Rockfish (${played.join(", ")}): day five at Blackbeard's`);
}
