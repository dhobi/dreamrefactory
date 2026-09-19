/**
 * Cut and push the release tags, one push at a time, and prove each one started
 * a deploy.
 *
 *   npm run release -- taoot dust timelapse skullcracker
 *   npm run release -- --dry-run taoot
 *   npm run release                      # every package whose version has no tag
 *
 * ## Why this exists rather than `git push --tags`
 *
 * **GitHub creates no workflow run at all when more than three tags arrive in a
 * single push.** That is a documented limit and there is no warning anywhere:
 * the push succeeds, `git ls-remote` shows every tag, the Actions tab shows
 * nothing, and the release sits there looking released. A four-game release
 * hits it exactly — which is how Titanic 0.9.75, Dust 0.3.20, Timelapse 0.1.4
 * and Skull Cracker 0.1.2 all went out as tags and none of them deployed.
 *
 * It is the second failure at this seam and the first one is already written
 * into `deploy.yml`: three tags pushed together once deployed one game and
 * CANCELLED the other two, because a single concurrency lane keeps only the
 * newest run pending. That was fixed by splitting the lane per target. This one
 * cannot be fixed in the workflow at all — the events never reach it — so it has
 * to be fixed in the hand that pushes, which is this file.
 *
 * Hence {@link TAGS_PER_PUSH}, and hence the check after each push: a release
 * tool that only pushes is a release tool that can still leave you with four
 * tags and no deploys. This one waits for the run to appear and, if it does not,
 * dispatches the deploy itself and says so.
 *
 * ## What it refuses to do
 *
 * Tag anything but a clean master that matches its remote, re-tag a version that
 * already has a tag, or invent a version: the number comes from the package and
 * the tag is spelled from it, which is the pairing `deploy.yml` re-checks on the
 * other side before it uploads anything.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * How many tags may go in one `git push`.
 *
 * ONE. GitHub's limit is three, and three is not a margin worth having for
 * something whose failure mode is silence — see the header. Pushing singly costs
 * a round trip per game and buys a deploy that is either running or reported
 * missing within the minute.
 */
const TAGS_PER_PUSH = 1;

/** how long to wait for a pushed tag to show up as a run before dispatching */
const RUN_APPEARS_MS = 90_000;
const POLL_MS = 5_000;

/** everything `deploy.yml` can release — the games, and the site around them */
const TARGETS = ["site", "taoot", "dust", "timelapse", "skullcracker"] as const;
type Target = (typeof TARGETS)[number];

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const run = (cmd: string, args: string[]): string =>
  execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8" }).trim();

const version = (target: string): string =>
  (JSON.parse(readFileSync(join(ROOT, target, "package.json"), "utf8")) as { version: string }).version;

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const asked = argv.filter((a) => !a.startsWith("--"));

for (const a of asked) {
  if (!TARGETS.includes(a as Target)) {
    console.error(`${a} is not releasable — one of: ${TARGETS.join(", ")}`);
    process.exit(1);
  }
}

// ---- the tree has to be one a tag can mean something on ---------------------

/**
 * A refusal, which a real run exits on and a dry run only reports.
 *
 * `--dry-run` is asked "what would you do", and "refuse, and here is why" is a
 * useful answer to that — more useful than the first guard's message and
 * nothing else, which is what an early exit gives. Every guard still stops a
 * real release dead.
 */
const refusals: string[] = [];
const refuse = (why: string): void => {
  if (!dryRun) {
    console.error(why);
    process.exit(1);
  }
  refusals.push(why);
};

const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "master") refuse(`on ${branch}, not master — a release tag names a commit on master`);
if (run("git", ["status", "--porcelain"])) refuse("the working tree is dirty — commit or stash before tagging");
// `git fetch` here can go out anonymous and be rate-limited even when gh is
// logged in, because a global credential.helper answers first with nothing
run("git", ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", "fetch", "origin", "master", "--tags"]);
const head = run("git", ["rev-parse", "HEAD"]);
const remote = run("git", ["rev-parse", "FETCH_HEAD"]);
if (head !== remote) {
  refuse(`HEAD (${head.slice(0, 7)}) is not origin/master (${remote.slice(0, 7)}) — pull or push first`);
}

/** the tags already on the remote, so an existing release is never re-cut */
const existing = new Set(
  run("git", ["ls-remote", "--tags", "origin"])
    .split("\n")
    .map((l) => l.split("refs/tags/")[1])
    .filter((t): t is string => !!t && !t.endsWith("^{}")),
);

const wanted = (asked.length ? asked : [...TARGETS])
  .map((target) => ({ target, tag: `${target}-v${version(target)}` }))
  .filter(({ tag }) => {
    // with no arguments this is the whole point: release what has no tag yet
    if (existing.has(tag) && !asked.length) return false;
    return true;
  });

for (const { tag } of wanted) {
  if (existing.has(tag)) refuse(`${tag} is already on the remote — bump the version first`);
}
if (dryRun) {
  console.log("(dry run: nothing will be tagged, pushed or dispatched)");
  // before the early exit below, not after it: "nothing to release" is not the
  // whole answer when the reason a real run would stop is something else
  for (const why of refusals) console.log(`would refuse: ${why}`);
}
if (!wanted.length) {
  console.log("every package's version is already tagged; nothing to release");
  process.exit(0);
}

console.log(`releasing ${wanted.length} at ${head.slice(0, 7)}: ${wanted.map((w) => w.tag).join(", ")}`);

// ---- one tag, one push, one proof, then the next ---------------------------

const started: string[] = [];
for (const { target, tag } of wanted) {
  console.log(`\n== ${tag}`);
  if (dryRun) {
    console.log(`   would: git tag ${tag} && git push origin ${tag}  (${TAGS_PER_PUSH} per push)`);
    console.log(`   would: wait ${RUN_APPEARS_MS / 1000}s for a deploy run, then dispatch if none`);
    continue;
  }

  run("git", ["tag", tag]);
  run("git", ["push", "origin", tag]);
  console.log("   pushed");

  // The check the header is about. A tag that pushed and started nothing is the
  // failure this tool exists for, and it is invisible from the push alone.
  let url = "";
  for (let waited = 0; waited < RUN_APPEARS_MS && !url; waited += POLL_MS) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, POLL_MS);
    const runs = JSON.parse(
      run("gh", ["run", "list", "--workflow=deploy.yml", "--limit", "15", "--json", "headBranch,url"]),
    ) as { headBranch: string; url: string }[];
    url = runs.find((r) => r.headBranch === tag)?.url ?? "";
  }

  if (url) {
    console.log(`   deploying: ${url}`);
  } else {
    console.log(`   no run appeared in ${RUN_APPEARS_MS / 1000}s — dispatching it by hand`);
    console.log(`   ${run("gh", ["workflow", "run", "deploy.yml", "--ref", "master", "-f", `target=${target}`])}`);
  }
  started.push(tag);
}

if (!dryRun) console.log(`\n${started.length} released: ${started.join(", ")}`);
