/**
 * Record mode — play the game by hand, get a sheet.
 *
 * The workbench's other half. Writing a route by typing means knowing the verb
 * for a gesture before you have made it, and knowing what the thing under the
 * cursor is called; playing it means neither. So this watches the real input the
 * player makes and writes the line that would have made it, one action per line,
 * at the caret.
 *
 * ## It watches, it does not intercept
 *
 * Every listener is passive: capture phase, no `preventDefault`, no
 * `stopPropagation`. The engine receives exactly the events it would have
 * received with this switched off, which is the only way a recording can be of
 * the game you were actually playing. Turning record mode on must not change how
 * the game plays, or the sheet describes a game nobody played.
 *
 * ## `isTrusted` is the whole filter
 *
 * A run's own gestures are synthesized (`dispatchEvent` from page-driver.ts) and
 * carry `isTrusted: false`; a person's come from the browser and carry true. So
 * the two are told apart by the one bit that cannot be forged from script — and
 * pressing Play while recording does not fill the sheet with a copy of itself.
 *
 * That bit is load-bearing elsewhere too, in the opposite direction: `main.ts`
 * never asks for it, which is why the driver's synthetic events drive the game
 * at all. Here it is asked precisely because the question is "did a HUMAN do
 * this", and there it is not asked because the question is "is this a gesture".
 *
 * ## Names, not pixels
 *
 * A click is written as `click(bag)` when the engine's own hit test can say what
 * was under it, and `clickAt(x, y)` when it cannot. The named form survives a
 * route that arrives at the same view by a different path; the pixel form is for
 * movie regions and flats, which have no names to aim at — the same division the
 * hand-written sheet already makes.
 */
import { focusOwnsKey } from "../keys";

export interface Recorder {
  /** is it armed */
  readonly on: boolean;
  set(on: boolean): void;
}

export interface RecorderOptions {
  /** the window the game is in — where `main.ts` listens for keys */
  win: Window & typeof globalThis;
  /** the game canvas, for clicks and for turning a point into a canvas pixel */
  canvas: HTMLCanvasElement;
  /** write one action into the sheet, wherever the caret is */
  write(line: string): void;
}

/**
 * The keys that are a VERB rather than a keypress.
 *
 * Everything else a sheet says with `key(...)`, which is the escape hatch for
 * exactly this: the engine takes letters and digits for things the route
 * vocabulary has no name for — the telegram's "e", the volume digits — and a
 * recording should not have to invent one.
 */
const VERBS: Record<string, string> = {
  ArrowLeft: "left()",
  ArrowRight: "right()",
  ArrowUp: "up()",
  " ": "space()",
  Escape: "esc()",
};

/** modifier keys, which are never a gesture on their own */
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"]);

export function attachRecorder(opts: RecorderOptions): Recorder {
  const { win, canvas, write } = opts;
  let on = false;

  const onKey = (e: KeyboardEvent): void => {
    if (!on || !e.isTrusted) return;
    // A modifier held means a browser or OS shortcut, not a gesture at the game.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (MODIFIERS.has(e.key)) return;
    // The same question the engine asks before it acts on a key: is something
    // else focused? Typing a sheet into the editor is typing, not playing, and
    // recording it would fill the sheet with the sheet.
    if (focusOwnsKey(e.target, e.key)) return;

    const verb = VERBS[e.key];
    if (verb) return write(verb);
    // a single character is written as itself; a named key by its name, which is
    // what `key()` takes
    if (e.key.length === 1) return write(`key(${e.key})`);
    write(`key(${e.key})`);
  };

  const onPoint = (e: PointerEvent): void => {
    if (!on || !e.isTrusted) return;
    // main.ts's own mapping, floor and all, so the pixel recorded is the pixel
    // the engine was handed
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * canvas.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * canvas.height);

    const name = nameAt(win, x, y);
    write(name ? `click(${name})` : `clickAt(${x}, ${y})`);
  };

  win.addEventListener("keydown", onKey, true);
  canvas.addEventListener("pointerdown", onPoint, true);

  return {
    get on() {
      return on;
    },
    set: (next: boolean) => {
      on = next;
    },
  };
}

/**
 * The types `hitTestAt` answers with that name something a `click()` can reach.
 *
 * The engine's own sweep asks in a deliberate order — a prop first and
 * everywhere (the band's items ARE screen-space), then an actor but only inside
 * the set image, then the view's hotspots — and each of those four is a name the
 * `click` verb takes: "hotspot, character, prop or flat region".
 *
 * The three it can also answer are names of the wrong kind, and recording them
 * would produce a line that parses and then aims at nothing. `scene` is the
 * fallback for a point inside the room that hit none of the above; `flat` is the
 * overlay itself rather than a region on it; `none` is off everything. Those are
 * what `clickAt` is for, along with a parked movie's regions, which are not flat
 * regions and are why the hand-written sheet clicks the title menu by pixel.
 */
const CLICKABLE = new Set(["prop", "actor", "painting", "button"]);

/**
 * What the engine says is under a point, or null.
 *
 * Asked through `session.hitTestAt` — the same routing the game uses to decide
 * what a click DOES, props and actors and all — rather than through the viewer's
 * bare `hitTest`, which only sees the view's hotspots. That difference is the
 * whole quality of a recording: with the narrow test, clicking the bag on the
 * bed or Penny in the gym recorded a raw pixel, because neither is a hotspot.
 */
function nameAt(win: Window, x: number, y: number): string | null {
  try {
    const dbg = (win as unknown as {
      dbg?: { session?: { hitTestAt?(x: number, y: number): { name: string; type: string } | null } };
    }).dbg;
    const hit = dbg?.session?.hitTestAt?.(x, y) ?? null;
    if (!hit || !hit.name || !CLICKABLE.has(hit.type)) return null;
    return String(hit.name);
  } catch {
    return null;
  }
}
