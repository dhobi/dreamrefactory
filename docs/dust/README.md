# Dust: A Tale of the Wired West

CyberFlix, 1995, on **DreamFactory 1** — the engine two years before *Titanic*,
and the reason several formats in this documentation have a `-v1` page beside
them.

One CD, one language, no edition axis, and a town you can walk around. It exists
in this repository to answer a question rather than to be finished: **how much of
a port written against DreamFactory 4 can read DreamFactory 1 at all?** Enough,
so far, to open on its films and walk into the town.

This section is a stub, and honestly so — Dust's own pages get written as its
behaviour is recovered. What already exists is elsewhere, because it is about the
engine rather than about this game:

- [Saved games, DF1 (.rtd)](../engine/formats/savegame-v1.md) — Dust's save
  format, rewritten from DF.EXE's own record layout
- [Saving & loading](../engine/runtime/saves.md) — both halves, v1 and v4, and
  what a load actually is
- [The DFile container format](../engine/formats/) — each format page says what
  DreamFactory 1 does differently

## What is different, in one paragraph

There is no disc to mount: Dust is one CD, so nothing does `setpath(disk)`. Its
SET addresses a standpoint by grid cell and facing rather than by the numbered
views a v4 set uses. Its ambience is one track rather than a crowd of reopened
containers. Its saves are `.rtd` and carry world coordinates that a v4 prop
record does not have at all. And its town exists twice — `town.set` by day and
`nite.set` by night — which turns out to matter to a save format.

The code is `dust/` in the repository: one page, its own tools, its own disc.

Back to [Documentation](../README.md).
