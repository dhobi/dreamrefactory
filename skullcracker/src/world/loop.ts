/**
 * The loop: {@link tick}, one engine frame of the whole world, and what it
 * calls straight — the player cel, the swing, the contact pass and the cheats —
 * and {@link startGame}.
 */
import { readSbkFile, SbkEntity } from "@dreamfactory/engine/df/sbk";
import { paletteToRGBA } from "@dreamfactory/engine/df/image";
import { TICK_SCALE } from "../brains/kit";
import { OWN } from "../sound";
import { PICKUP } from "../props";
import { MISSIONS } from "../mission";
import { GRAB, STREAMS, WEAPONS } from "../guns";
import { Cheat, CheatTyper } from "../cheats";
import { CLOCK, LABEL, buttonBit } from "../hud";
import { random } from "../random";
import { levelIndex, sound, p, ANIM, held, ACTIONS, HURT, KIT, HOLD_FRAMES, MEASURED, level, player, CHARACTER, damageOn, files, ui, setPlayer, QUERY, setStartTicks } from "./state";
import { punchPressed, kickPressed, jumpPressed, upPressed, setJumpPressed, setUpPressed, setPunchPressed, setKickPressed } from "./keys";
import { runStridePx, stridePx, IDLE_HOLD, crawlStridePx, AIR_HOLD, roundAway, DIVISOR, STICK_PX, engineFrame, knockedOff, LADDER, dragged, airThink, startJump, CLIMB_PX, PLAYER_GRAVITY, MONKEYBAR, setKnockedOff } from "./motion";
import { lastCel, celRec, setLastCel } from "./cels";
import { stepCamera, backdropFrames, driftCamera, poseFeet, shake, stepProbes, stepFlypasts, setBackdropFrames } from "./camera";
import { spawnedHere, hereOf, canLetGo, ladderAt, barAt, sideWalls, groundAt, surfaceUnder, surfaceCrossed, ejectFromObstacles, enter, roomAt } from "./rooms";
import { inv, loadRounds, gunAhead, dropGun, roundsIn, shutStreams, fireGun } from "./arsenal";
import { stats, actOf, blowClock, struck, blowStrength, takeDoor, stepGobs, setBlowClock } from "./blows";
import { addClock, takeHealth, claimBar } from "./hurt";
import { cycleSpawn, deathRed, DEATH_RED, stepDeathRed, film, died, fellOut } from "./death";
import { stepPlanks, stepElevators, stepCrushes, stepSwitches, stepPickups, stepHoles, stepHands, stepAxes, stepBridges, stepFloors, stepSurges, stepCages, stepHeld } from "./fixtures";
import { crowsHere, stepIbeams, stepGoop, stepDoors, stepElevs, stepScenery, stepColumns, stepCrows } from "./scenery";
import { casts, heads, rollers, stepCasts, stepBoards, stepRollers, stepCans, stepHeads, stepFlames } from "./casts";
import { stepAlarms, stepBigGuns, stepLights, stepFans, stepBelts, stepChairs, stepClaws, stepFittings, stepBoggs } from "./machines";
import { stepInv, takeGun, stepBushes, stepGuns, stepFlares, stepBolts, stepStreams } from "./shots";
import { bodyPush, pushes, stepEnemies } from "./enemies";
import { landHits, takeHits, foesStrikeFoes, flareHits, boltHits, struckCrows, struckHeads, struckBoggs } from "./contact";
import { loadLevel, craft, stepTally, stepCraft, ranOut, stepGoal } from "./level";

/**
 * `[0x46b1b8]` — set by the leave (`0x42ae98`), cleared by `0x42849c` the frame
 * the player is grounded again, and while it is set neither the idle state
 * (`0x429872`) nor the jump state (`0x429f5d`) asks for a ladder at all. Off a
 * ladder you LAND before you can climb again.
 */
export let ladderLatch = false;
export let playerPal: Uint8ClampedArray | null = null;

/**
 * The eight words, and they are typed with the same keys that are walking you.
 *
 * `0x403c1b` hands every lowercase letter to `0x403ed0` BEFORE the letter is
 * uppercased and looked up as an action, so `a` is both "away" and the first
 * letter of nothing, and `zip` walks you while you type it. The recogniser is
 * {@link file://../cheats.ts}; this is what each match does here.
 */
export const cheats = new CheatTyper();

export function runCheat(cheat: Cheat): void {
  switch (cheat.word) {
    // `0x403f5c` — the same counter and the same jump Shift+N already spends
    case "zip":
      cycleSpawn();
      break;
    // `0x45ef30(0x78)`, behind `0x402ee0`: the player's kind has to be one of
    // 0x12…0x16, which is the armed set (`0x42e6e0`)
    case "eshs":
      if (inv.armed) loadRounds(inv.weapon, 0x78);
      break;
    // `0x404160` puts up "Enter level (1-16):" (`0x46b469`) filled in with the
    // level you are on, and turns the answer back into a chapter and a scene
    case "cthia": {
      const said = prompt("Enter level (1-16):", String(levelIndex + 1));
      const n = Number(said);
      if (Number.isInteger(n) && n >= 1 && n <= MISSIONS.length)
        void loadLevel(n - 1);
      break;
    }
    case "jetson":
      addClock(850);
      break;
    // `0x40d400(5)`, and five is also the most it would take
    case "bewitch":
      stats.lives = PICKUP.maxLives;
      break;
    case "harakari":
      takeHealth(0x1f4);
      break;
    // `0x402b20(0x400)` — up to `[0x4ac3d8]`, which is your own maximum and so
    // is the difficulty's
    case "marsupial":
      stats.health = Math.min(stats.maxHealth, stats.health + 0x400);
      break;
    // `0x40411e` makes the comparison and `0x404136` returns 1 either way
    default:
      break;
  }
}

// ---- the loop -----------------------------------------------------------

/**
 * The swing — `0x434540(4) + 5`, one of four, and the same four whichever button
 * it was: the walk state plays it as it installs the punch (`0x429a03`) and again
 * as it installs the kick (`0x429a48`). Two of the four are the fist going past
 * and two are the man behind it.
 */
export function swing(): void {
  const which = OWN.swing[Math.floor(random() * OWN.swing.length)];
  sound?.own(which, p.x, p.y);
}
/** which frame of the gait was showing last, so a footfall fires once per step */
export let lastGaitFrame = -1;

/**
 * Which of the player's cels is showing — the state picks the script and the
 * clock picks the frame. It is game state, not drawing: the hit boxes, the
 * pickups' pixel test and the body pass all read it ({@link lastCel}), and the
 * footfalls fire off its frame.
 */
