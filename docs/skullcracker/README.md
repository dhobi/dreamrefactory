# Skull Cracker

**Two words, and the disc had to be asked twice.** Its release notes and its
executable both compress the title — "SKULLCRACKER" in the README's heading,
`SkullCracker` in every string the binary carries, and one string that even offers
*aka "Skullcracker"*. The game's own TITLE CARD disagrees, and it is the last frame
of `IMAIN.MOV`'s fourth segment: **SKULL / CRACKER**, on two lines, over the skull.
So the title is two words here and the directory stays one, the way the filesystem
had it.

*Skull Cracker* (1996) is CyberFlix's own, and the fourth game in this repository —
the first whose files this port can read completely and whose game it cannot play
at all. Both halves of that are worth stating plainly, because the interesting
result here is not a game running.

Both releases have now been read. The Macintosh disc is what the port was built
against; the Windows one came later and is the reason several findings below are
*confirmed* rather than argued — most of all the palette one, which had rested on
a single frame.

## What was found

This project's own documentation used to say that Skull Cracker was **not** a
DreamFactory title: no published source attributes it to the engine, and the
right thing to do with an unsourced claim is not make it. The discs settle it
without a source:

| | |
|---|---|
| data files | 111, and every one a DreamFactory container |
| films | 66 `MOV` files, read by `engine/src/df/mov.ts` unchanged |
| engine version | 4 — the tag in container 0 of every one of them |
| screen | 512×384, the same as Titanic's and Dust's |
| audio | `SONG` banks and the same two chunk codecs |

The one thing that is new is which way round the bytes are. Every disc this
project had read was little-endian; Skull Cracker's integers are **big-endian**.
Not the file byte-swapped — the layout is identical field for field, Pascal
strings read forwards, and only the integers are reversed. See
**[byte order](../engine/formats/README.md)** and `engine/src/df/byte-order.ts`,
which works out which order a file is from the file's own size field.

**It is a fact about the title, not about the platform**, tempting as the
shorthand is: Skull Cracker's disc is a Macintosh one, and Titanic's Dutch release
is a hybrid disc whose `INSTALL_MAC/` holds a PowerPC executable beside a
`bootfile` and a `Local/` that are *little*-endian. Titanic's Mac build ran on
converted data. So the order is asked, never assumed, and nothing above the
container reader is ever told what platform a disc came off.

Two consequences of that reached further than Skull Cracker:

- **Three fields were 32 bits wide and were being read as 16.** A bank's loop
  count, a loop record's container location and a one-shot table's count are
  `long`s whose low half this port took, which is the same number on a
  little-endian file and the empty half on a big-endian one. Read as an i16, this
  game's menu had no music and its buttons no click. Fixed in
  `engine/src/df/banks.ts`; every bank and film in the other three rips reads
  identically before and after (1973 films, 646 banks, no differences).
- **The two reserved palette entries belong to the build being rendered, not to
  the format.** Palettised Windows reserves black at 0 and white at 255, so the
  port forces those for the games it renders as PC releases. The palette as
  *stored* says the opposite — white at 0, black at 255 — in every disc here,
  because DreamFactory was authored on a Mac and that is the Macintosh reserved
  pair. Applying the PC correction to Skull Cracker repaints 27.34% of every frame
  in it. (The evidence for entry 0 is one frame: `Belfry.mov` frame 100 is 100%
  index 0 and sits between two frames of night sky — a lightning flash, so white.)

  `paletteToRGBA` switches on the byte ORDER, which is a proxy for "whose build is
  this" rather than the thing itself. A Macintosh Titanic would be a disc whose
  data wants the PC correction and whose *display* would not, and that is a
  distinction the proxy cannot draw; nothing here renders one.

  **The Windows release confirms the model, and does it better than by agreeing.**
  The conversion swapped the two indices in the *pixel data*, so that each landed
  on whichever end the target platform reserves:

  | disc | index 0 | index 255 |
  |---|---|---|
  | Macintosh | 0.14% | 27.34% |
  | Windows | 27.52% | 0.14% |

  A mirror, over every film on each disc. `Belfry.mov`'s flat frame is 100% index 0
  on one and 100% index 255 on the other, and under these rules **both render
  white** — the lightning flash, called from one frame on one disc and confirmed by
  a disc that was not consulted to make the call. And the menu's first frame
  decodes **pixel-for-pixel identically** from the two files: 0 differences over
  196,608 pixels, from files of 1.74 MB and 1.08 MB whose every integer runs the
  other way. That is the byte-order axis verified end to end.

