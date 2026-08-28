/**
 * The golden thread: Dust's shipped saves, in the order they were made, and
 * what changed between each pair.
 *
 *   npx tsx dust/tools/rtdthread.ts              # the ladder and its rungs
 *   npx tsx dust/tools/rtdthread.ts --spine      # …and the globals that never go back
 *   npx tsx dust/tools/rtdthread.ts --all        # …without the bookkeeping filter
 *   npx tsx dust/tools/rtdthread.ts --md         # the ladder as a Markdown table
 *   npx tsx dust/tools/rtdthread.ts --rung D2A_006   # one rung, in full
 *
 * `gamefiles/save/` is not a folder of examples. Sorted by `frame` — the
 * service-pass counter, 20 Hz — all but one of the files are a SINGLE session
 * that runs from `START` to `ENDING`, day 1 to day 5: CyberFlix's own
 * playthrough, saved about sixty times along the way and written by the shipped
 * `DF.EXE`. That is worth a tool rather than a paragraph, because it is the one
 * thing this project has for Dust that it does not have for Titanic — a record
 * of the ORIGINAL engine's state at sixty points across the whole game, against
 * which a port's own play can be checked. Titanic's goldens only ever say the
 * port agrees with itself.
 *
 * What the tool has to establish, and does not assume:
 *
 *   - **that it is one session.** Frame order is not lineage: a save made in a
 *     later sitting has a higher frame and an earlier day. So the walk tracks
 *     the running maximum day and calls out anything that goes backwards
 *     ({@link lineage}) rather than trusting the sort.
 *   - **which changes mean anything.** A `.rtd` is a serialized heap and the
 *     engine's own counters move every service pass. The filter below is a
 *     named list with a reason each, not a heuristic — see {@link BOOKKEEPING}.
 *
 * It reads only the saves, so it needs the rip but not a session, and it prints
 * offsets and state names rather than content.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSaveV1, type SaveGameV1 } from "@dreamfactory/engine/df/savegame-v1";

/* anchored to this file rather than the working directory: the tool answers the
   same from anywhere, which is what `dust/tests/movies.ts` learned the hard way */
const SAVES = process.argv[2]?.startsWith("--")
  ? fileURLToPath(new URL("../gamefiles/save", import.meta.url))
  : (process.argv[2] ?? fileURLToPath(new URL("../gamefiles/save", import.meta.url)));

const flag = (name: string): boolean => process.argv.includes(name);
const opt = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

/**
 * Globals the engine moves on its own, with the reason each is here.
 *
 * The bar for this list is that a change in it says nothing about where the
 * player has got to — not that it changes often. `playercash` and `handitem`
 * move constantly and are the story; `attentionspan` is a countdown in an idle
 * handler and is not.
 */
const BOOKKEEPING: Record<string, string> = {
  tumx2: "the tumbleweed's position — it blows across the street on its own",
  tumy2: "the tumbleweed's position",
  vitalframe: "the frame an idle animation is up to",
  attentionspan: "an idle handler's countdown to the next fidget",
  idlecount: "an idle handler's own counter",
  counter: "a scratch counter, reused by whatever block is running",
  scenecounter: "the engine's scene-change count",
  FXCOUNT: "the effects channel's round-robin cursor",
  stardx: "the star field's drift",
  stardy: "the star field's drift",
  stardz: "the star field's drift",
  starcount: "the star field's own counter",
  standx: "a scratch standpoint coordinate",
  standy: "a scratch standpoint coordinate",
  '"': 'a node named with a bare quote, of a type (4080) the reader knows no meaning for and no script mentions — heap residue, not a variable',
};

/**
 * The cards on the table: real state, and the whole of what it says is "you
 * gambled". The summary views collapse them to that; `--all` and the per-rung
 * view keep them.
 */
const DECK = new Set(["cardstring", "dealerdowncard", "playerdowncard", "betorder", "winner", "hasnopair", "has1pair", "roundnum", "playerbj", "quitpoker", "hasquitpoker"]);

/** what a one-line summary should lead with */
const LEADS = ["playercash", "phase", "day", "clock", "handitem"];

/** long values are decks and tables; a rung is not readable with one in it */
const short = (v: string): string => (v.length > 48 ? `${v.slice(0, 45)}…"` : v);

