/**
 * Building a CST cast from nothing — the write side of [`cst.ts`](cst.ts)'s
 * reader. See [`build.ts`](build.ts) for why these modules exist.
 *
 * A cast is the walking half of a character: members (`morrow`, `sasha`), each
 * with poses, each pose a grid of **steps × 8 directions** of transparent-codec
 * sprites. The 8 directions are the compass the runtime picks from when a
 * character faces the camera one way or another, and a step is one frame of the
 * walk cycle.
 *
 * A direction slot may be **empty** — the shipped casts have holes, and the
 * runtime falls back to a neighbouring direction rather than failing — so a pose
 * takes `(ShpFrame | null)[]` per step and means it.
 */
import { ContainerBuilder, checkName, emptyScript, i16, i32, paletteBlock, pstr } from "./build";
import { ContainerRef, DFContainerFile, writeContainerFile } from "./container";
import { MEMBER_NAME_FIELD, POSE_NAME_FIELD } from "./cst";
import { ShpFrame, encodeShpFrame } from "./shp";

/** container 0: the palette, the member count, the member table */
const C0 = { palette: 36, memberCount: 0x938, members: 0x93c, memberSize: 16 } as const;

/** a member's logic container: script, name, then the pose table */
const MEMBER = { script: 0x26, name: 0x2a, poseCount: 0x5a, poses: 0x5e, poseSize: 32, poseName: 16 } as const;

/** a pose's set container: the slot count, then 44-byte slot records */
const POSE = { count: 0x72, first: 0x76, size: 44, direction: 10, angle: 40, refScale: 42 } as const;

/** the eight compass directions every step is stored in */
export const CST_DIRECTIONS = 8;

/** how much of the 0..255 angle space one direction covers */
const ANGLE_PER_DIRECTION = 256 / CST_DIRECTIONS;

export interface CstBuildPose {
  /** the name a script asks for (`stand`, `walk`, ≤15 chars) */
  name: string;
  /**
   * One entry per step, each holding exactly {@link CST_DIRECTIONS} sprites —
   * `null` for a direction this pose does not carry.
   */
  steps: (ShpFrame | null)[][];
  /**
   * The depth scale stored on every slot, which is what keeps a character's feet
   * on the floor as they walk into the distance. 96 in the shipped casts.
   */
  refScale?: number;
}

export interface CstBuildMember {
  /** the character's name, as scripts and `actorowner` know them (≤15 chars) */
  name: string;
  /** the member's own script — `stdactor`/`stdscale`/`endwalk` live in the cast main */
  script?: Uint8Array;
  poses: CstBuildPose[];
}

export interface CstBuildOptions {
  /** the colour table, as RGB triples (up to 256 entries) */
  palette: ArrayLike<number>;
  members: CstBuildMember[];
  /** dummy gap containers, as the shipped casts carry */
  gaps?: number;
}

export interface CstBuildResult {
  file: DFContainerFile;
  /**
   * Where every sprite landed, by the art it was built from — so a caller can
   * check its own frames against the containers they were written to.
   */
  spriteLocs: Map<ShpFrame, ContainerRef>;
}

/**
 * Assemble a cast. Each slot records the direction it depicts and the angle in
 * the engine's 0..255 space, both derived from its position in the step — a step
 * is the compass, in order.
 */
export function buildCstFile(opts: CstBuildOptions): CstBuildResult {
  const { members } = opts;
  if (!members.length) throw new Error("cst: a cast needs at least one member");

  const b = new ContainerBuilder();
  const { data: c0 } = b.reserve(C0.members + members.length * C0.memberSize);
  c0.set(paletteBlock(opts.palette), C0.palette);
  for (let g = 0; g < (opts.gaps ?? 0); g++) b.gap();

  const spriteLocs = new Map<ShpFrame, ContainerRef>();

  const poseBlock = (pose: CstBuildPose): ContainerRef => {
    const slots = pose.steps.flat();
    for (const step of pose.steps) {
      if (step.length !== CST_DIRECTIONS) {
        throw new Error(
          `cst: pose "${pose.name}" has a step of ${step.length} directions, needs ${CST_DIRECTIONS}`,
        );
      }
    }
    // the sprites first, so the slot records can point at them
    const locs = slots.map((art) => {
      if (!art) return 0;
      const loc = b.add(encodeShpFrame(art));
      spriteLocs.set(art, loc);
      return loc;
    });
    const d = new Uint8Array(POSE.first + slots.length * POSE.size);
    i32(d, POSE.count, slots.length);
    locs.forEach((loc, i) => {
      const at = POSE.first + i * POSE.size;
      const direction = i % CST_DIRECTIONS;
      i32(d, at, loc);
      i16(d, at + POSE.direction, direction);
      i16(d, at + POSE.angle, direction * ANGLE_PER_DIRECTION);
      i16(d, at + POSE.refScale, pose.refScale ?? 96);
    });
    return b.add(d);
  };

  i32(c0, C0.memberCount, members.length);
  members.forEach((m, i) => {
    checkName("cst: member", m.name, MEMBER_NAME_FIELD);
    for (const p of m.poses) checkName("cst: pose", p.name, POSE_NAME_FIELD);
    const scriptLoc = b.add(m.script ?? emptyScript());
    const poseLocs = m.poses.map((p) => ({ name: p.name, loc: poseBlock(p) }));

    const d = new Uint8Array(MEMBER.poses + poseLocs.length * MEMBER.poseSize);
    i32(d, MEMBER.script, scriptLoc);
    pstr(d, MEMBER.name, m.name, MEMBER_NAME_FIELD);
    i32(d, MEMBER.poseCount, poseLocs.length);
    poseLocs.forEach((p, k) => {
      const at = MEMBER.poses + k * MEMBER.poseSize;
      i32(d, at, p.loc);
      pstr(d, at + MEMBER.poseName, p.name, POSE_NAME_FIELD);
    });
    i32(c0, C0.members + i * C0.memberSize, b.add(d));
  });

  return { file: b.finish(), spriteLocs };
}

/** {@link buildCstFile}, serialized */
export function buildCstBytes(opts: CstBuildOptions): Uint8Array {
  return writeContainerFile(buildCstFile(opts).file);
}
