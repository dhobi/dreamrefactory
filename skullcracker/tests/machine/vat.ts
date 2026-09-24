/**
 * VAT — level sixteen, the last of them, and a census of exactly one.
 *
 *   npx tsx tools/runmachine.mts vat      (from skullcracker/)
 *
 * Its forty-one records are seven showers, two balls, a set of teeth, chapter
 * four's own gun — the `statblaster`, which is placed in this level and in no
 * other — and BOGGS, which is four objects: `initboggsbody`, `initboggshead`,
 * `initbgclawarm` and `initbgmachinery`, the last of which stands up eight more.
 *
 * Two numbers make it the last thing in the game:
 *
 * ```
 *   41be84  0x40e300(0xfa0)                 ; four thousand health
 *   41be68  cmp [0x46e080] / [0x46e084]     ; while EITHER flag is set...
 *   41be7c  add word ptr [0x4a50e8], 0x1e   ; ...thirty a frame back
 * ```
 *
 * Four thousand is three times TOWER's bishop and more than three times the
 * player. But the flags ship SET — both are `01 00` in `.data` — and nothing in
 * `.text` ever sets one: the only two writes there are are the clears at
 * `0x41b611` and `0x41b75d`, and both are in the MACHINERY's hit handler. So the
 * fight is the machine, and only then the boss.
 *
 * And the census is the HEAD: `0x41c591` is `0x42f870(head, 1)`, the body is not
 * registered at all, and `0x416047` will not spawn the goal until both the
 * allowance is met and `0x46bfbc` is set — which `0x41bdd8` does when Boggs
 * dies. So the ending cannot be walked to past a living Boggs.
 */
import { GUN_CODES } from "../../src/guns";
import { BOGGS } from "../../src/props";
import { fail, headless, ok, pass, recordSound } from "./harness";

// the films are the page's business; headless, the game only says which one
const films: string[] = [];
const h = await headless("level=16");
const { game } = h;
game.ui.film = async (name: string) => {
  films.push(name);
};
const settle = (): void => {
  h.until(() => game.p.onGround || !!game.p.bar, 60);
  h.frame(4);
};
const go = async (q: string): Promise<void> => {
  await h.load(`level=16${q}`);
  settle();
};
const boggs = () => game.hereOf((l) => l.boggs)[0];
const roomNo = () => game.level!.rooms.indexOf(game.p.room!) + 1;
/** the two breakable halves, in the order the HUD named them */
const halves = () => {
  const b = boggs();
  return BOGGS.machines.map((m, k) => ("health" in m ? b.machines[k] : null)).filter((m) => m !== null);
};
const flags = () => `${boggs().flags[0] ? 1 : 0}${boggs().flags[1] ? 1 : 0}`;

// 1. two regions, nothing that counts, and no clock
settle();
if (game.level!.rooms.length !== 2) fail(`VAT has two regions; it has ${game.level!.rooms.length}`);
if (game.stats.census !== 1) fail(`VAT's census is Boggs' head and nothing else — 0x41c591; it is ${game.stats.census}`);
if (game.stats.ticks < 31000) fail(`VAT carries no timer record, so no limit; the clock reads ${game.stats.ticks}`);
ok(`VAT is two regions, a census of one — Boggs' head — and no clock`);

// 2. its furniture, all of it one cel apiece
const fits = game.hereOf((l) => l.fittings);
const celOfKind = (k: string) => fits.filter((f) => f.kind === k).map((f) => game.fittingCel(f));
if (!celOfKind("shower").includes(4060)) fail(`0x46cc68 tag 0 is one record, 4060; showers show ${celOfKind("shower")}`);
if (!celOfKind("ball").includes(4310)) fail(`0x41a73d files 0x10d6; balls show ${celOfKind("ball")}`);
if (!celOfKind("teeth").includes(3516)) fail(`0x418c9d files 0xdbc; teeth show ${celOfKind("teeth")}`);
ok(`and its showers, balls and teeth stand on their own single cels`);

