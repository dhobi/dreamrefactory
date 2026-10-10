/**
 * Reading a Titanic `.ti` save: the record decoders for each container — the
 * prop and actor grids, the open cast and bank lists, the loop/cricket/walk
 * tables and the playing theme — and `parseSave`, which puts them together.
 */
import { BinaryReader, pstrAtChecked } from "./binary";
import { DFVALUE_STRING, decodeVars, pstrField } from "./save-vars";
import { readSaveFile, saveIndex } from "./savegame";
import type {
  RawSaveFile,
  SaveGame,
  SavedActor,
  SavedCricket,
  SavedLoop,
  SavedProp,
  SavedTheme,
  SavedWalk,
} from "./savegame";
import {
  PROP_STRIDE,
  PROP_SET_OFF,
  PROP_STAR_OFF,
  PROP_VIEW_OFF,
  PROP_OWNER_OFF,
  PROP_FIELDS,
  ACTOR_STRIDE,
  ACTOR_RECORD_OFF,
  ACTOR_OWNER_OFF,
  ACTOR_VALUE_OFF,
  ACTOR_PLACEMENT,
  ACTOR_SET_OFF,
  ACTOR_STAR_OFF,
  ACTOR_POSE_OFF,
  C1_STAGE,
  C1_SET,
  C1_SCENE,
  C1_VIEW,
  C1_FRAME,
  C0_FILE_COUNT,
  C0_FILE_RECORDS,
  C0_FILE_STRIDE,
  LOOP_KINDS,
  CAST_STRIDE,
  CAST_NAME,
  WALK_SLOT,
  TRACK_STRIDE,
  TRACK_NAME_OFF,
  SOUND_STRIDE,
} from "./savegame-layout";

/** true for a plausible prop-record name (identifier at record+0). */
export function isPropName(s: string): boolean {
  return s.length >= 2 && s.length <= 20 && /^[a-z][a-z0-9]*$/i.test(s);
}

/** Decode the prop record whose NAME is at offset `o`, or null if it isn't one.
 *  The numeric half sits at negative offsets from the name (the record base is
 *  0x4e bytes earlier), so each read is bounds-checked like the actor grid's. */
function propRecordAt(d: Uint8Array, o: number): SavedProp | null {
  const name = pstrField(d, o);
  if (!isPropName(name)) return null;
  const view = pstrField(d, o + PROP_VIEW_OFF);
  const owner = pstrField(d, o + PROP_OWNER_OFF);
  if (!view || !owner) return null;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const num = (at: number, wide = false): number => {
    const p = o + at;
    if (p < 0 || p + (wide ? 4 : 2) > d.length) return 0;
    return wide ? dv.getInt32(p, true) : dv.getInt16(p, true);
  };
  return {
    name: name.toLowerCase(),
    view: view.toLowerCase(),
    owner: owner.toLowerCase(),
    set: pstrField(d, o + PROP_SET_OFF).toLowerCase(),
    star: pstrField(d, o + PROP_STAR_OFF).toLowerCase(),
    visible: num(PROP_FIELDS.visible) > 0,
    is3d: num(PROP_FIELDS.is3d) === 1,
    x: num(PROP_FIELDS.x),
    y: num(PROP_FIELDS.y),
    worldX: num(PROP_FIELDS.worldX),
    worldY: num(PROP_FIELDS.worldY),
    worldZ: num(PROP_FIELDS.worldZ),
    deg: num(PROP_FIELDS.deg),
    dist: num(PROP_FIELDS.dist),
    scale: num(PROP_FIELDS.scale),
    // the record's one u32 field (its getter reads a dword)
    value: num(PROP_FIELDS.value, true),
    zclip: num(PROP_FIELDS.zclip),
  };
}

/**
 * Walk the fixed 158-byte prop grid in a container, returning one record per
 * slot. Locks onto the grid from the first offset that decodes as two
 * consecutive records (rejecting stray name-like strings in pointer junk), then
 * rewinds to the grid base and walks forward until a slot fails to decode.
 * Returns `[offset, prop]` pairs so the writer can patch records in place.
 */
