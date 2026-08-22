# The set editor

[`editors/sets.html`](https://github.com/dhobi/dreamrefactory/blob/master/editors/sets.html) — source
[`editors/set-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/editors/set-editor.ts).
Open `http://localhost:5173/editors/sets.html`.

The editor for the format the game spends most of its time in. Load a
[SET room](../engine/formats/set.md) — by upload, drag-and-drop, or from the
`gamefiles/` manifest — and it opens on the standpoint and facing the set
itself starts on, taken apart into the pieces a room is made of.

## What it shows

| Part | What you can do with it |
|------|-------------------------|
| the **set** | rename it — what a script's `changeset` asks for — and choose the scene/view a fresh load starts on, picked from the standpoints the set actually has |
| a **scene** and its **views** | pick a scene, see every direction you can face from it with its rotation, camera height and standpoint frame, and rename either. **▶ Play turn** turns right the way the game does — the ring's frames at 50 ms each — and lands on the standpoint the ring ends at |
| the **hotspots** | the clickable regions of the selected view, drawn over the picture: rename one, or move/resize its rectangle by its four corners and watch the overlay follow. The rectangles are stored top/left/bottom/right and shown x-first |
| the **frames** | both turn rings as thumbnails, standpoints marked; pick one to see it full size with its camera pose, export it as a PNG, or replace it |
| the **roads** | rename a road, see the global view ids it joins and its waypoints, and walk it in either direction in the preview |
| the **actor marks** | the stars a script's `walkonpath`/`placestar` reaches by name — including the *secondary* star nested in a record's tail — with their rotation and position |
| the **maps**, **scripts** and **palette** | both deck-plan images (exportable as PNGs), every script in the set decompiled on demand (read-only), and the palette with the 128 entries the view frames use marked inside the 256 the maps and props share |

## Replacing a frame's art

Replacing a frame takes any image the browser can decode, matches its pixels to
the set's view palette (nearest RGB over those first 128 entries) and re-encodes
it with `encodeFrame` in
[`engine/src/df/image.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/image.ts).
Two things follow from what that codec is.

Frames are *delta-encoded* against the frame before them, so a replacement is
written **self-contained** — every row stands on its own — which decodes
identically but is bigger than CyberFlix's own encoding of the same picture.

And the **Z layer** (the depth image that hides an actor behind the scenery in
front of it) is carried over from the frame being replaced, which only works at
the same width and height — a differently-sized import drops it, and the page
says so.

## Exporting

**Export .set** repacks the container file and downloads it. Every edit that is
not frame art is a copy-on-write patch on a single register or table container
(`patchSetName`, `patchDefaultStart`, `patchSceneName`, `patchViewName`,
`patchObjectIdentifier`, `patchObjectRegion`, `patchActor`,
`patchTransitionName` in
[`engine/src/df/set-patch.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/set-patch.ts)
— a module of its own, so the reader the *runtime* loads carries none of the write
path),
so everything you did not touch is the byte it was
(see [`taoot/tests/auto/set-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/tests/auto/set-editor.ts)).

## See also

- [SET — rooms, scenes & views](../engine/formats/set.md) — what the structures are
- [The image codec](../engine/formats/image-codec.md) — what the frame encoder does
- [The browser editors](README.md) — what the seven pages share

