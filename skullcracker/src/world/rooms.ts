/**
 * The rooms and their surfaces: spawning a room's creatures and building its
 * elevators, planks and crows, finding the room a point is in, the ground and
 * the walls, the ladders and bars, and getting out of an obstacle.
 */
import { SbkEntity, SbkFile, SbkRoom } from "@dreamfactory/engine/df/sbk";
import { CORPSE_LINGER, FOES, FoeAnim, type Foe } from "../foes";
import type { Enemy } from "../brains/kit";
import { CROW, Crow, ELEVATOR, Elevator, PLANK, Plank, Door, HOLE } from "../props";
import { roll as scRoll } from "../random";
import { foesOff, type Solids, level, p, player, type Level } from "./state";
import { LADDER } from "./motion";
import { celRec, lastCel } from "./cels";
import { snapCamera } from "./camera";

/**
 * `[0x46b204]`, the corpse time every hit handler copies on a death — the
 * file's 50 ({@link CORPSE_LINGER}) until the first ox is made, when
 * `0x435c73` writes 80 over it for the rest of the run.
 */
export let corpseFrames = CORPSE_LINGER;

/** every animation a kind can ever show, for the cels-are-present test */
export function everyAnim(foe: Foe): FoeAnim[] {
  return [
    foe.gait,
    ...(foe.flinch ?? []),
    ...(foe.death ? [foe.death] : []),
    ...(foe.burst ? [foe.burst.anim] : []),
  ];
}

/**
 * Every `init*` record standing in this room that this page has cels for.
 *
 * **A creator places its object at the record's POINT**, and reading that settled
 * what an object's own y is — which {@link foeAnchor} had to leave open. The
 * level's spawner `0x4503a0` hands every creator the same three things off the
 * 48-byte record: the point as one dword, then the rect's two corners. Each
 * creator's second instruction on it is `mov dword [obj+6], eax` with that first
 * argument (`0x450f90` for the dog, `0x450a7b` for the punk, `0x450cdc` for the
 * fourth kind), and `0x4026d0` draws a cel with its ANCHOR at `obj+6`. So the
 * record's point is the anchor, and the rect is only the patrol territory the AI
 * struct keeps (`0x450fc3` stores both corners into it).
 *
 * The rect's BOTTOM edge is not the anchor: in WOODS the rects are wide
 * territories whose bottom edge is well under the ground, so a foe stood there
 * spawns inside the terrain and falls through it.
 */
/**
 * ...and a record belongs to ONE room, which is the engine's own rule.
 *
 * `0x40b940`'s kind 2 walks the region table and answers with the FIRST region
 * whose rect contains the point. Rooms overlap — that is how you walk out of one
 * and into the next — and a creature standing in a seam would otherwise spawn
 * once per room it falls in. BARREL's rooms overlap x7464..7691 and its cop at
 * x7521 stands in that seam: a level of twelve would have a census of thirteen
 * and a kill quota that could never be met.
 */
