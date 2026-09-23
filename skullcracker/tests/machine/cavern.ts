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
import { ghengisReacts } from "../../src/brains/ghengis";
import { SKEL, SKEL_BONE, skel, skelReacts } from "../../src/brains/skel";
import { TICK_SCALE, type BrainCtx, type CastKit, type Enemy } from "../../src/brains/kit";
import { FPS, fail, headless, ok, pass } from "./harness";

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
  // `0x423334`: the body goes up at forty a frame
  const down = foe("initbat", b.death!, "dead");
  batReacts(down, b, 8, k);
  if (Math.abs(down.vy / TICK_SCALE + 40) > 1e-9) fail(`0x423334 throws a dead bat up at 40; vy ${down.vy / TICK_SCALE}`);
  ok(`a bat accelerates 3 a frame, carries no strength out of the dive, and dies thrown up at 40`);

  // the skeleton's handler, `0x423b41`/`0x423b61`: a blow of 0x3c or more is
  // the knockdown; less is a take — front tag 0, back tag 1 or 2 and 0x14 more
  const s = FOES.initskel;
  const bones = foe("initskel");
  bones.hp = 100;
  if (s.pick!({ damage: 0x3c, hits: 1, dy: 0, facingAway: false }, bones) !== 3)
    fail(`0x423b41 knocks it down for a blow of 0x3c`);
  if (s.pick!({ damage: 0x3b, hits: 1, dy: 0, facingAway: false }, bones) !== 0 || bones.hp !== 100)
    fail(`a blow to the face is tag 0 and nothing more`);
  const back = s.pick!({ damage: 0x3b, hits: 1, dy: 0, facingAway: true }, bones);
  if ((back !== 1 && back !== 2) || (bones.hp as number) !== 80)
    fail(`0x423b7d/0x423b9a: from behind it is tag 1 or 2 and 0x14 more; got ${back}, hp ${bones.hp}`);
  const knock = s.flinch![3];
  if (knock.dy?.[7] !== -420 || knock.dx?.[7] !== 170 || !knock.then)
    fail(`0x46fcf0 tag 0 throws it on cel 1265 (dx 170, dy -420) and tag 1 gets it up`);
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
  ok(`a skeleton is knocked down by 0x3c, takes 0x14 more from behind, waits to land, leaps off a take and throws its bone`);
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

pass(`CAVERN's four creatures stand, its blades swing, its bridges give way and its lifts carry`);
