/**
 * The machinery: the lights and their bolts, the big guns, alarms, fans, belts,
 * chairs, claws and fittings, and Boggs — the body, the machines it works and the
 * worms it sends.
 */
import { TICK_SCALE } from "../brains/kit";
import { ALARM, BIGGUN, BigGun, LIGHTFX, LightFx, Alarm, FAN, Fan, BELT, Belt, CHAIR, Chair, CLAW, Claw, FITTING, Fitting, BOGGS, Boggs, BoggsWorm } from "../props";
import { STREAMS } from "../guns";
import { random } from "../random";
import { level, sound, p, damageOn, player, scaled } from "./state";
import { dropKeys } from "./keys";
import { roundAway, DIVISOR, dragged } from "./motion";
import { celRec, lastCel } from "./cels";
import { levelClock, setLevelClock, setFlashColour } from "./camera";
import { hereOf, roll } from "./rooms";
import { inv, shutStreams, loadRounds, dropGun, streams, spawnBolt } from "./arsenal";
import { bleed, ownPoint, pops, bossDown } from "./blows";
import { takeHealth } from "./hurt";
import { film, died } from "./death";
import { switchSurgesOn, playerSprite } from "./fixtures";
import { lightFlame, castAt, BOGGS_THROW } from "./casts";

/**
 * ...the alarms, which sweep and sound while the vertical fan carrying their
 * param sucks (`0x412fc0`, `0x415dc0`), and the fans, which keep their own
 * counter — see {@link FAN}.
 */
/**
 * TOWER's lightning — `0x426800`, which is a metronome and nothing else.
 *
 * The counter belongs to the LEVEL rather than to any object, runs 0…201 and
 * strikes on 195, so the period is 202 engine frames and the bolt is standing
 * up for the last seven of them before the counter wraps. Nothing you do starts
 * it and nothing you do stops it.
 *
 * The flash is `0x40e4c0(0)`: a colour handed to the painter, flooded over the
 * whole view rect on the next frame and cleared again. In TOWER's own palette
 * colour 0 is blue.
 */
export function stepLights(): void {
  // ...and it is the LEVEL's, not the room's: `0x426800` is TOWER's own
  // per-frame function and `0x426870` walks the whole buffer, so the thunder and
  // the flash reach you in every room and only the bolts themselves are
  // somewhere in particular
  const all = level?.lights.flat() ?? [];
  if (!all.length && !level?.surges.some((r) => r.length)) return;
  for (const q of all) if (q.clock >= 0) q.clock += 1;
  // `0x426800`..`0x426815`: the test is on the count BEFORE the increment, so it
  // reaches 0xc9 for one frame and the period is 0xca
  const was = levelClock;
  setLevelClock(levelClock + 1);
  if (was > LIGHTFX.period - 2) {
    setLevelClock(0);
    // `0x426829`: and every surge in the level switches on
    switchSurgesOn();
  }
  stepStruck();
  // the bolt's second frame on its first cel — see {@link boltStrikes}
  if (all.some((q) => q.clock === 1)) boltStrikes(all);
  if (levelClock !== LIGHTFX.strikeAt || !all.length) return;
  for (const q of all) q.clock = 0;
  // `0x426857` — at the PLAYER's own y, not the bolt's, so it is overhead
  // wherever you are standing
  sound?.effect(LIGHTFX.sound, p.x, p.y, "lead");
  setFlashColour(LIGHTFX.flash);
  boltStrikes(all);
}

/**
 * ...and the bolt STRIKES. `0x426780`, the bolt's own think, asks on its
 * first frame (`obj+0x42` and `obj+0x44` both 0, `0x426785`/`0x42678c`) one
 * thing only: is its point BELOW the player's (`0x42679c`, `obj+6` against
 * the player's `obj+6`, a signed `jle`). No x, no distance — every bolt in
 * the level asks it, so a player who has climbed above a bolt's point is hit
 * wherever he is. Then `0x4267a2`: armed (`0x402ee0`) with the scepter,
 * weapon 16 (`0x4267ac`), `0x402fa0(6)`; anything else, `0x402fa0(7)`.
 *
 * And it asks TWICE. The bolt's script holds its first cel two frames
 * (`0x46f588`, two ticks a frame), so `obj+0x42` is 0 on both, and each time
 * `0x45d090` puts the reaction on from its first frame whatever was playing
 * (`0x45d0ab` zeroes the frame index, `0x45d0db` the tick count): the charge
 * or the shock starts over one frame late, and the shock's `0x40e4c0(5)`
 * floods a second frame. The life is spent once, as the death ends.
 */
function boltStrikes(all: readonly LightFx[]): void {
  const ay = p.y - p.feet;
  if (!all.some((q) => q.y > ay) || film) return;
  // `0x402fa0` opens with `0x402df0`: every key dropped
  dropKeys();
  if (inv.drawn && inv.weapon === LIGHTFX.rod) {
    // `0x42f3af` — `0x470c40` tag 18, the scepter's own script: the charge
    if (p.act === "fire") shutStreams();
    p.act = "struck";
    p.actClock = 0;
    p.flail = false;
    struckTags = 0;
    return;
  }
  // `0x42f3c5` — `0x40e4c0(5)` and `0x4721a0` TAG 3, the shock and the fall.
  // Unconditional: no `0x402f60` test here, so it is a death whatever the
  // health says, and it goes on from its first frame over whatever was playing
  setFlashColour(LIGHTFX.struckFlash);
  p.act = "dying";
  p.actClock = 0;
  p.vx = 0;
  p.dyingTag = 3;
  // ...and the life goes with it, once: `died` answers a second call with
  // nothing, as the disc spends it only as the death script ends
  died();
}

/**
 * A lightning strike on the scepter — `0x470c40` tags 18..22 in the player's
 * armed state machine `0x42d2b0`, three frames each, all on one cel.
 *
 * ```
 *   42d93e  tags 18 and 20 end: 0x40e4c0(5), fire(3), the next tag
 *   42d98a  tags 19 and 21 end: fire(4), the next tag
 *   42d9c7  tag 22 ends:  weapon 16, 0x45ef30(0xa0), 0x45b060 — the scepter
 *           thrown on the floor — [0x479438] = 0, and 0x4722a8 tag 0
 * ```
 *
 * `fire` is `[0x4a7fd8]`, the scepter's fire function `0x41f6b0`, and its
 * variants 3 and 4 (`0x41f7e2`) cost nothing, hang the beam 48 along and 130
 * up, and turn it round (`user+8`, read at `0x42466c`). So the bolt goes out
 * of the rod four times, the gauge fills, and it is knocked out of your hands.
 */
function stepStruck(): void {
  if (p.act !== "struck") return;
  // each tag that has ended since last time, in order
  const now = Math.floor(p.actClock / LIGHTFX.charge.hold);
  for (; struckTags < now && struckTags < LIGHTFX.charge.tags; struckTags++) {
    const ended = struckTags;
    if (ended < LIGHTFX.charge.tags - 1) {
      if (ended % 2 === 0) setFlashColour(LIGHTFX.struckFlash);
      dischargeScepter(ended % 2 === 0 ? 3 : 4);
      continue;
    }
    // `0x42d9d7`..`0x42da31`
    inv.weapon = LIGHTFX.rod;
    loadRounds(LIGHTFX.rod, LIGHTFX.charge.rounds);
    dropGun();
    p.act = "downFront";
    p.actClock = 0;
    return;
  }
}