## What runs, and what does not

Skull Cracker is a side-scrolling beat-'em-up. Its disc carries **no BOOTFILE, no
`.SET`, no `.STG` and no script container of any kind** — there is nothing for the
interpreter to interpret, because the game's logic is in a PowerPC executable
(`Install Folder/Skull`, a PEF binary). Its levels are `.sbk` sprite books — which
this document once called a format of the game's own that nothing here reads, and
was wrong twice; see below.

What is completely DreamFactory is its **film layer**, and that includes the
menu. `menu.mov` is an interactive movie — 175 frames, a looping bed, and seven
click regions per frame — so `skullcracker/` plays the game's own opening and the
menu comes up, animates, plays its music and answers a click:

```bash
npm run dev:skullcracker        # http://localhost:5178/
npm run test:browser:skullcracker
```

### The sprite books are the engine's format, arranged a new way

A `.sbk` is an ordinary DreamFactory container file, and its cels are the SHP
transparent-image codec that `engine/src/df/shp.ts` already ships for props and
puppets: **all 5424 cels the 17 books' directories name decode with
`decodeShpFrame` unchanged**. What is Skull Cracker's own is only the arrangement —
four structures, all of them now read (`tools/dumpsbk.ts` dumps a book's plan and
renders its level):

- **Container 0 is a cel directory**, 48 bytes per cel, keyed by an ID at +28
  with the container location at +30. Everything references cels by ID, never by
  index.
- **A 38-byte root** holds the container indices of the other two — the level's
  table of contents.
- **An entity table**, 48-byte records: a rect, a point and a Pascal name. The
  names are the level design — `platform`, `obstacle`, `ladder`, `goal`,
  `newroom`, `init*` spawns, `stat*` pickups; 1218 of the 1219 records in the 16
  levels are named. The point cross-checks the reading: for static kinds
  (`obstacle` 100%, `stat*` 99%, `timer` 100%) it is the rect's own midpoint, and
  for `switch`/`door`/`ladder` it deliberately is not — it is a destination. A
  `ladder`'s two extra fields have since been read: its `param` is the RUNG
  SPACING, ±35 in every one of the nine ladders in the game, and its `pointX` is
  the x the player is put at. The sign is the ladder art's own mirror flag, so it
  says which side of the pole you climb from and which way you face doing it.
- **A backdrop table**, 342-byte records: cel ID, world (Y, X), a 16.16
  fixed-point **parallax factor**, an animation frame count — and ~320 bytes of
  saved runtime state that is dead on disk. **All 5048 records across the 16
  levels resolve through the directory**, and every level renders as a
  recognisable place (the one vertical canvas belongs to TOWER, as it should).

Container 0's own 32-byte header turned out to name the palette container, the
root container and the cel count outright, which replaced three guesses by size.
That mattered: the guess for the palette was "find a 2056-byte container", and
`STREETS.SBK` has **two** — taking the first painted that whole level in the wrong
colours. Verified on all 17 books. The full layout is
**[SBK](../engine/formats/sbk.md)**, and
**[the sprite book viewer](../editors/books.md)** is it in a browser: the layers
separable, the plan clickable, the cels browsable.

### What the executable settled

`SC.EXE` is a **PE32** binary (the 16-bit one is the root `SKULL.EXE` launcher),
self-contained but for Windows DLLs, and `skullcracker/tools/scdis.mts`
disassembles it the way `taoot/tools/disasmcmd.mts` does `TI.EXE`. Pointed at the
sprite book format it settled three things inference could not:

- **The entity table has a discriminator, and the binary agrees with it.** `+22`
  says object or region, and **96 of the 113 names in the books appear in `SC.EXE`
  as strings while the 17 that do not are exactly the region records**. Two
  independent statements of one fact. The executable never compares those names
  because it never compares any name — each class is interned once into a 16-bit
  id (registration blocks at `0x40b400`, 0x3a bytes apart, capped at 100 classes),
  and everything after dispatches on the id.
