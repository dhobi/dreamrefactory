/**
 * The bedsit's room, as geometry (`bedsit/src/bedsit-room.ts`) and the three
 * matrices it is looked at through (`bedsit-optics.ts`) — in node, no GL.
 *
 *   npx vitest run --project taoot taoot/tests/auto/bedsit-room.ts
 *
 * What the room LOOKS like is a browser's question (tests/browser/bedsit-*.ts)
 * and a mesh's shape is Blender's. What can be held here is what the shader
 * would hide: the room's shader flips every normal towards the eye and culls
 * nothing, so a zero normal, an open shell or a mesh whose arrays disagree in
 * length all render as a lighting fault rather than as the mesh fault they are.
 * So: every array the size its `count` says, every triangle with any area lit
 * by a unit normal, the shell inside its own walls, a chart's texels inside its
 * chart, and each of the builder's primitives facing out.
 */
import { describe, expect, it } from "vitest";
import {
  Builder,
  CHARTS,
  PENDANT,
  ROOM,
  STANDPOINTS,
  WINDOWS,
  buildRoom,
  ceilingAt,
  ceilingCheek,
  ceilingRails,
  chartOf,
  doorPiece,
  glOf,
  pendantFitting,
  pendantPiece,
  windowAt,
  windowHead,
  type Part,
  type V3,
} from "../../bedsit/src/bedsit-room";
import { lookAlong, perspective, view } from "../../bedsit/src/bedsit-optics";

const GREY = [0.5, 0.5, 0.5];

/** every triangle with any area, its three normals, and its centre — in GL space */
function* triangles(parts: Part[]) {
  for (const p of parts) {
    const m = p.mesh;
    for (let t = 0; t < m.count; t += 3) {
      const P = (j: number): V3 => [m.position[(t + j) * 3], m.position[(t + j) * 3 + 1], m.position[(t + j) * 3 + 2]];
      const N = (j: number): V3 => [m.normal[(t + j) * 3], m.normal[(t + j) * 3 + 1], m.normal[(t + j) * 3 + 2]];
      const [a, b, c] = [P(0), P(1), P(2)];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const area = Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
      const centre: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      yield { part: p, area, normals: [N(0), N(1), N(2)], centre };
    }
  }
}

/** the arrays agree with `count`, and every triangle that has area has unit normals */
function wellFormed(parts: Part[]): void {
  for (const { mesh: m, surface } of parts) {
    expect(m.count % 3, `${surface}: a part of whole triangles`).toBe(0);
    expect(m.position.length, `${surface} positions`).toBe(m.count * 3);
    expect(m.normal.length, `${surface} normals`).toBe(m.count * 3);
    expect(m.colour.length, `${surface} colours`).toBe(m.count * 3);
    expect(m.uv.length, `${surface} uvs`).toBe(m.count * 2);
    expect(m.unlit.length, `${surface} unlit`).toBe(m.count);
    expect(m.position.every(Number.isFinite), `${surface}: a position that is not a number`).toBe(true);
  }
  const unlitBy: string[] = [];
  for (const t of triangles(parts)) {
    if (t.area < 1e-3) continue;
    for (const n of t.normals) {
      if (Math.abs(Math.hypot(...n) - 1) > 1e-3) unlitBy.push(`${t.part.surface} at ${t.centre.map(Math.round)}`);
    }
  }
  expect(unlitBy.slice(0, 5), "a triangle with area and no unit normal").toEqual([]);
}

/** a builder's single part, built by `make` */
function built(make: (b: Builder) => void): Part["mesh"] {
  const b = new Builder();
  make(b);
  const parts = b.done();
  expect(parts).toHaveLength(1);
  wellFormed(parts);
  return parts[0].mesh;
}

/** does every triangle's normal point away from `inside(centre)`? */
function facesOut(m: Part["mesh"], inside: (p: V3) => V3): boolean {
  for (const t of triangles([{ surface: null, mesh: m }])) {
    if (t.area < 1e-6) continue;
    const c = inside(t.centre);
    const out = [t.centre[0] - c[0], t.centre[1] - c[1], t.centre[2] - c[2]];
    if (t.normals.some((n) => n[0] * out[0] + n[1] * out[1] + n[2] * out[2] <= 0)) return false;
  }
  return true;
}

