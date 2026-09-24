/**
 * What a blow does: the spray, the flinch, the death, and the body.
 *
 *   npx tsx tests/machine/foes.ts        (from skullcracker/)
 *
 * `skullcracker/src/foes.ts` has every class's numbers and the four addresses
 * each one was read from, and `src/effects.ts` has the spray. What this asserts
 * is that they happen in the running game:
 *
 *   - **the spray.** `0x40cba0` throws one gob per six points of damage, up to
 *     twenty, out of `PLAYER.SBK`'s cels 18200..18202. So a punch must put gobs
 *     in the world where there were none.
 *   - **the damage.** A punch is cel 602's own `dx 47` and the kick's cel 663 is
 *     55 (`0x42f910` takes the magnitude of the pair at the cel record's +20), so
 *     a 250-health punk takes six punches. Any rule of the "n blows and it dies"
 *     kind fails the pair of assertions below.
 *   - **the death.** A punk pays 220 (`0x44f1db`), so the score must move by
 *     exactly 220.
 *   - **the body's fifty frames.** `[0x46b204]` is 50 and the corpse lies there for
 *     all of them, but it leaves the CENSUS at once (`0x44ef3e` calls
 *     `0x42f870(obj, 0)` on the first dead frame), so the quota moves on the
 *     killing blow and the body outlives it.
 *   - **the census itself.** Eleven, not twenty: `0x42f870(obj, 1)` is what
 *     enrols a thing and only the were-punks call it.
 *   - **where the goo ends up.** `0x40c480` switches a gob to its falling cels the
 *     frame `vy` turns positive and freezes it where it lands, so a few seconds
 *     later every gob is a puddle on the FLOOR. And only the creatures throw
 *     any: a mailbox's handler never calls `0x40cba0`.
 *   - **the green ball.** A punk's body leaves one when its fifty frames expire —
 *     `0x40cba0`'s −13 branch. A rat's launch does not: that call is in the punk
 *     classes' corpse handlers and nowhere else.
 *   - **either side.** A blow has to land walking west as well as east. The
 *     player's cel is flipped within its drawn band, so the strike box mirrors
 *     inside the cel; reflecting it about the anchor — which is what the engine's
 *     own rect builder does — puts the kick's box 165px behind the player, because
 *     cel 663's anchor is outside its own art.
 *   - **the mailbox flies.** `obj+0xe` is a mass as well as a divisor and
 *     `0x430470` is an elastic collision, so a kick throws a 7 against the
 *     player's 12 most of a screen width.
 */
import { gobCount } from "../../src/effects";
import { FOES } from "../../src/foes";
import { FPS, fail, headless, ok, pass } from "./harness";

/** STREETS' first `initwerea` patrols x2197..2584; this stands inside its reach */
const AT_A_PUNK = 2300;

const h = await headless(`level=1&x=${AT_A_PUNK}`);
const { game } = h;
type Enemy = ReturnType<Game["spawnedHere"]>[number];
type Game = typeof game;

const quota = (): number => Math.max(0, game.aliveNow() - game.stats.allowance);
const nearestPlated = (): Enemy | undefined =>
  game
    .spawnedHere()
    .filter((e) => FOES[e.kind].panel)
    .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];
const nearestOf = (kind: string): Enemy | undefined =>
  game
    .spawnedHere()
    .filter((e) => e.kind === kind)
    .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];
/**
 * A fresh start, as each browser page was: and that includes `0x4029e0`'s
 * memory of the last move, which weakens a repeated blow for four seconds of
 * the engine's clock and would otherwise carry over from the last section.
 */
const at = async (query: string, settle: number): Promise<void> => {
  game.blow.move = -1;
  await h.load(query);
  h.frame(settle);
};
/** one blow, and the gobs it threw */
const blow = (key: "punch" | "kick"): number => {
  const before = game.gobs.length;
  h.hold(key, true);
  h.frame(1);
  h.hold(key, false);
  h.frame(3);
  const after = game.gobs.length;
  h.frame(2);
  return after - before;
};
/**
 * ...and a punk does not stand still to be hit.
 *
 * `0x44eeb5`, its flinch state, rolls a coin and half the time installs
 * `0x4771a0` tag 0 — three cels of walking backwards at -225 — and the fight
 * state answers a swing the same way. So this steps after it.
 */
