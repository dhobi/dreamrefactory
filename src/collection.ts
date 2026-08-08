/**
 * collection/index.html's entry: the two calls every page makes
 * (src/home.ts), then the 3D box, the disc it sits beside, and — below both —
 * the printed booklet, which is src/booklet.ts's and reached from here only
 * through {@link setEdition}, since it is the third thing an edition switch
 * has to swap.
 *
 * ## The box
 *
 * Six faces of a `transform-style: preserve-3d` cube, ported from the old
 * site's `cover.js` — the CSS itself (the per-face transforms, the
 * dimensions as custom properties) lives in collection/index.html, since the
 * old script's mistake was regenerating a whole `<style>` element on every
 * resize. This module only ever touches two things: the six `<img>` sources
 * (swapped whole on an edition change, never hidden — see {@link renderFaces})
 * and `.boxInner`'s own `transform` (turned by a button, a drag, or `←`/`→`).
 *
 * Orientation is tracked as one continuous `{rx, ry}` pair rather than an
 * enum of six states, so a drag can spin the box through several full turns
 * and {@link nearestFace} still finds its way back to whichever of the six
 * faces it stopped closest to, wrapped or not.
 *
 * `theme.css` already turns off every CSS transition under
 * `prefers-reduced-motion: reduce` (its final rule, `* { transition: none
 * !important }`), so the snap-to-face tween below is silenced for free —
 * nothing here has to ask.
 *
 * ## Which edition
 *
 * The site's own edition axis (src/editions.ts), which the play page and the
 * editors carry too: the same button row, the same `?edition=`, the same stored
 * choice — pick the German box here and the game boots German, and the other way
 * round. What is this page's own is the LIST (five pressings; the Russian box was
 * never scanned) and the fact that a switch is not a reload: it re-renders the
 * faces and discs in place, and only the selected edition is ever in the DOM.
 *
 * A default is never written down, for the reason spelled out on
 * {@link setEdition}: a written-out edition outranks the reader's own language
 * the next time the page loads. So an edition nobody picked follows the site's
 * language, which is the coupling that lets the two axes stay separate without
 * reading as two chores.
 *
 * The endonyms on the buttons are read off `src/languages.ts` rather than typed
 * into the markup a second time — they are the same word the page's own language
 * menu shows for those codes.
 */
import { installLanguageMenu } from "./lang-menu";
import { installVersion } from "./version";
import { chosenEdition, installEditionPicker, markEdition, rememberEdition } from "./editions";
import { installI18n } from "./locales";
import { showBooklet } from "./booklet";
import { siteUrl } from "./site";

void installI18n();
void installLanguageMenu();
installVersion();

/** the five editions with box/disc scans — Russian shipped too, but nothing
    of its box survives (README, and the download list further down) */
type Edition = "en" | "de" | "fr" | "nl" | "ja";
const EDITIONS: readonly Edition[] = ["en", "de", "fr", "nl", "ja"];

/** the release's own name, in its own language — the game's own title, so it
    is never run through the catalogue (see src/locales/en.ts's `collection`
    doc comment for the rest of what that rule covers here) */
const RELEASE_TITLE: Record<Edition, string> = {
  en: "Titanic: Adventure out of time",
  de: "Titanic: Wettlauf gegen die Zeit",
  fr: "Titanic: Une aventure hors du temps",
  nl: "Titanic: Avontuur in de tijd",
  ja: "タイタニック: Adventure out of time",
};

/** every edition pressed at least one disc; only NL shipped on a single CD */
const HAS_CD2: Record<Edition, boolean> = { en: true, de: true, fr: true, nl: false, ja: true };

/** every box held a printed booklet; the German one is the only one the old
    site ever scanned, which is why src/booklet.ts has an answer for `null` */
const HAS_BOOKLET: Record<Edition, boolean> = { en: false, de: true, fr: false, nl: false, ja: false };

type Face = "front" | "back" | "left" | "right" | "top" | "bottom";
const FACES: readonly Face[] = ["front", "back", "left", "right", "top", "bottom"];

/** which file backs a face: EN alone keeps distinct sideleft/sideright (the
    other three reuse one side.jpg for both), and only JA's front/back are PNG */
