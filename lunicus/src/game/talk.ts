/**
 * A conversation — LUNICUS.EXE's 0x415000, entered through 0x401570 with a
 * character's name and a line number.
 *
 * ## The file
 *
 * `raife.1` is Raife's talk for progress 0–1 (before the day's briefing),
 * `.2` for 2 and `.3` for 3–4 (table 0x427168), unless the caller names a
 * number itself (the guard's 4 to 7). Its fourCC is 'PUPP', and:
 *
 *   c0  the character's side: +8 u16 "the player's questions are voiced";
 *       +0x0a the face's rect; +0x22 the palette (Macintosh order);
 *       +0x822 i32 ×4 and +0x832 i32 ×4 the shortest and longest wait, in
 *       ticks, between the four idle racks; +0x842 i16 how many lines, and
 *       from +0x844 the lines, 0x138 bytes each: +6 i16 keyframes, +8 i32 the
 *       voice's container, +0xc i32 the puppet track's, +0x18 pstr the
 *       subtitle, +0x118 pstr the line's name (`111-1`, `Startup`, `idle 2`)
 *   c1  the player's side: +2 i16 how many, from +4 records of 0x128 bytes:
 *       +0 i32 the voice, +8 pstr the question as the menu shows it, +0x108
 *       pstr its name
 *   c2  the menus, 0x174 bytes each: a pstr name, and from +0x20 five entries
 *       of 0x44 bytes: u16 "hide once asked", i16 where to go next, pstr the
 *       question's name, and at +0x24 pstr the answer's
 *   c3  the puppet's eight layers, 0x106 bytes each from +2: i16 how many
 *       pictures and from +6 their containers. A track's layer frame is an
 *       index into its layer's list — the backdrop is layer 0's only picture
 *
 * ## The talk
 *
 * The face is drawn as the "Startup" line's first keyframe, the palette fades
 * in, and the "Startup" line plays. Then the menu: each entry whose question is
 * in c1 and not hidden gets a 24-pixel line under the face (0x415ea2). While
 * the player chooses, the idle racks play at random waits (0x415fc0). A choice
 * plays the question's voice (if c0 says the questions are voiced) and the
 * answer (0x4157f8), then goes where the entry says: −3 ends the talk, −2 goes
 * back a menu (out of the first ends it), −1 stays, and n opens menu n.
 *
 * A line's keyframe is `(ticks since it began) / 2`, which is one keyframe per
 * two of the voice's 370-sample blocks at 22050 Hz — the track and the voice
 * are one length. Only a key cuts a line short (0x4158ba reads keyDown events
 * only); Esc ends the talk, as the EXE's key table (0x4174f6) does.
 */
import { decodeFigureV0, decodeFrameV0, type FrameV0 } from "@dreamfactory/engine/df/image-v0";
import { readPuppetTrackV0, readTalkFileV0 as readTalkFile, type TrackKeyV0 } from "@dreamfactory/engine/df/talk-v0";
import { MENU_LINE, MENU_TOP, SCREEN_W, VIEW_H } from "./data";
import { ESCAPE } from "./film";
import type { Co, Machine } from "./machine";
import { clip, inRect, type Rect } from "./screen";

/** a talk file's number for the day's progress `[0x42d1c8]` (table 0x427168) */
export const talkNumber = (progress: number): number => (progress <= 1 ? 1 : progress === 2 ? 2 : 3);

const FACE: Rect = [0, 0, VIEW_H, SCREEN_W];
const MENU: Rect = [MENU_TOP, 0, MENU_TOP + 5 * MENU_LINE, SCREEN_W];
/** the menu's ink and paper (0x415ebd: font 0x58 at 12, fore colour 0; 0x416331: 0x74 while pressed) */
const PAPER = 255;
const INK = 0;
const PRESSED = 0x74;

/** what a test sees of a talk as it goes */
export interface TalkState {
  file: string;
  /** the menu on screen: the questions' texts, in their lines' order */
  menu: string[];
  /** the line playing, by name */
  line: string | null;
  /** every line played, in order */
  played: string[];
}

/**
 * Talk to `name`: the whole of 0x401570 but the maze's redraw, which the base
 * does when this returns.
 */
