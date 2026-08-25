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
    return super.get(k.toLowerCase());
  }
  override set(k: string, v: V): this {
    return super.set(k.toLowerCase(), v);
  }
  override has(k: string): boolean {
    return super.has(k.toLowerCase());
  }
  override delete(k: string): boolean {
    return super.delete(k.toLowerCase());
  }
}
