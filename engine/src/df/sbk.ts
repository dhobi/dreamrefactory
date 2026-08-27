/**
 * SBK ("sprite book") files — Skull Cracker's cels, its level plan and its
 * parallax backdrop.
 *
 * The one format in this project that belongs to a game with no interpreter.
 * *Skull Cracker* (1996) is CyberFlix's own and its files are DreamFactory's, but
 * its logic is compiled into `SC.EXE` rather than scripted in the data: measured
 * against the engine's own 329-verb opcode table, Titanic's binary carries 329 of
 * them and Dust's `DF.EXE` 265, while `SC.EXE` carries none (its 14 hits are
 * `sqrt`, `error`, `message` and the like — C and Win32). So a book holds
 * everything about a level EXCEPT what happens in it.
 *
 * ## Nothing here is a new codec
 *
 * A book is an ordinary container file, and its cels are the SHP
 * transparent-image codec — {@link file://./shp.ts}'s `decodeShpFrame`, unchanged.
 * 5424 of the 5424 cels the directory names decode with it. What is this game's
 * own is only the ARRANGEMENT, which is four structures:
 *
 * ```
 *   container 0        the cel directory — 48 bytes per cel
 *   a 38-byte root     the level's table of contents
 *     ├─ +30           container index of the backdrop
 *     └─ +34           container index of the entity table
 *   the entity table   48 bytes per placed thing, with a NAME
 *   the backdrop       342 bytes per placed cel, with a parallax factor
 * ```
 *
 * The directory is what makes the rest legible: **everything references a cel by
 * ID, never by container index**, so a scan for "an i16 that happens to be a
 * valid container" finds nothing at any fixed offset. Its records also duplicate
 * the cel's own header — dimensions at +0 and draw position at +24 — which is
 * how the reading was confirmed rather than assumed: both agree with the decoded
 * cel for 5424 of 5424 entries, in `engine/tests/sbk.ts`.
 *
 * ## What the entity table is
 *
 * The level design, and it is NAMED. 1218 of the 1219 records across the sixteen
 * levels carry a Pascal string, and the vocabulary is the game: `platform`,
 * `obstacle`, `ladder`, `goal`, `newroom`, `exitroom`, `switch`, `door`, `probe`,
 * `timer`, one `init*` per enemy kind and one `stat*` per pickup.
 *
 * Each record is a rect and a POINT, and the point is what proves the reading is
 * real rather than a plausible stride: for the static kinds it is the rect's own
 * midpoint (`obstacle` 100%, `timer` 100%, `stat*` 99%, `platform` 87%) and for
 * the interactive ones it deliberately is not (`switch` 0%, `door` 0%,
 * `ladder` 8%, `goal` 13%) — those store a destination. A field that is a
 * midpoint exactly where a midpoint makes sense is not noise.
 *
 * ## What the backdrop is, and what it is not
 *
 * A placement list, not a tilemap: cel ID, world position, and a 16.16
 * fixed-point parallax factor. All 5048 placements across the sixteen levels
 * resolve through the directory. Bigger factor = farther away, and the values are
 * per-level — there is nothing canonical about 1.0, so a caller wanting "the
 * near plane" should take the commonest factor in the book and not compare
 * against a constant ({@link nearestLayer}).
 *
 * The layers only line up under the camera `SC.EXE` owns, so compositing them at
 * their stored positions gives the level UNROLLED and not any one screen of it.
 * That is a true picture of the data and a false picture of the game, and callers
 * should say which they are showing.
 *
 * `PLAYER.SBK` is the degenerate case that separates the halves: 1229 cels, and a
 * root pointing at two empty tables. The player has no level.
 *
 * ## One impostor
 *
 * `SUPPORT/DIRECTX/**\/SYNTHGM.SBK` on the Windows disc is a RIFF SoundFont bank
 * and has nothing to do with this. {@link isSbkFile} tells them apart by the
 * container fourCC, which is the only honest test — the extension is shared.
 */
import { DFContainerFile, readContainerFile } from "./container";

/**
 * The sixteen levels in the order the game plays them, recovered from `SC.EXE`.
 *
 * Not derivable from the discs: the books sit in one directory and sort
 * alphabetically, which is not the order anyone played them in. It is in the
 * executable, and this is the chain — every link a single reference, so the
 * order is read rather than inferred:
 *
 *   - **Four chapters, four stages each.** `SC.EXE` has four film sequencers,
 *     `0x44d720`, `0x436980`, `0x41f2e0` and `0x412670`, each switching on the
 *     scene state `[0x4abdfc]`. States 2, 3, 4 and 5 are a chapter's four
 *     playable stages, and each of those cases names its own chapter film:
 *     `chp01`…`chp04` in the first sequencer, `chp05`…`chp08` in the second,
 *     `chp09`…`chp12` in the third, `chp13`…`chp16` in the fourth.
 *   - **Each of those cases loads exactly one book.** The call sits ~40 bytes
 *     after the film name in the same case (`0x44d80d` calls the loader that
 *     pushes `streets.sbk`, `0x44d87f` the one that pushes `city.sbk`, and so on
 *     at +237, +351, +465 and +579 into every sequencer). Each book name is
 *     pushed exactly once from exactly one function, so the pairing is total.
 *
 * That gives all sixteen, and it corrects an earlier reading of this table. The
 * first version paired each book with the theme bank pushed beside it —
 * `streets.sbk` with `theme01.snd`, `city.sbk` with `theme02.snd` — and sorted
 * by theme number, which put `sewer` third. It is seventh: `theme03.snd` is
 * `sewer.sbk`'s bank, but `0x436b51`, the only place `sewer.sbk` is loaded, is
 * inside the case that plays `chp07`. The theme numbers agree with the play
 * order for fifteen of the sixteen levels and the sewer is the one that moved.
 *
 * `player.sbk` has no theme and no level: it is loaded from somewhere else
 * entirely (`0x40e1b0`), which is the same split the files themselves show.
 *
 * Reproducing it: `scdis.mts at 0x44d720:800` is the first sequencer with its
 * films and loader calls in view, `scdis.mts callers 0x44dc10` names the case
 * that opens `streets.sbk`, and `scdis.mts books` prints the book-and-theme
 * pairing — the one that read `sewer` as third.
 */
