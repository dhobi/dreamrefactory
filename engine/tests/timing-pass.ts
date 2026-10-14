/**
 * The pass: the only thing that moves the world in TI.EXE, tl.exe and DF.EXE.
 *
 *   npx vitest run engine/tests/timing-pass.ts
 *
 * TI.EXE's service pass (0x442550) has two callers, `forceupdate` (0x43e3e0)
 * and `visualeffect` (0x43ded0); the heartbeat is the BOOTFILE's `idle ()`,
 * which the main loop sends between events and which opens with
 * `forceupdate ()`. A pass walks the walk slots, the cricket slots and the 32
 * loop slots in slot order — every loop counts down once a pass, a period of 1
 * included (0x442ae0), and fires its handler to its end before the next slot —
 * then draws a frame, whose throttle (0x43a940) waits until `framerate` ticks
 * have passed since the last one: one pass per `framerate` ticks, clamped 0..60
 * (0x43e3a9).
 *
 * So these pin, on a bare session's own clock (Scheduler.serviceIdle runs the
 * pass alone when there is no BOOTFILE idle):
 *
 *  - the pass rate follows `framerate`, its clamp, and 0;
 *  - nothing advances while a script holds the engine — a handler, a `delay`,
 *    a film — not a loop, a walk or the frame counter;
 *  - a loop of period 1 fires once a pass, not once a host frame;
 *  - loops fire in slot order, inside the pass, a new loop waits for the next
 *    pass, a failing handler stops the pass, and a handler's own `forceupdate`
 *    is a pass nested in it.
 *
 * No game data: scripts compiled here.
 */
import { test, expect } from "vitest";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";

/** one tick of the clock, as TI.EXE's 0x41de90 counts them */
const TICK = 50 / 3;

function bare(): { session: GameSession; at: (ms: number) => Promise<void>; ticks: (n: number) => Promise<void> } {
  const session = new GameSession(() => null, new NullAudioSink());
  session.onLog = () => {};
  let now = 1000;
  // a host's tick: the clock moved, and the idle's pass it lets through
  const at = async (ms: number) => {
    now = ms;
    session.tickTime(Math.ceil(ms));
    await new Promise((r) => setTimeout(r, 0));
  };
  const ticks = async (n: number) => {
    for (let i = 0; i < n; i++) await at(now + TICK);
  };
  return { session, at, ticks };
}

/** a prop whose script holds `src`, so a `makeloop ("prop", name, …)` finds it */
function propScript(session: GameSession, name: string, src: string): void {
  session.propScripts.set(name, session.instanceFrom(compileScript(src), name)!);
}

/** run `src` as a handler, tracked as the running script it would be */
function run(session: GameSession, src: string): Promise<unknown> {
  const inst = session.instanceFrom(compileScript(`code go ()\n${src}\nendcode\n`), "go")!;
  return session.track(session.interp.runHandler(inst, "go", [], { me: "go", target: "" }), "go");
}

const call = (session: GameSession, name: string, ...args: (number | string)[]) =>
  (session.interp.builtins.get(name) as (i: unknown, a: unknown[]) => unknown)(session.interp, args);

test("the pass rate follows framerate: 60/framerate a second, clamped 0..60, and 0 is a pass a tick", async () => {
  const { session, ticks } = await bare();
  const perSecond = async (): Promise<number> => {
    await ticks(3); // settle onto the new period
    const from = session.frameCounter;
    await ticks(60);
    return session.frameCounter - from;
  };
  await ticks(1);
  expect(await perSecond(), "the default, 3 ticks: twenty a second").toBe(20);
  call(session, "framerate", 5);
  expect(await perSecond(), "the fight's 5: twelve").toBe(12);
  call(session, "framerate", 2);
  expect(await perSecond(), "the fence's 2: thirty").toBe(30);
  call(session, "framerate", 1);
  expect(await perSecond(), "1: one a tick").toBe(60);
  call(session, "framerate", 0);
  expect(session.frameRate, "0 is kept as 0").toBe(0);
  expect(await perSecond(), "0: unthrottled, which on a clock of ticks is one a tick").toBe(60);
  call(session, "framerate", 100);
  expect(session.frameRate, "clamped to 60 (0x43e3c0)").toBe(60);
  expect(await perSecond(), "60: one a second").toBe(1);
  call(session, "framerate", -4);
  expect(session.frameRate, "and to 0 from below (0x43e3b4)").toBe(0);
});

