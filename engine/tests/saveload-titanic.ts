/**
 * Titanic's save and load through a running session
 * (engine/src/runtime/saveload.ts), on a cast built here and a base save
 * built from nothing: what a snapshot writes for the walks, cast and props the
 * world has, what it does without a base, and what a load restores, resumes,
 * re-instances or stands still.
 *
 *   npx vitest run engine/tests/saveload-titanic.ts
 *
 * No game files: the game's own round trips are taoot/tests/auto/savegame.ts.
 */
import { expect, test } from "vitest";
import { writeContainerFile } from "@dreamfactory/engine/df/container";
import { buildCstFile } from "@dreamfactory/engine/df/cst-build";
import { buildShpBytes } from "@dreamfactory/engine/df/shp-build";
import type { ShpFrame } from "@dreamfactory/engine/df/shp";
import { parseSave } from "@dreamfactory/engine/df/savegame-read";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { loadGame, restoreActors, restoreProps, restoredNumber, saveBase, snapshotSave } from "@dreamfactory/engine/runtime/saveload";
import { Logic } from "@dreamfactory/engine/runtime/interp";
import { FILLER, i32, pstr, titanicBytes, titanicSave, u16, u32 } from "./helpers/save-fixtures";

const dot: ShpFrame = { width: 1, height: 1, posXraw: 0, posYraw: 0, indexed: new Uint8Array([1]), opaque: new Uint8Array([1]) };
const dirs = () => Array.from({ length: 8 }, () => dot);

/** a cast of four: anne (who has a `standlj`), jack, kate and mary */
const CAST = writeContainerFile(buildCstFile({
  palette: [0, 0, 0, 255, 255, 255],
  members: [
    { name: "anne", poses: [{ name: "stand", steps: [dirs()] }, { name: "standlj", steps: [dirs()] }, { name: "walklj", steps: [dirs()] }] },
    { name: "jack", poses: [{ name: "stand", steps: [dirs()] }, { name: "walk", steps: [dirs()] }] },
    { name: "kate", poses: [{ name: "stand", steps: [dirs()] }] },
    { name: "mary", poses: [{ name: "stand", steps: [dirs()] }] },
  ],
}).file);

/** a shop of two props: a watch with two views, and a bag */
const SHOP = buildShpBytes({
  palette: [0, 0, 0, 255, 255, 255],
  groups: [
    { name: "watch", states: [{ identifier: "lit", frames: [{ art: dot }] }, { identifier: "dark", frames: [{ art: dot }, { art: dot }] }] },
    { name: "bag", states: [{ identifier: "shut", frames: [{ art: dot }] }] },
  ],
});

async function session(template?: Uint8Array | null) {
  const s = new GameSession((name) => ({ "gang.cst": CAST, "t.shp": SHOP })[name.toLowerCase()] ?? null, new NullAudioSink());
  const logs: string[] = [];
  s.onLog = (l) => void logs.push(l);
  if (template !== undefined) s.saveTemplate = () => template;
  await s.openCastFile("gang.cst");
  return { s, logs };
}

/** a base with the gang's three records, so every actor has a place to be written */
function base() {
  const t = titanicSave({ actors: [["anne", "none"], ["jack", "none"], ["kate", "none"]], files: [[1, "TI:data:gang.cst"]] });
  return titanicBytes(t);
}

test("no base, or a base that is not a save: nothing to write", async () => {
  expect(snapshotSave((await session()).s)).toBeNull();
  const { s, logs } = await session(new Uint8Array(1536));
  expect(saveBase(s)).toBeNull();
  expect(logs.at(-1)).toMatch(/^savegame: bad template: not a save file/);
});

test("a boolean global comes back typed or untyped, as the interpreter keeps them", async () => {
  const { s } = await session();
  const bools = new Set(["flag"]);
  expect(restoredNumber(s, bools, "flag", 5)).toEqual(new Logic(5));
  expect(restoredNumber(s, bools, "count", 5)).toBe(5);
  s.interp.typed = false;
  expect(restoredNumber(s, bools, "flag", 5)).toBe(s.interp.bool(true));
  expect(restoredNumber(s, bools, "flag", 0)).toBe(s.interp.bool(false));
});

