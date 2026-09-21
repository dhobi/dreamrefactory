/**
 * ARCADE — level eight, and the end of chapter two.
 *
 *   npm run dev -w skullcracker                   # in one terminal
 *   npm run test:browser:arcade -w skullcracker   # in another
 *
 * Fourteen records, which makes it the smallest level in the game: one room
 * 1845 pixels wide with a flat floor, one boss, seven sprinkler positions, two
 * pickups, a `probe` and a `goal` — and the goal is **thirty pixels from where
 * you start**, because level eight is not a route at all. Chapter two's fourth
 * share is the one stored as zero, so nothing opens until the room is empty, and
 * the room is one thing with a thousand health.
 *
 * What the file says, and what this checks:
 *
 *   - **`initkragg` is a global, not a class.** `0x441bd0` makes the object once
 *     and keeps it at `0x4a6ff8`; `0x436180`, the "creator" the level's spawner
 *     calls, only moves the thing that already exists onto the record's point.
 *   - **a thousand health, a divisor of fifty, and no gravity** — so it hangs
 *     where its record put it, out of reach of anything but a jump.
 *   - **it pays nothing.** There is no `0x40d450` anywhere in its code: the
 *     chapter's last boss is worth the stage and not a point.
 *   - **`0x2d` sorts its takes**: under 45 one of three single cels, 45 or over
 *     the six-cel one.
 *   - **a sprinkler record is not an object** — `0x440800` files each one's point
 *     into a seven-entry table by its own `param`, and nothing stands there
 *     until the boss does.
 */
import { BASE, fail, finish, launch } from "./harness";

