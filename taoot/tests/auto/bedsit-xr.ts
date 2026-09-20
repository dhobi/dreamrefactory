/**
 * The bedsit in a headset, checked without one.
 *
 * `bedsit/src/bedsit-xr.ts` is the one piece of that page that cannot be
 * verified by looking at it: it composes a matrix out of a pose the page did
 * not choose, in units the page does not use, in an axis convention that is not
 * the room's — and every one of those is a place a sign can be wrong in a way
 * that looks *plausible* on a screenshot and is only felt when it is worn. A
 * mirrored room, a room at a doll's scale, a room where walking forward walks
 * left: all three render perfectly.
 *
 * So the headset is faked and the module is real. The fake supplies a session,
 * a layer, a reference space and poses; the assertions are about geometry, and
 * the sharpest of them is the first — that a point in the room lands in exactly
 * the same place through the session's matrices as through the flat page's,
 * when the two cameras are standing in the same spot. That single equality
 * covers the scale, the axis swap, the handedness and the matrix multiply at
 * once, because it cannot hold if any of them is wrong.
 *
 * There is no GL here and no DOM: the module touches the context for six calls,
 * all of which are recorded rather than performed.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { enterXR, inXR, leaveXR, type Room } from "../../bedsit/src/bedsit-xr";
import { perspective, view } from "../../bedsit/src/bedsit-optics";
import { EYE_HEIGHT, ROOM, STANDPOINTS, UNITS_PER_METRE } from "../../bedsit/src/bedsit-room";

// --- the fake headset -------------------------------------------------------

/** a 4×4 identity, column-major, as a pose with nothing done to it */
const ID = (): Float32Array => {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
};

/** a pose as a translation only: where the head is, in metres, looking along -z */
function poseAt(x: number, y: number, z: number): Float32Array {
  const m = ID();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

/** …and turned about the up axis by `yaw`, which is how a head looks sideways */
function poseTurned(x: number, y: number, z: number, yaw: number): Float32Array {
  const m = poseAt(x, y, z);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  m[0] = c; m[2] = -s;
  m[8] = s; m[10] = c;
  return m;
}

/** the inverse of a rigid transform, which is all the fake ever has to invert */
function rigidInverse(m: Float32Array): Float32Array {
  const out = ID();
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[c * 4 + r] = m[r * 4 + c];
  for (let r = 0; r < 3; r++) {
    out[12 + r] = -(m[12] * out[r] + m[13] * out[4 + r] + m[14] * out[8 + r]);
  }
  return out;
}

function transform(m: Float32Array): XRRigidTransform {
  return {
    matrix: m,
    position: { x: m[12], y: m[13], z: m[14] } as DOMPointReadOnly,
    get inverse(): XRRigidTransform { return transform(rigidInverse(m)); },
  } as XRRigidTransform;
}

/** a controller: two sticks' worth of axes and the one button the page binds */
interface Stick { handedness: "left" | "right" | "none"; axes: number[]; a?: boolean }
function source(s: Stick): XRInputSource {
  return {
    handedness: s.handedness,
    targetRayMode: "tracked-pointer",
    gamepad: {
      axes: [0, 0, ...s.axes],
      buttons: [0, 1, 2, 3, 4].map((i) => ({ pressed: i === 4 && !!s.a, touched: false, value: 0 })),
    } as unknown as Gamepad,
  } as XRInputSource;
}

interface Fake {
  /** run one headset frame with the head at this pose; returns what was drawn */
  frame(pose: Float32Array, ms?: number): Drawn[];
  sticks: XRInputSource[];
  end(): void;
  session: XRSession;
}

interface Drawn { proj: Float32Array; look: Float32Array; at: [number, number, number] }

/** the two eyes, 64 mm apart, which is a head */
const IPD = 0.064;
const FRAMEBUFFER = { fake: "framebuffer" } as unknown as WebGLFramebuffer;

function fakeHeadset(drawn: Drawn[], opts: { floor?: boolean } = {}): { install(): void; fake(): Fake } {
  let onFrame: ((t: number, f: XRFrame) => void) | null = null;
  let ended: (() => void) | null = null;
  const sticks: XRInputSource[] = [];
  let pose = poseAt(0, 0, 0);

  const layer = {
    framebuffer: FRAMEBUFFER,
    framebufferWidth: 2048,
    framebufferHeight: 1024,
    getViewport: (v: XRView) => ({ x: v.eye === "left" ? 0 : 1024, y: 0, width: 1024, height: 1024 }),
  } as unknown as XRWebGLLayer;

  const session = {
    renderState: { baseLayer: layer },
    inputSources: sticks,
    updateRenderState() { /* the fake layer is already the one it would set */ },
    requestReferenceSpace: (type: string) =>
      type === "local-floor" && opts.floor === false
        ? Promise.reject(new Error("no floor"))
        : Promise.resolve({} as XRReferenceSpace),
    requestAnimationFrame(cb: (t: number, f: XRFrame) => void) { onFrame = cb; return 1; },
    end() { ended?.(); return Promise.resolve(); },
    addEventListener(_t: string, l: () => void) { ended = l; },
  } as unknown as XRSession;

  return {
    install() {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {
          xr: {
            isSessionSupported: () => Promise.resolve(true),
            requestSession: () => Promise.resolve(session),
          },
        },
      });
      (globalThis as { XRWebGLLayer?: unknown }).XRWebGLLayer = function () { return layer; };
    },
    fake(): Fake {
      return {
        sticks,
        session,
        end: () => { ended?.(); },
        frame(next: Float32Array, ms = 0): Drawn[] {
          pose = next;
          drawn.length = 0;               // one frame's worth, never two
          const views: XRView[] = (["left", "right"] as const).map((eye) => {
            const off = ID();
            off[12] = (eye === "left" ? -IPD : IPD) / 2;
            // eye = head pose × its own offset, which for a translation is this
            const m = new Float32Array(pose);
            m[12] += off[12] * m[0] + off[13] * m[4] + off[14] * m[8];
            m[13] += off[12] * m[1] + off[13] * m[5] + off[14] * m[9];
            m[14] += off[12] * m[2] + off[13] * m[6] + off[14] * m[10];
            // the same two planes the page clips at, in the metres a headset
            // works in — which is the conversion `enterXR` does for real
            const lens = perspective(1, 1, CLIP[0] / UNITS_PER_METRE, CLIP[1] / UNITS_PER_METRE);
            return { eye, projectionMatrix: lens, transform: transform(m) } as XRView;
          });
          const frame = {
            session,
            getViewerPose: () => ({ transform: transform(pose), views }) as XRViewerPose,
          } as unknown as XRFrame;
          const go = onFrame;
          onFrame = null;
          go?.(ms, frame);
          return drawn;
        },
      };
    },
  } as ReturnType<typeof fakeHeadset>;
}

