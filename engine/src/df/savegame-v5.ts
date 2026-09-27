/**
 * The DreamFactory 5 saved game, `.save`: RedJack's.
 *
 * *Prerequisite: [docs/engine/formats/savegame-v5.md](../../../docs/engine/formats/savegame-v5.md),
 * which is this file in prose, every field with the RedJack.exe address that
 * writes it and the one that reads it back.*
 *
 * A `.save` is a DFile of tagged containers in a fixed order: the manifest, the
 * runtime block, the actor, cast, prop, shop and track tables, three sound lists
 * per track, the globals, the loops, crickets and walks, a route per walk that
 * has one, and the `copylocal` table. The engine writes most of it as verbatim
 * copies of its own tables, and this module writes the same tables out of the
 * port's model of them: every field the page maps, and zeros where it does not.
 *
 * Unlike the v4 and v1 writers this one does not patch a real save. There is
 * none to patch (no shipped game carries one, and none has been made with the
 * original), so it builds the file from nothing, which the format allows: the
 * loader reads the tables' counts from the runtime block and copies the rest.
 * The day a save written by RedJack.exe turns up, it is the check on every
 * offset here.
 *
 * Files are named by handles, as the engine's are: a handle is an index into
 * the manifest's file list, and every record that names a file names it by one.
 * The engine's are heap addresses and mean nothing in another process; the
 * loader resolves each through the manifest, so any distinct non-zero numbers
 * will do, and these are 1, 2, 3...
 */
import { pstrAt, writePstrAt } from "./binary";
import { readContainerFile } from "./container";

/** the container prefix's first word, as every v5 container opens */
const V5 = 0x00050000;
/** what `savegame ("2")` stamps, and `opengame ("2")` compares ignoring case */
export const REDJACK_SAVE_VERSION = "2";

/** the four-character tags, spelled as the page spells them */
export const TAG = {
  SAVE: "SAVE", RUNT: "RUNT", ACT: "ACT*", CAS: "CAS*", PRO: "PRO*", SHP: "SHP*", TRA: "TRA*",
  SOU: "SOU*", VARS: "VARS", LOO: "LOO*", BAL: "BAL*", WAL: "WAL*", DRIV: "DRIV", COL: "COL*",
} as const;

/** record strides and fixed table sizes (docs: "The containers, in order") */
export const STRIDE = { actor: 0x102, cast: 0x1c, prop: 0xfe, shop: 0x1c, track: 0x234, sound: 0x2e } as const;
export const TABLE = {
  loops: { slots: 64, stride: 0x9e },
  crickets: { slots: 16, stride: 0x54 },
  walks: { slots: 16, stride: 0x80 },
  copies: { slots: 32, stride: 0x208 },
} as const;
const RUNT_SIZE = 0x264;
const MANIFEST_SIZE = 0xb28;
const FILE_RECORD = 0x104;

// ---- the model -------------------------------------------------------------

/** a file the saved game had open, by the handle every record names it by */
export interface SaveFileRef {
  handle: number;
  /** as the engine recorded it: slot 0 of the path table, then the file's own path */
  path: string;
}

/** container 1, the fields the page names (docs: "Container 1: the runtime block") */
export interface SaveRuntV5 {
  frame: number;
  framerate: number;
  /** the set is open, its file's handle, its name, and where in it */
  setOpen: boolean;
  /** `setvisible ()` (+0xd2): a stage over the room hides it, and a load runs no script to */
  setVisible: boolean;
  setHandle: number;
  setName: string;
  scene: string;
  view: string;
  /** the camera: `currentdeg`, `camerapitch`, `cameraroll`, `camerafov` */
  deg: number;
  pitch: number;
  roll: number;
  fov: number;
  /** a stage is open, its file's handle, and its name */
  stageOpen: boolean;
  stageHandle: number;
  stageName: string;
  /** the flat on show, an index into the stage's flats (+0x90, what `stageflat` answers) */
  flat: number;
}

/** an open cast or shop: the file, and the name its header gives it */
export interface SaveFileTableRecord {
  handle: number;
  name: string;
}

