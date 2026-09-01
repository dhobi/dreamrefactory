/**
 * How WIDE each workbench panel is — the reader's answer, like the order beside it.
 *
 * The row's three movable columns ship with a share each: the sheet asks for
 * 26rem, the Timer 22rem, the X pane 20rem, and whatever the window has left
 * over after the canvas is split between them (speedrun/index.html, #srlayout).
 * Those shares are a guess at what a reader wants, and they are wrong as often
 * as they are right — a long `wait(js: ...)` line wants the sheet wider, a
 * 161-row state list wants the pane wider, and the two people wanting those are
 * not doing the same job. So the edge between two columns is draggable, and
 * where it is dragged to is remembered.
 *
 * This is the second half of {@link ./speedrun-columns}: that one settles which
 * order the panels come in, this one settles how much of the row each takes —
 * the picture included, which is the one column that is not dragged (see
 * {@link installPictureScale} at the foot of this file).
 * They are separate files because they are separate answers, but they share the
 * list of what is movable and they have to agree about the tree — see the grip
 * placement below.
 *
 * ## Why a grip between the columns, and not `resize: horizontal`
 *
 * One CSS line against this whole file, and it does not work here. The sections
 * scroll (`overflow: auto` above the break), so the corner grip a UA draws sits
 * on top of the scrollbar and scrolls away with the content; the inline `width`
 * it writes is beaten by `flex-basis`; and nothing about it is remembered. The
 * same objection sinks a grip placed INSIDE a section: an absolutely positioned
 * one is clipped by the very `overflow` that makes the column readable.
 *
 * So the grip is a sibling in the row — a flex item of its own, sat in the gap
 * to the right of the section it belongs to. It cannot be clipped by a column
 * because it is not in one, it cannot collide with a scrollbar for the same
 * reason, and being a real box in the row means it stays put through a wrap
 * without anything recomputing where it goes.
 *
 * ## Two custom properties rather than an inline width
 *
 * `--col-w` and `--col-grow`, read by the stylesheet as
 * `flex: var(--col-grow, 1) 1 var(--col-w, 26rem)`. An inline `style.flex` would
 * be shorter and would be a bug: `#srlayout` is a COLUMN below the break, where
 * a flex-basis is a HEIGHT — a sheet dragged to 700px wide on a desktop would
 * come back as a 700px-tall panel on a phone. A custom property is inert until a rule
 * reads it, and only the rule inside the media query does, so a width means
 * nothing at a width where it means nothing.
 *
 * The grow half is what makes the drag track the pointer. A column left at
 * `flex-grow: 1` takes a share of the row's spare space on top of its basis, so
 * a 100px drag moves its edge by 67; pinned at grow 0 the basis IS the width,
 * and the edge lands where the pointer is.
 *
 * ## The limits are the stylesheet's, and are read back from it
 *
 * A column stops at 512px — the picture's own width at 1x, which the sheet and
 * the pane share, the Timer being allowed down to 200 — and at 1024 going the
 * other way. Both are already written down, in the `min-width` and `max-width`
 * beside the flex, so the drag asks
 * `getComputedStyle` what they are rather than repeating them here, where a
 * second copy would go stale the first time one of them moved. Same for the
 * break, which moves with the picture's scale and which nothing in this file
 * knows the number of: a grip below the break is `display: none` and cannot be
 * grabbed, so the question never comes up.
 *
 * ## Pointer-only, deliberately
 *
 * The same bargain {@link ./speedrun-columns} makes, for the same reason: this
 * is a workbench driven with a mouse. A column at its default width is a column
 * at a width someone chose, and everything on the page is reachable without ever
 * touching a grip.
 */

import { COLUMNS_CHANGED, MOVABLE } from "./speedrun-columns";

/** where the answer outlives the tab, beside the order's own key */
const KEY = "taoot:speedrun:widths";

/**
 * How far the pointer travels before a click becomes a drag.
 *
 * Without it every stray click on a grip would pin that column at the width it
 * happened to have — a change nobody asked for, from a gesture that looked like
 * nothing. It is also what leaves the double-click below free to mean something.
 */
const SLOP = 2;

/** content-box px, which is the box `flex-basis`, `min-width` and `max-width` are all in */
type Widths = Record<string, number>;

const num = (v: string): number => parseFloat(v);

