/**
 * RAVECAVE — level eleven, and the level that asks for no kills at all.
 *
 *   npx tsx tools/runmachine.mts ravecave      (from skullcracker/)
 *
 * Chapter three's third stage stores the whole census as its allowance
 * (`0x4218ca`), so no count is asked for — but its end test asks for the
 * wraith instead: `0x4219e5` reads `[0x46ece0]` and nothing else, and only the
 * named wraith's fatal blow writes it (`0x4250eb`). What is in it that is new:
 *
 *   - **Igor** (`0x41ee40`), three of them and all three here. Two hundred
 *     health, 350 points, and a retreat script — `0x46fea0`, five records whose
 *     every dx is NEGATIVE, the walk run backwards.
 *   - **the wraith** (`0x41ec80`), of which the game has exactly one. Seven
 *     hundred health, and worth **nothing**: `0x424f80` has no `0x40d450` in it
 *     anywhere, which no other class in the game can say.
 *   - **the scepter** (`statscepter`), the fourth chapter weapon, whose pickup
 *     arms you with `0x45eed0(0x10)` — weapon 16, not 17.
 */
import { fail, headless, ok, pass } from "./harness";
import { FOES } from "../../src/foes";
import { GUN_CODES, WEAPONS } from "../../src/guns";
import { WRAITH, WRAITH_BEAM, wraith, wraithGate } from "../../src/brains/wraith";
import {
  TICK_SCALE,
  type BrainCtx,
  type CastKit,
  type Enemy,
} from "../../src/brains/kit";

/**
 * The wraith's machine on its own: handed a stand-in context and called
 * once an engine frame, as `stepFight` calls it.
 */
const machines = (): void => {
  const casts: CastKit[] = [];
  const said: number[] = [];
  let band = 0;
  let rolled = 1;
  const k = {
    player: { x: 0, y: 100, top: 0, anchor: 100, vy: 0, swinging: false, down: false, facing: 1 },
    anchorY: (e: Enemy) => e.y,
    anchorX: (e: Enemy) => e.x,
    shake: () => {},
    flash: () => {},
    burn: () => {},
    spray: () => {},
    track: () => ({ forward: 50, dy: 0, band, side: 1 }),
    roll: () => rolled,
    count: () => 1,
    say: (_e: Enemy, id: number) => said.push(id),
    cast: (_e: Enemy, kit: CastKit) => casts.push(kit),
    hatch: () => undefined,
  } as unknown as BrainCtx;
  const f = FOES.initwraith;
  const one = (script: number, tag = 0): Enemy => ({
    kind: "initwraith",
    x: 0,
    y: 0,
    facing: 1,
    left: -500,
    right: 500,
    top: -500,
    bottom: 500,
    clock: 0,
    state: "gait",
    anim: WRAITH.hover,
    linger: 0,
    dents: 0,
    vx: 0,
    vy: 0,
    hp: 700,
    max: 700,
    script,
    tag,
    decisions: 1,
    fighting: true,
  });

  // `0x4248e9` through `0x42f8b0`: ten over the divisor is one pixel a frame
  // more every frame sideways, and twenty is two down towards a lower player
  const drift = one(1);
  wraith(drift, f, 10, k);
  if (Math.abs(drift.vx / TICK_SCALE - 1) > 1e-9 || Math.abs(drift.vy / TICK_SCALE - 2) > 1e-9)
    fail(`0x4248e9 adds 1 and 2 px a frame per frame; got ${drift.vx / TICK_SCALE}, ${drift.vy / TICK_SCALE}`);

  // `0x424c05` — band 4, level with him, claws on tag 0, which goes nowhere
  band = 4;
  const close = one(1);
  close.y = 100;
  wraith(close, f, 10, k);
  if (close.script !== 2 || close.tag !== 0 || close.anim.dx)
    fail(`0x424c05 installs 0x46f6c8 tag 0; got kind ${close.script} tag ${close.tag}`);

  // `0x424d77` — the cast's end lets the beam go, 0x46 in front, with 0x22
  const cast = one(5, 0);
  cast.anim = WRAITH.cast;
  cast.clock = 99;
  wraith(cast, f, 12, k);
  if (casts[0] !== WRAITH_BEAM || !said.includes(0x22) || WRAITH_BEAM.ahead !== 0x46)
    fail(`0x424d77 calls 0x41f6b0(self, 0) as tag 0 ends; casts ${casts.length}, said ${said.join(",")}`);

  // `0x424e14` — the take ends in a split on a roll under 3, for the named one
  const hit = one(7);
  rolled = 2;
  wraith(hit, f, 4, k);
  if (hit.script !== 6) fail(`0x424e14 splits on 0x434540(10) < 3; went to kind ${hit.script}`);
  const lesser = one(7);
  lesser.decisions = 0;
  lesser.side = 0;
  wraith(lesser, f, 4, k);
  if (lesser.script !== 1) fail(`a lesser wraith does not split (AI+4 clear); went to kind ${lesser.script}`);

  // `0x42503d` — any blow ends a lesser one, and the named one takes it whole
  const struck = one(1);
  struck.decisions = 0;
  if (wraithGate(struck, f, { damage: 40, code: 0 }) !== null || struck.state !== "dead")
    fail(`0x42503d sends a lesser wraith straight to its death`);
  if (!wraithGate(one(1), f, { damage: 40, code: 0 }))
    fail(`the named wraith's blow goes on to the subtraction`);
  if (f.flinch?.[0].cels.join() !== "3243" || f.death?.cels[0] !== 3200 || f.linger !== 0)
    fail(`0x46f898 is the take and 0x46f8a8 the death, and no body is left`);
  ok(
    `the wraith drifts at 1 and 2 px/frame², claws in place, casts off itself, splits on a take, and its lessers die to one blow`,
  );
};

