/**
 * Which games this project hosts, and what it takes to READ one's data.
 *
 * The landing page already carries this knowledge in markup — four doors, two of
 * them games. This is the same knowledge in a form a module can use, and it
 * exists because the format editors need it: they open a room, a film or a
 * puppet out of a rip, and to do that they have to know which trees that rip
 * offers, what to call them, and which code page the text in each one is in.
 *
 * ## Why it is here rather than in the game
 *
 * It was in the game, and that made `site/` depend on `taoot/` — a shared
 * package importing one of its own consumers, which is the one edge the
 * restructuring set out to avoid. The knowledge is not about PLAYING Titanic; it
 * is about reading a directory of 1996 files. Everything that is about playing
 * it — the boot plan, the chooser stage, the script global the chooser sets,
 * the pixel-art labels drawn into that stage — stayed in `taoot/`, which reads
 * its editions FROM here.
 *
 * ## The code pages are recovered, not chosen
 *
 * No DF file records an encoding (`engine/src/df/text.ts` says what was searched
 * and what the original did instead), so the tree it came from is the only thing
 * left to ask, and this is where the answer lives. It is not a guess:
 * `taoot/tests/auto/text.ts` re-derives every entry from the shipped puppet files
 * and fails on a wrong one rather than letting it mojibake.
 */
import { DEFAULT_ENCODING, DfEncoding } from "@dreamfactory/engine/df/text";

/**
 * The screen a game renders into, and where its UI band starts.
 *
 * A DreamFactory game has ONE framebuffer and everything in its data is authored
 * against it: STG flats are full-screen images, MOV frames decode to a full
 * screen, PUP stances composite over the whole screen, and a screen prop with no
 * `propxy` anchors at its CENTRE. So a tool that draws any of those has to know
 * how big the screen is, and only two of these formats say — an STG header
 * carries it at 0x28 (`StgFile.screen`), a SET carries its viewport, and a SHP, a
 * CST, a PUP and a MOV carry nothing.
 *
 * Which makes it a per-GAME fact, and one that is not derivable from the engine
 * version: measured off the three rips' own stage headers, 512×384 spans both
 * DreamFactory 1 and 4, and 640×480 is DreamFactory 4 as well
 * (`engine/src/web/screen.ts` has the table). It lives here because this is where
 * the editors already ask what a rip is.
 */
export interface GameScreen {
  width: number;
  height: number;
  /**
   * Where the room view ends and the UI band begins, when there is one.
   *
   * Titanic and Dust put a 512×264 set view in the top of the screen with their
   * interface band below it. ABSENT for a game with no sets at all: Timelapse has
   * no `.SET` on any of its four discs and no permanent band — its panel is a
   * stage of its own — so a tool drawing that line would be drawing a boundary
   * the game does not have.
   */
  band?: number;
}

/** one tree a game's data comes in */
export interface Edition {
  /** the directory under `gamefiles/`, and what `?edition=` accepts */
  code: string;
  /** what to call it in the chrome: an endonym, or a name for a cut of the game */
  name: string;
  /** the character set this tree's text bytes are in */
  encoding: DfEncoding;
}

/** everything the edition axis needs to know about one game */
export interface GameEditions {
  /** for messages and for the editors' own label */
  title: string;
  /** a short name for a button, where the full title is too long */
  short: string;
  /**
   * This game's directory under the site root — where its build is deployed and
   * where its rip sits beside it. What lets a page belonging to no game resolve
   * `taoot/gamefiles.json` and `dust/gamefiles.json` from one place.
   */
  dir: string;
  /** every edition, in the order a picker lists them */
  editions: readonly Edition[];
  /** where the reader's choice is remembered */
  storageKey: string;
  /** a key still read ONCE as a fallback, from before the two axes split */
  legacyKey?: string;
  /** the edition to fall back to when nothing else answers */
  fallback: string;
  /** the framebuffer this game's data is authored against — see {@link GameScreen} */
  screen: GameScreen;
  /**
   * Who DEVELOPED it, which is not one answer for the three.
   *
   * CyberFlix wrote the DreamFactory engine and used it for *Dust* and *Titanic*.
   * *Timelapse* is somebody else's game on the same engine — GTE Interactive
   * Media's — and everything in this project that said "the three CyberFlix
   * games" was quietly wrong about a third of it.
   *
   * Worth carrying as a field rather than as a sentence on a page, because it is
   * the fact that stops the engine's name and the studio's name being treated as
   * the same thing: `site/tests/front-doors.ts` holds the front page's badges to
   * this list.
   */
  developer: string;
  /**
   * The game's little mark, as the FRONT-END serves it — `site/public/mark-*`,
   * which are copies of each game's own `<dir>/public/<dir>-mark.*` favicon.
   *
   * Copies, and deliberately: the games menu ({@link file://./games-menu.ts})
   * draws these beside the names, and the pages that carry that menu are the front
   * page and the nine editors — all served by the SITE build, where a game's own
   * public directory is not. In the deployed tree `/taoot/taoot-mark.png` exists;
   * on the dev server the games are signposts to their own ports and it does not,
   * so a page reaching across would show a broken image in development and a mark
   * in production. `site/tests/front-doors.ts` holds each copy byte-for-byte
   * against the original, which is what makes the duplication safe.
   */
  mark: string;
}

