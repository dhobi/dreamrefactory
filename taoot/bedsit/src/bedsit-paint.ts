/**
 * The bedsit painted — what the room is made of, with nothing in it.
 *
 * {@link file://./bedsit-skin.ts} paints the model with the game's own frames,
 * and it is honest about what that gives: every wall carries a ghost of whatever
 * stood against it, and the one clean swatch it can cut is a square of plaster
 * with no dado, no skirting and none of the damage that makes this a garret in
 * the Blitz rather than a box. This module is the other answer. It writes the
 * **materials** down as functions of a point on the wall, the way a scenic
 * painter would brief them, and rasterizes those into textures the shader lights
 * with the room's own three lamps.
 *
 * Nothing here needs the rip. The room the frames were rendered from is:
 *
 * - **Walls**: rough lime plaster, whitewashed, over a dark-stained dado to
 *   0.9 m — flat boards, nearly black in the frames — with a rail on top, painted
 *   a dark brown, which reads as a line the length of every wall
 *   (`Scene2/View12` shows it behind the sofa), and a skirting under. The
 *   whitewash is thinner in the hollows, so the mottle is grey as well
 *   as dark. Where the plaster has come away the brick shows — London stocks in
 *   stretcher bond — with a bright ragged lip of fresh break round the hole and a
 *   shadow under its top edge. Holes and nothing else: there were hairline
 *   cracks running from the ceiling and the door head, and the frames have none
 *   — that was invention. The damage sits where the frames have it; see
 *   {@link DAMAGE}.
 * - **Ceiling**: the same plaster a shade greyer, blotched at a larger scale, and
 *   sooted a little around the pendant.
 * - **Door**: a four-panel Victorian door, dark stain over softwood, taller panels
 *   above the lock rail than below, and a brass knob on the room side.
 * - **Floor**: softwood boards a hand and a half wide, run the length of the room
 *   (along `y`, from the fireplace to the door), butt-jointed where they meet,
 *   every board a shade of its own and the lot gone grey with years of feet. And
 *   the rag rug in the middle of them, which is flat enough to be floor: its far
 *   edge and its two sides are back-projected out of `Scene2/View15`, the one
 *   frame that sees them square-on.
 *
 * - **Street**: what the windows look out on, painted on the backdrop plane
 *   behind them. The frames show it — Bayswater in 1942: a white stucco terrace,
 *   two red-brick houses hung with bunting, a tall pale mansion block, a spire on
 *   the skyline behind, plane trees, and a barrage balloon — but through 75
 *   pixels of window, and no reading of those pixels makes a street. This is that
 *   street drawn, from a plan traced off the frames ({@link STREET}). It is also
 *   only the fallback: the page lays a photograph over it when it can
 *   (`bedsit-page.ts`, `STREET_PHOTO`), and the frames' own pixels are still
 *   there in the projected skin for anyone who wants to compare.
 *
 * The posters, the cupboard, the fireplace and the pictures are not walls, and
 * come later as things standing in front of these.
 *
 * Every texture is a chart-space raster (row 0 is the chart's `v0`, the floor
 * end) at a power-of-two size, so it can carry mipmaps: at 8-odd world units a
 * texel this is finer than the frames, and a wall seen from across the room would
 * otherwise sparkle.
 */
import { CHARTS, Chart, DOOR, PENDANT, RUG, SurfaceId } from "./bedsit-room";

export interface Painted {
  id: SurfaceId;
  width: number;
  height: number;
  /** albedo, row 0 at the chart's `v0` — no flip on upload */
  rgba: Uint8Array;
}

type RGB = [number, number, number];

// ---------------------------------------------------------------------------
// noise — deterministic, so the room is the same room every visit
// ---------------------------------------------------------------------------

/** a lattice point's own number in [0, 1): the same for the same point, always */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** value noise in [0, 1] */
function noise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const tx = smooth(x - xi), ty = smooth(y - yi);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** a few octaves of {@link noise}, centred on zero, roughly in [-1, 1] */
function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0, amp = 0.5, total = 0;
  for (let i = 0; i < octaves; i++) {
    sum += (noise(x, y, seed + i * 7) - 0.5) * 2 * amp;
    total += amp;
    x = x * 2.03 + 17.1; y = y * 1.97 + 9.3; amp *= 0.5;
  }
  return sum / total;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

// ---------------------------------------------------------------------------
// the materials
// ---------------------------------------------------------------------------

/**
 * The whitewash: near-neutral, a shade greyer overhead. It is cooler than the
 * walls look in the frames on purpose — the pendant the shader lights it with is
 * amber, and the frames' walls are this wash under that lamp, not the wash.
 */
/** the walls' limewash: WHITE, where it used to be a warm cream — the yellow
 *  in [0.85, 0.81, 0.71] is what made them read as clean paint rather than as
 *  a floated coat */
const WHITEWASH: RGB = [0.875, 0.862, 0.832];
/**
 * The flat ceiling is a COOLER and darker white than the walls — distemper over
 * lath, where the walls are papered. In `Scene2/View15`, away from the pendant
 * that warms everything under it, the ceiling reads rgb 36 33 32 — red over
 * blue 1.11, near enough neutral — where the wall in the same frame reads 26 21
 * 18, which is 1.40, and the wall in the next bay 2.30.
 */
const CEILING_WASH: RGB = [0.65, 0.655, 0.65];
/** the dado and the skirting: a dark red-brown stain over softwood, nearly
 *  black in the frames; the door is the same stain, older and varnished */
