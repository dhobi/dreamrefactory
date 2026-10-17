/**
 * What the run is pressing, drawn over the game.
 *
 * A speedrun sheet plays the game through synthesized events, so the one thing
 * you cannot see while watching a run is the run itself: the picture moves and
 * nothing says whether that was an arrow, a click, or the engine doing something
 * on its own. This is that missing half — a keyboard and a mouse in the corner
 * of the screen (which corner is speedrun/index.html's `#inputs`), each key
 * lighting as it is pressed.
 *
 * ## It watches, and it is not in the way
 *
 * Every listener is capture-phase and passive, exactly as the recorder's are: no
 * `preventDefault`, no `stopPropagation`, nothing returned. The overlay's own
 * element takes `pointer-events: none`, so the canvas underneath keeps every
 * gesture — a person can still play the game by hand through it.
 *
 * ## Synthetic events count, and that is the point
 *
 * `isTrusted` is deliberately NOT asked, which is the opposite of what the
 * recorder does with the same events. The recorder wants to know whether a HUMAN
 * made a gesture, because it is writing down what a human did; this wants to
 * know whether the GAME was told to do something, and a sheet's keypress is as
 * real to the engine as a finger's. So both light the same key.
 *
 * What it does ask is the question the engine asks: {@link focusOwnsKey}. Typing
 * a route into the sheet box is typing, not playing, and a keyboard that flashed
 * along with the editor would be reporting keys the game never saw.
 *
 * ## Which keys are drawn
 *
 * The ones a ROUTE presses, which is fewer than the ones the game takes:
 *
 *   - the ARROWS. Down as well as up: it is not a movement key in the original
 *     either, but `SMSTACK2`/`SMSTACK3`'s ladder platforms read it out of their
 *     scene `keydown` and it is the only way down a level (#100).
 *   - SPACE, the door opener.
 *   - ESC, which skips a spoken line and hammers through a cutscene.
 *   - the game's own MOVEMENT LETTERS, which light the arrow they are routed
 *     to rather than a key of their own. They are real bindings and not a
 *     convenience: BOOTFILE 0001's `keydown` is a router, and it maps
 *     `keynorth` -> uparrow, `keywest` -> leftarrow, `keyeast` -> rightarrow
 *     (session.ts) before the scene ever sees the press. W, A and D are only
 *     their DEFAULTS — the control panel rebinds them and a savegame carries
 *     the answer (`keynorth="w"`) — so the live values are read from the
 *     session and the display follows a rebind. S is the exception and is the
 *     display's own: there is no `keysouth`, the original binds three keys and
 *     not four, and S is here because a hand on WASD expects the set to be
 *     complete. It lights the DOWN arrow, which the smokestack ladders read.
 *   - one SPARE key, which is every other character. TI.EXE hands anything it
 *     does not name straight to the scripts as a literal, and the telegram is
 *     typed — `key(e)` — so the spare relabels itself to whatever was pressed
 *     rather than pretending the alphabet is not in play.
 *
 * M, O, X (the map, the hotspot overlay, the details pane), the 0-9 volume and
 * F1/F2's brightness are all keys the game takes and are all deliberately absent.
 * A route presses none of them — they change what the PLAYER sees, and a run has
 * nobody to see it — so drawing them cost a third of the display's width to show
 * a row that never lights. Anything pressed anyway still shows: it goes to the
 * spare, labelled, which is the other half of why the spare is there.
 */
import { focusOwnsKey } from "@dreamfactory/engine/web/keys";

export interface InputMonitorOptions {
  /** the window the game is in — where `main.ts` listens for keys */
  win: Window & typeof globalThis;
  /** the game canvas: a click anywhere else is not a gesture at the game */
  canvas: HTMLCanvasElement;
  /** where to draw — an element over the screen, `pointer-events: none` */
  mount: HTMLElement;
}

/**
 * How long a key stays lit, in ms.
 *
 * A press is not an interval here. The driver dispatches `keydown` and `keyup`
 * in the same task (page-driver.ts `pressKey`), so a light held for the real
 * duration of a press would be on for zero frames and the display would show
 * nothing at all during the very runs it exists for. So a press is a FLASH of a
 * fixed length, long enough to read at the rate a route presses — a corridor is
 * one press per ~150 ms at the engine's own pace — and short enough that two
 * presses do not merge into one glow.
 */
const FLASH_MS = 140;

/** the mouse button is held for real (3 frames, page-driver CLICK_FRAMES), so it
 *  lights on the way down and out on the way up — with the same floor under it,
 *  or an instant click would be as invisible as a keypress */
const HOLD_FLOOR_MS = FLASH_MS;

/** what the spare key says when nothing has been typed into it */
const SPARE_REST = "·";

/** a key in the drawing: where it sits and what it says */
interface Key {
  /** `e.key` this answers to, lowercased where it is a letter. The spare has none */
  id: string;
  label: string;
  x: number;
  y: number;
  w?: number;
}

/** the unit key, and the gap between two of them — the whole layout is in these */
const U = 18;
const GAP = 2;
const step = (n: number): number => n * (U + GAP);

