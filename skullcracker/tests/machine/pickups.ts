/**
 * The things you walk over — `stat*`, in every level.
 *
 *   npx tsx tests/machine/pickups.ts        (from skullcracker/)
 *
 * A hundred and forty records across the sixteen levels, all placed by one
 * creator, all drawn from `PLAYER.SBK` rather than the level's book, and all
 * collected by walking into them. No button, no facing, no range band.
 *
 * What the file says, and what this checks:
 *
 *   - **one creator, nine codes.** Each chapter's init hands `0x45b160` a
 *     negative for each name, and `0x45b19a` dispatches on `code + 9`.
 *   - **`statscoreup` is one name and three pickups**, told apart by the
 *     RECORD's own `param` at `0x451420`: −6, −5 and −4, worth 2000, 5000 and
 *     10000.
 *   - **the reach is the record's rect**, which is what `0x45b2ca` hands
 *     `0x434140` — and then the art, `0x40e680`, inside that rect.
 *   - **the effects are `0x42827a`'s table**: four hundred health, one life,
 *     the three scores, and eight hundred and fifty back on the clock.
 */
import { loopIndex } from "../../src/foes";
import { PICKUP } from "../../src/props";
import { fail, headless, ok, pass } from "./harness";

const h = await headless("level=1&x=1900&y=1223");
const { game } = h;
const { p, stats } = game;

const pickups = () => game.hereOf((l) => l.pickups);
const count = (): number => pickups().length;
/**
 * Stand exactly where a record is, which is what walking into it comes to.
 *
 * The score and the lives outlive a level load — they are what a loaded game
 * carries — so each stand starts from a new game's 0 and 3 by the same two
 * switches a save file would set.
 */
const stand = async (level: number, x: number, y: number, extra = ""): Promise<void> => {
  await h.load(`level=${level}&x=${x}&y=${y}&score=0&lives=3${extra}`);
  h.frame(9);
};
/** the two tests `0x45b2ca` makes against the nearest pickup: the rects, then the art */
const touch = (): { rect: boolean; pixels: boolean } => {
  const near = [...pickups()].sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
  if (!near || !game.player) fail(`no pickup near x ${p.x}`);
  const box = game.playerBox();
  const rect = box.right > near.left && box.left < near.right && box.bottom > near.top && box.top < near.bottom;
  const kind = PICKUP.kinds[near.code];
  const loc = game.player.byId.get(kind.cels[loopIndex(kind, near.clock)]);
  const pf = loc === undefined ? null : game.playerFrame(loc);
  const me = game.playerSprite();
  const pixels =
    pf && me ? game.spritesTouch(me, { f: pf, left: near.x - pf.posXraw, top: near.y - pf.posYraw, mirror: false }) : false;
  return { rect, pixels };
};

// 1. they are placed, and they are placed from the records
h.frame(9);
const first = count();
if (first !== 6) fail(`STREETS' first room holds six of them; the level lists ${first}`);
if (!pickups().every((q) => /^-\d$/.test(q.code) && PICKUP.kinds[q.code]))
  fail(`each should carry the negative code its chapter hands the creator: ${pickups().map((q) => q.code).join(" ")}`);
ok(`STREETS' first room places ${first} of them, each with its own code (${pickups().map((q) => q.code).join(" ")})`);

// 2. ...and they are OUT OF REACH from the street. The first room's four sit
//    at roof height, two hundred pixels over the top of a jump.
h.hold("up", true);
for (let i = 0; i < 20; i++) {
  h.press("jump");
  h.frame(2);
  h.hold("jump", false);
  h.frame(1);
}
h.hold("up", false);
h.frame(10);
if (count() !== first) fail(`jumping in the street should reach none of them; ${first} -> ${count()}`);
ok(`and twenty jumps from the street reach none of them — they are on the roofs`);

/**
 * 3. the SECOND test — `0x40e680`, which is the art rather than the rect.
 *
 * `0x45b2ca` intersects the two rects and only then calls it, and it walks
 * that intersection looking for a row where both cels have an opaque span
 * (`0x4320c0`). STREETS' statlife is 100 wide and its record runs 3629..3729,
 * so standing at 3600 or 3760 overlaps the rect by a pixel or two and touches
 * none of the art — and the pickup has to survive that.
 */
