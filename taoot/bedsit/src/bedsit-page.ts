/**
 * Walking around {@link file://./bedsit-room.ts}, in the game's own pixels.
 *
 * A small WebGL viewer and nothing else: the room's triangles, a first-person
 * camera whose optics are the game's own — the SET renders at 512×264 with a
 * focal length of 256, which is 90° across and 54.7° up and down — and, if the
 * rip is there, the surfaces painted by projecting BEDSIT1's own frames back
 * onto the model they were rendered from ({@link file://./bedsit-skin.ts}).
 *
 * With no rip it is plaster and three lamps, which is still the room's shape.
 * With one it is the room.
 *
 * No engine session, no GPU library. The page is the model, a bake and a shader.
 */
import { siteUrl } from "@dreamfactory/site/site";
import {
  buildRoom, ceilingAt, chartOf, doorPiece, EYE_HEIGHT, MaterialId, Part, PENDANT, pendantFitting,
  pendantPiece, ROOM, STANDPOINTS, SurfaceId, UNITS_PER_METRE, WINDOW, WINDOWS,
} from "./bedsit-room";
import { BAKED, BAKED_IDS } from "./bedsit-baked";
import { type Painted, paintRoom, paintSurface, useToothPhoto } from "./bedsit-paint";
import {
  DESK, DESK_LAMP, furnish, MATERIALS, standardLampHead, STANDARD_LAMP,
} from "./bedsit-furniture";
import { CHIMNEYS, WIND } from "./bedsit-chimneys";

/**
 * The tonemap: the last thing that happens to every LIT pixel, and the reason
 * the windows needed calibrating against the street.
 *
 * 1/1.6 matched the frames' own numbers and felt shut; 1/1.85 opens the darks,
 * where nearly everything in this room lives, and leaves the lamps' own pools
 * where they were, since a value already near 1 hardly moves under it.
 *
 * It is a named constant because TWO places have to agree on it: the shader
 * that applies it, and `applyLights`, which has to undo it for the two window
 * lamps. A literal in each was a number waiting to drift.
 */
const TONEMAP = 1.85;

const VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec3 aColour;
attribute vec2 aUV;
attribute float aUnlit;
uniform mat4 uProj;
uniform mat4 uView;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vColour;
varying vec2 vUV;
varying float vUnlit;
void main() {
  vPos = aPos;
  vNormal = aNormal;
  vColour = aColour;
  vUV = aUV;
  vUnlit = aUnlit;
  gl_Position = uProj * uView * vec4(aPos, 1.0);
}`;

/**
 * Two ways to be a surface.
 *
 * A **textured** one is already lit: the pixels came out of a rendering of this
 * room with its lamp on, so the only thing left to do to them is an exposure,
 * because a 1996 night interior on a modern display is very dark indeed.
 *
 * An **untextured** one gets four lights, because the room has four: the
 * pendant over the middle of the floor, the standard lamp by the fireplace, and
 * the two windows, which at this hour hold a sun barely off the roofs opposite.
 * There are no shadows and no bounce, and a garret
 * at this hour is mostly bounce, so the ambient is generous — and it is not the same
 * in every direction. A pendant shade is open at the top and throws half its
 * light at the ceiling, and a whitewashed room throws the rest back up off the
 * walls, so in the frames the ceiling is as bright as the walls. A surface facing
 * down gets that as extra ambient; the floor and the walls get none of it.
 */
const FRAG = `
precision mediump float;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vColour;
varying vec2 vUV;
varying float vUnlit;
uniform vec3 uEye;
uniform sampler2D uTex;
uniform float uTextured;
uniform float uLit;
uniform float uExposure;
/** how much of the ambient and the up-throw to use: the fill slider */
uniform float uFill;
uniform vec2 uUVScale;
uniform vec2 uUVOffset;
const int LAMPS = 5;
uniform vec3 uLampAt[LAMPS];
uniform vec3 uLampTint[LAMPS];
uniform float uLampReach[LAMPS];
/**
 * How bright each lamp's OWN GLASS is, which is the dimmer's other half.
 *
 * A lamp in this room is two things: a point that throws light at everything
 * else, and a piece of glass or paper that is itself alight — the pendant's
 * four wings, the standard lamp's shade, the crown on the desk lamp. The first
 * has always followed the slider. The second did not: it was drawn emissive at
 * full strength whatever the slider said, so turning the desk lamp off left a
 * white-hot cap glowing over a dark desk.
 */
uniform float uEmit[LAMPS];
/**
 * The sash, for the two lamps that stand outside the windows: the glass plane,
 * each light's centre and half-width along the room, and the shape of the sash
 * in it — the rail's top, the springing, the mullion's half-width, the bars'
 * half-thickness and where the three bars are.
 *
 * There is no shadow map here and there does not need to be: a window is an
 * analytic shape, so the shadow of one is a question with an answer. For a
 * fragment and one of those lamps, find where the segment between them crosses
 * the glass plane and ask whether that point is in the daylight — inside the
 * arch, off the mullion, off the three bars. If it is not, the fragment is in
 * the sash's shadow.
 */
uniform float uGlassX;
uniform vec2 uWindow[2];
/**
 * How opaque what is being drawn is. 1 for everything in this room but one
 * thing: the schnapps bottle's glass, which is drawn in a second pass with
 * blending on -- see the two-pass note in the draw loop.
 */
uniform float uAlpha;
uniform vec4 uSash;
uniform vec3 uBars;
/**
 * The shadows, as cubes of distance around two of the three bulbs.
 *
 * The windows above are an analytic shape and need no map. A lamp in the middle
 * of a room is not: what stands in front of it is the room, so the only way to
 * answer "is this fragment lit" is to have looked from the bulb first.
 *
 * CUBES because a bulb throws in every direction, and baked ONCE because
 * nothing that casts here ever moves and neither do the lamps — the sliders
 * change how bright a lamp is, not where it is. So the whole cost is paid at
 * load, and per frame these lookups are the only thing added.
 *
 *
 * Each config is (far, texel, floor): how far that cube reaches, the angular
 * width of one of its texels, and the flat floor under its bias.
 */
uniform samplerCube uMapPendant;
uniform samplerCube uMapStandard;
uniform samplerCube uMapDesk;
uniform vec3 uShadowPendant;
uniform vec3 uShadowStandard;
uniform vec3 uShadowDesk;
uniform float uShadowOn;
/**
 * How many of the five taps to take: 5 for a soft edge, 1 for a hard one.
 *
 * This is the performance dial, and it is a uniform rather than a constant
 * because it is the viewer's machine that decides. Every fragment does this
 * work once per shadowed lamp, so at 1080p three lamps at five taps is thirty
 * million cube-map fetches a frame — nothing at all for a discrete card, and
 * far too much for the twelve execution units of an Intel UHD 600. Dropping to
 * one tap is three times fewer, at the price of a stair-stepped edge.
 */
uniform float uShadowTaps;

float throughSash(vec3 at, vec3 lamp, vec2 win) {
  float span = lamp.x - at.x;
  if (abs(span) < 1.0) return 1.0;
  float t = (uGlassX - at.x) / span;
  if (t <= 0.0 || t >= 1.0) return 1.0;           // the glass is not between them
  vec3 q = at + (lamp - at) * t;
  float d = abs(q.z - win.x);
  // The edge is not a cut: an overcast sky is a wide source, so every edge of
  // the sash has a penumbra, and it widens with the throw — near enough sharp
  // on the reveal beside the glass, soft by the far wall. This is that, measured
  // in the glass plane: how far inside each edge the crossing point falls, taken
  // as a smooth step rather than a yes or no.
  //
  // Kept SMALL on purpose. The honest penumbra for a sky that fills the window
  // is hundreds of units wide by the far wall, and a bar is thirty-two wide, so
  // the true answer is that the bars' shadows do not survive the crossing at
  // all — which is physics, and which erases the thing the shadows were put in
  // for. This is the width at which they stay legible.
  float soft = 18.0 + 0.010 * max(0.0, at.x - uGlassX);
  float head = uSash.y + sqrt(max(0.0, win.y * win.y - d * d));
  float v = smoothstep(0.0, soft, win.y - d);         // inside the light
  v *= smoothstep(0.0, soft, q.y - uSash.x);          // over the rail
  v *= smoothstep(0.0, soft, head - q.y);             // under the arch
  v *= smoothstep(0.0, soft, d - uSash.z);            // off the mullion
  v *= smoothstep(0.0, soft, abs(q.y - uBars.x) - uSash.w);  // and off the bars
  v *= smoothstep(0.0, soft, abs(q.y - uBars.y) - uSash.w);
  v *= smoothstep(0.0, soft, abs(q.y - uBars.z) - uSash.w);
  return v;
}

// the lamp's own data, not its index: GLSL ES will not index an array with a
// function's parameter, only with a constant or a loop's own symbol
/** the 0..1 distance the bake wrote, out of the four bytes it wrote it in */
float unpackUnit(vec4 c) {
  return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0));
}

/**
 * How much of a lamp reaches a point: 1 lit, 0 in shadow.
 *
 * The awkward part of this room is that it draws with no face culling and flips
 * every normal towards the eye, because nothing here is reliably wound and
 * several things — a lampshade, the counterpane, the hall stand's tubes — are
 * genuinely open surfaces with no inside. The usual cure for shadow acne is to
 * cull one side of the caster, and that cure is not available.
 *
 * So the bias is a NORMAL OFFSET instead: the point is stepped off its own
 * surface before it asks. A surface moved clear of itself cannot shadow itself,
 * whichever way it happens to be facing.
 *
 * Five taps, not one. Four of them are swung a texel off the centre in the two
 * directions across the ray, which costs four more samples of a texture already
 * in cache and turns a hard stair-stepped edge into one about a centimetre
 * wide — which is what the edge of a shadow from a finger-wide filament looks
 * like anyway.
 */
