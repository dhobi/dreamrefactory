/**
 * Where the speedrun drivers AIM, and whether the page reads it back as the
 * pixel they meant ([#277](https://github.com/dhobi/dreamrefactory/issues/277)).
 *
 *   npx vitest run taoot/tests/auto/speedrun-aim.ts
 *
 * Both drivers name a gesture in CANVAS pixels and the page turns a client
 * coordinate back into one with `canvasCoords` (taoot/src/main.ts):
 *
 *     Math.floor((client - origin) / size * n)
 *
 * so the aim is only correct if it survives that floor. It used to be
 * `origin + (v + 0.5) * scale`, which does when a canvas pixel is two client
 * pixels wide and does not when it is one — the coordinate that arrives is a
 * whole number, so half a pixel of centring plus a fractional `rect.top` rounds
 * down into the pixel BEFORE the one asked for.
 *
 * Reported as `dial(slider, 7)` landing on 6, because the coal lever is the one
 * control with no tolerance: `calcswitchdeg` clamps the cursor to 245..345 and
 * divides by 5, so one pixel is one whole setting. Everything else the driver
 * clicks is a hotspot many pixels wide, which is why the same one-pixel error
 * was invisible everywhere else.
 *
 * This is the arithmetic on its own, exhaustively — the browser half is measured
 * against a real page in taoot/tests/browser (see docs/reference/tests.md).
 */
import { test, expect } from "vitest";
import { clientAxis, clientPointFor } from "@dreamfactory/engine/web/speedrun/driver";

/** the page's own reader, verbatim from main.ts's canvasCoords */
const canvasCoord = (client: number, origin: number, size: number, n: number): number =>
  Math.floor(((client - origin) / size) * n);

/**
 * What a browser actually delivers: a whole number of client pixels, and it
 * TRUNCATES rather than rounds.
 *
 * Measured against a real page — at a 1:1 scale with `rect.top` 112.42, the old
 * aim for canvas row 280 was client 392.92 and the row that came back was 279,
 * which is 392 read back and not 393. Rounding would have landed it.
 *
 * The fix does not depend on which it is: {@link clientAxis} returns a whole
 * number, so truncating and rounding are both the identity on it — pinned by
 * "the aim is already integral" below.
 */
const asDelivered = (client: number): number => Math.floor(client);

/** the play page is a fixed 512x384 framebuffer at 4:3 (engine/src/web/screen.ts) */
const CW = 512;
const CH = 384;
/** widths the page can present at: `width: 1024px; max-width: 96vw` */
const WIDTHS = [1024, 900, 800, 768, 700, 640, 600, 512, 480, 400];
/** a rect rarely starts on a whole pixel, and that is half the bug */
const TOPS = [0, 0.42, 0.5, 112.42, 113.6, 200.75];

function check(name: string, ok: boolean, detail = ""): void {
  expect.soft(ok, `${name}${detail ? ` — ${detail}` : ""}`).toBe(true);
}

test("every canvas pixel the drivers aim at reads back as itself (#277)", () => {
  for (const w of WIDTHS) {
    const h = (w * CH) / CW;
    for (const top of TOPS) {
      const missed: number[] = [];
      for (let y = 0; y < CH; y++) {
        const got = canvasCoord(asDelivered(clientAxis(y, top, h, CH)), top, h, CH);
        if (got !== y) missed.push(y);
      }
      // below a 1:1 scale several canvas pixels share one client pixel, so some
      // are genuinely unaddressable — nothing can aim at them. At 1:1 and above
      // every one of them must land.
      if (h >= CH) {
        check(`${w}px, top ${top}: every row lands`, !missed.length,
          `${missed.length} missed, first few ${missed.slice(0, 6).join(",")}`);
      } else {
        // and even then the misses may not be worse than the pixels the scale
        // has thrown away: at most one canvas row per client row can survive
        const survivable = CH - Math.floor(CH - h);
        check(`${w}px, top ${top}: no more missed than the scale itself loses`,
          CH - missed.length >= survivable - 1, `${CH - missed.length} of ${CH} land`);
      }
    }
  }
});

test("the old half-pixel aim is what missed, and by exactly one (#277)", () => {
  const oldAim = (v: number, origin: number, size: number, n: number): number =>
    origin + ((v + 0.5) / n) * size;
  let missed = 0;
  let byOne = 0;
  for (const w of WIDTHS) {
    const h = (w * CH) / CW;
    // At a 1:1 scale or better the aim can only fall one pixel short: half a
    // canvas pixel is at least half a client pixel, and rounding moves the
    // delivered coordinate by at most half of one. Below 1:1 a client pixel
    // spans several canvas pixels and a miss can be by more, so the size of the
    // error is only pinned where it is pinnable.
    if (h < CH) continue;
    for (let y = 0; y < CH; y++) {
      const got = canvasCoord(asDelivered(oldAim(y, 112.42, h, CH)), 112.42, h, CH);
      if (got !== y) {
        missed++;
        if (got === y - 1) byOne++;
      }
    }
  }
  check("the old aim missed", missed > 0, `${missed} rows`);
  check("...and every miss was low by exactly one", byOne === missed, `${byOne} of ${missed}`);
});

test("the coal lever's twenty-one stops are all reachable (#277)", () => {
  // COAL_LEVER: top 245, bottom 345, pitch 5 — and setLever aims at the band's
  // MIDDLE, which is the tolerance the control already has
  for (const w of WIDTHS) {
    const h = (w * CH) / CW;
    for (const top of TOPS) {
      const bad: string[] = [];
      for (let deg = 0; deg <= 20; deg++) {
        const band = 245 + deg * 5;
        const aim = band + 2;
        const y = canvasCoord(asDelivered(clientAxis(aim, top, h, CH)), top, h, CH);
        const got = Math.floor((Math.max(245, Math.min(345, y)) - 245) / 5);
        if (got !== deg) bad.push(`${deg}->${got}`);
      }
      check(`${w}px, top ${top}: dial(slider, n) reaches every n`, !bad.length, bad.join(" "));
    }
  }
});

test("the aim is already integral, so how the browser delivers it cannot matter (#277)", () => {
  for (const w of WIDTHS) {
    const h = (w * CH) / CW;
    for (const top of TOPS) {
      const fractional: number[] = [];
      for (let y = 0; y < CH; y++) {
        const c = clientAxis(y, top, h, CH);
        if (!Number.isInteger(c)) fractional.push(y);
      }
      check(`${w}px, top ${top}: every aim is a whole client pixel`, !fractional.length,
        `${fractional.length} fractional`);
    }
  }
});

test("clientPointFor does both axes the same way", () => {
  const rect = { left: 33.7, top: 112.42, width: 640, height: 480 };
  for (const [x, y] of [[0, 0], [256, 192], [511, 383], [7, 280]]) {
    const p = clientPointFor(x, y, rect, { width: CW, height: CH });
    check(`(${x},${y}) x lands`,
      canvasCoord(asDelivered(p.x), rect.left, rect.width, CW) === x);
    check(`(${x},${y}) y lands`,
      canvasCoord(asDelivered(p.y), rect.top, rect.height, CH) === y);
  }
});
