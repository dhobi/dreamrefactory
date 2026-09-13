/**
 * The room's drawn woods.
 *
 *   npx tsx taoot/bedsit/tools/bedsitwood.ts [chimney|desk|all]
 *
 * `MATERIALS.stain` is a 45 by 65 patch of the door in `Scene2/View64`, laid on
 * at 900 units to the repeat. That is 20 units to a frame pixel, and on a door
 * seen across a room it is fine; on a chimneypiece it is a smear, because the
 * pilasters are 300 wide and each one is fifteen pixels of somebody else's door
 * blown up to a foot across. Every blur and every block in that surround is one
 * of those pixels.
 *
 * So this draws the wood instead, the way `bedsit-paint.ts` draws the door's own
 * leaf: a long grain, a slower figure across it, pores, and the odd dark streak.
 * At 512 over 900 units it is 1.8 units to a texel — eleven times finer than the
 * patch — and it costs 100 KB and no frame at all.
 *
 * `chimney` is that board. `desk` is the same drawing with its dials turned
 * down: darker, and much less FIGURE. Figure is the slow wander across the
 * grain, and it is what reads as burl — right on a chimneypiece, which is one
 * showy board across a room, and wrong on a desk, which is a case of quiet
 * panels seen close. The desk's is a fifth of the chimney's and runs at twice
 * the wavelength, its streaks are rarer and shallower, and its ground is two
 * thirds as bright.
 *
 * The last two are not woods. Turning the grain and the pores off and the
 * figure up gives the moulded swirl of BAKELITE, which is the wireless's
 * cabinet; and a ground with a fine check over it gives the tan GRILLE cloth
 * behind its speaker. They live here because they are the same drawing, not
 * because they are timber — see each one's own note.
 *
 * WHY DARKNESS LIVES HERE AND NOT IN THE PAINT: a textured surface takes
 * `albedo = tex * uExposure` in the shader — the vertex colour is REPLACED, not
 * multiplied. So `FURNITURE_PAINT.desk` does nothing at all once the desk wears
 * a material, and the only way to darken it is to darken the board.
 *
 * ONE THING THE BOX MAP CANNOT HAVE BOTH WAYS: the grain runs up the tile, and
 * `Builder.mesh` picks a face's projection from its own normal. On the desk's
 * TOP that lands the grain along the desk's length, which is right; on a drawer
 * FRONT the same tile lands it vertically, which is not how a drawer front is
 * cut. Turning the tile fixes the fronts and spoils the top. It is left running
 * the top's way, and the desk's figure is kept low enough that neither face
 * reads as planks.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePNG } from "../../../tools/png";

const HERE = dirname(fileURLToPath(import.meta.url));
const SIZE = 512, WORLD = 900;

/**
 * A board. `ground` is the stain itself; the four amplitudes are the long
 * grain, the figure across it, the pores and the dark streaks, and `streakAt`
 * is how high a streak has to run before it darkens anything at all.
 */
