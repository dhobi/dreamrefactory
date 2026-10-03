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
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { scriptToText, sniffScript } from "@dreamfactory/engine/df/script";
import { readStgFile, readStgRegions } from "@dreamfactory/engine/df/stg";
import { EXITS, fail, type Exit, type Headless } from "./harness";

/** the key the page sends for each way */
export const KEY: Record<Exit, string> = {
  forward: "uparrow", back: "downarrow", left: "leftarrow", right: "rightarrow", backleft: "z", backright: "c",
};

export interface Spot {
  stage: number;
  frame: number;
}
const id = (s: Spot): string => `${s.stage}:${s.frame}`;

/** what reading the tables needs: the discs, not a running game */
export type Discs = Pick<Headless, "file">;

/** a stage's file, as `gotostage` builds the name */
export const stageFile = (world: string, stage: number): string => `${world.toLowerCase()}${String(stage).padStart(3, "0")}.stg`;

/** frame → every six-word answer its `getframeaction` can give */
type Table = Map<number, string[][]>;
const tables = new Map<string, Table>();

/** the stage's scripts, decompiled, the way `tools/dumpscripts.ts` writes them */
export function stageScripts(h: Discs, world: string, stage: number): string[] {
  const bytes = h.file(stageFile(world, stage));
  if (!bytes) return [];
  const out: string[] = [];
  for (const c of readContainerFile(bytes).containers) {
    const tokens = sniffScript(c.data);
    if (tokens?.some((t) => t.kind === "op")) out.push(scriptToText(tokens));
  }
  return out;
}

export function tableOf(h: Discs, world: string, stage: number): Table {
  const key = stageFile(world, stage);
  let t = tables.get(key);
  if (t) return t;
  t = new Map();
  tables.set(key, t);
  for (const text of stageScripts(h, world, stage)) {
    const at = text.indexOf("code getframeaction");
    if (at < 0) continue;
    const body = text.slice(at, text.indexOf("endcode", at));
    let frames: number[] = [];
    let open = false;
    for (const line of body.split("\n")) {
      const c = /^\s*case\s+(.+?)\s*$/.exec(line);
      if (c) {
        if (!open) frames = [];
        frames.push(...c[1].split(/\s*,\s*/).map(Number).filter((n) => !Number.isNaN(n)));
        open = true;
        continue;
      }
      // a word may be built at run time (`"TR." @ numtostring (count)`): the
      // literal parts are kept and what is computed becomes "?", a way the
      // plan cannot use until the game has answered it
      const r = /return\s*\((.*)\)\s*$/.exec(line);
      const literals = r ? [...r[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]) : [];
      if (literals.length) {
        const words = literals.join("?").trim().split(/\s+/);
        for (const f of frames) t.get(f)?.push(words) ?? t.set(f, [words]);
      }
      if (/\S/.test(line)) open = false;
    }
    break;
  }
  return t;
}

/**
 * The hotspots that move you: a flat's region whose script jumps somewhere
 * itself (`jumptoframe`, `gotoregion`, `gotostage`, `sendtopost (gotostage …)`),
 * as frame 51's stone face does on Easter Island and the Lizard temple's
 * hyperlink into stage 44 does. By the base flat's frame: `m0011.268` is
 * frame 268.
 */
