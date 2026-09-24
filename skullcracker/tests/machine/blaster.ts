/**
 * The BLASTER — chapter four's gun, and the only weapon in the game that is
 * aimed at one creature.
 *
 *   npx tsx tools/runmachine.mts blaster      (from skullcracker/)
 *
 * Its bolt carries the CODE -1 rather than a number (`0x413bf9`, through the
 * variant map at `0x413c48`), and a strength below 1 is not a blow to most
 * handlers. Chapter four's own read it first: Boggs' `0x41bc71`, the TCop's
 * `0x4147d9` and the test tube's `0x419999` rewrite -1 as a hundred, so the gun
 * is a full blow to the things of the chapter that hands it out.
 *
 * And a bolt alone still cannot kill it, for the game's own reason: the two
 * flags at `0x46e080` and `0x46e084` SHIP as 1 and are cleared only by emptying
 * the two breakable halves of the MACHINERY (`0x41b611`, `0x41b75d`), so until
 * that is done the thirty a frame puts every hundred straight back. What this
 * suite measures is that one bolt lands and that the healing undoes it; the
 * machine, and the kill it buys, are `tests/machine/vat.ts`.
 */
import { BOGGS } from "../../src/props";
import { fail, headless, ok, pass } from "./harness";

const h = await headless("level=16&x=5760");
const { game } = h;
const boggs = () => game.hereOf((l) => l.boggs)[0];
/** the two breakable halves — the machine records that carry a `health` */
const halves = () => {
  const b = boggs();
  return BOGGS.machines.map((m, k) => ("health" in m ? b.machines[k] : null)).filter((m) => m !== null);
};
h.until(() => game.p.onGround, 60);
h.frame(4);

// 1. VAT is where the one statblaster is, and taking it arms you — S in front
//    of the gun is the whole of the take, `0x4298a1`
if (game.inv.armed || game.inv.weapon !== 6 || game.roundsIn(6) !== 0)
  fail(`VAT should open with the blaster named and empty: weapon ${game.inv.weapon} armed ${game.inv.armed} ${game.roundsIn(6)}`);
h.hold("down", true);
h.until(() => game.inv.armed, 30);
h.hold("down", false);
h.frame(9);
const full = Math.round(boggs().hp);
if (full !== 4000) fail(`Boggs opens on 0x40e300(0xfa0); it has ${full}`);
const rounds = game.roundsIn(6);
if (!(rounds > 0) || !game.inv.armed) fail(`taking the statblaster gives 0x28 rounds; it has ${rounds}`);
ok(`VAT's one statblaster is taken with S and loads ${rounds} of 160`);

// 2. P spends one and puts a bolt in the air — `0x412b5b`. `0x42cd53` waits
//    for the wind-up TAG to end before it calls the weapon's own fire
//    function, so the round is not spent on the frame P goes down
h.press("punch");
const spentIn = h.until(() => game.roundsIn(6) < rounds, 15);
if (spentIn < 1) fail(`a shot spends one round, on the wind-up's last frame; it took ${spentIn}`);
if (game.roundsIn(6) !== rounds - 1) fail(`a shot spends one round; went ${rounds} -> ${game.roundsIn(6)}`);
ok(`and P spends one of them, ${spentIn} frames after it goes down`);

// 3. ...which lands a hundred on Boggs, because -1 is translated there
let lowest = 4000;
for (let i = 0; i < 40; i++) {
  h.press("punch");
  for (let f = 0; f < 2; f++) {
    h.frame();
    lowest = Math.min(lowest, Math.round(boggs().hp));
  }
}
if (lowest >= 4000) fail(`the bolt should take 100 off Boggs (0x41bc71); it never dropped below ${lowest}`);
ok(`and a bolt lands on Boggs — 4000 down to ${lowest} at its lowest`);

/**
 * ...and on the MACHINE, which is the shot that actually matters: `0x41b510`
 * translates the `-1` the same way `0x41bc71` does, and the machine does not
 * heal it back.
 *
 * This is the check that the bolt can REACH it. Three things were between it
 * and the machine, all of them this port's:
 *
 *   - the bolt is a six-by-six dot (VAT's cel 4000; `PLAYER.SBK`'s 4000 of the
 *     same number is the player's own pose) travelling two hundred pixels an
 *     engine frame, and it was tested only where it landed — about five points
 *     across a whole room, so it went through everything;
 *   - the room-edge cull ran BEFORE the hit test, and the second machine
 *     stands past the end of chamber2's floor;
 *   - and the strike box was the DRAWN extent rather than the cel's authored
 *     one, which made five pieces of scenery solid that `0x4303b3` says carry
 *     no collision at all. 5960 is drawn across the whole right half of the
 *     machine beside it.
 */
