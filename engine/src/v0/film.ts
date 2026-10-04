/**
 * A film played the way LUNICUS.EXE's player (0x40e038) plays it — and
 * RAVEN.EXE's (0x411464), the same code a month older: in its rect on the
 * screen — top-left at 0,0 for every film in either rip, so a 384-wide one
 * covers Lunicus's maze view and leaves the panel standing — in its own
 * palette, a frame held for its hold in ticks, and a click given to the
 * frame's hotspots.
 *
 * What a hotspot does is Dust's reading ({@link file://../df/mov-v0.ts}):
 * types 1 and 3 end the film, 2 jumps to a frame, and a frame whose hotspots do
 * not play through waits for a click. Esc ends a film: the page's own key.
 */
import { FrameBuffer, decodeFrame } from "../df/image";
import { FLAG_PLAY_THROUGH, FLAG_STEP, FLAG_WAIT_SOUND, nextFrameV0, paletteV0, readMovFileV0 } from "../df/mov-v0";
import type { Co, MachineV0 as Machine } from "./machine";

export const ESCAPE = "Escape";

/**
 * How a film ended: it is over, it chains to another (`to`), it calls another
 * and wants to be come back to at `back`, or it goes back to its caller
 * (RAVEN.EXE 0x411d4d: hotspot and frame types 3, 4 and 5).
 */
export type FilmEnd = "exit" | "chain" | "call" | "return";

/** a press held on a button hotspot is at least this long, in ticks (RAVEN.EXE 0x427373) */
const PRESS_TICKS = 10;
/** and its frame is this thick (0x427382: `_portpensize(3, 3)`) */
const PRESS_PEN = 3;

/**
 * What a film tells the level it plays over (0x40ad60 messages 9, 10, 11): a
 * film's header names two frames, +0x18 for its word (the HUD's line: PULSE
 * GUN ACQUIRED) and +0x16 for its deed (a cabinet's grenades counted in); a
 * film cut short sends both at its end (0x40e649). A click on a hotspot sends
 * the hotspot's index — the elevators' floor buttons.
 */
export interface FilmHooks {
  /** a hook with nothing to wait on is a plain function; one that waits is a generator */
  word?: () => Co | void;
  deed?: () => Co | void;
  button?: (index: number) => void;
  /**
   * Asked on every tick a frame is held: something to play over the film
   * first — the title's Help ▸ About and Help (0x417760), over the title's
   * loop. It leaves the screen as it found it.
   */
  aside?: () => Co | null;
}

/** one film, from frame `start`; answers how it ended and, for a chain or a call, where to */
export function* playOneFilm(
  m: Machine,
  name: string,
  day: number,
  hooks: FilmHooks = {},
  start = 0,
): Co<{ end: FilmEnd; to: string; back: number }> {
  const { path, data } = yield* m.file(name, day);
  const film = readMovFileV0(data);
  const head = film.file.containers[0].data;
  const wordAt = (head[0x18] | (head[0x19] << 8)) << 16 >> 16;
  const deedAt = (head[0x16] | (head[0x17] << 8)) << 16 >> 16;
  let worded = false;
  let deeded = false;
  function* hooksAt(frame: number): Co {
    if (!worded && wordAt >= 0 && frame === wordAt) {
      worded = true;
      yield* hook(hooks.word);
    }
    if (!deeded && deedAt >= 0 && frame === deedAt) {
      deeded = true;
      yield* hook(hooks.deed);
    }
  }
  function* hooksLeft(): Co {
    if (!worded && wordAt >= 0) {
      worded = true;
      yield* hook(hooks.word);
    }
    if (!deeded && deedAt >= 0) {
      deeded = true;
      yield* hook(hooks.deed);
    }
  }
  m.log(`▶ ${path} — ${film.frames.length} frames`);
  m.screen.setPalette(paletteV0(film.paletteRaw));
  const fb = new FrameBuffer();
  let index = Math.min(Math.max(start, 0), film.frames.length - 1);
  let decoded = -1;
  const over = { end: "exit" as FilmEnd, to: "", back: 0 };
  while (index >= 0 && index < film.frames.length) {
    const frame = film.frames[index];
    m.where = `${path} · frame ${index + 1} of ${film.frames.length}`;
    if (m.draws && decoded !== frame.picture) {
      decodeFrame(film.file.containers[frame.picture].data, fb, undefined, "v0");
      m.screen.put(fb.pixels, film.width, film.height, film.top, film.left);
      decoded = frame.picture;
    }
    if (frame.sound && film.file.containers[frame.sound]) filmSound(m, film.file.containers[frame.sound].data);
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
    // a frame with bit 0 is held past its time until the sound has finished
    // (0x40e6e5 → 0x420904): a narration's picture waits for its last word
    function* soundDone(): Co {
      if (frame.flags & FLAG_WAIT_SOUND) while (m.soundBusy()) yield;
    }
    if (skipped) {
      m.stopSound();
      yield* hooksLeft();
      return over;
    }
    if (clicked) {
      // the hotspots in their order (0x411f13): a button (a negative type)
      // counts only if the press is let go on it, and a miss goes on to the next
      const { x, y } = clicked;
      let hit: (typeof live)[number] | undefined;
      for (const h of live) {
        if (!(x >= h.left && x <= h.right && y >= h.top && y <= h.bottom)) continue;
        if (h.type < 0 && !(yield* trackPress(m, [h.top + film.top, h.left + film.left, h.bottom + film.top + 1, h.right + film.left + 1]))) continue;
        hit = h;
        break;
      }
      if (hit) {
        hooks.button?.(live.indexOf(hit));
        // the hotspot's own sound (0x4134db)
        const click = hit.sound ? film.file.containers[Math.abs(hit.sound)] : undefined;
        if (click) filmSound(m, click.data);
      }
      const type = hit ? Math.abs(hit.type) : 0;
      if (type === 1 || (type === 3 && !hit!.film)) {
        yield* hooksLeft();
        return over;
      }
      if (type === 3) {
        yield* hooksLeft();
        return { end: "chain", to: hit!.film, back: 0 };
      }
      if (type === 4) {
        yield* hooksLeft();
        return { end: "call", to: hit!.film, back: hit!.target };
      }
      if (type === 5) {
        yield* hooksLeft();
        return { end: "return", to: "", back: 0 };
      }
      if (type === 2 && hit) {
        yield* soundDone();
        index = hit.target;
        continue;
      }
      if (waits) continue;
    }
    yield* soundDone();
    const next = nextFrameV0(film, index);
    if (next < 0) {
      yield* hooksLeft();
      if (frame.action === 3 && frame.chainTo) return { end: "chain", to: frame.chainTo, back: 0 };
      if (frame.action === 4 && frame.chainTo) return { end: "call", to: frame.chainTo, back: frame.target };
      if (frame.action === 5) return { end: "return", to: "", back: 0 };
      return over;
    }
    index = next;
  }
  yield* hooksLeft();
  return over;
}

