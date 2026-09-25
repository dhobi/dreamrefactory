import type { HostFiles } from "@dreamfactory/engine/web/host";

/**
 * The three RedJack CDs as one {@link HostFiles}.
 *
 * Indexed by lowercase BASENAME across the whole rip, for the reason Timelapse's
 * and Dust's stores are: the scripts ask for `control.stag` and `ship.sett`,
 * never for a path, so the index is flat and every disc is mounted at once.
 *
 * ## The names are DreamFactory 5's
 *
 * Every file on these discs carries a four-letter type as its extension — `.sett`,
 * `.stag`, `.shop`, `.trak`, `.cast`, `.pupp`, `.move`, `.boot` — where v4 wrote
 * three (`.set`, `.stg`, `.shp`…) and the BOOTFILE had none. The scripts use the
 * same long names (`openstagefile("control.stag")`), so nothing is renamed here
 * except the one name the ENGINE asks for itself: it opens its boot as `bootfile`
 * (engine/src/web/host.ts), and on this rip that is `RedJack/bootfile.boot`.
 *
 * ## One collision, and the mounted disc wins
 *
 * Across the three discs the only repeated basename among the game's files is
 * `movies/death.move`, and it is NOT one film three times: each disc's copy is
 * different. The game says which disc it is on: the BOOTFILE's `advanceday`
 * sets `disk` for the day and `resetpaths` writes `"RJDisk2:movies:"` into the
 * path table, which the engine hands on as a disc change ({@link setDisc}). A
 * repeated name is served from that disc, and from the lowest one that has it
 * until the game has said.
 */

/** the name the engine asks for → the name this rip ships it under */
const ALIASES: Record<string, string> = { bootfile: "bootfile.boot" };

/** this page's own URL for a served path, so it runs from any directory */
const url = (path: string): string => new URL(path, document.baseURI).href;

export class RedJackFiles implements HostFiles {
  private urls = new Map<string, string>();
  private cache = new Map<string, Uint8Array>();
  /** one fetch per name however many callers ask at once */
  private inFlight = new Map<string, Promise<{ bytes: Uint8Array | null; streamed: boolean }>>();
  onBackgroundLoad: ((key: string, data: Uint8Array) => void) | null = null;
  /** basename → size in bytes, from the manifest */
  private sizes = new Map<string, number>();
  /** a name more than one disc carries → each disc's copy (1-based) */
  private copies = new Map<string, Map<number, { url: string; size: number }>>();
  private disc = 1;
  /** every name the engine asked for and did not have, in order */
  readonly misses: string[] = [];
  /** every name that arrived, in the order it did */
  readonly loads: string[] = [];
  /** every chunk of every fetch — what the loading bar's meter samples */
  onChunk: ((name: string, bytes: number) => void) | null = null;
  /** fires as the number of fetches in flight changes (the canvas-corner spinner) */
  onBusyChange: ((inFlight: number) => void) | null = null;
  /** how far each in-flight fetch has got */
  private partial = new Map<string, number>();

