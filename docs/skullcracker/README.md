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
wants are not even in the book. The next level places six of them, and that
sub-state turns out to be the whole of how it works. The masked one also has a one-in-thirty roll that
drops a roller behind the player, with a latch so that only one can ever exist.

The Coke machine is furniture worth describing because of how it ends. It holds
exactly four cans: a blow under 30 rocks it and nothing more, 30 to 75 rocks it
harder and counts, every third counted blow pops a can, and a blow over 75 bursts
it and throws every can it has left at once. Weak hits still count toward the next
one. **What stops it is its art, not a number** — it has no health word at all, and
the emptied cel 8505 carries no body box, so the collision pass stops offering it
as a victim the moment it shows. That is the same trick as the player's own
invulnerability while staggering.

### SERVICE is the first level that is a system

Level six is one room nine thousand pixels long with three steps in it, and if
that were all it were it would be the thinnest level in the game. What it
actually is is the payoff for two things chapter two had been carrying unused:
the `switch` the gang all know how to throw, and the `initgoop` nobody had placed.

**Six levers, twenty-two nests, and a `param` joining them.** The levers carry
501 to 506 and so does every nest, and a lever's only job is to broadcast on its
own number. `0x436020` makes one on tag 3 of `0x473548` — four tags: 3 is the
idle it rests in when it is off, 0 the throw up, 1 the loop it rests in when it
is on, 2 the throw back. At the END of each of the two throws, `0x43c3d0` walks
the goop class's list and flips the tag of every goop that shares the lever's
`param`, with a sound at each of them. Both directions broadcast, so the two
states are symmetrical.

`0x436820(pos, dir)` is the only way either state changes, and it answers only
the throw that suits: direction **0** moves an off lever to on, direction **1**
moves an on lever to off, and a lever already mid-throw is ignored. The player
reaches it through `0x436690`, the chapter's own "what am I standing at" query —
the same one that answers for `ladder`, `exitroom` and `exitfarm`, which is what
says a lever is operated the way a door is. The standing state asks it twice a
frame: once with kind 0 when no direction is held, and once with kind 1 when S
is. So **stopping on a lever turns it on and S is how you turn it off.**

**What comes out of a running nest is a particle system four objects deep.** One
name, `initgoop`, covers five different objects and the creator's first argument
picks between them; the level file only ever asks for the negative one, which is
the nest — an invisible volume that keeps the record's rect and does nothing at
all until its tag is 1. Then, once an engine frame, 42 chances in 512, it drips
from a random point along the top edge of its own rect and tosses for which of
two strings it gets:

```
bead   500 501 502 503   still      its script ends -> a DROP where it hung
drop   504               gravity 1  lands -> gone
strand 510 … 517         still      at cel 517 -> a GOB 70px below it
gob    518               gravity 1  lands -> three SPLASHES, and gone
splash 505 506 504       gravity ½  one random shove, then lands -> gone
```

Every one of them carries a blow of exactly 100 and its own hit handler is `xor
ax,ax; ret`, so goop hits and cannot be hit. But **only one cel of the nine can
touch anything**: 518, the gob, is the only one with a strike box and a blow pair
(`dy 25, dx -1`). The rest is weather.

**And it is the enemies who turn it on, because goop feeds them.** All four of
the gang's hit handlers ask which class hit them before anything else, and goop
is the one answer that is good news: health goes up rather than down, clamped to
what they started with, with a sound and no spray — sixty for the one with the
bat and twenty for the other three. So the level's design is legible in the
records alone. `0x438200` hands a gang member the first unlit lever standing
inside its own patrol rect; it walks over, and one frame of the reach calls
`0x436820(lever, 0)`. Direction zero, always: nothing in the game ever asks an
enemy to turn a lever off. SERVICE places its six levers so that **every one of
them is inside somebody's territory**, which means running east across the level
wakes each keeper in turn and leaves the whole service tunnel pouring behind you.

Its two new classes are the fourth of the gang and the thing at the end. The one
with the knife is the chapter's pattern one more time, sitting exactly where you
would expect between its siblings: 25 health, 240 points, plate 13104 after their
13101, 13102 and 13103. The one at the end is built like the boss of level four
instead — 750 health, a divisor of 13 against the gang's 7, a shove weight
nothing else in the chapter sets, and a walk whose cels carry no stride at all,
so it travels on its velocity. Its hit handler is the only one in the chapter
with **no ignore list**, which means goop, knives and its own allies all land on
it. The level does not wait for it, though: SERVICE's share is chapter two's
ordinary 0.75, so the goal opens on the count and this is simply the biggest
thing standing in front of it.

### SEWER is a map, and its doors are locks

Level seven is where this game stops being a side-scroller. **Thirteen regions**
— an entrance, two vertical shafts, a tube room over the top of one of them, a
sewer under its floor, two halls and a hall of lifts — and you do not walk from
one end to the other. You go down, back west, up, east, down again.

**Five `door` records hold it together, and every one starts shut.** A door is a
wall that can be taken away: `0x435ff0`, called from its own creator, appends the
record's rect to the engine's obstacle table — the same `0x4a89e2` array the
level's walls are read into — and `0x440060` takes it back out at the end of the
opening animation. So a shut door is solid in exactly the way an `obstacle` is,
and an open one is not there at all. Its script is four tags: shut, opening,
open, closing, with the two resting tags waiting for a lever and the two moving
ones doing the table work at the end.

**`0x43c430` is the other half of the switch broadcast.** Level six's levers all
carry a `param` of 500 or more and go to `0x43c3d0`, which flips goop; level
seven's all carry one under 500 and go here, which flips doors. A door is matched
on `abs(param)`, and the sign is only its mirror flag — two of SEWER's five are
simply hung the other way round. And the list it walks is the **stage's**, not
the room's: four of the five levers stand in a different region from the door
they open, and the last of them is a shaft and two rooms away.

Getting that wrong is invisible until it is not. This port stepped its doors
only while the player was in the room with them, so throwing the lever on the
ledge and walking east found the door still on the second frame of its opening
animation, and still solid.

**Three things about the port's idea of a room had to go.**

- *Which region you are in is the rect, not the floor.* `0x40b940(2, point)` has
  no reference to a floor anywhere in it. This page had always asked the narrower
  question — is the point over this room's own ground — because that is what
  keeps a walk from carrying on into nothing. For five levels the two agreed.
  Level seven's regions meet where one floor has ended and the next has not begun,
  and what bridges them is a `platform` laid across the seam.
- *The platforms are the level's, not the room's.* The engine rebuilds one table
  of them every frame — `0x4a69d0`, twelve bytes a row — and searches the whole
  of it. A region owns a floor; it does not own the ledges. The plank across the
  bottom of level seven's last two rooms runs from x6147 to x9471, and filing it
  by its middle left the room next door with nothing under it: the player walked
  west off the foot of its own shaft and out of the world.
- *The edge reservation is tested against the end you are walking at.* Testing
  both ends rejects a move that would improve matters, and a rejected move leaves
  you where you were — a pin, not a wall. At the foot of the first shaft the floor
  begins at x2822 and the west wall is right there, so a player standing at x2860
  could not take a step in either direction.

**The lift never stops.** `initelev` is chapter two's, and not the `initelevator`
of CITY: no cage, no winch, no waiting to be ridden. `0x43d810` is a five-tag
cycle between its record's own top and bottom, and the interesting number is in
`0x43d95d`, which switches on the record's `param` and allows **10, 20 or 40**
pixels a frame going up against a flat six coming down. SEWER's six carry 0, 2,
1, 2, 2 and 0, so they rise at 150, 300 and 600 pixels a second and all sink at
ninety. Like every carrier in this engine each one owns a `platform` record, and
that is what the rider actually stands on.