export function spawnIn(sbk: SbkFile, room: SbkRoom, taken?: Set<SbkEntity>): Enemy[] {
  const out: Enemy[] = [];
  if (foesOff) return out;
  for (const e of sbk.entities) {
    const foe = FOES[e.name];
    if (!e.isEntity || !foe) continue;
    if (taken?.has(e)) continue;
    if (
      e.pointY < room.top ||
      e.pointY > room.bottom ||
      e.pointX < room.left ||
      e.pointX > room.right
    )
      continue;
    taken?.add(e);
    // every cel it needs, flinches and death included, has to be in this book,
    // or it is another level's: one chapter's rat has death cel 3080 and the
    // other's does not
    if (!everyAnim(foe).every((a) => a.cels.every((id) => sbk.byId.has(id))))
      continue;
    // this page carries a foe by its FEET and {@link foeAnchor} converts, so the
    // record's anchor is converted the other way here, through the same gait cel
    const g = celRec(sbk, foe.gait.cels[0]);
    if (!g) continue;
    out.push({
      kind: e.name,
      x: e.pointX + g.width / 2 - g.posX,
      y: e.pointY + g.height - g.posY,
      // the record's own param, for the kinds whose creator takes it as the
      // facing — everything else stands the way the art is drawn
      facing: foe.facesByParam && e.param ? 1 : -1,
      left: e.left,
      right: e.right,
      top: e.top,
      bottom: e.bottom,
      // `AI+0x10` — the record's own point, which a class can be sent back to,
      // or the constant its creator writes there instead ({@link Foe.homeAt})
      home: (foe.homeAt ?? e.pointX) + g.width / 2 - g.posX,
      homeY: e.pointY + g.height - g.posY,
      weightless: foe.bornWeightless || undefined,
      // ...and the record's own param, which for `initcop` picks the creature
      param: e.param,
      asleep: foe.wake ? true : undefined,
      decisions: foe.drives?.decisions,
      clock: 0,
      state: "gait",
      // a dormant thing holds one cel and goes nowhere — its own, where its class
      // names one (`0x4386f5` installs cel 1801 over the build's 1940)
      anim: foe.wake
        ? { ...foe.gait, cels: [foe.wake.cel ?? foe.gait.cels[0]], dx: [0] }
        : foe.gait,
      linger: 0,
      dents: 0,
      vx: 0,
      vy: 0,
      hp: foe.health,
      max: foe.health,
      // `0x41ef5c` — the zombie's creator draws its plate, {@link Foe.panel}
      plate: foe.panel?.plates
        ? foe.panel.plate - 1 + roll(foe.panel.plates)
        : undefined,
    });
    // `0x435c73`: the ox's creator writes 80 into the corpse global, and
    // nothing ever puts the 50 back — see {@link corpseFrames}
    if (e.name === "initox") corpseFrames = 0x50;
  }
  return out;
}

/**
 * Every `initelevator` in this room, each as a car that IS a platform.
 *
 * CITY places five and no other book places any, which is the same shape the
 * planks have: a class only the second level uses, with its art (cels 1160..1163)
 * sitting in that book's directory and placed by nothing in its backdrop.
 *
 * The record's rect is the SHAFT and the car's surface travels between its two
 * ends. That is a reading of the data rather than a convenience: the bottom of
 * all five shafts lands within 9..21 pixels of a real platform top, and #102's
 * top matches platform #105's to three pixels — the shaft says where the car
 * goes, not merely where it is drawn.
 *
 * The car's floor is APPENDED to the room's platforms because the disc has none
 * for it. `0x450dc0` calls `0x42fb70`, the plank's "claim the platform record
 * containing my point", and no elevator's point lands inside any platform in
 * CITY — all five checked — so the engine is appending one at runtime and so is
 * this. See {@link ELEVATOR} for the state machine and for the one guess in it.
 */
export function elevatorsIn(
  sbk: SbkFile,
  room: SbkRoom,
  solids: Solids,
  planks: readonly Plank[],
): Elevator[] {
  // a platform has ONE owner: `0x42fb70` refuses a record something already
  // holds, and the planks were claimed first. No CITY landing is also a plank's
  // floor, so this changes nothing today and stops a level that did from handing
  // one record to two movers
  const taken = new Set<unknown>(planks.map((k) => k.floor).filter(Boolean));
  const out: Elevator[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "initelevator") continue;
    const cy = (e.top + e.bottom) >> 1;
    const cx = (e.left + e.right) >> 1;
    if (cy < room.top || cy > room.bottom || cx < room.left || cx > room.right)
      continue;
    // the cels are one book's, exactly as the planks' are: only CITY carries these
    if (
      ![ELEVATOR.car.back, ELEVATOR.car.front, ...ELEVATOR.idle.cels].every((id) =>
        sbk.byId.has(id),
      )
    )
      continue;
    // `0x42fb70` at the shaft's BOTTOM — the car starts on its landing and owns it
    const floor = solids.platforms.find(
      (q) =>
        !taken.has(q) &&
        e.pointX >= q.left &&
        e.pointX < q.right &&
        e.bottom >= q.top &&
        e.bottom < q.bottom,
    );
    if (!floor) continue;
    taken.add(floor);
    out.push({
      x: e.pointX,
      y: e.bottom,
      winchY: e.top,
      // from its landing up to 200px shy of the shaft's head — `0x453606`, and
      // the 200 is the winch's room, not travel
      bottom: floor.top,
      top: floor.top - Math.max(0, e.bottom - e.top - ELEVATOR.headroom),
      state: "idle",
      clock: 0,
      dir: -1,
      vy: 0,
      floor,
    });
  }
  return out;
}

