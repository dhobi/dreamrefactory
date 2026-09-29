/**
 * The music the player flies to (RAVEN.EXE 0x414bfc): four bands, one of them
 * chosen, `[0x43b304]` — 1 until the player says otherwise (0x40f97f). Each
 * day's folder has a bank of each band's (GRUNGE, HIPHOP, METAL, TEK), which is
 * the flying's to play.
 *
 * `music`'s pictures (SHARED\MUSIC): 0 the screen, 1 the button that plays the
 * chosen band's film (INFO) and 2 CONTINUE, at their anchors. A band is chosen by a
 * click on it, framed 2 pixels thick in 0x28 (0x414ec8); a double click on
 * one plays its film.
 */
import { decodeFrameV0, type FrameV0 } from "@dreamfactory/engine/df/image-v0";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { playFilm, trackPress } from "@dreamfactory/engine/v0/film";
import type { Rect } from "@dreamfactory/engine/v0/screen";
import type { Co, Machine } from "./machine";
import { DoubleClick, anchored, inRect } from "./screens";

/** the bands' films (0x414d75) */
export const BANDS = ["defsoul", "sphexus", "flannel", "killer"] as const;
export const DEFAULT_BAND = 1;

const INFO = 1;
const CONTINUE = 2;
const CHOSEN_INK = 0x28;

/** a band on the screen (0x414fc8): 179 by 123 */
export function bandRect(band: number): Rect {
  const [top, left] = [[0x0d, 0x7a], [0x0d, 0x13d], [0xc9, 0x7a], [0xc9, 0x13d]][band];
  return [top, left, top + 0x7b, left + 0xb3];
}

export class Music {
  private readonly pictures: FrameV0[];
  private readonly clicks: DoubleClick;

  constructor(
    private readonly m: Machine,
    /** `[0x43b304]`, read and set */
    private readonly band: { value: number },
    file: Uint8Array,
  ) {
    this.pictures = readContainerFile(file).containers.map((c) => decodeFrameV0(c.data));
    this.clicks = new DoubleClick(m);
  }

  /** 0x414cd0: the screen, until CONTINUE */
  *run(day: number, palette: Uint8ClampedArray): Co {
    const m = this.m;
    this.draw();
    yield* m.fadeIn(palette);
    for (;;) {
      const e = m.take();
      if (e?.kind === "down") {
        const what = yield* this.click(e.x, e.y);
        if (what === "continue") return;
        if (what === "info") {
          yield* playFilm(m, `${BANDS[this.band.value]}.move`, day);
          this.draw();
        }
      }
      yield;
    }
  }

  private *click(x: number, y: number): Co<"continue" | "info" | null> {
    const m = this.m;
    const inside = (r: Rect) => inRect(r, x, y);
    const doubled = this.clicks.click(x, y);
    const info = this.rect(INFO);
    if (inside(info) && (yield* trackPress(m, info))) return "info";
    const cont = this.rect(CONTINUE);
    if (inside(cont) && (yield* trackPress(m, cont))) return "continue";
    for (let b = 0; b < BANDS.length; b++) {
      const r = bandRect(b);
      if (!inside(r) || !(yield* trackPress(m, r))) continue;
      this.band.value = b;
      this.draw();
      return doubled ? "info" : null;
    }
    return null;
  }

  private rect(k: number): Rect {
    return anchored(this.pictures[k]);
  }

  /** 0x414ec8 */
  draw(): void {
    const m = this.m;
    if (!m.draws) return;
    const s = m.screen;
    s.spriteAt(this.pictures[0], 0, 0);
    s.sprite(this.pictures[INFO], 0, 0);
    s.sprite(this.pictures[CONTINUE], 0, 0);
    s.frame(bandRect(this.band.value), 2, CHOSEN_INK);
  }
}

