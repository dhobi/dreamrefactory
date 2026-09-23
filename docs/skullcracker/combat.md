# Fighting, and the things that fight

Seventy-three classes are registered and every one a level places is built. The
mechanism is smaller than the list: one tracker, one blow, one grip, and a
handful of bosses that keep state of their own. Damage is off by default —
`?damage=1` or Shift+H — for the reason the first section gives.

## Things that hit back, behind a switch

Damage to the player is **off by default** — `?damage=1` at load or Shift+H at
any time — because the other suites walk levels end to end and three hydraulic
presses turn a route test into a fight.

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
current cel has a degenerate body box — so being untouchable is a property of the
ART, for exactly as long as a reaction that carries no box plays.

How much that protects depends on **which character**, and the two are not
alike. Character 1's reaction cels carry no body box at all — 5900–5902,
5910–5915, 5940–5944, 9550–9558 and 5020/5021, every one of them — so it is
untouchable through the whole of any reaction. Character 0, the default, is not:
of its 38 reaction cels, **twelve carry a box** — 922, the held loop 4570–4572,
the struggle 4575–4579, and the jolt 460–462. Held or jolted, character 0 can be
hit again. Knocked flying or floored, it cannot.

Falling is its own path and takes no blow at all. Past 360 of accumulated drop the
player is cut into the flail (`0x442f3f`); on landing, past 530 it is simply death
with no health call (`0x443c8a`), and under it a flat ten and a roll. And the life
is spent when the dying animation ENDS rather than when the health runs out
(`0x443dea`), with the fourth death — the count goes 3, 2, 1, 0, −1 — turning into
the game-over state.

