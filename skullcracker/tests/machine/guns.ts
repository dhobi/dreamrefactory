/**
 * THE GUNS — the other pickup creator, and the player it turns you into.
 *
 *   npx tsx tests/machine/guns.ts        (from skullcracker/)
 *
 * `0x45b160` takes the negative codes and you collect those by walking over
 * them. `0x45af60` takes the positive ones and nothing about it is the same:
 *
 *   - **it has a button.** `0x4298a1` calls the reach handler only while S is
 *     held, and `0x42f081` ducks instead when the probe comes back empty — so
 *     the same key does both, and which one depends on what is in front of you.
 *   - **it has a facing.** `0x42f017` shifts the player's own point 35 pixels the
 *     way they are looking and `0x45ae90` tests THAT against a band of `x ± 55`
 *     and a lift of 150. Standing on one is not enough.
 *   - **taking one changes the player.** `0x45eed0` sets `0x479438` and the
 *     pickup case installs the weapon's own script, whose kind sends the whole
 *     state machine somewhere else — `0x42cb80` rather than `0x429690`. The
 *     idle, the walk, the run, the jump and the duck are all different cels.
 *
 * And the chapter, not the level, is the unit: `0x4511f0` and its three siblings
 * run once each and name the weapon you are looking for. Which is why SEWER
 * places two `statflare` and no gun — you are meant to still have SERVICE's.
 */
import { GUN_CODES, WEAPONS } from "../../src/guns";
import { fail, headless, ok, pass } from "./harness";

const h = await headless("level=1");
const { game } = h;

type Key = keyof typeof game.held;
const x = (): number => Math.round(game.p.x);
const rounds = (): number => game.roundsIn(game.inv.weapon);
const name = (): string => WEAPONS[game.inv.weapon]?.name ?? String(game.inv.weapon);
const held = (): string => `${game.inv.armed ? "holding" : "no"} ${name()} ${rounds()}/${WEAPONS[game.inv.weapon]?.max ?? 0}`;
const guns = () => game.hereOf((l) => l.guns);
const nearest = () => {
  const all = guns();
  const far = (g: (typeof all)[number]): number => Math.hypot(g.x - game.p.x, g.y - game.p.y);
  return all.length ? all.reduce((a, b) => (far(b) < far(a) ? b : a)) : null;
};
const lying = (): string => {
  const g = nearest();
  return g ? `${guns().length} guns · nearest ${GUN_CODES[g.code]?.name ?? g.code} at x ${Math.round(g.x)}, y ${Math.round(g.y)}` : "no guns";
};

/**
 * Open a level as a NEW game — a browser test was a fresh page each time, and
 * one process carries the inventory between loads the way the game carries it
 * between levels of a chapter — and wait for the spawn to stop moving: it
 * falls to its floor.
 */
const go = async (level: number, at?: number): Promise<void> => {
  game.inv.armed = false;
  game.inv.rounds = {};
  game.stats.score = 0;
  // ...and facing east, as a new player stands: `dropAt` leaves the facing alone
  game.p.facing = 1;
  await h.load(`level=${level}${at === undefined ? "" : `&x=${at}`}`);
  h.frame(6);
  let last = "";
  h.until(() => {
    const now = `${game.p.x},${game.p.y}`;
    const same = now === last;
    last = now;
    return same;
  }, 40);
};
const take = (): void => {
  h.hold("down", true);
  h.frame(14);
  h.hold("down", false);
  h.frame(4);
};
/** every cel the player showed while those keys were held, a frame at a time */
const showed = (frames: number, keys: Key[]): number[] => {
  for (const k of keys) h.hold(k, true);
  const seen = new Set<number>();
  for (let i = 0; i < frames; i++) {
    h.frame();
    seen.add(game.lastCel);
  }
  for (const k of keys) h.hold(k, false);
  h.frame(3);
  return [...seen].sort((a, b) => a - b);
};
/** run west until the player is at or past `to` */
const runWestTo = (to: number): void => {
  h.hold("up", true);
  h.hold("left", true);
  h.until(() => game.p.x <= to, 200);
  h.hold("left", false);
  h.hold("up", false);
  h.frame(4);
};

