/**
 * The `.SKL` saved game — twenty-two bytes, and both pages read them.
 *
 * `SC.EXE` does have a save game. The only text that names the format lives in
 * the resource string table as UTF-16 — `Saved games (.SKL)|*.skl||` at
 * `0x4b62f8` — so an ASCII search of the executable for "SKL" finds nothing,
 * which is why this page said for a long time that there was none.
 *
 * The writer is `0x45e1e0`, the pause panel's own middle button. It builds
 * twenty-two bytes on its stack, `0x41dc60` creates the file with the Macintosh
 * type and creator `'SSAV'` and `'SKLC'` — arguments to the portability layer,
 * dropped on Windows, where `CreateFileA` takes only the path — and `0x41daf0`
 * writes the lot in ONE call. No header, no magic, no checksum, no padding: the
 * file IS the record.
 *
 * ```
 *   +0x00  u32  0x00010000    written by 0x45e246, read by nobody
 *   +0x04  u16  [0x4abdfe]    the shell scene  -> the chapter
 *   +0x06  u16  [0x4abdfc]    the stage within it -> the level
 *   +0x08  u32  [0x4a4f00]    the score
 *   +0x0c  u16  [0x4a4d64]    lives
 *   +0x0e  u16  [0x479434]    the weapon, or 1 for none
 *   +0x10  u16  [0x4a7f16 + weapon*12]   its rounds
 *   +0x12  u32  0             written by 0x45e2bd, read by nobody
 * ```
 *
 * The reader is `0x45df8d`, the title screen's Open button. It reads all
 * twenty-two bytes and then starts at offset FOUR — so the stamp at the front
 * is not a version and not a magic, and nothing in the program will reject a
 * file for anything but its length.
 *
 * ## The level is not in the file
 *
 * The scene is the outer state machine's own — `0x403059` dispatches on it
 * through the table at `0x403448`, where 1 is the title, 3..6 are the four
 * chapters and 11 is quit — and the stage is the chapter runner's own counter.
 * Each runner dispatches the stage through a table of its own (`0x44da38`,
 * `0x436c9c`, `0x41f5fc`, `0x4129c8`) and in every one of the four, stages two
 * through five are that chapter's four levels in order:
 *
 * ```
 *   scene 3  stage 2..5   Chp01..Chp04   streets  city   woods     playgr
 *   scene 4  stage 2..5   Chp05..Chp08   mall     service sewer    arcade
 *   scene 5  stage 2..5   Chp09..Chp12   grave    cavern ravecave  tower
 *   scene 6  stage 2..5   Chp13..Chp16   maze     barrel lab       vat
 * ```
 *
 * ## ...and neither is anything else
 *
 * No character, no difficulty, no position, no health, no clock, no kill count.
 * A load re-enters the chapter runner at the saved stage and the level starts
 * from its own record's point, with whatever the title screen still holds. The
 * save is a bookmark, not a snapshot, and this page keeps it one.
 *
 * The gun is the single exception and it is deliberate. `0x44da80` and its three
 * siblings zero all twenty-one rounds counts on entering a chapter, but only
 * while `[0x47913c]` is 0 — and `0x45e068` sets it to 1 on a load. `0x479438`,
 * the ARMED flag, is not in the file, but `0x45e041` sets it whenever the saved
 * weapon is not 1 (none), so a loaded game has its gun in its hands.
 */

/** what the writer and the reader agree on */
export const SKL = {
  /** `push 0x16` at `0x45e30f` and `0x45dfec` — the whole file */
  bytes: 0x16,
  /** `0x45e246`, and `0x45df8d` never looks at it */
  stamp: 0x00010000,
  /** `0x403448`'s entries 3..6, the four chapter runners */
  firstChapterScene: 3,
  /** every runner's own table: stage 2 is the chapter's first level */
  firstLevelStage: 2,
  /** `0x40d400`: a load clamps the lives to five on the way in */
  maxLives: 5,
  /** `0x45e2f8` / `0x45e2f3` — Macintosh type and creator, dropped on Windows */
  type: "SSAV",
  creator: "SKLC",
  from: "0x45e1e0 writes it, 0x45df8d reads it",
} as const;

/** what a `.SKL` says, with the level worked out from the two words that carry it */
export interface SkullSave {
  /** `[0x4abdfe]` — 3..6 for the four chapters */
  scene: number;
  /** `[0x4abdfc]` — 2..5 for the four levels of one */
  stage: number;
  /** ZERO-BASED, the port's own index: `(scene - 3) * 4 + (stage - 2)` */
  level: number;
  score: number;
  lives: number;
  /** `[0x479434]`, and 1 is the sentinel `0x45e039` reads as "none" */
  weapon: number;
  /** `[0x4a7f16 + weapon * 12]` — the rounds in that one weapon and no other */
  rounds: number;
}

/** the state a save is made OF, which is all this page has to hand it */
export interface SkullState {
  /** zero-based */
  level: number;
  score: number;
  lives: number;
  weapon: number;
  rounds: number;
}

/**
 * Twenty-two bytes, in the order `0x45e246`..`0x45e2bd` writes them.
 *
 * Both words the level is carried in are derived here rather than stored, since
 * the port keeps one level index where the original keeps a scene and a stage.
 */
export function writeSkl(s: SkullState): Uint8Array {
  const out = new Uint8Array(SKL.bytes);
  const v = new DataView(out.buffer);
  const level = Math.min(15, Math.max(0, Math.floor(s.level)));
  v.setUint32(0x00, SKL.stamp, true);
  v.setUint16(0x04, SKL.firstChapterScene + Math.floor(level / 4), true);
  v.setUint16(0x06, SKL.firstLevelStage + (level % 4), true);
  v.setUint32(0x08, Math.max(0, Math.floor(s.score)), true);
  v.setUint16(0x0c, Math.max(0, Math.floor(s.lives)), true);
  v.setUint16(0x0e, s.weapon, true);
  v.setUint16(0x10, Math.max(0, Math.floor(s.rounds)), true);
  v.setUint32(0x12, 0, true);
  return out;
}

/**
 * ...and back, with the loader's own arithmetic.
 *
 * Null for anything that is not twenty-two bytes, which is the only test there
 * is to make: the file carries nothing that identifies it. A scene or a stage
 * outside the four chapters leaves `level` at -1 rather than guessing.
 */
export function readSkl(bytes: Uint8Array): SkullSave | null {
  if (bytes.length !== SKL.bytes) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const scene = v.getUint16(0x04, true);
  const stage = v.getUint16(0x06, true);
  const known = scene >= SKL.firstChapterScene && scene <= SKL.firstChapterScene + 3 && stage >= SKL.firstLevelStage && stage <= SKL.firstLevelStage + 3;
  return {
    scene,
    stage,
    level: known ? (scene - SKL.firstChapterScene) * 4 + (stage - SKL.firstLevelStage) : -1,
    score: v.getUint32(0x08, true),
    // `0x40d400` is what the loader hands the lives to, and it clamps
    lives: Math.min(SKL.maxLives, v.getUint16(0x0c, true)),
    weapon: v.getUint16(0x0e, true),
    rounds: v.getUint16(0x10, true),
  };
}
