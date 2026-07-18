import { BinaryReader } from "./binary";

/**
 * Every DreamFactory file is a sequence of "containers" indexed by a
 * position table that follows the 1024-byte file header.
 * Port of DFfile::readFileIntoMemory (dfet/libs/DFfile/DFfile.cpp).
 */
export interface Container {
  id: number;
  data: Uint8Array;
}

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
}

const HEADER_SIZE = 1024;
const EMPTY = new Uint8Array(8);

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
      containers.push({ id: i, data: EMPTY });
      continue;
    }
    const p = positions[i];
    const id = r.view.getInt32(p, true);
    const size = r.view.getUint32(p + 4, true);
    containers.push({ id, data: data.subarray(p + 8, p + 8 + size) });
  }
  return { header, containers };
}