float shadowOf(samplerCube map, vec3 lamp, vec3 at, vec3 n, vec3 cfg) {
  if (uShadowOn < 0.5) return 1.0;
  vec3 d = at - lamp;
  float dist = length(d);
  if (dist >= cfg.x) return 1.0;
  vec3 ray = d / dist;
  // across the ray: any two directions will do, so long as they are not it
  vec3 ax = abs(ray.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 u = normalize(cross(ray, ax));
  vec3 v = cross(ray, u);
  // A texel of the cube is 2/size across in angle, so it covers this much of
  // the world here. Everything below is measured in it.
  float texel = cfg.y * dist;
  /**
   * The bias grows with the INCIDENCE, and by the TANGENT of it.
   *
   * One texel covers "texel" across the surface. On a surface tilted away from
   * the light, that same texel also covers texel * tan(incidence) of DEPTH,
   * and the map holds one distance for the lot — so a surface lying at an angle
   * is compared against a number taken from somewhere else on itself, and under
   * too small a bias it reads as its own shadow. That is the whole of what put
   * a dark ring round the desk lamp: not a caster, but the desk top going
   * grazing about a metre out, where one texel of depth passed the flat bias
   * this used to have.
   *
   * So the point is stepped off its surface by a texel plus that tangent, and
   * the limit gives away the same again. Clamped at 0.15 because a surface
   * exactly edge-on to a light has an infinite tangent and takes no light
   * anyway, so what it is compared against stops mattering.
   */
  float face = abs(dot(n, ray));
  float tang = sqrt(max(0.0, 1.0 - face * face)) / max(face, 0.15);
  vec3 p = at + n * (texel * (1.0 + tang));
  float lim = length(p - lamp) - cfg.z - texel * tang;
  float lit = 0.0;
  float taken = 0.0;
  for (int i = 0; i < 5; i++) {
    if (float(i) >= uShadowTaps) break;
    vec3 off = vec3(0.0);
    if (i == 1) off = u * texel;
    if (i == 2) off = -u * texel;
    if (i == 3) off = v * texel;
    if (i == 4) off = -v * texel;
    vec3 dir = p + off - lamp;
    float stored = unpackUnit(textureCube(map, dir)) * cfg.x;
    lit += lim <= stored ? 1.0 : 0.0;
    taken += 1.0;
  }
  return lit / taken;
}

vec3 lampAt(vec3 albedo, vec3 n, vec3 at, vec3 lamp, vec3 tint, float reach) {
  vec3 d = lamp - at;
  float dist = length(d);
  float k = dist / reach;
  return albedo * tint * max(dot(n, d / dist), 0.0) / (1.0 + k * k);
}
void main() {
  vec3 albedo = vColour;
  if (uTextured > 0.5) {
    vec3 tex = texture2D(uTex, vUV * uUVScale + uUVOffset).rgb;
    // a projected surface arrived with the room's own lamp already on it
    if (uLit < 0.5) { gl_FragColor = vec4(tex * uExposure, 1.0); return; }
    albedo = clamp(tex * uExposure, 0.0, 1.0);
  }
  /**
   * vUnlit is 0 for an ordinary surface, 1 for something emissive that
   * belongs to no lamp — a backdrop — and 2 + i for something emissive that is
   * LAMP i's own glass. A tied one fades with its lamp, and what it fades to is
   * not black: it is the same surface lit like any other, because a shade with
   * the bulb out is still a piece of parchment in a room with two other lamps
   * in it. So the emissive colour and the lit one are both worked out and mixed.
   */
  float emit = 0.0;
  if (vUnlit > 0.5) {
    emit = 1.0;
    for (int i = 0; i < LAMPS; i++) {
      if (abs(vUnlit - 2.0 - float(i)) < 0.5) emit = uEmit[i];
    }
    if (emit > 0.999) { gl_FragColor = vec4(albedo, 1.0); return; }
  }
  vec3 n = normalize(vNormal);
  if (dot(n, uEye - vPos) < 0.0) n = -n;          // two-sided: no wall has a back
  vec3 lit = albedo * vec3(0.023, 0.025, 0.031) * uFill;  // ambient: the morning sky, bounced round the room
  lit += albedo * max(-n.y, 0.0) * vec3(0.052, 0.055, 0.052) * uFill; // the shade's up-throw, on the ceiling
  // the three lamps in the room. The desk lamp is the one that has been asked
  // what stands in front of it; the other two still light through everything.
  /**
   * A LAMP THAT CONTRIBUTES NOTHING IS NOT ASKED WHAT IS IN FRONT OF IT.
   *
   * lampAt ends in max(dot(n, towards the lamp), 0), so a surface facing away
   * from a lamp gets EXACTLY zero from it — not nearly zero. Multiplying that
   * zero by a shadow lookup, or by seven smoothsteps of window sash, gives zero
   * either way, and this room spends both on every fragment whether or not the
   * lamp is behind it. In a room, at any moment, about half of every wall faces
   * away from any given lamp.
   *
   * The test is for greater than zero, and that matters: it is an EXACT zero,
   * not a threshold.
   * A threshold would put a seam in the picture wherever it fell — which is the
   * mistake the shadow map's far plane made, drawing a curved edge across the
   * ceiling where a sphere of 4,000 cut it. Nothing is skipped here that would
   * have changed a pixel.
   */
  vec3 l0 = lampAt(albedo, n, vPos, uLampAt[0], uLampTint[0], uLampReach[0]);
  if (l0.r + l0.g + l0.b > 0.0) l0 *= shadowOf(uMapPendant, uLampAt[0], vPos, n, uShadowPendant);
  lit += l0;
  vec3 l1 = lampAt(albedo, n, vPos, uLampAt[1], uLampTint[1], uLampReach[1]);
  if (l1.r + l1.g + l1.b > 0.0) l1 *= shadowOf(uMapStandard, uLampAt[1], vPos, n, uShadowStandard);
  lit += l1;
  vec3 l2 = lampAt(albedo, n, vPos, uLampAt[2], uLampTint[2], uLampReach[2]);
  if (l2.r + l2.g + l2.b > 0.0) l2 *= shadowOf(uMapDesk, uLampAt[2], vPos, n, uShadowDesk);
  lit += l2;
  // and the two outside, each through its own sash
  vec3 s0 = lampAt(albedo, n, vPos, uLampAt[3], uLampTint[3], uLampReach[3]);
  if (s0.r + s0.g + s0.b > 0.0) s0 *= throughSash(vPos, uLampAt[3], uWindow[0]);
  lit += s0;
  vec3 s1 = lampAt(albedo, n, vPos, uLampAt[4], uLampTint[4], uLampReach[4]);
  if (s1.r + s1.g + s1.b > 0.0) s1 *= throughSash(vPos, uLampAt[4], uWindow[1]);
  lit += s1;
  // The last step is a gamma, and it is the one that decides whether a dim room
  // reads as a morning or as a fault. 1/1.6 matched the frames' own numbers and
  // felt shut; 1/1.85 opens the darks — where nearly everything in this room
  // lives — and leaves the lamps' own pools where they were, since a value
  // already near 1 hardly moves under it.
  /**
   * uShadowOn 2, 3 and 4 show a cube itself — the pendant's, the standard
   * lamp's, the desk lamp's.
   * GREEN where the cube agrees with the fragment's own distance, which is what
   * a surface the bulb can see looks like; RED where the cube says something
   * nearer; BLUE where it says something further, which happens over a lamp
   * that has been excluded from its own map.
   *
   * It stays in because it earned its place: a shadow that looks wrong is
   * either a wrong map or a wrong comparison, and only this says which. It
   * found the bulb casting on itself, and it found the acne that read as a ring
   * round the desk lamp.
   */
  if (uShadowOn > 1.5) {
    int which = uShadowOn > 3.5 ? 2 : (uShadowOn > 2.5 ? 1 : 0);
    vec3 lamp = which == 2 ? uLampAt[2] : (which == 1 ? uLampAt[1] : uLampAt[0]);
    vec3 cfg = which == 2 ? uShadowDesk : (which == 1 ? uShadowStandard : uShadowPendant);
    vec3 dd = vPos - lamp;
    float far = cfg.x;
    vec4 texel4 = which == 2 ? textureCube(uMapDesk, dd)
                : (which == 1 ? textureCube(uMapStandard, dd) : textureCube(uMapPendant, dd));
    float stored = unpackUnit(texel4) * far;
    float diff = stored - length(dd);
    gl_FragColor = vec4(clamp(-diff / 200.0, 0.0, 1.0), 1.0 - clamp(abs(diff) / 200.0, 0.0, 1.0),
                        clamp(diff / 200.0, 0.0, 1.0), 1.0);
    return;
  }
  vec3 shown = pow(clamp(lit, 0.0, 1.0), vec3(1.0 / ${TONEMAP}));
  gl_FragColor = vec4(mix(shown, albedo, emit), uAlpha);
}`;

/**
 * The bake: what the bulb can see, written as distance.
 *
 * Only the position attribute is read. A shadow map does not care what colour
 * a thing is or which way it faces — it cares where it is — and the fewer
 * attributes it names the fewer of the main program's arrays have to be taken
 * down and put back around it.
 */
const SHADOW_VERT = `
attribute vec3 aPos;
attribute float aUnlit;
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uFrom;
varying vec3 vRay;
varying float vUnlit;
void main() {
  vRay = aPos - uFrom;
  vUnlit = aUnlit;
  gl_Position = uProj * uView * vec4(aPos, 1.0);
}`;

/**
 * RADIAL distance, not the depth buffer's.
 *
 * A cube's six faces each have their own frustum, so the depth a face records
 * is along that face's own axis and jumps at every seam. The distance from the
 * bulb does not: it is the same number whichever face happens to hold it, so
 * the comparison in the main shader is one subtraction and needs to know
 * nothing about which face it landed on.
 *
 * Written into four bytes because WebGL1 has no cube depth texture —
 * WEBGL_depth_texture covers TEXTURE_2D and stops there — and packing into
 * the colour channels of an ordinary RGBA cube works everywhere, with no
 * extension at all. highp where the browser has it: the packing is 32 bits
 * and mediump carries ten.
 */
const SHADOW_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vRay;
varying float vUnlit;
uniform float uFar;
uniform vec3 uSelf;
uniform vec3 uStem;
vec4 packUnit(float v) {
  vec4 enc = fract(vec4(1.0, 255.0, 65025.0, 16581375.0) * v);
  return enc - enc.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
}
void main() {
  /**
   * A LAMP DOES NOT CAST ITS OWN SHADOW. Nothing inside the fitting's own
   * column of space is written: within uSelf.x of its axis, between uSelf.y
   * and uSelf.z of the bulb.
   *
   * Two reasons, and the first is that without it there is no shadow map at
   * all. The bulb is a sphere of radius 52 whose centre IS the point the shader
   * lights from, so the first thing the bake saw in every direction was the
   * bulb itself, and the whole room came back in shadow.
   *
   * Discarding what is EMISSIVE deals with the bulb and the glowing cap and
   * does not deal with the shade, which is ordinary lit geometry and a closed
   * cone around the bulb. Physically that shade should throw everything
   * sideways into darkness — and it did, which put out the glow on the wall
   * behind the lamp that the game's own frames show as the brightest thing in
   * that corner after the windows. This room is measured against those frames,
   * so the fitting is excluded as a body.
   *
   * A COLUMN and not a sphere, because the fitting is not ball-shaped and a
   * sphere cannot contain it without swallowing the desk: the brim is 410 from
   * the bulb but the foot is 612, and the desk top the lamp stands on is 580.
   * A sphere wide enough for the foot stops the desk top casting, and the light
   * then leaks through the desk onto the floor beneath it. The column is the
   * shape the lamp actually occupies — 420 about its axis, from just above the
   * desk to just over the cap — and nothing can be inside it without being
   * inside the lampshade.
   */
  float out2 = length(vRay.xz);
  if (out2 < uSelf.x && vRay.y > uSelf.y && vRay.y < uSelf.z) discard;
  /**
   * And a SECOND, narrower column for the stem under it, where a lamp has one.
   *
   * A standard lamp is not one shape: a shade 518 wide over a pole 19 thick,
   * with turned knops swelling to 97 halfway down. One column wide enough for
   * the shade would have to run the whole height, and at 538 it would reach the
   * armchair beside it, whose nearest corner is 362 from the lamp's axis — so
   * the chair would stop casting from the very lamp that lights it.
   *
   * What was left casting instead was the knops, and a knop 97 across at 1,500
   * throws a disc 45 cm wide on the floor from a bulb 2,650 up. That is the
   * round shadow the lamp was putting under itself. 160 clears the knops with
   * room to spare and stays nowhere near the chair.
   *
   * uStem.x is 0 for a lamp that has no stem to speak of — the pendant hangs
   * from the plaster, and the desk lamp is short enough that one column holds
   * all of it.
   */
  if (uStem.x > 0.0 && out2 < uStem.x && vRay.y > uStem.y && vRay.y < uStem.z) discard;
  /**
   * ONLY ITS OWN. A lamp is excluded from ITS OWN map and from no other, so the
   * standard lamp's shade casts nothing from the standard lamp and casts
   * normally from the pendant and the desk lamp.
   *
   * This was briefly a blanket rule instead — nothing emissive cast into any
   * map — which killed a black disc two and a half metres across that the
   * standard lamp's shade was throwing over the armchair from the pendant
   * above. It also stopped every shade casting from every other lamp, which is
   * more than was wanted: a shade IS an obstacle to a light that is not inside
   * it. The column above is per-lamp and does the narrower job.
   */
  gl_FragColor = packUnit(clamp(length(vRay) / uFar, 0.0, 1.0));
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader");
  return sh;
}

function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) / (near - far); m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/**
 * The world→camera matrix for an eye looking along `fwd` with `up` overhead.
 *
 * `view` below cannot do this job: it names a direction by yaw and pitch, and
 * two of a cube's six faces are straight up and straight down, where yaw stops
 * meaning anything and the up vector it derives collapses to zero.
 */
function lookAlong(eye: readonly number[], fwd: readonly number[], up: readonly number[]): Float32Array {
  const cross = (a: readonly number[], b: readonly number[]): number[] =>
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const r = cross(fwd, up), rl = Math.hypot(r[0], r[1], r[2]) || 1;
  const x = [r[0] / rl, r[1] / rl, r[2] / rl];
  const y = cross(x, fwd);
  const m = new Float32Array(16);
  m[0] = x[0]; m[4] = x[1]; m[8] = x[2]; m[12] = -dot(x, eye);
  m[1] = y[0]; m[5] = y[1]; m[9] = y[2]; m[13] = -dot(y, eye);
  m[2] = -fwd[0]; m[6] = -fwd[1]; m[10] = -fwd[2]; m[14] = dot(fwd, eye);
  m[15] = 1;
  return m;
}

/** the world→camera matrix for an eye in GL space looking along `yaw`/`pitch`.
 *  Bearing is the game's: 0 is +x, and +y is on the right. */
function view(eye: [number, number, number], yaw: number, pitch: number): Float32Array {
  const cp = Math.cos(pitch);
  const f: [number, number, number] = [Math.cos(yaw) * cp, Math.sin(pitch), Math.sin(yaw) * cp];
  const r: [number, number, number] = [-Math.sin(yaw), 0, Math.cos(yaw)];
  const u: [number, number, number] = [
    r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0],
  ];
  const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const m = new Float32Array(16);
  m[0] = r[0]; m[4] = r[1]; m[8] = r[2]; m[12] = -dot(r, eye);
  m[1] = u[0]; m[5] = u[1]; m[9] = u[2]; m[13] = -dot(u, eye);
  m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2]; m[14] = dot(f, eye);
  m[15] = 1;
  return m;
}

// ---------------------------------------------------------------------------

const canvas = document.getElementById("gl") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLElement;
const splash = document.getElementById("splash") as HTMLElement;
const loadButton = document.getElementById("load") as HTMLButtonElement;
const note = document.getElementById("note") as HTMLElement;
/**
 * Multisampling, and why it is the one setting here that survives a reload.
 *
 * Every other control on this page can be changed between frames. This one
 * cannot: whether a WebGL context multisamples is decided when the context is
 * MADE, once, and there is no asking for it again afterwards. So the choice has
 * to outlive the page that acts on it, which means remembering it and reading
 * it back before the context exists.
 *
 * It is worth the trouble on a weak machine. Multisampling renders the whole
 * frame several times over into a larger buffer and resolves it down, and what
 * that spends is memory BANDWIDTH — which is exactly what an integrated part
 * sharing system memory with the CPU has least of. On a discrete card it is
 * nearly free and the edges are much better for it, so it stays the default.
 *
 * `localStorage` throws outright in a private window rather than returning
 * nothing, so the read is guarded and a failure means the default.
 */
const AA_KEY = "bedsit.aa";
function remembered(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
const wantAA = remembered(AA_KEY) !== "0";
const context = canvas.getContext("webgl", { antialias: wantAA, alpha: false });
if (!context) throw new Error("this browser has no WebGL");
const gl: WebGLRenderingContext = context;

const prog = gl.createProgram()!;
gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
gl.useProgram(prog);

const ATTRS = [
  ["aPos", "position", 3], ["aNormal", "normal", 3], ["aColour", "colour", 3],
  ["aUV", "uv", 2], ["aUnlit", "unlit", 1],
] as const;

/** a texture, and how far its UVs have to be stretched and shifted to cover
 *  the chart — a tile repeats across it, a photograph sits within it */
interface Skin {
  texture: WebGLTexture;
  scale: [number, number];
  offset?: [number, number];
  /**
   * The texture's pixels came out of the game's frames, and those are a 1996
   * night interior: they want the exposure to read as a material. A painted
   * material is already its own colour, and the exposure keys only nudge it.
   */
  fromFrames: boolean;
}

/**
 * One part of the shell, with its vertex buffers and up to three ways to be
 * painted: the materials written down in bedsit-paint.ts, which need no rip;
 * a tile of a material cut out of one frame, which is what the furniture wears;
 * and the frames projected onto the surface where they fall, which is how the
 * poster, the photograph and the picture over the mantel are painted, since
 * those are pictures and nothing but the frames' own pixels will do.
 */
interface Drawable {
  /** which piece of furniture this is, or null for the measured shell */
  piece: string | null;
  surface: SurfaceId | MaterialId | null;
  count: number;
  buffers: WebGLBuffer[];
  painted: Skin | null;
  projected: Skin | null;
  tiled: Skin | null;
}

/**
 * The shell and the furniture, kept apart from here on.
 *
 * `buildRoom` gives the plaster, the boards, the windows and the door — the
 * part of this room that was MEASURED off the frames. `furnish` gives what
 * stands in it. They are drawn together and they are not the same claim, so
 * being able to strip one off and look at the other is worth having on its own,
 * before any question of what it costs: the shell is what a SET frame can be
 * held up against, and the furniture is what gets in the way of doing it.
 */
const parts: Drawable[] = [...buildRoom(), ...pendantPiece(), ...doorPiece(), ...furnish()].map((part: Part) => ({
  piece: part.piece ?? null,
  surface: part.surface,
  count: part.mesh.count,
  painted: null,
  projected: null,
  tiled: null,
  buffers: ATTRS.map(([, field]) => {
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, part.mesh[field], gl.STATIC_DRAW);
    return buf;
  }),
}));
/**
 * The pieces that have been taken OUT of the room, by name.
 *
 * A set of what is absent rather than a list of what is present, so the room
 * comes up furnished without anything having to say so, and a piece added to
 * {@link FURNITURE} later needs no entry here to appear.
 */
const out = new Set<string>();

/** whether the chimneys are alight — see the smoke control */
let smokeOn = true;

/** how many triangles the room came out as — the cheapest honest answer to
 *  "is this tab running the current model, or one from an hour ago?", since a
 *  phone has no console to ask a better question with */
const TRIANGLES = parts.reduce((n, p) => n + p.count, 0) / 3;

/**
 * The desk lamp's shadow cube, baked once.
 *
 * 512 a face. At the desk top, a metre from the bulb, that is a texel four
 * units across — two and a half millimetres, finer than the 2.7 the wall charts
 * are painted at — so the edge of the pool is limited by the five-tap blur and
 * not by the map. Six faces of RGBA8 is six megabytes, and there is no seventh
 * cost: the room does not move, the lamp does not move, so this runs at load
 * and never again.
 *
 * The far plane is 4,000 where the room's diagonal from this bulb is near
 * 10,000. Anything past it is reported lit, which is right rather than merely
 * cheap: this lamp's falloff has it at three per cent there, and a shadow in
 * three per cent of one lamp is not a shadow. What the short range buys is
 * precision, in a fragment shader that is mediump.
 */
/**
 * A lamp with a shadow, and everything the bake needs to know about it.
 *
 * `size` is a face of its cube. `self` is the lamp's OWN body, as a column
 * about its axis measured from the bulb — how far out, from what height to what
 * height — because a lamp that casts into its own map blacks out the room.
 *
 * FAR IS THE WHOLE ROOM from that bulb, and it has to be. The desk lamp's was
 * 4,000 at first, on the argument that it is down to three per cent of itself
 * by then so there is nothing left worth shadowing. That confused how much
 * light a surface GETS with whether it is BLOCKED. Past the far plane the
 * shader reports lit, so the dormer pier's shadow across the ceiling stopped in
 * mid-air at 4,000 and the plaster beyond it came back — a bright patch with a
 * curved edge, which is a sphere of radius 4,000 seen where it cuts the
 * ceiling. A map that does not reach the far corner has a seam in it, wherever
 * the falloff happens to be by then.
 */
interface Lamp {
  at: [number, number, number];
  size: number;
  /** the lamp's head: how far out, and from what height to what height */
  self: [number, number, number];
  /** the narrower column under it, where the lamp has a stem worth excluding */
  stem?: [number, number, number];
}

/** the room's far corner from a bulb, rounded up: how far its cube must reach */
function roomCorner(x: number, y: number, z: number): number {
  return Math.ceil(Math.hypot(
    Math.max(x - ROOM.x0, ROOM.x1 - x),
    Math.max(y - ROOM.y0, ROOM.y1 - y),
    Math.max(z, ROOM.ceiling - z),
  ) / 100) * 100;
}

const FIT = pendantFitting();
const HEAD = standardLampHead();
/**
 * The two lamps that cast, in GL order (x, up, y).
 *
 * The PENDANT is 1024 a face where the desk lamp is 512, because it has to
 * cover the whole room from the ceiling: at the far corner its texel is 11 mm
 * against the desk lamp's 2.5 mm over the desk it actually lights.
 *
 * Its fitting is excluded like the desk lamp's. That is a CHOICE and not
 * physics — a closed shade over a bulb really would throw the ceiling above it
 * into darkness — but the ceiling over the pendant already has the soot mark
 * drawn on it, and two darkenings of the same patch is one too many.
 *
 * Its light point comes from the fitting itself rather than from a number
 * written beside it. It used to be written down, as 3,900, which was where the
 * DRAWN pendant's bulb sat — and this fitting hangs at 4,280 to 4,940, so the
 * light was 380 below the bottom of the lamp it belongs to. A point light does
 * not care whether it is inside its own shade, so nothing complained until the
 * shadow map made the mistake visible.
 */
const LAMPS: Lamp[] = [
  {
    at: [PENDANT.x, FIT.bulb, PENDANT.y],
    size: 1024,
    self: [FIT.radius + 20, FIT.z0 - FIT.bulb - 20, FIT.z1 - FIT.bulb + 20],
  },
  {
    at: [STANDARD_LAMP.x, STANDARD_LAMP.bulb, STANDARD_LAMP.y],
    size: 512,
    self: [HEAD.radius, HEAD.z0 - STANDARD_LAMP.bulb, HEAD.z1 - STANDARD_LAMP.bulb],
    // and its pole all the way down, narrow enough to leave the armchair beside
    // it casting — see the note in the bake's own shader
    stem: [160, -STANDARD_LAMP.bulb - 100, HEAD.z0 - STANDARD_LAMP.bulb],
  },
  {
    at: [DESK_LAMP.x, DESK_LAMP.bulb, DESK_LAMP.y],
    size: 512,
    // the desk is what the lamp stands on and must go on casting; its foot
    // rests on that desk and must not, so the column starts six units above it
    self: [
      DESK_LAMP.brim.r + 15,
      DESK.top - DESK_LAMP.bulb + 6,
      DESK_LAMP.cap - DESK_LAMP.bulb + 12,
    ],
  },
];

/** which of a part's buffers holds `unlit`, found by name rather than counted:
 *  the bake needs it to know what is a light and what is a thing */
const UNLIT_ATTR = ATTRS.findIndex(([name]) => name === "aUnlit");

const shadowProg = gl.createProgram()!;
gl.attachShader(shadowProg, compile(gl, gl.VERTEX_SHADER, SHADOW_VERT));
gl.attachShader(shadowProg, compile(gl, gl.FRAGMENT_SHADER, SHADOW_FRAG));
gl.linkProgram(shadowProg);
if (!gl.getProgramParameter(shadowProg, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(shadowProg) ?? "shadow link");

/** the six faces, each as the way the camera looks and which way is up in it —
 *  the cube map's own convention, which is left-handed and upside down */
const FACES = [
  [gl.TEXTURE_CUBE_MAP_POSITIVE_X, [1, 0, 0], [0, -1, 0]],
  [gl.TEXTURE_CUBE_MAP_NEGATIVE_X, [-1, 0, 0], [0, -1, 0]],
  [gl.TEXTURE_CUBE_MAP_POSITIVE_Y, [0, 1, 0], [0, 0, 1]],
  [gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, [0, -1, 0], [0, 0, -1]],
  [gl.TEXTURE_CUBE_MAP_POSITIVE_Z, [0, 0, 1], [0, -1, 0]],
  [gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, [0, 0, -1], [0, -1, 0]],
] as const;

function bakeShadow(lamp: Lamp, far: number): WebGLTexture {
  const { at: from, size } = lamp;
  const cube = gl.createTexture()!;
  // Unit 0, always, and said out loud rather than inherited.
  //
  // This binds the cube it is building to whatever unit happens to be active,
  // and the caller binds the finished cube to a unit of its own — so baking a
  // SECOND lamp while the active unit was still the first one's quietly
  // replaced the first one's binding with the second one's cube. Both lamps
  // then read the same map, the pendant compared its own distances against the
  // desk lamp's, and the room went black. Unit 0 is the scratch unit here: the
  // draw loop rebinds it per part anyway.
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, cube);
  for (const [face] of FACES) {
    gl.texImage2D(face, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  // NEAREST on purpose. The four bytes of a texel are one packed number, and
  // a filter would average the BYTES — blending the low byte of one distance
  // with the high byte of another gives a distance belonging to neither. The
  // softening is the five taps in the main shader, which average decisions
  // rather than encodings.
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fb = gl.createFramebuffer()!;
  const depth = gl.createRenderbuffer()!;
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);

  gl.useProgram(shadowProg);
  const sPos = gl.getAttribLocation(shadowProg, "aPos");
  const sUnlit = gl.getAttribLocation(shadowProg, "aUnlit");
  // every array the MAIN program left enabled is still enabled, and this
  // program names two attributes: the rest would be read out of a buffer that
  // is not theirs. Down for the bake, back up after.
  for (const loc of locs) if (loc >= 0 && loc !== sPos && loc !== sUnlit) gl.disableVertexAttribArray(loc);
  gl.enableVertexAttribArray(sPos);
  gl.enableVertexAttribArray(sUnlit);
  gl.uniform1f(gl.getUniformLocation(shadowProg, "uFar"), far);
  gl.uniform3fv(gl.getUniformLocation(shadowProg, "uSelf"), new Float32Array(lamp.self));
  gl.uniform3fv(gl.getUniformLocation(shadowProg, "uStem"), new Float32Array(lamp.stem ?? [0, 0, 0]));
  gl.uniform3fv(gl.getUniformLocation(shadowProg, "uFrom"), new Float32Array(from));
  const sProj = gl.getUniformLocation(shadowProg, "uProj");
  const sView = gl.getUniformLocation(shadowProg, "uView");
  // one face is a right angle, square, and its near plane is close: the bulb
  // sits inside its own shade and the shade is what makes the pool
  gl.uniformMatrix4fv(sProj, false, perspective(Math.PI / 2, 1, 8, far));
  gl.viewport(0, 0, size, size);
  for (const [face, fwd, up] of FACES) {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, face, cube, 0);
    // white is "nothing was here, and nothing is as far as the far plane",
    // which is the only clear that reads as lit rather than as shadowed
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(sView, false, lookAlong(from, fwd, up));
    for (const part of parts) {
      if (part.piece !== null && out.has(part.piece)) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, part.buffers[0]);
      gl.vertexAttribPointer(sPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, part.buffers[UNLIT_ATTR]);
      gl.vertexAttribPointer(sUnlit, 1, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, part.count);
    }
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
  gl.deleteRenderbuffer(depth);
  gl.useProgram(prog);
  for (const loc of locs) if (loc >= 0) gl.enableVertexAttribArray(loc);
  gl.clearColor(...CLEAR);
  return cube;
}

const locs = ATTRS.map(([name]) => gl.getAttribLocation(prog, name));
for (const loc of locs) gl.enableVertexAttribArray(loc);

const uProj = gl.getUniformLocation(prog, "uProj");
const uView = gl.getUniformLocation(prog, "uView");
const uEye = gl.getUniformLocation(prog, "uEye");
const uTextured = gl.getUniformLocation(prog, "uTextured");
const uExposure = gl.getUniformLocation(prog, "uExposure");
const uUVScale = gl.getUniformLocation(prog, "uUVScale");
const uUVOffset = gl.getUniformLocation(prog, "uUVOffset");
const uLit = gl.getUniformLocation(prog, "uLit");
gl.uniform1i(gl.getUniformLocation(prog, "uTex"), 0);

/** the pendant's bulb, the standard lamp's, the desk lamp's, and the sky at
 *  each window, in GL coordinates */
gl.uniform3fv(gl.getUniformLocation(prog, "uLampAt"), new Float32Array([
  PENDANT.x, FIT.bulb, PENDANT.y,
  STANDARD_LAMP.x, STANDARD_LAMP.bulb, STANDARD_LAMP.y,
  DESK_LAMP.x, DESK_LAMP.bulb, DESK_LAMP.y,
  // The sky over the street, FAR out and LOW: what is wanted from it is not
  // its distance but its direction. A source close outside the glass throws the
  // sash's shadow in a fan, and the fan magnifies the bars' spacing by the ratio
  // of the two distances — at 5,000 out that is 2.2, which spreads three bars
  // 845 apart to 1,863 apart and puts one of them under the floor and another
  // behind the counter. At 30,000 the ratio is 1.25 and all three land in the
  // room.
  //
  // And it is BELOW the window, not above: the sun has just come up over London,
  // and from a garret window a sun near the horizon is lower than the sill —
  // two degrees of elevation is three metres up at the width of a street, and
  // this window is three floors above it. So the light comes in tilted upwards
  // and lays the sash across the upper wall and the ceiling.
  -30000, -5200, 5915,
  -30000, -5200, 9925,
]));
/** each lamp's colour and strength as the room is meant to be lit; the sliders
 *  scale these and never replace them, so 1.00 is always this */
const LAMP_TINT: readonly (readonly [number, number, number])[] = [
  [0.56, 0.45, 0.29],
  [0.52, 0.38, 0.20],
  [0.90, 0.70, 0.38],
  // The windows. A sun that has just come up is the same low angle as one about
  // to go down and an entirely different colour: it is climbing, not going out,
  // and what it lays on the ceiling is warm rather than the blue of a dusk that
  // has already lost its sun. Cloud over London takes most of the gold out of
  // it, so this is a pale one, not a furnace.
  [0.31, 0.28, 0.24],
  [0.31, 0.28, 0.24],
];
/**
 * The sliders: one gain per lamp — the two skies share one — and the fill.
 *
 * READ FROM THE PANEL rather than written twice. These used to start at 1 here
 * and at 1 in the markup, which is one number in two files: change the room's
 * opening light and the sliders say something the room is not doing until the
 * first drag corrects it. The markup is the single place now, and this follows.
 *
 * `LAMP_TINT` above is still the room as it is MEANT to be lit, and 1.00 is
 * still that. What the panel opens at is a setting, not a correction of it.
 */
const gain = ((): { lamp: number[]; fill: number } => {
  const at = (which: string): number => {
    const i = document.querySelector<HTMLInputElement>(`input[data-light="${which}"]`);
    return i ? +i.value : 1;
  };
  const sky = at("sky");
  return { lamp: [at("0"), at("1"), at("2"), sky, sky], fill: at("fill") };
})();
const uLampTint = gl.getUniformLocation(prog, "uLampTint");
const uEmit = gl.getUniformLocation(prog, "uEmit");
const uFill = gl.getUniformLocation(prog, "uFill");
/**
 * THE TWO WINDOWS ARE TURNED DOWN IN THE STREET'S SPACE, NOT THE SHADER'S.
 *
 * Every lit pixel ends at `pow(lit, 1/TONEMAP)`. The street does not: it is a
 * photograph hung beyond the glass and drawn unlit, so it returns before that
 * line and its own pixels reach the screen as they are. The slider therefore
 * used to act in two different spaces at once — linear on the city, tonemapped
 * on the light coming from it — and the two came apart as soon as it moved.
 *
 * Measured, with every other source off: the city plane falls as g^1.00 and the
 * sash laid on the ceiling as g^0.54, which is 1/1.85 and no coincidence. At
 * the slider's top the shaft is 0.43 of the city, which is what a patch of
 * lit ceiling should be. By 0.15 it is 1.04, and by 0.10 it is 1.25 — the
 * daylight on the ceiling brighter than the sky it comes through. That is not a
 * look, it is an impossibility, and it is why a very low setting still showed
 * the sash clearly across a dark room.
 *
 * So the two window lamps are raised to TONEMAP before they are used, which the
 * shader's own exponent then takes straight back out: the light they lay in the
 * room falls as g^1.00, exactly as the city does, and the ratio between them
 * holds at 0.43 wherever the slider is put. The street and the smoke are left
 * alone — they were never the ones in the wrong space.
 *
 * It is exact while the windows are what is lighting a surface, and approximate
 * once a lamp is on it too, because the tonemap is applied to the SUM. That is
 * the right way round: the mismatch only ever showed in a dark room.
 */
function applyLights(): void {
  const sky = (i: number): number => (i >= 3 ? gain.lamp[i] ** TONEMAP : gain.lamp[i]);
  gl.uniform3fv(uLampTint, new Float32Array(LAMP_TINT.flatMap((t, i) => t.map((c) => c * sky(i)))));
  // and the same gain again, for each lamp's own glass — see `uEmit`
  gl.uniform1fv(uEmit, new Float32Array(gain.lamp));
  gl.uniform1f(uFill, gain.fill);
}
applyLights();
/** the distance at which a lamp is down to half — the pendant carries the middle
 *  of the room and lets the corners go, the standard lamp and the desk lamp
 *  their own corner, the two windows only their own end of it. The desk lamp is
 *  the strongest and the shortest: in the frames it burns the papers under it
 *  out to white and reaches almost nothing else. */
gl.uniform1fv(gl.getUniformLocation(prog, "uLampReach"), new Float32Array([2300, 1250, 700, 120000, 120000]));

// the sash the two window lamps shine through, for the shadow of its bars
gl.uniform1f(gl.getUniformLocation(prog, "uGlassX"), ROOM.x0 - WINDOW.reveal);
gl.uniform2fv(gl.getUniformLocation(prog, "uWindow"), new Float32Array(
  WINDOWS.flatMap((w) => [(w.y0 + w.y1) / 2, (w.y1 - w.y0) / 2 - WINDOW.frame]),
));
gl.uniform4fv(gl.getUniformLocation(prog, "uSash"), new Float32Array([
  WINDOW.sill + WINDOW.frame, WINDOW.spring, WINDOW.mullion, WINDOW.bar.thick / 2,
]));
gl.uniform3fv(gl.getUniformLocation(prog, "uBars"), new Float32Array(
  [-1, 0, 1].map((k) => WINDOW.bar.middle + k * WINDOW.bar.spacing),
));

gl.enable(gl.DEPTH_TEST);
/** the room's own ground, which the shadow bake has to hand back after it has
 *  cleared six faces to white */
const CLEAR: [number, number, number, number] = [0.02, 0.03, 0.04, 1];
gl.clearColor(...CLEAR);

/**
 * Bake the desk lamp's shadow, and hand the shader the cube.
 *
 * Unit 1, because unit 0 is the one every painted surface binds its own texture
 * to, once per part, all frame. The cube is bound once here and never rebound.
 *
 * uShadowBias is two numbers the map's own size decides rather than taste: the
 * first is the angular width of a texel, 2 over the face size, which is what
 * the normal offset and the five taps are both measured in; the second is a
 * flat floor under it, for a mediump fragment shader dividing distances by
 * 4,000 and getting them back to about four units.
 */
/**
 * Bake each lamp's cube and hand the shader its map.
 *
 * Units 1 and 2, because unit 0 is the one every painted surface binds its own
 * texture to, once per part, all frame. These are bound once here and never
 * rebound.
 *
 * The bias is two numbers the map's own size decides rather than taste: the
 * angular width of a texel, 2 over the face size, which is what the normal
 * offset and the five taps are both measured in; and a flat floor under it,
 * scaled to the range, for a mediump fragment shader dividing distances by it.
 */
const MAPS = ["uMapPendant", "uMapStandard", "uMapDesk"] as const;
const CFG = ["uShadowPendant", "uShadowStandard", "uShadowDesk"] as const;
const cubes: (WebGLTexture | null)[] = LAMPS.map(() => null);

/**
 * Bake every lamp's cube, and do it again when what casts has changed.
 *
 * Only two things change it: the page loading, and the furniture being taken
 * out of the room. The second has to re-run this or the sofa keeps its shadow
 * after the sofa has gone, which is a worse picture than either of the two
 * honest ones. It is eighteen passes over the room and the visitor asked for
 * it, so a hitch is the right price.
 */
function bakeAll(): void {
  LAMPS.forEach((lamp, i) => {
    const far = roomCorner(lamp.at[0], lamp.at[2], lamp.at[1]);
    if (cubes[i]) gl.deleteTexture(cubes[i]);
    cubes[i] = bakeShadow(lamp, far);
    gl.activeTexture(gl.TEXTURE1 + i);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, cubes[i]);
    gl.uniform1i(gl.getUniformLocation(prog, MAPS[i]), 1 + i);
    gl.uniform3fv(gl.getUniformLocation(prog, CFG[i]),
      new Float32Array([far, 2 / lamp.size, far * 0.0016]));
  });
  gl.activeTexture(gl.TEXTURE0);
}
bakeAll();
/** how much of what is behind it a pane of this glass keeps — a spirit bottle
 *  is not a window, and at 0.30 it veils what is behind without whitening it */
const GLASS_ALPHA = 0.30;
const uAlpha = gl.getUniformLocation(prog, "uAlpha");
gl.uniform1f(uAlpha, 1);
const uShadowOn = gl.getUniformLocation(prog, "uShadowOn");
const uShadowTaps = gl.getUniformLocation(prog, "uShadowTaps");
gl.uniform1f(uShadowOn, 1);
gl.uniform1f(uShadowTaps, 5);

// ---------------------------------------------------------------------------
// standing in it
// ---------------------------------------------------------------------------

/** how close to a wall the walker may get — a body's width, near enough */
const CLEARANCE = 380;

const me = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
let gravity = true;
let fovY = 2 * Math.atan(132 / 256); // the SET's own optics: 54.7° up and down
let standpoint = 0;
/**
 * How the surfaces are painted: dressed, or bare.
 *
 * There were two more once — the frames projected onto the room where they
 * fall, and one clean swatch of each material tiled over its surface — and they
 * were how the paint was arrived at. They are gone: they cost sixteen seconds
 * of projection at every load to answer a question that has been answered, and
 * what is left is the room as it is meant to look and the model underneath it.
 */
const SKINS = ["painted", "plaster"] as const;
function cycleSkin(): void {
  skinMode = SKINS[(SKINS.indexOf(skinMode) + 1) % SKINS.length];
}
let skinMode: (typeof SKINS)[number] = "painted";
/** the exposure at which a frame's pixels read as the material they show */
const NOMINAL_EXPOSURE = 1.8;
let exposure = NOMINAL_EXPOSURE;
/** whether the rip answered, and which pictures came from a drawn file */
let hung: SurfaceId[] = [];

function goTo(i: number): void {
  const s = STANDPOINTS[i % STANDPOINTS.length];
  me.x = s.x; me.y = s.y; me.z = EYE_HEIGHT;
  me.yaw = (2 * Math.PI * s.deg) / 256;
  me.pitch = 0;
  standpoint = i % STANDPOINTS.length;
}

/**
 * Where the room opens, which is not where the game ever stood.
 *
 * The three standpoints are the SET's own: they are where its frames were
 * rendered from, and they are what this room is checked against. None of them
 * is a good first look. This one is composed — straight down the room from the
 * far end, level, square to the window wall, on the desk's own middle — and
 * what it composes is the picture this room has to give: the desk in the lamp's
 * pool with a dormer either side of it and London behind both.
 *
 * `x` is as far back as there is room to stand. Further is the wall, and a
 * camera inside it renders BLACK, which is how 11,400 was ruled out; nearer
 * loses the outer edge of each window, and those two edges are the frame the
 * whole picture is built on. `y` is the desk's own middle, so the two windows
 * come out even.
 *
 * It is not a standpoint and does not join them: `R` still goes to the first
 * SET view and `T` still cycles the three.
 */
const OPENING = { x: 10200, y: 7910, deg: 128 };
/**
 * Whether the walker has the room yet.
 *
 * Pointer lock is taken at the Start press, twenty-five seconds before the room
 * is shown, because that press is the only gesture fresh enough for the browser
 * to grant it. So for those twenty-five seconds the mouse is captured over a
 * black screen — and a person watching an intro MOVES THE MOUSE. Every one of
 * those movements was turning the camera behind the black, and the composed
 * opening view arrived pointing at a wall. A keystroke did the same by walking.
 *
 * Both are ignored until the cut. Nothing is dropped that anyone meant: there
 * is nothing to look at and nowhere to walk.
 */
let walking = false;
me.x = OPENING.x;
me.y = OPENING.y;
me.z = EYE_HEIGHT;
me.yaw = (2 * Math.PI * OPENING.deg) / 256;

const held = new Set<string>();
addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  held.add(k);
  if (k === "g") gravity = !gravity;
  if (k === "t") goTo(standpoint + 1);
  if (k === "r") goTo(0);
  if (k === "p") cycleSkin();
  /**
   * X puts the readout away, and stops it being BUILT.
   *
   * That panel is rewritten from a string every frame, which is a DOM parse and
   * a layout sixty times a second for something the walker is usually not
   * reading. Hiding it with CSS alone would leave all of that going on behind
   * the blank. So the frame loop checks the same class and skips the work.
   */
  if (k === "x") hud.classList.toggle("hidden");
  if (k === "l") lightsPanel.classList.toggle("hidden");
  if (k === "f") furniturePanel.classList.toggle("hidden");
  if (k === "[") exposure = Math.max(0.4, exposure - 0.15);
  if (k === "]") exposure = Math.min(4, exposure + 0.15);
  if (k >= "1" && k <= "3") goTo(+k - 1);
  if (["w", "a", "s", "d", " "].includes(k)) e.preventDefault();
});
addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));
addEventListener("blur", () => held.clear());

/**
 * A coarse pointer is a finger, and a finger has no keys and no wheel. On such a
 * screen the page is driven by dragging instead — the left half of the screen
 * is a stick that walks, the right half turns the head, two fingers pinch the
 * lens — and the few things that were keys become buttons in the corner. The
 * readouts go: a phone shows the room and nothing else. The mouse and the
 * keyboard keep working regardless, for a tablet with both.
 */
const touch = matchMedia("(pointer: coarse)").matches;
document.body.classList.toggle("touch", touch);

canvas.addEventListener("click", () => { if (!touch) canvas.requestPointerLock(); });
let dragging = false;
canvas.addEventListener("pointerdown", (e) => { if (e.pointerType !== "touch") dragging = true; });
addEventListener("pointerup", () => { dragging = false; });
addEventListener("pointermove", (e) => {
  if (!walking) return;                 // the intro is running; see `walking`
  if (e.pointerType === "touch") return;
  if (document.pointerLockElement !== canvas && !dragging) return;
  me.yaw += e.movementX * 0.0026;
  me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch - e.movementY * 0.0026));
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  fovY = Math.max(0.4, Math.min(1.7, fovY + e.deltaY * 0.0012));
}, { passive: false });

// -- fingers -----------------------------------------------------------------

/** the walking stick's deflection, -1..1 on each axis; zero when no finger holds it */
const stick = { x: 0, y: 0 };
/**
 * The stick is drawn where the thumb put it: a ring under the finger that
 * landed, with a knob that leans the way the thumb leans and springs back to
 * the middle when it lifts. Full deflection at REACH, the knob travelling a
 * little less so it stays inside its ring.
 */
const REACH = 70, TRAVEL = 46;
const stickRing = document.getElementById("stick") as HTMLElement;
const stickKnob = stickRing.firstElementChild as HTMLElement;
const showStick = (x: number, y: number): void => {
  stickRing.style.left = `${x}px`;
  stickRing.style.top = `${y}px`;
  stickRing.classList.add("on");
};
const leanStick = (): void => {
  stickKnob.style.transform = `translate(${stick.x * TRAVEL}px, ${-stick.y * TRAVEL}px)`;
};
interface Finger { role: "walk" | "look"; x0: number; y0: number; x: number; y: number }
const fingers = new Map<number, Finger>();
/**
 * A pinch is two fingers of the same hand: both on the left half, or both on
 * the right. A finger on each half is not a pinch — it is the ordinary posture,
 * the left thumb walking while the right one looks — so the lens is only
 * touched when a second finger lands on the half a finger already holds.
 */
let pinch: { a: number; b: number; dist: number; fov: number } | null = null;

const gap = (a: number, b: number): number => {
  const fa = fingers.get(a), fb = fingers.get(b);
  return fa && fb ? Math.hypot(fa.x - fb.x, fa.y - fb.y) : 0;
};
/** put the stick under a finger and take its lean from there, from zero */
const anchor = (f: Finger): void => {
  f.x0 = f.x; f.y0 = f.y;
  stick.x = 0; stick.y = 0;
  leanStick();
  showStick(f.x, f.y);
};
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "touch") return;
  e.preventDefault();
  const role = e.clientX < innerWidth / 2 ? "walk" : "look";
  const f: Finger = { role, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
  fingers.set(e.pointerId, f);
  if (role === "walk") anchor(f);
  const hand = [...fingers].filter(([, g]) => g.role === role).map(([id]) => id);
  if (hand.length === 2) {
    pinch = { a: hand[0], b: hand[1], dist: gap(hand[0], hand[1]), fov: fovY };
    // a left-handed pinch is not a walk: the stick lets go while it lasts
    if (role === "walk") { stick.x = 0; stick.y = 0; leanStick(); }
  }
});
addEventListener("pointermove", (e) => {
  const f = fingers.get(e.pointerId);
  if (!f) return;
  const dx = e.clientX - f.x, dy = e.clientY - f.y;
  f.x = e.clientX; f.y = e.clientY;
  if (pinch && (e.pointerId === pinch.a || e.pointerId === pinch.b)) {
    // the two pinching fingers work the lens and nothing else; the other hand,
    // if there is one, goes on walking or looking as it was
    fovY = Math.max(0.4, Math.min(1.7, pinch.fov * (pinch.dist / Math.max(20, gap(pinch.a, pinch.b)))));
    return;
  }
  if (f.role === "look") {
    me.yaw += dx * 0.005;
    me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch - dy * 0.005));
  } else {
    // a stick: deflection from where the finger landed, full at REACH
    stick.x = Math.max(-1, Math.min(1, (f.x - f.x0) / REACH));
    stick.y = Math.max(-1, Math.min(1, (f.y0 - f.y) / REACH));
    leanStick();
  }
});
const lift = (e: PointerEvent): void => {
  const f = fingers.get(e.pointerId);
  if (!f) return;
  fingers.delete(e.pointerId);
  if (pinch && (e.pointerId === pinch.a || e.pointerId === pinch.b)) {
    pinch = null;
    // whichever finger the pinch leaves behind starts its stick over where it
    // now is, so letting go of a two-finger zoom does not fling the walk
    for (const g of fingers.values()) if (g.role === "walk") anchor(g);
  }
  if (f.role === "walk" && ![...fingers.values()].some((g) => g.role === "walk")) {
    stick.x = 0; stick.y = 0;
    leanStick();
    stickRing.classList.remove("on");
  }
};
addEventListener("pointerup", lift);
addEventListener("pointercancel", lift);

// the lights panel: a gain per source, applied as it is dragged
const lightsPanel = document.getElementById("lights") as HTMLElement;
for (const input of lightsPanel.querySelectorAll<HTMLInputElement>("input[data-light]")) {
  const readout = input.nextElementSibling as HTMLElement;
  readout.textContent = (+input.value).toFixed(2);   // from the slider, not typed beside it
  input.addEventListener("input", () => {
    const g = +input.value;
    const which = input.dataset.light!;
    if (which === "fill") gain.fill = g;
    else if (which === "sky") { gain.lamp[3] = g; gain.lamp[4] = g; }
    else gain.lamp[+which] = g;
    readout.textContent = g.toFixed(2);
    applyLights();
  });
}

/**
 * The shadows control: soft, hard, off.
 *
 * It lives in the lights panel because it belongs to the lights, and because
 * that panel is the one thing reachable from a phone as well as a desk.
 *
 * Shadows are much the most expensive thing this page does per PIXEL, and
 * nothing to do with how heavy the room is: 88,000 triangles in 32 draw calls
 * is nothing, and every machine draws them at the same speed. What varies is
 * fill rate. Near 1080p, three shadowed lamps at five taps each is about thirty
 * million cube-map fetches a frame — an iPhone 12 does not notice, and the
 * twelve execution units of an Intel UHD 600 cannot keep up.
 *
 * Three settings, not two. HARD is one tap instead of five: three times less
 * work for a stair-stepped edge, and on the machines that stutter that alone is
 * usually enough, so the shadows need not be given up altogether.
 */
/**
 * The detail control: how much of the screen's resolution to render at.
 *
 * Separate from the shadows control because it is a different kind of saving.
 * Turning the shadows off removes work from every pixel; this removes pixels.
 * On a machine held back by fill rate — which is what an Intel UHD 600 near
 * 1080p is — the second lever is much the larger of the two, and it is the one
 * that still helps once the shadows are already off.
 */
let renderScale = 1;
const detail = document.getElementById("detail") as HTMLSelectElement;
detail.addEventListener("change", () => { renderScale = +detail.value; });

/**
 * The furniture panel: one box a piece, bottom right, under F.
 *
 * It is a TOOL before it is a saving. The shell is the part of this room that
 * was measured off the frames, and the only way to hold a SET frame up against
 * it is to move what is standing in the way — which until now meant editing the
 * source. The room already ships a skin mode for the same kind of reason.
 *
 * Taking a piece out re-bakes the shadows, because a room whose armchair has
 * gone but whose armchair's shadow has not is the one picture that is wrong
 * whichever way you look at it.
 */
const furniturePanel = document.getElementById("furniture") as HTMLElement;
const boxes = new Map<string, HTMLInputElement>();
/** every piece the room actually built, first-appearance order — so a piece
 *  added anywhere gets a box without a list here having to be kept in step */
for (const name of [...new Set(parts.map((p) => p.piece).filter((n): n is string => n !== null))]) {
  const row = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = true;
  box.addEventListener("change", () => {
    if (box.checked) out.delete(name); else out.add(name);
    bakeAll();
  });
  row.append(box, Object.assign(document.createElement("span"), { textContent: name }));
  boxes.set(name, box);
  furniturePanel.append(row);
}

/**
 * All and none, and they bake ONCE.
 *
 * Clicking fifteen boxes in a loop would re-bake the shadows fifteen times —
 * eighteen passes over the room apiece — for one answer at the end of it. So
 * these set the boxes and the set first and call the bake last.
 */
for (const b of furniturePanel.querySelectorAll<HTMLButtonElement>("#furniture-all button")) {
  b.addEventListener("click", () => {
    const on = b.dataset.all === "1";
    for (const [name, box] of boxes) {
      box.checked = on;
      if (on) out.delete(name); else out.add(name);
    }
    bakeAll();
  });
}

/**
 * The chimney smoke, on or off.
 *
 * Here because it was asked for, and worth saying plainly that it is NOT a
 * performance control, because it looks like one. It is the only thing on this
 * page drawn BLENDED, which is the work a weak GPU is worst at, so it is the
 * obvious suspect — and it was measured twice, facing the windows and with a
 * wall between, and came out at the noise floor both times. Forty triangles of
 * London sky, behind glass, mostly occluded. Turn it off for a still morning,
 * not for frames.
 */
/**
 * The MSAA control, which is the only one on this panel that reloads the page.
 *
 * It has to: see the note beside the context above. The reload happens at once
 * rather than waiting to be asked, so nobody is left wondering why the setting
 * they just changed did nothing.
 */
const edges = document.getElementById("edges") as HTMLSelectElement;
edges.value = wantAA ? "1" : "0";
edges.addEventListener("change", () => {
  try { localStorage.setItem(AA_KEY, edges.value); } catch { /* a private window forgets, and that is its business */ }
  location.reload();
});

const smokeSel = document.getElementById("smoke") as HTMLSelectElement;
smokeSel.addEventListener("change", () => { smokeOn = smokeSel.value === "1"; });

const shadows = document.getElementById("shadows") as HTMLSelectElement;
shadows.addEventListener("change", () => {
  const taps = +shadows.value;
  gl.uniform1f(uShadowOn, taps > 0 ? 1 : 0);
  if (taps > 0) gl.uniform1f(uShadowTaps, taps);
});

/**
 * The lights, on a phone.
 *
 * The panel was hidden outright on a touch screen — `body.touch #lights` set it
 * to none — because it is a desk instrument and the room is the whole page on a
 * phone. But the sliders are not a readout, they are the only way to see this
 * room at a different hour, and a visitor on a phone was simply locked out of
 * them. So the pad gets a button, and the same class the L key toggles is what
 * it toggles: one panel, one hidden class, two ways to reach it.
 */
const pad = (id: string): HTMLButtonElement => document.getElementById(id) as HTMLButtonElement;
/**
 * Both panels start PUT AWAY, on a desk as well as a phone.
 *
 * What a visitor came for is the room, and the first thing they used to get was
 * a readout of their own coordinates and five sliders, over the top of it. The
 * key list stays — it is one dim line along the bottom, and it is the thing
 * that says X and L will bring the other two back, so hiding it as well would
 * leave no way to find them.
 */
lightsPanel.classList.add("hidden");
hud.classList.add("hidden");
pad("pad-light").addEventListener("click", () => {
  const shown = !lightsPanel.classList.toggle("hidden");
  pad("pad-light").classList.toggle("on", shown);
  // the pad and the panel both want the bottom right, which is where a thumb
  // is; `lit` is what moves the pad out from under the sliders
  document.body.classList.toggle("lit", shown);
});
pad("pad-stand").addEventListener("click", () => goTo(standpoint + 1));
pad("pad-skin").addEventListener("click", cycleSkin);
pad("pad-fly").addEventListener("click", () => {
  gravity = !gravity;
  pad("pad-fly").classList.toggle("on", !gravity);
  pad("pad-up").hidden = gravity;
  pad("pad-down").hidden = gravity;
});
// up and down are held, like the keys they stand for
for (const [id, key] of [["pad-up", " "], ["pad-down", "c"]] as const) {
  const b = pad(id);
  b.addEventListener("pointerdown", (e) => { e.preventDefault(); held.add(key); });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) b.addEventListener(ev, () => held.delete(key));
}

