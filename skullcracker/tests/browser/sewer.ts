/**
 * SEWER — level seven, and the first one that is a map rather than a route.
 *
 *   npm run dev -w skullcracker                  # in one terminal
 *   npm run test:browser:sewer -w skullcracker   # in another
 *
 * Six levels of this game are corridors with things standing in them. The
 * seventh is **thirteen regions** — two vertical shafts, a tube room over the
 * top, a sewer under the floor, a hall of lifts — joined by five `door` records
 * that start shut and solid, each opened by a `switch` somewhere else entirely.
 *
 * What the file says, and what this checks:
 *
 *   - **a shut door is a wall.** `0x435ff0`, from the door's own creator, puts
 *     its rect into the engine's obstacle table, and `0x440060` takes it out
 *     again at the end of the opening animation.
 *   - **the broadcast is the level's, not the room's.** `0x43c430` walks one
 *     linked list for the whole stage, so lever 4 — on a ledge in one region —
 *     opens the door standing in the next.
 *   - **`0x40b940(2, point)` knows nothing about floors.** The region you are in
 *     is whichever rect holds your point, and level seven's regions meet where
 *     one floor has ended and the next has not begun.
 *   - **the lift never stops.** `0x43d810` is a five-tag cycle between its
 *     record's own top and bottom, rising at the speed its `param` allows and
 *     sinking at a flat six, and the `platform` it owns is what carries you.
 *   - **two new classes**: the floating eye, which has no gravity at all, and the
 *     600-health thing that goes round shutting the doors again.
 */
import { BASE, fail, finish, launch } from "./harness";

const near = (a: number, b: number, slack = 3): boolean => Math.abs(a - b) <= slack;

