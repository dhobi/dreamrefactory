/**
 * The speedrun driver — the same gestures as taoot/tests/browser/driver.ts, in a hurry.
 *
 * Both drivers deliver real Playwright mouse and keyboard events to the canvas,
 * and this one is not allowed to do anything else: the run is HUMAN-LEGAL, so
 * nothing here raises `framerate()`, collapses a fade, dispatches an event
 * page-side or reaches into the engine to move the story along. `window.dbg` is
 * read, never written. What separates the two is only WHEN the next gesture goes
 * in.
 *
 * ## Why a second driver at all
 *
 * taoot/tests/browser/driver.ts is deliberately unhurried, and every bit of that is
 * right for what it does — it feeds the suite that diffs a browser run against
 * the headless oracle, where a gesture landing a frame early is a divergence to
 * be explained rather than a record. So it pays a flat 60 ms grace before every
 * settle, waits for FULL quiescence after every gesture, and polls at 150 ms.
 * Across a whole run that is minutes of deliberate margin.
 *
 * A speedrun cannot pay it, and does not have to: the margin is there to make
 * the trace comparable, and a speedrun compares nothing. So this driver waits on
 * the MINIMUM precondition for the next action to be accepted, and no more.
 *
 * ## The three things that make it faster
 *
 * **1. Waits are per-action, not universal.** {@link WaitMode} — `none` fires and
 * returns, `taken` waits only until the engine has consumed the press, `ready`
 * waits only until it would accept another, `quiet` is the old full settle. A
 * sheet picks per line with `wait:`, which is most of what tuning a speedrun
 * actually is.
 *
 * **2. Clicks are buffered.** A press made while a script is in flight is QUEUED
 * and replayed, not dropped (`GameSession.events`, and TI.EXE does the same —
 * the shipped premovie/playmovie/postmovie call no `flushevents()`). So a
 * speedrun can post the next click before the last one has been acted on and let
 * the engine catch up, which is exactly what a player mashing through a known
 * route does. `wait: none` is that.
 *
 * **3. Keys are NOT buffered across a fade.** This is the one place where going
 * faster is wrong rather than merely risky, and it is already written down in the
 * engine: `SetViewer.keyDown` queues on `movingCamera` but refuses on
 * `inputLocked`, and the two differ by exactly `session.fading` (viewer.ts, the
 * long NOTE on `pressNav`). A key pressed in that gap is silently dropped — no
 * handler runs, nothing is logged. It cost the browser suite a 120 s timeout at
 * ENGINE.SET's View120 once, diagnosed only because adding instrumentation before
 * the press accidentally made it land.
 *
 * A speedrun presses keys earlier than anything else ever has, so it walks into
 * that gap constantly. {@link KEY_SAFE} is the gate, and it is not optional: a
 * dropped arrow is a run that quietly walks the wrong way and fails a split ten
 * minutes later. Clicks do not need it — they queue unconditionally.
 */
import type { Page } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The wait ladder, the fade gate and the shared predicates all live in
// taoot/src/speedrun/driver.ts now, because the in-page runner needs exactly the same
// ones — see there for what each mode waits on and why KEY_SAFE is not optional.
import {
  KEY_SAFE,
  QUEUE_EMPTY,
  QUIET,
  SHOWING,
  clientPointFor,
  type Clock,
  type HoldOptions,
  type HoldResult,
  type Point,
  type SpeedrunDriver,
  type WaitMode,
} from "../../src/speedrun/driver";

export { SHOWING };
export type { WaitMode, Clock, Point, SpeedrunDriver };

export interface SpeedrunDriverOptions {
  /** how long any single wait may take before it is called stuck */
  timeout?: number;
  /** how often a hammering verb re-presses, in ms */
  gap?: number;
  log?(message: string): void;
  /**
   * Run after a `reset()` has reloaded the page, before the run carries on.
   *
   * Anything the harness did to the fresh page once has to be done again: the
   * seed above all. A run that re-seeded on the first boot and not on the second
   * would be drawing from a different stream after the reset than before it,
   * which is exactly the comparability the seed exists to buy.
   */
  onReload?(): Promise<void>;
}

