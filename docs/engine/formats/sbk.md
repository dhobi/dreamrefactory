# SBK — Skull Cracker's sprite books

`.SBK` is the one format in this project that belongs to a game with **no
interpreter**. *Skull Cracker* (1996) is CyberFlix's own, on CyberFlix's own
engine, and it uses DreamFactory's file layer without its virtual machine — the
game's logic is compiled into `SC.EXE` rather than scripted in the data.

Measured against the engine's own opcode table, which names 329 script verbs:

| binary | verbs present as strings |
|---|---|
| `Titanic` (Macintosh PEF) | **329 / 329** |
| `DF.EXE` (Dust's engine, Windows) | **265 / 329** |
| `SC.EXE` (Skull Cracker, Windows) | **14 / 329** — and all fourteen are `sqrt`, `error`, `message`, `switch`, `showcursor` and the like: C and Win32, not the language |

`SC.EXE` is also **583,680 bytes against `DF.EXE`'s 346,624** — not a stripped-down
engine but a bigger one, because everything that would have been scripts is
compiled inside it. So a sprite book holds everything about a level *except what
happens in it*: `initzomb` says where the zombie starts, and what a zombie does is
native code.

## It is not a new codec

A book is an ordinary [DFile container](README.md), and its cels are the
[SHP transparent-image codec](shp.md) — `decodeShpFrame`, unchanged. **5424 of the
5424 cels the directory names decode with it.** What is Skull Cracker's own is only
the arrangement.

## Four structures

```
  container 0        the cel directory, and the book's index
    ├─ +20  i32      the palette container
    ├─ +24  i32      the root container
    ├─ +28  i32      how many cels follow
    └─ +32           48 bytes per cel
  the root (38 B)    the level's table of contents
    ├─ +30  i32      the backdrop container
    └─ +34  i32      the entity table container
  the entity table   28-byte header (i32 count @+24), 48 bytes per placed thing
  the backdrop       28-byte header (i32 count @+24), 342 bytes per placed cel
```

### Container 0 — the cel directory

Everything in a book references a cel **by ID, never by container index**, which is
why a scan for "an i16 that happens to be a valid container" finds nothing at any
fixed offset. The directory is the indirection.

| offset | field |
|---|---|
| +0, +2 | i16 height, width |
| +4…+10 | i16 **strike box** `{y0, x0, y1, x1}`, anchor-relative — zero on all but the impact frames |
| +12…+18 | i16 **collision box**, same shape |
| +20, +22 | i16 the **blow** this cel carries, `(dy, dx)` |
| +24, +26 | i16 draw position Y, X |
| +28 | i16 the cel's **ID** |
| +30 | i16 the container holding its pixels |

The record **duplicates the cel's own eight-byte header**, and that is how this
reading was confirmed rather than assumed: the directory's copy and the decoded
cel agree on all four numbers for 5424 of 5424 entries.

#### The two boxes, and what a blow is

The three fields between the size and the draw position are the whole of the
game's combat, and they were dead bytes in this reader until `0x42f910` was read.

**The collision box at +12** is authored, not derived. 741 of `PLAYER.SBK`'s 1229
cels carry one and only **43** of those are the cel's own extent — the punk's
walking cel 1900 is 103x142 anchored at (48, 79), so its extent is
`y -79..63, x -48..55`, and its box is `y -79..62, x -31..51`: a torso narrower
than the art on both sides. A bounding box cannot give you that.

**The strike box at +4** is on 42 cels of the 1229 and every one of them also
carries a blow at +20. They are the impact frames and nothing else:

| cel | what | strike box | blow |
|---|---|---|---|
| 602 | the punch's fist | `y -40..-16, x 64..88` | `dx 47` |
| 604 | its second variant | `y -49..-10, x 57..104` | `dx 50` |
| 663 | the kick's boot | `y -6..18, x 95..125` | `dx 55` |
| 622 | the jump kick | `y -42..-30, x 36..49` | `dx 44, dy -56` |
| 655 | the headbutt | `y -45..-19, x 42..63` | `dx 87, dy 11` |

Cel 602 is 129 wide with its anchor at 41, so `x 64..88` is a two-dozen-pixel
square at the far right of the art. The fist, and only on that frame.

**And the blow is a velocity.** `0x42f910` is what every hit handler in the game
calls to find out how hard it was hit, and it is not a damage table:

```
    ebp = [obj+0x1a]                          a percentage; every class writes 100
    rec = 0x4025b0([obj+2], [obj])            the record of the cel it is SHOWING
    (dy, dx) = [rec+0x14] scaled by ebp/100   ← +20, +22 of the directory record
    dx = -dx if the object faces left
    dy += [obj+0xa] ; dx += [obj+0xc]         plus whatever it was already doing
    return 0x434630(dy² + dx²)                ← a square root
```

**Damage is speed.** And the corpus confirms it one-directionally, which is the
strongest shape a cross-check can have: across all 5424 cels **no cel has a blow
without a strike box**, while 371 have a box and no blow. Those 371 are the
projectiles and the hazards — `ARCADE`'s cel 1000 is 48x49 and its box is the whole
of it — and they need no stored pair, because the object's own velocity is already
in the sum. A flying thing's damage is how fast it is flying.

It also explains thresholds that look arbitrary until you know what they are
measuring: a mailbox dents at 10 and caves in at 55 (`0x44fe80`), so
a punch marks it and a kick wrecks it; a punk is knocked down over 50
(`0x44f1fd`), so a kick floors it and a punch only staggers it. And a blow thrown
while running lands harder, because the striker's own velocity is in the sum.

Its 32-byte header is the piece that was nearly missed, and it matters: an earlier
reader found the palette by looking for a 2056-byte container, and `STREETS.SBK`
has **two**. Taking the first painted that entire level in the wrong colours. The
header names the right one.

### The entity table — the level design, and it is named

1218 of the 1219 records across the sixteen levels carry a Pascal string, and the
vocabulary *is* the game: `platform` (263 of them), `obstacle`, `ladder`, `goal`,
`newroom`, `exitroom`, `switch`, `door`, `probe`, `timer`, one `init*` per enemy
kind and one `stat*` per pickup.

| offset | field |
|---|---|
| +0 | i16 a **per-instance parameter** — small and signed, and different for each copy of the same kind (`initbeltleft` stores 4, 6, 8 or 10; `door` stores −4, −1, 2, 7 or 8). Direction, speed or initial state; which of those is `SC.EXE`'s business |
| +2, +4, +6, +8 | i16 rect: top, left, bottom, right — Mac `Rect` order, like every coordinate pair in this format |
| +10 | **i32** — for a **region**, the container holding its ground; always 0 for an object, because at runtime the engine keeps an object *pointer* here (see below) |
| +14 | i16 **flags**, four bits, all set in 1156 of 1167 objects (see below) |
| +22 | i16 **1 = an object the engine spawns, 0 = a named region** |
| +24, +26 | i16 a second point, Y then X |
| +28 | Pascal string: what this is |
| +16, +18, +20 | zero in all 1219 shipped records — unused, not merely unread. (+12 is zero too, but it is the high half of +10 rather than a field) |

That second point is the strongest evidence the reading is real rather than a
plausible stride, because **it sorts itself by what the thing is**:

| kind | point == the rect's own midpoint |
|---|---|
| `obstacle`, `timer` | 100% |
| `stat*` (pickups) | 99% |
| `platform` | 87% |
| `goal` | 13% |
| `ladder` | 8% |
| `switch`, `door` | 0% |

A thing that just sits there stores its own centre; a thing you operate stores
somewhere else — a destination. A misread field would not do that.

### The discriminator at +22, confirmed from outside the data

`+22` splits the table in two, and the reason to trust it is that **`SC.EXE`
agrees**. Every name on the object side is a class the executable registers;
every name on the region side is a label a designer typed that the binary has
never heard of. Measured: 96 of the 113 names in the shipped books appear in
`SC.EXE` as C strings, and **the 17 that do not are exactly the region records** —
`newroom`, `newroom1`–`4`, `roomtwo`, `shaftone`, `shafttwo`, `entrance`,
`tuberoom`, `bigshaft`, `hugeroom`, `chamber2`, `lab1`, `lab2`, `where`, and one
more discussed below. Two independent statements of one fact.

The executable never compares those names because it never compares *any* name:
each class string is interned once at startup into a 16-bit id kept in a global
(the registration blocks sit at `0x40b400` and up, 0x3a bytes apart, one per
class), and everything downstream dispatches on the id. There is a hard ceiling of
100 classes — `cmp ax, 0x64; jl` — with an error report past it.

### The flags at +14, and the one guess this page makes

Four bits, and all four are set in 1156 of the 1167 object records. What makes the
exceptions worth carrying is *which* records they are: eight `platform`s at 14,
two at 11, one at 13, and one `initplank` at 14. Every one is a surface you stand
on, and every value is 15 with a single bit cleared. Per-edge solidity — the
jump-through platform every side-scroller has — would look exactly like this. That
is a guess, and neither the reader nor the viewer acts on it.

### `inithealth`, which never worked

One record, in one level whose every other pickup is `stat*`. `SC.EXE` has
`stathealth` and has never heard of `inithealth`, so no class could be found for
it and that pickup cannot have spawned in 1996. A typo in the shipped level data,
found by comparing the two lists.

And seven classes the engine knows that **no shipped level places** —
`initbeltboth`, `initdoor`, `initpainting`, `inittirepile`, `statpunch`,
`statshield`, `suckto`: content built and not used.

### The regions — where the ground is

A record with `+22 == 0` is a named area, and its `+10` is the container holding
its shape. Those containers were the last unexplained thing in the format: 18 to
362 bytes, 48 of them across the sixteen levels, with nothing known to point at
them. The entity table points at them, and which record points at which is what
makes a level a set of rooms — see below.

| offset | field |
|---|---|
| +0 | i16 the container's own byte length — which is the check that this is one |
| +2 | `(i16 y, i16 x)` bounding box corner |
| +6 | `(i16 y, i16 x)` the other corner |
| +10… | `(i16 y, i16 x)` × N — **the floor**, left to right |

The engine's parser (`0x40ba70`, reached from the table loader `0x40b200` through
entity +10) settles what the polyline IS: it computes `(len − 10) / 4` points,
takes the first and last x, allocates one i16 per x column across that span, and
walks consecutive points **interpolating a y for every column** — a rasterised
height map, `[firstX, span, y…]`. The walkable ground, exactly. It skips the two
leading pairs, and stores the result into the entity record's +18 — which is why
+18 is zero on disc: it is a runtime pointer slot, like the platform's +10.

