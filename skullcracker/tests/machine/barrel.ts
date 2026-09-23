/**
 * BARREL — level fourteen, and the level that moves under you.
 *
 *   npx tsx tools/runmachine.mts barrel      (from skullcracker/)
 *
 * Forty-two conveyors — twenty-six `initbeltleft` and sixteen `initbeltright` —
 * sharing one creator (`0x411500`) and one class (`0x4167c0`). Each is a 278x36
 * strip, and the think is one test and one number: is the bottom of the player's
 * drawn box just above the strip's point, their point inside its x, and are they
 * on the ground — and if so the record's param goes onto their velocity.
 *
 * They are laid end to end with a gap of a few pixels between one record's right
 * and the next one's left, and whether the player coasts over it is arithmetic:
 * off the end of a param-4 belt the drag (`0x4302c0`) leaves 2 and then 1, three
 * pixels of coast after the last push.
 *
 * Twelve TCops stand in it, and chapter four's own weapon — the blaster — has
 * ten `statblasterpack` refills here and nothing to fire them with, because the
 * gun itself is in VAT.
 */
import { GUN_CODES, WEAPONS } from "../../src/guns";
import { fail, headless, ok, pass } from "./harness";

const h = await headless("level=14");
const { game } = h;
const go = async (q: string): Promise<void> => {
  await h.load(`level=14${q}`);
  h.until(() => game.p.onGround, 60);
  h.frame(4);
};

// 1. three regions, twelve cops, and its own clock
if (game.level!.rooms.length !== 3) fail(`BARREL has three regions; it has ${game.level!.rooms.length}`);
const kill = Math.round(game.mission().kill * 100);
if (kill !== 55 || game.stats.census !== 12)
  fail(`twelve cops count and nothing else does; the census is kill ${kill}% of ${game.stats.census}`);
if (game.stats.clockFull !== 8200) fail(`BARREL's timer record carries 8200; the clock is full at ${game.stats.clockFull}`);
ok(`BARREL is three regions, twelve TCops, and ${game.stats.clockFull} frames — the longest clock in the game`);

// the game opens in the first region — `initplayer` record 0, x12, held at x52
// by the mover's side test (`0x42e5ef`, `0x43006b`): the region has no floor,
// so `0x40bbd0` bounds it at its rect less fifty (`0x40bc92`), x51 — and the
// rest is in the middle one, where the second record stands
h.until(() => game.p.onGround, 60);
const r0 = game.p.room;
if (r0 !== game.level!.rooms[0] || r0.name !== "barrel" || r0.param !== 0 || game.p.x !== 52)
  fail(`BARREL opens on its first initplayer, x12 held at x52 in region "barrel"; it is in ${r0?.name}/p${r0?.param} at x ${game.p.x}`);
ok(`and it opens on its first initplayer, stood inside the first region at x ${game.p.x}, y ${game.p.y}`);

// 2. forty-two of them stand in its middle region
await go("&x=4367&y=8211");
const belts = game.hereOf((l) => l.belts);
if (belts.length !== 42) fail(`BARREL lays 26 + 16 conveyors; ${belts.length} stand here`);
if (belts.filter((b) => b.dir < 0).length !== 26) fail(`twenty-six of them are initbeltleft`);
ok(`and forty-two conveyors, all in one region`);

/** a plain load: on a conveyor the player never stands still to settle */
const drop = async (q: string): Promise<void> => {
  await h.load(`level=14${q}`);
  h.until(() => game.p.onGround, 60);
};
/** the frame's move, read at the frame boundary */
const step = (): number => {
  const x0 = game.p.x;
  h.frame();
  return game.p.x - x0;
};

// 3. a right-hand belt carries you east. `0x4168db` adds the record's param to
//    the player's velocity every frame and the drag takes 70% back
//    (`0x4302c9`), so a param-4 belt settles where v = drag(v) + 4: six a
//    frame, ninety a second
await drop("&x=5316&y=8140");
h.frame(4);
const from = game.p.x;
const moves: number[] = [];
for (let i = 0; i < 10; i++) moves.push(step());
if (moves.some((m) => m !== 6)) fail(`a param-4 belt settles at 6 a frame (0x4168db, 0x4302c9); it moved ${moves.join(" ")}`);
ok(`a right-hand belt carries you six pixels a frame, x ${from} to x ${game.p.x}`);

//    ...and off its end at x5451 the push stops: 2, then 1, then nothing. The
//    next belt starts at x5458, and this ride's last push lands short of the
//    one place (x5450) three pixels of coast would clear it from
const off = h.until(() => game.p.vx === 0, 30);
if (off < 0) fail(`off the belt the drag should stop the player; still at vx ${game.p.vx}`);
const rest = game.p.x;
if (!(rest > 5451 && rest < 5458)) fail(`the coast off the belt ends in the seam x5451..5458; it ended at x ${rest}`);
h.frame(15);
if (game.p.x !== rest) fail(`nothing pushes the player in the seam; x ${rest} became x ${game.p.x}`);
ok(`and off its end the drag leaves 2 and 1 — the player comes to rest in the seam at x ${rest}`);

// 4. ...and a left-hand one carries you the other way — this one's param is
//    10, and v = drag(v) + 10 settles at fifteen a frame, over its own seams
await drop("&x=5380&y=7500");
h.frame(4);
const lFrom = game.p.x;
const lMoves: number[] = [];
for (let i = 0; i < 10; i++) lMoves.push(step());
if (lMoves.some((m) => m !== -15)) fail(`an initbeltleft of param 10 settles at 15 a frame west (0x41694b); it moved ${lMoves.join(" ")}`);
h.frame(20);
if (game.p.x > 5144 - 100) fail(`the param-10 belts carry across their three-pixel seam at x5144..5147; the player is at x ${game.p.x}`);
ok(`a left-hand one carries you the other way, fifteen a frame, x ${lFrom} to x ${game.p.x} — over its seam`);

// 5. the chair — four tags of `0x46dfd8` handed round, and nothing else in
//    the class at all
await go("&x=4367&y=8211");
const chairs = game.hereOf((l) => l.chairs);
if (!chairs.length) fail(`a chair stands in BARREL's middle region`);
const chair = new Set<number>();
for (let i = 0; i < 48; i++) {
  h.frame();
  chair.add(game.chairCel(chairs[0]));
}
if (chair.size < 6) fail(`a chair rings nineteen records; it showed ${chair.size}`);
if ([...chair].some((c) => c < 2200 || c > 2226)) fail(`0x46dfd8 is 2200..2226; saw ${[...chair].join(" ")}`);
ok(`a chair rings through ${chair.size} of its own 2200..2226`);

// 6. chapter four's weapon refills, and no gun in the level to use them
const gun = WEAPONS[game.inv.weapon];
if (gun?.name !== "blaster" || game.inv.armed || game.roundsIn(game.inv.weapon) !== 0 || gun.max !== 160)
  fail(`chapter four names the blaster and arms nothing; the hand is ${game.inv.armed ? "holding" : "no"} ${gun?.name ?? game.inv.weapon} ${game.roundsIn(game.inv.weapon)}/${gun?.max}`);
const lying = game.level!.guns.flat();
const names = new Set(lying.map((g) => GUN_CODES[g.code]?.name ?? String(g.code)));
if (lying.length !== 10 || names.size !== 1 || !names.has("statblasterpack"))
  fail(`BARREL places ten statblasterpack and no statblaster; it places ${lying.length}: ${[...names].join(" ")}`);
ok(`and its ten blaster packs have no gun in the level to go in`);

pass(`BARREL's conveyors carry, its chairs turn, and its twelve cops stand`);
