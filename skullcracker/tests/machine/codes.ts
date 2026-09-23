/**
 * The blow CODES — a negative `obj+0x1a`, which is a message and not damage.
 *
 *   npx tsx tests/machine/codes.ts        (from skullcracker/)
 *
 * `0x448c72` reads the sign before anything else and jumps through the table at
 * `0x4492b8`, so there are exactly eight of them and the dispatch is dense. This
 * walks the three the levels can actually deliver:
 *
 *   - **-3, the grab.** GRAVE's hand under your feet. The hold is the fist: of
 *     the hand's eleven cels only 1556 and 1562 carry a strike box, and
 *     `0x42857d` re-reads that box every frame and plants you at its centre.
 *   - **-7**, the same class out of its rect rather than under you, which is a
 *     knockdown and not a hold.
 *   - **-4**, TOWER's surge.
 *
 * See `src/codes.ts` for the census of who sends what and for the two codes
 * nothing sends.
 */
import { fail, headless, ok, pass } from "./harness";

const h = await headless("level=9&x=640");
const { game } = h;
const { p, stats } = game;

/** the reaction the player is playing, by the code that installed it — or null */
const code = (): { code: number; act: string } | null =>
  Object.values(game.BLOW_CODES).find((r) => r.act === p.act) ?? null;
const reacting = (n: number, act: string): boolean => {
  const c = code();
  return c !== null && c.code === n && c.act === act;
};
/** held, with the gravity `0x448ef4` takes away for a grab */
const held = (): boolean => p.heldBy !== null && p.gravityScale === 0;
/** the nearest of the level's hands, by where its rise is happening */
const hand = () => {
  const q = [...game.hereOf((l) => l.hands)].sort((a, b) => Math.abs(a.atX - p.x) - Math.abs(b.atX - p.x))[0];
  if (!q) fail(`no hand near x ${p.x}`);
  return q;
};
const claw = () => {
  const c = game.hereOf((l) => l.claws)[0];
  if (!c) fail(`no claw near x ${p.x}`);
  return c;
};
const go = async (query: string): Promise<void> => {
  await h.load(query);
  // ...and let the spawn settle: the anchor goes on the point and drops
  let was = "";
  h.until(() => {
    const now = `${Math.round(p.x)},${Math.round(p.y)}`;
    const still = p.onGround && now === was;
    was = now;
    return still;
  }, 30);
};

// 1. the hand under your feet carries -3, and only its CLOSED cel has a grip
await go("level=9&x=640");
h.hold("right", true);
const took = h.until(() => reacting(-3, "grabbed") || held(), 180);
h.hold("right", false);
if (took < 0) fail(`GRAVE's hand at x794 sends -3 and nothing took hold: hand ${hand().state} at x${hand().atX}`);
if (!held()) fail(`0x448ef4 sets the player's gravity to 0 for a grab; it is ${p.gravityScale}, held ${p.heldBy !== null}`);
const grip = hand();
if (!grip.underfoot) fail(`the hand holding on should be the underfoot one, param 0`);
const gripCel = game.handCel(grip);
if (gripCel !== 1556) fail(`only 1556 carries a grip; it is holding on cel ${gripCel}`);
ok(`the hand's -3 takes hold after ${took} frames, on the one cel of eleven that has a strike box`);

// 2. ...and it is pinned to the grip rather than to where it was standing
const heldAt = p.x;
if (Math.abs(heldAt - grip.atX) > 40)
  fail(`the grip is the centre of the fist's box; the player is at ${heldAt} and the hand at ${grip.atX}`);
ok(`and plants the player at the centre of that box — x ${heldAt} against the hand's ${grip.atX}`);

/**
 * ...and the player held is ONE person.
 *
 * There are two players in `PLAYER.SBK` and `0x402950` picks between them on
 * `0x46b1a8`: character 0 is `0x428080` and the 4xxx cels, character 1 is
 * `0x442ad0` and the 9xxx. Each has its own eight-slot reaction table —
 * `0x42eda8` against `0x4492b8` — and this port once read character 1's while
 * playing character 0, so the grab installed 9570..9572 and the hold that
 * followed installed 4570..4572: two different people every other frame.
 */
const worn = new Set<number>();
for (let i = 0; i < 16; i++) {
  h.frame();
  if (code()?.code === -3 || p.heldBy) worn.add(game.lastCel);
}
const wrong = [...worn].filter((c) => c >= 9000);
if (wrong.length) fail(`the hold is character 0's 4570..4572; it also showed character 1's ${wrong.join(" ")}`);
if (!worn.size) fail(`saw no player cel at all through the hold`);
ok(`...as ONE person — ${[...worn].sort().join(" ")}, character 0's own, no 9xxx among them`);

