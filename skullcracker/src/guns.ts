/**
 * The guns — the OTHER pickup creator, and the player it turns into.
 *
 * {@link file://./props.ts}'s `PICKUP` is `0x45b160`, the one that takes the
 * NEGATIVE codes: health, lives, score, the clock. This file is `0x45af60`, the
 * one that takes the positive ones, and everything about it is different.
 *
 * ```
 *   0x45b160(code<0, point, rect, rect)   walk into it        -> stats
 *   0x45af60(code>0, point, 0, callback)  press S facing it   -> a weapon
 * ```
 *
 * A negative pickup is a thing that happens to you. A positive one is a thing
 * you pick UP: it needs a button, it needs you to be facing it, and taking it
 * makes you a different player — a whole other moveset, a whole other set of
 * cels, and a gun that has its own ammunition.
 *
 * ## The codes
 *
 * `0x45af60`'s own `lea edx, [ecx - 6]; cmp edx, 0xb` admits codes 6..17 and the
 * jump table at `0x45b024` gives each one its cel. The join from a record's NAME
 * to a code is the four per-chapter blocks — `0x416110` (blaster), `0x421aa0`
 * (soaker, scepter), `0x43bb00` (flare) and `0x4511f0` (flamer) — one chapter's
 * worth of weapons each, which is why a level only ever has one gun in it.
 *
 * ## The callback
 *
 * Every record is filed with a function pointer at `user+0xc`, and taking the
 * pickup calls it. All seven are three instructions long and all seven are the
 * same three:
 *
 * ```
 *   0x416440   mov [0x479434], 6   ; the weapon
 *              push 0x28           ; the rounds
 *              call 0x45ef30       ; add them, clamped to the weapon's own max
 *              jmp  0x40d4f0       ; and redraw the panel
 * ```
 *
 * The difference between a GUN and a REFILL is the last line and nothing else:
 * `statblaster` jumps to the panel redraw, `statblasterpack` returns. Both set
 * the weapon and both give 40 rounds. What actually arms you is `0x45eed0`,
 * which the pickup animation calls afterwards for the five base weapons only.
 */

/**
 * `0x4a7f10 + id * 12` — the weapon table, and it is filled by the chapter's own
 * entry function rather than by anything in this file's own code.
 *
 * ```
 *   0x412a10  blaster    icon 0x2840  max 0xa0  fire 0x412a70
 *   0x436ce0  flaregun   icon 0x2842  max 0x10  fire 0x436d40
 *   0x44da80  flamer     icon 0x2843  max 0xa0  fire 0x44dae0
 *   0x41f65b  soaker     icon 0x2847  max 0xa0  fire 0x41f820
 *   0x41f640  scepter    icon 0x2844  max 0xa0  fire 0x41f6b0
 * ```
 *
 * The record is `{ dword icon, word max, word rounds, dword fire }`. `0x40d681`
 * draws the icon at screen 0x16d,0x154 and `0x40d6a2` makes the bar out of
 * `rounds * 64 / max`, so the panel is the table read twice.
 *
 * Each chapter's entry also zeroes all 21 rounds counts and names its own weapon
 * as the selected one — but with `0x479438`, the ARMED flag, left at 0. So you
 * begin every chapter knowing which gun you are looking for and holding nothing.
 */
export interface Weapon {
  /** the name its records carry, and `0x479434`'s value */
  id: number;
  name: string;
  /** `record+0` — the panel icon, out of `PLAYER.SBK` */
  icon: number;
  /** `record+4` — what `0x45ef30` clamps the rounds to */
  max: number;
  /** the whole alternate player: `0x45d090(player, script, tag)` */
  moveset: Moveset;
  from: string;
}