/** how many of the strike's tags {@link stepStruck} has already ended */
let struckTags = 0;

/** `0x41f7e2` — a beam of the scepter's, variant 3 or 4, and free */
function dischargeScepter(variant: 3 | 4): void {
  const kit = STREAMS[LIGHTFX.rod];
  if (!kit) return;
  // `0x41f73a` — 0x22 through `0x40f110`, at the beam
  sound?.effect(kit.sound.effect ?? 0x22, p.x, p.y, "renew");
  streams.push({
    weapon: LIGHTFX.rod,
    x: p.x,
    y: p.y,
    facing: -p.facing,
    state: "start",
    clock: 0,
    variant,
    flip: true,
  });
}

/** which cel a bolt is showing, or 0 while there is none */
export function lightCel(q: LightFx): number {
  if (q.clock < 0) return 0;
  const i = Math.floor(q.clock / LIGHTFX.bolt.hold);
  return i < LIGHTFX.bolt.cels.length ? LIGHTFX.bolt.cels[i] : 0;
}

/**
 * MAZE's big guns — `0x4135b0`, one handler and eight script kinds.
 *
 * The hatch and the turret are two objects in `SC.EXE` and one record here,
 * because they never disagree: both start on the same rect test and the hatch's
 * four tags simply shadow whatever the turret is doing. What is faithful is the
 * ORDER — every state that can be interrupted tests the rect first and folds
 * away the moment the player is outside it, so backing out of the rect stops
 * the gun wherever it had got to rather than letting it finish.
 */
export function stepBigGuns(): void {
  for (const g of hereOf((l) => l.bigguns)) {
    const inside =
      p.x >= g.left &&
      p.x <= g.right &&
      p.y - p.feet >= g.top &&
      p.y - p.feet <= g.bottom;
    stepHatch(g, inside);
    g.clock += 1;
    switch (g.state) {
      // `0x41360a` — waiting, and the rect is the only way out of it
      case "wait":
        if (inside) {
          g.state = "arm";
          g.clock = 0;
        }
        break;
      // `0x41363e` — 0x46c1e8 tag 1, eight frames at two, then it drops
      case "arm":
        if (g.clock >= BIGGUN.wait.frames * BIGGUN.wait.hold) {
          g.state = "drop";
          g.clock = 0;
        }
        break;
      // `0x41365f` — eight a frame until it is 0x6e below its HOME, and home is
      // the point already lifted by ten: `0x4115ec` decrements the user block's
      // own copy before `0x4115fb` reads it back out for the object's position,
      // so `0x41366b` measures from there and the drop is 100 below the record
      case "drop":
        g.gunY += BIGGUN.step;
        if (g.gunY >= g.y - BIGGUN.turretUp + BIGGUN.drop) {
          g.state = "unfold";
          g.clock = 0;
        }
        break;
      // `0x413692` — and from here on, leaving the rect folds it away
      case "unfold":
        if (!inside) {
          g.state = "fold";
          g.clock = 0;
        } else if (g.clock >= BIGGUN.unfold.cels.length * BIGGUN.unfold.hold) {
          g.state = "fire";
          g.shot = 0;
          g.clock = 0;
        }
        break;
      // `0x4136e3` — tags 0 and 1 each fire one bolt, tag 2 is the recovery
      case "fire": {
        if (!inside) {
          g.state = "fold";
          g.clock = 0;
          break;
        }
        const run = shotRun(g);
        if (g.clock < run.cels.length * run.hold) break;
        if (g.shot < 2) {
          // `0x41373c` / `0x413770` — the sound, then `0x412a70(gun, 0)`, which
          // inverts the shooter's own mirror flag: the gun faces you and the
          // shot goes the other way round, which is the same way. Variant 0
          // is its own shot, not the blaster's — {@link GUNBOLT}
          sound?.effect(BIGGUN.sound, g.x, g.gunY);
          spawnBolt(g.x, g.gunY, p.x > g.x ? 1 : -1, 100);
          g.shot += 1;
          g.clock = 0;
        } else {
          g.state = "blink";
          g.clock = 0;
        }
        break;
      }
      // `0x4137b4` — and it asks again at the END of the blink, not during it
      case "blink":
        if (g.clock < BIGGUN.blink.cels.length * BIGGUN.blink.hold) break;
        g.state = inside ? "fire" : "fold";
        g.shot = 0;
        g.clock = 0;
        break;
      // `0x413830` — folding does not check anything; it finishes
      case "fold":
        if (g.clock >= BIGGUN.fold.cels.length * BIGGUN.fold.hold) {
          g.state = "rise";
          g.clock = 0;
        }
        break;
      // `0x413851` — eight a frame back up, and home is the record's own point
      case "rise":
        g.gunY -= BIGGUN.step;
        if (g.gunY <= g.y - BIGGUN.turretUp) {
          g.gunY = g.y - BIGGUN.turretUp;
          g.state = "wait";
          g.clock = 0;
        }
        break;
    }
  }
}

/** the script a big gun's shot plays — one, two, or done */
function shotRun(g: BigGun) {
  if (g.shot === 0) return BIGGUN.fire.one;
  return g.shot === 1 ? BIGGUN.fire.two : BIGGUN.fire.done;
}

/** the script the hatch's tag plays, and none for tag 0 */
function hatchRun(g: BigGun) {
  switch (g.hatch) {
    case 1:
      return BIGGUN.hatch.open;
    case 2:
      return BIGGUN.hatch.held;
    case 3:
      return BIGGUN.hatch.close;
    default:
      return null;
  }
}

/** `0x41387c` — the hatch, which has its own four tags and its own clock */
export function stepHatch(g: BigGun, inside: boolean): void {
  g.hatchClock += 1;
  const run = hatchRun(g);
  if (!run) {
    if (inside) {
      g.hatch = 1;
      g.hatchClock = 0;
    }
    return;
  }
  if (g.hatchClock < run.cels.length * run.hold) return;
  // tag 1 always goes to 2; tag 2 asks the rect again; tag 3 goes home
  if (g.hatch === 1) g.hatch = 2;
  else if (g.hatch === 2) g.hatch = inside ? 2 : 3;
  else g.hatch = 0;
  g.hatchClock = 0;
}

/** which cel the hatch is showing — `0x46c238`'s four tags */
export function hatchCel(g: BigGun): number {
  if (g.hatch === 0) return BIGGUN.hatch.shut;
  const run = hatchRun(g) ?? BIGGUN.hatch.close;
  const i = Math.min(run.cels.length - 1, Math.floor(g.hatchClock / run.hold));
  return run.cels[i];
}

