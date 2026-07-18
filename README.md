# taoot-web

Browser port (work in progress) of the CyberFlix **DreamFactory 4.0** engine,
targeting *Titanic: Adventure Out of Time* (1996) — no DOSBox, a native
TypeScript reimplementation running on canvas.

## Status: Milestone 8 — stage layer (STG flats) & inventory

- `src/df/stg.ts` — STG reader: palette @56, flat table @2124 (46-byte
  records: script/image/click-logic containers per flat); flat images use
  the common frame codec. Container 1 is the stage's main script.
- Session stage state: `openstagefile`/`closestagefile`/`gotoflat`/
  `currentstage`/`currentflat`/`setvisible` builtins; flat scripts fire
  openflat/closeflat; MAIN.STG opens at startup (the boot does this).
- Rendering layers: flat image (512×384) as background, the set view
  composited into the top 512×264 when `setvisible`, props over everything
  with `propdist` z-order (more negative = closer). The UI band lives:
  lifesaver menu button, hand item, watch — all house.shp props.
- Input: props hit-test first (front-to-back, opaque-pixel accurate), then
  view hotspots, then flat script → stage script.
- Inventory: `addinven` (inven.shp) puts items in Frank's hand (owner
  "frank", shown in the band); boot's `transtoflat("inven1.stg")` swaps
  the stage (fade, save/restore stack) and the inven flat shows all owned
  items via their `moveyoself` handlers. `sendto*` targets now resolve
  session-wide (shops/flats/props before a set opens), and missing
  handlers on a sendto target fall back to the boot library with `me` =
  the target — that's how `initprop()`/`initprops()` initialize.
- boot() variable defaults (savestage1-3, handitem, …) are seeded at
  session start — scripts test them with `!= ""` under text comparison.
- Props placed with `propxyz` (bag/watch in the C73 world, turkwater) are
  world-space: coordinates are stored but the props are NOT drawn until
  world->screen projection is implemented — otherwise they'd pile up at
  their screen anchor in the middle of the UI band (user-reported).
  `propxy` returns a prop to screen space (pickup does this).
- Known gaps: no in-world pickup yet (needs the projection);
  `invenhelp` renders slightly misplaced.

## Milestone 7 — movies (MOV)

- `src/df/mov.ts` — MOV parser: 256-color palette, frame table @0x870
  (42-byte records, keyframe flag), frames in the SET delta codec; audio
  from the loop-chunk table (container 1) or, for play-once cutscene
  audio, the non-looping chunk block referenced at header +0x60 (42-byte
  records, 31-char names).
- Viewer movie mode: full-screen playback, input blocked while playing.
  With a soundtrack, frames pace themselves across its duration; without
  one, clicks step through (object close-ups — e.g. the Turkish-bath
  mirror with its baked-in OK button). Click also skips/advances.
- `playmovie` builtin → session hook (browser fetches the MOV on demand);
  boot's `spotmovie` helper (premovie/playmovie/postmovie) works through
  standard fallback resolution. `session.runGlobal(name, args)` invokes
  stage/boot library handlers the way unqualified calls resolve.
- **Click regions & jump targets**: the MOV frame-logic tables (@1090 in
  each frame's click-region container, 64-byte records, coords Y-first)
  define click regions with a pascal **event-sound name** @+16 (resolved
  in the movie's own named chunk table, banks as fallback) and a pascal
  **target frame name** @+48. Playback pauses on region frames (starting
  with the first — interactive movies open as a silent still). A click
  plays the region's sound, then: target that is itself a region frame →
  hard cut (menu zoom toggle); forward target — or no target with nothing
  ahead to pause on — → close the movie immediately (OK buttons; the
  trailing "exit animation" frames in the file are never played); backward
  or near no-target → animate to the next region frame (the endless
  curtain open/close toggle). Neither the i16 @+0 (hover cursor, probably)
  nor the i16 @+6 is behavioral; dfet's "action" reading was a red
  herring. Verified against MENU.MOV, TURKNMES.MOV and CURTAINS.MOV.
- Interactive movies never auto-play their audio chunks — those are the
  event sounds. Only regionless cutscenes play them as a soundtrack.
- Patch frames (e.g. the 350×353 curtain animation frames) already come
  out of the delta codec as full screens; the frame-table w/h + the two
  words @+4 are just the dirty rectangle, no compositing needed.
- **Per-frame event sounds**: a frame's logic container carries a pascal
  sound name at +0x12, fired when playback enters the frame (FAUCET.MOV:
  frame 2 `fon.SE`, frame 4 `Brook Babbling.`, frame 29 `foff.SE` — the
  water cycle turns itself off; the faucet is a "runs once" toy, not a
  toggle). Interactive movies pace at 145 ms/frame, measured from
  Brook Babbling (3.62 s) spanning exactly its 25 water frames.

## Milestone 6.5 — working doors & the real event model

Clicking a door now opens it (prop appears, `dooropen1-4` plays), and `↑`
through the open door travels to the next set. Fixes that made it work:

- **Shops are session-scoped**; the boot resources (`house.shp` with 44
  ship-wide props incl. the 135-state `door` prop, `inven.shp`,
  `inven.trk`/`unilib.trk`) load at session start, mirroring the boot
  script. `sendtoprop("door", …)` therefore hits the real prop script.
- **`sendtostage(call())` / `sendtoboot(call())`** take the deferred call as
  their only argument (target implicit).
- **Prop state animations play once and hold** (a door stays open); loops
  are scripted explicitly via `makeloop` (not yet implemented).
- **Props colorize through the ACTIVE SET's palette** (shared CLUT — the
  `clut`/`mixclut` commands exist for this); decoding is palette-independent
  (`ShpFrame.indexed` + `opaque` mask), colorized at composite time.
- **The real keyboard event model**: BOOTFILE's two script containers stay
  separate. Container 1's `keydown` routes to the current scene via
  `sendtoscene(currentscene(), keydown(arg))`; container 2's `keydown`
  implements the DEFAULT MOVEMENT via a setter form of `currentscene`
  (`"strait"` = walk, `"left"`/`"right"` = turn). Events run through the
  whole chain — normal end and `passcode` both forward — and only an
  `exitcode` anywhere consumes the event (sticky `interp.eventConsumed`).
  That's how a scene script suppresses the default walk when sending you
  through a door. Pointer events over hotspots resolve in the set-level
  chain (object → scene → main → stage) so boot defaults don't clobber the
  object's cursor.
- Mixed-type `=` compares as text (`"uparrow" = 0` must be false).
- **Doors close on navigation**: lifecycle events (`openset`/`closeset`,
  `openscene`/`closescene`) run through the same chain as keydown — boot's
  default `closescene` closes any open door via `sendtoprop("door",
  initprop())`, which plays the matching `doorclose1-4` in the door's own
  script. `closesetfile` implies a `closescene` for the departing scene, so
  props can't survive into the next set. Turning (view change within a
  scene) fires only the BOOT defaults of `closescene` — the door closes,
  but the scene script's own exit logic doesn't run on a mere turn.

