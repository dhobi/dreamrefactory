/**
 * The walk table as TI.EXE's walk service (0x443ba0) and DF.EXE's (0x4395c0)
 * run it.
 *
 *   npx vitest run engine/tests/walk-table.ts
 *
 *  - a turn steps the RECORD's facing by `actorturn` with 0x445080's wrap of
 *    0xff, and lands with `endturn` — a `turntodeg` one too, its slot cleared
 *    first (0x443d47 -> 0x443d5b -> 0x443da4);
 *  - `turntodeg` always records, and cancels a walk in progress without an
 *    `endwalk` (0x442ea0 -> 0x442640);
 *  - the straight mover is `start − trunc(delta · progress / dist)` (0x443e7c),
 *    and the arrival sets no pose (0x443de3: there is no "stand" in the exe);
 *  - the route mover (0x444d70) finds its leg by taking leg lengths off the
 *    progress and interpolates with a truncating divide;
 *  - records take the first free of 16 slots and a full table is error 7;
 *  - a walk made outside the actor's set waits, unbuilt, until it is open.
 *
 * No game data: actors and scripts made here.
 */
import { expect, test } from "vitest";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { ActorInstance } from "@dreamfactory/engine/runtime/actors";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { ScriptError } from "@dreamfactory/engine/runtime/interp";

function bare(v1 = false): GameSession {
  const s = new GameSession(() => null, new NullAudioSink());
  s.onLog = (l) => process.env.WT_LOG && console.log(l);
  if (v1) s.dfVersion = 1;
  s.actorRuntime.currentSet = "deck";
  return s;
}

function actor(s: GameSession, name: string, at: { x?: number; y?: number; deg?: number; speed?: number; turn?: number } = {}) {
  const a = new ActorInstance({ name, poses: [] } as never, { name: "gang.cst", members: [] } as never);
  a.name = name;
  a.setName = "deck";
  a.worldX = at.x ?? 0;
  a.worldY = at.y ?? 0;
  a.deg = at.deg ?? 0;
  a.speed = at.speed ?? 10;
  a.turn = at.turn ?? 10;
  (s.actorRuntime as unknown as { actors: Map<string, ActorInstance> }).actors.set(name, a);
  return a;
}

function castScript(s: GameSession, name: string, src: string): void {
  s.castScripts.set(name, s.instanceFrom(compileScript(src), name)!);
}

const pass = (s: GameSession) => s.scheduler.pass({ wait: "jump" });

test("a turn steps with a wrap of 0xff, and lands with endturn — a turntodeg's too, its slot cleared first", async () => {
  for (const v1 of [false, true]) {
    const s = bare(v1);
    const steph = actor(s, "steph", { deg: 250, turn: 10 });
    // gang.cst 0190's shape: endturn re-arms the walk-out when no walk is left
    castScript(s, "steph", 'code endturn ()\n\tif not iswalk (me)\n\t\tmakeloop ("actor", me, "walkout", 15)\n\tendif\nendcode\n');
    s.scheduler.startTurn("steph", 64);
    await pass(s);
    // 250 + 10 is past 0xff: 0xff comes off, 5 — not the 4 a 256-turn gives
    expect(steph.deg, `v${v1 ? 1 : 4}: over the wrap`).toBe(5);
    for (let i = 0; i < 20 && s.scheduler.isWalk("steph"); i++) await pass(s);
    expect(steph.deg).toBe(64);
    expect(s.scheduler.isWalk("steph"), "the turn's slot is cleared").toBe(false);
    expect(s.scheduler.isLoop("actor", "steph"), "and endturn ran, seeing no walk").toBe(true);
  }
});

test("turntodeg always records, and cancels a walk in progress without endwalk", async () => {
  const s = bare();
  const zeit = actor(s, "zeit", { deg: 0 });
  castScript(s, "zeit", 'code endwalk ()\n\tglobal ended\n\tended = 1\nendcode\n');
  s.interp.globals.set("ended", 0);
  s.scheduler.startTurn("zeit", 0);
  expect(s.scheduler.isWalk("zeit"), "no already-facing shortcut").toBe(true);
  await pass(s);
  expect(s.scheduler.isWalk("zeit"), "it lands on the next pass").toBe(false);

  s.scheduler.startWalk("zeit", 5000, 0, 0, "far");
  await pass(s);
  s.scheduler.startTurn("zeit", 128);
  expect(s.scheduler.walks.get("zeit")!.turnOnly, "the walk is replaced by the turn").toBe(true);
  for (let i = 0; i < 30 && s.scheduler.isWalk("zeit"); i++) await pass(s);
  expect(s.interp.globals.get("ended"), "the cancelled walk sent no endwalk").toBe(0);
});