/**
 * *Titanic: Adventure Out of Time* — six translations and one cut that is not a
 * translation.
 *
 * Stated outright rather than derived from `site/src/ui-languages.ts`, even though the
 * six codes and endonyms are the same strings. The game shipped in six languages
 * in 1996; the chrome is written in six because somebody translated it. Deriving
 * one from the other would turn a coincidence into a constraint and make the
 * game's pressings a consequence of who did the translating — so both are said
 * once, and `taoot/tests/auto/ui-languages.ts` asserts they still agree.
 */
export const TITANIC: GameEditions = {
  title: "Titanic: Adventure Out of Time",
  short: "Titanic",
  dir: "taoot",
  mark: "mark-taoot.png",
  editions: [
    { code: "en", name: "English", encoding: "macintosh" },
    { code: "de", name: "Deutsch", encoding: "macintosh" },
    { code: "fr", name: "Français", encoding: "macintosh" },
    { code: "ru", name: "Русский", encoding: "windows-1251" },
    { code: "nl", name: "Nederlands", encoding: "macintosh" },
    { code: "ja", name: "日本語", encoding: "shift_jis" },
    /**
     * The 1996 demo, under `gamefiles/demo/`: a different cut of the game rather
     * than a translation of one. Deliberately not one of the six — it would
     * claim a place in the authored chooser's art, an endonym it has no use for,
     * and a code page it does not need (English data, so the default is already
     * right for it).
     */
    { code: "demo", name: "Demo", encoding: DEFAULT_ENCODING },
  ],
  // Both literals are keys in real readers' `localStorage` and keep their
  // spelling wherever the table lives: renaming one would quietly forget a
  // choice somebody made. `taoot.lang` is read once as a fallback, from when the
  // edition was called a language and the two axes were one setting.
  storageKey: "taoot.edition",
  legacyKey: "taoot.lang",
  fallback: "en",
  screen: { width: 512, height: 384, band: 264 },
  developer: "CyberFlix",
};

/**
 * *Dust: A Tale of the Wired West* — one disc, one language, so no axis at all.
 *
 * Listed anyway, because "this game has nothing to choose between" is an answer
 * the picker already knows how to give: it hides itself below two editions. When
 * the editors are handed a game to browse rather than defaulting to one, this is
 * the second thing in the list.
 */
export const DUST: GameEditions = {
  title: "Dust: A Tale of the Wired West",
  short: "Dust",
  dir: "dust",
  mark: "mark-dust.svg",
  editions: [{ code: "dustcd", name: "English", encoding: DEFAULT_ENCODING }],
  storageKey: "dust.edition",
  fallback: "dustcd",
  // the same screen as Titanic's, which is the fact that made this a per-title
  // question rather than a per-version one
  screen: { width: 512, height: 384, band: 264 },
  developer: "CyberFlix",
};

