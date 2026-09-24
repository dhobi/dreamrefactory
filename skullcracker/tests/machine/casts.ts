/**
 * What the CREATURES throw.
 *
 *   npx tsx tests/machine/casts.ts        (from skullcracker/)
 *
 * Ten classes in this game fight at a distance and not one of them could reach
 * the player: their brains read the throw, played its animation and its sound,
 * and made no object, because a `Brain` is handed one enemy and has no way to
 * put a second thing in the level. The wiring is `BrainCtx.cast`, called at the
 * instruction each class calls its own spawner at, and this is the proof for the
 * ones that are built.
 *
 * ## The first two are deliberately the two different SHAPES
 *
 * - **the spitter's gob** (`initpuke`, LAB): `0x418400` stands it 100 ahead and
 *   65 up, its own script's `dx 400` over a divisor of 13 gives it 31 pixels an
 *   engine frame, it cycles five cels, and `0x418621` takes it away once it is
 *   1000 from the player. Dangerous from the frame it leaves.
 * - **the cop's slug** (`initcop`, MAZE): `0x414740` writes the velocity itself
 *   (±35), gives it a hundred FRAMES to live rather than a distance, and — the
 *   part worth a test of its own — holds its strength at ZERO until it is within
 *   130 pixels of the player, when `0x413e79` arms it and puts a second cel on
 *   it. A slug crossing a room hurts nothing.
 *
 * ## Why it walks about
 *
 * Neither class throws on demand. The spitter spits on a coin toss in its 110
 * to 180 band and charges inside that; the cop's gun is one of four things its
 * own `decide` picks. So the probe steers the gap — a step towards, a step away
 * — which is what a player does and what puts the thrower in a state where
 * throwing is one of its options. The dice are SC's own and seeded at every
 * level load, so every leg below is the same run every time.
 */
import { fail, headless, ok, pass } from "./harness";

const h = await headless("level=15&x=700&y=8521&damage=1&foehit=1");
const { game } = h;

/** one cast as it was on one frame */
interface Seen {
  cel: number;
  x: number;
  y: number;
  blow: number;
  /** pixels an engine frame, which the last legs are entirely about */
  vx: number;
  vy: number;
  /** it has landed a blow this frame and goes on the next — `obj+0x2a` */
  spent: boolean;
}

/** the nearest living thing of this class in the player's room, or null */
const nearest = (who: string) =>
  game
    .spawnedHere()
    .filter((e) => e.kind === who)
    .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0] ?? null;

/**
 * Hold a thrower at arm's length for a while, gathering everything that flew.
 *
 * The distance is the point, and it has to be STEERED rather than swept. Every
 * one of these classes decides by band: a thrower whose target stands still
 * settles into the one state its distance allows, and for most of them that
 * state is a melee — but a fixed there-and-back walk is no better, because the
 * thrower moves too and the two drift apart. So each sample reads where the
 * thrower is and steps towards it or away from it to hold the gap in the
 * middle of the band where throwing is one of its options.
 *
 * Every cast in the level is recorded on every frame, not a sample of one.
 */
