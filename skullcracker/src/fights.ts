import type { FoeAnim } from "./foes";

/**
 * The shared enemy AI, and it is one brain with twenty-six sets of numbers.
 *
 * Every class that fights in this game hangs off the same three pieces, and the
 * only thing that differs between a street punk and the dog is the table.
 *
 * ## The tracker — `0x45efd0`
 *
 * Each creator allocates its object an AI struct (`0x433f20(0x36)` for the punk)
 * and calls `0x45ef70(tracker, self, player, bands)` on the tail of it. `bands`
 * is a list of DESCENDING distances terminated by a zero, at most twelve of them,
 * and it lives in the class's own data — the punk's `0x477600` is `330 200 150
 * 80`, the dog's `0x478240` is `1200 650 410 320 180`, the wraith's `0x46f8f8` is
 * `700 230 130 60`. `0x45efd0` then fills a sixteen-byte answer every frame:
 *
 * ```
 *   out+0x0a  di    the FORWARD distance — (player.x - self.x), negated when the
 *                   class faces west, so a negative number means "behind me"
 *   out+0x08  cx    player.y - self.y
 *   out+0x00        which side of the PLAYER it stands on: 1 in front, 0 behind,
 *                   2 when the player is not moving (`[player+0xc]` is zero)
 *   out+0x04        the BAND: 0 while `di` is past the first threshold, and one
 *                   more for each threshold it is inside — so the last index is
 *                   the closest, and -1 means the player is behind it
 *   out+0x06        1 when the PLAYER's current cel carries a strike box, which
 *                   is the engine asking "is he swinging at me right now"
 * ```
 *
 * ## What each class does with it
 *
 * `obj+0x18` is the state and every class dispatches on it through a table of its
 * own — twelve entries for the cop, thirteen for the punk. Two of them are the
 * same everywhere:
 *
 * - **state 0 is the patrol**, and the one thing that ends it is `0x434200`
 *   finding the PLAYER'S POINT inside the AI's own rect (`AI+8`, the four words
 *   the creator copied out of the `init` record). Otherwise it walks its
 *   territory INSET BY A HUNDRED PIXELS at each end (`0x44e68e`, `0x44e69f`),
 *   clamping and turning at the inset edge.
 * - **state 1 is the fight**, gated on `0x402f60` — which is one test, that the
 *   player's own state is under `0x1a`. It turns to face the player when the
 *   forward distance is negative (`0x44e73c`), it swaps sides when too many of
 *   its own class are crowding one side (`0x44f020`: more than three within two
 *   hundred pixels), and then it jumps through a SECOND table indexed by the
 *   band, where the far entries install a walk and the near ones install an
 *   attack.
 *
 * ## Which of a class's scripts is an attack, and the disc says so
 *
 * Not a judgement: a cel carrying a STRIKE BOX is the engine's own mark for "this
 * frame hits", and it is the very flag the tracker reads at `out+6` to tell
 * whether the player is swinging. So the attacks below are every tag of every
 * script the class installs whose cels carry one, read out of the book the class
 * actually appears in — the punk's 1923/1924 (the punch), 1931/1932 and
 * 1934/1935 (the two swings) and 1943 (the flying kick), against a walk on
 * 1910…1915 that carries none.
 *
 * `close` is the class's own walk — the script whose frames travel forward and
 * carry no strike box. Where a class has none of its own here, the port falls
 * back to {@link Foe.gait}, which is the same script read at the other end.
 *
 * ## What this port does NOT do with it yet
 *
 * - **Nothing here lands a blow.** The attacks play and travel by their own
 *   numbers and take no health off the player; the engine's own damage word is
 *   `0x4ac3d0` and nothing below reaches it.
 * - **The leaping attacks do not leap.** Their own `dy` is in the table below —
 *   `0x477368 tag 0` is `dy -480` on the frame the punk leaves the ground — and
 *   nothing applies it: the engine carries a leap as velocity through `obj+0xa`
 *   and this page putting it straight into `y` sent WOODS' CHOPPER through the floor
 *   and out of the level.
 * - A class whose own {@link Foe.gait} carries no stride does not close and is
 *   not moved by its attack either. LAB's ten `initarm` are the case — arms out
 *   of a wall — and they swing where they stand.
 * - A keeper with a lever still unlit inside its own rect goes for the lever
 *   (`0x438200`) rather than the player, which is the whole of level six.
 * - The per-band table is read as "the innermost band swings, the rest close",
 *   which is what the punk, the dog, `initwerec`, `initigor` and `initbat` do.
 *   The casters do not — `initvpriest` throws from its OUTERMOST band — and this
 *   page does not yet tell them apart.
 * - `initeyeball` and `initpuke` carry no strike box on any cel of their own, so
 *   they close and never swing. Both of them spit, and the thing that hits you is
 *   the projectile rather than the body.
 */
