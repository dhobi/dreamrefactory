/**
 * What a speedrun driver has to be able to do — and nothing about WHERE it runs.
 *
 * There are two implementations and they sit on opposite sides of a process
 * boundary:
 *
 *   - `taoot/tests/speedrun/driver.ts` drives a real browser from Node over Playwright.
 *     Every gesture is a genuine OS-level input event, which is what makes a run
 *     defensible as something a person could have done. It is the clock of
 *     record.
 *   - `taoot/src/speedrun/page-driver.ts` runs INSIDE the page, synthesizing DOM events
 *     against the canvas. No round trips at all, so the same sheet finishes
 *     faster — a different clock, and deliberately not comparable.
 *
 * The interface is the seam, and it is narrow on purpose. Two observations make
 * it possible at all:
 *
 * **Every question is already a string of JavaScript.** `wait(set == c73)` compiles
 * to an expression over `window.dbg` (actions.ts, `predicate`), and both hosts
 * can evaluate one — Playwright ships it over the wire, the page just runs it. So
 * the whole condition system ports with no work.
 *
 * **Every gesture is already a key or a point.** Nothing above this layer knows
 * how a press is delivered; it says "Escape" or "click 169,311" and the driver
 * decides whether that means a CDP command or a `dispatchEvent`.
 *
 * What does NOT port is the planner escape hatch (`travel`/`hunt`/`stand`): it
 * builds the Node-side browser driver, which parses `.SET` files off disk. Hence
 * {@link SpeedrunDriver.page} — present only on the Playwright side, and the one
 * thing an action may feature-detect on.
 */

/**
 * How much of the consequence of a gesture to wait for.
 *
 * The ladder is cheapest-first, and a sheet should use the cheapest one the next
 * action tolerates:
 *
 *   `none`   — dispatch and return. The engine queues what it cannot act on yet.
 *   `taken`  — until the event queue is empty, i.e. the press has been CONSUMED.
 *   `ready`  — until the engine would accept another gesture (the fade gate).
 *   `quiet`  — full quiescence, the browser suite's `settle`.
 */
export type WaitMode = "none" | "taken" | "ready" | "quiet";

export interface Point {
  x: number;
  y: number;
}

/**
 * The client coordinate that lands on canvas pixel `v` — and it is not
 * `origin + (v + 0.5) * scale` ([#277](https://github.com/dhobi/dreamrefactory/issues/277)).
 *
 * Both drivers aim in CANVAS pixels and the page reads them back with
 * `canvasCoords` (taoot/src/main.ts), which is
 * `Math.floor((client - origin) / size * n)`. Half a canvas pixel of centring
 * survives that round trip only while a canvas pixel is at least two client
 * pixels wide, because the coordinate that actually arrives is an INTEGER: the
 * browser delivers `clientX`/`clientY` whole, so half a pixel of aim plus a
 * fractional `rect.top` rounds DOWN into the pixel before the one asked for.
 *
 * Measured against the play page at nine widths, aiming at the coal lever's
 * twenty-one stops: at 1024px (a 2x scale) all 21 land, at 800px four miss, at
 * 700px eight, at 640px five, and at 512px — a 1:1 scale, where half a canvas
 * pixel is half a client pixel — twenty of the twenty-one miss. Every single
 * miss is low by exactly one.
 *
 * It reads as a dial bug because the coal lever is the one control with no
 * tolerance: `calcswitchdeg` clamps the cursor to 245..345 and divides by 5, so
 * one pixel is one whole setting and `dial(slider, 7)` lands on 6. Everything
 * else the driver clicks is a hotspot many pixels wide, which is why a one-pixel
 * error went unnoticed at every other gesture.
 *
 * So aim at an INTEGER inside the client interval that maps back to `v`:
 *
 *     origin + v * size / n  <=  client  <  origin + (v + 1) * size / n
 *
 * preferring the middle, so the aim is as far from both edges as the interval
 * allows. Below a 1:1 scale that interval can contain no integer at all — the
 * canvas pixel is then genuinely unaddressable, several of them sharing one
 * client pixel — and the nearest integer is returned rather than a fraction,
 * because a fraction is not what will arrive.
 */
