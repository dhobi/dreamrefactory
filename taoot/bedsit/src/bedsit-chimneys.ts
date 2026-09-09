/**
 * The chimneys of London, in the pixels of the photograph behind the windows.
 *
 * Each is the MOUTH of a flue — where its plume stands — and how big and how
 * hard that plume is: `px`/`py` in the photograph's own coordinates, `x` from
 * its left edge and `y` DOWN from its top, as any image editor counts them;
 * `w`/`h` the size of the plume in the same pixels; `density` how much smoke
 * comes out, 0 for none and about 0.9 for a works chimney in full cry.
 *
 * The page turns each row into one quad standing on the backdrop, which is why
 * a row costs so little: see `lightSmoke` in
 * {@link file://./bedsit-page.ts}.
 *
 * **To change this table, do not edit it here.** Open `/bedsit/chimneys/` on the dev
 * server, which hangs the photograph on a wall and lets you click the mouths:
 * every chimney in this file is already on it, a click adds one, a drag moves
 * one, two sliders size it, and the box at the bottom is this list, ready to
 * paste back over the one below. Placing a plume by reading numbers off a
 * screenshot is what produced the several wrong ones this replaced.
 */
export interface Chimney {
  /** across the photograph, from its left edge */
  px: number;
  /** and down it, from its top edge */
  py: number;
  /** the plume: how wide it may spread, and how high it climbs */
  w: number;
  h: number;
  /** how much comes out of it: 0 is a cold grate, 0.9 a works chimney */
  density: number;
}

/**
 * How far a plume leans as it climbs, in halves of its own width. NEGATIVE is
 * the photograph's left, which is the way the smoke already painted into it is
 * blown — two winds over one city would be one too many.
 */
export const WIND = -0.7;

/** the height of a plume as a multiple of its width, when the picker makes one */
export const PLUME_RISE = 1.35;

/**
 * Placed by hand on `/bedsit/chimneys/`, which is the only way this list has ever been
 * right. What was found by rule before it put plumes over a church tower and
 * over open sky, and left flues that plainly smoke standing cold.
 */
export const CHIMNEYS: readonly Chimney[] = [
  { px: 73, py: 351, w: 80, h: 108, density: 0.5 },
  { px: 113, py: 351, w: 80, h: 108, density: 0.5 },
  { px: 140, py: 351, w: 80, h: 108, density: 0.5 },
  { px: 182, py: 281, w: 90, h: 122, density: 0.59 },
  { px: 213, py: 259, w: 90, h: 122, density: 0.67 },
  { px: 282, py: 294, w: 78, h: 105, density: 0.57 },
  { px: 330, py: 310, w: 69, h: 93, density: 0.52 },
  { px: 403, py: 354, w: 66, h: 89, density: 0.68 },
  { px: 440, py: 351, w: 105, h: 142, density: 0.71 },
  { px: 564, py: 355, w: 111, h: 150, density: 0.61 },
  { px: 587, py: 346, w: 69, h: 93, density: 0.63 },
  { px: 946, py: 343, w: 132, h: 178, density: 0.46 },
  { px: 1213, py: 352, w: 132, h: 178, density: 0.41 },
  { px: 1301, py: 341, w: 55, h: 61, density: 0.52 },
  { px: 1516, py: 389, w: 45, h: 61, density: 0.6 },
  { px: 1563, py: 367, w: 99, h: 134, density: 0.68 },
  { px: 1578, py: 384, w: 44, h: 59, density: 0.57 },
  { px: 1653, py: 331, w: 44, h: 59, density: 0.37 },
  { px: 1676, py: 330, w: 46, h: 61, density: 0.51 },
  { px: 1699, py: 330, w: 42, h: 58, density: 0.5 },
];