export interface SaveActorV5 {
  name: string;
  visible: boolean;
  castHandle: number;
  /** the member's `ACTO` container in its cast */
  member: number;
  is3d: boolean;
  true3d: boolean;
  deg: number;
  pitch: number;
  roll: number;
  x: number;
  y: number;
  z: number;
  turn: number;
  speed: number;
  scale: number;
  value: number;
  zclip: number;
  snap: boolean;
  ink: number;
  flip: number;
  contrast: number;
  brightness: number;
  litby: number;
  facer: boolean;
  set: string;
  star: string;
  pose: string;
  owner: string;
}

export interface SavePropV5 {
  name: string;
  /**
   * `propvisible` as the engine keeps it, a COUNTER: 1 shown, 0 not, and
   * `prophide` takes one off every prop and unhiding puts one back, up to 1
   * (0x4296cb..0x4296d9). So a hidden prop that was shown is 0, and a hidden
   * one that was not is −1.
   */
  shown: number;
  shopHandle: number;
  /** the group's `PROP` container in its shop */
  member: number;
  is3d: boolean;
  true3d: boolean;
  deg: number;
  pitch: number;
  roll: number;
  x: number;
  y: number;
  z: number;
  scale: number;
  value: number;
  zclip: number;
  snap: boolean;
  ink: number;
  flip: number;
  contrast: number;
  brightness: number;
  litby: number;
  facer: boolean;
  set: string;
  star: string;
  view: string;
  owner: string;
}

/** an open track, with its three sound lists kept as the engine laid them */
export interface SaveTrackV5 {
  handle: number;
  name: string;
  sounds: Uint8Array;
  themes: Uint8Array;
  order: Uint8Array;
}

/** one `global`: a number or a string, and its place in an array if it is one */
export interface SaveGlobalV5 {
  name: string;
  value: number | string;
  /** the declared array size, 0 for a plain variable */
  arraySize: number;
  /** this element's index within its array */
  index: number;
}

export interface SaveGameV5 {
  version: string;
  /** the disc in the drive, what `currentcd` answers */
  disc: string;
  /** the nine path slots; slot 0 is the install folder every path is rebased from */
  paths: string[];
  files: SaveFileRef[];
  /** the track whose theme plays, the track of the current sound and that sound's container */
  themeTrack: number;
  soundTrack: number;
  soundContainer: number;
  runt: SaveRuntV5;
  actors: SaveActorV5[];
  casts: SaveFileTableRecord[];
  props: SavePropV5[];
  shops: SaveFileTableRecord[];
  tracks: SaveTrackV5[];
  globals: SaveGlobalV5[];
  /** the scheduler's three tables and the copylocal table, whole */
  loops: Uint8Array;
  crickets: Uint8Array;
  walks: Uint8Array;
  /** one DRIV per active walk slot that carries a route, in slot order */
  routes: Uint8Array[];
  copies: Uint8Array;
}

// ---- small readers and writers ----------------------------------------------

const tagBytes = (tag: string): number =>
  ((tag.charCodeAt(0) << 24) | (tag.charCodeAt(1) << 16) | (tag.charCodeAt(2) << 8) | tag.charCodeAt(3)) >>> 0;
const tagOf = (d: Uint8Array): string =>
  d.length >= 8 ? String.fromCharCode(d[7], d[6], d[5], d[4]) : "";

/** a fresh container of `size` bytes with the v5 prefix and `tag` */
function block(tag: string, size: number): { d: Uint8Array; v: DataView } {
  const d = new Uint8Array(size);
  const v = new DataView(d.buffer);
  v.setUint32(0, V5, true);
  v.setUint32(4, tagBytes(tag), true);
  return { d, v };
}

/** a record table as 0x43ec60 writes one: the prefix, count, stride, records */
function table(tag: string, records: Uint8Array[], stride: number): Uint8Array {
  const { d, v } = block(tag, 0x20 + records.length * stride);
  v.setUint32(0x18, records.length, true);
  v.setUint32(0x1c, stride, true);
  records.forEach((r, i) => d.set(r.subarray(0, stride), 0x20 + i * stride));
  return d;
}

/** a fixed table, whole: `bytes` padded or cut to slots × stride */
function fixed(tag: string, bytes: Uint8Array, slots: number, stride: number): Uint8Array {
  const whole = new Uint8Array(slots * stride);
  whole.set(bytes.subarray(0, whole.length));
  const { d, v } = block(tag, 0x20 + whole.length);
  v.setUint32(0x18, slots, true);
  v.setUint32(0x1c, stride, true);
  d.set(whole, 0x20);
  return d;
}

