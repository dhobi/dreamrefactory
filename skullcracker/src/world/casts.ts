/**
 * Casts — the things that are thrown and fall: skateboards, rollers, cans,
 * flames and heads, the shots and globs the creatures let go of, and how a
 * loose one lands, bounces and chains.
 */
import { SbkCel } from "@dreamfactory/engine/df/sbk";
import { FOES, type Foe } from "../foes";
import type { Aim, CastCtx, CastKit, Enemy, Hatch } from "../brains/kit";
import { COP_SLUG, EYEBALL_GLOBS, HARDCORE_THROW, HARDCORE_THROW_LOW, IGOR_THROW, SKEL_BONE, TUBE_SHARDS, VPRIEST_BOLT } from "../brains";
import { Crow, BOGGS, SKATEBOARD, Board, CAN, Can, HEAD, Head, FLAME, Flame, ROLLER, Roller } from "../props";
import { random } from "../random";
import { level, p, type Level, sound } from "./state";
import { dropKeys } from "./keys";
import { roundAway, DIVISOR, DRAG, dragged } from "./motion";
import { celRec, celOf, foeAnchor } from "./cels";
import { shake, setFlashColour } from "./camera";
import { roll, spawnedHere, roomSpan, everyAnim } from "./rooms";
import { shutStreams, inv } from "./arsenal";
import { stats, pops, knockback, strikeOf } from "./blows";
import { playerSprite } from "./fixtures";
import { crowsHere } from "./scenery";

/**
 * Step each spawned thing: its animation, then whatever that animation moves.
 *
 * The frame decides the step, not a speed: `dx` is the engine's per-frame number
 * for that cel, divided by the CLASS's own divisor (`obj+0xe` — 20 for a punk, 7
 * for a mailbox) the way `0x42f8b0` divides it, and scaled by {@link TICK_SCALE}
 * because this page's tick is shorter than the engine's.
 *
 * A flinch or a death runs to its end and then hands back: a flinch returns to
 * the gait, a death counts `[0x46b204]`'s fifty frames down and the thing is
 * removed. It stays in the level's census the whole time it is lying there,
 * because the engine's own census only drops when the OBJECT goes (`0x42f750`
 * decrements `0x4a6e88` on destruction, and the death path never calls
 * `0x42f870(obj, 0)`) — so the quota is not met until the bodies are gone.
 *
 * Turning at the rect's edge is this port's; the class's territory numbers are in
 * the AI struct nothing has read. See {@link FOES}.
 */
/**
 * The statue, and the fight it turns into — the two states this page gives the
 * one class that has them ({@link Foe.wake}, {@link Foe.drives}).
 *
 * Returns true only while it is still a statue, which is the one state that has
 * to suppress everything else. The rest of it just chooses the animation and
 * lets the ordinary path play and MOVE it, since the charge's eleven pixels a
 * frame are the script's own `dx` and the gait block already applies those.
 */
/**
 * One projectile in the air, thrown by a class rather than by the player.
 *
 * The gun's {@link Bolt} is the same idea and not the same thing: a bolt is the
 * player's and expires on the first thing it meets, while these belong to a
 * creature, carry that creature's own strength, and are drawn out of the
 * LEVEL's book rather than the shared player book.
 */
export interface Cast {
  kit: CastKit;
  x: number;
  y: number;
  /** pixels an engine frame, along the facing it left with */
  vx: number;
  facing: number;
  /** engine frames since it launched — the flight cels are read off it */
  clock: number;
  /** ...and the pull's half of the velocity, for the ones that arc */
  vy: number;
  /** frames into its own impact, once it has landed — see {@link CastKit.impact} */
  landed?: number;
  /** where it started, for the kits whose end is a range rather than a reach */
  bornX: number;
  /** ...and the height it started at, which only the fall guard below reads */
  bornY: number;
  /** frames into the burst a BOUNCE plays, while the flight carries on under it */
  bounced?: number;
  /** has it come close enough to arm — see {@link CastKit.arm}. One-way */
  armed: boolean;
  /**
   * It is on FIRE — word 0 of the six bytes `0x456240` allocates beside the
   * object, and of the two casts with a −9 arm the fireball is the only one
   * that has any. One-way too, and {@link CastKit.onCode} owns it: see
   * {@link CastSelf.alight}.
   */
  alight?: boolean;
  /** its impact was started by another's burst — {@link chainCasts}; the probe's */
  setOff?: boolean;
  /** it has struck something and flies on worth nothing — {@link CastKit.flyOn} */
  struck?: boolean;
  /** where its thrower stood when it let go — `AI+4`/`AI+6` of the hardcore's */
  fromX: number;
  fromY: number;
  /** out on the far leg of a throw that comes back — {@link CastKit.returns} */
  out?: boolean;
  /** ...and engine frames into the way back, once it has turned */
  back?: number;
  spent: boolean;
}

/**
 * ...and the one kit that belongs to no class module, because the thing that
 * throws it is a MACHINE rather than a creature — see {@link BOGGS.throwing}.
 */
export const BOGGS_THROW: CastKit = {
  cels: BOGGS.throwing.cels,
  hold: 1,
  // no frame of tag 0 carries a speed of its own: every pixel of it is stride
  speed: 0,
  ahead: BOGGS.throwing.ahead,
  lift: 0,
  blow: BOGGS.throwing.strength,
  reach: BOGGS.throwing.reach,
  strides: BOGGS.throwing.strides,
  divisor: BOGGS.throwing.divisor,
  impact: { cels: BOGGS.throwing.splat, hold: 1 },
  from: BOGGS.throwing.from,
};

/** everything a creature has thrown and the world has not taken back yet */
export let casts: Cast[] = [];

/** every board two of level five's gang have dropped — {@link SKATEBOARD} */
export let skates: Board[] = [];

/**
 * One goes down where any of the gang died — `0x438450`.
 *
 * It is put ten above the surface under the thing that dropped it, keeps its
 * facing, and leaves on the hop its own script's first frame carries: `dx 15`
 * and `dy -50` through the class's divisor of five, so three across and ten up.
 * `0x4385af` then reads `noskateboards` at the board's own point and that is
 * the whole of how long it lies there.
 */
export function dropBoard(e: Enemy): void {
  const lvl = level;
  if (!lvl) return;
  const b = SKATEBOARD;
  if (!lvl.sbk.byId.has(b.hop.cel) || !lvl.sbk.byId.has(b.rest)) return;
  // `0x438487` — the REGION floor under the dropper's point (the board has no
  // ledges: `0x4384ee`), and `0x4384c3` takes the ten off that
  const floor = looseFloor(e.x);
  const y = (floor ?? e.y) - b.lift;
  // `0x438497`..`0x4384bf` — and its x kept to the floor's own span: past the
  // far end it is put fifty inside it, and short of the near end it is put
  // fifty past the FAR end, which is what the executable writes
  const g = p.room?.ground;
  let x = e.x;
  if (g) {
    // `0x40bc6d` — the span's end is its start plus its sample count
    const end = g.x0 + g.ys.length;
    if (end < x) x = end - 0x32;
    if (x < g.x0) x = end + 0x32;
  }
  // `0x4385bd` — one point-in-record test, once, at the moment it is dropped
  const swept = lvl.sbk.entities.some(
    (r) =>
      r.name === b.sweptBy &&
      x >= r.left &&
      x <= r.right &&
      y >= r.top &&
      y <= r.bottom,
  );
  skates.push({
    x,
    y,
    bornY: y,
    vx: roundAway((e.facing * b.hop.dx) / b.divisor),
    vy: roundAway(b.hop.dy / b.divisor),
    down: false,
    life: b.lasts[swept ? 1 : 0],
    facing: e.facing,
  });
}

/**
 * The board's rect — {@link SKATEBOARD.ride}: cel 2300's drawn box as
 * `0x438501`..`0x43855c` files it, at the board's own point.
 */
function boardRect(d: Board): { top: number; left: number; right: number } | null {
  const r = SKATEBOARD.ride;
  const c = celRec(level?.sbk, r.cel);
  if (!c) return null;
  let left = -r.widen - c.posX;
  let right = c.width - c.posX + r.widen;
  if (d.facing < 0) [left, right] = [-right, -left];
  return { top: d.y + r.topDown - c.posY, left: d.x + left, right: d.x + right };
}

