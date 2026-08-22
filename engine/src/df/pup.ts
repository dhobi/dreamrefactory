import { BinaryReader, latin1 } from "./binary";
import { DFContainerFile, readContainerFile } from "./container";
import { DEFAULT_ENCODING, DfEncoding, decodeText, encodeText } from "./text";
import { versionOf } from "./version";

/**
 * PUP ("puppet") files — the conversation close-ups. One file per
 * character encounter (SMETH1.PUP...), holding:
 *  - a dialogue table: each line has voice audio, subtitle TEXT, and an
 *    animation-logic container (lip sync), addressed by ident
 *    ("smeth1.031") from puppetspeak()
 *  - scripts ("Boot Script" + branch scripts) that drive the conversation
 *    with puppetspeak/puppetbevel/puppetevent
 *  - stances: layered talking-head art (Background, Body, Head, Eyes,
 *    Eyebrows, Nose, Jaw, arms/hands), frames in the SHP transparent
 *    codec, anchored like props at the view centre (256,132)
 *
 * Layout (dfet DFpup + probing SMETH1.PUP):
 *   container 0: palette @58, dialogue count i16 @2158,
 *                312-byte records @2160 {i16 stance, i16, i16 tick count @+6,
 *                audio i32 @+8, animLogic i32 @+12, i32,i32,
 *                pascal text @+24 (256B), pascal ident @+280 (32B)}
 *   container 2: script table count i16 @22, 40-byte records @24
 *                {i32 location, i32, pascal name[31]}
 *   container 3: stance register, 64 × i32 @22 -> stance containers;
 *                stance container: 11 layer tables @22, 262 bytes each
 *                {i16 count, i16 anchorY, i16 anchorX, i32 locations[32],
 *                 i32 handles[32]} — the second half is runtime scratch the
 *                engine zeroes on load (0x441082), not data, which is why a
 *                layer of more than {@link MAX_LAYER_FRAMES} frames is an
 *                error in TI.EXE (0x441066) rather than a longer list.
 */

export const PUP_LAYERS = [
  "background", "body", "head", "eyes", "eyebrows", "nose",
  "jaw", "left", "hands1", "right", "hands2",
] as const;

export interface PupDialogue {
  ident: string;
  /**
   * Which {@link PupStance} this line is animated against — the i16 the record
   * opens with.
   *
   * Not decoration and not per-file: it is the line that picks the stance, and
   * TI.EXE reloads the layer tables from it every time one is named
   * (0x440fb0 reads `[record]`, compares it with the puppet's current stance at
   * `+0x14`, and re-reads the 11 layer tables when they differ). Both places a
   * line is named go through it: the line player (0x4406c7) and the
   * `puppetbase` idle pose (0x4405c4).
   *
   * A two-character close-up is where ignoring it shows. WILZEIT1.PUP seats
   * Willie and Colonel Zeitel side by side, and its stances re-use the same 11
   * layer slots for whichever of the two is talking: stances 0/1 put the moving
   * `jaw` on the LEFT face (its frames live at x=171) and hold the right one's
   * mouth on the `nose` slot, stance 2 swaps them (jaw at x=388). Play a
   * stance-2 line against stance 0 and the tick anchors still say 388 while the
   * art comes from the other face's lips — the mouth animates on the wrong
   * character, and the layers whose frame lists are shorter in stance 0
   * (`eyebrows` has 3 where stance 2 has 20) clamp to whatever is there.
   */
  stance: number;
  /** the subtitle, decoded through the file's {@link PupFile.encoding} */
  text: string;
  /**
   * The same subtitle exactly as stored, one character per byte.
   *
   * Kept because two things need the bytes rather than the reading of them:
   * `raw.length` is the on-disk byte count TI paced a missing-audio line by
   * (not `text.length`, which a multi-byte encoding halves), and it is what
   * {@link import("./text").sniffEncoding} takes to guess the encoding of a
   * file whose tree is unknown — a puppet dropped on the editor.
   */
  raw: string;
  audioLocation: number;
  animLogicLocation: number;
  /** byte offset of this line's 312-byte record in container 0 (edit target) */
  record: number;
}

