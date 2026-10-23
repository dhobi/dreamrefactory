/**
 * Dust's save and load through a running session
 * (engine/src/runtime/saveload-v1.ts), on a cast and a shop built here and a
 * base save built from nothing: what a snapshot writes for a cast member that
 * is and is not dressed, a prop mid-animation and the walks in flight, what it
 * reports when the room's set file cannot be read, and what a load resumes,
 * keeps waiting, or stands up.
 *
 *   npx vitest run engine/tests/saveload-dust.ts
 *
 * No game files: the shipped saves' own round trips are dust/tests/saves.ts.
 */
import { expect, test } from "vitest";
import { writeContainerFile } from "@dreamfactory/engine/df/container";
import { buildCstFile } from "@dreamfactory/engine/df/cst-build";
import { buildShpBytes } from "@dreamfactory/engine/df/shp-build";
import type { ShpFrame } from "@dreamfactory/engine/df/shp";
import { parseSaveV1 } from "@dreamfactory/engine/df/savegame-v1";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { loadGameV1, snapshotSaveV1 } from "@dreamfactory/engine/runtime/saveload-v1";
import { dustBytes, dustSave, FILLER, i32, pstr, u16, u32, type DustSave } from "./helpers/save-fixtures";

const dot: ShpFrame = { width: 1, height: 1, posXraw: 0, posYraw: 0, indexed: new Uint8Array([1]), opaque: new Uint8Array([1]) };
const dirs = () => Array.from({ length: 8 }, () => dot);

const CAST = writeContainerFile(buildCstFile({
  palette: [0, 0, 0, 255, 255, 255],
  members: [
    { name: "leroy", poses: [{ name: "stand", steps: [dirs()] }, { name: "standlj", steps: [dirs()] }, { name: "walklj", steps: [dirs()] }] },
    { name: "dog", poses: [{ name: "stand", steps: [dirs()] }, { name: "walk", steps: [dirs()] }] },
    { name: "cow", poses: [{ name: "stand", steps: [dirs()] }] },
  ],
}).file);

const SHOP = buildShpBytes({
  palette: [0, 0, 0, 255, 255, 255],
  groups: [
    { name: "weed", states: [{ identifier: "roll", frames: [{ art: dot }, { art: dot }, { art: dot }] }] },
    { name: "bone", states: [{ identifier: "lie", frames: [{ art: dot }] }] },
  ],
});

async function session(template?: Uint8Array | null, extra: Record<string, Uint8Array> = {}) {
  const files: Record<string, Uint8Array> = { "gang.cst": CAST, "house.prp": SHOP, ...extra };
  const s = new GameSession((name) => files[name.toLowerCase()] ?? null, new NullAudioSink());
  const logs: string[] = [];
  s.onLog = (l) => void logs.push(l);
  if (template !== undefined) s.saveTemplate = () => template;
  await s.openCastFile("gang.cst");
  await s.openShop("house.prp");
  return { s, logs };
}

/** a base with the gang's records and the shop's, so every patch has a place to land */
function base(edit: (d: DustSave) => void = () => {}): Uint8Array {
  const d = dustSave({ actors: 3, props: 2, files: [[1, "appl:local:gang.cst"], [2, "dust:data:house.prp"]] });
  ["leroy", "dog", "cow"].forEach((n, k) => pstr(d.actors, 164 * k + 84, n));
  ["weed", "bone"].forEach((n, k) => pstr(d.props, 158 * k + 78, n));
  pstr(d.castFiles, 12, "gang");
  pstr(d.propFiles, 12, "house");
  edit(d);
  return dustBytes(d);
}

test("no base, no save", async () => {
  expect(snapshotSaveV1((await session()).s)).toBeNull();
});

