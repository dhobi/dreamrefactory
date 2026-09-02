/**
 * The load remover: how long the page has spent waiting on the network
 * ([#251](https://github.com/dhobi/dreamrefactory/issues/251)).
 *
 * A speedrun timer is supposed to measure a route, and a route run in a browser
 * spends part of its wall time downloading the game. That part is not the
 * route's: the same sheet, on the same build, over a warm cache against a cold
 * one, is minutes apart with not one gesture changed. PC speedruns have long
 * since answered this with a **load remover** — the timer reads a value the game
 * sets while it loads and stops counting for as long as it is set — and this
 * port has the same value to read, because every byte the game gets comes
 * through one place ({@link FileStore}) and that place already says when it is
 * waiting.
 *
 * So this is a stopwatch that runs when the wire is busy and nothing else. Two
 * numbers come out of it and they are different questions:
 *
 *   - {@link LoadClock.ms} — the total, monotonic and never reset. A timer takes
 *     the DIFFERENCE between two readings, exactly as it does with the wall
 *     clock, so nothing has to be armed before a run or cleared after one.
 *   - {@link LoadClock.waiting} — whether the wire is busy at this instant, which
 *     is what a paused readout says on its face.
 *
 * The total includes the fetch still in the air, and it has to: a reading taken
 * mid-download that counted only finished fetches would say the run had spent
 * nothing on a 37 MB film that has been arriving for ten seconds, so the clock
 * would tick right through it and then jump backwards when it landed.
 *
 * ## Where it is wired, and where it is read
 *
 * `main.ts` owns the store, so `main.ts` subscribes {@link loadClock} to it and
 * hands the total out on `window.dbg` — which is how the Playwright driver, in
 * another process entirely, reads a number measured in the page
 * (taoot/tests/speedrun/driver.ts). The in-page workbench imports the same
 * singleton directly (taoot/src/speedrun-page.ts).
 *
 * ## What it does NOT try to be
 *
 * It removes NETWORK time, not decode time, not the frame the engine spends
 * compositing a room it has just been handed. Those are the port's own cost and
 * a machine that runs them faster deserves the faster time; the wire is the one
 * part of the wall clock that says nothing about either the route or the
 * computer running it.
 */

/**
 * A stopwatch fed by the in-flight count — {@link FileStore.onBusy}'s shape.
 *
 * `now` is a constructor argument so a test can advance time by hand rather than
 * sleeping: what needs pinning is the arithmetic across overlapping fetches, and
 * that is unobservable in a test that has to wait for real milliseconds to pass.
 */
export class LoadClock {
  private settled = 0;
  /** when the wire went busy, or null while it is quiet */
  private since: number | null = null;

  constructor(private readonly now: () => number) {}

  /**
   * The wire's in-flight count changed.
   *
   * Only the edges matter — busy to quiet, quiet to busy. Six fetches in the air
   * are one wait, not six: they overlap, the game is blocked until the last of
   * them lands, and adding their durations up would remove more time than the
   * run actually spent.
   */
  busy(inFlight: number): void {
    if (inFlight > 0) {
      if (this.since === null) this.since = this.now();
      return;
    }
    if (this.since === null) return;
    this.settled += this.now() - this.since;
    this.since = null;
  }

  /** ms the page has spent on the network, the fetch in the air included */
  get ms(): number {
    return this.since === null ? this.settled : this.settled + (this.now() - this.since);
  }

  /** is the game waiting on the network right this instant? */
  get waiting(): boolean {
    return this.since !== null;
  }
}

/**
 * The page's one load clock.
 *
 * A singleton because there is one wire and one game per document: the workbench
 * and the play page are the same `main.ts` with the same store, and two clocks
 * that had each seen half the fetches would each remove half the loading.
 */
export const loadClock = new LoadClock(() => performance.now());
