import {
  LEFTTURNS, RIGHTTURNS,
  type Actor, type FrameInfo, type FrameRegister, type Scene, type SceneView,
  type SetFile, type Transition,
} from "./set";
import { readSetFileV1, type SetFileV1, type V1Standpoint, type V1Transition } from "./set-v1";
import { bearing } from "../runtime/geometry";

/**
 * A Dust set in the shape the SetViewer already knows.
 *
 * Written instead of a v1 viewer, and that is the whole design decision. The
 * viewer, the props, the actors, the transition modes, the ring cache, the
 * hi-res settle — all of it is built on {@link SetFile}, and a second viewer
 * would be a second copy of every one of those behaviours. A v1 set carries the
 * same FACTS in a flatter arrangement, so the cheaper and more honest move is to
 * arrange them the way the viewer reads them and change nothing above.
 *
 * ## The two models, and why the mapping is exact rather than approximate
 *
 * A v4 scene is a standpoint carrying two full 360-degree TURN RINGS, and roads
 * join scenes. A v1 set is a grid of cells with one flat table in which a turn
 * and a walk are the same record (see {@link file://./set-v1.ts}). Laying the
 * table out as rings is not lossy, because of three things that line up:
 *
 *   - **a v1 cell has exactly eight turns** — four facings, each way round — so
 *     its two rings are already authored, just not adjacent.
 *   - **a v1 turn is five frames ending on the arrival standpoint**, and
 *     {@link turnRing} walks a ring from one standpoint to the next collecting
 *     exactly that: four motion frames and the standpoint it lands on. So a ring
 *     is `[standpoint, m, m, m, m] * 4` and a turn out of it is the five frames
 *     the file stored.
 *   - **v4 wants each standpoint twice**, low-res in the right ring
 *     (`motionInfo` 1) and hi-res in the left (`motionInfo` 2), paired by
 *     `framePairID` — and v1 stores exactly those two pictures: the low-res one
 *     at the end of every arriving turn, and the hi-res still at the tail of one
 *     departing slot. The viewer's settle-sharpens-the-picture behaviour
 *     therefore comes out of Dust's own art rather than being simulated.
 *
 * ## The poses are DERIVED, and every number in them is measured
 *
 * A v4 FrameInfo carries the camera's world position and rotation, and the viewer
 * projects sprites through them. A v1 frame carries no pose at all — there is no
 * per-frame record beyond the 28-byte transition — so the original engine must
 * derive one from the grid too, and this derives the same three things from the
 * disc rather than picking them:
 *
 *   - **the scale**, {@link CELL_UNITS} = 256, from the actor registers. They are
 *     in the same space as the grid, and across every set with a cast the largest
 *     actor coordinate falls just under `gridWidth * 256` and never over it.
 *   - **the eye height**, from the header word at 0x1a, which is the only one that
 *     varies with the room (90 in the courtroom, 230 in the Chinese laundry).
 *   - **the headings**, from the walks. A v1 walk keeps the same facing at both
 *     ends on 26 of 26 sets, so you walk in the direction you face and the cell
 *     delta names the heading. Derived that way the disc has no contradictions at
 *     all — see {@link FACING_BEARING}.
 *
 * The FIELD OF VIEW is the fourth, and the one number here that came out of the
 * EXECUTABLE rather than off the disc: DF.EXE's focal length is 310, so a v1 set
 * carries it and `max(w, h) / 2` is the v4 default only. The disassembly, and what
 * the v4 default did to Dust's sprites before it, are at {@link focalLength}
 * below.
 *
 * There IS a Z layer in a v1 frame — all 10616 of them carry one, in the same
 * place and encoding v4 uses — so scenery occludes sprites here too. What v1 has
 * no header field for is the depth QUANTIZATION, and both of its numbers are
 * measured instead: see `zFarMax` at the foot of {@link setFileFromV1}.
 */