/** the context, as six recorded calls */
function fakeGL(bound: unknown[]): WebGLRenderingContext {
  return {
    COLOR_BUFFER_BIT: 1, DEPTH_BUFFER_BIT: 2, FRAMEBUFFER: 3,
    makeXRCompatible: () => Promise.resolve(),
    bindFramebuffer: (_t: number, fb: unknown) => { bound.push(fb); },
    viewport() { /* recorded by the viewport count below if ever needed */ },
    clear() { /* nothing to clear */ },
  } as unknown as WebGLRenderingContext;
}

const CLIP = [40, 60000] as const;

/**
 * The head, from what was drawn.
 *
 * `draw` is called once per EYE and neither of them is the head: each is half
 * an interpupillary distance to one side of it. Every assertion about where the
 * visitor is standing means the point between them, and taking the left eye for
 * it is an error of 32 mm that looks like a rounding problem and is not.
 */
function headOf(drawn: Drawn[]): [number, number, number] {
  const [l, r] = drawn.map((d) => d.at);
  return [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2, (l[2] + r[2]) / 2];
}

function makeRoom(drawn: Drawn[], entered: WebGLFramebuffer[], bound: unknown[], left: { n: number }): Room {
  return {
    gl: fakeGL(bound),
    me: { x: 7000, y: 7000, z: EYE_HEIGHT, yaw: 0, pitch: 0.4 },
    antialias: true,
    clip: CLIP,
    draw: (proj, look, at) => { drawn.push({ proj, look, at: [...at] }); },
    inside: (x, y) => [
      Math.max(ROOM.x0 + 380, Math.min(ROOM.x1 - 380, x)),
      Math.max(ROOM.y0 + 380, Math.min(ROOM.y1 - 380, y)),
    ],
    enter: (fb) => { entered.push(fb); },
    leave: () => { left.n++; },
  };
}

