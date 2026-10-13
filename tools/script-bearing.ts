/**
 * Which game files can carry a script — the one list, for every tool that walks
 * a rip.
 *
 * One list, because Dust renames two of Titanic's six extensions: a stage is
 * `.FLT` and a shop is `.PRP` — the same formats, read by the same readers,
 * opened by the same builtins (`openstagefile("new.flt")`,
 * `openshopfile("house.prp")`; see engine/src/df/stg.ts and the note on
 * `BOOT_UI_SHOPS` in runtime/session.ts). A scan with Titanic's extensions alone
 * misses every stage and shop script in the Dust rip and reports coverage over
 * a corpus with one game's UI cut out of it: `SALGAMES.FLT` alone holds the
 * saloon's blackjack and poker, 2,622 lines of them, and `drawstring` reads as
 * a one-file opcode without it (#288).
 *
 * DreamFactory 5 spells the same six in four letters — RedJack's rooms are
 * `.sett`, its stages `.stag`, shops `.shop`, puppets `.pupp`, films `.move` and
 * casts `.cast` — and nothing older uses those, so they join the pattern without
 * reaching a file the three-letter names did not already mean.
 *
 * `BOOTFILE` has no extension at all, so it is its own test rather than part of
 * the pattern — and RedJack's is `bootfile.boot`, the same file in v5's spelling.
 */

/** `.SET`/`.STG`/`.FLT`/`.PUP`/`.SHP`/`.PRP`/`.CST`/`.MOV`, and v5's `.SETT`/`.STAG`/`.SHOP`/`.PUPP`/`.MOVE`/`.CAST` */
export const SCRIPT_BEARING = /\.(SET|STG|FLT|PUP|SHP|PRP|CST|MOV|SETT|STAG|SHOP|PUPP|MOVE|CAST)$/i;

/** the startup routine's container: a file with no extension, or v5's `bootfile.boot` */
export const isBootFile = (name: string): boolean => /^BOOTFILE(\.BOOT)?$/i.test(name);

/** does this filename name a container a script could be in? */
export const carriesScript = (name: string): boolean =>
  SCRIPT_BEARING.test(name) || isBootFile(name);

/** the same list as prose, for a generated report's "scope" line */
export const SCRIPT_BEARING_NAMES =
  "`.SET`, `.STG`, `.FLT`, `.PUP`, `.SHP`, `.PRP`, `.CST`, `.MOV`, `BOOTFILE` (and DreamFactory 5's `.sett`, `.stag`, `.shop`, `.pupp`, `.move`, `.cast`, `bootfile.boot`)";
