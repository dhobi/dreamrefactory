# taoot-web

Browser port (work in progress) of the CyberFlix **DreamFactory 4.0** engine,
targeting *Titanic: Adventure Out of Time* (1996) — no DOSBox, a native
TypeScript reimplementation running on canvas.

## Status: Milestone 1 — SET viewer

Load original `.SET` files and walk the ship: pre-rendered views, animated
turning (left/right ring frames), and walking roads between scenes.

```
npm install
npm run dev          # then drop e.g. gamefiles/LOCAL/B59.SET onto the page
```

Controls: `←`/`→` turn, `↑` walk a road, `M` deck-plan map, `O` hotspot overlay.

CLI verification tools (dump structure + frames as PNG, headless navigation):

```
npm run dump -- gamefiles/LOCAL/B59.SET out/
npx tsx tools/navtest.ts gamefiles/LOCAL/B59.SET out/
```

## Layout

- `src/df/` — DreamFactory file format library (TypeScript port of the
  decoding logic in [DFET](https://github.com/M3tox/DFET), GPL-3.0):
  - `container.ts` — the common container/block structure of all DF files
  - `image.ts` — frame decompression (delta-encoded RLE) + Z-depth layer, palette
  - `set.ts` — SET structures: scenes, views, turn rings, roads, actors, hotspots
- `src/viewer.ts` — navigation state machine + rendering
- `tools/` — Node-side dump/verification tools
- `gamefiles/` — original game data (not distributable; user-supplied)
- `dfet/` — reference C++ extraction tool (GPL-3.0, by M3tox)

## Format notes learned so far

- All DF files: 1024-byte header, container-position table, containers of
  `{id, size, data}`. Integers little-endian; doubles/floats **big-endian**.
- SET frames are **delta-encoded against the previously decoded frame**
  (row param 10 and run mode 2 mean "keep previous image") — sequences must
  be decoded in order. The viewer pre-decodes in DFET's extraction order and
  caches indexed snapshots per container.
- SET files use the first 128 palette entries for frames, all 256 for maps.
- Turn-ring `FrameInfo.viewID` is a *scene-local* view index; road
  `viewIDstart/viewIDend` are *global* view IDs.
- Standpoint frames: `motionInfo` 1 (low-res) / 2 (hi-res); `motionInfo` 0 =
  in-motion frame between standpoints.

## Licensing

The decoder is a port of GPL-3.0 code (DFET), so this project is GPL-3.0.
Game assets remain copyright CyberFlix Incorporated and must be supplied by
the user from their own copy.
