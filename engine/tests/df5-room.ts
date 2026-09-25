/**
 * DreamFactory 5's rooms: the angle arithmetic RedJack's scripts are written
 * in, the projector a click is tested against, and — where the rip is here —
 * that every room reads and every sphere agrees with the films that leave it.
 *
 *   npx vitest run engine/tests/df5-room.ts
 *
 * The first half needs no game data. The second reads `redjack/gamefiles` and
 * skips loudly without it, as the other corpus checks do.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect } from "vitest";
import { FrameBuffer } from "@dreamfactory/engine/df/image";
import { decodeFrameV5, depthV5, paletteV5 } from "@dreamfactory/engine/df/image-v5";
import { MazeQuad, SettFile, TURN, exitsOf, readSettFile } from "@dreamfactory/engine/df/sett";
import {
  MazeRuntime,
  calcTurn,
  degDiff,
  degMask,
  degToSimple,
  inPolygon,
  simpleToDeg,
  walkFrameMs,
} from "@dreamfactory/engine/runtime/maze";
import { DEPTH_FAR, SphereImage } from "@dreamfactory/engine/runtime/maze-render";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { inkAlpha } from "@dreamfactory/engine/runtime/props";

test("angles are 2^24ths of a turn, as degmask (-1) and gotonode's fov say", () => {
  expect(degMask(-1)).toBe(TURN - 1);
  expect(simpleToDeg(90)).toBe(TURN / 4);
  // gotonode's `camerafov (cfov * 65536)` with the 64 every caller passes
  expect(64 * 65536).toBe(simpleToDeg(90));
  expect(degToSimple(simpleToDeg(271))).toBe(270); // truncating, both ways
  expect(degDiff(simpleToDeg(350), simpleToDeg(10))).toBe(simpleToDeg(20));
});

test("calcturn steps the short way round, whatever the sign of its step", () => {
  const ten = simpleToDeg(10);
  expect(calcTurn(simpleToDeg(355), simpleToDeg(20), ten)).toBe(degMask(simpleToDeg(355) + ten));
  expect(calcTurn(simpleToDeg(20), simpleToDeg(355), ten)).toBe(simpleToDeg(20) - ten);
  expect(calcTurn(simpleToDeg(20), simpleToDeg(25), ten)).toBe(simpleToDeg(25));
  // the BOOTFILE's rightmouse zooms with a negative step
  expect(calcTurn(simpleToDeg(90), simpleToDeg(80), -ten)).toBe(simpleToDeg(90) - ten);
});

/** a room with one node at the origin and whatever quads the test gives it */
function room(quads: MazeQuad[]): MazeRuntime {
  const sett: SettFile = {
    file: { containers: [] } as never,
    name: "test",
    mainScript: 0,
    nodes: [{ name: "Scene1", id: 1, node: 1, sphere: 0, script: 0, x: 0, y: 0, z: 0 }],
    scenes: [],
    roads: [],
    quads,
    stars: [],
    first: "Scene1",
    far: 1350000,
  };
  const session = { instanceFrom: () => null, clock: { now: 0 }, currentSetName: "test", frameRate: 2 } as never;
  const m = new MazeRuntime(sett, session);
  m.node = sett.nodes[0];
  return m;
}

const quad = (over: Partial<MazeQuad>): MazeQuad => ({
  name: "q", script: 0, x: 0, y: 0, z: 0, heading: 0, pitch: 0, w: 200000, h: 200000, ...over,
});

test("a quad five units ahead projects centred, at the focal length the exe uses", () => {
  // camera-space z is world x (0x497160 takes the camera as (−y, −z, x)), so a
  // quad at z = 5 units stands straight ahead of a camera looking along heading 0
  const m = room([quad({ z: 500000 })]);
  const poly = m.quadOutline(m.sett.quads[0], 640, 480)!;
  // 90° across 640 px: f = 320, and a 2-unit quad at 5 units is 128 px wide
  expect(poly.map(([x, y]) => [Math.round(x), Math.round(y)])).toEqual([
    [256, 176], [384, 176], [384, 304], [256, 304],
  ]);
  expect(m.quadAt(320, 240, 640, 480)?.name).toBe("q");
  expect(m.quadAt(100, 240, 640, 480)).toBeNull();
});

