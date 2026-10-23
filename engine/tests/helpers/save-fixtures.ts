/**
 * Save files built from nothing, for the engine's own save-format suites.
 *
 * A shipped save is the only real base a patch is ever written into, and the
 * engine's tests may not open a rip — so these lay out the smallest file each
 * reader accepts: the `ODTRTRFD` container framing (`writeSaveFile`), a
 * variable list of 32-byte nodes with a string pool beside it (`save-vars.ts`),
 * and the fixed-size service tables whose sizes are what the positional
 * readers check the container map against.
 */
import { writeSaveFile, type RawSaveFile } from "@dreamfactory/engine/df/savegame";

/** the DFValue vtable every node of a built list carries (the shipped saves' own) */
export const VTABLE = 0x00431e0f;

export const u16 = (d: Uint8Array, off: number, v: number): void =>
  new DataView(d.buffer, d.byteOffset, d.byteLength).setInt16(off, v, true);
export const u32 = (d: Uint8Array, off: number, v: number): void =>
  new DataView(d.buffer, d.byteOffset, d.byteLength).setUint32(off, v >>> 0, true);
export const i32 = (d: Uint8Array, off: number, v: number): void =>
  new DataView(d.buffer, d.byteOffset, d.byteLength).setInt32(off, v, true);
export const get16 = (d: Uint8Array, off: number): number =>
  new DataView(d.buffer, d.byteOffset, d.byteLength).getInt16(off, true);
export const get32 = (d: Uint8Array, off: number): number =>
  new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(off, true);

/** a Pascal string: length byte, then the characters */
export function pstr(d: Uint8Array, off: number, s: string): void {
  d[off] = s.length;
  for (let j = 0; j < s.length; j++) d[off + 1 + j] = s.charCodeAt(j);
}

/** a global for {@link varList}: a number (tag 4), a boolean (tag 2) or a string (tag 3) */
export type Global = [name: string, value: number | boolean | string];

/**
 * A globals blob and its string pool: a 32-byte header (pool watermark at +8,
 * pool size at +12), then one node per name — and a node's name pairs with the
 * PREVIOUS node's DFValue, the head's with the header's. `free` empty nodes
 * follow the list, which is the room a new record is made in.
 */
export function varList(vars: Global[], free = 2, poolRoom = 64): { globals: Uint8Array; pool: Uint8Array } {
  const globals = new Uint8Array(32 * (vars.length + 1 + free));
  const strings: number[] = [];
  const offsets: number[] = [];
  for (const [, v] of vars) {
    if (typeof v !== "string") {
      offsets.push(-1);
      continue;
    }
    offsets.push(strings.length);
    strings.push(v.length, ...[...v].map((c) => c.charCodeAt(0)));
  }
  const pool = new Uint8Array(strings.length + poolRoom);
  pool.set(strings);
  u32(globals, 8, strings.length);
  u32(globals, 12, pool.length);
  vars.forEach(([name, v], k) => {
    const node = 32 * (k + 1);
    u32(globals, node + 20, VTABLE);
    pstr(globals, node + 8, name);
    const slot = 32 * k;
    if (typeof v === "string") {
      u16(globals, slot + 24, 3);
      i32(globals, slot + 26, offsets[k]);
    } else {
      u16(globals, slot + 24, typeof v === "boolean" ? 2 : 4);
      i32(globals, slot + 26, Number(v));
    }
  });
  return { globals, pool };
}

/** eight numbers, so the list has the votes `nodeVtable` wants before it trusts a grid */
export const FILLER: Global[] = ["fa", "fb", "fc", "fd", "fe", "ff", "fg", "fh"].map((n, k) => [n, k]);

/** frame a list of containers as a save file */
export function saveFile(containers: Uint8Array[]): Uint8Array {
  const header = new Uint8Array(1024);
  u32(header, 0, 0x00010000);
  header.set([..."ODTRTRFD"].map((c) => c.charCodeAt(0)), 32);
  const raw: RawSaveFile = {
    header,
    table: new Uint8Array(512),
    containers: containers.map((data, id) => ({ id, data })),
  };
  return writeSaveFile(raw);
}

/**
 * A Dust (`.rtd`, DF1) save's containers: the manifest (title, nine paths, the
 * CLUT, the open-file records), the 542-byte standpoint, the four record tables,
 * `banks` sound banks and their arrays, the globals and pool, and the three
 * fixed tables — 32 × 42 loops, 16 × 48 balls, 16 × 82 walks. Every record is
 * empty; a test writes what it is about into the one it needs.
 */
export interface DustSave {
  c0: Uint8Array;
  c1: Uint8Array;
  actors: Uint8Array;
  castFiles: Uint8Array;
  props: Uint8Array;
  propFiles: Uint8Array;
  banks: Uint8Array;
  bankArrays: Uint8Array[];
  globals: Uint8Array;
  pool: Uint8Array;
  loops: Uint8Array;
  balls: Uint8Array;
  walks: Uint8Array;
  payloads: Uint8Array[];
}

