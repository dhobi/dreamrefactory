/**
 * The cow menu's credits, run — `NEW.FLT/0028` into `CREDITS.FLT` and
 * `CREDITS.PRP`, all eight pages and back out.
 *
 *   npm run test:machine -w dust -- tests/machine/credits.ts
 *
 * The horn opens the `score` flat, and its `credits` button (container 28)
 * is `runcredits ()`: close the stage, open `credits.flt` and `credits.prp`,
 * and hand the shop `scrollnames ()`. From there the credits are a prop loop
 * with no player in it at all — `namesup` moves the `names` prop up three
 * pixels a pass, `propdone` says when page N has cleared the top, and the
 * stage's `nextflat` fades to the next of 21 backdrops and starts page N+1,
 * wrapping 8 → 1. A click anywhere is `closecredits ()`: `new.flt` again at
 * flat 4, with the theme the credits interrupted.
 *
 * So the thing worth pinning is that the LOOP carries itself through every
 * page: a `makeloop` that stopped re-arming, a `propview` that never advanced,
 * or a fade that never returned would each stall the credits on one page,
 * with nothing thrown.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SAVES, haveRip, newDustHost, pumped } from "../playthrough/harness";

const run = haveRip() ? test : test.skip;

/** `CREDITS.PRP`'s own starting heights and `propdone`'s exit lines, page by page */
const START = [888, 985, 1267, 1112, 927, 906, 980, 789];
const CLEAR = [-624, -721, -1003, -848, -663, -642, -716, -525];

run("the credits scroll all eight pages, wrap, and a click puts the panel back", async () => {
  const { host, logs } = await newDustHost();
  const p = pumped(host, logs);
  const s = p.session;
  // the saloon, with saloon2's theme going: something for the credits to interrupt
  expect(await s.loadGame(new Uint8Array(readFileSync(`${SAVES}/D1E_002.RTD`)))).toBe(true);
  await p.settle("D1E_002");
  const before = s.currentThemeName;
  expect(before, "the saloon's theme is playing").not.toBe("none");

  // the horn, then the credits button — NEW.FLT's own click regions
  const horn = p.fire(200, 325);
  await p.pump(horn, "the horn");
  await p.settle("the score flat");
  expect(s.currentFlat).toBe("score");
  const credits = p.fire(395, 321);
  await p.pump(() => String(s.stageName).toLowerCase().startsWith("credits"), "credits.flt");
  expect(s.currentThemeName, "CREDITS.FLT's openstage plays its own theme").toBe("credits");

  const names = () => s.propRuntime.get("names");
  const page = () => String(names()?.stateName ?? "");
  const y = () => Number(names()?.anchorY ?? NaN);

  // every page, in order: it starts where scrollnames puts it, climbs, and
  // leaves past propdone's line — then the next page takes over
  const seen: number[] = [];
  const flats: string[] = [];
  for (let i = 0; i < 9; i++) {
    const want = (i % 8) + 1;
    await p.pump(() => page() === String(want) && !!names()?.visible, `page ${want} to show`, 4000);
    await p.pump(() => y() < START[want - 1], `page ${want} to start climbing`, 400);
    flats.push(s.currentFlat);
    seen.push(want);
    if (i === 8) break;
    const top = y();
    expect(top, `page ${want} starts at scrollnames' height`).toBeGreaterThan(START[want - 1] - 12);
    let last = top;
    await p.pump(
      () => {
        if (page() !== String(want)) return true;
        last = y();
        return false;
      },
      `page ${want} to clear the top`,
      2000,
    );
    // three pixels a pass, and it leaves on the first pass past propdone's line
    expect(last, `page ${want} left past its line`).toBeLessThan(CLEAR[want - 1]);
    expect(last, `page ${want} left on the first pass past it`).toBeGreaterThanOrEqual(CLEAR[want - 1] - 3);
  }
  expect(seen, "all eight pages, then page 1 again").toEqual([1, 2, 3, 4, 5, 6, 7, 8, 1]);
  // a new backdrop for every page: nextflat walks the 21 flats in order —
  // `gotoflat (n)` is 1-based, and the flats are named "Flat 0".."Flat 20"
  const numbers = flats.map((f) => Number(/\d+/.exec(f)?.[0] ?? NaN));
  for (let i = 1; i < numbers.length; i++) {
    expect(numbers[i], `backdrop after ${flats[i - 1]}`).toBe((numbers[i - 1] + 1) % 21);
  }

  // A click anywhere ends it: back to the panel's flat 4 and the saloon's theme.
  //
  // Made in the middle of a page change, with `nextflat`'s fade running and the
  // `namesup` loop served every pass — the moment a click used to be lost. It
  // is QUEUED (something holds the screen), and DF.EXE's main loop (0x4115f0)
  // pops its queue at the head of every pass, so it is taken as soon as nothing
  // from an earlier pass is still running. The room's own pop came after the
  // pass's loops, with `namesup` always in flight there, and never took it.
  void credits;
  await p.pump(() => s.fading, "the next page's fade", 4000);
  expect(s.scriptBusy || s.fading, "something holds the screen").toBe(true);
  const out = p.fire(256, 192);
  await p.pump(() => String(s.stageName).toLowerCase() === "new.flt", "new.flt again", 2000);
  await p.pump(out, "closecredits to return", 2000);
  await p.settle("the panel");
  expect(s.currentFlat, "NEW.FLT's flat 4").toBe("score");
  expect(s.currentThemeName, "the theme the credits interrupted").toBe(before);
}, 300_000);
