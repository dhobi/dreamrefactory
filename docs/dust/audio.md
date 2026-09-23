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

`playnewtheme` and `opentrackfile` are given a bank's **own stored name** — its
`refName`, the string at offset 158 — and that is frequently *not* what the file
is called on the disc. **Several files can answer to one name.**

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
| `"doorlib"` | 0 | `DOORLIB.SND` |
| `"flute"` | 5 | `UNDER/FLUTE.SND` |
| `"helptheme"` | 11 | `HELP.SND` |
| `"isaopractice.sn"` | 3 | `ISAOPRAC.SND` |
| `"mine"` | 11 | `UNDER/MINE.SND` |
| `"mission.snd"` | 5 | `MISSION.SND` |
| `"salgames.snd"` | 0 | `SALGAMES.SND` |

**The town appears twice on purpose.** `TOWN.SND` is the day and `NIGHT.SND` is the
night, under one name — the same doubling the SET side has, where the town is
`town.set` by day and `nite.set` by night. Which one answers depends on what the
game has open, not on the name.

**`"isaopractice.sn"` is truncated in the file**, one character short of
`.snd`, and the scripts ask for it that way. It is not a typo to fix: the port
matches the name field character for character. Titanic's v4 banks store
`"BEDRAD1.WAV"` and are asked for as `bedrad1.trk`, so the runtime strips a
suffix there; stripping one here makes three of Dust's themes unfindable, the
town's among them.

## The bank says how many of its sounds are the theme

A v4 bank has a loop table saying which chunks are the music and in what order. A
v1 bank has no such container — but it has a **pair of i16s at 0x18**: how many
one-shots it holds, then how many **loop chunks** follow them. The bed is that many
sounds at the end of the name table, and their order in the table *is* the playback
order — `daymusic1` through `daymusic10`.

The two halves sum to the bank's sound count in **40 of 40** banks on the disc,
and the loop half lands on the run the names suggest: TOWN.SND is (15, 10) and
its bed is `daymusic1..10`; NIGHT.SND (16, 5) and `nightwind1..5`; HELP.SND
(0, 11) and `helptheme1..11`. Read as one i32 the field looks like nonsense —
327687 is (7, 5) and 720896 is (0, 11).

The names alone are not a reliable guide to the bed (#325):

- `DOORLIB.SND` and `SALGAMES.SND` hold **no** bed, although `lsing1..3` (three
  hinge squeaks) and `discard1..4` (four card sounds) look like numbered runs.
- `MISSION.SND` holds **five**, and they are `silence wind1 wind2 chantwind1
  chantwind2` — two stems, which a single-stem rule cannot see.

## The rest are one-shot libraries

`DEATH.SND`, `UNILIB.SND`, `HOTROOM.SND`, the nine `gossip` banks and the rest hold
no theme at all — just sounds a script fires by name. All nine store the name
`"gossip"` (`FEARWITT`, `HAPYRUBY`, `MARBLOOD`, `MAYORBLD`, `MAZIE`, `MISCLIB`,
`TROTRUBY`, `TROTSIDE` and `UNDER/SHAMAN`), which is the same one-name-many-files
pattern as the themes.

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
