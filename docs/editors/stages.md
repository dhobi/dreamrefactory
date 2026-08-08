# The stage editor

[`editors/stages.html`](https://github.com/dhobi/taoot-web/blob/master/editors/stages.html) — source
[`editors/stg-editor.ts`](https://github.com/dhobi/taoot-web/blob/master/editors/stg-editor.ts).
Open `http://localhost:5173/editors/stages.html`.

Load a [STG stage](../formats/stg.md) — the screens that are not rooms: the UI
band (`MAIN.STG`), the inventory (`INVEN1.STG`), the deck plan (`MAP.STG`), a
mini-game board (`BLKJACK.STG`) — and it comes apart into its flats.

## What it shows

| Part | What you can do with it |
|------|-------------------------|
| a **flat** | pick one, see its full-screen art, and rename it. Unlike the shop's name this one *is* a lookup key — `gotoflat`/`transtoflat` ask for it and `currentflat()` answers it — so the scripts that call for a flat have to be renamed with it |
| its **regions** | the clickable "buttons" `sendtobutton`/`pointinbutton` reach, drawn over the picture with their names: rename one, or move/resize its rectangle by its four edges and watch the overlay follow. The rectangles are stored top/left/bottom/right and shown x-first, in screen pixels, because a flat *is* the whole screen |
| the **art** | export it as a PNG or replace it. A flat is self-contained (nothing delta-codes against it), so unlike a SET frame there is no ring to keep consistent |
| the **scripts** and **palette** | the stage main script (container 1 by convention — `MAIN.STG`'s defines the game-wide `gotospecial`), every flat's, and every region's on the selected flat, decompiled on demand; plus all 256 colours, which a full-screen flat uses where a room view uses 128 |

A flat with no click-logic container has nothing clickable on it, and the page
says that rather than showing an empty list.

## Exporting

**Export .stg** repacks the container file and downloads it. The three edits that
are not art are copy-on-write patches on a single container each — the flat names
in container 0's flat table, a region's name and rectangle in that flat's
click-logic container (`patchFlatName`, `patchRegionName`, `patchRegionRect` in
[`src/df/stg.ts`](https://github.com/dhobi/taoot-web/blob/master/src/df/stg.ts))
— so everything you did not touch is the byte it was
(see [`tests/auto/stg-editor.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/stg-editor.ts)).

## The stage this port wrote itself

One entry in the file picker is not CyberFlix's: **`lang.stg`**, the language
chooser (`npm run mklang` builds it; it ships in `public/`, which the dev server
lists alongside `gamefiles/`). It is a good thing to open here, because it is the
whole round trip in one file — a stage this repository *wrote*, with two flats, six
click regions and a compiled `mousedown` handler each, which the editor reads like
any other. Restyle its art by PNG import, nudge the button rectangles, export, drop
the result over `public/lang.stg`, and the game still boots into it: the click
regions are where the chooser reads its layout from, so the dimming of
uninstalled languages follows whatever you moved.

That is also the honest fix for the one thing the generator cannot do — its 5×8
pixel font has no Cyrillic or CJK, so `Русский` and `日本語` are drawn as
`RUSSIAN` and `JAPANESE` until someone imports art with a real font.

See [writing a stage](../formats/stg.md#writing-a-stage) for the builder, and
[Languages & the chooser](../runtime/languages.md) for what the file does at
runtime.

## See also

- [STG — stage files & the UI](../formats/stg.md) — what the structures are
- [Stage & UI](../runtime/stage-ui.md) — how the runtime drives flats and overlays
- [The browser editors](README.md) — what the seven pages share
- [Languages & the chooser](../runtime/languages.md) — `lang.stg`, the stage this
  repository authored