const sweep = (
  samples: number,
  who: string,
  hold: { min: number; max: number },
  /** face it on the samples the gap is right — `0x43e0a0` throws at nobody else */
  face = false,
  /** engine frames a step is held for, and the sample lasts */
  pace = 2,
): { seen: Seen[]; health: number[]; met: number; acts: Set<string> } => {
  const seen: Seen[] = [];
  const health: number[] = [game.stats.health];
  const acts = new Set<string>();
  let met = 0;
  const look = (): void => {
    for (const c of game.casts)
      seen.push({
        cel: game.castCel(c),
        x: Math.round(c.x),
        y: Math.round(c.y),
        blow: game.castBlow(c),
        vx: Math.round(c.vx),
        vy: Math.round(c.vy),
        spent: !!c.spent,
      });
    if (game.p.act) acts.add(game.p.act);
    if (health[health.length - 1] !== game.stats.health) health.push(game.stats.health);
  };
  const step = (frames: number): void => {
    for (let f = 0; f < frames; f++) {
      h.frame();
      look();
    }
  };
  for (let i = 0; i < samples; i++) {
    const me = game.p.x;
    const him = nearest(who);
    // towards it when it is too far, away when it is too close, and on the
    // frames it cannot be seen at all, east — which is where these rooms run
    // and so where its own patrol will bring it back
    if (him) met++;
    const gap = him ? Math.abs(him.x - me) : 0;
    const key: "right" | "left" | null = !him
      ? "right"
      : gap > hold.max
        ? him.x > me ? "right" : "left"
        : gap < hold.min
          ? him.x > me ? "left" : "right"
          : null;
    if (key) {
      h.hold(key, true);
      step(pace);
      h.hold(key, false);
    } else if (face && him) {
      // a tap towards it: one frame, enough to turn (the turn is a frame's
      // business, so a shorter press is no press) and eight pixels of closing
      const toward = him.x > me ? "right" : "left";
      h.hold(toward, true);
      step(1);
      h.hold(toward, false);
      step(Math.max(1, pace - 1));
    } else {
      step(pace);
    }
  }
  return { seen, health, met, acts };
};

const cels = (s: Seen[]): number[] => [...new Set(s.map((c) => c.cel))].sort((a, b) => a - b);
const blows = (s: Seen[]): string => [...new Set(s.map((c) => c.blow))].join(",");
/** wait for the class to stand in the player's room */
const standBy = (who: string, where: string, walk = false): void => {
  const took = h.until(() => {
    if (walk) {
      h.hold("right", true);
      h.frame();
      h.hold("right", false);
    }
    return nearest(who) !== null;
  }, 80);
  if (took < 0) fail(`${where} should stand by a ${who}; the room holds ${game.spawnedHere().map((e) => e.kind).join(",")}`);
};

// ---- 1 — the spitter's gob -------------------------------------------------

// LAB's nearest spitter to x700 stands at `(610, 8423)`
standBy("initpuke", "LAB x700");
/**
 * 110..180 is the band `0x41809b` spits from on a plain coin toss, and
 * `puke.ts` calls it "the band the class is built for". The band above it
 * (180..280) spits too, but only after `0x41804c`'s `cmp roll, 0x28` — nine
 * frames in ten at that distance it chooses nothing at all. Inside 110 the class
 * charges (`0x4180da`), and the charge and its run-out look at nobody until they
 * end (state 3, the flip at `0x418167`; see `puke.ts`).
 */
const gobs = sweep(260, "initpuke", { min: 120, max: 170 });
if (!gobs.seen.length) fail(`a spitter threw nothing in 260 samples (it was in the room ${gobs.met} times) — 0x418400 is not being called`);
const gobCels = cels(gobs.seen);
// `0x46cc28` tag 1 is 3064, 3063, 3062, 3061, 3060 and the gob is drawn out of them
if (gobCels.some((c) => c < 3060 || c > 3064)) fail(`a gob is cels 3060..3064; saw ${gobCels.join(",")}`);
if (gobs.seen.some((s) => s.blow !== 0x64)) fail(`0x41862c holds a gob at 100; saw ${blows(gobs.seen)}`);
ok(`the spitter spits — ${gobs.seen.length} frames with a gob in the air, cels ${gobCels.join(",")}`);

const worst = Math.min(...gobs.health);
if (worst >= gobs.health[0]) fail(`a gob that lands takes health; it never fell: ${gobs.health.join(" ")}`);
ok(`...and a gob that lands hurts — ${gobs.health[0]} down to ${worst}`);

// ...and the same level with the creature switch off: it still flies, and it
// cannot spend a point. That switch is the BENCH's, and this is what it means.
await h.load("level=15&x=700&y=8521");
standBy("initpuke", "LAB x700");
const quiet = sweep(140, "initpuke", { min: 120, max: 175 });
if (!quiet.seen.length) fail(`the gob is a creature's blow, not a creature's damage — it should fly with ?foehit off too`);
if (quiet.health.length > 1) fail(`?foehit is off and something still took health: ${quiet.health.join(" ")}`);
ok(`with the creature switch off it still flies and takes nothing (${quiet.seen.length} frames)`);

