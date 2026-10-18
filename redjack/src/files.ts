import { RipFiles, readManifest, ripName } from "@dreamfactory/engine/web/rip-files";
import { pageUrl } from "@dreamfactory/engine/web/page-url";
import { byCodeUnit } from "@dreamfactory/engine/runtime/order";

/**
 * The three RedJack CDs as one `HostFiles` (a {@link RipFiles}).
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
 * until the game has said. The fetching, the flights and the bar's arithmetic are
 * {@link RipFiles}'s, which ties each flight to the copy it is reading.
 */

/** the name the engine asks for → the name this rip ships it under */
const ALIASES: Record<string, string> = { bootfile: "bootfile.boot" };

export class RedJackFiles extends RipFiles {
  /** a name more than one disc carries → each disc's copy (1-based) */
  private readonly copies = new Map<string, Map<number, { url: string; size: number }>>();
  private disc = 1;
  /**
   * The discs as folders: each file's path under the root, `RJDisk1/local
   * 1/bar.trak`, and its size — what `buildfilenames` and the other file
   * commands list and look up (engine/src/runtime/df5-disk.ts)
   */
  readonly tree = new Map<string, number>();

  /** index the rip from the manifest the dev server and the build both publish */
  static async open(root = "gamefiles/"): Promise<RedJackFiles> {
    const store = new RedJackFiles();
    // through pageUrl, so the page runs from any directory
    const manifest = await readManifest(pageUrl("gamefiles.json"));
    /** which disc each name was first found on, while the index is built */
    const discOf = new Map<string, number>();
    for (const path of Object.keys(manifest).sort(byCodeUnit)) {
      if (!path.startsWith(root)) continue;
      const base = ripName(path);
      const disc = Number(/\/RJDisk(\d)\//i.exec(path)?.[1] ?? 0);
      if (disc) store.tree.set(path.slice(root.length), manifest[path]);
      const copy = { url: pageUrl(path), size: manifest[path] };
      if (store.urls.has(base)) {
        // a second disc's copy: kept, and served when that disc is mounted
        let byDisc = store.copies.get(base);
        if (!byDisc) {
          byDisc = new Map([[discOf.get(base) ?? 0, { url: store.urls.get(base)!, size: store.sizes.get(base)! }]]);
          store.copies.set(base, byDisc);
        }
        if (!byDisc.has(disc)) byDisc.set(disc, copy);
        continue;
      }
      // until the game names a disc, the lowest wins: the keys are sorted
      store.urls.set(base, copy.url);
      store.sizes.set(base, copy.size);
      discOf.set(base, disc);
    }
    return store;
  }

  /** the key a name is stored under, after the one alias this rip needs */
  protected override key(name: string): string {
    const k = name.toLowerCase();
    return ALIASES[k] ?? k;
  }

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

  /** the rooms, under v5's own extension */
  serverSetNames(): string[] {
    return [...this.urls.keys()].filter((n) => n.endsWith(".sett"));
  }
}