Its two new classes are a pair of opposites. The floating eye is the first thing
in this port with **no gravity at all** — `0x42f850(obj, 0)`, plus a standing rise
of five pixels a frame written straight into `obj+0xa` — and the flinch it takes
is chosen by the cel it was caught on, so the eye shuts the way it was open. The
other has 600 health, the most of anything here, and **goes round shutting the
doors again**: `0x43f736` passes direction 1 to the same `0x436820` the gang of
level six pass 0 to, after closing to within `0x89` pixels in both axes — the only
reach test in the game that measures the height as well as the distance.

### The six that were placed and not drawn

Across levels one to seven the books place six `init*` names this port had no
class for, and none of them is a fighter: not one enters a census and every one
of their hit handlers is `xor ax,ax; ret`. They are what makes a room a place.

**`initshack`** — eleven of them down CITY, and the smallest state machine in the
game. A shutter that rolls up as your point crosses its record's rect and rolls
down again once you have gone (`0x453a60`). The tag is carried across every
install rather than reset, so the shack's own number survives the cycle, and its
region is `0xffff` — none — so it draws where it stands rather than belonging to
a room.

**`initbarrel`** — five in level seven, and they are **stepping stones**. The
creator calls `0x42fb70` whenever the record's `param` is not negative, which is
the plank's own "claim the platform record my point is inside", and the level
lays one over each of them. So they float in the sewage and you cross on them.
Their wallow is in the script (`dx 22, dy 20` down and `-10, -20` back) and the
think keeps them honest: the horizontal velocity is clamped to ±7 and the barrel
is walked three pixels a frame back towards the x its record gave it.

**`initsewage`** — three, and it is **the only thing in the game that hurts you
for being somewhere**. No art, no hit handler, no health: a rect, a splash when
you land in it fast, a gulp every ninth frame, and `0x402ac0(0xa)` on every frame
your point is inside. Ten a frame is a hundred and fifty a second, which is eight
seconds of wading at the middle difficulty. Behind the damage switch.

**`initpipe`** — four, and one record makes two objects: a mouth on 3400 from the
class, and the thing pouring out of it built by hand at `0x4360dc` and given cel
3530 and the five tags of `0x473608`.

**`initbush`** — eight, and the name is the file's rather than a description. A
58-byte instance struct, a brain table and five animations, hanging **eighty
pixels below** its record's point with a coin-flip facing. What is drawn here is
the state it is in when nothing has happened to it. What it does when you come
near is not, and the reason to be precise about that is two constants:
`0x43ee9d` and `0x43eedb` write **−3** and **−5** into `obj+0x1a`, and a negative
blow strength is not damage, it is a code — the one other negative in the game is
the −6 that level seven's big one swallows at `0x43d25c`. They are grabs.

**`initroachmotel`** — two in MALL, and the level's spawner settles what they are:
`0x43578f` pushes **−1** rather than the record's `param`, so every one of them is
a NEST and never a roach. A nest is invisible and only busy while your point is
inside its rect — a counter climbs, and past −2 it lets a roach out at its own
position, four of them one to eight frames apart, and then thirty-five frames of
nothing before the next rush. A roach falls on cel 3300, waits for the ground
before it does anything at all, runs the four cels of `0x474db0` with `dx 65` on
each, and **removes itself the frame its own point leaves the rect it was born
in** — which is what keeps them in the room.

### ARCADE is fourteen records and one fight

Level eight is the smallest level in the game and the end of chapter two: one
room 1845 pixels wide with a flat floor, one boss, seven sprinkler positions, two
pickups, a `probe` and a `goal` — and the goal is **thirty pixels from where you
start**. Nothing about it is a route. Chapter two's fourth share is the one
stored as zero, so the craft does not come until the room is empty, and the room
is one thing with a thousand health.

**`initkragg` is a global, not a class.** Every other creature in the game is a
class descriptor, a creator and an instance struct; this one is made once at
`0x441bd0` and kept in a pointer at `0x4a6ff8`, with its health in a second
global at `0x4a75c8`. What the level's spawner calls `initkragg`'s creator,
`0x436180`, does not create: it moves the thing that already exists onto the
record's point and installs its idle. Which is why that call is made **once**
rather than once per record.

A divisor of fifty — the slowest thing here — and `0x42f850(obj, 0)`, no gravity
at all, so it hangs where its record put it with the bottom of its body box 115
pixels over the floor. A kick from the ground cannot touch it. And it **pays
nothing**: there is no `0x40d450` anywhere in its code, which no other boss can
say.

Its takes are sorted by one number, `0x2d`: under 45 a random one of the three
single cels of `0x473a28`, 45 or over the six-cel `0x473a48`. And there is a
third kind of blow it tests for before either — a strength of exactly **−9**,
which gets twenty-six frames of `0x473a88` and an extra sound. Minus nine is the
flare, and level eight is the level that places a `statflaregun` and a
`statflare` to throw at it.

**A sprinkler record is not an object.** `0x440800` creates nothing: it walks the
seven records and files each one's point into a seven-entry table at `0x4a7000`
indexed by the record's own `param`, which is why ARCADE's seven carry 0 to 6 and
no two share a number. What comes up is made later, by the boss, with a four-byte
context and a slot marked taken.

**And the trigger is the whole of how the level is won.** `0x441b20` asks which
sprinkler's rect contains the **boss's own point** and `0x441b60` raises that one,
or rolls `0x434540(7)` for a free one if it is already up. The call is inside the
dive and nowhere else. And standing in water that is already up costs the boss
**three health a frame** (`0x440bf9`) — so the room is a fight you win by keeping
it diving into its own sprinklers.

## The boss decides by four distances and its own health

`0x440ab0` is three thousand bytes and the shape of it is four numbers.

Its prologue does two jobs every frame. It **hovers**: a direction of ±1 goes
into the vertical velocity and is reversed at limits that depend on where the
player is — it wants them about 35 pixels below it (`0x473ddc`), allows ±5 while
they are within ten of that and ±9 while they are not. And it **turns**, because
`0x440db6` tests the brain's own forward distance for a negative.

Then `0x45efd0` counts how many of `0x473dc8`'s thresholds — **250, 150, 80** —
are at or above the distance to the player, and `0x441adc` dispatches on the
count:

```
band 0   over 250     0x473850, and it closes at that script's own stride
band 1   150 … 250    0x4738a8, and ONLY when the brain's side is 2, which
                      0x45f00c sets when the player's own velocity is zero:
                      it lunges at someone standing still and hangs back
                      from someone moving
band 2   80 … 150     over two thirds health  -> 0x473900
                      under                   -> 0x473950, the dive
band 3   80 or under  hurt at all             -> 0x473950
                      untouched               -> nothing
```

Which makes the fight legible: it will not come inside 150 of you on its own, it
only dives once you have marked it, and the dive is what turns the water on. Two
things in it are still not driven — the `dy` impulses its scripts carry, and the
`-9` the flare would hit it with — but the machine that decides is here.

### The pickups are one table and one test

A hundred and forty `stat*` records across the sixteen levels, and until now not
one of them was drawn. They are the one system the whole game shares: **one
creator**, `0x45b160`, and **one collector**, `0x45b270`, called from the
player's own think every frame.