const closeIn = (): void => {
  const it = nearestPlated();
  if (!it) return;
  const gap = it.x - game.p.x;
  if (Math.abs(gap) < 40) return;
  const key = gap > 0 ? "right" : "left";
  h.hold(key, true);
  h.frame(Math.max(1, Math.min(6, Math.round((Math.abs(gap) * 3) / 66))));
  h.hold(key, false);
  h.frame(1);
};

h.frame(9);

// 1. the census is the four punk classes and nothing else
if (game.stats.census !== 11)
  fail(`STREETS' census is ${game.stats.census}; only its 8 werea and 3 wereb enrol through 0x42f870(obj, 1)`);
ok(`STREETS enrols ${game.stats.census} — the punks, not the rats or the furniture`);

const score0 = game.stats.score;

// 2. a punch sprays goo — one gob per six of the damage it did: cel 602's 47
//    throws seven, and the second punch's cel 604 a few more for its own pair
const first = nearestPlated()!;
let sprayed = 0;
let dealt = 0;
for (let i = 0; i < 4 && sprayed === 0; i++) {
  const hp = first.hp;
  sprayed = blow("punch");
  dealt = hp - first.hp;
}
if (!dealt) fail(`four punches never landed on the punk at x${Math.round(first.x)}`);
if (sprayed !== gobCount(dealt)) fail(`a punch of ${dealt} should throw ${gobCount(dealt)} gobs (0x40cba0, damage/6); it threw ${sprayed}`);
ok(`a punch sprays goo: ${sprayed} gobs for its ${dealt} damage, one per six`);

// 3. a punch is 47 against a punk's 250, so four of them cannot fell it. This
//    is the assertion that damage is the CEL's number and not a share of the
//    victim's health: any "n blows and it dies" rule fails here.
const punk = nearestPlated()!;
for (let i = 0; i < 3; i++) {
  closeIn();
  blow("punch");
}
if (game.stats.score !== score0) fail(`punches felled a punk: four of them is 188 against the 250 its creator gives it`);
ok(`four punches leave a 250-health punk standing (${Math.round(punk.hp)}/${punk.max})`);

// 4. and the sixth one does fell it, for the class's own award
for (let i = 0; i < 14 && game.stats.score === score0; i++) {
  closeIn();
  blow("punch");
}
const paid = game.stats.score - score0;
if (paid !== 220) fail(`felling a punk paid ${paid}; 0x44f1db pushes 220 to 0x40d450`);
ok(`the sixth punch fells it and pays the class's own award, ${paid}`);

// 5. the census drops on the killing blow, not when the body goes: the corpse
//    state handler calls `0x42f870(obj, 0)` on its first frame (`0x44ef3e`),
//    fifty frames before the object itself is removed.
const left = quota();
if (left !== 7) fail(`the quota should drop to 7 of 8 on the killing blow; it reads ${left}`);
const body = game.spawnedHere().find((e) => e.state === "dead");
if (!body) fail(`the body should still be lying there on the killing frame`);
ok(`and the quota drops the moment it dies, ${left} left, with the body still down`);

// 6. fifty frames later the body has gone, it left the green ball as it went,
//    and the goo has stopped flying — every gob is a puddle on the ground
let popped = false;
const gone = h.until(() => {
  if (game.pops.length) popped = true;
  return !game.spawnedHere().includes(body!);
}, 90);
if (gone < 0) fail(`the body outlived its fifty frames ([0x46b204])`);
if (!popped && !game.pops.length) fail(`a punk's body leaves the green ball as it goes (0x40cba0 -13, 0x44ef7e)`);
h.frame(FPS * 5);
const flying = game.gobs.filter((g) => g.stage < 0).length;
if (game.gobs.length && flying) fail(`${flying} of ${game.gobs.length} gobs are still in the air after five seconds; 0x40c480 freezes them where they land`);
ok(`the body goes after its fifty frames in a green ball, and the goo lies where it fell (${game.gobs.length} puddles, none flying)`);

