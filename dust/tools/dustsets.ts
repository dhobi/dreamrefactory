/**
 * Read every SET on the Dust CD through {@link readSetFileV1} and say what came
 * out — the diagnostic the v1 reader was built against.
 *
 *   npx tsx dust/tools/dustsets.ts
 *
 * The last line is the one that matters. `warnings` is not decoration: the reader
 * records everything it had to assume and could not confirm (a scene table it
 * could not find, an actor record that ran off the end, two transitions claiming
 * the same frame), so "29/29 with no warnings" is the whole test that the v1
 * layout is right and not merely plausible on one file.
 *
 * The two invariants worth watching, because they are what pinned the format:
 *
 *   - `scenes` equals the grid's area. BANK is 4x3 and has 12, COURT 4x5 and 20.
 *   - `moves` equals `cells * 8 + walks`. Eight turns per cell — four
 *     facings, each way round — and one record per walkable edge. TOWN: 52 * 8 +
 *     110 = 526. That arithmetic holding on all 29 sets is why a v1 set is read
 *     as a grid and a flat move table rather than as rings and roads.
 *   - `stills` equals the standpoint count. Each standpoint's hi-res standing
 *     view is carried by exactly one of the transitions leaving it, so anything
 *     short of all of them means the slot arithmetic is wrong somewhere.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readSetFileV1 } from "@dreamfactory/engine/df/set-v1";
import { readSetFileAsV4 } from "@dreamfactory/engine/df/set-v1-to-v4";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { decodeFrame, FrameBuffer } from "@dreamfactory/engine/df/image";
import { decodeAudioContainer } from "@dreamfactory/engine/df/audio";
import { RIGHTTURNS, LEFTTURNS } from "@dreamfactory/engine/df/set";

const DIR = process.argv[2] ?? "gamefiles/dustcd/DATA";
if (!existsSync(DIR)) {
  console.error(`no such directory: ${DIR}\nusage: npx tsx dust/tools/dustsets.ts [dir]`);
  process.exit(1);
}

const sets = readdirSync(DIR).filter((f) => f.toUpperCase().endsWith(".SET")).sort();
let clean = 0;
const seen = new Map<string, number>();

for (const s of sets) {
  try {
    const set = readSetFileV1(new Uint8Array(readFileSync(join(DIR, s))));
    const turns = set.transitions.filter((t) => t.kind === "turn").length;
    const walks = set.transitions.length - turns;
    const cells = new Set(set.transitions.map((t) => `${t.from.x},${t.from.z}`)).size;

    const runs = [...new Set(set.transitions.map((t) => t.frames.length))].sort((a, b) => a - b);
    // every standpoint should have exactly one hi-res standing view, carried by
    // one of the transitions departing it — see the header of set-v1.ts
    const stands = new Set(set.transitions.map((t) => `${t.from.x},${t.from.z},${t.from.facing}`));
    const withStill = new Set(
      set.transitions.filter((t) => t.departureStill >= 0)
        .map((t) => `${t.from.x},${t.from.z},${t.from.facing}`),
    );
    if (!set.warnings.length) clean++;
    for (const w of set.warnings) {
      const k = w.replace(/\d+/g, "N");
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    const area = set.gridWidth * set.gridHeight;
    console.log(
      `${s.padEnd(13)} ${JSON.stringify(set.setName).padEnd(12)} ` +
        `${set.gridWidth}x${set.gridHeight} vp=${set.viewPortWidth}x${set.viewPortHeight} ` +
        `scenes=${String(set.scenes.length).padStart(3)}${set.scenes.length === area ? " " : "?"} ` +
        `moves=${String(set.transitions.length).padStart(3)}` +
        `${set.transitions.length === cells * 8 + walks ? " " : "?"} ` +
        `(${turns}t/${walks}w) cells=${String(cells).padStart(2)} ` +
        `runs={${runs.join(",")}} stills=${String(withStill.size).padStart(3)}/${String(stands.size).padStart(3)}` +
        `${withStill.size === stands.size ? " " : "?"} cast=${String(set.actors.length).padStart(2)} ` +
        `clut=${set.cluts[0]?.name ?? "-"} ` +
        `opens=(${set.defaultCellX},${set.defaultCellZ})/${set.defaultFacing}` +
        (set.warnings.length ? `\n    !! ${set.warnings.slice(0, 3).join("; ")}` : ""),
    );
  } catch (e) {
    console.log(`${s.padEnd(13)} THREW ${(e as Error).message}`);
  }
}

console.log(`\n${clean}/${sets.length} sets read with no warnings`);

/**
 * The expensive half, which `set-v1.ts` promises and cannot afford.
 *
 * Its `couldRepaintAll` is two cheap necessary conditions on the hi-res still;
 * this decodes EVERY ring frame twice — once into a fresh buffer, once into a
 * poisoned one — and checks the property those conditions stand in for. A ring
 * frame is safe when it is a keyframe or when its ring predecessor is its own
 * file predecessor, and a frame that is neither is one the delta chain will draw
 * as garbage. That was a real symptom: right turns ended on a corrupt frame for
 * one interval before the hi-res settle covered it.
 */