/**
 * One weapon's player, by the tag each state installs.
 *
 * A gun is not a thing the player holds, it is a player the game swaps you for:
 * `0x45eed0` sets the armed flag and the pickup animation installs the weapon's
 * own script, whose `kind` becomes `player+0x18` and so picks a whole other
 * state handler — `0x42b860` for the flamer, `0x42cb80` for the flare gun,
 * `0x42c1e0` for the soaker, `0x42d2b0` for the scepter, `0x42dbd0` for the
 * blaster. Two and a half kilobytes of code each, and each one re-implements
 * walking, running, jumping, ducking and landing in its own cels.
 *
 * The tags below are the ones those handlers install, read off the same four
 * key globals the unarmed states read: `[0x4ac3d2]` moving, `[0x4ac3fe]` W,
 * `[0x4ac3da]` J, `[0x4ac3fc]` S, `[0x4ac394]` P.
 */
export interface Moveset {
  idle: readonly number[];
  /** dx 95 a cel, the same stride the unarmed walk carries */
  walk: readonly number[];
  /** dx 180 a cel — and every weapon has one */
  run: readonly number[];
  /** two records, the second carrying dy −420: the jump is in the script */
  jump: readonly number[];
  fall: readonly number[];
  land: readonly number[];
  /** S — what ducking looks like with this in your hands */
  duck: readonly number[];
  /** P — the wind-up, at the end of which the weapon's own fire function runs */
  fire: readonly number[];
  /** and what is held after it, if the script has one */
  shot: readonly number[];
  from: string;
}

export const WEAPONS: Readonly<Record<number, Weapon>> = {
  6: {
    id: 6,
    name: "blaster",
    icon: 10304,
    max: 160,
    from: "0x412a10, fire 0x412a70, script 0x471458 kind 22, state 0x42dbd0",
    moveset: {
      idle: [4000],
      walk: [4000, 4001, 4002, 4003, 4004, 4005, 4006, 4007, 4008, 4009, 4010, 4011],
      run: [4025, 4026, 4027, 4028, 4029, 4030, 4031, 4032, 4033, 4034, 4035, 4036],
      jump: [4050, 4051],
      fall: [4052],
      land: [4053],
      duck: [4020],
      fire: [4040, 4041, 4042],
      shot: [4043, 4044],
      from: "0x471458 tags 0,1,13,9,11,12,5,2,3",
    },
  },
  9: {
    id: 9,
    name: "flaregun",
    icon: 10306,
    max: 16,
    from: "0x436ce0, fire 0x436d40, script 0x470a78 kind 20, state 0x42cb80",
    moveset: {
      idle: [2721],
      walk: [2700, 2701, 2702, 2703, 2704, 2705, 2706, 2707, 2708, 2709, 2710, 2711],
      run: [2760, 2761, 2762, 2763, 2764, 2765, 2766, 2767, 2768, 2769, 2770, 2771],
      jump: [2740, 2741],
      fall: [2742],
      land: [2743],
      duck: [2730],
      fire: [2720, 2721, 2722],
      shot: [2723],
      from: "0x470a78 tags 0,1,13,9,11,12,4,2,3",
    },
  },
  10: {
    id: 10,
    name: "flamer",
    icon: 10307,
    max: 160,
    from: "0x44da80, fire 0x44dae0, script 0x470f98 kind 18, state 0x42b860",
    moveset: {
      idle: [1215, 1216, 1217],
      walk: [1200, 1201, 1202, 1203, 1204, 1205, 1206, 1207, 1208, 1209, 1210, 1211],
      run: [1280, 1281, 1282, 1283, 1284, 1285, 1286, 1287, 1288, 1289, 1290, 1291],
      jump: [1260, 1261],
      fall: [1262],
      // the flamer's script has no landing tag of its own; 0x42bdc4 installs
      // tag 14 for both, which is the one cel 1262
      land: [1262],
      // and its duck is in the SECOND script, `0x471128`, which is the same kind
      duck: [1220],
      fire: [1240],
      shot: [],
      from: "0x470f98 tags 0,1,16,12,14,14,2 and 0x471128 tag 5",
    },
  },
  12: {
    id: 12,
    name: "soaker",
    icon: 10311,
    max: 160,
    from: "0x41f65b, fire 0x41f820, script 0x471260 kind 19, state 0x42c1e0",
    moveset: {
      idle: [3200],
      walk: [3200, 3201, 3202, 3203, 3204, 3205, 3206, 3207, 3208, 3209, 3210, 3211],
      run: [3280, 3281, 3282, 3283, 3284, 3285, 3286, 3287, 3288, 3289, 3290, 3291],
      jump: [3270, 3271],
      fall: [3272],
      land: [3273],
      // `0x42c8d9` answers S with tag 5, and `0x471260` HAS no tag 5 — the only
      // hole of its kind in the five. The held pose stands in for it.
      duck: [3200],
      fire: [3260, 3261, 3262, 3263],
      shot: [],
      from: "0x471260 tags 0,1,16,12,14,15,-,2",
    },
  },
  16: {
    id: 16,
    name: "scepter",
    icon: 10308,
    max: 160,
    from: "0x41f640, fire 0x41f6b0, script 0x470c40 kind 21, state 0x42d2b0",
    moveset: {
      idle: [3300],
      walk: [3300, 3301, 3302, 3303, 3304, 3305, 3306, 3307, 3308, 3309, 3310, 3311],
      run: [3400, 3401, 3402, 3403, 3404, 3405, 3406, 3407, 3408, 3409, 3410, 3411],
      jump: [3350, 3351],
      fall: [3352],
      land: [3353],
      duck: [3390],
      fire: [3391],
      shot: [],
      from: "0x470c40 tags 8,2,15,11,13,14,3,4",
    },
  },
};

