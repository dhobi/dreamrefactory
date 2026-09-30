/**
 * The menu bar's commands, through the page's own door (Input.menu), as
 * LUNICUS.EXE's WM_COMMAND posts them (0x40b80a) and its states take them —
 * the title's handler (0x418446) and a level's (0x417412).
 *
 * On the title: the bar is up only while the title is; Settings sets the
 * difficulty a new game opens with; Sound sets the level and Theme the
 * ambience; Help ▸ About plays about.move over the title (its credits round
 * and round till Esc) and gives the title back as it was. In a game: File ▸ Save is the save button, Help ▸ Help the help
 * button, and File ▸ Exit ends the game there and then — the title again, not
 * a death.
 *
 *   npm test -w lunicus -- menu
 */
import { test } from "vitest";
import { readSaveV0 } from "@dreamfactory/engine/df/savegame-v0";
import { ESCAPE_KEY } from "@dreamfactory/engine/web/keys";
import { fail, headless, ok, pass, haveRip } from "./harness";

test.skipIf(!haveRip())("menu", async () => {
  const volumes: number[] = [];
  const h = headless({
    draws: true,
    speaker: { play: () => {}, stop: () => {}, loop: () => {}, volume: (v) => volumes.push(v) },
  });
  const g = h.game;
  const m = g.m;
  // read through functions: the machine changes these under TypeScript's narrowing
  const volume = (): number => m.volume;
  const theme = (): boolean => m.theme;
  const saw = (film: string): boolean => h.logs.some((l) => l.startsWith("▶ ") && l.includes(film));

  // the intro: no bar; the title: the bar
  h.until(() => m.film === "intro.move", "the intro");
  if (g.titleUp) fail("the bar is up over the intro");
  h.until(() => g.titleUp, "the title");
  ok(`the title at tick ${m.ticks}: the bar is up`);

  // Settings ▸ Expert; File ▸ Open and Exit are the page's
  h.input.menu(404);
  if (g.progress.difficulty !== 4) fail(`Settings ▸ Expert left difficulty ${g.progress.difficulty}`);
  if (h.input.menu(202) || h.input.menu(204)) fail("File ▸ Open or Exit on the title was not left to the page");
  ok("Settings ▸ Expert: difficulty 4; Open and Exit are the page's");

  // Sound ▸ Sound Level 3 and Sound Off; Theme off and on
  h.input.menu(504);
  if (volume() !== 3 || volumes.at(-1) !== 3 / 7) fail(`Sound Level 3: volume ${volume()}, the device told ${volumes.at(-1)}`);
  h.input.menu(501);
  if (volume() !== 0 || volumes.at(-1) !== 0) fail(`Sound Off: volume ${volume()}`);
  h.input.menu(508);
  h.input.menu(510);
  if (theme()) fail("Theme is still on");
  h.input.menu(510);
  if (!theme()) fail("Theme is still off");
  ok("Sound: level 3, off, 7; Theme off and on");

  // Help ▸ About: about.move over the title, the title given back
  h.frame(30);
  const before = m.screen.pixels.slice();
  h.input.menu(601);
  h.until(() => m.film === "about.move", "about.move");
  if (g.titleUp) fail("the bar is up over About");
  // the credits go round till Esc ends them
  h.frame(600);
  h.input.press(ESCAPE_KEY);
  h.until(() => g.titleUp, "the title after About", 600);
  let same = 0;
  for (let i = 0; i < before.length; i++) if (before[i] === m.screen.pixels[i]) same++;
  if (same !== before.length) fail(`the title came back with ${before.length - same} pixels changed`);
  ok("Help ▸ About: about.move, then the title as it was");

  // File ▸ New: day one, at Expert
  h.input.menu(201);
  h.settle("the first view after first.move");
  if (g.titleUp) fail("the bar is up in the game");
  if (g.phase !== "base" || g.progress.difficulty !== 4) fail(`File ▸ New: ${g.phase}, difficulty ${g.progress.difficulty}`);
  ok(`File ▸ New: level ${g.progress.level}, difficulty 4`);

  // File ▸ Save in the game: the save button's dialog
  h.input.menu(203);
  h.settle("File ▸ Save");
  if (h.saves.length !== 1) fail(`File ▸ Save wrote ${h.saves.length} files`);
  const saved = readSaveV0(h.saves[0].bytes);
  if (saved.difficulty !== 4 || saved.level !== g.progress.level) fail(`File ▸ Save: difficulty ${saved.difficulty}, level ${saved.level}`);
  if (g.hud.mode !== 2) fail(`after File ▸ Save the mode is ${g.hud.mode}`);
  ok(`File ▸ Save: "${h.saves[0].name}", difficulty 4, level ${saved.level}`);

  // Help ▸ Help in the game: help.move, then the view
  h.input.menu(602);
  h.until(() => m.film === "help.move", "help.move");
  h.settle("the view after help.move");
  if (g.hud.mode !== 2) fail(`after Help the mode is ${g.hud.mode}`);
  ok("Help ▸ Help: help.move, then navigation");

  // the title's commands do nothing in a game
  h.input.menu(401);
  if (g.progress.difficulty !== 4) fail("Settings ▸ Beginner changed the difficulty in a game");
  h.input.menu(601);
  h.frame(60);
  if (m.film === "about.move") fail("Help ▸ About played in a game");

  // File ▸ Exit: the title again, and no death
  const deaths = g.deaths;
  h.input.menu(204);
  h.until(() => g.titleUp, "the title after File ▸ Exit");
  if (g.deaths !== deaths || g.progress.level !== 0) fail(`File ▸ Exit: level ${g.progress.level}, deaths ${g.deaths} (were ${deaths})`);
  if (!saw("help.mov")) fail("no help.mov was played");
  ok("File ▸ Exit: the title again, no death counted");
  pass("menu");
});