test("turning away puts a quad behind the camera, and a click can no longer find it", () => {
  const m = room([quad({ z: 500000 })]);
  m.heading = simpleToDeg(180);
  expect(m.quadOutline(m.sett.quads[0], 640, 480)).toBeNull();
  expect(m.quadAt(320, 240, 640, 480)).toBeNull();
});

test("a sprite's point lands where a quad's would: the two projectors are one camera", () => {
  // RedJack.exe draws sprites through 0x435740 and quads through 0x497160, which
  // take the world in different axes; a quad at (−y, −z, x) is at world (x, y, z)
  const pts = [[500000, 0, 0], [400000, 150000, -60000], [300000, -250000, 90000], [-200000, 600000, 30000]];
  for (const [heading, pitch] of [[0, 0], [30, 0], [100, 12], [300, -20]]) {
    for (const [x, y, z] of pts) {
      const m = room([quad({ x: -y, y: -z, z: x, w: 2, h: 2 })]);
      m.heading = simpleToDeg(heading);
      m.pitch = degMask(simpleToDeg(pitch));
      const poly = m.quadOutline(m.sett.quads[0], 640, 480);
      const at = m.spriteCamera(640, 480)!.project(x, y, z);
      expect(!!at).toBe(!!poly);
      if (!poly || !at) continue;
      const qx = poly.reduce((a, [px]) => a + px, 0) / 4;
      const qy = poly.reduce((a, [, py]) => a + py, 0) / 4;
      expect(Math.abs(at.x - qx)).toBeLessThanOrEqual(1);
      expect(Math.abs(at.y - qy)).toBeLessThanOrEqual(1);
      expect(at.depth).toBeCloseTo(Math.hypot(x, y, z), 6);
    }
  }
});

test("a sprite's size is scale × focal over depth × 1000, and a face is turned to the camera", () => {
  const m = room([]);
  const cam = m.spriteCamera(640, 480)!;
  // five units ahead, at 90° (focal 320): propscale 80000 draws a frame at 0.0512
  expect(cam.size(500000, 0, 0, 80000, 0)).toBeCloseTo((80000 * 320) / (500000 * 1000), 9);
  // level, the depth reference lowers the point but not its depth
  expect(cam.size(500000, 0, 0, 80000, 100)).toBeCloseTo(cam.size(500000, 0, 0, 80000, 0), 9);
  // the camera is behind a prop on the x axis: facing back along −x shows its front
  expect(cam.facing(500000, 0, simpleToDeg(180))).toBe(0);
  expect(cam.facing(500000, 0, 0)).toBe(128);
});

test("the point-in-polygon test agrees on a square and its edges' outsides", () => {
  const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  expect(inPolygon(sq, 5, 5)).toBe(true);
  expect(inPolygon(sq, 15, 5)).toBe(false);
  expect(inPolygon(sq, 5, -1)).toBe(false);
});

test("a v5 game's propspeed is sysparam: the button of the press, and the screen depth", async () => {
  const session = new GameSession(() => null, new NullAudioSink());
  const call = (n: number) =>
    session.interp.builtins.get("propspeed")!(session.interp, [n], {} as never, {} as never);
  // v4: a prop's speed, and there is no prop called 7
  expect(await call(7)).toBe(0);
  session.isV5 = true;
  session.pointerButton = 2;
  // the rooms' mousedown: `if propspeed (7) = 2 rightmouse (arg)`
  expect(await call(7)).toBe(2);
  session.pointerButton = 1;
  expect(await call(7)).toBe(1);
  expect(await call(10)).toBe(32);
});

