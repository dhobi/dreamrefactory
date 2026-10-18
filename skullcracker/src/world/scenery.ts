/**
 * The scenery that steps on its own: roaches, sprinkler columns, barrels,
 * doors and elevators, the goop and its drips, the I-beams and the crows.
 */
import { SbkCel, SbkFile } from "@dreamfactory/engine/df/sbk";
import { FOES, loopIndex } from "../foes";
import { TICK_SCALE, type Enemy } from "../brains/kit";
import { FOE_SFX } from "../sound";
import { CROW, Crow, IBEAM, Ibeam, Feather, crowCel, crowFrames, crowTag, type CrowState, ibeamFrames, SPRINKLER, shackFrames, BARREL, Barrel, SEWAGE, ROACH, SPILL, Roach, DOOR, doorFrames, ELEV, Elev, Switch, GOOP, Drip, dripCel, dripFrames } from "../props";
import { CLOCK } from "../hud";
import { random } from "../random";
import { p, sound, level, damageOn } from "./state";
import { roundAway, CLIMB_PX, STICK_PX, PLAYER_GRAVITY, dragged } from "./motion";
import { celRec, celOf } from "./cels";
import { roll, hereOf, spawnedHere, groundAt, surfaceUnder } from "./rooms";
import { rallyFall, hurtBox, strikeOf, stats } from "./blows";
import { takeHealth } from "./hurt";
import { switchesHere, nestsHere } from "./fixtures";
import { overlaps } from "./box";

/**
 * How long this level gives you, and it was in the books all along.
 *
 * Every chapter's entry function ends with the same block — `0x421e60` is
 * chapter three's, and `0x4164a2`, `0x43be72` and `0x451582` are its three
 * siblings. It asks the book for its `timer` records, and:
 *
 * ```
 *   421e8f  mov  eax, [esp]        ; the first record, and +0 is its PARAM
 *   421e94  call 0x40d340          ; -> [0x4a3b18], the dial's full scale
 *   421e99  mov  eax, [esp+4]      ; esp moved: the SAME dword again
 *   421ea1  call 0x40d350          ; -> [0x4a4d68], the clock itself
 *   421ead  push 0x7d00            ; no record at all: both get 32000
 * ```
 *
 * So one number does both, and it is the record's own `param`. Eleven books
 * carry one and five do not, and the five that do not have **no time limit** —
 * `0x40d250` reads 32000 as "no dial". Which is exactly the five you would
 * expect: PLAYGR and ARCADE, whose bosses the level waits for, and CAVERN,
 * TOWER and VAT.
 *
 * ```
 *   streets 4000   city 8200   woods 7200   playgr    —
 *   mall    5220   service 5300  sewer 7200  arcade   —
 *   grave   2100   cavern   —   ravecave 2500  tower  —
 *   maze    3200   barrel 8200  lab 2500    vat      —
 * ```
 *
 * The full dial, `CLOCK_FULL`, is 7200 — right only for WOODS and SEWER.
 */
export function clockFor(sbk: SbkFile): number {
  const rec = sbk.entities.find((e) => e.name === "timer");
  return rec ? rec.param : CLOCK.noLimit;
}

/** every roach in the air or on the floor, nest or no nest */
export let roaches: Roach[] = [];

/** `0x4423a0(point, n)` — kragg's roaches, see {@link SPILL} */
export function spillRoaches(at: { x: number; y: number }, n: number): void {
  const room = p.room;
  if (!room) return;
  for (let i = 0; i < n; i++) {
    const facing = roll(2) === 1 ? 1 : -1;
    roaches.push({
      x: at.x + roll(SPILL.across),
      y: at.y - roll(SPILL.up),
      // the leap's one frame is spent through the divisor as it goes on
      vy: SPILL.rise[0] - roll(SPILL.rise[1]) + roundAway(SPILL.leap.dy / ROACH.divisor),
      facing,
      onGround: false,
      running: false,
      clock: 0,
      top: room.top,
      left: room.left,
      bottom: room.bottom,
      right: room.right,
      spilled: {
        vx: SPILL.speed[0] + roll(SPILL.speed[1]) + roundAway(SPILL.leap.dx / ROACH.divisor) * facing,
      },
    });
  }
}

/** which of the seven slots has water standing in it, and engine frames since it rose */
export let columns = new Map<number, number>();
/** `0x473728` — every slot that has ever gone up this level; never cleared */
export let raised = new Set<number>();

/**
 * `0x441b20` and `0x441b60` — send up the sprinkler the boss is standing over.
 *
 * The test is on the BOSS's own point, not the player's: `0x40b660` asks which
 * `initsprinkler` record's rect contains it and hands back that record's `param`,
 * which is its slot. If the slot is already taken `0x441b60` rolls
 * `0x434540(7)` for another and tries up to seven times, so a boss that keeps
 * diving into the same corner still fills the room.
 *
 * And it is not free to it: `0x440bf9` takes **three health a frame** off the
 * boss for standing in water that is already up, which is the whole tactic of
 * level eight.
 */
export function raiseSprinkler(e: Enemy): void {
  const all = hereOf((l) => l.sprinklers);
  if (!all.length) return;
  const over = all.find(
    (q) => e.x >= q.left && e.x < q.right && e.y >= q.top && e.y < q.bottom,
  );
  if (!over) return;
  const up = (slot: number): void => {
    raised.add(slot);
    columns.set(slot, 0);
  };
  if (!raised.has(over.slot)) return up(over.slot);
  // `0x441b7a`: it has gone up before, so roll `0x434540(7) - 1` for another
  // slot and try up to seven times
  for (let i = 0; i < SPRINKLER.slots; i++) {
    const slot = roll(SPRINKLER.slots) - 1;
    if (raised.has(slot) || !all.some((q) => q.slot === slot)) continue;
    return up(slot);
  }
}

