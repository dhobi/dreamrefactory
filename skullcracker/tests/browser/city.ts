/**
 * CITY's opening, which was impassable — and the two rules that pass it.
 *
 *   npm run dev -w skullcracker                 # in one terminal
 *   npm run test:browser:city -w skullcracker   # in another
 *
 * Level two is a staircase of rooftops with no floor under it (`CITY`'s ground is
 * y7250 for everything east of x691, 2900 pixels below anything it draws), and
 * its first step is the one this page could not take. The file's own numbers:
 *
 *   - a `platform` at `y4041, x1757..1904` — the metal walkway;
 *   - a 103px gap west of it, from the `y4046` platform that ends at x1654;
 *   - a wooden water tank whose roof is a `platform` at `y3920, x1873..2324`;
 *   - and an `obstacle` at `y3852..4160, x1873..1933` — the tank's west wall.
 *
 * So the step up is 121 pixels with a wall in the middle of it, and both of the
 * rules it needs are things this page had wrong:
 *
 * 1. **an obstacle is a point test.** `0x430146` walks the obstacle array against
 *    the object's own point and pushes it out along the smallest of the four
 *    penetrations — so clearing the wall means lifting the ANCHOR past y3852, 101
 *    pixels. Tested as a box, as this page did, it meant lifting all 148 rows of
 *    the sprite past it: 189 pixels, which no jump in the game reaches.
 * 2. **the tuck's feet are 19 pixels higher than the standing pose's.** The
 *    engine's `y` is the cel's anchor and what lands is the cel's own collision
 *    box: standing cel 1's reaches 88 rows below the anchor, the airborne tuck's
 *    (cel 200) reaches 69. So a jump whose anchor rises 105 puts the feet at 3917
 *    against a roof at 3920 — three pixels of margin, and the whole level rests
 *    on them.
 *
 * And the planks, which are the other half of the level: twenty `initplank`
 * records, each sitting inside a `platform` record it OWNS (`0x42fb70`), sagging
 * through cels 1050..1053 under the player and giving way on the sixth crossing at
 * three times the player's gravity.
 *
 * The probe walks the route rather than teleporting onto it, because `?x=` drops
 * the player at the ground under that column and in CITY that is the void.
 */
import { BASE, fail, finish, launch } from "./harness";

