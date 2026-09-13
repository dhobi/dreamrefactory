/**
 * The chimney's brickwork, drawn by the same hand as the wall's.
 *
 *   npx tsx taoot/tools/bedsitbrick.ts
 *
 * Where the plaster has come away the walls show London stocks in stretcher
 * bond, and `bedsit-paint.ts` draws them. The chimney behind the fire wants the
 * same brick — it is the same wall, with the plaster taken off a much bigger
 * piece of it — but it cannot come from the same place. A charted surface is
 * painted procedurally ONLY when there is no rip to project; with a rip the
 * frames win, and the frames have nothing to say about the inside of a chimney.
 * So the brick is baked out to a tile here and worn as a material, which is
 * carried whichever way the room is skinned.
 *
 * The tile is 3,400 units square because that is where the bond comes back
 * round: courses are 100 and the alternate ones are offset by half of a
 * 340-long brick, so the pattern repeats every 340 across and every 200 up, and
 * 3,400 is the first square that is a whole number of both — ten bricks by
 * thirty-four courses. The recess is 1,350 by 1,500, so less than half of this
 * is ever on the wall at once and the repeat is never seen.
 *
 * Seed 37 is `fireplace-wall`'s own, so these are literally the bricks that
 * wall's holes show.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePNG } from "../../../tools/png";
import { brick } from "../src/bedsit-paint";

const HERE = dirname(fileURLToPath(import.meta.url));
// a power of two, because a material is uploaded with a mirrored repeat and
// WebGL1 will not wrap a texture whose sides are not
const SIZE = 512, WORLD = 3400, SEED = 37;
/**
 * How much of the brick survives the soot.
 *
 * It has to be baked in rather than painted on. A material's tile REPLACES the
 * albedo in the shader — it does not multiply the colour the geometry carries —
 * and there is no shadowing here either: the three lamps light everything that
 * faces them, a chimney included. Clean brick in this recess would come out as
 * bright as the brick in a hole in the wall two feet away with the whole room
 * on it, which is the one thing the inside of a flue never looks like.
 */
const SOOT = 0.12;
/**
 * And how much of its colour. Soot is grey-black, not red-black: a flue's
 * bricks lose their London-stock warmth long before they lose their coursing,
 * so each is dragged this far towards its own luminance before it is dimmed.
 */
const GREY = 0.45;

const px = new Uint8Array(SIZE * SIZE * 4);
let mean = [0, 0, 0];
for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
  // v upward, so the tile stands the way the wall does
  const c = brick(((x + 0.5) / SIZE) * WORLD, ((SIZE - 0.5 - y) / SIZE) * WORLD, SEED);
  const d = (y * SIZE + x) * 4;
  const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  for (let k = 0; k < 3; k++) {
    const v = (c[k] * (1 - GREY) + lum * GREY) * SOOT;
    px[d + k] = Math.max(0, Math.min(255, Math.round(v * 255)));
    mean[k] += v;
  }
  px[d + 3] = 255;
}
mean = mean.map((v) => v / (SIZE * SIZE));
const out = join(HERE, "../../public/bedsit/brick.png");
writeFileSync(out, encodePNG(px, SIZE, SIZE, { compress: true }));
console.log(`${out}  ${SIZE}x${SIZE} over ${WORLD} units, mean [${mean.map((v) => v.toFixed(3)).join(", ")}]`);
