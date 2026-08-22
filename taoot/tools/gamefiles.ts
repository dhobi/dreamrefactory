/**
 * Game-file lookup over the original CD volume layout.
 *
 *   gamefiles/<lang>/<disc>/<folder>/<file>
 *   gamefiles/en/titanic1/data/gstair2.set
 *   gamefiles/en/titanic2/DATA/GSTAIR2.SET
 *
 * which is the shape BOOTFILE's `setpath(disk)` assumes when it fills the
 * engine's 9-slot resource search path (see the `path` builtin in
 * engine/builtins/helpers.ts):
 *
 *   setpath(1) -> mainpath "titanic1:"  path(3) data:  path(4) puppets2:  path(5) movies:
 *   setpath(2) -> mainpath "titanic2:"  path(3) data:  path(4) puppets1:  path(5) movies:
 *
 * plus a per-room folder in slot 7 (`path(7, mainpath @ "trunk:")`) and the
 * always-present `local:`/`tour:` slots. Note the deliberate crossover the
 * discs really ship: TITANIC1 carries `puppets2`, Titanic2 carries `PUPPETS1`.
 *
 * Two things this has to get right that a plain readdir does not:
 *
 *  - **Case.** No single convention exists. titanic1/data is all lowercase;
 *    titanic2/DATA is mostly uppercase but also holds `b59.set`, `bridge.set`,
 *    `a14.Set`. Scripts ask for whatever the author typed (`openshopfile
 *    ("blkjack.shp")`), so every lookup normalises to a lowercase basename —
 *    the same thing FileStore does for the browser. DIRECTORIES are matched
 *    case-insensitively too (the disc test below, `NOT_GAME_DATA`, `save/`), so
 *    a rip that was re-cased on the way in resolves the same as one that wasn't.
 *    Nothing outside this file should spell a gamefiles path out by hand.
 *
 *  - **The same basename on both discs.** 93 basenames ship on both discs, 21 of
 *    them rooms — the grand staircase, the café, the wireless room, the smoking
 *    room — each disc carrying that room in its own act's state: undamaged before
 *    Zeitel shoots you in C73, flooding afterwards. Which one is correct depends
 *    on story state, so the active disc is selectable
 *    ({@link GamefileIndex.setDisc}) and mirrors setpath(); the other disc stays
 *    a fallback, since plenty of rooms exist on only one (bedsit1 on TITANIC1,
 *    b59 on Titanic2).
 *
 * Excluded outright: the installer, driver and press-kit trees, and — the one
 * that actually bites — `titanic1/sneak/`, a separate sneak-preview demo that
 * ships its OWN `bootfile`. Letting that win boots the demo instead of the game.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_LANGUAGE } from "../src/languages";
import type { FileProvider } from "@dreamfactory/engine/runtime/setscripts";

/** directory names that are not game data, matched case-insensitively */
const NOT_GAME_DATA = new Set(["install", "support", "shots", "sneak"]);

/** the disc a path belongs to, from its `titanic1`/`titanic2` path segment */
export type Disc = 1 | 2;

export interface GamefileIndex {
  /** path of `name` on the active disc, else the other disc, else null */
  resolve(name: string): string | null;
  /** the engine's FileProvider, reading through {@link resolve} */
  provider: FileProvider;
  /** every copy of `name`, active disc first — for diagnostics */
  candidates(name: string): string[];
  /**
   * Select the disc whose copy of a shared basename wins, mirroring BOOTFILE's
   * `setpath(disk)`. Defaults to disc 1: `bootfile`, `unilib.trk`, `inven.shp`
   * and the opening `bedsit1` all live on TITANIC1, so that is where the game
   * starts.
   */
  setDisc(disc: Disc): void;
  activeDisc(): Disc;
  /** basenames that exist on both discs (a room shipped in two act states) */
  sharedNames(): string[];
  /**
   * Every indexed basename, optionally filtered — for tools that sweep the
   * corpus rather than open one named file. Excludes the non-game trees.
   */
  names(match?: RegExp): string[];
  /** the shipped-saves directory (`save/` beside the discs), or null */
  savesDir(): string | null;
}

/** which of two paths on the SAME disc wins: shallowest, then upper-case, then lexicographic */
function preferred(a: string, b: string): string {
  const depth = (p: string): number => p.split(/[\\/]/).length;
  if (depth(a) !== depth(b)) return depth(a) < depth(b) ? a : b;
  const caps = (p: string): number => (p.match(/[A-Z]/g) ?? []).length;
  if (caps(a) !== caps(b)) return caps(a) > caps(b) ? a : b;
  return a < b ? a : b;
}

