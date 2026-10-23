/**
 * The scheduler's walk and loop tables off the main road
 * (engine/src/runtime/scheduler.ts): walk commands for an actor who is not
 * there, routes too short to walk, restored records and their defaults, the
 * turn and motion questions the drivers ask, a waiting walk whose star is
 * missing, and the loop table's slots — full, reused, and a handler name that
 * spans a line.
 *
 *   npx vitest run engine/tests/scheduler-walks.ts
 *
 * No game data: actors made here.
 */
import { expect, test } from "vitest";
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import { actor, bare } from "./helpers/walk-world";

const pass = (s: GameSession) => s.scheduler.pass({ wait: "jump" });

test("walk commands for an actor who is not there file nothing", () => {
  const s = bare();
  const w = s.scheduler;
  w.startWalk("ghost", 1, 2, 3);
  w.deferWalk("ghost", "star", () => {});
  w.startWalkRoad("ghost", [{ x: 0, y: 0, z: 0, cum: 0 }, { x: 1, y: 0, z: 0, cum: 1 }], 4);
  w.startWalkPath("ghost", [{ x: 0, y: 0, z: 0, fromPrev: 0 }, { x: 5, y: 0, z: 0, fromPrev: 5 }]);
  w.startTurn("ghost", 10);
  expect(w.restoreWalk("ghost", { sx: 0, sy: 0, sz: 0, dx: 0, dy: 0, dz: 0, dist: 1, progress: 0 })).toBe(false);
  expect(w.walks.size).toBe(0);
});

test("a route of one point is a straight walk to it; of none, or a road of one, nothing", () => {
  const s = bare();
  actor(s, "max");
  const w = s.scheduler;
  w.startWalkPath("max", []);
  w.startWalkRoad("max", [{ x: 0, y: 0, z: 0, cum: 0 }], 5);
  expect(w.walks.size).toBe(0);
  w.startWalkPath("max", [{ x: 30, y: 40, z: 0, fromPrev: 0 }], "max.2");
  const rec = w.walks.get("max")!;
  expect([rec.dx, rec.dy, rec.dist, rec.arriveStar, rec.path]).toEqual([30, 40, 50, "max.2", undefined]);
});

test("a restored record takes the actor's facing and an unpaused state when the save has none", () => {
  const s = bare();
  actor(s, "max", { deg: 77 });
  const w = s.scheduler;
  expect(w.restoreWalk("MAX", { sx: 1, sy: 2, sz: 3, dx: 0, dy: 0, dz: 0, dist: 0, progress: 0 })).toBe(true);
  const rec = w.walks.get("max")!;
  expect([rec.deg, rec.paused, rec.dist]).toEqual([77, false, 1]);
  // a seventeenth has no slot
  for (let i = 0; i < 16; i++) {
    actor(s, `a${i}`);
    w.restoreWalk(`a${i}`, { sx: 0, sy: 0, sz: 0, dx: 0, dy: 0, dz: 0, dist: 1, progress: 0 });
  }
  expect(w.walks.size).toBe(16);
  expect(w.walks.has("a15")).toBe(false);
});

test("turning and anyoneMoving: by name, for anyone, and not for a deferred walk", async () => {
  const s = bare();
  actor(s, "steph", { deg: 0, turn: 5 });
  actor(s, "zeit");
  const w = s.scheduler;
  expect([w.turning(), w.turning("steph"), w.anyoneMoving()]).toEqual([false, false, false]);
  w.deferWalk("zeit", "far", () => {});
  expect(w.anyoneMoving()).toBe(false);
  w.startTurn("steph", 100);
  expect([w.turning(), w.turning("STEPH"), w.turning("zeit"), w.anyoneMoving()]).toEqual([true, true, false, true]);
  w.pauseWalk("nobody", true);
  w.pauseWalk("steph", true);
  await pass(s);
  expect(s.actorRuntime.get("steph")!.deg).toBe(0);
});

test("a restored turn with nothing left to turn is dropped; an arrival with no star keeps the actor's", async () => {
  const s = bare();
  const a = actor(s, "max", { speed: 100 });
  a.starName = "home";
  const w = s.scheduler;
  w.restoreWalk("max", { sx: 0, sy: 0, sz: 0, dx: 0, dy: 0, dz: 0, dist: 1, progress: 0, turnOnly: true });
  await pass(s);
  expect(w.isWalk("max")).toBe(false);
  w.restoreWalk("max", { sx: 0, sy: 0, sz: 0, dx: 50, dy: 0, dz: 0, dist: 50, progress: 0 });
  await pass(s);
  expect([w.isWalk("max"), a.worldX, a.starName]).toEqual([false, 50, "home"]);
});

test("a waiting walk to a star the open set has not stays waiting", async () => {
  const s = bare();
  actor(s, "max");
  const w = s.scheduler;
  w.restoreWalk("max", { sx: 0, sy: 0, sz: 0, dx: 0, dy: 0, dz: 0, dist: 1, progress: 0, waiting: true, arriveStar: "nowhere" });
  await pass(s);
  expect(w.walks.get("max")?.waiting).toBe(true);
  // a custom arrival needs no star: it lands where the actor stands
  w.restoreWalk("max", { sx: 0, sy: 0, sz: 0, dx: 0, dy: 0, dz: 0, dist: 1, progress: 0, waiting: true, arriveStar: "custom" });
  await pass(s);
  expect(w.isWalk("max")).toBe(false);
});

test("the loop table: a freed slot is reused in order, a full one drops (v4) or is 0x23 (v5)", () => {
  const s = bare();
  const logs: string[] = [];
  s.onLog = (l) => logs.push(l);
  const w = s.scheduler;
  w.makeLoop("prop", "a", "h", 1);
  w.makeLoop("prop", "b", "h", 1);
  w.stopLoop("prop", "a");
  w.makeLoop("prop", "c", "h", 1);
  expect(w.loops.map((l) => l.name)).toEqual(["c", "b"]);
  // a handler written as a call keeps its name; one spanning a line stays as written
  w.makeLoop("prop", "d", "  tick ( ) ", 1);
  w.makeLoop("prop", "e", "ti\nck ()", 1);
  expect(w.loops.slice(-2).map((l) => l.handler)).toEqual(["tick", "ti\nck ()"]);
  for (let i = w.loops.length; i < 32; i++) w.makeLoop("prop", `f${i}`, "h", 1);
  expect(w.loops).toHaveLength(32);
  w.makeLoop("prop", "over", "h", 1);
  expect(logs.at(-1)).toContain("makeloop: table full (32)");
  w.restoreLoop("prop", "over", "h", 3);
  expect(logs.at(-1)).toContain("loadgame: loop table full (32)");

  const r = bare(true);
  for (let i = 0; i < 64; i++) r.scheduler.makeLoop("prop", `f${i}`, "h", 1);
  expect(() => r.scheduler.makeLoop("prop", "over", "h", 1)).toThrow(expect.objectContaining({ code: 0x23 }));
});
