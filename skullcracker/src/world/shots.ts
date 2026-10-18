/**
 * The shots in flight: the inventory stepped, a gun taken up, and the streams,
 * bolts, flares and bushes stepped a frame at a time. The guns as they are
 * carried are {@link file://./arsenal.ts}.
 */
import { SbkCel } from "@dreamfactory/engine/df/sbk";
import { TICK_SCALE } from "../brains/kit";
import { CROW, burnCrow, crowCel, BUSH, Bush } from "../props";
import { BOLT, FLARE, GUN_CODES, STREAMS, type Stream } from "../guns";
import { p, held, level, sound, CHARACTER } from "./state";
import { dragged, PLAYER_GRAVITY } from "./motion";
import { celRec, celOf } from "./cels";
import { hereOf, roll, surfaceUnder } from "./rooms";
import { inv, gunAhead, loadRounds, streams, roundsIn, streamCel, bolts, flares, setStreams, setBolts, setFlares } from "./arsenal";
import { stats, takesBlows, hurtBox } from "./blows";
import { regionFloorUnder } from "./scenery";
import { cans, BURN_CODE, casts, castCel, castHurtBox, strikeCast, lightFlame } from "./casts";
import { strikeFoe } from "./foehit";

/**
 * INV, one engine frame of it — the button that puts the gun away and gets it
 * out again.
 *
 * Every player state, armed or not, answers `0x4ac386` with
 * `mov word ptr [eax+0x18], 0xf` — the unarmed idle unconditionally
 * (`0x4298c0`), the unarmed walk and run only while `0x479438` says you carry a
 * gun (`0x429af4`), and all five guns' handlers. State 15 (`0x428975`) then:
 *
 *   - while the button is DOWN, installs the unarmed idle `0x471648`
 *     (`0x428c46`). That is kind 0, so it has left state 15 — and kind 0's
 *     handler sees the button still down and puts it back. Held, the player
 *     alternates between the two every engine frame, standing on the idle
 *     and reading no direction;
 *   - when it is UP, dispatches on the weapon (`0x429624`) and, for each of the
 *     five, asks whether the gun's own script is the one installed
 *     (`0x4289c1`). If it is not and you carry it, the gun's script goes in:
 *     it is out. Otherwise the unarmed idle goes in — or the duck `0x4717c8`
 *     with S held (`0x4289ea`) — and it is away.
 *
 * So it is a toggle, decided on the release, and the release has to land on a
 * state-15 frame to do anything: coming up on one of kind 0's frames just leaves
 * the idle standing. A tap is two frames — in, and out on the next — and flips
 * cleanly; a long hold is whichever frame the finger leaves on.
 */
export function stepInv(): void {
  if (p.inv15) {
    p.inv15 = false; // either branch installs a script, which sets the kind
    if (held.inv) inv.drawn = false;
    else {
      inv.drawn = inv.armed && !inv.drawn;
      p.invLoop = false;
    }
    return;
  }
  const free =
    p.onGround &&
    !p.act &&
    p.windup === 0 &&
    p.landLeft === 0 &&
    !p.climbing &&
    !p.bar &&
    !p.flail;
  if (!held.inv || !free) {
    p.invLoop = false;
    return;
  }
  // the unarmed walk and run do not answer it with nothing to get out
  if (!inv.drawn && !inv.armed && p.moving && !p.invLoop) return;
  p.inv15 = p.invLoop = true;
}

/**
 * The end of the reach — `0x4287bd`, the kind-14 state, which probes the same
 * band again and then runs `0x428846`'s table.
 *
 * The callback at `user+0xc` has already set the weapon and added the rounds by
 * the time that table is reached; what the table adds is `0x45eed0` for the
 * five base weapons, and that is the whole of being armed. The two refills fall
 * through to `0x42884d` — back to the fists — which is why picking up a tank
 * with nothing in your hands leaves you with nothing in your hands.
 */
