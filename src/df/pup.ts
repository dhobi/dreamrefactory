import { BinaryReader } from "./binary";
import { DFContainerFile, readContainerFile } from "./container";

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
 *                312-byte records @2160 {i32,i16,i16, audio i32 @+8,
 *                animLogic i32 @+12, i32,i32, pascal text @+24 (256B),
 *                pascal ident @+280 (32B)}
 *   container 2: script table count i16 @22, 40-byte records @24
 *                {i32 location, i32, pascal name[31]}
 *   container 3: stance register, 64 × i32 @22 -> stance containers;
 *                stance container: 11 layer tables @22, 262 bytes each
 *                {i16 count, i16, i16, i32 locations[64]}
 */

export const PUP_LAYERS = [
  "background", "body", "head", "eyes", "eyebrows", "nose",
  "jaw", "left", "hands1", "right", "hands2",
] as const;

export interface PupDialogue {
  ident: string;
  text: string;
  audioLocation: number;
  animLogicLocation: number;
}

export interface PupLayer {
  /** frame container locations (SHP transparent codec) */
  frames: number[];
}

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

export function readPupFile(data: Uint8Array): PupFile {
  const file = readContainerFile(data);
  const c0 = file.containers[0].data;
  const r0 = new BinaryReader(c0);

  const dialogue = new Map<string, PupDialogue>();
  r0.seek(2158);
  const dcount = r0.i16();
  for (let i = 0; i < dcount; i++) {
    const o = 2160 + i * 312;
    r0.seek(o + 8);
    const audioLocation = r0.i32();
    const animLogicLocation = r0.i32();
    r0.seek(o + 24);
    const text = r0.pstr(255);
    r0.seek(o + 280);
    const ident = r0.pstr(31);
    dialogue.set(ident.toLowerCase(), { ident, text, audioLocation, animLogicLocation });
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

  const stances: PupStance[] = [];
  const r3 = new BinaryReader(file.containers[3].data);
  for (let t = 0; t < 64; t++) {
    r3.seek(22 + t * 4);
    const location = r3.i32();
    if (location <= 0 || location >= file.containers.length) break;
    const data = file.containers[location]?.data;
    if (!data || data.length < 22 + 11 * 262) break;
    const rs = new BinaryReader(data);
    const layers: PupLayer[] = [];
    for (let l = 0; l < 11; l++) {
      rs.seek(22 + l * 262);
      const count = rs.i16();
      rs.skip(4);
      const frames: number[] = [];
      for (let k = 0; k < Math.min(Math.max(count, 0), 64); k++) frames.push(rs.i32());
      layers.push({ frames });
    }
    stances.push({ location, layers });
  }

  return { file, paletteRaw: c0.subarray(58, 58 + 2048), dialogue, scripts, stances };
}