/** what the stylesheet allows this column to be, asked of it rather than repeated */
function bounds(section: HTMLElement): { min: number; max: number } {
  const cs = getComputedStyle(section);
  const min = num(cs.minWidth);
  const max = num(cs.maxWidth);
  // `auto` and `none` both come back unparseable, and both mean "no limit here"
  return { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : Infinity };
}

/**
 * The column's width as the layout actually resolved it.
 *
 * `getComputedStyle().width` and not `getBoundingClientRect()`: the sections are
 * `content-box` (there is no global `border-box` rule on this page) and carry
 * 0.5rem of side padding, so a rect is 16px wider than the number a `flex-basis`
 * or a `min-width` is talking about. Mixing the two boxes is a 16px jump the
 * moment a drag starts.
 */
const widthOf = (section: HTMLElement): number => num(getComputedStyle(section).width);

function pin(section: HTMLElement, w: number): void {
  section.style.setProperty("--col-w", `${Math.round(w)}px`);
  section.style.setProperty("--col-grow", "0");
}

/** give the column back to the row: the stylesheet's own share, and it grows again */
function unpin(section: HTMLElement): void {
  section.style.removeProperty("--col-w");
  section.style.removeProperty("--col-grow");
}

/**
 * The stored widths, taking only what this page recognises.
 *
 * Same guard as the order's: an id we do not move, or anything that is not a
 * positive number, is dropped rather than trusted. A stale or hand-edited entry
 * can then make a column the wrong width — never make it disappear.
 */
function stored(): Widths {
  const out: Widths = {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return out;
    const val = JSON.parse(raw) as unknown;
    if (!val || typeof val !== "object" || Array.isArray(val)) return out;
    for (const [id, w] of Object.entries(val as Record<string, unknown>)) {
      if (!MOVABLE.includes(id)) continue;
      if (typeof w !== "number" || !Number.isFinite(w) || w <= 0) continue;
      out[id] = w;
    }
  } catch {
    /* unreadable or unparseable is the same as unset — the stylesheet's shares stand */
  }
  return out;
}

function save(widths: Widths): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(widths));
  } catch {
    /* not remembering is survivable — the widths still hold for this tab */
  }
}

/**
 * Whether a grip is being held.
 *
 * Read by the guard in {@link installColumnWidths} that cancels the OTHER drag
 * this row has. The two gestures start a pixel apart — a heading is dragged to
 * reorder, an edge is dragged to resize — and a press on the edge was starting
 * both: Chromium answers a mousedown near a draggable element by beginning a
 * native drag of it, so pulling the Timer's edge left picked the sheet's heading
 * up and dropped it on the Timer, which reordered the row instead of resizing
 * anything. Measured: `dragstart on H2` fires straight after `pointerdown on
 * DIV.sr-grip`, with no `h2` anywhere near the pointer.
 */
let pressing = false;

/** hold the grip, move the edge */
function draggable(section: HTMLElement, grip: HTMLElement, id: string, widths: Widths): void {
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    pressing = true;
    const startX = e.clientX;
    const startW = widthOf(section);
    const { min, max } = bounds(section);
    let moved = false;

    const move = (ev: PointerEvent): void => {
      const dx = ev.clientX - startX;
      if (!moved) {
        if (Math.abs(dx) < SLOP) return;
        moved = true;
        grip.classList.add("dragging");
        // the cursor keeps its meaning wherever the pointer wanders, and nothing
        // under it takes a selection on the way past
        document.body.classList.add("sr-resizing");
      }
      pin(section, Math.min(max, Math.max(min, startW + dx)));
    };

    const done = (): void => {
      pressing = false;
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", done);
      grip.removeEventListener("pointercancel", done);
      grip.classList.remove("dragging");
      document.body.classList.remove("sr-resizing");
      if (!moved) return;
      // what was RESOLVED, not what was asked for: the stylesheet's own clamp
      // has had its say by now, and storing the ask would replay a width the
      // layout already refused
      widths[id] = widthOf(section);
      save(widths);
    };

    // capture, so the drag survives the pointer leaving a 2px-wide element on
    // its first frame — which it does, because the element is what is moving
    grip.setPointerCapture(e.pointerId);
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", done);
    grip.addEventListener("pointercancel", done);
  });

  // The way out. Once a width is remembered there is otherwise no gesture that
  // gives it back, and "put it how it was" should not mean clearing storage.
  grip.addEventListener("dblclick", () => {
    unpin(section);
    delete widths[id];
    save(widths);
  });
}