/**
 * Every `initplank` standing in this room, each holding the platform it owns.
 *
 * The ownership is the engine's `0x42fb70`, which the plank's creator calls: the
 * platform whose rect contains the plank's own POINT becomes the plank's, and only
 * if nothing has claimed it already. CITY lays every one of its twenty planks
 * inside a platform record for exactly this.
 */
export function planksIn(sbk: SbkFile, room: SbkRoom, solids: Solids): Plank[] {
  const taken = new Set<SbkEntity>();
  const out: Plank[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "initplank") continue;
    const cy = (e.top + e.bottom) >> 1;
    const cx = (e.left + e.right) >> 1;
    if (cy < room.top || cy > room.bottom || cx < room.left || cx > room.right)
      continue;
    // the cels are one book's: only CITY carries 1050..1061
    if (!PLANK.intact.cels.every((id) => sbk.byId.has(id))) continue;
    const floor =
      solids.platforms.find(
        (q) =>
          !taken.has(q) &&
          e.pointX >= q.left &&
          e.pointX < q.right &&
          e.pointY >= q.top &&
          e.pointY < q.bottom,
      ) ?? null;
    if (floor) taken.add(floor);
    out.push({
      x: e.pointX,
      y: e.pointY,
      left: e.left,
      right: e.right,
      state: "intact",
      clock: 0,
      crossings: 0,
      vy: 0,
      floor,
      homeY: e.pointY,
      homeFloor: floor ? { top: floor.top, bottom: floor.bottom } : null,
    });
  }
  return out;
}

/**
 * Every `initcrow` in this room, perched where the record's point puts it.
 *
 * Its rect is its territory and the trigger both: `0x451ba3` tests the player's
 * own point against it and that is what wakes the bird. CITY places twelve, each
 * one 148 wide and 300 tall — a column of air over a rooftop.
 */
export function crowsIn(sbk: SbkFile, room: SbkRoom): Crow[] {
  const out: Crow[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "initcrow") continue;
    const cy = (e.top + e.bottom) >> 1;
    const cx = (e.left + e.right) >> 1;
    if (cy < room.top || cy > room.bottom || cx < room.left || cx > room.right)
      continue;
    if (!CROW.sleep[0].cels.every((id) => sbk.byId.has(id))) continue;
    // `0x450910`: facing east, and `ctx+0x10`/`ctx+0x12` both zero
    out.push({
      x: e.pointX,
      y: e.pointY,
      top: e.top,
      left: e.left,
      bottom: e.bottom,
      right: e.right,
      state: "sleep",
      tag: 0,
      clock: 0,
      vx: 0,
      vy: 0,
      gravity: 0,
      grounded: false,
      hit: false,
      factor: 0,
    });
  }
  return out;
}

/**
 * Where a level opens: the `initplayer` record's own POINT.
 *
 * `0x4036dd` reads the record's `+24` as a packed dword and writes it straight
 * into `obj+6` — the point, both words at once. This read the rect's MIDPOINT
 * instead, which agrees with the point to within half a pixel in 30 of the 31
 * shipped records and is 37 pixels lower in the one that does not: SEWER's
 * entrance, the only level where the record's rect is not centred on its point.
 *
 * Both land you on the same floor, because you fall about three hundred pixels
 * either way, so this was never visible in the resting position — but the drop
 * was 37 pixels shorter than the game's, and guessing at a rect where the
 * executable reads a field is the kind of thing that is only ever right by
 * accident.
 */
export function pickStart(sbk: SbkFile): SbkEntity | undefined {
  // `0x40b46a` collects the `initplayer` records in file order (`0x40b850`), and
  // a level begins on the FIRST: `0x42e5ef` reads `[0x4aa3d8]`, record 0's point,
  // and `0x42e5fa` zeroes the index a respawn reads. A region with no floor
  // still stands you up — `0x40bbd0`'s flat floor — so MAZE and BARREL open in
  // theirs.
  return sbk.entities.find((e) => e.name === "initplayer");
}

