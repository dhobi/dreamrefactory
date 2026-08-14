# The low-memory game — the smaller build a 1996 machine got

*Prerequisite: [Audio — TRK / SFX / 11K / SND](../formats/audio.md) (what a bank
is) and [Audio at runtime](audio.md) (how a name finds one).*

Titanic shipped with a second, quieter version of itself. Not a different build
and not a menu option — a set of branches inside the game's own scripts that fire
when the machine reports too little free memory, swapping half the songs out and
switching part of the ambience off.

The port has memory to spare, so those branches never ran. This page is what they
do, how they were measured, and the one number the play page moves to let a player
ask for them anyway.

Reference implementation: `GameSession.lowMemory`
([`engine/session.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/session.ts))
and `heapsize`
([`engine/builtins/helpers.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/builtins/helpers.ts)).

## The switch is the game's, not the engine's

`TI.EXE` has a `lowmemory` builtin. Nothing in TAOOT calls it. The BOOTFILE
defines a **function of the same name**, which shadows it, and asks a different
question:

```
code lowmemory ()
    global lowmemory

    lowmemory = 6144000
    if heapsize () < lowmemory
        return true
    endif
    return false
endcode
```

Under **6 MB** free — 6144000 bytes — and it was 1996, so that was a real machine
rather than a pathological one. `heapsize()` is the engine probe; everything
downstream is script.

This matters for where the feature lives. The port implements none of the
behaviour: it answers `heapsize()` with 4 MB instead of 64 and TAOOT does the
rest. The setting is one lie in one builtin.

## The five sites that branch on it

| script | site | what it does when memory is short |
|---|---|---|
| BOOTFILE | `setupdecksound` | opens `decka.11k` instead of `decka.trk` — and the same for `deckb`, `decke`, `deckf`, `cargo` |
| BOOTFILE | `setupsinksound` | opens `sink<phase>.11k` instead of `sink<phase>.trk` |
| EXTRA.CST | `setupboatdeck` | skips `crowdcrickets()` |
| BOOTFILE | `openset` | `setparam(1, 0)`, `setparam(2, 0)` |
| MAP.STG | `openstage` | `stageparam(1, 0)`, `stageparam(2, 0)` |

`lowmemory()` is re-read at each of those, and `openset` runs per room, so the
answer is allowed to change mid-game: a room entered after the machine got tight
is quieter than the one before it.

### The theme swap

```
    case "b59"
    case "b70"
    case "cafe"
    case "hallb"
        if lowmemory ()
            opentrackfile ("deckb.11k")
        else
            opentrackfile ("deckb.trk")
        endif
        playnewtheme ("deckb.trk")
```