export const LEVEL_ORDER: readonly string[] = [
  "streets",
  "city",
  "woods",
  "playgr",
  "mall",
  "service",
  "sewer",
  "arcade",
  "grave",
  "cavern",
  "ravecave",
  "tower",
  "maze",
  "barrel",
  "lab",
  "vat",
];

/** which level a book is, 1..16, or 0 for `player.sbk` — see {@link LEVEL_ORDER} */
export function levelNumber(bookName: string): number {
  const stem = bookName.replace(/\.sbk$/i, "").toLowerCase();
  return LEVEL_ORDER.indexOf(stem) + 1;
}

/** the container-file fourCC, which is what separates a book from a SoundFont */
const DF_FOURCC = 0x00010000;

/**
 * Container 0: a 32-byte header, then one record per cel.
 *
 * The header is the book's own index and was very nearly missed. Its three i32s
 * name the palette container, the root container and the cel count — so none of
 * those has to be guessed at by size, which is what an earlier version of this
 * reader did. It found the palette by looking for a 2056-byte container and
 * `STREETS.SBK` has TWO; taking the first painted that whole level in the wrong
 * colours, and the header names the second. Verified on all 17 books: the
 * container it points at is 2056 bytes every time, the root it points at is 38,
 * and the count agrees with the directory's own length.
 */
const DIR = {
  header: 32,
  stride: 48,
  height: 0,
  width: 2,
  /** {@link SbkCel.strike} — the frame's own hit box, zeroed on all but 42 cels */
  strike: 4,
  /** {@link SbkCel.body} — the frame's collision box */
  body: 12,
  /** {@link SbkCel.blow} — `(dy, dx)`, the pair `0x42f910` takes a magnitude of */
  blowY: 20,
  blowX: 22,
  posY: 24,
  posX: 26,
  id: 28,
  location: 30,
};
const C0 = { palette: 20, root: 24, celCount: 28 };

/** the root container, named by {@link C0}: where the level's two tables are */
const ROOT = { size: 38, backdrop: 30, entities: 34 };

/**
 * The entity and backdrop tables share a 28-byte header with an i32 count at
 * +24, and differ only in their stride. The 2 bytes between the count and the
 * first record are unread and zero in every shipped book.
 */
const TABLE = { header: 28, count: 24 };
const ENTITY_STRIDE = 48;
const BACKDROP_STRIDE = 342;

/** the palette block, behind an 8-byte prefix: 256 * {i16 index, i16 rgb[3]} */
const PALETTE = { size: 2056, at: 8 };

const view = (d: Uint8Array): DataView => new DataView(d.buffer, d.byteOffset, d.byteLength);

/**
 * A rect in a cel's own space: offsets from its anchor, in the `.data` order this
 * format keeps every rect in — `{y0, x0, y1, x1}`.
 */
export interface SbkCelBox {
  y0: number;
  x0: number;
  y1: number;
  x1: number;
}

/**
 * Read one of a cel record's two rects, or null when all four words are zero.
 *
 * All-zero is how the format says "this cel has no such box": a real one always
 * has `y1 > y0` and `x1 > x0`, and a degenerate rect would be indistinguishable
 * from an absent one anyway.
 */
function box(v: DataView, at: number): SbkCelBox | null {
  const y0 = v.getInt16(at, true);
  const x0 = v.getInt16(at + 2, true);
  const y1 = v.getInt16(at + 4, true);
  const x1 = v.getInt16(at + 6, true);
  return y0 === 0 && x0 === 0 && y1 === 0 && x1 === 0 ? null : { y0, x0, y1, x1 };
}

/** the cel's blow, or null when it carries none — see {@link SbkCel.blow} */
function blowAt(v: DataView, at: number): { dy: number; dx: number } | null {
  const dy = v.getInt16(at + 20, true);
  const dx = v.getInt16(at + 22, true);
  return dy === 0 && dx === 0 ? null : { dy, dx };
}

