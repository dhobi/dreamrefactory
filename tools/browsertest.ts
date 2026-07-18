/** Real-browser repro of the Scene51/View65 menu movie flow. */
import { chromium } from "playwright-core";

const state = async (page: any) =>
  page.evaluate(() => {
    const d = (window as any).dbg;
    const v = d.viewer;
    return {
      set: d.session.currentSetName,
      scene: v?.scene.sceneName,
      view: v?.scene.views[v.viewIdx]?.viewName,
      movie: v?.moviePlaying ?? false,
      canvas: (() => {
        const c = document.getElementById("screen") as HTMLCanvasElement;
        const r = c.getBoundingClientRect();
        return { aw: c.width, ah: c.height, cw: r.width, ch: r.height };
      })(),
    };
  });

/** click at canvas-pixel coords via a real mouse event */
async function canvasClick(page: any, x: number, y: number) {
  const pt = await page.evaluate(
    ([x, y]: number[]) => {
      const c = document.getElementById("screen") as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      return { px: r.left + ((x + 0.5) / c.width) * r.width, py: r.top + ((y + 0.5) / c.height) * r.height };
    },
    [x, y],
  );
  await page.mouse.click(pt.px, pt.py);
}

const OUT = process.env.SHOT_DIR ?? ".";
const shot = async (page: any, name: string) => {
  const c = await page.$("#screen");
  await c.screenshot({ path: `${OUT}/${name}.png` });
};

const main = async () => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1300 } });
  page.on("console", (m: any) => console.log("[console]", m.text()));
  page.on("pageerror", (e: any) => console.log("[pageerror]", e.message));
  await page.goto("http://localhost:5199/");
  await page.waitForFunction(() => document.querySelectorAll("#drop button").length > 0, null, { timeout: 15000 });

  // load C73.SET from the server list
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("#drop button")] as HTMLButtonElement[];
    const b = btns.find((b) => b.textContent?.toLowerCase().includes("c73"));
    if (!b) throw new Error("no C73 button; have: " + btns.map((x) => x.textContent).join(","));
    b.click();
  });
  await page.waitForFunction(() => !!(window as any).dbg.viewer, null, { timeout: 15000 });
  await page.waitForTimeout(1500); // let sibling fetches land
  console.log("after load:", await state(page));

  await page.evaluate(() => (window as any).dbg.viewer.jumpTo("Scene51", "View65"));
  console.log("after jump:", await state(page));

  // find the menu hotspot rect
  const hs = await page.evaluate(() => {
    const v = (window as any).dbg.viewer;
    const o = v.scene.views[v.viewIdx].objects.map((o: any) => ({
      id: o.identifier, x0: o.startRegionX, y0: o.startRegionY, x1: o.endRegionX, y1: o.endRegionY,
    }));
    return o;
  });
  console.log("hotspots:", JSON.stringify(hs));
  const menu = hs.find((o: any) => o.id.toLowerCase().includes("menu")) ?? hs[0];
  await canvasClick(page, Math.floor((menu.x0 + menu.x1) / 2), Math.floor((menu.y0 + menu.y1) / 2));
  await page.waitForTimeout(1500); // movie fetch + open
  console.log("after menu click:", await state(page));
  await shot(page, "1-initial-still");

  // 1) OK on the initial still should leave
  await canvasClick(page, 460, 350);
  await page.waitForTimeout(1000);
  console.log("after OK on still:", await state(page));

  // reopen for the full cycle
  await canvasClick(page, Math.floor((menu.x0 + menu.x1) / 2), Math.floor((menu.y0 + menu.y1) / 2));
  await page.waitForTimeout(1200);
  console.log("reopened:", await state(page));

  await canvasClick(page, 100, 100); // start
  await page.waitForTimeout(1500);
  console.log("after start click:", await state(page));
  await shot(page, "2-first-pause");

  await canvasClick(page, 280, 210); // paper -> zoom
  await page.waitForTimeout(1500);
  console.log("after paper click:", await state(page));
  await shot(page, "3-zoomed");

  await canvasClick(page, 250, 200); // unzoom
  await page.waitForTimeout(1500);
  console.log("after unzoom click:", await state(page));
  await shot(page, "4-unzoomed");

  await canvasClick(page, 460, 350); // OK -> leave
  await page.waitForTimeout(1500);
  console.log("after OK click:", await state(page));

  const log = await page.evaluate(() => (document.getElementById("scriptlog") as HTMLElement).textContent);
  console.log("---- script log ----\n" + log);
  await browser.close();
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