/**
 * The keyboard, in a 18px grid.
 *
 * Four rows, and the shape is the real one rather than a list: the arrows are a
 * T with the up key over the down key, because that is what the hand knows and
 * this is read at a glance while something else is happening.
 */
/** the keyboard block's width — the two full-width rows are cut to it */
const KEYS_W = step(6) - GAP;

const KEYS: Key[] = [
  // row 1 — the two that are not a direction. The spare takes the whole rest of
  // the row: it is the one key here that has something to SAY (the character it
  // caught), and it is the only place a letter, a digit or an F-key can appear.
  { id: "escape", label: "Esc", x: 0, y: 0, w: 28 },
  { id: "*", label: SPARE_REST, x: 30, y: 0, w: KEYS_W - 30 },

  // rows 2 and 3 — the route itself. The arrows keep the inverted T a hand
  // knows, and SPACE sits on the bottom row beside them: it is a bottom row key
  // on the thing being drawn, and on the route it belongs with them — `door()`
  // is space() then up(), and reading those two together is the point.
  { id: "arrowup", label: "↑", x: step(1), y: step(1) },
  { id: "arrowleft", label: "←", x: 0, y: step(2) },
  { id: "arrowdown", label: "↓", x: step(1), y: step(2) },
  { id: "arrowright", label: "→", x: step(2), y: step(2) },
  { id: " ", label: "Space", x: step(3), y: step(2), w: KEYS_W - step(3) },
];

/** the drawing's own box: the mouse stands to the right of the keys, as tall as
 *  all three rows of them */
const KEYS_H = step(3) - GAP;
const MOUSE_W = 30;
const VIEW_W = KEYS_W + 12 + MOUSE_W;
const VIEW_H = KEYS_H;

/**
 * Slack around the drawing, in layout units.
 *
 * An SVG stroke straddles its path: half of it falls OUTSIDE the rectangle it
 * outlines. The outermost keys sit flush against 0 and against the width and
 * height above, so without this the viewBox cuts every one of those strokes in
 * half — the bottom row and the left column lose their outer edge, and at this
 * scale (0.6 of a unit, ~1px drawn) half a stroke reads as no stroke, which is
 * exactly how it looked: keys that appeared cut off along the bottom.
 *
 * One unit rather than the 0.3 that would just cover it, so the box does not
 * have to be revisited if the stroke ever gets heavier.
 */
const PAD = 1;

const SVG_NS = "http://www.w3.org/2000/svg";

const el = <K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

export interface InputMonitor {
  /** take it down — the element is emptied and the listeners go */
  detach(): void;
}

/**
 * The movement letters, as the game routes them: which global holds the binding,
 * and which arrow the press comes out as.
 *
 * `null` where there is no global to read — S, which the original never bound.
 */
const MOVEMENT: { global: string | null; fallback: string; arrow: string }[] = [
  { global: "keynorth", fallback: "w", arrow: "arrowup" },
  { global: "keywest", fallback: "a", arrow: "arrowleft" },
  { global: "keyeast", fallback: "d", arrow: "arrowright" },
  { global: null, fallback: "s", arrow: "arrowdown" },
];

