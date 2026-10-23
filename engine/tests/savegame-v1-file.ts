/**
 * Dust's `.rtd` save, read and patched from bytes built here
 * (engine/src/df/savegame-v1.ts): the container map's self-checks and what
 * each refusal says, what odd records read back as (unnamed, half-written,
 * malformed waypoint payloads, headings that name no view), and what a patch
 * writes into records and tables, and what it reports it could not place.
 *
 *   npx vitest run engine/tests/savegame-v1-file.ts
 *
 * No game files: the shipped saves' own round trips are dust/tests/saves.ts.
 */
import { expect, test } from "vitest";
import { readSaveFile } from "@dreamfactory/engine/df/savegame";
import {
  applyPatchV1,
  describeSaveV1,
  parseSaveV1,
  saveTitleMatches,
  type SavedWalkV1,
} from "@dreamfactory/engine/df/savegame-v1";
import { FILLER, dustBytes, dustSave, get16, get32, i32, pstr, u16, u32 } from "./helpers/save-fixtures";

const ACTOR = 164;
const PROP = 158;
const WALK = 82;
const LOOP = 42;
const BALL = 0x30;

test("a save the container count cannot place says which tail it looked for", () => {
  const s = dustSave();
  s.loops = new Uint8Array(10); // no bank count lands the fixed tables
  expect(() => parseSaveV1(dustBytes(s))).toThrow(
    /12 containers proposes 0 sound banks, and 0 values put the loops\/crickets\/walks tables at the tail/,
  );
});

test("three payloads cost what a bank costs, and the fixed tables say which it was", () => {
  // three active walks on routes: 15 containers, which the count alone reads as one bank
  const s = dustSave({ actors: 1 });
  for (let k = 0; k < 3; k++) {
    u16(s.walks, k * WALK, 1);
    u32(s.walks, k * WALK + 36, 0x10000 + k);
    pstr(s.walks, k * WALK + 50, `w${k}`);
    const p = new Uint8Array(32);
    u32(p, 0, 1);
    u16(p, 16, 100 * (k + 1));
    s.payloads.push(p);
  }
  const save = parseSaveV1(dustBytes(s));
  expect(save.index.banks).toBe(0);
  expect(save.walks.map((w) => [w.actor, w.startX, w.hasPath])).toEqual([
    ["w0", 100, true], ["w1", 200, true], ["w2", 300, true],
  ]);
});

test("more banks than container 6 has room for is refused", () => {
  const s = dustSave({ banks: 1 });
  s.banks = new Uint8Array(0);
  expect(() => parseSaveV1(dustBytes(s))).toThrow(/1 sound banks by container count, room for 0 in container 6/);
});

test("payload containers and the walks that declare them have to agree, in both directions", () => {
  const extra = dustSave();
  extra.payloads.push(new Uint8Array(32));
  expect(() => parseSaveV1(dustBytes(extra))).toThrow(
    "v1 save: 1 container past the walks table, but 0 walk slots declare waypoints",
  );
  const missing = dustSave();
  u16(missing.walks, 0, 1);
  u32(missing.walks, 36, 1);
  expect(() => parseSaveV1(dustBytes(missing))).toThrow(
    "v1 save: 0 containers past the walks table, but 1 walk slot declares waypoints",
  );
});

test("the manifest: a count past the container stops, an unreadable path reads as empty", () => {
  const s = dustSave({ files: [[7, "dust:data:nite.set"], [8, "x"]] });
  pstr(s.c0, 0x1214 + 260, "bad\u0001"); // a control character is not a path
  u32(s.c0, 0x120c, 5); // and three more than the container holds
  pstr(s.c0, 0x300, "\u0002\u0003"); // a resource path that is not one
  s.c0[0] = 200; // and a title longer than the bytes behind it can be
  u32(s.c1, 396, 7);
  const save = parseSaveV1(dustBytes(s));
  expect(save.files).toEqual([{ handle: 7, path: "dust:data:nite.set" }, { handle: 8, path: "" }]);
  expect(save.paths.slice(0, 3)).toEqual(["appl:", "dust:data:", ""]);
  expect(save.title).toBe("");
  expect(save.standpoint.setFile).toBe("nite.set");
});

