/**
 * What the player can do off the ground — the flight's attacks, and a fall off
 * an edge that was never a jump.
 *
 *   npx tsx tools/runmachine.mts air        (from skullcracker/)
 *
 * All of it out of `SC.EXE`:
 *
 *   - the player's scripts never loop (`0x45d070` clears `obj+0x4a`), so an
 *     air kick or punch that runs out HOLDS its last cel, and tags 8 and 9
 *     (`0x42a1e3`) end only once the tag is done and the player is down
 *     (`0x42a33a`) — no second attack in one jump, and a kick that lands early
 *     plays out on the ground before the landing tag;
 *   - the same handler steers and lifts as tag 0 does (`0x42a2d1`), on the
 *     ground too;
 *   - walking off an edge leaves the player in the IDLE (`0x42999e`) and
 *     running off in the run's tag 1 (`0x429bf0`), and neither handler asks for
 *     a floor before J, P or K: the idle's J is the standing jump, three
 *     frames of wind-up in the air and then -35 on top of the fall; the run's
 *     is tag 4 at once; their P and K are the GROUND moves;
 *   - the flying kick's tag 4 holds 688 until it falls at 32 or lands
 *     (`0x42a7d5`), and tag 3 holds 689 to the ground and then gives the idle,
 *     with no landing tag (`0x42a784`).
 */
import { fail, headless, ok, pass } from "./harness";

const h = await headless("level=1&foes=0");
const { game } = h;
const p = game.p;
// read afresh each time: a frame changes them behind TypeScript's narrowing
const act = (): string | null => p.act;
const fall = (): string | null => p.fallState;

/** a standing jump from the street, with K pressed on the frames given */
async function jump(kicks: number[], forward: boolean, frames: number, each: (f: number) => void): Promise<void> {
  await h.load("level=1&foes=0");
  h.until(() => p.onGround, 50);
  h.frame(3);
  h.press("jump");
  for (let f = 1; f <= frames; f++) {
    if (kicks.includes(f)) h.press("kick");
    if (forward && f === 6) h.hold("right", true);
    h.frame(1);
    each(f);
  }
  h.hold("right", false);
}

// 1. a kick early in the flight runs out in the air and HOLDS; K again is refused
{
  const seen: string[] = [];
  let held689 = 0;
  let landedWith = "";
  await jump([6, 10], false, 18, (f) => {
    seen.push(`${f}:${p.act ?? "-"}:${game.lastCel}`);
    if (f >= 9 && !p.onGround) {
      if (p.act !== "airKick") fail(`the air kick let go mid-air on frame ${f}: ${seen.join(" ")}`);
      if (game.lastCel === 689) held689 += 1;
    }
    if (p.onGround && p.landLeft > 0 && !landedWith) landedWith = `${p.act ?? "-"} ${p.landLeft}`;
  });
  if (held689 < 3) fail(`the kick's last cel was not held to the ground: ${seen.join(" ")}`);
  if (!landedWith.startsWith("-"))
    fail(`landing after a spent kick gave "${landedWith || "no landing tag"}", wanted the landing tag alone`);
  ok(`an air kick that runs out holds 689 for ${held689} frames to the ground, and a second K is refused`);
}

// 2. a kick late in the flight lands and plays out on the ground, steering all the way
{
  let groundKick = 0;
  let steered = true;
  let landing = -1;
  let kickEnded = -1;
  await jump([11], true, 20, (f) => {
    if (p.act === "airKick" && p.onGround) {
      groundKick += 1;
      if (p.landLeft > 0) fail(`the landing tag started under a kick still playing`);
    }
    if (p.act === "airKick" && p.vx !== 30) steered = false;
    if (kickEnded < 0 && f > 11 && p.act !== "airKick") kickEnded = f;
    if (landing < 0 && p.landLeft > 0) landing = f;
  });
  if (!groundKick) fail(`the late kick did not play on after landing`);
  if (!steered) fail(`forward held did not keep the kick at 30 a frame (0x42a313)`);
  if (landing !== kickEnded) fail(`the landing tag came on frame ${landing}, the kick ended on ${kickEnded}`);
  ok(`a late kick plays ${groundKick} frames on the ground at 30 a frame, and the landing waits for it`);
}

