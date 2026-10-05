/**
 * A speedrun sheet played in node, with no browser and no drawing (#509).
 *
 *   npm run speedrun -w taoot -- --headless
 *
 * Under a sheet's clock (#508) a run's in-game time is passes of the game, not
 * milliseconds of anybody's machine, so the browser is not needed to MEASURE a
 * sheet — only to watch one. This plays it against the same `GameHost` the
 * playthrough suites drive (tests/harness.ts), as fast as node goes.
 *
 * The driver is the WORKBENCH's own (engine/src/web/speedrun/page-driver.ts),
 * not a third one: it is handed a stand-in window and canvas instead of the
 * play page's. So every gesture — the held click, the drag, the dial's turn,
 * the hammer — is the same code the workbench runs, and only two things are
 * this file's:
 *
 *   - the FRAME. A browser calls `director.tick` on every animation frame; here
 *     a frame is run whenever something asks for one (the driver's wait, or a
 *     script's `forceupdate`), with a virtual 60 Hz clock. The sheet clock takes
 *     a pass of game time from that clock every 50 ms, exactly as on a page.
 *   - the INPUT. A pointer or key event goes where taoot/src/main.ts sends it —
 *     {@link deliver} is that page's handlers with the page taken out (the touch
 *     recogniser, the input log, the gamma and pane keys). Keep the two in step.
 *
 * What it cannot do is what the workbench cannot: `travel`, `hunt` and `stand`
 * through the pathfinder.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GameHost } from "@dreamfactory/engine/web/host";
import { snapshotState } from "@dreamfactory/engine/runtime/trace";
import { pageDriver, saveKeys } from "@dreamfactory/engine/web/speedrun/page-driver";
import type { SpeedrunDriver } from "@dreamfactory/engine/web/speedrun/driver";
import { overlayKey } from "../../src/play-rules";
import { newHost } from "../harness";
import { shippedSaveTemplate } from "../playthrough/play";

/** a browser's animation frame, which is what the page's loop runs on */
const FRAME_MS = 1000 / 60;

interface Ev {
  type: string;
  clientX?: number;
  clientY?: number;
  key?: string;
  shiftKey?: boolean;
}

/** what the page driver constructs; it reads only the fields it set */
class StandInEvent implements Ev {
  type: string;
  constructor(type: string, init: Record<string, unknown> = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}

/**
 * taoot/src/main.ts's input handlers, minus the page: a press goes to the
 * director, a release ends a drag where the pointer last was, a move tracks the
 * pointer mid-drag and hovers otherwise, and a key is routed as the keydown
 * handler routes it.
 */
function deliver(host: GameHost, e: Ev): void {
  const session = host.session;
  const x = Math.floor(e.clientX ?? 0);
  const y = Math.floor(e.clientY ?? 0);
  const toGame = (name: string, special = false): void =>
    void session.track(host.director.keyDown(name, special));
  const arrow = (name: "uparrow" | "leftarrow" | "rightarrow"): void => {
    const v = host.viewer;
    if (!v) return;
    if (!session.viewShowing && session.stageCtrl.keydownTarget()) void session.track(v.keyDown(name, false));
    else void session.track(v.pressNav(name));
  };
  switch (e.type) {
    case "pointerdown":
      session.setPointer(x, y);
      session.pointerDown = true;
      session.shiftDown = !!e.shiftKey;
      void session.track(host.director.press(x, y), `press ${x},${y}`);
      return;
    case "pointerup":
      session.pointerDown = false;
      host.director.release(session.pointerX, session.pointerY);
      return;
    case "mousemove":
      if (session.pointerDown) session.setPointer(x, y);
      else void host.director.hover(x, y);
      return;
    case "keydown": {
      const key = e.key ?? "";
      if (!session.viewShowing && session.stageCtrl.keydownTarget()) {
        const df = overlayKey(key);
        if (df) toGame(df, key === "Escape");
        return;
      }
      if (key === "ArrowRight") arrow("rightarrow");
      else if (key === "ArrowLeft") arrow("leftarrow");
      else if (key === "ArrowUp") arrow("uparrow");
      else if (key === "ArrowDown") toGame("downarrow");
      else if (key === "Escape") toGame(".", true);
      else if (key.length === 1) toGame(key.toLowerCase());
      return;
    }
    default:
      // pointermove is the page's touch recogniser; keyup is nobody's
      return;
  }
}

export interface HeadlessRun {
  driver: SpeedrunDriver;
  host: () => GameHost;
}

/**
 * A booted game and a driver over it.
 *
 * `prepare` runs on every fresh session, before its boot — the CLI's `seedIt`
 * (the sheet clock, and a pinned seed).
 */
export async function headlessRun(opts: {
  prepare: (session: GameHost["session"]) => void;
  seed: number | null;
  log?: (message: string) => void;
}): Promise<HeadlessRun> {
  let host!: GameHost;
  let wall = 0;
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
    host.director.tick(wall);
    const due = queued;
    queued = [];
    const next = (i: number): void => {
      if (i >= due.length) {
        pending = false;
        if (queued.length) {
          pending = true;
          setImmediate(frame);
        }
        return;
      }
      due[i](wall);
      setImmediate(() => next(i + 1));
    };
    setImmediate(() => next(0));
  };
  const requestAnimationFrame = (cb: FrameRequestCallback): number => {
    queued.push(cb);
    if (!pending) {
      pending = true;
      setImmediate(frame);
    }
    return queued.length;
  };

