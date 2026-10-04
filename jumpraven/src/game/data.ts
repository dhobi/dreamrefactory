/**
 * Jump Raven's tables, as RAVEN.EXE holds them. Every number here is read out
 * of the EXE (`jumpraven/tools/rvdis.mts`) or its resource DLL, and cites where.
 */
import type { Rect } from "@dreamfactory/engine/v0/screen";

export { SCREEN_H, SCREEN_W } from "@dreamfactory/engine/v0/screen";

/** the clock: 60 ticks a second, as in Lunicus (`_portgetime`) */
export const TICKS_PER_SECOND = 60;

/**
 * A level: the game's `[0x43b2fc]`, 0 to 8. The dispatcher (0x40e911, table
 * 0x43160c) sends the even ones to the story (0x426124) — the films and
 * briefings between the flying — 1 to the high scores screen (0x420840), and
 * 3, 5 and 7 to the flying (0x40b190).
 *
 *   0  a new install's opening: the intro, the first briefing, the tutorial
 *   1  the high scores screen, where PLAY starts a game
 *   2  day 1's briefings and the Mart, then the Bronx
 *   3  flying: the Bronx
 *   4  day 1's debrief, day 2's briefings, then Brooklyn
 *   5  flying: Brooklyn
 *   6  day 2's debrief, day 3's briefings
 *   7  flying: day 3
 *   8  day 3's debrief and the end
 */
export const OPENING = 0;
export const HIGH_SCORES = 1;
export const isFlying = (level: number): boolean => level === 3 || level === 5 || level === 7;

/** the day's folder a level reads its files from (0x40e8df): `Day1\` … `Day4\` */
export function dayOf(level: number): number {
  if (level <= 3) return 1;
  if (level <= 5) return 2;
  if (level <= 7) return 3;
  return 4;
}

/**
 * The difficulty, `[0x439fb0]`: Settings ▸ Training, Intermediate, Advanced,
 * Expert, 1 to 4 (0x421644); 2 until the player says otherwise (0x4208da).
 * A Training game ends after its first day (0x42226f, 0x426411).
 */
export const TRAINING = 1;
export const DEFAULT_DIFFICULTY = 2;
/** RAVENRES.DLL's strings 0–3 (0x422e35): the high scores' heading for each */
export const DIFFICULTY_NAMES = ["Training Level", "Intermediate Level", "Advanced Level", "Expert Level"];

/**
 * `puppet`: RAVEN.EXE's pictures that are in no other file (SHARED\PUPPET).
 * 0 is the talk menu's backdrop, five dark bars (0x40f04d); 1 the high scores
 * screen (0x420964); from 2 a pair of side panels per level, 80 wide, drawn
 * either side of a briefing's 352-wide face (0x42696d). The story names the
 * pair's first as `[0x43ab40]`.
 */
export const PUPPET_MENU = 0;
export const PUPPET_SCORES = 1;
/** `[0x43ab40]` as each story level sets it (0x426142 …) */
export const SIDE_PANELS: Record<number, number> = { 0: 2, 2: 4, 4: 6, 6: 8, 8: 10 };
/** where the panels go (0x4269d5, 0x426a57), top, left, bottom, right */
export const LEFT_PANEL: Rect = [0, 0, 0x108, 0x50];
export const RIGHT_PANEL: Rect = [0, 0x1b0, 0x108, 0x200];

/**
 * The high scores screen's six buttons (0x421df5): 79 by 24, in the order the
 * mouse-down handler tries them (0x420a6d) and what each does (0x432228).
 */
export const SCORE_BUTTONS: { rect: Rect; what: ScoreButton }[] = [
  { rect: [0x157, 0xc1, 0x157 + 0x18, 0xc1 + 0x4f], what: "quit" },
  { rect: [0x138, 0x14, 0x138 + 0x18, 0x14 + 0x4f], what: "help" },
  { rect: [0x138, 0x6a, 0x138 + 0x18, 0x6a + 0x4f], what: "history" },
  { rect: [0x157, 0x14, 0x157 + 0x18, 0x14 + 0x4f], what: "about" },
  { rect: [0x157, 0x6a, 0x157 + 0x18, 0x6a + 0x4f], what: "craft" },
  { rect: [0x138, 0xc1, 0x138 + 0x18, 0xc1 + 0x4f], what: "play" },
];
export type ScoreButton = "quit" | "help" | "history" | "about" | "craft" | "play";
/** the films behind four of them (0x420aff …) */
export const BUTTON_FILMS: Partial<Record<ScoreButton, string>> = {
  help: "help.move",
  history: "hist.move",
  about: "about.move",
  craft: "jet.move",
};

/**
 * The high scores (0x42177a): the heading centred on x 125 at baseline 124,
 * then the seven places 17 apart from baseline 144, the name at x 29 and the
 * score's right edge at 203, in ink 0x19. The area repainted after a new
 * score (0x421dcb).
 */
export const SCORES_INK = 0x19;
export const SCORES_AREA: Rect = [0x64, 0x1d, 0xf5, 0xcb];

/** the talk menu's inks (0x41f4c4, 0x41f926) and its face (0x41ef54, 0x41f2c3) */
export const TALK_INK = 0x19;
export const TALK_PRESSED = 0x28;
export const FACE_WIDTH = 0x160;
export const FACE_LEFT = 0x50;