/** the room is a box with a pitched lid: stay inside it, and duck under the slope */
function confine(): void {
  me.x = Math.max(ROOM.x0 + CLEARANCE, Math.min(ROOM.x1 - CLEARANCE, me.x));
  me.y = Math.max(ROOM.y0 + CLEARANCE, Math.min(ROOM.y1 - CLEARANCE, me.y));
  const lid = ceilingAt(me.x, me.y) - 240;
  if (gravity) me.z = Math.min(EYE_HEIGHT, lid);
  else me.z = Math.max(ROOM.floor + 300, Math.min(lid, me.z));
}

let last = performance.now();
/**
 * The frame rate, smoothed, for the readout.
 *
 * Off the RAW interval and not off `dt`, which is clamped to 50 ms so that one
 * slow frame cannot teleport the walker across the room — useful for walking
 * and useless for measuring, since it would report 20 fps as the floor however
 * bad things got. This one is meant to tell the truth about a bad frame.
 *
 * A running mean over about half a second, weighted by the interval itself:
 * that way a single long frame counts for as much as it lasted rather than as
 * one sample among many, and the number settles instead of flickering.
 */
let fps = 60;
function frame(now: number): void {
  const raw = Math.max(1, now - last);
  fps += (1000 / raw - fps) * Math.min(1, raw / 500);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  // Nothing walks while the intro runs — see `walking`. The room is still
  // DRAWN: it is what the splash fades off, and it has to be the composed
  // opening view when it is uncovered, not wherever a held key took it.
  if (walking) {
    const speed = (held.has("shift") ? 4200 : 1700) * dt;
    const fx = Math.cos(me.yaw), fy = Math.sin(me.yaw);
    const step = (ax: number, ay: number): void => { me.x += ax * speed; me.y += ay * speed; };
    if (held.has("w") || held.has("arrowup")) step(fx, fy);
    if (held.has("s") || held.has("arrowdown")) step(-fx, -fy);
    if (held.has("d") || held.has("arrowright")) step(-fy, fx);
    if (held.has("a") || held.has("arrowleft")) step(fy, -fx);
    // the finger on the stick: forward by its lift, sideways by its lean
    if (stick.x || stick.y) step(fx * stick.y - fy * stick.x, fy * stick.y + fx * stick.x);
    if (!gravity && held.has(" ")) me.z += speed;
    if (!gravity && held.has("c")) me.z -= speed;
    confine();
  }

  /**
   * How many pixels to actually draw, which is the biggest lever this page has.
   *
   * Everything expensive here is PER PIXEL: five lamps, two analytic window
   * sashes, and the shadow lookups. None of it is per triangle — 88,000
   * triangles in 32 draw calls is nothing, and a slow machine draws them as
   * fast as a quick one. So the honest fix for a machine that cannot keep up is
   * to give it fewer pixels, and the cost falls with the SQUARE: three quarters
   * is a little over half the work, a half is a quarter of it.
   *
   * The canvas keeps its size on the page; only the buffer behind it shrinks,
   * and the browser scales it up — which is what every game's resolution slider
   * does, and it costs nothing to change between frames.
   *
   * The scale is LINEAR and the saving is its square, which is why the low end
   * runs so far down: a quarter is a sixteenth of the pixels and a tenth is a
   * hundredth. A tenth is not meant to be looked at — it is meant to answer
   * whether a machine is held back by pixels at all. If the frame rate does not
   * move at a tenth, nothing that is drawn per pixel is the problem, and the
   * cost is somewhere else entirely.
   */
  const dpr = Math.min(2, devicePixelRatio || 1) * renderScale;
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const eye: [number, number, number] = [me.x, me.z, me.y]; // world (x,y,z) → GL (x,z,y)
  const proj = perspective(fovY, w / h, 40, 60000), look = view(eye, me.yaw, me.pitch);
  gl.uniformMatrix4fv(uProj, false, proj);
  gl.uniformMatrix4fv(uView, false, look);
  gl.uniform3fv(uEye, new Float32Array(eye));
  /**
   * TWO PASSES, and the second one is the only blended geometry in this room
   * apart from the smoke.
   *
   * Everything here has been opaque since it was written: the shader ended at
   * alpha 1 and the draw loop never turned blending on, which is why the
   * lampshade's "glass" is an emissive solid rather than glass. A bottle with
   * spirit in it cannot be done that way — a solid bottle with a dark cylinder
   * hidden inside it renders exactly like a solid bottle.
   *
   * So the glass goes last, after every opaque thing has been drawn and the
   * depth buffer is complete, with the depth test ON and the depth WRITE off.
   * Testing means the bottle is hidden by anything in front of it; not writing
   * means its own far wall does not reject its near wall, so you see both sides
   * of the glass and the liquor between them. It is drawn back to front by
   * nothing at all — there is one glass object in the room, and the day there
   * are two this comment is the warning that they will need sorting.
   */
  const GLASS = "mat:glass";
  const draw = (glass: boolean): void => {
  for (const part of parts) {
    if (part.piece !== null && out.has(part.piece)) continue;
    if ((part.surface === GLASS) !== glass) continue;
    ATTRS.forEach(([, , size], i) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, part.buffers[i]);
      gl.vertexAttribPointer(locs[i], size, gl.FLOAT, false, 0, 0);
    });
    // a chart is worn painted if it has a painting, else by the tile of its
    // material, else — the three pictures — by the frames' own pixels
    const paint = skinMode === "plaster" ? null : part.painted ?? part.tiled ?? part.projected;
    gl.uniform1f(uTextured, paint ? 1 : 0);
    // a projection arrives lit by the room's own lamp; anything else is a
    // material and gets the shader's lights
    gl.uniform1f(uLit, paint && paint !== part.projected ? 1 : 0);
    /**
     * The street outside dims with the WINDOWS' slider, and it is the only
     * surface that does.
     *
     * Every other picture in this room is albedo — the wall, the rug, the
     * pictures — so the shader's lamps light it and the sliders reach it that
     * way. The street is not: it is a photograph of a morning, hung on a
     * backdrop plane beyond the glass and drawn unlit so its own pixels reach
     * the screen as they are. Nothing lights it, so nothing dimmed it, and
     * pulling the window light down used to leave a bright terrace behind a
     * dark room. It is the sky's own picture, so it follows the sky.
     */
    const sky = part.surface === "street" ? gain.lamp[3] : 1;
    gl.uniform1f(uExposure, (paint && !paint.fromFrames ? exposure / NOMINAL_EXPOSURE : exposure) * sky);
    if (paint) {
      gl.bindTexture(gl.TEXTURE_2D, paint.texture);
      gl.uniform2fv(uUVScale, new Float32Array(paint.scale));
      gl.uniform2fv(uUVOffset, new Float32Array(paint.offset ?? [0, 0]));
    }
    gl.drawArrays(gl.TRIANGLES, 0, part.count);
  }
  };
  draw(false);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.uniform1f(uAlpha, GLASS_ALPHA);
  draw(true);
  gl.uniform1f(uAlpha, 1);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  drawSmoke(proj, look, now / 1000);

  // the readout is a desk instrument: on a phone it is hidden, and X hides it
  // anywhere. Either way there is no sense writing a string nobody will read.
  if (touch || hud.classList.contains("hidden")) { requestAnimationFrame(frame); return; }

  const m = (v: number): string => (v / UNITS_PER_METRE).toFixed(2);
  const deg8 = Math.round((me.yaw * 256) / (2 * Math.PI)) & 0xff;
  hud.innerHTML =
    `<b>bedsit1</b> — the shell, from its own Z images` +
    `<dl>` +
    `<dt>x</dt><dd>${me.x.toFixed(0)} <i>${m(me.x)} m</i></dd>` +
    `<dt>y</dt><dd>${me.y.toFixed(0)} <i>${m(me.y)} m</i></dd>` +
    `<dt>eye</dt><dd>${me.z.toFixed(0)} <i>${m(me.z)} m</i></dd>` +
    `<dt>facing</dt><dd>${((me.yaw * 180) / Math.PI).toFixed(0)}° <i>deg8 ${deg8}</i></dd>` +
    `<dt>ceiling</dt><dd>${ceilingAt(me.x, me.y).toFixed(0)} <i>${m(ceilingAt(me.x, me.y))} m</i></dd>` +
    `<dt>lens</dt><dd>${((fovY * 180) / Math.PI).toFixed(0)}° <i>${gravity ? "walking" : "flying"}</i></dd>` +
    `<dt>surfaces</dt><dd>${skinMode}</dd>` +
    `<dt>standing</dt><dd>${STANDPOINTS[standpoint].name}</dd>` +
    `<dt>built</dt><dd>${TRIANGLES.toLocaleString("en")} <i>triangles</i></dd>` +
    `<dt>frames</dt><dd>${fps.toFixed(0)} <i>${raw.toFixed(0)} ms</i></dd>` +
    `</dl>`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// the skin
