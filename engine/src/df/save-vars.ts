/**
 * The variable list a save carries, and the string pool beside it.
 *
 * Its own module because it is the ONE part of the save format that did not
 * change between DreamFactory 1 and 4. Dust's `.rtd` and Titanic's `.ti` are the
 * same container file (see `savegame.ts` and `savegame-v1.ts`) but they disagree
 * about nearly every offset inside — the standpoint block, the actor stride, the
 * cricket record — and then agree, byte for byte, about this: a 28-byte header
 * describing a string pool, followed by 32-byte nodes whose DFValue belongs to
 * the NEXT node's name. Three years apart, the same C++ object graph.
 *
 * So the two format modules share it rather than each carrying a copy. What is
 * here is deliberately only the node/pool layer: WHICH container holds the list
 * is a per-version question (v4 finds it by its TAOOT variable names, v1 by its
 * fixed position), and that stays with each version's own reader.
 *
 * Everything below was recovered from TI.EXE and re-proven against DF.EXE; the
 * comments name what proves what, because every one of these fields cost
 * something to learn.
 */
import { pstrAtChecked } from "./binary";

/**
 * The 32-byte variable-list node of the globals container (see decodeVarSlots
 * for the crucial name/value pairing): [+0/+4 heap ptrs][+8 name: len byte +
 * chars, 12 bytes][+20 DFValue vtable][+24 type u16][+26 value 32-bit].
 */
export const NODE_STRIDE = 32;
export const NODE_NAME = 8;
export const NODE_VTABLE = 20;
export const NODE_TYPE = 24;
export const NODE_VALUE = 26;
/** DFValue type tags (node +24): 2 is a BOOLEAN (`true`/`false` in scripts —
 *  its value is still the inline 0/1), 4 a number (signed 32-bit
 *  inline), 3 a string whose value is a byte offset into the string-pool
 *  container. 2 and 4 are distinct RUNTIME types, not two number spellings:
 *  TI.EXE's boolean-taking commands check for exactly 2 (propvisible's
 *  argument fetch, `cmp word [esp], 2` at 0x416ed8) and its number-taking
 *  ones for exactly 4, and the wrong tag is the ignorable-but-endless DosBox
 *  dialog "A scripting error has occured … [Bad argument type.]" — measured
 *  by bisecting a port-written save down to exactly ten 02→04 tag bytes. */
export const DFVALUE_BOOLEAN = 2;
export const DFVALUE_STRING = 3;
export const DFVALUE_NUMBER_WRITTEN = 4;
/**
 * The globals blob's own header describes the string pool it owns: the u32 at +8
 * is the allocator's next free offset and the u32 at +12 the pool's size (see
 * {@link poolIntern}, which is what makes a written string readable by the
 * ORIGINAL engine and not just by this one). +16 is the pool's heap pointer,
 * rebuilt on load.
 */
export const POOL_MARK = 8;
export const POOL_SIZE = 12;

export interface SavedVar {
  name: string;
  /** DFValue type tag: 2 = boolean (0/1 inline), 4 = number (value inline),
   * 3 = string (value is a byte offset into the string-pool container that
   * follows the globals container). 2 and 4 are distinct runtime types —
   * see the tag constants above for the TI.EXE checks that enforce it. */
  type: number;
  /** the 16-bit payload: the number/boolean itself (type 2/4, signed), or the
   * string's byte offset in the pool (type 3, unsigned). */
  num: number;
  /** the decoded string for type-3 variables (from the pool), else null. Null
   * also when the pool is missing or the offset doesn't decode cleanly. */
  str: string | null;
}

/** Read a Pascal string at a fixed offset, or "" if it isn't a clean string. */
export function pstrField(d: Uint8Array, o: number): string {
  return pstrAtChecked(d, o, 1, 40) ?? "";
}

/** Read the Pascal string ([u8 len][chars]) at `off` in the string pool, or
 * null if the offset doesn't decode cleanly. "" (len 0) is a valid value. */
