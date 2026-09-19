/**
 * Every game has a deploy lane, and every lane names a game.
 *
 *   npx vitest run site/tests/deploy-lanes.ts
 *
 * `deploy.yml` says which tags release what, and it says it in FOUR places that
 * have to agree: the `push.tags` trigger, the `workflow_dispatch` choices, the
 * concurrency group, and the shell that turns a tag into a target. A game missing
 * from any one of them fails differently and none of the failures is loud:
 *
 *   - missing from the trigger, and the tag pushes and deploys **nothing at all**;
 *   - missing from the resolver, and the run fails with "names no target" after
 *     the checkout — which is at least an error, and is the one this repository
 *     chose over defaulting to Titanic;
 *   - missing from the concurrency group, and two releases of the same game can
 *     mirror over each other;
 *   - missing from the dispatch options, and the Actions tab cannot rerun it by
 *     hand, which is how the three-tag release that
 *     [cancelled two of its own runs](../../.github/workflows/deploy.yml) went out.
 *
 * The lane itself is generic — `npm run build -w <target>` writes `dist/<target>` and
 * that is mirrored to `<target>/` — so adding a game is only ever these four lines
 * plus a build script, and this is what says all five are present. It reads the
 * workflow as TEXT rather than parsing the YAML: what is being checked is that a
 * name appears in four specific places, and a parser would have to be told the
 * same four places anyway.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GAMES } from "@dreamfactory/site/games";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const workflow = readFileSync(`${ROOT}/.github/workflows/deploy.yml`, "utf8");

/** the four places a target has to be named, as the patterns that find it */
const places = (target: string): { where: string; found: boolean }[] => [
  { where: "the push.tags trigger", found: workflow.includes(`"${target}-v*"`) },
  { where: "the workflow_dispatch options", found: new RegExp(`options: \\[[^\\]]*\\b${target}\\b`).test(workflow) },
  { where: "the concurrency group", found: workflow.includes(`'${target}-v') && '${target}'`) },
  { where: "the tag-to-target shell", found: workflow.includes(`== ${target}-v*`) },
];

test("every game in the registry has all four halves of a deploy lane", () => {
  const missing: string[] = [];
  for (const game of GAMES) {
    for (const p of places(game.dir)) if (!p.found) missing.push(`${game.dir}: not in ${p.where}`);
  }
  expect(
    missing,
    missing.length ? `deploy.yml would not release a game it is offered:\n  ${missing.join("\n  ")}` : undefined,
  ).toEqual([]);
});

test("and the site itself, which is the same lane with a different remote", () => {
  for (const p of places("site")) expect(p.found, `site is not in ${p.where}`).toBe(true);
  // the one asymmetry: the site's build IS the root of the tree
  expect(workflow).toContain('[ "$target" = site ] && echo "remote=." >> "$GITHUB_OUTPUT"');
});

test("no tag pattern releases something that is not a game or the site", () => {
  const known = new Set(["site", ...GAMES.map((g) => g.dir)]);
  const trigger = /tags: \[([^\]]*)\]/.exec(workflow)?.[1] ?? "";
  const targets = [...trigger.matchAll(/"([a-z]+)-v\*"/g)].map((m) => m[1]);
  expect(targets.length, `no tag patterns found in the trigger: ${trigger}`).toBeGreaterThan(1);
  for (const t of targets) {
    expect(known.has(t), `deploy.yml releases on ${t}-v*, which names no game and is not the site`).toBe(true);
  }
});

test("each lane has the build script it runs", () => {
  // The workflow's build step is `npm run build -w ${target}`, so the script has
  // to be in THAT package rather than at the root — a lane without it fails after
  // the checkout rather than before the tag. The root has no per-game build script
  // any more: each package carries its own, and `npm run build` fans out.
  for (const target of ["site", ...GAMES.map((g) => g.dir)]) {
    const pkg = JSON.parse(readFileSync(`${ROOT}/${target}/package.json`, "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.build, `${target}/package.json has no build script`).toBeTruthy();
  }
});

/**
 * The release tool, and the limit that made one necessary.
 *
 * GitHub creates NO workflow run when more than three tags arrive in one push —
 * not merely the excess ones — and nothing anywhere reports it: the push
 * succeeds, every tag is on the remote, and the Actions tab is empty. A
 * four-game release hits it exactly, and did. `deploy.yml` cannot defend
 * against it, because the events never reach the workflow; the defence is
 * `tools/release.mts`, which pushes one tag per push and then checks that each
 * started a run.
 *
 * So what is checked here is that the defence stays reachable and stays honest:
 * the tool is wired to a script, it still pushes singly, it knows the same five
 * targets the workflow releases, and neither the workflow nor the docs still
 * recommend the shape that fails.
 */
const release = readFileSync(`${ROOT}/tools/release.mts`, "utf8");
const docs = readFileSync(`${ROOT}/docs/reference/deploy.md`, "utf8");

test("the release tool pushes one tag per push", () => {
  // three is GitHub's limit; anything above one is a margin not worth having
  // for a failure whose only symptom is silence
  const per = /const TAGS_PER_PUSH = (\d+);/.exec(release);
  expect(per, "tools/release.mts declares TAGS_PER_PUSH").not.toBeNull();
  expect(Number(per![1])).toBeLessThanOrEqual(3);
  expect(Number(per![1])).toBe(1);
});

test("the release tool releases exactly what the workflow can release", () => {
  const listed = [...(/const TARGETS = \[([^\]]*)\]/.exec(release)?.[1] ?? "").matchAll(/"([a-z]+)"/g)].map(
    (m) => m[1],
  );
  expect(new Set(listed)).toEqual(new Set(["site", ...GAMES.map((g) => g.dir)]));
});

test("a pushed tag is not taken on trust — the run has to appear", () => {
  // the half a tool that only pushed would still get wrong: four tags, no
  // deploys, and nothing to say so until somebody looks at the site
  expect(release).toContain("workflow run");
  expect(release).toMatch(/gh", \["run", "list"/);
});

test("nothing still recommends the push that GitHub drops", () => {
  expect(workflow).not.toMatch(/^[^#\n]*git push --tags/m);
  // the docs may NAME it, but only to say not to
  for (const line of docs.split("\n").filter((l) => l.includes("git push --tags"))) {
    expect(line, `deploy.md line still advises it: ${line}`).toMatch(/Do not/);
  }
  expect(docs).toContain("npm run release");
});

test("the release script is wired up, or the tool is only a file", () => {
  const root = JSON.parse(readFileSync(`${ROOT}/package.json`, "utf8")) as {
    scripts?: Record<string, string>;
  };
  expect(root.scripts?.release, "the root package.json has a release script").toContain("release.mts");
});