export function takeGun(): void {
  const lvl = level;
  const g = gunAhead();
  if (!lvl || !g || !p.room) return;
  const i = lvl.rooms.indexOf(p.room);
  if (i >= 0) lvl.guns[i] = lvl.guns[i].filter((q) => q !== g);
  const kind = GUN_CODES[g.code];
  // `0x428868` — the one code that is not a weapon at all: 150 health and the
  // player's own sound 0xa, for the thing a dying class drops
  if (g.code === 2) {
    // `0x43aff0` — the callback walks the can list for one lying at the
    // pickup's own point and puts its state to 2, which is the one case of
    // `0x43af00` that answers 1. Without this the can stays on the floor and
    // the health is free every time you press S at it.
    // ...and exactly ONE: `0x43aff0` walks the list until the first can whose
    // point matches and stops there, so two that came to rest on the same
    // pixel are two pickups and two takings.
    const mine = cans.findIndex(
      (c) => c.rest !== undefined && c.x === g.x && c.y === g.y,
    );
    if (mine >= 0) cans.splice(mine, 1);
    stats.health = Math.min(stats.maxHealth, stats.health + 150);
    // at the player's point — 0xa for character 0 (`0x428893`), 8 for
    // character 1 (`0x443319`), both through `0x40ef30`
    sound?.own(CHARACTER === 1 ? 8 : 0xa, p.x, p.y);
    inv.drawn = false; // `0x42887c` ends on the unarmed idle too
    return;
  }
  // every case but the five guns ends on `0x471648` (`0x42884d`), and that is
  // the unarmed idle: a refill taken with the gun out leaves your fists out
  if (!kind.arms) inv.drawn = false;
  if (kind.weapon === null) return;
  // the callback: the weapon, then the rounds, clamped
  inv.weapon = kind.weapon;
  loadRounds(kind.weapon, kind.rounds);
  // ...and `0x45eed0`, which is the only thing that arms you — plus its own
  // single round, which is what makes a bare `statflaregun` worth taking
  if (kind.arms) {
    inv.armed = true;
    // ...and the case installs the gun's own script (`0x4288b7`), so it is out
    inv.drawn = true;
    loadRounds(kind.weapon, 1);
  }
}

/**
 * The streams, one engine frame at a time.
 *
 * They hang off the player rather than travelling: the fire function files a
 * `(dx, dy)` for the pose and the object is redrawn there every frame, which is
 * why walking while you fire sweeps the flame across a room. Rounds come off
 * once a frame (`0x45ef00`), and the blow is whatever {@link STREAMS} says —
 * a hundred for two of them and the code -9 for the flame, which nothing in
 * these levels reads.
 */
