# The track editor

[`site/editors/tracks.html`](https://github.com/dhobi/dreamrefactory/blob/master/site/editors/tracks.html) — source
[`site/editors/track-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/editors/track-editor.ts).
Open `http://localhost:5173/editors/tracks.html`.

The sound half of what the other editors do for pictures: load an
[audio bank](../engine/formats/audio.md) — a `.TRK` music track, a `.SFX` effects
bank, an `.11K` low-memory song — and it comes apart into the two things a bank
holds.

## What it shows

| Part | What you can do with it |
|------|-------------------------|
| the bank's **track name** | rename it — this is what a script's `playnewtheme`/`opentrackfile` asks for. The field is fixed-size, and the page shows how many characters fit |
| the **play order** | the sequence of loop chunks that makes up the looping theme: reorder it, repeat a chunk, drop one, append one. **▶ Play theme** plays the result the way the engine does — the chunks concatenated and looped |
| each **loop chunk** | play it, see its waveform, sample rate and codec, rename it, export it as a WAV, or replace its audio |
| each **one-shot** | the named sounds `singlesound` fires (`doorlocked`, a voice line): the same, with a filter over the list — `UNILIB.TRK` carries hundreds |

## Replacing audio

Replacing audio takes any file the browser can decode (WAV, MP3, OGG), downmixes
it to mono and resamples it to the rate the chunk it replaces plays at, then
re-encodes it with the format's v41 codec (`encodeAudioContainer` in
[`engine/src/df/audio.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/audio.ts)).
That codec is lossy and only v41 is written, so an import is *not* a byte-for-
byte round trip — re-importing an exported WAV will not reproduce the original
bytes.

**⬆ Replace all music** takes one file for the whole theme and splits it across
the chunks the theme is made of, in proportion to their current lengths, so a
bank keeps the chunk sizes it was built with (the format splits long sound
across containers, and the engine loads a theme a chunk at a time).

## Exporting

**Export bank** repacks the container file and downloads it. The three edits
that are not audio — the track name, a chunk identifier, the play order — are
copy-on-write patches on a single container each (`patchTrackName`,
`patchChunkIdentifier`, `patchLoopOrder` in
[`engine/src/df/banks.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/banks.ts)),
so everything you did not touch is the byte it was
(see [`taoot/tests/auto/trk-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/trk-editor.ts)).

## See also

- [Audio — TRK / SFX / 11K / SND](../engine/formats/audio.md) — the formats and their two codecs
- [Audio](../engine/runtime/audio.md) — channels, bank resolution and the volume controls
- [The browser editors](README.md) — what the seven pages share

