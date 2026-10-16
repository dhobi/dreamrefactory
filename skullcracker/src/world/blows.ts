/**
 * A blow and what it does: the strike box, the strength and the knockback, a
 * creature's hurt box, the player's stats and act, killing a foe, and the spray,
 * blood and sparks a hit leaves.
 */
import { SbkCel, arrivalIn } from "@dreamfactory/engine/df/sbk";
import { FOES, type Foe } from "../foes";
import { TICK_SCALE, type Enemy } from "../brains/kit";
import { BLEED, Gob, Pop, SPARK, Spark, SPRAY, VANISH, dropCount, dryTime, gobCount, scatter } from "../effects";
import { FOE_SFX } from "../sound";
import { GRAB, WEAPONS } from "../guns";
import { CLOCK_FULL, HudFighter } from "../hud";
import { random } from "../random";
import { p, level, player, type Level, HURT, DIFFICULTY, BLOW_CODES, HELD, ACTIONS, sound } from "./state";
import { playerBox, celRec, lastCel, foeAnchor, baseOf, celOf } from "./cels";
import { dropAt, corpseFrames, groundAt } from "./rooms";
import { gunAhead, inv } from "./arsenal";

/**
 * The three flags {@link waitsFor} reads: `[0x472574]` (`hardcore`),
 * `[0x46ece0]` (`belfry`) and `[0x46bfbc]` (`lab`).
 */
export const bossDown = { hardcore: false, belfry: false, lab: false };

/**
 * Press up in an `exitroom` and you are in the room its param names.
 *
 * Press, not touch. Two builds tried touching — first plain contact, which
 * bounced the player between the street and the basement for as long as an arrow
 * was held, then contact plus the direction the door's point implies, which
 * stopped the bouncing and trapped the player in the basement instead. Both fail
 * for the same reason, and the file says why: STREETS' street door stands
 * between the spawn and the goal, and its own arrival point is eight pixels
 * beyond its right edge while the player is a hundred wide. You always come out
 * of a door still standing in it. So entering one has to be something you do.
 */
export function takeDoor(): boolean {
  const room = p.room;
  if (!room || !level) return false;
  const b = playerBox();
  const hit = room.exits.find(
    (e) =>
      b.right >= e.left &&
      b.left <= e.right &&
      b.bottom >= e.top &&
      b.top <= e.bottom,
  );
  if (!hit) return false;
  const dest = level.rooms.find((r) => r.param === hit.to);
  if (!dest) return false;
  const at = arrivalIn(dest, room);
  if (!at) return false; // a room with no floor is not somewhere to be put
  /**
   * `0x428f63`..`0x42900c`: the record's point goes straight into the ANCHOR
   * (`obj+6` from `[0x4a6990]`, what `0x40b660` copied out), the view follows
   * it, and nothing touches the floor or the velocity — the mover drops the
   * player onto whatever is under the point. Every shipped arrival stands a
   * few dozen pixels above its floor, so you come through a door and land.
   * The player keeps its facing: it is the same object, unlike a level's
   * start ({@link dropAt}).
   */
  const facing = p.facing;
  dropAt(dest, at.x, at.y);
  p.facing = facing;
  return true;
}

/**
 * The enemies the current act has already struck — one hit per swing, cleared
 * when a new act starts, so a kick that overlaps for six ticks is one hit.
 */
export const struck = new Set<Enemy>();

/**
 * The player's `obj+0x1a`, the percentage `0x42f910` scales a blow by — and it
 * is not a constant. Repeating a move weakens it.
 *
 * Each striking tag's handler calls `0x4029e0(move)` on every frame it runs and
 * stores the answer in `obj+0x1a` ({@link PlayerAction.move} has the numbers):
 *
 * ```
 *   4029eb  if (move == [0x46b1cc] && facing == [0x46b1c8]
 *   402a0f      && now - [0x46b1c4] < 0xf0)            ; 240/60 s: four seconds
 *   402a35    strength -= (move is 2, 5, 7, 12 or 14) ? 25 : 5, floor 20
 *   402a5a  else strength = 100
 *           remember move, facing and now
 * ```
 *
 * `now` is `0x4087c0`, sixtieths of a second, so the window is four seconds of
 * the same move in the same direction; turning round or changing move restores
 * the full blow. The player's init (`0x42e463`) writes 0 there, which nothing
 * hits with, since every blow comes out of a tag that has called this first.
 */