/**
 * Step the water — `0x473748`'s own three tags, and what standing in one costs.
 *
 * A column rises through seven cels, sprays while its context's own `0x15e`
 * frames run down, and goes. The boss pays three health a frame for being in one
 * (`0x440bf9`); the player pays nothing — the column is never armed (`obj+0x1a`
 * stays at `0x42f550`'s 0, so `0x430367` skips it), its cels carry no strike box,
 * and nothing else in SC.EXE reads the sprinkler tables (`0x4a7000` is read only
 * by `0x440800`, the slots at `0x473728` only by `0x440bb0` and `0x441b60`).
 */
export function stepColumns(): void {
  const all = hereOf((l) => l.sprinklers);
  /**
   * ...and the boss's own hum, in the same prologue (`0x440b8e`, states 1..9):
   * `0x441b20` finds no sprinkler rect around its point and it arms and plays
   * `0x17` (`0x440c81`..`0x440ca2`), a loop the mixer keeps and each frame
   * moves. Over a sprinkler that is down it asks nothing that frame; over one
   * that is up it is the scald below.
   */
  for (const e of spawnedHere()) {
    const foe = FOES[e.kind];
    if (e.state === "dead" || e.rallied || !foe.drives?.raises || !foe.rallies) continue;
    if (Math.floor(e.clock) === Math.floor(e.clock - TICK_SCALE)) continue;
    if (all.some((q) => e.x >= q.left && e.x < q.right && e.y >= q.top && e.y < q.bottom)) continue;
    sound?.loop(FOE_SFX.kraggFlies, true);
    sound?.effect(FOE_SFX.kraggFlies, e.x, e.y);
  }
  if (!all.length && !columns.size) return;
  const gone: number[] = [];
  for (const [slot, clock] of columns) {
    const next = clock + TICK_SCALE;
    if (next >= SPRINKLER.life + SPRINKLER.sink.cels.length * SPRINKLER.sink.hold)
      gone.push(slot);
    else columns.set(slot, next);
  }
  for (const slot of gone) columns.delete(slot);
  if (!raised.size) return;
  /**
   * ...and three a frame off the boss standing in one — `0x440b99`.
   *
   * Asked in kragg's prologue for states 1..9 only (`0x440b8e`), so in its
   * flinches and the flare's thrash as much as on the wing, and never once it
   * is down: the fall and the ground form are 10 and up, which is
   * {@link Enemy.rallied} here. `0x441b20` names the one rect it is in and
   * `[0x473728 + 4n]` says whether that one is up; if so, two sparks, 0x14, and
   * `0x440bf9` takes three. The frame that takes it BELOW zero (`jns`) is the
   * fall, not a death — {@link rallyFall}, the scald's own way (`0x440c07`).
   */
  for (const e of spawnedHere()) {
    const foe = FOES[e.kind];
    if (e.state === "dead" || e.rallied || !foe.drives?.raises || !foe.rallies)
      continue;
    const lit = [...raised].some((slot) => {
      const q = all.find((w) => w.slot === slot);
      return (
        !!q && e.x >= q.left && e.x < q.right && e.y >= q.top && e.y < q.bottom
      );
    });
    if (!lit) continue;
    if (Math.floor(e.clock) !== Math.floor(e.clock - TICK_SCALE))
      sound?.effect(FOE_SFX.kraggScald, e.x, e.y);
    e.hp -= 3 * TICK_SCALE;
    if (e.hp < 0) rallyFall(e, foe.rallies, true);
  }
}

/** which cel a standing column is showing: rise, spray, and going */
export function columnCel(clock: number): number {
  const up = SPRINKLER.rise.cels.length * SPRINKLER.rise.hold;
  if (clock >= SPRINKLER.life)
    return SPRINKLER.sink.cels[
      Math.min(
        SPRINKLER.sink.cels.length - 1,
        Math.floor((clock - SPRINKLER.life) / SPRINKLER.sink.hold),
      )
    ];
  if (clock < up)
    return SPRINKLER.rise.cels[Math.floor(clock / SPRINKLER.rise.hold)];
  const i =
    Math.floor((clock - up) / SPRINKLER.spray.hold) %
    SPRINKLER.spray.cels.length;
  return SPRINKLER.spray.cels[i];
}

/**
 * Step the six pieces of scenery that do something.
 *
 * Each is one paragraph of its own class's think, and the addresses are in
 * {@link file://../props.ts}. None of them can be hit and none of them is in any
 * level's census; what they are is the difference between a room and a corridor.
 */
