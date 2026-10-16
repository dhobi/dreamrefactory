import { byCodeUnit } from "../order";

/**
 * The machine a DreamFactory 5 game's file commands reach, as a stand-in for
 * the Windows calls RedJack.exe makes (engine/src/runtime/builtins/df5-files.ts
 * has the commands): the CDs, a hard disk the scripts can write to, and the
 * registry key the exe keeps its values under.
 *
 * ## The discs
 *
 * {@link setTree} is handed the rip as the page's manifest lists it, one path
 * per file under the game's root (`RJDisk1/local 1/bar.trak` → bytes), and each
 * top-level folder is a CD by that volume label. Every disc is in a drive at
 * once, as the page's file index has them (redjack/src/files.ts). The discs are
 * read-only, and a CD has no free space (`GetDiskFreeSpaceA` answers 0 free
 * clusters on CDFS).
 *
 * Names match in any case, as on Windows. A listing comes out in code-unit
 * order: a CD's Joliet directory records are kept sorted by their UCS-2 code
 * values, and `FindNextFileA` walks them in record order. That is the order
 * the disc would give, as far as the rip can know it — the original pressing's
 * own records are not in the rip.
 *
 * ## The hard disk
 *
 * Everything not on a disc volume. What RedJack.exe's path conversion
 * (0x490550 → 0x490680) does with a volume it cannot find is answer "" for it,
 * so `local:bar.trak` is `\bar.trak`, the current drive's root; a path with no
 * volume at all is relative to the current directory, which the stand-in puts
 * at `Program Files\RedJack` (where the installer's default puts the exe). The
 * port's `path (0)` is "", where the exe's is the bootfile's folder, so the
 * scripts' `path (0) @ "local:"` lands at the root here.
 *
 * Folders are not kept: a folder exists while a file is in it, and writing a
 * file anywhere on the disk succeeds. Free space is a stand-in of
 * {@link HD_FREE} less what the port's writes take. Nothing the installer put
 * on the disk is here (the install folder and its `local` copy of `local 1`):
 * with `path (0)` "" no script can name it.
 *
 * What a host persists ({@link snapshot}, {@link restore}, {@link onChange}) is
 * the files written for good and the registry. A copy `copylocal` makes into
 * its cache is not kept: RedJack.exe deletes every one of those as it quits
 * (0x40f300).
 */

/** the stand-in hard disk's free space before the port writes anything: 1 GiB */
export const HD_FREE = 0x40000000;
/** the stand-in current directory, where a path with no volume is */
export const HD_CWD = ["Program Files", "RedJack"];

/** a file on the stand-in hard disk */
export interface HdFile {
  /** its path's components, in the case they were written in */
  parts: string[];
  /** the bytes, or null for a copy of a disc file ({@link copyOf}) */
  bytes: Uint8Array | null;
  /**
   * a copy `copylocal` made of a disc file, by the disc path: the bytes are the
   * disc's own, so the copy is kept as the name of what it copied rather than a
   * second download of it
   */
  copyOf: string | null;
  size: number;
  /** in `copylocal`'s cache: deleted when the game quits, so never persisted */
  transient: boolean;
}

/** what a host keeps between visits */
export interface Df5DiskSnapshot {
  files: { parts: string[]; bytes: Uint8Array | null; copyOf: string | null; size: number }[];
  registry: { name: string; value: number | string }[];
}

/** where a path is: a disc and its tree path, or the hard disk */
export type Located =
  | { disc: true; vol: string; parts: string[] }
  | { disc: false; parts: string[] };

/** what `0x48ceb0` learns of a path: whether it is there, read-only, and can be opened */
export interface Stat {
  dir: boolean;
  readOnly: boolean;
  /** CreateFile (GENERIC_READ, no sharing) fails: a folder, here */
  busy: boolean;
  size: number;
}

export interface Listed {
  name: string;
  dir: boolean;
}

