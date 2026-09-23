/**
 * The eight actions, and the key map that binds them.
 *
 *   npx tsx tests/machine/controls.ts        (from skullcracker/)
 *
 * Everything a key or a thumb on the pad does ends in the same eight `held`
 * flags — the pad's buttons, the keyboard and the headless harness all set
 * them — so what each action PRODUCES is the game's to answer, and is answered
 * here: walking, the run, the jump, the crouch, the two strikes and the pair of
 * them. The pad's own buttons, where they stand and when they hide, are the
 * page's (`pad.ts` in the browser suites).
 *
 * And the eight are only the defaults. The preferences panel (`0x45d5a0`, the
 * menu's) rebinds them — `0x46b210` is what it writes and `keyTable` is what
 * reads it — so the second half is the panel's own arithmetic over its fourteen
 * `.data` rects, and a rebound key still bound when the level stands up.
 */
import { PREFS_ACTIONS, PREFS_CONTROLS, bindKey, defaultPrefs, savePrefs, volumeAt } from "../../src/prefs";
import { fail, headless, memoryStorage, ok, pass } from "./harness";

// ---- the panel's arithmetic, before any level is stood up -----------------

/** the control under a point, `0x45d640`'s loop over the fourteen rects */
const hit = (x: number, y: number) =>
  PREFS_CONTROLS.find((c) => x >= c.left && x <= c.right && y >= c.top && y <= c.bottom);
const prefs = defaultPrefs();
// difficulty is +1 easy, 0 medium, -1 hard (0x448ac2's health)
if (prefs.difficulty !== 0) fail(`the panel should open on the middle difficulty, not ${prefs.difficulty}`);
const hard = hit(226, 233)?.role;
const easy = hit(130, 233)?.role;
if (hard?.kind !== "difficulty" || hard.value !== -1) fail(`0x4791e8's box stores -1 (0x45d7ae); (226,233) is ${JSON.stringify(hard)}`);
if (easy?.kind !== "difficulty" || easy.value !== 1) fail(`0x4791d8's box stores 1 (0x45d788); (130,233) is ${JSON.stringify(easy)}`);
ok(`the three difficulty boxes are the disc's own rects: hard -1, easy +1`);

// ...the eight key boxes. `0x45d72f` stores the box index in `[0x47917c]` and
// `0x45d810` binds the next character typed — unless one of the eight already
// has it, which is the loop at `0x45d824` refusing before the jump table.
const toward = hit(254, 155)?.role;
const run = hit(254, 80)?.role;
if (toward?.kind !== "key" || toward.action !== 2) fail(`0x479190 is action 2's box; (254,155) is ${JSON.stringify(toward)}`);
if (run?.kind !== "key" || run.action !== 1) fail(`0x479188 is action 1's box; (254,80) is ${JSON.stringify(run)}`);
if ((prefs.keys[1] as string) !== "D") fail(`action 2 ships bound to D (0x46b210), not ${prefs.keys[1]}`);
if (bindKey(prefs, 2, "z") !== null || (prefs.keys[1] as string) !== "Z") fail(`0x45d810 should have bound Z to action 2; it is ${prefs.keys[1]}`);
if (bindKey(prefs, 1, "z") === null || (prefs.keys[0] as string) !== "W") fail(`Z is spoken for, so 0x45d824 refuses it for action 1; action 1 is ${prefs.keys[0]}`);
ok(`a key box binds the next character typed, and refuses one already spoken for`);

// ...the slider, control 9: a click 45 pixels in, and `0x45d743` divides by ten
const slider = hit(122 + 45, 207);
if (slider?.role.kind !== "volume") fail(`(167,207) should be the slider; it is ${JSON.stringify(slider?.role)}`);
if (volumeAt(122 + 45, slider) !== 4) fail(`45px into 0x4791d0 over ten is 4 (0x45d743); got ${volumeAt(122 + 45, slider)}`);
if (hit(130, 180)?.role.kind !== "music") fail(`(130,180) is 0x4791f0, the music box`);
// ...and control 8, the one rect whose handler returns zero and so ends
// `0x45d5a0`'s loop — the only way out of the panel the original has
if (hit(412, 224)?.role.kind !== "ok") fail(`(412,224) is 0x4791c8, the way out (0x45d73f)`);
ok(`the slider takes the click's own x, and the music box and the way out are where the disc put them`);

// the panel saves on every change; the level reads the store once, at load
memoryStorage();
savePrefs(prefs);
const h = await headless("level=1&x=9700");
const { game } = h;

// ---- the binding outlives the panel ----------------------------------------
if (game.KEYS["z"] !== "right" || game.KEYS["Z"] !== "right") fail(`Z was bound to action 2; the level maps it to ${game.KEYS["z"]}`);
if (game.KEYS["d"] !== undefined) fail(`D was rebound away from action 2; the level still maps it to ${game.KEYS["d"]}`);
if (PREFS_ACTIONS[1].held !== "right") fail(`action 2 is toward, which this page holds as "right"`);
{
  const from = game.p.x;
  h.hold(game.KEYS["z"], true);
  h.frame(18);
  h.hold(game.KEYS["z"], false);
  h.frame(10);
  if (game.p.x - from <= 20) fail(`Z was bound to action 2; holding it moved the player ${game.p.x - from}px`);
  ok(`...and the level honours it: Z walks ${game.p.x - from}px and D is bound to nothing`);
}