test("a snapshot writes a dressed cast member's world and an undressed one's flags alone", async () => {
  const { s, logs } = await session(base());
  const leroy = s.actorRuntime.get("leroy")!;
  Object.assign(leroy, { scale: 1100, worldSpace: false, dist: -3, anchorX: 40, anchorY: 60, poseName: "", value: 7 });
  const dog = s.actorRuntime.get("dog")!;
  Object.assign(dog, { scale: 0, visible: false, value: "stray" });
  const back = parseSaveV1(snapshotSaveV1(s)!);
  const [l, d] = back.actors;
  expect([l.name, l.scale, l.dist, l.anchorX, l.anchorY, l.pose, l.value, l.is3d]).toEqual(["leroy", 1100, -3, 40, 60, "", 7, true]);
  expect([d.name, d.scale, d.is3d, d.value]).toEqual(["dog", 0, false, 0]);
  // no room open: nothing to place the standpoint on
  expect(logs).toContain("savegame: written, but the standpoint could not be placed on the set's grid");
});

test("a prop mid-animation writes its next step; a non-number value is left as the base had it", async () => {
  const { s } = await session(base((d) => i32(d.props, 72, 99)));
  const weed = s.propRuntime.get("weed")!;
  Object.assign(weed, { stateName: "roll", frameIdx: 1, value: "x" });
  const back = parseSaveV1(snapshotSaveV1(s)!);
  // the step the original's draw would show next: frame 1 of 3 is followed by frame 2
  expect(back.props.map((p) => [p.name, p.step, p.value])).toEqual([["weed", 2, 99], ["bone", 0, 0]]);
});

test("walks: a walk with no star, by someone not in the cast, is written with heading 0", async () => {
  const { s } = await session(base());
  s.scheduler.walks.set("stranger", { slot: 0, sx: 1, sy: 2, sz: 0, dx: 3, dy: 0, dz: 0, dist: 3, progress: 1, paused: false });
  const back = parseSaveV1(snapshotSaveV1(s)!);
  expect(back.walks.map((w) => [w.actor, w.star, w.deg, w.startX])).toEqual([["stranger", "", 0, 1]]);
});

test("a room whose set file is missing, or not a Dust set, keeps the base's registers", async () => {
  const { s, logs } = await session(base(), { "junk.set": new Uint8Array(64), "shop.set": SHOP });
  for (const set of ["gone", "junk", "shop"]) {
    s.currentSetFile = set;
    expect(snapshotSaveV1(s)).not.toBeNull();
  }
  expect(logs.filter((l) => l.startsWith("savegame: ") && !l.includes("standpoint"))).toEqual([
    "savegame: gone.set is not in the store — its registers keep the base's",
  ]);
});

// ---- loading -----------------------------------------------------------------

test("a load that is not a Dust save, or another title's, is refused", async () => {
  const { s, logs } = await session();
  expect(await loadGameV1(s, new Uint8Array(64))).toBe(false);
  expect(logs.at(-1)).toMatch(/^opengame: not a valid Dust save/);
  expect(await loadGameV1(s, base((d) => pstr(d.c0, 0, "lunicus")))).toBe(false);
  expect(logs.at(-1)).toBe('opengame: saved game is from a different version ("lunicus")');
});

