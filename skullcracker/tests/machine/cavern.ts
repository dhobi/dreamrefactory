/**
 * CAVERN — level ten, and the widest level in the game: 3555 pixels across and
 * 2275 deep in one region alone.
 *
 *   npx tsx tools/runmachine.mts cavern      (from skullcracker/)
 *
 * Five new things stand in it:
 *
 *   - **the bat** (`0x41ead0`), whose divisor is **1** — the lowest in the game,
 *     and the only creature that divides its script's dx by nothing. It is also
 *     frail in the engine's own sense: `0x4232f0` has no subtraction in it at
 *     all, so one blow of any size fells one. And it does not count: `0x41ead0`
 *     never calls `0x42f870`, which is why ten of them leave the census at 19.
 *   - **Ghengis** (`0x41ea20`), two hundred health and four hundred points.
 *   - **the skeleton** (`0x41ed70`), two hundred health and **450** — the most
 *     any ordinary creature in the game is worth.
 *   - **the swinging blade** (`0x41ef90`), fifteen of them, whose whole think is
 *     three tags handed round in a ring: twenty-seven cels, one engine frame
 *     each, a blow of a hundred on every one.
 *   - **the rope bridge** (`0x41e9c0`), which you can cross and cannot stand on.
 */
import { FOES } from "../../src/foes";
import { bat, batReacts } from "../../src/brains/bat";
import { GHENGIS, ghengisReacts } from "../../src/brains/ghengis";
import { SKEL, SKEL_BONE, skel, skelReacts } from "../../src/brains/skel";
import { TICK_SCALE, install, type BrainCtx, type CastKit, type Enemy } from "../../src/brains/kit";
import { gobCount } from "../../src/effects";
import { FPS, fail, headless, ok, pass } from "./harness";
import type { FoeAnim } from "../../src/foes";

/**
 * The machines themselves, on their own: a brain handed a stand-in context,
 * called once an engine frame as `stepFight` calls it.
 */
