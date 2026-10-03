/**
 * Every set on the disc, read without playing a step of it: each move's frames
 * are there, each place a move arrives at has a move out of it, each standpoint
 * has its standing picture, each script reads, and each file a script names by
 * a literal is on the disc.
 *
 *   npx vitest run --project dust dust/tests/sets.ts
 *
 * The playthrough walks the ROUTE; this is the rest of all 29 sets — the cells
 * and turns no rung stands on, and the rooms, sounds and films the scripts ask
 * for by name. Seconds, and no game ticks. Skipped, not failed, without the
 * disc — the bargain every Dust suite makes.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { type V1Standpoint, readSetFileV1 } from "@dreamfactory/engine/df/set-v1";
import { scriptToText, sniffScript } from "@dreamfactory/engine/df/script";

const DISC = fileURLToPath(new URL("../gamefiles/dustcd", import.meta.url));
const have = existsSync(join(DISC, "DATA"));

/**
 * What the check finds and the disc ships so. It fails on one not listed, and
 * on one listed that has gone.
 */
const KNOWN = new Set([
  // the shooting range's keydown is the town's, and one of its views still
  // sends `gotointerior ("groc.set")` — the disc's general store is store.set
  "target.set names groc.set",
  // the mine carries no hi-res stills at all (no container in it is over
  // 60 KB; its neighbours' stills are 75-90 KB): the page stands on each move's
  // last frame there instead
  "mine.set has no stills",
  // hub.set alone stores a second copy of a move's six coordinates that does
  // not match the first, and slots whose frames overlap; the reader takes the
  // first copy, as on every other set, and the playthrough walks hub on it
  "hub.set: the reader warns",
]);

/** the extensions a script literal is taken to be a file by */
const NAMED = /"([\w .-]+\.(?:set|mov|snd|cst|prp|flt))"/gi;

/**
 * The authoring tool's empty scene scripts: eight zero bytes and no statement.
 * 892 of the sets' scene scripts are these; the session reads them as none.
 */
const isStub = (d: Uint8Array): boolean => d.length >= 8 && d.subarray(0, 8).every((b) => b === 0);

test.skipIf(!have)("every set's moves, pictures, scripts and named files are on the disc", () => {
  const index = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (!index.has(entry.toLowerCase())) index.set(entry.toLowerCase(), path);
    }
  };
  walk(DISC);
  // a name may be a SOUND in a bank rather than a file: `themevol ("saloonsep.snd")`
  // is an entry of every SALOON*.SND, and `closetrackfile ("hex.snd")` names the
  // bank SNAKE.SND calls itself
  const banks = [...index]
    .filter(([n]) => n.endsWith(".snd"))
    .map(([, p]) => readFileSync(p).toString("latin1").toLowerCase())
    .join("\n");

  const sets = [...index.keys()].filter((n) => n.endsWith(".set"));
  const found: string[] = [];
  let moves = 0;
  let scripts = 0;
  const key = (s: V1Standpoint): string => `${s.x},${s.z},${s.facing}`;

  for (const name of sets) {
    const set = readSetFileV1(new Uint8Array(readFileSync(index.get(name)!)));
    const has = (c: number): boolean => !!set.file.containers[c];
    if (set.warnings.length) found.push(`${name}: the reader warns`);

    const departs = new Set(set.transitions.map((t) => key(t.from)));
    const stills = new Map<string, number>();
    for (const t of set.transitions) {
      moves++;
      for (const f of t.frames) if (!has(f)) found.push(`${name}: ${key(t.from)} to ${key(t.to)} has no frame ${f}`);
      if (!t.frames.length) found.push(`${name}: ${key(t.from)} to ${key(t.to)} has no frames`);
      if (!departs.has(key(t.to))) found.push(`${name}: ${key(t.to)} is a dead end`);
      if (t.departureStill >= 0) {
        stills.set(key(t.from), (stills.get(key(t.from)) ?? 0) + 1);
        if (!has(t.departureStill)) found.push(`${name}: ${key(t.from)} has no still ${t.departureStill}`);
      }
    }
    if (set.transitions.length && !stills.size) found.push(`${name} has no stills`);
    else for (const at of departs) if (stills.get(at) !== 1) found.push(`${name}: ${at} has ${stills.get(at) ?? 0} stills`);
    const start = key({ x: set.defaultCellX, z: set.defaultCellZ, facing: set.defaultFacing });
    if (set.transitions.length && !departs.has(start)) found.push(`${name}: the default standpoint ${start} has no move`);

    for (const at of [set.mainScript, ...set.scenes.map((s) => s.scriptLocation)]) {
      if (!at) continue;
      const data = set.file.containers[at]?.data;
      const tokens = data ? sniffScript(data) : null;
      if (!tokens) {
        if (!data || !isStub(data)) found.push(`${name}: script ${at} does not read`);
        continue;
      }
      scripts++;
      for (const m of scriptToText(tokens).matchAll(NAMED)) {
        const named = m[1].toLowerCase();
        if (!index.has(named) && !banks.includes(named)) found.push(`${name} names ${named}`);
      }
    }
  }

  expect(sets.length, "no sets indexed").toBeGreaterThan(20);
  expect(moves, "no moves read").toBeGreaterThan(2000);
  expect(scripts, "no scripts read").toBeGreaterThan(100);
  const unique = [...new Set(found)];
  expect(unique.filter((f) => !KNOWN.has(f)), "a set reaching for something that is not there").toEqual([]);
  expect([...KNOWN].filter((k) => !unique.includes(k)), "a known gap that is gone").toEqual([]);
});
