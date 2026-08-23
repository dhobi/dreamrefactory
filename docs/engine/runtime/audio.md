# Audio at runtime — channels, banks & volumes

*Prerequisite: [Audio — TRK / SFX / 11K / SND](../formats/audio.md) (the
format and codecs).*

The [audio format doc](../formats/audio.md) ends where the samples do. This
page covers playback: how a name like `"dooropen1"` finds its bank, which of
the three channels it lands on, and where the volume knobs actually plug in.

Reference implementation:
[`engine/src/runtime/audio.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/audio.ts)
(`AudioLibrary` + the sinks); the commands are in
[`builtins/audio.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/builtins/audio.ts).

## The library: how a name finds a sound

`opentrackfile` / `closetrackfile` manage which banks are open.
`AudioLibrary` resolves a requested one-shot name across **all** currently
open banks (case-insensitive, `.wav` suffix stripped), with a decode cache —
which is why shared lines can live in the globally-open `UNILIB.TRK` and
"just work" from any room. A **theme** is a bank's ordered loop chunks
**concatenated** into one waveform and looped whole.

### A theme's chunks are not all at one rate

A decoded buffer plays at exactly one sample rate, and the game does not store one
rate per file: **a bank's loop chunks mix 22050 Hz and 11025 Hz, and which chunks
are which differs per language.** So the join has to bring every chunk up to the
highest rate present (`resampleTo` in
[`df/audio.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/audio.ts),
shared with the movie player's soundtrack join). Labelling the join `Math.max` and
leaving the slower chunks alone plays them at double speed, which is what the
bedsit radio did: `bedrad1.trk` is **two of fifteen chunks at 11025 in English and
nine in German**, so the German announcer was the one anybody noticed — 56.1 s of
chipmunk against its true 73.4 s. `taoot/tests/auto/audio-rates.ts` asserts a theme
lasts as long as its chunks do, over every shipped tree.

Two more behaviours worth knowing:

- **Theme banks are named by deck, not by set** — `DECKBD.SET`'s ambient
  lives in `decka.trk` (the boot's `setupsound`/`themetype` mapping); the
  session fetches track files on demand when a script opens one.
- `closetrackfile` deliberately does **not** stop a theme that's playing from
  that bank — the original behaves the same, and scripts rely on it when they
  swap banks under a running track.

## Three channels

Playback is split into three logical channels so a voice line, an effect and
the music never fight over one output:

| Channel | Commands |
|---------|----------|
| `sound` | `singlesound`, `multiplesound` / `dualsound` (overlapping), `bothsound`, `haltsound`, `sounddone` |
| `voice` | `voicesound`, `haltvoice`, `voicedone` |
| `theme` | `playtheme` / `playnewtheme` (looped), `halttheme`, `currenttheme` |

Within the `sound` channel the engine tracks **two slots**, matching
`TI.EXE`: non-overlapping plays (`singlesound`, `bothsound`) occupy slot 1,
overlapping and looped ones (`multiplesound`, `dualsound`, `soundloop`ed
sounds) slot 2 — `currentsound(n)` reads them, and the wireless's tuning
static can hiss over a voice line because they sit in different slots.

**A cricket occupies slot 2 as well, and has to say so.** `currentsound()` is the
only way a script can ask whether a sound has finished, and the slots are written
by the play path alone — so a cricket fired straight at the sink recorded nothing
and read as silence. The bedsit landlady is the bill: her five lines are separate
crickets sequenced entirely by that question (`lady()` re-arms itself every couple
of ticks and starts the next line only when `currentsound(1) = curlady |
currentsound(2) = curlady` is false), so with the gate permanently false she
started a new line every 1.32 s over the top of the last — 21.25 22.57 23.89
25.21 26.53 against 21.25 23.89 26.53 31.81 37.09 with the play recorded. Lines
run 1.6–5.2 s, so four of the five overlapped. Pinned by
[`sound-channels.ts`](../../reference/tests.md#titanic-s-automatic-suite-—-taoot-tests-auto), which
has to bring its own clock-driven sink to see it at all.

**Every play needs an owner that ends it.** A channel is shared, so "stop what
I started" can rarely be "halt the channel": room ambience and sound loops sit
on `sound` next to a movie's event sounds, so the movie stops *its own* plays
by handle when it closes — otherwise a frame-entry sound that is really a
spoken line (`LENIN.MOV` fires Penny's 3.5 s `penny2.29`) keeps talking over
whatever the script does next, and 24 interactive movies in the corpus carry
one. The same rule on `voice`: skipping a `puppetspeak` with a click silences
the line then and there, rather than leaving it for the next line's play to cut
— what follows a line is often a movie or a pause, not another line.

Per-sound trims are set *before* the play: `soundvol(name, 0..255)` and
`soundpan(name, 0..255)` stash a volume/pan for that name (defaults 255 /
128-centre) which the next play of it picks up; `soundloop(name)` flags it to
loop. Positional ambient sound — the **crickets** — computes its own volume
and pan from world position every heartbeat: see
**[Timing](timing.md#crickets-sound-with-a-position)**.

## Sinks: browser vs headless

The channel model is an interface (`AudioSink`) with two implementations:

- **`WebAudioSink`** — real playback: one `GainNode` per channel (the master
  volumes below), per-play gain and a `StereoPanner` for crickets. Browsers
  only allow audio after a user gesture, so the sink is created lazily on the
  first pointer/key event and pending channel volumes are replayed onto it.
- **`NullAudioSink`** — headless runs and tests: records every play (duration
  included, so `voicedone`-style polling still works) without producing
  sound. It reports a non-looping play as **done the instant it starts**, which
  is what keeps the suite deterministic and also makes "is this still playing?"
  unanswerable — so `newHost` takes the sink as an argument and a test about
  sequencing brings a clock-driven one instead
  ([tests](../../reference/tests.md#titanic-s-automatic-suite-—-taoot-tests-auto)).

## The volume knobs

Three controls, all reachable from the game's own CTL.STG settings screen:

| Control | Range | Applies to |
|---------|-------|-----------|
| `wavevolume(n)` | 0–9 | `sound` + `voice` channel master gain |
| `themevol(track[, v])` | 0–255 | `theme` channel master gain |
| `themevolume` global | 0–255 | what the theme lever reads/writes; set entry calls `themevol` from it |

`themevol` **answers what it is asked**: with two arguments it sets, with one it
is a *getter* and returns the level in effect. That is not a nicety — the settings
screen's own idiom is `themevol(t, themevol(t) / 4)`, so a version that answered
nothing answered 0, and the music went silent the moment the panel touched it. A
theme that starts on set entry without a `themevol` call of its own still gets the
global applied, so the getter reads back the level actually playing rather than an
untouched default.

One **deliberate divergence from the original**: the game's boot sets
`themevolume` to 255 (full), but ambient themes at full volume wear over a
long session, so the port seeds **24** — music starts very quiet and the
player raises it with the theme lever. (The lever prop's rest position is
synced to match.) The session's own defaults leave SFX and voice at full; a **cold
boot** then starts every edition at a 50% mix instead — `themevolume` 128, the 0–9
wave dial parked at 5, and the `sound`/`voice` channel gains at 0.5. It is applied
*after* `boot()`, because `boot()` assigns `themevolume = 255` itself and anything
set in front of it is overwritten.

Next: keeping all this state across sessions —
**[Saving & loading](saves.md)**.