describe("the shell", () => {
  const parts = buildRoom();

  it("is well formed: whole triangles, and a unit normal on every one with area", () => {
    wellFormed(parts);
    wellFormed(pendantPiece());
    wellFormed(doorPiece());
  });

  it("draws each chart once, and keeps a chart's texels inside it", () => {
    const surfaces = parts.map((p) => p.surface);
    expect(new Set(surfaces).size).toBe(surfaces.length);
    for (const id of CHARTS.map((c) => c.id)) if (id !== "door") expect(surfaces, id).toContain(id);
    for (const p of parts) {
      // the street is a backdrop far past the glass, and is drawn larger than its picture
      if (!p.surface || p.surface === "street") continue;
      const uv = p.mesh.uv;
      expect(uv.every((x) => x > -1e-4 && x < 1 + 1e-4), `${p.surface}: a texel off its chart`).toBe(true);
    }
  });

  it("stands inside its walls, the window's reveal and the street beyond it excepted", () => {
    const [gx0, gz0] = [ROOM.x0, ROOM.floor];
    for (const p of parts) {
      if (p.surface === "street") continue;
      const m = p.mesh;
      for (let i = 0; i < m.count; i++) {
        // GL is [x, z, y]
        const [x, z, y] = [m.position[i * 3], m.position[i * 3 + 1], m.position[i * 3 + 2]];
        expect(x).toBeGreaterThanOrEqual(gx0 - 600);
        expect(x).toBeLessThanOrEqual(ROOM.x1);
        expect(y).toBeGreaterThanOrEqual(ROOM.y0);
        expect(y).toBeLessThanOrEqual(ROOM.y1 + 120);
        expect(z).toBeGreaterThanOrEqual(gz0);
        expect(z).toBeLessThanOrEqual(ROOM.ceiling);
      }
    }
    // and the street is behind the window wall
    const street = parts.find((p) => p.surface === "street")!.mesh.position;
    for (let i = 0; i < street.length; i += 3) expect(street[i]).toBeLessThan(ROOM.x0);
  });

  it("hangs the lamp and the door as pieces that can be taken out", () => {
    expect(pendantPiece().every((p) => p.piece === "ceiling lamp")).toBe(true);
    expect(doorPiece().every((p) => p.piece === "door")).toBe(true);
    // the lamp's glass dims with its lamp: emissive and tied, not plain unlit
    const unlit = new Set(pendantPiece().flatMap((p) => [...p.mesh.unlit]));
    expect([...unlit].sort()).toEqual([0, 2]);
  });
});

describe("the room's tables", () => {
  it("pitches the ceiling from the window wall to the arris, then runs flat", () => {
    const y = 8000;
    expect(ceilingAt(ROOM.x0, y)).toBe(3400);
    expect(ceilingAt(4800, y)).toBe(ROOM.ceiling);
    expect(ceilingAt(9000, y)).toBe(ROOM.ceiling);
    const mid = ceilingAt(3900, y);
    expect(mid).toBeGreaterThan(3400);
    expect(mid).toBeLessThan(ROOM.ceiling);
  });

  it("finds the windows by y, and their heads under the ceiling", () => {
    for (const w of WINDOWS) {
      const c = (w.y0 + w.y1) / 2;
      expect(windowAt(c)).toEqual(w);
      const head = windowHead(w, c)!;
      expect(head).toBeGreaterThan(0);
      expect(head).toBeLessThan(ROOM.ceiling);
      expect(windowHead(w, w.y0 - 100)).toBeNull();
    }
    expect(windowAt(8000)).toBeNull();
    // a splayed reveal is wider than the glass
    expect(windowAt(WINDOWS[0].y0 - 30, 60)).toEqual(WINDOWS[0]);
  });

  it("cuts the ceiling at the room's ends and the windows' rails", () => {
    const rails = ceilingRails(8000);
    expect(rails[0]).toBe(ROOM.y0);
    expect(rails[rails.length - 1]).toBe(ROOM.y1);
    expect([...rails].sort((a, b) => a - b)).toEqual(rails);
    expect(ceilingCheek(ROOM.x0 + 500)).toBeGreaterThanOrEqual(0);
  });

  it("hangs the pendant from the flat ceiling, its bulb inside its shade", () => {
    const f = pendantFitting();
    expect(f.z1).toBe(ceilingAt(PENDANT.x, PENDANT.y));
    expect(f.z0).toBeLessThan(f.z1);
    expect(f.bulb).toBeGreaterThan(f.z0);
    expect(f.bulb).toBeLessThan(f.z1);
  });

  it("names every chart once, and finds each by its id", () => {
    const ids = CHARTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(chartOf(id).id).toBe(id);
  });

  it("puts the standpoints inside the room, and GL's y up", () => {
    for (const s of STANDPOINTS) {
      expect(s.x).toBeGreaterThan(ROOM.x0);
      expect(s.x).toBeLessThan(ROOM.x1);
      expect(s.y).toBeGreaterThan(ROOM.y0);
      expect(s.y).toBeLessThan(ROOM.y1);
    }
    expect(glOf(1, 2, 3)).toEqual([1, 3, 2]);
  });
});

