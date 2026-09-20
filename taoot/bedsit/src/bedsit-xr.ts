/**
 * The bedsit in a headset.
 *
 * This module owns a WebXR session and nothing else: it does not know what the
 * room is made of, how it is lit or what it is painted with. It borrows the
 * page's own view matrix and its own draw call, asks the headset where the eyes
 * are, and hands those two back one eye at a time. Everything that makes the
 * room look like 1942 stays in {@link file://./bedsit-page.ts}, and this file
 * stays a camera.
 *
 * Three things are genuinely different in here, and they are the whole of the
 * work:
 *
 *  1. **The units.** The room is in the game's own units and a headset reports
 *     metres. The room was always at true scale — `UNITS_PER_METRE` is
 *     2479/1.6, because the SET's eye height is 2479 and a man's eye is 1.6 m
 *     off the floor — so there is nothing to guess, only a scale to apply, and
 *     it is applied in ONE place: the view matrix. Lighting reads world
 *     positions and would break if the model were scaled instead.
 *  2. **The camera is not ours.** Pitch, roll, the lens and the distance
 *     between the eyes all belong to the headset. What is left to this page is
 *     where the play space stands in the room and which way it faces, which is
 *     what `me` means in a session: not an eye, but a floor.
 *  3. **The framebuffer is not the canvas.** In a session `null` is not the
 *     screen, and anything that binds it — the shadow bake does — draws into
 *     nowhere.
 *
 * And one thing this file draws itself, which is the exception to it knowing
 * nothing about pixels: the COMFORT VIGNETTE, a black ring that closes in from
 * the edge of vision while the visitor is gliding. It is here and not with the
 * room because it is not part of the room — it is part of being moved through
 * one without moving, which is a fact about the session and about the inner
 * ear, and it has no meaning at all on the flat page.
 */
import { view } from "./bedsit-optics";
import { EYE_HEIGHT, ROOM, STANDPOINTS, UNITS_PER_METRE } from "./bedsit-room";

/** the walker, as the flat page keeps it. In a session it is the PLAY SPACE:
 *  where the floor under the visitor's feet stands in the room, and its bearing. */
export interface Walker { x: number; y: number; z: number; yaw: number; pitch: number }

/** what the page has to lend this module for a session to be possible */
export interface Room {
  gl: WebGLRenderingContext;
  me: Walker;
  /** MSAA as the page has it — the context's own `antialias` means nothing here */
  antialias: boolean;
  /** the near and far planes the flat page clips at, in GAME UNITS */
  clip: readonly [number, number];
  /** draw the room once, from one eye. No clear and no viewport: the caller owns
   *  both, because in stereo neither is the same thing for both eyes. */
  draw(proj: Float32Array, look: Float32Array, at: [number, number, number], seconds: number): void;
  /** the box the walker may stand in. Here it is applied to the HEAD, not to
   *  the play space, because a person can walk out of the room without it. */
  inside(x: number, y: number): [number, number];
  /**
   * The room's own program and attribute slots, so the vignette can put them
   * back after drawing over it.
   *
   * Both are state of the CONTEXT rather than of a program, so a second program
   * that draws a single quad has to leave them exactly as it found them or the
   * room's next draw reads its vertices out of a six-float buffer. The page
   * lends them rather than the session guessing, because the page is where the
   * set of them is decided and where it would change.
   */
  program: WebGLProgram;
  locs: readonly number[];
  /** the headset has taken the room: here is the framebuffer everything must be
   *  drawn into now, and stop the flat page's own loop. */
  enter(target: WebGLFramebuffer): void;
  /** and has given it back */
  leave(): void;
}

/**
 * How fast the visitor glides, in metres a second.
 *
 * The flat page walks at 1700 units a second, which is 1.1 m/s, and runs at
 * 4200, which is 2.7 — a sprint across a bedsit. Neither number is the question
 * here. Sliding a standing body through a room it can see but does not feel is
 * the one thing in VR that reliably makes people ill, and what makes it worse
 * is speed. So there is one speed, it is a slow walk, and there is no run: the
 * room is six metres across and nobody is in a hurry.
 */