/**
 * World units per grid cell — 256, measured off the disc rather than chosen.
 *
 * The actor registers are in the same space as the grid and they pin the scale:
 * across every set that has a cast, the largest actor coordinate falls just under
 * `gridWidth * 256` and `gridHeight * 256` and never over it. TOWN is 15x15 and
 * its actors reach 2656 of 3840 and 3752 of 3840; STORE is 4x3 and reaches 976 of
 * 1024 and 700 of 768; NITECOUR is 4x5 and reaches 868 of 1024 and 1176 of 1280.
 * A cell therefore spans `[x*256, (x+1)*256)` and a standpoint stands in the
 * MIDDLE of one, which is what {@link CELL_MID} is.
 */
export const CELL_UNITS = 256;
const CELL_MID = CELL_UNITS / 2;
/** v4 stores a camera height in metres and world units are 512 to the metre */
const UNITS_PER_METRE = 512;

/**
 * Which way a facing id points, as a heading in the engine's 1/256 turns.
 *
 * MEASURED, not chosen. A v1 walk keeps the same facing at both ends — 26 of 26
 * sets on the disc, without exception — so you walk in the direction you face,
 * and the cell delta of every walk therefore names its facing's world heading via
 * {@link bearing}. Doing that across the disc gives one heading per facing with
 * ZERO contradictions, and the same four on every set:
 *
 *     facing 3 -> 0      facing 2 -> 64
 *     facing 4 -> 128    facing 1 -> 192
 *
 * Which is +64 per step along the right-turn cycle [1, 3, 2, 4] — and a right
 * turn raising the heading is the engine's own sense, measured off bedsit1.set
 * where every right turn increases `rotation8`.
 *
 * The table is the default and {@link headingsFrom} re-derives it per set anyway,
 * so a set that disagrees says so rather than being quietly drawn wrong.
 */
const FACING_BEARING: Record<number, number> = { 1: 192, 2: 64, 3: 0, 4: 128 };

/**
 * A standpoint's view is named for the COMPASS DIRECTION it looks along.
 *
 * Not `view1`..`view4`, which is what this used to build and what nothing in the
 * game could use: Dust's scripts name a view 636 times and every one of them says
 * north, south, east or west. Every door in the town is behind one of those
 * comparisons —
 *
 *     if arg = "uparrow" & currentview () = "west" & propowner ("door") = "saloon"
 *
 * — so under the old names not one of them opened. (The other two names a script
 * ever uses are the engine's own mid-motion pseudo-views, "moving" and "turning".)
 *
 * The mapping is derived, not chosen. North is where -z is: the grid labels a
 * scene by column letter and row number, `new.flt` draws the town map's dot at
 * `x = column * 20 + 222, y = row * 20 + 93` — so the letters run left to right
 * and the rows top to bottom, north up — and the road the player arrives on is
 * `Scene G15`, the highest row, at the south edge. With north at heading 192 the
 * other three follow from the headings, and they land in the right order for the
 * right reason: a right turn raises the heading by 64, and 192 -> 0 -> 64 -> 128
 * is north -> east -> south -> west. Clockwise, which is what a right turn is.
 */
const COMPASS: Record<number, string> = { 192: "north", 0: "east", 64: "south", 128: "west" };

/**
 * The per-set heading table, re-derived from that set's own walks.
 *
 * Falls back to {@link FACING_BEARING} for a facing this set has no walk along,
 * which is most of them: a room whose only exit is one door has one walkable
 * facing, and a one-cell room has none at all.
 *
 * It used to extrapolate instead — take a heading the walks DID pin and step it
 * by 64 per position in `facings` — and that was wrong, because `facings` is
 * sorted by facing ID and the IDs are not in rotational order (the cycle is
 * 1, 3, 2, 4). It handed two different facings the same heading on 16 of the 29
 * sets, which is a room where two of the four ways you can look point the same
 * way and the props stand in the wrong places in both.
 */