test("a load resumes walks, keeps the waiting waiting, and stands up the rest", async () => {
  const { s, logs } = await session();
  const bytes = base((d) => {
    d.globals = d.globals.slice();
    const walk = (k: number, actor: string, extra: (o: number) => void = () => {}) => {
      const o = 82 * k;
      u16(d.walks, o, 1);
      pstr(d.walks, o + 50, actor);
      u16(d.walks, o + 44, 1); // moving, not waiting
      extra(o);
    };
    // leroy walking to nowhere in particular
    walk(0, "leroy", (o) => {
      i32(d.walks, o + 8, -10);
      i32(d.walks, o + 20, 10);
    });
    // a walker the cast has never heard of, and one waiting for his room
    walk(1, "stranger");
    walk(2, "ghost", (o) => {
      u16(d.walks, o + 44, 0);
      i32(d.walks, o + 20, 4);
      pstr(d.walks, o + 66, "jail");
    });
    walk(3, "dog", (o) => {
      u16(d.walks, o + 44, 0);
      i32(d.walks, o + 20, 4);
      pstr(d.walks, o + 66, "porch");
    });
    // a paused loop, and one whose kind the scheduler keeps under another name
    u16(d.loops, 0, 1);
    u16(d.loops, 2, 2);
    u16(d.loops, 4, 1);
    pstr(d.loops, 10, "Leroy");
    pstr(d.loops, 26, "tick");
    u32(d.loops, 6, 30);
    u16(d.loops, 42, 1);
    u16(d.loops, 42 + 2, 1);
    u16(d.loops, 42 + 4, 3);
    pstr(d.loops, 42 + 26, "clock");
    pstr(d.c1, 482, "town");
  });
  expect(await loadGameV1(s, bytes)).toBe(true);
  const said = logs.filter((l) => l.startsWith("opengame: ") && /walk|wait|resum/.test(l));
  expect(said).toEqual([
    'opengame: leroy was saved walking to "" (0 of 10)',
    "opengame: stranger was saved mid-walk and could not be resumed — standing them up",
    'opengame: ghost was waiting for "jail" and is not in the cast — standing them up',
    'opengame: dog is waiting to arrive at "porch"',
  ]);
  expect(s.scheduler.walks.get("leroy")?.arriveStar).toBeUndefined();
  expect(s.scheduler.walks.get("dog")?.waiting).toBe(true);
  const paused = s.scheduler.loops.find((l) => l.name === "leroy");
  expect([paused?.paused, paused?.pauseDepth]).toEqual([true, 2]);
});

test("a save taken mid-beat says so, and the room comes back from its name when no file is recorded", async () => {
  const { s, logs } = await session();
  const bytes = base((d) => {
    const { globals, pool } = (() => {
      const t = dustSave({ vars: [...FILLER, ["lockevents", true]] });
      return { globals: t.globals, pool: t.pool };
    })();
    d.globals = globals;
    d.pool = pool;
    pstr(d.c1, 482, "mayor");
    u16(d.c1, 446, 3);
    u16(d.c1, 448, 4);
  });
  expect(await loadGameV1(s, bytes)).toBe(true);
  expect(logs).toContain("opengame: this save was taken with lockevents set — input stays locked until a script clears it");
  expect(logs).toContain("opengame: mayor.set has no scene at cell (3,4) — opening it at its own standpoint");
});

test("a load puts a prop back on its saved step only when its view has frames to step through", async () => {
  const { s } = await session();
  const bytes = base((d) => {
    // weed rolling, on step 2 of 3; bone on a one-frame view; a record nobody in the cast has
    pstr(d.props, 126, "roll");
    u16(d.props, 36, 2);
    pstr(d.props, 158 + 126, "lie");
    u16(d.props, 158 + 36, 2);
    d.actors = new Uint8Array(164 * 4);
    ["leroy", "dog", "cow", "zz"].forEach((n, k) => pstr(d.actors, 164 * k + 84, n));
    // and dog waiting for a room with no star named
    u16(d.walks, 0, 1);
    pstr(d.walks, 50, "dog");
    i32(d.walks, 20, 4);
  });
  const { s: t, logs } = await session();
  expect(await loadGameV1(t, bytes)).toBe(true);
  expect([t.propRuntime.get("weed")!.frameIdx, t.propRuntime.get("weed")!.animating]).toEqual([1, true]);
  expect(t.propRuntime.get("bone")!.frameIdx).toBe(0);
  expect(logs).toContain('loadgame: no cast member to re-instance "zz" from — dropped');
  expect(logs).toContain('opengame: dog is waiting to arrive at ""');
  expect(t.scheduler.walks.get("dog")?.arriveStar).toBeUndefined();

  // a view the shop does not have: no frames, so no step to save or restore
  const weed = s.propRuntime.get("weed")!;
  weed.stateName = "gone";
  s.saveTemplate = () => bytes;
  const back = parseSaveV1(snapshotSaveV1(s)!);
  expect(back.props.find((p) => p.name === "weed")?.step).toBe(0);
  const gone = base((d) => {
    pstr(d.props, 126, "gone");
    u16(d.props, 36, 2);
  });
  expect(await loadGameV1(s, gone)).toBe(true);
  expect(s.propRuntime.get("weed")!.frameIdx).toBe(0);
});
