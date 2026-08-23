import type { ByteMapData } from "./schema";

/**
 * Hand-authored struct layouts — the byte-level half of <ByteMap>.
 *
 * These are the offset tables the format docs have always carried, moved into
 * data so the same field list can be READ as a table and SEEN as a map. They
 * are written by hand from the readers in `engine/src/df/` (each entry says
 * which one), because they describe a shape rather than one file's contents;
 * the whole-file maps under `maps/` are generated from real files instead.
 *
 * When a reader changes, these change with it — they are documentation, and the
 * `source` line names the file to check against.
 */
export const LAYOUTS: Record<string, ByteMapData> = {
  /** engine/src/df/container.ts — readContainerFile */
  "df-header": {
    title: "The DFile file header",
    subtitle: "1024 bytes, fixed — six fields and 992 bytes of nothing",
    total: 1024,
    // 64 bytes a row: every field the engine reads lands in the first HALF of
    // the first row, and the 15 rows under it are the padding. That IS the
    // shape of this header, and 16 rows of it fits on a screen.
    rowBytes: 64,
    source: "engine/src/df/container.ts (readContainerFile)",
    regions: [
      { at: 0, size: 4, kind: "data", type: "i32", label: "fourCC", detail: "a format/magic tag" },
      { at: 4, size: 4, kind: "data", type: "i32", label: "fileSize", detail: "total file size in bytes" },
      {
        at: 8,
        size: 12,
        kind: "gap",
        type: "—",
        label: "unused",
        detail: "12 bytes the reader skips; dfet calls them unknown[3]",
      },
      {
        at: 20,
        size: 4,
        kind: "data",
        type: "i32",
        label: "containerCount",
        detail: "how many containers (drawers) — and so how long the position table is",
      },
      {
        at: 24,
        size: 4,
        kind: "data",
        type: "i32",
        label: "type",
        detail: "0 = normal; 1 / 2 = variants whose gap drawers are named by gapWhere instead of detected",
      },
      {
        at: 28,
        size: 4,
        kind: "data",
        type: "i32",
        label: "gapWhere",
        detail: "which container index is the gap (type 1; type 2 marks that index and the one before it)",
      },
      {
        at: 32,
        size: 992,
        kind: "gap",
        type: "—",
        label: "padding",
        detail:
          "header/padding all the way to byte 1024, where the position table starts. Nothing in the engine reads it; writeContainerFile keeps the original bytes so a read→edit→write round trip does not invent any.",
      },
    ],
  },

  /** engine/src/df/container.ts — readContainerAt */
  "df-container-record": {
    title: "One container record",
    subtitle: "an 8-byte prefix and then the payload — here a 24 KB one, but the size is whatever the field says",
    total: 8 + 24576,
    rowBytes: 1024,
    source: "engine/src/df/container.ts (readContainerAt)",
    regions: [
      { at: 0, size: 4, kind: "structure", type: "i32", label: "id", detail: "the container's own ID" },
      {
        at: 4,
        size: 4,
        kind: "structure",
        type: "u32",
        label: "size",
        detail: "length of the payload in bytes — the only thing that says where this record ends",
      },
      {
        at: 8,
        size: 24576,
        kind: "media",
        type: "…",
        label: "data",
        detail:
          "`size` bytes of payload. What it MEANS is convention per format: a palette, a scene register, a script, one encoded picture, a slice of a sound. This example is a 24 KB frame; the eight bytes in front of it are the whole of the container format.",
      },
    ],
  },

  /** engine/src/df/stg.ts — FLAT_BY_VERSION[4], read in readStgFile */
  "stg-flat-record": {
    title: "A flat record (STG, DreamFactory 4)",
    subtitle: "46 bytes in container 0's flat table, one per full-screen UI layer",
    total: 46,
    rowBytes: 16,
    source: "engine/src/df/stg.ts (readStgFile)",
    regions: [
      {
        at: 0,
        size: 4,
        kind: "data",
        type: "i32",
        label: "condition",
        detail: "which condition gates this flat (0 on a flat that is always eligible)",
      },
      { at: 4, size: 2, kind: "gap", type: "—", label: "unused", detail: "not read" },
      {
        at: 6,
        size: 4,
        kind: "script",
        type: "i32",
        label: "locationScript",
        detail: "container holding this flat's script — its mousedown, enter and exit handlers",
      },
      {
        at: 10,
        size: 4,
        kind: "media",
        type: "i32",
        label: "locationFrame",
        detail: "container holding the flat's picture, in the common frame codec",
      },
      {
        at: 14,
        size: 4,
        kind: "data",
        type: "i32",
        label: "locationClickLogic",
        detail: "container holding the clickable regions: a 1028-byte header, a count, then 32-byte rects",
      },
      { at: 18, size: 4, kind: "gap", type: "—", label: "unused", detail: "not read" },
      { at: 22, size: 2, kind: "data", type: "i16", label: "height", detail: "flat height in pixels" },
      { at: 24, size: 2, kind: "data", type: "i16", label: "width", detail: "flat width in pixels" },
      { at: 26, size: 4, kind: "gap", type: "—", label: "unused", detail: "not read" },
      {
        at: 30,
        size: 16,
        kind: "data",
        type: "pstr(16)",
        label: "name",
        detail:
          "Pascal string: a length byte and up to 15 characters, junk after them. This is the name `gotoflat` asks for and `currentflat()` answers.",
      },
    ],
  },
};
