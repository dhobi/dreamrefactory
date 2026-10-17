/**
 * One sound's record in a bank's chunk table: its name and the container that
 * holds it. Its own file because two readers make it: banks.ts, from a TRK/SFX
 * bank or a MOV soundtrack (DreamFactory 4), and snd.ts, from a `.SND` bank
 * (DreamFactory 1), which gives its sounds the same shape so a consumer does not
 * care which engine wrote the bank.
 */
export interface BankChunk {
  identifier: string;
  containerLoc: number;
  /**
   * Offset of this record's identifier field (its Pascal length byte) inside
   * the table container it was read from — the anchor
   * `patchChunkIdentifier` (banks.ts) renames it at.
   */
  idOffset: number;
  /**
   * The record's SECOND name field, read only when the caller asks for one —
   * a MOV one-shot record carries the frame its sound carries the picture on to
   * (see MovSegment.soundFollows). "" when absent or not asked for.
   */
  follow: string;
}
