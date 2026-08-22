# Titanic: Adventure Out of Time

CyberFlix, 1996, on **DreamFactory 4**. Two discs, six languages, a demo, and a
ship that sinks on a clock.

This section is about the game rather than the engine: what it is, how its story
is gated, what makes its one timed mission run, which editions exist, and how a
reimplementation of it was checked against the original. For the machinery any of
that stands on, see [the engine](../engine/).

- [How the game works](how-the-game-works.md) — the shape of the whole thing:
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

The code is `taoot/` in the repository: the pages, the six editions and the demo,
its own tools, and the suites that play the game through to the end.

Back to [Documentation](../README.md).