test("a snapshot writes every kind of walk the scheduler can hold", async () => {
  const { s, logs } = await session(base());
  const anne = s.actorRuntime.get("anne")!;
  anne.deg = 40;
  anne.starName = "bed";
  const W = s.scheduler.walks;
  const rec = (slot: number, extra: object) => ({ slot, sx: 10, sy: 20, sz: 0, dx: 5, dy: 0, dz: 0, dist: 5, progress: 2.4, paused: false, ...extra });
  // waiting for its room, by star and by route; paused with and without a depth
  W.set("anne", rec(0, { deferred: () => {}, arriveStar: "door", paused: true, deg: 7 }));
  W.set("jack", rec(1, { deferred: () => {}, deferredMode: 3, deferredFrom: "start", paused: true, pauseDepth: 2 }));
  W.set("kate", rec(2, { deferred: () => {} }));
  // a turn on the spot, a straight line, a route, a road
  W.set("kate2", rec(3, { turnOnly: true, paused: true }));
  W.set("ghost", rec(4, { arriveStar: "deck", paused: true, pauseDepth: 3, turnTo: 64, deg: 9 }));
  const path = [{ x: 0, y: 0, z: 0, cum: 0 }, { x: 30, y: 40, z: 0, cum: 50 }];
  W.set("anne2", rec(5, { path }));
  W.set("jack2", rec(6, { path, roadMode: 4 }));
  // anne turning: her own star is where she ends
  W.delete("kate2");
  W.set("anne", rec(3, { turnOnly: true }));
  const bytes = snapshotSave(s)!;
  const walks = parseSave(bytes).walks;
  expect(walks.map((w) => [w.actor, w.type, w.paused, w.pause, w.deg, w.star])).toEqual([
    ["jack", 3, true, 2, 0, "start"],
    ["kate", 1, false, 0, 0, ""],
    ["anne", 0, false, 0, 40, "bed"],
    ["ghost", 1, true, 3, 9, "deck"],
    ["anne2", 3, false, 0, 0, ""],
    ["jack2", 4, false, 0, 0, ""],
  ]);
  expect(walks[0].deferred).toEqual({ to: "", from: "start" });
  expect(walks[4].path?.at(-1)?.cum).toBe(50);
  // the deferred walks wrote no progress; the rest rounded theirs
  expect(walks[3].progress).toBe(2);
  expect(logs.filter((l) => l.startsWith("savegame:"))).toEqual([]);
});

test("a deferred walk with no depth writes one; no set open writes no set file", async () => {
  const { s } = await session(base());
  s.scheduler.walks.set("anne", { slot: 0, sx: 0, sy: 0, sz: 0, dx: 0, dy: 0, dz: 0, dist: 1, progress: 0, paused: true, deferred: () => {} });
  const walks = parseSave(snapshotSave(s)!).walks;
  expect(walks.map((w) => [w.actor, w.type, w.pause, w.deferred])).toEqual([["anne", 1, 1, { to: "", from: "" }]]);
});

test("cast and props: an odd value is written as 0, a blank owner as none", async () => {
  const { s, logs } = await session(base());
  const anne = s.actorRuntime.get("anne")!;
  anne.value = Number.NaN;
  anne.owner = "";
  const jack = s.actorRuntime.get("jack")!;
  jack.value = 12;
  jack.owner = "Frank";
  const back = parseSave(snapshotSave(s)!);
  expect(back.actors.map((a) => [a.name, a.owner, a.value])).toEqual([
    ["anne", "none", 0], ["jack", "frank", 12], ["kate", "none", 0],
  ]);
  expect(logs.filter((l) => l.startsWith("savegame:"))).toEqual([]);
});