/**
 * The room the spawn point falls in: the one whose rect holds it, and failing
 * that the one whose floor runs under it. A level with neither still gets a
 * room, so that walking is never impossible for want of a lookup.
 */
export function roomAt(x: number, y: number): SbkRoom {
  const rooms = level!.rooms;
  const covers = (r: SbkRoom): boolean =>
    r.ground !== null &&
    x >= r.ground.x0 &&
    x < r.ground.x0 + r.ground.ys.length;
  return (
    rooms.find(
      (r) =>
        y >= r.top && y <= r.bottom && x >= r.left && x <= r.right && covers(r),
    ) ??
    rooms.find(
      (r) => y >= r.top && y <= r.bottom && x >= r.left && x <= r.right,
    ) ??
    rooms.find(covers) ??
    rooms[0]
  );
}

/**
 * The mover's side walls, as they act on a point just placed: `0x40bbd0` hands
 * back the floor's own extent — the region's `x0 .. x0 + n` (`0x40bc66`), or the
 * room's rect less fifty each end where it has no region (`0x40bc92`) — and the
 * mover puts an object at or past a side one pixel inside it when the room's bit
 * for that side is set (`0x430064` left, bit 2; `0x4300db` right, bit 8).
 * BARREL's first `initplayer` point is x12 against a floor from x51, and this is
 * what stands the game's opening on x52 instead of dropping it past the end.
 */
export function insideSides(room: SbkRoom, x: number): number {
  const g = room.ground;
  const lo = g ? g.x0 : room.left + 50;
  const hi = g ? g.x0 + g.ys.length : room.right - 50;
  if (x <= lo && room.flags & 2) return lo + 1;
  if (x >= hi && room.flags & 8) return hi - 1;
  return x;
}

/**
 * The mover's side test on a point — `0x430058`..`0x430146`. Past the floor's
 * left end ({@link insideSides}' bounds) with flag 2 set the point is held at
 * left + 1 (`0x43006b`); with it clear the FIRST region in the table whose
 * rect holds the point (`0x40b940(2, point)` at `0x4300a0`, `0x434200`'s
 * half-open test) becomes the player's — its own included, whose rect often
 * runs on past its floor — and the point goes on unheld (`0x4300bd`); only with
 * none is it held all the same (`0x4300c3`). The right end the same with flag
 * 8 (`0x4300db`). Answers where the point is held, or null when it passes (the
 * room may have changed under it).
 */
export function sideWalls(nx: number): number | null {
  const r = p.room;
  if (!r || !level) return null;
  const g = r.ground;
  const lo = g ? g.x0 : r.left + 50;
  const hi = g ? g.x0 + g.ys.length : r.right - 50;
  let past = 0;
  if (nx <= lo) past = -1;
  else if (nx >= hi) past = 1;
  if (past === 0) return null;
  const edge = past < 0 ? lo + 1 : hi - 1;
  const ay = p.y - p.feet;
  const flag = past < 0 ? 2 : 8;
  const next =
    r.flags & flag
      ? undefined
      : level.rooms.find(
          (q) => nx >= q.left && nx < q.right && ay >= q.top && ay < q.bottom,
        );
  if (next) {
    p.room = next;
    return null;
  }
  return (nx - edge) * past > 0 ? edge : null;
}

/**
 * `0x42e603` / `0x402788` — how a level starts and a life restarts: the ANCHOR
 * goes on the record's point, both velocities go to nothing, and the mover
 * drops the player onto whatever is under it. Not onto the region floor: SEWER
 * starts over a walkway laid 150 above its channel, and snapping the feet to
 * the floor put the player in the sewage.
 */
export function dropAt(room: SbkRoom | undefined, x: number, anchorY: number): void {
  p.hidden = false;
  p.room = room ?? null;
  p.x = x;
  p.y = anchorY + p.feet;
  // ...facing east: the player is a new object, and the allocator zeroes its
  // mirror word (`0x42f56a`, `obj+0x28`)
  p.facing = 1;
  p.vx = 0;
  p.vy = 0;
  p.vyRaw = 0;
  p.stepPx = 0;
  p.onGround = false;
  p.climbing = false;
  p.bar = undefined;
  p.act = null;
  snapCamera();
}

