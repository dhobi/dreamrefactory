/**
 * TOWER — level twelve, the end of chapter three, and the only level in the
 * game that is climbed rather than crossed.
 *
 *   npm run dev -w skullcracker                  # in one terminal
 *   npm run test:browser:tower -w skullcracker   # in another
 *
 * Its five regions stack: the player comes in at (18020, 16285) and the goal is
 * at (17602, 15120), 1165 pixels straight up, with the boss standing on it.
 *
 *   - **the floor** (`initfloor`), five of them, and it is level nine's grave
 *     told the other way round: no health, no blow, and `0x402fa0` at the end.
 *     Four frames whole, three creaking, six caving, and then it is not there.
 *   - **the bishop** (`initvpriest` in the records; `belfry.snd` calls it
 *     `0060 bishopchar[ge]`, `0064 bishopthro[w]`, `0067 bishop die`). Twelve
 *     hundred health, the same number the player has, and no award at all.
 *   - **the surge** (`initsurge`), two tall thin columns down the tower wall,
 *     and the only hazard in the game that GIVES you something: `0x426b21` is a
 *     call to `0x45ef30`, the ammunition adder.
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
    return { x: Number(m?.[1] ?? NaN), y: Number(m?.[2] ?? NaN) };
  };
  const go = async (q: string): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=12${q}`);
    await hud
      .filter({ hasText: /room \d+ of \d+/ })
      .waitFor({ timeout: 30_000 });
    // ...and then wait for the player to stop falling. A flat pause is not
    // enough on a cold load, and a probe that reads the position mid-fall reads
    // a y that no rect in the file contains.
    await page.waitForTimeout(400);
    let last = "";
    for (let i = 0; i < 25; i++) {
      const now = /· x (-?\d+), y (-?\d+)/.exec(await say())?.[0] ?? "";
      if (now && now === last) return;
      last = now;
      await page.waitForTimeout(120);
    }
  };

  // 1. five regions stacked, a census of eight, a share of nothing and no clock
  await go("");
  if (!/room \d+ of 5/.test(await say()))
    fail(
      `TOWER has five regions; the HUD says ${/room[^·]*/.exec(await say())?.[0]}`,
    );
  if (!/kill 0% of 8/.test(await say()))
    fail(
      `3 Ghengis, 4 skeletons and one bishop count and its 8 bats do not; the census is ${/kill[^·)]*/.exec(await say())?.[0]}`,
    );
  const clock = Number(/clock (\d+)/.exec(await say())?.[1] ?? 0);
  if (clock < 31000)
    fail(`TOWER carries no timer record, so no limit; the panel says ${clock}`);
  console.log(
    `ok    TOWER is five stacked regions, a census of eight, no kills wanted and no clock`,
  );

  // 2. the floor at x17515. `0x426f80` starts it on the player's own point
  //    inside its rect, and then it is four frames, three, and six.
  await go("&x=17800");
  if (!/floor whole cel 9010 at x17515/.test(await say()))
    fail(`the floor at x17515 opens whole on 9010`);
  await page.keyboard.down("ArrowLeft");
  const states = new Set<string>();
  let fell = 0;
  const from = (await at()).y;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(120);
    const m = /floor (\w+) cel (\d+) at x17515/.exec(await say());
    if (m) states.add(m[1]);
    const y = (await at()).y;
    if (y - from > fell) fell = y - from;
  }
  await page.keyboard.up("ArrowLeft");
  for (const want of ["creaking", "caving", "gone"])
    if (!states.has(want))
      fail(
        `a floor goes whole -> creaking -> caving -> gone; it showed ${[...states].join(" ")}`,
      );
  if (fell < 100)
    fail(`and it should drop whoever is on it; the player fell ${fell}`);
  console.log(
    `ok    walking onto one runs it ${[...states].join(" -> ")} and drops you ${fell} pixels`,
  );

  // 3. the bishop, on the goal, with the player's own twelve hundred health
  await go("&x=17600&y=15300");
  if (!/nearest initvpriest 1200\/1200hp/.test(await say()))
    fail(
      `0x41ebc4 gives it 0x40e300(0x4b0); the bar reads ${/initvpriest [^ ]*/.exec(await say())?.[0]}`,
    );
  if (!/at the goal/.test(await say()))
    fail(
      `the bishop stands ON the goal; the HUD says ${/television[^·]*|at the goal/.exec(await say())?.[0]}`,
    );
  const before = Number(/(\d+) points/.exec(await say())?.[1] ?? 0);
  let low = 1200;
  let lastX: number | null = null;
  let missed = 0;
  for (let i = 0; i < 300; i++) {
    await page.waitForTimeout(40);
    const m = /nearest initvpriest (-?\d+)\/(\d+)hp (\w+) at x (-?\d+)/.exec(
      await say(),
    );
    // a bat wanders in and takes the "nearest" line for a while; that is not the
    // fight ending
    if (!m) {
      if (++missed > 60 || lastX === null) break;
    } else {
      missed = 0;
      low = Math.min(low, Number(m[1]));
      if (m[3] === "dead") break;
      lastX = Number(m[4]);
    }
    const d = lastX! - (await at()).x;
    if (Math.abs(d) < 90) {
      // it floats, the way level eight's boss does: a standing kick passes
      // under a body box that runs from 109 above its anchor to 31 below
      await page.keyboard.press("j");
      await page.waitForTimeout(160);
      await page.keyboard.press("k");
      await page.waitForTimeout(260);
    } else {
      const key = d > 0 ? "ArrowRight" : "ArrowLeft";
      await page.keyboard.down(key);
      await page.waitForTimeout(80);
      await page.keyboard.up(key);
    }
  }
  if (low >= 1200)
    fail(`the bishop should be taking damage; it never dropped below ${low}`);
  /**
   * The bishop itself pays nothing — `0x4264f0` has no `0x40d450` in it at all
   * and `initvpriest`'s own award is 0.
   *
   * What it can no longer be is a flat zero, because beating it hard enough
   * sends it to the VANISH (`0x426633`'s half-of-`AI+6` bar) and twelve bats
   * come out of it. Those DO pay: `0x42640c` is `0x40d450(0x46)`, seventy
   * apiece, and it is the same seventy `initbat`'s own panel carries. So the
   * test is that every point earned here is a whole bat, and none of them is
   * the bishop.
   */
  const paid = Number(/(\d+) points/.exec(await say())?.[1] ?? 0) - before;
  if (paid % 70 !== 0)
    fail(`0x4264f0 pays nothing and a bat pays seventy; the score moved by ${paid}`);
  console.log(
    `ok    the bishop is 1200 health, stands on the goal, and pays nothing itself — down to ${low}, ${paid / 70} bats`,
  );

  // 4. the two surges, arcing down the tower wall on their own six cels
  await go("&x=17900&y=15300");
  const arcs = new Set<number>();
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(60);
    const m = /surge cel (\d+) at x17967/.exec(await say());
    if (m) arcs.add(Number(m[1]));
  }
  if (arcs.size < 4)
    fail(
      `0x46f648 is six cels at one frame each; the surge showed ${arcs.size}`,
    );
  if ([...arcs].some((c) => c < 9060 || c > 9065))
    fail(`its cels are 9060..9065; saw ${[...arcs].join(" ")}`);
  console.log(
    `ok    and its two surges arc through ${arcs.size} of 9060..9065`,
  );

  /**
   * ...and the bishop has a MACHINE, which this page fought without.
   *
   * `0x425c90`, the same tracker again, banded against `0x46f4c0`'s 220, 170 and
   * 100. At band 1 it commits on EIGHT in ten — `0x434540(10)` answers 1..10 and
   * `cmp eax, 3; jl` is the branch that walks away, which this page had the
   * wrong way round — inside 170 it always considers, and then
   * `0x434540(0x2a) <= 13` picks the sixteen-cel summon over the cast. Its
   * recoil is the animation's own dx: -30, -20, -10.
   *
   * The states are `obj+0x18`, the kind of the script it is playing: 1 is the
   * float, `0x46f170`, and 2 is `0x46f1c0`, all four attack tags. `mode` was
   * `stepBishop`'s invented name for the same thing.
   */
  await go("&x=17620&y=15200");
  const modes = new Set<string>();
  const cels = new Set<number>();
  for (let i = 0; i < 120; i++) {
    const t = await say();
    const w = /boss initvpriest [^·]*/.exec(t)?.[0] ?? "";
    const m = /mode (\w+)|kind (\d+ tag \d+)/.exec(w);
    if (m) modes.add(m[1] ?? m[2]);
    const c = /cel (\d+)/.exec(w)?.[1];
    if (c) cels.add(Number(c));
    await page.waitForTimeout(140);
  }
  // kind 2 is `0x46f1c0` — tag 0 the cast, tag 1 the recoil, tag 2 the summon,
  // tag 3 the settle every one of them ends on
  if (![...modes].some((m) => m.startsWith("2 tag")))
    fail(
      `inside 170 it always considers an attack; it only did ${[...modes].join(", ")}`,
    );
  /**
   * ...and every attack hands back to the FLOAT.
   *
   * `0x4527cc` ends tag 0, the cast, on tag 1, the recoil, and tag 1 installs
   * `0x46f170` — kind 1, the state that decides. Tag 3, the settle, only follows
   * tag 2, the sixteen-cel summon, which wants `0x434540(0x2a) <= 13`: about one
   * attack in three, so asking for it inside a fixed window is asking for a
   * flake. What is not a coin flip is that it comes back to kind 1.
   */
  if (!modes.has("1 tag 0") && !modes.has("settle"))
    fail(
      `every attack hands back to the float, kind 1; it did ${[...modes].join(", ")}`,
    );
  if (![...cels].some((c) => c >= 2600 && c <= 2614)) {
    if (![...cels].some((c) => c >= 2650 && c <= 2658))
      fail(`it should fight on its 2600s or 2650s; saw ${[...cels].join(" ")}`);
  }
  console.log(
    `ok    and its bishop works its own bands — ${[...modes].sort().join(", ")} — on its 2500s, 2600s and 2650s`,
  );

  /**
   * ...and the summon LETS THREE BATS GO, which is the only thing in this game
   * a creature builds that has a mind of its own.
   *
   * `0x42601a` sets the count to three and `0x426340` makes each one: sixty
   * health, the bishop's own record rect copied into its `AI+4`/`AI+8`, `±30`
   * of sideways velocity, and script `0x46f060` tag 1 — the flight, never the
   * dormant cel a placed bat waits on. `BrainCtx.hatch` is that seam, and it is
   * the sibling of `cast`: what comes out is stepped by the page exactly like a
   * bat the level placed, which is why the census below still holds.
   *
   * The summon is not free to ask for. `0x425e8a` wants `0x434540(0x2a) <= 13`
   * AND the bishop under half its health, so this has to FIGHT it — and the
   * fight is the jump-kick the leg above uses, because a standing kick passes
   * under a body box that starts 109 above the anchor. The loop leaves as soon
   * as it has both halves of the answer rather than running its budget out.
   */
  await go("&x=17600&y=15300");
  const wasMob = Number(/· (\d+) spawned/.exec(await say())?.[1] ?? 0);
  if (!wasMob) fail(`TOWER's room should report a spawned count; the HUD says ${await say()}`);
  let summoned = false;
  let most = wasMob;
  let where: number | null = null;
  for (let i = 0; i < 900 && !(summoned && most >= wasMob + 3); i++) {
    const t = await say();
    const w = /boss initvpriest [^·]*/.exec(t)?.[0] ?? "";
    if (/kind 2 tag 2/.test(w)) summoned = true;
    most = Math.max(most, Number(/· (\d+) spawned/.exec(t)?.[1] ?? 0));
    const m = /nearest initvpriest (-?\d+)\/\d+hp \w+ at x (-?\d+)/.exec(t);
    if (m) where = Number(m[2]);
    if (where === null) {
      await page.waitForTimeout(40);
      continue;
    }
    const d = where - (await at()).x;
    if (Math.abs(d) < 90) {
      await page.keyboard.press("j");
      await page.waitForTimeout(160);
      await page.keyboard.press("k");
      await page.waitForTimeout(260);
    } else {
      const key = d > 0 ? "ArrowRight" : "ArrowLeft";
      await page.keyboard.down(key);
      await page.waitForTimeout(80);
      await page.keyboard.up(key);
    }
  }
  if (!summoned)
    fail(`0x425e8a reaches for the summon once the bishop is hurt; kind 2 tag 2 never played`);
  if (most < wasMob + 3)
    fail(`0x42601a lets three go; the room held ${wasMob} and never got past ${most}`);
  console.log(
    `ok    ...and its summon lets three bats go — the room went from ${wasMob} to ${most}`,
  );

  // the LIGHTNING — `initlightfx`, the one class in the game that nothing places
  // and nothing triggers. `0x426800` is a metronome on the level's own counter:
  // 202 engine frames a period, the strike on 195, and the two records carry
  // params 1 and -1 so both play tag 0 of `0x46f588` and one of them is flipped.
  await page.goto(`${BASE}/walk.html?level=12&x=17600&y=14700`);
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);
  const bolts = new Map<number, string>();
  let period = 0;
  for (let i = 0; i < 300; i++) {
    await page.waitForTimeout(60);
    const m = /· lightfx (\d+)\/(\d+) ([\d,]+)/.exec(await say());
    if (!m) continue;
    period = Number(m[2]);
    if (m[3] !== "0,0") bolts.set(Number(m[1]), m[3]);
  }
  if (period !== 201)
    fail(`0x426815's counter runs 0..201; the page says 0..${period}`);
  if (!bolts.size)
    fail(
      `nothing struck in eighteen seconds — 0x426800 strikes every 202 frames`,
    );
  if (!bolts.has(195))
    fail(
      `0x426837 strikes on 0xc3; it struck on ${[...bolts.keys()].join(" ")}`,
    );
  const drawn = new Set(
    [...bolts.values()].flatMap((v) => v.split(",").map(Number)),
  );
  const stray = [...drawn].filter((c) => c !== 0 && (c < 9081 || c > 9086));
  if (stray.length)
    fail(`0x46f588 tag 0 is 9081..9086; saw ${stray.join(" ")}`);
  if ([...bolts.values()].some((v) => v.split(",")[0] !== v.split(",")[1])) {
    fail(
      `both records play the same tag, one flipped — they should never disagree on the cel`,
    );
  }
  console.log(
    `ok    and its lightning strikes on its own clock, ${bolts.size} frames of 9081..9086 at ${[...bolts.keys()][0]}`,
  );

  /**
   * ...and its three LADDERS carry you between its regions, both ways.
   *
   * All three of TOWER's span more than one region — two, three and four of them
   * — and this page filed a record into the region its CENTRE fell in, so each
   * answered only from the one room that happened to own its middle, which for
   * two of the three is not the room you climb from. None of them lifted the
   * player a single pixel.
   *
   * The engine files nothing: `0x40b940` is its only entity query and it is a
   * linear scan of the whole table, kind 2 asking whether a rect holds a point
   * (`0x434200`), with no reference to a region anywhere in it. So the ladders
   * are kept whole on the level.
   *
   * Each row is the record's own `pointX`, a y at the ladder's HEAD, and the
   * two legs the rect is worth — where the head can be stood on. Two of the
   * three cannot: the second's is a floor that gives way under a player who
   * waits on it, and the third's is inside an `initsurge` arc, and a shocked
   * player is in `p.act` and can take hold of nothing. Those two start at the
   * foot instead and their descent is worth nothing.
   */
  for (const [x, head, down, up] of [
    [16242, 15850, 340, 480],
    // the last two start AT the foot and their descent is worth nothing: the
    // head of the second stands on a floor that gives way under a player who
    // waits on it, and the head of the third stands in an `initsurge` arc
    [17222, 15690, -20, 780],
    [17974, 15900, -20, 660],
  ] as const) {
    await go(`&x=${x}&y=${head}`);
    // where it actually put us: `go` drops the player onto the room's own floor,
    // which is not the y asked for
    const from = Number(/· x -?\d+, y (-?\d+)/.exec(await say())?.[1] ?? NaN);
    await page.keyboard.down("s");
    await page.waitForTimeout(11_000);
    await page.keyboard.up("s");
    await page.waitForTimeout(300);
    const foot = Number(/· x -?\d+, y (-?\d+)/.exec(await say())?.[1] ?? NaN);
    const low = /room (\d+) of/.exec(await say())?.[1] ?? "";
    await page.keyboard.down("w");
    await page.waitForTimeout(13_000);
    await page.keyboard.up("w");
    await page.waitForTimeout(300);
    const top = Number(/· x -?\d+, y (-?\d+)/.exec(await say())?.[1] ?? NaN);
    const high = /room (\d+) of/.exec(await say())?.[1] ?? "";
    if (foot - from < down)
      fail(
        `the ladder at x${x} should take you ${down}px down; it went ${from} to ${foot}`,
      );
    if (foot - top < up)
      fail(
        `the ladder at x${x} should lift you ${up}px; it went ${foot} to ${top}`,
      );
    if (low === high)
      fail(
        `the ladder at x${x} reaches out of room ${low}; the page never left it`,
      );
    console.log(
      `ok    the ladder at x${x} runs ${foot - top}px, room ${low} to room ${high}`,
    );
  }

  await finish(browser);
  console.log(
    "PASS  TOWER's floors give way, its bishop stands on the goal, its surges arc, its lightning strikes and its ladders climb",
  );
};

await main();