/** the records of a table container, cut `count` × `stride` from +0x20 */
function records(d: Uint8Array, count: number, stride: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < count && 0x20 + (i + 1) * stride <= d.length; i++) {
    out.push(d.subarray(0x20 + i * stride, 0x20 + (i + 1) * stride));
  }
  return out;
}

const str16 = (d: Uint8Array, off: number): string => pstrAt(d, off).slice(0, 15);
const put16 = (d: Uint8Array, off: number, s: string): void => writePstrAt(d, off, s, 15);
const put256 = (d: Uint8Array, off: number, s: string): void => writePstrAt(d, off, s, 255);

// ---- the records -------------------------------------------------------------

function writeActor(a: SaveActorV5): Uint8Array {
  const d = new Uint8Array(STRIDE.actor);
  const v = new DataView(d.buffer);
  v.setInt16(0x00, a.visible ? 1 : 0, true);
  v.setUint32(0x02, a.castHandle, true);
  v.setUint32(0x0a, a.member, true);
  v.setInt16(0x12, a.is3d ? 1 : 0, true);
  v.setInt16(0x14, a.true3d ? 1 : 0, true);
  v.setInt32(0x1a, a.deg, true);
  v.setInt32(0x1e, a.pitch, true);
  v.setInt32(0x22, a.roll, true);
  v.setInt32(0x26, a.x, true);
  v.setInt32(0x2a, a.y, true);
  v.setInt32(0x2e, a.z, true);
  v.setInt32(0x32, a.turn, true);
  v.setInt32(0x44, a.speed, true);
  v.setInt32(0x4c, a.scale, true);
  v.setInt32(0x8e, a.value, true);
  v.setInt32(0x92, a.zclip, true);
  v.setInt16(0x98, a.snap ? 1 : 0, true);
  v.setInt16(0x9a, a.ink, true);
  v.setInt16(0x9c, a.flip, true);
  v.setInt16(0xa2, a.contrast, true);
  v.setInt16(0xa8, a.brightness, true);
  v.setInt16(0xae, a.litby, true);
  v.setInt16(0xb0, a.facer ? 1 : 0, true);
  put16(d, 0xb2, a.name);
  put16(d, 0xc2, a.set);
  put16(d, 0xd2, a.star);
  put16(d, 0xe2, a.pose);
  put16(d, 0xf2, a.owner);
  return d;
}

function readActor(d: Uint8Array): SaveActorV5 {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return {
    visible: v.getInt16(0x00, true) !== 0,
    castHandle: v.getUint32(0x02, true),
    member: v.getUint32(0x0a, true),
    is3d: v.getInt16(0x12, true) !== 0,
    true3d: v.getInt16(0x14, true) !== 0,
    deg: v.getInt32(0x1a, true),
    pitch: v.getInt32(0x1e, true),
    roll: v.getInt32(0x22, true),
    x: v.getInt32(0x26, true),
    y: v.getInt32(0x2a, true),
    z: v.getInt32(0x2e, true),
    turn: v.getInt32(0x32, true),
    speed: v.getInt32(0x44, true),
    scale: v.getInt32(0x4c, true),
    value: v.getInt32(0x8e, true),
    zclip: v.getInt32(0x92, true),
    snap: v.getInt16(0x98, true) !== 0,
    ink: v.getInt16(0x9a, true),
    flip: v.getInt16(0x9c, true),
    contrast: v.getInt16(0xa2, true),
    brightness: v.getInt16(0xa8, true),
    litby: v.getInt16(0xae, true),
    facer: v.getInt16(0xb0, true) !== 0,
    name: str16(d, 0xb2),
    set: str16(d, 0xc2),
    star: str16(d, 0xd2),
    pose: str16(d, 0xe2),
    owner: str16(d, 0xf2),
  };
}

