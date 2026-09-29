/**
 * What the flight's modules call of one another — every function of one of
 * RAVEN.EXE's modules that another module calls, by the name each module's
 * class gives it here. A module's class `implements` its interface; the world
 * holds one of each (`w.jeep` …, src/game/combat/world.ts).
 *
 * The modules, by the EXE's address ranges:
 *
 *   bike     0x401684 … 0x402ea4        copter   0x406fc4 … 0x408a68
 *   boss     0x402ea4 … 0x404230        fuel     0x4099b8 … 0x40b190
 *   copilot  0x404b20 … 0x406fc4        jeep     0x40c738 … 0x40e04c
 *   pyro     0x4191ec … 0x41d7a9        tank     0x4248bc … 0x426124
 *   hud      0x415078 … 0x418878        weap     0x429314 … 0x42ab18
 *
 * A name of the form `xNNNNNN` is a function whose meaning the module's port
 * settles; its doc says what it is once it has. An enemy's record starts with
 * its object, so a record IS an {@link Obj} with more fields: where the EXE
 * hands out a record's address the port hands out the record.
 */
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import type { Enemy, Obj, Pt, Targets } from "./world";

/** the four vehicles' shared extras (the jeep's 0x40dea3, 0x40df1c …) */
export interface Vehicles extends Enemy {
  /** the nearest of them whose picture, last frame, took in the view's point (for the aim); null for none (0x402db6, 0x40dea3, 0x4088c0, 0x425f76) */
  pick(pt: Pt): Obj | null;
  /** the record at exactly `o`'s point (0x402e2f, 0x40df1c, 0x408939, 0x425fef) */
  find(o: Obj): Obj;
}

export interface BikeApi extends Vehicles {}

export interface JeepApi extends Vehicles {
  /** 0x40dfe6: another jeep than `self` is in cell (x, y), or going to it */
  occupied(x: number, y: number, self: number): boolean;
}

export interface TankApi extends Vehicles {
  /** 0x4260bc: another tank than `self` is in cell (x, y), or going to it */
  occupied(x: number, y: number, self: number): boolean;
  /** 0x425412: how many of the tanks' homing shells are up (`[0x43a1ec]`, never below 0) */
  x425412(): number;
}

export interface CopterApi extends Vehicles {
  /** 0x407cb5: the copters' homing missiles up (`[0x434f04]`), for the copilot (0x4051a4) and the chatter (0x413c6d) */
  missiles(): number;
  /** 0x408a03: another copter than `self` (−1 for any: the weapons ship's 0x42aa3d) is in cell (x, y), or going to it */
  occupied(x: number, y: number, self: number): boolean;
}

export interface BossApi extends Enemy {
  /** 0x403345: how many of its homing shells (kinds 2 and 3) are up (`[0x434580]`, never below 0) — the copilot's 0x405222, the chatter's 0x4140cd */
  homing(): number;
  /** 0x404208: the boss is up and in cell (x, y) */
  at(x: number, y: number): boolean;
  /** 0x4041c9: 1 while the boss is up (`[0x4345a8]` ≥ 0, falling included), 0 once it is down — the HUD's pods wait for 0 (0x4180b5); also its target count */
  up(): number;
  /** 0x402ef5 (the EXE's arguments y, x): the boss set up over cell (x, y), 0x12c up (the pods' beacon, 0x417d70) */
  callIn(x: number, y: number): void;
}

export interface FuelApi extends Enemy {
  /** 0x40b0d5: the station is in cell (x, y) */
  occupied(x: number, y: number): boolean;
  /** 0x40b112: where the station is, if it is up */
  where(): Obj | null;
  /** 0x4099f7: the station called in, just before its beacon is set (0x41839d) */
  callIn(): void;
}

