/**
 * Read a Skull Cracker saved game.
 *
 *   npx tsx skullcracker/tools/skl.mts SAVE2.SKL
 *
 * The container is twenty-two bytes with no header, no magic and no checksum —
 * `0x45e2ea` hands `CreateFileA` the path the common dialog returned and
 * `0x45e317` writes one `WriteFile` of 0x16 bytes over it. The Macintosh type
 * and creator the call carries, `'SSAV'` and `'SKLC'`, are arguments to the
 * portability layer and reach the disc only on a Mac; on Windows `0x41dc60`
 * drops them.
 *
 * Nothing about the file says what it is, so there is nothing to validate. The
 * only field that could have been a version stamp — the `0x00010000` at the
 * front — is written by `0x45e246` and read by nobody: the loader at `0x45dfec`
 * reads all twenty-two bytes and then starts at offset four.
 *
 * WHAT IS IN IT is the interesting part, because it is seven numbers and the
 * game rebuilds everything else:
 *
 * ```
 *   +0x00  u32  0x00010000    written, never read
 *   +0x04  u16  [0x4abdfe]    the shell scene  -> the chapter
 *   +0x06  u16  [0x4abdfc]    the stage within it -> the level
 *   +0x08  u32  [0x4a4f00]    the score
 *   +0x0c  u16  [0x4a4d64]    lives, clamped to 5 on the way back in
 *   +0x0e  u16  [0x479434]    the weapon, or 1 for none
 *   +0x10  u16  [0x4a7f16 + weapon*12]   its rounds
 *   +0x12  u32  0             written, never read
 * ```
 *
 * The scene is the game's own outer state machine — `0x403059` dispatches on it
 * through the table at `0x403448`, where 1 is the title, 3..6 are the four
 * chapters and 11 is quit — and the stage is the chapter runner's own counter.
 * Each runner dispatches the stage through a table of its own (`0x44da38`,
 * `0x436c9c`, `0x41f5fc`, `0x4129c8`), and in every one of the four, stages two
 * through five are the chapter's four levels in order. So the level is
 * `(scene - 3) * 4 + (stage - 2)`, and nothing else in the file names it.
 *
 * WHAT IS NOT IN IT says more. There is no character, no difficulty, no
 * position, no health, no clock and no kill count. A loaded game re-enters the
 * chapter runner at the saved stage and the level starts from its own record's
 * point, with the character and difficulty the title screen still holds. The
 * save is a bookmark, not a snapshot.
 *
 * The one thing it does carry across is the gun. `0x44da80` and its three
 * siblings zero all twenty-one rounds counts on entering a chapter — but only
 * while `[0x47913c]` is 0, and `0x45e069` sets it to 1 on a load. So the weapon
 * and its rounds survive, and `0x479438`, the ARMED flag, does not: a loaded
 * game has the gun in the inventory and not in your hands.
 */
import { readFileSync } from "node:fs";

/** `0x403448` — the shell's eleven scenes, of which four are chapters */
const CHAPTERS = [3, 4, 5, 6];

/** one-based, the order the chapter runners walk their stages in */
const LEVELS = [
  "streets", "city", "woods", "playgr",
  "mall", "service", "sewer", "arcade",
  "grave", "cavern", "ravecave", "tower",
  "maze", "barrel", "lab", "vat",
];

/**
 * `0x479434`'s values, from the four per-chapter entry functions and the
 * pickups that write it — 1 is the sentinel `0x45e039` reads as "none".
 */
const WEAPONS: Record<number, string> = {
  1: "none",
  6: "blaster",
  9: "flaregun",
  0xa: "flamer",
  0xc: "soaker",
  0x10: "statblaster",
};

const path = process.argv[2];
if (!path) {
  console.error("usage: npx tsx skullcracker/tools/skl.mts <file.skl>");
  process.exit(2);
}

const b = readFileSync(path);
if (b.length !== 0x16) {
  console.error(`${path} is ${b.length} bytes; a saved game is 22`);
  process.exit(1);
}

const stamp = b.readUInt32LE(0x00);
const scene = b.readUInt16LE(0x04);
const stage = b.readUInt16LE(0x06);
const score = b.readUInt32LE(0x08);
const lives = b.readUInt16LE(0x0c);
const weapon = b.readUInt16LE(0x0e);
const rounds = b.readUInt16LE(0x10);
const tail = b.readUInt32LE(0x12);

const level = CHAPTERS.includes(scene) && stage >= 2 && stage <= 5 ? (scene - 3) * 4 + (stage - 2) : null;

console.log(`${path}`);
console.log(`  stamp    0x${stamp.toString(16).padStart(8, "0")}${stamp === 0x10000 ? "" : "   (not the 0x00010000 0x45e246 writes)"}`);
console.log(`  scene    ${scene}   ${CHAPTERS.includes(scene) ? `chapter ${scene - 2} of four` : "not a chapter"}`);
console.log(`  stage    ${stage}`);
console.log(`  level    ${level === null ? "— the stage is not one of the four" : `${level + 1}  ${LEVELS[level]}`}`);
console.log(`  score    ${score}`);
console.log(`  lives    ${lives}${lives > 5 ? "   (0x40d400 clamps it to 5)" : ""}`);
console.log(`  weapon   ${weapon}  ${WEAPONS[weapon] ?? "unknown"}${weapon === 1 ? "" : `, ${rounds} rounds — in the inventory, not in your hands`}`);
console.log(`  tail     ${tail}${tail === 0 ? "" : "   (0x45e2bd writes zero)"}`);
