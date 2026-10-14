/**
 * RedJack.exe's pass: DreamFactory 5 runs on the same script-paced model as
 * TI.EXE, tl.exe and DF.EXE (engine/tests/timing-pass.ts), with its own tables
 * and rules.
 *
 *   npx vitest run engine/tests/timing-pass-v5.ts
 *
 * The pass is 0x41b360, called by `forceupdate` (0x408ce0) and `visualeffect`
 * (0x408c43); the BOOTFILE's `idle ()` ends with the `forceupdate`. It walks 16
 * walk slots, 16 crickets, 64 loops, then sends the `endanim ()` the last frame
 * owed — actors (0x408450), then props (0x42e300) — and draws the frame, whose
 * throttle waits `framerate` ticks of the clock (0x469f80, ms × 0.06), clamped
 * 0..60 by the setter (0x408cae).
 *
 * These pin:
 *
 *  - the pass rate follows `framerate`, and the setter clamps it;
 *  - 64 loop slots in slot order, a period of 1 once a pass, a full table error
 *    0x23, and a NEGATIVE period a clock deadline that does not count down;
 *  - `turntodeg` always records and lands with `endturn` (0x41b515/0x41b561),
 *    stepped by 0x41e300's arithmetic with a wrap of 0xffffff — a turn of 0
 *    never lands;
 *  - the straight mover truncates `start + delta · progress / dist` in dwords
 *    and adds the actor's speed as it is;
 *  - an `endanim` is heard in the pass after the frame that ended the view,
 *    actors before props, each run to its end;
 *  - a cricket pans by 0x41d919's rule, `pausecricket` nests (0x41dd10), and a
 *    save carries a cricket's measurement (+0x1c..+0x2c);
 *  - `walkonpath` with no route is error 0xa (0x41cefc), and `actordelete`
 *    sends `closeactor` first (0x40190d).
 *
 * No game data: actors and scripts made here.
 */
import { expect, test } from "vitest";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { ActorInstance } from "@dreamfactory/engine/runtime/actors";
import { ScriptError } from "@dreamfactory/engine/runtime/interp";
import { ticksAt } from "@dreamfactory/engine/runtime/clock";
import { cricketPanV5 } from "@dreamfactory/engine/runtime/scheduler";
import { decodeCrickets, encodeCrickets } from "@dreamfactory/engine/runtime/saveload-v5-tables";
import { GameSession } from "@dreamfactory/engine/runtime/session";

/** one tick of RedJack.exe's clock (0x469f80: timeGetTime × 0.06) */
const TICK = 50 / 3;

function bare(): GameSession {
  const s = new GameSession(() => null, new NullAudioSink());
  s.onLog = (l) => {
    if (process.env.WT_LOG) console.log(l);
  };
  s.isV5 = true;
  s.actorRuntime.currentSet = "liznite";
  return s;
}

/** a host that only moves the clock, as the page and the machine suites do */
function host(s: GameSession): { ticks: (n: number) => Promise<void> } {
  let now = 1000;
  return {
    ticks: async (n: number) => {
      for (let i = 0; i < n; i++) {
        now += TICK;
        s.tickTime(Math.ceil(now));
        await new Promise((r) => setTimeout(r, 0));
      }
    },
  };
}

function actor(s: GameSession, name: string, at: { x?: number; y?: number; deg?: number; speed?: number; turn?: number } = {}) {
  const a = new ActorInstance({ name, poses: [] } as never, { name: "gang.cast", members: [] } as never);
  a.name = name;
  a.setName = "liznite";
  a.worldX = at.x ?? 0;
  a.worldY = at.y ?? 0;
  a.deg = at.deg ?? 0;
  a.speed = at.speed ?? 8000;
  a.turn = at.turn ?? 1_050_000;
  (s.actorRuntime as unknown as { actors: Map<string, ActorInstance> }).actors.set(name, a);
  return a;
}