interface Rung {
  name: string;
  save: SaveGameV1;
  /** null for the first save on the thread */
  delta: Delta | null;
  /** a save whose day goes backwards: made in another sitting, not on the thread */
  offThread: boolean;
}

interface Delta {
  signal: string[];
  filtered: number;
  /** props the player picked up over this rung, and let go of */
  gained: string[];
  lost: string[];
  /** a prop that changed hands between two other owners */
  moved: string[];
}

/**
 * The player character's name in a prop record's `owner` field.
 *
 * Dust's hero has no name — the game calls him the Stranger and so does the
 * data. `owner "none"→"stranger"` is therefore the whole of "you picked it up",
 * which is what makes a walkthrough derivable from the saves at all.
 */
const PLAYER = "stranger";

const load = (dir: string): { name: string; save: SaveGameV1 }[] =>
  readdirSync(dir)
    .filter((f) => /\.rtd$/i.test(f))
    .map((f) => ({ name: f.replace(/\.rtd$/i, ""), save: parseSaveV1(new Uint8Array(readFileSync(join(dir, f)))) }))
    .sort((a, b) => a.save.frame - b.save.frame);

/** every global that differs between two saves, bookkeeping last */
function diff(before: SaveGameV1, after: SaveGameV1): Delta {
  const signal: string[] = [];
  let filtered = 0;
  const gained: string[] = [];
  const lost: string[] = [];
  const moved: string[] = [];
  const was = new Map(before.props.map((p) => [p.name, p]));
  for (const now of after.props) {
    const then = was.get(now.name);
    if (!then || then.owner === now.owner) continue;
    if (now.owner === PLAYER) gained.push(then.owner === "none" ? now.name : `${now.name} (from ${then.owner})`);
    else if (then.owner === PLAYER) lost.push(now.owner === "none" ? now.name : `${now.name} (to ${now.owner})`);
    else moved.push(`${now.name} ${then.owner}→${now.owner}`);
  }
  const push = (name: string, was: string, now: string) => {
    if (name in BOOKKEEPING) filtered++;
    else signal.push(`${name} ${was}→${now}`);
  };
  for (const k of new Set([...before.numGlobals.keys(), ...after.numGlobals.keys()])) {
    const a = before.numGlobals.get(k) ?? 0;
    const b = after.numGlobals.get(k) ?? 0;
    if (a !== b) push(k, String(a), String(b));
  }
  for (const k of new Set([...before.strGlobals.keys(), ...after.strGlobals.keys()])) {
    const a = before.strGlobals.get(k) ?? "";
    const b = after.strGlobals.get(k) ?? "";
    if (a !== b) push(k, short(JSON.stringify(a)), short(JSON.stringify(b)));
  }
  signal.sort();
  return { signal, filtered, gained, lost, moved };
}

/**
 * The thread, and what fell off it.
 *
 * A save belongs to the session in progress while its `day` is at least the
 * highest day seen so far. One that drops back was made later and from an
 * earlier point — a second sitting — and it must not become a rung, because the
 * delta across it would be that whole session read backwards.
 */
function lineage(saves: { name: string; save: SaveGameV1 }[]): Rung[] {
  const rungs: Rung[] = [];
  let maxDay = 0;
  let prev: SaveGameV1 | null = null;
  for (const { name, save } of saves) {
    const day = save.numGlobals.get("day") ?? 0;
    const offThread = day < maxDay;
    if (!offThread) maxDay = day;
    rungs.push({ name, save, offThread, delta: offThread || !prev ? null : diff(prev, save) });
    if (!offThread) prev = save;
  }
  return rungs;
}

const at = (s: SaveGameV1): string => {
  const p = s.standpoint;
  return `${p.setFile || `${p.set}.set`} (${p.cellX},${p.cellZ})`;
};
const clockName = (n: number | undefined): string =>
  n === 1 ? "morning" : n === 2 ? "afternoon" : n === 3 ? "night" : `clock ${n ?? "?"}`;
const mins = (frames: number): string => (frames / 20 / 60).toFixed(1);

if (!existsSync(SAVES)) {
  console.error(`no such directory: ${SAVES}\nusage: npx tsx dust/tools/rtdthread.ts [dir] [--spine] [--all] [--md] [--rung <name>]`);
  process.exit(1);
}
const saves = load(SAVES);
if (!saves.length) {
  console.error(`no .rtd files in ${SAVES} — this needs the Dust rip`);
  process.exit(1);
}
const rungs = lineage(saves);
const thread = rungs.filter((r) => !r.offThread);
const showAll = flag("--all");

