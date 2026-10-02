/**
 * How the game names the rip's files and waits for them (src/game/machine.ts),
 * on a made-up file store rather than the rip.
 *
 *   npx vitest run jumpraven/tests/files.ts
 *
 * The page serves the rip in the background (`GameFiles.want`) while the
 * machine waits, and the machine suites read it straight off the disk, where
 * nothing is ever late. So what the page relies on is pinned here:
 *
 *   - a game name is the disc's 8.3 name in upper case (`intro.move` is
 *     `INTRO.MOV`), looked for in the day's folder and then `SHARED\`
 *     (0x40ea4a), and a name in neither is none
 *   - a file of the install's own folder not fetched yet is asked for, and
 *     waited on a tick at a time until it has come
 *   - a file the rip does not have is an error, not a wait for ever
 */
import { expect, test } from "vitest";
import { Machine, dosName, type GameFiles } from "../src/game/machine";

/** a store of the given paths, each arriving `late` asks after it was first wanted */
function store(paths: string[], late = 0) {
  const wanted: string[] = [];
  const files: GameFiles = {
    has: (p) => paths.includes(p),
    get: (p) => (paths.includes(p) && wanted.filter((w) => w === p).length >= late ? new Uint8Array([1, 2, 3]) : null),
    want: (p) => void wanted.push(p),
  };
  return { files, wanted };
}

test("a game name is the disc's 8.3 name, upper case", () => {
  expect(dosName("intro.move")).toBe("INTRO.MOV");
  expect(dosName("bati.pupp")).toBe("BATI.PUP");
  expect(dosName("puppet")).toBe("PUPPET");
  expect(dosName("deadman.move")).toBe("DEADMAN.MOV");
  expect(dosName("longername.move")).toBe("LONGERNA.MOV");
});

test("a name is looked for in the day's folder, then SHARED, and in neither is none", () => {
  const m = new Machine(store(["DAY2/RBAY", "SHARED/RBAY", "SHARED/MART"]).files);
  expect(m.resolve("rbay", 2)).toBe("DAY2/RBAY");
  expect(m.resolve("rbay", 1)).toBe("SHARED/RBAY");
  expect(m.resolve("mart", 3)).toBe("SHARED/MART");
  expect(m.resolve("pilot", 1)).toBeNull();
});

test("a file of the install's own folder not here yet is asked for, and waited on a tick at a time", () => {
  const { files, wanted } = store(["RAVEN/RAVEN.FON"], 3);
  const m = new Machine(files);
  const read = m.own("RAVEN.FON");
  let ticks = 0;
  let r = read.next();
  while (!r.done) {
    ticks++;
    r = read.next();
  }
  expect([...r.value]).toEqual([1, 2, 3]);
  expect(ticks).toBe(3);
  expect(wanted).toEqual(["RAVEN/RAVEN.FON", "RAVEN/RAVEN.FON", "RAVEN/RAVEN.FON"]);
});

test("a file the rip does not have is an error, not a wait for ever", () => {
  const m = new Machine(store([]).files);
  expect(() => m.own("RAVEN.SCO").next()).toThrow("RAVEN/RAVEN.SCO is not in the rip");
});