/**
 * One frame of a board lying there with the player about — `0x437854`, and
 * see {@link SKATEBOARD.ride}. Answers the drag the mover takes this frame.
 */
function rideBoard(d: Board): number {
  const r = SKATEBOARD.ride;
  const box = boardRect(d);
  d.vx = Math.max(-r.maxSpeed, Math.min(r.maxSpeed, d.vx));
  const me = playerSprite();
  const bottom = me ? me.top + me.f.height : p.y;
  const on =
    !!box &&
    p.onGround &&
    p.x < box.right &&
    p.x > box.left &&
    Math.abs(bottom - box.top) < r.feetPx;
  if (on) {
    // `0x4378fa`..`0x437924`
    d.stood = true;
    d.vx += p.facing;
    d.facing = p.facing;
    return 0;
  }
  if (!d.stood || !box) return r.offDrag;
  d.stood = false;
  // `0x437951`..`0x43797e` — gone on ahead of him, the way it faces
  const behind = d.facing > 0 ? p.x < box.left : p.x > box.right;
  if (!behind) return r.offDrag;
  // `0x43798d` — tag 0 again, the hop, its script step spent as an impulse
  d.down = false;
  d.vx += roundAway((d.facing * SKATEBOARD.hop.dx) / SKATEBOARD.divisor);
  d.vy += roundAway(SKATEBOARD.hop.dy / SKATEBOARD.divisor);
  d.life -= r.kickedLife;
  // `0x4379a3` — out from under him at speed: `0x402fa0(2)`, which drops the
  // keys (`0x402df0`) and, off a ladder and not already down or dying
  // (`0x42f321`..`0x42f347`), installs `0x4722a8` tag 0 — kind 24, unarmed
  if (Math.abs(d.vx) > r.tripSpeed) {
    dropKeys();
    if (p.act !== "downFront" && p.act !== "downBack" && p.act !== "dying" && !p.ladder && !p.bar) {
      if (p.act === "fire") shutStreams();
      p.act = "downFront";
      p.actClock = 0;
      inv.drawn = false;
    }
  }
  return r.offDrag;
}

/**
 * The boards, one engine frame each.
 *
 * The same mover every object in the game runs through — {@link looseStep},
 * with the class's own restitution (`0x437661`) and drag (`0x437653`), the
 * allocator's weight, and the foot of whichever of its two cels it shows.
 * `0x4377c4` is the cel change — the frame the standing word is first set —
 * and `0x437809` is the countdown that follows.
 */
export function stepBoards(): void {
  const b = SKATEBOARD;
  for (const d of skates) {
    // state 1, the board lying there: the player can step on it — and what
    // that leaves the drag at is what the mover takes this frame
    const drag = d.down ? rideBoard(d) : b.friction;
    const moved = looseStep(d, {
      foot: celFoot(d.down ? b.rest : b.hop.cel),
      bounce: Math.trunc(b.bounce * -8192),
      drag: Math.trunc(drag * 8192),
      weight: b.pull,
    });
    if (moved.down) d.down = true; // `0x4377c4`
    // `0x437809` — and only once it is down, which is what `0x4377ea` waits for
    if (d.down) d.life -= 1;
    // the page's own guard, the casts' one exactly: a board is removed by its
    // countdown, and its countdown does not start until a surface is under it
    if (d.y - d.bornY > FALLS_FOREVER) d.life = -1;
  }
  skates = skates.filter((d) => d.life >= 0);
}


/**
 * A roller as the mover keeps it: its vertical half, the launch it is holding
 * in the script's own units until `0x43a9c4` spends it, and whether it has come
 * to rest (`obj+0x30`, which `0x43a9f1` reads).
 */
export type RollerBody = Roller & { vy: number; launch: number; still: boolean };

/** the one roller a level may have — {@link ROLLER} */
export let rollers: RollerBody[] = [];

/** what the Coke machines have thrown out — {@link CAN} */
export let cans: Can[] = [];

/**
 * `0xfff7` — the one strength that is a code against a creature.
 *
 * `0x453b9b` is the flamer's flame and `0x43ac04` is a flare on stage 5; those
 * are the only two things in the game that carry it.
 */
export const BURN_CODE = -9;

/** what is on fire — {@link FLAME}, and a blow of −9 is what lights one */
export let flames: Flame[] = [];

/**
 * Light one — `0x44ff20`, the half of a −9 that every class shares.
 *
 * The offset is a random point inside the victim's CURRENT cel bitmap, both
 * axes, and it is kept rather than re-rolled: `0x453ea0` reads `user+6` and
 * `user+4` back every frame and mirrors the first of them by the victim's own
 * facing. So a flame sits somewhere on the creature and stays there.
 */
export function burnFoe(e: Enemy, how: NonNullable<Foe["burns"]>): void {
  if (!level) return;
  lightFlame(e, celRec(level.sbk, celOf(e)), e.facing < 0, how);
}

/**
 * ...and on a CAST, which is the same function on a different kind of object.
 *
 * `0x44ff20` takes whatever it is given and asks `0x42f9f0` for its current
 * cel's box, so nothing in it cares that the fireball is not a creature — see
 * {@link CastKit.onCode}, which is the only caller.
 */
export function burnCast(
  c: Cast,
  how: { late?: boolean; forever?: boolean },
): void {
  if (!level) return;
  lightFlame(c, celRec(level.sbk, castCel(c)), c.facing < 0, how);
}

/**
 * The shared half: one flame, somewhere inside the victim's own cel.
 *
 * `mirror` is the victim's facing as it catches: `0x44ffee` copies its
 * `obj+0x28` into the flame's, once, and nothing writes it again. The flame
 * cels are not centred on their anchors (9620's is 11 of 34 across), so a flame
 * on something facing left is drawn reflected about that anchor, and it stays
 * so if the victim turns.
 */
export function lightFlame(
  on: object,
  art: SbkCel | undefined,
  mirror: boolean,
  how: { late?: boolean; forever?: boolean; stack?: boolean },
): void {
  const lvl = level;
  if (!lvl) return;
  // no art, no fire: only four books carry the 9600s
  if (!FLAME.grow.cels.every((id) => lvl.sbk.byId.has(id))) return;
  // ...and one flame at a time, which is this page's and not `0x44ff20`'s: the
  // function makes a new flame object every call, and a handler whose −9 arm
  // comes before its dying test (the punk's `0x44f0aa`) is called every frame a
  // stream stays on it. Kept so that a held stream reads as one fire — but a
  // flame lit to burn for ever (the CHOPPER's wreck, `0x4546b1`) is a second
  // object beside whatever was already burning, as it is on the disc
  // ...and the shower's `0x41a3f0` asks for its own too: one a frame for as
  // long as it burns, which is the point of it (`stack`)
  if (!how.forever && !how.stack && flames.some((f) => f.on === on)) return;
  // `0x44ff42` — halves of the victim's `0x42f9f0` rect, which is its current
  // cel's drawn extent; a cel the book does not carry has none
  const halfW = art ? Math.floor(art.width / 2) : 0;
  const halfH = art ? Math.floor(art.height / 2) : 0;
  // `0x434540` answers nothing for a range of nothing
  const pick = (n: number): number => (n > 0 ? roll(n) : 0);
  const f: Flame = {
    on,
    // `0x44ffa5`/`0x44ffc6`: `roll(half) - half/2`, so it is centred on the
    // middle of the box and spread half a box either way
    dx: pick(halfW) - Math.floor(halfW / 2),
    dy: pick(halfH) - Math.floor(halfH / 2),
    stage: how.late ? 2 : 0,
    clock: 0,
    forever: how.forever === true,
    mirror,
    x: 0,
    y: 0,
  };
  flames.push(f);
  // placed now as well as every frame, so a flame lit after the flame pass
  // (the CHOPPER's wreck, lit from its own think) is not drawn once elsewhere
  let kind: FlameOn = "foe";
  if (on === p) kind = "player";
  else if (crowsHere().includes(on as Crow)) kind = "crow";
  else if (casts.includes(on as Cast)) kind = "cast";
  placeFlame(f, lvl, kind);
}

type FlameOn = "crow" | "cast" | "foe" | "player";

/**
 * Where a flame stands — `0x453eb7`, against its victim's `obj+8` and `obj+6`.
 *
 * Those are the victim's ANCHOR, the point its cels are drawn from, and not the
 * middle of anything. A creature's `e.x` on this page is the middle of its gait
 * cel, so the anchor is {@link foeAnchor}'s: for the CHOPPER, whose 4870 hangs
 * 197 of its 222 pixels right of the anchor, measuring from `e.x` put the flame
 * on its wreck 86 pixels off it.
 */