function headingsFrom(walks: V1Transition[], facings: number[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const t of walks) {
    if (t.from.facing !== t.to.facing) continue;
    const b = bearing(t.to.x - t.from.x, t.to.z - t.from.z);
    if (!out.has(t.from.facing)) out.set(t.from.facing, b);
  }
  for (const facing of facings) {
    if (!out.has(facing)) out.set(facing, FACING_BEARING[facing] ?? 0);
  }
  return out;
}

/**
 * The rotational order of a cell's facings: the four of them by ascending
 * heading, which IS the right-turn cycle.
 *
 * Because a right turn raises the heading by a quarter — measured off
 * `bedsit1.set`, where every right turn increases `rotation8` — sorting the
 * facings by the heading they point along puts them in the order a right turn
 * visits them, and the reverse is the left. Nothing about the ID ordering enters,
 * which matters because the IDs are not in compass order.
 *
 * This used to be read out of the turn RECORDS instead: build "what does facing f
 * turn into" from the first record naming each facing, and follow it round. That
 * relies on the register storing one whole cycle before the other, and on 3 of
 * the 29 sets it does not — DOCTOR1's single cell came out 1, 2, 3, 4, whose
 * headings step 192, 128, 64, 128 rather than 64 each. The art for each step is
 * still found in the records; only the ORDER now comes from the geometry.
 */
function cycleOf(facings: number[], headings: Map<number, number>): number[] | null {
  if (facings.length !== 4) return null;
  const order = [...facings].sort(
    (a, b) => (headings.get(a) ?? 0) - (headings.get(b) ?? 0),
  );
  // four distinct quarters, or this cell's headings are not a compass
  const steps = order.map((f, i) => ((headings.get(order[(i + 1) % 4]) ?? 0) - (headings.get(f) ?? 0)) & 0xff);
  return steps.every((d) => d === 64) ? order : null;
}

const key = (s: V1Standpoint): string => `${s.x},${s.z},${s.facing}`;
const cellKey = (s: { x: number; z: number }): string => `${s.x},${s.z}`;

/** the world centre of a grid cell — where a standpoint stands */
const centreOf = (cell: { x: number; z: number }): { x: number; z: number } => ({
  x: cell.x * CELL_UNITS + CELL_MID,
  z: cell.z * CELL_UNITS + CELL_MID,
});

/**
 * The short way round from one 0..255 bearing to another, signed.
 *
 * Which way a quarter turn goes cannot be assumed from the numbers: the facing
 * ids are not in compass order, so the right-turn cycle runs 192 -> 0 as often as
 * 0 -> 64. Taking the short way makes both +64.
 */
const turnDelta = (from: number, to: number): number => {
  const d = (to - from) & 0xff;
  return d > 128 ? d - 256 : d;
};

/**
 * A FrameInfo with a synthesized pose — see the note on poses in the header.
 *
 * `pos` is in WORLD units and `heading` may be fractional, because a motion
 * frame's pose is a point PART of the way along the move (see {@link ringFor} and
 * {@link walkRegister}). `axisX` keeps the fraction; `axisX8` is what the camera
 * reads, so it rounds rather than truncating — 51.2 is a bearing of 51, not 51
 * because the low bits were dropped.
 */
function frameAt(
  pos: { x: number; z: number },
  heading: number,
  container: number,
  motionInfo: number,
  viewID: number,
  framePairID: number,
  eyeHeight: number,
): FrameInfo {
  // the heading is the set's own, read off its walk vectors (see FACING_BEARING);
  // v4 keeps rotation8 and axisX8 equal at every standpoint and so does this
  const axisX = (heading * 2 * Math.PI) / 256;
  const posX = Math.round(pos.x);
  const posZ = Math.round(pos.z);
  return {
    posX,
    posZ,
    posY: eyeHeight,
    axisX,
    posX16: posX,
    posZ16: posZ,
    posY16: eyeHeight,
    axisX8: Math.round(heading) & 0xff,
    motionInfo,
    frameContainerLoc: container,
    framePairID,
    transitionLog: 0,
    viewID,
  };
}

