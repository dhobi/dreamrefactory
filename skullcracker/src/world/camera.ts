/**
 * The view: its size, the camera rig that chases the player, the look up and
 * down, the shakes, the flypasts and probes, the level clock and the flash.
 */
import { TICK_SCALE } from "../brains/kit";
import { Flypast, PROBE } from "../props";
import { WINDOW } from "../hud";
import { player, anim, p, tuckFeet, standFeet, level, sound, character, inCensus, held } from "./state";
import { celRec, lastCel } from "./cels";

/**
 * Interface mode or full-screen, and Ctrl+P between them — `SC.EXE`'s own key,
 * and its own help screen is where the pair is named: *"Press Ctrl-P to toggle
 * between interface and full-screen mode"*. With the panel up the level plays
 * inside {@link WINDOW}, which is where the pause films play too; without it the
 * level has the whole 512x384 and nothing is drawn over it.
 */
export let iface = true;
/** the y the level is drawn about — the middle of whichever window it has */
/**
 * The play window, and both of its heights are `SC.EXE`'s own.
 *
 * `0x40e120` is the Ctrl-P handler and it does one thing besides toggling the
 * flag at `0x46ba20`: it hands `0x430860` a view rect, and the rect is
 * `{0, 0, 0xe8, 0x200}` with the panel up and `{0, 0, 0x156, 0x200}` without —
 * **512x232** and **512x342**. Those are surface coordinates, and the level's
 * surface starts 42 rows down the screen (which is what the interface's top band
 * occupies and what {@link WINDOW} already had), so 42 + 342 is exactly the 384
 * the screen is tall: full-screen mode is the window grown DOWNWARDS into the
 * panel's space, not the whole screen.
 */
export const FULL_H = 0x156;
export const VIEW = { x: WINDOW.x, y: WINDOW.y, w: WINDOW.w };
export const viewH = (): number => (iface ? WINDOW.h : FULL_H);

/**
 * Move the feet to where the POSE puts them, keeping the anchor where it was.
 *
 * The engine's `y` is the cel's anchor, and what the body stepper stands on a
 * floor is the CURRENT cel's own extent below it: `0x42fdcf` reads the cel's word
 * at +0x26 — `height - posY`, the bottom row of the art — and adds `obj+0x10`,
 * which the player's init zeroes (`0x42e43a`). Not the collision box, which is
 * authored separately and ends short of the art on most cels (cel 1's box stops
 * at 88 where its art reaches 90; character 1's tuck 5203 stops at 38 where its
 * art reaches 71). So a change of pose moves the FEET: standing cel 1 reaches 90
 * rows below the anchor and the airborne tuck (200, 220) 70 and 71, because the
 * knees come up. This page keeps `p.y` at the feet instead, so the same fact has
 * to be spelled the other way round — the offset changes and `p.y` moves with
 * it, leaving `p.y - p.feet` (the anchor, the thing every rect in the file is
 * measured against) continuous, and the floor under the new pose puts the feet
 * back on it.
 *
 * It is worth twenty pixels of clearance and CITY is built on them. Its first
 * jump is from a walkway at y4041 onto a tank roof at y3920 — 121 rows — and the
 * launch plus the lift raise the anchor 105: from 3951 to 3846, where the tuck's
 * feet are at 3917, over the roof by three pixels. Standing-footed the same jump
 * lands short, every time.
 *
 * The cel is the one on screen, which is the one the last frame's animation
 * chose. The ladder and the bar hang the player by the hands and have their own
 * ({@link LADDER}, {@link MONKEYBAR}), so the frame a climb ends in is not read
 * as a pose to stand on — the two fixed figures below stand in for it.
 */