/**
 * 7. furniture does not bleed. `0x44fe80` fetches the blow, installs a dent and
 *    plays a sound, and never calls `0x40cba0` — so a mailbox makes no mess.
 *    STREETS' second mailbox, at x6906, has clear ground around it.
 */
await at("level=1&x=6860", 8);
const box7 = nearestOf("initmailbox");
if (!box7) fail(`no mailbox near x6860`);
const dents7 = box7!.dents;
let thrown = 0;
for (let i = 0; i < 6; i++) {
  const g0 = game.gobs.length;
  h.press("punch");
  h.frame(3);
  thrown += Math.max(0, game.gobs.length - g0);
}
if (box7!.dents === dents7) fail(`six punches never reached the mailbox at x6906`);
if (thrown) fail(`hitting a mailbox threw ${thrown} gobs; only the creatures call 0x40cba0`);
ok(`and a mailbox does not bleed`);

/**
 * 8. a rat down its hole cannot be hit at all, and out of it can.
 *
 * This is the check that says the boxes are the disc's AUTHORED rects and not
 * the drawn cels. `0x450a3a` births a rat on `0x476f48` tag 0 — cels 3010 and
 * 3011, the thing still underground — and neither of those carries a body
 * rect, where 3000, 3003 and 3004, the ones it stands up on, all do. A page
 * that boxed art by its extent would make a hole-bound rat 54 by 102 and kill
 * it through the pavement with a standing punch.
 *
 * What brings it out is `0x44e0e6`, the one place `0x44e010` looks at the
 * player: it compares his x with its own and goes back down unless he is to
 * its EAST.
 */
await at("level=1&x=2060", 6);
const rat = nearestOf("initrat");
if (!rat) fail(`no rat near x2060`);
const buriedCel = (): boolean => [3010, 3011].includes(game.celOf(rat!));
// ...and it may be halfway through a peek (`0x44e0d7`'s look, tag 2)
if (h.until(buriedCel, 60) < 0) fail(`a rat should start down its hole on 0x476f48 tag 0; cel ${game.celOf(rat!)}`);
const ratHp = rat!.hp;
const buried = game.spawnedHere().length;
for (let i = 0; i < 10 && buriedCel(); i++) {
  // ...for as long as it stays down: one that has come out can be hit
  h.press("punch");
  h.frame(2);
  if (!buriedCel()) break;
  h.press("kick");
  h.frame(2);
  if (buriedCel() && (rat!.hp !== ratHp || game.spawnedHere().length !== buried))
    fail(`a rat down its hole was hit; cels 3010 and 3011 carry no body rect at all`);
}
ok(`a rat down its hole cannot be hit — its cels carry no box`);

// 9. and a rat leaves no green ball. That effect is `0x40cba0`'s −13 branch and
//    only the punk classes' CORPSE handlers call it (`0x44ef7e`, `0x44f848`); the
//    rat's launch ends with the object simply gone. So kill one outright, the
//    class's own way, and watch it go.
if (FOES.initrat.vanishes) fail(`FOES.initrat says its corpse vanishes in a ball; only the punks' do`);
const pops0 = game.pops.length;
game.killFoe(rat!, FOES.initrat);
const ratGone = h.until(() => !game.spawnedHere().includes(rat!), 120);
if (ratGone < 0) fail(`a killed rat never left the room`);
h.frame(2);
if (game.pops.length > pops0) fail(`a rat left a green ball; only the punks' corpses do that`);
ok(`and a dead rat leaves no green ball behind`);

