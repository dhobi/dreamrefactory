import { Container, DFContainerFile, readContainerFile } from "./container";
import { versionOf } from "./version";


/**
 * SET files as *Dust: A Tale of the Wired West* (DreamFactory 1, 1995) writes
 * them — a separate reader from {@link file://./set.ts}, and separate on purpose.
 *
 * ## Why this is not a branch inside the v4 reader
 *
 * The header offsets moving would be a branch. What actually differs is the
 * MODEL of movement, and a shared reader would have to pretend the two are one
 * thing.
 *
 * A v4 set is scenes (standpoints), each carrying a full 360° ring of turn
 * frames, joined by roads whose two frame registers walk you between them. A v1
 * set has neither ring nor road. It has a GRID of cells, and one flat table of
 * TRANSITIONS in which a turn and a walk are the same kind of record:
 *
 *     from (x, z, facing)  ->  to (x, z, facing)   + a run of frames
 *
 * Turning is the record where the cell is equal and the facing differs; walking
 * is the record where the facing is equal and the cell differs. APOTH.SET has 28
 * of them, and 28 is exactly 3 walkable cells × 8 turns (four facings, each way
 * round) + 4 walks (0↔1, 1↔2). Nothing else is stored, because nothing else
 * exists: there is no way to face a direction the table has no record for.
 *
 * So Titanic's rings and roads are the EVOLUTION of this table — the same idea
 * with the turns factored out of it. Reading v1 through the v4 shapes would mean
 * synthesizing rings that were never authored; reading it as what it is costs one
 * file and stays honest.
 *
 * ## The frame runs, and the sixth container
 *
 * A transition record names its FIRST frame container and not how many follow.
 * Each is allotted {@link FRAME_SLOT} containers, of which the MOVE is the first
 * {@link RUN_FRAMES} — five — ending on the arrival standpoint's picture. A move
 * that wants fewer leaves the tail as GAP containers, which is how APOTH.SET
 * comes to have 40 gaps among its 192 frame slots.
 *
 * The sixth is not part of the move — when it is there at all. It is the HI-RES
 * STANDING VIEW of the standpoint the transition departs FROM — Titanic's `motionInfo == 2` twin,
 * which v4 stores at the head of a register and v1 stores at the tail of the
 * slot. Three measurements say so and nothing else fits:
 *
 *   - APOTH.SET has exactly 12 containers over 60 KB against ~30 KB for the
 *     rest, and exactly 12 standpoints. Every one of the twelve is the sixth of
 *     some slot.
 *   - each one's coarse colour signature sits 0.5–1.3 from its transition's
 *     DEPARTURE standpoint and 7.5–22.5 from anything else, including its
 *     arrival.
 *   - counting it as part of the move breaks the set: a standpoint's picture is
 *     agreed on by 44/44 arrivals and departures when the run is five, and by
 *     12/44 when it is six. That was a real symptom — a turn ending on a view
 *     of somewhere else entirely.
 *
 * So the run is read by walking the slot to the gaps or to {@link RUN_FRAMES},
 * whichever comes first, and the sixth is handed back separately as
 * {@link V1Transition.departureStill}.
 */

/** how many containers a transition is allotted: its run, then the hi-res still */
export const FRAME_SLOT = 6;
/** how many of those are the MOVE — the last of them is the arrival's picture */
export const RUN_FRAMES = 5;

/**
 * Container 0's header, at the offsets a v1 SET puts them.
 *
 * Read out of APOTH.SET by hand and then checked against all 35 sets on the disc
 * — see `readSetFileV1`'s `warnings`, which is where a set that disagrees says
 * so rather than being quietly misread.
 *
 * The two registers are i16 where v4's are i32. That is not a guess: the i32 at
 * 0x1c reads 0x002c0001 in APOTH, whose low half is 1 and whose high half is 44,
 * and 44 is the transition register while 1 is the set's main script — two fields
 * that v4 spreads over eight bytes and v1 packs into four.
 */
