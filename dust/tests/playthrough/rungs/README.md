One rung of [the golden thread](../../../../docs/dust/thread.md) per file, from
`D2A_006` on. The earlier thirteen are still in
[`segments.ts`](../segments.ts); everything they are written out of lives in
[`route.ts`](../route.ts).

A rung is independent of every other rung: both its ends are shipped saves, and
the runner loads `from` off the disc. So they can be written in any order, and
by more than one person at a time.
