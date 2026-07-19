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

Reference implementation: [`src/df/audio.ts`](https://github.com/dhobi/taoot-web/blob/master/src/df/audio.ts) (decoding
+ bank reader) and [`src/engine/audio.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/audio.ts)
(playback channels + the sound library).

## Why audio is the odd one out

Everywhere else, "one thing = one container." Audio is the exception: **a
single sound is split across many containers**, each usually under 64 KB, that
must be **concatenated** back together. This was a 1996 memory-management
convenience. So the audio reader's job is to walk the containers, decode each,
and stitch the pieces into one waveform.

## Banks: ordered loops vs named one-shots

An audio file is a **bank** of chunks, and there are two kinds, distinguished
by how they're indexed:

- **Ordered loop chunks** → **music**. Played in sequence and looped, they form
  a continuous track (that's what `playtheme` does).
- **Named single chunks** → **one-shots**. Addressed by name — `doorlocked`,
  `dooropen1`, a voice line — and fired individually.

Shared voice lines that many rooms need (locked-door lines, generic
door-opens) live in **`UNILIB.TRK`**, a bank the session keeps open globally.
The engine's `AudioLibrary` resolves a requested name across all currently
open banks, with a decode cache.

## 11K: the low-memory swap-in

`.11K` files are **shorter versions of the songs**. The name is misleading:

> You'd assume "11K" means 11025 Hz. **It doesn't.** The BOOTFILE picks 11K
> over TRK based on **available RAM** — if the machine has **less than 6000 KB**
> of RAM, it loads the smaller 11K songs instead of the full TRK ones. (Yes,
> under 6 MB. It was 1996.)

## The chunk header and the two codecs

Each audio chunk begins with a small header. The fields that matter:

| Offset | Type | Meaning |
|-------:|------|---------|
| 0 | — | magic `0x00010000` |
| `0x1A` | i16 | **codec**: `1` = v40 (8-bit), otherwise v41 (16-bit) |
| 28 | i32 | sample rate (mostly 22050 Hz, some 11025 Hz) |
| 36 | i32 | uncompressed size |
| 44 | i32 | offset to the compressed data |

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

Three logical **channels** match the command families, so a voice line and a
music cue don't fight over one output:

| Channel | Commands |
|---------|----------|
| `sound` | `singlesound`, `multiplesound` / `dualsound` (overlapping), `bothsound`, `haltsound` |
| `voice` | `voicesound`, `haltvoice`, `voicedone` |
| `theme` | `playtheme` (looped), `halttheme` |

`opentrackfile` / `closetrackfile` manage which banks are open. In the browser,
a `WebAudioSink` does the real playback (created on the first user gesture, per
browser autoplay rules); headless runs and tests use a `NullAudioSink` that
just records what would have played.

### Positional ambient sound (the "crickets")

Beyond fire-and-forget one-shots, the engine can place a sound *in the room* —
steam that hisses from a spot, an ambient loop. These are internally called
**crickets**: a one-shot bound to the current set, at an (x, y) position, with
a radius (audible range) and a re-fire timer. Distance sets the volume,
bearing sets the **stereo pan**. Firing again with no gap makes a seamless
loop; firing with a random gap makes an intermittent hiss. This lives in the
timing layer (see [engine architecture](../02-engine-architecture.md)); the
exact volume-falloff curve isn't fully recovered, so the port approximates it
linearly.

## Related tools

- `tools/dumpaudio.ts` — export decoded chunks as WAVs and waveform PNGs;
  `--find <name>` scans every bank for a named sound.

Next: the script bundle that starts the whole game —
**[BOOTFILE](bootfile.md)**.
