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
against; the Windows one came later and is the reason several findings in these
pages are *confirmed* rather than argued — most of all the palette one, which had rested on
a single frame.

- [The sixteen levels](levels.md) — what each level places, the population it
  carries, and the shape of the four chapters
- [Fighting, and the things that fight](combat.md) — one tracker, one blow, one
  grip, and the bosses that keep state of their own
- [Weapons and pickups](weapons.md) — five weapons, a holster, and a table read
  off the art rather than off the box
- [The menu, and everything before a level](menu.md) — the film layer, which is
  the completely DreamFactory half of this disc
- [What the executable runs while you play](systems.md) — the camera, gravity,
  ladders, the clock, the save game and the collision test under all of it
- [How it is checked](verification.md) — thirty-six browser suites, and why they
  run in one process

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

## What is not here

All sixteen levels stand, and this is what is missing from them. The numbers are
MEASURED — `npx tsx skullcracker/tools/records.mts` reads every book and checks
each record's name against what the page actually looks for — because the figure
that used to be here was counted once by hand and every level built since made it
a little more wrong.

### The records

```
  1162 of 1167 entity records placed - 99.6%. 52 region records, all handled.

  where              1   lab
  inithealth         1   lab
  noskateboards      1   service
  monkeybar          1   vat
  wormbounds         1   vat

  no gap at all: ARCADE BARREL CAVERN CITY GRAVE MALL MAZE PLAYGR RAVECAVE
                 SEWER STREETS TOWER WOODS
```

**Five records are left and not one of them is a drawn thing.** Three are
TABLES — `monkeybar`, `wormbounds` and `noskateboards`. And two are dead data:
**`where` and `inithealth` do not appear in `SC.EXE` anywhere** — LAB places one
of each and nothing in the game will ever ask for them.

### What a probe is, and the word that was hiding in the constructor

`0x40b526` fills a buffer at `0x4a9ce0` with every `probe` record, 48 bytes
apiece — the entity record's own stride — and keeps the count at `0x46b9c0`.
`0x4280d2` then walks that buffer once a frame:

```
  4280f8  0x434200(player.pos, rec+2)   ; the record's RECT, point-in-rect
  42811d  ax = word at rec+0            ; ...and its param is a MODE
  428128  0x410170(player.pos, mode, mode, &0x4a6938)
  428138  0x402e80(i)                   ; and the record is consumed
```

`0x402e80` shifts the rest of the table down over it, so a probe fires **once per
level load** and never again. The seventeen shipped ones carry four values
between them — 0 eight times, 1 four, 2 three and 3 twice.

`0x410170` is the same spawner the goal's television comes out of, switched on
`mode + 1`, and all four probe modes build on `PLAYER.SBK` rather than the
level's own book — which is why no level book carries the cels:

```
  mode 0/1  0x41023c  script 0x46bdf0 tag 0 - cels 20200..20207, dx 15
            X += mirror ? +512 : -512, and the mirror IS the mode
  mode 2    0x41029c  script 0x46bdf0 tag 1 - cels 20210, 20211
            Y += 0x100 below you, vY = -10
  mode 3    0x4102fc  same tag, Y -= 0x100 above you, vY = +10
```

20210 and 20211 are the television's own hovering cels, so modes 2 and 3 are it
arriving from under your feet or down out of the sky, and 20200..20207 is
something else crossing.

**What held this up was one word, and it is in the class's constructor.**
`0x45d1a3`'s mover, `0x42f8b0`, does `idiv [obj+0xe]` twice; `0x42f550` zeroes
that word, `0x410170` never writes it and `0x45d090` writes only the kind. A
shipped game does not divide by zero, so something had to — and it is the
message every new object on this list gets. `0x430cc0(0x4103c0)` builds the list
and `0x4103c0`'s case 1 writes **1** into `obj+0xe`, along with the book
(`0x4abe10`), the first cel, no gravity and no bounce. A divisor of one divides
nothing: the script's own `dx` goes into the velocity whole.

The rest is `0x410480`, which is three comparisons and a clamp — 27 pixels a
frame across, 23 up or down, and gone once it is half a screen past you
horizontally or a quarter of one vertically. None of the ten cels carries a
strike box, so a flypast cannot touch you: it is scenery with a trigger, and
CITY's own step in `tests/browser/city.ts` watches one cross and one rise.