/** one cel, as the directory describes it — the pixels stay in the container */
export interface SbkCel {
  /** what the rest of the book calls this cel */
  id: number;
  /** which container holds it, for `decodeShpFrame` */
  location: number;
  width: number;
  height: number;
  /** the cel's own draw offset, duplicated here from its header */
  posY: number;
  posX: number;
  /**
   * The cel's authored COLLISION box, anchor-relative, or null where the record
   * carries none.
   *
   * Four zeroed words in most of the corpus and a real rect in 741 of
   * `PLAYER.SBK`'s 1229 cels, and the rect is genuinely authored rather than
   * derived: only 43 of those 741 are the cel's own extent. The punk's walking
   * cel 1900 is 103x142 with its anchor at (48, 79) — an extent of
   * `y -79..63, x -48..55` — and its box is `y -79..62, x -31..51`, a torso
   * narrower than the art on both sides. Which is what a fighting game needs and
   * what a bounding box cannot give you.
   */
  body: SbkCelBox | null;
  /**
   * The cel's STRIKE box — the part of this frame that hits — or null, which is
   * almost always.
   *
   * 42 cels in `PLAYER.SBK` have one and every one of them also has a
   * {@link SbkCel.blow}: they are the impact frames and nothing else. The punch's
   * cel 602 is 129x142 anchored at (41, 53) and its strike box is
   * `y -40..-16, x 64..88` — a 24x24 square at the far right of the art, which is
   * the fist. The kick's 655 puts its 21x21 box at `x 42..63`, its own right
   * edge. So an attack connects on two frames of its animation and only where the
   * blow actually is.
   */
  strike: SbkCelBox | null;
  /**
   * What this cel hits WITH: the `(dy, dx)` at +20/+22, or null.
   *
   * `0x42f910` is the engine's damage function and it is not a table lookup —
   * it takes the striking object's cel record, scales this pair by the object's
   * own `+0x1a` percentage, adds the object's accumulated velocity, and returns
   * `sqrt(dy² + dx²)`. **Damage is speed.** Every hit handler in the game calls
   * it and subtracts the result from the victim's health.
   *
   * Which makes the whole combat model readable off these two words:
   *
   * ```
   *   cel  602   dx  47          the punch
   *   cel  604   dx  50          its second variant
   *   cel  655   dx  87  dy 11   the kick
   *   cel  663   dx  55  dy -6   the flying kick
   *   cel  622   dx  44  dy -56  the jump kick, 71 all told
   * ```
   *
   * And it explains thresholds that look arbitrary until you know they are
   * speeds: a mailbox dents at 10 and crumples at 55 (`0x44fe80`), so a punch
   * dents it and a kick caves it in; a punk is knocked down over 50
   * (`0x44f1fd`), so a kick floors it and a punch only staggers it.
   */
  blow: { dy: number; dx: number } | null;
}

/** the terrain a region is built on — see {@link SbkRegion} */
export interface SbkPoint {
  y: number;
  x: number;
}

/**
 * A named region's shape: a bounding box and the GROUND its floor follows.
 *
 * One container per region, reached through {@link SbkEntity.regionLocation}, and
 * for a long time these were the "unknown containers" left over from a census of
 * the format — 18 to 362 bytes, nothing pointing at them that anyone had found.
 * The entity table points at them: a record with {@link SbkEntity.isEntity}
 * false is a region, and its +10 is where its shape lives.
 *
 * The layout is an i16 byte count, then `(i16 y, i16 x)` pairs — Mac order, like
 * every other coordinate in this format. The first two pairs are the bounding
 * box; the rest is a POLYLINE, and it is the walkable floor. `WOODS.SBK`'s is 88
 * points running from x=708 to x=11086 with y wandering 911..1557: the terrain
 * across the whole level.
 */
export interface SbkRegion {
  /** container this was read from */
  location: number;
  /** the two corners the file states, before the polyline */
  min: SbkPoint;
  max: SbkPoint;
  /** the floor, left to right */
  ground: readonly SbkPoint[];
}