  const boot = async (): Promise<void> => {
    ({ host } = await newHost({ cold: true }));
    const s = host.session;
    // what main.ts sets: script poll loops wait on a real frame, and a fresh
    // game borrows a shipped save to write its own over
    s.hasRealFrames = true;
    s.nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    s.saveTemplate = () => {
      const mission = s.interp.globals.get("mission");
      return shippedSaveTemplate(typeof mission === "number" && mission >= 4 ? "2" : "1");
    };
    opts.prepare(s);
    // the first reading of the clock, as a page's first frame takes it — or the
    // first line of the sheet is charged the frame before it
    host.director.tick(wall);
    // the page's boot, from the click on GAME on: the films, the menu, the flat
    void s.track(host.coldBoot(), "coldBoot");
  };
  await boot();

  const realm = globalThis;
  // the play page's `window.dbg`, for a sheet's predicates
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
  const win = {
    dbg,
    // the driver compiles a predicate with `new win.Function(body)`; this one
    // hands it `window` as the stand-in, and nothing else of this module
    Function: function (body: string) {
      const f = new realm.Function("window", body) as (w: unknown) => unknown;
      return () => f(win);
    },
    requestAnimationFrame,
    setTimeout,
    clearTimeout,
    PointerEvent: StandInEvent,
    MouseEvent: StandInEvent,
    KeyboardEvent: StandInEvent,
    dispatchEvent: (e: Ev) => (deliver(host, e), true),
  };
  // one client pixel per canvas pixel: `clientPointFor` then aims at the pixel
  // itself, and `deliver` reads it back unchanged
  const canvas = {
    get width() {
      return host.screen.width;
    },
    get height() {
      return host.screen.height;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: host.screen.width, height: host.screen.height }),
    dispatchEvent: (e: Ev) => (deliver(host, e), true),
  };

  const page = pageDriver({
    win: win as unknown as Window & typeof globalThis,
    canvas: canvas as unknown as HTMLCanvasElement,
    sheet: () => "",
    keys: saveKeys("taoot"),
    log: opts.log,
    // budgets on this run's own frames: the game runs as fast as node does,
    // and ten seconds of the wall would be hours of it
    budgetNow: () => wall,
  });
  // Saves on disk where the Playwright runner keeps them (driver.ts), so a load
  // point written by either runner is there for the other.
  const saves = join(process.cwd(), "out", "speedrun");
  const driver: SpeedrunDriver = {
    ...page,
    putSave: async (name, bytes) => {
      mkdirSync(saves, { recursive: true });
      writeFileSync(join(saves, `${name}.ti`), bytes);
    },
    getSave: async (name) => {
      const file = join(saves, `${name}.ti`);
      return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
    },
    seed: opts.seed,
    // a fresh session, booted as the page would boot it after a reload
    restart: boot,
    // nobody to press Play again
    pause: undefined,
  };
  return { driver, host: () => host };
}
