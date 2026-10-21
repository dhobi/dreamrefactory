/**
 * What Timelapse's verbs share: the questions they ask the page (as page-side
 * expressions over `window.dbg`, which both drivers evaluate), and the
 * gestures built from the driver's own — a click let settle, a held drag one
 * script turn a point, a click on a thing once it is in reach.
 *
 * Nothing here writes to the game: every gesture is a press, a move or a
 * release through `c.d`, and every question is a read.
 */
import { QUIET } from "@dreamfactory/speedrun/driver";
import type { ActionContext } from "@dreamfactory/speedrun/action";
import type { Spot } from "../nav";

export type Point = { x: number; y: number };

/* ------------------------------------------------------------------ *
 * Questions, as page-side expressions
 * ------------------------------------------------------------------ */

/** a BOOTFILE global, as the scripts see it */
export const global = (name: string): string =>
  `String(window.dbg.session.interp.globals.get(${JSON.stringify(name.toLowerCase())}) ?? "")`;

/** world, stage and frame — the three globals the page's readout shows */
export const WHERE = `({ world: ${global("curworldchar")}, stage: Number(${global("curstagenum")}), frame: Number(${global("curframenum")}) })`;

/** you stand somewhere other than `s` */
export const OFF = (s: Spot): string =>
  `(Number(${global("curstagenum")}) !== ${s.stage} || Number(${global("curframenum")}) !== ${s.frame})`;

/** the flat's regions by name */
export const REGIONS = `window.dbg.session.stageCtrl.currentFlatRegions().map((r) => r.name)`;

/**
 * A point the hit test gives to this region, nearest the middle of its box:
 * regions overlap (the console's buttons sit inside its `down`), and the first
 * of them in the flat's list wins. The machine suites' `regionPoint`.
 */
export const REGION_POINT = (name: string): string => `((want) => {
  const s = window.dbg.session;
  const r = s.stageCtrl.currentFlatRegions().find((r) => r.name.toLowerCase() === want);
  if (!r) return null;
  const hits = (x, y) => { const t = s.hitTestAt(x, y); return t.type === "button" && t.name.toLowerCase() === want; };
  const cx = Math.round((r.left + r.right) / 2), cy = Math.round((r.top + r.bottom) / 2);
  if (hits(cx, cy)) return { x: cx, y: cy };
  let best = null, d = Infinity;
  for (let y = r.top; y < r.bottom; y += 2)
    for (let x = r.left; x < r.right; x += 2) {
      const dd = (x - cx) ** 2 + (y - cy) ** 2;
      if (dd < d && hits(x, y)) { d = dd; best = { x, y }; }
    }
  return best;
})(${JSON.stringify(name.toLowerCase())})`;

/**
 * The points of a prop the hit test gives to it, on a grid over its drawn box
 * (a prop drawn over it, or a transparent pixel of it, is not it) — the
 * machine suites' `propHits`.
 */
export const PROP_HITS = (name: string, step: number, box: Box = [0, 0, 640, 480]): string => `((want, step, box) => {
  const h = window.dbg.host, s = h.session;
  const p = s.propRuntime.get(want);
  if (!p || !p.visible || p.hidden) return [];
  const r = p.screenRect();
  if (!r) return [];
  const W = h.director.screen.width, H = h.director.screen.height;
  const x0 = Math.max(0, r.x, box[0]), y0 = Math.max(0, r.y, box[1]);
  const x1 = Math.min(W, r.x + r.w, box[2]), y1 = Math.min(H, r.y + r.h, box[3]);
  const out = [];
  for (let y = y0 + (step >> 1); y < y1; y += step)
    for (let x = x0 + (step >> 1); x < x1; x += step) {
      const hit = s.hitTestAt(x, y);
      if (hit.type === "prop" && hit.name.toLowerCase() === want.toLowerCase()) out.push([x, y]);
    }
  return out;
})(${JSON.stringify(name)}, ${step}, ${JSON.stringify(box)})`;

/** a screen box, [left, top, right, bottom] */
export type Box = [number, number, number, number];

/** a box as a sheet writes one: `box: 0 290 640 480` */
export function boxOf(text: string): Box {
  const n = text.trim().split(/[\s,]+/).map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) throw new Error(`a box is four numbers, x0 y0 x1 y1 — not "${text}"`);
  return n as Box;
}

/** a prop's `propdeg` — the picture a dial or a selector shows */
export const DEG = (name: string): string => `Number(window.dbg.session.propRuntime.get(${JSON.stringify(name)})?.deg ?? NaN)`;

/** the flat on screen, lowercased */
export const FLAT = `String(window.dbg.session.currentFlat || "").toLowerCase()`;

/**
 * Hold until `expr` (a page-side expression answering a point or null) has a
 * point, and answer it: what a hand does that waits for a swinging basket or a
 * snake to come under it. The point is the one the hold closed on, kept on
 * `window` (a fresh `dbg` is built at every read).
 */