export function stepStreams(): void {
  const lvl = level;
  if (!lvl) return;
  const i = lvl.rooms.indexOf(p.room!);
  const pool = i >= 0 ? lvl.spawned[i] : [];
  for (const q of streams) {
    const kit = STREAMS[q.weapon];
    if (!kit) continue;
    q.clock += 1;
    /**
     * `0x421700` plants it fresh every frame, and the formula is the whole of
     * how a stream behaves:
     *
     * ```
     *   42170a  if (player mirrored)  x = player.x - user[+4]
     *   42171e  else                  x = player.x + user[+4]
     *   42172f  x += player.vx        ; ...and it leads the player's own motion
     *   42173b  y = user[+2] + player.y + player.vy
     * ```
     *
     * So it is not fired and forgotten, it is redrawn where you are — which is
     * why walking while you hold the button sweeps it across a room.
     */
    const at = kit.at[q.variant ?? kit.standing] ?? kit.at[0];
    // `0x42466c` — a variant that sets `user+8` is drawn turned round
    q.facing = q.flip ? -p.facing : p.facing;
    q.x = p.x + p.facing * at.dx + p.vx;
    q.y = p.y - p.feet + at.dy + p.vyRaw;
    if (
      q.state === "start" &&
      q.clock >= kit.start.cels.length * kit.start.hold
    ) {
      // `0x424699` — a shot is freed the frame its script ends
      if (kit.shot) {
        q.state = "stop";
        q.clock = kit.stop.cels.length * kit.stop.hold;
        continue;
      }
      // `0x4217a5` — the start animation ending is what installs the loop
      q.state = "loop";
      q.clock = 0;
    }
    if (q.state === "stop") continue;
    // `0x45ef00(1)` or the scepter's forty, and an empty gauge shuts it off
    inv.rounds[q.weapon] = Math.max(0, roundsIn(q.weapon) - kit.perFrame);
    // ...but a lightning's discharge (`0x41f7e2`) asks the gauge nothing
    if (roundsIn(q.weapon) <= 0 && q.variant === undefined) {
      q.state = "stop";
      q.clock = 0;
      continue;
    }
    /**
     * ...and what it touches.
     *
     * A strength below 1 is not damage — but −9 is not damage either, it is a
     * CODE, and `0x453b9b` is where the flamer's flame gets it. This page read
     * "below 1" as "harmless" and so the flamethrower crossed sixteen levels
     * touching nothing at all. What it actually does is set things on fire:
     * see {@link Foe.burns}, and `0x44ff20` is the half all eight readers
     * share.
     *
     * A code needs no blow pair on the cel, because none of the arithmetic
     * runs — which matters, since the flame's own cels carry one anyway.
     */
    const burns = kit.blow === BURN_CODE;
    if (kit.blow < 1 && !burns) continue;
    const cel = celRec(lvl.sbk, streamCel(q));
    const box = streamBox(q, cel);
    if (!box || (!cel?.blow && !burns)) continue;
    for (const e of pool) {
      if (!takesBlows(e)) continue;
      const c = celRec(lvl.sbk, celOf(e));
      if (!c) continue;
      const hurt = hurtBox(e, c, lvl);
      if (!(
        box.right > hurt.left &&
        box.left < hurt.right &&
        box.bottom > hurt.top &&
        box.top < hurt.bottom
      ))
        continue;
      // `0x42f910`: the cel's OWN pair scaled by the object's strength, and the
      // magnitude of that is the damage. It is small on purpose — the soaker's
      // 9806 carries `dx 8`, so a stream is eight a frame rather than a blow,
      // and a two-hundred-health zombie takes about twenty-five frames of it.
      if (burns) {
        strikeFoe(e, { damage: 0, shove: { dx: 0, dy: 0 }, from: q.facing, mid: (box.top + box.bottom) / 2, box: hurt, code: BURN_CODE, hitter: { mass: 0, vx: 0, vy: 0, by: {} } });
        continue;
      }
      const scale = kit.blow / 100;
      const bx = cel!.blow!.dx * scale;
      const by = cel!.blow!.dy * scale;
      strikeFoe(e, {
        damage: Math.sqrt(bx * bx + by * by),
        shove: { dx: bx, dy: by },
        from: q.facing,
        mid: (box.top + box.bottom) / 2,
        box: hurt,
        // the stream class leaves `obj+0xe` at the allocator's nothing
        // (`0x424534`), so it trades no momentum with what it wets
        hitter: { mass: 0, vx: 0, vy: 0, by: {} },
      });
    }
    /**
     * ...and what it does to a CAST, which is where the −9 stops being a
     * creature's business.
     *
     * `0x430367` walks every object in the room, not every creature, and hands
     * each one its own `obj+0x12`. The flame's box against a thing in the air
     * is the same test as against a thing on its feet, and what reads the code
     * at the far end of it is {@link CastKit.onCode} — `0x455763`, the boss's
     * fireball, and `0x452fcc` in `0x452f80`, MOLITOV's shot, which lights a
     * flame on it and bursts it.
     *
     * Only a code: the stream's other two are ordinary damage. (`0x452f80`
     * also bursts on a blow of exactly `0x65`, a shot's own burst; that is
     * {@link chainCasts}.)
     */
    if (burns)
      for (const c of casts) {
        if (c.spent || !c.kit.onCode) continue;
        const art = celRec(lvl.sbk, castCel(c));
        if (!art) continue;
        const hurt = castHurtBox(c, art);
        if (!(
          box.right > hurt.left &&
          box.left < hurt.right &&
          box.bottom > hurt.top &&
          box.top < hurt.bottom
        ))
          continue;
        strikeCast(c, BURN_CODE);
      }
    /**
     * ...and a CROW, whose `0x4520d8` was the last reader of the code to be
     * found — see `CROW.burns` in {@link file://../props.ts} for why it took the
     * class descriptor to name it.
     *
     * It is not in `pool` and it is not a `Foe`, so it needs its own pass, the
     * same shape as `landHits`'s: a crow's hurt box is its CURRENT cel about its
     * own point. `0x4520d0`'s first arm is `0x44ff20(self, 3, 0)` — a flame put
     * straight on its going-out stage — and `0x476e58`, the crow's own sixth
     * state, and then it answers 1, so there is no damage and no feathers.
     *
     * The flamer is CITY's own weapon and CITY is the level that perches twelve
     * of these, which is the whole reason this arm exists.
     */
    if (burns)
      for (const c of i >= 0 ? lvl.crows[i]! : []) {
        // its body box, the way `landHits` takes it — the tumble has none
        const art = celRec(lvl.sbk, crowCel(c));
        if (!art?.body) continue;
        const hurt = {
          left: c.x + art.body.x0,
          right: c.x + art.body.x1,
          top: c.y + art.body.y0,
          bottom: c.y + art.body.y1,
        };
        if (!(
          box.right > hurt.left &&
          box.left < hurt.right &&
          box.bottom > hurt.top &&
          box.top < hurt.bottom
        ))
          continue;
        // woods 17 is the fall's own sound and `0x451e5a` plays it under the
        // state, so it goes with entering it rather than with the blow
        if (c.state !== "fall") sound?.effect(CROW.sound.fall, c.x, c.y);
        lightFlame(c, art, false, CROW.burns);
        burnCrow(c);
      }
  }
  setStreams(streams.filter(
    (q) =>
      !(
        q.state === "stop" &&
        q.clock >=
          STREAMS[q.weapon]!.stop.cels.length * STREAMS[q.weapon]!.stop.hold
      ),
  ));
}

