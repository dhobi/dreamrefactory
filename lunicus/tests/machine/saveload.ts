/**
 * Saved games: the panel's save button and File ▸ Open, through the game's own
 * path (0x4175c3 → 0x417944, and 0x4184cc → 0x41771d), the `.LUN` file's 26
 * bytes in between (engine/src/df/savegame-v0.ts).
 *
 * Day one to its bed, then the save button on day two's first view: the file
 * holds the game as it stood. The briefing moves the game on, File ▸ Open
 * puts it back — level, progress, the HUD — and day two plays through from
 * the opened game to its bed. Then, from the title of a new machine, a save
 * of a building's fifth floor opens straight into the city, and the city plays
 * through to its node.
 *
 *   npm test -w lunicus -- saveload
 */
import { test } from "vitest";
import { readSaveV0, writeSaveV0 } from "@dreamfactory/engine/df/savegame-v0";
import { fail, headless, ok, pass, posesWith, haveRip } from "./harness";
import { playDay1 } from "./days/day1";
import { playCityDay } from "./days/city-day";
import { CityBot } from "./city-bot";

test.skipIf(!haveRip())("saveload", async () => {
  const h = headless();
  const g = h.game;
  playDay1(h);

  // the save button (the panel's second, 0x410671 → mode 1 → 0x4175c3)
  h.click(64 + 32, 0x147 + 20);
  h.settle("the save button's dialog");
  if (h.saves.length !== 1) fail(`the save button wrote ${h.saves.length} files`);
  const saved = readSaveV0(h.saves[0].bytes);
  const want = { level: 6, progress: g.progress.day, came: g.progress.came, score: g.hud.score, energy: g.hud.energy, difficulty: 2 };
  for (const [k, v] of Object.entries(want)) if (saved[k as keyof typeof saved] !== v) fail(`the save holds ${k} ${saved[k as keyof typeof saved]}, not ${v}`);
  if (g.hud.mode !== 2) fail(`after saving the mode is ${g.hud.mode}, not navigation`);
  ok(`the save button: "${h.saves[0].name}", ${h.saves[0].bytes.length} bytes — level ${saved.level}, progress ${saved.progress}, score ${saved.score}`);

  // the game moves on: day two's briefing
  h.use(posesWith(h, 0xfe, (p) => p.y >= 18)[0]);
  if (g.progress.day !== 2) fail(`the briefing left progress ${g.progress.day}`);
  const scoreBefore = g.hud.score;
  ok(`the briefing: progress 2`);

  // File ▸ Open puts it back
  g.openGame(h.saves[0].bytes);
  h.settle("the opened game's first view");
  if (g.progress.level !== saved.level || g.progress.day !== saved.progress || g.hud.score !== saved.score || g.hud.energy !== saved.energy)
    fail(`opened: level ${g.progress.level}, progress ${g.progress.day}, score ${g.hud.score}, energy ${g.hud.energy} — the file said ${JSON.stringify(saved)}`);
  if (g.progress.suit || g.progress.weapon) fail("an opened game carries the suit or the gun");
  ok(`File ▸ Open: level ${g.progress.level}, progress ${g.progress.day}, score ${g.hud.score} (it was ${scoreBefore}) at ${JSON.stringify(h.pose())}`);

  // and the opened game plays on
  playCityDay(h, 2);
  ok("day two played through from the opened game");

  // a new machine, its title, and a save of a building's fifth floor on day two
  const h2 = headless();
  const g2 = h2.game;
  h2.until(() => g2.m.film === "flip.move", "the title");
  const city = writeSaveV0({ difficulty: 2, level: 8, came: 5, elevator: 0, progress: 0, score: 1234, enemies: 10000, energy: 10000, shields: 10000, bullets: 10000, grenades: 10000, rockets: 10000 });
  g2.openGame(city);
  h2.until(() => g2.phase === "city" && !!g2.city?.world, "the opened building");
  if (g2.progress.level !== 8 || g2.progress.came !== 5 || g2.hud.score !== 1234) fail(`opened from the title: level ${g2.progress.level}, floor ${g2.progress.came}, score ${g2.hud.score}`);
  ok("File ▸ Open from the title: a building's fifth floor, day two");
  new CityBot(h2).play();
  const after = { ...g2.progress };
  if (after.level !== 5 || after.day !== 4) fail(`the opened city ended on level ${after.level}, progress ${after.day}`);
  ok(`the opened city played to its node and back up: level 5, progress 4, score ${g2.hud.score}`);
  pass("saveload");
});