The 38-byte "root" is also more than a pointer pair: it is a TABLE with the same
28-byte header (count at +24) of 10-byte records `{i16 tag, i32 backdrop, i32
entities}` — the loader searches it by tag, so a book could hold several
sub-levels. Every shipped book holds one.

The polyline is the walkable ground. `WOODS.SBK`'s is 88 points running from
x = 708 to x = 11086 with y wandering between 911 and 1557 — the terrain across
the whole level. `ARCADE.SBK`'s is two points at a constant y: a flat arcade
floor. 567 floor points across the corpus.

This is the one structure in a sprite book that is neither art nor placement, and
it is the closest the data comes to describing how the game *played*.

### Rooms, and the doors between them

The named areas are the level's own division of itself, and the binding is 1:1:
**52 rooms across the sixteen books own 48 regions**, with no region owned twice.
The four left over link container 0 — the cel directory, and so the format's null
— and have no floor at all: MAZE's two unnamed rooms, BARREL's `barrel`, LAB's
`lab2`.

A room is identified by its **param** (+0), not its name. Designers typed
`newroom` thirty-seven times and also `roomtwo`, `bigshaft`, `chamber2`, `lab1`;
the names repeat and collide, the params do not.

The doors are the `exitroom` objects — nine of them, in four of the sixteen
levels. Each stands inside one room's rect and carries the param of another:

| level | door | in room | leads to |
|---|---|---|---|
| STREETS | x4522…4767 | the street, p3 | the basement, p1 |
| STREETS | x4480…4782 | the basement, p1 | the street, p3 |
| CAVERN | x3464…3540 | p3 | p1 |
| CAVERN | x3328…3413 | p1 | p3 |
| MAZE | x1840…2016 | p3 | p1 |
| MAZE | x1833…2019 | p1 | p3 |
| LAB | x1726…1947 | `lab1`, p0 | `newroom`, p3 |
| LAB | x1725…2005 | `newroom`, p3 | `lab1`, p0 |
| LAB | x1892…2030 | `lab2`, p1 | `lab1`, p0 |

Every one resolves, none leads to a floorless room, and none is a dead end.

**The point at +24 is where you come out.** For eight of the nine it sits just
outside one edge of the door's own rect — a few dozen pixels left of it or right
of it, never above or below — and the pairs are *opposed*: STREETS' street door
points right and the basement's door back points left, CAVERN's left then right,
MAZE right then left, LAB's chain left then right. So a pair is a two-way
passage: leave the street through its door and you are put at the point of the
basement's door back. The ninth stores its own midpoint, and it is the door out
of `lab2`, the one room with no floor to stand in.

**And a door is not triggered by touching it.** Two builds of the walk page
tried. Plain contact bounced the player between the two rooms for as long as an
arrow was held. Contact plus "you must be walking the way the point implies"
stopped the bouncing and trapped the player in the basement instead. Both fail
for a reason the file states: STREETS' street door stands between the spawn at
x1840 and the goal at x7731, so walking right always enters it, and the arrival
point beside it is **eight pixels** past its right edge against a player about a
hundred pixels wide. You come out of every door still standing in it. A door
whose own exit point leaves you inside it cannot be a contact trigger, so
entering one is a deliberate act — the up key, in this port.

That last step is a reading and not a field the executable has been watched
using; `SbkExit.side` says so. What it is checked against is the whole corpus and
`skullcracker/tests/browser/rooms.ts`, whose first assertion is the negative one:
walking through STREETS' door does nothing.

**`goal` is not a door and neither is `door`.** Both were candidates and both
fail on the corpus: nine of the sixteen goals carry a param no room in their book
has, and SEWER's five `door` records carry −4, −1, 2, 7 and 8 while all twelve of
its rooms are param 0. What `door`'s param names is still unknown.

### The floor is not a graph of y over x

Three things the polyline does that "the terrain across the level" does not
prepare you for, all of which the rasteriser has to survive:

- **vertical steps.** Two consecutive points share an x and differ in y — a curb.
  STREETS has nine of them.
- **pits.** The floor drops hundreds of pixels and comes back. TOWER's first room
  dives 719px and returns, four times: those are its shafts.
- **no floor at all.** CITY's ground is a ledge from x271 to x691 and then
  y = 7250 for the rest of the level, which is ~2900px below anything CITY draws.
  CITY has 73 platforms and 20 planks — the most of any level, and the only
  `initplank` in the game. Its ground is the fall.

And seven of the 48 hold the odd backwards pixel (`6231,1341` then `6230,1366` in
STREETS). All 48 rasterise with every column written.

### The backdrop — a placement list, not a tilemap

| offset | field |
|---|---|
| +0 | i16 cel **ID** |
| +2, +4 | i16 world position Y, X |
| +6 | i16 **mirror** — nonzero flips the cel horizontally; handed straight to the rect builder (`0x4026d0`), which negates the x extents |
| +8 | u8 **plane type 0..4** — picks one of the five display lists (jump table `0x40c1d8`: planes 0, 1, 4 → the rate-1 lists; plane 2 → background; plane 3 → foreground); over 4 is a hard error (`0xcf8`) |
| +9..+11 | a depth-like value the AUTHORING tool stored and **the runtime never reads** — the engine consumes only +8's low byte |
| +12 | i16, nonzero for an **animated** placement (the engine tests it only against 0 at load) |
| +16 | i16 flags: on planes 2/3 bits 1/2/4 pick the **scroll rate** (see below); bit 0x10 marks the placement droppable when memory is short (~2 MB check); on an animated placement it also carries the entry count |
| +22… | for an animated placement, 8-byte animation entries; for a still one, dead — the `f5f5f5f5`/`ffff` fill |

**The real parallax** is one line in the kind-B draw case (`0x40c31a`):
`screenX = (x − c) · k/6000 + c` about the camera centre `c` — horizontal only,
y is never scaled. `k` comes from +16's bits: plane 2 (background) 5000/5300/5600,
plane 3 (foreground) 7500/6700/6400; planes 0, 1 and 4 go through a transform
with no camera in it at all — **rate exactly 1**. Two practical consequences:
most of a level's art lines up exactly as stored, and rendering by the stored
+9..+11 "depth" (which the engine ignores) misaligns everything — which is how
this port's first walkable-level build looked, and why this section exists.
`placementRate` in `sbk.ts` is this rule. One more from the same dig: the rect
builder subtracts the cel's stored anchor (`pos − anchor`); adding it drew every
scene's art 2·anchor low, which had been visible as entity boxes floating above
GRAVE's ground since the first overlay render.