export const blow = { strength: 100, move: -1, facing: 0, at: -Infinity };
/** engine frames since the page opened, in `0x4087c0`'s sixtieths */
export let blowClock = 0;
export function blowStrength(move: number): number {
  if (
    move === blow.move &&
    p.facing === blow.facing &&
    blowClock - blow.at < 0xf0
  ) {
    blow.strength -= [2, 5, 7, 12, 14].includes(move) ? 25 : 5;
    if (blow.strength < 0x14) blow.strength = 0x14;
  } else blow.strength = 100;
  blow.move = move;
  blow.facing = p.facing;
  blow.at = blowClock;
  return blow.strength;
}

/**
 * The strike box of the cel the player is showing this frame, in world
 * coordinates, with the blow it carries — or null, which is most frames.
 *
 * This is the whole of the engine's attack test and it is entirely in the file.
 * A cel record carries a strike rect at +4 and a `(dy, dx)` at +20 ({@link
 * SbkCel.strike}, {@link SbkCel.blow}), 42 of `PLAYER.SBK`'s 1229 cels have them,
 * and they are the impact frames: the punch lands on cels 602 and 604 and the
 * kick on 655, each with a two-dozen-pixel box where the fist or the boot
 * actually is. Every other frame of the animation cannot hit anything.
 *
 * The box is anchor-relative and goes into the world the way {@link strikeOf}
 * puts every hitter's there — `0x40e680`, negated about the anchor on mirror and
 * translated to the object's point, which for the player is `p.x` and the
 * anchor above the art's bottom edge at `p.y`.
 */
export function strikeBox(): {
  top: number;
  left: number;
  bottom: number;
  right: number;
  damage: number;
  blow: { dx: number; dy: number };
} | null {
  if (!player) return null;
  const rec = celRec(player, lastCel);
  if (!rec?.strike || !rec.blow) return null;
  const ay = p.y - rec.height + rec.posY;
  const box = strikeOf(rec, p.x, ay, p.facing)!;
  /**
   * Damage IS speed — `0x42f910`: the cel's pair, scaled by `obj+0x1a` unless
   * that is exactly 100 (`idiv 100` each, truncating), its dx negated on a
   * mirrored striker, plus the striker's own `obj+0xc` and `obj+0xa`, and the
   * integer square root (`0x434630`) of the sum of squares. So a running kick
   * hits harder than a standing one by the speed the run has actually built.
   * The pair is kept facing-relative here because the knockback applies the
   * facing itself.
   */
  const pct = blow.strength;
  const sx = pct === 100 ? rec.blow.dx : Math.trunc((rec.blow.dx * pct) / 100);
  const sy = pct === 100 ? rec.blow.dy : Math.trunc((rec.blow.dy * pct) / 100);
  const dx = sx + p.vx * p.facing;
  const dy = sy + p.vyRaw;
  return {
    ...box,
    damage: Math.floor(Math.sqrt(dx * dx + dy * dy)),
    // the pair itself, because the spray leaves along the blow rather than along
    // its magnitude — `0x40cba0` takes the same `(dy, dx)` this came from
    blow: { dx, dy },
  };
}

/**
 * The velocity a blow leaves the thing it hit with — `0x430470`, the engine's own
 * elastic collision, with `obj+0xe` as the mass.
 *
 * The dispatcher `0x430350` calls the victim's hit handler and then, if the
 * hitter's strength is above nothing, this — for every class, not only the
 * ones that fly. The hitter's side is its blow: the cel's pair scaled by its
 * strength, mirrored, plus its own velocity (`0x4304ab`..`0x4304e3`). Then for
 * each axis, in whole pixels a frame and each term truncated (`0x4305d5`..):
 *
 * ```
 *   victim' = v1·2·m1/(m1+m2) + victim·(m2−m1)/(m1+m2)
 *   hitter' = hitter·(m1−m2)/(m1+m2) + victim·2·m2/(m1+m2)
 * ```
 *
 * with `obj+0xe` as each mass. The player is 12 and a mailbox 7, so a kick's 55
 * comes out as 55 × 24/19 = 69 pixels a frame — which is why the original
 * throws a mailbox most of a screen — and the player's own run is spent on
 * what it hits (`0x430653`). What the victim's think does with the velocity
 * afterwards is its own: the hydrant zeroes it, most classes let the ground's
 * drag take it.
 */