export function stepScenery(): void {
  const ay = p.y - p.feet;
  const inRect = (r: {
    top: number;
    left: number;
    bottom: number;
    right: number;
  }): boolean => p.x >= r.left && p.x < r.right && ay >= r.top && ay < r.bottom;

  // `0x453a60`: shut until your point is inside, then up; and down again only
  // once the opening has finished AND you have gone
  for (const k of hereOf((l) => l.shacks)) {
    if (k.state === "shut") {
      if (inRect(k)) {
        k.state = "opening";
        k.clock = 0;
      }
      continue;
    }
    k.clock += TICK_SCALE;
    if (k.clock < shackFrames(k)) continue;
    if (k.state === "opening") {
      if (inRect(k)) {
        // `0x453ace`: still there, so it stays up
        k.clock = shackFrames(k) - 1;
        continue;
      }
      k.state = "closing";
      k.clock = 0;
    } else {
      k.state = "shut";
      k.clock = 0;
    }
  }

  // `0x43fc30` once an engine frame, then the script's impulses, then the mover's
  // share of the frame each tick — see {@link BARREL}
  for (const b of hereOf((l) => l.barrels)) {
    const wasX = b.x;
    const wasY = b.y;
    b.clock += TICK_SCALE;
    if (Math.floor(b.clock) !== Math.floor(b.clock - TICK_SCALE)) barrelFrame(b, ay);
    // the mover (`0x42fd80`): no gravity, no drag, and a floor that rises more
    // than 50 above its foot is a wall — the move is undone, the vertical speed
    // zeroed and the horizontal kept to a quarter (`0x42fef3`), and it has
    // bounced
    const rec = level ? celRec(level.sbk, barrelCel(b)) : undefined;
    const foot = rec ? rec.height - rec.posY : 0;
    const nx = b.x + b.vx * TICK_SCALE;
    const g = groundAt(nx);
    if (g !== null && g + 50 < b.y + foot) {
      b.vy = 0;
      b.vx = Math.trunc(b.vx / 4);
      b.bounced = true;
    } else b.x = nx;
    b.y += b.vy * TICK_SCALE;
    if (b.floor) {
      b.floor.left += b.x - wasX;
      b.floor.right += b.x - wasX;
      b.floor.top += b.y - wasY;
      b.floor.bottom += b.y - wasY;
    }
  }

  for (const q of hereOf((l) => l.pipes)) q.clock += TICK_SCALE;

  // `0x4404c0`: the splash going in, the gulp every ninth frame, and the health
  // — which only leaves when the switch that lets things hit back is on
  for (const w of hereOf((l) => l.sewage)) {
    if (!inRect(w)) {
      w.clock = SEWAGE.gulpEvery;
      continue;
    }
    if (p.vy / TICK_SCALE > SEWAGE.splashAbove)
      sound?.effect(SEWAGE.splash, p.x, p.y);
    w.clock -= TICK_SCALE;
    if (w.clock <= 0) {
      w.clock = SEWAGE.gulpEvery;
      sound?.effect(SEWAGE.gulp, p.x, p.y);
    }
    if (damageOn && p.act !== "dying") takeHealth(SEWAGE.perFrame * TICK_SCALE);
  }

  // `0x43b3a4`: four in a rush while you are standing in the rect, and then a
  // little over two seconds of nothing
  for (const n of hereOf((l) => l.nests2)) {
    if (!inRect(n)) continue;
    n.clock += TICK_SCALE;
    if (n.clock <= -2) continue;
    n.made += 1;
    roaches.push({
      x: n.x,
      y: n.y,
      vy: 0,
      facing: random() < 0.5 ? 1 : -1,
      onGround: false,
      running: false,
      clock: 0,
      top: n.top,
      left: n.left,
      bottom: n.bottom,
      right: n.right,
    });
    if (n.made >= ROACH.burst) {
      n.clock = -ROACH.gapOut;
      n.made = 0;
    } else n.clock = roll(ROACH.gapIn) - ROACH.gapIn;
  }
  for (const r of roaches) {
    r.clock += TICK_SCALE;
    if (r.running) {
      // the run carries `dx 65` on every one of its four cels, and the mover
      // spends it on the ground and off it alike
      const i = loopIndex(ROACH.run, r.clock);
      r.x += ((ROACH.run.dx[i] ?? 0) / ROACH.divisor) * TICK_SCALE * r.facing;
    }
    if (r.onGround) {
      const floor = surfaceUnder(r.x, r.y - CLIMB_PX, r.y + STICK_PX);
      if (floor !== null) {
        r.y = floor;
        continue;
      }
      // off the end of a ramp: the 0.6 gravity `0x43b1be` gave it is the
      // object's own and the mover spends it whenever there is no floor
      r.onGround = false;
    }
    r.vy += PLAYER_GRAVITY * (r.spilled ? SPILL.gravity : ROACH.gravity) * TICK_SCALE;
    r.y += r.vy * TICK_SCALE;
    // a spilled one carries its own speed across until it lands ({@link SPILL})
    if (r.spilled) r.x += r.spilled.vx * TICK_SCALE;
    const floor = surfaceUnder(
      r.x,
      r.y - Math.max(r.vy, 0) - CLIMB_PX,
      r.y + STICK_PX,
    );
    if (floor === null || r.y < floor) continue;
    r.y = floor;
    r.vy = 0;
    r.onGround = true;
    if (r.running) continue;
    // `0x43b17f` waits for the ground before the run starts at all: tag 0 of
    // `0x474db0`, which plays the run sound as it starts
    r.running = true;
    r.clock = 0;
    // ...where a spilled one lands out of tag 2 and starts it silently
    // (`0x43b35c`), and the run's own stride takes over from its speed
    if (r.spilled) r.spilled.vx = 0;
    else sound?.effect(ROACH.runSound, r.x, r.y);
  }
  // `0x43b1e8`: it removes itself the frame its own point leaves the rect
  roaches = roaches.filter(
    (r) =>
      r.x >= r.left &&
      r.x <= r.right &&
      r.y >= r.top - 200 &&
      r.y <= r.bottom + 200,
  );
}