/** one placed thing in a level: a rect, a point, and what it is */
export interface SbkEntity {
  /** `platform`, `initzomb`, `stathealth`, … — empty for the one unnamed record */
  name: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
  /**
   * The record's second point. For the static kinds this is the rect's own
   * midpoint and carries nothing new; for `switch`, `door`, `ladder` and `goal`
   * it is somewhere else, and what it MEANS there is the executable's business.
   * See {@link isMidpoint}.
   */
  pointY: number;
  pointX: number;
  /**
   * `true` where this record is an OBJECT the engine spawns, `false` where it is
   * a named region.
   *
   * The file's own discriminator (+22). Confirmed three ways, the last of which
   * is the engine doing it:
   *
   * 1. every name on the `true` side is a class `SC.EXE` registers as a string,
   *    and every name on the `false` side is a label a level designer typed
   *    (`newroom`, `roomtwo`, `chamber2`) that the binary has never heard of —
   *    96 of the 113 names in the shipped books are in the binary, and the 17
   *    that are not are exactly these;
   * 2. only the `false` side has a {@link regionLocation}, and every one of those
   *    resolves to a container holding a floor;
   * 3. `SC.EXE`'s own record collector reads it. At `0x40b850` it walks the
   *    entity table — `add ebx, 0x1c` for the header, `add ebx, 0x30` per
   *    record, `cmp dword ptr [level+0x18], ecx` for the count — and does
   *    `cmp word ptr [rec+0x16], 0; je next`. A record with 0 here is not
   *    collected as an object at all.
   */
  isEntity: boolean;
  /**
   * The 32-bit field at +10, which means two different things.
   *
   * For a REGION it is the container holding its {@link SbkRegion} shape, and 0
   * for a region with none. For an OBJECT it is always 0 on disc — and now we
   * know why: at runtime the engine keeps an object POINTER there. `SC.EXE`'s
   * platform overlap query walks the platform array and, on a hit, does
   * `cmp dword ptr [rec+10], 0` and then stores the colliding object's pointer
   * into it; the removal function matches on it, and the array compaction
   * preserves it. Nobody is standing on anything when a level loads, so the
   * file's copy is zero.
   *
   * Read as an i32 because that is the width the engine uses. It happens to make
   * no difference to any shipped book — +12 is zero in all 1219 records, so the
   * low half was already the whole value — which is why this is a claim about the
   * FORMAT taken from the code rather than a bug fix taken from the data.
   */
  regionLocation: number;
  /**
   * The record's per-instance parameter (+0) — small, signed, and different for
   * each copy of the same kind: `initbeltleft` stores 4, 6, 8 or 10, `door`
   * stores -4, -1, 2, 7 or 8, `initcagedoor` -4 to 4. Direction, speed or
   * initial state, most likely; which of those is `SC.EXE`'s business and this
   * port does not pretend to know. Carried because dropping a field that varies
   * per instance is how a reader loses the thing that made two copies differ.
   */
  param: number;
  /**
   * Flags (+14) — four bits, and all four are set in 1156 of the 1167 entity
   * records in the corpus.
   *
   * What makes the exceptions worth carrying is WHICH records they are: eight
   * `platform`s at 14, two at 11, one at 13, and one `initplank` at 14. Every
   * one is a surface you stand on, and every value is 15 with a single bit
   * cleared. Per-edge solidity — the jump-through platform every side-scroller
   * has — would look exactly like this, but that is a guess and this port does
   * not act on it. Regions use the field differently (3, 4, 5, 7, 12, 13, 15).
   */
  flags: number;
}

/** one cel placed in the backdrop */
export interface SbkPlacement {
  /** a {@link SbkCel.id}, to be resolved through {@link SbkFile.byId} */
  id: number;
  y: number;
  x: number;
  /**
   * The value the AUTHORING TOOL stored at +9..+11, as a float — and, measured
   * against the engine, a value the runtime never reads. `SC.EXE`'s backdrop
   * consumer (`0x40bf40`) reads +8's low byte ({@link plane}) and nothing else
   * of this dword; the real scroll rate is {@link placementRate}, computed from
   * the plane and the {@link flags} bits. This stays exposed because it is in
   * the file and correlates with the intended depth, but rendering by it is how
   * a whole page of this project came out looking "all misaligned" — most art
   * is on rate-1 planes and lines up exactly as stored.
   */
  parallax: number;
  /**
   * The plane type, 0..4 — the low byte of +8. The engine builds five display
   * lists and this picks which one the placement joins; a value over 4 is a
   * hard error in the original (report 0xcf8).
   */
  plane: number;
  /**
   * Nonzero for an ANIMATED placement (+12) — and the number of frames it plays.
   * The engine tests it only against zero at load; the frame list is
   * {@link frameIds}.
   */
  frames: number;
  /**
   * The cel IDs this placement cycles through, or just `[id]` for a still one.
   *
   * The animation is a table of 8-byte entries at +22, the cel ID at +2 of each,
   * and it plays the first {@link frames} of them (the rest of the record's tail
   * is the dead `f5f5`/`ffff` fill). STREETS' street lamp is `[2360, 2361, 2362]`
   * — the glow. Entry 0 is **usually but not always** {@link id}: 31 placements
   * in the corpus start elsewhere, and they are the ping-pong glows —
   * `CAVERN`'s 5534 plays `5530,5531,5532,5533,5534,5534,5533,5532,5531,5530`,
   * a bounce whose stored base is its brightest frame, not its first. So {@link
   * id} is a representative cel, not the animation's start.
   */
  frameIds: readonly number[];
  /** the word at +6 — nonzero mirrors the cel horizontally: SC.EXE hands it
   *  straight to its rect builder (0x4026d0), which negates the x extents */
  mirror: boolean;
  /**
   * The word at +16. Bit 0x10 marks the placement droppable when memory is
   * short; on planes 2 and 3 bits 1/2/4 select the scroll rate (see
   * {@link placementRate}); on an animated placement it also carries the entry
   * count. One word, several tenants — 1996 was like that.
   */
  flags: number;
}

export interface SbkFile {
  file: DFContainerFile;
  /** every cel the book names, in directory order */
  cels: readonly SbkCel[];
  /** cel ID to container location — the indirection everything else goes through */
  byId: ReadonlyMap<number, number>;
  /** the raw palette block, or null in a book that carries none */
  paletteRaw: Uint8Array | null;
  /** the level's placed things; empty in `PLAYER.SBK` */
  entities: readonly SbkEntity[];
  /** every region's ground, keyed by its container location */
  regions: ReadonlyMap<number, SbkRegion>;
  /** the level's backdrop; empty in `PLAYER.SBK` */
  placements: readonly SbkPlacement[];
  /** where the root said the two tables were, or -1 with no root */
  entityLocation: number;
  backdropLocation: number;
}

