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
- [Developer mode](devmode.md) — the 1996 debug build put back up: one edited
  line, TI.EXE's own menu bar, and what `debugging` opens
  - [The census](devmode-census.md) — every read of the flag and every modifier
    probe in the corpus, generated, with what each branch does
- [Free roam](freeroam.md) — the guided tour `playmode.mov` offers, entered
  directly, and the six doors that answer one with a knock
- [TH mode](../engine/runtime/th-mode.md) — the room alone on a wide display, the
  menu band sliding in when it is wanted, after
  [Tyler Hartman's fullscreen builds](https://github.com/TylerHartman/Titanic-Adventure-Out-Of-Time-Fullscreen)
- [How we know it's right](verification.md) — what was checked, against what, and
  what "right" was allowed to mean

## The code

`taoot/` in the repository. The front page, `/play/`, `/freeroam/`,
`/collection/`, and the unlisted `/speedrun/` workbench and `/devmode/` — the six
editions and the demo, its own tools, and the suites that play the game through
to the end.

Being the game the engine was recovered *from*, it also carries most of the
project's evidence:

| | |
|---|---|
| `taoot/tests/auto/` | nearly all the behavioural coverage there is ([the inventory](../reference/tests.md)) |
| `taoot/tests/playthrough/` | the game played from boot to credits in one session, 27 segments ([the route](../reference/route.md)) |
| `taoot/tests/browser/` | the same route through a real page, diffed against the same trace |
| `taoot/tests/speedrun/` | that route written as a sheet and driven against the clock |
| `taoot/tools/` | the `TI.EXE` mining tools, the flow map, the deck-map extractor, the language chooser and the intro film ([the tools](../reference/tools.md)) |

The engine underneath is game-agnostic and lives in `engine/` — where the line
falls, and why, is [the architecture map](../engine/architecture.md).

Back to [Documentation](../README.md).
