/**
 * WOODS — level three, and the first one whose population is its own.
 *
 *   npm run dev -w skullcracker                  # in one terminal
 *   npm run test:browser:woods -w skullcracker   # in another
 *
 * Level three is one room ten thousand pixels wide with no plank, no lift and no
 * ladder in it. What it has instead is twenty enemies of five kinds and a floor
 * that stands up in front of you twice, and both of those were reasons this port
 * could not play it.
 *
 * What the file says, and what this checks:
 *
 *   - **a creator places its object at the record's POINT.** The level's spawner
 *     `0x4503a0` hands every creator the point as one dword and the rect's two
 *     corners as two more, and each creator's first move is
 *     `mov dword [obj+6], eax` with the point (`0x450f90` for the dog,
 *     `0x450a7b` for the punk). The rect is the patrol territory and nothing
 *     else. Standing them on its bottom edge — which is what this page did — put
 *     every foe in WOODS inside the terrain, and they fell through the world.
 *   - **five kinds, and only four of them count.** The dog's creator never calls
 *     `0x42f870`, the census, and its class never calls `0x40d1c0`, the bar. Six
 *     dogs are worth 200 apiece and nothing to the quota.
 *   - **the CHOPPER hatches.** `0x454690`, in the first tag of the fourth kind's
 *     death, calls `0x450a50` — the punk's own creator — at the dying thing's
 *     own position. So killing one leaves the population where it was, which is
 *     why it pays no award of its own.
 *   - **a rise over fifty pixels is a wall.** `0x42fedc` adds 0x32 to the floor
 *     under the body's new position and `0x42fef3` throws the move away if that
 *     is still above it. WOODS' ground has exactly two such steps, at x8746 and
 *     x8890, and clearing them is how the level is crossed.
 */
import { BASE, fail, finish, launch } from "./harness";
import { WERED } from "../../src/brains/wered";

const near = (a: number, b: number, slack = 3): boolean =>
  Math.abs(a - b) <= slack;

/**
 * How close the CHOPPER has to be before a punch at it is worth throwing.
 *
 * **The CHOPPER's own maul band**, `0x477c28`'s third entry, and taking it from
 * there rather than writing a number down is the point: it is the distance at
 * which the thing commits to its one attack, so it is the distance at which a
 * fight exists at all.
 *
 * This was 70 — that list's LAST entry, the innermost band — and 70 is a
 * distance the CHOPPER has no reason to ever reach. `0x454410` does not home in on
 * anybody: it walks the way it is facing, mauls anything inside 160 in front of
 * it (`0x45456c` takes bands 3 and 4 alike), and turns round only when the
 * player is six hundred pixels BEHIND it (`0x45454a`) or when it bounces off a
 * wall. So a CHOPPER strides past a standing player and keeps going, swinging as it
 * comes and as it leaves, and the seventy-pixel window it crosses on the way is
 * open for a fraction of a second twice a lap. The suite spent four hundred
 * polls landing two of the three blows it needed and then said the fight had
 * never happened.
 *
 * At the CHOPPER's own 160 it dies in nine punches and seventeen polls of the four
 * hundred, which is the margin a suite wants — and the assertion is unchanged,
 * because what is being tested is `0x454690`, the punk that climbs out of the
 * body, and not the reach of a fist.
 */
const REACH = WERED.bands[2];

