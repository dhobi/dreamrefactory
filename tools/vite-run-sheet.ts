/**
 * A game's speedrun route, served in dev and emitted into the build.
 *
 * The sheet is a test fixture — `<game>/tests/speedrun/run.sheet.txt`, the route
 * the headless runner drives — and the workbench offers a "Copy the full run"
 * button that starts you from it rather than from an empty sheet. It stays in
 * `tests/` because that is where it is run from, and is copied out at build time
 * rather than moved, which would cost every path that names it.
 *
 * Shared rather than written twice: it began in `taoot/vite.config.ts` and Dust
 * grew a route of its own, at which point two copies of the same middleware
 * would drift the moment one of them learned something. The only thing that
 * differs between the games is where the fixture sits, so that is the argument.
 *
 * No sheet is a valid state and not an error — a game without a route serves no
 * file, the page's fetch fails, and the panel simply offers no button. That is
 * what Dust looked like before it had one.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

/** where the page asks for it, relative to the game's own root */
const SHEET_URL = "/speedrun/run.sheet.txt";
/** where the page asks for the contributed sheets, all in one file */
const SHEETS_URL = "/speedrun/sheets.json";

/**
 * The contributed sheets (`<game>/speedrun/sheets/*.sheet.txt`), as
 * `[{ file, text }]` in file order. The text whole: a sheet is a few dozen KB,
 * and the page reads each one's header (its first line is its title) itself,
 * with the same code the CI check uses — engine/src/web/speedrun/sheet-header.ts.
 */
function contributed(dir: string): string {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".sheet.txt")).sort() : [];
  return JSON.stringify(files.map((file) => ({ file, text: readFileSync(join(dir, file), "utf8") })));
}

/** `src` is the route; `sheetsDir`, if the game takes contributions, is where they are */
export function runSheet(src: string, sheetsDir?: string): Plugin {
  return {
    name: "run-sheet",
    configureServer(server) {
      server.middlewares.use(SHEET_URL, (_req, res, next) => {
        if (!existsSync(src)) return next();
        res.setHeader("content-type", "text/plain; charset=utf-8");
        // it is edited constantly; a cached copy is worse than a fetch
        res.setHeader("cache-control", "no-store");
        res.end(readFileSync(src));
      });
      if (sheetsDir) {
        server.middlewares.use(SHEETS_URL, (_req, res) => {
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.setHeader("cache-control", "no-store");
          res.end(contributed(sheetsDir));
        });
      }
    },
    /**
     * Emitted rather than written, so it lands under the build output wherever
     * that is and shows up in the build log with everything else. `fileName` and
     * not `name`, because this one must NOT be content-hashed: the page asks for
     * it by the path above.
     */
    generateBundle() {
      if (sheetsDir) this.emitFile({ type: "asset", fileName: "speedrun/sheets.json", source: contributed(sheetsDir) });
      if (!existsSync(src)) return; // no sheet, no button — a valid build
      this.emitFile({
        type: "asset",
        fileName: "speedrun/run.sheet.txt",
        source: readFileSync(src, "utf8"),
      });
    },
  };
}
