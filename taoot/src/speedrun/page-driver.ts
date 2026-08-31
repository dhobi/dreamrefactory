/**
 * The speedrun driver that runs INSIDE the page.
 *
 * Same {@link SpeedrunDriver} contract as the Playwright one, same sheets, same
 * actions — but no process boundary, so every `evaluate` is a function call
 * instead of a round trip and every wait polls on the animation frame the engine
 * is already drawing on.
 *
 * ## What it is and is not
 *
 * It is a **previewer**: paste a sheet, watch it play, fix the line that broke,
 * run it again — without leaving the browser. That loop is the point.
 *
 * It is **not the clock of record**, and the difference is not a detail. The
 * events it makes are synthetic (`isTrusted: false`), which the engine cannot
 * tell apart — `main.ts` never asks — but which do skip the browser's real input
 * pipeline. Playwright's presses do not. So a time measured here is a time for a
 * machine that had no input latency at all, and it will beat the Playwright run
 * on the same sheet. Two clocks, and the page says so on its face.
 *
 * ## Synthesizing what main.ts listens for
 *
 * Read off the listeners rather than guessed:
 *
 *   - **keys** — `window.addEventListener("keydown")`, reading `e.key`. Dispatched
 *     at `window`, so `e.target` is the window and `focusOwnsKey` correctly says
 *     the page is not typing into a field. (That check is why the textarea can
 *     stay on screen while the run plays: type in it and the game does not see
 *     the letters; click away and it does.)
 *   - **clicks** — `screen.addEventListener("pointerdown")` on the canvas, plus
 *     `pointerup`/`pointermove` on the window, all mapped through
 *     `canvasCoords`: `((clientX - rect.left) / rect.width) * canvas.width`. So a
 *     canvas pixel is turned back into a client point through the same rectangle,
 *     and the engine recovers exactly the pixel asked for.
 *   - `pointerType: "mouse"` explicitly, because the handler branches on it —
 *     a "touch" press is ambiguous until it moves and goes down a different path
 *     (`beginTouch`).
 */
import {
  KEY_SAFE,
  Paused,
  SHOWING,
  clientPointFor,
  waitExpr,
  type Clock,
  type HammerOptions,
  type Point,
  type SpeedrunDriver,
  type WaitMode,
} from "./driver";

export interface PageDriverOptions {
  /**
   * The window the GAME is in — which is not necessarily this one.
   *
   * The speedrun page runs the real `/play/` in a same-origin iframe rather than
   * rebuilding it: that page is nine hundred lines of markup that `main.ts`
   * queries by id, and a trimmed copy of it would be a second thing to keep in
   * step for no gain. So every read and every event is aimed at `win`, and the
   * panel stays in the parent document where the textarea can hold focus without
   * the game seeing a single keystroke.
   *
   * Same-origin, so `win.dbg` is reachable and `new win.Function(...)` compiles
   * an expression whose global scope is the GAME's window — which is what makes
   * `window.dbg.session` in a sheet predicate mean the right session.
   */
  win: Window & typeof globalThis;
  /** the game canvas — `#screen` inside {@link PageDriverOptions.win} */
  canvas: HTMLCanvasElement;
  /**
   * Which sheet is running, for {@link saveKey}. Asked per call rather than
   * passed once: a driver outlives the run that made it only just, but the sheet
   * CAN be renamed while one is in flight, and the answer that matters is the one
   * at the moment `save()` writes.
   */
  sheet(): string;
  timeout?: number;
  gap?: number;
  log?(message: string): void;
  /** raised to abort a run mid-flight; every wait checks it */
  signal?: AbortSignal;
  /**
   * Called just before a `reset()` reloads the document.
   *
   * The last moment this page exists. Whatever the workbench needs on the other
   * side — which sheet was open, where the pointer was, whether it was running —
   * has to be written down here, because nothing after the reload call runs.
   */
  beforeRestart?(): void;
}

/** thrown when the user presses Stop — distinguished from a route that failed */
export class Aborted extends Error {
  constructor() {
    super("stopped");
    this.name = "Aborted";
  }
}