export interface PupLayer {
  /** frame container locations (SHP transparent codec) */
  frames: number[];
  /**
   * Where the layer lives when nothing moves it — the two i16s after the frame
   * count, and the same screen anchor an animLogic record carries per tick.
   *
   * The reason to read it: it says which FACE a layer slot belongs to. A
   * two-character close-up re-uses the eleven slots across its stances
   * (WILZEIT1's `jaw` is at x=171 in stance 0 and x=388 in stance 2), so a tick
   * whose jaw anchor is 388 drawn against a stance whose jaw lives at 171 is the
   * mouth animating on the wrong character — which is exactly what ignoring
   * {@link PupDialogue.stance} did.
   */
  anchorY: number;
  anchorX: number;
}

/**
 * Frames one layer of a stance may hold — TI.EXE's own bound, not a guess: the
 * stance loader raises error 0x1077 on a count above it (0x441066), because the
 * table only has room for that many locations before the runtime handle slots
 * begin. The shipped corpus tops out at 27.
 */
export const MAX_LAYER_FRAMES = 32;
/** the bytes one stance record occupies — {@link PUP_LAYERS} layers of 262 */
const STANCE_SIZE = 22 + 11 * 262;
/** a DreamFactory 1 puppet's single stance is this container — see readPupFile */
const V1_STANCE = 3;

export interface PupStance {
  location: number;
  /** 11 layers in PUP_LAYERS order; empty layers have no frames */
  layers: PupLayer[];
}

export interface PupScriptRef {
  name: string;
  location: number;
}

export interface PupFile {
  file: DFContainerFile;
  paletteRaw: Uint8Array;
  /** dialogue lines by lowercase ident */
  dialogue: Map<string, PupDialogue>;
  scripts: PupScriptRef[];
  stances: PupStance[];
  /**
   * Container of the **answer band** — the 512×120 plate of five riveted
   * plaques the choice bevels are lettered onto, in the
   * [transparent codec](shp.ts), anchored at its centre (256, 60).
   *
   * Every PUP carries its own copy (the art is the same, re-encoded against
   * that puppet's palette) and the engine repaints the band from it before
   * every bevel redraw. Named by a container index at container 0 offset
   * `0x85A` rather than fixed at 4 — which is what it always happens to be —
   * because that is how TI.EXE finds it (0x43f0d5).
   */
  bandLocation: number;
  /**
   * The puppet's own name, from container 0 offset `0x85E` (2142) — a 16-byte
   * field between {@link bandLocation} at `0x85A` and the dialogue count at
   * `0x86E`. This, NOT the file name, is what `currentpuppet()` answers:
   * TI.EXE's openpuppetfile copies it into a static buffer
   * (0x43f103, `strcpy(0x489ffc, container0 + 0x85E)`) and currentpuppet hands
   * that buffer back (0x43ffba).
   *
   * 269 of the 316 puppets across every edition are called "untitled". The ones
   * that are not are exactly the ones a script asks about: TAOOT's inven.shp
   * offers the item you are holding with wording chosen by
   * `switch currentpuppet()` over `"trask1"`, `"trask2"`, `"purs1"` and
   * `"zeit1"` — and PURS1/TRASK1/TRASK2/ZEIT1 are precisely the four that carry
   * a real name. Everyone else falls to that switch's generic arm, which is what
   * the generic arm is for.
   */
  pupName: string;
  /**
   * How often this character fidgets while you read the choices — four
   * `[minTicks, maxTicks]` pairs, one per `idle 1`..`idle 4` line, at 60 ticks
   * to the second.
   *
   * Eight i32s in container 0: the minima at `0x83A` + 4·i and the maxima at
   * `0x84A` + 4·i, immediately before {@link bandLocation} at `0x85A`. TI.EXE's
   * plaque wait reads all eight on entry and seeds each slot with
   * `min + rand(1 .. max-min)` (`0x44165B`…`0x4416B7`, `0x435810` being the
   * 1..n draw), then re-draws the interval every time the slot fires.
   *
   * They are per CHARACTER, which is the argument for reading them rather than
   * picking a plausible constant: across the 55 PUPs in the tree, slot 1 — the
   * blink — ranges from 65 to 200 ticks, so Burns blinks half again as often as
   * Asea because someone decided he should, and Jones's second slot is set to
   * blink-speed so he fidgets. 54 of the 55 have all four set; the demo's
   * `dsmeth.pup` is the exception, and a zero pair simply never fires.
   */
  idleTimers: { minTicks: number; maxTicks: number }[];
  /** what the subtitles were decoded with, and what an edit re-encodes to */
  encoding: DfEncoding;
}

