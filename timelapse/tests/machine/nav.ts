/**
 * Walking Timelapse by its own tables.
 *
 * Every stage's container 1 has `getframeaction (num)`, a switch from a frame
 * to six words — forward, back, left, right, back-left, back-right — and the
 * BOOTFILE's `keydown` does nothing but look the pressed way up in it and hand
 * the word to `transitionaction`. So the tables ARE the map: `J.n`, `TL.n` and
 * `TR.n` go to frame n of the stage, `G.r.n` to frame n of region r, and
 * `S.s.r.n` to stage s. (`L2`/`R2` are two turns, and a way that is `X` is one
 * the game does not offer.)
 *
 * A route names where it wants to be, and {@link goTo} finds the keys: a
 * shortest path over the tables read off the disc, pressed one key at a time as
 * a player presses it. A few tables answer by the game's state (`if gGateOpen`
 * …), so the plan takes every word a frame might answer, and a step that lands
 * somewhere the plan did not expect is struck out and the path planned again
 * from where the game really is.
 */
import { scriptToText, sniffScript } from "@dreamfactory/engine/df/script";
import * as plan from "../../src/nav";
import { type Spot } from "../../src/nav";
import { fail, type Exit, type Headless } from "./harness";

export { KEY, target, stageFile, type Spot } from "../../src/nav";

/** what reading the tables needs: the discs, not a running game */
export type Discs = Pick<Headless, "file">;

/** the stage's scripts, decompiled, the way `tools/dumpscripts.ts` writes them */
export const stageScripts = (h: Discs, world: string, stage: number): string[] => plan.stageScripts(h.file, world, stage);
export const tableOf = (h: Discs, world: string, stage: number): plan.Table => plan.tableOf(h.file, world, stage);
/** the hotspots that move you (src/nav.ts `hotspotsOf`) */
export const hotspotsOf = (h: Discs, world: string, stage: number): Map<number, plan.Hotspot[]> => plan.hotspotsOf(h.file, world, stage);

export const spot = (h: Headless): Spot => ({ stage: h.where().stage, frame: h.where().frame });

/** press one way and wait for the game to have taken it */
export async function press(h: Headless, way: Exit): Promise<void> {
  h.key(plan.KEY[way]);
  await h.settle(`${way} from ${h.here()}`);
}

/**
 * Walk to a frame (on this world), the keys found from the tables
 * (src/nav.ts `walkTo`, which the speedrun's `goto()` walks by too). Answers
 * the number of keys pressed.
 */
export async function goTo(h: Headless, want: Spot | ((s: Spot) => boolean), what = typeof want === "function" ? "the goal" : plan.spotId(want)): Promise<number> {
  const goal = typeof want === "function" ? want : (s: Spot) => s.stage === want.stage && s.frame === want.frame;
  return plan.walkTo(
    {
      world: h.where().world,
      file: h.file,
      spot: async () => spot(h),
      globals: async (names) => Object.fromEntries(names.map((n) => [n, h.g(n)])),
      exits: async () => {
        const live = await h.exits();
        return plan.EXITS.map((e) => live[e]);
      },
      press: (way) => press(h, way),
      regions: async () => regions(h).map((r) => r.name),
      click: (region) => clickRegion(h, region, region.toLowerCase() === "down" ? `out of ${h.here()}` : `the hotspot ${region}`),
      moved: (from, passes) => h.wait(() => plan.spotId(spot(h)) !== plan.spotId(from), passes),
      log: (line) => process.env.NAV && console.log(`  ${line}`),
      fail: (why) => fail(why.replace(/ from \d+:\d+ /, ` from ${h.here()} `)),
    },
    goal,
    what,
  );
}

/** the current flat's clickable regions, by name */
export function regions(h: Headless): { name: string; x: number; y: number; box: [number, number, number, number] }[] {
  return h.session.stageCtrl.currentFlatRegions().map((r) => ({
    name: r.name,
    x: Math.round((r.left + r.right) / 2),
    y: Math.round((r.top + r.bottom) / 2),
    box: [r.left, r.top, r.right, r.bottom],
  }));
}

/** click the middle of a named region of the flat on screen, and settle */
export async function clickRegion(h: Headless, name: string, what = name): Promise<void> {
  const at = regionPoint(h, name);
  h.click(at.x, at.y);
  await h.settle(what);
}

/**
 * A point the hit test gives to this region: regions overlap (the console's
 * buttons sit inside its `down`), and the first of them in the flat's list
 * wins, so the middle of the box is not always the region's.
 */
