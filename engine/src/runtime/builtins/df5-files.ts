import { ScriptError, Value } from "../interp";
import { BuiltinCtx } from "./context";
import { v5Registrar } from "./df5";
import type { Df5Disk } from "../df5-disk";

/** names as 0x469110 compares them: same length, letters folded */
const same = (a: string, b: string): boolean => a.length === b.length && a.toLowerCase() === b.toLowerCase();

/** 0x469500: a path's volume, everything before its first `:` (all of it with none) */
export const df5VolumeName = (path: string): string => {
  const k = path.indexOf(":");
  return k < 0 ? path : path.slice(0, k);
};
/** 0x469530: a path's last name, everything after its last `:`, `/` or `\` */
export const df5FileName = (path: string): string => path.slice(Math.max(path.lastIndexOf(":"), path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

const CR = "\r";

/** a script string is bytes, one per character */
const toBytes = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

/** `copylocal`'s cache: the 32 records at [0x4c2c98], 0x208 bytes each */
interface CacheEntry {
  /** +0: the order it was made in, from 10 (0x40f37d) */
  seq: number;
  /** +4: the progress flag it was copied with */
  progress: number;
  /** +8: the copy */
  dst: string;
  /** +0x108: what it is a copy of */
  src: string;
}

const int = (cmd: string, v: Value | undefined): number => {
  if (typeof v !== "number") throw new ScriptError(0xe, `${cmd}: ${String(v)} is not an integer`);
  return v | 0;
};
// 0x410560: a string, or 0xe
const str = (cmd: string, v: Value | undefined): string => {
  if (typeof v !== "string") throw new ScriptError(0xe, `${cmd}: ${String(v)} is not a string`);
  return v;
};
// a v5 boolean is 1/0, so `cmp word [arg], 2` can only turn a string away here
const bool = (cmd: string, v: Value | undefined): number => {
  if (typeof v === "string" || v === undefined) throw new ScriptError(0xe, `${cmd}: ${String(v)} is not a boolean`);
  return v ? 1 : 0;
};

/**
 * DreamFactory 5's file, folder, volume and registry commands, each read out
 * of `RedJack.exe` (`redjack/tools/rjdis.mts cmd NAME`), over the stand-in
 * machine in {@link Df5Disk} (`session.df5Disk`). Every one answers only in a
 * v5 game.
 *
 * Paths are the scripts' Mac-style ones (`RJDisk1:local 1:bar.trak`), which the
 * exe turns into Windows paths at each call (0x490550); {@link Df5Disk.locate}
 * does the same.
 */
export function registerDf5FilesBuiltins(ctx: BuiltinCtx): void {
  registerListings(ctx);
  registerFileOps(ctx);
  registerCopyLocal(ctx);
  registerTextFile(ctx);
  registerRegistry(ctx);
}

/**
 * buildfilenames (folder): two lists made afresh, the folder's files at
 * [0x4dffbc] (count [0x4dffb0]) and its folders at [0x4dffb8] ([0x4dffb4]),
 * each name a Pascal string in a 256-byte slot (0x43efe0). The search is
 * `folder @ "*.*"` (0x48d330), so `folder` is a prefix: a path that does not
 * end in `:` lists the names in its parent that start with its last part.
 * 0x48d330 steps over `.` and `..` to the first entry; the loop then leaves
 * out any name that starts with a dot. A folder that is not there leaves both
 * lists empty, and is not an error.
 */
function registerListings(ctx: BuiltinCtx): void {
  const { session } = ctx;
  const r5 = v5Registrar(ctx);
  const disk = (): Df5Disk => session.df5Disk;
  const files: string[] = [];
  const folders: string[] = [];
  r5("buildfilenames", (_i, [path]) => {
    const p = str("buildfilenames", path);
    files.length = 0;
    folders.length = 0;
    for (const e of disk().list(p) ?? []) {
      if (e.name === "" || e.name.startsWith(".")) continue;
      (e.dir ? folders : files).push(e.name.slice(0, 255));
    }
    return 0;
  });
  // countfilenames (), countfoldernames (): how many (0x43f1b0, 0x43f280)
  r5("countfilenames", () => files.length);
  r5("countfoldernames", () => folders.length);
  // indextofilename (n), indextofoldername (n): the n-th, from 1, 0xa outside
  // (0x43f1e0, 0x43f2b0)
  const indexed = (cmd: string, list: string[]) =>
    r5(cmd, (_i, [n]) => {
      const k = int(cmd, n);
      if (k < 1 || k > list.length) throw new ScriptError(0xa, `${cmd} (${k}): ${list.length}`);
      return list[k - 1];
    });
  indexed("indextofilename", files);
  indexed("indextofoldername", folders);
}

/** deletefile, and what a path says: its volume, its name, the space on its disk */
function registerFileOps(ctx: BuiltinCtx): void {
  const { session } = ctx;
  const r5 = v5Registrar(ctx);
  const disk = (): Df5Disk => session.df5Disk;
  /**
   * deletefile (path) (0x43ef20): 0x48ceb0 first — not there is 0x2a, there
   * but not openable (a folder: CreateFileA without backup semantics fails) is
   * 0x31. Then the read-only bit cleared (0x48d760) and DeleteFileA (0x48cd90),
   * neither result looked at, so a file on a CD stays and nothing is said.
   */
  r5("deletefile", (_i, [path]) => {
    const p = str("deletefile", path);
    const st = disk().stat(p);
    if (!st) throw new ScriptError(0x2a, `deletefile: no ${JSON.stringify(p)}`);
    if (st.busy) throw new ScriptError(0x31, `deletefile: ${JSON.stringify(p)} cannot be opened`);
    disk().remove(p);
    return 0;
  });

  // volumename (path), filename (path): string work, no Windows (0x43edf0 →
  // 0x469500, 0x43ee40 → 0x469530)
  r5("volumename", (_i, [path]) => df5VolumeName(str("volumename", path)));
  r5("filename", (_i, [path]) => df5FileName(str("filename", path)));
  /**
   * diskspace (path) (0x43ee90): the free bytes on the path's volume —
   * `volumename (path) @ ":"` to 0x48cdd0, which asks GetDiskFreeSpaceA for
   * that drive's root and clamps the product to 0x7fffffff; 0 where it fails.
   * A CD has none; the hard disk's is the stand-in's (Df5Disk.freeSpace).
   */
  r5("diskspace", (_i, [path]) => disk().freeSpace(df5VolumeName(str("diskspace", path)) + ":"));
}

/**
 * copylocal (name, folder, progress, cache) (0x4183c0): `name` is looked for
 * as `path (n) @ name` for n = 1..8 — slot 0 is skipped — and the first that
 * 0x48ceb0 finds is copied to `folder @ name` by 0x40f3d0; none found is
 * false. Both flags must be booleans (0xe). The answer is a boolean.
 *
 * 0x40f3d0, in order:
 * - the source not there: false; the copy already there: true, untouched;
 * - the free space where the copy goes (0x48cdd0) fails: false;
 * - with `cache`, a source on any volume but `currentcd ()`'s (0x4c7600,
 *   compared by 0x469110): false;
 * - then, until the source fits in the free space less 30 MiB (0x1e00000) and
 *   — with `cache` — one of the 32 cache records is empty: the cached copy
 *   made first (lowest order number) that is still there and can be opened is
 *   deleted and its record emptied; none left to delete is false;
 * - the copy made in 8 KiB pieces, behind a PROGRESS dialog with `progress`
 *   (cancelling it deletes the copy and answers false — there is no dialog
 *   here, so nothing cancels);
 * - with `cache`, a record of it (order number, progress flag, copy, source).
 *
 * The cache's copies are deleted as the game quits (0x40f300), so here they
 * are transient: kept for the session, never persisted. A copy of a disc file
 * is kept as the name of what it copies, not the bytes again. The port reads
 * every file by its name, so a copy changes what the game loads not at all;
 * what it changes is what the scripts see: the answer, `diskspace`, and the
 * copies a listing finds.
 */
function registerCopyLocal(ctx: BuiltinCtx): void {
  const { session } = ctx;
  const r5 = v5Registrar(ctx);
  const disk = (): Df5Disk => session.df5Disk;
  const cache: (CacheEntry | null)[] = new Array(32).fill(null);
  let seq = 10;
  const copy = (src: string, dst: string, progress: number, cached: number): boolean => {
    const d = disk();
    const from = d.stat(src);
    if (!from) return false;
    if (d.stat(dst)) return true;
    if (cached && !same(df5VolumeName(src), session.mountedCd)) return false;
    const size = from.size;
    let slot = 0;
    for (;;) {
      const free = d.freeSpace(dst) - 0x1e00000;
      slot = cached ? cache.indexOf(null) : 0;
      if (size <= free && slot >= 0) break;
      let victim = -1;
      let lowest = 0x7fffffff;
      cache.forEach((e, k) => {
        if (!e || e.seq >= lowest) return;
        const st = d.stat(e.dst);
        if (!st || st.busy) return;
        victim = k;
        lowest = e.seq;
      });
      if (victim < 0) return false;
      d.remove(cache[victim]!.dst);
      cache[victim] = null;
    }
    const hd = d.hdFile(src);
    const ok = d.write(dst, {
      bytes: hd?.bytes ?? null,
      copyOf: hd ? hd.copyOf : d.discFile(src),
      size,
      transient: cached !== 0,
    });
    // CreateFileA failing on the copy is an assertion in Dfsp.c (0x40f6e0)
    if (!ok) {
      session.onLog(`copylocal: ${dst} cannot be written (RedJack.exe asserts, Dfsp.c)`);
      return false;
    }
    if (cached) cache[slot] = { seq: seq++, progress, dst, src };
    return true;
  };
  r5("copylocal", (i, [name, folder, progress, cached]) => {
    const n = str("copylocal", name);
    const to = str("copylocal", folder);
    const p = bool("copylocal", progress);
    const c = bool("copylocal", cached);
    for (let k = 1; k <= 8; k++) {
      const src = session.pathSlots[k] + n;
      if (disk().stat(src)) return i.bool(copy(src, to + n, p, c));
    }
    return i.bool(false);
  });
}

/**
 * The text file: one buffer at [0x4c2a84], [0x4c2a80] bytes long, its lines
 * ended by CR alone (txed.c). Read in, a CR LF is a CR, a lone LF a CR and an
 * LF as the file's first byte nothing (0x48dfe0); written out, every CR is
 * CR LF (0x48e250).
 */
function registerTextFile(ctx: BuiltinCtx): void {
  const { session } = ctx;
  const r5 = v5Registrar(ctx);
  const disk = (): Df5Disk => session.df5Disk;

  /** a file's bytes, from the hard disk or, by its name, from the disc it is on */
  const readFile = async (path: string): Promise<Uint8Array | null> => {
    const st = disk().stat(path);
    if (!st || st.busy) return null;
    const hd = disk().hdFile(path);
    if (hd?.bytes) return hd.bytes;
    const onDisc = hd ? hd.copyOf : disk().discFile(path);
    if (!onDisc) return null;
    // the file index is by basename (a disc's one repeated name, death.move,
    // is served from the mounted disc)
    const base = onDisc.split("/").pop()!;
    if (!session.files(base)) await session.ensureFile(base);
    return session.files(base);
  };

  let text = "";
  /**
   * opentextfile (path) (0x40aef0): the file read into the buffer (0x48df80 →
   * 0x48d640). A file that will not open leaves the buffer as it was, and is
   * not an error. With "" the exe asks with an Open dialog (0x48de70); there
   * is none here, so the stand-in is the player cancelling it.
   */
  r5("opentextfile", async (_i, [path]) => {
    const p = str("opentextfile", path);
    if (p === "") return;
    const bytes = await readFile(p);
    if (!bytes) return;
    let out = "";
    for (let k = 0; k < bytes.length; k++) {
      const b = bytes[k];
      if (b === 0x0a) {
        if (k > 0 && bytes[k - 1] !== 0x0d) out += CR;
      } else out += String.fromCharCode(b);
    }
    text = out;
  });
  /**
   * savetextfile (path) (0x40afa0): the file deleted and made again (0x48df20,
   * Mac type TEXT/ttxt) and the buffer written. A file that cannot be made — on
   * a CD — writes nothing and is not an error. With "" the exe asks with a
   * Save dialog defaulting to "newfile" (0x48ddd0): cancelled here, as above.
   */
  r5("savetextfile", (_i, [path]) => {
    const p = str("savetextfile", path);
    if (p === "") return;
    const bytes = toBytes(text.replaceAll("\r", "\r\n"));
    disk().write(p, { bytes, copyOf: null, size: bytes.length, transient: false });
  });
  // cleantextfile (): the buffer emptied (0x40b080)
  r5("cleantextfile", () => {
    text = "";
    return 0;
  });
  /**
   * addtextstring (line, n) (0x40b0d0): line n (from 1) replaced by `line`. An
   * n below 1, or one the scan does not reach, appends instead — after a CR
   * unless the buffer is empty. The scan finds line n where a CR has just
   * been counted and a byte is still to come, so a buffer ending in CR has no
   * empty last line to replace.
   */
  r5("addtextstring", (_i, [line, n]) => {
    const s = str("addtextstring", line);
    const k = int("addtextstring", n);
    const at = lineStart(k);
    if (at < 0) {
      text = text.length > 0 ? text + CR + s : s;
      return 0;
    }
    let end = at;
    while (end < text.length && text[end] !== CR) end++;
    text = text.slice(0, at) + s + text.slice(end);
    return 0;
  });
  /** where line n starts, as 0x40b18b and 0x41b1ac scan for it; -1 not reached */
  const lineStart = (n: number): number => {
    if (n <= 0) return -1;
    let line = 1;
    for (let k = 0; k < text.length; k++) {
      if (line === n) return k;
      if (text[k] === CR) line++;
    }
    return -1;
  };
  // counttextstrings (): 0 for an empty buffer, else one more than its CRs (0x41b0b0)
  r5("counttextstrings", () => (text.length ? text.split(CR).length : 0));
  /**
   * indextotextstring (n) (0x41b140): line n, at most 255 bytes of it, up to
   * its CR. An empty buffer, n below 1 or a line the scan does not reach is
   * 0xa — so a buffer ending in CR has one more line by `counttextstrings`
   * than this will give.
   */
  r5("indextotextstring", (_i, [n]) => {
    const k = int("indextotextstring", n);
    const at = lineStart(k);
    if (at < 0) throw new ScriptError(0xa, `indextotextstring (${k})`);
    const s = text.slice(at, at + 255);
    const cr = s.indexOf(CR);
    return cr < 0 ? s : s.slice(0, cr);
  });
}

/**
 * registrystring (name [, value]) and registrynumber (name [, n]): values
 * of `HKEY_CURRENT_USER\Software\RedJack` (the app name at 0x4ba198, "Software\"
 * at 0x4c1370), the key made by RegCreateKeyExA on every call. Two arguments
 * set the value, REG_SZ (0x46bd30) or REG_DWORD (0x46ba90); one reads it
 * (0x46c030 into 256 bytes, 0x46bec0 into 4), a value not there answering ""
 * or 0. The installer writes nothing under that key (its registry work in
 * SETUP.INS is the file types under Software\Classes and the uninstall
 * entry), so the key starts empty.
 *
 * A value of the other type is an assertion in puti.c (0xfa0, 0xf86), past
 * which the exe goes on with the bytes it read: a REG_DWORD read as a string
 * is its bytes up to a NUL; a REG_SZ read as a number is its bytes if the
 * string and its NUL fit in four, else RegQueryValueExA fails and it is 0.
 */
function registerRegistry(ctx: BuiltinCtx): void {
  const { session } = ctx;
  const r5 = v5Registrar(ctx);
  const disk = (): Df5Disk => session.df5Disk;
  r5("registrystring", (_i, args) => {
    const name = str("registrystring", args[0]);
    if (args.length >= 2) {
      disk().setRegistry(name, str("registrystring", args[1]));
      return 0;
    }
    const v = disk().registry.get(name.toLowerCase())?.value;
    if (v === undefined) return "";
    if (typeof v === "string") return v;
    session.onLog(`registrystring: ${name} is a number (RedJack.exe asserts, puti.c)`);
    const b = [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    const nul = b.indexOf(0);
    return String.fromCharCode(...(nul < 0 ? b : b.slice(0, nul)));
  });
  r5("registrynumber", (_i, args) => {
    const name = str("registrynumber", args[0]);
    if (args.length >= 2) {
      disk().setRegistry(name, int("registrynumber", args[1]));
      return 0;
    }
    const v = disk().registry.get(name.toLowerCase())?.value;
    if (v === undefined) return 0;
    if (typeof v === "number") return v | 0;
    if (v.length + 1 > 4) return 0;
    session.onLog(`registrynumber: ${name} is a string (RedJack.exe asserts, puti.c)`);
    const b = toBytes(v);
    return (b[0] ?? 0) | ((b[1] ?? 0) << 8) | ((b[2] ?? 0) << 16);
  });
}