// 3. the fist opens and that, and only that, is what lets go — `0x4285b8`.
//    It is read while the fist is open: the hand sinks, comes up again and
//    closes on whoever still stands over it, under a second later
const opened = h.until(() => hand().underfoot && ["sinking", "down", "up"].includes(hand().state), 135);
if (opened < 0) fail(`the hand never opened again`);
const free = h.until(() => ["sinking", "down", "up"].includes(hand().state) && !p.heldBy, 9);
if (free < 0) fail(`the grip went (${hand().state}) and the hold did not`);
// ...and walks out of it — though the hand under your feet comes up again
// under whoever still stands over it, so this reads the farthest free point
h.hold("right", true);
let farthest = heldAt;
for (let i = 0; i < 22; i++) {
  h.frame();
  if (!p.heldBy && Math.abs(p.x - heldAt) > Math.abs(farthest - heldAt)) farthest = p.x;
}
h.hold("right", false);
if (Math.abs(farthest - heldAt) < 20) fail(`released and still pinned at x ${p.x}`);
ok(`the fist opening is what lets go, and the player walks out of it — x ${heldAt} to ${farthest}`);

// 4. the SAME class out of its rect carries -7, which is a knockdown.
//    ...and it comes up at a RANDOM x across its own rect (`0x420d4b`), so this
//    stands in the middle of one and waits for a roll that lands on the player
await go("level=9&x=4500");
const seven = h.until(() => reacting(-7, "downBack"), 450);
if (seven < 0) fail(`GRAVE's param-1 hands send -7 (0x420e3b); never saw one land`);
if (p.heldBy) fail(`-7 is 0x448d24 — a knockdown, and it takes hold of nothing`);
ok(`the hand that comes up anywhere sends -7 instead, ${seven} frames in, and holds nothing`);

// 5. TOWER's surge, and -4 is the one reaction with two animations in it.
//    ...and it is only live once a lightning period: `0x426829` switches it on as
//    the level's counter wraps (202 engine frames), and the arc then hops down
//    its column 75 at a time every six frames (`0x426b5a`) — so it reaches a
//    player standing 600 below its top about sixteen seconds in
await go("level=12&x=17967&y=15100");
const four = h.until(() => reacting(-4, "shocked"), 450);
if (four < 0) fail(`TOWER's initsurge carries -4 (0x426a90); the player is playing ${p.act ?? "nothing"}`);
ok(`and the surge's -4 shocks you, out of 0x4721a0 tag 3, ${four} frames in`);

// 6. none of it is damage, and the switch has nothing to do with it. And "no
//    row spends health" was character 1's table, not this one: `-1` is
//    `0x42eb2b`, `0x402ac0(0x14)`, twenty off — behind the switch like every
//    other way the game takes a point, which is why it stays full here
if (game.damageOn) fail(`this ran with the damage switch on; the point is that it does not matter`);
if (stats.health !== stats.maxHealth) fail(`a code took health with the switch off: ${stats.health}/${stats.maxHealth}`);
ok(`with damage off throughout — a code is a message, and nothing spent a point`);

// 7. ...and BARREL's claw, which is the same -3 out of a different class.
//    `0x41734a` sends it diving off the tracker's band table (180, 140, 100),
//    the dive is an ordinary hundred, and the CLAMP that follows a connected
//    dive is what carries the code — `0x417485`.
await go("level=14&x=8200");
const dived = h.until(() => claw().state === "dive", 135);
if (dived < 0) fail(`the claw reaches at 140px; it never dived: ${claw().state} at x${Math.round(claw().x)}`);
// the clamp is ten frames and the grab inside it shorter still, so this waits
// for the HOLD and the pose on the same frame
const clamped = h.until(() => p.heldBy !== null && claw().state === "clamp", 126);
if (clamped < 0) fail(`a dive that connects clamps (0x417448) and the clamp takes hold; never saw both`);
const clawCel = game.clawCel(claw());
if (clawCel < 2456 || clawCel > 2459) fail(`only 2456..2459 carry a grip; it is holding on ${clawCel}`);
ok(`and BARREL's claw dives, clamps on its own ${clawCel} and holds you with the same -3`);

pass(`the blow codes are carried: -3 holds you by the art, -7 floors you, -4 shocks you`);
