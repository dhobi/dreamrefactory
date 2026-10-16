/**
 * A 0..255 bearing for a delta vector — `round(atan2(dy,dx) · 256/2π) & 0xff`.
 * NOT the engines' answer, which is runtime/geometry.ts's `engineBearing` table;
 * kept for the walk starts in scheduler.ts (`heading`), which should move to
 * engineBearing when that file is next open, and the port's own reading of
 * Dust's set data (set-v1-to-v4.ts headingsFrom). Here rather than in
 * runtime/geometry.ts, which re-exports it, so that a file reader needs nothing
 * from the runtime.
 */
export function bearing(dx: number, dy: number): number {
  return Math.round((Math.atan2(dy, dx) * 256) / (2 * Math.PI)) & 0xff;
}