export function knockback(
  m1: number,
  m2: number,
  blow: { dx: number; dy: number },
  hitter: { vx: number; vy: number },
  was: { vx: number; vy: number },
): { vx: number; vy: number; hvx: number; hvy: number } {
  const sum = m1 + m2 || 1;
  const t = Math.trunc;
  return {
    vx: t((blow.dx * 2 * m1) / sum) + t((was.vx * (m2 - m1)) / sum),
    vy: t((blow.dy * 2 * m1) / sum) + t((was.vy * (m2 - m1)) / sum),
    hvx: t((hitter.vx * (m1 - m2)) / sum) + t((was.vx * 2 * m2) / sum),
    hvy: t((hitter.vy * (m1 - m2)) / sum) + t((was.vy * 2 * m2) / sum),
  };
}

/**
 * Where a spawned thing's ANCHOR is, in the world.
 *
 * Every cel carries one (`posX`, `posY`) and `0x4026d0` places a cel so that its
 * anchor lands at the object's position — which is the only thing that makes an
 * animation whose cels are different sizes hold together. The rat's launch is the
 * case that forces this: `0x477090` runs 3040 through 3048 and the cels go from
 * 111x53 to 115x259 to 132x87, and their anchors follow one point on the rat
 * while the art around it looms (3046 reaches 137px ABOVE the anchor) and then
 * drops away (3048's `posY` is −35, so the whole cel hangs BELOW it). Hung from
 * their feet, that animation is a rat growing upwards out of the pavement and
 * off the top of the window.
 *
 * What the object's own y IS in the engine has not been read — the punk's walking
 * cel anchors 63px above its own feet, so it is not the ground. So the anchor is
 * derived from the placement this page already had verified: the GAIT cel, feet on
 * the floor and centred. For the gait that is a no-op, and every other cel of the
 * kind then hangs off the same point the artist kept fixed.
 */
/** `obj+8` — a foe's anchor x, the x every distance in the engine is taken from */
export function anchorX(e: Enemy): number {
  const g = level ? celRec(level.sbk, FOES[e.kind].gait.cels[0]) : undefined;
  return g ? e.x - g.width / 2 + g.posX : e.x;
}

/**
 * The box a spawned thing can be hit IN — its cel's own collision rect where it
 * has one, and the drawn cel where it has not.
 *
 * 741 of `PLAYER.SBK`'s cels carry one and only 43 of those are the cel's own
 * extent, so this is authored art-department data and not a bounding box: the
 * punk's walking frame is 103 wide and its box is 82, tighter on both sides. And
 * the rat's is why nothing standing can hit one: it tops out at `y -14` where the
 * punch's fist box bottoms out at `y -16`.
 */
export function hurtBox(
  e: Enemy,
  c: SbkCel,
  lvl: Level,
): { top: number; left: number; bottom: number; right: number } {
  const a = foeAnchor(e, lvl);
  const b =
    e.facing < 0 && c.body
      ? { ...c.body, x0: -c.body.x1, x1: -c.body.x0 }
      : c.body;
  return a && b
    ? {
        left: a.x + b.x0,
        right: a.x + b.x1,
        top: a.y + b.y0,
        bottom: a.y + b.y1,
      }
    : {
        left: e.x - c.width / 2,
        right: e.x + c.width / 2,
        top: e.y - c.height,
        bottom: e.y,
      };
}

