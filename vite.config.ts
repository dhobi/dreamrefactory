import { defineConfig, Plugin } from "vite";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";

/**
 * Dev-only convenience: expose a listing of gamefiles/ so the app can offer
 * a set picker and lazy-load sibling resources over HTTP instead of manual
 * drag-and-drop. The game files themselves are served by Vite because they
 * live under the project root — dev server only, they are NOT bundled into
 * a production build.
 */
function gamefilesManifest(): Plugin {
  return {
    name: "gamefiles-manifest",
    configureServer(server) {
      server.middlewares.use("/api/gamefiles", (_req, res) => {
        const files: string[] = [];
        const walk = (dir: string): void => {
          let entries: string[];
          try {
            entries = readdirSync(dir);
          } catch {
            return;
          }
          for (const e of entries) {
            const p = join(dir, e);
            if (statSync(p).isDirectory()) walk(p);
            else files.push(p.replace(/\\/g, "/"));
          }
        };
        walk("gamefiles");
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(files));
      });

      // serve the game files as raw bytes ourselves: Vite's transform
      // middleware 500s on extension-less paths like /gamefiles/LOCAL/BOOTFILE
      // (it tries to load them as modules)
      const rootDir = resolve("gamefiles");
      server.middlewares.use("/gamefiles", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "").split("?")[0]);
        const path = normalize(join(rootDir, rel));
        if (!path.startsWith(rootDir) || !existsSync(path) || statSync(path).isDirectory()) {
          next();
          return;
        }
        res.setHeader("content-type", "application/octet-stream");
        res.setHeader("content-length", statSync(path).size);
        createReadStream(path).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [gamefilesManifest()],
});
