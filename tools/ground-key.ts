/**
 * Keying a title card's flat, light ground out of artwork that arrived with no
 * alpha channel: the flood the RedJack and Jump Raven cards are cut out with,
 * and the front door's copies of them (site/tools/mklogo.ts).
 *
 * Shared in tools/ rather than kept in one game's logo script, because a shared
 * package's tool reaching into a game is the dependency the layering rule
 * forbids (site/tests/layering.ts). tools/keylogo.ts is the other key, for
 * artwork rendered on black.
 *
 * The ground is found the way an eye finds it: a flood from the border through
 * pixels that are near-white and colourless ({@link isGround}). RedJack's
 * parchment, wood and red letters never are; its torn parchment edge is light,
 * but it is TAN, and the fill stops at the first pixel with any warmth in it.
 * The edge the flood stops at is a blend of artwork and ground, so the pixels
 * touching the ground get an alpha from how far they have left the ground's
 * brightness, and their colour has the ground taken back out of it; otherwise
 * the cut-out wears a pale rim on a page's dark.
 */

/** the checkerboard's two squares average to this */
const GROUND = 246;

/** colourless and near-white: a square of the checkerboard, or a blend of two */
export const isGround = (r: number, g: number, b: number): boolean =>
  Math.max(r, g, b) - Math.min(r, g, b) <= 8 && Math.min(r, g, b) >= 224;

/**
 * One square of the checkerboard exactly — colourless and at one of its two
 * levels — which is narrower than {@link isGround}: a highlight on metal is
 * near-white too, but it is never both levels side by side.
 */
const isSquare = (r: number, g: number, b: number): boolean => {
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  return hi - lo <= 3 && (lo >= 250 || (lo >= 237 && hi <= 244));
};

/**
 * The checkerboard left inside a closed shape — the hole in an O, the gap a
 * letter's serif closes off — which a flood from the border cannot reach. A
 * patch of {@link isSquare} pixels is one of those when it is big enough to be
 * squares and holds both of their levels, each a quarter of it at least; a
 * chrome letter's specular spots are near-white but all one level.
 */
function enclosedSquares(rgba: Uint8Array, w: number, h: number): number[] {
  const seen = new Uint8Array(w * h);
  const square = (p: number): boolean => isSquare(rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]);
  const seeds: number[] = [];
  for (let p = 0; p < w * h; p++) {
    if (seen[p] || !square(p)) continue;
    const patch = [p];
    seen[p] = 1;
    let light = 0;
    for (let k = 0; k < patch.length; k++) {
      const q = patch[k];
      if (rgba[q * 4] >= 250) light++;
      const x = q % w;
      for (const r of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w]) {
        if (r >= 0 && r < w * h && !seen[r] && square(r)) (seen[r] = 1), patch.push(r);
      }
    }
    const share = light / patch.length;
    if (patch.length >= 250 && share >= 0.25 && share <= 0.75) for (const q of patch) seeds.push(q);
  }
  return seeds;
}

/**
 * Artwork with a transparency checkerboard painted into it keyed out: a flood
 * from the border through the ground, the closed shapes' squares too with
 * `holes`, and the rim the flood stops at given an alpha and its ground taken
 * back out. RedJack's card is keyed this way.
 */
export function keyCheckerboard(
  rgba: Uint8Array,
  w: number,
  h: number,
  opts: { holes?: boolean; seeds?: readonly number[] } = {},
): void {
  const ground = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (p: number): void => {
    if (ground[p]) return;
    const i = p * 4;
    if (!isGround(rgba[i], rgba[i + 1], rgba[i + 2])) return;
    ground[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < w; x++) (push(x), push((h - 1) * w + x));
  for (let y = 0; y < h; y++) (push(y * w), push(y * w + w - 1));
  if (opts.holes) for (const p of enclosedSquares(rgba, w, h)) push(p);
  // ground a caller found shut in some other way ({@link keyWhiteGround})
  for (const p of opts.seeds ?? []) push(p);
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * (h - 1)) push(p + w);
  }
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (ground[p]) {
      rgba[i + 3] = 0;
      continue;
    }
    // the rim: a pixel with ground beside it is part square
    const x = p % w;
    const rim =
      (x > 0 && ground[p - 1]) || (x < w - 1 && ground[p + 1]) ||
      (p >= w && ground[p - w]) || (p < w * (h - 1) && ground[p + w]);
    if (!rim) continue;
    const lo = Math.min(rgba[i], rgba[i + 1], rgba[i + 2]);
    // the parchment's blue channel sits near 120; a pixel that far from the
    // ground is all artwork, one at the ground's own level is none
    const a = Math.max(0, Math.min(1, (GROUND - lo) / 110));
    if (a < 1 / 255) {
      rgba[i + 3] = 0;
      continue;
    }
    for (let k = 0; k < 3; k++) {
      rgba[i + k] = Math.max(0, Math.min(255, Math.round((rgba[i + k] - (1 - a) * GROUND) / a)));
    }
    rgba[i + 3] = Math.round(a * 255);
  }
}

/**
 * The ground a flood from the border does not reach: a patch of ground pixels,
 * not touching the border, of at least {@link SHUT_IN_SIZE} pixels and nearly
 * all pure white. The chrome's and the wings' highlights are near-white too,
 * but they are small and mostly a shade under white (under 85% at 250 or more,
 * where the one real patch is 93%).
 */
const SHUT_IN_SIZE = 1000;
const SHUT_IN_WHITE = 0.85;
function shutIn(rgba: Uint8Array, w: number, h: number): number[] {
  const seen = new Uint8Array(w * h);
  const ground = (p: number): boolean => isGround(rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]);
  const seeds: number[] = [];
  for (let p = 0; p < w * h; p++) {
    if (seen[p] || !ground(p)) continue;
    const patch = [p];
    seen[p] = 1;
    let white = 0;
    let border = false;
    for (let k = 0; k < patch.length; k++) {
      const q = patch[k];
      const x = q % w;
      if (x === 0 || x === w - 1 || q < w || q >= w * (h - 1)) border = true;
      if (Math.min(rgba[q * 4], rgba[q * 4 + 1], rgba[q * 4 + 2]) >= 250) white++;
      for (const r of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w]) {
        if (r >= 0 && r < w * h && !seen[r] && ground(r)) (seen[r] = 1), patch.push(r);
      }
    }
    if (!border && patch.length >= SHUT_IN_SIZE && white / patch.length >= SHUT_IN_WHITE) seeds.push(p);
  }
  return seeds;
}

/**
 * Artwork on a plain white ground keyed out, all of it: the flood of
 * {@link keyCheckerboard} seeded as well with the white patches it cannot reach
 * from the border ({@link shutIn}). Jump Raven's card is keyed this way.
 */
export function keyWhiteGround(rgba: Uint8Array, w: number, h: number): void {
  keyCheckerboard(rgba, w, h, { seeds: shutIn(rgba, w, h) });
}
