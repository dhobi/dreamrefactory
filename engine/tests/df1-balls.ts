/**
 * DreamFactory 1's balls and hitboxes (engine/src/runtime/balls.ts), and the
 * v1 meanings of the ids v4 gave to its crickets and to `currentcd`.
 *
 *   npx vitest run engine/tests/df1-balls.ts
 *
 * Driven on a bare session with hand-made props and actors: the motion, the
 * four ways a ball ends and the hit box are all DF.EXE's arithmetic (0x439cf0,
 * 0x43a1c0, 0x43a320), so they are checked as arithmetic, pass by pass, against
 * the three things Dust throws — the range's bullet (TARGET.FLT), a shot bird
 * falling (TARGET.CST) and the tumbleweed (HOUSE.PRP).
 */
import { expect, test, vi } from "vitest";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { PropInstance } from "@dreamfactory/engine/runtime/props";
import { ActorInstance } from "@dreamfactory/engine/runtime/actors";
import { ballHits } from "@dreamfactory/engine/runtime/balls";

function session(v1 = true) {
  const s = new GameSession(() => null, new NullAudioSink());
  if (v1) s.dfVersion = 1;
  const logs: string[] = [];
  s.onLog = (l) => void logs.push(l);
  const call = (name: string, ...args: unknown[]): unknown =>
    s.interp.builtins.get(name)!(s.interp, args as never, {} as never, {} as never);
  const prop = (name: string, x: number, y: number, z: number, deg = 0) => {
    const p = new PropInstance({} as never, {} as never);
    p.name = name;
    p.worldX = x;
    p.worldY = y;
    p.worldZ = z;
    p.deg = deg;
    s.propRuntime.props.set(name, p);
    return p;
  };
  const actor = (name: string, x: number, y: number, z: number, set = "town") => {
    const a = new ActorInstance({} as never, {} as never);
    a.name = name;
    a.worldX = x;
    a.worldY = y;
    a.worldZ = z;
    a.visible = true;
    a.setName = set;
    s.actorRuntime.actors.set(name, a);
    return a;
  };
  s.actorRuntime.currentSet = "town";
  return { s, logs, call, prop, actor };
}

/** one pass over the table, without dispatching endball: (slot, reason) */
function pass(s: GameSession): (string | null)[] {
  const out: (string | null)[] = [];
  s.balls.slots.forEach((b, i) => {
    if (b) out.push(s.balls.advance(i, b));
  });
  return out;
}

test("makeball takes the prop's place and facing, and moves it a velocity a pass", () => {
  const { s, call, prop } = session();
  const p = prop("targbullet", 1000, 2000, 50, 77);
  call("makecricket", "targbullet", 30, -20, 5, 0, 0, 60);
  expect(call("iscricket", "targbullet")).toBe(1);
  expect(call("countcrickets")).toBe(1);
  expect(call("indextocricket", 1)).toBe("targbullet");
  expect(pass(s)).toEqual([null]);
  expect([p.worldX, p.worldY, p.worldZ]).toEqual([1030, 1980, 55]);
  p.deg = 5; // a script turns it mid-flight...
  pass(s);
  expect(p.deg, "...and the ball puts the facing it was thrown with back (0x43a0e8)").toBe(77);
  expect(p.worldSpace).toBe(true);
});

test("frames: n passes of movement, then endball(\"frames\") without moving", () => {
  const { s, call, prop } = session();
  const p = prop("b", 0, 0, 100);
  call("makecricket", "b", 1, 0, 0, 0, 0, 3);
  expect(pass(s)).toEqual([null]);
  expect(pass(s)).toEqual([null]);
  expect(pass(s)).toEqual([null]);
  expect(p.worldX).toBe(3);
  expect(pass(s)).toEqual(["frames"]);
  expect(p.worldX, "the frames end does not move the prop").toBe(3);
  expect(call("iscricket", "b")).toBe(0);
});

test("gravity pulls vz down by 2 a pass, and a non-bouncing ball ends at the ground", () => {
  const { s, call, prop } = session();
  const p = prop("bird", 0, 0, 10);
  // TARGET.CST's falling bird: makecricket (theprop, 0, 0, 0, 1, 0, 100)
  call("makecricket", "bird", 0, 0, 0, 1, 0, 100);
  const zs: number[] = [];
  let end: string | null = null;
  for (let i = 0; i < 10 && end === null; i++) {
    end = pass(s)[0];
    zs.push(p.worldZ);
  }
  expect(zs).toEqual([10, 8, 4, -2]);
  expect(end).toBe("building");
});

