/**
 * The London bedsit, as a solid.
 *
 * BEDSIT1.SET is the room the game opens in — a Blitz-era garret off the
 * Bayswater Road, three standpoints and twenty-four pre-rendered views. It has
 * no geometry in it. What it *does* have is a camera per frame (position,
 * bearing, eye height) and a **Z image** per frame: a per-pixel depth, 24 levels
 * over `zFarMax`, shipped so the engine can hide an actor behind the scenery in
 * front of it (`engine/src/runtime/geometry.ts`, `sceneryOccludes`).
 *
 * Twenty-four depth images with known cameras are twenty-four range scans of one
 * room. This module is what they add up to: the shell of the flat — walls,
 * floor, the coved ceiling, the two dormer windows and the door — in the SET's
 * own world units, and a mesh builder that turns it into triangles.
 *
 * **Every number below was measured, not eyeballed**, by
 * `taoot/tools/bedsitfit.ts`; run it to print them again from the file. The room
 * is furnished in the game and empty here: no bed, no counter, no fireplace, no
 * posters. Those are the next pass.
 *
 * ## Reading the Z image
 *
 * A level is a **radial** distance from the eye — `r = level × zFarMax /
 * zLevelCount` — and not the planar depth `projectPoint` computes. The two
 * differ by 1/cos of the field angle, which is 41% at the corner of a 512×264
 * frame, so it is not a matter of taste: fitting the four walls against radial
 * depth beats planar on every wall (peak agreement 175k rays vs 140k, and a
 * consistency plateau 650–1050 units wide against 800–1450). TI.EXE quantizing
 * an actor's *planar* depth against a radial Z image is the original engine's
 * own small inconsistency, and it never shows, because an actor is never at the
 * edge of the frame at the depth of the wall behind it.
 *
 * ## Coordinates and scale
 *
 * The SET's own: `x`, `y` horizontal, `z` up, floor at 0. The frames put the eye
 * at `z = 2479` (`FrameInfo.posY16`, the same for all three standpoints), and
 * **the one assumption in this file is that that eye is 1.60 m off the floor** —
 * which fixes {@link UNITS_PER_METRE} and every other length with it. It is a
 * good assumption: it makes the door 2.13 m to the head and the ceiling 3.19 m,
 * which is an Edwardian top floor.
 *
 * Facing `θ`, **`+y` is on the right** — the set's world is left-handed about a
 * z-up axis. {@link glOf} is the one place that matters: WebGL gets
 * `(x, z, y)`, which is right-handed with z-up mapped to GL's y-up, so nothing
 * downstream has to think about it.
 */
import { INDICES as PENDANT_INDICES, POSITION as PENDANT_POSITION } from "./bedsit-pendant-mesh";
import { BOX as PENDANTGLOW_BOX, INDICES as PENDANTGLOW_INDICES, POSITION as PENDANTGLOW_POSITION } from "./bedsit-pendantglow-mesh";
import { BOX as PENDANTWINGS_BOX, INDICES as PENDANTWINGS_INDICES, POSITION as PENDANTWINGS_POSITION } from "./bedsit-pendantwings-mesh";

/** the SET's world units in a metre — {@link EYE_HEIGHT} over a floor at 0,
 *  called 1.60 m. Every other length in this file follows from that one call. */
export const UNITS_PER_METRE = 2479 / 1.6;

/** world units → the GL frame: y-up, right-handed, and no mirrored winding */
export function glOf(x: number, y: number, z: number): [number, number, number] {
  return [x, z, y];
}

/**
 * The shell. `x0` is the window wall (the dormers and the street), `x1` the
 * counter wall; `y0` is the fireplace wall and `y1` the wall the door is in.
 *
 * The four planes are fits, not extremes: a ray whose Z level is `L` puts its
 * surface somewhere in `[L, L+1) × 629`, so each wall is the coordinate that the
 * most rays' intervals agree on. Half-widths run 650–1050 units, so read these
 * as ±200 (±0.13 m).
 */
import { INDICES as DOOR_INDICES, POSITION as DOOR_POSITION } from "./bedsit-door-mesh";
import { INDICES as DOORBANDS_INDICES, POSITION as DOORBANDS_POSITION } from "./bedsit-doorbands-mesh";
import { INDICES as DOORFRAME_INDICES, POSITION as DOORFRAME_POSITION } from "./bedsit-doorframe-mesh";
import { INDICES as DOORKNOB_INDICES, POSITION as DOORKNOB_POSITION } from "./bedsit-doorknob-mesh";

export const ROOM = {
  x0: 3000,
  x1: 11600,
  y0: 2600,
  y1: 12600,
  floor: 0,
  /** the flat part of the ceiling; 3.19 m */
  ceiling: 4940,
} as const;

/** the eye the game's own frames were rendered from, and where a visit starts */
export const EYE_HEIGHT = 2479;

/** the three standpoints BEDSIT1 lets the player stand on, with their bearings
 *  in the engine's 1/256 turn. `deg` is the view a road arrives facing. */
export const STANDPOINTS = [
  { name: "Scene2", x: 7493, y: 4319, deg: 64 },
  { name: "Scene1", x: 5851, y: 8022, deg: 0 },
  { name: "Scene3", x: 9179, y: 9039, deg: 128 },
] as const;

/**
 * The ceiling's section across the room: a garret, flat down the middle and
 * PITCHED to the eaves over the window wall — the roof is the ceiling for the
 * last 1.8 m of it.
 *
 * TWO POINTS, because the section is two straight lines meeting at an arris.
 * This table used to hold a curve that flattened into the ceiling, and the
 * curve was an artefact of smoothing the measurement rather than reading it:
 * sample the upward rays of every standpoint in the band BETWEEN the two
 * dormers — y 7000 to 8900, where nothing vaults — take the 95th percentile of
 * z per 100-unit slab of x, and the points sit on a line of 0.86 from the wall
 * to about x 4800 and on the flat ceiling after it, with nothing between them
 * worth calling a curve. `Scene2/View15` shows that meeting as a hard edge, and
 * the slope reaching the wall at about the height of the dressing screen.
 */
export const ARRIS = 4800;
const PITCH: readonly (readonly [number, number])[] = [[ROOM.x0, 3400], [ARRIS, ROOM.ceiling]];


/**
 * The two windows, in the `x0` wall. Tall, narrow and round-headed, a mullion
 * down the middle of each, and the pair sits a little north of the room's own
 * centre line.
 *
 * These are the **glass**, at `x0 - reveal`, not the hole in the room face — and
 * the difference is the whole reason these numbers were wrong once. Cast the
 * daylight in the frames onto the wall plane and the two windows come out 700
 * units wide and 650 apart from the pair's true spacing, because a plane 600
 * units in front of the glass foreshortens everything on it towards the eye.
 * Cast onto the glass plane instead and six views — square-on and oblique, from
 * all three standpoints — agree to within 60 units.
 *
 * The daylight is what is measured, because the Z image cannot see a window: a
 * roof across the street is a few levels past the wall and a pane of glass is
 * not, so the depth alone finds only the far half of each opening. Luminance
 * finds all of it — this is a night interior and anything out of doors is three
 * times brighter than anything in.
 */
export const WINDOWS = [
  { y0: 5375, y1: 6455 },
  { y0: 9365, y1: 10485 },
] as const;

export const WINDOW = {
  /** the top of the apron, which the sash's bottom rail stands on */
  sill: 845,
  /**
   * Where the head starts to close in — and the head is a SEMICIRCLE from
   * there, of the light's own half-width, so there is no crown to give: it is
   * the springing plus the half-width, and it differs between the two windows
   * because they differ in width.
   *
   * The top edge of the daylight in `Scene3/View23`, column by column, back-cast
   * onto the glass plane, is seventeen points that fit a circle of radius 470
   * springing at 3,855 to an rms of NINE UNITS. It used to be an ellipse with a
   * crown of its own, 835 of rise over 540 of half-width, which is pointed —
   * and a pointed arch is what you get for letting the crown be a free number
   * instead of asking what curve the points are on.
   */
  spring: 3855,
  /** the glass sits this far outboard of the room face of the wall */
  reveal: 580,
  /**
   * Half-width of the centre mullion. It is the same stuff as the bars across:
   * in the sky above the top bar of `Scene3/View23` the mullion darkens two
   * columns, and a column there is 26 units, which is what the bars measure
   * too. It was 80 wide once, twice the bars, and read as a post.
   */
  mullion: 26,
  /**
   * The dark border round the glass: the sash's lining, and its bottom rail.
   *
   * It is AT THE GLASS, in the outer face of the wall, where the window itself
   * is — not a moulding on the room face. `Scene3/View23` shows plaster running
   * from the room straight down the splayed reveal and meeting this band, with
   * no wood on the flat of the wall at all; the band measures about eight
   * pixels across the jamb there, which at that distance is this wide. The room
   * face carried an architrave of 130 once, standing 28 proud, and that was the
   * same border in the wrong plane.
   */
  frame: 105,
  /**
   * The glazing bars: one mullion down the middle and three across, dividing
   * the light into four rows and eight panes.
   *
   * The three are 845 apart with the middle at 2,571 — read off the rows of
   * `Scene3/View23` where every pixel of the light is dark AND at the near
   * depth, which is a bar and not a chimney beyond the glass, and the same rows
   * come out of both windows. Equal spacing was not imposed on them; the two
   * gaps measured 845 and 844.
   */
  bar: { middle: 2571, spacing: 845, thick: 32 },
  /**
   * NO SPLAY. The opening is the same size at the room face as at the glass:
   * the window is one shape carried straight through the wall, and the reveal
   * is a prism, not a funnel.
   *
   * It was a funnel once — the room face 110 wider each side and its head 110
   * higher — because the aperture map `bedsitfit.ts` draws on the wall plane
   * finds the two openings 1,080 and 1,120 wide, while the DAYLIGHT cast on the
   * glass plane is 870 and 950, and the difference had to go somewhere. It goes
   * into the border: 1,080 is 870 plus 105 of frame each side. The two
   * measurements were never in conflict — one of them is the hole and the other
   * is the glass in it — and reading the difference as a splay put a taper in
   * the reveal that the frames do not have: a trapezoid sill, and a head that
   * hides the top of its own frame.
   */
  /**
   * How far behind the glass the street is drawn. Not a measurement — the Z
   * image's far clip is 15,099 units from the eye, and anything across a London
   * street is beyond it — but a plane the frames are projected onto that is
   * this far back gives the windows parallax when the room is walked, which a
   * picture on the glass cannot.
   */
  street: 8000,
} as const;

/**
 * Over each window the pitch is interrupted by a dormer recess, which is what
 * lets a 2.7 m window stand in a wall whose eaves are at 2.19 m.
 *
 * ONE HEIGHT, not a table. The recess is the window and its border carried
 * straight back into the roof, LEVEL: its roof neither rises nor falls on the
 * way in, so where it ends is simply where the pitch has climbed to meet it —
 * about x 4200. This used to be a table that rose from 4500 at the wall to the
 * ceiling's own 4940, and the rise was a measuring error: the sampling takes
 * the 95th percentile of z in the dormer's band of y, and past x 4000 there is
 * no recess left in that band to sample, so what it was reading was the
 * ceiling. Inside the recess — x 3000 to 4000 — the same sampling reads 4465,
 * 4350, 4452, 4533, 4490, 4438: level, within its own noise, and a pick on the
 * soffit's crown in `Scene3/View23` lands at 4521.
 *
 * The height is not chosen, though: THE CUT IS THE WINDOW with a shoulder of
 * plaster round it, so the crown is the opening's own crown at the room face
 * plus the shoulder, and the width is the opening's plus the same — nothing is
 * free to drift out of step with the window it is cut for. Which is also the
 * only way the two can be kept apart: with the recess and the opening described
 * by different curves, the recess once cleared the head by ten units, and ten
 * units of plaster at that distance is a black tick where they cross.
 */