export function regionPoint(h: Headless, name: string): { x: number; y: number } {
  const r = regions(h).find((r) => r.name.toLowerCase() === name.toLowerCase());
  if (!r) fail(`no region "${name}" on ${h.here()}: ${regions(h).map((r) => r.name).join(", ") || "(none)"}`);
  const hits = (x: number, y: number): boolean => {
    const t = h.session.hitTestAt(x, y);
    return t.type === "button" && t.name.toLowerCase() === name.toLowerCase();
  };
  if (hits(r.x, r.y)) return { x: r.x, y: r.y };
  const [x0, y0, x1, y1] = r.box;
  let best: { x: number; y: number } | null = null, d = Infinity;
  for (let y = y0; y < y1; y += 2)
    for (let x = x0; x < x1; x += 2) {
      const dd = (x - r.x) ** 2 + (y - r.y) ** 2;
      if (dd < d && hits(x, y)) ((d = dd), (best = { x, y }));
    }
  return best ?? fail(`region "${name}" on ${h.here()} is under others everywhere`);
}

/**
 * Keys as a walkthrough writes them: `F` forward, `B` back, `L` left, `R`
 * right, each with a count (`R F2 R F`). For finding a route; a suite names
 * the frame it wants and lets {@link goTo} find the keys.
 */
export async function walk(h: Headless, keys: string): Promise<void> {
  const ways: Record<string, Exit> = { F: "forward", B: "back", L: "left", R: "right" };
  for (const k of keys.trim().split(/\s+/)) {
    const way = ways[k[0].toUpperCase()];
    if (!way) fail(`no way "${k}" in "${keys}"`);
    for (let i = 0; i < Number(k.slice(1) || 1); i++) await press(h, way);
  }
}

/**
 * Where a prop can be hit: its drawn box (`screenRect`), and in it the points
 * the hit test gives to it (a prop drawn over it, or one of its transparent
 * pixels, is not it). Searching the box and not the screen is what keeps a
 * route fast — a whole-screen scan of the hit test is most of a suite's time.
 */
function propHits(h: Headless, name: string, step: number, box?: [number, number, number, number]): [number, number][] {
  const p = h.session.propRuntime.get(name);
  if (!p?.visible || p.hidden) return [];
  const r = p.screenRect();
  if (!r) return [];
  const { width: W, height: H } = h.host.director.screen;
  let [x0, y0, x1, y1] = [Math.max(0, r.x), Math.max(0, r.y), Math.min(W, r.x + r.w), Math.min(H, r.y + r.h)];
  if (box) [x0, y0, x1, y1] = [Math.max(x0, box[0]), Math.max(y0, box[1]), Math.min(x1, box[2]), Math.min(y1, box[3])];
  const want = name.toLowerCase();
  const out: [number, number][] = [];
  for (let y = y0 + (step >> 1); y < y1; y += step)
    for (let x = x0 + (step >> 1); x < x1; x += step) {
      const hit = h.session.hitTestAt(x, y);
      if (hit.type === "prop" && hit.name.toLowerCase() === want) out.push([x, y]);
    }
  return out;
}

/** where a prop is drawn: the point of it nearest its middle, or null */
export function findProp(h: Headless, name: string, step = 4): { x: number; y: number } | null {
  const hits = propHits(h, name, step);
  if (!hits.length) return null;
  const cx = hits.reduce((a, [x]) => a + x, 0) / hits.length, cy = hits.reduce((a, [, y]) => a + y, 0) / hits.length;
  let best = hits[0], d = Infinity;
  for (const [x, y] of hits) if ((x - cx) ** 2 + (y - cy) ** 2 < d) ((d = (x - cx) ** 2 + (y - cy) ** 2), (best = [x, y]));
  return { x: best[0], y: best[1] };
}

/** the props on screen now (their names, for a probe's report) */
export function propsOnScreen(h: Headless): string[] {
  return [...h.session.propRuntime.props.values()].filter((p) => p.visible && !p.hidden && p.screenRect()).map((p) => p.name);
}

export async function clickProp(h: Headless, name: string, what = name): Promise<void> {
  const at = findProp(h, name);
  if (!at) fail(`no prop "${name}" on ${h.here()}: ${propsOnScreen(h).join(", ") || "(none)"}`);
  h.click(at.x, at.y);
  await h.settle(what);
}

/**
 * A drag as a hand makes one: pressed at `from`, moved there in `steps` passes,
 * let go at `to`. The scripts poll `stilldown ()` and `mouseloc ()` a pass at a time.
 */