/** the script a barrel is on, as {@link BARREL} names them */
export function barrelScript(b: Barrel): (typeof BARREL)["bob" | "wobble" | "sink"] {
  if (b.tag === "wobble") return BARREL.wobble;
  return b.tag === "sink" ? BARREL.sink : BARREL.bob;
}

/** which cel a barrel is showing — its class's own 3180 while its delay runs */
export function barrelCel(b: Barrel): number {
  if (b.tag === "none") return BARREL.bob.cels[0];
  const s = barrelScript(b);
  return s.cels[Math.min(s.cels.length - 1, Math.floor(b.aclock / s.hold))];
}

/** start one of a barrel's scripts (`0x45d090`) */
export function barrelInstall(b: Barrel, tag: "bob" | "wobble" | "sink"): void {
  b.tag = tag;
  b.aclock = 0;
}

/**
 * One engine frame of a barrel: `0x43fc30`, and then what the animation stepper
 * adds (`0x45d0f0` → `0x42f8b0`: the shown cel's dx, flipped by `obj+0x28`, and
 * dy, each over the divisor of 10 and rounded away from zero).
 */
export function barrelFrame(b: Barrel, ay: number): void {
  const think = (): void => {
    // `0x43fc39`: the delay, with no script at all
    if (b.wait > 0) {
      b.wait -= 1;
      if (b.wait === 0) {
        barrelInstall(b, "bob");
        b.wait = BARREL.rest;
      }
      return;
    }
    if (b.bounced) b.mirror = !b.mirror;
    b.vx = Math.max(-BARREL.drift, Math.min(BARREL.drift, b.vx));
    if (b.y < b.top) b.y = b.top + BARREL.inset;
    else if (b.bottom < b.y) b.y = b.bottom - BARREL.inset;
    // `0x43fcce`: the record's rect, carried by how far the barrel is from its point
    const ox = b.x - b.homeX;
    const on =
      p.x < b.right + ox &&
      p.x > b.left + ox &&
      b.y - ay < BARREL.reach &&
      b.y - ay > 0;
    const s = barrelScript(b);
    const ended = b.aclock >= s.cels.length * s.hold;
    if (b.tag === "bob") {
      if (on && b.sinker) {
        const was = b.wait;
        b.wait += 1;
        if (was >= BARREL.wobbleAt) {
          b.vy = 0;
          barrelInstall(b, "wobble");
          return;
        }
      }
      if (ended) barrelInstall(b, "bob");
    } else if (b.tag === "sink") {
      // `0x43fd99`: down and along, whatever the mover does
      b.y += BARREL.sinkStep;
      b.x += b.mirror ? -BARREL.sinkStep : BARREL.sinkStep;
      if (ended) {
        b.y = b.homeY;
        barrelInstall(b, "bob");
      }
    } else if (b.tag === "wobble") {
      if (on) {
        const was = b.wait;
        b.wait += 1;
        if (was >= BARREL.sinkAt) {
          b.wait = BARREL.rest;
          b.vy = 0;
          barrelInstall(b, "sink");
          return;
        }
      }
      if (ended) barrelInstall(b, "wobble");
    }
  };
  think();
  b.bounced = false;
  if (b.tag === "none") return;
  const s = barrelScript(b);
  const i = Math.min(s.cels.length - 1, Math.floor(b.aclock / s.hold));
  const dx = s.dx[i] ?? 0;
  const dy = s.dy[i] ?? 0;
  if (dx) b.vx += roundAway(dx / BARREL.divisor) * (b.mirror ? -1 : 1);
  if (dy) b.vy += roundAway(dy / BARREL.divisor);
  b.aclock += 1;
}

/** the lifts in the room the player is in */
export function elevsHere(): Elev[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.elevs[i] : [];
}

/**
 * Step every door — `0x43ffd0`, which is two branches.
 *
 * Only the two moving tags do anything: the opening one, when its script ends,
 * becomes the open tag and takes the rect out of the obstacle table; the closing
 * one becomes the shut tag, puts the rect back, and sounds. The two resting tags
 * wait for a lever.
 */
export function stepDoors(): void {
  /**
   * ...and every door in the LEVEL, not in the room.
   *
   * Four of level seven's five levers stand in a different region from the door
   * they open, so a door that only moved while you were looking at it would be
   * left half open for ever — which is exactly what happened: throw the lever on
   * the ledge, walk east, and find the door still on the second frame of its
   * opening animation and still solid.
   */
  for (const d of level?.doors.flat() ?? []) {
    if (d.state === "shut" || d.state === "open") continue;
    d.clock += TICK_SCALE;
    if (d.clock < doorFrames(d)) continue;
    d.clock = 0;
    if (d.state === "opening") d.state = "open";
    else {
      d.state = "shut";
      sound?.effect(DOOR.shutSound, d.x, d.y);
    }
  }
}

/**
 * Step every lift — `0x43d810`, and {@link ELEV} has its five tags.
 *
 * The cycle needs nothing from outside it: at rest it asks whether the rect's
 * bottom is below it and goes the other way, and each moving tag adds its
 * impulse, clamps, and watches for the end of the shaft. Its platform record
 * goes with it, which is what a rider stands on.
 */