const machines = (): void => {
  const casts: CastKit[] = [];
  const said: number[] = [];
  const k = {
    player: { x: 0, y: 0, top: 0, anchor: 0, vy: 0, swinging: false, down: false, facing: 1 },
    track: () => ({ forward: 1000, dy: 0, band: 0, side: 1 }),
    anchorY: (e: Enemy) => e.y,
    anchorX: (e: Enemy) => e.x,
    shake: () => {},
    flash: () => {},
    burn: () => {},
    spray: () => {},
    roll: () => 1,
    say: (_e: Enemy, id: number) => said.push(id),
    cast: (_e: Enemy, kit: CastKit) => casts.push(kit),
    gravity: 1,
  } as unknown as BrainCtx;
  const foe = (kind: string, anim = FOES[kind].gait, state: Enemy["state"] = "gait"): Enemy => ({
    kind,
    x: 0,
    y: 0,
    facing: 1,
    left: -500,
    right: 500,
    top: -500,
    bottom: 500,
    clock: 0,
    state,
    anim,
    linger: 0,
    dents: 0,
    vx: 0,
    vy: 0,
    hp: 1,
    max: 1,
  });

  // `0x422c60`: the death ends in nine pieces and one blast at 0x65, sound 0x30
  const g = FOES.initghengis;
  const dead = foe("initghengis", g.death!, "dead");
  const run = g.death!.cels.length * g.death!.hold;
  dead.clock = run - 1;
  ghengisReacts(dead, g, run, k);
  if (casts.length) fail(`nothing comes apart before the death's cels end`);
  dead.clock = run;
  ghengisReacts(dead, g, run, k);
  ghengisReacts(dead, g, run, k);
  const blast = casts.filter((c) => c.blow === 0x65);
  if (casts.length !== 10 || blast.length !== 1 || !said.includes(0x30))
    fail(`0x422c60 puts down nine pieces and one 0x65 blast; got ${casts.length} casts, ${blast.length} blasts`);
  if (g.linger !== 0) fail(`0x422a83 answers 1 as the burst goes out: no body`);
  if (!g.flinch?.[0].from.includes("0x46eec8"))
    fail(`0x422c32 installs 0x46eec8 as the flinch, not ${g.flinch?.[0].from}`);
  ok(`Ghengis comes apart in nine pieces over a 0x65 blast, and flinches on 0x46eec8`);

  // `0x422f0e` and the cruise's dx 3 through a divisor of one: three pixels a
  // frame more every frame, spent once a call
  const b = FOES.initbat;
  const cruise = foe("initbat", { ...b.gait, kind: 3, tag: 0 });
  cruise.script = 3;
  cruise.tag = 0;
  bat(cruise, b, 4, k);
  const gained = cruise.vx / TICK_SCALE;
  if (Math.abs(gained - 3) > 1e-9) fail(`a cruising bat gains 3 px a frame per frame; it gained ${gained}`);
  if (cruise.strength !== 0) fail(`0x422f30 zeroes a bat's strength outside the shallow dive`);
  // `0x4232b2`: the body goes the frame it has landed, and not the frame it dies
  const down = foe("initbat", b.death!, "dead");
  down.linger = Infinity;
  batReacts(down, b, 8, k);
  if (down.linger === 0) fail(`0x4232b2 waits for the body to move before it asks whether it has landed`);
  batReacts(down, b, 8, k);
  if (down.linger !== 0) fail(`...and a body at rest has landed and goes`);
  if (b.hitVel?.vy !== -40 || b.sprayAmount !== 0x3c || !b.codeBlind || !b.corpseTakesHits)
    fail(`0x4232f0: obj+0xa = -40 before the exchange, a spray of 0x3c, no sign test and no state test`);
  ok(`a bat accelerates 3 a frame, carries no strength out of the dive, and its body goes when it lands`);

  // the skeleton's handler, `0x423b41`/`0x423b61`: a blow of 0x3c or more is
  // the knockdown; less is a take — front tag 0, back tag 1 or 2 and 0x14 more
  const s = FOES.initskel;
  const bones = foe("initskel");
  bones.hp = 100;
  // `0x423b61`: the side is the CONTACT's x against its own point, not the
  // hitter's facing — facing east, a contact west of the point is its back
  const at = (contactX: number) => ({ damage: 0x3b, hits: 1, dy: 0, facingAway: false, contactX, pointX: 100 });
  if (s.pick!({ ...at(130), damage: 0x3c }, bones) !== 3)
    fail(`0x423b41 knocks it down for a blow of 0x3c`);
  if (s.pick!(at(130), bones) !== 0 || s.pick!(at(100), bones) !== 0 || bones.hp !== 100)
    fail(`a blow met in front of its point, or on it, is tag 0 and nothing more`);
  const back = s.pick!(at(90), bones);
  if ((back !== 1 && back !== 2) || (bones.hp as number) !== 80)
    fail(`0x423b7d/0x423b9a: met behind its point it is tag 1 or 2 and 0x14 more; got ${back}, hp ${bones.hp}`);
  bones.facing = -1;
  bones.hp = 100;
  if (s.pick!(at(90), bones) !== 0 || bones.hp !== 100)
    fail(`...and facing west, west of its point is its face`);
  bones.facing = 1;
  const knock = s.flinch![3];
  if (knock.dy?.[7] !== -420 || knock.dx?.[7] !== 170 || !knock.then)
    fail(`0x46fcf0 tag 0 throws it on cel 1265 (dx 170, dy -420) and tag 1 gets it up`);
  // `0x423941`: and the get-up hands to the walk, kind 1 — not to the statue
  if (knock.then.resume?.kind !== 1 || knock.then.resume.cels[0] !== SKEL.walk.cels[0])
    fail(`0x423941 installs 0x46fac0, the walk, as the get-up ends; it resumes kind ${knock.then.resume?.kind}`);
  // `0x42391d`: the get-up waits for the landing
  const flying = foe("initskel", knock, "flinch");
  const knockRun = knock.cels.length * knock.hold;
  flying.clock = knockRun;
  flying.vy = -5;
  skelReacts(flying, s, knockRun, k);
  if (flying.clock >= knockRun) fail(`in the air the knockdown holds its last cel`);
  flying.vy = 0;
  flying.clock = knockRun;
  skelReacts(flying, s, knockRun, k);
  if (flying.clock < knockRun) fail(`on the ground it goes on to the get-up`);
  // `0x423965`: a take ends in the standing leap on 0x434540(5) < 4
  const took = foe("initskel", s.flinch![0].resume!);
  took.script = 7;
  skel(took, s, 1, k);
  if (took.script !== 5 || took.tag !== 0) fail(`0x423981 springs away on a roll of 1; went to kind ${took.script}`);
  // `0x4238a3`: the wind-up's end lets the bone go
  const wind = foe("initskel", SKEL.wind);
  wind.script = 4;
  wind.tag = 0;
  wind.clock = 99;
  casts.length = 0;
  skel(wind, s, 12, k);
  if (casts[0] !== SKEL_BONE) fail(`0x4238a3 throws the bone as the wind-up ends`);
  // `0x4239b5` asks for 0x15 on all three frames of the death's third cel,
  // and `0x427b20` refuses the same sound while it plays: heard once
  said.length = 0;
  const dying = foe("initskel", s.death!, "dead");
  const deathRun = s.death!.cels.length * s.death!.hold;
  const asks: number[] = [];
  for (dying.clock = 0; dying.clock < deathRun; dying.clock += 1) {
    const before = said.length;
    skelReacts(dying, s, deathRun, k);
    if (said.length > before) asks.push(dying.clock);
  }
  const cel2 = [0, 1, 2].map((i) => 2 * s.death!.hold + i);
  if (asks.join() !== cel2.join() || said.some((n) => n !== SKEL.groan))
    fail(`0x4239b5 asks for the groan on each frame of cel 2, for the mixer to refuse the repeats (sound.ts step 0); asked on ${asks.join(",")}: ${said.join(",")}`);
  ok(`a skeleton is knocked down by 0x3c, takes 0x14 more from behind, waits to land, leaps off a take, throws its bone and asks for its groan on each frame of cel 2 as it dies`);
};