// 10. a kicked mailbox flies. `0x430470` is an elastic collision with `obj+0xe`
//     as the mass — the player 12, a mailbox 7 — so a kick's 55 leaves it at
//     69 pixels a frame and it crosses most of a screen before the ground drags
//     it down. The mailbox's own stretch of street is x3470..3580.
const MAILBOX = { left: 3470, right: 3580 };
await at("level=1&x=3455", 8);
const box10 = game.spawnedHere().find((e) => e.kind === "initmailbox" && e.x >= MAILBOX.left && e.x <= MAILBOX.right);
if (!box10) fail(`no mailbox standing at x${MAILBOX.left}..${MAILBOX.right} to kick`);
const stood = Math.round(box10!.x);
for (let i = 0; i < 3; i++) {
  h.press("kick");
  h.frame(5);
}
h.frame(18);
const flew = Math.round(box10!.x);
if (flew >= MAILBOX.left && flew <= MAILBOX.right) fail(`the kicked mailbox did not travel: x${stood} -> x${flew}`);
ok(`a kicked mailbox leaves its own stretch of street: x${stood} -> x${flew}`);

// 11. and a blow lands the same going left. The player's cel is drawn centred on
//     `p.x` and flipped WITHIN that band, so the strike box has to be mirrored
//     inside the cel and not about the anchor — cel 663's anchor is at
//     `posX -12`, outside its own art, and reflecting about it put the kick's box
//     165 pixels BEHIND the player. Approaching the same punk from each side is
//     the only assertion that catches that.
const reach = async (from: number, dir: "right" | "left"): Promise<boolean> => {
  await at(`level=1&x=${from}`, 6);
  const it = nearestOf("initwerea");
  if (!it) fail(`no werea near x${from}`);
  const full = it!.hp;
  for (let i = 0; i < 30; i++) {
    h.hold(dir, true);
    h.frame(2);
    h.hold(dir, false);
    h.press("kick");
    h.frame(3);
    if (it!.hp < full) return true;
  }
  return false;
};
if (!(await reach(2150, "right"))) fail(`a kick never landed walking east into the punk`);
if (!(await reach(2650, "left"))) fail(`a kick never landed walking west into the punk — the box is mirrored wrong`);
ok(`and a kick lands from either side`);

/**
 * 11b. a punk knocked down stays down, and gets up on its own cels.
 *
 * `0x477580` is three tags at two frames a cel, and `0x44ee13` chains them:
 * tag 0 falls (1960..1963), tag 1 lies there (1962 1950 1962 1950), tag 2
 * gets up (1951..1957), and `0x44ee90` ends it on the taunt, `0x477240` tag
 * 0 (1930). That is fifteen cels on the floor, in engine frames exactly.
 */
{
  await at("level=1&x=2150", 6);
  const it = nearestOf("initwerea")!;
  const floored = (): boolean => it.state === "flinch" && game.celOf(it) === 1960;
  // a knockdown is a blow over 50 (`0x44f1fd`), and damage is speed: cel 663's
  // pair plus the striker's own `obj+0xc` (`0x42f910`). So the kick goes in
  // while still walking into him, as a player would throw it
  h.hold("right", true);
  h.until(() => it.x - game.p.x < 190, 60);
  h.press("kick");
  const down = h.until(floored, 6) >= 0;
  h.hold("right", false);
  if (!down) fail(`no kick knocked the punk down (cel 1960) to time`);
  const trace: string[] = [];
  let frames = 0;
  while (it.state === "flinch" && frames < 120) {
    trace.push(`${game.celOf(it)}`);
    h.frame();
    frames++;
  }
  const upAs = `${it.state} ${game.celOf(it)}`;
  const cels = trace.filter((c, i) => i === 0 || c !== trace[i - 1]).join(" ");
  if (!/1963 .*1950 .*1951 .*1957/.test(cels)) fail(`a floored punk lies there (1950) and gets up (1951..1957): saw ${cels}`);
  // two frames a cel: fifteen cels is thirty frames on the floor
  const ratio = frames / 2;
  if (!(ratio >= 13)) fail(`a floored punk is down fifteen cels, not ${ratio}: ${cels}, then ${upAs}`);
  if (upAs !== "gait 1930") fail(`0x44ee90 ends the get-up on the taunt, cel 1930; got ${upAs}`);
  ok(`a floored punk stays down ${ratio} cels (${frames} frames), gets up on 1951..1957 and taunts`);
}