/** which cel the turret is showing, or 0 while it is still behind the hatch */
export function gunCel(g: BigGun): number {
  const step = (
    a: { cels: readonly number[]; hold: number },
    clock: number,
  ): number => a.cels[Math.min(a.cels.length - 1, Math.floor(clock / a.hold))];
  switch (g.state) {
    case "wait":
      return 0;
    case "arm":
    case "drop":
      return BIGGUN.unfold.cels[0];
    case "unfold":
      return step(BIGGUN.unfold, g.clock);
    case "fire":
      return step(shotRun(g), g.clock);
    case "blink":
      return BIGGUN.blink.cels[
        Math.floor(g.clock / BIGGUN.blink.hold) % BIGGUN.blink.cels.length
      ];
    case "fold":
      return step(BIGGUN.fold, g.clock);
    case "rise":
      return BIGGUN.fold.cels.at(-1)!;
  }
}

export function stepAlarms(): void {
  for (const a of level?.alarms.flat() ?? []) {
    // `0x412fc0`: tag 0 is the one quiet cel; tag 1 sweeps and sounds each time round
    if (!a.on) continue;
    const was =
      Math.floor(a.clock) % (ALARM.flash.cels.length * ALARM.flash.hold);
    a.clock += 1;
    if (
      Math.floor(a.clock) % (ALARM.flash.cels.length * ALARM.flash.hold) <
      was
    )
      sound?.effect(ALARM.sound, a.x, a.y);
  }
}

/** `0x415dc0` — every alarm carrying this param onto tag 0 (quiet) or tag 1 */
export function setAlarms(param: number, on: boolean): void {
  for (const a of level?.alarms.flat() ?? []) {
    if (a.param !== param) continue;
    a.on = on;
    a.clock = 0;
  }
}

export function alarmCel(a: Alarm): number {
  if (!a.on) return ALARM.quiet;
  const i = Math.floor(
    (a.clock % (ALARM.flash.cels.length * ALARM.flash.hold)) / ALARM.flash.hold,
  );
  return ALARM.flash.cels[Math.min(ALARM.flash.cels.length - 1, i)];
}

export function stepFans(): void {
  const ay = p.y - p.feet;
  // every fan in the LEVEL: the class list is the stage's, and the vertical ones
  // work alarms that may stand in another room
  for (const f of level?.fans.flat() ?? []) {
    f.clock += 1;
    // kind 1, the blades running red: its end hands to tag 1 (`0x4156e2`, `0x415c82`)
    if (f.red) {
      const red = f.horizontal ? FAN.h.red : FAN.v.red;
      if (f.clock < red.cels.length * red.hold) continue;
      f.red = false;
      f.state = "stop";
      f.clock = 0;
      continue;
    }
    // the player's point in the record's rect (`0x415445`, `0x415a14`)
    const inside =
      p.x >= f.left && p.x < f.right && ay >= f.top && ay < f.bottom;
    // `0x4153fa`: the test is on the count BEFORE the decrement
    const out = f.count < 0;
    f.count -= 1;
    if (f.state === "suck") {
      if (out) {
        f.state = "stop";
        f.clock = 0;
        f.count = FAN.offFrames;
        if (!f.horizontal) setAlarms(f.param, false);
        continue;
      }
      if (!inside || p.act === "dying" || film) continue;
      if (f.horizontal) {
        // `0x415464`: toward the fan's x; `0x4154a3`: within 140 it kills;
        // `0x415554`: within 270 it stops the fall and turns you to face it
        p.vx += roundAway((p.x <= f.x ? FAN.h.push : -FAN.h.push) / DIVISOR);
        const dx = Math.abs(p.x - f.x);
        if (dx < FAN.h.killPx) {
          fanKills(f);
        } else if (dx < 0x10e) {
          p.vyRaw = 0;
          p.facing = p.x > f.x ? -1 : 1;
          // `0x415588` — `0x402fa0(0)`, every frame of it: `0x402df0` drops
          // every key, so nothing held walks you out of the fan's pull
          dropKeys();
        }
      } else {
        // `0x415a2c`: up into it; `0x415a6e`: within 100 of it, it kills
        p.vyRaw += roundAway(FAN.v.suck / DIVISOR);
        if (Math.abs(ay - f.y) < FAN.v.killPx) fanKills(f);
      }
      continue;
    }
    if (f.state === "stop") {
      if (!out) continue;
      sound?.effect(FAN.change, f.x, f.y);
      f.state = "blow";
      f.clock = 0;
      f.count = FAN.onFrames;
      continue;
    }
    if (f.state === "blow") {
      if (out) {
        f.state = "rest";
        f.clock = 0;
        f.count = FAN.offFrames;
        continue;
      }
      if (!inside) continue;
      // `0x415650` / `0x415bf0`: the same push, away
      if (f.horizontal)
        p.vx += roundAway((p.x <= f.x ? -FAN.h.push : FAN.h.push) / DIVISOR);
      else p.vyRaw += roundAway(FAN.v.blow / DIVISOR);
      continue;
    }
    // "rest"
    if (!out) continue;
    sound?.effect(FAN.change, f.x, f.y);
    if (!f.horizontal) setAlarms(f.param, true);
    f.state = "suck";
    f.clock = 0;
    f.count = FAN.onFrames;
  }
}

/**
 * `0x4154ae` / `0x415a85`: `0x402fa0(8)` (`0x4154b7`, `0x415a89`), 0x16, and
 * the blades run red. `0x402fa0` opens with `0x402df0`, which drops every key.
 */
export function fanKills(f: Fan): void {
  dropKeys();
  // `0x4154d8` / `0x415aba` — `0x40c900(player, 0x78, fan)` once `0x402ac0(0x4b0)`
  // has emptied the tank, so it is always blood; the fan stands still
  const cel = level ? celRec(level.sbk, fanCel(f)) : null;
  bleed(0x78, ownPoint(), { blow: cel?.blow ?? null, facing: 1, vx: 0, vy: 0 }, true);
  sound?.effect(FAN.kill, f.x, f.y);
  f.red = true;
  f.clock = 0;
  died();
}

/** which cel a fan is showing — each tag loops, as the think reinstalls it */
export function fanCel(f: Fan): number {
  const kit = f.horizontal ? FAN.h : FAN.v;
  const n = kit.spin.cels.length;
  if (f.red)
    return kit.red.cels[Math.min(kit.red.cels.length - 1, Math.floor(f.clock / kit.red.hold))];
  if (f.state === "rest") return kit.stopped;
  if (f.state === "stop") return kit.held;
  const i = Math.floor(f.clock / kit.spin.hold) % n;
  return f.state === "suck" ? kit.spin.cels[i] : kit.spin.cels[n - 1 - i];
}

