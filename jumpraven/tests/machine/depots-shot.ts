/**
 * The weapons ship and the fuel station shot down (RAVEN.EXE 0x429360,
 * 0x42a7f8, 0x42a4dc; 0x4099f7, 0x40ae4a, 0x40ab3b): called in, each is one
 * target and nothing is a second; a hit that leaves it strength has its man
 * complain once and no more.
 *
 *   - the weapons ship killed costs 150 points, takes its beacon down, and
 *     sinks, turning, for 0x1f … 0x2e frames before it blows up and is gone
 *   - the fuel station killed costs 100 points, cuts its man's complaint
 *     short, takes its beacon down, and burns 0x20 … 0x33 frames before it is
 *     gone
 *
 *   npm test -w jumpraven -- depots-shot
 */
import { test } from "vitest";
import { MARK_AMMO, MARK_FUEL } from "../../src/game/combat/hud";
import { DEALER, FUEL } from "../../src/game/core/comms";
import { fail, haveRip, ok, pass, start } from "./harness";

test.skipIf(!haveRip())("depots-shot", async () => {
  const { game, until } = start({ start: { level: 3 } });
  until("the flight", () => game.world !== null);
  const w = game.world!;
  const said: string[] = [];
  const ask = game.comms.ask.bind(game.comms);
  game.comms.ask = (who: number, line: number) => (said.push(`${who}:${line}`), ask(who, line));
  /** the ship's frames, counted as the flight runs them */
  let frames = 0;
  const frame = w.weap.frame.bind(w.weap);
  w.weap.frame = () => (frames++, frame());

  w.weap.callIn();
  Object.assign(game.hudState, { beaconOn: 1, beaconKind: MARK_AMMO });
  if (w.weap.count() !== 1) fail(`called in, the weapons ship counts ${w.weap.count()}`);
  let threw = "";
  try {
    w.weap.nth(1);
  } catch (e) {
    threw = String(e);
  }
  if (!threw.includes("no such weapons ship")) fail("a second weapons ship was found");
  ok("called in: one weapons ship, and no second");

  const at = (): ReturnType<typeof w.weap.nth>["obj"] => w.weap.nth(0).obj;
  // a light hit, twice: the dealer complains the first time only
  for (let k = 0; k < 2; k++) if (!w.weap.hit(at(), at(), 1, 0)) fail("a hit on the ship was not taken");
  if (said.filter((s) => s === `${DEALER}:6`).length !== 1) fail(`the dealer on two light hits: ${said.join(" ")}`);
  // a shot that passes far above it is no hit
  const above = { ...at(), z: at().z + 0x200 };
  if (w.weap.hit(above, above, 0x7fff, 0)) fail("a shot far above the ship hit it");
  ok("two light hits: the dealer complains once; a shot far above misses");

  // the kill
  const score = game.records.score;
  if (!w.weap.hit(at(), at(), 0x7fff, 0)) fail("the killing hit was not taken");
  if (game.records.score !== score - 150) fail(`the kill cost ${score - game.records.score}, not 150`);
  if (game.hudState.beaconOn) fail("the beacon stayed up for a ship shot down");
  // going down, it takes no more hits
  if (w.weap.hit(at(), at(), 1, 0)) fail("a ship going down took a hit");
  const f0 = frames;
  until("the ship gone", () => w.weap.count() === 0, 5_000);
  const sank = frames - f0;
  if (sank < 0x1f || sank > 0x2e + 1) fail(`the ship sank ${sank} frames`);
  ok(`the kill: 150 points, the beacon down, no more hits; it sank ${sank} frames and is gone`);

  // ---- the fuel station ----
  {
    const fuel = w.fuel;
    let burnt = 0;
    const fframe = fuel.frame.bind(fuel);
    fuel.frame = () => (burnt++, fframe());
    fuel.callIn();
    Object.assign(game.hudState, { beaconOn: 1, beaconKind: MARK_FUEL });
    if (fuel.count() !== 1) fail(`called in, the fuel station counts ${fuel.count()}`);
    let none = "";
    try {
      fuel.nth(1);
    } catch (e) {
      none = String(e);
    }
    if (!none.includes("no such fuel station")) fail("a second fuel station was found");
    const fat = (): ReturnType<typeof fuel.nth>["obj"] => fuel.nth(0).obj;
    const n = said.length;
    if (!fuel.hit(fat(), fat(), 1, 0)) fail("a hit on the fuel station was not taken");
    until("the fuel man complaining", () => game.comms.talking() === FUEL, 300);
    const cash = game.records.score;
    if (!fuel.hit(fat(), fat(), 0x7fff, 0)) fail("the killing hit on the fuel station was not taken");
    if (said.slice(n).filter((s) => s === `${FUEL}:6`).length !== 1) fail(`the fuel man on two hits: ${said.slice(n).join(" ")}`);
    if (game.records.score !== cash - 100) fail(`the fuel station cost ${cash - game.records.score}, not 100`);
    if (game.hudState.beaconOn) fail("the beacon stayed up for a fuel station shot down");
    if (game.comms.talking() === FUEL) fail("the fuel man's complaint was not cut short");
    if (fuel.hit(fat(), fat(), 1, 0)) fail("a burning fuel station took a hit");
    const b0 = burnt;
    until("the fuel station gone", () => fuel.count() === 0, 5_000);
    const burned = burnt - b0;
    if (burned < 0x20 || burned > 0x33 + 1) fail(`the fuel station burned ${burned} frames`);
    ok(`the fuel station: one; complained once; killed, 100 points, the complaint cut short, the beacon down; burned ${burned} frames`);
  }
  pass("depots-shot");
});
