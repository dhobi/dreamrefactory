/**
 * Day seven, played: RedJack's island again (disc 3), from the standoff on the
 * beach to the end of the game.
 *
 * The day opens on the beach with Blackbeard and Marquez face to face
 * (bbintro3.pupp day7 `exchange`, marquez3.pupp), and the Spaniards come out of
 * the trees; the Spaniard's sword fight follows (spancombat.stag), and Marquez
 * takes Anne (annemarq.move). The game ends, as the scripts have it:
 *
 *   - **Marquez** in the horn caves: the squid door (horn1.sett Scene36,
 *     "button") opens on him with Anne (rjbeach.shop squid door `endanim` →
 *     drawmarq.move, mcombat.stag, ../fight.ts `marquezFight`), and beaten he
 *     is chained (`beatmarquez`, `didmarq`).
 *   - **the horn** at horn4's Scene73, blown with Marquez chained below: the
 *     squid takes him (marqsquid.move, `blewhorn`), and Anne sends Nick to
 *     Blackbeard (anne3.pupp `helpbb`).
 *   - **the ballista**: a totem woken on day seven, with the Spaniards on the
 *     beach (totem.shop `backtoidle` → `doballista`: savebb.move, `diddart`),
 *     and Blackbeard's question answered with the ballistas (bbend3.pupp
 *     `hands`; "This is your problem." is the death). Two galleons sunk
 *     (../ballista.ts) end its game (`endgame`, `didballista`) and bring Nick
 *     back to the beach.
 *   - **the end**: back on the beach with the dart and the horn done
 *     (rjbeach.sett Scene10 `isplayerdone`), `theend ()`: Patch, RedJack
 *     (morph.move, rjfade.move), each of the crew's last word
 *     (`finishtheend`), swimin.move, and the game back at its menu
 *     (control.stag).
 */
import { fail, ok, type Headless } from "../harness";
import { sinkTheGalleons } from "../ballista";
import { duel, marquezFight } from "../fight";
import { films } from "./day5";
import { ai, clickFilm, clickOn, converse, filmWaits, findOnScreen, goTo, upFacing } from "../route";

/** the room has the screen again, or someone asks something */
const settled = (h: Headless): boolean => h.idle() || h.host.director.awaitingChoice;