// ---- what each action produces ---------------------------------------------

/** hold some actions for a number of frames and gather what the player did */
const hold = (keys: (keyof typeof game.held)[], frames: number) => {
  const seen = { walking: false, running: false, air: false, crouch: false, acts: new Set<string>() };
  for (const k of keys) h.hold(k, true);
  for (let f = 0; f < frames; f++) {
    h.frame();
    const p = game.p;
    if (p.act) seen.acts.add(p.act);
    if (!p.onGround && !p.climbing) seen.air = true;
    else if (p.crouching) seen.crouch = true;
    else if (p.moving) {
      if (p.running) seen.running = true;
      else seen.walking = true;
    }
  }
  for (const k of keys) h.hold(k, false);
  return seen;
};
/** let a strike or a landing finish before the next leg */
const settle = (): void => {
  if (h.until(() => game.p.onGround && !game.p.act && !game.p.moving, 60) < 0)
    fail(`the player never came to rest: act ${game.p.act}, onGround ${game.p.onGround}`);
};

// right, and left — twelve frames is eight hundred milliseconds of a thumb
const walkFrom = game.p.x;
const walked = hold(["right"], 12);
if (game.p.x - walkFrom < 60) fail(`RIGHT held for 12 frames moved the player ${walkFrom} -> ${game.p.x}`);
if (!walked.walking || walked.running) fail(`RIGHT alone should walk, not run: ${JSON.stringify(walked)}`);
ok(`RIGHT walks east (x ${walkFrom} -> ${game.p.x})`);

// released is RELEASED: a key that stays held is the failure a pad on glass has
h.frame(6);
const stopped = game.p.x;
h.frame(6);
if (game.p.x !== stopped || game.p.moving) fail(`the player is still walking with nothing held (${stopped} -> ${game.p.x})`);
ok(`letting go stops the walk`);

const backFrom = game.p.x;
hold(["left"], 12);
if (backFrom - game.p.x < 60) fail(`LEFT held for 12 frames moved the player ${backFrom} -> ${game.p.x}`);
ok(`LEFT walks west (x ${backFrom} -> ${game.p.x})`);
settle();

// UP is the run, and it is not the jump: two actions (1 and 8), two states
const ran = hold(["right", "up"], 12);
if (!ran.running) fail(`UP with a direction is not the run: ${JSON.stringify(ran)}`);
if (ran.air) fail(`UP jumped as well, which is the old page's one-finger compromise`);
ok(`UP with a direction RUNS, and does not jump`);
settle();

const jumped = hold(["jump"], 14);
if (!jumped.air) fail(`JUMP never left the ground`);
ok(`JUMP leaves the ground`);
settle();

const ducked = hold(["down"], 8);
if (!ducked.crouch) fail(`DOWN is not the crouch: ${JSON.stringify(ducked)}`);
ok(`DOWN crouches`);
settle();

// the strikes. `punch` doubles as `punch2` (0x42a400 tosses a coin between two
// animations); the kick picks its tag from the keys alone (0x42a670)
const punched = hold(["punch"], 10);
if (![...punched.acts].some((a) => /^punch2?$/.test(a))) fail(`PUNCH threw no punch: ${[...punched.acts].join(",")}`);
ok(`PUNCH punches (${[...punched.acts].join(",")})`);
settle();

const kicked = hold(["kick"], 10);
if (!kicked.acts.has("kick")) fail(`KICK kicked nothing: ${[...kicked.acts].join(",")}`);
ok(`KICK kicks`);
settle();

// both at once — the original's P+K, the 650s headbutt (`0x429706`)
const butted = hold(["punch", "kick"], 10);
if (!butted.acts.has("headbutt")) fail(`PUNCH and KICK together are not the headbutt: ${[...butted.acts].join(",")}`);
ok(`PUNCH and KICK together are the headbutt`);

// a walk into a wall is thrown back, not stopped: CITY's floor climbs 167px at
// x5639, and the mover's wall branch (`0x42fef3`) has no test of the feet —
// the point goes back the frame's vx and the vx keeps a quarter, on the ground
// as in a jump
await h.load("level=1&foes=0&x=5560&y=2700");
h.until(() => h.game.p.onGround, 60);
h.frame(4);
h.hold("right", true);
const bounced: number[] = [];
for (let i = 0; i < 30; i++) {
  h.frame();
  bounced.push(h.game.p.x);
}
h.hold("right", false);
const back = bounced.filter((x, i) => i > 0 && x < bounced[i - 1]).length;
if (Math.max(...bounced) >= 5639) fail(`the 167px step at x5639 is a wall; the walk reached x ${Math.max(...bounced)}`);
if (back < 5) fail(`walking into the wall should throw the player back frame after frame (0x42ff13); ${back} of 30 frames went back: ${bounced.join(" ")}`);
ok(`walking into CITY's step at x5639 throws the player back ${back} frames of 30, never past x ${Math.max(...bounced)}`);

pass(`all eight actions do what they say, and the key map that binds them survives the walk to the level`);