// ---- 2 — the cop's slug, and its arming ------------------------------------

// the second of MAZE's seven, and the one chosen because it patrols its own
// rect alone (x1400..1955, y6965..7145)
await h.load("level=13&x=1902&y=7045&damage=1&foehit=1");
standBy("initcop", "MAZE x1902");
// held in 190..320, inside the band `0x414157` shoots from (180..350, anchor to
// anchor, `0x46c9d8`); in 70..180 the class only swings or walks in (`0x4141be`)
const slugs = sweep(240, "initcop", { min: 190, max: 320 });
if (!slugs.seen.length) fail(`a cop fired nothing in 240 samples (it was in the room ${slugs.met} times) — 0x414740 is not being called`);
const slugCels = cels(slugs.seen);
if (slugCels.some((c) => c !== 2240 && c !== 2241)) fail(`a slug is cel 2240 or 2241; saw ${slugCels.join(",")}`);
// what makes it a slug rather than a gob: it is worth nothing until it arms
for (const s of slugs.seen) {
  if (s.cel === 2240 && s.blow !== 0) fail(`tag 0 holds obj+0x1a at zero (0x413e43); an unarmed slug read blow ${s.blow}`);
  if (s.cel === 2241 && s.blow !== 0x64) fail(`tag 1 writes 0x64 (0x413e79); an armed slug read blow ${s.blow}`);
}
ok(`the cop fires — ${slugs.seen.length} frames, cels ${slugCels.join(",")}, and the blow follows the tag`);
/**
 * ...and one of them ARMED, which is the only way to know one reached him.
 *
 * Not "it took health": the probe is holding the cop at arm's length on purpose
 * — inside 130 the class stops firing and swings instead — so whether a
 * particular slug lands is the cop's business and the player's footwork. What
 * the arming says is that a slug crossed the last hundred and thirty pixels and
 * became worth a hundred points of blow while it did it.
 */
const armed = slugs.seen.filter((s) => s.cel === 2241).length;
if (!armed) fail(`no slug ever armed: 0x413e5d arms one inside 130 of the player, and ${slugs.seen.length} frames of slug flew`);
ok(`...and ${armed} frames of it armed on the way in`);

// ---- 3 — the eyeball's glob, which is a CODE and not a blow ---------------
//
// The third shape, and the one that changes what the player does rather than
// what he has left: `0x43dbda` writes −2 into the glob's strength every frame,
// and −2 is `0x42ea34`'s jolt.
//
// The eye also wants its own footwork: it spits in its 180..260 band
// (`0x43e08d`) and only at a player who is FACING it (`0x43e0a0` sends the ones
// who are not into the drift instead), so the probe faces it while it holds.
//
// A hundred pixels west of the eye at (7105, 15998), which puts him on the ledge
// at y16138 under it. On its own point he falls through to y17040, a thousand
// below it, and past `0x43e04a`'s two hundred the class gives up and hunts for a
// ladder (state 6) that this port cannot find for it — and never comes back.
await h.load("level=7&x=7005&y=15998&damage=1&foehit=1");
standBy("initeyeball", "SEWER x7005");
const globs = sweep(200, "initeyeball", { min: 190, max: 250 }, true);
if (!globs.seen.length) fail(`an eye threw nothing in 200 samples (it was in the room ${globs.met} times)`);
const globCels = cels(globs.seen);
// `0x4725c0`'s five launches and five flights, 8500 through 8590
if (globCels.some((c) => c < 8500 || c > 8590)) fail(`a glob is cels 8500..8590; saw ${globCels.join(",")}`);
if (globs.seen.some((s) => s.blow !== -2)) fail(`0x43dbda holds a glob at -2; saw ${blows(globs.seen)}`);
ok(`the eye spits — ${globs.seen.length} frames, cels ${globCels.join(",")}, every one worth -2`);

const jolt = game.BLOW_CODES[-2]?.act;
if (!jolt || !globs.acts.has(jolt)) {
  fail(`a glob that lands is 0x42ea34's jolt (${jolt}); the player played ${[...globs.acts].join(", ") || "nothing"}`);
}
ok(`...and one that lands JOLTS him — the first -2 a placed class has ever sent`);

