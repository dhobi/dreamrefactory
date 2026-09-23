/**
 * Does the player move at the speed `SC.EXE` moves them at?
 *
 *   npx tsx tests/machine/speed.ts        (from skullcracker/)
 *
 * The chain, all of it out of the executable:
 *
 *   - the walk script `0x471920` carries `dx 95` a frame and the run script
 *     `0x471988` `dx 180`, and `0x42f8b0` adds `round_away(dx / 12)` — the
 *     player's `obj+0xe` (`0x42e412`) — to the velocity: 8 and 15;
 *   - the ground takes `v × 5734 >> 13` back every frame that ends on it
 *     (`0x4302a4`), so the velocity settles at 12 walking and 22 running;
 *   - an engine frame is a fifteenth of a second (`0x40e4f0`), so 180 and 330
 *     pixels a second;
 *   - and W is both the run and the ladder: `0x429990` reads `[0x4ac3fe]` as the
 *     run and `0x42ae50` reads it as a rung, 35 pixels a four-frame tag — 131 a
 *     second.
 *
 * Measured in engine frames, exactly: nothing here waits on a clock.
 */
import { FPS, fail, headless, ok, pass } from "./harness";

// no creatures: a werewolf stands east of the spawn, and its shove (`0x430680`)
// is SC's but is not the speed this file measures
const h = await headless("level=1&foes=0");
const { game } = h;
ok(`the street opens at x ${game.p.x}`);

/** hold the keys, let the speed settle, then measure px/s over whole frames */
let wasRunning = false;
const rate = (keys: ("right" | "up")[], frames: number): number => {
  for (const k of keys) h.hold(k, true);
  h.frame(10);
  const x0 = game.p.x;
  h.frame(frames);
  const x1 = game.p.x;
  wasRunning = game.p.running;
  for (const k of keys) h.hold(k, false);
  h.frame(10);
  return (Math.abs(x1 - x0) * FPS) / frames;
};

// 1. the walk, settled at 12 a frame
const walk = rate(["right"], 30);
if (walk !== 180) fail(`the walk is ${walk}px/s, wanted 180 (dx 95 / 12, settled at 12 by 0x4302a4)`);
ok(`walks at ${walk}px/s — twelve a frame`);

// 2. the run: W held
const run = rate(["right", "up"], 30);
if (run !== 330) fail(`the run is ${run}px/s, wanted 330 (dx 180 / 12, settled at 22)`);
if (!wasRunning) fail(`holding W did not make the player run`);
ok(`runs at ${run}px/s — twenty-two a frame`);

// 3. W at the foot of the ladder climbs instead
await h.load("level=1&x=9700&foes=0");
const y0 = game.p.y;
h.hold("up", true);
h.frame(9);
if (!game.p.climbing) fail(`W at the foot of the ladder did not climb`);
const y1 = game.p.y;
if (y1 >= y0) fail(`W on the ladder went from y${y0} to y${y1} — it ran instead of climbing`);
const span = 36;
h.frame(span);
const y2 = game.p.y;
h.hold("up", false);
const climb = ((y1 - y2) * FPS) / span;
if (Math.abs(climb - 131.25) > 1) fail(`the climb is ${climb}px/s, wanted 131 (35px a rung, 4 frames a rung)`);
ok(`and on the ladder the same key climbs, y ${y0} to y ${y2} at ${climb}px/s`);

pass(`the walk, the run and the ladder all move at the executable's rates`);