machines();

const h = await headless("level=10");
const { game } = h;
const go = async (x?: number): Promise<void> => {
  await h.load(`level=10${x === undefined ? "" : `&x=${x}`}`);
  h.until(() => game.p.onGround, 60);
  h.frame(4);
};
const nearestOf = (kind: string): Enemy | undefined =>
  game
    .spawnedHere()
    .filter((e) => e.kind === kind)
    .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];
// every cel the fought one showed, by the state it was in
const shown = new Map<string, Set<number>>();
/**
 * Fight the nearest of a kind until it is down, and answer what it paid.
 *
 * The blow lands AHEAD of the player's anchor, not on it: the kick's impact cel
 * 655 hangs its strike rect 42..63 px in front (and the lunge carries it out
 * further), the punch's 604 57..104. So the fight faces the thing and strikes
 * while it is 30..200 px in front, and walks round it otherwise. `blow` is the
 * punch for the bat: its dive levels out once `player.y - self.y` is no longer
 * above 45 (`0x4231b7`), which leaves its body just over the standing kick's
 * rect (anchor -45..-19) and inside the punch's (-49..-10).
 */
const fell = (kind: string, frames: number, blow: "kick" | "punch" = "kick"): number => {
  const before = game.stats.score;
  const foe = nearestOf(kind);
  if (!foe) fail(`no ${kind} near x${game.p.x}`);
  let face = 0;
  const note = (): void => {
    const key = `${kind} ${foe.state}`;
    (shown.get(key) ?? shown.set(key, new Set()).get(key)!).add(game.celOf(foe));
  };
  for (let i = 0; i < frames && foe.state !== "dead"; i++) {
    const d = foe.x - game.p.x;
    const ahead = d * face;
    if (ahead > 30 && ahead < 200) {
      if (!game.p.act) h.press(blow);
      for (let f = 0; f < 3; f++) {
        h.frame();
        note();
      }
    } else {
      const key = d > 0 ? "right" : "left";
      face = d > 0 ? 1 : -1;
      h.hold(key, true);
      h.frame();
      note();
      h.hold(key, false);
    }
  }
  if (foe.state !== "dead") fail(`the ${kind} was still standing after ${frames} frames: ${foe.hp}/${foe.max}`);
  for (let f = 0; f < 9; f++) {
    h.frame();
    note();
  }
  return game.stats.score - before;
};

// 1. five regions, and a census that leaves the bats out
await go();
if (game.level!.rooms.length !== 5) fail(`CAVERN has five regions; it has ${game.level!.rooms.length}`);
const kill = Math.round(game.mission().kill * 100);
if (kill !== 85 || game.stats.census !== 19) fail(`8 zombies, 5 Ghengis and 6 skeletons count and 10 bats do not — 19; the census is kill ${kill}% of ${game.stats.census}`);
ok(`CAVERN is five regions and a census of ${game.stats.census}, its ten bats uncounted`);

