/**
 * The room's controls, as a thing standing in the room.
 *
 * The lights and the furniture have always been DOM panels over the canvas, and
 * a canvas is not what a headset shows: a visitor wearing one could be lit by
 * whatever was set before they put it on and not a thing more. This is the
 * second interface that {@link file://./bedsit-settings.ts} made possible — a
 * board hung in the air in front of the visitor, pointed at rather than clicked
 * on, changing the same store the panels change.
 *
 * It does NOT replace them. A real `<input type="range">` on a desk, and the
 * 30-pixel one a phone gets under `body.touch`, are better than a painted
 * picture of one in every way that matters — they drag properly, they take a
 * keyboard, they can be read aloud. What this is for is the one place those
 * cannot go.
 *
 * ## How it is drawn
 *
 * One quad, one texture, one program — painted with the 2D canvas API, which is
 * the only text renderer this page has. The texture is TALLER than the face of
 * the panel: the strip below it holds the pointer's dot, so that the dot and
 * the board can be two draws of one texture rather than a second program and a
 * second thing to keep in step.
 *
 * Repainting is by ROW. A slider being dragged changes one row sixty times a
 * second, and re-uploading a 512×608 texture for one number is the kind of cost
 * that only shows up on the machine that can least afford it. `getImageData`
 * over the row's own rectangle plus `texSubImage2D` uploads a fiftieth of it.
 *
 * ## How it is pointed at
 *
 * A ray and a plane, in the room's own units, and nothing about where the ray
 * came from. A controller in a headset, the middle of the screen on a desk: the
 * caller works out the ray, this works out what it hit. That is the whole of
 * why the pointing is shared and the pointer is not.
 */
import {
  cycleSkin, set, settings, takeOutAll, VIGNETTES, type SettingKey,
} from "./bedsit-settings";
import { UNITS_PER_METRE } from "./bedsit-room";

// --- the face ---------------------------------------------------------------

const W = 512;
/** the title, then nine rows, then a margin: the face of the board */
const TITLE_H = 56;
const ROW_H = 56;
const ROWS = 11;
const FACE_H = TITLE_H + ROWS * ROW_H + 16;
/** the strip under the face, which is not on the board: the pointer's dot */
const DOT_H = 32;
const H = FACE_H + DOT_H;
/** the frame round the board, in pixels: painted once, and kept off by the rows */
const EDGE = 2;

/** how wide the board is in the room, and how far in front of the visitor it
 *  hangs — a comfortable arm's length, in the metres a headset thinks in */
const WIDE = 0.62 * UNITS_PER_METRE;
const TALL = WIDE * (FACE_H / W);
const AHEAD = 1.15 * UNITS_PER_METRE;
/** the dot, as a fraction of the board's width */
const DOT_WIDE = 0.030 * WIDE;
/**
 * The beam: how thick, and how far it goes when it is pointing at nothing.
 *
 * A hand needs to be able to FIND the board, and a pointer that only exists
 * once it is already on the target is no help at all in doing that — which is
 * what the first version of this was. So the beam is drawn whenever the board
 * is up, whether or not it is hitting anything, and it stops in mid-air when it
 * is not.
 *
 * 5 units is 3 mm, which is about what a laser pointer in a headset looks like:
 * thick enough to see against a dark room, thin enough not to be the thing you
 * are looking at.
 */
const BEAM_WIDE = 5;
const BEAM_LONG = 1.6 * UNITS_PER_METRE;

const INK = {
  ground: "rgba(15,16,19,0.93)",
  edge: "rgba(255,255,255,0.16)",
  title: "#e9dfc9",
  label: "#c3bdb2",
  value: "#f2e7d1",
  track: "#34343a",
  /** the room's own lamps, near enough: this board is lit by them */
  fill: "#d8a24a",
  hover: "rgba(255,255,255,0.07)",
  press: "rgba(216,162,74,0.20)",
  dot: "#f6e8c8",
  /** the beam is the dot's colour at half strength: a pointer rather than a
   *  thing in the room, and not something to look at instead of the board */
  beam: "rgba(246,232,200,0.55)",
};

const FONT = '500 22px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const TITLE_FONT = '600 24px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// --- what the rows are ------------------------------------------------------

