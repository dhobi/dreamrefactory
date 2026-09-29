/**
 * A conversation — LUNICUS.EXE's 0x415000, RAVEN.EXE's 0x41e5c4: the same code
 * in both but for how the two lay out their buffers. Lunicus enters it through
 * 0x401570 with a character's name and a line number (`raife.1`); Jump Raven
 * names the file itself (`bati.pupp`, `lark.mupp`).
 *
 * ## The file
 *
 * Its fourCC is 'PUPP', and:
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
import { decodeFigureV0, decodeFrameV0, type FrameV0 } from "../df/image-v0";
import { readPuppetTrackV0, readTalkFileV0 as readTalkFile, type TrackKeyV0 } from "../df/talk-v0";
import { ESCAPE } from "./film";
import type { Co, MachineV0 as Machine } from "./machine";
import { SCREEN_W, clip, inRect, type Rect } from "./screen";

/** the face: the window's top 264 rows (0x415000 sets 0x108 as the menu's top) */
const VIEW_H = 0x108;
/** a conversation's menu lines: 24 px each from y 264, the text at +8, +16 (LUNICUS.EXE 0x415f89, 0x415f24) */
export const MENU_TOP = 0x108;
export const MENU_LINE = 0x18;

const MENU: Rect = [MENU_TOP, 0, MENU_TOP + 5 * MENU_LINE, SCREEN_W];
/**
 * How a game dresses the menu. Lunicus's are the defaults: white paper, ink 0,
 * and 0x74 while a line is pressed (LUNICUS.EXE 0x415ebd: font 0x58 at 12, fore
 * colour 0; 0x416331). Jump Raven lays the menu on a picture — `puppet`'s
 * container 0, five dark bars that RAVEN.EXE loads at startup (0x40f04d) and
 * copies under the menu (0x41e8c1) — and writes in 0x19, pressed 0x28
 * (0x41f4c4, 0x41f926). Its faces are 352 wide, not the window's 512: a
 * keyframe's coordinates are the face's own, and the face goes into the window
 * 80 in (0x41ef54, 0x41f2c3), between the two side panels the game draws
 * before the talk.
 */
export interface TalkLook {
  /** the face's width, and where its left edge lands in the window */
  faceWidth?: number;
  faceLeft?: number;
  /** drawn with its top-left at the menu's (264, 0); none is white paper */
  menuBackdrop?: FrameV0 | null;
  ink?: number;
  pressed?: number;
}
const PAPER = 255;

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
 * A conversation from the talk file the game names (`raife.1`, `bati.pupp`),
 * looked for in the day's folder first: the whole of 0x415000. It fades in and
 * out itself, but whatever was on the screen before is the caller's: Lunicus's
 * wrapper fades it out first (0x401616), Jump Raven's draws the side panels
 * (0x42696d).
 */
export function* talk(m: Machine, file: string, day: number, state: { talk: TalkState | null }, look: TalkLook = {}): Co {
  const FACE_LEFT = look.faceLeft ?? 0;
  const face: Rect = [0, FACE_LEFT, VIEW_H, FACE_LEFT + (look.faceWidth ?? SCREEN_W)];
  const INK = look.ink ?? 0;
  const PRESSED = look.pressed ?? 0x74;
  const menuPaper = (): void => {
    if (look.menuBackdrop) m.screen.spriteAt(look.menuBackdrop, MENU_TOP, 0, MENU);
    else m.screen.fill(MENU, PAPER);
  };
  const { path, data } = yield* m.file(file, day);
  const t = readTalkFile(data);
  const ts: TalkState = { file: path, menu: [], line: null, played: [] };
  state.talk = ts;
  m.log(`talk ${path}: ${t.lines.length} lines, ${t.questions.length} questions`);
  m.stopSound();

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
    let dirty: [number, number, number, number] = [...face];
    if (prev >= 0) {
      dirty = [0, 0, 0, 0];
      for (let k = prev + 1; k <= key; k++) {
        const d = keys[k].dirty;
        if (d.bottom <= d.top || d.right <= d.left) continue;
        const l = d.left + FACE_LEFT;
        const r = d.right + FACE_LEFT;
        dirty = dirty[2] <= dirty[0] ? [d.top, l, d.bottom, r] : [Math.min(dirty[0], d.top), Math.min(dirty[1], l), Math.max(dirty[2], d.bottom), Math.max(dirty[3], r)];
      }
      if (dirty[2] <= dirty[0] || dirty[3] <= dirty[1]) return;
    }
    dirty = clip(dirty, face);
    const L = keys[key].layers;
    const k01 = JSON.stringify([L[0], L[1]]);
    if (k01 !== baseKey) {
      baseKey = k01;
      // compose layers 0 and 1 on the screen's face area, then keep that copy
      m.screen.fill(face, PAPER);
      for (let l = 0; l < 2; l++) {
        const f = t.layers[l][L[l].frame] !== undefined ? picture(t.layers[l][L[l].frame]) : null;
        if (f) m.screen.sprite(f, L[l].y, L[l].x + FACE_LEFT, face);
      }
      for (let y = 0; y < VIEW_H; y++) base.set(m.screen.pixels.subarray(y * SCREEN_W, (y + 1) * SCREEN_W), y * SCREEN_W);
    }
    for (let y = dirty[0]; y < dirty[2]; y++) m.screen.pixels.set(base.subarray(y * SCREEN_W + dirty[1], y * SCREEN_W + dirty[3]), y * SCREEN_W + dirty[1]);
    for (let l = 2; l < 8; l++) {
      const list = t.layers[l];
      const f = list[L[l].frame] !== undefined ? picture(list[L[l].frame]) : null;
      if (f) m.screen.sprite(f, L[l].y, L[l].x + FACE_LEFT, dirty);
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
  menuPaper();
  yield* m.fadeIn(t.palette);

  let menuAt = 0;
  const stack = [0];
  const asked = [0];
  let rows: number[] = [];
  const drawMenu = (): number => {
    menuPaper();
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