/**
 * A stream's reach: its current cel's own STRIKE box, about the ANCHOR.
 *
 * The long cels are why this has to be the authored rect rather than the art —
 * the soaker's 9806 is 243 wide and its box is `x 8..200`, so the spray stops
 * short of its own pixels at both ends, and the flame's 9508 reaches `x 5..254`
 * of 255. And it is about the anchor, the way `hurtBox` does it and `0x4026d0`
 * mirrors: reflecting about the cel's centre instead puts a stream fired west
 * half a screen from where it is drawn.
 */
export function streamBox(
  q: Stream,
  cel: SbkCel | undefined,
): { top: number; left: number; bottom: number; right: number } | null {
  if (!cel?.strike) return null;
  const b =
    q.facing < 0
      ? { ...cel.strike, x0: -cel.strike.x1, x1: -cel.strike.x0 }
      : cel.strike;
  return {
    left: q.x + b.x0,
    right: q.x + b.x1,
    top: q.y + b.y0,
    bottom: q.y + b.y1,
  };
}

/**
 * The thing in the water — `0x43ec80`, one engine frame at a time.
 *
 * ```
 *   43ecf3  |player.x - bush.x| <  0x46    ; seventy across
 *   43ed0c  |player.y - bush.y| < 0x12c    ; three hundred down
 *   43ed28  0x45d090(bush, 0x472c20, 0)    ; ...and up it comes
 *   43eea3  [esi+8] = player.x             ; sliding under you as it rises
 *   43ef4a  y += 0xa                       ; and ten a frame back down after
 *   43f017  x held inside the record's rect, after every move
 * ```
 *
 * Its blow is the grab code -3 (`0x43ee9d`) and it carries the grip on the last
 * seven of its thirteen cels, so the first six are it breaking the water and
 * the rest are it closing. With nobody near it peeks (`0x43ed41`), and a
 * `param` 1 record's partner lashes (`0x43ed9b`). See {@link BUSH}.
 */
