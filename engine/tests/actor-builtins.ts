/**
 * The actor commands' edges (engine/src/runtime/builtins/actors.ts): an actor
 * that is not there, an argument left off, the getter forms, and the walks'
 * not-found and deferred paths in each engine.
 *
 *   npx vitest run engine/tests/actor-builtins.ts
 *
 * Needs no game data: the actors are bare records, and the set is the stars
 * and routes these commands read.
 */
import { expect, test } from "vitest";
import { ActorInstance } from "@dreamfactory/engine/runtime/actors";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { packPoint } from "@dreamfactory/engine/runtime/point";
import { GameSession } from "@dreamfactory/engine/runtime/session";

type Arg = number | string | undefined;

const star = (identifier: string, x: number, y: number, z: number) =>
  ({ identifier, positionX: x, positionY: y, positionZ: z, rotation8: 64 });

function rig(version = 4) {
  const session = new GameSession(() => null, new NullAudioSink());
  const log: string[] = [];
  session.onLog = (m: string) => log.push(m);
  const call = (name: string, ...args: Arg[]) =>
    session.interp.builtins.get(name)!(session.interp, args as never, {} as never, { ctx: { me: "t" } } as never);
  const fails = (name: string, ...args: Arg[]) => expect((async () => call(name, ...args))()).rejects;
  const add = (name: string, setName = "") => {
    const a = new ActorInstance({ name, poses: [] } as never, { name: "x.cst", members: [] } as never);
    a.name = name;
    a.setName = setName;
    session.actorRuntime.actors.set(name, a);
    return a;
  };
  session.currentBinding = {
    onLog: (m: string) => log.push(m),
    set: {
      version,
      scenes: [],
      starPaths: [],
      actors: [star("dock", 100, 5, 200), star("gate", 300, 0, 400)],
    },
  } as never;
  return { session, log, call, fails, add };
}

test("missing actors and missing arguments answer the empty value and change nothing", async () => {
  const { session, call, add } = rig();
  expect(await call("opencastfile")).toBe(0);
  expect(await call("actorhide", "nobody")).toBeUndefined();
  expect(await call("closecastfile")).toBeFalsy();
  expect(await call("actorxyz", "nobody", 1)).toBe(0);
  expect(await call("actorxy", "nobody", 1)).toBe(0);
  expect(await call("walktoxyz", "nobody", 1, 2, 3)).toBe(0);
  expect(await call("walkonpath", "nobody", "dock", "gate")).toBe(0);
  expect(await call("walkonroad", "nobody", "s", "v")).toBeUndefined();
  expect(await call("turntodeg", "nobody", 10)).toBeUndefined();
  expect(session.scheduler.walks.size).toBe(0);
  // the actor-to-actor copy wants a destination name
  await call("actorinstance");
  expect(session.actorRuntime.actors.size).toBe(0);
  // actordist's write form on nobody does nothing, and its sight check of no name logs nothing
  expect(await call("actordist", "nobody", -2)).toBe(0);
  expect(await call("actordist")).toBe(32000);

  const a = add("nick");
  a.visible = true;
  session.interp.setGlobal("curattention", "NICK");
  await call("actorhide", "nick");
  // hidden, and no longer claiming the player's attention
  expect([a.visible, session.interp.globals.get("curattention")]).toEqual([false, ""]);
  expect(await call("actorxyz", "nick")).toBe(0);
  await call("actorxyz", "nick", 10, 20);
  expect([a.worldX, a.worldY, a.worldZ, a.worldSpace]).toEqual([10, 20, 0, true]);
  expect(await call("actorxyz", "nick", 4)).toBe(packPoint(10, 20));
  expect(await call("actorxyz", "nick", 9)).toBe(0);
  expect(await call("actoris3d", "nick")).toBe(1);
  await call("actorxy", "nick", 5, 6);
  expect(await call("actoris3d", "nick")).toBe(0);
  expect(await call("actorxy", "nick", 2)).toBe(6);
  await call("actordist", "nick", -2);
  expect(a.dist).toBe(-2);
  expect(await call("indextoactor")).toBe("");
  expect(await call("indextoactor", 1)).toBe("nick");
  expect(await call("indextocast")).toBe("");
  // walktoxyz with its coordinates left off walks to the origin
  await call("walktoxyz", "nick");
  expect(session.scheduler.walks.get("nick")).toMatchObject({ arriveStar: "custom" });
  expect(a.starName).toBe("walktoxyz");
  expect(await call("walkdest", "nick")).toBe("custom");
  expect(await call("walkdest")).toBe("None");
  session.scheduler.walks.get("nick")!.arriveStar = undefined;
  expect(await call("walkdest", "nick")).toBe("custom");
  expect(await call("indextowalk")).toBe("");
  expect(await call("indextowalk", 1)).toBe("nick");
  // stopwalk and iswalk with no name touch nothing
  await call("stopwalk");
  expect(await call("iswalk")).toBe(0);
  expect(await call("iswalk", "nick")).toBe(1);
  await call("stopwalk", "nick");
  expect(await call("iswalk", "nick")).toBe(0);
  // a turn with no angle turns to 0, and is a walk record of its own
  await call("turntodeg", "nick");
  expect(await call("iswalk", "nick")).toBe(1);
});

