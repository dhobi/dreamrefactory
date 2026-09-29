/**
 * The combat's tuning (LUNICUS.EXE 0x417f1b), set when a city or building level
 * opens: four sets, one a difficulty (Settings ▸ Beginner … Expert,
 * `[0x42c15c]`, Intermediate on a new install), each scaled by the day —
 * `s = clamp(day − 3, −1, 3)`, and a value either `B − B·s/12` (it shrinks as
 * the days go on) or `B + B·s/12` (it grows).
 *
 * The names are what the code does with each; the EXE's globals are cited.
 */

export interface CombatParams {
  /** `[0x42e2fa]` the tank's turn, per frame, and `[0x42e302]` the jeep's */
  tankTurn: number;
  jeepTurn: number;
  /** `[0x42e2f6]` the tank's speed and `[0x42e2fe]` the jeep's, per frame */
  tankSpeed: number;
  jeepSpeed: number;
  /** `[0x42e306]`, `[0x42e30a]`: the wasp's speed and turn */
  waspSpeed: number;
  waspTurn: number;
  /** `[0x42e30e]` a drone's speed (0x40421d) */
  droneSpeed: number;
  /** `[0x42e2d2]` a bullet's damage; also the line between a light and a heavy hit's sound */
  bullet: number;
  /** `[0x42e2d6]` the pulse gun's (day 4 on) */
  pulse: number;
  /** `[0x42e2da]` a rocket's */
  rocket: number;
  /** `[0x42e2de]` a grenade's */
  grenade: number;
  /**
   * what a shell does to the player: `[0x42e2e2]` a wasp's, `[0x42e2e6]` a
   * jeep's, `[0x42e2ea]` a tank's, `[0x42e2ee]` the node's (also where a hit
   * starts to sound heavy), `[0x42e2f2]` a drone's
   */
  waspShot: number;
  jeepHit: number;
  tankHit: number;
  nodeShot: number;
  droneShot: number;
  /** `[0x42e2c2]` … `[0x42e2ce]`: what a kill takes off the ENEMIES bar (drone, jeep = tank, wasp); half indoors */
  droneWorth: number;
  jeepWorth: number;
  tankWorth: number;
  waspWorth: number;
}

const down = (b: number, s: number): number => b - Math.trunc((b * s) / 12);
const up = (b: number, s: number): number => b + Math.trunc((b * s) / 12);

/** Beginner is 1 … Expert 4 */
export function combatParams(difficulty: number, day: number): CombatParams {
  const s = Math.min(3, Math.max(-1, day - 3));
  const d = Math.min(4, Math.max(1, difficulty)) - 1;
  const pick = <T>(a: [T, T, T, T]): T => a[d];
  const [bullet, pulse, rocket, grenade] = pick([[40, 80, 1600, 400], [30, 60, 1200, 300], [20, 40, 800, 200], [10, 20, 400, 100]]);
  const [waspShot, jeepHit, tankHit, nodeShot, droneShot] = pick([[5, 10, 15, 35, 100], [10, 15, 20, 50, 150], [15, 20, 25, 65, 200], [20, 25, 30, 80, 250]]);
  const [droneWorth, vehicleWorth, waspWorth] = pick([[140, 420, 700], [110, 330, 550], [80, 240, 400], [50, 150, 250]]);
  return {
    tankTurn: pick([2, 4, 8, 8]),
    tankSpeed: pick([20, 21, 30, 35]),
    jeepSpeed: pick([28, 30, 35, 42]),
    jeepTurn: pick([4, 8, 16, 16]),
    waspSpeed: pick([30, 35, 42, 60]),
    waspTurn: pick([4, 8, 16, 16]),
    droneSpeed: pick([21, 28, 35, 42]),
    bullet: down(bullet, s),
    pulse: down(pulse, s),
    rocket: down(rocket, s),
    grenade: down(grenade, s),
    waspShot: up(waspShot, s),
    jeepHit: up(jeepHit, s),
    tankHit: up(tankHit, s),
    nodeShot: up(nodeShot, s),
    droneShot: up(droneShot, s),
    droneWorth: down(droneWorth, s),
    jeepWorth: down(vehicleWorth, s),
    tankWorth: down(vehicleWorth, s),
    waspWorth: down(waspWorth, s),
  };
}
