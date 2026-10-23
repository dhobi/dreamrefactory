/**
 * The stand-in machine under DreamFactory 5's file commands
 * (engine/src/runtime/df5-disk.ts) and the commands' rarer answers
 * (engine/src/runtime/builtins/df5-files.ts): network paths, hard-disk folders
 * and their listings, a snapshot put back, the registry read as the other type,
 * and a copy whose source is a copy on the hard disk.
 *
 *   npx vitest run engine/tests/df5-disk.ts
 *
 * Needs no game data.
 */
import { expect, test } from "vitest";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { Df5Disk, HD_FREE } from "@dreamfactory/engine/runtime/df5-disk";
import { GameSession } from "@dreamfactory/engine/runtime/session";

const TREE: [string, number][] = [
  ["top.txt", 5],
  ["RJDisk1/local 1/bar.trak", 2000],
  ["RJDisk1/ReadMe.Txt", 20],
];

const file = (size: number, bytes: Uint8Array | null = null) => ({ bytes, copyOf: null, size, transient: false });

test("a path of one part is no file of a disc; `::` is the hard disk", () => {
  const d = new Df5Disk();
  d.setTree(TREE);
  expect(d.volume("top.txt")).toBeNull();
  expect(d.locate("::net:share:x")).toEqual({ disc: false, parts: ["net", "share", "x"] });
  expect(d.discFile("::net:x")).toBeNull();
  expect(d.discFile("RJDisk1:ReadMe.Txt")).toBe("RJDisk1/ReadMe.Txt");
});

test("the hard disk: folders exist by their files, removing what is not there fails", () => {
  const d = new Df5Disk();
  let changes = 0;
  d.onChange = () => void changes++;
  expect(d.stat("Red Jack HD:")).toEqual({ dir: true, readOnly: false, busy: true, size: 0 });
  expect(d.stat("Red Jack HD:saves:")).toBeNull();
  expect(d.write("Red Jack HD:saves:one.save", file(10))).toBe(true);
  expect(d.stat("Red Jack HD:saves:")).toMatchObject({ dir: true });
  expect(d.stat("Red Jack HD:saves:one.save")).toMatchObject({ dir: false, size: 10 });
  expect(d.remove("Red Jack HD:saves:two.save")).toBe(false);
  // a transient file changes nothing a host keeps
  d.write("Red Jack HD:tmp", { ...file(1), transient: true });
  expect(changes).toBe(1);
  expect(d.remove("Red Jack HD:tmp")).toBe(true);
  expect(changes).toBe(1);
  expect(d.freeSpace("Red Jack HD:")).toBe(HD_FREE - 10);
});

test("a hard-disk listing: files and folders by prefix, in NTFS's upcased order", () => {
  const d = new Df5Disk();
  d.write("Red Jack HD:saves:b.save", file(1));
  d.write("Red Jack HD:saves:A.save", file(1));
  d.write("Red Jack HD:saves:a.save2", file(1));
  d.write("Red Jack HD:saves:old:x.save", file(1));
  d.write("Red Jack HD:saves:old:y.save", file(1));
  d.write("Red Jack HD:other.txt", file(1));
  expect(d.list("Red Jack HD:saves:")).toEqual([
    { name: "A.save", dir: false },
    { name: "a.save2", dir: false },
    { name: "b.save", dir: false },
    { name: "old", dir: true },
  ]);
  expect(d.list("Red Jack HD:saves:a")!.map((e) => e.name)).toEqual(["A.save", "a.save2"]);
  expect(d.list("Red Jack HD:nowhere:")).toBeNull();
  // the root always exists
  expect(d.list("Red Jack HD:")!.map((e) => e.name)).toEqual(["other.txt", "saves"]);
});

test("a snapshot keeps what is kept, and puts it back; nothing to put back is nothing", () => {
  const d = new Df5Disk();
  d.write("Red Jack HD:keep", file(3, new Uint8Array([1, 2, 3])));
  d.write("Red Jack HD:drop", { ...file(3), transient: true });
  d.setRegistry("Name", "Nick");
  const snap = d.snapshot();
  expect(snap.files.map((f) => f.parts)).toEqual([["keep"]]);
  const e = new Df5Disk();
  e.restore(null);
  e.restore({} as never);
  expect(e.hd.size).toBe(0);
  e.restore(snap);
  expect(e.hdFile("Red Jack HD:keep")?.bytes).toEqual(new Uint8Array([1, 2, 3]));
  expect(e.registry.get("name")?.value).toBe("Nick");
});

function v5() {
  const session = new GameSession(() => null, new NullAudioSink());
  session.isV5 = true;
  session.df5Disk.setTree(TREE);
  const logs: string[] = [];
  session.onLog = (l) => logs.push(l);
  const call = (name: string, ...args: (number | string)[]) =>
    session.interp.builtins.get(name)!(session.interp, args, {} as never, {} as never);
  return { session, logs, call };
}

test("the registry read as the other type: a number's bytes to its NUL, a short string's bytes", async () => {
  const { logs, call } = v5();
  await call("registrynumber", "Word", 0x00434241);
  expect(await call("registrystring", "word")).toBe("ABC");
  await call("registrynumber", "Full", 0x44434241);
  expect(await call("registrystring", "full")).toBe("ABCD");
  expect(logs.at(-1)).toContain("is a number");
  await call("registrystring", "Short", "AB");
  expect(await call("registrynumber", "short")).toBe(0x4241);
  expect(logs.at(-1)).toContain("is a string");
  await call("registrystring", "Empty", "");
  expect(await call("registrynumber", "empty")).toBe(0);
  await call("registrystring", "Long", "ABCD");
  expect(await call("registrynumber", "long")).toBe(0);
});

test("copylocal from a copy on the hard disk carries what it is a copy of; savetextfile with no name saves nothing", async () => {
  const { session, call } = v5();
  session.pathSlots[1] = "Red Jack HD:cache:";
  session.df5Disk.write("Red Jack HD:cache:bar.trak", { bytes: null, copyOf: "RJDisk1/local 1/bar.trak", size: 2000, transient: false });
  expect(await call("copylocal", "bar.trak", "Red Jack HD:", 0, 0)).toBe(1);
  expect(session.df5Disk.hdFile("Red Jack HD:bar.trak")).toMatchObject({ copyOf: "RJDisk1/local 1/bar.trak", transient: false });
  // a copy onto a disc cannot be written
  session.pathSlots[2] = "RJDisk1:";
  expect(await call("copylocal", "ReadMe.Txt", "RJDisk1:local 1:", 0, 0)).toBe(0);
  const before = session.df5Disk.hd.size;
  await call("savetextfile", "");
  expect(session.df5Disk.hd.size).toBe(before);
});
