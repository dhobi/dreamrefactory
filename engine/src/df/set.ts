import { BinaryReader } from "./binary";
import { Container, DFContainerFile, readContainerFile } from "./container";
import type { DfVersion } from "./version";

/**
 * SET file structures — port of DFset (dfet/libs/DFfile/DFset/*.cpp),
 * DreamFactory version 4.0 (Titanic: Adventure Out of Time).
 *
 * A Set is a room/section. It has Scenes (standpoints), each Scene has
 * Views (directions you can face) plus full 360° turn-frame rings, and
 * Transitions ("roads") connect scenes with walk animation frames.
 */

export interface FrameInfo {
  posX: number;
  posZ: number;
  posY: number;
  /** horizontal camera rotation, radians */
  axisX: number;
  posX16: number;
  posZ16: number;
  posY16: number;
  axisX8: number;
  /** 0 = in-motion frame, 1 = low-res standpoint, 2 = hi-res standpoint */
  motionInfo: number;
  frameContainerLoc: number;
  framePairID: number;
  transitionLog: number;
  /** index into the scene's view table, -1 = unnamed */
  viewID: number;
}

/** a list of motion frames: a scene's 360-degree turn ring, or one
 *  direction of a road's walk animation (dfet calls both "registers") */
export interface FrameRegister {
  destination: number;
  frames: FrameInfo[];
}

export interface ObjectEntry {
  rotation8: number;
  startRegionX: number;
  startRegionY: number;
  endRegionX: number;
  endRegionY: number;
  locationScript: number;
  identifier: string;
  /** byte offset of this 36-byte record in the view's object container (edit
   *  target — see {@link patchObjectIdentifier} / {@link patchObjectRegion}) */
  record: number;
}

export interface SceneView {
  /** radians */
  rotation: number;
  rotation8: number;
  viewPairType: number;
  /**
   * camera height for world→screen projection, in metres from the ship's
   * datum; world units are height × 512 (TI.EXE projects props against
   * per-view camera structs whose z comes from this double)
   */
  cameraHeight: number;
  viewID: number;
  locationObjects: number;
  viewName: string;
  objects: ObjectEntry[];
  /** byte offset of this 46-byte record in the scene's view container */
  record: number;
}

export interface Scene {
  index: number;
  sceneName: string;
  /**
   * v1 only: this grid cell is BUILT ON — a building or scenery, not street.
   *
   * Undefined on a v4 set, which has no grid to build on. What reads it is
   * `scenebuild(name)`, a DreamFactory 1 command Dust's bounty hunters walk by;
   * see V1Scene.build for the evidence that record +12 is this flag.
   */
  build?: boolean;
  /** byte offset of this 42-byte entry in the main scene register */
  record: number;
  xAxisMap: number;
  zAxisMap: number;
  yAxisMap: number;
  locationViews: number;
  locationScript: number;
  sceneLocation: [number, number, number];
  views: SceneView[];
  /** [RIGHTTURNS, LEFTTURNS] — full turn ring in each direction */
  turns: [FrameRegister, FrameRegister];
}

export interface Transition {
  locationTransitionInfo: number;
  viewIDstart: number;
  viewIDend: number;
  start: [number, number, number];
  end: [number, number, number];
  transitionName: string;
  waypoints: [number, number, number][];
  /** [0]: frames A→B, [1]: frames B→A (per dfet writeAllFrames naming) */
  frameRegisters: [FrameRegister, FrameRegister];
}

export interface Actor {
  rotation8: number;
  positionX: number;
  positionZ: number;
  positionY: number;
  identifier: string;
  /** byte offset of the {rotation8, X, Z, Y, id} record in the actor container */
  record: number;
  /** characters that fit this record's identifier field (the primary actor's
   *  field runs up to the nested secondary, the secondary's to the record end) */
  idLimit: number;
}