function coverSrc(code: Edition, face: Face): string {
  const ext = code === "ja" && (face === "front" || face === "back") ? "png" : "jpg";
  const name =
    face === "left" || face === "right"
      ? code === "en" ? (face === "left" ? "sideleft" : "sideright") : "side"
      : face;
  return siteUrl(`collection/cover/${code}/${name}.${ext}`);
}

const discSrc = (code: Edition, n: 1 | 2): string =>
  siteUrl(`collection/cd/${code}/cd${n}.png`);

/** the whole-box rotation that brings each face to the front, in degrees —
    front/right/back/left form one ring around Y, top/bottom the other
    around X, which is what lets {@link nearestFace} treat all six the same */
const FACE_ROTATION: Record<Face, { rx: number; ry: number }> = {
  front: { rx: 0, ry: 0 },
  right: { rx: 0, ry: -90 },
  back: { rx: 0, ry: -180 },
  left: { rx: 0, ry: -270 },
  top: { rx: -90, ry: 0 },
  bottom: { rx: 90, ry: 0 },
};

// ---- the DOM this page already has (collection/index.html) ----

const box = document.getElementById("box") as HTMLDivElement;
const editionPicker = document.getElementById("editionPicker") as HTMLDivElement;
const discsEl = document.getElementById("discs") as HTMLDivElement;
const captionEl = document.getElementById("caption") as HTMLParagraphElement;

const boxInner = document.createElement("div");
boxInner.className = "boxInner";
box.appendChild(boxInner);

let edition: Edition = "en";
let face: Face = "front";
let rotation = { ...FACE_ROTATION.front };
let discIndex: 1 | 2 = 1;

// ---- the edition picker: the site's own control, over the five it can show ----

// The same row the play page and the editors carry (src/editions.ts), over this
// page's own list: five pressings, because the Russian box was never scanned. The
// click is not a reload here — nothing is loaded that a new `src` does not
// replace — so it passes its own handler and the module only draws and marks.
void installEditionPicker(editionPicker, {
  available: EDITIONS as readonly string[] as string[],
  current: defaultEdition(),
  onPick: (code) => setEdition(code as Edition, true),
});

// ---- the box: six faces, rebuilt (never hidden) on every edition switch ----

function renderFaces(): void {
  boxInner.replaceChildren();
  for (const f of FACES) {
    const el = document.createElement("div");
    el.className = `face ${f}`;
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "";
    img.src = coverSrc(edition, f);
    el.appendChild(img);
    boxInner.appendChild(el);
  }
}

function markFaceButtons(): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".faceButtons button")) {
    btn.classList.toggle("here", btn.dataset.face === face);
  }
}

function applyRotation(animate: boolean): void {
  boxInner.style.transition = animate ? "transform 420ms ease" : "none";
  boxInner.style.transform = `rotateX(${rotation.rx}deg) rotateY(${rotation.ry}deg)`;
}

function goToFace(f: Face, animate = true): void {
  face = f;
  rotation = { ...FACE_ROTATION[f] };
  applyRotation(animate);
  markFaceButtons();
}

document.querySelector(".faceButtons")!.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button[data-face]") as HTMLButtonElement | null;
  if (btn) goToFace(btn.dataset.face as Face);
});

// ---- turning it: pointer drag, snapping to the nearest face on release ----

/** live during a drag only — unwrapped, so several full turns before release
    still resolve to whichever face the drag actually stopped nearest to */
let dragging = false;
let last = { x: 0, y: 0 };
let live = { rx: 0, ry: 0 };

box.addEventListener("pointerdown", (e) => {
  dragging = true;
  last = { x: e.clientX, y: e.clientY };
  live = { ...rotation };
  // capture keeps a fast drag that leaves the box from stranding it mid-turn.
  // It can throw — a pointerId that is no longer active is a DOMException — and
  // `dragging` is already true by then, so an unguarded throw here would leave
  // the box turning under the mouse forever with no button held.
  try {
    box.setPointerCapture(e.pointerId);
  } catch {
    /* no capture, then: the drag still works, it just ends if you leave the box */
  }
});

box.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - last.x;
  const dy = e.clientY - last.y;
  last = { x: e.clientX, y: e.clientY };
  live = { rx: live.rx - dy * 0.5, ry: live.ry + dx * 0.5 };
  rotation = live;
  applyRotation(false);
});

