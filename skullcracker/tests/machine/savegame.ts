/**
 * The saved game: what the pause panel's Save writes, and what the menu's Open
 * brings back.
 *
 *   npx tsx tests/machine/savegame.ts        (from skullcracker/)
 *
 * Twenty-two bytes, no header and no checksum — see `src/savegame.ts`.
 * `0x45e1e0` writes it (`0x45e30f`, one call of `0x16` bytes) out of what the
 * level is holding, and `0x45df8d` reads it back (`0x45dfec`, the same `0x16`)
 * into the four numbers a loaded game carries. The panel's buttons and the file
 * dialogs are the page's (`pause.ts` in the browser suites); this is the half
 * that is the game's: the bytes agree with the state they were made of, and a
 * file read back stands the game up holding exactly what it says.
 */
import { LEVEL_ORDER } from "@dreamfactory/engine/df/sbk";
import { SKL, readSkl, writeSkl } from "../../src/savegame";
import { fail, headless, ok, pass } from "./harness";

const h = await headless("level=2");
const { game } = h;
h.frame(5);

// ---- Save: the bytes are the level's own state -----------------------------
// the same five numbers `walk.ts`'s saveGame hands the writer
const bytes = writeSkl({
  level: game.levelIndex,
  score: game.stats.score,
  lives: game.stats.lives,
  weapon: game.inv.weapon,
  rounds: game.inv.rounds[game.inv.weapon] ?? 0,
});
if (bytes.length !== SKL.bytes) fail(`0x45e30f writes ${SKL.bytes} bytes in one call; this file is ${bytes.length}`);
const save = readSkl(bytes);
if (!save) fail(`the file just written does not read back`);
// CITY is the second level, which is chapter one's stage 3 and nothing else
if (save.scene !== 3 || save.stage !== 3 || save.level !== 1)
  fail(`CITY is scene 3 stage 3 by 0x44da38's own table; the file says scene ${save.scene} stage ${save.stage}`);
if (save.score !== game.stats.score) fail(`the score is [0x4a4f00] at +8; the game has ${game.stats.score} and the file ${save.score}`);
if (save.lives !== game.stats.lives) fail(`the lives are [0x4a4d64] at +0xc; the game has ${game.stats.lives} and the file ${save.lives}`);
// chapter one's entry function names the flamer and gives it nothing
if (save.weapon !== 0xa) fail(`0x44dac0 makes chapter one's weapon 0xa; the file says ${save.weapon}`);
ok(
  `Save writes ${bytes.length} bytes — scene ${save.scene}, stage ${save.stage} (${LEVEL_ORDER[save.level]}), ` +
    `${save.score} points, ${save.lives} lives, weapon ${save.weapon}`,
);

// ---- Open: a file of the writer's making, read and played ------------------
// so the writer and the reader are held to the same twenty-two bytes
const made = readSkl(writeSkl({ level: 9, score: 24680, lives: 2, weapon: 0xc, rounds: 17 }));
if (!made) fail(`a file of the writer's own making does not read`);
// level 9 of sixteen, counted from zero, is chapter three's second: scene 5,
// stage 3, which 0x41f5fc's own table calls CAVERN
if (made.scene !== 5 || made.stage !== 3 || LEVEL_ORDER[made.level] !== "cavern")
  fail(`level 9 is cavern, scene 5 stage 3; the reader says scene ${made.scene} stage ${made.stage} (${LEVEL_ORDER[made.level]})`);
if (made.score !== 24680 || made.lives !== 2 || made.weapon !== 0xc || made.rounds !== 17)
  fail(`the reader lost a number: ${JSON.stringify(made)}`);
ok(`Open reads it back — ${LEVEL_ORDER[made.level]} (scene ${made.scene}, stage ${made.stage}), ${made.score} points, ${made.lives} lives`);

// ...and `0x40d400` clamps the lives to five on the way in
const greedy = readSkl(writeSkl({ level: 0, score: 0, lives: 9, weapon: 1, rounds: 0 }));
if (greedy?.lives !== SKL.maxLives) fail(`0x40d400 clamps a loaded game's lives to five; nine read as ${greedy?.lives}`);
if (readSkl(new Uint8Array(21)) !== null) fail(`a file that is not twenty-two bytes is not a saved game`);
ok(`...clamping nine lives to ${greedy.lives}, and refusing a file of the wrong length`);

// the menu hands the four numbers on in the level's query (main.ts's begin),
// and the chapter's own inventory reset is exempt on a load (`0x45e068`)
await h.load(
  `level=${made.level + 1}&score=${made.score}&lives=${made.lives}&weapon=${made.weapon}&rounds=${made.rounds}`,
);
const { stats, inv } = game;
if (game.levelIndex !== 9 || game.level?.name !== "cavern") fail(`the load stood up level ${game.levelIndex + 1} ${game.level?.name}`);
if (stats.score !== 24680 || stats.lives !== 2) fail(`the load carries ${stats.score} points and ${stats.lives} lives`);
// `0x45e041` arms the player whenever the saved weapon is not 1 (none)
if (inv.weapon !== 0xc || !inv.armed || (inv.rounds[0xc] ?? 0) !== 17)
  fail(`the load should hold weapon 0xc, armed, 17 rounds; it holds ${inv.weapon} ${inv.armed ? "armed" : "holstered"} ${inv.rounds[inv.weapon]}`);
ok(`and the game it opens is holding it: ${game.level.name}, ${stats.score} points, ${stats.lives} lives, weapon ${inv.weapon} armed with ${inv.rounds[0xc]}`);

pass(`Save and Open agree on twenty-two bytes, and on the game they stand for`);