// ---------------------------------------------------------------------------

/**
 * LINEAR between texels. A projected chart gets no mipmaps: its texel is 18 world
 * units, which is 12 mm, and there is nothing under it to filter down to. A
 * painted surface is finer than that and a power of two on purpose, so it gets
 * them, or a wall across the room would sparkle.
 *
 * A tile repeats MIRRORED, which is the whole reason it is squared to a power of
 * two — a swatch of plaster reflected has no seam, and plaster has no direction
 * for the reflection to get wrong.
 */
/**
 * How far the driver may go in sampling a minified texture along the direction
 * it is squeezed in. A tiled cloth seen across the room is minified hard and at
 * a grazing angle, and plain trilinear filtering averages its weave away to the
 * mean colour a metre from the eye — the game's own frames never mipmapped, so
 * they keep their pattern to the back wall, and without this ours does not.
 * Queried once; `null` where the extension is missing, and then this is simply
 * the trilinear filtering it was before.
 */
const ANISO = gl.getExtension("EXT_texture_filter_anisotropic");
const ANISO_MAX = ANISO ? Math.min(8, gl.getParameter(ANISO.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) : 0;

function upload(width: number, height: number, rgba: Uint8Array, tile: boolean, mipmap = false): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  const wrap = tile ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (mipmap) {
    gl.generateMipmap(gl.TEXTURE_2D);
    if (ANISO) gl.texParameterf(gl.TEXTURE_2D, ANISO.TEXTURE_MAX_ANISOTROPY_EXT, ANISO_MAX);
  }
  return tex;
}