/**
 * Where Titanic's rip is.
 *
 * Resolved from THIS FILE rather than from the working directory, because the
 * two are no longer the same thing: `npm test` runs from the repository root,
 * `vite build -w @dreamfactory/taoot` from `taoot/`, and a bare "gamefiles"
 * meant a different tree in each. `TAOOT_GAMEFILES` still overrides it, which is
 * how a route runs against a second install.
 */
export function gamefilesRoot(): string {
  return process.env.TAOOT_GAMEFILES ?? fileURLToPath(new URL("../gamefiles", import.meta.url));
}

/** result of the directory sweep: the only expensive part, and immutable */
interface Scan {
  /** lowercase basename -> winning path per disc */
  byName: Map<string, { 1?: string; 2?: string }>;
  /** the shipped-saves directory, if the tree has one */
  saves: string | null;
}

/**
 * The language directory to read, given what the caller asked for (`TAOOT_LANG`,
 * usually) and what the tree holds.
 *
 * An unset language used to mean "walk everything", which was fine while `en/`
 * was the only tree and quietly wrong as soon as a second one existed: the sweep
 * merged all of them into one basename map and `preferred()` picked a winner per
 * name, so a route could read German scenery for one room and English for the
 * next. So an unset language now means {@link DEFAULT_LANGUAGE} whenever that
 * directory exists, and only a tree with no language directory at all (a flat
 * single-language dump, which is what the tools were first written against) is
 * walked whole.
 */
function resolveLang(root: string, lang: string | undefined): string | undefined {
  if (lang) return lang;
  return safeIsDir(join(root, DEFAULT_LANGUAGE)) ? DEFAULT_LANGUAGE : undefined;
}

/**
 * Sweep the tree. `root` may point above the language directories
 * (`gamefiles/`), at one language (`gamefiles/en/`), or at a single flat
 * directory of game files — the walk records each file's disc from its path, so
 * a pre-split dump still resolves, with everything on "disc 1".
 */
function scanGamefiles(root: string, lang: string | undefined): Scan {
  const byName = new Map<string, { 1?: string; 2?: string }>();
  let saves: string | null = null;

  const walk = (dir: string, disc: Disc | null): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // missing or unreadable: every resolve() just misses
    }
    for (const e of entries) {
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue; // a broken symlink shouldn't abort the sweep
      }
      if (st.isDirectory()) {
        const low = e.toLowerCase();
        if (NOT_GAME_DATA.has(low)) continue;
        if (low === "save") {
          saves ??= p;
          continue; // saves are addressed by directory, not by basename
        }
        const m = /^titanic([12])$/i.exec(e);
        walk(p, m ? (Number(m[1]) as Disc) : disc);
        continue;
      }
      const key = e.toLowerCase();
      const slot = byName.get(key) ?? {};
      const d: Disc = disc ?? 1;
      slot[d] = slot[d] ? preferred(slot[d]!, p) : p;
      byName.set(key, slot);
    }
  };

  // a language directory narrows the tree; otherwise walk everything we're given
  const chosen = resolveLang(root, lang);
  const langDir = chosen ? join(root, chosen) : null;
  walk(langDir && safeIsDir(langDir) ? langDir : root, null);
  return { byName, saves };
}

/** an independent view over a scan, carrying its own active disc */
function viewOver({ byName, saves }: Scan): GamefileIndex {
  let active: Disc = 1;
  const other = (): Disc => (active === 1 ? 2 : 1);
  const key = (name: string): string => String(name).toLowerCase().replace(/^.*[\\/]/, "");
  const resolve = (name: string): string | null => {
    const slot = byName.get(key(name));
    if (!slot) return null;
    return slot[active] ?? slot[other()] ?? null;
  };

  return {
    resolve,
    provider: (name) => {
      const path = resolve(name);
      if (!path) return null;
      try {
        return new Uint8Array(readFileSync(path));
      } catch {
        return null;
      }
    },
    candidates: (name) => {
      const slot = byName.get(key(name));
      if (!slot) return [];
      return [slot[active], slot[other()]].filter((p): p is string => !!p);
    },
    setDisc: (disc) => {
      active = disc;
    },
    activeDisc: () => active,
    sharedNames: () =>
      [...byName]
        .filter(([, slot]) => slot[1] && slot[2])
        .map(([name]) => name)
        .sort(),
    names: (match) => [...byName.keys()].filter((n) => !match || match.test(n)).sort(),
    savesDir: () => saves,
  };
}