/**
 * The door, in the `y1` wall and hard against the counter-wall corner. Closed in
 * every frame — the aperture map finds no way through this wall — so it is a
 * leaf in a frame, not an opening.
 *
 * Its extent is `Scene3/View21`'s own `door` hotspot rectangle, back-projected
 * through that view's depth onto the wall plane: 1.28 m wide, 2.13 m to the head.
 */
export const DOOR = { x0: 9350, x1: 11337, head: 3300, reveal: 80 } as const;

/**
 * The hole in the fireplace wall that the chimney goes back into.
 *
 * A fire opening cut through a flat panel looks through to the wallpaper behind
 * it, and no amount of black paint on the panel fixes that — what is missing is
 * depth, and depth cannot be faked at an opening you can walk up to. So the
 * wall is genuinely cut here and a recess built behind it. Nothing stands on
 * the other side of this wall, so the recess costs only the strip of plaster it
 * replaces.
 *
 * It is EXACTLY the fire opening the slips are cut to, and that is worth saying
 * because it went the other way first. A recess bigger than its opening hides
 * its own corners behind the surround — which is what you want when the surround
 * stands proud of the wall. Once the chimneypiece was set back INTO the wall
 * there was nothing left in front to hide them with, and every unit of margin
 * showed as a step of recess standing outside the fire. So the two are the same
 * hole: `mouth` stops at the back of the slips and the slips carry on from
 * there, edge to edge, with nothing overlapping and nothing coplanar.
 *
 * Its floor is the hearth stone's top, which is why it has no bottom edge
 * either: the stone plugs the wall from the boards up to 196 across the whole
 * width of the fireplace.
 *
 * `mouth` is the back of the slips panel, which the recess closes against. The
 * chimneypiece used to stand proud of the plaster, and cutting this hole turned
 * the void behind it into something an oblique look could see straight down —
 * so the piece is now set 275 INTO the wall until its slips meet it. What that
 * buys is that the recess and the fireplace share a mouth and there is no gap
 * between them anywhere. The hearth stone did not go back with it: its front
 * edge is measured, not modelled.
 */
export const CHIMNEY = { x0: 6664.8, x1: 7885.2, head: 1416.2, depth: 600, floor: 195.8, mouth: 2586 } as const;

/**
 * The three pictures on the walls, each an EDGE-TO-EDGE rectangle of the thing
 * itself: for the poster, the paper; for the other two, the outside of the
 * frame. They were read off a wide bake of each wall — a chart deliberately
 * larger than the picture, brightened, with a ten-texel grid over it — by
 * finding the row and the column where the plaster stops. That is a better
 * measurement than back-casting a corner through its depth level, which at
 * these distances moves a pick 300 along the wall, and it is why all three
 * moved by 40-200 units when it was redone: the painting had been losing its
 * bottom 200 units and its frame entirely.
 */
export const PICTURES = {
  /** the LONDON poster — the Grohe helmet, "he's watching you" — paper, unframed */
  poster: { y0: 4028, y1: 5368, z0: 1848, z1: 3960 },
  /** the framed photograph: Churchill in a homburg with a woman beside him */
  photo: { y0: 10799, y1: 11701, z0: 1831, z1: 3013, frame: 34 },
  /** the painting over the mantel: a lifebuoy on the Atlantic, in a wide dark
   *  frame — the black band across the top of it is that frame, seen from below */
  painting: { x0: 6293, x1: 8413, z0: 2864, z1: 4384, frame: 110 },
  /**
   * And the four in the corner the armchair stands in, which the room went
   * without until they were measured off Scene2/View13, Scene2/View18,
   * Scene1/View33 and Scene3/View25 — every camera that sees that corner. Each
   * corner of each was read off a bake of the wall AROUND it — a chart
   * deliberately larger than the picture, at four units a texel, with a grid
   * over it — by finding the row and the column where the plaster stops. See
   * {@link file://../tools/bedsitwall.ts}.
   *
   * That is a better measurement than picking corners in a frame, and it is
   * why every one of these moved when it was redone: a picture in this corner
   * is forty pixels of a 512-wide frame, so a pick is a hundred units out and
   * three views disagree by three hundred. The print had been a fifth of its
   * own width to the right, hanging half on plaster.
   */
  /** the portrait on the window wall, in the pier between the corner and the
   *  first window: a bald man's head, three-quarters on, in a black frame */
  portrait: { y0: 4003, y1: 4770, z0: 2086, z1: 3032 },
  /** the dark frame on the fireplace wall, holding two pale uprights on a dark
   *  ground — a photograph of two figures, as near as its forty pixels say */
  sketch: { x0: 3569, x1: 4125, z0: 2237, z1: 2677 },
  /** the colour print below it and to the right: a crowded scene in yellows,
   *  greens and greys with a red patch in it, and the best-seen of the four */
  print: { x0: 4273, x1: 4913, z0: 1852, z1: 2287 },
  /**
   * And the one above the print, which NO camera in this room can see the
   * inside of: the standard lamp stands at 5,250, 3,900 with a shade half a
   * metre across between 2.48 m and 2.98 m up, and this picture is at 2.72 m to
   * 3.05 m directly behind it. Every view puts the shade over it. Its frame is
   * measured — three views agree on the edges — and it hangs here as a dark
   * plate with nothing in it, because a bare wall where the game has a picture
   * is a worse answer than a picture we admit we cannot read.
   */
  hidden: { x0: 4362, x1: 4826, z0: 2537, z1: 3041, frame: 42 },
  /* `frame` there is the moulding's measured width. Nothing draws it any more —
     the plate carries its own frame, as the other three do — but it is what that
     plate's border is cut to, so it stays here as the measurement it is. */
  /** how far a picture stands off the plaster */
  proud: 14,
} as const;

/**
 * The pendant over the middle of the room: a SLIP SHADE fixture, the American
 * Art Deco type of the 1930s, on a rod — a cast metal body stepped like a
 * ziggurat that only reflects, so it reads gold and dull from below, with six
 * flat pressed-glass shades slipped into slots round it. The shades flare out
 * past the body, their tops stepped like skyscrapers and their faces ribbed,
 * and they are the light: the bulb inside makes them glow while the metal
 * between them stays dark. A collar under the body, a boss under that, and a
 * small glass finial hanging from it that glows with the bulb. It is an
 * uplighter: the bulb throws at the ceiling, which is why the frames' ceiling is
 * as bright as the walls, and the light the page casts comes from the bulb.
 *
 * Read off `Scene2/View15` at eight times its size, which has it top centre:
 * sixty pixels across at a depth of 3,281 units puts the rim at about 380
 * units' radius, the collar twelve pixels wide at about 75, and the collar's
 * foot on the row that is 3,650 units up. The body there is gold and unlit and
 * only the shades are white — which is what says the body is metal, and what
 * names the type.
 *
 * ALL THAT IS LEFT OF IT HERE IS WHERE IT HANGS. It used to carry the whole
 * description as numbers — the finial's tip at 3,540, the collar's foot, the
 * rim at 4,200, the body's top and radius, six shades of a given width with
 * five ribs and three steps — because those numbers were what DREW it. They
 * stopped drawing anything when the fitting became an imported mesh, and nine
 * dead fields sat here describing a lamp that is not in the room.
 *
 * That is not merely untidy, it is how the bulb went wrong: `bulb: 3,900` was
 * one of them, still true of the drawn pendant and 775 units below the mesh
 * that replaced it, and it was read as gospel until a shadow map made the
 * mistake visible. What the fitting is now, as light and as an obstacle, comes
 * from the mesh's own boxes in {@link pendantFitting} — which cannot say
 * something the room does not draw.
 */
export const PENDANT = { x: 7300, y: 7600 } as const;

// ---------------------------------------------------------------------------
// The surfaces, as functions
// ---------------------------------------------------------------------------

function lerpTable(table: readonly (readonly [number, number])[], x: number): number {
  if (x <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const [xa, za] = table[i - 1], [xb, zb] = table[i];
    if (x <= xb) return za + ((zb - za) * (x - xa)) / (xb - xa);
  }
  return last[1];
}

const smoothstep = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));



/**
 * The dormer recess: the window's own opening, carried horizontally into the
 * roof until it reaches the outside of the wall, cutting whatever is in the way.
 *
 * That is the whole definition, and it is worth stating as a construction
 * rather than as measurements: take the opening the room sees — the window, its
 * dark border and the splayed reveal round them — and sweep it in a straight
 * line out of the room. Everything it passes through is gone. Nothing else is.
 * There is no shoulder of plaster round it, no crown of its own, no width but
 * the window's: the recess cannot be too large or too small, because it is not
 * a shape at all, only the window's shadow through the roof.
 *
 * So {@link ceilingAt} is the pitch, or the head of the opening where the head
 * stands higher, and the recess runs in only as far as the pitch takes to climb
 * to it — x 3117 at the flanks, x 4099 at the crown.
 *
 * What this replaced was a barrel with its own crown and its own half-width,
 * fitted to the 95th percentile of upward rays in the dormer's band of y. Every
 * number in it was a little too big, and each one had to be measured and then
 * argued with; this has nothing left to measure.
 */
function recessTop(y: number): number {
  for (const w of WINDOWS) {
    const head = windowHead(w, y);
    if (head !== null) return head;
  }
  return -Infinity;
}

/**
 * The height of the ceiling over any point of the floor: the pitch, or the head
 * of a dormer's opening where that stands higher. A HARD maximum — the two meet
 * along an edge, and the edge is cut, not blended.
 *
 * It used to be blended, over the last 140 units of height, for a reason worth
 * recording: the two surfaces meet along a curve, and a hard maximum sampled on
 * a grid that does not follow that curve comes out of the triangles as a saw
 * edge. The answer is not to blunt the edge but to make the grid follow it —
 * see {@link ceilingRails}, which is where the mesh gets the curve from, so
 * every quad is wholly recess or wholly pitch and the two share their corners
 * along it exactly.
 */
/**
 * The pendant's fitting as a SOLID: how far it reaches out, and the band of
 * height it fills. Not what it looks like — what stands in the way of light.
 *
 * A shadow map has to be told which geometry is the lamp itself, and it cannot
 * work that out from meshes that arrive bucketed by material. This is the one
 * place that knows, because it is the place that hangs the thing: the wings are
 * the widest part AND the box the fitting is placed by, so both numbers come
 * off the same box the placing does and cannot drift from it.
 */
export function pendantFitting(): { radius: number; z0: number; z1: number; bulb: number } {
  const top = ceilingAt(PENDANT.x, PENDANT.y);
  const origin = top - PENDANTWINGS_BOX.hi[2];
  return {
    radius: PENDANTWINGS_BOX.hi[0],
    z0: origin,
    z1: top,
    /**
     * WHERE THE LIGHT COMES FROM, and it had to be worked out here rather than
     * written down, because written down is how it went wrong.
     *
     * `PENDANT.bulb` used to say 3,900. That was true of the DRAWN pendant,
     * which stood on its finial's point at 3,540 with its rim at 4,200. This
     * fitting is hung from the plaster instead, so it occupies 4,280 to 4,940 —
     * and the bulb was left behind, 380 below the bottom of the lamp it belongs
     * to. Nothing complained: a point light does not care whether it is inside
     * its own shade, and the room had no shadows to make the mistake visible.
     * Giving the pendant a shadow map is what finally showed it up.
     *
     * So it is the middle of the golden inner shell — the piece this file's own
     * note calls "where the bulb sits" — which puts it at 4,685, and it moves
     * with the ceiling the way the rest of the fitting does.
     */
    bulb: origin + (PENDANTGLOW_BOX.lo[2] + PENDANTGLOW_BOX.hi[2]) / 2,
  };
}