const C0 = {
  version: 0x02, // i32
  transitionCount: 0x08, // i32
  /**
   * i16 the camera's height above the floor, in the set's own world units.
   *
   * Which this reader believes because it VARIES with the room and nothing else
   * in the header does: 90 in COURT, 140 in APOTH and BANK, 160 in the livery and
   * the hotel's lower floor, 230 in CHIN. The word at 0x2e reads 99 in all 35
   * sets, so that one is a format marker and not a measurement.
   */
  /**
   * i16 how far the camera stands BEHIND its cell anchor, along the facing.
   *
   * 64 in all 29 sets, and DF.EXE consumes it in its camera builder
   * (0x433fd4..0x43401e): `camX -= fix14(sin[bearing] * [0x460b8c])`,
   * `camY -= fix14(cos[bearing] * ...)` — the camera is pulled back along the
   * view bearing before anything is projected. The same global is subtracted
   * in the sprite z-test (0x41e81e), which is what its +0x80 was compensating.
   * Misread at first as the z quantization (also 64), but the blit hardcodes
   * that as `sar 6` — this field was the setback all along.
   */
  cameraSetback: 0x18, // i16
  eyeHeight: 0x1a, // i16
  mainScript: 0x1c, // i16
  transitionRegister: 0x1e, // i16
  actorRegister: 0x22, // i16
  gridWidth: 0x26, // i16
  gridHeight: 0x28, // i16
  viewPortWidth: 0x2a, // i16
  viewPortHeight: 0x2c, // i16
  /**
   * Where the player stands when the set is opened with no scene named — cell,
   * cell, facing.
   *
   * v4 spells this as two pascal strings (`defaultSceneName`, `defaultViewName`);
   * v1 spells it as the three numbers that identify a standpoint on its grid, and
   * the two are the same fact.
   *
   * On all 35 sets on the disc the triple names a cell that exists AND a facing
   * that cell really has a standpoint for, which is what says the fields are these
   * three and in this order — and every one of them is the room's own doorway:
   * `Scene D2` behind the store counter, `Scene C5` at the courtroom door,
   * `Scene A2` in the undertaker's. `town.set` and `nite.set` both say cell (6,14)
   * facing 1 — `Scene G15`, the south road into town, which is where a stagecoach
   * would put you and where the game does.
   */
  defaultCellX: 0x30, // i16
  defaultCellZ: 0x32, // i16
  defaultFacing: 0x34, // i16
  /** the first of {@link CLUT_COUNT} palette blocks */
  palette: 0x50,
  /**
   * The name SCRIPTS address the set by, four bytes short of the end of the last
   * CLUT block — `0x50 + 3 * 0x910 - 4`.
   *
   * This is not the file's basename and the difference is load-bearing. `nite.set`
   * is called **town** and `nitecour.set` **court**, because each is the same
   * place after dark: `new.flt`'s `initall` compares `currentset()` against the
   * name it is about to open under and keeps your standpoint across the swap only
   * when they match, and the whole town cast is bound with `actorset(me, "town")`,
   * so a night room called "nite" is a night room nobody is standing in. Four more
   * differ the other way — `apoth.set` is **drugs**, `undertak.set` is **under**.
   *
   * All 35 sets on the disc have one, all lowercase, and between them they account
   * for every set name the corpus mentions: each of the nine names a script
   * compares `currentset()` against, and each of the 34 a script binds an actor or
   * a prop to. An earlier reader took the name from the shared prefix of the
   * cast's star names instead, which is right for most rooms and wrong for the
   * ones that matter: `target.set` carries `town.*` stars and `tbird.set` carries
   * `blood.*`, so it called them "town" and "blood".
   */
  setName: 0x50 + 3 * (256 * 8 + 0x110) - 4,
} as const;

/** a v1 SET carries three palettes, not one; each is 256 * 8 bytes */
export const PALETTE_SIZE = 256 * 8;
/** palette, then a name field, then the next palette */
const CLUT_BLOCK = PALETTE_SIZE + 0x110;
export const CLUT_COUNT = 3;

