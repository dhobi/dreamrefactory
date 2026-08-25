import type { HostFiles } from "@dreamfactory/engine/web/host";

/**
 * The four Timelapse CDs as one {@link HostFiles} — what lets the real engine
 * try to boot off them.
 *
 * Indexed by lowercase BASENAME across the whole rip, for the reason Dust's
 * store is: the scripts ask for `I001.Stg` and `I.Shp`, never for a path. The
 * game's own `enterworld` does the pathing itself (`path(2, "TimeLapse1:E:")`,
 * `path(3, "TimeLapse1:T:")`) and a browser has no volumes to point those at, so
 * the index is flat and every disc is mounted at once.
 *
 * Collisions are safe here, which is the fact that makes a flat index legal:
 * across the four discs the only repeated basenames are the 27 films in each
 * `T/` plus `credits.mov`, and they are byte-identical copies of one set of
 * transitions — the discs are otherwise disjoint (`E/` `I/` `T/` on 1, `A/` on
 * 2, `M/` on 3, `Z/` on 4). Lowest disc wins so the answer is the same twice.
 *
 * ## The game data that is not in the manifest
 *
 * `tools/manifest.ts` skips any directory called `install`, and on this rip that
 * is where half the game lives: `TLAPSE1/install/data/` holds the BOOTFILE, the
 * six per-world shop files, the five track banks, the shared panel stage and
 * `camera.fil` — 43 MB of data the installer copies to the hard disc rather than
 * playing off the CD.
 *
 * The manifest DOES list them now: the walker takes an `include` list of subtrees
 * under a skipped name and this game's build passes one
 * (`timelapse/vite.config.ts`), which is also what gives the loading bar a size
 * for every file it fetches. The rule being worked around is a good one —
 * Titanic's installer tree is not game data and one of its subtrees ships a rival
 * `bootfile` — so it is worked around by naming one path rather than by relaxing
 * it.
 *
 * {@link INSTALLED} stays as the fallback for a manifest written WITHOUT that
 * list, which `tools/mkmanifest.ts` can still be told to do: the dev middleware
 * and a static deployment both serve anything under `gamefiles/` whether the
 * manifest lists it or not, so knowing the fourteen names is enough to run.
 */

/** where the installed half of the game sits on disc 1 */
const INSTALL_DIR = "gamefiles/TLAPSE1/install/data/";

/**
 * The installed half, by basename. The BOOTFILE first because nothing else can
 * be reached without it: `boot()` and the whole boot library are its containers
 * 1 and 2, and every routine the stages call (`gotostage`, `gotoworld`,
 * `enterworld`, `PlaySound`) is defined there rather than in the engine.
 *
 * ## One letter per world, and it is the same letter everywhere
 *
 * `curworldchar` is the whole naming scheme of this game, and it is one character
 * standing for four things at once:
 *
 *   | letter | disc directory   | shop refName | stages       |
 *   |--------|------------------|--------------|--------------|
 *   | I      | `TLAPSE1/i/`     | `"I"`        | `i001.stg` … |
 *   | E      | `TLAPSE1/e/`     | `"E"`        | `e001.stg` … |
 *   | A      | `TLAPSE2/a/`     | `"A"`        | `a001.stg` … |
 *   | M      | `TLAPSE3/m/`     | `"M"`        | `m001.stg` … |
 *   | Z      | `TLAPSE4/z/`     | `"Z"`        | `z001.stg` … |
 *
 * — which is what makes the boot's own lines read: `path(2, discName @ "1:E:")`
 * mounts the directory, `openshopfile(curworldchar @ ".Shp")` opens the shop,
 * `sendtoshop(curworldchar, …)` addresses it by the bare letter (the shops carry
 * that letter as their stored refName), and `curworldchar @ threezeronum(n) @
 * ".Stg"` builds the stage name.
 *
 * TWO of the seven letters are not worlds. **P** is the shared panel — `p.shp`'s
 * six props and `p.stg` — with no directory, no stages of its own and no track
 * bank, and it is the one shop the boot opens before the world's. **T** is the
 * shared transition films, byte-identical on all four discs, with no shop and no
 * stages (so it is not named here: `T/` is on the discs and the manifest lists
 * it).
 */
const INSTALLED = [
  "bootfile",
  // one shop per world — I(ntro), E(aster Island), A(tlantis), M(aya), Z(the
  // endgame) — plus P, the panel the five of them share
  "a.shp", "e.shp", "i.shp", "m.shp", "p.shp", "z.shp",
  // and one track bank per WORLD, which is why there are five and not six
  "a.trk", "e.trk", "i.trk", "m.trk", "z.trk",
  // the panel's own stage, and the camera the player picks up
  "p.stg", "camera.fil",
];

/** this page's own URL for a served path, so it runs from any directory */
const url = (path: string): string => new URL(path, document.baseURI).href;

export class TimelapseFiles implements HostFiles {
  private urls = new Map<string, string>();
  private cache = new Map<string, Uint8Array>();
  /** one fetch per name however many callers ask at once */
  private inFlight = new Map<string, Promise<{ bytes: Uint8Array | null; streamed: boolean }>>();
  onBackgroundLoad: ((key: string, data: Uint8Array) => void) | null = null;
  /** basename → size in bytes, from the manifest */
  private sizes = new Map<string, number>();
  /** every name the engine asked for and did not have, in order — a failed boot
   *  is only diagnosable if it says what it wanted */
  readonly misses: string[] = [];
  /** every name that arrived, in the order it did */
  readonly loads: string[] = [];
  onFileLoaded: ((name: string, bytes: number) => void) | null = null;
  /**
   * Every CHUNK of every fetch, not every completed file.
   *
   * The difference is the whole loading page on this game. Its boot moves 69.9 MB
   * before the first frame and 27 of that is one file, `open.mov` — so a meter
   * sampled per arrival reports nothing at all for the minute that film is coming
   * down and then one enormous figure at the moment it lands, and a bar that only
   * moves on completion sits still for exactly as long.
   *
   * A hook on the STORE rather than a callback per call, because the fetches worth
   * metering are not all started by the page: the engine misses a file, `provide`
   * starts one, and no caller is there to pass anything.
   */
  onChunk: ((name: string, bytes: number) => void) | null = null;
  /** fires as the number of fetches in flight changes — what the canvas-corner
   *  spinner is driven by, exactly as on the other two pages */
  onBusyChange: ((inFlight: number) => void) | null = null;
  /** how far each in-flight fetch has got, so {@link bytesLeft} can count the
   *  remainder of one that is half here rather than all of it */
  private partial = new Map<string, number>();

