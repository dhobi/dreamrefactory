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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enterXR, inXR, leaveXR, type Room } from "../../bedsit/src/bedsit-xr";
import { perspective, view } from "../../bedsit/src/bedsit-optics";
import { EYE_HEIGHT, ROOM, STANDPOINTS, UNITS_PER_METRE } from "../../bedsit/src/bedsit-room";
import { set as setRoom } from "../../bedsit/src/bedsit-settings";

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

/**
 * A controller: two sticks' worth of axes, the buttons the page binds, and —
 * for the ones that point at the board — a ray space of its own.
 *
 * The ray space is an ordinary object used as a KEY. That is what an `XRSpace`
 * is to a page: a token handed back to `getPose`, with nothing readable on it,
 * which is why the fake can be one line and still be honest.
 */
interface Stick {
  handedness: "left" | "right" | "none";
  axes: number[];
  a?: boolean;
  /** the trigger, which is what presses a control */
  trigger?: boolean;
  /** B or the squeeze, which is what asks for the board */
  menu?: boolean;
  /** where this hand is and which way it points, in the play space */
  ray?: Float32Array;
  /**
   * A controller too old to have an A or an X: its buttons stop at the trigger.
   *
   * This is the only shape of controller on which the standpoint button and the
   * board's press are the SAME button, and therefore the only one on which the
   * session having to be told "that press was taken" can be seen at all.
   */
  old?: boolean;
}
function source(s: Stick): XRInputSource {
  return {
    handedness: s.handedness,
    targetRayMode: "tracked-pointer",
    targetRaySpace: s.ray ? ({ ray: s.ray } as unknown as XRSpace) : undefined,
    gamepad: {
      axes: [0, 0, ...s.axes],
      buttons: (s.old ? [0] : [0, 1, 2, 3, 4, 5]).map((i) => ({
        pressed: (i === 4 && !!s.a) || (i === 0 && !!s.trigger) || (i === 5 && !!s.menu),
        touched: false,
        value: 0,
      })),
    } as unknown as Gamepad,
  } as XRInputSource;
}

interface Fake {
  /** run one headset frame with the head at this pose; returns what was drawn */
  frame(pose: Float32Array, ms?: number): Drawn[];
  sticks: XRInputSource[];
  end(): void;
  session: XRSession;
  /** the layer itself, for the one assertion that is about what is NOT on it */
  layer: XRWebGLLayer;
  /** what the module asked this headset for, as opposed to what it was given */
  asked: { foveation?: number; rate?: number };
}

interface Drawn { proj: Float32Array; look: Float32Array; at: [number, number, number] }

/** a ray the room was handed, and whether a trigger came with it */
interface Pointed { from: [number, number, number]; dir: [number, number, number]; pressed: boolean }
/** where the board was asked for, and facing which way */
interface Summoned { at: [number, number, number]; yaw: number }

/** the two eyes, 64 mm apart, which is a head */
const IPD = 0.064;
const FRAMEBUFFER = { fake: "framebuffer" } as unknown as WebGLFramebuffer;

/**
 * What kind of headset to be.
 *
 * `floor` is whether it knows where the floor is. The other three are the two
 * dials that only a headset has, and every one of them is OPTIONAL in the
 * specification — so the fake has to be able to be a browser that has neither,
 * which is nearly all of them, as well as one that has both.
 */
interface Headset {
  floor?: boolean;
  /** false for a browser with no `fixedFoveation` on its layers at all */
  foveation?: boolean;
  /** the most this headset will grant, however hard it is asked */
  foveationCap?: number;
  /** the rates it offers; absent for a browser that does not let a page choose */
  rates?: number[];
  /** and whether it refuses the one it is asked for anyway */
  refuseRate?: boolean;
}

