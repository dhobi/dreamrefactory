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
      walk: [
        4000, 4001, 4002, 4003, 4004, 4005, 4006, 4007, 4008, 4009, 4010, 4011,
      ],
      run: [
        4025, 4026, 4027, 4028, 4029, 4030, 4031, 4032, 4033, 4034, 4035, 4036,
      ],
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
      walk: [
        2700, 2701, 2702, 2703, 2704, 2705, 2706, 2707, 2708, 2709, 2710, 2711,
      ],
      run: [
        2760, 2761, 2762, 2763, 2764, 2765, 2766, 2767, 2768, 2769, 2770, 2771,
      ],
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
      walk: [
        1200, 1201, 1202, 1203, 1204, 1205, 1206, 1207, 1208, 1209, 1210, 1211,
      ],
      run: [
        1280, 1281, 1282, 1283, 1284, 1285, 1286, 1287, 1288, 1289, 1290, 1291,
      ],
      jump: [1260, 1261],
      fall: [1262],
      // the flamer's script has no landing tag of its own; 0x42bdc4 installs
      // tag 14 for both, which is the one cel 1262
      land: [1262],
      // and its duck is in the SECOND script, `0x471128`, which is the same kind
      duck: [1220],
      /**
       * The flamer FIRES OUT OF A SECOND SCRIPT, and that is why its flame hung
       * in the air.
       *
       * `0x470f98` tag 2 is one frame of cel 1240, and reading it as the whole
       * firing pose left the player holding the gun low while the flame drew
       * itself 135 pixels away with nothing in between. The sustained pose is
       * `0x46faf8`, installed by `0x42370d` (tag 1 when `[0x46b1a8]` is 1, the
       * second character) and `0x423726` (tag 0):
       *
       * ```
       *   tag 0   1240 1241 1242 1243 1244 1243 1244     SKULLCRACKER
       *   tag 1   1340 1341 1342 1343 1344 1343 1344     BONEBREAKER
       * ```
       *
       * The gun RISES through it. Measured off the blue muzzle spark each cel
       * carries, relative to that cel's own anchor:
       *
       * ```
       *   1240  (73,-14)   1241  (86,-34)   1242  (97,-54)
       *   1243  (132,-37)  1244  — and 1243/1244 are what it settles on
       * ```
       *
       * The flamer's own muzzle offset is `0x44db90`'s `(0x87, 0xffdd)` =
       * **(135, -35)**, which is cel 1243's spark to four pixels. So the offset
       * was never wrong; the pose under it was. See {@link STREAMS}.
       */
      fire: [1240, 1241, 1242],
      shot: [1243, 1244],
      from: "0x470f98 tags 0,1,16,12,14,14 and 0x471128 tag 5; fire 0x46faf8 tag 0",
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
      walk: [
        3200, 3201, 3202, 3203, 3204, 3205, 3206, 3207, 3208, 3209, 3210, 3211,
      ],
      run: [
        3280, 3281, 3282, 3283, 3284, 3285, 3286, 3287, 3288, 3289, 3290, 3291,
      ],
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
      walk: [
        3300, 3301, 3302, 3303, 3304, 3305, 3306, 3307, 3308, 3309, 3310, 3311,
      ],
      run: [
        3400, 3401, 3402, 3403, 3404, 3405, 3406, 3407, 3408, 3409, 3410, 3411,
      ],
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
  2: {
    name: null,
    cel: 14000,
    weapon: null,
    rounds: 0,
    arms: false,
    from: "0x43af00 / 0x428868",
  },
  3: {
    name: null,
    cel: 14000,
    weapon: null,
    rounds: 0,
    arms: false,
    from: "0x45afa3 default",
  },
  4: {
    name: null,
    cel: 14000,
    weapon: null,
    rounds: 0,
    arms: false,
    from: "0x45afa3 default",
  },
  5: {
    name: null,
    cel: 14000,
    weapon: null,
    rounds: 0,
    arms: false,
    from: "0x45afa3 default",
  },
  6: {
    name: "statblaster",
    cel: 14006,
    weapon: 6,
    rounds: 40,
    arms: true,
    from: "0x416440",
  },
  7: {
    name: "statblasterpack",
    cel: 14007,
    weapon: 6,
    rounds: 40,
    arms: false,
    from: "0x416460",
  },
  8: {
    name: "statflare",
    cel: 14003,
    weapon: 9,
    rounds: 4,
    arms: false,
    from: "0x43be30",
  },
  9: {
    name: "statflaregun",
    cel: 14002,
    weapon: 9,
    rounds: 0,
    arms: true,
    from: "0x43bb48, no callback",
  },
  10: {
    name: "statflamer",
    cel: 14000,
    weapon: 10,
    rounds: 40,
    arms: true,
    from: "0x451520",
  },
  11: {
    name: "statflamertank",
    cel: 14001,
    weapon: 10,
    rounds: 40,
    arms: false,
    from: "0x451540",
  },
  12: {
    name: "statsoaker",
    cel: 14004,
    weapon: 12,
    rounds: 40,
    arms: true,
    from: "0x421e20",
  },
  13: {
    name: "statsoakertank",
    cel: 14005,
    weapon: 12,
    rounds: 40,
    arms: false,
    from: "0x421e40",
  },
  14: {
    name: null,
    cel: 14000,
    weapon: null,
    rounds: 0,
    arms: false,
    from: "0x45afa3 default",
  },
  15: {
    name: null,
    cel: 14000,
    weapon: null,
    rounds: 0,
    arms: false,
    from: "0x45afa3 default",
  },
  16: {
    name: null,
    cel: 14011,
    weapon: 16,
    rounds: 0,
    arms: true,
    from: "0x428950",
  },
  17: {
    name: "statscepter",
    cel: 14010,
    weapon: 16,
    rounds: 0,
    arms: true,
    from: "0x421b88, no callback",
  },
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
 * `0x45b060` spawns your old weapon as a code-`id` object with gravity 1.0 at
 * your own point, and it falls to the floor (the 0.3 it files through `0x42f7f0`
 * is `obj+0x20`, what a WALL leaves of its horizontal speed). You can only ever
 * carry one.
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
  /**
   * The codes whose reach throws your gun down first — `0x42f264`'s table sends
   * these six to `0x42f0a8` (and 17 to `0x42f111`, the same test after the
   * held-up variant of the reach); the refills and the can go straight to the
   * reach at `0x42f0f2`.
   */
  drops: [6, 9, 10, 12, 16, 17] as readonly number[],
  from: "0x4298a1 / 0x42eff8 / 0x45ae90 / 0x4287bd",
} as const;