/**
 * Is this a sprite book at all?
 *
 * The fourCC and nothing else — `.sbk` is also the extension of a RIFF
 * SoundFont, and a caller handed one should be told rather than shown a parse
 * error from four structures in. Either byte order answers yes, because
 * `readContainerFile` will work out which ({@link file://./byte-order.ts}) —
 * though no big-endian book has been seen: the Macintosh Skull Cracker disc's
 * films are big-endian and its books were never read before the disc was
 * replaced, so this is deliberately not asserting that they are not.
 */
export function isSbkFile(data: Uint8Array): boolean {
  if (data.length < 4) return false;
  const v = view(data);
  return v.getUint32(0, true) === DF_FOURCC || v.getUint32(0, false) === DF_FOURCC;
}

/**
 * Each plane's paint order, from `SC.EXE`'s compositor — the real z.
 *
 * The plane draws do not blit; they append nodes to one array that a single pass
 * (`0x40e520`) paints in order, and the level's frame fn (`0x412c30`) appends the
 * plane lists as **p3, p0, [the actors], p4, p1, p2**. So this is that order, and
 * {@link PLAY_PLANE_Z} is where the actors — the player, enemies, and a viewer's
 * ground/entity overlay — fall in it: after p3 and p0, before p4, p1 and p2. The
 * upshot is that plane 2 (the lamp-post and overhead cables) paints last, in
 * front of everything, which is what the original shows.
 */
export const PLANE_Z: Readonly<Record<number, number>> = { 3: 0, 0: 1, 4: 3, 1: 4, 2: 5 };
/** where the actors (and a viewer's overlays) sit in {@link PLANE_Z} */
export const PLAY_PLANE_Z = 2;
/** a placement's z, its plane's {@link PLANE_Z} or the play plane if unknown */
export function placementZ(p: SbkPlacement): number {
  return PLANE_Z[p.plane] ?? PLAY_PLANE_Z;
}

/**
 * The scroll rate the ENGINE gives a placement — the real parallax.
 *
 * Recovered from `SC.EXE`'s draw path, which is one line of arithmetic: a
 * kind-B node's screen x is `(x − c) · k/6000 + c` about the camera centre `c`,
 * where `k` comes from the {@link SbkPlacement.flags} bits — so the rate is
 * `k / 6000`. The plane byte's jump table (`0x40c1d8`) says which planes are
 * kind B: **plane 2 is the background** (bit 1 → 5000, 2 → 5300, 4 → 5600 —
 * rates below 1, scrolling slower) and **plane 3 the foreground** (7500, 6700,
 * 6400 — above 1, faster). Planes 0, 1 and 4 pass through the kind-A path,
 * whose transform (`0x4026d0`) contains no camera at all: **rate exactly 1**.
 *
 * The stored "+9..+11 depth" is not consulted anywhere on that path, which is
 * why rendering by it misaligns a level: most of the art is rate-1 and lines
 * up exactly as stored. Horizontal only — the engine scales x and leaves y.
 */
export function placementRate(p: SbkPlacement): number {
  const k =
    p.plane === 2
      ? p.flags & 1
        ? 5000
        : p.flags & 2
          ? 5300
          : p.flags & 4
            ? 5600
            : 6000
      : p.plane === 3
        ? p.flags & 1
          ? 7500
          : p.flags & 2
            ? 6700
            : p.flags & 4
              ? 6400
              : 6000
        : 6000;
  return k / 6000;
}

/** does this record's point sit at the middle of its own rect — see {@link SbkEntity.pointY} */
export function isMidpoint(e: SbkEntity): boolean {
  return e.pointY === ((e.top + e.bottom) >> 1) && e.pointX === ((e.left + e.right) >> 1);
}

/**
 * The commonest parallax factor in a book — "the plane the level is played on".
 *
 * The MODE and not the minimum, because a level may park a single placement far
 * outside its own range (STREETS stores one at 0.125 against 143 at 1.020) and
 * the minimum would name that one. What the mode names is the layer most of the
 * art is on, which is the one a viewer wants when it shows a single plane.
 *
 * Returns 0 for a book with no backdrop.
 */
export function nearestLayer(sbk: SbkFile): number {
  const tally = new Map<number, number>();
  for (const p of sbk.placements) tally.set(p.parallax, (tally.get(p.parallax) ?? 0) + 1);
  let best = 0;
  let most = 0;
  for (const [factor, n] of tally) {
    if (n > most) {
      most = n;
      best = factor;
    }
  }
  return best;
}

// ---- rooms: how a level is divided, and how you get between them ------------

/**
 * A rasterised floor: the y of the ground for every x column across its span.
 *
 * `SC.EXE`'s own shape. `0x40ba70` takes a region's polyline and fills a
 * per-column height array from it, which is what makes a floor queryable in
 * constant time while the player walks — see {@link rasteriseGround}.
 */
export interface SbkGround {
  /** the world x of column 0 */
  x0: number;
  /** the floor y, one per column, `x0` to `x0 + ys.length - 1` */
  ys: Int16Array;
}