export function choosePlayerCel(): void {
  // what the player is doing decides the script, and the DISTANCE they have
  // covered decides the frame — one cel per stride, the engine's own ratio
  const acting = p.act ? actOf(p.act) : null;
  /**
   * The ARMED player is a different player, and the swap is total.
   *
   * `0x45eed0` sets `0x479438` and the pickup case installs the weapon's own
   * script; that script's `kind` becomes `player+0x18`, and `0x4284ed`'s table
   * sends the whole state machine somewhere else — `0x42cb80` for the flare
   * gun rather than `0x429690` and its neighbours. Every one of those handlers
   * re-implements the idle, the walk, the run, the jump, the fall, the landing
   * and the duck in its weapon's own cels. See {@link Moveset}.
   */
  /**
   * ...while it is OUT, which is {@link inv}'s `drawn` and not its `armed`: a
   * carried gun you have put away with INV ({@link stepInv}) leaves you on the
   * fists' own moveset.
   */
  const kit =
    inv.drawn ? (WEAPONS[inv.weapon]?.moveset ?? null) : null;
  let seq: readonly number[];
  if (acting) seq = acting.cels;
  else if (p.bar) seq = ANIM.bar[p.barTag] ?? ANIM.bar[0] ?? ANIM.hang;
  else if (p.climbing) seq = ANIM.climb[p.climbTag] ?? ANIM.hang;
  // `0x472350` whatever is in the player's hands: the preamble that
  // installs it runs ahead of every armed state's handler too
  else if (p.flail) seq = ANIM.flail;
  else if (p.landLeft > 0) seq = p.hardLand ? (kit?.fall ?? ANIM.air) : (kit?.land ?? ANIM.land);
  else if (!p.onGround || p.windup > 0) seq = kit?.jump ?? ANIM.air;
  else if (p.crouching) seq = kit?.duck ?? ANIM.crouch;
  else if (p.running) seq = kit?.run ?? ANIM.run;
  else if (p.moving) seq = kit?.walk ?? ANIM.walk;
  else seq = kit?.idle ?? ANIM.idle;
  // Three clocks, because the engine has three. An action and the idle run on
  // engine frames at their script's own ticksPerFrame; anything that covers
  // ground is clocked by the GROUND it covers, one cel per stride, so the feet
  // cannot slide whatever this page's Hz is; and the flight runs on its own.
  const running = seq === (kit?.run ?? ANIM.run);
  const stride = running ? runStridePx() : stridePx();
  let id: number;
  if (acting)
    id =
      seq[
        Math.min(seq.length - 1, Math.floor(p.actClock / (acting.hold ?? 1)))
      ];
  // `0x472048` is two engine frames a cel, and the last of a tag HOLDS —
  // which is what the chin-up standing still at the top of tag 3 is
  else if (p.bar)
    id = seq[Math.min(seq.length - 1, Math.floor(p.barClock / 2))];
  // a rung is four cels at one engine frame each, and the last of them is what a
  // ladder holds you on when you stop asking to move
  else if (p.climbing)
    id = seq[Math.min(seq.length - 1, Math.floor(p.climbClock))];
  else if (seq === (kit?.idle ?? ANIM.idle))
    // the fidgets are the fists' own two tags and no weapon script has any
    id =
      p.fidget && !kit
        ? p.fidget[
            Math.min(p.fidget.length - 1, Math.floor(p.fidgetClock / IDLE_HOLD))
          ]
        : seq[Math.floor(p.idleClock / IDLE_HOLD) % seq.length];
  else if (seq === kit?.duck) id = seq[0];
  else if (seq === kit?.land || seq === kit?.fall)
    id = seq[Math.min(seq.length - 1, Math.floor(p.actClock))];
  else if (seq === kit?.jump)
    // two records, the second carrying the dy: the wind-up cel, then the tuck
    id = seq[p.windup > 0 || p.airFrames === 0 ? 0 : seq.length - 1];
  else if (seq === ANIM.crouch) {
    // moving while ducked is the crawl, clocked by ground covered like every
    // gait; still is the held duck, with its rare settle fidget over it
    if (p.moving) id = ANIM.crawl[Math.floor(p.travelled / crawlStridePx()) % ANIM.crawl.length];
    else if (p.fidget === ANIM.crouchFidget)
      id = ANIM.crouchFidget[Math.min(ANIM.crouchFidget.length - 1, Math.floor(p.fidgetClock))];
    else id = ANIM.crouch[0];
  }
  else if (seq === ANIM.land)
    id =
      ANIM.land[Math.min(ANIM.land.length - 1, ANIM.land.length - p.landLeft)];
  else if (seq === ANIM.air && p.landLeft > 0) {
    // the hard landing, four frames a cel on the ground
    const f = Math.floor((ANIM.air.length * AIR_HOLD - p.landLeft) / AIR_HOLD);
    id = ANIM.air[Math.min(ANIM.air.length - 1, f)];
  } else if (seq === ANIM.air) {
    // the wind-up on the ground — 250 251 252 as the count runs down — then 253
    // for the launch frame, then the TUCK: 200 on the frame tag 0 is installed
    // and 220 held after. A run's leap is tag 4's single 200, then the same.
    if (p.windup > 0) id = ANIM.launch[ANIM.launch.length - 1 - p.windup];
    else if (p.leap)
      id =
        ANIM.tuck[Math.min(ANIM.tuck.length - 1, Math.max(0, p.airFrames - 1))];
    else if (p.airFrames === 0) id = ANIM.launch.at(-1)!;
    else id = ANIM.tuck[Math.min(ANIM.tuck.length - 1, p.airFrames - 1)];
  } else {
    const f = Math.floor(p.travelled / stride) % seq.length;
    // the footfalls, and the engine fires them off the CYCLE's frame number
    // rather than off a timer or a distance: `0x429b3d` plays skulz 0 on frame 1
    // and `0x429b5c` plays skulz 1 on frame 6, in the walk state and again in the
    // run's own branch. Twelve cels, two steps, whatever the speed.
    if (
      f !== lastGaitFrame &&
      (seq === ANIM.walk || seq === ANIM.run || seq === ANIM.crawl)
    ) {
      const which = OWN.stepFrames.indexOf(f as 1 | 6);
      if (which >= 0 && p.onGround) sound?.own(OWN.step[which], p.x, p.y);
      lastGaitFrame = f;
    }
    id = seq[f];
  }
  // which cel is on screen, for the status line and for the probes: an animation
  // that has stopped animating is invisible to every other assertion here
  setLastCel(id);
}

/**
 * Where every thing that can strike or be struck stood as the frame began —
 * see {@link hitPass}. Built on the frame tick, before anything moves.
 */
let frameStart: { o: { x: number; y: number }; x: number; y: number }[] = [];

function standing(): { o: { x: number; y: number }; x: number; y: number }[] {
  const all: { x: number; y: number }[] = [p, ...spawnedHere(), ...casts, ...crowsHere(), ...heads, ...rollers];
  for (const b of hereOf((l) => l.boggs)) all.push(b, ...b.machines, ...b.worms);
  for (const c of hereOf((l) => l.claws)) all.push(c);
  return all.map((o) => ({ o, x: o.x, y: o.y }));
}

/**
 * The frame's hit pass — `0x430350`, and WHERE it runs in the frame is the
 * point of this function.
 *
 * Every chapter's frame loop has one shape (VAT's `0x419c0b`..`0x419e35`,
 * STREETS' `0x44dcfc`..`0x44de83`, MALL's `0x43702c`..`0x4371a6`, GRAVE's
 * `0x41fa18`..`0x41fb6a` and the other twelve alike): the chapter's end
 * test, the player's think (`0x402950`), every class's think (`0x430f10` per
 * class), and then `0x42fc10`, which in one call steps every object's script
 * (`0x45d0f0`), fetches each current cel's rects (`0x42f9f0`), runs the body
 * pass (`0x430680`), runs THIS pass for every object as the hitter
 * (`0x42fc9a`), moves the platforms, and only then moves every object
 * (`0x42fd80`) and the camera (`0x4309f0`). VAT alone places Boggs' rig after
 * it (`0x41c4c0`, `0x411ed0`, `0x412180`, `0x41ab90`); then the draws.
 *
 * So a blow is judged on the cel this frame's think and script step put up,
 * at the place the LAST frame's move left everything. This page runs its
 * thinks and moves together across the frame's four ticks, so the pass waits
 * for the frame tick's thinks to be done and puts everything back at its
 * frame-start place while it runs; whatever the pass itself moves is kept.
 * The body pass comes first, as it does in `0x42fc10`; the flares and bolts,
 * whose steps run the same frame, carry the place they stood in
 * ({@link Flare.was}, {@link Bolt.was}) and are tested there.
 */
export function hitPass(ladder: boolean): void {
  const back = frameStart.map((s) => ({ ...s, dx: s.o.x - s.x, dy: s.o.y - s.y }));
  for (const s of back) {
    s.o.x = s.x;
    s.o.y = s.y;
  }
  // `0x430680` first, on the same cels and the same frame-start places: what
  // it takes off `obj+0xc` is taken now, as the hit's trade is — a walker's
  // along its facing in its walk, anything else's in `e.vx`
  bodyPush(ladder);
  for (const [e, pushed] of pushes) {
    if (e.rolling) e.speed = (e.speed ?? 0) + pushed * e.facing;
    else e.vx += pushed * TICK_SCALE;
  }
  pushes.clear();
  if (p.act) landHits();
  takeHits();
  foesStrikeFoes();
  flareHits();
  boltHits();
  for (const s of back) {
    s.o.x += s.dx;
    s.o.y += s.dy;
  }
  frameStart = [];
}

/**
 * One tick of the game — a quarter of an engine frame (see {@link INVENTED}).
 * Everything that happens in the world happens here; {@link loop} only paces
 * it against the clock and draws what it left.
 */