const STAIN: RGB = [0.19, 0.105, 0.065];
/**
 * The rail on the dado, and it alone: a DARK BROWN, of the same family as the
 * stain under it but painted rather than soaked in, so the moulding still reads
 * as its own piece of wood.
 *
 * It was a pale grey, [0.66, 0.65, 0.62], and that was wrong: at 1.42 on its top
 * face it came out brighter than the limewash above it, so the one horizontal
 * line in the room was also the brightest thing in it.
 *
 * DO NOT REASON ABOUT THE TOP FACE TO PREDICT WHAT THIS LOOKS LIKE. The rail is
 * 90 units of a chart whose texel is eight, and the lit face is 34 of those —
 * three or four texels, minified to a pixel or two from across the room. What
 * the eye gets is that face averaged with the fillet at 0.9, the underside at
 * 0.5 and the boards' own shadow beneath, and the average moves far less than
 * the paint does. Over the whole range tried, [0.041] to [0.300] — a factor of
 * seven — the band on the wall only went from 19.5 to 32.9 against boards that
 * sit at 29.7. That is the scale to think on, and it is why this was settled by
 * photographing five values rather than by arithmetic:
 *
 *     0.041  19.5   0.66 of the boards      0.185  28.1   0.95
 *     0.085  22.8   0.77                    0.300  32.9   1.11
 *     0.130  25.4   0.86
 *
 * 0.14 is the middle of that, and deliberately so: 0.30 read as a bar and was
 * wanted darker, 0.041 — which is `FURNITURE_PAINT.desk` divided by the 1.42, so
 * as dark as the desk exactly — was too dark. At 0.14 the rail sits a shade
 * UNDER the boards rather than over them, so it reads as a line rather than as a
 * bar, without going to the near-black the desk is.
 *
 * The shaping below is untouched through all of this — the top face catches, the
 * fillet is a shade under it, the underside turns away — because that is what
 * makes a few pixels of chart read as a moulding at all, and it works as well on
 * a dark line as on a light one.
 *
 * Nothing in this file is gamma-encoded on the way out — a component goes to the
 * chart as itself times 255 — so these read as the display values they are.
 */
const RAIL_PAINT: RGB = [0.14, 0.079, 0.043];
const DOOR_STAIN: RGB = [0.17, 0.10, 0.06];
const MORTAR: RGB = [0.52, 0.48, 0.42];
/** the boards: deal, once stained, now scrubbed and walked to a grey-brown — in
 *  the frames the floor is the darkest thing in the room after the door, and it
 *  has hardly any colour left */
const DEAL: RGB = [0.135, 0.115, 0.095];
const BRASS: RGB = [0.80, 0.62, 0.30];

/**
 * A PHOTOGRAPHED PLASTER, tiled, standing in for the invented tooth.
 *
 * It is handed in rather than imported because this module is arithmetic and
 * knows nothing about fetching: the page loads `bedsit/plaster.jpg`, reduces it
 * to one number a texel, and leaves it here before it asks for any paint. With
 * nothing handed in, {@link plaster} falls back to the noise it always used, so
 * a missing file costs the room its photograph and nothing else.
 *
 * WHAT IT REPLACES, AND WHAT IT DOES NOT. Only the tooth — the two fine bands
 * and the pinholes. The blotch, the lump and the grain above it are left alone,
 * and that is deliberate: they are slow, they never repeat, and they are what
 * keeps a two-metre tile from reading as a two-metre tile. The photograph
 * supplies what it is good at, which is the surface a float leaves, and the
 * noise goes on supplying what a 2 m square of photograph cannot, which is a
 * wall five metres long that does not repeat.
 */
let TOOTH: { n: number; k: Float32Array } | null = null;
/**
 * How much wall one repeat of the photograph covers — FOUR METRES, which is
 * twice what the scan is of.
 *
 * It was two, the scan's own size, and at two it could not be seen at all. The
 * limit is not the photograph, it is the chart: a wall is 1024 by 512 texels
 * over 8,600 units by 3,200, which is about NINE UNITS A TEXEL. Tiled at two
 * metres a 512 scan puts a texel every six units, finer than the chart can
 * hold, so the whole of its grain fell through the gaps and what arrived was a
 * blur — measurably smoother than the noise it replaced, which is the opposite
 * of the point.
 *
 * At four metres a scan texel is twelve units, and the chart resolves every one
 * of them. It makes the pinholes twice life size, which at a wall's viewing
 * distance is a trade worth making for being able to see them at all. It also
 * repeats 1.4 times across a wall and not three, so there is less to disguise
 * than there was before.
 */
const TOOTH_REPEAT = 6197.5;
/**
 * How much of the photograph's own contrast to use.
 *
 * The scan runs 135 to 255 about a mean of 212, so as a multiplier it is 0.64
 * to 1.20. At 0.6 that is -0.22 to +0.12, which is about the range the invented
 * mottle covered altogether — so the wall is as varied as it was, in the
 * photograph's shapes instead of in noise's.
 */
const TOOTH_STRENGTH = 0.6;

/** the page hands the photograph in: `n` by `n` values, each already divided by
 *  the picture's own mean so that flat plaster is exactly 1 */
export function useToothPhoto(n: number, k: Float32Array): void {
  TOOTH = { n, k };
}

/** the photograph at a point on the wall, tiled and interpolated — nearest
 *  would put the scan's own texels on the chart's, and two grids that nearly
 *  line up beat against one another */