// ---- 4 — the zombie's gob, which goes nowhere at all ----------------------
//
// Nothing gives this thing a speed. Not the spawner (`0x420990` writes the
// point, the facing and the room), not the creator (`0x42015a`), and not one of
// the eight frames of `0x470028`. It hangs forty pixels above the mouth and
// sixty-five in front of it for the eight frames its own script lasts
// (`0x4201ea`), carrying −2 the whole time.
await h.load("level=9&x=1000&y=1010&damage=1&foehit=1");
standBy("initzomb", "GRAVE x1000");
/**
 * Inside a HUNDRED, which is `0x4204fd`'s own gate: the bands are
 * [300, 200, 100] and the spit wants the innermost. It also wants the player
 * facing it — `0x4204c3` sends a zombie whose back you are to into the melee
 * instead — which is what `face` is for.
 */
const bile = sweep(180, "initzomb", { min: 40, max: 90 }, true);
if (!bile.seen.length) fail(`a zombie hawked nothing in 180 samples (it was in the room ${bile.met} times)`);
const bileCels = cels(bile.seen);
if (bileCels.some((c) => c < 1890 || c > 1897)) fail(`a zombie's gob is cels 1890..1897; saw ${bileCels.join(",")}`);
if (bile.seen.some((s) => s.blow !== -2)) fail(`0x4201e4 holds it at -2; saw ${blows(bile.seen)}`);
if (bile.seen.some((s) => s.vx !== 0)) fail(`nothing gives the zombie's gob a speed; saw vx ${[...new Set(bile.seen.map((s) => s.vx))].join(",")}`);
ok(`the zombie hawks one up — ${bile.seen.length} frames, cels ${bileCels.join(",")}, all worth -2 and none moving`);

// ---- 5 — Igor's throw, and the first one with WEIGHT ----------------------
//
// Everything before it flies flat or not at all, because every one of their
// creators calls `0x42f850(obj, 0)`. `0x41fc7b` pushes **0.8f**, so `obj+0x24`
// is 8 and `0x430327` adds those eight to the vertical velocity every frame;
// `0x42fda7` spends the velocity into the point undivided. It leaves 26 up and
// 35 along (`0x425544`…`0x425582`) and comes down on its own.
//
// RAVECAVE's second igor (9135, ~10015), because it patrols alone, from 335
// west of it: its throw is band 1, 300..350, and from its own point the player
// backs into the wall at x8830 with the gap still short of three hundred.
await h.load("level=11&x=8800&y=9939&damage=1&foehit=1");
standBy("initigor", "RAVECAVE x8800");
const hurled = sweep(220, "initigor", { min: 300, max: 340 }, true);
if (!hurled.seen.length) fail(`an igor threw nothing in 220 samples (it was in the room ${hurled.met} times)`);
const hurledCels = cels(hurled.seen);
if (hurledCels.some((c) => c < 3160 || c > 3163)) fail(`it throws cels 3160..3163; saw ${hurledCels.join(",")}`);
if (hurled.seen.some((s) => s.blow !== 0x64)) fail(`0x41fd0d holds it at 100; saw ${blows(hurled.seen)}`);
/** ...and it ARCS, which is the whole of what this leg adds: the pull */
const spread = Math.max(...hurled.seen.map((s) => s.y)) - Math.min(...hurled.seen.map((s) => s.y));
if (spread < 20) fail(`a thrown thing with weight 0.8 should rise and fall; its y moved ${spread}px`);
ok(`the igor throws, and it arcs — ${hurled.seen.length} frames, cels ${hurledCels.join(",")}, ${spread}px of rise and fall`);