// 1. the chapter names the weapon before you have found anything. Four entry
//    functions, four chapters, and the eight levels here are two of them.
for (const [level, want] of [
  [1, "flamer"],
  [2, "flamer"],
  [3, "flamer"],
  [4, "flamer"],
  [5, "flaregun"],
  [6, "flaregun"],
  [7, "flaregun"],
  [8, "flaregun"],
] as const) {
  await go(level);
  if (game.inv.armed || name() !== want || rounds() !== 0) fail(`level ${level}'s chapter names ${want} and arms nothing; the inventory says "${held()}"`);
}
ok(`the four chapter inits name one weapon each, and none of them arms you`);

// 2. SERVICE stands up four of them, and walking over one does nothing —
//    there is no rect test in `0x45ae90` at all, only the band and the button
await go(6, 600);
const first = nearest();
if (guns().length !== 4 || GUN_CODES[first!.code]?.name !== "statflare" || Math.round(first!.x) !== 687)
  fail(`SERVICE's first room places four, the nearest a statflare at x687; ${lying()}`);
h.hold("right", true);
h.until(() => game.p.x > 760, 40);
h.hold("right", false);
h.frame(4);
if (rounds() !== 0) fail(`walking over a statflare should not take it; the inventory says ${held()}`);
if (guns().length !== 4) fail(`and all four should still be standing: ${lying()}`);
ok(`four stand in SERVICE's first room and walking straight over one takes nothing`);

// 3. ...but S does, and the band is the creator's own `x ± 55` against a
//    point 35 pixels ahead. x480 is 172 short of the near edge of the flare
//    at x687 and nothing happens there; x614 is inside it and it goes.
await go(6, 480);
if (game.gunAhead()) fail(`x480 is well outside the x632..742 band; gunAhead() says it is in reach`);
take();
if (rounds() !== 0) fail(`S with nothing in the band is the duck, not a take: ${held()}`);
await go(6, 614);
if (!game.gunAhead()) fail(`x614's probe lands at 649, inside the flare's own band; gunAhead() says it is not`);
take();
if (rounds() !== 4) fail(`0x43be30 gives four flares; the inventory says ${held()}`);
if (game.inv.armed) fail(`a statflare is ammunition — 0x4295fc's byte for code 8 is 6, the case that goes back to the fists`);
if (guns().some((g) => Math.round(g.x) === 687)) fail(`the one that was taken should be gone`);
ok(`S facing one takes it: four flares, and still empty-handed`);

// 4. the flare GUN is the thing that arms you — `0x4288d2` calls `0x45eed0`,
//    which is the only place `0x479438` is ever set in play, and it comes with
//    one round of its own
await go(5, 8300);
take();
if (!game.inv.armed) fail(`0x45eed0 arms you with the gun; the inventory says ${held()}`);
if (rounds() !== 1) fail(`and its own single round: ${held()}`);
if (name() !== "flaregun" || WEAPONS[game.inv.weapon].max !== 16) fail(`0x436cf4 gives the flare gun a magazine of 0x10: ${held()}`);
ok(`MALL's flare gun arms you, with one round against a maximum of 16`);

// 5. and now you are a different player. `0x470a78` is a whole moveset and
//    every state of it is in the 2700s — none of these cels exists in the
//    unarmed scripts.
const idle = showed(9, []);
if (idle.join() !== "2721") fail(`the armed idle is 0x470a78 tag 0, one cel 2721; saw ${idle.join(" ")}`);
const walk = showed(14, ["left"]);
if (!walk.every((c) => c >= 2700 && c <= 2711)) fail(`the armed walk is tag 1, 2700..2711; saw ${walk.join(" ")}`);
const run = showed(14, ["left", "up"]);
if (!run.every((c) => c >= 2760 && c <= 2771)) fail(`the armed run is tag 13, 2760..2771 at dx 180; saw ${run.join(" ")}`);
const duck = showed(9, ["down"]);
if (duck.join() !== "2730") fail(`the armed duck is tag 4, one cel 2730; saw ${duck.join(" ")}`);
const air = showed(18, ["jump"]);
if (!air.includes(2740) || !air.includes(2741)) fail(`the armed jump is tag 9, 2740 then 2741 carrying dy -420; saw ${air.join(" ")}`);
ok(`and the armed player walks, runs, ducks and jumps in its own cels`);

