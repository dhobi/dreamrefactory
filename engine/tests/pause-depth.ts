/**
 * `pauseloop` / `pausewalk` NEST, and `pausewalk ("all", flag)` is every walk.
 *
 *   npx vitest run engine/tests/pause-depth.ts
 *
 * Every engine keeps a depth at +2 of the loop and walk records: a pause adds
 * one, a resume takes one off and never goes below 0, and the record is held
 * while the depth is above 0 — DF.EXE 0x43904d/0x4390aa (loops), 0x439a16/
 * 0x439a6b (walks); TI.EXE 0x43b66d, 0x43c9c6; tl.exe 0x401cdd, 0x403036. The
 * name "all" is every walk slot (DF.EXE 0x439a08, TI.EXE 0x43c9b8): Dust's
 * fights, the credits, the safe-cracking and the sundial pause the whole town's
 * walkers with it, and a port that looked for a walk NAMED "all" paused none.
 */
import { expect, test } from "vitest";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";

const run = async (s: GameSession, body: string) => {
  const inst = s.instanceFrom(compileScript(`code go ()\n${body}\nendcode\n`), "t")!;
  await s.interp.runHandler(inst, "go", [], { me: "t", target: "" });
};

/** a parked walk record, as the walk builtins file one */
const walk = () => ({ sx: 0, sy: 0, sz: 0, dx: 1, dy: 0, dz: 0, dist: 10, progress: 0, paused: false });

test("pauseloop nests: two pauses need two resumes, and resumes stop at 0", async () => {
  const s = new GameSession(() => null, new NullAudioSink());
  s.dfVersion = 1;
  s.scheduler.makeLoop("set", "idle", "tick", 5);
  const loop = s.scheduler.loops[0];
  await run(s, '\tpauseloop ("set", "idle", true)\n\tpauseloop ("set", "idle", true)\n\tpauseloop ("set", "idle", false)');
  expect(loop.paused).toBe(true);
  await run(s, '\tpauseloop ("set", "idle", false)');
  expect(loop.paused).toBe(false);
  // a resume too many is clamped, so one pause holds it again
  await run(s, '\tpauseloop ("set", "idle", false)\n\tpauseloop ("set", "idle", true)');
  expect(loop.paused).toBe(true);
  // "all" counts every loop of the kind
  await run(s, '\tpauseloop ("set", "all", false)');
  expect(loop.paused).toBe(false);
});

test('pausewalk ("all", flag) holds and releases every walk, nested', async () => {
  const s = new GameSession(() => null, new NullAudioSink());
  s.dfVersion = 1;
  s.scheduler.walks.set("deputy", walk());
  s.scheduler.walks.set("mayor", walk());
  const paused = () => [...s.scheduler.walks.values()].map((w) => w.paused);

  await run(s, '\tpausewalk ("all", true)');
  expect(paused()).toEqual([true, true]);
  // the mayor's own pause is a second level on top of "all"
  await run(s, '\tpausewalk ("mayor", true)\n\tpausewalk ("all", false)');
  expect(paused()).toEqual([false, true]);
  await run(s, '\tpausewalk ("mayor", false)');
  expect(paused()).toEqual([false, false]);
});

test("RedJack.exe nests both too, and a loop made while its kind is paused runs", async () => {
  // loops 0x41c2c3/0x41c2ce (a name) and 0x41c252/0x41c257 ("all"); walks
  // 0x41d50e/0x41d518 and 0x41d49a/0x41d49f; makeloop's record starts at
  // depth 0 (0x41beef), so the jail's `checkforrock`, armed after the tray's
  // `setupstage (false)`, is never held by the stage's pause
  const s = new GameSession(() => null, new NullAudioSink());
  s.isV5 = true;
  s.scheduler.makeLoop("actor", "soldier", "actoridle", 5);
  s.scheduler.walks.set("constable", walk());
  const loop = () => s.scheduler.loops.find((l) => l.name === "soldier")!;
  await run(s, '\tpauseloop ("actor", "all", 1)\n\tpauseloop ("actor", "soldier", 1)\n\tpausewalk ("all", 1)\n\tpausewalk ("constable", 1)');
  await run(s, '\tpauseloop ("actor", "all", 0)\n\tpausewalk ("all", 0)');
  expect(loop().paused).toBe(true);
  expect(s.scheduler.walks.get("constable")!.paused).toBe(true);
  await run(s, '\tpauseloop ("actor", "soldier", 0)\n\tpausewalk ("constable", 0)');
  expect(loop().paused).toBe(false);
  expect(s.scheduler.walks.get("constable")!.paused).toBe(false);
  await run(s, '\tpauseloop ("actor", "all", 1)\n\tmakeloop ("actor", "safe check", "checkforrock", 1)');
  expect(s.scheduler.loops.find((l) => l.name === "safe check")!.paused).toBe(false);
});
