import { ShpFile, PropGroup, PropState, ShpFrame, decodeShpFrame } from "../df/shp";
import { WorldCamera, Occlusion, projectPoint, depthLevel, sceneryOccludes, bearing } from "./geometry";
import type { DrawSignature } from "./signature";

// Projection/camera types live in the neutral ./geometry module; re-exported
// here so existing consumers keep resolving them from "./props" (viewer.ts's
// import("./engine/props").WorldCamera, and tests importing projectPoint).
export type { WorldCamera } from "./geometry";
export { projectPoint } from "./geometry";

/**
 * The frame of a state to show for propdeg(deg). Each frame carries a stored
 * degree (SHP +40): propdeg selects the frame whose degree is angularly closest
 * to `deg`, NOT the deg-th frame. Selector props store small ascending values
 * (score readout 2..23, a valve 0..19) that are usually offset from the frame
 * index; directional props store 0,8,…,248 around the circle. Returns 0 when
 * the state has no degree metadata.
 */
export function frameIndexForDegree(st: PropState, deg: number): number {
  const d = st.degrees;
  if (!d || !d.length) return 0;
  const target = ((Math.round(deg) % 256) + 256) % 256;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < d.length; i++) {
    const diff = ((((d[i] - target) % 256) + 256) % 256);
    const dist = Math.min(diff, 256 - diff);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/**
 * Is this state a SELECTOR — frames that are alternatives chosen by degree —
 * rather than an animation to play?
 *
 * The format answers it: `PropState.animated` is true when the frames "form a real
 * ANIMATION — it has a play script ... or its degrees repeat (one animation per
 * variant)", and false when "the frames are deg-indexed SELECTOR variants". So a
 * state that is not animated and carries one degree per frame has no sequence in
 * it at all; the degree is the whole answer and `frameIdx` means nothing.
 *
 * Named once and asked in both places that need it: {@link
 * PropInstance.currentFrameIdx}, which is what actually draws, and propview, which
 * must not start an animation that does not exist. It replaces two spellings of
 * the same guess — a `frames.length === 2` test and a `frames.length <= 2` one.
 */
export function isDegreeSelector(st: PropState): boolean {
  return !st.animated && !!st.degrees && st.degrees.length === st.frames.length;
}

/** the largest stored degree that can still be a variant index, not an angle */
const MAX_VARIANT_DEGREE = 8;

/**
 * The frames to animate through, when a state holds ONE ANIMATION PER DEGREE.
 *
 * A state's frames usually make a single sequence, but some hold several — the
 * same swing drawn once for normal play and once for the guided tour, or once
 * per bag. TAOOT's house.shp `map` is the case that found this: `close` stores degrees
 * [0,0,0,0,0,1,1,1,1,1,1,0], six normal frames and six tour frames, and its
 * script asks for exactly six updates (`for count = 1 to 6 / forceupdate()`).
 * Stepping the raw index played five normal frames and then the tour ones, so
 * the map shut with the tour artwork and jumped when `propview("light")` put a
 * deg-0 frame back. The normal sixth frame is index 11, last in the container.
 *
 * Told apart from a rotational animation by the SHAPE of the degree list, since
 * nothing names it: a variant split has two or more equal-sized groups of small
 * indices (0..3 in the corpus), while a swing stores one frame per angle around
 * the circle (0,32,…,224) and a selector ramp one frame per position (rods 1..25).
 * Both of those are ragged or singleton and fall through to null, which keeps
 * them animating across every frame exactly as before.
 *
 * Returns null when the state is an ordinary animation; otherwise the indices of
 * the variant matching `deg`, nearest-match through {@link frameIndexForDegree}
 * so a prop whose deg was never set still lands on the lowest variant.
 */
export function degVariantFrames(st: PropState, deg: number): number[] | null {
  const d = st.degrees;
  if (!d || d.length !== st.frames.length || st.frames.length < 3) return null;
  const groups = new Map<number, number[]>();
  for (let i = 0; i < d.length; i++) {
    if (d[i] >= MAX_VARIANT_DEGREE) return null; // an angle, not a variant index
    const g = groups.get(d[i]);
    if (g) g.push(i);
    else groups.set(d[i], [i]);
  }
  if (groups.size < 2) return null;
  const sizes = [...groups.values()].map((g) => g.length);
  if (sizes[0] < 2 || !sizes.every((n) => n === sizes[0])) return null;
  return groups.get(d[frameIndexForDegree(st, deg)]) ?? null;
}

/**
 * The frame indices to step through for a state, in order — its play script
 * (see {@link PropState.playOrder}) composed with a deg-variant split, or null
 * when neither applies and the frames simply play in stored order.
 *
 * The two can both be present, and then the script is written in terms of the
 * VARIANT: TAOOT's boiler and cufflink bags, the deck map and the wireless bag each
 * store the same six-step swing once per variant (12 or 18 frames, a six-step
 * table), so `closing`'s `6,5,4,3,2,1` means "this variant's six frames,
 * backwards". Mapping through the variant is what makes those close animations
 * run the right way for every variant and not just the first.
 *
 * A script that reaches past the variant is not about the variant, so it is used
 * as it stands; one that cannot be either is dropped in favour of the variant.
 */
export function playSequence(st: PropState, variant: number[] | null): number[] | null {
  const list = st.playOrder;
  if (!list) return variant;
  if (!variant) return list;
  if (list.every((i) => i < variant.length)) return list.map((i) => variant[i]);
  if (list.every((i) => variant.includes(i))) return list;
  return variant;
}

/**
 * Runtime state of props loaded from SHP ("shop") files.
 *
 * Props are screen-space overlays: each visible prop draws its current
 * state's frame at (anchor - storedOffset), where the anchor defaults to
 * (256,192) — the centre of the original 512x384 screen — and scripts move
 * it with propxy(). Visibility/state/anchor are entirely script-driven
 * (propvisible / propview / propxy).
 */

const DEFAULT_ANCHOR_X = 256;
const DEFAULT_ANCHOR_Y = 192;

/**
 * Persistent-shop props that are STANDPOINT-bound navigation overlays, not true
 * HUD (TAOOT's house.shp: the open-door image and the destination signs). They belong to the
 * spot you are standing on, so during a turn/walk they must NOT keep drawing at
 * their fixed screen anchor (they'd float "position:absolute" over the rotating
 * scene). Boot's closescene resets exactly these two on a view change
 * (BOOTFILE closescene: initprop on "door"/"signs"); the nav arrow is kept
 * (merely recoloured), so it — and the interface band — still draw mid-motion.
 */
const MOTION_OVERLAY_PROPS = new Set(["door", "signs"]);

export class PropInstance {
  visible = false;
  stateName = "";
  anchorX = DEFAULT_ANCHOR_X;
  anchorY = DEFAULT_ANCHOR_Y;
  /**
   * Free-form script storage (propowner), and "none" until a script writes it.
   *
   * The same convention as an actor's owner, and for the same reason: TAOOT scripts
   * ask `propowner("pipe") = "none"` for "still lying where it was left" rather than
   * comparing against the empty string, which nothing in the corpus ever does.
   * The save path already normalised it on the way out (`String(p.owner) ||
   * "none"`), so a loaded game answered this question correctly and a freshly
   * booted one did not.
   */
  owner: string | number = "none";
  value: string | number = 0;
  deg: string | number = 0;
  /** z-order (propdist): more negative = closer to the viewer */
  dist = 0;
  /** placed with propxyz: drawn via world→screen projection */
  worldSpace = false;
  /** name of the star the prop was placed on (propstar getter) */
  starName = "";
  /**
   * A world prop whose frames are 8-way-style DIRECTIONAL views (a card table,
   * a plant), not an animation — set when propdeg() gives it an orientation.
   * The drawn frame is then chosen at composite time from the prop's facing
   * relative to the camera bearing, exactly like an actor (TI.EXE shares the
   * sprite draw path). Without this, TAOOT's blkjacktable/flames froze on one frame and
   * looked wrong from every view but one.
   */
  directional = false;
  /** set this world prop belongs to (propset) — only drawn there */
  setName = "";
  worldX = 0;
  worldY = 0;
  worldZ = 0;
  scale = 0;
  zclip = 0;
  frameIdx = 0;
  lastTick = 0;
  /**
   * When the current state holds one animation per degree ({@link
   * degVariantFrames}), the frames of the variant being played — and `frameIdx`
   * indexes into THIS, not into `state().frames`. Null for an ordinary state,
   * where the two are the same thing. Always read it through {@link frameCount}
   * / {@link currentFrame} rather than indexing `frames` directly.
   */
  frameOrder: number[] | null = null;
  /** frame pinned by propdeg (a rotational/selector prop) — skip auto-anim */
  frameLocked = false;
  /**
   * propdeg was used on this prop, so its states are deg-indexed VARIANTS: a
   * later propview into a small (<=2 frame) state must re-pick the frame by deg
   * (the mission/tour icon) instead of animating through the alternatives. This
   * PERSISTS across the prop's animation states (open/close), which clear
   * frameLocked — the life preserver / map icon otherwise ended on the wrong
   * variant (and a differently-offset frame) after their open/close animation.
   */
  degVariants = false;
  /**
   * The interp event id ({@link ScriptInterp.currentEvent}) in which propdeg
   * last picked a frame for this prop. A propview in the SAME event honours that
   * pick as a held selector variant regardless of frame count — the `signs` prop
   * does `propdeg(dir)` then `propview(dest)` in one visdeg() call, and its
   * destination states have up to 10 directional frames (one per approach) that
   * must NOT auto-animate. A propview in a LATER event ignores it, so the watch
   * lid's `run` propdeg can't freeze its later 12-frame open/close swing.
   */
  degEvent = -1;
  /**
   * Play this state's frames once (set by propview on a state change). A prop
   * merely made visible in its default state does NOT animate — it holds frame
   * 0 until a propview state change or a propdeg frame select. Without this the
   * bomb key (6 discrete frames, opened by clicking) auto-played 0→5 the moment
   * openstage made it visible, so the puzzle started with the case open + empty.
   */
  animating = false;

  constructor(
    readonly group: PropGroup,
    readonly shop: LoadedShop,
  ) {}

  /**
   * A visible prop with no explicit propview() defaults to its first state
   * (the engine draws state 0 / frame 0). The map's buttons/spot/disable props
   * rely on this — their scripts never call propview.
   */
  state(): PropState | null {
    if (!this.stateName) return this.group.states[0] ?? null;
    return this.group.states.find((s) => s.identifier.toLowerCase() === this.stateName) ?? null;
  }

  /** how many frames this prop will actually play — the variant's, if it has one */
  frameCount(st: PropState): number {
    return this.frameOrder ? this.frameOrder.length : st.frames.length;
  }

  /** where `frameIdx` lands in `st.frames`/`st.refScales`, through the variant map */
  currentFrameIdx(st: PropState): number {
    // A selector's frame IS its degree, whether or not a script ever named the
    // state — see {@link isDegreeSelector}.
    //
    // The bomb puzzle is what found this. BOMB.STG opens the panel with
    //
    //     propvisible ("solenoid", true)
    //     propxy ("solenoid", 256, 192)
    //
    // and no `propdeg` — it sets one for every switch but leaves the solenoid on
    // the default 0, because 0 is the safe, de-energised state (`propdeg
    // ("solenoid", 1)` is the arm, and `if propdeg ("solenoid") = 1` is what calls
    // `boomer ()`). Its two frames carry degrees 1 and 0, in that order, so deg 0
    // is the SECOND frame — and drawing `frameIdx` 0 showed the closed solenoid on
    // a bomb with no power to it (#11). switch3's degrees are 0,1,2 in order, which
    // is why the switches looked right and only the solenoid did not.
    if (!this.frameOrder && isDegreeSelector(st)) return frameIndexForDegree(st, Number(this.deg) || 0);
    const i = Math.min(this.frameIdx, this.frameCount(st) - 1);
    return this.frameOrder ? this.frameOrder[i] : i;
  }

  /** the frame container `frameIdx` currently names */
  currentFrame(st: PropState): number {
    return st.frames[this.currentFrameIdx(st)];
  }
}

export class LoadedShop {
  private frameCache = new Map<number, ShpFrame>();
  /**
   * Persistent = a boot-level UI shop (TAOOT: house.shp / inven.shp) whose screen
   * props (the interface band, inventory) belong on top of the set view.
   * Non-persistent shops are set/stage shops: their SCREEN-space props (e.g.
   * the boiler flat's switch/door) must only draw while their overlay is up,
   * not bleed onto the room's navigation view.
   */
  persistent = false;

  constructor(
    readonly name: string,
    readonly shp: ShpFile,
  ) {}

  frame(containerLoc: number): ShpFrame {
    let f = this.frameCache.get(containerLoc);
    if (!f) {
      f = decodeShpFrame(this.shp.file.containers[containerLoc].data);
      this.frameCache.set(containerLoc, f);
    }
    return f;
  }
}

export class PropRuntime {
  readonly props = new Map<string, PropInstance>();
  readonly shops = new Map<string, LoadedShop>();

  addShop(name: string, shp: ShpFile): LoadedShop {
    const shop = new LoadedShop(name.toLowerCase(), shp);
    this.shops.set(shop.name, shop);
    for (const group of shp.groups) {
      this.props.set(group.name.toLowerCase(), new PropInstance(group, shop));
    }
    return shop;
  }

  removeShop(name: string): void {
    const shop = this.shops.get(name.toLowerCase());
    if (!shop) return;
    this.shops.delete(shop.name);
    for (const [key, p] of this.props) {
      if (p.shop === shop) this.props.delete(key);
    }
  }

  get(name: string): PropInstance | null {
    return this.props.get(String(name).toLowerCase()) ?? null;
  }

  /** propdelete(name): remove a prop from the set (permanent hide) */
  remove(name: string): void {
    this.props.delete(String(name).toLowerCase());
  }

  /**
   * propinstance(src, dst): make `dst` a second prop drawn with `src`'s sprite
   * group — the bridge's tiling sky (sky3/sky4 copy sky1/sky2), SMOKE's extra
   * plants/flames. It gets its own position/animation state but copies src's
   * current display state so it shows immediately; the script then repositions
   * it via propxy. Shares src's shop, so it is removed with that shop.
   *
   * Only CREATES `dst` when it isn't already a real prop. Some shops ship both
   * names as their OWN groups with different baked frame offsets and call
   * propinstance anyway (blackjack's playerscores/dealerscores sit at the same
   * anchor but are drawn player-side vs dealer-side) — clobbering dst's group
   * with src's would collapse them onto each other, so leave an existing dst be.
   */
  instance(src: string, dst: string): void {
    const s = this.props.get(String(src).toLowerCase());
    if (!s) return;
    if (this.props.has(String(dst).toLowerCase())) return; // dst is its own group: don't clobber
    const p = new PropInstance(s.group, s.shop);
    p.visible = s.visible;
    p.stateName = s.stateName;
    p.deg = s.deg;
    p.dist = s.dist;
    p.worldSpace = s.worldSpace;
    p.directional = s.directional;
    p.setName = s.setName;
    this.props.set(String(dst).toLowerCase(), p);
  }

  /**
   * Advance animations; frameMs matches the viewer's animation cadence.
   * State animations play ONCE and hold the last frame (door opens and
   * stays open) — continuous animation is scripted explicitly via makeloop.
   */
  tick(now: number, frameMs: number): void {
    for (const p of this.props.values()) {
      if (!p.visible || p.frameLocked || !p.animating) continue;
      const st = p.state();
      // the variant's length, not the container's: a state holding one animation
      // per degree must stop at the end of the one being played (degVariantFrames)
      const last = st ? p.frameCount(st) - 1 : 0;
      if (!st || last < 1 || p.frameIdx >= last) {
        p.animating = false;
        continue;
      }
      if (!p.lastTick) p.lastTick = now;
      if (now - p.lastTick >= frameMs) {
        p.lastTick = now;
        p.frameIdx++;
        if (p.frameIdx >= last) p.animating = false; // hold last frame
      }
    }
  }

  /**
   * Blit all visible props into an RGBA view buffer, colorizing through the
   * ACTIVE SET's palette (the engine shares one CLUT across set and props).
   */
  /**
   * Visible screen-space props with a drawable frame, back-to-front. In the
   * set view (persistentOnly) only boot-UI shops qualify, so a set/stage
   * shop's screen props don't bleed onto the room (the boiler flat controls).
   */
  private drawList(persistentOnly = false, hideMotionOverlays = false): PropInstance[] {
    return [...this.props.values()]
      .filter((p) => p.visible && !p.worldSpace && p.state()?.frames.length)
      .filter((p) => !persistentOnly || p.shop.persistent)
      .filter((p) => !hideMotionOverlays || !MOTION_OVERLAY_PROPS.has(p.group.name.toLowerCase()))
      .sort((a, b) => b.dist - a.dist);
  }

  /** the set currently displayed — world props only draw in their own set */
  currentSet = "";

  /**
   * Everything {@link composite} would read out of these props, hashed — the
   * prop half of the renderer's "has anything moved?" (src/engine/signature.ts).
   *
   * Deliberately hashes EVERY prop rather than {@link drawList}'s selection: it
   * is cheaper than sorting a copy of the map, and it means the filters
   * themselves (visible, worldSpace, shop.persistent, the caller's
   * persistentOnly/hideMotionOverlays) can change without this having to know
   * they did. Over-hashing only ever costs a redraw that was not needed;
   * under-hashing costs a frame that IS needed, which is why the invisible ones
   * still contribute their `visible` bit.
   *
   * The fields are the ones the draw path consumes: which sprite (group), which
   * frame of which state, where it goes in screen or world space, and the
   * `deg`/`directional` pair the frame choice hangs on for a rotating prop.
   * Keep this in step with {@link composite}, {@link drawList} and
   * {@link worldDrawList} — they are directly above and below it for that reason.
   */
  drawSignature(sig: DrawSignature): void {
    sig.num(this.props.size).str(this.currentSet);
    for (const p of this.props.values()) {
      sig.bool(p.visible);
      if (!p.visible) continue;
      sig.ref(p.group).bool(p.shop.persistent);
      sig.str(p.stateName).num(p.frameIdx);
      // the variant a deg-split state is playing — frameIdx indexes into THIS
      sig.num(p.frameOrder ? p.frameOrder.length : -1);
      if (p.frameOrder) for (const i of p.frameOrder) sig.num(i);
      sig.num(p.anchorX).num(p.anchorY).num(p.dist);
      sig.bool(p.worldSpace).bool(p.directional).any(p.deg);
      if (!p.worldSpace) continue;
      sig.str(p.setName);
      sig.num(p.worldX).num(p.worldY).num(p.worldZ).num(p.scale).num(p.zclip);
    }
  }

  /** visible world-space props, far to near (projected depth descending) */
  private worldDrawList(cam: WorldCamera): { p: PropInstance; proj: { x: number; y: number; depth: number } }[] {
    const out: { p: PropInstance; proj: { x: number; y: number; depth: number } }[] = [];
    for (const p of this.props.values()) {
      if (!p.visible || !p.worldSpace || !p.state()?.frames.length || p.scale <= 0) continue;
      if (p.setName && p.setName !== this.currentSet) continue;
      const proj = projectPoint(cam, p.worldX, p.worldY, p.worldZ);
      // as for actors: behind-the-camera is projectPoint's answer, and zclip is
      // an occlusion bias rather than a clip plane (see occludeAt)
      if (!proj) continue;
      out.push({ p, proj });
    }
    return out.sort((a, b) => b.proj.depth - a.proj.depth);
  }

  /**
   * The frame to draw for a projected world prop. A `directional` prop (one
   * given an orientation with propdeg) picks its frame the same way actors do:
   * from the prop's facing relative to the bearing from the prop to the CAMERA,
   * quantized to the frame count. Otherwise it uses the (possibly animated)
   * frameIdx, so animated world props are unaffected.
   */
  private worldFrameIdx(p: PropInstance, nFrames: number, cam: WorldCamera): number {
    if (!p.directional || nFrames < 2) return p.currentFrameIdx(p.state()!);
    const camBearing = bearing(cam.x - p.worldX, cam.y - p.worldY);
    // the facing to depict is the prop's orientation relative to the camera;
    // pick the frame whose stored degree matches it (the frames' degrees are
    // the depicted view angles, e.g. 0,8,…,248 for a 32-view sprite)
    return frameIndexForDegree(p.state()!, (Number(p.deg) - camBearing) & 0xff);
  }

  /** screen rect + scale of a projected prop frame (sprites shrink with depth) */
  private worldRect(p: PropInstance, proj: { x: number; y: number; depth: number }, cam: WorldCamera) {
    const st = p.state()!;
    const idx = this.worldFrameIdx(p, st.frames.length, cam);
    const f = p.shop.frame(st.frames[idx]);
    // TI.EXE world→screen: k = propscale(per-mille) × refScale / (1000 × depth).
    // refScale is the frame record's i16 @+42 (uniformly 96 across TAOOT's shipped
    // shops — the same field GANG.CST stores for actors); the old hardcoded 180
    // was a fit that ballooned near props (e.g. the wireless message slips).
    const k = (p.scale * (st.refScales[idx] ?? 96)) / (1000 * proj.depth);
    return {
      f,
      k,
      x: proj.x - Math.round(f.posXraw * k),
      y: proj.y - Math.round(f.posYraw * k),
      w: Math.max(1, Math.round(f.width * k)),
      h: Math.max(1, Math.round(f.height * k)),
    };
  }

  /** front-most visible prop whose opaque pixels cover (x, y) */
  propAt(
    x: number,
    y: number,
    cam: WorldCamera | null = null,
    persistentScreenOnly = false,
    occ: Occlusion | null = null,
  ): PropInstance | null {
    const list = this.drawList(persistentScreenOnly);
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      const st = p.state()!;
      const f = p.shop.frame(p.currentFrame(st));
      const lx = x - (p.anchorX - f.posXraw);
      const ly = y - (p.anchorY - f.posYraw);
      if (lx < 0 || ly < 0 || lx >= f.width || ly >= f.height) continue;
      if (f.opaque[ly * f.width + lx]) return p;
    }
    if (cam) {
      const world = this.worldDrawList(cam);
      for (let i = world.length - 1; i >= 0; i--) {
        const { p, proj } = world[i];
        const r = this.worldRect(p, proj, cam);
        if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) continue;
        const sx = Math.min(r.f.width - 1, Math.floor((x - r.x) / r.k));
        const sy = Math.min(r.f.height - 1, Math.floor((y - r.y) / r.k));
        if (!r.f.opaque[sy * r.f.width + sx]) continue;
        // a world prop is only clickable where it is actually drawn: scenery
        // nearer than the prop hides that pixel in composite() (the SET Z map),
        // so a hit there must miss too — else props are clickable THROUGH walls
        // (the click hit-test used to ignore occlusion entirely).
        if (occ && sceneryOccludes(occ, x, y, this.occludeAt(p, proj.depth, occ))) continue;
        return p;
      }
    }
    return null;
  }

  /**
   * The depth a world prop's sprite is occluded at — its depth biased by zclip,
   * exactly as for an actor (see ActorRuntime.occludeAt for the evidence that
   * this is a bias and not a clip plane).
   */
  private occludeAt(p: PropInstance, depth: number, occ: Occlusion): number {
    return depthLevel(depth - Number(p.zclip), occ);
  }

  composite(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    paletteRGBA: Uint8ClampedArray,
    minAnchorY = -Infinity,
    cam: WorldCamera | null = null,
    persistentScreenOnly = false,
    occ: Occlusion | null = null,
    hideMotionOverlays = false,
  ): void {
    // world-space props first (they belong to the scene), far to near
    if (cam) {
      for (const { p, proj } of this.worldDrawList(cam)) {
        const r = this.worldRect(p, proj, cam);
        // scenery nearer than the prop hides it, same SET Z image as actors —
        // without this the smoke table / plants drew over pillars in front
        const level = occ ? this.occludeAt(p, proj.depth, occ) : 0;
        const maxY = Math.min(cam.clipH, height, r.y + r.h);
        const maxX = Math.min(cam.clipW, width, r.x + r.w);
        for (let ty = Math.max(0, r.y); ty < maxY; ty++) {
          const sy = Math.min(r.f.height - 1, Math.floor((ty - r.y) / r.k));
          for (let tx = Math.max(0, r.x); tx < maxX; tx++) {
            const sx = Math.min(r.f.width - 1, Math.floor((tx - r.x) / r.k));
            const s = sy * r.f.width + sx;
            if (!r.f.opaque[s]) continue;
            if (occ && sceneryOccludes(occ, tx, ty, level)) continue;
            const pal = r.f.indexed[s] * 4;
            const d = (ty * width + tx) * 4;
            rgba[d] = paletteRGBA[pal];
            rgba[d + 1] = paletteRGBA[pal + 1];
            rgba[d + 2] = paletteRGBA[pal + 2];
          }
        }
      }
    }
    for (const p of this.drawList(persistentScreenOnly, hideMotionOverlays)) {
      if (p.anchorY < minAnchorY) continue;
      const st = p.state()!;
      const f = p.shop.frame(p.currentFrame(st));
      const dx = p.anchorX - f.posXraw;
      const dy = p.anchorY - f.posYraw;
      for (let y = 0; y < f.height; y++) {
        const ty = dy + y;
        if (ty < 0 || ty >= height) continue;
        for (let x = 0; x < f.width; x++) {
          const tx = dx + x;
          if (tx < 0 || tx >= width) continue;
          const s = y * f.width + x;
          if (!f.opaque[s]) continue;
          const pal = f.indexed[s] * 4;
          const d = (ty * width + tx) * 4;
          rgba[d] = paletteRGBA[pal];
          rgba[d + 1] = paletteRGBA[pal + 1];
          rgba[d + 2] = paletteRGBA[pal + 2];
        }
      }
    }
  }
}
