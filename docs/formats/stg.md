# STG — stage files & the UI

*Prerequisite: [The DFile container format](README.md) and
[The image codec](image-codec.md).*

A **STG** ("stage") file holds full-screen **screens** and the on-screen UI —
anything that isn't a walkable room. The deck-plan map, the inventory screen,
the mini-game boards, and the bottom **UI band** all come from STG files, each
paired with its scripts.

Reference implementation: [`src/df/stg.ts`](https://github.com/dhobi/taoot-web/blob/master/src/df/stg.ts) (decoding) and
the stage handling in [`src/engine/session.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/session.ts).

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

## How STG fits the render stack

From [engine architecture](../02-engine-architecture.md), the screen is built
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
in the band).

## Stage builtins

The session exposes the stage layer to scripts through builtins:
`openstagefile` / `closestagefile`, `gotoflat`, `currentstage` /
`currentflat`, `setvisible` (a setter), plus prop-query helpers used by the
inventory and shops (`propdist`, `countprops`, `indextoprop`, `sendtoshopfx`).

Input hit-testing order on a stage: **props first** (front-to-back,
opaque-pixel accurate), then view hotspots, then the **flat script**, then the
**stage main script** — the same "specific thing wins, then fall back" pattern
as everywhere else.

## Not just UI — mini-games too

Mini-game boards live in STG files as well. The blackjack game's real
`winner()` logic, for example, runs out of the original `BLKJACK.STG` script —
which is how the interpreter was first validated (8/8 rule checks against the
shipped binary).

Next: sound — **[Audio (TRK / SFX / 11K / SND)](audio.md)**.