/** level 3's first ledge, off the east end at x1016, walked or run */
async function offTheEdge(run: boolean): Promise<void> {
  await h.load("level=3&foes=0");
  h.until(() => p.onGround, 100);
  h.frame(3);
  h.hold("right", true);
  if (run) h.hold("up", true);
  if (h.until(() => !p.onGround, 400) < 0 || p.launched) fail(`never walked off level 3's first ledge`);
  h.hold("right", false);
  h.hold("up", false);
}

// 3. walked off: still the idle, and its J is the standing jump — in the air
{
  await offTheEdge(false);
  if (p.fallState !== "idle") fail(`walking off the edge left fallState ${p.fallState}, wanted the idle`);
  h.press("jump");
  h.frame(1);
  if (p.windup !== 3 || p.onGround) fail(`J off the edge did not start the wind-up in the air (windup ${p.windup})`);
  h.until(() => p.windup === 1, 5);
  const before = p.vyRaw;
  h.frame(1);
  if (!p.launched) fail(`the wind-up in the air never launched`);
  // the launch record's -35 lands on the fall, and the frame's gravity after it
  if (p.vyRaw !== before - 35 + 10) fail(`the launch took the fall from ${before} to ${p.vyRaw}, wanted ${before - 25}`);
  ok(`off the edge on foot, J winds up in the air and adds -35 to a fall of ${before}`);
}

// 4. run off: the run's tag 1, and J is tag 4 at once, dx 180 and all
{
  await offTheEdge(true);
  if (fall() !== "run") fail(`running off the edge left fallState ${fall()}, wanted the run`);
  const vx = p.vx;
  h.press("jump");
  h.frame(1);
  if (!p.launched || !p.leap) fail(`J off the edge at a run did not leap at once`);
  if (p.vx !== vx + 15) fail(`the run's leap took vx ${vx} to ${p.vx}, wanted +15`);
  ok(`off the edge at a run, J is the running leap at once, vx ${vx} to ${p.vx}`);
}

// 5. and their P and K are the ground's moves, not the flight's
{
  await offTheEdge(false);
  h.press("kick");
  h.frame(1);
  if (p.act !== "kick") fail(`K off the edge on foot gave ${p.act}, wanted the idle's kick`);
  h.until(() => !p.act, 20);
  if (!p.onGround && p.fallState !== "idle") fail(`the kick ended in the air into ${p.fallState}, wanted the idle`);
  ok(`K off the edge on foot is the standing kick, and it hands back to the idle`);

  await offTheEdge(false);
  h.press("punch");
  h.frame(1);
  if (!/^punch2?$/.test(p.act ?? "")) fail(`P off the edge gave ${p.act}, wanted a punch`);
  ok(`P off the edge is the ground punch (${p.act})`);
}

// 6. the run's K is the flying kick, and its tail holds 689 to the ground
{
  await offTheEdge(true);
  h.press("kick");
  h.frame(1);
  if (act() !== "flyingKick") fail(`K off the edge at a run gave ${act()}, wanted the flying kick`);
  let tail = 0;
  let tailVy = 0;
  h.until(() => {
    if (p.act === "flyingKickEnd" && !tail) tailVy = p.vyRaw;
    if (p.act === "flyingKickEnd" && !p.onGround && game.lastCel === 689) tail += 1;
    return p.onGround;
  }, 30);
  if (tailVy < 32) fail(`tag 3 came in at a fall of ${tailVy}, before 32`);
  if (tail < 2) fail(`the flying kick's tail did not hold 689 to the ground (${tail})`);
  h.frame(2);
  if (p.act || p.landLeft) fail(`the flying kick landed into ${p.act ?? "a landing tag"}, wanted the idle`);
  ok(`the flying kick holds 689 for ${tail} frames and lands straight into the idle`);
}

pass(`the air's attacks end on the ground, and a fall off an edge still answers J, P and K`);
