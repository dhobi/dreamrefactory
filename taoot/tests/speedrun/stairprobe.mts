/**
 * A PROBE, not a route: walk the second-class stairwell from the boat deck down
 * to F and write down what the game actually does at every press.
 *
 *   npx tsx taoot/tests/speedrun/stairprobe.mts
 *
 * STAIR2C.SET is the one room in the ship that has defeated every attempt to
 * write it into the sheet, and the reason is that it is not a place — it is one
 * flight of geometry reused for six decks, with `savedeck` as the global that
 * says which one you are on and `up` at the bottom view teleporting you back to
 * the top of the same scenes one deck lower. So a recording of a walk through it
 * is a recording of nothing reusable, and this exists to produce the fact a
 * route actually needs: at each standpoint, on each deck, WHICH KEY MOVES YOU ON.
 *
 * It drives real keys through the same page the speedrun drives, reads the world
 * between them, and prints one line per press. It changes no files and asserts
 * nothing; reading the output is the point.
 */
import { chromium } from "playwright";
import { speedrunDriver } from "./driver";
import { playUrl } from "../browser/driver";
import { DEFAULT_LANGUAGE } from "../../src/languages";
import { parseSheet } from "../../src/speedrun/sheet";
import { VERBS } from "../../src/speedrun/actions";
import { runSheet } from "../../src/speedrun/runner";

const CHECKPOINT = "m4p0 stairtop";
const MAX_PRESSES = 400;

const url = playUrl();
url.searchParams.set("edition", process.env.TAOOT_LANG ?? DEFAULT_LANGUAGE);
const browser = await chromium.launch({ headless: !process.env.HEADED });
const page = await browser.newPage({ viewport: { width: 1400, height: 1300 } });
await page.goto(url.toString());
await page.waitForFunction(() => !!(window as any).dbg, null, { timeout: 20_000 });
const d = await speedrunDriver(page, { log: () => {} });

/** everything the stairwell decides anything by, in one round trip */
const STATE = `(() => {
  const s = window.dbg.session, v = window.dbg.viewer;
  if (!v) return null;
  const view = v.scene.views[v.viewIdx];
  return {
    set: String(s.currentSetFile || "").toLowerCase().replace(/\\.set$/, ""),
    scene: String(v.scene.sceneName || ""),
    view: view ? String(view.viewName) : "?",
    deck: String(s.interp.globals.get("savedeck") ?? ""),
    csea: String((window.dbg.session.actorRuntime.actors.get("csea") || {}).owner ?? "-"),
    talking: !!v.conversing,
    objects: (view ? view.objects.map((o) => o.identifier).filter(Boolean) : []).join(","),
  };
})()`;

type State = { set: string; scene: string; view: string; deck: string; csea: string; talking: boolean; objects: string };
const read = () => d.evaluate<State>(STATE);
const show = (s: State) =>
  `${s.set} ${s.scene}/${s.view} deck=${s.deck || "-"} csea=${s.csea}` +
  (s.objects ? ` [${s.objects}]` : "") + (s.talking ? " TALKING" : "");

// -- boot, and load the top of the stair ------------------------------------
// Run as a SHEET rather than by hand. The boot is four lines with real
// conditions in them (a film, an ownership question, a title menu, and a load
// that refuses to run before the shops are open), and hand-rolling them here
// got the sequence wrong on the first try — `--from` already knows it, so use
// the same parser and the same loop.
const boot = parseSheet(
  [
    "intro()",
    "skipMovie(until: awaiting, budget: 90000)",
    "clickAt(266, 254)",
    "skipMovie(until: quiet, budget: 90000)",
    `load(${CHECKPOINT})`,
  ].join("\n"),
  { verbs: VERBS },
);
const booted = await runSheet(d, boot);
if (booted.failure) {
  console.error(`could not reach the stair: ${booted.failure.step.source} — ${booted.failure.error.message}`);
  await browser.close();
  process.exit(1);
}

console.log(`start: ${show(await read())}\n`);

/**
 * Press a key and say what it did.
 *
 * "did nothing" is as much a result as a move — the dead end at Scene41/View48
 * was exactly that, an `up` the room had no answer for — so a press that
 * changes no field is printed rather than retried or hidden.
 */
let last = await read();
async function press(key: string): Promise<State> {
  await page.keyboard.press(key);
  await page.waitForTimeout(260);
  const now = await read();
  const same = now.scene === last.scene && now.view === last.view && now.deck === last.deck && now.talking === last.talking;
  console.log(`  ${key.padEnd(10)} -> ${same ? "(nothing)" : show(now)}`);
  last = now;
  return now;
}

// -- the descent -------------------------------------------------------------
// A wall-follower with two pieces of memory, both put in after watching it fail
// without them: it refuses a (standpoint, key) that took it UP a deck — View72
// is an ascent and the first run spent half its budget oscillating on it — and
// it records the presses that worked so the leg can be emitted as sheet lines
// at the end.
//
// The emitted lines use `confirm: no` throughout, deliberately. A sheet's plain
// `up()` retries a press the room ignored and fails after three; this stairwell
// answers a press by setting a global as often as by moving, so "the world did
// not move" is a normal outcome here and not an error. Replaying the presses
// verbatim is the only encoding that matches what the probe actually did.
const DECKS = ["bd", "a", "b", "c", "d", "e", ""];
const rank = (d: string) => (DECKS.indexOf(d) < 0 ? 99 : DECKS.indexOf(d));
const forbidden = new Set<string>();
const script: string[] = [];
const at = (s: State) => `${s.deck}|${s.scene}/${s.view}`;

let presses = 0;
let done = false;
while (presses < MAX_PRESSES && !done) {
  let s = await read();
  if (s.set !== "stair2c") { console.log(`\nleft the stairwell: ${show(s)}`); break; }
  if (s.view === "View28") { console.log(`\nAT THE DOOR OUT: ${show(s)}`); done = true; break; }
  if (s.talking) {
    console.log(`  -- ${s.csea} stops you here`);
    script.push("say(patience: 4000, otherwise: first)");
    for (let i = 0; i < 40 && (await read()).talking; i++) await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    last = await read();
    continue;
  }
  const here = at(s);
  const key = !forbidden.has(`${here}>ArrowUp`) ? "ArrowUp" : "ArrowRight";
  const before = s;
  s = await press(key); presses++;
  if (rank(s.deck) < rank(before.deck)) {
    console.log(`     ^ that went UP a deck — never again from ${here}`);
    forbidden.add(`${here}>${key}`);
    continue;
  }
  if (at(s) === here && key === "ArrowUp") { forbidden.add(`${here}>ArrowUp`); continue; }
  script.push(`${key === "ArrowUp" ? "up" : "right"}(confirm: no)`);
}

console.log(`\n--- the leg, as sheet lines (${script.length}) ---`);
console.log(script.join("\n"));
console.log(`\nend: ${show(await read())}`);
await browser.close();
