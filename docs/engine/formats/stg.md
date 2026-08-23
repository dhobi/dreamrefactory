# STG — stage files & the UI

*Prerequisite: [The DFile container format](README.md) and
[The image codec](image-codec.md).*

A **STG** ("stage") file holds full-screen **screens** and the on-screen UI —
anything that isn't a walkable room. The deck-plan map, the inventory screen,
the mini-game boards, and the bottom **UI band** all come from STG files, each
paired with its scripts.

Reference implementation: [`engine/src/df/stg.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/stg.ts) (decoding) and
[`engine/src/runtime/stage.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/stage.ts)
(`StageController` — the runtime). This page covers the file; the runtime
behaviour built on it — lifecycle conventions, the overlay stack behind the
inventory, the exact click order — is in
**[Stage & UI at runtime](../runtime/stage-ui.md)**.

## Flats: full-screen background images

A STG's screens are called **flats** — a flat is a **512×384 full-screen
image** plus its scripts and click regions. `MAIN.STG` is the always-present
stage: its flat image is the background the UI band sits on, and its main
script (container 1) defines `gotospecial` — a core travel routine used
game-wide.

## What's in the file

| Where | Contents |
|-------|----------|
| Palette @ `56` | the colour table for this file |
| Container 1 | the stage's **main script** |
| Flat table @ `2124` | one **46-byte record per flat** — pointers to that flat's script, image, and click-logic containers |
| Image containers | flat images, in the common [image codec](image-codec.md) |

Each flat, when shown, fires `openflat` / `closeflat` events on its script,
mirroring the `openscene`/`closescene` pattern for rooms.

One flat record, field by field:

<ByteMap layout="stg-flat-record" />

And a whole stage — `LANG.STG`, [the language chooser](../../taoot/languages.md)
this project wrote from nothing, which is also the one DF file that ships in this
repository. Two flats, and the picture each one draws is nearly all of it:

<ByteMap map="lang.stg" />

## How STG fits the render stack

From [engine architecture](../architecture.md), the screen is built
back-to-front, and STG is the **bottom layer**:

```
┌────────────────────────────────┐
│  SET view (top 512×264)         │  ← composited in when "set visible"
├────────────────────────────────┤
│  UI band: menu · held item ·    │  ← STG flat image + house.shp props
│  watch                          │
└────────────────────────────────┘
```

- The **flat image** is the background for the whole 512×384 frame.
- When a set is visible, the room view is composited into the top 512×264.
- **Props** (from SHP) are drawn on top, z-ordered by depth (`propdist` —
  *more negative = nearer the front*; inventory items sit in front of the
  band).

A **full-screen** flat (the map, the inventory) calls `setvisible(false)` so
the room view is hidden and the flat fills the screen.

## The UI band and inventory

The bottom band's furniture — the lifesaver menu button, the currently held
item, the watch — are **`house.shp` props** drawn over `MAIN.STG`'s flat, at
fixed screen positions.

The inventory works by **swapping the stage**: the boot routine
`transtoflat("inven1.stg")` fades out, saves the current stage on a stack,
switches to the inventory flat, and shows every owned item via that item's
`moveyoself` handler. `transfromflat` reverses it. Adding an item
(`addinven`, from `inven.shp`) puts it in Frank's hand (owner `"frank"`, shown
in the band). The stack — and everything else that has to happen for a
mid-puzzle overlay to come back to the exact screen it covered — is the
runtime's job: **[the overlay stack](../runtime/stage-ui.md#the-overlay-stack-transtoflat-transfromflat)**.

## Stage builtins and the click order

Scripts drive the stage layer through the `openstagefile` / `closestagefile`,
`gotoflat`, `currentstage` / `currentflat`, `setvisible` family — the full
list is in the **[builtin reference](../../reference/builtins.md#scene-stage-screen-—-scene-ts)**.
Who gets a click first on a stage (props vs regions vs scripts) has real
subtleties; see **[the click order](../runtime/stage-ui.md#who-gets-the-click-the-full-order)**.

## Writing a stage

Reading a format well enough is one claim; writing one the engine cannot tell from
a shipped file is a stronger one. Every format here has a builder now
([the write path](README.md#writing-one-back)); a stage needs two of them:

- **[`engine/src/df/stg-build.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/stg-build.ts)**
  — `buildStgFile({ palette, main, flats })` lays out container 0 (palette at 56,
  flat table at 2124), the main script at container 1, and per flat a script, an
  [`encodeFrame`](image-codec.md) image and a click-logic container of 32-byte
  region records.
- **`encodeScript`** in
  [`engine/src/df/script.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/script.ts),
  with the assembler in `script-asm.ts` on top of it — source text in, the 8-byte
  segment stream plus its string pool out (see
  [the script container](script-container.md#writing-one-back)).

So a flat's buttons can be authored as script:

```
code mousedown()
	global taootlang
	taootlang = "de"
	gotoflat("wait")
endcode
```

The port's own **language chooser** (`public/lang.stg`, built by
`npm run mklang`) is exactly this and nothing more — two flats, six click regions,
a compiled handler each — and the engine opens it with `openstagefile` like any
CyberFlix stage. What it does with the choice, and why a script global rather than
a builtin, is in **[Languages & the chooser](../../taoot/languages.md)**.

The same builder makes the fixture the stage editor's tests are checked against,
which is the point: read → edit → write is verified against a file the library
itself produced.

## The same file in Dust — `.FLT`

Dust calls a stage a **flat file** and its boot says `openstagefile("new.flt")` —
the same builtin, a renamed extension — and the model underneath is the same one:
flats, each with a script, a picture and a table of clickable regions. So one
reader takes both, and `NEW.FLT` maps with the same labels a `.STG` does:

<ByteMap map="new.flt" />

What differs is where the fields sit (palette at `0x24` rather than `0x38`, a
28-byte flat record rather than 46) and what v4 added: a v1 flat record carries no
condition, width or height, so a v1 flat is reported at the stage's own screen
size — which is what it is, 512×384, for every flat on the disc.

## Not just UI — mini-games too

Mini-game boards live in STG files as well. The blackjack game's real
`winner()` logic, for example, runs out of the original `BLKJACK.STG` script —
which is how the interpreter was first validated (8/8 rule checks against the
shipped binary).

## Related tools

- **[the stage editor](../../editors/stages.md)** (`/editors/stages.html`)
  — every flat of a STG in a browser page, its art with the click regions drawn
  over it, and the flat/region names and rectangles editable.
- `taoot/tools/mapjumps.ts` — reads `MAP.STG`'s regions to recover where each deck-plan
  hotspot jumps to.

Next: sound — **[Audio (TRK / SFX / 11K / SND)](audio.md)**.