// 2. ...and NO clock. `0x421ead` hands 32000 when the book has no `timer`
//    record, and CAVERN has none.
if (game.stats.clockFull !== 32000) fail(`CAVERN carries no timer record, so its clock is 32000; it is full at ${game.stats.clockFull}`);
ok(`and no timer record at all, so no limit: ${game.stats.clockFull}`);

// 3. a bat is frail — one blow of any size, and seventy points
await go(2290);
h.frame(9);
const aBat = nearestOf("initbat");
// unplated: nothing of the bat's class calls `0x40d1c0`
if (!aBat || aBat.hp !== 1 || aBat.max !== 1 || FOES.initbat.panel) fail(`a bat has no health to subtract and no plate; it has ${aBat?.hp}/${aBat?.max}`);
const batPay = fell("initbat", 360, "punch");
if (batPay !== 70) fail(`0x42333c pays 0x46 for a bat; the score rose ${batPay}`);
ok(`a bat falls to one blow for ${batPay} points`);

/**
 * ...and what the one blow does, through the page's own hit path. `0x423334`
 * writes `obj+0xa = -40` and `0x430470` weighs it in after: against the
 * player's mass the body goes DOWN. `0x423313` sprays sixty whatever the blow.
 * The corpse still shows 2205/2206, which carry a body, and `0x4232f0` has no
 * state test, so it is struck again and pays again; and there is no sign test,
 * so a −9 fells one too.
 */
await go(2290);
h.frame(9);
const strikeBat = (b: Enemy, code = 0): void => {
  const a = game.foeAnchor(b, game.level!)!;
  const box = { left: a.x - 20, right: a.x + 20, top: a.y - 20, bottom: a.y + 20 };
  game.strikeFoe(b, code ? 0 : 47, { dx: 20, dy: 0 }, 1, a.y, box, code, { x: a.x, y: a.y });
};
const hitBat = nearestOf("initbat")!;
const gobsBefore = game.gobs.length;
const paidBefore = game.stats.score;
strikeBat(hitBat);
if (hitBat.state !== "dead") fail(`one blow fells a bat`);
if (!(hitBat.vy > 0)) fail(`the exchange turns 0x423334's -40 round: the body leaves downwards, vy ${hitBat.vy / TICK_SCALE}`);
if (game.gobs.length - gobsBefore !== gobCount(0x3c))
  fail(`0x423313 sprays 0x3c whatever the blow: ${gobCount(0x3c)} gobs, got ${game.gobs.length - gobsBefore}`);
strikeBat(hitBat);
if (game.stats.score - paidBefore !== 140 || hitBat.clock !== 0)
  fail(`a falling bat is struck again and pays again; the score rose ${game.stats.score - paidBefore}`);
const burnt = game.spawnedHere().find((e) => e.kind === "initbat" && e.state !== "dead");
if (!burnt) fail(`another bat to set a −9 on`);
strikeBat(burnt, -9);
if (burnt.state !== "dead") fail(`0x4232f0 reads no code: a −9 fells a bat`);
ok(`a bat's body leaves downwards, sprays ${gobCount(0x3c)} gobs, pays again when struck falling, and a −9 fells one`);

// 4. a skeleton: two hundred, and 450 — the most in the game
await go(2990);
h.frame(9);
const sk = nearestOf("initskel");
if (!sk || sk.hp !== 200 || sk.max !== 200) fail(`0x41edc4 gives it 0x40e300(0xc8); it has ${sk?.hp}/${sk?.max}`);
const skelPay = fell("initskel", 600);
if (skelPay !== 450) fail(`0x423b1b pays 0x1c2 for a skeleton; the score rose ${skelPay}`);
ok(`a skeleton is two hundred health and ${skelPay} points`);
/**
 * ...and what a blow shows on it. `0x423b41`: a blow of 0x3c or more is the
 * knockdown `0x46fcf0` (1260..1265, thrown, then 1266..1268 getting up); less is
 * one of `0x46fd58`'s takes — 1260 from the front, 1212 or 1261 from behind.
 * Nothing outside those.
 */
const skelTake = [...(shown.get("initskel flinch") ?? [])];
const takes = new Set([1212, 1260, 1261, 1262, 1263, 1264, 1265, 1266, 1267, 1268]);
if (!skelTake.length) fail(`a skeleton should react to the kicks; saw no flinch cel`);
if (skelTake.some((c) => !takes.has(c))) fail(`its reactions are 0x46fd58 and 0x46fcf0; the flinch showed ${skelTake.join(" ")}`);
const skelDeath = [...(shown.get("initskel dead") ?? [])];
if (!skelDeath.length || skelDeath.some((c) => c < 1350 || c > 1359)) fail(`0x46fd90 is 1350..1359; the death showed ${skelDeath.join(" ")}`);
ok(`...its reactions show ${skelTake.sort().join(" ")}, its death ${skelDeath.sort().join(" ")}`);