describe("the builder's primitives", () => {
  it("gives a quad that is a triangle a normal (it used to be zero)", () => {
    const m = built((b) => b.quad([0, 0, 0], [0, 0, 0], [100, 0, 0], [100, 100, 0], GREY));
    expect(Math.abs(m.normal[1])).toBeCloseTo(1); // GL y is the world's z
    // and turns a quad to face the way it is told
    const up = built((b) => b.quad([0, 0, 0], [0, 100, 0], [100, 100, 0], [100, 0, 0], GREY, [0, 0, 1]));
    expect(up.normal[1]).toBeCloseTo(1); // GL y is the world's z
  });

  it("builds a box with its six faces out", () => {
    const m = built((b) => b.box(0, 0, 0, 100, 200, 300, GREY));
    expect(m.count).toBe(36);
    expect(facesOut(m, () => glOf(50, 100, 150))).toBe(true);
  });

  it("builds a sphere, a tube, a sweep and a disc facing out", () => {
    const ball = built((b) => b.sphere([0, 0, 0], 100, 12, GREY));
    expect(facesOut(ball, () => [0, 0, 0])).toBe(true);
    const tube = built((b) => b.tube([0, 0, 0], [0, 0, 500], 20, 8, GREY));
    expect(tube.count).toBe(8 * 6);
    expect(facesOut(tube, (p) => [0, p[1], 0])).toBe(true);
    const lying = built((b) => b.tube([0, 0, 0], [500, 0, 0], 20, 8, GREY));
    expect(facesOut(lying, (p) => [p[0], 0, 0])).toBe(true);
    const sweep = built((b) => b.sweep([[0, 0, 0], [300, 0, 0], [300, 300, 0]], 10, 8, GREY));
    expect(sweep.count).toBeGreaterThan(2 * 8 * 6);
    const disc = built((b) => b.disc([0, 0, 0], 2, 1, 50, 10, GREY));
    for (let i = 0; i < disc.count; i++) expect(disc.normal[i * 3 + 1]).toBeCloseTo(1);
  });

  it("bends one smooth tube along a path, and builds nothing from a point", () => {
    const m = built((b) => b.bend([[0, 0, 0], [0, 0, 0], [300, 0, 0], [300, 300, 0], [300, 300, 300]], 20, 10, GREY));
    // the repeated first point is dropped: three segments of ten faces
    expect(m.count).toBe(3 * 10 * 6);
    const none = new Builder();
    none.bend([[1, 1, 1], [1, 1, 1]], 20, 10, GREY);
    expect(none.done()).toEqual([]);
  });

  it("spins and lathes a profile, the lathe faceted and the spin smooth", () => {
    const rings: [number, number][] = [[50, 0], [60, 100], [40, 200]];
    const lathe = built((b) => b.lathe(0, 0, rings, 12, (i) => [i / 2, 0, 0], 0, (th) => Math.sin(th * 6) * 5));
    expect(lathe.count).toBe(2 * 12 * 6);
    expect(new Set(lathe.colour.filter((_, i) => i % 3 === 0))).toEqual(new Set([0, 0.5]));
    const spun = built((b) => b.spun(0, 0, rings, 12, GREY));
    expect(spun.count).toBe(2 * 12 * 6);
    // averaged: two triangles meeting at a vertex share its normal
    expect([...spun.normal.slice(0, 3)].map((x) => +x.toFixed(4))).toEqual([...spun.normal.slice(9, 12)].map((x) => +x.toFixed(4)));
    const none = new Builder();
    none.spun(0, 0, [[1, 1]], 12, GREY);
    expect(none.done()).toEqual([]);
  });

  it("places a piece askew, in a material, and as flat joinery when asked", () => {
    const b = new Builder();
    b.material("deskwood", 300);
    b.place({ cx: 0, cy: 0, yaw: Math.PI / 2 });
    b.box(100, 0, 0, 200, 10, 10, GREY);
    b.place(null);
    b.material(null);
    b.box(0, 0, 0, 1, 1, 1, GREY);
    const parts = b.done();
    expect(parts.map((p) => p.surface)).toEqual(["mat:deskwood", null]);
    wellFormed(parts);
    // turned a quarter about the origin: x 100..200 has become y 100..200
    const p = parts[0].mesh.position;
    const ys = [...p].filter((_, i) => i % 3 === 2);
    expect(Math.min(...ys)).toBeCloseTo(100, 3);
    expect(Math.max(...ys)).toBeCloseTo(200, 3);
    // a material's texels repeat its tile rather than sit inside one chart
    expect([...parts[0].mesh.uv].some((u) => u !== 0)).toBe(true);

    const flat = built((x) =>
      x.mesh(new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100]), [0, 1, 2, 0, 3, 1], [0, 0, 0], GREY, 0, true),
    );
    expect(flat.count).toBe(6);
  });

  it("pins a picture's corners where it is told", () => {
    const m = built((b) => {
      b.material("memories");
      b.quad([0, 0, 0], [100, 0, 0], [100, 0, 100], [0, 0, 100], GREY, [0, -1, 0], 0, [[0, 1], [1, 1], [1, 0], [0, 0]]);
    });
    expect([...m.uv]).toEqual([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]);
  });
});

