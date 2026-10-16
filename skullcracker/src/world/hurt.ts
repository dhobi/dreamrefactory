/**
 * The player on the receiving end: the health bar a foe claims, the player's
 * body, the clock and health it gains and loses, the pose a hit puts it in, and
 * the codes a blow carries — and the gang and spares that hit the player together.
 */
import { FOES } from "../foes";
import type { CastKit, Enemy } from "../brains/kit";
import { COP_SLUG, IGOR_THROW, SKEL_BONE, PUKE_GOB, TUBE_BREATH, TUBE_SHARDS, VPRIEST_BOLT, WBOOLY_HIGH, WBOOLY_LOW, KRAGG_SHOT_AIR, KRAGG_SHOT_GROUND, GHENGIS_BLAST, KNIFEBOY_KNIFE, KNIFEBOY_LOB } from "../brains";
import { BOGGS, Boggs } from "../props";
import { gripOf } from "../codes";
import { p, scaled, player, level, BLOW_CODES, sound, damageOn } from "./state";
import { dropKeys } from "./keys";
import { hanging, knockedOff, setKnockedOff } from "./motion";
import { celRec, lastCel } from "./cels";
import { spawnedHere, hereOf, roll } from "./rooms";
import { killStreams } from "./arsenal";
import { stats, strikeOf, bleed, ownPoint } from "./blows";

/**
 * Hand the right-hand bar to whoever is nearest, exactly as the engine does.
 *
 * `0x40d1c0` is a competition every enemy enters once a frame: the Manhattan
 * distance from the player has to beat both the best so far and 1024, and the
 * painter resets the best to `0x7fff` afterwards. So the winner is the closest
 * thing within 1024px THIS frame — and when nothing is in range nobody calls,
 * the dirty flags stay clear, and the bar keeps the last one it was given.
 */
export function claimBar(): void {
  let best = 1024;
  let won: Enemy | null = null;
  for (const e of spawnedHere()) {
    if (!FOES[e.kind].panel || e.state === "dead") continue;
    const d = Math.abs(p.x - e.x) + Math.abs(p.y - e.y);
    if (d >= best) continue;
    best = d;
    won = e;
  }
  /**
   * ...and BOGGS, which enters the same competition and is not a creature.
   *
   * `0x41bead` runs `0x40d1c0(0x4a50e8, 0x40e300(0xfa0), 0x33fa, head.pos)` out
   * of the body's own tick once a frame, at the HEAD's point. Nothing else in
   * VAT counts, so without this the last level of the game is the only one whose
   * right-hand bar never says anything — which is what it did here.
   *
   * The machinery does NOT enter it: `0x41b510` never calls `0x40d1c0`, so how
   * much is left of either breakable half is not a thing the disc ever shows
   * you. This page's debug line is the only place it appears.
   */
  let boggs: Boggs | null = null;
  for (const g of hereOf((l) => l.boggs)) {
    if (g.dying) continue;
    const d = Math.abs(p.x - g.headX) + Math.abs(p.y - g.headY);
    if (d >= best) continue;
    best = d;
    boggs = g;
  }
  if (boggs) {
    stats.shown = {
      health: Math.max(0, boggs.hp),
      max: scaled(BOGGS.health),
      nameCel: BOGGS.plate,
    };
    return;
  }
  if (!won) return;
  stats.shown = {
    health: Math.max(0, won.hp),
    max: won.max,
    nameCel: won.plate ?? FOES[won.kind].panel!.plate,
  };
}

/**
 * The player's own body box, from the cel showing now — and the reason a
 * knockdown is safe.
 *
 * `0x4303b3` skips a victim whose current cel has a degenerate body box, so
 * being untouchable is a property of the ART and not of a timer.
 *
 * The cels listed here before — 5900..5902, 5910..5915, 5940..5944, 9550..9558,
 * 5020/5021 — are CHARACTER 1's, and character 1 does carry no box through any
 * reaction. Character 0, which is what this page plays, is not so lucky: of its
 * 38 reaction cels twelve carry a body box — 922, the held loop 4570..4572, the
 * struggle 4575..4579 and the jolt 460..462. So a grab does NOT make you
 * untouchable here; a knockdown does.
 */