export function tick(): void {
  // the red's fade holds the whole world still — a tick is the sixtieth that
  // `0x42942d` spins on, so each one is a step of it and nothing else
  if (deathRed && deathRed.step < DEATH_RED.steps) {
    stepDeathRed(false);
    return;
  }
  // where the tick started, so a fall can be tested along the path it took
  const tickX = p.x;
  // one ENGINE frame in four ticks: the player's state machine, the impulses and
  // gravity all belong to the frame tick; the ticks between only move
  p.frameAcc += TICK_SCALE;
  const frame = p.frameAcc >= 1 - 1e-9;
  if (frame) p.frameAcc -= 1;
  // the stage-end tally holds the whole world still — {@link startTally}
  if (craft?.tally) {
    if (frame) stepTally(craft);
    return;
  }
  stepDeathRed(frame);
  // where everything stands before this frame moves it — {@link hitPass}
  if (frame) frameStart = standing();
  // `0x4309f0` is an engine-frame job like everything else in here; the step it
  // decides is spent across this frame's four ticks
  if (frame) stepCamera();
  if (frame) setBackdropFrames(backdropFrames + 1);
  // `0x4087c0` counts sixtieths, and an engine frame is four of them
  if (frame) setBlowClock(blowClock + 4);
  driftCamera();
  // an attack owns the player until it finishes — and it can start in the
  // air, which is where the flying moves live
  // (and state 15, INV held, reads no other key at all — `0x428975`)
  if (frame) stepInv();
  startAttack();
  stepAct(frame);

  // a ladder is climbed, not walked along, so it is decided before the walk
  // W or S GRABS a ladder; what lets go of one is a direction or J, not a
  // release. `0x42ae50` stays in the ladder state until forward, backward or
  // the jump key is down, and then leaves through the hop below. Letting go on
  // a release — which this did — dropped the player straight down the rail the
  // moment the key came up, and whether the step west registered first was a
  // race between two key events and one tick.
  // The latch goes on the ground OR once the fall passes 55: `0x42848a`
  // clears `[0x46b1b8]` unless `obj+0x32 <= 0x37` and the player is airborne,
  // so a long drop off a ladder may grab the next one on the way down.
  if (p.onGround || p.fallPx > 0x37) ladderLatch = false;
  const asked = held.right !== held.left || held.jump || jumpPressed;
  // `0x42ae6f` — knocked off asks as a key does, and `0x42aea1` spends it once
  // the rung is done, whether or not a room lets him go
  const bumped = p.climbing && !asked && knockedOff;
  if (p.climbing && (asked || knockedOff) && p.climbClock >= LADDER.rungFrames) setKnockedOff(false);
  const letGo = p.climbing && (asked || bumped) && canLetGo();
  let ladder: SbkEntity | undefined;
  if (p.climbing) ladder = p.act || letGo ? undefined : p.ladder;
  else if (
    !p.act &&
    !p.flail &&
    !ladderLatch &&
    (held.down || (held.up && held.right === held.left))
  )
    ladder = ladderAt();
  /**
   * ...and the other thing the same W reach finds — see {@link MONKEYBAR}.
   *
   * `0x412390` answers `monkeybar` only after `ladder`, `exitfarm` and
   * `exitroom` have all missed, so the bar is asked for last. Letting go is
   * S or J and **only out of the hang tag**: `0x42b522` is in tag 0's arm
   * and no other arm tests for it, so a swing always finishes.
   */
  const barLetGo =
    !!p.bar && p.barTag === 0 && (held.down || held.jump || jumpPressed);
  let bar: SbkEntity | undefined;
  if (p.bar) bar = p.act || barLetGo ? undefined : p.bar;
  else if (
    !ladder &&
    !p.act &&
    !p.flail &&
    !ladderLatch &&
    held.up &&
    held.right === held.left
  )
    bar = barAt();
  // ...and INV stands you still: state 15 reads no direction at all, and the
  // idle it hands you to goes straight back to it while the button is down
  let dir = 0;
  if (!(ladder || bar || p.act || p.invLoop)) dir = (held.right ? 1 : 0) - (held.left ? 1 : 0);
  p.moving = dir !== 0;
  /**
   * The run — `[0x4ac3fe]`, which is W held, and see {@link KEYS} for why that
   * was not obvious. One flag with two jobs in the original: the ladder state
   * reads it as "up", so a ladder takes it and the run does not happen, which
   * is what `ladder` being defined means here.
   *
   * The air keeps it, as the original does: the jump script's tag 3 is the
   * RUNNING launch, `250 251 252 253` with dx 100 where the standing one has
   * dx 0, so a run-jump carries its speed off the edge.
   */
  p.running =
    p.moving && held.up && ladder === undefined && bar === undefined && !held.down;
  /**
   * THE ENGINE'S FRAME, in the engine's order. The level loop (`0x417c20`)
   * runs the player's input handler first — `0x402950` → `0x428080`, the
   * dispatch on `[player+0x18]` — and then `0x42fc10` steps every script
   * (`0x45d0f0`: the record's dx/dy into the velocity) and then every body
   * (`0x42fd80`: the move, the landing, the drag). Think, animate, move. So a
   * jump pressed on frame A crouches through A, B and C, launches on D, has
   * tag 0 installed on E and is first steered on F; and a walk's impulse
   * lands on the same frame's move. Nothing here happens between frames.
   */
  frameStep(frame, dir, ladder);
  // every tick moves by a quarter of the frame's velocity, in the air and on the
  // ground alike: the stepper adds `obj+0xc` to the position whatever the input,
  // so a released jump coasts and a landing slides
  // ...and the side walls hold a point that is not moving too: the mover asks
  // them of every frame's point (`0x430058`), which is what stands BARREL's
  // opening record, x12 against a floor from x51, on x52 (`0x43006b`)
  if (!ladder && p.vx === 0 && p.room && level) {
    const nx = sideWalls(p.x);
    if (nx !== null) p.x = nx;
  }
  if (!ladder && p.vx !== 0) moveAcross();

  // up opens a door and climbs a ladder; jump is its own key, as it is in the
  // original. A touch still sends both, so a door still has to CONSUME the
  // press — otherwise the tap that opens it also jumps, and the player
  // arrives in the next room already in the air.
  // ...and only from a STANDSTILL, now that the same key is the run. Otherwise
  // every sprint past a doorway ends in the next room, which is the trap this
  // door already had once, arrived at from the other direction.
  if (upPressed && p.onGround && dir === 0 && takeDoor()) {
    setJumpPressed(false);
    setUpPressed(false);
  }
  const wasClimbing = p.climbing;
  p.climbing = ladder !== undefined;
  const wasHanging = p.bar !== undefined;
  p.bar = bar;
  // the climb `0x471e78` is kind 7 and the bar `0x472048` kind 8, and both end
  // on the unarmed fall `0x471b28` (`0x42af84`, `0x42b597`): the gun goes away
  // on the way up and INV is what brings it back
  if (ladder || bar) inv.drawn = false;
  climbOrFall({ tickX, dir, ladder, bar, bumped, wasClimbing, wasHanging });
  // the fall since the apex is kept by the body step above, in the engine's own
  // units — see {@link engineFrame}. It outlives the landing by the one frame
  // the tag-0 handler needs to read it (0x42a109's 360 test), and the plank's
  // handler reads the same field on the same frame ({@link PLANK.hardFallPx})
  if (p.onGround && p.landLeft === 0 && !p.launched) p.leap = false;
  // the duck: S on the ground with nothing else going on. The engine's is
  // reached the same way — from the standing state, not out of a walk.
  p.crouching = p.onGround && held.down && !p.act && !p.climbing;
  // the duck's own fidget: tag 1 is a single cel, so its script ends every
  // frame, and 0x42aadd rolls rand(0x2c3) < 13 at each end — 13 in 707
  if (p.crouching && !p.moving) {
    if (p.fidget === ANIM.crouchFidget) {
      p.fidgetClock += TICK_SCALE;
      if (p.fidgetClock >= ANIM.crouchFidget.length) p.fidget = null;
    } else if (random() * 707 < 13 * TICK_SCALE) {
      p.fidget = ANIM.crouchFidget;
      p.fidgetClock = 0;
    }
  } else if (p.fidget === ANIM.crouchFidget) p.fidget = null;
  // the idle only runs while genuinely idle, and restarts each time it stops.
  // At each cycle's end, 0x42993c rolls rand(42) < 13 for a fidget.
  if (p.onGround && !p.moving && !p.act && !p.climbing && !p.crouching) {
    if (p.fidget) {
      p.fidgetClock += TICK_SCALE;
      if (p.fidgetClock >= p.fidget.length * IDLE_HOLD) p.fidget = null;
    } else {
      p.idleClock += TICK_SCALE;
      const cycle = ANIM.idle.length * IDLE_HOLD;
      if (p.idleClock >= cycle) {
        p.idleClock -= cycle;
        if (random() * 42 < 13) {
          p.fidget = random() < 0.5 ? ANIM.fidgetA : ANIM.fidgetB;
          p.fidgetClock = 0;
        }
      }
    }
  } else {
    p.idleClock = 0;
    p.fidget = null;
  }
  // and the obstacles, once the whole move is in — the engine resolves them in
  // the mover after everything else has had its say (`0x430146`)
  if (!p.climbing) ejectFromObstacles();
  stepWorld(frame);
  // the mission clock runs at the engine's rate, not this page's — and 32000
  // is no clock at all: `0x40d25b` returns before the `dec`
  if (stats.ticks < CLOCK.noLimit) stats.ticks = Math.max(0, stats.ticks - TICK_SCALE);
  if (stats.ticks <= 0 && !film) void ranOut();
  // `0x443dea`: the life is spent when the dying animation ENDS, not when the
  // health runs out, and `0x443ec7` turns the last one into the game-over state
  // ...and not `damageOn &&`: the switch decides whether anything may SPEND
  // health, not what an empty bar means. `harakari` empties it with the switch
  // off and the original has no switch at all
  if (stats.health <= 0 && p.act === null && !film) died();
  if (fellOut() && !film) died();
  setUpPressed(false);
  // J is read by the frame's think, not by the tick, so it waits for one
  if (frame) setJumpPressed(false);
  setPunchPressed(false);
  setKickPressed(false);
  choosePlayerCel();
  // ...and only now, every think and script of the frame done and the
  // player's cel put up, the hit pass — and the cel again, for a reaction
  if (frame) {
    hitPass(ladder !== undefined);
    choosePlayerCel();
  }
  stepGoal();
}