/**
 * Hang a chart that arrived as a FILE.
 *
 * Straight from the `Image` to the texture, which is the whole point of baking
 * them in `Painted`'s own row order: the picture path in `pictures()` has to go
 * through a canvas because a picture file's row 0 is its top and a chart's is
 * its `v0`, and that canvas costs a `getImageData` — 8 MB of readback for a
 * wall, 46 MB for the set. Written the other way up, there is nothing to flip
 * and nothing to read back, and the driver takes the image as it is.
 *
 * These are 2048x1024 and 1024x1024, so they are a power of two on both sides
 * and may have the mipmaps the shader asks for. A chart that was not would
 * sample BLACK rather than fail, which is the trap the desk's magazines fell
 * into; there is nothing to do about it here except keep the charts POT, which
 * they have always been.
 */
function hangImage(id: SurfaceId, img: HTMLImageElement): void {
  const part = parts.find((d) => d.surface === id);
  if (!part) return;
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  if (ANISO) gl.texParameterf(gl.TEXTURE_2D, ANISO.TEXTURE_MAX_ANISOTROPY_EXT, ANISO_MAX);
  part.painted = { texture: tex, scale: [1, 1], fromFrames: false };
}

/**
 * The baked charts, all at once, and which of them did NOT arrive.
 *
 * A missing file is not an error worth stopping for: the painter is still in
 * the page and still knows how to draw every one of these, so anything that
 * fails to load is simply painted as it always was. That is what keeps this a
 * saving rather than a dependency — a bad deploy, a stale hash or a browser
 * with no WebP costs seconds, not the room.
 */
