/**
 * The screen, set and stage commands' edges (engine/src/runtime/builtins/scene.ts):
 * what each answers with an argument left off, a name that is not there, or
 * nothing open at all, and the editor-stub commands' argument checks.
 *
 *   npx vitest run engine/tests/scene-builtins.ts
 *
 * Needs no game data: the stage and shop are written with the engine's own
 * builders, and the set is the handful of fields these commands read.
 */
import { expect, test } from "vitest";
import { buildShpBytes } from "@dreamfactory/engine/df/shp-build";
import { buildStgBytes } from "@dreamfactory/engine/df/stg-build";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { packPoint } from "@dreamfactory/engine/runtime/point";
import { GameSession } from "@dreamfactory/engine/runtime/session";

const PALETTE = new Uint8Array([0, 0, 0, 200, 200, 200]);
const art = (w: number, h: number) => ({ pixels: new Uint8Array(w * h).fill(1), width: w, height: h });

/** a set with one scene of two views, one of which a road leaves */
const SET = {
  version: 4,
  mapWidth: 12,
  mapHeight: 7,
  scenes: [
    {
      sceneName: "Scene1",
      xAxisMap: 512,
      zAxisMap: 768,
      yAxisMap: 3,
      views: [
        { viewName: "View1", viewID: 1, objects: [{ identifier: "Door" }, { identifier: "lamp" }] },
        { viewName: "View2", viewID: 2, objects: [] },
      ],
    },
  ],
  transitions: [{ viewIDstart: 9, viewIDend: 1 }],
};

function bare() {
  const session = new GameSession(() => null, new NullAudioSink());
  const unknown: string[] = [];
  session.interp.onUnknown = (name) => unknown.push(name);
  const call = (name: string, ...args: (number | string | undefined)[]) =>
    session.interp.builtins.get(name)!(session.interp, args as never, {} as never, {} as never);
  const fails = (name: string, ...args: (number | string | undefined)[]) =>
    expect((async () => call(name, ...args))()).rejects;
  return { session, call, fails, unknown };
}

async function staged() {
  const stg = buildStgBytes({
    palette: PALETTE,
    refName: "panel",
    flats: [
      { name: "front", art: art(8, 8), regions: [{ name: "ok", top: 0, left: 0, bottom: 4, right: 4 }] },
      { name: "back", art: art(8, 8) },
    ],
  });
  const shp = buildShpBytes({
    palette: PALETTE,
    groups: [{ name: "lamp", states: [{ identifier: "on", frames: [{ art: { width: 1, height: 1, posXraw: 0, posYraw: 0, indexed: new Uint8Array(1), opaque: new Uint8Array([1]) } as never }] }] }],
  });
  const t = bare();
  const byName: Record<string, Uint8Array> = { "p.stg": stg, "t.shp": shp };
  const files = (n: string) => byName[n] ?? null;
  (t.session as unknown as { files: (n: string) => Uint8Array | null }).files = files;
  return t;
}

test("the set tables answer empty with no set open, and from the set when one is", async () => {
  const { session, call } = bare();
  expect(await call("countscenes")).toBe(0);
  expect(await call("indextoscene")).toBe("");
  expect(await call("countviews")).toBe(0);
  expect(await call("indextoview")).toBe("");
  expect(await call("scenexyz", "scene1", 1)).toBe(0);
  expect(await call("countpaintings")).toBe(0);
  expect(await call("indextopainting")).toBe("");
  expect(await call("roadahead")).toBe(0);
  expect(await call("indextoshop")).toBe("");
  expect(await call("countbuttons")).toBe(0);
  expect(await call("indextobutton")).toBe("");

  session.currentBinding = { set: SET } as never;
  expect(await call("countscenes")).toBe(1);
  expect(await call("indextoscene", 1)).toBe("Scene1");
  expect(await call("indextoscene", 2)).toBe("");
  expect(await call("countviews", "SCENE1")).toBe(2);
  expect(await call("indextoview", "scene1", 2)).toBe("View2");
  expect(await call("indextoview", "scene1", 3)).toBe("");
  expect(await call("indextoview", "scene1")).toBe("");
  expect(await call("scenexyz")).toBe(0);
  expect(await call("indextopainting", "scene1", "view1")).toBe("");
  // the axes, playerxyz's numbering; no axis is X
  expect(await call("scenexyz", "scene1")).toBe(512);
  expect(await call("scenexyz", "scene1", 2)).toBe(768);
  expect(await call("scenexyz", "scene1", 3)).toBe(3);
  expect(await call("scenexyz", "scene1", 4)).toBe(packPoint(512, 768));
  expect(await call("scenexyz", "scene1", 5)).toBe(0);
  expect(await call("countpaintings", "scene1", "view1")).toBe(2);
  expect(await call("indextopainting", "scene1", "view1", 1)).toBe("Door");
  expect(await call("indextopainting", "scene1", "view1", 3)).toBe("");
  // a road counts from either of its ends
  expect(await call("roadahead", "scene1", "view1")).toBe(1);
  expect(await call("roadahead", "scene1", "view2")).toBe(0);
  // a binding with no transitions has no roads
  session.currentBinding = { set: { ...SET, transitions: undefined } } as never;
  expect(await call("roadahead", "scene1", "view1")).toBe(0);
});