export function poseFeet(): void {
  const rec = celRec(player, lastCel);
  const hung =
    anim.hang.includes(lastCel) ||
    anim.climb.some((t) => t.includes(lastCel)) ||
    anim.bar.some((t) => t.includes(lastCel));
  // the tuck's cels are 200 and 220: a run's leap from its first frame, a
  // standing jump's from the frame after 253's launch
  const tucked = !p.onGround && (p.leap || p.airFrames >= 1);
  let want: number;
  if (p.climbing) want = p.feet;
  else if (rec && !hung) want = rec.height - rec.posY;
  else want = tucked ? tuckFeet : standFeet;
  if (want === p.feet) return;
  p.y += want - p.feet;
  p.feet = want;
}

/**
 * The camera — `0x4309f0`, and all of it is in `SC.EXE`.
 *
 * `0x4309d0` answers with `[0x4a8970]`, the view rect's own corner in WORLD
 * coordinates, and every draw subtracts it. Nothing writes that global
 * directly: it is written by `0x4308a0`, which takes a requested corner and
 * clamps it.
 *
 * ```
 *   4309f0  per engine frame, mode 0 (follow the tracked object [0x4a8994])
 *   430a1c    target   = player point
 *   430a30    target.x += lead, or -= lead when [player+0x28] says left
 *   430a42    target.y -= lift
 *   430a81    chase    = [0x4a6938] translated by the view's own corner
 *   430ab2    dx = (target.x - chaseMidX) * maxDx / 0x118, clamped to +-maxDx
 *   430af2    dy = (target.y - chaseMidY) * maxDy / 0x64,  clamped to +-maxDy
 *   430b46    0x430820(dx, dy) -> corner += (dx, dy) -> 0x4308a0
 * ```
 *
 * `0x4308a0` is the clamp, and it is the ROOM's own rect — `0x40ba30` copies the
 * room's 48-byte entity record and the four sides are tested one at a time
 * behind four bits of {@link SbkRoom.flags}. The floor is applied after the cap,
 * so a room narrower than the view is pinned to its left edge.
 *
 * The target is the object's own point, not the middle of its collision box,
 * held at the middle of `0x4a6938` — which for a 512x232 window is its middle
 * too, so the pose does not enter into it. And the clamp is the room, not
 * {@link roomSpan}: the extent of the FLOOR is narrower than the room in nine
 * levels, so VAT's chamber would lose 35 pixels and machine B — `0x46e088`'s
 * `+373`, at x6694 — could never be brought on screen.
 *
 * What is NOT the engine's: the ease runs once an engine frame here, the way it
 * does there, but this page's frame is a quarter of a tick rather than a whole
 * one of the disc's 15Hz. The numbers below are the disc's unchanged.
 */
export const CAMERA = {
  /**
   * `0x4a6938`, written at `0x42aec8` — the rect whose MIDDLE the target chases.
   * The ladder and the bar install `{0x6e, 0xc8, 0x7a, 0x138}` instead
   * (`0x42b216`, `0x42b464`), which has the same middle, (256, 116).
   */
  chase: { top: 0x32, left: 0xc8, bottom: 0xb6, right: 0x138 },
  /**
   * `0x430c20(chase, maxDx, maxDy, lead, lift)` — what the state installs, and
   * there are three of them. `lead` is pixels AHEAD of the player the target
   * sits (`0x430a30`); `lift` comes off the target's y (`0x430a42`); `maxDx` and
   * `maxDy` are the most the corner moves in one engine frame.
   *
   * - on foot: `0x42e67a` as a level begins, `0x42aec8` off a ladder and
   *   `0x42b53a` off a bar
   * - on a ladder: `0x42b216`, every frame of the mount — no lead at all, and a
   *   slower vertical
   * - on a bar: `0x42b464`, every frame of `0x42b410`'s preamble — the ladder's,
   *   with the target 100 BELOW the hands (a lift of −100)
   */
  rig: {
    foot: { lead: 0x78, lift: 0, maxDx: 0x32, maxDy: 0x32 },
    ladder: { lead: 0, lift: 0, maxDx: 0x32, maxDy: 0x1e },
    bar: { lead: 0, lift: -0x64, maxDx: 0x32, maxDy: 0x1e },
  },
  /** `0x430ab4` and `0x430ada` — the error at which each cap is reached */
  spanX: 0x118,
  spanY: 0x64,
  /** `0x428fe8` / `0x428ff1` — where an ARRIVAL puts the corner, before clamping */
  arriveX: 0xc8,
  arriveY: 0x64,
  /** `0x430914` / `0x43092c` / `0x430950` / `0x430968` — which sides clamp */
  capX: 8,
  floorX: 2,
  capY: 4,
  floorY: 1,
  from: "0x4309f0 / 0x4308a0 / 0x430c20 / 0x40ba30",
} as const;