export interface WeapApi extends Enemy {
  /** 0x42aa71: the weapons ship is up and in cell (x, y) (the copters' 0x4089ae) */
  x42aa71(x: number, y: number): boolean;
  /** 0x42aa99: where the weapons ship is, if it is up */
  where(): Obj | null;
  /** 0x429360: the weapons ship called in, just before its beacon is set (0x4183c1) */
  callIn(): void;
  /** 0x410540(1) is due (0x42a3d7): the craft came up under the waiting ship — the flight plays `mart.move` and the Mart after the frame, and clears this */
  mart: boolean;
}

export interface CopilotApi {
  /** 0x404b20: a flight's start (0x40c4de) — the pilot's numbers, the counts zeroed */
  reset(): void;
  /** 0x404d26: a frame, last of 0x40c517's list */
  frame(): void;
  /** 0x406df9: the world moved — its waypoint with it */
  shift(dx: number, dy: number): void;
  /** 0x404e11: a shell fired at the craft by an enemy facing `heading` (the tank's 0x425584, the copter's, the boss's) — the copilot's count of the craft sitting still: while its slide, height and speed stay as they were it counts each, and apart those not fired along its heading or the reverse; a move starts both again */
  x404e11(heading: number): void;
}

/**
 * A shot of the player's or the copilot's, the EXE's 0x68 bytes at 0x437f94
 * (0x20 of them): the copilot fires into the same table (0x405783, through
 * 0x419298), and the pyro moves them all (0x41a3de)
 */
export interface Shot {
  /** +0x00 */
  on: number;
  /** +0x04 the weapon: 0 lasers, 1 shells, 2 rockets, 3 missiles, 4 bombs, 5 defensive */
  kind: number;
  /** +0x08 its tier, 0 to 3 */
  tier: number;
  /** +0x0c 0 the player's, 1 the copilot's (the tally it counts in, 0x41c6f6) */
  who: number;
  /** +0x10 what it met: 0 nothing yet, 1 a block or the ground, 2 an enemy (a rocket's or a bomb's frames since) */
  met: number;
  /** +0x14 frames left */
  life: number;
  /** +0x18, +0x1c, +0x20 its step */
  vx: number;
  vy: number;
  vz: number;
  /** +0x24 where it is */
  o: Obj;
  /** +0x3c a shell's tracer, a rocket's or missile's wobble, a defensive's frame */
  flag: number;
  /** +0x40 a defensive's frames since it opened */
  opened: number;
  /** +0x44 0 flying straight, 1 aimed at `at`, 2 homing on `target` */
  aim: number;
  /** +0x48 the point it was aimed at */
  at: Obj;
  /** +0x60 what it homes on, +0x64 at what speed */
  target: Obj | null;
  speed: number;
}

