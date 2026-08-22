/**
 * The browser-side "file system": every game file the page has seen, keyed by
 * lowercase basename (scripts refer to files that way — `openshopfile
 * ("blkjack.shp")`). Files arrive from two directions:
 *
 *  - eagerly, via {@link load} (set activation prefetches a set's siblings), and
 *  - lazily, via {@link provide} — the engine's synchronous FileProvider
 *    contract. A miss that the dev server could satisfy kicks off a background
 *    fetch; {@link onBackgroundLoad} fires when it lands so the host can wire
 *    the file into the running viewer.
 *
 * In dev mode the vite server publishes a manifest of everything under
 * gamefiles/ (`gamefiles.json` — tools/manifest.ts); {@link registerServerFile}
 * records those URLs so both paths above can fetch on demand. Production
 * builds have no server files — everything must be added up front.
 *
 * Two axes decide WHICH copy of a basename a lookup gets, because the same name
 * legitimately exists more than once: the **disc** (`titanic1`/`titanic2` — the
 * public rooms ship once per act) and the **edition** (`gamefiles/de/…`,
 * `gamefiles/demo/…` — the game was localised, and this port keeps one tree per
 * edition; see taoot/src/editions.ts). Both follow the same shape: an active
 * selection, with a documented fallback.
 */
import { DfEncoding } from "@dreamfactory/engine/df/text";
import { NEUTRAL, TITANIC, editionOfUrl as editionOfUrlIn } from "@dreamfactory/site/games";
import { encodingOf, isEditionCode } from "./languages";

/** the CD a manifest URL sits on, from its `titanic1`/`titanic2` path segment */
export type Disc = 1 | 2;

/**
 * The disc a manifest URL sits on: which of `volumes` its path passes through.
 *
 * The volume names come from the game's own `setpath`, which is the only place
 * they are stated (engine/src/runtime/bootplan.ts) — this used to be a `/titanic([12])/`
 * regex, one title's CD labels in the layer that resolves any title's files.
 *
 * No volumes means a single-volume game and so no disc to be on: null, which
 * {@link FileStore} reads as disc 1. That is also the answer for this port's own
 * assets (`lang.stg`) and for a flat dump with no volume level, both of which are
 * outside any volume whatever the game is.
 */
export function discOfUrl(url: string, volumes: readonly string[] = []): Disc | null {
  for (let i = 0; i < volumes.length && i < 2; i++) {
    // a path SEGMENT, so a volume called "data" cannot match a folder of that name
    if (new RegExp(`(?:^|/)${volumes[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`, "i").test(url)) {
      return (i + 1) as Disc;
    }
  }
  return null;
}

/**
 * The EDITION tree a manifest URL sits in — the directory directly under
 * `gamefiles/` (`gamefiles/de/titanic1/data/bedsit1.set` → `"de"`,
 * `gamefiles/demo/…` → `"demo"`).
 *
 * Matched against the known codes ({@link isEditionCode}) rather than by shape:
 * it used to be any two-letter directory, which named the six languages neatly
 * and then had no way to admit `demo/` — a tree whose name is not a language code
 * would have read as NEUTRAL and had its files offered under every language at
 * once, colliding with the real game's basenames. A list is also what tells
 * `gamefiles/titanic1/…` (a flat dump, no edition level at all) from an edition.
 *
 * Anything unrecognised is **edition-NEUTRAL** ({@link NEUTRAL}) and reachable
 * whatever edition is active: that flat dump, and this port's own authored
 * assets, `lang.stg` above all — the chooser has to load before an edition exists
 * to load it from.
 */
// the marker itself is the registry's; re-exported because half this game
// reaches for it through here
export { NEUTRAL };

/** which edition a served path belongs to, for THIS game's trees */
export function editionOfUrl(url: string): string {
  return editionOfUrlIn(TITANIC, url);
}

/**
 * Which of two URLs for the same basename ON THE SAME DISC wins. Mirrors
 * `preferred` in taoot/tools/gamefiles.ts so the page and the Node-side tools/tests
 * read the same bytes: shallowest path, then most upper-case, then lexicographic.
 */
function preferredUrl(a: string, b: string): string {
  const depth = (u: string): number => u.split("/").length;
  if (depth(a) !== depth(b)) return depth(a) < depth(b) ? a : b;
  const caps = (u: string): number => (u.match(/[A-Z]/g) ?? []).length;
  if (caps(a) !== caps(b)) return caps(a) > caps(b) ? a : b;
  return a < b ? a : b;
}