/**
 * 2a. ...and the showers and the balls are not furniture. A shower's point in
 * the rect's lower half hangs it in the floor (`0x4117f7`); the four VAT puts
 * there stand under the region's floor and are filed by their rect.
 */
{
  const all = game.level!.fittings.flat();
  const sh = all.filter((f) => f.kind === "shower");
  if (sh.length !== 7 || sh.filter((f) => f.tag === 1).length !== 4 || all.filter((f) => f.kind === "ball").length !== 2)
    fail(`VAT places seven showers, four in the floor, and two balls; ${sh.length} showers (${sh.filter((f) => f.tag === 1).length} in the floor)`);
  const heard = recordSound(game);
  const said = (from: number) => heard.slice(from).filter((c) => c.call === "effect").map((c) => c.args);
  /**
   * One spray from where a shower stands, frame by frame: the health each
   * frame, and what it said. `0x41a2f8` — within fifty in x, on frame index
   * 7..10 (tag 0) or 22..26 (tag 1), a hundred through `0x402ac0` a frame.
   */
  const spray = async (x: number): Promise<{ lost: number[]; said: unknown[][]; flames: number }> => {
    await go(`&x=${x}&damage=1`);
    const f = game.hereOf((l) => l.fittings).find((q) => q.kind === "shower" && q.x === x)!;
    game.stats.health = game.stats.maxHealth;
    // ...stood in it and still, until it has gone back to idle once
    h.until(() => f.phase === "idle", 40);
    const mark = heard.length;
    const flames0 = game.flames.length;
    h.until(() => f.phase === "spray", 5);
    const lost: number[] = [];
    let was = game.stats.health;
    for (let i = 0; i < 17 && f.phase === "spray"; i++) {
      h.frame();
      lost.push(was - game.stats.health);
      was = game.stats.health;
    }
    return { lost, said: said(mark), flames: game.flames.length - flames0 };
  };
  const top = await spray(3240);
  const burnt = top.lost.map((n, i) => (n ? i : -1)).filter((i) => i >= 0);
  if (burnt.join() !== "7,8,9,10" || top.lost.some((n) => n !== 0 && n !== 100))
    fail(`a ceiling shower burns a hundred on frames 7..10 (0x41a301); it took ${top.lost.join(" ")}`);
  const fives = top.said.filter((a) => a[0] === 5).length;
  const hiss = top.said.filter((a) => a[0] === 1 || a[0] === 2).length;
  if (fives !== 4 || hiss < 1 || top.flames < 4)
    fail(`each burning frame says 5 (0x41a348) and lights a flame (0x41a3f0), and it hisses 1 or 2 as it starts; ${fives} fives, ${hiss} hisses, ${top.flames} flames`);
  const firsts = heard.filter((c) => c.call === "effect" && c.args[0] === 0x20);
  if (firsts.length > 1 || (firsts.length === 1 && firsts[0].args[3] !== "lead"))
    fail(`0x20 through 0x40f090 once in the run ([0x46cd8c]); heard ${firsts.length}`);
  const floor = await spray(3494);
  const burntF = floor.lost.map((n, i) => (n ? i : -1)).filter((i) => i >= 0);
  if (burntF.join() !== "6,7,8,9,10")
    fail(`a floor shower's tag 1 counts from 16, so it burns on its own 6..10 — 22..26 of the script; it took ${floor.lost.join(" ")}`);
  ok(`a ceiling shower takes 100 on its frames 7..10 and a floor one on 22..26, a flame and a 5 each — no blow, 0x402ac0`);

  // the ball: in its rect it says 4 at the player (0x41a886), swings out on
  // 4310..4300 and back at half the speed, swishing 0 on frame index 3 of each.
  // Its rect stops twelve pixels above a standing player's point — it is a
  // jump that sets it going
  await go(`&x=4337`);
  const ball = game.hereOf((l) => l.fittings).find((q) => q.kind === "ball" && q.x === 4337)!;
  if (ball.phase !== "idle") fail(`a standing player's point is under the ball's rect; it swung`);
  const mark = heard.length;
  h.press("jump");
  h.until(() => ball.phase === "out", 30);
  const cels: number[] = [];
  let outFrames = 0;
  while ((ball.phase as string) === "out" && outFrames < 20) {
    cels.push(game.fittingCel(ball));
    h.frame();
    outFrames += 1;
  }
  let backFrames = 0;
  while ((ball.phase as string) === "back" && backFrames < 40) {
    h.frame();
    backFrames += 1;
  }
  const b = said(mark);
  const cue = b.find((a) => a[0] === 4);
  const swish = b.filter((a) => a[0] === 0).length;
  if (!cue || cue[3] !== "lead" || outFrames !== 12 || backFrames !== 23 || cels[0] !== 4310 || cels[10] !== 4300 || swish !== 3)
    fail(`the ball cues 4 through 0x40f090, swings out 11 frames and back 22, and swishes on index 3 of each; cue ${cue}, out ${outFrames}, back ${backFrames}, cels ${cels.join(" ")}, ${swish} swishes`);
  ok(`a ball in its rect cues 4 at the player, swings 4310..4300 and back, and swishes 0 on each swing's frame 3`);
  // ...and its cels are the blow: a hundred at `obj+0x1a` (`0x41a89e`) through
  // the player's own hit handler, 4305's box hanging where he lands
  await go(`&x=4337&damage=1`);
  game.stats.health = game.stats.maxHealth;
  h.press("jump");
  h.until(() => ball.phase === "out" || game.hereOf((l) => l.fittings).some((q) => q.kind === "ball" && q.phase === "out"), 30);
  const hitAt = h.until(() => game.stats.health < game.stats.maxHealth, 40);
  if (hitAt < 0) fail(`the swing through a player under the ball should land its blow; health ${game.stats.health}/${game.stats.maxHealth}`);
  ok(`and the swing lands on a player under it as a blow — ${game.stats.maxHealth - game.stats.health} off`);
}

