/**
 * The printed booklet that came in the box — 32 scanned pages, turned two at a
 * time, ported from the old site's flipbook.
 *
 * ## Why none of turn.js came with it
 *
 * The old page did this with jQuery and `turn.js`: two libraries and ~7,000
 * lines, of which the part anybody actually saw was a page that pivots on the
 * spine. turn.js earns that size elsewhere — it folds the leaf under a dragging
 * finger, tracks the corner, shears the shadow across the fold — and none of it
 * is reachable here, because the old site never enabled the drag either. So
 * what got ported is the RESULT: a leaf that turns on a CSS transform, and a
 * click on either half of the spread to say which way. The transform is one
 * line of CSS; the physics never existed.
 *
 * ## The pages, and the arithmetic that pairs them
 *
 * A scan per page, named the way the printer numbered them: `front.jpg` is page
 * 1, `back.jpg` is page {@link PAGE_COUNT}, and every page between is its own
 * number. That is not a filename convention this module invented — it is what
 * the old site's `manualDE` array listed, kept so the scans and the numbers a
 * reader sees are the same set of names.
 *
 * A booklet is read in SPREADS, not pages, and the two covers are each seen
 * alone: view 0 is the front cover with the left half empty, views 1…15 are the
 * fifteen interior spreads, and view 16 is the back cover with the right half
 * empty. Which is exactly `left = 2v`, `right = 2v + 1`, with the two ends
 * dropping the half that would run off the booklet — see {@link leftPage}. The
 * identity holds because 32 is even; an odd booklet would need a blank, and
 * this one has none.
 *
 * ## Turning it
 *
 * {@link go} draws the spread the turn is heading FOR and lays the turning leaf
 * on top of it, so what the leaf sweeps away from is already the destination —
 * no second repaint when it lands, and nothing to hide behind it. The leaf is
 * two backface-hidden faces: the page you are leaving, and the page that was
 * printed on the other side of it.
 *
 * The landing is timed off {@link TURN_MS} rather than `transitionend`, and the
 * reason is a rule in src/theme.css: under `prefers-reduced-motion: reduce` it
 * turns off every transition on the page with `* { transition: none
 * !important }`. A `transitionend` that never fires would strand the leaf mid-
 * air with the booklet stuck behind it, so nothing here waits for one — and a
 * reader who asked for less motion gets {@link go}'s straight swap instead of a
 * turn that has been silently reduced to a jump.
 */

import { siteUrl } from "./site";

/** how many pages were scanned — the same 32 the old site's `manualDE` listed */
const PAGE_COUNT = 32;

/** the back cover's view; also the count of spreads between the two covers */
const LAST_VIEW = PAGE_COUNT / 2;

/** kept in step with `.turning`'s transition in collection/index.html */
const TURN_MS = 460;

/** page 1 and page 32 are the covers, and were scanned under those names */
function pageSrc(edition: string, n: number): string {
  const name = n === 1 ? "front" : n === PAGE_COUNT ? "back" : String(n);
  return siteUrl(`collection/manual/${edition}/${name}.jpg`);
}

/** the left half of a spread — nothing at all on the closed front cover */
const leftPage = (view: number): number | null => (view === 0 ? null : 2 * view);

/** the right half — nothing at all once the back cover is the page in hand */
const rightPage = (view: number): number | null => (view === LAST_VIEW ? null : 2 * view + 1);

const reduceMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** what a reader is holding: `1 / 32`, `2–3 / 32`, `32 / 32`. Digits and an en
    dash, so there is nothing here for a catalogue to translate (the disc tabs
    next to it are numbered on the same reasoning) */
function readout(view: number): string {
  const l = leftPage(view);
  const r = rightPage(view);
  return `${l !== null && r !== null ? `${l}–${r}` : (l ?? r)} / ${PAGE_COUNT}`;
}

// ---- the DOM this page already has (collection/index.html) ----

const book = document.getElementById("book") as HTMLDivElement;
const controls = document.getElementById("bookControls") as HTMLDivElement;
const countEl = document.getElementById("bookCount") as HTMLSpanElement;
const noneEl = document.getElementById("bookletNone") as HTMLParagraphElement;
const prevBtn = document.getElementById("bookPrev") as HTMLButtonElement;
const nextBtn = document.getElementById("bookNext") as HTMLButtonElement;

/** the two halves, built once and only ever re-`src`ed: a fresh `<img>` per
    turn would flash even on a cached page while the new one decodes */
function halfSlot(side: "left" | "right"): HTMLImageElement {
  const leaf = document.createElement("div");
  leaf.className = `leaf ${side}`;
  const img = document.createElement("img");
  img.alt = "";
  leaf.appendChild(img);
  book.appendChild(leaf);
  return img;
}
const leftImg = halfSlot("left");
const rightImg = halfSlot("right");

