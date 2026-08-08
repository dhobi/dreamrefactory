/**
 * Rendering for puppet mode — the conversation close-ups (openpuppetfile).
 *
 * A puppet replaces the world display with a talking character composited
 * from up to 11 sprite layers (lip sync, blinks, gestures — see
 * {@link PUP_LAYERS}), a subtitle strip, and the choice "bevels": the rows of
 * clickable answer text along the bottom of the screen. The conversation
 * LOGIC (which line plays, which choices show) lives in
 * engine/puppet.ts; this file only draws the current state and hit-tests
 * the bevels.
 *
 * The geometry below is not a design: every number is read out of TI.EXE, and
 * the routine that yielded it is named at each constant. The plaques the
 * answers sit on are not drawn at all — they are a picture the PUP carries
 * ({@link PupFile.bandLocation}), blitted over the room's interface band
 * before each redraw (0x440e30 -> 0x411e80), with bare `DrawString`s on top.
 */
import { PUP_LAYERS } from "./df/pup";
import { subtitleFont, wrapText } from "./fonts";
import { decodeShpFrame, ShpFrame } from "./df/shp";
import { indexedToRGBA, paletteToRGBA } from "./df/image";
import { GameSession } from "./engine/session";
import type { DrawSignature } from "./engine/signature";
import { SCREEN_W, SCREEN_H } from "./screen";

/** the scene backdrop a puppet composites over (the live set view) */
export interface PuppetBackdrop {
  pixels: Uint8Array;
  width: number;
  height: number;
  palette: Uint8ClampedArray;
}

/**
 * The answer band: the bottom 120 px of the screen, exactly five 24-px rows.
 *
 * TI.EXE's bevel rect (0x440f60) is `{top: H + (i-5)*24, left: 0, bottom:
 * top+24, right: W}` — so the rows are numbered from the TOP of the band and a
 * single answer sits at y=264 whether there are one or five of them. That is
 * why {@link MAX_BEVELS} is 5 and not a soft limit: `puppetbevel` returns error
 * 0x2e on a sixth (0x43f676), because a sixth row would not fit the screen.
 */
const BEVEL_H = 24;
const MAX_BEVELS = 5;
const BAND_H = BEVEL_H * MAX_BEVELS;
/** the region the close-up itself draws in — the screen above the band */
export const PUPPET_ART_H = SCREEN_H - BAND_H;
/**
 * The subtitle strip: the bottom 40 px of the ART region, not of the screen.
 * TI.EXE builds `{top: H-120-40, left: 0, bottom: H-120, right: W}` (0x441f27)
 * and, while a subtitle shows, shortens the layer clip by the same 40 px
 * (0x440981) — so the caption bar eats into the picture rather than sitting
 * under it.
 */
const SUBTITLE_H = 40;
const SUBTITLE_TOP = PUPPET_ART_H - SUBTITLE_H;
/** where the band plate is anchored: (W/2, H-60), computed at 0x440e3d/0x440e4f */
const BAND_ANCHOR_X = SCREEN_W / 2;
const BAND_ANCHOR_Y = SCREEN_H - 60;
/**
 * The four render params the text is drawn with. These are `puppetparam`
 * slots, not constants — the numbers here are only the fallback if the slot is
 * unset, and BOOTFILE's `boot()` moves the margin to 25 before any
 * conversation happens. See {@link GameSession.puppetParams}.
 */
const PARAM = {
  /**
   * slot 10 — left margin of the ANSWER ROWS only.
   *
   * The subtitle does not use it: its three MoveTo sites add an immediate 8
   * (0x441f8f, 0x442020, 0x442045) where the bevel loop reads the slot
   * (0x440f13). So the boot's 25 indents the answers to clear the plaque
   * rivets and leaves the caption bar where it is — see
   * {@link SUBTITLE_MARGIN_X}.
   */
  marginX: 10,
  /** slot 6 — text size; the face is Arial whatever slot 5 says */
  textSize: 6,
  /** slot 3 — answer text colour index */
  bevelColor: 3,
  /** slot 4 — colour of the frame around the answer you picked */
  chosenColor: 4,
} as const;
/** every DrawString sits at `rect.top + 16`; the second subtitle line at +32 */
const BASELINE = 16;
const LINE_PITCH = 16;
/**
 * The subtitle's own left margin — a hardcoded 8, not {@link PARAM.marginX}.
 * It pairs with {@link WRAP_LIMIT}: 8 + 496 = 504, so the caption bar has the
 * same 8 px of air on both sides, whatever the answer rows are indented by.
 */
