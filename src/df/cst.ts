import { BinaryReader, writeNameAt } from "./binary";
import { DFContainerFile, patchContainerData, readContainerFile } from "./container";

/**
 * CST ("cast") files — the characters. GANG.CST holds the 25 named story
 * characters, EXTRA.CST the background passengers. Each cast member has a
 * script (setupactor/idle/mousedown live there) and a list of image SETS
 * (poses): "stand"/"standlj"/"walk"..., each holding sprite frames in the
 * SHP transparent codec, 8 view directions per animation step.
 *
 * Layout (validated against GANG.CST):
 *   container 0: palette @36 (256*8), puppet count i32 @0x938,
 *                16-byte records @0x93C -> logic container
 *   logic container: script loc i32 @0x26, name pascal @0x2A,
 *                    set count i32 @0x5A, 32-byte set records @0x5E
 *                    (i32 set container + pascal name @+16)
 *   set container: frame count i32 @0x72, 44-byte records @0x76:
 *                  i32 frame container, i16 direction (0..7) @+10,
 *                  i16 flag @+12, padded size Y-first @+22, offset
 *                  Y-first @+26, depicted angle i16 (dir*0x2000) @+40,
 *                  reference scale i16 @+42
 *
 * A member's logic container is the SAME record shape as a SHP prop group's
 * (script @38, pascal name[47] @42, sub-count @90, 32-byte sub-records @94 with
 * a pascal name[15] @+16), and a pose's set container the same shape as a SHP
 * state's (count @114, 44-byte frame records @118, degree @+40, refScale @+42).
 * That is not a coincidence to lean on for decoding — both are read here
 * independently — but it does say what the name FIELD SIZES are, which is what
 * the edit path needs: a shop writes those fields whole, and so can a cast.
 */

export interface CastFrame {
  location: number;
  direction: number;
  /** depicted facing in the engine's 0..255 angle space (direction * 32) */
  angle: number;
  /** reference scale for depth scaling (like the SHP state header's 180) */
  refScale: number;
  /** byte offset of this 44-byte record in the pose's set container */
  record: number;
}

export interface CastPose {
  name: string;
  location: number;
  /** frames[step][direction] — stand poses have a single step */
  steps: CastFrame[][];
  frameCount: number;
  /** byte offset of this 32-byte record in the member's logic container —
   *  where the pose name is stored (edit target, see {@link patchPoseName}) */
  record: number;
}

export interface CastMember {
  name: string;
  logicLocation: number;
  scriptLocation: number;
  poses: CastPose[];
}

export interface CstFile {
  file: DFContainerFile;
  paletteRaw: Uint8Array;
  members: CastMember[];
}

/** container 0: the palette and the member directory */
const C0 = {
  palette: 36,
  memberCount: 0x938,
  memberTable: 0x93c,
  memberEntrySize: 16,
} as const;

/** a member's logic container: their script, their name, their pose table */
const LOGIC = {
  scriptLocation: 0x26,
  name: 0x2a,
  poseCount: 0x5a,
  poses: 0x5e,
  poseSize: 32,
  poseName: 16,
} as const;

/** a pose's set container: the frame records, 8 view directions per step */
const POSE = {
  frameCount: 0x72,
  frames: 0x76,
  frameSize: 44,
  frameDirection: 10,
  frameAngle: 40,
  frameRefScale: 42,
} as const;

/** characters that fit the name fields (the length byte is not counted) */
export const MEMBER_NAME_FIELD = 47;
export const POSE_NAME_FIELD = 15;

export function readCstFile(data: Uint8Array): CstFile {
  const file = readContainerFile(data);
  const c0 = file.containers[0].data;
  const r0 = new BinaryReader(c0);
  r0.seek(C0.memberCount);
  const count = r0.i32();
  const members: CastMember[] = [];
  for (let i = 0; i < count; i++) {
    r0.seek(C0.memberTable + i * C0.memberEntrySize);
    const logicLocation = r0.i32();
    const p = file.containers[logicLocation].data;
    const rp = new BinaryReader(p);
    rp.seek(LOGIC.scriptLocation);
    const scriptLocation = rp.i32();
    const name = rp.pstr();
    rp.seek(LOGIC.poseCount);
    const setCount = rp.i32();
    const poses: CastPose[] = [];
    for (let s = 0; s < setCount; s++) {
      const record = LOGIC.poses + s * LOGIC.poseSize;
      rp.seek(record);
      const setLoc = rp.i32();
      rp.seek(record + LOGIC.poseName);
      const poseName = rp.pstr(POSE_NAME_FIELD);
      const sc = file.containers[setLoc].data;
      const rs = new BinaryReader(sc);
      rs.seek(POSE.frameCount);
      const frameCount = rs.i32();
      const steps: CastFrame[][] = [];
      for (let fi = 0; fi < frameCount; fi++) {
        const base = POSE.frames + fi * POSE.frameSize;
        rs.seek(base);
        const location = rs.i32();
        rs.seek(base + POSE.frameDirection);
        const direction = rs.i16();
        rs.seek(base + POSE.frameAngle);
        const angle = rs.i16();
        const refScale = rs.i16();
        const step = Math.floor(fi / 8);
        (steps[step] ??= [])[direction & 7] = { location, direction, angle, refScale, record: base };
      }
      poses.push({ name: poseName.toLowerCase(), location: setLoc, steps, frameCount, record });
    }
    members.push({ name: name.toLowerCase(), logicLocation, scriptLocation, poses });
  }
  return { file, paletteRaw: c0.subarray(C0.palette, C0.palette + 2048), members };
}

// ---------------------------------------------------------------------------
// Edits — the write path of the cast editor (editors/casts.html)
// ---------------------------------------------------------------------------
// Both names live in the member's logic container — the member's own at a fixed
// offset, a pose's in the pose table — so each edit is a copy-on-write patch on
// that one container. Sprite ART is replaced by the caller, which swaps a whole
// container for an `encodeShpFrame` result, and a frame's stored anchor moves
// through patchFrameAnchor in src/df/shp.ts, since a cast frame IS a SHP frame
// (see tests/auto/cst-editor.ts).

/**
 * A cast member's name — what every actor command addresses them by
 * (`actorpose("morrow", …)`, `sendtoactor`, the SET's actor marks), and what
 * `opencastfile` puts in the actor table. Renaming one means renaming it in the
 * scripts that reach for it, which is most of the corpus for a story character.
 */
export function patchMemberName(cst: CstFile, memberIdx: number, name: string): string {
  const member = cst.members[memberIdx];
  if (!member) return "";
  let stored = member.name;
  patchContainerData(cst.file, member.logicLocation, (d) => {
    stored = writeNameAt(d, LOGIC.name, name, MEMBER_NAME_FIELD);
  });
  member.name = stored;
  return stored;
}

/**
 * A pose's name — what `actorpose(actor, "walk")` asks for. The runtime matches
 * it lowercased (ActorInstance.pose in src/engine/actors.ts), and falls back to
 * the member's FIRST pose when nothing matches, so a typo here does not crash
 * an actor, it silently freezes them in pose 0.
 */
export function patchPoseName(
  cst: CstFile,
  memberIdx: number,
  poseIdx: number,
  name: string,
): string {
  const member = cst.members[memberIdx];
  const pose = member?.poses[poseIdx];
  if (!member || !pose) return "";
  let stored = pose.name;
  patchContainerData(cst.file, member.logicLocation, (d) => {
    stored = writeNameAt(d, pose.record + LOGIC.poseName, name, POSE_NAME_FIELD);
  });
  pose.name = stored.toLowerCase();
  return stored;
}