export function poolStringAt(pool: Uint8Array, off: number): string | null {
  return pstrAtChecked(pool, off, 0, 255);
}

/**
 * The DFValue vtable address THIS file's nodes were written with — read out of
 * the file rather than assumed.
 *
 * The value is a raw code pointer the original engine dumped along with every
 * node, so it is only a constant for as long as the engine is loaded at the same
 * address. Our own corpus made that look safe: all 109 shipped saves read
 * 0x00431e0f, so the byte pattern was the thing the node grid was located by. It
 * is not safe — a save a player made in DosBox reads 0x87c4596f (#179), and a
 * hardcoded pattern matches nothing in it, decodes zero variables, and loads a
 * room with the PREVIOUS game's mission, phase and every other global still in
 * place. Nothing announces that: the set opens, the characters are there, and
 * they act on a mission that is not the one you saved.
 *
 * So the grid is located by AGREEMENT instead. Whatever address a session ran
 * at, all of its nodes carry the same one, and the nodes are dense — the most
 * common word at +20 across every offset that looks like a node is the vtable,
 * by a margin of a hundred to one. Names of 12..15 chars overflow their 12-byte
 * name field and clobber their own vtable's low bytes, so they are left out of
 * the vote (and skipped byte-wise when matching, as before).
 */
export function nodeVtable(d: Uint8Array): number | null {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const votes = new Map<number, number>();
  for (let o = 0; o + NODE_STRIDE <= d.length; o++) {
    if (d[o + NODE_NAME] > 11) continue; // clobbers its own vtable — no vote
    if (pstrAtChecked(d, o + NODE_NAME, 1, 11) === null) continue;
    const vt = dv.getUint32(o + NODE_VTABLE, true);
    votes.set(vt, (votes.get(vt) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestN = 0;
  for (const [vt, n] of votes) {
    if (n > bestN) {
      bestN = n;
      best = vt;
    }
  }
  // one node's worth of coincidence is not a grid; a real list is ~100 nodes
  return bestN >= 8 ? best : null;
}

/** the slot walk shared by {@link decodeVars} and {@link recordOffsets}. */
export function decodeVarSlots(d: Uint8Array): { name: string; valueSlot: number }[] {
  const vt = nodeVtable(d);
  if (vt === null) return [];
  const VT = [vt & 0xff, (vt >>> 8) & 0xff, (vt >>> 16) & 0xff, (vt >>> 24) & 0xff];
  // the name field holds 1 length byte + up to 11 chars; names of 12..15 chars
  // spill into the vtable (see vtableAt)
  const nameAt = (slot: number): string | null => pstrAtChecked(d, slot + NODE_NAME, 1, 15);
  const vtableAt = (slot: number): boolean => {
    if (slot + 28 > d.length) return false;
    // a name longer than 11 chars overflows its 12-byte field and clobbers the
    // low vtable bytes (len - 11 of them); skip the clobbered ones
    const skip = Math.max(0, d[slot + NODE_NAME] - 11);
    for (let i = skip; i < 4; i++) if (d[slot + NODE_VTABLE + i] !== VT[i]) return false;
    return true;
  };
  let base = -1;
  for (let o = 0; o + NODE_STRIDE <= d.length; o++) {
    if (nameAt(o) !== null && vtableAt(o)) {
      base = o;
      break;
    }
  }
  if (base < 0) return [];
  const out: { name: string; valueSlot: number }[] = [];
  // The head node's own name pairs one stride BACK, into the blob header — the
  // list is laid out [header][node 0]… and the pairing makes the header the
  // head's DFValue. Its type/value land at header+20/+22, past the pool handle
  // at +0x10, so they are real bytes and not a read off the front of the
  // container. Measured across all 110 shipped saves (TAOOT: the head is
  // `clock`): missions 0-3 read type 3 -> "bedsit", and every mission-4 save
  // reads type 4 -> hrs*100+min, exactly what BOOTFILE's calctime writes there.
  const headName = nameAt(base);
  if (headName !== null && base - NODE_STRIDE + NODE_TYPE >= 0) {
    out.push({ name: headName, valueSlot: base - NODE_STRIDE });
  }
  for (let slot = base + NODE_STRIDE; slot + NODE_STRIDE <= d.length; slot += NODE_STRIDE) {
    const name = nameAt(slot);
    if (name === null || !vtableAt(slot - NODE_STRIDE)) continue;
    out.push({ name, valueSlot: slot - NODE_STRIDE });
  }
  return out;
}

/**
 * Decode the variable list from the globals container (+ its string pool, the
 * container that follows it in the file — TI.EXE's loader reads them as a pair
 * and stores the pool handle at blob+0x10).
 *
 * The blob is a small header followed by 32-byte list nodes. Each node's fields
 * sit at fixed offsets: [+0/+4 heap ptrs][+8 name: len byte + chars][+20 DFValue
 * vtable 0x00431e0f][+24 type u16][+26 value 32-bit]. The crucial subtlety
 * (recovered by decompiling TI.EXE's writer and cross-checking same-session
 * DosBox save pairs): the C++ object is laid out [DFValue][links][name], so the
 * DFValue in node k belongs to the name in node k+1 — a node's name pairs with
 * the PREVIOUS node's value. The first name ("clock", the list head) pairs with
 * the header, which holds no DFValue, so it is not decodable here.
 *
 * Value semantics by type tag: 2 and 4 = a number, inline (signed 32-bit);
 * 3 = a string, the value being its byte offset in the pool ([len][chars]).
 * The pool is a live engine structure saved and restored wholesale, which is
 * why the offsets stay valid across processes.
 *
 * **The number is 32 bits wide, not 16** ([#221](https://github.com/dhobi/dreamrefactory/issues/221)).
 * A word was read here for a long time, which is right for every variable the
 * game keeps a phase or a count in and wrong for the handful it keeps a FRAME
 * STAMP in. The node has room for it — the value field runs +26..+30 inside a
 * 32-byte node — and the corpus settles it: across all 109 shipped saves the
 * high word is 0 in every string (3380 records) and every boolean (1015), and
 * non-zero in exactly six numbers, all of which read as nonsense truncated to a
 * word and as the obvious thing at full width — `lowmemory` = 6144000 (a byte
 * count), `condensor` = 40000, and the four frame stamps `secframe`,
 * `lastsail`, `jonesframe`, `paintframe`, each landing a few hundred frames
 * below the save's own frame counter ({@link SaveGame.frame}). Reading
 * `paintframe` as a word is what stopped the cargo-hold painting timer from
 * surviving a save.
 *
 * Names up to 15 chars overflow the 12-byte name field and clobber the low
 * bytes of their own node's vtable (a DreamFactory quirk the original engine
 * tolerates); validation skips the clobbered bytes.
 */
export function decodeVars(d: Uint8Array, pool?: Uint8Array): SavedVar[] {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const vars: SavedVar[] = [];
  for (const { name, valueSlot } of decodeVarSlots(d)) {
    const type = dv.getUint16(valueSlot + NODE_TYPE, true);
    const num = type === DFVALUE_STRING
      ? dv.getUint16(valueSlot + NODE_VALUE, true)
      : dv.getInt32(valueSlot + NODE_VALUE, true);
    const str = type === DFVALUE_STRING && pool ? poolStringAt(pool, num) : null;
    vars.push({ name, type, num, str });
  }
  return vars;
}

/**
 * Map of variable name → the slot holding ITS DFValue within the globals
 * container. Because a name pairs with the previous node's value (see
 * {@link decodeVars}), that is the slot before the one carrying the name;
 * type/value live at that offset +24/+26. First occurrence wins (list order).
 */
/**
 * Every slot a name decodes at, not just the first — because a shipped save can
 * hold the same name more than once and the two ends of this format disagree
 * about which one counts.
 *
 * {@link recordOffsets} keeps the FIRST, and that is what the writer patches.
 * A reader building a map — `parseSaveV1`'s `numGlobals.set(v.name, …)` over
 * {@link decodeVars} — keeps the LAST. So on a base with a duplicate, a value
 * written perfectly reads back as whatever the other copy held: Dust's
 * `D2A_001.RTD` carries `mwifelike` at two adjacent slots, and a patch that set
 * it to 3 came back as -3.
 *
 * The duplicates are the base's own — measured before any patch touches it,
 * `mwifelike` twice and `dealercount`, `dealerstand` and `dealerdowncard` three
 * times each, the same blackjack records {@link poolFloor} already knows hold
 * stale pool offsets. Whether they are real list nodes or leftovers this
 * scanner is permissive enough to accept, they are the same VARIABLE, so the
 * answer is not to pick a winner: write them all, and every reader agrees.
 */
export function recordSlots(d: Uint8Array): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const { name, valueSlot } of decodeVarSlots(d)) {
    out.set(name, [...(out.get(name) ?? []), valueSlot]);
  }
  return out;
}

export function recordOffsets(d: Uint8Array): Map<string, number> {
  const out = new Map<string, number>();
  const vars = decodeVarSlots(d);
  for (const { name, valueSlot } of vars) if (!out.has(name)) out.set(name, valueSlot);
  return out;
}

/**
 * Make a variable record for a name the base save has never held, using a FREE
 * slot of its node array, and answer the slot the DFValue goes in — or -1 when
 * there is no room.
 *
 * ## Why a record has to be makeable at all
 *
 * A `.ti` carries the variable list that existed when it was taken, and the
 * engine creates a global on first assignment, so an early save simply has no
 * record for a later one. `savedeck` and `hallside` are the ones that cost
 * something: they are absent from exactly the four pre-boarding saves of the 109
 * shipped, and `shippedSaveTemplate` picks the first file in `save/1`, which is
 * one of them. With that template 12 of the globals the engine holds by mission 2
 * could not be written at all — the deck the staircase shows, the side of the
 * hallway you are on, the map's jump target.
 *
 * ## Why it does not grow anything
 *
 * A save has to load in the ORIGINAL engine, not only in this port, and the blob
 * describes its own storage: `length = 20 + 32 × capacity` for the node array
 * (the u16 at +2), and the pool's size at +12 (see {@link poolIntern}). TI.EXE
 * allocates from those and copies the container in, so a container that has grown
 * past what its own header declares is either truncated on load or overflows the
 * block it is copied into — and neither is something to find out about from a
 * corrupted DosBox session.
 *
 * Filling a FREE slot needs no such bet. Most shipped saves have some (4 spare
 * NODES in the London flat save, 26 in the smokestack one — which is 3 and 13 new
 * *globals*, since the first one made costs two nodes and each after it one; see
 * {@link globalsCapacity}, and note 11 of the 109 have none at all): the array is
 * allocated at `capacity`
 * and the engine takes the next slot when a script assigns a new global — which
 * is precisely the gesture being reproduced here, at the same stride, inside the
 * same block, with the same length in the header. The file stays exactly the shape
 * the original writes.
 *
 * The room this leaves is finite, so the caller has to choose what gets it (see
 * {@link NEW_RECORD_PRIORITY}) and say what it dropped.
 *
 * ## How the slot is written
 *
 * The pairing quirk (see {@link decodeVars}) does the work: a node's name pairs
 * with the PREVIOUS node's DFValue, so the LAST named node's own DFValue belongs
 * to nobody — dangling, and zero in every shipped save. A name written one stride
 * past it adopts that DFValue and leaves its own as the next dangling one, so
 * there is nothing to relink.
 *
 * The u16 at +0 is NOT touched. It reads as a node count in one save (96, against
 * 96 names in 1/01) and cannot be one in the next (92, against the same 96 names
 * in 1/04), so whatever it counts is not the list length and guessing would be
 * inventing a fact.
 */
export function newVarRecord(container: { data: Uint8Array }, name: string): number {
  if (!name.length || name.length > 15) return -1;
  const slots = decodeVarSlots(container.data);
  if (!slots.length) return -1;
  // the dangling DFValue sits one stride past the last name's value slot; the new
  // name goes one stride past THAT
  const valueSlot = slots[slots.length - 1].valueSlot + NODE_STRIDE;
  const nameSlot = valueSlot + NODE_STRIDE;
  // the whole node must fit as it stands — no growing, for the reason above. A
  // full stride rather than just the name+vtable, so the NEXT one can pair
  // against this node's DFValue too.
  if (nameSlot + NODE_STRIDE > container.data.length) return -1;
  const d = container.data;
  // ...with the base's OWN vtable, not a constant: the pointer is whatever
  // address the session that wrote this file ran at (see {@link nodeVtable}),
  // and a node stamped with a different one is a node neither reader finds.
  const vt = nodeVtable(d);
  if (vt === null) return -1;
  /*
   * The vtable the NEW name is validated by is the PREVIOUS node's, and on a
   * base whose list ends here it has never had to be right.
   *
   * `decodeVarSlots` checks `vtableAt(slot - NODE_STRIDE)` for a name at `slot`,
   * so a record made at the frontier is read through the bytes at `valueSlot`,
   * which is the last existing record's own name slot. Nothing in the original
   * ever reads that one — no node followed it — so it can be anything, and on
   * Dust's `D1E_001.RTD` it is not the vtable. The record was written, returned a
   * slot, and then simply did not exist: five calls in a row all answered 3132
   * and `decodeVarSlots` stayed at 92 records, so a patch needing eleven new
   * globals kept overwriting one invisible node and lost all but the last.
   *
   * Only the bytes the previous name does not occupy, mirroring `vtableAt`'s own
   * tolerance: a name over 11 characters legitimately spills into the low bytes,
   * and putting the vtable back over it would truncate the name instead.
   */
  const prevSkip = Math.max(0, Math.min(4, d[valueSlot + NODE_NAME] - 11));
  for (let i = prevSkip; i < 4; i++) d[valueSlot + NODE_VTABLE + i] = (vt >>> (8 * i)) & 0xff;
  // The vtable FIRST, then the name over the top of it. That order is the format's
  // own: the name field holds 1 length byte + 11 characters before it runs into the
  // vtable, and a longer name overflows into it — which is why `attentionspan` and
  // `curattention` sit on clobbered vtables in the shipped saves, and why reading
  // one skips the clobbered bytes. Writing the vtable last would win that collision
  // instead and truncate the name, which no real save does.
  for (let i = 0; i < 4; i++) d[nameSlot + NODE_VTABLE + i] = (vt >>> (8 * i)) & 0xff;
  d[nameSlot + NODE_NAME] = name.length;
  for (let j = 0; j < name.length; j++) d[nameSlot + NODE_NAME + 1 + j] = name.charCodeAt(j) & 0xff;
  return valueSlot;
}

/**
 * Make room in the globals blob and its string pool for every name a patch is
 * about to write, so nothing has to be dropped (#357).
 *
 * Dust is why this exists. Its bases are small — 92 to 142 records across the 56
 * shipped `.RTD` files, with 2 to 18 free nodes each and a ceiling of 94 to 160
 * against the 170 globals known between them — so a session that has grown past
 * its base has nowhere to put the difference. Measured at every rung of the
 * playthrough, with each rung's own save as its base, 31 of 55 dropped something,
 * `handitem` twice: the item in the player's hand, lost to a full string pool.
 *
 * Two ways of finding room, in this order, because they cost different things:
 *
 *  1. **Recycle a dead record.** The variable list is the engine's WHOLE list,
 *     saved and read back wholesale (see the note on {@link decodeVars}), so a
 *     record for a name the patch does not carry describes a variable that no
 *     longer exists. Renaming it in place is free: the node keeps its vtable and
 *     its paired DFValue slot, and the file grows by nothing. The vtable is
 *     rewritten before the name for the reason {@link newVarRecord} gives —
 *     a name over 11 characters clobbers the low bytes, and a rename that
 *     shortens one has to put them back.
 *  2. **Grow the container**, by whole nodes, and only by as many as are still
 *     missing. A zeroed tail is invisible to {@link decodeVarSlots}, which skips
 *     any slot without a name and a matching vtable, and {@link writeSaveFile}
 *     takes each container's length from its data — so a longer blob is a longer
 *     file with a rebuilt position table and nothing else.
 *
 * The pool is grown the same way when the strings a patch wants will not fit,
 * with the capacity word in the blob header moved with it: {@link poolIntern}
 * refuses to allocate unless the header and the container agree on the size.
 *
 * Growing is a departure from this file's usual rule — reproduce every byte you
 * were given — and it is taken deliberately and narrowly. A patch that fits grows
 * nothing and is byte-for-byte what it was before. What the original's own reader
 * makes of a longer blob is untested: it is a heap block with its length in the
 * container table, so there is reason to think it is read back the same way, but
 * nothing here has confirmed it against DUST.EXE.
 */
export function ensureVarRoom(
  globals: { data: Uint8Array },
  pool: { data: Uint8Array },
  names: Iterable<string>,
  strings: Iterable<string>,
): void {
  const want = [...names].filter((n) => n.length > 0 && n.length <= 15);
  const have = recordOffsets(globals.data);
  const missing = want.filter((n) => !have.has(n));
  if (missing.length) {
    /*
     * 1. Dead records first — a name the patch does not carry no longer exists.
     *
     * Only where BOTH names fit the 12-byte field, and that guard is the whole
     * of the care this needs. A node's vtable is the validator for the NEXT
     * node's name (`decodeVarSlots` checks `vtableAt(slot - NODE_STRIDE)`), and
     * a name over 11 characters spills into it — so a rename across that
     * boundary either clobbers a vtable that was intact or restores one that was
     * legitimately clobbered, and either way the record one stride along changes
     * its mind about existing.
     *
     * Restoring is the worse of the two: it resurrects whatever leftover bytes
     * sit in the next slot as a record. Measured before this guard, writing the
     * vtable on every rename brought `dealercount` and `dealerstand` back from
     * the dead three times over and gave `mwifelike` a twin one stride along,
     * which the writer then filled from a different variable — the round trip
     * read 3 back as -3.
     *
     * Both names short means the vtable is untouched by either the old name or
     * the new one, so it is left exactly as it was and nothing downstream moves.
     * A name of 12 to 15 characters does not recycle; it grows instead.
     */
    const FITS_FIELD = 11;
    const wanted = new Set(want);
    const dead = decodeVarSlots(globals.data)
      .filter((v) => !wanted.has(v.name) && v.name.length <= FITS_FIELD)
      .map((v) => v.valueSlot + NODE_STRIDE);
    let taken = 0;
    for (const name of missing) {
      if (taken >= dead.length) break;
      if (name.length > FITS_FIELD) continue;
      const at = dead[taken++];
      if (at + NODE_STRIDE > globals.data.length) continue;
      const d = globals.data;
      // the name field only — bytes 8..19. The vtable at 20 is the next node's
      // validator and is none of this rename's business.
      for (let j = 0; j < 12; j++) d[at + NODE_NAME + j] = 0;
      d[at + NODE_NAME] = name.length;
      for (let j = 0; j < name.length; j++) d[at + NODE_NAME + 1 + j] = name.charCodeAt(j) & 0xff;
    }
    // 2. and grow for whatever is still homeless
    const short = missing.length - taken - freeVarSlots(globals.data);
    if (short > 0) {
      const grown = new Uint8Array(globals.data.length + short * NODE_STRIDE);
      grown.set(globals.data);
      globals.data = grown;
    }
  }

  /*
   * The pool: what these strings cost, against what is left above the floor.
   *
   * {@link poolIntern} will not allocate unless the header's size word and the
   * container agree, and on one shipped Dust save they do not: `BLDSTPZ.RTD`
   * carries a 4128-byte pool container whose header says 4106. The difference is
   * the container's own alignment padding, not a pool that is short — but the
   * mismatch drops `poolIntern` into reuse-only for the whole file, which is why
   * carrying the chest out of the building put `handitem` beyond saving.
   *
   * So the header is corrected to the room that is actually there, and the
   * container grown past it only when the strings will not fit even then. A
   * header claiming MORE than the container holds is the one case left alone:
   * that is not padding, it is a file this cannot reason about.
   */
  const dv = new DataView(globals.data.buffer, globals.data.byteOffset, globals.data.byteLength);
  let capacity = dv.getUint32(POOL_SIZE, true);
  if (capacity > pool.data.length) return;
  if (capacity < pool.data.length) {
    // padding, not a short pool — say so, or poolIntern stays in reuse-only for
    // the whole file however much room is really there
    capacity = pool.data.length;
    dv.setUint32(POOL_SIZE, capacity, true);
  }
  const floor = poolFloor(globals.data, pool.data, dv.getUint32(POOL_MARK, true));
  let need = 0;
  for (const text of strings) {
    if (text.length > 0xff) continue; // never storable; poolIntern reports it
    if (poolFind(pool.data, text, floor) >= 0) continue;
    need += 1 + text.length;
  }
  if (floor + need <= capacity) return;
  const size = Math.max(pool.data.length, floor + need);
  if (size > pool.data.length) {
    const grown = new Uint8Array(size);
    grown.set(pool.data);
    pool.data = grown;
  }
  dv.setUint32(POOL_SIZE, size, true);
}

/**
 * How many more variable records {@link newVarRecord} could make in this globals
 * container — its own rule, counted instead of performed.
 *
 * That rule is: the new name goes two nodes past the last name's DFValue and the
 * whole node has to fit. A record made that way leaves its own DFValue as the next
 * dangling one, so every record after the first advances the frontier by a single
 * node — which is why 4 spare nodes are 3 new globals and not 4.
 */
export function freeVarSlots(d: Uint8Array): number {
  const slots = decodeVarSlots(d);
  if (!slots.length) return 0;
  const frontier = slots[slots.length - 1].valueSlot + 3 * NODE_STRIDE;
  return frontier > d.length ? 0 : Math.floor((d.length - frontier) / NODE_STRIDE) + 1;
}

/** Find the byte offset of Pascal string `s` in the pool below `limit`, or -1. */
export function poolFind(pool: Uint8Array, s: string, limit = pool.length): number {
  for (let p = 0; p < limit; ) {
    const n = pool[p];
    if (p + 1 + n > pool.length) return -1;
    if (n === s.length) {
      let eq = true;
      for (let j = 0; j < n; j++) if (pool[p + 1 + j] !== s.charCodeAt(j)) { eq = false; break; }
      if (eq) return p;
    }
    p += 1 + n;
  }
  return -1;
}

/**
 * The pool offset for a string, ALLOCATING it in the pool if the base save has
 * never held it — at the pool allocator's own watermark, inside the block.
 *
 * A string global's value is a `Uint16` offset into the globals' string pool, so
 * a patch can only name strings that are in there. Refusing to add them was a
 * quiet way to lose story state: a save taken after mission 1's Enigma work came
 * back with `zeitclue = 0` instead of "decoder", and PENNY1.PUP's `m1p4()` calls
 * `error()` when it is neither "decoder" nor "mirror" — so the debrief that ends
 * mission 1 could not be held at all. `handitem` and `savedeck` went the same
 * way ("rubaiyat", "boil3").
 *
 * ## The watermark, and why this no longer appends past the end
 *
 * The blob describes the pool it owns: the u32 at **+12 is the pool's size** —
 * 2048 in every one of the 109 shipped saves, and equal to the pool container's
 * length in every one of them — and the u32 at **+8 is the allocator's next free
 * offset**: it is exactly the end of the highest string any variable points at in
 * 81 of the 109, and past it (an allocation whose variable was later overwritten)
 * in the rest. +16 is the pool's heap pointer, which the loader rebuilds.
 *
 * The first version of this appended to the END of the container instead, leaving
 * a pool longer than the size its own header declares. This port reads a string
 * by offset and never notices; TI.EXE allocates +12 bytes and copies the container
 * into it, so an over-long pool is either truncated (the string is lost, silently)
 * or copied past the end of its block. A save has to load in the original engine,
 * so allocating the way the original allocator does — bump the watermark, stay
 * inside the block — is the only version of this that is safe in both. The
 * template has 1930 of its 2048 bytes free, so in practice everything fits.
 *
 * -1 means the string cannot be represented (no room, or longer than a Pascal
 * string), and the caller leaves that global as it found it.
 */
export function poolIntern(globals: Uint8Array, pool: { data: Uint8Array }, s: string): number {
  if (s.length > 0xff) return -1;
  const dv = new DataView(globals.buffer, globals.byteOffset, globals.byteLength);
  const capacity = dv.getUint32(POOL_SIZE, true);
  const mark = dv.getUint32(POOL_MARK, true);
  // only trust the watermark on a base whose header describes the pool we have;
  // otherwise fall back to reuse-only, which cannot make the file inconsistent
  const sound = capacity === pool.data.length && mark > 0 && mark <= pool.data.length;
  const found = poolFind(pool.data, s, sound ? mark : pool.data.length);
  if (found >= 0) return found;
  if (!sound) return -1;
  const at = poolFloor(globals, pool.data, mark);
  if (at + 1 + s.length > capacity || at + 1 + s.length > 0xffff) return -1;
  pool.data[at] = s.length;
  for (let j = 0; j < s.length; j++) pool.data[at + 1 + j] = s.charCodeAt(j) & 0xff;
  dv.setUint32(POOL_MARK, at + 1 + s.length, true);
  return at;
}

/**
 * The lowest offset it is safe to allocate at: the allocator's watermark, or past
 * the end of any string a record still points at — whichever is higher.
 *
 * They are usually the same thing, and in the template they are exactly the same
 * (both 118). In 28 of the 109 shipped saves they are not: a record holds a stale
 * offset ABOVE the watermark, in pool space that is still zeroed, so it decodes as
 * the empty string — the blackjack down-cards do this, and `saveeast`. Allocating
 * at the watermark alone would eventually write real bytes under one of those
 * offsets and turn that variable's "" into whatever landed there, in this engine
 * and the original alike. Starting above both means a patch cannot change the value
 * of a global it was never asked to touch.
 */
export function poolFloor(globals: Uint8Array, pool: Uint8Array, mark: number): number {
  let end = mark;
  for (const v of decodeVars(globals, pool)) {
    if (v.type === DFVALUE_STRING && v.str !== null) end = Math.max(end, v.num + 1 + v.str.length);
  }
  return end;
}

/**
 * Overwrite a Pascal string in place: length byte + up to 15 characters (the
 * set/scene/view fields in container 1 sit on a 16-byte stride). Bytes past the
 * new string are left as they were — the loader reads only `len` characters, and
 * zeroing them would clobber adjacent meaningful bytes.
 */
export function writePstrField(d: Uint8Array, off: number, s: string, max = 15): void {
  const n = Math.min(s.length, max);
  d[off] = n;
  for (let j = 0; j < n; j++) d[off + 1 + j] = s.charCodeAt(j);
}
