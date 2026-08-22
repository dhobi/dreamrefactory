# Saved games, DreamFactory 1 (`.rtd`)

*Prerequisite: [Saved games (`.ti`)](savegame.md) — the v4 format, which this one
is the ancestor of, and whose reader parses these files unchanged.*

Dust's control panel writes a save with `savegame("dust 0.3")` and reads one back
with `opengame("dust 0.3")` — the same two opcodes Titanic uses (12077 / 12078),
three years earlier. The five example saves under `gamefiles/dust/save/` were
produced by the shipped `DF.EXE`.

Reference implementation: [`src/df/savegame-v1.ts`](https://github.com/dhobi/taoot-web/blob/master/src/df/savegame-v1.ts)
(the byte format), [`src/df/save-vars.ts`](https://github.com/dhobi/taoot-web/blob/master/src/df/save-vars.ts)
(the variable list, shared with v4) and
[`src/engine/saveload-v1.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/saveload-v1.ts)
(what the session puts in and takes out).

## It is the same file

A `.rtd` is the **same container skeleton** a `.ti` is, in every byte of the
envelope:

| Offset | Value |
|-------:|-------|
| 0 (`fourCC`) | `0x00010000` |
| 4 | file size |
| 16 | position-table capacity, `ceil(count/128)·128` |
| 20 | container count |
| 32 (signature) | `ODTRTRFD` |
| 1024 | the position table |
| 1536 | container 0; every later one aligned to 64 |

All of it proven from the writer: `savegame` at `0x419CD0` calls
`0x4284E0(path, 100, 'ODTR', 'TRFD')`, which builds that header verbatim
(`mov [esp+0xc],0x10000` at `0x428532`, `shl eax,7` at `0x428548`,
`lea ecx,[eax+2]; shl ecx,9` at `0x42853A` for the 1536). `'ODTR'` is also what
selects the `*.rtd` filter in the file-dialog helper at `0x427882`.

So `readSaveFile` and `writeSaveFile` take Dust's saves with no changes at all,
and reproduce every byte the loader reads in all five shipped files. The only
bytes a rewrite differs in are the **unused tail of the position table**, where
the original left process memory — in four of the five it is legible
(`appl:bootfile`, the tail of `unilib.snd`), which is the boot's own file list
still lying in the heap the writer dumped. We zero it, as we do in `.ti`.

What differs is *inside*: some container-0 and container-1 offsets, and four
record strides.

## The containers

The writer emits one container per step, in a fixed order, and the count is
therefore `7 + 3·banks + 5 + payloads` — so every index is **computed**, never
searched for. (v4 has to hunt by content; its globals probe looks for the strings
`mission` and `playerdeath`, which no Dust save contains.)

| # | Contents | Stride |
|---|----------|--------|
| 0 | version string, nine resource paths, the loop-sound state, the CLUT, the open-file manifest | 260 per file record |
| 1 | the standpoint — a verbatim 542-byte dump of the engine block at `0x4609E0` | — |
| 2 | the cast | **164** (v4: 160) |
| 3 | open cast files | 28 |
| 4 | the props | 158 (same as v4) |
| 5 | open prop files | 28 |
| 6 | open sound banks | 38 |
| 7 … 6+3n | three arrays per bank (registered / playing / looping) | 104 |
| +1 | the globals | 32 per node |
| +2 | the string pool | — |
| +3 | loops | 42 (same as v4) |
| +4 | crickets | **48** (v4: 74) |
| +5 | walks | **82** (v4: 110) |

Container payload sizes are always a multiple of 32 because the writer stores
`GlobalSize(handle)` rather than the used length (`0x421360`), which is why every
table trails slack.

## Container 0 — the manifest

| Offset | Field |
|-------:|-------|
| 0 | the **version string** (`"dust 0.3"`), a Pascal string |
| 0x100 + 256·i | nine resource path prefixes (`appl:`, `dust:data:`, `dust:puppets:`, …) |
| 0xA00 | the loop sound: `{u32 bank file, u32 playing bank, u32 chunk}` |
| 0xA0C | the live CLUT, 256 × `{i16 index, i16 rgb[3]}` — v4's `0xB0C` minus `0x100` |
| 0x120C | the open-file record count — v4's `0x130C` minus `0x100` |
| 0x1210 + 260·k | `{u32 old heap handle, pstr path[256]}` |

Record 0 is always the `.rtd` itself, with the full DOS path it was written to
(`C:\DUST\GOTBONE.RTD`) — the original's saves were plain 8.3 names anywhere on
disk, with no slots and no fixed names.

The handles are the file's own cross-reference table: every other container that
names a file does it by handle, and resolves it here.

### The version string is a gate, and the game contradicts itself about it

The loader compares the script's argument against container 0 + 0 byte for byte
and **case-sensitively** (`0x4303C0`, called at `0x41A599`); a mismatch is
*"This saved game is from a different version of this title."*

Dust passes two different spellings. The panel's Save and Open buttons pass
`"dust 0.3"`; both quit dialogs and the debug menu pass `"Dust 0.3"`. So **a save
written on the way out of the original game cannot be reopened by the original
game**. That is a bug in Dust, not a version difference, so this port compares
case-insensitively — the only liberty it takes with the gate.

## Container 1 — the standpoint

A verbatim dump of `0x4609E0`, and only **`[244,542)` minus `[308,312)`** comes
back out of it: the loader stashes the live block's `[0,122)`, `[122,244)` and the
dword at `+308`, copies all 542 bytes in, then restores what it stashed
(`0x41A681`). Every field below is inside that window, which is also why a patch
may copy the first 244 bytes from its base without thinking about it.

| Offset | Field |
|-------:|-------|
| 248 | the **frame counter** — what `frame()` answers (`inc DWORD ds:0x460AD8` at `0x4334AD`) |
| 356 | the open **flat file**, as a manifest handle (`appl:local:new.flt`) |
| 372 | the flat's base name (`"new"`) |
| **396** | the open **set file**, as a manifest handle (`dust:data:nite.set`) |
| 446 / 448 | the **grid cell** — column, row |
| 450 | the **facing**, 1..4 |
| 458 | the camera's heading, 0..255 (192 north, 0 east, 64 south, 128 west) |
| 460 / 462 | the camera in world units — `cell·256 + 128` when standing still |
| 482 | the set's **name** (`"town"`) |
| 506 / 526 | the open **puppet**: its manifest handle, and its name |

### Where you are is a cell, not a scene name

This is the sharpest difference from v4, which writes the scene's and the view's
names as strings. Dust addresses a standpoint the way its SET does — a column, a
row and one of four facings — and the names (`Scene G14`) exist only in the set's
own scene table. Proven by identity: `START.RTD` reads (6, 14, 1), and
`NITE.SET`'s own "where the player stands when no scene is named" triple is
(6, 14, 1).

### The room is the FILE, not the name

Dust's town exists twice — `town.set` by day and `nite.set` by night — and **both
are named `"town"` inside**. So the name at +482 cannot say which file to reopen;
the handle at +396 can, and does: it resolves to `dust:data:nite.set` in all five
shipped saves, every one of which says `"town"` in the name field beside it.

This is the same indirection v4 documents (its set id at c1+544), and skipping it
has a memorable symptom: a save taken at midnight comes back at noon, in the
daylight town, with the wrong palette over it.

It also constrains **writing**. A save taken in a room the base save did not have
open must rewrite the manifest record the handle points at — same handle, same
volume prefix, new file name — because the handle is what every other reference
in the file resolves through.

## The records

### The cast — 164 bytes

Stride proven three ways: the growth arithmetic at `0x411DF0`, a `rep movsd
ecx=0x29` at `0x411E2F`, and `add edi,0xa4` in the scan at `0x4129B3`.

| Offset | Field |
|-------:|-------|
| 0 | `actorvisible` |
| 24 | `actordeg`, 0..255 |
| **26 / 28 / 30** | the world position: **x across, y into the screen, z up** |
| **44** | `actorscale`, per mille |
| **36 / 40** | `actorturn`, `actorspeed` |
| 84 | the name (Pascal string, 16-byte field) |
| 100 / 116 / 132 / 148 | `actorset`, `actorstar`, `actorpose`, `actorowner` |

The string half is v4's exactly, on the same 16-byte stride from the name; the
numeric half is four bytes longer, so v4's tail offsets do not transfer.

Two of these fields are load-bearing in a way that is invisible in the file:

- **`actorscale`.** A load resets the cast before applying records, and a reset
  actor has scale 0 — which the draw list skips. Restore everything else
  perfectly and leave this at 0, and the town comes back deserted. Identified by
  what the values are: the cow reads 2400 and the dog 880, Leroy 1100, and every
  character never placed reads exactly 1000.
- **`actorturn` and `actorspeed`**, at +36 and +40 — and they were read off the
  RUNNING GAME rather than picked from plausible-looking numbers. The port's boot
  is script-driven, so the values Dust's own scripts set are observable: Leroy,
  the dog and the horse all run at speed 3 and turn 7, the pig at 12 and 16, and
  the record reads exactly those at +40 and +36. A first attempt took +78 and
  +80, where the numbers are 32, 64, 100 and a uniform 100 — they *look* like a
  speed and a turn rate, and they are an order of magnitude out, so every
  restored walker crossed the town at a sprint.
- **the axis order.** `y` is depth, not height. Read as x/y/z with y up, every
  character lands at depth 0 — the camera's own eye — and the projection refuses
  them. The port's own boot is the witness: script-placed `dog` stands at
  (1620, 2748, 0) and its record reads 1620, 2748, 0.

### The props — 158 bytes

Same stride as v4, and the same offsets for every string field.

| Offset | Field |
|-------:|-------|
| 0 | `propvisible` |
| 18 | `propis3d` |
| **20 / 22** | the screen anchor — **y first, then x** |
| 24 | `propdeg` |
| 26 / 28 / 30 | the world position (same axes as the cast) |
| **40** | `propdist` — the z-order |
| 42 | `propscale`, per mille (800, 1000, 1200, 4230 across the corpus) |
| 78 / 94 / 110 / 126 / 142 | name, set, star, `propview`, `propowner` |

The screen anchor is pinned by the game's own arithmetic rather than by analogy:
`INVEN.PRP` puts a dropped item back with `propxy(handitem, 316, 320)`, and every
prop the panel owns reads exactly 320 at +20 and 316 at +22. `propdist` the same
way — `NEW.FLT`'s `showprop` sets every panel item to `propdist(thename, -1)`, and
the panel's props read exactly −1 while the world's `shootingstar` reads a real
depth.

### The file lists — 28 bytes

`{u32 ptr, u32, u32, pstr name[16] @+12}`, the same shape as v4's — except **the
names carry no extension** (`gang`, `extra`, `house`, `inven`), which is why v4's
`/\.cst$/` test finds nothing here. A load has to reopen these files, so the
extension is read back out of the container-0 manifest, where the full path is.

### The scheduler tables

`loops` is **byte-identical to v4** (32 × 42: `{u16 active, u16 kind @4, u32
period @6, pstr name @10, pstr handler @26}`, kinds 1=actor 2=prop 3=scene
4=flat), so the v4 decoder reads it unchanged. `crickets` (16 × 48) and `walks`
(16 × 82) are v1's own sizes.

The **cricket** table is entirely zero in all five shipped saves, so beyond
`active @0` and the name at `+0x20` there is nothing to check a field against, and
nothing is guessed.

The **walk** table is not: AFTERDOG has two walkers in flight.

| Offset | Field |
|-------:|-------|
| 0 | `active` — a clear slot holds the LAST walk it ran, not a live one |
| 4 | a facing to end on, or −1 |
| 8 / 12 / 16 | the three deltas, i32 each |
| 20 | the whole distance, i32 |
| 24 | the walker's current facing |
| 26 / 28 / 30 | **the destination**, in world units |
| 32 / 34 | the destination as a grid cell |
| 36 | an authored route's waypoints, as a container handle (0 = a straight line) |
| **40** | how much of the distance is **LEFT** |
| 50 / 66 | the walker, and the star they are walking to |

Mapped by **reconstruction**, which is the strongest evidence this format offers:
the fields have to predict the position the *cast* record — a different table,
written by the same engine at the same instant — independently reports. Jones is
82% of the way to `town.jones2`:

```
destination   (1624, 1872)      +26 / +28
delta         (-112, -616)      +8 / +12
start         (1736, 2488)      destination - delta
distance       626              +20, and hypot(112, 616) = 626.1
remaining      111              +40
covered        515              626 - 111
predicted     (1643, 1981)      start + delta x 515/626, truncated
the cast says (1643, 1981)      cast record +26 / +28
```

and Help, 29% along a 131-unit step in the same file, lands the same way. Two
walkers, two files, no field left over — and the truncation is the same fix-point
truncation the projection uses (rounding puts Jones a pixel east).

Restoring the walk table is not optional, because a walker is recorded in **two**
tables and the cast record hands over the `walk` pose. An actor plays its pose
whether or not anything is moving it, so restoring the cast without the walks
brings a character back marching on the spot — which is what loading AFTERDOG did
until this table was read. Anyone whose walk cannot be resumed is stood up
instead; the play page learned the same lesson at #181.

An authored route's waypoint container is **not** reproduced when writing: such a
walk is written as the straight line its own record carries, and the caller is
told. None of the five shipped saves has one.

## The globals never changed

The variable list and its string pool are **the same format in both engines**, to
the byte: a 28-byte header describing the pool, then 32-byte nodes whose DFValue
belongs to the *next* node's name. So both format modules share one codec
([`save-vars.ts`](https://github.com/dhobi/taoot-web/blob/master/src/df/save-vars.ts)).

| Offset | Field |
|-------:|-------|
| 0 / 2 | variable count, capacity |
| 8 / 12 / 16 | the pool's watermark, size, and heap handle |
| 20 / 22 | **the head variable's DFValue** |
| 28 + 32k | node *k*: `{u32 link, u32 link, pstr name[12] @8, u32 vtable @20, u16 type @24, i32 value @26}` |

Two things carry over from the `.ti` work and are worth restating because they
cost something to learn there:

- **the vtable is a pointer, not a magic number.** These files read `0x87C4989F`
  where the shipped `.ti` saves read `0x00431E0F`. Read it out of the file by
  agreement across its own nodes; never hardcode it.
- **the head variable is real storage.** Its DFValue sits one stride back, in the
  blob header at +20/+22. The `.ti` writer declines to touch its head and can
  afford to — TAOOT's head is `clock`. Dust's is **`day`**, the variable the whole
  five-day story is counted in, so this writer does write it.

### What the five shipped saves say

They are one fresh game, played a few minutes in, and they read as a story:

| | START | DOG | HELP | GOTBONE | AFTERDOG |
|---|---|---|---|---|---|
| frame | 167 | 312 | 525 | 705 | 958 |
| `handitem` | helpbut | helpbut | helpbut | **Bone** | **ring** |
| `phase` | 0 | 0 | 0 | 0 | **2** |
| cell | (6,14) | (6,11) | (6,11) | (6,13) | (6,11) |
| puppet open | — | — | help1.pup | help1.pup | help1.pup |

`day=1`, `playercash=5` and `bulletcount=6` throughout; the prop grid agrees with
the globals (the Bone is owned by `stranger` and visible in GOTBONE, the Ring in
AFTERDOG), and so does the cast (`Help` is unplaced in START and standing on
`town.help` from DOG on). The frame counter is what orders them.

## What is not resolved

Honest gaps, all of them fields the port fills from the live object rather than
guessing:

- the cast record beyond `+0/+18/+24/+26..30/+44/+78/+80` — 84 numeric bytes, and
  v4's tail offsets do not transfer;
- the prop record beyond the fields tabled above;
- the cricket record beyond `active` and the name;
- a walk's waypoint payload container (no shipped save has one), and the walk
  record's type word — it reads 1 for every sample in the corpus, walkers
  included, so it cannot be what distinguishes a turn from a journey; a turn is
  recognised by going nowhere instead;
- `c13+4`, and the individual roles of `c1` 352–444 and 464–480 (their *purpose*
  is clear — interpolation copies of the standpoint — the field-by-field split is
  not).

Next: what the session does with all this — **[Saving & loading at runtime](../runtime/saves.md)**.
