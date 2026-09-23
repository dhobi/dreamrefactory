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
import { fail, headless, ok, pass } from "./harness";

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

pass(`the quota gates the goal, the clock and the void end the level too`);
