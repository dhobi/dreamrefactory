# The sixteen levels

All sixteen stand. This is what each one turned out to be — the machinery a
level places, the population it carries, and the shape of the four chapters —
walked in the order the game walks them. What the classes DO when they reach
you is [Fighting](combat.md); what the executable runs underneath them all is
[What the executable runs](systems.md).

## CITY's own machinery

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

## WOODS is a population and two steps

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

## PLAYGR is one fight

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

## MALL is a new chapter, and a new shape of level

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

## SERVICE is the first level that is a system

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

## SEWER is a map, and its doors are locks

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

## The six that were placed and not drawn

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

## ARCADE is fourteen records and one fight

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

## Chapter three is four levels and eleven classes

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

## Chapter four is a factory, and its doors are opened by its guards

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

## BARREL is forty-two conveyors and one number

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

## LAB and VAT, and all sixteen levels stand

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

## The sixteenth level is the end

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
