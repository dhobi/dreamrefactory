/**
 * The cache warmer (taoot/src/cache-warmup.ts).
 *
 * Everything worth asserting about a 1.2 GB download is a thing you cannot see
 * by running it: whether it holds the bytes, whether one missing file takes the
 * other 663 with it, whether Stop stops. So the fetch is a fake here and the
 * clock is a variable, and what is tested is the behaviour around the network
 * rather than the network.
 */
import { describe, expect, test } from "vitest";
import {
  formatBytes,
  formatEta,
  formatRate,
  rateMeter,
  warmCache,
  warmupList,
  type WarmFile,
} from "../../src/cache-warmup";

/**
 * A fetch that hands back `chunks` slices of a file and records what happened.
 *
 * `live`/`peak` are how the concurrency claim is checked: a pool of six means at
 * most six bodies open at once, and the only way to see that is to count them
 * while they are open.
 */
function fakeNet(opts: { chunks?: number; fails?: (url: string) => boolean } = {}) {
  const net = {
    asked: [] as string[],
    live: 0,
    peak: 0,
    /** how many times a whole body was materialised rather than streamed */
    buffered: 0,
  };
  const chunks = opts.chunks ?? 4;
  const fetch = async (url: string, init?: { signal?: AbortSignal }) => {
    net.asked.push(url);
    if (opts.fails?.(url)) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    net.live++;
    net.peak = Math.max(net.peak, net.live);
    const size = Number(/#(\d+)$/.exec(url)?.[1] ?? 400);
    let sent = 0;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => {
        net.buffered++;
        net.live--;
        return new ArrayBuffer(size);
      },
      body: {
        getReader: () => ({
          read: async () => {
            // a turn of the microtask queue per chunk, so the pool really overlaps
            await Promise.resolve();
            if (init?.signal?.aborted) throw new Error("aborted");
            if (sent >= chunks) {
              net.live--;
              return { done: true };
            }
            sent++;
            return { done: false, value: { byteLength: size / chunks } };
          },
        }),
      },
    };
  };
  return { net, fetch: fetch as never };
}

/** n files of `size` bytes each, named so the fake knows how big they are */
const spread = (n: number, size = 400): WarmFile[] =>
  Array.from({ length: n }, (_, i) => ({ url: `f${i}#${size}`, bytes: size }));

/** a clock that only moves when it is asked to, so no test waits on anything */
function handClock(): { now: () => number; tick: (ms: number) => void } {
  let at = 0;
  return { now: () => at, tick: (ms) => void (at += ms) };
}

