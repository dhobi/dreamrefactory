/**
 * The one structural rule the whole layout rests on: a shared package may not
 * import a game.
 *
 *   npx vitest run site/tests/layering.ts
 *
 * Four packages, and the allowed edges point one way only:
 *
 *     engine   ← nothing. No DOM-free rule here (engine/src/web/ is full of DOM);
 *                the rule is that it knows about no particular game.
 *     site     ← engine. The chrome, the UI-language axis, the edition
 *                MECHANISM, and the registry of which games exist.
 *     taoot    ← engine, site
 *     dust     ← engine, site
 *
 * Nothing enforces this except this file. It is worth a test because breaking it
 * is a one-line accident with no symptom: an editor needs an edition list, the
 * nearest one is in a game, the import resolves, the build succeeds, and the
 * shared package now depends on a consumer. That happened once already — seven
 * editors reached into `@dreamfactory/taoot/editions` — and it took a registry
 * and a factory to undo.
 *
 * It lives here rather than in a game's suite because it is `site/`'s purity that
 * is load-bearing, and because a test may only be as high in the stack as the
 * things it imports; this one imports nothing but the filesystem.
 */
import { test, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** every package specifier a package's own sources reach for */
function packagesImportedBy(pkg: string): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      // a rip is not source, and neither is a build
      if (e === "gamefiles" || e === "node_modules" || e === "dist") continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(ts|mts|css|html)$/.test(e)) continue;
      // IMPORTS, not mentions: a static import's specifier, a dynamic import's
      // argument, and a CSS @import's target. Matching any occurrence of the
      // scope would lint prose instead of code — and this file's own header
      // names the edge it exists to forbid, so the first version of this test
      // failed on its own sentence, and the second on the comment explaining
      // the first. Hence no example specifier written out anywhere below.
      const src = readFileSync(p, "utf8");
      const specifier = /(?:from|import|@import)\s*\(?\s*["']@dreamfactory\/([a-z]+)/g;
      for (const [, name] of src.matchAll(specifier)) {
        if (name !== pkg) found.add(name);
      }
    }
  };
  walk(join(ROOT, pkg));
  return found;
}

const ALLOWED: Record<string, string[]> = {
  engine: [],
  site: ["engine"],
  taoot: ["engine", "site"],
  dust: ["engine", "site"],
  timelapse: ["engine", "site"],
};

for (const [pkg, allowed] of Object.entries(ALLOWED)) {
  test(`${pkg} imports only ${allowed.join(", ") || "itself"}`, () => {
    const actual = [...packagesImportedBy(pkg)].sort();
    const forbidden = actual.filter((a) => !allowed.includes(a));
    expect(
      forbidden,
      `${pkg}/ reaches into ${forbidden.join(", ")} — see the header of this file`,
    ).toEqual([]);
  });
}

test("the engine names no game", () => {
  // Its comments cite TAOOT and Dust constantly, and should: the machinery is
  // explained through the games it was recovered from. What it must not do is
  // IMPORT one, which the test above covers, or read one's environment.
  const specifiers = packagesImportedBy("engine");
  expect([...specifiers]).toEqual([]);
});