const lower = (s: string): string => s.toLowerCase();

export class Df5Disk {
  /** disc path, lowercased → its own spelling and size */
  private readonly discFiles = new Map<string, { path: string; size: number }>();
  /** disc folder, lowercased ("" is the drive list) → its entries by lowercased name */
  private readonly discDirs = new Map<string, Map<string, Listed>>();
  /** the hard disk, by lowercased path joined with `\` */
  readonly hd = new Map<string, HdFile>();
  /** `HKEY_CURRENT_USER\Software\RedJack`, by lowercased value name */
  readonly registry = new Map<string, { name: string; value: number | string }>();
  /** fired after anything a host persists has changed */
  onChange: (() => void) | null = null;

  /** the rip: each path under the game's root, `/`-separated, and its size */
  setTree(entries: Iterable<[string, number]>): void {
    this.discFiles.clear();
    this.discDirs.clear();
    for (const [path, size] of entries) {
      const parts = path.split("/").filter(Boolean);
      if (parts.length < 2) continue;
      this.discFiles.set(lower(parts.join("/")), { path: parts.join("/"), size });
      for (let k = 0; k < parts.length; k++) {
        const dir = lower(parts.slice(0, k).join("/"));
        let m = this.discDirs.get(dir);
        if (!m) {
          m = new Map();
          this.discDirs.set(dir, m);
        }
        const name = parts[k];
        if (!m.has(lower(name))) m.set(lower(name), { name, dir: k < parts.length - 1 });
      }
    }
  }

  /** a disc by its volume label, in its own spelling, or null */
  volume(label: string): string | null {
    return this.discDirs.get("")?.get(lower(label))?.name ?? null;
  }

  /**
   * A script's path, the way 0x490550 turns it into a Windows one: every `:` a
   * `\`; a path starting `::` a network path (here: the hard disk); otherwise
   * the text before the first `\` is a volume label, found among the drives by
   * 0x490680 (a CD here, else "" — the current drive's root); and a path with no
   * separator at all relative to the current directory.
   */
  locate(path: string): Located {
    const win = path.replaceAll(":", "\\");
    const split = (s: string): string[] => s.split(/[\\/]/).filter(Boolean);
    if (path.length > 2 && path.startsWith("::")) return { disc: false, parts: split(win) };
    const cut = win.indexOf("\\");
    if (cut < 0) return { disc: false, parts: [...HD_CWD, ...split(win)] };
    // the label is kept to 31 characters (0x4905f0)
    const vol = this.volume(win.slice(0, Math.min(cut, 31)));
    if (vol) return { disc: true, vol, parts: split(win.slice(cut)) };
    return { disc: false, parts: split(win.slice(cut)) };
  }

  private discPath(at: Located & { disc: true }): string {
    return [at.vol, ...at.parts].join("/");
  }
  private hdKey(parts: string[]): string {
    return lower(parts.join("\\"));
  }

  /** 0x48ceb0: GetFileAttributesA, then whether CreateFileA can open it; null when not there */
  stat(path: string): Stat | null {
    const at = this.locate(path);
    if (at.disc) {
      const key = lower(this.discPath(at));
      const f = this.discFiles.get(key);
      // CDFS marks every file read-only
      if (f) return { dir: false, readOnly: true, busy: false, size: f.size };
      if (this.discDirs.has(key)) return { dir: true, readOnly: true, busy: true, size: 0 };
      return null;
    }
    const key = this.hdKey(at.parts);
    const f = this.hd.get(key);
    if (f) return { dir: false, readOnly: false, busy: false, size: f.size };
    if (key === "" || [...this.hd.keys()].some((k) => k.startsWith(key + "\\")))
      return { dir: true, readOnly: false, busy: true, size: 0 };
    return null;
  }

  /** the disc path a path names, if it is a disc file */
  discFile(path: string): string | null {
    const at = this.locate(path);
    if (!at.disc) return null;
    return this.discFiles.get(lower(this.discPath(at)))?.path ?? null;
  }

