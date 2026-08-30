/**
 * Is a v1 movie's action frame reachable — and is the header 1-based or 0-based?
 *
 *   npx tsx dust/tools/actionframes.ts
 *   npx tsx dust/tools/actionframes.ts --verbose
 *
 * `actionframe (n)` is how a Dust script asks "did the film get as far as the
 * bit that matters?", and the answer decides whether you keep what the film was
 * about: MAYSTUDY's postcards and the stagecoach's bullets are both `if
 * actionframe (1)`. The header names that frame by POSITION, and
 * [`mov-v1.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/mov-v1.ts)
 * reads the position as 1-based on the evidence of DIARY.MOV — whose click goto
 * skips its own frame 2, so a 0-based reading could never fire.
 *
 * `ABE.MOV` says the opposite. Its frame 15 waits for a click and both of its
 * hotspots jump PAST the frame a 1-based reading names, so under that reading
 * the trade at the stagecoach depot can never complete — and the shipped saves
 * show the original completing it.
 *
 * One file each way is not an answer, so this asks the whole disc: for every
 * movie with an action frame, is that frame reachable — under each reading — by
 * any path a player could take? A frame is reachable if something targets it:
 * the previous frame falling through (a frame that WAITS never falls through),
 * or a hotspot goto naming it.
 *
 * The verdict at the bottom is the point. Needs the rip and nothing else.
 */
import { existsSync, readFileSync } from "node:fs";
import { readMovFileV1, type MovFrameV1, type MovSegmentV1 } from "@dreamfactory/engine/df/mov-v1";
import { indexDisc } from "../tests/playthrough/harness";

const verbose = process.argv.includes("--verbose");

/**
 * Every frame index a play can arrive at.
 *
 * Frame 0 counts, and forgetting that is how a first draft of this tool
 * "disproved" the 1-based reading: DIARY.MOV's action frame IS its first frame
 * — "the diary was seen" is true the moment the film starts — and nothing
 * targets a film's opening, so a targets-only reading called it unreachable and
 * indicted the very file the reading was inferred from.
 */
function reachable(frames: MovFrameV1[]): Set<number> {
  const hit = new Set<number>([0]);
  for (const f of frames) {
    // a frame that waits for a click never takes its own target
    if (!f.waitsForClick && f.action === 2) hit.add(f.target);
    for (const r of f.regions ?? []) if (r.type === 2) hit.add(r.target);
  }
  return hit;
}

const index = indexDisc();
if (!index.size) {
  console.error("no disc found — this needs the Dust rip");
  process.exit(1);
}

let withAction = 0;
let oneBasedOk = 0;
let zeroBasedOk = 0;
const disagree: string[] = [];

for (const [name, path] of [...index].sort()) {
  if (!name.endsWith(".mov") || !existsSync(path)) continue;
  let segs: MovSegmentV1[];
  try {
    segs = readMovFileV1(new Uint8Array(readFileSync(path))).segments;
  } catch {
    continue; // not a v1 movie this reader takes
  }
  for (const [s, seg] of segs.entries()) {
    if (seg.actionFrame1 < 1) continue;
    withAction++;
    const hit = reachable(seg.frames);
    // 1-based: the header's n names frames[n-1]. 0-based: it names frames[n].
    const one = hit.has(seg.actionFrame1 - 1);
    const zero = hit.has(seg.actionFrame1);
    if (one) oneBasedOk++;
    if (zero) zeroBasedOk++;
    if (one !== zero) disagree.push(`${name}${segs.length > 1 ? `#${s}` : ""} ${one ? "1-based only" : "0-based only"} (header ${seg.actionFrame1}, ${seg.frames.length} frames)`);
    if (verbose) {
      console.log(
        `${name.padEnd(16)}${segs.length > 1 ? `#${s}` : "  "} header=${String(seg.actionFrame1).padStart(3)} ` +
          `frames=${String(seg.frames.length).padStart(3)}  1-based:${one ? "reachable" : "   —     "}  0-based:${zero ? "reachable" : "   —     "}`,
      );
    }
  }
}

console.log(`\n${withAction} movie segment(s) name an action frame.`);
console.log(`  reachable read as 1-based: ${oneBasedOk}`);
console.log(`  reachable read as 0-based: ${zeroBasedOk}`);
if (disagree.length) {
  console.log(`\n${disagree.length} where the two readings disagree:`);
  for (const d of disagree.slice(0, 40)) console.log(`  ${d}`);
}
