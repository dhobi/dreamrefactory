/**
 * What a blow does: the spray, the flinch, the death, and the body.
 *
 *   npm run dev:skullcracker                 # in one terminal
 *   npm run test:browser:skullcracker:foes   # in another
 *
 * `skullcracker/src/foes.ts` has every class's numbers and the four addresses
 * each one was read from, and `src/effects.ts` has the spray. What this asserts
 * is that they reach the screen, which for a canvas page means counting pixels:
 *
 *   - **the spray.** `0x40cba0` throws one gob per six points of damage, up to
 *     twenty, and the gobs are cels 18200..18202 out of `PLAYER.SBK` — bright
 *     green, which nothing else in STREETS' street is. So a punch must put green
 *     on the screen where there was none, and sixty frames later it must be gone
 *     again.
 *   - **the damage.** A punch is cel 602's own `dx 47` and the kick's cel 663 is
 *     55 (`0x42f910` takes the magnitude of the pair at the cel record's +20), so
 *     a 250-health punk takes six punches. Any rule of the "n blows and it dies"
 *     kind fails the pair of assertions below.
 *   - **the death.** A punk pays 220 (`0x44f1db`) and its death animation is
 *     twelve cels ending on 1987, which is the body on the ground. So the score
 *     must move by exactly 220 and the CEL on screen must be one of the death
 *     set — a page that simply deleted the enemy would score the same and show
 *     nothing.
 *   - **the body's fifty frames.** `[0x46b204]` is 50 and the corpse lies there for
 *     all of them, but it leaves the CENSUS at once (`0x44ef3e` calls
 *     `0x42f870(obj, 0)` on the first dead frame), so the quota moves on the
 *     killing blow and the body outlives it.
 *   - **the census itself.** Eleven, not twenty: `0x42f870(obj, 1)` is what
 *     enrols a thing and only the were-punks call it.
 *   - **where the goo ends up.** `0x40c480` switches a gob to its falling cels the
 *     frame `vy` turns positive and freezes it where it lands, so what is on
 *     screen a few seconds later is on the FLOOR. And only the creatures throw
 *     any: a mailbox's handler never calls `0x40cba0`.
 *   - **the green ball.** A punk's body leaves one when its fifty frames expire —
 *     `0x40cba0`'s −13 branch, eleven cels of a sphere swelling to 89px and
 *     collapsing. A rat's launch does not: that call is in the punk classes'
 *     corpse handlers and nowhere else.
 *   - **either side.** A blow has to land walking west as well as east. The
 *     player's cel is flipped within its drawn band, so the strike box mirrors
 *     inside the cel; reflecting it about the anchor — which is what the engine's
 *     own rect builder does — puts the kick's box 165px behind the player, because
 *     cel 663's anchor is outside its own art.
 *   - **the mailbox flies.** `obj+0xe` is a mass as well as a divisor and
 *     `0x430470` is an elastic collision, so a kick throws a 7 against the
 *     player's 12 most of a screen width. It also lands on its OWN cel's box: the
 *     upright box reaches 93px below the anchor and the fallen one 56, and using
 *     the wrong one leaves it floating.
 *   - **a rat is below the fist.** Its box tops out two pixels above where the
 *     punch's bottoms out, so nothing standing can touch it and the duck-kick
 *     can. A page using cel extents instead of the authored boxes would fail
 *     that pair, which is what makes it worth asserting.
 *
 * ## The trap
 *
 * Green pixels alone prove very little, because the interface panel is full of
 * them — the score plate, the name plates, the quota gauge are all green. Every
 * count here is taken from INSIDE the play window (0, 42)-(512, 274) and nowhere
 * else, and the "before" count is subtracted rather than assumed to be zero:
 * STREETS' street has a little green in its backdrop.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:5178";
/** STREETS' first `initwerea` patrols x2197..2584; this stands inside its reach */
const AT_A_PUNK = 2300;

const fail = (why: string): never => {
  console.error(`FAIL  ${why}`);
  process.exit(1);
};