function placeFlame(f: Flame, lvl: Level, kind: FlameOn): void {
  if (kind === "player") {
    // `0x41a019`..`0x41a055` — chapter four's flame, the same arithmetic
    // against the player's own point
    f.x = p.x + (p.facing < 0 ? -f.dx : f.dx);
    f.y = p.y - p.feet + f.dy;
  } else if (kind === "crow") {
    // a crow's point is its own anchor, and nothing on this page mirrors its
    // art, so `0x453eb7`'s facing has nothing to flip the offset by
    const c = f.on as Crow;
    f.x = c.x + f.dx;
    f.y = c.y + f.dy;
  } else if (kind === "cast") {
    // ...and a cast's own point IS its anchor: `obj+6` is what `0x453eb7`
    // reads back, and one of these has no separate foot to measure from
    const c = f.on as Cast;
    f.x = c.x + (c.facing < 0 ? -f.dx : f.dx);
    f.y = c.y + f.dy;
  } else {
    const e = f.on as Enemy;
    // `0x453eb7` — the offset is mirrored by the victim's facing, the
    // vertical one is not, and both are against the victim's own anchor
    const at = foeAnchor(e, lvl) ?? e;
    f.x = at.x + (e.facing < 0 ? -f.dx : f.dx);
    f.y = at.y + f.dy;
  }
}

/**
 * The flames, one engine frame at a time — `0x453ea0`.
 *
 * It follows its victim, it is worth a hundred every frame it exists
 * (`0x453eed`), and it goes out at the end of its third stage unless it was
 * lit to burn forever. A flame whose victim is gone goes with it: `0x453eae`
 * answers 1 the moment `user+8` is null.
 */
export function stepFlames(): void {
  const lvl = level;
  if (!lvl) return;
  const alive = new Set<object>(spawnedHere());
  // ...and a cast can be alight as well — `0x455763` and `0x452fcc`, the −9
  // arms on a cast, and `0x453eae` takes a flame with its victim
  const lit = new Set<object>(casts);
  for (const c of casts) alive.add(c);
  // ...and so can a crow — `0x4520d0`. `0x430367` hands every OBJECT in the room
  // its own `obj+0x12`, so what can be lit is not only what is in the pool
  const birds = new Set<object>(crowsHere());
  for (const c of birds) alive.add(c);
  // ...and the player, whom VAT's showers light (`0x41a3f0`)
  alive.add(p);
  for (const f of flames) {
    if (!alive.has(f.on)) continue;
    let kind: FlameOn = "foe";
    if (f.on === p) kind = "player";
    else if (birds.has(f.on)) kind = "crow";
    else if (lit.has(f.on)) kind = "cast";
    placeFlame(f, lvl, kind);
    f.clock += 1;
    const stage = flameStage(f);
    const run = stage.cels.length * stage.hold;
    if (f.clock < run) continue;
    if (f.stage === 0) {
      f.stage = 1;
      f.clock = 0;
    } else if (f.stage === 1) {
      f.stage = 2;
      f.clock = 0;
    } else if (f.forever) {
      // `0x453f76` — tag 2 goes back on itself and the thing burns for ever
      f.clock = 0;
    }
  }
  // gone: the victim left the level, or the third stage ran out on one that
  // was not lit to last
  // `0x41a0d2` — and a flame on a player no longer on his feet goes the moment
  // it is in its third stage
  flames = flames.filter(
    (f) =>
      alive.has(f.on) &&
      !(f.on === p && f.stage === 2 && p.act === "dying") &&
      (f.forever ||
        f.stage !== 2 ||
        f.clock < FLAME.fade.cels.length * FLAME.fade.hold),
  );
}

/** the script a flame's stage plays — {@link FLAME}'s three stages in order */
function flameStage(f: Flame) {
  if (f.stage === 0) return FLAME.grow;
  return f.stage === 1 ? FLAME.burn : FLAME.fade;
}

/** the cel a flame is showing — {@link FLAME}'s three stages in order */
export function flameCel(f: Flame): number {
  const a = flameStage(f);
  return a.cels[Math.min(a.cels.length - 1, Math.floor(f.clock / a.hold))];
}

/**
 * A can out of a machine — `0x43b780`, and the point is the machine's own.
 *
 * `0x43b7e2` turns it away from the player, and the first record of
 * `0x474ce0` is the only stride in the script: `dx 120, dy -70` over the
 * class's divisor of five. `0x43ae34` then gives this one its own drag.
 */
export function canAt(e: Enemy): void {
  const lvl = level;
  if (!lvl) return;
  // no art, no can — MALL is the only book with the 8600s and the only level
  // with a Coke machine, but a level list is not a guarantee
  if (!CAN.tumble.cels.every((id) => lvl.sbk.byId.has(id))) return;
  const away = p.x < e.x ? 1 : -1;
  // `0x43b7ad`/`0x43b7be` copy the machine's own `obj+6`, which is the ANCHOR
  // and not the feet. A Coke machine's anchor is under the floor it stands on,
  // so a can born there starts through it — and the mover's first frame puts
  // it back on top, as `0x42ff4c` does anything under its floor
  const at = foeAnchor(e, lvl) ?? { y: e.y };
  cans.push({
    x: e.x,
    y: at.y,
    vx: away * roundAway(CAN.launch.dx / CAN.divisor),
    vy: roundAway(CAN.launch.dy / CAN.divisor),
    clock: 0,
    tag: 0,
    drag: CAN.drags[Math.floor(random() * CAN.drags.length)],
  });
}

/**
 * The cans, one engine frame at a time — `0x43af00`.
 *
 * Tag 0 tumbles and tag 1 rolls; when tag 1 ends `0x43af4e` rolls one to three
 * and either goes round tag 1 again or settles on tag 2 or tag 3, both of
 * which hold one cel and wait for it to stop. Stopping is what makes the
 * pickup, and after that the can is scenery with a `Gun` underneath it.
 */
export function stepCans(): void {
  const lvl = level;
  if (!lvl) return;
  for (const c of cans) {
    if (c.rest !== undefined) continue; // down, and its pickup is made
    c.clock += 1;
    // the mover, with the can's own drag (`0x43ae5b`), the allocator's
    // restitution and weight, and no ledges (`0x43ae2e`)
    const { still } = looseStep(c, {
      foot: celFoot(canCel(c)),
      bounce: LOOSE_BORN.bounce,
      drag: Math.trunc(c.drag * 8192),
      weight: CAN.pull,
    });
    let len = 1;
    if (c.tag === 0) len = CAN.tumble.cels.length * CAN.tumble.hold;
    else if (c.tag === 1) len = CAN.settle.cels.length * CAN.settle.hold;
    if (c.tag <= 1) {
      if (c.clock < len) continue;
      // `0x43af32` hands tag 0 to tag 1; `0x43af4e` rolls 1..3 out of tag 1
      c.tag = c.tag === 0 ? 1 : 1 + Math.floor(random() * 3);
      c.clock = 0;
      continue;
    }
    // tags 2 and 3 — `0x43af6c` and `0x43af9d`, both waiting on `obj+0x30`:
    // the can has stopped, not merely come down
    if (!still) continue;
    c.rest = CAN.rests[c.tag - 2] ?? CAN.rests[0];
    const i = lvl.rooms.findIndex(
      (r) => c.x >= r.left && c.x <= r.right && c.y >= r.top && c.y <= r.bottom,
    );
    if (i < 0) continue;
    // `0x45af60(2, point, 0, 0x43aff0)` — and the band is the pickup's own
    // fifty-five, not the thirty-six a placed record is filed with
    lvl.guns[i] = [
      ...lvl.guns[i],
      {
        code: CAN.code,
        x: c.x,
        y: c.y,
        left: c.x - CAN.reach,
        right: c.x + CAN.reach,
        clock: 0,
      },
    ];
  }
  // ...and the page's own guard, as every free object here has: out of the
  // room's span and it is gone. `0x43af00` has no such rule because a can that
  // has landed is a pickup, and the level owns those.
  const span = p.room ? roomSpan(p.room) : null;
  if (span)
    cans = cans.filter(
      (c) => c.rest !== undefined || (c.x >= span.lo && c.x <= span.hi),
    );
}