/**
 * How many bytes of MOVIES may stay cached.
 *
 * Movies are the one thing the game plays and never needs again, and there are
 * 275 of them totalling 328 MB — most of a playthrough's worth, held for the
 * whole session, because nothing evicted them. A room is released when you leave
 * it (GameHost.releaseSet) and decoded frames are capped (SetViewer's ring
 * budget); this is the same idea for the third unbounded thing.
 *
 * The budget has to clear the largest single movie — leave.mov is 37.5 MB, and
 * sink6/ocredits are 25 and 22 — because the one now playing must never be the
 * one evicted. Above that it holds a couple of recent movies, so the close-up you
 * just dismissed and reopen doesn't refetch.
 */
const MOVIE_BUDGET_BYTES = 64 * 1024 * 1024;

const isMovie = (key: string): boolean => key.endsWith(".mov");

export class FileStore {
  private files = new Map<string, Uint8Array>();
  /** LRU stamps for cached movies, and their total size — see MOVIE_BUDGET_BYTES */
  private movieUse = new Map<string, number>();
  private movieClock = 0;
  private movieBytes = 0;
  /**
   * edition -> lowercase basename -> server URL per disc (dev-server manifest).
   *
   * Nested because a basename is not unique across the tree once six editions
   * are installed: `bedsit1.set` exists once per edition, and before this map
   * had an edition level they collided on the basename and one arbitrary tree
   * (whichever won `preferredUrl`) served the whole game.
   */
  private urls = new Map<string, Map<string, { 1?: string; 2?: string }>>();
  /** every registration as it came in, so {@link setVolumes} can re-index */
  private registered: [key: string, url: string][] = [];
  /** the game's volume directories in disc order; empty until the plan is read */
  private volumes: string[] = [];
  /** the edition whose copies win; {@link NEUTRAL} entries always resolve */
  private edition: string = NEUTRAL;
  private pendingFetches = new Set<string>();
  /** fired when a background fetch started by {@link provide} arrives */
  onBackgroundLoad: ((key: string, data: Uint8Array) => void) | null = null;

  /**
   * How many fetches are in the air, and a hook that fires whenever that
   * changes — what the page draws its busy mark from (taoot/src/main.ts).
   *
   * Every fetch this store makes is one the game is WAITING on, which is what
   * makes a bare count honest enough to show: `onSetChange` awaits the room and
   * then all of its siblings and casts before anything is composited,
   * `onPlayMovie` awaits the film before a frame of it plays, and {@link
   * provide}'s background fetches are engine misses — it asked, and got null.
   * Nothing here is speculative, so this never sits at 1 through normal play.
   *
   * The count rather than a boolean because the waits overlap: a changeset has
   * a dozen siblings in flight at once, and the mark should come down when the
   * last of them lands, not the first.
   */
  private inFlight = 0;
  onBusyChange: ((inFlight: number) => void) | null = null;

  private fetchBegan(): void {
    this.onBusyChange?.(++this.inFlight);
  }

  private fetchEnded(): void {
    this.onBusyChange?.(--this.inFlight);
  }

  /**
   * The disc whose copy of a both-discs file wins, mirroring BOOTFILE's
   * `setpath(disk)` — see {@link setDisc}. Starts at 1: `bootfile`,
   * `unilib.trk`, `inven.shp` and the opening `bedsit1` all live on TITANIC1.
   */
  private disc: Disc = 1;

  /**
   * Follow the game's disc swap. BOOTFILE's `setpath(disk)` installs
   * `titanic<N>:data:` etc. into the resource search path at each story
   * transition, and 93 basenames ship on both discs — the public rooms carry
   * their own act's state, undamaged before Zeitel shoots you in C73 and
   * flooding afterwards. Selecting the disc is what keeps the right one in play;
   * the other stays a fallback, since many rooms exist on one disc only.
   */
  setDisc(disc: Disc): void {
    if (disc === this.disc) return;
    this.disc = disc;
    // Drop decoded copies of files that exist on both discs: their bytes came
    // from the disc that was active when they were fetched. Single-disc files
    // are unaffected, so this is not a full cache flush. Both trees a lookup can
    // reach are swept — the active edition, and the neutral one a flat
    // single-edition dump lives in, whose files are both-discs too.
    for (const edition of this.lookupOrder()) {
      for (const [key, slots] of this.urls.get(edition) ?? []) {
        if (slots[1] && slots[2]) this.dropCached(key);
      }
    }
  }

  activeDisc(): Disc {
    return this.disc;
  }