  /** index the rip from the manifest the dev server and the build both publish */
  static async open(root = "gamefiles/"): Promise<RedJackFiles> {
    const store = new RedJackFiles();
    const res = await fetch(url("gamefiles.json"));
    const manifest: Record<string, number> = res.ok ? await res.json() : {};
    for (const path of Object.keys(manifest).sort()) {
      if (!path.startsWith(root)) continue;
      const base = path.split("/").pop()!.toLowerCase();
      const disc = Number(/\/RJDisk(\d)\//i.exec(path)?.[1] ?? 0);
      const copy = { url: url(path), size: manifest[path] };
      if (store.urls.has(base)) {
        // a second disc's copy: kept, and served when that disc is mounted
        let byDisc = store.copies.get(base);
        if (!byDisc) {
          byDisc = new Map([[store.discOf.get(base) ?? 0, { url: store.urls.get(base)!, size: store.sizes.get(base)! }]]);
          store.copies.set(base, byDisc);
        }
        if (!byDisc.has(disc)) byDisc.set(disc, copy);
        continue;
      }
      // until the game names a disc, the lowest wins: the keys are sorted
      store.urls.set(base, copy.url);
      store.sizes.set(base, copy.size);
      store.discOf.set(base, disc);
    }
    return store;
  }

  /** the key a name is stored under, after the one alias this rip needs */
  private key(name: string): string {
    const k = name.toLowerCase();
    return ALIASES[k] ?? k;
  }

  /** how many names the rip offers — a boot that indexed nothing says so */
  get size(): number {
    return this.urls.size;
  }

  /** what the manifest says this file weighs; 0 for one it does not list */
  sizeOf(name: string): number {
    return this.sizes.get(this.key(name)) ?? 0;
  }

  /** how many bytes of these names are still to come */
  bytesLeft(names: Iterable<string>): number {
    let left = 0;
    for (const name of names) {
      const key = this.key(name);
      if (this.cache.has(key)) continue;
      left += Math.max(0, (this.sizes.get(key) ?? 0) - (this.partial.get(key) ?? 0));
    }
    return left;
  }

  /** the engine's synchronous provider: what is in hand, or null and a fetch started */
  provide = (name: string): Uint8Array | null => {
    const key = this.key(name);
    const have = this.cache.get(key);
    if (have) return have;
    this.misses.push(key);
    if (this.urls.has(key)) void this.load(key);
    return null;
  };

  async load(name: string, onBytes?: (n: number) => void): Promise<Uint8Array | null> {
    const key = this.key(name);
    const have = this.cache.get(key);
    if (have) {
      onBytes?.(have.byteLength);
      return have;
    }
    const src = this.urls.get(key);
    if (!src) return null;
    const started = !this.inFlight.has(key);
    const flight =
      this.inFlight.get(key) ??
      (async () => {
        const res = await fetch(src);
        if (!res.ok) return { bytes: null, streamed: false };
        const bytes = res.body
          ? await this.readStream(key, res.body, onBytes)
          : new Uint8Array(await res.arrayBuffer());
        this.cache.set(key, bytes);
        this.loads.push(key);
        this.onBackgroundLoad?.(key, bytes);
        return { bytes, streamed: res.body !== null };
      })();
    this.inFlight.set(key, flight);
    if (started) this.onBusyChange?.(this.inFlight.size);
    try {
      const { bytes, streamed } = await flight;
      // the owner of a streamed fetch has been told chunk by chunk already
      if (bytes && (!streamed || !started)) onBytes?.(bytes.byteLength);
      return bytes;
    } finally {
      this.partial.delete(key);
      if (this.inFlight.delete(key)) this.onBusyChange?.(this.inFlight.size);
    }
  }

  /** drain a response body, reporting each chunk, then join it into one array */
  private async readStream(
    key: string,
    body: ReadableStream<Uint8Array>,
    onBytes?: (n: number) => void,
  ): Promise<Uint8Array> {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      this.partial.set(key, total);
      this.onChunk?.(key, value.byteLength);
      onBytes?.(value.byteLength);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    return out;
  }

  /** which disc each name was first found on, while the index is built */
  private discOf = new Map<string, number>();

  /**
   * The game is on another disc: every name more than one disc carries is now
   * served from that one, and a copy already fetched from another is dropped.
   */
  setDisc(disc: number): void {
    if (disc === this.disc) return;
    this.disc = disc;
    for (const [name, byDisc] of this.copies) {
      const copy = byDisc.get(disc);
      if (!copy || this.urls.get(name) === copy.url) continue;
      this.urls.set(name, copy.url);
      this.sizes.set(name, copy.size);
      this.cache.delete(name);
    }
  }

  activeDisc(): number {
    return this.disc;
  }

  activeEdition(): string {
    return "redjack";
  }

  has(name: string): boolean {
    return this.cache.has(this.key(name));
  }

  /** the rooms, under v5's own extension */
  serverSetNames(): string[] {
    return [...this.urls.keys()].filter((n) => n.endsWith(".sett"));
  }

  serverUrl(name: string): string | null {
    return this.urls.get(this.key(name)) ?? null;
  }

  /** nothing is evicted: this is a prototype, and what it asked for is data */
  evict(): number {
    return 0;
  }
}