/**
 * `0x40ba70`, reimplemented: a region's polyline as one y per x column.
 *
 * The polyline is a staircase rather than a function of x, and the shipped books
 * lean on that in three ways:
 *
 * - **vertical steps.** Two consecutive points share an x and differ in y — a
 *   curb. STREETS has nine (`3390,1356` then `3390,1340`).
 * - **pits.** The floor drops hundreds of pixels and comes back. TOWER's first
 *   room dives 719px and returns, four times: those are its shafts. CITY goes
 *   further — its floor is a ledge from x271 to x691 and then y=7250 for the
 *   rest of the level, which is 2900px below anything CITY draws. CITY has no
 *   floor. It has 73 platforms and 20 planks, and the ground is the fall.
 * - **the odd backwards pixel.** `6231,1341` then `6230,1366` in STREETS.
 *
 * So this walks the segments in file order and lets later ones win, which is
 * what a rasteriser scanning the list does, and seeds every column from the
 * first point so that a column no segment covers is still floor rather than
 * y=0. (No shipped region needs that seed — all 48 rasterise with every column
 * written — but a backwards segment one pixel longer would have needed it, and
 * "the floor is at the top of the world" is not a failure worth having.)
 *
 * Returns null for a region with no usable polyline.
 */
export function rasteriseGround(r: SbkRegion): SbkGround | null {
  const pts = r.ground;
  if (pts.length < 2) return null;
  const x0 = pts[0].x;
  const span = pts[pts.length - 1].x - x0;
  if (span <= 0) return null;
  const ys = new Int16Array(span + 1).fill(pts[0].y);
  for (let s = 0; s + 1 < pts.length; s++) {
    const a = pts[s];
    const b = pts[s + 1];
    const dx = b.x - a.x;
    for (let x = a.x; x <= b.x; x++) {
      const i = x - x0;
      if (i < 0 || i > span) continue;
      ys[i] = dx ? Math.round(a.y + ((b.y - a.y) * (x - a.x)) / dx) : a.y;
    }
  }
  return { x0, ys };
}

/** a door out of a room: walk into `rect` and you are in the room called `to` */
export interface SbkExit {
  /** the {@link SbkRoom.param} of the room this leads to */
  to: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  /**
   * The record's point, which sits just outside one edge of its own rect — a few
   * dozen pixels left of it or right of it, never above or below, in eight of the
   * nine shipped doors. Read here two ways at once, because both fall out of the
   * same offset and each is checked by the other:
   *
   * - **where the player stands on arriving beside this door.** That makes a
   *   pair of doors a two-way passage: leave the street through its door and you
   *   are put at the point of the basement's door back.
   * - **which way you must be walking to use it** — see {@link side}.
   *
   * The file states the point and not its meaning; the meaning is this port's.
   * What argues for it is that it makes the shipped pairs work with no extra
   * rule: see {@link side}. And {@link SbkEntity.pointY} for the same field
   * across every other kind of record.
   */
  pointY: number;
  pointX: number;
  /**
   * Which side of its own rect the point is on: -1 left, +1 right, 0 inside.
   *
   * A geometric fact about the shipped doors, and a real one — the eight
   * reachable doors line up in **opposed pairs**, STREETS +1 then -1, CAVERN -1
   * then +1, MAZE +1 then -1, LAB's three-room chain -1 then +1. The ninth is 0:
   * LAB's door out of `lab2` stores its own rect's midpoint, and it is also the
   * one door inside a room with no floor.
   *
   * What it is NOT is the trigger. Read as "you must be walking this way to use
   * it", it makes a passage that works and a level that cannot be finished:
   * STREETS' street door stands between the spawn at x1840 and the goal at
   * x7731, so walking right always enters it, and the arrival point beside it is
   * **eight pixels** past its right edge while the player is about a hundred
   * pixels wide. You come out of every door still touching it. A door whose own
   * exit point leaves you inside it cannot be triggered by touching it — which
   * is the argument, from the file's own numbers, that entering one is a
   * deliberate act. `skullcracker/src/walk.ts` makes it the up key.
   */
  side: -1 | 0 | 1;
}

/**
 * One room of a level: a rect, a floor, and the doors out of it.
 *
 * A level's `newroom` records — the ones with {@link SbkEntity.isEntity} false —
 * are its rooms, and they are the level's real structure. Every shipped book
 * has at least one; SEWER has twelve. The binding, all of it read off the 16
 * books rather than assumed:
 *
 * - **a room owns one region.** {@link SbkEntity.regionLocation} names the
 *   container holding its floor, and across all 16 books no region is owned
 *   twice: 52 rooms to 48 regions, the four left over linking 0, which is the
 *   format's null: MAZE's two unnamed rooms, BARREL's `barrel`, LAB's
 *   `lab2`. Those rooms have no floor at all, and no exit leads to one.
 * - **a room is identified by its param, not its name.** Designers typed
 *   `newroom` thirty-seven times, and also `roomtwo`, `bigshaft`, `chamber2`,
 *   `lab1`; the names repeat and collide. {@link SbkEntity.param} is what an
 *   exit names, and it is unique among the rooms an exit can reach.
 * - **`exitroom` records are the doors.** Each sits inside one room's rect and
 *   carries the param of another room. Every one of the nine in the shipped
 *   books resolves, and they come in reciprocal pairs: STREETS' street holds a
 *   door to room 1 and its basement holds a door back to room 3. LAB is a chain
 *   of three rather than a pair.
 * - **`goal` is not a door.** Its param is 0 or 1 with no relation to any room;
 *   it ends the level. `door` (SEWER's five, params -1, 2, 7, 8, -4) is a third
 *   thing again, and what its param names is still unknown.
 */