export function clientAxis(v: number, origin: number, size: number, n: number): number {
  const lo = origin + (v * size) / n;
  const hi = origin + ((v + 1) * size) / n;
  const mid = Math.round((lo + hi) / 2);
  if (mid >= lo && mid < hi) return mid;
  // the middle rounded out of the interval — take the first integer inside it
  const first = Math.ceil(lo);
  return first < hi ? first : mid;
}

/** {@link clientAxis} on both axes: the client point that lands on canvas (x, y) */
export function clientPointFor(
  x: number,
  y: number,
  rect: { left: number; top: number; width: number; height: number },
  canvas: { width: number; height: number },
): Point {
  return {
    x: clientAxis(x, rect.left, rect.width, canvas.width),
    y: clientAxis(y, rect.top, rect.height, canvas.height),
  };
}

/**
 * What the run is measured in.
 *
 * Two numbers, because neither alone is honest. Wall clock is the speedrun — it
 * is what a stopwatch says — but it moves with machine load. `frameCounter` is
 * the engine's own displayed-frame count: reproducible, immune to load, and the
 * thing a route actually shortens when it takes a better path.
 */
export interface Clock {
  ms: number;
  frames: number;
}

export interface HoldOptions {
  /** page-side expression; keep holding until this is true */
  until: string;
  /**
   * page-side expression that must hold BEFORE the button goes down.
   *
   * Before, not after, and the difference is a deadlock. The gesture this verb
   * exists for follows a click whose script is still running — the inventory's
   * OK runs `transfromflat()`, two fade ramps, and only then parks in
   * `while not button()`. Pressing during that lands on the panel that has not
   * gone away yet, takes hold of the item drawn under the cursor, and starts a
   * `while stilldown()` loop of its own: which polls, so the hold looks armed,
   * and which cannot end while the button is down, so it never lets go.
   * Measured — the whole 120 s budget, with `flat "inven 1"` still up.
   *
   * Waiting for something to be ASKING for a press first puts the press where
   * the player's would be.
   */
  arm?: string;
  /** how long to give `arm` — short, since "nothing is listening" is an answer */
  armBudget?: number;
}

export interface HoldResult {
  /** did anything turn out to be waiting for the press? */
  armed: boolean;
  /** did `until` come true before the budget ran out? */
  held: boolean;
}

export interface HammerOptions {
  /** page-side expression; stop pressing once it holds */
  until: string;
  /** page-side expression; only press while it holds (ESC means different
   *  things at a plaque and mid-line, so a blind hammer is a lost story) */
  arm?: string;
  gap?: number;
  budget?: number;
  what: string;
}

/**
 * A gesture is a key or a point; a question is a string of JavaScript. That is
 * the whole contract.
 */
export interface SpeedrunDriver {
  /** wall clock and the engine's displayed-frame count, sampled together */
  clock(): Promise<Clock>;
  /** evaluate an expression against `window.dbg` */
  evaluate<T>(expr: string): Promise<T>;
  /** wait until an expression holds, throwing named if it never does */
  hold(expr: string, what: string, budget?: number): Promise<void>;
  /** the same, but running out is an answer rather than a failure */
  tryHold(expr: string, budget: number): Promise<boolean>;
  /** the wait half of a gesture — what a sheet's `wait:` moves */
  settle(mode: WaitMode, what: string, budget?: number): Promise<void>;
  /** plain delay; the one thing a run should never need and sometimes does */
  sleep(ms: number): Promise<void>;
  /** `after:` padding, counted separately so the report can call it dead time */
  pad(ms: number): Promise<void>;
  padded(): number;

