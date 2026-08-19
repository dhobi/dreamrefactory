/**
 * Pull the whole edition through the browser's cache before a run starts.
 *
 * The workbench's problem is not that files are slow to fetch — it is that they
 * are slow to fetch ONCE, and a route is run fifty times. `FileStore` releases a
 * set when you leave the room and caps what it keeps of the 328 MB of movies
 * (src/files.ts), which is right for playing and merciless for timing: the same
 * leg costs a download on the first run and a memory read on the second, so two
 * runs of one sheet are not two readings of one thing. Worse, the first run
 * through a new leg is the one somebody is watching to find out whether the leg
 * WORKS, and a 34 MB set arriving mid-walk looks exactly like a hang.
 *
 * The browser already solves this and is never asked to: a file fetched once is
 * served from the memory or disk cache the next time, whoever asks. So the fix
 * is not a cache of our own — it is to ask for everything, early, and throw the
 * bytes away. What is left behind is the HTTP cache, warm, and every later fetch
 * the game makes hits it (#147).
 *
 * ## Thrown away, not held
 *
 * The English tree is 664 files and 1.2 GB. Nothing here keeps a byte of it: each
 * response is drained through its reader a chunk at a time and dropped, which is
 * what puts it in the disk cache without putting it in this tab's heap. That is
 * also where the progress comes from — bytes actually read off the wire, so the
 * bar tells the truth on a re-warm (everything hits, the rate reads in the
 * hundreds of MB/s, and the run is over in seconds) rather than pretending to
 * download what it already has.
 *
 * ## What the browser will actually keep — measured
 *
 * The whole thing rests on the HTTP cache accepting a gigabyte, so it was worth
 * checking rather than assuming, and both answers came out well:
 *
 *  - **The tree fits.** 664 files and 1.13 GB warmed into a fresh Chromium
 *    profile on a disk with 199 GB free; re-fetched afterwards, all of it came
 *    back from the disk cache — the 37.5 MB `leave.mov` fetched FIRST included,
 *    so nothing was evicted by what followed it.
 *  - **The deployment is cacheable without touching it.** The static host sends
 *    no `Cache-Control` at all, but it does send `Last-Modified: 1996` — so the
 *    heuristic rule (a tenth of the file's age) makes every one of them fresh
 *    for years. Nothing had to be configured for this to work.
 *
 * The one profile where it does NOT hold is a small one. Chromium refuses to
 * store any single entry larger than an eighth of its cache, and in an ephemeral
 * profile with a ~56 MB cache that threshold measured between 6.0 and 8.1 MB —
 * so a private window keeps the small files and re-downloads every set and movie
 * worth caching. That is a property of the browser and not something this can
 * fix; it is written down so the next person measuring a disappointing warmup
 * knows where to look first.
 *
 * It is also why the DEV server is not part of this. Vite's `/gamefiles`
 * middleware sends no validators at all, so nothing it serves is storable —
 * `Cache-Control: no-cache` plus `Last-Modified` was tried and Chromium still
 * did not keep a byte, and the `max-age` that does work would serve a stale
 * `.SET` after an export from the editors. Locally the files come off the disk
 * anyway. The button is for the deployed site.
 *
 * ## What this file is NOT
 *
 * It is not the "load in anticipation" idea in #147 — the graph analysis that
 * would fetch a room's neighbours while you stand in it. That is a real feature
 * for a real player on a real connection, and it needs to know what is one click
 * away. This knows nothing and thinks about nothing: it is a bucket of URLs and
 * a pool of six fetches, for the one case where fetching EVERYTHING is not
 * absurd, because the person at the keyboard is about to use all of it.
 */

/** the fetch this module drives — narrowed so a test can hand it a fake */
type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  body?: { getReader(): { read(): Promise<{ done: boolean; value?: { byteLength: number } }> } } | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** one file to pull, and what the manifest says it weighs */
export interface WarmFile {
  url: string;
  bytes: number;
}

