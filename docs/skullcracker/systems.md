# What the executable runs while you play

Not the fighting and not the shell: the machinery underneath both. The camera,
gravity, ladders, the mission clock, the census that opens a goal, the save
game, the button band, and the collision test everything else is measured with.

## The head is the census, and the goal will not open without it

`0x41c591` is `0x42f870(head, 1)`. The body is not registered at all, so VAT's
whole census is the one head — and `0x416047` refuses to spawn the goal until
both the allowance is met **and** `0x46bfbc` is set, which `0x41bdd8` does when
Boggs dies. This page had VAT's census at zero of zero, which meant the sixteenth
level's ending could be walked to straight past a living Boggs. It cannot now.

The head is also where the health lives (`0x41c547` writes the four thousand
into `0x4a50e8`, which is the word the body's handler decrements) and where the
tracker lives (`0x45ef70` on the bands 250/150/80). What it does with the
tracker is look at you: `0x46e7c0`'s first nine tags are a 3×3 grid of single
cels, 5900..5908, and `0x41c182` installs one whenever the head's own script has
ended — column by how far to its left you are, row by how far above.

The claw arm is two objects and neither can be touched: both take `0x41bb10` as
their hit handler, and `0x41bb10` is `xor ax, ax; ret`. The jaws hang at the
centre of the arm cel's own collision box (`0x412180`), which is the same rule
`gripOf` reads for a grab.

Boggs' two attacks are both here now. `0x41c330` is the throw it winds up beyond
three hundred pixels on a cooldown of `0x434540(30) + 30`, out of the second of
its eight machines; `0x41c3c0` is the 7-in-55 spit, thrown at `-30 - roll(60)`
up and `roll(160) + 30` along, and what it lands is a worm that waits, rises and
strikes. So Boggs lunges, heals, throws, spits and dies.

## A record belongs to one room

`0x40b940`'s kind 2 walks the region table and answers with the FIRST region
whose rect contains the point. Rooms overlap — that is how you walk out of one
and into the next — and a creature standing in a seam was being spawned once per
room it fell in. BARREL's two regions overlap x7464…7691 and its cop at x7521
stands in that seam, so a level of twelve had a census of thirteen and a kill
quota that could never be met. Each record is claimed once now, first room wins.

## The mission clock was a record all along

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

## Gravity was in there all along

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

## The letters under the buttons are typeset from the key map

`0x40cf00` builds the whole panel — the two bands, then eight of these:

```
  40d0fc  ecx = [0x46bd58 + i*4]  ; the point, {y, x}
  40d10d  0x40e870(i + 1, &buf)   ; name the key bound to action i+1
  40d11a  0x40a430(&buf)          ; how wide that name is
  40d125  edi = (15 - width) >> 1 ; centred in a box fifteen wide
  40d139  0x40a080(x + edi, y)    ; and write it
```

`0x40e870` is the same namer the preferences panel uses and `i + 1` is the same
action number, so the W, A, S, D in the pad and the J, K, P, I on the four
buttons are not in the cel at all: they are read out of `0x46b210` every time
the panel is built. Rebind punch to Z in the preferences panel and the band says
Z. That is what makes the eight boxes worth having.

And the point is the glyph's BASELINE. `0x40a080` only stores it and hands it to
the text object, so the binary does not say — but the DISC does: `helpwin.mov`'s
own INTERFACE page bakes a picture of this panel with all eight letters on it,
and measured off that page every glyph's centre sits five to eight pixels above
its entry in `0x46bd58`. Taking the point as the top drew them all a line low,
which is what it looked like.

## Nothing clicks the band

The buttons look like buttons and they are not. `[0x4a3b48]` — the word
`0x40da41` walks to decide which eight lights to redraw — has exactly one
writer, `0x40d470`, and that has exactly two callers, both inside `0x403820`:
the function that turns an action into a bit. `0x403820`'s own callers are the
key map and the demo replay. There is no third.

The level's event loop does take a mouse event. It is not a click: event 6 in
`0x403b90`'s table hides the cursor, calls `0x40cf00` to rebuild the panel, and
shows it again — a repaint. The buttons are an indicator, and the only way to
punch is the key the band is telling you about.

## The camera was in there all along

This page carried an invented camera for a long time, on a stated belief: that
`SC.EXE` "scrolls by moving the world rather than the view", so there is no
camera variable to read. There is one, and everything about it is readable.

### `[0x4a8970]` is the view's corner, and `0x4308a0` is what writes it

`0x4309d0` answers with the two words at `0x4a8970`, and every draw subtracts
them. What hid it is that nothing assigns them directly: they are written by
`0x4308a0`, which takes a requested corner and clamps it, and by `0x430bc0`,
which restores one. `0x40e120` — the Ctrl+P handler — hands the base rect in:
`{0, 0, 0xe8, 0x200}` with the panel up and `{0, 0, 0x156, 0x200}` without, so
the view is 512x232 and 512x342 and both are already on this page.

### The clamp is the ROOM's rect, one side at a time

`0x4308a0` copies the room's whole 48-byte entity record — `0x40ba30`, out of
the level's own table, indexed by the tracked object's `+0x16` — and then:

```
  430914  test byte [rec+14], 8   ; cap   x at right  - viewWidth
  43092c  test byte [rec+14], 2   ; floor x at left
  430950  test byte [rec+14], 4   ; cap   y at bottom - viewHeight
  430968  test byte [rec+14], 1   ; floor y at top
```

`rec+14` is the `flags` field the reader already carried and had no use for. For
an OBJECT its four bits are almost always all set; for a ROOM they are the
camera's clamp mask, and the shipped values are 15, 13, 12, 7 and 5 — ARCADE
clamps on all four sides, RAVECAVE's four rooms do not clamp left or top, and
SEWER's shafts clamp neither side horizontally. The floor is applied after the
cap, so a room narrower than the view is pinned to its left edge rather than
centred.

### The follow is an eased chase with a lead

`0x4309f0`, once an engine frame:

```
  430a1c  target = player point
  430a30  target.x += 0x78, or -= 0x78 when [player+0x28] says left
  430a42  target.y -= lift        ; and lift is 0 in every state that sets one
  430a81  chase = [0x4a6938] translated by the view's own corner
  430ab2  dx = (target.x - chaseMidX) * 0x32 / 0x118, clamped to +-0x32
  430af2  dy = (target.y - chaseMidY) * 0x32 / 0x64,  clamped to +-0x32
  430b46  corner += (dx, dy), then 0x4308a0
```

`0x4a6938` is `{50, 200, 182, 312}`, written at `0x42aec8` — its middle is
(256, 116), which is the middle of the 512x232 window. So the player's own point
is held at the centre of the window, 120 pixels behind whichever way they are
facing, and the view eases there at up to 50 pixels an engine frame, reaching
that cap at 280 pixels of horizontal error and 100 of vertical. `0x430c20` is
what installs the four numbers and different player states install different
ones — the hurt path raises the horizontal cap to 100.

An arrival does not ease. `0x428ff6` and `0x443a3d` — one per player class —
put the corner at `(x - 200, y - 100)` the moment the point is moved, and clamp
that. It is deliberately not the chase point, which would be `(x - 256, y - 116)`.

### What it replaced, and what it fixed

Two inventions go. The old camera centred on the middle of the player's
collision box, chosen because centring on the FEET cut the top off the sprite;
the engine's target is the object's own point and the pose does not enter into
it. And the old clamp used the extent of the FLOOR rather than the room, which
is narrower in nine of the sixteen levels.

VAT is where that showed. Its chamber's rect runs to x6688 and its floor stops
at x6653, and machine B — `0x46e088`'s `+373` off Boggs' x6321 — stands at
x6694. Clamped to the floor the view could never reach it; clamped to the room
it does, which is the 35 pixels between them.

### The step had to be spread across the frame

One thing here is not the engine's shape. `0x4309f0` runs once an engine frame
and jumps the corner the whole way, which it can do because everything on that
disc moves at 15Hz. This page moves the player every TICK, four to the frame, so
a camera that jumped once a frame scrolled the world in 15Hz steps behind a man
walking at 60 — and that is exactly what it looked like. The step is decided at
the frame, on the disc's own arithmetic, and then spent a quarter at a time, the
same way the frame's fall already is. At every frame boundary the corner is where
`0x4309f0` would have put it. The corner is rounded only at the blit, or the
whole backdrop resamples.

## A collision box is a translation, and nothing else

SEWER's bush is the only grabber in the game that comes up out of the floor, and
on this page it could not reach a player walking under it. The last seven cels of
its rise carry a strike box and no blow pair — the grip signature the hand and
the claw have — so closing on you is the whole point of it, and the grab only
ever landed once the bush had already given up and started sinking. A grab on the
way down.

The cause was not the bush. `0x40e680` is the engine's fine collision test and
what it does with a cel's authored rect is this:

```
  40e688  eax = [edx]        ; the four words of the rect, copied
  40e6a2  x0' = -x1          ; ...negated about the anchor if the object
  40e6b3  x1' = -x0          ;    is mirrored, and that is the whole mirror
  40e6fe  0x434270(rect, obj+6)   ; a rect TRANSLATE by the object's position
  40e72c  0x434140(a, b)          ; and an intersect
```

A translate. No width, no height, no anchor arithmetic — the rect is already
anchor-relative, exactly the way `drawLevelCel` hangs the art. This page was
translating every prop's box as if the rect were measured from the cel's
top-left, which lifted it by `height - posY`: sixty-four pixels on the bush's cel
5030, seventy-six to a hundred and twenty-seven on the claw's.

The player was never wrong, because the player's `y` is the ground it stands on
rather than an anchor and the conversion it needs is the same expression by
coincidence. Every prop was.

What it had cost, besides the bush:

- **BARREL's claw** had been moved to its record's rect BOTTOM to make it reach
  anybody — `bottom - point` is 113, 136, 115 and 177 across its four, against a
  lift of 76..127. Close enough to work and never the same number, which is what
  a compensation looks like from the outside. `0x411cfd` writes the record's
  POINT into `obj+6` and `0x411d02` takes ten off the X, and from there the
  fourth claw closes 34 pixels into a player standing under it.
- The other two of BARREL's four hang 450 and 780 pixels above their own floor
  and reach nobody from either y, which is presumably why one of them is over a
  pit.

The lesson is the one this page keeps relearning: a number that nearly works is
worth less than the instruction that produced it. Both of these were settled by
reading the translate, not by tuning a y until a test went green.

## A ladder is not a room's to hold

Two levels were reported unclimbable — TOWER and MAZE, "ladders are not usable"
— and the fault was one line of this page's own filing.

`solidsIn` gathers the records standing in a region by asking where each one's
CENTRE falls. For a `platform` or an `obstacle` that is fine: they lie inside a
room by construction. A ladder is the one record in the game whose whole purpose
is to leave one, and nine of them ship:

```
  STREETS   1 ladder    inside room 0                    worked
  RAVECAVE  1 ladder    inside room 1                    worked
  SEWER     3 ladders   two of them reach across 2 rooms
  TOWER     3 ladders   reach across 2, 3 and 4 rooms
  MAZE      4 ladders   centre in NO room at all
```

MAZE's four sit in the gaps between its seven regions — the first misses room
0's bottom edge by ONE pixel — so every one of them was filed nowhere and the
level had no ladders whatever. TOWER's three each answered from exactly one
room, the one that happened to own their middle, which for two of the three is
not the room you climb from: all three lifted the player zero pixels.

The engine files nothing. `0x40b940` is its only entity query and it is a linear
scan of the whole table — `[0x46b9a8]+0x1c`, stride 48, `[+0x18]` records —
with three kinds: 0 compares the name (`0x4343b0`), 1 compares the param, and 2
asks whether the rect holds a point (`0x434200`). The ladder grab is the scan
by name, `0x40b660("ladder", player, 0, 1)`, whose third argument is the region
and is 0, and whose fourth is the geometry: 1 is `0x434140`, the player's
current cel — its whole bitmap about the anchor, `0x42f9f0` — intersected with
the record's rect. No region anywhere in it. So the ladders are kept whole on
the level and the room is not consulted.

### Three things a ladder will not do

Reported after the fix above: the port speed-climbed with a direction held, the
figure flickered at the top, and it grabbed from too far off. All three are one
state, `0x42ae50`, and the two that ask for it, read exactly.

- **W grabs only from standing still.** `0x429872` is in the idle state and
  runs with forward not held; the walk and run states never ask. W is the run
  key, so a runner passing a ladder passes it. S asks from the idle, walk, run
  and jump states, so a ladder can be taken downward on the move. The rect is
  met by the standing cel's bitmap, 98 wide with the anchor 41 in — so the
  grab reaches 57px past one edge and 41 past the other, and that is the
  file's reach, not a snap of the port's.
- **Letting go waits for the rung, and for a room.** The leave needs the rung
  tag ENDED and the classifier `0x412517` to find a record under the anchor
  (`0x40b940(2, point)`), which the mount had set to -1. Then `[0x46b1b8]` is
  set and stays set until `0x42849c` sees the ground, and neither the idle nor
  the jump state will grab while it is. The port let go the tick a direction
  came down and grabbed again the next, one rung higher each time.
- **The ends hold.** At rung 0 with W, or the last with S, `cmp [0x4ac406], 0;
  jle` skips the case whole — no tag, no sound. The port installed the other
  tag of the same direction, four frames each way, which is the flicker.

### The region you are in is whichever one contains your point

The other half was the same rule applied on the other axis. This page already
re-asks `0x40b940(2, point)` every time the player moves SIDEWAYS — that is what
made MALL crossable — but nothing re-asked it when the player moved UP, because
until now nothing moved the player far enough for it to matter. A ladder does:
MAZE's first runs 1426px from one region down into another, and TOWER's third
crosses four. Without the re-ask the climb tops out still standing in the room
below, which has no floor up there and none of the platforms the ladder was put
there to reach.

MAZE also answered a question that was not asked. Its `newroom1` has no
rasterised ground at all, and the foot of two of its ladders is in that region:
a player put down there falls out of the world. Those two are climbed DOWN into,
not up out of, which is why the tests for them start at the head.

## There is a save game, and it is twenty-two bytes

This page said for a long time that `SC.EXE` has no save game. It has one, and
the reason it was missed is worth recording: the only text that names the format
lives in the resource string table as **UTF-16**, at `0x4b62f8` —

```
  0c "SkullCracker"
  1a "Saved games (.SKL)|*.skl||"
```

— so an ASCII search of the whole executable for "SKL" returns nothing at all.
What it does return is `skuldemo.dmo`, "Save in which slot?" and "Load from which
slot?", and those belong to the demo recorder, which really is dead: `0x4038d0`
runs only while `[0x46b310]` is set and nothing in the shipped build ever sets
it. Two save-shaped things in one program, one of them dead, and the live one
invisible to `strings`.

`GetSaveFileNameA` and `GetOpenFileNameA` are both imported and each is called
exactly once — `0x40a869` and `0x40af33`. The writer is `0x45e1e0`, the reader
`0x45df8d`.

```
  +0x00  u32  0x00010000    written by 0x45e246, read by nobody
  +0x04  u16  [0x4abdfe]    the shell scene  -> the chapter
  +0x06  u16  [0x4abdfc]    the stage within it -> the level
  +0x08  u32  [0x4a4f00]    the score
  +0x0c  u16  [0x4a4d64]    lives
  +0x0e  u16  [0x479434]    the weapon, or 1 for none
  +0x10  u16  [0x4a7f16 + weapon*12]   its rounds
  +0x12  u32  0             written by 0x45e2bd, read by nobody
```

No header, no magic, no checksum, no padding: `0x41daf0` writes one call of 0x16
bytes and the file IS the record. The Macintosh type and creator the create call
carries — `'SSAV'` and `'SKLC'` — are arguments to the portability layer and
reach the disc only on a Mac; on Windows `0x41dc60` hands `CreateFileA` the path
and nothing else. Nothing in the program will reject a file for anything but its
length, and the loader reads all twenty-two bytes and then starts at offset FOUR,
so the stamp at the front is not a version.

**The level is not in the file.** The scene is the outer state machine's own —
`0x403059` dispatches on it through `0x403448`, where 1 is the title, 3..6 are
the four chapters and 11 is quit — and the stage is the chapter runner's own
counter. All four runners dispatch it through a table of their own (`0x44da38`,
`0x436c9c`, `0x41f5fc`, `0x4129c8`) and in all four, stages two through five are
that chapter's four levels in order.

**And neither is anything else.** No character, no difficulty, no position, no
health, no clock, no kill count. A load re-enters the chapter runner at the saved
stage and the level starts from its own record's point. The gun is the single
exception, and deliberately: `0x44da80` and its three siblings zero all
twenty-one rounds counts on entering a chapter, but only while `[0x47913c]` is 0,
and `0x45e069` sets it to 1 on a load. `0x479438`, the ARMED flag, is not in the
file, so a loaded game has the weapon in the inventory and not in its hands.

The last thing `0x45df8d` does is `[0x46b208] = -1`, which is the value BEGIN
sets. A loaded game runs the character chooser like a new one, because the file
has no character in it to run instead.

### The panel it is written from, and the two keys that open it

`0x403c7b` is the only caller of `0x404280`, and the key dispatcher reaches it
from two characters. `0x403c40` splits on the event record's modifier word:
zero goes to the ordinary game binding through `0x46b210`, nonzero to a second
table at `0x403ea4` where only five characters are bound at all — `'.'` and
`'Q'` to the panel, `'P'`, `'T'` and the digits elsewhere. And the modifier word
is not the Macintosh one it looks like: `0x405787` asks
`GetKeyState(VK_CONTROL)` and `0x4057a5` sets it to `0x1fa0` entire when the
answer is down, zero otherwise. **So the panel opens on Ctrl+Q or Ctrl+.** —
not ESC, which is below the first table's range and does nothing in a level.
This port binds ESC as well, because it is what a reader will press.

`0x4042af` picks the film by chapter and all four are one shape: the logic
frames loop (the last is a type-2 jump back to "X 3") with three regions live
throughout, and the last three frames of the file are the answers. Which answer
is which is in the segment header rather than the picture — `actionFrame1` names
the MIDDLE button, `actionFrame2` the BOTTOM one, and the top is named by
neither:

```
  top     no actionframe   the film just ends    ->  Continue
  middle  actionframe 1    0x45e1e0(1)           ->  Save
  bottom  actionframe 2    0x45e1e0(2)           ->  Exit
```

`0x404303` closes it: state 5 leaves the level, anything else redraws
(`0x40cf00`) and plays on. There is no Load in the panel — Load is the title
screen's own button.

### Forty-two pixels, which is why the buttons did nothing

A region is in its SEGMENT's coordinates, like every other number in one, and
this player compared them against the screen. It had never mattered, because
every film in this game that has regions is full-screen at origin (0,0):
`menu.mov`, `char.mov`, the two pans, the prefs panels. The four pause films are
the only exception — 512x232 at origin (0, 42), inside the interface's own
window — and they are also the only films whose regions have words written on
them, so they are the only place being 42 pixels out is visible.

The picture settles it. `pauseA` draws Continue, Save and Exit centred on screen
y160, y193 and y225; its three regions are y107-133, y141-167 and y172-198.
Shifted by the origin those are y149-175, y183-209 and y214-240 — one label
each, dead centre. Unshifted they land on the blank plates above Continue and on
the bezel, which is where every click on this panel went.