  hdFile(path: string): HdFile | null {
    const at = this.locate(path);
    return at.disc ? null : (this.hd.get(this.hdKey(at.parts)) ?? null);
  }

  /** a file written to the disk; false on a disc, which is read-only */
  write(path: string, file: Omit<HdFile, "parts">): boolean {
    const at = this.locate(path);
    if (at.disc || !at.parts.length) return false;
    this.hd.set(this.hdKey(at.parts), { parts: at.parts, ...file });
    if (!file.transient) this.changed();
    return true;
  }

  /** DeleteFileA: false where it fails (a disc, or nothing there) */
  remove(path: string): boolean {
    const at = this.locate(path);
    if (at.disc) return false;
    const key = this.hdKey(at.parts);
    const f = this.hd.get(key);
    if (!f) return false;
    this.hd.delete(key);
    if (!f.transient) this.changed();
    return true;
  }

  /**
   * 0x48cdd0: the free space on the volume a path is on, or 0 for a path that
   * resolves to nothing at all — a CD has none, the hard disk {@link HD_FREE}
   * less what is on it
   */
  freeSpace(path: string): number {
    if (path === "") return 0;
    if (this.locate(path).disc) return 0;
    let used = 0;
    for (const f of this.hd.values()) used += f.size;
    return Math.max(0, HD_FREE - used);
  }

  /**
   * FindFirstFileA/FindNextFileA over `<dir>\<prefix>*.*`: every entry of the
   * folder whose name starts with the prefix (Win32's `*.*` also matches a name
   * with no dot). Null where FindFirstFileA fails: no such folder.
   */
  list(path: string): Listed[] | null {
    const at = this.locate(path + "*.*");
    const last = at.parts.at(-1) ?? "*.*";
    const prefix = lower(last.endsWith("*.*") ? last.slice(0, -3) : last);
    const dirParts = at.parts.slice(0, -1);
    const out: Listed[] = [];
    if (at.disc) {
      const entries = this.discDirs.get(lower([at.vol, ...dirParts].join("/")));
      if (!entries) return null;
      for (const e of entries.values()) if (lower(e.name).startsWith(prefix)) out.push(e);
      return out.sort((a, b) => byCodeUnit(a.name, b.name));
    }
    const dir = this.hdKey(dirParts);
    const seen = new Map<string, Listed>();
    let exists = dir === "";
    for (const f of this.hd.values()) {
      const p = f.parts;
      if (p.length <= dirParts.length || this.hdKey(p.slice(0, dirParts.length)) !== dir) continue;
      exists = true;
      const name = p[dirParts.length];
      if (!seen.has(lower(name))) seen.set(lower(name), { name, dir: p.length > dirParts.length + 1 });
    }
    if (!exists) return null;
    for (const e of seen.values()) if (lower(e.name).startsWith(prefix)) out.push(e);
    // NTFS keeps a folder in its upcased collation
    return out.sort((a, b) => byCodeUnit(a.name.toUpperCase(), b.name.toUpperCase()) || byCodeUnit(a.name, b.name));
  }

  setRegistry(name: string, value: number | string): void {
    this.registry.set(lower(name), { name, value });
    this.changed();
  }

  snapshot(): Df5DiskSnapshot {
    return {
      files: [...this.hd.values()]
        .filter((f) => !f.transient)
        .map((f) => ({ parts: f.parts, bytes: f.bytes, copyOf: f.copyOf, size: f.size })),
      registry: [...this.registry.values()],
    };
  }

  restore(s: Df5DiskSnapshot | null | undefined): void {
    if (!s) return;
    for (const f of s.files ?? []) this.hd.set(this.hdKey(f.parts), { ...f, transient: false });
    for (const r of s.registry ?? []) this.registry.set(lower(r.name), r);
  }

  private changed(): void {
    this.onChange?.();
  }
}