/** bytes per record in the transition register */
const TRANSITION_SIZE = 28;
/**
 * The scene table: an i32 count, then one 32-byte record per cell of the grid.
 *
 *     +0    i16 z, i16 x        the cell, Z first (see V1Scene)
 *     +4    8 bytes unknown
 *     +12   pstr name, in a 16-byte field
 *     +28   i32 the container holding this cell's script
 *
 * The SCRIPT REF IS AT THE END, after the name, and that cost every v1 scene in
 * the port its own script: read from the front of the record instead, each cell
 * ran its NEIGHBOUR's, off by exactly one standpoint down the whole table. What
 * masked it is that a set's first record is preceded by the count, so scene 1
 * came out pointing at a container that happened to exist, and the rest were laid
 * out in ascending order — so every ref resolved and none of them was right.
 *
 * Three things say where it is. Dust's scene loops name the scene they are armed
 * on (`makeloop("scene", "scene g14", "dayfxs", 2)`), and against the scene the
 * script is attached to that is 12 matches and 0 misses read from the end,
 * against 0 and 12 read from the front — every miss off by one cell. With the
 * record ending at +32 the table then ends EXACTLY at the end of container 0 on
 * 29 of 29 sets. And the i32 in front of it is the scene count on 29 of 29.
 *
 * The `z`/`x` pair is at the front and was always read correctly, which is what
 * kept this hidden: the names are grid coordinates, and A1 reading as cell (0,0)
 * and A15 as (14,0) is right either way you slide the record.
 */
const SCENE_SIZE = 32;
/** from the start of a record to its name field — the fields before the name */
const SCENE_FIELDS = 16;
/** ...and from the name field to the script ref that follows it */
const SCENE_SCRIPT = 16;

/** where a move starts or ends: a grid cell and a facing */
export interface V1Standpoint {
  /** grid column, 0-based */
  x: number;
  /** grid row, 0-based */
  z: number;
  /** which way the camera looks — 1..4, the set's own numbering */
  facing: number;
}

/**
 * One camera move, and the frames that play it.
 *
 * `kind` is derived rather than stored, because the file does not distinguish
 * them — see the header. It is here because everything above this layer wants to
 * know: a turn is instant-ish and a walk changes which cell you are standing in.
 */
export interface V1Transition {
  from: V1Standpoint;
  to: V1Standpoint;
  kind: "turn" | "walk";
  /** container ref of the first frame — the slot's base */
  firstFrame: number;
  /** the move's frames, in order; the last is {@link V1Transition.to}'s picture */
  frames: number[];
  /**
   * The hi-res standing view of {@link V1Transition.from}, or -1 when this slot
   * carries none.
   *
   * Exactly one transition departing each standpoint carries it, so a caller
   * wanting "the picture of standing at S" looks for the departure from S that
   * has one. See the header for why this is not a sixth frame of the move.
   */
  departureStill: number;
  /** byte offset of this record, for a diagnostic that wants to point at it */
  record: number;
}

/** one cell of the set's grid, named and scripted */
export interface V1Scene {
  name: string;
  x: number;
  z: number;
  /** container ref of this cell's script, 0 when it has none */
  scriptLocation: number;
  record: number;
}

/** a named place in the set a cast member can be put — v4 calls it a star */
export interface V1Actor {
  identifier: string;
  rotation8: number;
  positionX: number;
  positionZ: number;
  positionY: number;
  record: number;
}

/** one authored walking route between a record's two stars — v4's {@link StarPath} */
export interface V1StarPath {
  a: string;
  b: string;
  /** container holding the polyline, read by v4's `readStarPath` unchanged */
  container: number;
}

/** one of the three palettes, with the CLUT name the file gives it */
export interface V1Clut {
  name: string;
  /** 256 * {i16 index, i16 rgb[3]} — the shape `paletteToRGBA` expects */
  raw: Uint8Array;
}