export function walkPropGrid(d: Uint8Array): { off: number; prop: SavedProp }[] {
  const last = d.length - PROP_OWNER_OFF;
  let seed = -1;
  for (let o = 0; o < last; o++) {
    if (propRecordAt(d, o) && propRecordAt(d, o + PROP_STRIDE)) {
      seed = o;
      break;
    }
  }
  if (seed < 0) return [];
  let base = seed;
  while (base - PROP_STRIDE >= 0 && propRecordAt(d, base - PROP_STRIDE)) base -= PROP_STRIDE;
  const out: { off: number; prop: SavedProp }[] = [];
  for (let o = base; o < last; o += PROP_STRIDE) {
    const prop = propRecordAt(d, o);
    if (!prop) break;
    out.push({ off: o, prop });
  }
  return out;
}

/**
 * Decode the actor record whose NAME is at offset `o`, or null if it isn't one.
 *
 * `o` is the name rather than the record base because that is what the grid can be
 * located by; every numeric field is therefore at a negative offset from it (see
 * {@link ACTOR_RECORD_OFF}). The first record of a container can begin before
 * offset 0 of the slice we hold, so each numeric read is bounds-checked and falls
 * back to 0 — the grid is located by name and owner alone, so a field that cannot
 * be read can never make a non-record parse as one.
 */
function actorRecordAt(d: Uint8Array, o: number): SavedActor | null {
  const name = pstrField(d, o);
  if (!isPropName(name)) return null;
  const owner = pstrField(d, o + ACTOR_OWNER_OFF);
  if (!owner) return null;
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
  /** a field at `at` bytes from the NAME, 0 when it falls outside the slice */
  const num = (at: number, wide = false): number => {
    const p = o + at;
    if (p < 0 || p + (wide ? 4 : 2) > d.length) return 0;
    return wide ? view.getInt32(p, true) : view.getInt16(p, true);
  };
  return {
    name: name.toLowerCase(),
    owner: owner.toLowerCase(),
    value: num(ACTOR_VALUE_OFF, true),
    placement: {
      visible: num(ACTOR_PLACEMENT.visible) > 0,
      set: pstrField(d, o + ACTOR_SET_OFF).toLowerCase(),
      star: pstrField(d, o + ACTOR_STAR_OFF).toLowerCase(),
      pose: pstrField(d, o + ACTOR_POSE_OFF).toLowerCase(),
      deg: num(ACTOR_PLACEMENT.deg),
      x: num(ACTOR_PLACEMENT.x),
      y: num(ACTOR_PLACEMENT.y),
      z: num(ACTOR_PLACEMENT.z),
      speed: num(ACTOR_PLACEMENT.speed),
      turn: num(ACTOR_PLACEMENT.turn),
      scale: num(ACTOR_PLACEMENT.scale),
      zclip: num(ACTOR_PLACEMENT.zclip),
    },
  };
}

/**
 * Walk the 160-byte actor grid, exactly as {@link walkPropGrid} walks the props:
 * lock onto the grid from the first pair of consecutive records, rewind to its
 * base, then run forward until a slot fails. Returns `[offset, actor]` pairs so
 * the writer can patch owners in place.
 */
export function walkActorGrid(d: Uint8Array): { off: number; actor: SavedActor }[] {
  const last = d.length - ACTOR_OWNER_OFF;
  let seed = -1;
  for (let o = 0; o < last; o++) {
    if (actorRecordAt(d, o) && actorRecordAt(d, o + ACTOR_STRIDE)) {
      seed = o;
      break;
    }
  }
  if (seed < 0) return [];
  let base = seed;
  while (base - ACTOR_STRIDE >= 0 && actorRecordAt(d, base - ACTOR_STRIDE)) base -= ACTOR_STRIDE;
  const out: { off: number; actor: SavedActor }[] = [];
  for (let o = base; o < last; o += ACTOR_STRIDE) {
    const actor = actorRecordAt(d, o);
    if (!actor) break;
    out.push({ off: o, actor });
  }
  return out;
}

