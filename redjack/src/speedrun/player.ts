/**
 * The {@link Player} the routes in src/play/ are written against, over the
 * speedrun driver — so a sheet line plays the machine suites' own moves, on the
 * page or headless alike.
 *
 * A pass is the driver's `sleep(50)`: under a sheet's clock that is exactly one
 * service pass of the game (GameSession.sheetPasses), and the game stands still
 * between two. So a move here does what it does in the suites' harness: looks
 * at the game, maybe moves the hand, and lets one pass run.
 *
 * The hand is the driver's {@link Hand} — real pointer and key events at the
 * page, which main.ts (or the headless runner's `deliver`, its twin) hands to
 * the director as it would a player's. A click is the button down and up again
 * at once, as the suites' harness clicks; the pointer is then parked in the
 * middle, as theirs is, by moving it there. What a move READS it reads off
 * `window.dbg`, which on both runners is the live game.
 */
import type { GameHost } from "@dreamfactory/engine/web/host";
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import type { ActionContext } from "@dreamfactory/speedrun/action";
import type { Hand } from "@dreamfactory/speedrun/driver";
import { ESCAPE_KEY } from "@dreamfactory/engine/web/keys";
import { fail, type Player } from "../play/player";

/** one service pass of the game, as the driver counts a pause (page-driver.ts `sleep`) */
const PASS_MS = 50;
/** how long an `until` may run when the caller does not say: the suites' harness's own default */
const MAX_PASSES = 40_000;

interface Dbg {
  host: GameHost;
  session: GameSession;
}

/** the page's key for one of the game's names: the arrows by their v5 names (src/input.ts ARROWS) */
const DOM_KEYS: Record<string, string> = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", " ": "Space", space: "Space" };
const domKey = (name: string, special: boolean): string =>
  special && name === ESCAPE_KEY ? "Escape" : (DOM_KEYS[name.toLowerCase()] ?? name);

/** the player of one sheet line */
export async function playerFor(c: ActionContext): Promise<Player> {
  const d = c.d;
  const hand: Hand = d.hand ?? fail("this runner has no hand to play RedJack's moves with");
  const dbg = await d.evaluate<Dbg>("window.dbg");
  const session = (): GameSession => dbg.session;
  const director = (): GameHost["director"] => dbg.host.director;
  const centre = (): { x: number; y: number } => ({ x: director().screen.width / 2, y: director().screen.height / 2 });

  const pass = (): Promise<void> => d.sleep(PASS_MS);
  const frame = async (n = 1): Promise<void> => {
    for (let i = 0; i < n; i++) await pass();
  };
  const owner = (): ReturnType<GameHost["director"]["screenOwner"]> => director().screenOwner();
  const room = (): string => session().currentSetFile ?? "";
  const node = (): string => session().maze?.sceneName ?? "";
  const running = (): string[] => {
    const s = session();
    const n = s.interp.handlersInPlay;
    return [...Array.from({ length: n }, () => "a script"), ...(s.events.length ? [`${s.events.length} queued`] : [])];
  };
  // the harness's idle (tests/machine/harness.ts): the room has the screen,
  // nobody walks, no script runs outside the idle's own, and the view is not
  // scrolling under a pointer left in the margin
  const idle = (): boolean => {
    const s = session();
    return (
      owner() === "world" && !s.maze?.walk && director().quiescent && s.interp.handlersInPlay === 0 &&
      String(s.interp.globals.get("tnscrolling") ?? 0) !== "1"
    );
  };
  const until = async (done: () => boolean, what: string, max = MAX_PASSES): Promise<number> => {
    for (let i = 0; i < max; i++) {
      if (done()) return i;
      await pass();
    }
    if (done()) return max;
    const s = session();
    const notes = [
      director().busy ? ", director busy" : "",
      running().length ? ", running " + running().join(", ") : "",
      s.maze?.walk ? ", walking" : "",
      director().quiescent ? "" : ", not quiescent",
    ].join("");
    return fail(`stuck waiting for ${what} (${max} passes, ${owner()} at ${room()}/${node()}${notes})`);
  };
  return {
    get host() {
      return dbg.host;
    },
    get session() {
      return dbg.session;
    },
    running,
    frame,
    until,
    idle,
    settle: async (what, max) => {
      await frame(3);
      return until(() => idle() || director().awaitingChoice, `${what} to settle`, max);
    },
    owner,
    room,
    node,
    click: (x, y, stay = false) => {
      hand.press(x, y);
      hand.release(x, y);
      if (!stay) hand.move(centre().x, centre().y);
      return () => true;
    },
    point: (x, y) => hand.move(x, y),
    mouseDown: (x, y) => {
      hand.move(x, y);
      hand.press(x, y);
    },
    mouseUp: (x, y) => hand.release(x, y),
    tap: (name, special = false) => {
      const key = domKey(name, special);
      hand.keyDown(key);
      hand.keyUp(key);
    },
    key: (name, special = false) => hand.keyDown(domKey(name, special)),
    keyUp: (name) => hand.keyUp(domKey(name, false)),
  };
}
