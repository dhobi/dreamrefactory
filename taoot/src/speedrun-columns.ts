/**
 * What order the workbench's panels come in — the reader's answer, not ours.
 *
 * The page's row is four columns: the canvas, the Timer, the Speedrun sheet and
 * the X pane (speedrun/index.html, #srlayout). The canvas keeps the head of it,
 * because it is the thing being watched and nothing is read while it is off
 * screen. The other three are a genuine preference: the sheet is what a route is
 * written in, the Timer is what it reads out as, and the X pane is what you look
 * at when neither of those explains what the game just did — which of them wants
 * to be nearest the picture depends on what you are doing. That was being settled
 * by editing the markup, which is not a thing a reader of the page can do, so it
 * is settled by dragging one heading onto another instead, and it is remembered.
 *
 * Every one of the three is a `<section>`-shaped panel with an `<h2>`, and the
 * heading is the handle. The X pane is shared with /play, which has the same
 * heading and no handle at all: nothing there imports this, and with one panel
 * there would be nothing to reorder it against.
 *
 * ## Why the DOM moves rather than `order`
 *
 * A flex `order` would be one line and would not touch the tree. It would also
 * put the tab ring and the screen reader's reading order out of step with what
 * is on screen — the two are the same row, and the whole point of this is that
 * the reader chose the visual order, so that IS the order. Moving the node keeps
 * every listener (they travel with it), the textarea's value, and the painted
 * `<pre>` under it, because all of them are inside the section being moved.
 *
 * ## What is drawn while a drag is in flight
 *
 * The section it would land on, and only that. Dimming the one being CARRIED is
 * the usual other half, and it wants a `setTimeout(0)` — the browser takes the
 * drag image after the `dragstart` handler returns, so a class added there dims
 * the thing being carried as well as the thing left behind. That timer is a wall
 * clock in `src/`, which taoot/tests/auto/reproducible.ts holds the whole tree to, and
 * it is not worth an exemption for: the one you are carrying is the one you
 * grabbed, and the pointer is on it.
 */

/** where the answer outlives the tab — the key shape the rest of this page uses */
const KEY = "taoot:speedrun:columns";

/**
 * The ones that move, in the order the markup declares them.
 *
 * Also the whitelist: a stored order is only honoured if it is a permutation of
 * exactly this, so a hand-edited or stale entry cannot hide a section or invent
 * one. Anything else and the markup's own order stands.
 */
export const MOVABLE: readonly string[] = ["srtimer", "srpanel", "details"];

/**
 * Said on the row once the tree has been put in an order.
 *
 * The widths beside this one (taoot/src/speedrun-widths.ts) hang a grip off each
 * column, and a grip is a sibling in the row: reordering the sections leaves
 * them behind. Rather than have that module watch the tree — a MutationObserver
 * that would see its own repairs — the module that DID the moving says so.
 */
export const COLUMNS_CHANGED = "taoot:columns";

/**
 * What they are placed after: the canvas keeps the head of the row.
 *
 * Everything movable is a sibling following it, so this is the only fixed point
 * the placement needs — and if it is missing we are not on the workbench page
 * and there is nothing here to do.
 */
const ANCHOR = "srgame";

/**
 * Our own drag, said in a way nothing else will read.
 *
 * NOT `text/plain`. The sheet is a `<textarea>` and it accepts a text drop, so a
 * heading dragged over the sheet with `text/plain` set drops the id INTO the run
 * sheet. A type nobody else claims cannot be pasted anywhere; the drop handlers
 * below also cancel the default on every drop while one of these is in flight,
 * which is what stops the textarea taking it even so.
 */
const MIME = "application/x-taoot-column";

/** which section is being carried, or null */
let carrying: string | null = null;

/**
 * The order the tree is in now.
 *
 * Read off the DOM rather than kept in a variable beside it, because the DOM is
 * the record: {@link apply} is what moves them, and anything that reads a copy
 * can be wrong about what happened.
 */
function current(): string[] {
  const row = document.getElementById("srlayout");
  if (!row) return [...MOVABLE];
  const seen = [...row.children].map((el) => el.id).filter((id) => MOVABLE.includes(id));
  // anything the row does not have keeps its declared place at the back
  return [...seen, ...MOVABLE.filter((id) => !seen.includes(id))];
}

