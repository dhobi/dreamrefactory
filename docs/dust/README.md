# Dust: A Tale of the Wired West

CyberFlix, 1995, on **DreamFactory 1** — the engine two years before *Titanic*,
and the reason several formats in this documentation have a `-v1` reader beside
them.

One CD, one language, no edition axis, and a town you can walk around. It exists
in this repository to answer a question rather than to be finished: **how much of
a port written against DreamFactory 4 can read DreamFactory 1 at all?** The
answer has kept turning out to be *more than expected*, and that is the finding
— the container envelope, the frame codec, the palette shape, the script
bytecode and its opcode numbering, and the PUP and CST record layouts are all
frozen across the two engines. What moved is the per-format container-0 header,
plus two things that changed in kind rather than in layout: how a set describes
movement, and how a bank names its sounds.

## What runs today

The page boots off the real disc, through the same `GameHost` Titanic uses:

- **the boot**, out of the disc's own `BOOTFILE` — which is not in `DATA/` but
  at `INSTALL/ALT31/BOOTFILE`, beside the installer's copy of `DF.EXE`;
- **the intro films**, played by the engine's own `MoviePlayer` over
  [`mov-v1.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/mov-v1.ts),
  including the frame flag that says *hold this frame until the sound it started
  has finished* — which is what makes the dog at the edge of town growl twice
  instead of once ([#278](https://github.com/dhobi/dreamrefactory/issues/278));
- **the town**, walked with the three controls the original had, because its set
  scripts handle exactly `uparrow`, `leftarrow` and `rightarrow`;
- **saved games** — its own `.rtd` in its own IndexedDB database, seeded from
  the five that ship beside the disc;
- **the control panel**, a full-screen flat with its buttons drawn on it;
- **a collection page**, for how to run the 1995 DOS game instead of this port
  of it.

## What is different, in one paragraph

There is no disc to mount: Dust is one CD, so nothing does `setpath(disk)`. Its
SET addresses a standpoint by grid cell and facing rather than by the numbered
views a v4 set uses. **Its films are the format that diverges most** — a frame
names the frame after it, can block until the sound it started has finished,
and carries typed click records rather than a region table. Its ambience is one
track rather than a crowd of reopened containers. Its saves are `.rtd` and carry
world coordinates that a v4 prop record does not have at all. And its town
exists twice — `town.set` by day and `nite.set` by night — which turns out to
matter to a save format.

## The pages here

- **[Music & sound — the 40 banks](audio.md)** — why `.SND` is not `.TRK`, and
  the trap that the name a script asks for is frequently not the file's

## And the engine pages that carry Dust's half

Most of what is true about Dust is true about *DreamFactory 1*, so it is written
up with the engine rather than here:

| | |
|---|---|
| [SET — DreamFactory 1](../engine/formats/set.md#dreamfactory-1-dust) | the grid of cells and one flat transition table, and the adapter that hands it to the viewer as if it were a v4 set |
| [MOV — DreamFactory 1](../engine/formats/mov.md#dreamfactory-1-dust) | the chain-of-segments model survives and almost every mechanic under it differs — **the format where the two engines diverge most** |
| [Saved games, DF1 (`.rtd`)](../engine/formats/savegame-v1.md) | the same save container three years earlier, rewritten from `DF.EXE`'s own record layout |
| [Saving & loading](../engine/runtime/saves.md) | both halves, v1 and v4, and what a load actually is |
| [The DFile container format](../engine/formats/README.md) | the envelope, unchanged between the two |

## The code

`dust/` in the repository: two pages, its own disc, its own tools and suites.
[The architecture map](../engine/architecture.md#dust-—-dust-s-shell) has the file
list; the short version is that the shell is three modules, because one volume
and one edition need much less than six editions and two CDs.

Its suites are `dust/tests/` — the movie layout against the whole disc, the
player on a clock, and the `.rtd` round trip — and all three **skip** rather
than fail without a rip, which is why the CI runner treats Dust's disc as
optional ([Continuous integration](../reference/ci.md)). Its tools are
`dust/tools/`: `dustsets.ts`, the sweep the v1 SET reader was built against, and
`mkdustlogo.ts` for the title card.

Back to [Documentation](../README.md).
