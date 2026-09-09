/**
 * The desk's printed things, cut out of the film that shows them flat.
 *
 *   npx tsx taoot/bedsit/tools/bedsitcards.ts <out dir> [scale] [path/to/movies]
 *
 * `movies/bedcards.mov` is the desk's close-up, and it is better than a
 * close-up: the film goes on to hold up the things ON the desk one at a time,
 * filling the frame with each. The magazines in the lamp's pool — forty pixels
 * of coloured mush in `Scene3/View23`, and blown to white in the desk shot
 * because they lie directly under the lamp — get a frame each at two hundred
 * pixels across and correctly exposed. That is the only usable reference these
 * covers have, and it is a good one.
 *
 * What this does is take each cover out of its frame and lay it flat: the four
 * corners of the cover are given below, and every output pixel is fetched from
 * the frame through the homography those corners define. The result is the
 * cover square-on, at roughly its own pixel density, ready to be enlarged
 * somewhere else and come back as an albedo tile — the same road the wall
 * pictures took in {@link file://./bedsitpics.ts}, and for the same reason: a
 * picture is a picture, and no amount of drawing gets you a 1942 photo-cover.
 *
 * THE CORNERS ARE MEASURED BY EYE off a gridded blow-up of each frame, and
 * they are as good as that sounds — call it ±3 pixels. Two things make them
 * approximate on purpose rather than by accident:
 *
 *   - The covers are not flat. Every one of them is modelled with a curl, and
 *     BRAVE NEW WORLD's masthead is visibly an arc rather than a line. A
 *     homography maps a plane to a plane, so the curl comes out as a slight
 *     stretch toward the curled edge. Straightening it properly would want a
 *     mesh warp and a reason to bother.
 *   - The edges are torn. The red cover in particular is drawn ragged, so its
 *     "corner" is wherever you decide the tear stops.
 *
 * Both are fine for what this is for. The cut is a reference to enlarge and
 * repaint from, not a measurement anything is built to.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readMovFile } from "@dreamfactory/engine/df/mov";
import { FrameBuffer, decodeFrame, indexedToRGBA, paletteToRGBA } from "@dreamfactory/engine/df/image";
import { encodePNG } from "../../../tools/png";

/** a corner, in the frame's own pixels */
type P = readonly [number, number];

/**
 * What to cut, and from where.
 *
 * `frame` is the index into `bedcards.mov`'s one segment. The film holds each
 * card for two frames and alternates between two images while it does, so
 * these are the frames that actually carry the thing named — found by decoding
 * the lot and looking, not by counting.
 *
 * `quad` is the cover's corners CLOCKWISE FROM TOP-LEFT as the cover is read,
 * which is what fixes the output's rotation: whichever corner is listed first
 * ends up top-left in the cut.
 */