export interface SetFile {
  file: DFContainerFile;
  /**
   * Which DreamFactory wrote it — 4, or 1 for a Dust set translated into this
   * shape (engine/src/df/set-v1-to-v4.ts).
   *
   * Almost nothing needs to ask: the translation exists precisely so the viewer,
   * the props and the actors do not know. The exception is a structure the two
   * engines lay out differently and the SET only POINTS at, so the translator
   * cannot normalise it in passing — {@link readStarPath}'s polyline is the one.
   */
  version: DfVersion;
  /** container refs of the three top-level registers (container 0 header) */
  mainSceneRegister: number;
  transitionRegister: number;
  actorRegister: number;
  setName: string;
  defaultSceneName: string;
  defaultViewName: string;
  viewPortWidth: number;
  viewPortHeight: number;
  /**
   * The projection's focal length, when the ENGINE that owns this set names one.
   *
   * DreamFactory 1 does: DF.EXE hard-codes 0x136 = 310 at both of the sites that
   * reset the world camera (0x4331e5 and 0x433418), and its projectPoint
   * (0x433c60) multiplies both the lateral offset and the height drop by that
   * one constant before the truncating divide by depth — the exact shape of
   * engine/src/runtime/geometry.ts's projectPoint. A v4 SET leaves this unset and the
   * viewer keeps its measured default, max(viewW, viewH)/2.
   */
  focalLength?: number;
  /** units added to a sprite's depth before z-quantization — what remains of
   *  DF.EXE's +0x80 once the camera setback is taken out of it; unset (0) for
   *  v4. See Occlusion.groundBias and set-v1-to-v4 for the disassembly. */
  spriteZBias?: number;
  /** how far the camera stands BEHIND its cell anchor, along the facing —
   *  v1's header 0x18, applied by DF.EXE's camera builder (0x433fd4);
   *  unset (0) for v4, whose cameras are the stand frames' own. */
  cameraSetback?: number;
  /**
   * Z-image depth quantization (SCDO chunk, TI.EXE 0x4078ad): the far clip
   * depth (farMax) and the number of depth levels. A frame's Z image stores
   * per-pixel levels 0..zLevelCount where level = worldDepth × zLevelCount /
   * zFarMax (units/level = zFarMax/zLevelCount). Used to occlude world sprites
   * (actors) behind scenery — an actor pixel draws only where the scenery's
   * level is >= the actor's level (scenery farther-or-equal).
   */
  zFarMax: number;
  zLevelCount: number;
  mapLight: number;
  mapDark: number;
  mapWidth: number;
  mapHeight: number;
  setDimensionsX: number;
  setDimensionsY: number;
  mainScript: number;
  /** raw 2048-byte palette block ({i16 index, i16 rgb[3]} * 256) */
  paletteRaw: Uint8Array;
  /** How many of the 256 stored entries a set actually contributes to the screen
   *  CLUT — 128, and TI.EXE's own bound rather than an observation about the art:
   *  its palette-copy loop runs [0x48a00c, 0x48a00e) (0x440cc2), seeded 0 and
   *  0x80 at startup (0x429723, 0x4296e4). A set fills entries 0..127 and the
   *  stage owns the rest, which is why the bytes a set stores above 127 are
   *  never read — and why one set's copy of them could quietly drift (#158). */
  colorCount: number;
  scenes: Scene[];
  transitions: Transition[];
  actors: Actor[];
  /** authored actor routes between paired stars — see {@link StarPath} */
  starPaths: StarPath[];
}

export const RIGHTTURNS = 0;
export const LEFTTURNS = 1;

// ---------------------------------------------------------------------------
// Standpoint queries
// ---------------------------------------------------------------------------
// Pure questions about a parsed set that more than one caller asks: SetViewer
// when it turns or walks, and the playthrough route planner when it works out
// how to get somewhere. They live here so a planned turn and the turn taken
// cannot come from two different pieces of code.

/** the roads leaving a standpoint, by the view's GLOBAL id (SceneView.viewID) */
export function roadsAt(
  set: SetFile,
  globalViewID: number,
): { road: Transition; register: 0 | 1; arriveViewID: number }[] {
  const out: { road: Transition; register: 0 | 1; arriveViewID: number }[] = [];
  for (const road of set.transitions) {
    // A register with no frames is not a road you can take from this end.
    //
    // Titanic authors both directions of every road and never trips this. A
    // DreamFactory 1 road is one-way BY CONSTRUCTION: a v1 walk keeps its facing
    // at both ends, so the record that brings you back is the one leaving the far
    // cell on the OPPOSITE facing — a different standpoint, and so a different
    // road. Every translated v1 road therefore has an empty second register
    // (engine/src/df/set-v1-to-v4.ts), and offering it from the far end walked the player
    // into `frames[frames.length - 1]` of nothing: "Cannot read properties of
    // undefined (reading 'axisX')", raised out of boot's keydown.
    if (road.viewIDstart === globalViewID && road.frameRegisters[0].frames.length) {
      out.push({ road, register: 0, arriveViewID: road.viewIDend });
    } else if (road.viewIDend === globalViewID && road.frameRegisters[1].frames.length) {
      out.push({ road, register: 1, arriveViewID: road.viewIDstart });
    }
  }
  return out;
}