Each chapter's init reads its own list of names and hands the creator a NEGATIVE
code — `0x45b19a` dispatches on `code + 9`, so the nine are −9 to −1 — and the
cel and script it picks are all in `PLAYER.SBK` rather than in the level's book,
which is what lets one table cover every level. Two of the nine are in no book at
all (18000 and 18062), and those two are exactly the two no level places:
`statpunch` and `statshield`.

`statscoreup` is **one name and three pickups**. `0x451420` switches on the
record's own `param` and hands −6, −5 or −4 — worth 2000, 5000 and 10000 — which
is why the eleven levels that place one place it with a param.

Collecting is two tests and no button: `0x434140` for a rect overlap and then
`0x40e680`, which compares the two sprites **pixel by pixel**. No facing, no
range band, no action key — you walk into it. And the reach is the record's own
rect, filed at `user+4` by the creator; the art is only what is drawn. This page
does the first test and not the second.

`0x42827a`'s table is what each one does, and every sound comes out of the
CHARACTER's bank (`skulz.snd`) rather than the level's:

```
  -1  stathealth    0x402b20(0x190)      four hundred health, clamped
  -2  statlife      0x40d400(lives + 1)  one life, and 0x40d400 caps five
  -4  statscoreup   0x40d450(0x2710)     ten thousand
  -5  statscoreup   0x40d450(0x1388)     five thousand
  -6  statscoreup   0x40d450(0x7d0)      two thousand
  -8  stattimer     0x40d350(-850)       eight hundred and fifty back on the clock
  -9  (unnamed)     walks the level's `initplayer` records for the one whose
                    rect holds it and stores that index — a CHECKPOINT
```

One thing the records themselves say, once they are on the screen: **STREETS'
first four are on the roofs.** They sit at y914…994 where the street is 1223 and
the top of a jump is 1099, so twenty jumps from the pavement reach none of them.
The level's ladder is not a shortcut, it is the way to the pickups.

The other creator is the guns, and it is below.

### The guns are the other creator, and taking one makes you a different player

`0x45af60` takes the POSITIVE codes, and nothing about it is the pickups' shape.

**It has a button.** `0x4298a1` is the gate — the idle state calls the reach
handler `0x42edd0` only while S is held — and `0x42f081` ducks instead when the
probe comes back empty. One key, two jobs, and which one you get depends
entirely on what is in front of you.

**It has a facing, and a band rather than a rect.** `0x42f017` shifts the
player's own point 35 pixels the way they are looking, and `0x45ae90` asks three
things of it: that it falls inside `x ± 55` — a band the creator writes at
`user+6` and `user+0xa`, unrelated to the record's rect — that the two are
within 150 pixels vertically, and that `obj+0x30` is set, which a weapon still
bouncing after a swap is not.

**And taking one changes the player.** `0x45eed0` sets `0x479438` and the pickup
case installs the weapon's own script; that script's `kind` becomes
`player+0x18`, and `0x4284ed`'s table sends the entire state machine somewhere
else. Five weapons, five kinds, five handlers of about 2,400 bytes each, and
every one of them re-implements the idle, the walk, the run, the jump, the fall,
the landing and the duck in its own cels:

```
  6   blaster    0x471458 kind 22  0x42dbd0   4000s   icon 10304  max 160
  9   flaregun   0x470a78 kind 20  0x42cb80   2700s   icon 10306  max  16
  10  flamer     0x470f98 kind 18  0x42b860   1200s   icon 10307  max 160
  12  soaker     0x471260 kind 19  0x42c1e0   3200s   icon 10311  max 160
  16  scepter    0x470c40 kind 21  0x42d2b0   3300s   icon 10308  max 160
```

The whole table lives at `0x4a7f10 + id * 12` as `{ icon, max, rounds, fire }`,
and it is written by the chapter's own entry function rather than by anything in
the pickup code. `0x40d681` draws the icon and `0x40d6a2` makes the panel's bar
out of `rounds * 64 / max`, so the bar is that table read twice.

**The CHAPTER is the unit, not the level.** The four entry functions —
`0x4511f0` flamer, `0x43bb00` flare gun, `0x421aa0` soaker, `0x416110` blaster —
each zero all 21 rounds counts and name their own weapon, leaving the hands
empty. That is why SEWER places two `statflare` and no gun to fire them with:
you are expected to still be holding SERVICE's. It is also why every `statflamer`
in the rip is in WOODS or CITY and every `statflare` is in MALL, SERVICE, SEWER
or ARCADE — the placement scan and the four init functions agree exactly.

Every callback is three instructions and all seven are the same three: the
weapon, the rounds, the panel. What separates a gun from a refill is one line —
`statblaster` and `statblasterpack` both give 40 rounds, and only the base
weapon's pickup case goes on to call `0x45eed0`. Which is why picking up a tank
with nothing in your hands leaves you with nothing in your hands.

Swapping throws the old one away: `0x42f0dc` calls `0x45b060` the moment you
press S at a gun that is not the one you are holding, spawning your weapon as a
falling object with the player's own gravity, before the reach has even played.
You can only ever carry one. No single level places two kinds, so this only
happens across a chapter.

**The flare is the gun that is built here.** Its fire function `0x436d40` is a
shot and does a number:

```
  436d43  cmp [0x4a7f82], 0        ; rounds left, or nothing happens at all
  436d5e  0x40ef30(mall.snd, 0x49) ; "#0700 flare gun"
  436d6d  0x45ef00(1)              ; one round
  436df0  x = player.x -+ 0x3c     ; sixty pixels ahead, by facing
  436db0  0x430d40(0x474cb8, …)    ; and there it is, at 0x1a = 100
```

The corkscrew is the whole character of it. The spawner files a random 13…29 at
`user+2` and `0x43ac3b` reads it down two at a time, each frame adding that
value to the flare's vertical velocity and flipping its sign — written outright
above 7 and added below it. So a flare leaves the barrel thrashing and
straightens out over about seven frames. It is not aimed and it is not flat.
A masked one is 40 and a knotted one is 50, so one flare is one kill either way.

The other four fire functions are not here, and the reason is not the same in
each case. The **flamer**'s `0x44dae0` is a held stream rather than a shot — its
modes −1 and −2 reach into every live flame to stop it — and the flame's blow
strength is `0xfff7`, **−9**. That is a code and not a number: it is the same −9
the kragg tests for, and what it means is each class handler's own business. The
**soaker**'s `0x41f820` is the same shape, but its droplet does carry a real
number — `0x4217ba` writes the same hundred the flare has — so what stops that
one is the stream rather than the damage. The **blaster** and the **scepter**
belong to chapters this port has not reached.

One fact that fell out of reading all five: **the blaster and the flamer spend
no ammunition at all.** `0x45ef00` appears once in the flare gun's fire function
and twice each in the soaker's and the scepter's, and not once in either of the
other two.

The panel had the other half of this waiting: the special-weapon window at
290,305–380,450 was already painting its plate and its four gauge rows against
an empty hand, because the reading of `0x40d691` came before there was anything
to read. It is wired now — the icon appears while `0x479438` is set, and the
gauge is the weapon record's own `rounds * 64 / max`.

### Chapter three is four levels and eleven classes

GRAVE, CAVERN, RAVECAVE and TOWER share one book pointer (`0x4a6220`), one sound
bank (`belfry.snd`) and one placer — `0x41e450`, which stands up sixteen kinds
of thing by name. Eleven of them were new here.

**The zombie** (`0x41eee0`) is the biggest ordinary creature the game has:
two hundred health against chapter two's 25 and 40, a divisor of 10 against
their 7, and 310 points. Its own blow is a hundred, which is what a flare does.