let ringClean = 0;
for (const f of sets) {
  const bytes = new Uint8Array(readFileSync(join(DIR, f)));
  let set;
  try { set = readSetFileAsV4(bytes); } catch { continue; }
  const file = readContainerFile(bytes);
  const known = new Map<number, boolean>();
  const isKey = (loc: number): boolean => {
    const had = known.get(loc);
    if (had !== undefined) return had;
    const c = file.containers[loc];
    let ok = false;
    if (c && !c.gap && c.data.length >= 8) {
      const a = new FrameBuffer();
      const b = new FrameBuffer();
      b.ensure(512, 264);
      b.pixels.fill(0x5a);
      try {
        decodeFrame(c.data, a);
        decodeFrame(c.data, b);
        ok = a.width === b.width && a.height === b.height &&
          a.pixels.every((x, i) => x === b.pixels[i]);
      } catch { ok = false; }
    }
    known.set(loc, ok);
    return ok;
  };
  const bad: string[] = [];
  for (const sc of set.scenes.filter((x) => x.views.length)) {
    for (const d of [RIGHTTURNS, LEFTTURNS]) {
      const fr = sc.turns[d].frames;
      for (let i = 0; i < fr.length; i++) {
        const loc = fr[i].frameContainerLoc;
        if (i > 0 && loc === fr[i - 1].frameContainerLoc + 1) continue;
        if (isKey(loc)) continue;
        bad.push(`${sc.sceneName} ${d === RIGHTTURNS ? "right" : "left"}[${i}] c${loc}`);
      }
    }
  }
  if (!bad.length) ringClean++;
  else console.log(`  ${f}: ${bad.length} ring frames would decode without a base — ${bad.slice(0, 2).join(", ")}`);
}
console.log(`${ringClean}/${sets.length} sets: every ring frame is a keyframe or follows its own file predecessor`);

/**
 * ...and the rings turn a quarter at a time, with the art to match.
 *
 * A ring is `[motion x4, standpoint] * 4`, so its four standpoint headings must
 * step by exactly 64 (a right turn) or 192 (a left one) and its every segment
 * must have found a real turn record to take its frames from. This is where a
 * heading table that hands two facings the same bearing shows up, which it did on
 * 16 of the 29 sets: the ring came out 0, 192, 128, 128 — two of the four ways you
 * can look pointing the same way.
 */
let ringTurn = 0, segments = 0, noArt = 0;
for (const f of sets) {
  let set;
  try { set = readSetFileAsV4(new Uint8Array(readFileSync(join(DIR, f)))); } catch { continue; }
  const off: string[] = [];
  for (const sc of set.scenes.filter((x) => x.views.length)) {
    for (const d of [RIGHTTURNS, LEFTTURNS]) {
      const fr = sc.turns[d].frames;
      const stand = fr.filter((x) => x.motionInfo > 0).map((x) => x.axisX8);
      const want = d === RIGHTTURNS ? 64 : 192;
      if (stand.length !== 4 || !stand.every((h, i) => ((stand[(i + 1) % 4] - h) & 0xff) === want)) {
        off.push(`${sc.sceneName}/${d === RIGHTTURNS ? "R" : "L"}: ${stand.join(",")}`);
      }
      for (let i = 0; i + 5 <= fr.length; i += 5) {
        segments++;
        if (fr.slice(i, i + 5).some((x) => x.frameContainerLoc === 0)) noArt++;
      }
    }
  }
  if (!off.length) ringTurn++;
  else console.log(`  ${f}: ${off.length} rings do not turn a clean quarter — ${off.slice(0, 2).join(" | ")}`);
}
console.log(
  `${ringTurn}/${sets.length} sets: every ring turns a clean quarter each step` +
  ` (${segments} segments, ${noArt} with no art)`,
);

