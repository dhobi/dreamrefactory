/**
 * DreamFactory 0's conversations — a *Lunicus* talk file (`raife.1`, `sasha.3`
 * …, one per character per day; `guard.1`..`7` and `queen.1` too).
 *
 * What is read so far, container by container:
 *
 *   0     the character's side: the replies, each with the node it answers
 *         (`111-1`), in records of 312 bytes behind a header ({@link readTalkFileV0})
 *   1     the player's side: the question menu, the same node numbers
 *   2     the authoring tool's layout: "Rack 1", "Rack 2" …, each a Puppet and a
 *         Wave (a track and a voice line below)
 *   3     the puppet's eight layers: from +2, 0x106 bytes each, an i16 count
 *         and from +6 the containers of the layer's pictures (the talk,
 *         `lunicus/src/game/talk.ts`, reads it)
 *   4     the backdrop: a {@link file://./image-v0.ts} frame, 512x264, anchored
 *         at its centre
 *   5..   the talking head's frames, the same codec
 *   then  a voice line ({@link file://./audio.ts}'s `decodeAudioV0`) and the
 *         puppet track that animates it, pair after pair
 *
 * A PUPPET TRACK is keyframes of 76 bytes:
 *
 *   0x00  u16  tick
 *   0x02  u16  (0 wherever looked)
 *   0x04  i16 ×4  the rectangle this keyframe repaints: top, left, bottom, right
 *                 — the whole screen on the first, the mouth after
 *   0x0c  8 layers of {u16 frame, i16 y, i16 x, u16 (constant)}
 *
 * Layer 0 is the backdrop, placed at its own anchor so it fills the screen. A
 * slot a keyframe does not use holds coordinates far off screen, which the
 * clipping discards. A track has exactly one keyframe per two of its voice
 * line's blocks, on every line in the game that has one — a few lines (the
 * queen's) have an empty puppet slot and play unanimated. The tick field usually counts up by
 * two from 0, but some tracks carry a stale one (0,0,0 … 26), so a player should
 * go by POSITION; that the engine does too is expected but not yet read.
 */

import { readContainerFile } from "./container";
import { paletteV0 } from "./mov-v0";
import type { PupDialogue, PupFile } from "./pup";
import { DEFAULT_ENCODING } from "./text";

export interface TrackLayerV0 {
  /** an index into the layer's list of pictures in container 3 (LUNICUS.EXE 0x415b9e) */
  frame: number;
  y: number;
  x: number;
  /** a u16 that has been one constant wherever looked */
  unknown: number;
}

export interface TrackKeyV0 {
  tick: number;
  unknown: number;
  dirty: { top: number; left: number; bottom: number; right: number };
  layers: TrackLayerV0[];
}

export const TRACK_KEY_BYTES = 76;
export const TRACK_LAYERS = 8;

/**
 * An empty rack slot: a zero u16 and one byte that is whatever the authoring
 * tool's buffer held. Racks with no wave or no puppet are stored so, and read
 * as a sound of no blocks and a track of no keyframes.
 */
export function isEmptySlotV0(data: Uint8Array): boolean {
  return data.length === 3 && data[0] === 0 && data[1] === 0;
}

export function readPuppetTrackV0(data: Uint8Array): TrackKeyV0[] {
  if (isEmptySlotV0(data)) return [];
  if (data.length % TRACK_KEY_BYTES) throw new Error(`v0 track: ${data.length} bytes is not whole keyframes`);
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return Array.from({ length: data.length / TRACK_KEY_BYTES }, (_, k) => {
    const at = k * TRACK_KEY_BYTES;
    return {
      tick: v.getUint16(at, true),
      unknown: v.getUint16(at + 2, true),
      dirty: {
        top: v.getInt16(at + 4, true),
        left: v.getInt16(at + 6, true),
        bottom: v.getInt16(at + 8, true),
        right: v.getInt16(at + 10, true),
      },
      layers: Array.from({ length: TRACK_LAYERS }, (_, l) => {
        const p = at + 12 + l * 8;
        return {
          frame: v.getUint16(p, true),
          y: v.getInt16(p + 2, true),
          x: v.getInt16(p + 4, true),
          unknown: v.getUint16(p + 6, true),
        };
      }),
    };
  });
}

/** the talk file's backdrop container */
export const TALK_BACKDROP = 4;
/** where its head frames begin */
export const TALK_FIRST_FRAME = 5;

/** one of the character's lines: c0's records */
export interface TalkLineV0 {
  frames: number;
  wave: number;
  track: number;
  subtitle: string;
  name: string;
}
/** one of the player's questions: c1's records */
export interface TalkQuestionV0 {
  wave: number;
  text: string;
  name: string;
}
/** one entry of a menu: c2's */
export interface TalkEntryV0 {
  hide: boolean;
  next: number;
  question: string;
  answer: string;
}

const pstr = (d: Uint8Array, at: number): string => String.fromCharCode(...d.subarray(at + 1, at + 1 + d[at]));