export interface FoeFight {
  /** the class's own descending table, the fourth argument to `0x45ef70` */
  bands: readonly number[];
  /** the walk it closes with — its own, where the class has one */
  close?: FoeAnim;
  /** every tag of its own whose cels carry a strike box */
  attacks: readonly FoeAnim[];
  from: string;
}

/** by `init` name, the same key {@link FOES} uses */
export const FIGHTS: Readonly<Record<string, FoeFight>> = {
  initarm: {
    bands: [180, 160, 40],
    close: {
      cels: [3380, 3381, 3382, 3383],
      hold: 1,
      dx: [60, 60, 60, 60],
      from: "0x46cfe0 tag 0",
    },
    attacks: [
      {
        cels: [3340, 3341, 3342, 3343, 3343, 3343, 3344, 3349],
        hold: 2,
        dx: [0, 0, 0, 0, 0, 0, 200, 0],
        dy: [0, 0, 0, 0, 0, 0, -200, 0],
        from: "0x46d120 tag 0",
      },
      {
        cels: [3340, 3341, 3342, 3343, 3343, 3343, 3344, 3349],
        hold: 2,
        dx: [0, 0, 0, 0, 0, 0, 200, 0],
        dy: [0, 0, 0, 0, 0, 0, -100, 0],
        from: "0x46d120 tag 1",
      },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initbat: {
    bands: [600, 250, 50],
    attacks: [
      {
        cels: [2200, 2201, 2202, 2203],
        hold: 1,
        dx: [3, 3, 3, 3],
        from: "0x46f060 tag 0",
      },
      { cels: [2204], hold: 1, dx: [4], from: "0x46f060 tag 1" },
      { cels: [2201], hold: 1, dx: [4], from: "0x46f060 tag 2" },
      {
        cels: [2200, 2201, 2202, 2203],
        hold: 1,
        dx: [4, 4, 4, 4],
        from: "0x46f060 tag 3",
      },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initbatboy: {
    bands: [400, 150, 85],
    attacks: [
      { cels: [1910, 1911], hold: 2, dx: [60, 0], from: "0x474488 tag 0" },
      { cels: [1913, 1914], hold: 2, dx: [60, 0], from: "0x474488 tag 1" },
      { cels: [1912], hold: 2, from: "0x474488 tag 2" },
      { cels: [1915], hold: 2, from: "0x474488 tag 3" },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initcop: {
    bands: [350, 180, 70],
    close: {
      cels: [2100, 2101, 2102, 2103, 2104, 2105],
      hold: 2,
      dx: [65, 65, 65, 65, 65, 65],
      from: "0x46c720 tag 0",
    },
    attacks: [
      {
        cels: [2160, 2161, 2162, 2163, 2164, 2163, 2162],
        hold: 1,
        dx: [130, 105, 0, 0, 0, 0, 0],
        from: "0x46c660 tag 1",
      },
      {
        cels: [2160, 2161, 2170, 2171, 2172, 2173, 2172],
        hold: 1,
        dx: [130, 130, 130, 130, 130, 130, 130],
        from: "0x46c660 tag 2",
      },
      {
        cels: [2162, 2163, 2164],
        hold: 1,
        dx: [0, 0, -10],
        from: "0x46c660 tag 3",
      },
      {
        cels: [2170, 2171, 2172, 2173],
        hold: 1,
        dx: [0, 0, 0, -10],
        from: "0x46c660 tag 4",
      },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initdog: {
    bands: [1200, 650, 410, 320, 180],
    close: {
      cels: [4800, 4801, 4802, 4803, 4804, 4805, 4806, 4807, 4808, 4809],
      hold: 2,
      dx: [65, 65, 65, 65, 65, 65, 65, 65, 65, 65],
      from: "0x477fe0 tag 0",
    },
    attacks: [
      { cels: [4830, 4831, 4830], hold: 1, from: "0x477f90 tag 2" },
      {
        cels: [
          4820, 4821, 4822, 4823, 4824, 4824, 4825, 4825, 4813, 4814, 4815,
        ],
        hold: 2,
        dx: [0, 110, 110, 110, 160, 160, 110, 110, 110, 110, 110],
        dy: [0, 0, 0, 0, -80, -80, 0, 0, 0, 0, 0],
        from: "0x478108 tag 0",
      },
      {
        cels: [4820, 4821, 4822, 4823, 4824, 4825, 4813, 4814, 4815],
        hold: 2,
        dx: [0, 0, 0, 65, 160, 110, 65, 65, 65],
        dy: [0, 0, 0, 0, -80, 0, 0, 0, 0],
        from: "0x478108 tag 1",
      },
      {
        cels: [4823, 4824, 4824, 4825, 4825, 4813, 4814, 4815],
        hold: 2,
        dx: [110, 0, 0, 160, 0, 0, 0, 110],
        dy: [0, -80, -160, -80, -80, 0, 0, 0],
        from: "0x4781b0 tag 0",
      },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initeyeball: {
    bands: [260, 180, 140],
    close: { cels: [6206], hold: 2, dx: [20], from: "0x472998 tag 0" },
    attacks: [],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initghengis: {
    bands: [350, 180, 70],
    close: {
      cels: [400, 401, 402, 403, 404, 405],
      hold: 2,
      dx: [85, 85, 85, 85, 85, 85],
      from: "0x46ee60 tag 0",
    },
    attacks: [
      {
        cels: [410, 411, 412, 413],
        hold: 2,
        dx: [85, 85, 170, 170],
        from: "0x46ee38 tag 0",
      },
      {
        cels: [410, 411, 412, 413, 413, 413],
        hold: 1,
        dx: [170, 170, 170, 170, 170, 170],
        from: "0x46ef30 tag 1",
      },
      {
        cels: [411, 412, 413],
        hold: 1,
        dx: [85, 170, 170],
        from: "0x46ef30 tag 2",
      },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  inithardcore: {
    bands: [500, 300, 220, 160],
    close: {
      cels: [6070, 6071, 6072, 6073],
      hold: 2,
      dx: [100, 100, 100, 100],
      from: "0x474a38 tag 0",
    },
    attacks: [
      {
        cels: [6040, 6041, 6042, 6043, 6044, 6045, 6044, 6043],
        hold: 1,
        from: "0x4749c8 tag 0",
      },
      { cels: [6090, 6091, 6092, 6091, 6090], hold: 1, from: "0x4749c8 tag 1" },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initigor: {
    bands: [350, 300, 150, 80],
    attacks: [
      {
        cels: [
          3110, 3111, 3112, 3113, 3114, 3115, 3114, 3113, 3112, 3111, 3110,
        ],
        hold: 1,
        from: "0x46fed0 tag 0",
      },
      {
        cels: [3120, 3121, 3121, 3121, 3122, 3123],
        hold: 2,
        from: "0x46ff30 tag 0",
      },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initknifeboy: {
    bands: [400, 150, 85],
    attacks: [
      { cels: [1850, 1851], hold: 2, dx: [60, 0], from: "0x4746f8 tag 0" },
      { cels: [1853, 1854], hold: 2, dx: [60, 0], from: "0x4746f8 tag 1" },
      { cels: [1852], hold: 2, from: "0x4746f8 tag 2" },
      {
        cels: [1850, 1851, 1852, 1853, 1854, 1855],
        hold: 2,
        from: "0x4746f8 tag 4",
      },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initknotboy: {
    bands: [400, 150, 85],
    close: {
      cels: [1940, 1941, 1942, 1943, 1944, 1945],
      hold: 1,
      dx: [0, 60, 70, 80, 120, 0],
      from: "0x473fb0 tag 4",
    },
    attacks: [
      { cels: [1953, 1954], hold: 2, dx: [60, 0], from: "0x474010 tag 1" },
      { cels: [1952], hold: 2, from: "0x474010 tag 2" },
      { cels: [1955], hold: 2, from: "0x474010 tag 3" },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initmaskboy: {
    bands: [400, 150, 85],
    attacks: [
      {
        cels: [1811, 1811, 1812, 1811, 1812, 1813],
        hold: 1,
        dx: [10, 10, 10, 10, 10, 10],
        from: "0x4741c0 tag 2",
      },
      { cels: [1813, 1814], hold: 2, dx: [60, 0], from: "0x4742a0 tag 1" },
      { cels: [1812], hold: 2, from: "0x4742a0 tag 2" },
      { cels: [1815], hold: 2, from: "0x4742a0 tag 3" },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initox: {
    bands: [300, 140, 100],
    close: {
      cels: [5090, 5091, 5092, 5093, 5094, 5095],
      hold: 1,
      dx: [85, 85, 85, 85, 85, 85],
      from: "0x472e88 tag 0",
    },
    attacks: [
      {
        cels: [5170, 5171, 5172, 5173, 5174, 5175],
        hold: 1,
        from: "0x472ff0 tag 1",
      },
      {
        cels: [5160, 5161, 5162, 5163, 5164],
        hold: 1,
        dx: [85, 85, 85, 85, 0],
        from: "0x473098 tag 0",
      },
      {
        cels: [5170, 5171, 5172, 5173, 5174, 5175],
        hold: 1,
        dx: [85, 85, 105, 0, 0, 0],
        from: "0x473098 tag 1",
      },
      {
        cels: [5120, 5121, 5122, 5123, 5124, 5123, 5122, 5121, 5120],
        hold: 1,
        dx: [85, 85, 105, 0, 0, 0, 0, 0, 0],
        from: "0x473098 tag 2",
      },
      {
        cels: [
          5140, 5141, 5142, 5143, 5144, 5145, 5146, 5147, 5150, 5151, 5152,
          5153, 5154, 5155,
        ],
        hold: 1,
        dx: [85, 85, 85, 85, 85, 85, 280, 85, 280, 280, 280, 280, 280, 280],
        from: "0x473260 tag 0",
      },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initpuke: {
    bands: [280, 180, 110],
    close: {
      cels: [3000, 3001, 3002, 3003, 3004],
      hold: 1,
      dx: [93, 93, 93, 93, 93],
      from: "0x46ca30 tag 0",
    },
    attacks: [],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initrat: {
    bands: [200, 80],
    close: {
      cels: [3025, 3024, 3023, 3022, 3021, 3020],
      hold: 1,
      dx: [85, 85, 85, 85, 85, 85],
      from: "0x476ff0 tag 0",
    },
    attacks: [
      { cels: [3003], hold: 4, from: "0x476fd0 tag 1" },
      { cels: [3004], hold: 4, from: "0x476fd0 tag 2" },
      {
        cels: [3000, 3001, 3002, 3003, 3004, 3005],
        hold: 1,
        dx: [150, 0, 0, 0, 0, 0],
        dy: [-250, 0, 0, 0, 0, 0],
        from: "0x477058 tag 0",
      },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initskel: {
    bands: [400, 140, 100],
    close: {
      cels: [1200, 1201, 1202, 1203, 1204, 1205],
      hold: 2,
      dx: [65, 65, 65, 65, 65, 65],
      from: "0x46fac0 tag 0",
    },
    attacks: [
      { cels: [1320, 1321, 1322], hold: 2, from: "0x46fc88 tag 0" },
      {
        cels: [1290, 1291, 1292, 1293, 1294, 1293, 1292, 1291, 1290],
        hold: 2,
        from: "0x46fc88 tag 1",
      },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initslurp: {
    bands: [260, 180, 140],
    attacks: [
      {
        cels: [
          2650, 2651, 2652, 2653, 2654, 2655, 2656, 2700, 2701, 2702, 2703,
          2704,
        ],
        hold: 1,
        from: "0x46d370 tag 0",
      },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  inittube: {
    bands: [260, 140, 100],
    close: {
      cels: [5410, 5411, 5412, 5413],
      hold: 1,
      dx: [65, 185, 215, 245],
      from: "0x46d7a0 tag 0",
    },
    attacks: [
      {
        cels: [5400, 5401, 5402, 5403, 5404, 5405, 5406, 5407, 5408],
        hold: 1,
        from: "0x46d928 tag 0",
      },
      {
        cels: [5480, 5481, 5482, 5483, 5484, 5485, 5486, 5487],
        hold: 1,
        from: "0x46d928 tag 1",
      },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initvpriest: {
    bands: [220, 170, 100],
    attacks: [
      {
        cels: [2612, 2613, 2614],
        hold: 1,
        dx: [-30, -20, -10],
        from: "0x46f1c0 tag 1",
      },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initwbooly: {
    bands: [1000, 750, 500, 400, 160, 60],
    close: {
      cels: [3000, 3001, 3002, 3003, 3004, 3005, 3006],
      hold: 1,
      dx: [310, 310, 310, 310, 310, 310, 310],
      from: "0x4785e8 tag 1",
    },
    attacks: [
      { cels: [3052, 3052, 3053, 3054, 3055], hold: 2, from: "0x478448 tag 0" },
      { cels: [3130, 3131, 3132, 3133, 3134], hold: 1, from: "0x4784e8 tag 0" },
      {
        cels: [3060, 3061, 3062, 3063, 3064, 3065, 3066, 3067, 3068],
        hold: 1,
        dx: [0, 0, 0, 0, 0, 0, 0, 0, 310],
        from: "0x4785e8 tag 2",
      },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initwerea: {
    bands: [330, 200, 150, 80],
    close: {
      cels: [1910, 1911, 1912, 1913, 1914, 1915],
      hold: 2,
      dx: [75, 75, 75, 75, 75, 75],
      from: "0x4770f0 tag 0",
    },
    attacks: [
      {
        cels: [1920, 1920, 1921, 1922, 1923, 1924, 1922, 1921, 1920],
        hold: 2,
        from: "0x4771d8 tag 0",
      },
      {
        cels: [1930, 1930, 1930, 1931, 1932, 1932, 1932],
        hold: 1,
        from: "0x477240 tag 0",
      },
      {
        cels: [1933, 1933, 1933, 1934, 1935, 1935, 1935],
        hold: 1,
        from: "0x477240 tag 1",
      },
      {
        cels: [1930, 1930, 1930, 1931, 1932, 1932, 1932],
        hold: 1,
        dx: [75, 75, 75, 75, 75, 75, 75],
        from: "0x477240 tag 2",
      },
      {
        cels: [1933, 1933, 1933, 1934, 1935, 1935, 1935],
        hold: 1,
        dx: [75, 75, 75, 75, 75, 75, 75],
        from: "0x477240 tag 3",
      },
      {
        cels: [1920, 1921, 1922, 1923, 1924, 1922, 1921, 1920],
        hold: 1,
        dx: [75, 75, 75, 75, 75, 75, 75, 75],
        from: "0x477240 tag 4",
      },
      {
        cels: [1940, 1941, 1942, 1943],
        hold: 2,
        dx: [0, 0, 150, 25],
        dy: [0, 0, -480, 0],
        from: "0x477368 tag 0",
      },
      { cels: [1940, 1941, 1942, 1943], hold: 2, from: "0x477368 tag 2" },
      {
        cels: [1940, 1941, 1942, 1932],
        hold: 2,
        dx: [0, 0, 0, -25],
        dy: [0, 0, -480, 0],
        from: "0x477368 tag 3",
      },
      {
        cels: [1940, 1941, 1942, 1943],
        hold: 2,
        dx: [0, 0, 225, 75],
        dy: [0, 0, -600, 0],
        from: "0x477368 tag 4",
      },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initwereb: {
    bands: [350, 250, 200, 160],
    close: {
      cels: [5000, 5001, 5002, 5003, 5004, 5005],
      hold: 2,
      dx: [75, 75, 75, 75, 75, 75],
      from: "0x477630 tag 0",
    },
    attacks: [
      {
        cels: [5040, 5041, 5042, 5043, 5044, 5045, 5000, 5000],
        hold: 1,
        from: "0x477768 tag 1",
      },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initwerec: {
    bands: [550, 450, 220, 80],
    close: {
      cels: [5090, 5091, 5092, 5093, 5094, 5095],
      hold: 2,
      dx: [75, 75, 75, 75, 75, 75],
      from: "0x4778e0 tag 0",
    },
    attacks: [
      {
        cels: [6010, 6010, 6011, 6012, 6013, 6014, 6012, 6011, 6010],
        hold: 2,
        from: "0x4779b0 tag 0",
      },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initwered: {
    bands: [600, 600, 160, 70],
    close: {
      cels: [4870, 4871, 4872, 4873],
      hold: 1,
      dx: [190, 190, 190, 190],
      from: "0x477ae0 tag 0",
    },
    attacks: [
      {
        cels: [4880, 4881, 4882, 4883, 4884, 4885],
        hold: 1,
        dx: [190, 190, 190, 190, 190, 190],
        from: "0x477b28 tag 0",
      },
      {
        cels: [4905, 4905, 4906, 4907, 4908, 4909, 4910, 4911],
        hold: 2,
        from: "0x477ba0 tag 3",
      },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initwraith: {
    bands: [700, 230, 130, 60],
    attacks: [
      {
        cels: [3250, 3251, 3252, 3253, 3252, 3253, 3252, 3251, 3250],
        hold: 2,
        from: "0x46f6c8 tag 0",
      },
      {
        cels: [3250, 3251, 3252, 3253, 3252, 3253, 3252, 3251, 3250],
        hold: 2,
        dx: [20, 20, 20, 10, 10, 10, 10, 10, 10],
        from: "0x46f6c8 tag 1",
      },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
  initzomb: {
    bands: [300, 200, 100],
    close: {
      cels: [1800, 1801, 1802, 1803, 1804, 1805],
      hold: 2,
      dx: [65, 65, 65, 65, 65, 65],
      from: "0x470110 tag 0",
    },
    attacks: [
      {
        cels: [1850, 1851, 1852, 1853, 1854, 1855],
        hold: 2,
        from: "0x4701e0 tag 0",
      },
      {
        cels: [1855, 1854, 1853, 1852, 1851, 1850],
        hold: 2,
        from: "0x4701e0 tag 1",
      },
    ],
    from: "the class's own scripts, bands from 0x45ef70",
  },
};
