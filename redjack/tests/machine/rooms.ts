/**
 * Every room on the three discs, read without playing a step of it: each film
 * arrives somewhere the room has, each picture it shows is there, each script
 * reads, and each file a script names by a literal is on a disc.
 *
 *   npm test -w redjack -- rooms
 *
 * The day suites walk the ROUTE; this is the rest of every `.sett` — the roads
 * and turns nobody on the route takes, the nodes' spheres, the scripts of the
 * scenes, nodes and quads, and the films, rooms and puppets they ask for by
 * name. Seconds, and no game ticks.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { type MazeFilm, isSett, readSettFile, readSphere } from "@dreamfactory/engine/df/sett";
import { scriptToText, sniffScript } from "@dreamfactory/engine/df/script";
import { haveRip, indexDiscs } from "./harness";

/**
 * The authoring tool's empty scripts: 24 to 40 bytes, eight zero bytes and a
 * few of its own pointers, with no statement in them — the session reads them
 * as no script (`instanceFrom`). 116 of the rooms' scripts are these, and every
 * one that reads opens with a header that is not zero.
 */
const isStub = (d: Uint8Array): boolean => d.length >= 8 && d.subarray(0, 8).every((b) => b === 0);

/** what the check finds and the game ships so; it fails on one not listed, and on one listed that has gone */
const KNOWN = new Set([
  // node197/198 before the skeleton: `mymovie ("runmble.move")` — the disc's is rumble.move
  `hub.sett names runmble.move`,
  // the soldier letting Nick out: `runpuppet ("solier2.pupp", "leaving")` — the disc's is soldier2.pupp
  `jail4.sett names solier2.pupp`,
  // day 1, scene20: two films and a room that did not ship
  `ptroyal.sett names manin.move`,
  `ptroyal.sett names mandown.move`,
  `ptroyal.sett names sewer.sett`,
]);

/** the extensions a script literal is taken to be a file by */
const NAMED = /"([\w .-]+\.(?:sett|move|pupp|cast|trak|shop|bank))"/gi;

test.skipIf(!haveRip())("every room's films, pictures, scripts and named files are on the discs", () => {
  const index = indexDiscs();
  const file = (n: string): Uint8Array | null => {
    const discs = index.get(n);
    return discs ? new Uint8Array(readFileSync([...discs.values()][0])) : null;
  };
  const rooms = [...index.keys()].filter((n) => n.endsWith(".sett")).sort();
  const found: string[] = [];
  let films = 0;
  let scripts = 0;

  for (const name of rooms) {
    const bytes = file(name)!;
    if (!isSett(bytes)) {
      found.push(`${name}: not a room`);
      continue;
    }
    const room = readSettFile(bytes);
    const has = (c: number): boolean => !!room.file.containers[c];
    const nodeAt = new Set(room.nodes.map((n) => n.node));
    const sceneAt = new Set(room.scenes.map((s) => s.scen));

    // a road's films arrive somewhere: its ends are nodes or scenes
    for (const road of room.roads) {
      for (const f of road.films) if (!f.to && !f.toScene) found.push(`${name}: ${road.name}'s film ${f.container} arrives nowhere`);
    }
    const every: MazeFilm[] = [
      ...room.roads.flatMap((r) => r.films),
      ...room.scenes.flatMap((s) => [...s.films, ...s.views.flatMap((v) => (v.road ? [v.road] : []))]),
    ];
    for (const f of every) {
      films++;
      if (f.to && !nodeAt.has(f.to)) found.push(`${name}: film ${f.container} arrives at no node (${f.to})`);
      if (f.toScene && !sceneAt.has(f.toScene)) found.push(`${name}: film ${f.container} arrives at no scene (${f.toScene})`);
      for (const fr of f.frames) if (!has(fr.picture)) found.push(`${name}: film ${f.container} shows no picture ${fr.picture}`);
    }
    for (const n of room.nodes) {
      if (!has(n.sphere)) found.push(`${name}: ${n.name} has no sphere`);
      else for (const p of readSphere(room.file, n.sphere)) if (p.picture && !has(p.picture)) found.push(`${name}: ${n.name}'s sphere shows no picture ${p.picture}`);
    }

    const owners = [room.mainScript, ...room.nodes.map((n) => n.script), ...room.scenes.map((s) => s.script), ...room.quads.map((q) => q.script)];
    for (const at of owners) {
      if (!at) continue;
      const data = room.file.containers[at]?.data;
      const tokens = data ? sniffScript(data) : null;
      if (!tokens) {
        if (!data || !isStub(data)) found.push(`${name}: script ${at} does not read`);
        continue;
      }
      scripts++;
      for (const m of scriptToText(tokens).matchAll(NAMED)) {
        const named = m[1].toLowerCase();
        if (!index.has(named)) found.push(`${name} names ${named}`);
      }
    }
  }

  expect(rooms.length, "no rooms indexed").toBeGreaterThan(30);
  expect(films, "no films read").toBeGreaterThan(500);
  expect(scripts, "no scripts read").toBeGreaterThan(300);
  const unique = [...new Set(found)];
  expect(unique.filter((f) => !KNOWN.has(f)), "a room reaching for something that is not there").toEqual([]);
  expect([...KNOWN].filter((k) => !unique.includes(k)), "a known gap that is gone").toEqual([]);
});