// 2b. what Boggs says as it is struck — `0x41bc50` for the body, `0x41b510`
//     for the machinery — and the two hints that tell you to break the machine
{
  const heard = recordSound(game);
  await go("&x=6100");
  const b = boggs();
  const said = (from: number) => heard.slice(from).filter((c) => c.call === "effect").map((c) => [c.args[0], c.args[3]] as const);
  let mark = heard.length;
  game.boggsStruck(b, true);
  const bolt = said(mark);
  if (bolt.length !== 1 || (bolt[0][0] as number) < 0x27 || (bolt[0][0] as number) > 0x2a || bolt[0][1] !== "renew")
    fail(`0x41bcd6: a bolt with the machinery up is 0x434540(4) + 0x26 through 0x40f110; heard ${JSON.stringify(bolt)}`);
  mark = heard.length;
  game.boggsStruck(b, false);
  const fist = said(mark);
  if (fist.length !== 1 || (fist[0][0] as number) < 0x19 || (fist[0][0] as number) > 0x1e || fist[0][1] !== undefined)
    fail(`0x41bcf9: anything else is 0x434540(6) + 0x18 through 0x40ef30; heard ${JSON.stringify(fist)}`);
  // the hint: the blow past ten, with the player a hundred west of machine A
  b.blows = 0;
  const a = b.machines[BOGGS.hint.machine];
  const px = game.p.x;
  game.p.x = a.x - BOGGS.hint.westOf - 1;
  mark = heard.length;
  for (let i = 0; i < 12; i++) game.boggsStruck(b, false);
  const hints = said(mark).filter(([id, way]) => id === BOGGS.hint.sound && way === "lead");
  game.p.x = px;
  if (hints.length !== 1) fail(`0x41bd58: the twelfth blow west of the machine says 0x26 through 0x40f090; ${hints.length} said`);
  // the machinery answers every blow, a bolt's higher than a fist's
  mark = heard.length;
  game.strikeMachine(b, 0, 0);
  game.strikeMachine(b, 0, 0, true);
  const m = said(mark).map(([id]) => id as number);
  if (m.length !== 2 || m[0] < 6 || m[0] > 8 || m[1] < 9 || m[1] > 11)
    fail(`0x41b53f..0x41b56b: 0x434540(3) + 5, or + 8 for a bolt; heard ${m.join(" ")}`);
  ok(`Boggs cries out as it is struck (a bolt ${bolt[0][0]}, a fist ${fist[0][0]}), hints on the twelfth blow, and its machinery answers too`);
  // and the page's own silence back, which the rest of this suite ran under
  game.setSound(null);
}

