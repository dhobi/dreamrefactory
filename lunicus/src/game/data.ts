/**
 * Lunicus's tables, as LUNICUS.EXE holds them. Every number here is read out of
 * the EXE (`lunicus/tools/ludis.mts`) or its resource DLL, and cites where.
 */

/** the window: 512x384, the maze view its top-left 384x264 (0x40aa48) */
export const SCREEN_W = 512;
export const SCREEN_H = 384;
export const VIEW_W = 384;
export const VIEW_H = 264;

/**
 * The game's clock ticks at 60 a second: LUNIRES's `_portgetime` answers
 * `timeGetTime() * 3 / 50`. Every wait in the EXE is in these ticks.
 */
export const TICKS_PER_SECOND = 60;

/** a maze frame, and any redraw of the view, waits 3 ticks after the last (0x40d624) */
export const FRAME_TICKS = 3;

/** how long a HUD message stays up: 0x168 ticks (0x410702) */
export const MESSAGE_TICKS = 0x168;

/**
 * The HUD messages, LUNIRES.DLL's string table. `4106cf(n)` shows string n.
 */
export const MESSAGES: Record<number, string> = {
  0: "ENEMY TARGET DESTROYED", 1: "DANGER: ENEMY AHEAD", 2: "DANGER: ENEMY ON LEFT", 3: "DANGER: ENEMY ON RIGHT",
  4: "DANGER: ENEMY BEHIND", 5: "ENEMY TARGET AQUIRED", 6: "ENEMY TARGET EVASIVE", 7: "CAUTION: AMMO LOW",
  8: "CAUTION: SHIELDS LOW", 9: "DANGER: AMMO OUT", 10: "DANGER: SHIELDS DOWN", 11: "CAUTION: BIO STATUS CRITICAL",
  12: "DANGER: BIO STATUS TERMINAL", 13: "SHIELDS AT FULL POWER", 14: "BIO STATUS OK", 15: "AMMO FULLY LOADED",
  16: "PULSE GUN ACQUIRED", 17: "PULSE GUN STORED", 18: "CABINET EMPTY", 19: "CABINET CONTAINS GRENADES",
  20: "CABINET CONTAINS ROCKETS", 21: "CABINET CONTAINS SHELLS", 22: "CABINET CONTAINS SHIELDS",
  23: "CABINET CONTAINS ENERGY BARS", 24: "CABINET CONTAINS ALIEN ARTIFACT", 25: "CABINET LOCKED",
  26: "CYBER SUIT ACQUIRED", 27: "CYBER SUIT STORED", 28: "LEAVING FLOOR: ", 29: "ENTERING FLOOR: ",
  30: "ELEVATOR DOOR JAMMED", 31: "INAPPROPRIATE BEDTIME", 32: "CABINET CONTAINS PLASMA", 33: "FILE CABINET LOCKED",
  34: "DESK EMPTY", 35: "COMPUTER OFF LINE", 36: "NOT AN EXIT", 37: "NO ENTRANCE", 38: "NOTHING IN DESK",
  39: "NO UNAUTHORIZED ACCESS", 40: "TRANSFORMER OPERATING CORRECTLY", 41: "HYDROPONICS IN PROCESS", 42: "PRIVATE BED",
  43: "BRIEFING OVER", 44: "CABINET SUPPLIES REPLENISHED", 45: "TRANSPORTER CURRENTLY IN RECEIVE MODE",
  46: "ENTERING: LOS ANGELES", 47: "ENTERING: TOKYO", 48: "ENTERING: MOSCOW", 49: "ENTERING: ENGINEERING DECK",
  50: "ENTERING: HIVE",
};

/** message ids by name, for the base's code */
export const MSG = {
  bioOk: 14,
  leavingFloor: 28,
  inappropriateBedtime: 31,
  nothingInDesk: 38,
  noUnauthorizedAccess: 39,
  transformer: 40,
  hydroponics: 41,
  privateBed: 42,
  briefingOver: 43,
} as const;

