import { ShpFile, PropGroup, PropState, ShpFrame, decodeShpFrame } from "../df/shp";
import { paletteToRGBA } from "../df/image";

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
  /** free-form script storage (propowner / propvalue) */
  owner: string | number = "";
  value: string | number = 0;
  frameIdx = 0;
  lastTick = 0;

  constructor(
    readonly group: PropGroup,
    readonly shop: LoadedShop,
  ) {}

  state(): PropState | null {
    return this.group.states.find((s) => s.identifier.toLowerCase() === this.stateName) ?? null;
  }
}

export class LoadedShop {
  readonly paletteRGBA: Uint8ClampedArray;
  private frameCache = new Map<number, ShpFrame>();

  constructor(
    readonly name: string,
    readonly shp: ShpFile,
  ) {
    this.paletteRGBA = paletteToRGBA(shp.paletteRaw, 256);
  }

  frame(containerLoc: number): ShpFrame {
    let f = this.frameCache.get(containerLoc);
    if (!f) {
      f = decodeShpFrame(this.shp.file.containers[containerLoc], this.paletteRGBA);
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

  /** advance animations; frameMs matches the viewer's animation cadence */
  tick(now: number, frameMs: number): void {
    for (const p of this.props.values()) {
      if (!p.visible) continue;
      const st = p.state();
      if (!st || st.frames.length < 2) continue;
      if (!p.lastTick) p.lastTick = now;
      if (now - p.lastTick >= frameMs) {
        p.lastTick = now;
        p.frameIdx = (p.frameIdx + 1) % st.frames.length;
      }
    }
  }

  /** alpha-blit all visible props into an RGBA view buffer */
  composite(rgba: Uint8ClampedArray, width: number, height: number): void {
    for (const p of this.props.values()) {
      if (!p.visible) continue;
      const st = p.state();
      if (!st || !st.frames.length) continue;
      const f = p.shop.frame(st.frames[Math.min(p.frameIdx, st.frames.length - 1)]);
      const dx = p.anchorX - f.posXraw;
      const dy = p.anchorY - f.posYraw;
      for (let y = 0; y < f.height; y++) {
        const ty = dy + y;
        if (ty < 0 || ty >= height) continue;
        for (let x = 0; x < f.width; x++) {
          const tx = dx + x;
          if (tx < 0 || tx >= width) continue;
          const s = (y * f.width + x) * 4;
          if (f.rgba[s + 3] === 0) continue;
          const d = (ty * width + tx) * 4;
          rgba[d] = f.rgba[s];
          rgba[d + 1] = f.rgba[s + 1];
          rgba[d + 2] = f.rgba[s + 2];
        }
      }
    }
  }
}
