/**
 * The level's moving parts that the player touches: planks, elevators, crushes,
 * switches, doors, pickups, holes, hands, axes, bridges, floors, surges and
 * cages — how each is built from the level and how it steps.
 */
import { SbkEntity, SbkFile, SbkRoom } from "@dreamfactory/engine/df/sbk";
import { ShpFrame } from "@dreamfactory/engine/df/shp";
import { loopIndex } from "../foes";
import { TICK_SCALE } from "../brains/kit";
import { FOE_SFX } from "../sound";
import { ELEVATOR, Elevator, IBEAM, CRUSH, Ibeam, Crush, PLANK, Plank, elevatorFrames, crushFrames, plankCel, plankFrames, PICKUP, Pickup, SHACK, Shack, BARREL, Barrel, DOOR, Door, ELEV, Elev, SWITCH, Switch, switchFrames, GOOP, Nest, HOLE, Hole, HAND, Hand, AXE, Axe, BRIDGE, Bridge, FLOOR, Floor, SURGE, Surge, CAGE, Cage, BOGGS } from "../props";
import { level, p, sound, held, type Solids, player, character } from "./state";
import { dropKeys, punchPressed } from "./keys";
import { roundAway, DIVISOR } from "./motion";
import { celRec, lastCel, playerFrame, playerBox } from "./cels";
import { groundAt, roll, hereOf } from "./rooms";
import { inv, loadRounds } from "./arsenal";
import { stats } from "./blows";
import { addClock } from "./hurt";
import { film, died } from "./death";
import { overlaps } from "./box";

/** the planks standing in the room the player is in */
export function planksHere(): Plank[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.planks[i] : [];
}

/**
 * Step every plank: whether the player is on it, whether that is one crossing too
 * many, and the fall — `0x4531d0`, and {@link PLANK} quotes it line by line.
 *
 * The engine publishes the owned platform at its owner's position every frame
 * (`0x42fcb9`); this moves the record with the plank, which is the same thing.
 * A falling plank drops 30 pixels in its first frame, past the rider's 8-pixel
 * snap (`0x42ff56`), so the rider is left behind at once.
 *
 * The plank falls until the room's floor holds it — its `obj+0x34` is 0
 * (`0x42f5a7`), so the mover gives it `0x40bbd0`'s floor and no platform — and
 * lies there on the art's foot, `+0x26`, with its record beside it.
 */
export function stepPlanks(): void {
  for (const k of planksHere()) {
    if (k.gone) continue;
    k.clock += TICK_SCALE;
    if (k.state === "fall") {
      if (k.vy === 0 && k.landed) continue;
      // `0x43032b`: `obj+0x24` (30, {@link PLANK.gravity}) added on every airborne
      // frame, uncapped
      k.vy += PLANK.gravity * TICK_SCALE * TICK_SCALE;
      let dy = k.vy;
      const rec = level ? celRec(level.sbk, plankCel(k)) : undefined;
      const ground = groundAt(k.x);
      if (rec && ground !== null) {
        const foot = k.y + rec.height - rec.posY;
        if (foot + dy >= ground) {
          // `0x42ff5d`: on the floor. A landing faster than 2 a frame keeps a
          // quarter of it (`obj+0x20`, 0x800/8192) and settles; slower stops dead
          dy = ground - foot;
          k.vy = k.vy / TICK_SCALE > 2 ? k.vy * 0.25 : 0;
          k.landed = true;
        }
      }
      k.y += dy;
      if (k.floor) {
        k.floor.top += dy;
        k.floor.bottom += dy;
      }
      continue;
    }
    if (k.state === "wobble") {
      // `0x4532a7`: the sag ends, that is one crossing, and it is a plank again
      if (k.clock >= plankFrames(k)) {
        k.crossings += 1;
        k.state = "intact";
        k.clock = 0;
      }
      continue;
    }
    // `0x4531fc`..`0x45323f`: inside its rect, on the ground, above it, and near.
    // "Above" and "near" are measured from the player's own POINT the way every
    // other test in the engine is — their feet are level with the plank when they
    // stand on it, and a feet test never fires
    const ay = p.y - p.feet;
    const on =
      p.x > k.left &&
      p.x < k.right &&
      p.onGround &&
      ay < k.y &&
      k.y - ay < PLANK.reach;
    if (!on) continue;
    if (k.crossings <= PLANK.crossings && p.fallPx <= PLANK.hardFallPx) {
      k.state = "wobble";
      k.clock = 0;
      continue;
    }
    k.state = "fall";
    k.clock = 0;
    k.vy = 0;
    sound?.effect(PLANK.sound, k.x, k.y);
  }
  // a plank past the end of the room's floor has nothing to land on. The engine's
  // region bounds would hold it at the room's edge; this port stops it and its
  // record once it is 400px below the room, which nobody can see, and keeps it
  // for the death that puts it back
  const room = p.room;
  if (!room) return;
  for (const k of planksHere()) {
    if (k.gone || k.state !== "fall" || k.landed || k.y < room.bottom + 400) continue;
    k.gone = true;
    if (k.floor) {
      // and it takes the record with it: nothing stands on a plank that has gone
      k.floor.top = room.bottom + 10000;
      k.floor.bottom = k.floor.top + 1;
    }
  }
}

/** the elevators in the room the player is in */
export function elevatorsHere(): Elevator[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.elevators[i] : [];
}

/** is the player standing on this car right now — their feet on its deck */
export function ridingElevator(e: Elevator): boolean {
  return (
    p.onGround &&
    p.x >= e.floor.left &&
    p.x < e.floor.right &&
    Math.abs(p.y - e.floor.top) <= 4
  );
}

/**
 * Step every elevator: `0x453470`'s five states, in the order its table runs them.
 *
 * The car is moved by moving its floor record, which is how the rider comes with
 * it — the engine publishes an owned platform at its owner's position every frame
 * (`0x42fcb9`), and the walk's own "follow the floor" allows {@link CLIMB_PX} of
 * climb a tick, far more than the 13 a frame a car climbs.
 *
 * The travelling tags push `obj+0xa` by `0x28 / 10 = 4` a frame (`0x42f8b0`) and
 * clamp it to 6 down and 13 up; the push is spread over the frame's four ticks.
 */
export function stepElevators(): void {
  const push = roundAway(ELEVATOR.speed / ELEVATOR.divisor) * TICK_SCALE;
  for (const e of elevatorsHere()) {
    e.clock += TICK_SCALE;
    if (e.state === "idle") {
      // `0x453490` waits on `obj+0x46`, and that field is written by exactly one
      // thing — the animation stepper, when a script's last frame completes. So
      // tag 0 is not waiting for a rider: it is waiting for its own eighteen
      // frames of 1160 to run out, and then it goes. The car shuttles whether or
      // not anyone is aboard, pausing 1.2s at each end; you catch it.
      if (e.clock < elevatorFrames(e)) continue;
      // `0x4534b6`: down (tag 1) while the car is above the shaft's bottom, up
      // (tag 3) once it is at or past it
      e.dir = e.floor.top < e.bottom ? 1 : -1;
      e.state = "starting";
      e.clock = 0;
      sound?.effect(ELEVATOR.soundStart, e.x, e.y);
      continue;
    }
    if (e.state === "starting") {
      // `0x4534f4` / `0x4535ae`: one beat of wind-up, then the travelling tag
      if (e.clock >= elevatorFrames(e)) {
        e.state = e.dir > 0 ? "down" : "up";
        e.clock = 0;
      }
      continue;
    }
    // `0x453518` / `0x4535d2`: push, clamp, and test the end against where the
    // car IS — before the mover spends this frame's velocity, so the last push
    // still carries it a few pixels past the end
    e.vy =
      e.dir > 0
        ? Math.min(e.vy + push, ELEVATOR.maxDown)
        : Math.max(e.vy - push, -ELEVATOR.maxUp);
    const done = e.dir > 0 ? e.floor.top >= e.bottom : e.floor.top < e.top;
    if (done) {
      e.vy = 0;
      e.state = "idle";
      e.clock = 0;
      sound?.effect(ELEVATOR.soundStop, e.x, e.y);
      continue;
    }
    const moved = e.vy * TICK_SCALE;
    e.floor.top += moved;
    e.floor.bottom += moved;
    e.y += moved;
  }
}