machines();

const h = await headless("level=11");
const { game } = h;
const go = async (x?: number): Promise<void> => {
  await h.load(`level=11${x === undefined ? "" : `&x=${x}`}`);
  h.until(() => game.p.onGround, 60);
  h.frame(4);
};
const nearest = (kind: string): Enemy | undefined =>
  game
    .spawnedHere()
    .filter((e) => e.kind === kind)
    .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];
// every cel the fought kind showed, by the state it was in
const seen = new Map<string, Set<number>>();
const note = (e: Enemy): void => {
  // the igor's kind 5 is its fall death (`0x42545e`), played by its own
  // machine while the state still has it on its feet
  const key = `${e.kind} ${e.kind === "initigor" && e.script === 5 ? "fell" : e.state}`;
  (seen.get(key) ?? seen.set(key, new Set()).get(key)!).add(game.celOf(e));
};
const tap = (key: "left" | "right", frames = 1): void => {
  h.hold(key, true);
  h.frame(frames);
  h.hold(key, false);
};
/** fight the nearest of a kind to the death and watch it play out; what it paid */
const fight = (kind: string, frames: number, low = false): number => {
  const before = game.stats.score;
  const foe = nearest(kind);
  if (!foe) fail(`no ${kind} near x${game.p.x}`);
  let blows = 0;
  for (let i = 0; i < frames; i++) {
    note(foe);
    if (foe.state === "dead") break;
    const d = foe.x - game.p.x;
    /**
     * Kick and punch in turn, from where a body lets you stand. `0x4029e0`
     * takes 5 off the strength for every frame of a kick repeated inside four
     * seconds, floor 20, and changing move puts it back to 100 (`0x402a5a`);
     * and `0x430680` holds an Igor's body well off the player's anchor, with
     * the kick's box hanging 95..125 ahead of it.
     */
    if (game.p.act) h.frame();
    else if (Math.abs(d) < 160 && Math.sign(d) !== game.p.facing) {
      // ...facing it: it gets round you, the wraith especially, and a blow
      // thrown the other way lands on nothing. A tap turns the player
      tap(d > 0 ? "right" : "left");
    } else if (low && Math.abs(d) < 90) {
      /**
       * ...and inside that, on the Igor, it is the DUCKING kick and punch. Its
       * body holds it some 55 pixels off (`0x430680`), under the standing
       * boxes, and inside 80 it only swipes (`0x4253bb`) — so standing, the two
       * of them trade blows that land on nothing.
       */
      h.hold("down", true);
      h.frame();
      h.press(blows++ % 2 ? "punch" : "kick");
      h.frame(6);
      h.hold("down", false);
    } else if (Math.abs(d) < 160) {
      h.press(blows++ % 2 ? "punch" : "kick");
      h.frame();
    } else tap(d > 0 ? "right" : "left");
  }
  // ...and watch the death play out before leaving
  for (let j = 0; j < 20; j++) {
    note(foe);
    h.frame();
  }
  if (foe.state !== "dead" && !seen.has(`${kind} dead`) && !seen.has(`${kind} fell`))
    fail(`the ${kind} was still standing after ${frames} frames: ${foe.hp}/${foe.max}`);
  return game.stats.score - before;
};

