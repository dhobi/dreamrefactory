# The engine

CyberFlix's **DreamFactory** engine, reimplemented in TypeScript from the files
rather than from the source. This section is about the machine: what its
containers hold, what its scripts say, and how the port runs them. Nothing here
is about one particular game — where a page cites *Titanic* or *Dust*, it is
citing the evidence, because the machinery was recovered from what those two
discs actually contain.

Two generations of it ship in this repository, and the difference matters often
enough to be worth stating once: **DreamFactory 1** is what *Dust: A Tale of the
Wired West* ran on in 1995, and **DreamFactory 4** is what *Titanic: Adventure
Out of Time* ran on in 1996. Two years apart, the same lineage, and different
enough on disk that several formats have a `-v1` page of their own.

## Start with these

- [Engine architecture](architecture.md) — the map: every module, and the format
  or runtime page that explains it
- [The scripting language](scripting-language.md) — the language the whole game's
  logic is written in, and the grammar recovered for it

## Then the two halves

- **[File formats](formats/)** — the DFile container and every format inside it:
  rooms, props, films, stages, characters, audio, saved games. The reading and
  the writing, since the port does both.
- **[Runtime](runtime/)** — what happens when those files are played: the
  heartbeat, the stage layer, actors and puppets, audio channels, saving and
  loading, and the browser host it all sits in.

The code is `engine/` in the repository — `src/df/` for the formats, `src/runtime/`
for the machine, `src/web/` for the browser it runs in. It imports nothing from
either game, which is a rule with a test behind it
(`site/tests/layering.ts`).

Back to [Documentation](../README.md).