export function playerBody(): {
  top: number;
  left: number;
  bottom: number;
  right: number;
} | null {
  const rec = celRec(player, lastCel);
  if (!rec?.body) return null;
  // ...and the same translation `0x40e680` does, about the anchor — see
  // {@link strikeOf}. `p.x` IS the anchor's x (the art is drawn at `x - posX`),
  // so only the y needs converting: `p.y` is the ground the player stands on and
  // the anchor sits `height - posY` above it, which is where the art's bottom
  // edge falls.
  const [cx0, cx1] =
    p.facing < 0 ? [-rec.body.x1, -rec.body.x0] : [rec.body.x0, rec.body.x1];
  const ay = p.y - rec.height + rec.posY;
  return {
    left: p.x + cx0,
    right: p.x + cx1,
    top: ay + rec.body.y0,
    bottom: ay + rec.body.y1,
  };
}

/**
 * `0x40d350` — a NEGATIVE argument is a gift of time, and the dial is the cap.
 *
 * ```
 *   40d355  if (n >= 0)  [0x4a4d68] = n;  return      ; positive SETS the clock
 *   40d361  [0x4a4d68] -= n                           ; ...negative adds
 *   40d378  if ([0x4a3b18] < [0x4a4d68])  [0x4a4d68] = [0x4a3b18]
 * ```
 *
 * `[0x4a3b18]` is the dial's full scale, which every chapter's entry function
 * fills from the same `timer` record it fills the clock from — see
 * {@link clockFor}. So the clock pickup and `jetson` both hand over 850 and
 * neither can wind a level past the time it was authored with.
 */
export function addClock(n: number): void {
  stats.ticks = Math.min(stats.clockFull, stats.ticks + n);
}

/** `0x402ac0` — take it off, floor at zero, and start dying if that empties it */
export function takeHealth(n: number): void {
  stats.health = Math.max(0, stats.health - Math.round(n));
  if (stats.health > 0 || p.act === "dying") return;
  // `0x402f60` refuses a second death while the first is playing, and `0x402fa0`
  // installs `0x476758` tag 0 — the kind that IS being dead — having called
  // `0x402df0` first: every key dropped
  dropKeys();
  p.dyingTag = 0;
  p.act = "dying";
  p.actClock = 0;
  p.vx = 0;
}

/** `0x402f00`'s four: the judder, held, the spawn pose, knocked down */
export const HELPLESS: ReadonlySet<string> = new Set(["jolt", "held", "struggle", "grabbed", "posed", "downFront", "downBack"]);

/**
 * `0x402fa0(mode)`, the player's pose setter — `0x402df0` drops every key,
 * then `0x42f280` puts out a running stream (`0x42e700`) and jumps through
 * `0x42f418` on `mode + 1`:
 *
 * ```
 *   -1  0x42f29b  0x471b18 tag 0, the spawn pose (kind 13), and nothing else
 *    2  0x42f319  0x4722a8 tag 0, the knockdown — unless he is on a ladder or
 *                 a bar (`[0x46b1bc] = 1` instead), already down (kind 0x18),
 *                 or dying (`0x402f60`)
 *    3  0x42f36d  0x4720e8 tag 0, held
 *    4  0x42f383  0x471fc8 tag 0, the judder (kind 9)
 * ```
 *
 * Character 1's own setter `0x449700` is the same table on its own scripts.
 * The ladder's flag is {@link knockedOff}.
 */
export function posePlayer(mode: -1 | 2 | 3 | 4): void {
  dropKeys();
  killStreams();
  let act: string;
  if (mode === -1) act = "posed";
  else if (mode === 2) {
    // `0x42f363` — on a ladder or a bar, no knockdown: knocked off instead
    if (hanging()) {
      setKnockedOff(true);
      return;
    }
    // `0x42f334` / `0x42f33f` — already down, or dying. The knockdown is the
    // only mode that asks the second: -1, 3 and 4 put their pose over a death
    // too, and the next health taken (`0x402ac0`, even none) starts it again
    if (p.act === "downFront" || p.act === "downBack" || p.act === "dying") return;
    act = "downFront";
  } else if (mode === 3) act = "held";
  else act = "jolt";
  p.act = act;
  p.actClock = 0;
}