// 1. four regions, a census of four, and a share of nothing
await go();
if (game.level!.rooms.length !== 4) fail(`RAVECAVE has four regions; it has ${game.level!.rooms.length}`);
if (game.mission().kill !== 0 || game.stats.census !== 4)
  fail(`three Igors and one wraith count and its 27 bats do not; the census is kill ${game.mission().kill} of ${game.stats.census}`);
if (game.stats.census - game.stats.allowance !== 0)
  fail(`a share of nothing leaves the whole census standing: allowance ${game.stats.allowance} of ${game.stats.census}`);
if (game.goalReady() || game.waitsFor() !== "the wraith")
  fail(`no count is asked for, but 0x4219e5 waits for [0x46ece0] — the goal is ${game.goalReady() ? "open" : "shut"}, waiting for ${game.waitsFor()}`);
ok(`RAVECAVE is four regions, a census of four, and a level that asks for no kills — only the wraith`);

// 2. its own clock — 2500, out of the timer record at x7914
if (game.stats.clockFull !== 2500) fail(`RAVECAVE's timer record carries 2500; the clock is full at ${game.stats.clockFull}`);
const clock = Math.round(game.stats.ticks);
if (clock < 2400 || clock > 2500) fail(`RAVECAVE's timer record carries 2500; the clock reads ${clock}`);
ok(`and its timer record gives it ${clock} frames`);

// 3. Igor: two hundred health, 350 points
await go(9080);
h.frame(9);
{
  const igor = nearest("initigor");
  if (!igor || igor.hp !== 200 || igor.max !== 200) fail(`0x41ee8e gives it 0x40e300(0xc8); it has ${igor?.hp}/${igor?.max}`);
}
const igorPay = fight("initigor", 900, true);
if (igorPay !== 350)
  fail(`0x4257c5 pays 0x15e for an Igor; the score rose ${igorPay} (seen ${[...seen].map(([k, v]) => `${k}: ${[...v].join(" ")}`).join("; ")})`);
ok(`an Igor is two hundred health and ${igorPay} points`);
/**
 * ...and what a blow shows on it: `0x4257eb` installs `0x46ff80`, one cel —
 * 3100 or 3140 — and `0x4257b5` the death, `0x46ffd8`, 3140..3145. Its throw
 * (3120..3124) is not a reaction to anything.
 */
const igorTake = [...(seen.get("initigor flinch") ?? [])];
/**
 * ...or it died of a FALL: every blow shoves it (`0x430470`), its retreat
 * (kind 3) walks backwards with no edge test, and past 200 of fall `0x425296`
 * installs `0x46ff98` — cel 3100 held, then 3140..3145, and the same 350 booked
 * at `0x4254d8`. Either death is the Igor's own.
 */
const fell = [...(seen.get("initigor fell") ?? [])];
const igorDeath = [...(seen.get("initigor dead") ?? [])];
if (!igorTake.length) fail(`an Igor should flinch under the kicks; saw no flinch cel`);
if (igorTake.some((c) => c !== 3100 && c !== 3140)) fail(`0x46ff80 is cel 3100 or 3140; the flinch showed ${igorTake.join(" ")}`);
if (igorDeath.length ? igorDeath.some((c) => c < 3140 || c > 3145) : !fell.length)
  fail(`0x46ffd8 is 3140..3145; the death showed ${igorDeath.join(" ") || "nothing"}`);