// --- one rung, in full ------------------------------------------------------

const only = opt("--rung");
if (only) {
  const i = rungs.findIndex((r) => r.name.toUpperCase() === only.toUpperCase());
  if (i < 1) {
    console.error(`no rung ends at ${only} (the first save on the thread has no rung before it)`);
    process.exit(1);
  }
  const r = rungs[i];
  const before = rungs[i - 1];
  console.log(`${before.name} → ${r.name}   ${r.save.frame - before.save.frame} frames, ${mins(r.save.frame - before.save.frame)} min of play`);
  console.log(`  from ${at(before.save)} to ${at(r.save)}${r.save.puppet ? `, ${r.save.puppet} open` : ""}`);
  if (r.delta!.gained.length) console.log(`    TAKE  ${r.delta!.gained.join(", ")}`);
  if (r.delta!.lost.length) console.log(`    GIVE  ${r.delta!.lost.join(", ")}`);
  if (r.delta!.moved.length) console.log(`    (also ${r.delta!.moved.join(", ")})`);
  for (const line of r.delta?.signal ?? []) console.log(`    ${line}`);
  if (r.delta?.filtered) console.log(`  (+${r.delta.filtered} bookkeeping)`);
  process.exit(0);
}

// --- the ladder as Markdown -------------------------------------------------

