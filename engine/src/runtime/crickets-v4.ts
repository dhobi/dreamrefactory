import { Crickets, cricketPan, type Cricket } from "./crickets";
import { engineBearing } from "./geometry";
import { s16 } from "./point";

/** TI.EXE's (Titanic, and tl.exe's Timelapse): positions in 16-bit words, the camera's table bearing */
export class CricketsV4 extends Crickets {
  protected word(v: number): number {
    return s16(v);
  }

  /** TI.EXE's never stops the pass */
  protected service(c: Cricket, loud: Cricket[]): boolean {
    this.serve(c, loud);
    return true;
  }

  /**
   * One cricket slot, one pass, as TI.EXE's 0x444430 (tl.exe 0x4033b0) runs it:
   *
   *  - paused, no set open, or the set not the cricket's: nothing at all — not
   *    even the countdown;
   *  - the distance `isqrt (dx² + dy²)` to the camera and the table bearing to
   *    it; in earshot below the radius, at volume `255 − trunc (dist·255 /
   *    radius)` and the pan of {@link cricketPan} — both written to the SOUND
   *    RECORD every pass in earshot (0x425540, 0x425640), so a sound already
   *    playing follows the camera;
   *  - a one-shot (jitter < 0) counts down wherever the camera is, and at 0
   *    plays if in earshot and is gone either way;
   *  - a repeating one counts only in earshot. Its first pass there re-arms
   *    with `base + random (jitter)` and plays nothing (0x44466a); after that
   *    it plays at 0 and re-arms — whether or not its last shot is still
   *    sounding (0x44463f). Leaving earshot stops its sound and disarms it;
   *  - a `soundloop` one in earshot neither counts nor plays: it registers its
   *    volume, and the pass plays the two loudest ({@link Crickets.playLoudest}).
   *
   * A play is `multiplesound`'s (0x425240).
   */
  private serve(c: Cricket, loud: Cricket[]): void {
    if (c.paused) return;
    const set = this.session.currentSetName;
    if (!set || c.setName !== set) return;
    const lis = this.session.listener();
    const dx = c.x - s16(lis?.x ?? c.x);
    const dy = c.y - s16(lis?.y ?? c.y);
    const dist = Math.floor(Math.sqrt(dx * dx + dy * dy)) & 0xffff;
    const near = dist < c.radius;
    const place = () => {
      this.sounds.setVolume(c.name, 255 - Math.trunc((dist * 255) / c.radius));
      this.sounds.setPan(c.name, cricketPan(lis?.deg ?? 0, engineBearing(dx, dy)));
    };
    if (c.jitter < 0) {
      if (--c.count > 0) return;
      if (near) {
        place();
        this.fire(c);
      }
      this.table.splice(this.table.indexOf(c), 1);
      return;
    }
    if (!near) {
      if (c.armed) {
        c.armed = false;
        this.sounds.stopRecord(c.name);
      }
      return;
    }
    place();
    if (this.sounds.isLooped(c.name)) {
      c.armed = true;
      c.loudness = 255 - Math.trunc((dist * 255) / c.radius);
      loud.push(c);
      return;
    }
    if (!c.armed) {
      c.armed = true;
      c.count = c.base + this.rand(c.jitter);
      return;
    }
    if (--c.count > 0) return;
    c.count = c.base + this.rand(c.jitter);
    this.fire(c);
  }
}
