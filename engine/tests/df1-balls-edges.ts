/**
 * DreamFactory 1's balls (engine/src/runtime/balls.ts) off the road
 * df1-balls.ts takes: `makeball` for a prop that is not there, and a full
 * table of 16 (DF.EXE 0x439a90); `pauseball` and its getter for a name with no
 * ball, with no name at all, and `makeball` given arguments with no value;
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

test("makeball for a prop that is not there, or with every slot taken, throws nothing", () => {
  const { s, logs, call, prop } = session();
  call("makecricket", "ghost", 1, 0, 0, 0, 0, 5);
  expect(logs.at(-1)).toBe("makeball: no prop ghost");
  for (let i = 0; i <= BALL_SLOTS; i++) {
    prop(`p${i}`);
    call("makecricket", `p${i}`, 1, 0, 0, 0, 0, 5);
  }
  expect(s.balls.count()).toBe(BALL_SLOTS);
  expect(logs.at(-1)).toBe(`makeball: ball table full (${BALL_SLOTS}), dropping p${BALL_SLOTS}`);
  expect(call("iscricket", `p${BALL_SLOTS}`)).toBe(0);
});

test("pauseball for a name with no ball, or no name; makeball's arguments with no value are 0", () => {
  const { s, call, prop } = session();
  prop("a");
  // arguments with no value are 0: no gravity, no bounce, and frames 0
  call("makecricket", "a", 3, undefined, undefined, undefined, undefined, undefined);
  const ball = s.balls.slots.find(Boolean)!;
  expect([ball.vx, ball.vy, ball.vz, ball.gravity, ball.bounce, ball.frames]).toEqual([3, 0, 0, 0, 0, 0]);
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