/**
 * A row is what it DOES, not what it looks like.
 *
 * Each names the setting it moves so that a change arriving from anywhere else
 * — the desk panel, a test, the console — repaints exactly the row that is now
 * out of date, and no others.
 */
type Row =
  | {
    kind: "slider"; label: string; watches: SettingKey;
    get(): number; set(v: number): void; max: number;
    /** the bottom of the track, for the one setting whose floor is not zero */
    min?: number;
  }
  | {
    kind: "choice"; label: string; watches: SettingKey;
    options: readonly string[]; get(): number; set(i: number): void;
  }
  | { kind: "buttons"; label: string; watches: null; options: readonly string[]; press(i: number): void };

/** the lamp sliders all do the same thing to a different index, and the two
 *  skies are one slider and therefore always the same number twice */
function lampRow(label: string, i: number): Row {
  return {
    kind: "slider", label, watches: "lamp", max: 2.5,
    get: () => settings.lamp[i],
    set: (v) => {
      const lamp = [...settings.lamp];
      lamp[i] = v;
      if (i === 3) lamp[4] = v;          // the windows move together
      set({ lamp });
    },
  };
}

const TAPS = [5, 1, 0] as const;         // soft, hard, off — the panel's order

function rows(pieces: () => Iterable<string>): Row[] {
  return [
    lampRow("pendant", 0),
    lampRow("standard", 1),
    lampRow("desk lamp", 2),
    lampRow("windows", 3),
    {
      kind: "slider", label: "fill", watches: "fill", max: 2.5,
      get: () => settings.fill, set: (v) => set({ fill: v }),
    },
    /**
     * Exposure, which until now was `[` and `]` and nothing else.
     *
     * Two keys, on a page whose whole point is that it can be stood in — and a
     * headset has no keyboard, so the one control that answers "this room is
     * brighter than it should be" was the one control a visitor wearing it
     * could not reach. It is bounded below at 0.4 rather than 0 because the
     * bottom of this track is a black room, which is not a setting anybody
     * means to choose.
     */
    {
      kind: "slider", label: "exposure", watches: "exposure", min: 0.4, max: 4,
      get: () => settings.exposure, set: (v) => set({ exposure: v }),
    },
    {
      kind: "choice", label: "shadows", watches: "shadowTaps",
      options: ["soft", "hard", "off"],
      get: () => Math.max(0, TAPS.indexOf(settings.shadowTaps as 5 | 1 | 0)),
      set: (i) => set({ shadowTaps: TAPS[i] }),
    },
    {
      kind: "choice", label: "surfaces", watches: "skin",
      options: ["painted", "plaster"],
      get: () => (settings.skin === "painted" ? 0 : 1),
      set: () => cycleSkin(),
    },
    {
      kind: "choice", label: "smoke", watches: "smoke",
      options: ["on", "off"],
      get: () => (settings.smoke ? 0 : 1),
      set: (i) => set({ smoke: i === 0 }),
    },
    /**
     * The vignette, which is the one row here that only a headset can feel.
     *
     * It is on the board and not merely in the desk panel because the visitor
     * who needs to change it is the one wearing the thing, mid-glide, having
     * just discovered that the ring is tighter than they want. Asking them to
     * take the headset off to widen it is asking them to stop.
     */
    {
      kind: "choice", label: "vignette", watches: "vignette",
      options: VIGNETTES,
      get: () => Math.max(0, VIGNETTES.indexOf(settings.vignette)),
      set: (i) => set({ vignette: VIGNETTES[i] }),
    },
    {
      kind: "buttons", label: "furniture", watches: null,
      options: ["all", "none"],
      press: (i) => takeOutAll(pieces(), i === 1),
    },
  ];
}

// --- the shaders ------------------------------------------------------------

const VERT = `
attribute vec3 aPos;
attribute vec2 aUV;
uniform mat4 uProj;
uniform mat4 uView;
varying vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = uProj * uView * vec4(aPos, 1.0);
}`;