/** a talk file read whole (the layout: lunicus/src/game/talk.ts's module comment) */
export interface TalkFileV0 {
  voicedQuestions: boolean;
  palette: Uint8ClampedArray;
  idleMin: number[];
  idleMax: number[];
  lines: TalkLineV0[];
  questions: TalkQuestionV0[];
  menus: TalkEntryV0[][];
  /** per layer, its pictures' containers */
  layers: number[][];
  containers: Uint8Array[];
}

export function readTalkFileV0(data: Uint8Array): TalkFileV0 {
  const file = readContainerFile(data);
  const c = file.containers.map((x) => x.data);
  const dv = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength);
  const c0 = c[0];
  const v0 = dv(c0);
  const lines: TalkLineV0[] = [];
  for (let i = 0; i < v0.getInt16(0x842, true); i++) {
    const r = 0x844 + i * 0x138;
    lines.push({
      frames: v0.getInt16(r + 6, true),
      wave: v0.getInt32(r + 8, true),
      track: v0.getInt32(r + 0xc, true),
      subtitle: pstr(c0, r + 0x18),
      name: pstr(c0, r + 0x118),
    });
  }
  const v1 = dv(c[1]);
  const questions: TalkQuestionV0[] = [];
  for (let i = 0; i < v1.getInt16(2, true); i++) {
    const r = 4 + i * 0x128;
    questions.push({ wave: v1.getInt32(r, true), text: pstr(c[1], r + 8), name: pstr(c[1], r + 0x108) });
  }
  const v2 = dv(c[2]);
  const menus: TalkEntryV0[][] = [];
  for (let m = 0; (m + 1) * 0x174 <= c[2].length; m++) {
    menus.push(
      Array.from({ length: 5 }, (_, i) => {
        const e = m * 0x174 + 0x20 + i * 0x44;
        return { hide: v2.getInt16(e, true) !== 0, next: v2.getInt16(e + 2, true), question: pstr(c[2], e + 4), answer: pstr(c[2], e + 0x24) };
      }),
    );
  }
  const v3 = dv(c[3]);
  const layers = Array.from({ length: 8 }, (_, l) => {
    const r = l * 0x106;
    const n = v3.getInt16(r + 2, true);
    return Array.from({ length: Math.max(0, n) }, (_, k) => v3.getInt32(r + 8 + k * 4, true));
  });
  return {
    voicedQuestions: v0.getUint16(8, true) !== 0,
    palette: paletteV0(c0.subarray(0x22, 0x822)),
    idleMin: [0, 1, 2, 3].map((k) => v0.getInt32(0x822 + 4 * k, true)),
    idleMax: [0, 1, 2, 3].map((k) => v0.getInt32(0x832 + 4 * k, true)),
    lines,
    questions,
    menus,
    layers,
    containers: c,
  };
}


/**
 * A talk file as the {@link PupFile} the puppet editor reads, so it can show a
 * Lunicus conversation without a player of its own — the bridge the movie
 * editor has in `movFileFromV0`. It is a picture of the file, not a way back
 * into one.
 *
 * One stance, the eight layers of container 3, each at no anchor of its own
 * (a v0 track places every picture itself). The lines are the character's, by
 * name; the player's questions follow them as lines of their own, `q ` and the
 * question's name, with a voice and no face — so both sides of a talk can be
 * heard. A line's animation is its puppet track, which {@link file://./pup.ts}'s
 * `readAnimLogic` reads through {@link readPuppetTrackV0} for a file with
 * `dfV0` set.
 */
export function pupFileFromV0(data: Uint8Array): PupFile {
  const t = readTalkFileV0(data);
  const file = readContainerFile(data);
  const dialogue = new Map<string, PupDialogue>();
  t.lines.forEach((l, i) => {
    dialogue.set(l.name.toLowerCase(), {
      ident: l.name,
      stance: 0,
      text: l.subtitle,
      raw: l.subtitle,
      audioLocation: l.wave,
      animLogicLocation: l.track,
      record: 0x844 + i * 0x138,
    });
  });
  t.questions.forEach((q, i) => {
    dialogue.set(`q ${q.name}`.toLowerCase(), {
      ident: `q ${q.name}`,
      stance: 0,
      text: q.text,
      raw: q.text,
      audioLocation: q.wave,
      animLogicLocation: 0,
      record: 4 + i * 0x128,
    });
  });
  return {
    file,
    paletteRaw: file.containers[0].data.slice(0x22, 0x822),
    dialogue,
    scripts: [],
    stances: [{ location: 3, layers: t.layers.map((frames) => ({ frames, anchorY: 0, anchorX: 0 })) }],
    bandLocation: -1,
    pupName: "",
    idleTimers: t.idleMin.map((minTicks, k) => ({ minTicks, maxTicks: t.idleMax[k] })),
    encoding: DEFAULT_ENCODING,
    dfV0: true,
  };
}
