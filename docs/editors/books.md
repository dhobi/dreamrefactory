# The sprite book viewer

`/editors/books.html` — [`site/editors/sbk-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/editors/sbk-editor.ts)

The only editor page that cannot write. It opens a
[`.SBK`](../engine/formats/sbk.md) — Skull Cracker's sprite books — and shows the
three things one holds: its cels, its level's named plan, and the parallax
backdrop those cels are placed into.

## Why there is no export

The other editors round-trip: read with the game's own reader, write with the
format's own patches, and a test proves an untouched load exports the file it
read. **Nothing writes a sprite book**, because nothing reads one but this page.
Patches for writing one would go in `engine/src/df/sbk.ts`.

## What it shows

**The level.** Every placement drawn far-to-near at its stored position, and only
the ones the view can see — which is what makes an 11200×3265 level pannable
without ever compositing one. Drag to pan; the zoom is integral (1:1 to 1:8) and
never smoothed.

**The layers.** One checkbox per parallax factor, far to near, with how many
placements each holds and a `*` on the plane most of the level's art is on. Turn
them off one at a time and the level comes apart into its planes. Factors are
shown to five decimals, not three, because a level can store two layers that
differ only in the low bits of the 16.16 field and rounding merges them.

**The ground.** Each region's floor as a polyline — the walkable terrain, which is
the one thing in a sprite book that describes how the game played rather than how
it looked. Toggle it off to see the art alone.

**Rooms and doors.** A level is a set of rooms, and the viewer draws each one's
rect with its name and param, dashed where the room has no floor. The doors
between them — the `exitroom` records — get their own box, their stored point,
and an arrow for the side that point is on, which is where the player comes out.
STREETS zoomed right out shows it clearly: the street on top, the basement below
and to the right, and one door each way. The
[format page](../engine/formats/sbk.md#rooms-and-the-doors-between-them) has the
binding and the nine doors in the shipped books.

**The plan.** Every entity, grouped by kind, commonest first, coloured the way the
overlay draws it, with regions in italic — the file distinguishes an object the
engine spawns from an area a designer named, and so does this. Click one to put
the camera on it; hover for its parameter, its flags and where its shape lives.

A record whose second point is *not* its rect's midpoint shows that point too —
for a `switch` or a `door` that is a destination; see the
[format page](../engine/formats/sbk.md#the-entity-table-the-level-design-and-it-is-named).

**The cels.** Every cel in the directory as a thumbnail, with its ID, dimensions,
anchor, container and how many times this level places it.

## The one number on the page that is not in the file

A placement stores a position and a parallax **rate**. What it does not store is
where the camera starts, because that belonged to `SC.EXE`.

- **Parallax scroll off** — every layer sits where the file puts it. Exactly what
  the data says; pan, and the layers slide together as one flat picture.
- **Parallax scroll on** (the default) — a layer moves at `camera / factor`, which
  is what a side-scroller does and what makes these read as places.

The two views are *identical at the camera's origin*, so the approximation costs
nothing until you move. The origin is taken from the file: it is the level's own
`initplayer` rect, the one entity that says where the game begins. That is what
**↩ the player's start** returns to.

The page says "approximate" next to the checkbox, because the camera is not in
the data.

## Two things to know

**Only Skull Cracker has sprite books.** The source row at the top is shared with
the other editors, so a source remembered from another editor (Dust or Titanic)
has no books. This page falls through to whichever source has books and says
which it chose.

**`PLAYER.SBK` has no level.** 1229 cels and two empty tables — the player is a
character, not a place. The page says so rather than showing an empty canvas
without explanation.

## What this is not

It is not the game. The books hold placement, not behaviour: where every zombie
starts, and nothing about what a zombie does. See
[Skull Cracker](../skullcracker/README.md) for how the behaviour is recovered.