export function stepBushes(): void {
  // `0x43ef7c`/`0x43efbc`: six a frame toward the player's x
  const chase = (q: Bush): void => {
    q.x += p.x > q.x ? BUSH.peek.chasePx : -BUSH.peek.chasePx;
  };
  // `0x43f017`: the rect's x extent holds it, whichever arm moved it
  const hold = (q: Bush): void => {
    q.x = Math.max(q.left, Math.min(q.right, q.x));
  };
  const rise = (q: Bush): void => {
    q.state = "rise";
    q.phase = 0;
    q.clock = 0;
    // `0x43ed1e` and `0x43f071` — both through `0x40f090`, the mixer's channel 0
    sound?.effect(BUSH.sound, q.x, q.y, "lead");
  };
  const idle = (q: Bush): void => {
    q.state = "idle";
    q.clock = 0;
  };
  // the player can be taken: `0x402f00` (not held, down or spawning) and
  // `0x402f60` (alive)
  const free = (): boolean => p.act !== "dying" && !p.heldBy && p.act !== "held";
  for (const q of hereOf((l) => l.bushes)) {
    q.clock += 1;
    if (q.variant === 1) {
      const b = q.partner!;
      if (q.state === "lash") {
        // `0x43f10e`: ten above the bush, and at its end the bush goes down
        q.x = b.x;
        q.y = b.y - BUSH.lash.above;
        if (q.clock >= BUSH.lash.cels.length * BUSH.lash.hold) {
          // `0x43f136` sends it whatever the bush is doing
          idle(q);
          b.state = "liftDown";
          b.clock = 0;
        }
        continue;
      }
      // `0x43edb0`: it sits on the bush, turned toward you (`0x43eda4`)
      q.x = b.x;
      q.y = b.y;
      if ((p.x < q.x) !== q.mirror && p.x !== q.x) q.mirror = !q.mirror;
      if (
        Math.abs(p.x - q.x) < BUSH.lash.nearPx &&
        b.state === "idle" &&
        q.wait-- < 0 &&
        free()
      ) {
        q.wait = roll(40) + 10;
        sound?.effect(BUSH.lash.sound, q.x, q.y);
        q.state = "lash";
        q.clock = 0;
        b.state = "liftUp";
        b.clock = 0;
      }
      continue;
    }
    if (q.state === "idle") {
      if (
        Math.abs(p.x - q.x) >= BUSH.nearPx ||
        Math.abs(p.y - q.y) >= BUSH.dropPx
      ) {
        // `0x43ed41`: the wait is tested BEFORE it is counted down
        if (q.wait-- < 0) {
          sound?.effect(BUSH.homeSound, q.x, q.y);
          q.wait = roll(40) + 10;
          q.y = q.top + BUSH.peekDy;
          q.state = "peekUp";
          q.clock = 0;
        }
        continue;
      }
      rise(q);
      continue;
    }
    if (q.state === "peekUp" || q.state === "peekDown") {
      chase(q);
      if (q.state === "peekUp") {
        if (q.top < q.y) q.y -= BUSH.peek.stepPx;
        if (q.clock >= BUSH.peek.up.cels.length * BUSH.peek.up.hold) {
          q.state = "peekDown";
          q.clock = 0;
        }
      } else if (q.top + BUSH.peekDy >= q.y) q.y += BUSH.peek.stepPx;
      else {
        q.y = q.restY;
        idle(q);
      }
      hold(q);
      continue;
    }
    if (q.state === "liftUp" || q.state === "liftDown") {
      // `0x43f04d`: close enough and the lifted bush grabs the ordinary way
      if (Math.abs(p.x - q.x) < BUSH.lift.grabPx) {
        rise(q);
        continue;
      }
      if (q.state === "liftUp") {
        if (q.top < q.y) q.y -= BUSH.lift.stepPx;
      } else if (q.top + BUSH.below >= q.y) q.y += BUSH.lift.stepPx;
      else idle(q);
      continue;
    }
    // the grab's latch runs on both arms of `0x43ef31`, rising and sinking:
    // `0x43eea3` — it slides under you while it is still reaching; `0x43eeb0`
    // moves the latch on the frame after the grab has taken, `0x43eee1` again
    // once the cel that closes is up; and `0x43ef00`, with the latch closed,
    // asks every frame whether he is dead: dead, it takes the draw gate
    // (`0x43ef0a`) — it has swallowed him, and its cels are all that is drawn —
    // and plays 0x2a; alive, it hands the gate back (`0x43ef28`)
    if (q.phase === 0) q.x = p.x;
    if (q.phase === 0 && p.heldWhat === q) q.phase = 1;
    else if (q.phase === 1 && bushCel(q) >= BUSH.holdsAt) q.phase = 2;
    else if (q.phase === 2) {
      p.hidden = p.act === "dying";
      if (p.hidden) sound?.effect(BUSH.sinkSound, q.x, q.y);
    }
    if (q.state === "rise") {
      // `0x43ef65` — forty a frame up for as long as the top of its travel is
      // above it, so a rise that starts off the forty-pixel grid overshoots
      if (q.top < q.y) q.y -= BUSH.risePerFrame;
      // the script is thirteen cels at one tick each, and when it runs out
      // `obj+0x46` is set: from that frame `0x43ef31` takes the OTHER arm
      if (q.clock >= BUSH.rise.cels.length * BUSH.rise.hold) {
        q.state = "sink";
        q.clock = 0;
      }
      hold(q);
      continue;
    }
    // `0x43ef4a`: ten a frame back down while the bottom of its travel is not
    // above it — WITH you, if it has you, because `0x42857d` re-reads the grip
    // every frame and plants you at it. Nothing here asks whether it still has
    // hold of anybody.
    if (q.top + BUSH.below >= q.y) q.y += BUSH.sinkPerFrame;
    else {
      // `0x43ef57` → `0x43f007` installs `0x472b70`, whose cels carry no strike
      // box — which is what lets go of the player, and the only thing that
      // does. It stays where the last step left it, and hands the draw gate
      // back (`0x43ef57`) — a player it swallowed is drawn again, dead.
      p.hidden = false;
      q.phase = 0;
      idle(q);
    }
    hold(q);
  }
}

