/**
 * The page's menu bar (`src/menu.ts`): what it shows, what its picks do, and
 * the QUICKEYS slip it keeps.
 *
 *   npx vitest run lunicus/tests/menu-bar.ts
 *
 * The machine suite `tests/machine/menu.ts` drives the commands through
 * `Input.menu`, the door this module opens; this pins the module itself, which
 * until now only ever ran in a browser:
 *
 *   - **the bar is up on the title and nowhere else** (0x418701), its marks
 *     the game's difficulty, sound level, Theme and Cache Mazes, New and Open
 *     live on the title and Save in a game (0x4170bd, 0x4172b3);
 *   - **a pick is the game's while the player has the bar** — not in a replay,
 *     not under a modal — and the two the game leaves to the page are the
 *     page's: File ▸ Open the saves dialog, File ▸ Exit the front door;
 *   - **a plain 6 is Sound Level 6 and Ctrl+6 is nothing**: LUNIRES.DLL's
 *     accelerator for it has no Ctrl flag.
 *
 * The bar is the engine's DOM widget (`engine/src/web/window-bar.ts`, pinned by
 * `engine/tests/window-bar.ts`), replaced here by a twin that records what it
 * was told. The game is the real one, on no files: nothing here ticks it.
 */
import { test, expect, beforeEach, vi } from "vitest";
import type { WindowBarOptions } from "@dreamfactory/engine/web/window-bar";
import { Lunicus } from "../src/game/game";
import { Input } from "../src/game/input";

/** what the twin bar was told */
const bar = vi.hoisted(() => ({
  opts: null as WindowBarOptions | null,
  visible: false,
  checked: new Map<string, boolean>(),
  enabled: new Map<string, boolean>(),
  calls: 0,
}));

vi.mock("@dreamfactory/engine/web/window-bar", () => ({
  attachWindowBar: (_frame: unknown, _menus: unknown, opts: WindowBarOptions) => {
    bar.opts = opts;
    bar.visible = !opts.hidden;
    return {
      show: () => (bar.calls++, (bar.visible = true)),
      hide: () => (bar.calls++, (bar.visible = false)),
      check: (id: string, on: boolean) => (bar.calls++, bar.checked.set(id, on)),
      enable: (id: string, on: boolean) => (bar.calls++, bar.enabled.set(id, on)),
    };
  },
}));

const { installMenu } = await import("../src/menu");

type KeyHandler = (e: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; target?: { tagName: string } | null; stopImmediatePropagation?: () => void }) => void;
let keydown: KeyHandler;
let live = true;
let opened = 0;
const where = { href: "https://example.test/lunicus/" };

/** a game on its title, flip.move round and round, and the bar on it */
function setUp() {
  const game = new Lunicus({ has: () => false, get: () => null, want: () => {} }, { draws: false });
  game.phase = "title";
  game.m.film = "flip.move";
  const input = new Input(game);
  const menu = installMenu({} as HTMLElement, game, input, { open: () => opened++, live: () => live });
  return { game, input, menu };
}

beforeEach(() => {
  bar.opts = null;
  bar.checked.clear();
  bar.enabled.clear();
  bar.calls = 0;
  live = true;
  opened = 0;
  where.href = "https://example.test/lunicus/";
  vi.stubGlobal("location", where);
  vi.stubGlobal("addEventListener", (type: string, fn: KeyHandler, o: { capture?: boolean }) => {
    if (type === "keydown" && o?.capture) keydown = fn;
  });
});

test("the bar is up on the title with the game's marks, New and Open live and Save greyed", () => {
  const { game, menu } = setUp();
  expect(bar.visible, "attached hidden").toBe(false);
  menu.sync();
  expect(bar.visible).toBe(true);
  // a new game opens at Intermediate, the device at level 7, Theme and Cache Mazes on
  expect([401, 402, 403, 404].map((id) => bar.checked.get(String(id)))).toEqual([false, true, false, false]);
  expect([501, 502, 503, 504, 505, 506, 507, 508].filter((id) => bar.checked.get(String(id)))).toEqual([508]);
  expect(bar.checked.get("510")).toBe(true);
  expect(bar.checked.get("407")).toBe(true);
  expect([bar.enabled.get("201"), bar.enabled.get("202"), bar.enabled.get("203")]).toEqual([true, true, false]);
  expect(game.titleUp).toBe(true);
});

test("in a game the bar is down, and Save is the one of the three left live", () => {
  const { game, menu } = setUp();
  menu.sync();
  game.phase = "base";
  menu.sync();
  expect(bar.visible).toBe(false);
  expect([bar.enabled.get("201"), bar.enabled.get("202"), bar.enabled.get("203")]).toEqual([false, false, true]);
});

test("a sync with nothing changed tells the bar nothing; a changed mark is redrawn", () => {
  const { game, menu } = setUp();
  menu.sync();
  const after = bar.calls;
  menu.sync();
  expect(bar.calls).toBe(after);
  game.m.volume = 3;
  menu.sync();
  expect(bar.calls).toBeGreaterThan(after);
  expect(bar.checked.get("504")).toBe(true);
  expect(bar.checked.get("508")).toBe(false);
});

test("a pick goes to the game while the player has the bar, and nowhere while not", () => {
  const { game } = setUp();
  bar.opts!.onSelect("404");
  expect(game.progress.difficulty).toBe(4);
  live = false;
  bar.opts!.onSelect("401");
  expect(game.progress.difficulty, "a pick under a modal reached the game").toBe(4);
  expect(bar.opts!.keys!()).toBe(false);
});

test("File ▸ Open on the title is the page's saves dialog, and File ▸ Exit the front door", () => {
  setUp();
  bar.opts!.onSelect("202");
  expect(opened).toBe(1);
  expect(where.href).toBe("https://example.test/lunicus/");
  bar.opts!.onSelect("204");
  expect(where.href).toBe("https://example.test/");
  expect(opened).toBe(1);
});

test("a plain 6 is Sound Level 6 and Ctrl+6 is nothing, as LUNIRES.DLL's QUICKEYS have it", () => {
  const { game } = setUp();
  const stop = vi.fn();
  keydown({ key: "6", ctrlKey: true, target: null, stopImmediatePropagation: stop });
  expect(stop, "Ctrl+6 must not reach the bar's own accelerators").toHaveBeenCalledOnce();
  expect(game.m.volume).toBe(7);
  keydown({ key: "6", target: null });
  expect(game.m.volume).toBe(6);
});

test("a 6 typed into a field, with Alt, or under a modal is not Sound Level 6", () => {
  const { game } = setUp();
  game.m.volume = 2;
  keydown({ key: "6", target: { tagName: "INPUT" } });
  keydown({ key: "6", target: { tagName: "TEXTAREA" } });
  keydown({ key: "6", altKey: true, target: null });
  live = false;
  keydown({ key: "6", target: null });
  expect(game.m.volume).toBe(2);
  live = true;
  keydown({ key: "7", target: null });
  expect(game.m.volume, "another digit is the bar's, not this handler's").toBe(2);
});