/**
 * Hang a grip off the right edge of every movable column, and read the stored
 * widths back.
 *
 * Called after {@link ./speedrun-columns.installColumnOrder}, so the sections are
 * already in the reader's order and each grip is created where it belongs.
 */
export function installColumnWidths(): void {
  const row = document.getElementById("srlayout");
  if (!row) return;

  // No native drag may begin while a grip is held — see {@link pressing}. In
  // the capture phase and on the row rather than on the heading, because the
  // heading it picks up is not the one under the pointer and may be any of them.
  // NOT `preventDefault` on the grip's own pointerdown, which would do the same
  // job and take the double-click below with it.
  row.addEventListener(
    "dragstart",
    (e) => {
      if (pressing) e.preventDefault();
    },
    true,
  );

  const widths = stored();
  const grips = new Map<string, HTMLElement>();

  for (const id of MOVABLE) {
    const section = document.getElementById(id);
    if (!section) continue;

    const grip = document.createElement("div");
    grip.className = "sr-grip";
    grip.title = "Drag to set this panel's width — double-click to give it back";
    section.after(grip);
    grips.set(id, grip);

    const w = widths[id];
    // clamped on the way in as well as on the way out: the limits are the
    // window's as much as the stylesheet's, and the window may have changed
    // since the width was stored
    if (w !== undefined) {
      const { min, max } = bounds(section);
      pin(section, Math.min(max, Math.max(min, w)));
    }

    draggable(section, grip, id, widths);
  }

  // A reorder moves the sections and leaves the grips where they were, so each
  // one is put back behind its own column. Announced by the order module rather
  // than watched for, because a MutationObserver here would see the moves this
  // very handler makes and have to be taught to ignore itself.
  row.addEventListener(COLUMNS_CHANGED, () => {
    for (const [id, grip] of grips) document.getElementById(id)?.after(grip);
  });
}

/* ---------------------------------------------------------------------------
 * …and how much of it the PICTURE takes.
 * ------------------------------------------------------------------------- */

/** the same store as the widths, one key along */
const SCALE_KEY = "taoot:speedrun:picture";

/** every scale the canvas may be drawn at, and the one it opens at */
const SCALES = ["1", "2", "3"];
const DEFAULT_SCALE = "2";

/**
 * Which whole multiple of 512x384 the screen is drawn at.
 *
 * Not a grip, and the reason is the case the control exists for. A grip lives in
 * the row and the row is only there above the break — but the reader who most
 * wants a smaller picture is the one on a 1280 laptop looking at the STACKED
 * layout, where turning the screen down to 1x is precisely what earns them the
 * row. A control that only appears once you no longer need it is not a control.
 *
 * So it is the page's own three-way segment (speedrun/index.html, #srscale), and
 * all this does is put the answer on `<html>` where the stylesheet can see it:
 * the canvas reads it for its width, and the three thresholds that decide
 * whether the row is on read it too.
 *
 * WHOLE multiples only, hence three buttons and not a slider. The canvas is
 * `image-rendering: pixelated`, so at 1.5x every second game pixel is drawn
 * twice as wide as its neighbour — a picture that is not the one the artist
 * drew, on a page whose entire subject is what the game actually did.
 */
export function installPictureScale(): void {
  const box = document.getElementById("srscale");
  if (!box) return;
  const radios = [...box.querySelectorAll<HTMLInputElement>('input[name="picture"]')];

  const show = (px: string): void => {
    document.documentElement.dataset.px = px;
    for (const r of radios) r.checked = r.value === px;
  };

  let start = DEFAULT_SCALE;
  try {
    const raw = localStorage.getItem(SCALE_KEY);
    if (raw && SCALES.includes(raw)) start = raw;
  } catch {
    /* unreadable is the same as unset — the page opens at 2x, as it always did */
  }
  show(start);

  for (const r of radios) {
    r.addEventListener("change", () => {
      if (!r.checked) return;
      show(r.value);
      try {
        localStorage.setItem(SCALE_KEY, r.value);
      } catch {
        /* not remembering is survivable — the scale still holds for this tab */
      }
    });
  }
}