/**
 * The FLARE GUN's shot — `0x436d40`, the one of the five fire functions that
 * launches something with a strength of a hundred, carried by MALL, SERVICE,
 * SEWER and ARCADE.
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
 * The wobble is the whole character of it. `0x43ac3b` reads that random 14..30
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
  /**
   * tag 4 — what it does once it has landed or hit, one engine frame a cel
   * (`0x474bf8` runs one tick a frame). Its end installs tag 5 (`0x43acd7`), the
   * last cel held, and tag 5 frees the flare the first frame the mover finds it
   * at rest (`0x43acf5` reads `obj+0x30`, which `0x43031c` sets when both
   * velocities are zero) — so a burning flare goes on falling and sliding until
   * the ground's drag has stopped it.
   */
  burn: [7208, 7209, 7210, 7211],
  /** `0x43ab2d`'s `mov word ptr [esi+0x1a], 0x64` — the STRENGTH, a percentage */
  blow: 100,
  /** `0x474bf8` tag 0's own dx, through the object's divisor of 5 (`0x43ab50`) */
  dx: 200,
  divisor: 5,
  /** `0x43ab46` — `0x42f850(obj, 0.5)`, which files 5 in `obj+0x24` */
  gravity: 0.5,
  /**
   * `0x436d95` — `0x434540(0x11) + 0xd`, and `0x434540(n)` answers 1..n, so
   * 14..30. It counts DOWN by two (`0x43ac70`); from 7 down it is added to the
   * vertical velocity rather than written over it (`0x43ac44`).
   */
  wobble: { lo: 14, hi: 30, step: 2, settle: 7 },
  /** `0x436dec`'s `sub eax, 0x3c` — where it appears */
  aheadPx: 60,
  /** `mall.snd` 0x49, `#0700 flare gun` */
  sound: 0x49,
  from: "0x436d40 / 0x43ab10 / 0x43abf0 / 0x474bf8",
} as const;

