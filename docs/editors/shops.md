# The shop editor

[`editors/shops.html`](https://github.com/dhobi/taoot-web/blob/master/editors/shops.html) — source
[`editors/shp-editor.ts`](https://github.com/dhobi/taoot-web/blob/master/editors/shp-editor.ts).
Open `http://localhost:5173/editors/shops.html`.

Load a [SHP shop](../formats/shp.md) — the **props** drawn on top of a room:
`HOUSE.SHP`'s 44 ship-wide props (including the 135-state `door`),
`INVEN.SHP`'s items, a puzzle's switches — and it comes apart into the three
levels a shop has, group → state → frame.

## What it shows

| Part | What you can do with it |
|------|-------------------------|
| the **shop** | rename it. This one is a label: scripts open a shop by *filename* (`openshopfile("blkjack.shp")`) and reach a prop by its group name, so nothing resolves through it |
| a **prop** | pick one, rename it — this *is* what `sendtoprop`/`propvisible`/`propview` address — and see its script and container |
| its **states** | every named look, filterable (the ship-wide `door` has 135), each marked **still**, **animation** or **selector** — the distinction the format does not state outright and the runtime depends on: a selector's frames never play, `propdeg()` picks one of them by its stored degree |
| the **preview** | the 512×384 screen with the room view / UI band split drawn in. A prop draws at **anchor − stored offset**, and the anchor is what `propxy` moves — so the two anchor fields are that command, simulated: type `256,324` and the frame lands in the UI band where the watch does. **▶ Play state** plays the frames in their stored play order at the game's 50 ms, once, holding the last one, exactly as a prop animation does |
| a **frame** | its stored offset (Y before X, as everywhere), its `propdeg` degree, its packed size and its refScale; export it as a transparent PNG, or replace it |
| the **scripts** and **palette** | the shop main script and every prop's, decompiled on demand (read-only), and the file's own 256 colours |

## Two things the page is built to show

A **stored offset belongs to the frame container**, so changing it moves that
art in *every* state that references it — a shop reuses frames heavily.

A **degree belongs to the state's slot**, not to the art: the same frame
container reached through two states carries a degree in each, independently.

## Replacing art

Replacing art takes any image the browser can decode, matches its pixels to the
shop's palette (nearest RGB) and treats **alpha < 128 as transparent** — the
mask matters twice over, because a prop is a cut-out *and* its clicks are
hit-tested pixel-accurately against that mask. The frame's stored offset is
kept, so a replacement of a different size sits differently against its anchor;
the page says so when that happens.

## Exporting

**Export .shp** repacks the container file and downloads it. Every edit that is
not frame art is a copy-on-write patch on a single container (`patchShopRefName`,
`patchGroupName`, `patchStateIdentifier`, `patchFrameDegree`, `patchFrameAnchor`
in [`src/df/shp.ts`](https://github.com/dhobi/taoot-web/blob/master/src/df/shp.ts)),
so everything you did not touch is the byte it was
(see [`tests/auto/shp-editor.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/shp-editor.ts)).

That suite also pins the one case where the bytes and the view can disagree: a
state whose play-order table reverses its frames, where an edit made through the
reordered view has to land on the record that frame came from.

## See also

- [SHP — props ("shop" files)](../formats/shp.md) — what the structures are
- [The set editor](sets.md) — the room a prop is drawn on top of
- [The browser editors](README.md) — what the seven pages share

