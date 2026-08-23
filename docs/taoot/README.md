# Titanic: Adventure Out of Time

CyberFlix, 1996, on **DreamFactory 4**. Two discs, six languages, a demo, and a
ship that sinks on a clock.

This section is about the game rather than the engine: what it is, how its story
is gated, what makes its one timed mission run, which editions exist, and how a
reimplementation of it was checked against the original. For the machinery any of
that stands on, see [the engine](../engine/).

- [How the game works](../engine/how-a-game-works.md) — the shape of the whole thing:
  rooms, movies, conversations, the missions
- [The mission flow](mission-flow.md) — the story as data: the globals that gate
  every branch, recovered from the scripts themselves
- [The sinking](sinking.md) — mission 4 is the only part that plays against a
  clock, and the clock is on your wrist
- [Languages & the chooser](languages.md) — six pressings, six code pages, and a
  chooser stage this port authored because the original shipped one language per
  install
- [How we know it's right](verification.md) — what was checked, against what, and
  what "right" was allowed to mean

## The code

`taoot/` in the repository. Four pages — the front page, `/play/`,
`/collection/`, and the unlisted `/speedrun/` workbench — the six editions and
the demo, its own tools, and the suites that play the game through to the end.

Being the game the engine was recovered *from*, it also carries most of the
project's evidence:

| | |
|---|---|
| `taoot/tests/auto/` | 30 files, 466 tests — nearly all the behavioural coverage there is ([the inventory](../reference/tests.md)) |
| `taoot/tests/playthrough/` | the game played from boot to credits in one session, 27 segments ([the route](../reference/route.md)) |
| `taoot/tests/browser/` | the same route through a real page, diffed against the same trace |
| `taoot/tests/speedrun/` | that route written as a sheet and driven against the clock |
| `taoot/tools/` | the `TI.EXE` mining tools, the flow map, the deck-map extractor, the language chooser and the intro film ([the tools](../reference/tools.md)) |

The engine underneath is game-agnostic and lives in `engine/` — where the line
falls, and why, is [the architecture map](../engine/architecture.md).

Back to [Documentation](../README.md).