test("one thing the base cannot carry is reported in the singular, several in the plural", async () => {
  const { s, logs } = await session(base());
  s.interp.globals.set("averyveryverylongglobal", 1);
  snapshotSave(s);
  expect(logs.at(-1)).toMatch(/^savegame: written, but 1 item could not be carried — averyveryverylongglobal/);
  s.interp.globals.set("anotherveryverylongglobal", 1);
  snapshotSave(s);
  expect(logs.at(-1)).toMatch(/^savegame: written, but 2 items could not be carried/);
});

// ---- loading -----------------------------------------------------------------

function loadable(edit: (t: ReturnType<typeof titanicSave>) => void = () => {}, disk = "TITANIC9") {
  const t = titanicSave({
    actors: [["anne", "none"], ["jack", "none"], ["kate", "none"]],
    files: [[1, "TI:data:gang.cst"]],
    vars: [...FILLER, ["flag", true]],
    disk,
  });
  t.casts = new Uint8Array(28);
  u32(t.casts, 0, 1);
  pstr(t.c1, 596, "bedsit");
  edit(t);
  return titanicBytes(t);
}

test("a load refuses a file that is not a save, and one from another version", async () => {
  const { s, logs } = await session();
  expect(await loadGame(s, new Uint8Array(100))).toBe(false);
  expect(logs.at(-1)).toMatch(/^opengame: not a valid saved game file/);
  const t = titanicSave({ title: "Titanic 0.9" });
  expect(await loadGame(s, titanicBytes(t))).toBe(false);
  expect(logs.at(-1)).toBe('opengame: saved game is from a different version ("Titanic 0.9")');
});

test("a load restores the cast's placement, keeping what a zero would lose", async () => {
  const { s, logs } = await session();
  Object.defineProperty(s, "discVolumes", { get: () => ["titanic1", "titanic2"] });
  const bytes = loadable((t) => {
    // anne placed, with no pose, speed, turn or scale; jack placed with all of them
    const A = 80;
    pstr(t.actors, A + 16, "bedsit");
    u16(t.actors, A - 80, 1);
    const J = 160 + 80;
    pstr(t.actors, J + 16, "deck");
    pstr(t.actors, J + 48, "walk");
    u16(t.actors, J - 80 + 38, 6);
    u16(t.actors, J - 80 + 32, 10);
    u16(t.actors, J - 80 + 42, 900);
  });
  const anne = s.actorRuntime.get("anne")!;
  anne.speed = 4;
  anne.turn = 16;
  expect(await loadGame(s, bytes)).toBe(true);
  expect(s.mountedCd).toBe("");
  expect(logs).toContain('loadgame: saved on "TITANIC9", which is not a disc this game mounts');
  const a = s.actorRuntime.get("anne")!;
  expect([a.setName, a.poseName, a.speed, a.turn, a.visible]).toEqual(["bedsit", "stand", 4, 16, true]);
  const j = s.actorRuntime.get("jack")!;
  expect([j.setName, j.poseName, j.speed, j.turn, j.scale]).toEqual(["deck", "walk", 6, 10, 900]);
  expect(s.interp.globals.get("flag")).toBe(true);
});