/** move into a room, standing on its floor at `x` — `y` for a room with none */
export function enter(room: SbkRoom | undefined, x: number, y: number): void {
  p.room = room ?? null;
  p.x = room ? insideSides(room, x) : x;
  p.y = groundAt(p.x) ?? y;
  p.vy = 0;
  p.onGround = true;
  p.climbing = false;
  p.bar = undefined;
  p.act = null;
  // `0x428ff6` — the point moves, and the corner goes with it in one step
  snapCamera();
}

/**
 * How far a room can be walked: where its rect and its floor BOTH reach.
 *
 * The two disagree, and neither is reliably the wider. STREETS' street runs
 * 1623…10104 as a rect and 1458…10246 as a floor, and its art stops at 10112 —
 * so the floor's last 134px are past the end of the level, and walking them
 * takes the player out of the drawn world. TOWER's top room is the other way
 * round: rect 16970…18246, floor 17225…17987.
 *
 * The designers bounded the player with `obstacle` where they wanted a wall —
 * STREETS has exactly one and it is the left-hand end, at x1344…1649. Nothing
 * stops the right, so the right must be structural, and the tightest structure
 * the file offers is where the two agree.
 */
export function roomSpan(room: SbkRoom): { lo: number; hi: number } | null {
  if (!room.ground) return null;
  const lo = Math.max(room.left, room.ground.x0);
  const hi = Math.min(room.right, room.ground.x0 + room.ground.ys.length - 1);
  return hi > lo
    ? { lo, hi }
    : { lo: room.ground.x0, hi: room.ground.x0 + room.ground.ys.length - 1 };
}

/**
 * The floor under x in the room the player is in — `0x40bbd0`.
 *
 * A room with no region of its own still has a floor: `0x40bc7d` makes it flat,
 * at its top plus {@link SbkRoom.floorDrop}, across its rect less fifty pixels
 * at each end. MAZE's two floorless rooms (x1205..3060 and x4499..5904) stand
 * on 8535 and 8069 that way; answering nothing for them left the player with
 * no floor at all.
 */
export function groundAt(x: number): number | null {
  const room = p.room;
  const g = room?.ground;
  if (room && !g) {
    const xi = Math.round(x);
    return xi >= room.left + 50 && xi < room.right - 50
      ? room.top + room.floorDrop
      : null;
  }
  if (!g?.ys.length) return null;
  // ...and past either end of a region's floor, the end sample: `0x40bc34` and
  // `0x40bc4c` hold the floor flat beyond its ends rather than answering none
  const i = Math.round(x) - g.x0;
  return g.ys[Math.max(0, Math.min(g.ys.length - 1, i))];
}

/** what the player is standing in front of right now */
export function solids(): Solids {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0
    ? level.solids[i]
    : { platforms: [], obstacles: [], goal: undefined };
}

/**
 * The first surface a falling player would meet between `fromY` and `toY`.
 *
 * The room's floor and every platform top under x, whichever is highest inside
 * the span — so a fall stops at the first thing it crosses rather than the
 * lowest. Both ends are inclusive at the top so that standing still, where the
 * floor is exactly at the feet, keeps landing on it.
 *
 * A platform is caught only if the player is over it: `left <= x < right`, which
 * is `SC.EXE`'s own point-in-rect at `0x434200` (inclusive low, exclusive high)
 * applied to the one edge that matters here.
 */
/**
 * The same test, SWEPT along the tick's whole path rather than taken at its end.
 *
 * A tick moves the player up to 3.75px across and 12px down, and a roof's edge is
 * a point: crossing it diagonally, the x that has the roof under it and the y that
 * is still above the roof's top can belong to different ticks, and then nothing
 * is ever under the player again. That is exactly how STREETS' gap stopped being
 * jumpable when gravity went up — the landing was not missed by height, it was
 * missed by one tick of tunnelling — so the path is sampled at 2px of travel
 * rather than tested once at the end.
 */
