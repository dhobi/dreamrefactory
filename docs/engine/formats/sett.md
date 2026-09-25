# SETT — rooms, nodes and spheres

*Prerequisite: [DreamFactory 5's containers](dreamfactory-5.md), and
[SET](set.md) for what it replaced.*

A **SETT** is a DreamFactory 5 room, RedJack's `.sett`. It is the one v5 format
that is new rather than moved, because the room itself changed in kind:

- **A v4 [SET](set.md)** is scenes you stand in, each with a ring of fixed views
  you turn between, and roads between the scenes.
- **A SETT** is **nodes** you stand at. From each you look round a **sphere**,
  a panorama of the whole view in every direction, with any heading, pitch and
  field of view the scripts ask for. **Roads** are films that walk the camera
  from one node to the next, and **quads** are the things you can click.

Some rooms still have v4's shape: a **scene** is a few fixed views and two films
that turn between them (the shark's rowboat, the darts). Both kinds can be in
one room.

Reference implementation:
[`engine/src/df/sett.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/sett.ts),
from RedJack.exe. All offsets are from a container's first byte, the 24-byte
prefix included. Positions are i32s in the camera's own units, the world times
10⁵; angles are doubles in radians, often beside the same angle as the
scripts' integer ([angles](../runtime/rooms-v5.md#the-angles)).

## The index (MAZE, MAPR)

Container 0 is the **MAZE**, container 1 the room's main script and container 2
its **MAPR**. MAZE also points to both, so the reader follows its pointers:

| MAZE | |
|---|---|
| 0x64 | the main script's container |
| 0x68 | MAPR's container |
| 0x74 | the room's name (pstr) |
| 0x10a | **how far a sprite can be and still be drawn** (i32; 1,350,000 in most rooms) |

MAPR is the automap, and the one table that lists everything in the room:
64-byte records from 0x2c, as many as the three counts at 0x10, 0x14 and 0x18
add up to, each typed by the u16 at +2.

| Type | Record |
|---|---|
| 2, a node | +4 x, +8 y, +12 z; +16 its NODE, +20 its SPHR, +28 its script, +32 its name |
| 1, a scene | +4 x, +8 y, +12 z; +16 its SCEN, +20 and +24 its two turning films, +28 its script, +32 its name |
| 0, a road | +8 and +12 the ids of the two places it joins; +16 its ROAD, +20 and +24 its two films (one each way), +32 its name |

A **NODE** carries its id at 0x30 (what a road names it by) and its name again
at 0x58. Nothing in it lists its exits: they are the films whose far end is
somewhere else.

## The sphere (SPHR)

What you see at a node is a **quadtree of 256×256 equirectangular tiles**: the
patch count at 0x24, and 56-byte patches from 0x28.

| Patch | |
|---|---|
| +8, +16 | the centre's longitude and latitude (doubles, radians) |
| +24 | its half-extent (double, radians) |
| +32 | its picture (a STEP) |
| +36 | its depth map (a STEP) |
| +40 | four children (patch indices, -1 for none): top-left, top-right, bottom-left, bottom-right |

Latitude runs from 0 at the zenith to π at the nadir. The root's half-extent is
π, so its tile covers 2π of latitude and only its top half is picture. Finer
patches cover the parts of the view that have detail; the finest in the rip is
22.5° across. Each tile has its own palette, and a depth map behind it that
says how far away the scenery is under each pixel.

**The camera looks down longitude π − heading.** That is not read off the
renderer, which is hand-written assembly. It is what makes a sphere agree with
the films that leave it: every road film's first frame is a picture taken from
its node, and projecting the node's sphere at the frame's own heading and field
of view reproduces all six of `shed.sett`'s to within two grey levels, with
nothing left to offset.

## The films (CMOV)

A road's or a scene's film is not a `.move`: it is a camera path, with a picture
at each step. The destination NODE is at 0x14 (or, for a road into a scene, its
SCEN at 0x20), the frame count at 0x1c, and 112-byte frames from 0x2c.
RedJack.exe's `0x435490` copies each frame into the camera as it plays:

| Frame | |
|---|---|
| +0 | position, 3 doubles |
| +24 | heading, pitch, roll, field of view (doubles, radians) |
| +56 | the position again, as i32s |
| +68 | heading, pitch, roll and field of view as the scripts' angles |
| +88 | the picture (a STEP, with its [depth map](dreamfactory-5.md#the-film-s-depth-map)) |
| +100 | a scene film's view mark |

The last frame may be cut short of its trailing words.

## The scene (SCEN)

A place with no sphere: a few fixed views, turned between on film. The view
count is at 0x48, and 56-byte views follow from 0x4c:

| View | |
|---|---|
| +4 | the road film that leaves ahead (0 for none: `roadahead`) |
| +8 | its heading (double, radians); +16 the same as a script angle |
| +32 | its id, what a road names it by |
| +40 | its name |

The scene's two films each turn the camera once round on the spot, the first
clockwise (`currentscene ("right")`) and the second the other way. Each frame's
view mark at +100 is the index of the view it shows, or -1 between views. A turn
stops at the first frame whose mark is a view (`0x434b00`), and standing at a
view shows the first frame of the second film marked with it (`0x434550`).

## The stars (MARK)

The named points props and actors are put on (`propstar`): the count at 0x18
and 66-byte records from 0x20. Each holds one star and room for a second: a
point (three i32s) at +6 named at +0x12, and, when the i32 at +0x22 is not 0, a
second point at +0x26 named at +0x32. A name is looked up in that order
(`0x444550`).

## The quads (BLI3)

The things a click can find: the count at 0x18 and 80-byte records from 0x20.
Each has its script at +8 and its name at +0x1c, and from +0x2c its shape: a
rectangle (w and h the i32s at +0x48 and +0x4c) in its own plane, set down at
the i32 point at +0x2c, turned by the double at +0x38 and pitched by the one at
+0x40. `0x497160` projects it
through the camera, and a click inside the outline is the quad's
(`quadAt` in `engine/src/runtime/maze.ts`, topmost first).

## Not read

BLIS, NLIS, RLIS, SLIS and DRIV are in the rooms and are not read by the port.
Nothing it plays has needed them so far.

Back to [File formats](README.md).