describe("the optics", () => {
  const apply = (m: Float32Array, p: number[]): number[] => {
    const out = [0, 1, 2, 3].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r] * (p[3] ?? 1));
    return out;
  };

  it("projects the near plane to -1 and the far one to +1", () => {
    const m = perspective(Math.PI / 2, 2, 10, 1000);
    const near = apply(m, [0, 0, -10, 1]);
    const far = apply(m, [0, 0, -1000, 1]);
    expect(near[2] / near[3]).toBeCloseTo(-1);
    expect(far[2] / far[3]).toBeCloseTo(1);
    // and the aspect squeezes x
    expect(m[0] * 2).toBeCloseTo(m[5]);
  });

  it("looks along a direction, straight up and down included", () => {
    const eye = [10, 20, 30];
    const ahead = apply(lookAlong(eye, [0, 0, -1], [0, 1, 0]), [10, 20, 20]);
    expect(ahead.slice(0, 3).map((x) => +x.toFixed(6))).toEqual([0, 0, -10]);
    // a cube face looking straight down, where yaw stops meaning anything
    const down = apply(lookAlong(eye, [0, -1, 0], [0, 0, -1]), [10, 10, 30]);
    expect(down.slice(0, 3).map((x) => +x.toFixed(6))).toEqual([0, 0, -10]);
  });

  it("agrees with lookAlong about which way a bearing faces", () => {
    const eye: [number, number, number] = [100, 2479, 200];
    for (const yaw of [0, Math.PI / 3, Math.PI, -2]) {
      const pitch = 0.2;
      const f = [Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)];
      const v = view(eye, yaw, pitch);
      const ahead = apply(v, [eye[0] + f[0] * 50, eye[1] + f[1] * 50, eye[2] + f[2] * 50]);
      expect(ahead[0]).toBeCloseTo(0, 2);
      expect(ahead[1]).toBeCloseTo(0, 2);
      expect(ahead[2]).toBeCloseTo(-50, 2);
      // +y on the right: a bearing a quarter turn on is to the right of this one
      const right = [Math.cos(yaw + Math.PI / 2), 0, Math.sin(yaw + Math.PI / 2)];
      expect(apply(v, [eye[0] + right[0] * 50, eye[1], eye[2] + right[2] * 50])[0]).toBeCloseTo(50);
    }
  });
});
