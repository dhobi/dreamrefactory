/**
 * DreamFactory 0 (*Lunicus*, *Jump Raven*) built from nothing: a machine that
 * reads its files from a map, and the smallest sounds, films and talk files
 * the v0 players accept — so the engine's own suites can drive a film or a
 * conversation tick by tick without a rip.
 *
 * The layouts are the readers' (`df/mov-v0.ts`, `df/talk-v0.ts`, `df/audio.ts`);
 * every field not named here stays zero.
 */
import { V0_BLOCK_SAMPLES } from "@dreamfactory/engine/df/audio";
import { ContainerBuilder, i16, i32, pstr, u16 } from "@dreamfactory/engine/df/build";
import { MachineV0, type Co, type Speaker } from "@dreamfactory/engine/v0/machine";

/** what a {@link MapMachine} is built with beyond its rip; all optional */
export interface MapMachineOptions {
  speaker?: Speaker;
  seed?: number;
  /** decode pictures (MachineV0's `draws`); off unless asked */
  draws?: boolean;
  log?: (line: string) => void;
  /** names not here yet: `get` answers null until they are wanted */
  pending?: Iterable<string>;
}

/** a machine whose rip is a map of name → bytes */
export class MapMachine extends MachineV0 {
  /** every `want`, in order */
  readonly wanted: string[];
  constructor(
    readonly rip: Map<string, Uint8Array>,
    o: MapMachineOptions = {},
  ) {
    const pending = new Set(o.pending);
    const wanted: string[] = [];
    super(
      {
        has: (p) => rip.has(p),
        get: (p) => (pending.has(p) ? null : (rip.get(p) ?? null)),
        want: (p) => (wanted.push(p), pending.delete(p)),
      },
      o.speaker,
      o.seed,
      o.draws ?? false,
      o.log,
    );
    this.wanted = wanted;
  }
  resolve(name: string): string | null {
    return this.rip.has(name) ? name : null;
  }
}

/**
 * Run `co` to its end a tick at a time, as a page does: `each` is called
 * before every tick with the tick number, to queue input. Throws past `max`.
 */
export function drive<T>(m: MachineV0, co: Co<T>, each: (tick: number) => void = () => {}, max = 20_000): T {
  for (let n = 0; n < max; n++) {
    each(m.ticks);
    const r = co.next();
    if (r.done) return r.value;
    m.ticks++;
  }
  throw new Error(`still running after ${max} ticks (${m.where})`);
}

/** a v0 sound of `blocks` 370-sample blocks: the count, then a v40 stream: a first sample and a zero delta for each of the rest */
export function soundV0(blocks: number): Uint8Array {
  const d = new Uint8Array(2 + Math.max(1, blocks * V0_BLOCK_SAMPLES));
  u16(d, 0, blocks);
  return d;
}

/** a v0 frame `h` by `w`, every pixel `ink` (one literal run a row) */
export function pictureV0(h: number, w: number, ink: number): Uint8Array {
  const row = [(w << 2) | 3, ...Array<number>(w).fill(ink)];
  const d = new Uint8Array(8 + h * (2 + row.length));
  u16(d, 0, h);
  u16(d, 2, w);
  for (let y = 0; y < h; y++) {
    const at = 8 + y * (2 + row.length);
    u16(d, at, row.length);
    d.set(row, at + 2);
  }
  return d;
}

export interface HotspotV0 {
  type: number;
  /** top, left, bottom, right in the film's own coordinates, inclusive */
  rect: [number, number, number, number];
  sound?: number;
  target?: number;
  film?: string;
}
export interface FrameV0Spec {
  picture?: number;
  hold?: number;
  action?: number;
  target?: number;
  flags?: number;
  sound?: number;
  chainTo?: string;
  hotspots?: HotspotV0[];
  /** where the record says its hotspots are, when a test wants it to lie */
  hotspotAt?: number;
}
export interface FilmV0Spec {
  frames: FrameV0Spec[];
  /** containers 1 … in order: pictures, sounds */
  containers?: Uint8Array[];
  framerate?: number;
  /** the frames that send the film's word and deed; -1 none */
  word?: number;
  deed?: number;
  height?: number;
  width?: number;
  /** what the header says, if not the frames' own count */
  frameCount?: number;
}

const HOTSPOT_BYTES: Record<number, number> = { 1: 14, 2: 16, 3: 46, 4: 48, 5: 14 };