/**
 * Everything in the level that moves after the player: the props, the
 * creatures and the craft, in the engine's own order. Some step every tick,
 * most once an engine frame.
 */
/** a world step that runs every tick, or only on an engine frame's */
const TICK = false;
const FRAME = true;

/**
 * The world's steps in the engine's own order, each with when it runs. Made on
 * the first tick rather than at load, so a module still loading in an import
 * cycle has its step defined by the time it is read.
 */
let worldSteps: readonly (readonly [() => void, boolean])[] | null = null;
const WORLD_STEPS = (): readonly (readonly [() => void, boolean])[] => [
  [stepPlanks, TICK],
  [stepElevators, TICK],
  [stepIbeams, TICK],
  [stepCrushes, TICK],
  [stepSwitches, TICK],
  [stepGoop, TICK],
  [stepDoors, TICK],
  [stepElevs, TICK],
  [stepScenery, TICK],
  // a think, so once an engine frame: every step in it is a frame's
  [stepBushes, FRAME],
  [stepColumns, TICK],
  [stepPickups, TICK],
  [stepHoles, FRAME],
  [stepHands, FRAME],
  [stepAxes, FRAME],
  [stepBridges, FRAME],
  [stepFloors, FRAME],
  [stepSurges, FRAME],
  [stepCages, FRAME],
  [stepAlarms, FRAME],
  [stepBigGuns, FRAME],
  [stepLights, FRAME],
  [stepProbes, FRAME],
  [stepFlypasts, FRAME],
  [stepFans, FRAME],
  [stepBelts, FRAME],
  [stepChairs, FRAME],
  [stepClaws, FRAME],
  [stepFittings, FRAME],
  // last of the props, because the grip is read off whatever moved just now
  [stepHeld, FRAME],
  [stepBoggs, FRAME],
  [stepGuns, TICK],
  [stepFlares, FRAME],
  [stepBolts, FRAME],
  [stepStreams, FRAME],
  [stepCasts, FRAME],
  [stepBoards, FRAME],
  [stepRollers, FRAME],
  [stepCans, FRAME],
  [stepHeads, FRAME],
  [stepCrows, FRAME],
  [stepEnemies, TICK],
  // after the creatures, as WOODS' runner has it — the CHOPPER's pass
  // `0x4540d3` and then the flames' `0x4540ec` — so a flame on something
  // riding thirty a frame is where it is this frame, not where it was
  [stepFlames, FRAME],
  [stepGobs, TICK],
  [stepCraft, TICK],
  [claimBar, TICK],
];

function stepWorld(frame: boolean): void {
  worldSteps ??= WORLD_STEPS();
  for (const [step, frameOnly] of worldSteps) if (frame || !frameOnly) step();
}

/** standing free on the ground: the attack keys start a move (the punch, the kick, the headbutt, …) */
function startAttack(): void {
  if (p.onGround && !p.act && p.windup === 0 && p.landLeft === 0 && !p.invLoop) {
    // W picks the bigger variant of either, which is what both state machines
    // do with `0x4ac3fe` before they look at their own button
    const big = held.up ? "Run" : "";
    // the punch tosses a coin: `0x42a400` calls `0x434540(2)` and adds it to
    // the base tag, so repeated presses alternate between two animations. The
    // kick does not — `0x42a670` picks its tag from the keys alone. BOTH
    // together are their own move: the 650s headbutt (`0x429706`).
    const both =
      (punchPressed && (kickPressed || held.kick)) ||
      (kickPressed && held.punch);
    // S is the pickup button and the duck button, and which one it is depends
    // entirely on what is 35 pixels in front of you: `0x4298a1` calls the reach
    // handler every frame S is held, and `0x42f081` ducks only when the probe
    // came back empty. See {@link GRAB}.
    if (held.down && gunAhead()) {
      p.act = "reach";
      // `0x42f0dc` — a GUN whose code is not the weapon you are holding makes
      // you throw yours down, BEFORE the reach plays; a refill never does.
      // `0x42f0b2` compares the pickup's CODE with `0x479434`, so the
      // statscepter (17) throws even the scepter (16) away
      const code = gunAhead()!.code;
      if (inv.armed && GRAB.drops.includes(code) && code !== inv.weapon)
        dropGun();
    }
    // ...and with a gun in your hands P is not a fist any more. The five armed
    // state machines read P (`[0x4ac394]`) and install their own wind-up tag;
    // none of them has a kick at all.
    else if (inv.drawn && punchPressed && !held.down) p.act = "fire";
    else if (both) p.act = held.down ? "duckCombo" : "headbutt";
    else if (punchPressed) {
      if (held.down) p.act = "duckPunch";
      else p.act = `punch${big}${random() < 0.5 ? "" : "2"}`;
    }
    else if (kickPressed && p.running) {
      // the RUN handler's own kick (`0x429db9`) is the FLYING KICK — tag 4 of
      // `0x471d68`, whose first record carries its own leap: dx 190, dy -310
      p.act = "flyingKick";
      // the record's own -26 up and 16 forward go into the velocity from the
      // act's first frame below, the way every act record's dx and dy do
      p.leap = true;
    } else if (kickPressed) p.act = held.down ? "duckKick" : `kick${big}`;
    if (p.act) {
      p.actClock = 0;
      p.fired = false;
      struck.clear();
      struckCrows.clear();
      struckHeads.clear();
      struckBoggs.clear();
      swing();
    }
  } else if (!p.onGround && !p.act && !p.flail && p.windup === 0) {
    if (p.launched) {
      // mid-flight, the kind-3 handler accepts both buttons once the launch
      // is done (`0x42a036`, `0x42a082`): K is tag 8, P is tag 9 — the
      // flail's handler reads neither
      if (kickPressed) p.act = "airKick";
      else if (punchPressed) p.act = "airPunch";
    } else if (p.fallState && !inv.drawn && !p.invLoop) {
      // off a ledge the player is still in a GROUND state ({@link
      // Player.fallState}), and its handler plays its own ground moves in the
      // air. The idle (`0x4296fc`..`0x4297b5`) asks for both buttons first,
      // then P, then K; the run (`0x429d6a`, `0x429daf`) for P and then K, and
      // its K is the flying kick
      const big = held.up ? "Run" : "";
      // the punch's coin is tossed only when there is a punch — every roll
      // moves the dice on for everything else in the level
      const coin = (): string => (random() < 0.5 ? "" : "2");
      if (p.fallState === "run") {
        if (punchPressed) p.act = `punch${coin()}`;
        else if (kickPressed) {
          p.act = "flyingKick";
          p.leap = true;
        }
      } else if (punchPressed && (kickPressed || held.kick)) p.act = "headbutt";
      else if (kickPressed && held.punch) p.act = "headbutt";
      else if (punchPressed) p.act = `punch${big}${coin()}`;
      else if (kickPressed) p.act = `kick${big}`;
      if (p.act) p.fired = false;
    }
    if (p.act) {
      p.actClock = 0;
      struck.clear();
      struckCrows.clear();
      struckHeads.clear();
      struckBoggs.clear();
      swing();
    }
  }
}