const CARDS: readonly {
  name: string;
  frame: number;
  quad: readonly [P, P, P, P];
  /** the output's aspect, width over height. Omitted takes the quad's own. */
  aspect?: number;
  /**
   * What to multiply the frame's own pixels by, for the things that are dark
   * in it because the room is dark.
   *
   * This film is a night interior lit by one desk lamp, and the four standing
   * photographs are behind that lamp rather than under it. Cut at the exposure
   * the film records, the two darkest come back within a few levels of black —
   * legible as shapes, useless as reference. `bedsitlook.ts` carries a default
   * gain of 1.55 over every SET frame for exactly this reason.
   *
   * It is a multiply and nothing cleverer: no curve, no black point, no
   * per-picture normalisation. What it lifts it lifts honestly, dither and all,
   * and what was crushed to black in the film stays black.
   */
  gain?: number;
  note: string;
}[] = [
  {
    name: "brave-new-world",
    frame: 6,
    quad: [[88, 42], [288, 40], [205, 331], [6, 337]],
    note:
      "BRAVE NEW WORLD, vol XV no seven, January tenth 1941 — 'FRONTIERS OF " +
      "SCIENCE AND NEW TECHNOLOGY', 15c. A woman working on an aircraft " +
      "engine, with two green cover lines: NEWEST IN ENGLISH AIRCRAFT ENGINES " +
      "and BLUEPRINTS ARE MAKING HISTORY. Green masthead and green foot band. " +
      "Its right edge is clear of PEEK the whole way down — there is desk " +
      "between them — so this cut is the whole cover.",
  },
  {
    name: "peek",
    frame: 6,
    quad: [[280, 48], [486, 86], [462, 344], [224, 342]],
    note:
      "PEEK, March 8 1942, 15c. Red masthead on white. A woman in flying " +
      "overalls standing on an airframe, shot from below; cover lines AIR " +
      "CORPS DEBS / FLYGIRL KRISTIN HARTER on a white band across the foot. " +
      "The bottom-right corner is under the game's own OK button, so the last " +
      "few pixels of the price box are the button and not the cover.",
  },
  {
    name: "screen",
    frame: 8,
    quad: [[120, 14], [435, 34], [435, 337], [84, 333]],
    note:
      "The red one. Masthead ends '...VEN' — the rest is off the top of its " +
      "own close-up, so the title is not readable from this film. A woman in " +
      "a red hat smoking, chin on hand, and cover lines at the right reading " +
      "'Wil- / affe- / th-' where the curl cuts them off. Torn edges all " +
      "round: the quad is where the tear averages out.",
  },
  {
    name: "portrait-naval",
    frame: 0,
    gain: 1.8,
    quad: [[363.6, 91], [424, 93.5], [421.8, 171.9], [362, 169]],
    note:
      "The largest of the four standing photographs, third along the desk. A " +
      "naval officer in peaked cap and double-breasted uniform with medal " +
      "ribbons, three-quarter view, on a pale studio ground. Dark stepped " +
      "moulding with two small brass studs on the bottom rail and an easel " +
      "strut behind. 61 by 79 pixels of cover — the frame's picture area only.",
  },
  {
    name: "portrait-women",
    frame: 0,
    gain: 3.2,
    quad: [[97.5, 90.5], [151.3, 92.4], [153.1, 150.5], [102.5, 151.1]],
    note:
      "First along the desk, and the darkest. Lifted, it reads as a figure — " +
      "possibly two overlapping — in a dark coat with a heavy fur collar, " +
      "seated or standing before railings or steps, with one pale shoe at the " +
      "bottom edge. Deep in the lamp's shadow: 52 by 60 pixels, most of them " +
      "within a few levels of black before the gain, so how many people are in " +
      "it is genuinely not decidable from this disc.",
  },
  {
    name: "portrait-oval-lady",
    frame: 0,
    gain: 2.6,
    quad: [[432, 96], [506, 96], [506, 181], [432, 181]],
    note:
      "Fourth and last, the gilt oval at the near end: an elderly woman in " +
      "profile, elaborate Victorian hair or a hat, on a dark ground. The oval " +
      "opening's bounding box, so the gilt bead is just outside it on all four " +
      "sides. The only one of the four whose face is more than a smudge.",
  },
  {
    name: "portrait-oval-dark",
    frame: 0,
    gain: 4.5,
    quad: [[163, 96], [203, 96], [203, 161], [163, 161]],
    note:
      "Second along, the ungilt oval standing directly behind the desk lamp — " +
      "which is why there is nothing here. At four and a half times the film's " +
      "own exposure what comes back is the oval's dark rim and the lamp's glow " +
      "spilling past it: no sitter, no ground, nothing to enlarge. Included so " +
      "the emptiness can be seen rather than taken on trust.",
  },
];