/** the view's own corner in world coordinates — `[0x4a8970]` */
export const view = { x: 0, y: 0 };

/** `[0x46f680]` — the level's own frame counter, which only the lightning reads */
export let levelClock = 0;

/**
 * Engine frames since the level was built, which is what paces the backdrop's
 * animated placements: each is an object on the animator (`0x40c199` gives it
 * the script, `0x40c19c` sets it looping) and `0x45d0f0` holds each cel for the
 * script's hold, so the cel showing is `frames / hold` round the list, all of
 * them starting together at the load.
 */
export let backdropFrames = 0;

/** what the level's `probe` records have fired and not yet thrown away */
export let flypasts: Flypast[] = [];

/**
 * `[0x46bdd0]` — a palette index queued for the next paint, or -1 for none.
 *
 * `0x40e4c0` writes it and `0x40dfd0` spends it: the whole view rect is flooded
 * with that colour for one frame and the global is set back to -1. Two things
 * use it, the blaster's muzzle (0xe1) and TOWER's lightning (0).
 */
export let flashColour = -1;

/** the middle of {@link CAMERA.chase}, the way `0x430a98` and `0x430ad5` take it */
export const CHASE_X =
  CAMERA.chase.left + Math.trunc((CAMERA.chase.right - CAMERA.chase.left) / 2);
export const CHASE_Y =
  CAMERA.chase.top + Math.trunc((CAMERA.chase.bottom - CAMERA.chase.top) / 2);

/**
 * `0x4308a0` — put the corner where it is asked for, within the room's rect.
 *
 * Cap first, floor second, each behind its own bit, exactly as the four tests
 * run. A room with a bit clear is not clamped on that side at all, which is how
 * RAVECAVE (12) and SEWER's shafts (5) scroll off their own rects.
 *
 * The room is the player's `obj+0x16`, and `0x4308e2` clamps nothing at all
 * while it is negative — which it is for the whole of a climb: the mount writes
 * `0xffff` there (`0x42b273`) and only the leave asks `0x40b940` for a region
 * again (`0x42af28`). A ladder runs out of its region (MAZE's first crosses two
 * gaps with no region in them), and the view follows the climber through them.
 */
export function placeView(x: number, y: number): void {
  const r = p.climbing ? null : p.room;
  if (!r) {
    view.x = x;
    view.y = y;
    return;
  }
  const h = viewH();
  let sx = x;
  let sy = y;
  if (r.flags & CAMERA.capX && r.right - VIEW.w < sx) sx = r.right - VIEW.w;
  if (r.flags & CAMERA.floorX && r.left > sx) sx = r.left;
  if (r.flags & CAMERA.capY && r.bottom - h < sy) sy = r.bottom - h;
  if (r.flags & CAMERA.floorY && r.top > sy) sy = r.top;
  view.x = sx;
  view.y = sy;
}

/**
 * Which of {@link CAMERA.rig}'s three the player's state has installed. Each
 * state writes its own every frame it runs and the leave writes the foot's back,
 * so the rig is a function of the state and nothing else.
 */
export function cameraRig(): (typeof CAMERA.rig)[keyof typeof CAMERA.rig] {
  if (p.climbing) return CAMERA.rig.ladder;
  return p.bar ? CAMERA.rig.bar : CAMERA.rig.foot;
}