/**
 * 2c. the FIRST machine strikes — `0x41afd0`, and see `BOGGS.zap`.
 *
 * - `0x41bef4`: a player at or right of the body, the machine on kind 0 and
 *   `0x46e080` up, and `0x46e490` goes on, 60 along and 70 down (`0x46e0a4`);
 * - `0x41b089`..`0x41b0f2`: it slides out along x and back, and `0x46e4d0`
 *   ends it on kind 0;
 * - `0x41b022`: −1 from the first frame, and it is never undone — the player
 *   standing in 5630's strike box is spun, and it costs twenty (`0x42eb2b`);
 * - `0x41b045`: 0x24 at the head through `0x40f090`, once each time the
 *   player is down while it sweeps;
 * - `0x411ed0` runs every frame (`0x419c7b`): the machines stand at their
 *   offsets from the body wherever the body has lunged to;
 * - `0x41b156`: the sixth machine's wreck run costs ten a frame and stops the
 *   fourth machine on 5945 as it ends.
 */
{
  await go("&x=6400&damage=1");
  const b = boggs();
  const z = b.zap;
  const state = (): string => game.p.act ?? "";
  const kind = (): number => z.kind;
  if (z.kind !== 1 || z.dy !== BOGGS.zap.at.dy || z.dx < BOGGS.zap.at.dx)
    fail(`0x41bf1e puts the first machine out on a player right of the body: kind ${z.kind}, at ${z.dx},${z.dy}`);
  let most = 0;
  let spun = 0;
  let off = 0;
  const hp0 = game.stats.health;
  for (let i = 0; i < 200 && kind() === 1; i++) {
    most = Math.max(most, z.dx);
    if (state() === "spun") spun += 1;
    for (let k = 1; k < BOGGS.machines.length; k++) {
      const m = b.machines[k];
      if (m.x - b.x !== BOGGS.machines[k].dx || m.y - b.y !== BOGGS.machines[k].dy) off += 1;
    }
    h.frame();
  }
  if (kind() !== 0 || !z.armed) fail(`0x46e490's five tags end on 0x46e4d0, kind 0, still armed: kind ${z.kind}, armed ${z.armed}`);
  if (most < BOGGS.zap.at.dx + 30 || most > BOGGS.zap.at.dx + 32 || Math.abs(z.dx - BOGGS.zap.at.dx) > 1)
    fail(`it slides thirty-odd out and back (0x41b089..0x41b0f2): out to +${most - BOGGS.zap.at.dx}, back to +${z.dx - BOGGS.zap.at.dx}`);
  if (!spun || game.stats.health >= hp0)
    fail(`standing in 5630's strike box the player is spun by the −1 and pays for it: spun ${spun} frames, health ${hp0} -> ${game.stats.health}`);
  if (off) fail(`0x411ed0 re-places the machines against the body every frame; ${off} were off`);
  ok(`the first machine sweeps out ${most - BOGGS.zap.at.dx}px and back, spins the player with −1 (${hp0 - game.stats.health} health), and the machines keep to the body`);

  // the taunt, straight off the think: down once, then spent until he is up
  const heard = recordSound(game);
  const player = game.p as { act: string | null };
  const was = player.act;
  z.kind = 1;
  z.tag = 2;
  z.clock = 1;
  z.taunted = false;
  player.act = "dying";
  game.boggsMachinery(b);
  game.boggsMachinery(b);
  player.act = null;
  game.boggsMachinery(b);
  player.act = "dying";
  game.boggsMachinery(b);
  player.act = was;
  const taunts = heard.filter((c) => c.call === "effect" && c.args[0] === BOGGS.zap.taunt && c.args[3] === "lead");
  if (taunts.length !== 2) fail(`0x41b045: 0x24 once each time the player goes down while it sweeps; ${taunts.length} said`);
  ok(`and it taunts once each time the player is down (0x41b068)`);
  game.setSound(null);

  // the sixth machine's wreck run: ten a frame off, balls at the fourth, and the gauge stops
  const d = BOGGS.drain;
  b.hp = 2000;
  const pops0 = game.pops.length;
  b.machines[d.machine].hp = 1;
  game.strikeMachine(b, d.machine, 100);
  const spec = BOGGS.machines[d.machine];
  const run = "wreck" in spec ? spec.wreck.length * spec.hold : 0;
  const up = b.flags[0] || b.flags[1];
  h.frame(run + 2);
  // the heal runs every one of those frames; the drain on the run's
  const expect = 2000 + (run + 2) * (up ? BOGGS.regen : 0) - (run + 1) * d.perFrame;
  if (Math.round(b.hp) !== expect || !b.machines[d.at].wrecked || game.machineCel(b, d.at) !== 5945)
    fail(`0x41b168 takes ten a frame for the ${run + 1} frames of the wreck run, and 0x41b1e2 stops the fourth machine on 5945: hp ${b.hp} (want ${expect}), fourth on ${game.machineCel(b, d.at)}`);
  ok(`the sixth machine's wreck costs Boggs ten a frame through its run, ${game.pops.length - pops0} ball(s) at the fourth, which stops on 5945 (0x41b156)`);
}

// 3. BOGGS, in the other region, with four thousand health
await go("&x=6100");
if (roomNo() !== 1 || !game.p.room!.name.startsWith("chamber2"))
  fail(`Boggs stands in the region named chamber2; the player is in room ${roomNo()} ${game.p.room!.name}`);
{
  const b = boggs();
  if (!b) fail(`no Boggs in chamber2`);
  const cel = game.boggsCel(b);
  if (cel < 5900 || cel > 5999 || Math.floor(b.x / 1000) !== 6 || b.y !== 2094 || Math.round(b.hp) !== 4000 || !(b.flags[0] || b.flags[1]))
    fail(`0x41be84 gives it 0x40e300(0xfa0); it is cel ${cel} at x${b.x}, y${b.y}, ${b.hp}hp`);
}
// ...only the frames it shows while IDLE: it lunges, and the lunge is the
// wider 5980..5988 — see the step after the blaster
const cels = new Set<number>();
for (let i = 0; i < 200; i++) {
  h.frame();
  const b = boggs();
  if (!b.lunge && !b.dying) cels.add(game.boggsCel(b));
}
if (cels.size < 2) fail(`0x46e6b0 is 5988, 5987, 5986, 5987 at three frames each; it showed ${cels.size}`);
if ([...cels].some((c) => c < 5986 || c > 5988)) fail(`its idle is 5986..5988; saw ${[...cels].join(" ")}`);
ok(`Boggs stands in chamber2 on ${cels.size} of its own 5986..5988, at four thousand health`);

