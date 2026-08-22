/**
 * The two things a page needs from its game's `gamefiles/` — a listing of what
 * is there, and the bytes themselves — and how each is answered in dev and in a
 * static build. One plugin, used by every package that serves game data, told
 * where that data is.
 *
 * The LISTING is the manifest (tools/manifest.ts): served live here so a dev
 * server picks up a tree that changed without a rebuild, and written into the
 * build output at build time so a deployment needs no server at all. It used to
 * be `/api/gamefiles`, which made the site look like it wanted a backend when
 * the only dynamic thing about it was a directory walk.
 *
 * The BYTES are Vite's job in dev, except that its transform middleware 500s on
 * extension-less paths like `/gamefiles/en/titanic1/data/bootfile` (it tries to
 * load them as modules), so they are streamed below instead. A static host has
 * no transform step and every consumer reads `arrayBuffer()`, so nothing there
 * needs replacing — the files are uploaded at the paths the manifest names.
 *
 * `gamefiles/` itself is NEVER bundled: it is a CD rip, it is gitignored, and a
 * static deployment carries it beside the build output rather than inside it.
 *
 * ## One tree per game
 *
 * There used to be one walk producing two files — the full index, and a
 * `gamefiles-dust.json` that was the same walk filtered to keys beginning
 * `gamefiles/dust/`. Two games in one tree needed that; two games in two trees
 * do not. Each package now walks its own rip and writes its own
 * `gamefiles.json` at its own site root, and the filter is gone.
 *
 * Paths come in ABSOLUTE, resolved by the caller from its own config file's
 * location rather than from the working directory — `npm run build -w` and
 * `vite build --config …/vite.config.ts` have different ideas about cwd, and a
 * rip that silently resolves to nothing produces a manifest with no game in it.
 */
import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import type { Plugin } from "vite";
import { MANIFEST_FILE, MANIFEST_URL, buildManifest } from "./manifest";

export interface GamefilesOptions {
  /** absolute path to this game's rip */
  gamefiles: string;
  /** absolute path to the package's `public/`, whose authored DF files are listed too */
  publicDir: string;
  /**
   * A path to hang both routes under, for a package serving a rip that is not
   * its own. Empty for a game serving its own data; `/taoot` for the editors,
   * whose pages resolve their data against Titanic's site root rather than
   * their own (see site/vite.config.ts).
   */
  mount?: string;
  /**
   * Write `gamefiles.json` into the build output. False for a package that
   * BORROWS a rip: the manifest belongs to whoever owns the tree, and two
   * builds writing one file is how they disagree.
   */
  emit?: boolean;
}

export function gamefilesManifest(opts: GamefilesOptions): Plugin {
  const prefix = "gamefiles";
  const mount = opts.mount ?? "";
  const emit = opts.emit ?? true;
  // dev runs the closeBundle hook too (a closing server is a closed bundle as
  // far as rollup is concerned), and a dev server has no business writing into
  // the build output
  let building = false;
  let outDir = "dist";

  const walk = (): Record<string, number> => {
    const full = buildManifest({ gamefiles: opts.gamefiles, publicDir: opts.publicDir });
    // buildManifest keys by the path it walked, which is absolute here; the
    // pages ask for them relative to their own site root
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(full)) {
      const norm = k.replace(/\\/g, "/");
      out[norm.startsWith(opts.gamefiles.replace(/\\/g, "/"))
        ? prefix + norm.slice(opts.gamefiles.replace(/\\/g, "/").length)
        : norm] = v;
    }
    return out;
  };

  return {
    name: "gamefiles-manifest",
    configResolved(config) {
      building = config.command === "build";
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use(mount + MANIFEST_URL, (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store"); // a tree can change under it
        res.end(JSON.stringify(walk()));
      });

      const rootDir = resolve(opts.gamefiles);
      server.middlewares.use(`${mount}/${prefix}`, (req, res, next) => {
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
    /**
     * ...and the same walk as a file, so a build produces a site that needs
     * nothing but a file server. Written rather than emitted as an asset because
     * it describes the tree on THIS machine — a deployment whose game data is
     * uploaded separately regenerates it there with `tools/mkmanifest.ts`, and
     * that has to be able to overwrite this.
     *
     * `writeBundle` and NOT `closeBundle`: rollup calls closeBundle even when the
     * build FAILED, so writing there turned every genuine build error into this
     * plugin's ENOENT on an output directory the failed build never created — and
     * the message that mattered was never printed.
     */
    writeBundle() {
      if (!building || !emit) return;
      const manifest = walk();
      const out = join(outDir, MANIFEST_FILE);
      const json = JSON.stringify(manifest);
      writeFileSync(out, json);
      this.info?.(
        `${out}: ${Object.keys(manifest).length} files, ${(json.length / 1024).toFixed(0)} KB`,
      );
    },
  };
}