/** the heads creatures have shed — {@link HEAD} */
export let heads: Head[] = [];

/**
 * `0x4208e0` — a head off a dying creature, at the creature's own point
 * (`obj+6`) moved along its facing, with the velocity its death hands over
 * ({@link HEAD}'s `sheds`). Mode 1 says index 5 as it is made (`0x420951`).
 */
export function shedHead(e: Enemy, mode: 0 | 1): void {
  const lvl = level;
  if (!lvl) return;
  const tag = mode === 0 ? HEAD.hop : HEAD.roll;
  // no art, no head: the zombie's are in GRAVE and CAVERN, igor's in RAVECAVE
  if (!tag.cels.every((id) => lvl.sbk.byId.has(id))) return;
  const s = HEAD.sheds[mode];
  const at = foeAnchor(e, lvl) ?? { x: e.x, y: e.y };
  const vx = s.vx * e.facing;
  heads.push({
    x: at.x + s.dx * e.facing,
    y: at.y + s.dy,
    vx,
    vy: s.vy,
    // `0x42090c` — `obj+0x28 = 1` when the x it was handed is negative
    west: vx < 0,
    mode,
    clock: 0,
    down: false,
  });
  if (mode === 1) sound?.effect(HEAD.rollSound, at.x, at.y);
}

/**
 * `0x420090` — the player's foot on a zombie's head: `0135 basketball`, four
 * hundred points, a green ball where it was, and `return 1`, so `0x430470`
 * trades the blow with it at the head's divisor of five.
 */
export function kickHead(h: Head, blow: { dx: number; dy: number }): void {
  sound?.effect(HEAD.kickSound, h.x, h.y);
  stats.score += HEAD.award;
  pops.push({ x: h.x, y: h.y, age: 0 });
  const v = knockback(
    DIVISOR,
    HEAD.divisor,
    { dx: blow.dx * p.facing, dy: blow.dy },
    { vx: p.vx, vy: p.vyRaw },
    { vx: h.vx, vy: h.vy },
  );
  h.vx = v.vx;
  h.vy = v.vy;
  p.vx = v.hvx;
  if (!p.onGround) p.vyRaw = v.hvy;
}

/**
 * The heads, one engine frame at a time, in the frame's own order: every
 * object's script is stepped first (`0x42fc2f`, `0x42fc4b` call `0x45d0f0`)
 * and the mover runs last (`0x42fd56`), so the think reads the landing the
 * mover has just left ({@link HEAD}).
 *
 * The step counts the hold down BEFORE it reads a record (`0x45d121`), and
 * `0x45d090` sets that count to the script's rate: so the first record shows
 * for one step, not two, and `0x45d1a3` adds its `dx / divisor` and
 * `dy / divisor`, rounded away from zero, into the velocity once — `dx`
 * turned round for a head facing west (`0x45d18c`).
 */
export function stepHeads(): void {
  const lvl = level;
  if (!lvl) return;
  heads = heads.filter((h) => {
    const tag = h.mode === 0 ? HEAD.hop : HEAD.roll;
    const len = tag.cels.length * tag.hold;
    h.clock += 1;
    const i = Math.min(tag.cels.length - 1, Math.floor(h.clock / tag.hold));
    const dx = tag.dx[i];
    const dy = tag.dy[i];
    if (dx) h.vx += roundAway(dx / HEAD.divisor) * (h.west ? -1 : 1);
    if (dy) h.vy += roundAway(dy / HEAD.divisor);
    h.down = looseStep(h, {
      foot: celFoot(headCel(h)),
      bounce: HEAD.bounce,
      drag: 0,
      weight: HEAD.weight,
    }).down;
    // `0x41ffc9` — out of the player's reach, and `0x41ffde` — going the
    // other way from the way it faces
    if (Math.abs(p.x - h.x) > HEAD.range) return false;
    if (h.west ? h.vx > 0 : h.vx < 0) return false;
    if (h.mode === 0) {
      // `0x420010` — standing: index 0x13 and tag 0 again, and so the hop
      if (h.down) {
        sound?.effect(HEAD.bounceSound, h.x, h.y);
        h.clock = 0;
      }
    } else if (h.clock >= len) {
      // `0x42003f` — the roll ran out: tag 1 again, and index 5 again
      h.clock = 0;
      sound?.effect(HEAD.rollSound, h.x, h.y);
    }
    return true;
  });
}

/** the cel a head is showing — {@link HEAD} */
export function headCel(h: Head): number {
  const tag = h.mode === 0 ? HEAD.hop : HEAD.roll;
  return tag.cels[Math.min(tag.cels.length - 1, Math.floor(h.clock / tag.hold))];
}

/** the cel a can is showing — {@link CAN} */
export function canCel(c: Can): number {
  if (c.rest !== undefined) return c.rest;
  const a = c.tag === 0 ? CAN.tumble : CAN.settle;
  if (c.tag >= 2) return CAN.rests[c.tag - 2] ?? CAN.rests[0];
  return a.cels[Math.min(a.cels.length - 1, Math.floor(c.clock / a.hold))];
}

/**
 * `0x426346` — how many of a summoned class may be alive before the creator
 * refuses.
 *
 * It is a test on the class's own object list (`[0x46ecc4]`, the bats') and it
 * is `jg`, so the sixteenth still gets made and the seventeenth does not.
 */
export const HATCH_CAP = 0x10;

/**
 * One of another class's creatures, let go where a machine says — `0x426340`.
 *
 * Everything {@link spawnIn} does from a record, done from a point instead: the
 * cel-presence test, the anchor conversion through the class's own first gait
 * cel, and the rect the thing will patrol — which is the SUMMONER's, not one of
 * its own. What it deliberately does NOT do is consult {@link Foe.wake}: the
 * creator installs the flight outright, so a summoned thing is awake.
 */
export function hatchAt(owner: Enemy, kind: string, at: Hatch): void {
  const lvl = level;
  if (!lvl) return;
  const foe = FOES[kind];
  if (!foe) return;
  // it goes on the list of the room it was let go IN — and one let go in no
  // room at all stays with its thrower. The creator gives every summoned thing
  // region -1 (`0x426378`), which `0x40bbd0` answers with a world-sized rect and
  // no floor, and the mover files it by its point once that point is in a
  // region's rect (`0x43000a`); until then it flies on with the rest of the
  // class. TOWER's bishop throws bats past its room's east wall, and the
  // nearest-floor lookup ({@link roomAt}) filed those in the first room, where
  // they were out of the fight for good.
  const inside = lvl.rooms.findIndex(
    (r) => at.x >= r.left && at.x < r.right && at.y >= r.top && at.y < r.bottom,
  );
  const room = inside >= 0 ? inside : lvl.spawned.findIndex((pool) => pool.includes(owner));
  if (room < 0) return;
  const pool = lvl.spawned[room];
  // the creator's own cap, counted the way it counts: the count word of the
  // class's one object list (`[0x46ecc4]+4`), which holds every one of the
  // class in the level and not only this room's
  const alive = lvl.spawned.reduce(
    (n, r) => n + r.filter((q) => q.kind === kind).length,
    0,
  );
  if (alive > HATCH_CAP) return;
  if (!everyAnim(foe).every((a) => a.cels.every((id) => lvl.sbk.byId.has(id))))
    return;
  // ...and no anchor conversion, which {@link spawnIn} has to do. A record's
  // point is the cel's anchor and this page carries a foe by its FEET; but the
  // caller here is a brain, and `e.x`/`e.y` are already feet. Converting would
  // move every summoned thing by half a body.
  pool.push({
    kind,
    x: at.x,
    y: at.y,
    facing: at.facing,
    // `0x4263af`/`0x4263b1` — AI+4 and AI+8 are the THROWER's two rect corners
    left: owner.left,
    right: owner.right,
    top: owner.top,
    bottom: owner.bottom,
    // it has no record, so the point it can be sent back to is where it was let go
    home: at.x,
    param: 0,
    // `0x4263cb` installs the flight, never the dormant cel
    asleep: undefined,
    decisions: foe.drives?.decisions,
    clock: 0,
    state: "gait",
    anim: foe.gait,
    linger: 0,
    dents: 0,
    vx: at.vx ?? 0,
    vy: 0,
    hp: foe.health,
    max: foe.health,
  });
}