/** which cel a bush is showing */
export function bushCel(q: Bush): number {
  const at = (a: { cels: readonly number[]; hold: number }): number =>
    a.cels[Math.min(a.cels.length - 1, Math.floor(q.clock / a.hold))];
  switch (q.state) {
    case "idle":
      return BUSH.idle.cels[
        Math.floor(q.clock / BUSH.idle.hold) % BUSH.idle.cels.length
      ];
    // sinking is the script having ENDED — `0x43ef31` tests `obj+0x46` and moves
    // the object without installing anything, so it keeps showing its last
    // frame, grip and all, the whole way back down
    case "sink":
      return BUSH.rise.cels.at(-1)!;
    case "peekUp":
      return at(BUSH.peek.up);
    case "peekDown":
      return at(BUSH.peek.down);
    case "liftUp":
      return BUSH.lift.up;
    case "liftDown":
      return BUSH.lift.down;
    case "lash":
      return at(BUSH.lash);
    default:
      return at(BUSH.rise);
  }
}

/**
 * The bolts, one engine frame at a time — and the point of them is that they
 * mostly do nothing.
 *
 * Their strength is the code -1 (`0x413bf9`), so an ordinary handler throws
 * them away: `0x4199b9` compares the strength with 1 and anything below it is
 * not a blow. The bolt still ENDS on whatever it touched — `obj+0x2a` is set by
 * the collision whether or not the handler did anything with it — which is why
 * this expires on contact and takes no health.
 *
 * Boggs is the exception and the reason the gun exists: `0x41bc71` rewrites the
 * -1 as a hundred.
 */
export function stepBolts(): void {
  const lvl = level;
  if (!lvl) return;
  for (const b of bolts) {
    // the think, before anything moves: `0x413b95`..`0x413baf`, more than a
    // thousand pixels across from the player, lets it go where it stands
    if (Math.abs(b.x - p.x) > BOLT.rangePx) {
      b.spent = true;
      continue;
    }
    // ...and then the move, after the frame's hit pass has tested it where it
    // stood — see {@link boltHits} — and on the record this frame's step shows
    if (b.was) b.age += 1;
    b.was = { x: b.x, y: b.y };
    b.x += b.vx;
  }
  setBolts(bolts.filter((b) => !b.spent));
}