/**
 * ...and every standpoint's four views are named for the compass.
 *
 * Which is not cosmetic: Dust's scripts name a view 636 times and every one says
 * north, south, east or west, and every door in the town is behind one of those
 * comparisons. Under the old `view1`..`view4` not one of them could match, so no
 * interior was reachable and the dog at the top of the road let you walk straight
 * past. See COMPASS in engine/src/df/set-v1-to-v4.ts.
 */
let compass = 0;
for (const f of sets) {
  let set;
  try { set = readSetFileAsV4(new Uint8Array(readFileSync(join(DIR, f)))); } catch { continue; }
  const off = set.scenes
    .filter((sc) => sc.views.length)
    .filter((sc) => sc.views.map((v) => v.viewName).sort().join(",") !== "east,north,south,west");
  if (!off.length) compass++;
  else console.log(`  ${f}: ${off.length} standpoints without the four compass views`);
}
console.log(`${compass}/${sets.length} sets: every standpoint has a north, south, east and west`);
for (const [w, n] of [...seen].sort((a, b) => b[1] - a[1])) console.log(`  ${n}x ${w}`);

// ---------------------------------------------------------------------------
// The star register: the two arithmetic invariants that pinned its layout.
//
// A v1 star record is v4's four bytes shorter, which means it also carries the
// optional NESTED SECONDARY star and the container ref for the authored walking
// route between the pair (see `readActors` in set-v1.ts). Two checks, neither of
// which can pass by accident:
//
//   - every `fromPrev` on a polyline is the distance from the point before it;
//   - those distances sum to the total the container states in its own header.
//
// And one coverage number, which is what the whole thing was for: of the stars
// Dust's scripts NAME, how many exist. It was 81 of 84 with the secondaries and
// would be 61 without them — `gang.cst` puts Leroy on `town.leroy1`, and that is
// not a primary anywhere on the disc.
// ---------------------------------------------------------------------------
{
  const { readStarPath } = await import("@dreamfactory/engine/df/set");
  let primaries = 0, secondaries = 0, paths = 0, points = 0, legOk = 0, sumOk = 0;
  for (const f of sets) {
    let set;
    try { set = readSetFileV1(new Uint8Array(readFileSync(join(DIR, f)))); } catch { continue; }
    const secondaryOf = new Set(set.starPaths.map((p) => p.b.toLowerCase()));
    for (const a of set.actors) {
      if (secondaryOf.has(a.identifier.toLowerCase())) secondaries++;
      else primaries++;
    }
    for (const p of set.starPaths) {
      paths++;
      const pts = readStarPath(set.file.containers, p.container, 1);
      points += pts.length;
      const d = set.file.containers[p.container].data;
      const stated = new DataView(d.buffer, d.byteOffset, d.byteLength).getInt32(4, true);
      let sum = 0, worst = 0;
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x;
        const dy = pts[i].y - pts[i - 1].y;
        const dz = pts[i].z - pts[i - 1].z;
        worst = Math.max(worst, Math.abs(Math.round(Math.hypot(dx, dy, dz)) - pts[i].fromPrev));
        sum += pts[i].fromPrev;
      }
      if (pts.length >= 2 && worst <= 2) legOk++;
      else console.log(`  ${f} ${p.a}->${p.b}: leg length off by ${worst} over ${pts.length} points`);
      if (pts.length >= 2 && Math.abs(sum - stated) <= 2) sumOk++;
      else console.log(`  ${f} ${p.a}->${p.b}: legs sum to ${sum}, header says ${stated}`);
    }
  }
  console.log(
    `\n${primaries} primary stars + ${secondaries} nested secondaries over ${sets.length} sets`,
  );
  console.log(
    `${legOk}/${paths} authored paths (${points} points) have every leg length matching its own geometry`,
  );
  console.log(`${sumOk}/${paths} have leg lengths summing to the total in the header`);
}