/**
 * 12. the hydrant: three blows open the valve, and what bursts out is its own
 *     object beside it while the hydrant stays whole.
 *
 *     `0x44fb20` is unambiguous about this — on the frame tag 3 ends it calls
 *     `0x44fc70(point + 25, facing, 1)` for a SECOND object on the water tag and
 *     `0x45d090(this, 0x477d30, 0)` to put itself back on cel 9700. So: the count
 *     of spawned things has to RISE by one, the hydrant has to still be reading
 *     a hydrant cel while the water plays, and the water has to go on its own.
 */
// a kick's box hangs 95..125 ahead of the player's anchor (`0x40e680`), so
// the valve is kicked from about a hundred short of it, not from on top of it
await at("level=1&x=8480", 6);
const hydrant = nearestOf("inithydrant");
if (!hydrant || game.celOf(hydrant) !== 9700) fail(`no shut hydrant to kick: ${hydrant ? game.celOf(hydrant) : "none"}`);
const before = game.spawnedHere().length;
const water = () => game.spawnedHere().find((e) => e.state === "burst");
// a step, not a stroll: the walk settles at twelve a frame against the drag
h.hold("right", true);
h.frame(1);
h.hold("right", false);
let withWater = 0;
let hydrantCel = 0;
for (let i = 0; i < 4 && !water(); i++) {
  h.press("kick");
  if (h.until(() => !!water(), 8) >= 0) {
    withWater = game.spawnedHere().length;
    hydrantCel = game.celOf(hydrant!);
  }
  h.frame(3);
}
const jet = water();
if (!jet) fail(`three kicks did not burst the hydrant: cel ${game.celOf(hydrant!)}`);
const jetCel = game.celOf(jet!);
if (jetCel < 9800 || jetCel > 9899) fail(`the water plays 98xx; it shows ${jetCel}`);
if (withWater !== before + 1) fail(`the water should be a second object: ${before} spawned, ${withWater} with it`);
if (hydrantCel < 9700 || hydrantCel > 9709) fail(`the hydrant vanished into its own water: cel ${hydrantCel}`);
h.frame(23);
if (game.spawnedHere().length !== before) fail(`the water outstayed its animation: ${game.spawnedHere().length} spawned, was ${before}`);
if (game.celOf(hydrant!) !== 9700) fail(`the hydrant did not shut again: cel ${game.celOf(hydrant!)}`);
ok(`three kicks burst the hydrant into a second object, and it shuts again`);

/**
 * 12b. a mailbox on its side still takes a kick.
 *
 *     `0x44fe60` puts a toppled mailbox in state 2 for good, and `0x44febd`
 *     installs nothing on it — but the handler goes on to play sound 5 and
 *     answer 1 (`0x44fee4`), so the solver hands it the kick's momentum and it
 *     skids off along the street, still on cel 2413. Kicked from a hundred
 *     short of it: the kick's box hangs 95..125 ahead of the anchor.
 */
await at("level=1&x=6795", 8);
const box = nearestOf("initmailbox")!;
for (let i = 0; i < 6 && game.celOf(box) !== 2413; i++) {
  h.press("kick");
  h.frame(10);
}
if (game.celOf(box) !== 2413) fail(`a kick should topple the mailbox onto 2413: cel ${game.celOf(box)}`);
h.frame(22);
if (box.script !== 2) fail(`on its side it is state 2 (0x44fe60): kind ${box.script}`);
// walk up to it, facing it, to where the kick's box (95..125 ahead) reaches
for (let i = 0; i < 80; i++) {
  const d = box.x - game.p.x;
  if (Math.abs(d) < 125) break;
  const key = d > 0 ? "right" : "left";
  h.hold(key, true);
  h.frame(1);
  h.hold(key, false);
  h.frame(2);
}
const from = Math.round(box.x);
let moved = 0;
for (let i = 0; i < 4 && Math.abs(moved) < 20; i++) {
  h.press("kick");
  h.frame(14);
  moved = Math.round(box.x) - from;
}
if (Math.abs(moved) < 20) fail(`a toppled mailbox still answers 1 (0x44fef4) and is knocked along; it stayed at x${from}`);
if (game.celOf(box) !== 2413) fail(`...and stays on its side, cel 2413; showed ${game.celOf(box)}`);
ok(`a mailbox on its side is kicked along the street, x${from} -> x${Math.round(box.x)}, still on 2413`);

