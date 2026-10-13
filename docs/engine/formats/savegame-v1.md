# Saved games, DreamFactory 1 (`.rtd`)

*Prerequisite: [Saved games (`.ti`)](savegame.md) — the v4 format, which this one
is the ancestor of, and whose reader parses these files unchanged.*

Dust's control panel writes a save with `savegame("dust 0.3")` and reads one back
with `opengame("dust 0.3")` — the same two opcodes Titanic uses (12077 / 12078),
three years earlier. The saves under `gamefiles/dust/save/` were produced by the
shipped `DF.EXE`, and they are not examples: ordered by their frame counter they
are one continuous playthrough of the whole game
([the golden thread](../../dust/thread.md)).

Reference implementation: [`engine/src/df/savegame-v1.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/savegame-v1.ts)
(the byte format), [`engine/src/df/save-vars.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/save-vars.ts)
(the variable list, shared with v4) and
[`engine/src/runtime/saveload-v1.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/saveload-v1.ts)
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

So `readSaveFile` and `writeSaveFile` take Dust's saves unchanged, and reproduce
every byte the loader reads in every shipped file. A rewrite differs only in the
**unused tail of the position table**, where the original left process memory —
usually legible (`appl:bootfile`, the tail of `unilib.snd`): the boot's own file
list, still in the heap the writer dumped. The port zeroes it, as in `.ti`.

What differs is *inside*: some container-0 and container-1 offsets, and four
record strides.

## The containers

The writer emits one container per step, in a fixed order, and the count is
therefore `7 + 3·banks + 5 + payloads` — so every index is **computed**, never
searched for. v4's map is computed the same way (`saveIndex`); searching by
content fails on Dust saves, which contain none of v4's marker strings (#325).

| # | Contents | Stride |
|---|----------|--------|
| 0 | version string, nine resource paths, the theme and effect channels, the CLUT, the open-file manifest | 260 per file record |
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

The count *proposes* `banks` and the file *confirms* it, because three waypoint
payloads cost exactly what one more sound bank costs. Three checks, each
catching something the others cannot (#325):

- the three service tables are **fixed sizes** (`0x540` / `0x300` / `0x520`), so
  the tail of the map has to land on all three. Over the 56 shipped saves exactly
  one `banks` value does that in each, so when the count's proposal fails, solving
  for the one that fits recovers the map rather than giving up;
- the leftover container count has to equal the number of **active walk slots that
  declare a payload** (`+0x24` non-zero) — the check that catches a `banks` off by
  one in the direction the fixed sizes cannot see;
- and container 6 has to have room for the banks (38 bytes each).

No shipped save reaches three payloads — 43 carry none and 13 carry one — so the
count alone is right on every real file. A save this port writes can reach three,
so the reader checks rather than trusting the arithmetic.

Container payload sizes are always a multiple of 32 because the writer stores
`GlobalSize(handle)` rather than the used length (`0x421360`), which is why every
table trails slack.

`D1E_001.RTD`, the earliest save in the collection, mapped by that arithmetic
alone:

<ByteMap map="d1e_001.rtd" />

Two open sound banks, so `7 + 3·2 = 13` is the globals container, and the five
tail tables follow it. Beside [the Titanic save](savegame.md) it has the same
seven-container head, the same three-per-bank middle, the same five-table tail —
with different strides.

## Container 0 — the manifest

| Offset | Field |
|-------:|-------|
| 0 | the **version string** (`"dust 0.3"`), a Pascal string |
| 0x100 + 256·i | nine resource path prefixes (`appl:`, `dust:data:`, `dust:puppets:`, …) |
| 0xA00 | the **theme**: channel 3's bank file handle, 0 when the channel is idle (`0x429D10`) |
| 0xA04 | the **effect**: the bank file handle of the sound on channel 1 or 2, 0 when neither is busy (`0x429E10`) |
| 0xA08 | ...and that sound's 1-based record number in its bank file |
| 0xA0C | the live CLUT, 256 × `{i16 index, i16 rgb[3]}` — v4's `0xB0C` minus `0x100` |
| 0x120C | the open-file record count — v4's `0x130C` minus `0x100` |
| 0x1210 + 260·k | `{u32 old heap handle, pstr path[256]}` |

The three sound words are filled by the writer at `0x419E36`–`0x419E68` by
asking the sound system, channel by channel, whether it is busy (`0x409280`).
The theme's record number is fetched too and thrown away: a load restarts the
theme bank's loop list from the top (`0x41B2EC` → `0x429FA0`) rather than
resuming a chunk. The effect is replayed from the start through `0x42A070` as
its bank's records are re-registered (`0x41B1AA`). So `D1E_001` (theme
`night.snd`, no effect) loads with the night theme playing, and `D2M_004` (no
theme, effect `mayor.snd` record 12) with the hall clock ticking — reading
`+0xA04` as "the theme that is playing" had both the wrong way round.

Each bank's first two record arrays (104 bytes a record: one-shots, then the
theme's loop chunks) carry what a script can change about a sound, and the loader
reads it back after re-registering each record (`0x41B12D`–`0x41B190`): `+0x2F`
`soundvol` (registered 255), `+0x31` `soundpan` (128), `+0x33` `soundloop` (0,
one-shots only). A chunk's volume is its track's `themevol`. `+0x41` is the
record's number in the bank file and `+0x45` its name.

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
case-insensitively — its only departure from the gate.

## Container 1 — the standpoint

A verbatim dump of `0x4609E0`, and only **`[244,542)` minus `[308,312)`** comes
back out of it: the loader stashes the live block's `[0,122)`, `[122,244)` and the
dword at `+308`, copies all 542 bytes in, then restores what it stashed
(`0x41A681`). Every field below is inside that window, so a patch may copy the
first 244 bytes from its base unchanged.

| Offset | Field |
|-------:|-------|
| 248 | the **frame counter** — what `frame()` answers (`inc DWORD ds:0x460AD8` at `0x4334AD`) |
| 268 | `puppetgrab` (`0x4361FD`) |
| 302 | the frame interval `framerate (n)` sets — 60 Hz ticks per drawn frame, default 3 (`0x42077D`; the pacing loop at `0x434167`) |
| 356 | the open **flat file**, as a manifest handle (`appl:local:new.flt`) |
| 390 | `setvisible` (`0x410151`) — `opensetfile` resets it to 1, which a load does not run |
| 392 / 394 | the **player's** hitbox, `actorhitbox ("player", rz, rxy)` (`0x41314C`) |
| **428 / 430** | the room's **camera**: `cameraSetback` and `eyeHeight`, copied from the set's own header (c0+0x18/0x1a) |
| 372 | the flat's base name (`"new"`) |
| **396** | the open **set file**, as a manifest handle (`dust:data:nite.set`) |
| 446 / 448 | the **grid cell** — column, row |
| 450 | the **facing**, 1..4 |
| 458 | the camera's heading, 0..255 (192 north, 0 east, 64 south, 128 west) |
| 460 / 462 | the camera in world units — `cell·256 + 128` when standing still |
| **472 / 474 / 476** | the **projection's eye** — x, y, height: what `0x433C60` (the world-to-screen every drawn actor goes through) reads as its camera. x/y are the cell centre pushed back `setback` along the facing; the height equals +430 in all 61 shipped saves |
| 482 | the set's **name** (`"town"`) |
| 506 / 526 | the open **puppet**: its manifest handle, and its name |

### The camera is the room's, and the actors hang from it

+430 is per room — 62 in the town, 130 upstairs at the mayor's, 230 in the
Chinese laundry — and it is load-bearing the same way the registers at +404/+416
are: a save moved to another room that keeps the base's value projects the new
room's cast through the old room's eye height. The error is purely vertical —
`(room − stale) · focal / depth` pixels — so every restored character hovers or
sinks by the same world-unit difference (68 units up the wall of `mayupper` for
the Mayor's wife, on a save patched from a town base, #320). The load rebuilds
the eye x/y from the grid cell (`0x433D20`) but takes the height from +430.

### Where you are is a cell, not a scene name

This is the sharpest difference from v4, which writes the scene's and the view's
names as strings. Dust addresses a standpoint the way its SET does — a column, a
row and one of four facings — and the names (`Scene G14`) exist only in the set's
own scene table. `START.RTD` reads (6, 14, 1), and
`NITE.SET`'s own "where the player stands when no scene is named" triple is
(6, 14, 1).

### The room is the FILE, not the name

Dust's town exists twice — `town.set` by day and `nite.set` by night — and **both
are named `"town"` inside**. So the name at +482 cannot say which file to reopen;
the handle at +396 can. The collection has saves named `"town"` whose handle
resolves to `dust:data:nite.set`, and saves named `"town"` whose handle resolves
to `dust:data:town.set`.

This is the same indirection v4 documents (its set id at c1+544). Reopening by
name brings a midnight save back at noon, in the daylight town, with the wrong
palette over it.

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
| 18 | `is3d` — in the world, as opposed to screen-anchored (the props' +18, same offset) |
| 24 | `actordeg`, 0..255 |
| **26 / 28 / 30** | the world position: **x across, y into the screen, z up** |
| **44** | `actorscale`, per mille |
| **36 / 40** | `actorturn`, `actorspeed` |
| 20 / 22 | the screen anchor, y then x (`actorxy`, `0x412F7B`) |
| 32 / 34 | the tile of the star last given (x >> 8, y >> 8; not kept up by a walk) |
| 38 | the step within the pose (reset by `actorpose`, `0x4122E3`; advanced by the draw) |
| 42 | `actordist` for a screen actor; a world actor's last projected depth |
| 48 | a serial number (counter at `0x45E490`) |
| 52..72 | the last draw's cache: frame handle, clipped rect, foot point (y +64, x +66), size |
| **74** | `actorvalue`, i32 (`0x414933`) |
| **78** | `actorzclip` (`0x4149D3`) |
| **80 / 82** | `actorhitbox`: rz, rxy (`0x413182`; the player's is in container 1) |
| 84 | the name (Pascal string, 16-byte field) |
| 100 / 116 / 132 / 148 | `actorset`, `actorstar`, `actorpose`, `actorowner` |

The string half is v4's exactly, on the same 16-byte stride from the name; the
numeric half is four bytes longer, so v4's tail offsets do not transfer.

These fields are load-bearing in a way that is invisible in the file:

- **`is3d`.** The draw gate (`0x414fd0`) branches on this word before anything
  else. Nonzero is the world path: the actor's set (+100) is compared against the
  standpoint's set name (c1+482) — the filter that keeps a visible actor from
  ANOTHER room off the screen — and the rect is recomputed by projecting the
  world position and scale (the cached rect at +56…+70 is output, never input).
  Zero is the screen-anchored path: no set filter, no projection, the rect read
  off the anchor words at +20/+22, which a never-placed record holds as (0, 0).
  Left at 0, every visible actor — whatever room it belongs to — is drawn in the
  top-left corner at its raw per-mille scale: a fragment of the town cast inside
  an interior, and a giant hovering Mayor's wife. Across the shipped corpus no
  visible record holds 0 here, and plenty of INVISIBLE ones hold 1: the original
  sets it when an actor is first placed and never clears it.

- **`actorscale`.** A load resets the cast before applying records, and a reset
  actor has scale 0 — which the draw list skips. Left at 0, the town comes back
  deserted. Identified by its values: the cow reads 2400 and the dog 880, Leroy
  1100, and every character never placed reads exactly 1000.
- **`actorturn` and `actorspeed`**, at +36 and +40, identified against the
  running game: the port's boot is script-driven, so the values Dust's own
  scripts set are observable. Leroy, the dog and the horse all run at speed 3 and
  turn 7, the pig at 12 and 16, and the record reads exactly those at +40 and
  +36. +78 and +80 (32, 64, 100 and a uniform 100) look like a speed and a turn
  rate but are `actorzclip` and the first hitbox word.
- **the axis order.** `y` is depth, not height. Read as x/y/z with y up, every
  character lands at depth 0 — the camera's own eye — and the projection refuses
  them. In the port's boot, script-placed `dog` stands at (1620, 2748, 0) and its
  record reads 1620, 2748, 0.

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
| 32 / 34 | the tile of the star last given |
| 36 | the step within the view (reset by `propview`, `0x41C13A`) |
| 46 | a serial number |
| 50..70 | the last draw's cache (foot point y +62, x +64) |
| **72** | `propvalue`, i32 (`0x41BBC3`) |
| **76** | `propzclip` (`0x41BC63`) |
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

`loops` is **byte-identical to v4** (32 × 42: `{u16 active, u16 pause depth @2,
u16 kind @4, u32 period @6, pstr name @10, pstr handler @26}`, kinds 1=actor
2=prop 3=scene 4=flat), so the v4 decoder reads it unchanged. The second and
third tables are v1's own.

**The 16 × 48 table is not crickets.** Its ids are the ones v4 gives
`makecricket`, but in DF.EXE they are `makeball`'s: a prop thrown through the
room (insert `0x439CB0`, served by `0x439CF0`), restored into the port's ball
runtime.

| Offset | Field |
|-------:|-------|
| 0 / 2 | `active`, pause depth (`pauseball`) |
| 4 / 6 / 8 | velocity x, y, z |
| 0xA / 0xC | gravity, bounce |
| 0xE | passes left |
| 0x10 / 0x12..0x16 | deg, then x, y, z — copied from the prop |
| 0x18 / 0x1A | tile x, y (`>> 8`) |
| 0x1C | the prop's slot in the prop table |
| 0x20 | the prop's name |

46 shipped saves carry slot 0, always `tumbleweed`; 30 of them have it in flight
(`D2A_001`: v(−12, 0, −3), 120 passes left, at (1113, 1714, 15)).

The **walk** table (`walktostar` `0x439260`, served by `0x4395C0`):

| Offset | Field |
|-------:|-------|
| 0 | `active` — a clear slot holds the LAST walk it ran, not a live one |
| 2 | pause depth (`pausewalk` adds and takes one, floor 0) |
| 4 | a facing to end on, or −1 |
| 6 | a turn on the spot (`turntodeg`) |
| 8 / 12 / 16 | **start minus destination**, i32 each |
| 20 | the whole distance, i32 |
| 24 | the walker's current facing |
| 26 / 28 / 30 | **where the walk started**, in world units |
| 32 / 34 | that start as a tile |
| 36 | an authored route's waypoints, as a container handle (0 = a straight line) |
| **40** | how far the walker has **COME** |
| 44 | 1 if the walker moves; 0 while it is not in the open set |
| 46 | its slot in the cast table |
| 50 / 66 | the walker, and the star they are walking to |

`walktostar` copies the actor's own position block into +26 (`0x439459`) and sets
the delta to start minus star (`0x4394A9`); the service adds the actor's speed to
+40, clamps it (`0x439880`) and places the walker at `start − delta ·
covered / dist` (`0x439890`). Jones in `D2A_002`:

```
start         (1624, 1872)      +26 / +28
start − star  (-112, -616)      +8 / +12  →  town.jones2 is (1736, 2488)
distance       626              +20, and hypot(112, 616) = 626.1
covered        39               +40
predicted     (1630, 1910)      start − delta × 39/626, truncated
the cast says (1630, 1910)      cast record +26 / +28
```

Read the other way round — +26 as the destination and +40 as what is left — the
same position falls out, which is how this table was first read; a walk resumed
that way walked back to where it began.

A walk on an authored route never writes +8..+23: they hold stack leftovers. Its
geometry is the **waypoint payload**, one container after the walks table per
declaring slot, in slot order: `{u32 count, u32 total length, 8 bytes never
read}` then per point `{i16 x, y, z, i16 length from the previous point}`
(builder `0x410F00` → `0x411300`). No current point is stored; the walker finds
its leg by subtracting leg lengths from +40 (`0x43AA3B`). 13 shipped saves carry
one, and the port reads and writes it.

Restoring the walk table is not optional, because a walker is recorded in **two**
tables and the cast record hands over the `walk` pose. An actor plays its pose
whether or not anything is moving it, so restoring the cast without the walks
brings a character back marching on the spot. Anyone whose walk cannot be resumed
is stood up instead, as on the play page (#181).

## The globals never changed

The variable list and its string pool are **the same format in both engines**, to
the byte: a 28-byte header describing the pool, then 32-byte nodes whose DFValue
belongs to the *next* node's name. So both format modules share one codec
([`save-vars.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/save-vars.ts)).