test("DreamFactory 1's setwidth/setheight read the grid, and answer 0 with no set", async () => {
  const { session, call, unknown } = bare();
  const log: string[] = [];
  session.onLog = (m: string) => log.push(m);
  // off v1, pointinpainting is the unknown command it always was
  expect(await call("pointinpainting")).toBe(0);
  expect(unknown).toEqual(["pointinpainting"]);
  session.dfVersion = 1;
  expect(await call("countpaintings")).toBe(0);
  expect(await call("pointinpainting")).toBe(0);
  expect(log).toEqual(["setheight: no set open", "setwidth: no set open"]);
  session.currentBinding = { set: SET } as never;
  expect(await call("countpaintings")).toBe(7);
  expect(await call("pointinpainting")).toBe(12);
});

test("getters and setters with their argument left off", async () => {
  const { session, call } = bare();
  session.cameraHiBias = 5;
  expect(await call("camerahi")).toBe(5);
  await call("camerahi", 7.9);
  expect(session.cameraHiBias).toBe(7);
  expect(await call("stagevisible")).toBe(0);
  session.stageName = "x";
  expect(await call("stagevisible")).toBe(1);
  expect(await call("indextoflat", 1)).toBe("none");
  expect(await call("actionframe")).toBe(0);
  session.movieActions.add(0);
  expect(await call("actionframe")).toBe(1);
  // fileexists with no name asks for nothing
  expect(await call("fileexists")).toBe(0);
  expect(await call("fileexists", "nothing.mov")).toBe(0);
  // themevol's track is optional
  await call("themevol", undefined, 40);
  expect(session.themeVolume).toBe(40);
  expect(await call("themevol", "x")).toBe(40);
  // playmovie hands the host the name it was given, or none
  const played: string[] = [];
  session.onPlayMovie = (n) => {
    played.push(n);
  };
  await call("playmovie");
  await call("playmovie", "a.mov");
  expect(played).toEqual(["", "a.mov"]);
});

test("currentscene: a word naming no direction is error 0xa where the exe checks", async () => {
  const { session, call, fails } = bare();
  const went: string[] = [];
  session.onNavigate = async (d: string) => {
    went.push(d);
  };
  await call("currentscene", "left");
  expect(went).toEqual(["left"]);
  await fails("currentscene", "sideways").toMatchObject({ code: 0xa });
  // a scene name jumps, and nothing is navigated
  const jumped: string[] = [];
  session.onSceneJump = (d: string) => {
    jumped.push(d);
    return undefined as never;
  };
  await call("currentscene", "Scene7");
  expect(jumped).toEqual(["scene7"]);
  expect(went).toEqual(["left"]);
});

test("currenttheme on DreamFactory 1: the bank's name, or the chunk playing, or none", async () => {
  const { session, call } = bare();
  session.dfVersion = 1;
  expect(await call("currenttheme")).toBe("none");
  session.currentThemeName = "town";
  // no bank by that name: the name itself, and no chunk
  expect(await call("currenttheme", 2)).toBe("town");
  expect(await call("currenttheme")).toBe("none");
  session.dfVersion = 4;
  expect(await call("currenttheme", 2)).toBe("town");
});

test("mixclut and clut: only a black mix, defaults for a range left off, clut with no name does nothing", async () => {
  const { session, call } = bare();
  const cluts: [string, unknown][] = [];
  session.onClut = (t, d) => cluts.push([t, d]);
  await call("mixclut", "set", "white", 0, 10, 5);
  await call("mixclut");
  expect(cluts).toEqual([]);
  await call("mixclut", undefined, "BLACK");
  expect(cluts).toEqual([["", { lo: 0, hi: 255, amt: 0 }]]);
  await call("clut");
  expect(cluts).toHaveLength(1);
  await call("clut", "Set");
  expect(cluts[1]).toEqual(["set", null]);
  await call("clut", "black");
  expect(session.fade.level).toBe(1);
});

test("screentoblack with no step count ramps over ten", async () => {
  const { session, call } = bare();
  await call("screentoblack", "current");
  expect(session.fade.queue).toEqual([{ to: 1, steps: 10 }]);
});

