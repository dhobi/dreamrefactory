/**
 * Every stage's map, read off the discs without playing a step of it: each way
 * out of every frame, on all four discs, goes somewhere that exists.
 *
 *   npm test -w timelapse -- stages
 *
 * The world suites walk the ROUTE — the frames a player who wins has to stand
 * on. This is the rest of the map, which none of them reaches: every stage's
 * `getframeaction` table (`nav.ts` reads it), every word in it a verb that
 * `transitionaction` knows, every `J`/`TL`/`TR`/`G`/`S` landing on a flat its
 * stage has, and every hotspot that moves you by script (`gotostage`,
 * `jumptoframe`, `gotoregion`) the same. Seconds, and no game ticks.
 *
 * A table may carry cases for frames its stage does not have — a005's runs
 * 200 to 911 beside flats 604 to 919, copied from a stage it was built from —
 * and nobody can stand on those, so only the frames a stage HAS are asked.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { readStgFile, readStgRegions } from "@dreamfactory/engine/df/stg";
import { sniffScript } from "@dreamfactory/engine/df/script";
import { haveRip, indexDiscs } from "./harness";
import { type Discs, hotspotsOf, stageFile, tableOf, target } from "./nav";

/**
 * The ways out that lead nowhere, each read in the stage's own script. The
 * check fails on one not listed here, and on one listed that has gone.
 */
const KNOWN = new Set([
  // the switch has `case 100` and `case 102` twice; the first of each answers,
  // so these words in the second are never returned
  "a035.stg 100 G.1.530",
  "a035.stg 102 G.1.529",
  // the game's own: left and right off frame 604 name frames no Indus stage
  // has (`return ("X J.263 J.363 J.463 X X ")`)
  "i004.stg 604 J.363",
  "i004.stg 604 J.463",
  // the game's own: forward from 958 with the lantern NOT lit is `J.862`, and
  // 862 is i005's — the lit branch beside it says `S.5.1.962`
  "i006.stg 958 J.862",
]);

/** `transitionaction`'s verbs (BOOTFILE), and `L2`/`R2`, the two-turn ways */
const VERBS = new Set(["J", "TL", "TR", "G", "S", "X", "L2", "R2"]);

test.skipIf(!haveRip())("every way out of every frame lands on a frame", () => {
  const index = indexDiscs();
  const discs: Discs = { file: (n) => (index.has(n) ? new Uint8Array(readFileSync(index.get(n)!)) : null) };
  const frames = new Map<string, Set<number>>();
  const framesOf = (world: string, stage: number): Set<number> => {
    const name = stageFile(world, stage);
    let got = frames.get(name);
    if (!got) {
      const bytes = discs.file(name);
      got = new Set(bytes ? readStgFile(bytes).flats.map((f) => Number(/^\w\d{4}\.(\d+)/.exec(f.name)?.[1])) : []);
      frames.set(name, got);
    }
    return got;
  };

  const stages = [...index.keys()].filter((n) => /^[a-z]\d{3}\.stg$/.test(n)).sort();
  const nowhere: string[] = [];
  const strange: string[] = [];
  const unparsed: string[] = [];
  let ways = 0;
  for (const name of stages) {
    const world = name[0];
    const stage = Number(name.slice(1, 4));
    const has = framesOf(world, stage);
    for (const [frame, answers] of tableOf(discs, world, stage)) {
      if (!has.has(frame)) continue;
      for (const word of answers.flat()) {
        // a word built at run time keeps "?" where the script computes it
        if (word.includes("?")) continue;
        if (!VERBS.has(word.split(".")[0].toUpperCase())) strange.push(`${name} ${frame} ${word}`);
        const to = target({ stage, frame }, word);
        if (!to) continue;
        ways++;
        if (!framesOf(world, to.stage).has(to.frame)) nowhere.push(`${name} ${frame} ${word}`);
      }
    }
    for (const [frame, spots] of hotspotsOf(discs, world, stage)) {
      if (!has.has(frame)) continue;
      for (const s of spots) {
        ways++;
        if (!framesOf(world, s.to.stage).has(s.to.frame)) nowhere.push(`${name} ${frame} ${s.region} ${s.to.stage}:${s.to.frame}`);
      }
    }
    // and every region a flat offers has a script the reader can open — or
    // none at all: e024's red and blue, m009's A to E are eight zero bytes
    const stg = readStgFile(discs.file(name)!);
    for (const f of stg.flats) {
      const logic = stg.file.containers[f.locationClickLogic]?.data;
      for (const r of logic ? readStgRegions(logic, stg.version) : []) {
        const data = stg.file.containers[r.script]?.data;
        if (r.script && (!data || (data.some((b) => b) && !sniffScript(data)))) unparsed.push(`${name} ${f.name} ${r.name}`);
      }
    }
  }

  expect(stages.length, "no stage files indexed").toBeGreaterThan(100);
  expect(ways, "the tables read as empty").toBeGreaterThan(1000);
  expect(strange, "a word no transitionaction case answers").toEqual([]);
  expect(unparsed, "a region whose script does not read").toEqual([]);
  expect(nowhere.filter((w) => !KNOWN.has(w)), "a way out to a frame no stage has").toEqual([]);
  expect([...KNOWN].filter((w) => !nowhere.includes(w)), "a known dead end that is gone").toEqual([]);
});
