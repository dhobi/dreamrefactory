# DreamFactory 5's containers

*Prerequisite: [The DFile container format](README.md) and
[the image codec](image-codec.md).*

DreamFactory 5 is the engine [RedJack](../../redjack/) (1998) runs on. Its files
are the same cabinet of numbered drawers as v4's, with the same 1024-byte header
and the same position table, read by the same `container.ts`. Two things changed
inside the drawers, and between them they explain almost every offset on this
page:

1. **Every container now says what it is.** It opens with 24 bytes of its own.
2. **The palette moved into the picture.** A v4 room, film, shop or puppet keeps
   one palette in its header for everything it draws. A v5 picture carries its
   own, so the headers lost 2048 bytes (0x800) and everything after the old
   palette sits that much earlier.

The one format that is new rather than moved, the room, has
[its own page](sett.md).

## The 24-byte prefix

| Offset | Bytes | |
|---|---|---|
| 0x00 | `00 00 05 00` | the version, now a u16 at +2 |
| 0x04 | four letters | the container's kind, written **backwards** (`PETS` is a STEP) |
| 0x08 | 16 zeroes | |

A v4 container 0 has the version as an i32 at +2. Read that way, a v5 one gives
nonsense in the high half, because the kind follows straight on. So `versionOf`
(`engine/src/df/version.ts`) answers 5 only when the high half is not zero and
the low u16 is 5. Script containers carry no prefix at all: their bytecode is
v4's and starts at byte 0.

Offsets on v5 pages are **from the container's first byte, prefix included**,
because that is how RedJack.exe addresses them. Where a v5 record is a v4 one
behind the prefix, its offsets are v4's plus 24 (0x18).

### The kinds, by file

Each backwards code is shown the right way round here. Measured on every file in
the rip:

| File | Its containers |
|---|---|
| `.boot` | BOOT (container 0), VARS, scripts |
| `.sett` | MAZE, MAPR, NODE, SPHR, SCEN, ROAD, CMOV, MARK, BLI3, BLIS, NLIS, RLIS, SLIS, DRIV, STEP, scripts ([SETT](sett.md)) |
| `.move` | MHED, MFRM, STEP, SOUN, MSND, MTHM, MTRG |
| `.shop` | SHOP, PROP, VIEW, SPRI, scripts |
| `.cast` | CAST, ACTO, POSE, SPRI, SOUN, scripts |
| `.pupp` | PHED, PLYR, TALK, PAGE, BASE, FRMR, SPRI, SOUN, scripts |
| `.stag` | STAG, FLAT, STEP, scripts |
| `.trak` | SHED, SSND, STHM, SOUN |

**A shop and a cast are one format.** CAST, ACTO and POSE are SHOP, PROP and
VIEW under other names, each at its twin's offsets, and SPRI is the sprite in
both.

## The picture (STEP)

A room's tile, a film's frame and a stage's flat are all STEP containers
(`engine/src/df/image-v5.ts`, from RedJack.exe's loader `0x4927b0` and its
decoder `0x492850`):

| Offset | Type | |
|---|---|---|
| 0x18 | u32 | where the pixel stream ends, and a depth map starts |
| 0x20 | i16, i16 | height, width |
| 0x28 | 256 × {blue, green, red, 0} | **this picture's palette** |
| 0x428 | | the pixel stream |

The stream is [v4's codec](image-codec.md) with nothing a picture can see
changed: the same row modes, the same run modes, the same delta table. It has
its own decoder anyway, because of one corner case in a delta chain: a
bit-packed run in v5 rewinds its unread bits by whole bytes at its end
(`0x492c2f`), and v4's decoder does not, which broke the first frame of the
fight's help screen in row 0.

**Why the palette moved** is visible in the films: a frame with its own palette
can fade and shift colour from one frame to the next with no palette change
anywhere else. It also means a v5 room has no one colour table to index
through, so everything the port draws for RedJack is true-colour.

### The film's depth map

A film frame's STEP usually carries a second table after its pixels: how far
away the scenery is under each pixel, which hides a character walking through
the film just as a room's [Z layer](image-codec.md#the-z-layer-a-hidden-depth-map)
does. It starts where the u32 at 0x18 says, which is what RedJack.exe hands its
depth code (`0x44bca0`), and the u16 at 0x26 says how many distances it
lists:

| | |
|---|---|
| count × i32 | the distances, near to far; the last is 0x7fffffff, meaning nothing there |
| height × u16 | each row's offset, from the end of the distances |
| per row | a u8 run count, then (length, level) byte pairs across the row |

A pixel's distance is its level's distance. This is unlike v4's Z layer, whose
levels are steps of one room-wide size: a v5 frame lists its own distances.
Nearly every film frame in the rip has one, and they agree with the depth maps
of the room's spheres to about 1.5% on average (`engine/tests/df5-room.ts`
checks it stays under 5%). `depthV5` reads it; a frame whose table has no
distances is left unread and hides nothing.

## The sprite (SPRI)

A prop's, an actor's or a puppet's picture (`decodeShpFrame` in
`engine/src/df/shp.ts`):

