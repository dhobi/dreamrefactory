# Timing — the heartbeat, loops, crickets & walks

*Prerequisite: [Engine architecture](../02-engine-architecture.md) and
[The scripting language](../03-scripting-language.md).*

Everything in the game that happens *without* you clicking — a faucet that
shuts itself off, steam that hisses every few seconds, a character walking a
patrol, the pocketwatch's second hand — runs through one small subsystem: the
scheduler. Its behaviour was recovered from `TI.EXE` and is now fully
implemented; this page is the write-up.

Reference implementation:
[`src/engine/scheduler.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/scheduler.ts) and
[`src/engine/clock.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/clock.ts);
the script-facing commands are in
[`src/engine/builtins/timing.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/builtins/timing.ts).

## Two time bases

The engine keeps time at two granularities, and scripts touch both:

| Time base | Rate | What uses it |
|-----------|------|--------------|
| **Script tick** | 1 tick = **1/60 s** | `delay(n)` waits n×50/3 ms; one step of a screen ramp |
| **Master heartbeat** | one service step every **50 ms** (20 Hz) | loops, crickets, walks |

A **screen ramp** — a `visualeffect` reveal, and a `screentoblack` /
`blacktoscreen` fade — is on the script tick, not the heartbeat, and that is not a
detail: it is the difference between four seconds and twelve. Both spin on the same
counter (`0x41de90`, `timeGetTime() × 3 / 50`) waiting for it to advance by one, so
one step is one tick in both directions. `RAMP_STEP_MS` in `clock.ts` is that step,
and it is written as `ENGINE_STEP_MS / 3` so the arithmetic stays exact.

Fades were on the heartbeat here for a long time, which made every fade in the game
three times slower than the original's. It shows only where a script asks for a long
one, which is where it was reported from: losing the fistfight brings the engine room
back over 240 steps — 4.0 s, against 12.0 s at the heartbeat. The engine room goes on
fading in slowly for the rest of that game, and *that* part is faithful — the boot
library's `restorescreen` picks the 240 out of `currentset () = "engine" &
actorowner ("vlad") = "wonfight"`, and nothing ever clears `wonfight`.

The heartbeat is `ENGINE_STEP_MS` in `clock.ts`. On every service step the
scheduler processes, **in this order: walks, then crickets, then due loops** —
the master service order observed in `TI.EXE` — and then advances every actor
one step along its pose's [play
script](../formats/pup-cst.md#the-play-script-says-how-long-a-picture-is-held),
which is where the original's pass ends too (`0x442550` closes by drawing a
frame, and the animation advances at the head of that draw). After a long stall
(a suspended browser tab), catch-up is capped at **64 steps** so the whole gap
isn't replayed as a burst.

## `makeloop`: a loop that isn't a loop

The single most important recovered fact: a "loop" is really a **one-shot
delayed callback**.

```
makeloop ("scene", "steamhiss", 45)
```

arms a countdown of 45 heartbeat steps. When it reaches zero, the slot
**removes itself and fires once** — delivering the named event to its target
(`kind` maps to `sendtoscene`, `sendtoprop`, `sendtoactor` or `sendtoflat`).
Things *appear* to loop only because their handler calls `makeloop` again at
the end. That's why a handler that forgets to re-arm simply stops — and why
`stoploop` on something mid-handler doesn't prevent the current firing.

Details that matter in practice:

- The loop table holds at most **32 slots** (`TI.EXE`'s fixed size); a slot's
  identity is the pair **(kind, name)**, so re-arming replaces rather than
  stacks.
- **Period 1 is special**: a one-step loop is serviced **per rendered display
  frame** (~60 Hz), not on the 50 ms heartbeat — drag-tracking loops
  (the wireless tuning knob) need that. `forceupdate` inside such a loop
  yields a real frame and keeps the *other* per-frame loops alive while it
  waits.
- `stoploop` / `pauseloop` / `isloop` / `countloops` / `indextoloop` manage
  the table; the enumeration pair is what lets `closeset` handlers tear down
  their own timers.

### `forceupdate` is one pass of the main loop

Both halves of it, which is the part easy to get wrong: it **services** the
world *and* **renders a frame**. The service pass lives in the builtin; the
frame is the host's (`GameHost` wires `session.nextFrame`, and `main.ts`
replaces that with `requestAnimationFrame` because a browser draws on its own
clock). Rendering is what advances a turn or walk animation, so a script that
polls the camera —

```
currentscene ("right")
while currentview () = "moving"
  forceupdate ()
endwhile
```

— only terminates because the frame happens. It is how the 2nd class staircase
turns 90° per press, how `STAIR1C2`'s door click turns first and then opens, and
how BEDSIT1's endgame waits. A `nextFrame` that resolves without drawing (the
session's bare default) leaves those spinning to the interpreter's 100k
while-guard, which then *continues* with the move still in flight — so whatever
the script does next is silently dropped.

## `framerate` and `frame()`: paced by the clock, not by the display

`frame()` returns a counter of **displayed frames**, and `framerate(n)` sets how
many script ticks one displayed frame lasts — so `frame()` advances at
**60/`framerate`** Hz. The default is **3** (20 Hz); the fight stage asks for 5
(12 Hz); `framerate(0)` means "don't wait". The original clamps the value to
**[0, 60]**.

The part that matters for a port is that **the original's frames are gated on
the wall clock, not on how fast it could draw**. Its counter is bumped at
`0x439b80`, and the next thing that runs is the throttle at `0x43a940`:

```
call 0x41de90            ; now = timeGetTime() * 3 / 50   (the 1/60 s tick)
mov  ecx, [0x489efe]     ; framerate    (initialised to 3 at 0x429643)
add  ecx, [0x48a6d8]     ; + the last frame's stamp
cmp  eax, ecx
jl   0x43a940            ; not due yet -> spin
mov  [0x48a6d8], eax     ; stamp this frame
```

`framerate` is *added to a timestamp*. A frame therefore happens every `n` ticks
of real time — frame-paced in form, wall-clock in effect.

The port follows that in
[`GameSession.advanceFrames`](https://github.com/dhobi/taoot-web/blob/master/src/engine/session.ts):
`frame()` advances when the clock has moved `framerate` ticks, and `forceupdate`
holds for `framerate` ticks of real time rather than for that many
`requestAnimationFrame` callbacks. Counting callbacks instead ties every
`frame()`-based timer to the display — measured, `frame()` ran at 6 Hz instead of
20 when the frame rate was starved to 18 fps, and it would run twice as fast as
intended on a 120 Hz panel. `hasattention()` (characters who speak up after you
linger four seconds) and every scripted animation loop hang off this.

The **pumped-clock host is the exception**: headless has no displayed frames, so
one `forceupdate` *is* one frame there and the counter still advances per call.
That keeps the oracle deterministic — see [Tests](../reference/tests.md).

## Crickets: sound with a position

A **cricket** (the engine's own word) is a positional ambient one-shot: a
sound bound to **the set that created it**, at an (x, y) map position, with an
audible radius and a re-fire timer. It is the one thing the engine schedules that
draws a random number, and it draws from its **own** seeded stream
(`session.ambientRng`) rather than the one a script's `random()` uses — see
[why the two are separate](../verification.md#two-streams-because-the-clock-must-not-re-roll-the-story).

On each heartbeat the scheduler checks every cricket against the camera:
**distance sets the volume** (a linear falloff to the radius — the original's
exact curve is one of the few things still not recovered, so linear is the
port's approximation), and **bearing sets the stereo pan**. When a cricket's
timer expires it re-arms with `base + random(jitter)`:

- **no gap** → the sound re-fires seamlessly — an endless engine-room rumble;
- **a random gap** → an intermittent hiss (the actual steam vents);
- **negative jitter** → fire once and die;
- a cricket flagged by `soundloop` loops the sample itself in place.

A cricket will not re-fire while its previous shot is still sounding, and the
table holds at most **16** of them. Because a cricket is bound to its set,
travelling away silences it and coming back re-arms it — no script cleanup
needed.

A cricket is an overlapping play, so it lands in **sound channel slot 2** and is
**published there** like any other play. That is not bookkeeping: `currentsound()`
is the only way a script can ask whether a cricket has finished, and scripts do —
the bedsit landlady's five lines are separate crickets sequenced entirely by that
question. Firing one without recording it left both slots reading empty and her
talking over herself; see
[Audio at runtime](audio.md#three-channels).

## Walks

`walktostar` / `walktoxyz` / `walkonpath` give an actor a walk serviced on the
heartbeat: **the actor's own `actorspeed` in world units per 50 ms step**, not
scaled — that is `TI.EXE`'s straight-line mover at `0x443E7C` verbatim, and its
pass rate is ours. (A ×4 approximation stood here once and moved the whole cast
at four times its scripted pace.) While walking:

- the actor **turns before it moves**, stepping the facing by `actorturn` and
  dispatching `endturn` when it lands — the cast's own `endturn` is what
  chooses the walk pose (`walk`, or `walklj` once the life jackets are on);
- the engine puts the pose back to `stand` on arrival, and nowhere else;
- `iswalk` reports it, `walkdest` exposes the goal, and `stopwalk` /
  `pausewalk` interrupt.

How fast the legs move is **not** this: it is the pose's [play
script](../formats/pup-cst.md#the-play-script-says-how-long-a-picture-is-held),
which every actor steps through once per pass whether it is walking or not. The
two are independent in the original too, which is what let #181 arrive at the
right place at the right time with the feet going twice as fast.

One walk per actor. On arrival the scheduler fires the actor's **`endwalk`**
handler — that's how patrol scripts chain legs: each `endwalk` starts the next
walk. (`walkonpath` shows up as the arrival sentinel while a star-to-star walk
is in flight.)

## The game clock

The band's pocketwatch and the mission-4 sinking countdown run off the
BOOTFILE's `calctime()` handler, which advances one game-second every **20
calls** — 20 *calls*, not 20 milliseconds-worth. The original engine called it
from its `idle()` on every event-loop pass; the port calls it every **50 ms** of
the host's clock, skipping while a script is mid-flight — the original likewise
only ran it between events. Since a pass is 50 ms, 20 calls is one real second
and the second hand ticks once a second, but that is an equivalence rather than a
definition, and things that add passes add clock.

It runs on **both hosts**, off whatever `now` reaches `tickTime` — wall time in
the browser, the pumped virtual clock headless. It used to be browser-only, out of
a fear that an auto-advancing clock would fire the mission-4 sinkmovie chain
mid-test; the gate cost more than it bought, because `calctime` is also where
`sinkflag` becomes `advancephase()`, so headless the ship never sank at all and
the mission-4 goldens were traces of a ship sitting still.

That is only the heartbeat. Mission 4 has three more things that move the clock —
one of them is *walking around* — and the whole of it is
**[The sinking](sinking.md)**.

## Poll loops and the runaway guard

Scripts wait by **polling**: `while not voicedone() endwhile`, `while
stilldown() ... endwhile`. Those loops have no yield of their own, so builtins
that are polled this way give up one *real rendered frame* per iteration
(`yieldFrame` in
[`builtins/context.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/builtins/context.ts)).
The interpreter's runaway-loop guard (100 000 iterations) is reset by those
real-frame yields — so an interactive poll loop can run for minutes, while in
headless runs (no real frames) the guard stays armed and a genuinely stuck
loop fails fast instead of hanging the test.

Next: the layer that owns the screen bottom — **[Stage & UI](stage-ui.md)**.
