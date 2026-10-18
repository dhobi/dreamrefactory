/**
 * Where to click to hit a named thing.
 *
 * ONE definition, used by both drivers. The headless one calls these functions
 * directly; the browser one ships their SOURCE into the page ({@link aimSource})
 * and calls them there, because the loop below is tens of thousands of hit tests
 * and cannot be run one round trip at a time. Nothing here may reference anything
 * outside this module, and what it references inside it, `aimSource` must carry
 * along — shipping `aimAtThing` alone makes the page throw on the sibling it
 * calls.
 *
 * That matters more than it sounds. These functions decide not just where a
 * click lands but WHETHER a thing is reachable from where you are standing —
 * `hunt` walks on to the next standpoint when the answer is null. Two drivers
 * sweeping on different grids therefore explore a room differently and end up
 * facing different ways, which is precisely the kind of difference that looks
 * like a browser bug and isn't. (It was: a finer sweep found the watch one
 * standpoint earlier than a coarser one.)
 *
 * The rule the sweep exists to keep: only ever aim at a point the engine's own
 * hit test resolves to the thing. An actor stands in front of a view's hotspots
 * in the click order, so the middle of a doorway can belong to whoever is
 * loitering in it — and a click there is a conversation, not a door.
 *
 * ## How big the screen is, is the GAME's fact
 *
 * A full-screen sweep of `y < 384, x < 512` would be Titanic's screen written
 * into the layer that aims at any DreamFactory game. Two of the
 * three ports on this site are that size — Dust presents 512x384 through a
 * 1024x768 canvas — and the third is not: Timelapse is 640x480 and says so
 * (`ScreenPresenter`), so a sweep with Titanic's numbers in it would have
 * searched five eighths of its screen and called the rest unreachable.
 *
 * So the bounds come off the adapter ({@link Aim.width}, {@link Aim.height}),
 * which every caller answers from `host.screen` — the presenter that owns the
 * framebuffer the hit test is asked about. That is the one authority: a CANVAS
 * may be any multiple of it (Dust's is 2x), and a point is aimed in framebuffer
 * pixels because that is what `hitTestAt` takes.
 */

/** the engine questions aiming needs, however the caller can answer them */
export interface Aim {
  /** the engine's hittest(): what a screen point resolves to, click order */
  hitTest(x: number, y: number): { name: string; type: string };
  /**
   * The prop under a point per the CLICK path's own test (opaque mask, camera,
   * occlusion), or null. Screen-space band props and the item in your hand live
   * here. hittest() names these too now (it asks the same function), so this is
   * the same answer by a shorter route — kept because it needs no type match.
   */
  propUnder(x: number, y: number): string | null;
  /** an overlay flat is covering the room, so there is no room to aim into */
  inFlat: boolean;
  /**
   * Where a thing by this name could be hit right now, when that is known
   * (#509): a list of rectangles to search instead of the screen — empty for
   * nowhere — or null for "could be anywhere", which sweeps it all.
   *
   * A whole-screen sweep is twelve thousand hit tests, about 50 ms, and a verb
   * that waits for something to REAPPEAR asks every pass — `hammer(startfence)`
   * through a fencing bout swept 743 times, 39 s of CPU, more than each pass
   * lasts. A flat's button can only be hit inside its own rectangle.
   */
  where?(name: string): { x0: number; y0: number; x1: number; y1: number }[] | null;
  /**
   * Where the things called `name` are drawn (Session.thingBoxes), for the fine
   * sweep a small sprite needs. Absent, there is no fine sweep.
   */
  boxes?(name: string): { x0: number; y0: number; x1: number; y1: number }[];
  /** the named hotspot's rectangle in the current view, or null */
  hotspot(name: string): { x0: number; y0: number; x1: number; y1: number } | null;
  /**
   * The framebuffer pixel a click aimed at (x, y) arrives at, when the driver
   * sends clicks through a scaled canvas; absent, every pixel reaches itself.
   * See {@link sweep}.
   */
  reach?(x: number, y: number): { x: number; y: number };
  /** the game's framebuffer width — `host.screen.width`, never the canvas's */
  width: number;
  /** and its height. See the note above on whose fact this is */
  height: number;
}

/** the sweep grid — fine enough for a small prop, coarse enough to be quick */
export const AIM_STEP = 4;

/** the hit test names `want` at (x, y) as a thing a click can reach (or, with `props`, the click path's prop) */
export function thingAt(a: Aim, want: string, x: number, y: number, props = false): boolean {
  const hit = a.hitTest(x, y);
  if (hit.name?.toLowerCase() === want && ["actor", "prop", "button", "painting"].includes(hit.type)) return true;
  return props && a.propUnder(x, y)?.toLowerCase() === want;
}

/** the hit test names the view hotspot `want` at (x, y) */
export function spotAt(a: Aim, want: string, x: number, y: number): boolean {
  const hit = a.hitTest(x, y);
  // a view hotspot is a "painting" to the engine's own hit test — "scene" is
  // its answer for the room BEHIND the hotspots, and carries the scene's name
  return hit.type === "painting" && hit.name?.toLowerCase() === want;
}

