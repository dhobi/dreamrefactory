/**
 * The cannons, the player's way: turn and tilt the barrel with the arrows, and
 * click to fire, until the four dinghies circling the Marauder are sunk.
 *
 * How the game scores a shot (cannon.shop):
 *
 *   - **the aim** is the camera. The arrows turn it a degree a press and tilt it
 *     a degree, from 5° down to 40° up (cannon.sett keydown, pitchlimit); a click
 *     in the middle tilts it one more degree up (the set's `mousedown` sends
 *     itself "up") before the boot's library fires (`sendtoprop ("cannon",
 *     fire ())`).
 *   - **the ball** leaves 1000 ahead of the camera, 400 below its height plus the
 *     tilt's share of 1000, and each frame moves 410 along the heading and its
 *     climb, which gravity takes 10 from (cannon ball `throwrock`, `move`). It
 *     is gone once it is 600 down.
 *   - **a hit** is the ball's point on the screen (`calcpoint`) being on the
 *     dinghy (`hittest`) while it is between the dinghy's range and 1000 past it
 *     (`checkhit`). Two hits sink one: "damaged", then "explode", whose
 *     `endanim` counts it (cannon.cast); the fourth ends the game (`endcannon`).
 *
 * So the gunner here does what a good player's eye does, with the game's own
 * projection standing in for the eye: for each tilt it follows the ball the
 * way `move` will, frame by frame, and asks the room whether the dinghy — where
 * it will have sailed to by then — would be under it. Then it turns, tilts and
 * fires.
 */
import { TURN } from "@dreamfactory/engine/df/sett";
import { degToSimple, simpleToDeg } from "@dreamfactory/engine/runtime/maze";
import { fail, type Headless } from "./harness";

const cos = (a: number, m: number): number => Math.trunc(m * Math.cos((a * 2 * Math.PI) / TURN));
const sin = (a: number, m: number): number => Math.trunc(m * Math.sin((a * 2 * Math.PI) / TURN));
/** a camera angle in whole degrees, signed: the tilt runs -5..40 */
const signed = (a: number): number => {
  const d = degToSimple(((a % TURN) + TURN) % TURN);
  return d > 180 ? d - 360 : d;
};
const DINGHIES = [1, 2, 3, 4].map((i) => `dingy ${i}`);

