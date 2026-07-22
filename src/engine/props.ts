import { ShpFile, PropGroup, PropState, ShpFrame, decodeShpFrame } from "../df/shp";
import { WorldCamera, Occlusion, projectPoint, depthLevel, sceneryOccludes, bearing } from "./geometry";

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

export class PropInstance {
  visible = false;
  stateName = "";
  anchorX = DEFAULT_ANCHOR_X;
  anchorY = DEFAULT_ANCHOR_Y;
  /** free-form script storage (propowner / propvalue / propdeg) */
  owner: string | number = "";
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
   * sprite draw path). Without this, blkjacktable/flames froze on one frame and
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
}

export class LoadedShop {
  private frameCache = new Map<number, ShpFrame>();
  /**
   * Persistent = a boot-level UI shop (house.shp / inven.shp) whose screen
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
      f = decodeShpFrame(this.shp.file.containers[containerLoc]);
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
      if (!st || st.frames.length < 2 || p.frameIdx >= st.frames.length - 1) {
        p.animating = false;
        continue;
      }
      if (!p.lastTick) p.lastTick = now;
      if (now - p.lastTick >= frameMs) {
        p.lastTick = now;
        p.frameIdx++;
        if (p.frameIdx >= st.frames.length - 1) p.animating = false; // hold last frame
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
  private drawList(persistentOnly = false): PropInstance[] {
    return [...this.props.values()]
      .filter((p) => p.visible && !p.worldSpace && p.state()?.frames.length)
      .filter((p) => !persistentOnly || p.shop.persistent)
      .sort((a, b) => b.dist - a.dist);
  }

  /** the set currently displayed — world props only draw in their own set */
  currentSet = "";

  /** visible world-space props, far to near (projected depth descending) */
  private worldDrawList(cam: WorldCamera): { p: PropInstance; proj: { x: number; y: number; depth: number } }[] {
    const out: { p: PropInstance; proj: { x: number; y: number; depth: number } }[] = [];
    for (const p of this.props.values()) {
      if (!p.visible || !p.worldSpace || !p.state()?.frames.length || p.scale <= 0) continue;
      if (p.setName && p.setName !== this.currentSet) continue;
      const proj = projectPoint(cam, p.worldX, p.worldY, p.worldZ);
      if (!proj || proj.depth - p.zclip <= 0) continue;
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
    if (!p.directional || nFrames < 2) return Math.min(p.frameIdx, nFrames - 1);
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
    // refScale is the frame record's i16 @+42 (uniformly 96 across the shipped
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
  propAt(x: number, y: number, cam: WorldCamera | null = null, persistentScreenOnly = false): PropInstance | null {
    const list = this.drawList(persistentScreenOnly);
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      const st = p.state()!;
      const f = p.shop.frame(st.frames[Math.min(p.frameIdx, st.frames.length - 1)]);
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
        if (r.f.opaque[sy * r.f.width + sx]) return p;
      }
    }
    return null;
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
  ): void {
    // world-space props first (they belong to the scene), far to near
    if (cam) {
      for (const { p, proj } of this.worldDrawList(cam)) {
        const r = this.worldRect(p, proj, cam);
        // scenery nearer than the prop hides it, same SET Z image as actors —
        // without this the smoke table / plants drew over pillars in front
        const level = occ ? depthLevel(proj.depth, occ) : 0;
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
    for (const p of this.drawList(persistentScreenOnly)) {
      if (p.anchorY < minAnchorY) continue;
      const st = p.state()!;
      const f = p.shop.frame(st.frames[Math.min(p.frameIdx, st.frames.length - 1)]);
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