  /**
   * A key press, gated so it cannot be eaten by a fade.
   *
   * The gate is BEFORE the press and is not skippable by `wait: none`: `wait` says
   * how much of the CONSEQUENCE to wait for, never whether the gesture is allowed
   * to be thrown away. See {@link KEY_SAFE}.
   */
  key(name: string, wait?: WaitMode, budget?: number): Promise<void>;
  /** ungated, for the few presses aimed at something that is not the engine */
  rawKey(name: string): Promise<void>;
  clickAt(x: number, y: number, wait?: WaitMode, budget?: number): Promise<void>;
  /**
   * Press at a point and KEEP THE BUTTON DOWN until `until` holds.
   *
   * For the scripts that wait for a press by POLLING for one, rather than by
   * being handed one. `while not button()` is the shape, and TAOOT's
   * `dobook()` — hiding the Rubaiyat in a coal bunker — is the case that needs
   * it: the inventory's OK runs `transfromflat()` first, whose two fade ramps
   * block the script for their ten ticks each, and only then does `dobook` start
   * asking. A click is over long before that, so the press it is waiting for
   * never exists and the loop parks for good.
   *
   * A player does not notice, because a player holds the button while they aim.
   * This is that gesture, and it is a different one from a click rather than a
   * slower version of it: the button being down IS the signal, and where the
   * cursor is when the loop finally reads it decides where the thing lands.
   *
   * `arm` is what has to become true before `until` is worth waiting for, and it
   * is how a hold tells "nobody was listening" apart from "it did not work". The
   * default pair is `polling` then `!polling`: a script has to be IN an input
   * loop before its letting go can mean anything, and without the first half a
   * press nothing is waiting for reports instant success.
   *
   * Both halves are answered rather than assumed, because a hold that quietly
   * gave up looks exactly like one that worked until the next line fails
   * somewhere else — which is how `until: !owns.rubaiyat` hid a drop that landed
   * back in the bag, a branch that hides the book without changing its owner.
   */
  holdAt(x: number, y: number, opts: HoldOptions, budget?: number): Promise<HoldResult>;
  /** press a key repeatedly until a condition holds; returns how many went in */
  hammer(name: string, opts: HammerOptions): Promise<number>;
  /** a point that clicks a named thing, via the engine's own hit test */
  aim(kind: "thing" | "hotspot", name: string): Promise<Point | null>;
  drag(from: Point, to: Point, steps?: number): Promise<void>;
  /**
   * A held drag: press, then walk the cursor wherever `next` says, then release.
   *
   * `next` may be ASYNC, and for a dial it has to be. A dial is steered by
   * reading its deg back between frames, and out here that reading is a round
   * trip into the page rather than a field — so a caller that could only answer
   * synchronously would have to answer from a cache filled before the press,
   * which is a picture of where the dial USED to be. It reads the same number
   * every frame, never sees itself arrive, and winds to an end stop instead
   * (measured: valve3 asked for 7 went 2->19, 19->0, 0->19 and was called stuck).
   * Awaiting here lets it look.
   *
   * RESOLVES WITH THE RELEASE ALREADY ACTED ON, not merely sent. Several of this
   * game's controls snap when the button comes up rather than as the cursor
   * moves, so what a caller reads next is set by the release; an implementation
   * that returns at the mouseup hands back the setting from before the drag.
   */
  dragProp(at: Point, next: (start: Point) => Point | null | Promise<Point | null>, budget?: number): Promise<void>;

  /**
   * Keep a savegame between runs, and fetch one back.
   *
   * Optional because WHERE a save lives is the one thing the two hosts cannot
   * agree on: the page has localStorage and no disk, the CLI has a disk and a
   * fresh browser profile every run. So the verbs ask the driver rather than
   * choosing, and a host that offers neither simply has no load points.
   */
  putSave?(name: string, bytes: Uint8Array): Promise<void>;
  getSave?(name: string): Promise<Uint8Array | null>;

  /**
   * Put the game back to a cold boot — `reset()`.
   *
   * A reload, in both hosts, because that is the only thing that is honestly the
   * beginning: `coldBoot` assumes a fresh session and re-running it over a
   * played game would leave the globals, the cast, the open shops and the
   * scheduler's tables from the run before, which is a state no player can be in
   * and no route should be tuned against.
   *
   * The two hosts pay for it differently, and the difference is unavoidable. The
   * CLI drives the page from OUTSIDE, so a reload is an ordinary await and the
   * run carries on over it. The workbench IS the page: a reload takes the run
   * loop with it, so this call never returns there, and the page has to have
   * written down where it was first. See `beforeRestart` in page-driver.ts.
   */
  restart?(): Promise<void>;