/** what the bar is drawn from — a whole reading, not a delta */
export interface WarmProgress {
  /** files in the job */
  files: number;
  /** files finished, whether they arrived or not */
  done: number;
  /** ...of which these did not */
  failed: number;
  /** bytes read off the wire so far */
  bytes: number;
  /** bytes the manifest expects in total */
  total: number;
  /** bytes per second over the last few seconds, or 0 before it can be told */
  rate: number;
  /** was it cut short */
  stopped: boolean;
}

export interface WarmOptions {
  /**
   * How many fetches are in flight at once. Six because that is the per-origin
   * cap a browser applies to HTTP/1.1 anyway — asking for twenty would not make
   * twenty happen, it would make fourteen of them queue where this code cannot
   * see them, and the "files left" count would stop meaning anything.
   */
  concurrency?: number;
  signal?: AbortSignal;
  /** injectable for the tests, which have neither a network nor a clock */
  fetch?: FetchLike;
  now?: () => number;
  /** how often the reading is published, in ms — a chunk is far too often */
  tickMs?: number;
  onProgress?: (p: WarmProgress) => void;
}

/**
 * Bytes per second as measured over a SLIDING WINDOW rather than over the run.
 *
 * The average since the start is the wrong number and it gets more wrong the
 * longer you watch: it is dominated by whatever the link was doing a minute ago,
 * so it barely moves when the connection drops and it never shows the cliff at
 * the point where the cache stops hitting and the real downloading begins. What
 * somebody staring at a 1.2 GB warmup wants to know is what it is doing NOW —
 * that is what tells them whether to wait or to go and make coffee.
 *
 * Two marks are kept at minimum however old they are, so a stall reports a
 * falling rate rather than dividing by nothing.
 */
export function rateMeter(windowMs = 3000): (at: number, bytes: number) => number {
  const marks: { at: number; bytes: number }[] = [];
  return (at, bytes) => {
    marks.push({ at, bytes });
    while (marks.length > 2 && at - marks[0].at > windowMs) marks.shift();
    const first = marks[0];
    const last = marks[marks.length - 1];
    const dt = last.at - first.at;
    return dt > 0 ? ((last.bytes - first.bytes) * 1000) / dt : 0;
  };
}

/** MB the way the play page's preload bar counts them — 1024-based (src/main.ts) */
const MB = 1024 * 1024;

/** "412 MB", "1.2 GB", "812 kB" — a size to read, not to calculate with */
export function formatBytes(n: number): string {
  if (n >= 1024 * MB) return `${(n / (1024 * MB)).toFixed(2)} GB`;
  if (n >= MB) return `${(n / MB).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} kB`;
}

/**
 * "~12 min left". The number that decides whether somebody waits or walks away.
 *
 * It matters more here than on most bars because the answer is not small: the
 * deployment serves the game at a few hundred kB/s, so 1.13 GB is the better
 * part of an hour. A bar with no estimate on it looks, for the first several
 * minutes, exactly like a bar that is stuck.
 *
 * Rounded coarsely and marked `~` on purpose — it is derived from the sliding
 * rate above, so it moves, and a figure quoted to the second would only be
 * inviting somebody to notice it was wrong.
 */
export function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 90) return `~${Math.max(1, Math.round(seconds))}s left`;
  if (seconds < 3600) return `~${Math.round(seconds / 60)} min left`;
  return `~${(seconds / 3600).toFixed(1)} h left`;
}

/** "4.1 MB/s" or "812 kB/s" — whichever reads as a number rather than as noise */
export function formatRate(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return "—";
  if (bytesPerSecond >= MB) return `${(bytesPerSecond / MB).toFixed(1)} MB/s`;
  return `${Math.round(bytesPerSecond / 1024)} kB/s`;
}

