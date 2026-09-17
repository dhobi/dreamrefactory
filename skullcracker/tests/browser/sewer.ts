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
  const at = async (): Promise<{ x: number; y: number }> => {
    const m = /· x (-?\d+), y (-?\d+)/.exec(await say());
    if (!m) fail(`no position in the HUD`);
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
  const move = async (keys: string[], ms: number, opts: { jump?: boolean; until?: RegExp } = {}): Promise<void> => {
    for (const k of keys) await page.keyboard.down(k);
    let waited = 0;
    let last = (await at()).x;
    let stuck = 0;
    while (waited < ms) {
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
  console.log(`ok    and a shut one stops the run dead at x ${stopped.x}, its record's own left edge`);

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
   * `0x435bf7` hangs it eighty pixels below its record's point, which in
   * `hugeroom` is 190 above the floor, and the last seven cels of its rise carry
   * a strike box and no blow pair at all — the grip signature. So it should
   * close on a player walking underneath it, on its own resting y, and hold.
   *
   * It could not. The strike box was being translated as if the cel's rect were
   * measured from the art's top-left, which lifted it by `height - posY` —
   * sixty-four pixels on cel 5030 — and the rise passed straight through you.
   * `0x40e680` copies the rect, negates the x pair if the object is mirrored and
   * hands it to `0x434270`, a rect TRANSLATE, with the object's own `obj+6`.
   * Nothing else. The grab only ever landed once the bush had sunk far enough to
   * make the error back up, which is a grab on the way DOWN.
   */
  await go("x=7470");
  await page.keyboard.down("ArrowRight");
  let grabbed: { state: string; cel: number; bushY: number; playerY: number } | null = null;
  for (let i = 0; i < 90 && !grabbed; i++) {
    const t = await say();
    const b = [...t.matchAll(/bush (\w+) cel (\d+) at x(\d+), y(\d+)/g)].find((m) => Math.abs(Number(m[3]) - 7689) < 300);
    if (/code -3/.test(t) && b) {
      grabbed = { state: b[1], cel: Number(b[2]), bushY: Number(b[4]), playerY: (await at()).y };
    }
    await page.waitForTimeout(80);
  }
  await page.keyboard.up("ArrowRight");
  if (!grabbed) fail(`walking under hugeroom's bush should be grabbed by it — 0x43ee9d's -3; nothing took hold`);
  const g = grabbed!;
  if (g.state === "sink")
    fail(`it should close on you coming UP, not catch you on the way back down; it took hold in ${g.state}`);
  if (g.bushY !== 17321)
    fail(`the bush does not move while it grabs — 0x43ef4a only runs once it has let go; it was at y${g.bushY}`);
  console.log(
    `ok    and its bush closes on a walking player — code -3 on cel ${g.cel} while it ${g.state}s, at its own y${g.bushY}`,
  );

  // 9. the level, played through: five regions, three levers and a ride.
  //    Every one of those levers is in a different region from its door bar the
  //    first, which is what `0x43c430` walking the LEVEL's list is for.
  await go();
  await move(["ArrowRight", "w"], 8000, { jump: true, until: /· x 2[23][0-9][0-9], y 161/ });
  await move([], 7000, { until: /door 1 open[ ·]/ });
  if ((await door(1)) !== "open") fail(`lever 1 did not open door 1 — it is ${await door(1)}`);
  // east over the walkway that bridges the seam, as far as the shaft's ladder —
  // and no further, because the walkway's far end is door 2, which is shut and
  // whose lever is up in the tube room
  await move(["ArrowRight"], 5000, { jump: true, until: /· x 29[0-9][0-9],/ });
  if ((await room()) !== "shaftone") fail(`through door 1 is the first shaft; the HUD says ${await room()}`);
  await move(["ArrowDown"], 9000);
  await move([], 2000);
  await move(["ArrowRight"], 7000, { jump: true, until: /· x 31[5-9][0-9], y 166/ });
  await move([], 7000, { until: /door 7 open[ ·]/ });
  if ((await door(7)) !== "open") fail(`lever 7 did not open door 7 — ${await room()} ${JSON.stringify(await at())} ${/switch 7[^·]*/.exec(await say())?.[0]}`);
  await move(["ArrowRight", "w"], 8000, { jump: true });
  if ((await room()) !== "shafttwo") fail(`through door 7 is the second shaft; the HUD says ${await room()}`);
  await move(["w"], 9000);
  await move(["ArrowRight"], 6000, { jump: true });
  await move(["ArrowRight", "w"], 7000, { jump: true });
  if ((await room()) !== "bigshaft") fail(`east of the second shaft is the big one; the HUD says ${await room()}`);
  await move(["ArrowDown"], 12000, { until: /· x \d+, y 170[0-5][0-9]/ });
  await move(["ArrowLeft"], 6000, { until: /· x 64[5-9][0-9], y 170/ });
  await move([], 7000, { until: /door 4 open[ ·]/ });
  if ((await door(4)) !== "open") fail(`lever 4, one region west of its door, did not open it`);
  console.log(`ok    three levers thrown, and the last of them opened a door in the next region`);

  await move(["ArrowRight"], 9000, { jump: true });
  if ((await room()) !== "hugeroom") fail(`through door 4 is the hall of lifts; the HUD says ${await room()}`);
  await move(["ArrowRight"], 6000, { jump: true });
  await page.keyboard.down("w");
  let up = false;
  for (let i = 0; i < 160 && !up; i++) {
    await page.waitForTimeout(100);
    const m = /lift x9276 \w+ y(\d+)/.exec(await say());
    const me = await at();
    if (m && Number(m[1]) > 17150 && me.y >= 17320) await page.keyboard.press("j");
    if (me.y < 16820) up = true;
  }
  await page.keyboard.up("w");
  if (!up) fail(`never rode a lift to the head of its shaft; stopped at y ${(await at()).y}`);
  await move(["ArrowRight"], 5000, { jump: true, until: /at the goal/ });
  if (!/at the goal|level 7 complete|screen is coming down/.test(await say())) {
    fail(`never reached SEWER's goal; stopped at x ${(await at()).x}, y ${(await at()).y} in ${await room()}`);
  }
  const end = await at();
  console.log(`ok    and the whole level plays through to the goal at x ${end.x}, y ${end.y}`);

  await finish(browser);
  console.log("PASS  SEWER's doors are locks, its levers are keys, and its goal can be reached");
};

await main();
