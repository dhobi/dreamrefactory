import { BinaryReader } from "./binary";

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
export function readContainerAt(data: Uint8Array, pos: number): Container {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const id = view.getInt32(pos, true);
  const size = view.getUint32(pos + 4, true);
  return { id, data: data.subarray(pos + RECORD_HEADER_SIZE, pos + RECORD_HEADER_SIZE + size) };
}

export function readContainerFile(data: Uint8Array): DFContainerFile {
  const r = new BinaryReader(data);
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
    containers.push(readContainerAt(data, positions[i]));
  }
  return { header, containers, headerRaw: data.slice(0, HEADER_SIZE) };
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
  view.setInt32(0, header.fourCC, true);
  view.setInt32(4, total, true);
  view.setInt32(20, containers.length, true);
  view.setInt32(24, header.type, true);
  view.setInt32(28, header.gapWhere, true);

  let pos = HEADER_SIZE + tableSize;
  for (let i = 0; i < containers.length; i++) {
    if (isGap(i)) {
      view.setUint32(HEADER_SIZE + i * 4, 0, true);
      continue;
    }
    view.setUint32(HEADER_SIZE + i * 4, pos, true);
    view.setInt32(pos, containers[i].id, true);
    view.setUint32(pos + 4, containers[i].data.length, true);
    out.set(containers[i].data, pos + RECORD_HEADER_SIZE);
    pos += RECORD_HEADER_SIZE + containers[i].data.length;
  }
  return out;
}
