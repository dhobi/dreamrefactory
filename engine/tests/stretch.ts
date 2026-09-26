/**
 * The stretched fullscreen: a remembered checkbox, and the pointer maths it
 * relies on not needing.
 *
 *   npx vitest run engine/tests/stretch.ts
 *
 * What the stretch LOOKS like is the pages' CSS and is checked in a browser.
 * What can be held here is the part with a right answer: that the box and the
 * stage agree, that the answer outlives the tab and is per game, that a page
 * with no box still gets it — and that a click on a picture stretched out of
 * 4:3 still lands on the screen pixel under it, which is the claim that let this
 * be a CSS change and not an engine one.
 */
import { test, expect, beforeEach } from "vitest";
import { parseHTML } from "linkedom";
import { STRETCH_CLASS, installStretch } from "@dreamfactory/engine/web/stretch";
import { clientPointFor } from "@dreamfactory/engine/web/speedrun/driver";

/** a Storage that can also refuse, the way a private window's may */
function storage(): Storage & { deny: boolean } {
  const m = new Map<string, string>();
  const s = {
    deny: false,
    getItem(k: string) {
      if (s.deny) throw new Error("denied");
      return m.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      if (s.deny) throw new Error("denied");
      m.set(k, v);
    },
  };
  return s as unknown as Storage & { deny: boolean };
}

let store: ReturnType<typeof storage>;
beforeEach(() => {
  store = storage();
  (globalThis as Record<string, unknown>).localStorage = store;
});

function page(): { stage: HTMLElement; box: HTMLInputElement; change: () => void } {
  const { document, Event } = parseHTML(
    `<html><body>
       <div id="stage"><canvas id="screen"></canvas></div>
       <div id="under"><label><input type="checkbox" id="stretchBox"> stretch</label></div>
     </body></html>`,
  );
  const box = document.getElementById("stretchBox") as unknown as HTMLInputElement;
  return {
    stage: document.getElementById("stage") as unknown as HTMLElement,
    box,
    change: () => box.dispatchEvent(new Event("change")),
  };
}

test("letterboxed until asked, and the box and the stage agree", () => {
  const { stage, box, change } = page();
  installStretch(box, stage, "game.stretch");
  expect(box.checked).toBe(false);
  expect(stage.classList.contains(STRETCH_CLASS)).toBe(false);

  box.checked = true;
  change();
  expect(stage.classList.contains(STRETCH_CLASS)).toBe(true);
  box.checked = false;
  change();
  expect(stage.classList.contains(STRETCH_CLASS)).toBe(false);
});

test("the answer outlives the tab, per game", () => {
  const first = page();
  installStretch(first.box, first.stage, "game.stretch");
  first.box.checked = true;
  first.change();

  const again = page();
  installStretch(again.box, again.stage, "game.stretch");
  expect(again.box.checked).toBe(true);
  expect(again.stage.classList.contains(STRETCH_CLASS)).toBe(true);

  // another game's page has said nothing
  const other = page();
  installStretch(other.box, other.stage, "other.stretch");
  expect(other.stage.classList.contains(STRETCH_CLASS)).toBe(false);
});

test("a page without the box still gets the remembered answer", () => {
  store.setItem("game.stretch", "1");
  const { stage } = page();
  installStretch(null, stage, "game.stretch");
  expect(stage.classList.contains(STRETCH_CLASS)).toBe(true);
});

test("storage that refuses costs the memory, not the setting", () => {
  store.deny = true;
  const { stage, box, change } = page();
  installStretch(box, stage, "game.stretch");
  box.checked = true;
  expect(() => change()).not.toThrow();
  expect(stage.classList.contains(STRETCH_CLASS)).toBe(true);
});

test("a click on a picture stretched out of 4:3 lands on the pixel under it", () => {
  // 512x384 filling a 1920x1080 display: 3.75x across, 2.8125x down
  const canvas = { width: 512, height: 384 };
  const rect = { left: 0, top: 0, width: 1920, height: 1080 };
  // the shells' own conversion, per axis (taoot/src/main.ts canvasCoords)
  const toScreen = (cx: number, cy: number) => ({
    x: Math.floor(((cx - rect.left) / rect.width) * canvas.width),
    y: Math.floor(((cy - rect.top) / rect.height) * canvas.height),
  });
  for (const [x, y] of [
    [0, 0],
    [511, 383],
    [256, 192],
    [100, 300],
    [450, 20],
  ]) {
    const at = clientPointFor(x, y, rect, canvas);
    expect(toScreen(at.x, at.y)).toEqual({ x, y });
  }
});
