/**
 * A blow landing on a creature: {@link strikeFoe}, the exchange it reads the
 * hitter by, and the reaction the creature's own handler picks.
 */
import { FOES, FoeAnim } from "../foes";
import { TICK_SCALE, type Enemy, type Hitter } from "../brains/kit";
import { GATES } from "../brains";
import { random } from "../random";
import { p, level, sound } from "./state";
import { DIVISOR } from "./motion";
import { foeAnchor } from "./cels";
import { sparkAt, killFoe, spray, knockback, rallyFall } from "./blows";
import { BURN_CODE, burnFoe, dropBoard, canAt } from "./casts";
import { type Box } from "./box";

/** a blow's hitter as {@link strikeFoe}'s exchange reads it */
interface FoeHitter {
  mass: number;
  vx: number;
  vy: number;
  recoil?: (vx: number, vy: number) => void;
  /** who it was, for the handlers that ask — see {@link Hitter} */
  by?: Hitter;
}

/** the player's fist, the hitter {@link strikeFoe} assumes when it is handed none */
function fistHitter(): FoeHitter {
  return {
    mass: DIVISOR,
    vx: p.vx,
    vy: p.vyRaw,
    recoil: (vx, vy) => {
      p.vx = vx;
      if (!p.onGround) p.vyRaw = vy;
    },
    by: { player: true },
  };
}

/**
 * One blow as {@link strikeFoe} takes it.
 *
 * `from` is which way the blow travelled (the shove is along it) and `mid` is
 * how high it landed, which is the second thing a handler's flinch picks on.
 */
export interface FoeBlow {
  damage: number;
  shove: { dx: number; dy: number };
  from: number;
  mid: number;
  box: Box;
  /**
   * A CODE — and against a creature there is only one, which is fire. None is 0.
   *
   * `0x448c84`'s range test is the player's table and −9 falls below it, so
   * against the player this lands as ordinary damage. Against a creature it is
   * read by a −9 arm of the class's own hit handler, before any of the
   * arithmetic below: `0x44f0aa`, `0x44f8bd`, `0x45296e`, `0x4547b3`,
   * `0x4550d3`, `0x45631e` and `0x441d30` here, and the crow's `0x4520d8` in
   * its own pass, and the mailbox's `0x44fe89`, the one on furniture. Kragg's
   * has a gate in front of it — {@link GATES} — and the two in the air are
   * casts'. See {@link Foe.burns} and `FLAME`.
   *
   * A class with no such handler is not set on fire and takes nothing, which
   * is why the flamer crosses these sixteen levels touching almost nothing.
   */
  code?: number;
  /**
   * Where the blow met the body — the middle of the two boxes' overlap, which
   * `0x43041e` hands the hit handler and the handler hands `0x40cba0` as the
   * point the goo leaves from.
   */
  contact?: { x: number; y: number };
  /**
   * The hitter, for `0x430470`'s exchange: its mass `obj+0xe`, its own velocity
   * in pixels a frame, and where its share of the exchange goes. The player's
   * fist by default.
   */
  hitter?: FoeHitter;
}

/**
 * What a landed blow DOES to one creature — the class handler's own sequence,
 * lifted out of {@link landHits} so that something other than a fist can land
 * one. A flare is the other thing: {@link FLARE} gives it 100 and `0x43ad80`
 * hands it to the same handler a punch goes through.
 */
