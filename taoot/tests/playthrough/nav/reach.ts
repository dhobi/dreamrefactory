/**
 * How close you have to stand for someone to answer you — the route's copy of
 * `gang.cst`'s `hotdist()`, and the reason a route can stop clicking blindly.
 *
 * An actor's `mousedown` opens with `realdist(me) < hotdist()`, so a click from
 * across the room lands on them and is discarded. One gate, both sides knowable:
 *
 *   realdist(name) = calcdist(actorxyz(name, 4), playerxyz(4))     [gang.cst 0001]
 *
 * `playerxyz` is the camera, and the camera's ground position at a standpoint is its
 * scene's `xAxisMap`/`zAxisMap` — the pair `session.listener()` hands the engine. So
 * "can this click be answered from here" is a subtraction, available before the
 * gesture is made.
 *
 * ## What this is for, and what it is NOT for
 *
 * {@link Navigator.accost} used to click and then wait `8000` ms for a conversation,
 * from standpoint after standpoint. Two jobs were tangled in that: REACHING someone,
 * and WAITING for them to arrive — the cast walks, and `hasattention` used to bring
 * them over. Measured the hard way: skipping the too-far clicks outright broke
 * routes the sweep had always managed (`ga` on decka, hotdist 500, is only ever
 * reached because the route kept clicking while she walked in). The waiting was
 * load-bearing.
 *
 * So this is used to make the waiting PRODUCTIVE, not to skip it: watch the distance
 * and click the moment it crosses `hotdist()`, rather than spend a dead eight
 * seconds finding out. It must never be used to refuse a gesture or to plan a walk —
 * a snapshot is one frame of a moving world.
 *
 * ## And the threshold itself is not the engine's answer
 *
 * Measured, when {@link Navigator.answers} was written against these numbers: every
 * accost click in the route that WAS answered was answered from beyond the `hotdist()`
 * this file computes — Charles at 5116 against 3500 in the smoking room, Georgia at
 * 747 against 500 on A deck, Georgia at 6964 against 3700 in B70. Either
 * `calcdist(actorxyz(4), playerxyz(4))` is not this hypotenuse over the scene's
 * axis maps, or the conversation opened through the actor's own idle
 * (`hasattention`) rather than through the click — and from the route's side those
 * two are indistinguishable.
 *
 * So `inReachFrom` is a HINT and nothing has any business gating on it. What the
 * measurement did support is a strictly weaker question that needs no threshold at
 * all: has this actor moved a unit? {@link Navigator.answers} asks that one, and
 * every dud wait in the route answered "no".
 */
import type { SetFile } from "@dreamfactory/engine/df/set";

/**
 * `hotdist()` per set, transcribed from GANG.CST container 1.
 *
 * A plain `switch currentset()` over constants, so it belongs here as a table for
 * the same reason MAP_JUMPS does: the route has to ask the question the game asks,
 * before making the gesture the answer decides. From the squash court's 45000 down
 * to the bridge's 400 — and the boat decks' 500, the tightest reach in the game.
 */
export const HOTDIST: Record<string, number> = {
  squash: 45000,
  c59: 12000,
  control: 8500,
  smstack3: 4100,
  stair1c1: 4000,
  turk: 4000,
  gym: 3700,
  b70: 3700,
  b59: 3700,
  smoke: 3500,
  lounge1c: 3500,
  ebath: 3300,
  stair2c: 3000,
  recept1c: 3000,
  stair1c2: 2800,
  scot3: 2800,
  engine: 2600,
  gstair1: 2300,
  gstair2: 2300,
  gstair3: 2300,
  carghall: 2000,
  cargo: 2000,
  c73: 2000,
  halld: 2000,
  hallc: 2000,
  hallb: 2000,
  halla: 2000,
  cafe: 1900,
  turb: 1700,
  boil: 1600,
  wireless: 1500,
  turkstrs: 1200,
  scot2: 1200,
  scot1: 700,
  decka: 500,
  deckbd: 500,
  deckbd2: 500,
  bridge: 400,
};

/** the `endswitch` fallthrough: every set the table does not name */
export const HOTDIST_DEFAULT = 512;

/** `hotdist()` for a set, by the name `currentset()` would report */
export function hotdistFor(setName: string): number {
  return HOTDIST[setName.toLowerCase()] ?? HOTDIST_DEFAULT;
}

/** an actor's ground position, as the route can see it */
export interface ActorSpot {
  x: number;
  z: number;
  visible: boolean;
}

/**
 * How far `spot` is from a standpoint, or null when the question cannot be asked
 * (no actor, not drawn, or a set whose scenes carry no map coordinates).
 *
 * Null means "make the gesture" everywhere this is used: the fallback is always the
 * behaviour that worked before knowing anything.
 */
export function distanceFrom(set: SetFile, sceneIdx: number, spot: ActorSpot | null): number | null {
  if (!spot || !spot.visible) return null;
  const scene = set.scenes[sceneIdx];
  if (!scene) return null;
  if (!scene.xAxisMap && !scene.zAxisMap) return null;
  return Math.round(Math.hypot(scene.xAxisMap - spot.x, scene.zAxisMap - spot.z));
}

/** would `realdist(me) < hotdist()` pass from here? unknown counts as yes */
export function inReachFrom(
  set: SetFile,
  sceneIdx: number,
  spot: ActorSpot | null,
  hotdist: number,
): boolean {
  const d = distanceFrom(set, sceneIdx, spot);
  return d === null || d < hotdist;
}
