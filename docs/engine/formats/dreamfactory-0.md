# DreamFactory 0's containers

*Prerequisite: [The DFile container format](README.md) and
[the image codec](image-codec.md).*

*Lunicus* (1994) is the oldest Cyberflix game in this repository, a year before
*Dust*. Its files are the same box of numbered drawers: the same 1024-byte header
and the same position table, read unchanged by `container.ts`. What it does not
have is the version tag every later container 0 opens with, and that is why this
port calls it **DreamFactory 0**. The name is ours. The file envelope itself says
1.0, the same as Dust's, and LUNICUS.EXE refuses any file where it says anything
else (0x419807, *"bad star file version"*; the engine calls its files "stars").

Because the tag is missing, **v0 cannot be detected**. The bytes where
`detectVersion` looks are just the first fields of whatever format the file is,
and they read as noise, sometimes even as 1, 4 or 5. A caller knows it has a v0
file because it is loading Lunicus.

There are no rooms, puppets or casts in the later sense, and no script
containers have turned up. The game's logic is in LUNICUS.EXE, which names its
films in its own code; `lunicus/tools/ludis.mts` disassembles it, and
`lunicus/src/game/` is the port of what day one needs. The files hold
pictures, sounds, conversations and mazes.

Readers: [`image-v0.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/image-v0.ts),
[`maze-v0.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/maze-v0.ts),
[`talk-v0.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/talk-v0.ts),
[`mov-v0.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/mov-v0.ts),
and `decodeAudioV0` in
[`audio.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/audio.ts).

## Films

A film is [Dust's film](mov.md) with less in front of it. Container 0 starts
directly with the frame count, where v1 has 0x18 bytes first, including the
version tag. After that, the header fields come in the same order: sound-bank
count at 0x02, the film's rect on the 512×384 screen at 0x06 (top, left,
bottom, right; the player draws the film there, 0x40e26a), and the frame-rate
floor at 0x0e. Every film in the rip has its top-left at 0,0: a 384-wide film
covers the maze view and leaves the panel beside and below it standing. The
palette follows at 0x22, 256 entries of {i16 index, u16 red, green, blue}. The
80-byte frame records start at 0x8a2, 0x20 bytes before Dust's.

Three things differ inside:

- **The palette is the Macintosh way round.** Entry 0 is white and entry 255 is
  black, so the PC games' conversion, which forces the opposite, must not be
  used.
- **The hotspot offset at +0x24 is 32 bits.** The long briefing films' headers
  are larger than 64 KB, so a 16-bit offset would wrap.
- **There is a hotspot type −1**, in the 14-byte shape. LUNICUS.EXE's player
  negates a negative type and tracks the press before acting on it (0x40eb01),
  so −1 is an exit shown as a button. The elevator films end on two of them,
  the car's floor buttons, and the level is told which was pressed. The
  frame flags also use bit 4, "step to the next frame", which Dust never set;
  here it is set on exactly the frames with action 6, and such a frame holds
  and goes on (the intro's pause before its title) rather than waiting.

The frames are the [v4 frame codec](image-codec.md), and every frame sound is a
v0 sound. Films call each other by the game's own names (`flip.move`), while
the files are 8.3 names (`flip.mov`).

## Pictures

Every picture that is not a film or a maze view is one container: the vehicles,
the hand, the control panel, a talking head's frames, and the backdrop they are
drawn over.

| Offset | Type | |
|---|---|---|
| 0x00 | i16 ×2 | height, width |
| 0x04 | i16 ×2 | anchor y, anchor x |
| 0x08 | | rows, each an i16 byte length and its runs |

The **anchor** is the point of the picture that lands on the position it is
drawn at. The draw routine (0x404ab8) puts the top-left corner at y − anchor y,
x − anchor x, and a mirrored picture takes its anchor from the right. A
conversation backdrop is 512×264 and anchored at its centre.

Each run is a flag byte (read at 0x404c88), with the kind in the low two bits
and the count in the other six:

| Kind | |
|---|---|
| `x1` | skip `count` pixels (transparent) |
| `11` | `count` literal pixels follow |
| `10` | one byte follows, repeated `count` times |
| `00` | an offset byte follows: copy `count` bytes from that far back **in the compressed stream** |

The first three are [SHP](shp.md)'s transparent codec exactly. The fourth is
where the two part. Dust's kind `00` copies from the row above and reads no
offset. A picture that never uses kind `00` decodes the same through either,
which is how Dust's reader first seemed to fit the vehicle sprites.

The sixteen-frame **figure** files in `shared/`, one per character, use a second
codec. The header and row lengths are the same, but there is one kind bit and a
seven-bit count: an odd flag is `flag >> 1` literal pixels, and an even one skips
that many. This codec was fitted to the data and not read out of the engine. It
is not the 0x404c88 loop, and where it lives has not been found yet. The
figures are the crew as the maze view shows them: sixteen headings of a
character, frame 0 from behind and 8 from the front, drawn scaled at
`0x2a0 / depth` of their size (0x416514).

## Sounds

A sound has no chunk header at all. It is a u16 count of 370-sample blocks
followed by Dust's [8-bit v40 stream](audio.md), which makes it the Dust codec
before the 48-byte header was put in front of it. Output goes through
LUNIRES.DLL, which opens the device at 22050 Hz, mono, 8-bit (0x1677), so a
block is about 16.8 ms. The sound banks (`citysoun.`, `moonsoun.`) have a table
in container 0 and one sound in each container after it.

## Conversations

A talk file is one character on one day: `raife.1`, `sasha.3` and so on, plus
`guard.1`–`guard.7` and `queen.1`.

| Container | |
|---|---|
| 0 | the character's side: the palette at 0x22 (Macintosh order), the idle racks' shortest and longest waits at 0x822 and 0x832, and from 0x844 the lines, 0x138 bytes each (keyframes, voice, puppet track, subtitle, name) |
| 1 | the player's side: the questions as the menu shows them, 0x128 bytes each (voice, text, name) |
| 2 | the menus, 0x174 bytes each: five entries of {hide once asked, where to go next, question, answer} |
| 3 | the puppet's eight layers: for each, a count and the containers of its pictures |
| 4 | the backdrop, a picture as above: layer 0's only picture |
| 5 … | the talking head's pictures, the other layers' |
| then | pairs of a voice line and the puppet track that animates it |

The talk itself (0x415000) is in `lunicus/src/game/talk.ts`: which file a
character talks from on a day, how a menu is drawn and chosen from, and how a
line's keyframe follows the clock.

A **puppet track** is a list of 76-byte keyframes:

| Offset | Type | |
|---|---|---|
| 0x00 | u16 | tick |
| 0x02 | u16 | 0 wherever looked |
| 0x04 | i16 ×4 | the rectangle this keyframe repaints: top, left, bottom, right |
| 0x0c | 8 × `{u16 frame, i16 y, i16 x, u16}` | the layers |

The first keyframe repaints the whole screen, and the later ones repaint just the
mouth. Layer 0 is the backdrop, placed at its own anchor. A slot a keyframe does
not use holds coordinates far off screen, which clipping throws away. There is
one keyframe per two blocks of the voice line. The tick field usually counts up
by two, but some tracks carry stale values, so a player should go by a
keyframe's position in the list. A rack with nothing in a slot stores three
bytes: a zero u16 and one leftover byte. A few of the queen's lines have a voice
but no puppet.

A layer's frame is an index into that layer's list in container 3. Not read
yet: the last u16 of each layer.

## Mazes

The city, the bases, the engine rooms and the hive are grids you walk one cell
at a time and turn on by quarter turns, and every step and turn is a short
pre-rendered film. The loader (0x402ca1) opens the file as `'MAZE'`.

A **pose** is three i16s: x, y and a facing, 0 toward y − 1, 1 toward y + 1,
2 toward x + 1 and 3 toward x − 1 (the step table, 0x428128). A step plays a
film's frames 1 to 7 and a turn's 1 to 6, three ticks of 1/60 s apart
(0x40d091).

**Container 1 is the grid.** It holds i16 width and height, then 32×32 cells of
four bytes each, where the cell at (x, y) is the dword at `4 + x*128 + y*4`. A
cell of `-1` is not there. Any other cell holds one byte per facing, with facing
0 in its top byte. The game reads these bytes (0x403602) and also writes them
(0x40367a), so they change during play. On the base's floors a byte is what
the facing looks at: 0 open floor, 2 an elevator, 3 a screen (the info and the
galley on the lower floor), 5 a desk, 6 a bed, 9 the control panel or, on the
upper floor, the scope, the greenhouse or the power status by facing, 0xfe the
transporter end, and so on (0x401299 for the lower floor, 0x40103e the upper).

The combat levels read the same bytes their own way (0x4017f2):

| Level | Bytes |
|---|---|
| the city | 1 to 14 a building's door, 15 and up a door with no entrance |
| a building, an engine room | 2 a full cabinet, 9 an empty one, 3 the elevator; a building's 4, 5, 6 and 8 are signs |
| the hive, the final chamber | 2 a full cabinet, 10 an empty one, 3 the elevator, 4 and 6 a film, 9 the switch that fills the cabinets, 8 the queen |

The writer does not check for a cell: a byte written where the grid holds `-1`
lands in the `-1`, and four of them make an empty cell. The final chamber
opens the four cells round the queen's this way as it loads (0x4069cb).

**Container 0 is the transitions**, 28-byte records:

| Offset | Type | |
|---|---|---|
| 0x00 | pose | from |
| 0x06 | pose | to |
| 0x0c | pose, pose | the transition whose film this one plays |
| 0x18 | i32 | that film's first frame, a container index |

Only a record whose second pair matches its own from and to owns a film. Every
other record borrows the film of a transition that looks the same, such as a
corner turn reused in another corner. Films carry no length: each runs from its
first frame to the next film's, and the owned films tile the file's containers
from 2 to the end. The frames are 384×264 in the [v4 frame codec](image-codec.md),
and each film is a delta chain decoded from its first frame.

## Saved games

A saved game is a `.LUN` file ("Lunicus (.LUN)" in the dialog, 0x4187b3; on
the Mac, type `LSAV` and creator `STAR`). It is 26 bytes with no container and
no header. LUNICUS.EXE writes a record of little-endian words straight to the
file (0x417944) and reads the same 26 bytes back into `0x42c02c` (0x41771d).
[`savegame-v0.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/savegame-v0.ts)
reads and writes it.

| Offset | Type | Holds |
|---|---|---|
| 0x00 | i16 | the difficulty, 1 Beginner … 4 Expert (`[0x42c15c]`) |
| 0x02 | i16 | the level, 1 … 22 (`[0x42d1bc]`) |
| 0x04 | i16 | where the player came in (`[0x42d1c0]`): a building's floor, the base's door |
| 0x06 | i16 | which of the base's elevators (`[0x42d1c4]`) |
| 0x08 | i16 | the day's progress (`[0x42d1c8]`) |
| 0x0a | i32 | the score (`[0x42b3c0]`), off the word grid |
| 0x0e | i16 | ENEMIES |
| 0x10 | i16 | ENERGY |
| 0x12 | i16 | SHIELDS |
| 0x14 | i16 | bullets |
| 0x16 | i16 | grenades |
| 0x18 | i16 | rockets |

A save holds neither the suit nor the gun, nor the crew's places, nor which
cabinets are empty. File ▸ Open (0x4184cc) sets the difficulty, empties the
HUD and adds the file's numbers back, selects navigation, and goes to the
file's level, which opens as any level does.