/**
 * BARREL's conveyors — `0x416840`, which is one test and one number.
 *
 * The belt asks whether the bottom of the player's drawn box (`0x42f9f0`) is
 * above its own point by less than 20 (`0x416881`), whether their POINT's x is
 * strictly inside its rect (`0x416899`), and whether they are on the ground
 * (`0x4168d0`); if so it adds its record's `param` — 4, 6, 8 or 10 — to the
 * player's `obj+0xc`, every frame (`0x4168db`; a left-hand belt subtracts it,
 * `0x41694b`). The ground's drag keeps 30% of it (`0x4302c0`), so a belt
 * settles where `v = drag(v) + param`: 6 a frame for a param of 4, 13 for 10
 * — and walking adds to it.
 *
 * The belt thinks before the mover moves anyone (`0x417c20`); this runs after
 * the frame tick's quarter of the move, so it adds that quarter of the push to
 * the position as well. The three ticks that follow carry the rest at the new
 * velocity, and the frame moves exactly `drag(v) + param`, as the engine does.
 */
export function stepBelts(): void {
  const here = hereOf((l) => l.belts);
  if (!here.length) return;
  for (const b of here) {
    b.clock += 1;
    if (!p.onGround) continue;
    const me = playerSprite();
    const bottom = me ? me.top + me.f.height : p.y;
    const above = b.y - bottom;
    if (!(above > 0 && above < BELT.bandPx)) continue;
    if (!(p.x > b.left && p.x < b.right)) continue;
    p.vx += b.dir * b.param;
    p.x += b.dir * b.param * TICK_SCALE;
  }
}

/** which cel a belt is showing — backwards for a left-hand one, which is tag 1 */
export function beltCel(b: Belt): number {
  // `0x411532`: a param under 5 is `0x46c188` (three frames a cel), under 10
  // `0x46c130` (two), and otherwise `0x46c0d8` (one)
  let hold: number = BELT.roll.hold;
  if (b.param < 5) hold = BELT.slowHold;
  else if (b.param < 10) hold = 2;
  const i = Math.floor(b.clock / hold) % BELT.roll.cels.length;
  return b.dir < 0
    ? BELT.roll.cels[BELT.roll.cels.length - 1 - i]
    : BELT.roll.cels[i];
}

/** ...and the chairs, three tags handed round until you come near — {@link CHAIR} */
export function stepChairs(): void {
  for (const c of hereOf((l) => l.chairs)) {
    const run = CHAIR.runs[c.run];
    // tag 3 has no handler (`0x417a08`)
    if (!run) continue;
    const was = c.run;
    if (c.clock >= run.cels.length * run.hold) {
      c.clock = 0;
      c.run = (c.run + 1) % CHAIR.runs.length;
    }
    // `0x417a50`: only tag 2's handler tests the distance — after its own end
    // check, so it can take a chair from tag 2 to 3 on the frame it would go to 0
    if (was === 2 && Math.abs(c.x - p.x) < CHAIR.nearPx) {
      c.run = CHAIR.runs.length;
      c.clock = 0;
      continue;
    }
    c.clock += 1;
  }
}

export function chairCel(c: Chair): number {
  const run = CHAIR.runs[c.run];
  if (!run) return CHAIR.rest;
  return run.cels[
    Math.min(run.cels.length - 1, Math.floor(c.clock / run.hold))
  ];
}

/**
 * The claws — `0x4171e0`, a carriage on a rail that follows you.
 *
 * Its velocity is clamped to ±26 (`0x417344`, `0x417376`) and its position to
 * its own record's bounds (`0x417316`), so it tracks the player along its track
 * and cannot leave it. `0x417289` then measures the gap: inside 300 it reaches
 * down, past 600 it waits, and in between it runs.
 *
 * ...and while it runs it can also DIVE, which is the other claw: kind 1, the
 * 2450s, reached from the tracker's band table rather than from that distance
 * (`0x41734a`). It reaches at 140 pixels ahead and commits at 100, and if it
 * comes down on you it clamps with the code -3 on the only four cels of the
 * fifty-two that carry a grip. See {@link CLAW} and `src/codes.ts`.
 */
export function stepClaws(): void {
  const here = hereOf((l) => l.claws);
  if (!here.length) return;
  for (const c of here) {
    c.clock += 1;
    const want = Math.max(c.left, Math.min(c.right, p.x));
    const gap = Math.abs(p.x - c.x);
    // the DIVE, and it owns the claw until it is back up — `0x4173bf`'s four tags
    if (c.state === "dive" || c.state === "clamp" || c.state === "lift") {
      const a = clawScript(c);
      if (c.clock < a.cels.length * a.hold) continue;
      c.clock = 0;
      if (c.state === "dive") {
        // `0x417448` — `obj+0x2a`, and a dive that touched nothing goes straight
        // back up without ever showing the code
        c.state = c.caught ? "clamp" : "lift";
        c.caught = false;
        if (c.state === "clamp") sound?.effect(CLAW.clamp, c.x, c.y);
      } else if (c.state === "clamp") {
        // `0x417496` writes the blow back to 0 before it rises, which is what
        // lets go: the grip goes with the cels
        c.state = "lift";
      } else c.state = "running";
      continue;
    }
    if (c.state === "down" || c.state === "shut" || c.state === "up") {
      const a = clawScript(c);
      if (c.clock < a.cels.length * a.hold) continue;
      c.clock = 0;
      if (c.state === "down") c.state = "shut";
      else if (c.state === "shut") c.state = "up";
      else c.state = "running";
      if (c.state === "shut") sound?.effect(CLAW.clamp, c.x, c.y);
      continue;
    }
    // it moves whether or not it is going to reach: `0x417344` is outside the
    // distance test
    const step = Math.max(-CLAW.speed, Math.min(CLAW.speed, want - c.x));
    if (step !== 0 && c.state !== "running") {
      c.state = "running";
      c.clock = 0;
      sound?.effect(CLAW.wizz, c.x, c.y);
    }
    c.x += step;
    /**
     * What it does about the player, nearest test first.
     *
     * The original measures two different distances and this page has only ever
     * had one. `0x417289`'s 300 and 600 are from the RECORD's own point, which
     * is fixed; the band the diving kind comes off is from the CLAW's x, which
     * is not. This keeps the single gap the class was built on and orders the
     * tests by reach, so the nearer behaviour wins — which is what the numbers
     * say happens anyway: 140 is inside 300.
     *
     * `0x45efd0` hands `0x41734a` an index into `0x46dfc8` — 180, 140, 100 —
     * and only bands 2 and 3 install the diving kind, so it reaches at 140 and
     * commits at 100. A negative gap is band -1 and reaches for nothing; this
     * page has no facing on a claw, so it reaches either way and that is the
     * one liberty taken here.
     */
    if (gap > CLAW.restPx) {
      c.state = "idle";
    } else if (gap <= CLAW.reachBand) {
      c.state = "dive";
      c.clock = 0;
      sound?.effect(CLAW.wizz, c.x, c.y);
    } else if (gap < CLAW.reachPx && Math.abs(want - c.x) < 4) {
      c.state = "down";
      c.clock = 0;
    }
  }
}

/** the script a claw's state plays */
function clawScript(c: Claw) {
  switch (c.state) {
    case "idle":
      return CLAW.idle;
    case "running":
      return CLAW.running;
    case "down":
      return CLAW.down;
    case "shut":
      return CLAW.shut;
    case "dive":
      return CLAW.dive;
    case "clamp":
      return CLAW.jaws;
    case "lift":
      return CLAW.lift;
    default:
      return CLAW.up;
  }
}

