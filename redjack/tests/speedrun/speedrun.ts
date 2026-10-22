/**
 * A RedJack sheet, cold boot onwards, in node — no page, no dev server.
 *
 *   npm run speedrun -w redjack                     # run.sheet.txt, from the boot
 *   npm run speedrun -w redjack -- --from=day3      # from one of its save() points
 *   npm run speedrun -w redjack -- --lint           # parse it and say nothing else
 *   SHEET=path/to/other.sheet.txt npm run speedrun -w redjack
 *
 * Timelapse's (timelapse/tests/speedrun/speedrun.ts) for RedJack: the same
 * shared runner and the same sheet clock, so the in-game time it prints is the
 * workbench's. Every `save(name)` a run passes is written to
 * `.speedrun-saves/<name>.rtd` beside this package so `--from` can enter there
 * later — the game's own `.save`, which RedJack writes anywhere with no
 * template (engine/src/df/savegame-v5.ts).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describeSheet, parseSheet, type Step } from "@dreamfactory/speedrun/sheet";
import { runSheet } from "@dreamfactory/speedrun/runner";
import { ACTIONS, VERBS } from "../../src/speedrun/actions";
import { haveRip } from "../machine/harness";
import { headlessRun } from "./headless";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../..");
const SHEET = process.env.SHEET ? resolve(ROOT, process.env.SHEET) : join(HERE, "run.sheet.txt");
const CHECKPOINTS = join(HERE, "../../.speedrun-saves");
const DAYS = join(HERE, "../../gamefiles/save");
const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(`--${name}`);
const FROM = argv.find((a) => a.startsWith("--from="))?.slice("--from=".length) ?? process.env.FROM;
const SEED = process.env.SEED ? Number(process.env.SEED) : null;

const ms = (n: number): string => {
  const t = Math.round(n / 100);
  if (t < 600) return `${Math.floor(t / 10)}.${t % 10}s`;
  return `${Math.floor(t / 600)}:${String(Math.floor((t % 600) / 10)).padStart(2, "0")}.${t % 10}`;
};

/**
 * The sheet re-entered after its `save(name)` line, with the boot and a load in
 * front — and the watches the sheet had standing there, its `watchFor` lines
 * before the save replayed in order (an `off` among them included), so a run
 * from a save skips the films and the speech the whole run does.
 */
function enterAt(steps: Step[], name: string): Step[] {
  const at = steps.findIndex((s) => s.verb === "save" && (s.args[0] ?? "").toLowerCase() === name.toLowerCase());
  if (at < 0) {
    const points = steps.filter((s) => s.verb === "save").map((s) => s.args[0]);
    throw new Error(`no save point called "${name}" in this sheet. It has: ${points.join(", ") || "none"}`);
  }
  // no viewer on this game: the boot is over when the page says so (main.ts `dbg.booted`)
  const boot = parseSheet(
    ["skipMovie(until: js == window.dbg.booted, budget: 180000)", `load(${steps[at].args[0]})`].join("\n"),
    { verbs: VERBS },
  );
  const watches = steps.slice(0, at).filter((s) => s.verb === "watchfor");
  return [...boot, ...watches, ...steps.slice(at + 1)];
}

async function main(): Promise<void> {
  const sheet = SHEET;
  if (!existsSync(sheet)) throw new Error(`no sheet at ${sheet}`);
  const whole = parseSheet(readFileSync(sheet, "utf8"), { verbs: VERBS });
  const steps = FROM ? enterAt(whole, FROM) : whole;
  const from = FROM ? '\n  from "' + FROM + '"' : "";
  console.log(`sheet ${relative(ROOT, sheet)} — ${describeSheet(whole)}${from}`);
  if (flag("lint")) return;
  if (!haveRip()) throw new Error("no RedJack rip at redjack/gamefiles/ — the run needs the game");

  mkdirSync(CHECKPOINTS, { recursive: true });
  const file = (name: string): string => join(CHECKPOINTS, `${name.toLowerCase().replace(/[^a-z0-9_-]+/g, "_")}.rtd`);
  const started = Date.now();
  const { driver, host } = await headlessRun({
    prepare: (s) => {
      s.nominalTime = true;
      s.sheetClock = true;
      if (SEED !== null) s.seedRandom(SEED);
    },
    seed: SEED,
    log: (m) => process.env.VERBOSE && console.log(`    ${m}`),
    putSave: (name, bytes) => writeFileSync(file(name), bytes),
    getSave: (name) => {
      if (existsSync(file(name))) return new Uint8Array(readFileSync(file(name)));
      // the port's own day saves (gamefiles/save/, tools/mksaves.mts), for a
      // sheet worked on a day at a time: load(day3) where no save(day3) was made
      const day = join(DAYS, `${name.toLowerCase()}.save`);
      return /^day[1-7]$/i.test(name) && existsSync(day) ? new Uint8Array(readFileSync(day)) : null;
    },
  });
  const r = await runSheet(driver, steps, ACTIONS, {
    onStep: (step, i, total) => process.env.VERBOSE && console.log(`  [${i + 1}/${total}] ${step.source}`),
    // what each line cost, in game time and frames, and what it said: the
    // workbench's columns, for comparing a line between the two
    onDone: (t) =>
      process.env.VERBOSE &&
      console.log(`      ${ms(host().session.gameNow).padStart(8)} +${ms(t.game)} ${t.frames}f${t.says.length ? "  " + t.says.join("; ") : ""}`),
  });

  let at = 0;
  for (const s of r.splits) {
    if (!s.actions) continue;
    at += s.game;
    console.log(`  ${s.name.padEnd(28)} ${ms(at).padStart(9)}   +${ms(s.game)}`);
  }
  console.log(`\n  in-game ${ms(r.total.game)}, ${r.total.frames} frames   (${((Date.now() - started) / 1000).toFixed(1)} s of this machine)`);
  if (r.invalid.length) console.log(`  NOT A VALID TIME: ${r.invalid.join(", ")}`);
  if (r.failure) {
    console.log(`\n  STOPPED at line ${r.failure.step.line}: ${r.failure.step.source}\n    ${r.failure.error.message}`);
    if (r.where) console.log(`    standing: ${r.where}`);
    process.exit(1);
  }
  // a film or a loop still armed would keep node up
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
