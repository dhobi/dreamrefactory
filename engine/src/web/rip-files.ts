import type { HostFiles } from "./host";

/**
 * A rip indexed by lowercase BASENAME, fetched on demand and kept — the
 * {@link HostFiles} a one-game page boots its engine off.
 *
 * The scripts ask for `I001.Stg` and `new.flt`, never for a path, so a store
 * like this is a flat map from basename to URL, filled by its game's own
 * `open` from the manifest the dev server and the build both publish. Which copy
 * of a repeated basename wins, and what the manifest does not list, is the
 * game's to say (dust/src/files.ts, timelapse/src/files.ts); what is here is
 * what every such store does once it has its index: hand the engine what is in
 * hand, fetch the rest one flight per name however many ask, and report the
 * fetch as it streams.
 *
 * A name repeated across discs may be served from whichever disc the game is on
 * (redjack/src/files.ts): the store follows by re-pointing {@link urls}, and a
 * flight is therefore tied to the address it is reading, not just its name.
 *
 * Nothing is evicted. A boot touches a few of a disc, and a store that drops
 * bytes it might want again trades a real diagnostic ("what did it ask for?")
 * for memory it is not short of.
 */
export abstract class RipFiles implements HostFiles {
  /** basename → where to fetch it */
  protected readonly urls = new Map<string, string>();
  /** basename → size in bytes, from the manifest */
  protected readonly sizes = new Map<string, number>();
  protected readonly cache = new Map<string, Uint8Array>();
  /**
   * The fetch in progress per name, the address it is reading, and whether it
   * is REPORTING ITS CHUNKS to the caller that started it. A second caller for
   * the same file joins the flight but is not the one the stream reports to, so
   * it still owes itself the single total report a buffered fetch always made.
   * A caller after a different address for the name (another disc's copy) is
   * not a joiner: it starts its own download.
   */
  protected readonly inFlight = new Map<
    string,
    { src: string; flight: Promise<{ bytes: Uint8Array | null; streamed: boolean }> }
  >();
  /** how far each in-flight fetch has got, so {@link bytesLeft} can count the
   *  remainder of one that is half here rather than all of it */
  protected readonly partial = new Map<string, number>();
  onBackgroundLoad: ((key: string, data: Uint8Array) => void) | null = null;
  /** every name the engine asked for and did not have, in order — the boot's own
   *  account of what it wanted, which is what makes a failed boot diagnosable */
  readonly misses: string[] = [];
  /** every name that arrived, in the order it did */
  readonly loads: string[] = [];
  onFileLoaded: ((name: string, bytes: number) => void) | null = null;
  /**
   * Every CHUNK of every fetch, as it lands — what a transfer rate has to be
   * measured from.
   *
   * {@link onFileLoaded} fires once, when a file is done, so a meter sampled per
   * arrival reports nothing at all for the minute a big film is coming down and
   * then one enormous figure at the moment it lands, and a bar that only moves on
   * completion sits still for exactly as long. Per chunk, both are honest.
   *
   * A hook on the STORE rather than a callback per call, because the fetches
   * worth metering are not all started by the page: the engine misses a file,
   * `provide` starts a fetch, and no caller is there to pass one.
   */
  onChunk: ((name: string, bytes: number) => void) | null = null;
  /** fires as the number of fetches in flight changes — the play page's
   *  `FileStore` has the same hook, and the same canvas-corner spinner on it */
  onBusyChange: ((inFlight: number) => void) | null = null;

  /**
   * The game is on another disc. Nothing to do for a store whose every disc is
   * indexed at once with no copy that differs between them, which is all but
   * RedJack's: a rip with per-disc copies of a name overrides this.
   */
  setDisc(_disc: number): void {
    // every disc is indexed already
  }

  abstract activeEdition(): string;
  abstract serverSetNames(): string[];

  /** how many names the rip offers — a boot that indexed nothing says so */
  get size(): number {
    return this.urls.size;
  }

  /** the key a name is stored under: its lowercase basename, unless a rip aliases it */
  protected key(name: string): string {
    return name.toLowerCase();
  }

  /** what the manifest says this file weighs, or 0 for one it does not list */
  sizeOf(name: string): number {
    return this.sizes.get(this.key(name)) ?? 0;
  }

  /**
   * How many bytes of these names are still to come: nothing for one already in
   * hand, and only the unfetched remainder of one in flight.
   *
   * The loading page's estimate of how long is left needs a "how much", and this
   * is the honest form of it — the manifest's sizes minus what has actually
   * landed, rather than a count of files scaled by an average. A name the
   * manifest does not size contributes nothing, which makes the estimate
   * optimistic rather than invented.
   */
  bytesLeft(names: Iterable<string>): number {
    let left = 0;
    for (const name of names) {
      const key = this.key(name);
      if (this.cache.has(key)) continue;
      left += Math.max(0, (this.sizes.get(key) ?? 0) - (this.partial.get(key) ?? 0));
    }
    return left;
  }

  /**
   * The engine's synchronous provider: what is in hand, or null.
   *
   * Null is not a failure. The engine asks synchronously, misses, and the host's
   * `ensureFile` fetches and asks again — so a miss is recorded and a fetch
   * started, exactly as `FileStore.provide` does it.
   */
  provide = (name: string): Uint8Array | null => {
    const key = this.key(name);
    const have = this.cache.get(key);
    if (have) return have;
    this.misses.push(key);
    if (this.urls.has(key)) this.fetchUnasked(key);
    return null;
  };

