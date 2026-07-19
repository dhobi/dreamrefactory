# Titanic: Adventure Out of Time (RE)

Browser port (work in progress) of the CyberFlix **DreamFactory 4.0** engine,
targeting *Titanic: Adventure Out of Time* (1996) — no DOSBox, a native
TypeScript reimplementation running on canvas.

> 📖 **New here? Read the docs: <https://dhobi.github.io/taoot-web/>** — a
> guided tour from "how the game works" down to each DFile container format,
> written for readers who haven't done low-level reverse engineering. (Source
> in [`docs/`](docs/README.md).) The sections below are the chronological
> milestone log.

## Status: Milestone 11 (in progress) — actors & puppets (CST/PUP)

Checkpoint 4: **they walk** — scripted actor movement.

- A correction to the milestone-10 notes: the 16-slot table at 0x48b970
  is the *walk* table, and the fn with the five-type dispatch is the
  walk mover (star/xyz/path/road/frames), not the cricket service.
- `walktostar`/`walktoxyz`/`walkonpath` move an actor in a straight
  line at their per-set `actorspeed`, facing the direction of travel,
  cycling the walk pose, snapping to the target and returning to
  "stand" on arrival. `iswalk`/`stopwalk`/`pausewalk` and the
  `actorstar` getter round out the cast library's needs (`endwalk`
  spins `while iswalk(...) forceupdate()` — the service advances, so
  it terminates).
- The per-step pace constant is feel-calibrated (the exact TI stepping
  math is still unrecovered); waypoint paths currently walk straight.
- Morrow strolls between his three promenade stars (test 19 +
  Chromium).

Checkpoint 3: **they speak with moving lips** — animLogic playback.

- Each dialogue line's animation-logic container decodes to 82-byte
  records, one per ~33 ms tick: a 16-byte header plus 11 layer triplets
  `{frame, anchorY, anchorX}` (frame −1 hides the layer). The anchors
  were the missing piece — every layer lands exactly where it belongs,
  gestures included, and the composite needs no heuristics at all.
- `puppetspeak` now runs the records at ~30/s alongside the voice: lip
  sync, blinks, brow raises, hand gestures. The last record persists as
  the idle pose between lines. (TI queues up to 3 lines and drains from
  the pump; our blocking version is order-equivalent.)
- Verified by frame-capturing mid-speech in Chromium: the mouth opens
  and closes with the line.

Checkpoint 2: **conversations work** — PUP dialogue plays end-to-end.

- The actor draw is now TI-exact (fn 0x411235): k = actorscale ×
  frame-record ref (96) / (1000 × depth), and the sprite direction uses
  the actor's facing relative to the **bearing from the camera to the
  actor** (fn 0x4446d0) — which side of a person you see depends on
  where you stand. Depicted angles are direction × 32 in the 0..255
  angle space.
- `src/df/pup.ts` — PUP reader: dialogue table (each line = voice
  audio + subtitle text + animation-logic container, addressed by ident
  from `puppetspeak`), conversation scripts, and layered stances
  (backdrop, body, head + face-part/gesture overlay layers).
- Puppet mode: `openpuppetfile` switches the display to the close-up;
  `puppetspeak` suspends the script for the line's duration (voice +
  subtitle, click to skip); `puppetbevel`/`puppetevent` build modal
  choice menus — the async interpreter makes the blocking waits
  natural. Conversation flow: click actor → cast script → `runpuppet`
  → the PUP's "Boot Script" drives everything.
- Render facts: a stance background that decodes to one flat colour is
  a key-colour matte (the live scene stays visible behind the
  character); the eyes/eyebrows/nose/jaw and arm layers are animation
  overlays — the head layer holds the complete neutral face.
- Verified: the full first Smethells conversation — three spoken lines
  with subtitles, a choice menu, branching, a second choice round —
  headless (test 18) and in Chromium.
- Next: animLogic playback (lip sync, blinks, gestures), walk
  animation, `puppetbase` stance selection.

Checkpoint 1: **the cast walks aboard** — CST cast files parse and static
characters render in the world.

- `src/df/cst.ts` — CST reader: 25 story characters in GANG.CST, each
  with a script and named pose sets ("stand"/"standlj"/"walk"…) of
  sprite frames in the familiar SHP transparent codec, **8 view
  directions per animation step** (walk = 10 steps × 8 dirs).
- `src/engine/actors.ts` — ActorRuntime mirrors the prop runtime:
  world-positioned, set-bound, drawn through the TI.EXE projection;
  the sprite direction is picked from the actor's facing relative to
  the camera. Clicking an actor runs their cast script's `mousedown`;
  hovering shows the "talk" cursor.
- The script chain does the rest with no special casing: DECKBD's
  `openset` calls `sendtoactor("morrow", setupactor("deckbd"))`, the
  character's own script places him on star `morrow.1`, and `stdactor`
  in the cast main script (reached via the shop-main-style parent
  chain) applies per-set standards.
- Two data quirks fixed along the way: DreamFactory `switch` uses
  stacked case labels sharing one body (the interpreter now falls
  through empty cases — `stdscale` returned 0 for every deck set
  before); and DECKBD.SET's internal name field says "decka", so the
  canonical set identity is now the opened *file* name.