/**
 * The twelve positive codes, their cels and what taking one does.
 *
 * `weapon` is what the callback writes to `0x479434`; `rounds` is what it hands
 * `0x45ef30`; and `arms` is whether the pickup animation goes on to call
 * `0x45eed0` — which sets `0x479438` and puts the weapon in your hands. Five of
 * the seven placed classes arm you and two are refills, and `statflare` is the
 * odd one: it is the flare GUN's ammunition and it arms you with the gun.
 *
 * Codes 3, 4, 5, 14 and 15 have a cel and a case and no class anywhere — the
 * table admits 6..17 and the game only ever files nine of them.
 */
export interface GunCode {
  /** the record name in the level's own entity table, if a level places it */
  name: string | null;
  /** `0x45b024`'s cel, out of `PLAYER.SBK` */
  cel: number;
  /** `0x479434` — which of {@link WEAPONS} this makes the selected one */
  weapon: number | null;
  /** what `0x45ef30` is handed */
  rounds: number;
  /** whether `0x428868`'s case calls `0x45eed0` and hands you the thing */
  arms: boolean;
  from: string;
}

export const GUN_CODES: Readonly<Record<number, GunCode>> = {
  // `0x43af00` — not a record but a DROP: the class at 0x43af00 spawns one at
  // its own point as it dies, and `0x428868` pays 150 health for it. It has a
  // case in every table and no name in any level.
  2: { name: null, cel: 14000, weapon: null, rounds: 0, arms: false, from: "0x43af00 / 0x428868" },
  3: { name: null, cel: 14000, weapon: null, rounds: 0, arms: false, from: "0x45afa3 default" },
  4: { name: null, cel: 14000, weapon: null, rounds: 0, arms: false, from: "0x45afa3 default" },
  5: { name: null, cel: 14000, weapon: null, rounds: 0, arms: false, from: "0x45afa3 default" },
  6: { name: "statblaster", cel: 14006, weapon: 6, rounds: 40, arms: true, from: "0x416440" },
  7: { name: "statblasterpack", cel: 14007, weapon: 6, rounds: 40, arms: false, from: "0x416460" },
  8: { name: "statflare", cel: 14003, weapon: 9, rounds: 4, arms: false, from: "0x43be30" },
  9: { name: "statflaregun", cel: 14002, weapon: 9, rounds: 0, arms: true, from: "0x43bb48, no callback" },
  10: { name: "statflamer", cel: 14000, weapon: 10, rounds: 40, arms: true, from: "0x451520" },
  11: { name: "statflamertank", cel: 14001, weapon: 10, rounds: 40, arms: false, from: "0x451540" },
  12: { name: "statsoaker", cel: 14004, weapon: 12, rounds: 40, arms: true, from: "0x421e20" },
  13: { name: "statsoakertank", cel: 14005, weapon: 12, rounds: 40, arms: false, from: "0x421e40" },
  14: { name: null, cel: 14000, weapon: null, rounds: 0, arms: false, from: "0x45afa3 default" },
  15: { name: null, cel: 14000, weapon: null, rounds: 0, arms: false, from: "0x45afa3 default" },
  16: { name: null, cel: 14011, weapon: 16, rounds: 0, arms: true, from: "0x428950" },
  17: { name: "statscepter", cel: 14010, weapon: 16, rounds: 0, arms: true, from: "0x421b88, no callback" },
};

