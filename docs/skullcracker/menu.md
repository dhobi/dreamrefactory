# The menu, and everything before a level

The film layer is the completely DreamFactory half of this disc, and the menu is
part of it: an interactive movie the engine can already play, answering clicks
with frame names while a PowerPC executable holds the state behind it. This is
that shell — the start sequence, the title menu, the preferences panel, the
cheat words and where the sound lives.

## The start sequence is a string table in the executable

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

## How a DreamFactory menu answers with no script

`menu.mov`'s six buttons are type-2 jumps to six one-frame stubs at the tail of
the same film — `"frame 2"`…`"frame 7"` — and each stub is a type-1 **exit**. The
film's whole return value is *which frame it stopped on*; the executable read that
and did the rest. One button is the exception and answers by itself: Prefs is a
type-3 chain naming `prefs.mov`.

That is half of it. The other half is not this port's reading of the labels, which
is what `skullcracker/src/main.ts` used to keep, but the executable's own table —
and it is reached by FRAME INDEX rather than by frame name:

```
  45dee7  movsx eax, si          ; si = the film's current frame index
  45deea  sub   eax, 0xa7        ; 167
  45deef  cmp   eax, 7
  45def8  jmp   dword ptr [eax*4 + 0x45e1ac]
```

`menu.mov`'s stubs are frames 168..173, so the eight slots read straight across:

| frame | index | slot | what it does |
| --- | --- | --- | --- |
| `"Name 169"` | 167 | `0x45deff` | the attract branch |
| `"frame 2"` | 168 | `0x45df7c` | `[0x46b208] = -1` → `char.mov` — **Begin** |
| `"frame 3"` | 169 | `0x45df8d` | `[0x46b208] = -2` → a slot dialog — Open |
| `"frame 4"` | 170 | `0x45e082` | `[0x46b208] = 3` → `helpwin.mov` |
| `"frame 5"` | 171 | `0x45e093` | `[0x46b208] = 2` → `prefs2.mov` |
| `"frame 6"` | 172 | `0x45e0a4` | `[0x4abdfe] = 11` → `0x40340f` — **Quit** |
| `"frame 7"` | 173 | `0x45e0be` | `[0x46b208] = 6` → `credits.mov` |
| `"demo frame"` | 174 | `0x45e0cf` | the attract branch again |

Two of those had been read wrong here, and the second is the interesting one.
"frame 6" is Quit — state 11 sets `[0x46b200]` and `0x403433` falls out of the
shell loop into `0x40a4a0` — where this page had it playing a film.

**And Begin does not begin.** It plays `char.mov`, which asks which of the two
Skull Crackers you are. The game starts after that: the chooser leaves
`[0x46b208] == 3`, `0x403154` drops out of the menu state, and `[0x4abdfe]` is
already 3 — `0x4031b2`, the level runner. So the whole front end is
**menu → chooser → level one**, and this port now follows it into `walk.html`
with the two words the front end settled in the query string.

Prefs needs BOTH of its films, and this page had them the wrong way round. The
menu's stub is a type-3 chain naming `prefs.mov`; `0x45e093` sets
`[0x46b208] = 2`, which is what the shell loop reads when the menu ends:

```
  403085  0x4498c0(Menu.Mov)      ; play the menu and wait
  40309d  ax = [0x46b208]         ; what its exit frame set
  4030a6  cmp ax, 2               ; ...2 is this button
  4030ac  call 0x45d5a0           ; the MODAL, on a panel that is already up
  4030b1  0x4498c0(prefs2.mov)    ; and only then the second film
  4030cc  jmp 0x40307c            ; back to the menu
```

A film played after the modal has returned can only be the panel going away, so
the chain is not overruled at all: `prefs.mov` is the panel arriving and
`prefs2.mov` is it leaving. The frame names say the same thing from the other
side — the two are one sixty-frame move cut in half, named `picsout 1`…`30` and
`picsout 31`…`60`. Opening the panel with the second half played the animation
backwards: it slid off the screen and then took clicks.

## The panel the pan slides in is empty, and the executable fills it

`ltpan.mov` and `rtpan.mov` slide one character's picture aside and a blank panel
in on the other side. The blank is deliberate: it is where the chosen character's
dossier goes, and the dossier is not in the film.

`0x45e14c` waits for one frame — `cmp word ptr [esp+0x250], 0x2a`, frame 42 of 59
— reads `[0x46b1a8]` and calls `0x45e390` for character 0 or `0x45e520` for
character 1, handing each a point:

```
  45e162  {0x57, 0x128}   ; character 0, y87 x296 — the right-hand panel
  45e189  {0x57, 0x28}    ; character 1, y87 x40  — the left-hand one
```

Same y, and an x on whichever side the pan emptied. Each writes seven lines
sixteen apart in ink 0xe1, then an eighth somewhere else: `0x45e4d5` adds
`(0x32, 0x9d)` to the running point and `0x45e64b` adds `(0xa, 0x9d)`, which is
the name plate in the strip under the panel.

```
  45e3e2  0x40a080(x, y)
  45e3ea  y += 0x10
  45e3fc  0x40a360(text)
```

The text is all in `.data` between `0x4792b5` and `0x4793f5`: **Mortis Rigor**,
240 lbs, 6'4", Kingsport, Tenn., strengths brute force and raw power, hobbies
Chevys, plated as *The SkullCracker*; and **Penelope Jones**, 110 lbs, 5'10",
Glasgow, Scotland, strengths speed, grace and finesse, hobbies Astronomy, plated
as *Bonebreaker Jones*. The two lists are not even in the same order — character
0 gives its weight before its birthplace and character 1 the other way round.

## The chooser answers with a frame name, and prefs with nothing at all

`char.mov` is 63 frames that loop from 20 to 63 with four regions live the whole
way — two on the left figure chaining `ltpan.mov`, two on the right chaining
`rtpan.mov`. Every one of those frames sets flags bit 2, "do not wait for the
regions", which is a frame that animates and is still clickable. Reading that bit
as "has no regions" is why the two figures could not be clicked here at all;
`0x44979f` reads the region count either way and only the wait is skipped.

Which pan means which player is in the pans' own headers, through the one
mechanism a DreamFactory film has for answering a question it was not asked:

```
  449ea9  bx = findFrameByName([hdr + 0x40])    ; actionframe 1
  449ebd  bp = findFrameByName([hdr + 0x50])    ; actionframe 2
  449fbb  if (current frame == bx)  0x45e1e0(1)
  449fd6  if (current frame == bp)  0x45e1e0(2)
  45e369  [0x46b1a8] = 0   ; when the argument was 1
  45e374  [0x46b1a8] = 1   ; otherwise
```

`ltpan.mov` names its `"frame 1"` as actionframe **one** and `rtpan.mov` names its
`"frame 1"` as actionframe **two**. That is the entire character chooser: two
header fields, one comparison a frame. Each pan then ends on a frame that DOES
wait, for a single region at (219,225)-(291,264) — the accept button.

Each pan also leaves a HOLE, and the film never fills it — see the section
below.

Neither prefs film has **any regions anywhere in it**. The executable owns the panel from the
moment the film stops: `0x45db40` draws it and `0x45d700` is a fourteen-way
dispatch on a control id. Fourteen controls, and their rects are in `.data`:

```
  0…7    0x479188..0x4791c0   eight boxes, two columns of four  -> [0x47917c] = i
  8      0x4791c8  {207,322,241,502}   0x45d73f  xor ax, ax     -> the way OUT
  9      0x4791d0  {200,122,215,222}   0x45d743  x / 10         -> volume, 0x4274e0
  10     0x4791d8  {226,123,241,138}   0x45d788                 -> [0x46b20c] =  1
  11     0x4791e0  {226,171,241,186}   0x45d79b                 -> [0x46b20c] =  0
  12     0x4791e8  {226,219,241,234}   0x45d7ae                 -> [0x46b20c] = -1
  13     0x4791f0  {173,123,188,138}   0x45d7c1                 -> [0x46b1fc] ^= 1
```

Control 8 is the one whose handler returns zero, and `0x45d6ea` loops while the
return is not zero — so that wide rect across the bottom right is the only way
out of the panel, and the slider is the rect after it rather than that one. This
page had the two the other way round.

Which corrects something this page had written down as a fact: *nothing writes
`0x46b20c`, so the difficulty is always zero*. Three instructions write it —
`0x45d788`, `0x45d79b`, `0x45d7ae` — and they are those three boxes. Zero is the
default, not the only value. Which end is which is settled by what the number
does rather than by a label: `0x448ac2` gives `trunc(d × 600) + 1200` health and
`0x40e300(n)` returns `n - (n/2)·d`, so **+1 is easy** — more health, softer
blows — and `0x40e300` is called from the classes' own constructors (Boggs' four
thousand at `0x41be84`, his machines' three at `0x41b474`) and from neither
player's hit handler. The difficulty makes the LEVEL harder, not the blow.