/**
 * A film's sound, a frame's or a hotspot's (RAVEN.EXE 0x4134db → 0x428b82,
 * LUNICUS.EXE 0x41010f): it goes on channels 1 and 2, and a channel frees the
 * sound it holds before it takes the next (0x428536, LUNICUS.EXE 0x4202d7).
 * So a narration is cut by the next one — jet.move's Continue, pressed while
 * its first voice speaks, starts the second in its place, not over it.
 */
function filmSound(m: Machine, data: Uint8Array): void {
  m.stopSound();
  m.sound(data);
}

/**
 * A button held down (RAVEN.EXE 0x427373, LUNICUS.EXE 0x41d0a7): a 3-pixel frame
 * inverted round it while the pointer is on it (`_portframerect` in XOR with a
 * 3 by 3 pen), at least {@link PRESS_TICKS} from the press; true if it is let
 * go on the button. `rect` is the Macintosh way, bottom and right exclusive.
 */
export function* trackPress(m: Machine, rect: readonly [number, number, number, number]): Co<boolean> {
  const on = (): boolean => m.pointer.y >= rect[0] && m.pointer.y < rect[2] && m.pointer.x >= rect[1] && m.pointer.x < rect[3];
  const pressed = m.ticks;
  let lit = true;
  const flip = (): void => {
    lit = !lit;
    m.screen.invertFrame(rect, PRESS_PEN);
  };
  m.screen.invertFrame(rect, PRESS_PEN);
  for (;;) {
    const i = m.events.findIndex((e) => e.kind === "up");
    if (i >= 0 || !m.mouseHeld) {
      if (i >= 0) {
        const [e] = m.events.splice(i, 1);
        if (e.kind === "up") m.pointer = { x: e.x, y: e.y };
      }
      break;
    }
    if (on() !== lit) flip();
    yield;
  }
  while (m.ticks - pressed < PRESS_TICKS) yield;
  if (on() !== lit) flip();
  const hit = lit;
  if (lit) m.screen.invertFrame(rect, PRESS_PEN);
  return hit;
}

/**
 * A film and every film it chains to (Lunicus's intro chains to the title,
 * `flip.move`) or calls: a call is kept on a stack five deep (0x4370f4) and a
 * return goes back to the caller at the frame the call named — Jump Raven's
 * help film calls each topic's film, and each ends by coming back.
 */
/** run a film hook, waiting on it only if it is a generator */
function* hook(h?: () => Co | void): Co {
  const ran = h?.();
  if (ran) yield* ran;
}

export function* playFilm(m: Machine, name: string, day: number, hooks: FilmHooks = {}): Co {
  let at = name;
  let from = 0;
  const calls: { name: string; frame: number }[] = [];
  try {
    // unbounded, as the EXE's loop is: a help film is called and returned from for as long as the player browses it
    for (;;) {
      m.film = at;
      const { end, to, back } = yield* playOneFilm(m, at, day, hooks, from);
      if (end === "exit") return;
      if (end === "return") {
        const up = calls.pop();
        if (!up) return;
        m.log(`  back to ${up.name}`);
        at = up.name;
        from = up.frame;
        continue;
      }
      if (end === "call") {
        if (calls.length >= 5) return;
        calls.push({ name: at, frame: back });
        m.log(`  calls ${to}`);
      } else m.log(`  chains to ${to}`);
      at = to;
      from = 0;
    }
  } finally {
    m.film = null;
    m.filmWaiting = false;
  }
}