/**
 * What the interface panel shows, and where each figure comes from.
 *
 * The score and the two bars are real: the score is the sum of the awards the
 * classes themselves carry, and the enemy bar is the health `SC.EXE` gives them.
 * The other three are this page standing in for a level script it does not read:
 *
 *   - **lives** start at three of a maximum five (`0x40d400` clamps to five, and
 *     the game's own help screen shows three lit) and never change, because
 *     nothing here can kill the player.
 *   - **the kill quota** is the disc's per-level figure, set through one of the
 *     four script wrappers around `0x40d4a0`; with no script read, this counts
 *     what is still standing in the level instead.
 *   - **the mission clock** is a per-level figure, and it is a RECORD: see
 *     {@link clockFor}.
 */
export const stats = {
  score: 0,
  lives: 3,
  /** `[0x4ac3d0]` and `[0x4ac3d8]` — and only {@link damageOn} ever spends it */
  health: HURT.max as number,
  maxHealth: HURT.maxAt(DIFFICULTY),
  /** what this level stood up with, and how many of them may still stand */
  census: 0,
  allowance: 0,
  /** engine frames left, counted down at the engine's rate */
  ticks: CLOCK_FULL,
  /** `[0x4a3b18]` — the dial's full scale, which is what a gift of time caps at */
  clockFull: CLOCK_FULL,
  /** whoever holds the right-hand bar — sticky, the way `0x46bd28` makes it */
  shown: null as HudFighter | null,
};

/**
 * Land the current act on anything it overlaps, and do to it what the class's
 * own hit handler does.
 *
 * The TEST is the engine's own kind of test — plain rect intersection
 * (`0x434140`) of the two DRAWN cels — so an attack reaches exactly as far as
 * its art does: the kick's 663 is 115 wide against the 71 standing, and that
 * widening is the reach.
 *
 * What follows a landed blow is the handler's own sequence, in its own order
 * (`0x44f0a0` for the punk, and every other one in the game is the same shape):
 * the spray first, then the subtraction, then either the death or a flinch.
 *
 * The strike box and the damage come off the cel ({@link strikeBox}), the
 * health and the award off the class, and the flinch off the handler's own
 * test — which is why a punch and a kick do visibly different things: a punch
 * is 47 and staggers a punk, a kick is 87 and puts it
 * on the ground, because `0x44f1fd` compares the blow with 50. A punk takes six
 * punches or three kicks to its 250.
 *
 * Furniture takes the same path with `Infinity` health: a mailbox flinches and
 * never dies, and `0x44fe80` picks WHICH dent by the same speed — 10 to mark it,
 * 55 to cave it in, so again a punch dents and a kick caves.
 */
/**
 * The animation one act plays, including the two that are not in
 * {@link ACTIONS} because they are not the fists'.
 *
 * `reach` is `0x472360`, the game's one kind-14 script, and `fire` is whichever
 * weapon is in your hands — its own script's wind-up tag followed by whatever
 * it holds afterwards, which for the flare gun is `2720 2721 2722` then `2723`.
 */
export function actOf(name: string): {
  cels: readonly number[];
  dx: readonly number[];
  dy?: readonly number[];
  hold?: number;
  move?: { id: number; held?: number; from: number };
  from: string;
} | null {
  // `0x42f111`: the statscepter is lifted on tag 1, held, not bent for
  if (name === "reach") {
    const cels = gunAhead()?.code === 17 ? GRAB.hold : GRAB.cels;
    return { cels, dx: cels.map(() => 0), from: GRAB.from };
  }
  // the reaction to a blow CODE, straight off the table at `0x4492b8`
  const code = Object.values(BLOW_CODES).find((r) => r.act === name);
  if (code) return { ...code.anim, dx: code.anim.cels.map(() => 0) };
  if (name === "held") return { ...HELD.loop, dx: HELD.loop.cels.map(() => 0) };
  if (name === "struggle")
    return { ...HELD.struggle, dx: HELD.struggle.cels.map(() => 0) };
  // `0x42f3d4` — the lightning's death is tag 3 of the same script
  if (name === "dying" && p.dyingTag === 3 && ACTIONS.dyingStruck) return ACTIONS.dyingStruck;
  if (name === "fire") {
    const w = WEAPONS[inv.weapon];
    if (!w) return null;
    const cels = [...w.moveset.fire, ...w.moveset.shot];
    return { cels, dx: cels.map(() => 0), from: w.moveset.from };
  }
  return ACTIONS[name] ?? null;
}