export interface SbkRoom {
  /** its index in {@link SbkFile.entities} — the only truly unique handle */
  index: number;
  /** `newroom`, `bigshaft`, `lab1` — a designer's label, and not unique */
  name: string;
  /** what an {@link SbkExit} calls this room */
  param: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** the container its floor came from, or 0 for a room with none */
  regionLocation: number;
  /** its floor, or null where the link is 0 or the polyline unusable */
  ground: SbkGround | null;
  /** the `exitroom` records standing inside this room */
  exits: readonly SbkExit[];
}

/** does (y, x) fall inside this rect — the test that puts an exit in a room */
function within(r: { top: number; left: number; bottom: number; right: number }, y: number, x: number): boolean {
  return y >= r.top && y <= r.bottom && x >= r.left && x <= r.right;
}

/**
 * A level's rooms, their floors rasterised and their doors attached.
 *
 * Derived, not read: everything here is already in {@link SbkFile.entities} and
 * {@link SbkFile.regions}, arranged the way something walking the level needs
 * it. The format claims are in {@link SbkRoom}. Empty for `PLAYER.SBK`, which
 * has no entity table at all.
 */
export function readRooms(sbk: SbkFile): SbkRoom[] {
  const rooms: SbkRoom[] = [];
  sbk.entities.forEach((e, index) => {
    if (e.isEntity) return;
    const region = sbk.regions.get(e.regionLocation);
    rooms.push({
      index,
      name: e.name,
      param: e.param,
      top: e.top,
      left: e.left,
      bottom: e.bottom,
      right: e.right,
      regionLocation: e.regionLocation,
      ground: region ? rasteriseGround(region) : null,
      exits: [],
    });
  });
  // an exit belongs to the room its own centre stands in
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "exitroom") continue;
    const cy = (e.top + e.bottom) >> 1;
    const cx = (e.left + e.right) >> 1;
    const host = rooms.find((r) => within(r, cy, cx));
    if (!host) continue;
    (host.exits as SbkExit[]).push({
      to: e.param,
      top: e.top,
      left: e.left,
      bottom: e.bottom,
      right: e.right,
      pointY: e.pointY,
      pointX: e.pointX,
      side: e.pointX < e.left ? -1 : e.pointX > e.right ? 1 : 0,
    });
  }
  return rooms;
}

/**
 * Where the player stands on entering `room` from `from`.
 *
 * The door back, if the destination has one — the reading in {@link SbkExit} —
 * and otherwise the middle of the room's own rect, which is a guess and says so
 * by being the only thing left. Returns null for a room with no floor.
 */
export function arrivalIn(room: SbkRoom, from: SbkRoom): { y: number; x: number } | null {
  if (!room.ground) return null;
  const back = room.exits.find((x) => x.to === from.param);
  if (back) return { y: back.pointY, x: back.pointX };
  return { y: (room.top + room.bottom) >> 1, x: (room.left + room.right) >> 1 };
}

/** a Pascal string, where the length byte is in range and the bytes are printable */
function pascalAt(d: Uint8Array, at: number, max: number): string {
  const n = d[at];
  if (n < 1 || n > max || at + 1 + n > d.length) return "";
  for (let i = 0; i < n; i++) {
    const c = d[at + 1 + i];
    if (c < 0x20 || c > 0x7e) return "";
  }
  return new TextDecoder("latin1").decode(d.subarray(at + 1, at + 1 + n));
}

function readDirectory(c0: Uint8Array): SbkCel[] {
  const v = view(c0);
  const out: SbkCel[] = [];
  // the header's own count, floored by what the container can actually hold —
  // it has agreed with the length on every shipped book, and a disagreement
  // should truncate rather than read off the end
  const count = Math.max(0, Math.min(v.getInt32(C0.celCount, true), (c0.length - DIR.header) / DIR.stride));
  for (let at = DIR.header, i = 0; i < count; at += DIR.stride, i++) {
    out.push({
      id: v.getInt16(at + DIR.id, true),
      location: v.getInt16(at + DIR.location, true),
      height: v.getInt16(at + DIR.height, true),
      width: v.getInt16(at + DIR.width, true),
      posY: v.getInt16(at + DIR.posY, true),
      posX: v.getInt16(at + DIR.posX, true),
      body: box(v, at + DIR.body),
      strike: box(v, at + DIR.strike),
      blow: blowAt(v, at),
    });
  }
  return out;
}

