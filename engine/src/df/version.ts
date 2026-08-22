/**
 * Which DreamFactory a file was written by, and how to find out.
 *
 * Cyberflix shipped this engine at least twice: *Dust: A Tale of the Wired West*
 * (1995) writes **version 1**, *Titanic: Adventure Out of Time* (1996) writes
 * **version 4**. Every format's container 0 opens with the same i32 tag at the
 * same offset, which is the one piece of forwards planning in the whole file
 * suite — so the version is always ASKED rather than guessed.
 *
 * What actually changed between them is narrower than the version bump suggests.
 * Frozen across both: the container envelope (`container.ts`), the frame codec
 * (`image.ts`), the palette entry shape, the script bytecode AND its opcode
 * numbering (`opcodes.ts`), and the PUP and CST record layouts — v1 puppets and
 * casts read correctly through the v4 readers with no branch at all. What moved
 * is the per-format container-0 HEADER: v4 grew fields, so the palette sits at
 * 0xf2 in a v4 SET and 0x50 in a v1 one, and every offset after it shifted.
 *
 * And one thing changed in kind rather than in layout: a v1 SET has no turn
 * rings and no roads. See {@link file://./set-v1.ts}.
 */

/** the engine releases this port can read */
export type DfVersion = 1 | 4;

/** container 0 carries the tag as an i32 here, in every format and both versions */
export const VERSION_OFFSET = 0x02;

/**
 * The version tag of an already-opened container 0.
 *
 * Separate from {@link detectVersion} because the per-format readers have the
 * container in hand by the time they need to branch, and re-opening the file to
 * ask would mean parsing the envelope twice.
 */
export function versionOf(container0: Uint8Array): number {
  if (container0.length < VERSION_OFFSET + 4) return 0;
  return new DataView(container0.buffer, container0.byteOffset, container0.byteLength)
    .getInt32(VERSION_OFFSET, true);
}

/** is this a version this port knows how to read? */
export function isKnownVersion(v: number): v is DfVersion {
  return v === 1 || v === 4;
}

/**
 * The tag straight out of raw file bytes, without opening the envelope.
 *
 * For the callers that have to route BEFORE choosing a reader — the Dust shell
 * asking "is this CD v1 or v4?" — and for a diagnostic that wants to say what a
 * file is rather than fail on it. Container 0's record always begins at the
 * position the table's first slot names, so this is that one indirection and no
 * more.
 */
export function detectVersion(data: Uint8Array): number {
  if (data.length < 1024 + 4) return 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const pos = view.getUint32(1024, true);
  if (pos <= 1024 || pos + 8 + VERSION_OFFSET + 4 > data.length) return 0;
  return view.getInt32(pos + 8 + VERSION_OFFSET, true);
}