export function setFileFromV1(v1: SetFileV1): SetFile {
  const turnsBy = new Map<string, V1Transition[]>();
  const walks: V1Transition[] = [];
  for (const t of v1.transitions) {
    if (t.kind === "walk") walks.push(t);
    else turnsBy.set(cellKey(t.from), [...(turnsBy.get(cellKey(t.from)) ?? []), t]);
  }

  /** the low-res picture of a standpoint: the last frame of anything arriving */
  const lowRes = new Map<string, number>();
  /** the hi-res still, carried by one of the transitions leaving it */
  const hiRes = new Map<string, number>();
  for (const t of v1.transitions) {
    if (t.frames.length) lowRes.set(key(t.to), t.frames[t.frames.length - 1]);
    if (t.departureStill >= 0) hiRes.set(key(t.from), t.departureStill);
  }

  const headings = headingsFrom(
    walks,
    [...new Set(v1.transitions.map((t) => t.from.facing))].sort((a, b) => a - b),
  );

  // a global view id per standpoint, which is what roads are addressed by
  const globalID = new Map<string, number>();
  /**
   * And a synthetic `locationViews` per scene, because that is how the viewer
   * resolves the far end of a walk: it matches a register's `destination`
   * against `Scene.locationViews` (SetViewer, "the scene is the register's
   * destination"). In a v4 set both are real container indices; here they only
   * have to be unique and non-zero, since zero is what an absent one reads as.
   * Left at 0 they all matched scene 0, and a walk into a scene with no views
   * crashed the viewer reading `viewID` off a standpoint that was not there.
   */
  const sceneAt = new Map<string, number>();
  for (const [index, sc] of v1.scenes.entries()) sceneAt.set(cellKey(sc), index + 1);
  const scenes: Scene[] = [];
  for (const [index, s] of v1.scenes.entries()) {
    const cell = { x: s.x, z: s.z };
    const turns = turnsBy.get(cellKey(cell)) ?? [];
    const facings = turns.length
      ? cycleOf([...new Set(turns.map((t) => t.from.facing))], headings)
      : null;
    const views: SceneView[] = [];
    if (facings) {
      for (const [at, facing] of facings.entries()) {
        globalID.set(key({ ...cell, facing }), index * 4 + at);
        const heading = headings.get(facing) ?? 0;
        views.push({
          rotation: (heading * 2 * Math.PI) / 256,
          rotation8: heading & 0xff,
          viewPairType: 0,
          cameraHeight: v1.eyeHeight / UNITS_PER_METRE,
          viewID: index * 4 + at,
          locationObjects: 0,
          // A v1 view has no hotspot table: its clickable regions are done in
          // SCRIPT, by the scene's own `pointinjug`/`pointincrate` helpers over
          // the cursor. So there is nothing to read here and nothing missing.
          viewName: COMPASS[heading & 0xff] ?? `view${facing}`,
          objects: [],
          record: 0,
        });
      }
    }
    scenes.push({
      index,
      sceneName: s.name,
      record: s.record,
      build: s.build,
      // WORLD units, not the cell indices they are read from — v4's fields hold
      // the standpoint's position and two live readers want it that way: the
      // cricket/sound listener and `playerxyz` take these two straight
      // (viewer.ts's `session.listener`), and the camera falls back to them when
      // a view has no stand frame. Dust's `scenexyz` reads them as well, and its
      // own scripts say what the unit is by dividing the answer by 256.
      xAxisMap: s.x * CELL_UNITS + CELL_MID,
      zAxisMap: s.z * CELL_UNITS + CELL_MID,
      yAxisMap: 0,
      locationViews: index + 1,
      locationScript: s.scriptLocation,
      sceneLocation: [s.x * CELL_UNITS + CELL_MID, 0, s.z * CELL_UNITS + CELL_MID],
      views,
      turns: [
        ringFor(cell, facings, turns, lowRes, RIGHTTURNS, v1.eyeHeight, headings),
        ringFor(cell, facings, turns, hiRes, LEFTTURNS, v1.eyeHeight, headings),
      ],
    });
  }

  /**
   * The walks, one road each — and the SECOND REGISTER IS ALWAYS EMPTY.
   *
   * A v4 road is one object with a register per direction, and `roadsAt` offers it
   * from either end. That pairing has no v1 counterpart, and not for want of
   * looking: a v1 walk keeps its facing at both ends (26 of 26 sets — the
   * measurement {@link FACING_BEARING} rests on), so the record that brings you
   * back leaves the far cell on the OPPOSITE facing. That is a different
   * standpoint and therefore a different road. Across the disc: 372 walks, and
   * not one has a partner in the v4 sense.
   *
   * So no attempt is made to fill register 1, and `roadsAt` skips an empty one
   * rather than walking a player into frames that are not there.
   */
  const transitions: Transition[] = [];
  for (const w of walks) {
    const startID = globalID.get(key(w.from));
    const endID = globalID.get(key(w.to));
    if (startID === undefined || endID === undefined) continue;
    transitions.push({
      locationTransitionInfo: 0,
      viewIDstart: startID,
      viewIDend: endID,
      start: [w.from.x * CELL_UNITS + CELL_MID, v1.eyeHeight, w.from.z * CELL_UNITS + CELL_MID],
      end: [w.to.x * CELL_UNITS + CELL_MID, v1.eyeHeight, w.to.z * CELL_UNITS + CELL_MID],
      transitionName: `${key(w.from)}->${key(w.to)}`,
      waypoints: [],
      frameRegisters: [
        walkRegister(w, endID, headings.get(w.from.facing) ?? 0, sceneAt.get(cellKey(w.to)) ?? 0, v1.eyeHeight),
        { destination: 0, frames: [] },
      ],
    });
  }

  // RAW, because the register is already in the world units the grid is in —
  // that is the measurement CELL_UNITS came from, and a v1 star record is a v4
  // one four bytes shorter (see `readActors` in set-v1.ts)
  const actors: Actor[] = v1.actors.map((a) => ({
    rotation8: a.rotation8,
    positionX: a.positionX,
    positionZ: a.positionZ,
    positionY: a.positionY,
    identifier: a.identifier,
    record: a.record,
    idLimit: 15,
  }));

  /**
   * The standpoint the set opens on, from the header's own three numbers rather
   * than "the first scene that has any views".
   *
   * That fallback put you at the top-left corner of the grid — `Scene A7` in town,
   * halfway up the west edge — and the file says `Scene G15` facing 1, the south
   * road in. It is kept only for a set whose triple does not resolve, which none
   * on the disc does (see {@link C0.defaultCellX}).
   */
  const opensOn = scenes.find(
    (s) =>
      s.xAxisMap === v1.defaultCellX * CELL_UNITS + CELL_MID &&
      s.zAxisMap === v1.defaultCellZ * CELL_UNITS + CELL_MID,
  );
  const opensFacing = opensOn?.views.find(
    (w) => w.viewName === (COMPASS[(headings.get(v1.defaultFacing) ?? -1) & 0xff] ?? ""),
  );
  const first = scenes.find((s) => s.views.length);
  return {
    file: v1.file,
    version: 1,
    mainSceneRegister: 0,
    transitionRegister: 0,
    actorRegister: 0,
    setName: v1.setName,
    defaultSceneName: (opensFacing ? opensOn?.sceneName : undefined)
      ?? first?.sceneName ?? scenes[0]?.sceneName ?? "",
    defaultViewName: opensFacing?.viewName ?? first?.views[0]?.viewName ?? "",
    viewPortWidth: v1.viewPortWidth,
    viewPortHeight: v1.viewPortHeight,
    /**
     * DF.EXE's focal length is 310, read out of the binary rather than fitted.
     *
     * `mov word ptr [0x460b98], 0x136` at 0x4331e5 and again at 0x433418 — the
     * two functions that reset the world camera — and [0x460b98] is read in
     * exactly one place, the projection at 0x433c60, where it multiplies both
     * the lateral offset and the height drop before the truncating divide by
     * depth. The port's v4 default (max(512, 264)/2 = 256) drew every Dust
     * sprite ~21% too close to the screen centre on both axes: an actor at
     * depth 176 had its feet at row 222 where DF.EXE puts them at 241, which
     * read as "misplaced and floating" against rooms whose art has the correct
     * perspective baked in. Everything AROUND the constant was verified against
     * the same disassembly and matches the port: the camera sits at the cell
     * centre (cell×256+128, 0x433d33..0x433d6c), a walk slides it frame×64
     * over five frames and idle keeps the arrival centre (0x434060: frames
     * 0..4, then cur←dest and frame←-1, which skips the interpolator at
     * 0x4334bd), the facing bearings are {1:192, 2:64, 3:0, 4:128} (the jump
     * table at 0x4340a8), cx/cy are the view-rect centre (256, 132), and the
     * sprite scale in both renderers (0x41e861 actors, 0x4150d1 props) is
     * trunc(scale×ref/1000) × taoot/src/depth with NO focal term — so this constant
     * moves where sprites stand, never how big they are.
     */
    focalLength: 310,
    /**
     * The camera stands 64 units BEHIND its cell anchor, along the facing.
     *
     * Header 0x18 (64 in all 29 sets), consumed by DF.EXE's camera builder
     * (0x433fd4..0x43401e): `camX -= fix14(sin[bearing] * [0x460b8c])`,
     * `camY -= fix14(cos[bearing] * ...)`. Without it every sprite is 64
     * units too near: leroy parked at his sign was drawn 140px tall with his
     * feet at row 241 where the disc's own numbers put him at 102px with feet
     * at 212 — reported twice from play as "actors stand too far forward",
     * and the second time with the clincher that his feet were CLIPPED.
     *
     * The clipping is the same finding. DF.EXE's sprite z-level is
     * `(depth - zclip - [0x460b8c] + 0x80) >> 6`: the setback is subtracted
     * back OUT of the test, so of the +0x80 only 64 is a real bias — and with
     * the art's z stored as ceil(depth/64) (the convention under which the
     * g15-north floor fits the engine's own cy/eye*f to under 2px, all three
     * level boundaries exact), a sprite standing on its own ground then NEVER
     * clips itself: sweeping every depth 64..1400, zero self-clips, feet
     * within 4px of the art floor row throughout. With the full 128 the port
     * cut leroy's boots off — over-biased by exactly the setback it was not
     * applying.
     */
    cameraSetback: v1.cameraSetback,
    spriteZBias: 128 - v1.cameraSetback,
    /**
     * Occlusion, and both numbers are measured.
     *
     * Every one of the 10616 room frames on the disc carries a Z layer — the
     * per-pixel depth `decodeFrame` already reads out of the tail of a frame
     * container, in the same place and the same encoding v4 puts it. So a v1 set
     * occludes sprites behind its scenery exactly as a v4 one does, and this used
     * to say the opposite and switch the depth test off with a pair of zeroes.
     * What was actually true was narrower: v1 has no HEADER field naming the
     * quantization, and that is what these two are.
     *
     * **24 levels**, because that is the highest value any of those frames uses
     * and nothing exceeds it — also the port's own fallback.
     *
     * **64 units per level**, measured off a WALK, which is the one measurement
     * here that assumes nothing about the projection. A walk moves the camera
     * exactly one cell along its heading, so a static thing straight ahead — screen
     * column `cx`, where the lateral offset is zero whatever the focal length — is
     * 256 units nearer at the far end, and its level must drop by 256/scale. The
     * deepest unclamped level on the centre axis drops by exactly **4** on 27 of
     * the 29 sets, and the two that disagree are the 15x15 town and its night twin,
     * where what is straight ahead is usually past the clip and so not a reading at
     * all.
     *
     * That puts the far plane at 24 * 64 = 1536 units, six cells. Beyond it a
     * sprite's level exceeds every level the scenery can hold and it is not drawn,
     * which is the file's own limit rather than this port's: 1536 is where Dust's
     * art stops carrying depth.
     */
    zFarMax: 24 * 64,
    zLevelCount: 24,
    mapLight: 0,
    mapDark: 0,
    mapWidth: v1.gridWidth,
    mapHeight: v1.gridHeight,
    setDimensionsX: v1.gridWidth * CELL_UNITS,
    setDimensionsY: v1.gridHeight * CELL_UNITS,
    mainScript: v1.mainScript,
    paletteRaw: v1.paletteRaw,
    // A v1 set carries three palettes and the CLUT the scripts switch between
    // them by name; the first is what it opens in. 256 rather than v4's 128
    // because there is no stage sharing the upper half here — Dust's panel is a
    // flat with a palette of its own, and this port colourises in truecolour.
    colorCount: 256,
    scenes,
    transitions,
    actors,
    starPaths: v1.starPaths,
  };
}