function readEntities(d: Uint8Array): SbkEntity[] {
  const v = view(d);
  const count = v.getInt32(TABLE.count, true);
  if (count < 0 || d.length - TABLE.header !== count * ENTITY_STRIDE) return [];
  const out: SbkEntity[] = [];
  for (let i = 0; i < count; i++) {
    const at = TABLE.header + i * ENTITY_STRIDE;
    out.push({
      param: v.getInt16(at, true),
      top: v.getInt16(at + 2, true),
      left: v.getInt16(at + 4, true),
      bottom: v.getInt16(at + 6, true),
      right: v.getInt16(at + 8, true),
      regionLocation: v.getInt32(at + 10, true),
      flags: v.getInt16(at + 14, true),
      // `!== 0` and not `=== 1`, because that is the test the engine makes:
      // SC.EXE's collector at 0x40b850 does `cmp word ptr [rec+0x16], 0; je skip`
      isEntity: v.getInt16(at + 22, true) !== 0,
      pointY: v.getInt16(at + 24, true),
      pointX: v.getInt16(at + 26, true),
      // the name runs to the end of the record; the longest shipped is 13 chars
      name: pascalAt(d, at + 28, ENTITY_STRIDE - 29),
    });
    // +16, +18 and +20 are zero in all 1219 shipped records — genuinely unused
    // rather than unread. +12 is zero too, but it is not a field: it is the high
    // half of the 32-bit value at +10 (see SbkEntity.regionLocation).
  }
  return out;
}

/**
 * A region's ground: `i16 byteCount`, two corner points, then the floor.
 *
 * Returns null for a container that does not have that shape, which includes
 * location 0 — the cel directory, and what a region with no shape stores.
 */
function readRegion(file: DFContainerFile, location: number): SbkRegion | null {
  const c = file.containers[location];
  if (!c || location === 0 || c.data.length < 10) return null;
  const d = c.data;
  const v = view(d);
  // the count is the container's own length, which is the check that this is one
  if (v.getInt16(0, true) !== d.length) return null;
  const pts: SbkPoint[] = [];
  for (let o = 2; o + 4 <= d.length; o += 4) {
    pts.push({ y: v.getInt16(o, true), x: v.getInt16(o + 2, true) });
  }
  if (pts.length < 3) return null;
  return { location, min: pts[0], max: pts[1], ground: pts.slice(2) };
}

function readBackdrop(d: Uint8Array): SbkPlacement[] {
  const v = view(d);
  const count = v.getInt32(TABLE.count, true);
  if (count < 0 || d.length - TABLE.header !== count * BACKDROP_STRIDE) return [];
  const out: SbkPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const at = TABLE.header + i * BACKDROP_STRIDE;
    const id = v.getInt16(at, true);
    // the animation: `frames` entries of 8 bytes from +22, cel ID at +2 of each.
    // Bounded by what the record can hold, so a corrupt count cannot read past it.
    const frames = v.getInt16(at + 12, true);
    const maxEntries = Math.floor((BACKDROP_STRIDE - 22) / 8);
    const frameIds =
      frames > 1
        ? Array.from({ length: Math.min(frames, maxEntries) }, (_, e) => v.getInt16(at + 22 + e * 8 + 2, true))
        : [id];
    out.push({
      id,
      y: v.getInt16(at + 2, true),
      x: v.getInt16(at + 4, true),
      mirror: v.getInt16(at + 6, true) !== 0,
      // see the interface: the low byte is the plane, the rest is the depth
      parallax: (v.getInt32(at + 8, true) >> 8) / 256,
      plane: v.getUint8(at + 8),
      flags: v.getUint16(at + 16, true),
      frames,
      frameIds,
    });
  }
  return out;
}

/**
 * Read a sprite book.
 *
 * Every structure is optional in the sense that a malformed or unexpected one
 * yields an empty list rather than a throw: this reader is pointed at whatever a
 * user picked in an editor, and "no entities" is a more useful answer than a
 * stack trace. What it will not do is guess — a table whose length does not match
 * its own count times the stride is not read at all.
 */
export function readSbkFile(data: Uint8Array): SbkFile {
  const file = readContainerFile(data);
  const cels = readDirectory(file.containers[0].data);
  const byId = new Map<number, number>();
  for (const c of cels) if (!byId.has(c.id)) byId.set(c.id, c.location);

  // both named by container 0's header rather than found by size — see {@link C0}
  const c0v = view(file.containers[0].data);
  const palette = file.containers[c0v.getInt32(C0.palette, true)];
  const root = file.containers[c0v.getInt32(C0.root, true)];

  let entityLocation = -1;
  let backdropLocation = -1;
  let entities: SbkEntity[] = [];
  let placements: SbkPlacement[] = [];
  if (root?.data.length === ROOT.size) {
    const v = view(root.data);
    backdropLocation = v.getInt32(ROOT.backdrop, true);
    entityLocation = v.getInt32(ROOT.entities, true);
    const ec = file.containers[entityLocation];
    const bc = file.containers[backdropLocation];
    if (ec) entities = readEntities(ec.data);
    if (bc) placements = readBackdrop(bc.data);
  }

  const regions = new Map<number, SbkRegion>();
  for (const e of entities) {
    if (e.isEntity || regions.has(e.regionLocation)) continue;
    const r = readRegion(file, e.regionLocation);
    if (r) regions.set(e.regionLocation, r);
  }

  return {
    file,
    cels,
    byId,
    regions,
    paletteRaw:
      palette?.data.length === PALETTE.size ? palette.data.subarray(PALETTE.at) : null,
    entities,
    placements,
    entityLocation,
    backdropLocation,
  };
}