### The classes

**Every `init*` class the levels place is built.** `initbiggun` and
`initlightfx` were the last two — [see them in Fighting](combat.md#a-hatch-in-the-ceiling-and-a-fork-of-lightning) — and before them Boggs'
`initboggshead`, `initbgclawarm` and `initbgmachinery`.

The executable registers **73**, and four of them exist in the game with no
level placing one: `initbeltboth`, `initdoor`, `initpainting` and
`inittirepile`. `inithealth` is the same thing the other way round — a name in
a level with no class anywhere.

### The systems

- **All five weapons fire now**, and the INV button with them — see
  [Weapons and pickups](weapons.md). There was never an inventory screen to build.
- **The blow codes are carried, and so are the claw and the bush.** What had
  looked like a bush hanging 190 pixels too high was every prop's strike box
  being lifted by `height - posY`; `0x40e680` translates the rect by the object's
  own position and does nothing else. The bush grabs, and BARREL's claw is back
  on the record's point that `0x411cfd` gives it rather than the rect bottom it
  had been nudged to.
- **Every boss has its own state machine** — PLAYGR's `initwbooly`, ARCADE's
  `initkragg`, RAVECAVE's wraith, TOWER's bishop and VAT's Boggs. Boggs' head,
  claw arm and machinery objects are the part of him that is still missing.
- **A hard blow disarms you, and the button band is labelled from the key map** —
  the disarm is in [Fighting](combat.md#a-hard-blow-costs-you-the-gun-and-the-band-says-which-key),
  the band in [What the executable runs](systems.md#the-letters-under-the-buttons-are-typeset-from-the-key-map).
  The band itself is an indicator; nothing in `SC.EXE` hit-tests it.
- **The camera is the engine's**, not this page's: `0x4309f0`'s eased chase with
  its 120-pixel lead, clamped by `0x4308a0` to the room's own rect one side at a
  time. What is left invented is spending its step across the frame's four ticks.
- **Both of the two tests are here now**, and so is the ending — the tests in
  [Weapons and pickups](weapons.md#a-pickup-is-taken-on-the-art-not-the-box),
  the ending in [The sixteen levels](levels.md#the-sixteenth-level-is-the-end).
- **Damage is off on the BENCH and on in the game.** `walk.html?level=N` starts
  with `damage` and `foehit` clear, because with them on a probe walking east
  through WOODS meets three hydraulic presses and every route test becomes a
  fight. That was never a fact about the game, though, and for a while it meant
  a player who came through the front door could not be killed by anything but a
  fall. `begin()` throws both switches now, so the health, the knockdown, the
  seven KILL films and the lives — all built, all previously unreachable from
  that door — are what a player meets.
- **The KILL vignette is the last life's**, which is what `0x4294b7` says: the
  death branch reads the count, spends one, and takes the ordinary path while
  the count before the spend was not negative. This page used to play one on
  every death, which made the best animation in the game the most familiar
  thing in it.
- **The shell is finished except for the demo player.** All fourteen preferences
  controls answer, all eight cheat words work, and the high-score board takes a
  finished game and shows it over the title film. The one thing left is the
  second menu button, which plays a recorded input stream out of `skuldemo.dmo`
  — see [the menu](menu.md#the-second-menu-button-is-a-demo-player-and-the-save-game-does-not-exist)
  for why replaying it here would only measure drift.

## Where the pieces are

- `skullcracker/` — the page, its file store and its film loop
- `engine/src/df/byte-order.ts` — which way round a file is, and how it is asked
- `engine/tests/byte-order.ts` — detection (needs no rip) and the menu (needs one)
- `skullcracker/tools/records.mts` — how much of the sixteen books is on the
  page, counted rather than remembered
- `skullcracker/tools/runsuites.mts` — **every browser suite, one process, one
  Chromium**: `npm run test:browser:all -w skullcracker`, or name the ones you
  want after a `--`
- `skullcracker/tests/browser/harness.ts` — where a suite gets its browser from
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

Back to [Documentation](../README.md).
