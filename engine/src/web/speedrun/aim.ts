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
  /** the named hotspot's rectangle in the current view, or null */
  hotspot(name: string): { x0: number; y0: number; x1: number; y1: number } | null;
  /** the game's framebuffer width — `host.screen.width`, never the canvas's */
  width: number;
  /** and its height. See the note above on whose fact this is */
  height: number;
}

/** the sweep grid — fine enough for a small prop, coarse enough to be quick */
export const AIM_STEP = 4;

/** a point inside the named hotspot that the hit test agrees IS that hotspot */
export function aimAtHotspot(a: Aim, name: string): { x: number; y: number } | null {
  const want = name.toLowerCase();
  const r = a.hotspot(want);
  if (!r) return null;
  for (let y = r.y0; y <= r.y1; y += AIM_STEP) {
    for (let x = r.x0; x <= r.x1; x += AIM_STEP) {
      const hit = a.hitTest(x, y);
      // a view hotspot is a "painting" to the engine's own hit test — "scene" is
      // its answer for the room BEHIND the hotspots, and carries the scene's name
      if (hit.type === "painting" && hit.name?.toLowerCase() === want) return { x, y };
    }
  }
  return null;
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
  const kinds = new Set(["actor", "prop", "button", "painting"]);
  const only = a.where?.(want) ?? null;
  if (only) {
    for (const r of only) {
      for (let y = r.y0; y <= r.y1; y += AIM_STEP) {
        for (let x = r.x0; x <= r.x1; x += AIM_STEP) {
          const hit = a.hitTest(x, y);
          if (hit.name?.toLowerCase() === want && kinds.has(hit.type)) return { x, y };
        }
      }
    }
    return null;
  }
  for (let y = 2; y < a.height; y += AIM_STEP) {
    for (let x = 2; x < a.width; x += AIM_STEP) {
      const hit = a.hitTest(x, y);
      if (hit.name?.toLowerCase() === want && kinds.has(hit.type)) return { x, y };
      if (!a.inFlat && a.propUnder(x, y)?.toLowerCase() === want) return { x, y };
    }
  }
  return null;
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
    `const flatWhere = ${flatWhere.toString()};\n` +
    `const aimAtHotspot = ${aimAtHotspot.toString()};\n` +
    `const aimAtThing = ${aimAtThing.toString()};\n`
  );
}