test("the straight mover truncates, holds the record's facing, and sets no pose on arrival", async () => {
  for (const v1 of [false, true]) {
    const s = bare(v1);
    const a = actor(s, "max", { deg: 32, speed: 5 });
    a.poseName = "walk";
    s.scheduler.startWalk("max", 9, 9, 0, "max.2");
    expect(s.scheduler.walks.get("max")!.dist, "isqrt (162) = 12").toBe(12);
    await pass(s); // the turn: already facing 0x20, it lands at once
    const xs: number[] = [];
    while (s.scheduler.isWalk("max") && xs.length < 10) {
      await pass(s);
      xs.push(a.worldX);
    }
    // 9·5/12 = 3.75 -> 3, 9·10/12 = 7.5 -> 7, then clamped to the end
    expect(xs, `v${v1 ? 1 : 4}`).toEqual([3, 7, 9]);
    expect(a.starName).toBe("max.2");
    expect(a.poseName, "no \"stand\": the cast's endwalk poses them").toBe("walk");
  }
});

test("the route mover: leg by leg, r <= len stays in the leg, a truncating divide, and the last point on arrival", async () => {
  const s = bare();
  const a = actor(s, "ga", { deg: 0, speed: 4 });
  s.scheduler.startWalkPath("ga", [
    { x: 0, y: 0, z: 0, fromPrev: 0 },
    { x: 10, y: 0, z: 0, fromPrev: 10 },
    { x: 10, y: 9, z: 0, fromPrev: 10 },
  ], "ga.2");
  await pass(s); // the turn: the first leg faces 0
  const at: string[] = [];
  while (s.scheduler.isWalk("ga") && at.length < 10) {
    await pass(s);
    at.push(`${a.worldX},${a.worldY}@${a.deg}`);
  }
  // progress 12 is 2 into the second leg: 9·2/10 = 1.8 -> 1, facing up it (0x40);
  // 16 is 6 in, 5.4 -> 5; 20 is the whole route, its last point
  expect(at).toEqual(["4,0@0", "8,0@0", "10,1@64", "10,5@64", "10,9@64"]);
  expect(a.starName).toBe("ga.2");
});

test("walks take the first free of 16 slots, in which order a pass and indextowalk see them; a 17th is error 7", async () => {
  const s = bare();
  for (const n of ["a", "b", "c"]) actor(s, n);
  for (const n of ["a", "b", "c"]) s.scheduler.startWalk(n, 1000, 0, 0);
  s.scheduler.stopWalk("b");
  actor(s, "d");
  s.scheduler.startWalk("d", 1000, 0, 0);
  expect(s.scheduler.walkSlots().map(([k]) => k), "d takes b's slot").toEqual(["a", "d", "c"]);
  const idx = s.interp.builtins.get("indextowalk") as (i: unknown, a: unknown[]) => unknown;
  expect(idx(s.interp, [2])).toBe("d");
  for (let i = 0; i < 13; i++) {
    actor(s, `x${i}`);
    s.scheduler.startWalk(`x${i}`, 1000, 0, 0);
  }
  actor(s, "late");
  let err: unknown = null;
  try {
    s.scheduler.startWalk("late", 1000, 0, 0);
  } catch (e) {
    err = e;
  }
  expect(err instanceof ScriptError && err.code).toBe(7);
});

test("a walk made outside its actor's set waits unbuilt — no turn, no step — until the set is open", async () => {
  const s = bare();
  const a = actor(s, "vlad", { deg: 0 });
  a.setName = "engine";
  let built = 0;
  s.scheduler.deferWalk("vlad", "vlad.2", () => {
    built++;
    s.scheduler.startWalk("vlad", 500, 0, 0, "vlad.2");
  });
  expect(s.scheduler.isWalk("vlad"), "it is a walk, as iswalk sees it").toBe(true);
  for (let i = 0; i < 5; i++) await pass(s);
  expect(built).toBe(0);
  s.actorRuntime.currentSet = "engine";
  await pass(s);
  expect(built, "built on the first pass in its set, and only built").toBe(1);
  expect(a.worldX).toBe(0);
  await pass(s); // the turn (already facing)
  await pass(s);
  expect(a.worldX).toBe(10);
});