export interface SetFileV1 {
  file: DFContainerFile;
  version: 1;
  setName: string;
  cluts: V1Clut[];
  /** the first palette, which is what the set is drawn in until a script says else */
  paletteRaw: Uint8Array;
  gridWidth: number;
  gridHeight: number;
  viewPortWidth: number;
  viewPortHeight: number;
  /** the camera's height above the floor — see {@link C0.eyeHeight} */
  eyeHeight: number;
  /** how far the camera stands behind its cell anchor — see {@link C0.cameraSetback} */
  cameraSetback: number;
  /** the standpoint the set opens on — see {@link C0.defaultCellX} */
  defaultCellX: number;
  defaultCellZ: number;
  defaultFacing: number;
  mainScript: number;
  scenes: V1Scene[];
  actors: V1Actor[];
  /** the authored routes between them, in file order */
  starPaths: V1StarPath[];
  transitions: V1Transition[];
  /** what did not read the way this reader expects — empty on all 35 Dust sets */
  warnings: string[];
}

const pstr = (d: Uint8Array, o: number, max = 15): string => {
  const n = d[o];
  if (n < 1 || n > max || o + 1 + n > d.length) return "";
  return String.fromCharCode(...d.subarray(o + 1, o + 1 + n));
};

/** printable, so a run of coordinates is not mistaken for a name */
const isName = (s: string): boolean => s.length > 0 && /^[\x20-\x7e]+$/.test(s);

/**
 * Find the scene table, which the header does not point at.
 *
 * Two facts pin it without arithmetic through the CLUT blocks (whose name fields
 * are not all the same length — APOTH's third is four bytes shorter than its
 * first two, so counting forward from the palettes lands in the wrong place on
 * some sets):
 *
 *   - there are exactly `gridWidth * gridHeight` entries. Every set on the disc
 *     agrees: BANK is 4x3 and has 12, COURT 4x5 and 20, APOTH 3x3 and 9.
 *   - the table is the LAST thing in container 0, give or take a short tail.
 *
 * So the start is looked for near the end and accepted only when the whole run
 * of that many names checks out, which no run of palette bytes ever does.
 */
function findSceneTable(c0: Uint8Array, sceneCount: number): number {
  if (sceneCount < 1) return -1;
  const span = (sceneCount - 1) * SCENE_SIZE;
  // walk back from the end; the first start whose every entry is named wins
  for (let tail = 0; tail <= 64; tail++) {
    const first = c0.length - tail - span - SCENE_FIELDS;
    if (first < 0) break;
    let all = true;
    for (let i = 0; i < sceneCount; i++) {
      if (!isName(pstr(c0, first + i * SCENE_SIZE))) { all = false; break; }
    }
    if (all && first - SCENE_FIELDS >= 0) return first;
  }
  return -1;
}

