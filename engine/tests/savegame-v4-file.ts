/**
 * Titanic's `.ti` save, read and patched from bytes built here
 * (engine/src/df/savegame-read.ts, savegame-patch.ts, save-vars.ts): what the
 * record grids, the manifest, the scheduler tables and the open tracks read
 * back as when they are short, unnamed, or malformed, and what a patch does
 * with what it cannot place — the drop reasons, the records it grows, and the
 * fields it leaves alone.
 *
 *   npx vitest run engine/tests/savegame-v4-file.ts
 *
 * No game files: the shipped saves' own round trips are taoot/tests/auto/savegame.ts.
 */
import { expect, test } from "vitest";
import { readSaveFile } from "@dreamfactory/engine/df/savegame";
import { manifestFiles, parseSave, walkActorGrid, walkPropGrid } from "@dreamfactory/engine/df/savegame-read";
import { applyPatch, type SavePatch } from "@dreamfactory/engine/df/savegame-patch";
import {
  ACTOR_NAME_AT,
  FILLER,
  get16,
  get32,
  i32,
  pstr,
  titanicBytes,
  titanicSave,
  trackSounds,
  u16,
  u32,
} from "./helpers/save-fixtures";

const room = { set: "bedsit", scene: "Scene1", view: "north" };
const patchOf = (extra: Partial<SavePatch> = {}): SavePatch => ({ numGlobals: new Map(), ...room, ...extra });
const drops = () => {
  const list: string[] = [];
  return { list, onDrop: (n: string, why: string) => void list.push(`${n}: ${why}`) };
};

test("grids: one record is not a grid, an unnamed one ends it, and a view or owner is required", () => {
  expect(walkPropGrid(titanicSave({ props: [["watch", "lit", "frank"]] }).inventory)).toEqual([]);
  const s = titanicSave({
    props: [["watch", "lit", "frank"], ["bag", "shut", "frank"], ["map", "", "frank"], ["key", "lit", "frank"]],
    actors: [["anne", "none"], ["jack", "none"], ["mary", ""], ["kate", "none"]],
  });
  expect(walkPropGrid(s.inventory).map((r) => r.prop.name)).toEqual(["watch", "bag"]);
  expect(walkActorGrid(s.actors).map((r) => r.actor.name)).toEqual(["anne", "jack"]);
  expect(walkActorGrid(titanicSave({ actors: [["anne", "none"]] }).actors)).toEqual([]);
});

test("a record cut off at the front of its container reads its numbers as zero", () => {
  // the names start at 0, so every numeric field (which sits BEFORE the name) is off the front
  const props = new Uint8Array(158 + 70);
  for (const k of [0, 1]) {
    pstr(props, 158 * k, k ? "bag" : "watch");
    pstr(props, 158 * k + 48, "lit");
    pstr(props, 158 * k + 64, "frank");
  }
  u16(props, 158 - 78, 1); // the second record's visible word is in range
  const grid = walkPropGrid(props);
  expect(grid.map((r) => [r.off, r.prop.visible, r.prop.x])).toEqual([[0, false, 0], [158, true, 0]]);

  const actors = new Uint8Array(160 + 70);
  for (const k of [0, 1]) {
    pstr(actors, 160 * k, k ? "jack" : "anne");
    pstr(actors, 160 * k + 64, "none");
  }
  expect(walkActorGrid(actors).map((r) => [r.actor.name, r.actor.value, r.actor.placement.scale])).toEqual([
    ["anne", 0, 0], ["jack", 0, 0],
  ]);
});

test("the manifest: none in a short container, a count past the end stops, a bad path is empty", () => {
  expect(manifestFiles(new Uint8Array(100))).toEqual([]);
  const s = titanicSave({ files: [[1, "TI:data:bedsit.set"], [2, "x"]] });
  pstr(s.c0, 0x1314 + 0x104, "\u0001");
  u32(s.c0, 0x130c, 9);
  expect(manifestFiles(s.c0)).toEqual([
    { handle: 1, file: "bedsit.set", path: "TI:data:bedsit.set" },
    { handle: 2, file: "", path: "" },
  ]);
});