- The B and D decks interleave: several DECKBD scenes forward straight
  to DECKA from `openscene`, exactly like the grand-staircase deck
  flips.
- OPEN: the actor draw-scale formula. Per-set `actorscale` values span
  900 (decks) to 30000 (cabins), compensating per-set world-unit
  scales; the current constant renders people somewhat small. Needs
  the actor draw fn from TI.EXE — same treatment the projection got.
- Next: walk animation, then PUP dialogue (talking-head close-ups with
  voice + subtitles + lip-sync layers — the format is already mapped).

## Milestone 10 — the timing model (delay, ambient loops, crickets)

The engine's whole notion of time, recovered from TI.EXE: **1 script tick
= 1/60 s** (`delay(n)` waits n×50/3 ms against `timeGetTime`), while
ambient loops and crickets are serviced on a **66 ms (~15 Hz) heartbeat**
— the same cadence as the screen fades.

- **The interpreter is async now.** `delay(n)` suspends the running
  script on the game clock while rendering, animation and audio keep
  going; input is blocked (`viewer.busy`) until the script resumes.
  Every dispatch is tracked on the session (`session.settle()` for
  tests).
- **`makeloop(kind, obj, handler, n)` is a one-shot, not a loop** (fn
  0x4424e0, 32-slot table): the countdown decrements per 66 ms step, at
  zero the slot removes itself and fires `sendto<kind>(obj, handler())`
  once — persistent behaviors re-arm themselves inside their handler.
  Identity is (kind, obj): re-making replaces; `stoploop(kind, "all")`
  clears a kind; `pauseloop` freezes the countdown. Kinds: actor 1,
  prop 2, scene 3, flat 4.
- **`makecricket(sound, x, y, radius, base, jitter)`** (fn 0x443cc0,
  16 slots) is a positional ambient one-shot bound to the current set:
  countdown = base + random(jitter) (jitter −1 → fire once and vanish),
  2D distance to the camera scales volume (linear falloff — the exact
  TI curve is unrecovered), bearing vs. camera facing drives stereo pan,
  and a cricket never re-fires while its previous play is still
  sounding — which is how `(0,0)` makes a seamless loop and `(200,200)`
  an occasional steam hiss.
- **`starxyz(name, axis)`** reads the set's *actor register* — the
  "stars" are named world points (C73: "buzzer" at 3787,1251) and the
  table we already parsed as actors is exactly TI.EXE's star table.
- `soundloop(name, on)` toggles a named looping ambient;
  `forceupdate()` runs a service step immediately.
- End-to-end: C73's `openset` arms `makeloop("scene","scene49",
  "smethknock",300)`; ~20 s later Smethells knocks — a one-shot cricket
  at the buzzer's star position (volume 0.95, panned left), the cricket
  vanishes, the loop re-arms at 60+random(180). Verified headless and
  in real Chromium.
- The async interpreter has no call-stack limit, so dispatch cycles in
  game data now OOM instead of throwing (TURK's scene134 has a script
  without `keydown`; resolving the missing handler back into the boot
  library recursed forever). Fix: sendto missing-handler fallback
  resolves through the target's containment only (shop main → stage),
  plus a hard dispatch-depth cap (64) that turns any future cycle into
  a logged script error.

## Milestone 9 — world-space props (the TI.EXE projection)

The engine's world→screen projection is recovered from TI.EXE (fn
0x43a970, reached via the command dispatch jump tables at 0x4269f8):

    dx,dy,dz = prop − camera        (ints; ~1000 units/m in-set)
    depth    = (dy·sin + dx·cos) >> 14      · 2.14 fixed-point trig,
    lateral  = (dy·cos − dx·sin) >> 14        angles in 1/256 turns
    x = cx + lateral·f/depth
    y = cy − dz·f/depth             · f = max(viewW,viewH)/2, center (256,132)

- The camera sits at the scene's map position (`xAxisMap`,`zAxisMap`);
  its **height is the per-view double** we used to skip as "unknownDB2"
  (×512 = world units). The trig tables are TI.EXE's TRIG resource —
  plain 16384·sin/cos, regenerated at load.
- Sprites scale with depth: k = propscale × 180 / (1000 × depth), where
  180 is the state-header reference scale; stored frame offsets scale
  too. `propzclip` extends/limits visibility (depth − zclip ≤ 0 hides).
- `propset(name, set)` binds a world prop to its set — it only draws
  there. `propxy` returns a prop to screen space (pickup).
- Unqualified calls in prop scripts resolve through the **shop main
  script** (ScriptInstance.parent) — the bag's mousedown calls
  watchidle()/mapidle(), defined in house.shp's main.
- End-to-end: the bag renders on the C73 bed (Scene50/View59, projected
  anchor exactly (314,200) at depth 1755), click → addbag() → owner
  "frank", appears in the UI band, trunkkey granted. Verified headless
  + real Chromium.

## Milestone 8 — stage layer (STG flats) & inventory

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