**The bat** (`0x41ead0`) has a divisor of **1** — the only creature in the game
that divides its script's dx by nothing — and it is frail in the engine's own
sense: `0x4232f0` has no subtraction anywhere in it, so one blow of any size
fells one. It does not count towards a census either, which is why CAVERN's ten
leave its at 19 and RAVECAVE's twenty-seven leave its at 4.

And it comes to you. `0x422f12` reads the brain's forward distance, clamps it to
±27 and writes it straight into `obj+0xc` — the velocity, not the territory. A
rect on a bat's record is an alarm and not a patrol. This port had no model for
that; every foe until now walked its own rect and turned at the edges, and
without it CAVERN's bats hang 180 to 340 pixels over the floor where no jump in
the game reaches one.

**Ghengis** is 200 and 400 points; the **skeleton** is 200 and **450**, the most
any ordinary creature is worth; **Igor** is 200 and 350, and it has a script no
other class has — `0x46fea0`, whose `ticksPerFrame` is zero and whose five
records all carry a negative dx: the walk run backwards and travelling backwards.

**Two bosses, and neither pays anything.** The wraith (`0x41ec80`, seven
hundred health, one in the game) and the bishop (`initvpriest`, twelve hundred —
the same number the player has) both have hit handlers with no `0x40d450` in
them anywhere. Nothing else in the game can say that, and the reason is the
levels: chapter three's last two stages ask for no kills at all (`0x4218ca` and
`0x4218d9` store the whole census as the allowance), so what beating one opens
is the way out rather than a number.

### Two of them kill you without a blow

`initgrave` and `initfloor` have no health, no blow and no hit handler, and both
end with `0x402fa0` — the call that ends the player.

A grave is shut and solid: `0x4210bd` measures how far into its rect you are and
throws you back out by that much. But only on your feet — `0x4210a7` lets a jump
straight through, and that is the whole of level nine's platforming. Come within
a hundred pixels of its point and it opens, and from that frame it **pulls**:
half your speed away and one more unit of fall every frame. Eighty-six pixels
below its point it takes you, and the ground beside a grave is already 98 below,
so standing there when one opens is the whole of it.

A floor is the same thing told upwards: four frames whole, three of
`0120 floor crea[ks]`, six of `0121 floor cave[s in]`, and then it is not there.
`0x42703e` writes 5 into the floor offset and `0x427100` gives what is left
gravity 3.0, three times the player's own.

The **hand** (`0x41f090`) is two hands, and the record's `param` says which:
0 takes the player's own x and comes up under their feet, 1 picks a random x
inside its rect. Each holds on one cel of `0x4704b8`, whose `ticksPerFrame` is
thirty — two seconds a frame, and that pause is the hazard. Its blows are −3 and
−7, codes rather than damage, so it cannot yet take hold of anything.

The **blade** (`0x41ef90`) is a pendulum that does not move: its whole think is
three tags handed round in a ring, twenty-seven cels at one engine frame each, a
blow of a hundred on every one, and its velocity written to zero every frame.

The **bridge** (`0x41e9c0`) you can cross and cannot stand on — `0x4223f5` gives
you five engine frames, or one landing from more than a hundred pixels up — and
the `platform` record laid over it, which CAVERN files rect for rect against
each of its four, goes down with it.

The **surge** (`0x41ec20`) is the only hazard in the game that gives you
something: `0x426b21` is a call to `0x45ef30`, the ammunition adder, followed by
the panel redraw. Its blow is the code −4.

Not built: `initlightfx`, which is the one class in the chapter with no
per-record loop at all — `0x41e473` stores its COUNT in `0x46f644` and never
walks the records, so whatever it is, it is not placed the way everything else
in the level is.

### Chapter four is a factory, and its doors are opened by its guards

MAZE and BARREL share one book pointer (`0x4a5178`), one sound bank (`lab.snd`)
and one placer — `0x410b40`, which stands up twenty-two kinds of thing. Thirteen
of them were new here and eleven are built.

**The TCop** (`initcop`) is what `lab.snd` calls it outright: `#0084 TCop Dies`,
`#0085 TCop eats`, three `#0087..#0089 TCop punc[h]`es. Nineteen of them, seven
in MAZE and twelve in BARREL, at **250 health and 550 points** — the most any
creature outside a boss is worth. It has eleven scripts and two of them are the
same walk in reverse: `0x46c720` tag 0 is 2100…2105 at dx 65 and tag 1 is
2105…2100 at −195, −130, −65, −65, −65, −65. It backs away faster than it comes
on. And it dies two ways: `0x4148ed` tests `obj+0x32`, the accumulated fall, so
one killed off the ground gets a different script.

**The slurp** (`initslurp`) is twenty of MAZE's twenty-seven and worth nothing —
`0x415100` has no `0x40d450` in it. Sixty health, no gravity, and `0x414a36`
gives it a standing vertical velocity of −5, so it drifts upward from the frame
it is made. Its three scripts are three different kinds and **every record in all
three is cel 2550**: whatever state a slurp is in, it looks the same.

**And the cage doors are opened by the cops.** `initswitch` and `initcagedoor`
are SERVICE's lever and SEWER's door told again — `0x46c050` has the same four
tags on the same four cel runs `0x473548` does — but nothing the player can do
throws one. `0x414664` is inside the COP's own think: it walks to a switch and,
within ten pixels, calls `0x412550`, which hands that switch's tag 3 to tag 0.
Level thirteen's guards let themselves out.

What makes a shut cage solid is worth saying, because it is not a special case:
`0x411460` increments `[0x46b9b0]` and appends the door's own rect at
`0x4a89e2 + n * 48` — **the same obstacle table the level's own `obstacle`
records fill**. A closed door stops being a door and starts being wall.

**The alarms and the fans answer to nothing.** An alarm is one sweep and one
sound handed round for ever (`0x412fc0`); a fan keeps its own counter, fifteen
frames still and sixty turning, written into its own user struct by `0x41541d`
and `0x4155ef`. The horizontal one's blades carry a strike box and the vertical
one's do not.

### BARREL is forty-two conveyors and one number

`initbeltleft` (twenty-six) and `initbeltright` (sixteen) share a creator and a
class. Each record is a 278x36 strip, and `0x416840` is one test and one number:
is the player's drawn box inside the strip's band and are they on the ground,
and if so write **0x14 — twenty** into `user+4`.

That it is the BOX and not the point matters. BARREL lays its belts end to end
with a **seven-pixel gap** between one record's right edge and the next one's
left; on a point test you fall down the seam and the ride stops dead. The same
five cels serve both directions, run forwards or backwards, at one engine frame
each out of `0x46c0d8` or three out of `0x46c188` — and the record's own `param`,
4, 6, 8 or 10 across the forty-two, is what picks.

Ten `statblasterpack` stand in the level and there is no `statblaster` anywhere
in it: chapter four names the blaster on the way in and the gun itself is in VAT,
two levels later.

**The claw** (`initclaw`, four of them) is a carriage on a rail that follows
you: `0x417344` and `0x417376` clamp its velocity to ±26 and `0x417316` clamps
its position to its own record's bounds, so it tracks the player along a 582-to-
1410 pixel track and cannot leave it. `0x417289` then measures the gap — inside
300 it reaches down, past 600 it waits, and between the two it runs, playing
`#0100 claw wizz` as it travels and `#0101 clawclamp` as it shuts. Its first
blow is a hundred and its second is the code −3, so a claw here can hit you and
cannot take hold of you.

