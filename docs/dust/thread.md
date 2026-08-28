# The golden thread — Dust's shipped saves are one playthrough

*Prerequisite: [Saved games, DF1 (`.rtd`)](../engine/formats/savegame-v1.md) for
what a save is made of. If you are here to play the game rather than to verify
it, you want [the walkthrough](walkthrough.md).*

`gamefiles/save/` was documented here as a handful of example saves, which is
what it looks like. Sorted by `frame` — the service-pass counter, 20 Hz — it is
something else entirely: **all but one of its files are a single continuous
session**, from `D1E_001` at frame 4885 to `ENDING` at frame 224670. Day 1 to day
5. Something over three hours of somebody at CyberFlix playing their own game to
the end, saved about sixty times on the way, and every byte of it written by the
shipped `DF.EXE`.

It does not quite start at the beginning. The collection's earliest save is a few
minutes into the first night — the bone, the dog and the ring are already behind
it — so [the walkthrough](walkthrough.md) takes that opening out of `HELP1.PUP`
instead.

That is the most valuable thing in the Dust rip, and it is worth being precise
about why.

## What it is worth

Titanic is verified by [a route the port plays and a golden trace it recorded
itself](../taoot/verification.md). That proves a great deal — the run is
deterministic, the two hosts agree, the game is winnable — but every assertion in
it is ultimately the port's own word. There was no 1996 machine to ask.

Dust has sixty answers from the 1995 machine. A save is a serialized heap: the
props and who owns them, the cast and where they stand, every global the scripts
ever set. So for sixty points across the whole game we can ask a question the
Titanic route cannot even phrase — *play from here and do you arrive where
`DF.EXE` arrived?* — and the thing being compared against was not written by this
project.

The route that follows from that is **loads by construction**, and the loads are
not a compromise. They are the original's own checkpoints.

## Establishing that it is one session