/**
 * Can a blow reach it at all. The water never — it is not a thing — and a
 * corpse only where its class's handler has no state test and its death is
 * drawn with a body ({@link Foe.corpseTakesHits}); everything else that
 * decides it is the body box of the cel on show, `0x4303b3`.
 */
export function takesBlows(e: Enemy): boolean {
  if (e.state === "burst") return false;
  return e.state !== "dead" || !!FOES[e.kind].corpseTakesHits;
}

/**
 * The end of one — its death sound, {@link Foe.death}, and the award, once.
 *
 * Every class's death path is those three calls in some order: a blow that
 * empties the health, a burn that is {@link Foe.burns}' `dies` or runs out
 * `fatal`. The death sound goes through `0x40f090` rather than `0x40ef30`,
 * which is the same call with a different tail; the port does not tell them
 * apart.
 */
export function killFoe(e: Enemy, foe: Foe): void {
  const death = foe.deathFor?.(e) ?? foe.death;
  if (!death) return;
  if (foe.deathSound !== undefined)
    sound?.effect(foe.deathSound, e.x, e.y, foe.deathLead ? "lead" : "mix");
  e.state = "dead";
  e.anim = death;
  e.clock = 0;
  e.swing = false;
  // `0x45d0a7`, as in {@link react}; and a corpse struck again dies again from
  // the top, its one-shot reactions with it ({@link Foe.corpseTakesHits})
  if (death.kind !== undefined) {
    e.script = death.kind;
    e.tag = death.tag;
  }
  e.threw = false;
  e.linger =
    foe.linger ?? (foe.frail ? 0 : corpseFrames + (foe.lingerPlus ?? 0));
  /**
   * ...and it dies MOVING. `obj+0xc` is one word, and neither a class's hit
   * handler nor `0x45d090` installing the death writes it: the CHOPPER's
   * `0x454790` and `0x454863` leave it alone, and `0x454473` goes on clamping
   * it in state 5. This page keeps a walker's speed in `e.speed` and a
   * corpse's flight in `e.vx`, so the ride is handed from one to the other
   * here, or the bike stops dead on the frame it is killed.
   */
  if (e.speed && !foe.floats) {
    e.vx += e.speed * TICK_SCALE * e.facing;
    e.speed = 0;
  }
  stats.score += foe.award ?? foe.panel?.award ?? 0;
  // the flags three goals wait for — see {@link waitsFor}: `0x43d309`, the
  // bishop's `0x426600` and the named wraith's `0x4250eb`, and `0x419ac9`
  if (e.kind === "inithardcore") bossDown.hardcore = true;
  if (e.kind === "initvpriest" || (e.kind === "initwraith" && e.decisions !== 0))
    bossDown.belfry = true;
  if (e.kind === "inittube") bossDown.lab = true;
}

/**
 * Kragg's first bar is gone — {@link Foe.rallies} — and it is shot out of the
 * sky rather than killed. Two paths reach it and both do the same four things:
 * the blow at `0x441def` and the scald at `0x440c07`.
 *
 * - health to zero, and `[0x4a7574]` to the centre X of its region
 *   (`0x40ba30` copies the region record; `0x441e14`..`0x441e28` add half its
 *   width to its left), which is where the fall's first tag steers it and
 *   which the page keeps in {@link Enemy.home};
 * - `0x40ee90(bank, 0x17, 0)` lets its flying loop go ({@link FOE_SFX}
 *   `kraggFlies`);
 * - the scald alone zeroes both velocities (`0x440c59`, `0x440c69`); the blow
 *   leaves them;
 * - `0x473b60` tag 0 goes on, state 10, which its brain now runs.
 */