/**
 * Every distinct thing the film holds up, and the frame it is whole in.
 *
 * `bedcards.mov` is 34 frames and shows twelve things, because it holds each
 * for two frames and ALTERNATES between a card's two sides while it does — the
 * player can turn a postcard over, and the film carries both faces. That is why
 * the frame numbers here are not evenly spaced and why three of the pictures
 * pair with three of the messages: one postcard each.
 *
 * Taken together they are a small archive belonging to whoever this bedsit is,
 * and they read as one: the postcards are all addressed to CARLSON at 9 Stanley
 * Crescent, London W11, two of them signed Jack and one Deanna, and Jack's
 * Tunis card of May 1939 asks "whatever happened on the Titanic was bad. But
 * it's 25+ years!" — which dates them against a letter of 10 August 1914 ending
 * the addressee's employment by the Secret Service.
 *
 * These come out as WHOLE FRAMES, not cut. A cut wants four corners measured by
 * eye, and it is worth that for a magazine cover going on the desk as a texture;
 * a card the player is handed is worth having to look at first.
 */
const SHOWN: readonly { frame: number; name: string; what: string }[] = [
  { frame: 3, name: "tarot-la-morte", what: "the tarot trump XIII, LA MORTE — a blue-robed skeleton with a scythe on a gold ground, in a red border" },
  { frame: 6, name: "magazines-bnw-peek", what: "BRAVE NEW WORLD and PEEK, the two desk magazines, lying overlapped" },
  { frame: 8, name: "magazine-red", what: "the third desk magazine, masthead ending '...VEN' — a woman in a red hat, smoking" },
  { frame: 9, name: "postcard-packing-front", what: "a sepia photograph of a packing hall, rows of carcasses on an overhead rail, two men in white" },
  { frame: 10, name: "postcard-newyork-back", what: "POST CARD, New York, 11-29-19, from Jack — back from France, fired, no pension, no references" },
  { frame: 13, name: "postcard-tunis-front", what: "a colour plate of three men taking coffee in North African dress" },
  { frame: 14, name: "postcard-tunis-back", what: "POST CARD, Tunis, May 1939, from Jack — war in Europe, and the Titanic 25+ years ago" },
  { frame: 17, name: "postcard-taj-front", what: "a colour plate of the Taj Mahal from the water garden" },
  { frame: 18, name: "postcard-delhi-back", what: "POST CARD, Delhi, 14 September 1934, from Deanna — ran into Jack in Bombay, repairing clocks" },
  { frame: 23, name: "letter-hipple-1914", what: "a typed letter, 10 August 1914, Commander T.S.D. Hipple: His Majesty's Government regrets... your services in the Office of the Secret Service are no longer needed" },
  { frame: 25, name: "ticket-hindenburg", what: "a Deutsche Zeppelin-Reederei ticket, Frankfurt to Lakehurst, 3 May 1937, $400 + $3.00 tax" },
  { frame: 27, name: "pocket-watch", what: "the open hunter-cased watch from the desk, filling the frame" },
];

const [OUT, SCALE_ARG, MOVIES_ARG] = process.argv.slice(2);
if (!OUT) {
  console.error("usage: npx tsx taoot/bedsit/tools/bedsitcards.ts <out dir> [scale] [path/to/movies]");
  process.exit(2);
}
/** output pixels per frame pixel. 2 keeps the resampling from costing anything
 *  the enlarger would have wanted; more than that is inventing detail. */
const SCALE = Math.max(1, +(SCALE_ARG ?? 2) || 2);
const MOVIES = MOVIES_ARG ?? "taoot/gamefiles/en/titanic1/movies";

/** the film, decoded once — frames are deltas and only come out in order */
function frames(file: string): { rgba: Uint8ClampedArray; w: number; h: number }[] {
  const mov = readMovFile(new Uint8Array(readFileSync(file)));
  const seg = mov.segments[0];
  const palette = paletteToRGBA(seg.paletteRaw, 256, mov.file.order);
  const fb = new FrameBuffer();
  const out: { rgba: Uint8ClampedArray; w: number; h: number }[] = [];
  let shown: Uint8Array | null = null;
  for (const f of seg.frames) {
    const d = decodeFrame(mov.file.containers[f.locationFrame].data, fb, mov.file.order);
    const px = fb.pixels.slice(0, d.width * d.height);
    if (seg.dfV1 && shown) for (let i = 0; i < px.length; i++) if (px[i] === 0 || px[i] === 0xff) px[i] = shown[i];
    if (seg.dfV1) shown = px;
    out.push({ rgba: indexedToRGBA(px, d.width, d.height, palette), w: d.width, h: d.height });
  }
  return out;
}