/** where the target is — the player's own point, led by the facing */
export function chaseTarget(): { x: number; y: number } {
  const rig = cameraRig();
  return {
    x: p.x + p.facing * rig.lead,
    y: (p.climbing ? p.climbY : p.y - p.feet) - rig.lift,
  };
}

/**
 * This engine frame's step, in whole pixels — `0x430ac8`'s `di` and `ax`.
 *
 * Kept rather than applied, because the frame is not this page's unit of time.
 * `0x4309f0` runs once an engine frame and jumps the corner the whole way; here
 * the player moves every TICK, four to the frame, so a camera that jumped once a
 * frame would scroll the world in 15Hz steps behind a man walking at 60 — which
 * is exactly how it looked. {@link driftCamera} spends the step across the
 * frame's four ticks instead, the same way the frame's fall is spent. At every
 * frame boundary the corner is where `0x4309f0` would have put it; in between it
 * is on the way there.
 */
export let camVx = 0;
export let camVy = 0;

/**
 * The probes — `0x4280d2`, which is a trigger table and not an object.
 *
 * Once an engine frame, against the LEVEL's own buffer: the player's point in
 * the record's rect fires it, `0x410170` stands up one flypast on the record's
 * `param` as a mode, and `0x402e80` shifts the record out of the table so it can
 * never fire again. See {@link PROBE}.
 */
export function stepProbes(): void {
  const lvl = level;
  if (!lvl) return;
  const py = p.y - p.feet;
  for (const q of lvl.probes) {
    if (q.fired) continue;
    if (p.x < q.left || p.x > q.right || py < q.top || py > q.bottom) continue;
    q.fired = true;
    // `0x410190` — the mode goes straight into `obj+0x28`, so for the crossing
    // pair it is the mirror flag as well as the branch
    const mirror = q.mode === 1;
    if (q.mode <= 1) {
      // `0x41025c` — half a screen to one side, and it comes towards you
      flypasts.push({
        x: p.x + (mirror ? PROBE.sideX : -PROBE.sideX),
        y: py,
        vx: 0,
        vy: 0,
        mirror,
        tag: 0,
        clock: 0,
      });
    } else {
      // `0x4102aa` / `0x41030a` — under your feet, or down out of the sky
      const below = q.mode === 2;
      flypasts.push({
        x: p.x,
        y: py + (below ? PROBE.offsetY : -PROBE.offsetY),
        vx: 0,
        vy: below ? -PROBE.startVy : PROBE.startVy,
        mirror: false,
        tag: 1,
        clock: 0,
      });
    }
    sound?.own(PROBE.sound[character] ?? PROBE.sound[0], p.x, py);
  }
}

/**
 * ...and what one fired — `0x410480`, which is three comparisons and a clamp.
 *
 * The divisor `0x4103e2` writes is ONE, so the script's own `dx` goes into the
 * velocity undivided and the clamp at `0x410486` is what stops it: 27 a frame
 * across, 23 up or down. Nothing here carries a strike box, so none of it can
 * touch the player — it is scenery with a trigger.
 */
export function stepFlypasts(): void {
  const py = p.y - p.feet;
  for (let i = flypasts.length - 1; i >= 0; i--) {
    const f = flypasts[i];
    f.clock += 1;
    if (f.tag === 0) {
      // `0x45d18c` negates the script's own dx for a mirrored object, and
      // `0x42f8b0` adds it to the velocity through the divisor — which is 1
      f.vx += PROBE.cross.dx * (f.mirror ? -1 : 1);
      f.vx = Math.max(-PROBE.maxVx, Math.min(PROBE.maxVx, f.vx));
      f.x += f.vx;
      // `0x4104d5` / `0x4104f2` — gone once it is half a screen past you
      if (
        Math.abs(f.x - p.x) > PROBE.goneX &&
        (f.mirror ? f.x < p.x : f.x > p.x)
      )
        flypasts.splice(i, 1);
      continue;
    }
    // `0x410531` — it turns to face you, and keeps whichever way it was going
    f.mirror = p.x > f.x;
    f.vy = f.vy < 0 ? -PROBE.maxVy : PROBE.maxVy;
    f.y += f.vy;
    if (Math.abs(f.y - py) > PROBE.goneY && (f.vy < 0 ? f.y < py : f.y > py))
      flypasts.splice(i, 1);
  }
}