/**
 * How you take one, and it is the only pickup in the game with a BUTTON.
 *
 * `0x4298a1` is the gate: the idle state calls the reach handler `0x42edd0` only
 * while `[0x4ac3fc]` — S — is held, and `0x42eff8` does the rest:
 *
 * ```
 *   42f00b  point = player+6                 ; the player's own y and x
 *   42f017  facing ? x -= 0x23 : x += 0x23   ; 35 pixels AHEAD
 *   42f031  0x45ae90(&point)                 ; which pickup is there, if any
 * ```
 *
 * and `0x45ae90` answers with four comparisons — the band `x±55` that the
 * creator filed at `user+6` and `user+0xa`, and `|dy| < 150` against the
 * pickup's own point. S with nothing in that band is the duck (`0x42f081`
 * installs `0x4717c8` tag 0), which is why the same key does both.
 *
 * What plays is `0x472360`, the only kind-14 script in the game: six cels of
 * bending down, and when it ENDS, `0x4287bd` — the kind-14 state — probes the
 * same band again, calls `0x45af00` to take what is there, and `0x428846`'s
 * table decides which player you stand back up as.
 *
 * And if you already had a gun, `0x42f0dc` throws it on the floor first:
 * `0x45b060` spawns your old weapon as a code-`id` object with gravity 1.0 and
 * a bounce of 0.3, landing where it falls. You can only ever carry one.
 */
export const GRAB = {
  /** `0x472360` tag 0 — six cels, one engine frame each */
  cels: [300, 301, 302, 302, 301, 300],
  /** tag 1 — what the scepter is lifted with, held */
  hold: [420, 420, 420, 420, 420, 420],
  /** `0x42f01e`'s `0x23` */
  aheadPx: 35,
  /** `0x45af8a`'s `sub cx, 0x37` and `add cx, 0x37` */
  bandPx: 55,
  /** `0x45aecc`'s `cmp eax, 0x96` */
  liftPx: 150,
  from: "0x4298a1 / 0x42eff8 / 0x45ae90 / 0x4287bd",
} as const;

/**
 * The one gun this port fires, and why it is that one.
 *
 * Five weapons have a fire function in the table and all five are different
 * shapes. Four of them are not built here:
 *
 * - the **flamer** (`0x44dae0`) is a held stream, not a shot — modes −1 and −2
 *   reach into every live flame to stop it — and its flame's blow strength is
 *   `0xfff7`, **−9**. That is a CODE, not a number: it is the same −9 the kragg
 *   tests for, and what it means is each enemy's own hit handler's business.
 *   Drawing the stream without that is drawing a thing that cannot hurt.
 * - the **soaker** (`0x41f820`), the **blaster** (`0x412a70`) and the
 *   **scepter** (`0x41f6b0`) belong to chapters this port has not reached.
 *
 * The flare gun's (`0x436d40`) is the one that is a shot, does a NUMBER, and is
 * carried by four of the eight levels that are here.
 *
 * ```
 *   436d43  cmp [0x4a7f82], 0        ; rounds left, or nothing happens
 *   436d5e  0x40ef30(mall.snd, 0x49) ; "#0700 flare gun"
 *   436d6d  0x45ef00(1)              ; one round
 *   436d7c  malloc 6                 ; { mode, 0x434540(0x11) + 13, -1 }
 *   436df0  x = player.x -+ 0x3c     ; 60 ahead, by facing
 *   436db0  0x430d40(0x474cb8, …)    ; and there it is
 * ```
 *
 * The wobble is the whole character of it. `0x43ac3b` reads that random 13..29
 * down two at a time, adding ±itself to the flare's vertical velocity each
 * frame and flipping the sign — so a flare leaves the barrel corkscrewing hard
 * and straightens out over about seven frames. It is not aimed and it is not
 * flat.
 */
