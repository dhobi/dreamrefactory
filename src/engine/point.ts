/**
 * The engine's packed point: one 32-bit int holding (x << 16) | y with SIGNED
 * 16-bit halves. This is how scripts pass coordinates around — mouse(),
 * makepoint(), actorxyz(4), calcdist(a, b) all speak this format.
 */

/** sign-extend the low 16 bits */
export function s16(v: number): number {
  return (v << 16) >> 16;
}

export function packPoint(x: number, y: number): number {
  return ((x & 0xffff) << 16) | (y & 0xffff);
}

export function pointX(p: number): number {
  return s16((p >> 16) & 0xffff);
}

export function pointY(p: number): number {
  return s16(p & 0xffff);
}
