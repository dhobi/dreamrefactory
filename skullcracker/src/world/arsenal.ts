/**
 * The player's guns as they are carried: the inventory ({@link inv}), the
 * rounds, dropping and firing one, and the streams, bolts and flares a gun lets
 * go of. Stepping those shots is {@link file://./shots.ts}.
 */
import { SbkFile, SbkRoom } from "@dreamfactory/engine/df/sbk";
import type { Enemy } from "../brains/kit";
import { BOLT, GUNBOLT, FLARE, GRAB, GUN_CODES, STREAMS, WEAPONS, type Bolt, type Flare, type Gun, type Stream, type StreamKit } from "../guns";
import { p, level, sound, CHARACTER } from "./state";
import { roundAway } from "./motion";
import { hereOf, roll } from "./rooms";

// ---- the guns ------------------------------------------------------------

/**
 * What you are carrying — `0x479434`, `0x479438` and the 21 rounds counts at
 * `0x4a7f16 + id * 12`.
 *
 * All three are GLOBAL, not per level: a chapter's entry function
 * ({@link CHAPTER_WEAPON}) zeroes every count and names its own weapon as the
 * selected one, leaving `armed` at 0, and after that the state travels with
 * you. So a gun taken in WOODS is still in your hands in CITY, and the rounds
 * in it are still the same rounds.
 */
export const inv = {
  /** `0x479434` — which of {@link WEAPONS}, whether or not it is in your hands */
  weapon: 9,
  /**
   * `0x479438` — you are carrying it. The panel's icon (`0x40d663`) and the
   * swap at a different gun (`0x42f0a8`) read this, and nothing else does
   */
  armed: false,
  /**
   * ...and it is OUT: `player+0x18` is one of the five armed kinds 0x12..0x16
   * (`0x448bf0`). The fire button, the armed moveset, the knockdown's disarm and
   * the surge's recharge all ask this, not the flag above. INV flips it
   * (`0x428975`), and every unarmed script installed while you carry the gun
   * puts it away: the level's first idle, a respawn, a ladder, the bar, a
   * flail, a knockdown, and a reach that took anything but one of the five guns
   */
  drawn: false,
  /** `0x4a7f16 + id * 12`, per weapon */
  rounds: {} as Record<number, number>,
};

/** every flare in the air, and they outlive the room they were fired in */
export let flares: Flare[] = [];
/** the blaster's bolts in the air — see {@link BOLT} */
export let bolts: Bolt[] = [];
/** the flame, the water and the beam — see {@link STREAMS} */
export let streams: Stream[] = [];

/**
 * The positive-code records a room stands up, filed as {@link Gun}s.
 *
 * The join from a name to a code is {@link GUN_CODES}, which is the four
 * per-chapter blocks read together, and the band is the creator's own: not the
 * record's rect and not the drawn art, but `x ± 55` — `0x45af8a` writes exactly
 * that into the user struct and `0x45ae90` compares against nothing else.
 */
export function gunsIn(sbk: SbkFile, room: SbkRoom): Gun[] {
  const out: Gun[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity) continue;
    const code = Number(
      Object.keys(GUN_CODES).find(
        (c) => GUN_CODES[Number(c)].name === e.name,
      ) ?? Number.NaN,
    );
    if (!Number.isFinite(code)) continue;
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
      left: e.pointX - GRAB.bandPx,
      right: e.pointX + GRAB.bandPx,
      clock: 0,
    });
  }
  return out;
}

/** how many rounds are in the named weapon */
export function roundsIn(id: number): number {
  return inv.rounds[id] ?? 0;
}

/** `0x45ef30` — add, and clamp to the weapon's own max */
export function loadRounds(id: number, n: number): void {
  const w = WEAPONS[id];
  if (!w) return;
  inv.rounds[id] = Math.min(w.max, roundsIn(id) + n);
}

/**
 * Which pickup is under the reach, and it is a POINT test 35 pixels ahead.
 *
 * `0x42f017` shifts the player's own point by `0x23` in the direction they face
 * and hands it to `0x45ae90`, which asks three things of every positive pickup:
 * that the point is inside its `x ± 55` band, that the two are within 150
 * pixels vertically, and that `obj+0x30` is set — which a weapon still bouncing
 * after a swap is not.
 */
