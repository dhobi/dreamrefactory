/**
 * Walking Timelapse by its own tables — the planner, with no game attached.
 *
 * Every stage's container 1 has `getframeaction (num)`, a switch from a frame
 * to six words — forward, back, left, right, back-left, back-right — and the
 * BOOTFILE's `keydown` does nothing but look the pressed way up in it and hand
 * the word to `transitionaction`. So the tables ARE the map: `J.n`, `TL.n` and
 * `TR.n` go to frame n of the stage, `G.r.n` to frame n of region r, and
 * `S.s.r.n` to stage s. (`L2`/`R2` are two turns, and a way that is `X` is one
 * the game does not offer.)
 *
 * Two walkers share it, and that is why it is here and not in a test: the
 * machine suites' `goTo` (tests/machine/nav.ts), which steps a headless game
 * pass by pass, and the speedrun's `goto()` verb (src/speedrun/actions.ts),
 * which drives a page through the speedrun driver. Each hands {@link walkTo} a
 * {@link Walker} — how to read where you stand, press a way, click a region —
 * and the walk itself (plan, press, strike what the game refused, plan again)
 * is this file's, once.
 *
 * Everything here reads the DISCS, never the running game: a stage file is
 * asked for by name through a {@link FileOf}, which answers null for one it has
 * not got yet (a page fetches them as it goes; see {@link Walker.fetch}).
 */
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { scriptToText, sniffScript } from "@dreamfactory/engine/df/script";
import { readStgFile, readStgRegions } from "@dreamfactory/engine/df/stg";

/** the six directions a stage's table has a word for, in its order */
export const EXITS = ["forward", "back", "left", "right", "backleft", "backright"] as const;
export type Exit = (typeof EXITS)[number];

/** the key the ENGINE is handed for each way (the BOOTFILE's `keydown` names) */
export const KEY: Record<Exit, string> = {
  forward: "uparrow", back: "downarrow", left: "leftarrow", right: "rightarrow", backleft: "z", backright: "c",
};

/** the key a PAGE presses for each way — what src/input.ts `keyAction` turns into {@link KEY} */
export const PAGE_KEY: Record<Exit, string> = {
  forward: "ArrowUp", back: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", backleft: "z", backright: "c",
};

export interface Spot {
  stage: number;
  frame: number;
}
export const spotId = (s: Spot): string => `${s.stage}:${s.frame}`;

/** a disc file by the name the game asks for, or null */
export type FileOf = (name: string) => Uint8Array | null;

/** a stage's file, as `gotostage` builds the name */
export const stageFile = (world: string, stage: number): string => `${world.toLowerCase()}${String(stage).padStart(3, "0")}.stg`;

/**
 * The value list of a `case` line (`case 120` → "120", `case 5, 6` → "5, 6"),
 * or null for a line that is not one. Read off the trimmed line rather than
 * by one pattern over it, which backtracks on its spaces.
 */
function caseOf(line: string): string | null {
  const t = line.trim();
  if (!/^case\s/.test(t)) return null;
  const rest = t.slice(5).trim();
  return rest === "" ? null : rest;
}

/** a word of a script's keywords at the start of `text`, and not the start of a longer word */
const startsWithWord = (text: string, words: string[]): boolean =>
  words.some((w) => text.startsWith(w) && !/\w/.test(text.charAt(w.length)));

/**
 * The global a hotspot's jump is guarded by — `if gHyper196 = 1` on the line
 * before its `gotostage`, `jumptoframe` or `gotoregion` (blank lines between
 * allowed) — lowercased, or undefined. The first such pair in the script.
 */
function guardOf(md: string): string | undefined {
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /if (\w+) = 1$/.exec(lines[i].trimEnd());
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") j++;
    if (j < lines.length && startsWithWord(lines[j].trimStart(), ["gotostage", "jumptoframe", "gotoregion"])) return m[1].toLowerCase();
  }
  return undefined;
}

/** a branch's text up to the line its `else` begins on (blank lines before it dropped) */
function beforeElse(part: string): string {
  const lines = part.split("\n");
  for (let k = 1; k < lines.length; k++) {
    if (!startsWithWord(lines[k].trimStart(), ["else"])) continue;
    let end = k;
    while (end > 1 && lines[end - 1].trim() === "") end--;
    return lines.slice(0, end).join("\n");
  }
  return part;
}