function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** an index over a fresh sweep — prefer {@link gamefiles}, which caches the sweep */
export function indexGamefiles(root = gamefilesRoot(), lang = process.env.TAOOT_LANG): GamefileIndex {
  return viewOver(scanGamefiles(root, lang));
}

/** the language a lookup will read, after the {@link DEFAULT_LANGUAGE} fallback */
export function activeLanguage(root = gamefilesRoot(), lang = process.env.TAOOT_LANG): string | undefined {
  return resolveLang(root, lang);
}

const scans = new Map<string, Scan>();

/**
 * A view of the game data with its own active disc.
 *
 * The directory sweep behind it is cached per (root, language), but every call
 * hands back an INDEPENDENT view, because the active disc is mutable state that
 * follows one session's story progress. Sharing a single view between sessions
 * lets one that reached act 2 leave the next reading post-sinking copies of the
 * 93 both-discs rooms — exactly the order-dependent cross-talk a test suite
 * must not have.
 */
export function gamefiles(root = gamefilesRoot(), lang = process.env.TAOOT_LANG): GamefileIndex {
  const k = JSON.stringify([root, resolveLang(root, lang) ?? ""]);
  let scan = scans.get(k);
  if (!scan) scans.set(k, (scan = scanGamefiles(root, lang)));
  return viewOver(scan);
}

/**
 * Path of a named game file, for callers that read one directly rather than
 * through a provider. Throws rather than returning null: every caller is a test
 * or tool that cannot proceed without the file, and the name is far more useful
 * in the error than an ENOENT on a guessed-case path.
 */
export function gamefilePath(name: string, root = gamefilesRoot()): string {
  const path = gamefiles(root).resolve(name);
  if (!path) throw new Error(`game file not found under ${root}/: ${name}`);
  return path;
}

/**
 * The engine binary the RE tools disassemble.
 *
 * It ships inside the installer rather than as game data, so it is deliberately
 * outside the index above (`install/` is skipped there): CD1 carries
 * `INSTALL/BIN/ti.exe` and `INSTALL/BINX/ti.exe`, the 16- and 32-bit installers'
 * payloads (`[PROGRAM]` and `[PROGRAMX]` in cfsetup.ini). Both are PE32 x86 and
 * differ — `BIN` is the build the recovered addresses in engine/src/runtime refer to
 * (e.g. the `path` table at 0x4898b8 lands in its BSS gap after `.data`, whereas
 * in `BINX` that address falls inside `.idata`), so prefer it. `titanic.exe` at
 * the disc root is only a 16-bit NE launcher stub and is not a candidate.
 *
 * `TAOOT_TIEXE` overrides outright.
 */
export function gameExePath(root = gamefilesRoot()): string {
  if (process.env.TAOOT_TIEXE) return process.env.TAOOT_TIEXE;
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      try {
        if (statSync(p).isDirectory()) walk(p);
        else if (/^ti\.exe$/i.test(e)) found.push(p);
      } catch {
        /* unreadable entry */
      }
    }
  };
  walk(root);
  if (!found.length) {
    throw new Error(
      `TI.EXE not found under ${root}/ (expected e.g. <lang>/titanic1/install/bin/ti.exe) — set TAOOT_TIEXE to override`,
    );
  }
  // the 16-bit installer's payload first, then anything else, deterministically
  const rank = (p: string): number => (/[\\/]bin[\\/]/i.test(p) ? 0 : /[\\/]binx[\\/]/i.test(p) ? 1 : 2);
  /**
   * ...and the ENGLISH tree first, because the recovered addresses come from that
   * build and no other. The localised discs ship their own builds — de/BIN is
   * 463,872 bytes against en/BIN's 461,312 — so every hardcoded VA in the RE
   * tools lands somewhere else in them. This used to sort on the path alone, which
   * put `de/` first alphabetically, and the failure was silent in the worst way:
   * `disasmcmd.mts` looks its handler up through jump tables at fixed addresses,
   * read garbage that wasn't code, and reported "no handler found in dispatch
   * tables" — indistinguishable from a command nobody has located yet. Measured:
   * `disasmcmd calcvectx` yields 35 instructions against en/BIN and nothing at all
   * against any of the other eleven candidates.
   */
  const lang = (p: string): number => (/[\\/]en[\\/]/i.test(p) ? 0 : 1);
  return found.sort((a, b) => rank(a) - rank(b) || lang(a) - lang(b) || a.localeCompare(b))[0];
}
