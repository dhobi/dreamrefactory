/**
 * The game's doors when the page has nothing behind them, and the menu bar's
 * other answers (LUNICUS.EXE 0x40b80a, 0x418446, 0x417412, 0x4184cc,
 * 0x418b50, 0x40bed8):
 *
 *   - Help ▸ Help on the title plays help.move; Help's other items, and Help
 *     while the bar is down, do nothing
 *   - Settings ▸ Keys with no dialog says so; a field left empty unbinds its action
 *   - Settings ▸ Keys between the opening's films, and File ▸ New in a game, are nothing
 *   - Cache Mazes toggles
 *   - the save button with nowhere to save to says so and goes on
 *   - File ▸ Open in a base and in the city goes to the file's level from there
 *   - a file whose level is no level of the game stops the machine
 *   - the game's own files are waited for while the page fetches them, and one
 *     not in the rip is an error
 *
 *   npm test -w lunicus -- game-edges
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { writeSaveV0 } from "@dreamfactory/engine/df/savegame-v0";
import { BUTTON_LEFT, BUTTON_TOP } from "../../src/game/data";
import { Lunicus } from "../../src/lunicus";
import type { GameFiles } from "../../src/game/machine";
import { diskFiles, fail, headless, haveRip, ok, pass, RIP } from "./harness";

const save = (level: number, progress = 1): Uint8Array =>
  writeSaveV0({ difficulty: 2, level, came: 1, elevator: 0, progress, score: 500, enemies: 0, energy: 10000, shields: 0, bullets: 0, grenades: 0, rockets: 0 });

test.skipIf(!haveRip())("game-edges", async () => {
  /* ---- the title and a base, with no dialogs and nowhere to save ---- */
  {
    const h = headless({ seed: undefined, saver: undefined });
    const g = h.game;
    const m = g.m;
    if (m.seed !== 1994) fail(`no seed asked for, and the machine's is ${m.seed}`);
    h.until(() => m.film === "intro.move", "the intro");
    // Help while the bar is down: nothing
    h.input.menu(602);
    h.frame(30);
    if (m.film !== "intro.move") fail(`Help over the intro played ${m.film}`);
    h.until(() => g.titleUp, "the title");
    h.input.menu(603);
    h.frame(30);
    const film = (): string | null => m.film;
    if (film() !== "flip.move") fail(`Help's third item played ${film()}`);
    h.input.menu(602);
    h.until(() => m.film === "help.move", "help.move");
    if (!h.logs.includes("Help ▸ Help")) fail("Help ▸ Help was not logged as such");
    // out by its EXIT, the lowest of its buttons
    h.until(() => {
      if (m.filmWaiting && !m.events.length) {
        const out = [...m.filmHotspots].sort((a, b) => b.top - a.top)[0];
        if (out) h.click((out.left + out.right) >> 1, (out.top + out.bottom) >> 1);
      }
      return g.titleUp;
    }, "the title after Help");
    ok("Help ▸ Help on the title: help.move; its third item, and Help over the intro, nothing");

    const cache = m.cacheMazes;
    h.input.menu(407);
    if (m.cacheMazes === cache) fail("Cache Mazes did not toggle");
    h.input.menu(406);
    h.until(() => h.logs.includes("Settings ▸ Keys: no dialog to show"), "the keys with no dialog", 600);
    ok("Cache Mazes toggles; Settings ▸ Keys with no dialog says so");

    // File ▸ New: Settings ▸ Keys between the opening's films is nothing
    h.input.menu(201);
    h.until(() => g.phase === "opening", "the opening");
    const asked = h.logs.length;
    h.input.menu(406);
    h.settle("the first view");
    if (h.logs.slice(asked).includes("Settings ▸ Keys: no dialog to show")) fail("Settings ▸ Keys in the opening was taken");
    // File ▸ New in a game: nothing
    const level = g.progress.level;
    g.newGame();
    h.frame(30);
    if (g.phase !== "base" || g.progress.level !== level || m.events.length) fail(`File ▸ New in a game: ${g.phase}, level ${g.progress.level}`);
    ok("Settings ▸ Keys in the opening, and File ▸ New in a game, do nothing");

    // the save button with nowhere to save to
    h.click(BUTTON_LEFT[1] + 20, BUTTON_TOP + 20);
    h.settle("the save button");
    if (!h.logs.includes("the save button: nowhere to save to") || g.hud.mode !== 2) fail(`the save button with no saver: mode ${g.hud.mode}`);
    ok("the save button with nowhere to save to: says so, navigation again");

    // File ▸ Open in a base: day 3's lower floor, from here
    g.openGame(save(10));
    h.settle("day 3's lower floor");
    if (g.progress.level !== 10 || g.phase !== "base" || g.hud.score !== 500) fail(`File ▸ Open in a base: level ${g.progress.level}, score ${g.hud.score}`);
    ok("File ▸ Open in a base: the file's level and HUD");
  }

  /* ---- a key field left empty ---- */
  {
    const h = headless({ keysDialog: (fields, defaults, done) => done([...fields.slice(0, -1), ""]) });
    const g = h.game;
    h.until(() => g.titleUp, "the title");
    h.input.menu(406);
    h.until(() => h.logs.some((l) => l.startsWith("Settings ▸ Keys: ")), "the keys bound", 600);
    const line = h.logs.find((l) => l.startsWith("Settings ▸ Keys: "))!;
    if (!line.endsWith(" -")) fail(`the last action left empty: ${line}`);
    ok(`a key field left empty: ${line.slice(line.lastIndexOf(",") + 2)}`);
  }

  /* ---- File ▸ Open in the city ---- */
  {
    const h = headless();
    const g = h.game;
    h.until(() => g.titleUp, "the title");
    g.openGame(readFileSync(join(RIP, "../save/day6.lun")));
    h.until(() => g.phase === "city" && !!g.city?.world, "the hive");
    g.openGame(save(14));
    h.settle("day 4's lower floor");
    if (g.progress.level !== 14 || g.phase !== "base") fail(`File ▸ Open in the city: ${g.phase}, level ${g.progress.level}`);
    ok("File ▸ Open in the city: the file's level, a base floor");
  }

  /* ---- a level that is none ---- */
  {
    const h = headless();
    const g = h.game;
    h.until(() => g.titleUp, "the title");
    g.openGame(save(3));
    let ticks = 0;
    while (g.tick() && ticks < 10_000) ticks++;
    if (g.phase !== "not-ported" || !g.stopped.includes("level 3 is neither")) fail(`level 3: ${g.phase}, ${g.stopped}`);
    if (g.tick()) fail("the machine ticked on after it stopped");
    ok(`level 3, no level of the game: the machine stops (${g.stopped})`);
  }

  /* ---- the game's own files: waited for, or not there ---- */
  {
    const disk = diskFiles();
    const wanted: string[] = [];
    let held = 3;
    const slow: GameFiles = { ...disk, get: (p) => (p === "lunicus/lunicus.fon" && held-- > 0 ? null : disk.get(p)), want: (p) => void wanted.push(p) };
    const g = new Lunicus(slow, { log: () => {} });
    for (let i = 0; i < 20; i++) g.tick();
    if (wanted.filter((p) => p === "lunicus/lunicus.fon").length !== 3 || !g.m.font) fail(`the font waited for: wanted ${wanted.join(", ")}, font ${!!g.m.font}`);
    ok("a file of the game's own folder not yet fetched: asked for and waited on, three ticks");
    const none: GameFiles = { ...disk, has: (p) => p !== "lunicus/lunicus.fon" && disk.has(p), get: (p) => (p === "lunicus/lunicus.fon" ? null : disk.get(p)) };
    const g2 = new Lunicus(none, { draws: false });
    let err = "";
    try {
      for (let i = 0; i < 5; i++) g2.tick();
    } catch (e) {
      err = String(e);
    }
    if (!err.includes("lunicus/lunicus.fon is not in the rip")) fail(`a missing font: ${err}`);
    ok("a file of the game's own folder not in the rip: an error naming it");
  }
  pass("game-edges");
});