/** which cel a flypast is showing — `0x46bdf0`'s two tags, and both of them loop */
export function flypastCel(f: Flypast): number {
  const a = f.tag === 0 ? PROBE.cross : PROBE.hover;
  return a.cels[Math.floor(f.clock / a.hold) % a.cels.length];
}

/**
 * Looking up and looking down — `0x4309f0`'s mode 1, a fixed point instead of
 * the player.
 *
 * The player's think puts the camera back on the player every frame
 * (`0x4280a2`, `0x430cb0(0)`), and two states take it off again for that frame
 * with `0x430c70(point)`:
 *
 * ```
 *   standing, W held   0x4297fe  counter [0x4ac364]++, and past 13:
 *                      0x429821  0x42fad0(player, 512, 256) — nobody near
 *                      0x42983e  x = player.x + 240, or − 240 facing left
 *                      0x42985a  y = player.y − 140
 *   ducking, S held    0x42ab5a  the same count and the same test (0x42ab81)
 *                      0x42abbe  y = player.y + 100
 * ```
 *
 * The counter is zeroed the frame the key is not held (`0x429898`, `0x42abed`)
 * and as the duck begins (`0x42a9ba`), so a look takes fifteen frames of holding
 * — a second — and ends the frame the key comes up. The step toward the point
 * is the ordinary chase with the state's own rig.
 */
export const LOOK = {
  /** `cmp ax, 0xd; jle` — the count BEFORE this frame's increment must pass 13 */
  after: 0xd,
  /** `0x42983e` / `0x42aba2`: `sbb; and 0x1e0; sub 0xf0` — ±240 by the facing */
  aheadX: 0xf0,
  up: -0x8c,
  down: 0x64,
  /** `0x42fad0(player, 0x200, 0x100)` — the box nobody may be in */
  clearW: 0x200,
  clearH: 0x100,
} as const;
export let lookFrames = 0;
export let lookWay: "up" | "down" | null = null;

/**
 * `0x42fad0(obj, w, h)` — true when no object with `obj+0x1c` set has its point
 * inside the w×h box centred on this one's. `obj+0x1c` is the census flag
 * (`0x42f870`), cleared the first frame a creature is dead, so the objects are
 * the counted creatures still alive, and Boggs' head (`0x41c591`).
 */
export function nobodyNear(x: number, y: number, w: number, h: number): boolean {
  if (!level) return true;
  const left = x - Math.trunc(w / 2);
  const top = y - Math.trunc(h / 2);
  const inside = (px: number, py: number): boolean =>
    px >= left && px <= left + w && py >= top && py <= top + h;
  for (const r of level.spawned)
    for (const e of r)
      if (inCensus(e) && inside(e.x, e.y))
        return false;
  for (const r of level.boggs)
    for (const g of r) if (!g.dying && inside(g.headX, g.headY)) return false;
  return true;
}

/** this frame's fixed point, or null to follow the player — see {@link LOOK} */
export function lookTarget(): { x: number; y: number } | null {
  const idle =
    p.onGround &&
    !p.act &&
    !p.moving &&
    !p.climbing &&
    !p.bar &&
    p.windup === 0 &&
    p.landLeft === 0;
  let way: typeof lookWay = null;
  if (idle && !p.crouching && held.up) way = "up";
  else if (idle && p.crouching && held.down) way = "down";
  if (way !== lookWay) lookFrames = 0;
  lookWay = way;
  if (!way) return null;
  const was = lookFrames++;
  const ay = p.y - p.feet;
  if (was <= LOOK.after || !nobodyNear(p.x, ay, LOOK.clearW, LOOK.clearH))
    return null;
  return {
    x: p.x + (p.facing < 0 ? -LOOK.aheadX : LOOK.aheadX),
    y: ay + (way === "up" ? LOOK.up : LOOK.down),
  };
}

