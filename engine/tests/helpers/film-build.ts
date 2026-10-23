/**
 * Dust's (v1) and RedJack's (v5) films built from nothing, for the engine's
 * own suites — v4's have a builder of their own in the engine
 * (`df/mov-build.ts`), these two only the readers (`df/mov-v1.ts`,
 * `df/mov-v5.ts`), whose module comments give the layouts. Every field not
 * named here stays zero; container references are the segment's own
 * (relative to its header), as the files keep them.
 */
import { encodeAudioContainer } from "@dreamfactory/engine/df/audio";
import { ContainerBuilder, i16, i32, pstr } from "@dreamfactory/engine/df/build";
import { encodeFrame } from "@dreamfactory/engine/df/image";

/** a v4-codec picture `w` by `h` of the given pixels (what a v1 film's frames are) */
export const artV1 = (pixels: number[] | Uint8Array, w: number, h: number): Uint8Array =>
  encodeFrame(Uint8Array.from(pixels), w, h);

/** a chunked sound of `n` samples at 1000 Hz */
export const soundChunk = (n: number): Uint8Array =>
  encodeAudioContainer({ sampleRate: 1000, samples: new Float32Array(n).fill(0.25) });

export interface HotspotV1Spec {
  type: number;
  rect?: [number, number, number, number];
  sound?: number;
  target?: number;
}
export interface FrameV1Spec {
  /** the picture's container, relative to the segment's header */
  picture: number;
  hold?: number;
  action?: number;
  target?: number;
  flags2?: number;
  sound?: number;
  /** the +0x30 pstr, raw: a name, or whatever bytes a test wants there */
  chain?: string;
  effect?: { code: number; block?: number; rect?: [number, number, number, number] };
  hotspots?: HotspotV1Spec[];
  /** the record's hotspot count and offset, when a test wants them to lie */
  hotspotCount?: number;
  hotspotAt?: number;
}
export interface SegmentV1Spec {
  frames: FrameV1Spec[];
  /** the containers after the header, in order (refs 1 …) */
  containers: Uint8Array[];
  height?: number;
  width?: number;
  framerate?: number;
  soundBank?: number;
  bedBank?: number;
  playlist?: number[];
  playlistLoop?: number;
  /** 0-based, -1 none */
  actionFrames?: [number, number];
  /** what the header says, if not the frames' own count */
  frameCount?: number;
  /** cut the header short after this many bytes */
  truncate?: number;
  /** where the chain goes on: by default the next segment's header, 0 on the last */
  next?: number;
  /** the 256 × 8-byte palette as stored */
  palette?: Uint8Array;
}

const V1 = { frames: 0x8c2, frame: 80 } as const;
const HOTSPOT_V1: Record<number, number> = { 1: 0xe, 2: 0x10, 3: 0x2e, 4: 0x30, 5: 0xe };