export function surfaceCrossed(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number | null {
  const steps = Math.max(
    1,
    Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 2),
  );
  for (let i = 1; i <= steps; i++) {
    const a = (i - 1) / steps;
    const b = i / steps;
    const hit = surfaceUnder(
      x0 + (x1 - x0) * b,
      y0 + (y1 - y0) * a,
      y0 + (y1 - y0) * b,
    );
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * The ledge an OPEN grave lays across its own mouth — see {@link HOLE.lid}.
 *
 * `0x4212bb` appends a synthetic `platform` record to the engine's own platform
 * table the frame a grave's opening script ends, spanning two hundred pixels
 * across the grave's point and topped 0x4c below it. GRAVE's floor really does
 * fall 320 to 370 pixels at each of its five graves, and nine of its sixteen
 * zombies patrol over one, so without this the level eats its own population and
 * its 14-of-16 quota can never be met.
 *
 * Once a grave has opened, {@link layGraveLid} appends the record itself, for
 * everything, as `0x421470` does. This answers the same ledge to the FOES over a
 * grave in any state — see the note inside.
 */
export function graveLidUnder(x: number, fromY: number, toY: number): number | null {
  let best: number | null = null;
  for (const h of hereOf((l) => l.holes)) {
    // ...in EVERY state, not only the open one, and that is the deviation.
    // `0x4212bb` lays the ledge when the opening script ends, so the executable
    // has one only while the grave is open; a shut grave is kept clear of the
    // player by `0x4210bd` shoving them out of its rect instead, and nothing in
    // the class does anything for a foe. But the pit in the floor is there in
    // both states, so a zombie crossing a grave that is still shut — which is
    // any grave the player is more than a hundred away from — went in exactly as
    // before. A shut grave is a closed slab in its own art, so the foes get to
    // walk on it.
    if (x < h.x - HOLE.lid.halfWidth || x > h.x + HOLE.lid.halfWidth) continue;
    const top = h.y + HOLE.lid.top;
    if (top < fromY || top > toY) continue;
    if (best === null || top < best) best = top;
  }
  return best;
}

/** {@link surfaceUnder}, plus the ledge an open grave lays — for foes */
export function foeSurfaceUnder(x: number, fromY: number, toY: number): number | null {
  const floor = surfaceUnder(x, fromY, toY);
  const lid = graveLidUnder(x, fromY, toY);
  if (floor === null) return lid;
  if (lid === null) return floor;
  return Math.min(floor, lid);
}

export function surfaceUnder(x: number, fromY: number, toY: number): number | null {
  let best: number | null = null;
  const g = groundAt(x);
  if (g !== null && g >= fromY && g <= toY) best = g;
  /**
   * ...and the platforms are the LEVEL's, not the room's.
   *
   * The engine keeps one table for them — `0x4a69d0`, rebuilt every frame from
   * every `platform` record in the book, twelve bytes a row — and `0x42fd80`
   * searches the whole of it. A region owns a floor; it does not own the ledges.
   * Level seven is where the difference shows: the plank across the bottom of
   * its last two rooms runs from x6147 to x9471 and its middle is in the second,
   * so filing it by its centre left the first with nothing under it and dropped
   * the player out of the world at the foot of its own shaft.
   */
  for (const room of level?.solids ?? []) {
    for (const e of room.platforms) {
      if (x < e.left || x >= e.right) continue;
      // crossed on the way down — or already INSIDE it: `0x42fe86` takes any
      // platform whose bottom is at or under the foot, and the snap then puts
      // the foot on its top, so a thing planted a few pixels into a walkway
      // (a bush's grip does it) stands on the walkway, not under it
      const crossed = e.top >= fromY && e.top <= toY;
      const inside = e.top <= toY && e.bottom >= toY;
      if (!crossed && !inside) continue;
      if (best === null || e.top < best) best = e.top;
    }
  }
  return best;
}

/**
 * An `obstacle` is a volume your ANCHOR may not be inside — not a box your whole
 * sprite may not touch, which would make CITY impassable.
 *
 * `0x430146` is the engine's rule, in the same mover that steps every object:
 *
 * ```
 *   if (obj+0x36 == 0) skip                     ; a per-object opt-out
 *   for each of [0x46b9b0] records at 0x4a8a10, stride 0x30:
 *     if (!0x434200(obj's point, record + 2)) continue    ; POINT in rect
 *     obj+0x2c = 1                              ; it is inside one
 *     take the SMALLEST of the four penetrations:
 *       0  point.y - rect.y0     up             3  rect.x1 - point.x   east
 *       1  point.x - rect.x0     west           2  rect.y1 - point.y   down
 *     and move the object that far along that axis, scaling the velocity it had
 *     on that axis by obj+0x20 >> 13 — a restitution
 * ```
 *
 * Two things follow, and CITY is built on both. The test is the object's own
 * point, so **being above an obstacle is a matter of one pixel and not of a whole
 * sprite**: CITY's first wall is the west side of a wooden water tank, rect
 * `y3852..4160, x1873..1933`, with the tank's roof a `platform` at y3920 starting
 * at the same x. Standing on the walkway below (feet 4041, anchor 3953) the wall
 * ejects you west; a jump that lifts the anchor past 3852 — 101 pixels — is over
 * it, and the roof platform catches the feet. Tested as a BOX it would need the
 * sprite's whole 148 rows clear of y3852, which is 189 pixels of jump: there is no
 * such jump.
 *
 * And an obstacle is not a surface. The engine ejects UPWARD when that is the
 * shortest way out, which lands the anchor on the rect's top edge with the feet 88
 * rows inside it — so what you actually stand on is the `platform` record laid
 * along the top, which every one of these obstacles has. A wall is the two records
 * together.
 */
export function ejectFromObstacles(): void {
  // the engine's point is the object's own y, which is the cel's anchor — this
  // page keeps `p.y` at the feet, so the standing cel's box bottom converts it.
  // A fixed offset on purpose: the engine's y does not move when the pose does,
  // and the airborne cels' boxes are 19 rows shallower than the standing one's.
  const ay = p.y - p.feet;
  for (const e of blockers()) {
    // `0x434200`: x0 <= x < x1 and y0 <= y < y1, and nothing else
    if (!(p.x >= e.left && p.x < e.right && ay >= e.top && ay < e.bottom))
      continue;
    const up = ay - e.top;
    const west = p.x - e.left;
    const down = e.bottom - ay;
    const east = e.right - p.x;
    const least = Math.min(up, west, down, east);
    if (least === up) {
      p.y -= up;
      if (p.vy > 0) p.vy = 0;
    } else if (least === west) p.x -= west;
    else if (least === down) {
      p.y += down;
      if (p.vy < 0) p.vy = 0;
    } else p.x += east;
  }
}

/**
 * The ladder the player can GRAB, and it is the current cel's bitmap against
 * the record's rect — not a point, which is what this had.
 *
 * The idle state grabs with `0x42edd0(0, 1)`, which asks the chapter's
 * classifier `[0x4abe00]`, and every chapter's (`0x4123b0`, kind 0) begins
 *
 * ```
 *   0x40b660("ladder", player, 0, 1, 0x4ac3a0)  ->  4
 * ```
 *
 * `0x40b660` is the query by NAME; its third argument is the region and it is
 * 0, so no room is consulted; its fourth is the geometry, and 1 is
 * `0x434140(box, rect)` — a rectangle INTERSECTION with positive area. The box
 * is `0x42f9f0`'s: the current cel's whole bitmap about its anchor, `(-posY,
 * -posX, height - posY, width - posX)`, mirrored with the facing, and set down
 * at the player's anchor. The standing cel is 98 wide with its anchor 41 in,
 * so STREETS' rect of x9632..9779 is grabbed from 9575 to 9820, and the file's
 * pointX then puts you on the rail.
 *
 * Whom it answers is the other half, and it is why the port grabbed from too
 * far away: `0x429872` runs only in the IDLE state (kind 0, `0x429690`), only
 * with forward NOT held, and only with {@link ladderLatch} clear — W is the run
 * key, and a runner going past a ladder is in the run state, which never asks.
 * The jump state asks the same way (`0x429f5d`), so W in the air grabs. S is
 * `0x42edd0(1, 1)` from the idle, walk, run and jump states alike (`0x4298af`,
 * `0x429aaa`, `0x429caf`, `0x429e3b`), so a walker can take a ladder DOWN.
 *
 * The ladder state itself never re-asks: the record is copied into `0x4ac3a0`
 * by the grab and read from there until the leave, which is {@link canLetGo}.
 */
export function ladderAt(): SbkEntity | undefined {
  const rec = celRec(player, lastCel);
  if (!rec || !level) return undefined;
  // `p.y` is the feet and the bitmap's bottom edge; `p.x` is the anchor's x
  const [x0, x1] =
    p.facing < 0
      ? [rec.posX - rec.width, rec.posX]
      : [-rec.posX, rec.width - rec.posX];
  const top = p.y - rec.height;
  const left = p.x + x0;
  const right = p.x + x1;
  // the whole level's, because `0x40b660` scans the whole entity table and a
  // ladder is the one record that exists to carry you OUT of a region
  return level.ladders.find(
    (e) =>
      Math.max(top, e.top) < Math.min(p.y, e.bottom) &&
      Math.max(left, e.left) < Math.min(right, e.right),
  );
}

/**
 * The monkeybar the player's own point is inside — see {@link MONKEYBAR}.
 */
export function barAt(): SbkEntity | undefined {
  if (!level) return undefined;
  // `0x41243b` asks `0x40b660` with geometry 0, which is `0x434200`: the
  // player's own ANCHOR POINT inside the rect. Not the bitmap the ladder is
  // tested with, and not the feet — `p.y` is the feet on this page and the
  // engine's `obj+6` is the anchor, so the difference has to come off.
  const anchor = p.y - p.feet;
  return level.bars.find(
    (e) =>
      p.x >= e.left && p.x <= e.right && anchor >= e.top && anchor <= e.bottom,
  );
}

/**
 * Whether forward, backward or J may take you OFF the ladder this tick.
 *
 * `0x42ae50` leaves only when three things hold at once: the rung tag playing
 * has ENDED (`obj+0x46`), the tag is one of the four rungs (not the mount), and
 * the chapter's classifier asked with kind 2 (`0x412517`) does NOT answer 4 —
 * which it does when `0x40b940(2, point)` finds no record holding the player's
 * anchor. So you let go where a room is, and nowhere else: the mount put
 * `obj+0x16` to -1, and the leave writes the room back from that same query.
 *
 * The first of the three is what made this page's climb fast: a direction held
 * with W left the ladder the tick it was pressed and W grabbed it again the
 * next, one rung higher each time. Now the rung finishes, the hop is taken, and
 * {@link ladderLatch} keeps the ladder out of reach until the ground.
 *
 * A monkeybar's leave is none of this — see {@link MONKEYBAR}: S or J, from
 * the hang tag only, and straight down.
 */
export function canLetGo(): boolean {
  if (p.climbClock < LADDER.rungFrames) return false;
  return !!level?.rooms.some(
    (r) =>
      p.x >= r.left &&
      p.x <= r.right &&
      p.climbY >= r.top &&
      p.climbY <= r.bottom,
  );
}

/** the things spawned in the player's room, or none */
export function spawnedHere(): Enemy[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.spawned[i] : [];
}

/** what of each is in the room the player is in */
export function hereOf<T>(pick: (lvl: Level) => T[][]): T[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? pick(level)[i] : [];
}

/** the doors in the room the player is in */
export function doorsHere(): Door[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.doors[i] : [];
}

/**
 * What the player's anchor may not be inside: the room's `obstacle` records, and
 * every door in it that is not yet open.
 *
 * The engine keeps one table for both — `0x435ff0` appends a door's rect to the
 * same `0x4a89e2` array the level's walls are read into, and `0x440060` takes it
 * out again as the door finishes opening — so this is one list there too.
 */
export function blockers(): {
  top: number;
  left: number;
  bottom: number;
  right: number;
}[] {
  const out: { top: number; left: number; bottom: number; right: number }[] = [
    ...solids().obstacles,
  ];
  for (const d of doorsHere()) if (d.state !== "open") out.push(d);
  // `0x411460` is what a cage door does as it shuts: it appends its own rect to
  // the level's obstacle table, so it stops being a door and starts being wall
  for (const c of hereOf((l) => l.cages))
    if (c.state === "shut" || c.state === "closing") out.push(c);
  return out;
}

/** `0x434540(n)` returns 1…n — level six's levers, and every class's own brain */
export function roll(n: number): number {
  return scRoll(n);
}
