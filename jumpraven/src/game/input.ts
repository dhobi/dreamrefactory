/**
 * The player's hands on the machine: a press, a drag, a release and a key, in
 * screen pixels, the way the page's mouse and keyboard hand them in. The page
 * and the machine tests go through this one door (Lunicus's shape,
 * `lunicus/src/game/input.ts`).
 */
import { ESCAPE_KEY } from "@dreamfactory/engine/web/keys";
import { ESCAPE } from "@dreamfactory/engine/v0/film";
import type { JumpRaven } from "./game";

/** the keys the game takes: Esc (⌘. in RAVEN.EXE's key filter, 0x420fbd) and the site's escape key (`.`) */
const KEYS = new Set(["Escape", ESCAPE_KEY]);

export class Input {
  constructor(readonly game: JumpRaven) {}

  private get m() {
    return this.game.m;
  }

  down(x: number, y: number): void {
    this.m.mouseHeld = true;
    this.m.pointer = { x, y };
    this.m.events.push({ kind: "down", x, y });
  }

  move(x: number, y: number): void {
    this.m.pointer = { x, y };
  }

  /** a mouse-up, if the press was the game's */
  up(x: number, y: number): void {
    if (!this.m.mouseHeld) return;
    this.m.mouseHeld = false;
    this.m.pointer = { x, y };
    this.m.events.push({ kind: "up", x, y });
  }

  /**
   * A key down (named as `KeyboardEvent.key` names it), `ctrl` with Ctrl or ⌘
   * held; answers whether the game took it
   */
  keyDown(key: string, ctrl = false): boolean {
    if (ctrl) return this.game.controlKey(key);
    if (!this.takes(key)) return false;
    this.m.keysHeld.add(key);
    this.m.events.push({ kind: "key", key: key === ESCAPE_KEY ? ESCAPE : key });
    return true;
  }

  /** Esc, and in flight every key RAVEN.SCO's table gives an action */
  takes(key: string): boolean {
    return KEYS.has(key) || (this.game.phase === "flying" && this.game.keyAction(key) !== 0);
  }

  keyUp(key: string): void {
    this.m.keysHeld.delete(key);
  }

  /** a menu command, by its Win32 id (src/menu.gen.ts); false for the ones the page does itself */
  menu(id: number): boolean {
    return this.game.command(id);
  }

  click(x: number, y: number): void {
    this.down(x, y);
    this.up(x, y);
  }
}