const SUBTITLE_MARGIN_X = 8;
/** a subtitle wraps when it measures W-16 or wider (0x441f79) */
const WRAP_LIMIT = SCREEN_W - 16;
/** the subtitle draws in colour index 0 — white in every shipped PUP clut */
const SUBTITLE_COLOR = 0;
/** PenSize(3) before the chosen row is framed (0x4419c3) */
const FRAME_PEN = 3;

/**
 * A colour out of the puppet's own clut, by index — the table TI.EXE's
 * ForeColor indexes (0x41fd40).
 *
 * Read straight from `paletteRaw` rather than through {@link paletteToRGBA},
 * which forces index 0 to black for the transparent codec's sake. Index 0 is
 * exactly what the subtitle is drawn in, and it is white in every shipped PUP.
 * The channel byte matches paletteToRGBA's choice (the low byte of each 16-bit
 * Mac clut channel) so puppet text and puppet art agree on what 250 is.
 */
function clutColor(paletteRaw: Uint8Array, index: number): string {
  const b = index * 8;
  return `rgb(${paletteRaw[b + 3] ?? 0}, ${paletteRaw[b + 5] ?? 0}, ${paletteRaw[b + 7] ?? 0})`;
}

export class PuppetView {
  /** cached layer composite of the active puppet stance */
  private image: { key: string; rgba: Uint8ClampedArray } | null = null;
  /**
   * decoded puppet layer frames, keyed by "<pup name>:<container loc>". The
   * pup name MUST be part of the key: different PUP files hold different data
   * at the same container index, so keying by loc alone made a second
   * character reuse the first's decoded sprites (garbled overlap).
   */
  private frames = new Map<string, ShpFrame>();
  /** the active puppet's answer-band plate, decoded once */
  private band: { key: string; frame: ShpFrame } | null = null;

  constructor(private readonly session: GameSession) {}

  /** a `puppetparam` slot, or TI.EXE's own default for it if never written */
  private param(slot: number, fallback: number): number {
    return this.session.puppetParams.get(slot) ?? fallback;
  }

  /**
   * Decode (once, cached per pup) a layer sprite of the active puppet. The
   * cache key includes the pup name so switching characters never reuses the
   * previous one's sprites at the same container index.
   */
  layerFrame(loc: number): ShpFrame | null {
    const p = this.session.puppet;
    if (!p) return null;
    const key = `${p.name}:${loc}`;
    let f = this.frames.get(key);
    if (!f) {
      f = decodeShpFrame(p.pup.file.containers[loc].data);
      this.frames.set(key, f);
    }
    return f;
  }

  /**
   * Bevel row geometry (shared by render + click hit-test, so they can never
   * disagree) — TI.EXE 0x440f60, verbatim: full-width 24-px rows filling the
   * band top-down from y=264, at most five of them.
   *
   * The rows are fixed slots, NOT a stack anchored to the bottom edge: two
   * answers occupy 264 and 288 and the remaining plaques of the band plate
   * stay empty below them.
   */
  bevelRects(): { x: number; y: number; w: number; h: number }[] {
    const p = this.session.puppet;
    if (!p) return [];
    return p.bevels
      .slice(0, MAX_BEVELS)
      .map((_, i) => ({ x: 0, y: PUPPET_ART_H + i * BEVEL_H, w: SCREEN_W, h: BEVEL_H }));
  }

