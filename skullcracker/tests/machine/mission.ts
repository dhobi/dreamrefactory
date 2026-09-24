/**
 * A level ends the way `SC.EXE` ends one: the quota, then the goal, then a film.
 *
 *   npx tsx tests/machine/mission.ts        (from skullcracker/)
 *
 * `skullcracker/src/mission.ts` is where the numbers and their addresses are.
 * What this asserts is the shape of the rule rather than the numbers themselves:
 *
 *   - the quota is a SHARE of the level's own population, and until it is met the
 *     goal rect does nothing at all, because the thing you walk to is not there;
 *   - a level's order is the corrected one: level 3 is `woods`, not `sewer`;
 *   - standing in the goal rect from the first frame opens nothing;
 *   - when the mission clock runs out, one of the four TIME films plays and the
 *     level starts again;
 *   - and falling out of the world — which CITY, whose ground is 2919px below its
 *     own room rect, is the reason to have at all — costs a life and puts the
 *     player back at the level's spawn, with no film until the last life.
 *
 * `?clock=` exists for the clock: the dial is eight minutes long.
 */
import { FOES } from "../../src/foes";
import { dialCel } from "../../src/hud";
import { fail, headless, ok, pass, recordSound } from "./harness";

const h = await headless("level=1");
const { game } = h;

/** every film the game asked the page for, in order */
const films: string[] = [];
game.ui.film = async (name) => {
  films.push(name);
};
/** let the game's own async level loads (a film's aftermath) settle */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 500 && game.advancing; i++) await new Promise((r) => setTimeout(r, 10));
  if (game.advancing) fail(`the level load after the film never finished`);
};

/**
 * The game's live state, read through a call: `game.*` are module bindings that
 * the steps between two reads change, and a bare read would let the compiler
 * narrow them as if they could not.
 */
const now = () => ({ level: game.levelIndex, name: game.level?.name, lives: game.stats.lives, craft: game.craft });

/** the panel's quota, the same subtraction `0x415f55` makes */
const quota = () => ({
  left: Math.max(0, game.aliveNow() - game.stats.allowance),
  want: Math.max(0, game.stats.census - game.stats.allowance),
  census: game.stats.census,
  share: game.mission().kill,
});

// 1. STREETS: 11 things that enrol in its census, and 75% of them wanted dead.
//    Eleven and not twenty: `0x42f870(obj, 1)` is what enrols a thing, and of
//    this chapter's classes only the four were-punks call it — the nine rats,
//    the two mailboxes and the hydrant are not part of anyone's quota.
{
  const q = quota();
  if (q.share !== 0.75) fail(`STREETS asks for ${q.share * 100}% — src/mission.ts reads 0.75 at 0x46a188`);
  if (q.census !== 11) fail(`STREETS' census is ${q.census}; the eight werea and three wereb records are the eleven that enrol`);
  if (q.want !== Math.round((q.census * 75) / 100)) fail(`${q.want} wanted of a census of ${q.census} is not 75% of it`);
  if (q.left !== q.want) fail(`nothing has been killed yet and the quota already reads ${q.left} of ${q.want}`);
  if (!game.solids().goal) fail(`STREETS has no goal rect`);
  if (game.goalReady() || game.craft) fail(`STREETS' goal should still be nothing but a rect with ${q.left} to kill`);
  ok(`STREETS wants ${q.want} of ${q.census} dead (75%), and nothing stands at its goal yet`);
}

// 2. the corrected order: the third level is the woods
await h.load("level=3");
if (game.level?.name !== "woods") fail(`level 3 is "${game.level?.name}" — LEVEL_ORDER has woods third`);
ok(`level 3 is the woods (the theme numbers said sewer; 0x436b51 says otherwise)`);

// 3. ARCADE: its share is its one boss, and no television comes while it lives
await h.load("level=8");
{
  const q = quota();
  if (q.left !== 1 || q.want !== 1) fail(`ARCADE's share is its one boss; the quota reads ${q.left} of ${q.want}`);
  if (game.goalReady() || game.craft) fail(`a television must not fly in with the quota unmet`);
  ok(`ARCADE's share is its one initkragg, and no television comes while it lives`);
}
// ...and standing in the goal rect is not enough either. ARCADE's spawn point
// falls inside its own goal, which is exactly the case `leftGoal` exists for.
h.frame(30);
if (now().craft || game.craftOpened() || now().level !== 7 || game.advancing)
  fail(`ARCADE's goal opened with its boss alive: craft ${now().craft?.state}, level ${now().level + 1}`);
ok(`...and standing in the goal rect from the first frame opens nothing`);