/**
 * The container-0 manifest, as the loader reads it: the records' old handles and
 * the BASENAME each path ends in — `0x4152e0` finds a record by handle
 * (`0x4153f0`), strips its path to the last ":" (`0x42bc20`) and opens that.
 */
export function manifestFiles(c0: Uint8Array): { handle: number; file: string; path: string }[] {
  const dv = new DataView(c0.buffer, c0.byteOffset, c0.byteLength);
  const out: { handle: number; file: string; path: string }[] = [];
  const n = c0.length >= C0_FILE_RECORDS ? dv.getInt32(C0_FILE_COUNT, true) : 0;
  for (let i = 0; i < n; i++) {
    const o = C0_FILE_RECORDS + i * C0_FILE_STRIDE;
    if (o + C0_FILE_STRIDE > c0.length) break;
    const path = pstrAtChecked(c0, o + 4, 0, 255) ?? "";
    out.push({ handle: dv.getUint32(o, true), file: path.slice(path.lastIndexOf(":") + 1).toLowerCase(), path });
  }
  return out;
}

/**
 * The file a list record opens, the way TI.EXE's resume finds it: by the old
 * handle at +0, through the container-0 manifest (0x4152e0), falling back to the
 * record's own name. The two agree in every record of the shipped corpus (156
 * casts, 373 banks); a record whose handle the manifest lacks is fatal 0x1127 in
 * the original, and the name is what the port can still use.
 */
function recordFile(d: Uint8Array, o: number, nameOff: number, files: Map<number, string>): string {
  const own = (pstrAtChecked(d, o + nameOff, 1, 40) ?? "").toLowerCase();
  return files.get(new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(o, true)) ?? own;
}

/** the manifest's handle → basename map, for {@link recordFile} */
const manifestByHandle = (raw: RawSaveFile): Map<number, string> =>
  new Map(manifestFiles(raw.containers[0].data).map((f) => [f.handle, f.file]));

/** Decode the open-cast-file list (see {@link CAST_STRIDE}), lowercased. */
function decodeCastFiles(raw: RawSaveFile, castsIndex: number): string[] {
  const d = raw.containers[castsIndex].data;
  const files = manifestByHandle(raw);
  const out: string[] = [];
  for (let o = 0; o + CAST_STRIDE <= d.length; o += CAST_STRIDE) {
    const name = recordFile(d, o, CAST_NAME, files);
    if (name) out.push(name);
  }
  return out;
}

/** Decode the live `makeloop` table (see {@link SavedLoop}). */
function decodeLoops(d: Uint8Array): SavedLoop[] {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const out: SavedLoop[] = [];
  for (let s = 0; s + 42 <= d.length; s += 42) {
    if (dv.getUint16(s, true) === 0) continue; // slot free
    const kind = LOOP_KINDS[dv.getUint16(s + 4, true)];
    const name = pstrField(d, s + 10);
    const handler = pstrField(d, s + 26);
    if (!kind || !name || !handler) continue; // junk in a free-but-nonzero slot
    out.push({
      kind,
      name: name.toLowerCase(),
      handler: handler.toLowerCase(),
      period: dv.getUint32(s + 6, true),
    });
  }
  return out;
}

/** Decode the live `makecricket` table (see {@link SavedCricket}). */
function decodeCrickets(d: Uint8Array): SavedCricket[] {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const out: SavedCricket[] = [];
  for (let s = 0; s + 74 <= d.length; s += 74) {
    if (dv.getUint16(s, true) === 0) continue;
    const name = pstrField(d, s + 0x3a);
    if (!name) continue;
    out.push({
      name: name.toLowerCase(),
      set: pstrField(d, s + 0x2a).toLowerCase(),
      x: dv.getInt16(s + 4, true),
      y: dv.getInt16(s + 6, true),
      radius: dv.getUint32(s + 8, true),
      base: dv.getUint32(s + 0x0c, true),
      jitter: dv.getInt32(s + 0x10, true),
      next: dv.getUint32(s + 0x14, true),
    });
  }
  return out;
}

