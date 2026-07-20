import { ShpFile, PropGroup, PropState, ShpFrame, decodeShpFrame } from "../df/shp";

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
 * World→screen projection, ported from TI.EXE fn 0x43a970. Angles are in
 * 1/256 turns; trig is 2.14 fixed point (the engine's TRIG resource tables).
 * The camera sits at the scene's map position; its height comes from the
 * per-view double in the view table (×512 = world units).
 */
export interface WorldCamera {
  x: number;
  y: number;
  z: number;
  /** view angle, 0..255 */
  deg: number;
  /** focal length = max(viewW, viewH)/2 */
  f: number;
  cx: number;
  cy: number;
  /** viewport clip (world props only draw inside the set view) */
  clipW: number;
  clipH: number;
}

const SIN14 = new Int16Array(256);
const COS14 = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  SIN14[i] = Math.round(16384 * Math.sin((2 * Math.PI * i) / 256));
  COS14[i] = Math.round(16384 * Math.cos((2 * Math.PI * i) / 256));
}
/** the engine's rounding: add 0x3fff before >>14 only for negatives */
const fix14 = (v: number): number => (v < 0 ? v + 0x3fff : v) >> 14;

export function projectPoint(
  cam: WorldCamera,
  x: number,
  y: number,
  z: number,
): { x: number; y: number; depth: number } | null {
  const dx = x - cam.x;
  const dy = y - cam.y;
  const dz = z - cam.z;
  const s = SIN14[cam.deg & 0xff];
  const c = COS14[cam.deg & 0xff];
  const depth = fix14(dy * s + dx * c);
  if (depth <= 0) return null;
  const lateral = fix14(dy * c - dx * s);
  return {
    x: cam.cx + Math.trunc((lateral * cam.f) / depth),
    y: cam.cy - Math.trunc((dz * cam.f) / depth),
    depth,
  };
}

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
   * Advance animations; frameMs matches the viewer's animation cadence.
   * State animations play ONCE and hold the last frame (door opens and
   * stays open) — continuous animation is scripted explicitly via makeloop.
   */
  tick(now: number, frameMs: number): void {
    for (const p of this.props.values()) {
      if (!p.visible || p.frameLocked) continue;
      const st = p.state();
      if (!st || st.frames.length < 2) continue;
      if (p.frameIdx >= st.frames.length - 1) continue;
      if (!p.lastTick) p.lastTick = now;
      if (now - p.lastTick >= frameMs) {
        p.lastTick = now;
        p.frameIdx++;
      }
    }
  }

  /**
   * Blit all visible props into an RGBA view buffer, colorizing through the
   * ACTIVE SET's palette (the engine shares one CLUT across set and props).
   */
  /** visible props with a drawable frame, back-to-front (dist descending) */
  private drawList(): PropInstance[] {
    return [...this.props.values()]
      .filter((p) => p.visible && !p.worldSpace && p.state()?.frames.length)
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

  /** screen rect + scale of a projected prop frame (sprites shrink with depth) */
  private worldRect(p: PropInstance, proj: { x: number; y: number; depth: number }) {
    const st = p.state()!;
    const idx = Math.min(p.frameIdx, st.frames.length - 1);
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
  propAt(x: number, y: number, cam: WorldCamera | null = null): PropInstance | null {
    const list = this.drawList();
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
        const r = this.worldRect(p, proj);
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
  ): void {
    // world-space props first (they belong to the scene), far to near
    if (cam) {
      for (const { p, proj } of this.worldDrawList(cam)) {
        const r = this.worldRect(p, proj);
        const maxY = Math.min(cam.clipH, height, r.y + r.h);
        const maxX = Math.min(cam.clipW, width, r.x + r.w);
        for (let ty = Math.max(0, r.y); ty < maxY; ty++) {
          const sy = Math.min(r.f.height - 1, Math.floor((ty - r.y) / r.k));
          for (let tx = Math.max(0, r.x); tx < maxX; tx++) {
            const sx = Math.min(r.f.width - 1, Math.floor((tx - r.x) / r.k));
            const s = sy * r.f.width + sx;
            if (!r.f.opaque[s]) continue;
            const pal = r.f.indexed[s] * 4;
            const d = (ty * width + tx) * 4;
            rgba[d] = paletteRGBA[pal];
            rgba[d + 1] = paletteRGBA[pal + 1];
            rgba[d + 2] = paletteRGBA[pal + 2];
          }
        }
      }
    }
    for (const p of this.drawList()) {
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