async function bakedCharts(): Promise<SurfaceId[]> {
  const missed: SurfaceId[] = [];
  await Promise.all(Object.entries(BAKED).map(async ([id, file]) => {
    const img = new Image();
    img.src = siteUrl(file!);
    try { await img.decode(); } catch { missed.push(id as SurfaceId); return; }
    hangImage(id as SurfaceId, img);
  }));
  return missed;
}

/** hang a painted chart on the part that wears it */
function hang(p: Painted): void {
  const part = parts.find((d) => d.surface === p.id);
  if (part) part.painted = { texture: upload(p.width, p.height, p.rgba, false, true), scale: [1, 1], fromFrames: false };
}

/**
 * The materials, which need no rip: the room is painted before it is read.
 *
 * The street is left out of that pass and painted only if the photograph does
 * not arrive. Drawing London is by far the most expensive chart here — two
 * megatexels of noise, near enough two seconds — and in the ordinary case the
 * picture covers every one of them, so the drawing is a fallback, not work the
 * page does first and throws away.
 */
async function paint(): Promise<void> {
  // The walls, the ceiling and the floor come as files now and are in flight
  // from here on, decoding off the main thread while the rug is drawn on it.
  // Only what did not arrive is painted, and the rug always is.
  const arriving = bakedCharts();
  // the second pass reports into the same slot as the first, and so runs the
  // bar over ground it has already covered. It only happens when a baked chart
  // failed to arrive, and a bar that stalls is a worse lie than one that repeats
  const paintNow = (skip: readonly SurfaceId[]): Promise<Painted[]> =>
    paintRoom((id, at, of) => step("paint", at / of, `painting the ${id.replace("-", " ")}`), skip);
  for (const p of await paintNow(["street", ...BAKED_IDS])) hang(p);
  const missed = await arriving;
  if (missed.length) {
    for (const p of await paintNow(BAKED_IDS.filter((id) => !missed.includes(id)).concat("street"))) hang(p);
  }
  step("paint", 1, "hanging the pictures");
  hung = await pictures();
  step("pictures", 1);
  if (await street()) { step("street", 1); return; }
  step("street", 0.5, "drawing the street");
  await new Promise((r) => setTimeout(r, 0));
  const drawn = paintSurface("street");
  if (drawn) hang(drawn);
  step("street", 1);
}

/**
 * The view from the windows: a photograph of London from a top-floor window in
 * the Blitz — the dome, the clock tower, a barrage balloon, bunting on the
 * terrace opposite — laid on the backdrop plane in place of the drawn street.
 *
 * It is placed by its horizon: the skyline's foot in the picture sits at
 * `STREET_PHOTO.skyline` of its height, and is put a little above the room's eye
 * level, which is where a street seen from an upper window keeps its horizon.
 * The chart is wider than the picture, so the texture repeats MIRRORED and an
 * oblique look past its edge finds the same street again, reflected, rather
 * than a smear or the void. If the file is missing the drawn street stays.
 */
const STREET_PHOTO = {
  url: "/bedsit/street.jpg",
  /** the fraction of the picture's height at which the far skyline stands */
  skyline: 0.44,
  /** and the world height that skyline is put at — a street's horizon from an
   *  upper window sits a little above the eye */
  horizon: 3000,
  /** the world height of the picture's bottom edge: the chart's, so nothing
   *  below the picture is ever asked for */
  bottom: -5000,
  /** the world `u` the picture is centred on: between the two windows' views */
  centre: 10000,
  /**
   * And the morning put on it. The photograph is an overcast plate, and it
   * hangs on the one surface in this room that gets NO tone curve of its own —
   * the backdrop is drawn unlit, so its pixels reach the screen as they are,
   * while every wall around them has been through a gamma. Left alone it reads
   * as weather rather than as an hour.
   *
   * So: a curve of its own, then a warmth, then a glow. `gamma` opens the
   * midtones the way the room's own does. `tint` is a sun just off the roofs,
   * which is red before it is anything else. `glow` is the light of it in the
   * air itself, laid in a band at the height of `sun` across the picture and
   * falling off over `spread` of its height — haze near the horizon, clear sky
   * above it. All three are dead cheap: the loader already walks every pixel.
   */
  lift: 0.94,
  gamma: 1.32,
  tint: [1.06, 1.0, 0.95],
  glow: [0.18, 0.13, 0.08],
  /** where the light is, up the picture: 0 is its bottom edge, 1 its top */
  sun: 0.55,
  spread: 0.30,
  /**
   * And what the sky does above that glow. A flat grey from the roofs to the
   * top of the frame is the one thing that says OVERCAST whatever else is done
   * to it; a morning that has a sun in it goes warm at the horizon and blue
   * overhead, and it is the difference between the two ends, more than any
   * amount of brightness, that reads as weather clearing.
   */
  high: [0.86, 0.94, 1.12],
} as const;

async function street(): Promise<boolean> {
  const part = parts.find((p) => p.surface === "street");
  const chart = chartOf("street");
  if (!part) return true;
  const img = new Image();
  img.src = siteUrl(STREET_PHOTO.url.slice(1));
  try { await img.decode(); } catch { return false; }
  // squared to a power of two on a canvas, and flipped so row 0 is the bottom,
  // like every other chart texture here
  const size = 2048, cv = document.createElement("canvas");
  cv.width = size; cv.height = size / 2;
  const ctx = cv.getContext("2d")!;
  ctx.translate(0, size / 2); ctx.scale(1, -1);
  ctx.drawImage(img, 0, 0, size, size / 2);
  const rgba = new Uint8Array(ctx.getImageData(0, 0, size, size / 2).data.buffer);
  // the morning, put on the picture: see STREET_PHOTO. A window is the
  // brightest thing in this room by a distance, and what is behind this one is
  // a sun that came up ten minutes ago.
  const rows = size / 2;
  for (let row = 0; row < rows; row++) {
    // row 0 is the picture's BOTTOM, since the canvas was flipped on the way in
    const up = row / (rows - 1);
    const d = (up - STREET_PHOTO.sun) / STREET_PHOTO.spread;
    const glow = Math.exp(-d * d);
    // and how far above the sun's own band this row is, 0 at it and 1 at the top
    const lofty = Math.max(0, Math.min(1, (up - STREET_PHOTO.sun) / (1 - STREET_PHOTO.sun)));
    for (let x = 0; x < size; x++) {
      const i = (row * size + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const sky = 1 + (STREET_PHOTO.high[ch] - 1) * lofty;
        const v = Math.pow(rgba[i + ch] / 255, 1 / STREET_PHOTO.gamma) * STREET_PHOTO.lift * STREET_PHOTO.tint[ch] * sky;
        rgba[i + ch] = Math.min(255, Math.round((v + STREET_PHOTO.glow[ch] * glow) * 255));
      }
    }
  }
  // the picture's world rectangle, from its horizon and its bottom edge
  const height = (STREET_PHOTO.horizon - STREET_PHOTO.bottom) / (1 - STREET_PHOTO.skyline);
  const width = height * (img.naturalWidth / img.naturalHeight);
  const u0 = STREET_PHOTO.centre - width / 2, v0 = STREET_PHOTO.bottom;
  // chart UV → picture UV: scale by the chart's size over the picture's, shift by where it starts
  part.painted = {
    texture: upload(size, size / 2, rgba, true, true),
    scale: [(chart.u1 - chart.u0) / width, (chart.v1 - chart.v0) / height],
    offset: [(chart.u0 - u0) / width, (chart.v0 - v0) / height],
    fromFrames: false,
  };
  // and the chimneys in it smoke: a picture pixel is this many world units
  lightSmoke((px, py) => [u0 + (px / img.naturalWidth) * width, v0 + (1 - py / img.naturalHeight) * height], width / img.naturalWidth);
  return true;
}

// ---------------------------------------------------------------------------
// the smoke
// ---------------------------------------------------------------------------

/**
 * The chimneys in the photograph smoke. Not for any reason of the game's — its
 * frames hold a still — but because a still seen through a window is a
 * painting, and a plume that moves is what says there is a city out there.
 *
 * It is the cheapest thing that still looks like smoke: one quad per chimney,
 * standing on the backdrop plane just in front of the picture, and a fragment
 * shader that reads a tiling noise texture twice, scrolling upward, and keeps
 * what is over a threshold that rises with height. Some two dozen quads, one
 * draw call, two texture reads a fragment over a few thousand fragments; the room's own
 * shader does more per plaster pixel than this does per plume. There is no
 * particle, no state, nothing to step: time is the only input. And since the
 * backdrop is only ever seen through a window, a quad in its plane is as good
 * as a sprite that turns to face the eye, at none of the bookkeeping.
 *
 * The plumes lean to the picture's LEFT. The photograph has smoke of its own
 * painted in — off the tall stacks, blown left — and a live plume off the same
 * stack blown the other way would be two winds over one city — so the painted
 * plumes were taken out of the photograph, and these are the only smoke.
 */
const SMOKE_VERT = `
attribute vec3 aPos;
attribute vec2 aLocal;
attribute vec3 aPlume;
uniform mat4 uProj;
uniform mat4 uView;
varying vec2 vLocal;
varying vec3 vPlume;
void main() {
  vLocal = aLocal;
  vPlume = aPlume;
  gl_Position = uProj * uView * vec4(aPos, 1.0);
}`;

const SMOKE_FRAG = `
precision mediump float;
uniform sampler2D uNoise;
uniform float uTime;
uniform vec3 uColour;
varying vec2 vLocal;   // across the quad, -1..1, and up it, 0..1
varying vec3 vPlume;   // this plume's phase in the noise, its lean, its density
void main() {
  float t = vLocal.y;
  // the spine: starts a little upwind of centre and leans downwind as it climbs,
  // faster near the top where the wind has had longer to work on it
  float spine = vPlume.y * (t * (0.6 + 0.4 * t) - 0.5);
  float wide = 0.10 + 0.45 * t;                        // and widens
  float s = (vLocal.x - spine) / wide;
  float body = max(0.0, 1.0 - s * s);
  // two reads of one noise, at two scales, both drifting up the plume and the
  // finer one also sideways with the wind; their sum is the smoke's density
  vec2 p = vec2(vLocal.x * 0.8, t * 1.2);
  float n1 = texture2D(uNoise, p + vec2(vPlume.x, -uTime * 0.045)).r;
  float n2 = texture2D(uNoise, p * 2.1 + vec2(vPlume.x * 3.0 - uTime * 0.02 * sign(vPlume.y), -uTime * 0.09)).r;
  float n = 0.6 * n1 + 0.4 * n2;
  // the threshold rises with height, so the plume frays and thins as it goes
  float a = smoothstep(0.45 + 0.4 * t, 1.0, n + 0.35 * body) * body * (1.0 - t) * vPlume.z;
  gl_FragColor = vec4(uColour, a);
}`;

