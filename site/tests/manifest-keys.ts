/**
 * A manifest's keys are paths as SERVED, whichever directory it was written from.
 *
 *   npx vitest run site/tests/manifest-keys.ts
 *
 * `tools/manifest.ts` promises the shape — *"keys are paths as served, without a
 * leading slash — the game's own files keep their `gamefiles/` prefix and this
 * port's authored assets do not"* — and every page's store depends on it exactly:
 *
 *     if (!path.startsWith("gamefiles/")) continue;
 *
 * `buildManifest` keys by the path it WALKED, which is the right thing for a
 * library and the wrong thing for a caller who walked from somewhere else. Run
 * from inside a game's directory with `./gamefiles` — the on-host form in
 * `mkmanifest.ts`'s own examples — the walked path and the served path are the
 * same string. Run from the repository root with `skullcracker/gamefiles`, which
 * is what `npm run manifest*` does, every key came out `skullcracker/gamefiles/…`
 * and the page indexed **nothing**: a manifest that parses, reports 113 files and
 * matches none of them. `mkmanifest.ts` normalises the prefix now, the way
 * `tools/vite-gamefiles.ts` already did for the build.
 *
 * This spawns the real script over a small tree rather than testing the library,
 * because the library was never wrong — the two callers disagreeing was.
 */
import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** a rip-shaped tree with one authored file beside it, and its manifest */
function manifestOf(from: "the root" | "inside the game"): Record<string, number> {
  const tmp = mkdtempSync(join(tmpdir(), "df-manifest-"));
  const game = join(tmp, "agame");
  mkdirSync(join(game, "gamefiles", "DISC", "DATA"), { recursive: true });
  mkdirSync(join(game, "public"), { recursive: true });
  mkdirSync(join(game, "out"), { recursive: true });
  writeFileSync(join(game, "gamefiles", "DISC", "DATA", "LEVEL.SBK"), "x".repeat(64));
  // a directory the walk must skip, and a file it must not list
  mkdirSync(join(game, "gamefiles", "DISC", "install"), { recursive: true });
  writeFileSync(join(game, "gamefiles", "DISC", "install", "SETUP.EXE"), "x");
  // this port's own authored DF file, served at the root and so listed bare
  writeFileSync(join(game, "public", "lang.stg"), "x".repeat(8));

  const script = join(ROOT, "tools/mkmanifest.ts");
  const args =
    from === "the root"
      ? ["tsx", script, "agame/out", "agame/gamefiles", "agame/public"]
      : ["tsx", script, "./out", "./gamefiles", "./public"];
  execFileSync("npx", args, { cwd: from === "the root" ? tmp : game, stdio: "pipe" });
  return JSON.parse(readFileSync(join(game, "out", "gamefiles.json"), "utf8")) as Record<string, number>;
}

test("written from the repository root, the keys are still served paths", () => {
  const m = manifestOf("the root");
  expect(m["gamefiles/DISC/DATA/LEVEL.SBK"]).toBe(64);
  // the bug this exists for: nothing keyed by the directory the walk started in
  expect(Object.keys(m).filter((k) => k.startsWith("agame/"))).toEqual([]);
});

test("written from inside the game, the keys are the same", () => {
  const m = manifestOf("inside the game");
  expect(m["gamefiles/DISC/DATA/LEVEL.SBK"]).toBe(64);
});

test("the authored files stay bare, and the installer stays out", () => {
  for (const where of ["the root", "inside the game"] as const) {
    const m = manifestOf(where);
    expect(m["lang.stg"], `${where}: an authored file is served at the root`).toBe(8);
    expect(
      Object.keys(m).some((k) => /install/i.test(k)),
      `${where}: the installer's tree is not game data`,
    ).toBe(false);
  }
});
