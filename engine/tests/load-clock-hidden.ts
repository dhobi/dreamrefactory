/**
 * A hidden tab stops the speedrun clock, as a download does (#375;
 * engine/src/web/load-clock.ts).
 *
 *   npx vitest run engine/tests/load-clock-hidden.ts
 *
 * A hidden page gets no animation frames, so the game stands still, but the
 * wall clock went on: one look at another tab on the way down to G deck cost a
 * run ten seconds. The fix puts the hidden time into the same stopwatch the
 * network waits go into, so every reading that already took the loading out
 * (the ticking clock, every split, the total) takes the tab out too. These pin
 * the arithmetic, on a clock whose `now` the test turns by hand, and the wiring
 * to the page's events, on an `EventTarget` standing where `document` and
 * `window` would.
 */
import { expect, test } from "vitest";
import { LoadClock, watchVisibility, type Served } from "@dreamfactory/engine/web/load-clock";

function clock(served: Served | null = "network") {
  let t = 0;
  const c = new LoadClock({ now: () => t, served: () => served });
  return { c, at: (ms: number) => void (t = ms) };
}

test("time out of sight is taken out of the run, and counted on its own", () => {
  const { c, at } = clock();
  at(1_000);
  c.hide();
  at(11_000);
  c.show();
  expect(c.ms).toBe(10_000);
  expect(c.hiddenMs).toBe(10_000);
  // a second hide while hidden, or a show while shown, changes nothing
  at(12_000);
  c.show();
  c.hide();
  c.hide();
  at(13_000);
  c.show();
  expect(c.hiddenMs).toBe(11_000);
  expect(c.ms).toBe(11_000);
});

test("a download while the tab is hidden is one stop, not two", () => {
  const { c, at } = clock();
  at(0);
  c.begin(1, "/gamefiles/deckbd2.set");
  at(2_000);
  c.hide();
  at(5_000);
  c.end(1);
  at(9_000);
  c.show();
  // the game was stopped from 0 to 9 s, once
  expect(c.ms).toBe(9_000);
  expect(c.hiddenMs).toBe(7_000);
});

test("hidden time counts even where a quick fetch would not", () => {
  // a hidden spell shorter than the cache grace is still time out of sight, and
  // a cache hit inside it is part of the same stop
  const { c, at } = clock("cache");
  at(100);
  c.hide();
  c.begin(1, "/gamefiles/x.set");
  at(130);
  c.end(1);
  at(140);
  c.show();
  expect(c.ms).toBe(40);
  expect(c.hiddenMs).toBe(40);
});

test("while hidden the reading keeps up, as it does through a long download", () => {
  const { c, at } = clock();
  at(0);
  c.hide();
  at(5_000);
  // mid-absence the total is already most of it, and it never runs backwards
  const mid = c.ms;
  expect(mid).toBeGreaterThan(4_900);
  at(6_000);
  c.show();
  expect(c.ms).toBe(6_000);
  expect(c.ms).toBeGreaterThanOrEqual(mid);
});

test("the page's events drive it: a tab switch, a frozen page, and one opened behind", () => {
  const { c, at } = clock();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const win = new EventTarget();
  const stop = watchVisibility(c, doc, win);

  at(1_000);
  doc.hidden = true;
  doc.dispatchEvent(new Event("visibilitychange"));
  at(3_000);
  doc.hidden = false;
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(c.hiddenMs).toBe(2_000);

  // a phone freezes the page without ever calling it hidden
  at(4_000);
  win.dispatchEvent(new Event("pagehide"));
  at(4_500);
  win.dispatchEvent(new Event("pageshow"));
  expect(c.hiddenMs).toBe(2_500);

  // after stopping, nothing reaches the clock
  stop();
  doc.hidden = true;
  doc.dispatchEvent(new Event("visibilitychange"));
  at(9_000);
  expect(c.hiddenMs).toBe(2_500);

  // a page opened in a background tab starts hidden
  const behind = clock();
  behind.at(0);
  watchVisibility(behind.c, Object.assign(new EventTarget(), { hidden: true }), new EventTarget());
  behind.at(700);
  expect(behind.c.hiddenMs).toBe(700);
});

test("with no page to watch, there is nothing to stop", () => {
  const { c } = clock();
  const stop = watchVisibility(c, undefined, undefined);
  stop();
  expect(c.hiddenMs).toBe(0);
});