if (fell.some((c) => c !== 3100 && (c < 3140 || c > 3145))) fail(`0x46ff98 is 3100 and then 3140..3145; the fall showed ${fell.join(" ")}`);
ok(`...its take is ${igorTake.join("/")} and its death ${igorDeath.length ? igorDeath.sort().join(" ") : `a fall, ${fell.sort().join(" ")}`}`);

// 4. the wraith — seven hundred, and nothing for it
await go(13000);
h.frame(9);
{
  const w = nearest("initwraith");
  if (!w || w.hp !== 700 || w.max !== 700) fail(`0x41ece3 gives it 0x40e300(0x2bc); it has ${w?.hp}/${w?.max}`);
}
const wraithPay = fight("initwraith", 2000);
// ...and it leaves no body: state 8 answers 1 the frame its dissolve ends
// (`0x424ec5`), so "dead" is something to have SEEN rather than to find
if (!seen.has("initwraith dead")) fail(`never felled the wraith`);
if (wraithPay !== 0) fail(`0x424f80 pays nothing at all; the score moved by ${wraithPay}`);
ok(`the wraith is seven hundred health and pays nothing — the only class in the game that does`);
if (!game.goalReady()) fail(`the named wraith's fall writes [0x46ece0] (0x4250eb), which is all 0x4219e5 asks; the goal is still shut`);
ok(`...and its fall is what opens the goal`);
/**
 * ...and the two reactions are the right way round: `0x4250fa` installs
 * `0x46f898`, cel 3243 alone, for a blow it survives, and `0x4250d9` the
 * nine-cel dissolve `0x46f8a8` for the one that empties it.
 */
const wraithTake = [...(seen.get("initwraith flinch") ?? [])];
if (!wraithTake.length || wraithTake.some((c) => c !== 3243))
  fail(`0x46f898 is cel 3243 alone; the flinch showed ${wraithTake.join(" ") || "nothing"}`);
const wraithDeath = [...(seen.get("initwraith dead") ?? [])];
if (!wraithDeath.length || wraithDeath.some((c) => c < 3200 || c > 3208))
  fail(`0x46f8a8 is 3200..3208; the death showed ${wraithDeath.join(" ")}`);
ok(`...a blow it survives shows 3243 and the death dissolves on ${wraithDeath.sort().join(" ")}`);

// 5. the scepter, which arms you with weapon SIXTEEN and not seventeen:
//    `0x428950`'s case pushes 0x10 outright rather than the code it was given
await go(13600);
{
  const g = game.gunAhead();
  if (!g || GUN_CODES[g.code]?.name !== "statscepter" || g.x !== 13690 || g.y !== 9840)
    fail(`the scepter at x13690, y9840 should be in reach from x13600; in reach is ${g && GUN_CODES[g.code]?.name}`);
}
h.hold("down", true);
h.until(() => game.inv.armed, 20);
h.hold("down", false);
h.frame(5);
if (!game.inv.armed || game.inv.weapon !== 16 || game.roundsIn(16) !== 1 || WEAPONS[16]?.max !== 160)
  fail(`0x45eed0(0x10) arms you with one round of 160; it holds ${game.inv.weapon} with ${game.roundsIn(game.inv.weapon)}`);
const idle = new Set<number>();
for (let i = 0; i < 9; i++) {
  h.frame();
  idle.add(game.lastCel);
}
if (!idle.has(3300)) fail(`the scepter's own idle is 0x470c40 tag 8, cel 3300; saw ${[...idle].join(" ")}`);
ok(`and the scepter arms you as weapon 16, on its own moveset`);

/**
 * ...and the wraith has a MACHINE.
 *
 * `0x424800` reads the same tracker the claw does and bands it against
 * `0x46f8f8` — 700, 230, 130, 60. Inside sixty it does nothing but hang there
 * (`0x424c07`); between sixty and 230 it picks a move; over 230 it closes.
 */
