# Dust's music and sound — 40 banks, and what a script calls them

*Prerequisite: [Audio — TRK / SFX / 11K / SND](../engine/formats/audio.md) for the
container, and [Audio — channels & volumes](../engine/runtime/audio.md) for what
plays it.*

Dust spells an audio bank **`.SND`** where Titanic spells it `.TRK`, and stores it
differently: one table holding every sound, where a v4 bank has a loop table and a
one-shot table in separate containers. The port reads both
([`snd.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/snd.ts)),
and the [track editor](../editors/tracks.md) opens all forty.

## The name a script asks for is not the filename

This is the thing to know, and it is easy to trip on. `playnewtheme` and
`opentrackfile` are given a bank's **own stored name** — its `refName`, the string
at offset 158 — and that is frequently *not* what the file is called on the disc.
Worse, **several files answer to one name.**

| a script asks for | steps | the file that holds it |
|---|---|---|
| `"town.snd"` | 10 | `TOWN.SND` — `daymusic1`…`daymusic10` |
| `"town.snd"` | 5 | `NIGHT.SND` — `nightwind1`… |
| `"bountytheme"` | 16 | `BOUNTY.SND` |
| `"bountytheme"` | 31 | `KID.SND` |
| `"saloonsep.snd"` | 5 | `SALOON1.SND` |
| `"saloonsep.snd"` | 7 | `SALOON2.SND` |
| `"saloonsep.snd"` | 4 | `SALOON3.SND` |
| `"credits"` | 5 | `CREDITS.SND` |
| `"doorlib"` | 3 | `DOORLIB.SND` |
| `"flute"` | 5 | `UNDER/FLUTE.SND` |
| `"helptheme"` | 11 | `HELP.SND` |
| `"isaopractice.sn"` | 3 | `ISAOPRAC.SND` |
| `"mine"` | 11 | `UNDER/MINE.SND` |
| `"mission.snd"` | 2 | `MISSION.SND` |
| `"salgames.snd"` | 4 | `SALGAMES.SND` |

**The town appears twice on purpose.** `TOWN.SND` is the day and `NIGHT.SND` is the
night, under one name — the same doubling the SET side has, where the town is
`town.set` by day and `nite.set` by night. Which one answers depends on what the
game has open, not on the name.

**`"isaopractice.sn"` is truncated in the file**, one character short of
`.snd`, and the scripts ask for it that way. It is not a typo to fix: the name
field is what it is, and the port matches it character for character. Titanic's
v4 banks store `"BEDRAD1.WAV"` and are asked for as `bedrad1.trk`, so the runtime
strips a suffix there — doing the same here made three of Dust's themes
unfindable, the town's among them.

## The theme is spelled in the names

A v4 bank has a loop table saying which chunks are the music and in what order. A
v1 bank has no such table: the music is the **trailing run of consecutively
numbered chunks**, and the numbering *is* the order — `daymusic1` through
`daymusic10`.

Two rules keep dialogue out of that run, and they are why the count below is 15
and not 40:

- a stem ending in `.` is a **speaker**, not a bar: `ruby.108`, `fear.44`,
  `bol.98` are lines
- a run must start at **1**, which line numbering does not

Between them they drop every bank whose tail is dialogue and keep the ones that
are actually asked for.

## The other twenty-five are one-shot libraries

`DEATH.SND`, `UNILIB.SND`, `HOTROOM.SND`, the six `gossip` banks and the rest hold
no theme at all — just sounds a script fires by name. Five banks are named
`"gossip"` between them (`FEARWITT`, `HAPYRUBY`, `MARBLOOD`, `MAYORBLD`, `MAZIE`,
`MISCLIB`, `TROTRUBY`, `TROTSIDE`), which is the same one-name-many-files pattern
as the themes.

Fourteen of the forty are not in `DATA/` but beside the thing that uses them —
`CHECKERS/`, `CRACK/`, `DRUGS/`, `FIGHT/`, `SALGAMES/`, `SCORP/`, `TARGET/`,
`YUNNIBOX/` and six under `UNDER/`. The mini-games and the underground carry their
own audio.

## In the editor

The [track editor](../editors/tracks.md) lists banks by **filename**, because that
is what the manifest has — so the theme names above are not in the list, and
`night.snd` is where you look for the town at night. Open one and the bank's own
name is in the *track name* box, which is the name a script knows it by.

A `.SND` opens **read-only**. The page edits v4 bytes in place, and the patch
helpers write at v4 offsets — `patchLoopOrder` edits the loop table in container
1, and in a `.SND` container 1 is a *sound*. Writing one back needs a v1 write
path, which does not exist yet.

Back to [Dust](README.md).
