/**
 * The high-score board, which is on the MENU and not on the death screen.
 *
 *   npx tsx tests/machine/scores.ts        (from skullcracker/)
 *
 * `0x403340` is the state the seven kill vignettes belong to, and what it does
 * after the film is the ending: `0x40d4d0` fetches `[0x4a4f00]`, `0x40f650`
 * offers it to that difficulty's ten rows, and the shell goes back to the title.
 * `0x45de89` then draws the board over `menu.mov` while its frame index is
 * 0…0xa7 — which is the menu page's business, and `menu.ts` in the browser
 * suites looks at it there.
 *
 * So this walks the game's half of the chain: earn a score, spend every life,
 * answer the dialog `0x46bf4d` names, and read the board back out of the store
 * the title screen reads.
 *
 * The board is seeded first, because the interesting half of `0x40f650` is the
 * INSERT — `0x40f6b6` finds the first row whose score is under yours and
 * `0x40f6d6` shifts the rest down — and an empty board cannot show that.
 */
import { BOARD_FROM, boardKey, loadBoards, offerScore, saveBoards } from "../../src/scores";
import { DEATH_FILMS } from "../../src/mission";
import { fail, headless, memoryStorage, ok, pass } from "./harness";

const store = memoryStorage();
/** read through a call: the steps between two reads change it */
const lives = (): number => game.stats.lives;

// 1. seed the medium board. Ten rows of `{ name, score, level }` is what
//    `0x4a4d80` holds; two of them filled is enough to make the shift visible.
const empty = () => Array.from({ length: 10 }, () => ({ name: "", score: 0, level: 0 }));
store.set(
  "skullcracker.scores",
  JSON.stringify({
    "1": empty(),
    "0": [{ name: "BOSS", score: 9000, level: 9 }, { name: "MID", score: 1000, level: 2 }, ...empty().slice(2)],
    "-1": empty(),
  }),
);

// standing on STREETS' scoreup, with the damage switch on so a life can be spent
const h = await headless("level=1&x=1715&y=1071&damage=1");
const { game } = h;

/** the films the game asked for, and what it handed the front door at the end */
const films: string[] = [];
game.ui.film = async (name) => {
  films.push(name);
};
let over: { score: number; level: number; difficulty: number; rank: number } | null = null;
// the page's own `ui.gameOver` (walk.ts), less the navigation: offer the score
// to the board, answer the dialog, write the board back
game.ui.gameOver = (score, level, difficulty) => {
  const boards = loadBoards();
  const rank = offerScore(boards, difficulty, score, level, () => "ACE");
  saveBoards(boards);
  over = { score, level, difficulty, rank };
};

if (h.until(() => game.stats.score === 2000, 30) < 0) fail(`standing on that scoreup should pay 2000; the score is ${game.stats.score}`);
ok(`the level pays ${game.stats.score}, which is what has to reach the board`);

/**
 * Type `harakari` three times — 500 a time out of 1200, the cheat's
 * `0x1f4` off the player's health — and wait for the life to go. The words go through the
 * same recogniser the page feeds its keys to, forty milliseconds a letter.
 */
let clock = 0;
const spendALife = (): void => {
  const lives = game.stats.lives;
  for (let i = 0; i < 3; i++) {
    h.frame(10);
    for (const ch of "harakari") {
      clock += 40;
      const said = game.cheats.press(ch, clock);
      if (said) game.runCheat(said);
    }
  }
  if (h.until(() => game.stats.lives !== lives || over !== null, 200) < 0)
    fail(`three harakari did not cost a life: health ${game.stats.health}, ${game.stats.lives} lives`);
  clock += 5000;
};

// 3. three lives, and the death after the third is the one that ends the game
if (game.stats.lives !== 3) fail(`a level starts with three lives; it has ${game.stats.lives}`);
spendALife();
if (lives() !== 2) fail(`the first death should cost a life; ${lives()} left`);
ok(`harakari three times is one life — ${game.stats.lives} left`);

spendALife();
spendALife();
// ...and three on the panel is FOUR deaths: `0x4294cb` ends the game only once
// `0x40d490()` has gone below zero, so the death that empties the panel is an
// ordinary one and the next is the last
if (lives() !== 0) fail(`three deaths leave an empty panel and a game; it has ${lives()}`);
if (films.length) fail(`an ordinary death plays no film (0x4294fb); these played: ${films.join(", ")}`);
if (over) fail(`the game ended with the panel empty but the count not below zero`);
ok(`three deaths empty the panel and the game goes on, with no film`);
spendALife();

// 4. ...and the last one plays a KILL vignette and hands the score to the board
for (let i = 0; i < 100 && !over; i++) await new Promise((r) => setTimeout(r, 10));
if (!over) fail(`the last life should end the game (0x4294cb, state 9); ${game.stats.lives} lives`);
const end = over as { score: number; level: number; difficulty: number; rank: number };
if (films.length !== 1 || !(DEATH_FILMS as readonly string[]).includes(films[0]))
  fail(`0x4033ca plays one of the seven KILL films; the game asked for ${films.join(", ") || "none"}`);
if (end.score !== 2000 || end.level !== 1) fail(`0x40d4d0 hands over [0x4a4f00] and the level; got ${end.score} on level ${end.level}`);
ok(`and the last of them plays ${films[0]} and hands ${end.score} points on level ${end.level} to the board`);

// 5. the board, as the title screen will read it
const key = boardKey(end.difficulty);
if (BOARD_FROM[key].label !== "Med") fail(`0x46b20c is 0 here, so the lit label is Med; the game played ${BOARD_FROM[key].label}`);
const rows = loadBoards()[key];
const row = (i: number): string => `${rows[i].name} ${rows[i].score} ${rows[i].level}`;
if (row(0) !== "BOSS 9000 9") fail(`9000 keeps the top row; it reads "${row(0)}"`);
if (end.rank !== 1 || row(1) !== "ACE 2000 1") fail(`2000 belongs between 9000 and 1000, on the level it ended in; row 2 reads "${row(1)}"`);
if (row(2) !== "MID 1000 2") fail(`0x40f6d6 shifts the rest down; row 3 reads "${row(2)}"`);
ok(`the board took it — ${BOARD_FROM[key].label}: 1 ${row(0)} · 2 ${row(1)} · 3 ${row(2)}`);

pass(`a finished game writes to the board the title screen reads`);