// 5. Ghengis: two hundred and four hundred
await go(5520);
h.frame(9);
const gh = nearestOf("initghengis");
if (!gh || gh.hp !== 200 || gh.max !== 200) fail(`0x41ea74 gives it 0x40e300(0xc8); it has ${gh?.hp}/${gh?.max}`);
const gPay = fell("initghengis", 600);
if (gPay !== 400) fail(`0x422bea pays 0x190 for Ghengis; the score rose ${gPay}`);
ok(`Ghengis is two hundred health and ${gPay} points`);

/**
 * ...and its goo flies loose. `0x422b73` hands `0x40cba0` no hitter, so
 * `0x40ce7d`..`0x40ce9d` gives every gob `0x434540(0x50) - 0x28` on both
 * axes — −39..40 — with nothing of the blow in it: a blow driving east still
 * throws some of it west, and some of it up.
 */
await go(5520);
h.frame(9);
{
  const g = nearestOf("initghengis")!;
  const a = game.foeAnchor(g, game.level!)!;
  const before = game.gobs.length;
  const box = { left: a.x - 20, right: a.x + 20, top: a.y - 20, bottom: a.y + 20 };
  // a strong blow straight east, so a directed spray would all go one way
  game.strikeFoe(g, 120, { dx: 90, dy: 0 }, 1, a.y, box, 0, { x: a.x, y: a.y });
  const thrown = game.gobs.slice(before).map((q) => ({ vx: q.vx / TICK_SCALE, vy: q.vy / TICK_SCALE }));
  const out = thrown.filter((q) => q.vx < -39 || q.vx > 40 || q.vy < -39 || q.vy > 40);
  if (thrown.length !== gobCount(120) || out.length || !thrown.some((q) => q.vx < 0) || !thrown.some((q) => q.vy < 0))
    fail(`0x422b73: Ghengis' goo flies loose, −39..40 on both axes; ${thrown.length} gobs, ${JSON.stringify(thrown.slice(0, 4))}`);
  ok(`its goo flies loose on both axes, as 0x40ce7d does for a spray with no hitter`);
}

// 6. the blades. `0x4702c8`'s three tags are a ring of 27 cels, one engine
//    frame each, and the think does nothing else; every one of them is 4040..4052.
await go(6250);
const axe = game.hereOf((l) => l.axes).find((a) => a.x === 6271);
if (!axe) fail(`a blade hangs at x6271`);
const seen: number[] = [];
for (let i = 0; i < 27; i++) {
  h.frame();
  seen.push(game.axeCel(axe));
}
if (seen.some((c) => c < 4040 || c > 4052)) fail(`0x4702c8 is 4040..4052; saw ${seen.join(" ")}`);
const ring = seen.join();
for (let i = 0; i < 27; i++) h.frame();
const again: number[] = [];
for (let i = 0; i < 27; i++) {
  h.frame();
  again.push(game.axeCel(axe));
}
if (again.join() !== ring) fail(`a blade rings its 27 cels, one a frame; the second round was ${again.join(" ")} after ${ring}`);
ok(`a blade rings through ${new Set(seen).size} of its own 4040..4052, round and round every 27 frames`);

// 7. the bridge. It rocks under you, and `0x4223f5` counts the rocks — five is
//    all it gives you (`0x422460` adds one as each ends); after that it falls,
//    and the `platform` record laid over it — CAVERN files one per bridge, rect
//    for rect, and the bridge owns it (`0x41e9ec`) — drops with it (`0x4224ad`).
//    Six rocks of four frames and eight falling frames.
await h.load("level=10&x=7600&y=1100");
const bridge = game.hereOf((l) => l.bridges).find((b) => b.x === 7690);
if (!bridge) fail(`a bridge spans x7690`);
const states: string[] = [];
let lowest = 1100;
for (let i = 0; i < 85; i++) {
  h.frame();
  if (states[states.length - 1] !== bridge.state) states.push(bridge.state);
  lowest = Math.max(lowest, game.p.y);
}
if (!states.includes("gone")) fail(`a bridge stood on should end up gone; it went ${states.join(" -> ")}`);
const rocks = states.filter((q) => q === "rocking").length;
if (rocks !== 6) fail(`0x4223f5 lets it rock until the count passes five — six rocks; it rocked ${rocks}`);
if (lowest < 1300) fail(`and the platform should go with it — the player never fell, reaching only y ${lowest}`);
ok(`standing on a bridge rocks it ${rocks} times, then it falls and is gone, and the floor goes with it`);

