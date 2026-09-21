/**
 * VAT — level sixteen, the last of them, and a census of exactly one.
 *
 *   npm run dev -w skullcracker                # in one terminal
 *   npm run test:browser:vat -w skullcracker   # in another
 *
 * Its forty-one records are seven showers, two balls, a set of teeth, chapter
 * four's own gun — the `statblaster`, which is placed in this level and in no
 * other — and BOGGS, which is four objects: `initboggsbody`, `initboggshead`,
 * `initbgclawarm` and `initbgmachinery`, the last of which stands up eight more.
 *
 * Two numbers make it the last thing in the game:
 *
 * ```
 *   41be84  0x40e300(0xfa0)                 ; four thousand health
 *   41be68  cmp [0x46e080] / [0x46e084]     ; while EITHER flag is set...
 *   41be7c  add word ptr [0x4a50e8], 0x1e   ; ...thirty a frame back
 * ```
 *
 * Four thousand is three times TOWER's bishop and more than three times the
 * player. But the flags ship SET — both are `01 00` in `.data` — and nothing in
 * `.text` ever sets one: the only two writes there are are the clears at
 * `0x41b611` and `0x41b75d`, and both are in the MACHINERY's hit handler. So the
 * fight is the machine, and only then the boss.
 *
 * And the census is the HEAD: `0x41c591` is `0x42f870(head, 1)`, the body is not
 * registered at all, and `0x416047` will not spawn the goal until both the
 * allowance is met and `0x46bfbc` is set — which `0x41bdd8` does when Boggs
 * dies. So the ending cannot be walked to past a living Boggs.
 */
import { BASE, fail, finish, launch } from "./harness";