await go(12900);
const modes = new Set<string>();
let beam = false;
let beamFar = "";
for (let i = 0; i < 300; i++) {
  const w = nearest("initwraith")!;
  if (w.script !== undefined) modes.add(`${w.script} tag ${w.tag ?? 0}`);
  /**
   * The beam is a thing in the LEVEL, planted off the wraith (`0x424620` puts
   * it at the caster's x ± 0x46) — never one of the player's own held streams.
   */
  for (const c of game.casts) {
    const cel = game.castCel(c);
    if (cel < 3270 || cel > 3279) continue;
    // where it was planted, the frame it appears
    if (!beam && Math.abs(c.x - w.x) > 0x46 + 40) beamFar = `cel ${cel} at x ${Math.round(c.x)}, wraith at x ${Math.round(w.x)}`;
    beam = true;
  }
  if (game.streams.some((s) => { const c = game.streamCel(s); return c >= 3200 && c < 3300; }))
    fail(`the wraith's beam is not the player's stream`);
  /**
   * ...and walk at it, because the bands are what decide. `0x46f8f8` is 700 /
   * 230 / 130 / 60, and the cast is band 3 — between sixty and a hundred and
   * thirty. Standing at x12900 keeps it in band 2 for ever, where all it does is
   * shudder on a beat.
   */
  if (Math.abs(w.x - game.p.x) > 90) tap(w.x > game.p.x ? "right" : "left");
  else h.frame();
}
/**
 * TWO is the shape, not three. `0x4248e9` is bands 0 and 1 and it installs no
 * script at all — it pushes a drift through `0x42f8b0` and lets the hover keep
 * looping — so a wraith held at arm's length only ever shows kind 1 and the
 * kind 3 shudder band 2 gives it on a beat. The teleport, the cast and the
 * split are bands 3 and 4, and band 4's claw also wants `AI+4`, the one-bit
 * rank.
 */
if (modes.size < 2) fail(`it should work through its own states; it only did ${[...modes].join(", ")}`);
/**
 * ...and there is no "close" state to ask for: the wraith has no walk. What IS
 * a state is the cast, kind 5, and the beam it ends on.
 */
if (!beam) fail(`0x424d77 calls the scepter's own fire function; no beam ever came out (states ${[...modes].join(", ")})`);
if (beamFar) fail(`0x424620 plants the beam 0x46 in front of the WRAITH; saw ${beamFar}`);
ok(`and it works its own bands — ${[...modes].sort().join(" ")} — and casts the scepter's beam`);

/**
 * ...and inside sixty it only HOVERS, and it takes hold of nothing.
 *
 * `0x424c54` writes -3 into its strength and that reads like the grab, but
 * `0x4248a9` is the function's only exit and writes a hundred back before it
 * returns. Both -3 writes are dead in the shipped binary.
 *
 * `0x424bd1` is band 4 and it is not a dead end: it hangs there unless it is
 * level with the player, within fifty pixels of his row and carrying `AI+4`,
 * the one-bit rank — and then it claws, kind 2 tag 1, the only script in the
 * class with a stride on it. What it still does NOT do is take hold of you.
 */
await go(13000);
let hovered = false;
const grabCode = Object.values(game.BLOW_CODES).find((r) => r.code === -3)?.act;
for (let i = 0; i < 110; i++) {
  if (game.p.heldBy || (grabCode && game.p.act === grabCode))
    fail(`the wraith's -3 is overwritten by 0x4248ad; it should hold nothing`);
  // kind 1 is `0x46f698`, the hover; kind 2 tag 1 is `0x46f6c8`, the claw
  const w = nearest("initwraith");
  if (w && (w.script === 1 || w.script === 2)) hovered = true;
  h.frame();
}
if (!hovered) fail(`inside sixty it should hover, or claw when level with you (0x424bd1)`);
ok(`...and inside sixty it hovers or claws, and takes hold of nothing — 0x4248ad writes 100 back`);

pass("RAVECAVE's Igors, its one wraith and its scepter are all where the records put them");