// 6. P fires, and it is P: none of the five armed state machines reads K at
//    all. The round goes at the END of the wind-up (`0x42cd53`), and the shot
//    pose is held while the thing is in the air.
h.frame(10);
const fire = showed(14, ["punch"]);
if (!fire.includes(2723)) fail(`the flare gun's shot pose is tag 3, cel 2723; saw ${fire.join(" ")}`);
if (rounds() !== 0) fail(`0x45ef00(1) takes one round a shot; the inventory says ${held()}`);
h.frame(30);
const flaresBefore = game.flares.length;
h.press("punch");
h.frame(8);
if (game.flares.length > flaresBefore) fail(`0x436d43 refuses an empty magazine outright; ${game.flares.length} flares`);
ok(`P spends the round and an empty one fires nothing`);

// 7. what a flare does, which is 100 (`0x43ab2d`) through the same class
//    handlers a fist goes through. A masked one is 40 and a knotted one 50,
//    so one flare is one kill either way — and 220 + 80 is the pair.
await go(5, 8300);
take();
runWestTo(6740);
take(); // the flare at x6700: four more
if (rounds() !== 5) fail(`the gun's one and the flare's four: ${held()}`);
runWestTo(5990);
for (let i = 0; i < 5; i++) {
  h.press("punch");
  h.frame(12);
}
const points = game.stats.score;
if (points < 220) fail(`a flare is 100 and a masked one is 40 — one shot, one kill; the score reads ${points}`);
ok(`a flare is 100 and fells what it reaches, for ${points} points`);

// 8. the flamer is the other chapter's, it holds 160, and it spends NOTHING
//    of its own on the fire function: `0x44dae0` is the only one of the five
//    with no call to `0x45ef00` in it at all. Its flame is a held stream whose
//    blow is the code -9.
await go(3, 6950);
const flamer = nearest();
if (!flamer || GUN_CODES[flamer.code]?.name !== "statflamer" || Math.round(flamer.x) !== 6980 || Math.round(flamer.y) !== 1132 || !game.gunAhead())
  fail(`WOODS' statflamer stands at 6980,1132 in reach: ${lying()}`);
take();
if (!game.inv.armed || name() !== "flamer" || rounds() !== 41 || WEAPONS[game.inv.weapon].max !== 160)
  fail(`0x451520 gives 40 and 0x45eed0 one more, against 0x44da94's 0xa0: ${held()}`);
const fidle = showed(9, []);
if (fidle.join() !== "1215,1216,1217") fail(`the flamer's idle is 0x470f98 tag 0, three cels; saw ${fidle.join(" ")}`);
const ffire = showed(14, ["punch"]);
/**
 * Its firing pose is a SEQUENCE, and it comes out of a second script.
 *
 * `0x470f98` tag 2 is one frame of cel 1240, which left the player holding the
 * gun low while the flame drew itself at the muzzle offset of a pose he never
 * reached. The sustained one is `0x46faf8`, installed by `0x423726` (tag 0) and
 * `0x42370d` (tag 1, the second character):
 *
 * ```
 *   tag 0   1240 1241 1242 1243 1244 1243 1244
 * ```
 *
 * The gun RISES through it. Measuring the blue muzzle spark each cel carries
 * against that cel's own anchor gives 1240 `(73,-14)` … 1243 `(132,-37)`, and
 * the flamer's own offset — `0x44db90`'s `(0x87, 0xffdd)` = `(135, -35)` — is
 * 1243's to four pixels. So the pose that matters is the one it settles on.
 */
const AUTHORED = [1240, 1241, 1242, 1243, 1244];
const stray = ffire.filter((c) => !AUTHORED.includes(c));
if (stray.length) fail(`its fire pose is 0x46faf8 tag 0, ${AUTHORED.join(" ")}; saw ${ffire.join(" ")}`);
if (!ffire.some((c) => c === 1243 || c === 1244))
  fail(`it should settle on 1243/1244, which is where the flame's offset belongs; saw ${ffire.join(" ")}`);