  /**
   * Pick the edition whose data the game reads — the chooser's decision
   * (public/lang.stg → taoot/src/lang-chooser.ts), or `?edition=`/localStorage
   * (taoot/src/editions.ts).
   *
   * Cached bytes from the edition being left are dropped: they are that tree's
   * `bedsit1.set`, not this one's. Neutral files stay, which is what makes
   * re-running the chooser cheap — `lang.stg` itself is neutral.
   */
  setEdition(code: string): void {
    const edition = code.toLowerCase();
    if (edition === this.edition) return;
    this.edition = edition;
    const neutral = this.urls.get(NEUTRAL);
    for (const key of [...this.files.keys()]) {
      if (!neutral?.has(key)) this.dropCached(key);
    }
  }

  activeEdition(): string {
    return this.edition;
  }

  /** the code page that edition's text is in ({@link encodingOf}) */
  textEncoding(): DfEncoding {
    return encodingOf(this.edition);
  }

  /**
   * Which editions the manifest actually offers, in the order they were
   * registered. The chooser dims the buttons that aren't in here: a stage
   * showing six languages next to an install that has two would otherwise
   * promise data that isn't there.
   */
  availableEditions(): string[] {
    return [...this.urls.keys()].filter((l) => l !== NEUTRAL);
  }

  /**
   * The trees a lookup reads, in order: the active edition, then the neutral
   * one. One place, because three callers have to agree on it — resolution, the
   * set list, and the disc swap's cache drop.
   */
  private lookupOrder(): string[] {
    return this.edition === NEUTRAL ? [NEUTRAL] : [this.edition, NEUTRAL];
  }

  /** forget a cached file, keeping the movie budget's bookkeeping straight */
  private dropCached(key: string): void {
    const data = this.files.get(key);
    if (!data) return;
    this.files.delete(key);
    if (this.movieUse.delete(key)) this.movieBytes -= data.byteLength;
  }

  /**
   * URL for a key: the active language first (its own disc, then the other
   * disc), then the language-neutral tree. Preferring a language across BOTH
   * discs before falling back matters for the 93 both-discs basenames — a
   * language's disc-2 copy is a better answer than another tree's disc-1 one.
   */
  private urlFor(key: string): string | undefined {
    const other = this.disc === 1 ? 2 : 1;
    for (const lang of this.lookupOrder()) {
      const slots = this.urls.get(lang)?.get(key);
      if (slots) return slots[this.disc] ?? slots[other];
    }
    return undefined;
  }

  /**
   * Register a dev-server file so it can be (lazily) fetched later.
   *
   * Keying by lowercase basename is what lets a script's `openshopfile
   * ("trunk.shp")` find a file the CD spelled `TRUNK.SHP` — no single case
   * convention exists across the two discs. Entries are kept PER DISC, because
   * a shared basename is not a duplicate: `gstair2.set` on TITANIC1 and
   * `GSTAIR2.SET` on Titanic2 are the grand staircase before and after the
   * sinking. Collapsing them (as keying by basename alone used to) silently
   * picked one act's scenery for the whole game.
   */
  registerServerFile(key: string, url: string): void {
    this.registered.push([key, url]);
    this.indexServerFile(key, url);
  }

  /**
   * Which volumes this game's discs are, from its own `setpath`
   * ({@link BootPlan.volumes}) — and a re-index, because the answer arrives after
   * the registrations do.
   *
   * That order is forced and harmless. The volume names live in the BOOTFILE, and
   * the BOOTFILE is one of the files being registered, so nothing can know them
   * during registration. Until this is called every path indexes as disc 1, which
   * is where `bootfile` genuinely is on every multi-CD title — so the one lookup
   * that has to work before the answer is known is the lookup that fetches the
   * answer. The page calls this the moment it has the plan and before it preloads
   * anything (taoot/src/main.ts).
   */
  setVolumes(volumes: readonly string[]): void {
    if (volumes.join() === this.volumes.join()) return;
    this.volumes = [...volumes];
    this.urls.clear();
    for (const [key, url] of this.registered) this.indexServerFile(key, url);
  }

  private indexServerFile(key: string, url: string): void {
    const lower = key.toLowerCase();
    const disc = discOfUrl(url, this.volumes) ?? 1;
    const edition = editionOfUrl(url);
    let byName = this.urls.get(edition);
    if (!byName) this.urls.set(edition, (byName = new Map()));
    const slots = byName.get(lower) ?? {};
    slots[disc] = slots[disc] ? preferredUrl(slots[disc]!, url) : url;
    byName.set(lower, slots);
  }

  /** all .set files the dev server offers for the active language (sorted) */
  serverSetNames(): string[] {
    const names = new Set<string>();
    for (const lang of this.lookupOrder()) {
      for (const name of this.urls.get(lang)?.keys() ?? []) {
        if (name.endsWith(".set")) names.add(name);
      }
    }
    return [...names].sort();
  }