/** a v1 film of one or more segments, each header followed by its containers */
export function movV1(segments: SegmentV1Spec[]): Uint8Array {
  const b = new ContainerBuilder();
  let at = 0;
  const heads = segments.map((s) => {
    const h = at;
    at += 1 + s.containers.length;
    return h;
  });
  segments.forEach((s, k) => {
    const spots = s.frames.flatMap((f) => f.hotspots ?? []);
    const size = V1.frames + s.frames.length * V1.frame + spots.reduce((a, h) => a + (HOTSPOT_V1[Math.abs(h.type)] ?? 0xe), 0);
    const c0 = new Uint8Array(size);
    i32(c0, 2, 1);
    i16(c0, 0x18, s.frameCount ?? s.frames.length);
    i16(c0, 0x1a, s.soundBank ?? 0);
    i16(c0, 0x1c, s.bedBank ?? 0);
    i16(c0, 0x22, s.height ?? 2);
    i16(c0, 0x24, s.width ?? 2);
    i16(c0, 0x26, s.framerate ?? 0);
    i16(c0, 0x2e, s.actionFrames?.[0] ?? -1);
    i16(c0, 0x30, s.actionFrames?.[1] ?? -1);
    i16(c0, 0x34, s.playlist?.length ?? 0);
    i16(c0, 0x36, s.next ?? heads[k + 1] ?? 0);
    (s.playlist ?? []).forEach((e, i) => i16(c0, 0x83e + 2 * i, e));
    i32(c0, 0x8be, s.playlistLoop ?? 0);
    if (s.palette) c0.set(s.palette, 0x3e);
    let p = V1.frames + s.frames.length * V1.frame;
    s.frames.forEach((f, i) => {
      const r = V1.frames + i * V1.frame;
      i16(c0, r, f.hotspotCount ?? f.hotspots?.length ?? 0);
      i32(c0, r + 2, f.hold ?? 0);
      i16(c0, r + 6, f.effect?.code ?? 0);
      i16(c0, r + 8, f.effect?.block ?? 0);
      i16(c0, r + 0x16, f.action ?? 6);
      i16(c0, r + 0x18, f.target ?? 0);
      i16(c0, r + 0x1a, f.flags2 ?? 0);
      i16(c0, r + 0x1c, f.picture);
      i32(c0, r + 0x20, f.sound ?? 0);
      i16(c0, r + 0x24, f.hotspotAt ?? (f.hotspots?.length ? p : 0));
      (f.effect?.rect ?? [0, 0, 0, 0]).forEach((v, j) => i16(c0, r + 0x28 + 2 * j, v));
      if (f.chain !== undefined) pstr(c0, r + 0x30, f.chain);
      for (const h of f.hotspots ?? []) {
        i16(c0, p, h.type);
        (h.rect ?? [0, 0, 1, 1]).forEach((v, j) => i16(c0, p + 2 + 2 * j, v));
        if ((HOTSPOT_V1[Math.abs(h.type)] ?? 0) > 0xa) i16(c0, p + 0xa, h.sound ?? 0);
        if (Math.abs(h.type) === 2) i16(c0, p + 0xe, h.target ?? 0);
        p += HOTSPOT_V1[Math.abs(h.type)] ?? 0xe;
      }
    });
    b.add(s.truncate === undefined ? c0 : c0.slice(0, s.truncate));
    for (const c of s.containers) b.add(c);
  });
  return b.bytes();
}

export interface RegionV5Spec {
  type: number;
  rect?: [number, number, number, number];
  sound?: string;
  event?: string;
  target?: string;
}
export interface FrameV5Spec {
  name: string;
  /** the picture's container, relative */
  picture: number;
  /** the logic container, relative; 0 none */
  logic?: number;
}
export interface LogicV5Spec {
  type?: number;
  hold?: number;
  flags?: number;
  sound?: string;
  event?: string;
  target?: string;
  regions?: RegionV5Spec[];
  /** the region count stored, if not the regions' own */
  regionCount?: number;
  /** cut the container short after this many bytes */
  truncate?: number;
}

/** a v5 frame logic container (MLGC) */
export function logicV5(spec: LogicV5Spec): Uint8Array {
  const regions = spec.regions ?? [];
  const d = new Uint8Array(0x5e + regions.length * 68);
  i16(d, 0x18, spec.type ?? 6);
  i32(d, 0x1a, spec.hold ?? 0);
  d[0x1e] = spec.flags ?? 0;
  pstr(d, 0x2a, spec.sound ?? "");
  pstr(d, 0x3a, spec.event ?? "");
  pstr(d, 0x4a, spec.target ?? "");
  i32(d, 0x5a, spec.regionCount ?? regions.length);
  regions.forEach((r, g) => {
    const off = 0x5e + g * 68;
    i16(d, off + 4, r.type);
    (r.rect ?? [0, 0, 1, 1]).forEach((v, j) => i16(d, off + 12 + 2 * j, v));
    pstr(d, off + 20, r.sound ?? "");
    pstr(d, off + 36, r.event ?? "");
    pstr(d, off + 52, r.target ?? "");
  });
  return spec.truncate === undefined ? d : d.slice(0, spec.truncate);
}

