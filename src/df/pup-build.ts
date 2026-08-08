/**
 * Building a PUP puppet from nothing — the write side of [`pup.ts`](pup.ts)'s
 * reader. See [`build.ts`](build.ts) for why these modules exist.
 *
 * A puppet is a conversation close-up: a dialogue table (subtitle text, voice
 * audio, and the animLogic container that lip-syncs it), the scripts that drive
 * the conversation, and stances — layered talking-head art, eleven layers in
 * {@link PUP_LAYERS} order, each with as many frames as its animation needs.
 *
 * The four fixed containers are the format's own convention and are always
 * written: 0 the palette + dialogue table, 1 the boot script, 2 the script table,
 * 3 the stance register.
 */
import { ContainerBuilder, emptyScript, i16, i32, paletteBlock, pstr } from "./build";
import { ContainerRef, DFContainerFile, writeContainerFile } from "./container";
import { MAX_LAYER_FRAMES, PUP_LAYERS } from "./pup";
import { ShpFrame, encodeShpFrame } from "./shp";

/** container 0: the palette, the dialogue count, the 312-byte records */
const C0 = {
  palette: 58,
  dialogueCount: 2158,
  dialogue: 2160,
  recordSize: 312,
  /** the stance the line is animated against (see PupDialogue.stance) */
  stance: 0,
  /** animLogic ticks — the count TI.EXE paces playback by, not just the size */
  ticks: 6,
  audio: 8,
  animLogic: 12,
  text: 24,
  textField: 255,
  ident: 280,
  identField: 31,
} as const;

/** container 2: the script table */
const C2 = { count: 22, first: 24, size: 40, nameField: 31 } as const;

/** container 3: the stance register, and a stance's own layer tables */
const REGISTER = { first: 22, slots: 64 } as const;
const STANCE = { first: 22, layerSize: 262, frames: 6, maxFrames: MAX_LAYER_FRAMES } as const;

/** one animLogic tick: 82 bytes, a 16-byte header then 11 layer triplets */
const ANIM = { size: 82, header: 16, triplet: 6 } as const;

/** where a layer's frame sits on screen when the tick shows it */
export interface PupAnchor {
  y: number;
  x: number;
}

/** the background layer's anchor — the view centre, where a puppet is composited */
export const PUP_CENTRE: PupAnchor = { y: 132, x: 256 };

/**
 * One animation tick, as frame INDEXES into each layer's own frame list (or
 * `null` to hide the layer), which is what the format stores — not container
 * locations.
 */
export interface PupTick {
  /** by layer name; a layer absent from the map is hidden for this tick */
  layers: Partial<Record<(typeof PUP_LAYERS)[number], { frame: number; anchor?: PupAnchor }>>;
}

export interface PupBuildStance {
  /** frames per layer, by layer name; omit a layer the stance doesn't use */
  layers: Partial<Record<(typeof PUP_LAYERS)[number], ShpFrame[]>>;
}

export interface PupBuildLine {
  /** the ident `puppetspeak` addresses the line by ("smeth1.031") */
  ident: string;
  /**
   * Which stance the line's ticks index the layers of — the engine switches to
   * it when the line plays, so a two-character puppet gives the talker's lines
   * the stance whose `jaw` frames are that character's mouth. Defaults to 0.
   */
  stance?: number;
  /** the subtitle, clamped to the record's 255-character field */
  text: string;
  /** the voice audio's container (an `encodeAudioContainer` result), if any */
  audio?: Uint8Array;
  /** the lip-sync ticks — ~33 ms each */
  anim?: PupTick[];
}

export interface PupBuildOptions {
  /** the colour table, as RGB triples (up to 256 entries) */
  palette: ArrayLike<number>;
  /** the conversation's boot script (container 1), named in the script table */
  boot?: Uint8Array;
  /** further named scripts the conversation branches into */
  scripts?: { name: string; script: Uint8Array }[];
  stances?: PupBuildStance[];
  dialogue?: PupBuildLine[];
  /** dummy gap containers, as the shipped puppets carry */
  gaps?: number;
}

export interface PupBuildResult {
  file: DFContainerFile;
  /**
   * Where each stance's layer frames landed, in the order they were given —
   * `frameLocs[stance].background[0]`. The caller needs this to check its own art
   * against what was written; nothing in the file needs it.
   */
  frameLocs: Partial<Record<(typeof PUP_LAYERS)[number], ContainerRef[]>>[];
}

