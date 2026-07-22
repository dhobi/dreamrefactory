# Titanic: Adventure Out of Time (RE)

Browser port (work in progress) of the CyberFlix **DreamFactory 4.0** engine,
targeting *Titanic: Adventure Out of Time* (1996) — no DOSBox, a native
TypeScript reimplementation running on canvas.

> 📖 **New here? Read the docs: <https://dhobi.github.io/taoot-web/>** — a
> guided tour from "how the game works" down to each DFile container format,
> written for readers who haven't done low-level reverse engineering. (Source
> in [`docs/`](docs/README.md).)

## Running

```
npm install
npm run dev          # dev server lists all sets from gamefiles/ — click one
```

In dev mode the page shows every `.SET` found under `gamefiles/` (via the
`/api/gamefiles` manifest in [vite.config.ts](vite.config.ts)); picking one
lazy-loads it plus its siblings (`.shp`, `.trk`, `.sfx`, `.11k`,
`unilib.trk`) over HTTP, and anything scripts request later
(`openshopfile("blkjack.shp")`) is fetched on demand in the background.
This is dev-server-only — production builds don't bundle or serve game
files; there, drag-and-drop remains the way in.

Controls: `←`/`→` turn, `↑` walk a road, `M` deck-plan map, `O` hotspot overlay.

## Tests

```
npm test             # vitest run (tests/regression.ts, tests/interp.ts)
npm run test:watch   # vitest in watch mode
```

The suite is headless and file-based (Node environment, no DOM). The other
files under `tests/` are corpus/inspection scripts run directly with `tsx`,
not part of the vitest run:

```
npx tsx tests/nav.ts gamefiles/LOCAL/B59.SET out/   # headless navigation dump
npx tsx tests/parse.ts                              # script AST coverage
# tests/browser.ts needs a live dev server
```

CLI verification tool (dump structure + frames as PNG):

```
npm run dump -- gamefiles/LOCAL/B59.SET out/
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

For the file-format details (the DFile container skeleton, the image codec,
SET/SHP/MOV/STG structures, audio codecs, and the script container), see the
[format docs](docs/formats/README.md).

## Licensing

The decoder is a port of GPL-3.0 code (DFET), so this project is GPL-3.0.
Game assets remain copyright CyberFlix Incorporated and must be supplied by
the user from their own copy.
