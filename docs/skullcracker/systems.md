# What the executable runs while you play

Not the fighting and not the shell: the machinery underneath both. The camera,
gravity, ladders, the mission clock, the census that opens a goal, the save
game, the button band, and the collision test everything else is measured with.

## The head is the census, and the goal will not open without it

`0x41c591` is `0x42f870(head, 1)`. The body is not registered at all, so VAT's
whole census is the one head — and `0x416047` refuses to spawn the goal until
both the allowance is met **and** `0x46bfbc` is set, which `0x41bdd8` does when
Boggs dies. The sixteenth level's ending cannot be reached past a living Boggs.

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

Boggs has two attacks. `0x41c330` is the throw it winds up beyond three hundred
pixels on a cooldown of `0x434540(30) + 30`, out of the second of its eight
machines; `0x41c3c0` is the 7-in-55 spit, thrown at `-30 - roll(60)` up and
`roll(160) + 30` along, and what it lands is a worm that waits, rises and
strikes. So Boggs lunges, heals, throws, spits and dies.

## A record belongs to one room

`0x40b940`'s kind 2 walks the region table and answers with the FIRST region
whose rect contains the point. Rooms overlap — that is how you walk out of one
and into the next — so a creature standing in a seam must be spawned once, not
once per room it falls in. BARREL's two regions overlap x7464…7691 and its cop at
x7521 stands in that seam; counted twice, a level of twelve would have a census
of thirteen and a kill quota that could never be met. Each record is claimed
once, first room wins.

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

The five without a record are the two whose bosses the level waits for, and
chapter three's and four's last stages.

What is left on the clock when you reach the goal is paid out. The craft's
think calls `0x40ffe0` as the screen's last cel runs out (`0x41074d`). That
function is a loop of its own, and the whole game waits on it. It starts at
the dial cel on show (`[0x4a4d60]`) and steps up to the empty 12717. Each
step is ten frames, and each frame adds a hundred to the score and plays the
character's own 0x1f (0x18 for the second character) through `0x40f110`. So a
step is worth a thousand, and a full eight-minute dial is seventeen thousand
over 170 frames. Nothing moves and no key is read while it runs. Then the
clock goes to 32000 and the stage ends. Past step 12 the dial flashes, and a
goal reached on a frame that shows the empty dial pays nothing. A level with
no `timer` pays nothing either.

The keys are shut from the moment the screen starts down. `0x402be0`, the one
place a key becomes an action, does nothing while `[0x46b1d4]` is 0, and the
craft's think writes it through `0x402e30`: 0 as the screen starts down
(`0x410702`), 1 once the tally has run (`0x410754`). Both calls also drop every
key held (`0x402db0`), so the player stands at the goal while it opens. The
player's own set-up opens the keys at every level start (`0x402df0`, from
`0x448a93` and `0x42e583`), and `0x402fa0`, the call that puts the player in
a state, drops them first thing (`0x402df0`): a death from the health
(`0x402af4`), a grave (`0x421239`), TOWER's floor (`0x42713e`), a fan's blades
(`0x4154b7`, `0x415a89`) — and every frame inside 270 of a horizontal fan that
is sucking (`0x415588`), so a held key does not walk you out of its pull.

The craft hums while it waits. For every frame of its life at a goal, its
think asks for the character's 0x1c (0x15 for the second character) through
`0x40ef30`. The mixer refuses the sound while it is still playing, so the
hum carries on unbroken. As the screen starts down, the craft plays 0x1d
(0x16) once (`0x4106d9`).

## Gravity was in there all along

Gravity is not in any animation script — the player has exactly one script
record with a nonzero `dy`, the launch, `dy -420`. The fall is a FIELD:

```
0x402784  0x42f850(player, 1.0f)      where the player is placed
0x42f850  obj+0x24 = trunc(f * 10.0)  0x46a110 is 10.0 — so the player's is 10
0x430327  if (!landed) obj+0xa = obj+0x24 + <this frame's vy>
```

