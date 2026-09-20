# Fighting, and the things that fight

Seventy-three classes are registered and every one a level places is built. The
mechanism is smaller than the list: one tracker, one blow, one grip, and a
handful of bosses that keep state of their own. Damage is off by default —
`?damage=1` or Shift+H — for the reason the first section gives.

## Things that hit back, behind a switch

The port could hit and nothing could hit it, and that was a hole rather than a
design. It is now filled and **off by default** — `?damage=1` at load or Shift+H
at any time — because the other suites walk levels end to end and three
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
current cel has a degenerate body box — so being untouchable is a property of the
ART, for exactly as long as a reaction that carries no box plays.

How much that protects you depends on **which character**, and the two are not
alike. Character 1's reaction cels carry no body box at all — 5900–5902,
5910–5915, 5940–5944, 9550–9558 and 5020/5021, every one of them — so it is
untouchable through the whole of any reaction. Character 0, the one this page
plays, is not: of its 38 reaction cels, **twelve carry a box** — 922, the held
loop 4570–4572, the struggle 4575–4579, and the jolt 460–462. Held or jolted,
character 0 can be hit again. Knocked flying or floored, it cannot.

That asymmetry is worth stating plainly because the first version of this page
had character 1's table while playing character 0, and inherited character 1's
invulnerability as a claim about a player that does not have it.

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

## Two of them kill you without a blow

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

## Boggs is four thousand and it heals faster than a fist

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
is the same shape of dead code as the wraith's `-3`, and it was settled the same
way — by arithmetic that holds for the whole domain, not by a re-reading.

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

This page plays character 0 and had been reading **character 1's table**. The
symptom was visible and took a player to find it: a hand takes hold of you in
GRAVE, the grab installs 9570..9572 and the held loop that follows installs
4570..4572, and you flicker between two different people every other frame for
as long as it has you.

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
1's spends none. "No reaction in the table takes a point off anybody" was true
of the table this page had read, and not of the one it was playing.

### Both of them are playable

Character 1 is not character 0 in different clothes, which is what "plus five
thousand" had made it look like. Its state machine is `0x442ad0`, 5552 bytes, and
every one of the twenty-eight animation kinds is a script of its own —
`0x475c88` for `0x471648`, `0x475f38` for `0x471920`, and so on down. The two
machines are install-for-install the same shape (`0x444080` against `0x429690`,
`0x444da0` against `0x42a400`, `0x444ff0` against `0x42a670`, `0x445320` against
`0x42a9a0`), and what differs is which tags they reach for and what is in them:

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

The frame counts say it from the other side: `0x471648` is 47 frames and
`0x475c88` is 41, `0x471c90` is 26 and `0x476240` is 23.

Three rows of this page's own tables turned out to be character 1's, left over
from the same hybrid — the dying animation (`0x476758` tag 0, where character 0's
is `0x4721a0` tag **1**, installed at `0x429336` a line before the kind goes to
27), the hard landing (`0x476220` tag 5 against `0x471c68` tag 5), and the duck
combo, which was wrong in a third way: `0x42ab4a` installs `0x471d68` tag 6,
`4100(dx 700, dy −80) 4101 4102 4103` — a dive at four times the run. The
630..632 that stood there is tag 6 of `0x471c90`, a different script with the
same tag number.