// 4. the clock: 40 frames of an 8-minute dial, then one of the four films
await h.load("level=1&clock=40");
films.length = 0;
const out = h.until(() => films.length > 0, 60);
if (out < 0) fail(`forty frames on the clock went by and no film played (ticks ${game.stats.ticks})`);
if (!/^time[1-4]\.mov$/i.test(films[0])) fail(`the clock ran out and played "${films[0]}" — TIME1..4 are the four`);
ok(`the clock runs out after ${out} frames into ${films[0]}, one of the four 0x434540(4) picks from`);
await settle();
if (now().level !== 0 || now().name !== "streets") fail(`after the TIME film the game is at level ${now().level + 1} ${now().name}`);
if (game.stats.ticks <= 40) fail(`the level started again with the clock still spent (${game.stats.ticks})`);
ok(`and the level starts again, clock full at ${game.stats.ticks}`);

// 5. CITY has no floor — its ground is 2919 below its own room rect, which is
//    the fall. Running east off the ledge is a death, a life, and the checkpoint.
await h.load("level=2");
films.length = 0;
if (game.stats.lives !== 3) fail(`CITY starts with ${game.stats.lives} lives, not three`);
h.hold("up", true);
h.hold("right", true);
// ...and there is no film. `0x4293f3` spends a life and `0x4294cb` takes the
// ordinary path — `0x402760`, back at the checkpoint — while the count has not
// gone below zero, so the KILL vignette belongs to the last life alone.
const fell = h.until(() => game.stats.lives !== 3, 200);
h.hold("right", false);
h.hold("up", false);
// `0x4027b8` puts the corner on the record's point and the player drops the
// last few pixels onto the floor under it
const spawn = game.level!.sbk.entities.find((e) => e.name === "initplayer")!;
// the red first — fifty sixtieths of fade and state 27's hold (`0x429392`)
h.until(() => !game.deathRed, 200);
const backX = game.p.x;
h.until(() => game.p.onGround, 30);
const backAt = game.p.y;
if (fell < 0) fail(`running east off CITY's ledge for 200 frames cost no life (y ${game.p.y})`);
if (films.length) fail(`the first of three deaths should play no film — 0x4294b7; it played ${films.join(", ")}`);
ok(`running off CITY's ledge is fatal after ${fell} frames, and costs a life with no film`);
if (game.levelIndex !== 1) fail(`after the fall the game is at level ${game.levelIndex + 1}`);
if (now().lives !== 2) fail(`the fall cost ${3 - now().lives} lives`);
if (backX !== spawn.pointX) fail(`the respawn is at x ${backX}; CITY's initplayer stands at x ${spawn.pointX}`);
if (backAt !== 3925) fail(`the respawn is not CITY's own spawn point: y ${backAt}, wanted 3925`);
ok(`and it costs a life and puts them back where the level starts, x ${backX} y ${backAt}`);

