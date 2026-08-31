# Tests

*Prerequisite: [Engine architecture](../engine/architecture.md).*

This page is the inventory: which suite checks what, and how to run it. For
**why** the port is believed correct — what the playthrough is for, what it has
caught, and what the comparison deliberately ignores — see
**[How we know it's right](../taoot/verification.md)**.

## Where the suites are

**Each package tests itself**, and `npm test` collects all five — the include
list in `vitest.config.ts` is `taoot/tests/auto/`, `dust/tests/`,
`timelapse/tests/`, `engine/tests/` and `site/tests/`. Most of it reads the original game files (a
local `gamefiles/` copy), which is where the port's correctness claims bottom
out; the rest builds its own fixtures and travels anywhere
([Continuous integration](ci.md) is the split).

| Package | Directory | What it covers |
|---|---|---|
| `taoot/` | `taoot/tests/auto/` | the engine driven against *Titanic*'s disc — where nearly all the behavioural coverage is, because that is the game the engine was recovered from |
| `dust/` | `dust/tests/` | *Dust*'s own: its movies, its `.rtd` saves, its v1 movie playback, and its saloon games |
| `timelapse/` | `timelapse/tests/` | *Timelapse*'s own: the mouse cursors out of its engine build, which is the half of its interface that says where the player may go |
| `engine/` | `engine/tests/` | the things that need no game at all: the write-path scaffolding, the focus rule for keys, a screen with no room on it, what the parser tolerates around a handler, the opcodes Timelapse asked for, what a finger on the glass turns out to have meant, a stage that moves on its own, and the geometry a turn slides with |
| `site/` | `site/tests/` | the shared layer: the layering rule itself, the chrome cascade, the six locale catalogues, and who the front page credits |

Titanic then has two further categories that are *not* in `npm test`, each with
its own budget:

| Category | Directory | Command | What it is |
|----------|-----------|---------|------------|
| **playthrough** | `taoot/tests/playthrough/` | `npm run test:playthrough` | the game *played* from the boot to the ending, asserting a recorded state trace — 27 segments plus 3 property tests, ~75 s |
| **browser** | `taoot/tests/browser/` | `npm run test:browser -w taoot` | the same route through real mouse and keyboard events against a live dev server, diffed against the same trace — ~39 min, because it costs what the game costs |

The split exists because a playthrough segment covers minutes of game time and
will only grow as the route reaches further into the story; keeping it out of
`npm test` is what keeps the gate a gate. Only
[`harness.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/harness.ts)
sits above the three — a real `GameHost` over the on-disk game files, which the
automatic suites and the playthrough both boot. What `newHost` does to make a run
reproducible — the injectable audio sink and the two seeded random streams
(`session.seedRandom`) — is
[on the verification page](../taoot/verification.md#determinism-what-a-run-must-not-depend-on),
and worth reading before you diagnose a flaky failure.

## Titanic's automatic suite — `taoot/tests/auto/`

| Suite | Verifies |
|-------|----------|
| [`regression.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/regression.ts) | end-to-end behaviour on real data: hotspot alignment and cursors, the Space door-opener, road-arrival facing, cross-set travel with global persistence, the staircases (the grand staircase's deck flips; the 2nd class staircase's 90°-per-press landings, its deck treadmill, and the floor where the treadmill hands over to the real flight down to F deck), the input queue (including that the movement LETTERS queue like the arrows — a four-press burst of W walks two rooms, not one, [#207](https://github.com/dhobi/dreamrefactory/issues/207)) and `lockevents`, doors and prop state, movies (`spotmovie`, the menu zoom, `actionframe`), the darkroom CLUT, the deck map, inventory pickup, world-space props, [the timing model](../engine/runtime/timing.md) (loops/crickets/walks/`delay`), actors (placement, walking, facing, `endwalk` patrols), puppets (the Smethells conversation, per-puppet frame caches, and the handler an unclosed `switch` ate — [#177](https://github.com/dhobi/dreamrefactory/issues/177)), the per-view `openscene` subtlety, and every scripted mini-game — wireless, trunk gramophone, Enigma, boiler, bomb, turbine, blackjack, fencing, fight, fusebox. Plus the **crowd's names** ([#199](https://github.com/dhobi/dreamrefactory/issues/199)): `lounge1c`'s openset builds up to fourteen extras, each named and placed out of its own star by `findword`'s character mode, and the check that would have caught the old space-splitting reads the room's log — fourteen `starxyz: no star "ex..cen"` lines and five extras where the room wanted fourteen, which is what the report showed |
| [`savegame.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/savegame.ts) | byte-exact round-trip of **every** shipped `.ti`, patch-writes that parse back, story-state decoding, [`loadGame`](../engine/runtime/saves.md) (travel, `hallside` recovery, foreign-file rejection), inventory possession restore, `snapshotSave` after load and after collecting an item, and what the load dialog does to the game behind it ([#162](https://github.com/dhobi/dreamrefactory/issues/162)) — driven through the control panel's own brass lever, so the cancel arm is `CTL.STG`'s and not the test's: black while the modal is up, the panel back untouched on cancel or on a file we cannot read, the loaded room drawn rather than left under the black it was rebuilt behind, and the world frozen throughout. Plus the crowd ([#186](https://github.com/dhobi/dreamrefactory/issues/186)): the open-cast-file list decodes to exactly two shapes across the corpus, and **every** shipped save is loaded — through one session, in sequence, so a load also has to leave the previous game's cast behind — asserting that each actor record with a set and `visible` resolves to a live actor afterwards. That is the assertion the bug needed: `restoreActors` logs a dropped character rather than failing, so 344 missing extras across 39 saves passed a suite that only checked the load returned true. Plus the **walks table**: a census of every live slot in the corpus (16 across 12 saves — 12 turns, one straight line, three authored routes) and both resumes end to end. Save 17 catches Daisy mid-stride on the Grand Staircase, and the test rebuilds her saved position out of the record's own origin, deltas, distance and progress before loading it, so a misread offset fails as arithmetic rather than as a character in the wrong place; the three routes do the same out of their waypoint payloads, then have to arrive at the route's LAST point rather than cut the corner to it. Reported against the #181 branch, which is where the port's long-standing drop became visible — an actor steps through its play script whether a walk is running or not, so a dropped walk left in a walk pose treadmills. Plus the **open audio banks** ([#199](https://github.com/dhobi/dreamrefactory/issues/199)): a save lists every bank it had open and only one of them is playing, so a loader that opened the theme's alone restored loops and crickets with no bank under them. Every shipped save with a cricket table is loaded and every restored cricket has to resolve its sound — 49 of the 50 records fail with the theme's bank alone, which is what keeps the passing number honest — and the reported room is played: load into `lounge1c` mid-sinking, run the clock past the restored `playcrickets` loop, and the sound channel has to fire with no `sound not found` behind it. Plus **the globals a load leaves behind** ([#340](https://github.com/dhobi/dreamrefactory/issues/340)): a save's variable records are the game's whole variable list, not a patch, so a load has to drop what the file does not name — pinned twice, once on the reported stamp (`jonesframe` set as the boat deck leaves it, the load rewinding the frame counter under it, and the Gorse-Joneses' gate having to be open again afterwards) and once over the whole corpus, where every shipped save is loaded and nothing may survive that its file does not name. Plus **the script a load abandons** (the other half of #340): the ending is one straight-line script, so a checkpoint pressed during it used to release the film the script was parked in and let it run on into the next segment — and into `if mission = "good"` with the checkpoint's mission in the global. Driven with a stand-in for the browser's MoviePlayer (`playmovie` blocks, `abandon` resolves it), the load has to leave the ending released, silent and `scriptBusy` clear, with the file's own room standing |
| [`save-original.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/save-original.ts) | a save the **original game** wrote, loaded by the port ([#179](https://github.com/dhobi/dreamrefactory/issues/179)) — and the one save suite that runs without `gamefiles/`, because its whole fixture is the 47 KB `taoot/tests/data/M4P0FCL.ti` a player attached to that issue. The 109 shipped saves are a corpus with a hidden thing in common: one build of TI.EXE, at one load address. This one was made in somebody else's DosBox, so the DFValue vtable its variable nodes carry is `0x87c4596f` and not the corpus's `0x00431e0f` — and the reader used to *find* the node grid by matching that pattern. It matched nothing, decoded zero globals, and a load applied an empty map: the right room with the previous game's mission, phase and everything else ([the format note](../engine/formats/savegame.md#finding-the-grid-the-vtable-is-a-pointer)). The suite pins the premise (the fixture's vtable differs from ours, so a replaced fixture cannot pass quietly), the decode (mission 4, phase 0, `handitem="shawl"`), the reported sequence end to end (loading it over a mission-2 game through a real `loadGame`, asserting the three globals the reporter could see from inside the room), and the write half — a global added to a foreign base has to be readable again, which it is not if the writer stamps our constant into someone else's grid |
| [`re_builtins.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/re_builtins.ts) | the `TI.EXE`-recovered [builtins](builtins.md) in isolation: `calcvectx`/`calcvecty` round-trips, non-negative `calcmod`, `path` slots, the inert debugger family, dialog hooks, count/index enumeration, `roadahead`, `soundvol`/`soundpan`, `currentsound` |
| [`interp.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/interp.ts) | runs `winner()` straight out of `BLKJACK.STG` against a full player/dealer totals matrix — the interpreter's original acceptance test |
| [`speedrun-aim.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/speedrun-aim.ts) | where the speedrun drivers AIM, and whether the page reads it back as the pixel they meant ([#277](https://github.com/dhobi/dreamrefactory/issues/277)). Both drivers name a gesture in CANVAS pixels and the page turns a client coordinate back into one with `canvasCoords`'s `Math.floor`, so an aim is only correct if it survives that floor. It used to be `origin + (v + 0.5) * scale`, which does while a canvas pixel is two client pixels wide and does not when it is one: the coordinate that arrives is a WHOLE number — measured, the browser truncates rather than rounds — so half a pixel of centring plus a fractional `rect.top` lands in the pixel *before* the one asked for. It surfaced as `dial(slider, 7)` settling on 6, because the coal lever is the one control with no tolerance (`calcswitchdeg` clamps the cursor to 245..345 and divides by 5, so one pixel is one whole setting) — every other gesture aims at a hotspot many pixels wide, which is why the same one-pixel error was invisible everywhere else. The suite is the arithmetic on its own, exhaustively: every canvas row at ten presentation widths and six fractional rect origins has to read back as itself at a 1:1 scale or better, the old half-pixel aim has to miss and to miss LOW BY ONE wherever that is pinnable, every aim has to be a whole client pixel (so how the browser delivers it cannot matter), and the coal lever's twenty-one stops all have to be reachable |
| [`nav.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/nav.ts) | the **navigator's judgement**, tested where the route cannot reach it: `hunt` must answer on what a click *moved*, not on where it landed ([why](../taoot/verification.md#what-the-playthrough-is-for)). The playthrough is tuned around the bug it covers — a green run makes not one dud click — so proving the fix needs a room where the click is guaranteed to do nothing: one standpoint sliced out of a real set with its turn rings and roads emptied, and a stub driver that lands every click and changes the world only when told to |
| [`text.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/text.ts) | the character set the text is stored in ([Languages](../taoot/languages.md#the-code-page-is-not-in-the-data)): the three code pages decoded and re-encoded, byte-clamping that never splits a Shift-JIS character, and — the point of the file — the per-language **table re-derived from the shipped puppet files**, by an independent sniff over their dialogue, so a wrong entry fails instead of mojibaking. Languages you don't have installed are skipped, and checking *nothing* fails. Plus `wrapText`: Latin at spaces, Japanese between characters, and never a line that starts with closing punctuation |
| [`audio-rates.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/audio-rates.ts) | mixed sample rates **inside one file**, and the joins that have to survive them: `resampleTo` changes the sample count and not the duration (and keeps the waveform, compared against a tone generated natively at the target rate), a synthesized mixed-rate bank whose theme lasts as long as its chunks do, and the same assertion over every shipped tree's real banks — which fails on every mixed-rate tree if the resample is removed |
| [`sound-channels.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/sound-channels.ts) | `currentsound(1|2)` as the only way a script can ask "is that still playing?", with a **clock-driven sink** of its own: the default `NullAudioSink` reports a non-looping play as done the instant it starts, which is what keeps the rest of the suite deterministic and also makes the question unanswerable. So the bedsit landlady — five lines that are separate crickets, sequenced entirely by that question — was invisible to the whole suite until this file brought a sink where a sound takes as long as it is. Her lines are identified by the cached `DecodedAudio` identity rather than by duration, because `citycricket` is 5.2013 s and so is `lady3` |
| [`shp-play-order.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/shp-play-order.ts) + [`cst-play-order.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/cst-play-order.ts) | the **play script** both sprite formats carry — the table that says what is shown when, and for how long, over the pictures a state or pose stores. Both were reported as animation that looked wrong rather than missing. **`shp`**: FUSE.SHP's `fusedoor` stores its swing twice, closed→open both times, so the script is the only thing that says `closing` runs backwards; a reader that took only as many entries as there are frames saw the repeats, judged the table "not a permutation", and played the opening animation for the closing one. **`cst`** ([#181](https://github.com/dhobi/dreamrefactory/issues/181)): every walk in the game draws ten pictures under a twenty-step script, so a stride takes a second — cycling the pictures one per pass got the character to the right place at the right time with the feet going twice as fast. It pins the file (every walk, every edition), the runtime (twenty passes, two per picture, and a still actor that never changes picture in a hundred), and the regrouping that reading the script required: a pose's pictures group by the step number each record carries, not eight at a time, because `stok1` stores nine views of every picture and `life1` seventeen — which is also why the drawn view is picked by its depicted ANGLE and not by a slot |
| [`pup-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/pup-editor.ts) + [`trk-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/trk-editor.ts) + [`set-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/set-editor.ts) + [`shp-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/shp-editor.ts) + [`stg-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/stg-editor.ts) + [`cst-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/cst-editor.ts) + [`mov-editor.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/mov-editor.ts) | the write half the [browser editors](../editors/README.md) are built on, over a SYNTHESIZED puppet, audio bank, set, shop, stage, cast and movie — built by the library's own writers (`engine/src/df/*-build.ts`, see [the write path](../engine/formats/README.md#writing-one-back)), so these seven run without `gamefiles/` and check the editors' edits against files the write path produced. Structure-preserving read → write, byte-identical write → read → write, the SHP/v41/frame codecs round-tripping (the frame encoder also proved self-contained, by decoding into a deliberately poisoned buffer, and to carry a Z layer over), and each edit (subtitle text, frame art, track name, chunk identifier, loop order, set/scene/view/road names, default start, hotspot identifier and rectangle, actor mark, shop/prop/state names, frame degree and anchor, flat name, region name and rectangle, member and pose names, sprite anchor, frame name, frame and region action codes and names, region rectangle, action-frame slots, the ESC flag) touching exactly its own field — in the bytes *and* in the parsed structure the editor draws from. The shop suite also pins the one case where those two can disagree: a state whose play-order table reverses its frames, where an edit made through the reordered view has to land on the record that frame came from. The movie suite pins a NEGATIVE result rather than a feature: it hand-builds a frame that holds the picture before it (row mode 10 — the mode our own encoder never emits) and shows that replacing the frame under it changes what it decodes to, which is why the movie editor offers no art replacement. It also builds a **chain of segments** and checks both halves of what that costs: each segment reads its own header, frames and action-frame slots, and an edit aimed at a later segment lands there and leaves container 0 byte-identical — which is exactly what the patches did wrong while they hardcoded it |
| [`mov-format.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/mov-format.ts) | the [MOV](../engine/formats/mov.md) facts recovered from the demo build's movie loop, against the **shipped corpus** rather than a synthesized file — because these are claims about what the authors wrote, and a file we wrote ourselves cannot contradict them. A movie is a chain of segments and a segment can carry cues (`tour.mov`: 20 segments, and the one cue record in any shipped tree, which is what leaves its authored ship's-logo loop), the letterboxed films name their own screen origin (512×264 at (0,60)), and `leave.mov` is the whole sinking montage rather than the 70 frames container 0 shows. Each skips when the tree it needs is not installed |
| [`script-encode.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/script-encode.ts) + [`lang-chooser.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/lang-chooser.ts) + [`files-lang.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/files-lang.ts) | the authoring path and the language axis, all three without `gamefiles/`. **`script-encode`**: the opcode table is 1:1, tokens → bytes → tokens is the identity over every token kind, the string pool is shared and offsets are segment-relative, what cannot be encoded throws, and assembled source parses into the handlers it declared (including a handler named after a command). **`lang-chooser`**: the generated `lang.stg` read back (two flats, a region per language, art decoding at 512×384, non-overlapping on-screen rectangles, a script behind every button), then the screen *played* through a real `GameSession` with no set and no BOOTFILE — a click runs the button's own compiled `mousedown`, the number keys run the flat's own `keydown`, a language with no data behind it is refused by click and undone by key, and closing hands the stage back. **`files-lang`**: which URL a basename resolves to, per language and per disc, with a fake manifest and a fake `fetch` — the active language across both discs, then the neutral tree; a language switch dropping that language's cached bytes but not the neutral ones; and the shipped saves picked from one tree |
| [`smokestack.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/smokestack.ts) | the false smokestack's four mazes, and what each one **looks** like. `mazenumber = random(4)` is drawn once at the door and everything after it is the disc's own table, so this pins all of it: `blocks` for every (maze, level) against `setupblocks()` verbatim, a floor that looks the same however you arrived at it, a shut gap that refuses the walk and an open one that takes it. Then the two things [#339](https://github.com/dhobi/dreamrefactory/issues/339) turned out to be. The **bug**: a checkpoint loaded out of the stack left the last climb's crates behind, so a floor wore two mazes at once — reproduced over all sixteen (before, after) pairs, and failing on the load itself without the fix. The **not-bug**: the runners' identification rules (blocked at once is maze 4, crates across the shaft is maze 3, nothing is 1 or 2) hold for ONE of `smstack1`'s four ladders, and the suite pins both the rules from Scene37 and the four-by-four grid that disagrees with them from the other three, where maze 1 reads as maze 3. What it SEES is counted in pixels that reach the screen through the SET's own Z image, because a crate at the far side of the ring is in the draw list and behind a wall, and that is the whole difference between "boxes in the distance" and nothing at all |
| [`mov-play.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/mov-play.ts) | the movie **player** over a shipped film — the state machine, not the container. `mov-format.ts` proves `camelsee.mov` says what it says; this proves the port acts on it, and the split is how [#172](https://github.com/dhobi/dreamrefactory/issues/172) survived: the flag was parsed and then dropped on the floor, so every format assertion passed while the gym's horses stood still |
| [`nightdive.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/nightdive.ts) | the intro film and its question, played the way a player plays it — over the bytes `mknightdive.ts` generates, through a real `GameSession` and the engine's own `MoviePlayer`, with no `gamefiles/` and no BOOTFILE. The intro runs *before* the boot, so it must not need anything a language tree carries, and the answer has to come back through the engine's own `actionframe()` rather than a hook the page installed |
| [`reproducible.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/reproducible.ts) | source rules rather than behaviour: the two ways a run could stop being reproducible — an unseeded random, a read of wall time — banned at the source. Asserting the behaviour directly costs two full 27-segment runs and a byte comparison of 27 goldens |
| [`debug-panel.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/debug-panel.ts) | the state list behind **X**, against a real recorded beat rather than a handful of made-up variables — because what the panel has to survive is the SIZE of the real table (102 globals at the credits, 113 at its fullest) and the fact that only a handful move between beats. The "what just moved" default is what needs [`masks.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/masks.ts) |
| [`log-buffer.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/log-buffer.ts) | the pane's rolling log stays bounded, the lines a bug report carries are the newest ones, and a full repaint is rare rather than per-line |
| [`cache-warmup.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/cache-warmup.ts) | the warmer that pulls an edition through the browser cache before a timed run. Everything worth asserting about a 1.2 GB download is invisible when you run it — does it hold the bytes, does one missing file take the other 663 with it, does Stop stop — so the fetch is a fake and the clock is a variable |
| [`cursors.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/cursors.ts) | the mouse cursors out of `ti.exe` — eleven `CURS.*` resources, byte-identical across the demo and every shipped edition, and they cover every one of the five names the whole corpus ever asks for (touch 809, arrow 75, hand 36, watch 18, fist 2). Three of the other six have no CSS keyword that means what they mean, which is half of why the art is carried rather than mapped; the other half is that it is the 1996 artwork. `godown` is checked by its SHAPE, because Timelapse's build redraws that one and a swapped table is exactly the mistake nothing else would notice. And a name this build has no art for still hides the pointer: `hidecursor()` answers `none`, and only Timelapse ships a `CURS.NONE` |
| [`konami.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/konami.ts) | the front page's one hidden door, and the false starts rather than the happy path: a cursor-based matcher that resets on a wrong key passes every hand-test and still locks out the player who steadies themselves with an extra ↑ |
| [`ui-languages.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/ui-languages.ts) | the chrome's six languages and this game's six editions are the same six — worth a test precisely because that is a coincidence and not a constraint, so it fails naming which side moved rather than offering a language chooser a page nobody wrote |

The suite boots real `GameSession`s and drives a **virtual clock** — no DOM,
no wall time, no audio output (the
[`NullAudioSink`](../engine/runtime/audio.md#sinks-browser-vs-headless) records what
would have played, and reports every non-looping play as done the instant it
starts, which is what keeps it deterministic; a suite that needs sounds to take
time brings its own sink, as `sound-channels.ts` does). **Prefer extending
`regression.ts` over throwaway tests.**

## Dust's suites — `dust/tests/`

Dust reads a different disc, so its suites live with it. All three **skip**
rather than fail without `gamefiles/`, which is the bargain that lets the
runner treat Dust's rip as optional.

| Suite | Verifies |
|-------|----------|
| [`movies.ts`](https://github.com/dhobi/dreamrefactory/blob/master/dust/tests/movies.ts) | DreamFactory 1 movies: the engine-true record layout (80-byte records at 0x8c2, `DF.EXE` 0x40484d), the sound and chain fields, and the adapter that plays them through v4's machinery. Every field is checked against the **whole shipped disc** rather than one file, because three earlier readings of the frame table each fitted most of the data and were each wrong about who owned which field |
| [`mov-play.ts`](https://github.com/dhobi/dreamrefactory/blob/master/dust/tests/mov-play.ts) | the player over a Dust film, on a clock and with its own audio sink. The gap between this and the file above is where [#278](https://github.com/dhobi/dreamrefactory/issues/278) lived: record +0x1a bit 0 — "hold this frame until the sound it started has finished" — was parsed into `flags2` and read by nobody, so the dog that stops you leaving town growled once instead of twice |
| [`salgames.ts`](https://github.com/dhobi/dreamrefactory/blob/master/dust/tests/salgames.ts) | the saloon's blackjack and poker, by running `SALGAMES.FLT`'s own scripts. Both are written against a primitive the port had under a name it did not answer to. `result()` after `indextoprop` names the FILE the prop came from — it was set by `hittest` alone, so the round-clearing loop hid nothing and a second hand was dealt on top of the first one's cards and its WINNER banner. And `variable(name)` resolves LOCALS before globals — poker counts faces into thirteen locals and reads them back by computed name, so a globals-only lookup answered 0 for all of them and every hand at the showdown scored as its high card, four aces included |
| [`saves.ts`](https://github.com/dhobi/dreamrefactory/blob/master/dust/tests/saves.ts) | the claim the whole Dust save story rests on: a `.rtd` is the SAME container a `.ti` is, so the shared framing reader and writer take Dust's files unchanged — and reproduce every byte of every save that came off a real DOS installation. Plus the store's discovery of them, and the claim the collection is one continuous session ordered by its frame counter |
| [`cursors.ts`](https://github.com/dhobi/dreamrefactory/blob/master/dust/tests/cursors.ts) | the mouse cursors out of `DF.EXE`, and DreamFactory 1's set is not v4's: nine, no `godown`/`goup` at all, and a `CURS.TOUCH` drawn differently from Titanic's (the two builds share eight of the nine byte for byte and disagree about the pointing hand). Dust's scripts ask for seven of them 285 times — touch 205, arrow 40, watch 34, sight 3, and one each of gostrait/goright/goleft — and the shell asked for NONE of them: it never called `hover` at all, so every one went nowhere, including the crosshairs and the direction arrows that are the only sign a doorway can be walked through |
| [`scenegrid.ts`](https://github.com/dhobi/dreamrefactory/blob/master/dust/tests/scenegrid.ts) | the town as a GRID — `rowcoltoscene` and `scenebuild`, two DreamFactory 1 commands whose ids belong to something else in DreamFactory 4. The two engines' tables (read out of both binaries by [`taoot/tools/exetable.ts`](tools.md)) disagree on **twenty** ids and Dust calls eight of them; most are the same thing renamed — a "ball" is v4's cricket, a "dir" its view — but these two are deferred-call forms in v4, so both logged a complaint and answered 0. What that cost is `extra.cst`'s five bounty hunters: their `isbuild` asks `rowcoltoscene(y, x)` for the scene on a cell and `scenebuild(name)` whether it is built on, so with both answering 0 nothing was ever "none" and nothing ever built, and they treated all 225 cells of the town as open street. The build flag is scene record +12, and what pins it to that field is that on 28 of the disc's 29 sets "the flag is set" is EXACTLY "no transition touches this cell" — TOWN's 173 against the 52 its 526 moves reach |

## Timelapse's own — `timelapse/tests/`

| Suite | Verifies |
|-------|----------|
| [`cursors.ts`](https://github.com/dhobi/dreamrefactory/blob/master/timelapse/tests/cursors.ts) | the mouse cursors, and they are not decoration: **11,031 of Timelapse's 13,200 `cursor(...)` calls** are `godown` and `goup` — "you can back up from here", "you can step forward here" — over regions that look like nothing at all, so the arrow under the hand is the only thing that says a picture has an exit. `cursor(name)` names a `CURS.<NAME>` cursor resource inside the engine's own executable ([`tools/dumpcursors.ts`](tools.md) has the composition, at `tl.exe` 0x421060), and the set is per BUILD: four of Timelapse's seventeen are not in Titanic's `ti.exe` at all, and of the thirteen both carry, eleven are byte-identical while `GODOWN` and `GOUP` were redrawn — Titanic's are plain arrows, Timelapse's stand on a foot. Two are checked by RENDERING them, because a flipped plane, a swapped palette or a mask read as colour all survive a dimensions test and none of them survive a picture: `CURS.ARROW` against its 32 rows with the hotspot on its tip, and `goup` against its plinth. Also that only three states are ever drawn (Windows' fourth, invert-the-screen, has no CSS and the generator refuses a table that uses it), that 2× is exact nearest neighbour rather than the browser's blur, that the lookup folds case the way Win32 resource names do — the discs spell two of them `HyperLink` and `None` — and that with no canvas to draw a PNG on, every name still answers a keyword, and that a picture shown at a FRACTION gets a cursor that size rather than the integer below it — Titanic shows a 512-wide picture at 1024 CSS pixels, a clean 2×, but a narrower window is 1.4× and an integer-only cursor stayed 32 px there, 30% too small against the art it sits on |

## The engine's own — `engine/tests/`

Eight files, and what they have in common is that they need no game at all.

| Suite | Verifies |
|-------|----------|
| [`df-build.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/tests/df-build.ts) | the shared write-path scaffolding the seven builders rest on: a container's index is handed back as it is allocated, a reserved container stays writable after later ones exist (a header names what follows it), a gap reads back as a gap, the field writers agree with the readers — doubles big-endian, everything else little — and the palette block puts each channel value in the high byte where `paletteToRGBA` looks for it |
| [`keys.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/tests/keys.ts) | which keys belong to a focused control rather than to the game. The play page's shortcuts are letters and it listens on `window`, so a text field and the game were hearing the same keystrokes — filtering the state list for `mission` toggled the minimap on the M and the hotspot overlay on the O |
| [`screen-director.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/tests/screen-director.ts) | a screen with **no room on it** — the case the class exists for. It authors a 640×480 stage with `buildStgBytes` and never builds a `SetViewer`: the compositor answers `"flat"`, a fade runs to its end with nothing but the director to step it, a click walks the whole priority chain down to a flat's region, `hittest` answers for the stage and never for a scene, a key is offered and honestly refused, and a FILM is fetched before it is looked for — the provider in that one answers only for what has already arrived, which is what a browser's does, and Timelapse is the game with no preload list at all (its `boot()` ends in `enterworld ("I")` and builds every name by concatenation, so `readBootPlan` finds no literal to fetch ahead and every film arrives on the miss that wants it: the journal played nothing the first time it was opened and both films the second). The right-hand column at x=639 is the assertion that carries the geometry: it is past the 512 the framebuffer used to hardcode, so a screen still pinned to *Titanic*'s size cannot pass it however well the rest works. And that the cursor is re-asked when the SCREEN's owner changes rather than only when the mouse moves: a shell hears about pointer movement and nothing else, but `lockevents` freezing the world answers `watch` whatever is under the pointer — and in the original that hourglass appears the instant the lock goes up, because its idle loop sets it every pass. A player waiting for a character to walk over to them has a still hand, and a still hand meant a stale pointer. Cheap by construction: a four-part gate (the film on screen, a shown puppet, the events lock, the flat and set) compared once a frame, so the `setcursor` chain runs on a flip and not sixty times a second |
| [`parser-deadtokens.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/tests/parser-deadtokens.ts) | what the parser tolerates around a handler, and what it still refuses. The 1996 compiler left fragments of earlier compiles at a container's top level — after the last `endcode`, and in front of the first — and the original never saw them because it dispatches by name and never walks past the handler it wants. This port walks the whole container, so a throw there cost the caller every handler in the file: *Timelapse*'s BOOTFILE ended `endcode ( )` and that was the whole reason `boot` could not be called, and Dust's `BOLIVAR.PUP` was losing three handlers to an abandoned compile in front of them. Also `exitcode ()`/`passcode ()` with an empty argument list, and a `case` closing an `if` whose `endif` the compiler never wrote. The refusals are pinned too: a container declaring no handler is still an error (these discs carry 31 one-token containers `sniffScript` cannot tell from a script, Titanic's 273), and `exitcode (1)` stays one |
| [`timelapse-opcodes.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/tests/timelapse-opcodes.ts) | the six opcodes a THIRD rip asked for that an engine recovered from two did not have — `plugin` (42 calls), `pluginfx` (4), `prophide` (2), `freemem`, `sysmem`, `sendtobootfx`. All six were reaching `onUnknown`, which for four of them is a silent wrong answer rather than a missing feature. The big one is `plugin("xray")`: a light dragged over a dark flat, revealing a SECOND flat through the light's own shape, and the test authors a 640×480 stage and a diamond-shaped stencil so the corners of the mask frame — inside its bounds, outside its shape — must stay unrevealed. Also that a moved aperture is a repaint and not a matching signature, that `sendtobootfx` addresses the boot rather than the stage (a decoy handler of the same name sits on the flat), Three are the CAMERA, the one plugin with a store behind it: a shot is 320x240 taken from where the viewfinder was aimed and drawn at (160, 120), both numbers `tz.dll`'s; the save may refuse ONLY for an id already used, because `docamera` reads any other refusal as "roll another" inside a `while true`; the album hydrates from its store and a store that will not open costs persistence and nothing else. One more is that opening a stage file lifts the fade the old stage's palette was under, which is what makes the album visible at all — it is the one panel flat whose `openflatx` never calls `blacktoscreen`. Also that the memory report deliberately reports a SMALL machine, because `minMemory` picks between two turn handlers and only one is built from opcodes this port has. Two more are about NAMES: `sendtoboot` addresses the whole boot and not just its first container — Timelapse's `endinterface`/`begininterface`/`docamera` are the library's, so the panel's own buttons dead-ended and clicking the camera did nothing — and names FOLD CASE the way the language does, which is what the journal's pickup needs (`gJournalTaken = 1` against every reader's `gjournaltaken`, and `Playsound` against the library's `PlaySound`). One more is `hidecursor`/`showcursor`, which are a COUNTER and not a flag because the original's are (`tl.exe` 0x4087b0 is `ShowCursor(FALSE)` plus a decrement of its own tally at 0x45b418): the game takes the pointer away in the three places where it draws its own instead — the bow being drawn, the camera's viewfinder bevel, the endgame — so two nested hides need two shows, the hover chain is not even asked while it is hidden, and the endgame's unmatched hide is undone by a restart, because the game is over and nothing else will. And the last is `sendtopost`, which addresses the BOOT's containers: it was registered as a deferred form and then handed the STAGE, and all 110 of Timelapse's calls name one of seven handlers defined in the BOOTFILE library and nowhere else in the corpus, so every one of them answered 0 in silence — 58 stage-to-stage moves, and the four views that approach the cave's lantern, whose entire mousedown is `sendtopost (jumptoframe (873))` |
| [`touch.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/tests/touch.ts) | a finger on the glass, and the four things it can turn out to have meant. The recogniser existed THREE TIMES — two hundred near-identical lines in each of `taoot/src/main.ts` and `dust/src/main.ts` beside the shared copy *Timelapse* was written against — and neither private copy was covered by anything; the speedrun driver deliberately steers around it with `pointerType: "mouse"`. Extracting it to `engine/src/web/touch.ts` for a third game is what made it testable, and both pages have since moved onto it, which is what these tests were written to make safe: the two copies had drifted in ways nobody chose, and the one bug they shared — a gesture that would not start with no room open — was the only one of the three the shared copy never had. It bit on *Dust*, whose films play on the director with no set open; on *Titanic* it was latent, because the boot opens a set before the logos roll, and the film there that really does run with no viewer is the Nightdive intro's, which is not the director's film either and needed its own line in the page. What is under test is the ambiguity: a finger going down begins a tap AND a swipe, so the mousedown is withheld until the gesture declares itself, and every bug this can have is a wrong declaration — a click delivered on a swipe (the camera turns *and* the thing under your finger opens), a swipe eaten by a drag loop, a press handed over and never released on `pointercancel`. Also that a diagonal decides nothing rather than guessing the nearer axis, that a tap clicks where the finger LANDED rather than where it lifted, that a third quick tap is a fresh first and not another escape, and that a finger on a prop or a button is pressed at once so a `while stilldown()` drag is never ruled a swipe. Also that a FIRST tap at clock zero is a click: the previous-tap time is a sentinel as well as a time, and `0` was both, so a tap inside the first 320 ms of a page's life sent the escape instead — invisible to every other test here, because they all start their clock at 1000. And that the recogniser tracks ONE pointer: a second finger's move and release are not the first one's, which is what `owns()` answers. No DOM: the hooks are the seam and the clock is injected |
| [`flat-anim.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/tests/flat-anim.ts) | a stage that moves on its own, and the three separate things that were stopping it. Timelapse animates by walking a RUN OF FLATS — `flatstartanim(2, 54, "FlatAnimDone()", 8)` — 433 times across its discs, and never once in the other two games, so this whole mode of the engine had never run. None of the three causes is about animation: `makeLoop` folded the callback NAME to lower case (Titanic's 67 loop callbacks are all lowercase so the fold was the identity; Timelapse names 9 of 34 in CamelCase and Dust one, `SOUNDFXS`, which is Chinatown's ambient loop); a flat loop could not reach a handler the BOOT owns, because a flat with no script resolves to its stage so the chain was never empty, only unable to answer; and every flat was decoded into a fresh `FrameBuffer` when the cels are DELTAS — `image.ts` warns about exactly that at the top. Includes a hand-assembled delta frame (row mode 10, "keep this row from the previous image") and the claim that protects the other two games: a keyframe decodes the same whatever preceded it. Plus a fourth cause found from play — `gotoflat` sent a flat's `openflat`/`closeflat` straight at its own script instead of along the chain, so Timelapse's BOOTFILE defaults never ran and `baseflat` went stale on every move within a stage: the sea walked one view's water while the player stood at another. And one about a loop that comes due mid-DRAG: `fireDueLoops` counts a timer loop down whether or not a script is in flight and then declines to fire it, so a loop armed inside a `while stilldown()` handler sat at zero until the player let go. Timelapse's match is the worked example and was reported as one — striking it plays the sound and arms `makeloop("prop", "Matches", "MatchBurn()", 30 / 6)`, so the strike was audible and the flame did not start until the button came up. `forceupdate()` is the drag's own yield and in the original it IS a service pass, so the pump fires a due timer loop as well as the per-frame ones — without counting it down, which is what keeps the pace the engine's rather than the display's. And one about a JUMP into the middle of a variant chain: a flat named `i{region}.{frame}.{n}` — three components — is a delta over the variant before it, `.1` over the base and `.2` over `.1`, so seeding from the flat that was on screen is right for an animation (walked in order) and wrong the moment a script jumps. Timelapse jumps on purpose: the lantern's instruction sheet is `gotoflat("i0001.605.1")` with the matches on the table and `gotoflat("i0001.605.2")` once they are taken, both from the table, and `.2` decoded over the table changed 4,771 of its pixels and left 302,429 — so the player clicked the instructions and got the table back. Reported that way, twice |
| [`turn-effect.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/tests/turn-effect.ts) | `visualeffect(turnleft|turnright)`, the sliding turn — a PUSH, where both pictures move, against the wipes where only the arriving one does. Every number is `tl.exe`'s: the four turn slots of the jump table at 0x447c18 are the only ones calling 0x448cb0, which clips BOTH its rects against the screen (what a copy must do on one surface) where the wipes call the offscreen blit 0x448c20 twice; `turnhalf*` halves the width at 0x448b48 before dividing by the steps; and a half turn's source cursor starts a QUARTER in (0x448b66). That last one is invisible until it is wrong — a mid-turn flat is 320 columns of art centred in a 640 canvas, so an edge-sourced cursor slides the blank margin across the screen. Also that a HALF turn SETTLES rather than ending, so the second leg captures the composite the first left rather than the destination flat drawn whole — and that the settled composite has to outlive `visualeffect`'s own return, because `gotoflat(namedest)` runs between the legs and any frame it yields would otherwise put the live world back on screen (the left turn's mid-picture jump, 66 at the join against a median of 13). Both of a turn's pictures are HELD for the whole ramp, which is what the original's modal effect over an untouchable offscreen surface gives it for free: without that, a destination flat that animates (i0001.103 is water) hands different passes different art. And that `plain` is a REDRAW rather than a no-op (0x448630 blits the screen rect to itself), which is how a script makes a change visible before the next effect captures the screen — without it the compass the game hides before every turn was still in the buffer and slid off with the picture |

## The shared layer — `site/tests/`

| Suite | Verifies |
|-------|----------|
| [`layering.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/tests/layering.ts) | **the one structural rule the whole layout rests on**: a shared package may not import a game. `engine` imports nothing, `site` imports `engine`, and the two games import both and never each other. It is a test rather than a convention because the violation compiles perfectly |
| [`cascade.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/tests/cascade.ts) | the bundler does not get a vote on what anything looks like. Every page links the shared chrome and then writes its own `<style>` after it; in a build Vite re-inserts the `<link>` at the END of `<head>`, so two declarations of equal specificity swap places. Dust's page is a grid and the chrome sets `display: flex` on `body` — that is the pair this file exists for |
| [`front-doors.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/tests/front-doors.ts) | the front page credits the right studio for each game. CyberFlix wrote the engine and made two of the three; *Timelapse* is GTE Interactive Media's, and for a long time nothing here said so — the lede came close to saying the opposite and this game's own doc page opened with "CyberFlix, 1996". The credit is a field on the registry AND a badge in the markup, which is two copies of one fact: this holds them together, including that the badge's visible text is the attribute the test reads, so the two cannot agree while a reader sees something else |
| [`locales.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/tests/locales.ts) | the catalogue must say exactly what the markup says. The pages carry their English inline (so an English reader needs no JavaScript and `git diff` shows the sentence that changed) and `locales/en.ts` carries the same English for translators — two copies of a string, made safe only by this file failing loudly when one moves |

## Running the playthrough

```
npm run test:playthrough                  # all 27 segments, headless, ~75 s
npx vitest run taoot/tests/playthrough/playthrough.ts -t "playthrough 13"   # one segment
TAOOT_RECORD=1 npx vitest run taoot/tests/playthrough/playthrough.ts        # re-record the goldens
```

Checkpoints are written to `out/checkpoints/` as `.ti` files, one per segment,
and are what a filtered or fresh run resumes from when there is no live game to
continue ([why a run has two modes](../taoot/verification.md#one-game-carried-not-a-chain-of-loads)).
The routes are
[`segments.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/playthrough/segments.ts),
one function per segment; the segment-by-segment table of what each crosses is
**[the route](route.md)**.

## Dust's playthrough — the other kind of evidence

```
npm run test:playthrough -w dust                                            # the whole route
npm run test:playthrough -w dust -- -t "D2A_001 → D2A_002"                    # one rung
```

Titanic's playthrough asserts a **recorded** trace: the game as this project
last saw it. Dust's asserts something this project cannot forge. `gamefiles/save/`
holds the 61 `.rtd` files shipped on the disc, and all but one of them are a
single continuous session played by CyberFlix on `DF.EXE` in 1995 ([the golden
thread](../dust/thread.md)). A **rung** is the play between two consecutive
saves, and the runner loads the first, plays, and checks the live game against
the second — the room, the standpoint, the view, and the globals that rung is
about. A pass says the port arrived where the original engine arrived.

That shape has a property Titanic's does not: **rungs are independent.** Both
ends come off the disc, so a rung can be written, run and debugged on its own,
in any order, and by more than one person at once. Hence the layout —
[`route.ts`](https://github.com/dhobi/dreamrefactory/blob/master/dust/tests/playthrough/route.ts)
is the vocabulary every rung is written in (`walkTo`, `openDoor`, `clickActor`,
`answer`, `talkOut`, `excuseUs`), and each helper's doc comment records what went
wrong when it was not used;
[`rungs/`](https://github.com/dhobi/dreamrefactory/tree/master/dust/tests/playthrough/rungs)
is one rung per file.

What a rung claims is a judgement, and the ones it does NOT claim are where the
findings are. `D2A_003 → D2A_004` cannot claim the shooting range's four hit
counts, because the shipped save kept four names of a five-name `dumpglobal`
while the port discards the list — and chasing that disagreement across all 55
saves is what showed that [a global's presence in an `.rtd` is not proof it was
live](../engine/scripting-language.md): a dumped name keeps its record until
something is allocated over it, and those four go on the next save that
allocates anything. Every exclusion is written down beside the segment with its
reason.

## Running the browser suite

It drives **Titanic's** page, which is its own dev server on 5175 — so
`npm run dev` (the front door, 5173) is not the one to start:

```
npm run dev -w taoot                         # in another terminal — Titanic on 5175
npm run test:browser -w taoot                      # the demo, menu-movie, then the whole route, ~39 min
npm run test:browser:playthrough -w taoot          # just the route
npm run test:browser:endgame -w taoot              # just the ending, ~3 min, off a checkpoint
npm run test:browser:lang -w taoot                 # the language chooser, with real clicks
npm run test:browser:demo -w taoot                 # the 1996 demo's menu, ~30 s (skips with no demo rip)
npm run test:browser:m0 -w taoot                   # segment 1
npm run test:browser:m1 -w taoot                   # segments 2–6
npm run test:browser:m2 -w taoot                   # segments 7–16
SEGMENTS=13 npm run test:browser:seg -w taoot      # one segment
```

`APP_URL` overrides where it looks; the driver treats it as the **game's
root** and appends `play/`, and it defaults to `http://localhost:5175/` — this
game's own dev server. CI sets it explicitly, because `browser.yml` runs the
server on 5199 rather than 5175 to stay off the port a person's own
`npm run dev -w taoot` would want.

Two browser checks run against the **build** rather than a dev server, because
the bugs they exist for only appear there:

```
npm run build -w dust && npm run test:built -w dust    # Dust's layout, as built
npm run test:built -w site                          # the site, served from a subdirectory
```

The second builds the site itself and serves `dist/site` under a
`/dreamrefactory/` prefix, which is the one thing neither `npm run dev` nor
`vite preview` can show: both serve at a host's root, so a URL that is wrong for a
subdirectory is right everywhere else a test looks. It caught the games menu
asking `danielhobi.ch` for `/mark-taoot.png` — a URL assembled in TypeScript at
runtime, which Vite never sees and so never rebases. Anything the page requests
that does not answer 200 fails it, `gamefiles.json` excepted: the editors probe
every game for one to find out which rips a deployment carries.

**Run it on its own** — it waits on real frames, so anything else using the
machine changes what the game does rather than merely slowing it down. No second
browser, no `vitest`, no docs build alongside it.

### Watching it play

```
npm run dev -w taoot
npm run watch:playthrough -w taoot                 # a real window, slowed down, stays open
npm run watch:mission0 -w taoot                    # the boot, the flat, the bomb, the crossing
npm run watch:mission1 -w taoot                    # skip the boot, watch all of mission 1
npm run watch:mission2 -w taoot                    # ...and all of mission 2
npm run watch:m1p0 -w taoot                        # just the segment that starts at phase 0
npm run watch:m1p1 -w taoot                        # ...phase 1
npm run watch:m1p2 -w taoot                        # ...phase 2
npm run watch:m1p3 -w taoot                        # ...phase 3
npm run watch:m1p4 -w taoot                        # ...and mission 1's debrief
npm run watch:m2p0 -w taoot                        # ...and the start of mission 2
HEADED=1 SLOWMO=400 KEEPOPEN=0 npx tsx taoot/tests/browser/playthrough.ts
```

The per-segment scripts are named for the **checkpoint they resume from**, so the
script and the savegame it loads have the same name — `watch:m1p2` reads
`out/checkpoints/m1p2.ti`, which is also what the error names if you haven't
recorded one. `watch:mission1` is the whole mission and grows a segment at a time.

`SEGMENTS` picks which stretches to play, and picking a subset changes how it
starts: a segment whose predecessor isn't in the run has no live game to continue,
so it loads the same `.ti` checkpoint its headless twin starts from
(`out/checkpoints`, written by `npm run test:playthrough`). That is what lets you
watch mission 1 without sitting through the crossing — and it is also why a
filtered run's trace comparison may stand down, since
[a golden speaks for one mode](../taoot/verification.md#one-game-carried-not-a-chain-of-loads).
The segment's own assertions still run either way.

## Standalone scripts (run with `tsx`)

These have top-level side effects, so they're outside the Vitest run:

```
npx tsx taoot/tests/browser/playthrough.ts                # the playthrough route, in a real browser
npx tsx taoot/tests/browser/endgame.ts                    # the ending only, resumed from m4anti.ti
npx tsx taoot/tests/browser/menu-movie.ts                 # screenshots + state dump of the menu movie flow
npx tsx taoot/tests/browser/lang-chooser.ts               # pick a language in a real browser, then check what the boot reads
npx tsx taoot/tests/browser/repaint.ts                    # does the renderer ever skip a frame it should have drawn?
npx tsx taoot/tests/browser/transition-hold.ts            # does anything paint the world while a transition waits for bytes? (#308)
npx tsx dust/tests/browser/built-layout.ts                # Dust's page as BUILT, not as served
npx tsx dust/tests/browser/load-standpoint.ts             # where a load puts you on a game that has just booted
npx tsx dust/tests/browser/shooting-range.ts             # are the range's targets actually on the canvas?
npx tsx tools/parse.ts                                    # parse the whole script corpus, report coverage
npx tsx taoot/tools/navdump.ts taoot/gamefiles/en/titanic2/DATA/b59.set out/   # navigation dump (PNG per step)
```

Three files under `taoot/tests/browser/` are machinery rather than runs:
`driver.ts` (the page, the real mouse and keyboard, the state mirror),
`story.ts` (a `Story` over that driver, so a segment written once plays in
both hosts) and `proptrace.ts` (every write to a prop's owner, formatted by
the engine so a browser log and a headless log diff cleanly).

## The speedrun

Not a test — a route written as a **sheet** and driven against the clock,
which is why it has its own directory and its own runner rather than a place
in the suite above.

```
npm run dev -w taoot
npm run speedrun -w taoot                          # run the sheet, print the splits
npm run speedrun:watch -w taoot                    # a real window, same run
npm run speedrun:lint -w taoot                     # parse the sheet and say nothing else
npm run speedrun -w taoot -- --from="m4p0 cabin"   # enter at one of its save points
SHEET=taoot/tests/speedrun/any.sheet npm run speedrun -w taoot
```

The same sheet language runs in the browser, on the unlisted `/speedrun/`
workbench — `taoot/src/speedrun/` is the in-page half and
`taoot/tests/speedrun/` the Playwright one, over one sheet parser.

### A route is a line; the sinking is not

`watchFor(<condition>, <action>)` is a standing rule — *whenever this becomes
true, do that* — and it exists because one part of this game cannot be written
as a line ([#255](https://github.com/dhobi/dreamrefactory/issues/255)). During
mission 4 the phase advances on a mix of real time, how far the player has
walked and how many conversations they have had, so `sink1.mov` arrives at a
moment no sheet can name: it interrupts whatever command is running, blocks
input, and the line waiting on the world times out through no fault of its own.
The only linear answer is an `esc()` after every movement, which is unreadable
and still wrong, because the film is not after any particular move.

```
watchFor(movie == sink1.mov, skipMovie(until: quiet, budget: 60000))
watchFor(movie == sink1.mov, off)
```

The condition is the ordinary condition language, the one `wait` takes, and the
action is an ordinary sheet line — parsed as one, which is what makes this take
every verb rather than a list of the ones somebody remembered to allow.

Two things decide whether it works. It is polled **alongside the running step**
and not between steps, because the step that needs rescuing is the one already
waiting; the runner starts a watchdog beside each step, one round trip per tick
however many watches there are, and nothing at all when none is registered. And
it is **edge-triggered** — a watch fires when its condition goes false→true and
not again until it has gone false in between — so a film playing for two hundred
frames is one firing, not two hundred.

Safe to gesture from, because a step that is waiting is only polling. A watch
that fires while a step is mid-*gesture* is the one hazard, and it is the sheet
author's to avoid: a watch is for recovery, not for playing the game.

With the three sinking films watched, the route runs cold boot to credits.

Both halves aim through **one** piece of arithmetic, `clientPointFor` in
`src/speedrun/driver.ts`, and that is not tidiness: a gesture is named in canvas
pixels, the page reads it back with `Math.floor`, and the coordinate in between
is a whole number of client pixels. Getting that wrong costs one pixel, which is
nothing at a hotspot and everything at the coal lever
([#277](https://github.com/dhobi/dreamrefactory/issues/277)). Measured against a
real page at nine widths: before the fix, 640px missed five of the lever's
twenty-one stops and 512px missed twenty; after it, every width from 400px up
reaches all twenty-one. Anything below a 1:1 scale is lossy by construction —
several canvas pixels share one client pixel — so `clientAxis` returns the
nearest whole coordinate rather than a fraction that will not arrive, and
`setLever` aims at the MIDDLE of a setting's band to spend the tolerance the
control already has.

They also pace a held drag through one constant, `HELD_YIELDS`. A dragged
control is a script spinning in `while stilldown() { … forceupdate() }` and both
of those bump `realYieldSeq`, so one turn of that loop is two bumps — and the
dial steps once per turn. Waiting four bumps between moves, as both drivers used
to, turned every dial at half the rate the game can be turned at
([#293](https://github.com/dhobi/dreamrefactory/issues/293)). Two is not a proof
that the move was consumed, and does not need to be: the gesture is closed-loop,
so a move the loop missed costs one more move and nothing else, and `limiter`
reads only the SIGN of the bearing change, which two accumulated moves do not
change. Measured over the plant's six dials from one seed, so `openstage` deals
the same scatter each time: **5.3 s of dialling at four bumps, 4.7 s at three,
3.7 s at two, 3.5 s at one**. One buys nothing over two and guarantees no turn at
all. The floor under both is the game's own loop rate, which is the floor a hand
has too.

`browser/transition-hold.ts` is the browser half of one decision the headless
suite can only pin from the inside: a load must not hand the screen back to the
world while a transition is waiting for it. It samples every
`ScreenDirector.render` — flagged with whether a composite actually happened —
and reports any composite that put the lit room on the canvas inside three windows
the report named: the boot between the menu film and the date caption (CPU
throttled 4x, because nothing there is a fetch on a warm page), the first open of
the map (`map.stg` held back by `STALL_MS`, default 1200), and the painting crate
— `transtoflat("cargo.stg")`, whose reveal is `cratep.mov` and not a fade, so the
window runs past the swap and all the way to the clip. Each leg drives the game's
own `transtoflat` **through `session.track`**, because `scriptBusy` counts tracked
dispatches and nothing else: an untracked drive looks idle from its first await,
and every hold that waits for the script to fall quiet is lifted a frame after it
goes up. It prints
which build the PAGE is running, read out of the loaded function — a dev server
that has been up across an edit can serve the browser a stale transform while
handing curl a fresh one, which is enough to make both arms of a before/after
measure the same code.

`browser/lang-chooser.ts` needs two or more language directories under
`gamefiles/` and skips (exit 0, with the reason) when the install has fewer: it
clears the remembered choice, waits for `lang.stg` to come up *before* the landing
screen, clicks a language's region with a real mouse, and then asserts the thing
only a browser can be asked — that every `gamefiles/` request from the choice
onwards comes from the chosen tree. The other browser suites pass `?edition=`
(from `TAOOT_LANG`, default `en`) so the chooser never blocks them.

`browser/demo.ts` is the third that asserts, and it exists because a whole class
of page bug is invisible to everything else here. The 1996 demo opens **no set,
ever** — `open.mov`, then `demo.stg`, a menu that is a stage flat with four
portholes on it — so `host.viewer` is null for the life of the page. Every other
edition has a room from the first second, so three input gates and a row of
chrome could all be conditioned on one existing and nobody would feel it; the
demo arrived with no keys, no clicks and no bug button (#299). The headless
suite cannot see it, because the gates are the page's and not the engine's:
`auto/regression.ts` boots the demo to its menu and passes either way.

Its ESC check is timed rather than tested for effect, which is the shape worth
copying: `open.mov` ends by itself after 31.4 s, so "the film stopped" is not
evidence that a key did anything. The claim is that the menu arrives within ten
seconds of the press — 0.2 s in practice, against 31.4 s with the key dropped.

The two older browser scripts are not the same kind of thing.
`browser/playthrough.ts` asserts — it diffs a live page against the golden
trace. `browser/menu-movie.ts` asserts nothing: it drives the Scene51/View65
menu flow through `window.dbg` and prints state plus screenshots, which is what
you want when a movie misbehaves and you need to see it. `parse.ts` and
`navdump.ts` inspect the corpus rather than the port, which is why they moved
to `tools/`; `parse.ts` is the source of the ["100% of the corpus
parses"](../engine/formats/script-container.md) claim.

Back to the [reference index](README.md).
