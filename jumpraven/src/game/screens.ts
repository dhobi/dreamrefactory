/**
 * What RAVEN.EXE's screens between the briefings — the Mart, COPILOT SELECTION,
 * the music — do alike: a button is a picture drawn at its anchor, and a
 * double click is a quicker way to the same thing.
 */
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import type { Rect } from "@dreamfactory/engine/v0/screen";
import type { Machine } from "./machine";

/** a picture's rect when drawn at its anchor (0x408e77 at the origin) */
export const anchored = (f: FrameV0): Rect => [-f.anchorY, -f.anchorX, -f.anchorY + f.height, -f.anchorX + f.width];

export const inRect = (r: Rect, x: number, y: number): boolean => y >= r[0] && y < r[2] && x >= r[1] && x < r[3];

/**
 * 0x426f1b: this click and the last are a double click — the second within
 * the system's double-click time (500 ms, 30 ticks, Windows' default) and 2
 * pixels of the first (0x426f64)
 */
export class DoubleClick {
  private last = { at: -999, x: -99, y: -99 };
  private static readonly TICKS = 30;

  constructor(private readonly m: Machine) {}

  /** a click at (x, y): answers whether it doubles the one before */
  click(x: number, y: number): boolean {
    const l = this.last;
    const doubled = this.m.ticks - l.at <= DoubleClick.TICKS && Math.abs(x - l.x) <= 2 && Math.abs(y - l.y) <= 2;
    this.last = { at: this.m.ticks, x, y };
    return doubled;
  }
}