/**
 * Every `initibeam` in this room, standing where its record's point puts it.
 *
 * There is nothing to resolve and nothing to own: the frame function rewrites the
 * beam's position from the file every tick (`obj+6 = ctx+0`) and zeroes its
 * velocity, so the record IS the answer. See {@link IBEAM}.
 */
export function ibeamsIn(sbk: SbkFile, room: SbkRoom): Ibeam[] {
  const out: Ibeam[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "initibeam") continue;
    const cy = (e.top + e.bottom) >> 1;
    const cx = (e.left + e.right) >> 1;
    if (cy < room.top || cy > room.bottom || cx < room.left || cx > room.right)
      continue;
    // the cels are one book's, as the planks' and the lifts' are
    if (!IBEAM.across.cels.every((id) => sbk.byId.has(id))) continue;
    // with no delay there is no script on the first frame and `obj+0x46` is the
    // reset's 1 (`0x45d07d`), so tag 0's handler (`0x45382a`) hands straight to
    // tag 1; with one, `0x453800` installs tag 0 as it runs out
    const now = e.param <= 0;
    out.push({
      x: e.pointX,
      y: e.pointY,
      state: now ? "across" : "out",
      clock: 0,
      // the record's own stagger — the creator loads ctx+4 from a word of it, and
      // CITY gives exactly one of its seven a nonzero one
      delay: e.param,
      side: now ? 1 : 0,
    });
  }
  return out;
}

/**
 * Every `initcrush` in this room — WOODS places three and no other book places
 * any, which is the shape the planks, the lifts and the girders all have.
 *
 * The record's rect is what arms it and the record's point is where it stands,
 * and the class uses both without a creator's worth of arithmetic in between
 * (`0x450f19` keeps the point and both corners in a twelve-byte context, and
 * `0x4549c3` rewrites the object onto the point every frame).
 */
export function crushesIn(sbk: SbkFile, room: SbkRoom): Crush[] {
  const out: Crush[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "initcrush") continue;
    if (
      e.pointY < room.top ||
      e.pointY > room.bottom ||
      e.pointX < room.left ||
      e.pointX > room.right
    )
      continue;
    if (!CRUSH.slam.cels.every((id) => sbk.byId.has(id))) continue;
    out.push({
      x: e.pointX,
      y: e.pointY,
      top: e.top,
      left: e.left,
      bottom: e.bottom,
      right: e.right,
      state: "idle",
      clock: 0,
    });
  }
  return out;
}

/** the presses in the room the player is in */
export function crushesHere(): Crush[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.crushes[i] : [];
}

/**
 * Step every press — `0x4549b0`, and {@link CRUSH} has its nine instructions.
 *
 * The trigger is `0x434200(player+6, ctx+4)`: the player's own POINT inside the
 * record's own rect, which is the same point-in-rect test a ladder and a door
 * use. It is re-tested on every frame the press is up, so standing under one
 * works it until you move.
 */
export function stepCrushes(): void {
  for (const c of crushesHere()) {
    if (c.state === "idle") {
      // the anchor is the point the cel hangs from, which is the player's y less
      // the feet — the same conversion {@link poseFeet} keeps
      const ay = p.y - p.feet;
      const inside =
        p.x >= c.left && p.x < c.right && ay >= c.top && ay < c.bottom;
      if (!inside) continue;
      sound?.effect(CRUSH.sound, c.x, c.y);
      c.state = "slam";
      c.clock = 0;
      continue;
    }
    c.clock += TICK_SCALE;
    if (c.clock < crushFrames(c)) continue;
    c.clock = 0;
    c.state = c.state === "slam" ? "lift" : "idle";
  }
}

/**
 * Every `switch` in this room. SERVICE places six and no other book places one —
 * which is why level five's gang, who all know how to walk to a lever, never do.
 *
 * `0x436020` keeps the record's point as the position and the record's `param`
 * in its own six-byte context; the rect is what the player has to be standing in
 * and what an enemy's territory has to contain.
 */
export function switchesIn(sbk: SbkFile, room: SbkRoom): Switch[] {
  const out: Switch[] = [];
  for (const e of sbk.entities) {
    // SERVICE calls them `switch` and MAZE calls them `initswitch`, and they
    // are the same class: `0x473548` and `0x46c050` have the same four tags on
    // the same four cel runs, one per chapter's book
    if (!e.isEntity || (e.name !== "switch" && e.name !== "initswitch"))
      continue;
    if (
      e.pointY < room.top ||
      e.pointY > room.bottom ||
      e.pointX < room.left ||
      e.pointX > room.right
    )
      continue;
    if (!SWITCH.off.cels.every((id) => sbk.byId.has(id))) continue;
    out.push({
      x: e.pointX,
      y: e.pointY,
      top: e.top,
      left: e.left,
      bottom: e.bottom,
      right: e.right,
      param: e.param,
      state: "off",
      clock: 0,
      // MAZE's lever is chapter two's class, whose throw `0x412550` plays nothing
      maze: e.name === "initswitch",
    });
  }
  return out;
}

/**
 * Every `initgoop` in this room, as the nest a negative kind makes.
 *
 * The level's spawner hands the creator `-1` (`0x435987`), and that branch keeps
 * the rect and the param and gives the object a script whose kind is 3 — the one
 * the class's draw case will not paint. So a level's goop records are twenty-two
 * invisible volumes, and everything you can see comes out of them at run time.
 */
export function nestsIn(sbk: SbkFile, room: SbkRoom): Nest[] {
  const out: Nest[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "initgoop") continue;
    if (
      e.pointY < room.top ||
      e.pointY > room.bottom ||
      e.pointX < room.left ||
      e.pointX > room.right
    )
      continue;
    if (!GOOP.bead.cels.every((id) => sbk.byId.has(id))) continue;
    out.push({
      top: e.top,
      left: e.left,
      bottom: e.bottom,
      right: e.right,
      param: e.param,
      on: false,
    });
  }
  return out;
}

/** the levers in the room the player is in */
export function switchesHere(): Switch[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.switches[i] : [];
}

/** the nests in the room the player is in */
export function nestsHere(): Nest[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.nests[i] : [];
}

/**
 * Throw one lever — `0x436820(pos, dir)`, and it is the only way either state
 * changes.
 *
 * Direction zero answers a lever that is OFF and direction one a lever that is
 * ON; anything else it ignores, which is why a gang member standing at a lever
 * it has already thrown does nothing at all. The sounds are `0x436895`'s 0x4b
 * going up and `0x4368c9`'s 0x4a coming back.
 */
