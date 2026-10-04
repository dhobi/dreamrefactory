/**
 * The set walker's rules: standing in a Dust room and moving through it straight
 * off its move table, with no engine involved.
 *
 * This is what is left of the page's original experiment (see the header of
 * src/main.ts) and what a boot that cannot produce a viewer falls back to. The
 * page owns the screen and the keys; what is here is the part with a right
 * answer — which moves leave a standpoint, which picture stands for it, and the
 * frames a set holds.
 */
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { FrameBuffer, decodeFrame } from "@dreamfactory/engine/df/image";
import type { SetFileV1, V1Standpoint, V1Transition } from "@dreamfactory/engine/df/set-v1";

/** the frame as the file stores it */
export const VIEW_W = 512;
export const VIEW_H = 264;

export const standKey = (s: V1Standpoint): string => `${s.x},${s.z},${s.facing}`;

/**
 * The rotational order of the facing IDs, read out of the file rather than
 * assumed.
 *
 * The IDs are not in compass order — APOTH turns 1 -> 3 -> 2 -> 4 -> 1 one way
 * round and the reverse the other — so "which way is right" cannot come from
 * comparing numbers. Every cell carries both cycles as eight turn records, so
 * the answer is simply the two turns leaving the standpoint we are on, taken in
 * the order the register stores them: the register groups one whole cycle before
 * the other, which makes the first the consistent sense across the set.
 */
export function turnsFrom(set: SetFileV1, s: V1Standpoint): V1Transition[] {
  return set.transitions.filter((t) => t.kind === "turn" && standKey(t.from) === standKey(s));
}

export function walkFrom(set: SetFileV1, s: V1Standpoint): V1Transition | undefined {
  return set.transitions.find((t) => t.kind === "walk" && standKey(t.from) === standKey(s));
}

/**
 * The picture of standing at a standpoint.
 *
 * The HI-RES still first — the big frame at the tail of a slot, which a
 * standpoint has exactly one of on every set but MINE.SET (see dust/tests/sets.ts:
 * the mine carries no stills at all). That is what the original shows you while
 * you are stopped; the move's own frames are the low-res ones it flicks through
 * on the way. Preferring it is not just fidelity, it is also visibly sharper.
 *
 * Falling back to a move's last frame covers the mine, and a standpoint whose
 * still failed to decode. Its arrival frame is the same view at lower detail,
 * which is a better answer than a black screen.
 */
export function stillAt(set: SetFileV1, frames: Map<number, Uint8Array>, s: V1Standpoint): Uint8Array | null {
  for (const t of set.transitions) {
    if (standKey(t.from) !== standKey(s) || t.departureStill < 0) continue;
    const px = frames.get(t.departureStill);
    if (px) return px;
  }
  for (const t of set.transitions) {
    if (standKey(t.to) !== standKey(s) || !t.frames.length) continue;
    const px = frames.get(t.frames.at(-1)!);
    if (px) return px;
  }
  return null;
}

/**
 * Every view-sized frame in a set, decoded in FILE order into one buffer and
 * each result kept — the order is not optional, because DreamFactory frames are
 * delta-coded against whatever the buffer already holds (see src/main.ts).
 */
export function decodeSetFrames(bytes: Uint8Array): Map<number, Uint8Array> {
  const file = readContainerFile(bytes);
  const fb = new FrameBuffer();
  const frames = new Map<number, Uint8Array>();
  for (let i = 0; i < file.containers.length; i++) {
    const c = file.containers[i];
    if (c.gap || c.data.length < 8) continue;
    try {
      const d = decodeFrame(c.data, fb);
      if (d.width === VIEW_W && d.height === VIEW_H) frames.set(i, fb.pixels.slice(0, VIEW_W * VIEW_H));
    } catch {
      /* not a frame — scripts, registers and the header all live here too */
    }
  }
  return frames;
}

/** what a key does in the walker: turn, walk, the next palette, or nothing */
export type WalkerKey = "right" | "left" | "up" | "clut";

export function walkerKey(key: string): WalkerKey | null {
  if (key === "ArrowRight") return "right";
  if (key === "ArrowLeft") return "left";
  if (key === "ArrowUp") return "up";
  if (key === "c" || key === "C") return "clut";
  return null;
}

/** the walker's account of a room it has opened, one line */
export function setSummary(
  name: string,
  set: SetFileV1,
  frames: number,
  clut: number,
  panel: { flat: string; buttons: number } | null,
): string {
  const cells = new Set(set.transitions.map((t) => `${t.from.x},${t.from.z}`)).size;
  const stills = new Set(set.transitions.filter((t) => t.departureStill >= 0).map((t) => standKey(t.from))).size;
  return (
    `${name}: v1 · ${set.gridWidth}x${set.gridHeight} grid, ${cells} standpoints · ` +
    `${set.transitions.length} moves · ${frames} frames · ${stills} stills · ${set.actors.length} cast · ` +
    `clut ${clut + 1}/${set.cluts.length}` +
    (panel ? ` · panel ${panel.flat} (${panel.buttons} buttons)` : " · no panel") +
    (set.warnings.length ? ` · ${set.warnings.length} warnings` : "")
  );
}
