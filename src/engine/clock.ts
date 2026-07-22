/**
 * Game time. TI.EXE runs scripts against timeGetTime with 1 script tick =
 * 1/60 s (delay(n) waits n×50/3 ms) and services ambient loops/crickets on
 * a 66 ms (~15 Hz) heartbeat. The viewer feeds real/virtual time into
 * advance(); delay() suspends scripts on sleep().
 */
export class Clock {
  now = 0;
  private waiters: { at: number; resolve: () => void }[] = [];

  sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ at: this.now + ms, resolve }));
  }

  advance(now: number): void {
    if (now <= this.now) return;
    this.now = now;
    if (!this.waiters.length) return;
    const due = this.waiters.filter((w) => w.at <= now);
    this.waiters = this.waiters.filter((w) => w.at > now);
    for (const w of due) w.resolve();
  }
}