/**
 * *Timelapse: Ancient Civilizations* — four discs, one language, and no edition
 * level in the tree at all.
 *
 * Dust has no axis either but still has a CODE, because its rip sits under
 * `gamefiles/dustcd/`. This one's paths are `gamefiles/TLAPSE1/…` through
 * `TLAPSE4/`, and those are VOLUMES rather than editions: one game, split across
 * four CDs, every one of them mounted at once and indexed by basename (the
 * scripts ask for `I001.Stg`, never for a path). So the code is the neutral one —
 * `editionOfUrl` already answers that for a path whose first segment names no
 * edition, which is what makes a game with no such level work here at all.
 *
 * ## The code page is the DEFAULT, and for once that is a finding
 *
 * `macintosh` here is not the usual "nothing said otherwise". This game gives
 * nothing to decide it WITH, which was checked rather than assumed: across the
 * whole rip — the eight installed files, 155 stages and 259 films, 100,680 script
 * containers and 49,561 string literals — there is not one byte above 0x7F. And
 * the two formats an encoding is really for are absent: no `.PUP` and no `.CST` on
 * any of the four discs, so there is no dialogue record and no cast text to get
 * wrong. What the editors will show out of this rip is stages, films and track
 * banks, whose text is identifiers.
 */
export const TIMELAPSE: GameEditions = {
  title: "Timelapse: Ancient Civilizations",
  short: "Timelapse",
  dir: "timelapse",
  mark: "mark-timelapse.svg",
  editions: [{ code: "", name: "English", encoding: DEFAULT_ENCODING }],
  storageKey: "timelapse.edition",
  fallback: "",
  // 640×480, said in the header of every one of its 155 stages — and no band,
  // because there are no sets to put above one
  screen: { width: 640, height: 480 },
  // NOT CyberFlix: the engine is theirs and this game is not
  developer: "GTE Interactive Media",
};

/**
 * *Skull Cracker* — the one entry here that is not an adventure, and the one whose
 * page is not a game.
 *
 * CyberFlix's own beat-'em-up, on their own engine, and it uses DreamFactory's
 * FILE formats without its interpreter: the logic is compiled into `SC.EXE`
 * rather than scripted in the data, so there is no BOOTFILE and nothing for a
 * `GameHost` to boot. What `skullcracker/` therefore is, is a film player over
 * the game's own menu — and what the editors can open is its sprite books, which
 * hold every cel and every level plan the game has (`engine/src/df/sbk.ts`).
 *
 * It is in this registry because the registry answers "which rips are there", and
 * a rip is what it has. The editors' source picker reads exactly that, and
 * without an entry here its 111 files would be the one corpus the tooling could
 * not see.
 */
export const SKULLCRACKER: GameEditions = {
  title: "Skull Cracker",
  short: "Skull Cracker",
  dir: "skullcracker",
  mark: "mark-skullcracker.svg",
  editions: [{ code: "", name: "English", encoding: DEFAULT_ENCODING }],
  storageKey: "skullcracker.edition",
  fallback: "",
  // 512×384, the same as Titanic's and Dust's — and no band, because there are
  // no sets. A sprite book records no screen at all; this is what its films are
  // authored against, which is the nearest thing the game has to one.
  screen: { width: 512, height: 384 },
  developer: "CyberFlix",
};

/** the code every edition-less path is treated as belonging to — see `editionOfUrl` */
export const NEUTRAL = "";

/**
 * Which edition a served path belongs to, or {@link NEUTRAL}.
 *
 * Anything unrecognised is edition-NEUTRAL and reachable whatever edition is
 * active: a flat dump with no `gamefiles/<code>/` level at all, and this port's
 * own authored assets — `lang.stg` above all, since the chooser has to load
 * before there is an edition to load it from.
 */
export function editionOfUrl(game: GameEditions, url: string): string {
  const m = /(?:^|\/)gamefiles\/([^/]+)\//i.exec(url);
  const code = m?.[1].toLowerCase();
  return code && game.editions.some((e) => e.code === code) ? code : NEUTRAL;
}

/**
 * Every game this project hosts, in the order a list shows them.
 *
 * Oldest engine first, which is also oldest game first — the order the
 * documentation introduces them in, and the order that makes "DreamFactory 1,
 * then 4" read as a progression rather than an arbitrary pair. Timelapse is
 * third: the same engine generation as Titanic, shipped after it, and the one
 * whose corpus has the least in it for an editor to open — no set, no puppet, no
 * cast, and one shop per world.
 *
 * Skull Cracker is last because it is the odd one out rather than the newest: same
 * year as Titanic, same studio, same file formats — and no interpreter, so it is
 * the only entry whose door does not lead to a playable game. Putting it after
 * the three keeps "these are DreamFactory adventures" true of the run of them.
 */
export const GAMES: readonly GameEditions[] = [DUST, TITANIC, TIMELAPSE, SKULLCRACKER];