/**
 * One turn from `viewIdx` in direction `dir`: the standpoint it lands on and
 * the motion frames between. Null when this view isn't a standpoint in that
 * ring (an in-motion frame has no turn of its own).
 *
 * Ring entries index the SCENE's view table (FrameInfo.viewID), unlike roads,
 * which use global view ids.
 */
export function turnRing(scene: Scene, viewIdx: number, dir: number): { target: number; frames: FrameInfo[] } | null {
  const ring = scene.turns[dir]?.frames;
  if (!ring?.length) return null;
  const from = ring.findIndex((f) => f.viewID === viewIdx && f.motionInfo > 0);
  if (from < 0) return null;
  const frames: FrameInfo[] = [];
  let i = from;
  let target = viewIdx;
  for (let step = 0; step < ring.length; step++) {
    i = (i + 1) % ring.length;
    const fi = ring[i];
    frames.push(fi);
    if (fi.viewID >= 0 && fi.motionInfo > 0) {
      target = fi.viewID;
      break;
    }
  }
  return { target, frames };
}

/** a FrameInfo record consumes exactly this many bytes (4 f64 + 4 i16 +
 *  5 i32); the seek below pins the stride against future field drift */
const FRAME_INFO_SIZE = 60;

function readFrameRegister(c: Container): FrameRegister {
  const r = new BinaryReader(c.data);
  r.skip(4); // unknownInt
  const frameCount = r.i32();
  const destination = r.i32();
  const frames: FrameInfo[] = [];
  for (let i = 0; i < frameCount; i++) {
    const base = r.pos;
    frames.push({
      posX: r.f64be(),
      posZ: r.f64be(),
      posY: r.f64be(),
      axisX: r.f64be(),
      posX16: r.i16(),
      posZ16: r.i16(),
      posY16: r.i16(),
      axisX8: r.i16(),
      motionInfo: r.i32(),
      frameContainerLoc: r.i32(),
      framePairID: r.i32(),
      transitionLog: r.i32(),
      viewID: r.i32(),
    });
    r.seek(base + FRAME_INFO_SIZE);
  }
  return { destination, frames };
}

function readObjects(c: Container): ObjectEntry[] {
  const r = new BinaryReader(c.data);
  const objectCount = r.i32();
  r.skip(4); // unknownInt
  const objects: ObjectEntry[] = [];
  for (let i = 0; i < objectCount; i++) {
    const record = r.pos;
    r.skip(4); // unknownInt
    const rotation8 = r.i16();
    r.skip(2); // unknownShort2
    // regions are stored Y-first: (top, left, bottom, right) — dfet's struct
    // labels these X-first, which misplaces every hotspot
    const startRegionY = r.i16();
    const startRegionX = r.i16();
    const endRegionY = r.i16();
    const endRegionX = r.i16();
    const locationScript = r.i32();
    const identifier = r.pstr(15);
    objects.push({
      rotation8,
      startRegionX,
      startRegionY,
      endRegionX,
      endRegionY,
      locationScript,
      identifier,
      record,
    });
  }
  return objects;
}

/**
 * Field layout of the records the set editor writes into, as offsets from each
 * record's own start. The readers above walk them with sequential reads; these
 * are that walk resolved, so an edit lands on the same byte the read came from.
 * Exported for the write path (engine/src/df/set-patch.ts), which patches through them.
 */
export const OBJECT = { regionYStart: 8, identifier: 20, size: 36 } as const;
export const VIEW = { base: 52, identifier: 30, size: 46 } as const;
export const SCENE_ENTRY = { identifier: 26, size: 42 } as const;
export const TRANSITION_INFO = { identifier: 62 } as const;
export const ACTOR = { positionX: 2, identifier: 8 } as const;

