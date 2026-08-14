# The sinking — how mission 4's clock runs

*Prerequisite: [Timing](timing.md) and
[The mission flow](../04-mission-flow.md#the-endgame-is-a-countdown).*

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
([Timing](timing.md#two-time-bases)), so 20 passes is one real second and the
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
  admits every *second* one: +1 second per 20 frames, which at 50 ms a frame is
  +1 per real second, on top of the heartbeat's +1. **2×.**
- **Walking a road** — each new standpoint is one `openscene`, and a road is
  longer than 20 frames, so essentially every road bumps: **+1 second per scene
  reached**, on top of real time.

Those are exactly the rates measured off video of the original in
[#126](https://github.com/dhobi/taoot-web/issues/126): the second hand moves
about twice a second while spinning in place, and about one extra second per
scene while travelling. The arithmetic and the observation were derived
independently and agree, which is the best evidence available that this is the
whole mechanism.

The practical consequence for a player: **navigating badly costs you the ship.**
Hunting for a character you cannot find burns clock faster than standing still
does, and mission 4 is the one mission with [no deck
map](../04-mission-flow.md#the-endgame-is-a-countdown).

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
[`serviceGameClock`](https://github.com/dhobi/taoot-web/blob/master/src/engine/scheduler.ts)
dispatches `calctime` every 50 ms of the host's clock, on both hosts — wall time
in the browser, the pumped virtual clock headless. It skips while a script is in
flight and re-anchors, as the original's `idle()` only ran between events.

The movement bump fires on both kinds of arrival. It did not always: a turn used
to run only the scene script's and the set main's `openscene` and stop short of
the **boot** scripts, which is where the bump lives, so turning in place was free
in the endgame ([#127](https://github.com/dhobi/taoot-web/issues/127)). The same
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

**Turning still is not the original's 2×.** A bump does not add to the heartbeat,
it *resets* it (`clockcount = 0`): the partial game-second in flight is discarded,
so a bump arriving before `calctime` reaches 20 replaces that tick instead of
joining it, and the sum is one second per 20 frames rather than two.

### What the disassembly rules out

Two routes to 2× were on the table
([#184](https://github.com/dhobi/taoot-web/issues/184)): the original's *ordering
within a pass*, or a frame counter that *outruns* the pass rate during an
animation. TI.EXE settles the first one, in the negative.

`frame()` is the counter at `0x489efa`, and the only thing that moves it is the
master pass's tail routine `0x439b80` — read straight off the `frame` handler at
`0x4273b0`, which does nothing but `mov ecx, [0x489efa]`. That routine is:

```
0x439b80: inc  dword ptr [0x489efa]     ; frame++, BEFORE the branch
0x439b86: cmp  word ptr [0x489fd8], 0
0x439b8e: je   0x439ba8
0x439b90: cmp  word ptr [0x489fda], 0
0x439b98: je   0x439ba8
0x439b9a: call 0x43a940                 ; ─┐
0x439b9f: call 0x440520                 ;  │
0x439ba7: ret                           ;  │
0x439ba8: cmp  word ptr [0x489f58], 0   ;  ├─ three branches,
0x439bb0: je   0x439bc0                 ;  │  mutually exclusive
0x439bb2: cmp  dword ptr [0x48a520], 0  ;  │
0x439bb9: jl   0x439bc0                 ;  │
0x439bbb: jmp  0x43a440                 ; ─┤
0x439bc0: call 0x43a860                 ; ─┘  the idle branch
0x439bc8: ret
```

Two consequences, and they are the useful part:

- **`frame()` advances on every pass, whatever the engine then does** — the
  increment is above the branch.
- **`calctime()` does not.** It is called from `idle()`, and `idle()` runs from one
  branch only. `0x48a520` is the movement module's own state (20 of its 20 code
  references sit inside `0x4399xx`–`0x43a8xx`), so while an animation is running
  the engine takes `0x43a440` and never reaches `0x43a860`.

So in the original, an animation **starves the heartbeat while the frames keep
counting** — and `calctime` and the `openscene` bump can never run in the same
pass, because they are on branches that exclude each other. There is no ordering
to copy. That route is dead.

What survives is the second one, and it now has a concrete shape: **TI.EXE's
`frame()` is a pass counter; ours is derived from wall time** at a fixed 20/second
(`GameSession.advanceFrames`). If the original's main loop runs its pass faster
while animating, its `frame()` outruns ours and the bumps come more often than
once a second. That is where to pick this up — `0x43df8f` is the master pass's
call site, immediately after a `0x4397b0(2)` delay whose behaviour under an
animation is the open question.

Until that is measured, the gap stands. Guessing at a multiplier would put a
number in the endgame's clock that no evidence supports, and the clock is what
the whole mission is scored against.

Next: the layer the watch is drawn into — **[Stage & UI](stage-ui.md)**.
