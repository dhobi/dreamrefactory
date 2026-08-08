/**
 * Write the gamefiles manifest — the one file a static deployment needs that a
 * directory listing used to provide.
 *
 *   npx tsx tools/mkmanifest.ts [outDir] [gamefilesDir]
 *   npx tsx tools/mkmanifest.ts dist                     # after `npm run build`
 *   npx tsx tools/mkmanifest.ts /var/www/taoot /mnt/cds  # against an uploaded tree
 *
 * `npm run build` already emits it (see the plugin in vite.config.ts), so this is
 * for the case that plugin cannot cover: game data uploaded to the host AFTER the
 * build, or a deployment carrying a different set of editions from the machine
 * that built the pages. The manifest describes the tree it is written next to, so
 * it has to be generated wherever that tree finally lives.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MANIFEST_FILE, buildManifest } from "./manifest";

const [, , outDir = "dist", gamefiles = "gamefiles"] = process.argv;
const manifest = buildManifest({ gamefiles });
const at = join(outDir, MANIFEST_FILE);
const json = JSON.stringify(manifest);
writeFileSync(at, json);

const bytes = Object.values(manifest).reduce((n, s) => n + s, 0);
const mb = (n: number): string => (n / (1024 * 1024)).toFixed(1);
console.log(
  `${at}: ${Object.keys(manifest).length} files, ${mb(bytes)} MB of data, ` +
    `manifest ${(json.length / 1024).toFixed(0)} KB`,
);
if (!Object.keys(manifest).length) {
  console.log(`(nothing under ${gamefiles}/ — the pages will offer upload only)`);
}
