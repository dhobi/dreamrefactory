# Saved games, DreamFactory 5 (`.save`)

*Prerequisite: [Saved games (`.ti`)](savegame.md), the v4 format this one
descends from, and [DreamFactory 5's containers](dreamfactory-5.md) for the
24-byte prefix every v5 container opens with.*

RedJack's scripts save with `savegame ("2")` and load with `opengame ("2")`,
the same two opcodes as Titanic and Dust (12077 / 12078). **No save made by the
shipped game is available**, so everything on this page comes from reading
RedJack.exe. Every claim cites the address that proves it. What the code did not
settle is listed under [open questions](#open-questions).

The code is in `save.c` (the assert path at `0x4ba8b8`):

| | |
|---|---|
| `savegame` statement | `0x43c9b0` |
| the writer | `0x43cc10` |
| `opengame` statement | `0x43cb10` |
| the reader | `0x43d1c0` |
| the resume, run after a successful read | `0x43dd80` |
| old file handle → reopened file | `0x43e960` |
| one record table written as a container | `0x43ec60` |
| one record table read back | `0x43ed20` |

The port writes and reads this format:
[`engine/src/df/savegame-v5.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/savegame-v5.ts)
holds the bytes, and
[`engine/src/runtime/saveload-v5.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/saveload-v5.ts)
(with `saveload-v5-tables.ts` for the scheduler's three tables) holds what the
running game puts in and takes out. With no real save to patch, as Titanic's
and Dust's writers do, it builds the file from nothing: every field this page
maps, and zeros where it maps none. So the first save written by RedJack.exe
is the check on every offset below. [RedJack's page](../../redjack/README.md#saved-games)
says what the port does with it.

## In one paragraph

A `.save` is a DFile, the same box of numbered containers as a `.ti`. The file
header has a v5 signature and a larger position table. Every container opens
with the v5 24-byte prefix, and its tag says what it holds. The order is fixed,
and so is the v4 plan: a manifest of open files, a verbatim copy of the
engine's runtime block, the actor, cast, prop, shop and track tables, three
sound lists per track, the script globals, and then the loops, crickets and
walks tables. Two things are new: the manifest records the current theme and
sound, and a last table records the files copied to the hard disk. A load
**restores without running the new room's scripts**, as TI.EXE's does. But
first it closes the current room the ordinary way, so the room being left gets
its `close…` events.

## The file

### Header

The writer creates the file with `0x48e3c0(path, 1000, 'SAVE', 'D5RT')`
(`0x43cc29..0x43cc3a`). `0x48e2f0` builds the 1024-byte header on the stack:

| Offset | Value | Source |
|-------:|-------|--------|
| 0 (`fourCC`) | `0x00010000`, as in `.ti` and `.rtd` | `0x48e349` |
| 4 | file size, first `0x400 + 512·⌈1000/128⌉` = 5120, then kept current as containers are added | `0x48e31e..0x48e32f` |
| 16 | position-table capacity, `⌈1000/128⌉·128` = **1024** | `0x48e31b`, `0x48e324` |
| 20 | container count | |
| 32 | `'SAVE'` (u32 `0x53415645`) | `0x48e33a` |
| 36 | `'D5RT'` (u32 `0x44355254`) | `0x48e33e` |
| 0x28..0x1ff | zero | `0x48e361` |
| 0x200..0x3ff | not initialised: stack bytes | `0x48e314` zeroes only `0x76` dwords |

Written little-endian, the signature bytes at 32 read `EVASTR5D`: the Mac-style
file type and creator, each written backwards. TI's are `ODTRTRFD`. Integers
are little-endian throughout, as in every v5 file.

**The position table is 4 KB**, not 512 bytes: 1024 entries for a requested
1000 containers (v4 asked for 100). It is zeroed (`0x48e395`) and starts at
byte 1024, so **container 0 begins at 5120**, where a `.ti`'s begins at 1536.
Containers follow as `{i32 index, u32 size, data}` records, each padded to a
64-byte boundary (`0x48ed0f..0x48ed1e`, `0x48ed57..0x48ed69`). That is v4's
alignment, so `container.ts` reads the envelope unchanged.

When loading, the file layer (`0x48e430`, `STAR.C`) checks two header fields:
fourCC `0x10000` (error `0x70`, `0x48e48f`) and the size field against the
file's real length (error `0x65`, `0x48e4b9`). Either failure gives *"This is
not a valid saved game file."* (`0x43d1df`). **The signature at 32 is never
compared.** What marks the file as a save is container 0's tag.

### Every container is tagged, and the tag is checked

Every container starts with the v5 prefix: `00 00 05 00`, a four-letter tag,
then 16 zero bytes. When writing, `0x46ea90` runs a validator on each block
before appending it (`0x46eaef`). When loading, `0x46dd90` runs the same
validator. A validator returns error `0x70` when `+0` ≠ `0x50000` and `0x6f`
when the tag is wrong, and either is fatal (`0x468b30`).

The record tables are written by `0x43ec60`, which adds two words to the
prefix:

| Offset | Type | Field |
|-------:|------|-------|
| 0x00 | u32 | `0x00050000` |
| 0x04 | u32 | tag |
| 0x08 | 16 bytes | zero |
| 0x18 | u32 | record count |
| 0x1c | u32 | record stride |
| 0x20 | count × stride | the records, verbatim from the live table |

**Nothing reads `+0x18` or `+0x1c` back.** `0x43ed20` copies everything after
`+0x20` into a fresh block, and the tables' counts come from the runtime block
(container 1) instead. The fixed tables are copied by length: `0x2780`,
`0x540`, `0x800` and `0x4100` bytes from `+0x20` (`0x43d920`, `0x43d9ac`,
`0x43da38`, `0x43db81`). A container shorter than that is over-read.

### The containers, in order

The writer emits them in one sequence (`0x43cc10`). The reader takes 0–6 by
fixed index and counts on from 7 (`0x43d5fd`), so every index is computed.

| # | Tag | Size | Holds | Written | Read |
|---|-----|------|-------|---------|------|
| 0 | `SAVE` | `0xb28 + 0x104·files` | [the manifest](#container-0-the-manifest-save) | `0x43cd20..0x43ce04` | `0x43d21b` (validator `0x43eba0`) |
| 1 | `RUNT` | `0x264` | [the runtime block](#container-1-the-runtime-block-runt), `0x4c7808` verbatim | `0x43ce12..0x43ce4d` | `0x43d474` (validator `0x43ebe0`) |
| 2 | `ACT*` | n × `0x102` | [actors](#actors-act) | `0x43ce86` | `0x43d593` |
| 3 | `CAS*` | n × `0x1c` | [open casts](#casts-cas-and-shops-shp) | `0x43cec4` | `0x43d5ab` |
| 4 | `PRO*` | n × `0xfe` | [props](#props-pro) | `0x43cf05` | `0x43d5c3` |
| 5 | `SHP*` | n × `0x1c` | [open shops](#casts-cas-and-shops-shp) | `0x43cf43` | `0x43d5db` |
| 6 | `TRA*` | n × `0x234` | [open tracks](#tracks-tra-and-their-sounds-sou) | `0x43cf84` | `0x43d5f3` |
| 7 … 6+3t | `SOU*` ×3 per track | k × `0x2e` | each track's sounds, themes and theme order | `0x43cfca`, `0x43cfee`, `0x43d012` | `0x43d625..0x43d839` |
| next | `VARS` | `0x2c + 32·cap + pool` | [the script globals](#the-globals-vars) | `0x43d050` | `0x43d866` (validator `0x449e80`) |
| +1 | `LOO*` | 64 × `0x9e` | the loops table, `0x4c4a80` | `0x43d09b` | `0x43d8ed` |
| +2 | `BAL*` | 16 × `0x54` | the **crickets** table, `0x4c4540` | `0x43d0bd` | `0x43d97f` |
| +3 | `WAL*` | 16 × `0x80` | the walks table, `0x4c3d40` | `0x43d0e2` | `0x43da0b` |
| (var) | `DRIV` | | one route per walk slot that is active and carries one | `0x43d0f3..0x43d142` | `0x43da96..0x43db22` (validator `0x45d320`) |
| last | `COL*` | 32 × `0x208` | the [`copylocal`](#copylocal-col) table, `*0x4c2c98` | `0x43d15c` | `0x43db54` |

The tags are written the way RedJack.exe writes them, as big-endian readings
of the u32 (`0x4143542a` is `ACT*`), which is how
[the v5 page](dreamfactory-5.md#the-24-byte-prefix) spells container kinds. The
bytes on disk read backwards (`*TCA`). The three scheduler tables come from
`0x41b240`, which returns the three addresses, and `BAL*` is the table that
`makecricket` fills (`0x41d7b5`). `WAL*` belongs to the `walkto…` and
`walkon…` family (`0x41c1f0`), and its payloads are routes: the validator
checks for `DRIV` (`0x45d340`), the [route container of a SETT](sett.md).

The count of containers therefore varies by 3 × (open tracks) + (walk slots
with a route). The order does not.

## Container 0: the manifest (`SAVE`)

The writer builds it on the stack at `esp+0x140` and copies `0xb28` bytes plus
one record per open file into the block (`0x43cdd8..0x43cde9`,
`0x43ccb5..0x43cd03`).

| Offset | Type | Field | Written | Read on load |
|-------:|------|-------|---------|--------------|
| 0x000 | u32 | `0x00050000` | `0x43cd24` | `0x43ebb3` |
| 0x004 | u32 | `'SAVE'` | `0x43cd40` | `0x43ebc0` |
| 0x008 | 16 bytes | zero | `0x43cd4b..0x43cd60` | |
| 0x018 | pstr[256] | **the version string**, `savegame`'s argument | `0x43cd67` | `0x43d28b..0x43d2a1` |
| 0x118 | pstr[256] | **the disc** (`0x4c7600`, what `currentcd` answers, `0x43c718`) | `0x43cd78` | `0x43d30d`, used at `0x43d40b` |
| 0x218 | 9 × pstr[256] | **the path table** at save time: slots 0–8 of `*0x4dffa0`, read by `0x43c7a0` | `0x43cd7d..0x43cd9a` | slot 0 for the rebase, slots 1–8 installed (below) |
| 0xb18 | u32 | old handle of the track whose **theme** is playing, 0 for none | `0x43cdad` (`0x471de0`, channel `0x513e90`) | `0x43ddb8`, `0x43e685` |
| 0xb1c | u32 | old handle of the track of the **current sound**, 0 for none | `0x43cdc6` (`0x471c80`) | `0x43ddbe`, `0x43e65d` |
| 0xb20 | u32 | that sound's `+0x24` | `0x43cdc6` | `0x43ddc4`, `0x43e667` |
| 0xb24 | i32 | open-file count *n* | `0x43cd32` | every handle lookup |
| 0xb28 | n × 0x104 | per open file: the file's **old heap handle** (u32), then its path (pstr[256], from the file object `+0x118`) | `0x43ccb5..0x43cd03`, walking the open-file list from `0x46ce00` by `+0x632` | `0x43e960` |

The open-file list is every open DFile: the BOOTFILE, the set, every cast,
shop, track and stage.

**This is v4's manifest, repacked.** The version, disc and nine path slots are
all there, 24 bytes later because of the prefix. TI keeps its disc family at
`+0x104` and its path slots at `+0x1fc`. The **live CLUT is gone**: v5 pictures
carry their own palettes. In its place are the three theme and sound
references. The per-file record is 260 bytes, as in v4.

### How a handle becomes a file again

Every other container refers to files by the heap handle they had when the game
saved. `0x43e960` looks that handle up in the manifest's records. A handle that
is missing is fatal, line `0x1127` (`0x43e9b3`). On a match it copies the
record's path and then **rebases** it: if the path begins with the saved slot 0
(`+0x218`), that prefix is replaced by the current slot 0 (`0x43e9d1..0x43ea41`,
using `0x43c7a0(0)`). The compare is case-insensitive (`0x469110` folds both
sides through the table at `0x4c0c60`). A save therefore survives the game
being installed somewhere else. TI does something different: it strips
everything up to the last `:` and asks the resource path.

The rebased path must exist (`0x48ceb0`). Otherwise the load stops with *"This
saved game is invalid because the file '…' cannot be found."* (`0x43ead6`).
Then `0x46eba0` opens the file. The caller passes a type code in `edx`
(`'CAST'`, `'SHOP'`, `'TRAK'`, `'SETT'`, `'STAG'`), but `0x43e960` never reads
it.

Actor and prop records resolve differently. They do not open anything: the
old handle gives the path through the manifest, and the path must match a
file **already open** in the live list. That fails fatally at line `0x1126`
(`0x43df5a`, `0x43e16d`). The casts and shops are reopened first, and their
members come out of those files.

The reader rebases slots 1–8 in the loaded manifest (`0x43d36a..0x43d3f5`). The
resume then **installs them into the live path table** (`0x43c7f0`,
`0x43dd95..0x43ddb6`). Slot 0 is left as the running game has it.

## Container 1: the runtime block (`RUNT`)

`0x4c7808` is a live block of `0x264` bytes. It carries its own container
prefix: startup writes `0x50000` and `'RUNT'` into its first two dwords
(`0x439ba0`, `0x439baa`), so the writer copies it out whole (`0x43ce2b`) and
the validator checks that prefix (`0x43ec00`).

On load it is copied back whole, with one exception. **The 22 bytes at
`+0x18..+0x2d` (`0x4c7820`) are kept from the running engine**: they are
stashed before the copy and put back after it (`0x43d4b4..0x43d4ec`). Among
them is `+0x2a`, the BOOTFILE's handle (`0x4c7832`, the file `0x449626` reads
the permanents from). The session's own boot file, window and host state
therefore survive the load.

All offsets are from `0x4c7808`. Names come from the code that uses each field;
the loader's handling is in the last column.

| Offset | Type | Field | On load |
|-------:|------|-------|---------|
| 0x00 | 24 bytes | prefix `0x50000`, `'RUNT'` | checked |
| 0x18 | 22 bytes | host state, the BOOTFILE handle at `+0x2a` | **kept from the live engine** |
| 0x2e | 12 bytes | the **screen**'s colour-table parameters (`litby` 1) | rebuilt into `+0x3a` (`0x43d52b`) |
| 0x3a | u32 | the screen's colour table (an id in `glut.c`'s pool) | rebuilt |
| 0x42 | u32 | **`frame ()`** (`0x418079`). A search for the address finds only one writer, the startup clear (`0x439bfd`), so what advances it is not known | restored |
| 0x46 | u32 | `framerate`: 3 at startup (`0x439c03`), and the statement clamps it to 0..60 (`0x408cb4..0x408cc7`). Read at `0x419eee` | restored |
| 0x4c | 12 bytes | the **movie**'s colour-table parameters (`litby` 4) | rebuilt into `+0x58` (`0x43d53c`) |
| 0x5c / 0x60 | handle / u32 | the actor table and its count | handle replaced by `ACT*` (`0x43d59d`); **the count is the file's** |
| 0x64 / 0x68 | handle / u32 | the open casts and count | `CAS*` (`0x43d5b5`) |
| 0x6c / 0x70 | handle / u32 | the prop table and count | `PRO*` (`0x43d5cd`) |
| 0x74 / 0x78 | handle / u32 | the open shops and count | `SHP*` (`0x43d5e5`) |
| 0x7c / 0x80 | handle / u32 | the open tracks and count | `TRA*` (`0x43d5f8`) |
| 0x84 | i16 | a **stage** is open | tested at `0x43e82f` |
| 0x86 | i16 | `stagevisible` (`0x414097`) | restored |
| 0x8c | u32 | the stage file's old handle | reopened (`0x43e848`) |
| 0x90 | i32 | **the current flat**: an index into the `STAG` header's flat records, `0x32` bytes each from `+0x54`, with the name at record `+0x22`. It is what `stageflat ()` answers (`0x414181..0x4141b5`). RedJack.exe has no `currentflat` handler | restored |
| 0x98 / 0x9c | handle / u32 | the stage's `STAG` header and the index of a second container | reread (`0x43e860`, `0x43e896`) |
| 0x94 | i32 | the flat last drawn. The flat code redraws when it differs from `+0x90` (`0x415fc8..0x415fd5`) | set to −1, forcing a redraw (`0x43e8f2`) |
| 0xa0..0xae | i16s | stage geometry (origin, size) | restored |
| 0xb0 | pstr[16] | the stage name, what `currentstage` answers (`0x414201`) | restored |
| 0xc0 | 12 bytes | the **stage**'s colour-table parameters (`litby` 2) | rebuilt into `+0xcc` (`0x43d551`) |
| 0xd0 | i16 | a **set** is open (`currentset`, `0x441f7a`) | tested at `0x43e6b8` |
| 0xd2 | i16 | **`setvisible ()`** (`0x441df7`); opening a set writes 1 to it beside the open flag (`0x43f8ed`) | restored |
| 0xe0 | u32 | the set file's old handle | reopened as the room (`0x43e6d6`) |
| 0xe4 | handle | the set's `MAZE`, its container 0 | reread (`0x43e6f9`) |
| 0xe8 | u32 | index of a container read as `MHED` (validator `0x45d050`) into a temporary block that is not kept | checked only (`0x43e72f`) |
| 0xf8 | pstr[16] | **the set name**, what `currentset` answers (`0x441f89`) | restored |
| 0x108 | pstr[16] | **the place, a node or a scene**: what `currentscene` answers (`0x442080`). Arriving at a node writes that node's MAPR name here (`0x444f70`), so there is no separate node field | restored and entered (below) |
| 0x118 | pstr[16] | **the view**. At a node it holds `"node"` (`0x444f86..0x444f97`). `currentview` answers it only in a scene. At a node it answers `"Node"` and on a road `"Moving"`, both taken from `0x4c8f18` (`0x4356d0`: −1 in a scene, 0 at a node, more than 0 on a road), which is **outside** RUNT and not saved (`0x441e4e..0x441e99`) | restored and entered |
| 0x128 / 0x12c | u32 / handle | the set's `MARK` container: index and handle | reread (`0x43e79b`) |
| 0x130 / 0x140 | u32 / handle | the set's `MAPR` container: index and handle | reread (`0x43e765`) |
| 0x144 | 12 bytes | the **set**'s colour-table parameters (`litby` 3) | rebuilt into `+0x150` (`0x43d566`) **and into `+0x218`** (`0x43d57b`) |
| 0x164 | i16 | a **puppet** is open | **zeroed** (`0x43e907`) |
| 0x168..0x1ec | | the open puppet's state (`Pupp.c`) | restored, but see the flag |
| 0x20c | 12 bytes | the **puppet**'s colour-table parameters (`litby` 5) | not used by the loader |
| 0x218 | u32 | the puppet's colour table | rebuilt from the set's parameters, not from `+0x20c` |
| 0x230 | i32 | `currentdeg` (`0x441ebe`) | restored |
| 0x234 | i32 | `camerapitch` (`0x441eee`) | restored |
| 0x238 | i32 | `cameraroll` (`0x441f1e`) | restored |
| 0x23c / 0x240 / 0x244 | i32 | the camera's position, which crickets measure their distance from (`0x41d851`, `0x41d85d`) | restored |
| 0x248 / 0x24c / 0x250 | i32 | heading, pitch and roll as last set | reapplied through `0x4389b0`, `0x438b50`, `0x438cf0` (`0x43e814..0x43e82a`), the setters behind `currentdeg`, `camerapitch` and `cameraroll` |
| 0x260 | i32 | `camerafov` (`0x441f4e`) | reapplied through `0x438e90` (`0x43e80f`), `camerafov`'s setter |

The five parameter blocks at `+0x2e`, `+0x4c`, `+0xc0`, `+0x144` and `+0x20c`
are the look-up tables behind `litby`. `0x40a750` maps `litby` 1–5 to those
blocks and their ids, and `0x40a680` names them `screen`, `stage`, `set`,
`movie` and `puppet` (0 is `default`). A table id means nothing in another
process, so the loader empties the pool (`0x46ef40`, `0x46ecd0`) and rebuilds
each table from its saved parameters with `0x46efe0`, the screen's first
(parent −1) and the rest under it. The puppet's table is rebuilt from the
**set**'s parameters, and the load closes the puppet anyway.

Compared with v4: TI's container 1 is the 786 bytes at `0x489d40`, and its
loader keeps three 146-byte windows of it. RedJack's is smaller, keeps one
22-byte window, and holds `frame ()` the same way, so absolute frame stamps in
the globals keep their meaning after a load. RedJack also saves the camera
(heading, pitch, roll, field of view) on top of the scene and view.

## The record tables

### Actors (`ACT*`)

Records of `0x102` bytes, copied verbatim from the live table. The offsets
below come from the value handlers, which fetch a record by name with
`0x406550` (name compare at `+0xb2`, `0x40658a`) into a buffer and read the
field from it:

| Offset | Type | Field | From | On load |
|-------:|------|-------|------|---------|
| 0x00 | i16 | `actorvisible`, a counter (see [hiding](#hiding-is-a-counter)) | `0x403028` | kept |
| 0x02 | u32 | the cast file's old handle | | relinked to the open file (`0x43df84`) |
| 0x06 | handle | the member's `ACTO` container | | reread (`0x43df8a`, validator `0x45d5e0`) |
| 0x0a | u32 | that container's index in the cast | | used for the reread |
| 0x12 | i16 | `actoris3d` | `0x403838` | kept |
| 0x14 | i16 | `actoristrue3d` | `0x403b48` | kept |
| 0x1a / 0x1e / 0x22 | i32 | `actordeg`, `actorpitch`, `actorroll` | `0x40262f`, `0x40269f`, `0x40270f` | kept |
| 0x26 / 0x2a / 0x2e | i32 | `actorxyz` 1/2/3 | `0x40347c`, `0x403469`, `0x403456` | kept |
| 0x32 | i32 | `actorturn` | `0x4059df` | kept |
| 0x40 | u32 | | | reset from `0x469f80` (`0x43dfb7`) |
| 0x44 | i32 | `actorspeed` | `0x402a2f` | kept |
| 0x4c | i32 | `actorscale` | `0x4029bf` | kept |
| 0x54 | u32 | | | reset from `0x46d200` (`0x43dfaf`) |
| 0x8e | i32 | `actorvalue` | `0x405e0f` | kept |
| 0x92 | i32 | `actorzclip` | `0x405e7f` | kept |
| 0x98 / 0x9a / 0x9c | i16 | `actorsnap`, `actorink`, `actorflip` | `0x403dd8`, `0x404008`, `0x403e58` | kept |
| 0x9e | 12 bytes | colour-table parameters: `actorcontrast` at `+0xa2`, `actorbrightness` at `+0xa8` | `0x40645d`, `0x406365` | rebuilt into `+0xaa` |
| 0xaa | u32 | the actor's colour table | | rebuilt (`0x43de97`) |
| 0xae | i16 | `actorlitby`, whose table becomes the parent | `0x406518`, `0x43de7f` | kept |
| 0xb0 | i16 | `actorisfacer` | `0x4039b8` | kept |
| 0xb2 | pstr[16] | **name** | `0x40658a` | kept |
| 0xc2 | pstr[16] | `actorset` | `0x401c9f` | kept |
| 0xd2 | pstr[16] | `actorstar` | `0x401f2f` | kept |
| 0xe2 | pstr[16] | `actorpose` | `0x40216f` | kept |
| 0xf2 | pstr[16] | `actorowner` | `0x405d9f` | kept |

TI's actor record is 160 bytes with the name at `+0x50`. RedJack's is 258 with
the name at `+0xb2`. The shape is the same: the numbers first, then five
16-byte strings, with owner last.

### Props (`PRO*`)

Records of `0xfe` bytes, fetched by `0x42c490` (name at `+0xae`, `0x42c4ca`).
Where the two records share a field, the prop's is at the actor's offset, up to
`+0x2e`. From there on, the actor's extra `actorturn` word moves everything 4
bytes later.

| Offset | Type | Field | From |
|-------:|------|-------|------|
| 0x00 | i16 | `propvisible`, a counter (see [hiding](#hiding-is-a-counter)) | `0x4295a8` |
| 0x02 / 0x06 / 0x0a | u32 / handle / u32 | the shop file's old handle, the `PROP` container and its index (relinked and reread as for actors: `0x43e185..0x43e19d`, validator `0x45d660`) | |
| 0x12 / 0x14 | i16 | `propis3d`, `propistrue3d` | `0x429da8`, `0x42a0b8` |
| 0x1a / 0x1e / 0x22 | i32 | `propdeg`, `proppitch`, `proproll` | `0x428d1f`, `0x428d8f`, `0x428dff` |
| 0x26 / 0x2a / 0x2e | i32 | `propxyz` 1/2/3 | `0x4299fc`, `0x4299e9`, `0x4299d6` |
| 0x3c / 0x50 | u32 | reset on load (`0x43e1ca`, `0x43e1c2`) | |
| 0x48 | i32 | `propscale` | `0x428f8f` |
| 0x8a | i32 | `propvalue` | `0x42839f` |
| 0x8e | i32 | `propzclip` | `0x42840f` |
| 0x94 / 0x96 / 0x98 | i16 | `propsnap`, `propink`, `propflip` | `0x42a348`, `0x42a578`, `0x42a3c8` |
| 0x9a | 12 bytes | colour-table parameters: `propcontrast` at `+0x9e`, `propbrightness` at `+0xa4` | `0x42c39d`, `0x42c2a5` |
| 0xa6 | u32 | the colour table, rebuilt (`0x43e090`) | |
| 0xaa | i16 | `proplitby` | `0x42c458` |
| 0xac | i16 | `propisfacer` | `0x429f28` |
| 0xae | pstr[16] | **name** | `0x42c4ca` |
| 0xbe | pstr[16] | `propset` | `0x42823f` |
| 0xce | pstr[16] | `propstar` | `0x42861f` |
| 0xde | pstr[16] | `propview` | `0x42885f` |
| 0xee | pstr[16] | `propowner` | `0x42832f` |

### Hiding is a counter

The first word of an actor or a prop record is not a flag. `actorhide` and
`prophide` take one off it for every record in the table, and unhiding puts
one back, never above 1 (`0x40314b..0x403159` for actors, `0x4296cb..0x4296d9`
for props). So while a hide is in effect, a record that was shown holds 0 and
one that was not holds −1, and unhiding brings each back to what it was.
A save taken on the control panel, which hides everything when it opens, holds
exactly that, and the panel's `exit ()` unhides it after the load.

The inventory is not a table of its own. As in TAOOT, it is the prop records,
which carry their owner and view.

### Casts (`CAS*`) and shops (`SHP*`)

Records of `0x1c` bytes, built by `opencastfile` from the file and its
container 0 (`0x40112a..0x4011f3`). A shop's record has the same shape:

| Offset | Type | Field |
|-------:|------|-------|
| 0x00 | u32 | the file's old handle: **reopened** through the manifest (`0x43de05`, `0x43dffc`) |
| 0x04 | handle | its `CAST` / `SHOP` container 0, reread (`0x43de1d`, `0x43e014`; validators `0x45d5a0`, `0x45d620`) |
| 0x08 | u32 | the header's `+0x24` |
| 0x0c | pstr[16] | the name, from the header's `+0x28` |

TI's casts and shops are also 28 bytes, and also have to be reopened for the
room's members to exist again.

### Tracks (`TRA*`) and their sounds (`SOU*`)

Records of `0x234` bytes. The fields the save touches:

| Offset | Type | Field |
|-------:|------|-------|
| 0x00 | u32 | the `.trak` file's old handle: reopened (`0x43e20f`) |
| 0x04 / 0x10 | i16 / ptr | the **sounds** (`SSND`) and their list |
| 0x06 / 0x14 | i16 / ptr | the **theme** segments (`STHM`) and their list |
| 0x08 / 0x18 | i16 / ptr | the **theme order**: the list `playtheme` plays (`0x44741b..0x447426`) |
| 0x1c | pstr | the track's name, what `playtheme` looks for (`0x4473c3`) |
| 0x2c | i32 | where the theme loops back to |
| 0x30 | i16[] | the theme order as indices into the segments (`themeorder`) |

Each track is followed by three `SOU*` containers of `0x2e`-byte sound records,
in the order sounds, themes, theme order (`0x43cfb8..0x43d01d`). The lists are
live pointers, so the reader allocates each list anew from its container
(`0x43d661..0x43d693`) and stores it back into the track (`0x43d6d3`,
`0x43d77b`, `0x43d819`). The resume then rebuilds them (`0x43e426..0x43e613`):

- a theme segment or sound whose `+0x2c` is not 1 has its data reloaded from
  the track file, container `+0x24` (`0x4726c0`), with the setters around the
  call keeping its other settings;
- the theme order is copied again from the segments, following the indices at
  `+0x30` (each clamped to 1 … segment count). Each entry's `+0x18` is then
  linked to the next, and the last one's to segment `+0x2c`, which is how a
  theme loops;
- the sounds are renumbered: `+0x00` = position + 1 (`0x43e5bd`).

In a sound record, `+0x24` is the sound's container in its track and `+0x28`
the track file's handle. `+0xb1c` and `+0xb20` in the manifest match those two
fields.

## The globals (`VARS`)

A v5 script has two kinds of global: `global` (and `dumpglobal`) go into the
block at `*0x4f63d0`, `permanent` (and `dumppermanent`) into the block at
`*0x4f63cc` (`0x422e7b..0x422ecc`, tokens 4002 and 4029 for the first,
4030 and 4031 for the second). **Only the first is
saved.** The permanents are loaded from the BOOTFILE's container 4 at startup
(`0x4494b1..0x449569`). At quit or restart they are written back into that
container (`0x449602..0x449659`, `0x46e700`, from `0x439a50`). They outlive a
session by living in the installed BOOTFILE, and a load leaves them alone.

The `VARS` container is the globals block as it stands, followed by its string
pool (`0x449d80`):

| Offset | Type | Field |
|-------:|------|-------|
| 0x00 | 24 bytes | prefix `0x50000`, `'VARS'` (set at `0x449478`, checked at `0x449ea0`) |
| 0x18 | u16 | nodes in use |
| 0x1a | u16 | node capacity, grown 20 at a time (`0x449a83`) |
| 0x1c | u32 | pool bytes freed (`0x449be9`) |
| 0x20 | u32 | pool bytes used: a string's offset must be below it (`0x449bb0`) |
| 0x24 | u32 | pool size, `0x800` in a fresh block (`0x4494a1`) |
| 0x28 | ptr | the pool: rebuilt on load (`0x449e5f`) |
| 0x2c | cap × 32 | the nodes |
| 0x2c + 32·cap | `+0x24` bytes | the string pool: Pascal strings |

The loader cuts the container at `0x2c + 32·[+0x1a]`. The part before the cut
becomes the new block and the rest the new pool (`0x449de0`). The old block is
freed first (`0x449d50`). Each 32-byte node (`0x449ac7..0x449ae6`):

| Offset | Type | Field |
|-------:|------|-------|
| 0x00 | u16 | type: **4** number (what a declaration starts as), **3** string (`0x449ba4`) |
| 0x02 | u16 | 0 |
| 0x04 | i32 | the number, or the string's offset into the pool |
| 0x08 | u16 | the declared array size |
| 0x0a | u16 | this node's index within its array |
| 0x0c | u16 | the array's element count (at least 1) |
| 0x0e | u16 | 0 |
| 0x10 | pstr[16] | the name, at most 15 characters (`0x4499c7`) |

**The v4 pairing trap is gone.** In a `.ti`, a node's value belongs to the
*next* node's name, because the C++ object stored its name last. A v5 node is a
plain record with its name inside it. Strings live in a pool, as in v4, but
the pool is now appended to the same container instead of being a container of
its own.

## The scheduler tables

`LOO*`, `BAL*` and `WAL*` are the live tables, copied verbatim in both
directions, as in TI. The master pass `0x41b360` services them once per idle
turn, in the order walks (`0x41b37c`), crickets (`0x41b727`), loops
(`0x41b75f`). A slot is free when its first i16 is 0. Every *pause* field is a
**nesting counter**, not a flag: pausing adds 1, unpausing subtracts 1 and
stops at 0 (`0x41c252..0x41c260` loops, `0x41dd6a..0x41dd78` crickets,
`0x41d49a..0x41d4a8` walks). A slot is serviced only while its counter is 0.

Two clocks appear. A **pass** is one service call. A **tick** is `0x469f80`:
milliseconds since the first call × 0.06 (the double at `0x4b6d90`), so 60 per
second.

### Loops (`LOO*`), 64 × `0x9e` at `0x4c4a80`

`makeloop (kind, name, handler, period)` (`0x41bc00`) builds the record on the
stack at `esp+0x2c` and copies it into the first free slot (`0x41bfb3`). First,
`0x41b8e0` stops any loop of the same kind and name.

| Offset | Type | Field | Written | Read |
|-------:|------|-------|---------|------|
| 0x00 | i16 | in use: 1, and cleared when the loop fires | `0x41bee8` | `0x41c030` |
| 0x02 | i16 | pause counter (`pauseloop`) | `0x41beef` (0) | `0x41bff4`; read back at `0x41c1d9` |
| 0x04 | i16 | kind: 1 `actor`, 2 `prop`, 3 `scene`, 4 `flat` (`0x41de00`; 0 is refused, error `0xa`) | `0x41bef4` | `0x41c076`, and matched by `stoploop`, `pauseloop` and `isloop` |
| 0x06 | i32 | **due time in ticks**, for a negative period: `now − period`. 0 for a positive period | `0x41befb` / `0x41bf12` | `0x41c001..0x41c010` |
| 0x0a | i32 | **passes left**, for a positive period: the period itself. 0 for a negative one | `0x41beff` / `0x41bf0e` | decremented at `0x41c018..0x41c023` |
| 0x0e | pstr[16] | the target's name, at most 15 characters (`0x41beb1`) | `0x41bf18` | `0x41c04b`, and by name in the stop, pause and count routines |
| 0x1e | pstr[128] | the handler as a statement: `name()` with `()` appended (`0x41bd22`), or `name(args)` built from a literal call (`0x41bd5b..0x41be20`). At most 127 characters (`0x41bd3c`) | `0x41bf26` | `0x41c06e` |

**Every loop fires once.** The service `0x41bff0` skips a paused slot. Next,
with a due time it waits until `0x469f80 ()` ≥ `+6`; without one it counts
`+0xa` down by one each pass and fires when the count reaches 0 or less. To
fire, it frees the slot (`0x41c030`) and sends `"<name>", <handler>` to the
object of that kind (`0x41c076..0x41c0b3`):

- actor: `0x404f20`;
- prop: `0x42b480`;
- scene: `0x4409e0`;
- flat: `0x414cf0`.

A handler that wants to repeat has to call `makeloop` again.

**The `+6` zeroed on load is the tick deadline.** Ticks count from the
process's first call to `0x469f80`, so they mean nothing in another session.
Zeroing it moves a timed loop onto the pass counter, which is 0, so it fires
on the first pass after the load. A pass-counted loop is unaffected.

### Crickets (`BAL*`), 16 × `0x54` at `0x4c4540`

`makecricket (sound, x, y, radius, base, jitter)` (`0x41d530`) builds the record
at `esp+0x54` and copies it into the first free slot (`0x41d7e3`). First,
`0x41b9a0` stops any cricket playing the same sound. The sound must exist in
an open track (`0x448ff0`, `0x41d58e`). `radius` must be at least 1, `base` at
least 0 and `jitter` at least −1 (`0x41d668..0x41d6a2`). The argument names
are the port's (`timing.ts`); the constraints are RedJack.exe's.

| Offset | Type | Field | Written | Read |
|-------:|------|-------|---------|------|
| 0x00 | i16 | in use | `0x41d6b9` | a one-shot clears it after its play (`0x41d9d9`) |
| 0x02 | i16 | pause counter (`pausecricket`) | `0x41d6c0` (0) | `0x41d819` |
| 0x04 | i32 | x | `0x41d6f2` | `0x41d86d` |
| 0x08 | i32 | y | `0x41d6f8` | `0x41d86a` |
| 0x0c | i32 | radius: audible inside it | `0x41d6c7` | `0x41d8f3`, `0x41d9ec` |
| 0x10 | i32 | base count, in passes | `0x41d6db` | re-arming, `0x41db16`, `0x41db40` |
| 0x14 | i32 | jitter: below 0 means a **one-shot**. Otherwise each re-arm adds a random 1..jitter (`0x469340`, which gives 0 when jitter ≤ 0), written *rnd* below | `0x41d6e1` | `0x41d8d4`, `0x41db0e` |
| 0x18 | i32 | **countdown in passes**. It starts at `base` for a one-shot and at `base + rnd` otherwise | `0x41d6fe` / `0x41d713` | `0x41d8df`, `0x41db01` |
| 0x1c / 0x20 | i32 | the camera x/y that `+0x24` and `+0x28` were computed from (RUNT `+0x23c` / `+0x240`) | `0x41d737`, `0x41d73b` | compared each pass (`0x41d851..0x41d868`) |
| 0x24 | i32 | distance from the camera | `0x41d764` | `0x41d8f0` |
| 0x28 | i32 | bearing from the camera, as a 2²⁴ angle | `0x41d78a` | the pan (`0x41d91f`) |
| 0x2c | i16 | **armed or playing** | `0x41d78e` (0) | `0x41dadb`, `0x41dafa`, `0x41db51` |
| 0x2e | i16 | this pass's volume for the mixer, −1 when not a candidate | the pass sets −1 on every slot (`0x41b732`), then `0x41dae1` | `0x41db90` |
| 0x30 | ptr | the sound record, for the mixer | `0x41dae5` | `0x41dc1c`, `0x41dc28` |
| 0x34 | pstr[16] | **the set** it belongs to (`currentset` at creation) | `0x41d798` | `0x41d824..0x41d84b` |
| 0x44 | pstr[16] | **the sound**'s name | `0x41d7a9` | `0x41d9a9`, `0x41da85`, `0x41db5c` |

**The service, `0x41d810`:**

1. Skips the cricket if it is paused or belongs to another set.
2. If the camera has moved, recomputes the distance and bearing
   (`0x41d86a..0x41d8d1`).
3. Inside the radius, the volume is `255 − distance·K/radius`, with K the double
   at `0x4b6010`. The pan comes from the bearing against the heading, RUNT
   `+0x230` (`0x41d906..0x41d9a7`).
4. A **one-shot** counts `+0x18` down. At 0 it plays once if the camera is in
   range (`0x471fc0`, `0x4721e0`, `0x471720`) and then frees the slot, in range
   or not (`0x41d8df..0x41d9d9`).
5. A **repeating** cricket in range works in one of two ways:
   - If its sound is marked looping (`soundloop`; `0x472510` reads the sound's
     `+0x18`), it becomes a candidate: `+0x2c`, `+0x2e` and `+0x30` are set and
     `0x4c7200` counts it. The mixer `0x41db90` then plays the two loudest
     candidates (`0x471580`) and stops the rest (`0x4710d0`).
   - If not, it arms (`+0x2c = 1`, countdown `base + rnd`) and replays
     each time the countdown runs out (`0x41dafa..0x41db43`).

   Out of range, an armed cricket is disarmed and its sound stopped
   (`0x41db51..0x41db73`).

For a load, `+0x2e` and `+0x30` are scratch: the pass resets `+0x2e` before it
reads either, so the stale pointer in `+0x30` is never used. `+0x2c` only
decides whether a sound is stopped or restarted.

### Walks (`WAL*`), 16 × `0x80` at `0x4c3d40`

A walk is one actor's current motion. Each builder fills the record on the
stack and copies it into the first free slot after `0x41b810` stops any walk
of the same actor. Examples: `walktostar` at `0x41c59c`, from its builder
`0x41cd30` (or `0x41d290`, below).

| Offset | Type | Field | Written | Read |
|-------:|------|-------|---------|------|
| 0x00 | i16 | in use | `0x41cd63` | freed on arrival (`0x41b6a1`) or when a turn-only walk ends (`0x41b515`) |
| 0x02 | i16 | pause counter (`pausewalk`, `0x4091b0` → `0x41d440`) | `0x41cd68` (0) | `0x41b386` |
| 0x04 | i16 | **mode**: 0 turn only (`turntodeg`), 1 `walktostar`, 2 `walktoxyz`, 3 `walkonpath`, 4 `walkonroad`, 5 `walkonframes` | `0x41c399`, `0x41cd6c`, `0x41c6af`, `0x41cf22`, `0x41d04c`, `0x41d18c` | jump tables `0x41b7e4`, `0x41b7f8` |
| 0x06 | i16 | **deferred**: 1 when the actor was not in the current set, so the target is still a name in `+0x60` / `+0x70` | `0x41d2c2` (1), builders 0 | `0x41b3b9` |
| 0x08 | i32 | **the facing to turn to first**, a 2²⁴ angle: the bearing to the target, or `turntodeg`'s argument. −1 once the turn is done | `0x41cdb8`, `0x41c380`; −1 at `0x41b51c` | `0x41b4c4..0x41b506` |
| 0x0c / 0x10 / 0x14 | i32 | the actor's heading, pitch and roll, copied from actor `+0x1a` and written back to the actor each pass | `0x41cdbb` | `0x41b3cd`, `0x41b4e7` |
| 0x18 / 0x1c / 0x20 | i32 | **the start position**, copied from actor `+0x26` | `0x41cdbb` | `0x41b5d4`, `0x41b5ed`, `0x41b601` |
| 0x24 | handle | **the route**, a `DRIV` for modes 3–5, 0 otherwise. Freed on arrival | `0x41cdc3`; `0x41cfbc`, `0x41d0ed`, `0x41d22d` | `0x41b633`, `0x41b645`, `0x41b69e` |
| 0x28 | i32 | **progress**: distance covered in modes 1–4 (plus the actor's speed each pass), the frame index in mode 5 (plus 1) | `0x41cdc6` (0) | `0x41b58f..0x41b5a2`, `0x41b629`, `0x41b642` |
| 0x2c / 0x30 / 0x34 | i32 | **start minus target**, x/y/z | `0x41cdec`, `0x41cdf3`, `0x41ce02` | `0x41b5ab`, `0x41b5d1`, `0x41b5ea` |
| 0x38 | i32 | total distance, at least 1 | `0x41ce1a` | `0x41b592`, `0x41b5a8` |
| 0x3c | u32 | the actor's index in the actor table, a lookup hint (`0x4c2a48`) | `0x41ce34`, `0x41c3a5` | `0x41b394`, `0x41b3bd` |
| 0x40 | pstr[16] | **the actor**'s name | `0x41ce3a` | `0x41b397`, `0x41b810` |
| 0x50 | pstr[16] | the star the actor ends on (`actorstar` on arrival). `"custom"` for `walktoxyz`, `walkonroad` and `walkonframes` | `0x41ce46`, `0x41d310` | `0x41b686..0x41b690` |
| 0x60 | pstr[16] | deferred only: the first target name (the star, or the path's first star) | `0x41d2da` | the service's re-dispatch (`0x41b428`) |
| 0x70 | pstr[16] | deferred only: the second target name | `0x41d2e8` | `0x41b444`, `0x41b463`, `0x41b482` |

While a walk runs, the actor's own `actorstar` holds a sentinel naming the
walk: `"walktostar"`, `"walktoxyz"`, `"walkonpath"`, `"walkonroad"`,
`"walkonframes"` (`0x41ce4b`, `0x41c790`, `0x41cfe8`, `0x41d11d`, `0x41d25d`),
or `"defer"` (`0x41d33c`).

**The service, the walk half of `0x41b360`:**

1. Skips paused slots. Fetches the actor by `+0x40`, using `+0x3c` as the hint.
2. **Deferred** (`+6` ≠ 0): once the actor's set is the current one, calls the
   builder for its mode on `+0x60` / `+0x70`, which rewrites the slot as a
   normal walk (`0x41b3cd..0x41b496`). Mode 2 cannot be deferred (the fatal at
   `0x41b49b`).
3. **Turning** (`+8` ≥ 0): steps `+0xc` towards `+8` by the actor's `actorturn`
   (`0x41e300`) and writes the pose to the actor. On reaching the facing, it
   sends `"<actor>", endturn()` and either frees the slot (mode 0) or sets
   `+8 = −1` and starts moving (`0x41b4c4..0x41b56f`).
4. **Moving**:
   - modes 1 and 2 advance `+0x28` by `actorspeed`, clamp it to `+0x38`, and
     place the actor at `start − delta·progress/distance` (`0x41b58b..0x41b613`);
   - modes 3 and 4 advance by speed along the route (`0x41dfe0`);
   - mode 5 steps one frame (`0x41e1c0`).

   The route helpers take only the handle and the progress, so **the current
   leg is not stored**: it is derived from `+0x28`.
5. **Arriving**: sets `actorstar` to `+0x50`, frees the slot and its route, and
   sends `"<actor>", endwalk()` (`0x41b686..0x41b6f5`).

On load, the route of every in-use slot with a non-zero `+0x24` is read back
from the `DRIV` container that follows (`0x43da9f..0x43db18`). Everything else
is taken as it stands. A walk therefore resumes mid-stride, and a deferred walk
still waits for its actor's set.

TI's tables were 32 × 42, 16 × 74 and 16 × 110, so all three strides changed,
and the loops table doubled.

## `copylocal` (`COL*`)

The last container is new in v5. It is the table at `*0x4c2c98` (`Dfsp.c`,
read by `0x40f260`) of files that `copylocal` (`0x4183c0` → `0x40f3d0`) copied
off the disc onto the hard disk:

| Offset | Type | Field |
|-------:|------|-------|
| 0x000 | u32 | use stamp, from the counter at `0x4c2dd4`, for evicting the least recently used (`0x40f9d3..0x40f9e4`, compared at `0x40f5cb`) |
| 0x004 | i16 | `copylocal`'s flag argument (`0x40f9ee`) |
| 0x008 | pstr[256] | the source path (`0x40fa00`) |
| 0x108 | pstr[256] | the copy on the hard disk (`0x40fa16`) |

The table is **not restored**. The reader copies the container into a
temporary block (`0x43db28`, freed at `0x43dd28`). For each entry with a source,
it rebases the source path against slot 0 and calls `0x40f3d0` again to redo
the copy, for as long as that call returns non-zero. After the first zero it
stops copying and only looks each source up in the manifest, and nothing uses
the result (`0x43dbbf..0x43dd1e`). So the hard-disk cache is rebuilt from what
the save says had been cached.

## What loading does

`opengame` (`0x43cb10`) takes the version string and, after a comma (token
4020), an optional path (`0x43cb5b`). With no path it shows the open dialog for
type `'SAVE'` (`0x46b220`, `0x43cbd3`). If the reader returns 0, it runs the
resume (`0x43cbb4..0x43cbbe`).

**The reader, `0x43d1c0`:**

1. Checks the header (`0x48e720`) and opens the file (`0x46d210`).
2. Reads container 0 into `0x4dffac` and checks its prefix. It compares
   `+0x18` with `opengame`'s argument: the lengths must be equal and the
   characters equal ignoring case. A mismatch closes the file and gives *"This
   saved game is from a different version of this title."* (`0x43d28b..0x43d2ed`).
3. Keeps the disc name. Then it calls `0x46a080`, a routine in the main
   window's code (`"DFWINDOW"`), and three routines on `0x4c7a70`, all
   unidentified (`0x43d32b..0x43d357`).
4. Rebases the manifest's path slots 1–8 (`0x43d36a..0x43d3f5`).
5. **Closes the current game** with `0x439df0`, which also runs at quit. That
   routine does the following, in order:
   - closes each cast (`0x404a80`: `closeactor ()`, `closecast ()`);
   - closes each shop (`0x42afe0`: `closeprop ()`, `closeshop ()`);
   - closes the set, if one is open (`0x4407e0`: `closescene ()`, `closeset ()`);
   - closes the stage, if one is open (`0x4137d0`: `closeflat ()`, `closestage ()`);
   - closes the puppet, if one is open (`0x42eed0`: `closepuppet ()`);
   - frees the actors, props and tracks, and closes the files
     (`0x439ec1..0x43a0ad`).

   **The room being left gets its ordinary close events.**
6. If the save names a disc, switches to it with the routine the `currentcd`
   statement uses (`0x43c470`, also called from `0x43c436`). If that ends in
   quit or restart (`0x4c7f50`), the load stops (`0x43d427..0x43d465`).
7. Reads `RUNT` over `0x4c7808`, keeping the 22 host bytes (`0x43d474..0x43d4ec`).
8. Empties and rebuilds the five `litby` colour tables (`0x43d519..0x43d58e`).
9. Reads `ACT*`, `CAS*`, `PRO*`, `SHP*` and `TRA*` into the table handles
   (`0x43d580..0x43d5f8`), then each track's three sound lists
   (`0x43d625..0x43d839`).
10. Replaces the globals with `VARS` (`0x43d84c..0x43d894`).
11. Copies back loops, crickets and walks, and zeroes each loop's `+6`
    (`0x43d8ba..0x43da94`).
12. Reads the walks' routes (`0x43da96..0x43db22`).
13. Redoes the `copylocal` copies (`0x43db28..0x43dd28`) and closes the file
    (`0x43dd31`).

**The resume, `0x43dd80`:**

1. Installs path slots 1–8 (`0x43dd9d..0x43ddb6`).
2. Reopens every cast and rereads its header (`0x43dde3..0x43de4d`).
3. For every actor: rebuilds its colour table under its `litby` parent, relinks
   it to its cast file, rereads its `ACTO` member and resets its two timers
   (`0x43de59..0x43dfce`).
4. Reopens every shop (`0x43dfda..0x43e04a`), then does the same for every prop
   as for the actors (`0x43e057..0x43e1e7`).
5. Reopens every track (`0x43e1f4..0x43e236`). Resolves the theme track
   (`+0xb18`) and the current sound's track (`+0xb1c`) to their reopened files
   (`0x43e242..0x43e413`).
6. Reloads each track's sounds and theme segments, rebuilds the theme order and
   renumbers the sounds (`0x43e426..0x43e613`), then calls `0x449120`.
7. **Restarts the sound**: the sound whose track and `+0x24` match `+0xb1c` /
   `+0xb20` is played again through `0x471580`, the routine `singlesound`
   calls (`0x447c66`, `0x43e674`). **Restarts the theme**: the track matching
   `+0xb18` plays its theme order through `0x471210`, `playtheme`'s own call
   (`0x447426`, `0x43e68c`). Both start from the beginning, not from where the
   save was made.
8. **Reopens the room if a set was open** (`0x43e6b8`):
   - reopens the set file and rereads its `MAZE`, its `MHED`, `MAPR` and `MARK`
     containers;
   - builds the room from the `MAZE` (`0x4469d0`, `Scen.c`) and calls `0x432870`
     (`Rave.c`, which sets up the camera);
   - **goes to the saved place and view** with `0x434550(+0x108, +0x118)`.
     It looks the place up in MAPR, nodes and scenes both (`0x434586`, mask 3),
     and takes the node path when the record's type is 2 (`0x4345ae`)
     (`0x43e806`).
9. Reapplies heading, pitch, roll and field of view (`0x43e80b..0x43e82a`).
10. If a stage was open, reopens it and rereads its `STAG` and second container,
    then calls `0x415d80` and `0x415f90` (`0x43e82f..0x43e8fc`).
11. Clears the puppet flag (`0x43e907`) and frees the manifest. Then it calls
    `0x4887a0(0, 1)` (MCI code) and `0x4849d0(0x439f)`, and raises the redraw
    level to 2 (`0x432090`, `0x43e915..0x43e930`).

**No script runs for the restored room.** The resume reaches no script runner.
A search of its static call graph from `0x43dd80` finds none of these routines:
`0x43b9a0` (compile a text statement), `0x43bac0` (run it), `0x440de0` and
`0x440ab0` (send to set and to scene), `0x43f350` (`opensetfile`'s body, which
posts `openset()`) and `scenescript`. `0x434550` enters the scene through the
engine's own machinery. The same search from the reader reaches the runners
only through step 5's teardown.

So RedJack behaves as TI.EXE does (`saveload.ts`'s header), with one
difference: the room being *left* is closed with its scripts, where the port's
v4 load does not model that. **What the load re-derives:** the colour tables,
the loaded members' data (from the reopened files), the sound data and the
theme chain, the path table (rebased), the room's `MAZE` / `MAPR` / `MARK`, the
two actor and prop timers, and the hard-disk cache. **What it restores as
saved:** everything else, including the camera, `frame ()`, every table and
the globals.

## The version argument, the name and the extension

**`"2"` is a string compared, nothing more.** `savegame` writes its argument
into the manifest at `+0x18` (`0x43cd67`), and `opengame` compares its own
argument with that field, ignoring case (`0x43d290`). Nothing else reads it.
Titanic passes `"Titanic 1.0"` and Dust `"dust 0.3"` to the same check.

**The file:** `savegame` (`0x43c9b0`) first refuses in two cases:

- while a puppet is open (`+0x164`, *"Can't save game with puppet open."*,
  `0x43c9b6`);
- on a road, meaning a set is open and `0x4356d0` returns more than 0 (*"Can't
  save game while travelling on road."*, `0x43c9e9`).

A second argument after a comma is taken as the path, with no dialog
(`0x43ca51..0x43ca8d`). Otherwise the save dialog `0x46a930` is opened for type
`'SAVE'` with the default name **`savegame`** (`0x43cac2`, the string at
`0x4ba810`). The dialog appends the extension that `0x4695f0` makes from the
type code: `"."` (`0x4bab2d`) followed by the four letters lowercased (the table
at `0x4c0c60`), trailing spaces dropped (`0x469704`). So the dialog offers
**`savegame.save`**, and the file type `'SAVE'` is also what the open dialog
filters on (`0x43cbd5`). The writer deletes any old file of that name first
(`0x48e420`, `0x43cc24`). On a write error it shows *"Error writing to save
game file. Be sure the disk has enough free space."* and deletes the partial
file (`0x43d17c..0x43d19a`).

## Where it matches v4 and where it differs

| | `.ti` (TI.EXE) | `.save` (RedJack.exe) |
|---|---|---|
| fourCC | `0x00010000` | the same |
| signature @32 | `ODTRTRFD` | `EVASTR5D` (`'SAVE'`, `'D5RT'`), not checked on load |
| position table | 128 entries, container 0 at 1536 | 1024 entries, container 0 at 5120 |
| alignment | 64 | 64 |
| container prefix | none | 24 bytes, tag checked on every read |
| manifest | version, disc family, 9 paths, **CLUT**, files | version, disc, 9 paths, **theme and sound refs**, files |
| path of a reopened file | basename through the resource path | full path, prefix rebased on slot 0 |
| location block | 786 bytes @ `0x489d40`, three windows kept | 612 bytes @ `0x4c7808`, one 22-byte window kept, camera included |
| actor / prop record | 160 / 158 | 258 / 254 |
| cast, shop | 28 | 28 |
| track, sound | 40, 104 | 564, 46 |
| globals | nodes + separate pool container, name pairs with the *previous* value | one `VARS` container, node holds its own name, pool appended |
| permanents | | not in the save (live in the BOOTFILE) |
| loops / crickets / walks | 32×42 / 16×74 / 16×110 | 64×158 / 16×84 / 16×128 |
| walk payload | waypoint container | `DRIV` route |
| hard-disk cache | | `COL*`, re-copied on load |
| new room's `openset` / `openscene` | not run | not run |
| old room's `close…` scripts | | run, before anything is read |

## What the port needs

**A writer, for RedJack.exe to accept the file:**

- A DFile whose header has fourCC `0x00010000` and whose `+4` is **exactly** the
  file's length. The `'SAVE'`/`'D5RT'` signature and a 1024-entry table are
  what the original writes, and neither is checked.
- The containers in the order above, each with a correct prefix and tag. The
  count and stride words are not read, but should be written.
- **Container 0:**
  - the version `"2"` at `+0x18`;
  - a disc name that `currentcd` accepts, or an empty string, at `+0x118`;
  - slot 0 at `+0x218`, the prefix to rebase from (it must match the start of
    the saved paths, or they are used as written);
  - **slots 1–8, valid**: they are installed into the live path table;
  - `+0xb18..+0xb20`, zero for no theme and no sound;
  - one `{handle, path}` record for every handle that any cast, shop, track,
    set, stage, actor or prop field names, with a path that exists after the
    rebase.
- **Container 1:**
  - the RUNT prefix;
  - **the five table counts** (`+0x60`, `+0x68`, `+0x70`, `+0x78`, `+0x80`),
    equal to the records in the tables, because the counts come from here;
  - the set flag `+0xd0` with its file `+0xe0` and container indices `+0xe8`,
    `+0x128` and `+0x130`, and the set, scene and view names;
  - the stage fields, if a stage is open;
  - the camera fields and `frame ()`;
  - the five colour-table parameter blocks, as the engine's own defaults if
    nothing else.
- `ACT*` / `PRO*` records whose file handle is a cast or shop in `CAS*` / `SHP*`,
  and whose container index is the member's own.
- Three `SOU*` containers per track, with the counts at the track's `+4`, `+6`
  and `+8`.
- `VARS` whose capacity at `+0x1a` and pool size at `+0x24` describe the
  container's own length.
- `LOO*`, `BAL*`, `WAL*` and `COL*` at their **full fixed lengths**. Free slots
  are zeros, and an all-zero `COL*` does nothing.
- One `DRIV` for each walk slot that is active and has a route handle.

**A loader, for the port to restore a RedJack save:**

- The file table in container 0: old handle → path.
- From container 1: the set (the name at `+0xf8` and the file at `+0xe0` through
  the manifest), the scene and view, the camera (heading, pitch, roll, field of
  view), `frame ()` and `framerate`, and the stage if one is open.
- Every actor and prop record: name, set, star, pose or view, owner, visibility,
  position, angles, scale, value, and the drawing flags. The prop records are
  the inventory.
- The globals from `VARS`, and not the permanents.
- The cricket, loop and walk tables, per [the scheduler tables](#the-scheduler-tables).
  A timed loop (negative period) comes back due at once, as the original's does
  after it zeroes `+6`.
- Which theme and which sound to start again, from `+0xb18..+0xb20`.
- The open casts, shops and tracks to reopen, taken from their tables and not
  guessed from the room, as with TI's
  [crowd](savegame.md#the-crowd-comes-from-this-container).
- **Before any of that, the old room's close events**: `closeactor`,
  `closecast`, `closeprop`, `closeshop`, `closescene`, `closeset`,
  `closeflat`, `closestage` and `closepuppet`, in the teardown's order.
  Afterwards, no `openset` or `openscene` for the restored room.

## Open questions

- **No save to check against.** No layout on this page has been compared with
  a file RedJack.exe wrote. The first shipped or DosBox-made `.save` should be
  read against it before a writer is trusted.
- **The scheduler records' unread bytes.** Every field that code writes or
  reads is mapped. Nothing was found using cricket `+0x2e..+0x33` beyond the
  mixer, or walk `+0x44..+0x4f` beyond the actor name's pstr. A writer should
  zero whatever the tables leave unnamed.
- **What the walk route helpers need from a `DRIV`** (`0x41dfe0`, `0x41e1c0`),
  and what the path and road builders copy into `+0x24` (`0x444890`,
  `0x444660`, `0x434440`, `0x444d50`). Not traced.
- **The rest of the track and sound records**, beyond the fields listed above.
- **The 22 kept bytes of RUNT** (`+0x18..+0x2d`). Only `+0x2a` (the BOOTFILE) is
  identified.
- **RUNT fields without a name**:
  - `+0x3e`, a counter raised and lowered around something at `0x408c3c`;
  - `+0x40`, and `+0x4a` (flags);
  - `+0x88..+0x8a`;
  - `+0xd4..+0xda`, `+0xf0..+0xf6`, `+0x134`, `+0x138`, `+0x154..+0x160`;
  - in the camera group, `+0x21c..+0x22c` and `+0x254..+0x25c`.

  The node question is settled: `+0x108` names the node or the scene. Whether
  the room is at a node, in a scene or on a road lives in `0x4c8f18`, outside
  the save, and is re-derived when the place is entered.
- **What advances `frame ()`.** A search finds no writer of RUNT `+0x42` except
  the startup clear (`0x439bfd`). Either it is written through a pointer that
  the search cannot see, or RedJack's `frame ()` never moves.
- **What `0x434550` does when it enters the scene**, beyond not reaching a
  script runner directly: whether it triggers a node's or a quad's handlers
  through a dispatch the static call graph cannot see (a function pointer).
- **The four calls at the start of the reader** (`0x46a080`, and `0x4834b0`,
  `0x483580`, `0x483de0` on `0x4c7a70`) and the calls at the end of the
  resume (`0x4887a0`, `0x4849d0(0x439f)`, `0x449120`).
- **The `copylocal` loop**: what `0x40f3d0`'s return value means, and why the
  loader looks the remaining sources up in the manifest without using the
  answer.
- **What the interpreter does after `opengame` returns.** The script that called
  it belonged to a stage or set that the load has just closed.
- **Whether the puppet table rebuilt from the set's parameters**
  (`0x43d571..0x43d57b`) has any effect, given that the puppet is closed.
- **The open dialog's filter string**, built from `'SAVE'` by `0x46abc0`, is not
  traced.