| Offset | Field |
|-------:|-------|
| 0 / 2 | variable count, capacity |
| 8 / 12 / 16 | the pool's watermark, size, and heap handle |
| 20 / 22 | **the head variable's DFValue** |
| 28 + 32k | node *k*: `{u32 link, u32 link, pstr name[12] @8, u32 vtable @20, u16 type @24, i32 value @26}` |

Two points carry over from the `.ti` format:

- **the vtable is a pointer, not a magic number.** These files read `0x87C4989F`
  where the shipped `.ti` saves read `0x00431E0F`. Read it out of the file by
  agreement across its own nodes; never hardcode it.
- **the head variable is real storage.** Its DFValue sits one stride back, in the
  blob header at +20/+22. The `.ti` writer declines to touch its head and can
  afford to — TAOOT's head is `clock`. Dust's is **`day`**, the variable the whole
  five-day story is counted in, so this writer does write it.

### What the shipped saves say

They are one playthrough, ordered by the frame counter and written up as
[the golden thread](../../dust/thread.md):

| | `D1E_001` | `D1E_005` | … | `ENDING` |
|---|---|---|---|---|
| frame | 4885 | 16252 | | 224670 |
| `day` | 1 | 1 | | **5** |
| `handitem` | cards | **cigar** | | **chest** |
| `phase` | 2 | 5 | | 0 |
| puppet open | jones.pup | fear.pup | | — |