export function stepElevs(): void {
  for (const e of elevsHere()) {
    e.clock += TICK_SCALE;
    if (e.state === "atBottom") {
      if (e.clock < ELEV.waitFrames) continue;
      e.clock = 0;
      // `0x43d84e`: is the bottom of the shaft below me? then sink; else rise
      e.state = e.bottom > e.y ? "startDown" : "startUp";
      continue;
    }
    if (e.state === "startDown" || e.state === "startUp") {
      if (e.clock < ELEV.startFrames) continue;
      e.clock = 0;
      e.state = e.state === "startDown" ? "down" : "up";
      continue;
    }
    const was = e.y;
    if (e.state === "down") {
      // `0x42f8b0`: the impulse is divided — 4 a frame, spread over its four
      // ticks — and the result never exceeds the cap
      e.vy = Math.min(
        ELEV.downCap,
        e.vy + roundAway(ELEV.push / ELEV.divisor) * TICK_SCALE,
      );
      e.y += e.vy * TICK_SCALE;
      if (e.y >= e.bottom) {
        e.y = e.bottom;
        e.vy = 0;
        e.state = "atBottom";
        e.clock = 0;
      }
    } else {
      const cap = ELEV.upCap[e.param] ?? ELEV.upCap[0];
      e.vy = Math.max(
        -cap,
        e.vy - roundAway(ELEV.push / ELEV.divisor) * TICK_SCALE,
      );
      e.y += e.vy * TICK_SCALE;
      if (e.y <= e.top) {
        e.y = e.top;
        e.vy = 0;
        e.state = "atBottom";
        e.clock = 0;
      }
    }
    const moved = e.y - was;
    if (e.floor && moved !== 0) {
      e.floor.top += moved;
      e.floor.bottom += moved;
      // a rider goes with it, which is what owning a floor MEANS
      // the rider is not moved here: the platform record IS the floor, and the
      // player's own pin finds it again where it now is ({@link surfaceUnder})
    }
  }
}

/**
 * `0x438200` — the first unlit lever standing inside this thing's own territory.
 *
 * The rect is the enemy record's, and the test is on the LEVER's position, not
 * the enemy's: a gang member is the keeper of whatever lever its patrol covers,
 * and SERVICE gives every one of its six a keeper.
 */
export function leverFor(e: Enemy, dir: 0 | 1): Switch | null {
  const want = dir === 0 ? "off" : "on";
  for (const s of switchesHere()) {
    if (s.state !== want) continue;
    if (s.x < e.left || s.x > e.right || s.y < e.top || s.y > e.bottom)
      continue;
    return s;
  }
  return null;
}

/** every drip of goop in the air, whichever string it belongs to */
export let drips: Drip[] = [];

/**
 * The floor a foot moving from `fromY` to `toY` meets, for an object that
 * stands on the REGION and nothing else.
 *
 * `0x42fd80` searches the platform table only for an object whose `obj+0x34`
 * is set (`0x42fe4a`), and the allocator leaves it 0 (`0x42f5a7`): the player
 * and a thrown gun (`0x45b10c`) set it, and the flare, the crow and its
 * feathers, the goop and the spray's gobs (`0x40c401` writes 0) never do. So
 * those fall straight through a walkway to the floor under it.
 */
export function regionFloorUnder(x: number, fromY: number, toY: number): number | null {
  const g = groundAt(x);
  return g !== null && g >= fromY && g <= toY ? g : null;
}

/**
 * Run the goop — `0x437502` for the nests and `0x437310`'s other three branches
 * for what they make.
 *
 * A running nest drips 42 times in 512 frames, from anywhere along the top edge
 * of its own rect, and tosses for which of the two strings it gets. After that
 * every link is on rails: the two that hang are still and turn into the two that
 * fall, the gob bursts into three splashes where it lands, and everything is
 * gone the frame it touches the floor.
 */