/**
 * A level: the game's `[0x42d1bc]`. 0 is the title; the rest come in the days'
 * order, two base floors a day and then the city's levels. What each is comes
 * from the EXE's lookup tables:
 *
 *   day      0x40a3d7 (table 0x427c04)
 *   floor    0x40a41c (table 0x427c5c): 1 the lower base, 2 the upper, 0 not a base
 */
export const LEVEL_DAY = [0, 1, 1, 0, 0, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6];
export const LEVEL_FLOOR = [0, 2, 1, 0, 0, 2, 1, 0, 0, 2, 1, 0, 0, 2, 1, 0, 0, 2, 1, 0, 0, 0, 0];
export const LOWER = 1;
export const UPPER = 2;
export const dayOf = (level: number): number => LEVEL_DAY[level] ?? 0;
export const floorOf = (level: number): number => LEVEL_FLOOR[level] ?? 0;

/**
 * A new game (File ▸ New, 0x4184ec) starts on level 2 — day one's lower base —
 * with the three progress words cleared but `[0x42d1c0]` = 1.
 */
export const NEW_GAME_LEVEL = 2;

/**
 * The step table: which pose a key goes to. Facings are 0 north (y − 1),
 * 1 south, 2 east and 3 west (0x40d0ed on, tables 0x428108 / 0x428118 /
 * 0x428128). A move is 1 turn left, 2 turn right, 3 forward.
 */
export const TURN_LEFT = [3, 2, 0, 1];
export const TURN_RIGHT = [2, 3, 1, 0];
export const FORWARD_DX = [0, 0, 1, -1];
export const FORWARD_DY = [-1, 1, 0, 0];
export const LEFT = 1;
export const RIGHT = 2;
export const FORWARD = 3;

/** a facing as the camera's angle, 256 to the turn, 0 east (0x40d406 on) */
export const HEADING = [0xc0, 0x40, 0, 0x80];

/** a maze cell's size in world units, and where its centre is (0x40d397) */
export const CELL = 0x1a4;
export const CELL_CENTRE = 0xd2;

/**
 * The depth rectangles a click in the view walks through (0x4279ac): a click
 * inside the widest steps once and tries the next, so a click further in walks
 * further, and a click outside one turns toward its side (0x40daa3).
 */
export const WALK_RECTS: [number, number, number, number][] = [
  [0, 22, 264, 362], [0, 102, 264, 282], [0, 131, 264, 253], [0, 146, 264, 238],
  [0, 155, 264, 229], [0, 161, 264, 223], [0, 166, 264, 218],
];

/**
 * Where a figure may show while the view steps or turns: per animation frame,
 * the rect of the corridor at each depth in cells (0x4279a4 stepping, 0x4277ac
 * turning, 0x48 bytes a frame). A figure is clipped to its depth's rect, which
 * is how the walls hide it.
 */
