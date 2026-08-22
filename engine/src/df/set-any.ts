import { detectVersion } from "./version";
import { readSetFile, type SetFile } from "./set";
import { readSetFileV1, type SetFileV1 } from "./set-v1";

/**
 * Open a SET without knowing which engine wrote it.
 *
 * A tagged union rather than one merged type, because the two are not the same
 * shape and flattening them would cost more than it saves: a v4 set has scenes
 * carrying turn RINGS joined by ROADS, a v1 set has a grid of cells joined by a
 * flat table in which turning and walking are the same record. Code that walks a
 * set has to know which it is holding — see the header of
 * {@link file://./set-v1.ts} — and a union makes the compiler ask.
 *
 * The version is READ, never guessed: both engines put the tag as an i32 at
 * container 0 + 0x02, which is the one field that never moved. {@link
 * detectVersion} reaches it through the position table without opening the whole
 * envelope, so routing costs one indirection.
 */
export type AnySetFile =
  | { version: 4; set: SetFile }
  | { version: 1; set: SetFileV1 };

export function readAnySetFile(data: Uint8Array): AnySetFile {
  const version = detectVersion(data);
  if (version === 4) return { version: 4, set: readSetFile(data) };
  if (version === 1) return { version: 1, set: readSetFileV1(data) };
  throw new Error(
    `SET container 0 reports version ${version}; this port reads 1 (Dust) and 4 (Titanic)`,
  );
}
