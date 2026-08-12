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

### Which of the 8 sprites do you see?

Each pose animation step has **8 directional frames** (a CST stores them 45°
apart). The one drawn is *not* picked from the actor's facing alone — it's the
facing **relative to the bearing from the actor to the camera**, because which
side of someone you see depends on where *you* stand. Sprite direction 0 is
"facing the viewer": an actor looking straight at the camera shows frame 0
wherever you are. Get the reference backwards (camera→actor instead of
actor→camera) and every character shows their back at the wrong moments —
one of those bugs the regression tests now pin down.

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

That second one is worth knowing when a timing change looks harmless. The
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

Two deliberate gaps, both their own issues: ESC also answers the plaque wait in the
original, returning −1 to the script and walking the player out of the conversation
(`0x4418a7`) — that moves where scenarios go, not just how fast, so it is not folded
in here; and the filter binds **0–9** for volume and **T** for subtitles during a
line (#129), neither of which is wired up.

One deviation on purpose: the original's waits swallow *every* key, so an unmarked
one never reaches the scripts. The port passes those through, because nothing needs
them eaten and a conversation is not the place to find out otherwise.

Next: what all of this sounds like — **[Audio at runtime](audio.md)**.