export function throwSwitch(s: Switch, dir: 0 | 1): boolean {
  if (dir === 0 && s.state === "off") {
    s.state = "turningOn";
    s.clock = 0;
    // MAZE's `0x412550` installs the throw without a sound
    if (!s.maze) sound?.effect(SWITCH.throwOn, s.x, s.y);
    return true;
  }
  if (dir === 1 && s.state === "on") {
    s.state = "turningOff";
    s.clock = 0;
    if (!s.maze) sound?.effect(SWITCH.throwOff, s.x, s.y);
    return true;
  }
  return false;
}

/**
 * Step every lever, and let the player work one.
 *
 * `0x43c2c0` is four lines: pin the object on its point, zero the velocity pair,
 * and when the current tag's script has ended install the next. The two throws
 * broadcast as they end — `0x43c3d0` flips the tag of every goop with the same
 * `param` and plays 0x24 at each of them — and the two resting tags simply
 * reinstall themselves.
 *
 * The player's half is `0x429870`, in the standing state, asking the chapter's
 * own "what am I at" query twice a frame: with no direction held it asks kind 0,
 * which throws a lever ON, and with S held it asks kind 1, which throws one OFF.
 * So stopping on a lever starts the shower and S is how you stop it, which is
 * exactly backwards from what you want and exactly what the file says.
 */
export function stepSwitches(): void {
  // every lever in the LEVEL, because a throw has to finish wherever it was made
  const here = level?.switches.flat() ?? [];
  if (!here.length) return;
  const ay = p.y - p.feet;
  for (const s of here) {
    const inside =
      p.x >= s.left && p.x < s.right && ay >= s.top && ay < s.bottom;
    if (inside && p.act === null) {
      // `0x4298ab`: S first, and it is the only one of the two that turns it off
      if (held.down) throwSwitch(s, 1);
      else if (!held.left && !held.right) throwSwitch(s, 0);
    }
    s.clock += TICK_SCALE;
    if (s.clock < switchFrames(s)) continue;
    s.clock = 0;
    if (s.state === "turningOn") {
      s.state = "on";
      broadcast(s.param);
    } else if (s.state === "turningOff") {
      s.state = "off";
      broadcast(s.param);
    }
  }
}

/**
 * Every `door` in this room. SEWER places five and no other book places one.
 *
 * The creator keeps `abs(param)` as the number its lever has to carry and the
 * sign as the frame's mirror flag, and hands the record's rect to `0x435ff0`,
 * which appends it to the engine's own obstacle table — so a shut door is solid
 * in exactly the way an `obstacle` record is, and an open one is not there at
 * all ({@link blockers}).
 */
export function doorsIn(sbk: SbkFile, room: SbkRoom): Door[] {
  const out: Door[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "door") continue;
    if (
      e.pointY < room.top ||
      e.pointY > room.bottom ||
      e.pointX < room.left ||
      e.pointX > room.right
    )
      continue;
    if (!DOOR.shut.cels.every((id) => sbk.byId.has(id))) continue;
    out.push({
      x: e.pointX,
      y: e.pointY,
      top: e.top,
      left: e.left,
      bottom: e.bottom,
      right: e.right,
      param: Math.abs(e.param),
      mirror: e.param < 0,
      state: "shut",
      clock: 0,
    });
  }
  return out;
}

/**
 * Every `initelev` in this room, with the `platform` record it claimed.
 *
 * `0x435a19` calls `0x42fb70` from the creator — the same claim a plank and a
 * girder make — and SEWER lays a `platform` over each of its six lifts, the two
 * records agreeing to a few pixels. Whichever platform holds the lift's own
 * point is its floor, and moving one moves the other.
 */
export function elevsIn(sbk: SbkFile, room: SbkRoom, solids: Solids): Elev[] {
  const out: Elev[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "initelev") continue;
    if (
      e.pointY < room.top ||
      e.pointY > room.bottom ||
      e.pointX < room.left ||
      e.pointX > room.right
    )
      continue;
    // ...and the cel is the CHAPTER's — see {@link ELEV.cels}. Requiring SEWER's
    // 3202 threw away all four of CAVERN's lifts, which are the only way up out
    // of its second room.
    const cel = ELEV.cels.find((c) => sbk.byId.has(c));
    if (cel === undefined) continue;
    const floor = solids.platforms.find(
      (q) =>
        e.pointX >= q.left &&
        e.pointX <= q.right &&
        e.pointY >= q.top - 40 &&
        e.pointY <= q.bottom + 40,
    );
    out.push({
      x: e.pointX,
      y: e.pointY,
      top: e.top,
      bottom: e.bottom,
      param: e.param,
      state: "atBottom",
      clock: 0,
      vy: 0,
      cel,
      floor,
    });
  }
  return out;
}

/**
 * Every record of one name in this room, turned into whatever that class is.
 *
 * All six of the classes below are placed the same way — the record's point is
 * where the thing stands and the record's rect is what it watches — so the
 * filter is one function: the point has to be in the room, and every cel the
 * class draws has to be in the book, which is what keeps another chapter's
 * `initbush` out of this one.
 */
export function placed<T>(
  sbk: SbkFile,
  room: SbkRoom,
  name: string,
  cels: readonly number[],
  make: (e: SbkEntity) => T,
): T[] {
  const out: T[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== name) continue;
    if (
      e.pointY < room.top ||
      e.pointY > room.bottom ||
      e.pointX < room.left ||
      e.pointX > room.right
    )
      continue;
    if (!cels.every((id) => sbk.byId.has(id))) continue;
    out.push(make(e));
  }
  return out;
}

/**
 * Every record of one name filed in this room, for a class the EXE makes for
 * the whole level rather than for a room.
 *
 * `0x410b10` (chapter four's setup, MAZE among its levels) gathers each name
 * with `0x40b850(name, room, 0, buf)` — the third argument is the room test, and
 * with it 0 the collector skips both the room rect fetch (`0x40b881`) and the
 * `0x434200` overlap test (`0x40b8e3`): every record in the book is copied out
 * and handed to its creator, wherever its point stands. MAZE's five `initvfan`
 * points sit at the TOP of their shafts, between rooms (2200,7239 is under
 * room 1's bottom and over room 0's top), so the point test {@link placed} uses
 * would drop them all.
 *
 * The port still files each thing under a room, because a room is what it draws
 * ({@link hereOf}); a record whose point is in no room goes under the first room
 * its own rect overlaps — for every vertical fan that is the room its shaft
 * opens into, and only one. Each is filed once, so the level-wide steps over
 * `.flat()` see it once.
 */
export function filedIn<T>(
  sbk: SbkFile,
  rooms: readonly SbkRoom[],
  room: SbkRoom,
  name: string,
  cels: readonly number[],
  make: (e: SbkEntity) => T,
): T[] {
  if (!cels.every((id) => sbk.byId.has(id))) return [];
  const holds = (r: SbkRoom, e: SbkEntity): boolean =>
    e.pointY >= r.top && e.pointY <= r.bottom && e.pointX >= r.left && e.pointX <= r.right;
  const overlaps = (r: SbkRoom, e: SbkEntity): boolean =>
    e.top <= r.bottom && e.bottom >= r.top && e.left <= r.right && e.right >= r.left;
  const out: T[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== name) continue;
    const home = rooms.find((r) => holds(r, e)) ?? rooms.find((r) => overlaps(r, e));
    if (home === room) out.push(make(e));
  }
  return out;
}