export function ceilingAt(x: number, y: number): number {
  return Math.max(lerpTable(PITCH, x), recessTop(y));
}

/**
 * Where, across the room at depth `x`, the ceiling is recess and where it is
 * pitch: the room's two edges with each dormer's band cut into them.
 *
 * The opening's head stands over the pitch exactly where its half-ellipse is
 * above `A = (pitch − spring) / (crown − spring)`, so the band is the window's
 * centre plus and minus `half · √(1 − A²)`. Below the springing — the first
 * hundred units of depth, where the pitch has not yet climbed to the head's own
 * spring line — the whole opening is still cut, and the band is its full width
 * with a jamb standing in it: see {@link ceilingCheek}. As the pitch climbs the
 * band narrows and finally closes, which is the arch the recess ends in. Both
 * edges are always returned, degenerate at the centre line once the band has
 * closed, so the list is the same length at both ends of any strip and the mesh
 * can rail one to the other.
 */
export function ceilingRails(x: number): number[] {
  const out: number[] = [ROOM.y0];
  const pitch = lerpTable(PITCH, x);
  const rise = pitch - WINDOW.spring;
  for (const w of WINDOWS) {
    const c = (w.y0 + w.y1) / 2, half = (w.y1 - w.y0) / 2;
    // the head is a circle, so the band is a chord of it
    const band = rise <= 0 ? half : rise >= half ? 0 : Math.sqrt(half * half - rise * rise);
    out.push(c - band, c + band);
  }
  out.push(ROOM.y1);
  return out;
}

/**
 * How deep a jamb stands at the recess's edge at depth `x`: the opening's sides
 * are vertical below the springing, so where the pitch is lower than that the
 * recess's edge is a face, not a fold. It is a hundred units at the wall and
 * nothing by x 3117, and without it the ceiling has a slot in it.
 */
export function ceilingCheek(x: number): number {
  return Math.max(0, WINDOW.spring - lerpTable(PITCH, x));
}

/**
 * The head of a window at `y`, or `null` off the opening. A half-ellipse: taller
 * than a semicircle, which is what the frames show. At the glass (`splay` 0) it
 * spans the glass; at the room face it is wider and higher by the splay.
 */
export function windowHead(w: { y0: number; y1: number }, y: number, inset = 0): number | null {
  const half = (w.y1 - w.y0) / 2 - inset, c = (w.y0 + w.y1) / 2, d = y - c;
  if (Math.abs(d) >= half) return null;
  return WINDOW.spring + Math.sqrt(half * half - d * d);
}

/** the window `y` falls in — at the glass, or at the room face when `splay` is
 *  given — if any */
export function windowAt(y: number, splay = 0): (typeof WINDOWS)[number] | null {
  for (const w of WINDOWS) if (y > w.y0 - splay && y < w.y1 + splay) return w;
  return null;
}


// ---------------------------------------------------------------------------
// Charts — where each big surface's texture lives
// ---------------------------------------------------------------------------

/**
 * The rug on the floor.
 *
 * `Scene2/View15` looks straight down the room at it: its far edge sits on the
 * row of the frame that the camera's height and lens put 5,740 units out, and
 * its sides on the columns that put them 2,040 either side of the centre line —
 * a rug three metres across, roughly centred on the room.
 *
 * Its NEAR edge is below the bottom of every frame that could see it, so it
 * cannot be measured at all. It is laid square to the desk it sits in front of,
 * so it reaches past the desk's near end by what it reaches past the far one —
 * 860 either side, which puts the near edge at 5,760 and the rug's middle on the
 * desk's middle.
 *
 * `lift` is what keeps it off the boards. The rug is a separate quad over the
 * floor's own, and two coplanar surfaces are a coin toss the depth buffer
 * decides differently at every pixel; two units of pile is under a millimetre
 * and a hundred times what the buffer can tell apart at this range.
 */
export const RUG = { x0: 4850, x1: 9500, y0: 5760, y1: 10060, lift: 2 } as const;

/** the six surfaces big enough, and flat enough, to be worth a texture */
export type SurfaceId =
  | "window-wall" | "counter-wall" | "fireplace-wall" | "door-wall"
  | "floor" | "ceiling" | "street" | "door" | "poster" | "photo" | "painting"
  | "portrait" | "sketch" | "print" | "hidden" | "futility" | "rug";

export type V3 = [number, number, number];

/**
 * A surface's own coordinate system, in world units, and the two directions the
 * mapping has to run in: `at` for the baker, which starts from a texel and needs
 * the world point to look up in the frames, and `uvOf` for the mesh, which
 * starts from a corner and needs the texel.
 *
 * Every chart here is one of the room's axis planes, or — for the ceiling — a
 * height field over the floor plan, so all six are a straight world-space
 * projection with no seams and no packing. A cove at 45° stretches its texels by
 * √2 and nothing else is stretched at all.
 */
export interface Chart {
  id: SurfaceId;
  u0: number; u1: number; v0: number; v1: number;
  at(u: number, v: number): V3;
  normalAt(u: number, v: number): V3;
  uvOf(p: V3): [number, number];
  /**
   * This chart is what is seen THROUGH a hole, not a surface of the room, and the
   * baker's visibility test has to be turned inside out for it: a view may colour
   * a texel exactly when its depth along that ray is well beyond the plane
   * `x = through` — the glass — because what it is looking at is the street.
   * Test it the usual way and every view is rejected, since nothing in the room
   * is ever at the distance of a pane, let alone of the houses opposite.
   */
  through?: number;
  /**
   * Read the frame between its pixels rather than at them. A frame pixel cast
   * onto a plane far behind the glass covers many texels, and the nearest pixel
   * makes a staircase of them; the mean of the four around makes a picture that
   * is soft, which a street through a window at night is anyway.
   */
  smooth?: boolean;
  /**
   * Take the single best-placed view's pixel rather than the weighted mean of
   * every view that can see it.
   *
   * The floor wants this and the walls do not. A wall is looked at; the floor is
   * only ever *glanced along*, because the eye is 1.6 m above it and a SET frame
   * is the top 264 rows of the screen, so the nearest floor any camera can see is
   * already four metres away and every view of it is a grazing one. Averaging
   * sixty grazing views of a plank floor produces a brown fog with the planks
   * averaged out of it — which is exactly what the first bake of it was.
   */
  sharp?: boolean;
}

const WALL_TOP = 5000;

/**
 * How far up the window wall's chart the SLOPE reaches when it is unfolded onto
 * it — see {@link unfoldPitch}. The wall stops at the eaves and the slope goes
 * on from there, so the chart has to be taller than a wall by the slope's own
 * length, which is the hypotenuse of the pitch: 1,800 in and 1,540 up.
 */
const SLOPE_TOP = PITCH[0][1] + Math.hypot(ARRIS - ROOM.x0, ROOM.ceiling - PITCH[0][1]);

/**
 * Where a point of the sloping ceiling reads its texel in the WINDOW WALL's
 * chart: straight up the wall's own `v`, past the eaves, by the distance along
 * the slope from them.
 *
 * The slope is not a separate surface from the wall — it is the wall carrying
 * on past the eaves at a different angle, in the same paper, and giving it the
 * ceiling's chart made it the ceiling's colour. Unfolding it onto the wall is
 * how a chart is made to follow the plaster rather than the geometry, and it is
 * the same trick the window reveals use.
 */
function unfoldPitch(p: V3): [number, number] {
  return [p[1], PITCH[0][1] + Math.hypot(p[0] - ROOM.x0, p[2] - PITCH[0][1])];
}
/** the top of the dado rail, which the wall texture paints below — see
 *  bedsit-paint.ts; a reveal that borrows the wall's texture stays above it */
const DADO_TOP = 1400;

export const CHARTS: readonly Chart[] = [
  {
    id: "window-wall", u0: ROOM.y0, u1: ROOM.y1, v0: ROOM.floor, v1: SLOPE_TOP,
    at: (u, v) => [ROOM.x0, u, v], normalAt: () => [1, 0, 0], uvOf: (p) => [p[1], p[2]],
  },
  {
    id: "counter-wall", u0: ROOM.y0, u1: ROOM.y1, v0: ROOM.floor, v1: WALL_TOP,
    at: (u, v) => [ROOM.x1, u, v], normalAt: () => [-1, 0, 0], uvOf: (p) => [p[1], p[2]],
  },
  {
    id: "fireplace-wall", u0: ROOM.x0, u1: ROOM.x1, v0: ROOM.floor, v1: WALL_TOP,
    at: (u, v) => [u, ROOM.y0, v], normalAt: () => [0, 1, 0], uvOf: (p) => [p[0], p[2]],
  },
  {
    id: "door-wall", u0: ROOM.x0, u1: ROOM.x1, v0: ROOM.floor, v1: WALL_TOP,
    at: (u, v) => [u, ROOM.y1, v], normalAt: () => [0, -1, 0], uvOf: (p) => [p[0], p[2]],
  },
  {
    id: "floor", sharp: true, u0: ROOM.x0, u1: ROOM.x1, v0: ROOM.y0, v1: ROOM.y1,
    at: (u, v) => [u, v, ROOM.floor], normalAt: () => [0, 0, 1], uvOf: (p) => [p[0], p[1]],
  },
  {
    // The rug, which is its own chart and not part of the floor's. On the
    // floor's it would have had 554 by 440 of that texture's 1024 square, spread
    // over the largest thing in the room; on its own it has the whole of one,
    // which is four and a half units to a texel instead of eight and a half.
    // `smooth`, because a photograph of a pile carpet has no edges in it that
    // want keeping sharp, and the floor is seen at a grazing angle from every
    // standpoint there is.
    id: "rug", sharp: true, smooth: true,
    u0: RUG.x0, u1: RUG.x1, v0: RUG.y0, v1: RUG.y1,
    at: (u, v) => [u, v, ROOM.floor + RUG.lift], normalAt: () => [0, 0, 1],
    uvOf: (p) => [p[0], p[1]],
  },
  {
    // The leaf, which keeps the frames' own projection in every mode: it is not
    // made of a material the room repeats, it is one object, and the pixels of
    // it are right where they fall.
    id: "door",
    u0: DOOR.x0, u1: DOOR.x1, v0: ROOM.floor, v1: DOOR.head,
    at: (u, v) => [u, ROOM.y1 + DOOR.reveal, v], normalAt: () => [0, -1, 0], uvOf: (p) => [p[0], p[2]],
  },
  {
    // Paper on the counter wall: one view's own pixels, read between them, so
    // the lettering is as sharp as the frame had it
    id: "poster", sharp: true, smooth: true,
    u0: PICTURES.poster.y0, u1: PICTURES.poster.y1, v0: PICTURES.poster.z0, v1: PICTURES.poster.z1,
    at: (u, v) => [ROOM.x1 - PICTURES.proud, u, v], normalAt: () => [-1, 0, 0], uvOf: (p) => [p[1], p[2]],
  },
  {
    id: "photo", sharp: true, smooth: true,
    u0: PICTURES.photo.y0, u1: PICTURES.photo.y1, v0: PICTURES.photo.z0, v1: PICTURES.photo.z1,
    at: (u, v) => [ROOM.x1 - PICTURES.proud, u, v], normalAt: () => [-1, 0, 0], uvOf: (p) => [p[1], p[2]],
  },
  {
    id: "painting", sharp: true, smooth: true,
    u0: PICTURES.painting.x0, u1: PICTURES.painting.x1, v0: PICTURES.painting.z0, v1: PICTURES.painting.z1,
    at: (u, v) => [u, ROOM.y0 + PICTURES.proud, v], normalAt: () => [0, 1, 0], uvOf: (p) => [p[0], p[2]],
  },
  {
    // The portrait on the window wall, facing the room across the corner. Its
    // pier is narrow and the two views that hold it are oblique, so it is the
    // coarsest of the charts here — but it is a face, and a face at forty
    // texels is still a face.
    id: "portrait", sharp: true, smooth: true,
    u0: PICTURES.portrait.y0, u1: PICTURES.portrait.y1, v0: PICTURES.portrait.z0, v1: PICTURES.portrait.z1,
    at: (u, v) => [ROOM.x0 + PICTURES.proud, u, v], normalAt: () => [1, 0, 0], uvOf: (p) => [p[1], p[2]],
  },
  {
    id: "sketch", sharp: true, smooth: true,
    u0: PICTURES.sketch.x0, u1: PICTURES.sketch.x1, v0: PICTURES.sketch.z0, v1: PICTURES.sketch.z1,
    at: (u, v) => [u, ROOM.y0 + PICTURES.proud, v], normalAt: () => [0, 1, 0], uvOf: (p) => [p[0], p[2]],
  },
  {
    id: "print", sharp: true, smooth: true,
    u0: PICTURES.print.x0, u1: PICTURES.print.x1, v0: PICTURES.print.z0, v1: PICTURES.print.z1,
    at: (u, v) => [u, ROOM.y0 + PICTURES.proud, v], normalAt: () => [0, 1, 0], uvOf: (p) => [p[0], p[2]],
  },
  {
    // `hidden` has a chart so that a DRAWN plate can be laid on it, and it is
    // kept out of the list the baker is given: what a camera sees at this
    // rectangle is the lamp shade, so a projection of it would be a picture of
    // the shade. With no file it wears PAINT.hidden and nothing else.
    id: "hidden", sharp: true, smooth: true,
    u0: PICTURES.hidden.x0, u1: PICTURES.hidden.x1, v0: PICTURES.hidden.z0, v1: PICTURES.hidden.z1,
    at: (u, v) => [u, ROOM.y0 + PICTURES.proud, v], normalAt: () => [0, 1, 0], uvOf: (p) => [p[0], p[2]],
  },
  {
    // London, behind both windows at once: one plane WINDOW.street behind the
    // glass, wide enough to be looked at obliquely from either end of the room.
    // Sharp, so each texel is one view's own pixels and not several views'
    // disagreement about where a chimney is; the views disagree because the
    // street is not really a plane, and a smear of them is what the glass used to
    // show. What no view sees is grown from what one did.
    // The span is what an eye anywhere in the room can see through either
    // opening: from Scene2 the far window looks 20 m along this plane.
    id: "street", through: ROOM.x0 - WINDOW.reveal, sharp: true, smooth: true,
    u0: -8000, u1: 28000, v0: -5000, v1: 11000,
    at: (u, v) => [ROOM.x0 - WINDOW.reveal - WINDOW.street, u, v], normalAt: () => [1, 0, 0], uvOf: (p) => [p[1], p[2]],
  },
  {
    // the FLAT ceiling only: the slope belongs to the wall it runs down to
    id: "ceiling", u0: ARRIS, u1: ROOM.x1, v0: ROOM.y0, v1: ROOM.y1,
    at: (u, v) => [u, v, ceilingAt(u, v)],
    // the height field's own gradient, pointed down into the room
    normalAt: (u, v) => {
      const h = 30;
      const gx = (ceilingAt(u + h, v) - ceilingAt(u - h, v)) / (2 * h);
      const gy = (ceilingAt(u, v + h) - ceilingAt(u, v - h)) / (2 * h);
      const len = Math.hypot(gx, gy, 1);
      return [gx / len, gy / len, -1 / len];
    },
    uvOf: (p) => [p[0], p[1]],
  },
];