test("open casts and tracks name their file through the manifest, or by their own name", () => {
  const s = titanicSave({ files: [[5, "TI:cast:extra.cst"]], tracks: ["deck", ""] });
  s.casts = new Uint8Array(28 * 3);
  u32(s.casts, 0, 5);
  pstr(s.casts, 28 + 12, "gang");
  // the third has neither a handle the manifest knows nor a readable name
  pstr(s.casts, 56 + 12, "\u0002x");
  const save = parseSave(titanicBytes(s));
  expect(save.castFiles).toEqual(["extra.cst", "gang"]);
  expect(save.trackFiles).toEqual(["deck"]);
});

test("loops, crickets and walks: junk in a live slot is not a record", () => {
  const s = titanicSave();
  // loops: a kind no command spells, then a real one
  u16(s.loops, 0, 1);
  u16(s.loops, 4, 7);
  u16(s.loops, 42, 1);
  u16(s.loops, 42 + 4, 2);
  pstr(s.loops, 42 + 10, "Watch");
  pstr(s.loops, 42 + 26, "Tick");
  // crickets: live but nameless
  u16(s.crickets, 0, 1);
  // walks: live but nobody walking
  u16(s.walks, 0, 1);
  const save = parseSave(titanicBytes(s));
  expect(save.loops).toEqual([{ kind: "prop", name: "watch", handler: "tick", period: 0, pause: 0 }]);
  expect(save.crickets).toEqual([]);
  expect(save.walks).toEqual([]);
});

test("a route's payload is believed only when its legs add up to its own total", () => {
  const route = (count: number, legs: number[], total: number, size = 20 + 8 * count): Uint8Array => {
    const p = new Uint8Array(size);
    u32(p, 0, total);
    u32(p, 8, count);
    legs.forEach((l, i) => u16(p, 20 + 8 * i + 6, l));
    return p;
  };
  const s = titanicSave();
  const names = ["good", "short", "single", "wrong", "lost"];
  names.forEach((n, k) => {
    u16(s.walks, 110 * k, 1);
    u16(s.walks, 110 * k + 4, 3);
    u32(s.walks, 110 * k + 0x12, 1);
    i32(s.walks, 110 * k + 0x16, 7);
    pstr(s.walks, 110 * k + 0x2e, n);
  });
  // a deferred walk, waiting for its room
  u16(s.walks, 110 * 2 + 6, 1);
  pstr(s.walks, 110 * 2 + 0x4e, "dest");
  s.payloads.push(route(2, [0, 50], 50), new Uint8Array(10), route(1, [0], 0), route(2, [0, 50], 49));
  // "lost" declares a fifth payload the file does not have
  const walks = parseSave(titanicBytes(s)).walks;
  expect(walks.map((w) => [w.actor, w.path?.length, w.dist, w.progress])).toEqual([
    ["good", 2, 50, 7], ["short", undefined, 0, 0], ["single", undefined, 0, 0],
    ["wrong", undefined, 0, 0], ["lost", undefined, 0, 0],
  ]);
  expect(walks[2].deferred).toEqual({ to: "dest", from: "" });
});

test("the theme is the busiest live track, and an earlier one keeps it against a quieter later one", () => {
  const s = titanicSave({ tracks: ["deck", "hall", "quiet"] });
  trackSounds(s, 0, 1, ["d1", "d2"], 180);
  trackSounds(s, 1, 1, ["h1"]);
  const save = parseSave(titanicBytes(s));
  expect(save.theme).toEqual({ track: "deck", volume: 180, extras: 1 });
});

test("a standpoint too short for the frame reads frame 0, and the clock may be a number or absent", () => {
  const s = titanicSave({ vars: [...FILLER, ["clock", 1230]] });
  s.c1 = new Uint8Array(300);
  const save = parseSave(titanicBytes(s));
  expect(save.frame).toBe(0);
  expect(save.clock).toBe("1230");
  expect(parseSave(titanicBytes(titanicSave())).clock).toBe("");
});