/**
 * The homography taking the unit square to a quad, as the 8 numbers of a 3x3
 * with h22 fixed at 1.
 *
 * Solved directly rather than by a general linear solve: the unit square's
 * corners make the 8x8 sparse enough that the standard closed form for
 * square-to-quad falls out in a dozen lines, and it cannot be singular for a
 * quad that is actually a quad.
 */
function squareToQuad(q: readonly [P, P, P, P]): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  return [
    x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
    y1 - y0 + g * y1, y3 - y0 + h * y3, y0,
    g, h,
  ];
}

/** bilinear fetch, clamped at the frame's edge */
function sample(im: { rgba: Uint8ClampedArray; w: number; h: number }, x: number, y: number, to: Uint8ClampedArray, at: number): void {
  const cx = Math.min(im.w - 1.001, Math.max(0, x)), cy = Math.min(im.h - 1.001, Math.max(0, y));
  const x0 = Math.floor(cx), y0 = Math.floor(cy), fx = cx - x0, fy = cy - y0;
  for (let k = 0; k < 4; k++) {
    const a = im.rgba[(y0 * im.w + x0) * 4 + k], b = im.rgba[(y0 * im.w + x0 + 1) * 4 + k];
    const c = im.rgba[((y0 + 1) * im.w + x0) * 4 + k], d = im.rgba[((y0 + 1) * im.w + x0 + 1) * 4 + k];
    to[at + k] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
}

const shots = frames(join(MOVIES, "bedcards.mov"));
mkdirSync(OUT, { recursive: true });
console.log(`bedcards.mov: ${shots.length} frames of ${shots[0].w}x${shots[0].h}`);

const manifest: unknown[] = [];
for (const card of CARDS) {
  const im = shots[card.frame];
  const q = card.quad;
  /** the quad's own size: the mean of its two opposite sides */
  const side = (a: P, b: P): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const wide = (side(q[0], q[1]) + side(q[3], q[2])) / 2;
  const tall = (side(q[0], q[3]) + side(q[1], q[2])) / 2;
  const aspect = card.aspect ?? wide / tall;
  const H = Math.round(tall * SCALE), W = Math.round(H * aspect);
  const m = squareToQuad(q);
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const w = m[6] * u + m[7] * v + 1;
      const at = (y * W + x) * 4;
      sample(im, (m[0] * u + m[1] * v + m[2]) / w, (m[3] * u + m[4] * v + m[5]) / w, out, at);
      // Uint8ClampedArray does the clamping, which is what should happen to a
      // highlight that was already at the top of the film's range
      if (card.gain) for (let k = 0; k < 3; k++) out[at + k] = out[at + k] * card.gain;
    }
  }
  const file = join(OUT, `${card.name}.png`);
  writeFileSync(file, encodePNG(out, W, H, { compress: true }));
  console.log(`  ${card.name.padEnd(19)} frame ${String(card.frame).padStart(2)}  ${W}x${H}  from ${Math.round(wide)}x${Math.round(tall)} in frame${card.gain ? `  gain ${card.gain}` : ""}`);
  manifest.push({ name: card.name, frame: card.frame, quad: card.quad, gain: card.gain ?? 1, out: `${card.name}.png`, size: [W, H], note: card.note });
}

// and every card the film holds up, whole
console.log("whole frames:");
for (const shot of SHOWN) {
  const im = shots[shot.frame];
  const file = join(OUT, `card-${shot.name}.png`);
  writeFileSync(file, encodePNG(im.rgba, im.w, im.h, { compress: true }));
  console.log(`  card-${shot.name.padEnd(24)} frame ${String(shot.frame).padStart(2)}`);
  manifest.push({ name: shot.name, frame: shot.frame, out: `card-${shot.name}.png`, size: [im.w, im.h], note: shot.what });
}

writeFileSync(join(OUT, "cards.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`  cards.json`);