export function readSetFileV1(data: Uint8Array): SetFileV1 {
  const file = readContainerFile(data);
  const containers = file.containers;
  const c0 = containers[0].data;
  const version = versionOf(c0);
  if (version !== 1) {
    throw new Error(`not a DreamFactory 1 SET (container 0 says version ${version})`);
  }
  const v = new DataView(c0.buffer, c0.byteOffset, c0.byteLength);
  const warnings: string[] = [];

  const cluts: V1Clut[] = [];
  for (let i = 0; i < CLUT_COUNT; i++) {
    const at = C0.palette + i * CLUT_BLOCK;
    if (at + PALETTE_SIZE > c0.length) {
      warnings.push(`palette ${i + 1} runs past container 0`);
      break;
    }
    cluts.push({ name: pstr(c0, at + PALETTE_SIZE, 63), raw: c0.subarray(at, at + PALETTE_SIZE) });
  }

  const gridWidth = v.getInt16(C0.gridWidth, true);
  const gridHeight = v.getInt16(C0.gridHeight, true);

  const scenes: V1Scene[] = [];
  const table = findSceneTable(c0, gridWidth * gridHeight);
  if (table < 0) {
    warnings.push("no scene table found in container 0");
  } else {
    for (let o = table; o + SCENE_FIELDS <= c0.length; o += SCENE_SIZE) {
      const name = pstr(c0, o);
      if (!isName(name)) break;
      const b = o - SCENE_FIELDS;
      if (b < 0) break;
      // the script ref FOLLOWS the name (see SCENE_SIZE); a record whose tail is
      // past the end of the container has none rather than borrowing a neighbour's
      const scriptAt = o + SCENE_SCRIPT;
      scenes.push({
        name,
        scriptLocation: scriptAt + 4 <= c0.length ? v.getInt32(scriptAt, true) : 0,
        /**
         * Z FIRST, then X — the opposite of the reading order, and the file is
         * what says so rather than taste.
         *
         * Read the other way round, PADRE.SET's six cells come out spanning three
         * columns and two rows against a header that declares a 2x3 grid, and its
         * walk to (0,2) addresses a cell no scene claims. Swapped, every set on
         * the disc has its cells inside its own declared grid and every cell a
         * transition names has a scene: 29 of 29, where before ten sets had cells
         * out of bounds and four lost their walks entirely.
         */
        z: v.getInt16(b + 4, true),
        x: v.getInt16(b + 6, true),
        record: b,
      });
    }
  }

  const transitionCount = v.getInt32(C0.transitionCount, true);
  const transitionRegister = v.getInt16(C0.transitionRegister, true);
  const actorRegister = v.getInt16(C0.actorRegister, true);

  const transitions = readTransitions(
    containers, transitionRegister, transitionCount, warnings,
    v.getInt16(C0.viewPortWidth, true), v.getInt16(C0.viewPortHeight, true),
  );
  const { actors, paths: starPaths } = readActors(containers[actorRegister], warnings);
  const setName = pstr(c0, C0.setName, 20);
  if (!setName) warnings.push(`no set name at 0x${C0.setName.toString(16)}`);

  const defaultCellX = v.getInt16(C0.defaultCellX, true);
  const defaultCellZ = v.getInt16(C0.defaultCellZ, true);
  const defaultFacing = v.getInt16(C0.defaultFacing, true);
  // the check that makes the field a reading rather than an assumption: the
  // triple has to be a standpoint this set actually has
  if (
    !transitions.some(
      (t) => t.from.x === defaultCellX && t.from.z === defaultCellZ && t.from.facing === defaultFacing,
    )
  ) {
    warnings.push(
      `default standpoint (${defaultCellX},${defaultCellZ}) facing ${defaultFacing} is not one of this set's`,
    );
  }

  return {
    file,
    version: 1,
    setName,
    cluts,
    paletteRaw: cluts[0]?.raw ?? new Uint8Array(PALETTE_SIZE),
    gridWidth,
    gridHeight,
    viewPortWidth: v.getInt16(C0.viewPortWidth, true),
    viewPortHeight: v.getInt16(C0.viewPortHeight, true),
    eyeHeight: v.getInt16(C0.eyeHeight, true),
    cameraSetback: v.getInt16(C0.cameraSetback, true),
    defaultCellX,
    defaultCellZ,
    defaultFacing,
    mainScript: v.getInt16(C0.mainScript, true),
    scenes,
    actors,
    starPaths,
    transitions,
    warnings,
  };
}