export const chartOf = (id: SurfaceId): Chart => CHARTS.find((c) => c.id === id)!;

// ---------------------------------------------------------------------------
// Triangles
// ---------------------------------------------------------------------------

/**
 * What a surface is when nothing has been projected onto it — and what the
 * reveals, the door and the glazing bars stay, because they are too narrow and
 * too oblique for any of the twenty-four views to have a clean look at.
 */
export const PAINT = {
  plaster: [0.72, 0.70, 0.65],
  ceiling: [0.78, 0.76, 0.71],
  /** the reveals: plastered, jambs, head and sill alike, a shade darker than
   *  the wall for the light they miss */
  reveal: [0.64, 0.62, 0.58],
  floor: [0.26, 0.19, 0.13],
  /** the rug, for the moment before its picture arrives: the mean of that
   *  picture, so the swap is a change of pattern and not of tone */
  rug: [0.29, 0.30, 0.31],
  sky: [0.46, 0.55, 0.68],
  bar: [0.13, 0.11, 0.09],
  door: [0.20, 0.14, 0.09],
  /**
   * The leaf's ground, between its raised bands.
   *
   * Nothing in this room casts a shadow and a band's face is parallel to the
   * ground it stands on, so light cannot separate them and paint has to. This
   * is 2.4 times darker than `deskwood`'s 0.072, which is enough to draw the
   * bands out and little enough that the whole leaf is still one dark thing —
   * at 0.055 the step was 1.3 and the door read as a single black rectangle.
   */
  doorGround: [0.030, 0.020, 0.013],
  frame: [0.40, 0.33, 0.25],
  /** the bowl, lit from inside: frosted glass that is its own light */
  glass: [0.97, 0.92, 0.76],
  /** the pictures with no rip to paint them: the poster's yellow, the photograph's black frame */
  poster: [0.82, 0.66, 0.20],
  photo: [0.08, 0.07, 0.06],
  painting: [0.30, 0.33, 0.36],
  /** the book on the armchair: Morgan Robertson's Futility, in brown cloth —
   *  what shows until its cover arrives */
  futility: [0.15, 0.10, 0.06],
  /** and the corner four: a face on a dark ground, two pale uprights on a
   *  darker one, a colour print, and the one behind the lamp shade, which is
   *  not a fallback at all — it is what that picture IS here */
  portrait: [0.28, 0.26, 0.24],
  sketch: [0.17, 0.16, 0.15],
  print: [0.42, 0.36, 0.26],
  hidden: [0.14, 0.10, 0.08],
  /** the same glass where the bulb is closest, at the bowl's waist */
  glow: [1.0, 0.94, 0.72],
  /** and at the collar, where it is thickest and the frames have it orange */
  amber: [1.0, 0.80, 0.42],
  /**
   * What is behind the imported fitting's wings. `amber` was measured on the
   * drawn pendant, where it showed as a band a few texels deep at the collar;
   * here it covers most of the bowl, and a colour that reads as a hot edge over
   * that much area reads as a floodlight. Same hue, taken down to where the
   * frames put the body of the glass rather than its brightest line.
   */
  pendantGlow: [0.66, 0.47, 0.22],
  brass: [0.62, 0.48, 0.24],
  bulb: [1.0, 0.98, 0.90],
  rose: [0.74, 0.72, 0.67],
} as const;

export interface Mesh {
  position: Float32Array;
  normal: Float32Array;
  colour: Float32Array;
  /** chart coordinates, 0..1 — meaningless on a part with no surface */
  uv: Float32Array;
  /** 1 for surfaces the light does not touch (the sky behind the glass) */
  unlit: Float32Array;
  count: number;
}

/**
 * What to pass as `unlit` for a lamp's own glass, so that it dims with its lamp.
 *
 * `unlit` is a number and not a flag: 0 is an ordinary surface, 1 is emissive
 * and belongs to no lamp, and these are emissive AND TIED — the index is the
 * lamp's own place in the page's `uLampAt`, plus two. Anything drawn with one of
 * these fades to an ordinary lit surface as its slider comes down, instead of
 * staying white over a room it is no longer lighting.
 */
export const EMIT = { pendant: 2, standard: 3, desk: 4 } as const;

/** a material a piece of furniture is made of, whose texture is a tile cut
 *  from the frames and laid over it by box-mapping — see bedsit-furniture.ts */
export type MaterialId = `mat:${string}`;

/** one draw call: the triangles of one chart, of one material, or the
 *  flat-painted remainder */
export interface Part {
  surface: SurfaceId | MaterialId | null;
  mesh: Mesh;
  /** which piece of furniture this came out of, for the pieces that can be
   *  taken out of the room one at a time; the shell has none */
  piece?: string;
}

export class Builder {
  private readonly parts = new Map<SurfaceId | MaterialId | null, {
    p: number[]; n: number[]; c: number[]; t: number[]; u: number[];
  }>();
  private chart: Chart | null = null;
  /** the material the quads that follow are made of, and how many world units
   *  one repeat of its tile covers — texture coordinates come from box-mapping
   *  the quad's own (untransformed) corners on the axis its normal is nearest */
  private mat: { id: MaterialId; scale: number } | null = null;

  /** build what follows in a material — `null` for flat paint or a chart */
  material(name: string | null, scale = 600): void {
    this.mat = name ? { id: `mat:${name}`, scale } : null;
  }
  private remap: ((p: V3) => [number, number]) | null = null;
  /** a turn about a vertical axis applied to everything built until it is
   *  cleared — how a piece of furniture stands askew to the walls */
  private turn: { cx: number; cy: number; c: number; s: number } | null = null;

  /** build what follows turned by `yaw` radians about the vertical through
   *  `(cx, cy)`; `place(null)` builds square to the room again */
  place(at: { cx: number; cy: number; yaw: number } | null): void {
    this.turn = at ? { cx: at.cx, cy: at.cy, c: Math.cos(at.yaw), s: Math.sin(at.yaw) } : null;
  }

  private turned(p: V3): V3 {
    const t = this.turn;
    if (!t) return p;
    const dx = p[0] - t.cx, dy = p[1] - t.cy;
    return [t.cx + dx * t.c - dy * t.s, t.cy + dx * t.s + dy * t.c, p[2]];
  }

  /**
   * The chart the quads that follow belong to; `null` for flat paint. `remap`,
   * if given, says where in the chart's own coordinates a world point reads its
   * texel, instead of the chart's own projection — how a face that is not in
   * the chart's plane (a window reveal) borrows the wall's texture, by being
   * unfolded onto it.
   */
  on(chart: Chart | null, remap: ((p: V3) => [number, number]) | null = null): void {
    this.chart = chart;
    this.remap = remap;
  }