All of that is read from `0x40bf40`, which copies each record out whole
(`rep movsd`, 0x55 dwords and a word — 342 exactly, at a stride computed as
19·2·9·i) and dispatches on the plane byte through a five-way jump table. The
whole-i32-as-16.16 reading this replaces was almost right: it is the same depth
with the plane byte folded into the low bits, which split one layer into
"1.00000 / 1.00002 / 1.00003" in the viewer.

**All 5048 placements across the sixteen levels resolve through the directory.**
The factors are per-level: there is nothing canonical about 1.0, so code wanting
"the near plane" takes the commonest factor in the book (`nearestLayer`) rather
than comparing against a constant — `STREETS.SBK` stores one placement at 0.125
against 143 at 1.020, so the *minimum* would name the outlier.

What the backdrop does **not** store is where the camera starts, because that
belonged to `SC.EXE`. Composite the layers at their stored positions and you get
the level *unrolled* — a true picture of the data and a false picture of the game.

## The layout, confirmed by the code that read it

Everything above was worked out from the files. `SC.EXE`'s record collector at
`0x40b850` then reads the same table, and it agrees offset for offset — which is
as close to a specification as this format will ever have. What it does is take a
class name and copy every matching record into a per-class array, returning how
many it found (the caller checks that against 100 and reports an error past it):

| this port | the engine |
|---|---|
| a 28-byte table header | `add ebx, 0x1c` — the first record is at level+28 |
| i32 record count at +24 | `cmp dword ptr [level+0x18], ecx` … `jg`, so the loop is `index < count` |
| 48-byte records | `add ebx, 0x30` per step, and `rep movsd` with `ecx = 12` — the whole record, copied verbatim |
| `+22` says object or region | `cmp word ptr [rec+0x16], 0; je next` — a zero here is not collected |
| the name is a Pascal string at +28 | `lea eax, [rec+0x1c]`, then a string compare against the wanted name |
| the second point is at +24 | `mov ecx, [rec+0x18]`, passed to a geometric test when the caller asks for one |
| the rect is 8 bytes at +2 | the runtime appender writes `[base+2]` and `[base+6]` as two dwords |

One thing the code settles about the backdrop: the constant 342 (`0x156`) never
appears as a multiplier — there is no `imul _,_,0x156` in the binary and its only
uses are unrelated struct offsets — so nothing strides the 342-byte backdrop
records in place. Like the entity table, the backdrop is read once into a runtime
array of a different shape; the exact copy-out was not traced.

The per-class arrays live in `.data`'s uninitialised tail — `platform`'s is at
`0x4aa600`, its count in the global at `0x46b9ac` — and because the collector
copies all 48 bytes, **the runtime record layout is the file's layout**. So a
field this port reads at +14 is the same field the game read at +14.

### What the engine actually does with a platform

`platform`'s array is at `0x4aa600` and its count in the global at `0x46b9ac`, and
five functions touch them — found with `scdis.mts bytes`, which searches the
section for the literal rather than disassembling it, because the windowed sweep
`find` uses can start mid-instruction and had already been caught missing real
references:

- **the overlap query** (`0x42fb70`, called from 11 places) walks every platform
  and calls `0x434200`, which is a strict **point-in-rect** test — `top <= y`,
  `bottom > y`, `left <= x`, `right > x`, in that field order, which is the
  disc's own Mac `Rect`. The point it passes is the object's own `(top, left)`,
  the dword at object+6. On a hit it does `cmp dword ptr [rec+10], 0` and then
  writes the colliding object's pointer there. So **+10 is the occupant** —
  which is why the disc always has 0 in it;
- **the appender** (`0x421470`, and a byte-identical twin at `0x4385f0`) writes a
  rect at +2, zeroes +10, and stores a point at +24 — platforms can be created
  while the game runs;
- **the remover** (`0x4376f0`) finds the platform whose +10 equals its argument
  and compacts the array over it, copying **only** the rect, +10 and +24;
- **the carry pass** (`0x42fc10`, called from 16 places — one per level, at a
  guess) is what platforms are FOR. Each frame it walks the array, and for every
  platform with an occupant it takes the difference between the platform's rect
  now and the copy it kept at `0x4a69d0`, then calls `0x434270` to move the
  occupant by that delta. A platform is a thing that carries what stands on it.

The compaction settles the stride from the other side: it copies +2..+10 as eight
bytes and steps by 48, so a runtime platform record **is** the 48-byte entity
record off the disc, rect and all.

What none of the five contains is **gravity** — and the reason turned out to be
that the engine has none. See below.

### There is no gravity, and no velocity either

Motion in Skull Cracker is authored **per animation frame**. The player's
animation scripts live in `.data`, each one

| offset | field |
|---|---|
| +0 | i16 frame count |
| +2 | i16 ticks each frame is held |
| +4 | i16 kind — copied to `obj+0x18` |
| +6… | `{i16 tag, i16 cel ID, i16 dx, i16 dy}` × count |

`0x45d090(obj, script, tag)` installs one and seeks to the first frame carrying
that tag, which is how a single script holds a whole character: walk, run, jump,
land and every attack, each under its own tag. `0x45d0f0` advances it once per
tick, writes the frame's cel ID to `obj+0`, and — if the frame carries a
displacement — hands it to `0x42f8b0`, which is the entire movement system:

```
x += round_away_from_zero(dx / obj[+0xe])
y += round_away_from_zero(dy / obj[+0xe])
```

`dx` is negated when the object faces the other way. There is no accumulator, no
acceleration and no terminal velocity anywhere in it. A jump is not integrated;
it is drawn.

Four characters' scripts carry the same three numbers — the one at `0x470f98`
plus `0x470a78`, `0x470c40` and `0x471260` — and `0x471920`/`0x471988` give the
first character's walk and run on their own:

| | dx | dy | cels |
|---|---|---|---|
| walk | 95 | 0 | twelve, one tick each (100…111 for the first character) |
| run | 180 | 0 | twelve (150…161) |
| jump | 0, or 95 running | **−420** | ONE frame |

### 15 frames a second

`0x4087c0` reads the system clock and returns `ms * 3 / 50` — units of 1/60s.
`0x40e4f0` then spins on it:

```
40e501  call 0x4087c0          ; now
        mov  esi, [0x46bddc]   ; the last frame
        lea  ecx, [esi + 4]
        cmp  eax, ecx
        jl   0x40e501          ; until now >= last + 4
```