describe("warming the cache", () => {
  test("it reads every file, and counts the bytes it actually read", async () => {
    const { net, fetch } = fakeNet();
    const end = await warmCache(spread(10), { fetch, now: handClock().now });
    expect(net.asked.length).toBe(10);
    expect(end.done).toBe(10);
    expect(end.failed).toBe(0);
    expect(end.bytes).toBe(4000);
    expect(end.total).toBe(4000);
  });

  /**
   * The point of the whole module: the bytes are counted through a reader and
   * dropped, never materialised. `arrayBuffer()` is the fallback for a response
   * with no body, and a response WITH one must never reach it — six copies of a
   * 34 MB set is the heap this exists to avoid.
   */
  test("it streams and discards rather than buffering", async () => {
    const { net, fetch } = fakeNet();
    await warmCache(spread(5), { fetch, now: handClock().now });
    expect(net.buffered).toBe(0);
  });

  test("a body-less response is still counted", async () => {
    const noBody = async (url: string) => ({
      ok: true,
      status: 200,
      body: null,
      arrayBuffer: async () => new ArrayBuffer(Number(/#(\d+)$/.exec(url)?.[1] ?? 0)),
    });
    const end = await warmCache(spread(3), { fetch: noBody as never, now: handClock().now });
    expect(end.bytes).toBe(1200);
  });

  test("no more fetches are open at once than it was told to open", async () => {
    const { net, fetch } = fakeNet({ chunks: 6 });
    await warmCache(spread(20), { fetch, concurrency: 4, now: handClock().now });
    expect(net.peak).toBe(4);
    expect(net.peak).toBeLessThanOrEqual(4);
  });

  /**
   * One file the deployment forgot to upload is one file, not the end of the
   * job. The manifest is regenerated on the host after the data is copied there
   * (tools/mkmanifest.ts), so a listing that names a file nobody uploaded is a
   * real state and not a hypothetical one.
   */
  test("a 404 costs one file and nothing else", async () => {
    const { net, fetch } = fakeNet({ fails: (u) => u === "f3#400" || u === "f7#400" });
    const end = await warmCache(spread(10), { fetch, now: handClock().now });
    expect(net.asked.length).toBe(10);
    expect(end.done).toBe(10);
    expect(end.failed).toBe(2);
    expect(end.bytes).toBe(3200);
  });

  test("Stop stops, and is not an error", async () => {
    const { net, fetch } = fakeNet({ chunks: 40 });
    const stop = new AbortController();
    const clock = handClock();
    const end = await warmCache(spread(50), {
      fetch,
      concurrency: 2,
      now: clock.now,
      onProgress: (p) => {
        if (p.bytes > 200) stop.abort();
      },
      signal: stop.signal,
    });
    expect(end.stopped).toBe(true);
    expect(end.failed).toBe(0); // an abort is not a failed file
    expect(net.asked.length).toBeLessThan(50);
  });

  /** the reading a bar is drawn from, at least once before and once after */
  test("it reports before it starts and after it ends", async () => {
    const { fetch } = fakeNet();
    const seen: number[] = [];
    const end = await warmCache(spread(4), {
      fetch,
      now: handClock().now,
      onProgress: (p) => seen.push(p.bytes),
    });
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(end.bytes);
    // the last reading is a standstill, not the speed it was going when it ended
    expect(end.rate).toBe(0);
  });
});

describe("the speed readout", () => {
  /**
   * The number people actually want is "what is it doing now", and the average
   * since the start cannot say — it is still reporting the first minute halfway
   * through the second. This is the case that separates them: fast, then idle.
   */
  test("it forgets a burst once the window has passed", () => {
    const rate = rateMeter(3000);
    rate(0, 0);
    expect(rate(1000, 10_000_000)).toBeCloseTo(10_000_000, -3); // 10 MB in 1 s
    // ...and then the link dies. Four seconds later the burst is out of the
    // window and the reading has to be near zero, not near 10 MB/s.
    rate(4000, 10_000_000);
    expect(rate(5000, 10_000_000)).toBe(0);
  });

  test("a stall divides by the time, not by nothing", () => {
    const rate = rateMeter(3000);
    rate(0, 0);
    expect(rate(0, 0)).toBe(0); // two marks, no time between them
    expect(rate(2000, 2_000_000)).toBe(1_000_000);
  });

  /**
   * The deployment serves a few hundred kB/s, so the honest reading of a cold
   * warmup is most of an hour — which is precisely why the estimate is there
   * and why it is coarse. A bar with no figure on it is indistinguishable from
   * a stuck one for the first ten minutes.
   */
  test("the estimate is coarse, and says nothing when it knows nothing", () => {
    expect(formatEta(45)).toBe("~45s left");
    expect(formatEta(600)).toBe("~10 min left");
    expect(formatEta(3300)).toBe("~55 min left");
    expect(formatEta(7200)).toBe("~2.0 h left");
    expect(formatEta(0)).toBe("");
    expect(formatEta(Infinity)).toBe("");
  });

  test("sizes and rates read as numbers a person can use", () => {
    expect(formatBytes(1_270_000_000)).toBe("1.18 GB");
    expect(formatBytes(34 * 1024 * 1024)).toBe("34.0 MB");
    expect(formatBytes(512 * 1024)).toBe("512 kB");
    expect(formatRate(4.5 * 1024 * 1024)).toBe("4.5 MB/s");
    expect(formatRate(800 * 1024)).toBe("800 kB/s");
    expect(formatRate(0)).toBe("—");
  });
});

describe("choosing what to warm", () => {
  const sizes = {
    "gamefiles/en/titanic1/movies/leave.mov": 39_000_000,
    "gamefiles/en/titanic1/data/bedsit1.set": 172_032,
    "gamefiles/de/titanic1/data/bedsit1.set": 172_032,
    "lang.stg": 6_000_000,
  };

  test("it takes what it is told to take, and turns it into a URL", () => {
    const list = warmupList(
      sizes,
      (p) => !p.startsWith("gamefiles/de/"),
      (p) => `../${p}`,
    );
    expect(list.map((f) => f.url)).toEqual([
      "../gamefiles/en/titanic1/movies/leave.mov",
      "../lang.stg",
      "../gamefiles/en/titanic1/data/bedsit1.set",
    ]);
  });

  /**
   * Biggest first, so the pool is never down to one 39 MB movie and five idle
   * slots — see the comment on `warmupList`. Ties fall back to the path so the
   * order is the same on every run and a stopped-and-restarted warmup covers
   * the same ground in the same sequence.
   */
  test("biggest first, then by name", () => {
    const list = warmupList({ b: 10, a: 10, c: 99 }, () => true, (p) => p);
    expect(list.map((f) => f.url)).toEqual(["c", "a", "b"]);
  });
});