/**
 * 4. the MONKEYBAR, which is in this level and in no other either.
 *
 * One `monkeybar` record ships in the whole game — `param 65, top 1779, left
 * 5908, right 6617` — and until now it was the last live entity record with
 * nothing on this port's side. See `MONKEYBAR` in `src/game.ts`.
 *
 * It is not reachable from VAT's floor at y2301: the rect is in ANCHOR space
 * and a jump lifts the anchor 137, so the only way up is the platform at
 * `top 2002, left 6557, right 6659`, which is the one place in the level
 * where the bar is over your head and not out of it.
 */
await go("&x=6600&y=2002");
h.hold("up", true);
h.press("jump");
if (h.until(() => !!game.p.bar, 25) < 0) fail(`W in the air over the bar should grab it — 0x42ef11; the player is at y ${game.p.y}, on the ground ${game.p.onGround}`);
h.hold("up", false);
h.frame(4);
if (!game.p.bar) fail(`the grab let go again on its own`);
// the anchor goes to the record's own top, 1779, and the feet follow it down
if (game.p.y !== 1931)
  fail(`0x42ef11 puts the ANCHOR on the record's top of 1779, so the feet land at 1931; they are at ${game.p.y}`);
ok(`and its one monkeybar is grabbed in the air, hanging at hold ${game.p.barHold}`);

/**
 * Hand over hand, and a hold is a NUMBER — `x = left + n * 65` and nothing in
 * between, the same shape the ladder's rungs have. What proves it is that the
 * holds only ever count DOWN: the snap's `+1` belongs to travelling east
 * (`0x42b621` and `0x42b77b`, and not the other two arms), so reading it off
 * the facing instead sends a westward swing fifteen pixels back the way it came
 * every time a tag completes.
 */
h.hold("left", true);
const holds: number[] = [];
for (let i = 0; i < 72; i++) {
  holds.push(game.p.barHold);
  h.frame();
}
h.hold("left", false);
h.frame(9);
if (holds.some((v, i) => i > 0 && v > holds[i - 1]))
  fail(`swinging west, a hold may never go back up — 0x42b77b; they ran ${holds.join(" ")}`);
if (holds[holds.length - 1] >= holds[0] - 4)
  fail(`five seconds of A should cross most of an eleven-hold bar; they ran ${holds[0]} to ${holds[holds.length - 1]}`);
/**
 * ...and a hold is `left + n * param` — `0x42b677`. At rest on a whole frame
 * (the ends trade a tick of travel only while the key is held: `0x42b410`'s
 * preamble clamps x into `left..right` and the swing adds its ten back), so
 * after the swing settles the hold is exact.
 */
if (!game.p.bar) fail(`the swing let go of the bar`);
if (game.p.x !== 5908 + game.p.barHold * 65)
  fail(`a hold is left + n * param — 0x42b677; hold ${game.p.barHold} sits at x ${game.p.x} and not ${5908 + game.p.barHold * 65}`);
ok(`...and swung hand over hand west, ${holds[0]} holds down to ${holds[holds.length - 1]}, landing on the grid`);

/**
 * W is the chin-up and it is a flourish: `0x42b7ff` holds tag 3's last cel
 * while the key is down, `0x42b827` comes back down tag 4, and neither of them
 * touches x, y or the hold. S lets go, and only out of tag 0 — `0x42b522` is in
 * the hang's arm and no other arm tests for it.
 */
const before = game.p.barHold;
const bx = game.p.x;
const by = game.p.y;
h.hold("up", true);
if (h.until(() => game.p.barTag === 3, 12) < 0) fail(`W on the bar is the chin-up, 0x472048 tag 3; the tag is ${game.p.barTag}`);
h.frame(6);
if (game.p.barTag !== 3) fail(`0x42b7ff holds tag 3 while W is down; the tag went to ${game.p.barTag}`);
h.hold("up", false);
if (h.until(() => game.p.barTag === 0, 15) < 0)
  fail(`letting W go lowers you back down tag 4 into the hang — 0x42b827; the tag is ${game.p.barTag}`);
if (game.p.barHold !== before || game.p.x !== bx || game.p.y !== by)
  fail(`the chin-up moves nothing; hold ${before} -> ${game.p.barHold}, x ${bx} -> ${game.p.x}, y ${by} -> ${game.p.y}`);
h.hold("down", true);
h.frame(10);
h.hold("down", false);
h.until(() => game.p.onGround, 20);
if (game.p.bar) fail(`S out of the hang lets go — 0x42b522; still hanging at hold ${game.p.barHold}`);
// (read afresh: the grab's check above narrowed `game.p.y` for the compiler)
const landed: number = game.p.y;
if (landed !== 2301)
  fail(`and the leave is the plain fall, 0x471b28 tag 0, straight to VAT's floor; the player is at y ${game.p.y}`);