/**
 * The BLASTER's bolt — chapter four's gun, and the only thing in the game that
 * can hurt Boggs.
 *
 * `0x412a70(player, variant)` is the fire, and the variant comes from the tag
 * the armed state machine is on: `0x42dbd0`'s tags 2 and 3 fire with **2** and
 * its tags 6 and 8 with **3**. Both land on the same case, `0x412b5b`:
 *
 * ```
 *   412b66  0x40ef30(bank, 0x23, y)        ; the shot
 *   412b7f  x += 0x28 == 1 ? -0x78 : +0x78 ; 120 ahead, mirror flag and all
 *   412b87  y -= 0x14
 *   412b8f  y += 0x434540(0x28) - 0x14     ; ...and a random 40 of scatter
 *   412ba7  0x40e4c0(0xe1)
 *   412bb1  0x45d090(bolt, 0x46c588, 2)    ; cel 4000 at dx 1000
 * ```
 *
 * A thousand a frame through the object's own divisor is the fastest thing on
 * the page, and the scatter is why it is a blaster rather than a rifle: two
 * shots from the same spot do not go to the same place.
 *
 * ## Its strength is a CODE, and that is the whole point
 *
 * The bolt remembers the variant it was fired with (`0x412ad8` writes it to
 * `user+2`) and its own think reads it back every frame to decide what it hits
 * with:
 *
 * ```
 *   413bd5  movsx eax, word ptr [eax + 2]      ; the variant
 *   413be0  mov   cl, byte ptr [eax + 0x413c48] ; 0 -> 0, 1..3 -> 1, 17 -> 2
 *   413bed  mov word ptr [esi+0x1a], 0x64      ; case 0 and 2: a hundred
 *   413bf9  mov word ptr [esi+0x1a], 0xffff    ; case 1: MINUS ONE
 * ```
 *
 * The blaster only ever fires variants 2 and 3, so its bolt always carries -1 —
 * and -1 is a code. Most handlers throw a strength below 1 away, so the bolt
 * does nothing at all to most of what it meets. Chapter four's own are the
 * exceptions, and they read it themselves before the sign test: Boggs'
 * `0x41bc71`, the TCop's `0x4147d9` and the test tube's `0x419999` turn -1
 * into 100 and take the blow, and puke's `0x41825e` answers it with a sound
 * and nothing else ({@link Foe.minusOne}). So the gun is a weapon in the
 * chapter that hands it out, and useless everywhere else.
 */
export const BOLT = {
  /** `0x46c588` tag 2 — one cel, and it is the whole flight */
  cel: 4000,
  /**
   * the tag's own dx, through the object's divisor — ten, which the bolt class's
   * init writes twice (`0x413a21`, `0x413a4d`); it also files gravity 0
   * (`0x413a33`). A hundred pixels an engine frame.
   */
  dx: 1000,
  divisor: 10,
  /** `0x412b7f` — ahead of the muzzle, against this port's facing */
  aheadPx: 120,
  /**
   * `0x412b87` and `0x412b8f`: `y - 0x14 + 0x434540(0x28) - 0x14`, and
   * `0x434540(n)` answers 1..n — so from 39 above the muzzle's y to level with it
   */
  risePx: 40,
  scatterPx: 40,
  /**
   * `0x413b87`..`0x413baf` — the bolt's think expires it once its horizontal
   * speed is under ten or it is more than a thousand pixels from the player,
   * besides on any contact (`obj+0x2a`, `+0x2c`, `+0x2e`, `+0x30`).
   */
  minSpeed: 10,
  rangePx: 1000,
  /** `0x412b66` — `#0350 blaster` in the chapter's own bank */
  sound: 0x23,
  /**
   * `0x413bf9`, through the variant map at `0x413c48`. Not damage: see above.
   */
  blow: -1,
  from: "0x412a70 case 0x412b5b / 0x413af0 / 0x46c588 tag 2",
} as const;