for (const x of [3600, 3760]) {
  await stand(1, x, 985);
  const t = touch();
  if (!t.rect) fail(`x ${x} should graze the statlife's rect; it does not`);
  if (t.pixels) fail(`...and touch none of its art; at x ${x} it does`);
  if (stats.lives !== 3) fail(`a rect graze must not take it; ${stats.lives} lives`);
}
ok(`a rect that grazes by a pixel takes nothing — 0x40e680 is the art, not the box`);

// 3. `statlife`: one life, and walking into it is the whole of it
await stand(1, 3679, 985);
if (stats.lives !== 4) fail(`0x428421 adds one life; ${stats.lives} lives`);
if (count() !== first - 1) fail(`and the one taken should be gone; ${first} -> ${count()}`);
ok(`standing in a statlife takes it and the player has ${stats.lives} lives`);

// 4. `stathealth`: four hundred, and it cannot go over what you started with
await stand(1, 6918, 945, "&damage=1");
if (!game.damageOn) fail(`?damage=1 should arm the bar`);
if (stats.health !== stats.maxHealth) fail(`a full one cannot be topped up past its own max; ${stats.health}/${stats.maxHealth}`);
ok(`a stathealth on a full bar leaves it at ${stats.health}/${stats.maxHealth} — 0x402b20 clamps`);

// 5. `statscoreup` is three pickups wearing one name, and the param says which
await stand(1, 1715, 1071);
const two = stats.score;
if (two !== 2000) fail(`param 0 is -6, and 0x428392 pays 0x7d0; the score reads ${two}`);
await stand(1, 4885, 2597);
const five = stats.score;
if (five !== 5000) fail(`param 1 is -5, and 0x4283bd pays 0x1388; the score reads ${five}`);
await stand(1, 5916, 2430);
const ten = stats.score;
if (ten !== 10000) fail(`param 2 is -4, and 0x4283e8 pays 0x2710; the score reads ${ten}`);
ok(`its three scoreups pay ${two}, ${five} and ${ten}, by their records' own params`);

// 6. `stattimer`: eight hundred and fifty engine frames back, and `0x40d378`
//    takes back whatever is over the dial's own full scale.
//
//    `0x42834f` hands `0x40d350` a NEGATIVE 850, which is that function's way
//    of saying "add" — and it then clamps the clock to `[0x4a3b18]`, the scale
//    every chapter's entry function fills from the book's `timer` record. So
//    the gift is only visible on a clock that is not already full, which is
//    what `?clock=` is for. STREETS' dial is 4000.
await stand(1, 1900, 1223, "&clock=1000");
const before = stats.ticks;
await stand(1, 7187, 931, "&clock=1000");
const after = stats.ticks;
// the same nine frames of countdown in both, so the difference is the gift
if (after - before !== 850) fail(`0x42834f gives back 850 frames; the clock went ${before} -> ${after}`);
ok(`a stattimer puts ${after - before} frames back on the clock (${before} -> ${after})`);

// ...and on a full dial it puts back nothing, because there is nowhere to put it
await stand(1, 7187, 931);
const capped = stats.ticks;
if (stats.clockFull !== 4000) fail(`STREETS' timer record is 4000; the dial reads ${stats.clockFull}`);
if (capped > 4000) fail(`0x40d378 is the clamp; the clock reads ${capped}`);
if (capped < 3900) fail(`a full clock should stay full, not fall; the clock reads ${capped}`);
ok(`...and nothing at all on a full one — ${capped} against the dial's own 4000`);

// 7. and they are in every level, not only the first
for (const [level, want] of [[3, 10], [5, 2], [6, 5]] as const) {
  await h.load(`level=${level}`);
  h.frame(9);
  if (count() !== want) fail(`level ${level}'s first room places ${want}; the level lists ${count()}`);
}
ok(`and every level's own records place their own, off one table`);

pass("the stat pickups are placed, drawn from the shared book, and taken by walking into them");
