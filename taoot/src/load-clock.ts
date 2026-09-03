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
 * ## Only the NETWORK, not every fetch ([#369](https://github.com/dhobi/dreamrefactory/issues/369))
 *
 * The first version of this stopwatch ran whenever a fetch was in the air, and
 * that removes time the run really did spend. A file already in the browser's
 * memory or disk cache is not a download: it is a read, of the kind the original
 * did off a CD every time it opened a room, and the original's clock counted
 * those. Removing them would credit a route for work the game has to do
 * wherever it runs — and it made the workbench's times unaccountably faster than
 * the runner's, which is what #369 reported.
 *
 * So a fetch only stops the clock if the browser says it went to the network.
 * The browser will say ({@link LoadClockPorts.served}, Resource Timing's
 * `deliveryType`/`transferSize`), and where it will not, {@link CACHE_GRACE_MS}
 * decides on duration: nothing served out of RAM or off a local disk takes that
 * long, and no round trip is quicker.
 *
 * ## And only the fetches the game is STOPPED for
 *
 * The other half of #369, and the half that matters on the deployed page, where
 * the rip really does come over a link. `FileStore.load` is awaited by whoever
 * called it — a set activation blocks on the room and all of its siblings and
 * casts before anything is composited — so the game is stopped for the whole of
 * it and the clock should be too. `FileStore.provide` is the opposite: the
 * engine asked, was told "not yet", and carried on, and the file is wired into
 * the running viewer if and when it lands. The run is progressing throughout, so
 * removing that time credits a route for playing the game.
 *
 * `main.ts` does the filtering, because "who is waiting" is the store's fact
 * ({@link WireEvent.waited}) and not this stopwatch's. What is left here is the
 * question of whether a wait was a DOWNLOAD.
 *
 * Where the two rules disagree with each other, the tiebreak is to COUNT the
 * time: under-removing makes a route look slower than it was, which is a number
 * nobody can be misled by, while over-removing invents a record. Every choice
 * above is that way round.
 *
 * ## Two consequences worth stating, because both look like a bug from the outside:
 * over a warm cache almost NOTHING is removed, and against a dev server on
 * loopback nothing is removed AT ALL — a `localhost` fetch is a disk read
 * wearing HTTP, and its duration is a fact about the reader's disk rather than
 * about any link. So on a dev server the load-removed time is the wall clock,
 * which is exactly what it should be: there was no network to take out. The
 * remover earns its keep on the deployed page, where the rip really does arrive
 * over a link, and over a warm cache besides — see the Warm button
 * (taoot/src/cache-warmup.ts).
 *
 * ## Two numbers come out of it, and they are different questions:
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
 * Which is awkward beside the rule above, since whether a fetch went to the
 * network is only known once it has finished. {@link CACHE_GRACE_MS} is how the
 * two live together: a fetch is treated as a download once it has been open
 * longer than any cache could take, and the whole of its span is credited when
 * it closes. The only cost is that the clock pauses a beat late, and a cache hit
 * never pauses it at all.
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

/** one fetch's span on the wire */
export interface Span {
  from: number;
  to: number;
}

/**
 * How much of a set of spans is covered, counting overlap once.
 *
 * A changeset has a dozen files in the air together: the game is blocked until
 * the last of them lands, so the wait is the stretch the wire was busy and not
 * the sum of the twelve. Adding them up would remove more time than the run
 * spent, which is the one arithmetic error this whole module has to avoid.
 *
 * Exported because it is the part worth testing on its own — the rest of the
 * class is bookkeeping around it.
 */
export function unionMs(spans: readonly Span[]): number {
  if (!spans.length) return 0;
  const sorted = [...spans].sort((a, b) => a.from - b.from);
  let total = 0;
  let { from, to } = sorted[0];
  for (const s of sorted.slice(1)) {
    if (s.from > to) {
      total += to - from;
      from = s.from;
      to = s.to;
    } else if (s.to > to) {
      to = s.to;
    }
  }
  return total + (to - from);
}

