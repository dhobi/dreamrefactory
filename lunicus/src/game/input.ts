/**
 * The player's hands on the machine: a press, a drag, a release and a key, in
 * screen pixels, the way the page's mouse and keyboard hand them in. The page
 * and the machine tests go through this one door, so a test's gestures are
 * the page's to the letter — which is what lets a browser replay a machine
 * run's gestures tick for tick (`tests/browser/playthrough.ts`).
 */
import { ESCAPE_KEY } from "@dreamfactory/engine/web/keys";
import { ESCAPE } from "./film";
import type { Lunicus } from "./game";

/** one gesture, as a recording keeps it: the tick it came before, and what it was */
export type Gesture =
  | { t: number; g: "down" | "up" | "move"; x: number; y: number }
  | { t: number; g: "keydown" | "keyup"; key: string };

/** a checkpoint of a recording: the state a replay must be in at tick `t` */
export interface Checkpoint {
  t: number;
  what: string;
  phase: string;
  level: number;
  progress: number;
  score: number;
  won: boolean;
}

/** a machine run as a browser can replay it (tests/browser/playthrough.ts) */
export interface Recording {
  seed: number;
  /** every file the machine read: a replay fetches them first, so no tick waits on the network */
  files: string[];
  gestures: Gesture[];
  checkpoints: Checkpoint[];
  ticks: number;
}

/**
 * the arrows and LUNICUS.EXE's own keys (table 0x428674): W A D walk, H J K L
 * the buttons, space a rocket — and the site's escape key (`.`), which skips a film
 */
export const GAME_KEYS = new Set(["ArrowUp", "ArrowLeft", "ArrowRight", "ArrowDown", ESCAPE_KEY, "w", "a", "d", "h", "j", "k", "l", " "]);

export class Input {
  constructor(
    readonly game: Lunicus,
    /** a recording's ear: every gesture, as it comes */
    readonly heard?: (g: Gesture) => void,
  ) {}

  private get m() {
    return this.game.m;
  }

  /** a mouse-down; on the title it is File ▸ New */
  down(x: number, y: number): void {
    this.heard?.({ t: this.m.ticks, g: "down", x, y });
    if (this.game.phase === "title") return this.game.newGame();
    this.m.mouseHeld = true;
    this.m.pointer = { x, y };
    this.m.events.push({ kind: "down", x, y });
  }

  move(x: number, y: number): void {
    this.heard?.({ t: this.m.ticks, g: "move", x, y });
    this.m.pointer = { x, y };
  }

  /** a mouse-up, if the press was the game's */
  up(x: number, y: number): void {
    this.heard?.({ t: this.m.ticks, g: "up", x, y });
    if (!this.m.mouseHeld) return;
    this.m.mouseHeld = false;
    this.m.events.push({ kind: "up", x, y });
  }

  /** a key down (named as `KeyboardEvent.key` names it); answers whether the game took it */
  keyDown(key: string): boolean {
    this.heard?.({ t: this.m.ticks, g: "keydown", key });
    if (this.game.phase === "title" && (key === "Enter" || key === " ")) return (this.game.newGame(), true);
    if (!GAME_KEYS.has(key.length === 1 ? key.toLowerCase() : key)) return false;
    this.m.keysHeld.add(key);
    this.m.events.push({ kind: "key", key: key === ESCAPE_KEY ? ESCAPE : key });
    return true;
  }

  keyUp(key: string): void {
    this.heard?.({ t: this.m.ticks, g: "keyup", key });
    this.m.keysHeld.delete(key);
  }

  /** a press and a release on the spot */
  click(x: number, y: number): void {
    this.down(x, y);
    this.up(x, y);
  }

  /** a key pressed and let go */
  press(key: string): void {
    this.keyDown(key);
    this.keyUp(key);
  }
}