- **Three fields the reader was dropping carry data**: a per-instance parameter at
  +0, four flag bits at +14 that are all set except on `platform` and
  `initplank` — surfaces — and the region link at +10.
- **`inithealth` is a 1996 typo.** One record, in a level whose every other pickup
  is `stat*`; the binary has `stathealth` and has never heard of `inithealth`, so
  that pickup cannot have spawned. Seven more classes the engine knows that no
  level places (`initdoor`, `initpainting`, `statshield`, `suckto`, …) are content
  built and not used.

**The engine also settled what a platform IS at runtime, and unsettled a guess.**
Three functions touch the platform array: an overlap query that walks it, tests
rects, and writes the colliding object's pointer into the record's +10 — so that
field is the *occupant*, which is why the disc always has 0 there; an appender
that creates platforms mid-game; and a remover that matches on +10 and compacts
the array, preserving only the rect, +10 and +24. **Nothing in that path reads
+14.** The jump-through-platform reading of the flags field gets no support from
the code, and is still marked a guess.

**And the record layout is confirmed offset for offset.** `SC.EXE`'s
collector at `0x40b850` takes a class name and copies every matching entity record
into a per-class array: `add ebx, 0x1c` past the table header, `add ebx, 0x30` per
record, `cmp dword ptr [level+0x18], ecx` against the count, `rep movsd` with
`ecx = 12` for the 48 bytes, `lea eax, [rec+0x1c]` for the name — and
`cmp word ptr [rec+0x16], 0; je next`, which is this port's `isEntity` being used
as the engine's own filter. Every offset the reader had inferred, doing the job it
was inferred to do. The full table is in
**[SBK](../engine/formats/sbk.md#the-layout-confirmed-by-the-code-that-read-it)**.

It also recovered something the discs do not contain: **the order the sixteen
levels come in**, and then corrected it. The first reading paired each book with
the theme bank pushed beside it — `streets.sbk` with `theme01.snd` through
`vat.sbk` with `theme16.snd` — which is right for fifteen of the sixteen. The
sixteenth is the sewer: `theme03.snd` is its bank, but `0x436b51`, the only place
`sewer.sbk` is opened, sits in the second chapter's third stage, the one that
plays `chp07`. The order that settles it is the four film sequencers, each a
switch on the scene state where states 2 to 5 name `chp01`…`chp04`,
`chp05`…`chp08` and so on, and each of those cases opens exactly one book.
`LEVEL_ORDER` in `engine/src/df/sbk.ts` carries it and the viewer lists by it.

The same functions say **when a level is over**, which turned out not to be
"reach the goal": the goal is not spawned until the mission's share of the
level's population is dead, and the share is a `double` per stage — 75% of
STREETS, 35% of the MAZE, everything in the ARCADE, nothing at all in RAVECAVE
and the TOWER. `skullcracker/src/mission.ts` is the table and
`docs/engine/formats/sbk.md` has the disassembly.

And what gets spawned is not a marker. `0x410170` puts an object 180 pixels above
the `goal` record's point, facing the way the record's `param` says — the only use
anything in the engine makes of that field — and `0x410480` sinks it four pixels a
frame until it is level with the record, bobs it through ten pixels while it
waits, and then, once the player is standing in the rect, plays sixteen cels of it
lowering a panel with a picture on it. Cels 20200…20255 of `PLAYER.SBK`: a
**flying television**, which is what every mission in the game ends by walking up
to.

**Damage is speed**, which is the other thing that reading turned up. A cel record
in a sprite book has three fields nothing had read: a strike box, a collision box,
and a `(dy, dx)` pair. `0x42f910` takes the striking object's current cel, scales
that pair by the object's own percentage, adds whatever the object was already
doing, and returns the magnitude — and every hit handler in the game subtracts the
result from the victim's health. So the punch is cel 602's `dx 47`, the kick is
663's 55, a punk with 250 takes six punches, and thresholds that look arbitrary
turn out to be speeds: a mailbox dents at 10 and springs back but topples on its
side for good at 55, a punk is knocked down over 50. A punch staggers and a kick floors, by arithmetic rather than by
design intent. Every blow also throws `damage / 6` gobs of green goo, up to twenty
of them, along its own direction — `0x40cba0`, and the goo is the same green that
runs out of a dead punk's head in the last eight cels of its death, though only
from a creature: a mailbox's handler never calls it. The gobs then
arc, land, and **spread**: `0x40c480` switches them to a falling pair the frame
their `vy` turns positive, zeroes their velocity where they hit the ground, and a
gob landing on an existing splat advances that splat instead of making its own, so
twenty of them leave one puddle that widens through cels 18205…18210 and then
dries back a stage at a time.

The boxes also make a rule out of something that would otherwise look like a bug.
A rat's collision box tops out at `y -14`; the punch's fist box bottoms out at
`y -16` and the standing kick's boot is higher still. **Nothing standing up can hit
a rat** — the duck-kick's boot box at `y 38..83` is what reaches one, and one blow
of any size launches it nine cels through the air, because its hit handler
`0x44e3f0` has no health test at all. Two pixels is not an accident in authored
data.

`obj+0xe` turned out to be a mass as well as a divisor. `0x430470`, which the
collision dispatcher calls after a hit handler returns, is the textbook elastic
collision applied per axis with that field as the weight — the player is 12, a
punk 20, a hydrant 10, a mailbox 7 — so a kick's 55 against a mailbox comes out as
69 pixels a frame and throws it most of a screen. Which also settles what
`obj+0xa`/`obj+0xc` are: a persistent velocity, not a per-frame stride. Anything
that should not drift cancels them itself, and the hydrant's frame function does it
on its first two instructions. Nothing found so far slows a slide, so the drag is
the port's one invented number here, calibrated against the only observable — a
kicked mailbox crosses about a screen, and measured on the page rather than solved,
because a kick has no vertical component and the box spends its first fifty frames
falling the 37 pixels between its upright shape and its fallen one. Where it comes to rest is not invented: each
cel carries its own collision box, the upright mailbox's reaching 93 pixels below
the anchor and the fallen one's 56, so a thing that changes shape has to land on the
box it is currently showing or it floats.

### CITY's own machinery

Chapter four registers eleven classes and five of them fight; the rest are the
level. Two are in now, and both are CITY's:

A **plank** is a board with a platform record laid under it, and it OWNS that
record — `0x42fb70` claims the platform whose rect contains the object's point,
and `0x42fcb9` republishes that rect each frame offset by however far the owner
has moved, which is how an elevator carries a floor and how a plank takes one
away. Its frame function gives you six crossings (it sags through cels 1050..1053
and counts each time that animation ends) unless you land on it hard, and then it
goes at three times the player's gravity with woods.snd's "0030 woodplankh".

A **crow** is the first flying thing here, and its constructor says so: divisor 1,
`obj+0x2e = 0`, gravity 0. It sleeps on cels 1854..1859 with its own sleep sound
until the player's point enters its rect, wakes, takes off, and then does the one
thing it can do — **no frame of any crow script carries a `dx` or a `dy`**, so its
only motion is the ten pixels a frame its frame function moves it toward
`player.y - 100`, jittered. It holds its x and matches your height, which is why
CITY perches them over the gaps you jump. Any blow kills one: feathers (three if
the blow beats 50), "0225 crow gets hit", and it tumbles away under the player's
own gravity.

A hydrant is the other thing a kick opens rather than breaks. Its four cels are a
valve being turned — the bar across the cap swings a quarter turn per hit — and
what the third one lets go of is not an animation on the hydrant but a SECOND
object: `0x44fb20` calls the hydrant's own creator for one 25 pixels to its facing
side on the water tag, plays the burst, and reinstalls tag 0 on itself, so the
hydrant is whole again and can be turned open all over again. The water's own ten
cels grow from 35x17 to 510x96, carry no collision box at all, and the object
removes itself the frame they end. Six of them do carry a strike box, so the jet
knocks things about in the original; that is read and not wired.

A punk's body then leaves a **green ball**: `0x40cba0`'s −13 branch, eleven cels
of a sphere swelling to 89 pixels and collapsing to nothing, fired by the corpse's
own state handler on the frame `[0x46b204]`'s fifty run out. The rat gets none —
that call is in the punk classes and nowhere else. And the census leaves before the
body does: the corpse handler calls `0x42f870(obj, 0)` on its first dead frame, so
the quota moves on the killing blow.

One correction that came with it. Each of the four chapters registers its own
classes and each chapter's books put a walking figure at cel 1900, so a class
function from the wrong chapter looks plausible and is wrong. This page had read
`initwerea` off `0x439240` — health 25, award 250 — and that belongs to the
chapter of gang members. `initwerea` is registered exactly once, at `0x4504d1`,
and its creator gives it 250 health and a 220 award. The check that catches it is
the cels: the other chapter's rat dies on cels 3080…3085, and no book in chapter
four contains them.

And the region link closed the last hole: the 48 containers left over from the
first census, 18 to 362 bytes with nothing pointing at them, are the **ground** —
a bounding box and then a polyline of `(y, x)` points. `WOODS.SBK`'s is 88 points
running the length of the level. That is the walkable floor, and it is the one
thing in a sprite book that describes how the game *played*.

Which record owns which region turned out to be the level's structure: the 52
named areas across the sixteen books own those 48 regions one apiece, and the
`exitroom` objects are the doors between them, each carrying the param of the
room it leads to. Nine doors in four levels, all resolving, all in opposed pairs
— and the point each one stores, just outside its own rect, is where you come out
of the door back. What it is NOT is a contact trigger: STREETS' street door
stands between the spawn and the goal and its exit point is eight pixels past its
own edge, so a player who touched their way through one could never get past it.
Doors are opened with the up key. See
[the format page](../engine/formats/sbk.md#rooms-and-the-doors-between-them).

That reading also settles a level that cannot be walked at all. CITY's floor is a
ledge from x271 to x691 and then y = 7250 for the rest of the level, ~2900px
below anything CITY draws. CITY is not walked; it is played across its 73
platforms and 20 planks, the most of any level.

Which is why the next thing the walk page grew was the ability to leave the
floor. `platform` is the commonest object in the game — 263 of them — and
`SC.EXE` says what one is: five functions touch the array at `0x4aa600`, and the
one that matters takes each platform's movement since last frame and applies it
to whatever is standing on it. A platform is a thing that carries its occupant.
None of the five holds a vertical velocity — and following that up turned out to
answer the question rather than fail it. **Skull Cracker has no gravity and no
velocity.** Motion is authored per animation frame: every frame of every script
in `.data` carries a `(dx, dy)`, and `0x42f8b0` applies it each tick divided by a
per-object divisor. A jump is one frame with `dy = −420`; a walk is `dx = 95`; a
run is `dx = 180`. The scale is read too, now: the player's
divisor is 12 (`0x42e412`) and the game runs at **15 frames a second** —
`0x4087c0` returns 1/60s units and `0x40e4f0`, reached from all sixteen level
frame functions, spins until four of them have passed. So the walk is 120px a
second, the run 225, and every animation plays at 15fps.

The run took finding, because it hides behind a key nobody would guess. The
binding table at `0x46b210` maps **W** to action 1, and that action's handler sets
`0x4ac3fe` — a flag every movement state reads, and reads differently depending on
where the player is: on the ground it installs the run, on a ladder it climbs a
rung, in the air it adds lift. One key, three jobs. The ladder's rung is literal —
`0x42ae50` keeps a rung index and ends every frame with
`y = rung * spacing + top`, so a climb is 35px a tag of four cels and nothing in
between exists. A port that reads `W` as "up"
therefore has no run at all, and a correctly-measured 120px/s walk feels slow
because the game's travelling speed is nearly twice it. STREETS is laid out for
the run: two legs of its own route to its goal are not passable at a walk.

### Gravity was in there all along

It was called this port's last invented number for a long time, on the grounds
that every animation script in the binary had been enumerated for a nonzero `dy`
and the player has exactly one record with any — the launch, `dy -420`. Both true,
and looking in the wrong place: the fall is not in a script, it is a FIELD.

```
0x402784  0x42f850(player, 1.0f)      where the player is placed
0x42f850  obj+0x24 = f * 100.0        so the player's is 100
0x430327  if (!landed) obj+0xa = obj+0x24 + <this frame's vy>
```

`obj+0xa` is a velocity in the raw units every script uses, divided by the class's
own `obj+0xe` when the mover applies it — the player's is 12 — so the player
accelerates downward by **100/12 = 8.33 pixels a frame²**. The whole engine's
gravity is one float per object: a plank that has given way gets `3.0f`, three
times the player's, and anything that must not fall gets 0.

The reason this is worth writing down twice is that the number was already right.
It had been measured off a screen capture of the original: the engine's camera
follows the player vertically and no plane has vertical parallax (a local template
match of a near layer and a far one returns identical `dy` on every frame, to the
pixel), so the background's shift between frames *is* the player's. That gave an
apex of **73px at 483ms** and `g = 8.75²/(2×73) = 0.524` a tick², against
`100/12 × 0.25² = 0.5208` from the code. Two independent derivations, agreeing to
a third of a percent.

The code says one thing the capture could not. The engine steps gravity once a
FRAME, so the rise is a sum of five terms rather than an integral —
`35 + 26.7 + 18.3 + 10 + 1.7 = 91.7px`, and 112.5 with the lift's two frames on
top — and the capture's 73 is that same jump seen through a camera that cannot
show the first frame's full 35 pixels. Which is what makes CITY's opening
passable: its first wall wants 101 pixels of lift and the original has 112.

STREETS corroborates it from the other side: its hardest jump is an 85px roof gap,
which sits between the plain jump and the jump-with-lift, and that is what gives
`0x4723f0` a purpose at all.

This port jumps higher than the original on purpose — `JUMP_SCALE`, 1.2 — because
half a character height plays low. It scales the launch and leaves gravity where
the file puts it, which keeps the two separable: `apex = v²/2g` and
`T = 2v/g`, so buying height by weakening gravity costs hang time quadratically.
Doubling the apex that way was tried and cost 2.2 SECONDS of airtime, four times
the original's, which is what "almost feels like I'm flying" means.

`PLAYER.SBK` turned out to hold the interface too, and the whole of it: `12000`
is the upper band and `12001` the lower, both 512 wide, and between them sit the
two sliding health bars, the score, the two name plates, the pad's eight lights,
the special weapon's gauge, the five life lights, the seventeen-cel mission dial
and the kill quota's two numerals. Every coordinate is a literal in `SC.EXE`'s
own painter `0x40d500`, and the geometry falls out of one of them: `0x40dc10`
offsets the lower band's clip rect by −274, the same amount the plotter
`0x40dcd0` subtracts from every screen y, which puts that band at y272 and the
level's window at (0, 42) to (512, 274) — exactly where the pause films play.
`docs/engine/formats/sbk.md` has the full table; the walk page draws all of it,
and Ctrl+P toggles it the way the game's own help screen says it does. The four
rows of sixteen at x417 that an earlier pass read as the player's health are the
WEAPON's magazine, inside the special-weapon window.

Ctrl+P also settles the other window. `0x40e120` is that key's handler and besides
flipping the flag it hands `0x430860` a view rect: `{0, 0, 0xe8, 0x200}` with the
panel up and `{0, 0, 0x156, 0x200}` without — **512x232 and 512x342**. Those are
surface coordinates and the level's surface starts 42 rows down, so 42 + 342 is
exactly the screen's 384: full-screen mode is the same window grown downwards into
the panel's space, not the whole screen.

There is no camera variable in `SC.EXE` to read — the engine scrolls by moving the
world, so every drawn thing carries a position already relative to a view rect
fixed at the window. What the data does give is a shape: a room's rect is the
world, and the view is a 232-tall slot in it. The walk page follows the player and
clamps the slot to the room's rect in both axes, which is the rule it already used
horizontally, and that put the player's feet where the original's screenshots put
them — near the bottom of the window, with the ground filling the last forty rows
instead of a third of the screen. Two invented constants went out with it. What the
slot is centred on is the middle of the player's own collision box rather than
their feet: an object's y in this engine is the cel's anchor and the box is what
touches the floor, and centring 232 rows on the feet cut the top 29 rows off a
sprite 145 tall wherever the room clamp was not already holding the view down.

The evidence that the rects are right is STREETS' own route to its goal, which
falls out of the data without being designed for: the ladder at x9632 lifts you
from the pavement to its top rung at y732 — which is where the player's ANCHOR
goes, so their feet arrive at 828 and the roof beside it is y854 — and from there
the platform tops at 854, 980, 895, 941 and 1033 step west along the rooftops to
the `goal` rect at y794…1035. The
player's feet land on the drawn edge of the theatre marquee, which nothing in the
port arranged — the rect is the disc's and so is the art.

`PLAYER.SBK` is the degenerate case that proves the split: all cels, and a root
pointing at two empty tables — the player has no level. And the books still hold
almost no BEHAVIOUR: `initzomb` says where the zombie starts, and what a zombie
does is native code. The exception is per-cel and was found late — a cel record
carries the frame's strike box, its collision box and the blow it lands, so how
hard a punch hits is in the book after all. The layers only align under the executable's camera, so a flat
render is the level unrolled, not a screenshot.

(The tag really was `SPBK`/`SKLC` — but that was the Mac disc's Finder
type/creator at 0x20, not a format signature; the Windows disc stamps the same
files `LPPALPPA` like every other DreamFactory file. And one impostor shares the
extension: `SUPPORT/DIRECTX/**/SYNTHGM.SBK` is a RIFF SoundFont bank.)

### The start sequence is a string table in the executable

`Install Folder/Skull` is a PowerPC PEF binary, and packed together at offset
490764 are the eleven films the shell plays:

```
cyber.Mov  imain.Mov  Menu.Mov  prefs2.mov  helpmac.mov  credits.mov
char.mov   kill1.mov … kill7.mov
```

The first three are the startup — CyberFlix logo, intro, menu — and the page
follows that order rather than opening on the menu. The Windows engine carries the
identical table (at offset 435497 of `INSTALL/BIN/SC.EXE`, laid out backwards in
memory and reading the same order), which is the independent witness for this. The next three are where the
menu's own buttons go, which corroborates the exit table below from the other
side. Per-level records sit earlier in the same region, each pairing a
`BoggsNN.Mov` with a `ChpNN.Mov` beside that level's sprite book and theme.

The strings *around* them are the useful negative result, because none of this is
in any data file: `"Enter name for high scores:"`, `Name`/`Score`/`Level`,
`Easy`/`Hard`, `"Enter level (1-16):"`, `"Load from which slot?"`,
`"Save in which slot?"` — and seven cheat words. High scores, save slots, level
select, difficulty: the entire shell is native code, and the films are assets it
plays.

**There is no DreamFactory script interpreter in it either**, and that is measured
rather than inferred from the missing BOOTFILE. Titanic's Dutch disc ships a
Macintosh build — `INSTALL_MAC/Titanic`, a PEF binary like Skull Cracker's — and
that one carries the engine's command vocabulary as plain strings: `playmovie`,
`opentrackfile`, `actionframe`, `wavevolume`. Skull Cracker's binary carries none
of them. Two PowerPC executables from the same studio and the same year, and only
one of them has the script language in it.

The Windows release says the same thing on its own hardware. Its root `SKULL.EXE`
is an 83 KB Win16 launcher stub; the engine is `INSTALL/BIN/SC.EXE`, 584 KB, and it
carries **the same film table in the same order** — mixed casing and all, with
`helpmac.mov` swapped for `helpwin.mov`, the one entry the two platforms disagree
about — the same shell strings, six of the same seven cheat words, and **zero**
DreamFactory verbs. Two executables, two platforms, two executable formats, one
answer.

### How a DreamFactory menu answers with no script

`menu.mov`'s six buttons are type-2 jumps to six one-frame stubs at the tail of
the same film — `"frame 2"`…`"frame 7"` — and each stub is a type-1 **exit**. The
film's whole return value is *which frame it stopped on*; the executable read that
and did the rest. One button is the exception and answers by itself: Prefs is a
type-3 chain naming `prefs.mov`.

So `skullcracker/src/main.ts` keeps a small table mapping the exit frame to what
this port can do about it — that table is this port's reading of the buttons (they
are in the menu's own top-to-bottom screen order), not something recovered from
the film. Begin leads to a level that is native code, so it plays what the game
plays on the way there: chapter one's briefing card.

### The sound was one pointer away

The disc's 24 `.SND` files are DreamFactory 4 audio banks — the format Titanic
spells `.TRK` and Timelapse `.SFX`, which this project has read from the start.
`readBankTables` took the loop table to be container 1, true of 615 of the 630 v4
banks across the four discs and false of exactly the fifteen that are
Skull Cracker's music: `THEME01.SND` is 14 containers with its bars in 1..11, its
loop table in **12** and its empty one-shot table in 13, and container 0's own
field at +28 says so. Reading that field opens all 24 banks, in the game and in
the track editor, which had called them "not a bank".

A theme is a bed of BARS and a play ORDER over them, and the order is the
arrangement: `THEME01` is eleven bars and 62 steps beginning `1 1 5 5 5 3 4 3 4`,
three and a third minutes of music out of eighteen seconds of audio. Every one of
the 530 chunks on the disc decodes through the existing codec unchanged, 522 at
22kHz and 8 at 11k, with eight quarter-second rests in THEME11's bed.

Which bank belongs to which level is in `SC.EXE`, once: each of its 23 bank names
is a Pascal string referenced from exactly one place, and every place is
`0x40ea80(slot, name, flag)` beside the level's own `.SBK`. That pairs all sixteen
levels with their themes, four chapters with their effects banks, and the two
playable characters with `skulz.snd` and `bones.snd`.

The last piece is what makes the reading provable rather than plausible.
`0x40ef30(bank, index, point)` plays a one-shot **by record index**, and every
index in the chapter's hit handlers lands on a name that says what it is — the
hydrant's 4 on "0040 hydrant", the mailbox's 5 on "0050 mailbox falls", the rat's
12 on "0150 rat gets squashed", a punk's 33 on "0560 wolf death", its `rand(4) +
0x23` on the four "wolf hit" takes, the ladder state's 2 and 3 on the two "ladder
step"s, and the walk cycle's frames 1 and 6 on the two "skull step"s. Nine
independent hits on a table nobody indexed by hand, which is also how the levels'
own name for their punks came out: they are werewolves.

`0x40efb0` places each one — the volume falls off linearly with the Manhattan
distance from the middle of the view and nothing 768 pixels past it is played at
all — and that is the whole of the mixer.

## Where the pieces are

- `skullcracker/` — the page, its file store and its film loop
- `engine/src/df/byte-order.ts` — which way round a file is, and how it is asked
- `engine/tests/byte-order.ts` — detection (needs no rip) and the menu (needs one)
- `skullcracker/tests/browser/menu.ts` — the menu in a real browser
- `engine/src/df/sbk.ts` — the sprite book reader, and `engine/tests/sbk.ts`
- `skullcracker/src/props.ts` — the level's machinery: the plank and the crow
- `skullcracker/tests/browser/city.ts` — CITY's opening, in a browser
- `skullcracker/src/sound.ts` — which bank a level opens and which index is which
- `engine/tests/skull-sound.ts` — the 24 banks, and the indices against their names
- `skullcracker/tests/browser/sound.ts` — the theme and the one-shots, in a browser
- `skullcracker/tools/scdis.mts` — disassemble `SC.EXE`; `scnames.mts` — its names against the books'

- `tools/dumpsbk.ts` — a sprite book's cels, level plan and backdrop, as PNGs
- `site/editors/books.html` — the same, in a browser, at `/editors/books.html`

The film loop in `skullcracker/src/main.ts` is a second implementation of the MOV
frame state machine, and says so: the engine's own `MoviePlayer` needs a
`GameSession`, which is exactly the thing a game with no BOOTFILE cannot produce.
Everything that is not the state machine — the readers, the pacing, the
soundtrack, the audio sink — is the engine's.