type Hotspot = { region: string; to: Spot };
const hotspots = new Map<string, Map<number, Hotspot[]>>();
export function hotspotsOf(h: Discs, world: string, stage: number): Map<number, Hotspot[]> {
  const key = stageFile(world, stage);
  let out = hotspots.get(key);
  if (out) return out;
  out = new Map();
  hotspots.set(key, out);
  const bytes = h.file(key);
  if (!bytes) return out;
  const stg = readStgFile(bytes);
  for (const f of stg.flats) {
    const m = /^\w\d{4}\.(\d+)$/.exec(f.name);
    if (!m) continue;
    const frame = Number(m[1]);
    const data = stg.file.containers[f.locationClickLogic]?.data;
    for (const r of data ? readStgRegions(data, stg.version) : []) {
      const tokens = sniffScript(stg.file.containers[r.script]?.data ?? new Uint8Array());
      if (!tokens) continue;
      const text = scriptToText(tokens);
      const md = text.slice(text.indexOf("code mousedown"), text.indexOf("endcode", text.indexOf("code mousedown")));
      if (!md.startsWith("code mousedown")) continue;
      let to: Spot | null = null;
      const g = /gotostage \((\d+), (\d+), (\d+)\)/.exec(md);
      const j = /jumptoframe \((\d+)\)/.exec(md);
      const gr = /gotoregion \((\d+), (\d+)\)/.exec(md);
      if (g) to = { stage: Number(g[1]), frame: Number(g[3]) };
      else if (gr) to = { stage, frame: Number(gr[2]) };
      else if (j) to = { stage, frame: Number(j[1]) };
      if (to) (out.get(frame) ?? out.set(frame, []).get(frame)!).push({ region: r.name, to });
    }
  }
  return out;
}

/** where one word goes from `from`, or null for none the plan can use */
export function target(from: Spot, word: string): Spot | null {
  const [verb, ...n] = word.split(".").map((w, i) => (i ? Number(w) : w)) as [string, ...number[]];
  // upper-cased as `transitionaction`'s switch compares, caselessly: e002's
  // "s.1.1.137" and m010's "j.252" are exits the game takes
  switch (verb.toUpperCase()) {
    case "J":
    case "TL":
    case "TR":
      return { stage: from.stage, frame: n[0] };
    case "G":
      return { stage: from.stage, frame: n[1] };
    case "S":
      return { stage: n[0], frame: n[2] };
  }
  return null;
}

interface Step {
  /** a key, or a hotspot's region to click */
  way: Exit | { region: string };
  to: Spot;
}

/** the shortest press-by-press path, over the tables, avoiding `struck` */
function plan(h: Headless, world: string, from: Spot, seen: Map<string, string[]>, goal: (s: Spot) => boolean, struck: Set<string>): Step[] | null {
  const prev = new Map<string, { at: Spot; step: Step } | null>([[id(from), null]]);
  const queue: Spot[] = [from];
  while (queue.length) {
    const at = queue.shift()!;
    if (goal(at)) {
      const path: Step[] = [];
      for (let p = prev.get(id(at)); p; p = prev.get(id(p.at))) path.unshift(p.step);
      return path;
    }
    // what the game answered here, once it has; else whatever the table might
    const known = seen.get(id(at));
    const answers = known ? [known] : (tableOf(h, world, at.stage).get(at.frame) ?? []);
    for (const words of answers) {
      EXITS.forEach((way, i) => {
        const to = target(at, words[i] ?? "X");
        if (!to || prev.has(id(to)) || struck.has(`${id(at)}>${way}`)) return;
        prev.set(id(to), { at, step: { way, to } });
        queue.push(to);
      });
    }
    for (const hs of hotspotsOf(h, world, at.stage).get(at.frame) ?? []) {
      if (prev.has(id(hs.to)) || struck.has(`${id(at)}>${hs.region}`)) continue;
      prev.set(id(hs.to), { at, step: { way: { region: hs.region }, to: hs.to } });
      queue.push(hs.to);
    }
  }
  return null;
}

export const spot = (h: Headless): Spot => ({ stage: h.where().stage, frame: h.where().frame });

/** press one way and wait for the game to have taken it */
export async function press(h: Headless, way: Exit): Promise<void> {
  h.key(KEY[way]);
  await h.settle(`${way} from ${h.here()}`);
}

/**
 * Walk to a frame (on this world), the keys found from the tables. Answers the
 * number of keys pressed.
 */