## The eight boxes are the keyboard, and `[0x47917c]` is not a setting

The eight numbered boxes looked like a setting with eight values. They are not:
`[0x47917c]` is which box is SELECTED, and the panel's event loop does the rest.
`0x45d6d5` uppercases whatever character was typed and calls
`0x45d810([0x47917c], char)`, which binds it — or refuses, twice over:

```
  45d824  for action 1..8: if 0x40e7e0(action) == char  ->  return   ; spoken for
  45d871  [0x46b210 + old] = 0                                       ; unbind
  45d888  [0x46b210 + char] = action                                 ; bind
  45d88b  0x40e870(action, &name)
  45d893  if name is empty  ->  put the old one back                 ; unnameable
```

So a binding is one byte of the 256-byte table at `0x46b210`, indexed by the
character, holding the action number 1…8 — the same table `0x403b90` indexes on
every keypress in the level, and the same eight actions `0x402be0` spends on one
global apiece. **Every key in the game is rebindable, and the eight letters this
port had hard-coded are only what `0x46b210` ships with.**

The other half of `0x40e870` settles something this page had guessed. A bound
character can be named three ways: `A`…`Z` and `0`…`9` are themselves, character
32 is the string at `0x46bf0c` — `"Sp"`, two characters wide, which is what the
`cmp byte ptr [esp + 0x18], 2` in the draw loop shifts left by four pixels — and
characters 24…27 come out of a four-entry table at `0x40e980`:

```
  24  ->  0x46bf08  "J4"      26  ->  0x46bf00  "J2"
  25  ->  0x46bf04  "J3"      27  ->  0x46befc  "J1"
```

They are a **joystick's four buttons**, and the shipped table binds them beside
the letters: J4 punches, J3 kicks, J2 jumps and J1 is INV. This port had those
four entries written down as arrow keys. The arrows in this page are its own.

## The slider is ten segments and step 0 is not silence

`0x45dd2e` builds one rect out of the slider's — `{top, left, bottom, left + 8}`
inset by one — and `0x434270(rect, 10, 0)` walks it across ten times. A segment
is lit while its index is at or below `[0x479180]`, in `0x11` up to the seventh
and `0xd7` past it, so **volume 0 still lights the first segment**: the slider
has no silent end and the mute this page offers is not one of the original's
controls. The value comes off the click's own x — `(x - left) / 10`, clamped —
and goes to `0x4274e0`, which is a `cmp` and a call into the mixer. What a step
is worth in loudness is that library's and is not in `SC.EXE`.

`0x45d5b8` fills the slider from `0x4274b0`, the mixer's current level, rather
than from a stored word, so the panel opens on whatever the machine is at and
there is no shipped default to read.

And `[0x46b1fc]` is the **theme** and nothing else. `0x403cfb` is the in-game half
of the same switch: on, `0x40f190(0x4ac370)` starts the level's theme bank; off,
`0x427960(0, 0, 1, 0)` stops it. No effects bank is ever consulted, so turning it
off leaves every fist and every door exactly as loud as they were.

## The second menu button is a DEMO PLAYER, and the save game does not exist

`0x45df8d` sets `[0x46b208] = -2`, which this page had written down as "a save
dialog". It is not one, and there is no save game in Skull Cracker at all.

**The recorder is dead code.** `0x403900` is the routine behind "Save in which
slot?" (`0x46b401`) and it has **zero callers** anywhere in the executable. Only
the reader is reachable, from `0x45df3c` and `0x45e10c`.

**And the slots are not saves.** `0x4034a0` asks "Load from which slot?"
(`0x46b3e9`), opens `skuldemo.dmo` — `0x46b3d9`, as a `DEMO` container — pulls
container N out of it and copies it into a 0x1c2c buffer at `[0x4a02b8]`. What
that buffer holds is:

```
  +0    word    chapter          -> [0x4a02b0]
  +2    word    scene            -> [0x4a02b4]
  +8    dword   how many entries
  +0xc  word[]  one per engine frame
```

and `0x4037b2` walks it with the cursor at `[0x46b31c]`:

```
  4037b2  si = [buf + cursor*2 + 0xc]
  4037c8  if (si < 0)  0x403820(-si, 0)     ; a RELEASE
  4037dd  if (si > 0)  0x403820(si, 1)      ; ...and a press
```

`0x403820` is the same function the keyboard reaches through `0x46b210`. So a
slot is an **input recording** — one signed action a frame, of the same eight
actions the preferences panel binds keys to — and the button plays it back.
That is also what `skuldemo.dmo` is, which answers the other open question about
that file.

It is not built. A 1996 input stream replayed against a re-implementation
desyncs, and the desync is the only thing it would demonstrate.

## The writing that was missing is on the TITLE screen

The kill vignette shows nothing written on it because there is nothing written on
it. The high-score board is drawn over `menu.mov`, and `0x45de89` is the line
that says so: while `[0x46b208]` is 1 — the menu — and the film's frame index is
**0…0xa7**, `0x45ddd0` draws the board over whatever the film is showing. 0xa7 is
167 and `"frame 2"` is index 168, so that range is exactly the attract loop and
it stops where the six button stubs begin.

What gets a score onto it is `0x403340`, the state the seven vignettes belong to:

```
  4033ca  0x40e990(KILLn.MOV)      ; one of seven, 0x434540(7)
  4033d9  ax = [0x46b20c]          ; the difficulty
  4033e3  0x40d4d0(ax)             ; the score, which is [0x4a4f00]
  4033e9  0x40f650(score, ax)      ; offer it to that difficulty's ten rows
  4033ee  cx = 1                   ; and the shell goes back to the title
```

Which also settles what the kill films ARE: `0x4294e7` only sets that state once
`0x40d490` has found the lives below zero, so they are the GAME OVER films, not
the per-death ones.

There are **three boards of ten**, one per difficulty, each row nineteen bytes —
`{ Pascal name[13], dword score, word level }`, which is the `lea edx, [eax +
eax*8]` / `[eax + edx*2]` all three arms index with:

```
   1  EASY     0x4a4f10   0x40f889
   0  MEDIUM   0x4a4d80   0x40f790
  -1  HARD     0x4a4e40   0x40f69b
```

The insert is one loop: `0x40f6b6` finds the first row whose score is under
yours, `0x40f6d6` shifts the rest down, `0x40f722` writes the score and the level
and only THEN does `0x40f742` put up the dialog `0x46bf4d` names — so a cancelled
dialog leaves a nameless row on the board rather than no row at all. A name over
twelve characters is cut (`0x40f74f`), and because an empty row's score is zero
and the test is `>=`, a score of zero never gets on.

`0x40f990` draws it twice from the same point (`{y 107, x 44}`, one dword at
`0x45de90`): once offset by (2, 1) in `0xe8` and once square in `0xe1`. The only
thing the two passes do differently is the difficulty heading — the shadow draws
all three of `Easy`, `Med` and `Hard` and the second draws only the one
`[0x46b20c]` is on. That is how the board says which of its three tables you are
looking at. An empty row shows `-----` for the name (`0x46bf71`) and `-` for the
other two (`0x46bf6d`).

The one thing a browser cannot have is `Skull.sco`, the file `0x40f210` reads the
thirty rows back from. They live beside the preferences instead.

## Eight words, one per length, and a two-thirds-of-a-second memory

The cheat words are not a table of strings compared against the last thing you
typed. `0x403ed0` is called from `0x403c1b` with every **lowercase** letter the
level's key loop sees, before that letter is uppercased and looked up as an
action — so a cheat is typed with the same keys that are walking you around —
and the recogniser is this:

```
  403ed0  if (now - [0x46b324] >= 0x28)  [0x46b320] = 0   ; 40 ticks and it forgets
  403f00  [0x4a02c1 + i] = char                           ; a Pascal string
  403f0b  [0x4a02c0] = i + 1                              ; ...its length byte
  403f17  if (++i >= 0x13)  i = 0                         ; nineteen and it wraps
  403f29  eax = i - 3;  if (eax > 7) return               ; only 3…10 are words
  403f35  jmp [eax*4 + 0x404140]                          ; ONE candidate per length
```

The jump table is indexed by **how many characters have been typed since the last
pause**, and each of its eight slots compares the accumulator against exactly one
string. Which is why the eight words are eight different lengths: type nine
letters and the only word you can possibly have typed is `marsupial`. `0x4087c0`
is `ms * 3 / 50`, a sixtieth-of-a-second tick, so the 0x28 is two thirds of a
second between letters.