/** an attack under way owns the player until it ends: its frames, its impulses, what it strikes */
function stepAct(frame: boolean): void {
  if (p.act) {
    let a = actOf(p.act);
    let f = a ? Math.floor(p.actClock / (a.hold ?? 1)) : 0;
    /**
     * The flight's attacks END on the ground, not with their script. The
     * player's scripts never loop (`0x45d070` clears `obj+0x4a` and nothing
     * sets it again), so a tag that runs out HOLDS its last cel, and:
     *
     * - tags 8 and 9 (`0x42a1e3`) leave only once the tag has ended AND the
     *   player is down (`0x42a33a`) — a kick that runs out in the air holds
     *   689 to the ground, and one that lands early plays out on it before
     *   the landing;
     * - the flying kick's tag 4 (`0x42a7b0`) goes on to tag 3 once it has
     *   ended and is falling at 32 or more, is down, or has connected
     *   (`obj+0x2a`, the collision word); tag 3 (`0x42a784`) holds to the
     *   ground and then goes to the idle.
     */
    const connected = struck.size + struckCrows.size + struckBoggs.size > 0;
    if (a && f >= a.cels.length && p.act === "flyingKick" && (p.onGround || p.vyRaw >= 32 || connected)) {
      p.act = "flyingKickEnd";
      p.actClock = 0;
      a = actOf(p.act);
      f = 0;
    }
    const holds =
      !!a &&
      f >= a.cels.length &&
      ((!p.onGround &&
        (p.act === "airKick" || p.act === "airPunch" || p.act === "flyingKick" || p.act === "flyingKickEnd")) ||
        // state 27 installs nothing (`0x429454`): the body lies in the dying
        // script's last cel until the checkpoint
        (p.act === "dying" && !!deathRed));
    if (!a || (f >= a.cels.length && !holds)) {
      // the reach ENDS in the take — `0x4287bd` is the kind-14 state, and it
      // probes the band a second time rather than remembering what it found
      if (p.act === "reach") takeGun();
      // ...but a HELD state does not end with its script. `0x4286e4` reinstalls
      // `0x4720e8` tag 0 every time the script reports itself finished, and
      // only the grabber letting go gets you out — see {@link stepHeld}.
      // a HELD weapon keeps firing while the button is down: its state
      // machine sits on the firing tag and calls the fire function again
      // every frame, and `-2` only goes out when the tag is left
      if (
        p.act === "fire" &&
        STREAMS[inv.weapon] &&
        held.punch &&
        roundsIn(inv.weapon) > 0
      ) {
        // ...and it goes back to the SHOT pose, not to the wind-up. The
        // flamer's gun rises through 1240..1242 once and then works out of
        // 1243/1244 (`0x46faf8` tag 0, whose own tail is 1243 1244), and the
        // muzzle offset the flame is drawn at belongs to those two cels. A
        // loop that replayed the rise would drop the gun under its own flame
        // once a second. A weapon with no shot pose restarts where it did.
        const back = WEAPONS[inv.weapon]?.moveset.shot.length
          ? (WEAPONS[inv.weapon]?.moveset.fire.length ?? 0) * (a?.hold ?? 1)
          : 0;
        p.actClock = back;
        p.fired = true;
      } else if (p.heldBy) {
        p.act = "held";
        p.actClock = 0;
      } else if (
        /^punch(Run)?2?$/.test(p.act) &&
        ACTIONS.punchStep &&
        p.onGround &&
        (p.facing > 0 ? held.right : held.left)
      ) {
        // a punch tag ending with forward down steps after the blow —
        // `0x42a513` / `0x444e94` install the punch script's step tag
        // rather than the idle ({@link PlayerActions} `punchStep`)
        p.act = "punchStep";
        p.actClock = 0;
      } else {
        if (p.act === "fire") shutStreams();
        // a ground move that ends in the air hands back to the idle, still
        // falling: the punch and kick states' ends all install `0x471648`
        // (`0x42a526`, `0x42a5fb`, `0x42a870`), and the idle reads no floor
        if (!p.onGround && !p.launched) p.fallState = "idle";
        p.act = null;
        // ...and the gravity a reaction took goes back with it. In the engine
        // nothing restores it either — the NEXT state's own `0x42f850` does,
        // and every ordinary one passes 1. Here the ordinary states do not
        // touch it at all, so the reaction ending has to hand it back or the
        // bush's -5 leaves the player at half weight for the rest of the level.
        p.gravityScale = 1;
      }
    } else {
      // `0x42cd53` waits for the wind-up tag to END and only then calls the
      // weapon's own fire function; the tag it installs afterwards is the pose
      // held while the thing is in the air
      /**
       * `0x42cd53` calls the weapon's fire function once the wind-up TAG has
       * ended (`cmp word ptr [eax+0x46], 0`), and the tag after it is the
       * pose held while the thing is in the air.
       *
       * Three of the five weapons have no such second tag — the flamer, the
       * soaker and the scepter hold nothing, they pour — so waiting for a
       * frame past the wind-up means waiting for a frame the act does not
       * have, and they never fired at all. The end of the wind-up is the
       * trigger; whether a shot pose follows it is the weapon's business.
       */
      const windUp = WEAPONS[inv.weapon]?.moveset.fire.length ?? 1;
      const after = WEAPONS[inv.weapon]?.moveset.shot.length ?? 0;
      if (p.act === "fire" && !p.fired && f >= windUp - (after ? 0 : 1)) {
        p.fired = true;
        fireGun();
      }
      /**
       * The record's own dx and dy, into the VELOCITY — `0x45d0f0` hands both
       * to `0x42f8b0`, which adds `round_away(d / 12)` to `obj+0xc`/`obj+0xa`
       * once for every engine frame the record shows. The mover then carries
       * it and the ground's drag takes it back, exactly as it does the walk's
       * impulse, so the headbutt's three frames of +95 are 8, 11 and 12
       * pixels and not three flat eights. The walk's own mover keeps the
       * player in the world.
       *
       * A lift only leaves the ground if it clears the landing's reach:
       * `0x42ff56` puts anything within 8 of its floor back on it, so the
       * duck combo's `-80` (7 a frame) never gets the player off the floor
       * and the flying kick's `-310` (26) does.
       */
      // the striking tag's handler asks `0x4029e0` once a frame — see
      // {@link blowStrength} — before this frame's cel lands anything
      if (frame && a.move && f >= a.move.from) {
        blowStrength(held.punch && a.move.held ? a.move.held : a.move.id);
        // ...and the punch tags turn you round on the way: `0x42a4c4` (and
        // `0x42a55b`) call `0x402e40` when backward is down, and the kick's
        // handlers do not
        const back = p.facing > 0 ? held.left && !held.right : held.right && !held.left;
        if (back && /^punch(Run)?2?$/.test(p.act)) p.facing = -p.facing as 1 | -1;
      }
      const hold = a.hold ?? 1;
      const entering =
        p.actClock === 0 ||
        Math.floor((p.actClock - TICK_SCALE) / hold) !== f;
      if (entering) {
        const dx = a.dx[f] ?? 0;
        const dy = a.dy?.[f] ?? 0;
        if (dx) p.vx += p.facing * roundAway(dx / DIVISOR);
        const lift = dy ? roundAway(dy / DIVISOR) : 0;
        if (lift && (!p.onGround || -lift > STICK_PX)) {
          p.vyRaw += lift;
          engineFrame();
          p.vy = p.stepPx * TICK_SCALE;
          p.onGround = false;
          p.airFrames = 0;
        }
      }
      p.actClock += TICK_SCALE;
    }
  }
}

/** the engine frame's own work on the player: impulses, gravity, the jump — none of it between frames */
function frameStep(frame: boolean, dir: number, ladder: SbkEntity | undefined): void {
  if (frame && !ladder) {
    if (!p.onGround) p.airFrames += 1;
    else p.fallState = null;
    // the drag closes the frame before — `0x4302c0`, grounded frames only
    if (p.onGround) p.vx = dragged(p.vx);
    /**
     * The preamble, before any state's handler: `0x4284ba` (and `0x442f3f`
     * for character 1) installs the flail script the moment `obj+0x32` —
     * the fall so far — passes 360, whatever the player was doing, unless
     * they are already flailing, down or dead (kinds 25..27). An attack or
     * a jump in progress is simply replaced.
     */
    if (
      !p.onGround &&
      !p.flail &&
      p.fallPx > HURT.flailFall &&
      p.act !== "dying"
    ) {
      p.flail = true;
      inv.drawn = false; // `0x472350` is kind 25, and it ends on `0x471648`
      p.launched = false;
      p.fallState = null;
      p.landLeft = 0;
      if (p.act === "fire") shutStreams();
      p.act = null;
      p.gravityScale = 1;
    }
    // ---- think: the input handler
    if (p.flail) {
      // `0x4291e5`: kind 25 zeroes `obj+0xc` every frame and reads no key —
      // a flailing player drops straight down — and past 630 it screams
      // (`0x429211`). The landing is the body's, below.
      p.vx = 0;
      // asked every frame past it, through `0x40ef30`: the mixer turns the ask
      // away while the scream still sounds, and a long enough fall screams again
      if (p.fallPx > 0x276) sound?.own(KIT.flailSound, p.x, p.y);
    } else if (p.landLeft > 0) {
      // tag 1, or 0x471c68's tag 5: `0x42a182` reads ESC and nothing else until
      // the script ends on the ground. The keys do nothing; the slide is the drag's
      p.landLeft -= 1;
    } else if (p.act === "airKick" || p.act === "airPunch") {
      // `0x42a1e3`, tags 8 and 9: the same lift and the same steering as the
      // flight's own tag 0, on the ground too until the tag ends — the keys
      // themselves, since an act takes the walk's direction away
      airThink((held.right ? 1 : 0) - (held.left ? 1 : 0));
    } else if (p.onGround && p.launched) {
      // `0x42a0f0`, the tag-0 handler's first grounded frame: the allowance back
      // to 2 and `0x471b28` tag 1 with sound 4. Its other arm, `0x42a109`'s
      // fall past 360, is never taken: the preamble has already put any such
      // fall into the flail, whose own landing is the hard one
      p.launched = false;
      p.hold = HOLD_FRAMES;
      p.hardLand = false;
      p.landLeft = ANIM.land.length;
      sound?.own(OWN.land, p.x, p.y);
    } else if (!p.onGround) {
      if (p.launched && p.airFrames >= 2) airThink(dir);
      // a walk or run that left the ground without a jump has no steering: the
      // walk state installs the idle script's tag 1 (`0x42999e`) and the run
      // its own tag 1 (`0x429bf0`), and neither handler reads a direction —
      // but both read J, and neither asks whether there is a floor
      else if (p.fallState && p.windup === 0 && jumpPressed && !p.act && !p.invLoop)
        startJump(p.fallState === "run", false);
    } else if (p.windup === 0) {
      if (dir) p.facing = dir;
      if (jumpPressed && !p.act && !p.invLoop) startJump(p.running, p.moving);
    }
    // ---- animate: the current record's dx/dy through the mover, `0x45d196`
    // (a launch tag plays to its end wherever the player is: the jump state's
    // `0x42a1c2` waits for the tag and reads no floor)
    if (p.landLeft === 0 && (p.onGround || p.windup > 0)) {
      if (p.windup > 0) {
        p.windup -= 1;
        if (p.windup === 0) {
          // the launch record: dy -420 and tag 3's dx 100 or tag 4's dx 180,
          // each divided once, away from zero, into the velocity — -35, 9, 15
          p.vyRaw += roundAway(
            -(p.leap ? MEASURED.runJumpDy : MEASURED.jump) / DIVISOR,
          );
          p.vx += p.facing * roundAway(p.launchDx / DIVISOR);
          p.onGround = false;
          p.launched = true;
          p.fallState = null;
          p.airFrames = 0;
          p.hold = HOLD_FRAMES;
        }
      } else if (dir && p.onGround) {
        // the gait's own dx: the walk's 95, the run's 180, and ducked it is the
        // CRAWL — 0x4717c8 tag 4's 47, which cannot run
        let dx: number = MEASURED.walk;
        if (held.down) dx = MEASURED.crawl;
        else if (p.running) dx = MEASURED.run;
        p.vx += p.facing * roundAway(dx / DIVISOR);
      }
    }
    // ---- the body: this frame's vertical step, and gravity into the velocity
    if (!p.onGround) engineFrame();
    // ...and a frame that begins on the ground stores zero over the fall
    // instead (`0x42fdc2`). This is the engine's order and it is what keeps the
    // count readable: the think above has already had it, and so has the plank,
    // whose own frame function runs in the think pass (`0x40c8f0` at 0x417c52,
    // one call before the body step at 0x417c57)
    else p.fallPx = 0;
  }
}