test("a load resumes the walks it can and stands the rest where they were saved", async () => {
  const { s, logs } = await session();
  const built: string[] = [];
  s.deferredWalkBuilder = (actor, mode, to, from) => {
    built.push(`${actor}:${mode}:${to}:${from}`);
    return actor === "kate" ? null : () => {};
  };
  const bytes = loadable((t) => {
    const walk = (k: number, actor: string, type: number, extra: (o: number) => void = () => {}) => {
      const o = 110 * k;
      u16(t.walks, o, 1);
      u16(t.walks, o + 4, type);
      pstr(t.walks, o + 0x2e, actor);
      extra(o);
    };
    // anne waits for her room, paused twice
    walk(0, "anne", 1, (o) => {
      u16(t.walks, o + 6, 1);
      u16(t.walks, o + 2, 2);
      pstr(t.walks, o + 0x4e, "door");
    });
    // kate's room cannot build one: she walks a straight line instead, to her star
    walk(1, "kate", 1, (o) => {
      u16(t.walks, o + 6, 1);
      i32(t.walks, o + 0x26, 10);
      pstr(t.walks, o + 0x3e, "deck");
    });
    // jack on a road with no readable route: stood still, out of his walk pose
    walk(2, "jack", 4, (o) => u32(t.walks, o + 0x12, 1));
    // nobody of that name, deferred or not; and a turn
    walk(3, "nobody", 1);
    walk(6, "nobody", 1, (o) => u16(t.walks, o + 6, 1));
    walk(4, "mary", 0);
    // anne again, saved mid-stride with no route: she stands, in her own standing pose
    walk(7, "anne", 4, (o) => u32(t.walks, o + 0x12, 1));
    // both placed in a walk pose
    pstr(t.actors, 80 + 16, "bedsit");
    pstr(t.actors, 80 + 48, "walklj");
    pstr(t.actors, 240 + 16, "bedsit");
    pstr(t.actors, 240 + 48, "walklj");
    // a walk on a route that is readable, as a road
    walk(5, "kate", 5, (o) => u32(t.walks, o + 0x12, 1));
    const route = new Uint8Array(36);
    u32(route, 0, 50);
    u32(route, 8, 2);
    u16(route, 28 + 6, 50);
    t.payloads.push(new Uint8Array(4), route, new Uint8Array(4));
  }, "");
  expect(await loadGame(s, bytes)).toBe(true);
  // asked for both deferred walks; kate's room had no builder for hers
  expect(built).toEqual(["anne:1:door:", "kate:1::"]);
  expect(logs.filter((l) => l.startsWith("loadgame:"))).toEqual([
    'loadgame: kate was saved walking to "deck" — resuming it',
    "loadgame: jack was saved mid-walk — standing them at their saved position",
    "loadgame: nobody was saved mid-walk — standing them at their saved position",
    "loadgame: mary was saved mid-turn — resuming it",
    'loadgame: kate was saved walking to "" — resuming it',
    "loadgame: nobody was saved mid-walk — standing them at their saved position",
    "loadgame: anne was saved mid-walk — standing them at their saved position",
  ]);
  expect(s.actorRuntime.get("anne")!.poseName).toBe("standlj");
  expect(s.actorRuntime.get("jack")!.poseName).toBe("stand");
});

test("restoring a record whose name extends a cast member re-instances it; one with no source is dropped", async () => {
  const { s, logs } = await session();
  const placement = { visible: true, set: "", star: "", pose: "", deg: 0, x: 0, y: 0, z: 0, speed: 0, turn: 0, scale: 0, zclip: 0 };
  restoreActors(s, [
    { name: "anne7", owner: "frank", value: 2, placement },
    { name: "zz", owner: "none", value: 0, placement },
  ]);
  expect(s.actorRuntime.get("anne7")?.owner).toBe("frank");
  expect(logs).toContain('loadgame: no cast member to re-instance "zz" from — dropped');
});

test("a save taken on the second disc mounts it before the load reads a room", async () => {
  const { s } = await session();
  Object.defineProperty(s, "discVolumes", { get: () => ["titanic1", "titanic2"] });
  const discs: number[] = [];
  s.onDiscChange = (d) => void discs.push(d);
  const t = titanicSave({ disk: "TITANIC2" });
  pstr(t.c1, 596, "bedsit");
  expect(await loadGame(s, titanicBytes(t))).toBe(true);
  expect(discs).toEqual([2]);
  expect(s.mountedCd).toBe("TITANIC2");
});