function readScene(index: number, containers: Container[], mainSceneRegister: number): Scene {
  // 42-byte entry per scene in the main scene register
  const record = index * SCENE_ENTRY.size;
  const r = new BinaryReader(containers[mainSceneRegister].data, record);
  r.skip(4); // unknownDWORD1
  const xAxisMap = r.i16();
  const zAxisMap = r.i16();
  const yAxisMap = r.i16();
  const locationViews = r.i32();
  const locRight = r.i32();
  const locLeft = r.i32();
  const locationScript = r.i32();
  const sceneName = r.pstr();

  // view table container
  const vr = new BinaryReader(containers[locationViews].data);
  const sceneLocation: [number, number, number] = [vr.f64be(), vr.f64be(), vr.f64be()];
  vr.seek(48);
  const viewCount = vr.i32();
  const views: SceneView[] = [];
  for (let i = 0; i < viewCount; i++) {
    const viewRecord = vr.pos;
    const rotation = vr.f64be();
    const rotation8 = vr.i16();
    const viewPairType = vr.i32();
    const cameraHeight = vr.f64be();
    const viewID = vr.i32();
    const locationObjects = vr.i32();
    const viewName = vr.pstr(15);
    views.push({
      rotation,
      rotation8,
      viewPairType,
      cameraHeight,
      viewID,
      locationObjects,
      viewName,
      objects: locationObjects ? readObjects(containers[locationObjects]) : [],
      record: viewRecord,
    });
  }

  return {
    index,
    sceneName,
    record,
    xAxisMap,
    zAxisMap,
    yAxisMap,
    locationViews,
    locationScript,
    sceneLocation,
    views,
    turns: [readFrameRegister(containers[locRight]), readFrameRegister(containers[locLeft])],
  };
}

function readTransitions(containers: Container[], transitionRegister: number): Transition[] {
  const r = new BinaryReader(containers[transitionRegister].data);
  r.skip(4); // unknownInt
  const count = r.i32();
  const transitions: Transition[] = [];
  for (let road = 0; road < count; road++) {
    const locationTransitionInfo = r.i32();
    const locationSceneA = r.i32();
    const locationSceneB = r.i32();
    r.skip(4); // unknownShort1/2

    const ri = new BinaryReader(containers[locationTransitionInfo].data);
    ri.skip(4); // unknownInt
    ri.skip(2); // rotation8
    const viewIDstart = ri.i32();
    const viewIDend = ri.i32();
    const start: [number, number, number] = [ri.f64be(), ri.f64be(), ri.f64be()];
    const end: [number, number, number] = [ri.f64be(), ri.f64be(), ri.f64be()];
    const transitionName = ri.pstr(15);
    const entriesCount = ri.i32();
    const waypoints: [number, number, number][] = [];
    for (let e = 0; e < entriesCount; e++) {
      waypoints.push([ri.f64be(), ri.f64be(), ri.f64be()]);
    }

    transitions.push({
      locationTransitionInfo,
      viewIDstart,
      viewIDend,
      start,
      end,
      transitionName,
      waypoints,
      frameRegisters: [
        readFrameRegister(containers[locationSceneA]),
        readFrameRegister(containers[locationSceneB]),
      ],
    });
  }
  return transitions;
}

/** printable star identifier (letters/digits/dot/underscore) — used to tell a
 *  real nested actor from leftover heap bytes in the record tail */
function validStarId(s: string): boolean {
  return s.length >= 1 && s.length <= 20 && /^[A-Za-z0-9._-]+$/.test(s);
}

/**
 * One authored walking route between a star record's two stars, and the
 * container that holds it.
 *
 * A star record that carries a secondary may also carry a **path** between the
 * pair, as an i16 container ref at record +28 — the gap between the primary's
 * identifier field and the secondary's `rotation8`. TI.EXE reads it as a dword
 * (`0x40a123`), which is only equivalent because every secondary `rotation8` in
 * the corpus is 0; the two low bytes are the ref and this reads exactly those.
 * A record with no path leaves it 0, and both of the original's lookups skip a
 * zero — so an unpaired star can never match one.
 */
export interface StarPath {
  /** the primary star's identifier (record +12) */
  a: string;
  /** the secondary's (record +38) */
  b: string;
  /** container holding the polyline — see {@link readStarPath} */
  container: number;
}

/** one point of a {@link StarPath}: a world position and how far it is from the
 *  point before it (0 for the first) */
export interface StarPathPoint {
  x: number;
  y: number;
  z: number;
  /** distance from the previous point, as authored — TI.EXE walks the polyline
   *  on ONE progress scalar and needs the per-leg lengths to place a position */
  fromPrev: number;
}

