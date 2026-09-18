/**
 * The eight words, and what each of them actually does.
 *
 * `0x403c1b` calls `0x403ed0` with every LOWERCASE letter the level's key loop
 * sees, before the letter is uppercased and looked up as an action — so a cheat
 * is typed with the same keys that are walking you around, and the two do not
 * interfere. `0x403ed0` is the whole recogniser:
 *
 * ```
 *   403ed0  if (now - [0x46b324] >= 0x28)  [0x46b320] = 0   ; 40 ticks, and it forgets
 *   403ef2  [0x46b324] = now
 *   403f00  [0x4a02c1 + i] = char                           ; a Pascal string
 *   403f0b  [0x4a02c0] = i + 1                              ; ...its length byte
 *   403f17  if (++i >= 0x13)  i = 0                         ; nineteen and it wraps
 *   403f29  eax = i - 3;  if (eax > 7) return               ; only 3…10 are words
 *   403f35  jmp [eax*4 + 0x404140]                          ; ONE candidate per length
 * ```
 *
 * Which is why the words are all different lengths: the table at `0x404140` is
 * indexed by how many characters have been typed since the last pause, and each
 * slot compares the accumulator against exactly one string. Type nine letters
 * and the only word you can possibly have typed is `marsupial`.
 *
 * `0x4087c0` is `ms * 3 / 50`, a sixtieth-of-a-second tick, so the 0x28 is two
 * thirds of a second between letters. And the accumulator is not cleared on a
 * match of the wrong word — it is cleared by the pause, by a successful word,
 * and by the wrap at nineteen.
 */

/** `0x403edb` — how long a gap forgets what you were typing, in milliseconds */
export const CHEAT_GAP_MS = (0x28 * 50) / 3;
/** `0x403f17` — the accumulator is nineteen characters and then it starts again */
export const CHEAT_RING = 0x13;

export interface Cheat {
  /** the word, and its length is its slot in the table at `0x404140` */
  word: string;
  /** where the string lives, remembering that a `push` points one byte before it */
  at: string;
  /** the call the match makes */
  does: string;
  /** what that call means, read at the other end of it */
  say: string;
}

/**
 * The eight, in the order their lengths put them in `0x404140`.
 *
 * Two of them are not what this port had written down. **`jetson` is TIME, not
 * score**: `0x40d350`'s argument is a signed one, positive sets `[0x4a4d68]` and
 * negative adds to it, and `[0x4a4d68]` is the mission clock — the same word
 * every chapter's entry function fills from its book's `timer` record. And
 * **`myxzltplkt` really is a joke**: `0x40411e` makes the comparison and then
 * `0x404136` loads 1 into `ax` whether it matched or not, so the branch that
 * would have done something was never written.
 */
export const CHEATS: readonly Cheat[] = [
  { word: "zip", at: "0x46b438", does: "[0x4ac38a]++, then 0x402760", say: "the next initplayer point in this level" },
  { word: "eshs", at: "0x46b440", does: "0x45ef30(0x78)", say: "120 rounds in the weapon you are holding" },
  { word: "cthia", at: "0x46b460", does: "0x404160 then [0x4abdfe] = 2", say: "asks for a level 1-16 and goes there" },
  { word: "jetson", at: "0x46b430", does: "0x40d350(-850)", say: "850 more on the mission clock" },
  { word: "bewitch", at: "0x46b448", does: "0x40d400(5)", say: "five lives, which is the most 0x40d400 allows" },
  { word: "harakari", at: "0x46b424", does: "0x402ac0(0x1f4)", say: "500 health gone, and it can kill you" },
  { word: "marsupial", at: "0x46b454", does: "0x402b20(0x400)", say: "1024 health back, up to your own maximum" },
  { word: "myxzltplkt", at: "0x46b418", does: "0x404136 mov ax, 1", say: "nothing at all — the joke" },
];

/** the one word of each length, which is the table at `0x404140` */
const BY_LENGTH = new Map(CHEATS.map((c) => [c.word.length, c]));

/**
 * `0x403ed0` — the accumulator, its timeout and its one comparison a keystroke.
 *
 * Feed it every lowercase letter. It answers with the cheat when the letters
 * since the last pause spell one, and null otherwise.
 */
export class CheatTyper {
  private buffer = "";
  private last = -Infinity;

  press(ch: string, nowMs: number): Cheat | null {
    if (ch.length !== 1 || ch < "a" || ch > "z") return null;
    if (nowMs - this.last >= CHEAT_GAP_MS) this.buffer = "";
    this.last = nowMs;
    this.buffer += ch;
    if (this.buffer.length >= CHEAT_RING) this.buffer = "";
    const candidate = BY_LENGTH.get(this.buffer.length);
    if (!candidate || candidate.word !== this.buffer) return null;
    // `0x403faa` and its seven siblings zero the index on a match, which is what
    // stops `zip` from firing again on every letter after it
    this.buffer = "";
    return candidate;
  }

  /** what has been typed since the last pause, for the panel to say */
  get typed(): string {
    return this.buffer;
  }
}
