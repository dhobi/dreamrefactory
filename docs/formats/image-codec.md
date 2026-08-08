# The image codec

*Prerequisite: [The DFile container format](README.md).*

Nearly every visible thing in the game — a room view, a movie frame, a prop, a
UI screen — is a **compressed image** stored in a container. This doc explains
how a compressed image becomes pixels, how colour works, and what the hidden
"depth" layer is for. SET, MOV, SHP and STG all reuse the machinery here, so
it's worth reading once.

Reference implementation: [`src/df/image.ts`](https://github.com/dhobi/taoot-web/blob/master/src/df/image.ts), ported
from DFET's `getRawImageData` in
[`DFfile.cpp`](https://github.com/M3tox/DFET/blob/main/libs/DFfile/DFfile.cpp).

## Indexed colour: pixels are palette lookups

The images don't store a red/green/blue value for every pixel. Instead each
pixel is a **single byte that's an index into a palette** — a table of up to
256 colours. This is classic 1990s "8-bit / 256-colour" graphics: it keeps
files small, and it's why the whole game can be recoloured just by swapping the
palette.

So decoding an image is two steps:

1. **Decompress** the container into one byte per pixel (the palette index).
2. **Colourise**: look each index up in the palette to get real RGB.

The decompressed intermediate — one index byte per pixel — is essentially an
8-bit bitmap.

### The palette

The palette lives in **container 0** of the file and is valid for the whole
file. On disk each entry is `{ int16 index, int16 red, int16 green, int16
blue }`, but only the **high byte** of each 16-bit colour channel is the
usable 0–255 value. `paletteToRGBA` turns the raw block into a 256-entry RGBA
table.

Two engine quirks the decoder reproduces (they come straight from DFET's
bitmap writer):

- **Index 0 is forced to black.**
- When a file uses all **256** colours, **index 255 is forced to white.**

And one SET-specific rule worth remembering: **SET room frames only use the
first 128 palette entries**; the full 256 are used for map/overview images.

## Why images are "delta-encoded" (and why order matters)

The compression is not just "shrink each picture independently." Many rows and
runs are encoded as **"same as the previous image"** — the codec copies pixels
from *whatever is already in the output buffer*. This is **delta encoding**:
each frame is described as the *difference* from the one before it.

The practical consequence:

> You must decode a sequence of frames **in order, into the same reused
> buffer.** Decode frame 5 on its own and you'll get garbage where it said
> "keep what was there before."

That's why the decoder centres on a persistent `FrameBuffer` that's handed
from frame to frame.

The sequence that matters is the **ring** — one scene's turn circle, one
direction of a road — and a ring turns out to need nothing before it: its first
frame repaints every pixel. Checked over the 20 largest sets, all 998 rings,
each decoded from a fresh buffer and from a deliberately poisoned one: every
frame byte-identical. So the viewer decodes a ring at a time, on demand, in any
order ([see the viewer](../runtime/host.md#setviewer-navigation-and-rendering)).

## How the decompression actually works

You do not need this section to *use* decoded images — skip it unless you're
debugging the codec. Here's the gist, in plain terms.

A frame container starts with its size:

| Offset | Type | Meaning |
|-------:|------|---------|
| +0 | i16 | height |
| +2 | i16 | width |
| +4 | … | compressed row data |

Then the image is built **one row at a time**. Each row begins with a small
**row-mode byte** that says where this row's baseline comes from — for example
"copy this row verbatim," "keep the same row from the previous image," or
"copy a row from a few rows up." (Concretely: the byte, shifted right by 2,
selects the mode; values map to copying a row from a computed offset, or
keeping the previous image's row.)

Within a row, pixels come in **runs**. Each run starts with a control byte:
its low 3 bits pick a **run mode**, the upper bits are a **count** (and if the
count is zero, the next byte extends it). The run modes are:

| Mode | What the run does |
|-----:|-------------------|
| 2 | keep these pixels from the previous image |
| 3 | copy from a computed earlier offset (previous rows) |
| 4 | repeat the last pixel |
| 5 | literal pixels — copy `count` bytes straight from the stream |
| 6 | fill with one given byte |
| 7 | copy from a back-reference offset given in the stream |
| 0 / 1 | **bit-packed deltas** — each pixel is a small +/- change from its neighbour, encoded in a sliding bit window |

**Back-references tile.** When mode 7's offset is *shorter* than its count, the
run overlaps what it is writing and the pattern repeats — LZ77-style, which is
what `rep movsb` does on the hardware this shipped on. Copying the source as it
stood before the write (a `memmove`, which is what JavaScript's `copyWithin`
gives you) duplicates the block once instead of tiling it. It is rare — four
runs in a whole walk down the boat deck — but a frame is the base for the next
one, so each mistake compounds down the chain: this was the coloured streaking
that appeared in the sky partway through a walk and never when standing still.

Modes 0/1 are the clever part: instead of storing whole pixel values, they
store tiny differences from the neighbouring pixel using a variable number of
bits, which is what makes smooth gradients compress so well. The exact bit
juggling is in [`image.ts`](https://github.com/dhobi/taoot-web/blob/master/src/df/image.ts); the takeaway is just
"small differences, few bits."

### Writing one back: the encoder

`encodeFrame` goes the other way, for the
[set editor](../editors/sets.md)'s PNG import. It uses none of
the "previous image" modes: every row declares the one-row lookback and is then
filled with copy-previous-row (mode 3), fill (mode 6) and literal (mode 5) runs,
so the frame it writes is **self-contained**. That is the point — a frame you
replaced by hand sits in the middle of a delta chain, and it must decode to your
picture no matter what the buffer held when the decoder reached it. The cost is
size: leaning on the predecessor is exactly how CyberFlix's own encoder got
small, so a re-encoded frame is bigger than the one it replaces. Any valid run
sequence decodes the same, so that is all it costs.

A Z layer, if the frame should keep one, is appended verbatim — see below.

## The Z layer: a hidden depth map

Because the world was originally rendered in 3D, many frames carry a **second
image after the colour data: a depth map** (a "Z layer"). It stores, for every
pixel, **how far away that pixel is** from the camera.

The engine uses it to decide whether a *moving* thing — a character walking
through the room — should be drawn or hidden at each pixel. If a chair is
closer to the camera than the character, the chair's pixels "win" and the
character is hidden behind it. This is the same idea as a Z-buffer in real 3D,
baked into the pre-rendered art.

The depth layer is stored compactly as a **row-offset table** followed by
**run-length runs** (`count` pixels of `value`), because depth tends to be
flat across big areas. The decoder fills `FrameBuffer.zPixels` when a frame
has one. If the container's bytes are used up after the colour data, there's
simply no Z layer for that frame.

The row-offset table's entries are relative to the table itself, which makes the
whole block position-independent: `DecodedFrame.zOffset` says where it starts,
and re-encoding a frame's *pixels* can hand those bytes straight to
`encodeFrame` to keep the depth image. It only lines up at the same width and
height, since the runs are laid out row by row against them.

## Colourising for the screen

Once you have indexed pixels + a palette, `indexedToRGBA` walks the pixels and
writes RGBA out for a canvas `ImageData`. Props do this slightly later than
backgrounds — they keep their indexed form and an "is this pixel opaque" mask,
and get colourised **through the active SET's palette at composite time**, so
the same prop art tints correctly in whatever room it appears in. See
[SHP](shp.md).

## Where this codec shows up

| Format | Uses the codec for |
|--------|--------------------|
| [SET](set.md) | room view backgrounds + their Z depth maps |
| [MOV](mov.md) | movie frames (same delta codec) |
| [SHP](shp.md) | prop frames (transparent variant) |
| [STG](stg.md) | full-screen UI / map images |

Next: see how the room world is assembled around these frames in
**[SET](set.md)**.