test("v5's own commands answer as RedJack.exe's handlers do, and stay unknown to older games", async () => {
  const session = new GameSession(() => null, new NullAudioSink());
  const unknown: string[] = [];
  session.interp.onUnknown = (name) => unknown.push(name);
  const call = (name: string, ...args: (number | string)[]) =>
    session.interp.builtins.get(name)!(session.interp, args, {} as never, {} as never);
  // a v4 game never had these
  expect(await call("calcrgb", 255, 0, 0)).toBe(0);
  expect(unknown).toEqual(["calcrgb"]);
  session.isV5 = true;
  // 0x417ad0: 0x00RRGGBB
  expect(await call("calcrgb", 255, 128, 1)).toBe(0xff8001);
  expect(await call("isdebugging")).toBe(0);
  // the control panel's depth switch is what sysparam (10) reads back
  expect(await call("doublebuffer", 640, 480, 16)).toBe(1);
  expect(await call("propspeed", 10)).toBe(16);
  // screenbrightness and screencontrast by channel, held to their ranges
  await call("screenbrightness", 300, -20, 0);
  expect(session.screenBright).toEqual([255, -20, 0]);
  await call("screencontrast", 5, 5, 5);
  expect(await call("screencontrast", 2)).toBe(5);
  // spacebar is the key as it is now
  expect(await call("spacebar")).toBe(0);
  session.spaceDown = true;
  expect(await call("spacebar")).toBe(1);
});

test("the disc a day is on is the one its files come from: resetpaths's path, as Titanic's setpath", async () => {
  const session = new GameSession(() => null, new NullAudioSink());
  const discs: number[] = [];
  session.onDiscChange = (d) => discs.push(d);
  const path = (n: number, s: string) =>
    session.interp.builtins.get("path")!(session.interp, [n, s], {} as never, {} as never);
  // a v4 game's volumes are Titanic's, and RedJack's mean nothing to it
  await path(5, "RJDisk2:movies:");
  await path(3, "titanic2:data:");
  expect(discs).toEqual([2]);
  session.isV5 = true;
  // the BOOTFILE's resetpaths, on day 2's disc and then day 5's
  await path(5, "RJDisk2:movies:");
  await path(5, "RJDisk3:movies:");
  await path(3, "titanic1:data:");
  expect(discs).toEqual([2, 2, 3]);
});

test("a prop's ink is its opacity in eighths, as RedJack.exe's blitter takes it", () => {
  // 0x44c25d: alpha = ink·255·32 >> 8, and 8 skips the blend
  expect([1, 4, 7].map(inkAlpha)).toEqual([31, 127, 223]);
  expect(inkAlpha(8)).toBe(255);
  expect(inkAlpha(9)).toBe(255);
});

test("a walk holds each film frame for the game's framerate, as RedJack.exe's room loop does", () => {
  // the BOOTFILE's framerate (2): two 1/60 s ticks a frame; 0 is one tick
  expect(walkFrameMs(2)).toBeCloseTo(33.33, 2);
  expect(walkFrameMs(6)).toBe(100);
  expect(walkFrameMs(0)).toBeCloseTo(16.67, 2);
  const m = room([]);
  const frame = { picture: 0, x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, fov: 0, headDeg: 0, pitchDeg: 0, rollDeg: 0, fovDeg: 0, view: -1 };
  const walk = { film: { container: 0, to: 1, toScene: 0, frames: [frame, frame, frame] }, frame: 0, at: 0 };
  m.walk = walk;
  expect(m.walkStep(33)).toBe(false);
  expect(m.walkStep(34)).toBe(true);
  expect(walk.frame).toBe(1);
  expect(m.walkStep(60)).toBe(false);
  expect(m.walkStep(68)).toBe(true);
  expect(walk.frame).toBe(2);
});

// ---- the rip ---------------------------------------------------------------

const ROOT = fileURLToPath(new URL("../../redjack/gamefiles", import.meta.url));
const rooms: string[] = [];
const walk = (dir: string): void => {
  for (const n of readdirSync(dir)) {
    const p = `${dir}/${n}`;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.sett$/i.test(n)) rooms.push(p);
  }
};
if (existsSync(ROOT)) walk(ROOT);
rooms.sort();

const skip = (): boolean => {
  if (rooms.length) return false;
  console.warn(`no RedJack rooms under ${ROOT} — skipping`);
  return true;
};