/** the smoke's colour, as it leaves the shader: a coal grey a step darker than
 *  the sky it is against, as the plumes already in the picture are */
const SMOKE_COLOUR = [0.30, 0.30, 0.32] as const;

const smokeProg = gl.createProgram()!;
gl.attachShader(smokeProg, compile(gl, gl.VERTEX_SHADER, SMOKE_VERT));
gl.attachShader(smokeProg, compile(gl, gl.FRAGMENT_SHADER, SMOKE_FRAG));
gl.linkProgram(smokeProg);
if (!gl.getProgramParameter(smokeProg, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(smokeProg) ?? "link");
const smokeLocs = ["aPos", "aLocal", "aPlume"].map((n) => gl.getAttribLocation(smokeProg, n));
const smokeU = {
  proj: gl.getUniformLocation(smokeProg, "uProj"),
  view: gl.getUniformLocation(smokeProg, "uView"),
  time: gl.getUniformLocation(smokeProg, "uTime"),
  colour: gl.getUniformLocation(smokeProg, "uColour"),
};
let smoke: { buffers: WebGLBuffer[]; count: number; noise: WebGLTexture } | null = null;

/**
 * A tiling value noise, 128 square, three octaves, stretched to fill 0..1: the
 * only texture the smoke reads. Made here in a few milliseconds rather than
 * shipped, since nobody would ever look at it.
 */
function noiseTexture(): WebGLTexture {
  const N = 128, v = new Float32Array(N * N);
  let seed = 7;
  const rand = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (const [cell, weight] of [[32, 0.5], [16, 0.3], [8, 0.2]] as const) {
    const cells = N / cell, lattice = Float32Array.from({ length: cells * cells }, rand);
    const fade = (x: number): number => x * x * (3 - 2 * x);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      const fx = fade((x % cell) / cell), fy = fade((y % cell) / cell);
      const at = (i: number, j: number): number => lattice[((j % cells) * cells) + (i % cells)];
      const top = at(cx, cy) * (1 - fx) + at(cx + 1, cy) * fx;
      const bottom = at(cx, cy + 1) * (1 - fx) + at(cx + 1, cy + 1) * fx;
      v[y * N + x] += weight * (top * (1 - fy) + bottom * fy);
    }
  }
  let lo = Infinity, hi = -Infinity;
  for (const n of v) { lo = Math.min(lo, n); hi = Math.max(hi, n); }
  const rgba = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) { const g = Math.round(((v[i] - lo) / (hi - lo)) * 255); rgba[i * 4] = g; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = g; rgba[i * 4 + 3] = 255; }
  return upload(N, N, rgba, true, false);
}

/**
 * Put the plumes up: one quad each, on the backdrop plane a step in front of
 * the picture, sized from the picture's own pixel scale so a plume is as big
 * against its chimney whatever the photograph is hung at.
 */
function lightSmoke(worldOf: (px: number, py: number) => [number, number], unitsPerPixel: number): void {
  const x = ROOM.x0 - WINDOW.reveal - WINDOW.street + 40;
  const pos: number[] = [], local: number[] = [], plume: number[] = [];
  CHIMNEYS.forEach((c, i) => {
    const [cu, cv] = worldOf(c.px, c.py);
    const half = (c.w / 2) * unitsPerPixel, tall = c.h * unitsPerPixel;
    // the quad sits half a lean downwind of the mouth, which is where the
    // shader's spine starts; the plume then has the whole width to drift into
    const mid = cu + WIND * 0.5 * half;
    const corner = (s: number, t: number): void => {
      pos.push(x, cv + t * tall, mid + s * half);      // world (x, y, z) → GL (x, z, y)
      local.push(s, t);
      plume.push(i * 0.37, WIND, c.density);
    };
    corner(-1, 0); corner(1, 0); corner(1, 1);
    corner(-1, 0); corner(1, 1); corner(-1, 1);
  });
  const buffer = (data: number[]): WebGLBuffer => {
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    return buf;
  };
  smoke = { buffers: [buffer(pos), buffer(local), buffer(plume)], count: CHIMNEYS.length * 6, noise: noiseTexture() };
  gl.useProgram(smokeProg);
  gl.uniform1i(gl.getUniformLocation(smokeProg, "uNoise"), 0);
  gl.useProgram(prog);
}

/** the smoke pass: after the room, blended over it, behind whatever the depth
 *  buffer says is nearer — which is the sash, so the bars cross the plumes */
function drawSmoke(proj: Float32Array, look: Float32Array, seconds: number): void {
  if (!smoke || !smokeOn) return;
  gl.useProgram(smokeProg);
  gl.uniformMatrix4fv(smokeU.proj, false, proj);
  gl.uniformMatrix4fv(smokeU.view, false, look);
  gl.uniform1f(smokeU.time, seconds);
  /**
   * The plumes dim with the WINDOWS' slider, for the same reason the terrace
   * does — and they have to move together or the trick breaks.
   *
   * `SMOKE_COLOUR` is a coal grey chosen to sit a step DARKER than the sky it
   * stands against, which is what a chimney's smoke does over London. Take the
   * sky down and leave the smoke where it was and the relation inverts: the
   * plumes come out lighter than the sky behind them and read as steam lit from
   * somewhere. Scaling both by the same gain keeps the step.
   */
  gl.uniform3fv(smokeU.colour, new Float32Array(SMOKE_COLOUR.map((c) => c * gain.lamp[3])));
  gl.bindTexture(gl.TEXTURE_2D, smoke.noise);
  // attribute arrays are the context's, not the program's: the room's five are
  // put away so a short buffer is never read past its end for a vertex here
  for (const loc of locs) gl.disableVertexAttribArray(loc);
  ([3, 2, 3] as const).forEach((size, i) => {
    gl.enableVertexAttribArray(smokeLocs[i]);
    gl.bindBuffer(gl.ARRAY_BUFFER, smoke!.buffers[i]);
    gl.vertexAttribPointer(smokeLocs[i], size, gl.FLOAT, false, 0, 0);
  });
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.drawArrays(gl.TRIANGLES, 0, smoke.count);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  for (const loc of smokeLocs) gl.disableVertexAttribArray(loc);
  for (const loc of locs) gl.enableVertexAttribArray(loc);
  gl.useProgram(prog);
}

/**
 * The three pictures on the walls, redrawn.
 *
 * They are the one thing in the room the frames cannot supply well: a poster is
 * type and flat colour, and forty texels of type is a smear. So each was rebuilt
 * at four times the frames' resolution out of what the frames do say — the
 * poster's ink separated and its lettering set again, the photograph cleaned of
 * the palette's dither and toned as the monochrome print it is, the painting
 * repainted from its own composition — and they hang here as albedo, lit by the
 * room's lamp like the plaster is, rather than as the frames' own dim pixels.
 * See {@link file://../tools/bedsitpics.ts}. If a file is missing, the surface
 * falls back to the projection, which is what it wore before.
 */
const PICTURE_FILES: Readonly<Record<string, string>> = {
  poster: "bedsit/poster.jpg",
  photo: "bedsit/photo.jpg",
  painting: "bedsit/painting.jpg",
  /**
   * The book on the armchair — not a picture on a wall, but the same thing to
   * this: one file, laid on one chart.
   *
   * SUPPLIED, and no longer the rectification off `bedobit.mov`. The film's
   * close-up is the best look the game ever gives of this cover and it is still
   * a 320 by 400 crop of a 1996 video, which resolves "Futility" and loses
   * everything around it — the subtitle reads as a smear and the author's name
   * as three marks. What replaces it says the same words at 400 by 500 and
   * carries the embossing the film only implies.
   *
   * `taoot/bedsit/tools/bedsitobit.ts` STILL WRITES THIS PATH. Re-run it and
   * the supplied plate is gone without a word; what it makes is worth keeping
   * as the record of what the game actually holds, so take a copy first.
   */
  futility: "bedsit/futility.png",
  /** and the rug, which is neither a picture nor a wall but is laid the same
   *  way: one photograph over one chart, once, no repeat. Cut and toned by
   *  `taoot/tools/bedsitrug.ts`; the drawn rag rug stays underneath it as what
   *  the floor wears if the file does not arrive. */
  rug: "bedsit/rug.jpg",
  /**
   * The portrait in the armchair's corner, which is the one picture here that
   * was neither found nor rebuilt but SUPPLIED — an image of a man in a frame,
   * cut to the frame's outer edge and fitted to the measured rectangle by
   * {@link file://../tools/bedsitframe.ts}.
   *
   * What the frames actually hold of this picture is fifty pixels across: a
   * bald crown, a heavy nose in near-profile, a light collar, and a dark
   * feature below the nose that three views agree is there and none of them
   * resolves. So this plate is a likeness of that description and not of the
   * picture — it goes on the wall because a wall wants a picture, and the
   * plates under `bedsitcut.ts` are what to look at if the question is what
   * the game actually put there.
   */
  portrait: "bedsit/portrait.jpg",
  /**
   * And the print beside it on the fireplace wall, supplied the same way: a
   * Victorian parlour, two women on a sofa at the left, a man standing at the
   * chimneypiece and another seated across the fire from them.
   *
   * What the frames hold is forty-four pixels, and they hold exactly that
   * arrangement — pale figures left of centre, a dark seated one at the right,
   * a bright fire between and an orange floor along the foot. So this one is
   * closer to its evidence than the portrait is: the composition is the disc's,
   * even though every brush stroke in it is not.
   */
  print: "bedsit/print.jpg",
  /**
   * And the third in that corner: a Victorian family group — a man and a woman
   * standing, two children between them and an infant at the right, on a dark
   * ground with a palm behind. The frames hold forty-one pixels of it, and what
   * they hold is two pale uprights on a dark ground, which is what a white dress
   * and a light one look like at that size.
   */
  sketch: "bedsit/sketch.jpg",
  /**
   * And the fourth in that corner, the one no camera in the room sees the
   * inside of: an officer in a scarlet full-dress tunic with a sash, a star and
   * a row of medals.
   *
   * This is the only picture here with no evidence for its subject at all. What
   * the slivers between the lamp shade and the wall give is a dark red-brown
   * ground with a pale upright near the middle and a cream mass at the upper
   * right — which a red tunic under a face is consistent with, and so are a
   * hundred other things. It hangs because the rectangle is measured and a
   * measured rectangle wants a picture in it; it is not a reading of anything.
   */
  hidden: "bedsit/hidden.jpg",
};
/**
 * Every picture whose chart the baker may fall back to, which is every one with
 * a file EXCEPT `hidden`: a projection of that rectangle is a projection of the
 * lamp shade standing half a metre in front of it. If its file goes missing it
 * wears PAINT.hidden — a flat dark plate — and that is the honest answer there.
 */

/** set when the paint and every plate are on, which is all there is to wait
 *  for now that no bake runs */
let roomReady = false;

/**
 * THE PRELOADER, and what the bar in it means.
 *
 * Two jobs run at once from the moment the page opens — the room paints itself
 * and the track comes down the wire — and the Start button waits for BOTH. The
 * bar is one bar because two would be asking a person to watch a race.
 *
 * `STAGE` is the room's own stages, weighted by what they cost: the painting is
 * the long pole and is measured at about seven tenths of this page's load, and
 * the pictures, the street and the materials share the rest. Those weights are
 * a measurement.
 *
 * `SHARE` between the room and the music is NOT a measurement and cannot be:
 * it depends on the connection, and on this machine's LAN the 4.3 MB arrives
 * before the first wall is painted while over a phone it is the whole wait. It
 * only sets the bar's PACE. What is waited for is both jobs finishing, which no
 * weight can change.
 */
const STAGE = { tooth: 0.05, paint: 0.70, pictures: 0.10, street: 0.05, materials: 0.10 };
const SHARE = { room: 0.7, music: 0.3 };
const got = { tooth: 0, paint: 0, pictures: 0, street: 0, materials: 0, music: 0 };
const barFill = document.querySelector("#bar i") as HTMLElement;
/** how far along a named stage is, and what to say while it runs */
function step(stage: keyof typeof got, k: number, say?: string): void {
  got[stage] = Math.max(got[stage], Math.min(1, k));
  const room = (Object.keys(STAGE) as (keyof typeof STAGE)[])
    .reduce((t, key) => t + STAGE[key] * got[key], 0);
  barFill.style.width = `${(100 * (SHARE.room * room + SHARE.music * got.music)).toFixed(1)}%`;
  if (say) note.textContent = say;
}

/** the drawn pictures, hung on their surfaces; the ones that arrived */
async function pictures(): Promise<SurfaceId[]> {
  const on: SurfaceId[] = [];
  await Promise.all(Object.entries(PICTURE_FILES).map(async ([id, file]) => {
    const part = parts.find((p) => p.surface === id);
    if (!part) return;
    const img = new Image();
    img.src = siteUrl(file);
    try { await img.decode(); } catch { return; }
    // Two things happen on the way in. A chart's row 0 is its bottom edge and a
    // picture file's is its top, so it is flipped; and WebGL1 will not mipmap a
    // texture that is not a power of two on both sides, so it is stretched to
    // the next one up. The stretch costs nothing: the chart maps 0..1 across the
    // picture whatever shape the pixels are in, and the quad puts it back.
    const pot = (n: number): number => Math.min(2048, 1 << Math.ceil(Math.log2(n)));
    const cv = document.createElement("canvas");
    cv.width = pot(img.naturalWidth); cv.height = pot(img.naturalHeight);
    const ctx = cv.getContext("2d")!;
    ctx.translate(0, cv.height); ctx.scale(1, -1);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const rgba = new Uint8Array(ctx.getImageData(0, 0, cv.width, cv.height).data.buffer);
    part.painted = { texture: upload(cv.width, cv.height, rgba, false, true), scale: [1, 1], fromFrames: false };
    on.push(id as SurfaceId);
  }));
  return on;
}

/**
 * The materials that come with a file of their own rather than a patch of a
 * frame — the moquette, cut out of `bedobit.mov` at six times the resolution any
 * SET frame holds of it. They need no rip, so they are laid before it is asked
 * for and are there even when there is none.
 */
