/**
 * A speedrun sheet played with no page and no drawing, as fast as the CPU goes
 * (#509) — in node (`npm run speedrun -w taoot -- --headless`) and in a Web
 * Worker beside the workbench (its Calculate button).
 *
 * Under a sheet's clock (#508) a run's in-game time is passes of the game, not
 * milliseconds of anybody's machine, so a page is not needed to MEASURE a
 * sheet — only to watch one.
 *
 * The driver is the WORKBENCH's own (page-driver.ts), not another one: it is
 * handed a stand-in window and canvas instead of the play page's, so every
 * gesture — the held click, the drag, the dial's turn, the hammer — is the same
 * code the workbench runs. Two things are this file's:
 *
 *   - the FRAME. A page calls `director.tick` on every animation frame; here a
 *     frame is run whenever something asks for one (the driver's wait, or a
 *     script's `forceupdate`), on a virtual 60 Hz clock. The sheet clock takes
 *     a pass of game time from that clock every 50 ms, exactly as on a page.
 *   - where an INPUT goes, which is the game's page's business and so is handed
 *     in ({@link HeadlessGame.deliver}).
 */
import type { GameHost } from "../host";
import type { GameSession } from "../../runtime/session";
import { snapshotState } from "../../runtime/trace";
import type { SpeedrunDriver } from "./driver";
import { pageDriver, saveKeys } from "./page-driver";

/** a browser's animation frame, which is what a page's loop runs on */
const FRAME_MS = 1000 / 60;

/** a pointer or key event, as the driver builds one — the fields it sets */
export interface InputEvent {
  type: string;
  clientX?: number;
  clientY?: number;
  key?: string;
  shiftKey?: boolean;
}