/**
 * Where the head and the claw arm stand against the body — decided once, and
 * then kept to every frame as the body moves ({@link placeBoggs}).
 *
 * `initboggshead` has a record of its own in `VAT.SBK` and `0x412310` puts the
 * head on its point. `initbgclawarm` has no point at all: `0x4121ae` copies the
 * BODY's `+6` as a dword, so the arm's Y and X are the body's own, and the jaws
 * then hang at the centre of the arm cel's box (`0x412180`) — which is read per
 * frame in {@link jawsAt}, because the cel is what says where the centre is.
 */
export function headAndArm(
  sbk: SbkFile,
  room: SbkRoom,
  body: SbkEntity,
): { headX: number; headY: number; headOff: { dx: number; dy: number } } {
  const head = sbk.entities.find(
    (e) =>
      e.isEntity &&
      e.name === "initboggshead" &&
      e.pointY >= room.top &&
      e.pointY <= room.bottom &&
      e.pointX >= room.left &&
      e.pointX <= room.right,
  );
  const headX = head?.pointX ?? body.pointX;
  const headY = head?.pointY ?? body.pointY;
  return { headX, headY, headOff: { dx: headX - body.pointX, dy: headY - body.pointY } };
}

/**
 * The `wormbounds` record — one per room, and every worm is clamped inside it.
 *
 * `0x41ac70` reads it once, at the class's own setup, and stores the rect at
 * `[0x4a50c8]`; `0x41ac09`…`0x41ac26` then holds each worm's point inside it
 * every frame. The record carries no point of its own that anything reads — it
 * is a box and nothing else, which is why `levels.md` had nowhere to file it.
 */
export function wormBounds(
  sbk: SbkFile,
  room: SbkRoom,
): { left: number; right: number; top: number; bottom: number } | null {
  const r = sbk.entities.find(
    (e) =>
      e.name === BOGGS.worms.bounds &&
      e.top >= room.top &&
      e.top <= room.bottom &&
      e.left >= room.left &&
      e.left <= room.right,
  );
  return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null;
}

/** the worms' box against the body's own record point — `0x41acd9`..`0x41acfc` */
export function boundsAgainst(
  r: { left: number; right: number; top: number; bottom: number } | null,
  body: { pointX: number; pointY: number },
): { left: number; right: number; top: number; bottom: number } | undefined {
  if (!r) return undefined;
  return {
    left: r.left - body.pointX,
    right: r.right - body.pointX,
    top: r.top - body.pointY,
    bottom: r.bottom - body.pointY,
  };
}

/** every `initshack` in this room — CITY places eleven and nothing else places any */
export function shacksIn(sbk: SbkFile, room: SbkRoom): Shack[] {
  return placed(sbk, room, "initshack", SHACK.opening.cels, (e) => ({
    x: e.pointX,
    y: e.pointY,
    top: e.top,
    left: e.left,
    bottom: e.bottom,
    right: e.right,
    mirror: e.param !== 0,
    state: "shut" as const,
    clock: 0,
  }));
}

/**
 * Every `initbarrel` in this room, with the `platform` it claimed.
 *
 * `0x435d6e` calls `0x42fb70` — the plank's own "claim the platform record my
 * point is inside" — whenever the record's `param` is not negative, and level
 * seven lays one over each of its five. A barrel you cannot stand on is only
 * half a barrel.
 */
export function barrelsIn(sbk: SbkFile, room: SbkRoom, solids: Solids): Barrel[] {
  return placed(sbk, room, "initbarrel", BARREL.bob.cels, (e) => ({
    x: e.pointX,
    y: e.pointY,
    homeX: e.pointX,
    homeY: e.pointY,
    top: e.top,
    left: e.left,
    bottom: e.bottom,
    right: e.right,
    clock: 0,
    aclock: 0,
    // `0x435d8a`: the param is the counter; `0x43fc40` makes a positive one a delay
    wait: e.param,
    // `0x435d91`: 0x434540(2) - 1
    sinker: roll(2) === 2,
    tag: e.param > 0 ? ("none" as const) : ("bob" as const),
    vx: 0,
    vy: 0,
    mirror: false,
    bounced: false,
    // `0x435d6e`: `0x42fb70` — the platform the point is inside — unless the
    // param is negative
    floor:
      e.param < 0
        ? undefined
        : solids.platforms.find(
            (q) =>
              e.pointX >= q.left &&
              e.pointX < q.right &&
              e.pointY >= q.top &&
              e.pointY < q.bottom,
          ),
  }));
}

/**
 * Every `stat*` record in this room, as the code its chapter's init hands
 * `0x45b160`.
 *
 * The name is the level's and the code is the executable's, and the join between
 * them is the four blocks at `0x4512a1`, `0x43bbae`, `0x421b9e` and `0x4161c1` —
 * one per chapter, all four handing the same negative for the same name. Only
 * `statscoreup` needs the record as well as the name: `0x451420` switches on its
 * `param` for −6, −5 or −4.
 *
 * The two codes with no name anywhere — `statpunch` at −3 and `statshield` at
 * −7 — are left out because nothing in the game places them and their art
 * (18000, 18062) is in no book in the rip.
 */
export const PICKUP_CODES: Readonly<Record<string, string>> = {
  stathealth: "-1",
  statlife: "-2",
  stattimer: "-8",
};

export function pickupsIn(sbk: SbkFile, room: SbkRoom): Pickup[] {
  const out: Pickup[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity) continue;
    // `0x451420`: one name, three codes, picked by the record's own param — 0, 1
    // and 2 are −6, −5 and −4, and any other param makes nothing (`0x45142e`)
    let code: string | undefined;
    if (e.name !== "statscoreup") code = PICKUP_CODES[e.name];
    else if (e.param >= 0 && e.param <= 2) code = String(-6 + e.param);
    if (!code || !PICKUP.kinds[code]) continue;
    if (
      e.pointY < room.top ||
      e.pointY > room.bottom ||
      e.pointX < room.left ||
      e.pointX > room.right
    )
      continue;
    out.push({
      code,
      x: e.pointX,
      y: e.pointY,
      top: e.top,
      left: e.left,
      bottom: e.bottom,
      right: e.right,
      clock: 0,
    });
  }
  return out;
}

/**
 * Is this pixel of a decoded frame opaque? — and mirror by reflecting the COLUMN.
 *
 * `decodeShpFrame` already hands back the mask the engine works from: the SHP
 * stores each row as a run of opaque spans, which is why `0x4320c0` compares
 * spans rather than pixels, and `opaque` is that run flattened.
 */
export function opaqueAt(f: ShpFrame, x: number, y: number, mirror: boolean): boolean {
  if (y < 0 || y >= f.height) return false;
  const cx = mirror ? f.width - 1 - x : x;
  return cx >= 0 && cx < f.width && f.opaque[y * f.width + cx] !== 0;
}