/** one animation tick: per-layer frame + anchor (frame -1 = hidden) */
export interface PupAnimFrame {
  layers: { frame: number; y: number; x: number }[];
}

/**
 * Decode a dialogue line's animLogic container: 82-byte records, one per
 * ~33 ms tick — 16-byte header (dirty-rect bookkeeping) + 11 layer
 * triplets {i16 frame, i16 anchorY, i16 anchorX}. Frame -1 hides the
 * layer; anchors are screen positions the frame's stored offset is
 * subtracted from (the background sits at the view centre 256,132).
 */
export function readAnimLogic(pup: PupFile, location: number): PupAnimFrame[] {
  const c = pup.file.containers[location]?.data;
  if (!c || c.length < 82 || c.length % 82 !== 0) return [];
  const dv = new DataView(c.buffer, c.byteOffset, c.byteLength);
  const out: PupAnimFrame[] = [];
  for (let r = 0; r < c.length / 82; r++) {
    const layers: { frame: number; y: number; x: number }[] = [];
    for (let l = 0; l < 11; l++) {
      const o = r * 82 + 16 + l * 6;
      layers.push({
        frame: dv.getInt16(o, true),
        y: dv.getInt16(o + 2, true),
        x: dv.getInt16(o + 4, true),
      });
    }
    out.push({ layers });
  }
  return out;
}

/**
 * `encoding` is the character set the subtitles are stored in — a property of
 * the language tree the file came from, because no DF file records it (see
 * engine/src/df/text.ts). Idents and script names are ASCII and unaffected by it.
 */