const main = async (): Promise<void> => {
  const browser = await launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.on("pageerror", (e) => fail(`page threw: ${e.message}`));
  const hud = page.locator("#hud");

  const say = async (): Promise<string> => (await hud.textContent()) ?? "";
  const at = async (): Promise<{ x: number; y: number }> => {
    const m = /x (-?\d+), y (-?\d+)/.exec(await say());
    if (!m) fail(`no position in the HUD`);
    return { x: Number(m![1]), y: Number(m![2]) };
  };
  const foe = async (): Promise<{
    kind: string;
    hp: number;
    state: string;
    x: number;
    y: number;
  } | null> => {
    const m = /nearest (\w+) (\d+)\/(\d+)hp (\w+) at x (-?\d+), y (-?\d+)/.exec(
      await say(),
    );
    return m
      ? {
          kind: m[1],
          hp: Number(m[2]),
          state: m[4],
          x: Number(m[5]),
          y: Number(m[6]),
        }
      : null;
  };
  const spawned = async (): Promise<number> =>
    Number(/(\d+) spawned/.exec(await say())?.[1] ?? -1);
  /** `?x=` alone drops the player on the region's own floor, which WOODS has all the way across */
  const go = async (x?: number): Promise<void> => {
    await page.goto(
      `${BASE}/walk.html?level=3${x === undefined ? "" : `&x=${x}`}`,
    );
    await hud
      .filter({ hasText: /room \d+ of \d+/ })
      .waitFor({ timeout: 30_000 });
    await page.waitForTimeout(700);
  };

  // 1. it opens where its own initplayer stands
  await go();
  const spawn = await at();
  if (!near(spawn.x, 826, 20))
    fail(`WOODS should open at its own initplayer, x826; got x ${spawn.x}`);
  console.log(`ok    WOODS opens on its path at x ${spawn.x}, y ${spawn.y}`);

  // 2. the whole population is there, and the quota is only what enrols
  const all = await spawned();
  if (all !== 20)
    fail(`WOODS places 20 enemies this page has cels for; ${all} spawned`);
  const quota = /kill 55% of (\d+)/.exec(await say());
  if (!quota || Number(quota[1]) !== 14) {
    fail(
      `the census should be the 14 that call 0x42f870, not the six dogs too; got ${quota?.[1]}`,
    );
  }
  console.log(
    `ok    all ${all} of its enemies stand up, and ${quota![1]} of them are the quota's`,
  );

  // 3. and they stand on the ground rather than inside it. The room's own floor
  //    ends at y1590; a foe placed on its rect's bottom edge falls past that for
  //    ever, which is what the point fixes.
  await go(10400);
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(400);
    const f = await foe();
    if (f && f.y > 1700) fail(`a ${f.kind} fell out of the level: y ${f.y}`);
  }
  const standing = await foe();
  console.log(
    `ok    and stay on their feet — ${standing?.kind} still at y ${standing?.y} after 12s`,
  );

  // 4. the CHOPPER hatches a punk out of itself
  await go(2200);
  const before = await spawned();
  let killed = false;
  for (let i = 0; i < 400 && !killed; i++) {
    await page.waitForTimeout(40);
    const f = await foe();
    if (!f || f.kind !== "initwered") continue;
    if (f.state === "dead") {
      killed = true;
      break;
    }
    if (Math.abs(f.x - (await at()).x) < REACH) {
      await page.keyboard.press("p");
      await page.waitForTimeout(220);
    }
  }
  if (!killed) fail(`never landed three blows on a CHOPPER`);
  await page.waitForTimeout(500);
  const after = await spawned();
  if (after !== before + 1)
    fail(
      `killing a CHOPPER should leave a punk standing: ${before} spawned, then ${after}`,
    );
  /**
   * ...and wait for the body to go before asking what is standing there.
   *
   * The CHOPPER's corpse lies where it fell for `[0x46b204]`'s fifty frames and the
   * HUD's nearest line names whatever is closest, dead or not. This used to read
   * the punk at once for a reason that was a bug: a CHOPPER in a fight was footed by
   * its own boxless swing cel, lost the floor, and fell out of the level, which
   * left the hatchling the only thing near. See `footOf` in src/walk.ts.
   */
  let kid = await foe();
  for (let i = 0; i < 60 && kid?.kind !== "initwerea"; i++) {
    await page.waitForTimeout(100);
    kid = await foe();
  }
  if (!kid || kid.kind !== "initwerea")
    fail(`what climbs out is the punk 0x450a50 makes; got ${kid?.kind}`);
  console.log(
    `ok    three blows fell a CHOPPER and a ${kid!.kind} climbs out of it — ${before} spawned, then ${after}`,
  );

  // 5. the dog: ten health, its own ten-cel gait, 200 points and no effect at all
  //    on the quota, because it is in nobody's census
  await go(3300);
  const before2 = /quota (\d+) of/.exec(await say())?.[1];
  const seen = new Set<number>();
  let down = false;
  // every jump the score makes while the dog is being fought, because the punches
  // thrown at it now land on whatever else has closed in — WOODS' punks notice
  // you and come, and two of them falling in the same window used to be read as
  // the dog's own award. The dog's 200 has to be one of the jumps.
  const paid: number[] = [];
  let score = Number(/(\d+) points/.exec(await say())?.[1] ?? 0);
  for (let i = 0; i < 250 && !down; i++) {
    await page.waitForTimeout(40);
    const m =
      /unplated initdog (-?\d+)\/(\d+)hp (\w+) at x (-?\d+), y (-?\d+) cel (\d+)/.exec(
        await say(),
      );
    if (!m) break;
    seen.add(Number(m[6]));
    if (m[3] === "dead") {
      down = true;
      break;
    }
    const now = Number(/(\d+) points/.exec(await say())?.[1] ?? 0);
    if (now !== score) paid.push(now - score);
    score = now;
    if (Math.abs(Number(m[4]) - (await at()).x) < 70) {
      await page.keyboard.press("p");
      await page.waitForTimeout(220);
    }
  }
  const paidLast = Number(/(\d+) points/.exec(await say())?.[1] ?? 0);
  if (paidLast !== score) paid.push(paidLast - score);
  if (!paid.includes(200))
    fail(
      `a dog pays 0x40d450(0xc8); the score jumped by ${paid.join(", ") || "nothing"}`,
    );
  if (seen.size < 8)
    fail(`its gait is ten cels, 4800..4809; saw ${[...seen].join(" ")}`);
  /**
   * ...and the quota moved by the PUNKS and by nothing the dog did.
   *
   * `initwerea` pays 220 and is in the census; the dog pays 200 and is in
   * nobody's. Now that WOODS' punks notice the player and close on him, the
   * punches thrown at the dog fell whoever else has arrived, so the quota does
   * move — by one for each 220 in the list above and not one more, which is the
   * same assertion the flat comparison used to be.
   */
  const punks = paid.filter((n) => n === 220).length;
  const after2 = Number(/quota (\d+) of/.exec(await say())?.[1] ?? NaN);
  if (after2 !== Number(before2) - punks)
    fail(
      `a dog is in no census: the quota went ${before2} -> ${after2} with ${punks} punk(s) felled beside it`,
    );
  console.log(
    `ok    a dog falls for 200 points, shows ${seen.size} of its own cels, and the quota moves only for the ${punks} punk(s) beside it`,
  );

  // 6. the floor stands up at x8746, and the walk stops dead against it
  await go(8600);
  await page.keyboard.down("ArrowRight");
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(100);
    if ((await at()).x > 8760) break;
  }
  await page.keyboard.up("ArrowRight");
  await page.waitForTimeout(400);
  const stopped = await at();
  if (stopped.x > 8770)
    fail(
      `the 70px step at x8746 should stop a walk; walked on to x ${stopped.x}`,
    );
  console.log(
    `ok    the ground stands up at x8746 and the walk stops at x ${stopped.x}`,
  );

  // 7. ...and a jump clears it, which is the whole of how level three is crossed
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("w");
  await page.keyboard.press("j");
  await page.waitForTimeout(1200);
  const over = await at();
  if (over.x < 8790) fail(`a jump should clear the step; still at x ${over.x}`);
  if (over.y > 1100)
    fail(`it should land on the higher ground, y~1060; got y ${over.y}`);
  console.log(
    `ok    and a jump puts the player over it, x ${over.x}, y ${over.y}`,
  );

  // 8. the three presses: up and watching until the player's point is inside the
  //    record's own rect, and then the whole stroke
  await go(7000);
  if (/press \w+ cel/.test(await say()))
    fail(`a press should be idle until someone stands under it`);
  await page.keyboard.down("ArrowRight");
  const cels = new Set<number>();
  const states = new Set<string>();
  // every cel of the stroke is held ONE engine frame — the script's ticksPerFrame
  // is 1 — so a poll slower than 67ms walks straight past the two that matter
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(20);
    const m = /press (\w+) cel (\d+)/.exec(await say());
    if (m) {
      states.add(m[1]);
      cels.add(Number(m[2]));
    }
  }
  await page.keyboard.up("ArrowRight");
  if (!states.has("slam") || !states.has("lift")) {
    fail(
      `a press should run its stroke and come back up; saw ${[...states].join(" ")}`,
    );
  }
  // 4382 and 4383 are the only two cels of the stroke that carry a strike box
  if (!cels.has(4382) || !cels.has(4383))
    fail(
      `the head should come down through 4382 and 4383; saw ${[...cels].join(" ")}`,
    );
  console.log(
    `ok    walking under a press works it — ${[...states].join(" and ")}, ${cels.size} of its own cels`,
  );

  // 9. the goal, from the level's own start, on the level's own ground
  await go();
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("w");
  let arrived = false;
  let last = (await at()).x;
  let stuck = 0;
  for (let i = 0; i < 500 && !arrived; i++) {
    await page.waitForTimeout(100);
    const here = await at();
    if (/at the goal|level 3 complete/.test(await say())) {
      arrived = true;
      break;
    }
    if (Math.abs(here.x - last) < 3) {
      stuck += 1;
      // the two steps are jumped, and nothing else on the route needs one
      if (stuck === 4) await page.keyboard.press("j");
      if (stuck > 30) break;
    } else stuck = 0;
    last = here.x;
  }
  await page.keyboard.up("ArrowRight");
  await page.keyboard.up("w");
  if (!arrived)
    fail(
      `never reached WOODS' goal; stopped at x ${(await at()).x}, y ${(await at()).y}`,
    );
  const end = await at();
  if (!near(end.x, 11020, 120))
    fail(`the goal rect is x11036..11153; arrived at x ${end.x}`);
  console.log(
    `ok    ran the level end to end and reached the goal at x ${end.x}, y ${end.y}`,
  );

  /**
   * ...and the FLAMER, which crossed sixteen levels touching nothing.
   *
   * `0x453b9b` gives the flame a strength of `0xfff7` — **−9** — and this page
   * read "below 1" as "harmless". It is not damage at all: it is the one code
   * a creature reads, and eight classes have a handler that accepts nothing
   * else. Every one of them starts by calling `0x44ff20`, which sticks a
   * FLAME on the victim at a random point inside its own cel bitmap, and then
   * does something of its own.
   *
   * `initwerec`'s (`0x45296e`) is the one worth watching, because it costs no
   * health: the arm lights the thing and installs `0x477a68` — one cel at five
   * engine frames — and answers 1 before any arithmetic runs. Those five
   * frames are the death throw.
   */
  await page.goto(`${BASE}/walk.html?level=3&x=3800&y=284&foehit=1&damage=1`);
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(700);
  // WOODS' one `statflamer` stands at x3822, and a werec paces the same row
  for (let i = 0; i < 25 && !/IN REACH/.test(await say()); i++) {
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(100);
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(100);
  }
  await page.keyboard.down("s");
  await page.waitForTimeout(900);
  await page.keyboard.up("s");
  await page.waitForTimeout(400);
  if (!/holding flamer \d+\/160/.test(await say()))
    fail(`could not pick up WOODS' flamer; the panel says ${/· (holding|no) \w+ \d+\/\d+/.exec(await say())?.[0]}`);
  let lit = "";
  let threw = "";
  let hpWhenLit = 0;
  for (let i = 0; i < 220 && !threw; i++) {
    const t = await say();
    if (!lit) {
      const f = /· (\d+) alight, first cel (\d+) at x (-?\d+), y (-?\d+) stage (\d+)/.exec(t);
      if (f) {
        lit = f[0];
        hpWhenLit = Number(/initwerec (\d+)\//.exec(t)?.[1] ?? 0);
      }
    }
    if (/initwerec \d+\/\d+hp \w+ at x -?\d+, y -?\d+ cel 6040/.test(t)) threw = t;
    // ...and CHASE it: the werec paces its own patch, so a fixed walk east
    // either stops short of the stream's reach or goes straight past it
    const w = /initwerec \d+\/\d+hp \w+ at x (-?\d+), y (-?\d+)/.exec(t);
    const me = /· x (-?\d+), y (-?\d+)/.exec(t);
    if (w && me && Math.abs(Number(w[1]) - Number(me[1])) > 110) {
      const key = Number(w[1]) > Number(me[1]) ? "ArrowRight" : "ArrowLeft";
      await page.keyboard.down(key);
      await page.waitForTimeout(80);
      await page.keyboard.up(key);
    }
    await page.keyboard.press("p");
    await page.waitForTimeout(130);
  }
  if (!lit)
    fail(`the flamer should SET THINGS ON FIRE — 0x44ff20; nothing caught in 220 samples`);
  if (!/cel 96\d\d/.test(lit))
    fail(`a flame is 9600..9629 — 0x4788d0 and 0x478978; it showed ${lit}`);
  if (!threw)
    fail(`a burning werec goes to state 3, cel 6040 — 0x45298d; it never did`);
  // `0x452992` answers 1 before the arithmetic, so the code costs it nothing
  if (hpWhenLit !== 180)
    fail(`0x45296e returns before any damage is computed; it was on ${hpWhenLit} of 180 when it caught`);
  console.log(`ok    the flamer sets a werec alight, for none of its 180 health, and it throws from cel 6040`);

  await finish(browser);
  console.log(
    "PASS  WOODS is populated by its own records, burns, and can be crossed to its goal",
  );
};

await main();