ok(`...and W chins you up and moves nothing, and S drops you straight to the floor`);

// 5. and chapter four's gun, which is in this level and in no other. Every
//    other level of the chapter places `statblasterpack` and nothing to put
//    them in; `0x416440` is what arms you, and it is here.
await go("&x=5760");
const lying = game
  .hereOf((l) => l.guns)
  .sort((a, b) => Math.hypot(a.x - game.p.x, a.y - game.p.y) - Math.hypot(b.x - game.p.x, b.y - game.p.y))[0];
if (!lying || GUN_CODES[lying.code]?.name !== "statblaster" || lying.x !== 5815)
  fail(`the game's one statblaster stands at x5815; the nearest gun is ${lying && GUN_CODES[lying.code]?.name} at x${lying?.x}`);
if (game.gunAhead() !== lying) fail(`and it should be in reach from x5760`);
h.hold("down", true);
h.until(() => game.inv.armed, 20);
h.hold("down", false);
h.frame(5);
if (!game.inv.armed || game.inv.weapon !== 6 || game.roundsIn(6) !== 41)
  fail(`0x416440 gives 40 and 0x45eed0 one more, against 0x412a24's 0xa0; it holds ${game.inv.weapon} ${game.roundsIn(6)}`);
ok(`and the game's one statblaster is here, and it arms you with 41 of 160`);

/**
 * ...and it LUNGES.
 *
 * `0x41be50` rolls `0x434540(0x2a)` once a frame while its kind is 0 and seven
 * of the forty-two take it (`0x41c006`), toward whichever side the player is on
 * (`0x41c047`). The stride is `0x46e6d8`'s own — three records of 470 —
 * through the largest divisor in the game.
 */
await go("&x=6100");
const states = new Set<string>();
const xs = new Set<number>();
// ...and each lunge is five a frame for its nine impulse frames and no more:
// the body's drag is a whole 1.0 (`0x41bc16`), so nothing carries over
const strides: number[] = [];
let from: number | null = null;
for (let i = 0; i < 160; i++) {
  const b = boggs();
  states.add(b.lunge ?? "idle");
  xs.add(Math.round(b.x));
  if (b.lunge && from === null) from = b.x;
  h.frame();
  if (from !== null && !boggs().lunge) {
    // one that ran into its record's end (`0x41bb40`) is cut short, and not counted
    const [lo, hi] = boggs().span!;
    const to = boggs().x;
    if (to > lo && to < hi) strides.push(Math.round(Math.abs(to - from)));
    from = null;
  }
}
if (!strides.length || strides.some((d) => d !== 45))
  fail(`a lunge is 5 a frame for nine frames, 45 in all (0x41bc16's drag of 1.0); strides ${strides.join(" ")}`);
if (!states.has("idle")) fail(`it should sit on its idle between lunges; it did ${[...states].join(" ")}`);
if (!states.has("left") && !states.has("right")) fail(`0x41c006 takes seven in forty-two; it never lunged`);
if (xs.size < 4) fail(`a lunge carries it; it stood at ${[...xs].join(" ")}`);
ok(`and Boggs lunges — ${[...states].sort().join(" ")}, across ${Math.max(...xs) - Math.min(...xs)}px of its own stride`);

/**
 * ...and what the OTHER thirty-five frames of the idle do.
 *
 * `0x41bffc`'s seven-in-forty-two is only the first roll of the frame.
 * `0x41c068` is the rest of it, and it is a range test on the same signed gap
 * the head aims on: at or under three hundred a WORM goes down, and beyond it
 * the second machine THROWS.
 *
 * Boggs' body stands at x6321 — but it lunges toward the player, and a player
 * at x6100 has it at its record's west end, x6134, inside a hundred of him
 * within five seconds (`0x41c07b` spends the frame), so no worm ever goes
 * down there. From x5950 it arrives 184 short of the player and stays there:
 * inside three hundred, outside a hundred — worms.
 */
await go("&x=5950");
const worms = new Map<number, Set<number>>();
let mostWorms = 0;
for (let i = 0; i < 240; i++) {
  const ws = game.wormsHere();
  mostWorms = Math.max(mostWorms, ws.length);
  for (const w of ws) {
    if (!worms.has(w.kind)) worms.set(w.kind, new Set());
    worms.get(w.kind)!.add(game.boggsWormCel(w));
  }
  h.frame();
}
if (!mostWorms) fail(`0x41c0fd drops one seven frames in fifty-five; in 240 frames none was ever down`);
// `0x41c3c8` — `cmp word ptr [eax+4], 0x13`, and the class's own count is what
// it tests, so nineteen is a hard ceiling rather than a tendency
if (mostWorms > 0x13) fail(`0x41c3c8 caps them at nineteen; ${mostWorms} were down at once`);
const wormCels = [...worms.values()].flatMap((v) => [...v]);
if (wormCels.some((c) => c !== 5670 && (c < 5660 || c > 5678)))
  fail(`a worm is 5670 asleep and 5660..5678 awake; saw ${wormCels.sort((a, b) => a - b).join(",")}`);
