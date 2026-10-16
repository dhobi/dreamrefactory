/**
 * DreamFactory 5's menus, keys, stopwatches and the room's warm-up and quad
 * commands, as RedJack.exe answers them (engine/src/runtime/builtins/df5-ui.ts).
 *
 *   npx vitest run engine/tests/df5-ui.ts
 *
 * One check reads the virtual-key name table out of RedJack.exe and skips
 * loudly without `redjack/gamefiles`, as the other corpus checks do.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect } from "vitest";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { buildBankBytes } from "@dreamfactory/engine/df/banks-build";
import { DF5_VK_NAMES } from "@dreamfactory/engine/runtime/builtins/df5-ui";

const EXE = fileURLToPath(new URL("../../redjack/gamefiles/RJDisk1/RedJack/RedJack.exe", import.meta.url));

const v5 = () => {
  const session = new GameSession(() => null, new NullAudioSink());
  const unknown: string[] = [];
  session.interp.onUnknown = (name) => unknown.push(name);
  const call = (name: string, ...args: (number | string)[]) =>
    session.interp.builtins.get(name)!(session.interp, args, {} as never, {} as never);
  const fails = (name: string, ...args: (number | string)[]) => expect(async () => call(name, ...args)).rejects;
  return { session, unknown, call, fails };
};

test("v5's menus are a model the scripts build and read back, as menu.c keeps it", async () => {
  const { session, unknown, call, fails } = v5();
  expect(await call("countmenus")).toBe(0);
  expect(unknown).toEqual(["countmenus"]);
  session.isV5 = true;

  // RedJack's boot () builds its debug menus this way
  await call("createmenu", "File");
  await call("createmenu", "Sound");
  await call("appenditem", "file", "Quit");
  await call("appenditem", "File", "Brighter");
  await call("cmdkeyitem", "File", "Quit", "q");
  await fails("createmenu", "FILE").toMatchObject({ code: 0xa });
  await fails("appenditem", "File", "quit").toMatchObject({ code: 0xa });
  await fails("appenditem", "Script", "Edit").toMatchObject({ code: 0xa });
  expect(await call("countmenus")).toBe(2);
  expect(await call("indextomenu", 2)).toBe("Sound");
  await fails("indextomenu", 3).toMatchObject({ code: 0xa });
  await fails("indextomenu", "1").toMatchObject({ code: 0xe });
  expect(await call("countitems", "File")).toBe(2);
  expect(await call("indextoitem", "File", 1)).toBe("Quit");
  await fails("indextoitem", "File", 0).toMatchObject({ code: 0xa });
  await fails("countitems", "Script").toMatchObject({ code: 0xa });

  // the item's three words, set and read back
  expect(await call("checkitem", "File", "Quit")).toBe(0);
  await call("checkitem", "File", "Quit", 1);
  await call("grayitem", "File", "Brighter", 1);
  expect(await call("checkitem", "File", "Quit")).toBe(1);
  expect(await call("grayitem", "File", "Quit")).toBe(0);
  expect(await call("grayitem", "File", "Brighter")).toBe(1);
  await fails("checkitem", "File", "Quit", "yes").toMatchObject({ code: 0xe });
  expect(await call("cmdkeyitem", "File", "Quit")).toBe("q");
  expect(await call("cmdkeyitem", "File", "Brighter")).toBe("\0");
  // a key of any length but one is the wrong type, not out of range
  await fails("cmdkeyitem", "File", "Quit", "qq").toMatchObject({ code: 0xe });

  await call("changeitem", "File", "Brighter", "Darker");
  expect(await call("indextoitem", "File", 2)).toBe("Darker");
  // names keep 127 characters
  await call("createmenu", "x".repeat(200));
  expect(await call("indextomenu", 3)).toBe("x".repeat(127));

  await call("drawmenus");
  await call("clearmenus");
  expect(await call("countmenus")).toBe(0);
  for (let k = 0; k < 64; k++) await call("createmenu", `m${k}`);
  await fails("createmenu", "one too many").toMatchObject({ code: 0xa });
});

test("v5's key (name) asks the held keys by the exe's names, else by VkKeyScan", async () => {
  const { session, call, fails } = v5();
  session.isV5 = true;
  expect(await call("key", "shift")).toBe(0);
  session.keysDown.add(0x10);
  expect(await call("key", "SHIFT")).toBe(1);
  session.keysDown.add(0x41);
  expect(await call("key", "a")).toBe(1);
  expect(await call("key", "A")).toBe(1);
  expect(await call("key", "b")).toBe(0);
  session.keysDown.add(0x70);
  expect(await call("key", "f1")).toBe(1);
  // the space bar is held from the phone's button too, and the mouse buttons are the pointer's
  session.spaceDown = true;
  expect(await call("key", "space")).toBe(1);
  expect(await call("key", " ")).toBe(1);
  session.pointerDown = true;
  session.pointerButton = 1;
  expect(await call("key", "button")).toBe(1);
  expect(await call("key", "rbutton")).toBe(0);
  // a longer name not in the table is no key at all
  expect(await call("key", "leftshift")).toBe(0);
  await fails("key", 16).toMatchObject({ code: 0xe });
});

test("RedJack.exe's virtual-key name table is the one the port carries", () => {
  if (!existsSync(EXE)) {
    console.warn(`SKIP: ${EXE} not here`);
    return;
  }
  const d = readFileSync(EXE);
  const pe = d.readUInt32LE(0x3c);
  const base = d.readUInt32LE(pe + 52);
  const optsz = d.readUInt16LE(pe + 20);
  const off = (va: number): number => {
    for (let s = 0; s < d.readUInt16LE(pe + 6); s++) {
      const o = pe + 24 + optsz + s * 40;
      const va0 = d.readUInt32LE(o + 12);
      const size = Math.max(d.readUInt32LE(o + 8), d.readUInt32LE(o + 16));
      if (va - base >= va0 && va - base < va0 + size) return d.readUInt32LE(o + 20) + va - base - va0;
    }
    throw new Error(`0x${va.toString(16)} is in no section`);
  };
  // 256 pointers from 0x4c1958, each to a length byte and a C string
  const names: Record<number, string> = {};
  for (let k = 0; k < 256; k++) {
    const p = d.readUInt32LE(off(0x4c1958) + 4 * k);
    if (!p) continue;
    const at = off(p) + 1;
    names[k] = d.subarray(at, d.indexOf(0, at)).toString("latin1");
  }
  expect(names).toEqual(DF5_VK_NAMES);
});

test("v5's stopwatches, room warm-ups, quads and themes", async () => {
  const { session, call, fails } = v5();
  session.isV5 = true;

  // ten stopwatches on the engine clock
  session.clock.advance(1000);
  await call("profilestart", 3);
  session.clock.advance(1250);
  expect(await call("profilestop", 3)).toBe(250);
  expect(await call("profilestop", 4)).toBe(1250);
  await fails("profilestart", 11).toMatchObject({ code: 0xa });
  await fails("profilestop", 0).toMatchObject({ code: 0xa });
  await fails("profilestart", "1").toMatchObject({ code: 0xe });

  // with no room, every room command is 0x28 before it looks at its argument
  for (const name of ["scenewarm", "roadwarm", "countquads", "indextoquad", "launchroad"])
    await fails(name, 1).toMatchObject({ code: 0x28 });
  session.maze = {
    sett: {
      nodes: [{ name: "node1" }],
      scenes: [{ name: "Boat" }],
      roads: [{ name: "road1" }],
      quads: [{ name: "chest" }, { name: "door" }],
    },
  } as never;
  expect(await call("scenewarm", "NODE1")).toBe(0);
  expect(await call("scenewarm", "boat")).toBe(0);
  await fails("scenewarm", "road1").toMatchObject({ code: 0xa });
  expect(await call("roadwarm", "road1")).toBe(0);
  await fails("roadwarm", "node1").toMatchObject({ code: 0xa });
  await fails("scenewarm", 1).toMatchObject({ code: 0xe });
  expect(await call("countquads")).toBe(2);
  expect(await call("indextoquad", 2)).toBe("door");
  await fails("indextoquad", 3).toMatchObject({ code: 0xa });
  expect(await call("launchroad", "road1", 1, 8)).toBe(0);
  await fails("launchroad", "road1", "yes", 8).toMatchObject({ code: 0xe });
  await fails("launchroad", "road1", 1, 0).toMatchObject({ code: 0xa });
  await fails("launchroad", "node1", 1, 8).toMatchObject({ code: 0xa });

  // themeexists: an open track file by the name it calls itself, not the file's
  const tone = { sampleRate: 11025, samples: new Float32Array(40).fill(0.25) };
  session.audioLib.openBank("pnarend.trk", buildBankBytes({ name: "narend.trk", loops: [{ identifier: "a", audio: tone }], singles: [] }));
  expect(await call("themeexists", "NAREND.TRK")).toBe(1);
  expect(await call("themeexists", "pnarend.trk")).toBe(0);
  await fails("themeexists", 1).toMatchObject({ code: 0xe });
});
