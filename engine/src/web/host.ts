/**
 * The game host: what it means to *run* the game, minus the browser.
 *
 * `main.ts` is the page — canvas, input, DOM, the rAF loop. This is the layer
 * under it: the single session, the set that is currently open, and the
 * lifecycle that gets from one to the other — activating a set, prefetching
 * what it needs, booting the shipped `BOOTFILE boot()`, resuming a save.
 *
 * It exists because that lifecycle is game knowledge, not page knowledge, and
 * it used to live in `main.ts` purely because the mutable `viewer` did. Three
 * defects hid there — the theme blip, the stale scene loop across a set swap,
 * the audio-unlock desync — untestable, because the test harness could not
 * import a module that touches `document`, and so had hand-rolled its own
 * shorter `onSetChange` instead. Anything a test could contradict belongs here.
 *
 * Nothing in this file may reference `document`, `window` or WebAudio: the page
 * passes its side in as {@link HostFiles} (a file source), {@link HostUi} (five
 * notifications) and an {@link AudioSink}. Tests pass node equivalents.
 */
import { readSetFile, SetFile } from "@dreamfactory/engine/df/set";
import { detectVersion } from "@dreamfactory/engine/df/version";
import { readSetFileAsV4 } from "@dreamfactory/engine/df/set-v1-to-v4";
import { parseSave } from "@dreamfactory/engine/df/savegame";
import { SetViewer } from "./viewer";
import { ScreenPresenter } from "./screen-presenter";
import { AudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { FileProvider } from "@dreamfactory/engine/runtime/setscripts";
import { BootPlan, EMPTY_BOOT_PLAN, readBootPlan } from "@dreamfactory/engine/runtime/bootplan";
import { DEFAULT_ENCODING, DfEncoding } from "@dreamfactory/engine/df/text";

/**
 * Where game files come from: `FileStore` in the browser (fetch + cache), the
 * `gamefiles/` index in tests. The engine itself only ever needs the
 * synchronous {@link provide}; the host also wants to *await* a file, because
 * a set cannot open before its siblings are in.
 */
export interface HostFiles {
  /** the engine's synchronous FileProvider */
  provide: FileProvider;
  /** fetch/read by lowercase basename; null when it doesn't exist. `onBytes`, where
   *  the source streams, reports each chunk — {@link GameHost.preload}'s bar */
  load(name: string, onBytes?: (n: number) => void): Promise<Uint8Array | null>;
  /** follow BOOTFILE's setpath(disk) to the other CD */
  setDisc(disc: 1 | 2): void;
  /** the disc in play, if the source tracks one (skips a redundant swap) */
  activeDisc?(): 1 | 2;
  /** the edition tree in play, which is what says how its text bytes decode */
  activeEdition?(): string;
  /** WHICH code page that is. No DF file says (engine/src/df/text.ts), so the
   *  tree is the only thing that knows — and which codes map to which page is a
   *  fact about one game's releases, not about the engine. A source that leaves
   *  this out gets the engine's default, the Mac OS Roman most trees are in. */
  textEncoding?(): DfEncoding;
  /** is this file already in hand? (the preloader skips what it need not fetch) */
  has?(name: string): boolean;
  /** every `.set` this edition offers — the cold boot needs one to draw into */
  serverSetNames?(): string[];
  /** where a basename would be fetched from — the preloader totals these up */
  serverUrl?(name: string): string | null;
  /** fired when a lazy background fetch lands, so it can reach the viewer */
  onBackgroundLoad?: ((key: string, data: Uint8Array) => void) | null;
  /** drop a cached file if it can be fetched again; returns bytes freed */
  evict?(name: string): number;
}

/** what the host tells whoever is showing it. Every one is optional. */
export interface HostUi {
  /** a line for the script log */
  log(line: string): void;
  /** the status line ("loading turk.set…", a load failure) */
  hud(text: string): void;
  /** a set is up: reveal the game, hide whatever came before it */
  showStage(): void;
  /** the viewer was replaced or its map toggled */
  mapChanged(): void;
  /** a set was parsed and cached. Nothing on the play page listens any more —
   *  the set dropdown it was for is gone — but the host still says so, because
   *  "which rooms are in hand" is a fact about the run and not about a widget. */
  setsChanged(): void;
}

// ---------------------------------------------------------------------------
// Prefetching: which files a set needs before it can activate
// ---------------------------------------------------------------------------

/**
 * A set's sibling files, found next to it under `gamefiles/`.
 *
 * BOTH engines' spellings for the same three roles, because this layer is not
 * supposed to know which game it is running. DreamFactory 4 writes `.shp` and
 * `.trk`; DreamFactory 1 writes `.prp` and `.snd` and its own boot says they are
 * the same thing (`openshopfile("house.prp")`, `opentrackfile("unilib.snd")`).
 * Listing both costs nothing — a name the tree does not carry is never fetched,
 * and the preloader drops it before it weighs it — and without the v1 pair a Dust
 * room arrived with no props file and no sound at all.
 */
const siblingFiles = (base: string): string[] =>
  [`${base}.shp`, `${base}.prp`, `${base}.trk`, `${base}.snd`, `${base}.sfx`, `${base}.11k`];

/**
 * The one file this layer knows the name of: a DreamFactory game's entry point,
 * and the manifest for everything else it needs (engine/src/runtime/bootplan.ts).
 *
 * What used to be here instead was three lists of TAOOT filenames — the boot
 * library's shops and stages, `gang.cst`, the logos, `bedsit1.set` — sixteen names
 * belonging to one game, in the layer that is supposed to run any of them. They
 * are read out of the BOOTFILE now: it names every one of them itself, because
 * opening them is what its `boot()` does.
 */
const BOOT_FILE = "bootfile";

/**
 * Run a callback on the next macrotask — the yield {@link GameHost}'s
 * `nextFrame` renders on. `setImmediate` where there is one (node: it runs in
 * the check phase, ahead of timers, so a pumped host's own `setImmediate` drain
 * and this frame interleave in the order the pump was written for — the
 * playthrough's drag loops read the cursor on those frames), `setTimeout(0)`
 * otherwise. A browser takes neither: main.ts points nextFrame at rAF.
 */
const yieldMacrotask: (fn: () => void) => void =
  typeof (globalThis as { setImmediate?: unknown }).setImmediate === "function"
    ? (globalThis as unknown as { setImmediate: (fn: () => void) => void }).setImmediate
    : (fn) => void setTimeout(fn, 0);

export class GameHost {
  readonly session: GameSession;
  /**
   * The one screen every viewer composites into. It belongs here, not to the
   * viewer, because it OUTLIVES the viewers: a set change swaps the viewer,
   * and the frame the player is looking at must not be swapped with it (the
   * session's fade snapshot holds it across exactly that gap).
   */
  readonly screen = new ScreenPresenter();
  /** parsed .SET files by name (a set is parsed once, re-activated many times) */
  readonly loadedSets = new Map<string, SetFile>();
  private current: SetViewer | null = null;
  /** loadedSets key of the active set — what {@link releaseSet} gives back */
  private currentKey: string | null = null;
  private readonly ui: HostUi;
  /** {@link bootPlan}'s one fetch-and-parse, shared by every caller */
  private plan: Promise<BootPlan> | null = null;

  /** the live viewer, or null before the first set opens */
  get viewer(): SetViewer | null {
    return this.current;
  }

  /**
   * What this game's boot needs, read from its own BOOTFILE — the resource lists
   * that used to be hardcoded here (engine/src/runtime/bootplan.ts).
   *
   * Fetch-and-parse once, shared: five call sites want it, one of them per set
   * change, and re-reading a 90 KB script container on each would be work done to
   * learn something that cannot change. An edition switch is a page reload
   * (taoot/src/editions.ts), so there is no live invalidation to get wrong.
   */
  bootPlan(): Promise<BootPlan> {
    return (this.plan ??= this.files
      .load(BOOT_FILE)
      .then((bytes) => (bytes ? readBootPlan(bytes) : EMPTY_BOOT_PLAN))
      .catch(() => EMPTY_BOOT_PLAN));
  }

  constructor(
    readonly files: HostFiles,
    audio: AudioSink,
    ui: Partial<HostUi> = {},
  ) {
    this.ui = {
      log: () => {}, hud: () => {}, showStage: () => {},
      mapChanged: () => {}, setsChanged: () => {}, ...ui,
    };
    this.session = new GameSession(files.provide, audio);
    this.session.onLog = (l) => this.ui.log(l);
    // Subtitles and drawstring are bytes in the tree's own code page and no DF
    // file says which (engine/src/df/text.ts) — the tree is the only thing that knows.
    // Asked live rather than copied, so a language switch cannot leave the
    // session decoding the one it used to be reading.
    this.session.textEncoding = () => files.textEncoding?.() ?? DEFAULT_ENCODING;
    // on-demand loaders (puppets/casts/movies) await this, so the first click
    // works even before the file is cached
    this.session.ensureFile = async (name) => {
      await this.files.load(name);
    };
    // A movie chain has ended: give its bytes back. Nothing needs them again —
    // and the ones that hurt are the big cutscenes (TAOOT: leave.mov 37.5 MB,
    // sink6 25 MB, ocredits 22 MB), each played exactly once. FileStore.evict refuses
    // anything it cannot fetch again, so a build with no server behind it keeps
    // everything it was handed.
    this.session.onMoviesDone = (names) => {
      let freed = 0;
      for (const name of names) freed += this.files.evict?.(name) ?? 0;
      if (freed > 1048576) this.ui.log(`movies done: freed ${(freed / 1048576).toFixed(1)} MB`);
    };
    // A load replaces the viewer the film is playing on, and the film has to be
    // told: `this.current` and not a captured viewer, so it always names the one
    // holding the screen now.
    this.session.onAbandonMovie = () => this.current?.abandonMovie();
    // the boot's setpath(disk) -> which CD's copy of a both-discs room we read
    this.session.onDiscChange = (disc) => {
      if (this.files.activeDisc?.() === disc) return;
      this.files.setDisc(disc as 1 | 2);
      this.ui.log(`disc ${disc} (titanic${disc}) mounted`);
    };
    // forceupdate() is one pass of TI.EXE's main loop: service the world, then
    // RENDER a frame — and rendering is what advances a turn or walk animation.
    // The session half (the service pass) is in the builtin; the frame is here,
    // because the host is what owns the viewer. Without it a script that polls
    // the camera can never see the move end:
    //
    //   currentscene ("right")
    //   while currentview () = "moving"
    //     forceupdate ()
    //   endwhile
    //
    // — TAOOT's 2nd-class-staircase 90° landing turn, stair1c2's turn-then-open
    // door click, BEDSIT1's endgame. Each one spun to the interpreter's 100k
    // guard and then carried on with the turn still in flight, which silently
    // dropped whatever it did next (for the staircase, the second turn of two).
    // A macrotask, not a microtask: a promise that resolves immediately starves
    // whatever else the host is pumping, which is the same starvation by another
    // route. main.ts replaces this with requestAnimationFrame — a browser draws
    // on its own clock and forceupdate only has to wait for the next one.
    this.session.nextFrame = () =>
      new Promise<void>((resolve) =>
        yieldMacrotask(() => {
          this.current?.tick(this.session.clock.now);
          resolve();
        }),
      );
    // a file that arrived from a background fetch gets wired into the viewer
    if ("onBackgroundLoad" in files) {
      files.onBackgroundLoad = (key, data) => this.current?.addResource(key, data);
    }
    // the boot's changeset() (TAOOT's name for it): the engine asks for another set, we put it on screen
    this.session.onSetChange = async (fileName, sceneName, viewName) => {
      const data = await this.files.load(fileName);
      if (!data) {
        this.ui.log(`cannot travel to ${fileName}: file not available`);
        return;
      }
      if (!this.parseInto(fileName, data, (m) => this.ui.log(m))) return;
      const base = fileName.replace(/\.set$/, "");
      // the room's own files, plus the story cast the boot opened: every room can
      // spawn from it, and it is the one boot resource a set change re-asserts
      const { casts } = await this.bootPlan();
      await Promise.all([...siblingFiles(base), ...casts].map((f) => this.files.load(f)));
      this.ui.setsChanged();
      await this.activateSet(fileName, sceneName, viewName, { scripted: true });
    };
  }

  /**
   * Give back everything that belonged to the room we just left.
   *
   * `changeset` already closes the departing set (`closesetfile`) — that fires
   * the scripts' own teardown, but on the engine side it frees nothing, and the
   * host was holding the expensive parts: TAOOT's DECKBD.SET alone is **32 MB**
   * of bytes, and (before frames were decoded a ring at a time) its decoded frames
   * another 366 MB. The viewer and its frame cache are dropped by the swap and
   * collected; these four were not, and grew for the whole session — 113 MB of
   * files after four rooms.
   *
   * Measured since, walking a browser from TAOOT's gym to C deck: the file cache
   * holds 35-65 MB and goes DOWN as often as up, one parsed set and two shops
   * stay resident, and the JS heap sits at 10 MB the whole way — the decoded
   * frames never materialise, because only the ring you are looking at is
   * decoded. A room costs bytes now, not a hundred megabytes of pixels.
   *
   * What is NOT released: the boot's session-scoped resources (TAOOT:
   * house/inven shops, gang.cst, unilib), and the theme banks — those are named
   * by REGION (TAOOT: by deck), shared between rooms, and the scripts close
   * them themselves (`putdownsound`) when the region actually changes. Undoing
   * that here would cut the music on same-deck travel.
   */
  private async releaseSet(setFile: string): Promise<void> {
    const base = setFile.toLowerCase().replace(/\.set$/, "");
    // the room's own prop shop, through the engine's own close (runs closeshop)
    if (this.session.propRuntime.shops.has(`${base}.shp`)) {
      await this.session.closeShop(`${base}.shp`);
    }
    // its sound effects; NOT `${base}.trk`, see above
    for (const bank of [`${base}.sfx`, `${base}.11k`, `${base}.snd`]) {
      this.session.audioLib.closeBank(bank);
    }
    this.loadedSets.delete(`${base}.set`);
    let freed = 0;
    for (const f of [`${base}.set`, `${base}.shp`, `${base}.prp`, `${base}.sfx`, `${base}.11k`, `${base}.snd`]) {
      freed += this.files.evict?.(f) ?? 0;
    }
    if (freed) this.ui.log(`left ${base}: freed ${(freed / 1048576).toFixed(1)} MB`);
  }

  /** parse + cache a .SET; false (and a report) if it isn't one */
  private parseInto(name: string, data: Uint8Array, fail: (m: string) => void): boolean {
    try {
      // same routing as GameSession.loadSet: a v1 set becomes a v4-shaped one
      this.loadedSets.set(
        name,
        detectVersion(data) === 1 ? readSetFileAsV4(data) : readSetFile(data),
      );
      return true;
    } catch (e) {
      fail(`cannot parse ${name}: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * Put an already-parsed set on screen: build its viewer, run its opening
   * lifecycle, and hand the room to the player.
   *
   * `scripted` marks the call as the engine's own `changeset` (see the
   * scheduler note below); `skipOpen` builds the viewer as a bare movie host
   * without firing openset/openscene or its theme — the cold boot needs a
   * surface to play the logos on before the game has properly begun.
   */
  async activateSet(
    name: string,
    startScene = "",
    startView = "",
    opts: { skipOpen?: boolean; scripted?: boolean } = {},
  ): Promise<void> {
    const set = this.loadedSets.get(name);
    if (!set) return;
    const session = this.session;
    // Hand back the room we are leaving. Keyed by what the HOST activated, not
    // by session.currentSetFile: on a scripted change openSetFile has already
    // pointed that at the arriving set, and a set whose file name differs from
    // its internal one (DECKBD.SET calls itself "decka") would then release the
    // wrong name and leave 32 MB resident.
    if (this.currentKey && this.currentKey !== name) await this.releaseSet(this.currentKey);
    this.currentKey = name;
    // Direct activation (set list / a dev jump) bypasses openSetFile — and with
    // it the boot's changeset, whose closeset -> putdownsound stops the room's
    // scheduled work. Nothing else will: loops are keyed by scene/prop name on
    // a session-wide scheduler, so leaving TAOOT's flat by dropdown kept its
    // window-lady scene loop running (a handler on a scene that no longer
    // exists, every 400 ms) and the citycricket sound loop flagged on, inside
    // the next set. Clear it here, the same way loading a save does — a
    // SCRIPTED change must not, since there the game has already said what it
    // wants stopped.
    if (!opts.scripted) session.scheduler.reset();
    session.currentSetFile = name.toLowerCase().replace(/\.set$/, "");
    // any entry point may be the first thing that happens (a set pick, the cold
    // boot, a resumed save), and none of them can know — so each states what it
    // needs and the session decides whether that is already true
    await session.ensureBooted();
    const viewer = new SetViewer(set, session, startScene, startView, this.screen);
    this.current = viewer;
    // A changeset fired from a keydown/click (a door leading to another set,
    // e.g. TAOOT gstair3's grand-staircase exit into recept1c) swaps in this fresh
    // viewer mid-gesture. Re-arm the nav hooks on it so boot's default walk —
    // the currentscene("strait") run later in the SAME keydown chain, after the
    // script passcodes — drives THIS viewer (walking into the arrived-in room)
    // rather than the old, discarded one. Outside a gesture the hooks stay inert.
    if (session.navGestureActive) viewer.armNavHooks();
    viewer.onHud = (t) => this.ui.hud(t);
    viewer.onLog = (l) => this.ui.log(l);
    // movies aren't prefetched: fetch on demand, then play. Returns the play
    // promise so playmovie() blocks the script until the movie (chain) ends —
    // the modal behaviour interactive movies (TAOOT's purser window) depend on.
    session.onPlayMovie = async (movieName, startFrame) => {
      const v = this.current;
      if (!v) return;
      await this.files.load(movieName);
      await v.playMovie(movieName, startFrame);
    };
    viewer.refreshHud();
    this.ui.showStage();
    this.ui.mapChanged();
    if (opts.skipOpen) return;
    await viewer.start();
    // The set's own openset -> setupsound picks the theme authentically (TAOOT
    // names them by deck: bedsit1 -> bedrad1.trk, halla -> decka.trk), so give
    // it first say and let startTheme only cover what it leaves silent — a jump
    // into a set setupsound has no case for. Starting the fallback FIRST played
    // the set-named bank (bedsit1.trk, the bomb-scene music) for the ~90 ms
    // until setupsound replaced it: an audible blip of the wrong music on every
    // entry.
    viewer.startTheme();
  }

  /**
   * Pull the always-needed files in the background, before anything asks for
   * them. Every entry point — cold boot, a save, a set pick — blocks on these
   * ~32 MB at its first activation, and they are the one part of the game that
   * is never released, so fetching them early costs no extra memory and only
   * moves the wait off the click. Fire-and-forget; a set activation awaits the
   * same {@link HostFiles.load} calls and simply finds them done (or in flight).
   *
   * Which edition they come from is the file source's business ({@link
   * FileStore.setEdition}) — so this must not be called before that is settled,
   * or the boot library arrives from whichever tree happened to answer.
   */
  warmBootResources(): Promise<void> {
    return this.bootPlan()
      .then((plan) => Promise.all(plan.resources.map((f) => this.files.load(f))))
      .then(() => this.ui.log("boot resources ready"))
      .catch(() => {});
  }

  /**
   * Everything this game's boot will read, as filenames: what its `boot()` opens,
   * and the room its day machine lands in with that room's siblings.
   *
   * Shared by {@link preload} (which weighs them and shows a bar) and {@link
   * loadServerSet} (which needs them present for an entry point that never runs
   * `boot()` at all — a dev jump, a resumed save).
   */
  private async bootFiles(): Promise<string[]> {
    const plan = await this.bootPlan();
    const landing = plan.landingSet;
    return [
      BOOT_FILE,
      ...plan.resources,
      ...(landing ? [landing, ...siblingFiles(landing.replace(/\.set$/, ""))] : []),
    ];
  }

  /**
   * Everything {@link coldBoot} would otherwise wait for, fetched BEFORE it runs
   * and reported as it lands.
   *
   * The play page used to start the boot the moment it knew which edition to read
   * and let the rest stream in behind it: the logos played over a page that was
   * still pulling the 19.6 MB cast, and what the player saw of the wait was a
   * black canvas and, if they were unlucky, a movie that stalled mid-frame. So the
   * wait is now in front of the game instead of inside it — the boot text stays up
   * with a bar under it, and the game starts on files that are already here.
   *
   * `onProgress` is called with BYTES, not files: the list is one 19.6 MB cast
   * among a dozen small ones, and a per-file bar would sit at nine-tenths of the
   * way along for most of the wait. Which means the weights have to be known
   * before the first fetch, and only the page can answer that — `sizeOf` is how it
   * does (the dev server's manifest sizes; a HEAD would have been the obvious way
   * and that server aborts them). A file it cannot weigh counts as zero and the
   * bar moves less than it might have; where NOTHING can be weighed the total is 0
   * and the caller is expected to show no bar rather than a fictional one.
   */
  async preload(opts: {
    sizeOf?: (name: string) => number;
    onProgress?: (loaded: number, total: number) => void;
  } = {}): Promise<void> {
    const { sizeOf, onProgress } = opts;
    const wanted = (await this.bootFiles())
      .filter((f, i, all) => all.indexOf(f) === i && !this.files.has?.(f))
      // A game need not carry every name its own boot mentions — a sibling bank a
      // room has no use for, a movie behind a branch this tree cut — and a file
      // that is not there is neither weighed nor fetched, so the bar's total is
      // what this edition will really cost.
      .filter((f) => this.files.serverUrl?.(f) !== null);
    const total = wanted.reduce((n, f) => n + (sizeOf?.(f) ?? 0), 0);
    let loaded = 0;
    onProgress?.(0, total);
    await Promise.all(
      wanted.map((f) =>
        this.files
          .load(f, (n) => {
            loaded += n;
            onProgress?.(Math.min(loaded, total), total);
          })
          .catch(() => null),
      ),
    );
    onProgress?.(total, total);
    this.ui.log("boot resources ready");
  }

  /** fetch a set and everything it needs, then activate it */
  async loadServerSet(setName: string, opts: { skipOpen?: boolean } = {}): Promise<void> {
    this.ui.hud(`loading ${setName}…`);
    const data = await this.files.load(setName);
    if (!data) {
      this.ui.hud(`could not fetch ${setName}`);
      return;
    }
    const base = setName.replace(/\.set$/, "");
    // The room's siblings, so the viewer finds them synchronously at
    // construction, and the boot's own resources, because this is the entry point
    // that may be reached without `boot()` having run (a dev jump, a resumed
    // save) and `ensureBooted` needs them in hand.
    const plan = await this.bootPlan();
    await Promise.all(
      [...siblingFiles(base), ...plan.resources].map((f) => this.files.load(f)),
    );
    if (!this.parseInto(setName, data, (m) => this.ui.hud(m))) return;
    this.ui.setsChanged();
    await this.activateSet(setName, "", "", opts);
  }

  /**
   * Boot a saved game. The engine's own load path ({@link GameSession.loadGame})
   * restores globals/inventory and navigates to the saved standpoint, but it
   * runs `initall` — a boot-library global — so the core scripts + the saved
   * set's resources + a viewer must exist first. Parse the save to learn its
   * set, load that, then hand the bytes over.
   */
  async loadSavedGame(bytes: Uint8Array): Promise<void> {
    let save;
    try {
      save = parseSave(bytes);
    } catch (e) {
      this.ui.hud(`not a valid saved game: ${(e as Error).message}`);
      return;
    }
    // THE FILM FIRST, because the next line throws its viewer away.
    //
    // `session.loadGame` asks for this too (it is the choke point both load
    // paths share — the in-game `opengame` builtin calls it directly), and by
    // the time it runs on THIS path the viewer holding the film is already gone:
    // `loadServerSet` below replaces `this.current`, so the hook would reach a
    // fresh player with nothing playing and the abandoned film would keep its
    // promise for ever. Doing it here as well is not redundant, it is the only
    // moment on this path when the right player is still reachable —
    // `MoviePlayer.abandon` is a no-op when nothing is playing, so the second
    // call costs nothing.
    this.current?.abandonMovie();
    // skipOpen: the room's resources and a viewer, but NOT its openset — that
    // runs from the changeset inside loadGame, at the RESTORED mission and
    // phase. Opening it here ran it twice, the first time on whatever game was
    // standing (a fresh boot: mission 0), and TAOOT's boat-deck openset opens
    // with `if tour | mission != 4: error()` — so the log filled with bare
    // `script error():` lines, the cast file was opened twice, and the room was
    // built once for a mission it was not in.
    await this.loadServerSet(`${save.set}.set`, { skipOpen: true });
    if (!this.current) {
      this.ui.hud(`could not load the saved game's set (${save.set})`);
      return;
    }
    await this.session.loadGame(bytes);
    // AND UNCOVER THE ROOM THE RESTORE JUST BUILT.
    //
    // The fade belongs to the SESSION, deliberately — it outlives the viewers, so
    // that a transition can hold the screen across a set change. That is exactly
    // what makes it a hazard here: whatever was holding the screen when the page
    // decided to restore is still holding it afterwards, and a restored room has
    // nothing to reveal FROM. Nothing else will lift it either — `loadGame`
    // navigates and rebuilds, it does not paint — so the game comes up correct
    // and invisible: the right room, the right standpoint, a black screen.
    //
    // The engine's own load lever does not have this problem, and the difference
    // is instructive. `opengame` blacks the screen ITSELF before asking for bytes
    // (blackTheScreen, builtins/savegame.ts) precisely because TI.EXE's file
    // dialog is a modal loop with the game's windows hidden behind it — and
    // having put that black up, it takes it down. This path never put one up, so
    // it inherited whatever was there.
    //
    // Cleared and not ramped, for the same reason the builtin gives: there is
    // nothing to reveal from. The room is already painted underneath.
    this.session.fade.level = 0;
  }

  /**
   * Cold boot: run the shipped BOOTFILE `boot()` routine — the real TI.EXE
   * startup a direct set-jump skips. TAOOT's blackscreens, flies in the studio
   * logos (logo.mov), shows the interactive Play/Guided-Tour menu (playmode.mov
   * — a click region sets actionframe(1) = tour), loads the session resources
   * (gang.cst, inven/house shops, inven/unilib banks, main.stg), then advances
   * the day, which opens the first room with its date cutscene and fades in.
   *
   * Two engine realities shape the wiring:
   *  - Movies render through the set-bound viewer, but they carry their OWN
   *    palette and draw full-screen, so the host set's content never shows. We
   *    spin up the boot plan's landing room (TAOOT: bedsit1, where the normal
   *    `clock="startdisk1"` path lands anyway) as the movie host, under a
   *    pinned black screen so its openset can't flash before the logos.
   *    (viewer.render skips the fade overlay while a movie is active, so the
   *    logos still show at full brightness.)
   *  - boot() ends with `sendtostage(advanceday())`, but sendtostage doesn't
   *    fall back to the boot library (see GameSession.sendEvent), so that
   *    closing call no-ops. boot() still runs its whole front half — movies,
   *    resource loads, `clock="startdisk1"`, and the `tour` flag — so we kick
   *    the day-advance directly at the point boot() left off.
   */
  /**
   * Back to the front door after `quit()`, without reloading the page.
   *
   * Put the finished game down (GameSession.prepareRestart, which also waits for
   * the dispatch that called quit() to unwind), then boot exactly as a launch
   * does. A cold boot is already the whole of "show me the front door" — logos,
   * the Play / Guided Tour menu, then the flat — so there is nothing to write
   * here beyond the teardown that has to come first.
   *
   * Not tracked by the session on purpose: prepareRestart awaits `settle()`, and a
   * restart added to `inflight` would be waiting for itself.
   */
  async restart(): Promise<void> {
    await this.session.prepareRestart();
    await this.coldBoot();
  }

  async coldBoot(): Promise<void> {
    const session = this.session;
    session.interp.globals.set("tour", 0); // safe default; boot() sets it from the menu
    // paint the screen black up front so the movie host's openset doesn't flash
    session.fade.queue.length = 0;
    session.fade.snapshot = null;
    session.fade.pendingReveal = false;
    session.fade.level = 1;
    // the movies the boot plays before anything else, so it cannot stall mid-logo
    const plan = await this.bootPlan();
    await Promise.all(plan.resources.map((f) => this.files.load(f)));

    /*
     * A boot with a LANDING ROOM has a day machine, and the sequence below is
     * about it: the room the first day starts in, the logos in front of it, and
     * the `advanceday` that boot()'s own closing `sendtostage` could not reach.
     *
     * A boot without one ends where it ends. The demo's does: it sets its paths,
     * opens gang.cst, inven.trk, unilib.trk and demo.shp, plays its intro and
     * opens its own menu stage, and its `advanceday` is in main.stg — reached three
     * clicks later by the script behind that menu, not by us. So run what THAT boot
     * asks for and stop: there is no day to advance, and nothing here may open a
     * resource on its behalf (GameSession.bootedByGame).
     *
     * The question is asked of the BOOTFILE rather than of a filename we happen to
     * know (engine/src/runtime/bootplan.ts): whether this game's boot names a first room is
     * a fact about the game, and reading it is how the two paths stay apart without
     * either being told which game it is running.
     */
    if (!plan.landingSet) {
      this.ui.log("this boot names no first room: booting its own way");
      // The parse has to come first: this is the one call that hands the boot over
      // to the game, so that the set activation below cannot trigger the port's
      // stand-in. `bootPlan` above has already put the bytes it needs in hand.
      if (!(await session.bootedByGame())) {
        this.ui.hud(`no ${BOOT_FILE} in this edition: nothing to boot`);
        return;
      }
      /*
       * It still needs a room to draw INTO, and for the same reason a boot with a
       * landing room opens that one before its logos: a stage is composited by a
       * SetViewer, the frame loop draws when there is one (taoot/src/main.ts), and this
       * boot plays a movie and then opens a menu stage with no set behind either.
       * Without this the demo booted perfectly and showed a black screen — scripts
       * running, menu music playing, nothing drawing.
       *
       * Any of the game's rooms will do: `skipOpen` leaves its `openset` unrun, the
       * boot paints black over it (`clut("black")`, `blackscreen()`) and the menu's
       * own flat covers the screen. `currentset` goes back to "none" afterwards so
       * the viewer stops compositing a room the player was never in over the flat,
       * and so the first real `changeset` — the demo's `initall("c71")`, three
       * clicks later — sees a cold start. Its bytes go back at that changeset, like
       * any room you leave (activateSet).
       */
      const hostSet = this.files.serverSetNames?.()[0];
      if (hostSet) await this.loadServerSet(hostSet, { skipOpen: true });
      session.fade.level = 1;
      session.currentSetName = "none";
      session.currentSetFile = "";
      await session.runGlobal("boot");
      // After boot(), for the same reason the full path sets it after boot():
      // `boot()` assigns `themevolume = 255` itself, so anything set in front of
      // it is overwritten. The demo's menu theme does start inside boot() (its
      // stage's openstage does playnewtheme("demo.trk")) and is therefore a frame
      // old by the time this turns it down — under the boot's own
      // blacktoscreen("stage", 10), which is still fading the menu in.
      this.startAtHalfMix();
      return;
    }
    /*
     * Latch the boot BEFORE the movie host loads, exactly as the no-landing-room
     * path above does — a `boot()` we are about to run must not have the port's
     * stand-in run in front of it, and `loadServerSet` below would call it in
     * (GameSession.bootedByGame, which also puts down a stand-in that already ran).
     *
     * Nothing is lost by not standing in: gang.cst, both shops, the two banks and
     * main.stg are exactly what boot() opens next, and the band's props are seeded
     * by initall's `sendtoshop("inven.shp", initprops())`, which ends by sending
     * the same to house.shp. What is gained is that they are opened ONCE, after
     * boot() has read the GAME / GUIDED TOUR menu — the band is built from `tour`
     * and the two branches are not each other's undo.
     */
    if (!(await session.bootedByGame())) {
      this.ui.hud(`no ${BOOT_FILE} in this edition: nothing to boot`);
      return;
    }
    // spin up a bare movie host: loads the landing room + siblings and points
    // session.onPlayMovie at the viewer's movie player, but does NOT run that
    // room's openset — for bedsit1 that would start the flat's radio before the
    // logos. advanceday() opens it for real later (radio then).
    await this.loadServerSet(plan.landingSet, { skipOpen: true });
    session.fade.level = 1; // keep the host black until the first movie draws
    // boot()'s front half: black -> logo.mov -> playmode.mov -> resources -> tour.
    // boot() ENDS with its own `sendtostage(advanceday())`; mute the
    // sendtostage->boot fallback across this call so that closing advance stays
    // inert — we run the day-advance below, after resetting currentset->"none"
    // and the mix volumes. (Otherwise the day advances twice, skipping the flat.)
    session.suppressStageBootFallback = true;
    try {
      await session.runGlobal("boot");
    } finally {
      session.suppressStageBootFallback = false;
    }
    // The host left currentset() = the landing room. The day-advance ->
    // changeset() records `oldset = currentset()` BEFORE opening the room, so
    // without this reset oldset would equal the room and setupsound()'s
    // `themetype(cur)=themetype(old)` guard would skip theme setup — in TAOOT
    // leaving the startTheme fallback (bedsit1.trk, the BOMB-scene music)
    // playing instead of the flat's radio (bedrad1.trk). Reset to "none" so the
    // advance sees a genuine cold "none" -> landing-room transition.
    session.currentSetName = "none";
    session.currentSetFile = "";
    this.startAtHalfMix();
    // finish what boot()'s closing sendtostage(advanceday()) couldn't reach
    const tour = Number(session.interp.globals.get("tour")) !== 0;
    await session.runGlobal(tour ? "advancetour" : "advanceday");
  }

  /**
   * The theme's share of the cold-boot mix, 0..255.
   *
   * A field rather than a constant because one page wants it off: the speedrun
   * workbench plays the same twenty seconds of a room a hundred times over while
   * a route is tuned, and the music is the part of that which stops being
   * atmosphere and starts being a drill. Set before {@link coldBoot}; the boot
   * itself assigns `themevolume = 255` on the way through, so this is applied
   * after it, which is what {@link startAtHalfMix} is for.
   *
   * The SFX and voice channels are untouched — a route reads the game by its
   * sounds (a door, a line ending) as much as by its picture.
   */
  themeMix = 128;

  /**
   * Start a cold boot at a 50% mix, whichever edition is booting.
   *
   * Theme via themevolume ({@link themeMix}/255 ≈ 0.5, which setupsound's
   * themevol() re-applies), sampled sound/voice via the channel gains, with the
   * 0..9 wave dial parked mid so the settings panel reads back ~half. Both
   * callers set it BEFORE the music can start — which for the full game is
   * before the room opens, and for an edition that starts on a menu stage is
   * before its own `boot()` runs.
   */
  private startAtHalfMix(): void {
    this.session.interp.globals.set("themevolume", this.themeMix);
    this.session.waveVolume = 5;
    // the theme through the session, so a script reading `themevol(track)` back
    // sees the half mix rather than the untouched 255 default
    this.session.setThemeVolume(this.themeMix);
    for (const ch of ["sound", "voice"] as const) {
      this.session.audio.setChannelVolume(ch, 0.5);
    }
  }
}