test("a bouncing ball bounces off the ground at half speed and settles", () => {
  const { s, call, prop } = session();
  const p = prop("tumbleweed", 0, 0, 0);
  // HOUSE.PRP's endball re-throw: makecricket (me, 0, 0, -2, 1, 1, 80)
  call("makecricket", "tumbleweed", 0, 0, 12, 1, 1, 80);
  const zs: number[] = [];
  for (let i = 0; i < 40; i++) {
    pass(s);
    zs.push(p.worldZ);
  }
  // up 12, 10, 8 ... back down to the ground at -14, then half that back up —
  // truncated towards zero, 7 — and so on until |vz| <= 2 stops it dead
  expect(zs.slice(0, 16)).toEqual([12, 22, 30, 36, 40, 42, 42, 40, 36, 30, 22, 12, 0, 7, 12, 15]);
  expect(Math.min(...zs)).toBe(0);
  expect(zs.slice(-5)).toEqual([0, 0, 0, 0, 0]);
  expect(s.balls.slots.find(Boolean)!.vz).toBe(0);
});

test("a bouncing ball comes back off a built-on cell; a plain one ends there", () => {
  const { s, call, prop } = session();
  const set = {
    version: 1,
    scenes: [{ sceneName: "scene b1", xAxisMap: 1 * 256 + 128, zAxisMap: 0 * 256 + 128, build: true }],
  };
  s.currentBinding = { set } as never;
  const p = prop("tw", 200, 100, 50);
  call("makecricket", "tw", 100, 0, 0, 0, 1, 80);
  pass(s);
  // into cell (1, 0), built on: back to the shared edge, (0 + 1 + 1) << 7 = 256,
  // and half the speed the other way
  expect(p.worldX).toBe(256);
  expect(s.balls.slots.find(Boolean)!.vx).toBe(-50);

  const q = prop("bullet", 200, 100, 50);
  call("makecricket", "bullet", 100, 0, 0, 0, 0, 80);
  expect(pass(s).at(-1)).toBe("building");
  expect(q.worldX, "the prop still goes where the ball got to").toBe(300);
});

