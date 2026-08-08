/**
 * Where to click to hit a named thing.
 *
 * ONE definition, used by both drivers. The headless one calls these functions
 * directly; the browser one ships their SOURCE into the page ({@link aimSource})
 * and calls them there, because the loop below is tens of thousands of hit tests
 * and cannot be run one round trip at a time. Nothing here may reference anything
 * outside this module, and what it references inside it, `aimSource` must carry
 * along — the first version shipped `aimAtThing` alone and the page threw on the
 * sibling it calls.
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
  /** the named hotspot's rectangle in the current view, or null */
  hotspot(name: string): { x0: number; y0: number; x1: number; y1: number } | null;
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
  const kinds = ["actor", "prop", "button", "painting"];
  for (let y = 2; y < 384; y += AIM_STEP) {
    for (let x = 2; x < 512; x += AIM_STEP) {
      const hit = a.hitTest(x, y);
      if (hit.name?.toLowerCase() === want && kinds.includes(hit.type)) return { x, y };
      if (!a.inFlat && a.propUnder(x, y)?.toLowerCase() === want) return { x, y };
    }
  }
  return null;
}

/**
 * These functions as source, for a driver that has to run them somewhere else
 * (tests/browser/driver.ts injects this into the page). Assembled from the real
 * definitions and the real constant, so there is nothing to keep in step by hand:
 * evaluate this, then call `aimAtThing(adapter, name)` or `aimAtHotspot(...)`.
 */
export function aimSource(): string {
  return (
    `const AIM_STEP = ${AIM_STEP};\n` +
    `const aimAtHotspot = ${aimAtHotspot.toString()};\n` +
    `const aimAtThing = ${aimAtThing.toString()};\n`
  );
}