/** which cel a claw is showing */
export function clawCel(c: Claw): number {
  const a = clawScript(c);
  const i =
    c.state === "idle" || c.state === "running"
      ? Math.floor(c.clock / a.hold) % a.cels.length
      : Math.min(a.cels.length - 1, Math.floor(c.clock / a.hold));
  return a.cels[i];
}

/**
 * What Boggs' body says as a blow lands — `0x41bc50`, and see
 * {@link BOGGS.struck} and {@link BOGGS.hint}. `bolted` is a blaster bolt,
 * the class `0x41bca7` asks about.
 */
export function boggsStruck(b: Boggs, bolted: boolean): void {
  const s = BOGGS.struck;
  const up = b.flags[0] || b.flags[1];
  // `0x41bcd6` through `0x40f110`, or `0x41bcf9` through `0x40ef30`
  if (up && bolted) {
    const which = s.bolted + roll(s.boltRoll);
    sound?.effect(which, b.x, b.y, "renew");
  } else {
    const which = s.sound + roll(s.roll);
    sound?.effect(which, b.x, b.y);
  }
  if (!up) return;
  const h = BOGGS.hint;
  const was = b.blows ?? 0;
  b.blows = was + 1;
  const m = b.machines[h.machine];
  if (was > h.after && m && m.x - h.westOf > p.x) {
    sound?.effect(h.sound, b.headX, b.headY, "lead");
    b.blows = 0;
  }
}

/** what a fitting is playing — see {@link FITTING} */
function fittingAnim(f: Fitting): { cels: readonly number[]; hold: number } {
  if (f.kind === "teeth") return { cels: [FITTING.teeth.cel], hold: 1 };
  if (f.kind === "ball") {
    if (f.phase === "out") return FITTING.ball.out;
    return f.phase === "back" ? FITTING.ball.back : FITTING.ball.idle;
  }
  return f.phase === "spray" ? FITTING.shower.spray[f.tag] : FITTING.shower.idle[f.tag];
}

/** the cel a fitting is showing — the teeth's one, a shower's or a ball's script */
export function fittingCel(f: Fitting): number {
  const a = fittingAnim(f);
  return a.cels[Math.min(a.cels.length - 1, Math.floor(f.clock / a.hold))];
}

/**
 * `[0x46cd8c]` — the shower's first-time cue. It ships as 1 and `0x41a38f` is
 * the only write, so it is spent once in a run of the game.
 */
let showerFirst = true;

/**
 * VAT's showers and balls, one engine frame each — `0x41a2a0` and `0x41a7d0`.
 * See {@link FITTING} for the whole of both.
 */
export function stepFittings(): void {
  const lvl = level;
  if (!lvl) return;
  const px = p.x;
  const py = p.y - p.feet;
  // `0x434200`, half-open, the player's own point against the record's rect
  const inside = (f: Fitting): boolean => px >= f.left && px < f.right && py >= f.top && py < f.bottom;
  for (const f of hereOf((l) => l.fittings)) {
    if (f.kind === "teeth") continue;
    const a = fittingAnim(f);
    const ended = f.clock >= a.cels.length * a.hold;
    const at = Math.floor(f.clock / a.hold);
    if (f.kind === "shower") {
      const S = FITTING.shower;
      if (f.phase === "idle") {
        if (!inside(f)) continue;
        if (showerFirst) {
          showerFirst = false;
          sound?.effect(S.first, f.x, f.y, "lead");
        }
        const hiss = roll(S.hiss);
        sound?.effect(hiss, f.x, f.y);
        f.phase = "spray";
        f.clock = 0;
        continue;
      }
      // `0x41a2f8` — the x distance and nothing else, on the frames that burn,
      // and only while `0x402f60` says the player is on his feet
      if (Math.abs(px - f.x) < S.withinPx && S.burns(S.base[f.tag] + at) && p.act !== "dying") {
        if (damageOn) takeHealth(S.health);
        // `0x41a3f0` makes a new flame every frame it is called
        lightFlame(p, celRec(player, lastCel), p.facing < 0, { stack: true });
        sound?.effect(S.burn, px, py);
      }
      if (ended) {
        f.phase = "idle";
        f.clock = 0;
      } else f.clock += 1;
      continue;
    }
    const B = FITTING.ball;
    if (f.phase === "idle") {
      if (!inside(f)) continue;
      sound?.effect(B.cue, px, py, "lead");
      f.phase = "out";
      f.clock = 0;
      continue;
    }
    if (at === B.swishAt) sound?.effect(B.swish, f.x, f.y);
    if (ended) {
      f.phase = f.phase === "out" ? "back" : "idle";
      f.clock = 0;
    } else f.clock += 1;
  }
}

/**
 * ...and BOGGS, on the idle `0x46e6b0` gives it. Four thousand health and thirty
 * a frame back while its machine runs, which is what makes it the boss — its hit
 * handler turns away only its own parts. See {@link BOGGS}.
 */
/**
 * Boggs, once an engine frame — and it is four objects, not one.
 *
 * `0x41be68` heals the body while EITHER of the flags at `0x46e080` and
 * `0x46e084` is set, and the flags are not a phase it enters: both ship as
 * `01 00` in `.data`, nothing in `.text` ever sets one, and the only two writes
 * there are are the clears at `0x41b611` and `0x41b75d`. Both of those are in
 * the MACHINERY's hit handler, one per breakable half.
 *
 * So the fight is: break three thousand of machine to stop half the healing,
 * break three thousand more to stop the rest, and only then can the four
 * thousand on the head be spent. See {@link BOGGS.machines}.
 *
 * Everything else is placed against the body. VAT's frame loop runs the body's
 * tick (`0x41be50`), the first machine's think (`0x41afd0`) and the move pass,
 * and then re-places the head (`0x41c4c0`), the eight machines (`0x411ed0`)
 * and the arm (`0x412180`) from the body's new point — every frame, so all of
 * it lunges with the body. See {@link placeBoggs}.
 */
export function stepBoggs(): void {
  for (const b of hereOf((l) => l.boggs)) {
    b.clock += 1;
    if (b.snap > 0) b.snap -= 1;
    // the worms are a class of their own and run whatever the body is doing
    stepBoggsWorms(b);
    for (const m of b.machines) {
      if (m.wrecked) m.wreckClock += 1;
      else m.clock += 1;
    }
    boggsSendsZap(b);
    boggsBody(b);
    boggsMachinery(b);
    placeBoggs(b);
  }
}

/**
 * `0x41bef4` — the body's tick puts the first machine out: the player at or
 * right of the body, the machine on its kind 0 and `0x46e080` up. See
 * {@link BOGGS.zap}.
 */
export function boggsSendsZap(b: Boggs): void {
  const z = b.zap;
  if (b.x - p.x > 0 || z.kind !== 0 || !b.flags[0]) return;
  z.kind = 1;
  z.tag = 0;
  z.clock = 0;
  z.dy = BOGGS.zap.at.dy;
  z.dx = BOGGS.zap.at.dx;
}