Not built, and said so: **`initbiggun`** (two, a plasma turret — `lab.snd` 3 is
`#0050 Plasmagun`), and chapter four's own **`initbarrel`**, which is not an
object at all: `0x411c50` writes eight bytes per record into a table at
`0x4a89b0` and a count into `0x46dc50`, so those three records are data for
something else rather than things in the level.

### LAB and VAT, and all sixteen levels stand

LAB is three new classes and `lab.snd` names all three. **Puke Boy**
(`initpuke`) is four hundred health and 440 points, and its run is the only
alternating stride in the game: `0x46cac0` tag 0's eight records carry 186, 93,
186, 93, 279, 93, 279, 93. **The arm** (`initarm`, ten of them) has no health at
all — `0x418b40` sprays, sounds, pays 113 and subtracts nothing, so one blow of
any size fells one, and it does not count. **The test tube** (`inittube`, one in
the game) carries twelve hundred, the player's own number, and pays nothing.

VAT is seven showers, two balls, a set of teeth — all one cel apiece — chapter
four's own gun, and BOGGS.

**The `statblaster` is in VAT and in no other level.** MAZE, BARREL and LAB place
fourteen `statblasterpack` between them and nothing to put them in; the gun
itself is 5815 pixels into the last level of the game.

### Boggs is four thousand and it heals faster than a fist

The last thing in the game is four objects — `initboggsbody`, `initboggshead`,
`initbgclawarm` and `initbgmachinery`, the last of which stands up eight more
with eight scripts of its own.

A first reading of its hit handler here said three things and got two of them
backwards, so this is the corrected one:

```
  41bc57  0x41aad0(striker)               ; a FRIENDLY-FIRE filter, nothing more
  41bc6a  cmp word ptr [edi+0x1a], -1
  41bc71  mov word ptr [edi+0x1a], 0x64   ; -1 is TRANSLATED to a full blow
  41be68  cmp [0x46e080] / [0x46e084]
  41be7c  add word ptr [0x4a50e8], 0x1e   ; +30 a frame while a flag is SET
  41be84  0x40e300(0xfa0)                 ; clamped to FOUR THOUSAND
```

`0x41aad0` turns a blow away only when the striker is one of Boggs' own four
parts, a member of either of its two object lists (`0x46e0a8`, `0x46e0ac`), or
showing a cel in 5900..5996 — which is Boggs' own range and the player's
reaction cels. **A fist is none of those, so a punch lands.** What makes it the
boss is arithmetic: four thousand health, three times TOWER's bishop, healing
thirty a frame against a punch worth about fifty.

And -1 is not a requirement, it is a conversion. What actually carries -1 is the
BLASTER's bolt — `0x413af0` maps the variant the bolt remembers to its strength,
and variants 1..3 all give -1 while the blaster fires with 2 and 3. So the bolt
is worth a full hundred to Boggs and **nothing at all to anything else**: every
ordinary handler treats a strength below 1 as no damage (`0x4199b9`). That is
what the gun in its room is for, and it only works because the codes are
carried at all.

And the healing is not a phase Boggs enters — it is how it starts:

```
  0x46e080:  01 00 00 00  01 00 00 00     ; both flags SHIP as 1, in .data
  41b611     mov word ptr [0x46e080], 0   ; cleared once, by the CLAW ARM
  41b75d     mov word ptr [0x46e084], 0   ; ...and once more, same function
```

Those two writes are the only ones anywhere in `.text`, and nothing ever sets
either flag back. So the thirty a frame runs from the moment the level opens,
and the fight is a sequence rather than a damage race: the claw arm's own
machine (`0x41b250`) has to turn the healing off twice before four thousand can
be taken off at all. Forty bolts of a hundred is exactly that four thousand, out
of the blaster's hundred and sixty rounds.

What is here is the body, its four thousand, its thirty a frame and the bolt
that lands a hundred on it. The head, the claw arm and the eight machinery
objects are not — so on this page the healing never stops, which is faithful to
where the game starts and is why Boggs cannot yet be killed.

### A record belongs to one room

`0x40b940`'s kind 2 walks the region table and answers with the FIRST region
whose rect contains the point. Rooms overlap — that is how you walk out of one
and into the next — and a creature standing in a seam was being spawned once per
room it fell in. BARREL's two regions overlap x7464…7691 and its cop at x7521
stands in that seam, so a level of twelve had a census of thirteen and a kill
quota that could never be met. Each record is claimed once now, first room wins.

### The mission clock was a record all along

Every chapter's entry function ends with the same block. `0x421e60` is chapter
three's, and `0x4164a2`, `0x43be72` and `0x451582` are its three siblings:

```
  421e8f  mov  eax, [esp]        ; the first `timer` record, and +0 is its PARAM
  421e94  call 0x40d340          ; -> [0x4a3b18], the dial's full scale
  421e99  mov  eax, [esp+4]      ; esp moved under the push: the SAME dword
  421ea1  call 0x40d350          ; -> [0x4a4d68], the clock itself
  421ead  push 0x7d00            ; no record at all: both get 32000
```

One number does both, and it is the record's own `param`. Eleven books carry a
`timer` and five do not, and the five that do not have **no time limit** —
`0x40d250` reads 32000 as "no dial":

```
  streets 4000   city 8200   woods 7200   playgr    —
  mall    5220   service 5300  sewer 7200  arcade   —
  grave   2100   cavern   —   ravecave 2500  tower  —
  maze    3200   barrel 8200  lab 2500    vat      —
```

This page had been giving all sixteen the full dial, which is 7200 and so right
for WOODS and SEWER by accident. The five without a record are exactly the five
you would expect: the two whose bosses the level waits for, and chapter three's
and four's last stages.

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

## A negative blow is a message, and the grip is the drawing

`obj+0x1a` is what an object hits with, and every ordinary value is a
percentage: `0x42f910` scales the striking cel's own `(dy, dx)` by it and the
victim subtracts the magnitude. A hundred is a full blow and is what almost
everything carries.

The player's handler reads the SIGN first, and a negative never reaches that
arithmetic at all:

```
  448c6e  mov   ax, [esi+0x1a]        ; the striker's own strength
  448c72  test  ax, ax
  448c75  jge   0x449035              ; >= 0 -> take the damage
  448c7b  movsx eax, ax
  448c7e  add   eax, 8                ; -8..-1 becomes 0..7
  448c81  cmp   eax, 7
  448c84  ja    0x449035              ; -9 and below -> take the damage
  448c8a  jmp   dword ptr [eax*4 + 0x4492b8]
```

So there are exactly eight codes, because the range test says so, and they are a
dense enumeration the engine jumps through rather than a scattered convention.
`0x4492b8` is the whole list, index 0 being −8:

```
  -8  0x448c91  knocked flying    9550..9558, +-50 into vX, a 0x78 shake
  -7  0x448d24  floored           the same knockdown a hard blow gives
  -6  0x448d72  flattened         and NOTHING in the game sends it
  -5  0x448dae  slumped           half gravity
  -4  0x448df4  shocked           9700..9702 out and back, then the knockdown
  -3  0x448e90  GRABBED           no gravity, no velocity, and held
  -2  0x448f06  jolted            unless you are crouched or on the board
  -1  0x448f7c  spun              and it is also the only thing Boggs takes
```

Getting that census right needed the disassembler pointed differently. A sweep
in overlapping windows can begin mid-instruction, and everything it decodes
after that is nonsense it prints without complaint: it lost `0x420da6`, the
hand's own grab, and `0x420e3b`, the other one. Decoding each function from its
entry to the next cannot desync inside a function, and the honest list is