if (flag("--md")) {
  console.log("| frame | save | when | where | what changed |");
  console.log("|------:|------|------|-------|--------------|");
  for (const r of thread) {
    const n = r.save.numGlobals;
    const when = `day ${n.get("day") ?? "?"} ${clockName(n.get("clock"))}`;
    const items = r.delta
      ? [
          ...r.delta.gained.map((g) => `**take** ${g}`),
          ...r.delta.lost.map((l) => `**give** ${l}`),
        ]
      : [];
    let rest = r.delta ? r.delta.signal.filter((x) => !DECK.has(x.split(" ")[0])) : [];
    const gambled = r.delta && rest.length !== r.delta.signal.length;
    rest = [...rest].sort((a, b) => {
      const ia = LEADS.indexOf(a.split(" ")[0]);
      const ib = LEADS.indexOf(b.split(" ")[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const what = r.delta
      ? [...items, ...(gambled ? ["*played cards*"] : []), ...rest.slice(0, items.length ? 2 : 3).map((x) => `\`${x}\``)].join(", ") || "—"
      : "*the thread starts*";
    console.log(`| ${r.save.frame} | \`${r.name}\` | ${when} | \`${at(r.save)}\` | ${what} |`);
  }
  process.exit(0);
}

// --- the ladder -------------------------------------------------------------

console.log(`${SAVES}\n`);
console.log("  frame  save          when                 where                        Δ");
for (const r of rungs) {
  const n = r.save.numGlobals;
  const when = `day ${n.get("day") ?? "?"} ${clockName(n.get("clock"))}`;
  const d = r.delta ? `${r.delta.signal.length}${r.delta.filtered ? `+${r.delta.filtered}` : ""}` : r.offThread ? "off-thread" : "-";
  console.log(
    `${String(r.save.frame).padStart(7)}  ${r.name.padEnd(12)}  ${when.padEnd(19)}  ` +
      `${at(r.save).padEnd(24)} ${d.padStart(6)}${r.save.puppet ? `  ${r.save.puppet}` : ""}`,
  );
}

// --- the rungs --------------------------------------------------------------

console.log("\n\nTHE RUNGS — what the play between two saves changed\n");
for (let i = 1; i < thread.length; i++) {
  const r = thread[i];
  const gap = r.save.frame - thread[i - 1].save.frame;
  console.log(`${thread[i - 1].name} → ${r.name}   ${mins(gap)} min`);
  if (r.delta!.gained.length) console.log(`    TAKE  ${r.delta!.gained.join(", ")}`);
  if (r.delta!.lost.length) console.log(`    GIVE  ${r.delta!.lost.join(", ")}`);
  if (r.delta!.moved.length) console.log(`    (also ${r.delta!.moved.join(", ")})`);
  const lines = showAll ? r.delta!.signal : r.delta!.signal.filter((l) => !(l.split(" ")[0] in BOOKKEEPING));
  for (const line of lines) console.log(`    ${line}`);
  if (!showAll && r.delta!.filtered) console.log(`    (+${r.delta!.filtered} bookkeeping)`);
  console.log();
}

// --- the spine --------------------------------------------------------------

if (flag("--spine")) {
  /**
   * Globals that never go backwards along the thread.
   *
   * This is derived rather than declared, and it is the closest thing the save
   * collection has to a list of story flags: a counter that only ever rises,
   * or a string that is set once and kept, is a thing the game remembers. A
   * `*phase` that resets every midnight is not on it, by construction.
   */
  console.log("\nTHE SPINE — globals that only ever move forwards\n");
  const names = new Set<string>();
  for (const r of thread) for (const k of r.save.numGlobals.keys()) names.add(k);
  const rows: string[] = [];
  for (const k of [...names].sort()) {
    if (k in BOOKKEEPING) continue;
    const seq = thread.map((r) => r.save.numGlobals.get(k) ?? 0);
    if (seq.every((v, i) => i === 0 || v >= seq[i - 1]) && seq[0] !== seq[seq.length - 1]) {
      const steps = thread
        .map((r, i) => (i > 0 && seq[i] !== seq[i - 1] ? `${r.name}:${seq[i]}` : null))
        .filter(Boolean);
      rows.push(`  ${k.padEnd(18)} ${steps.join(" ")}`);
    }
  }
  for (const row of rows) console.log(row);
  console.log("\n  and the strings set once and kept:\n");
  const snames = new Set<string>();
  for (const r of thread) for (const k of r.save.strGlobals.keys()) snames.add(k);
  for (const k of [...snames].sort()) {
    if (k in BOOKKEEPING) continue;
    const seq = thread.map((r) => r.save.strGlobals.get(k) ?? "");
    const set = seq.findIndex((v) => v !== "");
    if (set > 0 && seq.slice(set).every((v) => v === seq[set])) {
      console.log(`  ${k.padEnd(18)} ${JSON.stringify(seq[set])} at ${thread[set].name}`);
    }
  }
}

// --- the footer, which is the claim -----------------------------------------

const off = rungs.filter((r) => r.offThread);
const first = thread[0];
const last = thread[thread.length - 1];
console.log(
  `\n${thread.length} of ${rungs.length} saves are one session: ` +
    `${first.name} (frame ${first.save.frame}, day ${first.save.numGlobals.get("day")}) → ` +
    `${last.name} (frame ${last.save.frame}, day ${last.save.numGlobals.get("day")}), ` +
    `${mins(last.save.frame - first.save.frame)} min of play.`,
);
if (off.length) {
  console.log(
    `Off the thread: ${off.map((r) => `${r.name} (frame ${r.save.frame}, back to day ${r.save.numGlobals.get("day")})`).join(", ")}.`,
  );
}
/**
 * The filename convention, checked rather than believed.
 *
 * `D<day><part>_<n>` reads as day and day-part, and the save's own `day` and
 * `clock` agree with it — except where the name is a place or a puzzle instead,
 * and once where it is a place with the day-part letter still in it.
 */
const wantClock: Record<string, number> = { M: 1, A: 2, E: 3 };
const misnamed = rungs.filter((r) => {
  const m = /^D(\d)([MAE])_/.exec(r.name);
  if (!m) return false;
  return Number(m[1]) !== r.save.numGlobals.get("day") || wantClock[m[2]] !== r.save.numGlobals.get("clock");
});
const unpatterned = rungs.filter((r) => !/^D(\d)([MAE])_/.test(r.name));
console.log(
  `Named for a day-part: all agree with the save's own day and clock` +
    `${misnamed.length ? ` except ${misnamed.map((r) => r.name).join(", ")}` : ""}. ` +
    `Named for a place or a puzzle instead: ${unpatterned.map((r) => r.name).join(", ")}.`,
);
const gaps = thread.slice(1).map((r, i) => ({ name: r.name, gap: r.save.frame - thread[i].save.frame }));
gaps.sort((a, b) => b.gap - a.gap);
console.log(`Longest rungs: ${gaps.slice(0, 3).map((g) => `${g.name} ${mins(g.gap)} min`).join(", ")}.`);