/**
 * `0x41afd0`, the machinery's own think, once a frame: the first machine's
 * sweep and the price of the sixth machine's wreck — {@link BOGGS.zap},
 * {@link BOGGS.drain}.
 *
 * The think runs before the stepper does (`0x419c30`, then `0x42fc10`), so
 * `obj+0x46` — the script has ended — is what the step of the frame before
 * left, and a tag's end is read the frame after its last cel is spent.
 */
export function boggsMachinery(b: Boggs): void {
  const z = b.zap;
  const Z = BOGGS.zap;
  // `0x41afd3` — `lab.snd` 0x14 armed to loop, every frame whatever else, and
  // while either half of the machine still runs it plays at the second half's
  // point (`0x41aff8`..`0x41b008`): the machine's hum, one loop the mixer keeps
  // and each frame's play moves
  sound?.loop(BOGGS.hum, true);
  if (b.flags[0] || b.flags[1]) {
    const m = b.machines[BOGGS.humAt];
    sound?.effect(BOGGS.hum, m.x, m.y);
  }
  if (z.kind === 1) {
    z.armed = true; // `0x41b022`
    // `0x41b028` / `0x41b045` — 0x402f60 is his kind under 0x1a, which is
    // what the brains read as the player being down
    if (p.act !== "dying") z.taunted = false;
    else if (!z.taunted) {
      z.taunted = true;
      sound?.effect(Z.taunt, b.headX, b.headY, "lead");
    }
    z.dx += Z.step[z.tag] ?? 0;
    if (z.clock >= (Z.frames[z.tag] ?? 1) * Z.hold) {
      // each tag's end installs the next; 4's is `0x46e4d0`, kind 0
      // (`0x41b105`) — and the stepper takes its first step of it this frame
      if (z.tag < Z.frames.length - 1) {
        z.tag += 1;
        z.clock = 1;
      } else {
        z.kind = 0;
        z.tag = 0;
        z.clock = 0;
      }
    } else z.clock += 1;
  }
  // `0x41b156` — the sixth machine's wreck run, and what it takes
  const d = BOGGS.drain;
  const g = b.machines[d.machine];
  const spec = BOGGS.machines[d.machine];
  const run = "wreck" in spec ? spec.wreck.length * spec.hold : 0;
  if (!g?.wrecked || g.wreckClock < 1 || g.wreckClock > run + 1) return;
  b.hp -= d.perFrame;
  const r = roll(d.odds[1]);
  if (r < d.odds[0]) {
    const at = b.machines[d.at];
    const across = roll(d.across[0]) - d.across[1];
    const down = roll(d.down);
    pops.push({ x: at.x + across, y: at.y + down, age: 0 });
  }
  // `0x41b1e2` — the run has ended: the gauge stops on 5945
  if (g.wreckClock === run + 1) {
    b.machines[d.at].wrecked = true;
    b.machines[d.at].wreckClock = 0;
  }
}

/**
 * `0x41c4c0`, `0x411ed0` and `0x412180`, which VAT's frame loop runs every
 * frame after the move (`0x419c76`..`0x419c80`): the head at the body plus its
 * stored offset, the eight machines at the body plus `0x46e088`'s, and the
 * first of them at the body plus `[0x4a5168]` instead. The arm is drawn at the
 * body's own point, which is what `0x4121ae` copies.
 */
export function placeBoggs(b: Boggs): void {
  b.headX = b.x + b.headOff.dx;
  b.headY = b.y + b.headOff.dy;
  // `0x41ab90` — the worms' box with the body, and each worm at the body plus
  // its own offset, held inside the box (`0x41ac09`..`0x41ac46`)
  if (b.bounds && b.boundsOff) {
    b.bounds = {
      left: b.x + b.boundsOff.left,
      right: b.x + b.boundsOff.right,
      top: b.y + b.boundsOff.top,
      bottom: b.y + b.boundsOff.bottom,
    };
  }
  for (const w of b.worms) {
    if (!w.off) continue;
    w.x = b.x + w.off.dx;
    w.y = b.y + w.off.dy;
    if (b.bounds) {
      w.x = Math.min(Math.max(w.x, b.bounds.left), b.bounds.right);
      w.y = Math.min(Math.max(w.y, b.bounds.top), b.bounds.bottom);
    }
  }
  for (let i = 0; i < b.machines.length; i++) {
    const m = b.machines[i];
    const spec = BOGGS.machines[i];
    m.x = b.x + (i === 0 ? b.zap.dx : spec.dx);
    m.y = b.y + (i === 0 ? b.zap.dy : spec.dy);
  }
}

/** the body's own share of `0x41be50` — the heal, the head, the jaws and the lunge */
function boggsBody(b: Boggs): void {
  if (b.dying) {
    b.headClock += 1;
    return;
  }
  // `0x41bd69` — and `0x41bdd8` is the level's own cleared flag
  if (b.hp <= 0) {
    b.dying = true;
    bossDown.lab = true;
    b.clock = 0;
    b.headClock = 0;
    // `0x41bda0` — through `0x40f090`, the mixer's channel 0
    sound?.effect(BOGGS.dies.sound, b.headX, b.headY, "lead");
    return;
  }
  // `0x41c182` — the head re-aims whenever its own script has ended, which at
  // one frame a tag and three ticks a frame is every third frame
  b.headClock += 1;
  if (b.headClock >= BOGGS.head.hold) {
    b.headClock = 0;
    b.headTag = boggsAim(b);
  }
  // `0x41be68` — thirty a frame, and only while a flag is still up
  if (b.flags[0] || b.flags[1])
    b.hp = Math.min(scaled(BOGGS.health), b.hp + BOGGS.regen);
  // `0x41c164` — the 5-in-100 branch, and the jaws snap through `0x46e558`
  const jaws = BOGGS.arm.jaws;
  if (
    b.snap <= 0 &&
    Math.floor(random() * jaws.snapOdds[1]) < jaws.snapOdds[0]
  ) {
    b.snap = jaws.snap.cels.length * jaws.snap.hold;
  }
  const a = b.lunge ? BOGGS.lunge[b.lunge] : null;
  if (a) {
    // the stride is the script's own, an impulse through the biggest divisor
    // in the game (`0x45d0f0` → `0x42f8b0`: 470/100 is 5 a frame, every frame
    // the cel shows), and the mover spends it with the ground's drag
    const k = Math.floor(b.clock / a.hold);
    if (k >= a.cels.length) {
      // `0x41bb86`: the script's end puts it back on the idle
      b.lunge = null;
      b.clock = 0;
      boggsMove(b);
      return;
    }
    const dx = a.dx[k] ?? 0;
    if (dx) b.vx = (b.vx ?? 0) + roundAway(dx / BOGGS.divisor);
    boggsMove(b);
    return;
  }
  boggsMove(b);
  // `0x41bffc` — seven in forty-two, once a frame, and only out of the idle
  if (Math.floor(random() * BOGGS.lunge.odds[1]) >= BOGGS.lunge.odds[0]) {
    // ...and `0x41c068` is what the other thirty-five frames do
    boggsReach(b);
    return;
  }
  // `0x41c047` — against the head's x, and at or past it is tag 1
  b.lunge = p.x >= b.headX ? "right" : "left";
  b.clock = 0;
  const which = BOGGS.lunge.sound + Math.floor(random() * 2);
  sound?.effect(which, b.x, b.y);
}

