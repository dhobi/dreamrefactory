# PUP & CST — characters ("puppets")

*Prerequisite: [The DFile container format](README.md),
[The image codec](image-codec.md), [SHP](shp.md) (the transparent codec), and
[SET](set.md).*

CyberFlix called the game's characters **puppets**. A character you can
interact with is split across **two** file types that work together:

| File | Holds |
|------|-------|
| **.PUP** | the "brains" — dialogue text, conversation logic (scripts), voice audio, and facial-animation frames + timing |
| **.CST** | the "body" — the character's exterior sprites (walking, standing, …), drawn in the world |

Reference implementation:
[`engine/src/df/pup.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/pup.ts) and
[`engine/src/df/cst.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/cst.ts)
(decoding; the initial skeleton came from DFET's
[`DFpup`](https://github.com/M3tox/DFET/blob/main/libs/DFfile/DFpup.h) /
[`DFcst`](https://github.com/M3tox/DFET/blob/main/libs/DFfile/DFcst.h), the
record layouts below were then validated by probing `SMETH1.PUP` and
`GANG.CST`). How the engine *runs* all this — facing math, occlusion, speech
pacing, choice bevels — is the runtime story:
**[Characters at runtime](../runtime/characters.md)**.

## Why two files?

Because they answer two different questions. The **PUP** is everything about
*talking to* a character: what they say, how the conversation branches, the
audio for each line, and how the face animates while speaking. The **CST**
("cast") is everything about *seeing* a character move around the room: the
sprite art, drawn on top of the SET background like any other moving thing.

There's one PUP per character *encounter* (`SMETH1.PUP`, `SMETH2.PUP`…), but
the CSTs are shared: **`GANG.CST`** holds the 25 named story characters,
**`EXTRA.CST`** the background passengers.

### The "1" and "2" split

In TAOOT each character has **two** puppet files. A `1` in the filename means
**before** the sinking; a `2` means **during** the sinking. This wasn't a
design choice about story so much as a **distribution** one: the game shipped
on two CDs, and the split let each CD carry the puppets it needed.

## PUP — dialogue, voice, and faces

Three containers index everything (offsets from probing `SMETH1.PUP`; frames
use the [SHP transparent codec](shp.md)):

| Where | Contents |
|-------|----------|
| Container 0 | palette @ `58`; **idle intervals**: 4×i32 minima @ `2106` (`0x83A`) and 4×i32 maxima @ `2122` (`0x84A`); **answer band** container i32 @ `2138` (`0x85A`); **puppet name** pascal[16] @ `2142`; **dialogue table**: count i16 @ `2158`, then **312-byte records** @ `2160` |
| Container 2 | **script table**: count i16 @ `22`, then 40-byte records @ `24` (`{i32 location, i32, pascal name[31]}`) |
| Container 3 | **stance register**: up to 64 × i32 @ `22`, each pointing at a stance container |

`BLKJACK1.PUP` laid out — a puppet is mostly *voice*, and the faces are the small
part. Hover the header container to see the fan-out: the stances, the scripts,
the answer band and every line's audio all hang off it.

<ByteMap map="blkjack1.pup" />

The **idle intervals** are the eight i32s before the band pointer: four
`[min, max]` tick pairs, one per `idle 1`..`idle 4` line, at 60 ticks to the second.
They are how often this character blinks and fidgets while a dialogue plaque is up —
per character, and read rather than guessed because the values differ by design (slot
1 ranges 65–200 ticks across the tree). 54 of the 55 PUPs have all four set; the
demo's `dsmeth.pup` is the exception, and a zero pair never fires. What the engine
does with them is
[idling at a plaque](../runtime/characters.md#idling-while-you-read-the-choices).

### The dialogue table

Each 312-byte record is one line the character can speak, addressed by its
**ident** (`"smeth1.031"`) from `puppetspeak`:

| Offset | Type | Field |
|-------:|------|-------|
| +0 | i16 | the **stance** the line is animated against (below) |
| +6 | i16 | how many animation-logic **ticks** the line has |
| +8 | i32 | container of the line's **voice audio** |
| +12 | i32 | container of the line's **animation logic** (lip sync) |
| +24 | pstr (256 B) | the **subtitle text** — a length byte and **255 bytes** of text |
| +280 | pstr (32 B) | the **ident** |

The subtitle is the one field in the format that is **not** one byte to one
character, and **nothing in the file says what it is**: the record header is
byte-identical across all six shipped language trees, and the original simply
handed the bytes to `TextOutA` under whatever ANSI code page Windows was running.
So the tree a file came from is what decides — Mac OS Roman for en/de/fr/nl,
Windows-1251 for ru, Shift-JIS for ja
([Languages](../../taoot/languages.md#the-code-page-is-not-in-the-data) for how
that was measured). `readPupFile` takes the encoding as an argument and keeps
**both** readings per line: `text` for anything a player sees, and `raw` — the
bytes as stored, one character each — because two jobs need the byte count rather
than the reading of it. `raw.length` is what TI paced a missing-audio line by, and
it is what a guess from the text itself is fed when there is no tree to ask (a
puppet dropped on the editor). An edit re-encodes and clamps to **255 bytes**, not
255 characters, so a Shift-JIS line cannot overflow the field or end half a
character in.

### Stances and animation logic: the face as 11 layers

A talking head is composited from **11 layers**, in fixed order:

```
background · body · head · eyes · eyebrows · nose · jaw
· left (arm) · hands1 · right (arm) · hands2
```

A **stance** container holds, per layer, a table of frame containers — all the
mouths, all the eye states, all the gestures for that camera setup. Each table is
262 bytes: an i16 count, the layer's **home anchor** (i16 Y then i16 X — where it
sits when nothing moves it), up to **32** i32 frame locations, and 32 more dwords
the engine zeroes on load as its own handle cache. 32, not 64: a count above it is
an outright error in TI.EXE (`0x441066`), and the shipped corpus tops out at 27.

**Which stance a line uses is a property of the LINE** (`+0` of its record), not
of the file. TI.EXE re-reads the 11 layer tables whenever a named line's stance
differs from the one loaded (`0x440fb0`), and both places that name a line go
through it: `puppetspeak` and `puppetbase`.

That matters most where two people share one close-up — `WILZEIT1.PUP`,
`SHAHACK1.PUP`, `BX1.PUP`, `JONES1.PUP` and a dozen more. Such a file re-uses the
same eleven slots for whichever character is talking: in `WILZEIT1` stances 0/1
put the moving `jaw` on the left face (home anchor x=171) and hold the right one's
mouth on the `nose` slot, and stance 2 swaps them (`jaw` at x=388, 17 frames where
stance 0 has 1 on that slot). Play a stance-2 line against stance 0 and the tick
anchors still place the mouth over the right-hand character while the art comes
from the left one's lips — the port did exactly that until the field was read, and
the symptom was a mouth animating on the wrong face.

A dialogue line's **animation-logic** container is what brings it to life:
a flat array of **82-byte records, one per ~33 ms tick**. Each record is a
16-byte header (dirty-rect bookkeeping) followed by 11 layer triplets
`{i16 frame, i16 anchorY, i16 anchorX}` — which frame each layer shows this
tick and where it anchors (Y before X, as [usual](set.md); frame **−1 hides
the layer**; the background anchors at the view centre 256, 132). Play the
records against the clock and the mouth matches the words. DFET noted many
facial frames appear unused — the stance tables index more art than the
shipped lines ever call for; part of that is the stance field, since art that
looks uncalled-for while you read one stance is what the lines of another ask
for.

## CST — the body that scales with distance

Container 0 carries the palette @ `36` and the member directory: a count i32
@ `0x938`, then 16-byte records @ `0x93C` pointing at each member's **logic
container**:

| Offset | Type | Field |
|-------:|------|-------|
| `0x26` | i32 | the member's **script** container (their `setupactor`/`idle`/`mousedown` handlers live here) |
| `0x2A` | pstr | the member's **name** (`"morrow"`, `"sasha"`…) |
| `0x5A` | i32 | pose count |
| `0x5E` | — | 32-byte **pose records**: `{i32 set container, … , pascal name @+16}` (`"stand"`, `"walk"`, …) |

`EXTRA.CST` is eight members and 297 pictures, and the shape of the file is the
shape of the hierarchy — member, pose, frames — three levels deep:

<ByteMap map="extra.cst" />

A pose's set container **is a [SHP state container](shp.md)** — same offsets,
same meanings — so it carries a play script @ `0x2E` with its length @ `0x70`,
a frame count i32 @ `0x72`, and **44-byte frame records** @ `0x76`:

| Offset | Type | Field |
|-------:|------|-------|
| +0 | i32 | frame image container ([transparent codec](shp.md)) |
| +8 | i16 | which **animation step** this picture belongs to — what the play script names |
| +10 | i16 | the record's ordinal within its step |
| +22 | — | padded size, **Y-first** |
| +26 | — | draw offset, **Y-first** |
| +40 | i16 | **depicted angle** in the engine's 0..255 space |
| +42 | i16 | **reference scale** for depth scaling (uniformly 96 in GANG.CST) |

So a pose is **animation steps, each holding one picture per depicted view**.
Usually eight views 32 apart, all the way round the compass — but not always,
and nothing may assume it: `stok1`'s four poses store nine 16 apart and
`life1`'s `stand` seventeen 8 apart, each covering only the half circle 0..128
(a character who is only ever seen from one side, drawn at two or four times the
angular resolution), and `willie`'s `dead` stores exactly one, at 192. The
runtime picks the angularly closest to the actor's facing relative to the
camera — never a slot index.

### The play script says how long a picture is held

`0x70` holds a step count and `0x2E` that many 1-based step numbers, in the
order they are shown. It is a play **list**, not a permutation: repeating an
entry is how the format holds a picture for more than one 50 ms pass, and this
is the same table a [prop state](shp.md) uses for the same purpose.

Every walk in the game draws ten pictures and lists twenty steps —
`1,1,2,2,…,10,10` — so a full stride takes a second, not half of one. Reading
the pictures and ignoring the script is what made the port's cast look like it
was "trying to moon walk" (#181): the same ground, in the same time, with the
feet going twice as fast. `stok1`'s `dig` and `throw` are the only other
authored scripts (14 steps over 7 pictures); every `stand` in the game lists one
step, which is what makes a still pose still.

Here's where it connects back to [SET](set.md): the sprite is scaled by the
camera projection and depth-tested against the frame's
**[Z depth layer](image-codec.md#the-z-layer-a-hidden-depth-map)**, so scenery
closer to the camera (a chair, a doorway) correctly **hides** the character
behind it. The pre-rendered world and the live characters share one depth
model; that's what keeps a walking puppet from floating in front of furniture
it should be behind.

## Related tools

- **[the puppet editor](../../editors/puppets.md)** (`/editors/puppets.html`) — a PUP's
  stances, dialogue and animLogic in a browser page.
- **[the cast editor](../../editors/casts.md)** (`/editors/casts.html`) — a CST's members
  and poses as a step × view grid, with the walk cycle played at the
  engine's tick and the depth scale that keeps feet on the floor.

## Related structures in the SET

A SET carries **actor** placement markers (`Actor` in
[`set.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/set.ts)) —
named world points ("stars") with position and facing for where characters
belong. The boot library's `setupactor` / `putdownactor` handlers, the
`opencastfile` / `openpuppetfile` commands and the `sendtoactor` /
`sendtopuppet` dispatch forms (all in the
[builtin reference](../../reference/builtins.md)) are the script-side hooks.

Saved games remember each actor's CST pose too — see
**[Saved games](savegame.md)**.

Next: the one file the game *writes* — **[Saved games (`.ti`)](savegame.md)** —
or onward to how the engine plays all of this:
**[Characters at runtime](../runtime/characters.md)**.