  /**
   * Break a subtitle the way TI.EXE does (0x441fab).
   *
   * One line if the whole string measures under {@link WRAP_LIMIT}; otherwise
   * the LAST space whose prefix still fits, with the tail — never measured —
   * on a second line. Two lines is the hard ceiling; there is no third.
   *
   * Where the original gives up, we don't: it scans for a literal space byte
   * and draws *nothing at all* when there is none, which is every Japanese
   * line long enough to need the break. Those fall through to the port's
   * CJK-aware wrapper (see {@link wrapText}) rather than vanishing.
   */
  private subtitleLines(text: string, measure: (s: string) => number): string[] {
    if (measure(text) < WRAP_LIMIT) return [text];
    for (let i = text.length - 1; i >= 0; i--) {
      if (text[i] !== " ") continue;
      const head = text.slice(0, i);
      if (measure(head) < WRAP_LIMIT) return [head, text.slice(i + 1)];
    }
    return wrapText(text, WRAP_LIMIT, measure).slice(0, 2);
  }

  /** the choice-bevel index under a screen position, or -1 */
  bevelAt(x: number, y: number): number {
    const rects = this.bevelRects();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
    }
    return -1;
  }

  /**
   * Composite the puppet's pixels into `dest`, a full SCREEN_W×SCREEN_H RGBA
   * framebuffer owned by the caller (see src/screen.ts).
   *
   * Two regions, from two sources: the close-up itself into the top
   * {@link PUPPET_ART_H} rows, and the PUP's own answer band
   * ({@link PupFile.bandLocation}) into the 120 below it. The canvas-drawn
   * text — subtitle strip and answer rows — is {@link drawOverlay}, kept
   * separate so the caller controls where the fade lands relative to it.
   */
  composite(dest: Uint8ClampedArray, backdrop: PuppetBackdrop | null): void {
    const p = this.session.puppet!;
    const W = SCREEN_W;
    const H = PUPPET_ART_H;
    // while a subtitle shows, the layers are clipped 40 px shorter still — the
    // caption bar is cut out of the picture, not added below it (0x440981)
    const showingSubtitle = !!p.subtitle && this.session.subtitlesOn();
    const clipY = showingSubtitle ? SUBTITLE_TOP : H;
    // layer state for this instant: animLogic playback while a line is
    // spoken (~30 records/s: lip sync, blinks, gestures), else the held
    // pose from the last record
    const state = this.session.puppetCtrl.puppetFrame();
    const key = `${p.name}:${p.stanceIdx}:${clipY}:${state ? state.layers.map((l) => l.frame).join(",") : "-"}`;
    if (!this.image || this.image.key !== key) {
      // the character composites OVER the live scene view; a stance's
      // "background" layer that is one flat colour is a key-colour matte
      // (SMETH1: all-247 plate), not a backdrop
      const rgba = new Uint8ClampedArray(W * H * 4);
      if (backdrop) {
        const view = new Uint8ClampedArray(backdrop.width * backdrop.height * 4);
        indexedToRGBA(backdrop.pixels, backdrop.width, backdrop.height, backdrop.palette, view);
        for (let y = 0; y < backdrop.height && y < H; y++) {
          rgba.set(view.subarray(y * backdrop.width * 4, (y + 1) * backdrop.width * 4), y * W * 4);
        }
      }
      const pal = paletteToRGBA(p.pup.paletteRaw, 256);
      const stance = p.pup.stances[p.stanceIdx] ?? p.pup.stances[0];
      if (stance && state) {
        for (let l = 0; l < PUP_LAYERS.length; l++) {
          const st = state.layers[l];
          const layer = stance.layers[l];
          if (!st || st.frame < 0 || !layer?.frames.length) continue;
          const loc = layer.frames[Math.min(st.frame, layer.frames.length - 1)];
          try {
            const f = this.layerFrame(loc)!;
            if (l === 0) {
              let flat = true;
              const first = f.indexed[0];
              for (let i = 1; i < f.width * f.height; i++) {
                if (f.opaque[i] && f.indexed[i] !== first) {
                  flat = false;
                  break;
                }
              }
              if (flat) continue; // key-colour matte: keep the scene
            }
            // the record's anchor minus the frame's stored offset
            const dx = st.x - f.posXraw;
            const dy = st.y - f.posYraw;
            for (let yy = 0; yy < f.height; yy++) {
              const ty = dy + yy;
              if (ty < 0 || ty >= clipY) continue;
              for (let xx = 0; xx < f.width; xx++) {
                const tx = dx + xx;
                if (tx < 0 || tx >= W) continue;
                const s = yy * f.width + xx;
                if (!f.opaque[s]) continue;
                const c = f.indexed[s] * 4;
                const d = (ty * W + tx) * 4;
                rgba[d] = pal[c];
                rgba[d + 1] = pal[c + 1];
                rgba[d + 2] = pal[c + 2];
                rgba[d + 3] = 255;
              }
            }
          } catch {
            /* skip undecodable layer */
          }
        }
      }
      this.image = { key, rgba };
    }
    dest.set(this.image.rgba);
    this.compositeBand(dest);
  }

  /**
   * Paint the PUP's answer band into the bottom 120 rows.
   *
   * This is a picture, not something the engine draws: five riveted plaques,
   * one per bevel row, shipped inside every PUP and blitted over whatever the
   * room's interface band was showing before every bevel redraw (0x440e30 ->
   * 0x411e80). The anchor the original passes is (W/2, H-60) = (256, 324) and
   * the frame's own stored offset is (256, 60), so it lands at (0, 264) — the
   * same anchor-minus-offset rule the stance layers use.
   *
   * Effectively opaque: ten pixels in the whole 512×120 plate are keyed out
   * (one per plaque), so whatever the caller painted underneath shows through
   * only there.
   */
  private compositeBand(dest: Uint8ClampedArray): void {
    const p = this.session.puppet!;
    const key = `${p.name}:band`;
    if (this.band?.key !== key) {
      this.band = null;
      const loc = p.pup.bandLocation;
      const data = p.pup.file.containers[loc]?.data;
      if (!data) {
        this.session.onLog(`puppet ${p.name}: no answer band at container ${loc}`);
        return;
      }
      try {
        this.band = { key, frame: decodeShpFrame(data) };
      } catch (e) {
        this.session.onLog(`puppet ${p.name}: answer band: ${(e as Error).message}`);
        return;
      }
    }
    const f = this.band.frame;
    const pal = paletteToRGBA(p.pup.paletteRaw, 256);
    const dx = BAND_ANCHOR_X - f.posXraw;
    const dy = BAND_ANCHOR_Y - f.posYraw;
    for (let yy = 0; yy < f.height; yy++) {
      const ty = dy + yy;
      if (ty < 0 || ty >= SCREEN_H) continue;
      for (let xx = 0; xx < f.width; xx++) {
        const tx = dx + xx;
        if (tx < 0 || tx >= SCREEN_W) continue;
        const s = yy * f.width + xx;
        if (!f.opaque[s]) continue;
        const c = f.indexed[s] * 4;
        const d = (ty * SCREEN_W + tx) * 4;
        dest[d] = pal[c];
        dest[d + 1] = pal[c + 1];
        dest[d + 2] = pal[c + 2];
        dest[d + 3] = 255;
      }
    }
  }

  /**
   * The conversation's contribution to the renderer's "has anything moved?" —
   * see src/engine/signature.ts. Covers BOTH {@link composite} and
   * {@link drawOverlay}, because from the frame loop's point of view they are
   * one picture.
   *
   * `animLogic` playback is the moving part: while a line is spoken the layer
   * records change ~30 times a second, and between lines the same held pose is
   * asked for over and over. Hashing the records themselves is therefore what
   * lets a character finish a sentence at full rate and then cost nothing while
   * the player reads the answers.
   *
   * `pressHeld` rather than the clock it consults: the invert box under a held
   * answer row is up or it is not, and the tick floor it waits on is only
   * interesting on the frame it expires.
   */
  drawSignature(sig: DrawSignature): void {
    const p = this.session.puppet;
    if (!p) {
      sig.bool(false);
      return;
    }
    sig.bool(true).bool(p.visible).str(p.name).num(p.stanceIdx);
    sig.bool(this.session.subtitlesOn()).str(p.subtitle ?? "");
    const state = this.session.puppetCtrl.puppetFrame();
    sig.num(state ? state.layers.length : -1);
    if (state) for (const l of state.layers) sig.num(l.frame).num(l.x).num(l.y);
    sig.num(p.bevels.length);
    for (const b of p.bevels) sig.str(b.text);
    sig.num(p.chosen ?? -1);
    const press = p.press;
    sig.num(press ? press.index : -1).bool(!!press && this.pressHeld(press));
  }

  /**
   * Draw the puppet's text over the already-blitted frame: the subtitle strip
   * while a line is spoken, then the answer rows.
   *
   * Both are bare `DrawString`s in the original — one call per line, no
   * ellipsis, no clipping, and no hover state. An answer that is
   * too long simply runs off the right edge, which is a thing the shipped
   * TAOOT scripts were written around rather than a thing the engine handled.
   */
  drawOverlay(ctx: CanvasRenderingContext2D): void {
    const p = this.session.puppet!;
    const pal = p.pup.paletteRaw;
    const marginX = this.param(PARAM.marginX, 8);
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic"; // DrawString's pen y IS the baseline
    ctx.font = subtitleFont(this.param(PARAM.textSize, 12));
    // the caption bar: FillRect over the bottom 40 px of the picture, then at
    // most two lines of it (0x441ef0)
    if (p.subtitle && this.session.subtitlesOn()) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, SUBTITLE_TOP, SCREEN_W, SUBTITLE_H);
      ctx.fillStyle = clutColor(pal, SUBTITLE_COLOR);
      const lines = this.subtitleLines(p.subtitle, (s) => ctx.measureText(s).width);
      lines.forEach((ln, i) =>
        ctx.fillText(ln, SUBTITLE_MARGIN_X, SUBTITLE_TOP + BASELINE + i * LINE_PITCH),
      );
    }
    // the answer rows, straight onto the band artwork (0x440e30)
    const rects = this.bevelRects();
    ctx.fillStyle = clutColor(pal, this.param(PARAM.bevelColor, 250));
    rects.forEach((r, i) => ctx.fillText(p.bevels[i].text, r.x + marginX, r.y + BASELINE));
    // QuickDraw frames INSIDE the rect, so a 3-px pen insets by half of it
    const frame = (i: number): void => {
      const r = rects[i];
      ctx.lineWidth = FRAME_PEN;
      ctx.strokeRect(r.x + FRAME_PEN / 2, r.y + FRAME_PEN / 2, r.w - FRAME_PEN, r.h - FRAME_PEN);
    };
    // While the button is down on a row, the tracker's box — and ONLY that
    // box. PenMode(1) is an INVERT mode, so the frame is the row's own pixels
    // flipped rather than a colour; "difference" against white is the canvas
    // spelling of it. The tracker erases it before returning (0x435260), and
    // only then does the caller frame the row in colour 251 (0x441b23) — so
    // the two are consecutive, never stacked.
    const press = p.press;
    const pressing = !!press && press.index < rects.length && this.pressHeld(press);
    if (pressing) {
      ctx.globalCompositeOperation = "difference";
      ctx.strokeStyle = "#fff";
      frame(press!.index);
      ctx.globalCompositeOperation = "source-over";
    } else if (p.chosen !== null && p.chosen < rects.length) {
      // the answer you picked stays framed while the character answers it,
      // until the script's next puppetclear
      ctx.strokeStyle = clutColor(pal, this.param(PARAM.chosenColor, 251));
      frame(p.chosen);
    }
    ctx.restore();
  }

  /**
   * Is the press box still up? Until the tracker's tick floor has passed, and
   * after that only while the button is genuinely held inside the row — which
   * is what `StillDown` + `PtInRect` come to when the press is a real drag
   * rather than a click.
   */
  private pressHeld(press: { index: number; until: number }): boolean {
    if (this.session.clock.now < press.until) return true;
    if (!this.session.pointerDown) return false;
    return this.bevelAt(this.session.pointerX, this.session.pointerY) === press.index;
  }
}
