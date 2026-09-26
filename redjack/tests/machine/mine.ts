/**
 * The mine carts under Blackbeard's fortress (mc1–mc3.sett, mine.shop,
 * mine.cast), ridden with the harpoon gun.
 *
 * As the scripts have it:
 *
 *   - **the gun** fires where the VIEW looks, not where the pointer is: a click
 *     anywhere (mc1.sett mousedown → `h gun` fire) launches a harpoon from just
 *     ahead of the camera along `currentdeg ()` and `camerapitch ()` (mine.shop
 *     launcher `launch`, `throw`), and it hits a man its projected point lands
 *     on (`checkhit`, `pointinactor`) — a thrown dagger or bomb, too, at the
 *     middle of the screen (`prelimhit`, 322,240).
 *   - **the view** turns with the pointer: the sets put `margin` at 310, so
 *     only a strip in the middle of the screen stands still (`region`), and
 *     further out it turns faster (`getdegree`).
 *   - **Jan's men** (`spawn`) come up from cover, run at the cart or throw;
 *     each dies to one harpoon, and the last of a set's sends the cart on
 *     (`numkills` → `h gun` move → master `nextset`): three sets, then the
 *     crash, Bone, and the sword (bcombat.stag).
 *
 * So the gunner lays the gun on the nearest man, and fires whenever the
 * harpoon the view would throw — worked out as `launch` and `move` fly it —
 * lands on anyone, a dagger or a bomb on its way included.
 */
import type { Headless } from "./harness";

const FOE = /^(jan|dagger|molotov) \d+$/;
/** mine.shop launcher `launch`/`throw`: a harpoon starts 100000 ahead, 190000 up the pitch less 50000, and flies 80010 a pass */
const START = 100000;
const RISE = 190000;
const DROP = 50000;
const SPEED = 80010;
/** `lowcheck`'s reach: a man is only asked about within this of the harpoon */
const REACH = 253023;
/** a whole turn, as the scripts count angles */
const TURN = 2 ** 24;

type Actor = NonNullable<ReturnType<Headless["session"]["actorRuntime"]["get"]>>;

export async function rideTheMine(h: Headless, done: () => boolean): Promise<number> {
  const actors = h.session.actorRuntime;
  let shots = 0;
  let cool = 0;
  let target: Actor | undefined;
  await h.until(
    () => {
      if (done()) return true;
      const m = h.session.maze;
      const cam = m?.camera();
      const eye = m?.spriteCamera(640, 480);
      if (!m || !cam || !eye || h.session.stageName !== "none" || m.view !== "node" || h.owner() !== "world") return false;
      const world = { x: cam.x, y: cam.y, z: cam.z, deg: 0, f: 0, cx: 320, cy: 240, clipW: 640, clipH: 480, v5: eye };
      const live = [...actors.actors.values()].filter((a) => FOE.test(a.name) && a.visible && a.poseName !== "death");
      if (cool > 0) cool--;
      // the harpoon this view would throw, pass by pass, and whom it would hit
      // (`checkhit`: within reach, and its projected point on the man's sprite)
      const [cH, sH, sP] = [Math.cos(cam.heading), Math.sin(cam.heading), Math.sin(cam.pitch)];
      const boxes = new Map(live.map((a) => [a, actors.spriteBox(a, world)]));
      const hits = (a: Actor): boolean => {
        const box = boxes.get(a);
        if (!box) return false;
        for (let k = 1; k <= 40; k++) {
          const d = START + SPEED * k;
          const hx = cam.x + d * cH;
          const hy = cam.y + d * sH;
          const hz = cam.z + RISE * sP - DROP + SPEED * k * sP;
          if (Math.hypot(a.worldX - hx, a.worldY - hy) >= REACH) continue;
          const q = eye.project(hx, hy, hz);
          if (q && box.covers(Math.round(q.x), Math.round(q.y))) return true;
        }
        return false;
      };
      // the harpoon leaves three passes after the click (`makeloop … launch 3`),
      // along the view as it is then: so the view holds still till it has gone
      if (cool > 2) {
        h.session.setPointer(320, 240);
        return false;
      }
      if (cool === 0 && live.some(hits)) {
        h.click(320, 240);
        shots++;
        cool = 6;
        return false;
      }
      // the one to lay the gun on: the nearest of Jan's men still up, kept
      // till he is down or gone back into cover
      const men = live.filter((a) => a.name.startsWith("jan "));
      const dist = (a: Actor): number => Math.hypot(a.worldX - cam.x, a.worldY - cam.y);
      if (!target || !men.includes(target)) target = men.sort((a, b) => dist(a) - dist(b))[0];
      const a = target;
      if (!a) {
        h.session.setPointer(320, 240);
        return false;
      }
      // where the harpoon will be on screen when it is as far off as he is
      const D = dist(a);
      const k = Math.max(1, Math.round((D - START) / SPEED));
      const q = eye.project(cam.x + (START + SPEED * k) * cH, cam.y + (START + SPEED * k) * sH, cam.z + RISE * sP - DROP + SPEED * k * sP);
      let eH: number;
      let eP: number;
      const box = boxes.get(a) ?? actors.spriteBox(a, world);
      let mid: { x: number; y: number } | null = null;
      if (box && q && box.x + box.w > -100 && box.x < 740 && box.y + box.h > -100 && box.y < 580) {
        // the middle of what his sprite covers, sampled over its box
        let [sx, sy, n] = [0, 0, 0];
        const step = Math.max(2, Math.round(Math.min(box.w, box.h) / 12));
        for (let y = Math.ceil(box.y); y < box.y + box.h; y += step) {
          for (let x = Math.ceil(box.x); x < box.x + box.w; x += step) {
            if (box.covers(x, y)) [sx, sy, n] = [sx + x, sy + y, n + 1];
          }
        }
        mid = n ? { x: sx / n, y: sy / n } : { x: box.x + box.w / 2, y: box.y + box.h / 2 };
      }
      if (mid && q) {
        // screen pixels to angle, across the view's width
        const perPx = cam.fov / 640;
        eH = -(mid.x - q.x) * perPx;
        eP = -(mid.y - q.y) * perPx;
      } else {
        // off the screen: turn toward him, and pitch toward his chest
        eH = ((Math.atan2(a.worldY - cam.y, a.worldX - cam.x) - cam.heading + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
        eP = Math.atan2(a.worldZ + 100000 - cam.z, D) - cam.pitch;
      }
      // the pointer past the still strip (x 310–329, y 233–247) by as much as
      // the view has to turn (mc1.sett `region`): a point d past the margin
      // turns the view d × 699045 / 1240
      // a call inside half the margin and d × 699045 / 310 beyond it, and a call
      // comes every other pass (`idle` ends in a `forceupdate`); so ask for
      // half the error a call, in whichever band gives it
      const push = (e: number): number => {
        const units = (Math.abs(e) / 2) * (TURN / (2 * Math.PI));
        if (units < 155 * (699045 / 1240)) return Math.max(2, units / (699045 / 1240));
        if (units < 155 * (699045 / 310)) return 154;
        return Math.min(225, units / (699045 / 310));
      };
      const x = Math.abs(eH) < 0.002 ? 320 : eH > 0 ? 310 - push(eH) : 330 + push(eH);
      const y = Math.abs(eP) < 0.002 ? 240 : eP > 0 ? 232 - push(eP) : 248 + push(eP);
      h.session.setPointer(Math.round(x), Math.round(y));
      return false;
    },
    "the mine carts",
    60_000,
  );
  h.session.setPointer(320, 240);
  return shots;
}