// ...and its four LIFTS carry you, which is the only way up out of its second
// room. Two chapters spawn `initelev` and each installs its own script,
// identical but for the cel it names: `0x472578` is 3202 (chapter two, SEWER's
// six) and `0x4703a8` is 5210 (chapter three, CAVERN's four). Neither creator
// writes `[obj+0]`, so the script is the whole of it.
//
// The level's own second `initplayer`, which stands beside the x4944 shaft
await h.load("level=10&x=4828&y=1988");
h.frame(9);
const started = game.p.y;
let top = started;
for (let i = 0; i < 10 * FPS; i++) {
  h.frame();
  top = Math.min(top, game.p.y);
}
// the x4944 shaft's record is y1170..2132; a rider that is carried clears most of it
if (started - top < 500) fail(`the x4944 lift should carry the player up its shaft; started at y ${started} and the highest was y ${top}`);
ok(`...and its lifts carry a rider — y ${started} up to y ${top}, on chapter three's own cel 5210`);

// ...and its flinch is state 8: the frame the two cels end, `0x422a25` rolls
// between the walk and the bull rush, and that script goes on that frame
await go(5520);
h.frame(9);
{
  const g = nearestOf("initghengis")!;
  const take = FOES.initghengis.flinch![0];
  g.state = "flinch";
  g.anim = take;
  g.clock = 0;
  g.script = take.kind;
  g.tag = take.tag;
  g.asleep = false;
  let f = 0;
  while (g.state === "flinch" && g.anim === take && f < 20) {
    h.frame();
    f += 1;
  }
  if (f !== take.cels.length * take.hold || (g.anim !== GHENGIS.stride && g.anim !== GHENGIS.windUp))
    fail(`the flinch is ${take.cels.length * take.hold} frames and then the walk or the rush; ${f} frames, then ${g.anim.from}`);
  ok(`Ghengis' flinch hands to ${g.anim === GHENGIS.stride ? "the walk" : "the bull rush"} after ${f} frames, the frame it ends (0x422a25)`);
}

/**
 * A reaction that is a state of the machine — {@link FoeAnim.decides} — hands
 * its own case the frame the script ends, and the next script goes on then:
 * exactly the script's own frames, and nothing between. A fresh one of `kind`
 * near where the level puts it, given the reaction by hand.
 */
const handOff = async (lv: number, kind: string, take: FoeAnim, next: readonly FoeAnim[], hp?: number): Promise<number> => {
  await h.load(`level=${lv}`);
  const at = game.level!.spawned.flat().find((q) => q.kind === kind);
  if (!at) fail(`level ${lv} places no ${kind}`);
  await h.load(`level=${lv}&x=${Math.round(at.x)}&y=${Math.round(at.y) - 20}`);
  h.until(() => game.p.onGround, 60);
  const e = game
    .spawnedHere()
    .filter((q) => q.kind === kind && q.state !== "dead")
    .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];
  if (!e) fail(`no ${kind} near x${at.x}`);
  e.asleep = false;
  if (hp !== undefined) e.hp = hp;
  e.state = "flinch";
  e.anim = take;
  e.clock = 0;
  e.script = take.kind;
  e.tag = take.tag;
  let f = 0;
  while (e.state === "flinch" && e.anim === take && f < 60) {
    h.frame();
    f += 1;
  }
  if (f !== take.cels.length * take.hold || !next.includes(e.anim))
    fail(`${kind}: ${take.from} is ${take.cels.length * take.hold} frames and then ${next.map((a) => a.from).join(" or ")}; ${f} frames, then ${e.anim.from}`);
  return f;
};

{
  // the skeleton's three takes are kind 7, and `0x423965` rolls on `obj+0x46`
  const S = FOES.initskel.flinch!;
  const f: number[] = [];
  for (let t = 0; t < 3; t++) f.push(await handOff(10, "initskel", S[t], [SKEL.leap, SKEL.walk]));
  ok(`the skeleton's takes hand to the leap or the walk after ${f.join(", ")} frames (0x423965)`);
}