/**
 * The jolt — `0x4307c0(n)` picks one of three short tables of pixels and
 * `0x430b85` spends it last thing in the camera's frame, one entry a frame from
 * the END of the table back to its start, each added to the view corner's y
 * through `0x430820` (and clamped with it). The chase then pulls the view back
 * on its own. The rolling landing asks for 1; the heavier things — the wraith's
 * arrival, the bishop, the ox — ask for 3.
 */
export const SHAKES: readonly (readonly number[])[] = [
  [],
  [8, 0, 4], // `0x472400`, three entries (`0x4307ee` counts 2 down to 0)
  [16, 0, 8, 0, 4], // `0x472408`
  [32, 0, 16, 0, 8, 0, 4], // `0x472418`
];
export let shaking: readonly number[] = [];
export let shakeAt = -1;
export function shake(n: 1 | 2 | 3): void {
  shaking = SHAKES[n];
  shakeAt = shaking.length - 1;
}

/** `0x4309f0`, once an engine frame — decide the step, do not take it */
export function stepCamera(): void {
  if (shakeAt >= 0) {
    placeView(view.x, view.y + shaking[shakeAt]);
    shakeAt -= 1;
  }
  const t = lookTarget() ?? chaseTarget();
  const { maxDx, maxDy } = cameraRig();
  // the point and the corner are words there (`0x430a86`, `0x430ae2`)
  const ex = Math.trunc(t.x) - Math.trunc(view.x + CHASE_X);
  const ey = Math.trunc(t.y) - Math.trunc(view.y + CHASE_Y);
  camVx = Math.max(
    -maxDx,
    Math.min(maxDx, Math.trunc((ex * maxDx) / CAMERA.spanX)),
  );
  camVy = Math.max(
    -maxDy,
    Math.min(maxDy, Math.trunc((ey * maxDy) / CAMERA.spanY)),
  );
}

/** ...and spend a quarter of it each tick, clamping every time as `0x430820` does */
export function driftCamera(): void {
  if (!camVx && !camVy) return;
  placeView(view.x + camVx * TICK_SCALE, view.y + camVy * TICK_SCALE);
}

/**
 * `0x428ff6` and `0x443a3d` — the arrival scroll, one per player class.
 *
 * Both do the same two subtractions the moment the player's point is moved to a
 * new room: the corner goes to `(x - 200, y - 100)` and `0x4308a0` clamps it. It
 * is not the chase point, which would be `(x - 256, y - 116)`, and the 56 and 16
 * of difference are the engine's, not a rounding of this page's.
 */
export function snapCamera(): void {
  camVx = 0;
  camVy = 0;
  placeView(
    p.x - CAMERA.arriveX,
    (p.climbing ? p.climbY : p.y - p.feet) - CAMERA.arriveY,
  );
}

/**
 * `0x42e6a7` — where a level BEGINS, and it is not the arrival: `0x42e580` puts
 * the corner on the start point itself, `0x4308a0(x, y)`, clamped by the room.
 * Where the room lets it, the player starts in the view's top-left corner and
 * the chase brings the view round onto them over the first second.
 */
export function startCamera(x: number, y: number): void {
  camVx = 0;
  camVy = 0;
  placeView(x, y);
}
export function setIface(v: typeof iface): void {
  iface = v;
}
export function setFlashColour(v: typeof flashColour): void {
  flashColour = v;
}

/** the other modules' writes into this one's state — ES imports are read-only */
export function setLevelClock(v: typeof levelClock): void {
  levelClock = v;
}
export function setBackdropFrames(v: typeof backdropFrames): void {
  backdropFrames = v;
}
export function setFlypasts(v: typeof flypasts): void {
  flypasts = v;
}
export function setCamVx(v: typeof camVx): void {
  camVx = v;
}
export function setCamVy(v: typeof camVy): void {
  camVy = v;
}
