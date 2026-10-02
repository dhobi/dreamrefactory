/**
 * What a suite that draws (`draws: true`) asks of the screen: is a picture of
 * the rip where the game puts it, is a string written there, is a rect framed.
 * Each is measured against the machine's 512x384 palette indexes, never a
 * screenshot, so a check says which pixels are wrong.
 */
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { decodeFrameV0, type FrameV0 } from "@dreamfactory/engine/df/image-v0";
import type { BitmapFont } from "@dreamfactory/engine/v0/font";
import { SCREEN_W, Screen, type Rect } from "@dreamfactory/engine/v0/screen";
import type { Machine } from "../../src/game/machine";

/** a file of the rip's pictures, found as the game finds it (the day's folder, then SHARED) */
export function pictures(m: Machine, name: string, day: number): FrameV0[] {
  const path = m.resolve(name, day);
  const bytes = path ? m.files.get(path) : null;
  if (!bytes) throw new Error(`${name} is not in day ${day}'s folder or SHARED`);
  return readContainerFile(bytes).containers.map((c) => (c.data.length ? decodeFrameV0(c.data) : (null as unknown as FrameV0)));
}

/** of a picture's opaque pixels with its top-left at (top, left) and on the screen, the share the screen shows */
export function shows(s: Screen, f: FrameV0, top: number, left: number, within: Rect = [0, 0, 384, 512]): number {
  let n = 0;
  let same = 0;
  for (let r = 0; r < f.height; r++) {
    const y = top + r;
    if (y < within[0] || y >= within[2]) continue;
    for (let c = 0; c < f.width; c++) {
      const x = left + c;
      const i = r * f.width + c;
      if (x < within[1] || x >= within[3] || !f.opaque[i]) continue;
      n++;
      if (s.pixels[y * SCREEN_W + x] === f.indexed[i]) same++;
    }
  }
  return n ? same / n : 0;
}

/** the same, for a picture drawn by its anchor at (y, x) (`Screen.sprite`) */
export const showsAt = (s: Screen, f: FrameV0, y: number, x: number): number => shows(s, f, y - f.anchorY, x - f.anchorX);

/**
 * Whether `text` is written in `ink` at (x, baseline): every pixel the font
 * puts down for it, drawn on a blank screen, is `ink` on this one too
 */
export function wrote(s: Screen, font: BitmapFont, x: number, baseline: number, text: string, ink: number): boolean {
  const blank = new Screen();
  blank.fill([0, 0, 384, 512], ink === 0 ? 1 : 0);
  blank.text(font, x, baseline, text, ink);
  let n = 0;
  for (let i = 0; i < blank.pixels.length; i++) {
    if (blank.pixels[i] !== ink) continue;
    n++;
    if (s.pixels[i] !== ink) return false;
  }
  return n > 0;
}

/** whether the rect is framed `pen` pixels thick in `ink` just inside its edge (`Screen.frame`) */
export function framed(s: Screen, r: Rect, pen: number, ink: number): boolean {
  const [t, l, b, rt] = r;
  for (let y = t; y < b; y++) {
    for (let x = l; x < rt; x++) {
      const edge = y < t + pen || y >= b - pen || x < l + pen || x >= rt - pen;
      if (edge && s.pixels[y * SCREEN_W + x] !== ink) return false;
    }
  }
  return true;
}