Four sixtieths is a fifteenth, and `0x40dfd0`, which calls it, is called from
**all sixteen level frame functions** (STREETS' `0x44dc10` at +614). So the game
runs at **15fps**, and since the animation stepper advances one cel per frame,
every animation in the game plays at 15.

That is the number the rest of this was missing. With it, and the divisor of 12
that `0x42e412` writes into the player, the motion units above become pixels per
second at last:

| | per frame | per second |
|---|---|---|
| walk | 8px | 120 |
| run | 15px | 225 |
| jump impulse | 35px | — one frame only |
| the held rise | 11px | 165 while it lasts |

A twelve-cel walk cycle is therefore 800ms and covers 96px, and a five-cel punch
takes 333ms. The port had been running them at 34fps, which is what a blurred
punch looks like.

### What a level spawns, and how to find its cels

A level book's cels divide cleanly in two, and the split is free: of STREETS' 220
cels only **84 are placed by the backdrop**, and the 136 left over are what the
level SPAWNS. Rendering them names them, and they line up one run per `init*`
kind:

| cels | what it is | `init*` record |
|---|---|---|
| 1900…1987 | a red-mohawked punk | `initwerea` |
| 5000…5083 | a second punk | `initwereb` |
| 3000…3048 | a rat | `initrat` |
| 2410…2413 | a mailbox, tipping over | `initmailbox` |
| 9700…9703, 9800…9806 | a fire hydrant, and its burst | `inithydrant` |

("werewolf" is the designers' word, not a description.)

#### Four objects describe one creature

The cel range is where a reading of a class STARTS, and on its own it is a trap —
see below. A creature is described by four things in the executable, and all four
have to be found before any of its numbers mean anything:

| what | how to find it | what it gives |
|---|---|---|
| the **name** | `0x40b850(name)`, once per chapter | which records this class owns |
| the **creator**, called once per record | the function the registration loop calls right after `0x40b850` | starting health, the instance struct, whether it joins the census |
| the **class descriptor**, installed by `0x430cc0` | referenced as data from the class's init | the speed divisor `obj+0xe`, the type id, and the **hit handler** at `obj+0x12` |
| the **hit handler** | that pointer | the flinch, the death, the award, the sound |

For chapter four — levels 1 to 4, registered by `0x4503a0` — that chain reads:

| name | creator | descriptor | hit handler | health | plate | award | census |
|---|---|---|---|---|---|---|---|
| `initwerea` | `0x450a50` | `0x44e4b0` | `0x44f0a0` | 250 | `13001` FANG | 220 | yes |
| `initwereb` | `0x450b40` | `0x44f300` | `0x44f8b0` | 200 | `13002` LINK | 240 | yes |
| `initrat` | `0x4509b0` | `0x44df70` | `0x44e3f0` | 200 | none | none | **no** |
| `initmailbox` | `0x451110` | `0x44fd40` | `0x44fe80` | — | none | none | no |
| `inithydrant` | `0x44fc70` | `0x44fa60` | `0x44fbd0` | — | none | none | no |

The way to enumerate those descriptors is `scdis.mts callers 0x430cc0`, which
finds all eight this chapter installs. A grep for the `obj+0x12` write finds
whichever register the compiler happened to use and misses the rest — which is
how this table briefly claimed the rat had no hit handler and could not be killed.

#### The census is one call

Whether a thing counts towards a level's kill quota is `0x42f870(obj, 1)`: it sets
`obj+0x1c` and increments the live count at `0x4a6e88`, which is what `0x42f540`
returns and what `0x450060` takes its share of. Exactly four of this chapter's
classes make that call — `initwerea`, `initwereb`, `initwerec`, `initwered` — so
STREETS' census is **eleven**, the eight punks and three chained punks, and not
the nine rats, two mailboxes and hydrant standing among them.

The count drops when the OBJECT is destroyed (`0x42f750`), not when it dies: no
death path calls `0x42f870(obj, 0)`. So a corpse still counts for the fifty frames
it lies there.

#### `obj+0xe` is a mass, and a hit is an elastic collision

The field the mover divides an animation's `dx` by is also the weight the physics
gives the object, and that is one field doing two jobs rather than a coincidence.
`0x430350` is the collision dispatcher: it walks the object list, intersects the
two drawn rects (`0x434140`), calls the victim's hit handler through `obj+0x12`,
and then — if the hitter is still live — calls **`0x430470`**, which is the
textbook one-dimensional elastic collision applied per axis:

```
    m1 = hitter+0xe        m2 = victim+0xe
    v1 = the hitter's cel blow pair, scaled by hitter+0x1a, plus its own +0xa/+0xc
    v2 = the victim's own +0xa/+0xc

    victim.v = (v1·2·m1 + v2·(m2 − m1)) / (m1 + m2)
    hitter.v = (v2·2·m2 + v1·(m1 − m2)) / (m1 + m2)
```

The player is 12, a punk 20, a hydrant 10, a mailbox 7, a rat 7, a bullet 50.
Light things fly and heavy ones shrug, and the numbers come out where you would
expect: a kick's 55 against a mailbox is 55 × 24/19 = **69 pixels a frame**, a
thousand a second, which is why the original throws a mailbox most of a screen
width before it lands on its side.

And that settles what `obj+0xa`/`obj+0xc` are. They are a **persistent velocity**,
not a per-frame stride — an object that should not drift cancels them itself. The
hydrant's `0x44fb20` zeroes both on its first two instructions, which is why a
hydrant never budges no matter how hard it is kicked; a gob of goo zeroes them the
frame it lands; the punk's states zero them where its script wants to place it
exactly. The mailbox's `0x44fe10` never touches them, so what the solver hands it
is kept.

Nothing found so far *slows* a slide down, though, which on the code alone means a
kicked mailbox travels for ever. So the one number a port has to invent here is the
drag, and there is exactly one observable to calibrate it against: in the original
a kicked mailbox crosses about a screen width. Solving `v²/2a` for it is not enough,
because a kick's blow has no vertical component and the box has to fall the 37
pixels between its upright shape and its fallen one before the ground can drag on
it at all — the first fifty frames are free. Measured on the page instead: 0.7
pixels per tick squared puts it down 536px from where it stood.

One more thing the boxes settle. A cel's strike box is anchor-relative and the
engine mirrors it about the anchor, which is what `0x4026d0` does — but a port that
draws the player centred on its own x and flips the cel within that band has to
mirror the box the same way, inside the cel. The kick's cel 663 has its anchor at
`posX -12`, twelve pixels OUTSIDE its own art, so the two conventions disagree by
more than the cel is wide: reflecting about the anchor puts the boot 165 pixels
behind the player and nothing can be hit facing left.

What is NOT invented is where it comes to rest. Each cel carries its own collision
box, and the upright mailbox's reaches 93 pixels below the anchor while the fallen
one's reaches 56 — so a thing that changes shape has to land on the box it is
currently showing. Landing it on the standing footprint leaves it floating 37
pixels above the pavement, which is what this port did until the two were told
apart.

#### What a hit does

Every hit handler in the game is the same shape, and `0x44f0a0` is the clearest:

```
    if (obj+0x1a < 0) return                a corpse is not hittable
    dmg = 0x42f910(hitter)                  the blow — see the cel directory
    0x40cba0(victim, dmg, hitter)           the spray, BEFORE anything else
    health -= dmg
    if (health <= 0) {
       0x45d090(obj, DEATH, 0)              the death animation
       instance+2 = [0x46b204]              the corpse's countdown: 50 frames
       0x40d450(award)
    } else 0x45d090(obj, FLINCH, tag)       one of several
```

The flinch **tag** is chosen differently by each class, and each choice is
readable:

| class | how the tag is picked |
|---|---|
| `initwerea` | over 50 knocks it down outright; else by where it was hit — `|Δy| > 50` high, `>= 30` and facing away, else low |
| `initwereb` | `0x434540(4)` — a random one of four |
| `initmailbox` | under 10 does nothing; 10 to 54 dents it and it springs back; 55 or over topples it for good |
| `inithydrant` | by the stage it is already in: 0→1, 1→2, 2→3, and nothing after |

Two of them do not follow that shape at all:

- **the rat's `0x44e3f0` has no health test and no branch.** It fetches the blow,
  sprays, plays a sound and installs `0x477090`: nine cels at one frame each in
  which the rat flips over and is launched end over end, its tail whipping, the
  largest of them 259 pixels tall. One blow of any size, and the 200 health its
  creator stores is never touched.
- **the mailbox's two outcomes are both speeds, and one of them is permanent.**
  A punch is 47, so cel 2411 plays and `0x44fe10` puts the intact cel back when it
  ends: a dent that does not last. A kick is 55, so 2410, 2411, 2412, 2413 plays
  and `0x44fe10` then sets `obj+0x18 = 2` — a state with no script — and the hit
  handler opens with `if (obj+0x18 != 2)`. Cel 2413 is the mailbox on its side, and
  that is where it stays. Anchored, those four cels are a topple: the anchor stays
  near the top of the box while the art swings from 93 pixels below it to 58 and
  the width spreads from `-38..35` to `-55..46`.
- **the hydrant's `0x44fbd0` never subtracts either.** Three blows walk it through
  cels 9700 to 9703, and when the last one's animation ends its own frame function
  `0x44fb20` installs tag 4 — `9800…9806`, the water. It also refuses to be hit by
  another hydrant: `0x44fc40` walks its own class list looking for the striker.

And the animations themselves, out of the scripts in `.data`:

| class | gait | flinch | death |
|---|---|---|---|
| `initwerea` | `0x4774b0` kind 1 hold 2, cels 1900…1907 | `0x4774f8` hold 4, one cel each: 1970 / 1971 / 1972, or `0x477580` tag 0 — 1960…1963 with `dx 150, 150, 75, 75`, a knockdown that travels | `0x477518` hold 3: 1960…1963 then 1980…1987 |
| `initwereb` | `0x477630` tag 0 hold 2, cels 5000…5005 `dx 75` | `0x477820` hold 4: 5080 / 5081 / 5082 / 5083 | `0x477848` hold 3: 5060…5063 then 5070…5077 |
| `initrat` | `0x476ff0` tag 0 hold 1, cels 3025…3020 `dx 85` | — | `0x477090` hold 1: 3040…3048, the launch |
| `initmailbox` | one cel | `0x4787a8` tag 0 = 2411, tag 1 = 2410…2413 | — |

`initwereb`'s death is the longest in the chapter: twelve cels held three frames
each, four of it falling and eight of it lying still while green goo runs out of
its head — the same green the spray throws.

### Low things need low attacks

The boxes make that a rule rather than a coincidence. The rat's running cel 3020
has a collision box of `y -14..21`; the punch's fist box on cel 602 is
`y -40..-16` and the standing kick's boot on 663 is `y -6..18`. The punch misses
by two pixels and the kick is aimed at a standing man's midriff — **nothing
standing up can touch a rat.** What reaches one is the duck-kick, S+K, whose cel
724 puts a 45x44 box at `y 38..83`: a boot along the ground.

Two pixels is not an accident in authored data, and it is the cleanest evidence
that these rects are the art department's and not the engine's: a bounding box
would have let anything hit anything.

#### The trap: the same cels mean different creatures

**Each of the four chapters registers its own classes, and each chapter's four
books put a walking figure at cel 1900.** So a class function from the wrong
chapter looks entirely plausible and is entirely wrong. This document and this
port both had that error: `initwerea` was read off `0x439240` — health 25, plate
`13101` NALLY, award 250, walk `0x4743b8` — and that function belongs to the
chapter of gang members (`initbatboy`, `initknifeboy`, `initmaskboy`). The same
mistake gave the rat 400 health and a 440 award off `0x417ed0`.

Two checks catch it. The registration site: `initwerea` appears exactly once in the
whole executable, at `0x4504d1`, and the creator its loop calls is `0x450a50`. And
the cels: `0x417ed0`'s rat flinches on 3030…3038 and dies on 3080…3085, and
**neither run exists in any of chapter four's books**. A class whose animations
name cels the level cannot supply is not that level's class.

#### The rest of the spawner

STREETS' frame function is **`0x44dc10`** (it is the one that names `streets.sbk`),
and at +128 it calls `0x4503a0`, which registers every `init*` class in turn.
`initwerea`'s creator `0x450a50` allocates a 54-byte AI struct, creates the object,
**stores the record's rect in the struct at +8**, hands it to `0x45ef70` — which
copies a per-class table of thresholds (`0x477600`: 330, 200, 150, 80) into the
struct — and sets the thing facing the player. So the wide rects on those records
are territories the AI is given. What the AI then does with the four thresholds has
not been read.

One consequence worth stating: the punk's walk script `0x4774b0` has `dx 0` on all
eight frames. Its stride is in the AI, not the animation, which is why every other
gait in the chapter carries 75 and this one carries nothing.

The rat's default animation is worth a word too. Its creator installs `0x476f48`
tag 0, which is cel 3011 — a 54x102 near-black shape with no rat discernible in
it. Whatever state that is (in shadow, in a hole, about to come out), it is not
what a rat looks like on a dark street, and a port that draws it literally draws
nothing. The run, `0x476ff0` tag 0, is the recognisable animal: cels 3025 down to
3020 at `dx 85`, and with the class's divisor of **7** that is 182 pixels a
second, faster than the player walks.

### The spray — 1 to 20 gobs of goo

`0x40cba0(victim, damage, hitter)` runs before any handler subtracts anything, and
it is a particle fountain:

```
    n = clamp(damage / 6, 1, 20)                    0x40ccef..0x40cd15
    repeat n times:
      obj = new(class [0x4a4f0c])                   the shared effect class
      (dy, dx) = the HITTER's own blow              from its cel record +20
      negate dx if the hitter faces left
      each axis: v = v - span/2 + rand(span),  span = max(|v|, 10)
      with no hitter: v = rand(0x50) - 0x28 on both axes
      facing = 0x434540(2) - 1                      a coin toss, so they mirror
      lifetime = 60 frames
      0x45d090(obj, 0x46bbd8, 0)                    cels 18200..18202, hold 3
```

Cels 18200 to 18202 are in `PLAYER.SBK` and rendering them says what they are:
**green gobs of goo**. A punch at 47 throws seven of them; a kick at 55, nine; a
blow of 120 or more, the full twenty.

And they are not fire-and-forget. The effect class's own frame function
`0x40c480` dispatches on the script kind and then on the TAG, through a byte
table at `0x40c7e8` that folds eight tags into three cases:

```
    tag 0      still rising                      cels 18200..18202
       if (obj+0xa > 0) → tag 1                  vy turned positive: falling
       if (obj+0x2e)    → tag 2                  it landed
    tag 1      falling                           cels 18203, 18204
       if (obj+0x2e)    → tag 2
    tags 2..7  on the ground
       first frame: obj+0xa = obj+0xc = 0        it stops dead where it fell
       0x40c810(obj) finds another gob overlapping it, and if that one's tag
       is under 7, advances it: 0x45d090(other, script, tag + 1)
       every 0x434540(0x28)+0x28 frames it steps back DOWN one tag, and at
       tag 2 the object is removed
```

So a gob **arcs, splats, and the splat spreads as more goo lands on it** — cels
18205 through 18210 are 22x9, 37x9, 51x14, 62x21, 80x25 and 106x25, one puddle
growing — and then dries back a stage at a time. Twenty gobs make one mess on the
pavement, not a shower. The only thing missing from the executable is the fall
itself: there is no gravity constant in `SC.EXE` for a gob any more than for the
player.

### The green ball a body leaves

Two values handed to `0x40cba0` are not damage at all and take their own branch at
the top of it. **−13** creates one object on cel `0x4d9e` = 19870 with script
`0x46bb78` tag 2, and **−14** one on 19120…19134 (`0x46ba28` tag 6).

−13 is the body's exit. A corpse's state handler counts `[0x46b204]`'s fifty
frames down and on the frame they expire calls `0x42fa80` for the body's own rect,
`0x40cba0(pos, -13, 0)`, and returns 1 so the object goes — `0x44ef7e` for the
punk and `0x44f848` for the chained one. Tag 2's eleven cels are a bright green
sphere that swells and collapses: 19870, 19869, 19868, 19867, 19866, 19865 grow
from 61 to 89 pixels across, then 19854, 19853, 19852, 19851, 19850 fall away to
6x7. Eleven frames at one apiece, and the body is gone.

Two things it is easy to get wrong here, and this port got both wrong first:

- **the census leaves before the body does.** The hit handler never calls
  `0x42f870(obj, 0)`, but the corpse's state handler does, on its first dead frame
  (`0x44ef3e`) — so the quota moves on the killing blow and the body outlives it by
  fifty frames.
- **the rat has no ball.** That call is in the punk classes' corpse handlers and
  nowhere else; a rat's launch simply ends. Nor does furniture bleed: `0x44fe80`
  and `0x44fbd0` fetch the blow with `0x42f910`, install a dent and play a sound,
  and never call `0x40cba0` at all. Creatures spray, mailboxes do not.

### The interface panel

`PLAYER.SBK` holds the interface as well as the man, and `SC.EXE`'s own help
screen names the pair of modes it belongs to: *"Press Ctrl-P to toggle between
interface and full-screen mode"*. Two of the book's cels are **512 wide**, which
is the screen:

| cel | size | anchor | what |
|---|---|---|---|
| 12000 | 512×43 | 256, 21 | the upper band — the two health bars, the score, the two names |
| 12001 | 512×112 | 256, 56 | the lower band — the pad, the four shortcuts, the weapon, the lives, the dial, the quota |

The bands are not backdrops that happen to be there: each of the panel's regions
blits its band clipped to its own rect before drawing, which is how a changed
figure erases its old pixels. `0x40dad0` opens the upper band that way and
`0x40dc10` the lower — and `0x40dc10` gives away the geometry, offsetting the
rect by **−274** (`mov eax, 0xfffffeee`), the same 0x112 the plotter `0x40dcd0`
subtracts from every screen y it is handed. So the lower band's surface begins at
screen y274, the upper at y0, and the window between them is (0, 42) to
(512, 274) — which is exactly where the pause films play: `PAUSEA.MOV` is 512×232
at origin (0, 42). The shortcut legend is not typeset at runtime: it is in the
pixels.

Ten regions, each with a dirty flag and a clip rect. The rects are the table at
`0x46bd88`, `{y0, x0, y1, x1}` like every rect in this engine, and `0x40d500` is
the painter that runs them:

| region | rect | flag | how |
|---|---|---|---|
| lives | 274,350 – 291,450 | `0x46bd00` | cels `11423+i` for i < lives, at the five points in `0x46bd78` |
| score | 23,220 – 34,290 | `0x46bd08` | the engine's own text, at (236, 34), colour `0xe1` |
| weapon + ammo | 290,305 – 380,450 | `0x46bd0c` | plate `11450`, the weapon's icon at (365, 340), four gauge rows |
| enemy health | 4,300 – 24,512 | `0x46bd18` | fill `11501` slid, cap `11504` |
| enemy name | 29,362 – 42,472 | `0x46bd1c` | the enemy's own name cel, at (457, 35) |
| player health | 4,0 – 24,200 | `0x46bd10` | fill `11500` slid, cap `11503` |
| player name | 29,39 – 42,148 | `0x46bd14` | `13400` SKULLCRACKER or `13401` BONEBREAKER, at (53, 35) |
| mission clock | 286,452 – 325,512 | `0x46bd20` | one of `12700`…`12717`, at (473, 305) |
| kill quota | 326,452 – 384,512 | `0x46bd24` | two digits at (467, 346) and (479, 346) |
| the buttons | each cel's own | — | eight lights, cels `11404`…`11419`, points in `0x46bd38` |

#### The health bars slide

Nothing in this engine scales, and the bars are the proof. Cel `11500` is a
197×12 slab of red anchored 4 from its left edge, and `0x40d8ea` draws it at

```
x = 15 + 196·(health − max)/max,   y = 14
```

so at full health it sits at x15, and as health falls it walks LEFT out from
under the region's clip rect. The green enemy slab `11501` is 194×12 anchored
**191** from its left edge — near its right — and `0x40d7ca` draws it at
`500 + 196·(max − health)/max`, walking right. The same trick mirrored, and each
bar drains from its inner end. 196 is a literal in both.

#### The right-hand bar is a competition

`0x40d1c0(health, max, nameCel, position)` is what an enemy calls to claim it,
and every enemy calls once a frame: the caller's Manhattan distance from the
player (`[0x4ac3d4]`, +6 and +8) has to beat both the best distance so far
(`[0x46bd28]`) and 1024. The painter resets that best to `0x7fff` afterwards, so
the bar belongs to the closest thing within 1024px this frame and to the last one
seen when nothing is in range. Each class passes its own numbers as immediates,
so they can simply be read: `0x439270` gives `initwerea` 25 health and the plate
`13101` NALLY, `0x44f408` gives `initwereb` 200 and `13002` LINK, `0x417f10`
gives `initrat` 400 and `13301` PUKE BOY. What a kill is worth comes the same
way, through `0x40d450`: 250, 240 and 440 for those three.

#### The mission clock is seventeen cels

`0x40d250`, once an engine frame. `32000` in `[0x4a4d68]` means no limit and
shows the empty dial `12717` — `0x43be9c` passes exactly that. Otherwise the
remaining count picks the cel:

```
state = 16 − ticks/450,   cel = 12700 + state
```

Seventeen 450-frame steps: 30 seconds each at 15fps, eight minutes end to end.
Past step 12 — under two minutes — it alternates the dial with the empty one
every frame, which is the flash, and beeps every `100 − 6·state` frames.

#### The four gauge rows are ammunition

`0x40d691` reads them out of the weapon record at `0x4a7f10 + index·12`: `+4` is
the magazine and `+6` what is left in it. The value is scaled to 0…64
(`shl eax, 6` then a divide by the magazine), clamped, and laid out as **four
rows of sixteen** at x417 stepping 7 down from y333 (`mov si, 0x14d`) — cel
`14300` for a full row, `14316 − remainder` for a partial one — and the block
clips to the special-weapon window. An earlier reading of this page had it as the
player's health; the health is the sliding slab in the upper band, and this gauge
sits inside the weapon's own black window with the weapon's own icon beside it.

#### The buttons light up

`0x40da41` walks the eight bits of `[0x4a3b48]` against the eight it drew last
time and redraws only what changed: `11404+i` while a button is down, `11412+i`
when it is up. The cels say what the bits are — `11404`…`11407` are the four pad
arrows and `11408`…`11411` read PUNCH, KICK, INV., JUMP in yellow over the green
ones the band already carries — so the order is up, right, down, left, punch,
kick, inv, jump, and the pad in the corner is a live indicator rather than
decoration.

### The keys

`0x403b90` reads an event, uppercases the character, and indexes a 256-byte table
at `0x46b210` to get an action code; `0x402be0` dispatches it through a 20-entry
jump table at `0x402d54`, indexed by `action + 8`, so negative codes are releases
and positive ones presses. The table's non-zero entries are the whole control
scheme:

| key | action | what it does |
|---|---|---|
| `W` | 1 | **`0x4ac3fe`** — the run, the climb and the jump's lift, all one flag |
| `S` | 3 | `0x4ac3fc` — down, the same query in the other direction |
| `A` | 4 | left/right, resolved against the player's facing at `obj+0x28` |
| `D` | 2 | the other one |
| `J` | 8 | **jump** — `0x4ac3da` |
| `K` | 6 | **kick** — `0x4ac404`, `0x45d090(player, 0x471c90, 8)` |
| `I` | 7 | `0x4ac386` — INV. |
| `P` | 5 | **punch** — `0x4ac394` |
| 24…27 | 5, 6, 8, 7 | P, K, J and I again under four more character codes — **not** arrows |

Two things here are worth a port's attention.

**`W` is not "up".** It is one flag with three jobs, and which one you get depends
on where the player is standing:

- **on the ground it RUNS.** The walk state `0x429990` tests `0x4ac3fe` before
  anything else and installs `0x471988`, dx 180 — 225px a second against the
  walk's 120. This is the speed the game travels at, and a port that binds `W` to
  something else has no run at all and feels slow at a correct walking speed.
- **on a ladder it CLIMBS**, 10.4px a frame (below).
- **in the air it LIFTS**, the same 10.4px a frame, for two frames.

**The arrow keys are not directions.** Character codes 24…27 map to actions 5, 6,
8 and 7 — they are aliases for the four action buttons. `A` and `D` are the only
horizontal input, and they are resolved against facing rather than against the
screen.

And `K`'s tag 8 is `650 651 652 653(+95) 654(+95) 655(+95) 654(-95) 653(-95) 652
651` — the sequence this page had guessed was a walk. It is the kick.

The four buttons are the lower band's four labels, and the keys are their
initials: **J**UMP, **K**ICK, **P**UNCH, **I**NV. Three of them install animations
out of one script, `0x471c90`:

| key | call | frames |
|---|---|---|
| P | `0x45d090(player, 0x471c90, 0)` | tag 0 is the single cel `600`; the punches are tag 3 (`601 602`) and tag 4 (`603 604`) |
| K | `0x45d090(player, 0x471c90, 8)` | tag 8 — `650…655` out at dx 95 and back at −95 |
| J | `0x470f98`, kind 18 | `c1261(dx 0, dy −420)` standing, `(dx 95, dy −420)` running |
| I | `[player+0x18] = 15` | an animation kind, and nothing else |

### There is no gravity, and this is where it runs out

Every animation script in the binary was enumerated and filtered for a nonzero
`dy` — about fifty have one — and in the player's cel ranges there is **exactly
one record with any vertical motion at all**: the launch above, `dy −420`, which
over the player's divisor of 12 is 35px in a single frame. The armed variants
(`0x470a78` kind 20, `0x471260` kind 19) carry the same −420; the second
character's (`0x475130`, `0x4758c0`) carry −500. Nothing in the file brings the
player back down, and the platform path holds no vertical velocity either.

The one thing the executable does give is a per-frame vertical rate. `0x429f00`'s
first state builds the dword `0xff83` — −125 — and hands it to `0x42f8b0` once a
frame while `0x4ac3fe` is held, spending a unit of the allowance at `0x4723f0`;
then it asks `0x42edd0(0, 1)`, the "is there something above me" query that `S`
asks downward as `(1, 1)`, and **refreshes the allowance to 2 whenever the answer
is yes**. So on a ladder the rise repeats indefinitely — that is the climb, 125/12
= 10.4px a frame, 156px a second — and in the air the answer is no, the allowance
runs out after two frames, and the same constant is the extra height you get for
holding the key.

A port still has to invent the fall. What it should not invent is the scale: 10.4
px per frame² is this engine's own idea of vertical motion, and a gravity far
below it puts the player in the air for over a second and reads as flying.

### The unarmed player's whole animation table

Worth writing out, because it is the answer to several questions at once. Every
script the player's state machines install is a `push imm32` inside
`0x428000…0x42b900`, and the unarmed set is:

| script | kind | tpf | tag | cels |
|---|---|---|---|---|
| `0x471648` | 0 | **2** | 0 | `1 2 3 4 5 6 7 8 7 6 5 4 3 2` — the **idle**, 1.87s of breathing |
| | | | 1 | `1 3 4 5 7 6 4 2` — a shorter idle |
| | | | 4 | `20 21 22 21` — the idle at **half health or less** |
| | | | 5 | `23 24 25 24` — lower still (and unreachable: see below) |
| `0x471920` | 1 | 1 | 0 | `100…111`, dx 95 — the walk |
| `0x471988` | 2 | 1 | 0 | `150…161`, dx 180 — the run |
| | | | 2 | `106 107 108`, dx 95 — the run decaying to a walk |
| `0x471b28` | 3 | 1 | 2 | `250 251 252 253(dx 0, dy −420)` — the **standing launch** |
| | | | 3 | `250 251 252 253(dx 100, dy −420)` — the **running launch** |
| | | | 1 | `251 252 251 250` — airborne |
| | | | 5 | `251 252 252 252 252 251 251 251 250` — airborne, longer |
| `0x471c68` | 3 | **4** | 5 | `251 252 251 250` — airborne, held four frames a cel |
| `0x471c90` | 4 | 1 | 0,3,4 | the **punch**: `600` guard, then `601 602` or `603 604` |
| | | | 8 | `650 651 652 653(+95) 654(+95) 655(+95) 654(−95) 653(−95) 652 651` — a **headbutt**, and easy to mistake for a walk or a kick |
| `0x471d68` | 5 | 1 | 0,1,2 | the **kick**: `600` guard, then `662 663`, or `740…745` with W |
| | | | 4 | `684(dx 190, dy −310) 685 686 687 688` — a flying kick, installed by the RUN state |
| `0x471e78` | 7 | 1 | 0…3 | `400…407` — the ladder, up and back down |

Three things fall out of it:

- **the idle is an animation.** The walk state installs `0x471648` tag 0 whenever
  no direction is held, so a port that stands on cel 1 is missing it.
- **the launch is four frames and the impulse is on the LAST one.** The original
  crouches through `250 251 252` — three frames, 200ms — and only then leaves the
  ground, and those frames carry `dx 0`, so a run does not carry through the
  wind-up. This is why the game appears to have a crouch pose.
- **the flight pose is the TUCK, not the flail.** The kind-3 handler's own
  dispatch (`0x42a3d4`) sends the launch tags 2/3/4 to `0x42a1c2`, which installs
  tag 0 — cels `200 220`, knees drawn up and forward, held. The `251/252` flail
  is the deep-fall pose: `0x42a109` compares `[player+0x32]` against 0x168 and
  only a fall past 360 gets `0x471c68`'s slow loop, plus sound 10.
- **there IS a crouch, and it is a whole state machine.** This was misread
  once — twice, in fact — and the architecture explains why: `[player+0x18]` is
  the animation KIND, dispatched through the 28-entry table at `0x429570`; each
  kind's handler re-dispatches on the running script's current TAG
  (`[player+0x44]`); and **installing a script sets the kind from the script's
  own header**, which is what the header's `kind` field is FOR — it names the
  handler that drives it. Kind 0's handler (`0x429690`, the unarmed idle)
  really has no duck, and stopping there was the misread. The ducks:

  - every ARMED standing handler ducks on `S`: `0x42b8ae` (1200s) installs
    `0x471128` tag 5 — cel `1220` into `1222…1225`, ~116 tall against the 145
    standing; `0x42cc03` (2700s) → `0x470a78` tag 4, cel `2730`; `0x42c23f`
    (3200s) → `0x4713f8` tag 5, cel `3240`. J while ducked is `0x42b90b`, tag
    12 — `1260 1261(0,-420)`, a launch from the knees.
  - the UNARMED duck goes through kind 15, the weapon-dispatch standing state:
    its no-weapon branch reads `S` at `0x4289ea` and installs `0x4717c8` tag 1
    — cel `703`, one knee down, fists up. That script is kind **6**, so kind
    6's handler (`0x42a9a0`) takes over, and it is the crouch machine: tag 1
    the held duck; tag 2 (`704…707`) a settle fidget rolled 13-in-707 at each
    script end (`0x42aadd`); tag 4 the **crawl**, `1000…1004` each carrying
    `dx 47` — 59px a second, half a walk; tags 5→6/7 (`710, 711…716`) the
    duck-punch on P; tags 8→9 (`720, 721…724`) the duck-kick on K; and P+K
    together reaches into the kick script for `0x471d68` tag 6 (`630…632`).
    Release `S` and it stands back up through the idle.
- **the 650s are a COMBO.** The idle handler checks `[0x4ac394] && [0x4ac404]`
  — P and K together — at `0x429706`, before either alone, and installs
  `0x471c90` tag 8: the out-and-back lunge at ±95. First mistaken for a walk,
  then for the kick; it is the both-buttons move.
- **a running jump has no wind-up.** The run handler (`0x429b80`) installs
  `0x471b28` tag 4: one record, `200(dx 180, dy −420)` — an instant leap
  already in the tuck, at the run's own 180. Only the standing and walking
  jumps (tags 2 and 3) play the `250 251 252` crouch first.
- **the idle fidgets.** At each idle cycle's end, `0x42993c` rolls
  `0x434540(0x2a) < 13` and, 13 times in 42, plays tag `0x434540(2) + 1` — the
  short cycle `1 3 4 5 7 6 4 2` or the look-around `10 10 11 11 12 11 12 12 13`.

Tag 5 of `0x471648` is dead code, which is the sort of thing this kind of listing
turns up: `0x429690` tests `max/2 >= current` first and installs tag 4, and only
falls through to the `max/4` test when the player is ABOVE half health — at which
point `max/4 < current` always holds. Nothing can reach it.

### Debug, and it shipped

Two of the twenty actions have no key in the shipped table, and both are a
designer's:

- **action 10** (`0x402cfe`) increments a counter, wraps it at the level's
  `initplayer` count (`0x46b9b4`) and jumps to `0x402760`: it walks the level's
  spawn points and teleports the player to each. A level-testing tool.
- **action 11** (`0x402d22`) toggles `0x46b1a8` — and that word selects between
  two whole player implementations. 0 dispatches to `0x42e360`, `0x428080`,
  `0x42e6e0`; 1 to `0x448870`, `0x448bf0`. It is a **character switch**, and the
  second character is the 7700/8300 cel set whose walk is 105, run 200 and jump
  −500.

More reachable, because the shipped table does not gate it: when the event's
modifier word has any of `0x1fa0` set, `0x403b90` routes the character through a
*second* table at `0x403ea4` instead. That one holds the debug set:

| held | key | effect |
|---|---|---|
| any modifier | `0`…`9` | `0x4274e0(n)` → `0x45ad40(n)` — **jump to a level** |
| any modifier | `Q`, `.` | abort the level |
| any modifier | `P` | `0x40e120(-1)` |
| any modifier | `T` | `0x427960(0, 0, 1, 0)`, if `0x46b1fc` is set |

The level warp's guard, `[0x470860]`, is not a debug switch: `0x427380` sets it
to 1 during startup and the test at the top of that function is an
already-initialised assertion. So the warp is live in the shipped game.

One correction falls out of the same table. This port guessed the player's walk
cels by eye, at 650…655; the engine's own script for that run is
`650 651 652 653(+95) 654(+95) 655(+95) 654(−95) 653(−95) 652 651` — it goes out
and comes back, so it is a lunge or a swing, not a walk. The walk is 100…111.

Which settles the loose end, and not in the direction hoped for: **nothing in the
platform path reads +14 at all.** The collector copies it, the appender does not
set it, and the compaction does not preserve it. So the
[flags guess](#the-flags-at-14-and-the-one-guess-this-page-makes) has no support
from this route — whatever reads that field, if anything does, reads it somewhere
else, and this page is not going to claim otherwise.

### How a level opens one

The sixteen level loaders all have the same shape, and `STREETS`' (`0x44dc10`)
reads out plainly: wrap `"theme01.snd"` and hand it to the audio loader, wrap
`"streets.sbk"` and hand it to `0x402000`, then call the record collectors —
`0x4503a0` and its siblings — one per class the level uses.

`0x402000` — read in full — takes the DFfile and its container 0 and walks the
48-byte cel-directory records to build a spatial hash the backdrop draws through,
so the cel directory this port reads is the same structure the engine opens a book
by. It immediately handles the fourCC `'SPBK'` (`0x5350424b`), the engine's runtime
type for a sprite book. It is worth knowing that this tag is
**not in the Windows files**: they carry `LPPALPPA` at 0x20 like every other
DreamFactory file on that disc, and contain no `SPBK` anywhere. The Macintosh disc
is where it comes from — `SPBK`/`SKLC` were that release's Finder type and
creator. So the Windows engine knows a book is a book because of which loader
opened it, not because the file says so, and `isSbkFile` testing the container
fourCC is the right test rather than a weak one.

## The order the levels come in

Not in the discs at all — the books sit in one directory and sort alphabetically,
which is nobody's play order. `SC.EXE` has it, and the chain is two links, each a
single reference:

**Four chapters of four stages.** `SC.EXE` has four film sequencers —
`0x44d720`, `0x436980`, `0x41f2e0`, `0x412670` — each a switch on the scene state
`[0x4abdfc]`. States 2, 3, 4 and 5 are a chapter's playable stages, and each of
those cases names its own chapter film: `chp01`…`chp04` in the first sequencer,
`chp05`…`chp08` in the second, `chp09`…`chp12` in the third, `chp13`…`chp16` in
the fourth. States 7 to 10 are the four stages' completions.

**Each case loads one book.** Forty-odd bytes after the film name, in the same
case, is the call to the loader that pushes that book's filename — at +237, +351,
+465 and +579 into every one of the four sequencers. Each `.sbk` name is pushed
exactly once from exactly one function, so the pairing is total.

| # | book | film | quota | | # | book | film | quota |
|---|---|---|---|---|---|---|---|---|
| 1 | `streets` | `chp01` | 75% | | 9 | `grave` | `chp09` | 90% |
| 2 | `city` | `chp02` | 70% | | 10 | `cavern` | `chp10` | 85% |
| 3 | `woods` | `chp03` | 55% | | 11 | `ravecave` | `chp11` | none |
| 4 | `playgr` | `chp04` | all | | 12 | `tower` | `chp12` | none |
| 5 | `mall` | `chp05` | 75% | | 13 | `maze` | `chp13` | 35% |
| 6 | `service` | `chp06` | 75% | | 14 | `barrel` | `chp14` | 55% |
| 7 | `sewer` | `chp07` | 75% | | 15 | `lab` | `chp15` | 55% |
| 8 | `arcade` | `chp08` | all | | 16 | `vat` | `chp16` | all |

`player.sbk` is in no row: no theme, no level, and loaded from a different
function altogether — the same split the files themselves show. `LEVEL_ORDER` in
`sbk.ts` carries the order and the viewer lists books by it; the quota column is
`skullcracker/src/mission.ts`, and the next section is where it comes from.

### The correction, and what caused it

The first version of this table paired each book with the **theme bank** pushed
beside it — `streets.sbk` with `theme01.snd`, `city.sbk` with `theme02.snd` — and
ordered by theme number. That agrees with the sequencers for fifteen of the
sixteen levels and puts `sewer` third. It is seventh: `theme03.snd` really is
`sewer.sbk`'s bank, but `0x436b51` — the only place in the binary that opens
`sewer.sbk` — is inside the case that plays `chp07`, in the second chapter,
between `service` and `arcade`. A level that kept its old theme number after
being moved is the kind of thing only the code can settle.

## When a level is over

Reaching the goal is half of it. `0x415f50` and its three counterparts — one per
chapter, run once an engine frame — are the whole condition:

```
0x415f7f  call 0x42f540              ; how many things are still alive
0x415f84  cmp  ax, [0x46e99c]        ; against this chapter's allowance
0x415f8b  jg   <not yet>             ; still too many: nothing happens at all
0x415f91  cmp  [0x46b1b0], 0         ; has the goal been spawned?
0x415f9b  ...  call 0x410170         ; no: put it at the level's own goal record
0x415fc2  call 0x410370              ; yes: has it been touched?
0x415fd0  mov  [0x4abdfc], 7         ; then this stage is done
```

So the quota comes first and the goal second, and **the goal is not there until
the quota is met**. The kill quota the interface panel shows is the same
subtraction this test makes, computed at `0x415f55`, which is why the two can
never disagree.

### The goal is a flying television

What `0x410170` spawns, and what `0x410480` then does with it, is the most
surprising thing in the file. The chapter's init function keeps four things off
the level's own `goal` record (`0x450060`):

| global | from the record | what it is |
|---|---|---|
| `[0x4a78f0]` | `+24, +26` — its point `(y, x)` | where the thing comes to rest |
| `[0x4a78d8]` | `+0` — its `param` | the thing's FACING, and the only use anything makes of that field |
| `[0x4a78da]`, `[0x4a78de]` | `+2…+8` — its rect | what the player has to be standing in |

Then, once the census falls to the allowance, `0x410170` in mode −1 creates an
object at `(pointY − 180, pointX)` — a hundred and eighty pixels straight up, in
the air — and starts it on `0x46be48` tag 0. Its handler `0x410480` runs three
phases:

- **descend**, while `y < pointY`: `obj+0xa = 4`, so it sinks four pixels a frame
  until it is level with the record.
- **hover**: `[0x46ba0c]` is 2, applied every frame and negated whenever the
  accumulated offset passes 5 — a slow bob through ten pixels. Cels 20210 and
  20211, two frames each, and a sound looping at its own position.
- **open**, once `0x434200(player, rect)` says the player is standing in the goal
  rect and `0x42fad0(craft, 300, 200)` agrees they are close: cels 20240 to 20255
  at two frames each, and when the last one has played `[0x46ba10]` is set and the
  stage ends. `0x410370`, the "has it been reached" call above, is seven bytes
  long and does nothing but read that word.

Rendering the cels says what it is. **20200…20207** is a bat-winged craft flying
in with `dx 15`; **20210, 20211** is the same craft edge-on, hovering; and
**20240…20255** is the craft lowering a flat panel on two arms, the last frames of
which show a picture lit up on it. It is a flying television screen, and the
sixteen missions end by walking up to one.

Modes 0 to 3 of `0x410170` are the same object arriving differently — `0x46bdf0`
tag 0 is the fly-in, and modes 2 and 3 start it 256px to one side drifting in at
−10. Chapter four uses mode −1 for all four of its stages.

The allowance is a share of the level's own population, taken once at level
start by the chapter's init function:

```
415eae  movsx eax, si                ; si = things alive after spawning
415eb9  fmul  qword ptr [0x46a068]   ; x 0.35
415ebf  call  0x45f270               ; round
415ec4  sub   si, ax
415ec7  mov   [0x46e99c], si         ; what may still be standing at the end
```

Each chapter keeps its allowance in its own word — `0x4789d4`, `0x474f0c`,
`0x47065c`, `0x46e99c` — and each stage has its own share as a `double` in
`.data`. Three stages are different in kind: the fourth case of chapters 1, 2 and
4 stores **zero**, which is an allowance nothing may survive, and the third and
fourth cases of chapter 3 store the census itself, which is an allowance met
before a blow is struck. Those two are `ravecave` and `tower`, and `tower` is
where `BELFRY.MOV` and `belfry.snd` are.

And when the clock runs out instead: `0x40e9d0` picks one of `TIME1.MOV` through
`TIME4.MOV` with `0x434540(4)`, the same random helper the punch tosses for its
variant with. Those four films are 512x232 at origin (0, 42) — they play inside
the interface's window, with the panel still around them.

`0x403340` is the same shape one state along in the game's own shell (`0x402fe0`,
the switch that plays `cyber.Mov`, `imain.Mov`, `Menu.Mov`, `prefs2`, `helpwin`,
`credits` and `char.mov`): `0x434540(7)` picking one of `KILL1.MOV` through
`KILL7.MOV`. Those seven are window-sized too, which is what says they belong to
a level in progress rather than to the shell's own screens. What enters that
state has not been read — seven of them beside four time-out ones is the reading,
not a citation.

## The classes the executable knows

97 of them, registered at 125 sites — `skullcracker/tools/scdis.mts classes`
prints the table. Six go into fixed globals and are the ones every level has:
`platform`, `obstacle`, `initplayer`, `goal`, `probe`, `suckto`. The rest are
registered per world into local registers, which is why a level's vocabulary is
its world's set plus those six.

## `PLAYER.SBK`

The degenerate case that separates the halves: 1229 cels, and a root pointing at
two empty tables. The player is a character, not a place. It is also what
identifies the big container as the level itself — every level book has one and
this book has a 28-byte stub where it would be.

## One impostor

`SUPPORT/DIRECTX/**/SYNTHGM.SBK` on the Windows disc is a **RIFF SoundFont bank**
and has nothing to do with any of this. `isSbkFile` tells them apart by the
container fourCC, which is the only honest test — the extension is shared.

## Where the code is

- [`engine/src/df/sbk.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/sbk.ts) — the reader
- [`engine/tests/sbk.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/tests/sbk.ts) — the cross-checks above, over all 17 books
- [`tools/dumpsbk.ts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/dumpsbk.ts) — a book's census and its level as a PNG
- [`skullcracker/tools/scnames.mts`](https://github.com/dhobi/dreamrefactory/blob/master/skullcracker/tools/scnames.mts) — the books' names against the binary's, which is how +22 was confirmed
- [`skullcracker/tools/scdis.mts`](https://github.com/dhobi/dreamrefactory/blob/master/skullcracker/tools/scdis.mts) — disassemble `SC.EXE`, the way `taoot/tools/disasmcmd.mts` does `TI.EXE`
- [the sprite book viewer](../../editors/books.md) — the same thing in a browser
- [Skull Cracker](../../skullcracker/README.md) — what else that disc turned out to hold