/**
 * The body stepper's floor and ceiling for a thing that flies — `0x42fd80`
 * holds every object to both, weight or none, and this page's floaters skip
 * the stepper's landing. Their states steer them (kragg's maul and dive at the
 * player's point, the eyeball's swoop, a bat's dive) and a velocity no state is
 * changing would otherwise carry one out of the room.
 *
 * - `0x42ff4c`: the foot within 8 of the region floor stands ON it; a vertical
 *   speed inside ±2 is zeroed (`0x42ff7b`), a bigger one is handed back
 *   through `obj+0x20` (`0x42ff83`) — the allocator's 0.25 (`0x42f5c0`), or
 *   kragg's 0.8 (`0x441c92`) turned round.
 * - `0x42ffbc`: the cel's top at or above the region's own is put back one
 *   below it (`0x42ffca`), and with the region's bit 1 and kragg's own flag 2
 *   (`0x441cb4` sets 0xf) the speed is handed back the same way.
 */
export function floaterInRegion(e: Enemy, foe: Foe, lvl: Level): void {
  const back = foe.restitution ?? 0.25;
  const floor = groundAt(e.x);
  const base = baseOf(e, lvl);
  if (floor !== null && base >= floor - 8) {
    e.y -= base - floor;
    e.vy = Math.abs(e.vy / TICK_SCALE) <= 2 ? 0 : e.vy * back;
  }
  const a = foeAnchor(e, lvl);
  const c = celRec(lvl.sbk, celOf(e));
  if (!p.room || !a || !c) return;
  const top = a.y - c.posY;
  if (top <= p.room.top) {
    e.y += p.room.top + 1 - top;
    if (p.room.flags & 1) e.vy *= back;
  }
}

export function rallyFall(
  e: Enemy,
  r: NonNullable<Foe["rallies"]>,
  stop: boolean,
): void {
  e.rallied = true;
  e.hp = 0;
  // `0x440c4b` / `0x441e34` — `0x40ee90(bank, 0x17, 0)`: the wing's loop let go
  sound?.loop(FOE_SFX.kraggFlies, false);
  e.state = "gait";
  e.swing = false;
  if (p.room) e.home = p.room.left + Math.trunc((p.room.right - p.room.left) / 2);
  if (stop) {
    e.vx = 0;
    e.vy = 0;
  }
  e.anim = r.fall;
  e.script = r.fall.kind;
  e.tag = r.fall.tag;
  e.clock = 0;
}

/**
 * The goo a blow throws — `0x40cba0`, and {@link file://../effects.ts} has the
 * whole of it.
 *
 * One gob per six points of damage up to twenty of them, each leaving along the
 * blow's own direction with the engine's own scatter, each living sixty frames.
 * The blow's direction is the player's facing and the strike's own height, since
 * the engine takes it from the hitting object's type record and the punch and
 * the kick are two different objects there.
 */
export function spray(
  e: Enemy,
  damage: number,
  blow: { dx: number; dy: number },
  at?: { x: number; y: number },
  /**
   * The handler handed no hitter — `push 0` as the third argument (ghengis'
   * `0x422b73`, the hardcore's `0x43d28b`). `0x40cd70` finds it null and
   * `0x40ce7d`..`0x40ce9d` gives every gob `0x434540(0x50) - 0x28` on each
   * axis, −39..40, with nothing of the blow in it.
   */
  wild = false,
): void {
  // `0x40cd53`: from the point the handler was given — the contact — and,
  // for the callers that have none, about where a body is struck
  const from = at ?? { x: e.x, y: e.y - 70 };
  const loose = (): number => 1 + Math.floor(random() * 0x50) - 0x28;
  for (let n = 0; n < gobCount(damage); n++) {
    gobs.push({
      x: from.x,
      y: from.y,
      // the blow's own pair, scattered, written straight into `obj+0xa` and
      // `obj+0xc` (`0x40cdb6`) — a velocity, which the class's divisor of 2
      // never touches: that only scales a script's own steps (`0x42f8b0`)
      vx: (wild ? loose() : scatter(blow.dx * p.facing)) * TICK_SCALE,
      vy: (wild ? loose() : scatter(blow.dy)) * TICK_SCALE,
      age: 0,
      mirror: random() < 0.5,
      stage: -1,
      holds: 0,
    });
  }
}