// ---------------------------------------------------------------------------
// What Dust's scripts CALL that nothing here answers.
//
// The sweep that found `scenexyz` and the inventory's three drop tests, and the
// cheapest diagnostic on the disc: every name any script calls, against the names
// the interpreter registers and the 853 the game defines for itself. What is left
// is what the port has not written yet.
// ---------------------------------------------------------------------------
{
  const { sniffScript, scriptToText } = await import("@dreamfactory/engine/df/script");
  const { GameHost } = await import("@dreamfactory/engine/web/host");
  const { NullAudioSink } = await import("@dreamfactory/engine/runtime/audio");
  const KEYWORDS = new Set([
    "if", "for", "while", "switch", "case", "return", "code", "endcode", "local",
    "global", "not", "and", "or", "endif", "endwhile", "endfor", "endswitch",
    "else", "exitcode", "passcode", "true", "false", "plain",
  ]);
  const known = new Set<string>();
  const host = new GameHost(
    { provide: () => null, load: async () => null, setDisc: () => {} },
    new NullAudioSink(),
    { log: () => {} },
  );
  const interp = host.session.interp as unknown as Record<string, unknown>;
  for (const k of Object.keys(interp)) {
    const val = interp[k];
    if (val instanceof Map) for (const key of val.keys()) if (typeof key === "string") known.add(key.toLowerCase());
  }
  const defined = new Set<string>();
  const called = new Map<string, string>();
  const root = join(DIR, "..");
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );
  for (const p of walk(root)) {
    if (!/\.(SET|STG|PUP|SHP|CST|MOV|FLT|PRP)$/i.test(p) && !/bootfile$/i.test(p)) continue;
    let file;
    try { file = readContainerFile(new Uint8Array(readFileSync(p))); } catch { continue; }
    for (let i = 0; i < file.containers.length; i++) {
      const tk = sniffScript(file.containers[i].data);
      if (!tk) continue;
      let text: string;
      try { text = scriptToText(tk); } catch { continue; }
      for (const m of text.matchAll(/^code (\w+)/gm)) defined.add(m[1].toLowerCase());
      for (const m of text.matchAll(/\b([a-z][a-z0-9_]{2,})\s*\(/gi)) {
        const nm = m[1].toLowerCase();
        if (!called.has(nm)) called.set(nm, `${p.split("/").pop()} c${i}`);
      }
    }
  }
  const missing = [...called].filter(([n]) => !known.has(n) && !defined.has(n) && !KEYWORDS.has(n));
  console.log(
    `\n${called.size} names Dust's scripts call · ${known.size} the interpreter registers` +
    ` · ${defined.size} the game defines itself · ${missing.length} answered by nothing`,
  );
  for (const [n, where] of missing.sort()) console.log(`  ${n.padEnd(18)} first at ${where}`);
}