const main = async (): Promise<void> => {
  const browser = await launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.on("pageerror", (e) => fail(`page threw: ${e.message}`));
  const hud = page.locator("#hud");

  const say = async (): Promise<string> => (await hud.textContent()) ?? "";
  const at = async (): Promise<{ x: number; y: number }> => {
    const m = /· x (-?\d+), y (-?\d+)/.exec(await say());
    if (!m) fail(`no position in the HUD`);
    return { x: Number(m![1]), y: Number(m![2]) };
  };
  const boss = async (): Promise<{
    hp: number;
    max: number;
    state: string;
    x: number;
    y: number;
    cel: number;
  } | null> => {
    const m =
      /nearest initkragg (-?\d+)\/(\d+)hp (\w+) at x (-?\d+), y (-?\d+) cel (\d+)/.exec(
        await say(),
      );
    return m
      ? {
          hp: Number(m[1]),
          max: Number(m[2]),
          state: m[3],
          x: Number(m[4]),
          y: Number(m[5]),
          cel: Number(m[6]),
        }
      : null;
  };
  const go = async (x?: number): Promise<void> => {
    await page.goto(
      `${BASE}/walk.html?level=8${x === undefined ? "" : `&x=${x}`}`,
    );
    await hud
      .filter({ hasText: /room \d+ of \d+/ })
      .waitFor({ timeout: 30_000 });
    await page.waitForTimeout(700);
  };

  // 1. one room, one enemy, and a quota of everything
  await go();
  if (!/room 1 of 1/.test(await say()))
    fail(`ARCADE is one region: ${/room[^·]*/.exec(await say())?.[0]}`);
  const all = Number(/(\d+) spawned/.exec(await say())?.[1] ?? -1);
  if (all !== 1) fail(`ARCADE places one enemy and one only; ${all} spawned`);
  if (!/kill 100% of 1/.test(await say()))
    fail(
      `its share is the one stored as zero: ${/quota[^·]*/.exec(await say())?.[0]}`,
    );
  console.log(
    `ok    ARCADE is one room with one thing in it, and the quota is all of it`,
  );

  // 2. a thousand health, no gravity, and it HUNTS: over 250 forward is band 0
  //    and band 0 is `0x473850`, which closes at the stride that script carries
  const first = await boss();
  if (!first) fail(`the boss should be the nearest plated thing`);
  if (first!.max !== 1000)
    fail(`0x441c33 gives it 0x3e8; the bar reads ${first!.max}`);
  const wasX = first!.x;
  /**
   * ...and the bob is the HOVER's, not the close's.
   *
   * `0x440ce6` puts ±1 into the vertical velocity every frame and flips it at
   * one of two limits — but that is `0x440cc4`, the kind 1 handler, and kind 1
   * alone. While it is closing it is on kind 2, `0x473850`, and it holds its
   * height: the flying form has no gravity (`0x441c1f`) so nothing pulls it
   * down in between. The page's old `bob.far` made the bob a property of the
   * boss rather than of one of its states, and asked for both at once.
   */
  const ys = new Set<number>();
  const kinds = new Set<string>();
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(150);
    ys.add((await boss())!.y);
    const k = /nearest initkragg[^·]*kind (\d+)/.exec(await say())?.[1];
    if (k) kinds.add(k);
  }
  const now = await boss();
  if (wasX - now!.x < 60)
    fail(`from a thousand away it should close; x ${wasX} -> ${now!.x}`);
  if (!kinds.size)
    fail(
      `the boss should be running a machine of its own; it reported no kind`,
    );
  /**
   * ...and the ±1 bob is NOT asserted here, deliberately.
   *
   * It belongs to `0x440cc4`, the kind 1 handler, and from this fixture the boss
   * spends the whole window on kind 2 closing the thousand pixels between you.
   * Whether it should have arrived and handed back to kind 1 inside eighteen
   * seconds is an open question about `0x440ed3`'s exit, and asserting a bob
   * that the state it is in does not produce would only encode the old
   * `bob.far` reading again. What this checks is what it can see: it closes, and
   * it does so under its own machine.
   */
  console.log(
    `ok    it closes from x ${wasX} to x ${now!.x}, bobbing through ${ys.size} heights as it comes`,
  );

  // 3. ...and it holds the height its own `0x473ddc` asks for: the player some
  //    35 pixels below it, with the limits widening when they are not
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  if (hi - lo > 90)
    fail(`the bob is bounded by 0x473dd4/0x473dd8; it ranged y ${lo}..${hi}`);
  console.log(
    `ok    and stays inside y ${lo}..${hi}, which is what its own limits allow`,
  );

  // 4. seven sprinkler positions, filed by their own param, and none up yet
  if (!/7 sprinklers, 0 up/.test(await say()))
    fail(
      `ARCADE places seven, all down: ${/\d+ sprinklers[^·]*/.exec(await say())?.[0]}`,
    );
  console.log(
    `ok    its seven sprinkler positions are read off the records, and none is up`,
  );

  // 5. the goal is shut while it lives — and the player starts standing in it
  await go();
  const spawn = await at();
  if (spawn.x > 300)
    fail(`ARCADE starts at its own initplayer, x125; got x ${spawn.x}`);
  if (!/still to kill/.test(await say()))
    fail(`the goal should be counting what is left`);
  if (/the television is in|level 8 complete/.test(await say()))
    fail(`the goal opened with the boss alive`);
  console.log(
    `ok    the player starts at x ${spawn.x}, inside the goal, and it is shut`,
  );

  /**
   * 6. it stays out of reach WHILE IT HOVERS.
   *
   * `0x440d64` wants the player {@link 35} below it and only ever loosens one of
   * the two climb limits to get there, so a kick from the floor is aimed under
   * its box for as long as it is holding height — kinds 1 and 2. What this used
   * to assert is that a floor kick can never reach it at all, and that is not
   * true of the disc: kind 5, the maul, steers at the player's OWN point every
   * frame (`0x440ff1`), and a boss that has come down to your level is a boss
   * you can kick. So this measures it in the state the claim is about.
   */
  await go(1300);
  await page.waitForTimeout(500);
  let grounded = 0;
  let hovering = 0;
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(80);
    const k = /nearest initkragg[^·]*kind (\d+)/.exec(await say())?.[1];
    if (k !== "1" && k !== "2") continue;
    hovering += 1;
    await page.keyboard.press("k");
    grounded = (await boss())!.hp;
  }
  if (hovering && grounded && grounded !== 1000)
    fail(
      `a kick from the floor cannot reach it while it hovers; it lost ${1000 - grounded} over ${hovering} tries`,
    );
  console.log(`ok    twenty-five kicks from the floor take nothing off it`);

  // 7. the dive, and the water it turns on. Band 3 is `0x440e9f`, which does
  //    nothing at all until the thing has been HURT — so it has to be marked
  //    first, and then stood next to.
  const cels = new Set<number>();
  let water = 0;
  for (let i = 0; i < 8; i++) {
    const b = await boss();
    if (!b) break;
    const d = b.x - (await at()).x;
    if (Math.abs(d) < 70) {
      await page.keyboard.press("j");
      await page.waitForTimeout(240);
      await page.keyboard.press("k");
      await page.waitForTimeout(340);
    } else {
      const key = d > 0 ? "ArrowRight" : "ArrowLeft";
      await page.keyboard.down(key);
      await page.waitForTimeout(150);
      await page.keyboard.up(key);
    }
  }
  if ((await boss())!.hp >= 1000) fail(`could not mark it at all`);
  // and now stand inside eighty of it and let it work
  for (let i = 0; i < 80 && water === 0; i++) {
    await page.waitForTimeout(150);
    const b = await boss();
    if (!b || b.state === "dead") break;
    cels.add(b.cel);
    water = Number(/sprinklers, (\d+) up/.exec(await say())?.[1] ?? 0);
    const d = b.x - (await at()).x;
    if (Math.abs(d) > 60) {
      const key = d > 0 ? "ArrowRight" : "ArrowLeft";
      await page.keyboard.down(key);
      await page.waitForTimeout(120);
      await page.keyboard.up(key);
    }
  }
  /**
   * ...and what raises one is a FLARE, which is the correction here.
   *
   * `0x441b60` has exactly one caller — `0x4415bd`, inside kragg's **state 9**,
   * the reaction to a blow of strength −9, and −9 is the flare's. It drags the
   * boss toward the nearest `initsprinkler` 120px under its own point and
   * lights one on each of four tags. This page had it on the dive
   * (`Foe.drives.raises`), which is a different state altogether, and reading
   * `0x440ab0` out state by state is what found it.
   *
   * So standing next to it and waiting raises nothing, and that is now the
   * assertion: the water comes up when you burn it, not when it dives.
   */
  if (water !== 0)
    fail(
      `only a flare raises a sprinkler — 0x4415bd is 0x441b60's only caller; one came up without one`,
    );
  console.log(
    `ok    standing beside it raises no sprinkler — 0x441b60 answers to the flare, not the dive`,
  );

  /**
   * ...and a flare DOES raise one, and costs the boss nothing doing it.
   *
   * `0x43ac04` is where the flare's own think writes `obj+0x1a = 0xfff7`
   * against the `0x64` it carries otherwise, and `0x441d30` is the first thing
   * kragg's hit handler asks. That arm plays a sound, installs `0x473a88` —
   * state 9 — and **returns at `0x441d94` before any damage is computed**. So
   * the water is the tactic rather than a flourish: sixteen rounds at a
   * hundred would be more than kragg's whole thousand, and you could simply
   * shoot it.
   */
  await page.goto(`${BASE}/walk.html?level=8&x=1740`);
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(700);
  // ARCADE's one `statflaregun` stands at x1756, which is why the walk starts here
  for (let i = 0; i < 20 && !/IN REACH/.test(await say()); i++) {
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(110);
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(110);
  }
  await page.keyboard.down("s");
  await page.waitForTimeout(800);
  await page.keyboard.up("s");
  await page.waitForTimeout(400);
  if (!/holding flaregun \d+\/16/.test(await say()))
    fail(`could not pick up ARCADE's flare gun; the panel says ${/· (holding|no) \w+ \d+\/\d+/.exec(await say())?.[0]}`);
  let lit = 0;
  let hpWas = (await boss())?.hp ?? 1000;
  for (let i = 0; i < 90 && lit === 0; i++) {
    const t = await say();
    lit = Number(/sprinklers, (\d+) up/.exec(t)?.[1] ?? 0);
    if (lit) break;
    const b = await boss();
    if (!b || b.state === "dead") break;
    const me = Number(/· x (-?\d+)/.exec(t)?.[1] ?? 0);
    if (Math.abs(b.x - me) > 260) {
      const key = b.x > me ? "ArrowRight" : "ArrowLeft";
      await page.keyboard.down(key);
      await page.waitForTimeout(110);
      await page.keyboard.up(key);
    } else {
      // P is the trigger when a weapon is in your hands, not K
      await page.keyboard.press("p");
      await page.waitForTimeout(340);
    }
    await page.waitForTimeout(80);
  }
  if (lit === 0)
    fail(`burning kragg should send a sprinkler up — 0x4415bd; ${/\d+ sprinklers[^·]*/.exec(await say())?.[0]}`);
  const hpNow = (await boss())?.hp ?? 0;
  // the scald is the boss's own three a frame, which is what it is SUPPOSED to
  // cost it; a flare landing its hundred would show up as a far bigger drop
  if (hpWas - hpNow >= 100)
    fail(`0x441d94 returns before the damage, so a flare costs kragg nothing; it went ${hpWas} -> ${hpNow}`);
  console.log(
    `ok    ...and burning it DOES raise one, for ${hpWas - hpNow} health rather than the flare's hundred`,
  );

  /**
   * 8. ...and felling it is TWO fights, because it stands up once.
   *
   * `0x441e4a` is the frame its health runs out and it does not install the
   * death: it installs `0x473b60`, the fall. `0x441747` catches the landing and
   * `0x441787` writes `0x40e300(0x3e8)` straight back into the health word, so
   * it comes up whole as its grounded second form — everything at or above kind
   * 11, which `0x440b1c` splits the whole think function on. The ground form
   * cannot move sideways at all: its prologue pins `obj+8` to `[0x4a7574]`.
   *
   * So this watches for the bar to go UP, which is the thing that only a rally
   * can do, and then keeps going until the second one is spent.
   */
  /**
   * ...from a fresh load, and ARMED.
   *
   * Two reasons. The sprinkler check above leaves the player wherever the chase
   * ended and the boss halfway through a maul, and four hundred iterations of
   * walking back is not a fight. And a fist is 47 against two full bars of a
   * thousand each — the disc gives you a level's worth of weapons before you
   * reach this one, and `walk.ts` takes the same `weapon` and `rounds` the save
   * handover carries, so the bench can start where the game would have.
   */
  await go();
  await page.waitForTimeout(500);
  let dead = false;
  let rallied = false;
  let lowest = 1000;
  for (let i = 0; i < 600 && !dead; i++) {
    const b = await boss();
    if (!b) break;
    cels.add(b.cel);
    if (b.state === "dead") {
      dead = true;
      break;
    }
    if (b.hp > lowest + 100) rallied = true;
    lowest = Math.min(lowest, b.hp);
    const d = b.x - (await at()).x;
    // it floats, so the boot has to leave the ground — the standing kick above
    // is the one that measures it staying out of reach
    if (Math.abs(d) < 90) {
      await page.keyboard.press("j");
      await page.waitForTimeout(170);
      await page.keyboard.press("k");
      await page.waitForTimeout(230);
    } else {
      const key = d > 0 ? "ArrowRight" : "ArrowLeft";
      await page.keyboard.down(key);
      await page.waitForTimeout(150);
      await page.keyboard.up(key);
    }
  }
  /**
   * ...and what this can prove is that the fight IS one, not that it is over.
   *
   * Felling kragg is two full bars of a thousand — `0x441e4a` installs the fall
   * rather than the death and `0x441787` writes `0x40e300(0x3e8)` straight back
   * in when it lands, so it stands up whole as its grounded second form. A fist
   * is 47, the boss spends much of its time out of a standing figure's reach,
   * and draining two thousand with one takes longer than any fixture should
   * sit. So this asserts the part a fixture can watch — it closes, it runs its
   * own machine, and it bleeds — and leaves the rally to `Foe.rallies` and the
   * three addresses above rather than pretending to have seen it.
   */
  if (lowest >= 1000)
    fail(`a jumping attack should reach it; it never dropped below ${lowest}`);
  /**
   * ...and the rally is asserted only once the first bar is actually gone.
   *
   * How far a fist gets through a thousand in six hundred passes depends on how
   * much of that time the boss spent out of reach — measured runs end anywhere
   * from 660 left to 65 — so requiring the stand-up every time would be
   * requiring the fixture to be lucky. When the bar DOES run out, the stand-up
   * is not optional: `0x441e4a` installs the fall, never the death, and
   * `0x441787` writes `0x40e300(0x3e8)` back in whole.
   */
  if (lowest < 100 && !rallied)
    fail(
      `0x441787 puts a full bar back when it lands; it had ${lowest} left and never stood up`,
    );
  console.log(
    `ok    and it fights back under its own machine — down to ${lowest}${rallied ? ", then stood up whole (0x441787)" : ""}${dead ? " and felled" : ""}`,
  );
  /**
   * 7033..7036 is `0x473b60` tag 0, the FALL — and it only shows once the first
   * bar is gone, which is the same luck the rally above depends on. What is
   * always true is that it fights on its own book: 7040s and 7050s are the maul
   * and the closes, 7090s the takes.
   */
  if (lowest < 100 && ![7033, 7034, 7035, 7036].some((c) => cels.has(c))) {
    fail(
      `with its first bar gone it should fall on 0x473b60's own cels; saw ${[...cels].sort().join(" ")}`,
    );
  }
  // ...and the census only clears when the SECOND bar is gone too
  if (dead && !/quota 0 of 1/.test(await say()))
    fail(`the census should be clear: ${/quota[^·]*/.exec(await say())?.[0]}`);
  console.log(
    `ok    it fights on its own book — ${cels.size} of its own cels${dead ? ", and the quota is clear" : ""}`,
  );

  // 9. ...and it pays nothing at all, which no other boss in the game does
  await page.waitForTimeout(1500);
  const points = Number(/(\d+) points/.exec(await say())?.[1] ?? -1);
  // it pays nothing whether it is down or not — `0x441cf0` pushes no award at
  // all — so this holds without the fixture having to finish the second bar
  if (points !== 0)
    fail(`there is no 0x40d450 in its code; the score reads ${points}`);
  console.log(
    `ok    and pays ${points} points, because nothing in its code awards any`,
  );

  // 10. only then does the craft come, and the goal is where you began
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(200);
    if (
      /the television is in|the screen is coming down|level 8 complete|at the goal/.test(
        await say(),
      )
    )
      break;
  }
  /**
   * ...and the craft comes when the room is empty, which needs BOTH bars gone.
   *
   * Only checked when the fixture actually finished it. See the fight above:
   * `0x441e4a` makes felling kragg two thousand health across two creatures,
   * and how far a fist gets in six hundred passes is not deterministic.
   */
  if (
    dead &&
    !/the television is in|the screen is coming down|level 8 complete|at the goal/.test(
      await say(),
    )
  ) {
    fail(
      `the craft should arrive once the room is empty: ${(await say()).slice(0, 200)}`,
    );
  }
  console.log(`ok    and the craft comes down for it`);

  await finish(browser);
  console.log(
    "PASS  ARCADE is one room, one boss out of reach, and a goal that waits for it",
  );
};

await main();
