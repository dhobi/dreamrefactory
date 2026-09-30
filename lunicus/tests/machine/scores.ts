/**
 * LUNICUS.SCO — the key table and the high scores (src/game/sco.ts) — and the
 * two dialogs that change it, answered here the way a player would.
 *
 * The rip's file is the EXE's defaults. Settings ▸ Keys (0x418b50) shows the
 * table's keys, and what OK binds is what the city and the base walk by
 * (0x4173ff); Default is the EXE's own table, Cancel keeps the old one. A game
 * that ends past the seventh place asks for a name as the title opens again
 * (0x41733d), puts it in its place (0x417a44), keeps the file and shows it on the
 * title's plate (0x417b01).
 *
 *   npm test -w lunicus -- scores
 */
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACTIONS, defaultSco, readSco, writeSco } from "../../src/game/sco";
import { RIP, fail, headless, ok, pass, haveRip } from "./harness";

test.skipIf(!haveRip())("scores", async () => {
  // the rip's lunicus.sco: the defaults, with leftovers after the empty names
  const shipped = new Uint8Array(readFileSync(join(RIP, "lunicus", "lunicus.sco")));
  const fromRip = readSco(shipped);
  const defaults = defaultSco();
  if (writeSco(fromRip).subarray(0, 0x100).some((b, i) => b !== shipped[i])) fail("the key table does not come back as the rip has it");
  if (JSON.stringify(fromRip.scores) !== JSON.stringify(defaults.scores)) fail(`the rip's places are not the defaults: ${JSON.stringify(fromRip.scores[0])}`);
  if (fromRip.keys.some((b, i) => b !== defaults.keys[i])) fail("the rip's key table is not the EXE's own (0x428674)");
  ok("the rip's lunicus.sco: the EXE's key table and 28 empty places");

  // a player's answers to the dialogs, and the file as the page would keep it
  let fieldsAnswer: string[] | null = null;
  const shown: string[][] = [];
  let nameAnswer: string | null = "Tester";
  let asked = 0;
  const times = (): number => asked;
  let kept: Uint8Array | null = null;
  const h = headless({
    draws: true,
    keysDialog: (fields, dflt, done) => (shown.push(fields, dflt), done(fieldsAnswer)),
    askName: (done) => (asked++, done(nameAnswer)),
    keepSco: (bytes) => (kept = bytes),
  });
  const g = h.game;
  const m = g.m;
  const keptSco = () => (kept ? readSco(kept) : fail("nothing kept"));

  h.until(() => g.titleUp, "the title");
  // the plate: the title's lower band is drawn, and not in one colour
  const band = m.screen.pixels.subarray(264 * 512);
  if (new Set(band).size < 16) fail(`the plate under the title is ${new Set(band).size} colours`);
  if (times()) fail("a name was asked for with no game played");
  ok("the title: the plate under it, no name asked for");

  // Settings ▸ Keys on the title: the table's keys; OK with I J L for the steps
  fieldsAnswer = ["I", "J", "L", "N", "B", "G", "R"];
  h.input.menu(406);
  h.frame(2);
  if (shown[0]?.join("") !== "WADHJKL" || shown[1]?.join("") !== "WADHJKL") fail(`the dialog showed ${shown[0]} with defaults ${shown[1]}`);
  if (m.action("i") !== 1 || m.action("I") !== 1 || m.action("w") !== 0 || m.action("ArrowUp") !== 1) fail("OK did not bind I as forward (and the arrows kept)");
  if (m.action("n") !== 4 || m.action("r") !== 7) fail("OK did not bind N and R");
  if (keptSco().keys[0x49] !== 1) fail("the new table was not kept");
  if (!g.titleUp) fail("the bar did not come back after the dialog");
  ok(`Settings ▸ Keys: ${ACTIONS.map((a, i) => `${a} ${fieldsAnswer![i]}`).join(", ")}, kept`);

  // a new game: the base turns by J, not by A (it wakes in bed, where forward goes nowhere)
  h.input.menu(201);
  h.settle("the first view after first.move");
  const at = JSON.stringify(h.pose());
  h.key("a");
  h.settle("after A");
  if (JSON.stringify(h.pose()) !== at) fail(`A still turns: ${at} → ${JSON.stringify(h.pose())}`);
  h.key("j");
  h.settle("after J");
  if (JSON.stringify(h.pose()) === at) fail(`J does not turn: still ${at}`);
  ok(`the base turns by J: ${at} → ${JSON.stringify(h.pose())}; A does nothing`);

  // Settings ▸ Keys in a game: Cancel keeps the table
  fieldsAnswer = null;
  h.input.menu(406);
  h.settle("the Keys dialog in the game");
  if (shown[2]?.join("") !== "IJLNBGR") fail(`the dialog in the game showed ${shown[2]}`);
  if (m.action("i") !== 1) fail("Cancel changed the table");
  // OK with the defaults: W walks again
  fieldsAnswer = shown[3];
  h.input.menu(406);
  h.settle("the Keys dialog again");
  if (m.action("w") !== 1 || m.action("i") !== 0) fail("the defaults did not come back");
  ok("Settings ▸ Keys in a game: Cancel keeps the table, the defaults put back");

  // a score past the seventh place: File ▸ Exit, the title, the name
  g.hud.score = 4321;
  h.input.menu(204);
  h.until(() => g.titleUp, "the title after File ▸ Exit", 20_000);
  if (times() !== 1) fail(`a name was asked for ${asked} times`);
  const places = keptSco().scores[g.progress.difficulty - 1];
  if (places[0].name !== "Tester" || places[0].score !== 4321) fail(`the first place is ${JSON.stringify(places[0])}`);
  if (m.sco.scores[g.progress.difficulty - 1][0].name !== "Tester") fail("the game's own block has no Tester");
  ok(`a high score: "Tester" 4321, first of ${places.length}, kept`);

  // the next game: a lower score goes under it, and Cancel puts none in
  h.input.menu(201);
  h.settle("the second game's first view");
  g.hud.score = 100;
  nameAnswer = null;
  h.input.menu(204);
  h.until(() => g.titleUp, "the title after the second game", 20_000);
  if (times() !== 2) fail(`100 past an empty seventh place asked ${asked - 1} more times`);
  if (m.sco.scores[g.progress.difficulty - 1].some((p) => p.score === 100)) fail("Cancel put the score in");
  ok("a second game: asked again, Cancel put nothing in");
  pass("scores");
});