  /**
   * Stop the run here and leave it resumable — `pause()`, the sheet's breakpoint.
   *
   * Optional because it only means something to a host with a Play button. An
   * unattended CLI run has nobody to press it, so it does not offer this and the
   * verb steps over it with a note — a sheet with breakpoints in it still times
   * end to end under `npm run speedrun -w taoot`, which is what makes them safe to leave
   * in while a leg is being worked on.
   *
   * It THROWS {@link Paused} rather than returning; there is no sensible value
   * for "the run stopped" to come back as.
   */
  pause?(): never;

  log(message: string): void;
  /**
   * The Playwright page, when there is one.
   *
   * The single admitted leak, and it buys the planner escape hatches: `travel`,
   * `hunt` and `stand` build the Node-side browser driver, which parses `.SET`
   * files off disk and cannot exist in a page. An action that needs it says so by
   * checking for it, and fails with an explanation rather than a TypeError.
   */
  page?: unknown;
}

/**
 * Raised by `pause()`. Not a failure, and told apart from one by its type.
 *
 * Shared rather than living beside `Aborted` in page-driver.ts because both the
 * driver that throws it and the page that reads it out of the run's result need
 * the same class — an `instanceof` across two copies is a bug that only shows up
 * as a pause being reported as a crash.
 */
export class Paused extends Error {
  constructor() {
    super("paused");
    this.name = "Paused";
  }
}

/* ------------------------------------------------------------------ *
 * Predicates both hosts share
 * ------------------------------------------------------------------ */

/**
 * A key is safe to send — that is, it will not be silently dropped.
 *
 * Read straight off `SetViewer.keyDown`'s own order of business: a playing movie
 * takes the key outright (ESC aborts a clip), a suspended conversation takes it
 * (ESC skips the line being spoken), a running camera move QUEUES it, and only
 * past all three does the `inputLocked` refusal apply. So the unsafe state is
 * precisely "locked, with none of the three owners" — which in practice means a
 * fade is ramping and nothing else is.
 *
 * That gap is real and documented in the engine (the long NOTE on `pressNav` in
 * engine/src/web/viewer.ts): a press made while a fade ramps is DISCARDED, no handler runs,
 * nothing is logged. It cost the browser suite a 120 s timeout at ENGINE.SET's
 * View120 once. A speedrun presses earlier than anything else ever has, so it
 * meets that gap constantly and this gate is not optional.
 *
 * `movingCamera` is private in TypeScript and a plain getter at runtime. This is
 * evaluated rather than compiled, so it reads it directly — deliberately, because
 * the alternative is duplicating an engine predicate that would then drift.
 */
export const KEY_SAFE = `(() => {
  const v = window.dbg && window.dbg.viewer;
  if (!v) return false;
  if (v.moviePlaying) return true;
  if (v.conversing) return true;
  if (v.movingCamera) return true;
  return !v.inputLocked;
})()`;

/** the engine has consumed everything posted to it */
export const QUEUE_EMPTY = `window.dbg.session.events.length === 0`;

/** the browser suite's settle predicate, unchanged */
export const QUIET = `(() => { const v = window.dbg && window.dbg.viewer; return !!v && (v.quiescent || v.conversing); })()`;

/** a cutscene is on screen and is not asking anything — the one state ESC is for */
export const SHOWING = `(() => { const v = window.dbg && window.dbg.viewer; return !!v && v.moviePlaying && v.movieRegions.length === 0; })()`;

/** the expression a given wait mode waits on, or null for `none` */
export function waitExpr(mode: WaitMode): string | null {
  if (mode === "none") return null;
  if (mode === "taken") return QUEUE_EMPTY;
  if (mode === "ready") return KEY_SAFE;
  return QUIET;
}
