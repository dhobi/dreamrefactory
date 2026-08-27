/**
 * The Skull Cracker CD as one flat, basename-keyed store.
 *
 * The same shape Dust's and Timelapse's stores have — index the manifest by
 * lowercase basename, fetch on demand, remember what arrived and what was asked
 * for and missed — and for the same reason: nothing in this game names a path.
 * A film's `event` field is a bare `chp01.Mov`, so the index has to answer for
 * a name and not for a place.
 *
 * ## Two releases, and the paths are the only thing that differs
 *
 * Both Skull Cracker discs index the same way, which is the point of keying on
 * basename: the Macintosh one is `SKULL/{Data,Movies,Install Folder}` and the
 * Windows one `SKULL/{DATA,MOVIES,INSTALL}`, holding the same 65 films under the
 * same names in different case. Nothing here needs to know which is mounted, and
 * `engine/src/df/byte-order.ts` sees to it that nothing below here does either.
 *
 * One difference is worth knowing about even though it costs nothing: the Windows
 * disc keeps its installed half in `INSTALL/BIN/` (`SC.EXE`, the 584 KB engine,
 * and `SKULL.SCO`), and the manifest walker skips any directory called `install`.
 * So that pair is not indexed — and neither is needed, because the Windows disc
 * carries its menu in `MOVIES/`. The Macintosh disc's installed half is called
 * `Install Folder`, which is not the skipped name, so it IS indexed; that is what
 * the next section is about.
 *
 * ## Three basenames appear twice on the Macintosh disc, and one of them matters
 *
 * That disc has a `SKULL/Install Folder/` — the folder the game's own read-me
 * tells you to drag to the hard disc — beside the `Movies/` and `Data/` the CD
 * plays from. Three names are in both:
 *
 *   | name           | Data / Movies       | Install Folder/Local | same bytes? |
 *   |----------------|---------------------|----------------------|-------------|
 *   | `player.sbk`   | 1996-06-11          | 1996-06-11           | yes         |
 *   | `skuldemo.dmo` | 1996-04-18          | 1996-04-18           | yes         |
 *   | `menu.mov`     | 1996-05-01, 174 fr  | 1996-06-06, 175 fr   | **no**      |
 *
 * Two are byte-identical and the third is not: the installed `menu.mov` is a
 * month newer and one frame longer, and it is the one the shipped game runs. So
 * {@link INSTALLED_WINS} names it and the index prefers that copy — an
 * alphabetical tie-break would have taken the CD's older menu, which loads and
 * plays and is quietly the wrong film.
 *
 * The Windows disc settled that from outside: it ships ONE `MENU.MOV`, and it is
 * the 356-container, 175-frame revision — the installed one. Picking that copy was
 * right, and the other release is the witness.
 *
 * ## What is NOT here
 *
 * No `setDisc` and no editions: one disc, one language, one tree. And no
 * `serverSetNames` — this game has no `.SET`, no `.STG` and no BOOTFILE at all
 * (skullcracker/vite.config.ts says what that means for the page). The store is
 * a film library, which is all the page needs it to be.
 */

/** this page's own URL for a served path, so it runs from any directory */
const url = (path: string): string => new URL(path, document.baseURI).href;

/**
 * Basenames where the INSTALLED copy is the real one, not the CD's.
 *
 * One entry, and it earns its file: see the table above. Anything not named here
 * takes the first path the sorted manifest offers, which for two identical
 * copies is a choice with no consequence.
 */
const INSTALLED_WINS = new Set(["menu.mov"]);

/** the directory that wins for those names */
const INSTALLED_DIR = "/install folder/";

export class SkullFiles {
  /** lowercase basename -> URL */
  private urls = new Map<string, string>();
  /** lowercase basename -> bytes, once fetched */
  private cache = new Map<string, Uint8Array>();
  /** one fetch per name however many callers ask at once */
  private inFlight = new Map<string, Promise<Uint8Array | null>>();
  /** basename -> size in bytes, from the manifest */
  private sizes = new Map<string, number>();
  /** every name asked for and not had, in order — a failed boot is only
   *  diagnosable if it says what it wanted */
  readonly misses: string[] = [];
  /** every name that arrived, in the order it did */
  readonly loads: string[] = [];
  /** each CHUNK of each fetch, so a loading bar can move inside one big film */
  onChunk: ((name: string, bytes: number) => void) | null = null;
  /** fires as the number of fetches in flight changes — the spinner's signal */
  onBusyChange: ((inFlight: number) => void) | null = null;

  /** index the rip from the manifest the dev server and the build both publish */
  static async open(root = "gamefiles/"): Promise<SkullFiles> {
    const store = new SkullFiles();
    const res = await fetch(url("gamefiles.json"));
    const manifest: Record<string, number> = res.ok ? await res.json() : {};
    for (const path of Object.keys(manifest).sort()) {
      if (!path.startsWith(root)) continue;
      const base = path.split("/").pop()!.toLowerCase();
      const installed = path.toLowerCase().includes(INSTALLED_DIR);
      // first path wins, EXCEPT where the installed copy is the right one and
      // this is it (see INSTALLED_WINS)
      if (store.urls.has(base) && !(installed && INSTALLED_WINS.has(base))) continue;
      store.urls.set(base, url(path));
      store.sizes.set(base, manifest[path]);
    }
    return store;
  }

  /** how many names the rip offers — a boot that indexed nothing says so */
  get size(): number {
    return this.urls.size;
  }

  /** every film in the rip, lowercase, sorted — what the page's picker offers */
  movies(): string[] {
    return [...this.urls.keys()].filter((n) => n.endsWith(".mov")).sort();
  }

  /** what the manifest says this file weighs; 0 for one it does not list */
  sizeOf(name: string): number {
    return this.sizes.get(name.toLowerCase()) ?? 0;
  }

  has(name: string): boolean {
    return this.cache.has(name.toLowerCase());
  }

  /** is this name in the rip at all — asked before choosing between two films */
  serves(name: string): boolean {
    return this.urls.has(name.toLowerCase());
  }

  /** what is in hand, or null — the synchronous ask, for a caller mid-frame */
  provide(name: string): Uint8Array | null {
    const key = name.toLowerCase();
    const have = this.cache.get(key);
    if (have) return have;
    this.misses.push(key);
    return null;
  }

  async load(name: string): Promise<Uint8Array | null> {
    const key = name.toLowerCase();
    const have = this.cache.get(key);
    if (have) return have;
    const at = this.urls.get(key);
    if (!at) {
      this.misses.push(key);
      return null;
    }
    const started = !this.inFlight.has(key);
    const flight =
      this.inFlight.get(key) ??
      (async () => {
        const res = await fetch(at);
        if (!res.ok) return null;
        // read as it arrives where the browser gives a body to read: one film is
        // up to 27 MB, and a bar that only moves on completion does not move
        const bytes = res.body
          ? await this.readStream(key, res.body)
          : new Uint8Array(await res.arrayBuffer());
        this.cache.set(key, bytes);
        this.loads.push(key);
        return bytes;
      })();
    this.inFlight.set(key, flight);
    if (started) this.onBusyChange?.(this.inFlight.size);
    try {
      return await flight;
    } finally {
      if (this.inFlight.delete(key)) this.onBusyChange?.(this.inFlight.size);
    }
  }

  /** drain a response body, reporting each chunk, then join it into one array */
  private async readStream(key: string, body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      this.onChunk?.(key, value.byteLength);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    return out;
  }
}