// ---- patching --------------------------------------------------------------

test("open casts and banks: long names are refused, duplicates and blanks in the base are dropped", () => {
  const s = titanicSave({ files: [[3, "nopath.cst"]], tracks: ["deck", "deck", ""] });
  s.casts = new Uint8Array(28 * 3);
  pstr(s.casts, 12, "gang");
  pstr(s.casts, 28 + 12, "gang");
  const { list, onDrop } = drops();
  const back = parseSave(applyPatch(readSaveFile(titanicBytes(s)), patchOf({
    casts: ["gang", "extra", "averylongcastname"],
    banks: ["deck", "hall", "averylongbankname1234"],
    onDrop,
  })));
  expect(list).toEqual([
    "cast(averylongcastname): the name is longer than the record's 15 characters",
    "bank(averylongbankname1234): the name is longer than the record's 17 characters",
  ]);
  expect(back.castFiles).toEqual(["gang", "extra"]);
  expect(back.trackFiles).toEqual(["deck", "hall"]);
  // a manifest with no volume-prefixed path gives the new files bare paths
  expect(manifestFiles(back.raw.containers[0].data).map((f) => f.path)).toEqual(["nopath.cst", "gang", "extra", "deck", "hall"]);
});

test("a string the pool cannot hold is reported, for an existing record and a new one", () => {
  const s = titanicSave({ vars: [...FILLER, ["side", "port"]] });
  // the header claims MORE pool than there is: reuse-only, so a new string has nowhere to go
  u32(s.globals, 12, s.pool.length + 100);
  const { list, onDrop } = drops();
  const back = parseSave(applyPatch(readSaveFile(titanicBytes(s)), patchOf({
    strGlobals: new Map([["side", "starboard"], ["hallside", "star"], ["deck", "port"]]),
    onDrop,
  })));
  expect(list).toEqual(["side: no pool room", "hallside: no pool room"]);
  expect(back.strGlobals.get("side")).toBe("port");
  expect(back.strGlobals.get("deck")).toBe("port");
});

test("a base with no variable list cannot take a new record", () => {
  const s = titanicSave({ vars: [] });
  const { list, onDrop } = drops();
  applyPatch(readSaveFile(titanicBytes(s)), patchOf({ numGlobals: new Map([["mission", 2]]), onDrop }));
  expect(list).toEqual(["mission: the base save has no record and no free slot for it"]);
});

test("short manifest and standpoint containers are left alone, and the disc label has to fit", () => {
  const s = titanicSave();
  s.c0 = new Uint8Array(200);
  s.c1 = new Uint8Array(300);
  const { list, onDrop } = drops();
  const back = readSaveFile(applyPatch(readSaveFile(titanicBytes(s)), patchOf({
    disk: "TITANIC2", frame: 99, onDrop,
    setFile: { file: "deck.set", actorRegister: 1, sceneRegister: 2, sceneCount: 3 },
  })));
  expect(list).toEqual(["disk(TITANIC2): longer than the 0-byte label it replaces"]);
  expect([...back.containers[1].data].every((b) => b === 0)).toBe(true);
});

test("a set file with no manifest count, and a CLUT the manifest has no room for", () => {
  const s = titanicSave();
  s.c0 = new Uint8Array(0x1000);
  const { list, onDrop } = drops();
  applyPatch(readSaveFile(titanicBytes(s)), patchOf({
    setFile: { file: "deck.set", actorRegister: 1, sceneRegister: 2, sceneCount: 3 }, onDrop,
  }));
  expect(list).toEqual(["setFile(deck.set): the set id at C1 @544 matches no manifest record"]);

  const t = titanicSave({ files: [[4, "TI:data:bedsit.set"]] });
  u32(t.c1, 544, 4);
  const clut = new Uint8Array(1024).fill(7);
  const back = parseSave(applyPatch(readSaveFile(titanicBytes(t)), patchOf({
    setFile: { file: "Deck.set", actorRegister: 1, sceneRegister: 2, sceneCount: 3, clut },
  })));
  expect(manifestFiles(back.raw.containers[0].data)[0].path).toBe("TI:data:deck.set");
  expect(back.raw.containers[0].data[0xb0c]).toBe(7);
  expect(get32(back.raw.containers[1].data, 652)).toBe(2);
});

