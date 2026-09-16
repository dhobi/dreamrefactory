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
npm run dev -w skullcracker        # http://localhost:5178/
npm run test:browser -w taoot -w skullcracker
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
on its first two instructions. What slows a slide is the allocator: `0x42f550`
gives every object `obj+0x1e = 5734` and `obj+0x20 = 2048` at birth, and the body
stepper takes `v.x × 5734 / 8192` — 70%, truncated, never less than a pixel — off
the horizontal velocity on every frame that ends on the ground (`0x4302c0`). The
port had invented a drag of 0.7 a tick here and calibrated it against a kicked
mailbox crossing about a screen; the calibration had found the field. Where it comes to rest is not invented: each
cel carries its own collision box, the upright mailbox's reaching 93 pixels below
the anchor and the fallen one's 56, so a thing that changes shape has to land on the
box it is currently showing or it floats.

### CITY's own machinery

Chapter four registers eleven classes and five of them fight; the rest are the
level. Three are in now, and all three are CITY's:

A **plank** is a board with a platform record laid under it, and it OWNS that
record — `0x42fb70` claims the platform whose rect contains the object's point,
and `0x42fcb9` republishes that rect each frame offset by however far the owner
has moved, which is how an elevator carries a floor and how a plank takes one
away. Its frame function gives you six crossings (it sags through cels 1050..1053
and counts each time that animation ends) unless you land on it hard, and then it
goes at three times the player's gravity with woods.snd's "0030 woodplankh".

"Hard" is `cmp word ptr [eax+0x32], 0x64`, and what that field counts is worth
being exact about, because the port had it twelve times too strict and broke a
plank under any jump at all. `obj+0x32` is a running sum of the DOWNWARD VELOCITY,
in the whole pixels a frame that `obj+0xa` holds: `0x42fdbc` adds the velocity at
the top of the body step, before the move and well before a landing clips that
move short, and `0x42fdc2` stores zero over it on any frame that begins on the
ground or that is still rising. So the number is not the distance fallen — the
frame a fall ends on contributes its whole velocity however little of it was used.
The port had been reading the 100 as a raw value wanting the player's divisor of
12, which made 8.3 pixels of falling enough.