/**
 * One of a cell's two rings: `[motion x4, standpoint] * 4`, in the order that
 * ring turns through.
 *
 * `stills` decides which picture the standpoints carry — the low-res arrivals
 * for the right ring, the hi-res departure stills for the left — which is the
 * pairing `hiResTwin` reads. `framePairID` is the view index, so the two rings'
 * copies of a standpoint find each other.
 *
 * ## Why the motion comes FIRST
 *
 * Frames are delta-coded and {@link RingCache} decodes a whole ring in order
 * from a fresh buffer, on the measured v4 property that a ring's first frame
 * repaints every pixel. A v1 slot's six containers measure `K d d d d K`: the
 * first motion frame is a keyframe, the next four are deltas on it, and the
 * hi-res still is a keyframe of its own.
 *
 * So a ring laid out `[standpoint, motion x4] * 4` opens on a DELTA frame — the
 * previous slot's last — decoded with nothing behind it. That corrupted exactly
 * one frame per ring, and it showed: the right turn arriving at the ring's first
 * facing ended on garbage for one interval before the hi-res settle replaced it.
 * Right turns only, because the left ring's standpoints are the hi-res keyframes
 * and had nothing to corrupt.
 *
 * Starting on the motion instead makes every frame's ring predecessor its own
 * slot's predecessor, and every slot open on its keyframe. It is the same cyclic
 * sequence rotated by one, which `turnRing` cannot tell apart — it finds a
 * standpoint by view id and walks forward from wherever it is.
 *
 * ## And the right ring's standpoint is THIS turn's own last frame
 *
 * Not "the arrival picture of that facing" looked up from anywhere. Every turn
 * arriving at a standpoint ends on the same PICTURE — measured, 44 of 44 agree —
 * but they are different CONTAINERS, and only one of them is the frame sitting
 * directly after this slot's four motion frames. Taking any other one puts a
 * delta frame in the ring with its base three slots away, which is the same
 * corruption as opening on one.
 *
 * The left ring has no such choice to get wrong: its standpoints are the hi-res
 * stills, and those are keyframes.
 */
