# Tests

*Prerequisite: [Engine architecture](../02-engine-architecture.md).*

This page is the inventory: which suite checks what, and how to run it. For
**why** the port is believed correct — what the playthrough is for, what it has
caught, and what the comparison deliberately ignores — see
**[How we know it's right](../verification.md)**.

Everything under
[`tests/`](https://github.com/dhobi/taoot-web/tree/master/tests) runs
**headless against the original game files** (a local `gamefiles/` copy) —
the port's correctness claims all bottom out here, in three categories with
three different budgets — one directory each:

| Category | Directory | Command | What it is |
|----------|-----------|---------|------------|
| **automatic** | `tests/auto/` | `npm test` | scenario + unit suites that jump to a state and probe it — 456 tests, run on every commit |
| **playthrough** | `tests/playthrough/` | `npm run test:playthrough` | the game *played* from the boot to the ending, asserting a recorded state trace — 27 segments plus 3 property tests, ~75 s |
| **browser** | `tests/browser/` | `npm run test:browser` | the same route through real mouse and keyboard events against a live dev server, diffed against the same trace — ~39 min, because it costs what the game costs |

The split exists because a playthrough segment covers minutes of game time and
will only grow as the route reaches further into the story; keeping it out of
`npm test` is what keeps the gate a gate. Only
[`harness.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/harness.ts)
sits above the three — a real `GameHost` over the on-disk game files, which the
automatic suites and the playthrough both boot. What `newHost` does to make a run
reproducible — the injectable audio sink and the two seeded random streams
(`session.seedRandom`) — is
[on the verification page](../verification.md#determinism-what-a-run-must-not-depend-on),
and worth reading before you diagnose a flaky failure.

## The automatic suite — `npm test`

| Suite | Verifies |
|-------|----------|
| [`regression.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/regression.ts) (123 scenarios) | end-to-end behaviour on real data: hotspot alignment and cursors, the Space door-opener, road-arrival facing, cross-set travel with global persistence, the staircases (the grand staircase's deck flips; the 2nd class staircase's 90°-per-press landings, its deck treadmill, and the floor where the treadmill hands over to the real flight down to F deck), the input queue and `lockevents`, doors and prop state, movies (`spotmovie`, the menu zoom, `actionframe`), the darkroom CLUT, the deck map, inventory pickup, world-space props, [the timing model](../runtime/timing.md) (loops/crickets/walks/`delay`), actors (placement, walking, facing, `endwalk` patrols), puppets (the Smethells conversation, per-puppet frame caches, and the handler an unclosed `switch` ate — [#177](https://github.com/dhobi/taoot-web/issues/177)), the per-view `openscene` subtlety, and every scripted mini-game — wireless, trunk gramophone, Enigma, boiler, bomb, turbine, blackjack, fencing, fight, fusebox. Plus the **crowd's names** ([#199](https://github.com/dhobi/taoot-web/issues/199)): `lounge1c`'s openset builds up to fourteen extras, each named and placed out of its own star by `findword`'s character mode, and the check that would have caught the old space-splitting reads the room's log — fourteen `starxyz: no star "ex..cen"` lines and five extras where the room wanted fourteen, which is what the report showed |
| [`savegame.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/savegame.ts) (37 tests) | byte-exact round-trip of **every** shipped `.ti`, patch-writes that parse back, story-state decoding, [`loadGame`](../runtime/saves.md) (travel, `hallside` recovery, foreign-file rejection), inventory possession restore, `snapshotSave` after load and after collecting an item, and what the load dialog does to the game behind it ([#162](https://github.com/dhobi/taoot-web/issues/162)) — driven through the control panel's own brass lever, so the cancel arm is `CTL.STG`'s and not the test's: black while the modal is up, the panel back untouched on cancel or on a file we cannot read, the loaded room drawn rather than left under the black it was rebuilt behind, and the world frozen throughout. Plus the crowd ([#186](https://github.com/dhobi/taoot-web/issues/186)): the open-cast-file list decodes to exactly two shapes across the corpus, and **every** shipped save is loaded — through one session, in sequence, so a load also has to leave the previous game's cast behind — asserting that each actor record with a set and `visible` resolves to a live actor afterwards. That is the assertion the bug needed: `restoreActors` logs a dropped character rather than failing, so 344 missing extras across 39 saves passed a suite that only checked the load returned true. Plus the **walks table**: a census of every live slot in the corpus (16 across 12 saves — 12 turns, one straight line, three authored routes) and both resumes end to end. Save 17 catches Daisy mid-stride on the Grand Staircase, and the test rebuilds her saved position out of the record's own origin, deltas, distance and progress before loading it, so a misread offset fails as arithmetic rather than as a character in the wrong place; the three routes do the same out of their waypoint payloads, then have to arrive at the route's LAST point rather than cut the corner to it. Reported against the #181 branch, which is where the port's long-standing drop became visible — an actor steps through its play script whether a walk is running or not, so a dropped walk left in a walk pose treadmills. Plus the **open audio banks** ([#199](https://github.com/dhobi/taoot-web/issues/199)): a save lists every bank it had open and only one of them is playing, so a loader that opened the theme's alone restored loops and crickets with no bank under them. Every shipped save with a cricket table is loaded and every restored cricket has to resolve its sound — 49 of the 50 records fail with the theme's bank alone, which is what keeps the passing number honest — and the reported room is played: load into `lounge1c` mid-sinking, run the clock past the restored `playcrickets` loop, and the sound channel has to fire with no `sound not found` behind it |
| [`save-original.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/save-original.ts) (7 tests) | a save the **original game** wrote, loaded by the port ([#179](https://github.com/dhobi/taoot-web/issues/179)) — and the one save suite that runs without `gamefiles/`, because its whole fixture is the 47 KB `tests/data/M4P0FCL.ti` a player attached to that issue. The 109 shipped saves are a corpus with a hidden thing in common: one build of TI.EXE, at one load address. This one was made in somebody else's DosBox, so the DFValue vtable its variable nodes carry is `0x87c4596f` and not the corpus's `0x00431e0f` — and the reader used to *find* the node grid by matching that pattern. It matched nothing, decoded zero globals, and a load applied an empty map: the right room with the previous game's mission, phase and everything else ([the format note](../formats/savegame.md#finding-the-grid-the-vtable-is-a-pointer)). The suite pins the premise (the fixture's vtable differs from ours, so a replaced fixture cannot pass quietly), the decode (mission 4, phase 0, `handitem="shawl"`), the reported sequence end to end (loading it over a mission-2 game through a real `loadGame`, asserting the three globals the reporter could see from inside the room), and the write half — a global added to a foreign base has to be readable again, which it is not if the writer stamps our constant into someone else's grid |
| [`re_builtins.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/re_builtins.ts) (20 tests) | the `TI.EXE`-recovered [builtins](builtins.md) in isolation: `calcvectx`/`calcvecty` round-trips, non-negative `calcmod`, `path` slots, the inert debugger family, dialog hooks, count/index enumeration, `roadahead`, `soundvol`/`soundpan`, `currentsound` |
| [`interp.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/interp.ts) | runs `winner()` straight out of `BLKJACK.STG` against a full player/dealer totals matrix — the interpreter's original acceptance test |
| [`nav.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/nav.ts) (2 tests) | the **navigator's judgement**, tested where the route cannot reach it: `hunt` must answer on what a click *moved*, not on where it landed ([why](../verification.md#what-the-playthrough-is-for)). The playthrough is tuned around the bug it covers — a green run makes not one dud click — so proving the fix needs a room where the click is guaranteed to do nothing: one standpoint sliced out of a real set with its turn rings and roads emptied, and a stub driver that lands every click and changes the world only when told to |
| [`text.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/text.ts) (11 tests) | the character set the text is stored in ([Languages](../runtime/languages.md#the-code-page-is-not-in-the-data)): the three code pages decoded and re-encoded, byte-clamping that never splits a Shift-JIS character, and — the point of the file — the per-language **table re-derived from the shipped puppet files**, by an independent sniff over their dialogue, so a wrong entry fails instead of mojibaking. Languages you don't have installed are skipped, and checking *nothing* fails. Plus `wrapText`: Latin at spaces, Japanese between characters, and never a line that starts with closing punctuation |
| [`audio-rates.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/audio-rates.ts) (6 tests) | mixed sample rates **inside one file**, and the joins that have to survive them: `resampleTo` changes the sample count and not the duration (and keeps the waveform, compared against a tone generated natively at the target rate), a synthesized mixed-rate bank whose theme lasts as long as its chunks do, and the same assertion over every shipped tree's real banks — which fails on every mixed-rate tree if the resample is removed |
| [`sound-channels.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/sound-channels.ts) (2 tests) | `currentsound(1|2)` as the only way a script can ask "is that still playing?", with a **clock-driven sink** of its own: the default `NullAudioSink` reports a non-looping play as done the instant it starts, which is what keeps the rest of the suite deterministic and also makes the question unanswerable. So the bedsit landlady — five lines that are separate crickets, sequenced entirely by that question — was invisible to the whole suite until this file brought a sink where a sound takes as long as it is. Her lines are identified by the cached `DecodedAudio` identity rather than by duration, because `citycricket` is 5.2013 s and so is `lady3` |
| [`shp-play-order.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/shp-play-order.ts) + [`cst-play-order.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/cst-play-order.ts) (12 tests) | the **play script** both sprite formats carry — the table that says what is shown when, and for how long, over the pictures a state or pose stores. Both were reported as animation that looked wrong rather than missing. **`shp`**: FUSE.SHP's `fusedoor` stores its swing twice, closed→open both times, so the script is the only thing that says `closing` runs backwards; a reader that took only as many entries as there are frames saw the repeats, judged the table "not a permutation", and played the opening animation for the closing one. **`cst`** ([#181](https://github.com/dhobi/taoot-web/issues/181)): every walk in the game draws ten pictures under a twenty-step script, so a stride takes a second — cycling the pictures one per pass got the character to the right place at the right time with the feet going twice as fast. It pins the file (every walk, every edition), the runtime (twenty passes, two per picture, and a still actor that never changes picture in a hundred), and the regrouping that reading the script required: a pose's pictures group by the step number each record carries, not eight at a time, because `stok1` stores nine views of every picture and `life1` seventeen — which is also why the drawn view is picked by its depicted ANGLE and not by a slot |
| [`pup-editor.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/pup-editor.ts) + [`trk-editor.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/trk-editor.ts) + [`set-editor.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/set-editor.ts) + [`shp-editor.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/shp-editor.ts) + [`stg-editor.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/stg-editor.ts) + [`cst-editor.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/cst-editor.ts) + [`mov-editor.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/mov-editor.ts) (44 tests) | the write half the [browser editors](../editors/README.md) are built on, over a SYNTHESIZED puppet, audio bank, set, shop, stage, cast and movie — built by the library's own writers (`src/df/*-build.ts`, see [the write path](../formats/README.md#writing-one-back)), so these seven run without `gamefiles/` and check the editors' edits against files the write path produced. Structure-preserving read → write, byte-identical write → read → write, the SHP/v41/frame codecs round-tripping (the frame encoder also proved self-contained, by decoding into a deliberately poisoned buffer, and to carry a Z layer over), and each edit (subtitle text, frame art, track name, chunk identifier, loop order, set/scene/view/road names, default start, hotspot identifier and rectangle, actor mark, shop/prop/state names, frame degree and anchor, flat name, region name and rectangle, member and pose names, sprite anchor, frame name, frame and region action codes and names, region rectangle, action-frame slots, the ESC flag) touching exactly its own field — in the bytes *and* in the parsed structure the editor draws from. The shop suite also pins the one case where those two can disagree: a state whose play-order table reverses its frames, where an edit made through the reordered view has to land on the record that frame came from. The movie suite pins a NEGATIVE result rather than a feature: it hand-builds a frame that holds the picture before it (row mode 10 — the mode our own encoder never emits) and shows that replacing the frame under it changes what it decodes to, which is why the movie editor offers no art replacement. It also builds a **chain of segments** and checks both halves of what that costs: each segment reads its own header, frames and action-frame slots, and an edit aimed at a later segment lands there and leaves container 0 byte-identical — which is exactly what the patches did wrong while they hardcoded it |
| [`mov-format.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/mov-format.ts) (3 tests) | the [MOV](../formats/mov.md) facts recovered from the demo build's movie loop, against the **shipped corpus** rather than a synthesized file — because these are claims about what the authors wrote, and a file we wrote ourselves cannot contradict them. A movie is a chain of segments and a segment can carry cues (`tour.mov`: 20 segments, and the one cue record in any shipped tree, which is what leaves its authored ship's-logo loop), the letterboxed films name their own screen origin (512×264 at (0,60)), and `leave.mov` is the whole sinking montage rather than the 70 frames container 0 shows. Each skips when the tree it needs is not installed |
| [`df-build.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/df-build.ts) (5 tests) | the shared write-path scaffolding the seven builders rest on: a container's index is handed back as it is allocated, a reserved container stays writable after later ones exist (a header names what follows it), a gap reads back as a gap, the field writers agree with the readers — doubles big-endian, everything else little — and the palette block puts each channel value in the high byte where `paletteToRGBA` looks for it |
| [`script-encode.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/script-encode.ts) + [`lang-chooser.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/lang-chooser.ts) + [`files-lang.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/auto/files-lang.ts) (28 tests) | the authoring path and the language axis, all three without `gamefiles/`. **`script-encode`**: the opcode table is 1:1, tokens → bytes → tokens is the identity over every token kind, the string pool is shared and offsets are segment-relative, what cannot be encoded throws, and assembled source parses into the handlers it declared (including a handler named after a command). **`lang-chooser`**: the generated `lang.stg` read back (two flats, a region per language, art decoding at 512×384, non-overlapping on-screen rectangles, a script behind every button), then the screen *played* through a real `GameSession` with no set and no BOOTFILE — a click runs the button's own compiled `mousedown`, the number keys run the flat's own `keydown`, a language with no data behind it is refused by click and undone by key, and closing hands the stage back. **`files-lang`**: which URL a basename resolves to, per language and per disc, with a fake manifest and a fake `fetch` — the active language across both discs, then the neutral tree; a language switch dropping that language's cached bytes but not the neutral ones; and the shipped saves picked from one tree |

The suite boots real `GameSession`s and drives a **virtual clock** — no DOM,
no wall time, no audio output (the
[`NullAudioSink`](../runtime/audio.md#sinks-browser-vs-headless) records what
would have played, and reports every non-looping play as done the instant it
starts, which is what keeps it deterministic; a suite that needs sounds to take
time brings its own sink, as `sound-channels.ts` does). **Prefer extending
`regression.ts` over throwaway tests.**

## Running the playthrough

```
npm run test:playthrough                  # all 27 segments, headless, ~75 s
npx vitest run tests/playthrough/playthrough.ts -t "playthrough 13"   # one segment
TAOOT_RECORD=1 npx vitest run tests/playthrough/playthrough.ts        # re-record the goldens
```

Checkpoints are written to `out/checkpoints/` as `.ti` files, one per segment,
and are what a filtered or fresh run resumes from when there is no live game to
continue ([why a run has two modes](../verification.md#one-game-carried-not-a-chain-of-loads)).
The routes are
[`segments.ts`](https://github.com/dhobi/taoot-web/blob/master/tests/playthrough/segments.ts),
one function per segment; the segment-by-segment table of what each crosses is
**[the route](route.md)**.

## Running the browser suite

```
npm run dev                               # in another terminal — it needs a live server
npm run test:browser                      # the whole route through a real page, ~39 min
npm run test:browser:m0                   # segment 1
npm run test:browser:m1                   # segments 2–6
npm run test:browser:m2                   # segments 7–16
SEGMENTS=13 npm run test:browser:seg      # one segment
```

**Run it on its own** — it waits on real frames, so anything else using the
machine changes what the game does rather than merely slowing it down. No second
browser, no `vitest`, no docs build alongside it.

### Watching it play

```
npm run dev
npm run watch:playthrough                 # a real window, slowed down, stays open
npm run watch:mission0                    # the boot, the flat, the bomb, the crossing
npm run watch:mission1                    # skip the boot, watch all of mission 1
npm run watch:mission2                    # ...and all of mission 2
npm run watch:m1p0                        # just the segment that starts at phase 0
npm run watch:m1p1                        # ...phase 1
npm run watch:m1p2                        # ...phase 2
npm run watch:m1p3                        # ...phase 3
npm run watch:m1p4                        # ...and mission 1's debrief
npm run watch:m2p0                        # ...and the start of mission 2
HEADED=1 SLOWMO=400 KEEPOPEN=0 npx tsx tests/browser/playthrough.ts
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
[a golden speaks for one mode](../verification.md#one-game-carried-not-a-chain-of-loads).
The segment's own assertions still run either way.

## Standalone scripts (run with `tsx`)

These have top-level side effects, so they're outside the Vitest run:

```
npx tsx tests/browser/playthrough.ts                # the playthrough route, in a real browser
npx tsx tests/browser/menu-movie.ts                 # screenshots + state dump of the menu movie flow
npx tsx tests/browser/lang-chooser.ts               # pick a language in a real browser, then check what the boot reads
npx tsx tools/parse.ts                              # parse the whole script corpus, report coverage
npx tsx tools/navdump.ts gamefiles/en/titanic2/DATA/b59.set out/   # navigation dump (PNG per step)
```

`browser/lang-chooser.ts` needs two or more language directories under
`gamefiles/` and skips (exit 0, with the reason) when the install has fewer: it
clears the remembered choice, waits for `lang.stg` to come up *before* the landing
screen, clicks a language's region with a real mouse, and then asserts the thing
only a browser can be asked — that every `gamefiles/` request from the choice
onwards comes from the chosen tree. The other browser suites pass `?edition=`
(from `TAOOT_LANG`, default `en`) so the chooser never blocks them.

The two older browser scripts are not the same kind of thing.
`browser/playthrough.ts` asserts — it diffs a live page against the golden
trace. `browser/menu-movie.ts` asserts nothing: it drives the Scene51/View65
menu flow through `window.dbg` and prints state plus screenshots, which is what
you want when a movie misbehaves and you need to see it. `parse.ts` and
`navdump.ts` inspect the corpus rather than the port, which is why they moved
to `tools/`; `parse.ts` is the source of the ["100% of the corpus
parses"](../formats/script-container.md) claim.

Back to the [reference index](README.md).
