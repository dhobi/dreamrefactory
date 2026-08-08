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
  line ends — racing the audio against a click, so clicking skips the line.
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
  choice mechanism.
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

Next: what all of this sounds like — **[Audio at runtime](audio.md)**.