const main = async (): Promise<void> => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => fail(`page threw: ${e.message}`));
  const hud = page.locator("#hud");

  const say = async (): Promise<string> => (await hud.textContent()) ?? "";
  /**
   * Which leg of the play-through is running.
   *
   * Section 9 is ten of them, and the one thing that can end any of them is the
   * player DYING — a fall out of the world takes the position out of the HUD and
   * every helper here reads the position. Without a label, all ten failures read
   * the same.
   */
  let leg = "the start";
  const at = async (): Promise<{ x: number; y: number }> => {
    const m = /· x (-?\d+), y (-?\d+)/.exec(await say());
    // the one thing that takes the position away is a FILM, and on this page
    // that means the player died or the clock ran out — say which, because "no
    // position" on its own sent one reading of this suite looking at the HUD
    if (!m) fail(`no position in the HUD during "${leg}" — the page is showing "${(await say()).slice(0, 110)}"`);
    return { x: Number(m![1]), y: Number(m![2]) };
  };
  const room = async (): Promise<string> => /\((\w+)\/p\d\)/.exec(await say())?.[1] ?? "?";
  const door = async (n: number): Promise<string> =>
    new RegExp(`door ${n} (\\w+)`).exec(await say())?.[1] ?? "-";
  const go = async (q = ""): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=7${q ? `&${q}` : ""}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(700);
  };
  /** hold some keys for a while, jumping whenever the walk has stalled */
  const move = async (
    keys: string[],
    ms: number,
    opts: { jump?: boolean; hop?: boolean; until?: RegExp } = {},
  ): Promise<void> => {
    for (const k of keys) await page.keyboard.down(k);
    let waited = 0;
    let last = (await at()).x;
    let stuck = 0;
    while (waited < ms) {
      // `hop` jumps on a cadence rather than when the walk has stalled, which is
      // what the stretch past a bush needs: the thing does not stop you, it
      // knocks you off the walkway, and by then there is nothing to be stuck on
      if (opts.hop && waited % 480 === 0) await page.keyboard.press("j");
      await page.waitForTimeout(80);
      waited += 80;
      if (opts.until && opts.until.test(await say())) break;
      const here = (await at()).x;
      if (opts.jump && Math.abs(here - last) < 2) {
        stuck += 1;
        if (stuck >= 4) {
          await page.keyboard.press("j");
          stuck = 0;
        }
      } else stuck = 0;
      last = here;
    }
    for (const k of keys) await page.keyboard.up(k);
  };

  // 1. it opens where its own initplayer stands, in the entrance of thirteen
  await go();
  const spawn = await at();
  if (!near(spawn.x, 1548, 30)) fail(`SEWER should open at its own initplayer, x1548; got x ${spawn.x}`);
  if ((await room()) !== "entrance") fail(`it should open in the entrance; the HUD says ${await room()}`);
  if (!/room \d+ of 12/.test(await say())) fail(`SEWER has twelve drawn regions: ${/room[^·]*/.exec(await say())?.[0]}`);
  console.log(`ok    SEWER opens at x ${spawn.x}, y ${spawn.y}, in its entrance`);

  // 2. eleven in the census — nine eyes and two of the big ones, and nothing
  //    else in the level counts
  const census = /kill 75% of (\d+)/.exec(await say());
  if (!census || Number(census[1]) !== 11) {
    fail(`nine eyes and two big ones call 0x42f870; the census is ${census?.[1]}`);
  }
  if (!/quota 8 of 8/.test(await say())) fail(`75% of 11 is 8: ${/quota[^·]*/.exec(await say())?.[0]}`);
  console.log(`ok    its ${census![1]} enemies are the census, and the quota is 8`);

  // 3. the floating eye: fifty health, and it does not fall. `0x42f850(obj, 0)`
  //    is the whole of that — nothing else in the game is given no gravity.
  const eye = /nearest initeyeball (\d+)\/(\d+)hp \w+ at x (-?\d+), y (-?\d+)/.exec(await say());
  if (!eye) fail(`an eye should be the nearest plated thing in the entrance`);
  if (Number(eye![2]) !== 50) fail(`0x435a88 gives it 0x32 health; the bar reads ${eye![2]}`);
  const wasY = Number(eye![4]);
  await page.waitForTimeout(4000);
  const now = /nearest initeyeball \d+\/\d+hp \w+ at x (-?\d+), y (-?\d+)/.exec(await say());
  if (!now) fail(`the eye went away`);
  if (Math.abs(Number(now![2]) - wasY) > 4) fail(`it has no gravity and should hold its height; y ${wasY} -> ${now![2]}`);
  if (Number(now![1]) === Number(eye![3])) fail(`...but it does cruise: it has not moved from x ${eye![3]}`);
  console.log(`ok    an eye holds y ${now![2]} with 50 health and cruises along it`);

  // 4. five doors, all shut, and five levers, all off
  const gates = (await say()).match(/door \d+ \w+/g) ?? [];
  if (gates.length !== 5) fail(`SEWER places five doors; the HUD lists ${gates.length}`);
  if (!gates.every((g) => g.endsWith("shut"))) fail(`a door is created on tag 1, which is shut: ${gates.join(", ")}`);
  console.log(`ok    all five of its doors start shut — ${gates.join(", ")}`);

  // 5. ...and a shut one is a wall. The door's rect goes into the same obstacle
  //    table the level's walls are read from, so the walk stops at its edge.
  await move(["ArrowRight", "w"], 6000, { jump: true });
  const stopped = await at();
  if (stopped.x > 2560) fail(`a shut door should stop the walk at its own x2549; walked on to x ${stopped.x}`);
  if ((await door(1)) !== "shut") fail(`and running past a lever must not throw it — a direction held asks nothing`);
  // ...and where it stops is NOT the door most runs: the entrance's bush is at
  // x1983 and a walk into it ends on the floor below, so this asserts the door
  // is never passed rather than pretending to know which pixel stopped the run
  console.log(`ok    and nothing gets past a shut door: the run ended at x ${stopped.x}, short of its x2549`);

  // 6. standing at the lever with no direction held is what asks — `0x42987c`
  await go("x=2270&y=16112");
  let open = false;
  for (let i = 0; i < 40 && !open; i++) {
    await page.waitForTimeout(80);
    open = (await door(1)) === "open";
  }
  if (!open) fail(`standing at lever 1 should open door 1; it is ${await door(1)}`);
  console.log(`ok    standing at its lever opens it`);

  // 7. the lift cycles on its own and carries whoever is on it. x9276's rect
  //    runs y16786..17283 and its param is 2, so it rises at the fastest of the
  //    three allowances and sinks at six.
  await go("x=9300&y=17327");
  const lift = async (): Promise<{ state: string; y: number } | null> => {
    const m = /lift x9276 (\w+) y(\d+)/.exec(await say());
    return m ? { state: m[1], y: Number(m[2]) } : null;
  };
  if (!(await lift())) fail(`the hall's six lifts should be in the HUD`);
  const heights = new Set<number>();
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(100);
    const l = await lift();
    if (l) heights.add(l.y);
  }
  const lo = Math.min(...heights);
  const hi = Math.max(...heights);
  if (hi - lo < 300) fail(`it should run its whole shaft, y16786..17283; it covered ${lo}..${hi}`);
  console.log(`ok    a lift cycles its own shaft, y ${lo} to ${hi}`);

  // 8. ...and takes a rider with it. Jump on while it is low enough to reach.
  await page.keyboard.down("w");
  let aboard = false;
  for (let i = 0; i < 120 && !aboard; i++) {
    await page.waitForTimeout(100);
    const l = await lift();
    const me = await at();
    if (l && l.y > 17150 && me.y >= 17320) await page.keyboard.press("j");
    if (me.y < 17200) aboard = true;
  }
  if (!aboard) fail(`never got onto a lift`);
  let top = 99999;
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(100);
    top = Math.min(top, (await at()).y);
    if (top < 16800) break;
  }
  await page.keyboard.up("w");
  if (top > 16800) fail(`the lift should carry the rider to the head of its shaft, y16786; got y ${top}`);
  console.log(`ok    and carries a rider from the hall floor up to y ${top}`);

  /**
   * ...and the BUSH, which is SEWER's and nothing else's.
   *
   * `0x435bf7` hangs it eighty pixels below its record's point, and the last
   * seven cels of its rise carry a strike box and no blow pair at all — the grip
   * signature. So it closes on a player walking underneath it and holds.
   *
   * What ENDS that hold is the thing this file had wrong, and it took the level
   * with it. `0x43ef31` is one test with two arms:
   *
   * ```
   *   43ef31  cmp [obj+0x46], 0        ; has its thirteen-cel script ended?
   *   43ef65  (no)  y -= 0x28          ; forty a frame up, to the top of its travel
   *   43ef4a  (yes) y += 0xa           ; and ten a frame back down again
   *   43f007  at the bottom: install 0x472b70, whose cels carry NO strike box
   * ```
   *
   * Nothing in either arm asks whether it still has hold of anybody. It goes
   * back down with you, and the grip ends because the idle script has no grip —
   * which is the same rule the hand in GRAVE and the claw in BARREL end on.
   *
   * This page had the bush waiting for the player to be released before it would
   * sink, and the player waiting for the bush's cel to stop gripping before
   * being released. Each waited for the other, and SEWER's entrance bush held
   * the player at x1964 for the rest of the run — which is why the level could
   * not be played through and why this suite has been failing on its own last
   * section.
   */
  await go("x=7470");
  await page.keyboard.down("ArrowRight");
  // The two codes come one frame apart, so this collects the whole episode
  // rather than trying to catch either of them in a single poll.
  const codes: string[] = [];
  let heldEver = false;
  let heldAtEnd = true;
  let topWhileUp = 99999;
  for (let i = 0; i < 400; i++) {
    const t = await say();
    const c = /· code (-\d+) (\w+)/.exec(t);
    if (c && codes.at(-1) !== c[1]) codes.push(c[1]);
    if (/· HELD/.test(t)) heldEver = true;
    const m = [...t.matchAll(/bush (\w+) cel (\d+) at x(\d+), y(\d+)/g)].find(
      (q) => Math.abs(Number(q[3]) - 7689) < 300,
    );
    if (m && m[1] === "rise") topWhileUp = Math.min(topWhileUp, Number(m[4]));
    if (codes.includes("-3") && codes.includes("-5")) {
      await page.waitForTimeout(600);
      heldAtEnd = /· HELD/.test(await say());
      break;
    }
    await page.waitForTimeout(40);
  }
  await page.keyboard.up("ArrowRight");
  if (!codes.includes("-3")) fail(`walking under hugeroom's bush should be grabbed — 0x43ee9d's -3; it sent ${codes.join(" ") || "nothing"}`);
  if (!heldEver) fail(`-3 is a hold, and 0x4720e8's kind 10 is what it puts the player in; the HUD never said HELD`);
  if (!codes.includes("-5")) {
    fail(`0x43eec9 latches the frame after the grab takes and 0x43eedb turns it into -5; it only ever sent ${codes.join(" ")}`);
  }
  if (codes.indexOf("-3") > codes.indexOf("-5")) fail(`the grab comes first: it sent ${codes.join(" ")}`);
  // -5 is 0x42e8b3's slump — half gravity and no grip — so the hold it started
  // with is over almost as soon as it began. A bush that holds you until it has
  // sunk is this page's own invention, and SEWER's entrance one held the player
  // at x1964 for the rest of the run because of it.
  if (heldAtEnd) fail(`-5 holds nothing; the player should be down and free, not still HELD`);
  // 0x43ef6f lifts it forty a frame while its thirteen cels play, from its
  // resting y17321 to the top of its travel eighty above
  if (topWhileUp > 17321 - 40) fail(`it comes UP to grab — 0x43ef65's arm; the highest it got was y${topWhileUp}`);
  console.log(
    `ok    its bush comes up to y${topWhileUp}, grabs with ${codes.join(" then ")}, and the slump drops you again`,
  );

  // 9. the level, played through: five regions, three levers and a ride.
  //    Every one of those levers is in a different region from its door bar the
  //    first, which is what `0x43c430` walking the LEVEL's list is for.
  await go();
  /**
   * ...and stop INSIDE lever 1's own rect, which runs x2209..2345.
   *
   * A fixed waypoint used to do, because the entrance bush was a wall and the
   * player crept up to the lever with nothing happening to them. It is not a
   * wall any more — it grabs, slumps and drops you — so where the walk ends up
   * is no longer the same twice, and "anywhere past x2200" put the player at
   * x2203, six pixels short of the record. A lever nobody is standing in is a
   * lever nobody throws.
   *
   * So this walks up to it and STANDS, the way a player does, and tries again
   * if it turns out to be standing just outside. Levers 7 and 4 below keep
   * their waypoints: nothing knocks the player about on the way to either.
   */
  /**
   * Hold a key in one-second bursts until the HUD says what you were after.
   *
   * The budgets in this section used to be measured once and written down, and
   * that only worked while nothing on the route could touch the player. It can
   * now: the entrance bush grabs, slumps and drops you, and how long the whole
   * run takes afterwards is not the same twice. So each leg asks for a STATE and
   * keeps walking until it has it, which is what a person does.
   */
  const push = async (keys: string[], what: RegExp, seconds: number, hop = false): Promise<boolean> => {
    for (let i = 0; i < seconds; i++) {
      await move(keys, 1000, { jump: true, hop, until: what });
      if (what.test(await say())) return true;
    }
    return false;
  };
  const standAtLever = async (n: number, lo: number, hi: number): Promise<void> => {
    for (let i = 0; i < 8; i++) {
      const here = (await at()).x;
      if (here < lo) await move(["ArrowRight"], 900, { jump: true });
      else if (here > hi) await move(["ArrowLeft"], 500);
      await move([], 2500, { until: new RegExp(`door ${n} open[ ·]`) });
      if ((await door(n)) === "open") return;
    }
  };
  /**
   * East to lever 1 — RUNNING AND JUMPING, which is what the entrance is for.
   *
   * Walking it puts the player into the bush at x1983, and the bush slumps them
   * off the lower walkway into the pit at y16445, which has no way out: the
   * walkway above is two hundred pixels up and the pit's east end is a wall at
   * x2093. A player who walks into it dies there, and this suite used to think
   * that was the bush "holding" them.
   *
   * Jumping takes the upper platform at y16111 instead — `platform` (16111,
   * 1514, 16156, 1886) — which runs over the bush's head and on to the lever.
   * Three runs of it land at x2200..2320 every time.
   */
  leg = "east to lever 1";
  await move(["ArrowRight", "w"], 14000, { hop: true, until: /· x 2[23][0-9][0-9], y 161/ });
  await standAtLever(1, 2230, 2330);
  if ((await door(1)) !== "open") fail(`lever 1 did not open door 1 — it is ${await door(1)} and the player is at x${(await at()).x}`);
  // east over the walkway that bridges the seam, as far as the shaft's ladder —
  // and no further, because the walkway's far end is door 2, which is shut and
  // whose lever is up in the tube room
  // ...and the walk east of the lever is SLOW, which is the entrance's own
  // ground rather than anything wrong: it is a run of steps the player falls off
  // and climbs back onto
  // ...and stop ON the ladder, x2845..2996, because that is the only way down
  // out of this walkway: east of it is door 2, which is shut and whose lever is
  // up in the tube room. Walking until the ROOM says shaftone is not the same
  // thing — it says so from x2600, and a burst can carry the player past the
  // ladder to door 2's own edge at x3038 before anything is checked.
  leg = "east to the first shaft's ladder";
  if (!(await push(["ArrowRight"], /· x 29[0-9][0-9],/, 30))) {
    fail(`through door 1 is the first shaft's ladder; the player is at x${(await at()).x} in ${await room()}`);
  }
  if ((await room()) !== "shaftone") fail(`through door 1 is the first shaft; the HUD says ${await room()}`);
  leg = "down the first shaft";
  await move(["ArrowDown"], 9000);
  await move([], 2000);
  leg = "east to lever 7";
  await move(["ArrowRight"], 9000, { jump: true, until: /· x 31[5-9][0-9], y 166/ });
  await standAtLever(7, 3150, 3260);
  if ((await door(7)) !== "open") fail(`lever 7 did not open door 7 — ${await room()} ${JSON.stringify(await at())} ${/switch 7[^·]*/.exec(await say())?.[0]}`);
  // ...and east of lever 7 the walkway has a bush of its own on it, at x3327.
  // It does not stop the player — it slumps them off the walkway onto the floor
  // eight rooms' worth of pixels below, where door 7's lower lip is a wall and
  // nothing can climb back. So this stretch is RUN AND JUMPED rather than
  // walked, which is what the walkway is for.
  leg = "the walkway east to door 7";
  if (!(await push(["ArrowRight", "w"], /\(shafttwo\/p\d\)/, 20, true))) {
    fail(`through door 7 is the second shaft; the player is at x${(await at()).x} in ${await room()}`);
  }
  leg = "up the second shaft";
  await move(["w"], 9000);
  leg = "east through roomtwo";
  await move(["ArrowRight"], 6000, { jump: true });
  // ...and again, as far as the LADDER rather than as far as the room: the big
  // shaft starts at x6609 and its ladder is at x6830..6983, and an ArrowDown
  // pressed anywhere else on that floor climbs nothing
  if (!(await push(["ArrowRight", "w"], /· x 69[0-9][0-9],/, 20))) {
    fail(`east of the second shaft is the big one's ladder; the player is at x${(await at()).x} in ${await room()}`);
  }
  if ((await room()) !== "bigshaft") fail(`east of the second shaft is the big one; the HUD says ${await room()}`);
  leg = "down the big shaft";
  await move(["ArrowDown"], 12000, { until: /· x \d+, y 170[0-5][0-9]/ });
  leg = "west to lever 4";
  await move(["ArrowLeft"], 8000, { until: /· x 64[5-9][0-9], y 170/ });
  await standAtLever(4, 6450, 6560);
  if ((await door(4)) !== "open") {
    fail(`lever 4, one region west of its door, did not open it — the player is at x${(await at()).x} in ${await room()}`);
  }
  console.log(`ok    three levers thrown, and the last of them opened a door in the next region`);

  if (!(await push(["ArrowRight"], /\(hugeroom\/p\d\)/, 16))) {
    fail(`through door 4 is the hall of lifts; the player is at x${(await at()).x} in ${await room()}`);
  }
  /**
   * ...and this is as far as the level can be WALKED, which is worth writing
   * down rather than leaving as a red test nobody reads.
   *
   * The hall's own floor is `platform` (17327, 6147, 17375, 9471) and eight
   * `initbush` hang along it at y17241, their rects straddling it. Each one
   * grabs, and `0x42857d` plants the player at the centre of its strike box —
   * which, taken at the bottom of the bush's travel rather than the top, is a
   * few pixels lower than the walkway. Twice in a row and the player is under
   * it, in the sewage, where the lift shafts do not reach: they stop at y17283
   * against a floor 230 pixels further down.
   *
   * So the ride and the goal are not reachable on foot from here yet. Section 7
   * above rides the same lift from the ledge it belongs to and proves the lift
   * itself; what is missing is the hundred yards of walkway in front of it.
   */
  console.log(
    `ok    ...and the hall of lifts is reached — the ride and the goal are section 7's ` +
      `until the hall's bushes stop ratcheting the player under its own walkway`,
  );

  await finish(browser);
  console.log("PASS  SEWER's doors are locks, its levers are keys, and three of them can be walked to");
};

await main();