```
  -1  0x413bf9  0x41b022                       the Boggs machinery, only
  -2  0x4201e4  0x43dbda  0x4421cb  0x44236d
  -3  0x41745c  0x420da6  0x424c21  0x43ee9d   claw, hand, wraith, bush
  -4  0x426a90                                 the surge
  -5  0x43eedb  0x43eefa                       the bush, once you are dying
  -7  0x420e3b  0x420e4e                       the hand, out of its rect
  -8  0x418dce
```

**Seven of the eight have a sender and -6 has none.** Its slot is real and its
reaction is written and no object anywhere reaches it. And −9 is not in this
alphabet at all: it falls below the range test, lands on the player as ordinary
damage, and is read instead by five handlers of their own — `0x44f0aa`,
`0x4520d8`, `0x4547b3`, `0x4550d3`, `0x455763` — which accept nothing else. The
flare carries it, and conditionally: `0x43abf0` sets its strength to −9 rather
than 100 when the global at `0x4abdfc` is 5.

### How a grab actually holds you

The neatest thing in the engine. `0x428080`'s kind-10 case reads the GRABBER's
current cel record at +4 and +8 — which is the cel's **strike box**, the same
rect that decides whether a blow connects — translates it by the grabber's own
point with `0x434270` (a plain add, no mirror, no band) and plants the player at
its centre:

```
  4285b8  cmp [0x4a693a], ax   ; x0 == x1 -> let go
  428660  x = x1 + (x0 - x1) / 2
  428689  y = y0 + (y1 - y0) / 2
```

So the grip is authored per frame, in the art, and the grab ends when the artist
drew a frame without one. Nothing else is stored: no timer, no distance, no
"grabbed" flag on the grabber. The books confirm it exactly. Of the thirteen cels
the hand's three scripts name, only 1556 and 1562 — the two CLOSED ones — carry
a strike box, and theirs are `y -27..-1, x -32..31` and `y -34..-4, x -18..20`: the fist itself.
Of the fifty-two the claw's six scripts name, only 2456..2459 do, `y 77..111,
x -76..0` and three more like it: the jaw hanging below and behind its anchor.

Which makes the one thing that has to be got right in the port the one thing
easiest to get wrong: the grip must be **re-read every frame**. Reading it once,
at the moment of the grab, gives a hold that never ends — the hand sinks back
into the ground and the player stays pinned in mid-air where it used to be.

Two details that are the original's own. `0x4286cf` lets P restart the struggle
but only from the loop's tag 0, so mashing it does not stack and nothing in the
state shortens the hold. And the reaction installs `0x476698` — cels 9570..9572
— while the held state that follows it loops `0x4720e8`, the same script in
4570..4572; the disc has two playable characters with a sound bank each, which
is the likeliest reason, and this page plays what the two functions literally
say.

### What it unblocks, and what it does not

The hand grabs and lets go, the surge shocks, the knockdown from out of a hand's
rect lands, and none of it spends a point of health — which is why a code comes
through with the damage switch off. A code is a message.

It does not make Boggs killable. The only two things in `SC.EXE` that send −1
are `0x413bf9` and `0x41b022`, both inside the Boggs machinery, and `0x41afd0`
gates its −1 on the two flags at `0x46e080` and `0x46e084` that the same machine
sets. The head, the claw arm and the eight machinery objects are still not here,
so the code that would hurt it has nothing to come from. That is the machine's
gap, not the codes'.

BARREL's claw does not grab yet, and the reason is worth writing down because it
is not the one it looked like. `0x4171e0` is a **seven**-kind machine over six
scripts, and this page has the right ones: the creator starts it on kind 6
(`0x46dc58`, one cel), the player entering its rect sends it to kind 0
(`0x46dc78`, the carriage), and inside 300 pixels kind 0 installs `0x46dd80` —
kind 4, cels 2420..2426 — which is exactly what is ported.

**The claw grabs now.** What follows is the reading that got it there, and one
position bug it turned up.

The grabbing kind is reached from somewhere else, and reading the one function
in the way settles it. The creator registers a TRACKER at `0x411d23` —
`0x45ef70(&user[0x12], claw, player, 0x46dfc8)` — and `0x45efd0` answers it each
frame with the gap between the two objects, which way the target is moving, and
a BAND index. `0x46dfc8` is the band table and it is three numbers:

```
  b4 00  8c 00  64 00  00 00        180, 140, 100, and a zero to stop
```

The index is how many of them the gap is still past: over 180 is band 0, 140 to
180 is band 1, 100 to 140 is band 2, and 100 or nearer is band 3. `0x41734a`
dispatches kind 0 on exactly that — band 0 slows the carriage down, band 2
installs `0x46de08` tag 0 and band 3 its tag 1, and those two tags are the only
route to cels 2456..2459, the only four of the claw's fifty-two that carry a
grip.

So the claw reaches for you at 140 pixels and commits at 100. Kind 1's own tag
machine is four tags and `0x41743d` is the whole trick:

```
  41743d  tag 1 ends: obj+0x2a set -> tag 2 and blow -3
                      else        -> tag 3, straight back up
  417485  tag 2: blow -3 every frame; ends -> blow 0, tag 3
  4174c7  tag 3 ends -> kind 0, the carriage again
```

The DIVE is an ordinary hundred — `0x417208` writes it at the top of every think
and only the clamp overwrites it. So the jaw hits you for a real blow, that is
what sets `obj+0x2a`, and the grab is what follows from it. Which also means the
contact has to be read off the COLLISION and not off the damage: the jaw cels
carry a strike box and no blow pair at all, so a port that asks "did this hurt
anything" would watch the claw touch you and go back up.

And it could not have reached anybody anyway, because this page had it hanging
in the wrong place. `0x411ca0` files three of the spawner's dwords into its user
struct and `0x4173d1` clamps its x between `user+2` and `user+6` — which can
only be left and right, so `user+0`/`user+4` are top and bottom. `0x4173c9`
writes `user+4` into `obj+6`: **it hangs at the record's bottom, not its point.**
On BARREL's fourth claw that is 7221 against the point's 7044, and since the jaw
box sits 77..111 below the anchor, the difference is the whole of whether it
closes on your chest or 40 pixels above your head.

## Five weapons, and three of them pour

Each weapon owns a state machine and a fire function, and the table at
`0x4a7f10 + id * 12` is how they meet: `{dword icon, word max, word rounds,
dword fire}`, with the fire pointer at +8.

```
   6  blaster   state 0x42dbd0   fire 0x412a70   script 0x471458   cels 4000s
   9  flaregun  state 0x42cb80   fire 0x436d40   script 0x470a78   cels 2700s
  10  flamer    state 0x42b860   fire 0x44dae0   script 0x470f98   cels 1200s
  12  soaker    state 0x42c1e0   fire 0x41f820   script 0x471260   cels 3200s
  16  scepter   state 0x42d2b0   fire 0x41f6b0   script 0x470c40   cels 3300s
```

A state machine dispatches on the TAG the player is on (`movsx eax, [eax+0x44]`)
and calls its weapon's fire function with a small number — the VARIANT — which
every fire function reads its own way. Tag 2 is the standing shot and tag 6 the
ducking one across all five, and the flamer and soaker send `-2` from the tags
either side of those, which is how a stream knows to stop.

### The three that pour

The flamer, the soaker and the scepter do not launch anything. Each adds an
object to a list the player owns, and `0x421700` plants it fresh every frame:

```
  42170a  if (player mirrored)  x = player.x - user[+4]
  42171e  else                   x = player.x + user[+4]
  42172f  x += player.vx          ; ...and it leads your own motion
  42173b  y = user[+2] + player.y + player.vy
