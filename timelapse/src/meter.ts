/**
 * The network meter: one rolling window for the whole loading page.
 *
 * Sampled per CHUNK and read on a TIMER, and both halves matter. Measured per
 * completed file instead, `open.mov` reports nothing for as long as it takes to
 * arrive and then one enormous figure at the moment it lands — and on a slow
 * connection that silence is the entire experience of this loader.
 *
 * Dust's page has the same meter over its own 95 MB. Two copies rather than one
 * shared module, for now, because they differ in what they can promise: Dust
 * counts FETCHES against a plan of eight, and this counts BYTES, because two of
 * its thirteen files are three quarters of the download. The day a third page
 * wants one, it moves to `site/`.
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
   * "1.4 MB/s · 12.0 of 70.0 MB · ~35 s left", or null while nothing is arriving.
   *
   * "12 of 70 MB" rather than "12 MB so far", once there is a total to be a
   * fraction of — and the total is what has come down plus what is still owed
   * (`left`), so it GROWS if the game asks for something the list did not name,
   * which is the honest direction for it to move.
   */
  caption(now: number, left: number): string | null {
    const rate = this.rate(now);
    if (!rate) return null;
    const scale = left ? `${fmtSize(this.total)} of ${fmtSize(this.total + left)}` : `${fmtSize(this.total)} so far`;
    const eta = left ? fmtLeft(left / rate) : "";
    return `${fmtRate(rate)} · ${scale}${eta ? ` · ${eta}` : ""}`;
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