/**
 * Truncating integer square root — TI.EXE's own (`0x435950`), and the reason a
 * route's stored leg lengths are what they are.
 *
 * `Math.floor(Math.hypot(...))` is NOT the same function: `halla`'s third leg is
 * 101×259, whose real length is 278.0004, and the file stores **277** because
 * 278² = 77284 overshoots 77282. Verified against all six shipped routes — every
 * leg matches this and every header total is the exact sum of its legs.
 *
 * Lives beside the route rather than in the writer because the ENGINE measures
 * with it too: a `"resume"` walk re-measures the legs of the route it trims (see
 * the walkonpath builtin), and a length that disagreed by a unit would pace that
 * walk differently from the authored one.
 */
export function isqrt(n: number): number {
  let r = Math.floor(Math.sqrt(n));
  while (r > 0 && r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/**
 * Where a polyline keeps its count and its first point.
 *
 * v1 is the same record with one i32 fewer and the two leading fields the other
 * way round: `{i32 count, i32 total length}`, bbox at 8, points from 16. Measured
 * on BANK.SET c239, where the six legs sum to the stored total (180 + 82 + 59 +
 * 101 + 104 = 526) and each `fromPrev` is the distance from the point before it —
 * two independent checks on one 64-byte container, and 34 of 34 paths on the disc
 * read clean under it.
 */
const PATH_BY_VERSION: Record<DfVersion, { count: number; first: number }> = {
  4: { count: 8, first: 20 },
  1: { count: 0, first: 16 },
};

/**
 * The polyline a {@link StarPath} names: `{i32 total length, i32, i32 count}`, a
 * `(Zmin, Xmin, Zmax, Xmax)` bounding box, then `count` × `{i16 X, Z, Y, i16
 * distance-from-previous}` from offset 20 — v1's own arrangement of the same
 * fields is {@link PATH_BY_VERSION}.
 *
 * The first point is the `a` star and the last is `b`, so a two-point path is a
 * straight line and everything between is the authored detour. HALLA's
 * `sasha.1` → `sasha.2` is five points: out of the cabin door, two turns along
 * the hall, then down it — which is why walking the straight line instead cut
 * the corner of the wall (#122).
 */
export function readStarPath(
  containers: Container[],
  location: number,
  version: DfVersion = 4,
): StarPathPoint[] {
  const c = containers[location];
  if (!c) return [];
  const r = new BinaryReader(c.data);
  const at = PATH_BY_VERSION[version];
  r.seek(at.count);
  const count = r.i32();
  const points: StarPathPoint[] = [];
  for (let i = 0; i < count; i++) {
    r.seek(at.first + i * 8);
    const x = r.i16();
    const z = r.i16();
    const y = r.i16();
    points.push({ x, y, z, fromPrev: r.i16() });
  }
  return points;
}

function readStarPaths(c: Container): StarPath[] {
  const r = new BinaryReader(c.data);
  const count = r.i32();
  r.skip(4);
  const paths: StarPath[] = [];
  for (let i = 0; i < count; i++) {
    const base = 8 + i * 54;
    r.seek(base + 28);
    const container = r.i16();
    if (!container) continue;
    const a = readActorAt(c.data, base + 4, 30 - 4 - ACTOR.identifier - 1);
    const b = readActorAt(c.data, base + 30, 54 - 30 - ACTOR.identifier - 1);
    if (validStarId(a.identifier) && validStarId(b.identifier)) {
      paths.push({ a: a.identifier, b: b.identifier, container });
    }
  }
  return paths;
}

function readActors(c: Container): Actor[] {
  // Each record is a fixed 54-byte slot. Its first 12 bytes hold the primary
  // actor (unknownInt, rotation8, X, Z, Y) followed by a length-prefixed
  // identifier. Crucially the record's TAIL — which the GPL dfet reference
  // (and this port, originally) skipped as "old copied mem" — packs an OPTIONAL
  // *secondary* actor at record offset +30, the same {rotation8, X, Z, Y, id}
  // shape as the primary at +4 (so its X is at +32). HALLA's sasha.1
  // record carries "sasha.2" (7212,10494,251) there, and ex1 carries "ex2";
  // scripts (walkonpath sasha.1→sasha.2, sashaidle's sasha.2↔sasha.3 toggle)
  // depend on those stars, so a fixed 41-byte skip silently dropped them and
  // Sasha never walked down the hall. We read the primary, then add the
  // secondary when its identifier is a real (printable, non-empty) name.
  const RECORD_SIZE = 54;
  const PRIMARY_OFFSET = 4; // after the record's leading unknownInt
  const SECONDARY_OFFSET = 30; // the nested actor's rotation8; its X is at +32
  const r = new BinaryReader(c.data);
  const count = r.i32();
  r.skip(4); // unknownInt
  const actors: Actor[] = [];
  for (let i = 0; i < count; i++) {
    const base = r.pos;
    // each identifier field runs to the start of what follows it: the nested
    // secondary for the primary's, the end of the record for the secondary's
    actors.push(
      readActorAt(c.data, base + PRIMARY_OFFSET, SECONDARY_OFFSET - PRIMARY_OFFSET - ACTOR.identifier - 1),
    );
    const secondary = readActorAt(
      c.data,
      base + SECONDARY_OFFSET,
      RECORD_SIZE - SECONDARY_OFFSET - ACTOR.identifier - 1,
    );
    if (
      validStarId(secondary.identifier) &&
      (secondary.positionX !== 0 || secondary.positionZ !== 0 || secondary.positionY !== 0)
    ) {
      actors.push(secondary);
    }
    r.seek(base + RECORD_SIZE);
  }
  return actors;
}

/** one {rotation8, X, Z, Y, id} actor/star record at an absolute offset —
 *  used for both the primary actor and the nested secondary */
function readActorAt(data: Uint8Array, off: number, idLimit: number): Actor {
  const r = new BinaryReader(data, off);
  const rotation8 = r.i16();
  const positionX = r.i16();
  const positionZ = r.i16();
  const positionY = r.i16();
  const identifier = r.pstr();
  return { rotation8, positionX, positionZ, positionY, identifier, record: off, idLimit };
}

/**
 * Container 0 (the SCDO chunk) header — absolute offsets. dfet's reader walks
 * this header with relative skips, which made "what offset is field X at?"
 * unanswerable without hand-summing; the table below is that walk resolved.
 *
 * Naming caveats vs dfet:
 *  - dfet labels the i16 at 0xa08 "setDimensionsY_2"; TI.EXE's SCDO depth
 *    quantization (0x4078ad) reads it as the far clip depth, so this port
 *    calls it zFarMax. zLevelCount at 0x9fa sits inside bytes dfet skips.
 *  - sceneRegister (0x50) is parsed by dfet but unused here — the scenes are
 *    read through mainSceneRegister (0x60) instead.
 */
export const C0 = {
  version: 0x02, // i32, must be 4
  mapLight: 0x18, // i32 container ref: lit deck-plan image
  mapDark: 0x1c, // i32 container ref: dark deck-plan image
  mapHeight: 0x24, // i16
  mapWidth: 0x26, // i16
  setDimensionsY: 0x2c, // i16 (also stored as f64be at 0x40/0x48; unread)
  setDimensionsX: 0x2e, // i16
  transitionRegister: 0x54, // i32 container ref (sceneRegister at 0x50: unused)
  /**
   * Three i32 container refs, and the corpus cannot tell them from constants:
   * across all 474 `.set` files in the seven editions and the demo, 0x58 reads 3,
   * 0x5c reads 1 and 0x60 reads 2, without exception. That is exactly the shape of
   * the v1 bug — `set-v1.ts`'s old `mainScript` was a word that read 1 in all 35
   * Dust sets and turned out not to be a pointer at all, which cost `undertak.set`
   * its whole script (#291).
   *
   * **The disassembly settles all three, and they are pointers.** `opensetfile`'s
   * header parser is `0x4076f0`, with `edi` on container 0, and each of the three
   * goes straight into the container-read routine `0x4385f0`:
   *
   *     0x4077f4: mov eax, [edi + 0x5c]   ; -> set->mainScript   (esi+0x10)
   *     0x4077fc: call 0x4385f0            ;    ...and open it
   *     0x4078d4: mov ecx, [edi + 0x60]   ; -> scene register    (esi+0x74)
   *     0x4078dd: mov eax, [edi + 0x64]   ; -> its record count  (esi+0x78)
   *     0x4078e9: call 0x4385f0
   *     0x407904: mov ecx, [edi + 0x58]   ; -> actor register    (esi+0x6c)
   *     0x407913: call 0x4385f0
   *
   * The layout argument that used to stand in for this was the right one — they sit
   * in a run with four refs that demonstrably ARE pointers (mapLight 0x18, mapDark
   * 0x1c, 0x50, transitionRegister 0x54 — 62 distinct values each, and provably
   * positional: in every set they are the file's last four containers except
   * `FORE.SET`, which has 739 and points at 733-736) — and now it is a reading
   * rather than an inference (#325). `set-build.ts` writes all four back at these
   * offsets, and {@link C0.sceneCount} at 0x64 is confirmed twice over: TI.EXE
   * stores it beside the register it counts, it equals the scene count in all 474
   * v4 sets, and a save's container 1 dumps the same pair at +652/+656.
   *
   * (TI.EXE is `<lang>/titanic1/install/bin/ti.exe` — the 461 KB engine, not the
   * 83 KB CD launcher beside the data. This note used to say the rip had only the
   * launcher.)
   */
  actorRegister: 0x58,
  mainScript: 0x5c,
  mainSceneRegister: 0x60,
  sceneCount: 0x64, // i32
  setName: 0x70, // pstr
  viewPortWidth: 0x84, // i16
  viewPortHeight: 0x86, // i16
  palette: 0xf2, // 256 * {i16 index, i16 rgb[3]} = 0x800 bytes
  // 0x8f2: secondaryRefName, pstr(255) — unread
  zLevelCount: 0x9fa, // i16 (see SetFile.zFarMax docblock)
  zFarMax: 0xa08, // i16 — dfet's "setDimensionsY_2"
  // 0xa0a: heightDifference, i32 — unread
  defaultSceneName: 0xa0e, // pstr(15)
  defaultViewName: 0xa1e, // pstr
} as const;

export function readSetFile(data: Uint8Array): SetFile {
  const file = readContainerFile(data);
  const containers = file.containers;
  const c0 = containers[0].data;
  const r = new BinaryReader(c0);

  r.seek(C0.version);
  const version = r.i32();
  if (version !== 4) {
    throw new Error(
      `DreamFactory SET version ${version}, and this reader is 4.0 only` +
        (version === 1 ? " — v1 (Dust) is read by readSetFileV1 in set-v1.ts" : ""),
    );
  }

  r.seek(C0.mapLight);
  const mapLight = r.i32();
  const mapDark = r.i32();
  r.seek(C0.mapHeight);
  const mapHeight = r.i16();
  const mapWidth = r.i16();
  r.seek(C0.setDimensionsY);
  const setDimensionsY = r.i16();
  const setDimensionsX = r.i16();

  r.seek(C0.transitionRegister);
  const transitionRegister = r.i32();
  const actorRegister = r.i32();
  const mainScript = r.i32();
  const mainSceneRegister = r.i32();
  const sceneCount = r.i32();
  r.seek(C0.setName);
  const setName = r.pstr();

  r.seek(C0.viewPortWidth);
  const viewPortWidth = r.i16();
  const viewPortHeight = r.i16();
  // depth quantization for actor occlusion (see SetFile.zFarMax)
  r.seek(C0.zLevelCount);
  const zLevelCount = r.i16();
  r.seek(C0.zFarMax);
  const zFarMax = r.i16();

  const paletteRaw = c0.subarray(C0.palette, C0.palette + 256 * 8);
  r.seek(C0.defaultSceneName);
  const defaultSceneName = r.pstr(15);
  const defaultViewName = r.pstr();

  const scenes: Scene[] = [];
  for (let s = 0; s < sceneCount; s++) {
    scenes.push(readScene(s, containers, mainSceneRegister));
  }

  return {
    file,
    version: 4,
    mainSceneRegister,
    transitionRegister,
    actorRegister,
    setName,
    defaultSceneName,
    defaultViewName,
    viewPortWidth,
    viewPortHeight,
    zFarMax,
    zLevelCount,
    mapLight,
    mapDark,
    mapWidth,
    mapHeight,
    setDimensionsX,
    setDimensionsY,
    mainScript,
    paletteRaw,
    colorCount: 128,
    scenes,
    transitions: readTransitions(containers, transitionRegister),
    actors: readActors(containers[actorRegister]),
    starPaths: readStarPaths(containers[actorRegister]),
  };
}