Every table in the file agrees with every other, so the collection checks the
whole record layout at once: the prop grid agrees with
the globals (in `D1E_005` the Cigar is owned by `stranger` and visible, and the
Ring has already passed to `ruby`), and the cast and walk tables agree with each
other to the pixel. The frame counter is what orders them.

## What is not resolved

Gaps:

- the cast record's handles at +2..+17, its draw cache at +52..+72 and its serial
  at +48 are read but not modelled: the port has no such state, and a write keeps
  the base's;
- the "same set" flag the port once looked for does not exist: DF.EXE compares
  the actor's set (+100) with the standpoint's (c1+482) every time;
- **what marks a walk record spent.** The `active` word is honoured, and it is
  not enough: of the 140 records it passes across the 56 shipped saves, **58
  have nothing left to walk** — `progress >= dist`, or a `dist` that is
  negative. Five of `D2A_008`'s read −1941692191, and the same 1941xxxxxx
  magnitude appears as `progress` on three others, which is one junk word landing
  in two fields. Resumed as live, such a record completes on the first service
  pass at a destination computed from that junk: loading `D2A_008` puts the
  Mayor's wife at (−32483, −31698), off the map, and her idle then walks her back
  from there for the rest of the day, never inside `hotdist ()` again.

  Filtering them out does not work either: it strands three playthrough rungs,
  because for those saves the junk walk completing is the only thing that fires
  `endwalk` and re-arms the town's idles. So the port resumes them, bug and all,
  and the reading of this table is not finished;
- `c13+4`, and the individual roles of `c1` 352–444 and 464–480 (their *purpose*
  is clear — interpolation copies of the standpoint — the field-by-field split is
  not).

Next: what the session does with all this — **[Saving & loading at runtime](../runtime/saves.md)**.