  /** a quad in world coordinates, wound a..d; the normal is its own plane's,
   *  flipped to face `towards` when that is given */
  quad(a: V3, b: V3, c: V3, d: V3, paint: readonly number[], towards?: V3, unlit = 0,
       corners?: readonly [number, number][]): void {
    // the normal, from the corners as built (before any turn), so a material's
    // box-mapping sees the piece square
    const e1: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: V3 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1];
    let ny = e1[2] * e2[0] - e1[0] * e2[2];
    let nz = e1[0] * e2[1] - e1[1] * e2[0];
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    if (towards && nx * towards[0] + ny * towards[1] + nz * towards[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const local: V3[] = [a, b, c, a, c, d];
    /**
     * `corners`: where in the material's picture each of a, b, c, d sits.
     *
     * Box-mapping repeats a tile over the world's axes and does not care which
     * part of the picture lands where, which is right for grain and cloth and
     * useless for a PICTURE — the word Memories is in one place on that album's
     * cover and nowhere else. Given four coordinates, the quad wears the image
     * as drawn instead, and the one thing the caller has to get right is that
     * they run in the same order the corners do.
     */
    const pinned = corners && [corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]];
    // box-mapped texture coordinates, in repeats of the tile
    const uvs: [number, number][] = local.map((v, i) => {
      if (pinned) return [pinned[i][0], pinned[i][1]];
      if (!this.mat) return [0, 0];
      const s = this.mat.scale, ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      return ax >= ay && ax >= az ? [v[1] / s, v[2] / s] : ay >= az ? [v[0] / s, v[2] / s] : [v[0] / s, v[1] / s];
    });
    if (this.turn) {
      a = this.turned(a); b = this.turned(b); c = this.turned(c); d = this.turned(d);
      const t = this.turn;
      [nx, ny] = [nx * t.c - ny * t.s, nx * t.s + ny * t.c];
    }
    const key = this.chart?.id ?? this.mat?.id ?? null;
    let bucket = this.parts.get(key);
    if (!bucket) this.parts.set(key, (bucket = { p: [], n: [], c: [], t: [], u: [] }));
    [a, b, c, a, c, d].forEach((v, i) => {
      bucket!.p.push(...glOf(v[0], v[1], v[2]));
      bucket!.n.push(...glOf(nx, ny, nz));
      bucket!.c.push(paint[0], paint[1], paint[2]);
      if (this.chart) {
        const [cu, cv] = this.remap ? this.remap(v) : this.chart.uvOf(v);
        bucket!.t.push((cu - this.chart.u0) / (this.chart.u1 - this.chart.u0),
          (cv - this.chart.v0) / (this.chart.v1 - this.chart.v0));
      } else bucket!.t.push(uvs[i][0], uvs[i][1]);
      bucket!.u.push(unlit);
    });
  }

  /**
   * A mesh somebody else made: the triangles of an imported model, given in
   * this piece's own frame and offset to where it stands.
   *
   * Two things it does that `quad` cannot. Its normals are averaged over the
   * triangles meeting at each vertex and weighted by their area — a modelled
   * surface is meant to be smooth, and per-face normals would show every one
   * of its facets. And its texture coordinates are box-mapped from the
   * untransformed positions exactly as a quad's are, so a mesh that arrived
   * with no texture coordinates of its own still wears the room's materials.
   */
  mesh(position: Float32Array, index: ArrayLike<number>, offset: V3, paint: readonly number[], unlit = 0,
       flat = false, uv: Float32Array | null = null): void {
    const n = new Float32Array(position.length);
    // `flat` leaves the averaging undone and gives each triangle its own normal
    // below. It costs NOTHING — the buckets already carry one entry per triangle
    // corner, so nothing is shared there but the normal — and it is what a piece
    // made of BOXES needs. A box's corner is shared by three faces at right
    // angles, so an averaged normal there points diagonally out of the corner
    // and every flat face shades as though the box were a ball: sides that fall
    // dark with no edge to explain it, which reads as a lighting fault and is a
    // mesh one. Smooth is right for what a generator makes — a chair, a pillow,
    // a bentwood stand — and wrong for joinery.
    for (let i = 0; !flat && i < index.length; i += 3) {
      const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
      const e1 = [position[b] - position[a], position[b + 1] - position[a + 1], position[b + 2] - position[a + 2]];
      const e2 = [position[c] - position[a], position[c + 1] - position[a + 1], position[c + 2] - position[a + 2]];
      // the cross product's length is twice the triangle's area, so summing it
      // unnormalized is already the area weighting a vertex normal wants
      const fx = e1[1] * e2[2] - e1[2] * e2[1];
      const fy = e1[2] * e2[0] - e1[0] * e2[2];
      const fz = e1[0] * e2[1] - e1[1] * e2[0];
      for (const v of [a, b, c]) { n[v] += fx; n[v + 1] += fy; n[v + 2] += fz; }
    }
    const key = this.chart?.id ?? this.mat?.id ?? null;
    let bucket = this.parts.get(key);
    if (!bucket) this.parts.set(key, (bucket = { p: [], n: [], c: [], t: [], u: [] }));
    const s = this.mat?.scale ?? 1;
    for (let i = 0; i < index.length; i += 3) {
      const tri = [index[i] * 3, index[i + 1] * 3, index[i + 2] * 3];
      // Which axis a material box-maps on is the TRIANGLE's business, not each
      // corner's: `quad` picks it once from the face's own normal, and it has to
      // be picked once here too. Picking it per vertex off the smoothed normals
      // lets one triangle project its three corners onto three different planes,
      // which on anything with an edge in it — the cupboard, the counter — drags
      // the texture across the face in smears the size of the furniture.
      const e1 = [position[tri[1]] - position[tri[0]], position[tri[1] + 1] - position[tri[0] + 1], position[tri[1] + 2] - position[tri[0] + 2]];
      const e2 = [position[tri[2]] - position[tri[0]], position[tri[2] + 1] - position[tri[0] + 1], position[tri[2] + 2] - position[tri[0] + 2]];
      const fx = Math.abs(e1[1] * e2[2] - e1[2] * e2[1]);
      const fy = Math.abs(e1[2] * e2[0] - e1[0] * e2[2]);
      const fz = Math.abs(e1[0] * e2[1] - e1[1] * e2[0]);
      const axis = fx >= fy && fx >= fz ? 0 : fy >= fz ? 1 : 2;
      // the face's own normal, unsigned above for the axis pick and signed here
      const gx = e1[1] * e2[2] - e1[2] * e2[1];
      const gy = e1[2] * e2[0] - e1[0] * e2[2];
      const gz = e1[0] * e2[1] - e1[1] * e2[0];
      for (const v of tri) {
        const local: V3 = [position[v] + offset[0], position[v + 1] + offset[1], position[v + 2] + offset[2]];
        let nx = flat ? gx : n[v], ny = flat ? gy : n[v + 1], nz = flat ? gz : n[v + 2];
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        if (this.chart) {
          const [cu, cv] = this.remap ? this.remap(local) : this.chart.uvOf(local);
          bucket.t.push((cu - this.chart.u0) / (this.chart.u1 - this.chart.u0),
            (cv - this.chart.v0) / (this.chart.v1 - this.chart.v0));
        } else if (uv) {
          // The mesh brought its own. Box-mapping is what you do to a surface
          // that has no opinion about where a texture goes: it repeats a tile
          // over the world's axes and asks only how many units to a repeat. An
          // ATLAS has an opinion about every triangle — the gold sheer stripe is
          // three texels in one place and nowhere else — and the only thing that
          // knows which three is the file's own coordinates.
          bucket.t.push(uv[v / 3 * 2], uv[v / 3 * 2 + 1]);
        } else if (this.mat) {
          if (axis === 0) bucket.t.push(local[1] / s, local[2] / s);
          else if (axis === 1) bucket.t.push(local[0] / s, local[2] / s);
          else bucket.t.push(local[0] / s, local[1] / s);
        } else bucket.t.push(0, 0);
        const p = this.turned(local);
        if (this.turn) { const t = this.turn; [nx, ny] = [nx * t.c - ny * t.s, nx * t.s + ny * t.c]; }
        bucket.p.push(...glOf(p[0], p[1], p[2]));
        bucket.n.push(...glOf(nx, ny, nz));
        bucket.c.push(paint[0], paint[1], paint[2]);
        bucket.u.push(unlit);
      }
    }
  }

