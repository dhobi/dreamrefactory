/**
 * Day one's flight to its end, flown by the copilot (RAVEN.EXE 0x404d26 with
 * NAVIGATION, HOVER CONTROL and ARMS CONTROL all on): it fights what comes,
 * sits over the pod a kill drops until it is drawn in (0x41c18a), and once
 * PODS is empty the pods come down (`pods.move`, 0x40b5b8) and the boss is
 * called in over a beacon (0x417d70); the boss killed and the craft landed on
 * the beacon (0x418128) is state 3, and the next level (0x40b60a).
 *
 * Two shortcuts keep it short: PODS starts one pod from empty, and the boss
 * is made weak (`[0x43cfbe]` 0x100) — what they cut is a longer run of the
 * same code, not other code.
 *
 *   npx tsx tests/machine/day1.ts        (from jumpraven/)
 */
import { AMMO_FULL } from "../../src/game/records";
import { fail, ok, pass, start } from "./harness";

const full = [0, 1, 2, 3, 4, 5].map(() => AMMO_FULL);
const { game, m, until, click } = start({ start: { level: 3, records: { ammo: full, bars: [AMMO_FULL, 0x258, AMMO_FULL] } } });
until("the flight", () => game.world !== null);
const w = game.world!;
(w as { params: typeof w.params }).params = { ...w.params, x43cfbe: 0x100 };
Object.assign(game.hudState, { nav: 1, hover: 1, arms: 1 });

/** the screens a flight may open on the way: the Mart (under the weapons ship, or a new craft) is left by CONTINUE */
const tick = (): void => {
  if (game.screen === "mart" && m.ticks % 60 === 0) click(58, 345);
};
until(
  "the pods down",
  () => {
    tick();
    return w.state >= 2;
  },
  40_000,
);
const k = game.records.tally.kills;
if (!game.played.includes("pods.move")) fail(`state ${w.state} without pods.move: ${game.played.slice(-4).join(" ")}`);
ok(`the last pod in at tick ${m.ticks}: kills ${k.bike} bikes, ${k.jeep} jeeps, ${k.copter} copters, ${k.tank} tanks`);
if (k.bike + k.jeep + k.copter + k.tank === 0) fail("the copilot killed nothing");
until(
  "the next level",
  () => {
    tick();
    return game.level !== 3;
  },
  60_000,
);
if (game.level !== 4) fail(`the flight ended at level ${game.level}, not 4`);
if (game.records.bars[1] !== AMMO_FULL) fail(`PODS ${game.records.bars[1]} after the level, not full`);
ok(`the boss down and the beacon landed on: level 4 at tick ${m.ticks}, lives ${game.records.lives}, cash ${game.records.score}`);
until("the way back", () => game.played.includes("drop.move"));
ok(`the story goes on: ${game.played.slice(-2).join(", ")}`);
pass("day1");
