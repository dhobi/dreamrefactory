/**
 * The scaffolding every DF *writer* needs: a container accumulator and the
 * little-endian field writers, so a per-format builder is nothing but its own
 * layout.
 *
 * The readers in this directory answer "what is in these bytes". The `*-build.ts`
 * modules beside them answer the opposite question — "what bytes say this" — and
 * they exist for two reasons:
 *
 *  - **The editors' contract is a round trip.** Their tests
 *    (taoot/tests/auto/*-editor.ts) check that reading and writing a file preserves it
 *    and that one edit moves one field. A fixture hand-laid by the test itself
 *    only ever proved the edits worked on bytes the test chose; built by the
 *    library, the same tests exercise the write path the editors export through.
 *  - **Authoring is a real use.** `public/lang.stg`, the language chooser, is a
 *    stage this project wrote from nothing (taoot/tools/mklangstg.ts) and the engine
 *    opens it like any shipped file. Nothing stops the other formats being used
 *    the same way; the STG one just got there first.
 *
 * What a builder does NOT do is invent content. Art, audio samples and script
 * bytes come from the caller — `encodeFrame`, `encodeShpFrame`,
 * `encodeAudioContainer` and `compileScript` are the encoders that make those,
 * and a builder only places them and points at them.
 */
import { writePstrAt } from "./binary";
import { PC } from "./byte-order";
import { Container, ContainerRef, DFContainerFile, writeContainerFile } from "./container";

/** what `readContainerFile` finds in the header's fourCC slot */
const FOURCC = 0x00010000;

const view = (d: Uint8Array): DataView => new DataView(d.buffer, d.byteOffset, d.byteLength);

/** int16, little-endian — the size most record fields are */
export const i16 = (d: Uint8Array, off: number, v: number): void => view(d).setInt16(off, v, true);

/** int32, little-endian — counts, and every container pointer */
export const i32 = (d: Uint8Array, off: number, v: number): void => view(d).setInt32(off, v, true);

/** uint16, little-endian */
export const u16 = (d: Uint8Array, off: number, v: number): void => view(d).setUint16(off, v, true);

/**
 * A double — **big-endian**, unlike everything else here. The engine's Mac
 * heritage, matching dfet's `swapEndians()`; world positions and rotations are
 * stored this way.
 */
export const f64 = (d: Uint8Array, off: number, v: number): void =>
  view(d).setFloat64(off, v, false);

/**
 * A pascal string: the length byte, then the characters. For a field of known
 * size, pass it — the rest is then zero-filled and the string clamped, which is
 * what {@link writePstrAt} does and what a record with a fixed name field needs.
 * Without one, exactly `1 + s.length` bytes are written (fine in a freshly
 * allocated container, which is all zeroes).
 */
export function pstr(d: Uint8Array, off: number, s: string, field?: number): void {
  writePstrAt(d, off, s, field ?? s.length);
}

/**
 * Containers, in the order they will be written, with their indices handed back
 * as they are allocated — which is how every DF format cross-references
 * ({@link ContainerRef} is "the data is in container N").
 *
 * Container 0 is conventionally the file's header chunk and is usually
 * {@link reserve}d first, then filled in at the end once the pointers it holds
 * are known.
 */
export class ContainerBuilder {
  private readonly containers: Container[] = [];

  /** append a container holding `data`, and answer where it landed */
  add(data: Uint8Array): ContainerRef {
    this.containers.push({ id: this.containers.length, data });
    return this.containers.length - 1;
  }

  /**
   * Allocate a zeroed container of `size` bytes and hand back both its index and
   * its bytes, for a header/table that has to be written after the things it
   * points at exist.
   */
  reserve(size: number): { loc: ContainerRef; data: Uint8Array } {
    const data = new Uint8Array(size);
    return { loc: this.add(data), data };
  }

  /**
   * A dummy "gap" container. The shipped files carry them and the reader has a
   * path for them (a type-0 container whose position is 0), so a builder that can
   * emit one lets the round-trip tests cover that path.
   */
  gap(): ContainerRef {
    this.containers.push({ id: this.containers.length, data: new Uint8Array(8), gap: true });
    return this.containers.length - 1;
  }

  get count(): number {
    return this.containers.length;
  }

  /** the container file, ready for {@link writeContainerFile} */
  finish(): DFContainerFile {
    return {
      header: {
        fourCC: FOURCC,
        fileSize: 0, // the writer patches it
        containerCount: this.containers.length,
        type: 0,
        gapWhere: 0,
      },
      containers: this.containers,
      headerRaw: new Uint8Array(1024),
      // the field writers above (i16/i32/u16) are little-endian, so what a
      // builder makes is a PC file — there is no Mac WRITE path and no caller
      // that wants one
      order: PC,
    };
  }

  /** the container file, serialized */
  bytes(): Uint8Array {
    return writeContainerFile(this.finish());
  }
}

/** a name that would not fit its field is a bug in the caller, not a warning */
export function checkName(kind: string, name: string, field: number): void {
  if (!name.length) throw new Error(`${kind} needs a name`);
  if (name.length > field) {
    throw new Error(`${kind} name "${name}" is longer than the ${field}-character field`);
  }
}

/**
 * The palette block every format with its own colour table carries:
 * `{i16 index, i16 rgb[3]}` per entry, with the usable 8-bit channel value in
 * each int16's HIGH byte (see `paletteToRGBA`). Input is RGB triples.
 *
 * Index 0 renders black and — in a 256-entry table — index 255 renders white no
 * matter what the bytes say, because the reader forces both; a palette that cares
 * should say so itself rather than rely on that.
 */
export function paletteBlock(rgb: ArrayLike<number>, entries = 256): Uint8Array {
  if (rgb.length > entries * 3) {
    throw new Error(`palette has more than ${entries} entries`);
  }
  const d = new Uint8Array(entries * 8);
  for (let e = 0; e < entries; e++) {
    i16(d, e * 8, e);
    for (let c = 0; c < 3; c++) i16(d, e * 8 + 2 + c * 2, ((rgb[e * 3 + c] ?? 0) & 0xff) << 8);
  }
  return d;
}

/**
 * A script container holding nothing but a line break — the empty script, for a
 * slot the format requires but the caller has nothing to put in. Real handlers
 * come from `compileScript` (engine/src/df/script-asm.ts).
 */
export function emptyScript(): Uint8Array {
  const d = new Uint8Array(16);
  u16(d, 0, 6); // one `break` segment, then the zero terminator
  return d;
}
