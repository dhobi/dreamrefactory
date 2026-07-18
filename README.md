# taoot-web

Browser port (work in progress) of the CyberFlix **DreamFactory 4.0** engine,
targeting *Titanic: Adventure Out of Time* (1996) — no DOSBox, a native
TypeScript reimplementation running on canvas.

## Status: Milestone 3 — interactive hotspots

The interpreter is wired into the SET viewer:

- `src/engine/setscripts.ts` binds a SET's scripts (main, per-scene,
  per-view-object) to interpreter instances and dispatches events along the
  original engine's chain: **object script → scene script → set main script
  → engine default**, where `passcode` (or a missing handler) forwards.
- Events fired: `openset`/`closeset`, `openscene`/`closescene`, `mousedown`
  (canvas click on a hotspot region), `setcursor` (hover; the `cursor(..)`
  builtin's answer maps to a CSS cursor).
- `sendto*` commands are implemented as **special forms**: the second
  argument is a deferred call executed in the *target's* script context
  (`sendtoprop ("door", setupprop ("b59-hallb"))`), not evaluated locally.
  Targets resolve within the loaded set; props/stages/puppets from other
  files log until those loaders exist.
- Road-arrival fix: a walk register's `destination` field is the container
  index of the arrival scene's **view table**; the arrival *view* is chosen
  by matching the last walked frame's camera angle (`axisX`) against the
  scene's view rotations — the road's endpoint view ID faces *back* along
  the road and must not be used for arrival facing.
- The script log panel below the canvas shows script activity, including
  calls whose semantics aren't implemented yet (`? name(args)`).

## Milestone 2 — script layer

The DreamFactory script system is decoded, parsed, and executing:

- `src/df/script.ts` — script container decoder + decompiler (full 351-command
  opcode table, validated byte-for-byte against the name→ID table inside
  TI.EXE at `.data:0x45bxxx`, 6-byte records `{char* name, u16 id}`)
- `src/engine/parser.ts` — token stream → AST; parses **100%** of the 578
  script containers (1,631 `code` blocks) in the shipped game files,
  including original-compiler quirks: `//` comment lines tokenized as two
  division ops, unterminated blocks, dead statements before the first
  `case`, and bare-identifier typo lines (`reutrn`)
- `src/engine/interp.ts` — interpreter core: scopes (global/local),
  operators (`@` = string concat, `&`/`|` short-circuit logic, case-
  insensitive string `=`), control flow, `code` handler dispatch with
  `me`/`target` context and `exitcode`/`passcode`/`return` signals, and a
  builtin registry where per-command semantics are filled in as recovered
- verified by `tools/interptest.ts`: runs the blackjack minigame's real
  `winner()` logic from the original binary `BLKJACK.STG` — 8/8 rule
  checks pass

Event model (observed from the corpus): every object (set, scene, prop,
puppet, stage, boot) owns a script whose named `code` handlers receive
engine events — `openset`, `closeset`, `mousedown`, `setcursor`, `idle` …
`exitcode` = handled; `passcode` = fall through to the engine default;
`sendto*("name", handler(args))` invokes a handler in another object's
script (deferred call, evaluated in the target's context).

Corpus tools: `tools/dumpscripts.ts` (decompile everything + opcode
frequency), `tools/parsecheck.ts` (AST coverage), `tools/exetable.ts`
(extract the command table from TI.EXE).

## Milestone 1 — SET viewer

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
