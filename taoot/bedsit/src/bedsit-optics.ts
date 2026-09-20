/**
 * The three matrices this page builds by hand, and nothing else.
 *
 * They were in {@link file://./bedsit-page.ts} until the room went into a
 * headset. Two things wanted them out. A WebXR session composes its own view
 * matrix on top of this one's, and a copy of `view` in that file would have
 * meant two places agreeing about which way yaw points and what the handedness
 * is — the day they stopped agreeing, the room would have been mirrored in the
 * headset only, which is the kind of bug you find by wearing it. And the page
 * touches the DOM on its first line, so nothing in it can be imported by a test
 * that has no browser; these are pure arithmetic and now they can be.
 */

export function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) / (near - far); m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/**
 * The world→camera matrix for an eye looking along `fwd` with `up` overhead.
 *
 * `view` below cannot do this job: it names a direction by yaw and pitch, and
 * two of a cube's six faces are straight up and straight down, where yaw stops
 * meaning anything and the up vector it derives collapses to zero.
 */
export function lookAlong(eye: readonly number[], fwd: readonly number[], up: readonly number[]): Float32Array {
  const cross = (a: readonly number[], b: readonly number[]): number[] =>
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const r = cross(fwd, up), rl = Math.hypot(r[0], r[1], r[2]) || 1;
  const x = [r[0] / rl, r[1] / rl, r[2] / rl];
  const y = cross(x, fwd);
  const m = new Float32Array(16);
  m[0] = x[0]; m[4] = x[1]; m[8] = x[2]; m[12] = -dot(x, eye);
  m[1] = y[0]; m[5] = y[1]; m[9] = y[2]; m[13] = -dot(y, eye);
  m[2] = -fwd[0]; m[6] = -fwd[1]; m[10] = -fwd[2]; m[14] = dot(fwd, eye);
  m[15] = 1;
  return m;
}

/** the world→camera matrix for an eye in GL space looking along `yaw`/`pitch`.
 *  Bearing is the game's: 0 is +x, and +y is on the right. */
export function view(eye: [number, number, number], yaw: number, pitch: number): Float32Array {
  const cp = Math.cos(pitch);
  const f: [number, number, number] = [Math.cos(yaw) * cp, Math.sin(pitch), Math.sin(yaw) * cp];
  const r: [number, number, number] = [-Math.sin(yaw), 0, Math.cos(yaw)];
  const u: [number, number, number] = [
    r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0],
  ];
  const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const m = new Float32Array(16);
  m[0] = r[0]; m[4] = r[1]; m[8] = r[2]; m[12] = -dot(r, eye);
  m[1] = u[0]; m[5] = u[1]; m[9] = u[2]; m[13] = -dot(u, eye);
  m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2]; m[14] = dot(f, eye);
  m[15] = 1;
  return m;
}
