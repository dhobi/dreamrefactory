/**
 * What runs while nobody is watching, and whether it is what was meant.
 *
 *   npx vitest run site/tests/nightly-suites.ts
 *
 * `browser.yml` is written so that nothing in it names a game — the game is a
 * variable and every step derives from it — with two deliberate exceptions, and
 * both of them are tables that cannot be derived from anything:
 *
 *   - **What a game's full run IS.** `test:browser` is the right answer for
 *     exactly one of the three. Dust's runs three short suites while its depth
 *     is `speedrun:legs`, the fifty-five legs off the run sheet; Skull Cracker's
 *     opens the menu and stops, and its thirty-six suites are `test:browser:all`.
 *     With one default for all three, a `full-run-skullcracker` label ran the
 *     menu and reported the pull request green.
 *   - **Which cron means which.** A scheduled run carries no inputs at all. The
 *     cron expression that fired is the only thing GitHub hands it, so the four
 *     nightlies can only be told apart by matching that string — and it has to
 *     be matched in THREE places, because a GitHub expression cannot call the
 *     shell: the concurrency group (or the second cron cancels the first), the
 *     job's name (or every nightly is headed "taoot"), and the step that
 *     actually picks the game.
 *
 * Three copies of one table is exactly the shape `site/tests/deploy-lanes.ts`
 * already guards for the deploy workflow, and for the same reason: every way it
 * can rot is quiet. A cron with no mapping fails at 4 a.m. with "no game is
 * mapped"; a mapping naming a script that has been renamed fails with "has no
 * script"; a cron missing from the concurrency group does not fail at all — it
 * silently cancels the run before it, and the games it was meant to cover simply
 * stop being covered.
 *
 * So this reads the workflow as TEXT and checks the four places agree. Text
 * rather than parsed YAML for deploy-lanes.ts's reason: what is being checked is
 * that a string appears in particular places, and a parser would have to be told
 * the same places anyway.
 */
import { test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const workflow = readFileSync(join(ROOT, ".github/workflows/browser.yml"), "utf8");

/** a section of the file, so "appears in the concurrency group" means that group */
function section(from: string, to: string): string {
  const start = workflow.indexOf(from);
  expect(start, `browser.yml has ${from}`).toBeGreaterThan(-1);
  const end = workflow.indexOf(to, start);
  expect(end, `browser.yml has ${to} after ${from}`).toBeGreaterThan(start);
  return workflow.slice(start, end);
}

/** the crons the workflow is scheduled on */
const scheduled = [...workflow.matchAll(/^\s*- cron: "([^"]+)"/gm)].map((m) => m[1]);

/** the step's `"<cron>") game=<game>; suite=<suite> ;;` table */
const mapped = [...workflow.matchAll(/"(\d+ \d+ \* \* \*)"\)\s*game=(\S+?);\s*suite=(\S+?)\s*;;/g)].map(
  (m) => ({ cron: m[1], game: m[2], suite: m[3] }),
);

/** the `full_run()` table: a game, and the script its fullest run is */
const fullRun = [...section("full_run() {", "\n          }").matchAll(/^\s+(\w+)\)\s+echo "([^"]+)"/gm)].map(
  (m) => ({ game: m[1], suite: m[2] }),
);

const scripts = (game: string): Record<string, string> => {
  const path = join(ROOT, game, "package.json");
  expect(existsSync(path), `${game} is a package in this repository`).toBe(true);
  return (JSON.parse(readFileSync(path, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
};

test("every cron the workflow runs on is mapped to a game and a suite", () => {
  expect(scheduled.length).toBeGreaterThan(1);
  expect(mapped.map((m) => m.cron).sort()).toEqual([...scheduled].sort());
});

test("every mapped nightly names a script that exists", () => {
  for (const { cron, game, suite } of mapped) {
    expect(Object.keys(scripts(game)), `${cron} runs ${game}'s ${suite}`).toContain(suite);
  }
});

test("the games named as unattended are the ones with long suites", () => {
  // not an arbitrary list: these are the three the workflow offers, and the
  // nightlies exist so that none of them is only ever run by hand
  expect(new Set(mapped.map((m) => m.game))).toEqual(new Set(["taoot", "dust", "skullcracker"]));
});

test("a full run means that game's own suite, and each one exists", () => {
  const byGame = Object.fromEntries(fullRun.map((f) => [f.game, f.suite]));
  // the two whose `test:browser` is not their full run — the whole reason the
  // table exists. A default of `test:browser` covers everyone else.
  expect(byGame.dust).toBe("speedrun:legs");
  expect(byGame.skullcracker).toBe("test:browser:all");
  for (const { game, suite } of fullRun) {
    expect(Object.keys(scripts(game)), `${game}'s full run is ${suite}`).toContain(suite);
  }
});

test("a dispatch that names no suite falls through to the full run", () => {
  // `default: test:browser` on the input would mean the table never gets a say,
  // and Skull Cracker's dispatch would quietly run the menu again
  const inputs = section("  workflow_dispatch:", "  pull_request:");
  expect(/suite:[\s\S]*?default: ""/.test(inputs), "the suite input defaults to blank").toBe(true);
});

test("each nightly is its own concurrency group, or the next cron cancels it", () => {
  const group = section("concurrency:", "permissions:");
  // the first cron is the fallback arm and is deliberately not matched there;
  // every other one has to be named or it collides with that fallback
  for (const cron of scheduled.slice(1)) {
    expect(group, `the concurrency group distinguishes ${cron}`).toContain(`'${cron}'`);
  }
});

test("each nightly is headed with the game it is really running", () => {
  const name = section("    name: >-", "    # On `labeled`");
  for (const cron of scheduled.slice(1)) {
    expect(name, `the job name distinguishes ${cron}`).toContain(`'${cron}'`);
  }
});