test("visualeffect: no effect is plain, and a reveal with nothing to capture is no reveal", async () => {
  const { session, call } = bare();
  let painted = 0;
  session.repaintNow = () => {
    painted++;
  };
  await call("visualeffect");
  expect(painted).toBe(1);
  // the leaving picture is there but the arriving one is not
  const frame = { rgba: new Uint8ClampedArray(4), width: 1, height: 1 };
  let n = 0;
  session.captureFrame = () => (n++ === 0 ? frame : null);
  await call("visualeffect", "wipeleft", 5);
  expect(session.wipe.from).not.toBe(frame);
  expect(n).toBe(2);
  // both pictures, and no step count: one step
  session.captureFrame = () => frame;
  const seen: { steps: number; from: unknown }[] = [];
  session.frameWait = () => {
    seen.push({ steps: session.wipe.steps, from: session.wipe.from });
    session.endWipe();
    return Promise.resolve();
  };
  await call("visualeffect", "wipeleft");
  expect(seen).toEqual([{ steps: 1, from: frame }]);
  // a turn that is not drawn and has no direction is nothing
  session.captureFrame = () => {
    throw new Error("not captured");
  };
  await call("visualeffect", "nodraw");
  // a name no engine draws reveals nothing
  await call("visualeffect", "sideways");
  expect(session.wipe.dir).toBe("");
});

test("the editor-stub commands check their arguments, with the codes each exe raises", async () => {
  const { session, call, fails } = await staged();
  for (const c of ["bootscript", "postscript", "serverscript"]) expect(await call(c)).toBeUndefined();
  await fails("setscript").toMatchObject({ code: 0x28 });
  await fails("scenescript", "scene1").toMatchObject({ code: 0x28 });
  await fails("paintingscript").toMatchObject({ code: 0xb });
  session.isV5 = true;
  await fails("paintingscript").toMatchObject({ code: 0x28 });
  session.isV5 = false;
  session.currentBinding = { set: SET } as never;
  await call("setscript");
  await fails("scenescript").toMatchObject({ code: 0xa });
  await call("scenescript", "SCENE1");
  await fails("paintingscript").toMatchObject({ code: 0xa, message: expect.stringContaining('scene ""') });
  await fails("paintingscript", "scene1").toMatchObject({ message: expect.stringContaining('view ""') });
  await fails("paintingscript", "scene1", "view1").toMatchObject({ message: expect.stringContaining('painting ""') });
  await call("paintingscript", "scene1", "view1", "door");

  // DF.EXE's floorscript in the same slot: an integer 0..31
  session.dfVersion = 1;
  await call("paintingscript", 31);
  await fails("paintingscript", 32).toMatchObject({ code: 0xe });
  await fails("paintingscript", -1).toMatchObject({ code: 0xe });
  await fails("paintingscript", "3").toMatchObject({ code: 0xe });
  await fails("paintingscript").toMatchObject({ code: 0xe, message: expect.stringContaining("floor  is") });
  session.currentBinding = null;
  await fails("paintingscript", 3).toMatchObject({ code: 0x28 });
  session.dfVersion = 4;

  await fails("stagescript").toMatchObject({ code: 0xb });
  await fails("flatscript", "front").toMatchObject({ code: 0xb });
  await fails("buttonscript", "front", "ok").toMatchObject({ code: 0xb });
  expect(await call("openstagefile", "p.stg")).toBe(1);
  expect(await call("openstagefile")).toBe(0);
  expect(await call("openstagefile", "p.stg")).toBe(1);
  await call("stagescript");
  await fails("flatscript").toMatchObject({ code: 0xa });
  await call("flatscript", "FRONT");
  await fails("buttonscript", "front").toMatchObject({ code: 0xa });
  await call("buttonscript", "front", "OK");
  expect(await call("countbuttons", "front")).toBe(1);
  expect(await call("indextobutton", "front", 1)).toBe("ok");
  expect(await call("indextobutton", "front", 2)).toBe("");
  expect(await call("flattoindex")).toBe(0);
  await call("gotoflat");
  // no name is a flat called "": the stage is left showing none of its own
  expect(session.currentFlat).toBe("");
  expect(await call("flattoindex", "back")).toBe(2);

  await fails("puppetscript", "boot").toMatchObject({ code: 0x2d });
  await fails("propscript").toMatchObject({ code: 0xa });
  await fails("shopscript").toMatchObject({ code: 0xa });
  await session.openShop("t.shp");
  await call("propscript", "lamp");
  await call("shopscript", "T.SHP");
  expect(await call("indextoshop", 1)).toBe("t.shp");
  await fails("castscript").toMatchObject({ code: 0xa });
  await fails("castscript", "x.cst").toMatchObject({ message: expect.stringContaining('cast file "x.cst"') });
  await fails("actorscript", "nick").toMatchObject({ message: expect.stringContaining('actor "nick"') });
  session.actorRuntime.casts.set("gang.cst", {} as never);
  session.actorRuntime.actors.set("nick", {} as never);
  await call("castscript", "GANG.CST");
  await call("actorscript", "nick");
  await fails("actorscript").toMatchObject({ code: 0xa, message: expect.stringContaining('actorscript: no actor ""') });
});
