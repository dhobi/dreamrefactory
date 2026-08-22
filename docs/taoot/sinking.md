# The sinking — how mission 4's clock runs

*Prerequisite: [Timing](../engine/runtime/timing.md) and
[The mission flow](mission-flow.md#the-endgame-is-a-countdown).*

Mission 4 is the only part of *Titanic* that plays against a clock, and the clock
is on your wrist: the pocketwatch in the interface band is not decoration, it is
the countdown, and reading it is how you know how long the ship has left.

This page is about what moves that clock. The short version is that it is **not a
timer**. It counts engine passes, and a few things in the game's scripts reach in
and nudge it — including, surprisingly, walking around.

## The clock is four globals and a counter

`hrs`, `min` and `sec` are ordinary script globals, and the watch is three props
in `house.shp` (`hrs`, `min`, `sec`) pointed by `propdeg` at the matching number.
`clockcount` is the fourth, and it is the interesting one.

Everything happens in the BOOTFILE's `calctime()`:

```
clockcount = clockcount + 1
if clockcount >= 20
    clockcount = 0
    sec = sec + 1
    ...
    clock = hrs * 100 + min
    advancephase ()
endif
```

`calctime()` is called from `idle()`, once per main-loop pass, and **one game
second is 20 calls** — not 20 milliseconds-worth, 20 *calls*. A pass is 50 ms
([Timing](../engine/runtime/timing.md#two-time-bases)), so 20 passes is one real second and the
second hand ticks once a second. That equivalence is a coincidence of the frame
rate, not a definition, and everything odd about the sinking clock follows from
the difference.

`clock` — the same global whose *string* value drives the day machine — becomes
`hrs * 100 + min` here, a number, the moment the sinking starts. That is why a
mission-4 save restores a number where earlier saves hold `"startdisk1"`.

## The ship sinks at 1 pm

`advanceday()`'s `clock = "startdisk2"` arm deals the level:

```
mission = 4
phase  = 0
hrs = 13
min = random (4)
sec = random (60) - 1
calctime ()
sinkflag = true
```

So mission 4 begins at **13:00–13:03** with a random second, and the watch — a
12-hour face — shows it as 1:0X. Every run starts at a slightly different time,
which is worth knowing before comparing two playthroughs' clocks.

> **Fun fact: the game sinks the ship in the early afternoon.** `hrs = 13` is
> 1 *pm*, in broad daylight. The real Titanic struck the iceberg at 11:40 pm on
> 14 April 1912 and went under at 2:20 am on the 15th, so the timetable below —
> 13:15 through 14:05 — runs the whole endgame twelve hours off the disaster it
> is dramatising. Nothing in the game gives the mistake away: the watch face has
> no am/pm, `propdeg` points the hour hand at the 1 either way, and the only
> other consumer of `hrs` is the number `clock = hrs * 100 + min`, compared
> against thresholds (1315 … 1405) that would have sorted just as well from
> `hrs = 1` (115 … 205). Both halves of the day are free, and the authors
> picked the wrong one.

`sinkflag` is what arms the countdown: `calctime()` has two arms, and only the
`sinkflag` one calls `advancephase()` or ever touches `min` and `hrs`. Outside
mission 4 the watch's second hand sweeps and nothing else happens.

## Four things move the clock

| What | Effect | Where |
|------|--------|-------|
| **The heartbeat** | +1 second per 20 main-loop passes (≈ 1 game second per real second) | BOOTFILE `calctime()` |
| **Moving** | +1 second per scene entered *or view turned to*, at most once per 20 rendered frames | BOOTFILE `openscene()` |
| **Talking** | +2 minutes per conversation | `gang.cst prepuppet()`, `LNGHALL.SET doclaris()`, `house.shp`'s blackjack table |
| **Phase transitions** | the clock is *set* to the timetable's time | BOOTFILE `advancephase()` |

The second row is the one no travel guide mentions, and it is deliberate — it is
right there in the BOOTFILE, gated on the mission:

```
code openscene ()
	global mission, sec, secframe

	if mission = 4
		if frame () - secframe >= 20
			sec = sec + 1
			secframe = frame ()
			clockcount = 0
		endif
	endif
	...
```

Three things at once, and all three matter:

- `sec = sec + 1` — the extra second.
- `secframe = frame ()` — a throttle measured in **rendered frames**, not time.
  No more than one bump per 20 frames, however fast you move.
- `clockcount = 0` — the heartbeat's own accumulator is discarded, so the partial
  game-second in flight is thrown away and the next natural tick is a full 20
  passes off.

`openscene` in DreamFactory is a **per-view** event, not per-scene: it fires when
you turn to face a new view as well as when you walk into a new standpoint. (The
corpus agrees — 33 of the 51 shipped `openscene` handlers gate on
`currentview()`.) That is what makes turning in place cost you time.

### Why turning doubles the clock

Measured in this port, one turn takes **10 rendered frames** and one road takes
**14**. The throttle is 20 frames. So:

- **Standing still** — only the heartbeat: 20 passes per real second, one game
  second. **1×.**
- **Turning continuously** — `openscene` fires every 10 frames, and the throttle
  admits every *second* one: a bump per 20 frames, which at 50 ms a frame is one
  per real second. Whether that lands **on top of** the heartbeat's second or
  **instead of** it is the whole question, because a bump also does
  `clockcount = 0`. The video says on top (**2×**); the mechanism, worked through
  below, says instead of (**1×**), and 1× is what this port does. See [the model,
  derived](#the-model-derived--and-what-it-predicts).
- **Walking a road** — each new standpoint is one `openscene`, and a road is
  longer than 20 frames, so essentially every road bumps: **+1 second per scene
  reached**, on top of real time.

The road figure is exactly the rate measured off video of the original in
[#126](https://github.com/dhobi/dreamrefactory/issues/126) — about one extra second
per scene while travelling — and the arithmetic and the observation were derived
independently, which is the best evidence available that the bump is real and
that its throttle is in frames.

The turning figure is where the two part company. The same video shows the second
hand moving about twice a second while spinning in place, and the mechanism as
written gives once. That discrepancy is [#184](https://github.com/dhobi/dreamrefactory/issues/184),
and it is worked through at the end of this page rather than papered over.

The practical consequence for a player: **navigating badly costs you the ship.**
Hunting for a character you cannot find burns clock faster than standing still
does, and mission 4 is the one mission with [no deck
map](mission-flow.md#the-endgame-is-a-countdown).

## The timetable, and the hold

Every heartbeat tick that advances a second also calls `advancephase()`, whose
mission-4 arm is a schedule:

| game time | becomes |
|-----------|---------|
| 13:15 | phase 1 |
| 13:30 | phase 2 |
| 13:45 | phase 3 |
| 13:55 | phase 4 |
| 14:00 | phase 5 |
| 14:05 | `playerdeath = "by sinking"` |

Each step runs `sinkmovie()` — which **refuses** while a cast member is within
300 units or the camera is mid-turn — plays `sinkN.mov`, and re-opens the set one
deck further under water.

Because the movie can refuse, the clock has to be able to wait, and `canadvance()`
is how. It reports whether the clock has reached the current phase's threshold,
and `calctime()` branches on it:

```
sec = sec + 1
if canadvance ()
    if sec >= 60
        sec = 0            ; wrap, but do NOT carry into min
    endif
else
    if sec >= 60
        sec = 0
        min = min + 1
    endif
    ...
endif
```

So once the clock reaches a threshold, **the minute hand freezes and the second
hand keeps sweeping** until the phase movie actually plays. Walk away from the
crowd and the ship lurches; stand in a conversation and 13:15 lasts as long as
you like. It also means the phase boundaries are identical in every run — the
minutes are pinned to the timetable — while the seconds never are.

A phase transition then *sets* the clock (`hrs`/`min` to the timetable time,
`sec = random(60) - 1`), which is why finishing a conversation at 13:16 still
leaves you at 13:15 after the cutscene.

## What this port does today

The heartbeat is faithful:
[`serviceGameClock`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/scheduler.ts)
dispatches `calctime` every 50 ms of the host's clock, on both hosts — wall time
in the browser, the pumped virtual clock headless. It skips while a script is in
flight and re-anchors, as the original's `idle()` only ran between events.

The movement bump fires on both kinds of arrival. It did not always: a turn used
to run only the scene script's and the set main's `openscene` and stop short of
the **boot** scripts, which is where the bump lives, so turning in place was free
in the endgame ([#127](https://github.com/dhobi/dreamrefactory/issues/127)). The same
boot handler also rebuilds the nav arrow and the destination sign, and those two
*are* wanted on a turn — so `viewer.ts` re-derived them by hand instead. Two
thirds of a script handler reimplemented in the engine with the third third
missing; the fix was to run the handler and delete the re-derivations.
`SetScripts.viewChanged()` now uses the same chain scene entry does, and
`viewSettled()` is the arrival half on its own, for a movement that left nowhere.

Measured over 20 seconds of engine time at `lounge1c` Scene14/View37:

| | game seconds per real second |
|---|---|
| standing | 0.95 |
| turning continuously | 1.00 (was 0.85) |
| entering a scene | +1 per scene (`secframe` advances) |

**Turning still is not the video's 2×**, and the section below is why that is now
a statement about the *original* rather than about this port. A bump does not add
to the heartbeat, it *resets* it (`clockcount = 0`): the partial game-second in
flight is discarded, so a bump arriving before `calctime` reaches 20 replaces that
tick instead of joining it, and the sum is one second per 20 frames rather than
two. The original orders those two the same way we do — its own `idle()` draws the
frame before it winds the clock — so the mechanism it runs predicts 1× as well.

### The model, derived — and what it predicts

Two routes to 2× were on the table
([#184](https://github.com/dhobi/dreamrefactory/issues/184)): the original's *ordering
within a pass*, or a frame counter that *outruns* the pass rate during an
animation. The boot library settles the first, and the disassembly settles what
it was blamed on. Both are dead, and the model that survives predicts what the
port already does.

**`frame()` advances once per pass, whatever the engine then does.** It is the
counter at `0x489efa` — read off the `frame` handler at `0x4273b0`, which does
nothing but fetch it — and the only thing that moves it is `inc dword ptr
[0x489efa]` at the head of the master pass's tail routine `0x439b80`, above the
three-way branch that chooses how to draw. The pass itself is 50 ms, measured
rather than assumed: `0x43A940` spins until `framerate` ticks have elapsed,
`0x41DE90` is `GetTickCount() * 3 / 50` (60 ticks a second), and `framerate`
defaults to 3 (`0x429643`, clamped 0..60 by its setter). Nothing in the shipped
corpus calls `setframerate`. So 20 frames a second, and `frame() - secframe >= 20`
admits a bump once a second at most.

**The clock is wound after the frame is drawn — in the original as in this port.**
The boot library's own `idle()` says so in two lines:

```
code idle ()
	...
	forceupdate ()
	calctime ()
	idlecount = idlecount + 1
```

`forceupdate()` *is* the master pass (the engine's handler tail-calls `0x442550`),
so everything a pass dispatches — including the `openscene` a view change fires —
has already happened when `calctime()` runs. That is the port's order too:
`serviceStep()` and then `serviceGameClock()`.

**So the two are phase-locked, and the bump always lands first.** A bump sets
`secframe = frame()` and `clockcount = 0` in the same breath, so both counters
start from zero together and both come due 20 frames later. On that pass the bump
runs inside `forceupdate` and zeroes `clockcount`; `calctime` then raises it to 1.
The heartbeat never reaches 20 while you keep turning, and the bump does not add
to it — it replaces it.

`clockcount = 0` is not declared `global` in `openscene`, and it is a global
write all the same: an undeclared name resolves to an existing global, which
`clockcount` is by then (`calctime` declares it). `calctime`'s own undeclared
`clock = hrs * 100 + min` is the same rule, and the shipped saves carry its
result. This port resolves it identically (`Interp.setVar`).

**The model therefore predicts +1 second per 20 frames — 1× — and that is what
the port measures.** Not a bug reproduced: a mechanism reproduced.

### So where does the video's 2× come from?

Unexplained, and honestly so. For the sum to be 2 the heartbeat has to survive a
bump, and the only arrangement that allows it is `calctime` running *before* the
bump on the colliding pass — which `idle()` rules out.

The remaining candidate is that `frame()` outruns 20/second while the player is
moving, which would bring the bumps in faster than the heartbeat can be starved.
There is no evidence for it and some against: the throttle `0x43A940` is called
from exactly two sites, one of them inside the normal world draw `0x43A860`, and
every exit of the moving-player arm `0x43A440` that can be followed ends in that
same draw. The arm advances one animation step per pass (`inc dword ptr
[0x48A634]`, wrapped against the step count) — one step, one throttled frame.

Two leads this page used to name are now closed:

- **"`calctime` rides one arm of `0x439B80`."** It does not. `idle` is a script
  event the message loop dispatches; nothing in `0x439B80` dispatches it, and
  `0x43A860` is the ordinary world draw rather than "the idle branch".
- **"`0x4397B0(2)` is a delay whose behaviour under an animation is the open
  question."** It is not a delay. It is four instructions that raise the redraw
  level at `0x48A630` to at least its argument — the flag `0x43A860` reads and
  clears at the top of every draw.

What would settle it is a **measurement of the original**, not more code: the
second hand counted against a stopwatch in DosBox, standing still and then
turning continuously, with the DosBox cycle setting written down. If turning
really is 2× there and the mechanism above is what the engine runs, then one of
the rates in it is not what it appears to be, and knowing which needs the
original in front of you rather than the disassembly.

Until then the gap stands and is not guessed at. Putting a multiplier here would
put a number in the endgame's clock that no evidence supports, and the clock is
what the whole mission is scored against.

Next: the layer the watch is drawn into — **[Stage & UI](../engine/runtime/stage-ui.md)**.