/**
 * The SECOND test — do the two sprites actually touch?
 *
 * `0x40e680` is the whole of it and it is two steps: `0x434140` intersects the
 * two drawn rects, and `0x4320c0` then walks that intersection looking for a
 * row where both cels have an opaque span. The rect alone is not the answer —
 * the player's cel is a tall rectangle with a great deal of nothing in it, and
 * a pickup sitting in the gap under an outstretched arm passes the rect test
 * and fails this one.
 *
 * The engine returns the centre of the RECT intersection rather than of the
 * pixels it found (`0x40e782` reads back the rect `0x434140` wrote), so the
 * pixel walk only ever answers yes or no and can stop at the first hit.
 */
export function spritesTouch(
  a: { f: ShpFrame; left: number; top: number; mirror: boolean },
  b: { f: ShpFrame; left: number; top: number; mirror: boolean },
): boolean {
  const x0 = Math.max(a.left, b.left);
  const x1 = Math.min(a.left + a.f.width, b.left + b.f.width);
  const y0 = Math.max(a.top, b.top);
  const y1 = Math.min(a.top + a.f.height, b.top + b.f.height);
  if (x1 <= x0 || y1 <= y0) return false;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (
        opaqueAt(a.f, x - a.left, y - a.top, a.mirror) &&
        opaqueAt(b.f, x - b.left, y - b.top, b.mirror)
      )
        return true;
    }
  }
  return false;
}

/** the player's own frame and where it is drawn, for {@link spritesTouch} */
export function playerSprite(): {
  f: ShpFrame;
  left: number;
  top: number;
  mirror: boolean;
} | null {
  const loc = player?.byId.get(lastCel);
  const f = loc === undefined ? null : playerFrame(loc);
  if (!f) return null;
  // the same placement the draw uses: the anchor on `p.x`, standing on `p.y`
  const rec = celRec(player, lastCel);
  let left = p.x - f.width / 2;
  if (rec) left = p.facing < 0 ? p.x - (f.width - rec.posX) : p.x - rec.posX;
  return {
    f,
    left: Math.round(left),
    top: Math.round(p.y - f.height),
    mirror: p.facing < 0,
  };
}

/**
 * Step the pickups: animate them, and hand over whichever one the player is
 * standing in.
 *
 * `0x45b270` runs from the player's own think every frame and asks two
 * questions of each one — `0x434140`, the player's rect for the cel it is
 * showing (`0x45b296` → `0x42f9f0`) against the pickup's record rect, and then
 * `0x40e680`, which compares the two sprites pixel by pixel. It answers the
 * FIRST pickup that passes both (`0x45b38b`) and stops, so one is taken a frame.
 * There is no button and no facing: walking over one is the whole of it.
 *
 * What each one gives is `0x42827a`'s table, and every sound comes out of the
 * CHARACTER's bank rather than the level's ({@link PICKUP}).
 */
export function stepPickups(): void {
  const lvl = level;
  if (!lvl || !player) return;
  const here = hereOf((l) => l.pickups);
  if (!here.length) return;
  const me = playerSprite();
  const mine = me
    ? { left: me.left, top: me.top, right: me.left + me.f.width, bottom: me.top + me.f.height }
    : playerBox();
  const gone: Pickup[] = [];
  for (const q of here) {
    q.clock += TICK_SCALE;
    if (gone.length) continue;
    // `0x434140` against the pickup's own RECORD rect, which is what the creator
    // filed at `user+4` — the art is only what is drawn
    if (!overlaps(mine, q))
      continue;
    const kind = PICKUP.kinds[q.code];
    // ...and then `0x40e680`, which is the art. See {@link spritesTouch}.
    const loc = player.byId.get(kind.cels[loopIndex(kind, q.clock)]);
    const pf = loc === undefined ? null : playerFrame(loc);
    if (
      pf &&
      me &&
      !spritesTouch(me, {
        f: pf,
        left: q.x - pf.posXraw,
        top: q.y - pf.posYraw,
        mirror: false,
      })
    )
      continue;
    gone.push(q);
    // at the PLAYER's point (`[0x4ac3d4]+6`), and each character plays its own
    if (character === 1) sound?.own(kind.bones.sound, p.x, p.y, kind.bones.way);
    else sound?.own(kind.sound, p.x, p.y);
    if (q.code === "-1")
      stats.health = Math.min(stats.maxHealth, stats.health + PICKUP.health);
    else if (q.code === "-2")
      stats.lives = Math.min(PICKUP.maxLives, stats.lives + 1);
    else if (q.code === "-8") addClock(PICKUP.clock);
    else stats.score += PICKUP.score[q.code] ?? 0;
  }
  if (!gone.length) return;
  const i = lvl.rooms.indexOf(p.room!);
  lvl.pickups[i] = here.filter((q) => !gone.includes(q));
}

/**
 * Level nine's graves — `0x421040`, and there is no damage in it anywhere.
 *
 * Shut, it DRAWS you in: while your point is inside its rect and you are on your
 * feet, `0x4210bd` takes your distance from its point less half the rect's width
 * less one, and `0x42f8b0` pushes you TOWARD its point by that much every frame
 * (`0x4210f7`: +1 when you are west of it), with `0136 grave pull`. Come within a
 * hundred pixels of its point and it arms; still within a hundred the next frame,
 * it halves your speed and adds one to your fall once, and opens — `0x4704e8`,
 * ten cels. Eighty-six pixels below its point during those ten frames,
 * `0x402fa0(5)` ends the life. Then it stands open with a lid across it, and
 * does nothing more.
 *
 * So it is a hole and it behaves like one, which is the only thing in the game
 * that kills without a blow.
 */
export function stepHoles(): void {
  const here = hereOf((l) => l.holes);
  if (!here.length || !player) return;
  // Every one of this class's tests is against the player's POINT, which is the
  // ANCHOR: `0x421083` hands `[player+6]` to `0x434200` and `0x421211` subtracts
  // the grave's own `[esi+6]` from it. This page's `p.y` is the FEET, 112 below
  // the anchor when standing, and putting the feet into those comparisons made
  // level nine unplayable — the ground beside a grave is about 112 below the
  // grave's point, so `feet - point` already cleared `0x56` while merely walking
  // past, and every grave killed you on approach. See {@link poseFeet}.
  const py = p.y - p.feet;
  for (const h of here) {
    const dx = Math.abs(p.x - h.x);
    if (h.state === "shut") {
      // `0x421083`..`0x42113a`: only on your feet — `0x4210a7` lets a jump
      // (player kind 3) and anything off the ground straight past
      if (
        p.onGround &&
        p.x >= h.left &&
        p.x < h.right &&
        py >= h.top &&
        py < h.bottom
      ) {
        const half = Math.trunc(Math.abs(h.right - h.left) / 2);
        const pull = Math.abs(Math.trunc(dx) - half - 1) * (p.x <= h.x ? 1 : -1);
        p.vx += roundAway(pull / DIVISOR);
        sound?.effect(FOE_SFX.gravePull, h.x, h.y);
      }
      // `0x421151`: inside a hundred, tag 1
      if (dx < HOLE.nearPx) h.state = "near";
      continue;
    }
    if (h.state === "near") {
      // `0x421189`: out past a hundred again and it is shut
      if (dx > HOLE.nearPx) {
        h.state = "shut";
        continue;
      }
      // `0x4211af` and `0x4211c4` — half your speed away and one more unit of
      // fall, this once
      p.vx = p.vx / 2;
      p.vyRaw += HOLE.pullPerFrame;
      if (py - h.y > HOLE.soundBelowPx) sound?.effect(HOLE.openSound, h.x, h.y);
      h.state = "opening";
      h.clock = 0;
      continue;
    }
    if (h.state !== "opening") continue;
    // `0x42120c` — `0x402fa0(5)`, which is a DEATH and not a subtraction. There
    // is no health in this class at all, so it goes down the same path falling
    // out of the world does, whatever the damage switch says. And the ground
    // beside a grave is already 98 below its point, so standing there when one
    // opens is the whole of it: you have to be in the air over it.
    if (py - h.y > HOLE.deathPx && p.act !== "dying" && !film && !h.taken) {
      h.taken = true;
      // `0x421239` — `0x402fa0` opens with `0x402df0`: every key dropped
      dropKeys();
      sound?.effect(FOE_SFX.graveTake, h.x, h.y);
      died();
    }
    h.clock += 1;
    if (h.clock < HOLE.opening.cels.length * HOLE.opening.hold) continue;
    // `0x421263`: the opening ends — `0x421470` lays the lid across the pit as a
    // platform record of the engine's own table, and kind 2 has no handler
    h.state = "open";
    layGraveLid(h);
  }
}