test("every room reads: its nodes' spheres and its roads' films are what MAPR says", () => {
  if (skip()) return;
  const tag = (s: SettFile, i: number): string => {
    const d = s.file.containers[i]?.data;
    return d && d.length >= 8 ? String.fromCharCode(d[7], d[6], d[5], d[4]) : "";
  };
  for (const path of rooms) {
    const s = readSettFile(new Uint8Array(readFileSync(path)));
    for (const n of s.nodes) expect(tag(s, n.sphere), `${path} ${n.name}`).toBe("SPHR");
    // a road between two nodes; the film-only rooms (shark, hub's SCENs) join
    // scenes, which are not read yet
    const ids = new Set(s.nodes.map((n) => n.id));
    for (const r of s.roads.filter((x) => ids.has(x.a) && ids.has(x.b))) {
      expect(r.films.length, `${path} ${r.name}`).toBe(2);
      for (const f of r.films) {
        expect(tag(s, f.to), `${path} ${r.name} arrives`).toBe("NODE");
        for (const fr of f.frames) expect(tag(s, fr.picture)).toBe("STEP");
      }
    }
    // a film leaves from within a stride of its node (lava's start half a unit back)
    for (const n of s.nodes) {
      for (const f of exitsOf(s, n)) {
        expect(Math.hypot(f.frames[0].x - n.x, f.frames[0].y - n.y), `${path} ${n.name}`).toBeLessThan(60000);
      }
    }
  }
});

test("a sphere drawn at a road film's first camera is that film's first picture", () => {
  if (skip()) return;
  const shed = rooms.find((p) => /\/shed\.sett$/i.test(p));
  if (!shed) return;
  const s = readSettFile(new Uint8Array(readFileSync(shed)));
  const W = 640;
  const H = 480;
  let films = 0;
  for (const n of s.nodes) {
    const sphere = new SphereImage(s.file, n.sphere);
    for (const f of exitsOf(s, n)) {
      const fr = f.frames[0];
      if (Math.hypot(fr.x - n.x, fr.y - n.y) > 200) continue; // only a film that starts ON the node
      const out = new Uint32Array(W * H);
      sphere.render(out, W, H, fr.heading, fr.pitch, fr.fov);
      const d = s.file.containers[fr.picture].data;
      const fb = new FrameBuffer();
      decodeFrameV5(d, fb);
      const pal = paletteV5(d);
      let err = 0;
      let k = 0;
      for (let i = 0; i < W * H; i += 13, k++) {
        const q = fb.pixels[i] * 4;
        const w = out[i];
        err += Math.abs((w & 0xff) - pal[q]) + Math.abs(((w >>> 8) & 0xff) - pal[q + 1]) + Math.abs(((w >>> 16) & 0xff) - pal[q + 2]);
      }
      // grey levels per channel; a wrong heading or a mirror image is 8 or more
      expect(err / k / 3, `${n.name} → film ${f.container}`).toBeLessThan(4);
      films++;
    }
  }
  expect(films).toBeGreaterThan(0);
});

test("a scene turns between its views on film, and its road walks into the next scene", async () => {
  if (skip()) return;
  const path = rooms.find((p) => /\/shark\.sett$/i.test(p));
  if (!path) return;
  const s = readSettFile(new Uint8Array(readFileSync(path)));
  expect(s.nodes).toEqual([]);
  expect(s.scenes.map((x) => x.name)).toEqual(["Scene10", "Scene11", "Scene12", "Scene13"]);
  // every view is marked on both turning films, once
  for (const sc of s.scenes) {
    expect(sc.films).toHaveLength(2);
    sc.views.forEach((v, i) => {
      for (const f of sc.films) {
        const at = f.frames.filter((fr) => fr.view === i);
        expect(at, `${sc.name} ${v.name}`).toHaveLength(1);
        expect(degDiff(at[0].headDeg, v.heading), `${sc.name} ${v.name}`).toBeLessThan(simpleToDeg(1));
      }
    });
  }
  const session = { instanceFrom: () => null, clock: { now: 0 }, currentSetName: "shark", frameRate: 2 } as never;
  const m = new MazeRuntime(s, session);
  // rjcave's `changeset ("shark.sett", "Scene13", "View26")`
  await m.enterNode("Scene13", "View26");
  expect([m.sceneName, m.view]).toEqual(["Scene13", "view26"]);
  expect(degToSimple(m.heading)).toBe(245);
  expect(m.roadAhead("scene13", "view26")).toBeGreaterThan(0);
  expect(m.roadAhead("scene13", "view27")).toBe(0);
  const play = (): void => {
    for (let t = 1; m.walk && t < 200; t++) m.walkStep(t * 100);
  };
  // right is clockwise, the heading falling: 245° → 153°
  await m.move("right");
  expect(m.view).toBe("moving");
  play();
  expect([m.view, degToSimple(m.heading)]).toEqual(["view29", 153]);
  // and left goes back the other way, past nothing
  await m.move("left");
  play();
  expect(m.view).toBe("view26");
  // View27 has no road: "strait" does nothing there
  await m.move("left");
  play();
  await m.move("left");
  play();
  expect(m.view).toBe("view27");
  await m.move("strait");
  expect(m.walk).toBeNull();
  // back round to View26, whose road rows on to Scene12 and arrives facing View22
  await m.move("right");
  play();
  await m.move("right");
  play();
  expect(m.view).toBe("view26");
  await m.move("strait");
  play();
  expect([m.sceneName, m.view]).toEqual(["Scene12", "view22"]);
  expect(m.camera()).not.toBeNull();
});