/** a grabber writing the player's point and, where it does, his velocity and facing */
export function pinPlayer(
  at: { x: number; y: number },
  v?: { vx?: number; vy?: number; facing?: number; fell?: number },
): void {
  p.x = at.x;
  // the point is the ANCHOR and `p.y` is the feet — see {@link poseFeet}
  p.y = at.y + p.feet;
  p.onGround = false;
  if (v?.vx !== undefined) p.vx = v.vx;
  if (v?.vy !== undefined) {
    p.vyRaw = v.vy;
    p.vy = 0;
    // `0x42fdb0` — a vertical speed that is not downward is no fall at all
    if (v.vy <= 0) p.fallPx = 0;
  }
  if (v?.facing !== undefined) p.facing = v.facing > 0 ? 1 : -1;
  // `obj+0x32`, the fall so far — the eyeball's `0x43e39b` writes it to nothing
  if (v?.fell !== undefined) p.fallPx = v.fell;
}

/**
 * Where the cel a grabber is showing RIGHT NOW would hold you.
 *
 * The frame-by-frame re-read is the whole of it and not an implementation
 * detail: `0x42857d` fetches the grabber's cel record every frame the held state
 * runs, which is why the hold ends by itself when the fist opens. Reading it
 * once, at the moment of the grab, gives a grip that never goes away — the hand
 * sinks back into the ground with the player still pinned to where it was.
 */
export function gripAt(
  id: number,
  x: number,
  y: number,
  facing = 1,
): { x: number; y: number } | null {
  const cel = celRec(level?.sbk, id);
  return gripOf(cel, cel ? strikeOf(cel, x, y, facing) : null);
}

/**
 * A blow CODE landed: run its row of the table at `0x4492b8`.
 *
 * Returns what the original's handler returns — true where it answered 1, which
 * tells `0x430367`'s loop the blow was consumed. {@link BLOW_CODES} is the whole
 * of the data; this is only the eight side effects the eight cases share.
 *
 * `-9` and anything below it is NOT in the table (`0x448c84`'s range test sends
 * it to the damage path), so this returns false for them and the caller falls
 * through to the arithmetic exactly as the original does.
 */
export function takeCode(
  code: number,
  grip?: () => { x: number; y: number } | null,
  what?: object,
  /** what struck, for the one reaction whose spray follows it (`0x42eb15`) */
  striker?: Parameters<typeof bleed>[2],
): boolean {
  const r = BLOW_CODES[code];
  if (!r) return false;
  // `0x448c19` and `0x448c40`: the FIRST thing the player's handler does, before
  // it has even looked at the strength, is cancel a running stream with -1
  killStreams();
  // the same thing, still holding you: `0x43045d` disarms a hitter the frame it
  // connects and the classes re-arm on the next, so without this the reaction
  // restarts every frame and the grab never reaches its own loop
  if (r.holds && what && p.heldWhat === what) return r.consumes;
  // `0x42e99d` / `0x42ea3c` — the grab and the jolt ask first whether he is
  // on a ladder or a bar, and there they install nothing: they knock him off
  // (`0x42ea26`, `0x42ea9c`) and answer 1
  if ((code === -3 || code === -2) && hanging()) {
    setKnockedOff(true);
    return true;
  }
  p.act = r.act;
  p.actClock = 0;
  p.heldClock = 0;
  // `0x448eda`/`0x448fc9` zero `obj+0xa` and `obj+0xc` both
  if (r.stops) {
    p.vx = 0;
    p.vy = 0;
    p.vyRaw = 0;
  }
  if (r.gravity !== null) p.gravityScale = r.gravity;
  // No reaction in CHARACTER 0's table shoves — a ±50 shove is `0x448cf4`, in
  // character 1's. Kept because the field is still read.
  if (r.shove) p.vx -= r.shove * p.facing;
  if (r.sound !== undefined) {
    const which = r.sound + (r.soundRoll ? roll(r.soundRoll) : 0);
    sound?.own(which, p.x, p.y, r.soundWay);
  }
  // `0x42e7f6` hands the spray nothing to follow and `0x42eb21` the striker,
  // and −1's goes before its twenty come off (`0x42eb2b`)
  if (r.spray !== undefined) bleed(r.spray, ownPoint(), r.spray < 0 ? striker : undefined);
  // ...and `-1` spends twenty: `0x42eb2b` is `0x402ac0(0x14)`, the only reaction
  // in character 0's eight that costs health. Behind the damage switch, like
  // every other way the game takes a point off you.
  if (r.health && damageOn && p.act !== "dying") takeHealth(r.health);
  if (r.holds) {
    // a grab with no grip is still a grab: the engine enters the held state and
    // `0x4285b8` throws it straight back out on the next frame, which restores
    // the gravity this just took away. Giving it a grip that is already gone is
    // that, and it is why a grabber whose art carries no strike box is harmless
    // rather than a player stuck in mid-air.
    p.heldBy = grip ?? ((): null => null);
    p.heldWhat = what ?? null;
  }
  return r.consumes;
}

