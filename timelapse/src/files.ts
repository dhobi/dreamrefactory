import { RipFiles } from "@dreamfactory/engine/web/rip-files";
import { pageUrl } from "@dreamfactory/engine/web/page-url";
import { byCodeUnit } from "@dreamfactory/engine/order";

/**
 * The four Timelapse CDs as one `HostFiles` (a {@link RipFiles}) — what lets the real engine
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
const url = (path: string): string => pageUrl(path);

export class TimelapseFiles extends RipFiles {
  /** index the rip from the manifest the dev server and the build both publish */
  static async open(root = "gamefiles/"): Promise<TimelapseFiles> {
    const store = new TimelapseFiles();
    const res = await fetch(url("gamefiles.json"));
    const manifest: Record<string, number> = res.ok ? await res.json() : {};
    for (const path of Object.keys(manifest).sort(byCodeUnit)) {
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

  /**
   * Nothing to swap. `setDisc` is how a two-CD DreamFactory game follows its
   * BOOTFILE's `setpath(disk)`; Timelapse has four discs and switches between
   * them with `path(n, …)` inside its own `enterworld`, which this store cannot
   * see and does not need to — every disc is indexed at once.
   */
  setDisc(): void {
    // every disc is indexed already
  }

  activeEdition(): string {
    return "timelapse";
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
}