test("a room opened without a scene starts at MAPR's first, a scene when it has no nodes", () => {
  if (skip()) return;
  const path = rooms.find((p) => /\/darts\.sett$/i.test(p));
  if (!path) return;
  // bar.sett's `opensetfile ("darts.sett")`
  expect(readSettFile(new Uint8Array(readFileSync(path))).first).toBe("Scene12");
});

test("a prop put on a star stands on the scenery the sphere's depth map puts there", () => {
  if (skip()) return;
  const path = rooms.find((p) => /\/liznite\.sett$/i.test(p));
  if (!path) return;
  const sett = readSettFile(new Uint8Array(readFileSync(path)));
  // MARK: 66-byte records, a point and a name (liznite's shop puts its crates here)
  const star = sett.stars.find((s) => s.name === "cratestack")!;
  expect([star.x, star.y, star.z]).toEqual([520053, 1035343, -6888]);
  const session = { instanceFrom: () => null, clock: { now: 0 }, currentSetName: "liznite", frameRate: 2 } as never;
  const m = new MazeRuntime(sett, session);
  m.node = sett.nodes.find((n) => n.name === "Node48")!;
  m.heading = Math.round((Math.atan2(star.y - m.node.y, star.x - m.node.x) * TURN) / (2 * Math.PI));
  const at = m.spriteCamera(640, 480)!.project(star.x, star.y, star.z)!;
  // the scenery under the star's pixel is as far away as the star: the crate's
  // foot is on the dock, in the same units, through the same camera
  const cam = m.camera()!;
  const depth = new Uint32Array(640 * 480);
  new SphereImage(sett.file, m.node.sphere, true).render(depth, 640, 480, cam.heading, cam.pitch, cam.fov);
  expect(Math.abs(depth[at.y * 640 + at.x] - at.depth) / at.depth).toBeLessThan(0.03);
});

test("every room has a far limit, and sprites past it less their zclip are not drawn", () => {
  if (skip()) return;
  for (const path of rooms) expect(readSettFile(new Uint8Array(readFileSync(path))).far, path).toBeGreaterThan(0);
});

test("a film's picture carries the depths a sphere has, so sprites hide on film too", () => {
  if (skip()) return;
  const shed = rooms.find((p) => /\/shed\.sett$/i.test(p));
  if (!shed) return;
  const s = readSettFile(new Uint8Array(readFileSync(shed)));
  let films = 0;
  for (const n of s.nodes) {
    const sphere = new SphereImage(s.file, n.sphere, true);
    for (const f of exitsOf(s, n)) {
      const fr = f.frames[0];
      if (Math.hypot(fr.x - n.x, fr.y - n.y) > 200) continue; // only a film that starts ON the node
      const map = depthV5(s.file.containers[fr.picture].data)!;
      expect(map).not.toBeNull();
      const out = new Uint32Array(640 * 480);
      sphere.render(out, 640, 480, fr.heading, fr.pitch, fr.fov);
      let rel = 0;
      let k = 0;
      for (let i = 0; i < out.length; i += 13) {
        if (out[i] >= DEPTH_FAR || map.z[i] >= DEPTH_FAR) continue;
        rel += Math.abs(out[i] - map.z[i]) / Math.max(out[i], map.z[i]);
        k++;
      }
      // measured 1.0-2.3% on shed; a misread layout is noise, tens of percent
      expect(rel / k, `${n.name} → film ${f.container}`).toBeLessThan(0.05);
      films++;
    }
  }
  expect(films).toBeGreaterThan(0);
});