function fakeHeadset(drawn: Drawn[], opts: Headset = {}): { install(): void; fake(): Fake } {
  let onFrame: ((t: number, f: XRFrame) => void) | null = null;
  let ended: (() => void) | null = null;
  const sticks: XRInputSource[] = [];
  let pose = poseAt(0, 0, 0);

  const asked: { foveation?: number; rate?: number } = {};
  let running = 90;                      // the rate before anybody asks for one

  const layer = {
    framebuffer: FRAMEBUFFER,
    framebufferWidth: 2048,
    framebufferHeight: 1024,
    getViewport: (v: XRView) => ({ x: v.eye === "left" ? 0 : 1024, y: 0, width: 1024, height: 1024 }),
  } as unknown as XRWebGLLayer;

  /**
   * The foveation dial, present only where a headset has one — and a GETTER and
   * SETTER rather than a number, because the two halves of it are different
   * numbers: a headset may grant less than it was asked for, and the module is
   * supposed to report what it got rather than what it wanted.
   */
  if (opts.foveation !== false) {
    let level: number | null = 0;
    Object.defineProperty(layer, "fixedFoveation", {
      configurable: true,
      enumerable: true,
      get: () => level,
      set: (v: number) => { asked.foveation = v; level = Math.min(v, opts.foveationCap ?? 1); },
    });
  }

  const session = {
    renderState: { baseLayer: layer },
    inputSources: sticks,
    ...(opts.rates
      ? {
        supportedFrameRates: Float32Array.from(opts.rates),
        updateTargetFrameRate(rate: number): Promise<void> {
          asked.rate = rate;
          if (opts.refuseRate) return Promise.reject(new Error("no"));
          running = rate;
          return Promise.resolve();
        },
      }
      : {}),
    updateRenderState() { /* the fake layer is already the one it would set */ },
    requestReferenceSpace: (type: string) =>
      type === "local-floor" && opts.floor === false
        ? Promise.reject(new Error("no floor"))
        : Promise.resolve({} as XRReferenceSpace),
    requestAnimationFrame(cb: (t: number, f: XRFrame) => void) { onFrame = cb; return 1; },
    end() { ended?.(); return Promise.resolve(); },
    addEventListener(_t: string, l: () => void) { ended = l; },
  } as unknown as XRSession;

  /**
   * What it is running at NOW, which is 90 until it is told otherwise — and
   * defined HERE rather than in the literal above, because a getter inside an
   * object that is spread is read once and copied as the value it had at the
   * time. Spread into that conditional it would have been a permanent 90, and a
   * module that never read the answer back would have passed.
   */
  if (opts.rates) Object.defineProperty(session, "frameRate", { configurable: true, get: () => running });

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
        layer,
        asked,
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
            // a hand's ray, out of the space that was handed back for it. A
            // hand with no ray this frame gets `null`, which is a controller
            // out of the headset's view and not a failure
            getPose: (sp: XRSpace) => {
              const m = (sp as unknown as { ray?: Float32Array }).ray;
              return m ? ({ transform: transform(m) } as XRPose) : null;
            },
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

/** what the vignette asked for, once per time it was drawn */
interface Ring { aperture: number; blink: number }

/**
 * The context, recorded rather than performed.
 *
 * Most of it is the six calls the session makes to move pixels about. The rest
 * is enough of a shader toolchain for the vignette to BUILD — it compiles a
 * program and a buffer on the first frame that needs one — and enough
 * bookkeeping to read back what it asked for: `getUniformLocation` hands back
 * the uniform's own name, so the recorded values arrive labelled, and a
 * `drawArrays` files the current set away as one ring drawn.
 *
 * That last part is the only way this suite can see comfort at all. The ring is
 * pixels, and pixels are the one thing a headless test cannot look at — but
 * "how far has it closed" and "how black is it" are numbers on their way to the
 * shader, and they are the actual behaviour.
 */
function fakeGL(bound: unknown[], rings: Ring[]): WebGLRenderingContext {
  const u: Record<string, number> = {};
  return {
    COLOR_BUFFER_BIT: 1, DEPTH_BUFFER_BIT: 2, FRAMEBUFFER: 3,
    VERTEX_SHADER: 4, FRAGMENT_SHADER: 5, COMPILE_STATUS: 6, LINK_STATUS: 7,
    ARRAY_BUFFER: 8, STATIC_DRAW: 9, FLOAT: 10, TRIANGLES: 11,
    DEPTH_TEST: 12, BLEND: 13, SRC_ALPHA: 14, ONE_MINUS_SRC_ALPHA: 15,
    makeXRCompatible: () => Promise.resolve(),
    bindFramebuffer: (_t: number, fb: unknown) => { bound.push(fb); },
    viewport() { /* the per-eye halves are the layer's business */ },
    clear() { /* nothing to clear */ },
    createShader: () => ({}), shaderSource() { /* not read */ }, compileShader() { /* not run */ },
    getShaderParameter: () => true, getShaderInfoLog: () => "",
    createProgram: () => ({}), attachShader() { /* linked below */ }, linkProgram() { /* fine */ },
    getProgramParameter: () => true, getProgramInfoLog: () => "",
    createBuffer: () => ({}), bindBuffer() { /* one quad */ }, bufferData() { /* one triangle */ },
    getAttribLocation: () => 0,
    // the name IS the location, so what comes back below is labelled
    getUniformLocation: (_p: unknown, name: string) => name,
    useProgram() { /* swapped back by the vignette itself */ },
    uniform1f: (name: string, v: number) => { u[name] = v; },
    uniform2f() { /* the eye's axis and scale: geometry, tested elsewhere */ },
    enableVertexAttribArray() { /* the dance is checked by the browser suite */ },
    disableVertexAttribArray() { /* …where a real driver would object */ },
    vertexAttribPointer() { /* ditto */ },
    enable() { /* blending */ }, disable() { /* and depth */ }, blendFunc() { /* over */ },
    drawArrays: () => { rings.push({ aperture: u.uAperture, blink: u.uBlink }); },
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

function makeRoom(
  drawn: Drawn[], entered: WebGLFramebuffer[], bound: unknown[], left: { n: number }, rings: Ring[],
  pointed: Pointed[] = [], summoned: Summoned[] = [], takes = { it: false },
): Room {
  return {
    point(from, dir, pressed): boolean {
      pointed.push({ from: [...from], dir: [...dir], pressed });
      return takes.it;
    },
    summon(at, yaw): void { summoned.push({ at: [...at], yaw }); },
    gl: fakeGL(bound, rings),
    me: { x: 7000, y: 7000, z: EYE_HEIGHT, yaw: 0, pitch: 0.4 },
    antialias: true,
    clip: CLIP,
    program: {} as WebGLProgram,
    locs: [0, 1, 2, 3, 4],
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
  let rings: Ring[];
  let pointed: Pointed[];
  let summoned: Summoned[];
  /** whether the room says it TOOK the press, which is what a board under the
   *  pointer does — see `point` in the module */
  let takes: { it: boolean };

  /** what the module said it was given, since the console is the only place it
   *  can say it: collected here rather than printed through the suite */
  let said: string[];

  async function enter(opts: Headset = {}): Promise<void> {
    drawn = []; entered = []; bound = []; left = { n: 0 }; rings = [];
    pointed = []; summoned = []; takes = { it: false };
    rig = fakeHeadset(drawn, opts);
    rig.install();
    room = makeRoom(drawn, entered, bound, left, rings, pointed, summoned, takes);
    fake = rig.fake();
    await enterXR(room);
  }

  beforeEach(() => {
    if (inXR()) leaveXR();
    setRoom({ vignette: "big" });        // the store is a singleton; put it back
    said = [];
    vi.spyOn(console, "info").mockImplementation((...a: unknown[]) => { said.push(a.map(String).join(" ")); });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  /** one turn of the microtask queue, which is what the frame rate's answer is
   *  behind: the ask is a promise and the report is what it settles into */
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

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

    expect(room.me.yaw - yaw).toBeCloseTo(Math.PI / 6, 6);
    // the room turned; the visitor did not move an inch
    expect(after[0]).toBeCloseTo(before[0], 0);
    expect(after[2]).toBeCloseTo(before[2], 0);
  });

  /**
   * WHICH WAY, in the only terms that cannot be got wrong.
   *
   * The two tests around this one pin how FAR a snap turns and that it turns
   * about the visitor — and both of them passed happily for a fortnight while
   * the turn went the wrong way, because `-π/6` is as plausible a number as
   * `π/6` when nothing says what the sign means. What says it is the picture: a
   * thing standing 30° to your right is dead ahead after you have turned 30° to
   * your right. That is checked here against the matrices the room was actually
   * drawn with, so it holds whatever the sign conventions underneath decide to
   * be, and it fails the moment the stick turns the room the other way.
   */
  it("brings what was on the visitor's right to the middle when the stick goes right", async () => {
    await enter();
    const eyes = fake.frame(poseAt(0, EYE_HEIGHT / UNITS_PER_METRE, 0), 0);
    const bearing = room.me.yaw;
    // a point 30° to the right of where the visitor is facing, across the room
    const d = 3000;
    const mark = [
      room.me.x + d * Math.cos(bearing + Math.PI / 6),
      EYE_HEIGHT,
      room.me.y + d * Math.sin(bearing + Math.PI / 6),
    ];
    /**
     * Where the mark sits across the picture, BETWEEN the eyes.
     *
     * One eye is half an interpupillary distance off the head, which at this
     * mark's distance is a real 0.03 of the screen — the same order as the
     * thing being measured. The mean of the two is the head's own view, and
     * the parallax cancels out of it exactly.
     */
    const screenX = (drawn: Drawn[]): number =>
      drawn.reduce((sum, d) => {
        const c = through(mul(d.proj, d.look), mark);
        return sum + c[0] / c[3];
      }, 0) / drawn.length;
    expect(screenX(eyes)).toBeGreaterThan(0.2);     // off to the right

    fake.sticks.push(source({ handedness: "right", axes: [1, 0] }));
    const after = fake.frame(poseAt(0, EYE_HEIGHT / UNITS_PER_METRE, 0), 16);
    expect(screenX(after)).toBeCloseTo(0, 2);       // and now straight ahead
  });

  it("snaps once per shove, however long it is held", async () => {
    await enter();
    fake.frame(poseAt(0, 1.6, 0), 0);
    const stick = source({ handedness: "right", axes: [1, 0] });
    fake.sticks.push(stick);
    const yaw = room.me.yaw;
    for (let i = 1; i <= 10; i++) fake.frame(poseAt(0, 1.6, 0), i * 16);
    expect(room.me.yaw - yaw).toBeCloseTo(Math.PI / 6, 6);
    // released and shoved again: a second snap
    (stick.gamepad as unknown as { axes: number[] }).axes[2] = 0;
    fake.frame(poseAt(0, 1.6, 0), 200);
    (stick.gamepad as unknown as { axes: number[] }).axes[2] = 1;
    fake.frame(poseAt(0, 1.6, 0), 216);
    expect(room.me.yaw - yaw).toBeCloseTo(Math.PI / 3, 6);
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

  /**
   * The jump happens where nobody can see it.
   *
   * A press does not move anybody: it asks, the view goes black over 70 ms, the
   * room is changed at the bottom, and it comes back over 130 ms. So the
   * assertion that matters is the NEGATIVE one first — that the frame after the
   * press has the visitor exactly where they were — because a jump that
   * happened immediately would pass every check about where they ended up and
   * still be the cut this was written to remove.
   */
  it("stands where the game stands, on the button — in the dark", async () => {
    await enter();
    const pose = poseAt(0.3, 1.6, 0.2);
    const before = headOf(fake.frame(pose, 0));
    fake.sticks.push(source({ handedness: "right", axes: [0, 0], a: true }));

    const during = headOf(fake.frame(pose, 16));
    expect(during[0]).toBeCloseTo(before[0], 0);   // asked, not moved
    expect(during[2]).toBeCloseTo(before[2], 0);
    expect(rings.at(-1)!.blink).toBeGreaterThan(0);
    expect(rings.at(-1)!.blink).toBeLessThan(1);

    // to the bottom of the fade: 70 ms of frames
    let t = 16;
    for (let i = 0; i < 6; i++) fake.frame(pose, (t += 16));
    const spot = STANDPOINTS[1];            // `stand(standpoint + 1)` from the first
    const head = headOf(fake.frame(pose, (t += 16)));
    expect(head[0]).toBeCloseTo(spot.x, 0);
    expect(head[2]).toBeCloseTo(spot.y, 0);
    expect(room.me.yaw).toBeCloseTo((2 * Math.PI * spot.deg) / 256, 6);

    /**
     * And back into the light — which is the ring no longer being DRAWN.
     *
     * Not "the last ring recorded has a blink of zero": it cannot have. The
     * last one recorded is by definition the final frame on which there was
     * still something to draw, so it holds the last sliver of the fade. What
     * says the fade is over is that nothing is drawn after it.
     */
    for (let i = 0; i < 12; i++) fake.frame(pose, (t += 16));
    const settled = rings.length;
    for (let i = 0; i < 5; i++) fake.frame(pose, (t += 16));
    expect(rings.length).toBe(settled);
  });

  /**
   * The vignette: shut under the stick, open at rest, and absent when open.
   *
   * The third of those is not a nicety. The ring is a screen of blended pixels
   * over both eyes, and a fully open one is a screen of TRANSPARENT black —
   * invisible, and paid for at every pixel of every frame of a session that is
   * mostly somebody standing still looking at a room. It has to not be drawn,
   * and nothing about the picture would ever say whether it was.
   */
  it("closes the vignette under the stick and opens it again after", async () => {
    await enter();
    let t = 0;
    const still = (): void => { fake.frame(poseAt(0, 1.6, 0), (t += 16)); };
    still(); still();
    expect(rings).toHaveLength(0);          // nothing drawn over a still room

    const pad = source({ handedness: "left", axes: [0, -1] });
    fake.sticks.push(pad);
    for (let i = 0; i < 40; i++) still();   // ~0.6 s of gliding, five time constants
    const shut = rings.at(-1)!.aperture;
    expect(shut).toBeLessThan(0.75);        // closed to near the 0.6 it aims at
    expect(shut).toBeGreaterThan(0.55);     // and never past it

    (pad.gamepad as unknown as { axes: number[] }).axes[3] = 0;
    for (let i = 0; i < 40; i++) still();
    expect(rings.at(-1)!.aperture).toBeGreaterThan(1.5);   // wide open again
    const n = rings.length;
    for (let i = 0; i < 200; i++) still();  // and eventually not drawn at all
    expect(rings.length).toBeLessThan(n + 200);
  });

  /**
   * The vignette the visitor chose, which is the whole of what it is for.
   *
   * What one person needs at the edge of vision, the next feels as a tunnel —
   * so the ring is a setting, and these are the two ends of it. `middle` leaves
   * more of the room visible while gliding, and `none` means the ring is not
   * drawn AT ALL rather than drawn fully open: a transparent black screen over
   * both eyes costs every pixel of every frame and shows nothing for it.
   */
  it("opens the ring wider on `middle` than on `big`", async () => {
    const glide = async (): Promise<number> => {
      await enter();
      let t = 0;
      const still = (): void => { fake.frame(poseAt(0, 1.6, 0), (t += 16)); };
      still(); still();
      fake.sticks.push(source({ handedness: "left", axes: [0, -1] }));
      for (let i = 0; i < 40; i++) still();
      return rings.at(-1)!.aperture;
    };

    setRoom({ vignette: "big" });
    const big = await glide();
    leaveXR();
    setRoom({ vignette: "middle" });
    const middle = await glide();

    expect(big).toBeLessThan(0.75);
    expect(middle).toBeGreaterThan(0.9);
    expect(middle).toBeLessThan(1.15);
    expect(middle).toBeGreaterThan(big);
  });

  it("draws no ring at all on `none`, and still blinks for a jump", async () => {
    setRoom({ vignette: "none" });
    await enter();
    let t = 0;
    const still = (): void => { fake.frame(poseAt(0, 1.6, 0), (t += 16)); };
    still(); still();
    fake.sticks.push(source({ handedness: "left", axes: [0, -1] }));
    for (let i = 0; i < 40; i++) still();
    expect(rings).toHaveLength(0);       // gliding, and nothing drawn over it

    // the blink is not part of the choice: it is what covers a jump, and a jump
    // without it is the cut it was put in to prevent
    const pad = source({ handedness: "right", axes: [0, 0], a: true });
    fake.sticks.push(pad);
    for (let i = 0; i < 4; i++) still();
    expect(rings.length).toBeGreaterThan(0);
    expect(rings.at(-1)!.blink).toBeGreaterThan(0);
  });

  /**
   * A tick in the hand for the two things that happen without being watched.
   *
   * Both are comfort: a snap and a blink are deliberately things the eye cannot
   * follow, and a tap at the same instant is the other sense saying it was
   * meant. Optional everywhere in the specification, so what is pinned is that
   * it is ASKED for — and that a controller without a motor is not a crash.
   */
  it("ticks the hand on a snap and on arriving, and survives a hand with no motor", async () => {
    await enter();
    const buzzes: [number, number][] = [];
    const pad = source({ handedness: "right", axes: [0, 0] });
    (pad.gamepad as unknown as { hapticActuators: unknown[] }).hapticActuators = [{
      pulse: (v: number, ms: number) => { buzzes.push([v, ms]); return Promise.resolve(true); },
    }];
    const mute = source({ handedness: "left", axes: [0, 0] });
    fake.sticks.push(pad, mute);            // one with a motor, one without

    let t = 0;
    fake.frame(poseAt(0, 1.6, 0), (t += 16));
    (pad.gamepad as unknown as { axes: number[] }).axes[2] = 1;
    fake.frame(poseAt(0, 1.6, 0), (t += 16));
    expect(buzzes).toHaveLength(1);         // the snap

    (pad.gamepad as unknown as { axes: number[] }).axes[2] = 0;
    (pad.gamepad as unknown as { buttons: { pressed: boolean }[] }).buttons[4].pressed = true;
    for (let i = 0; i < 10; i++) fake.frame(poseAt(0, 1.6, 0), (t += 16));
    expect(buzzes).toHaveLength(2);         // and the arrival, once, at the bottom
    expect(buzzes[1][0]).toBeGreaterThan(buzzes[0][0]);
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

  /**
   * The periphery, shaded cheaper.
   *
   * Two things are pinned and they are different things. That the ask is MADE,
   * because this room is fill-bound and the edge of the lens is most of the
   * framebuffer. And that what comes back out of the layer afterwards is the
   * headset's answer and not the page's request — a headset is allowed to grant
   * less than it was asked for, and a page that reports its own number has no
   * way of ever finding that out.
   */
  it("asks the headset to foveate the periphery, and leaves the granted level alone", async () => {
    await enter({ foveationCap: 0.5 });
    expect(fake.asked.foveation).toBe(0.75);
    expect(fake.layer.fixedFoveation).toBe(0.5);       // what it gave, not what it was asked
    expect(said.join(" ")).toContain("foveation 0.5");
    expect(fake.frame(poseAt(0, 1.6, 0))).toHaveLength(2);
  });

  /**
   * And the trap under it.
   *
   * `fixedFoveation` is missing from nearly every browser's layers, and a layer
   * is an ordinary extensible object: assigning to a name it does not have puts
   * the name THERE, and reading it back hands the page its own number. That
   * reads exactly like a granted request and is the opposite of one. What is
   * pinned is that nothing was written at all.
   */
  it("does not take its own assignment for a headset that foveates", async () => {
    await enter({ foveation: false });
    expect("fixedFoveation" in fake.layer).toBe(false);
    expect(said.join(" ")).toContain("not offered");
    expect(fake.frame(poseAt(0, 1.6, 0))).toHaveLength(2);
  });

  /**
   * The frame rate, which is a ceiling and not a demand.
   *
   * The nearest rate at or below 72, because a rate that is held beats a rate
   * that is aimed at and reprojected. And on a headset whose slowest is faster
   * than the ceiling, its slowest — the alternative is asking for nothing and
   * taking whatever it would have done.
   */
  it("asks for the nearest rate at or below the ceiling", async () => {
    await enter({ rates: [60, 72, 80, 90, 120] });
    expect(fake.asked.rate).toBe(72);
    await settle();
    expect(said.join(" ")).toContain("72 Hz");

    fake.end();
    await enter({ rates: [90, 120] });     // every one of them above the ceiling
    expect(fake.asked.rate).toBe(90);
  });

  /**
   * Neither dial is allowed to cost anybody the room.
   *
   * Both are optional in the specification and the browser that has them is the
   * exception — so the two failures that matter are a headset with no opinion
   * at all, and one that offers a rate and then refuses it. Each has to end in
   * a room being drawn, which is what it would have done before either of these
   * was asked for.
   */
  it("runs the room for a headset with neither dial, and for one that refuses the rate", async () => {
    await enter({ foveation: false });
    expect(fake.asked).toEqual({});        // nothing offered, so nothing asked
    expect(fake.frame(poseAt(0, 1.6, 0))).toHaveLength(2);

    fake.end();
    await enter({ rates: [72], refuseRate: true });
    expect(fake.asked.rate).toBe(72);
    await settle();
    expect(said.join(" ")).toContain("refused");
    expect(fake.frame(poseAt(0, 1.6, 0))).toHaveLength(2);
  });

  /**
   * The hand's ray, in the room rather than in the play space.
   *
   * This is the same claim as the very first test in this file and about a
   * different thing: a POINT the headset reports has to arrive in the room's
   * own units and axes, and so does a DIRECTION — by the same rotation and
   * none of the shift. A direction that picked up the play space's translation
   * would point somewhere that looked plausible from the origin and nowhere at
   * all once the visitor had walked, which is the kind of fault that gets found
   * by wearing it.
   *
   * The room is at (7000, 7000) facing along +x, and a hand at the play space's
   * origin 1.2 m up pointing along -z — WebXR's forward — must come back
   * pointing along the room's +x, level, from a point 1.2 m above the floor.
   */
  it("hands the room a pointing ray in the room's own units and axes", async () => {
    await enter();
    const hand = source({ handedness: "right", axes: [0, 0], ray: poseAt(0, 1.2, 0) });
    fake.sticks.push(hand);
    fake.frame(poseAt(0, EYE_HEIGHT / UNITS_PER_METRE, 0));

    expect(pointed).toHaveLength(1);
    const [p] = pointed;
    // the GL frame the room is drawn in: (x, up, y)
    expect(p.from[0]).toBeCloseTo(room.me.x, 0);
    expect(p.from[2]).toBeCloseTo(room.me.y, 0);
    expect(p.from[1]).toBeCloseTo(ROOM.floor + 1.2 * UNITS_PER_METRE, 0);
    expect(p.dir[0]).toBeCloseTo(1, 3);
    expect(p.dir[1]).toBeCloseTo(0, 3);
    expect(p.dir[2]).toBeCloseTo(0, 3);
    expect(p.pressed).toBe(false);
    // a unit vector, because the far end of the ray is somebody else's business
    expect(Math.hypot(...p.dir)).toBeCloseTo(1, 6);
  });

  /** and it TURNS with the play space: the same hand, after a snap turn, points
   *  somewhere else in the room and nowhere else in the visitor's own room */
  it("turns the ray with the play space", async () => {
    await enter();
    const hand = source({ handedness: "left", axes: [0, 0], ray: poseAt(0, 1.2, 0) });
    fake.sticks.push(hand);
    fake.frame(poseAt(0, 1.6, 0));
    const before = pointed.at(-1)!.dir;

    // the right stick snaps the view round. The ray is read at the TOP of a
    // frame and the stick is driven under it, so the turn shows in the frame
    // after the one that made it
    fake.sticks.push(source({ handedness: "right", axes: [1, 0] }));
    fake.frame(poseAt(0, 1.6, 0), 16);
    fake.frame(poseAt(0, 1.6, 0), 32);
    const after = pointed.at(-1)!.dir;
    const turned = Math.atan2(after[2], after[0]) - Math.atan2(before[2], before[0]);
    expect(Math.abs(turned)).toBeCloseTo(Math.PI / 6, 3);
  });

  /**
   * A trigger pulled AT something is not also a request to be somewhere else.
   *
   * The standpoint button falls back to the trigger on a controller too old to
   * have an A — so on those, every press at the board would also have moved the
   * visitor across the room. What the room says it took, the session leaves
   * alone.
   */
  it("leaves the trigger alone when the room says it took the press", async () => {
    await enter();
    takes.it = true;
    const hand = source({ handedness: "right", axes: [0, 0], ray: poseAt(0, 1.2, 0), trigger: true, old: true });
    fake.sticks.push(hand);
    const was = headOf(fake.frame(poseAt(0, 1.6, 0), 0));
    for (let i = 0; i < 20; i++) fake.frame(poseAt(0, 1.6, 0), 16 * (i + 1));
    expect(pointed.at(-1)!.pressed).toBe(true);
    const now = headOf(fake.frame(poseAt(0, 1.6, 0), 400));
    expect(now[0]).toBeCloseTo(was[0], 0);
    expect(now[2]).toBeCloseTo(was[2], 0);
  });

  /** and when it did not take it, the button still stands the visitor where the
   *  game stood — which is the behaviour that was there before the board */
  it("still stands the visitor when nothing took the press", async () => {
    await enter();
    takes.it = false;
    fake.sticks.push(source({ handedness: "right", axes: [0, 0], ray: poseAt(0, 1.2, 0), trigger: true, old: true }));
    const was = headOf(fake.frame(poseAt(0, 1.6, 0), 0));
    for (let i = 0; i < 20; i++) fake.frame(poseAt(0, 1.6, 0), 16 * (i + 1));
    const now = headOf(fake.frame(poseAt(0, 1.6, 0), 400));
    expect(Math.hypot(now[0] - was[0], now[2] - was[2])).toBeGreaterThan(100);
  });

  /** the board is asked for ONCE however long the button is held, and it is
   *  asked for where the visitor is standing and facing */
  it("asks for the board on the press and not on the holding", async () => {
    await enter();
    const hand = source({ handedness: "right", axes: [0, 0], menu: true });
    fake.sticks.push(hand);
    fake.frame(poseAt(0, 1.6, 0));
    fake.frame(poseAt(0, 1.6, 0), 16);
    fake.frame(poseAt(0, 1.6, 0), 32);
    expect(summoned).toHaveLength(1);
    expect(summoned[0].at[0]).toBeCloseTo(room.me.x, 0);
    expect(summoned[0].yaw).toBeCloseTo(room.me.yaw, 2);

    (hand.gamepad as unknown as { buttons: { pressed: boolean }[] }).buttons[5].pressed = false;
    fake.frame(poseAt(0, 1.6, 0), 48);
    (hand.gamepad as unknown as { buttons: { pressed: boolean }[] }).buttons[5].pressed = true;
    fake.frame(poseAt(0, 1.6, 0), 64);
    expect(summoned).toHaveLength(2);     // let go and pressed again: a second ask
  });

  /** a hand the headset cannot see this frame is a hand that is not pointing,
   *  and not a frame that fails */
  it("survives a hand with no pose this frame", async () => {
    await enter();
    fake.sticks.push(source({ handedness: "right", axes: [0, 0] }));   // no ray at all
    expect(fake.frame(poseAt(0, 1.6, 0))).toHaveLength(2);
    expect(pointed).toHaveLength(0);
  });

  it("puts the floor under the head when the headset cannot find one", async () => {
    await enter({ floor: false });
    // no `local-floor`: y = 0 is where the head was, so the play space goes at
    // eye height and everybody is 1.6 m tall
    const head = headOf(fake.frame(poseAt(0, 0, 0)));
    expect(head[1]).toBeCloseTo(EYE_HEIGHT, 0);
  });
});