test("inventory: a name with no record is skipped, a field off the front of the container is not written", () => {
  const props = new Uint8Array(158 + 70);
  for (const k of [0, 1]) {
    pstr(props, 158 * k, k ? "bag" : "watch");
    pstr(props, 158 * k + 48, "lit");
    pstr(props, 158 * k + 64, "frank");
  }
  const s = titanicSave();
  s.inventory = props;
  const back = parseSave(applyPatch(readSaveFile(titanicBytes(s)), patchOf({
    inventory: [
      { name: "watch", owner: "jack", x: 5 },
      { name: "bag", owner: "frank", visible: true },
      { name: "ghost", owner: "frank" },
    ],
  })));
  expect(back.inventory.map((p) => [p.name, p.owner, p.x, p.visible])).toEqual([
    ["watch", "jack", 0, false], ["bag", "frank", 0, true],
  ]);
});

test("actors: an empty table grows its first record; one with junk in it cannot", () => {
  const a = { name: "anne", owner: "none", value: 3 };
  const s = titanicSave();
  const back = parseSave(applyPatch(readSaveFile(titanicBytes(s)), patchOf({ actors: [a] })));
  // one record is not a grid, so the reader does not see it — but the table grew by one
  expect(back.raw.containers[2].data).toHaveLength(160);
  expect(get32(back.raw.containers[2].data, 72)).toBe(3);

  const t = titanicSave();
  t.actors = new Uint8Array(10);
  const { list, onDrop } = drops();
  applyPatch(readSaveFile(titanicBytes(t)), patchOf({ actors: [a], onDrop }));
  expect(list).toEqual(["actor(anne): no record in the base save and none appendable"]);
});

test("actors: a field off the front of the container is not written", () => {
  const actors = new Uint8Array(160 + 70);
  for (const k of [0, 1]) {
    pstr(actors, 160 * k, k ? "jack" : "anne");
    pstr(actors, 160 * k + 64, "none");
  }
  const s = titanicSave();
  s.actors = actors;
  const back = parseSave(applyPatch(readSaveFile(titanicBytes(s)), patchOf({
    actors: [{ name: "anne", owner: "frank", value: 9 }, { name: "jack", owner: "none", value: 4 }],
  })));
  expect(back.actors.map((x) => [x.name, x.owner, x.value])).toEqual([["anne", "frank", 0], ["jack", "none", 4]]);
  expect(back.raw.containers[2].data[0]).toBe(4); // anne's name is untouched by the write
});

test("a cricket with no pause count is written unpaused", () => {
  const s = titanicSave();
  const cricket = { name: "gull", set: "deck", x: 1, y: 2, radius: 3, base: 4, jitter: 5, next: 6 };
  const back = parseSave(applyPatch(readSaveFile(titanicBytes(s)), patchOf({
    scheduler: { loops: [], crickets: [cricket, { ...cricket, name: "tern", pause: 2 }] },
  })));
  expect(back.crickets.map((c) => [c.name, c.pause])).toEqual([["gull", 0], ["tern", 2]]);
});

test("a cast patch finds its record by name whatever its case", () => {
  const s = titanicSave({ actors: [["anne", "none"], ["jack", "none"]] });
  const back = parseSave(applyPatch(readSaveFile(titanicBytes(s)), patchOf({
    actors: [{ name: "Jack", owner: "frank", value: 1 }],
  })));
  expect(back.actors.map((a) => [a.name, a.owner, a.value])).toEqual([["anne", "none", 0], ["jack", "frank", 1]]);
  expect(get16(back.raw.containers[2].data, ACTOR_NAME_AT(1) - 80 + 72)).toBe(1);
});