const main = async (): Promise<void> => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => fail(`page threw: ${e.message}`));

  await page.goto(`${BASE}/walk.html?level=2`);
  const hud = page.locator("#hud");
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);

  const at = async (): Promise<{ x: number; y: number }> => {
    const t = (await hud.textContent()) ?? "";
    const x = /x (-?\d+)/.exec(t);
    const y = /y (-?\d+)/.exec(t);
    if (!x || !y) fail(`no position in the HUD: ${t.slice(0, 120)}`);
    return { x: Number(x![1]), y: Number(y![1]) };
  };
  const near = (got: number, want: number, slack = 6): boolean => Math.abs(got - want) <= slack;
  /** hold a direction until the player is past `want`, or give up */
  const walkTo = async (want: number): Promise<void> => {
    await page.keyboard.down("ArrowRight");
    for (let i = 0; i < 400 && (await at()).x < want; i++) await page.waitForTimeout(50);
    await page.keyboard.up("ArrowRight");
  };
  /**
   * A running jump east with the lift held, braked by LETTING GO.
   *
   * The engine's air control (`0x429fc1`..`0x42a036`) first runs two frames after
   * the launch, and while forward is held it drives `v.x` to 30 pixels a frame —
   * twice the run. Released, the flight coasts on the launch impulse alone, which
   * is 15, and that is the difference between clearing the walkway this route
   * lands on and stopping on it.
   *
   * It used to tap BACKWARD instead, which is the third branch: `0x429fd5` turns
   * the player round and zeroes the velocity outright. That worked when it landed
   * in the air and threw the jump away when it landed a frame after the feet were
   * down, which is why this suite failed about one run in three. Letting go is
   * the same brake with no edge to fall off: six runs of it land on the same
   * pixel.
   */
  const jump = async (): Promise<void> => {
    await page.keyboard.down("ArrowRight");
    await page.keyboard.down("w");
    // a press is read by the engine FRAME, and one sent in the same millisecond
    // as the key-downs before it can be spent on a frame that has not seen the
    // run yet; when that happens nothing moves at all, so make sure it flew
    let airborne = false;
    for (let tries = 0; tries < 3 && !airborne; tries++) {
      await page.keyboard.press("j");
      for (let i = 0; i < 16; i++) {
        await page.waitForTimeout(25);
        if (/in the air/.test((await hud.textContent()) ?? "")) {
          airborne = true;
          break;
        }
      }
    }
    if (!airborne) fail(`pressing jump never left the ground`);
    await page.keyboard.up("ArrowRight");
    // and stay in the air until the feet are down again, however long that is
    for (let i = 0; i < 70; i++) {
      await page.waitForTimeout(25);
      if (!/in the air/.test((await hud.textContent()) ?? "")) break;
    }
    await page.keyboard.up("w");
    await page.waitForTimeout(400);
  };

  const say = async (): Promise<string> => (await hud.textContent()) ?? "";

  const spawn = await at();
  if (!near(spawn.x, 610, 40)) fail(`CITY should open at its own initplayer, x610; got x ${spawn.x}`);
  console.log(`ok    CITY opens on its ledge at x ${spawn.x}, y ${spawn.y}`);

  /**
   * 1. the first plank — twenty of CITY's records are `initplank` and its route
   *    crosses them. `0x4531d0` sags one under you (cels 1050..1053), counts the
   *    crossing when that animation ends, and on the SIXTH gives way: three times
   *    the player's gravity and the eight cels of it going.
   */
  const plankX = 1180;
  await walkTo(plankX);
  const board = await say();
  if (!/plank (wobble|intact) cel 105\d x1185/.test(board)) {
    fail(`the plank at x1085..1285 should sag underfoot; the HUD says ${/plank[^·]*/.exec(board)?.[0] ?? "nothing"}`);
  }
  console.log(`ok    the first plank sags underfoot: ${/plank[^·]*/.exec(board)?.[0].trim()}`);

  // stand on it and it goes: six crossings is the file's own count
  const stoodAt = (await at()).y;
  let fell = false;
  for (let i = 0; i < 40 && !fell; i++) {
    await page.waitForTimeout(120);
    fell = /plank fall/.test(await say());
  }
  if (!fell) fail(`standing on a plank should break it after ${6} crossings; it held`);
  await page.waitForTimeout(700);
  const dropped = await at();
  if (dropped.y <= stoodAt + 100) fail(`the plank broke but did not take the player with it: y ${dropped.y}`);
  console.log(`ok    six crossings and it gives way, dropping the player from y ${stoodAt} to ${dropped.y}`);

  // and back to the route, from the level's start
  await page.goto(`${BASE}/walk.html?level=2`);
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);

  // 2. east along the rooftops to the lip of the 103px gap
  await walkTo(1630);
  const lip = await at();
  if (!near(lip.y, 4046, 10)) fail(`the walk east should end on the y4046 platform; got y ${lip.y}`);
  console.log(`ok    walked east to the gap's lip at x ${lip.x}, y ${lip.y}`);

  // 3. across it, onto the walkway the file puts at y4041
  await jump();
  const walkway = await at();
  if (!near(walkway.y, 4041, 8)) fail(`the 103px gap should land on the y4041 walkway; got y ${walkway.y}`);
  if (walkway.x < 1760) fail(`the jump did not cross the gap: x ${walkway.x}`);
  console.log(`ok    jumped the gap onto the walkway at x ${walkway.x}, y ${walkway.y}`);

  /**
   * 4. the crows — twelve `initcrow` records, each asleep on its own rect until
   *    the player's point enters it (`0x451ba3`). The walkway is inside the rect
   *    of the one at x1663, so standing here is what wakes it: cels 1835..1838,
   *    then 1840..1853 taking off, then the flight, and it holds a height about a
   *    hundred pixels above the player's own point for as long as it is up.
   */
  const crows = async (): Promise<string> => /· \d+ crows?:[^·]*/.exec(await say())?.[0]?.trim() ?? "";
  if (!/12 crows/.test(await crows())) fail(`CITY places twelve crows; the HUD says ${await crows()}`);
  let woke = "";
  for (let i = 0; i < 60 && !woke; i++) {
    await page.waitForTimeout(150);
    const line = await crows();
    if (/(wake|rise|fly|strike)/.test(line)) woke = line;
  }
  if (!woke) fail(`standing on the walkway should wake the crow whose rect covers it; got ${await crows()}`);
  console.log(`ok    the walkway wakes a crow: ${woke}`);

  // and it flies at the player's height, which is the only motion it has
  let flying = "";
  for (let i = 0; i < 60 && !flying; i++) {
    await page.waitForTimeout(150);
    if (/(fly|strike) cel 1[78]\d\d/.test(await crows())) flying = await crows();
  }
  if (!flying) fail(`the crow should reach its flight cels (1800..1825); got ${await crows()}`);
  const height = Number(/at \d+,(\d+)/.exec(flying)?.[1] ?? "0");
  const eye = (await at()).y - 88;
  if (Math.abs(height - (eye - 100)) > 130) {
    fail(`a crow holds ~100px above the player's point (${eye - 100}); it is at ${height}`);
  }
  console.log(`ok    and holds its height: crow at y ${height} against the player's point ${eye}`);

  // 5. the wall stops a walk — the obstacle ejects west, as `0x430181` does
  await walkTo(2000);
  const stopped = await at();
  if (stopped.x > 1890) fail(`the tank's west wall should stop a walk at x1873; got x ${stopped.x}`);
  if (!near(stopped.y, 4041, 8)) fail(`still on the walkway, please: y ${stopped.y}`);
  console.log(`ok    and the wall stops the walk at x ${stopped.x}, the file's own x1873`);

  // 6. and the jump goes over it onto the tank's roof
  await jump();
  const roof = await at();
  if (!near(roof.y, 3920, 8)) fail(`the jump over the wall should land on the y3920 roof; got y ${roof.y}`);
  if (roof.x < 1940) fail(`landed short of the wall's east edge: x ${roof.x}`);
  console.log(`ok    over the wall onto the tank roof at x ${roof.x}, y ${roof.y}`);

  // 7. the PROBES, which are triggers rather than objects — CITY carries six of
  //    the seventeen in the game and three of the four modes between them.
  //
  //    `0x4280d2` walks the level's own buffer once a frame, tests the player's
  //    point against each record's rect, fires `0x410170` with the record's
  //    `param` as a mode and then `0x402e80` shifts the record out of the table,
  //    so one fires ONCE per level load. What it fires is scenery on
  //    `PLAYER.SBK`'s own cels with no strike box anywhere in it.
  //
  //    The word that held this up for a long time is `obj+0xe`, the divisor
  //    `0x42f8b0` does two `idiv`s by: `0x42f550` zeroes it and nothing in the
  //    spawner writes it. It is the class's own constructor message — `0x4103e2`
  //    writes 1 — so the script's dx goes into the velocity undivided.
  const inTheAir = async (): Promise<string[]> => {
    const t = await say();
    const m = /· \d+ flypast ([^·]*)/.exec(t);
    return m ? m[1].trim().split(" tag").map((v, i) => (i ? `tag${v}` : v)) : [];
  };
  const fire = async (x: number, y: number): Promise<string[]> => {
    await page.goto(`${BASE}/walk.html?level=2&x=${x}&y=${y}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    const seen: string[] = [];
    for (let i = 0; i < 50; i++) {
      await page.waitForTimeout(50);
      for (const v of await inTheAir()) if (!seen.includes(v)) seen.push(v);
    }
    return seen;
  };
  // mode 0 — rect 2240,7930,2600,8000: it comes in from 512 to the WEST
  const west = await fire(7960, 2400);
  if (!west.length) fail(`the mode-0 probe at x7930..8000 fired nothing`);
  const crossCels = west.map((v) => Number(/cel (\d+)/.exec(v)?.[1] ?? 0));
  if (crossCels.some((c) => c < 20200 || c > 20207)) {
    fail(`0x46bdf0 tag 0 is 20200..20207; a crossing showed ${[...new Set(crossCels)].join(" ")}`);
  }
  const xs = west.map((v) => Number(/@(-?\d+),/.exec(v)?.[1] ?? NaN));
  if (!(xs[xs.length - 1] > xs[0])) fail(`mode 0 spawns 512 WEST and crosses east; it went ${xs[0]} -> ${xs[xs.length - 1]}`);
  console.log(`ok    a mode-0 probe fires once and crosses west to east, x${xs[0]} to x${xs[xs.length - 1]} on its 20200s`);

  // mode 2 — rect 2322,8486,2582,8736: the television, up from under your feet
  const under = await fire(8600, 2500);
  if (!under.length) fail(`the mode-2 probe at x8486..8736 fired nothing`);
  const upCels = under.map((v) => Number(/cel (\d+)/.exec(v)?.[1] ?? 0));
  if (upCels.some((c) => c !== 20210 && c !== 20211)) {
    fail(`0x46bdf0 tag 1 is 20210 and 20211; it showed ${[...new Set(upCels)].join(" ")}`);
  }
  const ys = under.map((v) => Number(/,(-?\d+) cel/.exec(v)?.[1] ?? NaN));
  if (!(ys[ys.length - 1] < ys[0])) fail(`mode 2 starts 256 BELOW and rises; it went ${ys[0]} -> ${ys[ys.length - 1]}`);
  console.log(`ok    ...and a mode-2 probe sends the television up past you, y${ys[0]} to y${ys[ys.length - 1]}`);

  /**
   * ...and `initwerec` THROWS, which is the last thing on this page that read
   * the executable and did nothing with it.
   *
   * `0x452b20` is its own projectile creator and the shot it builds is a DUD:
   * `0x452c67` writes no strength, and cels 6004, 6005 and 6006 carry a strike
   * box with no blow pair. `0x452ec0` writes `0x65` as the burst script
   * `0x477c60` becomes the object's state, and only 7000, 7001 and 7002 carry
   * the `dx 43` that turns it into damage. So what this watches for is both
   * halves: a harmless flight, and a flash worth a hundred and one.
   */
  await page.goto(`${BASE}/walk.html?level=2&x=7150&y=4010&foehit=1`);
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  const shots = new Set<string>();
  for (let i = 0; i < 320; i++) {
    const c = /· \d+ cast, nearest cel (\d+) at x (-?\d+), y (-?\d+) blow (-?\d+) vx (-?\d+) vy (-?\d+)/.exec(await say());
    if (c) shots.add(`${c[1]}/${c[4]}`);
    await page.waitForTimeout(60);
  }
  const flight = [...shots].filter((s) => Number(s.split("/")[0]) < 7000);
  const burst = [...shots].filter((s) => Number(s.split("/")[0]) >= 7000);
  if (!flight.length) fail(`initwerec should throw on its own row — 0x4527fd; nothing flew`);
  if (flight.some((s) => s.split("/")[1] !== "0"))
    fail(`0x452c67 writes no strength, so the flight is a dud; it showed ${flight.join(" ")}`);
  if (flight.some((s) => !["6004", "6005", "6006"].includes(s.split("/")[0])))
    fail(`0x477c38 is 6004, 6005 and 6006; the flight showed ${flight.join(" ")}`);
  if (!burst.length) fail(`and it should BURST where it lands — 0x452e00 installs 0x477c60; it never did`);
  if (burst.some((s) => s.split("/")[1] !== "101"))
    fail(`0x452ec0 writes 0x65 as the burst comes up; it showed ${burst.join(" ")}`);
  console.log(`ok    and initwerec throws: ${flight.length} flight cels worth nothing, bursting into ${burst.length} worth 101`);

  /**
   * ...and a crow BURNS, which is the eighth reader of the −9 and the last of
   * them to be given a name.
   *
   * `0x4519d8` writes `0x4520d0` into the `+0x12` of a class with no `init*`
   * string at all — CITY's own `0x451990` registers it — so the owner had to be
   * read off the descriptor. It is `initcrow`, and the chapter agrees: the
   * flamer is CITY's weapon and CITY is the level that perches twelve of these.
   *
   * The spot is the file's. A `statflamer` sits at x8899 on the platform that
   * runs x8791..8998, and the crow whose point is x9086 owns the rect
   * x8901..9271 — so standing on the pickup is inside it, and the crow holds a
   * height about fifty pixels above the player's own point while it is up.
   *
   * What the arm does is a flame, `0x476e58` and nothing else: no damage, no
   * feathers. `0x451e5a` then ends those eight frames with gravity 1.0, the
   * tumble and the same eighty a punch pays.
   */
  await page.goto(`${BASE}/walk.html?level=2&x=8905&y=3600&weapon=10&rounds=120`);
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(700);
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(800);
  await page.keyboard.up("ArrowDown");
  await page.waitForTimeout(300);
  if (!/holding flamer/.test(await say()))
    fail(`CITY's statflamer at x8899 should arm you: ${/· (no|holding)[^·]*/.exec(await say())?.[0]}`);
  // up first, so the flame meets something that is flying rather than perched
  let up = "";
  for (let i = 0; i < 80 && !up; i++) {
    await page.waitForTimeout(120);
    if (/(fly|strike) cel 1[78]\d\d/.test(await crows())) up = await crows();
  }
  if (!up) fail(`the crow at x9086 should wake and fly with the player inside its rect; got ${await crows()}`);
  await page.keyboard.down("p");
  let lit = "";
  for (let i = 0; i < 90 && !lit; i++) {
    await page.waitForTimeout(80);
    if (/fall cel 188\d/.test(await crows())) lit = await crows();
  }
  await page.keyboard.up("p");
  if (!lit) fail(`-9 puts a crow on 0x476e58 — "fall", cels 1884..1887; got ${await crows()}`);
  if (!/alight/.test(await say())) fail(`0x44ff20(self, 3, 0) should hang a flame on it: ${await say()}`);
  console.log(`ok    the flamer sets a crow alight: ${lit}`);
  let down = "";
  for (let i = 0; i < 60 && !down; i++) {
    await page.waitForTimeout(100);
    if (/tumble cel 183\d/.test(await crows())) down = await crows();
  }
  if (!down) fail(`0x451e5a ends the fall in the tumble, 1830..1834; got ${await crows()}`);
  console.log(`ok    ...and the fall ends in the tumble: ${down}`);

  await finish(browser);
  console.log("PASS  CITY's planks give way, its crows wake and burn, its probes fire, its werecs throw and its first step is passable");
};

await main();