```

So a stream is not fired and forgotten, it is redrawn where you are — which is
why walking while you hold the button sweeps it across a room. Two negative
variants end it: `-2` walks the list installing the shutting-off tag, and `-1`
writes the expire kind straight into every member. The player's own hit handler
sends that `-1` before it has even looked at the blow (`0x448c19`, `0x448c40`),
so **being hit puts your flamethrower out**.

They cost a round an engine frame (`0x45ef00(1)`), which makes a full hundred
and sixty about eleven seconds of flame — against the scepter's **forty a
shot**, four shots and no more. RAVECAVE's `statscepter` files no rounds at all,
so what you get is the single round `0x45eed0` gives for arming you, one beam,
and an empty gauge.

### ...and they do not all hit with the same thing

```
  0x4217ba   soaker    mov word ptr [edi+0x1a], 0x64    ; a hundred, every frame
  0x424630   scepter   mov word ptr [ecx+0x1a], 0x64    ; a hundred
  0x453b9b   flamer    mov word ptr [esi+0x1a], 0xfff7  ; MINUS NINE
```

Two of the three are ordinary damage; the flame is a code. And -9 is the one
code that is not in the player's own table — it falls below `0x448c84`'s range
test — so what reads it is five handlers of their own (`0x44f0aa`, `0x4520d8`,
`0x4547b3`, `0x4550d3`, `0x455763`) which accept nothing else. Like the
blaster's bolt, the flamethrower is a key rather than a weapon, and a full gauge
of it kills nothing in any of these sixteen levels.

The damage, where there is any, is small and comes from the art: `0x42f910`
scales the striking cel's own `(dy, dx)` by the object's strength, and the
soaker's 9806 carries `dx 8`. Eight a frame, so a two-hundred-health zombie
takes about twenty-five frames of water.

### INV is a holster, and there is no inventory screen

This repo carried a gap that said "the inventory screen behind `0x42edd0`'s
message 1 is not here", and both halves of that were wrong. `0x42edd0` message 1
is the CROUCH state — it reads the keys, probes 0x23 ahead for a pickup and
installs `0x4717c8` — and there is no inventory screen anywhere in `SC.EXE`.

What the fourth button on the lower band actually does is two instructions, and
all 81 of its readers are the same two:

```
  4298c0  cmp word ptr [0x4ac386], 0
  4298cf  mov word ptr [eax+0x18], 0xf     ; ...every player state, armed or not
```

State 15 is `0x428975` and it is four lines long. While the button is held it
stands you on `0x471648` tag 0 — the plain unarmed idle, the one that breathes —
and reads no direction at all, so you cannot walk. When the button comes up it
reads `0x479434` and dispatches through the map at `0x429624` to put you back
into the idle of whatever you are carrying: `0x471458` for the blaster,
`0x470a78` for the flare gun, and the unarmed idle for anything that is not one
of the five.

So it is a holster. You put the gun away to look at yourself, and taking your
finger off draws it again — nothing is spent, nothing is swapped, and no screen
is drawn. Finding that out cost less than building the screen would have, which
is the argument for reading the executable before believing a gap.

### The thing in the water comes up, and cannot reach

`0x43ec80` is three phases and a rect, and all of it is built now:

```
  43ecf3  |player.x - bush.x| <  0x46    ; seventy across
  43ed0c  |player.y - bush.y| < 0x12c    ; three hundred down
  43ed28  0x45d090(bush, 0x472c20, 0)    ; ...and up it comes
  43eea3  [esi+8] = player.x             ; sliding under you as it rises
  43ef4a  y += 0xa                       ; ten a frame back down afterwards
```

Its thirteen cels split exactly the way the hand's and the claw's do: 5020..5025
carry no strike box, and 5026..5032 each carry a big one with no blow pair. So
the first six are it breaking the water and the last seven are it closing, and
the frame it closes is the frame it has you — the same authored grip, a third
time.

What does not work is the reach. The creator puts it at the record's point plus
eighty (`0x435bf7`), which on SEWER's three hall bushes is y 17321 against a
floor at 17513, and its grip tops out 200 pixels above the player's feet. That
is consistent across all four bushes measured — 190 to 215 — so it is systematic
rather than one bad record, and it is either the floor under that hall or the
bush's own y. Left as it reads rather than nudged into working.

## Two tests, and an ending

### A pickup is taken on the ART, not the box

`0x45b270` intersects the two rects with `0x434140` and only then calls
`0x40e680`, which is the second test and the real one. That walks the
intersection looking for a row where BOTH cels have an opaque span — and it is
spans rather than pixels because that is how the SHP stores a row, which is why
`0x4320c0` compares span lists and never touches a pixel value.

The difference is not academic. The player's cel is a tall rectangle with a
great deal of nothing in it: STREETS' `statlife` runs 3629..3729, and standing
at 3600 or 3760 overlaps that rect by a pixel or two while touching none of the
art. The rect alone hands you the life; the art does not, and the suite asserts
exactly that pair of positions.

One detail worth keeping: the point `0x40e680` hands back is the centre of the
RECT intersection (`0x40e782` reads back what `0x434140` wrote), not the centre
of the pixels it found. So the pixel walk only ever answers yes or no, and can
stop at the first row that touches.

### ...and the sixteenth level is the end

`0x402fe0` is the game's outer loop: eleven states through `0x403448`, of which
1 is the title menu, 3..6 are the four chapters, 9 is the death vignette, 10
goes back to the menu and 11 quits. Chapter four is state 6, its runner is
`0x412670`, and the last of the scenes it walks is four instructions:

```
  41293d  cmp word ptr [0x4abdfe], 6   ; nothing else has taken the game away
  41294c  push 0x46b388                ; "credits.mov"
  41295a  call 0x40e990                ; ...play it
  412962  mov si, 1                    ; and that is the chapter loop over
```

`si` ending the loop returns to `0x4032a2`, which finds the outer state is not
one of the five that would claim the game, sets the scene to 0 and goes to state
1. So finishing the sixteenth level plays the credits and puts you back at the
front.

`credits.mov` is also the menu's own option 6 (`0x4030f7` plays the same file),
so the film being in the rip was never evidence of an ending on its own. What
makes it one is `0x41293d`.

## The wraith works its own bands, and its code is dead

`0x424800` is a machine this page fought without. It reads the same TRACKER the
claw does — `0x45efd0` on `user+0xe` — and bands the gap against `0x46f8f8`:

```
  bc 02  e6 00  82 00  3c 00  00 00      ; 700, 230, 130, 60
```

Four thresholds, five bands, and `0x424f1c` sorts them into four behaviours:
over 230 it closes on you, 130..230 and 60..130 are where it fights, and inside
sixty it does nothing at all but hang there (`0x424c07` installs the standing
hover and nothing else). Which move it picks when it fights is `0x434540`'s.

The best of it is `0x424d77`: the wraith's cast calls **`0x41f6b0`**, the
scepter's own fire function, variant 0 — the one that spends no rounds. The
thing you take the scepter from in RAVECAVE casts it at you first.

### ...and the -3 is dead code

`0x424c54` is the first instruction of its kinds 2 and 3 and it writes -3 into
`obj+0x1a`, which reads exactly like the grab the hand and the claw carry. It is
not. `0x4248a9` is the function's ONLY exit:

```
  4248a9  xor ax, ax
  4248ac  pop ebp
  4248ad  mov word ptr [esi+0x1a], 0x64     ; ...a hundred, every path, every frame
  4248b3  pop edi / pop esi / pop ebx / ret