/**
 * `0x421470`'s record, appended to the room's platforms: two hundred wide across
 * the grave's point, from 0x4c to 0x7e below it (`0x421285`..`0x4212a0`).
 */
export function layGraveLid(h: Hole): void {
  const lvl = level;
  const room = p.room;
  if (!lvl || !room || h.lid) return;
  const solids = lvl.solids[lvl.rooms.indexOf(room)];
  const like = solids?.platforms[0] ?? lvl.sbk.entities.find((e) => e.isEntity);
  if (!solids || !like) return;
  h.lid = true;
  solids.platforms.push({
    ...like,
    name: "platform",
    top: h.y + HOLE.lid.top,
    left: h.x - HOLE.lid.halfWidth,
    bottom: h.y + HOLE.lid.bottom,
    right: h.x + HOLE.lid.halfWidth,
    pointY: h.y + HOLE.deathPx,
    pointX: h.x,
  });
}

/** which cel a grave is showing */
export function holeCel(h: Hole): number {
  // `0x4704d0`'s two tags are both 3310
  if (h.state === "shut" || h.state === "near") return HOLE.shut;
  if (h.state === "open") return HOLE.open;
  return HOLE.opening.cels[
    Math.min(
      HOLE.opening.cels.length - 1,
      Math.floor(h.clock / HOLE.opening.hold),
    )
  ];
}

/**
 * ...and the hands between them — `0x420c60`, which is the record's rect and
 * nothing else. The player's point goes in, one of the two sizes is rolled and
 * it comes up; it holds for `0x4704b8`'s thirty frames a cel; it goes back down
 * when the point leaves.
 *
 * Its blow is a CODE (−3 or −7) rather than a number, so nothing here is hurt by
 * one. See {@link HAND}.
 */
export function stepHands(): void {
  const here = hereOf((l) => l.hands);
  if (!here.length) return;
  // `0x434200` against the player's own POINT, which is the anchor — the feet
  // stand below every rect in the file (see `poseFeet`)
  const ay = p.y - p.feet;
  for (const q of here) {
    const kind = q.underfoot ? HAND.underfoot : HAND.anywhere;
    // `0x434200` is inclusive low, exclusive high on both axes
    const inside =
      p.x >= q.left && p.x < q.right && ay >= q.top && ay < q.bottom;
    q.clock += 1;
    if (q.state === "down") {
      // `0x420ca9` — it only comes up under someone standing on the ground
      if (!inside || !p.onGround) continue;
      q.state = "up";
      q.clock = 0;
      sound?.effect(HAND.sound, q.x, q.y);
      if (q.underfoot) {
        // `0x420ce7` and `0x420d1b`: your own x, and two above your feet
        q.atX = p.x;
        q.atY = p.y - 2;
      } else {
        // `0x420d4b` — anywhere across its own rect, at the record's own height
        q.atX = q.left + roll(Math.max(1, q.right - q.left));
        q.atY = q.y;
      }
    } else if (q.state === "up") {
      if (q.clock >= kind.up.cels.length * kind.up.hold) {
        q.state = "held";
        q.clock = 0;
      }
    } else if (q.state === "held") {
      /**
       * `0x4704b8`'s thirty frames, and having hold of you does not extend them:
       *
       * ```
       *   420dbf  cmp [esi+0x46], 0    ; the script ended
       *   420dc4  jne 0x420ddc         ; ...then SINK, whatever else is true
       *   420dc6  cmp [esi+0x48], 0x14 ; fewer than 20 frames left of the cel
       *   420dd1  cmp [esi+0x2a], 0    ; and nothing rebounded off it: SINK
       * ```
       *
       * `obj+0x2a` is set only by `0x430663`, on a positive blow, so for the
       * underfoot hand the second test always passes and it sinks on the frame
       * `obj+0x48` drops under 20 — eleven frames in. The other hand
       * (`0x420e54`) tests only the end and `obj+0x2a`, so it holds all thirty.
       * What lets go of you is the fist opening — which is the same thing
       * {@link gripOf} reads, from the other side.
       */
      const hold = q.underfoot
        ? HAND.holdFrames - HAND.underfootLeft + 1
        : HAND.holdFrames;
      if (q.clock >= hold) {
        q.state = "sinking";
        q.clock = 0;
      }
    } else if (q.clock >= kind.down.cels.length * kind.down.hold) {
      q.state = "down";
      q.clock = 0;
    }
  }
}

/**
 * While something has hold of you: ride its grip, or be let go.
 *
 * `0x428080`'s kind-10 case, once a frame. It re-reads the GRABBER's current cel
 * every frame rather than remembering anything about the grab, which is what
 * makes this so short: the hold is wherever the art says it is this frame, and
 * the frame the art stops saying is the frame you are free.
 *
 * ```
 *   42857d  the grabber's current cel record
 *   4285b8  cmp [0x4a693a], ax    ; x0 == x1 -> let go
 *   428660  x = x1 + (x0 - x1) / 2
 *   428689  y = y0 + (y1 - y0) / 2
 *   4286bb  P, and only from tag 0 -> the struggle
 * ```
 *
 * Letting go restores gravity (`0x4285ec`) and stands the player back up
 * (`0x4285db` writes 1 into `obj+0x34`); nothing gives any health back, because
 * a grab never took any.
 */
export function stepHeld(): void {
  if (!p.heldBy) return;
  const at = p.heldBy();
  if (!at) {
    // `0x4285c1` — out through the walk's own script, and `0x4285db` writes 1
    // into `obj+0x34` on the way: the player is SETTLED again, not dropped from
    // wherever the grip had them. This page said so in the comment and did not
    // do it, which is how SEWER's hall of lifts ended a grab: released a pixel
    // above its own walkway, still flagged airborne, the player fell straight
    // through the one-way platform into the sewage under it. Standing them up
    // is not a free pass — the gait's own `surfaceUnder` runs next and puts
    // them back in the air if there is nothing within `STICK_PX` of their feet,
    // which is what a grab over a pit wants.
    p.heldBy = null;
    p.heldWhat = null;
    p.gravityScale = 1;
    p.act = null;
    p.heldClock = 0;
    p.onGround = true;
    return;
  }
  p.x = at.x;
  // the grip is an ANCHOR point and `p.y` is the feet — see {@link poseFeet}
  p.y = at.y + p.feet;
  p.vx = 0;
  p.vy = 0;
  p.vyRaw = 0;
  p.onGround = false;
  p.heldClock += 1;
  // `0x4286cf`: P restarts the struggle, but only from the loop — mashing it
  // does not stack, and nothing in the state shortens the hold
  if (punchPressed && p.act === "held") {
    p.act = "struggle";
    p.actClock = 0;
  }
}