/**
 * Everything that can hit the player, once a frame — `0x430367` onward, which is
 * the same loop that lets the player hit everything else, run the other way.
 *
 * A hitter counts when its own `obj+0x1a` is live, its current cel carries a
 * strike box, and that box overlaps the victim's body box. Then the victim's
 * handler runs, and the player's (`0x448c60`) takes the blow's magnitude off the
 * health and picks a reaction off the one threshold at `0x449115`.
 *
 * `0x43045d` disarms a hitter after one connect — but almost every class in this
 * chapter re-arms itself on the next tick (`0x455065` for the dog, `0x454495` for
 * the fourth punk, four sites in the girder), so the disarm buys the player one
 * frame and no more. One blow a frame is therefore the whole of it, which is why
 * this stops at the first thing it finds: the reaction it installs takes the
 * player's body box away for the several frames that follow, and THAT is the
 * invulnerability.
 */
/**
 * ...and what a creature swings or throws lands on the OTHER creatures too.
 *
 * `0x42fc9a` runs the hit pass `0x430350` for every object against every
 * object, not for the player against the rest: a strike box over anybody's
 * body box goes to that body's own hit handler. What stops a crowd of punks
 * felling each other is the HANDLERS — each turns away its own class first
 * (the dog's `0x430ee0([0x476a90])` at `0x455139`, the CHOPPER's `0x4547e1`)
 * and a negative strength that is not fire — so a punk's kick lands on the
 * CHOPPER, a skeleton's bone on a zombie, the CHOPPER's sink blast on whatever
 * lies under it, and the handler pays its award as it always does.
 *
 * The arithmetic is the player's (`0x42f910`, see {@link takeHits}). A thrown
 * thing is spent on the first body that takes it (`0x430470` sets `obj+0x2a`;
 * the blast, 0x65, is the exception and keeps hitting), and a swing lands once
 * per body per script, the way a flinch outlasts the frames that carry a box.
 * Under the creature switch, like every other creature blow.
 */