  /** index the rip from the manifest the dev server and the build both publish */
  static async open(root = "gamefiles/"): Promise<TimelapseFiles> {
    const store = new TimelapseFiles();
    const res = await fetch(url("gamefiles.json"));
    const manifest: Record<string, number> = res.ok ? await res.json() : {};
    for (const path of Object.keys(manifest).sort()) {
      if (!path.startsWith(root)) continue;
      const base = path.split("/").pop()!.toLowerCase();
      // lowest disc wins: the keys are sorted, so the first one seen is it
      if (store.urls.has(base)) continue;
      store.urls.set(base, url(path));
      store.sizes.set(base, manifest[path]);
    }
    for (const base of INSTALLED) {
      if (!store.urls.has(base)) store.urls.set(base, url(INSTALL_DIR + base));
    }
    return store;
  }

  /** how many names the rip offers — a boot that indexed nothing says so */
  get size(): number {
    return this.urls.size;
  }

  /** what the manifest says this file weighs; 0 for one it does not list */
  sizeOf(name: string): number {
    return this.sizes.get(name.toLowerCase()) ?? 0;
  }

  /**
   * How many bytes of these names are still to come: nothing for one already in
   * hand, and only the unfetched remainder of one in flight.
   *
   * The loading page's estimate of how long is left needs a "how much", and this
   * is the honest form of it — the manifest's own sizes minus what has actually
   * landed, rather than a count of files scaled by an average. A name the manifest
   * does not size contributes nothing, which makes the estimate optimistic rather
   * than invented; on a manifest that lists the installed tree — the normal case,
   * see the note above — there is no such name.
   */
  bytesLeft(names: Iterable<string>): number {
    let left = 0;
    for (const name of names) {
      const key = name.toLowerCase();
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
   * started, exactly as Dust's store does it.
   */
  provide = (name: string): Uint8Array | null => {
    const key = name.toLowerCase();
    const have = this.cache.get(key);
    if (have) return have;
    this.misses.push(key);
    if (this.urls.has(key)) void this.load(key);
    return null;
  };

  async load(name: string, onBytes?: (n: number) => void): Promise<Uint8Array | null> {
    const key = name.toLowerCase();
    const have = this.cache.get(key);
    if (have) {
      onBytes?.(have.byteLength);
      return have;
    }
    const url = this.urls.get(key);
    if (!url) return null;
    const started = !this.inFlight.has(key);
    const flight =
      this.inFlight.get(key) ??
      (async () => {
        const res = await fetch(url);
        if (!res.ok) return { bytes: null, streamed: false };
        // Read as it ARRIVES where the browser gives a body to read, which is
        // what `HostFiles.load` has always promised and what the other two stores
        // do. This one buffered the whole body and reported it once, so a page
        // built on it could only ever draw a bar that moved thirteen times — and
        // two of those thirteen files are three quarters of the download.
        const bytes = res.body
          ? await this.readStream(key, res.body, onBytes)
          : new Uint8Array(await res.arrayBuffer());
        this.cache.set(key, bytes);
        this.loads.push(key);
        this.onFileLoaded?.(key, bytes.byteLength);
        this.onBackgroundLoad?.(key, bytes);
        return { bytes, streamed: res.body !== null };
      })();
    this.inFlight.set(key, flight);
    if (started) this.onBusyChange?.(this.inFlight.size);
    try {
      const { bytes, streamed } = await flight;
      // the owner of a streamed fetch has been told chunk by chunk already;
      // everyone else — a joiner, or a response with no body — gets the one total
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

  /**
   * Nothing to swap. `setDisc` is how a two-CD DreamFactory game follows its
   * BOOTFILE's `setpath(disk)`; Timelapse has four discs and switches between
   * them with `path(n, …)` inside its own `enterworld`, which this store cannot
   * see and does not need to — every disc is indexed at once.
   */
  setDisc(): void {}

  activeEdition(): string {
    return "timelapse";
  }

  has(name: string): boolean {
    return this.cache.has(name.toLowerCase());
  }

  /**
   * NONE, and that is the finding rather than a gap in this file: there is not a
   * single `.SET` on any of the four discs. Titanic's rooms and Dust's are SETs —
   * turn rings, roads, a camera — and Timelapse's are STG flats reached by
   * `gotostage(stage, region, frame)`, with the navigation graph written out as a
   * script table (`getframeaction`) in each stage's own container 1.
   *
   * Answering none used to mean no screen at all, because the compositor was a
   * room's. It is the `ScreenDirector`'s now, so this game composites, plays films
   * and fades with no room layer ever attached — which is what made this page a
   * game rather than a file report.
   */
  serverSetNames(): string[] {
    return [];
  }

  serverUrl(name: string): string | null {
    return this.urls.get(name.toLowerCase()) ?? null;
  }

  /** nothing is evicted: this is an experiment, and what it asked for is data */
  evict(): number {
    return 0;
  }
}
