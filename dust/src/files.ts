import type { HostFiles } from "@dreamfactory/engine/web/host";
import { siteUrl } from "@dreamfactory/site/site";

/**
 * The Dust CD as a {@link HostFiles} — what lets the real engine boot off it.
 *
 * `GameHost` reaches its data through this interface and nothing else, so a game
 * on a different disc, laid out differently, needs a different implementation of
 * it and no changes above. That is the whole reason this file is short: the play
 * page's `FileStore` carries six editions, two CDs, per-disc basename collisions
 * and an LRU for 37 MB cutscenes, none of which Dust has. One volume, one
 * edition, one copy of every name.
 *
 * ## Two things it has to get right
 *
 * **The BOOTFILE is not in DATA.** It ships at `INSTALL/ALT31/BOOTFILE`, next to
 * the installer's own copy of the engine, and the game's scripts ask for it as
 * plain `bootfile` — so the index is by lowercase BASENAME across the whole disc
 * rather than by directory. Where a basename appears twice (the mini-games each
 * ship their own `CHECKERS.PRP` and so on), {@link PREFERRED} decides, and DATA
 * wins because that is the directory `boot()` sets as its search path.
 *
 * **`serverSetNames` names the boot's movie host.** `GameHost.coldBoot` asks for
 * a room to draw into on the no-landing-room path — Dust's boot opens no room of
 * its own (its `advanceday` lives in `new.flt`) but it DOES play the intro films,
 * and a film needs a viewer to draw through. This answered "none" for as long as
 * a v1 set could not be opened; it can now (`parseInto` -> `readSetFileAsV4`),
 * and the intros were invisible for exactly as long as this still said no.
 */

/** where a basename is looked for first when the disc carries it twice */
const PREFERRED = ["/data/", "/movies/", "/puppets/", "/install/"];

/**
 * Files the manifest will not list, registered by the path they are at.
 *
 * `tools/manifest.ts` skips any directory called `install` — Titanic's installer
 * tree is not game data, and `sneak/` ships a rival `bootfile` that would boot
 * instead of the game. Both reasons are good and neither is about Dust, whose
 * BOOTFILE genuinely lives at `INSTALL/ALT31/BOOTFILE` alongside the installer's
 * own copy of `DF.EXE`. So it is named here rather than by relaxing a rule that
 * exists to stop the wrong game booting.
 *
 * The dev middleware and a static deployment both serve paths under
 * `gamefiles/` whether the manifest lists them or not, so naming it is enough.
 */
const OFF_MANIFEST: Record<string, string> = {
  bootfile: "gamefiles/dustcd/INSTALL/ALT31/BOOTFILE",
};

const rank = (url: string): number => {
  const at = PREFERRED.findIndex((d) => url.toLowerCase().includes(d));
  return at < 0 ? PREFERRED.length : at;
};

export class DustFiles implements HostFiles {
  private urls = new Map<string, string>();
  private cache = new Map<string, Uint8Array>();
  /**
   * The fetch in progress per name, and whether it is REPORTING ITS CHUNKS to
   * the caller that started it. A second caller for the same file joins the
   * flight but is not the one the stream reports to, so it still owes itself the
   * single total report the old buffering path always made.
   */
  private inFlight = new Map<string, Promise<{ bytes: Uint8Array | null; streamed: boolean }>>();
  onBackgroundLoad: ((key: string, data: Uint8Array) => void) | null = null;
  /** every name the engine asked for and did not have, in order — the boot's own
   *  account of what it wanted, which is what makes a failed boot diagnosable */
  readonly misses: string[] = [];
  /**
   * Every name that actually ARRIVED, in the order it did, and a hook that fires
   * as each one does.
   *
   * The counterpart to {@link misses}, and the page's progress bar is what it is
   * for. A boot's real unit of work is a fetch — Dust's is 14 of them, of which
   * eight are named up front by its own BOOTFILE (unilib.snd, gang.cst,
   * extra.cst, house.prp, inven.prp, intro.mov, intro2.mov, new.flt) — so
   * counting them is the one progress reading on this page that is a count of
   * something rather than a guess at how long something takes.
   *
   * Recorded here rather than by wrapping `load`, because `onBackgroundLoad`
   * already belongs to `GameHost` (it feeds resources to the running session)
   * and a second owner of that one hook would be a race between two features.
   */
  readonly loads: string[] = [];
  onFileLoaded: ((name: string, bytes: number) => void) | null = null;
  /**
   * Every CHUNK of every fetch, as it lands — what a transfer rate has to be
   * measured from.
   *
   * {@link onFileLoaded} fires once, when a file is done, which is the wrong
   * event for both things the loading page wants to say. A rate computed from it
   * divides a whole file by however long the page has been watching, so the
   * intro films (13 MB of the boot's 14 fetches) report one enormous figure at
   * the moment they land and nothing at all for the minute before; and a bar
   * that only moves on completion sits still for that same minute. Per chunk,
   * both are honest.
   *
   * A hook on the STORE rather than a callback per call, because the fetches
   * worth metering are not all started by the page: the engine misses a file,
   * `provide` starts a fetch, and no caller is there to pass one.
   */
  onChunk: ((name: string, bytes: number) => void) | null = null;
  /** basename → size in bytes, from the manifest — see {@link sizeOf} */
  private sizes = new Map<string, number>();
  /** how far each in-flight fetch has got, for {@link partialProgress} */
  private partial = new Map<string, number>();
  /** fires as the number of in-flight fetches changes — the play page's
   *  `FileStore` has the same hook, and the same canvas-corner spinner on it */
  onBusyChange: ((inFlight: number) => void) | null = null;
  /**
   * Every path the manifest listed, verbatim — not just the disc's.
   *
   * The disc index below is keyed by BASENAME and filtered to `dustcd/`, which
   * is right for the engine (it asks for `new.flt`, not for a path) and useless
   * to anything that lives beside the disc rather than in it. The saved games do:
   * they are at `gamefiles/save/*.RTD`, they are addressed by path, and the
   * page seeds them from exactly this list (`dust-saves.ts`). Kept whole so a
   * second such folder needs no third field.
   */
  readonly paths: string[] = [];