/** the tick's horizontal move, against the walls and the room's edges */
function moveAcross(): void {
  let nx = p.x + p.vx * TICK_SCALE;
  /**
   * The region's side walls — `0x42ffa3`..`0x430146` — asked of the anchor
   * point. The bounds are `0x40bbd0`'s, filled at `0x42fde7` into the rect
   * `0x430058` and `0x4300cf` compare against: the region's own floor,
   * `x0 .. x0 + n` (`0x40bc66`), or its rect less fifty each end where it has
   * no floor (`0x40bc92`) — see {@link insideSides}. The flags are the
   * region record's (`0x40ba30` copies it). Nothing reserves half a sprite:
   *
   * - past the left edge with flag 2 set, the point is held at left + 1
   *   (`0x43006b`); with it clear, the region whose rect holds the point
   *   takes over (`0x40b940(2, point)`, `0x4300a0`), and with none it is
   *   held at the edge all the same (`0x4300c3`);
   * - the right edge the same, with flag 8 (`0x4300e2`, `0x430117`).
   *
   * MALL's three regions meet with the flags clear, so you walk from one into
   * the next; STREETS' ends are walls; and every region is walked the length
   * of its FLOOR, not its rect.
   */
  let inRoom = true;
  const from = p.room;
  const wallAt = sideWalls(nx);
  if (wallAt !== null) {
    nx = wallAt;
    if (nx === p.x) inRoom = false;
  }
  // world. Off a platform you certainly can: the floor is still under it.
  // ...and the wall below is asked first in the engine (`0x42fedc`, before
  // the side test at `0x430058`), so of the region the move STARTED in: at
  // MALL's seam region two's floor stands 94 higher four pixels before
  // region one's ends, and asked of region two it walled the hand-over off
  const handed = p.room;
  p.room = from;
  const ahead = groundAt(nx);
  p.room = handed;
  // and a floor that rises more than a step is a wall, not a slope. Without
  // this the player walks INTO the terrain and then falls through it
  // forever, because everything solid is now above them: BARREL's floor
  // climbs 141px between two adjacent columns.
  //
  // `0x42fedc` asks it of every move, in the air as much as on the ground,
  // and excuses it only where a platform stands under the point above that
  // floor (`0x42feec`, the platform search's flag): then the platform is
  // the floor. A wall in the air also stops the rise — `0x42ff0c` zeroes
  // `obj+0xa` with the move — so a jump that meets a step more than 50 above
  // its feet drops back rather than climbing it.
  const bridged =
    ahead !== null &&
    !!level?.solids.some((room) =>
      room.platforms.some(
        (e) =>
          nx >= e.left && nx <= e.right && e.top < ahead && e.bottom >= p.y,
      ),
    );
  // ...and it is asked of the position the WHOLE frame's move reaches:
  // `0x42fd9e` adds both velocities before `0x42fedc` compares, so the
  // launch frame's 35 pixels of rise count against a step it is jumping
  // at. This page spreads that rise across four ticks, so the frame's own
  // step stands in for it.
  const reachY = p.onGround ? p.y : p.y + Math.min(0, p.stepPx);
  const wall = ahead !== null && ahead < reachY - CLIMB_PX && !bridged;
  if (inRoom && !wall) {
    p.travelled += Math.abs(nx - p.x);
    p.x = nx;
  } else if (wall) {
    /**
     * A wall — `0x42fef3`..`0x42ff30`, on the ground as much as in the air:
     * nothing on that path asks whether the feet are down, so a walk into a
     * step more than 50 high is thrown back the frame's vx as a jump is.
     * The point goes back to where the frame began LESS the frame's vx
     * (`0x42ff13`), the vx keeps
     * `obj+0x20`'s quarter (`0x42ff0c`), and `obj+0xa` is zeroed — before
     * `0x43032e` adds this frame's gravity, so the next frame falls again.
     * Zeroing it after the gravity, and standing the player where the move
     * stopped, held a jump that met a wall hanging in the air for good:
     * GRAVE's graves have one at each side of the mouth.
     */
    p.x -= p.vx;
    p.vx = Math.trunc(p.vx / 4);
    if (!p.onGround) {
      p.vyRaw = PLAYER_GRAVITY * p.gravityScale;
      p.stepPx = 0;
    }
  } else p.vx = 0;


}

/** what the tick decided the player holds, and which way he goes, before he moves */
interface Grip {
  /** where the tick started, so a fall is tested along the path it took */
  tickX: number;
  dir: number;
  ladder: SbkEntity | undefined;
  bar: SbkEntity | undefined;
  /** knocked off a rung with no key asking */
  bumped: boolean;
  wasClimbing: boolean;
  wasHanging: boolean;
}