/** a v0 film: container 0 the header, frame table and hotspots; then `containers` */
export function filmV0(spec: FilmV0Spec): Uint8Array {
  const FRAMES_AT = 0x8a2;
  const spots = spec.frames.flatMap((f) => f.hotspots ?? []);
  const size = FRAMES_AT + spec.frames.length * 80 + spots.reduce((a, h) => a + (HOTSPOT_BYTES[Math.abs(h.type)] ?? 14), 0);
  const c0 = new Uint8Array(size);
  i16(c0, 0, spec.frameCount ?? spec.frames.length);
  i16(c0, 0xa, spec.height ?? 8);
  i16(c0, 0xc, spec.width ?? 8);
  i16(c0, 0xe, spec.framerate ?? 1);
  i16(c0, 0x16, spec.deed ?? -1);
  i16(c0, 0x18, spec.word ?? -1);
  let p = FRAMES_AT + spec.frames.length * 80;
  spec.frames.forEach((f, i) => {
    const r = FRAMES_AT + i * 80;
    i16(c0, r, f.hotspots?.length ?? 0);
    i32(c0, r + 2, f.hold ?? 0);
    i16(c0, r + 0x16, f.action ?? 1);
    i16(c0, r + 0x18, f.target ?? 0);
    i16(c0, r + 0x1a, f.flags ?? 0);
    i16(c0, r + 0x1c, f.picture ?? 1);
    i32(c0, r + 0x20, f.sound ?? 0);
    i32(c0, r + 0x24, f.hotspotAt ?? p);
    if (f.chainTo) pstr(c0, r + 0x30, f.chainTo);
    for (const h of f.hotspots ?? []) {
      const kind = Math.abs(h.type);
      i16(c0, p, h.type);
      h.rect.forEach((v, k) => i16(c0, p + 2 + 2 * k, v));
      i16(c0, p + 0xa, h.sound ?? 0);
      if (kind === 2 || kind === 4) i16(c0, p + 0xe, h.target ?? 0);
      if (kind === 3 && h.film) pstr(c0, p + 0xe, h.film);
      if (kind === 4 && h.film) pstr(c0, p + 0x10, h.film);
      p += HOTSPOT_BYTES[kind] ?? 14;
    }
  });
  const b = new ContainerBuilder();
  b.add(c0);
  for (const c of spec.containers ?? [pictureV0(8, 8, 1)]) b.add(c);
  return b.bytes();
}

/** a puppet track keyframe: the rect it repaints, and each layer's {frame, y, x} (unused layers far off) */
export interface KeyV0 {
  dirty?: [number, number, number, number];
  layers?: [frame: number, y: number, x: number][];
}
export function trackV0(keys: KeyV0[]): Uint8Array {
  const d = new Uint8Array(keys.length * 76);
  keys.forEach((k, n) => {
    const at = n * 76;
    u16(d, at, 2 * n);
    (k.dirty ?? [0, 0, 8, 8]).forEach((v, j) => i16(d, at + 4 + 2 * j, v));
    for (let l = 0; l < 8; l++) {
      const [frame, y, x] = k.layers?.[l] ?? [0, -1000, -1000];
      u16(d, at + 12 + l * 8, frame);
      i16(d, at + 14 + l * 8, y);
      i16(d, at + 16 + l * 8, x);
    }
  });
  return d;
}

export interface TalkLineSpec {
  name: string;
  frames: number;
  /** containers, counted from 0 as the file's are */
  wave: number;
  track: number;
}
export interface TalkV0Spec {
  voiced?: boolean;
  idleMin?: number[];
  idleMax?: number[];
  lines: TalkLineSpec[];
  questions: { name: string; text: string; wave: number }[];
  /** menus of up to five entries */
  menus: { hide?: boolean; next: number; question: string; answer: string }[][];
  /** per layer, its pictures' containers */
  layers?: number[][];
  /** containers 4 … */
  containers: Uint8Array[];
}

/** a v0 talk file: c0 the lines, c1 the questions, c2 the menus, c3 the layers, then `containers` */
export function talkV0(spec: TalkV0Spec): Uint8Array {
  const c0 = new Uint8Array(0x844 + spec.lines.length * 0x138);
  u16(c0, 8, spec.voiced ? 1 : 0);
  for (let k = 0; k < 4; k++) {
    i32(c0, 0x822 + 4 * k, spec.idleMin?.[k] ?? 0);
    i32(c0, 0x832 + 4 * k, spec.idleMax?.[k] ?? 0);
  }
  i16(c0, 0x842, spec.lines.length);
  spec.lines.forEach((l, i) => {
    const r = 0x844 + i * 0x138;
    i16(c0, r + 6, l.frames);
    i32(c0, r + 8, l.wave);
    i32(c0, r + 0xc, l.track);
    pstr(c0, r + 0x118, l.name);
  });
  const c1 = new Uint8Array(4 + spec.questions.length * 0x128);
  i16(c1, 2, spec.questions.length);
  spec.questions.forEach((q, i) => {
    const r = 4 + i * 0x128;
    i32(c1, r, q.wave);
    pstr(c1, r + 8, q.text);
    pstr(c1, r + 0x108, q.name);
  });
  const c2 = new Uint8Array(spec.menus.length * 0x174);
  spec.menus.forEach((menu, m) =>
    menu.forEach((e, i) => {
      const at = m * 0x174 + 0x20 + i * 0x44;
      i16(c2, at, e.hide ? 1 : 0);
      i16(c2, at + 2, e.next);
      pstr(c2, at + 4, e.question);
      pstr(c2, at + 0x24, e.answer);
    }),
  );
  const c3 = new Uint8Array(8 * 0x106);
  (spec.layers ?? []).forEach((list, l) => {
    i16(c3, l * 0x106 + 2, list.length);
    list.forEach((c, k) => i32(c3, l * 0x106 + 8 + 4 * k, c));
  });
  const b = new ContainerBuilder();
  for (const c of [c0, c1, c2, c3, ...spec.containers]) b.add(c);
  return b.bytes();
}