// ---- 6 — the knifeboy, who throws TWO different things --------------------
//
// `0x43a26c` rolls `0x434540(4)` once as its wind-up ends and spends the answer
// on both halves: 1 and 2 take `0x43a450` and its sound, 3 and 4 take
// `0x43a500` and its. They share a class (`0x43c520`, divisor 2, weight 0.23)
// and nothing writes either one a velocity — **the script is the velocity**:
//
//   the knife  `0x473670` tag 0 `dx 100`, then tag 1's `dx 0 50 0 50 0 0 0`
//   the lob    `0x4736f8` tag 0 `dy -30`, then four cels of falling
await h.load("level=6&x=1082&y=8399&damage=1&foehit=1");
standBy("initknifeboy", "SERVICE x1082");
// no facing tap and a wide hold: a probe that walks at it continuously
// collapses the gap into the melee it keeps for close quarters
const knives = sweep(320, "initknifeboy", { min: 80, max: 240 }, false, 1);
if (!knives.seen.length) fail(`a knifeboy threw nothing in 320 samples (it was in the room ${knives.met} times)`);
const knifeCels = cels(knives.seen);
if (knifeCels.some((c) => c < 1870 || c > 1877)) fail(`both of its throws are cels 1870..1877; saw ${knifeCels.join(",")}`);
if (knives.seen.some((s) => s.blow !== 0x64)) fail(`0x43c54a gives it a hundred; saw ${blows(knives.seen)}`);
ok(`the knifeboy throws — ${knives.seen.length} frames, cels ${knifeCels.join(",")}`);

// ---- 7 — the bishop's bolt, and the strength that was hiding in a tail ----
//
// `0x426e1e` is the THINK's common tail, past the dispatch, so every one of the
// four arms lands on it and a bolt is worth a hundred from the frame it leaves.
// Cel 2700 crosses the room at `dx 600` over a divisor of thirteen — forty-six
// pixels an engine frame, the fastest thing anybody throws — and tag 1,
// 2700..2704, is what it plays when it stops.
await h.load("level=12&x=17600&y=15300&damage=1&foehit=1");
standBy("initvpriest", "TOWER x17600");
const bolts = sweep(260, "initvpriest", { min: 170, max: 260 }, true);
if (!bolts.seen.length) fail(`the bishop threw nothing in 260 samples (it was in the room ${bolts.met} times) — 0x426bc0 is not being called`);
const boltCels = cels(bolts.seen);
if (boltCels.some((c) => c < 2700 || c > 2704)) fail(`a bolt is cels 2700..2704; saw ${boltCels.join(",")}`);
if (bolts.seen.some((s) => s.blow !== 0x64)) fail(`0x426e1e writes 0x64 on every path; saw ${blows(bolts.seen)}`);
// and it flies FLAT: 0x426cbc gives the class no weight at all
// ...until it lands a blow: the hit pass (`0x42fc10` → `0x430350`) trades
// velocities with what it struck (`0x430470`) and marks it, and the bolt flies
// that frame's move on the traded velocity before its think lets it go
if (bolts.seen.some((s) => !s.spent && s.vy !== 0)) fail(`0x42f850(obj, 0) — a bolt has no weight; saw vy ${[...new Set(bolts.seen.filter((s) => !s.spent).map((s) => s.vy))].join(",")}`);
if (!bolts.seen.some((s) => Math.abs(s.vx) === 46)) fail(`dx 600 over 13 is 46 a frame; saw ${[...new Set(bolts.seen.map((s) => s.vx))].join(",")}`);
ok(`the bishop's bolt flies — ${bolts.seen.length} frames, cels ${boltCels.join(",")}, 46 a frame and worth a hundred`);

// ---- 8 — the boss's fireball, which is the one thing that BOUNCES ---------
//
// `0x456264`/`0x456272` are the only calls to `0x42f7f0` and `0x42f7a0` that
// matter: a restitution of 0.8 through a scale of -8192 and a friction of 0.25
// through +8192. Everything else in this file is weightless or lands once.
await h.load("level=4&x=4200&damage=1&foehit=1");
standBy("initwbooly", "PLAYGR x4200", true);
const balls = sweep(320, "initwbooly", { min: 200, max: 330 }, true, 1);
if (!balls.seen.length) fail(`the boss threw nothing in 320 samples (it was in the room ${balls.met} times) — 0x456240 is not being called`);
const ballCels = cels(balls.seen);
if (ballCels.some((c) => c < 7010 || c > 7019)) fail(`a fireball is cels 7010..7019; saw ${ballCels.join(",")}`);
/**
 * ...and the bounce itself. `0x42ff83` turns the vertical velocity round
 * through `obj+0x20`, and the scale that word is stored through is NEGATIVE —
 * so a fireball that has been falling is seen rising, on a thing whose weight is
 * pulling it down every frame.
 */