/**
 * Boggs' share of the mover: move by `obj+0xc`, then the drag (`0x4302c0`) —
 * the body's own whole 1.0, {@link BOGGS.drag} — and `0x41bb40` keeps the
 * body inside its record's x.
 */
export function boggsMove(b: Boggs): void {
  const v = b.vx ?? 0;
  if (!v) return;
  b.x += v;
  b.vx = dragged(v, BOGGS.drag);
  if (b.span) b.x = Math.max(b.span[0], Math.min(b.span[1], b.x));
}

/**
 * `0x41c068` — the half of the idle that is not the lunge.
 *
 * Five in a hundred spends the frame, anything inside a hundred in front of it
 * spends the frame, and the rest is the range: past three hundred it throws
 * out of its second machine, and at or under it a worm goes down. See
 * {@link BOGGS.reach}.
 */
export function boggsReach(b: Boggs): void {
  const r = BOGGS.reach;
  // `0x41c068` — `0x434540(0x64)` under five, and it only snaps
  if (Math.floor(random() * r.idle[1]) < r.idle[0]) return;
  // `0x41c07b` — `si` is the same signed gap the head aims on
  const si = b.x - p.x;
  if (si > 0 && si < r.close) return;
  // `0x41c09d` — and only while the flag the second machine's wreck clears is up
  if (si > r.far && b.flags[0]) {
    boggsThrow(b);
    return;
  }
  // `0x41c0fd` — seven in fifty-five, and one goes down where it stands
  const w = BOGGS.worms;
  if (Math.floor(random() * w.odds[1]) >= w.odds[0]) return;
  const off = {
    dx: w.offX[0] - Math.floor(random() * w.offX[1]),
    dy: w.offY[0] + Math.floor(random() * w.offY[1]),
  };
  // `0x41c149` — 0x18 at the body, before the dropper has counted anything
  sound?.effect(w.sound, b.x, b.y);
  // `0x41c3c8` — `cmp [list+4], 0x13; jg`: a count past nineteen refuses, so
  // the twentieth goes down and the twenty-first does not
  if (b.worms.length > w.cap) return;
  const at = { x: b.x + off.dx, y: b.y + off.dy, kind: 0 as const, clock: 0, off };
  // `0x41ac09`…`0x41ac26` — and the record is what keeps it on the floor
  if (b.bounds) {
    at.x = Math.min(Math.max(at.x, b.bounds.left), b.bounds.right);
    at.y = Math.min(Math.max(at.y, b.bounds.top), b.bounds.bottom);
  }
  b.worms.push(at);
}

/**
 * `0x41c0a7` — and the counter is spent whether or not anything is thrown.
 *
 * `ax` is read BEFORE the decrement and tested against zero, so the frame the
 * word goes negative is the frame it fires; `0x41c0e4` then reseeds it with
 * `0x434540(0x1e) + 0x1e`. The throw itself leaves the second machine, eighty
 * along its facing, alternating between two heights — `0x41c38b` toggles
 * `[0x46e138]` on every call.
 */
export function boggsThrow(b: Boggs): void {
  const t = BOGGS.throwing;
  const was = b.throwWait;
  b.throwWait -= 1;
  if (was >= 0) return;
  b.throwWait = t.wait[0] + Math.floor(random() * t.wait[1]);
  const m = b.machines[t.machine];
  // `0x41c330` reads the machine's own `obj+0x28`, and the branch it is reached
  // through only runs with the player to its left
  const facing = -1;
  sound?.effect(t.sound, m.x, m.y);
  // `0x41c37e` ADDS its 140 and `0x41c386` its 40, and the engine's y grows
  // downward, so both of them are below the machine and not above it
  castAt(m.x, m.y + t.drop[b.throwDrop], facing, BOGGS_THROW);
  b.throwDrop = b.throwDrop === 0 ? 1 : 0;
}

/**
 * The worms, one engine frame each — `0x41adf0`, whose four kinds are one life.
 *
 * A dropped one waits on a single cel until the player is within
 * {@link BOGGS.worms.wake} in x, rises, strikes, sinks and is gone. It carries
 * a hundred the whole time (`0x41adf9`), and it never moves from where it was
 * put.
 */
export function stepBoggsWorms(b: Boggs): void {
  const w = BOGGS.worms;
  for (const m of b.worms) {
    m.clock += 1;
    if (m.kind === 0) {
      // `0x41ae18` — the only thing that wakes one
      if (Math.abs(p.x - m.x) >= w.wake) continue;
      m.kind = 1;
      m.clock = 0;
      continue;
    }
    const run = wormRun(m);
    if (m.clock < run.cels.length * run.hold) continue;
    if (m.kind === 1) {
      // `0x41ae5f` — the warning is played ONCE a level, and only for one that
      // rises to your left and within two hundred of your own height
      if (!b.warned && m.x < p.x && Math.abs(p.y - m.y) < w.warnBelow) {
        b.warned = true;
        sound?.effect(w.warn, m.x, m.y, "lead"); // `0x41ae9e`, through `0x40f090`
      } else sound?.effect(w.hiss, m.x, m.y);
      m.kind = 2;
      m.clock = 0;
    } else if (m.kind === 2) {
      sound?.effect(w.strikes, m.x, m.y); // `0x41aeeb`
      m.kind = 4;
      m.clock = 0;
    } else {
      m.clock = -1; // `0x41af3d` — gone, and the sweep below takes it
    }
  }
  b.worms = b.worms.filter((m) => m.clock >= 0);
}

/** every worm in the room the player is in — the debug line's own reader */
export function wormsHere(): BoggsWorm[] {
  const out: BoggsWorm[] = [];
  for (const b of hereOf((l) => l.boggs)) out.push(...b.worms);
  return out;
}

/** the script a worm's kind plays */
function wormRun(m: BoggsWorm) {
  const w = BOGGS.worms;
  switch (m.kind) {
    case 0:
      return w.sleep;
    case 1:
      return w.rise;
    case 2:
      return w.strike;
    default:
      return w.sink;
  }
}

/** the cel a worm is showing, off its own kind and its own clock */
export function boggsWormCel(m: BoggsWorm): number {
  const run = wormRun(m);
  const i = Math.floor(m.clock / run.hold);
  return run.cels[Math.min(run.cels.length - 1, i)];
}

/**
 * Which of the head's nine look-at tags is aimed at you — `0x41bfe3` for the
 * column, `0x41c192` and `0x41c1b2` for the row.
 *
 * Both are measured off the BODY rather than the head, which is what the
 * disassembly does (`si` and `di` come from `0x4a5138`), and it matters once the
 * body has lunged out from under the head it is aiming.
 */