```
   3  zip         0x46b438   [0x4ac38a]++, 0x402760   the next initplayer point
   4  eshs        0x46b440   0x45ef30(0x78)           120 rounds, if you are armed
   5  cthia       0x46b460   0x404160, state 2        asks, and goes to that level
   6  jetson      0x46b430   0x40d350(-850)           850 more on the mission clock
   7  bewitch     0x46b448   0x40d400(5)              five lives
   8  harakari    0x46b424   0x402ac0(0x1f4)          500 health gone
   9  marsupial   0x46b454   0x402b20(0x400)          1024 health back
  10  myxzltplkt  0x46b418   0x404136 mov ax, 1       nothing at all
```

Two of those are corrections. **`jetson` is TIME, not score.** `0x40d350`'s
argument is signed — positive sets `[0x4a4d68]` and negative adds to it — and
`[0x4a4d68]` is the mission clock, the word every chapter's entry function fills
from its book's `timer` record — see "The mission clock was a record all along"
above. The gift is capped at
`[0x4a3b18]`, the dial's own full scale, and the same −850 is what the clock
PICKUP hands over (`0x428354`). And **`myxzltplkt` really is the joke it looks
like**: `0x40411e` makes the comparison and `0x404136` loads 1 into `ax` whether
it matched or not, so the branch that would have done something was never
written.

`eshs` is the only one with a guard: `0x402ee0` dispatches on the character and
both halves (`0x42e6e0`, `0x448bf0`) ask the same thing — is the player's kind
between 0x12 and 0x16, which is the armed set. Empty-handed the word is nothing.

One consequence for this page. Four of its own keys were bare letters — `h` for
the damage switch, `n` for the spawn cycler, `c` for the character switch and `m`
for the mute — and three of those are the first letter of a word. **They are held
with SHIFT now.** None of the four is the original's key, and the original's own
designer set is behind a modifier too (`0x403c40` tests the event's modifiers
against 0x1fa0 before it will read one), so this is the shape the executable
already has. `[` and `]` stay bare: no cheat word has a bracket in it.

## The sound was one pointer away

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

## The films keep their sound somewhere else entirely

None of that mixer reaches a film. A film's audio is in the film, and there are
two kinds of it: the loop-table **bed** a segment starts by itself, and one-shots
named by a frame. `menu.mov` and the sixteen chapter briefings have a bed. Nothing
else does — and "nothing else" is Boggs' spoken orders, the seven kill vignettes
and the four time-out ones, all of which this page played in silence, because its
player fired a one-shot only from a CLICKED region and a frame's own sound was
read and thrown away.

The films are all one shape, and the shape is a television set: a console powers
down (`soundout 2`, `soundout 3`), a little 160x111 monitor comes on inside it
(`sound 1`), the piece plays on the monitor, and the monitor snaps off
(`Mon. OFF`). `boggs01.mov` is that with four segments of speech in the middle —
`1a`, `1b`, `1c`, `1d` — and `kill1.mov` is the same with one.

Which is also where the pacing was wrong, because the two facts are the same fact.
Those inset segments are authored at the film's own three ticks, 50ms, and the
sound over one is exactly as long as its picture:

| segment | frames | picture | its sound |
| --- | --- | --- | --- |
| `kill1.mov` seg 2 | 186 | 9.30s | `kill 8` 9.29s |
| `boggs01.mov` seg 2 | 106 | 5.30s | `1a` 5.25s |
| `boggs01.mov` seg 3 | 152 | 7.60s | `1b` 7.57s |
| `boggs01.mov` seg 4 | 127 | 6.35s | `1c` 6.32s |
| `boggs01.mov` seg 5 | 177 | 8.85s | `1d` 8.82s |

`mov-pace.ts`'s 66ms native floor — a rule for the films that carry no timing at
all, the publisher logos — was raising every one of them by a third, so the
picture outran the line spoken over it. A segment with a bed is paced against the
bed; a segment without one is paced by its own authored holds and by nothing else.

Both ends of every one of these films then hold on a frame whose flags bit 0 says
**wait for the voice**: `kill1.mov` holds its console still until `soundout 3` is
done, and holds again before the black frame until `Mon. OFF` is. With no sound
playing that waits on nothing, which is exactly what it did while there was none.