```

Both -3 writes are overwritten before the function returns, so the wraith hits
like everything else. This was built the wrong way round first, and what caught
it was a measurement rather than a re-reading: **two hundred and sixty kicks
took nothing off it**, because a wraith that grabs on contact locks the player
out of fighting entirely. With the code removed it falls in eighteen.

That is the fourth time in this port that a `mov` read without its exit path
gave the wrong answer — see Boggs' -1 and its two flags, and the inventory
screen that was not one.

## The bishop rolls for it, and Boggs lunges

Two more machines this page fought without, both on the same tracker the wraith
and the claw use.

**The bishop** — `0x425c90`, banded against `0x46f4c0`: `dc 00 aa 00 64 00`, so
220, 170 and 100. Dormant until the player's point is in its rect, then it walks
in on its 2500s and rolls:

```
  425e56  band 1       -> 0x434540(10) < 3, or nothing at all
  425e64  band 2 or 3  -> always considers
  425e8c  0x434540(0x2a) <= 13 -> tag 2, the sixteen cels
                         else  -> tag 0, the throw
```

Three in ten at the far band, always inside 170, and then thirteen in forty-two
for the sweep over the throw. The throw's recoil is `0x46f1c0` tag 1 carrying
dx -30, -20, -10 — authored into the animation rather than applied to it.

**Boggs** — `0x41be50` rolls once a frame while its kind is 0 and seven of the
forty-two take it, toward whichever side the player is on:

```
  41bffc  0x434540(0x2a)
  41c006  cmp eax, 7 / jge              ; seven in forty-two
  41c010  cmp word ptr [eax+0x18], 0    ; ...and only out of the idle
  41c047  cmp [player+8], [0x4a50e0+8]  ; which side -> which tag
```

`0x46e6d8` carries the stride: three records of 470 through the largest divisor
in the game, which is under five pixels a frame. One in six a frame against a
twenty-seven frame lunge means it is moving about four fifths of the time, which
is why its idle had to be sampled four times as often to be seen at all.

Its head, its claw arm and its eight machinery objects are still not here, so
the healing never stops and it still cannot be killed — see the section above
for why that is the game's own arithmetic rather than a gap.

## What is not here

All sixteen levels stand, and this is what is missing from them. The numbers are
counted from the books and the executable rather than remembered.

### The records

**1,137 of the 1,166 entity records in the sixteen books are placed — 97.5%.**
The 52 region records are all handled. Six levels have no gap at all: PLAYGR,
SEWER, GRAVE, CAVERN, RAVECAVE and BARREL.

```
  probe            17   streets city woods mall service arcade
  initbgclawarm     1   vat          initboggshead      1   vat
  initbgmachinery   1   vat          monkeybar          1   vat
  wormbounds        1   vat          initlightfx        2   tower
  initbiggun        2   maze         noskateboards      1   service
  where             1   lab          inithealth         1   lab
```

Four of those are not art at all — `probe`, `monkeybar`, `wormbounds` and
`noskateboards` are TABLES. `0x40b526` fills a buffer at `0x4a9ce0` with every
`probe` record and keeps the count at `0x46b9c0`; `0x4280d2` tests the player's
own point against one of them each frame and, on a hit, calls `0x410170` and
consumes it. What that call does has not been read.

And two of them are dead data. **`where` and `inithealth` do not appear in
`SC.EXE` anywhere** — LAB places one of each and nothing in the game will ever
ask for them.

### The classes

**64 of the 70 `init*` classes the levels place are built.** The six that are
not are `initbiggun`, `initlightfx`, and the four-object Boggs machine less its
body.

The executable registers **73**, and four of them exist in the game with no
level placing one: `initbeltboth`, `initdoor`, `initpainting` and
`inittirepile`. `inithealth` is the same thing the other way round — a name in
a level with no class anywhere.

### The systems

- **All five weapons fire now**, and the INV button with them — see the section
  above. There was never an inventory screen to build.
- **The blow codes are carried, and so is the claw.** SEWER's bush has its three
  phases and its thirteen cels now too, but its grip does not reach: it sits
  about 190 pixels above where this page stands the player, at all four of the
  bushes measured. Either the floor under that hall is wrong here or the bush's
  own y is, and which of those it is has not been settled.
- **Two bosses of five have their own state machine** — PLAYGR's `initwbooly`
  and ARCADE's `initkragg`. RAVECAVE's wraith, TOWER's bishop and VAT's Boggs
  stand, take blows and die on the generic gait/flinch/death every other
  creature uses.
- **Both of the two tests are here now**, and so is the ending — see the two
  sections above.
- **Damage is off by default**, because with it on a probe walking east through
  WOODS meets three hydraulic presses and every route test here becomes a fight.

## Where the pieces are

- `skullcracker/` — the page, its file store and its film loop
- `engine/src/df/byte-order.ts` — which way round a file is, and how it is asked
- `engine/tests/byte-order.ts` — detection (needs no rip) and the menu (needs one)
- `skullcracker/tests/browser/menu.ts` — the menu in a real browser
- `engine/src/df/sbk.ts` — the sprite book reader, and `engine/tests/sbk.ts`
- `skullcracker/src/props.ts` — the level's machinery: the plank, the lift, the crow, the press, the lever, the goop, the door and the scenery that moves
- `skullcracker/src/foes.ts` — what each `init*` name is, and the numbers behind it
- `skullcracker/tests/browser/city.ts` — CITY's opening, in a browser
- `skullcracker/tests/browser/lift.ts` — CITY's five lifts, and the ride to its goal
- `skullcracker/tests/browser/woods.ts` — WOODS' population, its two steps and its goal
- `skullcracker/tests/browser/playgr.ts` — PLAYGR's statue, the fight and the television
- `skullcracker/tests/browser/damage.ts` — the switch that lets things hit back
- `skullcracker/tests/browser/mall.ts` — MALL's three regions, its population and its machines
- `skullcracker/tests/browser/service.ts` — SERVICE's two new classes, its six levers and what they pour
- `skullcracker/tests/browser/sewer.ts` — SEWER's five locks, its lifts and the way through its thirteen regions
- `skullcracker/tests/browser/arcade.ts` — ARCADE's one boss, out of reach until you jump at it
- `skullcracker/tests/browser/pickups.ts` — the `stat*` records, and what each one gives
- `skullcracker/tests/browser/guns.ts` — the weapons, the reach that takes one, and what a flare does
- `skullcracker/tests/browser/grave.ts` — GRAVE's zombies, its graves and the hands between them
- `skullcracker/tests/browser/cavern.ts` — CAVERN's four creatures, its blades and its bridges
- `skullcracker/tests/browser/ravecave.ts` — RAVECAVE's Igors, its one wraith and its scepter
- `skullcracker/tests/browser/tower.ts` — TOWER's floors, its bishop and its surges
- `skullcracker/tests/browser/maze.ts` — MAZE's cops, its cage doors and the switches they throw
- `skullcracker/tests/browser/barrel.ts` — BARREL's forty-two conveyors and what rides them
- `skullcracker/tests/browser/lab.ts` — LAB's Puke Boys, its ten arms and its one test tube
- `skullcracker/tests/browser/vat.ts` — VAT's furniture, its one blaster and Boggs
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
