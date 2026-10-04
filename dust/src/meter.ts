/**
 * The network meter — one rolling window for the WHOLE loading page.
 *
 * Every byte the loader pulls down feeds this: the two fetches the head phase
 * makes itself (the panel and the fallback room) and every chunk the file store
 * streams afterwards. One window rather than one per phase, because a player
 * watching a bar does not care which of the page's code paths is doing the
 * fetching — they want to know whether anything is arriving and how fast.
 *
 * Sampled per CHUNK and read on a TIMER, and both halves of that matter. Measured
 * per completed file, on the arrival that completed it, the first thing the boot
 * fetches divides its whole size by a window that has barely opened: a 13 MB film
 * reported some tens of MB/s the instant it landed, and nothing at all for the
 * minute it spent arriving. On a slow connection that was the entire experience
 * of this loader — a frozen bar under a number that was never true.
 *
 * Timelapse's page keeps its own copy (timelapse/src/meter.ts): a game may not
 * import another game (site/tests/layering.ts), and the day a third page wants
 * one, it moves to `site/`.
 */
export class NetMeter {
  private readonly samples: { t: number; bytes: number }[] = [];
  /** every byte that has come down, window or not */
  total = 0;

  constructor(
    /** how far back the rate looks */
    readonly windowMs = 3000,
    /** the least window worth dividing by; under it there is no number to give */
    readonly settleMs = 900,
  ) {}

  chunk(bytes: number, now: number): void {
    this.samples.push({ t: now, bytes });
    this.total += bytes;
  }

  /** bytes a second over the window, or 0 while there is no rate to give */
  rate(now: number): number {
    while (this.samples.length && now - this.samples[0].t > this.windowMs) this.samples.shift();
    const span = this.samples.length ? now - this.samples[0].t : 0;
    const got = this.samples.reduce((a, x) => a + x.bytes, 0);
    return span >= this.settleMs ? got / (span / 1000) : 0;
  }

  /**
   * "1.4 MB/s · 12.0 MB of 95.0 MB · ~35 s left", or null while nothing is arriving.
   *
   * "12 of 95 MB" rather than "12 MB so far", once there is a total to be a
   * fraction of. The total is what has come down plus what is still owed
   * (`left`), so it grows if the boot asks for something the plan did not name —
   * which is the honest direction for it to move.
   */
  caption(now: number, left: number): string | null {
    const rate = this.rate(now);
    if (!rate) return null;
    const scale = left ? `${fmtSize(this.total)} of ${fmtSize(this.total + left)}` : `${fmtSize(this.total)} so far`;
    const eta = left ? fmtLeft(left / rate) : "";
    const tail = eta ? ` · ${eta}` : "";
    return `${fmtRate(rate)} · ${scale}${tail}`;
  }
}

/** "1.4 MB/s" or "830 KB/s" — whichever reads as a number rather than as noise */
export const fmtRate = (bps: number): string =>
  bps >= 1024 * 1024 ? `${(bps / (1024 * 1024)).toFixed(1)} MB/s` : `${Math.max(1, Math.round(bps / 1024))} KB/s`;

/** "13.1 MB" or "412 KB" — how much has actually come down the wire */
export const fmtSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * "~4 min left", "~35 s left", or nothing at all when the answer is "any moment"
 * or too wild to print.
 *
 * Rounded coarsely on purpose — to five seconds under a minute and a half, to
 * whole minutes above. The rate it divides is a three-second average, so the raw
 * figure jitters between ticks, and a countdown that flickers reads as broken
 * even when every value it shows is true.
 */
export function fmtLeft(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 3) return "";
  if (seconds > 3 * 3600) return ""; // not an estimate, a symptom
  if (seconds < 90) return `~${Math.min(85, Math.max(5, Math.round(seconds / 5) * 5))} s left`;
  return `~${Math.round(seconds / 60)} min left`;
}
