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
import { COP, COP_SLUG, copReacts } from "../../src/brains/cop";
import type { BrainCtx, Enemy } from "../../src/brains/kit";
import { FOES } from "../../src/foes";
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

// 7. a GUNNER dies its own way — `0x4148ed` reads `AI+0x32`, the record's
//    param, and gives it `0x46c8f0` tag 3; `0x414566` ends that by dropping
//    the blaster behind it and installing kind 11, whose third frame takes the
//    body away (`0x41469c`). Its four cels carry a body and `0x4147d0` has no
//    state test, so a blow in them kills it again and pays again (`0x41490d`)
const gunnerAt = game.level!.spawned.flat().find((e) => e.kind === "initcop" && e.param);
if (!gunnerAt) fail(`BARREL places gunner TCops (param 1)`);
await go(`&x=${Math.round(gunnerAt.x)}&y=${Math.round(gunnerAt.y) - 20}`);
const gunner = game
  .spawnedHere()
  .filter((e) => e.kind === "initcop" && e.param)
  .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];
if (!gunner) fail(`no gunner near x${gunnerAt.x}`);
const box = { top: gunner.y - 100, bottom: gunner.y, left: gunner.x - 50, right: gunner.x + 50 };
const packs = () => game.level!.guns.flat().length;
const lie = packs();
const paid = game.stats.score;
game.strikeFoe(gunner, gunner.hp + 1, { dx: 0, dy: 0 }, 1, gunner.y - 50, box);
if (gunner.state !== "dead" || gunner.anim.from !== "0x46c8f0 tag 3" || gunner.script !== 9 || gunner.tag !== 3)
  fail(`a gunner dies on 0x46c8f0 tag 3 (0x4148f4); it is on ${gunner.anim.from}`);
if (!game.celRec(game.level!.sbk, 2130)?.body || !FOES.initcop.corpseTakesHits)
  fail(`2130..2133 carry a body, so the gunner's death takes blows`);
game.strikeFoe(gunner, 50, { dx: 0, dy: 0 }, 1, gunner.y - 50, box);
if (game.stats.score - paid !== 2 * 550) fail(`a second blow in tag 3 pays 0x226 again; the score rose ${game.stats.score - paid}`);
if (packs() !== lie) fail(`the blaster drops as tag 3 ENDS, not at the blow`);
h.until(() => gunner.anim.from === "0x46c9a8 tag 0", 8);
if ((gunner.anim.from as string) !== "0x46c9a8 tag 0" || (gunner.script as number) !== 11) fail(`tag 3 hands to kind 11 (0x4145a4); it shows ${gunner.anim.from}`);
if (packs() !== lie + 1) fail(`0x414599 drops the blaster as tag 3 ends; ${packs() - lie} dropped`);
h.until(() => !game.spawnedHere().includes(gunner), 10);
if (game.spawnedHere().includes(gunner)) fail(`kind 11 takes the body away on its third frame (0x41469c)`);
ok(`a gunner dies on its own four cels, pays again if struck in them, drops the blaster and goes on kind 11`);

// 8. the first blow that drops a cop under half is not a flinch — `0x414933`
//    installs `0x46c888` tag 0 and sets `AI+0x30`, once — and the body goes
//    with lab.snd 0xd and 0x78 of goo on kind 11's last frame, not at the blow
const C = FOES.initcop;
const blow = { damage: 30, hits: 1, dy: 0, facingAway: false };
const cop = { max: 250, hp: 124 } as { max: number; hp: number; switchRun?: number };
if (C.pick!(blow, { max: 250, hp: 125 }) !== 0) fail(`at exactly half it still flinches (0x414949 jle)`);
if (C.pick!(blow, cop) !== 1 || cop.switchRun !== 1) fail(`under half it takes the switch run and latches AI+0x30`);
if (C.pick!(blow, cop) !== 0) fail(`...and only once (0x414952)`);
const run = C.flinch![1];
if (run.from !== "0x46c888 tag 0" || run.resume?.kind !== 1) fail(`the switch run's first cel hands to the stance with no switch (0x414618)`);
const said: number[] = [];
const goo: number[] = [];
const k = { say: (_e: unknown, id: number) => said.push(id), spray: (_e: unknown, n: number) => goo.push(n) } as unknown as BrainCtx;
const body = { state: "dead", anim: C.death!, clock: 5 } as Enemy;
copReacts(body, C, 6, k);
body.clock = 6;
copReacts(body, C, 6, k);
if (said.join() !== "13" || goo.join() !== "120" || C.deathSound !== undefined)
  fail(`0x4146ab says 0xd and 0x4146d2 sprays 0x78 as the body goes, and the blow says nothing; said ${said} sprayed ${goo}`);
if (!C.hitsOwn || !game.SPARES.initcop?.kinds.includes("initslurp") || !game.SPARES.initcop.kits.includes(COP_SLUG))
  fail(`0x4147e6..0x41482f turn away the slurp and the slug, and not a cop`);
ok(`under half the first time it runs for a switch instead of flinching, and it goes with 0xd and 0x78 of goo`);

// 9. its flinch is state 8, and `0x41440e` decides on `obj+0x46`: the wind-up
//    or the walk out goes on the frame the two cels' four frames end
{
  const at = game.level!.spawned.flat().find((e) => e.kind === "initcop" && !e.param)!;
  await go(`&x=${Math.round(at.x)}&y=${Math.round(at.y) - 20}`);
  const c = game
    .spawnedHere()
    .filter((e) => e.kind === "initcop" && !e.param && e.state !== "dead")
    .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];
  const take = C.flinch![0];
  c.state = "flinch";
  c.anim = take;
  c.clock = 0;
  c.script = take.kind;
  c.tag = take.tag;
  c.asleep = false;
  let f = 0;
  while (c.state === "flinch" && c.anim === take && f < 20) {
    h.frame();
    f += 1;
  }
  if (f !== take.cels.length * take.hold || (c.anim !== COP.wind && c.anim !== COP.walkOut))
    fail(`the flinch is ${take.cels.length * take.hold} frames and then the wind-up or the walk out; ${f} frames, then ${c.anim.from}`);
  ok(`a cop's flinch hands to ${c.anim === COP.wind ? "the wind-up" : "the walk out"} after ${f} frames, the frame it ends (0x41440e)`);
}

pass(`BARREL's conveyors carry, its chairs turn, and its twelve cops stand`);