function toothAt(u: number, v: number): number {
  const t = TOOTH!, n = t.n;
  const x = ((u / TOOTH_REPEAT) % 1 + 1) % 1 * n, y = ((v / TOOTH_REPEAT) % 1 + 1) % 1 * n;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
  const a = t.k[y0 * n + x0], b = t.k[y0 * n + x1];
  const c = t.k[y1 * n + x0], d = t.k[y1 * n + x1];
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

/**
 * Rough plaster under a wash. Three scales: the trowel's blotches at half a
 * metre, the lumps of a rough float at a hand's breadth, and the grain of the
 * sand. The wash sits thin in the hollows, so a dark lump is also a grey one.
 */
function plaster(u: number, v: number, seed: number, wash: RGB, blotchScale: number, tooth = 0): RGB {
  if (TOOTH && tooth > 0) {
    /**
     * The photograph carrying the whole surface — its sweep, its lumps, its
     * sand and its pinholes — and not, as it did at first, only the finest band
     * with three invented ones under it. That blend was why it looked like no
     * change had been made: the three slow bands are most of what the eye reads
     * on a wall, and they were still the old noise.
     *
     * One slow band of noise is kept over the top. It is not texture, it is the
     * anti-repeat: at four metres the tile comes round 1.4 times across a wall,
     * and a drift the scan knows nothing about is what stops the second pass
     * being recognisable as the first.
     */
    const p = toothAt(u, v);
    // `tooth` is a STRENGTH here and not a switch, which is what lets the
    // ceiling have the same plaster as the walls without the same roughness:
    // it is distemper over lath where they are floated, so it takes the
    // photograph at less than half weight and comes out the smoother surface it
    // ought to be, rather than — as it did at first — quietly keeping the old
    // invented noise because the photograph was gated on tooth being nonzero.
    const k = 1 + TOOTH_STRENGTH * tooth * (p - 1) + 0.05 * fbm(u / blotchScale, v / blotchScale, seed, 2);
    // the wash sits thin in the hollows, so a hollow is a greyer one as well as
    // a darker one — the same trade the invented version made with its lumps
    const hollow = Math.max(0, 1 - p) * tooth;
    return [wash[0] * k * (1 - hollow * 0.10), wash[1] * k * (1 - hollow * 0.17), wash[2] * k * (1 - hollow * 0.28)];
  }
  const blotch = fbm(u / blotchScale, v / blotchScale, seed, 2);
  const lump = fbm(u / 120, v / 120, seed + 100, 2);
  const grain = fbm(u / 26, v / 26, seed + 200, 1);
  let k = 1 + 0.05 * blotch + 0.10 * lump + 0.06 * grain;
  /**
   * `tooth` is how rough this surface is: 1 for a floated wall, 0.42 for the
   * ceiling's distemper, 0 for no roughness at all.
   *
   * The same plaster serves both, and only the walls were asked for. Three
   * things separate a floated wall from a flat tint: the sweep of the float
   * itself, which is broad and shallow; the sand in the coat, which is the tooth
   * you feel; and the pinholes, which are the only part of it that is DARKER
   * rather than lighter and are most of why a real wall never looks clean.
   *
   * The sand is at 22 units and not at the 9 it wants to be. The wall charts are
   * 1024 across a room of some 8,200, so a texel is eight units, and anything
   * finer than about three of them stops being tooth and becomes static.
   */
  if (tooth > 0) {
    k += tooth * (0.055 * fbm(u / 230, v / 230, seed + 300, 3)
                + 0.075 * fbm(u / 22, v / 22, seed + 400, 2));
    const pit = noise(u / 13, v / 13, seed + 500);
    if (pit > 0.86) k -= tooth * 0.20 * ((pit - 0.86) / 0.14);
  }
  const grey = lump < 0 ? -lump * 0.05 : 0;
  return [wash[0] * k * (1 - grey * 0.4), wash[1] * k * (1 - grey * 0.6), wash[2] * k * (1 - grey)];
}

const DADO = {
  /** the top of the rail */
  rail: 1400,
  /** the rail's own height */
  railDepth: 90,
  skirting: 190,
  /** a tongue-and-groove board's width */
  board: 150,
} as const;

/**
 * Dark-stained tongue-and-groove, vertical: a groove in shadow every board, a
 * caught edge beside it, each board a shade of its own, and a grain that is
 * tight across the board and long down it.
 */
function panelling(u: number, v: number, seed: number): RGB {
  const board = Math.floor(u / DADO.board);
  const own = 0.88 + 0.24 * hash(board, 0, seed);
  const across = u - board * DADO.board;
  // the joints barely show on boards this dark: a hint of a line, no more
  const groove = across < 10 ? 0.78 : across < 18 ? 1.05 : 1;
  const grain = fbm(u / 9, v / 260, seed + 300, 2);
  return scale(STAIN, own * groove * (1 + 0.12 * grain));
}

/**
 * The bottom of every wall, floor to rail. The rail is a dark brown moulding on a
 * dado of stained boards a shade lighter than it, and the pendant is above it:
 * so its top face is the brightest part OF THE RAIL, the fillet under that a
 * shade darker, and the boards directly beneath it are in its shadow. A line
 * with a lit edge and a shadow under it is all a moulding is at this distance,
 * and the SHAPING is what carries that — not whether the paint is lighter or
 * darker than what surrounds it.
 */
function dado(u: number, v: number, seed: number): RGB {
  const wood = panelling(u, v, seed);
  if (v < DADO.skirting) {
    if (v > DADO.skirting - 14) return scale(wood, 1.35);   // the bead on top
    if (v > DADO.skirting - 22) return scale(wood, 0.7);    // the quirk under it
    return scale(wood, 0.8);
  }
  const railFoot = DADO.rail - DADO.railDepth;
  if (v >= railFoot) {
    const up = v - railFoot;
    const worn = 1 + 0.08 * fbm(u / 60, v / 30, seed + 310, 1);
    if (up > DADO.railDepth - 34) return scale(RAIL_PAINT, 1.42 * worn);  // the top face, lit: brighter than the wash
    if (up > DADO.railDepth - 50) return scale(RAIL_PAINT, 0.9 * worn);   // the fillet
    return scale(RAIL_PAINT, (0.5 + 0.2 * (up / (DADO.railDepth - 50))) * worn); // the underside, turning away
  }
  if (v > railFoot - 40) return scale(wood, 0.6 + 0.4 * ((railFoot - v) / 40)); // in the rail's shadow
  return wood;
}

/** London stocks in stretcher bond, seen where the plaster has left them */
export function brick(u: number, v: number, seed: number): RGB {
  const COURSE = 100, JOINT = 15, LENGTH = 340;
  const course = Math.floor(v / COURSE);
  const inCourse = v - course * COURSE;
  const offset = (course & 1) * (LENGTH / 2);
  const col = Math.floor((u + offset) / LENGTH);
  const inBrick = u + offset - col * LENGTH;
  if (inCourse < JOINT || inBrick < JOINT) {
    return scale(MORTAR, 0.8 + 0.3 * noise(u / 15, v / 15, seed + 400));
  }
  const own = hash(col, course, seed + 401);
  const base: RGB = [0.52 + 0.18 * own, 0.24 + 0.10 * own, 0.16 + 0.06 * own];
  return scale(base, 1 + 0.12 * fbm(u / 18, v / 18, seed + 402, 1));
}

// ---------------------------------------------------------------------------
// the damage
// ---------------------------------------------------------------------------

/** a patch where the plaster has come away, in chart units; `w`, `h` are its
 *  full extent, and the shape is a blob, not the ellipse those describe */
interface Hole { u: number; v: number; w: number; h: number }

/**
 * Where the plaster has failed, wall by wall, in each chart's own coordinates
 * (the walls are `u` along, `v` up, in world units). Read off the frames
 * projected back onto the shell, so a hole here is a hole there to within the
 * width of a hand; the shapes are this file's own.
 */
export const DAMAGE: Readonly<Partial<Record<SurfaceId, { holes: Hole[] }>>> = {
  "door-wall": {
    holes: [
      { u: 6550, v: 2250, w: 560, h: 320 },
      { u: 4900, v: 3700, w: 280, h: 210 },
      { u: 10900, v: 4480, w: 230, h: 170 },
      // Over the door's head, and it has to clear the ARCHITRAVE and not just
      // the opening. The door stopped being a flat chart in the wall and became
      // a modelled surround that stands 150 above DOOR.head, to 3450; at v 3400
      // this hole spanned 3335 to 3465 and all but its top edge was behind the
      // head, which read as a hole punched through the joinery. 3620 puts its
      // foot 95 clear of the architrave's top.
      { u: 10190, v: 3620, w: 190, h: 130 },
    ],
  },
  "fireplace-wall": {
    holes: [
      { u: 10150, v: 3900, w: 1250, h: 640 },
      { u: 9540, v: 2350, w: 320, h: 190 },
      { u: 4650, v: 3400, w: 270, h: 190 },
      { u: 5550, v: 4380, w: 350, h: 190 },
    ],
  },
  "counter-wall": {
    holes: [
      // Picked off `Scene1/View32`, which stands 5,749 back from this wall and
      // sees all of it. The first two were already within about a hundred of
      // where the frame puts them; the third was missing altogether, and the
      // sizes came off the same picture at 22.5 units to a frame pixel.
      { u: 7214, v: 3355, w: 430, h: 280 },   // left of the wall cupboard
      { u: 4519, v: 4125, w: 330, h: 250 },   // over the LONDON poster
      { u: 12019, v: 2966, w: 400, h: 330 },  // beside the framed photograph
    ],
  },
  "window-wall": {
    holes: [
      { u: 4200, v: 2950, w: 270, h: 190 },
    ],
  },
};

/**
 * How far `(u, v)` is into a hole: under 1 is brick, 1 to 1.14 is the broken lip
 * of the plaster, and beyond that is wall.
 *
 * The outline is a POLYGON, and that is the whole of the difference. Plaster
 * does not come off in discs — it FLAKES, and a flake has straight edges meeting
 * at corners, which is what every hole in the frames looks like and what an
 * ellipse roughened by noise can never look like however much noise it is given.
 *
 * Each side is a half-plane at its own angle and its own distance from the
 * middle, and the radius in any direction is the nearest of them: that is the
 * radial form of a convex polygon. The angles and the distances come out of the
 * hole's OWN position, so every hole is a different shape and stays that shape.
 * A slow wander along each edge then stops the sides being ruled lines.
 */
function holeDepth(h: Hole, u: number, v: number, seed: number): number {
  const du = (u - h.u) / (h.w / 2), dv = (v - h.v) / (h.h / 2);
  const r = Math.hypot(du, dv);
  if (r > 2.4) return 9;
  const a = Math.atan2(dv, du);
  const sides = 7 + Math.floor(hash(h.u, h.v, seed) * 4);
  let edge = 9;
  for (let j = 0; j < sides; j++) {
    const th = (2 * Math.PI * j) / sides + (hash(h.u + j * 37, h.v, seed + 7) - 0.5) * 1.0;
    const c = 0.74 + 0.44 * hash(h.u, h.v + j * 37, seed + 13);
    const cs = Math.cos(a - th);
    if (cs > 0.08) edge = Math.min(edge, c / cs);
  }
  /**
   * And then the polygon is spoiled, because plaster does not come off in one
   * go. It lets go over years: the sides crumble at two or three scales at once,
   * and pieces stay CLINGING inside the break long after the rest has gone.
   *
   * The first term is the slow wander along each side. The second and third are
   * spatial rather than angular — noise in `u` and `v` rather than in the angle
   * — which is what makes an edge ragged instead of merely wavy, because a
   * ragged edge is not a function of the angle at all.
   */
  edge *= 1 + 0.13 * fbm(Math.cos(a) * 2.4, Math.sin(a) * 2.4, seed + 21, 2)
            + 0.09 * fbm(u / 55, v / 55, seed + 31, 2)
            + 0.05 * fbm(u / 15, v / 15, seed + 41, 2);
  // the plaster that has not fallen yet: where this rises, the hole is filled
  // back in, and near the rim that is what leaves crumbs standing in the break
  return r / edge + 0.34 * Math.max(0, fbm(u / 42, v / 42, seed + 51, 2));
}

/**
 * A wall, at a point. The dado to 0.9 m, plaster above it, and the holes
 * punched through the plaster to the brick — never through the dado, because
 * the boards are what protect that stretch, and the frames show none there.
 */
function wall(u: number, v: number, seed: number, damage: { holes: Hole[] } | undefined): RGB {
  if (v < DADO.rail) return dado(u, v, seed);
  let c = plaster(u, v, seed, WHITEWASH, 650, 1);
  // the rail throws a soft shadow up the plaster
  if (v < DADO.rail + 30) c = scale(c, 0.82 + 0.18 * ((v - DADO.rail) / 30));
  if (!damage) return c;
  for (const h of damage.holes) {
    const d = holeDepth(h, u, v, seed);
    if (d >= 1.14) continue;
    if (d >= 1) {
      // the break: fresh plaster, whiter than the wash, and crumbling
      const crumb = 1 + 0.15 * fbm(u / 12, v / 12, seed + 500, 1);
      return scale([0.86, 0.83, 0.77], crumb * (0.9 + 0.1 * ((d - 1) / 0.14)));
    }
    // inside: brick, recessed, and in the shadow of the lip above it
    const up = (v - h.v) / (h.h / 2);
    const shade = 0.85 * (1 - 0.4 * clamp01((up - 0.1) / 0.9));
    return scale(brick(u, v, seed), shade);
  }
  return c;
}


// ---------------------------------------------------------------------------
// the ceiling and the door
// ---------------------------------------------------------------------------

/**
 * The soot the pendant has printed on the plaster over it.
 *
 * A gas mantle and then a bulb, in a room nobody has distempered since: the
 * plume goes straight up, hits the ceiling in a tight round print, and spreads
 * out along it in a much fainter halo. So it is two terms and not one. The core
 * is barely a foot across and carries most of the darkness; the halo is a metre
 * and is what makes the mark read as a stain rather than as a dirty spot.
 *
 * `edge` is the exponent the distance goes to. A plain Gaussian, which is what
 * was here, is 2 — a soft mound with no edge anywhere, and at the depth it was
 * drawn at it never read as anything at all. Above 2 the top flattens and the
 * falloff steepens, which is what a deposit does: it stops where the plume
 * stops touching.
 *
 * Nothing here says WHERE. That comes from {@link PENDANT} itself, the same
 * record the room hangs the fitting from, so the mark cannot be left behind if
 * the lamp is moved.
 */
const SOOT = {
  core: { depth: 0.52, radius: 620, edge: 2.6 },
  halo: { depth: 0.24, radius: 1900, edge: 1.7 },
  /** how far the mark's own edge wanders off a circle — a draughty room does
   *  not deposit evenly, and a true circle on a ceiling reads as a decal */
  wander: 0.22,
} as const;

/** how much of the plaster the soot takes, 0 to 1, at a point on the ceiling */
function sootAt(u: number, v: number, seed: number): number {
  const du = u - PENDANT.x, dv = v - PENDANT.y;
  const wander = 1 + SOOT.wander * fbm(du / 900, dv / 900, seed + 701, 2);
  const r = Math.hypot(du, dv) / Math.max(0.3, wander);
  const core = Math.exp(-Math.pow(r / SOOT.core.radius, SOOT.core.edge));
  const halo = Math.exp(-Math.pow(r / SOOT.halo.radius, SOOT.halo.edge));
  // the grain of it: soot lies in the tooth of the distemper, so it is mottled
  // at the scale the plaster itself is
  const grain = 1 + 0.34 * fbm(u / 260, v / 260, seed + 700, 2);
  return clamp01((SOOT.core.depth * core + SOOT.halo.depth * halo) * grain);
}

function ceiling(u: number, v: number, seed: number): RGB {
  // the flat only: the slope is unfolded onto the window wall's chart, since it
  // is the wall carrying on past the eaves and takes the wall's own paper
  /**
   * THE SAME PHOTOGRAPH AS THE WALLS, at less than half weight.
   *
   * `tooth` is a strength and not a switch, which is the whole of what lets
   * this happen: the ceiling has always been the same {@link plaster} call as a
   * wall with a cooler, darker wash, but it passed 0 and so kept the invented
   * noise when the walls moved to the scan.
   *
   * 0.7, having been 0.42 and read as too smooth. The reasoning behind 0.42 was
   * that distemper over lath is a flatter surface than a floated wall, which is
   * true of the plaster and beside the point here: the ceiling is the furthest
   * thing from every lamp in the room and the dimmest surface in it, so the same
   * variation arrives with a good deal less contrast than it does on a wall. It
   * wants MORE than the wall to read as the same material, not less.
   */
  const c = plaster(u, v, seed, CEILING_WASH, 900, 0.7);
  // and the soot over the lamp. Warm black on a cool white, so it takes the
  // blue hardest and the red least — which is the one thing that keeps a dark
  // patch on a neutral ceiling from reading as a hole in it.
  const soot = sootAt(u, v, seed);
  return [c[0] * (1 - soot * 0.92), c[1] * (1 - soot * 1.0), c[2] * (1 - soot * 1.12)];
}


const BOARD = {
  /** across the board, in world units — about 180 mm */
  width: 280,
  /** the gap between boards, which at this texel size is one dark line */
  gap: 12,
} as const;

/**
 * Floorboards along `v` (the room's `y`, towards the door), in rows across `u`.
 * Each row's boards are as long as that row's boards are — two to three metres —
 * and start where that row starts, so the butt joints stagger the way a floor's
 * do. A board has its own tone and what is left of its own redness, a long grain
 * and a shorter figure, and one edge caught by the light where it has cupped.
 */
function boards(u: number, v: number, seed: number): RGB {
  const row = Math.floor(u / BOARD.width);
  const across = u - row * BOARD.width;
  const period = 2000 + 1000 * hash(row, 1, seed);
  const offset = period * hash(row, 2, seed);
  const seg = Math.floor((v + offset) / period);
  const along = v + offset - seg * period;
  if (across < BOARD.gap || along < BOARD.gap) return [0.04, 0.035, 0.03];
  const own = 0.86 + 0.28 * hash(row, seg, seed + 3);
  const red = hash(row, seg, seed + 4);
  const base: RGB = [DEAL[0] + 0.03 * red, DEAL[1] + 0.008 * red, DEAL[2] - 0.006 * red];
  const grain = fbm(u / 7, v / 420, seed + 5, 2);
  const figure = fbm(u / 40, v / 90, seed + 6, 1);
  const dirt = 1 + 0.12 * fbm(u / 900, v / 900, seed + 7, 2);
  const edge = across < BOARD.gap + 10 ? 1.12 : across > BOARD.width - 10 ? 0.84 : 1;
  return scale(base, own * dirt * edge * (1 + 0.18 * grain + 0.08 * figure));
}

/** how far in from the hem the drawn rug's border darkens */
const RUG_BORDER = 110;

/**
 * The rag rug, drawn — which is now only what stands in for the photograph if
 * the photograph does not arrive.
 *
 * `bedsit-rug.jpg` is a real rug, and it is laid on the rug's own chart by the
 * page the way the pictures are hung. This is the same thing the floor wore
 * before that: a hooked rug of rags, a speckle of tufts — cream, grey, a
 * blue-grey and a brown, each the size of a thumb — with a darker border.
 *
 * It is drawn in the rug chart's own (u, v), which is the room's (x, y) over
 * {@link RUG}, so `edge` is the distance to the rug's own hem. There is no cut
 * at that hem any more and no `null` off it: the rug is its own quad now, and
 * the quad's edges ARE the rug's edges.
 */
function rug(u: number, v: number, seed: number): RGB {
  const edge = Math.min(u - RUG.x0, RUG.x1 - u, v - RUG.y0, RUG.y1 - v);
  const tuft = hash(Math.floor(u / 26), Math.floor(v / 26), seed + 901);
  let c: RGB = tuft < 0.22 ? [0.27, 0.30, 0.37] : tuft < 0.36 ? [0.44, 0.37, 0.29] : tuft < 0.55 ? [0.56, 0.56, 0.53] : [0.74, 0.72, 0.66];
  c = scale(c, 0.85 + 0.3 * noise(u / 60, v / 60, seed + 902));
  if (edge < RUG_BORDER) {
    const k = 0.55 + 0.45 * (edge / RUG_BORDER) ** 2;
    c = [c[0] * k * 0.9, c[1] * k * 0.9, c[2] * k];
  }
  return c;
}

// ---------------------------------------------------------------------------
// the street
// ---------------------------------------------------------------------------

/**
 * What stands across the road, left to right along the backdrop, **read off the
 * frames**: the bake of the street chart (`bedsit-skin.ts`, the projected skin)
 * laid over a drawing in the same coordinates shows where the real texels sit,
 * and these segments are traced from it — each building's span in `u`, its
 * parapet in `z`, and what it is made of. Two patches of the backdrop are real
 * (behind each window); the rest of the row continues them in the same style.
 *
 * - `brick`: red brick with white dressings — the left house has a white bay
 *   and one string of bunting, the one left of centre a pediment and two.
 * - `stucco`: the long Bayswater terrace, painted stucco, pilasters and cornice.
 *   The frames show it running AWAY down a side street, roofline falling and
 *   windows shrinking towards the junction, so a `recede` says which way it
 *   goes and it is drawn in perspective from an eye at the room's own height —
 *   a matte painting's perspective, right from the room and only from there.
 * - `block`: the tall pale mansion block at the right end.
 */
interface Segment {
  u0: number; u1: number;
  kind: "brick" | "stucco" | "block";
  /** the parapet, in z */
  top: number;
  /** z of each string of bunting, if any */
  bunting?: number[];
  bay?: boolean;
  pediment?: boolean;
  /** a chimney stack's centre, in u */
  chimney?: number;
  /** the row runs away from the eye towards +u (1) or -u (-1); absent, it faces us */
  recede?: 1 | -1;
}
const STREET: readonly Segment[] = [
  { u0: -20000, u1: -600, kind: "stucco", top: 2600, recede: -1 },
  { u0: -600, u1: 3200, kind: "brick", top: 3000, bay: true, bunting: [0], chimney: 1500 },
  { u0: 3200, u1: 6400, kind: "stucco", top: 2500 },
  { u0: 6400, u1: 9600, kind: "brick", top: 3300, pediment: true, bunting: [1600, 200] },
  { u0: 9600, u1: 16600, kind: "stucco", top: 2600, recede: 1 },
  { u0: 16600, u1: 19500, kind: "block", top: 4900 },
  { u0: 19500, u1: 40000, kind: "stucco", top: 2700 },
];
/** the trees in front: crown centre in u, the crown's top in z, its half-width */
const TREES = [
  { u: -450, top: 1300, half: 520 },
  { u: 12000, top: 250, half: 1400 },
  { u: 13600, top: 0, half: 750 },
] as const;
/** eye level, where a receding row's lines meet */
const HORIZON = 2479;
/** how fast a receding row shrinks: at 7 m along it is half its size */
const RECEDE = 1.4e-4;

/** the barrage balloon, where the left window's frames have it */
const BALLOON = { u: 1050, v: 6550, a: 720, b: 310 } as const;
/** the spire on the far skyline, behind the brick house */
const SPIRE = { u: 9250, top: 4300, half: 230 } as const;

/** the sky over London: pale at the roofs, blue above, clouds blown across */
function sky(u: number, v: number, seed: number): RGB {
  const t = clamp01((v - 2000) / 9000);
  const base: RGB = [0.72 + 0.02 * (1 - t) - 0.22 * t, 0.80 - 0.18 * t, 0.90 - 0.06 * t];
  const cloud = fbm(u / 4200, v / 2200, seed + 1000, 3) + 0.35 * fbm(u / 900, v / 600, seed + 1010, 2);
  const c = smooth(clamp01((cloud - 0.05) / 0.35));
  return [base[0] + (0.96 - base[0]) * c, base[1] + (0.95 - base[1]) * c, base[2] + (0.94 - base[2]) * c];
}

/** the far skyline: roofs a street or two back — flat runs stepping up and
 *  down house by house, a chimney stack on some — with a spire standing out of it */
function farSkyline(u: number, seed: number): number {
  const house = Math.floor(u / 900), inHouse = u - house * 900;
  const roofs = 2950 + 260 * hash(house, 7, seed);
  const stack = hash(house, 8, seed) > 0.5 && inHouse > 250 && inHouse < 420 ? 300 : 0;
  const spire = Math.abs(u - SPIRE.u) < SPIRE.half ? SPIRE.top - (SPIRE.top - 3300) * (Math.abs(u - SPIRE.u) / SPIRE.half) ** 0.6 : 0;
  return Math.max(roofs + stack, spire);
}

/** a sash window: white architrave round dark glass with bars; `null` off it */
function sash(dx: number, dy: number, w: number, h: number, seed: number, u: number, v: number): RGB | null {
  if (Math.abs(dx) > w / 2 + 120 || dy < -220 || dy > h + 140) return null;
  if (Math.abs(dx) > w / 2 || dy < 0 || dy > h) return scale([0.90, 0.89, 0.84], dy < 0 && dy > -110 ? 0.7 : 1);
  if (Math.abs(dx) < 20 || Math.abs(dy - h / 2) < 26 || Math.abs(dy - h * 0.25) < 14 || Math.abs(dy - h * 0.75) < 14) return [0.86, 0.85, 0.80];
  const refl = dy > h / 2 ? 0.35 + 0.25 * (dy / h) : 0.18;
  return scale([0.35, 0.40, 0.48], refl + 0.05 * noise(u / 60, v / 60, seed + 1400));
}

function brickwork(u: number, v: number, seed: number, brick: RGB): RGB {
  const course = Math.floor(v / 100), inCourse = v - course * 100;
  const offset = (course & 1) * 170, col = Math.floor((u + offset) / 340), inBrick = u + offset - col * 340;
  if (inCourse < 12 || inBrick < 12) return scale([0.70, 0.66, 0.60], 0.85);
  return scale(brick, 0.88 + 0.24 * hash(col, course, seed + 1500));
}

/** the bunting: a string sagging across the house with pennants on it */
function bunting(seg: Segment, u: number, v: number): RGB | null {
  if (!seg.bunting) return null;
  const width = seg.u1 - seg.u0, t = (u - seg.u0) / width;
  for (const z of seg.bunting) {
    const string = z + 260 - 300 * Math.sin(Math.PI * t);
    const flag = Math.floor((u - seg.u0) / 280), fin = u - seg.u0 - flag * 280;
    const drop = 170 * (1 - Math.abs(fin - 140) / 140);
    if (v < string + 10 && v > string - drop && fin > 18 && fin < 262) {
      return [[0.75, 0.16, 0.14], [0.92, 0.90, 0.86], [0.14, 0.20, 0.50]][flag % 3] as RGB;
    }
    if (Math.abs(v - string) < 13) return [0.3, 0.3, 0.3];
  }
  return null;
}

/**
 * London, on the backdrop plane. The lower rows of the chart are below the
 * street's roofs — this is a top-floor window — so what is painted is upper
 * floors, parapets, roofs and sky, with the trees and the balloon in front.
 */
function london(u: number, v: number, seed: number): RGB {
  // the balloon: in front of the sky and above everything
  const bx = (u - BALLOON.u) / BALLOON.a, by = (v - BALLOON.v) / BALLOON.b;
  const finU = u - (BALLOON.u - BALLOON.a * 0.75);
  const inFin = finU > -300 && finU < 250 && v > BALLOON.v - 60 && v < BALLOON.v + 560 - 400 * clamp01((finU + 300) / 550);
  if (bx * bx + by * by < 1 || inFin) {
    const shade = bx * bx + by * by < 1 ? 1 - 0.45 * Math.max(0, -by) * (0.5 + 0.5 * bx) - 0.25 * Math.max(0, by) : 0.85;
    return scale([0.74, 0.74, 0.71], shade);
  }
  // the trees, in front of the houses
  for (const t of TREES) {
    const tx = (u - t.u) / t.half, ty = (v - (t.top - 1.6 * t.half)) / (1.6 * t.half);
    if (tx * tx + ty * ty + 0.5 * fbm(u / 260, v / 260, seed + 1100, 2) < 1 && v < t.top) {
      const leaf = 0.7 + 0.6 * noise(u / 45, v / 45, seed + 1101);
      return scale([0.22, 0.34, 0.16], leaf * (0.75 + 0.35 * clamp01(-ty + 0.3)));
    }
  }
  const seg = STREET.find((sg) => u >= sg.u0 && u < sg.u1)!;
  // A receding row is drawn in perspective: the backdrop point (u, v) is the
  // facade point (uf, vf), magnified back by how far along the row it is, so
  // the far end's cornice sits nearer the horizon and its windows are smaller.
  let uf = u - seg.u0, vf = v, width = seg.u1 - seg.u0;
  if (seg.recede) {
    const near = seg.recede > 0 ? seg.u0 : seg.u1;
    const m = 1 + RECEDE * Math.abs(u - near);
    vf = HORIZON + (v - HORIZON) * m;
    uf = Math.log(m) / RECEDE;
    width = Math.log(1 + RECEDE * width) / RECEDE;
  }
  const inSeg = uf, mid = seg.u0 + (seg.u1 - seg.u0) / 2;
  // a chimney stack on the brick house, above its parapet
  if (seg.chimney !== undefined && Math.abs(u - seg.chimney) < 300 && v >= seg.top && v < seg.top + 1000) {
    return scale(brickwork(u, v, seed, [0.40, 0.24, 0.18]), 0.8);
  }
  // the pediment: a gable over the middle of the house
  if (seg.pediment && v >= seg.top && v < seg.top + 900 - 900 * Math.abs(u - mid) / 1300) {
    const edge = seg.top + 900 - 900 * Math.abs(u - mid) / 1300 - v;
    return edge < 110 ? [0.86, 0.84, 0.78] : scale(brickwork(u, v, seed, [0.58, 0.33, 0.25]), 0.95);
  }
  if (vf >= seg.top) {
    // a low slate roof behind the parapet, then the far skyline, then sky
    const slate = seg.kind === "block" ? 300 : seg.recede ? 450 : 700 - 500 * Math.abs((u - mid) / (width / 2));
    if (vf < seg.top + slate) {
      const course = Math.floor((vf - seg.top) / 90) & 1;
      return scale([0.30, 0.33, 0.38], 0.85 + 0.12 * course + 0.1 * noise(u / 40, v / 20, seed + 1300));
    }
    if (v < farSkyline(u, seed)) {
      const haze = clamp01((v - 2500) / 1600) * 0.5;
      const far: RGB = [0.42, 0.36, 0.33];
      const skyHere = sky(u, v, seed);
      return [far[0] + (skyHere[0] - far[0]) * haze, far[1] + (skyHere[1] - far[1]) * haze, far[2] + (skyHere[2] - far[2]) * haze];
    }
    return sky(u, v, seed);
  }
  // party-wall shadow at each end of a house
  const endShade = 1 - 0.18 * Math.max(0, 1 - Math.min(inSeg, width - inSeg) / 250);
  // cornice and coping
  if (vf > seg.top - 400) {
    const step = vf > seg.top - 110 ? 1.0 : vf > seg.top - 220 ? 0.8 : 0.95;
    return scale(seg.kind === "block" ? [0.80, 0.78, 0.72] : [0.88, 0.86, 0.80], step * endShade);
  }
  const flags = bunting(seg, u, v);
  if (flags) return flags;

  if (seg.kind === "brick") {
    const brick: RGB = [0.58, 0.33, 0.25];
    // the bay: a white projecting window with three lights
    if (seg.bay) {
      const bu = seg.u0 + 1600, dx = u - bu;
      if (Math.abs(dx) < 620 && v > 400 && v < 1900) {
        if (Math.abs(dx) > 560 || v < 520 || v > 1780) return scale([0.88, 0.86, 0.80], endShade);
        const light = Math.abs(dx) < 180 ? 0 : dx < 0 ? -1 : 1;
        const s2 = sash(dx - light * 380, v - 620, 260, 1000, seed, u, v);
        if (s2) return s2;
        return scale([0.86, 0.84, 0.78], endShade);
      }
    }
    // windows in bays, a row per floor
    const bays = Math.max(2, Math.round(width / 1900)), bay = width / bays, inBay = inSeg - Math.floor(inSeg / bay) * bay;
    for (const rc of [seg.top - 2700, seg.top - 2700 - 4400, seg.top - 2700 - 8800]) {
      const s2 = sash(inBay - bay / 2, v - (rc - 800), Math.min(900, bay * 0.45), 1600, seed, u, v);
      if (s2) return scale(s2, endShade);
    }
    const grime = 1 - 0.18 * clamp01((seg.top - 4000 - v) / 6000);
    return scale(brickwork(u, v, seed, brick), grime * endShade);
  }
  if (seg.kind === "block") {
    // rows of square-ish windows in a pale rendered front
    const pitch = 1500, inCol = inSeg - Math.floor(inSeg / pitch) * pitch;
    for (let rc = seg.top - 1400; rc > -6000; rc -= 2300) {
      const s2 = sash(inCol - pitch / 2, v - (rc - 900), 720, 1000, seed, u, v);
      if (s2) return scale(s2, endShade);
    }
    const render = 0.94 + 0.08 * noise(u / 80, v / 80, seed + 1600);
    return scale([0.74, 0.72, 0.66], render * endShade * (v < seg.top - 9000 ? 0.85 : 1));
  }
  // stucco: houses of the terrace, pilasters between, sash windows, a rusticated
  // band lower down — all in facade coordinates, so a receding row shrinks
  const house = 5400, inHouse = inSeg - Math.floor(inSeg / house) * house;
  const pilaster = inHouse < 260 || inHouse > house - 260;
  const bays = 3, bay = house / bays, inBay = inHouse - Math.floor(inHouse / bay) * bay;
  const stucco: RGB = [0.86, 0.84, 0.78];
  // a row running away from us is lit from the side: a shade darker the further it goes
  const turned = seg.recede ? 0.92 - 0.12 * clamp01(inSeg / width) : 1;
  if (!pilaster) {
    for (const rc of [seg.top - 2400, seg.top - 2400 - 4300]) {
      const s2 = sash(inBay - bay / 2, vf - (rc - 800), 760, 1600, seed, uf, vf);
      if (s2) return scale(s2, endShade * turned);
    }
  }
  let k = 0.96 + 0.06 * noise(uf / 90, vf / 90, seed + 1700);
  if (pilaster) k *= 0.9 + 0.08 * Math.cos(((Math.min(inHouse, house - inHouse)) / 260) * Math.PI);
  if (vf < seg.top - 7000 && ((vf % 420) + 420) % 420 < 26) k *= 0.8;   // the rustication
  if (vf > seg.top - 400 - 200 && vf <= seg.top - 400) k *= 0.85;        // the shadow under the cornice
  return scale(stucco, k * endShade * turned);
}

// ---------------------------------------------------------------------------
// rasterizing
// ---------------------------------------------------------------------------

/** a chart, drawn by asking `at` about the middle of every texel */
function raster(chart: Chart, w: number, h: number, at: (u: number, v: number) => RGB): Float32Array {
  const out = new Float32Array(w * h * 3);
  for (let j = 0; j < h; j++) {
    const v = chart.v0 + ((j + 0.5) * (chart.v1 - chart.v0)) / h;
    for (let i = 0; i < w; i++) {
      const u = chart.u0 + ((i + 0.5) * (chart.u1 - chart.u0)) / w;
      const c = at(u, v);
      const k = (j * w + i) * 3;
      out[k] = c[0]; out[k + 1] = c[1]; out[k + 2] = c[2];
    }
  }
  return out;
}

function toBytes(id: SurfaceId, w: number, h: number, rgb: Float32Array): Painted {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = Math.round(clamp01(rgb[i * 3]) * 255);
    rgba[i * 4 + 1] = Math.round(clamp01(rgb[i * 3 + 1]) * 255);
    rgba[i * 4 + 2] = Math.round(clamp01(rgb[i * 3 + 2]) * 255);
    rgba[i * 4 + 3] = 255;
  }
  return { id, width: w, height: h, rgba };
}

