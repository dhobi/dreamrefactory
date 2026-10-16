/**
 * DreamFactory 5's file, folder, volume, text-file and registry commands, as
 * RedJack.exe answers them (engine/src/runtime/builtins/df5-files.ts), over the
 * stand-in machine of engine/src/runtime/df5-disk.ts.
 *
 *   npx vitest run engine/tests/df5-files.ts
 *
 * One check walks the boot's copy to the hard disk over the real discs' tree
 * and skips loudly without `redjack/gamefiles`, as the other corpus checks do.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "vitest";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { Df5Disk, HD_FREE } from "@dreamfactory/engine/runtime/df5-disk";

const RIP = fileURLToPath(new URL("../../redjack/gamefiles/", import.meta.url));

const TREE: [string, number][] = [
  ["RJDisk1/RedJack/bootfile.boot", 1000],
  ["RJDisk1/ReadMe.Txt", 20],
  ["RJDisk1/local 1/crate.stag", 3000],
  ["RJDisk1/local 1/bar.trak", 2000],
  ["RJDisk1/local 1/Fight.trak", 500],
  ["RJDisk1/local 1/.hidden", 1],
  ["RJDisk1/local 1/sub/deep.sett", 1],
  ["RJDisk2/data/x.sett", 1],
];

const v5 = (files: Record<string, string> = {}) => {
  const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  const session = new GameSession((name) => (name in files ? bytes(files[name]) : null), new NullAudioSink());
  session.df5Disk.setTree(TREE);
  const unknown: string[] = [];
  session.interp.onUnknown = (name) => unknown.push(name);
  const call = (name: string, ...args: (number | string)[]) =>
    session.interp.builtins.get(name)!(session.interp, args, {} as never, {} as never);
  const fails = (name: string, ...args: (number | string)[]) => expect(async () => call(name, ...args)).rejects;
  return { session, unknown, call, fails };
};

test("v5's file lists are a folder's files and folders, dot-names left out, in code-unit order", async () => {
  const { session, unknown, call, fails } = v5();
  expect(await call("countfilenames")).toBe(0);
  expect(unknown).toEqual(["countfilenames"]);
  session.isV5 = true;

  expect(await call("countfilenames")).toBe(0);
  await call("buildfilenames", "rjdisk1:LOCAL 1:");
  expect(await call("countfilenames")).toBe(3);
  expect([1, 2, 3].map((k) => call("indextofilename", k))).toEqual(["Fight.trak", "bar.trak", "crate.stag"]);
  expect(await call("countfoldernames")).toBe(1);
  expect(await call("indextofoldername", 1)).toBe("sub");
  await fails("indextofilename", 4).toMatchObject({ code: 0xa });
  await fails("indextofilename", 0).toMatchObject({ code: 0xa });
  await fails("indextofoldername", "1").toMatchObject({ code: 0xe });
  await fails("buildfilenames", 1).toMatchObject({ code: 0xe });

  // the search is folder @ "*.*": without the last colon, a prefix in the parent
  await call("buildfilenames", "RJDisk1:local");
  expect(await call("countfilenames")).toBe(0);
  expect(await call("indextofoldername", 1)).toBe("local 1");
  await call("buildfilenames", "RJDisk1:");
  expect([await call("indextofilename", 1), await call("indextofoldername", 1), await call("indextofoldername", 2)]).toEqual([
    "ReadMe.Txt",
    "RedJack",
    "local 1",
  ]);
  // a folder that is not there: both lists empty, no error
  await call("buildfilenames", "RJDisk1:nowhere:");
  expect([await call("countfilenames"), await call("countfoldernames")]).toEqual([0, 0]);
});

test("v5's volumename, filename and diskspace", async () => {
  const { session, call, fails } = v5();
  session.isV5 = true;
  expect(await call("volumename", "RJDisk1:local 1:bar.trak")).toBe("RJDisk1");
  expect(await call("volumename", "no colon")).toBe("no colon");
  expect(await call("filename", "RJDisk1:local 1:bar.trak")).toBe("bar.trak");
  expect(await call("filename", "C\\dir/name")).toBe("name");
  expect(await call("filename", "RJDisk1:local 1:")).toBe("");
  await fails("filename", 3).toMatchObject({ code: 0xe });
  // a CD has no free space; the hard disk is the stand-in's
  expect(await call("diskspace", "RJDisk2:data:")).toBe(0);
  expect(await call("diskspace", "Red Jack HD:")).toBe(HD_FREE);
  expect(await call("diskspace", "")).toBe(HD_FREE);
});

test("v5's copylocal copies the first path slot's find, caches it, and deletefile removes it", async () => {
  const { session, call, fails } = v5();
  session.isV5 = true;
  session.pathSlots[2] = "local:";
  session.pathSlots[7] = "RJDisk1:local 1:";
  session.mountedCd = "rjdisk1";
  await fails("copylocal", "bar.trak", "local:", "yes", 1).toMatchObject({ code: 0xe });
  await fails("copylocal", "bar.trak", 1, 1, 1).toMatchObject({ code: 0xe });
  // nowhere in slots 1..8
  expect(await call("copylocal", "nothing.trak", "local:", 1, 1)).toBe(0);
  expect(await call("copylocal", "bar.trak", "local:", 1, 1)).toBe(1);
  const copy = session.df5Disk.hdFile("local:bar.trak")!;
  expect(copy).toMatchObject({ copyOf: "RJDisk1/local 1/bar.trak", size: 2000, transient: true });
  expect(await call("diskspace", "local:")).toBe(HD_FREE - 2000);
  // there already: true, and slot 2 now finds the copy itself
  expect(await call("copylocal", "bar.trak", "local:", 1, 1)).toBe(1);
  // cached copies come only from the mounted CD
  session.mountedCd = "RJDisk2";
  expect(await call("copylocal", "crate.stag", "local:", 1, 1)).toBe(0);
  // ...an uncached one from anywhere, and it is kept for good
  expect(await call("copylocal", "crate.stag", "local:", 0, 0)).toBe(1);
  expect(session.df5Disk.snapshot().files.map((f) => f.parts)).toEqual([["crate.stag"]]);

  await call("buildfilenames", "local:");
  expect([await call("indextofilename", 1), await call("indextofilename", 2)]).toEqual(["bar.trak", "crate.stag"]);

  await call("deletefile", "local:crate.stag");
  expect(session.df5Disk.hdFile("local:crate.stag")).toBeNull();
  await fails("deletefile", "local:crate.stag").toMatchObject({ code: 0x2a });
  // a folder cannot be opened: 0x31
  await fails("deletefile", "RJDisk1:local 1").toMatchObject({ code: 0x31 });
  // a CD's file is there, so no error, and it stays
  await call("deletefile", "RJDisk1:ReadMe.Txt");
  expect(session.df5Disk.discFile("RJDisk1:readme.txt")).toBe("RJDisk1/ReadMe.Txt");
});

test("v5's copylocal cache holds 32 and deletes the oldest copy to make room", async () => {
  const many: [string, number][] = Array.from({ length: 34 }, (_, k) => [`RJDisk1/local 1/f${String(k).padStart(2, "0")}`, 10]);
  const session = new GameSession(() => null, new NullAudioSink());
  session.isV5 = true;
  session.df5Disk.setTree(many);
  session.pathSlots[7] = "RJDisk1:local 1:";
  session.mountedCd = "RJDisk1";
  const call = (name: string, ...args: (number | string)[]) =>
    session.interp.builtins.get(name)!(session.interp, args, {} as never, {} as never);
  for (let k = 0; k < 34; k++) expect(await call("copylocal", `f${String(k).padStart(2, "0")}`, "local:", 1, 1)).toBe(1);
  await call("buildfilenames", "local:");
  expect(await call("countfilenames")).toBe(32);
  expect(await call("indextofilename", 1)).toBe("f02");
});

test("v5's text file is one CR-separated buffer: read, edited by line, counted and written", async () => {
  const { session, call, fails } = v5({ "ReadMe.Txt": "\nfirst\r\nsecond\nthird" });
  session.isV5 = true;
  expect(await call("counttextstrings")).toBe(0);
  await fails("indextotextstring", 1).toMatchObject({ code: 0xa });
  await call("opentextfile", "RJDisk1:ReadMe.Txt");
  expect(await call("counttextstrings")).toBe(3);
  expect(await call("indextotextstring", 1)).toBe("first");
  expect(await call("indextotextstring", 3)).toBe("third");
  await fails("indextotextstring", "1").toMatchObject({ code: 0xe });
  await fails("indextotextstring", 4).toMatchObject({ code: 0xa });
  // a file that will not open leaves the buffer as it was
  await call("opentextfile", "RJDisk1:none.txt");
  await call("opentextfile", "");
  expect(await call("counttextstrings")).toBe(3);

  await call("addtextstring", "SECOND", 2);
  await call("addtextstring", "fourth", 0);
  await call("addtextstring", "fifth", 9);
  await fails("addtextstring", "x", "1").toMatchObject({ code: 0xe });
  expect(await call("counttextstrings")).toBe(5);
  expect(await call("indextotextstring", 2)).toBe("SECOND");
  expect(await call("indextotextstring", 5)).toBe("fifth");

  await call("savetextfile", "Red Jack HD:notes.txt");
  const saved = session.df5Disk.hdFile("Red Jack HD:notes.txt")!;
  expect(String.fromCharCode(...saved.bytes!)).toBe("first\r\nSECOND\r\nthird\r\nfourth\r\nfifth");
  // a CD cannot be written: nothing, and no error
  await call("savetextfile", "RJDisk1:notes.txt");
  expect(session.df5Disk.discFile("RJDisk1:notes.txt")).toBeNull();

  await call("cleantextfile");
  expect(await call("counttextstrings")).toBe(0);
  await call("addtextstring", "only", 1);
  expect(await call("indextotextstring", 1)).toBe("only");
  // read back from the hard disk
  await call("opentextfile", "Red Jack HD:notes.txt");
  expect(await call("counttextstrings")).toBe(5);
  // a buffer ending in CR counts a last line it cannot index
  await call("cleantextfile");
  await call("addtextstring", "a", 0);
  await call("addtextstring", "", 0);
  expect(await call("counttextstrings")).toBe(2);
  await fails("indextotextstring", 2).toMatchObject({ code: 0xa });
});

test("v5's registry is HKCU\\Software\\RedJack's values, empty to start, persisted with the disk", async () => {
  const { session, call, fails } = v5();
  session.isV5 = true;
  expect(await call("registrystring", "Name")).toBe("");
  expect(await call("registrynumber", "Count")).toBe(0);
  await call("registrystring", "Name", "Nick");
  await call("registrynumber", "Count", -7);
  await fails("registrynumber", "Count", "7").toMatchObject({ code: 0xe });
  await fails("registrystring", 1).toMatchObject({ code: 0xe });
  expect(await call("registrystring", "NAME")).toBe("Nick");
  expect(await call("registrynumber", "count")).toBe(-7);
  // the other type: the exe asserts and goes on with the bytes
  expect(await call("registrynumber", "Name")).toBe(0);
  await call("registrystring", "ab", "ab");
  expect(await call("registrynumber", "ab")).toBe(0x6261);

  let changes = 0;
  const again = new Df5Disk();
  session.df5Disk.onChange = () => changes++;
  await call("registrynumber", "Count", 3);
  again.restore(session.df5Disk.snapshot());
  expect(again.registry.get("count")?.value).toBe(3);
  expect(changes).toBe(1);
});

test("the boot's copy of the day's local folder finds every file on the real discs", async () => {
  if (!existsSync(join(RIP, "RJDisk1"))) {
    console.warn(`SKIP: ${RIP} not here`);
    return;
  }
  const tree: [string, number][] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(join(RIP, rel))) {
      const p = rel ? `${rel}/${name}` : name;
      const st = statSync(join(RIP, p));
      if (st.isDirectory()) walk(p);
      else tree.push([p, st.size]);
    }
  };
  for (const d of ["RJDisk1", "RJDisk2", "RJDisk3"]) walk(d);
  const session = new GameSession(() => null, new NullAudioSink());
  session.isV5 = true;
  session.df5Disk.setTree(tree);
  const call = (name: string, ...args: (number | string)[]) =>
    session.interp.builtins.get(name)!(session.interp, args, {} as never, {} as never);
  // resetpaths and docopylocal for each day's disc, as bootfile.boot has them
  const days: [string, string][] = [["RJDisk1:", "local 1:"], ["RJDisk1:", "local 2:"], ["RJDisk2:", "local 3:"], ["RJDisk3:", "local:"]];
  for (const [cd, local] of days) {
    session.pathSlots[2] = "local:";
    session.pathSlots[6] = cd + local;
    session.pathSlots[7] = cd + local;
    session.mountedCd = cd.slice(0, -1);
    await call("buildfilenames", cd + local);
    const n = (await call("countfilenames")) as number;
    expect(n).toBeGreaterThan(0);
    for (let k = 1; k <= n; k++) expect(await call("copylocal", (await call("indextofilename", k)) as string, "local:", 1, 1)).toBe(1);
  }
});