/** a stance container: 11 layer tables of {i16 count, i16, i16, i32 locs[64]} */
function stanceBlock(layerLocs: ContainerRef[][]): Uint8Array {
  const d = new Uint8Array(STANCE.first + PUP_LAYERS.length * STANCE.layerSize);
  layerLocs.forEach((locs, l) => {
    if (locs.length > STANCE.maxFrames) {
      throw new Error(`pup: layer ${PUP_LAYERS[l]} has ${locs.length} frames, max ${STANCE.maxFrames}`);
    }
    const at = STANCE.first + l * STANCE.layerSize;
    i16(d, at, locs.length);
    locs.forEach((loc, k) => i32(d, at + STANCE.frames + k * 4, loc));
  });
  return d;
}

/**
 * An animLogic container: one 82-byte record per tick, each holding a
 * {frame, anchorY, anchorX} triplet per layer. A layer the tick doesn't name is
 * hidden, which the format spells **-1**.
 */
function animBlock(ticks: PupTick[]): Uint8Array {
  const d = new Uint8Array(ticks.length * ANIM.size);
  ticks.forEach((tick, r) => {
    PUP_LAYERS.forEach((layer, l) => {
      const at = r * ANIM.size + ANIM.header + l * ANIM.triplet;
      const shown = tick.layers[layer];
      i16(d, at, shown ? shown.frame : -1);
      i16(d, at + 2, shown?.anchor?.y ?? PUP_CENTRE.y);
      i16(d, at + 4, shown?.anchor?.x ?? PUP_CENTRE.x);
    });
  });
  return d;
}

/**
 * Assemble a puppet. Frames are encoded in the SHP transparent codec (a puppet's
 * layers stack, so every layer above the background needs its holes).
 */
export function buildPupFile(opts: PupBuildOptions): PupBuildResult {
  const dialogue = opts.dialogue ?? [];
  const b = new ContainerBuilder();

  // container 0: palette + dialogue table
  const { data: c0 } = b.reserve(C0.dialogue + dialogue.length * C0.recordSize);
  c0.set(paletteBlock(opts.palette), C0.palette);
  i16(c0, C0.dialogueCount, dialogue.length);

  // container 1: the boot script — the entry point every conversation has
  const bootLoc = b.add(opts.boot ?? emptyScript());
  // container 2: the script table, boot first
  const named = [{ name: "Boot Script", loc: bootLoc }];
  const { data: c2 } = b.reserve(C2.first + (1 + (opts.scripts?.length ?? 0)) * C2.size);
  // container 3: the stance register
  const { data: c3 } = b.reserve(REGISTER.first + REGISTER.slots * 4);
  for (let g = 0; g < (opts.gaps ?? 0); g++) b.gap();

  for (const s of opts.scripts ?? []) named.push({ name: s.name, loc: b.add(s.script) });
  i16(c2, C2.count, named.length);
  named.forEach((s, i) => {
    const at = C2.first + i * C2.size;
    i32(c2, at, s.loc);
    pstr(c2, at + 8, s.name, C2.nameField);
  });

  const stances = opts.stances ?? [];
  if (stances.length > REGISTER.slots) {
    throw new Error(`pup: ${stances.length} stances, register holds ${REGISTER.slots}`);
  }
  const frameLocs: PupBuildResult["frameLocs"] = [];
  stances.forEach((stance, s) => {
    const locsByName: PupBuildResult["frameLocs"][number] = {};
    const layerLocs = PUP_LAYERS.map((layer) => {
      const frames = stance.layers[layer];
      if (!frames?.length) return [];
      const locs = frames.map((f) => b.add(encodeShpFrame(f)));
      locsByName[layer] = locs;
      return locs;
    });
    frameLocs.push(locsByName);
    i32(c3, REGISTER.first + s * 4, b.add(stanceBlock(layerLocs)));
  });

  dialogue.forEach((line, i) => {
    const at = C0.dialogue + i * C0.recordSize;
    i16(c0, at + C0.stance, line.stance ?? 0);
    if (line.audio) i32(c0, at + C0.audio, b.add(line.audio));
    if (line.anim?.length) {
      i16(c0, at + C0.ticks, line.anim.length);
      i32(c0, at + C0.animLogic, b.add(animBlock(line.anim)));
    }
    pstr(c0, at + C0.text, line.text, C0.textField);
    pstr(c0, at + C0.ident, line.ident, C0.identField);
  });

  return { file: b.finish(), frameLocs };
}

/** {@link buildPupFile}, serialized */
export function buildPupBytes(opts: PupBuildOptions): Uint8Array {
  return writeContainerFile(buildPupFile(opts).file);
}