function ringFor(
  cell: { x: number; z: number },
  facings: number[] | null,
  turns: V1Transition[],
  stills: Map<string, number>,
  dir: number,
  eyeHeight: number,
  headings: Map<number, number>,
): FrameRegister {
  if (!facings) return { destination: 0, frames: [] };
  // the right ring follows the cycle the cell's records are stored in; the left
  // ring is that cycle reversed, which is what "the other way round" is
  const order = dir === RIGHTTURNS ? facings : [facings[0], ...facings.slice(1).reverse()];
  const at0 = centreOf(cell);
  const frames: FrameInfo[] = [];
  for (const [at, facing] of order.entries()) {
    const to = order[(at + 1) % order.length];
    const turn = turns.find((t) => t.from.facing === facing && t.to.facing === to);
    // the first four of the five are the motion; the fifth IS the arrival
    // standpoint, and it is pushed as one below
    const motion = (turn?.frames ?? []).slice(0, 4);
    /**
     * A turn does not move, so only the bearing changes — and it has to change
     * ACROSS the motion frames rather than jumping at the end of them.
     *
     * The camera the viewer projects sprites through while a move is animating is
     * the motion frame's own (`SetViewer.activeCamera`), so giving all four the
     * departure bearing left the whole cast pinned to where it belonged before the
     * turn started and then snapping into place on the settle. Reported from the
     * page as "correctly placed when standing, misplaced during movement", which
     * is exactly the shape of that bug.
     *
     * Five pictures over one quarter turn means five equal steps of 64/5 = 12.8,
     * with the fifth landing on the arrival bearing — so motion frame `i` is
     * `(i + 1) / 5` of the way round. Even spacing rather than an eased curve
     * because nothing in the file suggests otherwise and the run is uniform.
     */
    const from8 = headings.get(facing) ?? 0;
    const swing = turnDelta(from8, headings.get(to) ?? 0);
    for (const [i, fr] of motion.entries()) {
      const part = (i + 1) / (motion.length + 1);
      frames.push(frameAt(at0, from8 + swing * part, fr, 0, -1, -1, eyeHeight));
    }
    const viewIdx = facings.indexOf(to);
    // the right ring takes this slot's own fifth frame, so it follows the four
    // above it in the file; the left takes the hi-res still, which is a keyframe
    const still =
      dir === RIGHTTURNS
        ? (turn?.frames[4] ?? stills.get(key({ ...cell, facing: to })))
        : stills.get(key({ ...cell, facing: to }));
    frames.push(
      frameAt(
        at0, headings.get(to) ?? 0, still ?? 0,
        dir === RIGHTTURNS ? 1 : 2, viewIdx, viewIdx, eyeHeight,
      ),
    );
  }
  return { destination: 0, frames };
}