/** which cel a hand is showing, or 0 while it is under the ground */
export function handCel(q: Hand): number {
  const kind = q.underfoot ? HAND.underfoot : HAND.anywhere;
  if (q.state === "down") return 0;
  if (q.state === "held") return kind.hold;
  const a = q.state === "up" ? kind.up : kind.down;
  return a.cels[Math.min(a.cels.length - 1, Math.floor(q.clock / a.hold))];
}

/**
 * The swinging blades — `0x423d00`, which is three tags handed round in a ring
 * and nothing else. Twenty-seven cels, one engine frame each, and the blow is a
 * hundred on every one of them.
 */
export function stepAxes(): void {
  for (const a of hereOf((l) => l.axes)) {
    const was = Math.floor(a.clock) % AXE.swing.length;
    a.clock += 1;
    const now = Math.floor(a.clock) % AXE.swing.length;
    // `0x423d9a` — the sound is at the seam where tag 2 hands back to tag 0
    if (now === AXE.soundAt && was !== AXE.soundAt)
      sound?.effect(AXE.sound, a.x, a.y);
  }
}

/** which cel a blade is showing */
export function axeCel(a: Axe): number {
  return AXE.swing[Math.floor(a.clock) % AXE.swing.length];
}

/**
 * ...and the rope bridges — `0x422370`. Standing on one for more than five
 * engine frames, or landing on one from more than a hundred pixels up, starts
 * it; after that it rocks, falls and is gone, and the gap it was over is a gap.
 */
export function stepBridges(): void {
  const here = hereOf((l) => l.bridges);
  if (!here.length) return;
  // `0x4223ac`..`0x4223ef` test the player's POINT, which is the anchor
  const ay = p.y - p.feet;
  for (const b of here) {
    if (b.state === "whole") {
      const on =
        p.x > b.left &&
        p.x < b.right &&
        p.onGround &&
        b.y - ay < BRIDGE.reachPx &&
        b.y > ay;
      if (!on) continue;
      b.clock = 0;
      if (b.stood <= BRIDGE.standFrames && p.fallPx <= BRIDGE.fallPx) {
        b.state = "rocking";
        sound?.effect(FOE_SFX.bridgeCrack, b.x, b.y);
      } else b.state = "falling";
      continue;
    }
    b.clock += 1;
    if (b.state === "rocking") {
      // `0x42244f`: the rock ends, one more on the counter, and it is whole again
      if (b.clock >= BRIDGE.rocking.cels.length * BRIDGE.rocking.hold) {
        b.stood += 1;
        b.state = "whole";
        b.clock = 0;
      }
    } else if (b.state === "falling") {
      // `0x42249c`: the falling cels end — gravity 1.0, 0x35, and tag 1
      if (b.clock >= BRIDGE.falling.cels.length * BRIDGE.falling.hold) {
        b.state = "gone";
        b.clock = 0;
        b.vy = 0;
        sound?.effect(FOE_SFX.bridgeFall, b.x, b.y);
      }
    } else {
      // dropping, and the platform it owns goes down with it (`0x42fcb9`). The
      // mover moves by the velocity and then adds gravity (`0x43032b`)
      const dy = b.vy ?? 0;
      b.vy = dy + BRIDGE.gravity;
      if (dy === 0) continue;
      const lvl2 = level;
      const r = lvl2 ? lvl2.rooms.indexOf(p.room!) : -1;
      if (lvl2 && r >= 0)
        for (const q of lvl2.solids[r].platforms)
          if (
            b.x >= q.left &&
            b.x < q.right &&
            b.y >= q.top &&
            b.y < q.bottom
          ) {
            q.top += dy;
            q.bottom += dy;
          }
      b.y += dy;
      b.top += dy;
      b.bottom += dy;
    }
  }
}

/** which cel a bridge is showing */
export function bridgeCel(b: Bridge): number {
  if (b.state === "whole") return BRIDGE.whole;
  if (b.state === "gone")
    return BRIDGE.gone.cels[Math.min(BRIDGE.gone.cels.length - 1, Math.floor(b.clock))];
  const a = b.state === "rocking" ? BRIDGE.rocking : BRIDGE.falling;
  return a.cels[Math.min(a.cels.length - 1, Math.floor(b.clock / a.hold))];
}

/**
 * Level twelve's floors — `0x426f80`, which is level nine's grave told the
 * other way round: it waits for you to stand on it, creaks, caves in and falls
 * with the platform it owns, and then `0x402fa0` ends whoever is under it.
 * {@link FLOOR} has the tests.
 */
export function stepFloors(): void {
  const here = hereOf((l) => l.floors);
  if (!here.length) return;
  const ay = p.y - p.feet;
  for (const f of here) {
    const dx = Math.abs(p.x - f.x);
    f.clock += 1;
    if (f.state === "whole") {
      // `0x426fb0`: the player's point in the record's rect, on the ground
      if (
        p.x >= f.left &&
        p.x < f.right &&
        ay >= f.top &&
        ay < f.bottom &&
        p.onGround
      ) {
        f.state = "settling";
        f.clock = 0;
      }
      continue;
    }
    if (f.state === "settling") {
      if (dx > FLOOR.nearPx) {
        // `0x427017`: away, and the grace runs down; past it, whole again
        f.grace = (f.grace ?? FLOOR.grace) - 1;
        if (f.grace < 0) {
          f.state = "whole";
          f.grace = FLOOR.regrace;
        }
        continue;
      }
      if (f.clock < FLOOR.holdFrames) continue;
      f.state = "creaking";
      f.clock = 0;
      sound?.effect(FOE_SFX.floorCreak, f.x, f.y);
      continue;
    }
    if (f.state === "creaking") {
      if (f.clock < FLOOR.creaking.cels.length * FLOOR.creaking.hold) continue;
      f.clock = 0;
      if (dx < FLOOR.nearPx && Math.abs(ay - f.y) < FLOOR.nearY) {
        f.state = "caving";
        sound?.effect(FOE_SFX.floorCave, f.x, f.y);
      } else f.state = "settling";
      continue;
    }
    // kind 2. `0x4270f9`: on the third cel it takes gravity 3.0, and the mover
    // moves it by its velocity before adding the gravity (`0x43032b`)
    if (f.state === "caving" && f.clock >= FLOOR.caving.cels.length) f.state = "gone";
    if (f.clock >= 2 || f.vy !== undefined) {
      const dy = f.vy ?? 0;
      f.vy = dy + FLOOR.gravity;
      if (dy) {
        const lvl2 = level;
        const r = lvl2 ? lvl2.rooms.indexOf(p.room!) : -1;
        // ...with the platform it owns, `0x42fb70` at its point (`0x41f1a9`)
        if (lvl2 && r >= 0)
          for (const q of lvl2.solids[r].platforms)
            if (f.x >= q.left && f.x < q.right && f.y >= q.top && f.y < q.bottom) {
              q.top += dy;
              q.bottom += dy;
            }
        f.y += dy;
      }
    }
    // `0x427114`: every frame of kind 2, the player's point in the death zone
    if (
      p.x >= f.left &&
      p.x < f.right &&
      ay >= f.bottom + FLOOR.deathFrom &&
      ay < f.bottom + FLOOR.deathTo &&
      p.act !== "dying" &&
      !film
    ) {
      // `0x42713e` — `0x402fa0(1)`, and `0x402df0` before it drops every key
      dropKeys();
      died();
    }
  }
}