/**
 * Where a load point lives in this host.
 *
 * Exported because the workbench asks the same question from outside a run —
 * it greys out the button for a leg whose starting save has not been made yet —
 * and two spellings of one key is exactly the bug that would make that answer
 * quietly wrong.
 *
 * ## A checkpoint belongs to a SHEET
 *
 * The key carries the sheet's name as well as the point's, and that is not
 * bookkeeping. `save(m1p0)` means "the game as it stands at this line of THIS
 * route", and two sheets are two routes: an `m1p0` written by a run that took
 * the long way round the boat deck is a different game state from one written by
 * a run that did not, and under a name-only key the second silently overwrote
 * the first. What made it worse than a lost save is what the chips then did —
 * jumping to a point belonging to another sheet restores its game and then finds
 * no `save()` line to move the pointer to, so the game stands somewhere the
 * route does not name, which is the one state the workbench is built to prevent.
 *
 * Both halves are percent-encoded, so the ":" between them cannot occur inside
 * either and the key can always be taken apart again ({@link parseSaveKey}).
 *
 * The Node runner has no sheets — a sheet is a FILE there — and keys its saves
 * by name alone under `out/speedrun/`. Nothing is shared between the two stores,
 * which was already true.
 */
export const SAVE_PREFIX = "taoot:speedrun:save:";

export const saveKey = (sheet: string, name: string): string =>
  `${SAVE_PREFIX}${encodeURIComponent(sheet)}:${encodeURIComponent(name)}`;

/** the sheet and point a key names, or null if it is not one of ours (or is one
 *  of the name-only keys this shape replaced — see the page's migration) */
export function parseSaveKey(key: string): { sheet: string; name: string } | null {
  if (!key.startsWith(SAVE_PREFIX)) return null;
  const rest = key.slice(SAVE_PREFIX.length);
  const cut = rest.indexOf(":");
  if (cut < 0) return null;
  try {
    return {
      sheet: decodeURIComponent(rest.slice(0, cut)),
      name: decodeURIComponent(rest.slice(cut + 1)),
    };
  } catch {
    return null; // a malformed escape is not a key we wrote
  }
}

