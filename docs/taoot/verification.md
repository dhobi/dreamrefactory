# How we know it's right

*Prerequisite: [Engine architecture](../engine/architecture.md).*

A reimplementation can look right and be wrong in many quiet ways: a cursor that
resolves to the wrong thing, a global that starts at `""` instead of `"none"`, a
timer that never fires. This page describes how the claims in these docs are
checked.

Everything under
[`tests/`](https://github.com/dhobi/dreamrefactory/tree/master/taoot/tests) runs
**headless against the original game files** (a local `gamefiles/` copy), in
three categories with three different budgets. The inventory of what each suite
covers, and the commands to run them, is
**[the test reference](../reference/tests.md)**; this page covers what each
category is good for and what it has caught.

In short: the automatic suite jumps to a state and probes it, and the
playthrough plays the game from the cold boot to the closing narration without
ever calling `jumpTo`. The two find different bugs.

## Determinism: what a run must not depend on

Only
[`harness.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/harness.ts)
sits above the three categories — a real `GameHost` over the on-disk game files,
which the automatic suites and the playthrough both boot.

`newHost` does two things relevant to reading a failure. It takes the **audio
sink** as an argument, so a suite that needs sounds to take their real length can
bring its own clock-driven one; and it **seeds the session's random streams**
(`session.seedRandom`), since unseeded `random()` draws make a run a coin toss.
For example, C73's `openset` arms the door-knock loop and `smethknock` re-arms
itself `60 + random(180)` ticks out, so whether a knock cricket is outstanding at
the tick `regression.ts` counts them depends on the draw: unseeded, that test
fails about **two runs in five** in a full suite and passes alone, which reads
like a regression from whatever else changed.

### Two streams, because the clock must not re-roll the story

There are **two** seeded streams, and one entry point that seeds both.
`session.rng` is what a script's `random()` draws from. `session.ambientRng` is
what the engine's own ambient timers draw from — currently just cricket re-arm
jitter (`Scheduler.rand`).

`TI.EXE` has one `rand()`, so a single shared stream would be the more literal
arrangement, but it couples the story to timing. Measured over carried segments
1–5: the crickets draw **4 times** and scripts draw **834** — and
`steam1`/`steam2` (BOOTFILE container 2, the corpus's only jittered crickets)
re-arm on the **clock**, so those four draws move whenever dwell time moves, and
moving them re-values all 834. With a shared stream, un-shadowing `trackbut` left
the script draw *count* unchanged — 834 either side — yet flipped the Gorse/Jones
coin and reshuffled the crowd extras, because four ambient draws landed in
different places in the sequence. Any engine change that altered dwell time
forced a golden re-record.

The ambient stream is still **seeded**: a cricket writes its name to sound channel
2, `currentsound(2)` is script-readable, and that is how the bedsit landlady
sequences her five lines. `seedRandom(seed)` seeds both from one number, so they
cannot drift apart. The split gives up a fidelity point no script can observe —
which value a draw returns is arbitrary either way, and the original seeded its
`rand()` from the clock, so its sequence could never be matched. In exchange, an
engine change with no effect on what scripts ask for has no effect on what they
get. Introducing the split moved only the harness-paced counters, the crowd
extras, the smokestack maze, the plant's two accumulators by 4 units with the
fixed point intact, and `min`/`clock` by a tick.

## The playthrough: the game played, not probed

[`playthrough/playthrough.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/playthrough/playthrough.ts)
is a different shape from the scenario suites. Those jump to a state and probe
it; this one drives the game the way a player does and never calls `jumpTo`. It
runs from the cold boot to the closing narration in **27 segments** — the routes
themselves are
[`segments.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/playthrough/segments.ts),
one function per segment with the reading of the scripts it was written from in
its header, and the segment-by-segment table of what each one crosses is
**[the route](../reference/route.md)**.

What it asserts is a **recorded state trace**
([`engine/src/runtime/trace.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/trace.ts)):
every script global, the room, and who owns what, sampled at each story beat.
The route is the input, the trace is the expectation, and a divergence names
the beat it happened at rather than surfacing three missions later as a missing
door.