test("props: a snapshot writes a blank owner as none and an odd value as 0; a world prop its world position", async () => {
  const t = titanicSave({ props: [["watch", "lit", "frank"], ["bag", "shut", "frank"]] });
  const { s, logs } = await session(titanicBytes(t));
  await s.openShop("t.shp");
  const watch = s.propRuntime.get("watch")!;
  Object.assign(watch, { owner: "", value: Number.POSITIVE_INFINITY, worldSpace: true, worldX: 300, worldY: 200, worldZ: 10, stateName: "dark" });
  const bag = s.propRuntime.get("bag")!;
  Object.assign(bag, { owner: "Jack", value: 3, anchorX: 40, anchorY: 50, setName: "Deck", starName: "Rail" });
  const back = parseSave(snapshotSave(s)!).inventory;
  expect(logs.filter((l) => l.startsWith("savegame:"))).toEqual([]);
  expect(back.map((p) => [p.name, p.owner, p.value, p.view, p.is3d, p.worldX, p.x, p.set, p.star])).toEqual([
    ["watch", "none", 0, "dark", true, 300, 0, "", ""],
    ["bag", "jack", 3, "shut", false, 0, 40, "deck", "rail"],
  ]);
});

test("props: a restored view the shop does not have leaves no frames to play", async () => {
  const { s } = await session();
  await s.openShop("t.shp");
  const saved = (name: string, view: string) => ({
    name, view, owner: "frank", set: "", star: "", visible: true, is3d: false,
    x: 1, y: 2, worldX: 0, worldY: 0, worldZ: 0, deg: 0, dist: 0, scale: 0, value: 0, zclip: 0,
  });
  const watch = s.propRuntime.get("watch")!;
  watch.degVariants = true;
  restoreProps(s, [saved("watch", "gone"), saved("bag", "gone"), saved("watch2", "lit")]);
  expect([watch.frameIdx, watch.frameLocked, watch.animating]).toEqual([0, true, false]);
  const bag = s.propRuntime.get("bag")!;
  expect([bag.frameOrder, bag.animating, bag.anchorX]).toEqual([null, false, 1]);
  // and the two-frame view picks a frame by heading rather than playing
  restoreProps(s, [saved("watch", "dark")]);
  expect(watch.frameLocked).toBe(true);
});

test("a snapshot of what a script left half-said: paused with no depth, a theme with no table, a set it cannot read", async () => {
  const { s, logs } = await session(base());
  s.scheduler.loops.push({ kind: "actor", name: "anne", handler: "tick", count: 5, period: 5, paused: true });
  s.scheduler.crickets.table.push({
    name: "gull", x: 1, y: 2, radius: 3, base: 4, jitter: 5, count: 6, paused: true, setName: "deck", handle: null, armed: true,
  } as never);
  const W = s.scheduler.walks;
  // a turn by someone with no actor, and a line with no depth or facing of its own
  W.set("nobody", { slot: 0, sx: 0, sy: 0, sz: 0, dx: 0, dy: 0, dz: 0, dist: 1, progress: 0, paused: false, turnOnly: true });
  W.set("jack", { slot: 1, sx: 0, sy: 0, sz: 0, dx: 4, dy: 0, dz: 0, dist: 4, progress: 1, paused: true });
  W.set("ghost", { slot: 2, sx: 0, sy: 0, sz: 0, dx: 0, dy: 0, dz: 0, dist: 1, progress: 0, paused: false, deferred: () => {} });
  s.interp.globals.delete("themevolume");
  s.currentThemeName = "deck";
  s.currentSetFile = "nowhere";
  const back = parseSave(snapshotSave(s)!);
  expect(logs).toContain("savegame: nowhere.set is not readable — the base save's set file record is kept");
  expect(back.loops.map((l) => [l.name, l.pause])).toEqual([["anne", 1]]);
  expect(back.crickets.map((c) => [c.name, c.pause, c.armed])).toEqual([["gull", 1, true]]);
  expect(back.walks.map((w) => [w.actor, w.type, w.star, w.pause, w.deg])).toEqual([
    ["nobody", 0, "", 0, 0], ["jack", 1, "", 1, 0], ["ghost", 1, "", 0, 0],
  ]);
  // the theme's bank is not open, so there was nothing to write it into
  expect(logs.some((l) => /theme\(deck\)/.test(l))).toBe(true);
});
