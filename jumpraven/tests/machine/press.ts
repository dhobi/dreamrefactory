/**
 * A press held across ticks, as a hand presses (RAVEN.EXE's main loop,
 * 0x40f9b9 … 0x40fac6). Each turn of the loop sends the held button's aim
 * (message 5, 0x40fa28 — 0x40b24f calls 0x419678 with "not a press") before
 * it takes the next event, and the frame (message 13, 0x40fac6) after it; a
 * press taken (message 4, 0x40fa93 → 0x40b1d2 → 0x419678 with "a press") is
 * so always followed by a frame that sees it as a press, however long the
 * button then stays down, and the turn after clears it.
 *
 * `weapons.ts` presses and lets go in one tick; this one holds the button
 * down for several frames before letting go:
 *
 *   - rockets, missiles, bombs and the second-tier decoy, which fire only on a
 *     press (0x4196ad), fire once each — and only once, held
 *   - the frame after the press sees it as one; the frame after that, the
 *     button still down, does not
 *   - a third- or fourth-tier laser held down on a vehicle locks on to it
 *
 *   npm test -w jumpraven -- press
 */
import { test } from "vitest";
import { AMMO_FULL } from "../../src/game/records";
import { BOMBS, DEFENSIVE, LASERS, MISSILES, ROCKETS, type Pyro } from "../../src/game/combat/pyro";
import { VIEW_H, VIEW_W } from "../../src/game/combat/world";
import { VIEW_LEFT, VIEW_TOP } from "../../src/game/flight";
import { fail, haveRip, ok, pass, start } from "./harness";

const NAMES = ["lasers", "shells", "rockets", "missiles", "bombs", "defensive"];
const COST = [0x18, 0x1e, 0xf0, 0x168, 0x120, 0xa0];

test.skipIf(!haveRip())("a press held across ticks", async () => {
  const tier = [3, 0, 1, 1, 0, 1];
  const { game, input, until } = start({
    start: { level: 3, records: { ammo: [AMMO_FULL, AMMO_FULL, AMMO_FULL, AMMO_FULL, AMMO_FULL, AMMO_FULL], tier } },
  });
  until("the flight", () => game.world !== null);
  const w = game.world!;
  const pyro = w.pyro as unknown as Pyro;
  const hud = w.hud;
  const r = game.records;
  /** the craft's frames, and whether each saw the press flag */
  let frames = 0;
  const pressed: number[] = [];
  const frame = pyro.frame.bind(pyro);
  pyro.frame = () => (frames++, pressed.push(pyro.press), frame());
  const nextFrame = (): void => {
    const f = frames;
    until("a frame", () => frames > f, 100);
  };
  const ahead = (): { x: number; y: number } => {
    const c = w.project(w.cam);
    return { x: VIEW_LEFT + c.x, y: VIEW_TOP + Math.max(0, c.y - 0x40) };
  };
  /** the button down at `at`, held `n` frames (a tick or more each), then let go */
  const hold = (at: { x: number; y: number }, n: number): number[] => {
    nextFrame();
    input.down(at.x, at.y);
    const f0 = frames;
    until("held", () => frames >= f0 + n, 1_000);
    const seen = pressed.slice(f0, f0 + n);
    input.up(at.x, at.y);
    nextFrame();
    return seen;
  };

  // ---- the press weapons, held ----------------------------------------------------
  const fired: string[] = [];
  for (const kind of [ROCKETS, MISSILES, BOMBS, DEFENSIVE]) {
    hud.choose(kind);
    const before = r.ammo[kind];
    const decoys = pyro.decoys;
    const seen = hold(ahead(), 6);
    if (seen[0] !== 1 || seen.slice(1).some((p) => p !== 0)) fail(`${NAMES[kind]}: the frames held saw the press as ${seen.join(" ")}, not 1 then 0s`);
    const spent = before - r.ammo[kind];
    if (spent !== COST[kind]) fail(`${NAMES[kind]} held 6 frames spent ${spent}, not one shot's ${COST[kind]}`);
    if (kind === DEFENSIVE && pyro.decoys !== decoys + 1) fail("the second-tier defensive held put up no decoy");
    fired.push(NAMES[kind]);
  }
  ok(`held 6 frames, each fires once on the frame after the press, the press seen by that frame only: ${fired.join(", ")}`);

  // ---- a lock, held ----------------------------------------------------------------
  /** a point of the view a vehicle's picture is under (the modules' own pick, 0x41a2df) */
  const vehicle = (): { y: number; x: number } | null => {
    for (let y = 0; y < VIEW_H; y += 3) {
      for (let x = 0; x < VIEW_W; x += 3) {
        const pt = { y, x };
        if (w.tank.pick(pt) ?? w.copter.pick(pt) ?? w.jeep.pick(pt) ?? w.bike.pick(pt)) return pt;
      }
    }
    return null;
  };
  until("a vehicle in the view", () => vehicle() !== null, 20_000);
  {
    hud.choose(LASERS);
    nextFrame();
    const pt = vehicle()!;
    const at = { x: VIEW_LEFT + pt.x, y: VIEW_TOP + pt.y };
    input.down(at.x, at.y);
    nextFrame();
    // the press's frame: the shot aimed at the vehicle (0x419fbe), the lock taken
    const aimed = pyro.shots.some((s) => s.on && s.kind === LASERS && s.aim === 1);
    const locked = pyro.locked;
    nextFrame();
    nextFrame();
    input.up(at.x, at.y);
    nextFrame();
    if (!aimed || locked !== 1) fail(`a fourth-tier laser held on a vehicle: shot aimed ${aimed}, locked ${locked}`);
    ok(`a fourth-tier laser held on a vehicle at (${pt.y}, ${pt.x}) of the view locks on to it`);
  }
  pass("a press held across ticks");
});