/** what the page driver constructs; it reads only the fields it set */
class StandInEvent implements InputEvent {
  type: string;
  constructor(type: string, init: Record<string, unknown> = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}

/**
 * Run `fn` in a task of its own: `setImmediate` in node, a message to itself
 * elsewhere — a worker's `setTimeout(0)` is clamped to 4 ms once nested, which
 * at several tasks a frame would be most of a headless run's time.
 */
const nextTask: (fn: () => void) => void = (() => {
  const immediate = (globalThis as { setImmediate?: (fn: () => void) => void }).setImmediate;
  if (immediate) return (fn: () => void) => immediate(fn);
  const channel = new MessageChannel();
  const queue: (() => void)[] = [];
  channel.port1.onmessage = () => queue.shift()?.();
  return (fn: () => void) => {
    queue.push(fn);
    channel.port2.postMessage(0);
  };
})();

export interface HeadlessGame {
  /** the game's word for itself, as the workbench's — `taoot` */
  game: string;
  /** a fresh host, not yet booted */
  makeHost(): Promise<GameHost>;
  /**
   * What the game's page sets on a session before its boot, beyond the frame
   * (which is this file's): a save template, the sheet clock, a seed.
   */
  prepare(session: GameSession): void;
  /** where the game's page sends a pointer or key event */
  deliver(host: GameHost, e: InputEvent): void;
  getSave(name: string): Promise<Uint8Array | null>;
  putSave(name: string, bytes: Uint8Array): Promise<void>;
  seed: number | null;
  log?(message: string): void;
}

export interface HeadlessRun {
  driver: SpeedrunDriver;
  host: () => GameHost;
}

/** a booted game and the workbench's driver over it */
export async function headlessRun(game: HeadlessGame): Promise<HeadlessRun> {
  let host!: GameHost;
  let wall = 0;
  /**
   * The frames a budget counts: those in which the game could run. While the
   * engine waits on a file the game stands still and the frames spin as fast
   * as the task queue goes — over a network, a film's download was tens of
   * "seconds" of them, and a line ran out of budget waiting for nothing. The
   * same while a standing watch has halted it: the line it interrupted gave up
   * before the runner's next look at the watches came round.
   */
  let budgetWall = 0;
  let queued: FrameRequestCallback[] = [];
  let pending = false;

  /**
   * One animation frame: the page loop's tick, then everyone else who asked —
   * EACH IN A TASK OF ITS OWN, because that is what a browser gives them: it
   * settles every promise between one frame callback and the next. Called
   * back in the tick's own task, the driver looked at the game before the
   * pass's work had finished resolving, saw the boot still busy, and paid two
   * passes more than a page for the same line (#509).
   */
  const frame = (): void => {
    wall += FRAME_MS;
    if (!host.session.loadingFiles && !host.session.sheetHalted) budgetWall += FRAME_MS;
    host.director.tick(wall);
    const due = queued;
    queued = [];
    const next = (i: number): void => {
      if (i >= due.length) {
        pending = false;
        if (queued.length) {
          pending = true;
          nextTask(frame);
        }
        return;
      }
      due[i](wall);
      nextTask(() => next(i + 1));
    };
    nextTask(() => next(0));
  };
  const requestAnimationFrame = (cb: FrameRequestCallback): number => {
    queued.push(cb);
    if (!pending) {
      pending = true;
      nextTask(frame);
    }
    return queued.length;
  };

  const boot = async (): Promise<void> => {
    host = await game.makeHost();
    const s = host.session;
    // what a page sets: script poll loops wait on a real frame
    s.hasRealFrames = true;
    s.nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    game.prepare(s);
    // the first reading of the clock, as a page's first frame takes it — or the
    // first line of the sheet is charged the frame before it
    host.director.tick(wall);
    // the page's boot, from the click on GAME on: the films, the menu, the flat
    void s.track(host.coldBoot(), "coldBoot");
  };
  await boot();

  const realm = globalThis;
  // a page's `window.dbg`, for a sheet's predicates
  const dbg = {
    get viewer() {
      return host.viewer;
    },
    intro: null,
    get session() {
      return host.session;
    },
    get host() {
      return host;
    },
    snapshotState,
    loading: () => ({ ms: 0, waiting: false }),
  };
  const send = (e: InputEvent): boolean => {
    game.deliver(host, e);
    return true;
  };
  const win = {
    dbg,
    // the driver compiles a predicate with `new win.Function(body)`; this one
    // hands it `window` as the stand-in, and nothing else of this module
    Function: function (body: string) {
      const f = new realm.Function("window", body) as (w: unknown) => unknown;
      return () => f(win);
    },
    requestAnimationFrame,
    // wrapped, not handed over: the driver calls them as `win.setTimeout(…)`,
    // and a browser's own refuses a `this` that is not its global ("Illegal
    // invocation" — in the worker, at the first standing watch's poll)
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (t?: ReturnType<typeof setTimeout>) => clearTimeout(t),
    PointerEvent: StandInEvent,
    MouseEvent: StandInEvent,
    KeyboardEvent: StandInEvent,
    dispatchEvent: send,
  };
  // one client pixel per canvas pixel: `clientPointFor` then aims at the pixel
  // itself, and the game's `deliver` reads it back unchanged
  const canvas = {
    get width() {
      return host.screen.width;
    },
    get height() {
      return host.screen.height;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: host.screen.width, height: host.screen.height }),
    dispatchEvent: send,
  };

  const page = pageDriver({
    win: win as unknown as Window & typeof globalThis,
    canvas: canvas as unknown as HTMLCanvasElement,
    sheet: () => "",
    keys: saveKeys(game.game),
    log: game.log,
    // budgets on this run's own frames: the game runs as fast as the CPU goes,
    // and ten seconds of the wall would be hours of it
    budgetNow: () => budgetWall,
  });
  const driver: SpeedrunDriver = {
    ...page,
    putSave: (name, bytes) => game.putSave(name, bytes),
    getSave: (name) => game.getSave(name),
    seed: game.seed,
    // a fresh session, booted as a page would boot it after a reload
    restart: boot,
    // nobody to press Play again
    pause: undefined,
  };
  return { driver, host: () => host };
}