/**
 * The roller, built where a keeper says and not moving yet — `0x43a790`.
 *
 * The latch is the length of this array: `[0x474868]` is set here and cleared
 * on the frame the thing is launched, so what it forbids is a second one
 * WAITING, and {@link stepRollers} drops the waiter from the count the moment
 * it rolls.
 */
export function rollerAt(x: number, y: number, vx: number): void {
  const lvl = level;
  if (!lvl) return;
  if (!lvl.sbk.byId.has(ROLLER.waits)) return;
  // `0x43a793` — one may be waiting, and it is never two
  if (rollers.some((r) => r.wait >= 0)) return;
  rollers.push({
    x,
    y,
    vx: 0,
    vy: 0,
    launch: vx,
    still: true,
    wait: ROLLER.wait,
    clock: 0,
  });
  // `0x43a82c` — through `0x40f090`, the mixer's channel 0
  sound?.effect(ROLLER.bornSound, x, y, "lead");
}

/**
 * The rollers, one engine frame each — `0x43a960`, then the mover.
 *
 * Forty-one frames of sitting on cel 1970, and then `0x43a9c4` hands the stored
 * velocity to `0x42f8b0`, which adds `-480/7` rounded away from zero — sixty-nine
 * — to `obj+0xc` once. From the first frame to the last it is in the same mover
 * as everything else ({@link looseStep}): no `0x42f850`, so the allocator's
 * weight of ten brings it down onto the floor whatever height it was built at,
 * and `0x43a7c8`'s drag of a tenth comes off every frame it stands. So it
 * leaves fast and slows — about six hundred pixels before `0x43a986` stops
 * counting it as a blow, which is the six hundred it was built away at.
 */
export function stepRollers(): void {
  for (const r of rollers) {
    if (r.wait >= 0) {
      // `0x43a99f` — the countdown, and the launch is the frame it goes under
      r.wait -= 1;
      if (r.wait < 0) {
        r.vx += roundAway(r.launch / ROLLER.divisor);
        sound?.effect(ROLLER.sound, r.x, r.y);
      }
    } else r.clock += 1;
    r.still = looseStep(r, {
      foot: celFoot(rollerCel(r)),
      bounce: LOOSE_BORN.bounce,
      drag: Math.trunc(ROLLER.friction * 8192),
      weight: LOOSE_BORN.weight,
    }).still;
  }
  /**
   * ...and nothing in `0x43a960` removes a roller that has merely stopped.
   *
   * State 3 is the only path that answers 1, and that is the one a BLOW puts it
   * in. A roller that slides to a halt is left lying there as scenery with a
   * strength of zero — which is honest, and would also be a slow leak across a
   * long level, so the page adds the guard it adds to every other free object:
   * out of the room's own span and it is gone.
   */
  const span = p.room ? roomSpan(p.room) : null;
  if (span)
    rollers = rollers.filter((r) => r.x >= span.lo && r.x <= span.hi);
}

/**
 * cel 1970 while it waits, and the two of {@link ROLLER.rolls} once it rolls —
 * which `0x43a9f1` puts back on each time they end only while it is not still,
 * so a roller that has stopped keeps the last one.
 */
export function rollerCel(r: RollerBody): number {
  if (r.wait >= 0) return ROLLER.waits;
  const c = ROLLER.rolls;
  const i = Math.floor(r.clock / c.hold);
  if (r.still && i >= c.cels.length) return c.cels.at(-1)!;
  return c.cels[i % c.cels.length];
}

/** what a roller is worth this frame — `0x43a993`, and `0x43aa34` takes it away */
export function rollerBlow(r: Roller): number {
  return r.wait < 0 && Math.abs(r.vx) > ROLLER.fastBlow ? ROLLER.strength : 0;
}

/**
 * How far below its own launch a cast may fall before this page takes it.
 *
 * Not the disc's, and it is the page's own guard. `0x40bbd0` answers `0x7d00`
 * — a floor nothing reaches — off the band of a floorless room, and the region
 * edges (`0x40ba30`) that would hold a thing inside its room are not stepped
 * here; either way what is out there never stands again. A screen and a half
 * is past anything a room can be.
 */
export const FALLS_FOREVER = 1200;

/**
 * Put one in the air — {@link BrainCtx.cast}, called where a class calls its own
 * spawner.
 *
 * The three numbers the spawners share are the three every one of them writes
 * by hand: the thrower's POINT (not its feet), a step along the facing, and a
 * lift. `0x418433`/`0x418440`/`0x41843b` are the spitter's, and the others are
 * the same three instructions with their own constants.
 */
export function spawnCast(e: Enemy, kit: CastKit, aim?: Aim): void {
  const lvl = level;
  if (!lvl) return;
  const at = foeAnchor(e, lvl);
  if (!at) return;
  // the anchor, which is what `obj+6` is — a gob leaves the mouth, not the feet
  castAt(e.x, at.y, e.facing, kit, aim);
}

/**
 * ...and the same from a point rather than from a creature.
 *
 * Not every spawner is called by a class with a {@link Brain}: `0x41c330` is
 * called on one of Boggs' MACHINES, which is an object this page keeps as a
 * fixture rather than as an enemy. The three numbers are the same three.
 */
export function castAt(
  x: number,
  y: number,
  facing: number,
  kit: CastKit,
  aim?: Aim,
): void {
  if (!level) return;
  const bornX = x + facing * kit.ahead + (kit.offX ?? 0);
  const bornY = y - kit.lift;
  casts.push({
    kit,
    x: bornX,
    y: bornY,
    // an aim is already signed and already in the executable's own units, so
    // the facing has had its say before it got here — see {@link Aim}
    vx: aim ? aim.vx : facing * kit.speed,
    // up-positive in the kit, and this page's y grows downward
    vy: -(aim ? aim.rise : (kit.rise ?? 0)),
    facing,
    clock: 0,
    bornX,
    bornY,
    fromX: x,
    fromY: y,
    // a kit with no arming rule is dangerous from the frame it leaves
    armed: kit.arm === undefined,
    spent: false,
  });
}

/** the cel a cast is showing — the last one holds, as a finished script does */
export function castCel(c: Cast): number {
  // ...and one that has landed is playing its own impact and nothing else
  const smash = c.kit.impact;
  if (smash && c.landed !== undefined) {
    const i = Math.min(smash.cels.length - 1, Math.floor(c.landed / Math.max(1, smash.hold)));
    return smash.cels[i];
  }
  // ...and a bounce is a script install too: `0x45566e` puts the burst on and
  // `0x4556a0` puts the flight back, so it plays OVER a thing still in motion
  const burst = c.kit.burst;
  if (burst && c.bounced !== undefined) {
    const i = Math.min(burst.cels.length - 1, Math.floor(c.bounced / Math.max(1, burst.hold)));
    return burst.cels[i];
  }
  // an armed one is its own cel and nothing else: the arming IS a script
  // install, so there is no flight cycle left to be part way through
  if (c.kit.arm && c.armed) return c.kit.arm.cel;
  // the far leg of a throw that comes back loops its own two cels
  const out = c.kit.returns?.out;
  if (out && c.out) return out.cels[Math.floor(c.clock / Math.max(1, out.hold)) % out.cels.length];
  // ...and the way back is the launch and the flight again, from the turn
  return flightCel(c.kit, c.back ?? c.clock);
}

/** the launch, then the flight — looped, or once and then its own loop */
function flightCel(kit: CastKit, clock: number): number {
  const hold = Math.max(1, kit.hold);
  const i = Math.floor(clock / hold);
  if (i < kit.cels.length) return kit.cels[i];
  // the launch has run out: either the flight takes over and loops, or the last
  // cel holds, which is what a finished script does with nobody to reinstall it
  const then = kit.next;
  if (!then) return kit.cels.at(-1)!;
  const since = clock - kit.cels.length * hold;
  const j = Math.floor(since / Math.max(1, then.hold));
  const loop = kit.thenLoop;
  if (!loop) return then.cels[j % then.cels.length];
  if (j < then.cels.length) return then.cels[j];
  const after = since - then.cels.length * Math.max(1, then.hold);
  return loop.cels[Math.floor(after / Math.max(1, loop.hold)) % loop.cels.length];
}