// ---------------------------------------------------------------------------
// Occlusion: does every frame carry a Z layer, and how deep is one level?
//
// The second question is answered by a WALK and nothing else, which is why it is
// trustworthy: a walk moves the camera exactly one cell — 256 units — along its
// heading, so a static thing straight ahead (screen column cx, where the lateral
// offset is zero whatever the focal length) is 256 units nearer at the far end and
// its level must drop by 256/scale. No projection assumption enters. The modal
// drop is 4 on the interior sets, hence 64 units per level; the two 15x15 town
// sets are excluded from that reading because what is straight ahead there is
// usually past the clip and so not a measurement.
// ---------------------------------------------------------------------------
{
  const W = 512, H = 264, CX = W / 2, BAND = 6;
  let framesWithZ = 0, framesWithout = 0, maxLevel = 0;
  const drops = new Map<number, number>();
  for (const f of sets) {
    const bytes = new Uint8Array(readFileSync(join(DIR, f)));
    let set;
    try { set = readSetFileV1(bytes); } catch { continue; }
    const file = readContainerFile(bytes);
    const stillOf = new Map<string, number>();
    for (const t of set.transitions) {
      if (t.departureStill >= 0) stillOf.set(`${t.from.x},${t.from.z},${t.from.facing}`, t.departureStill);
    }
    const want = new Set(stillOf.values());
    const deepest = new Map<number, number>();
    const fb = new FrameBuffer();
    for (let i = 0; i < file.containers.length; i++) {
      const c = file.containers[i];
      if (c.gap || c.data.length < 8) continue;
      let d;
      try { d = decodeFrame(c.data, fb); } catch { continue; }
      if (d.width !== W || d.height !== H) continue;
      if (d.hasZ) framesWithZ++; else framesWithout++;
      if (!want.has(i)) continue;
      let max = 0;
      for (let y = 0; y < H; y++) {
        for (let x = CX - BAND; x <= CX + BAND; x++) {
          const lv = fb.zPixels[y * W + x];
          if (lv > maxLevel) maxLevel = lv;
          if (lv < 24 && lv > max) max = lv;   // 24 is the clamp, not a reading
        }
      }
      deepest.set(i, max);
    }
    // the 15x15 town and its night twin see past the clip down every street
    if (set.gridWidth >= 15) continue;
    for (const t of set.transitions) {
      if (t.kind !== "walk") continue;
      const a = stillOf.get(`${t.from.x},${t.from.z},${t.from.facing}`);
      const b = stillOf.get(`${t.to.x},${t.to.z},${t.to.facing}`);
      if (a === undefined || b === undefined) continue;
      const d = (deepest.get(a) ?? 0) - (deepest.get(b) ?? 0);
      if (d > 0) drops.set(d, (drops.get(d) ?? 0) + 1);
    }
  }
  const ranked = [...drops].sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((n, [, c]) => n + c, 0);
  console.log(
    `\n${framesWithZ} room frames carry a Z layer, ${framesWithout} do not · deepest level ${maxLevel}`,
  );
  console.log(
    `one cell of camera travel drops the deepest centre-axis level by ` +
    ranked.slice(0, 4).map(([d, n]) => `${d} on ${n}`).join(", ") +
    ` of ${total} walks -> ${(256 / (ranked[0]?.[0] ?? 1)).toFixed(0)} units per level`,
  );
}

// ---------------------------------------------------------------------------
// The puppets — the conversation faces. A v1 puppet has ONE stance and container
// 3 IS it (v4 keeps a directory of up to 64), so "stances" is the column that
// says the version gate is right; the rest is the art resolving.
// ---------------------------------------------------------------------------
{
  const { readPupFile, readAnimLogic } = await import("@dreamfactory/engine/df/pup");
  const { decodeShpFrame } = await import("@dreamfactory/engine/df/shp");
  const pupDirs = [join(DIR, "..", "PUPPETS"), DIR];
  const pups = pupDirs.flatMap((d) => {
    try { return readdirSync(d).filter((f) => f.toUpperCase().endsWith(".PUP")).map((f) => join(d, f)); }
    catch { return []; }
  }).sort();
  if (pups.length) {
    let oneStance = 0, layersOk = 0, bandOk = 0, animOk = 0;
    let lines = 0, layerFrames = 0;
    for (const p of pups) {
      let pup;
      try { pup = readPupFile(new Uint8Array(readFileSync(p))); } catch (e) {
        console.log(`  ${p.split("/").pop()}: THREW ${(e as Error).message}`);
        continue;
      }
      lines += pup.dialogue.size;
      if (pup.stances.length === 1) oneStance++;
      let good = 0, missing = 0;
      for (const l of pup.stances[0]?.layers ?? []) {
        for (const loc of l.frames) {
          const d = pup.file.containers[loc]?.data;
          if (!d) { missing++; continue; }
          try { decodeShpFrame(d); good++; } catch { missing++; }
        }
      }
      layerFrames += good;
      if (good && !missing) layersOk++;
      else console.log(`  ${p.split("/").pop()}: ${good} layer frames decode, ${missing} do not`);
      try {
        const b = decodeShpFrame(pup.file.containers[pup.bandLocation].data);
        if (b.width === 512 && b.height === 120) bandOk++;
      } catch { /* counted by omission */ }
      const first = pup.dialogue.values().next().value;
      if (first && readAnimLogic(pup, first.animLogicLocation).length) animOk++;
    }
    console.log(`\n=== puppets (${pups.length}) · ${lines} dialogue lines · ${layerFrames} layer frames`);
    console.log(`  ${oneStance}/${pups.length} have exactly one stance (container 3)`);
    console.log(`  ${layersOk}/${pups.length} have every stance layer frame decoding`);
    console.log(`  ${bandOk}/${pups.length} carry a 512x120 interface band`);
    console.log(`  ${animOk}/${pups.length} resolve their first line's animation logic`);
  }
}