/**
 * The player's own spray — `0x40c900`, and {@link BLEED} has the whole of it.
 *
 * From `at`, the point the caller hands it: the contact for a blow
 * (`0x42ebd3`), the player's own `obj+6` for everything else. With a
 * `striker`, the drops leave along its cel's blow pair plus a quarter of its
 * sideways speed and all of its fall; without one, anywhere within fifteen.
 * Sweat while the tank is two thirds full and `n` is not negative, blood
 * otherwise — `empty` for the one caller that has already spent the tank
 * (the fan, `0x4154c4`) and this page does not.
 */
export function bleed(
  n: number,
  at: { x: number; y: number },
  striker?: { blow: { dx: number; dy: number } | null; facing: number; vx: number; vy: number },
  empty = false,
): void {
  const [num, den] = BLEED.bleeds;
  const kind =
    empty || n < 0 || Math.trunc((stats.maxHealth * num) / den) > stats.health ? "blood" : "sweat";
  const loose = (): number => 1 + Math.floor(random() * BLEED.loose) - BLEED.loose / 2;
  for (let i = 0; i < dropCount(n); i++) {
    let vx: number, vy: number;
    if (striker) {
      const pair = striker.blow ?? { dx: 0, dy: 0 };
      // `0x40c9d9`: the hitter's own `obj+0xc`, a quarter of it, rounded toward
      // zero; the mirror at `0x40ca09` turns the pair and leaves the speed its own
      vx = scatter(pair.dx * (striker.facing < 0 ? -1 : 1) + Math.trunc(striker.vx / 4));
      vy = scatter(pair.dy + striker.vy);
    } else {
      vx = loose();
      vy = loose();
    }
    gobs.push({
      x: at.x,
      y: at.y,
      vx: vx * TICK_SCALE,
      vy: vy * TICK_SCALE,
      age: 0,
      mirror: random() < 0.5,
      stage: -1,
      holds: 0,
      kind,
    });
  }
}

/** the player's `obj+6` — the anchor, which is where `0x40c900`'s other callers throw from */
export function ownPoint(): { x: number; y: number } {
  return { x: p.x, y: p.y - p.feet };
}

/** the goo — in the air, or a puddle on the pavement */
export let gobs: Gob[] = [];
/** the green balls bodies leave behind — see {@link VANISH} */
export let pops: Pop[] = [];
/** kragg's sparks — see {@link SPARK} */
export let sparks: Spark[] = [];

/** `0x4424a0(point)` — one spark, flying off sideways at its own random speed */
export function sparkAt(at: { x: number; y: number }): void {
  sparks.push({
    x: at.x,
    y: at.y,
    vx: 1 + Math.floor(random() * SPARK.across) - SPARK.across / 2,
    vy: 0,
    age: 0,
  });
}

/**
 * Step every gob: the arc, the landing, the merge and the drying.
 *
 * `0x40c480`'s, with the mover's fall: the allocator's gravity of ten, no cap.
 * When it arrives the velocity is zeroed where it lands, a gob landing on an
 * existing puddle advances that puddle instead of making its own, and a puddle
 * steps back down a stage every 40 to 79 frames until it is gone.
 */
