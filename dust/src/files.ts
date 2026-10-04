import type { WireEvent } from "@dreamfactory/engine/web/host";
import { RipFiles } from "@dreamfactory/engine/web/rip-files";
import { siteUrl } from "@dreamfactory/site/site";

/**
 * The Dust CD as a `HostFiles` (a {@link RipFiles}) — what lets the real engine boot off it.
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
 * **`serverSetNames` is a listing again.** It used to name the boot's MOVIE HOST:
 * `GameHost.coldBoot` asked for a room to draw into on the no-landing-room path,
 * because a film needed a viewer to draw through, and Dust's boot opens no room of
 * its own (its `advanceday` lives in `new.flt`). The intro films were invisible
 * for exactly as long as this answered "none". The screen is no longer a room's to
 * own (engine/src/web/screen-director.ts), so the films play with nothing loaded
 * behind them and this is back to meaning what it says.
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

export class DustFiles extends RipFiles {
  /**
   * The wire, one fetch at a time — what the load remover subtracts
   * (`engine/src/web/load-clock.ts`, #251).
   *
   * {@link onBusyChange} cannot answer it: the clock needs each fetch by
   * NAME, because since #369 it stops only for the ones that went to the
   * network and a cache hit is a read the original did off its CD as well. So
   * this reports the URL and an id to pair the two ends by, which is the same
   * sentence Titanic's store says (taoot/src/files.ts) and therefore the same
   * arithmetic on top of it.
   */
  private readonly wireWatchers = new Set<(e: WireEvent) => void>();
  private wireInFlight = 0;
  private nextFetchId = 1;
  /**
   * Names whose fetch was started by {@link provide} — nobody is waiting for
   * them ({@link WireEvent.waited}).
   *
   * Titanic's store needs no such set because its two paths are two different
   * fetches; Dust's `provide` starts the SAME {@link load} an awaiting caller
   * would, so which of them got there first is the only thing that separates
   * them, and it has to be written down before the flight begins.
   *
   * A joiner that really does await a flight this started keeps `waited: false`
   * for the whole of it, so its download is counted rather than removed. That
   * is the safe direction and deliberately so: under-removing makes a route look
   * slower than it was, over-removing invents a record.
   */
  private background = new Set<string>();
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

  /**
   * Watch the wire, one fetch at a time; returns the way to stop watching.
   *
   * `HostFiles.onWire`'s implementation for this disc. A watcher that
   * throws is not allowed to take the fetch down with it — what is being
   * reported is somebody else's readout.
   */
  onWire(watch: (e: WireEvent) => void): () => void {
    this.wireWatchers.add(watch);
    return () => {
      this.wireWatchers.delete(watch);
    };
  }

  /** announce a fetch and hand back the id its end must carry */
  private fetchBegan(url: string, waited: boolean): number {
    const id = this.nextFetchId++;
    this.wireInFlight++;
    this.sayWire({ id, url, done: false, inFlight: this.wireInFlight, waited });
    return id;
  }

  private fetchEnded(id: number, url: string, waited: boolean): void {
    this.wireInFlight--;
    this.sayWire({ id, url, done: true, inFlight: this.wireInFlight, waited });
  }

  private sayWire(e: WireEvent): void {
    for (const watch of this.wireWatchers) {
      try {
        watch(e);
      } catch {
        /* a readout's problem, not the fetch's */
      }
    }
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
  partialProgress(): number {
    let sum = 0;
    for (const [key, got] of this.partial) {
      const total = this.sizes.get(key) ?? 0;
      if (total > 0) sum += Math.min(1, got / total);
    }
    return sum;
  }

  /**
   * Nobody awaits this one: the engine asked, was told "not yet" and carried
   * on, so a speedrun's clock must keep counting through it (#369). Marked
   * BEFORE the fetch, because the flight reads it as it is created — see
   * {@link background}.
   */
  protected override fetchUnasked(key: string): void {
    this.background.add(key);
    super.fetchUnasked(key);
  }

  /**
   * The flight's two ends, said on the wire. Whether anyone is waiting is
   * decided once, for the whole flight, and by whoever started it — see
   * {@link background}.
   */
  protected override flightBegins(key: string, url: string): () => void {
    const waited = !this.background.has(key);
    const id = this.fetchBegan(url, waited);
    return () => this.fetchEnded(id, url, waited);
  }

  protected override flightOver(key: string): void {
    this.background.delete(key);
  }

  setDisc(): void {
    /* one volume — Dust's boot has no setpath(disk) and nothing to swap to */
  }

  activeEdition(): string {
    return "dust";
  }

  /**
   * The sets this disc has, which is one.
   *
   * No longer load-bearing for the boot: the intro films used to need this to
   * name a room they could be drawn through, and now they do not. `town.set` is
   * still prefetched before the boot runs, explicitly, by the loader in main.ts —
   * which is where a prefetch belongs rather than as a side effect of borrowing a
   * room to draw on.
   */
  serverSetNames(): string[] {
    return this.has("town.set") || this.urls.has("town.set") ? ["town.set"] : [];
  }
}