/**
 * The flares, one engine frame at a time.
 *
 * `0x43abf0`'s first block is the corkscrew and it is the whole character of the
 * weapon: the random 14..30 the spawner filed is read down two at a time, and
 * each frame its value is added to — or, from 7 up, simply written into — the
 * flare's vertical velocity, with the sign flipping every frame. So it leaves
 * the barrel thrashing and straightens out after about seven frames.
 *
 * What ends the flight is `0x43acae`: the ground under it (`obj+0x2e`) or
 * something it hit (`obj+0x2a`), either of which installs tag 4, the burn-out
 * — and the same think zeroes its strength once `obj+0x2a` is set
 * (`0x43ac19`), so it hits one thing. The mover keeps it: a burning flare
 * falls, lands and slides to a stop, and tag 5 frees it at rest.
 */
export function stepFlares(): void {
  const lvl = level;
  if (!lvl) return;
  for (const f of flares) {
    f.age += 1;
    if (f.burn !== null) {
      // the think: tag 4 a frame a cel, then tag 5 frees it on the first frame
      // the mover has left it at rest — `obj+0x30`, both velocities zero
      f.burn += 1;
      if (f.burn >= FLARE.burn.length && f.grounded && f.vx === 0) {
        f.spent = true;
        continue;
      }
    }
    if (f.wobble > 0) {
      // `0x43ac50` — and the counter goes straight into `obj+0xa`, with no
      // divisor on it at all. Under 7 it is ADDED and from 7 it is WRITTEN, so
      // the last few frames are a settle rather than a fresh throw.
      const v = f.sign * f.wobble;
      if (f.wobble < FLARE.wobble.settle) f.vy += v;
      else f.vy = v;
      f.sign = -f.sign;
      f.wobble -= FLARE.wobble.step;
    }
    // where it stands for the frame's hit pass, and with what — see
    // {@link flareHits}: the pass comes before this move in the engine's frame
    f.was = { x: f.x, y: f.y, vx: f.vx, vy: f.vy, armed: f.burn === null, cel: f.age <= 1 ? FLARE.muzzle : FLARE.flight };
    // the mover, `0x42fd80`: move, then the floor, then — airborne only —
    // gravity (`0x430322`); on the ground the drag instead (`0x4302c0`)
    const wasY = f.y;
    f.x += f.vx;
    if (!f.grounded) f.y += f.vy;
    // the foot is the cel's own extent below the anchor (`0x42fd80`)
    const art = celRec(lvl.sbk, f.age <= 1 ? FLARE.muzzle : FLARE.flight);
    const ext = art ? art.height - art.posY : 0;
    const land: number | null =
      !f.grounded && f.vy > 0 ? regionFloorUnder(f.x, wasY + ext, f.y + ext) : null;
    if (land !== null) {
      f.y = land - ext;
      f.vy = 0;
      f.grounded = true;
      // `0x43acae`: the ground ends the flight, and next frame's think
      // installs the burn-out
      f.burn ??= -1;
    }
    if (f.grounded) f.vx = dragged(f.vx);
    // `0x42f850(obj, 0.5)` stores `trunc(0.5 * 10)` — half the player's own
    else f.vy += FLARE.gravity * PLAYER_GRAVITY;
  }
  setFlares(flares.filter((f) => !f.spent));
}

/**
 * The dropped ones fall — `0x45b060` gives a thrown weapon gravity 1.0 and
 * clears `obj+0x30`, and the handler's think (`0x45ade5`) re-creates it as a
 * standing pickup the frame it lands.
 */
export function stepGuns(): void {
  for (const g of hereOf((l) => l.guns)) {
    g.clock += TICK_SCALE;
    if (!g.dropped || g.vy === undefined) continue;
    // `0x45b060` — `0x42f850(obj, 1.0)`, the same pull the player takes
    g.vy += PLAYER_GRAVITY * TICK_SCALE;
    const wasY = g.y;
    g.y += g.vy * TICK_SCALE;
    const land = surfaceUnder(g.x, wasY, g.y);
    if (land === null) continue;
    g.y = land;
    g.vy = undefined;
    g.vx = undefined;
  }
}