  /**
   * A straight tube from `a` to `b` of radius `r`: a prism of `segments` sides,
   * open at the ends — a bed rail, a spindle, a rod. The ends are hidden inside
   * whatever they meet, which is what a tube's ends are.
   */
  tube(a: V3, b: V3, r: number, segments: number, paint: readonly number[], unlit = 0): void {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
    const d: V3 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len];
    const ref: V3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let u: V3 = [d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]];
    const ul = Math.hypot(u[0], u[1], u[2]) || 1;
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    const v: V3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
    const ring = (end: V3, k: number): V3 => {
      const th = (2 * Math.PI * k) / segments, c = Math.cos(th) * r, sn = Math.sin(th) * r;
      return [end[0] + u[0] * c + v[0] * sn, end[1] + u[1] * c + v[1] * sn, end[2] + u[2] * c + v[2] * sn];
    };
    for (let k = 0; k < segments; k++) {
      const p0 = ring(a, k), p1 = ring(a, k + 1), p2 = ring(b, k + 1), p3 = ring(b, k);
      const out: V3 = [(p0[0] + p2[0]) / 2 - (a[0] + b[0]) / 2, (p0[1] + p2[1]) / 2 - (a[1] + b[1]) / 2, (p0[2] + p2[2]) / 2 - (a[2] + b[2]) / 2];
      this.quad(p0, p1, p2, p3, paint, out, unlit);
    }
  }

  /**
   * A roll along a path: tubes between consecutive points with a sphere at each
   * joint, so a polyline reads as one continuous rounded edge — the rolled top
   * of a sofa's back turning into its arms and scrolling down at the front.
   */
  sweep(path: readonly V3[], r: number, segments: number, paint: readonly number[], unlit = 0): void {
    for (let i = 0; i + 1 < path.length; i++) this.tube(path[i], path[i + 1], r, segments, paint, unlit);
    for (const p of path) this.sphere(p, r, segments, paint, unlit);
  }

  /**
   * A bent tube along a path: ONE surface, where `sweep` makes a chain of them.
   *
   * `sweep` lays an independent cylinder between each pair of points and drops a
   * ball on every joint to hide what that costs. Two things it costs. Each
   * cylinder picks its cross-section off a reference axis chosen by whether the
   * segment is steeper than 26 degrees, so the ring's PHASE jumps where the path
   * crosses that line and the facets stop meeting end to end. And `quad` gives
   * every face its own normal, so each cylinder shades as a separate object and
   * a curve made of them reads as a row of sausages — which on the bed's head
   * rail, a bar of radius 27 turning a radius of 500 through a right angle and
   * standing at eye level, is the most looked-at line on the bed.
   *
   * This carries ONE ring along the whole path. At each station the ring turns
   * by the least rotation that takes the last segment's direction to the next
   * one — parallel transport, which is the transport that adds no twist of its
   * own — and the station's own direction is the mean of the segments either
   * side, so the ring sits square to the curve rather than to one chord of it.
   * The surface then goes to `mesh`, which averages normals across the seams:
   * the facets line up end to end and the tube shades as the round bar it is.
   *
   * Open at both ends, like `tube` — a rail's ends are inside the posts.
   */
  bend(path: readonly V3[], r: number, segments: number, paint: readonly number[], unlit = 0): void {
    const pts: V3[] = [];
    for (const q of path) {
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(q[0] - last[0], q[1] - last[1], q[2] - last[2]) > 1e-6) pts.push([q[0], q[1], q[2]]);
    }
    if (pts.length < 2) return;
    const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const seg: V3[] = [];
    for (let i = 0; i + 1 < pts.length; i++) seg.push(unit([pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]]));
    // the direction the ring stands square to at each station: the mean of the
    // two chords meeting there, so a station is a mitre and not a butt joint
    const tan: V3[] = pts.map((_, i) => {
      if (i === 0) return seg[0];
      if (i === pts.length - 1) return seg[seg.length - 1];
      return unit([seg[i - 1][0] + seg[i][0], seg[i - 1][1] + seg[i][1], seg[i - 1][2] + seg[i][2]]);
    });
    let u = unit(cross(tan[0], Math.abs(tan[0][2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    const position = new Float32Array(pts.length * segments * 3);
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) {
        // Rodrigues about the axis between the two tangents, by the angle
        // between them: the rotation that moves the ring the least
        const t0 = tan[i - 1], t1 = tan[i];
        const ax = cross(t0, t1);
        const sn = Math.hypot(ax[0], ax[1], ax[2]);
        if (sn > 1e-9) {
          const k: V3 = [ax[0] / sn, ax[1] / sn, ax[2] / sn];
          const cs = t0[0] * t1[0] + t0[1] * t1[1] + t0[2] * t1[2];
          const kd = k[0] * u[0] + k[1] * u[1] + k[2] * u[2], kxu = cross(k, u);
          u = unit([u[0] * cs + kxu[0] * sn + k[0] * kd * (1 - cs),
            u[1] * cs + kxu[1] * sn + k[1] * kd * (1 - cs),
            u[2] * cs + kxu[2] * sn + k[2] * kd * (1 - cs)]);
        }
      }
      // square the ring up against drift, then take the second axis from it
      const t = tan[i], d = u[0] * t[0] + u[1] * t[1] + u[2] * t[2];
      u = unit([u[0] - t[0] * d, u[1] - t[1] * d, u[2] - t[2] * d]);
      const v = cross(t, u);
      for (let k = 0; k < segments; k++) {
        const th = (2 * Math.PI * k) / segments, c = Math.cos(th) * r, sn = Math.sin(th) * r;
        const at = (i * segments + k) * 3;
        position[at] = pts[i][0] + u[0] * c + v[0] * sn;
        position[at + 1] = pts[i][1] + u[1] * c + v[1] * sn;
        position[at + 2] = pts[i][2] + u[2] * c + v[2] * sn;
      }
    }
    const index = new Uint16Array((pts.length - 1) * segments * 6);
    let w = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      for (let k = 0; k < segments; k++) {
        const j = (k + 1) % segments;
        const a = i * segments + k, b = i * segments + j, c = (i + 1) * segments + j, d = (i + 1) * segments + k;
        index[w++] = a; index[w++] = b; index[w++] = c;
        index[w++] = a; index[w++] = c; index[w++] = d;
      }
    }
    this.mesh(position, index, [0, 0, 0], paint, unlit);
  }

  /**
   * A turned member: `lathe`'s profile, `bend`'s shading.
   *
   * `lathe` builds its wall out of quads and `quad` gives each face its own
   * normal, so a twelve-sided post shades as twelve flat strips with a hard
   * edge between them. That is RIGHT for most of what is turned in this room —
   * a lamp's stem is small and a scalloped shade wants its facets — and wrong
   * for a member you stand beside, where the facets are the only reason it does
   * not read as a round bar.
   *
   * So this is the opt-in: the same rings, shared between neighbours and handed
   * to `mesh`, whose normals are averaged. It rounds the corners of the profile
   * as well as the wall, which is what cast brass looks like anyway; a profile
   * whose corner must stay a corner belongs in `lathe`.
   */
  spun(cx: number, cy: number, rings: readonly (readonly [number, number])[], segments: number,
       paint: readonly number[], unlit = 0): void {
    if (rings.length < 2) return;
    const position = new Float32Array(rings.length * segments * 3);
    for (let i = 0; i < rings.length; i++) {
      const [r, z] = rings[i];
      for (let k = 0; k < segments; k++) {
        const th = (2 * Math.PI * k) / segments, at = (i * segments + k) * 3;
        position[at] = cx + r * Math.cos(th);
        position[at + 1] = cy + r * Math.sin(th);
        position[at + 2] = z;
      }
    }
    const index = new Uint16Array((rings.length - 1) * segments * 6);
    let w = 0;
    for (let i = 0; i + 1 < rings.length; i++) {
      for (let k = 0; k < segments; k++) {
        const j = (k + 1) % segments;
        const a = i * segments + k, b = i * segments + j, c = (i + 1) * segments + j, d = (i + 1) * segments + k;
        index[w++] = a; index[w++] = b; index[w++] = c;
        index[w++] = a; index[w++] = c; index[w++] = d;
      }
    }
    this.mesh(position, index, [0, 0, 0], paint, unlit);
  }

  /** a sphere, as a lathe */
  sphere(c: V3, r: number, segments: number, paint: readonly number[], unlit = 0): void {
    const rings: [number, number][] = [];
    const n = Math.max(4, segments >> 1);
    for (let i = 0; i <= n; i++) { const t = (Math.PI * i) / n; rings.push([Math.max(0.5, r * Math.sin(t)), c[2] - r * Math.cos(t)]); }
    this.lathe(c[0], c[1], rings, segments, paint, unlit);
  }

  /** a flat disc in a plane normal to one axis (`axis` 0, 1 or 2), facing `dir` */
  disc(c: V3, axis: 0 | 1 | 2, dir: 1 | -1, r: number, segments: number, paint: readonly number[], unlit = 0): void {
    const a1 = ((axis + 1) % 3) as 0 | 1 | 2, a2 = ((axis + 2) % 3) as 0 | 1 | 2;
    const at = (k: number): V3 => {
      const th = (2 * Math.PI * k) / segments, p: V3 = [c[0], c[1], c[2]];
      p[a1] += r * Math.cos(th); p[a2] += r * Math.sin(th);
      return p;
    };
    const n: V3 = [0, 0, 0]; n[axis] = dir;
    // a triangle as a quad with its last corner doubled: the normal comes from
    // the first three, so the doubled one must not be the centre
    for (let k = 0; k < segments; k++) this.quad(c, at(k), at(k + 1), at(k + 1), paint, n, unlit);
  }

  /** an axis-aligned box, all six faces, normals outward */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, paint: readonly number[], unlit = 0): void {
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], paint, [0, 0, -1], unlit);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], paint, [0, 0, 1], unlit);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], paint, [0, -1, 0], unlit);
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], paint, [0, 1, 0], unlit);
    this.quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], paint, [-1, 0, 0], unlit);
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], paint, [1, 0, 0], unlit);
  }

  /**
   * A surface of revolution about a vertical axis at `(cx, cy)`: `rings` of
   * radius and height, joined by quads round `segments` steps. `scallop`, if
   * given, raises or lowers the LAST ring by angle, which is how a rim gets its
   * petals, and swells its radius a little with it.
   */
  lathe(
    cx: number, cy: number, rings: readonly (readonly [number, number])[], segments: number,
    paint: readonly number[] | ((ring: number) => readonly number[]), unlit = 0,
    scallop?: (theta: number) => number,
  ): void {
    const at = (i: number, k: number): V3 => {
      const th = (2 * Math.PI * k) / segments;
      let [r, z] = rings[i];
      if (scallop && i === rings.length - 1) { const dz = scallop(th); z += dz; r += dz * 0.35; }
      return [cx + r * Math.cos(th), cy + r * Math.sin(th), z];
    };
    for (let i = 0; i + 1 < rings.length; i++) {
      const colour = typeof paint === "function" ? paint(i) : paint;
      for (let k = 0; k < segments; k++) {
        b: {
          const a = at(i, k), bq = at(i, k + 1), c = at(i + 1, k + 1), d = at(i + 1, k);
          // the outward normal: away from the axis, which `towards` settles
          const mx = (a[0] + c[0]) / 2 - cx, my = (a[1] + c[1]) / 2 - cy;
          this.quad(a, bq, c, d, colour, [mx, my, 0], unlit);
          break b;
        }
      }
    }
  }

  done(): Part[] {
    return [...this.parts].map(([surface, k]) => ({
      surface,
      mesh: {
        position: new Float32Array(k.p), normal: new Float32Array(k.n), colour: new Float32Array(k.c),
        uv: new Float32Array(k.t), unlit: new Float32Array(k.u), count: k.p.length / 3,
      },
    }));
  }
}

/** the y values the window wall and the ceiling are cut at: every 40 units, plus
 *  every edge that matters, so an opening never lands mid-quad */
function yStops(): number[] {
  const s = new Set<number>();
  for (let y = ROOM.y0; y <= ROOM.y1; y += 40) s.add(y);
  s.add(ROOM.y1);
  for (const w of WINDOWS) {
    // the recess's edge IS the opening's, since the recess is the opening swept
    const c = (w.y0 + w.y1) / 2, vh = (w.y1 - w.y0) / 2;
    for (const e of [w.y0, w.y1, w.y0 + WINDOW.frame, w.y1 - WINDOW.frame]) s.add(e);
    // the arch is steep where it meets the pitch: cut it finer there
    for (let i = 1; i <= 4; i++) { s.add(c - vh + i * 12); s.add(c + vh - i * 12); }
    s.add(c - WINDOW.mullion); s.add(c + WINDOW.mullion);
  }
  return [...s].filter((y) => y >= ROOM.y0 && y <= ROOM.y1).sort((a, b) => a - b);
}

/**
 * The whole shell, as one draw call per chart plus one for everything flat.
 *
 * Everything vertical is built as strips between {@link yStops} (or between x
 * stops), so a surface whose top edge slopes — the window wall under the cove,
 * the arch of a window head — comes out as trapezoids that share their corners
 * with the ceiling above them. Nothing is a rectangle that ought to be a
 * trapezoid, which is why there is no crack anywhere along the eaves.
 */