export const STEP_CLIP: number[][][] = [
  [[0, 0, 264, 384], [0, 22, 264, 362], [0, 102, 264, 282], [0, 131, 264, 253], [0, 146, 264, 238], [0, 155, 264, 229], [0, 161, 264, 223], [0, 166, 264, 218], [0, 169, 264, 215]],
  [[0, 0, 264, 384], [0, 0, 264, 384], [0, 95, 264, 289], [0, 128, 264, 256], [0, 145, 264, 239], [0, 154, 264, 230], [0, 161, 264, 223], [0, 165, 264, 219], [0, 168, 264, 216]],
  [[0, 0, 264, 384], [0, 0, 264, 384], [0, 88, 264, 296], [0, 125, 264, 259], [0, 143, 264, 241], [0, 153, 264, 231], [0, 159, 264, 225], [0, 164, 264, 220], [0, 168, 264, 216]],
  [[0, 0, 264, 384], [0, 0, 264, 384], [0, 80, 264, 304], [0, 121, 264, 263], [0, 140, 264, 244], [0, 151, 264, 233], [0, 159, 264, 225], [0, 163, 264, 221], [0, 168, 264, 216]],
  [[0, 0, 264, 384], [0, 70, 264, 314], [0, 118, 264, 266], [0, 140, 264, 244], [0, 151, 264, 233], [0, 158, 264, 226], [0, 163, 264, 221], [0, 167, 264, 217], [0, 170, 264, 214]],
  [[0, 0, 264, 384], [0, 56, 264, 328], [0, 113, 264, 271], [0, 137, 264, 247], [0, 149, 264, 235], [0, 158, 264, 226], [0, 163, 264, 221], [0, 166, 264, 218], [0, 169, 264, 215]],
  [[0, 0, 264, 384], [0, 40, 264, 344], [0, 108, 264, 276], [0, 134, 264, 250], [0, 148, 264, 236], [0, 157, 264, 227], [0, 162, 264, 222], [0, 167, 264, 217], [0, 169, 264, 215]],
  [[0, 0, 264, 384], [0, 21, 264, 363], [0, 103, 264, 281], [0, 131, 264, 253], [0, 146, 264, 238], [0, 155, 264, 229], [0, 161, 264, 223], [0, 166, 264, 218], [0, 169, 264, 215]],
];
export const TURN_CLIP: number[][][] = [
  [[0, 0, 264, 384], [0, 22, 264, 362], [0, 102, 264, 282], [0, 131, 264, 253], [0, 146, 264, 237], [0, 155, 264, 228], [0, 161, 264, 224], [0, 166, 264, 218], [0, 169, 264, 215]],
  [[0, 0, 264, 384], [0, 0, 264, 301], [0, 21, 264, 208], [0, 44, 264, 173], [0, 57, 264, 153], [0, 64, 264, 142], [0, 68, 264, 133], [0, 72, 264, 128], [0, 74, 264, 123]],
  [[0, 0, 264, 384], [0, 0, 264, 245], [0, 0, 264, 137], [0, 0, 264, 91], [0, 0, 264, 64], [0, 0, 264, 49], [0, 0, 264, 37], [0, 0, 264, 29], [0, 0, 264, 22]],
  [[0, 0, 264, 384], [0, 0, 264, 192], [0, 0, 264, 60], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
  [[0, 0, 264, 384], [0, 0, 264, 138], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
  [[0, 0, 264, 384], [0, 0, 264, 82], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
  [[0, 0, 264, 384], [0, 0, 264, 21], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
];

/** the HUD (0x410258): the message line, and the four bars (0x410361 on) */
export const MESSAGE_RECT: readonly [number, number, number, number] = [0x10f, 0x40, 0x11d, 0x1f0];
export const BAR_ENERGY: readonly [number, number, number, number] = [0x124, 0x40, 0x12f, 0xf1];
export const BAR_AMMO: readonly [number, number, number, number] = [0x124, 0x140, 0x12f, 0x1f1];
export const BAR_ENEMIES: readonly [number, number, number, number] = [0x135, 0x40, 0x140, 0xf1];
export const BAR_SHIELDS: readonly [number, number, number, number] = [0x135, 0x140, 0x140, 0x1f1];
/** a bar is full at 10000 and draws 177 px of it; 2500 or less is the warning colour (0x4115f1) */
export const BAR_FULL = 10000;
export const BAR_LOW = 2500;
/** the HUD's two text colours, in the Macintosh palette's indices (0x411225) */
export const INK_WARN = 0x74;
export const INK = 0x78;
/** the panel's six buttons along the bottom (0x4102cb): top 327, 64 wide, around the logo */
export const BUTTON_LEFT = [0, 64, 128, 320, 384, 448];
export const BUTTON_TOP = 0x147;

/** a conversation's menu lines: 24 px each from y 264, the text at +8, +16 (0x415f89, 0x415f24) */
export const MENU_TOP = 0x108;
export const MENU_LINE = 0x18;