/** the craft, the player's weapons, their shots, the explosions and the wreckage */
export interface PyroApi {
  /** 0x41928d: `pyro`'s pictures, 0x15c of them */
  readonly pics: (FrameV0 | undefined)[];
  /** the craft as a target (0x41d689 one, 0x41d68f it: KIND.player) — 0x40c5d5's list after the weapons ship */
  readonly craftTargets: Targets;
  /** the wreckage on the ground as targets (0x41d6c3, 0x41d6de: KIND.debris) — last in 0x40c5d5's list */
  readonly wreckTargets: Targets;
  reset(): void;
  frame(): void;
  shift(dx: number, dy: number): void;
  /** 0x419511: HOVER's slide (across) and rise (up), each held within its bounds; the craft put back across its pose */
  slide(across: number, up: number): void;
  /** 0x419678: the mouse at the view's point; `fire` on the press */
  aim(pt: Pt, fire: boolean): void;
  /** 0x41a230: the fire key */
  fire(): void;
  /** 0x41a3a7: the record is gone — no missile homes on it any more */
  forget(target: Obj): void;
  /** 0x41b7a9: an enemy's shot from `a` to `b`, `dmg` strong, `r` wide: the weapons ship, the fuel station or the craft it hits, if any */
  hitsOurs(a: Obj, b: Obj, dmg: number, r: number): boolean;
  /** 0x41b820: an enemy's shot from `a` to `b`, `dmg` strong, `r` wide, hits the craft */
  hitsCraft(a: Obj, b: Obj, dmg: number, r: number): boolean;
  /** 0x41ba31: how many wreckage pieces are up */
  wreckage(): number;
  /** 0x41bbc0: an explosion at `o`, moving (dx, dy, dz) */
  burst(o: Obj, dx: number, dy: number, dz: number): void;
  /** 0x41bd9f: a piece of wreckage thrown from `o` */
  drop(o: Obj, dx: number, dy: number, dz: number): void;
  /** 0x419298: the shot table (0x437f94, 0x20 long), which the copilot fires into */
  x419298(): Shot[];
  /** 0x41b62d: a defensive decoy that draws this level's enemies (tier 2 on level 3, tier 1 on level 5), its point into `out` */
  x41b62d(out: Obj): boolean;
  /** 0x41b6bd: a defensive shot is up (1) */
  x41b6bd(): number;
  /** 0x41b704: one more defensive shot up (the copilot's) */
  x41b704(): void;
  /** 0x41c765: a shot fired, for the tally — `who` 0 the player, 1 the copilot; a tier-3 bomb counts 16 */
  x41c765(who: number, kind: number, tier: number): void;
  /** 0x41cd96: a puff of chaff behind `o` (a tier-0 defensive) */
  x41cd96(o: Obj): void;
  /** 0x41d2cf: an enemy's sight is jammed — by a tier-3 defensive, or by chaff whose cell x (`byX`) or y is in lo … hi */
  x41d2cf(byX: number, lo: number, hi: number): number;
  /** 0x41d396: more than half the jeeps, tanks, copters and the boss are within two cells of `o` along a row or a column */
  x41d396(o: Obj): number;
  /** 0x41d6c3: how many wreckage pieces are targets; 0x41d6de the k-th (its countdown: k 0 and 1 are both the first), KIND.debris */
  x41d6c3(): number;
  x41d6de(k: number, out: Obj): number;
}

/** the comms box (src/game/comms.ts) as the flight's modules ask it */
export interface CommsApi {
  /** 0x4142b9: a line asked for — `who` 0 the pilot … 4 the enemy */
  ask(who: number, line: number): void;
  /** `[0x4373f8]`: the keyframe of the line playing, −1 when none is (0x41438a reads it) */
  keyframe(): number;
  /** 0x414bb4: whose line is playing, −1 for none */
  talking(): number;
  /** 0x414b8f: one time in two, `[0x4373e0]` set */
  x414b8f(): void;
  /** 0x414bce: the line playing cut and the box's asking cleared — when the fuel station is killed or burning while its man talks (0x40af54, 0x40abd9) */
  x414bce(): void;
}

/**
 * The HUD (src/game/combat/hud.ts), and the records it keeps for the flight
 * (0x4378..). The records are `w.r`'s: the bars are [SHLD `[0x4378bc]`, PODS
 * `[0x4378c0]`, FUEL `[0x4378c4]`].
 */