/**
 * The skeleton's GRAB, and what it does to him.
 *
 * `0x4236b1`: the reach ends with him inside a hundred, nobody holding him
 * (`[0x46b1b4]`), within fifty of its row and upright, so `0x4236f8` takes him
 * — undrawn from here, the 1240s draw him — and installs `0x46faf8`. Every
 * frame of it (`0x423756`) he faces it, is held fifty-one in front and
 * thirty-eight up, and loses five (`0x402ac0(5)`); as it ends he is thrown a
 * hundred on and thirty up, drawn again, and knocked down (`0x402fa0(2)`).
 */
{
  await h.load("level=10&x=2990&damage=1");
  h.until(() => game.p.onGround, 60);
  h.frame(4);
  const e = game.level!.spawned.flat().find((q) => q.kind === "initskel")!;
  const S = FOES.initskel;
  const k = game.BRAIN_CTX;
  install(e, SKEL.stoop, true);
  e.state = "gait";
  e.asleep = false;
  e.facing = -1;
  e.x = game.p.x + 60;
  e.y = game.p.y;
  e.clock = SKEL.stoop.cels.length * SKEL.stoop.hold;
  skel(e, S, e.clock, k);
  if (e.script !== 3 || !game.p.hidden) fail(`0x4236f8: the reach ends in the grab, and he is not drawn; kind ${e.script}, hidden ${game.p.hidden}`);
  const hp0 = game.stats.health;
  const run = e.anim.cels.length * e.anim.hold;
  let held = 0;
  for (e.clock = 0; e.clock < run; e.clock += 1) {
    skel(e, S, run, k);
    const at = { x: k.anchorX(e) + (e.facing > 0 ? 0x33 : -0x33), y: k.anchorY(e) - 0x26 };
    if (Math.abs(game.p.x - at.x) < 1 && Math.abs(k.player.anchor - at.y) < 1 && game.p.facing === -e.facing) held += 1;
  }
  const drained = hp0 - game.stats.health;
  skel(e, S, run, k);
  if (held !== run || drained !== 5 * run) fail(`0x423756: held in front, facing it, five a frame; held ${held} of ${run}, ${drained} taken`);
  if (game.p.hidden || game.p.act !== "downFront") fail(`0x4237f8 / 0x423801: thrown, drawn again and knocked down; ${game.p.act}, hidden ${game.p.hidden}`);
  ok(`a skeleton grabs him, holds him ${run} frames for ${drained} health, and throws him down (0x423756)`);
}

/**
 * ...and a blow that lands on it mid-grab leaves him undrawn, as the disc does.
 *
 * `0x423a30` turns away only its own class and a code — there is no state test
 * like the arm's (`0x418b40`) — so the flinch replaces the grab, and nothing
 * but a life or a level starting (`0x429528`, `0x42e5a1`) sets `[0x46b1b4]`
 * back. Kept as SC.EXE has it: he is invisible, and no other grabber takes him.
 */
{
  await h.load("level=10&x=2990&damage=1");
  h.until(() => game.p.onGround, 60);
  h.frame(4);
  const e = game.level!.spawned.flat().find((q) => q.kind === "initskel")!;
  const k = game.BRAIN_CTX;
  install(e, SKEL.stoop, true);
  e.state = "gait";
  e.asleep = false;
  e.facing = -1;
  e.x = game.p.x + 60;
  e.y = game.p.y;
  e.clock = SKEL.stoop.cels.length * SKEL.stoop.hold;
  skel(e, FOES.initskel, e.clock, k);
  if (e.script !== 3 || !game.p.hidden) fail(`the grab should have him before the blow`);
  const box = { top: e.y - 120, left: e.x - 30, bottom: e.y, right: e.x + 30 };
  game.strikeFoe(e, 20, { dx: 20, dy: 0 }, 1, e.y - 60, box);
  h.frame(40);
  if (e.script === 3 || !game.p.hidden || k.player.free)
    fail(`a blow mid-grab flinches it and leaves him undrawn and claimed: kind ${e.script}, hidden ${game.p.hidden}, free ${k.player.free}`);
  ok(`a blow that lands on a skeleton mid-grab leaves him undrawn until the next life, as 0x423a30 has no state test`);
}

pass(`CAVERN's four creatures stand, its blades swing, its bridges give way and its lifts carry`);