export async function pointWhen(c: ActionContext, expr: string, what: string, budget = c.budget): Promise<Point> {
  await c.d.hold(`((p) => (window.__tlPoint = p) !== null)(${expr})`, what, budget);
  return c.d.evaluate<Point>(`window.__tlPoint`);
}

/** the first point of a prop inside a box, once there is one — the machine suites' `propPoint` */
export const propIn = (c: ActionContext, name: string, box?: Box, step = 3, budget = c.budget): Promise<Point> =>
  pointWhen(c, `((h) => h.length ? { x: h[0][0], y: h[0][1] } : null)(${PROP_HITS(name, step, box)})`, `${name} in reach`, budget);

/** a region's point ({@link REGION_POINT}), once the flat has it */
export const regionWhen = (c: ActionContext, name: string, budget = c.budget): Promise<Point> =>
  pointWhen(c, REGION_POINT(name), `the region ${name}`, budget);

/** a prop's middle, of its hit points ({@link extent}) */
export async function middle(c: ActionContext, name: string): Promise<Point> {
  const [x0, y0, x1, y1] = await extent(c, name);
  return { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) };
}

/** a global's value now */
export const g = (c: ActionContext, name: string): Promise<string> => c.d.evaluate<string>(global(name));

/** a global, as a number */
export const gNum = async (c: ActionContext, name: string): Promise<number> => Number(await g(c, name));

/** a boolean global reads "true"/"false" and a number one "1"/"0": the same to a check */
export const truthy = (v: string): boolean => v === "true" || v === "1";

/** fail the line unless a global holds `want` (`need` in the machine suites) */
export async function need(c: ActionContext, name: string, want: string, what: string): Promise<void> {
  const v = await g(c, name);
  const norm = (x: string): string => {
    if (x === "true") return "1";
    if (x === "false") return "0";
    return x;
  };
  if (norm(v) !== norm(want)) throw new Error(`${what}: ${name} is ${v || "unset"}, not ${want} (${await here(c)})`);
}

/** the props drawn now, for an error that says what there was instead */
export const PROPS_ON_SCREEN = `[...window.dbg.session.propRuntime.props.values()].filter((p) => p.visible && !p.hidden && p.screenRect()).map((p) => p.name)`;

/**
 * The player has the game: {@link QUIET}, or a conversation parked on its
 * choices — the professor at the time machine's console is one, and his film
 * plays on under it until a button is pressed. The machine harness's `settle`.
 */
export const SETTLED = `(${QUIET}) || window.dbg.host.director.awaitingChoice`;

/** the wait half of a gesture: `quiet` as the harness means it ({@link SETTLED}), else the driver's */
export async function settle(c: ActionContext, what: string, wait = c.wait): Promise<void> {
  if (wait === "quiet") await c.d.hold(SETTLED, `${what} to settle`, c.budget);
  else await c.d.settle(wait, what, c.budget);
}

/** click a point and wait as {@link settle} does */
export async function clickThen(c: ActionContext, at: Point, what: string, wait = c.wait): Promise<void> {
  await c.d.clickAt(at.x, at.y, "none", c.budget);
  await settle(c, what, wait);
}

/** a press made now is acted on now (the machine harness's `drag` waits for the same) */
export const UNLOCKED = `!window.dbg.host.director.inputLocked`;

export async function here(c: ActionContext): Promise<string> {
  const w = await c.d.evaluate<{ world: string; stage: number; frame: number }>(WHERE);
  return `${w.world} stage ${w.stage} frame ${w.frame}`;
}

export async function regionPoint(c: ActionContext, name: string): Promise<Point> {
  const at = await c.d.evaluate<Point | null>(REGION_POINT(name));
  if (at) return at;
  const names = await c.d.evaluate<string[]>(REGIONS);
  throw new Error(`no region "${name}" to click on ${await here(c)}: ${names.join(", ") || "(none)"}`);
}

export async function propHits(c: ActionContext, name: string, step: number, box?: Box): Promise<[number, number][]> {
  const hits = await c.d.evaluate<[number, number][]>(PROP_HITS(name, step, box));
  if (hits.length) return hits;
  const props = await c.d.evaluate<string[]>(PROPS_ON_SCREEN);
  throw new Error(`no prop "${name}" on ${await here(c)}: ${props.join(", ") || "(none)"}`);
}

/** where a prop is drawn: the point of it nearest its middle (the machine suites' `findProp`) */
export async function propPoint(c: ActionContext, name: string): Promise<Point> {
  const hits = await propHits(c, name, 4);
  const cx = hits.reduce((a, [x]) => a + x, 0) / hits.length;
  const cy = hits.reduce((a, [, y]) => a + y, 0) / hits.length;
  let best = hits[0], d = Infinity;
  for (const [x, y] of hits) if ((x - cx) ** 2 + (y - cy) ** 2 < d) ((d = (x - cx) ** 2 + (y - cy) ** 2), (best = [x, y]));
  return { x: best[0], y: best[1] };
}