/**
 * A walk's frames as a v4 register: motion, then the standpoint it arrives on.
 *
 * The bearing is constant — a v1 walk keeps its facing at both ends, which is the
 * measurement everything else here rests on — so what has to move is the POSITION,
 * and it has to move across the run. Both ends of the walk are cell centres and
 * the frames divide the distance evenly, the last one landing on the arrival: the
 * same `(i + 1) / n` as a turn's bearing, for the same reason and with the same
 * symptom when it is missing (see {@link ringFor}).
 */
function walkRegister(
  w: V1Transition,
  arriveViewID: number,
  heading: number,
  destination: number,
  eyeHeight: number,
): FrameRegister {
  const from = centreOf(w.from);
  const to = centreOf(w.to);
  const n = w.frames.length;
  const frames: FrameInfo[] = w.frames.map((fr, i) => {
    const last = i === n - 1;
    const part = (i + 1) / n;
    return frameAt(
      { x: from.x + (to.x - from.x) * part, z: from.z + (to.z - from.z) * part },
      heading,
      fr,
      last ? 1 : 0,
      last ? arriveViewID : -1,
      -1,
      eyeHeight,
    );
  });
  return { destination, frames };
}

/** open a Dust set as one the viewer can drive */
export function readSetFileAsV4(data: Uint8Array): SetFile {
  return setFileFromV1(readSetFileV1(data));
}