  /** start the fetch of a name the engine missed and nobody is awaiting */
  protected fetchUnasked(key: string): void {
    void this.load(key);
  }

  /**
   * Called synchronously as a flight is created, before its fetch is issued;
   * what it returns is called when the flight ends, however it ends. The wire
   * reporting a store may add (Dust's, for the load remover) hangs here.
   */
  protected flightBegins(_key: string, _url: string): () => void {
    return () => {};
  }

  /** called once a flight is out of {@link inFlight}, before the busy count is said */
  protected flightOver(_key: string): void {
    // nothing to clear unless a subclass reports flights
  }

  async load(name: string, onBytes?: (n: number) => void): Promise<Uint8Array | null> {
    const key = this.key(name);
    const have = this.cache.get(key);
    if (have) {
      onBytes?.(have.byteLength);
      return have;
    }
    const src = this.urls.get(key);
    if (!src) return null;
    // one fetch per name however many callers ask at once, which a boot does:
    // a preload fetches the plan while the scripts are already asking
    const running = this.inFlight.get(key);
    const started = running?.src !== src;
    const flight = !started && running ? running.flight : this.fly(key, src, onBytes);
    if (started) {
      const was = this.inFlight.size;
      this.inFlight.set(key, { src, flight });
      if (this.inFlight.size !== was) this.onBusyChange?.(this.inFlight.size);
    }
    try {
      const { bytes, streamed } = await flight;
      // The owner of a streamed fetch has been told chunk by chunk already.
      // Everyone else — a joiner, or the fallback path where the response had no
      // body to read — still gets the one total.
      if (bytes && (!streamed || !started)) onBytes?.(bytes.byteLength);
      return bytes;
    } finally {
      // only this download's own entry: a newer one for another disc's copy
      // may have taken the name since
      if (this.inFlight.get(key)?.flight === flight) {
        this.partial.delete(key);
        this.inFlight.delete(key);
        this.flightOver(key);
        this.onBusyChange?.(this.inFlight.size);
      }
    }
  }

  /** one download of `src` for `key`, from issue to the bytes kept (or not) */
  private async fly(
    key: string,
    src: string,
    onBytes?: (n: number) => void,
  ): Promise<{ bytes: Uint8Array | null; streamed: boolean }> {
    // synchronously, before the first `await`: whatever watches the wire
    // hears "busy" in the same turn the fetch was issued in
    const ended = this.flightBegins(key, src);
    try {
      const res = await fetch(src);
      if (!res.ok) return { bytes: null, streamed: false };
      // STREAMED, which is what `HostFiles.load` has always promised ("where
      // the source streams, reports each chunk") and what taoot/src/files.ts
      // does. A store that buffers the whole body and reports it once can only
      // ever draw a bar that moves once per file.
      let got = 0;
      const bytes = res.body
        ? await readStream(res.body, (n) => {
            got += n;
            // the bar counts the copy the game will get, not one a disc
            // change orphaned
            if (this.urls.get(key) === src) this.partial.set(key, got);
            this.onChunk?.(key, n);
            onBytes?.(n);
          })
        : new Uint8Array(await res.arrayBuffer());
      // a disc change while this was arriving made it the wrong copy:
      // hand it to whoever asked for it, but do not keep it
      if (this.urls.get(key) === src) {
        this.partial.delete(key);
        this.cache.set(key, bytes);
        this.loads.push(key);
        this.onFileLoaded?.(key, bytes.byteLength);
        this.onBackgroundLoad?.(key, bytes);
      }
      return { bytes, streamed: res.body !== null };
    } finally {
      // in a `finally`, so a fetch that THREW still closes its span
      ended();
    }
  }

  has(name: string): boolean {
    return this.cache.has(this.key(name));
  }

  serverUrl(name: string): string | null {
    return this.urls.get(this.key(name)) ?? null;
  }

  /** nothing is evicted — see the class comment */
  evict(): number {
    return 0;
  }
}

export interface ManifestOptions {
  /** a fetch that fails outright (offline, blocked) or a body that is not JSON reads as no manifest too, rather than throwing */
  quiet?: boolean;
  /** for a page that cannot run without one: what to throw, given the status, instead of reading nothing */
  orThrow?: (status: number) => Error;
}

/**
 * The manifest the dev server and the build both publish, read from `src`:
 * every served path → its size in bytes. Nothing at all where it could not be
 * read, so a page that indexed nothing can say so instead of throwing. Which
 * paths to take and which copy of a repeated name wins is each game's `open`.
 */
export async function readManifest(src: string, opts: ManifestOptions = {}): Promise<Record<string, number>> {
  try {
    const res = await fetch(src);
    if (!res.ok && opts.orThrow) throw opts.orThrow(res.status);
    return res.ok ? ((await res.json()) as Record<string, number>) : {};
  } catch (e) {
    if (opts.quiet) return {};
    throw e;
  }
}

/** the name a manifest path is indexed under: its basename, lowercased */
export function ripName(path: string): string {
  return path.split("/").pop()!.toLowerCase();
}

/**
 * Drain a response body, reporting each chunk as it lands, then join it into
 * one array — the streamed read every store here makes, so a bar can move inside
 * one big film rather than once per file.
 */
export async function readStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (n: number) => void,
): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    onChunk(value.byteLength);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
