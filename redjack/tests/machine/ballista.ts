/**
 * The ballista on RedJack's hill (ballista.sett, ballista.shop, ballista.cast),
 * day seven: the Spanish galleons sail in on the beach, and the one that gets
 * there fires on it and ends the game (ballista.cast `endwalk`). Two sunk win
 * it (`endanim` "sink", `sunkships = 2` → `winballista.move`, `endgame`).
 *
 * As the scripts have it:
 *
 *   - **the aim** is the view, which the pointer turns as on the mine carts:
 *     the set's `margin` is 310, so only a strip in the middle stands still
 *     (`region`, 310–329 across and 232–247 down), and a point d past it turns
 *     the view d × 699045 / 1240 a pass (`getdegree`, `setcursor`). A click
 *     fires (the set's `mousedown` → ballista.shop `fire`) and does not turn.
 *   - **the stone** leaves 1000 ahead of the camera at 2600 plus the pitch's
 *     share of 1000, and flies 310 a pass along the heading and the pitch in
 *     whole degrees, less 10 a pass for gravity, until it is 1600 down
 *     (`launch`, brock `throwrock`, `move`).
 *   - **a hit** is the stone between a galleon's range and 2000 past it, its
 *     point on the screen on the galleon (`checkhit`). Four hits sink one:
 *     two, a third that sets it burning, and a fourth that blows it up.
 *
 * So the gunner lays the view on the nearest galleon afloat, finds the tilt
 * whose stone — followed the way `move` flies it, the galleon moved on by its
 * course — lands on it, steers there, and fires.
 */
import { TURN } from "@dreamfactory/engine/df/sett";
import { degToSimple, simpleToDeg } from "@dreamfactory/engine/runtime/maze";
import type { Headless } from "./harness";

const SHIPS = [1, 2, 3, 4].map((i) => `ship ${i}`);
const cos = (a: number, m: number): number => Math.trunc(m * Math.cos((a * 2 * Math.PI) / TURN));
const sin = (a: number, m: number): number => Math.trunc(m * Math.sin((a * 2 * Math.PI) / TURN));
/** an angle's difference, signed, in the scripts' units */
const diff = (a: number, b: number): number => ((((a - b) % TURN) + TURN + TURN / 2) % TURN) - TURN / 2;
/** a pitch in whole degrees, signed */
const whole = (a: number): number => {
  const d = degToSimple(((a % TURN) + TURN) % TURN);
  return d > 180 ? d - 360 : d;
};
/** `getdegree`'s inner band: a pixel past the still strip, in angle a pass */
const PER_PX = 699045 / 1240;

type Actor = NonNullable<ReturnType<Headless["session"]["actorRuntime"]["get"]>>;

/** fire the ballista until the galleons are beaten and the room closes; answers the shots it took */
export async function sinkTheGalleons(h: Headless): Promise<number> {
  const actors = h.session.actorRuntime;
  const props = h.session.propRuntime;
  let shots = 0;
  let target: Actor | undefined;
  let course = { vx: 0, vy: 0, x: 0, y: 0 };
  let wait = 0;
  await h.until(
    () => {
      if (h.room() !== "ballista") return true;
      const m = h.session.maze;
      const cam = m?.camera();
      const eye = m?.spriteCamera(640, 480);
      if (!m || !cam || !eye || m.view !== "node") return false;
      const afloat = SHIPS.map((n) => actors.get(n)).filter(
        (a): a is Actor => !!a?.visible && a.poseName !== "sink" && a.poseName !== "explode",
      );
      const dist = (a: Actor): number => Math.hypot(a.worldX - cam.x, a.worldY - cam.y);
      if (!target || !afloat.includes(target)) target = afloat.sort((a, b) => dist(a) - dist(b))[0];
      const a = target;
      if (!a) {
        h.session.setPointer(320, 240);
        return false;
      }
      // its course, a pass at a time
      if (course.x || course.y) course = { vx: a.worldX - course.x, vy: a.worldY - course.y, x: a.worldX, y: a.worldY };
      else course = { vx: 0, vy: 0, x: a.worldX, y: a.worldY };
      const world = { x: cam.x, y: cam.y, z: cam.z, deg: 0, f: 0, cx: 320, cy: 240, clipW: 640, clipH: 480, v5: eye };
      const box = actors.spriteBox(a, world);
      /** the pass the stone fired at this heading and tilt lands on it, or -1 */
      const lands = (heading: number, tilt: number): number => {
        if (!box) return -1;
        const pitch = simpleToDeg(tilt < 0 ? tilt + 360 : tilt);
        let x = cam.x + cos(heading, 1000);
        let y = cam.y + sin(heading, 1000);
        let z = sin(pitch, 1000) + 2600;
        const dx = cos(heading, 310);
        const dy = sin(heading, 310);
        let dz = sin(pitch, 310);
        for (let t = 0; t < 400 && z > -1600; t++) {
          const sx = a.worldX + course.vx * t;
          const sy = a.worldY + course.vy * t;
          const range = Math.trunc(Math.hypot(sx - cam.x, sy - cam.y));
          const ball = Math.trunc(Math.hypot(x - cam.x, y - cam.y));
          if (ball >= range && ball <= range + 2000) {
            // the stone against the galleon as it is now
            const q = eye.project(x - course.vx * t, y - course.vy * t, z);
            if (q && box.covers(Math.round(q.x), Math.round(q.y))) return t;
          }
          dz -= 10;
          x += dx;
          y += dy;
          z += dz;
        }
        return -1;
      };
      // the heading to where it will be when a stone gets there, and the tilt
      const k = Math.max(0, (dist(a) - 1000) / 310);
      const bearing = Math.atan2(a.worldY + course.vy * k - cam.y, a.worldX + course.vx * k - cam.x);
      const heading = Math.trunc((bearing * TURN) / (2 * Math.PI)) & (TURN - 1);
      let tilt: number | null = null;
      for (let t = -10; t <= 45 && tilt === null; t++) if (lands(heading, t) >= 0) tilt = t;
      const ready = props.get("ballista")?.stateName === "ready";
      if (wait > 0) wait--;
      if (ready && !wait && lands(m.heading, whole(m.pitch)) >= 0) {
        h.click(320, 240);
        shots++;
        wait = 10;
        return false;
      }
      // steer: half the error a pass, in `getdegree`'s inner band
      const eH = diff(heading, m.heading);
      const eP = tilt === null ? 0 : diff(simpleToDeg(tilt < 0 ? tilt + 360 : tilt), m.pitch);
      const push = (e: number): number => Math.min(231, Math.max(1, Math.abs(e) / 2 / PER_PX));
      const x = Math.abs(eH) < 600 ? 320 : eH > 0 ? 310 - push(eH) : 330 + push(eH);
      const y = tilt === null || whole(m.pitch) === tilt ? 240 : eP > 0 ? 232 - push(eP) : 248 + push(eP);
      h.session.setPointer(Math.round(x), Math.round(y));
      return false;
    },
    "the ballista",
    60_000,
  );
  h.session.setPointer(320, 240);
  return shots;
}
