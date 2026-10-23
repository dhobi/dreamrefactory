/**
 * The boot library a session builds from a BOOTFILE written here
 * (engine/src/runtime/session-boot.ts): the globals `boot()` assigns at its
 * top level are seeded with their values and the booleans it sets only inside
 * a branch or a loop start false; every `global` a library handler declares,
 * however deep, exists as 0; a resource the boot plan names but the tree does
 * not carry is skipped; a BOOTFILE that is not a container is logged, not
 * thrown; and a DreamFactory 5 boot seeds nothing from `boot()`.
 *
 *   npx vitest run engine/tests/session-boot-library.ts
 */
import { expect, test } from "vitest";
import { ContainerBuilder, i32 } from "@dreamfactory/engine/df/build";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";

const BOOT = `code boot ()
\tglobal top, word
\ttop = 5
\tword = "hall"
\tif top = 5
\t\tinif = 1
\t\tflagif = true
\telse
\t\tflagelse = true
\tendif
\twhile 0
\t\tflagwhile = true
\tendwhile
\tswitch top
\tcase 5
\t\tflagcase = true
\tendswitch
\topenshopfile ("missing.shp")
endcode
code lib ()
\tif 1
\t\tglobal inif1
\telse
\t\tglobal inelse1
\tendif
\tswitch 1
\tcase 1
\t\tglobal incase1
\tdefault
\t\tglobal indefault1
\tendswitch
\twhile 0
\t\tglobal inwhile1
\tendwhile
endcode
`;

function bootfile(version: number, source = BOOT): Uint8Array {
  const b = new ContainerBuilder();
  const { data } = b.reserve(16);
  i32(data, 2, version);
  b.add(compileScript(source));
  return b.bytes();
}

function session(files: Record<string, Uint8Array>) {
  const s = new GameSession((n) => files[n.toLowerCase()] ?? null, new NullAudioSink());
  const logs: string[] = [];
  s.onLog = (l) => void logs.push(l);
  return { s, logs };
}

test("boot() seeds its top-level values, and false for the booleans it only sets in a branch", async () => {
  const { s } = session({ bootfile: bootfile(4) });
  await s.ensureBooted();
  const g = s.interp.globals;
  expect([g.get("top"), g.get("word")]).toEqual([5, "hall"]);
  expect([g.get("flagif"), g.get("flagelse"), g.get("flagwhile"), g.get("flagcase")]).toEqual([false, false, false, false]);
  // a number assigned in a branch is not seeded at all
  expect(g.has("inif")).toBe(false);
});

test("every global a library handler declares exists, however deep the declaration", async () => {
  const { s } = session({ bootfile: bootfile(4) });
  await s.ensureBooted();
  s.interp.globals.set("inif1", 9);
  s.bootCtrl.declareLibraryGlobals();
  const g = s.interp.globals;
  expect(["inelse1", "incase1", "indefault1", "inwhile1"].map((n) => g.get(n))).toEqual([0, 0, 0, 0]);
  // and one that already has a value keeps it
  expect(g.get("inif1")).toBe(9);
});

test("a DreamFactory 5 boot seeds nothing from boot()", async () => {
  const { s } = session({ bootfile: bootfile(5) });
  await s.ensureBooted();
  expect(s.isV5).toBe(true);
  expect(s.interp.globals.has("top")).toBe(false);
});

test("a boot library with no boot() seeds nothing, and a BOOTFILE that is not one is logged", async () => {
  const { s } = session({ bootfile: bootfile(4, "code lib ()\n\tglobal x\nendcode\n") });
  await s.ensureBooted();
  expect(s.interp.globals.has("x")).toBe(false);
  expect(s.bootScripts).toHaveLength(1);

  const { s: t, logs } = session({ bootfile: new Uint8Array([1, 2, 3]) });
  await t.ensureBooted();
  expect(logs.some((l) => l.startsWith("bootfile: "))).toBe(true);
  expect(t.bootScripts).toEqual([]);
});