Creature blows are not armed by `?damage=1`; they have a switch of their own,
`?foehit=1` ([It takes nothing](#it-takes-nothing)), and the bosses are
creatures like the rest. Under `?damage=1` alone, what connects is the
machinery — presses, swinging girders, the blade, the goop and level eight's
water. The codes — the claw, the hands, the bush and TOWER's current — come
through with both switches off, because a code is not damage ([What it
unblocks](#what-it-unblocks-and-what-it-does-not)).

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

So it will not come inside 150 of you on its own, it only dives once you have
marked it, and the dive is what turns the water on. The `-9` a flare hits it
with is driven: it sends the boss into state 9, which drags it onto a sprinkler
([What is still read and not done](#what-is-still-read-and-not-done)). The `dy`
impulses its scripts carry are not: `walk.ts` spends a script's `dy` as an
impulse only on a class that does not float, and this one is weightless.

## Two of them kill you without a blow

`initgrave` and `initfloor` have no health, no blow and no hit handler, and both
end with `0x402fa0` — the call that ends the player.

A grave is shut and solid: `0x4210bd` measures how far into its rect you are and
throws you back out by that much. But only on your feet — `0x4210a7` lets a jump
straight through, which is all of level nine's platforming. Come within a hundred
pixels of its point and it opens, and from that frame it **pulls**: half your
speed away and one more unit of fall every frame. Eighty-six pixels below its
point it takes you, and the ground beside a grave is already 98 below, so
standing beside one when it opens is fatal.

A floor is the same thing told upwards: four frames whole, three of
`0120 floor crea[ks]`, six of `0121 floor cave[s in]`, and then it is not there.
`0x42703e` writes 5 into the floor offset and `0x427100` gives what is left
gravity 3.0, three times the player's own.

The **hand** (`0x41f090`) is two hands, and the record's `param` says which:
0 takes the player's own x and comes up under their feet, 1 picks a random x
inside its rect. Each holds on one cel of `0x4704b8`, whose `ticksPerFrame` is
thirty — two seconds a frame, and that pause is the hazard. Its blows are −3 and
−7, codes rather than damage, and `takeHits` hands each to `takeCode` along with
the grip read off the cel it is holding.

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

`initlightfx` is the one class in the chapter with no per-record loop at all —
`0x41e473` stores its COUNT in `0x46f644` and never walks the records, so it is
not placed the way everything else in the level is (see
[below](#initlightfx-is-placed-by-nothing-and-triggered-by-nothing)).

## Boggs is four thousand and it heals faster than a fist

The last thing in the game is four objects — `initboggsbody`, `initboggshead`,
`initbgclawarm` and `initbgmachinery`, the last of which stands up eight more
with eight scripts of its own.

Its hit handler:

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

And -1 is not a requirement, it is a conversion. What carries -1 is the
BLASTER's bolt — `0x413af0` maps the variant the bolt remembers to its strength,
and variants 1..3 all give -1 while the blaster fires with 2 and 3. So the bolt
is worth a full hundred to Boggs and **nothing at all to anything else**: every
ordinary handler treats a strength below 1 as no damage (`0x4199b9`). That is
what the gun in its room is for, and it only works because the codes are
carried at all.

The healing is not a phase Boggs enters — it is how it starts:

```
  0x46e080:  01 00 00 00  01 00 00 00     ; both flags SHIP as 1, in .data
  41b611     mov word ptr [0x46e080], 0   ; cleared once, by the MACHINERY
  41b75d     mov word ptr [0x46e084], 0   ; ...and once more, same handler
```

Those two writes are the only ones anywhere in `.text`, and nothing ever sets
either flag back. So the thirty a frame runs from the moment the level opens,
and the fight is a sequence rather than a damage race.

## What turns the healing off is the machinery

`initbgmachinery` (`0x411da0`) stands up eight more objects and `0x411ed0` puts
them at eight fixed offsets from the body, out of the table at `0x46e088`. That
placer is called exactly twice in the program — once from the initialiser, once
from VAT's setup — so the machinery, the head and the arm all stand still for
the whole fight. Only the body moves.

Six of the eight are scenery. The two that are not are `0x4a56e8` (cel 5860) and
`0x4a516c` (cel 5870), three thousand health each through `0x40e300(0xbb8)`, and
they share the handler `0x41b510` with the other six:

```
  41b573  cmp [0x4a56e8], esi / je      ; one of these two...
  41b57b  cmp [0x4a516c], esi / jne     ; ...or the blow only clangs
  41b5fc  sub word ptr [0x4a56ec], di   ; three thousand off one
  41b748  sub word ptr [0x4a5174], di   ; three thousand off the other
  41b611  mov word ptr [0x46e080], 0    ; and emptying one clears one flag
```

Break one half and half the healing stops. Break both and the thirty a frame
stops entirely — and only then can the four thousand be spent. Breaking a half
also re-scripts its neighbours: `0x41b65b` buckles three of the scenery pieces,
`0x41b794` a fourth.

Two branches in there never run. Each half tests its own wear stage as
`health / 2 < health` (`0x41b6df`) and `health * 2 / 3 < health` (`0x41b719`),
which is true of every positive health there is, so the dented cels 5861/5862
and 5871/5872 are never installed. A machine is intact until it is wrecked. It
is the same shape of dead code as the wraith's `-3`, and the arithmetic holds
for the whole domain.

Measured on this page with fists alone: one half at 110 punches, the other 55
after it, and Boggs down 144 punches later — 309 in all. With the blaster's bolt
at a hundred a shot it is sixty into the machine and forty into Boggs.

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

### There are two of every one of them, because there are two players

`PLAYER.SBK` holds two characters, and `0x402950` picks between them:

```
  402950  movsx eax, word ptr [0x46b1a8]
  40295c  je 0x40296c  ->  call 0x428080   ; character 0 — the 4xxx cels
  402961  je 0x402975  ->  call 0x442ad0   ; character 1 — the 9xxx cels
```

Each has a hit handler of its own — `0x42e750` for character 0, installed on the
player object at `0x42e443`, and `0x448c10` for character 1 — and each handler
has its own eight-slot table with its own scripts. Character 1's cels are
character 0's plus five thousand in most rows: 4550 → 9550, 4570 → 9570,
20 → 5020.

Mixing the two tables shows on screen: when a hand in GRAVE grabs character 0
through character 1's table, the grab installs 9570..9572, the held loop that
follows installs 4570..4572, and the player flickers between two different
people every other frame for as long as it holds.

Character 0's table is `0x42eda8`, index 0 being −8:

```
  -8  0x42e781  knocked flying    4550..4558, a 0x78 shake, and NO shove
  -7  0x42e807  floored           940..949, and only from the ground
  -6  0x42e86d  flattened         900..903, full gravity — nothing sends it
  -5  0x42e8b3  slumped           920..922, half gravity
  -4  0x42e8f9  shocked           952 922 951 921 then 900..903
  -3  0x42e995  GRABBED           4570..4572, no gravity, no velocity, held
  -2  0x42ea34  jolted            460..462 five times over
  -1  0x42eaaa  spun              20/21 — and it TAKES TWENTY HEALTH
```

Two of those differ from character 1's in more than art. Character 0 does not
shove on −8: the ±50 against `obj+0x28` is `0x448cf4`, character 1's, and
`0x42e781` writes no velocity at all — the cels carry the fall. And character
0's −1 spends twenty health at `0x42eb2b` (`0x402ac0(0x14)`), where character
1's spends none.

### Both of them are playable

Character 1 is not character 0 with different art. Its state machine is
`0x442ad0`, 5552 bytes, and every one of the twenty-eight animation kinds is a
script of its own — `0x475c88` for `0x471648`, `0x475f38` for `0x471920`, and so
on down. The two machines are install-for-install the same shape (`0x444080`
against `0x429690`, `0x444da0` against `0x42a400`, `0x444ff0` against
`0x42a670`, `0x445320` against `0x42a9a0`), and what differs is which tags they
reach for and what is in them:

| | character 0 | character 1 |
| --- | --- | --- |
| walk | dx 95 | dx 105 |
| run | dx 180 | dx 200 |
| jump | dy −420 | dy −500 |
| running jump | dy −420 | dy −480 |
| hop | dy −210 | dy −240 |
| flying kick | dy −310 | dy −370 |
| crawl | 47 on each of five cels | 315 on the last of five |
| standing box | 88 below the anchor | 69 |
| idle fidgets | three (tags 1, 2, 3) | two — there is no tag 3 |
| duck fidget | `704..707`, rolled 13 in 707 | none: tags 1, 2 and 3 are one cel |
| big punch | a coin toss between two | one pose, no toss |
| P + K | the 650s headbutt, out and back | `9800`, which LEAVES THE GROUND |

The frame counts differ too: `0x471648` is 47 frames and `0x475c88` is 41,
`0x471c90` is 26 and `0x476240` is 23.

Three of character 0's rows are easy to take from the wrong character. Its dying
animation is `0x4721a0` tag **1**, installed at `0x429336` a line before the
kind goes to 27 (character 1's is `0x476758` tag 0). Its hard landing is
`0x471c68` tag 5 (against `0x476220` tag 5). Its duck combo is `0x42ab4a`
installing `0x471d68` tag 6, `4100(dx 700, dy −80) 4101 4102 4103` — a dive at
four times the run; the 630..632 of tag 6 of `0x471c90` is a different script
with the same tag number.

`skullcracker/src/players.ts` is both of them side by side, and the page reads
`0x46b1a8` to pick: `?char=1`, Shift+C (which is input action 11, `0x402d22`,
the other designer's key the shipped table leaves unbound), or the chooser.

The census of code senders needs each function decoded from its entry to the
next. A disassembly sweep in overlapping windows can begin mid-instruction and
print nonsense without complaint; it misses `0x420da6`, the hand's own grab, and
`0x420e3b`, the other one. Decoded per function, the senders are

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
damage, and is read instead by an arm of its own in eleven hit handlers
([What is still read and not done](#what-is-still-read-and-not-done)). The
flare carries it, and conditionally: `0x43abf0` sets its strength to −9 rather
than 100 when the global at `0x4abdfc` is 5.

### How a grab actually holds you

`0x428080`'s kind-10 case reads the GRABBER's current cel record at +4 and +8 —
which is the cel's **strike box**, the same rect that decides whether a blow
connects — translates it by the grabber's own point with `0x434270` (a plain
add, no mirror, no band) and plants the player at its centre:

```
  4285b8  cmp [0x4a693a], ax   ; x0 == x1 -> let go
  428660  x = x1 + (x0 - x1) / 2
  428689  y = y0 + (y1 - y0) / 2
```

So the grip is authored per frame, in the art, and the grab ends when the artist
drew a frame without one. Nothing else is stored: no timer, no distance, no
"grabbed" flag on the grabber. The books agree. Of the thirteen cels the hand's
three scripts name, only 1556 and 1562 — the two CLOSED ones — carry a strike
box, and theirs are `y -27..-1, x -32..31` and `y -34..-4, x -18..20`: the fist
itself. Of the fifty-two the claw's six scripts name, only 2456..2459 do, `y
77..111, x -76..0` and three more like it: the jaw hanging below and behind its
anchor.

The grip must therefore be **re-read every frame**. Reading it once, at the
moment of the grab, gives a hold that never ends — the hand sinks back into the
ground and the player stays pinned in mid-air where it used to be.

Two details are the original's own. `0x4286cf` lets P restart the struggle but
only from the loop's tag 0, so mashing it does not stack and nothing in the
state shortens the hold. And the reaction installs `0x476698` — cels 9570..9572
— while the held state that follows it loops `0x4720e8`, the same script in
4570..4572; the disc has two playable characters with a sound bank each, which
is the likeliest reason, and this page plays what the two functions literally
say.

### What it unblocks, and what it does not

The hand grabs and lets go, the surge shocks, the knockdown from out of a hand's
rect lands, and none of it spends a point of health — which is why a code comes
through with the damage switch off. A code is a message.

The codes alone do not make Boggs killable; the machinery does. The only two
things in `SC.EXE` that send −1 are `0x413bf9` and `0x41b022`, both inside the
Boggs machinery, and `0x41afd0` gates its −1 on the two flags at `0x46e080` and
`0x46e084`. What the codes unblock is the blaster's bolt, which carries −1 and
which `0x41bc71` and `0x41b510` both rewrite as a full hundred — against Boggs
and against its machine, and against nothing else in the game.

BARREL's claw: `0x4171e0` is a **seven**-kind machine over six scripts. The
creator starts it on kind 6 (`0x46dc58`, one cel), the player entering its rect
sends it to kind 0 (`0x46dc78`, the carriage), and inside 300 pixels kind 0
installs `0x46dd80` — kind 4, cels 2420..2426.

**The claw grabs.** The grabbing kind is reached through a TRACKER the creator
registers at `0x411d23` — `0x45ef70(&user[0x12], claw, player, 0x46dfc8)` — and
`0x45efd0` answers it each frame with the gap between the two objects, which way
the target is moving, and a BAND index. `0x46dfc8` is the band table and it is
three numbers:

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
what sets `obj+0x2a`, and the grab follows from it. The contact must be read off
the COLLISION and not off the damage: the jaw cels carry a strike box and no
blow pair at all, so a port that asks "did this hurt anything" would watch the
claw touch you and go back up.

Its position: `0x411ca0` files three of the spawner's dwords into its user
struct and `0x4173d1` clamps its x between `user+2` and `user+6` — which can
only be left and right, so `user+0`/`user+4` are top and bottom. `0x4173c9`
writes `user+4` into `obj+6`: **it hangs at the record's bottom, not its point.**
On BARREL's fourth claw that is 7221 against the point's 7044, and since the jaw
box sits 77..111 below the anchor, the difference is the whole of whether it
closes on your chest or 40 pixels above your head.

### The thing in the water lets go by SINKING, and that is why SEWER stopped

`initbush` — the thing that comes up out of level seven's water — releases the
player by sinking. It does not wait for the player to be released, and the
player's release does not wait on the bush: a port where the bush waits for the
release and the release waits for the cel to stop gripping holds the player (at
x1964 in SEWER) for the rest of the run. `0x43ef31` is one test with two arms:

```
  43ef31  cmp [obj+0x46], 0        ; has its thirteen-cel script ended?
  43ef65  (no)  y -= 0x28          ; forty a frame UP, to the top of its travel
  43ef4a  (yes) y += 0xa           ; and ten a frame back down again
  43f007  at the bottom: install 0x472b70, whose six cels carry no strike box
```

Neither arm asks whether it still has hold of anybody.

And it sends **two** codes rather than one, latched at `user+0xe`:

```
  43ee9d  (0)  [obj+0x1a] = -3           ; the grab
  43eea3  (0)  [obj+8] = player.x        ; and it slides under you
  43eeb0  (0)  0x402f00 != 0 -> stay     ; ...while the player is still FREE
  43eec9  (0)  user+0xe = 1              ; ...and moves on once it has you
  43eedb  (1)  0x402f60 != 0 -> [obj+0x1a] = -5
```

`0x402f00` returns 0 when the player's kind is 10, 9, 0x18 or 0xd — held,
knocked down, or freshly spawned — so the latch turns over on the frame AFTER the
grab takes. `0x402f60` returns 1 while the player's kind is under 0x1a, which is
**alive**, so the −5 goes to a living player, not a dying one. The bush grabs
you for about a frame and then slumps you — `0x42e8b3`, half gravity, holding
nothing.

The held cels 4570..4572 carry a body box, unlike every knockdown cel in the
book, which is what lets the second blow land on a player the first is still
holding.

`0x4285c1` leaves the held state and `0x4285db` writes 1 into `obj+0x34` on the
way out — the player is SETTLED again, not dropped from wherever the grip had
them. Without that, in SEWER's hall of lifts a grab that ends a pixel above the
walkway drops the player straight through it into the sewage underneath.
Standing them up is not a free pass: the gait's own `surfaceUnder` runs on the
next frame and puts them back in the air when there is nothing within eight
pixels of their feet, which is what a grab over a pit wants.

## The thing in the water comes up, and reaches

`0x43ec80` is three phases and a rect, and all of it is built:

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

The creator puts it at the record's point plus eighty (`0x435bf7`), which on
SEWER's hall bushes is y 17321 against a floor at 17513 — 190 to 215 pixels
above the floor, consistently across all eight. It still reaches, because a
prop's strike box is not lifted by `height - posY` (see [A collision box is a
translation](systems.md#a-collision-box-is-a-translation-and-nothing-else)). With the box translated the way `0x40e680` translates it, the
bush closes on a player walking underneath it, on its own resting y, and holds.

## The wraith works its own bands, and its code is dead

`0x424800` reads the same TRACKER the claw does — `0x45efd0` on `user+0xe` — and
bands the gap against `0x46f8f8`:

```
  bc 02  e6 00  82 00  3c 00  00 00      ; 700, 230, 130, 60
```

Four thresholds, five bands, and `0x424f1c` sorts them into four behaviours.
Over 230 it installs nothing and drifts in: `0x4248e9` adds ten sideways and
twenty towards the player's row through `0x42f8b0`, one and two pixels a frame
more every frame. At 130..230 it halves its sideways speed, writes its vertical
one towards his row, teleports behind him if he is mid-blow and otherwise
shudders on a five-frame beat. At 60..130 a blow in progress is a coin between a
shudder and a SPLIT; otherwise six in forty-seven it casts. Inside sixty it claws
in place (`0x424c05`, `0x46f6c8` tag 0) when level with him.

`0x424d77`: the wraith's cast calls **`0x41f6b0`**, the scepter's own fire
function, variant 0 — the one that spends no rounds. The object it makes is
planted every frame 0x46 in front of the WRAITH (`0x424620` reads the caster
out of its user words), strength a hundred, for the six frames of `0x46f4d0`
tag 0. The thing you take the scepter from in RAVECAVE casts it at you first.

The split (`0x424de0`) calls the class's own creator seventy pixels behind it,
facing the other way, with the argument that starts the copy teleporting in.
`0x41ed12` makes the one the level places the named one (`AI+4` = 1) because it
is alone when created; every copy is lesser: `0x42503d` kills it with any blow,
and `0x424f30` dissolves all of them as the named one's death ends. A take
(`0x46f898`, one cel) splits three times in ten as it ends (`0x424e14`); the
killing blow gets the nine-cel dissolve `0x46f8a8`, and nothing is left lying.

### The -3 is dead code

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
like everything else. Measured: a wraith that grabs on contact locks the player
out of fighting entirely, and **two hundred and sixty kicks take nothing off
it**; with the code removed it falls in eighteen.

Reading a `mov` without its exit path gives the wrong answer here, as it does
for Boggs' -1 and its two flags and for the inventory screen that is not one.

## The bishop rolls for it, and Boggs lunges

Two more machines on the same tracker the wraith and the claw use.

**The bishop** — `0x425c90`, banded against `0x46f4c0`: `dc 00 aa 00 64 00`, so
220, 170 and 100. Dormant until the player's point is in its rect, then it walks
in on its 2500s and rolls:

```
  425e56  band 1       -> 0x434540(10) < 3 walks away, else considers
  425e64  band 2 or 3  -> always considers
  425e8c  0x434540(0x2a) <= 13 and health <= 600 -> tag 2, the summon
                         else  -> tag 0, the throw
```

Eight in ten at the far band, always inside 170, and only once level with the
player's row. The throw's recoil is `0x46f1c0` tag 1 carrying dx -30, -20, -10
— authored into the animation rather than applied to it.

Its hit handler (`0x4264f0`) weighs what is LEFT, not the blow: under half of
`AI+6` (seeded 1200) it vanishes (`0x46f308`, sound `0x1f`) and `AI+6` becomes
what is left, so it goes under 600, then under half of that, and so on. The
vanish throws twelve bats, waits until half of them are dead, re-forms at the
surviving bat nearest the player (`0x426450`, Manhattan, inside 500) with `0x1c`,
and plays `0x46f370`, the vanish backwards. The death takes every bat on the
level with it and leaves nothing behind.

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
is why a test has to sample its idle four times as often to see it at all.

## A hard blow costs you the gun, and the band says which key

Two things on the interface are wired to the key map, and one that looks
unwired never was.

### The knockdown is also the disarm

`0x449115` is the reaction's comparison — over sixty and you go down, under it
you stagger — and the six instructions after it disarm:

```
  449115  cmp di, 0x3c            ; the same sixty
  44911b  0x448bf0()              ; is the player one of the armed kinds?
  449125  ...                     ; player+0x16, player+0x28, player+6, [0x479434]
  449146  0x45b060(...)           ; and the gun is on the floor
  44914b  [0x479438] = 0          ; hands empty
  449157  0x40d4f0()              ; redraw the panel
```

`0x448bf0` is three comparisons: `player+0x18` between 0x12 and 0x16, which is
the five armed player kinds and nothing else. `0x45b060` is the same spawn that
reaching for a second gun runs to throw the first one down, gravity 1.0 and
bounce 0.3 — so a knockdown and a swap put the weapon on the floor by exactly
the same route. The other player class carries its own copy of all six at
`0x42ec07`, so it is both characters.

What does **not** disarm you is a code. `0x448c72` reads the sign of the blow
first and dispatches a negative one before any of this arithmetic runs, so a
claw's grab and a wraith's hold leave the gun where it is.

## A hatch in the ceiling and a fork of lightning

Two classes with nothing in common.

### `initbiggun` is two objects, seven scripts and eight states

`0x4115b0` makes TWO objects of one record: the turret ten pixels above the
point (`sub word ptr [edi-4], 0xa`, and the low word of a point is its y) on
script `0x46c1e8`, and the hatch on the point itself on `0x46c238`. Both keep
the record's rect in their own user block. One handler serves them, `0x4135b0`,
dispatching on the script's KIND through the table at `0x413930`:

```
  kind 7  0x41387c  the HATCH: shut -> opening -> held -> shutting -> shut
  kind 0  0x4135f7  the turret, waiting; in the rect -> tag 1, sixteen frames
  kind 1  0x41365f  descend 8 a frame until 0x6e below where it started
  kind 2  0x413692  unfold 10080..10086
  kind 3  0x4136e3  FIRE: tags 0 and 1 each sound maze's 3 and call 0x412a70
  kind 4  0x4137b4  blink 10100/10101 -> fire again, or fold
  kind 5  0x413830  fold back 10086..10080
  kind 6  0x413851  rise 8 a frame until it is home -> kind 0
```

Every kind that can be interrupted tests the player's point against the rect
first and installs `0x46c428` — the fold — the moment the answer is no, so
backing out from under it stops the gun wherever it had got to rather than
letting it finish. `0x4135bc`'s preamble zeroes both velocities and pins x back
to the record every frame, which is why nothing can push one.

What it fires is not a shot of its own. `0x412a70` is the BLASTER's, the same
function the armed player's state machine calls, so the gun's bolt has the
blaster's speed, the blaster's scatter and the blaster's code. It is called with
variant 0, and `0x412aaa` INVERTS the shooter's mirror flag for that variant —
the gun's own flag is which side of it you are standing on (`0x4135cc`), so the
bolt always leaves going towards you.

### `initlightfx` is placed by nothing and triggered by nothing

`0x41e450` collects TOWER's records at setup and keeps only the COUNT, at
`0x46f644`; the records sit in a buffer at `0x4a5888` and nothing stands them
up. What stands them up is the level's own per-frame function:

```
  426800  dx = [0x46f680]          ; the counter, before the increment
  42680e  [0x46f680]++
  426815  if (dx > 0xc8) [0x46f680] = 0      ; a period of 202 engine frames
  426837  if ([0x46f680] != 0xc3) return     ; and the strike is on 195
  426842  0x426870()               ; one object per record, out of the buffer
  426857  0x40f090(0x4a5870, 0x37, player.y)
  426861  0x40e4c0(0)
```

`0x4268c0` is what a record becomes: an object at its own point, mirrored when
the param is NEGATIVE (`0x4268fa` takes the sign straight into `obj+0x28`),
playing tag `|param| - 1` of `0x46f588`. TOWER's two records carry 1 and -1, so
both play tag 0 and one is flipped — two halves of a single fork, 435 pixels
apart. The other two tags of that script have no record anywhere in the sixteen
books.

`0x40e4c0` is the flash, and it is a queue rather than a draw: it stores a
palette index at `0x46bdd0` and `0x40dfd0` floods the whole view rect with it on
the next frame and sets it back to -1. Two things in the game use it — the
blaster's muzzle, with 0xe1, and this, with 0. Colour 0 in TOWER's own palette
is pure blue.

## A grabber holds you by taking your step away

SEWER's hall of lifts is the one stretch of the game that cannot be walked.
Fixing three defects there makes the hall crossable end to end, but also turns
the bushes from things that DUMP you into things that PIN you, which breaks two
earlier stretches of the same level that depend on being dumped; that change was
reverted. The cause lies underneath all three defects.

The bush handler is `0x43ec80..0x43f174`: one function, a switch on `obj+0x18`
with five kinds through the table at `0x43f150`. Two details are not the
problem. `0x43045d` is a spend rather than a rate limit — the frame a hitter
connects, `[obj+0x1a] = 0` and the scan stops, unless the strength is `0x65` —
and the bush re-arms every frame anyway. The re-trigger cooldown is `user+0xa`:
`0x434540(0x28) + 0xa`, a random 10 to 49 frames, reset after every trigger of
the PAIRED bush, and gated on the player being neither held nor already slumped.

The cause is a global:

```
  cmp  word ptr [0x46b1b4], 0
  je   skip
  call 0x402980            ; -> 0x42fbd0(player), the player's own step
```

That shape appears thirteen times, once in each level's main loop, and
twenty-four classes write the word. **`[0x46b1b4]` is the player-step gate.** A
grabber in this engine does not hold you with a flag on YOU. It holds you by
zeroing that word, every frame, so your controls do not run at all — the bush
does it at `0x43ef0a`, in phase 2, and only once `0x402f60` says you are no
longer hittable, which means the -5's kind-26 reaction is up. Its own
ten-a-frame sink then carries you down, and `0x43ef28`/`0x43ef57` hand the gate
back when the script ends.

So the dump is not the grip letting go at a height. It is a sequence: the -5
lands, the reaction takes the player's kind to 26, the bush stops arming and
takes the player's step away, the bush sinks with them, and the gate comes back
wherever it left them. This page models a hold as `p.heldBy` — a latch on the
player, released when the cel loses its strike box — which is why fixing the
three defects produced a pin: nothing takes the player's step away, so a grab
can only ever be a hold.

The fix is a port of the gate rather than another patch. One question it leaves
that reading cannot settle: the hall wants the player left on the walkway and
door-7 wants them dumped off it, and both come out of this one machine, so the
difference has to be geometry and has to be measured.

## Twenty-six classes, one brain

The fighting classes run one brain with twenty-six sets of numbers. The
decisions live in each class's AI struct, beside its animations.

### The tracker is the whole of the mechanism

Each creator mallocs its object a 54-byte AI struct (`0x433f20(0x36)` at
`0x450a50`, for the street punk), copies the `init` record's rect into `AI+8`,
and ends with `0x45ef70(AI+0x14, self, player, bands)`. That last argument is a
list of DESCENDING distances terminated by a zero, at most twelve, sitting in the
class's own data:

```
  initwerea  0x477600   330 200 150 80          initdog     0x478240   1200 650 410 320 180
  initwereb  0x4778b0   350 250 200 160         initwbooly  0x478780   1000 750 500 400 160 60
  initwerec  0x477ac0   550 450 220 80          initwraith  0x46f8f8   700 230 130 60
  initwered  0x477c28   600 600 160 70          initcop     0x46c9d8   350 180 70
  initrat    0x4770e0   200 80                  initbat     0x46f158   600 250 50
```

Then `0x45efd0` runs once a frame and fills sixteen bytes:

```
  out+0x0a   the FORWARD distance, (player.x - self.x) negated when the class
             faces west — so a negative number means "behind me"
  out+0x08   player.y - self.y
  out+0x00   which side of the PLAYER it is on: 1 in front, 0 behind, 2 when the
             player is not moving
  out+0x04   the BAND — 0 while the distance is past the first threshold and one
             more for each threshold it is inside, -1 when the player is behind
  out+0x06   1 when the PLAYER's own cel carries a strike box
```

`obj+0x18` is the state and each class dispatches on it through a table of its
own, but two entries are the same everywhere. **State 0 is the patrol, and the
only thing that ends it is `0x434200` finding the player's own point inside the
AI's rect** — not a sight line, not a radius, not the room. **State 1 is the
fight**: gated on `0x402f60` (the player's state under `0x1a`), turning to face
you when the forward distance is negative (`0x44e73c`), swapping sides when more
than three of its own class are crowding one within two hundred pixels
(`0x44f020`), and then jumping through a second table indexed by the band, where
the far entries install a walk and the near ones install an attack.

### Which of a class's scripts is an attack, and the disc says so

A cel carrying a STRIKE BOX is the engine's own mark for a frame that hits, and
it is the very flag the tracker reads at `out+6` to tell whether the player is
swinging. So every tag of every script a class installs whose cels carry one is
an attack, read out of the book the class actually appears in. The punk's are
1923/1924 (the punch), 1931/1932 and 1934/1935 (the two swings) and 1943 (the
flying kick, `0x477368 tag 0`, `dy -480` on the frame it leaves the ground),
against a walk on 1910…1915 that carries none. Only the attacks ever leave the
floor, which is what the `dy` field is for.

`src/fights.ts` is the table — the bands, the walk and the attacks for the
twenty-six classes that have them — and `stepFight` in `src/walk.ts` is the
machine.

### It takes nothing

The enemy strike boxes are wired into `takeHits`, and with the AI bringing
creatures within reach that loop is live. So the creature half of it has a
switch of its own, `?foehit=1`, and it is off even when `?damage=1` is on.
Everything else `?damage=1` arms — the presses, the girders, the sewage — is
unaffected by it.

### What the classes throw

Ten classes in this game fight at a distance, and Boggs' machine is an eleventh.
A `Brain` is handed one enemy and has no creator, and every projectile in the
game is an object of ANOTHER class that the thrower's machine spawns.
`BrainCtx.cast` is that seam — a module reads its class's spawner into a
`CastKit` and calls `cast` at the instruction the executable calls the spawner
at — and **every one of them is wired**:

| class | where | what leaves it |
|---|---|---|
| `initpuke` | LAB | a gob: 100 ahead, 65 up, `dx 400 / 13` = 31px a frame, gone at 1000 from the player (`0x418400`) |
| `initcop` | MAZE, BARREL | a slug that writes its own ±35, lives a hundred FRAMES, and flies **harmless** until it is inside 130 of the player, where `0x413e79` arms it at a hundred |
| `inittube` | LAB | one to four shards (`0x41973e`): 70 ahead, 140 up, `dx 400` or `200 / 13` with a rise of 8 and a weight of 0.6, breaking on `0x46d740` with sound 0x2e and a flash; and a puff off the flip's third frame (`0x419910`) |
| `initeyeball` | SEWER | a glob, five cel sets cycling on `AI+4`, launch into a looping flight, gone 600 from where it STARTED, and worth **−2** — a code, not damage |
| `initzomb` | CAVERN, GRAVE | a cloud that does not move at all: 40 up, 65 in front, eight frames, **−2** (`0x420990`) |
| `initigor` | RAVECAVE | 26 up and 35 along with a weight of 0.8, so it ARCS, and it unwinds its own four cels where it lands (`0x421310` index 1) |
| `initskel` | CAVERN, TOWER | a bone out of the same class: 70 ahead, 40 up, 26 up and 35 along, the same arc (`0x421310` index 0) |
| `initwraith` | RAVECAVE | the scepter's own beam, variant 0: planted 0x46 in front of the wraith for six frames, worth a hundred (`0x41f6b0`) |
| `initknifeboy` | SERVICE | two things off one roll: a knife whose own script carries a stride per cel (`dx 0 50 0 50 0 0 0`, so it gets FASTER), and a lob that goes up first |
| `inithardcore` | SERVICE | a lob at 80 a frame with a weight of 0.2 |
| `initvpriest` | TOWER | a bolt: 100 ahead, 35 up, `dx 600 / 13` = **46px a frame**, the fastest thing anybody throws, and worth a hundred |
| `initkragg` | ARCADE | three shots a volley that leave at a STANDSTILL and steer — twenty along the facing and a tenth of the gap to a point 45 above you, every frame — worth **−2** |
| `initwbooly` | PLAYGR | a fireball that BOUNCES: restitution 0.8, friction 0.25, a hundred while it is moving and nothing once it is not |
| `initboggsbody` | VAT | a throw out of its second MACHINE, six cels at `dx 0 25 25 25 25 50 / 7`, worth twenty in the air and 101 where it splats |

Four of them carry codes rather than damage, which makes them the first
classes a level places that can send one — see `codes.ts`. And `initeyeball` and
`initpuke` are the two classes with no strike box on any cel of their own: the
projectile IS the attack.

**Nothing is left throwing nothing.** Three pieces of machinery are each one
class's:

- **a stride per cel.** The knife accelerates because its own script says so —
  `CastKit.strides` over the class's divisor.
- **a bounce.** `0x42f7f0` writes `obj+0x20` through a scale of **−8192**, so a
  restitution of 0.8 is stored as −6553 and `0x42ff83`'s `imul`/`sar 13` flips
  the sign as it scales. Every object is BORN with `+2048` — a quarter kept the
  same way, which is a stop — so only a class that calls the setter bounces, and
  `initwbooly`'s fireball is the one that does. `0x4302c0` takes the horizontal
  half down through `obj+0x1e` while it is in contact, and `0x4555e9` removes it
  once both have run out. The floor test is SWEPT so that it sees the fireball
  at all: the thing leaves at sixty pixels a frame and reaches a hundred and
  sixty.
- **steering.** `0x442290` is the only think that builds a velocity delta every
  frame rather than once — `CastKit.home` — and `0x442306` takes the shot away
  the frame it is past you, because a homing thing has no reach to expire at.

And two of the four carry the strength somewhere the first five did not.
`initvpriest`'s bolt writes `obj+0x1a` in the think's common TAIL (`0x426e1e`),
past the dispatch rather than inside the arms. `initwbooly`'s fireball writes a
hundred or a zero depending on how fast it is going (`0x4556d3`).

### What is read and not yet done

**All thirty classes in `FOES` have a machine of their own in `src/brains/`**,
so the shared "innermost band swings" reading governs no enemy in the game. An
animation's `dy` is applied — `walk.ts` spends it as an IMPULSE into the thing's
velocity on the frame it appears, which is what `0x42f8b0` does with it, and
`tests/machine/fights.ts` watches `initwerea` leap.

Two more:

- **The patrol's margin is a wall, not a line.** The patrol turns at the
  hundred, and `0x44e699` and `0x44e6aa` also write the margin straight into
  `obj+0x8`, so a patrol that overshot is PUT BACK on it rather than left
  outside for as many frames as the overshoot is wide.
- **The decision budget needs nothing.** Eight classes carry one in `AI+4` and
  spend it — the dog, the rat, the hardcore, the wraith, the eye, the cop,
  `initwerea` and `initwbooly`. Every one of the other twenty-two has its own
  page saying, with the struct's own offsets, that the word at `AI+4` is not a
  budget in that class. An AI struct is per class; giving a budget to one that
  never had one would be inventing behaviour rather than porting it.

### A brain can build something that is not a projectile

`BrainCtx.cast` puts an object with a script and no mind in the air. Two things
in this game are neither that nor a record the level places, and each has its
own seam rather than being bent into a `CastKit`:

- **`BrainCtx.hatch`** — another CLASS's creature, stepped by the page exactly
  like one the level placed. `0x426340` is the only creator a think calls, and
  it is `initvpriest`'s: the summon at `0x42601a` lets **three bats** go, sixty
  health each, the bishop's own record rect copied into their `AI+4`/`AI+8` so
  they patrol where it stands, `±30` of sideways velocity, and script `0x46f060`
  tag 1 — the flight, never the dormant cel a placed bat waits on. `0x426346`
  refuses once sixteen are alive. Every one is born in region −1
  (`0x426378`), which the mover files by its point only once that point is
  inside a region, so a bat thrown past the room's wall stays in the fight
  instead of being filed somewhere else. The summon is not free: `0x425e8a` wants
  `0x434540(0x2a) <= 13` **and** a bishop under half its health, so a healthy
  one only ever throws.

  The two states that let **twelve** go — the vanish at `0x4261df` and the death
  at `0x4262f7`, the latter followed by `0x4263e0` killing every bat on the level
  with a lift of −40 — are not reachable here and are not done. Both live in
  states `Foe.flinch` and `Foe.death` own, and a brain is never called while
  either is playing.

- **`BrainCtx.roller`** — the one HAZARD a creature builds, and the one class in
  the game with no `init*` name, because no level can place it. `initmaskboy`'s
  preamble rolls `0x434540(0x44) < 3` every engine frame, and with the player
  inside 300 in x and the keeper WEST of him `0x43a790` builds one at the
  player's own y, six hundred pixels the far side, carrying `vx -480`.

  Three details. It **waits**: `0x43a99b` counts `AI+8` down from forty and only
  then calls `0x42f8b0`, so there are forty-one frames of cel 1970 standing where
  it was born. Its drag is **never spent** — `0x4302c0` is inside the mover's
  contact arm and `0x42fdba` skips that arm while `obj+0xa` is zero or less, and
  nothing ever gives a roller a weight, so it rolls at a flat `-480/7`. And
  `[0x474868]` latches a **waiting** one rather than a live one: `0x43a9dc`
  clears it on the frame the thing starts to roll.

### What is still read and not done

**−9 is not damage.** It falls below `0x448c84`'s range test, so against the
player it lands as ordinary hurt; everywhere else it is read by a −9 arm of the
victim's own hit handler, and every one of those arms begins by calling
`0x44ff20`. That function does not play an effect — it builds a FLAME,
an object with its own position, parked at a random point inside whatever the
victim's current cel covers, and `0x453ea0` carries it along with the victim
(mirroring its offset by the facing) for as long as it burns. The flame is worth
a hundred on paper (`0x453eed` writes it every frame) and worth nothing in fact:
not one of 9600..9629 carries a strike box or a blow pair. It is a reaction, not
a weapon.

Two things carry a −9. The flamer's flame always (`0x453b9b`), and **a flare on
stage 5** — `0x43abfa` writes `0xfff7` while `[0x4abdfc]` is 5 and `0x64`
otherwise, and `SkullSave.stage` already reads that word as the fourth level of
a chapter: levels 4, 8, 12 and 16. ARCADE is level 8, which is why the one level
with sprinklers is also one of the four where a flare is a code.

A strength below 1 is not a blow, but it is not harmless either. Every 16-bit
compare against `0xfff7` in `SC.EXE`'s code sits in a hit handler, and there are
eleven of them — eight creatures, one prop and two things in the air:

```
  0x44f0aa  initwerea   hit 0x44f0a0   leaps, −10 a frame       Foe.burns + wereaReacts
  0x44f8bd  initwereb   hit 0x44f8b0   bolts, −10 a frame       Foe.burns + werebReacts
  0x4520d8  initcrow    hit 0x4520d0   burns, then tumbles      CROW.burns (props.ts)
  0x45296e  initwerec   hit 0x452960   the death throw          Foe.burns + werecReacts
  0x4547b3  initwered   hit 0x454790   burns, health to 0       Foe.burns + weredGate
  0x4550d3  initdog     hit 0x4550b0   its death, and its 200   Foe.burns (dies)
  0x45631e  initwbooly  hit 0x456310   catches, nothing else    Foe.burns
  0x441d30  initkragg   hit 0x441cf0   state 9                  Foe.burns + kraggReacts + kraggGate
  0x44fe89  initmailbox hit 0x44fe80   a late flame, no dent    Foe.burns (late)
  0x455763  fireball    hit 0x455730   stops, hops, is removed  CastKit.onCode (wbooly.ts)
  0x452fcc  MOLITOV's   hit 0x452f80   burns and bursts         CastKit.onCode (werec.ts)
            shot
```

Six of them test the code before anything else. `0x4547b3` and `0x4550d3` fetch
the class's own record through `0x430eb0` first, and `0x455763` refuses a
fireball that is already alight (`0x455751`) before it looks at the blow.
Kragg's `0x441cf0` asks three things first: it ignores its own shots
(`0x430ee0` against `[0x472568]`) and a strength of zero, and while its state is
9 or more it sends every blow to `0x441ef0` — nothing at all in states 9..11, a
flat `0x46` for any negative strength from 12 up. So the −9 arm is reached only
while the flying form is in states 1..8. `kraggGate` in `brains/kragg.ts` is
that gate, and `strikeFoe` asks it (through `GATES` in `brains/index.ts`) before
anything else; it reads the state off `Enemy.script`, and state 9 off the
page's own burn. What `0x441ef0` then does with a blow on the ground form is
the class's `pick`: `[0x473de4]` counts the blows, the first three take
`0x473ba8`, and the fourth snaps it round (`0x473bd8` tag mirror + 2) if the
player is behind it or swings (`0x473cc8` tag 1) if not.

The dog's arm installs `0x478208`, which is its death, plays its death sound
0x18 and pays the death's 200 at `0x455115` — its death path at `0x4551c9`,
less the subtract. Its `Foe.burns` is `dies`, so a flame kills a dog outright,
whatever its health, and pays for it once. MOLITOV's is `fatal`: its five
frames of `0x477a68` run as a flinch, and when they run out `0x4526ef`'s end —
the death sound, `0x477a78` and `0x40d450(0x104)` — is the page's `killFoe`,
the same one a blow that empties the health goes through. A death writes no
velocity: `obj+0xc` is the same word before and after `0x45d090` installs the
death script, so `killFoe` hands the walker's speed (`e.speed`) on to the
corpse's flight (`e.vx`), where the class's ground drag takes it down.
`0x452960` has no
state test, so a blow landed during those five frames is read like any other,
and a second −9 puts `0x477a68` on again from its first frame.

The two punks' flames cost nothing up front and everything after: FANG's state
8 (`0x44ed8c`) and LINK's state 4 (`0x44f735`) take ten off the health and
growl 0x23 on every frame of the burn script — fifteen frames for FANG, twelve
for LINK. When the script ends, a punk with health left goes back to its stance
and one without dies where it stands with a 200-frame corpse (`0x44edce`,
`0x44f776`), no death sound and no award. `wereaReacts` and `werebReacts` are
the drain; the burn's `FoeAnim.resume` hands the end to the class's own
machine. The CHOPPER's arm zeroes its health (`0x4547d5`) and then throws the
−9 away as a negative strength (`0x4547f2`), so the flame takes nothing off
that blow and the next blow of any size kills it; `weredGate` is the zeroing.

MOLITOV's shot (class `0x452c50`, which writes `0x452f80` into `obj+0x12` at
`0x452c83`) tests `0x65` first — the strength `0x452ec0` gives a shot's own
burst, so a burst landing on another shot sets it off unless that shot's
`obj+0x18` is 1 — and then −9. The two arms end the same way: sound `0x34`
through `0x40f090`, `0x452ef0` shaking the screen by how close the player is
(`0x4307c0` 3, 2 or 1, with a `0x40e4c0` flash at the closest), and the burst
`0x477c60`; the −9 arm lights a flame first. `WEREC_SHOT` in `brains/werec.ts`
carries both as its `onCode`, and `CastKit.bang` carries the sound and the flash
for every burst of the shot, whatever set it off; the page has no screen shake.
`0x65` is the one strength `0x430443` leaves on a hitter after a hit, so a burst
goes on striking for as long as its cels carry a box (7000..7002), and
`chainCasts` in `walk.ts` runs it against the other casts. `0x4303b3` passes over
a victim whose cel has no body box, and the burst cels 7000..7005 have none, so
a shot that is already bursting is struck by nothing. A shot set off mid-air
bursts where it is: `0x45d090` leaves its velocity alone, and the page stops it. The mailbox's `0x44fe89` arm is
`0x44ff20(self, 1, 0)` and `return 1` — a flame that goes straight to its
going-out stage, before the speed test, so no dent and no sound — and that is
`initmailbox`'s `Foe.burns`, `late`. Only STREETS places a mailbox, and STREETS
is level 1: a flare there is `0x64`, and `0x4511f0` names the flamer for CITY
and WOODS. A flamer carried in reaches nothing either: STREETS' book has none
of the stream's 9500s, whose strike boxes are what a stream hits with.

`Reaction` in `brains/kit.ts` is the seam these three reactions need: a think for the
states the PAGE owns. It is deliberately not a brain — it returns nothing and
installs nothing — and it is what lets `initwerec` fire a shot a frame out of a
corpse, `initvpriest` throw twelve bats and wait out of sight until half of them
are dead, and `initkragg` drag itself onto a sprinkler.

### The nameless handler is the crow's

`0x4520d0` belongs to a class with no NAME. `0x4519d8` is the write — `mov dword
ptr [esi+0x12], 0x4520d0` — and the descriptor it writes into is registered by
`0x451990` with `0x430cc0(0x4519b0)`, no `init*` string attached, from a single
call at `0x451628` inside CITY's own entry function. No level places one of
these: `0x450910`, CITY's creator, builds them off the `initcrow` records, twelve
of them. So the −9 reader at `0x4520d8` is **`initcrow`**, and its scripts agree —
`0x476e58`'s 1884..1887 are the last four cels of `0x476da0`, the crow's dive,
and every one of the class's nine scripts sits in the same `0x476aa8`..`0x476ef8`
block that `0x451aa0` installs from.

The chapter fits too. The flamer is CITY's own weapon — `0x4511f0` names it for
`woods.sbk` and `city.sbk` — so the level that perches twelve crows is one of the
two that hand you the thing that lights them. And the flame's own 9600..9629 are
in four books: CITY, PLAYGR, VAT and WOODS. CITY's book places twelve
`initcrow` and five `initwerec` records, and both classes read the code.

The arm itself is short: `0x44ff20(self, 3, 0)` for the
flame — a nonzero second argument, so `0x44ffe2` puts it straight on `0x478978`
tag 2, and a zero third, so it goes out — then `0x476e58`, then `return 1`, above
both the class test at `0x452109` and the dying test. The code never lands as a
blow and throws no feathers. What kills the crow is the state: `0x451e5a` plays
woods 17 under those eight frames and ends them with `0x42f850(obj, 1.0f)`, the
tumble and the same eighty a punched crow pays. The height code at `0x451aeb`
still runs while it burns, so the crow holds its station for the eight frames and
only then drops.

It is not a `Reaction`, because a crow is not a `Foe` and has no brain: it is
`CROW.fall`, `CROW.burns` and `burnCrow` in `src/props.ts`, which is where the
rest of the class lives. Like the fireball, it needs a site of its own, because
`0x430367` hands every OBJECT in the room its own `obj+0x12`, not every creature:
the flamer's stream looks for a crow beside the pool and the casts, `stepFlames`
follows one, and the state ends into the tumble. The flare is not a second site
here: CITY is level 2, so `0x43abfa` makes a flare there a hundred rather than a
code, and no `statflare` is placed in CITY anyway.

**The fireball's own** handler, `0x455730` (its −9 test at `0x455763`), is one of
the two −9 handlers on a thing in the air; MOLITOV's shot has the other.
`0x45554f` writes it into `obj+0x12` as the
class creates the object — the same word every creature's class writes its own
handler into — so it needs a hit handler on a CAST: `CastKit.onCode`, the cast
half of `Reaction`. A function rather than a row of data, because what a
fireball does with a −9 is none of the three things the creature handlers do.
It needs a site as well as a seam: both of the things that carry a −9 look for a
cast beside the creatures. The flamer's stream is one, and on PLAYGR the flare is
the other: PLAYGR is level 4, the fourth level of its chapter, and `0x43abfa`
makes every flare on one of those four a code.

Struck in flight, a fireball stops dead. `0x455791` sticks a LATE flame on it,
`0x4557a1` marks the class's own six-byte record so it cannot catch twice, and
`0x4557a9` zeroes the horizontal velocity and sends it ten UP. Ten is inside
`0x4556d3`'s fifteen, so it is worth nothing from that frame; ten is also
`0x4555e9`'s rest, so the next surface it meets removes it. It hops, drops and
is gone, and it cannot hurt anybody on the way down.

Two of its arms are read and not built, and neither is about a thing anybody
threw. State 2 is `0x450ff0`'s: one object of this class for every
`inittirepile` record a level places, weightless, showing cel 7020 and pinned to
the record's own point by `0x4556b9`. Burning THAT is the arm that latches
`[0x4782dc]`, and the latch is the prize — `0x4562d3` lights every fireball
built afterwards at birth and `0x4556f6` holds all of them at a strength of zero
for the rest of the level. Nothing else in the executable writes that word — and
no book in the rip places an `inittirepile`, so the pinned object is never
built, the arm never runs and the latch is never set in the original either.
This page carries neither. `0x4557ba` is the other arm: the burst and the sound
a fireball answers the PLAYER's own fist with, and nothing here puts a fist
through a cast.
