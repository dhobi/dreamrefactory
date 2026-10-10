One rung of [the golden thread](../../../../docs/dust/thread.md) per file: the
opening, the rungs from `D2A_006` on, the first night's `D1E_001`–`D1E_006`, and
the puzzles and the ending. The rungs from `D1E_006` to `D2A_005` are written
inline in [`segments.ts`](../segments.ts), which also puts every rung in its
order; everything they are written out of lives in [`route.ts`](../route.ts).

A rung is independent of every other rung: both its ends are shipped saves, and
the runner loads `from` off the disc. So they can be written in any order, and
by more than one person at a time. The opening is the exception at the start:
there is no save before `D1E_001`, so it begins at the cold boot.