export const struckBy = new WeakMap<object, { anim: unknown; hit: Set<Enemy> }>();
/**
 * ...and the handlers that turn away MORE than their own class — the three
 * throwers whose handler refuses the thing they throw themselves, so none is
 * felled by what it has just let go in front of itself:
 *
 * - the igor's `0x4256e0` / `0x4256f8`: the bats' list `[0x46ecc4]`, then
 *   `[0x46ecd0]` — the thrown class `0x421310` makes, which is its own lob AND
 *   the skeleton's bone;
 * - the bishop's `0x426500` / `0x426518`: its bolt's `[0x46ecdc]`, then bats;
 * - PLAYGR's boss, `0x456310`: its fireballs' `[0x4782d8]` (`0x45635e`), then
 *   the dogs' `[0x476a90]` (`0x456376` — the list the dog's own handler turns
 *   its kind away with at `0x455139`).
 * - the gang of chapter five, whose four handlers read the same list: the
 *   roller's `[0x472564]` (`0x43a790` makes it), the knotboy's `[0x4740b4]`,
 *   the knife class `[0x4a7578]` (both of the knifeboy's throws, `0x43a462` /
 *   `0x43a512`), the batboy's `[0x4740ac]`, the maskboy's `[0x4740b0]` and the
 *   knifeboy's own `[0x4740a8]` (registered for `0x439bd0` at `0x439bbd`) —
 *   `0x438263`..`0x4382f4` (knotboy), `0x438f03`..`0x438f94` (maskboy),
 *   `0x439983`..`0x439a14` (batboy), `0x43a583`..`0x43a614` (knifeboy). The
 *   roller never lands on a creature here, so only the four and the knives
 *   are listed;
 * - the TCop's `0x4147d0`: the slurp's `[0x46c9e4]` (`0x4147e7`) and its own
 *   slug's `[0x46c620]` (`0x4147ff`) — and not its own class, so cops hurt
 *   cops ({@link Foe.hitsOwn});
 * - the tube's `0x419990`: its own glass `[0x46bfb4]` (the shards and the
 *   breath), puke's spit `[0x46cc60]` and the arm's `[0x46d1b0]`
 *   (`0x4199c3`…`0x419a05`);
 * - the CHOPPER's `0x454804`: the dogs' `[0x476a90]`, after its own class;
 * - the brain's `0x415100`: a TCop, class `[0x46c9e0]` (`0x415110`), and the
 *   tube's thrown glass `[0x46bfb4]` (`0x415170`), beside its own;
 * - the dog's `0x4550b0`: after its own class, the punk's `[0x47760c]`
 *   (`0x455150`, the list `0x450a61` fills) and the CHOPPER's `[0x477c34]`
 *   (`0x455168`);
 * - the skeleton's `0x423a30`: the thrown class `[0x46ecd0]` (`0x423a33`),
 *   the bats' `[0x46ecc4]` (`0x423a52`), then its own;
 * - the zombie's `0x4209f0`: the bats' `[0x46ecc4]` (`0x420a13`), and nothing
 *   else — not even its own class ({@link Foe.hitsOwn});
 * - kragg's `0x441cf0`: its own shots' `[0x472568]` (`0x441cff`);
 * - the wraith's `0x424f80`: the bats' `[0x46ecc4]`, its own class and the
 *   thrown class `[0x46ecd0]` (`0x424f90`..`0x424fc0`);
 * - ghengis' `0x422ad0`: its own class `[0x46f048]` — whose blast, and whose
 *   nine pieces, are objects of it (`0x422c60`) — then `[0x46ecd0]` and the
 *   surge's `[0x46ecc8]` (`0x422afb`..`0x422b41`). The pieces are casts of
 *   their own each time and are not listed; their strength is held at zero
 *   while they fly (`0x4229d2`).
 */
export const GANG = {
  kinds: ["initknotboy", "initbatboy", "initmaskboy", "initknifeboy"],
  kits: [KNIFEBOY_KNIFE, KNIFEBOY_LOB],
};
export const SPARES: Record<string, { kinds: readonly string[]; kits: readonly CastKit[] }> = {
  initigor: { kinds: ["initbat"], kits: [IGOR_THROW, SKEL_BONE] },
  initvpriest: { kinds: ["initbat"], kits: [VPRIEST_BOLT] },
  initwbooly: { kinds: ["initdog"], kits: [WBOOLY_HIGH, WBOOLY_LOW] },
  initknotboy: GANG,
  initbatboy: GANG,
  initmaskboy: GANG,
  initknifeboy: GANG,
  initwered: { kinds: ["initdog"], kits: [] },
  initslurp: { kinds: ["initcop"], kits: [...TUBE_SHARDS] },
  initcop: { kinds: ["initslurp"], kits: [COP_SLUG] },
  inittube: { kinds: ["initarm"], kits: [...TUBE_SHARDS, TUBE_BREATH, PUKE_GOB] },
  initdog: { kinds: ["initwerea", "initwered"], kits: [] },
  initskel: { kinds: ["initbat"], kits: [IGOR_THROW, SKEL_BONE] },
  initzomb: { kinds: ["initbat"], kits: [] },
  initkragg: { kinds: [], kits: [KRAGG_SHOT_AIR, KRAGG_SHOT_GROUND] },
  initwraith: { kinds: ["initbat"], kits: [IGOR_THROW, SKEL_BONE] },
  initghengis: { kinds: [], kits: [IGOR_THROW, SKEL_BONE, GHENGIS_BLAST] },
};