/**
 * The board's own pixels, and nothing done to them.
 *
 * Unlit on purpose. Everything else in this room is a surface the lamps fall
 * on, and this is not a surface — it is an instrument, and an instrument that
 * dims when the visitor turns the pendant down is an instrument they cannot
 * find the pendant slider on. It is also the cheapest thing in the frame, which
 * matters when the frame is drawn twice.
 */
const FRAG = `
precision mediump float;
uniform sampler2D uPanel;
varying vec2 vUV;
void main() {
  vec4 c = texture2D(uPanel, vUV);
  if (c.a < 0.004) discard;
  gl_FragColor = c;
}`;

// --- the thing itself -------------------------------------------------------

export interface PanelHost {
  gl: WebGLRenderingContext;
  /** the room's program and its attribute arrays, to be put back as found */
  program: WebGLProgram;
  locs: number[];
  /** every piece of furniture the room built, for the all/none row */
  pieces(): Iterable<string>;
}

/** where a ray met the board: the row it landed on, and where across it */
interface Hit { row: number; u: number; v: number }

export interface Panel {
  readonly shown: boolean;
  /**
   * The row the pointer is on: −1 for the title bar, −2 for off the board.
   *
   * The only way to ask "where is it pointing" that does not involve reading
   * pixels, which is what a suite without a headset has to do — and what the
   * beam and the dot are drawn from, so a wrong answer here is a wrong picture.
   */
  readonly aimed: number;
  /** put the board up in front of an eye, or take it down */
  toggle(at: readonly [number, number, number], yaw: number): void;
  hide(): void;
  /**
   * Point at it: true if the ray landed on the board at all.
   *
   * `beam` asks for the ray to be DRAWN, which a hand holding a controller
   * wants and an eye looking down its own gaze does not — a beam coming out of
   * the middle of your own face is a beam seen end-on, which is one pixel.
   */
  aim(
    from: readonly [number, number, number],
    dir: readonly [number, number, number],
    beam?: boolean,
  ): boolean;
  /** press whatever is under the pointer, and let go of it */
  press(): void;
  release(): void;
  /**
   * Put the board back in step with the store.
   *
   * For a change that came from the OTHER interface — the desk panel, a key,
   * the console — which the board has no other way of hearing about. The page
   * owns the subscription and calls this, rather than the panel subscribing on
   * construction: the store is a singleton, and a panel that attached itself to
   * it could never be let go of again.
   */
  refresh(changed: ReadonlySet<SettingKey>): void;
  /** `eye` is where it is being looked at FROM, which is what turns the beam's
   *  ribbon to face the viewer — and is a different point for each eye */
  draw(proj: Float32Array, view: Float32Array, eye: readonly [number, number, number]): void;
}