test("cast and prop lists take their extension from the manifest, or the default", () => {
  const s = dustSave({ files: [[1, "appl:local:gang.cst"], [2, "dust:data:hub.prp"]] });
  pstr(s.castFiles, 12, "gang");
  pstr(s.castFiles, 28 + 12, "posse"); // not in the manifest
  pstr(s.propFiles, 12, "hub.prp");
  pstr(s.propFiles, 28 + 12, "house.prp"); // its own extension already, and no record
  const save = parseSaveV1(dustBytes(s));
  expect(save.castFiles).toEqual(["gang.cst", "posse.cst"]);
  expect(save.propFiles).toEqual(["hub.prp", "house.prp"]);
});

test("unnamed cast and prop records are left out, named ones read back", () => {
  const s = dustSave({ actors: 3, props: 3 });
  pstr(s.actors, ACTOR + 84, "dog");
  u16(s.actors, ACTOR + 44, 880);
  pstr(s.props, 2 * PROP + 78, "bone");
  u16(s.props, 2 * PROP + 30, 0);
  u16(s.props, 2 * PROP + 26, 1478);
  const save = parseSaveV1(dustBytes(s));
  expect(save.actors.map((a) => [a.name, a.scale])).toEqual([["dog", 880]]);
  expect(save.props.map((p) => [p.name, p.x])).toEqual([["bone", 1478]]);
});

test("a heading between the four compass points names no view", () => {
  const s = dustSave();
  u16(s.c1, 458, 32);
  expect(parseSaveV1(dustBytes(s)).standpoint.view).toBe("");
  u16(s.c1, 458, 192);
  expect(parseSaveV1(dustBytes(s)).standpoint.view).toBe("north");
});

test("walks: a nameless active slot is skipped, a standing walk is a turn, a bad payload is a straight line", () => {
  const s = dustSave();
  // slot 0: active, but nobody walking it
  u16(s.walks, 0, 1);
  // slot 1: active, going nowhere and not flagged as a turn
  const a = WALK;
  u16(s.walks, a, 1);
  pstr(s.walks, a + 50, "leroy");
  i32(s.walks, a + 20, 0);
  // slot 2: declares a route whose payload is too short to be one
  const b = 2 * WALK;
  u16(s.walks, b, 1);
  pstr(s.walks, b + 50, "jones");
  u32(s.walks, b + 36, 1);
  i32(s.walks, b + 8, 112);
  i32(s.walks, b + 20, 626);
  i32(s.walks, b + 40, -5);
  s.payloads.push(new Uint8Array(8));
  // slot 3: declares one whose count runs past its container
  const c = 3 * WALK;
  u16(s.walks, c, 1);
  pstr(s.walks, c + 50, "pig");
  u32(s.walks, c + 36, 1);
  const p = new Uint8Array(16);
  u32(p, 0, 4);
  s.payloads.push(p);
  // slot 4: a real straight walk, moving
  const d = 4 * WALK;
  u16(s.walks, d, 1);
  pstr(s.walks, d + 50, "cow");
  i32(s.walks, d + 8, -10);
  i32(s.walks, d + 20, 10);
  u16(s.walks, d + 44, 1);
  const walks = parseSaveV1(dustBytes(s)).walks;
  expect(walks.map((w) => w.actor)).toEqual(["leroy", "jones", "pig", "cow"]);
  expect(walks[0]).toMatchObject({ turnOnly: true, hasPath: false, waiting: true });
  // declared but unreadable: the record's own straight line, still marked as routed
  expect(walks[1]).toMatchObject({ dx: -112, dist: 626, progress: 0, hasPath: true, turnOnly: false });
  expect(walks[1].path).toBeUndefined();
  expect(walks[2]).toMatchObject({ hasPath: true, turnOnly: true });
  expect(walks[3]).toMatchObject({ dx: 10, turnOnly: false, waiting: false });
});

