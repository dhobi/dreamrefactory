/**
 * The deck map's hidden areas, drawn over the plan while it is open.
 *
 * Developer mode opens 14 red areas the shipped game refuses, and the reason
 * they are hard to use is not the flag — it is that **nothing marks them**. The
 * map's own legend says "Click the red areas on the map to jump to that area of
 * the ship", and only the 17 live ones are painted in that reddish fill; every
 * debug area sits on plain, unhighlighted plan artwork, and its `setcursor` says
 * `cursor ("arrow")` where a live one says `cursor ("touch")`. So there is no
 * visual cue at all, and no cursor change either. The 1996 developer had to know
 * where they were.
 *
 * This draws them. The rectangles are the file's own
 * ({@link file://./areas.gen.ts}, read out of MAP.STG by taoot/tools/mapareas.ts),
 * so the overlay cannot drift from what the engine will actually hit.
 *
 * ## It is a picture and nothing else
 *
 * `pointer-events: none`, and no click handler anywhere in here. The overlay
 * never decides what a press does — the engine's own `hittest` resolves every
 * click exactly as it does on the play page, and turning the overlay off changes
 * nothing about where a click lands. That matters because the alternative shape,
 * a layer that catches clicks and forwards them, would be a second hit test
 * that could disagree with the real one.
 *
 * ## Why percentages, and a rect updated per frame
 *
 * Each box is positioned as a PERCENTAGE of the game's own 512x384 screen, so
 * the boxes need no recomputing when the picture is resized — the browser scales
 * them with the container. What does need watching is where the canvas IS: it
 * moves when the page scrolls or the window changes, so the container is
 * `position: fixed` and takes the canvas's viewport rect once a frame, which is
 * exact by construction and costs one `getBoundingClientRect`.
 */
import { MAP_AREAS, type MapArea } from "./areas.gen";

export { MAP_AREAS };
export type { MapArea };

/** the game's own screen, which the rectangles are in */
export const SCREEN_W = 512;
export const SCREEN_H = 384;

/** the stage the deck map is, as `session.stageName` reports it */
export const MAP_STAGE = "map.stg";

/** the areas on one plan, by the flat name `session.currentFlat` reports */
export function areasOn(flat: string): MapArea[] {
  const key = flat.toLowerCase();
  return MAP_AREAS.filter((a) => a.flat.toLowerCase() === key);
}

/** where a box sits, as CSS percentages of the picture */
export interface Box {
  area: MapArea;
  left: string;
  top: string;
  width: string;
  height: string;
}

/**
 * Lay an area out as percentages.
 *
 * The rect is INCLUSIVE at both ends — a region from x 27 to x 137 is 111 pixels
 * wide, not 110 — which is the same convention `pointinbutton` uses. One pixel
 * is not visible in a box drawn over artwork, but getting it wrong here would
 * quietly disagree with the hit test it is drawn to explain.
 */
export function boxOf(area: MapArea): Box {
  const pct = (n: number, of: number): string => `${(n / of) * 100}%`;
  return {
    area,
    left: pct(area.left, SCREEN_W),
    top: pct(area.top, SCREEN_H),
    width: pct(area.right - area.left + 1, SCREEN_W),
    height: pct(area.bottom - area.top + 1, SCREEN_H),
  };
}

/** every box for a plan, live ones first so a debug box draws over an overlap */
export function boxesOn(flat: string): Box[] {
  const order = { live: 0, debug: 1, dead: 2 };
  return areasOn(flat)
    .slice()
    .sort((a, b) => order[a.kind] - order[b.kind])
    .map(boxOf);
}

export interface OverlayHost {
  /** the game's canvas, whose position on the page the overlay follows */
  screen: HTMLCanvasElement;
  /** what stage is up, and which plan of it — read once a frame */
  where(): { stage: string; flat: string };
}

export interface Overlay {
  /** show or hide the whole thing */
  enabled(on: boolean): void;
  /** stop watching — for a caller that tears the page down */
  stop(): void;
  /** the container, so a page can style or place it */
  element: HTMLElement;
}

/**
 * Put the overlay on the page and keep it in step with the game.
 *
 * Driven by `requestAnimationFrame`, which is the frame source the page already
 * runs on — this reads state and writes styles, and never touches the session.
 */
export function installMapOverlay(host: OverlayHost): Overlay {
  const root = document.createElement("div");
  root.id = "devmap";
  root.setAttribute("aria-hidden", "true");
  document.body.append(root);

  let on = true;
  let drawnFor = "";
  let raf = 0;

  const build = (flat: string): void => {
    root.replaceChildren();
    for (const box of boxesOn(flat)) {
      const el = document.createElement("div");
      // `high` moves the label below the box instead of above it: a strip at
      // y 115 of 384 has room above it, one at y 3 does not, and a label clipped
      // off the top of the picture names nothing
      el.className = `devarea ${box.area.kind}${box.area.top < 14 ? " high" : ""}`;
      el.style.left = box.left;
      el.style.top = box.top;
      el.style.width = box.width;
      el.style.height = box.height;
      const tag = document.createElement("span");
      tag.textContent = box.area.to;
      el.append(tag);
      root.append(el);
    }
    drawnFor = flat;
  };

  const frame = (): void => {
    raf = requestAnimationFrame(frame);
    const { stage, flat } = host.where();
    const show = on && stage.toLowerCase() === MAP_STAGE;
    root.style.display = show ? "block" : "none";
    if (!show) return;
    if (flat !== drawnFor) build(flat);
    // where the picture is right now — it moves with a scroll or a resize
    const r = host.screen.getBoundingClientRect();
    root.style.left = `${r.left}px`;
    root.style.top = `${r.top}px`;
    root.style.width = `${r.width}px`;
    root.style.height = `${r.height}px`;
  };
  raf = requestAnimationFrame(frame);

  return {
    enabled: (v: boolean) => {
      on = v;
    },
    stop: () => cancelAnimationFrame(raf),
    element: root,
  };
}
