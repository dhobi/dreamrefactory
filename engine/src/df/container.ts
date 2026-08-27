import { BinaryReader } from "./binary";
import { ByteOrder, PC, detectByteOrder, little } from "./byte-order";

/**
 * Every DreamFactory file is a sequence of "containers" indexed by a
 * position table that follows the 1024-byte file header.
 * Port of DFfile::readFileIntoMemory (dfet/libs/DFfile/DFfile.cpp).
 */
export interface Container {
  id: number;
  data: Uint8Array;
  /** true for the dummy gap containers (their `data` is a zeroed stand-in) */
  gap?: boolean;
}

/**
 * An index into {@link DFContainerFile.containers} — how every DF format
 * cross-references data ("the scene's view table is container N"). The per-
 * format readers name such fields in several inherited-from-dfet ways
 * (`location`, `locationViews`, `containerLoc`, …); they are all this one idea.
 */
export type ContainerRef = number;

export interface DFFileHeader {
  fourCC: number;
  fileSize: number;
  containerCount: number;
  /** 0 = default, 1/2 = variants with dummy gap containers */
  type: number;
  gapWhere: number;
}

export interface DFContainerFile {
  header: DFFileHeader;
  containers: Container[];
  /**
   * The original 1024-byte file header, kept verbatim so
   * {@link writeContainerFile} round-trips the fields this reader does not
   * interpret (unknown[3] and everything past offset 32).
   */
  headerRaw: Uint8Array;
  /**
   * Which way round this file's integers are ({@link file://./byte-order.ts}).
   *
   * Carried on the FILE rather than passed down every call because a per-format
   * reader takes a `DFContainerFile` and reaches into whichever containers it
   * likes: the question is answered once, at the envelope, and every field read
   * out of the thing afterwards inherits the answer. `"le"` on every rip in this
   * repository but Skull Cracker's, which is a Macintosh one.
   */
  order: ByteOrder;
}

/** the fixed file header; the container position table follows it */
export const HEADER_SIZE = 1024;
/** each container record starts with {i32 id, u32 size}, then the bytes */
export const RECORD_HEADER_SIZE = 8;
// 8 zero bytes (not 0) so downstream header peeks on a gap container never
// read out of bounds
const EMPTY = new Uint8Array(8);

/**
 * Copy-on-write one container and hand its bytes to `edit` — the shape every
 * editor edit that is not whole-container art takes (a name, a rectangle, a
 * stored degree). Containers are subarray views into the loaded file's buffer,
 * which must stay pristine, so the patch replaces the container it touches with
 * a copy; {@link writeContainerFile} then serializes the file with only those
 * bytes changed. False for a container that isn't there or is a gap — the table
 * that pointed at it said otherwise.
 */
export function patchContainerData(
  file: DFContainerFile,
  loc: number,
  edit: (d: Uint8Array) => void,
): boolean {
  const old = file.containers[loc];
  if (!old || old.gap) return false;
  const data = old.data.slice();
  edit(data);
  file.containers[loc] = { id: old.id, data };
  return true;
}

/** read the {id, size, bytes} container record at an absolute file position */
export function readContainerAt(data: Uint8Array, pos: number, order: ByteOrder = PC): Container {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const le = little(order);
  const id = view.getInt32(pos, le);
  const size = view.getUint32(pos + 4, le);
  return { id, data: data.subarray(pos + RECORD_HEADER_SIZE, pos + RECORD_HEADER_SIZE + size) };
}

/**
 * Open a container file.
 *
 * `order` is detected from the file itself when not given, which is what every
 * caller wants: nothing above this knows whether a rip came off a PC or a Mac,
 * and {@link detectByteOrder} answers from the header's own size field. Pass one
 * only to read a file whose header cannot be trusted to say — a builder's
 * output, or a hand-made fixture.
 */
export function readContainerFile(
  data: Uint8Array,
  order: ByteOrder = detectByteOrder(data),
): DFContainerFile {
  const r = new BinaryReader(data, 0, order);
  const fourCC = r.i32();
  const fileSize = r.i32();
  r.skip(12); // unknown[3]
  const containerCount = r.i32();
  const type = r.i32();
  const gapWhere = r.i32();
  const header: DFFileHeader = { fourCC, fileSize, containerCount, type, gapWhere };

  const positions = new Uint32Array(containerCount);
  r.seek(HEADER_SIZE);
  for (let i = 0; i < containerCount; i++) positions[i] = r.u32();

  const containers: Container[] = [];
  for (let i = 0; i < containerCount; i++) {
    const isGap =
      type === 1 ? i === gapWhere :
      type === 2 ? i === gapWhere - 1 || i === gapWhere :
      positions[i] <= HEADER_SIZE;
    if (isGap) {
      containers.push({ id: i, data: EMPTY, gap: true });
      continue;
    }
    containers.push(readContainerAt(data, positions[i], order));
  }
  return { header, containers, headerRaw: data.slice(0, HEADER_SIZE), order };
}

/**
 * Reserialize a container file — the export path of the browser editors
 * (editors/puppets.html, editors/tracks.html, editors/sets.html). Containers
 * are laid out sequentially after the position table; gap containers (per the header's type/gapWhere, or
 * a zero-length data on type 0) get position 0 and no record, which is exactly
 * what {@link readContainerFile} reads back as a gap. The original header bytes
 * are kept verbatim with the size/count fields patched, so unknown header
 * fields survive a read→edit→write round trip.
 */
export function writeContainerFile(file: DFContainerFile): Uint8Array {
  const { header, containers } = file;
  // whichever way round the file was read, it is written back the same way, so
  // an edit-and-export round trip is byte-identical on a Mac rip too
  const le = little(file.order ?? PC);
  const isGap = (i: number): boolean =>
    header.type === 1 ? i === header.gapWhere :
    header.type === 2 ? i === header.gapWhere - 1 || i === header.gapWhere :
    containers[i].gap === true;

  const tableSize = containers.length * 4;
  let total = HEADER_SIZE + tableSize;
  for (let i = 0; i < containers.length; i++) {
    if (!isGap(i)) total += RECORD_HEADER_SIZE + containers[i].data.length;
  }

  const out = new Uint8Array(total);
  out.set(file.headerRaw.subarray(0, HEADER_SIZE));
  const view = new DataView(out.buffer);
  view.setInt32(0, header.fourCC, le);
  view.setInt32(4, total, le);
  view.setInt32(20, containers.length, le);
  view.setInt32(24, header.type, le);
  view.setInt32(28, header.gapWhere, le);

  let pos = HEADER_SIZE + tableSize;
  for (let i = 0; i < containers.length; i++) {
    if (isGap(i)) {
      view.setUint32(HEADER_SIZE + i * 4, 0, le);
      continue;
    }
    view.setUint32(HEADER_SIZE + i * 4, pos, le);
    view.setInt32(pos, containers[i].id, le);
    view.setUint32(pos + 4, containers[i].data.length, le);
    out.set(containers[i].data, pos + RECORD_HEADER_SIZE);
    pos += RECORD_HEADER_SIZE + containers[i].data.length;
  }
  return out;
}