export async function goTo(h: Headless, want: Spot | ((s: Spot) => boolean), what = typeof want === "function" ? "the goal" : id(want)): Promise<number> {
  const goal = typeof want === "function" ? want : (s: Spot) => s.stage === want.stage && s.frame === want.frame;
  const struck = new Set<string>();
  const seen = new Map<string, string[]>();
  const visited = new Set<string>();
  const world = h.where().world;
  let presses = 0;
  for (let guard = 0; guard < 2000; guard++) {
    const at = spot(h);
    if (goal(at)) return presses;
    const live = await h.exits();
    seen.set(id(at), EXITS.map((e) => live[e]));
    visited.add(id(at));
    let path = plan(h, world, at, seen, goal, struck);
    // no way that the tables name: the nearest frame whose way is computed
    // (`"TR." @ numtostring (count)`) and not yet asked is where to look next
    if (!path?.length) {
      const unknown = (s: Spot): boolean =>
        !seen.has(id(s)) && (tableOf(h, world, s.stage).get(s.frame) ?? []).some((w) => w.some((x) => x.includes("?")));
      path = plan(h, world, at, seen, unknown, struck);
    }
    // still none: a step to a frame not yet stood on — some frames have no
    // table at all and move you on themselves (Atlantis's frame 200, whose
    // flat script turns you to 199)
    if (!path?.length) {
      const way = EXITS.find((e) => {
        const to = target(at, live[e] ?? "X");
        return to && !visited.has(id(to)) && !struck.has(`${id(at)}>${e}`);
      });
      if (way) path = [{ way, to: target(at, live[way])! }];
    }
    if (!path?.length) {
      // a close-up the tables give no way out of: its `down` region is the way
      // back, as the arrow a player sees at the bottom of it says
      const down = regions(h).find((r) => r.name.toLowerCase() === "down");
      if (down && !struck.has(`${id(at)}>down`)) {
        struck.add(`${id(at)}>down`);
        await clickRegion(h, "down", `out of ${h.here()}`);
        presses++;
        continue;
      }
      // …or the frame moves you on by itself, once its animation is done
      if (await h.wait(() => id(spot(h)) !== id(at), 600)) continue;
      fail(`no way to ${what} from ${h.here()} (tables of ${stageFile(world, at.stage)})`);
    }
    const step = path[0];
    const way = typeof step.way === "string" ? step.way : step.way.region;
    if (typeof step.way === "string") await press(h, step.way);
    else if (regions(h).some((r) => r.name === (step.way as { region: string }).region)) await clickRegion(h, step.way.region, `the hotspot ${step.way.region}`);
    presses++;
    // a step whose own script is slow (a turn animated by `lefttoframe`, a
    // flat that carries you on) lands after the engine is idle: give it a moment
    // before taking it for a way the game refused
    if (id(spot(h)) === id(at)) await h.wait(() => id(spot(h)) !== id(at), 120);
    const now = spot(h);
    if (id(now) !== id(step.to)) {
      if (process.env.NAV) console.log(`  nav: ${id(at)} ${way} landed ${id(now)}, not ${id(step.to)}`);
      struck.add(`${id(at)}>${way}`);
    }
  }
  return fail(`walked 2000 keys and never reached ${what}`);
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
export function dropSpots(h: Headless, name: string): { frame: number; box?: [number, number, number, number]; region?: string }[] {
  const src = propSource(h, name);
  const md = src.slice(src.indexOf("code mousedown"), src.indexOf("endcode", src.indexOf("code mousedown")));
  const out: { frame: number; box?: [number, number, number, number]; region?: string }[] = [];
  const parts = md.split(/curframenum = /).slice(1);
  for (const part of parts) {
    const frame = Number(/^(\d+)/.exec(part)?.[1]);
    const body = part.split(/\n\s*else\b/)[0];
    const b = /dx > (\d+) & dx < (\d+) & dy > (\d+) & dy < (\d+)/.exec(body);
    const r = /pointinbutton \([^,]+, "([^"]+)"/.exec(body);
    out.push({ frame, box: b ? [Number(b[1]), Number(b[3]), Number(b[2]), Number(b[4])] : undefined, region: r?.[1] });
  }
  return out;
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