const main = async (): Promise<void> => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => fail(`page threw: ${e.message}`));
  const hud = page.locator("#hud");

  const say = async (): Promise<string> => (await hud.textContent()) ?? "";
  const go = async (q: string): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=16${q}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
    let last = "";
    for (let i = 0; i < 25; i++) {
      const now = /· x (-?\d+), y (-?\d+)/.exec(await say())?.[0] ?? "";
      if (now && now === last) return;
      last = now;
      await page.waitForTimeout(120);
    }
  };

  // 1. two regions, nothing that counts, and no clock
  await go("");
  if (!/room \d+ of 2/.test(await say())) fail(`VAT has two regions; the HUD says ${/room[^·]*/.exec(await say())?.[0]}`);
  if (!/of 1\)/.test(await say()))
    fail(`VAT's census is Boggs' head and nothing else — 0x41c591; the HUD says ${/kill[^·)]*/.exec(await say())?.[0]}`);
  const clock = Number(/clock (\d+)/.exec(await say())?.[1] ?? 0);
  if (clock < 31000) fail(`VAT carries no timer record, so no limit; the panel says ${clock}`);
  console.log(`ok    VAT is two regions, a census of one — Boggs' head — and no clock`);

  // 2. its furniture, all of it one cel apiece
  if (!/shower cel 4060/.test(await say())) fail(`0x46cc68 tag 0 is one record, 4060; the HUD says ${/shower[^·]*/.exec(await say())?.[0]}`);
  if (!/ball cel 4310/.test(await say())) fail(`0x41a73d files 0x10d6`);
  if (!/teeth cel 3516/.test(await say())) fail(`0x418c9d files 0xdbc`);
  console.log(`ok    and its showers, balls and teeth stand on their own single cels`);

  // 3. BOGGS, in the other region, with four thousand health
  await go("&x=6100");
  if (!/room 1 of 2 \(chamber2/.test(await say())) fail(`Boggs stands in the region named chamber2; the HUD says ${/room[^·]*/.exec(await say())?.[0]}`);
  if (!/boggs \w+ cel 59\d\d at x6\d+, y2094, 4000\/4000hp, \+30 a frame/.test(await say()))
    fail(`0x41be84 gives it 0x40e300(0xfa0); the HUD says ${/boggs[^·]*/.exec(await say())?.[0]}`);
  // ...only the frames it shows while IDLE: it lunges now, and the lunge is the
  // wider 5980..5988 — see the step after the blaster
  const cels = new Set<number>();
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(40);
    const m = /boggs (\w+) cel (\d+)/.exec(await say());
    if (m && m[1] === "idle") cels.add(Number(m[2]));
  }
  // it is only idle about a fifth of the time now — one in six a frame against a
  // twenty-seven frame lunge — so this samples four times as often for it
  if (cels.size < 2) fail(`0x46e6b0 is 5988, 5987, 5986, 5987 at three frames each; it showed ${cels.size}`);
  if ([...cels].some((c) => c < 5986 || c > 5988)) fail(`its idle is 5986..5988; saw ${[...cels].join(" ")}`);
  console.log(`ok    Boggs stands in chamber2 on ${cels.size} of its own 5986..5988, at four thousand health`);

  /**
   * 4. the MONKEYBAR, which is in this level and in no other either.
   *
   * One `monkeybar` record ships in the whole game — `param 65, top 1779, left
   * 5908, right 6617` — and until now it was the last live entity record with
   * nothing on this page's side. See `MONKEYBAR` in `src/walk.ts`.
   *
   * It is not reachable from VAT's floor at y2301: the rect is in ANCHOR space
   * and a jump lifts the anchor 137, so the only way up is the platform at
   * `top 2002, left 6557, right 6659`, which is the one place in the level
   * where the bar is over your head and not out of it.
   */
  await go("&x=6600&y=2002");
  await page.keyboard.down("w");
  await page.keyboard.press("j");
  for (let i = 0; i < 25 && !/hanging/.test(await say()); i++) await page.waitForTimeout(40);
  await page.keyboard.up("w");
  await page.waitForTimeout(250);
  const grabbed = /hanging hold (\d+) tag (\d+) at x (-?\d+), y (-?\d+)/.exec(await say());
  if (!grabbed) fail(`W in the air over the bar should grab it — 0x42ef11; the HUD says ${/· (in the air|standing|hanging)[^·]*/.exec(await say())?.[0]}`);
  // the anchor goes to the record's own top, 1779, and the feet follow it down
  if (Number(grabbed[4]) !== 1931)
    fail(`0x42ef11 puts the ANCHOR on the record's top of 1779, so the feet land at 1931; they are at ${grabbed[4]}`);
  console.log(`ok    and its one monkeybar is grabbed in the air, hanging at hold ${grabbed[1]}`);

  /**
   * Hand over hand, and a hold is a NUMBER — `x = left + n * 65` and nothing in
   * between, the same shape the ladder's rungs have. What proves it is that the
   * holds only ever count DOWN: the snap's `+1` belongs to travelling east
   * (`0x42b621` and `0x42b77b`, and not the other two arms), so reading it off
   * the facing instead sends a westward swing fifteen pixels back the way it
   * came every time a tag completes.
   */
  await page.keyboard.down("a");
  const holds: number[] = [];
  for (let i = 0; i < 40; i++) {
    const h = /hanging hold (\d+) tag (\d+)/.exec(await say());
    if (h) holds.push(Number(h[1]));
    await page.waitForTimeout(120);
  }
  await page.keyboard.up("a");
  await page.waitForTimeout(600);
  if (holds.some((h, i) => i > 0 && h > holds[i - 1]))
    fail(`swinging west, a hold may never go back up — 0x42b77b; they ran ${holds.join(" ")}`);
  if (holds[holds.length - 1] >= holds[0] - 4)
    fail(`forty samples of A should cross most of an eleven-hold bar; they ran ${holds[0]} to ${holds[holds.length - 1]}`);
  /**
   * ...and a hold is `left + n * param`, within the one tick of travel the
   * ENDS of the bar are always trading.
   *
   * `0x42b410`'s preamble clamps x into `left..right` every frame and the
   * swing adds its ten pixels an engine frame straight back, so a player
   * pressed against either end oscillates by a tick's worth — two and a half
   * pixels — for as long as the key is held. That is the executable's own
   * behaviour, not this page's, and sampling the HUD mid-tick catches it: a
   * run measured 5906 against a left edge of 5908.
   */
  const west = /hanging hold (\d+) tag (\d+) at x (-?\d+)/.exec(await say());
  if (west && Math.abs(Number(west[3]) - (5908 + Number(west[1]) * 65)) > 3)
    fail(`a hold is left + n * param — 0x42b677; hold ${west[1]} sits at x ${west[3]} and not ${5908 + Number(west[1]) * 65}`);
  console.log(`ok    ...and swung hand over hand west, ${holds[0]} holds down to ${holds[holds.length - 1]}, landing on the grid`);

  /**
   * W is the chin-up and it is a flourish: `0x42b7ff` holds tag 3's last cel
   * while the key is down, `0x42b827` comes back down tag 4, and neither of
   * them touches x, y or the hold. S lets go, and only out of tag 0 —
   * `0x42b522` is in the hang's arm and no other arm tests for it.
   */
  const before = /hanging hold (\d+)/.exec(await say())?.[1];
  await page.keyboard.down("w");
  await page.waitForTimeout(700);
  if (!/hanging hold \d+ tag 3/.test(await say()))
    fail(`W on the bar is the chin-up, 0x472048 tag 3; the HUD says ${/· hanging[^·]*/.exec(await say())?.[0]}`);
  await page.keyboard.up("w");
  await page.waitForTimeout(900);
  if (!/hanging hold \d+ tag 0/.test(await say()))
    fail(`letting W go lowers you back down tag 4 into the hang — 0x42b827; the HUD says ${/· hanging[^·]*/.exec(await say())?.[0]}`);
  if (/hanging hold (\d+)/.exec(await say())?.[1] !== before)
    fail(`the chin-up moves nothing; the hold went ${before} -> ${/hanging hold (\d+)/.exec(await say())?.[1]}`);
  await page.keyboard.down("s");
  await page.waitForTimeout(700);
  await page.keyboard.up("s");
  await page.waitForTimeout(700);
  if (/hanging/.test(await say()))
    fail(`S out of the hang lets go — 0x42b522; the HUD still says ${/· hanging[^·]*/.exec(await say())?.[0]}`);
  if (!/, y 2301/.test(await say()))
    fail(`and the leave is the plain fall, 0x471b28 tag 0, straight to VAT's floor; the HUD says ${/· x (-?\d+), y (-?\d+)/.exec(await say())?.[0]}`);
  console.log(`ok    ...and W chins you up and moves nothing, and S drops you straight to the floor`);

  // 5. and chapter four's gun, which is in this level and in no other. Every
  //    other level of the chapter places `statblasterpack` and nothing to put
  //    them in; `0x416440` is what arms you, and it is here.
  await go("&x=5760");
  if (!/nearest statblaster at x 5815/.test(await say())) fail(`the game's one statblaster stands at x5815; the HUD says ${/· \d+ guns[^·]*/.exec(await say())?.[0]}`);
  if (!/IN REACH/.test(await say())) fail(`and it should be in reach from x5760`);
  await page.keyboard.down("s");
  await page.waitForTimeout(900);
  await page.keyboard.up("s");
  await page.waitForTimeout(300);
  if (!/holding blaster 41\/160/.test(await say()))
    fail(`0x416440 gives 40 and 0x45eed0 one more, against 0x412a24's 0xa0; the panel says ${/· (holding|no) \w+ \d+\/\d+/.exec(await say())?.[0]}`);
  console.log(`ok    and the game's one statblaster is here, and it arms you with 41 of 160`);

  /**
   * ...and it LUNGES, which this page had it standing still through.
   *
   * `0x41be50` rolls `0x434540(0x2a)` once a frame while its kind is 0 and
   * seven of the forty-two take it (`0x41c006`), toward whichever side the
   * player is on (`0x41c047`). The stride is `0x46e6d8`'s own — three records
   * of 470 — through the largest divisor in the game.
   */
  await go("&x=6100");
  const states = new Set<string>();
  const xs = new Set<number>();
  for (let i = 0; i < 80; i++) {
    const t = await say();
    const w = /boggs (\w+) cel (\d+) at x(\d+)/.exec(t);
    if (w) {
      states.add(w[1]);
      xs.add(Number(w[3]));
    }
    await page.waitForTimeout(140);
  }
  if (!states.has("idle")) fail(`it should sit on its idle between lunges; it did ${[...states].join(" ")}`);
  if (!states.has("left") && !states.has("right")) fail(`0x41c006 takes seven in forty-two; it never lunged`);
  if (xs.size < 4) fail(`a lunge carries it; it stood at ${[...xs].join(" ")}`);
  console.log(`ok    and Boggs lunges — ${[...states].sort().join(" ")}, across ${Math.max(...xs) - Math.min(...xs)}px of its own stride`);

  /**
   * ...and what the OTHER thirty-five frames of the idle do, which this suite
   * and the page both had as nothing at all.
   *
   * `0x41bffc`'s seven-in-forty-two is only the first roll of the frame.
   * `0x41c068` is the rest of it, and it is a range test on the same signed gap
   * the head aims on: at or under three hundred a WORM goes down, and beyond it
   * the second machine THROWS.
   *
   * Boggs' body stands at x6321, so a player at x6100 is 221 inside the line
   * and gets worms.
   */
  await go("&x=6100");
  const worms = new Map<number, Set<number>>();
  let mostWorms = 0;
  for (let i = 0; i < 90; i++) {
    const m = /· (\d+) worm, first kind (\d+) cel (\d+) at x (-?\d+), y (-?\d+)/.exec(await say());
    if (m) {
      mostWorms = Math.max(mostWorms, Number(m[1]));
      const kind = Number(m[2]);
      if (!worms.has(kind)) worms.set(kind, new Set());
      worms.get(kind)!.add(Number(m[3]));
    }
    await page.waitForTimeout(120);
  }
  if (!mostWorms) fail(`0x41c0fd drops one seven frames in fifty-five; in 90 samples none was ever down`);
  // `0x41c3c8` — `cmp word ptr [eax+4], 0x13`, and the class's own count is what
  // it tests, so nineteen is a hard ceiling rather than a tendency
  if (mostWorms > 0x13) fail(`0x41c3c8 caps them at nineteen; ${mostWorms} were down at once`);
  const wormCels = [...worms.values()].flatMap((v) => [...v]);
  if (wormCels.some((c) => c !== 5670 && (c < 5660 || c > 5678)))
    fail(`a worm is 5670 asleep and 5660..5678 awake; saw ${wormCels.sort((a, b) => a - b).join(",")}`);
  console.log(`ok    and Boggs seeds WORMS — up to ${mostWorms} of its nineteen, kinds ${[...worms.keys()].sort().join(",")}, cels ${[...new Set(wormCels)].sort((a, b) => a - b).join(",")}`);

  /**
   * ...and past three hundred it throws instead, out of `[0x4a5170]` — which is
   * the SECOND machine and not Boggs. `0x41c09d` gates the whole branch on
   * `0x46e080`, the flag that machine's own wreck clears, so the throw stops
   * when the machine does.
   */
  await go("&x=6100");
  // walked rather than spawned: x6100 is the one place in chamber2 this suite
  // knows stands Boggs up, and the gap is opened on foot from there
  const me = async (): Promise<number> => Number(/· x (-?\d+),/.exec(await say())?.[1] ?? 0);
  const him = async (): Promise<number> => Number(/boggs \w+ cel \d+ at x(\d+)/.exec(await say())?.[1] ?? NaN);
  await page.keyboard.down("ArrowLeft");
  for (let i = 0; i < 60 && (await him()) - (await me()) < 380; i++) await page.waitForTimeout(100);
  await page.keyboard.up("ArrowLeft");
  const gap = (await him()) - (await me());
  if (!(gap > 300)) fail(`the throw wants the player more than 300 to its left; the gap is ${gap} — ${/boggs[^·]*/.exec(await say())?.[0]}`);
  const hurl = new Set<number>();
  const blows = new Set<number>();
  for (let i = 0; i < 120; i++) {
    const m = /· \d+ cast, nearest cel (\d+) at x (-?\d+), y (-?\d+) blow (-?\d+)/.exec(await say());
    if (m) {
      hurl.add(Number(m[1]));
      blows.add(Number(m[4]));
    }
    await page.waitForTimeout(110);
  }
  if (!hurl.size) fail(`0x41c0dc throws on a countdown of 0x434540(0x1e) + 0x1e; in 120 samples nothing flew — ${/boggs[^·]*/.exec(await say())?.[0]}`);
  if ([...hurl].some((c) => (c < 5610 || c > 5615) && (c < 5530 || c > 5537)))
    fail(`its throw is 5610..5615 in the air and 5530..5537 where it lands; saw ${[...hurl].sort((a, b) => a - b).join(",")}`);
  if (!blows.has(0x14)) fail(`0x41aa30 writes twenty every frame it flies; saw blows ${[...blows].join(",")}`);
  console.log(`ok    ...and beyond three hundred it THROWS — cels ${[...hurl].sort((a, b) => a - b).join(",")}, worth ${[...blows].sort((a, b) => a - b).join("/")}`);

  /**
   * ...and the MACHINERY, which is what the fight is actually about.
   *
   * `0x411ed0` stands eight objects at eight fixed offsets from the body, out of
   * the table at `0x46e088`, and it runs once — at setup — so they never move.
   * Six are scenery. The two that are not are `0x4a56e8` and `0x4a516c`, three
   * thousand each (`0x40e300(0xbb8)`), at `+218` and `+373` from the body's own
   * record point of x6321.
   */
  await go("&x=6100");
  const shape = /machine (\d+)\/3000@x(\d+) (\d+)\/3000@x(\d+) flags (\d)(\d)/.exec(await say());
  if (!shape) fail(`0x411da0 stands up eight, two of them breakable; the HUD says ${/boggs[^·]*·[^·]*·[^·]*/.exec(await say())?.[0]}`);
  const at = shape ?? [];
  if (at[2] !== "6539" || at[4] !== "6694")
    fail(`0x46e088's last two pairs are +218 and +373 off x6321; they stand at x${at[2]} and x${at[4]}`);
  if (at[5] !== "1" || at[6] !== "1")
    fail(`0x46e080 and 0x46e084 both ship as 01 00; the HUD says flags ${at[5]}${at[6]}`);
  console.log(`ok    and its machinery is eight objects, two of three thousand, at x${at[2]} and x${at[4]} with both flags up`);

  /**
   * And BREAKING them is the fight. `0x41b5fc` and `0x41b748` take the damage
   * out of each half; `0x41b611` and `0x41b75d` are the only two writes to the
   * healing flags in the whole program, and each is reached only when its own
   * half has reached zero.
   *
   * So: break one and half the healing stops. Break both and the thirty a frame
   * stops entirely, and only then can the four thousand be spent.
   */
  const read = async (): Promise<{
    px: number; ax: number; cx: number; bx: number;
    a: number; c: number; hp: number; f: string; heals: boolean; dying: boolean;
  }> => {
    const t = await say();
    const m = /machine (\d+)\/3000@x(-?\d+) (\d+)\/3000@x(-?\d+) flags (\d)(\d)/.exec(t);
    return {
      px: Number(/· x (-?\d+)/.exec(t)?.[1] ?? NaN),
      bx: Number(/boggs \S+ cel \d+ at x(-?\d+)/.exec(t)?.[1] ?? NaN),
      hp: Number(/, (\d+)\/4000hp/.exec(t)?.[1] ?? NaN),
      a: Number(m?.[1] ?? NaN), ax: Number(m?.[2] ?? NaN),
      c: Number(m?.[3] ?? NaN), cx: Number(m?.[4] ?? NaN),
      f: `${m?.[5] ?? "?"}${m?.[6] ?? "?"}`,
      heals: /a frame/.test(t), dying: /boggs dying/.test(t),
    };
  };
  const seen = new Map<string, number>();
  let punches = 0;
  let lastX = -1;
  for (let i = 0; i < 1600; i++) {
    const now = await read();
    const key = `${now.f}/${now.dying}`;
    if (!seen.has(key)) seen.set(key, punches);
    if (now.dying) break;
    // stand at whichever half is still up, and punch it
    const want = now.a > 0 ? now.ax : now.c > 0 ? now.cx : now.bx;
    const d = want - now.px;
    if (Math.abs(d) > 55 && now.px !== lastX) {
      const k = d > 0 ? "ArrowRight" : "ArrowLeft";
      lastX = now.px;
      await page.keyboard.down(k);
      await page.waitForTimeout(110);
      await page.keyboard.up(k);
    } else {
      lastX = -1;
      await page.keyboard.press("k");
      punches += 1;
      await page.waitForTimeout(105);
    }
  }
  const end = await read();
  if (!seen.has("01/false")) fail(`emptying 0x4a56ec should clear 0x46e080 and leave 0x46e084 up; the flags went ${[...seen.keys()].join(" -> ")}`);
  if (!seen.has("00/false")) fail(`emptying 0x4a5174 should clear 0x46e084 too; the flags went ${[...seen.keys()].join(" -> ")}`);
  if (!end.dying) fail(`with both flags down the four thousand should fall; after ${punches} punches it is ${end.hp}/4000 with flags ${end.f}`);
  if (end.heals) fail(`0x41be68 heals only while a flag is up; it was still healing at flags ${end.f}`);
  console.log(
    `ok    ...and breaking them is the fight — one half at ${seen.get("01/false")} punches, both at ${seen.get("00/false")}, Boggs down at ${punches}`,
  );

  // the goal is `0x416047`'s, and it wants BOTH the allowance and 0x46bfbc
  await page.waitForTimeout(1200);
  if (!/quota 0 of 1/.test(await say()))
    fail(`Boggs leaves the census the frame it starts dying; the HUD says ${/quota[^·]*/.exec(await say())?.[0]}`);
  console.log(`ok    and the census it was the whole of falls to nothing — ${/quota[^·]*/.exec(await say())?.[0].trim()}`);

  /**
   * ...and the END. `0x41293d` is the last scene of chapter four's runner: with
   * the outer state still 6 it plays `credits.mov` and drops the chapter loop,
   * which hands the game back to its title menu.
   *
   * `credits.mov` is also the menu's own option 6 (`0x4030f7`), so the file
   * being in the rip was never evidence of an ending by itself — `0x41293d` is.
   */
  // ...and WITHOUT reloading, because a reload would stand Boggs back up and
  // `0x416047` would refuse the goal again. The kill left the player at the far
  // right of chamber2, so the goal is back the other way.
  await page.keyboard.down("ArrowLeft");
  let reel = "";
  for (let i = 0; i < 200; i++) {
    const t = await say();
    if (/press ESC to skip/.test(t)) { reel = t; break; }
    await page.waitForTimeout(150);
  }
  await page.keyboard.up("ArrowLeft");
  if (!reel) fail(`with Boggs down the goal opens and walking into it should end the game; nothing played`);
  if (!/^credits\.mov/.test(reel)) fail(`the sixteenth level ends on credits.mov; it played ${reel.slice(0, 40)}`);
  console.log(`ok    ...and only THEN does its goal open, and walking into it ends the game — ${/credits\.mov[^—]*/.exec(reel)?.[0].trim()}`);

  // ...and then the front again, which is where 0x4032a2 sends it
  await page.keyboard.press("Escape");
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  if (!/level 1 · streets/.test(await say()))
    fail(`the credits hand the game back to the front; the HUD says ${/level \d+ · \w+/.exec(await say())?.[0]}`);
  console.log(`ok    ...and hands you back to the front, which is where 0x4032a2 sends it`);

  await finish(browser);
  console.log("PASS  VAT stands, and Boggs' machine can be broken, Boggs killed, and the game finished");
};

await main();