function writeProp(p: SavePropV5): Uint8Array {
  const d = new Uint8Array(STRIDE.prop);
  const v = new DataView(d.buffer);
  v.setInt16(0x00, p.shown, true);
  v.setUint32(0x02, p.shopHandle, true);
  v.setUint32(0x0a, p.member, true);
  v.setInt16(0x12, p.is3d ? 1 : 0, true);
  v.setInt16(0x14, p.true3d ? 1 : 0, true);
  v.setInt32(0x1a, p.deg, true);
  v.setInt32(0x1e, p.pitch, true);
  v.setInt32(0x22, p.roll, true);
  v.setInt32(0x26, p.x, true);
  v.setInt32(0x2a, p.y, true);
  v.setInt32(0x2e, p.z, true);
  v.setInt32(0x48, p.scale, true);
  v.setInt32(0x8a, p.value, true);
  v.setInt32(0x8e, p.zclip, true);
  v.setInt16(0x94, p.snap ? 1 : 0, true);
  v.setInt16(0x96, p.ink, true);
  v.setInt16(0x98, p.flip, true);
  v.setInt16(0x9e, p.contrast, true);
  v.setInt16(0xa4, p.brightness, true);
  v.setInt16(0xaa, p.litby, true);
  v.setInt16(0xac, p.facer ? 1 : 0, true);
  put16(d, 0xae, p.name);
  put16(d, 0xbe, p.set);
  put16(d, 0xce, p.star);
  put16(d, 0xde, p.view);
  put16(d, 0xee, p.owner);
  return d;
}

function readProp(d: Uint8Array): SavePropV5 {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return {
    shown: v.getInt16(0x00, true),
    shopHandle: v.getUint32(0x02, true),
    member: v.getUint32(0x0a, true),
    is3d: v.getInt16(0x12, true) !== 0,
    true3d: v.getInt16(0x14, true) !== 0,
    deg: v.getInt32(0x1a, true),
    pitch: v.getInt32(0x1e, true),
    roll: v.getInt32(0x22, true),
    x: v.getInt32(0x26, true),
    y: v.getInt32(0x2a, true),
    z: v.getInt32(0x2e, true),
    scale: v.getInt32(0x48, true),
    value: v.getInt32(0x8a, true),
    zclip: v.getInt32(0x8e, true),
    snap: v.getInt16(0x94, true) !== 0,
    ink: v.getInt16(0x96, true),
    flip: v.getInt16(0x98, true),
    contrast: v.getInt16(0x9e, true),
    brightness: v.getInt16(0xa4, true),
    litby: v.getInt16(0xaa, true),
    facer: v.getInt16(0xac, true) !== 0,
    name: str16(d, 0xae),
    set: str16(d, 0xbe),
    star: str16(d, 0xce),
    view: str16(d, 0xde),
    owner: str16(d, 0xee),
  };
}

function writeFileTableRecord(r: SaveFileTableRecord): Uint8Array {
  const d = new Uint8Array(STRIDE.cast);
  new DataView(d.buffer).setUint32(0x00, r.handle, true);
  put16(d, 0x0c, r.name);
  return d;
}

function readFileTableRecord(d: Uint8Array): SaveFileTableRecord {
  return { handle: new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(0, true), name: str16(d, 0x0c) };
}

function writeTrack(t: SaveTrackV5): Uint8Array {
  const d = new Uint8Array(STRIDE.track);
  const v = new DataView(d.buffer);
  v.setUint32(0x00, t.handle, true);
  v.setInt16(0x04, t.sounds.length / STRIDE.sound, true);
  v.setInt16(0x06, t.themes.length / STRIDE.sound, true);
  v.setInt16(0x08, t.order.length / STRIDE.sound, true);
  put16(d, 0x1c, t.name);
  return d;
}

// ---- the globals (VARS) ------------------------------------------------------

/** the node types `0x449ac7` writes: a declaration starts as a number */
const NUMBER = 4;
const STRING = 3;