async function materialFiles(): Promise<void> {
  await Promise.all(Object.entries(MATERIALS).map(async ([name, spec]) => {
    if (!spec.file) return;
    const img = new Image();
    img.src = siteUrl(spec.file);
    try { await img.decode(); } catch { return; }
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    cv.getContext("2d")!.drawImage(img, 0, 0);
    const rgba = new Uint8Array(cv.getContext("2d")!.getImageData(0, 0, cv.width, cv.height).data.buffer);
    // Usually already de-lit by the tool, so an albedo like a toned swatch. The
    // exception is a swatch cut straight out of a frame with the room's own lamp
    // still on it — `bedsitmats.ts` writes one of those — which wants the
    // frames' exposure instead, exactly as it did when the page cut it itself.
    const skin: Skin = { texture: upload(cv.width, cv.height, rgba, true, true), scale: [1, 1], fromFrames: spec.fromFrames === true };
    for (const part of parts) if (part.surface === `mat:${name}`) part.tiled = skin;
  }));
}

/**
 * The photographed plaster the walls are floated with.
 *
 * One number a texel, divided by the picture's own mean, so that flat plaster
 * is exactly 1 and {@link useToothPhoto} can use it as a multiplier without
 * knowing anything about how bright the scan was. It has to be in before any
 * wall is painted — a chart is rasterized once and never revisited — so this is
 * awaited ahead of the paint rather than raced with it like the rip.
 *
 * A missing or broken file is not an error: the paint falls back to the noise it
 * used before the photograph existed, and the room is a shade less real.
 */
async function toothPhoto(): Promise<void> {
  const img = new Image();
  img.src = siteUrl("bedsit/plaster.jpg");
  try { await img.decode(); } catch { return; }
  const n = img.naturalWidth;
  if (!n || img.naturalHeight !== n) return;   // it tiles both ways: it must be square
  const cv = document.createElement("canvas");
  cv.width = n; cv.height = n;
  const ctx = cv.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, n, n).data;
  const k = new Float32Array(n * n);
  let sum = 0;
  for (let i = 0; i < k.length; i++) {
    k[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
    sum += k[i];
  }
  const mean = sum / k.length;
  if (!(mean > 0)) return;
  for (let i = 0; i < k.length; i++) k[i] /= mean;
  useToothPhoto(n, k);
}

/**
 * THE RIP IS NO LONGER READ. This page used to fetch BEDSIT1.SET — four
 * megabytes — alongside the paint, and by the end it was buying four material
 * swatches and nothing else: every picture on these walls had arrived as a
 * supplied file, and nine of the thirteen materials were drawn. Those four are
 * cut once now by `bedsitmats.ts` and served as 16 kB of PNG each, so the room
 * is the same room off none of the rip at all.
 *
 * What went with it: the swatch loop, the projection fallback for a picture with
 * no file — which had been dead for as long as every picture has had one — and
 * the bake's `coverage` readout, which only ever reported on that fallback.
 */
async function skin(): Promise<void> {
  step("tooth", 0, "reading the room");
  await toothPhoto();
  step("tooth", 1);
  await paint();
  step("materials", 0.5, "cutting the materials");
  await materialFiles();
  step("materials", 1);
  roomReady = true;
}

/**
 * A handle on the camera, for the one check this page is worth anything without:
 * put it where a SET frame was rendered from, at the SET's own 512×264 and the
 * SET's own lens, and the model and the frame are two pictures of one room.
 */
(window as unknown as { bedsit: unknown }).bedsit = {
  stand(x: number, y: number, z: number, deg: number): void {
    me.x = x; me.y = y; me.z = z; me.yaw = (2 * Math.PI * deg) / 256; me.pitch = 0;
  },
  /** where the eye is, for a console or a test that drives the page by touch */
  get where(): unknown { return { x: me.x, y: me.y, z: me.z, yaw: me.yaw, pitch: me.pitch, fov: fovY }; },
  /** the room is up and painted — there is no bake to wait for any more */
  get ready(): boolean { return roomReady; },
  get painted(): boolean { return parts.some((p) => p.painted !== null); },
  set skin(mode: string) { if ((SKINS as readonly string[]).includes(mode)) skinMode = mode as typeof skinMode; },
  set pitch(p: number) { me.pitch = Math.max(-1.45, Math.min(1.45, p)); },
  /** the lens, in radians of height: what the wheel does, for a test */
  set fov(f: number) { fovY = Math.max(0.4, Math.min(1.7, f)); },
  /**
   * The desk lamp's shadow: 0 off, 1 on, 2 shows the map itself.
   *
   * A number and not a boolean, and the 2 is the reason. The only honest way to
   * see what a shadow map bought is the same frame without it, and the only way
   * to tell a wrong map from a wrong comparison is to look at the map.
   */
  /** the chimney smoke, off and on: the one thing in this page that is drawn
   *  BLENDED, which is the kind of work a weak GPU is worst at */
  set smoke(on: boolean) { smokeOn = !!on; },
  set shadow(mode: number) { gl.uniform1f(uShadowOn, +mode); },
  /** the taps per lamp, 1 to 5: what the shadows control in the panel sets */
  set shadowTaps(n: number) { gl.uniform1f(uShadowTaps, Math.max(1, Math.min(5, n))); },
};

/**
 * The gramophone, near enough: one track, looped, under the whole room.
 *
 * IT IS FETCHED AS BYTES, not handed to the element as a URL, and the reason is
 * the intro rather than the music. The room is revealed on a bar line 25
 * seconds into the track, and a track still arriving over the wire can stall
 * between two of those bars — at which point the picture is cut to a rhythm the
 * sound is no longer keeping. Reading the response as a stream also gives the
 * one honest progress number on this page: bytes against `Content-Length`.
 *
 * It STARTS on the press, because a browser will not let a page make a noise it
 * was not asked for, and `play()` REJECTS rather than throwing — an unhandled
 * rejection in the console for a room that is otherwise fine. So it is caught,
 * and silence is an acceptable outcome of asking.
 *
 * And the volume is remembered, like MSAA, because a page that plays music at
 * you again every time you open it is a page you stop opening. Nought is off,
 * and off stays off — but the element is still PLAYED at nought, because the
 * intro is cut to `currentTime` and a paused element has no clock.
 */
const MUSIC_KEY = "bedsit.music";
const MUSIC_FILE = "bedsit/patterns-on-the-wall.mp3";
const musicVol = document.getElementById("music") as HTMLInputElement;
const musicRead = musicVol.nextElementSibling as HTMLElement;
const music = new Audio();
music.loop = true;
music.preload = "auto";
{
  const was = remembered(MUSIC_KEY);
  const v = was === null ? +musicVol.value : Math.max(0, Math.min(1, +was));
  music.volume = v;
  musicVol.value = String(v);
  musicRead.textContent = v.toFixed(2);
}
/** start it if it is wanted and not already going; a refusal is not an error */
function playMusic(): void {
  if (music.volume > 0 && music.paused) void music.play().catch(() => { /* the browser said no */ });
}
musicVol.addEventListener("input", () => {
  music.volume = +musicVol.value;
  musicRead.textContent = music.volume.toFixed(2);
  try { localStorage.setItem(MUSIC_KEY, musicVol.value); } catch { /* a private window forgets */ }
  // NOT paused at nought, only silenced: the intro reads `currentTime` and
  // pausing the element under it would stop the clock the picture is cut to
  if (music.volume > 0) playMusic();
});

/** the track, read as a stream so the bar has a real number to show and so
 *  nothing is still arriving once the intro is counting bars against it */
async function fetchMusic(): Promise<void> {
  const url = siteUrl(MUSIC_FILE);
  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`${res.status}`);
    const total = +(res.headers.get("content-length") ?? 0);
    const chunks: Uint8Array[] = [];
    const reader = res.body.getReader();
    for (let got = 0; ; ) {
      const piece = await reader.read();
      if (piece.done) break;
      chunks.push(piece.value);
      got += piece.value.length;
      // no Content-Length (a proxy that re-encodes) means no fraction to show,
      // and the bar is left to the room rather than given an invented one
      if (total) step("music", got / total);
    }
    music.src = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: "audio/mpeg" }));
  } catch {
    music.src = url;              // let the element fetch it the ordinary way
  }
  // and wait for it to be playable, but not for ever: a track that will not
  // decode should cost the room a second, not the whole way in
  await Promise.race([
    new Promise((r) => music.addEventListener("canplaythrough", r, { once: true })),
    new Promise((r) => setTimeout(r, 4000)),
  ]);
  step("music", 1);
}

/**
 * THE WAY IN, in three beats: the page loads itself, one press starts the
 * intro, and the intro hands over the room.
 *
 * Both jobs start at the module, before anyone has pressed anything, because
 * neither needs permission: a fetch and a canvas are not a noise. What needs
 * the press is the SOUND, and the press is spent on it — which is why the
 * button says Start and not Load. By the time it can be pressed there is
 * nothing left to wait for.
 */
void Promise.all([skin(), fetchMusic()]).then(() => {
  note.textContent = "";
  splash.dataset.state = "ready";
  loadButton.focus();
});

/**
 * The intro, cut to the track's own bars.
 *
 * `patterns-on-the-wall.mp3` runs at 75 to the minute — measured off the file,
 * by the autocorrelation of its onset strength, which puts a bar of four at
 * 3.2 seconds and the first downbeat at 2.73. Every number below is a count of
 * those bars, so the picture and the sound cannot drift apart by rounding.
 *
 * The shape is one bar of line, one bar of black, four times over, and then the
 * room on bar eight. Bar seven — the last line — is the quietest stretch of the
 * first half minute, the track dropping to a fifth of its level before it opens
 * up again on bar eight, which is where the room comes in. So the last line is
 * read in the gap the track leaves, and the room arrives on the sound coming
 * back. None of that is arranged; it is where the track's own dip already was,
 * and the bar count was chosen to land on it.
 *
 * IT IS COUNTED OFF `currentTime`, not off a timer. A `setTimeout` chain
 * measures the page's idea of a second and the track measures its own, and
 * twenty-five seconds is long enough for those to part company — a stalled
 * decode, a backgrounded tab, a phone throttling a timer. Reading the element's
 * own clock every frame means the cut lands on the bar whatever the page did in
 * between. The wall clock is the fallback, for a browser that refused to play
 * at all: then there is no sound to be aligned to and the intro is only a
 * pleasant twenty-five seconds.
 */
const BAR = 3.2;
const DOWNBEAT = 2.73;
/** how long a line takes to arrive and to go, inside its own bar */
const FADE = 0.55;
const INTRO = [
  { bar: 1, text: "It\u2019s 11:40 pm" },
  { bar: 3, text: "London awaits another night at war" },
  { bar: 5, text: "We are in Frank\u2019s apartment" },
  // the last line before the room is the title over the door, which is why it
  // carries the capitals the card does
  { bar: 7, text: "The Day Before the game starts" },
] as const;
/** the bar the room comes in on: the one the track opens up on */
const REVEAL = 8;
const barAt = (n: number): number => DOWNBEAT + (n - 1) * BAR;

const line = document.getElementById("line") as HTMLElement;

/**
 * The room, and the mouse.
 *
 * POINTER LOCK IS ASKED FOR AT THE PRESS, not here, and that is the whole
 * reason this is two functions. Chrome wants a gesture, and by the time the
 * intro has run its twenty-five seconds the press that started it is long past
 * counting as one. Asked for at the press it is granted, the browser's own
 * "press Esc" notice runs its course over the black, and the room arrives with
 * the mouse already looking. If it is refused anyway the canvas asks again on
 * its own click, so the cost is one click and `catch` keeps the refusal out of
 * the console.
 */
function reveal(): void {
  held.clear();                         // nothing pressed during the intro walks
  walking = true;
  splash.classList.add("out");
  splash.addEventListener("transitionend", () => splash.classList.add("gone"), { once: true });
}

function runIntro(): void {
  const started = performance.now();
  /**
   * The track's clock, never ahead of the wall's.
   *
   * Two ways it can be wrong and they pull opposite ways. It runs SLOW when the
   * element stalls, and there the track is the truth: the picture should wait
   * with the sound. It runs FAST where there is no audio device to pace it — a
   * headless browser renders into a null sink as quickly as it can, and this
   * intro went by in seven seconds instead of twenty-five the first time it was
   * measured. `min` takes the track when it lags and the wall when it bolts,
   * which is the right one in both cases.
   *
   * But only SO FAR behind. `min` on its own means a track that stops stops the
   * intro, and the intro is the only way into the room: a stalled decode would
   * leave a black screen for ever. So the track may be a second behind the wall
   * and no further; past that the wall carries it. That second is never spent
   * in the ordinary case — sampled against the wall clock in this page, the
   * element's own clock runs a twentieth of a second behind and stays there.
   */
  const SLACK = 1;
  const clock = (): number => {
    const wall = (performance.now() - started) / 1000;
    if (music.paused) return wall;
    return Math.max(wall - SLACK, Math.min(music.currentTime, wall));
  };
  const out = new AbortController();
  let shown = -1;
  const stop = (): void => { if (!out.signal.aborted) { out.abort(); reveal(); } };
  // a way past it, for the hundredth reload of the afternoon. Not a click the
  // way in needs — a click the way in can spare
  for (const ev of ["keydown", "pointerdown"]) addEventListener(ev, stop, { signal: out.signal });

  /**
   * The cut itself does not wait for a frame.
   *
   * A fade may land a frame late and nobody can tell; the cut to the room is
   * ON a bar line and a frame late is audible. This page's frame is 17 ms on a
   * GPU and 830 ms in a software rasterizer — measured — so the last frame
   * before the bar arms a timer for exactly the remainder instead of letting
   * the next frame discover it is overdue. Whichever gets there first wins;
   * `stop` only fires once.
   */
  let armed = false;
  const frame = (): void => {
    if (out.signal.aborted) return;
    const t = clock();
    if (t >= barAt(REVEAL)) { stop(); return; }
    if (!armed && barAt(REVEAL) - t < 1.5) {
      armed = true;
      setTimeout(stop, (barAt(REVEAL) - t) * 1000);
    }
    // a line is up from its own downbeat until a fade before the next bar, so
    // the fade OUT finishes on the bar rather than starting on it
    const i = INTRO.findIndex((c) => t >= barAt(c.bar) && t < barAt(c.bar) + BAR - FADE);
    if (i !== shown) {
      shown = i;
      if (i < 0) line.classList.remove("on");
      else { line.textContent = INTRO[i].text; line.classList.add("on"); }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

loadButton.addEventListener("click", () => {
  splash.dataset.state = "intro";
  if (!touch) void canvas.requestPointerLock()?.catch?.(() => { /* wants a fresher gesture */ });
  // played even at nought — see the note on the volume slider
  void music.play().catch(() => { /* the browser said no; the wall clock takes over */ });
  runIntro();
});