test("the swept box: a miss only when both ends are beyond the same face", () => {
  const c = { x: 0, y: 0, z: 0 };
  // passing straight through, both ends outside — still a hit
  expect(ballHits({ x: -100, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, c.x, c.y, c.z, 10, 10)).toBe(true);
  expect(ballHits({ x: -100, y: 0, z: 0 }, { x: -50, y: 0, z: 0 }, 0, 0, 0, 10, 10)).toBe(false);
  // rz is the z half-height, rxy the half-width on x AND y
  expect(ballHits({ x: 0, y: 0, z: 30 }, { x: 0, y: 0, z: 30 }, 0, 0, 0, 40, 10)).toBe(true);
  expect(ballHits({ x: 0, y: 30, z: 0 }, { x: 0, y: 30, z: 0 }, 0, 0, 0, 40, 10)).toBe(false);
  // either half <= 0 is a box nothing hits (the range's water jets: -1, -1)
  expect(ballHits({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0, 0, 0, 0, 10)).toBe(false);
  expect(ballHits({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0, 0, 0, -1, -1)).toBe(false);
});

test("a bullet ends in the first actor whose box it crosses, by name", () => {
  const { s, call, prop, actor } = session();
  prop("targbullet", 0, 0, 100);
  const far = actor("birdtarg2", 300, 0, 100);
  const near = actor("birdtarg", 150, 0, 100);
  call("currentcd", "birdtarg", 10, 10);
  call("currentcd", "birdtarg2", 10, 10);
  call("makecricket", "targbullet", 55, 0, 0, 0, 0, 60);
  const ends: (string | null)[] = [];
  for (let i = 0; i < 4; i++) ends.push(...pass(s));
  expect(ends).toEqual([null, null, "birdtarg"]);
  expect(near.hitbox).toEqual([10, 10]);
  expect(far.hitbox).toEqual([10, 10]);
});

test("an actor out of the world, hidden, in another set or with no box is not hit", () => {
  const { s, call, prop, actor } = session();
  prop("b", 0, 0, 100);
  actor("hidden", 50, 0, 100).visible = false;
  actor("flat", 50, 0, 100).worldSpace = false;
  actor("elsewhere", 50, 0, 100, "bank");
  actor("nobox", 50, 0, 100);
  for (const n of ["hidden", "flat", "elsewhere"]) call("currentcd", n, 50, 50);
  call("makecricket", "b", 100, 0, 0, 0, 0, 3);
  expect(pass(s)).toEqual([null]);
});

test("the player is hit at playerxyz with z 0 and its own box", () => {
  const { s, call, prop } = session();
  s.listener = () => ({ x: 500, y: 500, deg: 0 });
  prop("shot", 400, 500, 60);
  call("makecricket", "shot", 60, 0, 0, 0, 0, 10);
  expect(pass(s), "no box yet").toEqual([null]);
  call("currentcd", "player", 100, 50);
  expect(call("currentcd", "player", 1)).toBe(100);
  expect(call("currentcd", "player", 2)).toBe(50);
  expect(pass(s)).toEqual(["player"]);
});

test("endball goes to the ball's prop after the slot is free, so it can throw again", async () => {
  const { s, call, prop } = session();
  prop("tumbleweed", 0, 0, 4);
  const inst = s.instanceFrom(
    compileScript(`code endball (arg)
\tglobal why, again
\twhy = arg
\tagain = iscricket (me)
\tmakecricket (me, 0, 0, -2, 1, 1, 80)
endcode
`),
    "tumbleweed",
  )!;
  const sent: string[] = [];
  s.sendEvent = (async (cmd: string, target: string, handler: string, args: unknown[]) => {
    sent.push(`${cmd} ${target} ${handler}(${args.join(",")})`);
    return (await s.interp.runHandler(inst, handler, args as never, { me: target, target: "" })).value;
  }) as typeof s.sendEvent;
  call("makecricket", "tumbleweed", 0, 0, 0, 0, 0, 0);
  s.balls.step(); // frames 0 -> -1: ends at once
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  expect(sent).toEqual(["sendtoprop tumbleweed endball(frames)"]);
  expect(s.interp.globals.get("why")).toBe("frames");
  expect(s.interp.globals.get("again"), "the slot was already empty").toBe(false);
  expect(call("iscricket", "tumbleweed"), "and the handler threw it again").toBe(1);
});

test("stopball and pauseball: a name or all, and pausing is a depth", () => {
  const { s, call, prop } = session();
  const p = prop("a", 0, 0, 100);
  prop("b", 0, 0, 100);
  call("makecricket", "a", 1, 0, 0, 0, 0, 50);
  call("makecricket", "b", 1, 0, 0, 0, 0, 50);
  call("pausecricket", "a", 1);
  call("pausecricket", "all", 1);
  expect(call("pausecricket", "a")).toBe(2);
  pass(s);
  expect(p.worldX).toBe(0);
  call("pausecricket", "a", 0);
  pass(s);
  expect(p.worldX, "one level still paused").toBe(0);
  call("pausecricket", "a", 0);
  call("pausecricket", "a", 0);
  expect(call("pausecricket", "a"), "does not go below 0").toBe(0);
  pass(s);
  expect(p.worldX).toBe(1);
  call("stopcricket", "a");
  expect(call("countcrickets")).toBe(1);
  expect(call("indextocricket", 1)).toBe("b");
  expect(call("indextocricket", 2)).toBe("none");
  call("stopcricket", "all");
  expect(call("countcrickets")).toBe(0);
});

test("makeball on a prop already flying replaces its ball", () => {
  const { s, call, prop } = session();
  prop("a", 0, 0, 100);
  call("makecricket", "a", 1, 0, 0, 0, 0, 50);
  call("makecricket", "a", 5, 0, 0, 0, 0, 50);
  expect(call("countcrickets")).toBe(1);
  expect(s.balls.slots.find(Boolean)!.vx).toBe(5);
});

test("actorhitbox reads 1 and 2, and does not touch the mounted CD", () => {
  const { s, call, actor } = session();
  s.mountedCd = "dust";
  const a = actor("bounty1", 0, 0, 0);
  // EXTRA.CST/0287's gate: `if name != "scene b11" & actorhitbox (me, 1) = 0`
  expect(call("currentcd", "bounty1", 1)).toBe(0);
  call("currentcd", "bounty1", 100, 50);
  expect(a.hitbox).toEqual([100, 50]);
  expect(call("currentcd", "bounty1", 1)).toBe(100);
  expect(call("currentcd", "bounty1", 2)).toBe(50);
  expect(call("currentcd", "bounty1", 3), "any other index is no answer").toBe(0);
  expect(s.mountedCd).toBe("dust");
});

test("EXTRA.CST's actorhitbox gate turns on the box, as the script means", async () => {
  const { s, actor } = session();
  actor("bounty1", 0, 0, 0);
  const inst = s.instanceFrom(
    compileScript(`code gate (name)
\tif name != "scene b11" & currentcd (me, 1) = 0
\t\treturn (1)
\tendif
\treturn (0)
endcode
`),
    "bounty1",
  )!;
  const gate = async (name: string) =>
    (await s.interp.runHandler(inst, "gate", [name], { me: "bounty1", target: "" })).value;
  expect(await gate("scene a1"), "box off: the hunter stays put").toBe(1);
  expect(await gate("scene b11")).toBe(0);
  s.interp.builtins.get("currentcd")!(s.interp, ["bounty1", 1, 0] as never, {} as never, {} as never);
  expect(await gate("scene a1"), "box (1, 0) still has rz 1").toBe(0);
});

test("a v4 game keeps its crickets and its CD", () => {
  const { s, call } = session(false);
  // TI.EXE's makecricket wants a set open (0x28) and the sound (0xa)
  s.currentSetName = "engine";
  vi.spyOn(s.audioLib, "sound").mockImplementation(() => ({ sampleRate: 11025, samples: new Float32Array(1) }) as never);
  call("makecricket", "steam1", 10, 20, 100, 5, -1);
  expect(s.scheduler.crickets.map((c) => c.name)).toEqual(["steam1"]);
  expect(s.balls.count()).toBe(0);
  call("currentcd", "Titanic1");
  expect(s.mountedCd).toBe("Titanic1");
});