/** the surfaces this module knows how to paint, and how big a texture each gets */
const SURFACES: readonly { id: SurfaceId; w: number; h: number; seed: number }[] = [
  { id: "window-wall", w: 2048, h: 1024, seed: 11 },
  { id: "counter-wall", w: 2048, h: 1024, seed: 23 },
  { id: "fireplace-wall", w: 2048, h: 1024, seed: 37 },
  { id: "door-wall", w: 2048, h: 1024, seed: 41 },
  { id: "ceiling", w: 1024, h: 1024, seed: 53 },
  { id: "floor", w: 1024, h: 1024, seed: 79 },
  { id: "rug", w: 1024, h: 1024, seed: 83 },
  { id: "street", w: 2048, h: 1024, seed: 97 },
];

/** one surface's texture */
export function paintSurface(id: SurfaceId): Painted | null {
  const spec = SURFACES.find((s) => s.id === id);
  const chart = CHARTS.find((c) => c.id === id);
  if (!spec || !chart) return null;
  const { w, h, seed } = spec;
  let rgb: Float32Array;
  if (id === "ceiling") {
    rgb = raster(chart, w, h, (u, v) => ceiling(u, v, seed));
  } else if (id === "floor") {
    rgb = raster(chart, w, h, (u, v) => boards(u, v, seed));
  } else if (id === "rug") {
    rgb = raster(chart, w, h, (u, v) => rug(u, v, seed));
  } else if (id === "street") {
    rgb = raster(chart, w, h, (u, v) => london(u, v, seed));
  } else {
    const damage = DAMAGE[id];
    rgb = raster(chart, w, h, (u, v) => wall(u, v, seed, damage));
  }
  return toBytes(id, w, h, rgb);
}

/** every surface, one at a time, yielding to the page between them so the
 *  splash can say which wall it is on — the whole room is about two seconds.
 *  `skip` leaves a surface unpainted, for one the caller means to cover with a
 *  picture instead and would rather not spend the noise on. */
export async function paintRoom(
  onProgress?: (id: SurfaceId, done: number, of: number) => void,
  skip: readonly SurfaceId[] = [],
): Promise<Painted[]> {
  const out: Painted[] = [];
  const todo = SURFACES.filter((s) => !skip.includes(s.id));
  for (const [i, s] of todo.entries()) {
    onProgress?.(s.id, i, todo.length);
    await new Promise((r) => setTimeout(r, 0));
    const p = paintSurface(s.id);
    if (p) out.push(p);
  }
  return out;
}