export async function playDay7(h: Headless): Promise<void> {
  if (h.room() !== "rjbeach") fail(`day seven opens on RedJack's beach; the game is at ${h.room()}`);

  // the standoff: Blackbeard and Marquez, and Nick's word on who Marquez is
  // (bbintro3.pupp `exchange`); the Spaniards, and the Spaniard's fight
  // (advanceday: gunshot.move, anncaught.move, beachdraw.move, spancombat.stag)
  let from = h.logs.length;
  await converse(h, ["He's the traitor!"], "Blackbeard and Marquez", { thenAsks: true });
  await h.until(() => h.session.stageName === "spancombat.stag", "the Spaniard's fight", 20_000);
  await duel(h, "spancombat.stag", "the fight with the Spaniard");
  if (String(h.session.interp.globals.get("wonfight")) !== "1") fail("the Spaniard won");
  // the fight's end is a loop's (spancombat.stag closestage → "safe turner"
  // `postfight`): Marquez takes Anne up the hill
  await h.until(() => films(h, from).includes("annemarq.move") && h.idle(), "Marquez to take Anne", 3_000);
  ok(`the standoff, and the Spaniard beaten on the beach (${films(h, from).join(", ")})`);

  // Marquez, behind the squid door in the horn caves (link1's door stands open
  // on day seven: advanceday `dooropen`)
  await goTo(h, "scene22");
  await upFacing(h, 280);
  await h.until(() => h.room() === "link2" && h.idle(), "link2", 5_000);
  await upFacing(h, 196);
  await h.until(() => h.room() === "horn1" && h.idle(), "horn1", 5_000);
  await goTo(h, "Scene36");
  from = h.logs.length;
  await clickOn(h, "button", "quad");
  await h.until(() => h.session.stageName === "mcombat.stag", "Marquez's fight", 5_000);
  await marquezFight(h);
  if (String(h.session.interp.globals.get("wonfight")) !== "1") fail("Marquez won");
  await h.until(() => settled(h), "Marquez chained", 20_000);
  if ((await ai(h, "nick", "didmarq")) !== "1") fail("Marquez is beaten and chained (didmarq)");
  ok(`Marquez beaten in the horn caves (${films(h, from).join(", ")}): Anne is free`);

  // the horn, blown with Marquez chained below it
  await goTo(h, "Scene57");
  await upFacing(h, 354);
  await h.until(() => h.room() === "horn4" && h.idle(), "horn4", 5_000);
  await goTo(h, "Scene73");
  from = h.logs.length;
  await clickOn(h, "horn", "quad");
  await h.until(() => films(h, from).includes("marqsquid.move") && settled(h), "the horn", 5_000);
  if ((await ai(h, "nick", "blewhorn")) !== "1") fail("the horn is blown (blewhorn)");
  ok("the horn blown: the squid takes Marquez");

  // back to the beach, and a totem woken: Blackbeard, and the ballista
  await goTo(h, "Scene57");
  await upFacing(h, 97);
  await h.until(() => h.room() === "horn1" && h.idle(), "horn1", 5_000);
  await goTo(h, "Scene10", true);
  await h.until(() => h.room() === "link2" && h.idle(), "link2", 5_000);
  await goTo(h, "Node121");
  await upFacing(h, 150);
  await h.until(() => h.room() === "rjbeach" && h.idle(), "the beach", 5_000);
  await goTo(h, "Scene94");
  await clickOn(h, "set totem 1", "prop");
  await h.until(() => h.session.stageName.startsWith("totem") && h.running().length === 0, "the totems", 2_000);
  const top = findOnScreen(h, "top head", "prop") ?? fail("no top head on the totems");
  from = h.logs.length;
  h.click(top.x, top.y);
  await converse(h, ["What are we going to do about those Spanish galleons?", "Yes, the ballistas."], "Blackbeard");
  await h.until(() => h.room() === "ballista" && h.idle(), "the ballista", 5_000);
  if ((await ai(h, "nick", "diddart")) !== "1") fail("the totem sets the dart off (diddart)");
  ok(`a totem woken: Blackbeard saved (${films(h, from).join(", ")}), and to the ballista`);

  from = h.logs.length;
  const shots = await sinkTheGalleons(h);
  if ((await ai(h, "marquez", "didballista")) !== "1") fail("the galleons are beaten (didballista)");
  ok(`two galleons sunk from the ballista in ${shots} stones (${films(h, from).join(", ")})`);

  // the end: Patch, RedJack, and the crew's last words, each asking once or
  // twice, until the game is back at its menu
  const answers = [
    "The pirate life.", "Why do you ask?", "Then what will you do?", "Thank you.", "I will.", "I'm sure.",
    "Got my own ship, want to be my weatherman?",
  ];
  const dir = h.host.director;
  from = h.logs.length;
  for (;;) {
    await h.until(() => dir.awaitingChoice || filmWaits(h) || h.session.stageName === "control.stag", "the ending", 30_000);
    if (h.session.stageName === "control.stag") break;
    if (filmWaits(h)) {
      await clickFilm(h);
      continue;
    }
    const offered = dir.choices.map((c) => c.text);
    const want = answers.shift() ?? fail(`the ending asks again (${offered.join(" | ")}) and the route has no answer`);
    const i = offered.findIndex((t) => t.startsWith(want));
    if (i < 0) fail(`the ending: no "${want}" among ${offered.join(" | ")}`);
    const r = dir.choiceRects[i];
    h.click(Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2));
    await h.frame(3);
  }
  if (answers.length) fail(`the ending closed with ${answers.length} answer(s) unused: ${answers.join(" | ")}`);
  const ended = films(h, from);
  for (const film of ["morph.move", "rjfade.move", "swimin.move"]) if (!ended.includes(film)) fail(`the ending plays ${film}; it played ${ended.join(", ")}`);
  ok(`the end (${ended.join(", ")}): the game is back at its menu`);
}