function endDrag(): void {
  if (!dragging) return;
  dragging = false;
  goToFace(nearestFace(live));
}
box.addEventListener("pointerup", endDrag);
box.addEventListener("pointercancel", endDrag);
// the browser can take the capture away by itself (a gesture the OS claims, the
// pointer being removed); without this the box would keep following a pointer
// that is no longer sending us anything
box.addEventListener("lostpointercapture", endDrag);

/**
 * Which face a given orientation is actually SHOWING — asked of the rotation
 * itself, not of how far `{rx, ry}` is from the six entries in
 * {@link FACE_ROTATION}.
 *
 * The obvious version of this compares the pair `(rx, ry)` against each
 * target and takes the smallest squared difference, and it is wrong, because
 * two Euler angles are not coordinates on a sphere and the axes are not
 * independent: at `rx = -90, ry = -180` the top face is the one facing you,
 * while pair-distance scores `back` at 8100 against `top`'s 64800 and snaps
 * the box to a face nobody is looking at.
 *
 * So ask the matrix. `rotateX(rx) rotateY(ry)` has third row
 * `(-cos(rx)·sin(ry), sin(rx), cos(rx)·cos(ry))`, and the face whose outward
 * normal has the largest z-component under it is the face pointing at the
 * viewer. The normals are written in CSS's own frame, where **+Y is down** —
 * which is why `top` is `(0, -1, 0)` and not `(0, 1, 0)`, and is the same
 * reason `.face.top` is placed with `rotateX(90deg)` rather than -90.
 */
function nearestFace(r: { rx: number; ry: number }): Face {
  const rad = Math.PI / 180;
  const sx = Math.sin(r.rx * rad);
  const cx = Math.cos(r.rx * rad);
  const sy = Math.sin(r.ry * rad);
  const cy = Math.cos(r.ry * rad);

  /** how much of each face's outward normal points at the viewer */
  const towardViewer: Record<Face, number> = {
    front: cx * cy,
    back: -cx * cy,
    right: -cx * sy,
    left: cx * sy,
    top: -sx,
    bottom: sx,
  };

  return FACES.reduce((best, f) => (towardViewer[f] > towardViewer[best] ? f : best), "front" as Face);
}

// ---- the other way to turn it: ← / → step through the six faces ----

box.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  const i = FACES.indexOf(face);
  const dir = e.key === "ArrowRight" ? 1 : -1;
  goToFace(FACES[(i + dir + FACES.length) % FACES.length]);
});

// ---- the disc: flat, cd1 with a flip to cd2 where the edition has one ----

function renderDiscs(): void {
  discsEl.replaceChildren();

  const wrap = document.createElement("div");
  wrap.className = "discImg";
  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = "";
  img.src = discSrc(edition, discIndex);
  wrap.appendChild(img);
  discsEl.appendChild(wrap);

  if (!HAS_CD2[edition]) return; // NL: one disc, nothing to flip to
  const tabs = document.createElement("div");
  tabs.className = "discTabs";
  for (const n of [1, 2] as const) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = String(n);
    btn.classList.toggle("here", n === discIndex);
    btn.addEventListener("click", () => {
      discIndex = n;
      renderDiscs();
    });
    tabs.appendChild(btn);
  }
  discsEl.appendChild(tabs);
}

// ---- which edition, and carrying the choice in the URL ----

function defaultEdition(): Edition {
  return chosenEdition(EDITIONS as readonly string[] as string[]) as Edition;
}

/**
 * Show an edition — and record it only when a READER asked for it.
 *
 * The `chosen` flag is not decoration. Writing the choice down for the initial
 * default pinned it: {@link chosenEdition} prefers a written-down edition over
 * the reader's UI language, so the value this function had just invented
 * outranked their language from then on. Merely OPENING the page in German
 * therefore froze "German box" into the URL, and a reader who then switched the
 * site to English kept the German box for good.
 *
 * So a default stays unwritten and follows the language, and a click writes
 * `?edition=` and {@link EDITION_STORAGE_KEY} — which is what carries the choice
 * to the play page and the editors, the same way theirs carry it here.
 */
function setEdition(code: Edition, chosen: boolean): void {
  edition = code;
  discIndex = 1;
  renderFaces();
  renderDiscs();
  showBooklet(HAS_BOOKLET[code] ? code : null);
  markEdition(editionPicker, code);
  captionEl.textContent = RELEASE_TITLE[code];

  if (!chosen) return;
  rememberEdition(code);
}

setEdition(defaultEdition(), false);
goToFace("front", false);