function writeVars(globals: SaveGlobalV5[]): Uint8Array {
  // the pool: every string once, as Pascal strings, and each node's offset
  const pool: number[] = [];
  const offsetOf = new Map<string, number>();
  for (const g of globals) {
    if (typeof g.value !== "string" || offsetOf.has(g.value)) continue;
    offsetOf.set(g.value, pool.length);
    const s = g.value.slice(0, 255);
    pool.push(s.length);
    for (let i = 0; i < s.length; i++) pool.push(s.charCodeAt(i) & 0xff);
  }
  // capacity grows 20 at a time (0x449a83); the pool is at least a fresh one's 0x800
  const cap = Math.max(20, Math.ceil(globals.length / 20) * 20);
  const poolSize = Math.max(0x800, pool.length);
  const { d, v } = block(TAG.VARS, 0x2c + cap * 32 + poolSize);
  v.setUint16(0x18, globals.length, true);
  v.setUint16(0x1a, cap, true);
  v.setUint32(0x1c, 0, true);
  v.setUint32(0x20, pool.length, true);
  v.setUint32(0x24, poolSize, true);
  globals.forEach((g, i) => {
    const n = 0x2c + i * 32;
    const isStr = typeof g.value === "string";
    v.setUint16(n + 0x00, isStr ? STRING : NUMBER, true);
    v.setInt32(n + 0x04, isStr ? offsetOf.get(g.value as string)! : Math.trunc(Number(g.value) || 0), true);
    v.setUint16(n + 0x08, g.arraySize, true);
    v.setUint16(n + 0x0a, g.index, true);
    v.setUint16(n + 0x0c, Math.max(1, g.arraySize), true);
    put16(d, n + 0x10, g.name);
  });
  d.set(pool, 0x2c + cap * 32);
  return d;
}

function readVars(d: Uint8Array): SaveGlobalV5[] {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const used = v.getUint16(0x18, true);
  const cap = v.getUint16(0x1a, true);
  const poolAt = 0x2c + cap * 32;
  const out: SaveGlobalV5[] = [];
  for (let i = 0; i < used; i++) {
    const n = 0x2c + i * 32;
    if (n + 32 > d.length) break;
    const type = v.getUint16(n, true);
    const raw = v.getInt32(n + 0x04, true);
    out.push({
      name: str16(d, n + 0x10),
      value: type === STRING ? pstrAt(d, poolAt + raw) : raw,
      arraySize: v.getUint16(n + 0x08, true),
      index: v.getUint16(n + 0x0a, true),
    });
  }
  return out;
}

// ---- container 0 and container 1 ---------------------------------------------

function writeManifest(s: SaveGameV5): Uint8Array {
  const { d, v } = block(TAG.SAVE, MANIFEST_SIZE + s.files.length * FILE_RECORD);
  put256(d, 0x018, s.version);
  put256(d, 0x118, s.disc);
  for (let i = 0; i < 9; i++) put256(d, 0x218 + i * 0x100, s.paths[i] ?? "");
  v.setUint32(0xb18, s.themeTrack, true);
  v.setUint32(0xb1c, s.soundTrack, true);
  v.setUint32(0xb20, s.soundContainer, true);
  v.setInt32(0xb24, s.files.length, true);
  s.files.forEach((f, i) => {
    const at = MANIFEST_SIZE + i * FILE_RECORD;
    v.setUint32(at, f.handle, true);
    put256(d, at + 4, f.path);
  });
  return d;
}

function writeRunt(r: SaveRuntV5, counts: number[]): Uint8Array {
  const { d, v } = block(TAG.RUNT, RUNT_SIZE);
  v.setUint32(0x42, r.frame >>> 0, true);
  v.setUint32(0x46, r.framerate, true);
  [0x60, 0x68, 0x70, 0x78, 0x80].forEach((off, i) => v.setUint32(off, counts[i], true));
  v.setInt16(0x84, r.stageOpen ? 1 : 0, true);
  v.setUint32(0x8c, r.stageHandle, true);
  v.setInt32(0x90, r.flat, true);
  // the flat last drawn; the loader sets it to −1 to force a redraw (0x415fc8)
  v.setInt32(0x94, -1, true);
  put16(d, 0xb0, r.stageName);
  v.setInt16(0xd0, r.setOpen ? 1 : 0, true);
  v.setInt16(0xd2, r.setVisible ? 1 : 0, true);
  // a stage on show (+0x86, what `stagevisible` answers after the open flag)
  v.setInt16(0x86, r.stageOpen ? 1 : 0, true);
  v.setUint32(0xe0, r.setHandle, true);
  put16(d, 0xf8, r.setName);
  put16(d, 0x108, r.scene);
  put16(d, 0x118, r.view);
  v.setInt32(0x230, r.deg, true);
  v.setInt32(0x234, r.pitch, true);
  v.setInt32(0x238, r.roll, true);
  // "as last set", which the resume reapplies through the setters (0x43e814)
  v.setInt32(0x248, r.deg, true);
  v.setInt32(0x24c, r.pitch, true);
  v.setInt32(0x250, r.roll, true);
  v.setInt32(0x260, r.fov, true);
  return d;
}