export function readPupFile(data: Uint8Array, encoding: DfEncoding = DEFAULT_ENCODING): PupFile {
  const file = readContainerFile(data);
  const c0 = file.containers[0].data;
  const r0 = new BinaryReader(c0);

  const dialogue = new Map<string, PupDialogue>();
  r0.seek(2158);
  const dcount = r0.i16();
  for (let i = 0; i < dcount; i++) {
    const o = 2160 + i * 312;
    r0.seek(o);
    const stance = r0.i16();
    r0.seek(o + 8);
    const audioLocation = r0.i32();
    const animLogicLocation = r0.i32();
    r0.seek(o + 24);
    const raw = r0.pstr(255);
    r0.seek(o + 280);
    const ident = r0.pstr(31);
    dialogue.set(ident.toLowerCase(), {
      ident,
      stance,
      text: decodeText(raw, encoding),
      raw,
      audioLocation,
      animLogicLocation,
      record: o,
    });
  }

  const scripts: PupScriptRef[] = [];
  const r2 = new BinaryReader(file.containers[2].data);
  r2.seek(22);
  const scount = r2.i16();
  for (let i = 0; i < scount; i++) {
    r2.seek(24 + i * 40);
    const location = r2.i32();
    r2.skip(4);
    scripts.push({ name: r2.pstr(31).toLowerCase(), location });
  }

  /** one stance record: 11 layers of `{i16 count, anchorY, anchorX}` + i32 frames */
  const readStance = (location: number): PupStance | null => {
    const data = file.containers[location]?.data;
    if (!data || data.length < STANCE_SIZE) return null;
    const rs = new BinaryReader(data);
    const layers: PupLayer[] = [];
    for (let l = 0; l < PUP_LAYERS.length; l++) {
      rs.seek(22 + l * 262);
      const count = rs.i16();
      const anchorY = rs.i16();
      const anchorX = rs.i16();
      const frames: number[] = [];
      for (let k = 0; k < Math.min(Math.max(count, 0), MAX_LAYER_FRAMES); k++) frames.push(rs.i32());
      layers.push({ frames, anchorY, anchorX });
    }
    return { location, layers };
  };

  /**
   * The stances.
   *
   * v4 keeps a directory of up to 64 of them — 64 i32 container refs from offset
   * 22 of container 3 — because a v4 puppet can be shot from more than one camera
   * and every dialogue line names the stance it is spoken in.
   *
   * **A DreamFactory 1 puppet has exactly one, and container 3 IS it.** No
   * directory: on all 39 puppets on the Dust CD there is exactly one container of
   * the stance record's own size (22 + 11 * 262 = 2904 bytes) and it is c3 on
   * every one of them, and every dialogue line's `stance` field reads 0. Reading
   * c3 as a directory instead found no stance at all, which is a puppet with a
   * voice, a subtitle and the answers you can give — and no face. Reported from
   * the page in exactly those words.
   */
  const stances: PupStance[] = [];
  if (versionOf(c0) === 1) {
    const only = readStance(V1_STANCE);
    if (only) stances.push(only);
  } else {
    const r3 = new BinaryReader(file.containers[3].data);
    for (let t = 0; t < 64; t++) {
      r3.seek(22 + t * 4);
      const location = r3.i32();
      if (location <= 0 || location >= file.containers.length) break;
      const st = readStance(location);
      if (!st) break;
      stances.push(st);
    }
  }

  // the four idle intervals: minima then maxima, both 4×i32 (see idleTimers)
  const idleTimers = [0, 1, 2, 3].map((i) => {
    r0.seek(0x83a + i * 4);
    const minTicks = r0.i32();
    r0.seek(0x84a + i * 4);
    return { minTicks, maxTicks: r0.i32() };
  });

  r0.seek(0x85a);
  const bandLocation = r0.i32();
  // the puppet's own name, in the 16 bytes before the dialogue count
  const pupName = r0.pstr(15);

  return {
    file,
    paletteRaw: c0.subarray(58, 58 + 2048),
    dialogue,
    scripts,
    stances,
    bandLocation,
    pupName,
    idleTimers,
    encoding,
  };
}

/**
 * Rewrite a dialogue line's subtitle TEXT in place — the puppet editor's edit
 * path. Container 0 is replaced with a copy first (containers are subarray
 * views into the loaded file's buffer, which must stay pristine), so the
 * result serializes through writeContainerFile with only this field changed.
 * Returns false for an unknown ident.
 *
 * Text goes back in the encoding it was read in, clamped to the record's
 * 255-BYTE field — not 255 characters, which in Shift-JIS would be twice the
 * field and would leave a half-character at the end of it.
 */
export function patchDialogueText(pup: PupFile, ident: string, text: string): boolean {
  const line = pup.dialogue.get(ident.toLowerCase());
  if (!line) return false;
  const old = pup.file.containers[0];
  const data = old.data.slice();
  const bytes = encodeText(text, pup.encoding, TEXT_FIELD);
  const at = line.record + 24;
  data[at] = bytes.length;
  data.set(bytes, at + 1);
  data.fill(0, at + 1 + bytes.length, at + 1 + TEXT_FIELD);
  pup.file.containers[0] = { id: old.id, data };
  pup.paletteRaw = data.subarray(58, 58 + 2048);
  line.raw = latin1(bytes);
  line.text = decodeText(line.raw, pup.encoding);
  return true;
}

/** the dialogue record's subtitle field, in bytes after the length byte */
const TEXT_FIELD = 255;