/** the stored order, if it is one we recognise */
function stored(): string[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const order = JSON.parse(raw) as unknown;
    if (!Array.isArray(order) || order.length !== MOVABLE.length) return null;
    // a permutation of MOVABLE and nothing else: same members, no repeats
    if (!MOVABLE.every((id) => order.includes(id))) return null;
    if (new Set(order).size !== order.length) return null;
    return order as string[];
  } catch {
    /* unreadable or unparseable is the same as unset — the markup's order stands */
    return null;
  }
}

/**
 * Put the tree in `order`.
 *
 * Walked from the canvas outwards, each one placed after the last — which needs
 * no arithmetic and no knowledge of how many there are. The {@link nextPanel}
 * test is not an optimisation: re-inserting a node that is already where it
 * belongs still tears down and rebuilds its rendering, which for the sheet means
 * a textarea losing its selection every time anything moves.
 */
function apply(order: string[]): void {
  let after: Element | null = document.getElementById(ANCHOR);
  if (!after) return;
  for (const id of order) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (nextPanel(after) !== el) after.after(el);
    after = el;
  }
  document.getElementById("srlayout")?.dispatchEvent(new CustomEvent(COLUMNS_CHANGED));
}

/**
 * The next sibling that is one of OURS.
 *
 * Not `nextElementSibling`, because the row holds more than the panels: a width
 * grip sits between each pair (taoot/src/speedrun-widths.ts), and against a raw
 * sibling every panel looks out of place — so every one of them is re-inserted,
 * which is precisely the teardown the note above says must not happen.
 */
function nextPanel(el: Element): Element | null {
  let n = el.nextElementSibling;
  while (n && !MOVABLE.includes(n.id)) n = n.nextElementSibling;
  return n;
}

/**
 * Headings become handles, and the stored answer is read back.
 *
 * Pointer-only: this is native HTML5 drag and drop, which a touch screen does
 * not produce and a keyboard cannot start. That is the same bargain the rest of
 * this page makes — it is a workbench driven with a mouse, the sheet is typed
 * into, and nothing here is reachable from a phone in the first place.
 */
export function installColumnOrder(): void {
  const row = document.getElementById("srlayout");
  if (!row) return;

  const saved = stored();
  if (saved) apply(saved);

  for (const id of MOVABLE) {
    const section = document.getElementById(id);
    const handle = section?.querySelector("h2");
    if (!section || !handle) continue;

    handle.draggable = true;
    handle.title = "Drag onto another panel to put this one in its place";

    handle.addEventListener("dragstart", (e) => {
      carrying = id;
      e.dataTransfer?.setData(MIME, id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });

    handle.addEventListener("dragend", () => {
      carrying = null;
      for (const other of MOVABLE) {
        document.getElementById(other)?.classList.remove("dropping");
      }
    });

    section.addEventListener("dragover", (e) => {
      if (!carrying) return;
      // Cancelled even over ITSELF, and that is the point: the sheet's textarea
      // is inside this section, and a drag it is allowed to handle is a drag it
      // will try to insert.
      e.preventDefault();
      if (carrying === id) return;
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      section.classList.add("dropping");
    });

    section.addEventListener("dragleave", (e) => {
      // dragleave fires for every child crossed on the way in, so the only leave
      // that counts is the one going somewhere outside this section
      const to = e.relatedTarget as Node | null;
      if (to && section.contains(to)) return;
      section.classList.remove("dropping");
    });

    section.addEventListener("drop", (e) => {
      if (!carrying) return;
      e.preventDefault();
      const from = carrying;
      section.classList.remove("dropping");
      if (from === id) return;
      // Dropped ON this one, so it takes this one's place and this one shifts
      // along: lift it out of the running order, then put it back in front of
      // the target. With three columns that is an insertion, not a swap — the
      // third stays where it was rather than being dragged into the exchange.
      const order = current().filter((other) => other !== from);
      order.splice(order.indexOf(id), 0, from);
      apply(order);
      try {
        localStorage.setItem(KEY, JSON.stringify(order));
      } catch {
        /* not remembering is survivable — the order still holds for this tab */
      }
    });
  }
}
