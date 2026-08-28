/**
 * Which game files can carry a script — the one list, for every tool that walks
 * a rip.
 *
 * There were three copies of this pattern (`dumpscripts.ts`, `parse.ts`,
 * `scancmds.mts`), all of them Titanic's six extensions, and Dust renames two of
 * them: a stage is `.FLT` and a shop is `.PRP` — the same formats, read by the
 * same readers, opened by the same builtins (`openstagefile("new.flt")`,
 * `openshopfile("house.prp")`; see engine/src/df/stg.ts and the note on
 * `BOOT_UI_SHOPS` in runtime/session.ts). So every stage and shop script in the
 * Dust rip was missing from all three scans, and the coverage they report was
 * over a corpus with one game's UI cut out of it: `SALGAMES.FLT` alone holds the
 * saloon's blackjack and poker, 2,622 lines of them, and `drawstring` read as a
 * one-file opcode until #288 went looking for it there.
 *
 * `BOOTFILE` has no extension at all, so it is its own test rather than part of
 * the pattern.
 */

/** `.SET`/`.STG`/`.FLT`/`.PUP`/`.SHP`/`.PRP`/`.CST`/`.MOV` */
export const SCRIPT_BEARING = /\.(SET|STG|FLT|PUP|SHP|PRP|CST|MOV)$/i;

/** the startup routine's container, which is a file with no extension */
export const isBootFile = (name: string): boolean => /^BOOTFILE$/i.test(name);

/** does this filename name a container a script could be in? */
export const carriesScript = (name: string): boolean =>
  SCRIPT_BEARING.test(name) || isBootFile(name);

/** the same list as prose, for a generated report's "scope" line */
export const SCRIPT_BEARING_NAMES = "`.SET`, `.STG`, `.FLT`, `.PUP`, `.SHP`, `.PRP`, `.CST`, `.MOV`, `BOOTFILE`";