/**
 * The stride the cel showing THIS frame carries, already divided.
 *
 * Every frame the cel is up spends it: `0x45d1a3` hands the current frame's
 * `dx` to `0x42f8b0` on each engine frame, held frames included, and a script
 * that has run out and holds its last cel goes on adding that cel's — which is
 * how Boggs' throw (`0x46e0b8`, dx 50 over 7) keeps gathering speed.
 */
export function castStride(c: Cast): number {
  const hold = Math.max(1, c.kit.hold);
  const div = c.kit.divisor ?? 1;
  const i = Math.floor(c.clock / hold);
  const then = c.kit.next;
  if (i < c.kit.cels.length || !then) {
    const dx = c.kit.strides?.[Math.min(i, c.kit.cels.length - 1)] ?? 0;
    return dx ? roundAway(dx / div) : 0;
  }
  if (!then.strides) return 0;
  const hold2 = Math.max(1, then.hold);
  const since = c.clock - c.kit.cels.length * hold;
  const j = Math.floor(since / hold2) % then.cels.length;
  const dx = then.strides[j] ?? 0;
  return dx ? roundAway(dx / div) : 0;
}

/** what it would hit for — zero until it arms, which is the slug's whole design */
export function castBlow(c: Cast): number {
  if (!c.armed) return 0;
  // `0x43c866` — `obj+0x2a` set, and the strength is held at nothing
  if (c.struck) return 0;
  // ...and the one whose flight is a dud is worth nothing until it bursts —
  // `0x452ec0` is where the hundred and one is written, and it is the burst's
  // own state that writes it. See {@link CastKit.onImpact}.
  if (c.kit.onImpact && c.landed === undefined) return 0;
  // ...and the ones that bounce are worth nothing once they have slowed down —
  // `0x4556d3`, which picks between `obj+0x1a = 0x64` and `obj+0x1a = 0`
  const fast = c.kit.fastBlow;
  if (fast !== undefined && Math.abs(c.vx) < fast && Math.abs(c.vy) < fast) return 0;
  return c.kit.blow;
}

/**
 * ...and a CODE landing on one — the same hit loop run at a cast instead of at
 * a creature, for the two classes that have anything to say about it.
 *
 * A creature goes to {@link strikeFoe} and reads its −9 out of {@link
 * Foe.burns}. A cast has no class module, no health and no reaction table, so
 * what answers for it is the handler its own kit carries — `obj+0x12`, which
 * `0x45554f` installs on the fireball and `0x452c83` on MOLITOV's shot. See
 * {@link CastKit.onCode}.
 *
 * `0x4303b3` comes first: a victim whose current cel has no body box is passed
 * over before its handler is looked at. Every fireball cel carries one; of
 * MOLITOV's shot only the flight does, so a shot that is already bursting is
 * handed nothing.
 *
 * The context is built per blow rather than shared the way `BRAIN_CTX` is,
 * because a hit handler is called once and about one thing: it needs no name
 * for the cast it is already holding.
 */
export function strikeCast(c: Cast, code: number): boolean {
  const own = c.kit.onCode;
  // no handler here: the blow is read by nobody and the thing carries on — the
  // executable's own answer for everything in the air but the fireball and
  // MOLITOV's shot
  if (!own) return false;
  if (!level || !celRec(level.sbk, castCel(c))?.body) return false;
  const k: CastCtx = {
    burn: (how) => burnCast(c, how ?? {}),
    burst: () => burstCast(c),
  };
  return own(c, code, k);
}

/**
 * ...and one as a VICTIM, which is the only thing that ever asks a cast for a
 * box other than the strike box it hits WITH.
 *
 * The body box if its art carries one, mirrored by the facing the way
 * {@link hurtBox} mirrors a creature's; otherwise the bitmap where
 * {@link drawLevelCel} puts it, which is the rect `0x42f9f0` builds.
 */
export function castHurtBox(
  c: Cast,
  art: SbkCel,
): { top: number; left: number; bottom: number; right: number } {
  const b =
    c.facing < 0 && art.body
      ? { ...art.body, x0: -art.body.x1, x1: -art.body.x0 }
      : art.body;
  if (b)
    return {
      left: c.x + b.x0,
      right: c.x + b.x1,
      top: c.y + b.y0,
      bottom: c.y + b.y1,
    };
  const left = c.facing < 0 ? c.x - (art.width - art.posX) : c.x - art.posX;
  return {
    left,
    right: left + art.width,
    top: c.y - art.posY,
    bottom: c.y - art.posY + art.height,
  };
}

/**
 * A free object as the engine's mover sees it: a point and the velocity it
 * spends on it, in whole pixels an engine frame.
 */