export interface HudApi {
  /** a flight's start (0x40b3ad): 0x41601a */
  reset(): void;
  /** 0x416025: a frame of the panels, after the view is up (0x40c08a, 0x40c34b) */
  frame(): void;
  /** 0x415c7b: a click on the panels, in the window's pixels */
  click(y: number, x: number): void;
  /** 0x418511: the world moved (dx, dy) when the craft wrapped — the beacon with it */
  shift(dx: number, dy: number): void;
  /** 0x41601a: every strip drawn whole on the next frame */
  redraw(): void;
  /** 0x415f51 (a new game, a life lost): every record zeroed but the pilot and the tally, the HUD's with them */
  zero(): void;
  /** 0x4175ea: the HOVER/FLY key — the other mode, unless a copilot has either */
  toggleMode(): void;
  /** 0x4178e3: `[0x4378a8]` 0 HOVER, 1 FLY, −1 neither (both copilots) */
  mode(): number;
  /** 0x4178ef / 0x417ae7: `[0x4378ac]` the menu button pressed (0 SAVE, 1 HELP, 2 SOUND, 3 KEYS, 4 PAUSE, 5 QUIT), −1 none */
  menu(): number;
  setMenu(k: number): void;
  /** 0x4178c5 `[0x4378f0]` the radar, 0x4178cb `[0x4378e4]` the video, 0x4178d7 `[0x4378ec]` the direction, 0x4178dd `[0x4378e8]` the distance: knocked out */
  radarOut(): boolean;
  videoOut(): boolean;
  directionOut(): boolean;
  distanceOut(): boolean;
  /** 0x4178d1: `[0x4378f4]`, the engines are damaged — HOVER slides 2 a key, not 6 */
  enginesHit(): boolean;
  /** 0x4178e9: `[0x4378b0]`, the weapon chosen, −1 for none */
  weapon(): number;
  /** 0x417acf */
  choose(k: number): void;
  /** 0x4178f5 / 0x417cc1: kind k's tier */
  tier(k: number): number;
  setTier(k: number, t: number): void;
  /** 0x417901: kind k's ammunition (0 for k −1) */
  ammo(k: number): number;
  /** 0x418044: kind k's ammunition BY n (it adds, held within 0 … AMMO_FULL; nothing for k −1); empty, it is no longer chosen */
  setAmmo(k: number, n: number): void;
  /** 0x417c81: kind k full */
  fill(k: number): void;
  /** 0x417bd0: kind k lost to a hit */
  lose(k: number): void;
  /** 0x417917: `[0x4378bc]` the shields */
  shields(): number;
  /** 0x417dac: the shields by n; a hit of 0x2c or more may knock a system out */
  addShields(n: number): void;
  /** 0x41791d: `[0x4378c4]` the fuel */
  fuel(): number;
  /** 0x417fa9 */
  addFuel(n: number): void;
  /** 0x417923: `[0x4378c0]` PODS */
  pods(): number;
  /** 0x417fd5: PODS by n, held within 0 … AMMO_FULL */
  x417fd5(n: number): void;
  /** 0x417929 / 0x418001: the lives, held within 0 … 4 */
  lives(): number;
  addLives(n: number): void;
  /** 0x41792f: the score */
  score(): number;
  /** 0x41802a: the score by n, never below 0 */
  addScore(n: number): void;
  /** knocked out: 0x417af1 the radar, 0x417b1c the video, 0x417b3d the engines, 0x417b5e the direction, 0x417ba5 the distance */
  x417af1(): void;
  x417b1c(): void;
  x417b3d(): void;
  x417b5e(): void;
  x417ba5(): void;
  /** mended (the repair bay, 0x41f990): 0x417c2c the radar, 0x417c37 the video, 0x417c42 the engines, 0x417c4d the direction, 0x417c6c the distance */
  x417c2c(): void;
  x417c37(): void;
  x417c42(): void;
  x417c4d(): void;
  x417c6c(): void;
  /** 0x417617: `[0x4378cc]`, `[0x4378d0]`, `[0x4378d4]` — the copilot navigates, has HOVER, has the weapons (it writes them through three pointers) */
  x417617(): [number, number, number];
  /** 0x417cd1: the beacon over cell (x, y), marking kind 0 FUEL, 1 AMMO, 2 PODS, 3 RBAY (the EXE's arguments y, x, kind) */
  beacon(x: number, y: number, kind: number): void;
  /** 0x417d33: the beacon off; 0x417d4d what it marks (−1 none) and where */
  x417d33(): void;
  x417d4d(out: { n: number }, obj: Obj): void;
  /** 0x417d70: the pods are down — their beacon, and the boss over it */
  x417d70(): void;
}
