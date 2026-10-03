/**
 * Every `.SET` of every edition on disk, read without a game tick: each walk
 * starts and ends at a view the set has, each picture a walk or a turn shows is
 * there, each script reads, every file a script names by a literal is in the
 * edition, and every `changeset` lands on a set, scene and view that exist.
 *
 *   npx vitest run --project taoot taoot/tests/auto/sets.ts
 *
 * The playthrough and the regression suite walk the ROUTE and the rooms a
 * report was about; this is the rest of every set on both discs — the turns
 * nobody takes, the objects nobody clicks, the walks off the route. Seconds.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSetFile } from "@dreamfactory/engine/df/set";
import { scriptToText, sniffScript } from "@dreamfactory/engine/df/script";
import { gamefiles, gamefilesRoot } from "../../tools/gamefiles";

/** the trees a rip may hold: the six editions, and the demo */
const EDITIONS = ["en", "de", "fr", "ja", "nl", "ru", "demo"].filter((l) => existsSync(join(gamefilesRoot(), l)));

/**
 * What the check finds and the game ships so. It fails on one not listed, and on
 * one listed that has gone.
 */
const KNOWN = new Set([
  // gstair3's Scene13/View33 `keydown` sends the uparrow with savedeck "b" to
  // `changeset ("gstair3", "scene65", "view79")`; Scene65's views are View66 to
  // View69, and View79 is Scene10's. The engine lands on View69 by the facing
  // ("grand staircase: deck flips", regression.ts)
  "gstair3.set changeset gstair3 scene65 view79: no such view",
]);

/** the extensions a script literal is taken to be a file by */
const NAMED = /"([\w .-]+\.(?:set|mov|pup|shp|trk|cst|stg|sfx))"/gi;
const CHANGESET = /changeset \("([^"]+)"(?:, "([^"]*)")?(?:, "([^"]*)")?/g;

/**
 * An object or scene with no script keeps an empty slot: eight zero bytes, which
 * the session reads as no script (617 of them in a full edition).
 */
const isEmpty = (d: Uint8Array): boolean => d.every((b) => b === 0);

describe.skipIf(!EDITIONS.length)("every set", () => {
  it.each(EDITIONS)("%s: walks, turns, scripts, named files and set changes land", (lang) => {
    const g = gamefiles(undefined, lang);
    const sets = g.names(/\.set$/i);
    const found: string[] = [];
    let walks = 0;
    let pictures = 0;
    let scripts = 0;
    const read = new Map<string, ReturnType<typeof readSetFile>>();
    const setAt = (path: string) => read.get(path) ?? read.set(path, readSetFile(new Uint8Array(readFileSync(path)))).get(path)!;

    for (const name of sets) {
      // a set shipped on both discs (a room in two act states) is two rooms
      for (const path of g.candidates(name)) {
        const set = setAt(path);
        const has = (c: number): boolean => !!set.file.containers[c];
        const views = new Set(set.scenes.flatMap((s) => s.views.map((v) => v.viewID)));
        for (const t of set.transitions) {
          walks++;
          if (!views.has(t.viewIDstart)) found.push(`${name} ${t.transitionName}: starts at no view (${t.viewIDstart})`);
          if (!views.has(t.viewIDend)) found.push(`${name} ${t.transitionName}: ends at no view (${t.viewIDend})`);
          for (const f of t.frameRegisters.flatMap((r) => r.frames)) {
            pictures++;
            if (!has(f.frameContainerLoc)) found.push(`${name} ${t.transitionName}: no picture ${f.frameContainerLoc}`);
          }
        }
        for (const s of set.scenes) {
          for (const f of s.turns.flatMap((r) => r.frames)) {
            pictures++;
            if (!has(f.frameContainerLoc)) found.push(`${name} ${s.sceneName}'s turn: no picture ${f.frameContainerLoc}`);
          }
        }
        const owners: [number, string][] = [
          [set.mainScript, "main"],
          ...set.scenes.map((s): [number, string] => [s.locationScript, s.sceneName]),
          ...set.scenes.flatMap((s) => s.views.flatMap((v) => v.objects.map((o): [number, string] => [o.locationScript, `${s.sceneName}/${v.viewName}/${o.identifier}`]))),
        ];
        for (const [at, who] of owners) {
          if (!at) continue;
          const data = set.file.containers[at]?.data;
          const tokens = data ? sniffScript(data) : null;
          if (!tokens) {
            if (!data || !isEmpty(data)) found.push(`${name} ${who}: script ${at} does not read`);
            continue;
          }
          scripts++;
          const text = scriptToText(tokens);
          for (const m of text.matchAll(NAMED)) if (!g.resolve(m[1].toLowerCase())) found.push(`${name} names ${m[1].toLowerCase()}`);
          for (const [, target, scene, view] of text.matchAll(CHANGESET)) {
            const to = g.resolve(`${target.toLowerCase().replace(/\.set$/, "")}.set`);
            const call = `${name} changeset ${[target, scene, view].filter(Boolean).join(" ")}`;
            if (!to) {
              found.push(`${call}: no such set`);
              continue;
            }
            const sc = scene ? setAt(to).scenes.find((s) => s.sceneName.toLowerCase() === scene.toLowerCase()) : undefined;
            if (scene && !sc) found.push(`${call}: no such scene`);
            else if (sc && view && !sc.views.some((v) => v.viewName.toLowerCase() === view.toLowerCase())) found.push(`${call}: no such view`);
          }
        }
      }
    }

    expect(sets.length, "no sets indexed").toBeGreaterThan(5);
    expect(walks, "no walks read").toBeGreaterThan(50);
    expect(pictures, "no pictures read").toBeGreaterThan(1000);
    expect(scripts, "no scripts read").toBeGreaterThan(40);
    const unique = [...new Set(found)];
    expect(unique.filter((f) => !KNOWN.has(f)), "a set reaching for something that is not there").toEqual([]);
    // the demo is nine sets and has no grand staircase
    if (lang !== "demo") expect([...KNOWN].filter((k) => !unique.includes(k)), "a known gap that is gone").toEqual([]);
  });
});