export function attachInputMonitor(opts: InputMonitorOptions): InputMonitor {
  const { win, canvas, mount } = opts;

  /**
   * Which arrow a letter is routed to right now, or null if it is not a
   * movement key.
   *
   * Asked of the live session — `window.dbg` is how page-side code reaches it
   * here, the same door page-driver.ts uses — so rebinding north to "i" in the
   * control panel moves the light with it. Before the boot has globals, and if
   * anything on the path is missing, the shipped defaults answer instead: a
   * display that shows W/A/D is right far more often than one that shows
   * nothing.
   */
  const globals = (): Map<string, unknown> | undefined =>
    (win as unknown as { dbg?: { session?: { interp?: { globals?: Map<string, unknown> } } } }).dbg
      ?.session?.interp?.globals;

  const arrowFor = (letter: string): string | null => {
    const g = globals();
    for (const m of MOVEMENT) {
      const bound = m.global ? g?.get(m.global) : undefined;
      const key = typeof bound === "string" && bound ? bound.toLowerCase() : m.fallback;
      if (key === letter) return m.arrow;
    }
    return null;
  };

  const svg = el("svg", {
    viewBox: `${-PAD} ${-PAD} ${VIEW_W + PAD * 2} ${VIEW_H + PAD * 2}`,
    width: VIEW_W + PAD * 2,
    height: VIEW_H + PAD * 2,
    "aria-hidden": "true", // a picture of what just happened; nothing to announce
    focusable: "false",
  });
  svg.classList.add("sr-keys");

  /** every drawn key by the `e.key` it answers to; the spare is under "*" */
  const caps = new Map<string, { g: SVGGElement; label: SVGTextElement }>();

  for (const key of KEYS) {
    const w = key.w ?? U;
    const g = el("g", { class: "cap" });
    g.append(
      el("rect", { x: key.x, y: key.y, width: w, height: U, rx: 3 }),
      // dominant-baseline rather than a dy fudge: the glyphs here are an arrow,
      // a digit and a word, and their ink sits at three different heights
      Object.assign(
        el("text", {
          x: key.x + w / 2,
          y: key.y + U / 2,
          "text-anchor": "middle",
          "dominant-baseline": "central",
        }),
        { textContent: key.label },
      ),
    );
    svg.append(g);
    caps.set(key.id, { g, label: g.querySelector("text")! });
  }

  // The mouse. Only the LEFT button ever lights, because the left button is the
  // whole of the game's mouse — nothing in TAOOT reads a right click, and the
  // driver sends `button: 0` and nothing else. The right one is drawn anyway and
  // stays dark: a shell with one quarter filled in does not read as a mouse, and
  // the point of drawing an object rather than a label is that it is recognised
  // before it is read.
  const mx = KEYS_W + 12;
  const r = MOUSE_W / 2;
  const lip = KEYS_H * 0.34; // where the buttons stop and the shell carries on
  const button = (left: boolean): SVGPathElement =>
    el("path", {
      d: left
        ? `M ${mx + 1} ${lip} L ${mx + 1} ${r} A ${r - 1} ${r - 1} 0 0 1 ${mx + r} 1 L ${mx + r} ${lip} Z`
        : `M ${mx + MOUSE_W - 1} ${lip} L ${mx + MOUSE_W - 1} ${r} A ${r - 1} ${r - 1} 0 0 0 ${mx + r} 1 L ${mx + r} ${lip} Z`,
      class: left ? "lmb" : "rmb",
    });
  const mouse = el("g", { class: "cap mouse" });
  mouse.append(
    el("rect", { x: mx, y: 0, width: MOUSE_W, height: KEYS_H, rx: r }),
    button(true),
    button(false),
  );
  svg.append(mouse);
  mount.append(svg);

  /** light a cap, and put it out again on its own */
  const timers = new Map<Element, number>();
  const flash = (g: SVGElement, out?: () => void): void => {
    g.classList.add("on");
    win.clearTimeout(timers.get(g));
    timers.set(
      g,
      win.setTimeout(() => {
        g.classList.remove("on");
        out?.();
      }, FLASH_MS),
    );
  };

  const onKey = (e: KeyboardEvent): void => {
    // The same question the engine asks before it acts on a key (main.ts, and
    // the recorder for the same reason): with the sheet box focused, typing is
    // typing. `isTrusted` is NOT asked — see this file's head.
    if (focusOwnsKey(e.target, e.key)) return;
    const id = e.key.toLowerCase();
    const cap = caps.get(id);
    if (cap) return flash(cap.g);
    // a movement letter is not a key of its own: it lights the arrow the boot
    // router turns it into, which is what the scene actually receives
    const arrow = id.length === 1 ? arrowFor(id) : null;
    if (arrow) return flash(caps.get(arrow)!.g);
    // anything else that is a character at all goes to the spare, which says
    // which one it was; a bare modifier is not a gesture and lights nothing
    if (e.key.length !== 1) return;
    // and it forgets the letter when it goes out: a character left sitting in an
    // unlit key reads as a key that is somehow still down
    const spare = caps.get("*")!;
    spare.label.textContent = e.key.toUpperCase();
    flash(spare.g, () => (spare.label.textContent = SPARE_REST));
  };

  // The button, in two facts rather than a stopwatch: is it down, and has it been
  // lit long enough to have been seen. The light goes out when both say so,
  // whichever answers last — so a real 3-frame press shows for its own length, an
  // instant one still shows for the floor, and a drag across five turbine dials
  // stays lit for the whole drag.
  //
  // Deliberately not `performance.now()` and a subtraction. Reading the clock in
  // `src/` is what taoot/tests/auto/reproducible.ts exists to stop, and while this file
  // could join the allow-list beside the workbench's other two, it does not need
  // to: the question is never "how long was that", only "may it go out yet".
  let down = false;
  let floorHeld = false;
  const outIfDue = (): void => {
    if (!down && !floorHeld) mouse.classList.remove("on");
  };
  const onDown = (): void => {
    down = true;
    floorHeld = true;
    mouse.classList.add("on");
    win.clearTimeout(timers.get(mouse));
    timers.set(
      mouse,
      win.setTimeout(() => {
        floorHeld = false;
        outIfDue();
      }, HOLD_FLOOR_MS),
    );
  };
  const onUp = (): void => {
    down = false;
    outIfDue();
  };

  win.addEventListener("keydown", onKey, true);
  // at the canvas, not the window: a press on one of the workbench's own buttons
  // is a person working the page, not an input to the game
  canvas.addEventListener("pointerdown", onDown, true);
  // the release at the WINDOW, so a drag that ends off the canvas still lets go
  // of the light — the turbine dials are dragged, and they are dragged far
  win.addEventListener("pointerup", onUp, true);
  win.addEventListener("pointercancel", onUp, true);

  return {
    detach(): void {
      win.removeEventListener("keydown", onKey, true);
      canvas.removeEventListener("pointerdown", onDown, true);
      win.removeEventListener("pointerup", onUp, true);
      win.removeEventListener("pointercancel", onUp, true);
      for (const t of timers.values()) win.clearTimeout(t);
      mount.textContent = "";
    },
  };
}