/**
 * How long a fetch may take before it counts as a download (#369).
 *
 * Fifty milliseconds, and both halves of that matter. Nothing served out of the
 * browser's memory cache or off a local disk takes anywhere near it — measured
 * on this game's own files, a warm hit is one to three milliseconds, and the
 * 19.6 MB cast off a warm disk cache is tens — while no network round trip is
 * quicker, LAN included.
 *
 * It is a fallback and a floor at the same time. A fallback, for the fetches the
 * browser will not classify ({@link LoadClockPorts.served} answering null: a
 * dropped Resource Timing entry, an older engine). A floor, because the
 * classification only arrives once the fetch has finished, so nothing may pause
 * the clock before this — which is what stops a warm changeset of a dozen cache
 * hits from stopping it at all.
 */
export const CACHE_GRACE_MS = 50;

/**
 * Where a fetch's bytes came from, as far as the page can tell.
 *
 * Only `network` stops the clock. The other two are this machine doing what the
 * original did off a CD, and the original's clock counted that:
 *
 *   - `cache` — the browser's own memory or disk cache.
 *   - `local` — a server on THIS machine (`localhost`, `127.0.0.1`, `[::1]`).
 *     A dev-server fetch is a disk read wearing HTTP: the bytes never touch a
 *     link, and how long they take is a fact about the reader's disk. Counting
 *     it would have made a route's time depend on the machine it was tuned on,
 *     which is the very thing a load remover is for.
 */
export type Served = "network" | "cache" | "local";

/** what the clock has to ask the page */
export interface LoadClockPorts {
  /** ms, monotonic — the wall clock this measures against */
  now(): number;
  /**
   * Where a fetch of `url` came from, or null if the page cannot tell.
   *
   * Asked once, at the moment the fetch ends, and answered by {@link servedBy}:
   * the origin says `local` outright, and Resource Timing says `cache` — either
   * as `deliveryType`, or as a zero `transferSize` against a body that has a
   * size. Null is a real answer — the entry may have been dropped, or the
   * browser may be too old for the field — and {@link CACHE_GRACE_MS} covers it.
   */
  served(url: string): Served | null;
}

/**
 * A stopwatch that runs while the game is waiting on the NETWORK.
 *
 * Fed one fetch at a time ({@link begin} / {@link end}) rather than a count,
 * because the verdict is per fetch: six cache hits and one download in the air
 * together must remove the download's span and nothing else.
 *
 * Every port is injected so a test can move the clock by hand and answer the
 * verdict itself. What needs pinning is arithmetic over overlapping intervals,
 * and that is unobservable in a test that has to wait for real milliseconds.
 */
export class LoadClock {
  /** network time in periods that have closed */
  private settled = 0;
  /**
   * The highest reading ever given out.
   *
   * A ratchet, and deliberately. Every reader of this clock SUBTRACTS two
   * readings (the page's stopwatch, the runner at both ends of every action),
   * and `time + load = wall clock` is the property that makes the removal
   * checkable at all. A total that could go down would break both — a leg would
   * come out longer than the wall clock it happened in. So a period that turns
   * out to have been all cache keeps whatever it had already shown, which is at
   * most a few ms above the grace and never grows.
   */
  private shown = 0;
  /** fetches in the air, by the id the store gave them */
  private live = new Map<number, { url: string; from: number }>();
  /** the current busy period: when the wire went busy, and the network spans in it */
  private period: { from: number; spans: Span[] } | null = null;

  constructor(private readonly ports: LoadClockPorts) {}

  /** a fetch has been issued */
  begin(id: number, url: string): void {
    const at = this.ports.now();
    if (!this.period) this.period = { from: at, spans: [] };
    this.live.set(id, { url, from: at });
  }