export function dustSave(opts: {
  title?: string;
  files?: [handle: number, path: string][];
  actors?: number;
  props?: number;
  banks?: number;
  vars?: Global[];
} = {}): DustSave {
  const files = opts.files ?? [];
  const c0 = new Uint8Array(0x1210 + Math.max(1, files.length) * 260);
  pstr(c0, 0, opts.title ?? "dust 0.3");
  pstr(c0, 0x100, "appl:");
  pstr(c0, 0x200, "dust:data:");
  u32(c0, 0x120c, files.length);
  files.forEach(([h, p], i) => {
    u32(c0, 0x1210 + i * 260, h);
    pstr(c0, 0x1214 + i * 260, p);
  });
  const banks = opts.banks ?? 0;
  const { globals, pool } = varList(opts.vars ?? FILLER);
  return {
    c0,
    c1: new Uint8Array(542),
    actors: new Uint8Array(164 * (opts.actors ?? 2)),
    castFiles: new Uint8Array(28 * 2),
    props: new Uint8Array(158 * (opts.props ?? 2)),
    propFiles: new Uint8Array(28 * 2),
    banks: new Uint8Array(38 * banks),
    bankArrays: Array.from({ length: 3 * banks }, () => new Uint8Array(0)),
    globals,
    pool,
    loops: new Uint8Array(0x540),
    balls: new Uint8Array(0x300),
    walks: new Uint8Array(0x520),
    payloads: [],
  };
}

export function dustBytes(s: DustSave): Uint8Array {
  return saveFile([
    s.c0, s.c1, s.actors, s.castFiles, s.props, s.propFiles, s.banks, ...s.bankArrays,
    s.globals, s.pool, s.loops, s.balls, s.walks, ...s.payloads,
  ]);
}

/**
 * A Titanic (`.ti`, DF4) save's containers, laid out as `saveIndex` reads
 * them: the manifest (title @0, disc label @256, the open-file records at
 * 0x1310), the standpoint (stage/set/scene/view pstrs, the frame at 442, the
 * set file's id at 544), the cast grid (160-byte records, name at +80), the
 * open casts, the inventory grid (158-byte records, name at +78), the open
 * shops, `tracks` open tracks with their three sound arrays each, the globals
 * and pool, and the three fixed tables — 32 × 42 loops, 16 × 74 crickets,
 * 16 × 110 walks.
 */
export interface TitanicSave {
  c0: Uint8Array;
  c1: Uint8Array;
  actors: Uint8Array;
  casts: Uint8Array;
  inventory: Uint8Array;
  shops: Uint8Array;
  tracks: Uint8Array;
  trackArrays: Uint8Array[];
  globals: Uint8Array;
  pool: Uint8Array;
  loops: Uint8Array;
  crickets: Uint8Array;
  walks: Uint8Array;
  payloads: Uint8Array[];
}

/** where a record's NAME sits, for the record `k` of a grid */
export const ACTOR_NAME_AT = (k: number): number => 160 * k + 80;
export const PROP_NAME_AT = (k: number): number => 158 * k + 78;

export function titanicSave(opts: {
  title?: string;
  disk?: string;
  files?: [handle: number, path: string][];
  tracks?: string[];
  vars?: Global[];
  actors?: [name: string, owner: string][];
  props?: [name: string, view: string, owner: string][];
} = {}): TitanicSave {
  const files = opts.files ?? [];
  const c0 = new Uint8Array(0x1310 + Math.max(1, files.length) * 0x104);
  pstr(c0, 0, opts.title ?? "Titanic 1.0");
  pstr(c0, 256, opts.disk ?? "TITANIC1");
  u32(c0, 0x130c, files.length);
  files.forEach(([h, p], i) => {
    u32(c0, 0x1310 + i * 0x104, h);
    pstr(c0, 0x1314 + i * 0x104, p);
  });
  const c1 = new Uint8Array(700);
  const actorList = opts.actors ?? [];
  const actors = new Uint8Array(160 * actorList.length);
  actorList.forEach(([name, owner], k) => {
    pstr(actors, ACTOR_NAME_AT(k), name);
    pstr(actors, ACTOR_NAME_AT(k) + 64, owner);
  });
  const propList = opts.props ?? [];
  const inventory = new Uint8Array(158 * propList.length);
  propList.forEach(([name, view, owner], k) => {
    pstr(inventory, PROP_NAME_AT(k), name);
    pstr(inventory, PROP_NAME_AT(k) + 48, view);
    pstr(inventory, PROP_NAME_AT(k) + 64, owner);
  });
  const trackNames = opts.tracks ?? [];
  const tracks = new Uint8Array(40 * trackNames.length);
  trackNames.forEach((n, k) => pstr(tracks, 40 * k + 0x16, n));
  const { globals, pool } = varList(opts.vars ?? FILLER);
  return {
    c0,
    c1,
    actors,
    casts: new Uint8Array(0),
    inventory,
    shops: new Uint8Array(0),
    tracks,
    trackArrays: Array.from({ length: 3 * trackNames.length }, () => new Uint8Array(0)),
    globals,
    pool,
    loops: new Uint8Array(32 * 42),
    crickets: new Uint8Array(16 * 74),
    walks: new Uint8Array(16 * 110),
    payloads: [],
  };
}

/** put `n` 104-byte sound records into array `j` of track `k`, keeping the descriptor's count in step */
export function trackSounds(s: TitanicSave, k: number, j: 0 | 1 | 2, names: string[], volume = 200): void {
  const arr = new Uint8Array(104 * names.length);
  names.forEach((n, r) => {
    u16(arr, 104 * r, r + 1);
    u16(arr, 104 * r + 4, volume);
    pstr(arr, 104 * r + 8, n);
  });
  s.trackArrays[3 * k + j] = arr;
  u16(s.tracks, 40 * k + [4, 6, 8][j], names.length);
}

export function titanicBytes(s: TitanicSave): Uint8Array {
  return saveFile([
    s.c0, s.c1, s.actors, s.casts, s.inventory, s.shops, s.tracks, ...s.trackArrays,
    s.globals, s.pool, s.loops, s.crickets, s.walks, ...s.payloads,
  ]);
}