// ...and it POURS: `0x42bab5` spends a round an engine frame for as long as
// the tag runs. See tests/machine/streams.ts.
const spent = rounds();
if (!(spent < 41)) fail(`0x42bab5 spends a round a frame while it pours; the inventory says ${held()}`);
ok(`WOODS' flamer holds 41 of 160, has its own cels, and pours 41 down to ${spent}`);

/**
 * ...and INV puts it away and gets it out again — a toggle, decided on the
 * release.
 *
 * Every player state answers `0x4ac386` with `mov word ptr [eax+0x18], 0xf`.
 * State 15 (`0x428975`) installs the unarmed idle while the button is down —
 * kind 0, whose handler puts it straight back — and on the release asks whether
 * the gun's own script is installed (`0x4289c1`): if not, it goes in; if so,
 * the unarmed idle does. `0x479438` is never touched, so the gun stays yours.
 */
await go(9, 2058);
take();
if (!game.inv.armed || !game.inv.drawn || name() !== "soaker" || rounds() !== 41)
  fail(`GRAVE's statsoaker should arm you with 41, gun out: ${held()} drawn ${game.inv.drawn}`);
/** press INV for `frames` engine frames and let go */
const inv = (frames: number): void => {
  h.hold("inv", true);
  h.frame(frames);
  h.hold("inv", false);
  h.frame(3);
};
inv(1);
if (game.inv.drawn || !game.inv.armed || rounds() !== 41)
  fail(`a tap of INV with the gun out puts it away and keeps it: drawn ${game.inv.drawn}, ${held()}`);
const away = showed(8, []);
if (away.some((c) => c > 100)) fail(`with the gun away it stands on the unarmed idle, cels 1..8; saw ${away.join(" ")}`);
ok(`a tap of INV puts the soaker away — the plain idle's own ${away.join(" ")} — and it is still carried, 41 rounds`);

// ...and the fists are fists again: P is the punch, not the soaker
h.hold("punch", true);
h.frame(1);
h.hold("punch", false);
const act = game.p.act ?? "";
h.frame(30);
if (!act.startsWith("punch") || rounds() !== 41)
  fail(`with the gun away P should punch and spend nothing; it did ${act || "nothing"}, ${held()}`);
ok(`with it away P punches (${act}) and the soaker keeps its 41`);

inv(1);
if (!game.inv.drawn || rounds() !== 41) fail(`a second tap gets it out again: drawn ${game.inv.drawn}, ${held()}`);
const back = showed(8, []);
if (!back.includes(3200)) fail(`0x428a73 puts the soaker's own idle in; saw ${back.join(" ")}`);
ok(`and a second tap gets it out again on 3200`);

// ...it stands you still while it is down: state 15 reads no direction at all
h.hold("inv", true);
h.frame(3);
const stood = x();
h.hold("right", true);
h.frame(12);
h.hold("right", false);
const moved = x();
h.hold("inv", false);
h.frame(3);
if (moved !== stood) fail(`state 15 has no walk; the player went ${stood} -> ${moved} with INV down`);
ok(`and it holds you still while it is down`);

// ...and a long hold is decided by the frame it ends on: held, the player
// alternates between state 15 and the idle kind 0 it installs, and only a
// release that lands on 15 flips anything
game.inv.drawn = true;
inv(5);
if (!game.inv.drawn) fail(`held five frames the release lands on state 15, which puts back what the hold took away; drawn ${game.inv.drawn}`);
inv(4);
if (game.inv.drawn) fail(`held four frames the release lands on kind 0's idle, which leaves the gun away; drawn ${game.inv.drawn}`);
ok(`a hold ends on whichever of the two states its last frame was: five frames gun out, four frames gun away`);

// ...and a respawn's idle is kind 0 too (`0x42950f`): away, still carried
inv(1);
if (!game.inv.drawn) fail(`the gun should be out before the respawn`);
game.respawn();
h.frame(3);
if (game.inv.drawn || !game.inv.armed) fail(`a respawn puts the gun away and leaves it carried: drawn ${game.inv.drawn}, ${held()}`);
ok(`a respawn stands you on the fists with the soaker still carried`);

pass(`the guns are placed, reached for, carried between levels and fired`);