export function buildRoom(): Part[] {
  const b = new Builder();
  const { x0, x1, y0, y1, floor, ceiling } = ROOM;
  const ys = yStops();

  // -- floor -----------------------------------------------------------------
  b.on(chartOf("floor"));
  b.quad([x0, y0, floor], [x1, y0, floor], [x1, y1, floor], [x0, y1, floor], PAINT.floor, [0, 0, 1]);
  // and the rug on it, its own quad on its own chart, two units up
  b.on(chartOf("rug"));
  const rz = floor + RUG.lift;
  b.quad([RUG.x0, RUG.y0, rz], [RUG.x1, RUG.y0, rz], [RUG.x1, RUG.y1, rz], [RUG.x0, RUG.y1, rz],
    PAINT.rug, [0, 0, 1]);

  // -- the ceiling: flat beyond the pitch, the vaults cut into the rest ------
  //
  // Strip by strip in x, and RAILED: each strip's y stops are the vault bands'
  // own edges at each of its ends ({@link ceilingRails}), interpolated across
  // it. Every quad is therefore wholly vault or wholly pitch, and the edge
  // between them is where the mesh's own corners are — a cut, not a blend. It
  // also takes fewer triangles than a fixed grid did: the pitch does not vary
  // along y at all, so outside a band one quad per segment is exact.
  // the flat, on its own chart, from the arris in
  b.on(chartOf("ceiling"));
  b.quad([ARRIS, y0, ceiling], [x1, y0, ceiling], [x1, y1, ceiling], [ARRIS, y1, ceiling], PAINT.ceiling, [0, 0, -1]);
  // and the slope, on the WINDOW WALL's chart, unfolded up it
  b.on(chartOf("window-wall"), unfoldPitch);
  // Each band is subdivided in a PARAMETER across it, not in y, so that both
  // ends of a strip are cut the same number of times and the quads between them
  // close. The parameter's stops are the wall's own y stops, taken where the
  // band is widest — at the wall itself — so the ceiling and the window wall
  // meet along the arch on the same corners, with no T-junction to crack open.
  const bandStops = ceilingRails(x0).reduce<number[][]>((out, _, i, rails) => {
    if (i % 2 === 1 && i + 1 < rails.length) {
      const lo = rails[i], hi = rails[i + 1];
      const inside = ys.filter((y) => y > lo && y < hi).map((y) => (y - lo) / (hi - lo));
      out.push([0, ...inside, 1]);
    }
    return out;
  }, []);
  for (let x = x0; x < ARRIS; x += 50) {
    const xb = Math.min(x + 50, ARRIS);
    const a = ceilingRails(x), c = ceilingRails(xb);
    for (let i = 0; i + 1 < a.length; i++) {
      // the odd segments are the bands, and only they curve along y
      const ts = i % 2 === 1 ? bandStops[(i - 1) / 2] : [0, 1];
      for (let k = 0; k + 1 < ts.length; k++) {
        const t0 = ts[k], t1 = ts[k + 1];
        const ya0 = a[i] + (a[i + 1] - a[i]) * t0, ya1 = a[i] + (a[i + 1] - a[i]) * t1;
        const yb0 = c[i] + (c[i + 1] - c[i]) * t0, yb1 = c[i] + (c[i + 1] - c[i]) * t1;
        if (ya0 === ya1 && yb0 === yb1) continue;
        b.quad(
          [x, ya0, ceilingAt(x, ya0)], [xb, yb0, ceilingAt(xb, yb0)],
          [xb, yb1, ceilingAt(xb, yb1)], [x, ya1, ceilingAt(x, ya1)],
          PAINT.ceiling, [0, 0, -1],
        );
      }
    }
    // the jambs of the recess: where the pitch is still below the opening's
    // spring line, the recess's edge is a vertical face and not a fold
    if (ceilingCheek(x) > 0) {
      const za = Math.min(WINDOW.spring, lerpTable(PITCH, x));
      const zb = Math.min(WINDOW.spring, lerpTable(PITCH, xb));
      for (let i = 1; i + 1 < a.length; i += 2) {
        for (const [edge, into] of [[a[i], 1], [a[i + 1], -1]] as const) {
          b.quad(
            [x, edge, za], [xb, edge, zb], [xb, edge, WINDOW.spring], [x, edge, WINDOW.spring],
            PAINT.reveal, [0, into, 0],
          );
        }
      }
    }
  }

  // -- the window wall, x0: strips, with the two openings cut out ------------
  // The openings here are the room-face ones, wider than the glass by the splay.
  b.on(chartOf("window-wall"));
  for (let i = 0; i + 1 < ys.length; i++) {
    const ya = ys[i], yb = ys[i + 1], mid = (ya + yb) / 2;
    const top = (y: number): number => ceilingAt(x0, y);
    const w = windowAt(mid);
    const ha = w && windowHead(w, ya), hb = w && windowHead(w, yb);
    if (!w) {
      b.quad([x0, ya, floor], [x0, yb, floor], [x0, yb, top(yb)], [x0, ya, top(ya)], PAINT.plaster, [1, 0, 0]);
      continue;
    }
    // Under the sill the opening is closed, and closed with WALL: the dado runs
    // straight through under the window, boards, skirting and all, and simply
    // stops where the sill is — the rail's own line at 1400 is above the sill,
    // so what shows is the boarding cut off at 845. It is drawn on the wall's
    // chart like the rest of the wall, so the texture continues into it with
    // nothing to line up; above the head the spandrel to the recess is wall
    // again. The mullion is NOT wall: the opening is one opening, and the bar
    // down the middle of it stands at the glass, in the reveals below.
    b.on(chartOf("window-wall"));
    b.quad([x0, ya, floor], [x0, yb, floor], [x0, yb, WINDOW.sill], [x0, ya, WINDOW.sill], PAINT.plaster, [1, 0, 0]);
    b.quad(
      [x0, ya, ha ?? WINDOW.spring], [x0, yb, hb ?? WINDOW.spring],
      [x0, yb, top(yb)], [x0, ya, top(ya)], PAINT.plaster, [1, 0, 0],
    );
  }

  // -- the reveals: each opening is a splayed box out to the glass -----------
  // Every strip runs from a point on the glass to its counterpart on the room
  // face, which is further from the centre line by the splay; so the sill, the
  // soffit and the jambs all lean outwards, and the head at the wall is higher.
  //
  // They are plastered like the wall, and wear the wall's texture: each face is
  // unfolded onto the window wall's chart — the soffit upwards past the head,
  // the jambs outwards past the opening — so the plaster runs round the corner.
  // The sill and the foot of each jamb are lifted clear of the dado's rows of
  // the chart, since a reveal is plaster to the floor and the dado stops at it.
  const wallChart = chartOf("window-wall");
  const inward = (p: V3): number => x0 - p[0];
  const onSoffit = (p: V3): [number, number] => [p[1], p[2] + inward(p)];
  const onSill = (p: V3): [number, number] => [p[1], WINDOW.spring + 300 + inward(p)];
  const onJamb = (side: 1 | -1) => (p: V3): [number, number] => [p[1] - side * inward(p), Math.max(p[2], DADO_TOP) + 300];
  b.on(null);
  const xg = x0 - WINDOW.reveal;
  for (const w of WINDOWS) {
    const strips = ys.filter((y) => y >= w.y0 && y <= w.y1);
    const c = (w.y0 + w.y1) / 2;
    for (let i = 0; i + 1 < strips.length; i++) {
      const ya = strips[i], yb = strips[i + 1], mid = (ya + yb) / 2;
      const ha = windowHead(w, ya) ?? WINDOW.spring, hb = windowHead(w, yb) ?? WINDOW.spring;
      // the reveal runs straight out: the same y and the same head at both faces
      const wa = ya, wb = yb;
      const hwa = ha, hwb = hb;
      // The sash, at the glass: the mullion is a pier of glazing bar standing
      // in the opening, the frame a band following the head and the two jambs,
      // and the bars divide the light into rows of panes.
      const sill = WINDOW.sill, rail = sill + WINDOW.frame;
      if (Math.abs(mid - c) < WINDOW.mullion || mid < w.y0 + WINDOW.frame || mid > w.y1 - WINDOW.frame) {
        b.quad([xg, ya, sill], [xg, yb, sill], [xg, yb, hb], [xg, ya, ha], PAINT.bar, [1, 0, 0]);
      } else {
        // the head band, between the opening's arch and the daylight's own —
        // a band of the frame's width measured ACROSS the arch, not down it,
        // so it does not fatten at the crown
        const ga = windowHead(w, ya, WINDOW.frame) ?? rail, gb = windowHead(w, yb, WINDOW.frame) ?? rail;
        b.quad([xg, ya, ga], [xg, yb, gb], [xg, yb, hb], [xg, ya, ha], PAINT.bar, [1, 0, 0]);
        b.quad([xg, ya, sill], [xg, yb, sill], [xg, yb, rail], [xg, ya, rail], PAINT.bar, [1, 0, 0]);
        for (let k = -1; k <= 1; k++) {
          const z = WINDOW.bar.middle + k * WINDOW.bar.spacing, t = WINDOW.bar.thick / 2;
          b.quad([xg, ya, z - t], [xg, yb, z - t], [xg, yb, z + t], [xg, ya, z + t], PAINT.bar, [1, 0, 0]);
        }
      }
      // sill and arched soffit, spanning the reveal — under the bar as well
      b.on(wallChart, onSill);
      b.quad([xg, ya, WINDOW.sill], [x0, wa, WINDOW.sill], [x0, wb, WINDOW.sill], [xg, yb, WINDOW.sill], PAINT.reveal, [0, 0, 1]);
      b.on(wallChart, onSoffit);
      b.quad([xg, ya, ha], [x0, wa, hwa], [x0, wb, hwb], [xg, yb, hb], PAINT.reveal, [0, 0, -1]);
      b.on(null);
    }
    // the two jambs, leaning out to the wider opening
    for (const [y, into] of [[w.y0, 1], [w.y1, -1]] as const) {
      const yw = y;
      b.on(wallChart, onJamb(into));
      b.quad([xg, y, WINDOW.sill], [x0, yw, WINDOW.sill], [x0, yw, WINDOW.spring], [xg, y, WINDOW.spring],
        PAINT.reveal, [0, into, 0]);
      b.on(null);
    }
  }

  // -- the street: one backdrop behind both windows ---------------------------
  // There is no glass in the model — the opening is open — and what is seen
  // through it is this plane, WINDOW.street behind where the glass would be, far
  // larger than its chart so the texture's edge colour (sky above, the grown
  // street to the sides) is what an oblique look finds rather than the void.
  b.on(chartOf("street"));
  const xs0 = xg - WINDOW.street;
  b.quad([xs0, -30000, -20000], [xs0, 40000, -20000], [xs0, 40000, 30000], [xs0, -30000, 30000], PAINT.sky, [1, 0, 0], 1);

  // -- the counter wall, x1 --------------------------------------------------
  b.on(chartOf("counter-wall"));
  b.quad([x1, y0, floor], [x1, y1, floor], [x1, y1, ceiling], [x1, y0, ceiling], PAINT.plaster, [-1, 0, 0]);

  // -- the two end walls, cut at the top by the slope -------------------------
  // The stops are 50 apart under the slope (where the top edge climbs) and at
  // the two jambs of the doorway, so no strip is ever half in the opening — the
  // door is a gap in this list, not a special case inside the loop.
  const xs = [...new Set([x0, ...Array.from({ length: Math.ceil((ARRIS - x0) / 50) }, (_, i) => x0 + i * 50),
    ARRIS, DOOR.x0, DOOR.x1, CHIMNEY.x0, CHIMNEY.x1, x1])].sort((p, q) => p - q);
  for (const [y, towards, id] of [
    [y0, [0, 1, 0], "fireplace-wall"], [y1, [0, -1, 0], "door-wall"],
  ] as const) {
    b.on(chartOf(id));
    for (let i = 0; i + 1 < xs.length; i++) {
      const xa = xs[i], xb = xs[i + 1];
      const doorway = y === y1 && xa >= DOOR.x0 && xb <= DOOR.x1;
      const flue = y === y0 && xa >= CHIMNEY.x0 && xb <= CHIMNEY.x1;
      const base = doorway ? DOOR.head : flue ? CHIMNEY.head : floor;
      b.quad([xa, y, base], [xb, y, base], [xb, y, ceilingAt(xb, y)], [xa, y, ceilingAt(xa, y)],
        PAINT.plaster, towards as unknown as V3);
    }
  }

  // -- the pictures on the counter wall ----------------------------------------
  for (const [id, pic, paint] of [["poster", PICTURES.poster, PAINT.poster], ["photo", PICTURES.photo, PAINT.photo]] as const) {
    b.on(chartOf(id));
    const xp = x1 - PICTURES.proud;
    b.quad([xp, pic.y0, pic.z0], [xp, pic.y1, pic.z0], [xp, pic.y1, pic.z1], [xp, pic.y0, pic.z1], paint, [-1, 0, 0]);
    // the edges back to the wall, so it has a thickness from the side
    b.on(null);
    for (const [a, c] of [[[xp, pic.y0, pic.z0], [x1, pic.y0, pic.z1]], [[xp, pic.y1, pic.z0], [x1, pic.y1, pic.z1]]] as const) {
      b.quad([a[0], a[1], a[2]], [c[0], a[1], a[2]], [c[0], a[1], c[2]], [a[0], a[1], c[2]], paint, [0, a[1] === pic.y0 ? -1 : 1, 0]);
    }
    b.quad([xp, pic.y0, pic.z1], [x1, pic.y0, pic.z1], [x1, pic.y1, pic.z1], [xp, pic.y1, pic.z1], paint, [0, 0, 1]);
    b.quad([xp, pic.y0, pic.z0], [x1, pic.y0, pic.z0], [x1, pic.y1, pic.z0], [xp, pic.y1, pic.z0], paint, [0, 0, -1]);
  }

  // the painting over the mantel, on the fireplace wall
  {
    const pic = PICTURES.painting, yp = y0 + PICTURES.proud;
    b.on(chartOf("painting"));
    b.quad([pic.x0, yp, pic.z0], [pic.x1, yp, pic.z0], [pic.x1, yp, pic.z1], [pic.x0, yp, pic.z1], PAINT.painting, [0, 1, 0]);
    b.on(null);
    b.quad([pic.x0, y0, pic.z0], [pic.x0, yp, pic.z0], [pic.x0, yp, pic.z1], [pic.x0, y0, pic.z1], PAINT.photo, [-1, 0, 0]);
    b.quad([pic.x1, y0, pic.z0], [pic.x1, yp, pic.z0], [pic.x1, yp, pic.z1], [pic.x1, y0, pic.z1], PAINT.photo, [1, 0, 0]);
    b.quad([pic.x0, y0, pic.z1], [pic.x1, y0, pic.z1], [pic.x1, yp, pic.z1], [pic.x0, yp, pic.z1], PAINT.photo, [0, 0, 1]);
    b.quad([pic.x0, y0, pic.z0], [pic.x1, y0, pic.z0], [pic.x1, yp, pic.z0], [pic.x0, yp, pic.z0], PAINT.photo, [0, 0, -1]);
  }

  // -- the four in the armchair's corner ---------------------------------------
  // A picture is one chart quad standing `proud` of the plaster and four dark
  // returns back to it, so it has a thickness when the room is crossed. The
  // portrait faces the room off the window wall; the other three off the
  // fireplace wall, and the last of them wears its own paint rather than a
  // chart — see PICTURES.hidden.
  {
    const xp = x0 + PICTURES.proud;
    const pic = PICTURES.portrait;
    b.on(chartOf("portrait"));
    b.quad([xp, pic.y0, pic.z0], [xp, pic.y1, pic.z0], [xp, pic.y1, pic.z1], [xp, pic.y0, pic.z1], PAINT.portrait, [1, 0, 0]);
    b.on(null);
    b.quad([x0, pic.y0, pic.z0], [xp, pic.y0, pic.z0], [xp, pic.y0, pic.z1], [x0, pic.y0, pic.z1], PAINT.photo, [0, -1, 0]);
    b.quad([x0, pic.y1, pic.z0], [xp, pic.y1, pic.z0], [xp, pic.y1, pic.z1], [x0, pic.y1, pic.z1], PAINT.photo, [0, 1, 0]);
    b.quad([x0, pic.y0, pic.z1], [x0, pic.y1, pic.z1], [xp, pic.y1, pic.z1], [xp, pic.y0, pic.z1], PAINT.photo, [0, 0, 1]);
    b.quad([x0, pic.y0, pic.z0], [x0, pic.y1, pic.z0], [xp, pic.y1, pic.z0], [xp, pic.y0, pic.z0], PAINT.photo, [0, 0, -1]);
  }
  for (const [id, pic, paint] of [
    ["sketch", PICTURES.sketch, PAINT.sketch],
    ["print", PICTURES.print, PAINT.print],
  ] as const) {
    const yp = y0 + PICTURES.proud;
    b.on(id ? chartOf(id) : null);
    b.quad([pic.x0, yp, pic.z0], [pic.x1, yp, pic.z0], [pic.x1, yp, pic.z1], [pic.x0, yp, pic.z1], paint, [0, 1, 0]);
    b.on(null);
    b.quad([pic.x0, y0, pic.z0], [pic.x0, yp, pic.z0], [pic.x0, yp, pic.z1], [pic.x0, y0, pic.z1], PAINT.photo, [-1, 0, 0]);
    b.quad([pic.x1, y0, pic.z0], [pic.x1, yp, pic.z0], [pic.x1, yp, pic.z1], [pic.x1, y0, pic.z1], PAINT.photo, [1, 0, 0]);
    b.quad([pic.x0, y0, pic.z1], [pic.x1, y0, pic.z1], [pic.x1, yp, pic.z1], [pic.x0, yp, pic.z1], PAINT.photo, [0, 0, 1]);
    b.quad([pic.x0, y0, pic.z0], [pic.x1, y0, pic.z0], [pic.x1, yp, pic.z0], [pic.x0, yp, pic.z0], PAINT.photo, [0, 0, -1]);
  }

  // and the one no camera sees the inside of. It used to be a frame drawn in
  // geometry with a flat plate inside it, because there was nothing to put
  // there; it now takes a chart like the other three, so a drawn file can hang
  // on it and carry its own frame. Without that file it is PAINT.hidden — the
  // dark reddish brown the slivers between the lamp shade and the wall agree
  // on, and no more.
  {
    const pic = PICTURES.hidden, yp = y0 + PICTURES.proud;
    b.on(chartOf("hidden"));
    b.quad([pic.x0, yp, pic.z0], [pic.x1, yp, pic.z0], [pic.x1, yp, pic.z1], [pic.x0, yp, pic.z1], PAINT.hidden, [0, 1, 0]);
    b.on(null);
    b.quad([pic.x0, y0, pic.z0], [pic.x0, yp, pic.z0], [pic.x0, yp, pic.z1], [pic.x0, y0, pic.z1], PAINT.photo, [-1, 0, 0]);
    b.quad([pic.x1, y0, pic.z0], [pic.x1, yp, pic.z0], [pic.x1, yp, pic.z1], [pic.x1, y0, pic.z1], PAINT.photo, [1, 0, 0]);
    b.quad([pic.x0, y0, pic.z1], [pic.x1, y0, pic.z1], [pic.x1, yp, pic.z1], [pic.x0, yp, pic.z1], PAINT.photo, [0, 0, 1]);
    b.quad([pic.x0, y0, pic.z0], [pic.x1, y0, pic.z0], [pic.x1, yp, pic.z0], [pic.x0, yp, pic.z0], PAINT.photo, [0, 0, -1]);
  }

  // -- the door: a reveal, a frame and a closed leaf -------------------------
  b.on(null);
  // NO REVEAL QUADS. They were three faces lining the opening — two jambs and a
  // head — on the planes DOOR.x0, DOOR.x1 and DOOR.head. The architrave below
  // now runs from proud of the wall back to the leaf and lines the reveal
  // itself, on those same three planes, so drawing both would be two coplanar
  // faces fighting over every pixel.
  /**
   * THE LEAF, MODELLED. It was one quad wearing a chart that drew its panels,
   * its mouldings and its knob as paint; it is now three imported meshes, built
   * in Blender against `Scene3/View21` and baked in the room's own frame:
   *
   *     bedsitglb.ts <door.glb>      door      1 1 1 --exact 1549.375
   *     bedsitglb.ts <doorframe.glb> doorframe 1 1 1 --exact 1549.375
   *     bedsitglb.ts <doorknob.glb>  doorknob  1 1 1 --exact 1549.375
   *
   * THE QUARTER TURN IS THE WHOLE PLACEMENT. A baked piece has its length on y
   * and its depth on x with the back at +x; this door's length is along the
   * room's x and its back is into the wall at +y, so it is turned +PI/2 about
   * the opening's own centre. That sends the piece's +y to the room's -x, which
   * is why the knob is baked in from the HIGH-y edge: measured the other way it
   * would come out mirrored across the door, at x 10963 instead of 9693.
   *
   * The piece's x 0 is the WALL'S FACE, not the leaf's: the leaf sits `reveal`
   * behind it and the architrave stands proud of it, so one offset at y1 puts
   * all three where they belong and the architrave lands on the wall the way an
   * architrave does.
   */
  return b.done();
}

