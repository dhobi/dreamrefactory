# Audio — TRK / SFX / 11K / SND

*Prerequisite: [The DFile container format](README.md).*

The game's sound comes from a family of container files that all share the
same layout and the same two compression codecs. They differ mainly in **what
they hold**:

| Extension | Holds |
|-----------|-------|
| **.TRK** | music ("tracks") — sometimes also effects and voices |
| **.SFX** | sound effects |
| **.11K** | shorter versions of the songs (see below — *not* a sample rate) |
| **.SND** | an older, more limited catch-all sound format (rare in TAOOT) |

Reference implementation: [`engine/src/df/audio.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/audio.ts)
(chunk decoding — the two codecs) and
[`engine/src/df/banks.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/banks.ts)
(the bank chunk tables, shared with [MOV](mov.md) soundtracks). Playback —
channels, volumes, the sound library — is the runtime's job:
**[Audio at runtime](../runtime/audio.md)**.

## Why audio is the odd one out

Everywhere else, "one thing = one container." Audio is the exception: **a
single sound is split across many containers**, each usually under 64 KB, that
must be **concatenated** back together. This was a 1996 memory-management
convenience. So the audio reader's job is to walk the containers, decode each,
and stitch the pieces into one waveform.

## Banks: ordered loops vs named one-shots

An audio file is a **bank** of chunks, and there are two kinds, distinguished
by how they're indexed (`banks.ts` reads both tables — the same layout MOV
files use for their soundtracks):

- **Ordered loop chunks** → **music**. The table is a play *order* over the
  records; played in sequence and looped, they form a continuous track
  (that's what `playtheme` does).
- **Named single chunks** → **one-shots**. Addressed by name — `doorlocked`,
  `dooropen1`, a voice line — and fired individually.

Shared voice lines that many rooms need (locked-door lines, generic
door-opens) live in **`UNILIB.TRK`**, a bank the session keeps open globally.
How a requested name finds its bank at runtime is
[the library's job](../runtime/audio.md#the-library-how-a-name-finds-a-sound).

## 11K: the low-memory swap-in

`.11K` files are **shorter versions of the songs**. The name is misleading:

> You'd assume "11K" means 11025 Hz. **It doesn't.** The BOOTFILE picks 11K
> over TRK based on **available RAM** — if the machine has **less than 6000 KB**
> of RAM, it loads the smaller 11K songs instead of the full TRK ones. (Yes,
> under 6 MB. It was 1996.)

Measured over the eleven banks that have a `.11k` twin: same codec, same 22050 Hz,
about **half the loop chunks** — decka 11 → 6, deckb 17 → 8, decke 20 → 10, cargo
11 → 6. Each `.11k` bank's `trackName` field names the `.trk` it stands in for,
which is what makes `opentrackfile("decka.11k")` followed by
`playnewtheme("decka.trk")` work at all. The port lets a player ask for this
deliberately — **[the low-memory game](../runtime/low-memory.md)** has the full
table, the `sink3` exception, and what else the same switch turns off.

## The chunk header and the two codecs

Each audio chunk begins with a small header. The fields that matter:

| Offset | Type | Meaning |
|-------:|------|---------|
| 0 | — | magic `0x00010000` |
| `0x1A` | i16 | **codec**: `1` = v40 (8-bit), otherwise v41 (16-bit) |
| 28 | i32 | sample rate (mostly 22050 Hz, some 11025 Hz) |
| 36 | i32 | uncompressed size |
| 44 | i32 | offset to the compressed data |

The rate is **per chunk, not per file**, and that matters because concatenation is
how audio is read here: one bank's loop chunks (and one movie's soundtrack
segments) mix 22050 and 11025, and *which* of them are which differs per language
— `bedrad1.trk`, the bedsit radio, is two of fifteen chunks at 11025 in the
English tree and nine in the German one. A decoded buffer plays at one rate, so
anything that joins chunks end to end has to resample them to a common rate first
(`resampleTo`, in the same file); leaving the slower ones alone plays them at
double speed. Same codec, same header, per-language content — see
[the theme join](../runtime/audio.md#a-theme-s-chunks-are-not-all-at-one-rate).

Both codecs are **ADPCM-style** — they store each sample as a small change
from the previous one rather than an absolute value, which is what makes them
compress. Two variants exist:

- **v40 (8-bit).** Uses three run modes: a literal sample, a **step-table
  pair** delta, and a repeat. The two 256-entry step tables turn out to be
  **generated at load** from sign-extended nibbles, so they don't need to be
  embedded in the code at all.
- **v41 (16-bit).** Each byte is either a delta from the previous 16-bit
  sample or a marker to read a new absolute value.

DFET's author noted the game exposes a "16-bit stereo" audio option that seems
to make no audible difference — an interesting loose end, not something the
port needs to chase.

## Playback in the engine

Playback splits into three logical **channels** — `sound`, `voice`, `theme` —
matching the command families, so a voice line and a music cue don't fight
over one output. The channel model, the volume controls, and the browser vs
headless sinks are covered in **[Audio at runtime](../runtime/audio.md)**;
positional ambient sound (the "crickets" — a one-shot placed *in the room*,
with distance-based volume and stereo pan) is part of the timing layer:
**[Timing](../runtime/timing.md#crickets-sound-with-a-position)**.

## Writing a bank back

The port also has the way back, for the
[track editor](../../editors/tracks.md): `encodeAudioContainer`
packs samples into a chunk (always **v41** — the v40 literal mode reaches only
half the sample range, so it stays a decoder), and `banks.ts` patches the three
things a bank says about itself rather than plays: the track name, a chunk's
identifier, and the play order. Two asymmetries are worth knowing:

- **The codec is lossy**, so a decode → encode round trip is not the bytes it
  started from. It is per chunk, though — a bank may mix v40 and v41.
- **The track-name field's size isn't known.** What follows it in container 0
  has never been identified, so the writer stays inside the characters already
  stored plus the zero padding after them (capped at the 31 the format's other
  name fields use). That is why the editor tells you how many characters fit
  rather than offering a fixed field.

## Related tools

- `taoot/tools/dumpaudio.ts` — export decoded chunks as WAVs and waveform PNGs;
  `--find <name>` scans every bank for a named sound.
- [`editors/tracks.html`](../../editors/tracks.md) — the browser editor over this format:
  play a bank, rename and reorder its chunks, replace their audio, export the
  repack.

Next: the script bundle that starts the whole game —
**[BOOTFILE](bootfile.md)**.