export function stepGobs(): void {
  const ground = (x: number): number | null => {
    const g = p.room?.ground;
    if (!g) return null;
    const i = Math.round(x) - g.x0;
    return i < 0 || i >= g.ys.length ? null : g.ys[i];
  };
  for (const g of gobs) {
    g.age += TICK_SCALE;
    if (g.stage >= 0) {
      // a puddle: it holds its stage, then dries back one
      g.holds -= TICK_SCALE;
      if (g.holds <= 0) {
        g.stage -= 1;
        g.holds = dryTime();
      }
      continue;
    }
    // the allocator's gravity, ten a frame² (`0x42f5ca`) — the effect class's
    // init `0x40c3c0` sets its divisor and nothing else — added after the move
    // and never capped (`0x430322`)
    g.x += g.vx;
    g.y += g.vy;
    g.vy += 10 * TICK_SCALE * TICK_SCALE;
    // it lands on the region's floor and nothing else: `0x40c401` leaves
    // `obj+0x34` at 0, so the mover never searches the platforms for it
    // (`0x42fe4a`) — see {@link regionFloorUnder}
    const floor = ground(g.x);
    if (floor === null || g.y < floor) continue;
    // the sweat is gone the frame it lands: kind 3's switch answers 1 on
    // `obj+0x2e` in both its tags (`0x40c7a6`, `0x40c7bb`) and never pools
    if (g.kind === "sweat") {
      g.age = SPRAY.life;
      continue;
    }
    // landed. `0x40c810` looks for a puddle already here; if there is one it
    // grows and this gob is spent, which is how twenty gobs make one mess
    const pool = gobs.find(
      (q) => q !== g && q.stage >= 0 && Math.abs(q.x - g.x) < 40,
    );
    if (pool) {
      pool.stage = Math.min(SPRAY.pool.length - 1, pool.stage + 1);
      pool.holds = dryTime();
      // ...on the lander's own script (`0x40c591` / `0x40c6f3`), so blood
      // falling on goo turns the puddle red and goo on blood turns it green
      pool.kind = g.kind;
      g.age = SPRAY.life; // spent: dropped by the filter below
      continue;
    }
    g.y = floor;
    g.vx = 0;
    g.vy = 0;
    g.stage = 0;
    g.holds = dryTime();
  }
  // in the air, sixty frames is all it gets; on the ground, it goes when the last
  // stage has dried
  gobs = gobs.filter((g) => g.stage >= 0 || g.age < SPRAY.life);
  for (const q of pops) q.age += TICK_SCALE;
  pops = pops.filter((q) => q.age < VANISH.cels.length * VANISH.hold);
  // the spark: moved by its velocity, then the gravity added (`0x430322`),
  // and gone as its script ends (`0x442635`)
  for (const k of sparks) {
    k.x += k.vx * TICK_SCALE;
    k.y += k.vy * TICK_SCALE;
    k.vy += SPARK.gravity * TICK_SCALE;
    k.age += TICK_SCALE;
  }
  sparks = sparks.filter((k) => k.age < SPARK.cels.length * SPARK.hold);
}

/**
 * Where a hitter's strike box is, in the world.
 *
 * `0x430375` reads the CURRENT cel's own strike rect and skips a hitter whose is
 * degenerate, which is what makes a blow two frames of an animation rather than
 * the whole of it.
 *
 * And the rect goes into the world by TRANSLATION and nothing else. `0x40e680`
 * copies the cel's four words, negates the x pair if the object is mirrored, and
 * hands the result to `0x434270` — a rect translate — with the object's own
 * packed `obj+6`. So the box hangs off the anchor exactly the way the art does
 * in {@link drawLevelCel}, and there is no width or height in the arithmetic at
 * all.
 *
 * This read it as measured from the cel's top-left instead, which lifted every
 * prop's box by `height - posY`. On SEWER's bush that is sixty-four pixels, and
 * sixty-four pixels is the whole of why it could not reach a standing player:
 * the rise passed straight through you and the grab only landed once it had sunk
 * far enough to make the error back up. See {@link BUSH}.
 *
 * `y` here is the object's own — the engine's `obj+6`, which is what every
 * record-placed prop on this page stores. The PLAYER is the one that is not:
 * `p.y` is the ground it stands on, which is why {@link playerBody} converts and
 * this does not.
 */
export function strikeOf(
  cel: SbkCel,
  x: number,
  y: number,
  facing: number,
): { top: number; left: number; bottom: number; right: number } | null {
  if (!cel.strike) return null;
  // `0x40e6a2` — a mirrored rect is negated about the anchor, not flipped in a
  // box: `x0' = -x1` and `x1' = -x0`
  const [cx0, cx1] =
    facing < 0
      ? [-cel.strike.x1, -cel.strike.x0]
      : [cel.strike.x0, cel.strike.x1];
  return {
    left: x + cx0,
    right: x + cx1,
    top: y + cel.strike.y0,
    bottom: y + cel.strike.y1,
  };
}

/** the other modules' writes into this one's state — ES imports are read-only */
export function setGobs(v: typeof gobs): void {
  gobs = v;
}
export function setPops(v: typeof pops): void {
  pops = v;
}
export function setSparks(v: typeof sparks): void {
  sparks = v;
}
export function setBlowClock(v: typeof blowClock): void {
  blowClock = v;
}