function readRunt(d: Uint8Array): { runt: SaveRuntV5; counts: number[] } {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return {
    runt: {
      frame: v.getUint32(0x42, true),
      framerate: v.getUint32(0x46, true),
      stageOpen: v.getInt16(0x84, true) !== 0,
      stageHandle: v.getUint32(0x8c, true),
      stageName: str16(d, 0xb0),
      flat: v.getInt32(0x90, true),
      setOpen: v.getInt16(0xd0, true) !== 0,
      setVisible: v.getInt16(0xd2, true) !== 0,
      setHandle: v.getUint32(0xe0, true),
      setName: str16(d, 0xf8),
      scene: str16(d, 0x108),
      view: str16(d, 0x118),
      deg: v.getInt32(0x248, true),
      pitch: v.getInt32(0x24c, true),
      roll: v.getInt32(0x250, true),
      fov: v.getInt32(0x260, true),
    },
    counts: [0x60, 0x68, 0x70, 0x78, 0x80].map((off) => v.getUint32(off, true)),
  };
}

// ---- the file ----------------------------------------------------------------

/** the position table's capacity: ⌈1000/128⌉·128 (0x48e31b) */
const POSITIONS = 1024;
const HEADER = 1024;
const FIRST = HEADER + POSITIONS * 4;

/**
 * Lay the containers out as `0x48e3c0` and `0x46ea90` do: a 1024-byte header,
 * a 1024-entry position table, then `{i32 index, u32 size, data}` records each
 * padded to 64 bytes. The header's size field is the file's exact length, which
 * is one of the two things the loader checks (0x48e430).
 */
function writeDFile(containers: Uint8Array[]): Uint8Array {
  const at: number[] = [];
  let pos = FIRST;
  for (const c of containers) {
    at.push(pos);
    pos += Math.ceil((8 + c.length) / 64) * 64;
  }
  const out = new Uint8Array(pos);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x00010000, true);
  v.setUint32(4, pos, true);
  v.setUint32(16, POSITIONS, true);
  v.setUint32(20, containers.length, true);
  v.setUint32(32, tagBytes("SAVE"), true);
  v.setUint32(36, tagBytes("D5RT"), true);
  containers.forEach((c, i) => {
    v.setUint32(HEADER + i * 4, at[i], true);
    v.setInt32(at[i], i, true);
    v.setUint32(at[i] + 4, c.length, true);
    out.set(c, at[i] + 8);
  });
  return out;
}

/** the bytes of a save, in the order RedJack.exe's writer (0x43cc10) emits them */
export function writeSaveV5(s: SaveGameV5): Uint8Array {
  const counts = [s.actors.length, s.casts.length, s.props.length, s.shops.length, s.tracks.length];
  const out: Uint8Array[] = [
    writeManifest(s),
    writeRunt(s.runt, counts),
    table(TAG.ACT, s.actors.map(writeActor), STRIDE.actor),
    table(TAG.CAS, s.casts.map(writeFileTableRecord), STRIDE.cast),
    table(TAG.PRO, s.props.map(writeProp), STRIDE.prop),
    table(TAG.SHP, s.shops.map(writeFileTableRecord), STRIDE.shop),
    table(TAG.TRA, s.tracks.map(writeTrack), STRIDE.track),
  ];
  for (const t of s.tracks) {
    for (const list of [t.sounds, t.themes, t.order]) {
      const n = Math.floor(list.length / STRIDE.sound);
      const recs = Array.from({ length: n }, (_, i) => list.subarray(i * STRIDE.sound, (i + 1) * STRIDE.sound));
      out.push(table(TAG.SOU, recs, STRIDE.sound));
    }
  }
  out.push(writeVars(s.globals));
  out.push(fixed(TAG.LOO, s.loops, TABLE.loops.slots, TABLE.loops.stride));
  out.push(fixed(TAG.BAL, s.crickets, TABLE.crickets.slots, TABLE.crickets.stride));
  out.push(fixed(TAG.WAL, s.walks, TABLE.walks.slots, TABLE.walks.stride));
  for (const r of s.routes) out.push(r);
  out.push(fixed(TAG.COL, s.copies, TABLE.copies.slots, TABLE.copies.stride));
  return writeDFile(out);
}