/**
 * One type-3 walk's waypoint payload: a total length @+0, a count @+8, and that
 * many 8-byte `{i16 x, y, z, u16 distance from the previous point}` from +20.
 * The container is a raw allocation, so slack trails the last point — the count
 * is what bounds it, never the length.
 */
function decodeWalkPath(d: Uint8Array): SavedWalk["path"] {
  if (d.length < 20) return undefined;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const count = dv.getUint32(8, true);
  if (count < 2 || 20 + count * 8 > d.length) return undefined;
  const path: NonNullable<SavedWalk["path"]> = [];
  let cum = 0;
  for (let i = 0; i < count; i++) {
    const o = 20 + i * 8;
    cum += dv.getUint16(o + 6, true);
    path.push({ x: dv.getInt16(o, true), y: dv.getInt16(o + 2, true), z: dv.getInt16(o + 4, true), cum });
  }
  // the running sum has to arrive at the total the header states, or these are
  // not the waypoints we think they are
  return cum === dv.getUint32(0, true) ? path : undefined;
}

/**
 * Decode the active walk slots (see {@link SavedWalk}).
 *
 * `payloads` are the containers that follow the walks table, which the writer
 * appends one per active slot carrying a route — in SLOT ORDER, which is what
 * lets them be matched up positionally.
 */
function decodeWalks(d: Uint8Array, payloads: Uint8Array[]): SavedWalk[] {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const out: SavedWalk[] = [];
  for (let s = 0; s + 110 <= d.length; s += 110) {
    if (dv.getUint16(s + WALK_SLOT.active, true) === 0) continue;
    const actor = pstrField(d, s + WALK_SLOT.actor);
    if (!actor) continue;
    const type = dv.getInt16(s + WALK_SLOT.type, true);
    const path =
      dv.getUint32(s + WALK_SLOT.payload, true) !== 0
        ? decodeWalkPath(payloads.shift() ?? new Uint8Array())
        : undefined;
    const startX = dv.getInt16(s + WALK_SLOT.x, true);
    const startY = dv.getInt16(s + WALK_SLOT.y, true);
    const startZ = dv.getInt16(s + WALK_SLOT.z, true);
    // ONLY the straight-line mover writes the movement words. A turn has no
    // mover at all, and a route keeps its total length in its own payload
    // container — both leave whatever the slot held last, which is how `hack`'s
    // route comes to claim a distance of -1422655421 (see {@link SavedWalk})
    const moves = type === 1;
    let dist = 0;
    if (path) dist = path.at(-1)!.cum;
    else if (moves) dist = dv.getInt32(s + WALK_SLOT.dist, true);
    out.push({
      actor: actor.toLowerCase(),
      type,
      hasPayload: dv.getUint32(s + WALK_SLOT.payload, true) !== 0,
      paused: dv.getUint16(s + WALK_SLOT.paused, true) !== 0,
      turnTo: dv.getInt16(s + WALK_SLOT.turnTo, true),
      deg: dv.getInt16(s + WALK_SLOT.deg, true),
      startX, startY, startZ,
      destX: moves ? startX - dv.getInt32(s + WALK_SLOT.dx, true) : startX,
      destY: moves ? startY - dv.getInt32(s + WALK_SLOT.dy, true) : startY,
      destZ: moves ? startZ - dv.getInt32(s + WALK_SLOT.dz, true) : startZ,
      // a route's progress IS written (it is the one movement word the path
      // mover keeps in the record); its length comes from the payload header
      progress: moves || path ? dv.getInt32(s + WALK_SLOT.progress, true) : 0,
      dist,
      star: pstrField(d, s + WALK_SLOT.star) ?? "",
      path,
    });
  }
  return out;
}

