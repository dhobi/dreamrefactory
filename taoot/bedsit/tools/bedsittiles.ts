/**
 * The fireplace's slips, drawn from their measurements.
 *
 *   npx tsx taoot/tools/bedsittiles.ts
 *
 * Every other material in this room is a patch of a frame, and this one cannot
 * be. The slips are plain grey plates with near-black joints between them, and
 * two things stop a patch from carrying that. The plates are ten pixels across
 * in the frame that shows them best, so a joint is one pixel and comes back
 * soft; and a toned tile's contrast is clamped to three tenths either side of
 * its tone, which is nowhere near black on grey. What a patch CAN give is the
 * numbers, and those are what this uses:
 *
 * - **the pitch**, 264 units. `Scene3/View20` faces this wall square, and
 *   `FIREPLACE.opening` is 1,000 wide across 42.5 pixels of it — 23.5 units to
 *   a pixel — and the joints there fall every 10.4 pixels.
 * - **the joint**, about a pixel, so 24 units, which is 9% of the pitch.
 * - **the stone**, the tone `FURNITURE_PAINT.slips` was measured at.
 *
 * The joints sit on the tile's border at half width, because the page uploads a
 * material mirrored: two half joints meet at every repeat and make one whole
 * one, and the plate between them is unbroken.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePNG } from "../../../tools/png";

const HERE = dirname(fileURLToPath(import.meta.url));
const SIZE = 128;
/** the joint's share of the pitch, halved because it is split across the border */
const JOINT = Math.round((SIZE * 0.09) / 2);
/** the stone, and the joint — dark enough to read as a line at any exposure */
const STONE = [0.30, 0.30, 0.28] as const;
const MORTAR = [0.045, 0.045, 0.042] as const;

const px = new Uint8Array(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
  const edge = x < JOINT || x >= SIZE - JOINT || y < JOINT || y >= SIZE - JOINT;
  const c = edge ? MORTAR : STONE;
  const d = (y * SIZE + x) * 4;
  for (let k = 0; k < 3; k++) px[d + k] = Math.round(c[k] * 255);
  px[d + 3] = 255;
}
const out = join(HERE, "../../public/bedsit/slips.png");
writeFileSync(out, encodePNG(px, SIZE, SIZE, { compress: true }));
console.log(`${out}  ${SIZE}x${SIZE}, joint ${JOINT * 2} of ${SIZE} (${((JOINT * 2) / SIZE * 100).toFixed(0)}% of a 264-unit plate)`);
