<img src="./globe-mark.svg" alt="" width="132" align="right">

# dreamREfactory

These docs explain how CyberFlix's **DreamFactory** engine works, and how this
project turns the original game files into something that runs in a browser —
**no DOSBox, no emulator**, a fresh reimplementation in TypeScript.

All three adventures built on that engine are here — two of them CyberFlix's own
and the third GTE Interactive Media's:
**[Dust: A Tale of the Wired West](dust/)** (1995, DreamFactory 1),
**[Titanic: Adventure Out of Time](taoot/)** (1996, DreamFactory 4) and
**[Timelapse: Ancient Civilizations](timelapse/)** (1996, DreamFactory 4 on four
discs). The first two are two years apart and different enough on disk that
several formats have a `-v1` page of their own; the third is the same generation
as Titanic and still nothing like it, because it ships no `.SET` file at all.

The docs are written for a curious programmer who has **not** done
low-level reverse engineering before. You do not need to know C++, and you
do not need to be comfortable reading raw bytes. Where a byte-level detail
matters, it is explained in plain language first, with the exact numbers in
a table you can skim past.

## Standing on other people's work

Almost nothing about DreamFactory is publicly documented, so it's worth being
clear up front: **the hard part of understanding these formats was done by
other people**, and this project mostly builds on their shoulders. Where a
doc knows something, it tries to say where that knowledge came from.