export function boggsAim(b: Boggs): number {
  const si = b.x - p.x; // positive when you are to its left
  const di = p.y - b.y; // positive when you are below it
  let col = 2;
  if (si > BOGGS.head.far) col = 0;
  else if (si > 0) col = 1;
  let row = 3;
  if (di > BOGGS.head.below) row = 6;
  else if (di > BOGGS.head.above) row = 0;
  return row + col;
}

export function boggsCel(b: Boggs): number {
  if (b.dying) {
    const d = BOGGS.dies;
    return d.cels[Math.min(d.cels.length - 1, Math.floor(b.clock / d.hold))];
  }
  if (b.lunge) {
    const a = BOGGS.lunge[b.lunge];
    return a.cels[Math.min(a.cels.length - 1, Math.floor(b.clock / a.hold))];
  }
  return BOGGS.idle.cels[
    Math.floor(b.clock / BOGGS.idle.hold) % BOGGS.idle.cels.length
  ];
}

/** the head: `0x46e908` while it is dying, one of `0x46e7c0`'s nine otherwise */
export function boggsHeadCel(b: Boggs): number {
  if (b.dying) {
    const d = BOGGS.head.dies;
    return d.cels[
      Math.min(d.cels.length - 1, Math.floor(b.headClock / d.hold))
    ];
  }
  return BOGGS.head.look[b.headTag];
}

/**
 * Where the jaws hang — `0x412180`, the centre of the ARM cel's own collision
 * box, off the arm's anchor. Read per frame rather than frozen, for the reason
 * {@link gripAt} exists.
 */
export function jawsAt(b: Boggs): { x: number; y: number } {
  const art = celRec(level?.sbk, BOGGS.arm.poses[BOGGS.arm.tag]);
  const box = art?.body;
  if (!box) return { x: b.x, y: b.y };
  return {
    x: b.x + box.x0 + (box.x1 - box.x0) / 2,
    y: b.y + box.y0 + (box.y1 - box.y0) / 2,
  };
}

/** the jaws: `0x46e558` tag 3 while `0x41c164`'s snap runs, the placed pose otherwise */
export function jawsCel(b: Boggs): number {
  const jaws = BOGGS.arm.jaws;
  if (b.snap <= 0) return jaws.poses[BOGGS.arm.tag];
  const k = Math.floor(
    (jaws.snap.cels.length * jaws.snap.hold - b.snap) / jaws.snap.hold,
  );
  return jaws.snap.cels[Math.min(jaws.snap.cels.length - 1, k)];
}

/** one of the eight, on its own script — {@link BOGGS.machines} */
export function machineCel(b: Boggs, i: number): number {
  const spec = BOGGS.machines[i];
  const m = b.machines[i];
  if (m.wrecked && "wreck" in spec) {
    return spec.wreck[
      Math.min(spec.wreck.length - 1, Math.floor(m.wreckClock / spec.hold))
    ];
  }
  return spec.cels[Math.floor(m.clock / spec.hold) % spec.cels.length];
}

/**
 * A blow on one of the eight — `0x41b510`, after the friendly-fire filter and
 * the same `-1`-becomes-100 translation the body's handler does.
 *
 * Six of them only clang. The two that do not are three thousand each, and
 * emptying one clears one of the two healing flags — which is the whole of why
 * this boss can be killed.
 */
export function strikeMachine(b: Boggs, i: number, damage: number, bolted = false): boolean {
  const spec = BOGGS.machines[i];
  // `0x41b53f`..`0x41b56b` — every one of the eight answers with a sound
  const said = BOGGS.machineStruck;
  const at = b.machines[i];
  const which = (bolted ? said.bolted : said.sound) + roll(said.roll);
  sound?.effect(which, at.x, at.y);
  if (!("health" in spec)) return false;
  // `0x41b573`..`0x41b5cb` — and the two halves count toward a hint
  const a = b.machines[BOGGS.hint.machine];
  if (a && a.x - said.short < p.x) {
    const was = b.machineBlows ?? 0;
    b.machineBlows = was + 1;
    if (was > said.after) {
      b.machineBlows = 0;
      sound?.effect(said.hint, b.headX, b.headY, "lead");
    }
  }
  const m = b.machines[i];
  if (m.wrecked) return false;
  m.hp = Math.max(0, m.hp - damage);
  if (m.hp > 0) return true;
  // `0x41b611` / `0x41b75d` — the only two writes to either flag there are
  b.flags[spec.clears] = false;
  m.wrecked = true;
  m.wreckClock = 0;
  sound?.effect(spec.sound, m.x, m.y);
  // ...and the neighbours buckle with it: `0x41b65b` and `0x41b794`
  for (let k = 0; k < BOGGS.machines.length; k++) {
    const n = BOGGS.machines[k];
    if (
      !("wreckedBy" in n) ||
      n.wreckedBy !== spec.clears ||
      b.machines[k].wrecked
    )
      continue;
    b.machines[k].wrecked = true;
    b.machines[k].wreckClock = 0;
  }
  // `0x41b628` / `0x41b774` — the cue only the SECOND one to go plays
  // ...through `0x40f090`, the mixer's channel 0
  if (!b.flags[0] && !b.flags[1]) {
    sound?.effect(BOGGS.bothDownSound, m.x, m.y, "lead");
    // `0x41b640` / `0x41b78c` — and the hum is let go: its pass plays out
    sound?.loop(BOGGS.hum, false);
  }
  return true;
}

/**
 * The box a machine is STRUCK in, which is not the box it is drawn in.
 *
 * `0x4303b3` skips a victim whose cel carries a degenerate rect — the same rule
 * that makes the player untouchable through a knockdown — and of the eight
 * machinery cels only three carry one at all:
 *
 * ```
 *   5860  body y1..142   x-106..109    the breakable half at x6539
 *   5870  body y-8..133  x-46..168     the breakable half at x6694
 *   5960  body y28..56   x1..79        one piece of scenery, and a small box
 *   5630 5700 5720 5940 5650           no body box: cannot be hit at all
 * ```
 *
 * Reading the DRAWN extent instead made the decoration solid, and the decoration
 * is big: 5960 is drawn x6538..6767 across the whole right half of the machine
 * it stands beside, and 5720 is 193x319. A bolt fired at the breakable half was
 * being stopped by scenery that the disc says has no collision at all, clanging
 * off `0x41b510`'s "one of these two, or nothing happens" branch and taking
 * nothing. Fists reached it because a fist is swung from close enough to be
 * inside the machine's own box already.
 *
 * Translated by the anchor, the way `0x40e680` translates every rect — see
 * {@link strikeOf}.
 */
export function machineBox(
  b: Boggs,
  i: number,
): { left: number; right: number; top: number; bottom: number } | null {
  const art = celRec(level?.sbk, machineCel(b, i));
  if (!art?.body) return null;
  const m = b.machines[i];
  return {
    left: m.x + art.body.x0,
    right: m.x + art.body.x1,
    top: m.y + art.body.y0,
    bottom: m.y + art.body.y1,
  };
}