/** one bolt in the air */
export interface Bolt {
  x: number;
  y: number;
  vx: number;
  facing: number;
  spent: boolean;
  /**
   * Its strength, `obj+0x1a`, as the bolt's think writes it from the variant
   * it was fired with (`0x413be0` through the byte map at `0x413c48`): the
   * blaster's variants 2 and 3 give **−1** (`0x413bf9`), and the big gun's
   * `0x412a70(gun, 0)` gives variant 0 and so **100** (`0x413bed`), on tag 0
   * (`0x412afb`) rather than the blaster's tag 2.
   */
  code: -1 | 100;
  /**
   * True on the tick it was created, and it collides with nothing while it is.
   *
   * `0x412a70` builds the bolt through `0x430d40` and the object is collided on
   * the passes AFTER the one that made it; here the gun and the bolts step in
   * the same tick, so a bolt born into something was spent before it had ever
   * been drawn. MAZE is where that showed: the turret at x1850 puts its bolt a
   * hundred and twenty pixels ahead, and now that the level's `initcop` walks up
   * to the player it stands exactly there and ate every one of them on frame
   * zero — the gun fired, and nothing was ever on the screen.
   *
   * A body stopping a bolt is right ({@link stepBolts}: everything stops it and
   * takes nothing). A bolt nobody can see is not.
   */
  born: boolean;
}

/**
 * The three HELD weapons — the flamer, the soaker and the scepter — and they
 * are one shape with three sets of numbers.
 *
 * Each fire function takes the same two arguments as the blaster's and reads
 * the second one the same way, but instead of launching something it adds an
 * object to a LIST that hangs off the player:
 *
 * ```
 *   flamer   0x44dae0   list 0x4788c8   script 0x478858   class 0x453b80
 *   soaker   0x41f820   list 0x470658   script 0x4705e0   class 0x421630
 *   scepter  0x41f6b0   list 0x46f580   script 0x46f4d0   class 0x424510
 * ```
 *
 * ...and two negative variants stop it. `-1` walks the list and writes 1 into
 * every member's `obj+0x18`, which is the kind that means "expire"; `-2` walks
 * it and installs the script's tag 2, which is the animation of shutting off.
 * The armed state machine sends `-2` as the firing tag ends, and the player's
 * own hit handler sends `-1` — `0x448c19` and `0x448c40` test the kinds 0x12 and
 * 0x13 and cancel the stream with it. **Being hit puts your flamethrower out.**
 *
 * ## They do not all hit with the same thing
 *
 * ```
 *   0x4217ba   soaker    mov word ptr [edi+0x1a], 0x64    ; a hundred, every frame
 *   0x424630   scepter   mov word ptr [ecx+0x1a], 0x64    ; a hundred
 *   0x453b9b   flamer    mov word ptr [esi+0x1a], 0xfff7  ; MINUS NINE
 * ```
 *
 * So two of the three are ordinary damage and the flame is a code — and -9 is
 * the one code that is not in the player's table at all (it falls below
 * `0x448c84`'s range test). What reads it is a −9 arm in the victim's own hit
 * handler — eleven of them; see `docs/skullcracker/combat.md`. Like the
 * blaster, the flamethrower is a key rather than a weapon.
 *
 * And they are not free: `0x45ef00` takes rounds off the current weapon, one a
 * frame for the flamer and the soaker — a full 160 is about eleven seconds of
 * flame at fifteen frames a second — against **forty a shot** for the scepter,
 * which is four shots and no more.
 */
export interface StreamKit {
  /** tag 0 — the spout opening */
  start: { cels: readonly number[]; hold: number; from: string };
  /** tag 1 — what it does while it is held */
  loop: { cels: readonly number[]; hold: number; from: string };
  /** tag 2 — what `-2` installs */
  stop: { cels: readonly number[]; hold: number; from: string };
  /**
   * Where it hangs off the player, per variant, in the fire function's own
   * order. `dx` is along the facing and `dy` is up-negative, as everywhere.
   */
  at: readonly { dx: number; dy: number }[];
  /** which of those the STANDING firing tag uses */
  standing: number;
  /** `obj+0x1a`: a hundred, or the code -9 */
  blow: number;
  /** rounds per engine frame the firing state holds — `0x45ef00`'s argument */
  perFrame: number;
  /**
   * The scepter's is not a stream at all: `0x424620` frees its object the
   * frame its script ends and nothing loops it, and the fire function itself
   * takes the rounds (`0x41f7b6`, forty) — one press, one beam.
   */
  shot?: { rounds: number };
  /**
   * What starts with it: the firing state plays an OWN sound as it calls the
   * fire function — `0x42ba94` 0x16 for the flamer, `0x42c3fe` 0x1a for the
   * soaker, both out of the player's bank `0x4ac3e0` — and the scepter's fire
   * function its own, 0x22 (`0x41f73a`), out of the chapter's.
   */
  sound: { own?: number; effect?: number };
  from: string;
}

