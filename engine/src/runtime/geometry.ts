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
   * +128 is hard-coded in both sprite renderers (actors 0x41e81e, props
   * 0x41508e) and lands in the draw record at 0x41e94c (`sar bx, 6`). Two
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
 * The engine's 0..255 bearing for a delta vector — `round(atan2(dy,dx) ·
 * 256/2π) & 0xff`. Sprites pick their directional frame from the bearing to
 * the camera; walk starts face the bearing to the target.
 */
export function bearing(dx: number, dy: number): number {
  return Math.round((Math.atan2(dy, dx) * 256) / (2 * Math.PI)) & 0xff;
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
  if (!byKey) brightened.set(pal, (byKey = new Map()));
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