export interface Loose {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * The four words of a free object that `0x42fd80` reads, each already in the
 * engine's own units.
 */
export interface LooseBuild {
  /**
   * How far under its point it meets the floor: the cel word +0x26 plus
   * `obj+0x10` (`0x42fdcf`/`0x42fdd7`) — the CURRENT cel's drawn extent below
   * its anchor, the way {@link baseOf} measures a creature.
   */
  foot: number;
  /**
   * `obj+0x20`, the word. The allocator writes `0x800` (`0x42f5c0`) — a quarter
   * kept the same way, which is a stop — and `0x42f7f0(obj, f)` writes
   * `f × −8192.0` (`0x46a10c`), which is where a bounce's flip lives.
   */
  bounce: number;
  /**
   * `obj+0x1e`, the word: the allocator's `0x1666` (`0x42f5ba`), or
   * `0x42f7a0(obj, f)`'s `f × 8192.0` (`0x46a108`). It is the share TAKEN OFF —
   * see {@link dragged}.
   */
  drag: number;
  /** `obj+0x24`: the allocator's ten (`0x42f5ca`), or `0x42f850`'s `f × 10` */
  weight: number;
  /**
   * `obj+0x34` — does the platform pass (`0x42fe4a`) run for it. The allocator
   * writes zero (`0x42f5a7`), and of the free objects only MOLITOV's shot turns
   * it on (`0x452c96`).
   */
  ledges?: boolean;
}

/** `0x42f5ba` / `0x42f5c0` / `0x42f5ca` — what every object is born with */
export const LOOSE_BORN = { bounce: 0x800, drag: DRAG, weight: 10 } as const;

/** a velocity through `obj+0x20` — `0x42ff83`'s `imul` and `sar 13`, toward zero */
export function restitute(v: number, word: number): number {
  return Math.trunc((v * word) / 8192);
}

/**
 * The region floor under x, the way `0x40bbd0` answers it.
 *
 * Past either end of a floor it answers the end sample rather than nothing
 * (`0x40bc34`, `0x40bc4c`); a region with no floor of its own is flat at its top
 * plus the drop, fifty in from each end (`0x40bc7d`), and `0x7d00` outside that
 * (`0x40bcc5`) — a floor nothing ever reaches, which is null here.
 */
export function looseFloor(x: number): number | null {
  const room = p.room;
  if (!room) return null;
  const xi = Math.round(x);
  const g = room.ground;
  if (!g)
    return xi >= room.left + 50 && xi < room.right - 50
      ? room.top + room.floorDrop
      : null;
  if (!g.ys.length) return null;
  return g.ys[Math.max(0, Math.min(g.ys.length - 1, xi - g.x0))];
}

/**
 * One engine frame of `0x42fd80` for a free object — a cast, a can, a board.
 *
 * The same mover every object in the game runs through, in its own order:
 *
 * - the velocity into the point, whole (`0x42fd9e`/`0x42fda7`);
 * - the floor under the NEW point, less the foot (`0x42fde7`), and the ledges
 *   above it for a thing that stands on them (`0x42fe76`: `x0 ≤ x ≤ x1`, the
 *   ledge's bottom at or under the foot as it was, the highest top wins);
 * - a floor more than fifty above the foot is a WALL (`0x42fedc`): the old point
 *   back, a step of the old `vx` further back, `vx` through `obj+0x20`, `vy`
 *   zeroed, the collision word set and the thing counted as standing;
 * - within eight of the floor, or anywhere under it, it is ON it
 *   (`0x42ff4c`): put on it, and `vy` zeroed inside ±2 (`0x42ff6f`) or sent
 *   through `obj+0x20` with the collision word set;
 * - standing, `obj+0x1e` comes off `vx` (`0x4302c0`); airborne, `obj+0x24`
 *   goes on `vy` for the next frame (`0x430327`) — so the weight is spent AFTER
 *   the step, and never on a frame it lands.
 *
 * Returns `obj+0x2e`, `obj+0x2c` and `obj+0x30`, which are what the classes'
 * thinks read.
 * The region's own edges (`0x40ba30`) and the obstacle pass (`0x430146`, which
 * only the cop's slug and MOLITOV's shot turn on) are not stepped here.
 */
export function looseStep(
  o: Loose,
  b: LooseBuild,
): { down: boolean; struck: boolean; still: boolean } {
  let x = o.x + o.vx;
  let y = o.y + o.vy;
  let down = false;
  let struck = false;
  const oldFoot = o.y + b.foot;
  const floorAt = (at: number): { y: number; ledge: boolean } | null => {
    const g = looseFloor(at);
    let best = g === null ? null : g - b.foot;
    let ledge = false;
    if (b.ledges)
      for (const room of level?.solids ?? [])
        for (const e of room.platforms) {
          if (at < e.left || at > e.right || e.bottom < oldFoot) continue;
          const top = e.top - b.foot;
          if (best === null || top < best) {
            best = top;
            ledge = true;
          }
        }
    return best === null ? null : { y: best, ledge };
  };
  let floor = floorAt(x);
  if (floor && !floor.ledge && floor.y + 50 < y) {
    down = true;
    struck = true;
    y = o.y;
    x = o.x - o.vx;
    o.vx = restitute(o.vx, b.bounce);
    o.vy = 0;
    floor = floorAt(x);
  }
  if (floor && floor.y - 8 <= y) {
    down = true;
    y = floor.y;
    if (Math.abs(o.vy) <= 2) o.vy = 0;
    else {
      o.vy = restitute(o.vy, b.bounce);
      struck = true;
    }
  }
  o.x = x;
  o.y = y;
  // `0x4302c7` — a drag of zero or less is not spent at all
  if (down && b.drag > 0) o.vx = dragged(o.vx, b.drag);
  // `0x4302fd` — `obj+0x30`, still in both axes, read before the weight goes on
  const still = o.vx === 0 && o.vy === 0;
  if (!down) o.vy += b.weight;
  return { down, struck, still };
}

/** a cel's word +0x26 in this page's terms — its drawn extent below the anchor */
export function celFoot(id: number): number {
  const c = level ? celRec(level.sbk, id) : undefined;
  return c ? c.height - c.posY : 0;
}

/**
 * The casts, one engine frame at a time.
 *
 * Each is a free object in the engine's own mover — {@link looseStep}, with its
 * current cel's foot, its class's restitution and drag where the kit carries
 * them, and its class's own weight — and what ends one is its class's think:
 * the standing word `obj+0x2e` for the classes that test it ({@link
 * CAST_LANDS}), coming to rest for the two that do instead, and the reach, the
 * life, the range or the passing that each kit carries. The player is the one
 * collision spent elsewhere, in {@link takeHits}.
 */
export function stepCasts(): void {
  const lvl = level;
  if (!lvl) return;
  for (const c of casts) {
    // ...a landed one is only playing itself out
    if (c.landed !== undefined) {
      c.landed += 1;
      const smash = c.kit.impact;
      // ...for its own count where it keeps one (`0x43cafb`), else its impact
      const lie = c.kit.lieFor;
      if (lie !== undefined ? c.landed > lie + 1 : !smash || c.landed >= smash.cels.length * Math.max(1, smash.hold))
        c.spent = true;
      continue;
    }
    // ...a bounce's burst runs on its own clock and hands the flight back
    if (c.bounced !== undefined) {
      c.bounced += 1;
      const burst = c.kit.burst;
      if (!burst || c.bounced >= burst.cels.length * Math.max(1, burst.hold)) c.bounced = undefined;
    }
    // ...the one that steers, in its think and so before anything moves it:
    // `0x4422b2` leans into the facing and reaches for a point above the
    // player, both deltas through the class's divisor
    const home = c.kit.home;
    if (home) {
      c.vx += roundAway((c.facing * home.along) / home.divisor);
      c.vy += roundAway(Math.trunc((p.y - c.y - home.lead) / home.drop) / home.divisor);
    }
    // ...and the one class that bounds what it may become — `0x452d4d`, at the
    // top of its think
    if (c.kit.capFall !== undefined)
      c.vy = Math.max(-c.kit.capFall, Math.min(c.kit.capFall, c.vy));
    // ...the stride this frame's cel carries, if its script carries any.
    // `0x42f8b0` adds `dx / obj+0xe` to the velocity as each frame comes round,
    // rounded away from zero, and what it adds stays added
    const stride = castStride(c);
    if (stride) c.vx += c.facing * stride;
    c.clock += 1;
    if (c.back !== undefined) c.back += 1;
    // the throw that comes back — {@link CastKit.returns}: the fork as the
    // launch cel ends (`0x43c917`), and the turn once it is far enough out
    const turn = c.kit.returns;
    if (turn) {
      if (c.back === undefined && !c.out && c.clock === c.kit.cels.length * Math.max(1, c.kit.hold))
        c.out = roll(turn.of) < turn.odds;
      if (c.out && Math.abs(c.fromX - c.x) > turn.far) {
        c.out = false;
        c.back = 0;
        c.facing = -c.facing;
        c.vy = 0;
        c.y = c.fromY + turn.drop;
        // `0x43c9ca`/`0x43c9cf` zero both speeds and `0x43c9e5` puts `0x4748c8`
        // on — and the think runs before the frame's script step (`0x42fc10`
        // after `0x430f10`), whose `0x45d0f0` spends the new tag's first frame
        // at once: its `dx 80` is read off the frame index the step ENTERS with
        // (`0x45d105`) and handed to `0x42f8b0` (`0x45d1a3`) that same frame,
        // before the move. So the zero never survives a frame, and it moves
        // back by eighty on the frame it turns
        c.vx = c.facing * turn.speed;
      }
    }
    // the whoosh, every frame it is in the air — see {@link CastKit.hum}
    const hum = c.kit.hum;
    if (hum !== undefined) {
      sound?.effect(hum, c.x, c.y);
      sound?.loop(hum, true);
    }
    // ...and the mover, whole pixels on the ENGINE frame, like the bolts — see
    // {@link CastKit.speed}
    const moved = looseStep(c, {
      foot: celFoot(castCel(c)),
      bounce:
        c.kit.bounce !== undefined ? Math.trunc(c.kit.bounce * -8192) : LOOSE_BORN.bounce,
      drag: c.kit.friction !== undefined ? Math.trunc(c.kit.friction * 8192) : LOOSE_BORN.drag,
      // absent is weightless: every class without one calls `0x42f850(obj, 0)`
      weight: c.kit.pull ?? 0,
      ledges: c.kit.onImpact === true,
    });
    const dx = Math.abs(c.x - p.x);
    // the class's own end, whichever of the two it keeps
    if (c.kit.reach !== undefined && dx > c.kit.reach) c.spent = true;
    if (c.kit.life !== undefined && c.clock > c.kit.life) c.spent = true;
    if (c.kit.range !== undefined && Math.abs(c.x - c.bornX) > c.kit.range) c.spent = true;
    // ...or it has gone by: `0x442306`/`0x44231a`, the homing shot's own end
    if (c.kit.past && ((c.vx < 0 && c.x < p.x) || (c.vx > 0 && c.x > p.x))) c.spent = true;
    // ...and its own arming, which never goes back
    if (c.kit.arm && !c.armed && dx < c.kit.arm.within) c.armed = true;
    // ...and the page's own guard: off the band of a floorless room `0x40bbd0`
    // answers `0x7d00`, a floor nothing reaches, and a thing out there would
    // fall for the rest of the level
    if (c.y - c.bornY > FALLS_FOREVER) c.spent = true;
    // a whoosh whose thing is gone some other way than landing: this page's
    // own ends, above — the engine's throw only ends by landing — let it go
    if (hum !== undefined && c.spent) sound?.loop(hum, false);
    if (!moved.down) continue;
    if (c.kit.bounce !== undefined) bounceCast(c);
    // `0x452e00` / `0x452e79` — MOLITOV's shot goes off once it is standing
    // still, not the frame it first meets the floor
    else if (c.kit.onImpact) {
      if (moved.still) landCast(c);
    } else if (CAST_LANDS.has(c.kit)) landCast(c);
  }
  chainCasts();
  casts = casts.filter((c) => !c.spent);
}

/**
 * The casts whose own think ends them on the mover's standing word `obj+0x2e`
 * — which the wall case sets as well as the floor (`0x42fef3`).
 *
 * The bone and Igor's throw (`0x41fd54`), the cop's slug (`0x413deb`), the
 * bishop's bolt (`0x426dc1`), Boggs' throw (`0x41aa36`), the hardcore's
 * (`0x43c8c0`) and the tube's shards (`0x41902c`). The eyeball's glob tests
 * `obj+0x30` instead (`0x43dc3d`), but its drag is a whole 1.0 (`0x43db79`), so
 * the frame it stands is the frame it is still.
 *
 * And the rest do NOT: the zombie's gob (`0x4201e0`), the wraith's beam
 * (`0x424620`), the tube's breath (`0x41911a`) and Ghengis' blast end on their
 * scripts alone, and Kragg's shot only on landing a blow (`0x442357`) or going
 * by — so the floor does not end any of those.
 */
export const CAST_LANDS: ReadonlySet<CastKit> = new Set<CastKit>([
  SKEL_BONE,
  IGOR_THROW,
  COP_SLUG,
  VPRIEST_BOLT,
  BOGGS_THROW,
  HARDCORE_THROW,
  HARDCORE_THROW_LOW,
  ...EYEBALL_GLOBS,
  ...TUBE_SHARDS,
]);

/**
 * `0x430367` run with a CAST as the hitter and the other casts as victims —
 * which is how one of MOLITOV's shots going off sets off the next.
 *
 * `0x452ec0` gives a burst the strength `0x65`, and `0x430443` is why it
 * matters: every other strength is zeroed after the first victim that answers
 * 1, and `0x65` alone stays on the hitter, so a burst hits everything its box
 * covers for as long as its cels carry one (7000..7002). What reads it is
 * `0x452f8d`, the shot's own handler, through {@link strikeCast} — which also
 * makes `0x4303b3`'s body-box test, so a shot already bursting is passed over.
 *
 * Only `0x65` goes round here. The other casts' blows are the player's
 * business in {@link takeHits}, and no other cast on this page is worth `0x65`.
 */
export function chainCasts(): void {
  const lvl = level;
  if (!lvl) return;
  for (const a of casts) {
    if (a.spent || castBlow(a) !== CHAIN_BLOW) continue;
    const cel = celRec(lvl.sbk, castCel(a));
    const box = cel && strikeOf(cel, a.x, a.y, a.facing);
    if (!box) continue;
    for (const b of casts) {
      if (b === a || b.spent || !b.kit.onCode) continue;
      const art = celRec(lvl.sbk, castCel(b));
      if (!art) continue;
      const hurt = castHurtBox(b, art);
      if (!(
        box.right > hurt.left &&
        box.left < hurt.right &&
        box.bottom > hurt.top &&
        box.top < hurt.bottom
      ))
        continue;
      const was = b.landed;
      strikeCast(b, CHAIN_BLOW);
      // for the status line: a burst this one did not start on its own
      if (was === undefined && b.landed !== undefined) b.setOff = true;
    }
  }
}

/** `0x430443`'s `cmp word ptr [esi+0x1a], 0x65` — the strength a hit leaves standing */
export const CHAIN_BLOW = 0x65;

/**
 * It is standing and it is one of the ones that comes back up.
 *
 * {@link looseStep} has already done the mover's half — put it on the floor,
 * sent `vy` back through its negative `obj+0x20` and taken its drag off `vx`.
 * What is left is the class's: `0x45566e` puts the burst on every frame it
 * stands in flight, and `0x4555e9` removes it once it is standing with no `vx`
 * and a `vy` inside its rest.
 */
export function bounceCast(c: Cast): void {
  c.bounced = 0;
  const rest = c.kit.rest;
  if (rest !== undefined && c.vx === 0 && Math.abs(c.vy) <= rest) landCast(c);
}

/**
 * It has met something — the ground here, or the player in {@link takeHits}.
 *
 * `0x41fd7b` is the shape: a collision word set, and the class installs its
 * impact script at `tag + 1` rather than looping its flight. A class with none
 * of that is simply gone, which is what the four flat ones do.
 */
export function landCast(c: Cast): void {
  // `0x43c8e1`..`0x43c8f9` — a whoosh lets its loop go and falls silent as it lands
  if (c.kit.hum !== undefined) {
    sound?.loop(c.kit.hum, false);
    sound?.mute(c.kit.hum);
  }
  if (!c.kit.impact) {
    c.spent = true;
    return;
  }
  burstCast(c);
}

/**
 * Put its impact on, from the first frame — `0x45d090`, which rewinds whatever
 * was playing — and announce it the way its class does.
 *
 * The one path for all three things that set an impact off: the ground, the
 * player in {@link takeHits}, and a blow its own handler answers with a burst
 * ({@link CastCtx.burst}). {@link CastKit.bang} is MOLITOV's shot's sound and
 * `0x452ef0`'s flash and shake; the flash is the closest of its three bands,
 * both axes strictly inside, and the shake falls off through all three.
 */
export function burstCast(c: Cast): void {
  c.landed = 0;
  c.vx = 0;
  c.vy = 0;
  const bang = c.kit.bang;
  if (!bang) return;
  // `0x452e19`, `0x452e99`, `0x452fa5`, `0x452fea` — all four `0x40f090`, the
  // mixer's channel 0
  sound?.effect(bang.sound, c.x, c.y, "lead");
  const dx = Math.abs(p.x - c.x);
  const dy = Math.abs(p.y - c.y);
  const near = dx < bang.near.x && dy < bang.near.y;
  if (near) setFlashColour(bang.flash);
  // `0x452f38` / `0x452f52` / `0x452f6c` — the closest band that holds it
  if (bang.shakes) {
    if (near) shake(3);
    else if (dx < 0x2ee && dy < 0x12c) shake(2);
    else if (dx < 0x4b0 && dy < 0x1f4) shake(1);
  }
}

/**
 * The wake — `0x434200(playerPoint, AI+6)` every frame while asleep: one cel,
 * no motion, until the player's point is inside the record's rect. Returns true
 * while it is still asleep and has taken the frame.
 */
export function wakeFoe(e: Enemy, foe: Foe): boolean {
  if (!foe.wake) return false;
  const ay = p.y - p.feet;
  const inside = p.x >= e.left && p.x < e.right && ay >= e.top && ay < e.bottom;
  if (!inside) return true;
  e.asleep = false;
  e.mode = undefined;
  // a kind with no stirring of its own simply starts walking
  e.anim = foe.wake.stir ?? foe.gait;
  e.clock = 0;
  if (foe.wake.sound !== undefined) sound?.effect(foe.wake.sound, e.x, e.y);
  return false;
}

/**
 * The fight — `0x45efd0`'s tracker and state 1's band dispatch, for the
 * twenty-six classes that have one. See {@link file://../fights.ts} for the
 * mechanism and where each number comes from.
 *
 * Returns true when it has taken the frame; false leaves the ordinary gait block
 * to move it, which is how a closing walk travels by its own `dx`.
 *
 * **Nothing here takes a single point of health off the player.** The attacks
 * choose themselves, travel and land where the scripts say, and the engine's own
 * damage word `0x4ac3d0` is not reached from any of it.
 */
/**
 * Does this class's own walk carry a stride?
 *
 * LAB's `initarm` is why it is asked. Its `0x46cf10` tag 0 is seven cels of an
 * arm reaching out of a wall and back, with no `dx` on any of them, and the
 * class's data does hold a script that travels — but the thing the level places
 * never installs it. Giving it one had ten arms crawling across the floor, and
 * letting its ATTACK's own `dx 200, dy -200` move it threw each one off the wall
 * and down the level. So a class the book reads as standing still keeps standing
 * still, in the fight as much as out of it.
 */
export function travels(foe: Foe): boolean {
  return foe.gait.dx?.some((n) => n !== 0) ?? false;
}

/** the other modules' writes into this one's state — ES imports are read-only */
export function setCasts(v: typeof casts): void {
  casts = v;
}
export function setSkates(v: typeof skates): void {
  skates = v;
}
export function setRollers(v: typeof rollers): void {
  rollers = v;
}
export function setCans(v: typeof cans): void {
  cans = v;
}
export function setHeads(v: typeof heads): void {
  heads = v;
}
export function setFlames(v: typeof flames): void {
  flames = v;
}