Two things had to be shown rather than assumed, and
[`dust/tools/rtdthread.ts`](https://github.com/dhobi/dreamrefactory/blob/master/dust/tools/rtdthread.ts)
shows both.

**Frame order is not lineage.** A save made in a later sitting has a higher frame
and an earlier day, so sorting by `frame` alone would happily splice two sessions
together and report the join as one enormous rung. The walk therefore tracks the
highest `day` seen so far and calls out anything that goes backwards. Exactly one
file does: **`DAY2.RTD`, at frame 261166, back at day 2** — later than the ending
and earlier in the story. It is a second sitting, and it is not a rung.

`dust/tests/saves.ts` asserts this rather than leaving it to the tool: distinct
frame counters, and at most one lineage break. Many breaks would mean the
collection is not a session at all, which is the thing worth being told about.

**Not every change means anything.** A `.rtd` is a heap dump and the engine moves
its own counters every service pass. The filter is a named list with a reason
each, not a heuristic — the tumbleweed's position, an idle handler's countdown to
the next fidget, the effects channel's round-robin cursor. The bar is not *how
often* a global changes: `playercash` and `handitem` change constantly and are
the story; `attentionspan` is a countdown in an idle handler and is not.

One entry on that list is a curiosity: a global whose **name is a bare double
quote**, carrying a nine-digit number under a type (4080) the reader knows no
meaning for, present in two saves and mentioned by no script on the disc. Heap
residue that the writer dumped along with the real variables.

## Reading a rung

A prop record carries an `owner`, and the player character's owner string is
**`stranger`** — Dust's hero has no name and the data agrees. So

    owner "none" → "stranger"

is the whole of *you picked it up*, and the reverse is *you gave it away*. That
one field is why a walkthrough is derivable from the collection at all: the saves
name every object that changed hands, in order, for three hours of play.

```
npx tsx dust/tools/rtdthread.ts              # the ladder and its rungs
npx tsx dust/tools/rtdthread.ts --spine      # the globals that never go back
npx tsx dust/tools/rtdthread.ts --all        # without the bookkeeping filter
npx tsx dust/tools/rtdthread.ts --rung D2A_006   # one rung, in full
npx tsx dust/tools/rtdthread.ts --md         # the table below
```

## The spine

Derived rather than declared: the globals that only ever move forwards along the
thread are the closest thing the collection has to a list of story flags. A
`*phase` that resets every midnight is not on it, by construction — and that
reset is itself the clearest structural fact in the data. **Crossing midnight
zeroes every character's thread**, so a day boundary is a different kind of rung
from every other one.

| flag | set at |
|---|---|
| `oonakidstory` | `D2M_002` |
| `rubygunstory` | `D2ARUBY` |
| `jonesringstory` | `D3M_002` |
| `laurelgood` | `D1E_006` |
| `bloodgood` | `D1E_005` |
| `bottles` = `1,1,0,0,1,0,1,1,` | `D3A_003` |
| `combo` = `08,23,41,` | `D3E_004` |
| `snakepuzzle` = `done` | `MSKPZL` |

The last three are puzzle answers, and the saves hold them because the original
player solved them. They agree with the scripts that check them
([the puzzles](walkthrough.md#the-puzzles-solved)), which is a pleasing
cross-check in both directions: the data confirms the code was read right, and
the code confirms the save was parsed right.

## The ladder

Sixty rungs. `where` is where the save was taken; `what changed` is the play
between it and the one above it, summarized — the full delta is what
`--rung <name>` prints.

| frame | save | when | where | what changed |
|------:|------|------|-------|--------------|
| 4885 | `D1E_001` | day 1 night | `nite.set (10,10)` | *the thread starts* |
| 13307 | `D1E_002` | day 1 night | `sallower.set (2,3)` | *played cards*, `playercash 5→400`, `bouncer 0→1`, `fivecount 1→3` |
| 13745 | `D1E_003` | day 1 night | `sallower.set (2,2)` | *played cards*, `playercash 400→791`, `handitem "cards"→""`, `fivecount 3→5` |
| 14481 | `D1E_004` | day 1 night | `salupper.set (0,0)` | `playercash 791→781`, `bouncer 1→0`, `oonaphase 0→1` |
| 16252 | `D1E_005` | day 1 night | `hotlower.set (1,2)` | **take** Cigar, **take** HHKey, **give** Ring (to ruby), `playercash 781→772`, `phase 2→5` |
| 17863 | `D1E_006` | day 1 night | `nite.set (3,6)` | **take** BKnife, **give** Cigar (to laurel), `playercash 772→776`, `phase 5→6` |
| 18059 | `D1E_007` | day 1 night | `maystudy.set (1,1)` | `mwifephase 0→2`, `theset "hotlower"→"mayhall"`, `townscene "scene g5"→"scene j9"` |
| 20375 | `D1E_008` | day 1 night | `nite.set (10,10)` | **take** Postcards, `handitem "Cards"→"postcards"`, `mariephase 0→3` |
| 20776 | `D1E_008B` | day 1 night | `nite.set (9,10)` | **take** HRKey, `phase 6→8`, `handitem "postcards"→"hrkey"` |
| 30998 | `D1E_009` | day 1 night | `nite.set (9,6)` | *played cards*, `playercash 776→761`, `dirgo 1→0`, `fightover 0→1` |
| 34130 | `D2M_001` | day 2 morning | `hotroom.set (0,0)` | **take** Cigar (from laurel), `playercash 761→760`, `phase 8→0` |
| 41393 | `D2M_002` | day 2 morning | `court.set (1,4)` | **take** Sugarcubes, **take** Flowers, **take** Pie, **take** Biscuits, **take** Boots, **give** Cigar (to laurel), `playercash 760→10`, `phase 0→2` |
| 48319 | `D2M_003` | day 2 morning | `salupper.set (0,0)` | `playercash 10→7`, `handitem ""→"hhkey"`, `bolivarcount 0→1` |
| 49464 | `D2M_004` | day 2 morning | `mayhall.set (2,2)` | **take** Mask, `handitem "hhkey"→"Mask"`, `mwifelike 0→-3` |
| 57077 | `D2A_001` | day 2 afternoon | `town.set (4,11)` | **take** Bullets, **give** Postcards (to limbo), `phase 2→0`, `clock 1→2` |
| 57445 | `D2A_002` | day 2 afternoon | `town.set (3,10)` | `countsix 0→5`, `mwifelike -3→3`, `mwifephase 0→1` |
| 58021 | `D2A_003` | day 2 afternoon | `undertak.set (0,1)` | **give** Pie (to side), `handitem ""→"boots"`, `flippophase 0→1` |
| 68931 | `D2A_004` | day 2 afternoon | `town.set (10,10)` | **take** Harmonica, `handitem "boots"→"harmonica"`, `bottlehitcount 0→3` |
| 71447 | `D2A_005` | day 2 afternoon | `town.set (6,7)` | **take** Apple (from birdcage), `handitem "harmonica"→"Apple"`, `loopsound ""→"outsidesaloon"` |
| 76758 | `D2A_006` | day 2 afternoon | `sallower.set (2,3)` | **give** Flowers, *played cards*, `playercash 7→800`, `handitem "Apple"→"Harmonica"` |
| 95437 | `D2A_007` | day 2 afternoon | `chin.set (1,1)` | **take** History, **give** Sugarcubes (to TROTTER), `playercash 800→765`, `handitem "Harmonica"→"history"` |
| 99020 | `D2ARUBY` | day 2 afternoon | `salroom.set (1,0)` | **take** Gun, `handitem "history"→"gun"`, `dirgo 1→0` |
| 99439 | `D2A_008` | day 2 afternoon | `sallower.set (2,1)` | `bouncer 0→1`, `cobbphase 0→1`, `dirgo 0→1` |
| 100484 | `D2A_009` | day 2 afternoon | `town.set (7,10)` | `playercash 765→200`, `phase 0→1`, `bouncer 1→0` |
| 101002 | `D2E_001` | day 2 night | `jail.set (0,0)` | **take** Badge, `phase 1→0`, `clock 2→3` |
| 105381 | `D2E_002` | day 2 night | `salupper.set (0,1)` | `handitem ""→"Harmonica"`, `buickphase 0→1`, `countsix 4→0` |
| 106540 | `D2E_003` | day 2 night | `salroom.set (1,0)` | **take** Hairpin, `handitem "Harmonica"→"hairpin"`, `rubyphase 0→1` |
| 108846 | `D2E_004` | day 2 night | `hotlower.set (1,2)` | **take** Yunnibook, `playercash 200→150`, `handitem "hairpin"→""` |
| 109128 | `D3M_001` | day 3 morning | `hotroom.set (0,0)` | `day 2→3`, `clock 3→1`, `buickphase 2→0` |
| 135871 | `D3M_002` | day 3 morning | `town.set (6,6)` | **take** Sugarcubes (from TROTTER), `phase 0→2`, `handitem ""→"sugarcubes"` |
| 140095 | `D3M_003` | day 3 morning | `town.set (10,10)` | **take** Matchbox, *played cards*, `phase 2→3`, `handitem "sugarcubes"→"matchbox"` |
| 141068 | `D3M_CLAS` | day 3 morning | `school.set (1,1)` | `laurelphase 0→1`, `saveitem "sugarcubes"→""`, `sonomaphase 0→1` |
| 148213 | `D3M_004` | day 3 morning | `salupper.set (0,2)` | **give** Matchbox (to scorpion), `handitem "matchbox"→"hhkey"`, `theset "court"→"sallower"` |
| 162429 | `D3M_005` | day 3 morning | `town.set (6,3)` | **take** Pages, **take** Matchbox (from scorpion), `handitem "hhkey"→"pages"`, `dirgo 0→1` |
| 162714 | `D3A_001` | day 3 afternoon | `town.set (6,10)` | *played cards*, `phase 3→0`, `clock 1→2`, `handitem "pages"→""` |
| 163786 | `D3A_002` | day 3 afternoon | `apoth.set (2,1)` | **take** RX, `handitem ""→"RX"`, `docphase 0→2` |
| 165539 | `D3A_003` | day 3 afternoon | `doctor1.set (1,0)` | `bottles ""→"1,1,0,0,1,0,1,1,"`, `docphase 2→6`, `loopsound "outsidesaloon"→""` |
| 167128 | `D3A_004` | day 3 afternoon | `doctor2.set (0,0)` | **take** Flute, **give** RX, `handitem "RX"→"flute"`, `countsix 0→2` |
| 167526 | `D3E_001` | day 3 night | `nite.set (6,8)` | `clock 2→3`, `handitem "flute"→""`, `deadphase 1→0` |
| 169015 | `D3E_002` | day 3 night | `sallower.set (2,2)` | `bouncer 0→1`, `buickphase 0→1`, `countsix 2→0` |
| 170249 | `D3E_003` | day 3 night | `sallower.set (2,1)` | **take** Tbird, *played cards*, `playercash 150→168`, `phase 0→2` |
| 177269 | `D3E_004` | day 3 night | `hotroom.set (0,0)` | **take** Tstone, `phase 2→3`, `handitem "tbird"→"hrkey"` |
| 180792 | `D3E_005` | day 3 night | `hotroom.set (0,0)` | `playercash 168→167`, `phase 3→4`, `bloodphase 0→1` |
| 181090 | `D4M_001` | day 4 morning | `hotupper.set (2,0)` | *played cards*, `phase 4→0`, `day 3→4`, `clock 3→1` |
| 183616 | `D4M_002` | day 4 morning | `sallower.set (2,0)` | `phase 0→1`, `handitem ""→"hhkey"`, `dellphase 0→1` |
| 188156 | `D4E_001` | day 4 night | `nite.set (6,4)` | **take** Blade, `phase 1→0`, `clock 1→3` |
| 189856 | `D4M_MISS` | day 4 night | `padre.set (0,1)` | `handitem ""→"Blade"`, `sonomaphase 0→1`, `theset "town"→"court"` |
| 191358 | `D4MINES` | day 4 night | `hub.set (3,6)` | **give** Tstone (to box), `handitem "Blade"→""`, `blackout 0→-1` |
| 195037 | `FLUTEPZL` | day 4 night | `flute.set (1,3)` | `blackout -1→0`, `smalldial 0→8` |
| 199636 | `DAGRPZL` | day 4 night | `snake.set (1,3)` | **give** Flute (to temple), `handitem ""→"Yunnibook"`, `flutenum 0→1` |
| 211054 | `MSKPZL` | day 4 night | `hub.set (3,4)` | **give** Blade (to snake), `blackout 0→-1`, `snakepuzzle ""→"done"` |
| 219600 | `MESAPZL` | day 4 night | `tbird.set (1,3)` | **give** Mask (to skeleton), *played cards*, `handitem "Yunnibook"→""`, `blackout -1→0` |
| 222320 | `ENDPZL` | day 4 night | `hub.set (2,4)` | **give** Tbird (to temple), `phase 0→1`, `handitem ""→"Yunnibook"` |
| 223762 | `BLDSTPZ` | day 4 night | `tbird.set (1,1)` | **take** Tbird (from temple), **give** Gun, `phase 1→5`, `handitem "Yunnibook"→"tbird"` |
| 224670 | `ENDING` | day 5 morning | `town.set (6,3)` | **take** chest, `phase 5→0`, `day 4→5` |

## What it does not carry

Worth stating before anyone builds a test on it:

- **The gaps are uneven and the play in them is not minimal.** `D3M_005` →
  `D3A_001` is twelve seconds; `D3M_001` → `D3M_002` is twenty-two minutes. The thread is what
  one player did, wandering included — so a route reproducing it must reach the
  **state**, never replay the minutes.
- **A save cannot be matched byte for byte.** Frame counter, cast positions, the
  live loop set and the RNG stream all differ between two runs that played the
  same. The assertion has to be a chosen set of globals and prop owners.
- **A save's name is a label, not a key.** `D<day><part>_<n>` does mean what it
  looks like — `M` morning, `A` afternoon, `E` night — and the save's own `day`
  and `clock` agree with the name in every file that uses the pattern but one:
  `D4M_MISS`, which is named for the Santa Marta **Mission** and was taken at
  night. The files that skip the pattern are named for a place or a puzzle
  outright — `D4MINES`, `MESAPZL`, `ENDING`. The tool re-checks this in its
  footer rather than asking to be believed.

Back to [Dust](README.md).