/** a world point through a column-major matrix, to clip space */
function through(m: Float32Array, p: readonly number[]): number[] {
  const out = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) {
    out[r] = m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r];
  }
  return out;
}

function mul(a: Float32Array, b: Float32Array): Float32Array {
  const m = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    m[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return m;
}

// --- the suite --------------------------------------------------------------

describe("the bedsit in a headset", () => {
  let rig: ReturnType<typeof fakeHeadset>;
  let fake: Fake;
  let room: Room;
  let drawn: Drawn[];
  let entered: WebGLFramebuffer[];
  let bound: unknown[];
  let left: { n: number };

  async function enter(opts: { floor?: boolean } = {}): Promise<void> {
    drawn = []; entered = []; bound = []; left = { n: 0 };
    rig = fakeHeadset(drawn, opts);
    rig.install();
    room = makeRoom(drawn, entered, bound, left);
    fake = rig.fake();
    await enterXR(room);
  }

  beforeEach(() => { if (inXR()) leaveXR(); });

  it("puts a point of the room exactly where the flat page puts it", async () => {
    await enter();
    // the play space is on the floor under where the flat page was standing,
    // and the first frame moves it so the head lands on that spot
    const eyes = fake.frame(poseAt(0, EYE_HEIGHT / UNITS_PER_METRE, 0));
    expect(eyes).toHaveLength(2);

    /**
     * The same camera, twice over.
     *
     * A head at the play space's origin, 1.6 m up, facing along the bearing the
     * page left off at, IS the flat page's camera: same point, same direction,
     * same lens. So a corner of the room has to arrive at the same place in
     * clip space through both, and the ONLY way it can is if the session's
     * matrices undo the metres, the axis swap and the play space exactly.
     *
     * The flat lens is fed the same field and aspect the fake's projection was
     * built with, and its planes in units rather than metres — which is the one
     * conversion the session does that the flat page never has to.
     */
    const at: [number, number, number] = [room.me.x, EYE_HEIGHT, room.me.y];
    const flat = mul(perspective(1, 1, CLIP[0], CLIP[1]), view(at, room.me.yaw, 0));
    // a corner of the room, in the GL frame the shader works in: (x, z, y)
    const corner = [ROOM.x0, ROOM.ceiling, ROOM.y1];

    /**
     * Compared on the SCREEN, which is where the equality has to hold.
     *
     * Clip space itself cannot be compared directly: the two paths measure in
     * different units, so their w — which is the distance to the eye — differs
     * by a factor of `UNITS_PER_METRE` and every other coordinate with it. The
     * division by w is exactly what takes that factor out, and what is left is
     * the position on the screen and the depth, both of which are pure ratios
     * and must agree exactly.
     */
    const ndc = (m: Float32Array): number[] => {
      const c = through(m, corner);
      return [c[0] / c[3], c[1] / c[3], c[2] / c[3]];
    };
    // one eye is half an IPD to the side, so the CYCLOPEAN view is the average
    // of the two — which is what the flat camera is
    const both = eyes.map((e) => ndc(mul(e.proj, e.look)));
    const mid = both[0].map((v, i) => (v + both[1][i]) / 2);
    const want = ndc(flat);
    for (let i = 0; i < 3; i++) expect(mid[i]).toBeCloseTo(want[i], 4);
  });

  /**
   * The one invariant that holds at every bearing, and the reason it is here.
   *
   * Two different pieces of arithmetic have to describe the same eye: the
   * matrix the room is drawn through, which is built from the play space and
   * the headset's own view transform, and the POSITION handed to the shader for
   * its speculars, which is built by hand out of the play space's basis. They
   * are written separately and they can disagree — and if they do, the room
   * renders perfectly while its highlights sit at the wrong depth, which is not
   * something anybody spots in a screenshot.
   *
   * So: push the reported eye through the matrix drawn with. A camera's own
   * position is the origin of its camera space, by definition, so the answer is
   * zero or the two do not describe the same eye.
   *
   * At EVERY bearing, because at yaw 0 half of the arithmetic has a `sin` in
   * front of it and disappears — a mirrored room passes the whole of the rest
   * of this file and fails here at the second bearing.
   */
  it("reports the eye it actually draws from, at every bearing", async () => {
    await enter();
    for (const yaw of [0, 0.7, Math.PI / 2, 2.4, -1.1, Math.PI]) {
      room.me.yaw = yaw;
      const eyes = fake.frame(poseTurned(0.4, 1.55, -0.3, 0.9), 0);
      expect(eyes).toHaveLength(2);
      for (const e of eyes) {
        const cam = through(e.look, e.at);
        expect(cam[0]).toBeCloseTo(0, 4);
        expect(cam[1]).toBeCloseTo(0, 4);
        expect(cam[2]).toBeCloseTo(0, 4);
      }
    }
  });

  it("gives each eye its own position, an IPD apart, in the room's units", async () => {
    await enter();
    const eyes = fake.frame(poseAt(0, EYE_HEIGHT / UNITS_PER_METRE, 0));
    const [l, r] = eyes.map((e) => e.at);
    const apart = Math.hypot(l[0] - r[0], l[1] - r[1], l[2] - r[2]);
    expect(apart / UNITS_PER_METRE).toBeCloseTo(IPD, 4);
    // and both are at eye height in the room, not at a doll's scale
    expect(l[1]).toBeCloseTo(EYE_HEIGHT, 0);
    expect(r[1]).toBeCloseTo(EYE_HEIGHT, 0);
  });

  /**
   * The eyes, the right way round.
   *
   * Swapping them is the quietest mistake available here: both pictures are
   * correct, the room renders exactly as it should, and the only symptom is
   * that depth comes out INSIDE OUT — near things read as far, the walls close
   * in, and a person wearing it feels ill without being able to say why. No
   * screenshot shows it. So the disparity is pinned in both its sign and its
   * size, and pinned twice over: a near thing must separate the eyes more than
   * a far thing, which is the whole of what stereo is.
   */
  it("puts the eyes the right way round, by the right amount", async () => {
    await enter();
    const eyes = fake.frame(poseAt(0, EYE_HEIGHT / UNITS_PER_METRE, 0));
    const seen = (metres: number): number[] => {
      // yaw 0 is +x, so this is straight ahead of the visitor, at eye height
      const ahead = [room.me.x + metres * UNITS_PER_METRE, EYE_HEIGHT, room.me.y];
      return eyes.map((e) => { const c = through(mul(e.proj, e.look), ahead); return c[0] / c[3]; });
    };

    const near = seen(2);
    // the left eye stands to the LEFT of a thing straight ahead, so it sees it
    // off to its right: a larger x than the right eye's
    expect(near[0]).toBeGreaterThan(near[1]);
    // and by how much: half an IPD over the distance, through the lens
    const lens = 1 / Math.tan(0.5);               // the fake's own 1-radian field
    expect(near[0] - near[1]).toBeCloseTo((2 * lens * (IPD / 2)) / 2, 4);
    // the far wall separates them less than something at arm's length, which is
    // the difference between a room and a painting of one
    const far = seen(6);
    expect(far[0] - far[1]).toBeGreaterThan(0);
    expect(far[0] - far[1]).toBeLessThan((near[0] - near[1]) / 2);
  });

  it("stands the visitor where the flat page was standing", async () => {
    await enter();
    // a metre to the right of their own play space, and the room must still put
    // their HEAD on the spot the flat page left
    const head = headOf(fake.frame(poseAt(1, 1.7, 0)));
    expect(head[0]).toBeCloseTo(7000, 0);   // world x, through the GL swap
    expect(head[2]).toBeCloseTo(7000, 0);   // world y
  });

  it("walks where the visitor is LOOKING, not where the play space faces", async () => {
    await enter();
    fake.frame(poseAt(0, 1.6, 0), 0);
    const was = { x: room.me.x, y: room.me.y };
    // the head turns a quarter turn about the up axis, which in a right-handed
    // y-up space is to the LEFT — and the play space's own bearing is +x, so
    // left of it is the room's -y
    const turned = poseTurned(0, 1.6, 0, Math.PI / 2);
    fake.sticks.push(source({ handedness: "left", axes: [0, -1] }));   // stick forward
    // a second of it, in frames a headset would actually deliver: `dt` is
    // clamped to 50 ms a frame, so one long frame is not a second of walking
    for (let i = 1; i <= 50; i++) fake.frame(turned, i * 20);
    expect((room.me.y - was.y) / UNITS_PER_METRE).toBeCloseTo(-1.3, 2);
    expect((room.me.x - was.x) / UNITS_PER_METRE).toBeCloseTo(0, 2);
  });

  it("snaps the turn about the visitor, not about their play space", async () => {
    await enter();
    const pose = poseAt(1.2, 1.6, -0.8);        // well off the origin
    const before = headOf(fake.frame(pose, 0));
    const yaw = room.me.yaw;

    fake.sticks.push(source({ handedness: "right", axes: [1, 0] }));
    const after = headOf(fake.frame(pose, 16));

    expect(room.me.yaw - yaw).toBeCloseTo(-Math.PI / 6, 6);
    // the room turned; the visitor did not move an inch
    expect(after[0]).toBeCloseTo(before[0], 0);
    expect(after[2]).toBeCloseTo(before[2], 0);
  });

  it("snaps once per shove, however long it is held", async () => {
    await enter();
    fake.frame(poseAt(0, 1.6, 0), 0);
    const stick = source({ handedness: "right", axes: [1, 0] });
    fake.sticks.push(stick);
    const yaw = room.me.yaw;
    for (let i = 1; i <= 10; i++) fake.frame(poseAt(0, 1.6, 0), i * 16);
    expect(room.me.yaw - yaw).toBeCloseTo(-Math.PI / 6, 6);
    // released and shoved again: a second snap
    (stick.gamepad as unknown as { axes: number[] }).axes[2] = 0;
    fake.frame(poseAt(0, 1.6, 0), 200);
    (stick.gamepad as unknown as { axes: number[] }).axes[2] = 1;
    fake.frame(poseAt(0, 1.6, 0), 216);
    expect(room.me.yaw - yaw).toBeCloseTo(-Math.PI / 3, 6);
  });

  it("holds the HEAD inside the room, and moves the floor to do it", async () => {
    await enter();
    fake.frame(poseAt(0, 1.6, 0), 0);
    // the visitor walks four metres through the window wall in their own room
    const out = poseAt(0, 1.6, 4 * 1);
    const head = headOf(fake.frame(out, 16));
    const [cx] = room.inside(head[0], head[2]);
    expect(head[0]).toBeCloseTo(cx, 0);
    expect(head[0]).toBeGreaterThanOrEqual(ROOM.x0);
    expect(head[0]).toBeLessThanOrEqual(ROOM.x1);
  });

  it("stands where the game stands, on the button", async () => {
    await enter();
    fake.frame(poseAt(0.3, 1.6, 0.2), 0);
    fake.sticks.push(source({ handedness: "right", axes: [0, 0], a: true }));
    const head = headOf(fake.frame(poseAt(0.3, 1.6, 0.2), 16));
    const spot = STANDPOINTS[1];            // `stand(standpoint + 1)` from the first
    expect(head[0]).toBeCloseTo(spot.x, 0);
    expect(head[2]).toBeCloseTo(spot.y, 0);
    expect(room.me.yaw).toBeCloseTo((2 * Math.PI * spot.deg) / 256, 6);
  });

  it("draws into the session's framebuffer and not into the canvas", async () => {
    await enter();
    expect(entered).toEqual([FRAMEBUFFER]);
    fake.frame(poseAt(0, 1.6, 0));
    expect(bound.at(-1)).toBe(FRAMEBUFFER);
    fake.end();
    // and puts the canvas back when the headset is handed over
    expect(bound.at(-1)).toBe(null);
    expect(left.n).toBe(1);
  });

  it("gives the room back where the visitor was standing, at eye height", async () => {
    await enter();
    const head = headOf(fake.frame(poseAt(0.8, 1.9, -0.5), 0));
    fake.end();
    expect(inXR()).toBe(false);
    expect(room.me.x).toBeCloseTo(head[0], 0);
    expect(room.me.y).toBeCloseTo(head[2], 0);
    expect(room.me.z).toBe(EYE_HEIGHT);
    expect(room.me.pitch).toBe(0);
  });

  it("puts the floor under the head when the headset cannot find one", async () => {
    await enter({ floor: false });
    // no `local-floor`: y = 0 is where the head was, so the play space goes at
    // eye height and everybody is 1.6 m tall
    const head = headOf(fake.frame(poseAt(0, 0, 0)));
    expect(head[1]).toBeCloseTo(EYE_HEIGHT, 0);
  });
});
