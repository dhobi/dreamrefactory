/**
 * Shared world-space geometry for the sprite runtimes (props + actors).
 *
 * Both PropRuntime and ActorRuntime project world points to the screen, scale
 * sprites by depth, occlude them against the SET Z image, and pick a
 * directional frame from a camera bearing. That math lived duplicated across
 * props.ts and actors.ts (which also imported each other, a cycle); it is
 * collected here so both depend only on this neutral module.
 */

/**
 * World→screen projection camera, built by the viewer. Angles are in 1/256
 * turns; the camera sits at the scene's map position with its height from the
 * per-view table.
 */
export interface WorldCamera {
  x: number;
  y: number;
  z: number;
  /** view angle, 0..255 */
  deg: number;
  /** focal length = max(viewW, viewH)/2 */
  f: number;
  cx: number;
  cy: number;
  /** viewport clip (world props only draw inside the set view) */
  clipW: number;
  clipH: number;
  /**
   * A DreamFactory 5 room's camera, which is a real one — heading, pitch, roll
   * and a field of view — so the flat one above does not describe it. When it is
   * here, {@link projectPoint} and the sprite runtimes' sizing ask it instead.
   */
  v5?: SpriteCamera;
  /**
   * The depths a world sprite is drawn at, at all: outside them the engines make
   * no draw record, so the sprite is neither seen nor hit. DF.EXE draws from
   * depth 32 (0x41e828); TI.EXE and tl.exe from past a quarter of the set's
   * depth step (0x411242, `scale` being SCDO's zFarMax / zLevelCount, an integer
   * there). Both stop where depth less zclip, plus the ground bias, passes the
   * set's zFarMax (DF.EXE 0x41e834, 0x600 on every Dust set; TI.EXE 0x411262).
   */
  depthWindow?: { minDepth: number; far: number; bias: number };
}

/** is a sprite at `depth` with `zclip` inside the camera's {@link WorldCamera.depthWindow}? */
export function inDepthWindow(cam: WorldCamera, depth: number, zclip: number): boolean {
  const w = cam.depthWindow;
  if (!w) return true;
  return depth >= w.minDepth && Math.max(0, depth - zclip + w.bias) <= w.far;
}

/** RedJack.exe's sprite camera (engine/src/runtime/maze.ts builds it) */
export interface SpriteCamera {
  /**
   * The screen point of a world point; its distance, which sprites sort by and
   * the room's far limit cuts at; and its depth along the view, which is what
   * the scenery hides it by — 0x435740 hands back both (the square root, then
   * the depth it was taken from), and the placement tests them apart (0x42cb7e,
   * 0x42ce18).
   */
  project(x: number, y: number, z: number): { x: number; y: number; depth: number; axial: number } | null;
  /** pixels on screen per pixel of the frame, for a sprite at this point */
  size(x: number, y: number, z: number, scale: number, ref: number): number;
  /** how far a sprite can be, less its zclip, and still be drawn (SettFile.far) */
  far: number;
  /** the camera's point and the way through a screen point from it, at depth 1 */
  ray(sx: number, sy: number): { x: number; y: number; z: number; dx: number; dy: number; dz: number };
  /** the view angle (0..255) a sprite facing `deg` ({@link TURN}ths) shows the camera */
  facing(x: number, y: number, deg: number): number;
}

/**
 * The current SET view's depth map, for occluding world sprites behind
 * scenery. z holds per-pixel levels 0..levels (low = near, high = far) at w×h;
 * scale is world-depth units per level (SET.zFarMax / SET.zLevelCount). TI.EXE
 * (blit 0x412940) draws a sprite pixel only where the scenery level is >= the
 * sprite's level, i.e. where the scenery is farther-or-equal.
 */
export interface Occlusion {
  /** v4's levels; a v5 room's distances, with a scale of 1 (engine/src/web/maze-view.ts) */
  z: ArrayLike<number>;
  w: number;
  h: number;
  scale: number;
  levels: number;
  /**
   * Units ADDED to a sprite's depth before it is quantized to a level, from the
   * engine that owns the set.
   *
   * DreamFactory 1 has one and it is not small: DF.EXE computes the level a
   * sprite is z-tested at as `(depth - zclip - camerahi + 0x80) >> 6` — the
   * +128 is hard-coded in both sprite renderers (0x41e81e, in the prop
   * renderer whose table is at 0x460b28, and 0x41508e) and lands in the draw record at 0x41e94c (`sar bx, 6`). Two
   * whole levels: the scenery has to be 128 units nearer than the sprite
   * before it wins the pixel, so the ground band an actor stands ON covers
   * his feet and he reads as planted in the street instead of pasted over
   * it. v4 leaves this 0, which is the port's measured TI.EXE behaviour.
   */
  groundBias?: number;
}