const script = (s: GameSession, src: string, name: string) => s.instanceFrom(compileScript(src), name)!;
const call = (s: GameSession, name: string, ...args: (number | string)[]) =>
  (s.interp.builtins.get(name) as (i: unknown, a: unknown[]) => unknown)(s.interp, args);
const pass = (s: GameSession) => s.scheduler.pass({ wait: "jump" });

test("the pass rate follows framerate, which RedJack.exe clamps 0..60 (0x408cae)", async () => {
  const s = bare();
  const { ticks } = host(s);
  const perSecond = async (): Promise<number> => {
    await ticks(3);
    const from = s.frameCounter;
    await ticks(60);
    return s.frameCounter - from;
  };
  await ticks(1);
  expect(await perSecond(), "the engine's default, 3 ticks (0x439c03)").toBe(20);
  call(s, "framerate", 2);
  expect(await perSecond(), "the BOOTFILE's framerate (2): thirty").toBe(30);
  call(s, "framerate", 6);
  expect(await perSecond(), "a fight stage's framerate (6): ten").toBe(10);
  call(s, "framerate", 200);
  expect(s.frameRate, "clamped to 60 (0x408cc7)").toBe(60);
  call(s, "framerate", -3);
  expect(s.frameRate, "and to 0 (0x408cbd)").toBe(0);
});

test("64 loop slots in slot order, a period of 1 once a pass, a full table error 0x23", async () => {
  const s = bare();
  s.interp.globals.set("log", "");
  const src = (me: string) => `code fire ()\n\tglobal log\n\tlog = log @ "${me}"\n\tmakeloop ("prop", "${me}", "fire", 1)\nendcode\n`;
  for (const me of ["c", "a", "b"]) s.propScripts.set(me, script(s, src(me), me));
  for (const me of ["c", "a", "b"]) s.scheduler.makeLoop("prop", me, "fire", 1);
  expect(s.scheduler.loops.map((l) => `${l.name}@${l.slot}`)).toEqual(["c@0", "a@1", "b@2"]);
  await pass(s);
  await pass(s);
  expect(s.interp.globals.get("log"), "each once a pass, in slot order — not a batch a host frame").toBe("cabcab");
  for (let i = s.scheduler.loops.length; i < 64; i++) s.scheduler.makeLoop("prop", `p${i}`, "fire", 50);
  expect(s.scheduler.loops).toHaveLength(64);
  let code = 0;
  try {
    s.scheduler.makeLoop("prop", "one more", "fire", 5);
  } catch (e) {
    code = e instanceof ScriptError ? e.code : -1;
  }
  expect(code, "0x41bfa1").toBe(0x23);
});

test("a negative period is a deadline on the clock, which does not count down (0x41bf05, 0x41c008)", async () => {
  const s = bare();
  s.interp.globals.set("fired", 0);
  s.propScripts.set("bell", script(s, "code ring ()\n\tglobal fired\n\tfired = fired + 1\nendcode\n", "bell"));
  // a pass a tick, so the clock's sixtieths can be counted pass by pass
  call(s, "framerate", 0);
  await pass(s);
  s.scheduler.makeLoop("prop", "bell", "ring", -30);
  const l = s.scheduler.loops[0];
  expect(l.deadline, "now less the period, in sixtieths").toBe(ticksAt(s.clock.now) + 30);
  let firedAt = -1;
  for (let i = 0; i < 40 && firedAt < 0; i++) {
    const t = ticksAt(s.clock.now);
    await pass(s);
    if (i === 10) expect(l.count, "the passes do not count it down").toBe(1);
    if (s.interp.globals.get("fired") === 1) firedAt = t;
  }
  expect(firedAt, "fired by the first pass at its tick").toBe(l.deadline);
  expect(s.scheduler.isLoop("prop", "bell")).toBe(false);
});

