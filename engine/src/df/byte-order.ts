/**
 * Which way round a DreamFactory file's integers are, and how to find out.
 *
 * Every format this port reads was little-endian until *Skull Cracker* (1996),
 * whose disc is the other way round: same container envelope, same frame codec,
 * same MOV header at the same offsets — and every integer reversed.
 *
 * DreamFactory was written on a Mac, and its floats still say so: `binary.ts`'s
 * `f64be` exists because even a PC-authored file stores doubles big-endian, which
 * is what a converter that byte-swapped its INTS and forgot its floats leaves
 * behind. So big-endian ints are the unconverted form, and Skull Cracker's disc
 * is the one that never went through that step.
 *
 * ## It is a fact about the TITLE, not about the platform
 *
 * The tempting shorthand — Macintosh discs are big-endian, PC discs little — is
 * false, and this repository holds the counter-example. Titanic's Dutch release is
 * a hybrid disc: `nl/titanic1/INSTALL_MAC/` carries `Titanic`, a PowerPC PEF
 * executable, next to a `bootfile`, a `Local/` and a `Tour/` — and every one of
 * those data files is LITTLE-endian and reads with no flag at all. Titanic's
 * Macintosh build ran on converted data.
 *
 * Which is why detection asks the FILE and nothing above it is ever told what
 * platform a rip came off. The names {@link PC} and {@link MAC} below are
 * shorthand for the two orders as this repository met them — every disc here but
 * Skull Cracker's on one side, Skull Cracker's on the other — and not a claim that
 * either follows from a platform. A second Macintosh title could land on either
 * side, and so, for all this module knows, could a second Skull Cracker disc.
 *
 * ## What actually differs, which is less than "the file is byte-swapped"
 *
 * The 4 KB of structure this module was worked out against is field-for-field
 * identical between the two: a MOV's flag word is at container-0 +0x18 on both,
 * its frame count at +0x878, its 42-byte frame records at +0x87c with the height
 * at +8 and the width at +10. Pascal strings read forwards. Only the integers'
 * BYTES are reversed — this is not a file with its 32-bit words swapped, which
 * would have scrambled every name in it.
 *
 * One field is the exception and it is the version tag: `version.ts` reads an
 * i32 at container-0 +0x02 on a PC file, and on a Mac one the same 4 K of header
 * carries `00 04` at +0x00 instead. That single word looks word-swapped where
 * nothing else does — see {@link file://./version.ts}, which special-cases it
 * rather than pretending the rule is general.
 *
 * ## Why detection rather than a flag the caller passes
 *
 * Nothing above the container reader knows what platform a rip came off, and
 * the guess has to be made before a single field can be believed. The file
 * header's SIZE field answers it exactly: it holds the file's own length, so
 * exactly one of the two readings equals the bytes in hand. Measured across all
 * four rips in this repository — 5014 PC files and 111 Mac ones — it separates
 * them with nothing left over, and the four Skull Cracker files it declines are
 * the Finder's desktop database, the PowerPC application and the read-me, none
 * of which is a DreamFactory file.
 *
 * **Little-endian is tried first and wins ties**, which is the whole safety
 * argument: a file that read correctly before this module existed still reads
 * exactly as it did, and big-endian is reached only when the little-endian
 * answer is demonstrably wrong. Two files in the corpus are ambiguous
 * (`tour8.mov`, whose 657920 bytes are a palindrome in hex), and both are PC
 * files that go on being read as such.
 */

/** the two ways round a DreamFactory file's integers can be */
export type ByteOrder = "le" | "be";

/**
 * What every DreamFactory disc in this repository but Skull Cracker's is —
 * Titanic's Macintosh build included. A label for the order, not for a platform;
 * see the module comment.
 */
export const PC: ByteOrder = "le";
/** Skull Cracker's, and so far only Skull Cracker's */
export const MAC: ByteOrder = "be";

/** the file header's own length field, which is what {@link detectByteOrder} asks */
const FILE_SIZE_AT = 4;

/** `true` where a DataView wants "little", so a reader can pass it straight in */
export const little = (order: ByteOrder): boolean => order !== "be";

/**
 * Which way round this file's integers are, from the file itself.
 *
 * Little-endian unless big-endian is the only reading under which the header's
 * size field matches the bytes actually present — see the module comment for why
 * that asymmetry is deliberate. A file too short to hold a header, or one whose
 * size field matches neither way, is called little-endian: that is what every
 * caller assumed before this existed, and a malformed file should fail in the
 * reader that understands it rather than here.
 */
export function detectByteOrder(data: Uint8Array): ByteOrder {
  if (data.length < FILE_SIZE_AT + 4) return PC;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(FILE_SIZE_AT, true) === data.length) return PC;
  if (view.getUint32(FILE_SIZE_AT, false) === data.length) return MAC;
  return PC;
}