const GLIDE = 1.3;
/** a stick is never quite centred, and a room this small punishes a drift */
const DEAD = 0.18;
/**
 * Turning is SNAPPED, and that is a comfort decision rather than a cheap one.
 *
 * Smooth yaw under a stick is the other thing that makes people ill — the
 * picture turns and the inner ear says nothing turned. A snap is a jump, which
 * the eye reads as a cut rather than as motion, and a cut has no motion for the
 * ear to disagree with. 30° is the usual step, and it is right for a room whose
 * three views worth having are about a third of a turn apart anyway.
 */
const TURN = Math.PI / 6;
/** past the first the stick means turn, and it means nothing again below the
 *  second: one shove, one snap, however long it is held */
const SNAP = [0.7, 0.4] as const;

/**
 * How much of the headset's own resolution to render.
 *
 * Every pixel in this room costs five lamps, three cube-map lookups and an
 * analytic sash test, and a session asks for that twice over at a frame rate
 * that cannot be missed — a dropped frame in a headset is felt rather than
 * seen. 0.8 is 64% of the pixels for a softness a headset's own optics largely
 * hide, and it is the first dial to reach for if this ever needs to be cheaper.
 */
const SCALE = 0.8;

/**
 * The vignette: what it is for, and why it is measured in tangents.
 *
 * Gliding is the thing that makes people ill. The eye is carried across a room
 * and every other sense says the body did not move, and the disagreement is
 * worst at the EDGE of vision, which is the part of the eye that reads motion
 * and is not being looked at with. So the edge is taken away while the gliding
 * lasts: a black ring closes in, the picture narrows to a cone straight ahead,
 * and the periphery has nothing in it to disagree about. It opens again the
 * moment the stick is let go.
 *
 * The three numbers are TANGENTS of the angle off the eye's own axis, not
 * fractions of the screen, and that is what makes them mean the same thing on
 * every headset. A fraction of the screen is a different angle on every pair of
 * lenses, so a ring that sits gently outside the useful field on one would be
 * across somebody's reading vision on another. A tangent is an angle.
 *
 * `OPEN` is past the corner of any headset made — 61°, where a wide pair
 * reaches about 56° into the corner — so a vignette at rest is not merely
 * faint, it is off the glass entirely and costs nothing to look through.
 * `SHUT` leaves a 62° cone, which is a generous tunnel rather than a keyhole:
 * this room is six metres across at a slow walk, and the dose should match the
 * provocation.
 */
const APERTURE = { open: 1.8, shut: 0.6, feather: 0.2 } as const;
/**
 * How fast it closes and opens, in seconds.
 *
 * It closes faster than it opens, and that way round on purpose. Closing late
 * means the first moment of a glide — the moment that provokes — happens at the
 * full width of vision, which is the whole of what this is meant to prevent.
 * Opening late costs nothing but a moment of narrowed view after the stick is
 * centred, and it is what keeps a feathered stick from strobing the ring in and
 * out of somebody's sight.
 */
const VIGNETTE = { close: 0.12, open: 0.3 } as const;

/**
 * The blink, and why the jump waits for it.
 *
 * Standing somewhere else between one frame and the next is a cut, and a cut is
 * the cheapest thing in VR to do badly: the room is simply elsewhere, and for a
 * moment the visitor is looking for what moved. Every headset's own menus
 * answer this the same way, and so does this — go black, move while nobody can
 * see it, come back. What arrives is a room being looked at afresh rather than
 * a room that jumped.
 *
 * Out is quicker than in: the darkness has to get there before the eye can
 * follow the movement, and the way back can afford to be gentle. The jump
 * itself happens at the bottom, which is what `jump` below is waiting for.
 */
const BLINK = { out: 0.07, in: 0.13 } as const;

/** a tick in the hand for the two things that happen without warning: strength
 *  0..1 and milliseconds. Not every controller has a motor, and none of them
 *  owes us one. */
const BUZZ = { turn: [0.35, 25], stand: [0.5, 40] } as const;

/**
 * The vignette's own program: one quad over the eye, and nothing else.
 *
 * It is drawn in NDC and needs no matrices — but it does need to know where the
 * eye's axis IS, and on a headset that is not the middle of the picture. Every
 * headset's frusta are asymmetric (the two eyes see further out than in), so
 * NDC (0,0) is off to one side of where the visitor is actually looking, in
 * opposite directions in the two eyes. A ring centred there is a ring that
 * drifts as it closes, differently per eye, which is precisely the kind of
 * thing the vignette was put in to stop.
 *
 * Both corrections come out of the projection matrix itself. The axis, in NDC,
 * is where (0, 0, -1) lands, which for any perspective matrix is `-m[8]`,
 * `-m[9]`. And dividing the offset from it by `m[0]` and `m[5]` turns NDC back
 * into the tangent the apertures are written in — so the ring is circular in
 * ANGLE rather than circular on a screen that is not square.
 */