// ---------------------------------------------------------------------------
// The sound banks, through the same "warnings are the test" rule.
// ---------------------------------------------------------------------------
const { readSndFile } = await import("@dreamfactory/engine/df/snd");
const { readMovFileV1 } = await import("@dreamfactory/engine/df/mov-v1");
const sndDir = DIR;
const snds = readdirSync(sndDir).filter((f) => f.toUpperCase().endsWith(".SND")).sort();
if (snds.length) {
  console.log(`\n=== sound banks in ${sndDir}`);
  let sndClean = 0;
  for (const s of snds) {
    try {
      const snd = readSndFile(new Uint8Array(readFileSync(join(sndDir, s))));
      if (!snd.warnings.length) sndClean++;
      console.log(
        `${s.padEnd(14)} ${JSON.stringify(snd.refName).padEnd(16)} sounds=${String(snd.chunks.length).padStart(3)} ` +
          `[${snd.chunks.slice(0, 4).map((c) => c.identifier).join(", ")}]` +
          (snd.warnings.length ? `\n    !! ${snd.warnings.slice(0, 2).join("; ")}` : ""),
      );
    } catch (e) {
      console.log(`${s.padEnd(14)} THREW ${(e as Error).message}`);
    }
  }
  console.log(`\n${sndClean}/${snds.length} banks read with no warnings`);
}

// ---------------------------------------------------------------------------
// The movies. `unaccounted` is the number that matters: a picture no segment's
// frame table names is film this reader is not looking at. Following the segment
// chain at header 0x36 took INTRO.MOV's from 502 to 0, and reading each table's
// short final record as the frame it is (rather than as a terminator) took the
// disc-wide figure from 291 to 0. It should be 0.
//
// Then the click regions, which are what make a film STOP and wait for you. Every
// one of the 329 on the disc is type 2, and the frame each names is a POSITION and
// not an index — 168 of them land on the frame whose action is EXIT, i.e. the frame
// the film ends on, which is exactly the frame a click is for. Read as an index
// only 53 do. See the module comment in df/mov-v1.ts.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// The scene table's own shape, which is what says each standpoint has its OWN
// script. The record is [z][x][8][name 16][script 4], so the ref is at the END —
// read from the front, every cell ran its neighbour's script (see set-v1.ts).
// Two invariants pin it: with the record ending at +32 the table finishes exactly
// at the end of container 0, and the i32 in front of it is the scene count.
// ---------------------------------------------------------------------------
{
  let ends = 0, counted = 0, refsIn = 0, refs = 0, n = 0;
  for (const f of sets) {
    const bytes = new Uint8Array(readFileSync(join(DIR, f)));
    const set = readSetFileV1(bytes);
    if (!set.scenes.length) continue;
    n++;
    const file = readContainerFile(bytes);
    const c0 = file.containers[0].data;
    const v = new DataView(c0.buffer, c0.byteOffset, c0.byteLength);
    const firstName = set.scenes[0].record + 16;
    if (firstName + (set.scenes.length - 1) * 32 + 20 === c0.length) ends++;
    if (v.getInt32(firstName - 16, true) === set.scenes.length) counted++;
    for (const sc of set.scenes) {
      refs++;
      if (sc.scriptLocation >= 0 && sc.scriptLocation < file.containers.length) refsIn++;
    }
  }
  console.log(`\n${ends}/${n} sets: the scene table ends exactly at the end of container 0`);
  console.log(`${counted}/${n} sets: the i32 in front of it is the scene count`);
  console.log(`${refsIn}/${refs} scene script refs are inside the file`);
}

