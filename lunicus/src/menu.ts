/**
 * The game window's menu bar: LUNICUS.EXE's own, on the picture's frame.
 *
 * The menus are LUNIRES.DLL's resource (src/menu.gen.ts); the bar is the
 * engine's (engine/src/web/window-bar.ts). What each command does is the EXE's
 * (Lunicus.command in game/game.ts, which cites it) — this only puts the bar up
 * when the EXE's window had it, keeps its marks, and does the two commands a
 * page has to do itself.
 *
 * When it shows. The EXE's window has the bar on the title and nowhere else: it
 * takes it down for the intro, for Help and About, and for the whole of a game
 * (0x418701), when only the accelerators reach the game. So here.
 *
 * The accelerators are LUNIRES.DLL's QUICKEYS, the hints on the items — with the
 * EXE's one slip kept: the entry for Sound Level 6 has no Ctrl flag, so it is the
 * plain 6 key, and Ctrl+6 is nothing. Of the rest, Ctrl+N and Ctrl+T never reach
 * a page; New is a click on the title as well (0x417126), Theme is on the bar.
 */
import { attachWindowBar } from "@dreamfactory/engine/web/window-bar";
import type { Lunicus } from "./game/game";
import type { Input } from "./game/input";
import { MENUS } from "./menu.gen";

export interface MenuDeps {
  /** File ▸ Open: the saved-games dialog (0x4188ef's GetOpenFileName) */
  open: () => void;
  /** the bar and its keys are the player's now (not in a replay, not under a modal) */
  live: () => boolean;
}

/** the resource's ids, by what they are */
const ID = { new: 201, open: 202, save: 203, exit: 204, difficulty: 400, cache: 407, sound: 501, theme: 510 };

export function installMenu(frame: HTMLElement, game: Lunicus, input: Input, deps: MenuDeps): { sync(): void } {
  const select = (id: string): void => {
    if (!deps.live()) return;
    const n = Number(id);
    if (input.menu(n)) return;
    if (n === ID.open) deps.open();
    // File ▸ Exit from the title quits (0x418639); a page leaves for the front door
    if (n === ID.exit) location.href = new URL("../", location.href).href;
  };
  // the QUICKEYS slip, ahead of the bar's own keys (both on window, capture):
  // a plain 6 is Sound Level 6 (id 507), anywhere, and Ctrl+6 is nothing
  addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "6" || e.altKey || e.metaKey || !deps.live()) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.ctrlKey) return e.stopImmediatePropagation();
      select(String(ID.sound + 6));
    },
    { capture: true },
  );
  const bar = attachWindowBar(frame, MENUS, { onSelect: select, accelerators: true, hidden: true, keys: deps.live });

  let drawn = "";
  return {
    /** the bar shown when the title is up, and its marks as the game has them; cheap when nothing changed */
    sync() {
      const m = game.m;
      const up = game.titleUp;
      const state = `${up}|${game.progress.difficulty}|${m.volume}|${m.theme}|${m.cacheMazes}|${game.phase}`;
      if (state === drawn) return;
      drawn = state;
      if (up) bar.show();
      else bar.hide();
      for (let d = 1; d <= 4; d++) bar.check(String(ID.difficulty + d), game.progress.difficulty === d);
      for (let v = 0; v <= 7; v++) bar.check(String(ID.sound + v), m.volume === v);
      bar.check(String(ID.theme), m.theme);
      bar.check(String(ID.cache), m.cacheMazes);
      // 0x4170bd / 0x4170d7: New and Open on the title, Save not; 0x4172b3 / 0x4172cd the other way round
      const title = game.phase === "title";
      bar.enable(String(ID.new), title);
      bar.enable(String(ID.open), title);
      bar.enable(String(ID.save), !title);
    },
  };
}