export const STREAMS: Readonly<Record<number, StreamKit>> = {
  10: {
    start: {
      cels: [9500, 9501, 9502, 9503, 9504, 9505, 9506, 9507],
      hold: 1,
      from: "0x478858 tag 0",
    },
    loop: { cels: [9508, 9509, 9510, 9511], hold: 1, from: "0x478858 tag 1" },
    stop: { cels: [9504], hold: 1, from: "0x478858 tag 2" },
    // `0x44db90` and the three after it
    at: [
      { dx: 0x87, dy: -0x23 },
      { dx: 0x3f, dy: 0xf },
      { dx: 0x31, dy: -0x16 },
      { dx: 0x42, dy: 5 },
    ],
    /** `0x42b860`'s tag 2, which is the one `0x470f98` draws cel 1240 on */
    standing: 0,
    /** `0x453b9b` — a CODE, and nothing ordinary reads it */
    blow: -9,
    perFrame: 1,
    sound: { own: 0x16 },
    from: "0x44dae0 / 0x478858 / 0x453b80, list 0x4788c8",
  },
  12: {
    start: {
      cels: [9800, 9801, 9802, 9803, 9804, 9805, 9806, 9807],
      hold: 1,
      from: "0x4705e0 tag 0",
    },
    loop: { cels: [9806, 9807], hold: 1, from: "0x4705e0 tag 1" },
    stop: { cels: [9804, 9803, 9802, 9801], hold: 1, from: "0x4705e0 tag 2" },
    // `0x41f8d0` and the three after it
    at: [
      { dx: 0xaa, dy: -0x1b },
      { dx: 0x61, dy: 0 },
      { dx: 0x3c, dy: -0xc },
      { dx: 0x42, dy: 0xa },
    ],
    standing: 0,
    /** `0x4217ba`, written fresh every frame the stream runs */
    blow: 100,
    perFrame: 1,
    sound: { own: 0x1a },
    from: "0x41f820 / 0x4705e0 / 0x421630, list 0x470658",
  },
  16: {
    /**
     * `0x41f7ce` installs tag 1 for the standing shot (variant 2) and the
     * walking one (variant 1); tag 0 is the wraith's cast (variant 0, no
     * rounds). The beam is this and nothing after it.
     */
    start: {
      cels: [3280, 3281, 3282, 3283, 3282, 3283],
      hold: 1,
      from: "0x46f4d0 tag 1",
    },
    loop: { cels: [3282, 3283], hold: 1, from: "never shown: see shot" },
    stop: {
      cels: [3280, 3281, 3282, 3281, 3282],
      hold: 1,
      from: "0x46f4d0 tag 2",
    },
    /**
     * `0x41f755` onward, and the scepter's are kept the other way round in the
     * user struct — `user+2` is the dx and `user+0` the dy.
     */
    at: [
      { dx: 0x46, dy: 0 },
      { dx: 0x6e, dy: -3 },
      { dx: 0x67, dy: 0x1b },
      { dx: 0x30, dy: -130 },
      { dx: 0x30, dy: -130 },
    ],
    /** `0x42d2b0`'s tag 4, which is the cel 3391 `0x470c40` draws */
    standing: 2,
    /** `0x424630` */
    blow: 100,
    perFrame: 0,
    /** `0x41f7b6` — FORTY a shot, which is four shots out of a full gauge */
    shot: { rounds: 0x28 },
    sound: { effect: 0x22 },
    from: "0x41f6b0 / 0x46f4d0 / 0x424510, list 0x46f580",
  },
};

/** one live stream, hanging off the player */
export interface Stream {
  weapon: number;
  x: number;
  y: number;
  facing: number;
  state: "start" | "loop" | "stop";
  clock: number;
}

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
  /** engine frames since it was fired — frame 0 is `0x474bf8` tag 0's muzzle */
  age: number;
  /** `obj+0x2e` — standing on something, so the drag runs and gravity does not */
  grounded: boolean;
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
