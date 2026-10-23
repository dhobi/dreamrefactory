/**
 * Where the scheduler's pass (engine/src/runtime/scheduler.ts) stops short,
 * and two of its quieter records: an `endwalk` that fails frees its slot and
 * stops the pass before the loops (TI.EXE 0x442618); RedJack.exe's pass stops
 * at a cricket whose sound no bank has (0x41b787) and at an `endanim` that
 * fails (0x41b79f); an idle with no BOOTFILE handler whose pass fails says so;
 * a loop of a kind with no command of its own is
 * sent to the prop of its name; a waiting walk with no star lands where the
 * actor stands; and the route mover steps over a leg of no length.
 *
 *   npx vitest run engine/tests/scheduler-pass-stops.ts
 *
 * No game data: actors and scripts made here.
 */
import { expect, test } from "vitest";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import { actor, bare } from "./helpers/walk-world";

const pass = (s: GameSession) => s.scheduler.pass({ wait: "jump" });
const script = (s: GameSession, name: string, src: string) => s.instanceFrom(compileScript(src), name)!;
/** a prop script whose `tick` puts its name on the global `log` */
const ticks = (s: GameSession, name: string) => {
  s.interp.globals.set("log", "");
  s.propScripts.set(name, script(s, name, `code tick ()\n\tglobal log\n\tlog = log @ "${name}"\nendcode\n`));
};
const logged = (s: GameSession) => {
  const logs: string[] = [];
  s.onLog = (l) => logs.push(l);
  return logs;
};

test("an endwalk that fails frees its slot and stops the pass before the loops", async () => {
  const s = bare();
  const logs = logged(s);
  actor(s, "max", { speed: 100 });
  s.castScripts.set("max", script(s, "max", "code endwalk ()\n\tx = nosuch\nendcode\n"));
  ticks(s, "lamp");
  s.scheduler.makeLoop("prop", "lamp", "tick", 1);
  s.scheduler.restoreWalk("max", { sx: 0, sy: 0, sz: 0, dx: 50, dy: 0, dz: 0, dist: 50, progress: 0 });
  expect(await s.scheduler.pass({ wait: "jump" })).toBe(false);
  expect(logs).toContain("pass stopped at endwalk max: error 9: no such variable: x (assigned) (in max.endwalk)");
  expect(s.scheduler.isWalk("max")).toBe(false);
  expect(s.interp.globals.get("log"), "the loop was not reached").toBe("");
  expect(await pass(s)).toBe(true);
  expect(s.interp.globals.get("log")).toBe("lamp");
});

test("RedJack: a cricket whose sound no bank has is dropped, and the pass stops there", async () => {
  const s = bare(true);
  const logs = logged(s);
  ticks(s, "lamp");
  s.scheduler.makeLoop("prop", "lamp", "tick", 1);
  // a one-shot due now, in earshot, in the open set
  s.scheduler.crickets.restore({ name: "surf", set: s.currentSetName, x: 0, y: 0, radius: 5000, base: 1, jitter: -1, next: 1 });
  expect(await s.scheduler.pass({ wait: "jump" })).toBe(false);
  expect(logs).toContain('pass stopped at cricket surf: no sound "surf" (error 0xa)');
  expect(s.scheduler.crickets.table).toHaveLength(0);
  expect(s.interp.globals.get("log")).toBe("");
});

test("RedJack: an endanim that fails stops the pass", async () => {
  const s = bare(true);
  const logs = logged(s);
  actor(s, "cannon");
  s.castScripts.set("cannon", script(s, "cannon", "code endanim ()\n\tactordelete (\"nobody\")\nendcode\n"));
  (s.scheduler as unknown as { owedEndAnims: { actors: string[] } }).owedEndAnims.actors.push("cannon");
  expect(await s.scheduler.pass({ wait: "jump" })).toBe(false);
  expect(logs).toContain('pass stopped at endanim cannon: error 10: actordelete: no actor "nobody" (in cannon.endanim)');
  // owed once: the next pass has nothing to send
  expect(await pass(s)).toBe(true);
});

test("an idle with no BOOTFILE handler runs the pass; one that fails is logged", async () => {
  const s = bare();
  const logs = logged(s);
  let motions = 0;
  s.onPassMotion = () => {
    motions++;
    throw new Error("the camera fell over");
  };
  // the pass counted its frame before it failed, so the idle would go round
  // again: hold it after the first
  s.idleHeld = () => motions > 0;
  let idles = 0;
  s.onIdle = () => void idles++;
  s.scheduler.serviceIdle();
  await new Promise((r) => setTimeout(r, 0));
  expect(logs).toContain("script error in the pass.idle: the camera fell over");
  expect([motions, idles]).toEqual([1, 1]);
});

test("a loop of a kind with no command of its own is sent to the prop of its name", async () => {
  const s = bare();
  ticks(s, "lamp");
  s.scheduler.makeLoop("gadget", "lamp", "tick", 1);
  await pass(s);
  expect(s.interp.globals.get("log")).toBe("lamp");
});

test("a waiting walk with no star lands where the actor stands, keeping the actor's star", async () => {
  const s = bare();
  const a = actor(s, "max", { x: 7, y: 9 });
  a.starName = "home";
  s.scheduler.restoreWalk("max", { sx: 0, sy: 0, sz: 0, dx: 40, dy: 0, dz: 0, dist: 40, progress: 0, waiting: true });
  await pass(s);
  expect([s.scheduler.isWalk("max"), a.worldX, a.worldY, a.starName]).toEqual([false, 7, 9, "home"]);
});

test("the route mover steps over a leg of no length rather than divide by it", async () => {
  const s = bare();
  const a = actor(s, "max", { x: 99, y: 99, speed: 0 });
  const path = [
    { x: 5, y: 5, z: 0, cum: 0 },
    { x: 5, y: 5, z: 0, cum: 0 },
    { x: 15, y: 5, z: 0, cum: 10 },
  ];
  s.scheduler.restoreWalk("max", { sx: 5, sy: 5, sz: 0, dx: 0, dy: 0, dz: 0, dist: 10, progress: 0, path });
  await pass(s);
  // standing still at the leg's start, not at NaN
  expect([a.worldX, a.worldY, s.scheduler.isWalk("max")]).toEqual([5, 5, true]);
});
