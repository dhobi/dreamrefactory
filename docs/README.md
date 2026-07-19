# taoot-web documentation

This folder explains how *Titanic: Adventure Out of Time* (TAOOT) is put
together and how this project turns the original 1996 game files into
something that runs in a browser — **no DOSBox, no emulator**, a fresh
reimplementation of CyberFlix's **DreamFactory 4.0** engine in TypeScript.

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
   and it's incremental, one command at a time, still far from complete.
   Whenever a doc says "recovered from `TI.EXE`", that's what it means.
4. **The game files themselves** — a lot was simply confirmed by decoding a
   file and checking the result against what the real game shows.

## Reading order

Start at the top and go down. Each doc assumes you've read the ones above it.

### Concepts — how the whole thing works

1. **[How the game works](01-how-the-game-works.md)** — the big picture.
   What a "pre-rendered adventure on rails" actually is, and what happens
   from the moment you launch the game to walking around and clicking on
   things. Read this first.
2. **[Engine architecture](02-engine-architecture.md)** — how *this project*
   is organised: the file-reading layer, the runtime engine, the render
   loop, and how a mouse click travels through the system.
3. **[The scripting language](03-scripting-language.md)** — the game is
   mostly *scripted*, not hard-coded. This explains DreamFactory's little
   scripting language, the event model (`openset`, `mousedown`, …), and how
   the interpreter runs it.

### File formats — the DFile containers

All game data lives in "DFile" container files. Read the foundation doc
first; every format doc after it builds on it.

4. **[The DFile container format](formats/README.md)** — the shared skeleton
   *every* DreamFactory file uses. **Read this before any specific format.**
5. **[The image codec](formats/image-codec.md)** — how a compressed picture
   (a room view, a movie frame, a prop) turns back into pixels, plus how
   colour palettes and depth maps work.
6. **[SET — rooms, scenes & views](formats/set.md)** — the pre-rendered
   world you walk around in.
7. **[SHP — props ("shop" files)](formats/shp.md)** — the things drawn on top
   of the world: doors, items, buttons.
8. **[MOV — movies & inspectable objects](formats/mov.md)** — cutscenes and
   click-through close-ups.
9. **[STG — stage files & the UI](formats/stg.md)** — full-screen screens
   like the deck map, the inventory, and the on-screen UI band.
10. **[Audio — TRK / SFX / 11K / SND](formats/audio.md)** — music, sound
    effects and voice lines, and the two custom compression codecs.
11. **[BOOTFILE — the game's startup & standard library](formats/bootfile.md)**
    — the script bundle that boots the game and defines its shared behaviour.
12. **[The script container on disk](formats/script-container.md)** — the
    binary layout of a compiled script, for when you want to go deep.
13. **[PUP & CST — characters ("puppets")](formats/pup-cst.md)** — dialogue,
    facial animation and character sprites. *(Documented from DFET; not yet
    ported.)*

## A note on licensing

The decoding logic in this project is ported from DFET, which is GPL-3.0, so
this project is GPL-3.0 too. The **game data is not included and is not
distributable** — it stays copyright CyberFlix and must come from your own
copy of the game. These docs describe formats; they do not ship assets.