test("loops with a kind no command spells, or no handler, are junk in a free slot", () => {
  const s = dustSave();
  const arm = (i: number, kind: number, name: string, handler: string) => {
    u16(s.loops, i * LOOP, 1);
    u16(s.loops, i * LOOP + 4, kind);
    pstr(s.loops, i * LOOP + 10, name);
    pstr(s.loops, i * LOOP + 26, handler);
  };
  arm(0, 9, "x", "tick");
  arm(1, 1, "dog", "");
  arm(2, 4, "", "clock");
  u16(s.loops, 2 * LOOP + 2, 2);
  u32(s.loops, 2 * LOOP + 6, 30);
  expect(parseSaveV1(dustBytes(s)).loops).toEqual([
    { kind: "flat", name: "", handler: "clock", period: 30, paused: true, pauseDepth: 2 },
  ]);
});

test("a save's one-line description falls back where the save says nothing", () => {
  const s = dustSave();
  pstr(s.c1, 482, "town");
  u16(s.c1, 450, 3);
  u16(s.c1, 458, 5);
  const bare = describeSaveV1(parseSaveV1(dustBytes(s)));
  expect(bare).toBe("dust 0.3 · town.set (0,0) facing 3 · frame 0 · day ? · $? · 0 cast, 0 props, 0 loops");

  const t = dustSave({ files: [[3, "dust:data:nite.set"], [4, "appl:sheriff.pup"]], vars: [...FILLER, ["day", 2], ["playercash", 40]] });
  u32(t.c1, 396, 3);
  u32(t.c1, 506, 4);
  u16(t.c1, 458, 0);
  u32(t.c1, 248, 167);
  expect(describeSaveV1(parseSaveV1(dustBytes(t)))).toBe(
    "dust 0.3 · nite.set (0,0) facing east · frame 167 · day 2 · $40 · 0 cast, 0 props, 0 loops · sheriff.pup open",
  );
  expect(saveTitleMatches(" Dust 0.3", "dust 0.3 ")).toBe(true);
  expect(saveTitleMatches("dust 0.2", "dust 0.3")).toBe(false);
});

// ---- patching --------------------------------------------------------------

test("a global with no home is reported, and a base without a list cannot grow one", () => {
  const dropped: string[] = [];
  const onDrop = (name: string, why: string) => void dropped.push(`${name}: ${why}`);
  const s = dustSave();
  applyPatchV1(readSaveFile(dustBytes(s)), {
    numGlobals: new Map([["averyveryverylongname", 1]]),
    onDrop,
  });
  expect(dropped).toEqual(["averyveryverylongname: longer than a record's 15 characters"]);

  const bare = dustSave({ vars: [] });
  dropped.length = 0;
  applyPatchV1(readSaveFile(dustBytes(bare)), {
    numGlobals: new Map([["day", 3]]),
    strGlobals: new Map([["handitem", "bone"]]),
    onDrop,
  });
  expect(dropped).toEqual([
    "day: no record and no free node in the base",
    "handitem: no record and no free node in the base",
  ]);
  // and with no onDrop at all, the same patch is simply quiet
  expect(() =>
    applyPatchV1(readSaveFile(dustBytes(bare)), { numGlobals: new Map([["day", 3]]) }),
  ).not.toThrow();
});

test("without the interpreter's word, a boolean slot keeps its tag for 0 and 1 only", () => {
  const s = dustSave({ vars: [...FILLER, ["flag", true], ["other", true]] });
  const back = parseSaveV1(
    applyPatchV1(readSaveFile(dustBytes(s)), { numGlobals: new Map([["flag", 0], ["other", 7]]) }),
  );
  expect(back.boolGlobals.has("flag")).toBe(true);
  expect(back.numGlobals.get("flag")).toBe(0);
  expect(back.boolGlobals.has("other")).toBe(false);
  expect(back.numGlobals.get("other")).toBe(7);
});

test("a standpoint block too short to be one is left alone", () => {
  const s = dustSave();
  s.c1 = new Uint8Array(100);
  const back = readSaveFile(
    applyPatchV1(readSaveFile(dustBytes(s)), {
      numGlobals: new Map(),
      standpoint: { set: "town", setFile: "town.set", cellX: 1, cellZ: 2, facing: 1, deg: 0, camX: 0, camY: 0 },
      openSet: { transitionRegister: 1, actorRegister: 2, eyeHeight: 62, cameraSetback: 64 },
    }),
  );
  expect([...back.containers[1].data]).toEqual(new Array(100).fill(0));
});