interface Board {
  file: string; seed: number; ground: readonly number[];
  grain: number; figure: number; figureScale: number;
  pore: number; streakAt: number; streak: number;
  /**
   * A woven cloth's threads: a two-way check drawn in TEXELS rather than world
   * units, because it is the one thing here finer than the tile.
   *
   * Everything else on this page is drawn at `WORLD` units to the tile, which
   * is 1.8 units — a bit over a millimetre — to a texel. A grille cloth's
   * threads are about half a millimetre apart, which is under one texel and
   * would only alias. So the weave is drawn at `weavePeriod` TEXELS and the
   * tile is laid on at a scale small enough to make that come out at the right
   * size: `grille` runs at 96 units to the repeat, not 900, which puts four
   * texels at half a millimetre. 512 must stay a whole number of periods or
   * the tile will not meet itself.
   */
  weave?: number; weavePeriod?: number;
}
const BOARDS: Readonly<Record<string, Board>> = {
  /** the chimneypiece: `FURNITURE_PAINT.cupboard` is what the frames measure
   *  this wood at, carried up to where it reads as brown and not a silhouette */
  chimney: {
    file: "wood.png", seed: 91, ground: [0.235, 0.129, 0.082],
    grain: 0.20, figure: 0.13, figureScale: 1, pore: 0.07,
    streakAt: 0.55, streak: 0.34,
  },
  /**
   * The desk: the darkest wood in the room, and the quietest. It is seen from
   * a chair's distance rather than across the room, and every face of it is
   * small — a drawer front is 500 units by 310 — so the chimney's figure at
   * that size is a swirl per panel rather than a grain.
   *
   * Its ground sits just above `FURNITURE_PAINT.desk`, which is what the frames
   * measure this desk at — [0.058, 0.032, 0.018] — rather than at the brown a
   * drawn board wants to be. That is the anchor: this wood is nearly black in
   * the room, and every version of this tile that read as "a nice mahogany"
   * was too light for it. The grain is a quarter of what the chimneypiece
   * carries and the figure a thirteenth, which is about as little as a drawn
   * board can hold and still not be a flat colour. Below this there is no
   * point having a tile at all — drop the material and paint it.
   */
  desk: {
    file: "deskwood.png", seed: 137, ground: [0.072, 0.039, 0.024],
    grain: 0.055, figure: 0.010, figureScale: 2.1, pore: 0.026,
    streakAt: 0.80, streak: 0.06,
  },
  /**
   * The wireless's cabinet, and the first board here that is not a wood at all.
   *
   * The AC97 is moulded bakelite, and the same drawing makes it by turning off
   * the parts that say TIMBER and turning up the one that says CLOUD. Grain is
   * the long fine streak that runs up a sawn board — bakelite has none, and
   * what is left here (0.02) is only enough to keep the tile off being a flat
   * colour. Pores and streaks are gone outright: `streakAt` at 1 is never
   * reached, since `fbm` cannot exceed it. What carries the material is FIGURE,
   * at 0.17 and three times the wavelength — the slow marbled swirl the powder
   * leaves as it flows in the mould.
   *
   * That it comes out running UP the tile is not a coincidence to be corrected:
   * the figure's noise is stretched 1:2.4 along the tile, and the marbling on
   * the photograph runs vertically down the face and round the shoulders,
   * because that is the way the material flowed.
   *
   * The colour is the photograph's, measured rather than chosen: a 180-texel
   * patch of the face clear of the dial and the speaker means (68, 42, 38) of
   * 255, which is the ratio 1 : 0.62 : 0.56 kept here. Note the blue: this is a
   * red-brown, not the yellow-brown of the two woods above — the chimney board
   * carries a third as much blue for its red as this does, and a bakelite drawn
   * at a wood's hue reads as varnish.
   *
   * THE LEVEL IS A STUDIO'S, NOT THE ROOM'S. The photograph is a lit product
   * shot on a pale ground; the frames are a dim interior. This ground is the
   * measurement scaled to sit between the chimneypiece and the desk, which is
   * where a polished dark cabinet belongs in this room, and it is the dial to
   * turn first if the set reads too light against BEDSIT1's own frames.
   */
  bakelite: {
    file: "bakelite.png", seed: 211, ground: [0.200, 0.124, 0.112],
    grain: 0.02, figure: 0.17, figureScale: 3.0, pore: 0,
    streakAt: 1.0, streak: 0,
  },
  /**
   * The speaker cloth behind the wireless's grille: the one part of the set
   * that is not bakelite, and more than twice its brightness.
   *
   * The photograph's cloth means (153, 98, 70) against the face's (68, 42, 38)
   * — a warm tan, and the lightest thing on the whole cabinet. Drawn as a
   * near-flat ground with the weave over it; see `weave` above for why that one
   * term is measured in texels and why this board is laid on at 96 units to the
   * repeat instead of 900.
   */
  grille: {
    file: "grille.png", seed: 53, ground: [0.600, 0.384, 0.275],
    grain: 0.03, figure: 0.05, figureScale: 1.4, pore: 0,
    streakAt: 1.0, streak: 0, weave: 0.13, weavePeriod: 4,
  },
};

const WHICH = process.argv[2] ?? "all";
const boards = WHICH === "all" ? Object.keys(BOARDS) : [WHICH];
if (boards.some((b) => !BOARDS[b])) {
  console.error(`usage: npx tsx taoot/bedsit/tools/bedsitwood.ts [${Object.keys(BOARDS).join("|")}|all]`);
  process.exit(2);
}

const hash = (x: number, y: number, s: number): number => {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const noise = (x: number, y: number, s: number): number => {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s);
  const c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
};
const fbm = (x: number, y: number, s: number, oct: number): number => {
  let sum = 0, amp = 0.5, tot = 0;
  for (let i = 0; i < oct; i++) {
    sum += (noise(x, y, s + i * 7) - 0.5) * 2 * amp;
    tot += amp; x = x * 2.03 + 17.1; y = y * 1.97 + 9.3; amp *= 0.5;
  }
  return sum / tot;
};

for (const which of boards) {
  const B = BOARDS[which], SEED = B.seed;
  const px = new Uint8Array(SIZE * SIZE * 4);
  let mean = [0, 0, 0];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const u = ((x + 0.5) / SIZE) * WORLD, v = ((SIZE - 0.5 - y) / SIZE) * WORLD;
    // the grain runs up the tile: fine across it, long along it
    const grain = fbm(u / 7, v / 260, SEED, 2);
    const figure = fbm(u / (46 * B.figureScale), v / (110 * B.figureScale), SEED + 1, 2);
    const pore = noise(u / 2.2, v / 90, SEED + 2) - 0.5;
    let k = 1 + B.grain * grain + B.figure * figure + B.pore * pore;
    // the weave, in texels — see `Board.weave`
    if (B.weave) k += B.weave * Math.sin((x / B.weavePeriod!) * Math.PI) * Math.sin((y / B.weavePeriod!) * Math.PI);
    // and the dark streaks a stained wood keeps, where the grain runs open
    const streak = fbm(u / 5, v / 400, SEED + 3, 1);
    if (streak > B.streakAt) k *= 1 - B.streak * ((streak - B.streakAt) / (1 - B.streakAt));
    const d = (y * SIZE + x) * 4;
    for (let c = 0; c < 3; c++) {
      const val = B.ground[c] * k;
      px[d + c] = Math.min(255, Math.round(val * 255));
      mean[c] += val;
    }
    px[d + 3] = 255;
  }
  mean = mean.map((v) => v / (SIZE * SIZE));
  const out = join(HERE, "../../public/bedsit", B.file);
  writeFileSync(out, encodePNG(px, SIZE, SIZE, { compress: true }));
  console.log(`${out}  ${SIZE}x${SIZE} over ${WORLD} units, mean [${mean.map((v) => v.toFixed(3)).join(", ")}]`);
}