export const FLARE = {
  /** `0x43ab41` — one frame of it, then the flight cel */
  muzzle: 7200,
  /** tag 3, `0x43acae` — held all the way out */
  flight: 7207,
  /** tag 4 — what it does where it lands */
  burn: [7208, 7209, 7210, 7211],
  /** `0x43ab2d`'s `mov word ptr [esi+0x1a], 0x64` */
  blow: 100,
  /** `0x474bf8` tag 0's own dx, through the object's divisor of 5 */
  dx: 200,
  divisor: 5,
  /** `0x43ab46` — `0x42f850(obj, 0.5)` */
  gravity: 0.5,
  /** `0x436d95` — `0x434540(0x11) + 0xd`, and it counts DOWN by two */
  wobble: { lo: 13, hi: 29, step: 2, settle: 7 },
  /** `0x436dec`'s `sub eax, 0x3c` — where it appears */
  aheadPx: 60,
  /** `mall.snd` 0x49, `#0700 flare gun` */
  sound: 0x49,
  /** how many engine frames the burn-out holds before the thing is freed */
  burnHold: 2,
  from: "0x436d40 / 0x43ab10 / 0x43abf0 / 0x474bf8",
} as const;

/** one placed weapon or refill, as its record stands in the level */
export interface Gun {
  code: number;
  x: number;
  y: number;
  /** the `x ± 55` band `0x45af8a` files, which is the whole of the reach test */
  left: number;
  right: number;
  /** engine frames since the level opened, for nothing but a steady draw */
  clock: number;
  /** a weapon thrown down by a swap rather than placed by the level */
  dropped?: boolean;
  vy?: number;
  vx?: number;
}

/** one flare in the air */
export interface Flare {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  /** `user+2`, counting down by two */
  wobble: number;
  /** `user+4`, ±1 and flipping every frame */
  sign: number;
  /** null while flying; the burn-out's frame once it has landed or hit */
  burn: number | null;
  spent: boolean;
}

/**
 * Which weapon a chapter's entry function names, and it names one before you
 * have found anything.
 *
 * ```
 *   0x4511f0  flamer     woods.sbk, city.sbk        -> 0x479434 = 0xa
 *   0x43bb00  flaregun   service.sbk                -> 0x479434 = 9
 *   0x421aa0  soaker     cavern.sbk, ravecave.sbk   -> 0x479434 = 0xc
 *   0x416110  blaster    barrel.sbk                 -> 0x479434 = 6
 * ```
 *
 * Each of the four zeroes all 21 rounds counts and clears `0x479438` on the way
 * — but only `if ([0x47913c] == 0)`, so a continue keeps what it had. Which
 * weapon belongs to which chapter is not a guess either: the placement scan
 * agrees exactly, every `statflamer` being in WOODS or CITY and every
 * `statflare` in MALL, SERVICE, SEWER or ARCADE.
 */
export const CHAPTER_WEAPON: Readonly<Record<string, number>> = {
  STREETS: 10,
  PLAYGR: 10,
  WOODS: 10,
  CITY: 10,
  MALL: 9,
  SERVICE: 9,
  SEWER: 9,
  ARCADE: 9,
  GRAVE: 12,
  CAVERN: 12,
  RAVECAVE: 12,
  TOWER: 12,
  MAZE: 6,
  BARREL: 6,
  LAB: 6,
  VAT: 6,
};