const SIN14 = new Int16Array(256);
const COS14 = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  SIN14[i] = Math.round(16384 * Math.sin((2 * Math.PI * i) / 256));
  COS14[i] = Math.round(16384 * Math.cos((2 * Math.PI * i) / 256));
}
/** the engine's rounding: add 0x3fff before >>14 only for negatives */
const fix14 = (v: number): number => (v < 0 ? v + 0x3fff : v) >> 14;

/**
 * World→screen projection, ported from TI.EXE fn 0x43a970. Angles are in
 * 1/256 turns; trig is 2.14 fixed point (the engine's TRIG resource tables).
 */
export function projectPoint(
  cam: WorldCamera,
  x: number,
  y: number,
  z: number,
): { x: number; y: number; depth: number; axial?: number } | null {
  if (cam.v5) return cam.v5.project(x, y, z);
  const dx = x - cam.x;
  const dy = y - cam.y;
  const dz = z - cam.z;
  const s = SIN14[cam.deg & 0xff];
  const c = COS14[cam.deg & 0xff];
  const depth = fix14(dy * s + dx * c);
  if (depth <= 0) return null;
  const lateral = fix14(dy * c - dx * s);
  return {
    x: cam.cx + Math.trunc((lateral * cam.f) / depth),
    y: cam.cy - Math.trunc((dz * cam.f) / depth),
    depth,
  };
}

/**
 * The depth scenery hides a projected sprite by: along the view in a v5 room
 * ({@link SpriteCamera.project}), and the one depth there is anywhere else.
 */
export const hiddenBy = (proj: { depth: number; axial?: number }): number => proj.axial ?? proj.depth;

/** a world point's quantized depth level (groundOffset defaults to 0; TI.EXE 0x41140e) */
export function depthLevel(depth: number, occ: Occlusion): number {
  return Math.max(0, Math.floor(depth / Math.max(1, occ.scale)));
}

/** true if the scenery at (x,y) is NEARER than the sprite level → hide the pixel */
export function sceneryOccludes(occ: Occlusion, x: number, y: number, level: number): boolean {
  if (x < 0 || y < 0 || x >= occ.w || y >= occ.h) return false;
  return occ.z[y * occ.w + x] < level;
}

/**
 * A 0..255 bearing for a delta vector — `round(atan2(dy,dx) · 256/2π) & 0xff`.
 * NOT the engines' answer, which is {@link engineBearing}'s table; kept for the
 * walk starts in scheduler.ts (`heading`), which should move to engineBearing
 * when that file is next open, and the port's own reading of Dust's set data
 * (df/set-v1-to-v4.ts headingsFrom).
 */
export function bearing(dx: number, dy: number): number {
  return Math.round((Math.atan2(dy, dx) * 256) / (2 * Math.PI)) & 0xff;
}

/**
 * `floor(atan(i / 512) · 128/π)` for i in 0..511 — the engines' octant table
 * (TI.EXE 0x45c260, tl.exe 0x45b040, DF.EXE 0x447680, the same 513 bytes with a
 * 0 at 512 that no index reaches). Computed: JavaScript's atan reproduces every
 * byte of it.
 */
const OCTANT = (() => {
  const t = new Uint8Array(513);
  for (let i = 0; i < 512; i++) t[i] = Math.floor((Math.atan(i / 512) * 128) / Math.PI);
  return t;
})();

/**
 * The engines' own 0..255 bearing for a delta vector — what `calcdeg` answers
 * and what picks a sprite's facing frame: TI.EXE 0x43d480 (called through
 * 0x43d450, which subtracts the two points' 16-bit halves), DF.EXE 0x43a790, and
 * tl.exe's copy beside its table. No trigonometry at run time: the axes and the
 * two diagonals are constants (0, 0x40, 0x80, 0xc0; 0x20, 0x60, 0xa0, 0xe0), and
 * inside an octant the smaller component over the larger, `(min << 9) / max`
 * truncated, indexes {@link OCTANT}. All of it in 16-bit words.
 *
 * {@link bearing}'s rounded atan2 differs by one in about half of all directions.
 */
