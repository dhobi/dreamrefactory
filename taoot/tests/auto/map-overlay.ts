/**
 * The developer-mode deck map overlay, as it runs on the page
 * (`installMapOverlay` in taoot/src/devmode/map-overlay.ts).
 *
 *   npx vitest run taoot/tests/auto/map-overlay.ts
 *
 * The rectangles themselves are devmode.ts's, checked against MAP.STG. What is
 * pinned here is the frame loop that puts them on the page:
 *
 *   - it shows only while the map stage is up, and only if developer mode left
 *     it switched on;
 *   - the boxes are rebuilt when the PLAN changes and not every frame — a page
 *     turn redraws, a frame on the same plan only moves the container;
 *   - the container takes the canvas's viewport rect every frame, because the
 *     canvas moves with a scroll or a resize and the boxes are percentages of it;
 *   - a debug box near the top of the picture has its label put below it, since
 *     one above would be clipped off the top.
 *
 * Node has no DOM, so `document` and `requestAnimationFrame` are stand-ins: a
 * tree of plain objects with the fields the overlay writes, and a frame queue
 * the test steps by hand.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MAP_STAGE, boxesOn, installMapOverlay } from "../../src/devmode/map-overlay";

/** the fields of an element the overlay touches */
interface FakeEl {
  tag: string;
  id: string;
  className: string;
  textContent: string;
  style: Record<string, string>;
  children: FakeEl[];
  attrs: Record<string, string>;
}

let body: FakeEl;
/** the callbacks waiting for the next frame */
let frames: (() => void)[] = [];
let cancelled: number[] = [];

const el = (tag: string): FakeEl => {
  const e: FakeEl = { tag, id: "", className: "", textContent: "", style: {}, children: [], attrs: {} };
  Object.assign(e, {
    append: (...c: FakeEl[]) => e.children.push(...c),
    replaceChildren: () => void (e.children = []),
    setAttribute: (k: string, v: string) => void (e.attrs[k] = v),
  });
  return e;
};

beforeEach(() => {
  body = el("body");
  frames = [];
  cancelled = [];
  vi.stubGlobal("document", { createElement: el, body });
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => cancelled.push(id));
});
afterEach(() => vi.unstubAllGlobals());

/** run the frame that is due, as the browser would */
const tick = (): void => {
  const due = frames;
  frames = [];
  for (const f of due) f();
};

/** a page whose game is wherever `at` says, and whose canvas is at `rect` */
function page(at: { stage: string; flat: string }, rect = { left: 10, top: 20, width: 512, height: 384 }) {
  let reads = 0;
  const overlay = installMapOverlay({
    screen: {
      getBoundingClientRect: () => {
        reads++;
        return rect;
      },
    } as unknown as HTMLCanvasElement,
    where: () => at,
  });
  return { overlay, root: overlay.element as unknown as FakeEl, reads: () => reads, at, rect };
}

test("it is on the page from the start, hidden from assistive tech, and drawn by frames", () => {
  const p = page({ stage: "main.stg", flat: "main 1" });
  expect(body.children).toEqual([p.root]);
  expect(p.root.id).toBe("devmap");
  expect(p.root.attrs["aria-hidden"]).toBe("true");
  expect(frames).toHaveLength(1);
});

test("off the map stage it is hidden and draws nothing", () => {
  const p = page({ stage: "main.stg", flat: "map 2" });
  tick();
  expect(p.root.style.display).toBe("none");
  expect(p.root.children).toEqual([]);
  expect(p.reads()).toBe(0);
});

test("on the map it draws the plan's boxes, as percentages, labelled with where they go", () => {
  const p = page({ stage: MAP_STAGE.toUpperCase(), flat: "Map 2" });
  tick();
  expect(p.root.style.display).toBe("block");
  const want = boxesOn("Map 2");
  expect(want.length).toBeGreaterThan(0);
  expect(p.root.children.map((c) => [c.style.left, c.style.top, c.style.width, c.style.height])).toEqual(
    want.map((b) => [b.left, b.top, b.width, b.height]),
  );
  expect(p.root.children.map((c) => c.children[0].textContent)).toEqual(want.map((b) => b.area.to));
  for (const [i, c] of p.root.children.entries()) {
    expect(c.className.split(" ").slice(0, 2)).toEqual(["devarea", want[i].area.kind]);
    // a strip near the top gets its label below — one above would be clipped off
    expect(c.className.includes(" high")).toBe(want[i].area.top < 14);
  }
});

test("it follows the canvas every frame, and rebuilds only when the plan turns", () => {
  const p = page({ stage: MAP_STAGE, flat: "Map 2" });
  tick();
  const first = p.root.children;
  expect(p.root.style).toMatchObject({ left: "10px", top: "20px", width: "512px", height: "384px" });

  // the page scrolled: the container moves, the boxes are the same objects
  Object.assign(p.rect, { top: -80, width: 1024, height: 768 });
  tick();
  expect(p.root.children).toBe(first);
  expect(p.root.style).toMatchObject({ top: "-80px", width: "1024px", height: "768px" });

  // a page turn: a new set of boxes
  p.at.flat = "Map 3";
  tick();
  expect(p.root.children).not.toBe(first);
  expect(p.root.children.map((c) => c.children[0].textContent)).toEqual(boxesOn("Map 3").map((b) => b.area.to));
});

test("switched off it hides on the map too, and switched on it comes back", () => {
  const p = page({ stage: MAP_STAGE, flat: "Map 2" });
  p.overlay.enabled(false);
  tick();
  expect(p.root.style.display).toBe("none");
  p.overlay.enabled(true);
  tick();
  expect(p.root.style.display).toBe("block");
});

test("stop cancels the frame it has asked for", () => {
  const p = page({ stage: MAP_STAGE, flat: "Map 2" });
  tick();
  // every frame asks for the next first, so the one to cancel is the latest
  const pending = frames.length;
  p.overlay.stop();
  expect(pending).toBe(1);
  expect(cancelled).toHaveLength(1);
});