`obj+0xa` is a velocity in whole pixels that the stepper `0x42fd80` adds to the
position undivided, so the player accelerates downward by **10 pixels a
frame²**. (`0x46a110` is 10.0, not 100.0; reading it as 100.0 and dividing by the
class's `obj+0xe`, 12 for the player, gives a wrong 8.33.) The whole engine's
gravity is one float per object: a plank that has given way gets `3.0f`, three
times the player's, and anything that must not fall gets 0.

A screen capture of the original agrees. The engine's camera follows the player
vertically and no plane has vertical parallax (a local template match of a near
layer and a far one returns identical `dy` on every frame, to the pixel), so the
background's shift between frames *is* the player's. That gives an apex of
**73px at 483ms**, `g = 8.75²/(2×73) = 0.524` a tick².

The engine steps gravity once a FRAME and in whole pixels, so the rise is a sum
of four terms rather than an integral — `35 + 25 + 15 + 5 = 80px` — and the
capture's 73 is that same jump seen through a camera that cannot show the first
frame's full 35 pixels. The lift is worth more than it looks: `0x4723f0` allows
two frames of `-125`, which is −11 on the velocity each, and because the tag-0
handler that spends them is first run two frames after the launch (the launch
frame ends the launch tag; the next installs tag 0; the one after reads a key)
they land on the velocity at −15 and −16 rather than at the top, and the apex
comes out at **137**. That is what makes CITY's opening passable: its first wall
wants 101 pixels and a held jump has 137.

The same two-frame delay is the shape of the jump sideways. Steering — 30 pixels
a frame while forward is held, nothing slowing it in the air — begins on that same
third airborne frame, so a standing jump with the direction held travels 180 and
lands at about 220, a held one 330, and a run's leap, which leaves the ground at
the run's 22 plus its own 15, 360. A jump pressed from a standstill or a walk
crouches for three frames first (`250 251 252`, dx 0, the walk's velocity draining
under the drag) and only 253 launches; the run's tag 4 is one record and launches
at once. Every jump lands in tag 1, four frames of `251 252 251 250` in which the
handler reads no key and the slide is the drag's. A fall that passes 360 is no
longer a jump at all: the state machine's preamble (`0x4284ba`) forces the flail,
`0x472350` (cel 941), which zeroes the sideways speed, reads no key and screams
once past 630. It lands in `0x471c68` tag 5 with sound 5, ten health off and a
jolt of the view (`0x4307c0(1)`), or past 530 in the dying script.

Once tag 0 is playing, K and P start the flight's own attacks: tag 8, move 9,
and tag 9, move 4 (`0x42a036`, `0x42a082`). Their handler, `0x42a1e3`, runs the
same lift and steering as tag 0 and asks `0x4029e0` for the blow's strength
every frame, so a held kick weakens by five a frame. The player's scripts never
loop: `0x45d070` clears `obj+0x4a` and nothing sets it again. So a kick that
runs out in the air holds its last cel, 689, all the way down, and no second
attack can start in that jump. The attack ends only when the tag is done and
the player is down (`0x42a33a`). A kick that lands early plays out on the ground,
still steering, and only then comes the landing tag. The run's flying kick
(`0x471d68` tag 4) ends the same way: it holds 688 until it is falling at 32 or
more, has landed or has connected (`obj+0x2a`). Then tag 3 holds 689 to the
ground (`0x42a7ee`, `0x42a784`), and it goes straight to the idle, with no
landing tag.

Walking or running off an edge is not a jump. The walk state puts the idle's
tag 1 in the frame the floor goes (`0x42999e`), and the run its own tag 1
(`0x429bf0`). Neither the idle nor the run asks for a floor before it reads J, P
or K, so a fall off an edge still answers all three:

- the idle's J is the standing jump, three frames of wind-up in the air, then
  −35 added to the fall;
- the run's J is tag 4's leap, at once;
- P and K are the ground's punch and kick, and the run's K is the flying kick;
- a ground move that ends in the air hands back to the idle, still falling.

The flail at 360 ends it, as it ends everything.

STREETS' hardest jump is an 85px roof gap, which sits between the plain jump and
the jump-with-lift; that is what `0x4723f0` is for. At the disc's own gravity and
airborne horizontal the disc's own gaps close with no scale factor.

`PLAYER.SBK` also holds the interface, all of it: `12000` is the upper band and
`12001` the lower, both 512 wide, and between them sit the two sliding health
bars, the score, the two name plates, the pad's eight lights, the special
weapon's gauge, the five life lights, the seventeen-cel mission dial and the kill
quota's two numerals. Every coordinate is a literal in `SC.EXE`'s own painter
`0x40d500`, and the geometry falls out of one of them: `0x40dc10` offsets the
lower band's clip rect by −274, the same amount the plotter `0x40dcd0` subtracts
from every screen y, which puts that band at y272 and the level's window at
(0, 42) to (512, 274) — exactly where the pause films play.
`docs/engine/formats/sbk.md` has the full table; the walk page draws all of it,
and Ctrl+P toggles it the way the game's own help screen says it does. The four
rows of sixteen at x417 are the WEAPON's magazine, inside the special-weapon
window, not the player's health.

Ctrl+P also sets the other window. `0x40e120` is that key's handler and besides
flipping the flag it hands `0x430860` a view rect: `{0, 0, 0xe8, 0x200}` with the
panel up and `{0, 0, 0x156, 0x200}` without — **512x232 and 512x342**. Those are
surface coordinates and the level's surface starts 42 rows down, so 42 + 342 is
exactly the screen's 384: full-screen mode is the same window grown downwards into
the panel's space, not the whole screen.

The view is a 232-tall slot in the room's rect (see
[the camera](#the-camera-was-in-there-all-along) below). With the slot clamped to
the room, the player's feet sit where the original's screenshots put them — near
the bottom of the window, with the ground filling the last forty rows.

STREETS' own route to its goal confirms the rects, and falls out of the data
without being designed for: the ladder at x9632 lifts you from the pavement to
its top rung at y732 — which is where the player's ANCHOR goes, so their feet
arrive at 828 and the roof beside it is y854 — and from there the platform tops
at 854, 980, 895, 941 and 1033 step west along the rooftops to the `goal` rect at
y794…1035. The player's feet land on the drawn edge of the theatre marquee; the
rect is the disc's and so is the art.

`PLAYER.SBK` is the degenerate case that proves the split: all cels, and a root
pointing at two empty tables — the player has no level. The books hold almost no
BEHAVIOUR: `initzomb` says where the zombie starts, and what a zombie does is
native code. The exception is per-cel — a cel record carries the frame's strike
box, its collision box and the blow it lands, so how hard a punch hits is in the
book. The layers only align under the executable's camera, so a flat render is
the level unrolled, not a screenshot.

(The tag `SPBK`/`SKLC` is the Mac disc's Finder type/creator at 0x20, not a
format signature; the Windows disc stamps the same files `LPPALPPA` like every
other DreamFactory file. And one impostor shares the extension:
`SUPPORT/DIRECTX/**/SYNTHGM.SBK` is a RIFF SoundFont bank.)

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
Z.

The point is the glyph's BASELINE. `0x40a080` only stores it and hands it to the
text object, so the binary does not say — but `helpwin.mov`'s own INTERFACE page
bakes a picture of this panel with all eight letters on it, and measured off that
page every glyph's centre sits five to eight pixels above its entry in
`0x46bd58`. Taking the point as the top draws them all a line low.

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

`SC.EXE` has a camera variable, and everything about it is readable.

### `[0x4a8970]` is the view's corner, and `0x4308a0` is what writes it

`0x4309d0` answers with the two words at `0x4a8970`, and every draw subtracts
them. Nothing assigns them directly: they are written by `0x4308a0`, which takes
a requested corner and clamps it, and by `0x430bc0`, which restores one.
`0x40e120` — the Ctrl+P handler — hands the base rect in: `{0, 0, 0xe8, 0x200}`
with the panel up and `{0, 0, 0x156, 0x200}` without, so the view is 512x232 and
512x342.

### The clamp is the ROOM's rect, one side at a time

`0x4308a0` copies the room's whole 48-byte entity record — `0x40ba30`, out of
the level's own table, indexed by the tracked object's `+0x16` — and then:

```
  430914  test byte [rec+14], 8   ; cap   x at right  - viewWidth
  43092c  test byte [rec+14], 2   ; floor x at left
  430950  test byte [rec+14], 4   ; cap   y at bottom - viewHeight
  430968  test byte [rec+14], 1   ; floor y at top
```

`rec+14` is the record's `flags` field. For an OBJECT its four bits are almost
always all set; for a ROOM they are the camera's clamp mask, and the shipped
values are 15, 13, 12, 7 and 5 — ARCADE clamps on all four sides, RAVECAVE's four
rooms do not clamp left or top, and SEWER's shafts clamp neither side
horizontally. The floor is applied after the cap, so a room narrower than the
view is pinned to its left edge rather than centred.

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

The target is the object's own point; the pose, and the collision box, do not
enter into it. The clamp is the room's rect, not the extent of the FLOOR, which
is narrower in nine of the sixteen levels.

VAT is where the difference shows. Its chamber's rect runs to x6688 and its floor
stops at x6653, and machine B — `0x46e088`'s `+373` off Boggs' x6321 — stands at
x6694. Clamped to the floor the view could never reach it; clamped to the room it
does, which is the 35 pixels between them.

### The step had to be spread across the frame

One thing here is not the engine's shape. `0x4309f0` runs once an engine frame
and jumps the corner the whole way, which it can do because everything on that
disc moves at 15Hz. This page moves the player every TICK, four to the frame, so
a camera that jumped once a frame would scroll the world in 15Hz steps behind a
man walking at 60. The step is decided at the frame, on the disc's own
arithmetic, and then spent a quarter at a time, the same way the frame's fall
is. At every frame boundary the corner is where `0x4309f0` would have put it.
The corner is rounded only at the blit, or the whole backdrop resamples.

## One engine frame, in the order the disc runs it

Each of the sixteen levels has its own frame loop, and all sixteen have one
shape. VAT's is `0x419c0b`..`0x419e35`, STREETS' `0x44dcfc`..`0x44de83`, MALL's
`0x43702c`..`0x4371a6`, GRAVE's `0x41fa18`..`0x41fb6a`:

1. the chapter's end test (`0x450190`, `0x43b950`, `0x421900`, `0x415f50`);
2. the player's think, `0x402950` — a few levels run one class first
   (BARREL's `0x4170f0`, MALL's `0x4375d0`, SEWER's `0x43d680`);
3. every class's think, `0x430f10` once per class list: the creatures, the
   furniture, the casts, the goal's craft (`0x410380`), the pickups
   (`0x45ad90`) and the goo (`0x40c8f0`);
4. `0x42fc10`, the world step, in one call:
   - every object's script steps (`0x45d0f0`), which is where a script's own
     `dx`/`dy` go into the velocity (`0x42f8b0`);
   - each current cel's rects are fetched (`0x42f9f0`);
   - the body pass pushes overlapping bodies apart (`0x430680`);
   - the hit pass runs with every object as the hitter (`0x42fc9a` →
     `0x430350`);
   - the platforms follow the things they ride on (`0x434270`);
   - and only then does every object MOVE (`0x42fd80`: velocity, floor, walls,
     drag, gravity), and the camera follows (`0x4309f0`);
5. VAT alone then re-places Boggs' rig against the body's new point: the head
   (`0x41c4c0`), the eight machines (`0x411ed0`), the arm (`0x412180`) and the
   worms in their box (`0x41ab90`);
6. the draws, the flip, the theme and the input.

So a blow is judged on the cel this frame's thinks and script steps put up, at
the place the last frame's move left everything, and the hit pass zeroes a
hitter's strength when the victim's handler takes the blow (`0x43045d`). A
thing hit this frame moves this frame on the velocity the hit traded it
(`0x430470`), and what a hit puts on — a grab, a flinch — is acted on by the
next frame's thinks.

This page moves things every tick, four to the frame, and runs each class's
think and move together. `hitPass` in `game.ts` keeps the disc's order the only
way that shape allows: it runs on the frame tick after every think and after the
player's cel for the frame is chosen, with everything put back where it stood
when the frame tick began, and whatever the pass itself moves is kept. The body
pass runs first inside it, on the same cels and places, and what it takes off
a body's speed is taken there and then, as a hit's trade is. The flare and the
blaster's bolt are hitters in the same pass: each is tested where it stood as
the frame began, and a bolt made this frame is tested where it was made. A
bolt's box is six pixels wide and the bolt crosses a hundred pixels a frame, so
it goes clean through anything it does not happen to land in. That is the
engine's own behaviour, and it means where you stand to shoot decides what the
blaster reaches.

## A collision box is a translation, and nothing else

`0x40e680` is the engine's fine collision test and what it does with a cel's
authored rect is this:

```
  40e688  eax = [edx]        ; the four words of the rect, copied
  40e6a2  x0' = -x1          ; ...negated about the anchor if the object
  40e6b3  x1' = -x0          ;    is mirrored, and that is the whole mirror
  40e6fe  0x434270(rect, obj+6)   ; a rect TRANSLATE by the object's position
  40e72c  0x434140(a, b)          ; and an intersect
```

A translate. No width, no height, no anchor arithmetic — the rect is already
anchor-relative, exactly the way `drawLevelCel` hangs the art. Treating it as
measured from the cel's top-left lifts a box by `height - posY`: sixty-four
pixels on the bush's cel 5030, seventy-six to a hundred and twenty-seven on the
claw's. The player's `y` is the ground it stands on rather than an anchor, and
the conversion it needs happens to be the same expression, so only props show
the difference.

What depends on it:

- **SEWER's bush** is the only grabber in the game that comes up out of the
  floor. The last seven cels of its rise carry a strike box and no blow pair —
  the grip signature the hand and the claw have — so it grabs a player walking
  under it while it rises, not only as it sinks.
- **BARREL's claw** hangs at its record's POINT: `0x411cfd` writes the point
  into `obj+6` and `0x411d02` takes ten off the X, and from there the fourth
  claw closes 34 pixels into a player standing under it.
- The other two of BARREL's four hang 450 and 780 pixels above their own floor
  and reach nobody, which is presumably why one of them is over a pit.

## A ladder is not a room's to hold

Ladders are kept whole on the level, not filed under a room. Filing records by
where each one's CENTRE falls (as `solidsIn` does for a `platform` or an
`obstacle`, which lie inside a room by construction) loses them: a ladder is the
one record in the game whose whole purpose is to leave a room, and nine of them
ship:

```
  STREETS   1 ladder    inside room 0                    worked
  RAVECAVE  1 ladder    inside room 1                    worked
  SEWER     3 ladders   two of them reach across 2 rooms
  TOWER     3 ladders   reach across 2, 3 and 4 rooms
  MAZE      4 ladders   centre in NO room at all
```

MAZE's four sit in the gaps between its seven regions — the first misses room
0's bottom edge by ONE pixel — so filed by centre the level has no ladders at
all. TOWER's three would each answer from the room that owns their middle, which
for two of the three is not the room you climb from.

The engine files nothing. `0x40b940` is its only entity query and it is a linear
scan of the whole table — `[0x46b9a8]+0x1c`, stride 48, `[+0x18]` records —
with three kinds: 0 compares the name (`0x4343b0`), 1 compares the param, and 2
asks whether the rect holds a point (`0x434200`). The ladder grab is the scan
by name, `0x40b660("ladder", player, 0, 1)`, whose third argument is the region
and is 0, and whose fourth is the geometry: 1 is `0x434140`, the player's
current cel — its whole bitmap about the anchor, `0x42f9f0` — intersected with
the record's rect. No region anywhere in it, so the room is not consulted.

### Three things a ladder will not do

All three are one state, `0x42ae50`, and the two that ask for it.

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
  the jump state will grab while it is. Without that, a held direction lets go
  and regrabs one rung higher every tick.
- **The ends hold.** At rung 0 with W, or the last with S, `cmp [0x4ac406], 0;
  jle` skips the case whole — no tag, no sound, no flicker between the two tags
  of the same direction.

### The region you are in is whichever one contains your point

`0x40b940(2, point)` is re-asked whenever the player moves, vertically as well as
sideways — the sideways re-ask is what makes MALL crossable, and a ladder is what
moves the player far enough vertically for it to matter. MAZE's first runs 1426px
from one region down into another, and TOWER's third crosses four. Without the
re-ask the climb tops out still standing in the room below, which has no floor up
there and none of the platforms the ladder was put there to reach.

MAZE's `newroom1` has no rasterised ground at all, and the foot of two of its
ladders is in that region: a player put down there falls out of the world. Those
two are climbed DOWN into, not up out of, which is why the tests for them start
at the head.

## There is a save game, and it is twenty-two bytes

The only text that names the format lives in the resource string table as
**UTF-16**, at `0x4b62f8` —

```
  0c "SkullCracker"
  1a "Saved games (.SKL)|*.skl||"
```

— so an ASCII search of the whole executable for "SKL" returns nothing at all.
What it does return is `skuldemo.dmo`, "Save in which slot?" and "Load from which
slot?", and those belong to the demo recorder, which is dead: `0x4038d0` runs
only while `[0x46b310]` is set and nothing in the shipped build ever sets it, and
`0x403900`, the routine that asks "Save in which slot?", is reached only by
`0x4038d0`'s jump when its buffer is full.
Two save-shaped things in one program, one of them dead, and the live one
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
and `0x45e068` sets it to 1 on a load. `0x479438`, the ARMED flag, is not in the
file, but the loader derives it: `0x45e039` skips the weapon when the saved value
is 1, and otherwise `0x45e041` sets `[0x479438] = 1` before restoring the weapon
and its rounds, so a loaded game with a gun has it in its hands.

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

A region is in its SEGMENT's coordinates, like every other number in one, so a
click has to be compared after offsetting by the segment's origin. Every other
film in this game that has regions is full-screen at origin (0,0): `menu.mov`,
`char.mov`, the two pans, the prefs panels. The four pause films are the only
exception — 512x232 at origin (0, 42), inside the interface's own window — and
they are also the only films whose regions have words written on them, so they
are the only place being 42 pixels out is visible.

The picture confirms it. `pauseA` draws Continue, Save and Exit centred on screen
y160, y193 and y225; its three regions are y107-133, y141-167 and y172-198.
Shifted by the origin those are y149-175, y183-209 and y214-240 — one label
each, dead centre. Unshifted they land on the blank plates above Continue and on
the bezel.