/**
 * 12c. ...and a light blow installs nothing at all. `0x44fec8`: under ten the
 *     handler jumps past the install to the sound, so whatever the mailbox was
 *     showing plays on — a topple struck lightly still goes over.
 */
await at("level=1&x=6795", 8);
{
  const m = nearestOf("initmailbox")!;
  const a = game.foeAnchor(m, game.level!)!;
  const box = { left: a.x - 20, right: a.x + 20, top: a.y - 20, bottom: a.y + 20 };
  const strike = (damage: number): void => game.strikeFoe(m, damage, { dx: 5, dy: 0 }, 1, a.y, box, 0);
  strike(5);
  if (m.state !== "gait") fail(`0x44fec8: under ten installs nothing on a standing mailbox; it is ${m.state}`);
  strike(60);
  const topple = m.anim;
  strike(5);
  if (m.anim !== topple || m.clock !== 0) fail(`a light blow mid-topple leaves the topple running: ${m.anim.from}`);
  h.frame(10);
  if (game.celOf(m) !== 2413 || m.script !== 2) fail(`...and it still goes over onto 2413, state 2: cel ${game.celOf(m)}, kind ${m.script}`);
  ok(`a light blow installs nothing — a standing mailbox stands, and a toppling one still goes over (0x44fec8)`);
}

/**
 * 13. ...and the jet does NOT hit.
 *
 *     Six of its ten cels carry a strike box (9802..9807) and five of those a
 *     blow pair — `dx -74` on 9803 and `-125` on the four after it — but the
 *     water object's strength is the allocator's zero (`0x42f5af`): neither
 *     the class (`0x44fa77`), the creator (`0x44fc70`) nor the frame function
 *     (`0x44fb20`) writes `obj+0x1a`, and `0x430367` passes over a hitter
 *     whose strength is zero. Standing in it costs nothing.
 */
await at("level=1&x=8480&foehit=1&damage=1", 8);
if (!game.damageOn) fail(`the damage switch did not come on`);
const full = game.stats.health;
const valve = nearestOf("inithydrant")!;
h.hold("right", true);
h.frame(1);
h.hold("right", false);
// kick it open, then stand in the whole of the jet
let turned = 0;
let jetted = false;
for (let i = 0; i < 6 && !jetted; i++) {
  h.press("kick");
  for (let j = 0; j < 9 && !jetted; j++) {
    h.frame();
    jetted = !!water();
    // the valve HOLDS where the last blow turned it: tags 1 and 2 of
    // `0x477d30` end on their only frame and `0x45d0f0` keeps it there
    if (i === 0 && j === 8) turned = game.celOf(valve);
  }
}
if (!jetted) fail(`the hydrant never burst to stand in: cel ${game.celOf(valve)}`);
if (turned !== 9701) fail(`one kick turns the valve to 9701 and it stays there (0x44fc00); nine frames on it showed ${turned}`);
const reactions = ["downFront", "downBack", "hurtFront", "hurtBack"];
for (let i = 0; i < 12; i++) {
  h.frame();
  if (reactions.includes(game.p.act ?? "")) fail(`the jet has no strength (0x42f5af, 0x430367) and should not hit you: ${game.p.act}`);
}
if (game.stats.health !== full) fail(`standing in the jet cost health: ${full} -> ${game.stats.health}`);
ok(`one kick holds the valve on 9701, and standing in the jet costs nothing`);

pass(`a blow sprays, staggers, fells and leaves a body, all on the disc's own cels`);