export function pageDriver(opts: PageDriverOptions): SpeedrunDriver {
  const { canvas, win } = opts;
  const timeout = opts.timeout ?? 120_000;
  const defaultGap = opts.gap ?? 16;
  const log = opts.log ?? (() => {});
  let paddedMs = 0;
  let pointerId = 1;

  const stopped = (): boolean => !!opts.signal?.aborted;
  const check = (): void => {
    if (stopped()) throw new Aborted();
  };

  /**
   * Evaluate a sheet predicate.
   *
   * `new Function` rather than `eval` so the expression is compiled once per call
   * against the global scope and cannot reach this module's locals — the strings
   * come from a textarea, and while the page is the user's own, an expression that
   * could quietly close over the driver's internals would make every failure
   * harder to read rather than easier.
   */
  const run = <T>(expr: string): T => {
    try {
      // the GAME window's Function, so the expression's globals are the game's:
      // `window.dbg` inside a sheet predicate has to mean the running session,
      // not the panel's window, which has no dbg at all
      return new win.Function(`return (${expr});`)() as T;
    } catch (e) {
      throw new Error(`could not evaluate \`${expr}\`: ${(e as Error).message}`);
    }
  };

  const evaluate = async <T>(expr: string): Promise<T> => run<T>(expr);

  const frame = (): Promise<void> => new Promise((r) => win.requestAnimationFrame(() => r()));

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve, reject) => {
      const t = win.setTimeout(() => resolve(), ms);
      opts.signal?.addEventListener(
        "abort",
        () => {
          win.clearTimeout(t);
          reject(new Aborted());
        },
        { once: true },
      );
    });

  /**
   * Poll a predicate on the animation frame.
   *
   * rAF and not a timer, because the engine advances on rAF: waiting on the same
   * beat means a condition is seen the moment the frame that caused it has been
   * drawn, never a timer-slice later. It also stops the loop dead when the tab is
   * hidden, which is right — the game stops too.
   */
  const until = async (expr: string, budget: number): Promise<boolean> => {
    const deadline = performance.now() + budget;
    for (;;) {
      check();
      if (run<boolean>(expr)) return true;
      if (performance.now() > deadline) return false;
      await frame();
    }
  };

  const hold = async (expr: string, what: string, budget = timeout): Promise<void> => {
    if (!(await until(expr, budget))) throw new Error(`stuck waiting for ${what}`);
  };

  const tryHold = (expr: string, budget: number): Promise<boolean> => until(expr, budget);

  const settle = async (mode: WaitMode, what: string, budget = timeout): Promise<void> => {
    const expr = waitExpr(mode);
    if (!expr) return;
    await hold(expr, `${what} to settle`, budget);
  };

  /** canvas pixel (512x384) -> a client point, through main.ts's own mapping */
  const clientPoint = (x: number, y: number): Point =>
    clientPointFor(x, y, canvas.getBoundingClientRect(), canvas);

  const pointer = (type: string, at: Point, target: EventTarget = canvas): void => {
    target.dispatchEvent(
      new win.PointerEvent(type, {
        clientX: at.x,
        clientY: at.y,
        pointerId: pointerId++,
        // explicitly a mouse: the pointerdown handler sends a TOUCH down
        // `beginTouch`, which is a different gesture entirely
        pointerType: "mouse",
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
      }),
    );
  };

  /**
   * Move the cursor — which takes TWO events, and a `pointermove` is not one of
   * them.
   *
   * main.ts listens for a moving mouse in `mousemove` (the one that reads
   * `session.pointerDown` and republishes the cursor mid-drag), and its
   * `pointermove` listener is the TOUCH gesture recogniser, which drops anything
   * whose pointerId is not the finger it is following. A real browser hides the
   * difference: a physical move fires `pointermove` and then a compatibility
   * `mousemove`, so a page that listens to either one sees the move. A
   * SYNTHESIZED PointerEvent generates no compatibility event at all — nothing
   * else does, since the compatibility event comes from the input pipeline rather
   * than from dispatch.
   *
   * So a drag built out of `pointermove` alone pressed in the right place and
   * then never moved: `mouse()` kept answering the grab point for every turn of
   * the held script's `while stilldown()` loop. Silent, because every gesture
   * still went in and the loop still ran — the coal lever simply stayed on
   * whatever deg the cursor was pressed at (deg 0, its travel starting below the
   * point `aimAtThing` grabs it by), and the five turbine dials saw `delt = 0`
   * every frame and never turned at all.
   *
   * Both events, in the order a browser sends them, at the canvas.
   */
  const movePointer = (at: Point): void => {
    pointer("pointermove", at);
    canvas.dispatchEvent(
      new win.MouseEvent("mousemove", {
        clientX: at.x,
        clientY: at.y,
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
      }),
    );
  };

  /**
   * How long a click holds the button down — because a click is not an instant.
   *
   * A hand takes 50–150 ms between pressing and letting go, and the game reads
   * that gap. Whole gestures are decided inside it: `while stilldown()` loops
   * carry a held item and read `mouse()` every turn, `trackbut` lights a stage
   * button only while it is held, and INVEN.SHP's `stdmouse` decides where a
   * carried object LANDS from what `hittest` finds when the button comes up.
   *
   * Dispatching down and up in one task gives the engine no gap at all. The press
   * is handled asynchronously (`session.track(viewer.press(...))`), so by the time
   * the script chain runs its first line the button is already up and every one of
   * those loops falls straight through. Measured on the coal lever, whose
   * mousedown IS such a loop:
   *
   *     instant        deg 9 -> 9    coal 50 -> 50   stilldown turns 1
   *     held 3 frames  deg 9 -> 11   coal 50 -> 47   stilldown turns 3
   *
   * One turn means the loop was entered and `stilldown()` was already false. The
   * symptom higher up is a click that "does nothing" — putting the Rubaiyat down
   * in the coal bunker, where the drop is the release and the release never
   * happened while anything was listening.
   *
   * Three frames is what that measurement needed; it is deliberately a count of
   * frames rather than milliseconds, because what has to fit in the gap is a turn
   * of an engine loop and the engine runs on frames.
   */
  const CLICK_FRAMES = 3;
  const heldFrames = async (): Promise<void> => {
    for (let i = 0; i < CLICK_FRAMES; i++) await frame();
  };

  const pressKey = (name: string): void => {
    // `key` is what main.ts reads; the rest are filled in because a listener
    // further up the page may look at them, and a half-built event is a bug
    // waiting for the first person who adds one
    const key = name === "Space" ? " " : name;
    win.dispatchEvent(
      new win.KeyboardEvent("keydown", { key, code: keyCode(key), bubbles: true, cancelable: true }),
    );
    win.dispatchEvent(
      new win.KeyboardEvent("keyup", { key, code: keyCode(key), bubbles: true, cancelable: true }),
    );
  };

  /** a best-effort `code` for the few keys a sheet actually sends */
  const keyCode = (key: string): string => {
    if (key === " ") return "Space";
    if (key === "Escape") return "Escape";
    if (key.startsWith("Arrow")) return key;
    if (key.length === 1) return /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : "";
    return key;
  };

  return {
    clock: async (): Promise<Clock> => ({
      ms: performance.now(),
      frames: run<number>("window.dbg.session.frameCounter"),
    }),
    evaluate,
    hold,
    tryHold,
    settle,
    sleep,
    pad: async (ms) => {
      if (!ms) return;
      paddedMs += ms;
      await sleep(ms);
    },
    padded: () => paddedMs,

    key: async (name, wait = "ready", budget = timeout) => {
      await hold(KEY_SAFE, `the engine to accept ${name}`, budget);
      pressKey(name);
      await settle(wait, `key ${name}`, budget);
    },
    rawKey: async (name) => {
      pressKey(name);
      await frame();
    },

    clickAt: async (x, y, wait = "taken", budget = timeout) => {
      const at = clientPoint(x, y);
      pointer("pointerdown", at);
      await heldFrames();
      pointer("pointerup", at, win);
      await settle(wait, `click ${x},${y}`, budget);
    },

    holdAt: async (x, y, opts, budget = timeout) => {
      // ARM FIRST, then press — see HoldOptions.arm
      const armed = opts.arm ? await until(opts.arm, opts.armBudget ?? Math.min(budget, 10_000)) : true;
      if (!armed) return { armed, held: false };
      const at = clientPoint(x, y);
      movePointer(at);
      pointer("pointerdown", at);
      let held = false;
      try {
        held = await until(opts.until, budget);
      } finally {
        // released whatever happened: leaving the button down would make every
        // later gesture a drag
        pointer("pointerup", at, win);
      }
      await heldFrames();
      return { armed, held };
    },

    hammer: async (name, { until: goal, arm, gap = defaultGap, budget = timeout, what }: HammerOptions) => {
      const deadline = performance.now() + budget;
      let pressed = 0;
      for (;;) {
        check();
        if (run<boolean>(goal)) return pressed;
        if (performance.now() > deadline) {
          throw new Error(`stuck waiting for ${what}: ${pressed} presses of ${name} in ${budget} ms`);
        }
        // only press when the key means what we think it means, and only when it
        // will not be dropped
        if ((!arm || run<boolean>(arm)) && run<boolean>(KEY_SAFE)) {
          pressKey(name);
          pressed++;
        }
        await (gap ? sleep(gap) : frame());
      }
    },

    aim: async (kind, name) => {
      // the engine's own hit test, called directly — this is the sweep the
      // Playwright driver has to inject as source, and here it is simply local
      const { aimAtThing, aimAtHotspot } = await import("./nav/aim");
      const dbg = (win as unknown as { dbg: any }).dbg;
      const s = dbg.session;
      const v = dbg.viewer;
      const adapter = {
        hitTest: (x: number, y: number) => s.hitTestAt(x, y),
        propUnder: (x: number, y: number) => {
          const p = v.propUnder(x, y);
          return p ? p.group.name : null;
        },
        inFlat: !s.viewShowing && !!s.stageScript,
        hotspot: (n: string) => {
          const obj = v.scene.views[v.viewIdx].objects.find(
            (o: { identifier?: string }) => (o.identifier || "").toLowerCase() === n.toLowerCase(),
          );
          return obj
            ? { x0: obj.startRegionX, y0: obj.startRegionY, x1: obj.endRegionX, y1: obj.endRegionY }
            : null;
        },
      };
      return kind === "thing" ? aimAtThing(adapter, name) : aimAtHotspot(adapter, name);
    },

    drag: async (from, to, steps = 8) => {
      const a = clientPoint(from.x, from.y);
      const b = clientPoint(to.x, to.y);
      // the steps matter: main.ts publishes the pointer as the mouse moves and
      // the held script's `while stilldown()` loop reads it every frame, so a
      // jump from press to release drops the item where it was picked up
      movePointer(a);
      pointer("pointerdown", a);
      for (let i = 1; i <= steps; i++) {
        movePointer({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
        await frame();
      }
      pointer("pointerup", b, win);
    },

    dragProp: async (at, next, budget = timeout) => {
      const from = clientPoint(at.x, at.y);
      // `realYieldSeq` counts the frames a script has given up, bumped once per
      // turn of exactly the `while stilldown()` loop holding the drag. Waiting
      // for +4 means a whole iteration has begun and finished since the cursor
      // moved, so the dial has seen where it now is. Four and not two because
      // the `stilldown()` opening the turn and the `forceupdate()` closing it
      // both bump it, so +2 can be satisfied with the body never having run.
      const held = async (): Promise<void> => {
        const was = run<number>("window.dbg.session.realYieldSeq");
        await until(`window.dbg.session.realYieldSeq >= ${was + 4}`, Math.min(budget, 20_000));
      };
      movePointer(from);
      pointer("pointerdown", from);
      // where the cursor actually is, so the release happens there rather than
      // back at the grab point — which is where a real hand lets go
      let last = from;
      try {
        await held();
        for (let to = await next(at); to; to = await next(at)) {
          last = clientPoint(to.x, to.y);
          movePointer(last);
          await held();
        }
      } finally {
        pointer("pointerup", last, win);
        // The release is a gesture too, and a control that snaps on the button
        // coming up has not snapped yet — see the long note on the Playwright
        // twin of this method (taoot/tests/speedrun/driver.ts).
        await until(
          `!window.dbg.session.pollingInput() && !window.dbg.session.scriptBusy`,
          Math.min(budget, 5_000),
        );
      }
    },

    // localStorage, because the page has no disk. A `.ti` is a few kilobytes and
    // base64 costs a third on top, which is nothing against the 5 MB a browser
    // gives an origin — and it survives the reload that rebooting the game takes.
    putSave: async (name: string, bytes: Uint8Array) => {
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      localStorage.setItem(saveKey(opts.sheet(), name), btoa(bin));
    },
    getSave: async (name: string) => {
      const raw = localStorage.getItem(saveKey(opts.sheet(), name));
      if (!raw) return null;
      const bin = atob(raw);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },

    /**
     * Reload the document, and never come back.
     *
     * The promise deliberately never settles. The reload tears down this
     * JavaScript context, so an action that awaited it and carried on would be
     * running against a dying page — a torn-off canvas, a `window.dbg` that is
     * about to stop existing — and would report whatever nonsense it read there
     * as the state of the game. Hanging is the honest shape: the run ends here,
     * and it is the page that comes back, not this call.
     */
    // the sheet's own breakpoint; the page catches this and keeps the pointer
    pause: () => {
      throw new Paused();
    },

    restart: () => {
      opts.beforeRestart?.();
      win.location.reload();
      return new Promise<void>(() => {});
    },

    log,
  };
}

export { SHOWING };
