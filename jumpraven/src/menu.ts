/**
 * The game window's menu bar: RAVEN.EXE's own, on the picture's frame.
 *
 * The menus are RAVENRES.DLL's resource (src/menu.gen.ts); the bar is the
 * engine's (engine/src/web/window-bar.ts). What each command does is the EXE's
 * (JumpRaven.command in game/game.ts, which cites it) — this only puts the bar
 * up when the EXE's window had it, keeps its marks, and does the commands a
 * page has to do itself.
 *
 * When it shows. The EXE puts the bar up on the high scores screen and
 * nowhere else (0x422558, called only from 0x420840 and Help's 0x4214cd): it
 * comes down for the screen's films and for the whole of a game. RAVENRES.DLL
 * has no accelerator table and the items no Ctrl hints; the Ctrl keys a game
 * hears are the films' key filter's (0x420fbd), which the page hands in.
 *
 * The marks are the EXE's CheckMenuItem calls: the difficulty (0x4215c5), the
 * volume (0x421644) and Cache Mazes. Its New/Open/Save are never greyed.
 */
import { attachWindowBar } from "@dreamfactory/engine/web/window-bar";
import type { JumpRaven } from "./game/game";
import type { Input } from "./game/input";
import { MENUS } from "./menu.gen";

export interface MenuDeps {
  /** File ▸ Open: the saved games (0x4226ef's GetOpenFileName) */
  open: () => void;
  /** Help ▸ Memory: the EXE's MessageBox (0x422431) */
  memory: () => void;
  /** File ▸ Exit: the window closed (0x4222fb(4)) */
  exit: () => void;
  /** the bar and its keys are the player's now (not under a modal) */
  live: () => boolean;
}

/** the resource's ids, by what they are */
const ID = { open: 202, exit: 204, difficulty: 400, cache: 407, sound: 501, memory: 603 };

export function installMenu(frame: HTMLElement, game: JumpRaven, input: Input, deps: MenuDeps): { sync(): void } {
  const select = (id: string): void => {
    if (!deps.live()) return;
    const n = Number(id);
    if (input.menu(n)) return;
    if (n === ID.open) deps.open();
    if (n === ID.memory) deps.memory();
    if (n === ID.exit) deps.exit();
  };
  const bar = attachWindowBar(frame, MENUS, { onSelect: select, hidden: true, keys: deps.live });

  let drawn = "";
  return {
    /** the bar shown when the high scores screen is up, and its marks as the game has them; cheap when nothing changed */
    sync() {
      const m = game.m;
      const up = game.titleUp;
      const state = `${up}|${game.difficulty}|${m.volume}|${m.cacheMazes}`;
      if (state === drawn) return;
      drawn = state;
      if (up) bar.show();
      else bar.hide();
      for (let d = 1; d <= 4; d++) bar.check(String(ID.difficulty + d), game.difficulty === d);
      for (let v = 0; v <= 7; v++) bar.check(String(ID.sound + v), m.volume === v);
      bar.check(String(ID.cache), m.cacheMazes);
    },
  };
}