test("nothing advances while a script holds the engine: a handler, a delay, a film", async () => {
  const { session, ticks } = await bare();
  session.interp.globals.set("fired", 0);
  propScript(session, "clock", "code tick ()\n\tglobal fired\n\tfired = fired + 1\n\tmakeloop (\"prop\", \"clock\", \"tick\", 3)\nendcode\n");
  session.scheduler.makeLoop("prop", "clock", "tick", 3);
  await ticks(30);
  const fired = Number(session.interp.globals.get("fired"));
  expect(fired, "the loop runs on the idle's passes").toBeGreaterThan(2);

  // a delay of a second: no pass, so no loop, no frame
  const frames = session.frameCounter;
  let done = false;
  void run(session, "\tdelay (60)").then(() => (done = true));
  await ticks(1); // the idle in flight finishes its wait
  const held = { frames: session.frameCounter, fired: Number(session.interp.globals.get("fired")), count: session.scheduler.loops[0].count };
  await ticks(55);
  expect(done, "the delay is still running").toBe(false);
  expect(session.frameCounter, "no frame while it delays (0x41deb0 pumps messages only)").toBe(held.frames);
  expect(Number(session.interp.globals.get("fired")), "no loop fired").toBe(held.fired);
  expect(session.scheduler.loops[0].count, "...and none counted down").toBe(held.count);
  expect(held.frames - frames, "at most the pass that was already under way").toBeLessThanOrEqual(1);
  await ticks(10);
  expect(done, "the delay ends").toBe(true);
  await ticks(10);
  expect(session.frameCounter, "and the passes come back").toBeGreaterThan(held.frames + 5);

  // a handler that holds the engine without a forceupdate: the same
  let release = () => {};
  void session.track(new Promise<void>((r) => (release = r)), "a handler");
  await ticks(1);
  const f2 = session.frameCounter;
  await ticks(30);
  expect(session.frameCounter, "a running handler: no pass").toBe(f2);
  release();
  await ticks(5);
  expect(session.frameCounter).toBeGreaterThan(f2);

  // a film on screen holds the idle (the movie loop 0x449263 polls events only)
  let film = true;
  session.idleHeld = () => film;
  await ticks(4);
  const f3 = session.frameCounter;
  await ticks(30);
  expect(session.frameCounter, "a film: no pass").toBe(f3);
  film = false;
  await ticks(5);
  expect(session.frameCounter).toBeGreaterThan(f3);
});

test("a loop of period 1 fires once a pass, however often the host ticks", async () => {
  const { session, at } = await bare();
  session.interp.globals.set("n", 0);
  propScript(session, "sky", "code drift ()\n\tglobal n\n\tn = n + 1\n\tmakeloop (\"prop\", \"sky\", \"drift\", 1)\nendcode\n");
  session.scheduler.makeLoop("prop", "sky", "drift", 1);
  // a 144 Hz host: four calls a pass
  let ms = 1000;
  await at(ms);
  const n0 = Number(session.interp.globals.get("n"));
  const f0 = session.frameCounter;
  for (let i = 0; i < 144; i++) await at((ms += 1000 / 144));
  const n = Number(session.interp.globals.get("n")) - n0;
  expect(session.frameCounter - f0, "twenty passes in that second").toBe(20);
  expect(n, "and the period-1 loop fired on each of them, not on each host call").toBe(20);
});

test("loops fire inside the pass in slot order; a new loop waits; a failure stops the pass", async () => {
  const { session } = await bare();
  session.interp.globals.set("log", "");
  const src = (me: string, extra = "") =>
    `code fire ()\n\tglobal log\n\tlog = log @ "${me}"\n${extra}endcode\n`;
  propScript(session, "a", src("a", '\tmakeloop ("prop", "z", "fire", 1)\n'));
  propScript(session, "b", src("b"));
  propScript(session, "c", src("c"));
  propScript(session, "z", src("z"));
  session.scheduler.makeLoop("prop", "c", "fire", 1); // slot 0
  session.scheduler.makeLoop("prop", "a", "fire", 1); // slot 1
  session.scheduler.makeLoop("prop", "b", "fire", 1); // slot 2
  expect(session.scheduler.loops.map((l) => `${l.name}@${l.slot}`)).toEqual(["c@0", "a@1", "b@2"]);
  const p = session.scheduler.pass({ wait: "jump" });
  // inside the pass: the handlers run to their end, one after another
  expect(await p, "the pass completes").toBe(true);
  expect(session.interp.globals.get("log"), "slot order, each to its end before the next").toBe("cab");
  // `a` armed `z` mid-pass: into the first free slot — c's, freed before it
  // fired — which the pass had already passed
  expect(session.scheduler.loops.map((l) => `${l.name}@${l.slot}`)).toEqual(["z@0"]);
  await session.scheduler.pass({ wait: "jump" });
  expect(session.interp.globals.get("log"), "z waits for the next pass").toBe("cabz");

  // a handler that fails stops the pass at its slot: the slots after it are
  // not even counted down, and the pass draws no frame (0x44262a)
  session.interp.globals.set("log", "");
  // (an `if` on a number is an error 14 in the classic engines)
  propScript(session, "bad", "code fire ()\n\tif 5\n\tendif\nendcode\n");
  session.scheduler.makeLoop("prop", "bad", "fire", 1); // slot 0
  session.scheduler.makeLoop("prop", "b", "fire", 2); // slot 1
  const frames = session.frameCounter;
  const ok = await session.scheduler.pass({ wait: "jump" });
  expect(ok, "the pass reports the failure").toBe(false);
  expect(session.scheduler.isLoop("prop", "bad"), "the failing slot is freed").toBe(false);
  expect(session.scheduler.loops.find((l) => l.name === "b")?.count, "the slot after it was not counted").toBe(2);
  expect(session.frameCounter, "and no frame was drawn").toBe(frames);
});

test("a handler's forceupdate is a pass nested in it: loops fire inside the handler", async () => {
  const { session, ticks } = await bare();
  session.interp.globals.set("log", "");
  propScript(session, "bell", 'code ring ()\n\tglobal log\n\tlog = log @ "ring"\nendcode\n');
  await ticks(2);
  // the handler arms a loop of 2 and calls forceupdate twice: the loop fires
  // between its two passes, while the handler is still running
  await run(
    session,
    '\tglobal log\n\tmakeloop ("prop", "bell", "ring", 2)\n\tforceupdate ()\n\tlog = log @ "1"\n\tforceupdate ()\n\tlog = log @ "2"',
  );
  expect(session.interp.globals.get("log")).toBe("1ring2");
});
