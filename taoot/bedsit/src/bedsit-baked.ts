/**
 * WRITTEN BY {@link file://../tools/bedsitbake.ts} — do not edit by hand.
 *
 * The charts that arrive as files instead of being painted at load, and the
 * name each is under. The name carries a hash of its own pixels, so a rebake
 * that changes a texel changes the URL and no cache anywhere can serve the old
 * one. Anything NOT named here is still painted in the browser; the rug is the
 * one that stays that way on purpose, and the tool says why.
 *
 * If a file listed here fails to arrive, {@link file://./bedsit-page.ts} paints
 * that chart instead — this is a saving, not a dependency.
 */
import type { SurfaceId } from "./bedsit-room";

export const BAKED: Readonly<Partial<Record<SurfaceId, string>>> = {
  "window-wall": "bedsit/window-wall.5f331af2.webp",
  "counter-wall": "bedsit/counter-wall.f73dff43.webp",
  "fireplace-wall": "bedsit/fireplace-wall.3ef6c068.webp",
  "door-wall": "bedsit/door-wall.2d3e5204.webp",
  "ceiling": "bedsit/ceiling.f84cd390.webp",
  "floor": "bedsit/floor.51a4848d.webp",
};

/** the charts above, as a list, for the painter's `skip` */
export const BAKED_IDS = Object.keys(BAKED) as SurfaceId[];
