import { readMovFile, type MovFile } from "./mov";
import { movFileFromV1, readMovFileV1 } from "./mov-v1";
import { isMovV5, readMovFileV5 } from "./mov-v5";
import { detectVersion } from "./version";

/**
 * Open a MOV in the one shape the movie player drives, whichever engine wrote it:
 * the one place that chooses, for the player, the movie editor and the tools.
 *
 * Dust's films are DreamFactory 1, whose container 0 is not v4's with the fields
 * moved (mov-v1.ts), so they are read by their own reader and reshaped into the
 * v4 {@link MovFile}. RedJack's are DreamFactory 5, which {@link isMovV5} tells
 * by the container's kind, and mov-v5.ts reads straight into the same shape.
 * Anything else is Titanic's. Lunicus's (v0) carry no tag to tell them by, so a
 * caller that knows it holds one reads it with mov-v0.ts itself.
 */
export interface MovAsV4 {
  version: 1 | 4 | 5;
  mov: MovFile;
}

export function openMovFile(data: Uint8Array): MovAsV4 {
  if (detectVersion(data) === 1) return { version: 1, mov: movFileFromV1(readMovFileV1(data)) };
  if (isMovV5(data)) return { version: 5, mov: readMovFileV5(data) };
  return { version: 4, mov: readMovFile(data) };
}