/**
 * 6. ...and the goal ends the stage through the TALLY. `0x41074d` calls
 *    `0x40ffe0` as the screen's last cel runs out: from the dial on show up to
 *    the empty 12717, ten frames a step and a hundred a frame, the character's
 *    own 0x1f each time through `0x40f110`, nothing else moving; then the clock
 *    is 32000 (`0x410154`) and the flag the stage end waits for goes up.
 */
{
  const heard = recordSound(game);
  // read through a function: the tick changes it behind the checker's back
  const tallyOf = () => game.craft?.tally;
  await h.load("level=1");
  h.frame(4);
  game.setIface(false);
  for (const e of game.level!.spawned.flat())
    if (FOES[e.kind].counts && e.state !== "dead") {
      e.hp = 0;
      game.killFoe(e, FOES[e.kind]);
    }
  h.frame(2);
  const g = game.solids().goal!;
  game.p.x = g.pointX;
  game.p.y = g.pointY;
  // `0x4106a3` — and not for a player who is dying: `0x402f60` is the kind
  // under 0x1a, which every state but the dying ones is
  for (let i = 0; i < 100 * 4; i++) {
    game.p.act = "dying";
    game.p.actClock = 0;
    game.tick();
  }
  const opened = (): boolean => (game.craft as { state: string } | null)?.state === "open";
  if (opened())
    fail(`0x402f60: the craft does not open for a dying player`);
  game.p.act = null;
  if (h.until(() => game.craft?.state === "open", 400) < 0) fail(`the craft should open for a player standing at the goal`);
  ok(`the craft waits while the player is dying (0x402f60) and opens once they are not`);
  // `0x410702` — `0x402e30(0)`: the keys are dropped as the screen starts down
  // and `0x402be0` answers none of them until the tally has run
  {
    if (game.inputOpen || Object.values(game.held).some(Boolean))
      fail(`the opening shuts the keys and drops what was held: open ${game.inputOpen}, held ${JSON.stringify(game.held)}`);
    const x0 = game.p.x;
    h.hold("right", true);
    h.press("jump");
    h.frame(5);
    h.hold("right", false);
    if (game.held.right || game.jumpPressed || game.p.x !== x0 || game.p.act === "jump")
      fail(`a key pressed while the screen comes down does nothing: right ${game.held.right}, x ${x0} -> ${game.p.x}, act ${game.p.act}`);
  }
  ok(`the keys are shut while the screen comes down`);
  // its sounds: the hum asked for every frame of kind 1 (`0x4105ef`) and the
  // screen's own as it opens (`0x4106d9`), the character's, through `0x40ef30`
  const own = (id: number) => heard.filter((c) => c.call === "own" && c.args[0] === id && c.args[3] === undefined).length;
  const hums = own(0x1c);
  h.frame(10);
  if (own(0x1c) - hums !== 10) fail(`0x4105ef asks for the hum every frame; ten frames asked ${own(0x1c) - hums} times`);
  if (own(0x1d) !== 1) fail(`0x4106d9 plays 0x1d once as the screen starts down; it played ${own(0x1d)}`);
  // ...its hum's record armed to loop as it is made (`0x410212`) and let go
  // as it opens (`0x4106f8`)
  const loops = heard.filter((c) => c.call === "loop" && c.args[0] === 0x1c).map((c) => c.args[1]);
  if (loops.join() !== "true,false") fail(`0x410212 arms the hum and 0x4106f8 lets it go; the loop word went ${loops.join(" ")}`);
  ok(`the craft hums (0x1c) every frame on a loop, says 0x1d once as it opens, and lets the loop go`);
  // 3000 left: step 16 - 6 = 10, dial 12710, seven steps to the empty dial
  game.stats.ticks = 3000;
  const score = game.stats.score;
  for (let i = 0; i < 400 && !tallyOf(); i++) game.tick();
  if (tallyOf()?.dial !== 12710) fail(`the tally counts from the dial on show, 12710; it started at ${tallyOf()?.dial}`);
  if (!game.iface) fail(`0x40e120(1) puts the panel up for the tally`);
  const px = game.p.x;
  const dials: number[] = [];
  const mark = heard.length;
  // counted in ticks, four to an engine frame, from the tick it starts
  let ticks = 0;
  let last = game.stats.score;
  while (tallyOf() && ticks < 4000) {
    game.tick();
    ticks++;
    if (game.stats.score !== last) {
      last = game.stats.score;
      dials.push(game.tallyDial() ?? dialCel(game.stats.ticks));
    }
    if (game.p.x !== px) fail(`nothing moves while the tally runs`);
  }
  const frames = Math.ceil(ticks / 4);
  const gained = game.stats.score - score;
  if (frames !== 70 || gained !== 7000)
    fail(`seven steps are seventy frames and seven thousand points; it took ${frames} frames for ${gained}`);
  if (dials[0] !== 12710 || dials[9] !== 12710 || dials[10] !== 12711 || dials[68] !== 12716 || dials[69] !== 12717)
    fail(`the dial steps on once every ten frames to the empty 12717; saw ${[...new Set(dials)].join(" ")}`);
  const ding = heard.slice(mark).filter((c) => c.call === "own" && c.args[0] === 0x1f && c.args[3] === "renew");
  if (ding.length !== 70) fail(`each hundred is the character's 0x1f through 0x40f110; heard ${ding.length}`);
  if (game.stats.ticks !== 32000 || !game.craftOpened()) fail(`then the clock is 32000 and the stage is over; ticks ${game.stats.ticks}`);
  // `0x410754` — `0x402e30(1)` opens them again as the flag goes up
  if (!game.inputOpen) fail(`the tally's end opens the keys again (0x410754)`);
  ok(`the goal tallies the clock: seven dial steps, seventy frames, seven thousand points, then 32000`);

  // ...and past step 12 the dial flashes, and a stage finished on a frame that
  // shows the empty 12717 (`0x40d2b3`) tallies nothing at all
  await h.load("level=1");
  h.frame(4);
  for (const e of game.level!.spawned.flat())
    if (FOES[e.kind].counts && e.state !== "dead") {
      e.hp = 0;
      game.killFoe(e, FOES[e.kind]);
    }
  h.frame(2);
  game.p.x = g.pointX;
  game.p.y = g.pointY;
  h.until(() => game.craft?.state === "open", 400);
  const before = game.stats.score;
  for (let i = 0; i < 400 && !game.craftOpened(); i++) {
    // 1000 left is step 14, and an even count is the empty half of the flash
    game.stats.ticks = 1000;
    game.tick();
  }
  if (!game.craftOpened() || game.stats.score !== before || game.stats.ticks !== 32000)
    fail(`on the flash's empty frame the tally gives nothing; +${game.stats.score - before}, ticks ${game.stats.ticks}`);
  ok(`...and on the flash's empty frame it gives nothing and the stage ends at once`);
  game.setSound(null);
}

pass(`the quota gates the goal, the clock and the void end the level too`);