## Milestone 6 — game session & cross-set travel

The ship is connected: walking through a door in one set loads the next set
and lands you at the scripted arrival view, with all game state intact.

- `src/engine/session.ts` — **GameSession**: one interpreter whose globals
  persist across sets, plus session-owned audio banks and props.
- **The boot script is the game's standard library.** BOOTFILE's script
  containers define ~76 globally callable handlers (`changeset`,
  `spotmovie`, `progress`, `setupactor`, …); MAIN.STG's main script defines
  `gotospecial`. Unqualified calls resolve local script → builtins →
  stage script → boot script (`Interpreter.fallbackScripts`).
- Set switching bottoms out in the engine primitives `opensetfile(name,
  scene, view)` / `closesetfile()` — now builtins that fire the proper
  `closeset`/`openset` lifecycle and reposition the viewer.
- The event chain is now complete: object → scene → set main → stage →
  boot → engine default; `keydown` (e.g. `"uparrow"`) goes through the
  chain before the default walk, so scripts can intercept movement.
- Extra builtins: `findword`, `currentscene`/`currentview`/`currentset`,
  transition names (`plain`, `wipeleft`, …) and screen-fade commands as
  stubs (visual polish later).
- **Regression suite**: `npm test` (tools/tests.ts) — 9 checks covering
  hotspots, road arrival, blackjack logic, audio, travel, props.

## Milestone 5 — audio

- `src/df/audio.ts` — both engine codecs ported: v40 (8-bit; literal /
  step-table-pair / repeat modes, generated 256-entry tables) and v41
  (16-bit; delta-or-absolute per byte). Bank reader for TRK/SFX/11K files:
  ordered loop chunks (music) + named one-shot chunks
  (`doorlocked` etc. — shared lines live in `UNILIB.TRK`).
- `src/engine/audio.ts` — three channels matching the command families
  (`sound`, `voice`, `theme`), `WebAudioSink` for the browser (created on
  first user gesture per autoplay policy), `NullAudioSink` for headless
  runs, and an `AudioLibrary` that resolves sound names across open banks
  with a decode cache.
- Builtins wired: `voicesound`, `singlesound`, `multiplesound`/`dualsound`
  (overlapping), `bothsound`, `haltsound`/`haltvoice`/`halttheme`,
  `sounddone`/`voicedone`, `playtheme` (looped concatenated loop-chunks),
  `opentrackfile`/`closetrackfile`.
- The viewer auto-opens `<set>.trk/.sfx/.11k` and `unilib.trk` from the
  file provider (drop them alongside the .SET) until the boot/stage layer
  owns bank management.
- Verified headless: clicking B59's locked door plays the 1.16 s
  `doorlocked` voice line; `tools/dumpaudio.ts` exports WAVs and waveform
  PNGs (`--find <name>` scans all banks for an identifier).

## Milestone 4 — props (SHP)

- `src/df/shp.ts` — SHP ("shop") loader: prop groups → named states →
  animation frames, plus the transparent-image codec (per-frame draw offsets
  in the header, Y before X).
- `src/engine/props.ts` — prop runtime: visibility/state/anchor driven by
  scripts, frame animation, alpha compositing into the view buffer.
- Builtins wired: `propexists/propvisible/propview/propxy/propowner/
  propvalue`, `openshopfile`/`closeshopfile` (via a FileProvider — drop the
  .SHP next to the .SET in the browser); a shop's `openshop` handler fires
  on load, prop group scripts join the `sendto*` target namespace.
- Placement rule (validated against corpus usage — mouse-dragged inventory
  props, blackjack cards, UI-band buttons): `screenPos = propxy − storedOffset`,
  anchor default (256,192) = centre of the original 512×384 screen; the
  512×264 view occupies its top rows.
- **Open item:** scene-embedded props (e.g. TURK `turkwater`) ignore that
  rule — empirically the faucet belongs at (302,88) on Scene109/View118
  (implied anchor (317,130) vs scripted propxy (256,192)); their state
  containers carry a flag the UI props lack, and placement presumably goes
  through the world→screen projection (`propxyz` exists for 3D positions).
  Needs the TI.EXE prop-draw routine (Ghidra).

## Milestone 3 — interactive hotspots

- Hotspot region fields in SET view objects are stored **Y-first**
  `(top, left, bottom, right)`; dfet's struct labels them X-first, which
  misplaced every hotspot (user-visible as a bottom-left offset).

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
