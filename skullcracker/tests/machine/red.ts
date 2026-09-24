/**
 * The red after a death — `0x429392`, the dying state's handler on the frame
 * its script ends.
 *
 *   npx tsx tools/runmachine.mts red        (from skullcracker/)
 *
 *   - the life goes first (`0x4293eb`);
 *   - then fifty steps of `0x434680(firstredclut, redclut, step, 50)`, one a
 *     sixtieth (`0x42942d` spins on `0x4087c0`), with NOTHING else running;
 *   - then state 27 lies still for 25 frames, or 40 when `0x42fad0` finds a
 *     creature in the 512x512 round the player (`0x429465`), counted from the
 *     value before the decrement (`0x4294a6`);
 *   - then the palette back (`0x4294c3`) and the checkpoint (`0x402760`).
 *
 * The CLUTs are `SC.EXE`'s resources `RAW/CLUT.FIRSTREDCLUT` (all pure red) and
 * `RAW/CLUT.REDCLUT` (the system palette's red channel), so the pixel rule is
 * checked as numbers here and drawn by the page.
 */
import { fail, headless, ok, pass } from "./harness";

const h = await headless("level=1&foes=0");
const { game } = h;
const { p, stats } = game;

// 1. the pixel rule: solid red at the start, the red channel at the end
{
  const at = (rgb: [number, number, number], step: number): string => game.reddened(...rgb, step).join(",");
  if (at([0, 51, 0], 1) !== "250,0,0") fail(`step 1 of a red-less colour is ${at([0, 51, 0], 1)}, wanted 250,0,0`);
  if (at([204, 102, 51], 25) !== "230,0,0") fail(`step 25 of red 204 is ${at([204, 102, 51], 25)}, wanted 230,0,0`);
  if (at([204, 102, 51], 50) !== "204,0,0") fail(`REDCLUT keeps the red channel alone; got ${at([204, 102, 51], 50)}`);
  if (at([0, 0, 0], 10) !== "0,0,0" || at([255, 255, 255], 10) !== "255,255,255")
    fail(`entries 0 and 255 are black and white in every palette and stay so`);
  ok(`the red: 0x434680's blend from solid red to each colour's own red channel`);
}

/** kill the player where they stand and follow the red to the checkpoint */
async function die(query: string): Promise<{ near: boolean; hold: number; frozen: boolean; lay: boolean }> {
  await h.load(query);
  h.until(() => p.onGround, 50);
  h.frame(5);
  const lives = stats.lives;
  game.takeHealth(100000);
  if (h.until(() => game.deathRed !== null, 200) < 0) fail(`the dying script never ended into the red`);
  if (stats.lives !== lives - 1) fail(`the life goes as the red begins (0x4293eb): ${lives} to ${stats.lives}`);
  // the fade: a step a tick, and the world holds still for all fifty
  const clock = stats.ticks;
  const drawn = game.backdropFrames;
  let frozen = true;
  for (let step = game.deathRed!.step; step < 50; ) {
    game.tick();
    const now = game.deathRed!.step;
    if (now !== step + 1) fail(`the fade went from step ${step} to ${now} in one sixtieth`);
    step = now;
    if (stats.ticks !== clock || game.backdropFrames !== drawn) frozen = false;
  }
  const near = !game.nobodyNear(p.x, p.y - p.feet, 512, 512);
  // state 27: count the engine frames it lies there, in the dying pose
  let frames = 0;
  let lay = true;
  while (game.deathRed && frames < 100) {
    h.frame(1);
    frames += 1;
    if (game.deathRed && p.act !== "dying") lay = false;
  }
  return { near, hold: frames, frozen, lay };
}

// 2. nobody about: fifty frozen sixtieths, then 25 counted from before the decrement
{
  const r = await die("level=1&foes=0");
  if (!r.frozen) fail(`the world moved during the fade — 0x429404 blocks`);
  if (r.near) fail(`level 1 with no creatures found one within 256`);
  if (r.hold !== 27) fail(`state 27 with nobody near lasted ${r.hold} frames, wanted 27 (25, 0x4294a6's count before the decrement, and the frame it ends on)`);
  if (!r.lay) fail(`the body got up during the red — state 27 installs nothing (0x429454)`);
  if (p.act !== null || stats.health !== stats.maxHealth) fail(`after the red the checkpoint should have them up and whole: ${p.act} ${stats.health}`);
  ok(`the fade holds the world still for 50 sixtieths, the body lies ${r.hold} frames, and the checkpoint follows`);
}

// 3. a creature beside the body: forty
{
  const r = await die("level=1&x=2350");
  if (!r.near) fail(`a werewolf stands at CITY x2391, within 256 of x2350 (0x42fad0)`);
  if (r.hold !== 42) fail(`state 27 with a creature near lasted ${r.hold} frames, wanted 42 (40)`);
  ok(`with a creature within 256 the body lies ${r.hold} frames instead`);
}

pass(`a death reddens the screen the way 0x429392 does, and only then goes back to the checkpoint`);