/**
 * The first point of a sweep whose click REACHES the thing, or null — the sweep
 * given as rectangles walked on a grid.
 *
 * Reaches, and not merely "hits": a click is sent as a CLIENT pixel and the
 * page floors it back (`canvasPoint`). On a canvas drawn smaller than 1:1 — a
 * phone shows 640x480 at about 375 px across — some framebuffer pixels have no
 * client pixel of their own, and a click aimed at one arrives at the pixel
 * beside it ({@link Aim.reach}). The sweep meets a thing at its top-left edge
 * first, so that neighbour is usually outside it. On phone Chrome and Safari the
 * c73 pocket watch, a 6x3 sprite, was clicked beside and never picked up, and
 * the deck map then refused every jump ("Jumping to red areas disabled").
 */
export function sweep(
  hits: (x: number, y: number) => boolean,
  rects: { x0: number; y0: number; x1: number; y1: number }[],
  step: number,
  reach?: (x: number, y: number) => { x: number; y: number },
): { x: number; y: number } | null {
  for (const r of rects) {
    for (let y = r.y0; y <= r.y1; y += step) {
      for (let x = r.x0; x <= r.x1; x += step) {
        const to = reach ? reach(x, y) : { x, y };
        if (hits(to.x, to.y)) return { x, y };
      }
    }
  }
  return null;
}

/** a point inside the named hotspot that the hit test agrees IS that hotspot */
export function aimAtHotspot(a: Aim, name: string): { x: number; y: number } | null {
  const want = name.toLowerCase();
  const r = a.hotspot(want);
  if (!r) return null;
  return sweep((x, y) => spotAt(a, want, x, y), [r], AIM_STEP, a.reach);
}

/**
 * A point that clicks the thing called `name`, whatever kind of thing it is: a
 * view hotspot, a character, an object lying in the room, a band prop, or a
 * flat's named region. Null means "not clickable from here", which is an answer,
 * not a failure.
 */
export function aimAtThing(a: Aim, name: string): { x: number; y: number } | null {
  const want = name.toLowerCase();
  // a hotspot is a rectangle in the view table, so look there first
  if (!a.inFlat) {
    const spot = aimAtHotspot(a, want);
    if (spot) return spot;
  }
  const only = a.where?.(want) ?? null;
  if (only) return sweep((x, y) => thingAt(a, want, x, y), only, AIM_STEP, a.reach);
  const screen = { x0: 2, y0: 2, x1: a.width - 1, y1: a.height - 1 };
  const seen = sweep((x, y) => thingAt(a, want, x, y, !a.inFlat), [screen], AIM_STEP, a.reach);
  if (seen) return seen;
  // A world sprite far off is drawn the way the engines size it, truncating, so
  // Titanic's pocket watch on the c73 table comes out 6x3 and the grid above
  // steps over it. Every pixel of where it is drawn, then: only on a miss, and
  // only inside the thing's own box, so a wait for something absent stays cheap.
  const boxes = (a.boxes?.(want) ?? []).map((r) => ({
    x0: Math.max(0, r.x0),
    y0: Math.max(0, r.y0),
    x1: Math.min(a.width - 1, r.x1),
    y1: Math.min(a.height - 1, r.y1),
  }));
  return sweep((x, y) => thingAt(a, want, x, y), boxes, 1, a.reach);
}

/**
 * These functions as source, for a driver that has to run them somewhere else
 * (taoot/tests/browser/driver.ts injects this into the page). Assembled from the real
 * definitions and the real constant, so there is nothing to keep in step by hand:
 * evaluate this, then call `aimAtThing(adapter, name)` or `aimAtHotspot(...)`.
 */
/**
 * {@link Aim.where} for Titanic's engine, asked of a live session: over a
 * DreamFactory 4 flat with the room away, a hit is one of the flat's buttons or
 * a prop drawn over it (ScreenDirector's `hitTestAt`). A name no drawn prop
 * carries can then only be a button, inside its own rectangle — or nowhere.
 * Anywhere else anything may answer, and it says so with null.
 *
 * Self-contained, because the Playwright driver ships it into the page as
 * source ({@link aimSource}) and it may close over nothing.
 */
export function flatWhere(s: any, n: string): { x0: number; y0: number; x1: number; y1: number }[] | null {
  if (s.viewShowing || !s.stageScript || s.isV5 || s.isV1) return null;
  // No named inner function: the source of this one is shipped into a page,
  // and a bundler's `__name` wrapper around one is a helper the page has not got.
  //
  // The props the hit test asks — the ones drawn — not every prop loaded: the
  // fencing bout's start button is a prop too, hidden while it is not offered.
  for (const p of s.propRuntime.drawn()) {
    if ((p.name ?? "").toLowerCase() === n || (p.group?.name ?? "").toLowerCase() === n) return null;
  }
  return s.stageCtrl
    .currentFlatRegions()
    .filter((r: { name: string }) => (r.name ?? "").toLowerCase() === n)
    .map((r: { left: number; top: number; right: number; bottom: number }) => ({
      x0: r.left,
      y0: r.top,
      x1: r.right,
      y1: r.bottom,
    }));
}

export function aimSource(): string {
  return (
    `const AIM_STEP = ${AIM_STEP};\n` +
    `const thingAt = ${thingAt.toString()};\n` +
    `const spotAt = ${spotAt.toString()};\n` +
    `const sweep = ${sweep.toString()};\n` +
    `const flatWhere = ${flatWhere.toString()};\n` +
    `const aimAtHotspot = ${aimAtHotspot.toString()};\n` +
    `const aimAtThing = ${aimAtThing.toString()};\n`
  );
}
