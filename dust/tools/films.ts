/**
 * Where a Dust film stops to be answered, and where it pays.
 *
 *   npx tsx dust/tools/films.ts abe.mov steps.mov
 *
 * A film that a script plays and then asks `if actionframe (1)` of pays only if
 * playback passed the frame its header names as action frame 1. Getting there
 * can take a click on each stop on the way: a stop is a frame that waits, with
 * rectangles that each jump to a frame. This prints both, so a sheet's
 * `film([x,y], …)` line can be read straight off it — one point inside the
 * rectangle that leads on, per stop, in order.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readMovFileV1 } from "@dreamfactory/engine/df/mov-v1";

const CD = fileURLToPath(new URL("../gamefiles/dustcd", import.meta.url));

/** films are not all in MOVIES/: the safe's are in CRACK/, the drugs' in DRUGS/ */
function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.mov$/i.test(e)) yield p;
  }
}
const films = [...walk(CD)];

for (const want of process.argv.slice(2)) {
  const path = films.find((f) => basename(f).toUpperCase() === want.toUpperCase());
  if (!path) {
    console.log(`${want}: no such film on the disc`);
    continue;
  }
  const name = basename(path);
  const mov = readMovFileV1(new Uint8Array(readFileSync(path)));
  for (const [i, seg] of mov.segments.entries()) {
    console.log(
      `${name} segment ${i}: ${seg.frames.length} frames, action frame 1 = ${seg.actionFrame1}, 2 = ${seg.actionFrame2}`,
    );
    for (const [f, frame] of seg.frames.entries()) {
      if (!frame.waitsForClick && !frame.regions.length) continue;
      const rs = frame.regions.map((r) => `(${r.left},${r.top})-(${r.right},${r.bottom}) → ${r.target}`);
      console.log(`  frame ${f} stops: ${rs.join("   ")}`);
    }
  }
}
