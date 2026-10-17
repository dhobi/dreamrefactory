import { WorldCamera, Occlusion, sceneryOccludes, inkPixel } from "./geometry";
import { drawScaledSprite, ScalerFrame } from "./sprite-scaler";

/** the frame a world sprite is drawn into, and the palette its pixels index */
export interface ViewBuffer {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  palette: Uint8ClampedArray;
}

/**
 * Where an actor's or a world prop's frame lands on screen: its top-left, its
 * size, and `k` screen pixels per source pixel. `scaled` is DreamFactory 1's
 * and 4's integer scaler, which places the frame by its hot spot itself.
 */
export interface SpriteRect {
  f: ScalerFrame;
  k: number;
  x: number;
  y: number;
  w: number;
  h: number;
  scaled?: true;
}

/** one world sprite to draw, as the actor or the prop runtime placed and coloured it */
export interface WorldSprite {
  rect: SpriteRect;
  /** the projected hot spot (the scaler's anchor) */
  at: { x: number; y: number };
  /** bit 0 mirrors it left to right, bit 1 top to bottom */
  flip: number;
  /** its palette, shaded already */
  palette: Uint8ClampedArray;
  alpha: number;
  /** the scenery depth level in front of it (SET Z image) */
  level: number;
}

/** the source pixel screen pixel `t` samples, along one axis of a sprite `size` wide at `origin`, `k` to the pixel */
function sourceAt(t: number, origin: number, k: number, size: number, mirrored: boolean): number {
  const i = Math.min(size - 1, Math.floor((t - origin) / k));
  return mirrored ? size - 1 - i : i;
}

/**
 * Blit a world sprite into the view, clipped to the camera and hidden where
 * nearer scenery covers it. Actors and world props draw the same way: one
 * draw-record blit in the engines, whichever renderer built the record.
 */
export function drawWorldSprite(view: ViewBuffer, cam: WorldCamera, occ: Occlusion | null, s: WorldSprite): void {
  const { rgba, width, height } = view;
  const { rect: r, palette, alpha, level, flip } = s;
  // scenery in front of the sprite hides this pixel
  const hidden = occ ? (x: number, y: number) => sceneryOccludes(occ, x, y, level) : null;
  const plot = (x: number, y: number, c: number) => inkPixel(rgba, (y * width + x) * 4, palette, c * 4, alpha);
  if (r.scaled) {
    drawScaledSprite(r.f, s.at.x, s.at.y, r.w, r.h, !!(flip & 1), {
      clip: { top: 0, left: 0, bottom: Math.min(cam.clipH, height), right: Math.min(cam.clipW, width) },
      drawable: hidden ? (x, y) => !hidden(x, y) : undefined,
      plot,
    });
    return;
  }
  const maxY = Math.min(cam.clipH, height, r.y + r.h);
  const maxX = Math.min(cam.clipW, width, r.x + r.w);
  for (let ty = Math.max(0, r.y); ty < maxY; ty++) {
    const row = sourceAt(ty, r.y, r.k, r.f.height, !!(flip & 2)) * r.f.width;
    for (let tx = Math.max(0, r.x); tx < maxX; tx++) {
      const i = row + sourceAt(tx, r.x, r.k, r.f.width, !!(flip & 1));
      if (r.f.opaque[i] && !hidden?.(tx, ty)) plot(tx, ty, r.f.indexed[i]);
    }
  }
}