export function stepGoop(): void {
  const lvl = level;
  if (!lvl) return;
  for (const n of nestsHere()) {
    if (!n.on) continue;
    if (random() >= GOOP.chance * TICK_SCALE) continue;
    const kind = roll(2) - 1 === 0 ? "bead" : "strand";
    drips.push({
      kind,
      x: n.left + roll(n.right - n.left),
      y: n.top,
      vx: 0,
      vy: 0,
      clock: 0,
    });
  }
  const born: Drip[] = [];
  for (const d of drips) {
    d.clock += TICK_SCALE;
    const done = d.clock >= dripFrames(d);
    if (d.kind === "bead") {
      // `0x437350`: the bead hangs still and becomes a drop where it is
      if (!done) continue;
      d.spent = true;
      born.push({ kind: "drop", x: d.x, y: d.y, vx: 0, vy: 0, clock: 0 });
      sound?.effect(GOOP.dropSound, d.x, d.y);
      continue;
    }
    if (d.kind === "strand") {
      // `0x437408`: the gob comes at the strand's EIGHTH cel, not at its end
      if (!d.spent && dripCel(d) === GOOP.gobAtCel) {
        d.spent = true;
        born.push({
          kind: "gob",
          x: d.x,
          y: d.y + GOOP.gobBelow,
          vx: 0,
          vy: 0,
          clock: 0,
        });
        sound?.effect(GOOP.gobSound, d.x, d.y + GOOP.gobBelow);
      }
      continue;
    }
    // the three that move: gravity 1.0 for a drop and a gob, ½ for a splash
    // (`0x435e81`, `0x435eb9`, `0x435ee4`), each landing on what anything lands
    // on — the floor under its foot (`0x42fd80`), swept along the fall
    const g = d.kind === "splash" ? PLAYER_GRAVITY / 2 : PLAYER_GRAVITY;
    const art = celRec(lvl.sbk, dripCel(d));
    const ext = art ? art.height - art.posY : 0;
    const wasFoot = d.y + ext;
    d.vy += g * TICK_SCALE;
    d.y += d.vy * TICK_SCALE;
    d.x += d.vx * TICK_SCALE;
    if (d.vy >= 0 && regionFloorUnder(d.x, wasFoot, d.y + ext) !== null) d.landed = true;
  }
  drips.push(...born);
  // ...and nothing holds a drip that has fallen out of the room altogether
  const bottom = p.room ? p.room.bottom + 400 : Infinity;
  drips = drips.filter((d) => {
    if (d.kind === "bead") return d.clock < dripFrames(d);
    // the strand is removed when its own script ends, gob or no gob
    if (d.kind === "strand") return d.clock < dripFrames(d);
    // `0x437382`/`0x4373e0`: a drop and a splash go the frame they are down;
    // `0x43746a`: a gob goes when it is down OR has met something
    if (!d.landed && !d.hit) return d.y < bottom;
    if (d.kind === "gob") {
      // `0x43747c`: three of them, each with its own shove — `0x4373a9`'s
      // `0x434540(200) - 100` across and `0x434540(80) - 70` up, through the
      // divisor the way `0x42f8b0` divides, away from zero
      for (let i = 0; i < GOOP.splashes; i++) {
        drips.push({
          kind: "splash",
          x: d.x,
          y: d.y,
          vx: roundAway((roll(200) - 100) / GOOP.divisor),
          vy: roundAway((roll(80) - 70) / GOOP.divisor),
          clock: 0,
        });
      }
    }
    return false;
  });
  feedTheGang();
}

/**
 * Which drips can touch anything at all — and it is **one cel in the whole
 * family**.
 *
 * Of the nine cels the two strings use, only 518, the gob, carries a strike box
 * (`y -2 … 20`, `x -8 … 11`) and a blow pair (`dy 25, dx -1`). The bead, the
 * drop it turns into, the strand and the three splashes carry neither, so they
 * are weather: they fall through the player and through the gang and land. What
 * the level actually throws at you is the second string's gob, at 25 plus
 * whatever it has picked up falling, which is under the player's own knockdown
 * threshold of 60 for about the first three frames of its drop and over it after.
 */
export function dripStrike(d: Drip): SbkCel | null {
  const c = celRec(level?.sbk, dripCel(d));
  return c?.strike && c.blow ? c : null;
}

/**
 * What goop does to the gang — `0x438339`, `0x438fd9`, `0x439a59`, `0x43a659`.
 *
 * Their hit handlers ask which class hit them before they do anything else, and
 * goop is the one answer that is good news: health goes UP by the class's own
 * figure, clamped to what it started with, one sound, and no spray and no
 * subtraction. Sixty for the one with the bat and twenty for the other three.
 * A full one is fed all the same: the clamp is the only ceiling, the sound
 * plays and the gob is spent (the handler returns 1). Only an empty one
 * (`test cx, cx; jle`) falls through to the blow.
 *
 * It reaches them the same way a blow does — the gob's own strike box against
 * the body box of the cel they are showing — so it is the same one cel that
 * feeds them and the same one that hurts you.
 */
export function feedTheGang(): void {
  const lvl = level;
  if (!lvl || !drips.length) return;
  for (const e of spawnedHere()) {
    // a sleeper is fed like anything else — the handlers test no state — but
    // only through a cel with a body box (`0x4303b3`): the gang's flinch and
    // death cels carry none, so a flinching one is out of reach
    if (e.state === "dead" || e.state === "burst") continue;
    const heal = GOOP.feeds[e.kind];
    if (heal === undefined) continue;
    const foe = FOES[e.kind];
    if (e.hp <= 0) continue;
    const c = celRec(lvl.sbk, celOf(e));
    if (!c?.body) continue;
    const box = hurtBox(e, c, lvl);
    const fed = drips.find((d) => {
      const cel = dripStrike(d);
      if (!cel) return false;
      const b = strikeOf(cel, d.x, d.y, 1);
      return !!b && overlaps(b, box);
    });
    if (!fed) continue;
    // clamped to `0x40e300` of the starting figure — the difficulty-scaled one
    e.hp = Math.min(e.max ?? foe.health, e.hp + heal);
    sound?.effect(GOOP.fedSound[e.kind] ?? 0xb, e.x, e.y);
    // the handler answers 1 and the gob's `obj+0x2a` is set: it bursts
    fed.hit = true;
  }
}

/** the girders in the room the player is in */
export function ibeamsHere(): Ibeam[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.ibeams[i] : [];
}

/**
 * Step every girder: the delay, then tag 0 to 1 to 2 and round again.
 *
 * `0x4537d0` returns without touching the state machine while `ctx+4` is counting,
 * and installs the next tag at each script end, flipping `ctx+6`'s low bit so the
 * passes alternate. It never moves the thing — the arc is entirely in the cels.
 */