1. **[DFET](https://github.com/M3tox/DFET), by M3tox** — a GPL-3.0 C++ tool
   that *extracts* assets (images, audio, scripts) from DreamFactory games.
   This is the big one. The container skeleton, the image-decompression codec,
   the audio codecs, the script encoding and the full command-name table —
   essentially the entire "how do you *read* these files" story — was worked
   out by M3tox and published in DFET. This project's file-reading layer is a
   port of that C++ code, and these docs lean heavily on M3tox's own
   plain-English write-up,
   [`FileInfos.md`](https://github.com/M3tox/DFET/blob/main/FileInfos.md). If
   these formats make sense to you after reading, most of the credit is
   theirs.
2. **[MRXstudios](https://mrxstudios.home.blog/2021/03/05/reverse-engineering-dust-uncovering-game-scripts/)**
   — earlier still, MRXstudios' work reverse-engineering the scripts in *DUST:
   A Tale of the Wired West* (an older DreamFactory game) is what inspired DFET
   in the first place. The script-decoding lineage starts here.
3. **The original game executable, `TI.EXE`** — DFET can pull the data *out* of
   the files, but an extraction tool never has to *run* the game, so it didn't
   need to know what the scripts and coordinates actually *do*. That behaviour
   (what each script command means, how a prop is placed in 3D, how timers
   fire) isn't in DFET, so this project worked it out by disassembling the
   shipped Windows executable. This is the part that's genuinely new here —
   recovered incrementally, one command at a time (the
   [builtin reference](reference/builtins.md) shows how far that has come).
   Whenever a doc says "recovered from `TI.EXE`", that's what it means.
4. **The game files themselves** — a lot was simply confirmed by decoding a
   file and checking the result against what the real game shows.

## Reading order

The sections below are in dependency order — each assumes the ones above it —
and so are the pages inside them. Every page also names its own prerequisites
at the top, so you can jump straight to one and follow those back.

Each game also has a section of its own, for what is true of that game rather
than of the engine: **[Titanic](taoot/)** — its mission flow, its timed sinking,
its six editions and how the port was verified against it — **[Dust](dust/)** —
what DreamFactory 1 does differently, and where its music lives — and
**[Timelapse](timelapse/)** — a game with no rooms, navigated by the shape of the
cursor.

Two pages are outside the order, for reading out of order:
**[the glossary](glossary.md)** (one line per term, when a word you don't know
turns up in the middle of a page) and
**[how we know it's right](taoot/verification.md)** (what actually verifies these
claims — worth reading whenever you want to know how load-bearing one is).

### Concepts — the engine, and what it makes

- **[How the game works](engine/how-a-game-works.md)** — the big picture.
  What a "pre-rendered adventure on rails" actually is, and what happens
  from the moment you launch the game to walking around and clicking on
  things. Read this first.
- **[Engine architecture](engine/architecture.md)** — how *this project*
  is organised: the file-reading layer, the runtime engine, the render
  loop, and how a mouse click travels through the system.
- **[The scripting language](engine/scripting-language.md)** — the game is
  mostly *scripted*, not hard-coded. This explains DreamFactory's little
  scripting language, the event model (`openset`, `mousedown`, …), and how
  the interpreter runs it.
- **[The mission flow](taoot/mission-flow.md)** — how the *plot* is encoded:
  the `mission`/`phase` globals, the story spine reconstructed straight from
  the scripts, and the tool that extracts it. Deeper than the three above and
  full of spoilers; safe to come back to.

### File formats — the DFile containers

All game data lives in "DFile" container files. Read the foundation doc
first; every format doc after it builds on it.

- **[The DFile container format](engine/formats/README.md)** — the shared skeleton
  *every* DreamFactory file uses. **Read this before any specific format.**
- **[The image codec](engine/formats/image-codec.md)** — how a compressed picture
  (a room view, a movie frame, a prop) turns back into pixels, plus how
  colour palettes and depth maps work.
- **[SET — rooms, scenes & views](engine/formats/set.md)** — the pre-rendered
  world you walk around in.
- **[SHP — props ("shop" files)](engine/formats/shp.md)** — the things drawn on top
  of the world: doors, items, buttons.
- **[MOV — movies & inspectable objects](engine/formats/mov.md)** — cutscenes and
  click-through close-ups, and why one file is a chain of films rather than one.
- **[STG — stage files & the UI](engine/formats/stg.md)** — full-screen screens
  like the deck map, the inventory, and the on-screen UI band.
- **[Audio — TRK / SFX / 11K / SND](engine/formats/audio.md)** — music, sound
  effects and voice lines, and the two custom compression codecs.
- **[BOOTFILE — the game's startup & standard library](engine/formats/bootfile.md)**
  — the script bundle that boots the game and defines its shared behaviour.
- **[The script container on disk](engine/formats/script-container.md)** — the
  binary layout of a compiled script, for when you want to go deep.
- **[PUP & CST — characters ("puppets")](engine/formats/pup-cst.md)** — dialogue,
  facial animation and character sprites.
- **[Saved games (`.ti`)](engine/formats/savegame.md)** — the one file the game
  *writes*: a serialized memory dump, and how it's read and patched back.
- **[Saved games, DF1 (`.rtd`)](engine/formats/savegame-v1.md)** — the same
  container three years earlier, and the four record strides that moved.

### Runtime — how the port plays the game

The formats say what's in the bytes; these docs say what the engine *does*
with them — the behaviour recovered from the games' own binaries (`TI.EXE`, and
`DF.EXE` where the two engines differ), plus the browser host around it. Overview: **[the runtime section](engine/runtime/README.md)**.

- **[Timing](engine/runtime/timing.md)** — the heartbeat, `makeloop`, crickets,
  walks, and the game clock.
- **[Stage & UI](engine/runtime/stage-ui.md)** — flat lifecycles, the overlay
  stack behind the inventory, and the click order.
- **[Characters](engine/runtime/characters.md)** — actors in the world and puppet
  conversations.
- **[Audio](engine/runtime/audio.md)** — channels, bank resolution, and the volume
  controls.
- **[Saving & loading](engine/runtime/saves.md)** — snapshots, the load sequence,
  and the in-browser saved-games UI.
- **[The browser host](engine/runtime/host.md)** — the page and the boot it runs, the
  viewer, the screen everything composites into, the movie player, and input.
- **[The low-memory game](taoot/low-memory.md)** — the smaller version of
  itself the game shipped with, what its own `lowmemory()` switches off, and why
  `.11K` is not 11 kHz.
- **[Languages & the chooser](taoot/languages.md)** — one data tree per
  language, the two selectors a bare filename resolves through, the code page
  its text turns out to be in, and the chooser this port wrote as a real
  DreamFactory stage.

### Editors — reading the formats back out

Seven browser pages the site hosts, one per container format: load a
file, take it apart, change what is safe to change, export the repacked
original. They read with the engine's own code, so they double as the best
debugger the file layer has. Overview: **[the browser editors](editors/README.md)**.

- **[The set editor](editors/sets.md)** — rooms: scenes, turn rings, hotspots,
  roads, actor marks.
- **[The shop editor](editors/shops.md)** — props: groups, states, frames, and
  where a frame lands on screen.
- **[The movie editor](editors/movies.md)** — a movie read as what it is, a
  chain of state machines of frames.
- **[The stage editor](editors/stages.md)** — flats and their clickable
  regions.
- **[The track editor](editors/tracks.md)** — audio banks: the looping theme
  and the named one-shots.
- **[The puppet editor](editors/puppets.md)** — a character's brains: stances,
  dialogue, subtitles.
- **[The cast editor](editors/casts.md)** — a character's body: poses as
  steps × directions.

### Reference

Lookup material: **[the glossary](glossary.md)**, **[builtin
commands](reference/builtins.md)**, **[tools](reference/tools.md)**,
**[the test inventory](reference/tests.md)**, **[the route](reference/route.md)**,
**[continuous integration](reference/ci.md)** and
**[releasing and deploying](reference/deploy.md)**.

### How the repository is arranged

Five npm workspaces, and the split these docs follow: **`engine/`** knows about
no particular game, **`site/`** is the shared web presence and the seven format
editors, and **`taoot/`**, **`dust/`** and **`timelapse/`** are a game each.
Dependencies point one way only and there is a test that says so. The map is
**[Engine architecture](engine/architecture.md)**.

## A note on licensing

The decoding logic in this project is ported from DFET, which is GPL-3.0, so
this project is GPL-3.0 too. The **game data is not included and is not
distributable** — it stays copyright CyberFlix and must come from your own
copy of the game. These docs describe formats; they do not ship assets.