function readTransitions(
  containers: Container[],
  register: number,
  count: number,
  warnings: string[],
  frameWidth: number,
  frameHeight: number,
): V1Transition[] {
  const c = containers[register];
  if (!c || c.gap) {
    warnings.push(`transition register c${register} is missing`);
    return [];
  }
  const d = c.data;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const have = Math.floor(d.length / TRANSITION_SIZE);
  if (have !== count) {
    warnings.push(`header says ${count} transitions, register holds ${have}`);
  }
  const out: V1Transition[] = [];
  for (let i = 0; i < have; i++) {
    const o = i * TRANSITION_SIZE;
    // the six coordinates are stored TWICE, back to back and identical, the way
    // v4 stores a low-res and a hi-res copy of the same standpoint pose. Only
    // the first copy is read; a disagreement between them is worth hearing about.
    const from: V1Standpoint = {
      x: v.getInt16(o, true), z: v.getInt16(o + 2, true), facing: v.getInt16(o + 4, true),
    };
    const to: V1Standpoint = {
      x: v.getInt16(o + 6, true), z: v.getInt16(o + 8, true), facing: v.getInt16(o + 10, true),
    };
    for (let k = 0; k < 6; k++) {
      if (v.getInt16(o + k * 2, true) !== v.getInt16(o + 12 + k * 2, true)) {
        warnings.push(`transition ${i}: the two coordinate copies disagree`);
        break;
      }
    }
    out.push({
      from,
      to,
      kind: from.x === to.x && from.z === to.z ? "turn" : "walk",
      firstFrame: v.getInt32(o + 24, true),
      frames: [],
      departureStill: -1,
      record: o,
    });
  }

  /**
   * Now the frames, which need every base known before any one slot can be
   * measured: a record names where its run STARTS and never how long it is.
   *
   * A run ends at whichever comes first — {@link RUN_FRAMES}, a gap container, or
   * the next slot's base. All three are needed. The gaps are how a move that
   * wants four frames fits a slot sized for five; the next base stops a run from
   * reaching into the slot after it (bounding on the stride alone claimed 957
   * frames twice across the disc, because the blocks do not all start on it); and
   * the RUN_FRAMES cap is what keeps the hi-res still out of the move.
   */
  /**
   * Could this container repaint the whole frame?
   *
   * A hi-res still is a KEYFRAME — a slot measures `K d d d d K` — and a ring
   * that opens on anything else decodes it with no base. Two slots on the disc
   * carry a leftover DELTA in the sixth position instead of a still (SALUPPER
   * c307 at 56 bytes, SALLOWER c600 at 104), and taken on faith they put exactly
   * that frame into a turn ring.
   *
   * Two cheap necessary conditions rather than a decode, because the decode costs
   * one full frame per standpoint and TOWN has 208 of them — 900 ms at every
   * arrival in the room you pass through most, against 29 ms for this.
   *
   *   - it must declare the WHOLE viewport. A frame's first two words are its
   *     height and width, and a partial delta declares only the strip it
   *     touches: that is what the two bad slots are, and why a bound on the
   *     frame's own declared height let them through (c307 says three rows and is
   *     56 bytes, which is plenty for three rows).
   *   - and it must be long enough to carry a row header for each of those rows.
   *
   * Both are sound in the direction that matters: neither can reject a frame that
   * really does repaint everything. Either could in principle accept a full-size
   * delta; that the disc contains none is proved the expensive way, by
   * `dust/tools/dustsets.ts`, which decodes every ring frame twice and checks the
   * property itself.
   */
  const couldRepaintAll = (loc: number): boolean => {
    const c = containers[loc];
    if (!c || c.gap || c.data.length < 8) return false;
    const d = new DataView(c.data.buffer, c.data.byteOffset, c.data.byteLength);
    return (
      d.getInt16(0, true) === frameHeight &&
      d.getInt16(2, true) === frameWidth &&
      c.data.length >= 4 + frameHeight
    );
  };

  const nextBase = new Map<number, number>();
  const bases = [...new Set(out.map((t) => t.firstFrame))].sort((a, b) => a - b);
  for (let i = 0; i < bases.length; i++) nextBase.set(bases[i], bases[i + 1] ?? Infinity);
  const real = (fr: number): boolean => {
    const fc = containers[fr];
    return !!fc && !fc.gap && fc.data.length >= 8;
  };
  for (const t of out) {
    const next = nextBase.get(t.firstFrame) ?? Infinity;
    const limit = Math.min(next, t.firstFrame + RUN_FRAMES);
    for (let fr = t.firstFrame; fr < limit && real(fr); fr++) t.frames.push(fr);
    // the slot's last container, when the run did not need it, it is there, and
    // it is actually a still rather than a leftover delta (see selfContained)
    const still = t.firstFrame + FRAME_SLOT - 1;
    if (still < next && t.frames.length === RUN_FRAMES && real(still) && couldRepaintAll(still)) {
      t.departureStill = still;
    }
  }
  /**
   * What matters about the slots is that no two runs claim the same container —
   * that is what makes "walk forward until the gaps" a safe way to find a run's
   * end. It is NOT that every base sits on a multiple of the stride: the frame
   * blocks restart at their own boundaries within a file (APOTH's second block
   * begins 30 containers after the first ends), and a reader that insisted on one
   * global stride called fifteen perfectly good sets broken.
   */
  const claimed = new Map<number, number>();
  for (let i = 0; i < out.length; i++) {
    for (const fr of [...out[i].frames, ...(out[i].departureStill >= 0 ? [out[i].departureStill] : [])]) {
      const owner = claimed.get(fr);
      if (owner !== undefined) {
        warnings.push(`transitions ${owner} and ${i} both claim frame c${fr}`);
      } else claimed.set(fr, i);
    }
  }
  return out;
}