  has(name: string): boolean {
    return this.files.has(name.toLowerCase());
  }

  /**
   * Drop a cached file — the host does this for a set it has just left, so a
   * 32 MB room (DECKBD.SET) doesn't stay resident for the rest of the session.
   *
   * Refuses unless the file can be fetched again: a set that arrived from the
   * dev-server manifest can always come back, but bytes handed to us directly
   * (a production build with no server behind it) are all there is, and
   * dropping them would lose the game. Returns what it freed, for the log.
   */
  evict(name: string): number {
    const key = name.toLowerCase();
    const data = this.files.get(key);
    if (!data || !this.urlFor(key)) return 0;
    this.dropCached(key);
    return data.byteLength;
  }

  /**
   * Drop least-recently-used movies until the cache fits {@link
   * MOVIE_BUDGET_BYTES}, never the one just asked for.
   *
   * Safe because playback always goes through {@link load} first
   * (GameHost.onPlayMovie), so the movie on screen is the most recent stamp
   * there is — and an evicted one is only ever a refetch away, which is the
   * same bargain {@link evict} makes for a room you have left.
   */
  private capMovies(keep: string): void {
    if (this.movieBytes <= MOVIE_BUDGET_BYTES) return;
    const order = [...this.movieUse.entries()].sort((a, b) => a[1] - b[1]);
    for (const [key] of order) {
      if (this.movieBytes <= MOVIE_BUDGET_BYTES) break;
      if (key === keep) continue;
      const data = this.files.get(key);
      if (!data || !this.urlFor(key)) continue; // can't come back: keep it
      this.files.delete(key);
      this.movieUse.delete(key);
      this.movieBytes -= data.byteLength;
    }
  }

  /** cached movie bytes, for the memory report */
  get cachedMovieBytes(): number {
    return this.movieBytes;
  }

  /**
   * The engine's FileProvider. Synchronous by contract: returns what is
   * loaded; on a miss that the dev server could satisfy, kicks off a
   * background fetch and reports it via {@link onBackgroundLoad} once it
   * arrives (the current call still returns null).
   */
  provide = (name: string): Uint8Array | null => {
    const key = name.toLowerCase();
    if (isMovie(key) && this.movieUse.has(key)) this.movieUse.set(key, ++this.movieClock);
    const hit = this.files.get(key);
    if (hit) return hit;
    const url = this.urlFor(key);
    if (url && !this.pendingFetches.has(key)) {
      this.pendingFetches.add(key);
      this.fetchBegan();
      void fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((buf) => {
          const data = new Uint8Array(buf);
          this.files.set(key, data);
          this.onBackgroundLoad?.(key, data);
        })
        .catch(() => {})
        .finally(() => {
          this.pendingFetches.delete(key);
          this.fetchEnded();
        });
    }
    return null;
  };

  /** the URL a basename resolves to right now, or null — what a preloader has to
   *  ask before it can total up what it is about to fetch (GameHost.preload) */
  serverUrl(name: string): string | null {
    return this.urlFor(name.toLowerCase()) ?? null;
  }

  /**
   * Awaitable fetch into the store (for set activation and prefetching).
   *
   * `onBytes` makes it a STREAMING fetch, reporting each chunk as it lands: the
   * boot preloader draws a progress bar off it, and one 19.6 MB cast file among
   * fifteen small ones is why per-chunk rather than per-file — a bar that only
   * moves when a file finishes sits at the same mark for most of the wait.
   */
  async load(name: string, onBytes?: (n: number) => void): Promise<Uint8Array | null> {
    const key = name.toLowerCase();
    const cached = this.files.get(key);
    if (cached) {
      if (isMovie(key)) this.movieUse.set(key, ++this.movieClock);
      return cached;
    }
    const url = this.urlFor(key);
    if (!url) return null;
    this.fetchBegan();
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const data =
        onBytes && r.body ? await readStream(r.body, onBytes) : new Uint8Array(await r.arrayBuffer());
      this.files.set(key, data);
      if (isMovie(key)) {
        this.movieUse.set(key, ++this.movieClock);
        this.movieBytes += data.byteLength;
        this.capMovies(key);
      }
      return data;
    } catch {
      return null;
    } finally {
      this.fetchEnded();
    }
  }
}

/** drain a response body, reporting each chunk, then join it into one array */
async function readStream(
  body: ReadableStream<Uint8Array>,
  onBytes: (n: number) => void,
): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    onBytes(value.byteLength);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
