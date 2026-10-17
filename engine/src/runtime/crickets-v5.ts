import { Crickets, type Cricket } from "./crickets";
import { bearingV5 } from "./geometry";

/**
 * Where a v5 cricket pans, 0..255, from the camera's heading and the bearing to
 * the sound, both in 2^24ths — RedJack.exe 0x41d919..0x41d9a7: the bearing
 * turned by the camera's distance from a half turn (so the camera faces
 * 0x800000), folded front to back into 0x400000..0xc00000, and that span
 * stretched over 255 and turned round, `255 − trunc((rel − 0x400000) · 255 /
 * 0x800000)` masked to a byte: dead ahead is 128, a quarter turn either way 0
 * or 255.
 */
export function cricketPanV5(heading: number, bearing: number): number {
  const lo = Math.min(heading, 0x800000);
  const hi = Math.max(heading, 0x800000);
  const turn = Math.min(hi - lo, lo - hi + 0x1000000);
  let rel = (heading > 0x800000 ? bearing - turn : bearing + turn) & 0xffffff;
  if (rel > 0xc00000) rel = 0x1800000 - rel;
  if (rel < 0x400000) rel = 0x800000 - rel;
  return (255 - Math.trunc(((rel - 0x400000) * 255) / 0x800000)) & 0xff;
}

/**
 * RedJack.exe's: TI.EXE's crickets in DreamFactory 5's units — positions in
 * dwords, the room camera's distance and bearing measured when a cricket is
 * made and again only when the camera has moved, and no set wanted to make one.
 */
export class CricketsV5 extends Crickets {
  readonly engine = 5;
  protected override readonly needsSet = false;

  protected word(v: number): number {
    return v | 0;
  }

  protected override measure(c: Cricket): void {
    this.measured(c);
  }

  /**
   * One cricket slot, one pass, as RedJack.exe's 0x41d810 runs it — TI.EXE's
   * service ({@link CricketsV4}) in DreamFactory 5's units, against the
   * room camera (x, y at 0x4c7a44/0x4c7a48, heading at 0x4c7a38):
   *
   *  - paused, or the open set not its own (0x41d824): nothing at all;
   *  - the distance and bearing are measured again only when the camera's point
   *    has moved ({@link Cricket.measured});
   *  - a one-shot counts down wherever the camera is and at 0 plays if in
   *    earshot (0x41d906..0x41d9d4) and is gone either way (0x41d9d9);
   *  - a repeating one in earshot is placed every pass; a `soundloop` one
   *    registers its volume for the loudest two (0x41dacd..0x41dae8), any other
   *    is armed on its first pass there (0x41db32) and after that plays at 0 and
   *    re-arms with `base + random (jitter)` (0x41db01..0x41db22). Out of earshot
   *    an armed one is disarmed and its sound stopped (0x41db51..0x41db73).
   *
   * The sound is looked up by name for every play, place or stop (0x448ff0);
   * one no open bank has is error 0xa, which frees the slot and stops the pass
   * (0x41b787). False then.
   */
  protected service(c: Cricket, loud: Cricket[]): boolean {
    if (c.paused || c.setName !== this.session.currentSetName) return true;
    const { dist, bearing } = this.measured(c);
    const near = dist < c.radius;
    if (!near && (c.jitter < 0 || !c.armed)) {
      if (c.jitter < 0 && --c.count <= 0) this.table.splice(this.table.indexOf(c), 1);
      return true;
    }
    if (c.jitter < 0 && --c.count > 0) return true;
    if (!this.session.audioLib.sound(c.name)) {
      this.table.splice(this.table.indexOf(c), 1);
      this.session.onLog(`pass stopped at cricket ${c.name}: no sound "${c.name}" (error 0xa)`);
      return false;
    }
    if (!near) {
      c.armed = false;
      this.sounds.stopRecord(c.name);
      return true;
    }
    const volume = 255 - Math.trunc((dist * 255) / c.radius);
    this.sounds.setVolume(c.name, volume);
    this.sounds.setPan(c.name, cricketPanV5(this.cameraHeading(), bearing));
    if (c.jitter < 0) {
      this.fire(c);
      this.table.splice(this.table.indexOf(c), 1);
      return true;
    }
    if (this.sounds.isLooped(c.name)) {
      c.armed = true;
      c.loudness = volume;
      loud.push(c);
      return true;
    }
    if (!c.armed) {
      c.armed = true;
      c.count = c.base + this.rand(c.jitter);
      return true;
    }
    if (--c.count > 0) return true;
    c.count = c.base + this.rand(c.jitter);
    this.fire(c);
    return true;
  }

  /**
   * A v5 cricket's distance and bearing from the camera, measured again only
   * when the camera's point is not the one it was last measured from — RedJack.exe
   * 0x41d851..0x41d8d1, and at `makecricket` (0x41d71b): `isqrt`'s float twin
   * truncated, and `atan2` in 2^24ths ({@link bearingV5}). With no room the last
   * camera stands.
   */
  private measured(c: Cricket): { dist: number; bearing: number } {
    const cam = this.session.maze?.camera();
    const m = c.measured;
    if (m && (!cam || (m.camX === cam.x && m.camY === cam.y))) return m;
    const camX = cam?.x ?? m?.camX ?? 0;
    const camY = cam?.y ?? m?.camY ?? 0;
    const dx = c.x - camX;
    const dy = c.y - camY;
    c.measured = { camX, camY, dist: Math.trunc(Math.sqrt(dx * dx + dy * dy)), bearing: bearingV5(dx, dy) };
    return c.measured;
  }

  /** the room camera's heading in 2^24ths, as RedJack.exe keeps it at 0x4c7a38 */
  private cameraHeading(): number {
    const cam = this.session.maze?.camera();
    return cam ? Math.round((cam.heading * 0x1000000) / (2 * Math.PI)) & 0xffffff : 0;
  }
}
