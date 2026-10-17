/**
 * Pausing NESTS, in every engine: a loop or walk record keeps a depth at +2, a
 * pause adds one and a resume takes one off, never below 0, and the record is
 * held while it is above 0 — DF.EXE `pauseloop` 0x43904d/0x4390aa, `pausewalk`
 * 0x439a16/0x439a6b; TI.EXE 0x43b66d (loops), 0x43c9c6 (walks); tl.exe
 * 0x401cdd, 0x403036; RedJack.exe 0x41c2c3 (loops), 0x41d50e (walks). Sets
 * `paused` to match, which is what everything else reads.
 */
export function pauseDepth(rec: { paused: boolean; pauseDepth?: number }, on: boolean): void {
  const depth = rec.pauseDepth ?? (rec.paused ? 1 : 0);
  rec.pauseDepth = on ? depth + 1 : Math.max(0, depth - 1);
  rec.paused = rec.pauseDepth > 0;
}

/** how deep a record's pause is — 0 for no record (the getters' answer) */
export function pauseDepthOf(rec?: { paused: boolean; pauseDepth?: number }): number {
  if (!rec) return 0;
  return rec.pauseDepth ?? (rec.paused ? 1 : 0);
}