/**
 * The star register: a count at 0x18, then fixed-size records.
 *
 * This is **v4's star register with four fewer bytes in the record** — the same
 * `{i16 rotation8, X, Z, Y, pstr identifier}` star, the same optional nested
 * SECONDARY star in the record's tail, and the same i16 pointing at the
 * container that holds the authored walking route between the two. v4 leads each
 * record with an i32 nothing reads and pads the slot to 54; v1 has neither, so
 * every offset is v4's less 4 and the stride is 50.
 *
 * It read as "two coordinates and a name, the rest a fixed tail" for as long as
 * only the primary was wanted, and that cost real stars: `gang.cst` places Leroy
 * on `town.leroy1`, which is not a primary anywhere on the disc — it is the
 * secondary of `town.leroy2`, packed in the tail this reader was skipping. The
 * same skip in the v4 reader is what once kept Sasha from walking down the hall
 * (see `readActors` in set.ts), so the failure and the fix are both the second
 * time round.
 *
 * The tail is NOT zero-filled — every record carries the same f64-looking bytes
 * — so the stride has to be the constant and a secondary is recognised by its
 * name reading as a name and its position being somewhere, exactly as v4 does it.
 */
const ACTOR_BASE = 0x1c;
const ACTOR_SIZE = 50;
const ACTOR_NAME = 8;
/** the nested secondary's rotation8; its X is at +2 of that, its name at +8 */
const ACTOR_SECONDARY = 26;
/** i16 container ref: the polyline from the primary to the secondary */
const ACTOR_PATH = 24;

/** letters, digits, dot and underscore — how a real star name is told from tail
 *  bytes that happen to start with a plausible length (v4's `validStarId`) */
const validStarId = (s: string): boolean => s.length > 0 && /^[A-Za-z0-9._]+$/.test(s);

function starAt(d: Uint8Array, v: DataView, o: number, idLimit: number): V1Actor {
  return {
    rotation8: v.getInt16(o, true),
    positionX: v.getInt16(o + 2, true),
    positionZ: v.getInt16(o + 4, true),
    positionY: v.getInt16(o + 6, true),
    identifier: pstr(d, o + ACTOR_NAME, idLimit),
    record: o,
  };
}

function readActors(
  c: Container | undefined,
  warnings: string[],
): { actors: V1Actor[]; paths: V1StarPath[] } {
  const actors: V1Actor[] = [];
  const paths: V1StarPath[] = [];
  if (!c || c.gap) return { actors, paths };
  const d = c.data;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const count = v.getInt32(0x18, true);
  if (count < 0 || count > 256) {
    warnings.push(`star register: implausible count ${count}`);
    return { actors, paths };
  }
  for (let i = 0; i < count; i++) {
    const o = ACTOR_BASE + i * ACTOR_SIZE;
    if (o + ACTOR_SIZE > d.length) {
      warnings.push(`star ${i}: record runs past the register`);
      break;
    }
    // each identifier runs to the start of what follows it: the secondary for
    // the primary's name, the end of the record for the secondary's
    const primary = starAt(d, v, o, ACTOR_SECONDARY - ACTOR_NAME - 1);
    if (!primary.identifier) {
      warnings.push(`star ${i}: no name at 0x${(o + ACTOR_NAME).toString(16)}`);
      break;
    }
    actors.push(primary);
    const secondary = starAt(
      d, v, o + ACTOR_SECONDARY, ACTOR_SIZE - ACTOR_SECONDARY - ACTOR_NAME - 1,
    );
    if (
      validStarId(secondary.identifier) &&
      (secondary.positionX !== 0 || secondary.positionZ !== 0 || secondary.positionY !== 0)
    ) {
      actors.push(secondary);
      const container = v.getInt16(o + ACTOR_PATH, true);
      if (container > 0) paths.push({ a: primary.identifier, b: secondary.identifier, container });
    }
  }
  return { actors, paths };
}