/** null until an edition with a scanned booklet is picked — every entry point
    below is a no-op while it is, so nothing has to guard the buttons twice */
let edition: string | null = null;
let view = 0;

// ---- drawing a spread ----

function paint(img: HTMLImageElement, page: number | null): void {
  const leaf = img.parentElement!;
  leaf.classList.toggle("blank", page === null);
  if (page === null) img.removeAttribute("src");
  else img.src = pageSrc(edition!, page);
}

/** both halves at once — during a turn these two are NOT the same view, which
    is the whole trick in {@link go} */
function paintSpread(l: number | null, r: number | null): void {
  paint(leftImg, l);
  paint(rightImg, r);
}

/** the neighbours, so a turn never opens onto a page still arriving over the
    wire. The browser cache is the store; this only asks for them early */
function preload(v: number): void {
  if (!edition || v < 0 || v > LAST_VIEW) return;
  for (const page of [leftPage(v), rightPage(v)]) {
    if (page !== null) new Image().src = pageSrc(edition, page);
  }
}

function render(): void {
  if (!edition) return;
  paintSpread(leftPage(view), rightPage(view));
  countEl.textContent = readout(view);
  prevBtn.disabled = view === 0;
  nextBtn.disabled = view === LAST_VIEW;
  preload(view + 1);
  preload(view - 1);
}

// ---- turning a page ----

/** the leaf in the air, and the tidy-up it owes: see {@link land} */
let inFlight: { land: () => void; timer: number } | null = null;

/** put a turning leaf down NOW — on its own timer, or early because a second
    click arrived and the booklet has to be settled before it can turn again */
function land(): void {
  if (!inFlight) return;
  const { land: finish, timer } = inFlight;
  inFlight = null;
  clearTimeout(timer);
  finish();
}

function face(cls: "a" | "b", page: number): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `side ${cls}`;
  const img = document.createElement("img");
  img.alt = "";
  img.src = pageSrc(edition!, page);
  el.appendChild(img);
  return el;
}

function go(dir: 1 | -1): void {
  land();
  if (!edition) return;
  const from = view;
  const next = from + dir;
  if (next < 0 || next > LAST_VIEW) return;

  view = next;
  if (reduceMotion()) {
    render();
    return;
  }

  // Underneath the turn: the half that stays put, and the half being uncovered
  // — which is already the destination's, so landing changes nothing on screen.
  const forward = dir === 1;
  paintSpread(leftPage(forward ? from : next), rightPage(forward ? next : from));

  // The leaf's two sides are one sheet of paper: the page being left behind,
  // and whatever was printed on its reverse. Both are non-null by construction
  // — the bounds check above means there is a spread on either side of this.
  const leaf = document.createElement("div");
  leaf.className = `turning ${forward ? "fwd" : "back"}`;
  const leaving = (forward ? rightPage(from) : leftPage(from))!;
  const reverse = (forward ? leftPage(next) : rightPage(next))!;
  leaf.append(face("a", leaving), face("b", reverse));
  book.appendChild(leaf);

  // the transition only runs if the browser has laid the leaf out flat first;
  // reading a geometry property is what forces that to have happened
  void leaf.offsetWidth;
  leaf.style.transform = `rotateY(${dir * -180}deg)`;

  countEl.textContent = readout(view);
  prevBtn.disabled = view === 0;
  nextBtn.disabled = view === LAST_VIEW;
  preload(view + dir);
  inFlight = {
    land: () => {
      leaf.remove();
      render();
    },
    timer: window.setTimeout(land, TURN_MS),
  };
}

// ---- the three ways to ask for a page ----

// Anywhere on the spread: the half you click is the direction you meant, which
// is how a booklet on a table works and costs no chrome to say.
book.addEventListener("click", (e) => {
  const box = book.getBoundingClientRect();
  go(e.clientX - box.left < box.width / 2 ? -1 : 1);
});

prevBtn.addEventListener("click", () => go(-1));
nextBtn.addEventListener("click", () => go(1));

// ← / → step through it, the same keys the box beside it turns on
book.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  go(e.key === "ArrowRight" ? 1 : -1);
});

/**
 * Mount the booklet for an edition, or say there isn't one.
 *
 * Only the German box was ever scanned, so four of the five editions on this
 * page reach here with `null`. That is shown rather than hidden — an edition
 * whose booklet is missing is still an answer to the question the picker just
 * asked, the same way the Russian pressing's download stands there with no box
 * to go with it.
 */
export function showBooklet(code: string | null): void {
  land();
  edition = code;
  view = 0;
  book.hidden = code === null;
  controls.hidden = code === null;
  noneEl.hidden = code !== null;
  render();
}