test("the set file is renamed in the manifest, keeping its volume — or reported when the manifest lacks it", () => {
  const sp = { set: "mayor", setFile: "MayUpper.set", cellX: 6, cellZ: 14, facing: 3, deg: 128, camX: 0, camY: 0 };
  const open = { transitionRegister: 5, actorRegister: 9, eyeHeight: 130, cameraSetback: 64 };
  const s = dustSave({ files: [[1, "bad\u0001"], [2, "nite.set"]] });
  u32(s.c1, 396, 2);
  const back = parseSaveV1(applyPatchV1(readSaveFile(dustBytes(s)), { numGlobals: new Map(), standpoint: sp, openSet: open }));
  // no volume prefix to keep; the name is lowercased
  expect(back.standpoint.setFile).toBe("mayupper.set");
  expect(back.standpoint.eyeHeight).toBe(130);
  // facing 3 stands the eye back along −x
  const c1 = back.raw.containers[1].data;
  expect([get16(c1, 472), get16(c1, 474), get16(c1, 476)]).toEqual([6 * 256 + 128 - 64, 14 * 256 + 128, 130]);
  expect([get32(c1, 404), get32(c1, 416)]).toEqual([5, 9]);

  // a manifest record whose path is not a string is still the record: it gets the bare name
  const t = dustSave({ files: [[1, "bad\u0001"]] });
  u32(t.c1, 396, 1);
  expect(parseSaveV1(applyPatchV1(readSaveFile(dustBytes(t)), { numGlobals: new Map(), standpoint: sp })).files[0].path)
    .toBe("mayupper.set");

  const dropped: string[] = [];
  const u = dustSave({ files: [[1, "dust:data:nite.set"]] });
  u32(u.c1, 396, 2);
  u32(u.c0, 0x120c, 3); // claims records past its end
  applyPatchV1(readSaveFile(dustBytes(u)), {
    numGlobals: new Map(), standpoint: sp, onDrop: (n, why) => void dropped.push(`${n}: ${why}`),
  });
  expect(dropped).toEqual(["MayUpper.set: the base's manifest has no record for the open set"]);

  // and a base with no set file open has nothing to rename
  const v = dustSave({ files: [[1, "dust:data:nite.set"]] });
  const kept = parseSaveV1(applyPatchV1(readSaveFile(dustBytes(v)), { numGlobals: new Map(), standpoint: sp }));
  expect(kept.files[0].path).toBe("dust:data:nite.set");
});

test("prop and cast patches write every field they carry, and leave the rest", () => {
  const s = dustSave({ actors: 2, props: 2 });
  pstr(s.props, 78, "Bone");
  u16(s.props, 38, 4); // speed, which the patch leaves
  pstr(s.actors, 84, "Dog");
  u16(s.actors, 44, 880); // scale, which the patch leaves
  const back = parseSaveV1(
    applyPatchV1(readSaveFile(dustBytes(s)), {
      numGlobals: new Map(),
      props: [{ name: "bone", owner: "frank", visible: true, tileX: 5, tileY: 14 }],
      actors: [{ name: "dog", is3d: true, anchorX: 10, anchorY: 20, dist: -1, tileX: 6, tileY: 10 }],
    }),
  );
  expect(back.props[0]).toMatchObject({ name: "Bone", owner: "frank", visible: true, tileX: 5, tileY: 14, speed: 4 });
  expect(back.actors[0]).toMatchObject({ name: "Dog", is3d: true, anchorX: 10, anchorY: 20, dist: -1, tileX: 6, tileY: 10, scale: 880 });
});

test("loops: a pause depth defaults to one, a running loop has none", () => {
  const s = dustSave();
  const loops = [
    { kind: "actor", name: "dog", handler: "bark", period: 10, paused: true },
    { kind: "prop", name: "bone", handler: "spin", period: 2, paused: true, pauseDepth: 3 },
    { kind: "scene", name: "", handler: "tick", period: 1 },
  ];
  const back = parseSaveV1(applyPatchV1(readSaveFile(dustBytes(s)), { numGlobals: new Map(), loops }));
  expect(back.loops.map((l) => [l.kind, l.paused, l.pauseDepth])).toEqual([
    ["actor", true, 1], ["prop", true, 3], ["scene", false, 0],
  ]);
});