Read correctly, the limit still says that a plank is for walking across. A jump
landing back at the height it left counts 125: the rise is 35+25+15+5 and the fall
5+15+25+35, but the tuck the player holds in flight draws its feet 19 pixels higher
than the standing cel does (88 against 69, each cel's own box), so the anchor has
to come down 19 further before the feet reach the floor, and that takes a fifth
frame worth 45. A jump with the lift counts 168. Stepping down onto one, or
walking across it, counts nothing at all. Six crossings and then it goes, and
anything you jump onto it from breaks it where you land.

An **elevator** is the other half of that same sentence, and it is what makes
level two finishable. Its constructor is a list of denials — divisor 10 where the
player's is 12, `0x42f850(obj, 0)` for gravity, `obj+0x30 = 0` for never on the
ground — so it is a rect moved by its own state machine and by nothing else. The
five states are the five tags of script `0x477db0`: idle on cel 1160, a beat of
wind-up, and then travel at `0x28` over that divisor of ten, which is **four
pixels an engine frame, sixty a second**. It owns its landing the way a plank
owns its floor, and the level authored one landing per lift: applying `0x42fb70`
at the SHAFT'S BOTTOM — not at the record's stored point, which is the shaft's
middle and is inside nothing — claims #53, #54, #55, #79 and #103, and those five
are the only platforms in CITY between 120 and 135 pixels wide.

Why it matters more than it looks: CITY has no `ladder` record, its goal is at
y1802, and the walk east tops out around y3590. Without the cars **45 of its 73
platforms are reachable and the goal is not one of them**; with them, all 73 are.
Every claim about level two being impassable in this repository's history was a
hole in the port, not a hole in the disc.

One thing in it is not read. `obj+0x46` gates every state and nothing this port
has disassembled writes it, so what calls a car is a guess — but a guess the code
constrains: tags 2 and 4 end by installing tag 0, and tag 0 departs again the
instant the gate is set, so a car held by a standing rider would yo-yo for ever.
The gate is an EDGE. The page models it as boarding, latched, and says so in
`ELEVATOR.trigger`.

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
platforms, 20 planks and 5 elevators, the most of any level — and the planks and
the elevators are CITY's alone, the only book that places either.

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
frame functions, spins until four of them have passed. Every animation plays at
15fps — and the walk is not 8 × 15. The record's dx is an impulse into a velocity
the ground drags by 70% a frame, so 8 a frame settles at 12 and the run's 15 at 22:
**180 and 330 pixels a second**. The same velocity is what a jump steers — the
tag-0 handler drives it to 30 a frame while forward is held, and in the air nothing
drags it — and what a landing slides on for three frames.

The run took finding, because it hides behind a key nobody would guess. The
binding table at `0x46b210` maps **W** to action 1, and that action's handler sets
`0x4ac3fe` — a flag every movement state reads, and reads differently depending on
where the player is: on the ground it installs the run, on a ladder it climbs a
rung, in the air it adds lift. One key, three jobs. The ladder's rung is literal —
`0x42ae50` keeps a rung index and ends every frame with
`y = rung * spacing + top`, so a climb is 35px a tag of four cels and nothing in
between exists. A port that reads `W` as "up"
therefore has no run at all, and a walk on its own feels slow because the game's
travelling speed is nearly twice it. STREETS is laid out for
the run: two legs of its own route to its goal are not passable at a walk.

### WOODS is a population and two steps

Level three needed none of CITY's machinery — no plank, no lift, no girder, no
ladder — and could still not be played, for two reasons that turned out to be the
same reason twice: the port was reading records at the wrong field.

**A creator places its object at the record's POINT.** The level's spawner
`0x4503a0` pulls three things out of each 48-byte record and hands them to the
class's creator: the point as one dword, then the rect's two corners. Every
creator's first move on the first of those is `mov dword [obj+6], eax`
(`0x450f90` the dog, `0x450a7b` the punk, `0x450cdc` the husk), and `0x4026d0`
draws a cel with its anchor at `obj+6`. So the point is where the thing stands and
the rect is only the territory its AI struct keeps (`0x450fc3` stores both corners
into it). This port had been standing every enemy on the rect's bottom edge. In
STREETS and CITY the two are close enough that nothing showed; WOODS' rects are
wide territories whose bottom edge is well under the ground, so all twenty of its
enemies spawned inside the terrain and fell through the world.

**A rise of more than fifty pixels is a wall.** `0x42fedc` adds `0x32` to the floor
found under the body's new position and compares it with that position; if the
floor is still higher, and no platform was found under the point, `0x42fef3`
throws the entire move away — the packed position is restored from `obj+6`, the
horizontal velocity is subtracted back out of the x, the vertical is zeroed and
what is left bounces off `obj+0x20`. That is the only wall the terrain has, and it
is why the designers used `obstacle` records where they wanted a hard stop: CITY's
five include the 60x308 one at x1873. The companion number is 8, from the landing
test at `0x42ff56` — a floor more than eight pixels below the feet is not
underfoot, and you are briefly in the air. This port had one invented figure of 26
doing both jobs. WOODS' ground steps up 68 to 74 pixels in twelve columns at
x8746 and again at x8890, and those two steps are the whole of the level's
platforming: everything else is a run east.

Its population is five classes and only four of them count. The dog — `woods.snd`
calls it a **wolfy** — never calls `0x42f870`, the census, and never calls
`0x40d1c0`, the health bar; it is worth 200 and nothing to the quota, and six of
them stand in a level whose kill share is 55% of the other fourteen. It is also
the only enemy in the chapter with a real repertoire, choosing a trot, a walk, a
leap that leaves the ground (`dx 160, dy -80` twice) or a flat-out charge from its
own five distance bands at `0x478240`.

The strangest of them is the husk. Its creator never calls the difficulty scaler
at all: it writes the literal 3 into its state (`0x450d1c`), and its hit handler
fetches the blow's damage only to hand to the blood before doing `dec word ptr
[eax]` (`0x454821`). Three blows of any size. Then the first tag of its death
calls `0x450a50` — the punk's own creator — at its own position (`0x454690`), so
what falls over leaves a fresh 250-health punk standing where it was. It pays no
award, because the thing that climbs out of it carries the 300.

The three `initcrush` records across the path are hydraulic presses, and
`woods.snd` index 19 is named "0230 hydraulic ". A press has no timer and no
stagger — its whole trigger is the player's own point inside the record's own rect
(`0x4549df`), re-tested on every frame it is up, so it works for as long as you
stand under it. It never moves: every record of its script carries `dx 0, dy 0`
and `0x4549c3` rewrites it onto its record's point each frame anyway. What travels
is the drawn ram, 175 pixels in three frames, and only two of its cels — 4382 and
4383 — carry a strike box. The blow they carry comes out of `0x42f910` as 64,
which is over the player's own knockdown threshold of `0x3c` at `0x449115`: a
press does not stagger you.

### PLAYGR is one fight

Level four is seventeen records. One room, one small platform under a pickup, two
`obstacle` walls holding the ends, three pickups, seven dogs and **one**
`initwbooly`. The ground is flat from end to end, so there is nothing to jump and
nothing to climb: the level is the thing standing in front of the goal.

Its kill share is the one that stores zero — everything — and the only thing in
the census is the boss, because the dog's creator never calls `0x42f870`. So the
seven dogs are worth 200 apiece and nothing at all to the quota, and the goal
stays shut until one enemy out of eight is dead. The engine is stricter than that
even: the completion poll at `0x4502d0` wants the census clear **and** a flag at
`0x476a94` that only the boss's death path writes (`0x456431`). The two become
true together, because the boss takes itself out of the census as it starts to
burn.

**It begins as a statue.** Cel 3040, one frame, doing nothing, until the player's
own point crosses into the record's rect (`0x4559e8`, the same point-in-rect test
a ladder and a door use); then it stirs, climbs out of the ground through
3122..3124, and comes for you. Eight hundred health at `0x4510b8`, four times the
chained punk and the largest number in the chapter, and 2500 points for it at
`0x456420`, which is ten times a werewolf. Its divisor is 30 — the heaviest thing
in the game.

What it does while it lives is a real loop: hover a frame, measure the distance
forward against its own six bands at `0x478780`, and either close or swing. Inside
160 pixels it swings a nine-cel combo; outside it charges at eleven pixels a frame,
or twenty-one when it has had enough and is going home to the point its creator
gave it. Every third consecutive blow puts it over instead of making it flinch
(`0x456496`), and getting up is its own script at its own rate — which is why a
`then` field had to exist, since the knockdown runs two frames a cel and the get-up
three. Dead, it comes apart over eighteen frames and burns as cel 3140 for ever;
the object is never destroyed.

The one thing deliberately left out is its fireball. `0x456240` builds a second
object of its own class with a restitution of 0.8 so the low shot bounces, and
every frame of it carries a strike box — it is the one attack of the six that
exists to hit you. The charge, by contrast, carries no strike box on any frame: it
closes the distance and nothing else, so running it costs the player nothing.

### Things that hit back, behind a switch

The port could hit and nothing could hit it, and that was a hole rather than a
design. It is now filled and **off by default** — `?damage=1` at load or the `h`
key at any time — because the other suites walk levels end to end and three
hydraulic presses turn a route test into a fight.

The numbers are all the engine's. Maximum health is `trunc(difficulty × 600) +
1200` at `0x448ac2`, so 1800 easy, 1200 middle, 600 hard; note the sign, since the
same difficulty word halves enemy health through `0x40e300` in the other
direction. The damage a blow does is the blow itself: `0x4490d5` takes
`0x42f910` of the hitter — the root of the sum of its current cel's own `(dy, dx)`
pair, scaled by the hitter's strength percentage and with the hitter's own velocity
added — and `0x449209` spends exactly that. So a hydraulic press, whose cels 4382
and 4383 carry `(dx 64, dy 5)`, costs 64 a stroke, and a dog's bite costs whatever
the dog was running at, because its strike cels carry `(0, 0)` and nothing else.

There is one threshold, `cmp di, 0x3c` at `0x449115`: sixty or less is a stagger
out of `0x4766f0` and more is a knockdown out of `0x476890`, each with a front take
and a back one chosen by which side the hitter is on. Every record of all four
carries `dx 0 dy 0` — the throw is not in the script, it is the elastic exchange
`0x430470` does afterwards with the two objects' divisors as masses.

**The invulnerability is not a timer.** There is no cooldown anywhere in the
collision path. What protects the player is that `0x4303b3` skips a victim whose
current cel has a degenerate body box, and every reaction cel in `PLAYER.SBK` has
none: 5900–5902, 5910–5915, 5940–5944, 9550–9558 and 5020/5021. You are untouchable
for exactly as long as the reaction plays, and that is the whole mechanism.

Falling is its own path and takes no blow at all. Past 360 of accumulated drop the
player is cut into the flail (`0x442f3f`); on landing, past 530 it is simply death
with no health call (`0x443c8a`), and under it a flat ten and a roll. And the life
is spent when the dying animation ENDS rather than when the health runs out
(`0x443dea`), with the fourth death — the count goes 3, 2, 1, 0, −1 — turning into
the game-over state.

What can actually land a blow here is narrower than what could in the original,
and for a reason worth stating: this port's enemies walk their territory and do not
run their attack states, so a dog never bites and a punk never swings. The things
that connect are the machinery — presses and swinging girders — and the level-four
boss's melee combo, which is the one enemy state this port does drive.

### MALL is a new chapter, and a new shape of level

Level five opens the second chapter, and none of the classes this port had built
up over four levels appear in it. It is also laid out unlike anything before it:
**three regions side by side**, overlapping by six pixels, with no `exitroom`
between them, and not one `platform` record in the whole level. You walk out of one
region and into the next, which is what `0x40b940(2, point)` does for every object
on every frame — the region you are in is whichever one contains your point. What
had to change here was this port's idea of a room: it had them as places you are
PUT into, by a door or by the level loading, and never as places you leave on foot.

Its three enemies are built to a pattern of their own, and the differences from
chapter four are the interesting part. A divisor of seven where the punks have
twenty, so they are quick and light. A blow pinned at 100 and re-stamped by the
think's own epilogue on every single frame, so there is no window in which one is
disarmed. One flinch cel installed unconditionally — no height test, no facing
test, no random roll anywhere in any of the three handlers, where chapter four's
punk has four takes and picks between them. An award paid straight out of the hit
handler rather than carried on the object. And six classes named in an ignore list
so that they cannot hurt each other.

**They are all statues until you come to them.** Each stands dormant on one cel
until the player's own point crosses into its record's rect, and then walks. The
dog has the same mechanism and the level-four boss makes a performance of it; these
three simply start moving.

Two of their state machines reach for things that are not in this level at all.
Both the masked one and the one with the bat have a sub-state for walking to a
`switch` record and throwing it, and MALL places no `switch` — the cels its script
wants are not even in the book. The masked one also has a one-in-thirty roll that
drops a roller behind the player, with a latch so that only one can ever exist.

The Coke machine is furniture worth describing because of how it ends. It holds
exactly four cans: a blow under 30 rocks it and nothing more, 30 to 75 rocks it
harder and counts, every third counted blow pops a can, and a blow over 75 bursts
it and throws every can it has left at once. Weak hits still count toward the next
one. **What stops it is its art, not a number** — it has no health word at all, and
the emptied cel 8505 carries no body box, so the collision pass stops offering it
as a victim the moment it shows. That is the same trick as the player's own
invulnerability while staggering.

### Gravity was in there all along

It was called this port's last invented number for a long time, on the grounds
that every animation script in the binary had been enumerated for a nonzero `dy`
and the player has exactly one record with any — the launch, `dy -420`. Both true,
and looking in the wrong place: the fall is not in a script, it is a FIELD.

```
0x402784  0x42f850(player, 1.0f)      where the player is placed
0x42f850  obj+0x24 = trunc(f * 10.0)  0x46a110 is 10.0 — so the player's is 10
0x430327  if (!landed) obj+0xa = obj+0x24 + <this frame's vy>
```

`obj+0xa` is a velocity in the raw units every script uses, divided by the class's
own `obj+0xe` when the mover applies it — the player's is 12 — so the player
accelerates downward by **10 pixels a frame²** — `obj+0xa` is a velocity in whole
pixels that the stepper `0x42fd80` adds to the position undivided; the 8.33 this
page once gave came from reading `0x46a110` as 100.0 and dividing. The whole engine's
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
FRAME and in whole pixels, so the rise is a sum of four terms rather than an
integral — `35 + 25 + 15 + 5 = 80px` — and the capture's 73 is that same jump seen
through a camera that cannot show the first frame's full 35 pixels. The lift is
worth more than it looks: `0x4723f0` allows two frames of `-125`, which is −11 on
the velocity each, and because the tag-0 handler that spends them is first run two
frames after the launch (the launch frame ends the launch tag; the next installs
tag 0; the one after reads a key) they land on the velocity at −15 and −16 rather
than at the top, and the apex comes out at **137**. Which is what makes CITY's
opening passable: its first wall wants 101 pixels and a held jump has 137.

The same two-frame delay is the shape of the jump sideways. Steering — 30 pixels
a frame while forward is held, nothing slowing it in the air — begins on that same
third airborne frame, so a standing jump with the direction held travels 180 and
lands at about 220, a held one 330, and a run's leap, which leaves the ground at
the run's 22 plus its own 15, 360. A jump pressed from a standstill or a walk
crouches for three frames first (`250 251 252`, dx 0, the walk's velocity draining
under the drag) and only 253 launches; the run's tag 4 is one record and launches
at once. Every jump lands in tag 1, four frames of `251 252 251 250` in which the
handler reads no key and the slide is the drag's — and a fall of more than 360
since the apex lands in `0x471c68` instead, sixteen frames of the same cels at
four a cel, with ten health off. There is no mid-air flail: the tuck holds all the
way down, and this port used to play the hard landing's loop in the air.

STREETS corroborates it from the other side: its hardest jump is an 85px roof gap,
which sits between the plain jump and the jump-with-lift, and that is what gives
`0x4723f0` a purpose at all.

There was a `JUMP_SCALE` here for a while — 1.2, "because half a character height
plays low" — and it turned out to be compensating for two misreadings at once:
gravity taken as 100/12 when the float is 10.0, and the airborne horizontal taken
as the run when the state machine drives it to 30. At the disc's own numbers the
disc's own gaps close, and the dial is gone.

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
- `skullcracker/src/props.ts` — the level's machinery: the plank, the lift, the crow, the press
- `skullcracker/src/foes.ts` — what each `init*` name is, and the numbers behind it
- `skullcracker/tests/browser/city.ts` — CITY's opening, in a browser
- `skullcracker/tests/browser/lift.ts` — CITY's five lifts, and the ride to its goal
- `skullcracker/tests/browser/woods.ts` — WOODS' population, its two steps and its goal
- `skullcracker/tests/browser/playgr.ts` — PLAYGR's statue, the fight and the television
- `skullcracker/tests/browser/damage.ts` — the switch that lets things hit back
- `skullcracker/tests/browser/mall.ts` — MALL's three regions, its population and its machines
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