/** on a ladder, hanging from a bar, or in the air: the vertical half of the tick, and the landing */
function climbOrFall({ tickX, dir, ladder, bar, bumped, wasClimbing, wasHanging }: Grip): void {
  if (ladder) {
    /**
     * Step ONTO it, where the record says and facing the way it says.
     *
     * Where the record says and facing the way it says: `0x42b2b2` writes the
     * record's own `pointX` straight into the player's x and `0x42b279` turns
     * them by the sign of the spacing, so neither is a snap of this page's
     * invention. {@link ladderAt} has the trigger the engine tests.
     */
    const spacing = Math.abs(ladder.param) || 35;
    const last = Math.floor((ladder.bottom - ladder.top) / spacing);
    // the resting cel's own box is how far the feet hang below the anchor, and
    // the anchor is what a rung IS
    const rest = celRec(player, LADDER.restCel);
    const feet = rest?.body ? rest.body.y1 : 96;
    if (!wasClimbing) {
      p.ladder = ladder;
      p.x = ladder.pointX;
      // `0x42b279`: a positive spacing wants `obj+0x28` SET and a negative one
      // wants it clear — which, for the player's book, is facing left and facing
      // right. See {@link LADDER}: the sign is the ladder art's own mirror flag,
      // so `+35` is rungs pointing east, and you climb those from the east side
      // facing back into them
      p.facing = ladder.param < 0 ? 1 : -1;
      // `0x42b300`: the rung you arrive on is the one above where you stood, and
      // the y it measures is the ANCHOR — `obj+6` as the pose you grabbed from
      // left it, which is the standing cel's 88 above the feet, not the climb
      // cel's 96
      const anchor = p.y - p.feet;
      p.rung =
        anchor > ladder.top
          ? Math.max(0, Math.floor((anchor - ladder.top) / spacing) - 1)
          : 0;
      p.climbTag = held.down ? 3 : 0;
      p.climbClock = 0;
    } else {
      p.climbClock += TICK_SCALE;
      // one rung per completed tag, and a change of mind costs a tag without
      // moving — `0x42afc4`'s four cases, which only ever step the rung on the
      // two tags already going that way. S is tested after W, so S wins.
      if (p.climbClock >= LADDER.rungFrames) {
        const t = p.climbTag;
        const was = p.rung;
        // ...and a tag is INSTALLED only when there is a rung to take or a
        // direction to turn to. At rung 0 with W held — `cmp [0x4ac406], 0;
        // jle` in `0x42afc4` and `0x42b054` — or at the last with S
        // (`0x42b134`, `0x42b1cd`), the case is skipped whole: no tag, no
        // sound, and the cel HOLDS. This page installed the other tag of the
        // same direction instead, four frames each way, and the player
        // flickered at the top of every ladder in the game.
        let installed = true;
        if (held.down) {
          if (t === 2 || t === 3) {
            if (p.rung < last) {
              p.rung += 1;
              p.climbTag = t === 2 ? 3 : 2;
            } else installed = false;
          } else p.climbTag = t === 0 ? 3 : 2;
        } else if (held.up) {
          if (t === 0 || t === 1) {
            if (p.rung > 0) {
              p.rung -= 1;
              p.climbTag = t === 0 ? 1 : 0;
            } else installed = false;
          } else p.climbTag = t === 2 ? 1 : 0;
        } else installed = false;
        // nothing installed: the animation stays ended and the cel holds
        p.climbClock = installed ? 0 : LADDER.rungFrames;
        // one hand then the other: the ladder state plays skulz 3 as it
        // installs the odd tags and skulz 2 as it installs the even ones
        if (p.rung !== was) sound?.own(OWN.rung[p.climbTag % 2], p.x, p.y);
      }
    }
    p.vy = 0;
    p.vx = 0;
    p.climbY = ladder.top + p.rung * spacing;
    const was = p.y;
    p.y = p.climbY + feet;
    p.travelled += Math.abs(p.y - was);
    /**
     * ...and the region you are in is whichever one contains your point — on
     * THIS axis as much as on the other.
     *
     * The walk already re-asks `0x40b940(2, point)` every time it moves the
     * player sideways; a climb moves the player UP far enough to matter too.
     * Seven of the nine ladders reach out of the region they start in,
     * TOWER's second spans three and its third spans four, and MAZE's first
     * runs 1426px from room 1 down into room 5. Without this the climb tops
     * out still standing in the room below — which has no floor up there and
     * none of the platforms the ladder was put there to reach.
     */
    const here =
      !!p.room &&
      p.x >= p.room.left &&
      p.x <= p.room.right &&
      p.y >= p.room.top &&
      p.y <= p.room.bottom;
    if (!here) {
      const into = level?.rooms.find(
        (r) =>
          p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom,
      );
      if (into) p.room = into;
    }
    p.onGround = false;
  } else if (bar) {
    /**
     * State 8 — `0x42b410`, and its preamble runs before the dispatch does.
     *
     * Both velocities to zero, the anchor back on the record's `top` and x
     * clamped into `left..right`, every frame and whatever the tag. See
     * {@link MONKEYBAR}.
     */
    p.vx = 0;
    p.vy = 0;
    p.vyRaw = 0;
    p.stepPx = 0;
    if (p.x > bar.right) p.x = bar.right;
    if (p.x < bar.left) p.x = bar.left;
    const spacing = Math.abs(bar.param) || 65;
    // the swing reads the keys RAW: `dir` above is already zero because a
    // hanging player does not walk, and these are the engine's own two
    // flags, `[0x4ac3d2]` toward and `[0x4ac38c]` away, which are relative
    // to the facing and not to the screen
    const barDir = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    const toward = barDir !== 0 && barDir === p.facing;
    const away = barDir !== 0 && barDir !== p.facing;
    if (!wasHanging) {
      // `0x42ef11` — tag 0, and nothing is snapped on the grab: you hang
      // where the jump put you and the first swing puts you on the grid
      p.barTag = 0;
      p.barClock = 0;
    } else if (p.barTag === 0) {
      // `0x42b4bf` reads toward, away and W in that order
      if (toward || away) {
        p.barTag = toward ? 1 : 2;
        p.barClock = 0;
      } else if (held.up) {
        p.barTag = 3;
        p.barClock = 0;
      }
    } else {
      const swinging = p.barTag === 1 || p.barTag === 2;
      /**
       * Which way the body is actually going, which is not the facing: tag 1
       * carries `dx +120` and tag 2 carries `-120`, and `0x45d18e` mirrors
       * either by `obj+0x28`. Nothing on a monkeybar ever turns the player,
       * so a westward swing is a player facing east playing tag 2.
       */
      const way = p.facing * (p.barTag === 1 ? 1 : -1);
      // the script's own `dx`, spent by `0x45d0f0` on EVERY frame and not
      // once a cel — `0x42b410` zeroes the velocity again next frame, so
      // what it really amounts to is 10 pixels of travel an engine frame
      if (swinging) p.x += way * (MEASURED.barSwing / DIVISOR) * TICK_SCALE;
      const before = MONKEYBAR.tagStart[p.barTag] + Math.floor(p.barClock / 2);
      p.barClock += TICK_SCALE;
      const frame = MONKEYBAR.tagStart[p.barTag] + Math.floor(p.barClock / 2);
      if (frame !== before)
        for (const hand of MONKEYBAR.soundAt[p.barTag] ?? [])
          if (hand.frame === frame) sound?.own(hand.own, p.x, p.y);
      const len = swinging ? MONKEYBAR.handFrames : MONKEYBAR.pullFrames;
      if (p.barClock >= len) {
        if (swinging) {
          /**
           * The snap — and the `+1` belongs to TRAVELLING EAST, not to the
           * facing, which is the thing that is easy to read wrong here.
           *
           * All four arms are written out separately in the executable and
           * only two of them carry the `inc`: `0x42b621` is tag 1 with
           * `obj+0x28` clear and `0x42b77b` is tag 2 with it set. Both of
           * those are the body going east — where truncation leaves you
           * short of the hold above — and the two without it are the body
           * going west, where truncation has already carried you past the
           * hold below. Take the facing alone and a westward swing snaps
           * fifteen pixels back east every time it completes.
           */
          let n = 0;
          if (p.x > bar.left) n = Math.trunc((p.x - bar.left) / spacing) + (way === 1 ? 1 : 0);
          p.x = Math.max(
            bar.left,
            Math.min(bar.right, bar.left + n * spacing),
          );
          // `0x42b67a` / `0x42b7a6`: the SAME direction carries on, W goes
          // to the chin-up, and anything else drops back to the hang. The
          // opposite direction is not tested, so a reversal costs a tag.
          const keep = p.barTag === 1 ? toward : away;
          if (!keep) p.barTag = held.up ? 3 : 0;
          p.barClock = 0;
        } else if (p.barTag === 3) {
          // `0x42b7ff` — W still down and the last cel simply HOLDS
          if (held.up) p.barClock = MONKEYBAR.pullFrames;
          else {
            p.barTag = 4;
            p.barClock = 0;
          }
        } else {
          p.barTag = 0;
          p.barClock = 0;
        }
      }
    }
    p.barHold = Math.round((p.x - bar.left) / spacing);
    // the anchor is the record's own `top`, and `p.y` is the feet, so the
    // hanging cel's own box is what stands between them
    const hung = celRec(player, (ANIM.bar[0] ?? [])[0] ?? 0);
    const feet = hung?.body ? hung.body.y1 : p.feet;
    p.y = bar.top + feet;
    p.feet = feet;
    p.onGround = false;
    // ...and the room is NOT re-asked, unlike the ladder: `0x42b410` never
    // calls `0x40b940`, and it does not have to — the one bar in the game
    // spans 5908..6617 inside a VAT room of 5719..6688
  } else {
    if (wasClimbing) {
      ladderLatch = true;
      p.ladder = undefined;
    }
    if (wasHanging) {
      // `0x42b53a` — gravity back to 1 and `0x471b28` tag 0, which is the
      // plain fall. No hop, no velocity, and no latch: the ladder's leave
      // sets `[0x46b1b8]` and this one does not, so you may grab again at
      // once if you can get your anchor back into the rect.
      p.vy = 0;
      p.vyRaw = 0;
      p.stepPx = 0;
      p.onGround = false;
      setJumpPressed(false);
    }
    if (wasClimbing && !p.onGround && (dir || held.jump || jumpPressed || bumped)) {
      /**
       * Off the ladder sideways. `0x42ae50` leaves the ladder state on
       * forward, backward or J — at the end of the rung tag playing — and
       * `0x42af30` does the leaving: gravity back on, a turn if it was
       * backward, and tag 6 with J held (the leap's own `200(dx 180, dy
       * -420)`) or tag 7 without (`200(dx 120, dy -210)`: a HOP, 10 forward
       * and 18 up). Both tags dispatch to the steering handler from their
       * first frame, so a held direction drives this to 30 at once. Without
       * it the player drops straight down the rail and misses the roof the
       * ladder was there to reach.
       */
      if (dir) p.facing = dir;
      const leap = held.jump || jumpPressed;
      p.vyRaw = roundAway(-(leap ? MEASURED.jump : MEASURED.hopDy) / DIVISOR);
      p.vx =
        p.facing *
        roundAway((leap ? MEASURED.runJumpDx : MEASURED.hopDx) / DIVISOR);
      p.stepPx = 0;
      p.launched = true;
      p.leap = true;
      p.airFrames = 2;
      p.hold = HOLD_FRAMES;
      setJumpPressed(false);
    }
    /**
     * The jump itself is decided and launched in the frame block above, in
     * the engine's own order. What is left here is the body: the feet under
     * the pose, the floor under the feet, and the fall.
     *
     * The lift — hold W and go higher, the original's own mechanic and the
     * reason the same key runs, climbs and jumps — is up there too: `0x429f55`
     * calls `0x42f8b0` with `-125`, which is `+= round_away(-125/12)` = -11
     * on the VELOCITY, once a frame, for the two frames `0x4723f0` lasts, and
     * only once tag 0 is playing. A held jump is 137 high to a plain one's 80.
     */
    poseFeet();
    if (p.onGround) {
      // follow the floor: up a curb, down a step, off an edge
      const s = surfaceUnder(p.x, p.y - CLIMB_PX, p.y + STICK_PX);
      if (s === null) {
        // walked off: airborne on the gait's own velocity, with no steering,
        // and still in a ground state — see `p.fallState`
        p.onGround = false;
        p.airFrames = 0;
        p.fallState = p.running && !p.act ? "run" : "idle";
      } else {
        p.y = s;
        p.vy = 0;
        p.vyRaw = 0;
        p.stepPx = 0;
      }
    }
    if (!p.onGround) {
      /**
       * Fall the way `SC.EXE` falls, and stop at the first surface crossed.
       *
       * The velocity is advanced ONCE AN ENGINE FRAME in whole pixels and the
       * frame's step is spread across its four ticks so the sweep still
       * catches a ledge it crosses diagonally. Integrating this as floats —
       * which is what this did — loses the away-from-zero rounding on every
       * single frame, and the jump comes out about a fifth short.
       */
      // ...uncapped: the body stepper adds `obj+0x24` to `obj+0xa` every
      // airborne frame (`0x430327`) and nothing anywhere limits the sum
      p.vy = p.stepPx * TICK_SCALE;
      const ny = p.y + p.vy;
      const land = p.vy >= 0 ? surfaceCrossed(tickX, p.y, p.x, ny) : null;
      if (land !== null) {
        // `0x42ff5d`: the feet to the floor and the fall stopped. The
        // horizontal is left alone — the ground's drag has it from here
        p.y = land;
        p.vy = 0;
        p.vyRaw = 0;
        p.stepPx = 0;
        p.onGround = true;
      } else p.y = ny;
      // last resort: under the floor is not a place. Nothing here can be
      // below the terrain, so anything that gets there is put back on top of
      // it rather than falling out of the level.
      const g = groundAt(p.x);
      if (g !== null && p.y > g) {
        p.y = g;
        p.vy = 0;
        p.vyRaw = 0;
        p.stepPx = 0;
        p.onGround = true;
      }
      /**
       * ...and a flail's landing is the flail handler's: `0x42922c` stops
       * character 0's scream (character 1's `0x443c72` does not), and then past 530 of
       * accumulated fall the landing is fatal — straight into `0x4721a0` tag
       * 0 — and under it sound 5, `0x471c68` tag 5 and ten health off
       * (`0x4292bf`). The health and the death are behind the damage switch
       * like every other way the game takes a point off you; the roll is not.
       */
      if (p.flail && p.onGround) {
        p.flail = false;
        // `0x42923c` — character 0's scream is silenced as he lands
        // (`0x40eee0`); character 1's plays out (`0x443c72` has no such call)
        if (CHARACTER === 0) sound?.mute(KIT.flailSound, true);
        sound?.own(OWN.landHard, p.x, p.y);
        // `0x4292b7` / `0x429384` (character 1's `0x42a14b` / `0x42a38d`) — and
        // either way the view jolts
        shake(1);
        if (damageOn && p.fallPx > HURT.fatalFall && p.act !== "dying") {
          p.act = "dying";
          p.actClock = 0;
        } else if (p.act !== "dying") {
          p.act = "landRoll";
          p.actClock = 0;
          if (damageOn) takeHealth(HURT.fallDamage);
        }
      }
    }
  }
}