test("actorink takes 1..9 and keeps what it had otherwise (DreamFactory 5)", async () => {
  const { session, call, add } = rig();
  session.isV5 = true;
  const a = add("nick");
  await call("actorink", "nick", 3);
  await call("actorink", "nick", 10);
  await call("actorink", "nick", 0);
  expect(a.ink).toBe(3);
});

test("actordelete: DreamFactory 5's wants an actor, the others' take any name", async () => {
  const { session, call, fails, add } = rig();
  add("nick");
  await call("actordelete");
  expect(session.actorRuntime.get("nick")).toBeTruthy();
  session.isV5 = true;
  await fails("actordelete").toMatchObject({ code: 0xa });
});

test("pausewalk: a getter on the engines that have one, a pause otherwise", async () => {
  const { session, call, add } = rig();
  add("nick");
  await call("walktoxyz", "nick", 5, 5, 0);
  const w = session.scheduler.walks.get("nick")!;
  await call("pausewalk");
  expect(await call("pausewalk", "nick")).toBe(0);
  await call("pausewalk", "nick", 1);
  expect(await call("pausewalk", "nick")).toBe(1);
  await call("pausewalk", "nick", 0);
  expect(await call("pausewalk", "nick")).toBe(0);
  // RedJack.exe's has no getter: one argument pauses
  session.isV5 = true;
  expect(await call("pausewalk", "nick")).toBeUndefined();
  expect(w.paused).toBe(true);
});

test("walktostar on TI.EXE: built now in the open set, deferred off it, error 0xa for no star", async () => {
  const { session, call, fails, add } = rig();
  const a = add("nick", "");
  await call("walktostar", "nick", "dock");
  expect(session.scheduler.walks.get("nick")).toMatchObject({ arriveStar: "dock" });
  await fails("walktostar", "nick").toMatchObject({ code: 0xa, message: expect.stringContaining('no star ""') });
  // off its set, deferred: the record says so, and the build runs later
  const b = add("lyle", "elsewhere");
  await call("walktostar", "lyle", "gate");
  expect(b.starName).toBe("defer");
  // a "x,y" pair is a point, z defaulting to 0
  await call("walktostar", "nick", "7, -8");
  expect(a.starName).toBe("walktoxyz");
  expect(session.scheduler.walks.get("nick")).toMatchObject({ arriveStar: "custom" });
  // the saved-game rebuilder: an actor gone is no walk; each mode its own builder
  const build = session.deferredWalkBuilder;
  expect(build("nobody", 1, "dock", "")).toBeNull();
  expect(() => build("nick", 1, "moon", "")!()).toThrow(/no star "moon"/);
  build("nick", 1, "gate", "")!();
  expect(session.scheduler.walks.get("nick")).toMatchObject({ arriveStar: "gate" });
  expect(() => build("nick", 4, "scene1", "view1")!()).toThrow(/no road from scene1\/view1/);
  build("nick", 3, "gate", "dock")!();
  expect(a.worldX).toBe(100);
});

test("walktostar on DF.EXE: a star nowhere is logged and nothing walks", async () => {
  const { session, log, call, add } = rig(1);
  session.dfVersion = 1;
  add("nick");
  await call("walktostar", "nick");
  expect(log.at(-1)).toBe('walktostar: nick -> "" not found');
  await call("walktostar", "nobody", "dock");
  expect(log.at(-1)).toBe('walktostar: nobody -> "dock" not found');
  expect(session.scheduler.walks.size).toBe(0);
  // a route of one point is no route: the walk goes straight there
  session.starPathRegistry.set("a", { a: "gate", b: "dock", points: [{ x: 1, y: 2, z: 3, fromPrev: 0 }] } as never);
  await call("actorstar", "nick", "gate");
  await call("walktostar", "nick", "dock");
  expect(session.scheduler.walks.get("nick")).toMatchObject({ arriveStar: "dock" });
});

test("walkonpath: no destination logs, a start star places the actor first", async () => {
  const { session, log, call, add } = rig();
  const a = add("nick");
  await call("walkonpath", "nick");
  expect(log.at(-1)).toBe('walkonpath: star "" not found');
  await call("walkonpath", "nick", "resume", "gate");
  expect(a.worldX).toBe(0);
  await call("walkonpath", "nick", "nowhere", "gate");
  expect(a.worldX).toBe(0);
  await call("walkonpath", "nick", "dock", "gate");
  expect([a.worldX, a.worldY, a.worldZ]).toEqual([100, 200, 5]);
  expect(session.scheduler.walks.get("nick")).toMatchObject({ arriveStar: "gate" });
  // RedJack.exe's needs a route, and has none here
  session.isV5 = true;
  await expect((async () => call("walkonpath", "nick", "dock", "gate"))()).rejects.toMatchObject({ code: 0xa });
});

test("walkonroad/walkonframes: names of 16 are error 0x1a; off its set the walk waits", async () => {
  const { session, call, fails, add } = rig();
  add("nick", "elsewhere");
  await fails("walkonroad", "nick", "x".repeat(16), "v").toMatchObject({ code: 0x1a });
  await fails("walkonframes", "nick", "s", "y".repeat(16)).toMatchObject({ code: 0x1a });
  await call("walkonroad", "nick");
  expect(session.actorRuntime.get("nick")!.starName).toBe("defer");
  add("lyle");
  await fails("walkonframes", "lyle", "scene1", "view1").toMatchObject({ message: expect.stringContaining("no road") });
});
