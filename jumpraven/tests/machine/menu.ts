/**
 * The menu bar and the dialogs (RAVEN.EXE 0x422275, 0x421094, 0x420fbd,
 * 0x426b0a): the bar is up on the high scores screen and down for its films
 * and a game; Settings and Sound change what they mark; Help ▸ Help plays its
 * film; Settings ▸ Keys binds the fields; File ▸ New is a game. In the story
 * Ctrl+Q asks DLOG6 once the step is done — Cancel goes on, OK is the high
 * scores. In flight the HUD's SOUND, KEYS, PAUSE and QUIT open their dialogs.
 *
 *   npm test -w jumpraven -- menu
 */
import { test } from "vitest";
import { keyFor } from "../../src/game/sco";
import { fail, ok, pass, start, haveRip } from "./harness";

test.skipIf(!haveRip())("menu", async () => {
  /** what each dialog answers next, as the test sets it */
  const answers = { quit: false, keys: ["I", "K", "J", "L", "F", "X"], sound: { volume: 4, theme: false } };
  const asked: string[] = [];
  let kept = 0;
  const { game, m, input, until, key } = start({
    askQuit: (done) => (asked.push("quit"), done(answers.quit)),
    pause: (done) => (asked.push("pause"), done()),
    soundDialog: (v, theme, done) => (asked.push(`sound ${v} ${theme}`), done(answers.sound)),
    keysDialog: (fields, defaults, done) => (asked.push(`keys ${fields.join("")} ${defaults.join("")}`), done(answers.keys)),
    keepSco: () => kept++,
  });
  const skip = (): void => void ((m.film || game.talkState.talk) && m.ticks % 20 === 0 && key("Escape"));

  until("the high scores screen", () => (skip(), game.phase === "scores" && game.titleUp));
  ok("the bar is up on the high scores screen");

  // Settings ▸ Advanced, Sound ▸ Sound Level 3, Cache Mazes
  game.command(403);
  game.command(504);
  game.command(407);
  if (game.difficulty !== 3 || m.volume !== 3 || m.cacheMazes) fail(`difficulty ${game.difficulty}, volume ${m.volume}, cache ${m.cacheMazes}`);
  ok("Settings ▸ Advanced, Sound ▸ Sound Level 3 and Cache Mazes off");
  game.command(402);

  // Help ▸ Help: the bar down for the film, up again after
  game.command(602);
  until("help.move", () => m.film === "help.move");
  if (game.titleUp) fail("the bar stayed up over Help's film");
  key("Escape");
  until("back from Help", () => game.titleUp && m.film === null);
  ok("Help ▸ Help: help.move with the bar down, then the screen again");

  // Settings ▸ Keys
  game.command(406);
  until("the keys dialog", () => asked.some((a) => a.startsWith("keys")));
  until("the keys bound", () => kept > 0);
  const k = game.sco.keys;
  if (asked.at(-1) !== "keys WSADT  WSADT ") fail(`the dialog opened as ${JSON.stringify(asked.at(-1))}`);
  if (keyFor(k, 1) !== "I" || k[0x69] !== 1 || k[0x1e] !== 1 || k[0x57] !== 0 || game.keyAction("x") !== 6) fail("the keys were not bound as the fields had them");
  ok("Settings ▸ Keys: the fields bound, both cases, the arrows kept, RAVEN.SCO kept");

  // File ▸ New: a game, the bar down
  game.command(201);
  until("day one's first briefing", () => game.talkState.talk?.file === "DAY1/BAT1.PUP");
  if (game.titleUp) fail("the bar stayed up in a game");
  ok("File ▸ New: day one, the bar down");

  // Ctrl+Q in the story: DLOG6 after the step, Cancel goes on
  input.keyDown("q", true);
  key("Escape");
  until("the question", () => asked.includes("quit"));
  until("the enemies' film", () => m.film === "enem.move");
  ok("Ctrl+Q, Cancel: the story goes on");
  answers.quit = true;
  input.keyDown("q", true);
  key("Escape");
  until("the high scores again", () => game.phase === "scores" && game.titleUp);
  if (asked.filter((a) => a === "quit").length !== 2) fail(`asked ${asked.join(", ")}`);
  ok("Ctrl+Q, OK: the high scores screen");

  // the HUD's buttons in flight, and the band's theme tune on channel 3
  {
    /** what channel 3 was told, in order: the samples' length, or 0 for silence */
    const looped: number[] = [];
    const f = start({
      start: { level: 3 },
      speaker: { play: () => {}, stop: () => {}, loop: (s) => void looped.push(s ? s.length : 0) },
      askQuit: (done) => done(true),
      pause: (done) => (asked.push("pause"), done()),
      soundDialog: (v, theme, done) => (asked.push(`sound ${v} ${theme}`), done(answers.sound)),
      keysDialog: (fields, defaults, done) => (asked.push("flight keys"), done(null)),
    });
    f.until("the flight", () => f.game.world !== null);
    // 0x40bb53 → 0x4233ba: the chosen band's (tek, the default) pieces strung, round and round
    if (!f.m.ambience || f.m.ambience.name !== "tek" || looped.length !== 1 || looped[0] !== f.m.ambience.samples.length) {
      fail(`the flight's theme: ${f.m.ambience?.name} ${looped.join(",")}`);
    }
    ok(`the flight's theme: the band's pieces strung (${(looped[0] / f.m.ambience.rate).toFixed(1)} s) and looped`);
    const hud = f.game.world!.hud as unknown as { menuButton(k: number): { x: number; y: number } };
    const press = (k: number): void => {
      const p = hud.menuButton(k);
      f.click(p.x, p.y);
    };
    press(2);
    f.until("SOUND", () => f.game.m.volume === 4);
    if (asked.at(-1) !== "sound 7 true" || f.game.m.theme) fail(`SOUND opened as ${asked.at(-1)}, theme ${f.game.m.theme}`);
    // 0x4210b4 silences the theme for the dialog; Theme off, 0x4233ba does not start it again
    f.until("the button up again", () => f.game.world?.hud.menu() === -1);
    if (looped.slice(1).some((n) => n !== 0) || f.m.ambiencePlaying !== true) fail(`the theme after SOUND with Theme off: ${looped.join(",")}`);
    ok("the HUD's SOUND: the theme silenced for its dialog, and left silent with Theme off");
    press(3);
    f.until("KEYS", () => asked.at(-1) === "flight keys");
    press(4);
    f.until("PAUSE", () => asked.at(-1) === "pause");
    if (f.game.world!.hud.menu() !== -1) fail("a button stayed down");
    ok("the HUD's SOUND, KEYS and PAUSE: their dialogs, the button up again after");
    press(5);
    f.until("QUIT's OK: the high scores", () => f.game.phase === "scores");
    if (f.m.ambiencePlaying || looped.at(-1) !== 0) fail(`the theme after the flight: ${looped.join(",")}`);
    ok("the HUD's QUIT, OK: the high scores");
  }
  pass("menu");
});
