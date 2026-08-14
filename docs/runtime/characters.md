# Characters — actors & puppets at runtime

*Prerequisite: [PUP & CST — characters](../formats/pup-cst.md) (the formats),
[SET](../formats/set.md) for the camera model, and
[Timing](timing.md) for walks.*

A character exists in two modes, matching the [two file
types](../formats/pup-cst.md): as an **actor** — a CST sprite walking around
the pre-rendered world — and as a **puppet** — the PUP conversation close-up
that takes over the screen when you talk to them. This page covers both
runtimes.

Reference implementation:
[`src/engine/actors.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/actors.ts) and
[`src/engine/puppet.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/puppet.ts)
(logic) with
[`src/puppet-view.ts`](https://github.com/dhobi/taoot-web/blob/master/src/puppet-view.ts)
(drawing); the commands live in
[`builtins/actors.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/builtins/actors.ts) and
[`builtins/puppets.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/builtins/puppets.ts).

## Actors: sprites in the world

`opencastfile("gang.cst")` loads a cast (GANG.CST holds the 25 story
characters; EXTRA.CST the background passengers) and runs its `opencast`
handler; each member's script resolves through the **cast main** script as its
parent, the same containment pattern props use. The boot's `setupactor` /
`putdownactor` library handlers are what scripts actually call: they place an
actor at a named **star** (the world-point markers in the SET's actor table)
and clean it up again.

An actor's state is what you'd expect from the [builtin
family](../reference/builtins.md): a world position (`actorxyz` /
`actorstar`), a facing (`actordeg`, 0–255 compass), a pose (`actorpose`,
default `stand`), a scale, a speed for [walks](timing.md#walks), and an
owner/value pair scripts use as scratch state.

### Which sprite do you see, and when does it change?

A pose animation step holds one picture **per depicted view** — usually eight
45° apart, though [three poses in the corpus do
not](../formats/pup-cst.md#cst--the-body-that-scales-with-distance). The one
drawn is *not* picked from the actor's facing alone — it's the facing **relative
to the bearing from the actor to the camera**, because which side of someone you
see depends on where *you* stand, and the engine keeps whichever stored view is
angularly closest to it. A view depicted at angle 0 is "facing the viewer": an
actor looking straight at the camera shows it wherever you are. Get the
reference backwards (camera→actor instead of actor→camera) and every character
shows their back at the wrong moments — one of those bugs the regression tests
now pin down.

*When* it changes is the pose's own **[play
script](../formats/pup-cst.md#the-play-script-says-how-long-a-picture-is-held)**,
and the engine's part is three instructions: every actor moves one step along it
per 50 ms service pass, wrapping at the script's length. Every actor, not only
the ones walking — that is how the stoker shovels. A `stand` lists one step and
so never changes; a `walk` lists twenty for ten pictures, which is what makes a
stride take a second.

### Size and occlusion

The sprite scales with the same projection the props use — on-screen factor
`k = actorscale × refScale / (1000 × depth)`, with `refScale` from the CST
frame record (uniformly 96 in GANG.CST). Every drawn pixel is depth-tested
against the view's [Z layer](../formats/image-codec.md#the-z-layer-a-hidden-depth-map),
so a character walks convincingly *behind* furniture that's nearer the camera.
Click-testing (`actorAt`) uses the same rules: opaque pixels only, and an
occluded pixel is not clickable. What cursor an actor reports is the CAST's
business, not ours: `hittest` answers `"actor"`, the hover sends `setcursor`
there, and `gang.cst`'s main is the only cast in the tree that defines one —

    if realdist (target) < hotdist ()   cursor ("touch")   exitcode
    endif
    passcode

so a character within reach is a hand and one across the room is the plain
arrow. (It read `talk` here for as long as the port chose the cursor itself; no
script in the game ever emits that name.)

Walking — who moves, how fast, and the `endwalk` chain that drives patrols —
is the scheduler's job: see **[Timing](timing.md#walks)**.

There are two ways to send one somewhere, and the difference is the scenery.
`walktostar` walks the straight line, which is fine in an open room. `walkonpath`
walks a **route the SET author drew** — a polyline hanging off the star record
that pairs the two stars ([SET](../formats/set.md#stars-and-the-routes-between-them)),
walked in either direction, and with `"resume"` as the start it is found by the
destination alone. Six exist and three bend, but those three are the ones with
something in the way: Georgia leaving you on the boat deck curves around the
second-class stairs in ten points, Sasha steps out of A14 and turns down the hall
in five, and the hacker's runs nine. Walking their straight lines instead took
each of them through the scenery (#122).

It is one walk, not a leg-by-leg chain: the route's container stores every point's
distance from the one before *and* the total, so the service runs the whole
polyline on the single progress scalar a straight walk uses — no leg re-fires
`endturn`, and only the arrival fires `endwalk`. The facing is re-aimed per leg,
because a route that turns corners has to.

### Characters who speak first

Most conversations start with a click, but not all, and the exceptions are in
the shipped data, not in the host:

- **They block your way.** `DECKBD.SET`'s `keydown`: press up at view98 and
  Morrow turns, the camera swings to view99 and he keeps you off the bridge;
  view83 is the same with the AB seaman. `1017` gives Jones a one-in-three
  chance at view248/249, and `1080`'s `closescene` has Penny catch you on the
  way out of Scene152.
- **You linger near them.** `GANG.CST`'s `hasattention(seconds)`: an actor's
  idle loop (`gaidle`, `morrowidle`, …) claims the player's attention while
  they're inside `hotdist()`, and once they've held it for `seconds` the cast
  fires `sendtoactor(target, mousedown(0))` on itself — the character speaks up
  as though you had clicked them.

The second one has **two** gates, and only one of them is in the cast's own
script. `hotdist()` is a ground distance across the whole set, so it is a coarse
gate wherever a set holds more than one room: `stair1c1` is both decks of the aft
grand staircase, and from the A-deck landing you are 1956 units from someone
standing on B — inside its 4000, and through the floor. The other gate is inside
`hasattention` itself, `if actordist(target) = 32000`, and it is not about
distance at all: `actordist` answers that sentinel whenever the actor would not
be **drawn**, which includes a sprite that lands nowhere on the screen. Out of
view, the attention clock is reset rather than run down, so a character can only
stop you if you could have seen them coming. Leaving that half out is #180 —
Daisy Cashmore accosting from a deck below, with the player facing a wall.

The engine says both halves on the log while they happen, which is the trace to
reach for when a character speaks up and it isn't obvious why:

```
glob: curattention = "cash" (was 0)          ← she has claimed you
sight: cash out of view — attention clock reset
sight: cash in view (947)                    ← now she can see you; the clock runs
msg: cash                                    ← walktopuppet: she accosts
```

The first line is a **watched global** (`Interpreter.watchGlobals`) — the game's
plot lives entirely in globals, so any of them can be put on the log this way;
`curattention` is the one the engine watches by default. The `sight:` lines are
`actordist` changing its mind, and it only speaks on a change.

The timing is worth knowing too, when a change to it looks harmless. The
conversion is `(seconds * 60) / framerate()`, where `framerate()` is **ticks
per displayed frame** against a 60 Hz base (which is why scripts pass 0 for
"unthrottled" and 5 for the fight stage's slow frames). So `frame()` counts
displayed frames, not ticks. While it counted ticks, every timer built on it
ran `framerate()`× fast and Georgia and Morrow accosted the player *during* the
walk animation instead of after four seconds of standing there.

## Puppets: the conversation close-up

`openpuppetfile` parses the PUP, binds its conversation scripts (their parent
is the **boot** library, so `progress()` and friends resolve), and replaces
the room view with the puppet screen. From there the conversation runs on
four commands:

- **`puppetspeak(ident)`** — plays the line's voice audio and shows its
  subtitle, starts the facial animation, and **suspends the script** until the
  line ends — racing the audio against **ESC**, which is the only thing that
  skips it ([below](#skipping-and-repeating)).
  The animation plays the line's per-tick records at ~33 ms each (the timing
  table [in the PUP](../formats/pup-cst.md)); a line with no audio is paced by
  text length (a second per ~15 **bytes as stored**, minimum 1 s), matching
  `TI.EXE`'s `strlen()` — which is also what keeps a Shift-JIS line, half as many
  characters as its English original, from being given half the time to be said
  ([the code page](languages.md#the-code-page-is-not-in-the-data)). Which
  **stance** the animation plays against is the *line's* — the i16 its record opens
  with — which is what puts the moving mouth on the right character when two of
  them share one close-up
  ([why](../formats/pup-cst.md#stances-and-animation-logic-the-face-as-11-layers)).
  When the ident misses, the line is looked up **by its subtitle**: the demo's
  `dpenny.pup` is the only file in either tree whose script names lines that way
  (`puppetspeak("It's about time you got here! …")` where everything else says
  `puppetspeak("penny1.007")`), and all 36 of its calls match a subtitle while none
  match an ident — Penny opened, offered her bevels and said nothing. The fallback
  is consulted only *after* the ident lookup and the index is built lazily on the
  first miss, so no other puppet can resolve differently or pay for it.
- **`puppetbase(ident)`** — seats a resting pose taken from a line's first
  animation record (`""` = the neutral stance), so the character doesn't
  freeze mid-gesture between lines.
- **`puppetbevel(text, …)`** — adds a **choice bevel** (a labelled plaque);
  **`puppetevent()`** then blocks until you click one and returns its index
  (or −1 immediately if there are none). That pair is the entire dialogue-
  choice mechanism. A click that lands on the picture instead of a row is the
  **repeat** ([below](#skipping-and-repeating)).
- **`puppetparam(n, …)`** — engine-side toggles; slot 7 is "subtitles on",
  wired to the game's settings screen.

### Drawing it

`PuppetView` composites the close-up over the live set backdrop: up to **11
stance layers** (background, body, head, eyes, eyebrows, nose, jaw, arms —
see the [PUP format](../formats/pup-cst.md)) positioned by the current
animation record, each frame decoded through the
[transparent codec](../formats/shp.md) and colourised through the puppet's
own palette. Three
details worth knowing:

- A background layer that decodes to a **single flat colour is a key-colour
  matte** and is skipped — otherwise Smethells' plate of colour 247 would
  cover the room.
- Frame caches are keyed **per puppet**, not per container index — two
  characters can reuse the same container numbers, and a shared cache made
  the second character wear the first one's face.
- The subtitle band sits at y = 268 (two wrapped lines max, gated on the
  subtitles setting); bevels are full-width plaques anchored to the bottom
  edge, growing upward, with hover highlighting — hit-testing shares the
  exact geometry with the renderer.
- Both the band and the bevels wrap through
  [`wrapText`](https://github.com/dhobi/taoot-web/blob/master/src/fonts.ts), which
  breaks between CJK characters as well as at spaces, because a Japanese line has
  no spaces to break at and ran off both ends of the band when it was split on
  `" "`. The font stacks lead with this port's chosen face and fall through to a
  gothic, in the order the original's own font requests imply.

While a puppet is up, it eats clicks before everything else (see [the click
priority chain](host.md#the-click-priority-chain)) — except when an overlay
stage (the inventory, blackjack) [hides it](stage-ui.md#the-overlay-stack-transtoflat-transfromflat)
to run its own input loop, and restores it afterwards.

### Skipping and repeating

The two waits a conversation sits in — `puppetspeak`'s and `puppetevent`'s — pop
the event queue themselves in the original, so while one of them is running the
scripts see no input at all. What each wait does with what it pops is the whole of
this section, and the port had both halves wrong until #3.

**Only ESC skips a line.** The wait's interrupt filter (`0x441d80`) drops any event
that is not a KEY on its first instruction, and then requires the `0x1fa0` marker
— the key is ESC, or was held with Ctrl. So a click on a talking character does
nothing whatever, and the port's old click-to-skip was an invention.

**And ESC skips the whole speech, not one line of it.** Skipping raises a flag
(`0x48ac00`); every following `puppetspeak` queues its line and returns without
playing it (`0x43f887`) until `puppetevent` lowers the flag again (`0x43f718`). One
press per speech is the original's rate, which is also why a route that ESCs once
gets straight to the plaques.

**A click on the picture, while the choices are up, repeats the last exchange.**
The plaque wait tests the point against the rect (0,0)–(W, H−120) — the screen
above the answer band — before it looks at the rows at all (`0x44193f`). On a hit
it takes the current choices down, puts the *previous* plaque back with the row you
picked framed (`0x44199c`, `0x4419b5`), says your own line again if that row's text
names a dialogue record (`0x441cb0` matches bevel text against the line table),
replays the queued replies (`0x441a35`, at most three — `0x43f86d` caps the queue),
and then restores the choices you were being offered.

Two consequences of *where* that code lives:

- **Stage directions do not come back.** Nothing in the replay path re-enters the
  script, so the `message("ACT--…")` notes a scenario prints around a line are not
  reprinted. Only what was heard is repeated.
- **It is an exchange, not a line.** The queue holds everything said since the last
  plaque, so "repeat" means the answer you just got, in full.

**0–9 set the volume**, and the line plays on. Those arms answer "not an interrupt"
and call the wave-volume setter with their own digit (`0x441dca`…`0x441e48` →
`0x4249b0`) — the same setter the scripts' `wavevolume(n)` uses, so the keys and
TAOOT's own control-panel dial move one value. The **movie** filter's table
(`0x44a584`/`0x44a544`) is byte-identical, so the digits work over a clip too, which
is where a player most wants them.

They are bound **bare here, and that is a deviation**. The window proc sets the
`0x1fa0` marker from `GetKeyState(VK_CONTROL)` alone (`0x41ad08`), so every arm of
both tables is a Ctrl chord in the original — and a browser reserves all ten of
them: Ctrl+0 is zoom reset, Ctrl+1–9 switch tabs, and `preventDefault()` stops
neither. #115's brightness keys had no such conflict (its manual said Ctrl+F1 but
the code tested the virtual key alone, so bare F1 was faithful *and* reachable);
here the two cannot both be had, so the digits are bare and the chord is simply
unavailable. A player without a keyboard uses the game's own dial, which is why the
page adds no control of its own
([host](host.md#the-sound-keys-and-why-the-page-has-no-sound-control)).

**ESC also answers the plaque wait, with −1** (`0x4418a7`) — which is how a player
walks out of a conversation. That value is not a spare: every one of the **516**
`puppetevent` calls in the tree is `puppetevent (-1)` followed by a switch with a
`case -1` arm, so it is a branch the authors wrote for every single prompt in the
game. SMETH1's advice loop is the clearest case —

```
	while true
		puppetclear ()
		puppetbevel ("Say I want to find a person or a cabin…", 101)
		… four more …
		arg = puppetevent (-1)
		switch arg
		case -1
			exitcode
```

— where an unanswered plaque is the *only* way out of that `while true`. Until #131
those 516 arms were unreachable.

Two things it deliberately does **not** do. It does not raise the skip flag, unlike
a spoken-line ESC: the script's own −1 arm may have a parting line, and the original
agrees — the plaque pump writes the −1 and returns without touching `0x48ac00`. And
the abandoned plaque is remembered with **no** picked row, because `chosen` outlives
its own list until the next `puppetclear`, so recording it would frame a row of this
plaque that nobody touched.

The consequence for anything *driving* the game is that ESC has to be aimed rather
than hammered: it skips a line only while one is being spoken, and does something
quite different the rest of the time. `SetViewer.speaking` is that aim, and both
playthrough drivers now check it before pressing.

### Idling while you read the choices

The plaque wait is not idle. It carries **four timers inline** (`0x441780`), each one
an `idle 1`..`idle 4` line on its own interval, and a slot that comes due plays its
line through the same blocking play-and-wait a `puppetspeak` uses. So a character
blinks, shifts, and eventually says something while you decide.

**The intervals are per character**, read from the PUP's own header — four
`[min, max]` tick pairs at `0x83A`/`0x84A`, immediately before `bandLocation`
(`PupFile.idleTimers`) — and each firing re-draws its own with
`min + rand(1 .. max-min)`. That is the argument for reading them rather than
picking a constant: across the 55 PUPs in the tree slot 1, the blink, ranges from
**65 to 200 ticks**, so Burns blinks half again as often as Asea, and Jones's second
slot is set to blink speed so he fidgets.

Slot 4 is the one with words in it and the rarest at 17–33 s — `bx2`'s is
"Excuse me.". Its text still does not print: the subtitle gate rejects any record
whose ident is `idle 1`..`idle 4` (`0x44084c`), so the nudge is heard and not read.

**`puppetparam 8` is the switch, and it is the game's.** Of the 316 puppets in the
tree exactly **four** turn it on, and each brackets one exchange with it — `zeit1`'s
notebook, `bx2`'s `getbaby()`, `elev1` and `shahack2`. So a character fidgets where a
designer asked for it and nowhere else, which is why the port defaults the slot off:
that is what `TI.EXE` defaults it to.

Two notes on how this port runs them:

- **The draws come from the ambient stream, not the script one.** `TI.EXE` uses its
  single `rand()`, so this is a deliberate deviation — and it is the crickets'
  argument exactly (`GameSession.ambientRng`): these timers re-arm on the CLOCK, so
  how many times they draw depends on how long a host dwells at a plaque, and moving
  them re-values every script draw after them. That cost the Gorse/Jones coin its
  determinism once already. Which arbitrary number an idle timer gets is unobservable
  to any script; when the story's coin lands is not.
- **A bevel click still answers while an idle line plays.** The original ignores the
  mouse inside that wait, so the click would be dropped; for a 300 ms blink that is a
  click a player would swear they made, and nothing is bought by losing it. ESC
  during one *does* behave as the original does — it cuts the line and leaves the
  conversation, because each timer tests the interrupt flag after its line and bails
  to the −1 exit (`0x4417ab` and its three siblings).

**`T` is bound to nothing, on purpose.** It is the other arm both tables share, and
it does not act — it sets the filter's out-param and answers "not an interrupt"
(`0x441e54`). Of the three call sites only the movie loop reads that flag
(`0x44a3e9`), so during a spoken line T does nothing in the original either. What it
does over a clip is toggle an audio latch (`0x48c510`, `0x425080` to start and
`0x424d80` to stop) whose stream is not yet identified — so it stays unbound until
someone names it, rather than being guessed at as a subtitle toggle (which is what
it was first mistaken for).

One deviation on purpose: the original's waits swallow *every* key, so an unmarked
one never reaches the scripts. The port passes those through, because nothing needs
them eaten and a conversation is not the place to find out otherwise.

Next: what all of this sounds like — **[Audio at runtime](audio.md)**.