export function gunAhead(): Gun | null {
  const at = p.x + p.facing * GRAB.aheadPx;
  for (const g of hereOf((l) => l.guns)) {
    if (g.dropped && g.vy !== undefined) continue; // still in the air, not yours yet
    if (at < g.left || at > g.right) continue;
    if (Math.abs(p.y - g.y) >= GRAB.liftPx) continue;
    return g;
  }
  return null;
}

/**
 * Throw down what you are holding — `0x45b060`, called BEFORE the reach begins.
 *
 * `0x42f0dc` runs it the moment you press S at a gun that is not the one in
 * your hands, so the old one is already falling while you bend for the new one.
 * It comes out at your own point with gravity 1.0 and a bounce of 0.3, and its
 * `obj+0x30` stays 0 until it settles — which is what stops you catching it
 * again on the way down.
 */
export function dropGun(): void {
  const lvl = level;
  if (!lvl || !p.room) return;
  const i = lvl.rooms.indexOf(p.room);
  if (i < 0) return;
  lvl.guns[i] = [
    ...lvl.guns[i],
    {
      code: inv.weapon,
      x: p.x,
      y: p.y,
      left: p.x - GRAB.bandPx,
      right: p.x + GRAB.bandPx,
      clock: 0,
      dropped: true,
      vy: 0,
      vx: 0,
    },
  ];
  inv.armed = false;
  inv.drawn = false;
}

/**
 * The same throw from a dying gunner TCop — `0x45b060(6, point, mirror, region)`
 * out of `0x414599`, the blaster (weapon 6). `0x414580`..`0x414590` put it a
 * hundred pixels behind the cop: `-0xc8 + 0x64` facing east, `+0x64` west.
 */
export function dropBlaster(e: Enemy): void {
  const lvl = level;
  if (!lvl || !p.room) return;
  const i = lvl.rooms.indexOf(p.room);
  if (i < 0) return;
  const x = e.x - e.facing * 100;
  lvl.guns[i] = [
    ...lvl.guns[i],
    {
      code: 6,
      x,
      y: e.y,
      left: x - GRAB.bandPx,
      right: x + GRAB.bandPx,
      clock: 0,
      dropped: true,
      vy: 0,
      vx: 0,
    },
  ];
}

/**
 * Fire — `0x42cd53`, which waits for the wind-up's last frame and then calls
 * the weapon's own function through `0x4a7f10 + id * 12 + 8`.
 *
 * All five are here now: the flare gun's arc ({@link FLARE}), the blaster's bolt
 * ({@link BOLT}), and the three held streams ({@link STREAMS}). `0x436d43`
 * refuses outright with an empty magazine, so an armed player with no rounds
 * plays the wind-up and nothing comes out — which is the original's behaviour
 * and not an omission, and is exactly what RAVECAVE's scepter does: taking it
 * arms you with the one round `0x45eed0` gives and the weapon spends forty.
 */
export function fireGun(): void {
  if (STREAMS[inv.weapon]) return openStream();
  if (inv.weapon === 6) return fireBolt();
  if (inv.weapon !== 9 || roundsIn(9) <= 0) return;
  inv.rounds[9] = roundsIn(9) - 1;
  sound?.effect(FLARE.sound, p.x, p.y);
  flares.push({
    x: p.x + p.facing * FLARE.aheadPx,
    y: p.y - p.feet,
    // the script's dx is an impulse through the object's own divisor, and
    // nothing in the air takes it back again
    vx: roundAway((p.facing * FLARE.dx) / FLARE.divisor),
    vy: 0,
    facing: p.facing,
    // `0x434540(0x11) + 0xd` — see {@link FLARE.wobble}
    wobble: FLARE.wobble.lo - 1 + roll(FLARE.wobble.hi - FLARE.wobble.lo + 1),
    sign: -1,
    burn: null,
    age: 0,
    grounded: false,
    spent: false,
  });
}

/**
 * Open a held stream — the flamer, the soaker or the scepter.
 *
 * One at a time: the fire functions add to a list the player already owns, and
 * the state machine sends `-2` before it sends a fresh variant (`0x42ba49` then
 * `0x42ba7b`), so a second call replaces rather than doubles.
 */
export function openStream(): void {
  const kit = STREAMS[inv.weapon];
  if (!kit || roundsIn(inv.weapon) <= 0) return;
  if (streams.some((q) => q.state !== "stop")) return;
  const own = streamOwn(kit);
  if (own !== undefined) sound?.own(own, p.x, p.y);
  if (kit.sound.effect !== undefined) sound?.effect(kit.sound.effect, p.x, p.y);
  // `0x45ef00` in the fire function itself, for the one that is a shot
  if (kit.shot)
    inv.rounds[inv.weapon] = Math.max(0, roundsIn(inv.weapon) - kit.shot.rounds);
  streams.push({
    weapon: inv.weapon,
    x: p.x,
    y: p.y,
    facing: p.facing,
    state: "start",
    clock: 0,
  });
}

