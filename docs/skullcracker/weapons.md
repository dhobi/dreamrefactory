# Weapons and pickups

Five weapons, one holster, and a table of pickups that is read off the art
rather than off the box. Taking a gun makes you a different player, which is
why the guns are here and not with the classes that carry them.

## The pickups are one table and one test

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

## The guns are the other creator, and taking one makes you a different player

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

### They do not all hit with the same thing

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

## A pickup is taken on the ART, not the box

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
