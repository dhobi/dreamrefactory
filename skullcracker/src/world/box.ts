/**
 * Boxes in world pixels — a cel's body or strike rect off its anchor, a room, a
 * trigger — and the one overlap test the collision pass makes of two of them.
 */
import type { SbkCelBox } from "@dreamfactory/engine/df/sbk";

/** a box in world pixels */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Do two boxes overlap? STRICTLY: two that only share an edge do not, which is
 * how every hit, strike and trigger test in the game reads it.
 */
export function overlaps(a: Box, b: Box): boolean {
  return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
}

/** a cel's rect (`x0..x1`, `y0..y1` off its anchor) with the anchor at (x, y) */
export function celBoxAt(x: number, y: number, r: SbkCelBox): Box {
  return { left: x + r.x0, right: x + r.x1, top: y + r.y0, bottom: y + r.y1 };
}