/**
 * The pendant, as a PIECE rather than part of the shell.
 *
 * Same reasoning as {@link doorPiece}: the shell is the plaster and the boards
 * and the openings, measured off the frames, and a light fitting hanging in
 * front of it is a model. Its own Builder is what lets it be taken out alone.
 *
 * Taking it out leaves the LIGHT where it was. That is deliberate and it is the
 * division this page already draws: the F panel governs what is built, the L
 * panel what is lit, and a room lit by a bulb you cannot see is a perfectly
 * ordinary thing to want to look at while checking the plaster behind it.
 */
export function pendantPiece(): Part[] {
  const b = new Builder();
  b.on(null);
  /**
   * An imported fitting, split at its own islands rather than by height: the
   * bowl and the metal it hangs in overlap through most of the drop, so a
   * band would cut through both.
   *
   * Three groups, because the frames show three things: the wings, which are
   * pale pressed glass; what is behind them, where the bulb sits, which
   * golden; and the collar and finial, which are brass. The first two
   * are the light and are drawn unlit and bright, the way the panels they
   * replace were.
   *
   * It hangs from the ceiling, not from the finial's point. The drawn fitting
   * was placed on that point because it is the height the frames measure it
   * by, and its panels splayed up and out from there to a rim that
   * stopped short of the plaster — which read as a fitting whose top was
   * simply out of shot. This one has a closed rim, and the same placing left
   * it hanging in the air. So its top is put ON the ceiling, and everything
   * else follows from where the plaster is above it.
   */
  const top = ceilingAt(PENDANT.x, PENDANT.y);
  const at: V3 = [PENDANT.x, PENDANT.y, top - PENDANTWINGS_BOX.hi[2]];
  b.mesh(PENDANT_POSITION, PENDANT_INDICES, at, PAINT.brass);
  b.mesh(PENDANTWINGS_POSITION, PENDANTWINGS_INDICES, at, PAINT.glass, EMIT.pendant);
  b.mesh(PENDANTGLOW_POSITION, PENDANTGLOW_INDICES, at, PAINT.pendantGlow, EMIT.pendant);
  return b.done().map((part) => ({ ...part, piece: "ceiling lamp" }));
}

/**
 * The door, as a PIECE rather than part of the shell.
 *
 * It is drawn from its own Builder so it can be taken out of the room on its
 * own, the way the furniture can. That is the right side of the line for it:
 * the shell is what was measured off the frames — the plaster, the boards, the
 * openings — and the door is joinery standing in an opening, four imported
 * modules of it. Taking it out leaves the doorway the frames actually show.
 *
 * The y1 it needs is the door wall, which buildRoom had to hand and this does
 * not, so it comes off ROOM.
 */
export function doorPiece(): Part[] {
  const b = new Builder();
  b.on(null);
  const y1 = ROOM.y1;
  const doorAt: V3 = [(DOOR.x0 + DOOR.x1) / 2, y1, 0];
  b.place({ cx: doorAt[0], cy: y1, yaw: Math.PI / 2 });
  /**
   * `deskwood` and not `stain`, though `stain` IS this door — it is a 45 by 65
   * patch cut from this very leaf in `Scene2/View64`. At 900 units to the
   * repeat that patch is stretched twenty times across a door two metres wide,
   * and what it reads as is patterned carpet, not wood. `deskwood` is drawn
   * rather than cut, has a grain that runs, and is the darkest of the drawn
   * woods, which is what a leaf described as "the same stain, older and
   * varnished" wants. 520 to the repeat puts about four lengths of grain across
   * the leaf.
   */
  /**
   * THREE FINISHES, and the difference between them is what makes the relief
   * read at all. Nothing in this room casts a shadow, and a raised band's face
   * is parallel to the ground it stands on — same normal, same lamps, same
   * answer — so no amount of relief separates them by light alone.
   *
   * The frame says they are not the same finish anyway. In `Scene3/View21` the
   * architrave's face reads 17.5 out of 255 where the leaf beside it reads 1.3:
   * a factor of thirteen, which is a painted surround against a stained door and
   * not a lighting difference. So the surround is light, the bands take the
   * wood, and the ground between them is darker than either.
   */
  // The ground and the surround are ONE COLOUR and one surface: the architrave
  // is the same dark thing as the leaf's recessed field, so the only step
  // anywhere on this door is the one that draws its bands.
  b.mesh(DOOR_POSITION, DOOR_INDICES, doorAt, PAINT.doorGround, 0, true);
  b.mesh(DOORFRAME_POSITION, DOORFRAME_INDICES, doorAt, PAINT.doorGround, 0, true);
  b.material("deskwood", 520);
  b.mesh(DOORBANDS_POSITION, DOORBANDS_INDICES, doorAt, PAINT.door, 0, true);
  b.material(null);
  b.mesh(DOORKNOB_POSITION, DOORKNOB_INDICES, doorAt, PAINT.brass);
  b.place(null);
  return b.done().map((part) => ({ ...part, piece: "door" }));
}