/** a prop's box on screen, [left, top, right, bottom], of the points the hit test gives it */
export async function extent(c: ActionContext, name: string): Promise<[number, number, number, number]> {
  const hits = await propHits(c, name, 2);
  const xs = hits.map(([x]) => x), ys = hits.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * A held drag along `path`, one turn of the holding script's `while stilldown
 * ()` loop per point (the driver's `dragProp`), released at the last — and,
 * with `until`, held there until that holds first.
 */
export async function heldPath(c: ActionContext, from: Point, path: Point[], until?: { expr: string; what: string }): Promise<void> {
  let i = 0;
  await c.d.dragProp(
    from,
    async () => {
      if (i < path.length) return path[i++];
      if (until && i++ === path.length) await c.d.hold(until.expr, until.what, c.budget);
      return null;
    },
    c.budget,
  );
}

/** the points of a straight line from `a` to `b`, in `steps` moves */
export const line = (a: Point, b: Point, steps: number): Point[] =>
  Array.from({ length: steps }, (_, i) => ({
    x: Math.round(a.x + ((b.x - a.x) * (i + 1)) / steps),
    y: Math.round(a.y + ((b.y - a.y) * (i + 1)) / steps),
  }));

/** carry what is pressed at `from` to `to` and let it go, as a hand does */
export async function carry(c: ActionContext, from: Point, to: Point, steps: number, what: string): Promise<void> {
  // a press while a loop runs is queued and replayed later, by when the hand
  // has let go: a player's drag starts between the loop's ticks
  await c.d.hold(UNLOCKED, `a moment to start ${what}`, c.budget);
  await heldPath(c, from, line(from, to, steps));
  await settle(c, what);
}

export const num = (c: ActionContext, i: number, what: string): number => {
  const n = Number(c.step.args[i]);
  if (!Number.isFinite(n)) throw new Error(`${c.step.verb} wants a number for ${what}, not "${c.step.args[i] ?? ""}"`);
  return n;
};


/**
 * A press held for one turn of the `while stilldown ()` loop it starts, and let
 * go: a click as a script that polls the button sees one. The driver's
 * `clickAt` lets go before the game has run a pass (a sheet's clock runs the
 * game only inside a hold), which a mousedown that decides inside its loop
 * (the Egyptian basket's `doit`) never notices. Only for such a mousedown: one
 * that does not poll gives the turn nothing to count.
 */
export const tap = (c: ActionContext, at: Point): Promise<void> => c.d.dragProp(at, () => null, c.budget);

/**
 * The middle of a region of the flat on screen, or of its base flat's (a
 * close-up drawn as a flat of its own, `a0001.632.4`, keeps its regions on
 * `a0001.632`) — where a carried thing is aimed, not clicked, so the hit test
 * is not asked.
 */
export const REGION_MID = (name: string): string => `((want) => {
  const s = window.dbg.session, flat = String(s.currentFlat || "");
  const base = flat.split(".").slice(0, 2).join(".");
  const r = s.stageCtrl.currentFlatRegions().find((r) => r.name.toLowerCase() === want.toLowerCase()) ?? s.stageCtrl.flatRegion(base, want);
  return r ? { x: Math.round((r.left + r.right) / 2), y: Math.round((r.top + r.bottom) / 2) } : null;
})(${JSON.stringify(name)})`;

export async function regionMid(c: ActionContext, name: string): Promise<Point> {
  const at = await c.d.evaluate<Point | null>(REGION_MID(name));
  if (!at) throw new Error(`no region ${name} on ${await here(c)}`);
  return at;
}

/** a prop's anchor (`propxy`) */
export const anchor = (c: ActionContext, name: string): Promise<Point> =>
  c.d.evaluate<Point>(`((p) => ({ x: p ? p.anchorX : 0, y: p ? p.anchorY : 0 }))(window.dbg.session.propRuntime.get(${JSON.stringify(name)}))`);

/**
 * A carried thing taken where it is drawn and moved so that a point of it,
 * `tip` up and left of its own place, passes through each of `points` — ten
 * moves to each, held three turns there (the machine suites' `tipDrag`): the
 * honey stick into the hive, the drum stick onto a drum.
 */
export async function tipPath(c: ActionContext, prop: string, tip: [number, number], points: Point[], what: string): Promise<void> {
  const grab = await propPoint(c, prop);
  const a = await anchor(c, prop);
  const hand = (p: Point): Point => ({ x: p.x + tip[0] + grab.x - a.x, y: p.y + tip[1] + grab.y - a.y });
  const path: Point[] = [];
  let at = grab;
  for (const p of points) {
    const to = hand(p);
    path.push(...line(at, to, 10), to, to, to);
    at = to;
  }
  await c.d.hold(UNLOCKED, `a moment to start ${what}`, c.budget);
  await heldPath(c, grab, path);
  await settle(c, what);
}

/** the hand moved with no button down, which a driver has to be able to do */
export async function hover(c: ActionContext, at: Point): Promise<void> {
  if (!c.d.hover) throw new Error("this driver cannot move the hand without pressing");
  await c.d.hover(at.x, at.y);
}