export function makePanel(host: PanelHost): Panel {
  const { gl } = host;
  const list = rows(host.pieces);
  // the face is measured from ROWS at module scope, so a row added without it
  // would be drawn off the bottom and nothing else would say so
  if (list.length !== ROWS) throw new Error(`the board has ${list.length} rows and room for ${ROWS}`);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const build = (type: number, src: string): WebGLShader => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "panel");
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, build(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, build(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "panel link");
  const aPos = gl.getAttribLocation(prog, "aPos");
  const aUV = gl.getAttribLocation(prog, "aUV");
  const uProj = gl.getUniformLocation(prog, "uProj");
  const uView = gl.getUniformLocation(prog, "uView");
  gl.useProgram(prog);
  gl.uniform1i(gl.getUniformLocation(prog, "uPanel"), 0);
  gl.useProgram(host.program);

  const posBuf = gl.createBuffer()!;
  const uvBuf = gl.createBuffer()!;
  /**
   * The face's UVs and the dot's, both in the one texture: two triangles each,
   * the face on top of the canvas and the dot in the strip below it.
   *
   * V COUNTS DOWN THE CANVAS, not up the board. `UNPACK_FLIP_Y_WEBGL` is false
   * — its default, and left alone here because flipping it would put every
   * `texSubImage2D` row at the mirror of the row it was painted into — so the
   * canvas's FIRST row is v = 0 and the board's top corners take it. Getting
   * this the other way round draws the whole board upside down, which looks
   * exactly like a matrix fault and is nothing of the kind.
   */
  const vBot = FACE_H / H;               // where the face ends and the strip begins
  const dw = DOT_H / W;
  /** the middle of the beam's swatch, which is flat: every one of its corners
   *  samples the same texel, so the beam is one colour and needs no gradient */
  const bu = (DOT_H * 1.5) / W, bv = (FACE_H + DOT_H / 2) / H;
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    // the face
    0, vBot, 1, vBot, 0, 0, /**/ 1, vBot, 1, 0, 0, 0,
    // the beam: four corners of one texel
    bu, bv, bu, bv, bu, bv, /**/ bu, bv, bu, bv, bu, bv,
    // and the dot, which is the whole of its own square
    0, 1, dw, 1, 0, vBot, /**/ dw, 1, dw, vBot, 0, vBot,
  ]), gl.STATIC_DRAW);

  // --- where it hangs -------------------------------------------------------

  /** the board's centre, and the two directions across its face, all in the
   *  room's GL frame (x, up, y) — set when it is put up and fixed after, so
   *  that walking round it is walking round a thing rather than pushing it */
  let at: [number, number, number] = [0, 0, 0];
  let right: [number, number, number] = [1, 0, 0];
  const up: [number, number, number] = [0, 1, 0];
  let normal: [number, number, number] = [0, 0, 1];
  let shown = false;

  /** where the pointer is on the face, or null when it is off it */
  let hit: Hit | null = null;
  /**
   * The last ray a hand gave us, hit or miss, and whether to draw it.
   *
   * Kept apart from `hit` because the two answer different questions: `hit` is
   * what would be pressed, and this is where the hand is pointing — which has
   * to be drawn even when the answer to the first is "nothing", or there is no
   * way to find the board with it.
   */
  let ray: { from: [number, number, number]; dir: [number, number, number]; beam: boolean } | null = null;
  /** the row being held down, which is what makes a slider a DRAG rather than
   *  a tap: once a press has landed on one, the pointer owns it until it lets
   *  go, even if the ray wanders off the row on the way */
  let held: number | null = null;

  /** the quad's six corners from a centre and two half-axes, as two triangles */
  function quad(
    at: readonly number[], x: readonly number[], y: readonly number[],
  ): number[] {
    const corner = (sx: number, sy: number): number[] =>
      [0, 1, 2].map((k) => at[k] + x[k] * sx + y[k] * sy);
    return [
      ...corner(-1, -1), ...corner(1, -1), ...corner(-1, 1),
      ...corner(1, -1), ...corner(1, 1), ...corner(-1, 1),
    ];
  }

  function place(eye: readonly [number, number, number], yaw: number): void {
    const f: [number, number, number] = [Math.cos(yaw), 0, Math.sin(yaw)];
    at = [eye[0] + f[0] * AHEAD, eye[1], eye[2] + f[2] * AHEAD];
    // upright whatever the visitor's pitch: a board that tilts with the head is
    // a board that is never level with anything
    right = [-Math.sin(yaw), 0, Math.cos(yaw)];
    normal = [-f[0], 0, -f[2]];
    const c = quad(
      at,
      right.map((v) => v * WIDE / 2),
      up.map((v) => v * TALL / 2),
    );
    // the beam's and the dot's, both filled in per frame below
    c.push(...new Array(36).fill(0));
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(c), gl.DYNAMIC_DRAW);
  }

  /** where on the board the pointer is, in the room: the dot's centre, a hair
   *  off the face so that the two cannot fight for the same depth */
  function dotAt(): [number, number, number] {
    const x = (hit!.u - 0.5) * WIDE, y = (0.5 - hit!.v) * TALL;
    return [0, 1, 2].map((k) => at[k] + right[k] * x + up[k] * y + normal[k] * 2) as
      [number, number, number];
  }

  /** the dot, square on the board's own face */
  function dotQuad(): Float32Array {
    return new Float32Array(quad(
      dotAt(),
      right.map((v) => v * DOT_WIDE),
      up.map((v) => v * DOT_WIDE),
    ));
  }

  /**
   * The beam, as a ribbon turned edge-on to the eye.
   *
   * A line has no width to give it, so it is a long thin quad — and a long thin
   * quad in space disappears the moment it is seen edge-on, which for a beam
   * coming out of the visitor's own hand is most of the time. So its width is
   * laid across the line between the eye and the beam: `dir × (eye − from)` is
   * perpendicular to both, which is exactly the direction that keeps the ribbon
   * facing whoever is looking at it.
   *
   * In a session this is worked out per EYE, because `draw` is called per eye
   * with that eye's own position — which is right, and is also the only way the
   * two eyes can agree about where a 3 mm ribbon is.
   */
  function beamQuad(eye: readonly [number, number, number]): Float32Array {
    const r = ray!;
    const end = hit ? dotAt() : ([0, 1, 2].map((k) => r.from[k] + r.dir[k] * BEAM_LONG) as
      [number, number, number]);
    const mid = [0, 1, 2].map((k) => (r.from[k] + end[k]) / 2);
    const half = [0, 1, 2].map((k) => (end[k] - r.from[k]) / 2);
    const toEye = [0, 1, 2].map((k) => eye[k] - r.from[k]);
    const side = [
      r.dir[1] * toEye[2] - r.dir[2] * toEye[1],
      r.dir[2] * toEye[0] - r.dir[0] * toEye[2],
      r.dir[0] * toEye[1] - r.dir[1] * toEye[0],
    ];
    const len = Math.hypot(...side) || 1;
    return new Float32Array(quad(mid, side.map((v) => (v / len) * BEAM_WIDE), half));
  }

  // --- painting it ----------------------------------------------------------

  function rowTop(i: number): number { return TITLE_H + i * ROW_H; }

  /** the track a slider's knob runs along, in the canvas's own pixels */
  const TRACK = { x0: 190, x1: W - 86 };

  function paintRow(i: number, upload = true): void {
    const row = list[i];
    const y = rowTop(i);
    ctx.save();
    /**
     * Clipped INSIDE the board's own edge, by the two pixels it is drawn with.
     *
     * The frame round the board is painted once, by `paintAll`. A row that
     * cleared the full width would take the two pixels of it that cross the
     * row, and the board would end up with gaps in its frame exactly where it
     * had been used — so the row keeps off it, and the frame is never repainted
     * and never double-struck.
     */
    ctx.beginPath();
    ctx.rect(EDGE, y, W - 2 * EDGE, ROW_H);
    ctx.clip();

    /**
     * CLEARED first, and that is not tidiness.
     *
     * The ground is 93% opaque, so painting it over itself gives 99.5%, and
     * over that 99.97%: a row repainted once per frame of a drag would climb to
     * fully opaque while the rest of the board stayed translucent, and the
     * board would go on getting heavier the more it was used. Clearing makes a
     * repaint idempotent, which is the only way a row painted a thousand times
     * can look like one painted once.
     */
    ctx.clearRect(EDGE, y, W - 2 * EDGE, ROW_H);
    ctx.fillStyle = INK.ground;
    ctx.fillRect(EDGE, y, W - 2 * EDGE, ROW_H);
    if (hit?.row === i || held === i) {
      ctx.fillStyle = held === i ? INK.press : INK.hover;
      ctx.fillRect(EDGE, y, W - 2 * EDGE, ROW_H);
    }

    ctx.font = FONT;
    ctx.textBaseline = "middle";
    ctx.fillStyle = INK.label;
    ctx.fillText(row.label, 28, y + ROW_H / 2);

    if (row.kind === "slider") {
      const g = row.get();
      const lo = row.min ?? 0;
      const t = Math.max(0, Math.min(1, (g - lo) / (row.max - lo)));
      const mid = y + ROW_H / 2;
      ctx.strokeStyle = INK.track;
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(TRACK.x0, mid);
      ctx.lineTo(TRACK.x1, mid);
      ctx.stroke();
      ctx.strokeStyle = INK.fill;
      ctx.beginPath();
      ctx.moveTo(TRACK.x0, mid);
      ctx.lineTo(TRACK.x0 + (TRACK.x1 - TRACK.x0) * t, mid);
      ctx.stroke();
      ctx.fillStyle = INK.fill;
      ctx.beginPath();
      ctx.arc(TRACK.x0 + (TRACK.x1 - TRACK.x0) * t, mid, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = INK.value;
      ctx.textAlign = "right";
      ctx.fillText(g.toFixed(2), W - 22, mid);
      ctx.textAlign = "left";
    } else {
      // a choice and a pair of buttons are drawn the same: cells across the
      // right-hand half, the current one lit
      const chosen = row.kind === "choice" ? row.get() : -1;
      const n = row.options.length;
      const x0 = TRACK.x0, wide = (W - 22 - x0) / n;
      row.options.forEach((label, k) => {
        const x = x0 + k * wide;
        ctx.fillStyle = k === chosen ? INK.fill : INK.track;
        ctx.globalAlpha = k === chosen ? 0.9 : 0.5;
        ctx.fillRect(x + 4, y + 12, wide - 8, ROW_H - 24);
        ctx.globalAlpha = 1;
        ctx.fillStyle = k === chosen ? "#1a1508" : INK.value;
        ctx.textAlign = "center";
        ctx.fillText(label, x + wide / 2, y + ROW_H / 2);
        ctx.textAlign = "left";
      });
    }
    ctx.restore();

    if (!upload) return;
    // one row's rectangle, not the whole board: see the note at the top
    const data = ctx.getImageData(0, y, W, ROW_H);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y, W, ROW_H, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array(data.data.buffer));
  }

  function paintAll(): void {
    ctx.clearRect(0, 0, W, H);
    // the board: a dark ground with a hairline round it
    ctx.fillStyle = INK.ground;
    ctx.fillRect(0, 0, W, FACE_H);
    ctx.font = TITLE_FONT;
    ctx.textBaseline = "middle";
    ctx.fillStyle = INK.title;
    ctx.fillText("the room", 28, TITLE_H / 2);
    ctx.font = FONT;
    ctx.fillStyle = INK.label;
    ctx.textAlign = "right";
    ctx.fillText("point · press", W - 22, TITLE_H / 2);
    ctx.textAlign = "left";
    for (let i = 0; i < list.length; i++) paintRow(i, false);
    ctx.strokeStyle = INK.edge;
    ctx.lineWidth = EDGE;
    ctx.strokeRect(EDGE / 2, EDGE / 2, W - EDGE, FACE_H - EDGE);

    // and the pointer's two pieces, in the strip below the face: the dot that
    // sits where it is pointing, and one flat swatch the beam samples
    ctx.fillStyle = INK.dot;
    ctx.beginPath();
    ctx.arc(DOT_H / 2, FACE_H + DOT_H / 2, DOT_H / 2 - 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK.beam;
    ctx.fillRect(DOT_H, FACE_H, DOT_H, DOT_H);

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  paintAll();

  // --- pointing at it -------------------------------------------------------

  function aim(
    from: readonly [number, number, number],
    dir: readonly [number, number, number],
    beam = false,
  ): boolean {
    if (!shown) return false;
    // remembered whatever comes of it: a hand pointing at nothing still has to
    // be drawn, or there is no way to sweep it onto the board
    ray = { from: [...from] as [number, number, number], dir: [...dir] as [number, number, number], beam };
    const dn = dir[0] * normal[0] + dir[1] * normal[1] + dir[2] * normal[2];
    const was = hit;
    // parallel to the board, or coming at its back: nothing to hit
    if (dn > -1e-6) { hit = null; return repaintAfter(was, null); }
    const to = [at[0] - from[0], at[1] - from[1], at[2] - from[2]];
    const t = (to[0] * normal[0] + to[1] * normal[1] + to[2] * normal[2]) / dn;
    if (t <= 0) { hit = null; return repaintAfter(was, null); }
    const p = [from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t];
    const d = [p[0] - at[0], p[1] - at[1], p[2] - at[2]];
    const x = d[0] * right[0] + d[1] * right[1] + d[2] * right[2];
    const y = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    const u = x / WIDE + 0.5, v = 0.5 - y / TALL;
    if (u < 0 || u > 1 || v < 0 || v > 1) { hit = null; return repaintAfter(was, null); }
    const py = v * FACE_H;
    const row = py < TITLE_H ? -1 : Math.min(list.length - 1, Math.floor((py - TITLE_H) / ROW_H));
    hit = { row, u, v };
    // a held slider follows the pointer across the whole board, which is what
    // makes it possible to set 0.00 without the ray having to stay in the row
    if (held !== null) slide(held, u);
    return repaintAfter(was, hit);
  }

  /** repaint only the rows whose highlight changed, which is at most two */
  function repaintAfter(was: Hit | null, now: Hit | null): boolean {
    if (was?.row !== now?.row) {
      if (was && was.row >= 0) paintRow(was.row);
      if (now && now.row >= 0) paintRow(now.row);
    }
    return now !== null;
  }

  function slide(i: number, u: number): void {
    const row = list[i];
    if (row.kind !== "slider") return;
    const px = u * W;
    const t = Math.max(0, Math.min(1, (px - TRACK.x0) / (TRACK.x1 - TRACK.x0)));
    const lo = row.min ?? 0;
    // to the slider's own step, so that the board and the desk panel can never
    // disagree about a value by a hundredth
    row.set(Math.round((lo + t * (row.max - lo)) * 20) / 20);
  }

  function press(): void {
    if (!hit || hit.row < 0) return;
    const row = list[hit.row];
    if (row.kind === "slider") {
      held = hit.row;
      slide(hit.row, hit.u);
      paintRow(hit.row);
      return;
    }
    const n = row.options.length;
    const k = Math.min(n - 1, Math.max(0, Math.floor(((hit.u * W - TRACK.x0) / (W - 22 - TRACK.x0)) * n)));
    if (row.kind === "choice") {
      // a press on the row but off the cells still means "the next one", which
      // is what a controller pointed roughly at a line of text usually wants
      row.set(hit.u * W < TRACK.x0 ? (row.get() + 1) % n : k);
    } else {
      if (hit.u * W >= TRACK.x0) row.press(k);
    }
  }

  function release(): void {
    const was = held;
    held = null;
    if (was !== null) paintRow(was);
  }

  // --- drawing it -----------------------------------------------------------

  function draw(
    proj: Float32Array, view: Float32Array, eye: readonly [number, number, number],
  ): void {
    if (!shown) return;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(uProj, false, proj);
    gl.uniformMatrix4fv(uView, false, view);
    for (const l of host.locs) if (l >= 0) gl.disableVertexAttribArray(l);
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aUV);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    // the beam's six vertices and the dot's follow the face's in the one buffer
    if (ray?.beam) gl.bufferSubData(gl.ARRAY_BUFFER, 6 * 3 * 4, beamQuad(eye));
    if (hit) gl.bufferSubData(gl.ARRAY_BUFFER, 12 * 3 * 4, dotQuad());
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    /**
     * IN FRONT OF THE ROOM, always.
     *
     * The board is summoned an arm's length ahead and the room is full of
     * things an arm's length ahead — a wall, the counterpane, the back of the
     * armchair. Depth-tested, half of it would be inside the furniture, which
     * is a control panel that cannot be used from where the visitor is standing.
     * So it is drawn over: an instrument rather than a thing in the room.
     */
    gl.disable(gl.DEPTH_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, 6);                     // the board
    if (ray?.beam) gl.drawArrays(gl.TRIANGLES, 6, 6);      // the beam out of the hand
    if (hit) gl.drawArrays(gl.TRIANGLES, 12, 6);           // and the dot on the face
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(aPos);
    gl.disableVertexAttribArray(aUV);
    for (const l of host.locs) if (l >= 0) gl.enableVertexAttribArray(l);
    gl.useProgram(host.program);
  }

  return {
    get shown(): boolean { return shown; },
    get aimed(): number { return hit ? hit.row : -2; },
    toggle(eye, yaw): void {
      shown = !shown;
      hit = null;
      held = null;
      if (shown) { place(eye, yaw); paintAll(); }
    },
    hide(): void { shown = false; hit = null; held = null; },
    refresh(changed): void {
      // only what actually moved, and only while the board is up: a change made
      // from the desk while it is down costs nothing at all
      if (!shown) return;
      list.forEach((row, i) => { if (row.watches && changed.has(row.watches)) paintRow(i); });
    },
    aim,
    press,
    release,
    draw,
  };
}