export function* talk(m: Machine, name: string, number: number, day: number, state: { talk: TalkState | null }): Co {
  const { path, data } = yield* m.file(`${name}.${number}`, day);
  const t = readTalkFile(data);
  const ts: TalkState = { file: path, menu: [], line: null, played: [] };
  state.talk = ts;
  m.log(`talk ${path}: ${t.lines.length} lines, ${t.questions.length} questions`);
  m.stopSound();
  yield* m.fadeOut();

  const pictures = new Map<number, FrameV0>();
  const picture = (container: number): FrameV0 | null => {
    let f = pictures.get(container);
    if (!f) {
      const d = t.containers[container];
      if (!d) return null;
      try {
        f = decodeFrameV0(d);
      } catch {
        f = decodeFigureV0(d);
      }
      pictures.set(container, f);
    }
    return f;
  };
  const tracks = new Map<number, TrackKeyV0[]>();
  const track = (container: number): TrackKeyV0[] => {
    let k = tracks.get(container);
    if (!k) tracks.set(container, (k = t.containers[container] ? readPuppetTrackV0(t.containers[container]) : []));
    return k;
  };

  /** layers 0 and 1 as last drawn — the EXE keeps them composed apart (0x42befc) */
  const base = new Uint8Array(SCREEN_W * VIEW_H);
  let baseKey = "";
  const drawKey = (keys: TrackKeyV0[], prev: number, key: number): void => {
    if (!m.draws || !keys[key]) return;
    let dirty: [number, number, number, number] = [...FACE];
    if (prev >= 0) {
      dirty = [0, 0, 0, 0];
      for (let k = prev + 1; k <= key; k++) {
        const d = keys[k].dirty;
        if (d.bottom <= d.top || d.right <= d.left) continue;
        dirty = dirty[2] <= dirty[0] ? [d.top, d.left, d.bottom, d.right] : [Math.min(dirty[0], d.top), Math.min(dirty[1], d.left), Math.max(dirty[2], d.bottom), Math.max(dirty[3], d.right)];
      }
      if (dirty[2] <= dirty[0] || dirty[3] <= dirty[1]) return;
    }
    dirty = clip(dirty, FACE);
    const L = keys[key].layers;
    const k01 = JSON.stringify([L[0], L[1]]);
    if (k01 !== baseKey) {
      baseKey = k01;
      // compose layers 0 and 1 on the screen's face area, then keep that copy
      m.screen.fill(FACE, PAPER);
      for (let l = 0; l < 2; l++) {
        const f = t.layers[l][L[l].frame] !== undefined ? picture(t.layers[l][L[l].frame]) : null;
        if (f) m.screen.sprite(f, L[l].y, L[l].x, FACE);
      }
      for (let y = 0; y < VIEW_H; y++) base.set(m.screen.pixels.subarray(y * SCREEN_W, (y + 1) * SCREEN_W), y * SCREEN_W);
    }
    for (let y = dirty[0]; y < dirty[2]; y++) m.screen.pixels.set(base.subarray(y * SCREEN_W + dirty[1], y * SCREEN_W + dirty[3]), y * SCREEN_W + dirty[1]);
    for (let l = 2; l < 8; l++) {
      const list = t.layers[l];
      const f = list[L[l].frame] !== undefined ? picture(list[L[l].frame]) : null;
      if (f) m.screen.sprite(f, L[l].y, L[l].x, dirty);
    }
    m.screen.version++;
  };

  const lineNamed = (n: string): number => (n ? t.lines.findIndex((l) => l.name === n) : -1);
  const questionNamed = (n: string): number => (n ? t.questions.findIndex((q) => q.name === n) : -1);
  const keyAbort = (): boolean => {
    const i = m.events.findIndex((e) => e.kind === "key");
    if (i < 0) return false;
    const [e] = m.events.splice(i, 1);
    return e.kind === "key" && e.key === ESCAPE;
  };

  /** 0x4157f8: a line, its voice and its puppet; true when a key ended the talk */
  function* playLine(index: number): Co<boolean> {
    const line = t.lines[index];
    ts.line = line.name;
    ts.played.push(line.name);
    const wave = t.containers[line.wave];
    if (wave) m.sound(wave);
    const length = wave ? m.soundTicks(wave) : 0;
    const keys = track(line.track);
    const start = m.ticks;
    let prev = -1;
    let aborted = false;
    while (m.ticks - start < length) {
      const key = Math.min((m.ticks - start) >> 1, line.frames - 1);
      if (key !== prev && key >= 0) (drawKey(keys, prev, key), (prev = key));
      if (keyAbort()) {
        m.stopSound();
        aborted = true;
        break;
      }
      yield;
    }
    const last = line.frames - 1;
    if (last !== prev && last >= 0) drawKey(keys, prev, last);
    ts.line = null;
    return aborted;
  }

  /** 0x4156be: the player's question, voiced */
  function* askQuestion(index: number): Co<boolean> {
    if (!t.voicedQuestions) return false;
    const wave = t.containers[t.questions[index].wave];
    if (!wave) return false;
    m.sound(wave);
    for (let i = m.soundTicks(wave); i > 0; i--) {
      if (keyAbort()) return (m.stopSound(), true);
      yield;
    }
    return false;
  }

  // the face: the first line's first keyframe (0x415786), then the fade in
  if (t.lines[0]) drawKey(track(t.lines[0].track), -1, 0);
  m.screen.fill(MENU, PAPER);
  yield* m.fadeIn(t.palette);

  let menuAt = 0;
  const stack = [0];
  const asked = [0];
  let rows: number[] = [];
  const drawMenu = (): number => {
    m.screen.fill(MENU, PAPER);
    rows = [];
    ts.menu = [];
    t.menus[stack[menuAt]]?.forEach((e, i) => {
      const q = questionNamed(e.question);
      if (q < 0 || asked[menuAt] & (1 << i)) return;
      const top = MENU_TOP + rows.length * MENU_LINE;
      if (m.font) m.screen.text(m.font, 8, top + 16, t.questions[q].text, INK, MENU);
      rows.push(i);
      ts.menu.push(t.questions[q].text);
    });
    return rows.length;
  };

  /** 0x415fc0: the idle racks, until a choice; -1 ends the talk */
  function* choose(): Co<number> {
    const idle = [1, 2, 3, 4].map((k) => lineNamed(`idle ${k}`));
    const roll = (k: number): number => (idle[k] < 0 ? Infinity : t.idleMin[k] + m.roll(Math.max(1, t.idleMax[k] - t.idleMin[k])));
    const next = [0, 1, 2, 3].map(roll);
    const since = [0, 0, 0, 0];
    for (;;) {
      for (let k = 0; k < 4; k++) {
        if (++since[k] < next[k]) continue;
        since[k] = 0;
        next[k] = roll(k);
        if (yield* playLine(idle[k])) return -1;
      }
      const e = m.take();
      if (e?.kind === "down") {
        const row = Math.floor((e.y - MENU_TOP) / MENU_LINE);
        if (inRect(MENU, e.y, e.x) && row < rows.length) {
          // the press shows in the pressed ink (0x416331)
          const q = questionNamed(t.menus[stack[menuAt]][rows[row]].question);
          if (m.font) m.screen.text(m.font, 8, MENU_TOP + row * MENU_LINE + 16, t.questions[q].text, PRESSED, MENU);
          return rows[row];
        }
      } else if (e?.kind === "key" && e.key === ESCAPE) return -1;
      yield;
    }
  }

  try {
    const startup = lineNamed("Startup");
    if (startup >= 0 && (yield* playLine(startup))) return;
    if (!drawMenu()) return;
    for (let choice = yield* choose(); choice >= 0; choice = yield* choose()) {
      const entry = t.menus[stack[menuAt]][choice];
      const q = questionNamed(entry.question);
      if (q >= 0 && (yield* askQuestion(q))) return;
      const a = lineNamed(entry.answer);
      if (a >= 0 && (yield* playLine(a))) return;
      if (entry.hide) asked[menuAt] |= 1 << choice;
      if (entry.next === -3) return;
      if (entry.next >= 0) {
        if (++menuAt >= 12) return;
        stack[menuAt] = entry.next;
        asked[menuAt] = 0;
        if (drawMenu()) continue;
      } else if (entry.next === -1 && drawMenu()) continue;
      // -2, or a menu with nothing left in it: back out
      for (;;) {
        stack.length = menuAt;
        asked.length = menuAt;
        if (--menuAt < 0) return;
        if (drawMenu()) break;
      }
    }
  } finally {
    ts.menu = [];
    m.stopSound();
    yield* m.fadeOut();
    state.talk = null;
    m.log(`talk ${path} over: ${ts.played.join(", ")}`);
  }
}