/**
 * Every open audio bank, in the order the list holds them.
 *
 * Not the same question as {@link decodeTheme}: that one asks which bank was
 * SOUNDING, and a bank can be open with nothing playing out of it and still be
 * the one a restored loop reaches for. The sinking's ambience is exactly that —
 * `insddest.sfx` is open in the mission-4 saves with all three of its arrays
 * empty, because BOOTFILE's `playcrickets` opens the bank once and then picks a
 * random one-shot out of it on every tick (#199).
 */
function decodeTrackFiles(raw: RawSaveFile, tracksIndex: number): string[] {
  if (tracksIndex < 0) return [];
  const d = raw.containers[tracksIndex].data;
  const files = manifestByHandle(raw);
  const out: string[] = [];
  for (let k = 0; k < d.length / TRACK_STRIDE; k++) {
    const name = recordFile(d, k * TRACK_STRIDE, TRACK_NAME_OFF, files);
    if (name) out.push(name);
  }
  return out;
}

/**
 * The playing theme, from the track whose playing/looping arrays are non-empty.
 * One track carries them in 107 of the 109 shipped saves, and it is always the
 * room's live theme — `savetheme`, the global, is NOT it: that records the
 * theme to restore after an interlude and lags the file by up to a whole act in
 * 91 of the 109. The two exceptions are the London-flat saves, where TWO tracks
 * are live: bedrad1.trk's 15 radio-programme chunks (the audible score, and the
 * one BEDSIT1.SET's hotspot gate demands — #36) and bedsit1.trk's 5 armed
 * plane/bomb loops, waiting for the bombing. So the score is the live track
 * with the MOST live records, and any other live track's sounds are counted as
 * `extras` (reported by the loader, not restored — the room's own scripts
 * re-arm them). The port scores a room at track granularity, which is also why
 * a multi-chunk theme (decka.trk loops 11 ambience chunks at once) is one
 * restore, not eleven.
 */
function decodeTheme(raw: RawSaveFile, tracksIndex: number): SavedTheme | null {
  if (tracksIndex < 0) return null;
  const d = raw.containers[tracksIndex].data;
  const live: { track: string; volume: number; count: number; names: Set<string> }[] = [];
  for (let k = 0; k < d.length / TRACK_STRIDE; k++) {
    const track = pstrField(d, k * TRACK_STRIDE + TRACK_NAME_OFF).toLowerCase();
    const names = new Set<string>();
    let volume = 255;
    let count = 0;
    for (const j of [1, 2]) {
      const arr = raw.containers[tracksIndex + 1 + 3 * k + j].data;
      const dv = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
      for (let s = 0; s + SOUND_STRIDE <= arr.length; s += SOUND_STRIDE) {
        if (!count) volume = dv.getUint16(s + 4, true);
        count++;
        names.add(pstrField(arr, s + 8).toLowerCase());
      }
    }
    if (count) live.push({ track, volume, count, names });
  }
  if (!live.length) return null;
  // the score is the busiest live track; a later track wins a tie (it was
  // opened later, i.e. it is the room's own)
  let best = live[0];
  for (const t of live) if (t.count >= best.count) best = t;
  let extras = 0;
  for (const t of live) if (t !== best) extras += t.names.size;
  return { track: best.track, volume: best.volume, extras };
}

/** Hall/deck set → the deck-plan page it sits on (MAP.STG currentpage cases).
 * Used only as a sane fallback for the staircase deck selector on load. */
const HALL_DECK: Record<string, string> = {
  halla: "a",
  hallb: "b",
  hallc: "c",
  halld: "d",
  hallf2c: "f",
  hallf3c: "f",
  decka: "a",
  deckbd: "bd",
  deckbd2: "bd",
};