const movDirs = [join(DIR, "..", "MOVIES"), DIR];
const movs = movDirs.flatMap((d) => {
  try {
    return readdirSync(d).filter((f) => f.toUpperCase().endsWith(".MOV")).map((f) => join(d, f));
  } catch {
    return [];
  }
}).sort();
if (movs.length) {
  console.log(`\n=== movies (${movs.length})`);
  let movClean = 0, movThrew = 0, multi = 0, frames = 0, seconds = 0, exits = 0, voice = 0;
  let unnamed = 0, segs = 0;
  let interactive = 0, regions = 0, waitFrames = 0, clickSounds = 0, onExit = 0, wholePicture = 0;
  let scored = 0, chunks = 0, audioSec = 0, interactiveScored = 0;
  for (const m of movs) {
    try {
      const mov = readMovFileV1(new Uint8Array(readFileSync(m)));
      if (!mov.warnings.length) movClean++;
      unnamed += mov.unaccounted;
      segs += mov.segments.length;
      if (mov.segments.length > 1) multi++;
      for (const sg of mov.segments) {
        frames += sg.frames.length;
        for (const f of sg.frames) seconds += (Math.max(f.holdTicks, sg.framerate) * 50) / 3000;
        if (sg.audioChunks.length) {
          scored++;
          chunks += sg.audioChunks.length;
          for (const loc of sg.audioChunks) {
            const a = decodeAudioContainer(mov.file.containers[loc].data);
            audioSec += a.samples.length / a.sampleRate;
          }
          if (sg.frames.some((f) => f.regions.length)) interactiveScored++;
        }
        const held = sg.frames.filter((f) => f.regions.length);
        if (held.length) interactive++;
        waitFrames += held.length;
        for (const f of held) {
          regions += f.regions.length;
          if (f.action === 1) onExit += f.regions.length;
          clickSounds += f.regions.filter((r) => r.sound > 0).length;
          wholePicture += f.regions.filter(
            (r) => r.top <= 1 && r.left <= 1 &&
              r.bottom >= (sg.height || 264) - 1 && r.right >= (sg.width || 512) - 1,
          ).length;
        }
      }
      // WHERE THE FILM STOPS, which is not its last record. Play order: the
      // first frame that carries a click region halts there and waits; failing
      // that, the first that exits or chains out. The final record of every
      const all = mov.segments.flatMap((sg) => sg.frames);
      const stop = all.find((f) => f.waitsForClick && f.regions.length) ??
        all.find((f) => f.action === 1 || f.action === 3);
      if (stop) exits++;
      if (stop && stop.waitsForVoice) voice++;
    } catch {
      movThrew++;
    }
  }
  console.log(`  ${movClean}/${movs.length} read with no warnings`);
  console.log(`  ${unnamed} pictures no segment names, against ${segs} segments`);
  console.log(`  ${multi}/${movs.length} are more than one segment · ${frames} frames · ${Math.round(seconds)}s of film`);
  console.log(`  ${exits}/${movs.length} halt on an authored frame (a click region, an exit or a chain-out)` +
    ` · ${voice} of those also wait for the voice`);
  console.log(`  ${interactive}/${segs} segments stop for a click · ${regions} regions on ${waitFrames} frames` +
    ` · ${onExit} of them on the frame the film ends on`);
  console.log(`  ${scored}/${segs} segments carry a soundtrack · ${chunks} chunks · ${Math.round(audioSec)}s of sound` +
    ` · ${interactiveScored} of them under a segment that stops for a click`);
  console.log(`  ${clickSounds} regions carry a click sound, ${regions - clickSounds} are silent` +
    ` · ${wholePicture} cover the whole picture (click anywhere to dismiss)`);
  console.log(`  ${movThrew}/${movs.length} would not open at all (the odd-fourCC files)`);
}