const VIGNETTE_VERT = `
attribute vec2 aQuad;
varying vec2 vNDC;
void main() {
  vNDC = aQuad;
  gl_Position = vec4(aQuad, 0.0, 1.0);
}`;

const VIGNETTE_FRAG = `
precision mediump float;
varying vec2 vNDC;
uniform vec2 uAxis;      // where the eye actually points, in NDC
uniform vec2 uTangent;   // NDC per unit tangent, which is 1/m[0] and 1/m[5]
uniform float uAperture; // how wide the hole is, as a tangent
uniform float uFeather;
uniform float uBlink;    // and the whole view black, for a jump
void main() {
  vec2 off = (vNDC - uAxis) * uTangent;
  float ring = smoothstep(uAperture, uAperture + uFeather, length(off));
  // the darkest of the two rather than the sum: a blink during a glide is
  // already black, and adding the ring to it would be blacker than black and
  // leave a seam where the two meet
  gl_FragColor = vec4(0.0, 0.0, 0.0, max(ring, uBlink));
}`;

interface Vignette {
  draw(projection: Float32Array, aperture: number, blink: number): void;
}

/**
 * Build it, against the page's own context.
 *
 * The attribute dance is the one in `drawSmoke`: the room's arrays are put away
 * before a foreign program draws and enabled again afterwards, because array
 * state belongs to the CONTEXT and not to the program that set it. Leaving one
 * of the room's enabled over this two-triangle buffer would have its next draw
 * read thousands of vertices out of six.
 */
function makeVignette(gl: WebGLRenderingContext, room: Room): Vignette {
  const build = (type: number, src: string): WebGLShader => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "vignette");
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, build(gl.VERTEX_SHADER, VIGNETTE_VERT));
  gl.attachShader(prog, build(gl.FRAGMENT_SHADER, VIGNETTE_FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "vignette link");

  const quad = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  // THREE vertices, not six: one triangle big enough to cover the square is the
  // same picture as two that tile it, with no diagonal down the middle for the
  // rasteriser to seam along
  const loc = gl.getAttribLocation(prog, "aQuad");
  const u = {
    axis: gl.getUniformLocation(prog, "uAxis"),
    tangent: gl.getUniformLocation(prog, "uTangent"),
    aperture: gl.getUniformLocation(prog, "uAperture"),
    feather: gl.getUniformLocation(prog, "uFeather"),
    blink: gl.getUniformLocation(prog, "uBlink"),
  };

  return {
    draw(projection, aperture, blink) {
      gl.useProgram(prog);
      gl.uniform2f(u.axis, -projection[8], -projection[9]);
      gl.uniform2f(u.tangent, 1 / projection[0], 1 / projection[5]);
      gl.uniform1f(u.aperture, aperture);
      gl.uniform1f(u.feather, APERTURE.feather);
      gl.uniform1f(u.blink, blink);
      for (const l of room.locs) if (l >= 0) gl.disableVertexAttribArray(l);
      gl.enableVertexAttribArray(loc);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.disableVertexAttribArray(loc);
      for (const l of room.locs) if (l >= 0) gl.enableVertexAttribArray(l);
      gl.useProgram(room.program);
    },
  };
}

let session: XRSession | null = null;

/** whether a headset is drawing the room at this moment */
export function inXR(): boolean { return session !== null; }

/**
 * Whether this browser can show the room in a headset at all.
 *
 * `navigator.xr` is missing outright on plain http, which is worth knowing when
 * this page is being served to a headset from `npm run dev -- --host`:
 * `http://<lan-ip>:5175` is not a secure context, so there is no `xr` on it and
 * no button, however many headsets are in the room. The deployed site is https
 * and has one.
 */
export async function xrSupported(): Promise<boolean> {
  try {
    return (await navigator.xr?.isSessionSupported("immersive-vr")) ?? false;
  } catch {
    return false;                        // the object without a headset behind it
  }
}

/** hand the headset back, if it has been taken */
export function leaveXR(): void {
  void session?.end();
}

