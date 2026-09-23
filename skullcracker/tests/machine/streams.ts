/**
 * The three HELD weapons — the flamer, the soaker and the scepter.
 *
 *   npx tsx tests/machine/streams.ts        (from skullcracker/)
 *
 * They are one shape with three sets of numbers: the fire function adds an
 * object to a list the player owns, `0x421700` plants it at the player's own
 * point plus a filed `(dx, dy)` every frame, and two negative variants stop it —
 * `-2` for the shutting-off animation and `-1` for being hit.
 *
 * And they do not all hit with the same thing. The soaker's water and the
 * scepter's beam carry a hundred (`0x4217ba`, `0x424630`); the FLAME carries the
 * code -9 (`0x453b9b`), which nothing in these sixteen levels reads.
 */
import { STREAMS, WEAPONS } from "../../src/guns";
import { fail, headless, ok, pass } from "./harness";

const h = await headless("level=9&x=2058");
const { game } = h;

const quota = (): number => Math.max(0, game.aliveNow() - game.stats.allowance);
const holding = (): string => `${game.inv.armed ? "holding" : "no"} ${WEAPONS[game.inv.weapon]?.name ?? game.inv.weapon} ${game.roundsIn(game.inv.weapon)}`;
const stream = (): string =>
  game.streams.length ? `stream ${game.streams[0].state} cel ${game.streamCel(game.streams[0])}` : "no stream";

/** open a level, let the spawn settle, then take what is underfoot */
const armAt = async (level: number, x: number): Promise<void> => {
  await h.load(`level=${level}&x=${x}`);
  h.frame(6);
  let last = "";
  h.until(() => {
    const now = `${game.p.x},${game.p.y}`;
    const same = now === last;
    last = now;
    return same;
  }, 40);
  h.hold("down", true);
  h.frame(14);
  h.hold("down", false);
  h.frame(8);
};

// 1. GRAVE's soaker opens, loops and drains — one round an engine frame
await armAt(9, 2058);
if (!game.inv.armed || WEAPONS[game.inv.weapon]?.name !== "soaker") fail(`GRAVE's statsoaker should arm you: ${holding()}`);
const soaker = game.inv.weapon;
const full = game.roundsIn(soaker);
const quotaWas = quota();
// ...facing WEST, because the spout is filed 170 ahead of the player and its
// own cel reaches another 200 past that: a stream has a dead zone in front of
// it, and GRAVE's zombies are all to the west of the gun
h.hold("left", true);
h.frame(17);
h.hold("left", false);
h.frame(3);
h.hold("punch", true);
h.frame(4);
const opening = game.streams[0];
if (!opening || opening.state === "stop") fail(`holding P should open a stream; ${stream()}`);
const cel = game.streamCel(opening);
if (cel < 9800 || cel > 9899) fail(`the soaker's own 9800..9807, not ${cel}`);
ok(`GRAVE's soaker opens on its own ${cel}`);

h.frame(11);
if (game.streams[0]?.state !== "loop") fail(`the start animation ending installs tag 1 (0x4217a5); ${stream()}`);
const left = game.roundsIn(soaker);
if (!(left < full - 4)) fail(`0x45ef00(1) takes a round an engine frame; went ${full} -> ${left}`);
ok(`...loops on its tag 1, and drains ${full} to ${left} while it is held`);

// 2. ...and it KILLS, at the magnitude of its own cel's pair
h.frame(38);
const quotaNow = quota();
h.hold("punch", false);
if (!(quotaNow < quotaWas)) fail(`the water carries a hundred (0x4217ba) and should fell a zombie; quota stayed ${quotaWas}`);
ok(`and it fells them — the quota went ${quotaWas} to ${quotaNow}`);

// 3. an empty gauge shuts it off, and letting go does too
h.frame(14);
if (game.streams.length) fail(`releasing P sends -2 and the stream should be gone: ${stream()}`);
ok(`...and -2 puts it away when the button comes up`);

// 4. the FLAME is a code. WOODS' statflamer is the one on the ground.
await armAt(3, 6980);
if (!game.inv.armed || WEAPONS[game.inv.weapon]?.name !== "flamer") fail(`WOODS' statflamer at x6980 should arm you: ${holding()}`);
const before = quota();
// ...and read it before the gauge runs dry: forty-one rounds at one an engine
// frame is under three seconds of flame
h.hold("punch", true);
h.frame(21);
if (!game.streams.length) fail(`the flamer should be pouring; ${stream()}`);
const blow = STREAMS[game.streams[0].weapon]?.blow;
if (blow !== -9) fail(`0x453b9b gives the flame -9; the stream carries ${blow}`);
h.frame(21);
const after = quota();
h.hold("punch", false);
// ...and −9 is a code, not a blow: nothing takes damage from the stream
// itself. What it sets on fire can still die of it — the punks' burn state
// takes ten a frame for fifteen frames (`0x44ed8c`, `0x44f735`) — so the
// quota is allowed to move, and only ever down by what burned
if (after > before) fail(`the quota went UP under the flame: ${before} -> ${after}`);
ok(`WOODS' flamer pours -9, a code and not a blow (${before} -> ${after} of the quota, by burning)`);

// 5. the scepter arms with the one round 0x45eed0 gives and spends forty
await armAt(11, 13690);
if (!game.inv.armed || WEAPONS[game.inv.weapon]?.name !== "scepter" || game.roundsIn(game.inv.weapon) !== 1)
  fail(`statscepter files no rounds (0x421b88), so 0x45eed0's single one is all of it: ${holding()}`);
h.hold("punch", true);
h.frame(11);
h.hold("punch", false);
if (game.roundsIn(game.inv.weapon) !== 0) fail(`0x41f77f spends forty a shot, floored at zero: ${holding()}`);
ok(`and RAVECAVE's scepter fires its one round, spends forty for it, and is empty`);

pass(`all three held weapons pour, drain and stop, and only two of them hurt anything`);