test("turntodeg always records, steps by 0x41e300 with a wrap of 0xffffff, and lands with endturn", async () => {
  const s = bare();
  const lyle = actor(s, "lyle", { deg: 0xfff000, turn: 0x10000 });
  s.castScripts.set("lyle", script(s, "code endturn ()\n\tglobal walking\n\twalking = iswalk (me)\nendcode\n", "lyle"));
  s.interp.globals.set("walking", -1);
  // the facing it already has: still a record, landing on the next pass
  s.scheduler.startTurn("lyle", 0xfff000);
  expect(s.scheduler.isWalk("lyle"), "no already-facing shortcut").toBe(true);
  await pass(s);
  expect(s.scheduler.isWalk("lyle")).toBe(false);
  expect(s.interp.globals.get("walking"), "endturn sent, the slot already free (0x41b515)").toBe(0);
  // the short way round crosses north: up past 0xffffff, which takes the wrap off
  s.interp.globals.set("walking", -1);
  s.scheduler.startTurn("lyle", 0x8000);
  await pass(s);
  expect(lyle.deg, "0xfff000 + 0x10000 − 0xffffff").toBe(0x8000);
  expect(s.interp.globals.get("walking")).toBe(0);
  // a turn of 0 never lands, as in the exe
  const anne = actor(s, "anne", { deg: 0, turn: 0 });
  s.scheduler.startTurn("anne", 0x400000);
  for (let i = 0; i < 10; i++) await pass(s);
  expect(anne.deg).toBe(0);
  expect(s.scheduler.isWalk("anne")).toBe(true);
});

test("a walk turns, then moves by the actor's speed with a truncating divide, and lands with endwalk", async () => {
  const s = bare();
  const bone = actor(s, "bone", { x: 0, y: 0, deg: 0, speed: 3, turn: 0x1000000 });
  s.castScripts.set("bone", script(s, "code endwalk ()\n\tglobal ended\n\tended = actorstar (me)\nendcode\n", "bone"));
  s.interp.globals.set("ended", "");
  s.scheduler.startWalk("bone", 10, 7, 0, "crates");
  await pass(s); // the turn lands (endturn), no step
  expect([bone.worldX, bone.worldY]).toEqual([0, 0]);
  await pass(s);
  // dist = trunc(√149) = 12; three units of it: trunc(10·3/12), trunc(7·3/12)
  expect([bone.worldX, bone.worldY]).toEqual([2, 1]);
  for (let i = 0; i < 4; i++) await pass(s);
  expect([bone.worldX, bone.worldY]).toEqual([10, 7]);
  expect(s.interp.globals.get("ended"), "the record's star, then endwalk (0x41b686)").toBe("crates");
  // no floor under the speed: an actor of speed 0 turns and stands
  const shaggy = actor(s, "shaggy", { speed: 0, turn: 0x1000000 });
  s.scheduler.startWalk("shaggy", 100, 0, 0, "dock");
  for (let i = 0; i < 5; i++) await pass(s);
  expect(shaggy.worldX).toBe(0);
  expect(s.scheduler.isWalk("shaggy")).toBe(true);
});

test("an endanim is heard in the pass after the frame that ended it, actors before props", async () => {
  const s = bare();
  s.interp.globals.set("log", "");
  const said = (me: string) => `code endanim ()\n\tglobal log\n\tlog = log @ "${me}"\nendcode\n`;
  actor(s, "cannon");
  s.castScripts.set("cannon", script(s, said("cannon"), "cannon"));
  s.propScripts.set("dinghy", script(s, said("dinghy"), "dinghy"));
  // what the frame's step answered (0x4069b0 marks the record, flag 8) ...
  const owed = (s.scheduler as unknown as { owedEndAnims: { actors: string[]; props: string[] } }).owedEndAnims;
  owed.props.push("dinghy");
  owed.actors.push("cannon");
  // (a prop hears it only while shown)
  s.propRuntime.get = ((name: string) => (name === "dinghy" ? { visible: true } : undefined)) as never;
  expect(s.interp.globals.get("log")).toBe("");
  await pass(s);
  expect(s.interp.globals.get("log"), "... the next pass sends, actors (0x408450) then props (0x42e300)").toBe("cannondinghy");
  await pass(s);
  expect(s.interp.globals.get("log"), "once").toBe("cannondinghy");
});

