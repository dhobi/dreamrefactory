/**
 * Every leg of the run sheet, in one boot.
 *
 *     npm run speedrun:legs -w dust                     all of them
 *     ONLY=12 npm run speedrun:legs -w dust             just that one
 *     FROM=20 npm run speedrun:legs -w dust             from there on
 *     GREEN=.legs.green.json CHANGED=goto,say  …         skip what is still green
 *
 * Needs a dev server (`npm run dev -w dust`) and `APP_URL` if it is not on 5176.
 *
 * ## Why a leg can be run on its own
 *
 * Because every one of them opens with `loadSave(<the save it starts from>)` —
 * the fifty-five saves the original player left on the disc, which is what the
 * playthrough's rungs are anchored to. So this does not have to replay the route
 * to reach leg forty, and "restore from the last checkpoint" is free.
 *
 * ## The green list
 *
 * A leg that has run clean does not need running again — unless a verb IT USES
 * has changed since. So each run writes `<out>.green.json`, a map of leg to the
 * verbs its lines called, and a later run given `GREEN` and `CHANGED` skips the
 * legs whose verbs nobody touched. Which is why the verbs are recorded rather
 * than only the verdict.
 *
 * ## What a green leg does and does not prove
 *
 * It proves the leg's gestures work from the state its save records. It does NOT
 * prove the run works: every leg currently inherits a perfect state, and they
 * will drift once the `loadSave` lines come out. Getting them all green is the
 * first milestone; joining them is the second.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5176/";
const SHEET = fileURLToPath(new URL("../speedrun/run.sheet.txt", import.meta.url));
const OUT = process.env.OUT ?? fileURLToPath(new URL("../../.legs.json", import.meta.url));
const ONLY = process.env.ONLY ? Number(process.env.ONLY) : 0;
const FROM = process.env.FROM ? Number(process.env.FROM) : 1;
const PER_LEG = Number(process.env.PER_LEG ?? 120_000);
/**
 * Legs already green, and the verbs that would invalidate them.
 *
 * A leg that has run clean does not need running again — unless a verb IT USES
 * has changed since. So `GREEN` is a file of `{ leg: [verbs] }` from the last
 * sweep and `CHANGED` is the verbs touched since; a green leg is skipped when
 * the two do not intersect. Which is the whole reason to record the verbs rather
 * than just the verdict.
 */
const GREEN = process.env.GREEN ?? "";
const CHANGED = (process.env.CHANGED ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
const green: Record<string, string[]> = GREEN && existsSync(GREEN)
  ? (JSON.parse(readFileSync(GREEN, "utf8")) as Record<string, string[]>)
  : {};
/** the verbs a leg's lines actually call */
const verbsOf = (lines: string[]): string[] => [
  ...new Set(
    lines
      .map((l) => /^([a-zA-Z]+)\(/.exec(l.trim())?.[1]?.toLowerCase())
      .filter((v): v is string => !!v),
  ),
];

/** the sheet, cut into legs at each `loadSave` */
function legs(): { name: string; lines: string[] }[] {
  const all = readFileSync(SHEET, "utf8").split("\n");
  const out: { name: string; lines: string[] }[] = [];
  let cur: { name: string; lines: string[] } | null = null;
  for (const line of all) {
    if (/^loadSave\(/.test(line)) {
      if (cur) out.push(cur);
      cur = { name: /^loadSave\(([^,)]+)/.exec(line)![1], lines: [line] };
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) out.push(cur);
  return out;
}

const main = async (): Promise<void> => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  console.log(`opening ${APP}speedrun/`);
  await page.goto(`${APP}speedrun/`);
  await page.waitForSelector("#srsheet", { timeout: 120_000 });
  console.log("  panel up — waiting for the first film, then skipping the opening");
  await page.waitForFunction(
    `!!(window.dbg && window.dbg.host && window.dbg.host.director && window.dbg.host.director.movieFile)`,
    null,
    { timeout: 900_000 },
  );
  await page.fill("#srsheet", "skipMovie(until: js == !!window.dbg.viewer, budget: 180000)\n");
  await page.click("#srrun");
  await page.waitForFunction(
    () => /finished|failed|pointer left on line/i.test(document.getElementById("srstatus")?.textContent ?? ""),
    null,
    { timeout: 300_000 },
  );
  console.log("  booted\n");

  const all = legs();
  const results: { n: number; name: string; ok: boolean; status: string; lines: number; used: string[] }[] = [];
  for (const [i, leg] of all.entries()) {
    const n = i + 1;
    if (n < FROM) continue;
    if (ONLY && n !== ONLY) continue;
    const used = verbsOf(leg.lines);
    const wasGreen = green[leg.name];
    if (wasGreen && !CHANGED.some((v) => wasGreen.includes(v))) {
      console.log(`skip ${String(n).padStart(2)} ${leg.name.padEnd(10)} green last time, and none of its verbs changed`);
      results.push({ n, name: leg.name, ok: true, status: "skipped (green)", lines: leg.lines.length, used });
      continue;
    }
    const text = leg.lines.join("\n") + "\n";
    await page.fill("#srsheet", text);
    await page.click("#srrun");
    const verdict = await page
      .waitForFunction(
        () =>
          /finished|failed|stopped|could not|pointer left on line/i.test(
            document.getElementById("srstatus")?.textContent ?? "",
          ),
        null,
        { timeout: PER_LEG },
      )
      .then(() => true)
      .catch(() => false);
    const status = ((await page.textContent("#srstatus")) ?? "").replace(/\s+/g, " ").trim();
    const ok = verdict && /finished/i.test(status);
    results.push({ n, name: leg.name, ok, status: status.slice(0, 400), lines: leg.lines.length, used });
    console.log(`${ok ? "ok  " : "FAIL"} ${String(n).padStart(2)} ${leg.name.padEnd(10)} ${verdict ? "" : "(no verdict) "}${ok ? "" : status.slice(0, 220)}`);
    // stop the run if one is still going, so the next leg starts clean
    await page.click("#srstop").catch(() => {});
  }

  writeFileSync(OUT, JSON.stringify(results, null, 1));
  // the green list for next time: leg -> the verbs it used
  writeFileSync(
    OUT.replace(/\.json$/, "") + ".green.json",
    JSON.stringify(
      Object.fromEntries(results.filter((r) => r.ok).map((r) => [r.name, r.used])),
      null,
      1,
    ),
  );
  const good = results.filter((r) => r.ok).length;
  console.log(`\n${good}/${results.length} legs finished. Written to ${OUT}`);
  if (errors.length) console.log(`PAGE ERRORS: ${errors.slice(0, 4).join(" | ")}`);
  await browser.close();
};

void main();