ok(`and Boggs seeds WORMS — up to ${mostWorms} of its nineteen, kinds ${[...worms.keys()].sort().join(",")}, cels ${[...new Set(wormCels)].sort((a, b) => a - b).join(",")}`);

/**
 * ...and past three hundred it throws instead, out of `[0x4a5170]` — which is
 * the SECOND machine and not Boggs. `0x41c09d` gates the whole branch on
 * `0x46e080`, the flag that machine's own wreck clears, so the throw stops when
 * the machine does.
 */
await go("&x=6100");
// walked rather than spawned: x6100 is the one place in chamber2 this suite
// knows stands Boggs up, and the gap is opened on foot from there
h.hold("left", true);
h.until(() => boggs().x - game.p.x >= 380, 90);
h.hold("left", false);
const gap = boggs().x - game.p.x;
if (!(gap > 300)) fail(`the throw wants the player more than 300 to its left; the gap is ${gap}`);
const hurl = new Set<number>();
const blows = new Set<number>();
for (let i = 0; i < 200; i++) {
  for (const c of game.casts) {
    hurl.add(game.castCel(c));
    blows.add(game.castBlow(c));
  }
  // a lunge (`0x41bffc`) closes the gap, and under three hundred it seeds
  // worms instead — so back off whenever it has come within reach
  h.hold("left", boggs().x - game.p.x < 340);
  h.frame();
}
h.hold("left", false);
if (!hurl.size) fail(`0x41c0dc throws on a countdown of 0x434540(0x1e) + 0x1e; in 200 frames nothing flew`);
if ([...hurl].some((c) => (c < 5610 || c > 5615) && (c < 5530 || c > 5537)))
  fail(`its throw is 5610..5615 in the air and 5530..5537 where it lands; saw ${[...hurl].sort((a, b) => a - b).join(",")}`);
if (!blows.has(0x14)) fail(`0x41aa30 writes twenty every frame it flies; saw blows ${[...blows].join(",")}`);
ok(`...and beyond three hundred it THROWS — cels ${[...hurl].sort((a, b) => a - b).join(",")}, worth ${[...blows].sort((a, b) => a - b).join("/")}`);

/**
 * ...and the MACHINERY, which is what the fight is actually about.
 *
 * `0x411ed0` stands eight objects at eight offsets from the body, out of the
 * table at `0x46e088`, and runs again every frame after the move (`0x419c7b`).
 * Six are scenery. The two that are not are `0x4a56e8` and `0x4a516c`, three
 * thousand each (`0x40e300(0xbb8)`), at `+218` and `+373` from the body's own
 * record point of x6321.
 */
await go("&x=6100");
{
  const [a, c] = halves();
  if (!a || !c || halves().length !== 2) fail(`0x411da0 stands up eight, two of them breakable; ${halves().length} are`);
  if (a.hp !== 3000 || c.hp !== 3000) fail(`0x40e300(0xbb8) each; they have ${a.hp} and ${c.hp}`);
  if (Math.round(a.x) !== 6539 || Math.round(c.x) !== 6694)
    fail(`0x46e088's last two pairs are +218 and +373 off x6321; they stand at x${a.x} and x${c.x}`);
  if (flags() !== "11") fail(`0x46e080 and 0x46e084 both ship as 01 00; the flags are ${flags()}`);
  ok(`and its machinery is eight objects, two of three thousand, at x${a.x} and x${c.x} with both flags up`);
}

/**
 * And BREAKING them is the fight. `0x41b5fc` and `0x41b748` take the damage
 * out of each half; `0x41b611` and `0x41b75d` are the only two writes to the
 * healing flags in the whole program, and each is reached only when its own
 * half has reached zero.
 *
 * So: break one and half the healing stops. Break both and the thirty a frame
 * stops entirely, and only then can the four thousand be spent.
 */
