# DFET bug report

Findings from porting DFET's container-format decoders to TypeScript for
[dreamREfactory](https://github.com/dhobi/dreamrefactory), a browser reimplementation of
the DreamFactory 4.0 engine. Everything under `engine/src/df/` started as a port of
`libs/DFfile/`; the entries below are places where that port had to *diverge*
from the C++ to get correct output, plus defects noticed while reading the
code.

An extraction tool writes a BMP or a WAV for a human to glance at; the port
**runs the game**, so a decoding error shows up as wrong pixels in motion, a
character who never walks, or loops played in the wrong order. Several entries
were found that way, and most say how they were found.

Checked against DFET at commit
[`e97d34c`](https://github.com/M3tox/DFET/commit/e97d34c9166ff6d96245bd332d4aa755df49972f)
(2026-07-25). Line numbers refer to that revision and were re-verified against it
on 2026-08-08. Corresponding port code is linked per entry.

Ordered by confidence: §1–5 are behavioural bugs with a known symptom, §6–12 and
§14 are latent memory-safety and robustness defects found by reading (§11 and §12
in `DFpup`, read while recovering which stance a dialogue line animates against),
§13 is a decoding bug that every shipped Z layer triggers, §15 is a set of
mislabels in `DFset` rather than a defect, and §16 is a crash on two files that
ship on the retail disc.

Wherever an entry says "latent", it is a **measurement over the shipped
corpus**: every stored count and length byte the latent entries are about was
scanned across the game's own files (474 `.SET`, 316 `.PUP`, 558 audio banks,
275 `.MOV`, both discs, seven language trees), and each entry reports the
largest stored value. None of the latent defects fires on shipped data; all of
them fire on a corrupt or truncated file, and the retail disc carries two of
those (§16).

§13 is established by a self-check run over 1836 real Z layers: the wrong base
is DFET's.

Every entry carries a **Fix** section with a proposed patch, written against
DFET's existing style and naming rather than as a rewrite. The patches are
*untested* (no build of DFET was available), so read them as worked-out
suggestions, not as a pull request.

---

## 1. Overlapping back-references are copied instead of tiled (image codec)

**Description**

In `DFfile::getRawImageData` (`libs/DFfile/DFfile.cpp:857-862`), run mode 7
copies `count` bytes from a back-reference whose distance is read from the
stream:

```cpp
case 7:
    // copy x count bytes from offset specified by given int16_t
    memcpy(currOUT, currOUT - *(uint16_t*)currIN, count);
    currIN += 2;
    break;
```

When the back-distance is **smaller than the run length**, source and
destination overlap. `memcpy` is undefined behaviour on overlapping regions,
and on every real implementation it behaves like a block copy: the run
duplicates the back-reference block once and then reads bytes it has just
written *as they were before the write*. What the format means is the LZ77 /
`rep movsb` behaviour — the source advances into the freshly written output, so
a distance of 3 with a count of 12 tiles that 3-pixel pattern four times.

Run mode 3 (`DFfile.cpp:836-840`) has the same shape and needs the same
treatment, though it only bites when a row lookback is smaller than a single
run — i.e. on images narrower than the run length.

The port writes the short-distance case as an explicit forward byte loop and
keeps `copyWithin` (JavaScript's `memmove`) for the non-overlapping case:
[`engine/src/df/image.ts:126-138`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/image.ts#L126-L138).

**Reason**

It decodes the wrong pixels, and because the codec is delta-encoded the damage
does not stay local: every later frame in the chain copies forward from the
corrupted buffer, so one bad run poisons the rest of the sequence.

Found visually: walking the boat deck (`DECKBD`) produced coloured streaks
across the sky that grew with the walk, the signature of a delta chain decoding
against a poisoned predecessor. The walk contains exactly **four** mode-7 runs
with `distance < count`; special-casing them removes the streaking. Dumped as
stills, the same corruption looks like a handful of slightly-off frames, which
is why an extraction tool does not show it.

Across every frame of the 78 English sets (21,876 frames, 67.8 million mode-7
runs) there are **3,619** runs with `distance < count`, concentrated where the
art has smooth gradients to tile: `deckbd2` 811, `DECKBD` 589, `POOP` 210,
`FORE` 178, `DECKA` 163. It is not an exotic case; it is the sky. Mode 3 has
**zero** overlapping runs in the corpus, consistent with it being reachable only
on images narrower than a run: worth fixing for correctness, never observed.

**Fix**

One helper next to the decoder, with both modes routed through it:

```cpp
// A back-reference may overlap its own output. The engine's `rep movsb` tiles
// in that case, so the copy has to be a forward byte loop, not a block copy.
static inline void copyRun(uint8_t* dst, const uint8_t* src, uint32_t count) {
    if (dst > src && static_cast<uint32_t>(dst - src) < count) {
        for (uint32_t i = 0; i < count; i++) dst[i] = src[i];
    } else {
        memmove(dst, src, count);   // memcpy is UB here even where it works
    }
}
```

```cpp
case 3:
    copyRun(currOUT, currOUT - lookUpOffset, count);
    break;
...
case 7:
    copyRun(currOUT, currOUT - *(uint16_t*)currIN, count);
    currIN += 2;
    break;
```

The `memmove` branch also covers the *negative* `lookUpOffset` that row modes
6–9 and 15–18 produce, where the source sits ahead of the destination and no
tiling is wanted.

The row-level `memcpy`s at `DFfile.cpp:802` and `:808` need no change: their
lookback is always a whole number of rows, so it can never be shorter than the
`width` bytes they copy.

---

## 2. The SET actor record's tail is discarded, dropping secondary stars

**Description**

`DFset::readActorsContainer` (`libs/DFfile/DFset/DFset.h:241-269`) reads each
actor record's leading fields and identifier, then skips the remaining 41 bytes
of the 54-byte slot:

```cpp
actors.at(act).identifier.assign((char*)container, *container++);
container += 41;
// I have no idea what these do... probably just old copied mem
```

It is not old copied memory. The tail packs an **optional secondary actor**
starting at record offset **+30**, laid out `{i16 rotation8, i16 X, i16 Z,
i16 Y, pascal-string id}` — byte for byte the same shape as the primary at +4.
In `HALLA`, the `sasha.1` record carries `sasha.2` at (7212, 10494, 251) in its
tail, and the `ex1` record carries `ex2`.

The full 54-byte record is therefore: `i32 unknown` at +0, the primary at +4
(its identifier field running to +29), the secondary at +30 (its identifier
field running to the end of the record).

The port reads both slots with one function and keeps the second when its
identifier is a plausible name (printable, non-empty, ≤ 20 chars) *and* its
position is not all-zero — a cheap discriminator against genuinely unused
slots:
[`engine/src/df/set.ts:382-433`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/set.ts#L382-L433).

**Reason**

These stars are real, script-referenced placement markers, so skipping them is
silent data loss: `walkonpath sasha.1 → sasha.2` and `sashaidle`'s
`sasha.2` ↔ `sasha.3` toggle both name targets that a 41-byte skip throws away.

Across all 474 `.SET` files of both discs, 2,609 actor records carry
**2,666** stars, so the 41-byte skip drops **57** of them.

Found by running the game: Sasha never walked down the hall in `HALLA`, because
the script asked for a star the set reader had not produced; the missing name
sits in a well-formed record inside the skipped bytes. An extractor only
*lists* actors, so a missing one just looks like a set with fewer actors.

**Fix**

Since both slots have the same layout, read them with one function and advance
by the record size rather than by hand-summed skips:

```cpp
struct Actor {
    int32_t unknownInt;
    int16_t rotation8;
    int16_t positionX, positionZ, positionY;
    std::string identifier;
};

// {i16 rotation8, i16 X, i16 Z, i16 Y, pascal id} — the primary at record +4,
// the optional secondary star at record +30
static Actor readActorAt(const uint8_t* at) {
    Actor a{};
    a.rotation8 = *(int16_t*)(at);
    a.positionX = *(int16_t*)(at + 2);
    a.positionZ = *(int16_t*)(at + 4);
    a.positionY = *(int16_t*)(at + 6);
    a.identifier.assign((const char*)(at + 9), *(at + 8));
    return a;
}

// tells a real nested star from an unused slot
static bool isStar(const Actor& a) {
    if (a.identifier.empty() || a.identifier.size() > 20) return false;
    for (unsigned char c : a.identifier)
        if (!isalnum(c) && c != '.' && c != '_' && c != '-') return false;
    return a.positionX || a.positionZ || a.positionY;
}
```

```cpp
constexpr int32_t ACTORRECORD{ 54 };
constexpr int32_t PRIMARYAT{ 4 };
constexpr int32_t SECONDARYAT{ 30 };

for (int32_t act = 0; act < actorsCount; act++) {
    const uint8_t* const record = container;

    Actor primary = readActorAt(record + PRIMARYAT);
    primary.unknownInt = *(int32_t*)record;
    actors.push_back(primary);

    // the tail is not scratch memory: it can hold a second star
    Actor secondary = readActorAt(record + SECONDARYAT);
    if (isStar(secondary)) actors.push_back(secondary);

    container = record + ACTORRECORD;
}
```

Note this makes `actors.size()` differ from `actorsCount` — the count is the
number of *records*, not of stars. Anything iterating actors should use the
vector's size.

---

## 3. The loop play-order table is read with an unclamped count

**Description**

`AudioBlockInfos` (`libs/DFfile/DFfile.h:282-290`) reads the play-order list
using the count stored in the file, then advances by a **fixed 260 bytes**:

```cpp
totalLoopsChunks = *(int16_t*)container;
container += 2;

chunkOrder = new int16_t[totalLoopsChunks];
memcpy(chunkOrder, container, totalLoopsChunks * sizeof(int16_t));

container += 260; // <- not sure what is within this range
```

The 260 is not unknown — it is the field's fixed width: **130 `int16_t` slots**.
The `memcpy` should be bounded by that, and is not. A stored count above 130
reads past the play-order field into the chunk records that follow (up to
~64 KB past, for a count near `INT16_MAX`), and fills the playlist with
whatever those bytes happen to be. A *negative* count is worse: `new
int16_t[negative]` throws `std::bad_array_new_length`.

DFET already knows about the cap elsewhere — `writeAllAudioC`
(`DFfile.cpp:520-545`) reasons about a "(capped) playlist" and about the
disk-streaming case where records outnumber it. The two sites disagree.

The port clamps the read to the field and treats the stored count as advisory:
[`engine/src/df/banks.ts:27-58`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/banks.ts#L27-L58).

**Reason**

A heap over-read whose result is then used as playback order, so a malformed or
merely unusual bank yields a garbage playlist instead of a diagnosable error —
and the over-read is silent, because the bytes it lands in are valid heap.

Latent, measured: the largest stored count in the shipped corpus is **46** across
558 `.TRK`/`.SFX`/`.11K` banks and **53** across the 26 `.MOV` soundtrack loop
tables — comfortably inside the 130 slots, and never negative. The cap is the
field's, not the corpus's, so nothing here is close to the edge until a file is
damaged.

Found by reading, while pinning the field width for the track editor's write
path: the unclamped `memcpy` and the fixed 260-byte skip sit in the same three
lines.

**Fix**

Name the slot count, clamp to it, and derive the skip from it so the two cannot
drift apart:

```cpp
// the play-order field is a fixed 260 bytes: 130 int16_t slots
static constexpr int16_t LOOPORDERSLOTS{ 130 };

totalLoopsChunks = *(int16_t*)container;
container += 2;

const int16_t orderCount = (totalLoopsChunks < 0)
    ? 0
    : std::min<int16_t>(totalLoopsChunks, LOOPORDERSLOTS);

chunkOrder = new int16_t[LOOPORDERSLOTS]{};
memcpy(chunkOrder, container, orderCount * sizeof(int16_t));
// downstream (writeAllAudioC) must not see the unclamped value
totalLoopsChunks = orderCount;

container += LOOPORDERSLOTS * sizeof(int16_t);   // the former magic 260
```

Allocating the full `LOOPORDERSLOTS` rather than `orderCount` keeps the array a
fixed size, so a later stray index cannot run off a short allocation.

With `totalLoopsChunks` clamped at the source, `writeAllAudioC`'s existing
`diskStream` test (`audioLoopChunkCount > totalLoopsChunks`) starts agreeing
with the field width instead of contradicting it.

---

## 4. `strSize` is written into a fixed 31-byte identifier without bounds

**Description**

Both chunk-table loops NUL-terminate the identifier at an index taken straight
from the file:

```cpp
// libs/DFfile/DFfile.h:308-310 (loop chunks)
audioLoopChunks[i].strSize = *(uint8_t*)container++;
memcpy(&audioLoopChunks[i].identifier, container, 16);
audioLoopChunks[i].identifier[audioLoopChunks[i].strSize] = '\0';

// libs/DFfile/DFfile.h:336-337 (one-shot chunks)
memcpy(&audioSingleChunks[i].identifier, container, (16 * multiplyer) - 1);
audioSingleChunks[i].identifier[audioSingleChunks[i].strSize] = '\0';
```

`identifier` is `char[31]` (`DFfile.h:235`) and `strSize` is a `uint8_t`, so any
stored length byte of 31–255 writes the NUL **outside the array**, into the
adjacent `AudioChunks` element or past the end of the `new[]` block.

The loop variant has a second, smaller problem: its stored character field is
**15** bytes, not 16. The record is 26 — `i32`, `i16`+pad, `i16`, then the length
byte and 15 characters — which is what DFET's own `container += 15` after the
copy (`DFfile.h:312`) adds up to. So the 16-byte `memcpy` reads one byte past the
field, pulling the next record's `unknownInt` into the tail of the name buffer.
Harmless in effect, since `strSize` truncates it away, but the number is wrong and
it is the number a caller would use to tell a user how long a name may be. The
one-shot copy is fine on that count: `(16 * multiplyer) - 1` **is** the field, 15
for a TRK bank and 31 for a MOV soundtrack — and at 31 it fills `char[31]`
exactly, leaving no room for a terminator, so `strSize == 31` is a one-byte
overflow on input that is well-formed by the field's own width.

The port reads Pascal strings with the field width as an explicit parameter, so
the length byte cannot make a *write* leave the field (and in JavaScript a long
one truncates at the buffer instead of over-reading):
[`engine/src/df/binary.ts:58-64`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/binary.ts#L58-L64).

**Reason**

Out-of-bounds write driven by file content — the classic shape of a parser
vulnerability, and reachable from any bank whose length byte is corrupt or
whose name is longer than the reader assumes.

Latent, measured: across 2,684 loop-chunk records the largest stored length is
**15** — the field exactly, which 110 records use in full — and across 480 MOV
one-shot records it is also **15**, so no shipped name reaches the 31 that would
overflow. The defect needs a damaged file, but a 15-character name is ordinary,
which is what makes the field width worth stating correctly.

Found by reading, while establishing the identifier field widths the track
editor needs in order to tell the user how many characters a rename may use.

**Fix**

Widen the field by one so the largest on-disk name still has room for its
terminator, then clamp the length to what was actually copied:

```cpp
struct AudioChunks {
    int32_t chunkBlockID;
    int32_t unknownInt;
    bool unknownBool;
    uint8_t strSize;
    char identifier[32];   // was 31: MOV soundtracks store 31 chars
};
```

```cpp
// one helper for both loops; `stored` is the on-disk field width
// (15 for loop chunks, (16 * multiplyer) - 1 for one-shots)
static void readChunkId(AudioChunks& chunk, const uint8_t* from, size_t stored) {
    static_assert(sizeof(AudioChunks::identifier) >= 32, "id field too small");
    if (stored > sizeof(chunk.identifier) - 1) stored = sizeof(chunk.identifier) - 1;
    memcpy(chunk.identifier, from, stored);
    if (chunk.strSize > stored) chunk.strSize = static_cast<uint8_t>(stored);
    chunk.identifier[chunk.strSize] = '\0';
}
```

```cpp
audioLoopChunks[i].strSize = *(uint8_t*)container++;
readChunkId(audioLoopChunks[i], container, 15);   // the field, not the old 16
container += 15;
```

```cpp
audioSingleChunks[i].strSize = *(uint8_t*)container++;
readChunkId(audioSingleChunks[i], container, (16 * multiplyer) - 1);
container += (16 * multiplyer) - 1;
```

Clamping `strSize` itself (rather than only the write index) matters because
the field is used later as the string's length — leaving it unclamped would
just move the over-read to whoever reads the name.

---

## 5. White pixels become opaque black in the transparent codec

**Description**

`DFfile::writeTransPNGimage` special-cases palette entries that are pure white,
in both the literal and the run-length branch (`DFfile.cpp:338-354` and
`369-383`):

```cpp
static int16_t check[3]{ 0xFFFF,0xFFFF,0xFFFF };
if (!memcmp(colors[*currIn].RGB, check, 6)) {
    *currOut++ = 0;
    *currOut++ = 0;
    *currOut++ = 0;
}
else {
    *currOut++ = *(((uint8_t*)&colors[*currIn].RGB[0]) + 1);
    *currOut++ = *(((uint8_t*)&colors[*currIn].RGB[1]) + 1);
    *currOut++ = *(((uint8_t*)&colors[*currIn].RGB[2]) + 1);
}

// transparency value
*currOut++ = 0xFF;
```

The alpha store sits **outside** the `if`/`else`, so the white branch emits
RGBA `(0, 0, 0, 255)` — opaque black. If the intent was to key white out as
transparent, the alpha write needs to be inside the branches; as written, the
special case only replaces one colour with another.

It is also unnecessary. Transparency in this codec is explicit: the
`bitFlag & 1`-set / `bitFlag & 2`-clear run *is* the transparent run
(`DFfile.cpp:356-361`), so white carries no special meaning and does not need
keying out.

The port sidesteps it entirely by keeping the frame palette-independent —
`decodeShpFrame` returns indexed pixels plus an explicit `opaque` mask, and
colourisation happens later against the active SET's palette (props are tinted
by whichever room they appear in):
[`engine/src/df/shp.ts:324-372`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/shp.ts#L324-L372).

**Reason**

It corrupts legitimate art. Any prop with genuinely white pixels — paper, the
watch face, highlights on metal — extracts with those pixels black, and there is
no way to recover them from the PNG afterwards. The transformation is silent
and lossy.

Found by construction: separating decode from colourisation (required, since
the engine composites props through a shared CLUT the scripts can change with
`clut`/`mixclut`) leaves no place for a palette-dependent special case.

**Fix**

Simplest: drop the special case in both branches and write the palette colour
unconditionally.

```cpp
const ColorPalette& c = colors[*currIn];   // re-taken per pixel in the literal branch
*currOut++ = *(((uint8_t*)&c.RGB[0]) + 1);
*currOut++ = *(((uint8_t*)&c.RGB[1]) + 1);
*currOut++ = *(((uint8_t*)&c.RGB[2]) + 1);
*currOut++ = 0xFF;
```

If white-keying is wanted after all — for art whose transparent runs were
authored as white rather than as transparent runs — the alpha has to move
inside the branch, and then the colour under it should stay put so a viewer
that ignores alpha still shows something sensible:

```cpp
static const int16_t white[3]{ (int16_t)0xFFFF, (int16_t)0xFFFF, (int16_t)0xFFFF };
const bool keyed = !memcmp(c.RGB, white, sizeof(white));
*currOut++ = *(((uint8_t*)&c.RGB[0]) + 1);
*currOut++ = *(((uint8_t*)&c.RGB[1]) + 1);
*currOut++ = *(((uint8_t*)&c.RGB[2]) + 1);
*currOut++ = keyed ? 0x00 : 0xFF;
```

Worth making that a command-line flag rather than the default, since on TAOOT's
own art it removes pixels the game draws.

---

## 6. `audioDecoder_v40` mode II can write past the output buffer

**Description**

Mode II writes **two** samples per input byte and repeats `(byteCount & 0x3f) + 1`
times, but the bound is only tested at the top of the outer loop
(`DFfile.cpp:692-722`):

```cpp
while (currOutput < (decodedOutput + uncomprBlockSize)) {
    ...
    uint8_t byteCount = nextByte & 0x3f;
    do {
        ...
        *currOutput++ = step + 0x40;
        *currOutput++ = index + 0x40;
        ...
    } while (byteCount--);
```

A mode II run entered with one byte of room remaining writes up to 128, i.e.
**127 bytes past** the declared size. The buffer carries three bytes of slack
(`DFfile.cpp:477`, `containerDataBuffer.resize(fileSize + header.headerSize + 3)`,
with the "extra bytes decoder overflow" comment on the commented-out line
below it), which covers the common straddle-the-end case by one byte but not the
worst case.

The trailing check then rejects the chunk outright:

```cpp
if (currOutput != (decodedOutput + uncomprBlockSize)) return false;
```

so a stream that legitimately ends mid-pair fails to decode rather than being
truncated to the declared length.

The port decodes into a buffer with pair slack and trims to the declared size:
[`engine/src/df/audio.ts:105-142`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/audio.ts#L105-L142).

**Reason**

Heap overflow bounded by attacker-influenced file content, and an
overly strict exit condition that turns a recoverable end-of-stream into
`ERRDECODEAUDIO` for the whole chunk. Found by reading; no shipped TAOOT bank
is known to trigger the large overshoot, so the overflow is latent rather than
observed.

**Fix**

Hoist the end pointer, then bound the two modes that write more than one byte:

```cpp
int8_t* const outEnd = decodedOutput + uncomprBlockSize;
```

```cpp
// MODE II: find and write difference with step tables
uint8_t byteCount = nextByte & 0x3f;
do {
    if (currOutput >= outEnd) break;
    nextByte = *soundContainer++;
    int8_t step  = prevByte + StepSizeTable[(uint8_t)nextByte];
    int8_t index = step + IndexTable[(uint8_t)nextByte];

    *currOutput++ = step + 0x40;
    if (currOutput < outEnd) *currOutput++ = index + 0x40;

    prevByte = index;
} while (byteCount--);
```

```cpp
// MODE III: copy x amount from previous byte
uint8_t byteCount = (nextByte & 0x3f) + 1;
if (currOutput + byteCount > outEnd)
    byteCount = static_cast<uint8_t>(outEnd - currOutput);
memset(currOutput, prevByte + 0x40, byteCount);
currOutput += byteCount;
```

Mode I is already safe — the outer `while` guarantees room for its single byte.

With the clamps in place `currOutput` can never pass `outEnd`, so the trailing
equality check becomes a genuine underflow test (the stream ran out early) and
can stay as it is. The `+ 3` slack on the buffer is then no longer load-bearing
and can go, though leaving it costs nothing.

---

## 7. `getRawImageData` computes a bounds limit and never uses it

**Description**

`DFfile.cpp:773` establishes the end of the output buffer:

```cpp
uint8_t* const buffer_end = rawPixelOutput + totalSize;
```

`buffer_end` is then never read. Every write in the row loop and every run mode
below it is unchecked, as is `currIN` against `container.size`. Note the
contrast with the Z-layer pass immediately after, which *does* bounds-check
(`DFfile.cpp:966-969`) — the intent was clearly there for the colour pass too.

**Reason**

A truncated or malformed frame container writes outside the allocation. Because
`width`/`height` come from the container's own first four bytes and the run
counts come from its body, nothing ties the decode to the buffer that was sized
for it. Found by reading; the unused variable suggests the check was intended.

**Fix**

Give the already-declared `buffer_end` a partner for the input side, and check
both once per run — the run loop is the single choke point every mode passes
through, so one guard there covers the switch:

```cpp
const uint8_t* const input_end = (const uint8_t*)container.data + container.size;
```

```cpp
while (currWith < width) {

    if (currIN >= input_end) { status = ERRCONVIMAGE; return false; }

    uint8_t modeSel = *currIN & 7;
    uint16_t count = *currIN >> 3;
    currIN++;
    if (!count) {
        if (currIN >= input_end) { status = ERRCONVIMAGE; return false; }
        count += 32 + *currIN++;
    }

    // no mode may write past the row, the buffer, or read past the input
    if (currOUT + count > buffer_end || currWith + count > width) {
        status = ERRCONVIMAGE;
        return false;
    }

    switch (modeSel) {
    ...
```

Modes 5 and 7 consume input proportional to `count`, so they want the same
treatment inline (`currIN + count > input_end`, and `currIN + 2 > input_end`
before reading mode 7's offset). Mode 7's back-distance also deserves a check
that it does not reach before the start of the frame:

```cpp
case 7: {
    if (currIN + 2 > input_end) { status = ERRCONVIMAGE; return false; }
    const uint16_t back = *(uint16_t*)currIN;
    if (back > (uint32_t)(currOUT - rawPixelOutput)) { status = ERRCONVIMAGE; return false; }
    copyRun(currOUT, currOUT - back, count);
    currIN += 2;
    break;
}
```

The row-mode block above the loop needs the same `currOUT + width > buffer_end`
guard, since a container whose stored `height` disagrees with its run data can
overrun there before any run executes.

---

## 8. The script decoder walks off the end of its container

**Description**

`DFscript::binaryScriptToText` (`libs/DFfile/DFscript.cpp:7`) is bounded only by
finding a zero command word:

```cpp
while (seg.cmd = *(uint16_t*)curr) {
```

The container length is never passed in, so a script whose terminator is
missing or truncated reads until it happens across a zero. Two related points
in the same function:

- `ScriptCommands.at(seg.cmd)` (`DFscript.cpp:60`) throws `std::out_of_range` on
  an unrecognised opcode. Nothing catches it, so an unknown command word
  terminates the process rather than reporting a bad script.
- `script.append((char*)(curr + seg.info + 1), 0, *(curr + seg.info));`
  (`DFscript.cpp:18-20`) selects the `(const string&, pos, n)` overload, which
  constructs a temporary `std::string` from the pointer — that is a `strlen`
  over a Pascal string that is **not** NUL-terminated, scanning to whatever zero
  byte comes next, possibly outside the container.

The port bounds the segment stream, reads Pascal strings by their length byte,
and turns an unknown opcode into a catchable error — which lets the same
function double as a sniff test for "is this container a script?":
[`engine/src/df/script.ts:36-78`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/script.ts#L36-L78).

**Reason**

Out-of-bounds reads on malformed input plus an uncaught exception on the
unknown-opcode path. Found through the sniffing use: the port probes arbitrary
containers to find which hold scripts, so "unknown opcode" has to be an ordinary
answer rather than a crash.

**Fix**

Take the container size as a parameter, walk by offset instead of by pointer,
and read Pascal strings by their length byte:

```cpp
const std::string DFscript::binaryScriptToText(const uint8_t* curr, uint32_t size, bool* ok) {
    std::string script;
    if (ok) *ok = true;

    for (uint32_t pos = 0; pos + 8 <= size; pos += 8) {
        seg.cmd = *(uint16_t*)(curr + pos);
        if (!seg.cmd) return script;              // normal terminator
        seg.info = *(uint32_t*)(curr + pos + 2);
        seg.unknown = *(uint16_t*)(curr + pos + 6);
        ...

        switch (seg.cmd) {
        case STRING:
        case VARIABLE: {
            const uint64_t at = (uint64_t)pos + seg.info;    // seg.info is u32: widen
            if (at >= size) { if (ok) *ok = false; return script; }
            const uint8_t len = curr[at];
            if (at + 1 + len > size) { if (ok) *ok = false; return script; }
            if (seg.cmd == STRING) script.push_back('"');
            script.append((const char*)(curr + at + 1), len);
            script.append(seg.cmd == STRING ? "\" " : " ");
            break;
        }
        ...
        default: {
            const auto it = ScriptCommands.find(seg.cmd);
            if (it == ScriptCommands.end()) {     // not a script, or a new opcode
                if (ok) *ok = false;
                return script;
            }
            ... // the existing spacing rules, then:
            script.append(it->second);
            script.push_back(' ');
            break;
        }
        }
    }

    if (ok) *ok = false;                          // ran out before a terminator
    return script;
}
```

Three things worth keeping from that sketch: `seg.info` is a `uint32_t`, so
`pos + seg.info` has to be widened before the bounds test or a large `info`
wraps straight past it; `find` replaces `.at` so an unknown opcode is data, not
an exception; and the `ok` out-parameter is what lets a caller use this function
to *ask* whether a container holds a script, which is much cheaper than
guessing from the container's position in the file.

---

## 9. Gap containers are 4-byte dummies that downstream readers over-read

**Description**

For header types 1 and 2, missing containers are filled with a 4-byte marker
(`DFfile.cpp:34-38`, `63-67`):

```cpp
constexpr int32_t dummySize{ 4 };
char dummy[dummySize]{ 'T', 'P', '0' + fileHeader.type, '\0' };
containers[container].size = dummySize;
```

Format readers that peek a header field of a container they were pointed at —
a version `int32_t`, a count, a location — read past the end of a 4-byte
allocation whenever the reference happens to land on a gap. Found by reading,
while porting the container reader.

The port stores 8 zero bytes instead, sized so the common header peeks stay in
bounds and read as zero:
[`engine/src/df/container.ts:47-49`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/container.ts#L47-L49).

**Reason**

Cheap defence against a whole class of over-reads, at the cost of four bytes per
gap. The ASCII marker is useful when eyeballing a dump, but it makes gaps look
like data to code that only checks a pointer, not a size.

**Fix**

Keep the marker where it belongs — in the human-readable `info` string — and
make the payload harmless. Both the type 1 and type 2 branches:

```cpp
// gap containers are placeholders: zero bytes, sized so a downstream header
// peek (an i32 version, a count, a location) stays in bounds and reads 0
constexpr int32_t dummySize{ 8 };
containers[container].size = dummySize;
containers[container].data = new uint8_t[dummySize]{};
containers[container].info.assign("NOP (gap container)");
```

The type 0 branch (`DFfile.cpp:98-102`) already does exactly this — 8 zeroed
bytes — so this is really about bringing types 1 and 2 in line with it.

Adding an `isGap` flag to `Container` would be better still: it lets readers
test for a gap explicitly instead of inferring one from a suspicious size, and
it is what a writer needs in order to round-trip the file (a gap must be
re-emitted as a gap, not as an 8-byte record).

The port carries such a flag and its writer round-trips gaps through it
([`engine/src/df/container.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/container.ts):
`Container.gap`, honoured by `writeContainerFile` and by `patchContainerData`,
which refuses to edit a gap). Once a tool saves files back, "a gap looks like a
container with data in it" is no longer cosmetic.

---

## 10. Unsequenced pointer use when reading the actor identifier

**Description**

`libs/DFfile/DFset/DFset.h:261`:

```cpp
actors.at(act).identifier.assign((char*)container, *container++);
```

`container` is both read and incremented in the same full expression. Since
C++17 the two arguments are *indeterminately sequenced* rather than undefined,
but which of them is evaluated first is still **unspecified** — so whether the
string starts at the length byte or one past it is compiler- and
version-dependent. Before C++17 this is plain undefined behaviour.

**Reason**

The identifier is read one byte off, or not, depending on the toolchain — the
kind of defect that works on the maintainer's compiler and silently mangles
every actor name on someone else's. Found by reading the record layout closely
enough to recover the tail in §2.

Same shape, worth a grep: `DFfile.h:308` and `DFfile.h:335` also post-increment
a pointer that is used elsewhere in the statement, though those happen to be
sequenced by the assignment. `DFset.h:430` is the same construct as the actor
line above, reading an object's identifier — so the hotspot names in §15 are
exposed to it too.

**Two more, where the order changes the result.** `DFpup::readPuppetStrings`
(`libs/DFfile/DFpup.cpp:203,205`) reads both Pascal strings in a dialogue record
this way:

```cpp
pupData[i].text.assign((char*)(++curr), *curr);
curr += 255;
pupData[i].ident.assign((char*)(++curr), *curr);
curr += 31;
```

Here the two arguments disagree about *which byte* `*curr` is. Evaluate it before
the increment and it is the length byte, which is what was meant; evaluate it after
and it is the string's **first character**, so a subtitle beginning with `"I"` is
read as 73 characters long. Both readings are permitted, so the same build reads
puppet subtitles correctly on one compiler and truncates or over-reads them on
another — and every `.PUP` in the game goes through this loop. The port's reader
takes the field width as a parameter and the length byte as a separate read
([`engine/src/df/pup.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/pup.ts)).

**Fix**

Split the statement so the order is explicit:

```cpp
const uint8_t nameLen = *container++;
actors.at(act).identifier.assign((const char*)container, nameLen);
```

The §2 rewrite removes this line entirely — `readActorAt` indexes from a fixed
base rather than walking a cursor — so fixing §2 fixes this as a side effect.
It is listed separately because the pattern is worth grepping for across the
codebase, and because `-Wunsequenced` (clang) / `-Wsequence-point` (gcc) will
find the rest for free if you want to turn it on.

---

## 11. `writeAllScripts` copies a file-controlled length into a 31-byte stack buffer

**Description**

`DFpup::writeAllScripts` (`libs/DFfile/DFpup.cpp:24-51`) reads the puppet's
script table into a local record whose name field is fixed at 31 bytes:

```cpp
struct PupScripts {
    int32_t location;
    char scriptName[31];
};
...
uint8_t strSize = *curr++;
memcpy(ps.scriptName, curr, strSize);
ps.scriptName[strSize] = '\0';
curr += 31;
```

`strSize` comes straight from the file and is never compared with anything, and it
sizes the **copy**, not just the terminator's index. A length byte above 31 makes
the `memcpy` itself run past the end of a **stack** array — by up to 224 bytes at
255 — and the write is file content, byte for byte.

The stored field is a length byte followed by **31** character bytes (the record is
40: `i32` location, `i32`, then the 32-byte name field; the reader's own
`curr += 31` after the copy says the same). So `strSize == 31` is well-formed input
and already a one-byte overflow, because the array has no room for the terminator —
the same off-by-one §4 has for MOV soundtracks, on top of the unbounded copy.

This is §4's defect one step worse: there the out-of-bounds write is a single NUL,
here it is the copy itself. The port reads every Pascal string with the field width
as an explicit parameter, so the stored length can never address outside the field
([`engine/src/df/binary.ts:58-64`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/binary.ts#L58-L64),
used by [`engine/src/df/pup.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/pup.ts)).

**Reason**

Stack buffer overflow driven entirely by one byte of file content — the shape that
turns a file viewer into an exploit primitive, and reachable from "extract scripts"
on any `.PUP` a user was handed. Found by reading, while establishing the record
layout for the stance field in §12.

Latent, measured: 681 script-table records across the 316 shipped `.PUP` files,
longest stored name **11** characters ("Boot Script"), well inside the field.

**Fix**

Clamp to what the field can hold, and give the array room for its terminator:

```cpp
struct PupScripts {
    int32_t location;
    char scriptName[32];   // 31 stored bytes + terminator
};
```

```cpp
uint8_t strSize = *curr++;
if (strSize > sizeof(ps.scriptName) - 1) strSize = sizeof(ps.scriptName) - 1;
memcpy(ps.scriptName, curr, strSize);
ps.scriptName[strSize] = '\0';
curr += 31;
```

The same shape is worth grepping for in the other per-format readers: the rule that
holds everywhere is that a stored length may index a field, never size a copy.

---

## 12. A stance's layer table: the frame count is unclamped, and half the table is not frame locations

**Description**

`DFpup::writeAllFrames` (`libs/DFfile/DFpup.cpp:53-166`) reads each of a stance's
11 layer tables as

```cpp
struct FrameRegister {
    int16_t count;
    int16_t unknown;
    int16_t totalEntries; // maybe??
    int32_t locations[64];
};
...
memcpy(frameLocations[subTable].locations, curr, 64 * 4);
curr += 256;
...
while (frameLocations[subTable].count--) {
    writeTransPNGimage(tableName, frameLocations[subTable].locations[frameLocations[subTable].count]);
```

The 262-byte stride is right, and the shipped files come out correct. Two things
inside it are not.

**The count is used as an index without a bound.** It is an `int16_t` read from the
file and `while (count--)` is a signed test, so a **negative** count enters the
loop and indexes `locations[-2]`, `locations[-3]`, … walking ever further below the
array for as many iterations as it takes the counter to reach zero; a count of 65
or more indexes past the end of it; and every value either produces is
handed to `writeTransPNGimage`, which does `containers[containerID].data` with no
range check of its own (`DFfile.cpp:296-298`) and then runs its decompression loop
over whatever that points at. Same shape as §3, in a file §3 doesn't touch.

**And only the first 32 dwords are frame locations.** The rest is the engine's own
scratch, as read from `TI.EXE`: the stance loader **errors** (`0x1077` at
`0x441066`) on a count above 32, because the table holds exactly that many
locations before the runtime slots begin, and it **zeroes** the second 32 dwords on
load (`0x441082`) as its handle cache. A count in 33…64 would read handle-cache
slots as container ids, which is the case the clamp below closes.

Measured: 13,816 layer tables across the 316 shipped `.PUP` files, largest stored
count **27**, none negative and none above 32. Both halves of this entry are
latent, but the count is one byte of a file away from indexing a handle-cache
slot, and a negative one walks backwards out of the struct until the `int16_t`
reaches zero.

The two i16s DFET calls `unknown` and `totalEntries` are the layer's **home
anchor** — Y then X, the same order and meaning as the per-tick anchors in the
animation-logic records. That is what says which *face* a layer slot belongs to,
which matters because a two-character close-up re-uses the same eleven slots per
stance: in `WILZEIT1.PUP` stances 0/1 park the moving `jaw` on the left face
(anchor x=171) and stance 2 swaps it to the right one (x=388). The port's reader
and its write-up of the structure are
[`engine/src/df/pup.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/pup.ts)
and
[`docs/engine/formats/pup-cst.md`](https://github.com/dhobi/dreamrefactory/blob/master/docs/engine/formats/pup-cst.md#stances-and-animation-logic-the-face-as-11-layers);
the same read is why `pupData`'s leading `int32_t unknownInt1` is really the
**stance** the line is animated against (an i16 at record+0, `TI.EXE` `0x440fb0`),
followed at +6 by the line's animation-logic tick count. Both are extraction-neutral
for DFET; the stance is what selects the right mouth animation.

**Reason**

The clamp is the part that matters: a corrupt or hostile `.PUP` turns "export
frames" into an out-of-bounds read with a file-controlled index. The naming half is
offered rather than reported; it answers the `maybe??` in DFET's own comment.
Found by reading, while recovering from `TI.EXE` which stance a dialogue line
animates against.

**Fix**

One constant, one clamp, and the fields named for what they hold. Both branches
(DUST at `:90-113` and TAOOT at `:135-158`) read the same structure:

```cpp
// TI.EXE errors above this: the table holds 32 frame locations and then 32
// dwords the engine zeroes as its own handle cache.
constexpr int16_t maxLayerFrames{ 32 };

struct FrameRegister {
    int16_t count;
    int16_t anchorY;                    // where the layer sits when nothing moves it
    int16_t anchorX;
    int32_t locations[maxLayerFrames];
    int32_t engineHandles[maxLayerFrames];  // runtime scratch, zeroed on load
};
```

```cpp
frameLocations[subTable].count = *(int16_t*)curr;
curr += 2;
frameLocations[subTable].anchorY = *(int16_t*)curr;
curr += 2;
frameLocations[subTable].anchorX = *(int16_t*)curr;
curr += 2;

if (frameLocations[subTable].count < 0)
    frameLocations[subTable].count = 0;
if (frameLocations[subTable].count > maxLayerFrames)
    frameLocations[subTable].count = maxLayerFrames;

memcpy(frameLocations[subTable].locations, curr, sizeof(FrameRegister::locations));
curr += 256;   // the stored table is still 64 dwords wide
```

A bounds check in `writeTransPNGimage` would be worth having either way — it is
reached from every format reader with a location straight out of a file.

---

## 13. The Z-layer row-offset base is `height * 2` bytes too far in

**Description**

The wrong base is DFET's, as the coverage check under **Reason** shows.

DFET treats each scanline offset as relative to the **end** of the row-offset
table (`DFfile.cpp:951-959`):

```cpp
const uint16_t* depthInfoPos = (const uint16_t*)currIN;
const uint8_t* data_block_start = currIN + (height * sizeof(uint16_t));
...
const uint8_t* scanline_ptr = data_block_start + scanline_offset;
```

The port treats them as relative to the **start** of the table, i.e. without the
`height * 2` skip:
[`engine/src/df/image.ts:362-379`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/image.ts#L362-L379).
The two differ by exactly `height * 2` bytes (528 for a 264-row view).

**Reason**

The format checks itself: each row's runs must cover exactly `width` pixels, so a
wrong base desynchronises the runs and the coverage sum stops landing on `width`.
Run over **1836** Z layers — every Z-carrying view frame of nine sets across two
language trees (`DECKA`, `TURK`, `BING`, `HALLC`, `cargo`, `gstair2`, `stair2c`,
`gym`, `vestport`):

```
table-relative (ours):   1784 fit uniquely, 52 fit under either base, 0 fail
data-relative  (DFET's):    0 fit uniquely,  0 fit only this way,  1784 fail
```

No frame is explained by the `height * 2` skip; the 52 ambiguous ones are
degenerate rows that parse either way. Independently, `offsets[0]` equals
`height * 2` on **all 1836** frames (528 for a 264-row view): the runs start right
after the table, the signature of a table-relative offset. A data-relative
`offsets[0]` would be 0.

So each scanline is read `height * 2` bytes late and every row's segment count is
whatever run byte happens to sit there. Simulating DFET's own loop over the same
1836 frames says what that comes to in practice:

```
1754  the scanline pointer walks past the end of the container    (undetected)
  30  the corruption guard fires and the Z image is dropped       (DFfile.cpp:966-969)
  52  completes with correct output — the ambiguous frames above
```

The guard catches 30 of 1836, because it tests the **output** side only: it asks
whether a run would overflow the depth buffer, never whether `scanline_ptr` is
still inside the container it came from. On 95% of frames the read leaves the
container first and the loop carries on over whatever heap follows — §7's missing
input bound, reached through this entry rather than through the colour pass.

A Z image is rarely inspected by eye, and the failure looks like "no depth
output" rather than a crash. At runtime the port's reading also places actors
behind the right furniture; the port's round-trip test cannot distinguish the
two conventions (it encodes the layer the way the decoder reads it), so the
coverage sum is the decisive evidence.

**Fix**

The coverage check is worth keeping either way. Each row's runs must cover
exactly `width` pixels, so summing the run lengths under a base is a decisive test
needing no external reference:

```cpp
// returns true if `base` yields rows whose runs sum to exactly width
static bool zBaseFits(const uint8_t* table, const uint8_t* base,
                      int16_t width, int16_t height) {
    const uint16_t* offsets = (const uint16_t*)table;
    for (int32_t row = 0; row < height; row++) {
        const uint8_t* p = base + offsets[row];
        uint32_t covered = 0;
        for (uint8_t seg = *p++; seg; seg--) {
            covered += *p;      // valCount
            p += 2;             // valCount, val
        }
        if (covered != (uint32_t)width) return false;
    }
    return true;
}
```

Reproduce the result on any SET view frame that carries a Z layer:

```cpp
const bool tableRelative = zBaseFits(currIN, currIN, width, height);          // true
const bool dataRelative  = zBaseFits(currIN, currIN + height * 2, width, height);  // false
```

Then the change itself is one line — drop the skip and read the offsets against
the table:

```cpp
const uint16_t* depthInfoPos = (const uint16_t*)currIN;
const uint8_t* const data_block_start = currIN;   // offsets are table-relative
```

Keep `zBaseFits` afterwards, as a debug assertion or as the trigger for the
existing corruption guard — which currently fires only once a run has already
tried to write past the end of the buffer, i.e. after the damage rather than
before it.

Corrections to this measurement are welcome: it is the one entry where the change
rests on indirect evidence, and the numbers above are reproducible from any
Z-carrying frame in the shipped data.

---

## 14. A container index out of a file is indexed without a range check (and one is off by one)

**Description**

`containers` is a `std::vector<Container>` (`DFfile.h:73`), and several readers
index it with a number that came straight out of the file. Four places — three an
unchecked index, one an unchecked size — in increasing order of how easy they are
to fix:

The stance register's guard is **off by one** (`DFpup.cpp:122-134`):

```cpp
if (tableLocations[table] > fileHeader.containerCount || tableLocations[table] == 0)
    break;
...
uint8_t* curr = containers[tableLocations[table]].data + 22;
```

`containerCount` is the container *count*, so the last valid index is
`containerCount - 1`. A stored location of exactly `containerCount` passes the
`>` test and is then used to index one element past the end of the vector — a
stored `uint32_t` deciding where a `Container` is read from. `>=` is the whole
fix.

The same function reads the register itself unbounded (`DFpup.cpp:119-120`):

```cpp
uint32_t tableLocations[64];
memcpy(tableLocations, containers[3].data + 22, 64 * 4);
```

That is 278 bytes required of container 3 and none checked — and §9 is what makes
it reachable, because a gap container's `data` is a 4-byte `new uint8_t[4]`, so a
`.PUP` whose header puts a gap at index 3 over-reads a 4-byte heap block by 274
bytes.

`DFset.h:433` uses an object's script location as an index the moment it is read:

```cpp
objTable->objectEntries[obj].containerObjScript =
    setRef->containers[objTable->objectEntries.at(obj).locationScript];
```

And `writeTransPNGimage` (`DFfile.cpp:296-298`) does the same with the id it is
handed, which is how §12's unclamped frame count turns into a decode over
arbitrary memory rather than a bad-index error.

The port resolves every container reference through one accessor and treats an
out-of-range one as absent — a gap and a bad reference are the same answer to the
caller ([`engine/src/df/container.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/container.ts),
`Container.gap`; the stance loader's own bound is
[`engine/src/df/pup.ts:223`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/pup.ts#L223),
which is `>=`).

**Reason**

Out-of-bounds read with a file-controlled index, in four places, one of which is
an off-by-one that a correct-looking guard is meant to prevent.

The shipped corpus depends on the guard. Of the 11,320 stance-register slots read
before a zero terminator across the shipped `.PUP` files, **419** hold a location
past the end of their own file: the register is a fixed 64-slot array whose unused
tail holds junk rather than zeroes, so on most puppets the loop stops at this test
rather than at a terminator. None of the 419 is *exactly* `containerCount`, so the
off-by-one does not fire on shipped data, but it is one value away from firing in
a test the corpus exercises hundreds of times.

Found by reading: the stance-register guard sits four lines above §12's layer
table.

**Fix**

One accessor, used everywhere a location comes from a file:

```cpp
// a location out of a file is untrusted: absent and out-of-range are one answer
const Container* DFfile::containerAt(int64_t loc) const {
    if (loc <= 0 || loc >= (int64_t)containers.size()) return nullptr;
    return &containers[loc];
}
```

```cpp
const Container* stance = containerAt(tableLocations[table]);
if (!stance || stance->size < 22 + tableCount * 262) break;
uint8_t* curr = stance->data + 22;
```

```cpp
void DFfile::writeTransPNGimage(const std::string& writeTo, int32_t containerID) {
    const Container* c = containerAt(containerID);
    if (!c) { status = ERRCONVIMAGE; return; }
    uint8_t* currIn = (uint8_t*)c->data;
```

`containerAt` taking a signed 64-bit parameter is deliberate: the stance register
stores `uint32_t` and the object table `int32_t`, and both have to compare as
themselves rather than wrap into range.

---

## 15. `DFset`'s labels: the hotspot rectangle's axes, and two SET header fields

**Description**

Offered rather than reported (no DFET output changes): three places where the name
says one thing and the byte holds another.

**The hotspot rectangle is stored Y-first.** `ObjectEntries` names its four
region shorts X-first (`DFset.h:339-342`), reads them in that order
(`DFset.h:420-427`), and prints them that way (`DFset.h:452`, `"start region on
X: "`). The stored order is `(top, left, bottom, right)`. It never mattered for
extraction — the numbers round-trip whatever they are called — but the printed
label is wrong, and anyone who uses the coordinates to hit-test a click gets every
hotspot in the room mirrored about the diagonal. Found at runtime, as a
consistent bottom-left offset on every clickable object.

```cpp
int16_t startRegionY, startRegionX;   // stored (top, left, ...)
int16_t endRegionY, endRegionX;       // ... then (bottom, right)
```

**Two container-0 fields.** The `int16_t` at `0xa08` that `DFset` calls
`setDimensionsY_2` is the **Z far-clip depth**: `TI.EXE`'s SCDO depth
quantization (`0x4078ad`) reads it as the far bound of the depth range a frame's Z
layer is quantized against. Its partner, the **number of depth levels**, is an
`int16_t` at `0x9fa`, inside bytes `DFset` skips. Together they are what a Z level
*means* — `level = worldDepth × zLevelCount / zFarMax` — which is to say they are
the units of the layer §13 is about. Read from disassembly; the port's reading of
the SET header, resolved to absolute offsets, is
[`engine/src/df/set.ts:436-470`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/set.ts#L436-L470).

**Reason**

The axes have a consequence: a mislabelled field is a bug delivered to whoever
builds on `FileInfos.md`, and DFET's own info output states it. The two header
fields are like §12's naming half: names for two fields DFET left as dimensions.

**Fix**

Rename the four region members and the info string, and name the two header
fields:

```cpp
// stored (top, left, bottom, right) — Y before X, as everywhere in the format
out.append("\nstart region (top, left):  ")
   .append(std::to_string(e.startRegionY)).append(", ")
   .append(std::to_string(e.startRegionX));
```

```cpp
int16_t zLevelCount;   // 0x9fa, previously skipped
int16_t zFarMax;       // 0xa08, previously setDimensionsY_2
```

Both are read-only labels — no byte moves, and no extracted file changes.

---

## 16. The header's container count and position table are trusted — and two shipped files break that

**Description**

`readFileIntoMemory` allocates the position table straight from the header
(`DFfile.cpp:19-26`):

```cpp
fileToRead.read((char*)&fileHeader, sizeof(fileHeader));

uint32_t* containerPositions = new uint32_t[fileHeader.containerCount];

uint32_t tableSize = fileHeader.containerCount * sizeof(int32_t);
fileToRead.read((char*)containerPositions, tableSize);

containers.reserve(fileHeader.containerCount);
```

`containerCount` is an `int32_t` read from the file and used three times without a
test: as a `new[]` length, in a multiplication that overflows `int32_t` above
0x1fffffff, and as a `reserve`. A negative count throws `std::bad_array_new_length`
out of `readFileIntoMemory` — and there is not a single `try`/`catch` in `DFfile`,
so that is a terminate, not an error code.

Nothing checks the positions against the file's length either, and the two ways
that fails are not equally quiet. A position **past EOF** leaves the container at
`size = 0` (the struct's initializer, `DFfile.h:51`) behind a zero-length
`new uint8_t[0]`, which is §9's gap problem arriving through truncation. A position
inside the file whose **declared size** runs past it is worse (`DFfile.cpp:95-96`,
`:105`): the `new uint8_t[size]` succeeds at full size, the read stops short, the
`fileToRead.clear()` below wipes the failure, and the tail of that buffer is
uninitialized heap handed to the format readers as file content.

**Reason**

**Two files in the retail corpus are truncated**, found by running the port's
container reader over every `.PUP` on both discs in all seven language trees
(314 of 316 parse; these are the two that do not):

```
de/titanic1/PUPPETS2/bsea2.pup    2,907,904 bytes on disk, header says 6,237,184
                                  fourCC 0x100 (not 0x10000), count -788529152
ru/titanic1/PUPPETS2/NARRATE.PUP  6,225,917 bytes on disk, header says 8,195,712
                                  count 282, position table points past EOF
```

`bsea2.pup` is the loud one: `new uint32_t[-788529152]` throws before DFET reads a
single container, so "open this file" ends the process. The Russian `NARRATE.PUP`
is the quiet one, and it is quiet in both of the shapes above — of its 282
containers, **55** have a position past the end of the file (indices 227 onward)
and **121** sit inside the file but declare a size that runs past it, so those 121
are the uninitialized-tail case. Both files ship on the disc, so neither needs an
attacker: a user who clicks the wrong entry in `PUPPETS2` finds them.

The port's reader fails on these with thrown exceptions (`Invalid typed array
length` and `Offset is outside the bounds of the DataView`) rather than bad data,
but by accident of JavaScript, not by design: it checks the count no more carefully
than DFET does.

**Fix**

One validation before the table is allocated, and one after it is read:

```cpp
fileToRead.seekg(0, std::ios::end);
const int64_t onDisk = fileToRead.tellg();
fileToRead.seekg(0);
fileToRead.read((char*)&fileHeader, sizeof(fileHeader));

// the count sizes an allocation and a read: it has to fit the file it came from
const int64_t tableSize = (int64_t)fileHeader.containerCount * sizeof(uint32_t);
if (fileHeader.containerCount < 0 || sizeof(fileHeader) + tableSize > onDisk)
    return ERRFILEFORMAT;   // same shape as the existing `return ERRREADCONTAINERS`
```

```cpp
// a position past the end is a truncated file, not a container
if (containerPositions[container] + 8 > (uint64_t)onDisk) {
    containers[container].size = 0;
    containers[container].data = new uint8_t[8]{};   // §9: harmless, not absent
    containers[container].info.assign("TRUNCATED");
    continue;
}
```

```cpp
fileToRead.read((char*)&containers[container].size, sizeof(containers[container].size));

// ... and a declared size may still run off the end: keep the allocation, clamp
// the promise, and zero what the read cannot fill
const uint64_t available = onDisk - (containerPositions[container] + 8);
if (containers[container].size > available)
    containers[container].size = (uint32_t)available;

containers[container].data = new uint8_t[containers[container].size]{};
fileToRead.read((char*)containers[container].data, containers[container].size);
```

Reporting `ERRFILEFORMAT` on the two files above tells the truth about the disc,
which is more useful than crashing or extracting 282 empty containers.

---

## Notes

- **Not covered here:** the v41 audio decoder and the row-mode / bit-packed run
  logic in `getRawImageData` both matched DFET exactly once ported, including
  the `int16_t` truncation in `current_sample = (input_byte << 9)`, which is
  equivalent to sign-extending the low 7 bits. The `param == 1` row
  mode deliberately falling through into the `param <= 5` lookback assignment is
  likewise load-bearing, and the port reproduces it.
- **Unfixed in the port too:** in `writeTransPNGimage`, the copy-from-previous-row
  mode on row 0 reads before the start of the image buffer (`DFfile.cpp:388`).
  The port has the same structural hole with different symptoms (JavaScript's
  `copyWithin` reinterprets the negative index as end-relative), so this is an
  observation rather than a fix. It is unreachable in the shipped art, measured:
  across 10,389 transparent frames (every SHP prop frame and PUP stance frame of
  the English tree) the mode accounts for 3.94 million runs and **none** is on
  row 0.
- **How the numbers were produced.** Every count in this report comes from running
  the port's own readers over the shipped files and tallying stored fields — the
  format readers are the instrument, so a number here is a number the port agrees
  with by construction. The two decoder tallies (§1's overlapping runs, the row-0
  count above) were taken by adding a counter to a copy of the decoder and decoding
  every frame the set/shop/puppet readers name; the rest read one field per record.
  The corpus is the retail game, both discs, all seven language trees, plus the demo
  edition: 474 `.SET`, 316 `.PUP`, 558 `.TRK`/`.SFX`/`.11K`, and the English `.MOV`
  tree. Where a measurement covers only the English tree, the entry says so.
- The port is GPL-3.0 precisely because it derives from DFET, and the docs credit
  `FileInfos.md` as the source for essentially the entire "how do you read these
  files" story. These are corrections to the work that made the port possible.