export function stepIbeams(): void {
  for (const b of ibeamsHere()) {
    if (b.delay > 0) {
      b.delay -= TICK_SCALE;
      continue;
    }
    b.clock += TICK_SCALE;
    if (b.clock < ibeamFrames(b)) continue;
    b.clock = 0;
    if (b.state === "out") {
      b.side = b.side ? 0 : 1;
      b.state = "across";
    } else if (b.state === "across") {
      b.side = b.side ? 0 : 1;
      b.state = "back";
      sound?.effect(IBEAM.sound, b.x, b.y);
    } else {
      // `0x453894`: back to tag 0 with sound 6, and no flip
      b.state = "out";
      sound?.effect(IBEAM.soundBack, b.x, b.y);
    }
  }
}

/** the crows in the room the player is in */
export function crowsHere(): Crow[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.crows[i] : [];
}

/** the feathers a struck crow has thrown off, wherever they are */
export let feathers: Feather[] = [];

/**
 * Step every crow, one engine frame — `0x451aa0`'s think, the animator's pushes
 * and the mover, in the engine's order. {@link CROW} has the states written out.
 */
export function stepCrows(): void {
  const lvl = level;
  // the player's point, `obj+6`
  const py = p.y - p.feet;
  const install = (c: Crow, state: CrowState, tag = 0): void => {
    c.state = state;
    c.tag = tag;
    c.clock = 0;
  };
  for (const c of crowsHere()) {
    // `obj+0x46`: the tag has shown every one of its cels
    const ended = c.clock >= crowFrames(c);
    // `0x451aeb` — airborne, from state 4 up, bar the feathers and the tumble
    let want = py - CROW.above;
    if (
      c.state !== "sleep" &&
      c.state !== "wake" &&
      c.state !== "rise" &&
      c.state !== "tumble" &&
      !c.grounded
    ) {
      want = (roll(CROW.jitter) + CROW.jitter) * c.factor + py - CROW.above;
      const gap = want - c.y;
      if (gap > CROW.band) c.vy += CROW.climb;
      else if (gap < -CROW.band) c.vy -= CROW.climb;
      else c.vy = 0;
      if (Math.abs(c.vy) > CROW.damp && c.state !== "strike")
        c.vy = Math.trunc(c.vy / 2);
    }
    switch (c.state) {
      case "sleep": {
        // `0x451ba3`: the player's own point inside the crow's rect
        if (p.x >= c.left && p.x < c.right && py >= c.top && py < c.bottom)
          install(c, "wake");
        else if (ended) {
          sound?.effect(CROW.sound.sleep, c.x, c.y);
          install(c, "sleep");
        }
        break;
      }
      case "wake":
        if (ended) install(c, "rise");
        break;
      case "rise":
        if (ended) {
          install(c, "fly");
          sound?.effect(CROW.sound.flap, c.x, c.y);
        }
        break;
      case "hop":
        if (c.tag === 0) {
          // `0x451c74`: its end picks one of the other two tags...
          if (ended) install(c, "hop", roll(2));
          // ...and a player less than 160 east of it — or west of it at all —
          // is dived at (`0x451ca3` is a signed compare)
          if (p.x - c.x < CROW.strikeAt) {
            sound?.effect(CROW.sound.strike, c.x, c.y);
            c.vx = Math.trunc(c.vx / 2);
            install(c, "strike", 1);
          }
        } else if (ended) install(c, "hop", 0);
        break;
      case "fly":
        if (c.tag === 0) {
          // `0x451d18`: shed speed, halving, until it is ten or less
          if (Math.abs(c.vx) > CROW.damp) c.vx = Math.trunc(c.vx / 2);
          else install(c, "fly", 1);
        } else if (c.tag === 1) {
          if (ended) install(c, "fly", 2);
        } else if (c.tag === 2) {
          // `0x451d70`: back away from a player less than 350 ahead
          if (p.x - c.x < CROW.farAt) c.vx -= CROW.backOff;
          if (Math.abs(c.vx) > CROW.backOffCap) c.vx = Math.trunc(c.vx / 2);
          if (ended) {
            c.vx = 0;
            install(c, "fly", 3);
          }
        } else if (ended) {
          // `0x451dfa`: 350 or more east of it and it strikes
          if (p.x - c.x < CROW.farAt) install(c, "fly", 0);
          else {
            c.vx = 0;
            sound?.effect(CROW.sound.strike, c.x, c.y);
            install(c, "strike", 0);
          }
        }
        break;
      case "fall":
        // `0x451e5a` — the eight frames of the burn are up, so gravity 1.0, the
        // tumble and `0x40d450(0x50)`, which is the same award a punch pays
        if (ended) {
          c.gravity = CROW.deadGravity;
          install(c, "tumble");
          stats.score += CROW.award;
        }
        break;
      case "strike":
        if (c.tag === 0) {
          // `0x451eb9`: three times in ten it gives the attack up
          if (roll(10) < CROW.giveUp) install(c, "hop", 0);
          else {
            install(c, "strike", 2);
            c.factor = roll(2);
          }
        } else if (c.tag === 1) {
          if (ended) {
            install(c, "fly", 0);
            sound?.effect(CROW.sound.flap, c.x, c.y);
          }
        } else if (c.tag === 2) {
          if (ended) install(c, "strike", 3);
        } else if (c.tag === 3) {
          // `0x451f53`: down to its height, then the run
          if (c.y >= want) {
            install(c, "strike", 4);
            c.vy = 0;
          } else if (ended) {
            install(c, "strike", 3);
            sound?.effect(CROW.sound.flap, c.x, c.y);
          }
        } else {
          // `0x451fac`: the run east, capped, and again while it is still west
          // of the player and has touched nothing
          if (Math.abs(c.vx) > CROW.runCap) c.vx = Math.trunc(c.vx / 2);
          if (ended) {
            if (c.x <= p.x && !c.hit) {
              install(c, "strike", 4);
              sound?.effect(CROW.sound.strike, c.x, c.y);
            } else {
              install(c, "fly", 0);
              c.hit = false;
              c.factor = 0;
            }
          }
        }
        break;
      case "tumble":
        break;
    }
    // the animator: the cel it shows pushes, through the divisor of one
    const tag = crowTag(c);
    if (c.clock < crowFrames(c)) {
      const k = Math.floor(c.clock / tag.hold);
      c.vx += roundAway((tag.dx?.[k] ?? 0) / CROW.divisor);
      c.vy += roundAway((tag.dy?.[k] ?? 0) / CROW.divisor);
    }
    c.clock += 1;
    // ...and the mover: the move, the floor under the foot, then gravity or drag
    const art = lvl ? celRec(lvl.sbk, crowCel(c)) : undefined;
    const ext =
      (art ? art.height - art.posY : 0) + (c.state === "tumble" ? CROW.deadFoot : 0);
    const wasFoot = c.y + ext;
    c.x += c.vx;
    c.y += c.vy;
    // the floor it crossed, or — already standing — one within the eight the
    // mover snaps to
    const snap = c.grounded ? 8 : 0;
    const floor = c.vy >= 0 ? regionFloorUnder(c.x, wasFoot - snap, c.y + ext + snap) : null;
    if (floor !== null) {
      c.y = floor - ext;
      c.vy = 0;
      c.grounded = true;
      c.vx = dragged(c.vx);
    } else {
      c.grounded = false;
      c.vy += c.gravity;
    }
  }
  // and the feathers: `0x452035` lets one go the frame it is found on the
  // ground (`obj+0x2e`); until then it loops its script and falls at one pixel
  // a frame². What finds it on the ground is the mover `0x42fd80`, and it has
  // two ways to: the floor at or above its foot (`0x42ff56`, within 8), and the
  // WALL — a region floor more than fifty above the foot at the new point
  // (`0x42fedc`). The wall undoes the move, takes `obj+0xc` back out of the x,
  // zeroes `obj+0xa` (`0x42fef3`..`0x42ff0c`) and sets the same `obj+0x2e`
  // (`di = 1` at `0x42fef3`, stored at `0x430296`). So a feather that drifts
  // under a ledge's face — CITY's crow at x837 is over the fall, whose floor is
  // at 7250, beside the ledge's at 3925 — is done the frame it meets the face;
  // nothing else in the class (`0x451aa0`) ever removes one
  feathers = feathers.filter((f) => !f.grounded);
  for (const f of feathers) {
    f.age += 1;
    const art = lvl ? celRec(lvl.sbk, featherCel(f)) : undefined;
    const ext = art ? art.height - art.posY : 0;
    const wasX = f.x;
    const wasY = f.y;
    f.x += f.vx;
    f.y += f.vy;
    const g = groundAt(f.x);
    if (g !== null && g + CLIMB_PX < f.y + ext) {
      f.x = wasX - f.vx;
      f.y = wasY;
      f.vy = 0;
      f.grounded = true;
      continue;
    }
    if (g !== null && g - 8 <= f.y + ext) {
      f.y = g - ext;
      f.vy = 0;
      f.grounded = true;
    } else f.vy += CROW.feather.gravity;
  }
  // a tumbling crow that has fallen out of the world is done with
  const room = p.room;
  const i = lvl && room ? lvl.rooms.indexOf(room) : -1;
  if (lvl && room && i >= 0) {
    lvl.crows[i] = lvl.crows[i].filter(
      (c) => c.state !== "tumble" || c.y < room.bottom + 400,
    );
  }
}