export async function drag(h: Headless, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12, what = "a drag", settle = true): Promise<void> {
  // a press while a loop runs is queued and replayed later, by when the hand
  // has let go: a player's drag starts between the loop's ticks
  await h.until(() => !h.host.director.inputLocked, `a moment to start ${what}`, 600);
  h.mouseDown(from.x, from.y);
  await h.frame(2);
  for (let i = 1; i <= steps; i++) {
    h.moveTo(Math.round(from.x + ((to.x - from.x) * i) / steps), Math.round(from.y + ((to.y - from.y) * i) / steps));
    await h.frame(1);
  }
  await h.frame(2);
  h.mouseUp(to.x, to.y);
  if (settle) await h.settle(what);
}

/** a prop's box on screen, [left, top, right, bottom], of the points the hit test gives it */
export function extent(h: Headless, name: string, step = 2): [number, number, number, number] {
  const hits = propHits(h, name, step);
  if (!hits.length) fail(`no prop "${name}" on ${h.here()}: ${propsOnScreen(h).join(", ") || "(none)"}`);
  const xs = hits.map(([x]) => x), ys = hits.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * The scripts behind what is on screen: the flat's own, and each region's —
 * decompiled, for reading a puzzle while writing its route (`SRC=1`).
 */
export function flatSource(h: Headless, flat = h.session.currentFlat): { flat: string; regions: Record<string, string> } {
  type Stg = { file: { containers: { data: Uint8Array }[] }; flats: { name: string; locationScript: number }[] };
  const stg = (h.session.stageCtrl as unknown as { stageFile: Stg | null }).stageFile;
  const text = (i: number | undefined): string => {
    const tokens = i === undefined ? null : sniffScript(stg!.file.containers[i]?.data ?? new Uint8Array());
    return tokens ? scriptToText(tokens) : "";
  };
  if (!stg) return { flat: "", regions: {} };
  const base = flat.toLowerCase();
  const f = stg.flats.find((f) => f.name.toLowerCase() === base);
  const regions: Record<string, string> = {};
  for (const r of h.session.stageCtrl.currentFlatRegions()) regions[r.name] = text(r.script);
  return { flat: text(f?.locationScript), regions };
}

/**
 * A point of a prop inside a box, waiting for it to come there (a swinging
 * basket): what a player's hand finds by looking.
 */
export async function propPoint(h: Headless, name: string, box: [number, number, number, number] = [0, 0, 640, 480], max = 3000): Promise<{ x: number; y: number }> {
  let at: [number, number] | undefined;
  await h.until(() => !!(at = propHits(h, name, 3, box)[0]), `${name} in reach`, max);
  return { x: at![0], y: at![1] };
}

/** a shop prop's script, decompiled (the prop's own group, in whichever shop is open) */
export function propSource(h: Headless, name: string): string {
  const p = h.session.propRuntime.get(name);
  if (!p) return "";
  const data = p.shop.shp.file.containers[p.group.scriptContainerLocation]?.data;
  const tokens = data ? sniffScript(data) : null;
  return tokens ? scriptToText(tokens) : "";
}

/**
 * Where a carried thing may be let go, read off its own mousedown: each `if
 * curframenum = N` and, inside it, the box (`dx > a & dx < b & dy > c & dy <
 * d`), the region (`pointinbutton (currentflat (), "name", …)`), or nothing
 * (anywhere on that frame).
 */
export function dropSpots(h: Headless, name: string): plan.DropSpot[] {
  return plan.dropSpotsIn(propSource(h, name));
}

/** carry the thing in hand to where it goes (its `dropSpots`) and let it go there */
export async function useOn(h: Headless, name: string, stage: number, settle = true): Promise<void> {
  const spots = dropSpots(h, name);
  if (!spots.length) fail(`${name} has nowhere to be let go (its script names no frame)`);
  await goTo(h, (s) => s.stage === stage && spots.some((sp) => sp.frame === s.frame));
  const spot = spots.find((sp) => sp.frame === h.where().frame)!;
  const to = spot.region ? regionPoint(h, spot.region) : spot.box
    ? { x: Math.round((spot.box[0] + spot.box[2]) / 2), y: Math.round((spot.box[1] + spot.box[3]) / 2) }
    : { x: 320, y: 240 };
  const grab = findProp(h, name) ?? fail(`no ${name} to take hold of (${h.here()})`);
  await drag(h, grab, to, 14, `${name} to frame ${spot.frame}`, settle);
}