/** the eight buttons as one word, in the bit order `0x40da41` walks them in */
export function buttonMask(): number {
  let m = 0;
  if (held.up) m |= buttonBit("up");
  if (held.right) m |= buttonBit("right");
  if (held.down) m |= buttonBit("down");
  if (held.left) m |= buttonBit("left");
  if (held.punch || (p.act ?? "").startsWith("punch")) m |= buttonBit("punch");
  if (held.kick || (p.act ?? "").startsWith("kick")) m |= buttonBit("kick");
  if (held.inv) m |= buttonBit("inv");
  if (held.jump || !p.onGround) m |= buttonBit("jump");
  return m;
}

/**
 * `0x409a00(0xe1)` — the ink the panel typesets its key names in, out of the
 * book that holds the panel. Nothing is drawn in it until the book is loaded, so
 * this answers null-ish until then and the band simply goes unlabelled.
 */
export function panelInk(): string | undefined {
  if (!playerPal) return undefined;
  const i = LABEL.ink * 4;
  return `rgb(${playerPal[i]}, ${playerPal[i + 1]}, ${playerPal[i + 2]})`;
}
export function setPlayerPal(v: typeof playerPal): void {
  playerPal = v;
}

/**
 * Stand the game up on whatever files have been set ({@link setFiles}): the
 * player's book, the level the switches name ({@link QUERY}), and what a loaded
 * game carries with it. The page calls this from its boot; a headless run calls
 * it directly. False when the rip has no player book.
 */
export async function startGame(): Promise<boolean> {
  const pb = await files.load("player.sbk");
  if (!pb) {
    ui.status("player.sbk is not in this rip");
    return false;
  }
  const book = readSbkFile(pb);
  setPlayer(book);
  setPlayerPal(paletteToRGBA(book.paletteRaw!, 256));
  const params = QUERY;
  const clock = params.get("clock");
  if (clock !== null && Number.isFinite(Number(clock)))
    setStartTicks(Math.max(0, Number(clock)));
  const want = Number(params.get("level") ?? "1");
  await loadLevel(Math.min(16, Math.max(1, want)) - 1);
  /**
   * ...and what a LOADED game brings with it — four numbers and nothing else.
   *
   * After `loadLevel`, not before, and that ordering is the file's own. A
   * chapter's entry function (`0x44da80` and its three siblings) zeroes all
   * twenty-one rounds counts and names its own weapon the moment the chapter
   * opens — but only while `[0x47913c]` is 0, and `0x45e068` sets it to 1 on a
   * load. Applying these after the level has stood up is the same exemption:
   * whatever the chapter did to the inventory, the file wins.
   *
   * `0x479438` is not in the file, but the reader sets it: `0x45e041` arms the
   * player whenever the saved weapon is not 1 (none), so a loaded gun is in
   * the player's hands. See {@link file://../savegame.ts}.
   */
  const carriedScore = params.get("score");
  if (carriedScore !== null)
    stats.score = Math.max(0, Number(carriedScore) || 0);
  const carriedLives = params.get("lives");
  if (carriedLives !== null) {
    stats.lives = Math.min(
      PICKUP.maxLives,
      Math.max(1, Number(carriedLives) || 1),
    );
  }
  // `0x45e039`: a saved 1 (none) skips the weapon, its rounds and the arming
  const carriedWeapon = params.get("weapon");
  if (carriedWeapon !== null && Number(carriedWeapon) !== 1) {
    inv.weapon = Number(carriedWeapon) || 0;
    inv.armed = true;
    inv.rounds = {
      [inv.weapon]: Math.max(0, Number(params.get("rounds") ?? 0) || 0),
    };
  }
  // ?x= drops the player at a world x, for looking at a specific spot — and ?y=
  // with it, because in CITY the column under an x is usually the void: its
  // ground is a ledge and then y7250, so `?x=` alone is a death on arrival for
  // most of the level and cannot be used to reach anything in it
  const atX = params.get("x");
  const atY = params.get("y");
  if (atX !== null || atY !== null) {
    const x = atX !== null ? Number(atX) : p.x;
    const y = atY !== null ? Number(atY) : p.y;
    enter(roomAt(x, y), x, y);
    if (atY !== null) {
      // `enter` takes the room's FLOOR under x, which is the whole point of it
      // for a door — and exactly wrong here, because in CITY that floor is the
      // void. An explicit y is an instruction, so it wins.
      p.y = y;
      p.vy = 0;
      p.onGround = true;
    }
  }
  return true;
}