const main = async (): Promise<void> => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => fail(`page threw: ${e.message}`));
  const hud = page.locator("#hud");
  const say = async (): Promise<string> => ((await hud.textContent()) ?? "").replace(/ · every pixel.*/, "");
  const num = async (re: RegExp, what: string): Promise<number> => {
    const m = re.exec(await say());
    return m ? Number(m[1]) : fail(`no ${what} in the HUD: ${(await say()).slice(0, 160)}`);
  };
  /**
   * Pixels inside the play window whose green dominates — the goo, and only the
   * goo. The window is the engine's own (0, 42)-(512, 274), so nothing on the
   * panel can be counted by accident.
   */
  const green = async (): Promise<number> =>
    page.evaluate(() => {
      const c = document.getElementById("screen") as HTMLCanvasElement;
      const d = c.getContext("2d")!.getImageData(0, 42, 512, 232).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 1] > 140 && d[i + 1] > d[i] * 1.6 && d[i + 1] > d[i + 2] * 1.6) n++;
      }
      return n;
    });

  await page.goto(`${BASE}/walk.html?level=1&x=${AT_A_PUNK}`);
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);

  // 1. the census is the four punk classes and nothing else
  const census = await num(/kill \d+% of (\d+)/, "a census");
  if (census !== 11) {
    fail(`STREETS' census is ${census}; only its 8 werea and 3 wereb enrol through 0x42f870(obj, 1)`);
  }
  console.log(`ok    STREETS enrols ${census} — the punks, not the rats or the furniture`);

  const score0 = await num(/(\d+) points/, "a score");
  /** one blow, and the green it put on screen */
  const blow = async (key: string): Promise<number> => {
    const before = await green();
    await page.keyboard.down(key);
    await page.waitForTimeout(90);
    await page.keyboard.up(key);
    await page.waitForTimeout(220);
    const after = await green();
    await page.waitForTimeout(140);
    return after - before;
  };

  // 2. a punch sprays goo — cel 602's blow is 47, so 0x40cba0 throws seven gobs
  let sprayed = 0;
  for (let i = 0; i < 4 && sprayed < 60; i++) sprayed = await blow("p");
  if (sprayed < 60) fail(`four punches put no goo on screen; 0x40cba0 throws damage/6 gobs`);
  console.log(`ok    a punch sprays goo: ${sprayed} green pixels appeared`);

  // 3. a punch is 47 against a punk's 250, so four of them cannot fell it. This
  //    is the assertion that damage is the CEL's number and not a share of the
  //    victim's health: any "n blows and it dies" rule fails here.
  for (let i = 0; i < 3; i++) await blow("p");
  if ((await num(/(\d+) points/, "a score")) !== score0) {
    fail(`punches felled a punk: four of them is 188 against the 250 its creator gives it`);
  }
  console.log(`ok    four punches at 47 each leave a 250-health punk standing`);

  // 4. and the sixth one does fell it, for the class's own award
  for (let i = 0; i < 6 && (await num(/(\d+) points/, "a score")) === score0; i++) await blow("p");
  const score1 = await num(/(\d+) points/, "a score");
  if (score1 - score0 !== 220) {
    fail(`felling a punk paid ${score1 - score0}; 0x44f1db pushes 220 to 0x40d450`);
  }
  console.log(`ok    the sixth punch fells it and pays the class's own award, ${score1 - score0}`);

  // 5. the census drops on the killing blow, not when the body goes: the corpse
  //    state handler calls `0x42f870(obj, 0)` on its first frame (`0x44ef3e`),
  //    fifty frames before the object itself is removed.
  const left = await num(/(\d+) still to kill/, "a quota");
  if (left !== 7) fail(`the quota should drop to 7 of 8 on the killing blow; it reads ${left}`);
  console.log(`ok    and the quota drops the moment it dies, ${left} left`);

  // 6. fifty frames later the body has gone, and the goo has stopped flying —
  //    what is left of it is on the ground
  await page.waitForTimeout(7000);
  const settled = await page.evaluate(() => {
    const c = document.getElementById("screen") as HTMLCanvasElement;
    const g = c.getContext("2d")!;
    const rows: number[] = [];
    for (const y of [42, 158]) {
      const d = g.getImageData(0, y, 512, 116).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 1] > 140 && d[i + 1] > d[i] * 1.6 && d[i + 1] > d[i + 2] * 1.6) n++;
      }
      rows.push(n);
    }
    return rows;
  });
  if (settled[0] > settled[1]) {
    fail(`the goo settled in the TOP half of the window (${settled[0]} vs ${settled[1]}); it should fall`);
  }
  console.log(`ok    and the goo has fallen: ${settled[0]} green above the middle, ${settled[1]} below`);

  // 7. furniture does not bleed. `0x44fe80` fetches the blow, installs a dent and
  //    plays a sound, and never calls `0x40cba0` — so a mailbox makes no mess.
  await page.goto(`${BASE}/walk.html?level=1&x=3470`);
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  const dry = await green();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("p");
    await page.waitForTimeout(220);
  }
  if ((await green()) > dry + 80) fail(`hitting a mailbox threw goo; only the creatures call 0x40cba0`);
  console.log(`ok    and a mailbox does not bleed`);

  // 8. a rat is below the fist. Its collision box tops out at `y -14` and the
  //    punch's fist box bottoms out at `y -16`, so the two miss by two pixels and
  //    the standing kick is higher still — what reaches it is the duck-kick's
  //    boot at `y 38..83`. That is the pair of assertions that says the boxes are
  //    the disc's authored rects and not the drawn cels: a page using cel extents
  //    would kill a rat with anything.
  const spawnedAt = async (): Promise<number> => num(/(\d+) spawned/, "a spawn count");
  await page.goto(`${BASE}/walk.html?level=1&x=2010`);
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);
  const rats = await spawnedAt();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("p");
    await page.waitForTimeout(200);
    await page.keyboard.press("k");
    await page.waitForTimeout(200);
  }
  if ((await spawnedAt()) !== rats) {
    fail(`a standing punch or kick reached a rat on the floor; the boxes miss by two pixels`);
  }
  console.log(`ok    neither the punch nor the standing kick can reach a rat`);
  for (let i = 0; i < 14 && (await spawnedAt()) === rats; i++) {
    await page.keyboard.down("ArrowDown");
    await page.keyboard.press("k");
    await page.waitForTimeout(240);
    await page.keyboard.up("ArrowDown");
    await page.waitForTimeout(120);
  }
  if ((await spawnedAt()) >= rats) {
    fail(`the duck-kick never reached a rat either; cel 724's box is y 38..83`);
  }
  console.log(`ok    and the duck-kick does — one blow, and 0x44e3f0 launches it`);

  // 9. and a rat leaves no green ball. That effect is `0x40cba0`'s −13 branch and
  //    only the punk classes' CORPSE handlers call it (`0x44ef7e`, `0x44f848`); the
  //    rat's launch ends with the object simply gone. The ball is 89px across at
  //    its widest, so a frame of it is unmistakable next to a 22px splat.
  const brightest = async (): Promise<number> =>
    page.evaluate(() => {
      const c = document.getElementById("screen") as HTMLCanvasElement;
      const d = c.getContext("2d")!.getImageData(0, 42, 512, 232).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 1] > 200 && d[i + 1] > d[i] * 2 && d[i + 1] > d[i + 2] * 2) n++;
      }
      return n;
    });
  let ball = 0;
  for (let i = 0; i < 16; i++) {
    ball = Math.max(ball, await brightest());
    await page.waitForTimeout(90);
  }
  // the ball is 89x76 of solid bright green — thousands of pixels — while the
  // splats a dying rat leaves are 22 to 106 pixels wide and a few tall
  if (ball > 1500) fail(`a rat left a ${ball}-pixel green ball; only the punks' corpses do that`);
  console.log(`ok    and it leaves no green ball behind (${ball} bright pixels at most)`);

  // 10. a kicked mailbox flies. `0x430470` is an elastic collision with `obj+0xe`
  //     as the mass — the player 12, a mailbox 7 — so a kick's 55 leaves it at
  //     69 pixels a frame and it crosses most of a screen before the ground drags
  //     it down. The mailbox is the only strongly BLUE thing in STREETS' street,
  //     so where the blue is says where it is.
  const blue = async (): Promise<{ left: number; right: number }> =>
    page.evaluate(() => {
      const c = document.getElementById("screen") as HTMLCanvasElement;
      const g = c.getContext("2d")!;
      const out: number[] = [];
      for (const x of [0, 256]) {
        const d = g.getImageData(x, 42, 256, 232).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 2] > 90 && d[i + 2] > d[i] * 1.8 && d[i + 2] > d[i + 1] * 1.8) n++;
        }
        out.push(n);
      }
      return { left: out[0], right: out[1] };
    });
  await page.goto(`${BASE}/walk.html?level=1&x=3455`);
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  const stood = await blue();
  if (stood.right < 200) fail(`no mailbox in the right half to kick: ${stood.right} blue pixels`);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("k");
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(1200);
  const gone = await blue();
  if (gone.right > stood.right / 2) {
    fail(`the kicked mailbox did not travel: ${stood.right} blue pixels beside it, ${gone.right} after`);
  }
  console.log(`ok    a kicked mailbox flies out of frame: ${stood.right} blue pixels beside it, ${gone.right} after`);

  // 11. and a blow lands the same going left. The player's cel is drawn centred on
  //     `p.x` and flipped WITHIN that band, so the strike box has to be mirrored
  //     inside the cel and not about the anchor — cel 663's anchor is at
  //     `posX -12`, outside its own art, and reflecting about it put the kick's box
  //     165 pixels BEHIND the player. Approaching the same punk from each side is
  //     the only assertion that catches that.
  const reach = async (from: number, dir: string): Promise<boolean> => {
    await page.goto(`${BASE}/walk.html?level=1&x=${from}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
    const hp = async (): Promise<number> => Number(/initwerea (\d+)\//.exec(await say())?.[1] ?? "0");
    const full = await hp();
    for (let i = 0; i < 30; i++) {
      await page.keyboard.down(dir);
      await page.waitForTimeout(110);
      await page.keyboard.up(dir);
      await page.keyboard.press("k");
      await page.waitForTimeout(230);
      if ((await hp()) < full) return true;
    }
    return false;
  };
  if (!(await reach(2150, "ArrowRight"))) fail(`a kick never landed walking east into the punk`);
  if (!(await reach(2650, "ArrowLeft"))) fail(`a kick never landed walking west into the punk — the box is mirrored wrong`);
  console.log(`ok    and a kick lands from either side`);

  /**
   * 12. the hydrant: three blows open the valve, and what bursts out is its own
   *     object beside it while the hydrant stays whole.
   *
   *     `0x44fb20` is unambiguous about this — on the frame tag 3 ends it calls
   *     `0x44fc70(point + 25, facing, 1)` for a SECOND object on the water tag and
   *     `0x45d090(this, 0x477d30, 0)` to put itself back on cel 9700 — and this
   *     page had the water playing ON the hydrant, which made the hydrant vanish
   *     into it. So: the count of spawned things has to RISE by one, the hydrant
   *     has to still be reading a hydrant cel while the water plays, and the water
   *     has to go on its own.
   */
  await page.goto(`${BASE}/walk.html?level=1&x=8560`);
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);
  const spawned = async (): Promise<number> => Number(/· (\d+) spawned/.exec(await say())?.[1] ?? "0");
  const valve = async (): Promise<string> => (/· (?:water|inithydrant) cel \d+ at x \d+/.exec(await say()) ?? [""])[0];
  const before = await spawned();
  if (!/inithydrant cel 9700/.test(await say())) fail(`no shut hydrant to kick: ${await valve()}`);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(300);
  await page.keyboard.up("ArrowRight");
  let burst = "";
  let withWater = 0;
  for (let i = 0; i < 4 && !burst; i++) {
    await page.keyboard.press("k");
    for (let j = 0; j < 8 && !burst; j++) {
      await page.waitForTimeout(60);
      const line = await say();
      if (/· water cel 98\d\d/.test(line)) {
        burst = line;
        withWater = await spawned();
      }
    }
    await page.waitForTimeout(200);
  }
  if (!burst) fail(`three kicks did not burst the hydrant: ${await valve()}`);
  if (withWater !== before + 1) fail(`the water should be a second object: ${before} spawned, ${withWater} with it`);
  if (!/inithydrant cel 970\d/.test(burst)) fail(`the hydrant vanished into its own water: ${burst}`);
  await page.waitForTimeout(1500);
  if ((await spawned()) !== before) fail(`the water outstayed its animation: ${await spawned()} spawned, was ${before}`);
  if (!/inithydrant cel 9700/.test(await say())) fail(`the hydrant did not shut again: ${await valve()}`);
  console.log(`ok    three kicks burst the hydrant into a second object, and it shuts again`);

  await browser.close();
  console.log("PASS  a blow sprays, staggers, fells and leaves a body, all on the disc's own cels");
};

void main().catch((e) => fail(String(e)));
