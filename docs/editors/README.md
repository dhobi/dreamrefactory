# The browser editors

Pages the project's own site hosts — `npm run dev`, on 5173, beside the
front door rather than beside either game. They are not CLIs and they
need no `gamefiles/` directory: each one takes a file you give it, takes it
apart into the pieces that format is made of, lets you change the parts that
are safe to change, and hands the repacked file back. All but two do: the
[sprite book viewer](books.md) and the [maze viewer](mazes.md) only read, because
nothing in this project writes a `.SBK` or a DreamFactory 0 maze.

Between them they cover **every container format the DreamFactory 1 and 4 games
ship**: rooms (SET),
props (SHP, and DreamFactory 1's PRP), movies (MOV — logic only, for a reason
[the page explains](movies.md#why-the-art-is-read-only)), screens (STG, and v1's
FLT), sound (TRK/SFX/11K/SND), and characters twice over (PUP for the brains, CST
for the body) — plus Skull Cracker's sprite books (SBK), the one format here that
belongs to a game with no interpreter. The one file the game *writes* rather than reads, the `.ti`
[save](../engine/formats/savegame.md), has
[the saved-games browser](../engine/runtime/saves.md) instead.

RedJack's DreamFactory 5 files open in the same editors, **read-only**: `.shop`,
`.cast`, `.pupp`, `.stag`, `.move` and `.trak` go through the engine's v5 readers
([DreamFactory 5's containers](../engine/formats/dreamfactory-5.md)), and each
sprite, frame and flat is drawn in the palette it carries. Export stays off,
because the patches and the PNG encoders write v4's layout. Its rooms, `.sett`,
have a page of their own, the [sett editor](setts.md): a SETT is nodes and
panoramas rather than scenes with a ring of views
([SETT](../engine/formats/sett.md)), so it is not a SET the set editor could be
taught. It does export, because its edits are written over the bytes they came
from rather than repacked.

Lunicus's DreamFactory 0 files open read-only too, picked from the Lunicus
source: its films in the movie editor, its sound banks (`citysoun.`,
`moonsoun.`) in the track editor and its talk files (`raife.1` … `guard.7`) in
the puppet editor, where the player's questions are lines of their own (`q …`)
beside the character's. A v0 file carries no version, so an editor does not
guess it from the bytes; the source says so (`dreamFactory0` in
`site/src/games.ts`). Its mazes have a page of their own, the
[maze viewer](mazes.md). The pictures in `shared/` have no editor yet
([DreamFactory 0's containers](../engine/formats/dreamfactory-0.md)).

| Editor | Page | Format | Source |
|--------|------|--------|--------|
| [Set editor](sets.md) | `/editors/sets.html` | [SET](../engine/formats/set.md) — rooms, scenes, views (not RedJack's `.sett`) | [`site/editors/set-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/editors/set-editor.ts) |
| [Shop editor](shops.md) | `/editors/shops.html` | [SHP / PRP / SHOP](../engine/formats/shp.md) — props (`.shop` read-only) | [`site/editors/shp-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/editors/shp-editor.ts) |
| [Movie editor](movies.md) | `/editors/movies.html` | [MOV / MOVE](../engine/formats/mov.md) — cutscenes & close-ups (`.move` and Lunicus's `.mov` read-only) | [`site/editors/mov-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/editors/mov-editor.ts) |
| [Stage editor](stages.md) | `/editors/stages.html` | [STG / FLT / STAG](../engine/formats/stg.md) — full-screen flats & UI (`.stag` read-only) | [`site/editors/stg-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/editors/stg-editor.ts) |
| [Track editor](tracks.md) | `/editors/tracks.html` | [TRK / SFX / 11K / SND / TRAK](../engine/formats/audio.md) — audio banks (`.SND`, `.trak` and Lunicus's banks read-only) | [`site/editors/track-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/editors/track-editor.ts) |
| [Puppet editor](puppets.md) | `/editors/puppets.html` | [PUP / PUPP](../engine/formats/pup-cst.md) — conversations (`.pupp` and Lunicus's talk files read-only) | [`site/editors/puppet-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/editors/puppet-editor.ts) |
| [Cast editor](casts.md) | `/editors/casts.html` | [CST / CAST](../engine/formats/pup-cst.md) — actor sprites (`.cast` read-only) | [`site/editors/cst-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/editors/cst-editor.ts) |
| [Sprite book viewer](books.md) | `/editors/books.html` | [SBK](../engine/formats/sbk.md) — Skull Cracker's cels & levels (read-only) | [`site/editors/sbk-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/editors/sbk-editor.ts) |
| [Maze viewer](mazes.md) | `/editors/mazes.html` | [MAZE](../engine/formats/dreamfactory-0.md) — Lunicus's grids, views & step films (read-only) | [`site/editors/maze-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/editors/maze-editor.ts) |
| [Sett editor](setts.md) | `/editors/setts.html` | [SETT](../engine/formats/sett.md) — RedJack's rooms: spheres, roads, scenes; quads & stars editable | [`site/editors/sett-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/editors/sett-editor.ts) |

All of it lives in `site/editors/`: one HTML page and one module per editor,
the `editor.css` all of them share, and an `index.html` that lists them — the
page `/editors/` itself serves. Each page is its own Vite entry point in
`site/vite.config.ts`, beside the front door.

They are the **site's** rather than a game's: an editor opens a file out of
whichever rip you point it at, so making it belong to one game would point a
dependency from the shared package into one of its own consumers. What they need to know about a game — which trees a rip offers, what
to call them, which code page each one's text is in — is
`site/src/games.ts`.

Nothing in there imports `engine/src/runtime/`; the only shared code is
`engine/src/df/` and `engine/src/web/screen.ts`. That is the line that keeps an
editor a file tool rather than half a game.

## What they have in common

The pages look different because the formats do, but underneath they share the
same ideas.

**They read with the engine's own code.** An editor does not have a parser of
its own. `site/editors/sets.html` opens a room through the same `readSetFile` the
runtime loads a room with, `site/editors/tracks.html` decodes a bank through the
same `decodeAudioContainer` the audio channel plays through. So the editor cannot
drift from the port: if a page draws a hotspot in the wrong place, the engine
is putting it there too. The editors are, in practice, the best debugger the
[file-reading layer](../engine/architecture.md) has.

**They load a file three ways.** Upload it, drag it onto the page, or — when
the dev server is running — pick it from the `gamefiles.json` manifest, the same
index the game resolves a bare filename through. Nothing is uploaded anywhere;
the parsing all happens in the tab.

**Which language's copy you get is a choice, so the pages carry the picker.** A
tree with six languages installed offers six copies of every basename, and an
editor listing all of them is listing the same file six times — so the 🌐 control
in the top bar filters the manifest to one tree
([Languages](../taoot/languages.md)). For the puppet editor it decides more than
the listing: the subtitles' [code
page](../taoot/languages.md#the-code-page-is-not-in-the-data) comes from the same
choice, because no puppet file states it.

**An untouched load exports the file it read.** Every edit that is not
whole-container art is a *copy-on-write patch* on one container:
`patchContainerData` in
[`engine/src/df/container.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/container.ts)
replaces just that container with an edited copy and leaves the rest of the
loaded buffer pristine, and `writeContainerFile` reserializes the file with the
original header bytes kept verbatim (so header fields nobody has decoded yet
survive the trip). The result is the guarantee each page's export note repeats:
**everything you did not touch is the byte it was.** It is pinned per format — the [editor test suites](../reference/tests.md) round-trip
a synthesized file of each type and assert that every single edit moves exactly
its own field, in the bytes *and* in the structure the editor drew from.

**Art replacement is the one lossy path.** Names, rectangles, offsets and
ordering are byte-exact. Pixels and audio are not, because they get re-encoded:

| Import | What happens to it | Consequence |
|--------|--------------------|-------------|
| a **view or flat picture** | matched to the file's palette (nearest RGB) and re-encoded with `encodeFrame` in [`engine/src/df/image.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/image.ts) | written **self-contained** rather than delta-coded, so it decodes identically but is bigger than CyberFlix's own encoding of the same picture |
| a **prop or actor sprite** | the same, plus **alpha < 128 becomes transparent** | the mask is also the click hit-test, so it decides what is clickable, not just what is drawn |
| **audio** | downmixed to mono, resampled to the chunk's rate, re-encoded with the v41 codec | the codec is lossy — re-importing an exported WAV will not reproduce the original bytes |

The formats also constrain what a replacement can preserve. A SET frame carries
a **Z layer** (the depth image that hides an actor behind scenery) which can
only be carried over at the same width and height; a MOV frame is a link in one
long delta chain, which is why that editor has no art import at all. Each page
says so where it applies, and says it again on screen when it happens.

## Reading order

There isn't one — go to the format you care about. But the pages assume you
have read the [format doc](../engine/formats/README.md) behind them, because they
describe what the editor *does with* a structure rather than what the structure
is. The set editor's page will tell you that renaming a road is a
copy-on-write patch; [SET](../engine/formats/set.md) is where you find out what a road
is.

## What holds them to their contract

Every editor's promise is a round trip: load a file, change one thing, export, and
the bytes you did not touch are the bytes you had. That is checked in
`taoot/tests/auto/*-editor.ts`, one suite per editor, over a **synthesized** file rather
than a shipped one — so the suites need no `gamefiles/` and can be written against
awkward shapes on purpose (a state whose play order reverses its frames, a pose with
a missing direction, a movie frame that holds the picture before it).

Those fixtures are built by the library's own writers, `engine/src/df/*-build.ts`
([the write path](../engine/formats/README.md#writing-one-back)), rather than
hand-laid byte arrays, so a fixture reads as what it builds.

Back to the [documentation home](../README.md).