const fell = balls.seen.findIndex((s) => s.vy > 5);
const rose = fell < 0 ? -1 : balls.seen.slice(fell).findIndex((s) => s.vy < 0);
if (rose < 0) fail(`a fireball bounces: after falling it must come back up. vy went ${balls.seen.map((s) => s.vy).join(" ")}`);
if (ballCels.every((c) => c < 7016)) fail(`0x45566e puts the burst on where it lands; saw only ${ballCels.join(",")}`);
ok(`the boss's fireball BOUNCES — ${balls.seen.length} frames, cels ${ballCels.join(",")}, and vy turned round`);
// ...and a slow one is worth nothing: `0x4556d3` wants fifteen in one axis
for (const s of balls.seen) {
  const fast = Math.abs(s.vx) >= 15 || Math.abs(s.vy) >= 15;
  if (fast && s.blow !== 0x64) fail(`a moving fireball is a hundred; saw ${s.blow} at vx ${s.vx} vy ${s.vy}`);
  if (!fast && s.blow !== 0) fail(`0x45570c zeroes a slow one; saw ${s.blow} at vx ${s.vx} vy ${s.vy}`);
}
ok(`...and every one of them followed 0x4556d3 — a hundred while it moves, nothing when it does not`);

// ---- 9 — kragg's volley, which STEERS ------------------------------------
//
// `0x442290` is the only think in the game that builds a velocity delta every
// frame: twenty along the facing and a tenth of the gap to a point forty-five
// above the player, both through the class's divisor of five. So a shot leaves
// at a standstill — `0x474cc0` carries no stride on any of its three cels —
// and is doing twenty a frame five seconds later.
// x783 on the floor at y8316, west of it with the room's whole west end
// (x5..1845) to back into
await h.load("level=8&x=783&y=8316&damage=1&foehit=1");
standBy("initkragg", "ARCADE x783", true);
/**
 * It spits at a man STANDING STILL and at nobody else.
 *
 * `0x440e0b` — band 1, 150…250 — wants `out+0` to be exactly 2, which
 * `0x45f00c` writes only when the target is carrying no horizontal velocity at
 * all. So: no facing tap, and a long enough pace that the still frames
 * outnumber the walking ones.
 */
const shots = sweep(320, "initkragg", { min: 160, max: 240 }, false, 2);
if (!shots.seen.length) fail(`kragg threw nothing in 320 samples (it was in the room ${shots.met} times) — 0x4420c0 is not being called`);
const shotCels = cels(shots.seen);
if (shotCels.some((c) => c < 1000 || c > 1002)) fail(`its shot is cels 1000..1002; saw ${shotCels.join(",")}`);
if (shots.seen.some((s) => s.blow !== -2)) fail(`0x44236d is -2, a code and not a blow; saw ${blows(shots.seen)}`);
// and it accelerates: something must have been seen doing more than the four a
// frame one call of 0x42f8b0 adds
const fastest = Math.max(...shots.seen.map((s) => Math.abs(s.vx)));
if (fastest <= 4) fail(`a shot leans in four a frame and keeps leaning; the fastest seen was ${fastest}`);
ok(`kragg's volley steers — ${shots.seen.length} frames, cels ${shotCels.join(",")}, worth -2, up to ${fastest} a frame`);

/**
 * ...and the hardcore's lob is WIRED but not watched here.
 *
 * `HARDCORE_THROW` is read out of `0x43d190` like the rest, and SERVICE places
 * exactly one hardcore — on a perch at y7872, six hundred pixels above the
 * floor the level spawns anybody on. Getting a probe next to it means walking
 * SERVICE's own route up, which is `service.ts`'s job and not this file's.
 */

pass(`nine classes' throws watched, the bounce and the steer among them`);