// ...and from where the disc lets you: WEST of the body, with the room's gun.
// East of it the first machine's sweep (`BOGGS.zap`) stands between the body
// and the halves and spins whoever is in it; west of it a bolt, at a standing
// player's knee, passes under the body's own box (x −151..31, y −36..127 on
// 5988) and meets the half behind it. The gun holds 160 and the halves take
// sixty hits between them, so the test tops it up — the rounds are not what
// this measures
await go("&x=6000&weapon=6&rounds=160");
game.inv.drawn = true;
const seen = new Map<string, number>();
let kicks = 0;
let shots = 0;
let frames = 0;
for (; frames < 12000; frames++) {
  const b = boggs();
  const key = `${flags()}/${b.dying}`;
  if (!seen.has(key)) seen.set(key, kicks + shots);
  if (b.dying) break;
  if (game.p.act) {
    h.frame();
    continue;
  }
  const [a, c] = halves();
  if (a.hp > 0 || c.hp > 0) {
    // stay two hundred west of it, facing it, and fire
    if (game.roundsIn(6) === 0) game.inv.rounds = { ...game.inv.rounds, 6: 160 };
    if (b.x - game.p.x < 200) {
      h.hold("left", true);
      h.frame();
      h.hold("left", false);
      continue;
    }
    if (game.p.facing < 0) {
      h.hold("right", true);
      h.frame();
      h.hold("right", false);
      continue;
    }
    h.press("punch");
    h.frame();
    shots += 1;
    continue;
  }
  // both halves down: the gun away, and the four thousand by hand
  game.inv.drawn = false;
  const d = b.x - game.p.x;
  if (Math.abs(d) > 55) {
    const k = d > 0 ? "right" : "left";
    const was = game.p.x;
    h.hold(k, true);
    h.frame();
    h.hold(k, false);
    if (game.p.x !== was) continue;
  }
  // alternating the plain kick with the W kick: `0x4029e0` weakens a move
  // repeated in the same direction within four seconds, down to a fifth, and a
  // different move is struck at full strength again
  const big = kicks % 2 === 1;
  if (big) h.hold("up", true);
  h.press("kick");
  h.frame();
  if (big) h.hold("up", false);
  kicks += 1;
}
if (!seen.has("01/false")) fail(`emptying 0x4a56ec should clear 0x46e080 and leave 0x46e084 up; the flags went ${[...seen.keys()].join(" -> ")}`);
if (!seen.has("00/false")) fail(`emptying 0x4a5174 should clear 0x46e084 too; the flags went ${[...seen.keys()].join(" -> ")}`);
if (!boggs().dying) fail(`with both flags down the four thousand should fall; after ${kicks} kicks it is ${boggs().hp}/4000 with flags ${flags()}`);
if (boggs().flags[0] || boggs().flags[1]) fail(`0x41be68 heals only while a flag is up; a flag is still up: ${flags()}`);
ok(`...and breaking them is the fight — one half at ${seen.get("01/false")} blows, both at ${seen.get("00/false")}, Boggs down after ${kicks} kicks (${frames} frames)`);

// the goal is `0x416047`'s, and it wants BOTH the allowance and 0x46bfbc
h.frame(18);
if (game.aliveNow() !== 0) fail(`Boggs leaves the census the frame it starts dying; ${game.aliveNow()} still count`);
ok(`and the census it was the whole of falls to nothing`);

/**
 * ...and the END. `0x41293d` is the last scene of chapter four's runner: with
 * the outer state still 6 it plays `credits.mov` and drops the chapter loop,
 * which hands the game back to its title menu.
 *
 * `credits.mov` is also the menu's own option 6 (`0x4030f7`), so the file being
 * in the rip was never evidence of an ending by itself — `0x41293d` is.
 */
// ...and WITHOUT reloading, because a reload would stand Boggs back up and
// `0x416047` would refuse the goal again. The kill was made from the west,
// inside the goal's own rect, so step out east past it and walk back in
h.hold("right", true);
for (let i = 0; i < 300 && !game.leftGoal; i++) {
  h.frame();
  await new Promise((r) => setImmediate(r));
}
h.hold("right", false);
// ...and give the craft time to come down to it
for (let i = 0; i < 120; i++) {
  h.frame();
  await new Promise((r) => setImmediate(r));
}
const toGoal = "left";
h.hold(toGoal, true);
let walked = 0;
for (; walked < 600 && !films.length; walked++) {
  h.frame();
  // the end is a film and then a load, both of them promises
  await new Promise((r) => setImmediate(r));
}
h.hold(toGoal, false);
if (!films.length) fail(`with Boggs down the goal opens and walking into it should end the game; nothing played in ${walked} frames`);
if (films[0].toLowerCase() !== "credits.mov") fail(`the sixteenth level ends on credits.mov; it played ${films[0]}`);
ok(`...and only THEN does its goal open, and walking into it ends the game — ${films[0]}, ${walked} frames on`);

// ...and then the front again, which is where 0x4032a2 sends it
for (let i = 0; i < 50 && (game.advancing || game.levelIndex !== 0); i++) await new Promise((r) => setTimeout(r, 20));
if (game.levelIndex !== 0 || game.level?.name.toLowerCase() !== "streets")
  fail(`the credits hand the game back to the front; it is level ${game.levelIndex + 1} ${game.level?.name}`);
ok(`...and hands you back to the front, which is where 0x4032a2 sends it`);

pass("VAT stands, and Boggs' machine can be broken, Boggs killed, and the game finished");