export function parseSave(bytes: Uint8Array): SaveGame {
  const raw = readSaveFile(bytes);
  // container 0: title (@0) + disk family (@256).
  const title = new BinaryReader(raw.containers[0].data).pstr();
  const disk = pstrField(raw.containers[0].data, 256);

  // container 1: current stage / set / scene / view at fixed offsets.
  const c1 = raw.containers[1].data;
  const stage = pstrField(c1, C1_STAGE);
  const set = pstrField(c1, C1_SET);
  const scene = pstrField(c1, C1_SCENE);
  const view = pstrField(c1, C1_VIEW);
  const frame =
    c1.length >= C1_FRAME + 4
      ? new DataView(c1.buffer, c1.byteOffset, c1.byteLength).getUint32(C1_FRAME, true)
      : 0;

  const index = saveIndex(raw);

  // the string pool is the container right after the globals container — the
  // original loader reads them as a pair (pool handle stored at blob+0x10).
  const vars = decodeVars(raw.containers[index.globals].data, raw.containers[index.pool].data);
  const inventory = walkPropGrid(raw.containers[index.inventory].data).map((r) => r.prop);
  const actors = walkActorGrid(raw.containers[index.actors].data).map((r) => r.actor);

  // which cast files were open — the crowd is instanced from them, and a load
  // runs no openset to reopen them (#186).
  const castFiles = decodeCastFiles(raw, index.casts);

  // the scheduler tables (loops/crickets/walks) and the open-track sound state —
  // what a load restores instead of re-running the room's openset (#143).
  const loops = decodeLoops(raw.containers[index.loops].data);
  const crickets = decodeCrickets(raw.containers[index.crickets].data);
  // the walks table, and the waypoint payloads that follow it — one per active
  // slot with a route, in slot order (see decodeWalks)
  const walks = decodeWalks(
    raw.containers[index.walks].data,
    raw.containers.slice(index.walks + 1).map((c) => c.data),
  );
  const trackFiles = decodeTrackFiles(raw, index.tracks);
  const theme = decodeTheme(raw, index.tracks);

  // Split the decoded variables by DFValue type: 2/4 = numbers (inline), 3 =
  // strings (decoded via the pool). First-wins on duplicate names — the engine's
  // lookup walks the list from the head. See docs/engine/formats/savegame.md.
  const numGlobals = new Map<string, number>();
  const strGlobals = new Map<string, string>();
  for (const v of vars) {
    if (v.type === DFVALUE_STRING) {
      if (v.str !== null && !strGlobals.has(v.name)) strGlobals.set(v.name, v.str);
    } else if (!numGlobals.has(v.name)) numGlobals.set(v.name, v.num);
  }

  // hallside ("port"/"star") decodes from its variable record, and only from it.
  // A pool-scanning fallback stood here for a long time, resting on a container
  // that does not exist: the "location savestate stack" it walked was the string
  // POOL (the heuristic locked onto it in 109 of 109 shipped saves — the pool
  // holds the same facing/side/coordinate strings, in allocation order). And it
  // never fired with a value: exactly 4 shipped saves lack the record, all
  // pre-boarding (bedsit1/c73), and none of their pools hold a side token,
  // because no hallway had ever been entered. An unset hallside is what a fresh
  // game has until the first hall assigns one.
  const hallside = strGlobals.get("hallside") ?? "";

  // savedeck (the staircase deck-plan selector, "a".."g"/"bd") likewise; the
  // fallback derives it from the current hall/deck set when unambiguous.
  const savedeck = strGlobals.get("savedeck") ?? HALL_DECK[set.toLowerCase()] ?? "";

  // clock, as text, for a caller that only wants to read it. The restore path
  // does NOT use this: clock rides numGlobals/strGlobals like every other
  // variable, so a mission-4 save puts back the NUMBER calctime left there.
  const clock = strGlobals.get("clock") ?? (numGlobals.has("clock") ? String(numGlobals.get("clock")) : "");

  return {
    title, disk, set, scene, view, stage, frame, clock, hallside, savedeck,
    vars, numGlobals, strGlobals, inventory, actors, castFiles, trackFiles,
    loops, crickets, walks, theme, raw, index,
  };
}