/**
 * The files of one edition, biggest first.
 *
 * `pick` is what decides membership — the caller owns that, because "the English
 * edition" is `editionOfUrl(p) === "en" || p is NEUTRAL` and this module has no
 * business knowing what an edition is.
 *
 * BIGGEST FIRST is not cosmetic. With a pool of six, leaving the 39 MB movies to
 * the end means the last stretch of a 1.2 GB job runs at one-sixth of the
 * parallelism it started with — five idle slots while `leave.mov` finishes alone.
 * Front-loading them fills the pool with small files at the tail instead, where
 * they cost nothing to interleave, and the rate stays flat to the end.
 */
export function warmupList(
  sizes: Record<string, number>,
  pick: (path: string) => boolean,
  toUrl: (path: string) => string,
): WarmFile[] {
  return Object.keys(sizes)
    .filter(pick)
    .map((path) => ({ url: toUrl(path), bytes: sizes[path] }))
    .sort((a, b) => b.bytes - a.bytes || (a.url < b.url ? -1 : 1));
}

/**
 * Read a response to its end and keep none of it.
 *
 * The reader loop is the whole trick: `arrayBuffer()` would allocate the file,
 * and six of those with `deckbd.set` among them is 100 MB of heap for data
 * nothing will ever look at. Chunk in, byte count out, chunk dropped. The
 * `arrayBuffer` branch is for a fetch with no streaming body — a test's fake, or
 * a browser old enough not to have `Response.body` — where the bytes are counted
 * the same way and released just as fast.
 */
async function drain(
  res: Awaited<ReturnType<FetchLike>>,
  count: (n: number) => void,
): Promise<void> {
  const body = res.body;
  if (!body || typeof body.getReader !== "function") {
    count((await res.arrayBuffer()).byteLength);
    return;
  }
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) count(value.byteLength);
  }
}

/**
 * Pull every file in `files`, reporting as it goes, and return the final reading.
 *
 * A FAILURE IS NOT AN END. One 404 in a tree of 664 — a file the manifest names
 * and the deployment forgot to upload — must not abandon the other 663; it is
 * counted and the pool moves on, and the caller says how many missed. The only
 * thing that stops this early is the caller's own `signal`, and that comes back
 * as `stopped` rather than as a throw, because a warmup somebody cancelled did
 * not go wrong.
 */
export async function warmCache(
  files: readonly WarmFile[],
  opts: WarmOptions = {},
): Promise<WarmProgress> {
  const doFetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const now = opts.now ?? (() => performance.now());
  const tickMs = opts.tickMs ?? 120;
  const rate = rateMeter();
  const total = files.reduce((n, f) => n + f.bytes, 0);

  let bytes = 0;
  let done = 0;
  let failed = 0;
  let lastTick = -Infinity;
  let lastRate = 0;

  const stopped = (): boolean => !!opts.signal?.aborted;
  const reading = (): WarmProgress => ({
    files: files.length,
    done,
    failed,
    bytes,
    total,
    rate: lastRate,
    stopped: stopped(),
  });
  /** publish at most every `tickMs`, and always when `force` (a file finished) */
  const tick = (force: boolean): void => {
    const at = now();
    if (!force && at - lastTick < tickMs) return;
    lastTick = at;
    lastRate = rate(at, bytes);
    opts.onProgress?.(reading());
  };

  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (stopped()) return;
      const file = files[next++];
      if (!file) return;
      try {
        const res = await doFetch(file.url, { signal: opts.signal });
        if (!res.ok) throw new Error(String(res.status));
        await drain(res, (n) => {
          bytes += n;
          tick(false);
        });
      } catch {
        // An abort lands here too, and is not a failure — the loop's own
        // `stopped()` check on the next turn is what ends the job.
        if (!stopped()) failed++;
      }
      done++;
      tick(true);
    }
  };

  tick(true);
  await Promise.all(
    Array.from({ length: Math.max(1, opts.concurrency ?? 6) }, () => worker()),
  );
  lastRate = 0; // nothing is moving any more, and a frozen rate reads as one that is
  const end = reading();
  opts.onProgress?.(end);
  return end;
}
