/**
 * The game's doors when the page has nothing behind them, and the menu bar's
 * and the key filter's other answers (RAVEN.EXE 0x422275, 0x420fbd, 0x426b0a,
 * 0x421094, 0x420e31): with no dialog the HUD's SAVE, SOUND, KEYS and PAUSE
 * do nothing and QUIT is an OK; SOUND's Cancel changes nothing and its OK
 * changes only what changed; a key the table has no code for is no action;
 * a held key repeats in flight; the bar takes nothing while it is down;
 * File ▸ Exit ends the game; Ctrl+Q quits each day of the story; a high
 * score's Cancel is not put in; a press let go off its button is no press;
 * the last craft lost is DEADMAN and the high scores.
 *
 *   npm test -w jumpraven -- game-edges
 */
import { test } from "vitest";
import { writeRvn } from "../../src/game/rvn";
import { newRecords, AMMO_FULL } from "../../src/game/core/records";
import { SCORE_BUTTONS } from "../../src/game/data";
import { fail, ok, pass, start, haveRip } from "./harness";

test.skipIf(!haveRip())("game-edges", async () => {
  /* ---- the high scores screen with no dialogs ---- */
  {
    const logs: string[] = [];
    const named: (string | null)[] = [];
    const { game, m, input, until, key } = start({
      seed: 7,
      sco: new Uint8Array(3),
      log: (l) => logs.push(l),
      start: { level: 1, records: { score: 9_999_999 } },
      askName: (done) => (named.push(null), done(null)),
    });
    if (m.seed !== 7) fail(`the seed asked for was not the machine's: ${m.seed}`);
    // the bar is down while the game starts: a command is taken and does nothing
    if (!game.command(201) || game.titleUp) fail("File ▸ New before the bar was up");
    until("the high scores screen", () => game.phase === "scores" && game.titleUp);
    if (!logs.some((l) => l.startsWith("raven.sco:") && l.endsWith("the rip's instead"))) fail("a broken RAVEN.SCO was not set aside for the rip's");
    ok("a broken RAVEN.SCO: the rip's instead");
    if (named.length !== 1 || game.sco.places[game.difficulty - 1].some((p) => p.score === 9_999_999)) fail("a high score's Cancel was put in");
    ok("a high score asked for and cancelled: not put in");
    if (game.level !== 1) fail(`File ▸ New before the bar was up started a game: level ${game.level}`);

    // keys with no code in the table
    if (game.keyAction("Enter") !== 0 || game.keyAction("€") !== 0) fail("a key the table has no code for has an action");
    // the key filter is the story's: not on the high scores screen
    if (game.controlKey("q")) fail("Ctrl+Q was taken on the high scores screen");
    ok("no action for Enter or €, and Ctrl+Q only in the story");

    // Help ▸ About: its film, the bar down and up again
    game.command(601);
    until("about.move", () => m.film === "about.move");
    if (!logs.includes("Help ▸ About Raven")) fail("Help ▸ About was not logged as such");
    key("Escape");
    until("back from About", () => game.titleUp && m.film === null);
    ok("Help ▸ About: about.move, then the screen again");

    // Settings ▸ Keys with no dialog; a Sound item past Sound Level 7 is no volume
    game.command(406);
    until("Keys with no dialog", () => logs.includes("Settings ▸ Keys: no dialog to show"));
    const volume = m.volume;
    game.command(509);
    if (m.volume !== volume) fail("Sound item 9 changed the volume");
    // Help's fourth item is nothing the screen does
    if (!game.command(604) || m.film) fail("Help item 4 did something");
    ok("Settings ▸ Keys with no dialog, and Sound's ninth item, do nothing");

    // a press on a button let go somewhere else is no press
    const help = SCORE_BUTTONS.find((b) => b.what === "help")!;
    input.down(help.rect[1] + 4, help.rect[0] + 4);
    for (let i = 0; i < 10; i++) game.tick();
    input.up(0, 0);
    for (let i = 0; i < 30; i++) game.tick();
    if (m.film || !game.titleUp) fail("HELP let go off the button played its film");
    ok("HELP pressed and let go off it: nothing");

    // File ▸ Exit: the game over, the window with it
    if (game.command(204)) fail("File ▸ Exit was not left to the page");
    for (let i = 0; i < 10 && game.tick(); i++);
    if (game.phase !== "quit" || !game.stopped.startsWith("QUIT")) fail(`File ▸ Exit: phase ${game.phase}`);
    ok("File ▸ Exit: the game over");
  }

  /* ---- File ▸ Open of a save whose difficulty is none and whose pilot is the same ---- */
  {
    const logs: string[] = [];
    const { game, until } = start({ log: (l) => logs.push(l) });
    const r = newRecords();
    r.score = 4321;
    game.openGame(writeRvn({ difficulty: 0, level: 1, pilot: game.records.pilot, band: 2, records: r }));
    if (!logs.some((l) => l.startsWith("File ▸ Open: level 1, 0, pilot"))) fail(`the open was logged as ${logs.at(-1)}`);
    until("the opened game", () => game.phase === "scores" && game.titleUp);
    if (game.difficulty !== 2 || game.records.score !== 4321 || game.band.value !== 2) fail(`opened: difficulty ${game.difficulty}, cash ${game.records.score}, band ${game.band.value}`);
    ok("a save with difficulty 0: the difficulty kept, the rest put back, the pilot's head not reloaded");
  }

  /* ---- Ctrl+Q in each day of the story, with no question to ask: OK ---- */
  for (const level of [0, 4, 6, 8]) {
    const logs: string[] = [];
    const { game, m, until, key } = start({ log: (l) => logs.push(l), start: { level } });
    until(`level ${level}'s first film`, () => m.film !== null);
    // Ctrl+. is Esc; Ctrl+3 is Sound Level 3; Ctrl+8, Ctrl+/ and Ctrl+x are nothing
    if (!game.controlKey("3") || m.volume !== 3) fail(`Ctrl+3: volume ${m.volume}`);
    for (const k of ["8", "/", "x", "5a"]) if (game.controlKey(k)) fail(`Ctrl+${k} was taken`);
    if (!game.controlKey("q")) fail("Ctrl+Q was not taken in the story");
    if (!game.controlKey(".")) fail("Ctrl+. was not taken");
    until(`level ${level} quit`, () => (m.film && m.ticks % 30 === 0 && key("Escape"), game.phase === "scores"));
    if (!logs.includes("Quit: no dialog to show, so OK")) fail(`level ${level}: no quit was asked`);
    ok(`level ${level}: Ctrl+3 is Sound Level 3, Ctrl+Q with no dialog quits to the high scores`);
  }

  /* ---- the HUD's buttons with no dialogs, and SOUND's other answers ---- */
  {
    const logs: string[] = [];
    const f = start({ log: (l) => logs.push(l), start: { level: 3 } });
    f.until("the flight", () => f.game.world !== null);
    const hud = f.game.world!.hud;
    const press = (k: number, what: string): void => {
      const p = (hud as unknown as { menuButton(k: number): { x: number; y: number } }).menuButton(k);
      f.click(p.x, p.y);
      f.until(what, () => logs.some((l) => l.includes(what)));
      f.until("the button up again", () => hud.menu() === -1);
    };
    press(0, "SAVE: nowhere to save to");
    press(2, "Sound: no dialog to show");
    press(3, "Settings ▸ Keys: no dialog to show");
    press(4, "Pause: no dialog to show");
    ok("the HUD's SAVE, SOUND, KEYS and PAUSE with nothing behind them: logged, the flight on");
    // HELP: help.move over the flight
    const p = (hud as unknown as { menuButton(k: number): { x: number; y: number } }).menuButton(1);
    f.click(p.x, p.y);
    f.until("help.move over the flight", () => f.m.film === "help.move");
    f.key("Escape");
    f.until("the flight again", () => f.m.film === null && hud.menu() === -1);
    if (f.game.phase !== "flying") fail(`after HELP: ${f.game.phase}`);
    ok("the HUD's HELP: help.move over the flight, then the flight");
    // a held key repeats its action every turn of the loop
    const z0 = f.game.world!.cam.z;
    f.input.keyDown("ArrowUp");
    for (let i = 0; i < 60; i++) f.game.tick();
    f.input.keyUp("ArrowUp");
    if (f.game.world!.cam.z <= z0 + 2) fail(`ArrowUp held: the craft rose ${f.game.world!.cam.z - z0}`);
    ok(`ArrowUp held for 60 ticks: the craft rose ${f.game.world!.cam.z - z0}`);
    press(5, "Quit: no dialog to show, so OK");
    f.until("the high scores", () => f.game.phase === "scores");
    ok("the HUD's QUIT with no dialog: OK, the high scores");
  }
  {
    const answers: ({ volume: number; theme: boolean } | null)[] = [];
    const logs: string[] = [];
    const f = start({
      log: (l) => logs.push(l),
      start: { level: 3 },
      soundDialog: (v, t, done) => done(answers.shift() ?? null),
      askQuit: (done) => done(false),
      keysDialog: (fields, defaults, done) => done([...fields.slice(0, 5), ""]),
    });
    f.until("the flight", () => f.game.world !== null);
    const hud = f.game.world!.hud;
    const press = (k: number): void => {
      const p = (hud as unknown as { menuButton(k: number): { x: number; y: number } }).menuButton(k);
      const n = logs.length;
      f.click(p.x, p.y);
      f.until("the button pressed", () => logs.slice(n).some((l) => l.startsWith("the HUD's ")));
      f.until("the button up again", () => hud.menu() === -1);
    };
    const v0 = f.m.volume;
    const t0 = f.m.theme;
    answers.push(null);
    press(2);
    if (f.m.volume !== v0 || f.m.theme !== t0) fail("SOUND's Cancel changed something");
    answers.push({ volume: v0, theme: !t0 });
    press(2);
    if (f.m.volume !== v0 || f.m.theme === t0) fail(`SOUND, Theme only: volume ${f.m.volume}, theme ${f.m.theme}`);
    answers.push({ volume: v0, theme: t0 });
    press(2);
    if (f.m.theme !== t0 || !logs.includes(`Sound ▸ Theme ${t0 ? "on" : "off"}`) || !logs.includes(`Sound ▸ Theme ${t0 ? "off" : "on"}`)) fail("Theme was not toggled back");
    answers.push({ volume: (v0 + 1) & 7, theme: t0 });
    press(2);
    if (f.m.volume !== ((v0 + 1) & 7) || f.m.theme !== t0) fail(`SOUND, the volume only: volume ${f.m.volume}, theme ${f.m.theme}`);
    ok("SOUND: Cancel changes nothing; Theme alone toggles Theme, and back; the volume alone leaves Theme");
    // KEYS with a field left empty: that action has no key, and says so
    press(3);
    if (!logs.some((l) => l.startsWith("Settings ▸ Keys: ") && l.endsWith("-"))) fail(`KEYS with an empty field logged ${logs.filter((l) => l.startsWith("Settings ▸ Keys")).join(" | ")}`);
    if (f.game.keyAction(" ") !== 0) fail("the emptied Defense still has the space");
    ok("KEYS with the last field empty: that action unbound");
    press(5);
    if (f.game.phase !== "flying") fail("QUIT's Cancel left the flight");
    ok("QUIT's Cancel: the flight goes on");
  }

  /* ---- the last craft lost: DEADMAN and the high scores ---- */
  {
    const f = start({ start: { level: 3, records: { lives: 0 } } });
    f.until("the flight", () => f.game.world !== null);
    const w = f.game.world!;
    if (w.hud.lives() !== 0) fail(`a flight with no lives left has ${w.hud.lives()}`);
    w.hud.addShields(-AMMO_FULL);
    w.pyro.hitsCraft(w.cam, w.cam, 1, 0);
    f.until("deadman.move", () => f.game.played.includes("deadman.move"));
    f.until("the high scores", () => (f.m.film && f.m.ticks % 30 === 0 && f.key("Escape"), f.game.phase === "scores"));
    ok("the craft lost with no lives left: deadman.move, the high scores");
  }
  pass("game-edges");
});
