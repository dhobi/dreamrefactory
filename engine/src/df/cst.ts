import { BinaryReader, writeNameAt } from "./binary";
import { DFContainerFile, patchContainerData, readContainerFile } from "./container";

/**
 * CST ("cast") files — the characters. GANG.CST holds the 25 named story
 * characters, EXTRA.CST the background passengers. Each cast member has a
 * script (setupactor/idle/mousedown live there) and a list of image SETS
 * (poses): "stand"/"standlj"/"walk"..., each holding sprite frames in the
 * SHP transparent codec, and one picture per stored view of each animation
 * step (usually eight around the compass, but see {@link CastFrame.angle}).
 *
 * Layout (validated against GANG.CST):
 *   container 0: palette @36 (256*8), puppet count i32 @0x938,
 *                16-byte records @0x93C -> logic container
 *   logic container: script loc i32 @0x26, name pascal @0x2A,
 *                    set count i32 @0x5A, 32-byte set records @0x5E
 *                    (i32 set container + pascal name @+16)
 *   set container: play script @0x2E with its length @0x70, frame count i32
 *                  @0x72, 44-byte records @0x76:
 *                  i32 frame container, i16 animation step @+8, i16 ordinal
 *                  within the step @+10, padded size Y-first @+22, offset
 *                  Y-first @+26, depicted angle i16 (0..255 space) @+40,
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
  /** the record's ordinal within its step — informational; the ANGLE is what
   *  the runtime picks by, and a pose is not obliged to store eight of these */
  direction: number;
  /**
   * Depicted facing in the engine's 0..255 angle space.
   *
   * Usually `direction * 32`: eight pictures around the whole compass. Three
   * poses in the corpus are not, and they are why nothing may assume it —
   * `stok1`'s four store nine pictures 16 apart and `life1`'s `stand` seventeen
   * 8 apart, each covering only the HALF circle 0..128 (a character who is only
   * ever seen from one side, drawn at two or four times the angular resolution),
   * and `willie`'s `dead` stores exactly one, at 192.
   */
  angle: number;
  /** reference scale for depth scaling (like the SHP state header's 180) */
  refScale: number;
  /** byte offset of this 44-byte record in the pose's set container */
  record: number;
}

export interface CastPose {
  name: string;
  location: number;
  /**
   * The pose's pictures grouped by the animation step they belong to — the step
   * number the frame record carries at +8, which is what {@link play} names.
   *
   * A group holds one record per depicted facing, in stored order and NOT
   * indexed by direction: see {@link CastFrame.angle} for the three poses that
   * store nine and seventeen of them. Indexing this by `direction & 7` aliased
   * those onto each other, so `life1` — the mission-4 lifeboat crowd — drew the
   * back half of its compass for the front.
   */
  steps: CastFrame[][];
  /**
   * The pose's PLAY SCRIPT: 0-based indices into {@link steps}, in the order
   * they are shown. Never empty — a pose with no usable table falls back to its
   * steps in stored order.
   *
   * A pose container IS a SHP state container (see the module docblock), so this
   * is the same table {@link PropState.playOrder} reads, at the same offsets: a
   * step count at +112 and that many 1-based indices from +46. And it is a play
   * LIST, not a permutation — repeating an entry is how the format HOLDS a
   * picture for more than one pass.
   *
   * That holding is the whole of #181. Every walk in the game draws ten pictures
   * and lists twenty steps — `1,1,2,2,…,10,10` — so a walker's legs move at half
   * the service rate. The port cycled the ten pictures directly, one per pass,
   * and the reporter's side-by-side video shows exactly what that looks like:
   * the same walk, over the same ground, in the same time, with the feet going
   * twice as fast. `stok1`'s `dig` and `throw` are the other authored ones
   * (14 steps over 7 pictures).
   */
  play: number[];
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

/** a pose's set container: the play script, then the frame records */
const POSE = {
  /** the play script's 1-based step indices (see {@link CastPose.play}) */
  play: 0x2e,
  playCount: 0x70,
  /** slots between {@link POSE.play} and the count that follows it */
  maxPlay: (0x70 - 0x2e) / 2,
  frameCount: 0x72,
  frames: 0x76,
  frameSize: 44,
  /** which animation step this picture belongs to — what {@link POSE.play}'s
   *  entries are matched against (TI.EXE 0x4115a2) */
  frameStep: 8,
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
        rs.seek(base + POSE.frameStep);
        const step = rs.i16();
        rs.seek(base + POSE.frameDirection);
        const direction = rs.i16();
        rs.seek(base + POSE.frameAngle);
        const angle = rs.i16();
        const refScale = rs.i16();
        if (step < 0) continue;
        (steps[step] ??= []).push({ location, direction, angle, refScale, record: base });
      }
      for (let si = 0; si < steps.length; si++) steps[si] ??= [];
      // the play script, read after the steps so it can be checked against them:
      // a table naming a picture the pose does not have is not evidence about
      // anything, and the corpus has one (`qwerty`, one step over no frames)
      rs.seek(POSE.playCount);
      const playCount = Math.max(0, Math.min(rs.i16(), POSE.maxPlay));
      const play: number[] = [];
      for (let pi = 0; pi < playCount; pi++) {
        rs.seek(POSE.play + 2 * pi);
        play.push(rs.i16() - 1);
      }
      const usable = play.length > 0 && play.every((v) => v >= 0 && v < steps.length);
      poses.push({
        name: poseName.toLowerCase(),
        location: setLoc,
        steps,
        play: usable ? play : steps.map((_, i) => i),
        frameCount,
        record,
      });
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
// through patchFrameAnchor in engine/src/df/shp.ts, since a cast frame IS a SHP frame
// (see taoot/tests/auto/cst-editor.ts).

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
 * it lowercased (ActorInstance.pose in engine/src/runtime/actors.ts), and falls back to
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