It also **wins**. The closing narration comes out `mission = "good"` — the arm of
`futures()` that needs all three ending flags down, which means all four scored
artifacts out of Vlad's hands ([what the ending is scored
on](mission-flow.md#what-the-ending-is-scored-on)). The good ending is the branch
with the most game behind it, so a route that reaches it exercises more of the
corpus than one that merely survives to the credits.

Two things make a run reproducible: `session.rng`
([`rng.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/rng.ts))
seeds the `random()` draws the plot makes (the bomb delay, the arrival second),
and `session.modalMovies` gives the harness TI.EXE's real blocking `playmovie`
— without it the boot walks straight past the main menu.

### One game carried, not a chain of loads

Segments are not joined by savegames, because **a `.ti` round trip is lossy in
both directions**. It imports the shipped save it is patched over (`oldset`
"c73", `deckc.trk` playing in the bedsit, `clock` "startdisk1") and it drops what
the running game holds: `handitem`, the twelve globals of the engine-room plant,
and `actorvalue`, which has no field in the actor record at all — measured across
four shipped saves, where only the owner moves. Chaining by loads would mean
twenty-six boundaries, each losing state no player loses.

So **one session is carried** from segment to segment and a load is the fallback.
A segment continues the live game when the previous test left it standing exactly
where this one begins, and loads its checkpoint otherwise — which happens in a
filtered run (`-t "playthrough 13"`), a fresh process, and any segment after one
that threw. The checkpoints exist so that a late failure can be reproduced
without replaying the whole story.

Two consequences to know before reading a result:

- **A golden speaks for one mode.** A carried run and a loaded one disagree on
  about fifty globals while agreeing on every one that carries the story, so
  comparing across modes would fail on all fifty and mean nothing. The goldens
  hold the carried trace, all of them; when the run's mode differs — a filtered
  run, or a segment after one that threw — the comparison **stands down with a
  note** and the segment's own assertions carry the run.
- **The boundary tidies up, as a load would.** A `.ti` holds a set, a scene and a
  view and no flat, so `resume()` always comes back to a clear room; a carried
  segment could otherwise end with the Enigma machine open or a clip parked.
  `handBack` does what a player does before walking off: abort a parked clip (the
  only way out of one that doesn't run its action frame) and close the flat on
  whichever exit it carries. Scanned across every STG in the tree, that is not one
  name — **33 flats close on `ok`, three on `exit`** (the Enigma, whose keyboard
  takes 26 of its 27 regions), **two on `quit`, two on `back`**.

The gate plays **1…27 in order, carrying throughout**, and every golden is
recorded from a carried run — `LOADS_IN_A_FULL_RUN` is empty. There is no
segment that trades Clariss's shawl for the real necklace in the turbine room: it
would have to branch off the `m4geo` checkpoint the ending segment also starts
from, and it spends the Gorse-Joneses' one-shot lifeboat offer the ending needs.
The necklace sub-plot in mission 1 phase 4 supplies that necklace instead.

Carrying exposes a class of harness bug in which the route leans on a load to
tidy up. The known cases: counting the harness's own punches instead of reading
the game's `firstpunch`/`secondpunch`/`thirdpunch` history in the fight; a flat
left open across a boundary; the turbine plant settling one unit away and
conserving (17218 + 40692 is 17219 + 40691, the same equilibrium — so the four
**levels** get a tolerance and the flows stay exact); input dropped while a
carried game is still settling where a loaded one arrives quiescent; and
`lastsail`, a frame stamp whose name doesn't end in "frame", masked with the
other harness-paced counters below.

### What the comparison drops

`comparable()` removes the globals that count how long the **harness** dwelt
rather than what the game did: `sec`, `secframe`, `clockcount`, `attentionspan`,
anything ending in `frame`, `lastsail` and `bjtime`. Measured: when one gesture
stopped waiting out a timeout it could never satisfy, 15 segments changed and the
only fields that moved were those — `hrs`, `min`, `clock`, `phase`, `mission` and
`sinkflag` all held. That is the boundary the list draws: the minute hand and
everything the sinking runs on stay asserted, so game time running slow still
fails a golden; only the sub-minute noise is dropped. `lastsail` is 0 for twelve
segments, ~7474 through the fencing bout, never again, and 7473 against 7481
across two identical runs.

**Both comparisons import that list from one place**
([`engine/src/runtime/masks.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/masks.ts)),
so the headless and browser lists cannot drift apart. Anything either suite masks
*alone* has to say so at its own call site.

That file holds **two** predicates, because they are two different claims.
`isHarnessPaced` is the list above — a counter nothing reads, dropped by both
comparisons. `isCoinFlip` (`jonesphase`/`joneshint`/`jonesvalue`) is a value the
story *does* read, and it is dropped by the **browser** comparison only; the
headless golden **asserts it**. The browser mask's cost is stated where it lives:
`joneshint = 1` is read by a branch — `HALLC.SET`'s port-side door summons Burns's
puzzle puppet instead of opening onto C78 — and masking the flag does not mask
that, since the puppet, `burnsphase` and every owner they move stay compared.

### The same route, in a real browser

[`browser/playthrough.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/browser/playthrough.ts)
replays the *same* routes through real mouse and keyboard events against a live
dev server and diffs against the *same* golden traces. Everything the two share
is identical by construction, so a divergence is by elimination a browser-layer
fact — canvas coordinate mapping, DOM event plumbing, rAF pacing, or the live
disc switch. It masks strictly more than the headless comparison does, because
two hosts at one instant disagree about more than one host does over time. Every
family has the same shape — a value whose reading is a count of frames or a draw
the two hosts are not in step on:

| masked | why |
|--------|-----|
| the game clock (`clock`/`hrs`/`min`/`sec`/`clockcount`/`secframe`/`idlecount`) | see below |
| the frame counters (`attentionspan`, `…frame`) | how long the host dwelt |
| `ladycount` and the `twocount`…`fivecount` stock-line rotators | ambient sequencers — how often a character brushed you off unprompted |
| the plant's four water levels | conserved sum, same equilibrium (17218 + 40692 is 17219 + 40691) |
| `playerpower`/`vladpower` | 123 blows against 121; what the fight *decides* is compared |
| `willieblock`/`willieside` | re-rolled from `random()` every five ticks during a bout |
| the maze the smokestack draws | `random(4)` at the door, and the route solves whichever it gets |
| the Gorse/Jones coin (`jonesphase`/`joneshint`/`jonesvalue`) | `jonesok` ends `if random(100) < 50`, one draw off the script stream, and two hosts do not dispatch the same number of idle-driven scripts. Headless asserts it |
| **which** extras stand on a room's extra marks | the marks are still compared, so "someone is standing there" is asserted; only the names are dropped |

The Gorse/Jones coin is the one row the story reads, and it is the declared
exception, at the cost [stated above](#what-the-comparison-drops). Everything else
is a reading nothing in the game consults. The clock
(`clock`/`clockcount`/`sec`/`secframe`/`min`/`hrs`/`idlecount`): BOOTFILE's
`calctime()` runs once per idle pass, so what it counts is time the host spent
idle — real seconds in a browser, next to none in a pumped run. The reading
differs; what the clock *decides* does not, because `canadvance()` pins hrs/min
at each mission-4 threshold until the sinking movie has played. That pin is not
gated on `hasRealFrames`: such a gate freezes the sinking in the host that writes
the goldens, and the endgame then cannot be replayed in a browser.

**The browser run carries one game too**, for the same reason the headless one
does. The page boots itself ("[straight into the
game](../engine/runtime/host.md#the-page-and-going-straight-in)"), so a fresh `goto`
leaves `session.track(host.coldBoot())` suspended on `playmode.mov` **parked on
its GAME/TOUR regions** — and a parked movie is a question, so that dispatch
never resolves on its own. Loading a checkpoint on top of it restores the right
game behind a script that is still in flight: `scriptBusy` stays true, nothing is
`awaitingInput`, `quiescent` never comes, and every segment but 1 times out at its
own checkpoint (300 s), reporting the state it should have had (c73, `deckc.trk`,
9:30) as the state it is stuck in. Segment 1 is unaffected because it *plays* the
boot, and at the parked menu `awaitingInput` makes the boot read as quiescent.
Headless does not hit this: `resume()` loads into a host that never booted.

The bridge is what a player does, because it is the only thing a player *can* do —
the boot menu offers Play and Guided Tour, `opengame` lives on the in-game CTL
panel, and a save is never loaded from anywhere but a running game. So: press
GAME, wait for `boot()` to hand over, *then* load (8.9 s). With carrying on top,
the last measured full run is **90 beats over 27 segments, 2348 s, 26 hand-overs
and zero checkpoint loads**, ending on `credits.mov` — the game is playable start
to finish through real DOM events, in one continuous game, to the good ending. A
load happens only when a segment throws, because a throw clears the hand-over and
the next segment must not be given a half-played game.

Cost, measured, for the segments timed individually in a browser: segment 1
**~59 s** (pressing `Esc` through cutscenes and taking the deck map instead of
walking), segment 2 ~47 s and segment 3 ~85 s. Segment 4 is ~105 s, of which 20 s
is the turbine plant settling and cannot be hurried: it is a simulation iterating
on a timer. Segment 5 is ~220 s — it crosses the ship twice, A deck to boiler 3
and back, and every deck of it is a walk animation playing out — and segment 6
~39 s. The two minigame segments dominate the back half (the fight is 121
punches).

`Esc` aborts the movie playing and the rest of its chain with it
([why, and how it was recovered](../engine/formats/mov.md#escaping-a-movie)). Both
drivers expose it as `skipMovie()`, and both get it by sending the *key* — the
headless one calls `keyDown(".", true)`, the browser one presses a real Escape —
so a route exercises the same routing a player does rather than a back door.

Routes don't call it directly; they call `nav.rush(until, what, budget)`, which
waits for something the engine is going to do on its own and presses Esc past
every clip on the way. The rule it keeps is one line:

> skip a movie that is **playing and not waiting**, never one that is waiting.

A movie parked on its click regions is the engine asking a question, and its
answer is story — the boot menu's `GAME`/`TOUR`, the wireless telegrams, the `OK`
plaque on a London close-up. A movie running its frames is the engine showing you
something. So `rush` walks the intro logos and stops at the menu without being
told where the menu is.

The London close-ups are the exception: they are movies, they are long, and the
route clicks them through by hand. `BEDCARDS.MOV` pays **+3 on each of its two
action frames** — six of the eleven points that arm the bomb — and `BEDSIT1`
reads `actionframe(1)` only after `spotmovie` returns. Esc before those frames is
a lower score, exactly as it would be for a player.

The harness **skips lines the way a player does**. The original lets you click
through speech, and the engine implements it — `PuppetCtrl.puppetSpeak` races
each line against a click. Two gesture shapes defeat it: a skip that then waits
for the room to go quiet skips one line and sits through every remaining one, and
a bevel click that waits for quiet waits for the *next* plaque, i.e. plays the
whole reply. Both gestures return as soon as the click has been taken, and the
settle treats "someone is talking to you" as a place to stop — so a route clicks
through dialogue at the pace a player would.

**Run the browser suite on its own.** It waits on real frames, so anything else
using the machine changes what the game does rather than merely slowing it down,
and a starved run fails in ways that read like engine bugs. One run at a time,
nothing alongside it — no second browser, no `vitest`, no docs build.

Contention is not, however, an explanation for a failure. A phase-dependent bug
(the scheduler bug below) looks like load sensitivity, because load changes the
phase. A failure needs a measurement before it gets a cause.

### The heartbeat that poisoned its own service pass

One scheduler bug produced two browser intermittents: segment 1's air raid never
coming, and segment 3's inventory bag stuck in `lightopen`. Both are a
`period > 1` timer loop that never fires — the bag's flat opens from
`makeloop("prop", me, "doinven", 6)`, not from the click, and `bagidle()` is
false meanwhile so clicking again is ignored by design.

`serviceGameClock` dispatches BOOTFILE's `calctime` through `session.track`, which
adds to `inflight` **synchronously** while the promise settles in a microtask. It
ran BEFORE the service steps in the same task, so `fireDueLoops` saw
`session.scriptBusy` true — because of the dispatch the scheduler itself had just
started — and skipped firing. `CALCTIME_MS` and `ENGINE_STEP_MS` are both 50 ms,
so the two are phase-locked. The fix is one reordering: wind the pocketwatch
LAST, after the steps.

Three points generalise:

- **`scriptBusy` reads false to anyone who asks from outside a tick.** By then the
  microtask has drained and `inflight` is empty. It is only true at the one moment
  that matters, so a `settle`, a devtools expression and a test probe all report
  nothing busy.
- **The symptom is a stopped clock, not a stopped engine.** Input dispatches, rAF
  work runs, walks animate — only coarse loops freeze, so it does not look like
  the scheduler.
- **Sampling around a gate proves nothing; count the gate.** Instrumenting
  `fireDueLoops` to count how often the loop is *seen due* against how often it
  *fires* gives **569 and 0** on a frozen run, against `0 due, 1 fired` on a
  healthy one.

The browser run must not wait by polling from Node. A settle can be minutes long,
and sampling the mirror across the wire every few milliseconds for minutes can
take the page down — the run dies mid-segment with "target page has been closed"
and no page error. Predicates that are engine flags run inside the page
(`page.waitForFunction`), and the mirror is sampled once, when the wait ends.

## What the playthrough is for

Two things, and they pull in different directions. The first is demonstrating
that a bot can play the game at all. The second is finding bugs that only appear
when the game is *played* — which is only worth anything if the harness never
reports a success it didn't achieve.

Examples of the discipline that requires:

- `clickHotspot` sweeps for a point the engine's own hit test resolves to the
  hotspot, and answers false when there isn't one. Aiming at the centre of the
  rectangle is wrong: actors sit in front of hotspots in the click order, so the
  middle of the wireless doorway belongs to Morrow, who is standing in it, and a
  "successful" click opens a conversation instead of a door.
- Routes say which movie region they mean by what it *does*
  (`clickMovie(r => r.type === 2)`). Clicking whatever sits under the OK plaque
  fails on the wireless message stack, where that region pages to the next
  telegram, so the route leaves without reading the one it came for while
  reporting that it had.
- A `hunt` reports "the click landed", not "I clicked"; the weaker form hides
  harness bugs (such as aiming at a prop's transparent pixels) that look exactly
  like game bugs.
- **Landing is not working, either.** `inven.shp`'s `stdmouse` gates every object
  lying in a room on `realdist(what) < hotdist()`, so a click from across the room
  reaches the thing and is then thrown away — while `hunt` would still say `ok`,
  passing the failure to whichever later assertion notices the object was never
  picked up. A standpoint only counts when the click **moved** something
  (`clickStamp`: the screen-level four — set, flat, conversation, movie — plus
  `handitem`, the clicked thing's own owner/view/visibility/deg/value, and the
  globals minus the self-moving ones), and otherwise the sweep carries on and says
  `clicked X from N standpoint(s) and nothing moved — every one was out of reach`.
  The stamp is deliberately generous rather than exact: a global some loop moves
  inside the watch window can still fool it, but being stricter would refuse a
  click that worked. The playthrough **cannot** test this — the route is tuned
  standpoint by standpoint, so a green run makes no dud click and the branch never
  runs;
  [`auto/nav.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/auto/nav.ts)
  covers it with a stub driver, and against the old behaviour it fails with the
  exact false report (`{"ok":true,"gestures":1}`).

What it has caught:

**A mid-game save came back without your bag** — and with it the trunk key, which
`addbag()` is the only source of, making the trunk and the Enigma machine inside
it permanently unopenable and mission 1 unfinishable. `loadGame` restored the
interface band's held items; `snapshotSave` never wrote them. The bug exists only
on the boundary between playing and resuming, so no jump-and-probe test could
find it.

**An unclaimed `propowner`/`actorowner` read `""` where the scripts spell it
`"none"`.** Eleven scripts test `actorowner(x) = "none"` as "we have not spoken
yet" and none of them assigns it, so `"none"` is what the original must start
from. At `""` every one of those branches was dead: `CSEA1.PUP` fell through to
the chief engineer's brush-off line so the turbine job could not be accepted, and
Max never hailed Frank on the boat deck. The save path already normalised it on
the way out (`String(p.owner) || "none"`), so a *loaded* game answered correctly
and a freshly booted one did not.

**The scheduler's heartbeat suppressed its own timer loops.** `serviceGameClock`
ran before the service steps and left its `calctime` dispatch in `inflight` for
them, so `fireDueLoops` skipped firing on a phase-locked majority of passes. In a
browser that is a game where input works and time does not: the inventory bag
never opens, the London air raid never falls. The whole bug lives in the ordering
of two calls inside one tick, and `scriptBusy` reads false to anyone who asks
between ticks, so no jump-and-probe test could find it. Details
[above](#the-heartbeat-that-poisoned-its-own-service-pass).

**`exitcode` spoke for the whole dispatch, so the 2nd-class staircase could not be
climbed.** `eventConsumed` meant "any handler run during this dispatch executed
`exitcode`", and a handler routinely calls routines and fires other events that
`exitcode` for their own reasons. `STAIR2C.SET`'s deck rung calls
`setupshayhack()` and `setupcsea()` (both of which end in `exitcode`) and *then*
`passcode`s, so that the engine's default move can walk you up out of the
standpoint it just placed you on. The rung passcoded correctly; the flag was
already set, the walk never ran, and the next press threw away two decks:
`f e d c` then `c e d c e d c …` for ever, against `f e d c b a` with the flag
scoped to
[a handler of the event under dispatch](../engine/scripting-language.md#the-chain-and-how-an-event-is-consumed).
The route exposed it — the turbine room was a one-way trip, and the segment that
went down there was a leaf because of it.

**`propxyz` was setter-only, so nothing lying in a room could be picked up.** The
getter — the one-argument read — was not implemented, so it fell through into the
setter and parked the prop it was asked about at (4, 0, 0). `inven.shp`'s
`realdist(name)` is `calcdist(propxyz(name, 4), playerxyz(4))`, and **every object
lying in a room** goes through `if realdist(what) < hotdist()` in `stdmouse`, so
the answer came from a corrupted position and no world prop could be taken. The
earlier pick-ups are all inside flats, where a prop is "large" or a panel and
never goes down that path; the notebook at the top of the false smokestack is the
first small prop in a *room* the route clicks. Fixed to getter/setter by arity
like every other prop command (`propxy`, `propdeg`, `propzclip`, `propowner`,
`propstar` already were). `propxyz` has 43 calls in 27 files, which merits a
sweep of its own for the same shape.

**A click over a flat resolved the REGION before the PROP.** For any overlay flat,
`SetViewer.clickDispatch` ran the flat's named click regions before `clickProp`, so
a scripted region shadowed any prop drawn over it. The shipped boot gives the
order: `bootfile` 0001's own `mousedown` is `hittest` then `case "prop"`,
`case "button"`, `case "flat"`, which is the order `hitTestAt` answers in — so the
port's hit test and its click path disagreed, and anything aiming by hit test was
told a prop would take a click that then went elsewhere. `FUSE.SHP` container 3
confirms it: a prop hand-forwarding its own click to its own region by name, which
is only written if the prop is what the click reaches. The fix also closed an
unreported hole: `fusedoor` shut is 255×384 over all four fuse regions, so
region-first let a player flip fuses through a closed fusebox door, and the
regression test for it had that baked in.

**A room got three of `hittest`'s four answers wrong.** This was read out of
`TI.EXE`, because the corpus distinguishes labels the port was using
interchangeably. The handler is command id 20070 at `0x4277f0`, and
`npx tsx taoot/tools/disasmcmd.mts 0x4277f0:900` prints its six answers in the order it
gives them — the pushed literals are the words `result()` returns:

| zone | asked | answers |
| --- | --- | --- |
| the sprite list (`0x43abc0`), wherever the point is | is the name in a cast, or a shop? | `"actor"` / `"prop"` |
| the SET, if the point is inside the image it draws (`0x43ad50`) | a hotspot of this scene+view? (`0x409910`) | `"painting"`, else `"scene"` **by scene name** |
| the STAGE, where that image is not (`0x43ad20`) | a named click-region? (`0x446fb0`) | `"button"`, else the current `"flat"` |
| neither | — | `"None"` |

In a room the port had no sprite step (so the bag on the bed answered for the
room), labelled hotspots `"scene"`, and answered *nothing* for the room itself.
Each label is a different dispatch: a `"painting"` goes through
`sendtopainting(currentscene(), currentview(), …)`, which resolves it in the view
you are looking at, where `sendtoscene(thename, …)` resolves a name against the
whole set — and **141 hotspot names in the shipped tree carry more than one
script** (`bedsit1`'s `cabinet` has eight, one per standpoint), with twelve of them
keeping their handler on the scene script that route skips entirely.

The fourth answer was visible to a player. With the room answering nothing, a
click on the floor fell through to the *stage's* answer — the current flat — and
in-game that flat is `main.stg`'s `main 1`, whose `mousedown` is
`sendtoshop("house.shp", deactivateinterface())`. So clicking the carpet darkened
the watch, shut the bag, reset the nav arrow and played `lightoff`: the band's own
behaviour, reached from a place the shipped hit test never sends it.

Two differences the same disassembly shows are left alone, because measuring them
found nothing to fix: the sprite list is one draw-ordered list, so in `TI.EXE` a
prop and an actor compete by depth where the port always asks the props first —
but sweeping five rooms full of characters, the only prop that ever overlaps an
actor is the nav arrow, which is drawn over everything anyway. And the cursor twin
(`idle`) would ask a scene script for the room's cursor, where the port answers ""
— but all nine scene `setcursor` handlers in the tree are guarded on a painting
name, so there is no room in the game whose cursor this changes.

**An actor answers only where an actor is drawn.** Asking the sprite list before
the zone split is right for a *prop* — the interface band's props are
screen-space and take a click there — and wrong for an **actor**: a projected
sprite reaches below the room's image for anyone standing near the camera, the
renderer clips it at that edge, and an unclipped hit test answers `"actor"` over
the interface band for a character whose legs are not on screen. Measured by
sweeping the band (y ≥ 266) at every standpoint of four rooms: `gstair2` 1558
points, `b59` 1275, `recept1c` 1299, `deckbd` 0 — nobody stands close enough to
the camera there. No click *dispatched* that way (`clickActor` keeps its own
bound); the cost fell on every other reader of the hit test: `INVEN.SHP`'s drop
flow is `thename = hittest(arg); switch result() case "actor":
sendtoactor(thename, offerobject(what))`, so an item let go over the band was
offered to a character standing in the room behind it instead of being put back.

**The game's own dispatch routes a click.** With all six answers reachable and
correct, `BOOTFILE` 0001's own `mousedown` — `hittest`, then a switch on
`result()` into `sendtoactor` / `sendtoprop` / `sendtobutton` / `sendtoscene` /
`sendtopainting` / `sendtoflat` — routes a click, and the port's transcription in
`clickDispatch` stays only as the fallback for a title that ships no such handler.
This also required fixing `target`: `sendEvent` set it to the **caller's** `me`, so
a click routed by the boot reached `FUSE.SHP`'s main as `target = "boot"` and no
`switch target` dispatcher matched. It is the **addressee** for
`sendtoprop`/`actor`/`scene`/`flat` and their `fx` twins, but not everywhere: a
blanket change fails `fuse M3`, because `sendtoshopfx("house.shp", watchidle())`
addresses a *file*, where there is no thing being addressed and the caller's
context is what the handler reads. So: the addressee for a thing, the caller for a
shop, a cast, a stage, a puppet, the boot.

**A character could accost you through a close-up.** `gang.cst`'s `hasattention(4)`
sends a character's own `mousedown` after four seconds of proximity and asks nothing
about what you are doing — so four seconds inside the cufflink close-up and Max
Seidelman opens a conversation on top of the flat, `inputLocked` stays true until it
is answered, and the OK button is then pressed into a dead engine. The symptom was
"the OK closes headless and not in a browser"; the button itself was not at fault.
The fix is at the guard the data already has for it: `actordist` returns the 32000
not-present sentinel while the actor is not visible, and `hasattention`'s first
branch restarts the attention clock at 32000 — so being out of sight resets it
instead of running it down. Measured after: 105 s inside `cuff.stg` with his idle
running and no accost, against frame 122 before; and he still accosts in the
*room*, at frame 130.

Verified against TI.EXE, from the binary rather than DosBox. `actordist`
(`0x40e790`) answers 32000 whenever the actor→screen projection (`0x411180`, the
same routine the sprite pass uses) refuses, and one of its gates is the
`setvisible` global at `0x489f5a` — written by exactly one instruction in `.text`,
inside `setvisible`'s own handler — while BOOTFILE 0002 calls `setvisible(false)`
for every stage flat it opens over a set. So through a flat the original answers
the sentinel through exactly the chain above, and its accost machinery does run
under a flat (boot's `idle()` calls `forceupdate()` every pass, and
`forceupdate` *is* the loop service — the only two entries into it in the whole
binary are `forceupdate` and `visualeffect`). The port's other 32000 — during a
puppet conversation — is not what the original's `actordist` does: there the
conversation holds the script dispatch and nothing in its path services loops
(`puppetspeak`'s wait pumps ticks and yields, never the loop table), so the idle
that would ask never runs. Same observable by starvation instead of by answer —
and `hasattention` is the only caller of `actordist` in the shipped corpus, so no
script can tell the two apart.

**And a character could accost you from a deck below.** `actordist`'s answer is
whatever the projection at `0x411180` says, and that routine has a third refusal,
the last thing it does: it intersects the actor's sprite rectangle with the view's
(`0x435300`) and refuses on an empty intersection. Out of view is out of reach, and
nothing else in the accost path asks. The range gate the scripts do have is
`realdist(me) < hotdist()`, which is a **ground** distance across a set — and
`stair1c1` is one set holding two decks of the aft grand staircase, so Daisy
Cashmore standing on the B-deck landing is 1956 units from the A-deck standpoint
directly above her, well inside that room's 4000. Without the view test she walked
up through the floor and started talking (#180).

Seven standpoints measured in the original — six where nothing happens and one
where she accosts:

| standpoint | `realdist` | in range? | on screen? | original |
|---|---|---|---|---|
| Scene55/View74 | 1956 | yes | **no** | leaves you alone |
| Scene56/View66 | 2268 | yes | **no** | leaves you alone |
| Scene54/View69 | 228 | yes | **no** | leaves you alone |
| Scene43/View47 | 2837 | yes | **no** | leaves you alone |
| Scene23/View31 | 1086 | yes | **no** | leaves you alone |
| Scene101/View102 | 4896 | **no** | yes | leaves you alone |
| Scene43/View46 | 2837 | yes | yes | **accosts** |

Distance alone predicts the wrong answer at five of the seven; distance plus the
rectangle predicts all seven. Both gates are load-bearing and independent — the
sixth row is the one range catches and sight does not.

The same probe found `actordist` measuring across x and the **height** rather
than the ground pair (`worldZ` where `worldY` belongs), which is why Scene101
read 4101 for a standpoint 4896 away — the wrong side of `hotdist`. It went
unnoticed because the only two callers in the corpus are `hasattention`, which
compares the answer to 32000 and nothing else, and a `message()` in boot's
`idle` that prints it. The original does not answer a ground distance at all:
`0x411371` hands back the projected **depth** and caches it in the actor record at
`+0x28`. The port returns the distance, because it is the number a reader
comparing against `hotdist()` wants and no script can tell.

**`actorzclip` was read as a near-clip plane when it is an occlusion bias.** The
draw list culled an actor whose projected depth was under their `zclip`, and the
occlusion level ignored `zclip` entirely — the same expression used for the wrong
one of the two jobs. Every value in the corpus makes sense as a bias: `stdactor`
gives everyone 32 so a character standing at a scenery boundary isn't sliced by
it, the many negative ones (-200, -1000, -1500) push a character behind more of
the room, and `gang.cst` asks for **20000** in exactly one place — csea in
`control`, who stands behind the console and must be drawn in front of it. As a
clip plane that hid him from all twenty-four standpoints of the room (his depth
there runs 700..8300), and clicking him is the only route into `CSEA1.PUP`. The
cull was redundant anyway: `projectPoint` already answers null behind the camera.
Same fix on the world-prop twin.

## Routes name places, not pixels

A route says `travel("gym")` and
[taoot/tests/playthrough/nav/](https://github.com/dhobi/dreamrefactory/tree/master/taoot/tests/playthrough/nav)
works out the rest: the rooms (`shipgraph.ts`, extracted from every exit in the
scripts), the turns and walks inside each one (`setpath.ts`, whose geometry
comes from `engine/src/df/set.ts` — the same `turnRing`/`roadsAt` SetViewer uses, so a
planned turn and the turn taken cannot disagree), and the gestures
(`navigator.ts`, through a driver so headless pumping and real browser events
are both just implementations). Conversations are `talk({ say: [102, 101] })` —
the bevel ids the PUP script switches on — and nothing is picked implicitly,
because which answer you give is the story.

### Taking the deck map

Walking is not the only way across the ship, and from cabin C73 onward it is
rarely the best one: Smethells hands Frank a deck map, and pressing a **stairwell**
on it is fast travel the game itself provides. `travel(set)` uses it — jump as far
as the map goes, walk the rest — while `goto(set)` still walks the whole way, and
`jump(set)` is the map on its own.

The jump table is **extracted, not written down**: `taoot/tools/mapjumps.ts` reads
`MAP.STG`, decodes each plan's click regions (`engine/src/df/stg.ts`), and reads the
`jumpbaby("stair1c2", "scene112", "view116")` out of the script each region runs,
emitting `nav/mapjumps.gen.ts`. Regenerate with `npx tsx taoot/tools/mapjumps.ts`.

It also reads the `if` above the `jumpbaby`. Of the 32 red areas, **15 sit behind
`if not debugging → exitcode` and do nothing at all in a shipped game** — the
gymnasium, the lounge, the smoking room, the fore and poop decks are developer
shortcuts. The 17 that are live reach eight sets, and every one of them is a
staircase or a stair landing. So the deck plan takes you to the stairwell on a
deck and you walk from there; it is not a teleport into rooms.

Pressing a guarded area gets no answer, exactly as for a player, even though
`mapdisabled()` returns false, the `disable` overlay is hidden and the hit test
resolves the point to the right region — the refusal is the `if not debugging`
two lines above the jump. The gate test asserts that no emitted area carries that
guard, and that every reachable set is a stairwell.

Regions are pressed **by name**, not by coordinate: a flat region resolves through
the engine's own `hittest` as `{name, type: "button"}`, so aiming at one keeps the
rule the rest of the harness keeps — only ever click a point the engine agrees
*is* the thing. The tab of the plan you are already on **cannot be clicked**:
`gotopage` parks the `buttons` highlight sprite over it, and a sprite wins the hit
test against a region. A coordinate table would click the highlight and report
success.

`travel` also declines to jump when the game would. `mapdisabled()` is real
content — no bag or no watch (which is why the map is dead until segment 2 has
collected the pair), mission 4, the funnel tops, the boiler room, the cargo hold —
and being told "you cannot travel from here" is the answer a route wants, not a
workaround. Where it does jump it saves most of a leg: C73 to the gymnasium is ten
rooms on foot, and by map it is four clicks to the boat-deck stairwell and two rooms
— **17.6 s in a browser**, measured, with every hop it skips being a turn or a walk
animation playing out in real time.

A band click is also **dropped unless nothing is animating**: house.shp's bag
mousedown exits without acting unless `bagidle()` *and* `watchidle()`. In a browser
the pocketwatch runs in real time, so a click can land in that window, which shows
up as an intermittent browser-only failure. So opening the bag or the map retries
(`INTERFACE_ATTEMPTS`), the way a player clicks again, and "the bag would not open"
names the states that refused (`bag=… watch=… lid=…`).

### How the same route drives two hosts

A segment is written against
[`Story`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/playthrough/story.ts):
a `Navigator`, a `NavDriver`, and **synchronous** getters for the state a route
may ask about (`num("phase")`, `owns("watch")`, `deg("dial1")`). Headless those
read live. In a browser the engine is in another process, where every read is a
round trip — so
[`browser/driver.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/browser/driver.ts)
keeps a **mirror** of exactly that state, sampled in one `page.evaluate` after
every gesture and on every turn of every poll loop. A getter is therefore as
fresh as the last gesture, which is the only moment a route reads anything.

Two things deliberately do *not* cross into the page. The parsed SET a plan is
computed from is read from the same `gamefiles/` tree the page is served from and
parsed in Node — shipping turn rings and view tables over the wire per gesture
would be wasteful, and the bytes are identical by construction. And the trace is
produced by the page's own `snapshotState`, handed out through `window.dbg`
rather than reimplemented, so a browser beat and a headless beat are the same
function over the same state.

What *does* cross is every gesture, as a real Playwright event: arrow keys for
turning and walking, a mouse click at a canvas pixel the page's own hit test
resolved to the thing being clicked, and — for using an inventory item — a
press, a twelve-step move and a release, because `inven.shp`'s `while stilldown()`
loop reads the pointer every frame and a jump from press to release would drop
the item where it was picked up.

The turbine plant needs a fourth gesture, `dragProp`: take hold of a prop and
walk the cursor wherever the caller says, deciding each next point from what the
last move *did*. `TURBINE.SHP` holds the input for as long as the button is down
and moves each dial by a fixed step in whichever direction the cursor has swung
about its pivot — so a setting is an arc, not a click, and the dial is a ratchet
rather than a pointer. Two properties of that make it portable
([`nav/dials.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/playthrough/nav/dials.ts)):
a cursor that does not move does not move the dial, so extra frames are free and
the two hosts turn it by the same amount; and the arc has to stay on the canvas,
because a browser only sees a `mousemove` while the cursor is over it, and an arc
that swings off the edge stops turning the dial while looking like it is working.

Waiting is the subtle half. A fixed sleep between moves is not enough — the pump
dials run their loop at `framerate(2)`, so a read can describe a swing that
hasn't been consumed yet and the dial takes one more step *after* the sample
that said it had arrived. The dwell waits on `session.realYieldSeq`, which
`stilldown` bumps once per turn of the holding loop, and the route takes hold
again if the dial still isn't on the number — which is what a player does.

### When a gesture is finished

Both drivers treat a gesture as settled when

    quiescent || conversing

`quiescent` is `awaitingInput || !inputLocked`, and a visible puppet makes the
viewer busy. The narrower `quiescent || (conversing && !awaitingChoice)` excludes
the state a puppet spends most of its life in: whenever a gesture's
*consequence* is a puppet showing plaques, neither half holds and the settle
pumps until its budget runs out. A conversation waiting for the player is as
settled as this game gets, and waiting for it to go quiet is waiting for
something only another gesture can cause.

Measured: the wider condition took the headless suite from 101 s to **55 s** for
the same segments — the difference was settles grinding out their budget against
conversations that were never going to go quiet, each after a gesture the route
had already completed.

Two smaller rules from the endgame generalise. `nav.accost` is `hunt` judged on
the answer rather than on the click landing, because Zeitel stands 7782 from the
standpoint the lounge door leaves you at against a `hotdist()` of 3500 and the
boat deck's is 500, the tightest in the game. And `resume` **fires the load and
pumps it** instead of awaiting it first: a room may `delay()` while it opens, a
delay suspends on a clock only pumping advances, and the first-class lounge is
such a room — otherwise it presents as a test timeout with no message.

## Where the evidence runs out

Nothing on this page is an argument that the port is finished. Two places say
plainly where a claim stops: the language axis has its own
**[what has not been tested](languages.md#what-has-not-been-tested)**
section, and the save format names the one claim only DosBox can settle in
**[what is verified, and what is not](../engine/formats/savegame.md#what-is-verified-and-what-is-not)**.

To run any of this yourself, see **[the test reference](../reference/tests.md)**.