test("balls: a slot outside the table is reported, a ball with no prop record points at slot 0", () => {
  const s = dustSave({ props: 3 });
  pstr(s.props, 2 * PROP + 78, "rock");
  const dropped: string[] = [];
  const ball = { pause: 0, vx: 1, vy: 2, vz: 3, gravity: -1, bounce: 50, frames: 20, deg: 0, x: 9, y: 8, z: 7, tx: 0, ty: 0 };
  const back = parseSaveV1(
    applyPatchV1(readSaveFile(dustBytes(s)), {
      numGlobals: new Map(),
      balls: [
        { ...ball, slot: 0, name: "rock" },
        { ...ball, slot: 3, name: "ghost" },
        { ...ball, slot: 16, name: "far" },
        { ...ball, slot: -1, name: "neg" },
      ],
      onDrop: (n, why) => void dropped.push(`${n}: ${why}`),
    }),
  );
  expect(dropped).toEqual(["far: ball slot 16 is not in the table", "neg: ball slot -1 is not in the table"]);
  expect(back.balls.map((b) => [b.slot, b.name, b.active, b.vz])).toEqual([[0, "rock", true, 3], [3, "ghost", true, 3]]);
  const cb = back.raw.containers[back.index.crickets].data;
  expect([get32(cb, 0x1c), get32(cb, 3 * BALL + 0x1c)]).toEqual([2, 0]);
});

test("walks: paused walks keep their depth, at least one", () => {
  const s = dustSave();
  pstr(s.actors, 84, "leroy");
  const walk = (actor: string, extra: Partial<SavedWalkV1>): SavedWalkV1 => ({
    actor, star: "town.jail", startX: 300, startY: 600, startZ: 0, dx: 10, dy: 0, dz: 0, dist: 10,
    progress: 4, turnTo: -1, deg: 0, turnOnly: false, hasPath: false, ...extra,
  });
  const back = parseSaveV1(
    applyPatchV1(readSaveFile(dustBytes(s)), {
      numGlobals: new Map(),
      walks: [walk("leroy", { paused: true }), walk("stranger", { paused: true, pauseDepth: 4 }), walk("jones", {})],
    }),
  );
  expect(back.walks.map((w) => [w.actor, w.paused, w.pauseDepth])).toEqual([
    ["leroy", true, 1], ["stranger", true, 4], ["jones", false, 0],
  ]);
});

test("the eye stands back along +x facing 4, and on the cell itself for a facing that is none of the four", () => {
  const eye = (facing: number) => {
    const s = dustSave();
    const back = parseSaveV1(applyPatchV1(readSaveFile(dustBytes(s)), {
      numGlobals: new Map(),
      standpoint: { set: "town", cellX: 2, cellZ: 3, facing, deg: 0, camX: 0, camY: 0 },
      openSet: { transitionRegister: 0, actorRegister: 0, eyeHeight: 62, cameraSetback: 64 },
      props: [{ name: "nobody", view: "x" }],
    }));
    const c1 = back.raw.containers[1].data;
    return [get16(c1, 472), get16(c1, 474)];
  };
  expect(eye(4)).toEqual([2 * 256 + 128 + 64, 3 * 256 + 128]);
  expect(eye(0)).toEqual([2 * 256 + 128, 3 * 256 + 128]);
});

test("a patch that names only some fields leaves the record's others as they were", () => {
  const s = dustSave();
  pstr(s.props, 78, "bone");
  pstr(s.props, 142, "frank");
  u16(s.props, 0, 1);
  pstr(s.actors, 84, "dog");
  u16(s.actors, 18, 1);
  const back = parseSaveV1(applyPatchV1(readSaveFile(dustBytes(s)), {
    numGlobals: new Map(),
    props: [{ name: "bone", x: 3 }],
    actors: [{ name: "dog", x: 4 }],
  }));
  expect(back.props[0]).toMatchObject({ owner: "frank", visible: true, x: 3 });
  expect(back.actors[0]).toMatchObject({ is3d: true, x: 4 });
});