/** frame → every six-word answer its `getframeaction` can give */
export type Table = Map<number, string[][]>;
const tables = new Map<string, Table>();

/** the stage's scripts, decompiled, the way `tools/dumpscripts.ts` writes them */
export function stageScripts(file: FileOf, world: string, stage: number): string[] {
  const bytes = file(stageFile(world, stage));
  if (!bytes) return [];
  const out: string[] = [];
  for (const c of readContainerFile(bytes).containers) {
    const tokens = sniffScript(c.data);
    if (tokens?.some((t) => t.kind === "op")) out.push(scriptToText(tokens));
  }
  return out;
}

/** a stage's table — empty, and not remembered, while its file is not to hand */
export function tableOf(file: FileOf, world: string, stage: number): Table {
  const key = stageFile(world, stage);
  let t = tables.get(key);
  if (t) return t;
  t = new Map();
  if (!file(key)) return t;
  tables.set(key, t);
  for (const text of stageScripts(file, world, stage)) {
    const at = text.indexOf("code getframeaction");
    if (at < 0) continue;
    const body = text.slice(at, text.indexOf("endcode", at));
    let frames: number[] = [];
    let open = false;
    // a frame's answer may switch on the game's state in turn (z008's frame
    // 120 on `elevfloor`): only the outer switch's cases are frames
    let depth = 0;
    for (const line of body.split("\n")) {
      if (/^\s*switch\b/.test(line)) depth++;
      else if (/^\s*endswitch\b/.test(line)) depth--;
      const c = depth <= 1 ? caseOf(line) : null;
      if (c !== null) {
        if (!open) frames = [];
        frames.push(...c.split(",").map((v) => Number(v.trim())).filter((n) => !Number.isNaN(n)));
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
export type Hotspot = {
  region: string;
  to: Spot;
  /**
   * The global that has to be 1 for the jump to be taken, when its script asks
   * one: a hyperlink (`Hyper196`) jumps only once you have stood where it leads
   * (`if gHyper196 = 1`), and before that it is a turn by where the hand is
   * (`HyperByMouseDown`).
   */
  when?: string;
};
/** every {@link Hotspot.when} the stages read so far ask, lowercased */
export const hotspotGlobals = new Set<string>();
const hotspots = new Map<string, Map<number, Hotspot[]>>();
export function hotspotsOf(file: FileOf, world: string, stage: number): Map<number, Hotspot[]> {
  const key = stageFile(world, stage);
  let out = hotspots.get(key);
  if (out) return out;
  out = new Map();
  const bytes = file(key);
  if (!bytes) return out;
  hotspots.set(key, out);
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
      const when = guardOf(md);
      if (when) hotspotGlobals.add(when);
      if (to) (out.get(frame) ?? out.set(frame, []).get(frame)!).push({ region: r.name, to, ...(when ? { when } : {}) });
    }
  }
  return out;
}

/** where one word goes from `from`, or null for none the plan can use */
export function target(from: Spot, word: string): Spot | null {
  const [verb, ...n] = word.split(".").map((w, i) => (i ? Number(w) : w)) as [string, ...number[]];
  // a number built at run time (`"TR." @ numtostring (count)`) is no place yet
  if (n.some((v) => Number.isNaN(v))) return null;
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

export interface Step {
  /** a key, or a hotspot's region to click */
  way: Exit | { region: string };
  to: Spot;
  /** a way whose frame is computed at run time: `to` is unknown, and any move is the step taken */
  blind?: boolean;
}

/** the shortest press-by-press path, over the tables, avoiding `struck` */
export function plan(
  file: FileOf,
  world: string,
  from: Spot,
  seen: Map<string, string[]>,
  goal: (s: Spot) => boolean,
  struck: Set<string>,
  /** a global's value now, for the hotspots that ask one ({@link Hotspot.when}); absent, every one is taken as open */
  global?: (name: string) => string,
): Step[] | null {
  const prev = new Map<string, { at: Spot; step: Step } | null>([[spotId(from), null]]);
  const queue: Spot[] = [from];
  while (queue.length) {
    const at = queue.shift()!;
    if (goal(at)) {
      const path: Step[] = [];
      for (let p = prev.get(spotId(at)); p; p = prev.get(spotId(p.at))) path.unshift(p.step);
      return path;
    }
    // what the game answered here, once it has; else whatever the table might
    const known = seen.get(spotId(at));
    const answers = known ? [known] : (tableOf(file, world, at.stage).get(at.frame) ?? []);
    for (const words of answers) {
      EXITS.forEach((way, i) => {
        const to = target(at, words[i] ?? "X");
        if (!to || prev.has(spotId(to)) || struck.has(`${spotId(at)}>${way}`)) return;
        prev.set(spotId(to), { at, step: { way, to } });
        queue.push(to);
      });
    }
    for (const hs of hotspotsOf(file, world, at.stage).get(at.frame) ?? []) {
      if (prev.has(spotId(hs.to)) || struck.has(`${spotId(at)}>${hs.region}`)) continue;
      if (hs.when && global && global(hs.when) !== "1") continue;
      prev.set(spotId(hs.to), { at, step: { way: { region: hs.region }, to: hs.to } });
      queue.push(hs.to);
    }
  }
  return null;
}

/**
 * What a walk needs of the game it walks, whoever is driving it. Every method
 * acts as a player does or reads what the screen shows; none sets anything.
 */
export interface Walker {
  /** the world letter the walk is on (stage numbers are per world) */
  world: string;
  file: FileOf;
  /**
   * Fetch the stage files {@link file} was asked for and could not answer;
   * true when it got any (the plan is then made again). Absent where every
   * file is always to hand.
   */
  fetch?(): Promise<boolean>;
  /** where you stand */
  spot(): Promise<Spot>;
  /** these globals' values now, lowercased names to the scripts' strings ({@link Hotspot.when}) */
  globals(names: string[]): Promise<Record<string, string>>;
  /**
   * The six words the game answers for where you stand, when the walker can ask
   * (the machine harness runs the table's own handler); null to plan on the
   * table's every possible answer instead.
   */
  exits(): Promise<string[] | null>;
  /** press one way, and wait for the game to have taken it */
  press(way: Exit): Promise<void>;
  /** the names of the regions of the flat on screen */
  regions(): Promise<string[]>;
  /** click a region of the flat on screen by name, and wait for it to settle */
  click(region: string): Promise<void>;
  /** give the game up to `passes` engine passes (50 ms each) to move you off `from`; whether it did */
  moved(from: Spot, passes: number): Promise<boolean>;
  /** a line of the walk, for whoever is watching (`NAV=1`) */
  log?(line: string): void;
  /** what is wrong, with where; throws */
  fail(why: string): never;
}

/**
 * Walk to a goal (on this world), the keys found from the tables: a shortest
 * path, pressed one key at a time as a player presses it. A few tables answer
 * by the game's state (`if gGateOpen` …), so the plan takes every word a frame
 * might answer, and a step that lands somewhere the plan did not expect is
 * struck out and the path planned again from where the game really is.
 * Answers the number of keys pressed.
 */
export async function walkTo(w: Walker, goal: (s: Spot) => boolean, what: string): Promise<number> {
  const struck = new Set<string>();
  const seen = new Map<string, string[]>();
  const visited = new Set<string>();
  const world = w.world;
  /** a plan, made again while it asked for stage files that were not to hand yet */
  const planned = async (from: Spot, want: (s: Spot) => boolean): Promise<Step[] | null> => {
    for (;;) {
      // asked fresh for every plan: standing somewhere opens its hyperlinks
      const now = await w.globals([...hotspotGlobals]);
      const path = plan(w.file, world, from, seen, want, struck, (n) => now[n] ?? "");
      if (path?.length || !(await w.fetch?.())) return path;
    }
  };
  let presses = 0;
  for (let guard = 0; guard < 2000; guard++) {
    const at = await w.spot();
    if (goal(at)) return presses;
    const live = await w.exits();
    if (live) seen.set(spotId(at), live);
    visited.add(spotId(at));
    let path = await planned(at, goal);
    // no way that the tables name: the nearest frame whose way is computed
    // (`"TR." @ numtostring (count)`) and not yet asked is where to look next
    if (!path?.length) {
      const unknown = (s: Spot): boolean =>
        !seen.has(spotId(s)) && (tableOf(w.file, world, s.stage).get(s.frame) ?? []).some((ws) => ws.some((x) => x.includes("?")));
      path = await planned(at, unknown);
    }
    // still none: a step to a frame not yet stood on — some frames have no
    // table at all and move you on themselves (Atlantis's frame 200, whose
    // flat script turns you to 199)
    if (!path?.length) {
      // every answer the table might give, where the game has not said which
      const answers = live ? [live] : (tableOf(w.file, world, at.stage).get(at.frame) ?? []);
      for (const words of answers) {
        const i = EXITS.findIndex((e, i) => {
          const to = target(at, words[i] ?? "X");
          return to && !visited.has(spotId(to)) && !struck.has(`${spotId(at)}>${e}`);
        });
        if (i >= 0) {
          path = [{ way: EXITS[i], to: target(at, words[i])! }];
          break;
        }
      }
    }
    // and with no answer from the game to plan on, a way whose frame the table
    // builds at run time (`"TR." @ numtostring (count)`): pressed blind, and
    // wherever it leads is planned on from
    if (!path?.length && !live) {
      const answers = tableOf(w.file, world, at.stage).get(at.frame) ?? [];
      const i = EXITS.findIndex((e, i) => answers.some((ws) => ws[i]?.includes("?")) && !struck.has(`${spotId(at)}>${e}`));
      if (i >= 0) path = [{ way: EXITS[i], to: at, blind: true }];
    }
    if (!path?.length) {
      // a close-up the tables give no way out of: its `down` region is the way
      // back, as the arrow a player sees at the bottom of it says
      const down = (await w.regions()).find((r) => r.toLowerCase() === "down");
      if (down && !struck.has(`${spotId(at)}>down`)) {
        struck.add(`${spotId(at)}>down`);
        await w.click(down);
        presses++;
        continue;
      }
      // …or the frame moves you on by itself, once its animation is done
      if (await w.moved(at, 600)) continue;
      w.fail(`no way to ${what} from ${spotId(at)} (tables of ${stageFile(world, at.stage)})`);
    }
    const step = path[0];
    const way = typeof step.way === "string" ? step.way : step.way.region;
    if (typeof step.way === "string") await w.press(step.way);
    else if ((await w.regions()).includes(step.way.region)) await w.click(step.way.region);
    presses++;
    // a step whose own script is slow (a turn animated by `lefttoframe`, a
    // flat that carries you on) lands after the engine is idle: give it a moment
    // before taking it for a way the game refused
    if (spotId(await w.spot()) === spotId(at)) await w.moved(at, 120);
    const now = await w.spot();
    if (step.blind ? spotId(now) === spotId(at) : spotId(now) !== spotId(step.to)) {
      w.log?.(`nav: ${spotId(at)} ${way} landed ${spotId(now)}, not ${spotId(step.to)}`);
      struck.add(`${spotId(at)}>${way}`);
    }
  }
  return w.fail(`walked 2000 keys and never reached ${what}`);
}

/** where a carried thing may be let go on one frame — see {@link dropSpotsIn} */
export interface DropSpot {
  frame: number;
  box?: [number, number, number, number];
  region?: string;
}

/**
 * Where a carried thing may be let go, read off its own mousedown (its shop
 * script, decompiled): each `if curframenum = N` and, inside it, the box
 * (`dx > a & dx < b & dy > c & dy < d`), the region (`pointinbutton
 * (currentflat (), "name", …)`), or nothing (anywhere on that frame).
 */
export function dropSpotsIn(src: string): DropSpot[] {
  const md = src.slice(src.indexOf("code mousedown"), src.indexOf("endcode", src.indexOf("code mousedown")));
  const out: DropSpot[] = [];
  for (const part of md.split(/curframenum = /).slice(1)) {
    const frame = Number(/^(\d+)/.exec(part)?.[1]);
    const body = beforeElse(part);
    const b = /dx > (\d+) & dx < (\d+) & dy > (\d+) & dy < (\d+)/.exec(body);
    const r = /pointinbutton \([^,]+, "([^"]+)"/.exec(body);
    out.push({ frame, box: b ? [Number(b[1]), Number(b[3]), Number(b[2]), Number(b[4])] : undefined, region: r?.[1] });
  }
  return out;
}
