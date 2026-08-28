/**
 * Are the shooting range's targets ON THE CANVAS?
 *
 *   npm run dev:dust
 *   npx tsx dust/tests/browser/shooting-range.ts
 *
 * The headless test beside this one (dust/tests/targets.ts) proves the range is
 * placed and hit-tested — that the bottles are 2D actors at the pixels
 * `TARGET.CST` names, and that a shot at one reports that one. What it cannot say
 * is the reporter's actual sentence: "the target's didn't appear" (#292). A draw
 * list is not a picture.
 *
 * So this asks the pixels. It opens the range, photographs the rectangle a bottle
 * occupies, takes the bottle away, photographs it again — and requires the two to
 * differ. That is the whole assertion, and it is one a list cannot pass by
 * accident: the sprite is either compositing into those pixels or it is not.
 *
 * It also fires the game's own `hittest` at a pixel of each bottle, because the
 * range's shot handler is `temp = hittest (thepoint)` / `sendtoactor (temp, hit
 * ())` — so what that call answers IS which target breaks, and two of the three
 * bottles are `actorinstance` copies of the first one's cast member.
 */
import { chromium, type Browser, type Page } from "playwright";

/** Dust's own dev port (5175 Titanic, 5176 Dust, 5177 Timelapse) */
const APP_URL = process.env.APP_URL ?? "http://localhost:5176/";
/** written when a check fails, so a failure is something you can look at */
const SHOT = process.env.SHOT ?? "out/shooting-range.png";

const fail: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail.push(name);
};

/** the canvas pixels of one rect, summed per channel — a cheap "is it the same picture" */
const pixelSum = async (page: Page, r: { x: number; y: number; w: number; h: number }): Promise<number> =>
  page.evaluate((rect) => {
    const c = document.getElementById("screen") as HTMLCanvasElement;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    const d = ctx.getImageData(rect.x, rect.y, rect.w, rect.h).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] * 65536 + d[i + 1] * 256 + d[i + 2];
    return sum;
  }, r);

const main = async (): Promise<void> => {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", (e) => console.log("[pageerror]", e.message));
    await page.goto(APP_URL);
    await page.locator("#start").waitFor({ state: "visible", timeout: 120000 });
    await page.locator("#start").click();
    await page.waitForFunction(() => !!(window as unknown as { dbg?: { viewer?: unknown } }).dbg?.viewer, null, {
      timeout: 300000,
    });

    // the range, through the host's own set activation — TARGET.SET's `openset`
    // opens the cast, the shop and the flat, and the cast's `initactors` places
    // every target. Nothing here places anything itself.
    await page.evaluate(() => (window as unknown as { dbg: { host: { loadServerSet: (s: string) => Promise<unknown> } } }).dbg.host.loadServerSet("target.set"));
    await page.waitForTimeout(4000);
    const room = await page.evaluate(() => {
      const s = (window as unknown as { dbg: { session: { currentSetFile: string; currentSceneName: () => string } } }).dbg.session;
      return `${s.currentSetFile} ${s.currentSceneName()}`;
    });
    check("the range opens", room.toLowerCase().startsWith("target"), room);

    // what the booth is showing, and where each sprite lands
    const drawn = await page.evaluate(() => {
      const R = (window as unknown as { dbg: { session: { actorRuntime: {
        screenDrawList: () => { name: string }[];
        get: (n: string) => unknown;
        screenRect: (a: unknown) => { x: number; y: number; w: number; h: number } | null;
      } } } }).dbg.session.actorRuntime;
      return R.screenDrawList().map((a) => ({ name: a.name, rect: R.screenRect(a)! }));
    });
    console.log(`  the booth shows: ${drawn.map((d) => `${d.name}@${d.rect.x},${d.rect.y}`).join(" ")}`);
    const want = ["bottle1targ", "bottle2targ", "bottle3targ", "can1targ", "can2targ", "can3targ", "vanetarg"];
    check(
      "every day-1 target is in the picture",
      want.every((n) => drawn.some((d) => d.name === n)),
      `${drawn.length} drawn`,
    );

    // THE PIXELS. Photograph a bottle's rectangle, take the bottle away, and
    // photograph it again: a sprite that is compositing changes them.
    for (const name of ["bottle2targ", "can2targ", "vanetarg"]) {
      const entry = drawn.find((d) => d.name === name);
      if (!entry) { check(`${name}: in the draw list`, false); continue; }
      const before = await pixelSum(page, entry.rect);
      await page.evaluate((n) => {
        const a = (window as unknown as { dbg: { session: { actorRuntime: { get: (s: string) => { visible: boolean } } } } })
          .dbg.session.actorRuntime.get(n);
        a.visible = false;
      }, name);
      await page.waitForTimeout(400); // a frame or two, and the presenter's repaint
      const without = await pixelSum(page, entry.rect);
      await page.evaluate((n) => {
        const a = (window as unknown as { dbg: { session: { actorRuntime: { get: (s: string) => { visible: boolean } } } } })
          .dbg.session.actorRuntime.get(n);
        a.visible = true;
      }, name);
      await page.waitForTimeout(400);
      const again = await pixelSum(page, entry.rect);
      check(
        `${name} is drawn into its own rectangle`,
        before !== without && again === before,
        `with=${before} without=${without} back=${again}`,
      );
    }

    // ...and the shot. `hittest` is what TARGET.FLT's `bullet` asks, so its answer
    // is which target breaks — including for the two bottles that are copies.
    const shots = await page.evaluate((names: string[]) => {
      const d = (window as unknown as { dbg: { session: {
        actorRuntime: { get: (n: string) => unknown; screenRect: (a: unknown) => { x: number; y: number; f: { width: number; opaque: Uint8Array } } | null };
        interp: { builtins: Map<string, (i: unknown, a: unknown[], f: unknown, g: unknown) => unknown> };
      } } }).dbg.session;
      const out: { name: string; at: string; hit: unknown }[] = [];
      for (const n of names) {
        const r = d.actorRuntime.screenRect(d.actorRuntime.get(n))!;
        // the first opaque pixel of the sprite, which is a pixel a player can hit
        let at: [number, number] | null = null;
        for (let y = 0; y < 200 && !at; y++) {
          for (let x = 0; x < 200 && !at; x++) {
            if (r.f.opaque[y * r.f.width + x]) at = [r.x + x, r.y + y];
          }
        }
        if (!at) continue;
        // makepoint packs the pair the way every pointer builtin expects
        const point = d.interp.builtins.get("makepoint")!(d.interp, [at[0], at[1]], null, null);
        out.push({ name: n, at: `${at[0]},${at[1]}`, hit: d.interp.builtins.get("hittest")!(d.interp, [point], null, null) });
      }
      return out;
    }, ["bottle1targ", "bottle2targ", "bottle3targ"]);
    for (const s of shots) {
      check(`a shot at ${s.name} (${s.at}) reports ${s.name}`, s.hit === s.name, `hittest = ${JSON.stringify(s.hit)}`);
    }
  } finally {
    if (fail.length && browser) {
      const page = browser.contexts()[0]?.pages()[0];
      if (page) await page.locator("#screen").screenshot({ path: SHOT }).catch(() => undefined);
      console.log(`  a picture of the failure: ${SHOT}`);
    }
    await browser?.close();
  }
  console.log(fail.length ? `\n${fail.length} check(s) failed` : "\nall checks passed");
  if (fail.length) process.exitCode = 1;
};

void main();