  /**
   * Index the disc from the manifest the dev server and the build both publish,
   * so this page needs no directory listing of its own.
   */
  static async open(root = "gamefiles/dustcd/"): Promise<DustFiles> {
    const store = new DustFiles();
    // the Dust page's own manifest: the walk of its OWN rip, at its own site
    // root, rather than a filtered slice of Titanic's
    // (tools/manifest.ts), so this download is the one disc and not every
    // TAOOT edition beside it. Resolved through siteUrl, like every URL a
    // page builds itself, so the page runs from any directory of any host.
    const res = await fetch(siteUrl("gamefiles.json"));
    const manifest: Record<string, number> = res.ok ? await res.json() : {};
    for (const path of Object.keys(manifest)) {
      store.paths.push(path);
      if (!path.startsWith(root)) continue;
      const base = path.split("/").pop()!.toLowerCase();
      const url = siteUrl(path);
      const have = store.urls.get(base);
      if (!have || rank(url) < rank(have)) {
        store.urls.set(base, url);
        // the manifest's VALUES, which this store used to throw away: they are
        // the byte sizes, and they are what lets the bar weigh a 13 MB film
        // against a 47 KB save instead of counting both as one fetch
        store.sizes.set(base, manifest[path]);
      }
    }
    for (const [base, url] of Object.entries(OFF_MANIFEST)) {
      if (!store.urls.has(base)) store.urls.set(base, siteUrl(url));
    }
    return store;
  }

  /** how many names the disc offers — a boot that indexed nothing says so */
  get size(): number {
    return this.urls.size;
  }

  /** what the manifest says this file weighs, or 0 for one it does not list */
  sizeOf(name: string): number {
    return this.sizes.get(name.toLowerCase()) ?? 0;
  }

  /**
   * How far the fetches in flight have got, in whole-file units — 0.4 while a
   * single film is two fifths of the way down the wire.
   *
   * The page's bar counts fetches, which is the right unit for a boot whose work
   * IS a fetch count, and the wrong one during the one fetch that takes a minute.
   * Adding this to the completed count keeps the unit and fills in the gap
   * between two arrivals. A file the manifest does not size contributes nothing
   * rather than a guess.
   */
  /**
   * How many bytes of these names are still to come: nothing for one already in
   * hand, and only the unfetched remainder of one in flight.
   *
   * The loading page's estimate of how long is left needs a "how much", and this
   * is the honest form of it — the manifest's sizes minus what has actually
   * landed, rather than a count of files scaled by an average. A name the
   * manifest does not size contributes nothing, which makes the estimate
   * optimistic rather than invented; on this disc it sizes everything.
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

  partialProgress(): number {
    let sum = 0;
    for (const [key, got] of this.partial) {
      const total = this.sizes.get(key) ?? 0;
      if (total > 0) sum += Math.min(1, got / total);
    }
    return sum;
  }

  /**
   * The engine's synchronous provider: what is in hand, or null.
   *
   * Null is not a failure here. The engine asks synchronously, misses, and the
   * host's `ensureFile` fetches and asks again — so a miss is recorded and
   * a fetch started, exactly as `FileStore.provide` does it.
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
    // one fetch per name however many callers ask at once, which the boot does:
    // `preload` fetches the plan while the scripts are already asking
    const started = !this.inFlight.has(key);
    const flight = this.inFlight.get(key) ?? (async () => {
      const res = await fetch(url);
      if (!res.ok) return { bytes: null, streamed: false };
      // STREAMED, which is what `HostFiles.load` has always promised ("where the
      // source streams, reports each chunk") and what taoot/src/files.ts does.
      // This store used to buffer the whole body and report it once, so its page
      // could only ever draw a bar that moved fourteen times.
      const bytes = res.body
        ? await this.readStream(key, res.body, onBytes)
        : new Uint8Array(await res.arrayBuffer());
      this.partial.delete(key);
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
      // The owner of a streamed fetch has been told chunk by chunk already.
      // Everyone else — a joiner, or the fallback path where the response had no
      // body to read — still gets the one total, as they always did.
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

  setDisc(): void {
    /* one volume — Dust's boot has no setpath(disk) and nothing to swap to */
  }

  activeEdition(): string {
    return "dust";
  }

  has(name: string): boolean {
    return this.cache.has(name.toLowerCase());
  }

  /**
   * The room the boot borrows as its MOVIE HOST — `GameHost.coldBoot`'s
   * no-landing-room path opens `serverSetNames()[0]` with `skipOpen` so the
   * intro films have a viewer to draw through, exactly as the Titanic demo's
   * boot does. This answered "none" for as long as a v1 set could not be
   * opened at all; `parseInto` routes one through `readSetFileAsV4` now, so the
   * honest answer is the room the day-advance is about to open anyway — the
   * host doubles as a prefetch of the town.
   */
  serverSetNames(): string[] {
    return this.has("town.set") || this.urls.has("town.set") ? ["town.set"] : [];
  }

  serverUrl(name: string): string | null {
    return this.urls.get(name.toLowerCase()) ?? null;
  }

  evict(): number {
    // Nothing is evicted. The disc is 644 MB but a boot touches a few of it, and
    // an experiment that drops bytes it might want again trades a real
    // diagnostic ("what did it ask for?") for memory it is not short of.
    return 0;
  }
}
