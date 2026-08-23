/**
 * The data behind a <ByteMap> — one shape for two very different scales:
 *
 *   - a hand-authored STRUCT layout, byte by byte (the 1024-byte DFile header,
 *     a 46-byte flat record), written out in `layouts.ts`;
 *   - a whole REAL FILE's container map, offsets and roles pulled out of an
 *     actual .SET/.STG/.MOV by `tools/blockmap.ts` and committed as JSON.
 *
 * Both are "a run of bytes, each stretch of which is for something", so both
 * render either as a table (the offset tables these docs have always had) or as
 * a block map. The component owns the switch; this file owns the shape and the
 * few numbers both the tool and the component have to agree on.
 */

/** One labelled stretch of bytes. `at`/`size` are the only required geometry. */
export interface ByteRegion {
  /** byte offset from the start of the mapped range */
  at: number;
  /** length in bytes */
  size: number;
  /** which family of thing this is — picks the colour, see {@link KINDS} */
  kind: ByteKind;
  /** short name, shown inside the block when it is wide enough */
  label: string;
  /** what it is FOR — the sentence the hover exists to show */
  detail?: string;
  /** field type for struct layouts (`i32`, `u32`, `4×i16`, …), table view only */
  type?: string;
  /**
   * Which container this region IS, when it is one. The stable name for a
   * region — region indices shift when {@link fillHoles} inserts a hole, and
   * every cross-reference in these formats is spelled as a container number
   * anyway.
   */
  container?: number;
  /**
   * The container whose table or field POINTS AT this one.
   *
   * A DF file is a graph, and the graph is the interesting part: container 0
   * names the registers, a register names the scenes, a scene names its views,
   * a view names its hotspots. The pointer itself is four bytes inside somebody
   * else's payload — far too small to see at file scale — so the map draws the
   * relation between the two CONTAINERS instead, which is the same fact at a
   * size a reader can hover.
   */
  parent?: number;
  /**
   * A second encoding inside one family, for the case a hue cannot carry:
   * audio chunks and picture frames are both `media`, and a hatch tells them
   * apart without spending a colour that would not survive the CVD gates.
   */
  texture?: "hatch";
}

/**
 * Deliberately FIVE families, three of them coloured.
 *
 * The colours come from the data-viz palette's first three categorical slots,
 * which are the ones that clear the all-pairs CVD and normal-vision gates in
 * both light and dark. A byte map is read by matching a block against a legend
 * swatch, so every pair is an adjacent pair — a sixth hue would look richer and
 * be less legible. Subtypes inside a family (audio inside `media`) get a
 * texture rather than a hue, and the hover and the table view carry the rest.
 */
export type ByteKind = "structure" | "data" | "script" | "media" | "gap";

export const KINDS: Record<ByteKind, { label: string; hint: string }> = {
  structure: { label: "Skeleton", hint: "the header and the position table — the cabinet, not the drawers" },
  data: { label: "Tables & records", hint: "registers, index tables, palettes, decoded structures" },
  script: { label: "Scripts", hint: "compiled script token streams" },
  media: { label: "Pictures & sound", hint: "encoded frames, Z layers, audio chunks" },
  gap: { label: "Gap / padding", hint: "reserved drawer numbers and unaccounted bytes" },
};

export interface ByteMapData {
  /** what is being mapped ("LNGHALL.SET", "The DFile file header") */
  title: string;
  /** one line under the title: size, container count, provenance */
  subtitle?: string;
  /** total length of the mapped range in bytes */
  total: number;
  /** bytes per row; omitted means "let {@link autoRowBytes} decide" */
  rowBytes?: number;
  regions: ByteRegion[];
  /** where the numbers came from, shown as a footnote under the map */
  source?: string;
}

/**
 * How many bytes a row is worth.
 *
 * The block map only says anything if a typical block is a legible slice of a
 * row and the whole thing still fits on a screen, so the row is sized from the
 * TOTAL rather than from the blocks: aim for ~24 rows and snap to a power of
 * two, which is how anyone reading a byte map already thinks about sizes (1 KB,
 * 64 KB, 1 MB). It lands on 4 KB rows for a 113 KB stage, 64 KB rows for a
 * 1.4 MB set and 1 MB rows for a 33 MB one — the unit the file's own scale
 * asks for, which is the point.
 */
export function autoRowBytes(total: number): number {
  const target = Math.max(16, total / 24);
  const pow = Math.round(Math.log2(target));
  return 2 ** Math.min(24, Math.max(4, pow));
}

/** `0x0001_0000`-ish, but short: the gutter label down the left edge */
export function hexOffset(at: number, total: number): string {
  const digits = Math.max(4, Math.ceil(Math.log2(Math.max(total, 1)) / 4));
  return `0x${at.toString(16).toUpperCase().padStart(digits, "0")}`;
}

/** 1024 → "1 KB", 1386496 → "1.32 MB", 8 → "8 B" */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) {
    const kb = n / 1024;
    return `${kb < 10 ? kb.toFixed(2) : Math.round(kb)} KB`;
  }
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(2) : Math.round(mb)} MB`;
}

/**
 * Sort the regions, and make the map cover every byte: anything no region
 * claims becomes a `gap` block, so "what is the rest of this file?" is a
 * question the picture answers instead of one it hides. A struct layout gets
 * this for free — the padding at the end of the DFile header is exactly such a
 * hole.
 */
export function fillHoles(regions: ByteRegion[], total: number): ByteRegion[] {
  const sorted = [...regions].filter((r) => r.size > 0).sort((a, b) => a.at - b.at);
  const out: ByteRegion[] = [];
  let at = 0;
  const hole = (from: number, to: number): ByteRegion =>
    to - from < ALIGNMENT_SLACK
      ? {
          at: from,
          size: to - from,
          kind: "gap",
          label: "padding",
          detail: "slack before the next record — containers start on an alignment boundary",
        }
      : {
          at: from,
          size: to - from,
          kind: "gap",
          label: "unmapped",
          detail: "no region claims these bytes — padding, or something this port has not named yet",
        };
  for (const r of sorted) {
    if (r.at > at) out.push(hole(at, r.at));
    out.push(r);
    at = Math.max(at, r.at + r.size);
  }
  if (at < total) out.push(hole(at, total));
  return out;
}

/**
 * Under this, a hole between two claimed regions is the alignment slack every
 * DF file leaves in front of a container record rather than an open question
 * about the format. A real file has one per container — a hundred-odd of them —
 * and calling each one "unmapped" would bury the handful that are.
 */
const ALIGNMENT_SLACK = 512;