test("a cricket pans by RedJack.exe's rule (0x41d919): ahead 128, a quarter turn 0 or 255", () => {
  const ahead = cricketPanV5(0x200000, 0x200000);
  expect(ahead).toBe(128);
  expect(cricketPanV5(0, 0x400000)).toBe(0);
  expect(cricketPanV5(0, 0xc00000)).toBe(255);
  // behind folds onto ahead
  expect(cricketPanV5(0, 0x800000)).toBe(128);
  // the camera past a half turn turns the other way round
  expect(cricketPanV5(0xc00000, 0x000000)).toBe(0);
});

const run = (s: GameSession, src: string) => s.interp.runHandler(script(s, `code go ()\n${src}\nendcode\n`, "probe"), "go", [], { me: "probe", target: "" });
const errorOf = async (p: Promise<unknown>): Promise<number> => {
  try {
    await p;
  } catch (e) {
    return e instanceof ScriptError ? e.code : -1;
  }
  return 0;
};

test("pausecricket nests, as a count at +2 (0x41dd10), and a save writes the record's measurement", async () => {
  const s = bare();
  s.scheduler.restoreCricket({ name: "surf", set: "liznite", x: 100, y: 0, radius: 5000, base: 10, jitter: 5, next: 3 });
  const c = s.scheduler.crickets[0];
  await run(s, `\tpausecricket ("all", true)\n\tpausecricket ("surf", true)\n\tpausecricket ("all", false)`);
  expect(c.paused, "two pauses and one resume: still held").toBe(true);
  expect(c.pauseDepth).toBe(1);
  await run(s, `\tpausecricket ("surf", false)\n\tpausecricket ("surf", false)`);
  expect(c.paused, "and never below 0 (0x41dde9)").toBe(false);
  expect(c.pauseDepth).toBe(0);

  // the camera point, distance and bearing it measured (+0x1c..+0x28) and the
  // armed flag (+0x2c), written as the record stands and read back as written
  c.measured = { camX: 7, camY: -9, dist: 1234, bearing: 0x400000 };
  c.armed = true;
  const bytes = encodeCrickets(s);
  const v = new DataView(bytes.buffer);
  expect([0x1c, 0x20, 0x24, 0x28].map((o) => v.getInt32(o, true))).toEqual([7, -9, 1234, 0x400000]);
  expect(v.getInt16(0x2c, true)).toBe(1);
  const t = bare();
  decodeCrickets(t, bytes);
  expect(t.scheduler.crickets[0].measured).toEqual(c.measured);
  expect(t.scheduler.crickets[0].armed).toBe(true);
});

test("walkonpath with no route is error 0xa (0x41cefc): there is no straight line", async () => {
  const s = bare();
  actor(s, "anne");
  expect(await errorOf(run(s, `\twalkonpath ("anne", "here", "there")`))).toBe(0xa);
  expect(s.scheduler.isWalk("anne")).toBe(false);
});

test("actordelete sends closeactor first (0x40190d), and a name no actor has is error 0xa (0x406550)", async () => {
  const s = bare();
  s.interp.globals.set("log", "");
  actor(s, "dagger 1");
  s.castScripts.set("dagger 1", script(s, `code closeactor ()\n\tglobal log\n\tlog = log @ actorvisible (me)\nendcode\n`, "dagger 1"));
  s.scheduler.makeLoop("actor", "dagger 1", "spin", 5);
  await run(s, `\tactordelete ("dagger 1")`);
  expect(s.interp.globals.get("log"), "heard while it was still there").not.toBe("");
  expect(s.actorRuntime.get("dagger 1")).toBeNull();
  expect(s.scheduler.isLoop("actor", "dagger 1")).toBe(false);
  expect(await errorOf(run(s, `\tactordelete ("dagger 2")`))).toBe(0xa);
});
