# Timing — the pass, loops, crickets & walks

*Prerequisite: [Engine architecture](../architecture.md) and
[The scripting language](../scripting-language.md).*

Everything in the game that happens *without* you clicking — a faucet that
shuts itself off, steam that hisses every few seconds, a character walking a
patrol, the pocketwatch's second hand — runs through one small subsystem: the
scheduler. Its behaviour is recovered from `TI.EXE`.

Reference implementation:
[`engine/src/runtime/scheduler.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/scheduler.ts) and
[`engine/src/runtime/clock.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/clock.ts);
the script-facing commands are in
[`engine/src/runtime/builtins/timing.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/builtins/timing.ts).

## Two time bases

The engine keeps time at two granularities, and scripts touch both:

| Time base | Rate | What uses it |
|-----------|------|--------------|
| **Script tick** | 1 tick = **1/60 s** | `delay(n)` waits n×50/3 ms; one step of a screen ramp |
| **Pass** | one per `framerate` ticks — **50 ms** at the default 3 | loops, crickets, walks, the frame |

A **screen ramp** — a `visualeffect` reveal, and a `screentoblack` /
`blacktoscreen` fade — is on the script tick, not the pass, which makes a
long fade three times shorter than pass pacing would. Both spin on the same
counter (`0x41de90`, `timeGetTime() × 3 / 50`) waiting for it to advance by one, so
one step is one tick in both directions. `RAMP_STEP_MS` in `clock.ts` is that step,
and it is written as `ENGINE_STEP_MS / 3` so the arithmetic stays exact.

The waiting is a **busy-wait inside the command**, with no message pump and no
service pass in it, so a fade suspends the interpreter for its whole length — a
`screentoblack(x, 10)` is 167 ms during which the script does not advance. A fade
that returned immediately would let a conversation's first line start under a
screen that is still black
([#6](https://github.com/dhobi/dreamrefactory/issues/6)), so the two fade builtins
`await Clock.sleep(steps × 50/3)`, the same primitive `delay(n)` uses. See
[the host doc](host.md) for the rest of the transition machinery.

The difference shows where a script asks for a long fade: losing the fistfight
brings the engine room back over 240 steps — 4.0 s, against 12.0 s at the
pass. The engine room goes on fading in slowly for the rest of that game, as in
the original — the boot library's `restorescreen` picks the 240 out of
`currentset () = "engine" & actorowner ("vlad") = "wonfight"`, and nothing ever
clears `wonfight`.

## There is no heartbeat: the world moves in passes a script runs

`TI.EXE`'s service pass (`0x442550`) has exactly two callers: `forceupdate`
(`0x43e3e0`, a bare `jmp` to it) and `visualeffect` (`0x43ded0`, a pass with the
screen copy held back before the wipe). `tl.exe` is the same code (pass
`0x4014e0`, callers `0x44a9ea` and `0x44a58f`), and so is `DF.EXE` (`0x438840`,
callers `0x4207ba` and `0x42039f`). Nothing else steps a walk, a cricket or a
loop, or draws a frame: `delay` (`0x41deb0`) spins on the clock calling only the
message pump, a film's loop (`0x449263`) and a puppet's speech (`0x440620`) only
poll events.

The heartbeat is **script**. The main loop (`0x431b70`) sends the BOOTFILE's
`idle ()` at the top of every turn (event 9, `0x431c09`) and takes at most one
event after it; TAOOT's `idle ()` is

```
forceupdate ()
calctime ()
idlecount = idlecount + 1      ; every fourth time: hittest + setcursor,
                               ; or cursor ("watch") under lockevents
```

So **while a handler runs — a `delay`, a film, a conversation, a drag that
does not call `forceupdate` — nothing advances**: not a loop's count, not a
walk, not a cricket, not a prop's frame, not `frame ()`, not the pocketwatch.

The port does the same for Titanic, Timelapse and Dust (`Scheduler.pass`,
`Scheduler.serviceIdle`; RedJack keeps the older host-driven service): the host
only moves the clock, and whenever no script holds the engine, no film is on
screen and no queued gesture is about to be taken, it sends the BOOTFILE's
`idle ()`, whose `forceupdate` is the pass. A pass runs, **in this order**:

1. the walk slots, each one's `endturn`/`endwalk` run to its end before the next;
2. the cricket slots, in slot order, and then the two loudest looping ones
   started (`DF.EXE` has its balls here instead, `0x438870`);
3. the 32 loop slots (`0x442ae0`): a paused slot is skipped, every other one
   counts down by one — **a period of 1 included, there is no special case** —
   and at zero the slot is cleared and its handler run to its end, before the
   next slot is looked at;
4. the frame (`0x439b80`): `frame ()`'s counter, every prop's view and actor's
   pose one step, **one step of a running turn or walk** (`0x439bbb` →
   `0x43a440`, the frame index at `0x48a634` — its arrival, `openscene`
   included, runs here, inside the pass), then the throttle.

A handler that fails stops the pass at its slot: that slot is freed, the slots
after it are not even counted, and no frame is drawn. A handler's own
`forceupdate` is a pass nested inside it — the loops it is waiting on fire there.

**The throttle is the pass rate.** It comes after the work (`0x43a8f2` →
`0x43a940`): spin until `tick >= lastFrame + framerate`, stamp the tick. So one
pass per `framerate` ticks — 20 a second at the default 3 (`0x429643`), 12 in
the fistfight (`framerate (5)`), 30 at the fence (`framerate (2)`). The setter
clamps to 0..60 (`0x43e3a9`). `framerate (0)` takes the spin out and the original
then passes as fast as the machine draws; the port's finest unit is the tick, so
0 is **one pass a tick**, the same as 1, on every host.

The stamp is the tick the wait ended on, as the original's, except that a wait
which ended less than a period late keeps the rhythm: a host called on screen
refreshes lands a hair after a tick boundary, and stamping that would make every
pass a tick long. On the speedrun's stepped clock every tick is delivered and the
two agree. **A late pass is not made up**: a host that comes back after a stall
runs one pass, not a burst.

One allowance the port makes, deterministic: the very first pass of a session
has no stamp to wait on, so the idle goes straight round into the second (the
original's stamp starts at 0).

**A gesture is taken between two idles, never inside one.** The main loop sends
the idle and only then fetches at most one event (`0x431c09`..`0x431c34`, then
`0x431c43`, en build), so a click or a key made while the idle runs — waiting
out its throttle, or running a handler in its pass — goes into the event queue
like one made while a script runs, and is taken once the idle has returned; the
idle does not start again while a gesture is waiting to be taken. A press says
when its gesture is over (`ScreenDirector.press`'s `taken`, called after the
dispatch whether it went at once or waited), which is what a harness `click()`
waits on, and `quiescent` is false while one is queued. Timelapse's kiva is
where interleaving showed: its walls' `setcursor` (run by the idle) shows each
hidden picture to `pointinprop` it and hides it again, and a `mousedown` run in
the middle of that missed. DreamFactory 1 is not this: DF.EXE's pass takes the
queued press at its own head.

**Game time stands still while the engine waits on a file.** Every timed thing
is a delta off one reading, `GameSession.gameTime`, and while the engine is
stopped for a load it needs now — a room and its casts, a film about to play, a
file a script opened, a save being restored (`whileLoading`) — that reading
does not move: no pass, no frame, no `delay` running down. The original read
its disc synchronously and its loop did nothing until the read returned. A
speedrun additionally runs on **speedrun time**, where the reading moves by
exactly one tick (1/60 s, TI.EXE's unit) per tick and speech ends by its own
length; see
[the speedrun's clock](../../reference/tests.md#the-clock-in-game-time).

## `makeloop`: a loop that isn't a loop

A "loop" is really a **one-shot delayed callback**.

```
makeloop ("scene", "steamhiss", 45)
```

arms a countdown of 45 passes. When it reaches zero, the slot
**removes itself and fires once** — delivering the named event to its target
(`kind` maps to `sendtoscene`, `sendtoprop`, `sendtoactor` or `sendtoflat`).
Things *appear* to loop only because their handler calls `makeloop` again at
the end. That's why a handler that forgets to re-arm simply stops — and why
`stoploop` on something mid-handler doesn't prevent the current firing.

Details that matter in practice:

- The loop table holds at most **32 slots** (`TI.EXE`'s fixed size); a slot's
  identity is the pair **(kind, name)**, so re-arming replaces rather than
  stacks.
- A loop counts down **once per pass**, whatever its period: a period-1 loop
  runs once a pass, never once a display frame, and a loop armed by a handler
  mid-pass takes the first free slot — one the pass has already passed — and
  waits for the next pass.
- `stoploop` / `pauseloop` / `isloop` / `countloops` / `indextoloop` manage
  the table; the enumeration pair is what lets `closeset` handlers tear down
  their own timers.

### `forceupdate` is one pass of the main loop

It **services** the world and **draws a frame**, then waits out the throttle on
the clock — which a browser moves on its own frames, and which a headless
`forceupdate` jumps itself, since nothing else moves it while a script runs.
That pass is what advances a camera move — one frame of it per pass, so a move
lasts as many passes as it has frames (a walk draws its first row inside the
gesture, `0x439e10`; a turn starts on its standpoint, `0x439da9`) — and a
script that polls the camera —

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

`currentscene (dir)` itself (`0x407b70`, en build) runs in this order: a
`"strait"` with no road, or with a move already running, returns at once
(`0x407c99`); otherwise `closescene ()` is sent to the scene being left and run
to its end (`0x407cbb`); if that closed the set or moved the scene the move is
abandoned (`0x407cc9`, `0x407ce6`); and only then is the move asked for
(`0x439c10`), which drops a turn asked for while one is running — after its
`closescene` has been sent. A direction that is none of the three is error `0xa`.
DF.EXE's frame steps its camera a pass at a time too (`0x4334c7` → `0x433d20`),
but as an interpolated grid move this port does not model; Dust's moves keep the
timed pace.

## `framerate` and `frame()`: paced by the clock, not by the display

`frame()` returns a counter of **displayed frames** — one per pass — and
`framerate(n)` sets how many script ticks a pass lasts, so `frame()` advances at
**60/`framerate`** Hz while passes run, and stands still while a script holds
the engine. The default is **3** (20 Hz); the fight stage asks for 5 (12 Hz);
`framerate(0)` means "don't wait". The original clamps the value to **[0, 60]**.

The original's frames are gated on the wall clock, not on how fast it could
draw: the throttle (`0x43a940`) adds `framerate` to the last frame's stamp, so
the unit is a duration. The port's throttle counts the same ticks of the game's
clock on every host (`Scheduler.throttle`), so `hasattention()` (characters who
speak up after you linger four seconds) and every scripted animation loop run
at the same rate at any refresh rate.

The play page offers the same dial to the player, for their own turns and walks
only: **Movement** is `framerate` in four steps — 6 ticks, the shipped 3, 1.5, and
`framerate(0)`'s *don't wait* — see [the browser host](host.md#the-movement-setting).
It is a separate value from `session.frameRate`, which scripts write.

The **pumped-clock host is the exception**: headless has no displayed frames, so
one `forceupdate` *is* one frame there and the counter still advances per call.
That keeps the oracle deterministic — see [Tests](../../reference/tests.md).

## Crickets: sound with a position

A **cricket** (the engine's own word) is a positional ambient one-shot: a
sound bound to **the set that created it**, at an (x, y) map position, with an
audible radius and a re-fire timer. It is the one thing the engine schedules that
draws a random number, and it draws from its **own** seeded stream
(`session.ambientRng`) rather than the one a script's `random()` uses — see
[why the two are separate](../../taoot/verification.md#two-streams-because-the-clock-must-not-re-roll-the-story).

`makecricket` (`0x444130`) fails with 0x28 when no set is open, 0xa for a sound
no open bank has, and 0xe for a radius under 1, a base under 0 or a jitter under
−1; the table holds **16** (error 8 when full), a new cricket taking the first
free slot.

On each pass (`0x444430`) a cricket does **nothing at all** while it is paused,
while no set is open, or while the open set is not its own — not even its
countdown. Otherwise it measures `isqrt(dx² + dy²)` to the camera and, inside its
radius, writes a **volume of `255 − trunc(dist · 255 / radius)`** and a **pan
linear in the angle** (`0x444790`: the bearing turned so the camera faces 0x80,
folded front to back, `2·rel − 0x80` clamped to 0..255) to its sound — every
pass, so a sound already playing follows the camera. Then:

- **negative jitter** → a one-shot: it counts down wherever the camera is, and at
  0 plays if in earshot and is gone either way;
- **jitter ≥ 0** → it counts only in earshot. The first pass in earshot re-arms
  it with `base + random(jitter)` **without playing**; after that it plays at 0
  and re-arms — **whether or not its last shot is still sounding**
  (`0x44463f`): no gap is a seamless rumble, a random gap an intermittent hiss.
  Leaving the radius stops its sound and disarms it;
- a cricket flagged by `soundloop` neither counts nor plays on its own: the
  looping crickets in earshot register their volume, and the pass starts the
  **two loudest** (`0x4446d0`) and stops the rest.

A play is `multiplesound`'s, a looping one's `singlesound`'s (so a sound already
sounding is not started again), and the pan is TI.EXE's linear **balance**
(`0x424b90`): below 128 the right ear gets `p/128`, above it the left
`(255 − p)/127`, full in both at the centre — not an equal-power pan.
`pausecricket` nests as a count, like `pauseloop` and `pausewalk`.

A cricket plays on the **sound channels** like any other play and is **published
there**. `currentsound()` is the only way a script can ask whether a cricket has
finished, and scripts do — the bedsit landlady's five lines are separate crickets
sequenced entirely by that question; see
[Audio at runtime](audio.md#three-channels).

## Walks

`walktostar` / `walktoxyz` / `walkonpath` give an actor a walk serviced on the
pass: **the actor's own `actorspeed` in world units per pass**, not scaled, the
position `start − trunc(delta · progress / dist)` — `TI.EXE`'s straight-line
mover at `0x443E7C` verbatim. The table has **16** slots; a new walk removes the
actor's old one without an `endwalk` and takes the first free slot (error 7 when
full), and a pass serves the slots in order. While walking:

- the actor **turns before it moves**, stepping the facing by `actorturn` (with
  `0x445080`'s wrap of 0xff, so crossing north lands a unit further round than a
  256-turn) and dispatching `endturn` when it lands — the cast's own `endturn` is
  what chooses the walk pose (`walk`, or `walklj` once the life jackets are on);
- the engine sets **no pose** on arrival or on `stopwalk`: the string `stand`
  is not in any of the exes. The cast's `endwalk` stands its actor;
- `iswalk` reports it, `walkdest` exposes the goal, and `stopwalk` /
  `pausewalk` interrupt.

`turntodeg` is a walk too, with no mover: it **always** records (there is no
"already facing" shortcut, and a walk in progress is cancelled), and when the
facing lands the slot is cleared and `endturn` is sent (`0x443d47` →
`0x443da4`) — so `endturn`'s `iswalk` test is false there, which is how gang.cst's
Steph sets off again after turning to you.

A `walktostar` or `walkonpath` for an actor whose set is not the open one is
**deferred** (`0x443ac0`): it waits, unbuilt — no turn, no step — until the first
pass that set is open, and is built from where the actor stands then.

How fast the legs move is **not** this: it is the pose's [play
script](../formats/pup-cst.md#the-play-script-says-how-long-a-picture-is-held),
which every actor steps through once per pass whether it is walking or not. The
two are independent in the original too: #181 was a walk that arrived at the right
place at the right time with the feet going twice as fast.

One walk per actor. On arrival the scheduler fires the actor's **`endwalk`**
handler — that's how patrol scripts chain legs: each `endwalk` starts the next
walk. Meanwhile `actorstar` reports the KIND of walk running rather than a place:
`"walkonpath"` for an authored route, `"walktoxyz"` for a walk to a bare point,
`"defer"` for the straight line to a star. The destination only appears there
when the actor lands on it.

## The game clock

The band's pocketwatch and the mission-4 sinking countdown run off the
BOOTFILE's `calctime()` handler, which advances one game-second every **20
calls** — 20 *calls*, not 20 milliseconds-worth. The BOOTFILE's own `idle ()`
calls it once a turn of the main loop, right after its `forceupdate`, and the
port runs that same `idle ()`: 20 passes a second at the default framerate, so
the second hand ticks once a second while the world runs, and stands still
while a script holds it, as the original's does.

That is only the idle. Mission 4 has three more things that move the clock —
one of them is *walking around* — all described in
**[The sinking](../../taoot/sinking.md)**.

## Poll loops and the runaway guard

Scripts wait by **polling**: `while not voicedone() endwhile`, `while
stilldown() ... endwhile`. Those loops have no yield of their own, so builtins
that are polled this way give up one *real rendered frame* per iteration
(`yieldFrame` in
[`builtins/context.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/builtins/context.ts)).
The interpreter's runaway-loop guard (100 000 iterations) is reset by those
real-frame yields — so an interactive poll loop can run for minutes, while in
headless runs (no real frames) the guard stays armed and a genuinely stuck
loop fails fast instead of hanging the test.

Next: the layer that owns the screen bottom — **[Stage & UI](stage-ui.md)**.