export function strikeFoe(e: Enemy, struck: FoeBlow): void {
  const { shove, from, mid, box, contact, hitter = fistHitter() } = struck;
  let { damage, code = 0 } = struck;
  if (!level) return;
  const foe = FOES[e.kind];
  // a handler that asks its own state first — `0x441d26`, and see {@link GATES}
  const gate = GATES[e.kind];
  let still = false;
  let quiet = false;
  let spare = false;
  if (gate) {
    const blow = gate(e, foe, { damage, code, by: hitter.by ?? {} });
    if (!blow) return;
    ({ damage, code } = blow);
    still = !!blow.still;
    quiet = !!blow.quiet;
    spare = !!blow.spare;
  }
  // a handler with no sign test takes a code as a blow like any other —
  // {@link Foe.codeBlind}, the bat's `0x4232f0`
  if (code < 0 && foe.codeBlind) code = 0;
  if (code === BURN_CODE) {
    const how = foe.burns;
    if (!how) return; // nothing in this class reads a −9
    if (!how.noFlame) burnFoe(e, how);
    // kragg's arm, in its own order: the hit sound, the spark, 0x13
    // (`0x441d41`, `0x441d60`, `0x441d72`)
    how.sounds?.forEach((set, i) => {
      const which = typeof set === "number" ? set : set[Math.floor(random() * set.length)];
      sound?.effect(which, e.x, e.y);
      if (i === 0 && how.spark) sparkAt(contact ?? { x: e.x, y: e.y - 70 });
    });
    // `0x4550d3`: the dog's arm is its death path, sound and award and all
    if (how.dies && foe.death) {
      killFoe(e, foe);
      return;
    }
    if (how.anim) {
      // a FLINCH even when it is fatal: the death is what the end of it
      // installs (`0x4526ef`), in {@link stepEnemies}, and a blow landed in
      // the meantime is read like any other — `0x452960` has no state test
      react(e, how.anim);
      e.swing = false;
    }
    // ...and every creature arm returns here and is done. The CHOPPER's
    // `0x4547b3` looked like the exception; it zeroes the health and its
    // negative strength is turned away at `0x4547f2` — see {@link GATES}
    if (!how.andHurts) return;
  }
  // the spray goes first, exactly as `0x40cba0` is called before the subtract —
  // and only for the kinds whose handler calls it at all
  const bleeds = typeof foe.bleeds === "function" ? foe.bleeds(e) : foe.bleeds;
  if (bleeds)
    spray(e, foe.sprayAmount ?? damage, shove, contact, bleeds === "scatter");
  // ...or a spark where the goo would have gone — {@link Foe.sparks}, kragg's
  // flying handler (`0x441db8`)
  else if (foe.sparks?.(e)) sparkAt(contact ?? { x: e.x, y: e.y - 70 });
  // and the kind's own sound, at the thing that was hit — see FOE_SFX for which
  // handler plays which index
  // ...unless this is the blow that kills and the class keeps the hit sound
  // for the ones that do not — {@link Foe.quietKill}
  const fatal = e.hp - (foe.oneHitEach ? 1 : damage) <= 0;
  if (foe.hitSound !== undefined && !quiet && !(foe.quietKill && fatal && !still)) {
    const set = foe.hitSound;
    // the roll is made whether or not anything is listening — see {@link sound}
    const which = typeof set === "number" ? set : set[Math.floor(random() * set.length)];
    sound?.effect(which, e.x, e.y);
  }
  // the fourth kind's handler keeps the damage only for the blood and takes a
  // single point off the health — `0x454821`, and see {@link Foe.oneHitEach}
  if (!spare) e.hp -= foe.oneHitEach ? 1 : damage;
  e.dents += 1;
  // the handler's own velocity write, which the exchange then reads back —
  // {@link Foe.hitVel}, the bat's `0x423334`
  if (foe.hitVel?.vx !== undefined) e.vx = foe.hitVel.vx * TICK_SCALE;
  if (foe.hitVel?.vy !== undefined) e.vy = foe.hitVel.vy * TICK_SCALE;
  // `0x43043b` — and the exchange of velocity, whoever it was, weighted by the
  // two masses; a thing bolted down is re-pinned by its own think (the
  // hydrant's `0x44fb43`), which this page says with {@link Foe.rooted}.
  // Only when the class's handler answers nonzero (`0x43042b`) — see
  // {@link Foe.noExchange}
  const turned =
    typeof foe.noExchange === "function" ? foe.noExchange(e) : !!foe.noExchange;
  if (damage > 0 && !turned) {
    const was = {
      vx: e.vx / TICK_SCALE + (e.vx === 0 && !foe.floats ? (e.speed ?? 0) * e.facing : 0),
      vy: e.vy / TICK_SCALE,
    };
    const v = knockback(
      hitter.mass,
      e.divisor ?? foe.divisor,
      { dx: shove.dx * from, dy: shove.dy },
      hitter,
      was,
    );
    if (!foe.rooted) {
      e.vx = v.vx * TICK_SCALE;
      e.vy = v.vy * TICK_SCALE;
      if (!foe.floats) e.speed = 0;
    }
    hitter.recoil?.(v.hvx, v.hvy);
  }
  // a blow the handler takes and answers 1 to, with no reaction — see {@link Gate}
  if (still) return;
  // a frail kind's handler never looks at health: one blow, whatever the blow.
  // The rat is the case — the launch is its death.
  /**
   * ...and one class stands up instead — see {@link Foe.rallies}.
   *
   * `0x441e4a` is the frame kragg's health runs out and it does not install the
   * death: it installs `0x473b60`, the fall — see {@link rallyFall}.
   */
  const spent = foe.survivesZero ? e.hp < 0 : e.hp <= 0;
  if (foe.rallies && !e.rallied && spent) {
    rallyFall(e, foe.rallies, false);
    return;
  }
  if ((foe.frail || spent) && foe.death) {
    killFoe(e, foe);
    // `0x4383d9`, `0x43a6f9`, `0x43908e`, `0x439af9` — the gang's four hit
    // handlers, on this frame
    if (foe.drops === "skateboard") dropBoard(e);
    return;
  }
  /**
   * ...and the blow that puts it over instead. `0x456496` counts the boss's
   * consecutive hits and every third one installs the knockdown rather than a
   * take. The get-up follows on {@link FoeAnim.next} at its own rate.
   */
  const over = foe.knockdown;
  if (over && e.dents % over.every === 0) {
    sound?.effect(over.sound, e.x, e.y);
    react(e, over.anim);
    return;
  }
  if (!foe.flinch) return;
  // where the blow landed and which way it was facing — the two things the
  // handler consults besides the damage. "Where" is the contact's Y against the
  // victim's own point, `obj+6`: `|contact.y − self.y|` at `0x44f21e` (the
  // punk) and `0x452a87` (werec), and the signed pair at `0x41839d` (puke). A
  // blow handed in with no contact is taken at the middle of what struck
  const contactY = contact?.y ?? mid;
  const point = foeAnchor(e, level);
  const pointY = point?.y;
  const blow = {
    damage,
    // this blow included: `e.dents` was stepped above, and the boss's handler
    // counts its consecutive hits in `AI+0x12` (`0x456461`)
    hits: e.dents,
    dy: Math.abs(contactY - (pointY ?? (box.top + box.bottom) / 2)),
    facingAway: e.facing === from,
    contactY,
    pointY,
    contactX: contact?.x ?? (box.left + box.right) / 2,
    pointX: point?.x ?? e.x,
    playerX: p.x,
  };
  /**
   * ...and what the blow shakes OUT of it, before the animation is chosen.
   *
   * The Coke machine's two counters, kept where it keeps them: `AI+2`
   * ({@link Enemy.beat} here) steps on every blow under the burst, the light
   * ones included (`0x43b6c5`, `0x43b6ed`), and a MIDDLE blow that finds it
   * past two lets a can go and clears it (`0x43b6f5`, `0x43b710`); `AI+0`
   * ({@link Enemy.shaken}) counts the cans. A blow of seventy-five or more
   * throws everything left at once (`0x43b755`) and touches neither.
   */
  const shakes = foe.shakes;
  if (shakes) {
    const out = e.shaken ?? 0;
    let want = 0;
    if (damage >= shakes.bursts) want = shakes.holds - out;
    else {
      const counted = (e.beat ?? 0) + 1;
      e.beat = counted;
      if (damage >= shakes.counts && counted >= shakes.every) {
        want = 1;
        e.beat = 0;
      }
    }
    const n = Math.max(0, Math.min(want, shakes.holds - out));
    for (let i = 0; i < n; i += 1) canAt(e);
    e.shaken = out + n;
  }
  // a progressive kind advances one stage per blow instead of picking; a
  // hydrant's handler switches on the state it is already showing, not on how
  // hard it was hit
  let which = 0;
  if (foe.progressive) which = e.dents - 1;
  else if (foe.pick) which = foe.pick(blow, e);
  if (foe.progressive && which >= foe.flinch.length) return; // beaten in already
  // ...and a pick of −1 is a handler that takes the blow and shows nothing:
  // the eyeball's on any cel but its three hover poses (`0x43e9d4`)
  if (which < 0) return;
  react(e, foe.flinch[Math.min(foe.flinch.length - 1, Math.max(0, which))]);
}

/**
 * Put a hit reaction on — the handler's `0x45d090`.
 *
 * Which writes the script's kind into `obj+0x18` and its tag into `obj+0x44`
 * (`0x45d0a7`) the moment the reaction goes on, so a second blow landing
 * during it — a {@link Foe.pick} or a {@link GATES} reading `e.script` — sees
 * the reaction's state and not the one the first blow interrupted. Only an
 * animation that says which script it is carries that over.
 *
 * And a blow wakes it: no handler tests the dormant state, and every reaction
 * ends by installing an awake one (the gang's run, `0x4398ee`; the cop's kind
 * 8, `0x41440e`; puke's stance, `0x4181c8`).
 */
function react(e: Enemy, anim: FoeAnim): void {
  e.state = "flinch";
  e.anim = anim;
  e.clock = 0;
  if (anim.kind !== undefined) {
    e.script = anim.kind;
    e.tag = anim.tag;
  }
  e.asleep = false;
}