  /**
   * ...and has finished, one way or another.
   *
   * The verdict is taken here, where the fetch's duration is known and the
   * browser's own entry for it is as fresh as it will ever be. A fetch nobody
   * announced (an id this never saw) is ignored rather than guessed at.
   */
  end(id: number): void {
    const f = this.live.get(id);
    if (!f) return;
    this.live.delete(id);
    const at = this.ports.now();
    const how = this.ports.served(f.url) ?? (at - f.from >= CACHE_GRACE_MS ? "network" : "cache");
    // ONLY `network`. A cache hit and a read off this machine are both what the
    // original did off its CD, and its clock counted them (#369).
    if (how === "network" && this.period) this.period.spans.push({ from: f.from, to: at });
    if (this.live.size === 0 && this.period) {
      this.settled += unionMs(this.period.spans);
      this.period = null;
    }
  }

  /**
   * ms the game has spent on the network — the download in the air included,
   * once it has been open longer than a cache could possibly take.
   */
  get ms(): number {
    const open = this.period
      ? Math.max(0, this.ports.now() - this.period.from - CACHE_GRACE_MS)
      : 0;
    this.shown = Math.max(this.shown, this.settled + open);
    return this.shown;
  }

  /**
   * Is the game waiting on a download right now?
   *
   * What the workbench's stopwatch says LOADING from, so it answers the same
   * question the reading does: a fetch that has not yet outlived the grace is
   * not (yet) a download, and a cache hit never becomes one.
   */
  get waiting(): boolean {
    return this.period !== null && this.ports.now() - this.period.from >= CACHE_GRACE_MS;
  }
}

/**
 * The page's one load clock.
 *
 * A singleton because there is one wire and one game per document: the workbench
 * and the play page are the same `main.ts` with the same store, and two clocks
 * that had each seen half the fetches would each remove half the loading.
 */
export const loadClock = new LoadClock({
  now: () => performance.now(),
  served: (url) => servedBy(url),
});

/** a host that is this machine — see the `local` verdict */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", ""]);

/**
 * Where a fetch's bytes came from (#369).
 *
 * Two questions, in the order that settles them fastest.
 *
 * **Whose machine.** A dev server on loopback is a disk read wearing HTTP, and
 * the browser has no way to say so — Resource Timing reports the full transfer,
 * because as far as it is concerned bytes crossed a socket. Measured on this
 * project's own server: a reload transfers `bedsit1.set`'s 217 KB again, in
 * 80-150 ms, with `deliveryType: ""` and a full `transferSize`, because Vite
 * serves `gamefiles/` with no caching headers. Removing that would make a
 * route's time a fact about the reader's disk, and it is why the whole of #369
 * was reported: the workbench's times came out unaccountably faster than the
 * runner's on the same route.
 *
 * **Whose cache.** For anything off the machine, Resource Timing carries the
 * answer in two spellings, because the tidy one is newer than some browsers:
 * `deliveryType === "cache"` says it outright, and where that is missing, a zero
 * `transferSize` against a body that has a size is the long-standing way to read
 * a cache hit.
 *
 * Entries are matched by absolute URL — the store registers paths
 * (`/gamefiles/…`) and Resource Timing names them in full — and the most recent
 * one wins, since a basename can be fetched again after a reload.
 *
 * Null when there is no entry, which is not an error: the buffer is finite, and
 * a browser that has dropped one is a browser {@link CACHE_GRACE_MS} answers
 * for. Nothing here throws — a load remover is not worth a failed fetch.
 */
export function servedBy(url: string): Served | null {
  try {
    const full = new URL(url, location.href);
    if (LOOPBACK.has(full.hostname)) return "local";
    const entries = performance.getEntriesByName(full.href, "resource") as PerformanceResourceTiming[];
    const e = entries[entries.length - 1];
    if (!e) return null;
    const delivery = (e as PerformanceResourceTiming & { deliveryType?: string }).deliveryType;
    if (delivery === "cache") return "cache";
    if (e.transferSize === 0 && e.decodedBodySize > 0) return "cache";
    return "network";
  } catch {
    return null;
  }
}