| Offset | Type | |
|---|---|---|
| 0x1a | i16 | height |
| 0x1c | i16 | width |
| 0x20, 0x22 | i16, i16 | the hot spot (the raw position) |
| 0x24 | 256 × {blue, green, red, 0} | its palette |
| 0x424 | | v4's transparent run stream |

A v4 sprite has no palette and is drawn through the colours of whatever it is
over, which is why a prop tints to its room. A v5 sprite looks the same in every
room.

## The shop, the cast and the puppet

- **SHOP, CAST** (container 0): no palette, so the main script is at 0x24, the
  name at 0x28, the group count at 0x38 and the 16-byte group table from 0x3c.
- **PROP, ACTO** (a group or member): v4's layout at v4's offsets. One new field
  is used, the i16 at 0x14, which lowers the sprite before its depth is taken
  (see [how big a sprite is](../runtime/rooms-v5.md#how-big-a-sprite-is)).
- **VIEW, POSE** (a state or pose): v4's with 448 bytes more in front, so the
  play order is at 0x1ee, its step count at 0x230, the frame count at 0x232,
  and the 44-byte frame records from 0x236.
- **PHED** (a puppet's header): v4's without the palette at 58, so its idle
  timers are at 0x3a/0x4a, the name at 0x5a, the line count at 0x6e and the
  312-byte lines from 0x70. TALK, PAGE and BASE are v4's to the byte; FRMR is
  v4's 82-byte records behind a 22-byte header.

## The stage (STAG, FLAT)

No stage palette: each flat's picture brings its own. The fields past the old
palette close up, so the stage's name is at 0x40, its flat count at 0x50 and the
flats from 0x54. A flat record is 50 bytes, v4's 46 with four more after its
first word. A FLAT container has its region count straight after the prefix, and
each region is v4's with eight bytes more in front.

## The film (`.move`)

`engine/src/df/mov-v5.ts` reads a film into the same `MovFile` a v4 `.mov`
becomes, so the player above it does not care which engine wrote it
([MOV](mov.md)). The offsets come from RedJack.exe's player (`move.c`,
`0x44dbd0`):

- **MHED**, the segment header, is v4's up to 0x6c, and then the palette is
  gone. What v4 kept at 0x870 is at 0x70: the frame count at 0x78 and the frame
  table at 0x7c. A frame record is 46 bytes, v4's 42 with four more ahead of the
  dimensions.
- **MFRM**, a frame's logic, is v4's record behind the prefix, and each click
  region is v4's 64 bytes with four more in front (68).
- **MSND** (one-shots) is v4's with six bytes more per record (48). **MTHM**
  (the music loop) is the same table a sound bank keeps. **MTRG** (the cue
  table) is in every film and empty in all of RedJack's.

Containers are often longer than their records, since a region table can end
in bytes nothing reads, so a container's length is never taken as a count.

## Sound (SOUN, SHED, STHM)

A sound chunk is v4's header at v4's offsets behind the prefix: the codec at
0x1a, rate 0x1c, size 0x24, data 0x2c. RedJack.exe's streamer (`wave.c`,
`0x46ff40`) decodes three ways from it:

- codec 1: v4's V40, byte for byte;
- codec 2 with the word at 0x18 clear: v4's V41;
- codec 2 with it set: **IMA ADPCM**, which v4 never had (`0x470729`). It comes
  in blocks listed from 0x2c (a u32 count at 0x28, then count + 1 offsets),
  each opening with a 3-byte header (an i16 predictor and a u8 step index), then
  nibbles, low first.

A sound bank's header (SHED) and its one-shot table (SSND) are v4's. Only the
loop table is new. A bank's STHM and a film's MTHM both keep the loop count at
0x1c and the play order from 0x1e, with a longer order table, so the record
count is at 0x222. Their records differ: a bank's are v4's own 26 bytes from
0x226, a film's 34 bytes from 0x228 (`readLoopTableV5` in
`engine/src/df/banks.ts`).

## Scripts

The bytecode is v4's, and the command ids are too: nearly every id means what it
meant in v4, which is why a v5 script decodes at all. RedJack.exe's command
table has 488 ids. Against v4's:

- **The same id, a new name.** `actordeg` became `actorhead`, `currentview`
  became `setview`, and so on. The port keeps the v4 names, which are what it
  implements. Two of these are really different commands: 16026 is `sysparam`
  in v5, and 24020 is `photodissolve`, not `turnhalfleft`. The interpreter
  answers both by asking which engine the game is.
- **New ids** fill gaps in v4's table (`DF5_OPCODES` in
  `engine/src/df/opcodes.ts`), so they cannot change how a v1 or v4 script
  decodes. What the port does with them is in
  [the builtins](../../reference/builtins.md#dreamfactory-5-—-maze-ts-and-df5-ts).
- **Commented-out lines** are new: segment command 7 carries a line's source
  text, which the decoder drops. RedJack's `boot ()` comments out an
  `if isdebugging ()` / `endif` pair and leaves the lines between them live.

Back to [File formats](README.md).