// ...walking there rather than reloading, because a reload puts the gun back
// on the floor: what you are carrying is not in the URL
const walkTo = (x: number): void => {
  for (let i = 0; i < 200 && Math.abs(game.p.x - x) >= 20; i++) {
    const k = game.p.x < x ? "right" : "left";
    h.hold(k, true);
    h.frame();
    h.hold(k, false);
  }
  h.frame(6);
};
walkTo(6360);
if (Math.abs(game.p.x - 6360) >= 30) fail(`could not walk to x6360; stopped at ${game.p.x}`);
const a0 = Math.round(halves()[0].hp);
if (a0 !== 3000) fail(`0x41b47f gives each half 0x40e300(0xbb8); it has ${a0}`);
const spent = game.roundsIn(6);
for (let i = 0; i < 4; i++) {
  h.press("punch");
  h.frame(4);
}
const a1 = Math.round(halves()[0].hp);
const fired = spent - game.roundsIn(6);
if (a1 >= a0) fail(`${fired} bolts at the machine from x${game.p.x} took nothing: still ${a1}/3000`);
if ((a0 - a1) % 100 !== 0) fail(`a bolt is worth a round hundred there; ${fired} took ${a0 - a1}`);
ok(`and ${fired} bolts at its machine take ${a0 - a1} off it — a hundred apiece, and it keeps them`);

// 4. ...and the thirty a frame puts it straight back, which is the fight
if (h.until(() => Math.round(boggs().hp) === 4000, 30) < 0)
  fail(`0x41be7c heals 30 a frame to the 4000 cap; it sat at ${Math.round(boggs().hp)}`);
if (!boggs().flags[0] || !boggs().flags[1]) fail(`both flags ship set (0x46e080, 0x46e084); they read ${boggs().flags}`);
h.frame(15);
if (Math.round(boggs().hp) !== 4000) fail(`the healing caps at 4000; it reads ${boggs().hp}`);
ok(`...and 0x41be7c puts every point of it back, because both flags ship set — the machine is what stops it`);

// 5. ...and to one of MAZE's cops, whose `0x4147d9` translates it too. `[` walks back
//    through chapter four, which keeps the weapon (`0x4511f0` runs per
//    CHAPTER), so this is the gun taken in VAT fired at one of MAZE's cops
for (let i = 0; i < 3; i++) {
  await game.loadLevel((game.levelIndex + 15) % 16);
  h.frame(4);
}
if (game.levelIndex !== 12) fail(`three [ from VAT is MAZE; it is level ${game.levelIndex + 1} ${game.level?.name}`);
if (!game.inv.armed || game.inv.weapon !== 6) fail(`the weapon is the chapter's, not the level's; MAZE has ${game.inv.weapon} armed ${game.inv.armed}`);
h.until(() => game.p.onGround, 60);
// a level opens on the unarmed idle (`0x448bc7`) and the load only sets
// `0x479438` (`0x45e041`): the gun is carried, not out, until INV — which
// tests/machine/guns.ts presses. Here it is simply out, frame for frame as before
game.inv.drawn = true;
const cop = () =>
  game
    .spawnedHere()
    .filter((e) => e.kind === "initcop")
    .sort((a, b) => Math.abs(a.x - game.p.x) - Math.abs(b.x - game.p.x))[0];
const target = cop();
if (!target) fail(`no cop in MAZE's first room to shoot at`);
const before = target.hp;
if (target.x < game.p.x) {
  h.hold("left", true);
  h.frame();
  h.hold("left", false);
}
// the cop has to be in the bolt's way: ahead, and inside `0x413b95`'s thousand
if (Math.sign(target.x - game.p.x) !== game.p.facing || Math.abs(target.x - game.p.x) > 1000)
  fail(`the cop at x${target.x} is not in the line of fire from x${game.p.x} facing ${game.p.facing}`);
const shots = game.roundsIn(6);
for (let i = 0; i < 25 && target.hp === before; i++) {
  h.press("punch");
  h.frame(2);
}
if (game.roundsIn(6) >= shots) fail(`the bolts at the cop were never fired`);
// `0x42f910` at 100: cel 4000's own pair, mirrored, plus the bolt's hundred a
// frame, and the integer root of the squares
const pair = game.celRec(game.level!.sbk, 4000)?.blow ?? { dx: 0, dy: 0 };
const each = Math.floor(Math.hypot(pair.dx + 100, pair.dy));
const took = before - target.hp;
if (took !== each) fail(`a bolt is 0x42f910 at 100 on a cop, ${each}; it took ${took}`);
ok(`and a bolt takes ${took} off a cop — the -1 written back as 100 (0x4147d9)`);

pass(`the blaster fires, its bolt is a code, and chapter four's own read it`);