export async function speedrunDriver(page: Page, opts: SpeedrunDriverOptions = {}): Promise<SpeedrunDriver & { page: Page; pagePoint(x: number, y: number): Promise<Point> }> {
  const timeout = opts.timeout ?? 120_000;
  const defaultGap = opts.gap ?? 16;
  const log = opts.log ?? (() => {});

  /** ms actually spent inside `after:` padding, so the report can call it dead */
  let paddedMs = 0;

  const evaluate = <T>(expr: string): Promise<T> => page.evaluate(expr) as Promise<T>;

  const hold = (expr: string, what: string, budget = timeout): Promise<void> =>
    page
      .waitForFunction(expr, null, { timeout: budget })
      .then(() => undefined)
      .catch((e: Error) => {
        throw new Error(`stuck waiting for ${what}: ${e.message}`);
      });

  /** the same, but running out is an answer rather than a failure */
  const tryHold = (expr: string, budget: number): Promise<boolean> =>
    page
      .waitForFunction(expr, null, { timeout: budget })
      .then(() => true)
      .catch(() => false);

  /**
   * Put the game back to a cold boot.
   *
   * From out here a reload is nothing special — the Node side of the run
   * survives it, so the promise resolves and the sheet carries on. That is the
   * whole difference from the workbench, where the reload takes the run with it.
   */
  const restart = async (): Promise<void> => {
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { dbg?: unknown }).dbg, null, {
      timeout: 30_000,
    });
    await opts.onReload?.();
    log("reset: the game was reloaded");
  };

  const clock = async (): Promise<Clock> => ({
    ms: Date.now(),
    frames: await evaluate<number>("window.dbg.session.frameCounter"),
  });

  /** canvas pixel (512x384) -> page point, so the click is a real mouse event */
  /** the gap a click holds the button down for — see clickAt */
  const CLICK_FRAMES = 3;
  const heldFrames = (): Promise<void> =>
    // anonymous arrows only: this is serialized into the page, and a NAMED
    // function would carry tsx's `__name` helper across with it and throw there
    page.evaluate(async (n: number) => {
      for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(() => r(0)));
    }, CLICK_FRAMES);

  /**
   * Canvas pixel -> the client point that lands on it. The arithmetic is
   * {@link clientPointFor}'s and is shared with the page driver on purpose
   * (#277): the page reads a coordinate back with `Math.floor`, so aiming at the
   * half-pixel misses by one below a 2x scale. Only the RECT is measured in the
   * page; the sum is done here so there is one copy of the rule.
   */
  const pagePoint = async (x: number, y: number): Promise<Point> => {
    const m = await page.evaluate(() => {
      const c = document.getElementById("screen") as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height, cw: c.width, ch: c.height };
    });
    return clientPointFor(x, y, m, { width: m.cw, height: m.ch });
  };

  /** the wait half of every gesture, and the only thing a `wait:` option moves */
  const settle = async (mode: WaitMode, what: string, budget = timeout): Promise<void> => {
    if (mode === "none") return;
    if (mode === "taken") return hold(QUEUE_EMPTY, `${what} to be taken`, budget);
    if (mode === "ready") return hold(KEY_SAFE, `the engine to be ready after ${what}`, budget);
    return hold(QUIET, `${what} to settle`, budget);
  };

  const pad = async (ms: number): Promise<void> => {
    if (!ms) return;
    paddedMs += ms;
    await page.waitForTimeout(ms);
  };

  return {
    page,
    clock,
    pagePoint,
    settle,
    pad,
    hold,
    tryHold,
    evaluate,
    /** ms spent in `after:` padding — dead time, reported as such */
    padded: () => paddedMs,

    /**
     * A key press, gated so it cannot be eaten by a fade.
     *
     * The gate is BEFORE the press and is not skippable by `wait: none`: `wait`
     * says how much of the CONSEQUENCE to wait for, never whether the gesture is
     * allowed to be thrown away. See {@link KEY_SAFE}.
     */
    /** plain delay — the one thing a run should never need and sometimes does */
    sleep: (ms: number): Promise<void> => page.waitForTimeout(ms),

    /**
     * An UNGATED key press, for the few aimed at something that is not the
     * engine — the Nightdive intro answers before there is a viewer at all, so
     * {@link KEY_SAFE} has nothing to ask and would refuse forever.
     */
    rawKey: async (name: string): Promise<void> => {
      await page.keyboard.press(name);
    },

    key: async (name: string, wait: WaitMode = "ready", budget = timeout): Promise<void> => {
      await hold(KEY_SAFE, `the engine to accept ${name}`, budget);
      await page.keyboard.press(name);
      await settle(wait, `key ${name}`, budget);
    },

    /**
     * A click at a canvas pixel. Defaults to `taken` rather than `none` because
     * a click that was never consumed and a click that did nothing are the same
     * thing from out here, and only one of them is a bug worth stopping for.
     */
    /**
     * A click, with the button held down long enough for the game to notice.
     *
     * `page.mouse.click` is press-and-release with no gap, and no gap is not what
     * a hand does — the game reads the time between them. `while stilldown()`
     * loops carry a held item and read `mouse()` every turn, and INVEN.SHP's
     * `stdmouse` decides where a carried object LANDS from what `hittest` finds
     * when the button comes UP. Measured on the coal lever, whose mousedown is
     * such a loop, all three ways of clicking it:
     *
     *     playwright     deg 9 -> 9    coal 50 -> 50   stilldown turns 1
     *     page-side      deg 9 -> 9    coal 50 -> 50   stilldown turns 1
     *     held 3 frames  deg 9 -> 11   coal 50 -> 47   stilldown turns 3
     *
     * One turn means the loop was entered and `stilldown()` was already false.
     * Being outside the browser is no protection: two CDP commands back to back
     * still leave the renderer no frame in between.
     *
     * The wait is counted in the page's own frames rather than milliseconds,
     * because what has to fit in the gap is a turn of an engine loop.
     */
    clickAt: async (x: number, y: number, wait: WaitMode = "taken", budget = timeout): Promise<void> => {
      const pt = await pagePoint(x, y);
      await page.mouse.move(pt.x, pt.y);
      await page.mouse.down();
      await heldFrames();
      await page.mouse.up();
      await settle(wait, `click ${x},${y}`, budget);
    },

    /** press and hold until a condition holds — see SpeedrunDriver.holdAt */
    holdAt: async (x: number, y: number, opts: HoldOptions, budget = timeout): Promise<HoldResult> => {
      // ARM FIRST, then press — see HoldOptions.arm
      const armed = opts.arm ? await tryHold(opts.arm, opts.armBudget ?? Math.min(budget, 10_000)) : true;
      if (!armed) return { armed, held: false };
      const pt = await pagePoint(x, y);
      await page.mouse.move(pt.x, pt.y);
      await page.mouse.down();
      let held = false;
      try {
        held = await tryHold(opts.until, budget);
      } finally {
        // released whatever happened: leaving the button down would make every
        // later gesture a drag
        await page.mouse.up();
      }
      await heldFrames();
      return { armed, held };
    },

    /**
     * Press a key repeatedly until a page-side predicate holds.
     *
     * This is `skipMovie` and the conversation line-skipper underneath — the
     * "hammering ESC" of the sheet. Two things keep it honest. It re-checks the
     * ARM predicate before every press, so it cannot press into a state where
     * that key means something else (ESC at a plaque ANSWERS -1 and walks the
     * player out of the conversation, #131 — hammering blindly there loses the
     * story). And it gates on {@link KEY_SAFE} like any other key.
     *
     * `gap` is the tuning knob and the reason this is a driver primitive rather
     * than a loop in the runner: how fast ESC may be repeated before the engine
     * stops distinguishing the presses is a per-clip fact, and a sheet finds it
     * by trying.
     */
    hammer: async (
      name: string,
      { until, arm, gap = defaultGap, budget = timeout, what }:
        { until: string; arm?: string; gap?: number; budget?: number; what: string },
    ): Promise<number> => {
      const deadline = Date.now() + budget;
      let pressed = 0;
      for (;;) {
        if (await evaluate<boolean>(`(() => !!(${until}))()`)) return pressed;
        if (Date.now() > deadline) {
          throw new Error(`stuck waiting for ${what}: ${pressed} presses of ${name} in ${budget} ms`);
        }
        // only press when the key means what we think it means, and only when it
        // will not be dropped; otherwise give the engine the gap and look again
        const armed = arm ? await evaluate<boolean>(`(() => !!(${arm}))()`) : true;
        if (armed && (await evaluate<boolean>(KEY_SAFE))) {
          await page.keyboard.press(name);
          pressed++;
        }
        await page.waitForTimeout(gap);
      }
    },

    /**
     * Aim at a named thing the way the browser suite does — through the engine's
     * OWN hit test, never a hardcoded pixel.
     *
     * Shared with taoot/tests/playthrough/nav/aim.ts rather than reimplemented, for the
     * reason that file gives at length: whether a thing is clickable from where
     * you stand decides whether a route walks on, so two different sweeps explore
     * a room differently and end up facing different ways. A speedrun that aimed
     * its own way would be running a different game.
     */
    aim: async (kind: "thing" | "hotspot", name: string): Promise<Point | null> => {
      const { aimSource } = await import("../playthrough/nav/aim");
      const adapter = `(() => {
        const dbg = window.dbg, s = dbg.session, v = dbg.viewer;
        return {
          hitTest: (x, y) => s.hitTestAt(x, y),
          propUnder: (x, y) => { const p = v.propUnder(x, y); return p ? p.group.name : null; },
          inFlat: !s.viewShowing && !!s.stageScript,
          hotspot: (n) => {
            const obj = v.scene.views[v.viewIdx].objects.find(
              (o) => (o.identifier || "").toLowerCase() === n.toLowerCase());
            return obj ? { x0: obj.startRegionX, y0: obj.startRegionY, x1: obj.endRegionX, y1: obj.endRegionY } : null;
          },
        };
      })()`;
      const fn = kind === "thing" ? "aimAtThing" : "aimAtHotspot";
      return evaluate<Point | null>(
        `(() => { ${aimSource()} return ${fn}(${adapter}, ${JSON.stringify(name)}); })()`,
      );
    },

    /**
     * A held drag over a series of points — a dial, a lever, a pump handle.
     *
     * The wait between moves is the important part and is not a sleep: the prop's
     * script is sitting in a `while stilldown()` loop, and `session.realYieldSeq`
     * counts the frames a script has given up, bumped once per turn of exactly
     * that loop (builtins/pointer.ts). Waiting for it to advance means a whole
     * iteration has begun and finished SINCE the cursor moved — so the dial has
     * seen where the cursor now is.
     *
     * FOUR because a loop body gives up more than one frame (the `stilldown()`
     * that begins the turn and the `forceupdate()` that ends it both bump the
     * counter), so +2 can be satisfied with the body in between never having run.
     * A speedrun cannot shave this one: waiting less does not make the dial move
     * sooner, it makes the next read a frame stale, and a stale `deg` sends the
     * next swing the wrong way — which costs a whole extra pass around the dial.
     */
    dragProp: async (
      at: Point,
      next: (start: Point) => Point | null | Promise<Point | null>,
      budget = timeout,
    ): Promise<void> => {
      const from = await pagePoint(at.x, at.y);
      const seq = () => evaluate<number>("window.dbg.session.realYieldSeq");
      const held = async (): Promise<void> => {
        const was = await seq();
        await tryHold(`window.dbg.session.realYieldSeq >= ${was + 4}`, Math.min(budget, 20_000));
      };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      try {
        // a turn of the loop before the first move, cursor unmoved: the dial does
        // not move but the body publishes its global
        await held();
        for (let to = await next(at); to; to = await next(at)) {
          const pt = await pagePoint(to.x, to.y);
          await page.mouse.move(pt.x, pt.y);
          await held();
        }
      } finally {
        await page.mouse.up();
        /**
         * THE RELEASE IS A GESTURE TOO, and this is it being acted on.
         *
         * Half the controls in this game snap on the button coming up rather
         * than as the cursor moves — the coal lever, the wireless breaker and
         * sender — so the owner or the deg a caller is about to read is set by
         * the release and not by any move. `page.mouse.up()` resolves when the
         * event is DISPATCHED, which is several frames before the held script
         * notices `stilldown()` is false, leaves its loop and runs that snap.
         *
         * Read in that gap and the answer is the setting from before the drag.
         * That is what "the sender went to off at y=40, not on" was: the drag
         * was perfect, the reading was early. The dials never showed it because
         * `turnDial` and `setLever` take hold up to three times and the next
         * grab's opening `held()` paid this wait by accident.
         *
         * `pollingInput()` going false is the loop letting go and `scriptBusy`
         * going false is the script that owned it running out — which is the
         * snap, and on the sender also `senderon()` lighting its four lamps a
         * frame apart. Both halves, because the first alone can be true in the
         * step between leaving the loop and executing the line after it.
         *
         * NOT `held()`. That waits for four more yields, and the whole point of
         * this moment is that nothing is yielding any more: the loop that was
         * bumping `realYieldSeq` has gone. Waiting on it costs its full 20 s
         * timeout and then reads the right answer for the wrong reason —
         * measured, 20.8 s on `wireless(sender, on)` and the same on the
         * breaker.
         */
        await tryHold(
          `!window.dbg.session.pollingInput() && !window.dbg.session.scriptBusy`,
          Math.min(budget, 5_000),
        );
      }
    },

    /** a drag, for the inventory — press, carry, release */
    drag: async (from: Point, to: Point, steps = 8): Promise<void> => {
      const a = await pagePoint(from.x, from.y);
      const b = await pagePoint(to.x, to.y);
      // the steps matter: main.ts publishes the pointer on mousemove and the
      // held script's `while stilldown()` loop reads it every frame, so a jump
      // from press to release drops the item where it was picked up
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps });
      await page.mouse.up();
    },

    // Disk, because Playwright starts a fresh browser profile every run and
    // anything in localStorage would go with it. Under out/ so it is ignored by
    // git: a load point is a working file, not something to commit.
    putSave: async (name: string, bytes: Uint8Array) => {
      const dir = join(process.cwd(), "out", "speedrun");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${name}.ti`), bytes);
    },
    getSave: async (name: string) => {
      const file = join(process.cwd(), "out", "speedrun", `${name}.ti`);
      return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
    },

    restart,
    log,
  };
}

/** what this driver is, concretely: the shared contract plus the Playwright-only
 *  handles the planner escape hatch needs */
export type PlaywrightDriver = Awaited<ReturnType<typeof speedrunDriver>>;