`skullcracker/src/players.ts` is both of them side by side, and the page reads
`0x46b1a8` to pick: `?char=1`, Shift+C (which is input action 11, `0x402d22`,
the other designer's key the shipped table leaves unbound), or the chooser.

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

It did not, on its own, make Boggs killable — the machinery did, and that is now
here too. The only two things in `SC.EXE` that send −1 are `0x413bf9` and
`0x41b022`, both inside the Boggs machinery, and `0x41afd0` gates its −1 on the
two flags at `0x46e080` and `0x46e084`. What the codes unblock is the blaster's
bolt, which carries −1 and which `0x41bc71` and `0x41b510` both rewrite as a
full hundred — against Boggs and against its machine, and against nothing else
in the game.

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

### The thing in the water lets go by SINKING, and that is why SEWER stopped

`initbush` — the thing that comes up out of level seven's water — held the
player at x1964 for the rest of the run, which is why this branch's SEWER suite
had a standing failure and why the level could not be played through.

Two things each waiting for the other. This page had the bush waiting for the
player to be released before it would sink, and the player waiting for the bush's
cel to stop gripping before being released. `0x43ef31` says otherwise, and it is
one test with two arms:

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
**alive**: this page had that one backwards and had written −5 down as "what it
gives a player who is already dying". It is the opposite. The bush grabs you for
about a frame and then slumps you — `0x42e8b3`, half gravity, holding nothing.

The held cels 4570..4572 carry a body box, unlike every knockdown cel in the
book, which is what lets the second blow land on a player the first is still
holding.

One more thing fell out of the same fix. `0x4285c1` leaves the held state and
`0x4285db` writes 1 into `obj+0x34` on the way out — the player is SETTLED again,
not dropped from wherever the grip had them. This page's comment said so and its
code did not, and in SEWER's hall of lifts that meant a grab that ended a pixel
above the walkway dropped the player straight through it into the sewage
underneath. Standing them up is not a free pass: the gait's own `surfaceUnder`
runs on the next frame and puts them back in the air when there is nothing within
eight pixels of their feet, which is what a grab over a pit wants.

## The thing in the water comes up, and cannot reach

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

The reach took a second look. The creator puts it at the record's point plus
eighty (`0x435bf7`), which on SEWER's hall bushes is y 17321 against a floor at
17513, and it looked for a while as though the bush stood 190 to 215 pixels too
high to reach anybody — consistent across all eight, so systematic rather than
one bad record. It was systematic, and it was not the bush: every prop's strike
box was being lifted by `height - posY`. See "A collision box is a translation"
below. With the box translated the way `0x40e680` translates it, the bush closes
on a player walking underneath it, on its own resting y, and holds.

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

## A hard blow costs you the gun, and the band says which key

Two things on the interface turned out to be wired to the key map, and one thing
that looked unwired turned out never to have been wired at all.

### The knockdown is also the disarm

`0x449115` is the comparison this page already read for the reaction — over
sixty and you go down, under it you stagger. What was not read is the six
instructions after it:

```
  449115  cmp di, 0x3c            ; the same sixty
  44911b  0x448bf0()              ; is the player one of the armed kinds?
  449125  ...                     ; player+0x16, player+0x28, player+6, [0x479434]
  449146  0x45b060(...)           ; and the gun is on the floor
  44914b  [0x479438] = 0          ; hands empty
  449157  0x40d4f0()              ; redraw the panel
```

`0x448bf0` is three comparisons: `player+0x18` between 0x12 and 0x16, which is
the five armed player kinds and nothing else. `0x45b060` is the spawn this page
already had — it is what reaching for a second gun runs to throw the first one
down, gravity 1.0 and bounce 0.3 — so a knockdown and a swap put the weapon on
the floor by exactly the same route. The other player class carries its own copy
of all six at `0x42ec07`, so it is both characters.

What does **not** disarm you is a code. `0x448c72` reads the sign of the blow
first and dispatches a negative one before any of this arithmetic runs, so a
claw's grab and a wraith's hold leave the gun where it is.

## A hatch in the ceiling and a fork of lightning

The last two unbuilt classes, and they could not be less alike.

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

SEWER's hall of lifts is the one stretch of the game that cannot be walked, and
an attempt at it found three real defects, fixed all three, made the hall
crossable end to end — and turned the bushes from things that DUMP you into
things that PIN you, which broke two earlier stretches of the same level that
were built on being dumped. The whole of it went back. This is what the next
attempt starts from, because the cause turned out to be underneath all three.

The bush handler is `0x43ec80..0x43f174`: one function, a switch on `obj+0x18`
with five kinds through the table at `0x43f150`. Two of the things that were
unread are now read, and neither is the problem. `0x43045d` is a spend rather
than a rate limit — the frame a hitter connects, `[obj+0x1a] = 0` and the scan
stops, unless the strength is `0x65` — and the bush re-arms every frame anyway.
The re-trigger cooldown does exist and it is `user+0xa`: `0x434540(0x28) + 0xa`,
a random 10 to 49 frames, reset after every trigger of the PAIRED bush, and
gated on the player being neither held nor already slumped.

The problem is a global this page had never looked at.

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
player, released when the cel loses its strike box — and that is exactly why
fixing the three defects produced a pin. Nothing ever took the player's step
away, so a grab could only ever be a hold.

The next attempt is a port of the gate rather than another patch. What it cannot
settle by reading is the last question: the hall wants the player left on the
walkway and door-7 wants them dumped off it, and both come out of this one
machine, so the difference has to be geometry and has to be measured.

## Twenty-six classes, one brain

The complaint was that the enemies wander rather than fight. They do, and the
reason was that this page had read every class's ANIMATIONS and none of its
decisions — the note in `src/walk.ts` used to say so outright, that the territory
numbers were "in the AI struct nothing has read". They have been read now, and
what is in there is one brain with twenty-six sets of numbers.

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

Not a judgement. A cel carrying a STRIKE BOX is the engine's own mark for a frame
that hits, and it is the very flag the tracker reads at `out+6` to tell whether
the player is swinging. So every tag of every script a class installs whose cels
carry one is an attack, read out of the book the class actually appears in. The
punk's are 1923/1924 (the punch), 1931/1932 and 1934/1935 (the two swings) and
1943 (the flying kick, `0x477368 tag 0`, `dy -480` on the frame it leaves the
ground), against a walk on 1910…1915 that carries none. That also gave this page
the `dy` field it had no reason to have before: only the attacks ever leave the
floor.

`src/fights.ts` is the table — the bands, the walk and the attacks for the
twenty-six classes that have them — and `stepFight` in `src/walk.ts` is the
machine.

### It takes nothing

The brief was the behaviour and not the damage, and the damage is where a
surprise was waiting: the enemy strike boxes have been wired into `takeHits` the
whole time, and the only reason nothing was ever hit is that no creature in the
game came close enough to use one. Bringing the AI in makes that loop live. So
the creature half of it now has a switch of its own, `?foehit=1`, and it is off
even when `?damage=1` is on. Everything else `?damage=1` arms — the presses, the
girders, TOWER's current, the sewage — is unchanged.

### What the classes throw, and what still throws nothing

Ten classes in this game fight at a distance. For a long time not one of them
could reach the player: a `Brain` is handed one enemy and has no creator, and
every projectile in the game is an object of ANOTHER class that the thrower's
machine spawns. `BrainCtx.cast` is that seam now — a module reads its class's
spawner into a `CastKit` and calls `cast` at the instruction the executable
calls the spawner at — and **five of the ten are wired**:

| class | where | what leaves it |
|---|---|---|
| `initpuke` | LAB | a gob: 100 ahead, 65 up, `dx 400 / 13` = 31px a frame, gone at 1000 from the player (`0x418400`) |
| `initcop` | MAZE, BARREL | a slug that writes its own ±35, lives a hundred FRAMES, and flies **harmless** until it is inside 130 of the player, where `0x413e79` arms it at a hundred |
| `initeyeball` | SEWER | a glob, five cel sets cycling on `AI+4`, launch into a looping flight, gone 600 from where it STARTED, and worth **−2** — a code, not damage |
| `initzomb` | CAVERN, GRAVE | a cloud that does not move at all: 40 up, 65 in front, eight frames, **−2** (`0x420990`) |
| `initigor` | RAVECAVE | 26 up and 35 along with a weight of 0.8, so it ARCS, and it unwinds its own four cels where it lands (`0x421310` index 1) |

Two of the five carry codes rather than damage, which makes them the first
classes a level places that can send one — see `codes.ts`, whose note about that
had to be corrected. And `initeyeball` and `initpuke` are the two classes with
no strike box on any cel of their own: until this, they closed on the player and
stood there, because the projectile IS the attack.

**Still throwing nothing:** `initknifeboy` (which throws two different things, a
flat knife and a lob), `inithardcore`, `initvpriest` (which also summons bats),
and the two boss volleys, `initkragg` and `initwbooly`. The knife needs one
piece of machinery none of the five did: its stick sequence carries a stride per
cel (`dx 0 50 0 50 0 0 0`), where every kit so far has one speed for its whole
flight.

### What is read and not yet done

- **The leaping attacks do not leap.** The `dy` is in the table — the punk's
  flying kick is `-480` on the frame it leaves the ground — and nothing applies
  it. Putting it straight into `y` sent WOODS' husk ninety-six pixels up, past
  the reach of the floor test coming down, and nine thousand pixels out of the
  level, still swinging. What it wants is the arc the casts now use: `0x42fd9e`
  puts a velocity into the point whole and `0x430327` adds `trunc(weight * 10)`
  to it every frame. The reading is settled; applying it to the player's own
  states is the work that is left.
- **A class that stands still keeps standing still.** If its own gait carries no
  stride it does not close, and its attack's stride does not move it either.
  LAB's ten `initarm` are the case — arms reaching out of a wall — and giving
  them the walk their class data holds had all ten crawling across the floor.
- **A keeper goes for its lever first.** `0x438200` finds the first unlit switch
  inside the class's own rect, and that is the whole of level six; the shared
  brain would otherwise march SERVICE's keepers at the player and leave it dry.
  With nothing left to throw, they fight like everything else.
- The band table is read as "the innermost band swings, the rest close", which is
  what `initwerea`, `initdog`, `initwerec`, `initigor` and `initbat` do at their
  last band. The casters do not: `initvpriest` throws from its OUTERMOST band,
  because the thing it throws has the distance to cover. This page does not yet
  tell a caster from a puncher.
- The casters' band rule is still unread here — see the bullet above; what has
  changed is only that the thing they would throw now exists.
- The patrol still turns at the record's rect. The engine turns a hundred pixels
  inside it (`0x44e68e`, `0x44e69f`) and only when the territory is wider than
  three hundred, and that is left alone here on purpose — it moves every foe in
  every level and belongs in its own change.
- The decision budget (`AI+4`, seeded three at `0x450ad1` and spent a manoeuvre
  at a time) is not spent. What puts a class back on its patrol here is the
  player leaving its rect, which is state 0's own test read the other way round.