/**
 * Ask for the headset, and hold it until it is given back.
 *
 * Every way out of here — the visitor taking the headset off, the system menu
 * ending the session, the room never being entered because a request failed —
 * goes through the one `end` listener, so the flat page gets its loop and its
 * framebuffer back exactly once, and only if it ever lost them.
 */
export async function enterXR(room: Room): Promise<void> {
  if (session) return;
  const xr = navigator.xr;
  if (!xr) return;

  const gl = room.gl;
  const me = room.me;

  /**
   * Make sure the context is on the GPU that drives the headset.
   *
   * It was made with `xrCompatible`, so this is nearly always a formality — but
   * "nearly" is a machine with two GPUs, where the context may be on the one
   * that does not drive the headset and this is what moves it. It can cost a
   * context loss, which is why it is asked for BEFORE the session rather than
   * in the middle of one.
   *
   * A refusal is not taken as an answer. A browser with no XR device refuses
   * this outright — but a browser with no XR device said no to
   * `isSessionSupported` too, so there was no button to press and nobody is
   * here. What is left is a context that was born compatible and a formality
   * that failed, so the session is asked for regardless: if the context really
   * cannot serve a headset, the layer below is where that is found out, and the
   * page puts its button back.
   */
  await gl.makeXRCompatible().catch(() => { /* asked; the layer decides */ });

  const s = await xr.requestSession("immersive-vr", {
    // Neither is required. Without `local-floor` the room still works — the
    // floor goes under the visitor's head instead of under their feet, which is
    // a guess at their height rather than a measurement. See `floor` below.
    optionalFeatures: ["local-floor", "bounded-floor"],
  });
  session = s;

  /**
   * All of the session's state, declared before anything is awaited.
   *
   * The `end` listener is registered in the next breath, and a session can end
   * before this function has finished setting itself up — a visitor who takes
   * the headset off during the handshake. If that listener closed over bindings
   * that had not been reached yet it would throw on the one path that exists to
   * clean up after exactly that.
   */
  let entered = false;
  /** where the head was last seen, in the room's own coordinates */
  let head: [number, number, number] = [me.x, me.y, EYE_HEIGHT];
  /** and where it was last seen in the PLAY SPACE's, which is the half of it
   *  that does not change when the play space is moved or turned */
  let offset: [number, number, number] = [0, 0, 0];
  /** the flat page was standing somewhere, and the session begins there. It
   *  cannot be done now: where the HEAD lands depends on where the visitor is
   *  standing in their own room, which nothing knows until the first pose. */
  const from: [number, number] = [me.x, me.y];
  let placed = false;
  /** the last frame's timestamp, and -1 for "there has not been one" — a
   *  headset's clock is allowed to start at zero, and zero is falsy */
  let last = -1;
  let turning = false;
  let standpoint = 0;
  /** the last bearing worth having: see the look straight up, below */
  let bearing = me.yaw;
  /** how hard the stick is being pushed, 0..1, and how far the ring has closed
   *  in answer — the second chases the first rather than tracking it, which is
   *  what `VIGNETTE` times */
  let pushing = 0;
  let closed = 0;
  /** how black the view is, and the standpoint waiting for it to be black */
  let blink = 0;
  let jump: number | null = null;
  const pressed = new WeakMap<XRInputSource, boolean>();

  s.addEventListener("end", () => {
    if (session !== s) return;
    session = null;
    if (!entered) return;                // it never had the room to give back
    // the flat page resumes where the visitor was standing, at the eye height
    // it has always used, facing the way they left off
    me.x = head[0];
    me.y = head[1];
    me.z = EYE_HEIGHT;
    me.pitch = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    room.leave();
  });

  const layer = new XRWebGLLayer(s, gl, { antialias: room.antialias, framebufferScaleFactor: SCALE });
  s.updateRenderState({
    baseLayer: layer,
    // in metres, because the projection matrices the headset hands back are,
    // and the view matrix below is what brings the room into that world
    depthNear: room.clip[0] / UNITS_PER_METRE,
    depthFar: room.clip[1] / UNITS_PER_METRE,
  });

  /**
   * Feet on the floor if the headset knows where the floor is.
   *
   * With `local-floor` the reference space's y = 0 IS the floor the visitor is
   * standing on, so the play space goes on the room's floor and the headset
   * supplies the height — a tall visitor sees the room from higher up, which is
   * half of why it is worth putting in a headset at all. With plain `local`,
   * y = 0 is wherever the head happened to be when the session began, so the
   * floor has to be guessed: the play space goes at eye height instead and
   * everybody is 1.6 m tall, the way the flat page has always had it.
   */
  let space: XRReferenceSpace;
  let floor: number = ROOM.floor;   // `ROOM` is `as const`, and this one moves
  try {
    space = await s.requestReferenceSpace("local-floor");
  } catch {
    space = await s.requestReferenceSpace("local");
    floor = EYE_HEIGHT;
  }
  if (session !== s) return;             // taken off during the handshake

  me.z = floor;
  me.pitch = 0;                          // the headset owns pitch from here

  /**
   * Where a point in the play space falls in the room.
   *
   * The play space is the walker: its origin is `me`, its bearing is `me.yaw`,
   * its up is the room's up, and a metre in it is `UNITS_PER_METRE` units. The
   * three axes are WebXR's — x to the right, y up, and FORWARD IS -z — which is
   * why the z term is subtracted rather than added.
   */
  const at = (x: number, y: number, z: number): [number, number, number] => {
    const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
    return [
      me.x + UNITS_PER_METRE * (-x * sin - z * cos),
      me.y + UNITS_PER_METRE * (x * cos - z * sin),
      me.z + UNITS_PER_METRE * y,
    ];
  };

  /** where the head is at this instant, which is the last pose read through
   *  whatever the play space is doing now */
  const where = (): [number, number, number] => at(offset[0], offset[1], offset[2]);

  /**
   * Move the play space so that the HEAD ends up somewhere, rather than the
   * floor under it.
   *
   * Everything anybody asks for in a headset is about where they are, not where
   * their play space's origin is: stand where the game stood, stay inside the
   * room, turn on the spot. All three are this, with the head's own offset from
   * the origin held fixed.
   *
   * It asks `where` for the head rather than trusting the one it was last told,
   * and that is not belt and braces. `turn` changes the play space's BEARING
   * before calling this, and a head that is not sitting exactly on the origin
   * is somewhere else entirely the moment the bearing changes — so the figure
   * to correct against is the one measured after the turn, not before it. The
   * version that trusted the old figure turned the room about the origin and
   * called it turning about the visitor, which is wrong by however far they
   * were standing from the middle of their own floor.
   */
  const put = (x: number, y: number): void => {
    const now = where();
    me.x += x - now[0];
    me.y += y - now[1];
    head = where();
  };

  /** turn the room about the VISITOR — turning about the play space's origin
   *  swings a standing body through an arc it never asked for */
  const turn = (by: number): void => {
    const was = head;
    me.yaw += by;
    put(was[0], was[1]);
  };

  const stand = (i: number): void => {
    standpoint = i % STANDPOINTS.length;
    const spot = STANDPOINTS[standpoint];
    me.yaw = (2 * Math.PI * spot.deg) / 256;
    put(spot.x, spot.y);
  };

  /**
   * A tick in the hand, for the two things that happen without being asked for
   * gradually: a turn that snaps and a jump that arrives out of the dark.
   *
   * Both are comfort rather than decoration. The eye is told the room moved by
   * seeing it move; here it cannot, because the whole point of a snap is that
   * there is nothing to watch and the whole point of a blink is that it happens
   * where nobody is looking. A tap on the hand at the same instant is the other
   * sense agreeing that something was done deliberately — which is exactly what
   * the inner ear is missing and complaining about.
   *
   * Every part of this is optional in the specification and absent on plenty of
   * real controllers, so it is reached for defensively and its failure is not
   * worth a word: a session with no motors is a session, and a throw from a
   * haptic pulse must never take the frame down with it.
   */
  const buzz = ([strength, ms]: readonly [number, number]): void => {
    for (const src of s.inputSources) {
      try {
        void src.gamepad?.hapticActuators?.[0]?.pulse?.(strength, ms);
      } catch { /* no motor, or one that would rather not */ }
    }
  };

  const stick = (pad: Gamepad): [number, number] =>
    // `axes[2]` and `axes[3]` are the thumbstick under the standard mapping;
    // `axes[0]` and `axes[1]` are a touchpad, and a controller with only those
    // is old enough that its pad is the only stick it has
    pad.axes.length >= 4 ? [pad.axes[2], pad.axes[3]] : [pad.axes[0] ?? 0, pad.axes[1] ?? 0];
  const past = (v: number): number => (Math.abs(v) < DEAD ? 0 : v);

  /**
   * The controllers: one stick walks, the other turns, a button stands the
   * visitor where the game itself stood.
   *
   * Which stick is which follows the hands when there are two, and when there
   * is only one controller — or one that reports no handedness at all — that
   * one does both, because a session with half its input is better than a
   * session that cannot move.
   */
  const drive = (dt: number): void => {
    let move: Gamepad | null = null, look: Gamepad | null = null;
    for (const src of s.inputSources) {
      const pad = src.gamepad;
      if (!pad) continue;
      if (src.handedness === "right") look ??= pad;
      else move ??= pad;
    }
    move ??= look;
    look ??= move;

    pushing = 0;
    if (move) {
      const [ax, ay] = stick(move);
      // a stick reads -1 pushed away from the hand, and away is forward
      const fwd = -past(ay), side = past(ax);
      if (fwd || side) {
        // what the vignette answers: how hard, not how far — `dt` is nothing to
        // do with how provoking a glide is, and a slow frame must not open the
        // ring back up in the middle of one
        pushing = Math.min(1, Math.hypot(fwd, side));
        const step = GLIDE * UNITS_PER_METRE * dt;
        const fx = Math.cos(bearing), fy = Math.sin(bearing);
        // forward is where the visitor is LOOKING, not where the play space
        // faces: in a headset those are different for most of a session, and
        // the head is the one a person means
        me.x += (fx * fwd - fy * side) * step;
        me.y += (fy * fwd + fx * side) * step;
      }
    }
    if (look) {
      const [ax] = stick(look);
      if (!turning && Math.abs(ax) > SNAP[0]) {
        turn(Math.sign(ax) * -TURN);
        buzz(BUZZ.turn);
        turning = true;
      }
      if (turning && Math.abs(ax) < SNAP[1]) turning = false;
    }
    for (const src of s.inputSources) {
      const pad = src.gamepad;
      if (!pad) continue;
      // A or X where there is one, and the trigger on a controller too old to
      // have them: the only button this page binds, so there is nothing for it
      // to be confused with
      const down = !!(pad.buttons[4] ?? pad.buttons[0])?.pressed;
      // the press only ASKS. Where it lands is decided when the view is black,
      // below — a press during a blink already in flight is the same press
      if (down && !pressed.get(src) && jump === null && blink === 0) jump = standpoint + 1;
      pressed.set(src, down);
    }
  };

  /**
   * The play space, as a matrix, in metres.
   *
   * The page's own `view` gives world → play space in GAME UNITS. A headset's
   * projection matrix expects metres, so the whole thing is scaled on the way
   * out — every row but the last, which is what left-multiplying by a uniform
   * scale comes to.
   *
   * The scale is HERE and not on the model on purpose. The shader lights this
   * room from `aPos` in world space, against lamp positions in world space and
   * cube maps baked in world space; scaling the model would put every one of
   * those in different units from the rest. A view matrix is the one place a
   * scale can go where nothing else can see it.
   */
  const play = (): Float32Array => {
    // the play space is a camera like any other — a point and a bearing, with
    // no pitch — so it is the page's own `view`, and the two cannot disagree
    // about which way yaw points because there is only one of it
    const m = view([me.x, me.z, me.y], me.yaw, 0);
    const k = 1 / UNITS_PER_METRE;
    for (let i = 0; i < 16; i++) if (i % 4 !== 3) m[i] *= k;
    return m;
  };

  /** built on the first frame that needs it, and never on a page that has no
   *  headset in front of it */
  let ring: Vignette | null = null;

  const onFrame = (time: number, frame: XRFrame): void => {
    if (session !== s) return;
    s.requestAnimationFrame(onFrame);
    const base = s.renderState.baseLayer;
    if (!base) return;

    // Everything from here is drawn into the SESSION's framebuffer. `null` is
    // the canvas, and the canvas is not on the screen any more.
    gl.bindFramebuffer(gl.FRAMEBUFFER, base.framebuffer);
    // one clear for both eyes, over the whole framebuffer: the per-eye viewports
    // below are halves of it, and a clear inside one of them would leave the
    // other eye holding the last frame it was given
    gl.viewport(0, 0, base.framebufferWidth, base.framebufferHeight);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const pose = frame.getViewerPose(space);
    if (!pose) return;                   // tracking lost: a black frame is the honest one

    const dt = Math.min(0.05, last < 0 ? 0 : (time - last) / 1000);
    last = time;

    const p = pose.transform.position;
    offset = [p.x, p.y, p.z];
    head = where();
    if (!placed) { placed = true; put(from[0], from[1]); }

    /**
     * Which way the visitor is facing, on the floor.
     *
     * The pose's matrix is head → play space, so its third column is the head's
     * own z axis and forward is the other way. Dropping its y is not projecting
     * a pitched look onto the floor so much as ignoring the pitch: a person
     * looking at their feet and pushing the stick means forward, not down.
     *
     * Straight up or straight down, what is left of that column is rounding
     * error and its direction means nothing — so the last bearing that did mean
     * something is kept, which is the one they were facing before they looked
     * up. A room with a pitched ceiling gets looked up at.
     */
    const m = pose.transform.matrix;
    const flat = Math.hypot(m[8], m[10]);
    if (flat > 0.05) {
      const f = at(-m[8] / flat, 0, -m[10] / flat);
      bearing = Math.atan2(f[1] - me.y, f[0] - me.x);
    }

    drive(dt);

    /**
     * The room holds the HEAD in, and lets the floor go where it must.
     *
     * The flat page clamps the camera and that is the whole of it. Here the
     * camera is the visitor's own head and they can walk: clamping the play
     * space would leave them free to lean out through the window with it still
     * obediently inside the room. So the head is clamped, and the play space is
     * moved by whatever that took — the same correction, applied to the thing
     * that can actually be moved.
     *
     * Nothing clamps the head's HEIGHT. A tall visitor standing under a garret
     * ceiling is not a bug, and ducking is theirs to do.
     */
    head = where();                      // `drive` has moved the play space under it
    const [cx, cy] = room.inside(head[0], head[1]);
    if (cx !== head[0] || cy !== head[1]) put(cx, cy);

    /**
     * The blink, and the jump that happens inside it.
     *
     * Down, then the move, then up — and the move is here rather than in
     * `drive` because "when the view is black" is a fact about this ramp and
     * nothing to do with which button was pressed. `stand` is the same call the
     * press used to make directly; all that has changed is that nobody sees it.
     */
    if (jump !== null) {
      blink = Math.min(1, blink + dt / BLINK.out);
      if (blink >= 1) { stand(jump); jump = null; buzz(BUZZ.stand); head = where(); }
    } else if (blink > 0) {
      blink = Math.max(0, blink - dt / BLINK.in);
    }

    // the ring chases the stick: quickly shut, slowly open — see `VIGNETTE`.
    // `min(1, …)` is what keeps a long frame landing ON the target rather than
    // past it and swinging back.
    const rate = pushing > closed ? VIGNETTE.close : VIGNETTE.open;
    closed += (pushing - closed) * Math.min(1, dt / rate);
    const aperture = APERTURE.open + (APERTURE.shut - APERTURE.open) * closed;

    const world = play();
    for (const view of pose.views) {
      const vp = base.getViewport(view);
      if (!vp) continue;
      gl.viewport(vp.x, vp.y, vp.width, vp.height);
      const eye = view.transform.position;
      const where = at(eye.x, eye.y, eye.z);
      room.draw(
        view.projectionMatrix,
        mul(view.transform.inverse.matrix, world),
        // the shader wants the eye in the room's own frame — world (x,y,z) to
        // GL (x,z,y) — and it is a different point for each eye: this is what
        // the speculars are measured from, and both eyes given one position is
        // a highlight sitting at the wrong depth in one of them
        [where[0], where[2], where[1]],
        time / 1000,
      );
      // and the comfort over the top of it, in this eye's own viewport and
      // with this eye's own axis. Skipped outright when there is nothing to
      // draw: a fully open ring over a still room is a screen of transparent
      // black, paid for at every pixel of both eyes.
      if (blink > 0 || closed > 0.001) {
        ring ??= makeVignette(gl, room);
        ring.draw(view.projectionMatrix, aperture, blink);
      }
    }
  };

  entered = true;
  room.enter(layer.framebuffer);
  s.requestAnimationFrame(onFrame);
}

/** a × b, both column-major, as everything in GL is */
function mul(a: Float32Array, b: Float32Array): Float32Array {
  const m = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      m[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return m;
}