/** which cel a floor is showing */
export function floorCel(f: Floor): number {
  if (f.state === "whole" || f.state === "settling") return FLOOR.whole;
  if (f.state === "gone")
    return FLOOR.caving.cels.at(-1)!;
  const a = f.state === "creaking" ? FLOOR.creaking : FLOOR.caving;
  return a.cels[Math.min(a.cels.length - 1, Math.floor(f.clock / a.hold))];
}

/**
 * ...and the surges, which are the only hazard in the game that gives you
 * something — `0x426a70`, and {@link SURGE} has it. The lightning's counter
 * switches them on ({@link stepLights}); each runs down its column and goes off.
 */
export function stepSurges(): void {
  const all = level?.surges.flat() ?? [];
  if (!all.length) return;
  const ay = p.y - p.feet;
  for (const q of all) {
    q.clock += 1;
    if (!q.on) continue;
    // `0x426a88`..`0x426ab3` — every frame it is on, `0134 surge` armed to
    // loop and played at the arc: one looping voice the mixer keeps, moved
    // down the column as the arc hops
    sound?.loop(SURGE.sound, true);
    sound?.effect(SURGE.sound, q.x, q.y);
    // `0x426ad4`..`0x426b27`: the scepter in hand, near the arc — thirteen rounds
    if (
      // (`0x402ee0` is `0x448bf0` for this character — OUT, not just carried)
      inv.drawn &&
      inv.weapon === SURGE.weapon &&
      p.x >= q.left - SURGE.reachX &&
      p.x < q.right + SURGE.reachX &&
      ay >= q.top &&
      ay < q.bottom &&
      Math.abs(ay - q.y) < SURGE.reachY
    )
      loadRounds(SURGE.weapon, SURGE.rounds);
    // `0x426b2c`: the six cels end — hop down, or go off and back to the top
    if (q.clock < SURGE.arc.cels.length * SURGE.arc.hold) continue;
    if (Math.abs(q.bottom - SURGE.hop) > q.y) {
      q.clock = 0;
      q.y += SURGE.hop;
    } else {
      q.on = false;
      q.y = q.top;
      // `0x426b66` — the loop let go as it goes off
      sound?.loop(SURGE.sound, false);
    }
  }
}

/**
 * The lightning's counter reaching its wrap switches every surge on
 * (`0x42682b`), and the arc starts from the top of its run.
 */
export function switchSurgesOn(): void {
  for (const q of level?.surges.flat() ?? []) {
    // its script ran out long ago, so the next think hops at once (`0x426b2c`)
    q.on = true;
  }
}

/**
 * Which cel a surge is showing. Off, its script has run out on its last cel —
 * nothing reinstalls it (`0x426a7e`) — and it stands there at the top.
 */
export function surgeCel(q: Surge): number {
  return SURGE.arc.cels[
    Math.min(SURGE.arc.cels.length - 1, Math.floor(q.clock / SURGE.arc.hold))
  ];
}

/**
 * MAZE's cage doors, alarms and fans — three classes that keep their own time.
 *
 * `0x413100` is the whole of a cage door: the two moving tags hand over as they
 * end, and the shutting one calls `0x411460`, which appends its rect to the
 * engine's obstacle table. That is the only thing that makes it solid, and it is
 * the same table the level's own `obstacle` records fill.
 */
export function stepCages(): void {
  const lvl = level;
  if (!lvl) return;
  for (const c of lvl.cages.flat()) {
    if (c.state === "shut" || c.state === "open") continue;
    c.clock += 1;
    const a = c.state === "opening" ? CAGE.opening : CAGE.closing;
    if (c.clock < a.cels.length * a.hold) continue;
    c.state = c.state === "opening" ? "open" : "shut";
    c.clock = 0;
    if (c.state === "shut") sound?.effect(CAGE.sound, c.x, c.y);
  }
}

/** which cel a cage door is showing, or 0 for the open tag — which draws nothing */
export function cageCel(c: Cage): number {
  if (c.state === "shut") return CAGE.shut;
  if (c.state === "open") return 0;
  const a = c.state === "opening" ? CAGE.opening : CAGE.closing;
  return a.cels[Math.min(a.cels.length - 1, Math.floor(c.clock / a.hold))];
}

/**
 * What a lever's throw broadcasts, and there are two of them.
 *
 * `0x43c3d0` takes a `param` of 500 or more and flips every goop that carries
 * it. `0x43c430` takes one under 500 and flips every DOOR that carries it: a
 * shut one starts opening, an open one starts shutting, and a door already
 * moving is left alone. Level six's levers are all in the first range and level
 * seven's are all in the second, which is why each level has exactly one of the
 * two behaviours.
 */
export function broadcast(param: number): void {
  const lvl = level;
  if (!lvl) return;
  if (param >= 500) {
    for (const n of lvl.nests.flat()) {
      if (n.param !== param) continue;
      n.on = !n.on;
      // `0x43c3f8` — through `0x40f090`, the mixer's channel 0, so of a
      // broadcast that reaches several only the last is heard
      sound?.effect(SWITCH.toggle, (n.left + n.right) / 2, n.top, "lead");
    }
    return;
  }
  /**
   * ...and both lists are the LEVEL's, not the room's. The engine holds one
   * linked list per class for the whole stage, and `0x43c430` walks the lot —
   * which is the point of level seven's levers: four of its five stand in a
   * different region from the door they open, and the last of them is two rooms
   * and a shaft away from it.
   */
  // ...and MAZE's seven cage doors take the same broadcast, out of the same
  // range: its switches carry 1, 2, 3, 4 the way SEWER's carry -1, 2, 7, 8, -4
  // — chapter two's own broadcast, `0x413410`, which sounds 0x21 at each cage
  // it turns (`0x413440`, `0x413457`)
  for (const c of lvl.cages.flat()) {
    if (c.param !== param) continue;
    if (c.state === "shut") {
      c.state = "opening";
      c.clock = 0;
      sound?.effect(CAGE.toggle, c.x, c.y);
    } else if (c.state === "open") {
      c.state = "closing";
      c.clock = 0;
      sound?.effect(CAGE.toggle, c.x, c.y);
    }
  }
  // `0x43c430` sounds 0x24 at each door it turns (`0x43c460`, `0x43c477`),
  // through `0x40f090` — channel 0 again
  for (const d of lvl.doors.flat()) {
    if (d.param !== param) continue;
    if (d.state === "shut") {
      d.state = "opening";
      d.clock = 0;
      sound?.effect(SWITCH.toggle, d.x, d.y, "lead");
    } else if (d.state === "open") {
      d.state = "closing";
      d.clock = 0;
      sound?.effect(SWITCH.toggle, d.x, d.y, "lead");
    }
  }
}