/** is this a DreamFactory 5 save? (container 0 is a `SAVE` with the v5 prefix) */
export function isSaveV5(bytes: Uint8Array): boolean {
  try {
    const c0 = readContainerFile(bytes).containers[0]?.data;
    return !!c0 && tagOf(c0) === TAG.SAVE && new DataView(c0.buffer, c0.byteOffset).getUint32(0, true) === V5;
  } catch {
    return false;
  }
}

/**
 * Read a save back, as `0x43d1c0` does: the header's two checks, every
 * container's prefix and tag, containers 0–6 by index and the rest counted on.
 * Throws with the engine's own words where the engine would refuse.
 */
export function readSaveV5(bytes: Uint8Array): SaveGameV5 {
  const hv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < FIRST || hv.getUint32(0, true) !== 0x00010000 || hv.getUint32(4, true) !== bytes.length) {
    throw new Error("This is not a valid saved game file.");
  }
  const cs = readContainerFile(bytes).containers.map((c) => c.data);
  let next = 0;
  const take = (tag: string): Uint8Array => {
    const d = cs[next++];
    if (!d || new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(0, true) !== V5 || tagOf(d) !== tag) {
      throw new Error(`container ${next - 1} is not ${tag} (${d ? tagOf(d) : "missing"})`);
    }
    return d;
  };
  const m = take(TAG.SAVE);
  const mv = new DataView(m.buffer, m.byteOffset, m.byteLength);
  const files: SaveFileRef[] = [];
  for (let i = 0, n = mv.getInt32(0xb24, true); i < n; i++) {
    const at = MANIFEST_SIZE + i * FILE_RECORD;
    files.push({ handle: mv.getUint32(at, true), path: pstrAt(m, at + 4) });
  }
  const { runt, counts } = readRunt(take(TAG.RUNT));
  const actors = records(take(TAG.ACT), counts[0], STRIDE.actor).map(readActor);
  const casts = records(take(TAG.CAS), counts[1], STRIDE.cast).map(readFileTableRecord);
  const props = records(take(TAG.PRO), counts[2], STRIDE.prop).map(readProp);
  const shops = records(take(TAG.SHP), counts[3], STRIDE.shop).map(readFileTableRecord);
  const trackRecs = records(take(TAG.TRA), counts[4], STRIDE.track);
  const tracks: SaveTrackV5[] = trackRecs.map((t) => {
    const tv = new DataView(t.buffer, t.byteOffset, t.byteLength);
    const list = (n: number): Uint8Array => take(TAG.SOU).slice(0x20, 0x20 + n * STRIDE.sound);
    return {
      handle: tv.getUint32(0, true),
      name: str16(t, 0x1c),
      sounds: list(tv.getInt16(4, true)),
      themes: list(tv.getInt16(6, true)),
      order: list(tv.getInt16(8, true)),
    };
  });
  const globals = readVars(take(TAG.VARS));
  const body = (d: Uint8Array, slots: number, stride: number): Uint8Array => d.slice(0x20, 0x20 + slots * stride);
  const loops = body(take(TAG.LOO), TABLE.loops.slots, TABLE.loops.stride);
  const crickets = body(take(TAG.BAL), TABLE.crickets.slots, TABLE.crickets.stride);
  const walks = body(take(TAG.WAL), TABLE.walks.slots, TABLE.walks.stride);
  const routes: Uint8Array[] = [];
  while (cs[next] && tagOf(cs[next]) === TAG.DRIV) routes.push(cs[next++]);
  const copies = body(take(TAG.COL), TABLE.copies.slots, TABLE.copies.stride);
  return {
    version: pstrAt(m, 0x018),
    disc: pstrAt(m, 0x118),
    paths: Array.from({ length: 9 }, (_, i) => pstrAt(m, 0x218 + i * 0x100)),
    files,
    themeTrack: mv.getUint32(0xb18, true),
    soundTrack: mv.getUint32(0xb1c, true),
    soundContainer: mv.getUint32(0xb20, true),
    runt,
    actors,
    casts,
    props,
    shops,
    tracks,
    globals,
    loops,
    crickets,
    walks,
    routes,
    copies,
  };
}

/** `opengame`'s version check: the same length, the same letters ignoring case (0x43d290) */
export function saveVersionMatches(saved: string, asked: string): boolean {
  return saved.length === asked.length && saved.toLowerCase() === asked.toLowerCase();
}