Note the last line: whichever file was opened, the theme is asked for by its
**`.trk`** name. That is not a bug and not a fallback — a `.11k` bank's
`trackName` field *says* `deckb.trk`. The file name and the track name inside it
are deliberately different, so one `playnewtheme` serves both branches. See
[how a name finds its bank](audio.md#the-library-how-a-name-finds-a-sound); this
is one of the 27 banks (of 92) whose two names disagree.

### The crowd

`setupboatdeck` is the only site that isn't a file swap:

```
    if not lowmemory ()
        crowdcrickets ()
    endif
```

`crowdcrickets()` puts five looping party sounds on the boat deck, each pinned to
one of the deck's `life*` stars — `soundloop("party1", true)` plus
`makecricket("party1", starxyz("life14", 1), starxyz("life14", 2), 2000, 0, 0)`,
five times, with a different star set per phase. They are
[crickets](timing.md): positional ambient sound that pans and fades with where
you stand. Skip the call and mission 4's boat deck has no crowd on it at all.

This is the one change you cannot miss, because it is a presence rather than a
duration.

## `.11K` is not 11 kHz

The name says sample rate and means nothing of the kind. Measured across every
bank that has a `.11k` twin:

| bank | loop chunks | full | short | cut |
|---|---|---|---|---|
| `decka` | 11 → 6 | 72.1 s | 37.4 s | −48% |
| `deckb` | 17 → 8 | 101.9 s | 51.3 s | −50% |
| `decke` | 20 → 10 | 139.5 s | 70.1 s | −50% |
| `deckf` | 12 → 7 | 88.2 s | 43.3 s | −51% |
| `cargo` | 11 → 6 | 74.8 s | 37.5 s | −50% |
| `sink0` | 12 → 6 | 84.1 s | 39.8 s | −53% |
| `sink1` | 11 → 5 | 74.8 s | 27.1 s | **−64%** |
| `sink2` | 18 → 5 | 83.6 s | 34.0 s | −59% |
| `sink3` | 6 → 6 | 36.4 s | 36.4 s | **0%** |
| `sink4` | 12 → 6 | 69.4 s | 35.7 s | −49% |
| `sink5` | 8 → 6 | 57.0 s | 38.4 s | −33% |

Same codec (v40, 8-bit ADPCM), same **22050 Hz** — durations are of the
concatenated loop chunks as the port assembles a theme. They are the *short*
versions of the songs, roughly half the loop, and the two `.trk` banks that mix
11025 Hz chunks into their lists (`deckb`, `decke`) have `.11k` twins that don't.

`sink3` is the odd one out and worth stating precisely, because it is easy to get
wrong: the two files are the **same size** and differ in **592 bytes, all inside
the first 1531** — the container tables, not the audio. Decoded, both give 801792
samples at 22050 Hz with the same hash. Sinking phase 3 sounds identical either
way.

Eleven `.11k` names ship, and the same eleven in **all six language editions**:
`cargo`, `decka`, `deckb`, `decke`, `deckf`, `sink0`–`sink5`. (Sixteen *files* per
tree — the five deck banks appear on both discs.)

## The two params are invisible

`setparam` and `stageparam` are otherwise pure scratch: the scripts write 1 and 2
here and no script ever reads them back. So their meaning lives in `TI.EXE`, and
it is not anything on screen.

The setter stores two words:

```
0x409d12:  mov word ptr [0x489f5c], ax    ; setparam(1, n)
0x409d23:  mov word ptr [0x489f5e], ax    ; setparam(2, n)
```

and the only code that *reads* them outside the matching getter is the set-open
path at `0x43aa30`:

- **param 2** (`0x489f5e`, tested at `0x43aa57`) gates a look-ahead: when it is
  set and there is a next index to reach for, the engine runs an extra
  load/lock/fetch (`0x424000`, `0x4222d0`, `0x422210`) before it needs it. A
  prefetch.
- **param 1** (`0x489f5c`, tested at `0x43ab3d`) picks between `0x438850` and
  `0x438900`. The two functions are otherwise instruction-for-instruction the
  same; they diverge only after the reference count is decremented, where the
  param-1-off path calls an extra `0x438b80` when the last reference has dropped.
  A free-immediately versus keep-cached knob.

Both are memory-pressure knobs, and both are answers to a problem this port does
not have: it has its own decoded-ring LRU
([`ring-cache.ts`](https://github.com/dhobi/taoot-web/blob/master/src/ring-cache.ts))
and warms neighbouring rings itself. So they stay the scratch words `setparam`
already stored, and everything the setting reaches here is **sound**.

That is also why the play page names the row for the *condition* — **Low
memory** — and not for the result. What a small machine got is the game's answer,
and it is a different answer in a different port.

## Using it

The box is in its own row under the screen; the answer is remembered under
`taoot.sound.lowmemory`. It takes effect at the next `openset`, i.e. **the next
room you walk into**, not the one you are standing in.

Where it is worth listening:

| where | what changes |
|---|---|
| **mission 4, the boat deck** | the crowd disappears — the clearest of all |
| Scotland Road (`scot1`–`scot3`), the bridge | 139.5 s → 70.1 s, the largest cut |
| your cabin `b59`, `b70`, the café, B-deck hall | 101.9 s → 51.3 s, and reachable in the first minutes |
| F deck: Turkish baths, squash court, `ehall`, `stair2c` | 88.2 s → 43.3 s |
| A deck: lounge, smoke room, gym, wireless, grand staircase | 72.1 s → 37.4 s |
| the cargo holds, the bins, crew quarters | 74.8 s → 37.5 s |
| mission 4, sinking phase 1 | 74.8 s → 27.1 s, the largest proportional cut |

And where nothing happens at all, because those `setupdecksound` cases have no
`.11k` to swap to: the bedsit, `deckbd`/`fore`/`poop`, C and D decks (`c73`,
`c78`, `hallc`, `recept1c`, `halld`), the engine room and control room, the
turbine, and the false smokestacks.

## Tested

`tests/auto/regression.ts`, *"the small-memory setting opens the game's own short
themes"*, drives the whole chain rather than any one link: it sets the flag, opens
`wireless.set` (an A-deck room), and checks that the **game** opened `decka.11k`
instead of `decka.trk`, that `playnewtheme("decka.trk")` still resolves to it, and
that the theme that comes out is under 60% as long at the same sample rate.
