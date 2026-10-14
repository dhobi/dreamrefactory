/**
 * Maps keyed the way DreamFactory names things: without regard to case.
 *
 * The language folds case, and not as a convenience — the shipped scripts
 * *depend* on it. The journal's pickup is four lines and spends two of them
 * relying on it (i001.stg container 1742):
 *
 *     global debugging, gJournalTaken
 *     Playsound ("ESTOUCHC", 255)
 *     gJournalTaken = 1
 *     gotoflat (baseflat)
 *
 *   - `gJournalTaken` against the `gjournaltaken` of every reader: both
 *     `enterframe`s that put the journal back on the ground, the panel's
 *     `dojournal`, and the BOOTFILE's own initialiser.
 *   - `Playsound` against the boot library's `PlaySound` — a handler, not an
 *     engine builtin, so this one is resolved through the code tables.
 *
 * A case-sensitive port turns each into a silent no-op: a second variable nobody
 * reads, and a call that reaches no handler at all. They present as two
 * unrelated bugs — a journal that would not stay picked up, a pickup with no
 * sound — and they are one. The camera two flats away spells both names the way
 * everything else does and worked.
 *
 * Whether the corpus needs the same of VARIABLE names elsewhere is not settled
 * by those two; `openflatx` and `turnframerate`, checked because they looked
 * like candidates, are consistent in all of their call sites. This is here
 * because the language folds case, not because a survey found more.
 *
 * Subclassing Map rather than normalising at the call sites, so that everything
 * touching one of these is covered by construction. That matters most for the
 * things built at RUNTIME, which no compile-time pass could reach: the save
 * loaders restore whatever case the 1996 game wrote, and `variable("pic" @
 * numtostring (n))` composes a global's name out of a string.
 *
 * Iteration yields the folded key, which is the right thing to persist: the
 * original's own comparisons are caseless, so a save that records one spelling
 * reads back the same for every other.
 */
export class CaselessMap<V> extends Map<string, V> {
  override get(k: string): V | undefined {
    return super.get(foldAscii(k));
  }
  override set(k: string, v: V): this {
    return super.set(foldAscii(k), v);
  }
  override has(k: string): boolean {
    return super.has(foldAscii(k));
  }
  override delete(k: string): boolean {
    return super.delete(foldAscii(k));
  }
}

/**
 * Lower case the way the engines fold it: A-Z to a-z and no other character.
 * TI.EXE compares names and strings through the 256-byte table at 0x45c068 and
 * DF.EXE through 0x447478, and both move exactly those 26 bytes. A script's
 * strings are the tree's own code page read as bytes (df/text.ts), so
 * `toLowerCase` would also fold À to à, Ä to ä — letters the engines keep apart.
 */
export function foldAscii(s: string): string {
  return /[A-Z]/.test(s) ? s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) | 0x20)) : s;
}