/** play the cannons until all four dinghies are down and the game ends; answers the shots it took */
export async function sinkTheDinghies(h: Headless, maxShots = 60): Promise<number> {
  const maze = (): NonNullable<Headless["session"]["maze"]> => h.session.maze ?? fail("no room");
  const props = h.session.propRuntime;
  const actors = h.session.actorRuntime;
  const afloat = (): string[] =>
    DINGHIES.filter((d) => {
      const a = actors.get(d);
      return !!a?.visible && a.poseName !== "explode";
    });
  const reloading = (): boolean => !!props.get("cannon ball")?.visible || Number(props.get("cannon")?.value ?? 0) !== 0;
  const inCannons = (): boolean => h.room() === "cannon";

  /** where a dinghy is going, per frame, from one frame's sailing */
  const course = async (who: string): Promise<{ x: number; y: number; vx: number; vy: number }> => {
    const a = actors.get(who)!;
    const x0 = a.worldX;
    const y0 = a.worldY;
    await h.frame(1);
    return { x: a.worldX, y: a.worldY, vx: a.worldX - x0, vy: a.worldY - y0 };
  };

  /**
   * The frame the ball fired at `heading` and `tilt` (whole degrees) scores on
   * `who`, or -1: `move` followed step by step, the dinghy moved on by as many
   * frames of its course, and the room asked what is under the ball.
   */
  const scores = (who: string, heading: number, tilt: number, c: { vx: number; vy: number }): number => {
    const m = maze();
    const cam = m.camera()!;
    const eye = m.spriteCamera(640, 480);
    const a = actors.get(who)!;
    const pitch = simpleToDeg(tilt < 0 ? tilt + 360 : tilt);
    let x = cam.x + cos(heading, 1000);
    let y = cam.y + sin(heading, 1000);
    let z = sin(pitch, 1000) - 400;
    const dx = cos(heading, 410);
    const dy = sin(heading, 410);
    let dz = sin(simpleToDeg(degToSimple(pitch)), 410);
    for (let t = 0; t < 40 && z > -600; t++) {
      // the dinghy t frames on, measured the way checkhit measures it
      const sx = a.worldX + c.vx * t;
      const sy = a.worldY + c.vy * t;
      const range = Math.trunc(Math.hypot(sx - cam.x, sy - cam.y));
      const ball = Math.trunc(Math.hypot(x - cam.x, y - cam.y));
      if (ball >= range && ball <= range + 1000 && eye) {
        // the ball against the dinghy as it is now: shift the ball back by the
        // dinghy's sailing instead of moving the dinghy
        const p = eye.project(x - c.vx * t, y - c.vy * t, z);
        if (p && h.session.hitTestAt(Math.round(p.x), Math.round(p.y)).name.toLowerCase() === who) return t;
      }
      dz -= 10;
      x += dx;
      y += dy;
      z += dz;
    }
    return -1;
  };

  /** press `key` until `done`, a frame a press, as the arrows are held */
  const pressUntil = async (key: string, done: () => boolean, what: string): Promise<void> => {
    for (let n = 0; !done(); n++) {
      if (n > 400) fail(`${what}: ${key} never got there`);
      h.key(key);
      await h.frame(1);
    }
  };

  // the wrecks, seen as they blow up: closing the room forgets its count (cannon.sett
  // closeset `dumpglobal numships, sunkships`) and its dinghies
  const sunk = new Set<string>();
  const tally = (): void => {
    for (const d of DINGHIES) if (actors.get(d)?.poseName === "explode") sunk.add(d);
  };
  let shots = 0;
  while (inCannons() && afloat().length) {
    if (shots === maxShots) fail(`${shots} shots and ${afloat().length} dinghies still afloat`);
    await h.until(() => !inCannons() || !reloading(), "the cannon to reload", 400);
    if (!inCannons()) break;
    const m = maze();
    const cam = m.camera()!;
    // the nearest dinghy still afloat
    const who = afloat().sort((p, q) => {
      const d = (n: string): number => Math.hypot(actors.get(n)!.worldX - cam.x, actors.get(n)!.worldY - cam.y);
      return d(p) - d(q);
    })[0];
    // turn to where it will be by the time a ball gets there
    let c = await course(who);
    const lead = (): number => {
      const a = actors.get(who)!;
      const k = Math.max(0, (Math.hypot(a.worldX - cam.x, a.worldY - cam.y) - 1000) / 410);
      const bearing = Math.atan2(a.worldY + c.vy * k - cam.y, a.worldX + c.vx * k - cam.x);
      return degToSimple(Math.trunc((bearing * TURN) / (2 * Math.PI)) & (TURN - 1));
    };
    const heading = (): number => degToSimple(m.heading);
    const off = (): number => ((lead() - heading() + 540) % 360) - 180;
    await pressUntil(off() > 0 ? "left" : "right", () => Math.abs(off()) < 1 || !inCannons(), `turning to ${who}`);
    c = await course(who);
    // the tilt that scores, from the flattest up; the click adds a degree
    let best: number | null = null;
    for (let tilt = -4; tilt <= 40 && best === null; tilt++) {
      for (const turn of [0, 1, -1, 2, -2]) {
        if (scores(who, m.heading + simpleToDeg(turn), tilt, c) >= 0) {
          best = tilt;
          for (let i = 0; i < Math.abs(turn); i++) {
            h.key(turn > 0 ? "left" : "right");
            await h.frame(1);
          }
          break;
        }
      }
    }
    if (best === null) {
      // nothing scores from here: let it sail on a little and look again
      await h.frame(5);
      continue;
    }
    const want = best - 1;
    await pressUntil(signed(m.pitch) < want ? "up" : "down", () => signed(m.pitch) === want, `tilting to ${best}°`);
    const before = actors.get(who)!.poseName;
    h.click(320, 240);
    shots++;
    await h.until(() => !inCannons() || !!props.get("cannon ball")?.visible, "the shot", 20);
    await h.until(() => !inCannons() || !props.get("cannon ball")?.visible, "the ball to land", 200);
    tally();
    if (process.env.TRACE_CANNON) console.log(`  shot ${shots} at ${who} (tilt ${best}): ${before} -> ${actors.get(who)?.poseName}`);
  }
  // the last one's explosion counts it (its `endanim`), and the fourth ends the game
  await h.until(() => !inCannons(), "the last dinghy to go down", 400);
  if (sunk.size !== DINGHIES.length) fail(`the cannons closed with ${sunk.size} of ${DINGHIES.length} dinghies sunk`);
  return shots;
}
