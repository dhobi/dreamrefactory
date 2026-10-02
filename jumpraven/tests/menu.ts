/**
 * The game window's menu bar on the page (src/menu.ts), on the game itself.
 *
 *   npx vitest run jumpraven/tests/menu.ts
 *
 * The machine suite `tests/machine/menu.ts` sends the commands straight to
 * `JumpRaven.command`; this pins the page's half of the bar, in a linkedom
 * document, with a game that has not started (no rip is read):
 *
 *   - the bar is down until the high scores screen is up (0x422558), and
 *     down again when it goes
 *   - its marks are the game's: the difficulty (0x4215c5), the volume
 *     (0x421644) and Cache Mazes
 *   - an item goes to the game through the page's own door (Input.menu), and
 *     the three the game leaves to the page — File ▸ Open, Help ▸ Memory and
 *     File ▸ Exit — are the page's
 *   - under a dialog of the page's, the bar's items do nothing
 */
import { beforeEach, expect, test } from "vitest";
import { parseHTML } from "linkedom";
import { JumpRaven } from "../src/game/game";
import { Input } from "../src/game/input";
import type { GameFiles } from "../src/game/machine";
import { installMenu } from "../src/menu";

/** no rip: the menu never reads one, and the game is never ticked */
const NO_FILES: GameFiles = { has: () => false, get: () => null, want: () => {} };

let frame: HTMLElement;
let ElEvent: typeof Event;
beforeEach(() => {
  const w = parseHTML(`<html><body><div id="frame"><canvas id="screen"></canvas></div></body></html>`);
  ElEvent = w.Event as unknown as typeof Event;
  frame = w.document.getElementById("frame") as unknown as HTMLElement;
  const win = new EventTarget();
  const g = globalThis as Record<string, unknown>;
  g.document = w.document;
  g.addEventListener = win.addEventListener.bind(win);
  g.removeEventListener = win.removeEventListener.bind(win);
  g.ResizeObserver = class {
    observe(): void {}
    disconnect(): void {}
  };
});

const fire = (el: Element, type: string): void => void el.dispatchEvent(new ElEvent(type, { bubbles: true, cancelable: true }));
const bar = (): HTMLElement => frame.querySelector<HTMLElement>(".wbar")!;
const item = (id: number): HTMLElement => frame.querySelector<HTMLElement>(`.wbar-item[data-id="${id}"]`)!;
const marked = (id: number): boolean => item(id).getAttribute("aria-checked") === "true";
/** the menu that holds the item opened, and the item clicked */
const choose = (id: number): void => {
  const menu = [...frame.querySelectorAll<HTMLElement>(".wbar-drop")].findIndex((d) => d.contains(item(id)));
  fire(frame.querySelectorAll<HTMLElement>(".wbar-title")[menu], "pointerdown");
  fire(item(id), "click");
};

function setup(live = () => true) {
  const game = new JumpRaven(NO_FILES, { draws: false });
  const asked: string[] = [];
  const menu = installMenu(frame, game, new Input(game), {
    open: () => asked.push("open"),
    memory: () => asked.push("memory"),
    exit: () => asked.push("exit"),
    live,
  });
  return { game, asked, menu };
}

test("the bar is down until the high scores screen is up, and down again after it", () => {
  const { game, menu } = setup();
  menu.sync();
  expect(bar().hidden).toBe(true);
  expect(frame.classList.contains("wbar-on")).toBe(false);
  game.titleUp = true;
  menu.sync();
  expect(bar().hidden).toBe(false);
  expect(frame.classList.contains("wbar-on")).toBe(true);
  game.titleUp = false;
  menu.sync();
  expect(bar().hidden).toBe(true);
});

test("the marks are the game's difficulty, volume and Cache Mazes, and follow them", () => {
  const { game, menu } = setup();
  game.titleUp = true;
  menu.sync();
  // Intermediate, Sound Level 7 and Cache Mazes from the start (0x42087d, 0x420924)
  expect([401, 402, 403, 404].filter(marked)).toEqual([402]);
  expect([501, 502, 503, 504, 505, 506, 507, 508].filter(marked)).toEqual([508]);
  expect(marked(407)).toBe(true);

  game.difficulty = 4;
  game.m.volume = 0;
  game.m.cacheMazes = false;
  menu.sync();
  expect([401, 402, 403, 404].filter(marked)).toEqual([404]);
  expect([501, 502, 503, 504, 505, 506, 507, 508].filter(marked)).toEqual([501]);
  expect(marked(407)).toBe(false);
});

test("an item is the game's command: Settings and Sound change the game, and the marks with them", () => {
  const { game, asked, menu } = setup();
  game.titleUp = true;
  menu.sync();
  choose(403);
  choose(504);
  choose(407);
  expect(game.difficulty).toBe(3);
  expect(game.m.volume).toBe(3);
  expect(game.m.cacheMazes).toBe(false);
  expect(asked).toEqual([]);
  menu.sync();
  expect([401, 402, 403, 404].filter(marked)).toEqual([403]);
  expect(marked(504)).toBe(true);
  expect(marked(407)).toBe(false);
});

test("File ▸ Open, Help ▸ Memory and File ▸ Exit are the page's; Exit ends the game as well", () => {
  const { game, asked, menu } = setup();
  game.titleUp = true;
  menu.sync();
  choose(202);
  choose(603);
  expect(asked).toEqual(["open", "memory"]);
  choose(204);
  expect(asked).toEqual(["open", "memory", "exit"]);
  // 0x4222fb(4): the game's own half of Exit — the run ends at its next turn
  expect((game as unknown as { running: boolean }).running).toBe(false);
});

test("under a dialog of the page's the items do nothing", () => {
  let live = false;
  const { game, asked, menu } = setup(() => live);
  game.titleUp = true;
  menu.sync();
  choose(404);
  choose(202);
  expect(game.difficulty).toBe(2);
  expect(asked).toEqual([]);
  live = true;
  choose(202);
  expect(asked).toEqual(["open"]);
});