/** which cel a feather is showing — `0x476ea0`, looped until it lands */
export function featherCel(f: Feather): number {
  const a = CROW.feathers;
  return a.cels[Math.floor(f.age / a.hold) % a.cels.length];
}

/**
 * A blow landing on a crow — `0x4520d0`, which has no health test in it.
 *
 * One hit is all: feathers (one, or four when the blow beats 50 — `0x45213f`
 * adds three to the one `0x45215a` always makes), woods 18, gravity 1.0 and the
 * tumble, with whatever velocity it had. The award is `0x40d450(0x50)`.
 */
export function strikeCrow(c: Crow, damage: number): void {
  const puffs = damage > CROW.hardBlow ? 4 : 1;
  for (let i = 0; i < puffs; i++) {
    // `0x4521d0`: at the crow's own point, a random facing and push
    feathers.push({
      x: c.x,
      y: c.y,
      vx: roll(11) - 6,
      vy: roll(11),
      mirror: roll(2) === 2,
      age: 0,
      grounded: false,
    });
  }
  sound?.effect(CROW.sound.hit, c.x, c.y);
  c.state = "tumble";
  c.tag = 0;
  c.clock = 0;
  c.gravity = CROW.deadGravity;
  stats.score += CROW.award;
}

/** the other modules' writes into this one's state — ES imports are read-only */
export function setDrips(v: typeof drips): void {
  drips = v;
}
export function setRoaches(v: typeof roaches): void {
  roaches = v;
}
export function setColumns(v: typeof columns): void {
  columns = v;
}
export function setRaised(v: typeof raised): void {
  raised = v;
}
export function setFeathers(v: typeof feathers): void {
  feathers = v;
}
