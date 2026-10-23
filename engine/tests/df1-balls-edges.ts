/**
 * DreamFactory 1's balls (engine/src/runtime/balls.ts) off the road
 * df1-balls.ts takes: the script errors `makeball` raises (DF.EXE 0x439a90) —
 * too few arguments, one that is not an integer, a prop that is not there, a
 * full table of 16; `pauseball` and its getter for a name with no ball and
 * with no name at all;
 * and a pass asked for while an `endball` is still running, which
 * waits for it rather than servicing the table twice.
 *
 *   npx vitest run engine/tests/df1-balls-edges.ts
 *
 * No game data: props made here.
 */
import { expect, test } from "vitest";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { PropInstance } from "@dreamfactory/engine/runtime/props";
import { BALL_SLOTS } from "@dreamfactory/engine/runtime/balls";

function session() {
  const s = new GameSession(() => null, new NullAudioSink());
  s.dfVersion = 1;
  const logs: string[] = [];
  s.onLog = (l) => void logs.push(l);
  const call = (name: string, ...args: unknown[]): unknown =>
    s.interp.builtins.get(name)!(s.interp, args as never, {} as never, {} as never);
  const prop = (name: string, z = 100) => {
    const p = new PropInstance({} as never, {} as never);
    p.name = name;
    p.worldZ = z;
    s.propRuntime.props.set(name, p);
    return p;
  };
  return { s, logs, call, prop };
}

const code = (f: () => unknown): number | undefined => {
  try {
    f();
  } catch (e) {
    return (e as { code?: number }).code;
  }
  return undefined;
};

test("makeball for a prop that is not there is error 0xa, a seventeenth ball error 8 (Too many balls.)", () => {
  const { s, call, prop } = session();
  expect(code(() => call("makecricket", "ghost", 1, 0, 0, 0, 0, 5))).toBe(0xa);
  for (let i = 0; i < BALL_SLOTS; i++) {
    prop(`p${i}`);
    call("makecricket", `p${i}`, 1, 0, 0, 0, 0, 5);
  }
  prop(`p${BALL_SLOTS}`);
  expect(code(() => call("makecricket", `p${BALL_SLOTS}`, 1, 0, 0, 0, 0, 5))).toBe(8);
  expect(s.balls.count()).toBe(BALL_SLOTS);
  expect(call("iscricket", `p${BALL_SLOTS}`)).toBe(0);
});

test("makeball reads its arguments as DF.EXE does: too few is 0x1c, a number that is not one 0xe", () => {
  const { s, call, prop } = session();
  prop("a");
  // a `)` where a `,` is wanted, before the prop is looked up and after
  expect(code(() => call("makecricket", "a", 3))).toBe(0x1c);
  expect(code(() => call("makecricket", "ghost", 3))).toBe(0x1c);
  expect(code(() => call("makecricket", "a", 3, 0, 0, 1))).toBe(0x1c);
  // the prop is looked up after the third number: missing, it wins over a short tail
  expect(code(() => call("makecricket", "ghost", 3, 0, 0, 1))).toBe(0xa);
  // an empty argument, or a string, is not an integer
  expect(code(() => call("makecricket", "a", 3, undefined, 0, 0, 0, 5))).toBe(0xe);
  expect(code(() => call("makecricket", "a", 3, 0, 0, 0, "x", 5))).toBe(0xe);
  expect(s.balls.count()).toBe(0);
});

test("pauseball for a name with no ball, or no name", () => {
  const { s, call, prop } = session();
  prop("a");
  call("makecricket", "a", 3, 0, 0, 0, 0, 0);
  const ball = s.balls.slots.find(Boolean)!;
  call("pausecricket", "nobody", 1);
  expect(ball.pause).toBe(0);
  expect(call("pausecricket", "nobody")).toBe(false);
  // a flag with no name is all of them; no name and no flag asks for no ball
  call("pausecricket", undefined, 1);
  expect(ball.pause).toBe(1);
  expect(call("pausecricket")).toBe(false);
});

test("a pass asked for while an endball runs waits for it; the slots after it are serviced then", async () => {
  const { s, prop } = session();
  const first = prop("first");
  const second = prop("second");
  let finish = () => {};
  const heard: string[] = [];
  s.sendEvent = (async (_cmd: string, target: string, handler: string, args: unknown[]) => {
    heard.push(`${target}.${handler}(${args.join(",")})`);
    await new Promise<void>((r) => (finish = r));
    return 0;
  }) as typeof s.sendEvent;
  s.balls.make("first", [0, 0, 0, 0, 0, 0]); // frames 0: ends on its first pass
  s.balls.make("second", [2, 0, 0, 0, 0, 50]);
  s.balls.step();
  expect(heard).toEqual(["first.endball(frames)"]);
  expect([first.worldX, second.worldX]).toEqual([0, 0]);
  s.balls.step(); // endball still running: nothing more
  expect(second.worldX).toBe(0);
  finish();
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  // the rest of the first pass, once: one step of 2
  expect(second.worldX).toBe(2);
});
