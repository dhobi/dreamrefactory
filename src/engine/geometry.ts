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
}

/**
 * The current SET view's depth map, for occluding world sprites behind
 * scenery. z holds per-pixel levels 0..levels (low = near, high = far) at w×h;
 * scale is world-depth units per level (SET.zFarMax / SET.zLevelCount). TI.EXE
 * (blit 0x412940) draws a sprite pixel only where the scenery level is >= the
 * sprite's level, i.e. where the scenery is farther-or-equal.
 */
export interface Occlusion {
  z: Uint8Array;
  w: number;
  h: number;
  scale: number;
  levels: number;
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
): { x: number; y: number; depth: number } | null {
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