/** a v5 one-shot table (MSND): each record's container (relative), name, and the name of the one it is followed by */
export function oneShotsV5(records: { loc: number; name: string; follow?: string; pan?: number; flags?: number }[], count = records.length): Uint8Array {
  const d = new Uint8Array(0x20 + records.length * 48);
  i32(d, 0x1c, count);
  records.forEach((r, i) => {
    const at = 0x20 + i * 48;
    i16(d, at + 4, r.pan ?? 128);
    i16(d, at + 6, r.flags ?? 0);
    i32(d, at + 10, r.loc);
    pstr(d, at + 16, r.name);
    if (r.follow) pstr(d, at + 32, r.follow);
  });
  return d;
}

/** a v5 film loop table (MTHM): its records (container, relative; name) and the order they play in, 1-based */
export function loopTableV5(records: { loc: number; name: string }[], order: number[]): Uint8Array {
  const d = new Uint8Array(0x226 + records.length * 34);
  i16(d, 0x1c, order.length);
  order.forEach((o, i) => i16(d, 0x1e + 2 * i, o));
  i16(d, 0x222, records.length);
  records.forEach((r, i) => {
    i32(d, 0x226 + i * 34 + 12, r.loc);
    pstr(d, 0x226 + i * 34 + 18, r.name);
  });
  return d;
}

/** a v5 picture `h` by `w` with its palette's entry 1 the given BGR (the palette's high bytes) */
export function pictureV5(h: number, w: number, bgr: [number, number, number] = [0, 0, 0]): Uint8Array {
  const d = new Uint8Array(0x428 + h * w);
  i16(d, 0x20, h);
  i16(d, 0x22, w);
  d.set(bgr, 0x28 + 4 + 0);
  return d;
}

export interface SegmentV5Spec {
  frames: FrameV5Spec[];
  /** containers after the header (refs 1 …) */
  containers: Uint8Array[];
  flags?: number;
  minHold?: number;
  /** the one-shot table's and the loop table's containers, relative; 0 none */
  oneShots?: number;
  loop?: number;
  height?: number;
  width?: number;
  /** what the header says, if not the frames' own count */
  frameCount?: number;
  actionFrames?: [string, string];
}

/** a v5 film of one or more segments, each header (MHED) followed by its containers */
export function movV5(segments: SegmentV5Spec[]): Uint8Array {
  const b = new ContainerBuilder();
  let at = 0;
  const heads = segments.map((s) => {
    const h = at;
    at += 1 + s.containers.length;
    return h;
  });
  segments.forEach((s, k) => {
    const c0 = new Uint8Array(0x7c + s.frames.length * 46);
    c0[2] = 5;
    c0.set([0x44, 0x45, 0x48, 0x4d], 4); // "DEHM"
    i32(c0, 0x18, s.flags ?? 0);
    i32(c0, 0x1c, s.minHold ?? 0);
    i32(c0, 0x2c, heads[k + 1] ?? 0);
    pstr(c0, 0x40, s.actionFrames?.[0] ?? "");
    pstr(c0, 0x50, s.actionFrames?.[1] ?? "");
    i32(c0, 0x60, s.oneShots ?? 0);
    i32(c0, 0x64, s.loop ?? 0);
    i16(c0, 0x70, s.height ?? 1);
    i16(c0, 0x72, s.width ?? 1);
    i32(c0, 0x78, s.frameCount ?? s.frames.length);
    s.frames.forEach((f, i) => {
      const rec = 0x7c + i * 46;
      i16(c0, rec + 12, s.height ?? 1);
      i16(c0, rec + 14, s.width ?? 1);
      i32(c0, rec + 16, f.picture);
      i32(c0, rec + 20, f.logic ?? 0);
      pstr(c0, rec + 30, f.name);
    });
    b.add(c0);
    for (const c of s.containers) b.add(c);
  });
  return b.bytes();
}
