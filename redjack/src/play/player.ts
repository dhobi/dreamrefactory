/**
 * Who plays a RedJack route: what the moves in this folder are written against.
 *
 * Two things are one. The machine suites' harness (tests/machine/harness.ts)
 * pumps the engine in node a service pass at a time; the speedrun workbench's
 * verbs (src/speedrun/actions.ts) drive the page through the speedrun driver,
 * the game standing still between the passes the sheet grants it. Both hand
 * the moves here the same few things — the game to read, a pass to run, and a
 * hand — so a route is written once and played either way: the walk, the
 * click on a named thing, the conversation, and every set piece (the sword
 * lessons, the cannons, the gem lifts, the lava…).
 *
 * The hand is the player's and nothing else: a press, a release, the pointer
 * moved, a key down or up, each sent now and taken by the game on its own next
 * pass. What a move READS it reads off the session and the director, as the
 * suites always have; it never writes to the game.
 */
import type { GameHost } from "@dreamfactory/engine/web/host";
import type { GameSession } from "@dreamfactory/engine/runtime/session";

export interface Player {
  host: GameHost;
  session: GameSession;
  /**
   * the handlers still running, outermost first — not counting `idle ()` — and
   * a gesture still waiting in the queue to be taken after it (RedJack.exe takes
   * one an idle, 0x41e9b1): a click made is a script about to run
   */
  running(): string[];
  /** run `n` service passes */
  frame(n?: number): Promise<void>;
  /**
   * Run passes until `done()` answers true, at most `max`. Answers how many it
   * took; throws naming `what` when it ran out, so a hang says what it hung on.
   * `done` is asked between passes, and may move the hand.
   */
  until(done: () => boolean, what: string, max?: number): Promise<number>;
  /** the player has the game: the room on screen, nothing walking and no script running */
  idle(): boolean;
  /** run until the player has the game again, or the game asks a question */
  settle(what: string, max?: number): Promise<number>;
  /** who owns the screen: "movie", "puppet", "faded", "world" or "held" */
  owner(): ReturnType<GameHost["director"]["screenOwner"]>;
  /** the room's `.sett` name, without the extension */
  room(): string;
  /** the node the room stands at */
  node(): string;
  /**
   * A click: the button down at (x, y) now and up again shortly. The pointer
   * is parked in the middle after it unless `stay` — a hand that stays where it
   * clicked (a fight reads where the pointer IS, a pass later). Answers whether
   * the click is over yet.
   */
  click(x: number, y: number, stay?: boolean): () => boolean;
  /** the pointer moved to (x, y), no button down */
  point(x: number, y: number): void;
  /** the button pressed and held at (x, y), until {@link mouseUp} */
  mouseDown(x: number, y: number): void;
  /** the button let go */
  mouseUp(x: number, y: number): void;
  /**
   * A key pressed and let go, by the game's name for it ("right", "up", "."
   * with `special` for escape): a step, a turn, a press of the cannon's arrows
   */
  tap(name: string, special?: boolean): void;
  /** a key going down and HELD, until {@link keyUp} — a fight's lean */
  key(name: string, special?: boolean): void;
  /** a key coming up, as the page hands the arrows' releases over */
  keyUp(name: string): void;
}

/** a route that went somewhere it should not have — the reason is the message */
export class PlayFailure extends Error {}

export function fail(why: string): never {
  throw new PlayFailure(why);
}