export function engineBearing(dx: number, dy: number): number {
  let a = s16(dy);
  let b = s16(dx);
  if (a === 0) return b < 0 ? 0x80 : 0;
  if (b === 0) return a < 0 ? 0xc0 : 0x40;
  // signed 16-bit negation: -32768 stays itself, as `neg dx` leaves it
  const neg = (v: number) => s16(-v);
  const look = (lo: number, hi: number) => OCTANT[Math.trunc((lo << 9) / hi)];
  if (a < 0) {
    a = neg(a);
    if (b < 0) {
      b = neg(b);
      if (b === a) return 0xa0;
      return b < a ? (0xc0 - look(b, a)) & 0xff : (look(a, b) + 0x80) & 0xff;
    }
    if (b === a) return 0xe0;
    return b < a ? (look(b, a) + 0xc0) & 0xff : (0x100 - look(a, b)) & 0xff;
  }
  if (b < 0) {
    b = neg(b);
    if (b === a) return 0x60;
    return b < a ? (look(b, a) + 0x40) & 0xff : (0x80 - look(a, b)) & 0xff;
  }
  if (b === a) return 0x20;
  return b < a ? (0x40 - look(b, a)) & 0xff : look(a, b) & 0xff;
}

/** sign-extend the low 16 bits (point.ts has the same; geometry keeps no import of it) */
const s16 = (v: number): number => (v << 16) >> 16;

/**
 * DreamFactory 5's bearing, in 2^24ths of a turn rather than 256ths — RedJack.exe
 * 0x41df00: `ftol(atan2 (dy, dx) * 16777216 / 2π) & 0xffffff`, truncating where
 * the older engines round. What `calcdeg` answers and what `actordeg` holds.
 */
export function bearingV5(dx: number, dy: number): number {
  return Math.trunc(Math.atan2(dy, dx) * 16777216 * (1 / (2 * Math.PI))) & 0xffffff;
}

/** a sprite's ink as the blitter's alpha, 0..255 (see PropInstance.ink, ActorInstance.ink) */
export function inkAlpha(ink: number): number {
  return ink >= 8 || ink < 0 ? 255 : (ink * 255 * 32) >> 8;
}

const brightened = new WeakMap<Uint8ClampedArray, Map<string, Uint8ClampedArray>>();
/**
 * A palette with DreamFactory 5's brightness added to each channel
 * (`propbrightness`, `actorbrightness`); the palette itself when it is 0,0,0.
 * Kept per palette, so a lit sprite costs one copy and not one per frame.
 */
export function brightPalette(pal: Uint8ClampedArray, [r, g, b]: readonly [number, number, number]): Uint8ClampedArray {
  if (!r && !g && !b) return pal;
  let byKey = brightened.get(pal);
  if (!byKey) {
    byKey = new Map();
    brightened.set(pal, byKey);
  }
  const key = `${r},${g},${b}`;
  let out = byKey.get(key);
  if (!out) {
    out = new Uint8ClampedArray(pal.length);
    for (let i = 0; i < pal.length; i += 4) {
      out[i] = pal[i] + r;
      out[i + 1] = pal[i + 1] + g;
      out[i + 2] = pal[i + 2] + b;
      out[i + 3] = pal[i + 3];
    }
    byKey.set(key, out);
  }
  return out;
}

/** one sprite pixel over the frame at alpha `a` — a plain copy when opaque */
export function inkPixel(rgba: Uint8ClampedArray, d: number, pal: Uint8ClampedArray, i: number, a: number): void {
  if (a === 255) {
    rgba[d] = pal[i];
    rgba[d + 1] = pal[i + 1];
    rgba[d + 2] = pal[i + 2];
    return;
  }
  rgba[d] += ((pal[i] - rgba[d]) * a) / 255;
  rgba[d + 1] += ((pal[i + 1] - rgba[d + 1]) * a) / 255;
  rgba[d + 2] += ((pal[i + 2] - rgba[d + 2]) * a) / 255;
}
