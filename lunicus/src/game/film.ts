/**
 * A film played the way LUNICUS.EXE's player (0x40e038) plays it: in its rect
 * on the screen — top-left at 0,0 for every film in the rip, so a 384-wide one
 * covers the maze view and leaves the panel standing — in its own palette, a
 * frame held for its hold in ticks, and a click given to the frame's hotspots.
 *
 * What a hotspot does is Dust's reading ({@link file://../../../engine/src/df/mov-v0.ts}):
 * types 1 and 3 end the film, 2 jumps to a frame, and a frame whose hotspots do
 * not play through waits for a click. Esc ends a film: the page's own key.
 */
import { FrameBuffer, decodeFrame } from "@dreamfactory/engine/df/image";
import { FLAG_PLAY_THROUGH, FLAG_STEP, nextFrameV0, paletteV0, readMovFileV0 } from "@dreamfactory/engine/df/mov-v0";
import type { Co, Machine } from "./machine";

export const ESCAPE = "Escape";

export type FilmEnd = "exit" | "chain";

/**
 * What a film tells the level it plays over (0x40ad60 messages 9, 10, 11): a
 * film's header names two frames, +0x18 for its word (the HUD's line: PULSE
 * GUN ACQUIRED) and +0x16 for its deed (a cabinet's grenades counted in); a
 * film cut short sends both at its end (0x40e649). A click on a hotspot sends
 * the hotspot's index — the elevators' floor buttons.
 */
export interface FilmHooks {
  word?: () => Co;
  deed?: () => Co;
  button?: (index: number) => void;
  /**
   * Asked on every tick a frame is held: something to play over the film
   * first — the title's Help ▸ About and Help (0x417760), over the title's
   * loop. It leaves the screen as it found it.
   */
  aside?: () => Co | null;
}

/** one film; answers how it ended and, for a chain, where to */
export function* playOneFilm(m: Machine, name: string, day: number, hooks: FilmHooks = {}): Co<{ end: FilmEnd; to: string }> {
  const { path, data } = yield* m.file(name, day);
  const film = readMovFileV0(data);
  const head = film.file.containers[0].data;
  const wordAt = (head[0x18] | (head[0x19] << 8)) << 16 >> 16;
  const deedAt = (head[0x16] | (head[0x17] << 8)) << 16 >> 16;
  let worded = false;
  let deeded = false;
  function* hooksAt(frame: number): Co {
    if (!worded && wordAt >= 0 && frame === wordAt) (worded = true), hooks.word && (yield* hooks.word());
    if (!deeded && deedAt >= 0 && frame === deedAt) (deeded = true), hooks.deed && (yield* hooks.deed());
  }
  function* hooksLeft(): Co {
    if (!worded && wordAt >= 0) (worded = true), hooks.word && (yield* hooks.word());
    if (!deeded && deedAt >= 0) (deeded = true), hooks.deed && (yield* hooks.deed());
  }
  m.log(`▶ ${path} — ${film.frames.length} frames`);
  m.screen.setPalette(paletteV0(film.paletteRaw));
  const fb = new FrameBuffer();
  let index = 0;
  let decoded = -1;
  while (index >= 0 && index < film.frames.length) {
    const frame = film.frames[index];
    m.where = `${path} · frame ${index + 1} of ${film.frames.length}`;
    if (m.draws && decoded !== frame.picture) {
      decodeFrame(film.file.containers[frame.picture].data, fb);
      m.screen.put(fb.pixels, film.width, film.height, film.top, film.left);
      decoded = frame.picture;
    }
    if (frame.sound && film.file.containers[frame.sound]) m.sound(film.file.containers[frame.sound].data);
    yield* hooksAt(index);

    const hold = Math.max(frame.holdTicks, film.framerate);
    // a step frame (the intro's pause before its title) holds and goes on
    // a negative type is the same hotspot as a button that tracks the press (0x40eb01): the
    // elevators' floor buttons are −1, an exit with the press shown
    const live = frame.hotspots.filter((h) => Math.abs(h.type) >= 1 && Math.abs(h.type) <= 5);
    const waits = live.length > 0 && !(frame.flags & (FLAG_PLAY_THROUGH | FLAG_STEP));
    let clicked: { x: number; y: number } | null = null;
    let skipped = false;
    m.filmWaiting = waits;
    m.filmHotspots = waits ? live : [];
    for (let t = 0; waits || t < hold; t++) {
      const aside = hooks.aside?.();
      if (aside) {
        yield* aside;
        m.filmWaiting = waits;
        m.filmHotspots = live;
      }
      const e = m.take();
      if (e?.kind === "down") clicked = { x: e.x - film.left, y: e.y - film.top };
      if (e?.kind === "key" && e.key === ESCAPE) skipped = true;
      if (clicked || skipped) break;
      yield;
    }
    m.filmWaiting = false;
    if (skipped) {
      m.speaker.stop();
      yield* hooksLeft();
      return { end: "exit", to: "" };
    }
    if (clicked) {
      const { x, y } = clicked;
      const hit = live.find((h) => x >= h.left && x <= h.right && y >= h.top && y <= h.bottom);
      if (hit) hooks.button?.(live.indexOf(hit));
      const type = hit ? Math.abs(hit.type) : 0;
      if (type === 1 || type === 3) return yield* hooksLeft(), { end: "exit", to: "" };
      if (type === 2 && hit) {
        index = hit.target;
        continue;
      }
      if (waits) continue;
    }
    const next = nextFrameV0(film, index);
    if (next < 0) {
      yield* hooksLeft();
      return frame.action === 3 && frame.chainTo ? { end: "chain", to: frame.chainTo } : { end: "exit", to: "" };
    }
    index = next;
  }
  yield* hooksLeft();
  return { end: "exit", to: "" };
}

/** a film and every film it chains to (the intro chains to the title, `flip.move`) */
export function* playFilm(m: Machine, name: string, day: number, hooks: FilmHooks = {}): Co {
  let at = name;
  try {
    for (let guard = 0; guard < 16; guard++) {
      m.film = at;
      const { end, to } = yield* playOneFilm(m, at, day, hooks);
      if (end !== "chain") return;
      m.log(`  chains to ${to}`);
      at = to;
    }
  } finally {
    m.film = null;
    m.filmWaiting = false;
  }
}