/** the character's own sound a stream starts with — {@link StreamKit.sound} */
function streamOwn(kit: StreamKit): number | undefined {
  return CHARACTER === 1 ? (kit.sound.own1 ?? kit.sound.own) : kit.sound.own;
}

/**
 * `-2`: every live one goes to its tag 2, the animation of shutting off — and
 * the state that sent it silences the weapon's own sound (`0x40eee0`, see
 * {@link StreamKit.sound})
 */
export function shutStreams(): void {
  for (const q of streams)
    if (q.state !== "stop") {
      q.state = "stop";
      q.clock = 0;
      const own = STREAMS[q.weapon] && streamOwn(STREAMS[q.weapon]);
      if (own !== undefined) sound?.mute(own, true);
    }
}

/**
 * `-1`: `0x448c19`'s cancel — the stream simply stops existing, and a flamer
 * cancelled so is silenced with it (`0x42e727`, `0x448c37`)
 */
export function killStreams(): void {
  for (const q of streams) {
    const own = q.weapon === 10 && STREAMS[10] ? streamOwn(STREAMS[10]) : undefined;
    if (own !== undefined) sound?.mute(own, true);
  }
  streams = [];
}
/** which cel a stream is showing */
export function streamCel(q: Stream): number {
  const kit = STREAMS[q.weapon]!;
  let a = kit.stop;
  if (q.state === "start") a = kit.start;
  else if (q.state === "loop") a = kit.loop;
  const k = Math.floor(q.clock / a.hold);
  return q.state === "loop"
    ? a.cels[k % a.cels.length]
    : a.cels[Math.min(a.cels.length - 1, k)];
}

/**
 * The BLASTER — `0x412a70`'s `0x412b5b`, which is the case both of its firing
 * tags land on. See {@link BOLT}.
 */
export function fireBolt(): void {
  if (roundsIn(6) <= 0) return;
  inv.rounds[6] = roundsIn(6) - 1;
  sound?.effect(BOLT.sound, p.x, p.y);
  spawnBolt(p.x, p.y - p.feet, p.facing);
}

/**
 * `0x412a70` itself — a bolt from whoever fired it.
 *
 * The player is not the only caller: MAZE's big gun reaches the same function
 * (`0x41374c`) with variant 0, which is a shot of its own — {@link GUNBOLT}.
 * What the gun does NOT do is spend a round, because the rounds are
 * `0x412a83`'s caller's business and the gun has none.
 */
export function spawnBolt(
  x: number,
  y: number,
  facing: number,
  // the variant's strength — see {@link Bolt.code}: the player's −1, the gun's 100
  code: Bolt["code"] = BOLT.blow,
): void {
  // the gun's variant 0 is a shot of its own — {@link GUNBOLT}
  if (code === 100) {
    bolts.push({
      x: x + facing * GUNBOLT.aheadPx,
      y,
      vx: roundAway((facing * GUNBOLT.dx) / BOLT.divisor),
      facing,
      spent: false,
      code,
      age: 0,
    });
    return;
  }
  bolts.push({
    // `0x412b7f` puts it 120 ahead; `obj+0x28 == 1` is this port's facing -1
    x: x + facing * BOLT.aheadPx,
    // `y - 0x14 + 0x434540(0x28) - 0x14` — `0x412b87` and `0x412b8f`
    y: y - BOLT.risePx + roll(BOLT.scatterPx),
    vx: roundAway((facing * BOLT.dx) / BOLT.divisor),
    facing,
    spent: false,
    code,
    age: 0,
  });
}

/** the cel a bolt shows this frame — 4000 for the blaster's, {@link GUNBOLT} for the gun's */
export function boltCel(b: Bolt): number {
  if (b.code !== 100) return BOLT.cel;
  return b.age === 0 ? GUNBOLT.launch : GUNBOLT.flight[(b.age - 1) % GUNBOLT.flight.length];
}

/** the other modules' writes into this one's state — ES imports are read-only */
export function setFlares(v: typeof flares): void {
  flares = v;
}
export function setBolts(v: typeof bolts): void {
  bolts = v;
}
export function setStreams(v: typeof streams): void {
  streams = v;
}
