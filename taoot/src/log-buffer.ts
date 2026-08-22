/**
 * The lines behind X, bounded.
 *
 * The pane used to BE the storage: main.ts appended to a `<pre>`'s textContent
 * and the bug reporter read the tail back off the DOM, so nothing capped it and
 * a long session grew a string without end. This holds the lines instead, drops
 * the oldest when it has too many, and tells the caller whether the pane can be
 * appended to or has to be repainted — the DOM stays main.ts's business.
 */

/** what a {@link LogBuffer.push} did, so the caller knows how to draw it */
export interface LogWrite {
  /** true when older lines went and the whole pane has to be redrawn */
  repaint: boolean;
}

export class LogBuffer {
  readonly lines: string[] = [];

  /**
   * How many lines have been discarded since the buffer was last cleared, so a
   * reader that has seen the first N can still tell where it got to. The browser
   * gate's ENGINELOG follows the pane by counting lines and would otherwise skip
   * a whole batch the first time one is dropped (taoot/tests/browser/playthrough.ts).
   */
  dropped = 0;

  /**
   * @param kept  lines held before the oldest start going
   * @param dropAt  how many go at once when the cap is reached. Dropping ONE per
   *   new line would repaint the pane on every line for the rest of the session;
   *   a batch makes that once per batch, and every line in between is a cheap
   *   append.
   */
  constructor(
    readonly kept = 5000,
    readonly dropAt = Math.max(1, Math.floor(kept / 10)),
  ) {}

  push(line: string): LogWrite {
    this.lines.push(line);
    if (this.lines.length <= this.kept) return { repaint: false };
    this.lines.splice(0, this.dropAt);
    this.dropped += this.dropAt;
    return { repaint: true };
  }

  clear(): void {
    this.lines.length = 0;
    this.dropped = 0;
  }

  /** the last `n` lines, oldest first — what a bug report carries */
  tail(n: number): string[] {
    return this.lines.slice(-n);
  }

  /** the whole pane as text, for a repaint or for the clipboard */
  text(): string {
    return this.lines.length ? this.lines.join("\n") + "\n" : "";
  }
}

/**
 * The page's cap.
 *
 * A whole game does not need it: the headless playthrough carried from the cold
 * boot to the credits emits 1141 lines / 40 923 bytes (36 bytes a line), so this
 * is not a budget for playing the game — it is a ceiling for a session that never
 * ends. The lines that arrive without bound are the ones tied to gestures rather
 * than to progress: `movie click (264,357) frame 0 -> type 6` is one per click
 * inside an interactive movie, and a player can sit in the purser's window
 * clicking all afternoon.
 *
 * 5000 is ~4.4 full playthroughs and ~180 kB, so in every real game nothing a bug
 * report might want has been thrown away.
 */
export const LOG_LINES_KEPT = 5000;
