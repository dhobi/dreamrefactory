# The browser host

*Prerequisite: [Engine architecture](../02-engine-architecture.md).*

Everything under `src/` (not `src/df/`, not `src/engine/`) is the **host**:
the code that is neither format knowledge nor recovered engine behaviour, but
the glue that puts the game on a canvas — the page, the navigation renderer,
the movie player, and input. If the engine is the recovered `TI.EXE`, this layer
is the recovered *Windows 95* around it.

| File | Role |
|------|------|
| [`main.ts`](https://github.com/dhobi/taoot-web/blob/master/src/main.ts) | the page: DOM, the cold boot it starts, input, the rAF loop — nothing about the game |
| [`host.ts`](https://github.com/dhobi/taoot-web/blob/master/src/host.ts) | `GameHost` — what it means to *run* the game: set activation, prefetch, cold boot, resuming a save |
| [`viewer.ts`](https://github.com/dhobi/taoot-web/blob/master/src/viewer.ts) | `SetViewer` — navigation state machine + renderer |
| [`screen-presenter.ts`](https://github.com/dhobi/taoot-web/blob/master/src/screen-presenter.ts) | `ScreenPresenter` — the one persistent framebuffer everything composites into, and the "is this picture already on the canvas?" check. Owned by the host, so it **outlives the viewers** |
| [`ring-cache.ts`](https://github.com/dhobi/taoot-web/blob/master/src/ring-cache.ts) | the LRU of decoded turn/walk rings the viewer draws from |
| [`movie-player.ts`](https://github.com/dhobi/taoot-web/blob/master/src/movie-player.ts) | `MoviePlayer` — modal MOV playback |
| [`puppet-view.ts`](https://github.com/dhobi/taoot-web/blob/master/src/puppet-view.ts) | conversation rendering (see [Characters](characters.md)) |
| [`files.ts`](https://github.com/dhobi/taoot-web/blob/master/src/files.ts) | `FileStore` — game files by lowercase basename, lazy dev-server fetching |
| [`bug-report.ts`](https://github.com/dhobi/taoot-web/blob/master/src/bug-report.ts) | the Report bug button: a prefilled GitHub issue, and the screen on the clipboard |
| [`log-buffer.ts`](https://github.com/dhobi/taoot-web/blob/master/src/log-buffer.ts) | the lines behind X, bounded — and the tail a bug report carries |
| [`debug-panel.ts`](https://github.com/dhobi/taoot-web/blob/master/src/debug-panel.ts) | what state the game is in, as a list that patches rather than redraws |

## The split, and why it is where it is

`GameHost` owns the session, the open set and the lifecycle between them;
`main.ts` owns the browser. The host may not mention `document`, `window` or
WebAudio — the page passes its side in as a **file source**, five **UI
notifications** (`log`, `hud`, `showStage`, `mapChanged`, `setsChanged`) and an
`AudioSink`.

That line is not tidiness. The lifecycle used to live in `main.ts` purely
because the mutable `viewer` did, and the test suite — unable to import a module
that touches `document` — hand-rolled a seven-line `onSetChange` in its place.
It was therefore testing a stand-in that didn't prefetch, didn't start a theme
and didn't reset the scheduler, while three defects sat in the real thing.
`tests/auto/regression.ts` now builds the **same `GameHost`** over the on-disk
`gamefiles/` index and a recording sink, so activation and the cold boot are
ordinary tests. Anything a test could contradict belongs below the line.

## One rule the host keeps breaking

`TI.EXE` issued screen and sound as **fire-and-forget** commands; a retained
renderer and WebAudio give us **state** instead — a fade level that persists, a
`currentThemeName`, an audio source that plays until stopped. Every bug of this
shape found so far has been the host writing that state at the wrong moment,
in one of four ways:

1. **A default applied before the script has spoken.** `startTheme` ran ahead
   of `openset` → `setupsound`, so the set-named bank blipped before the deck
   theme; the black was lifted at movie end, before the script that played the
   movie had finished dressing the screen. *Rule: the script gets the last word;
   the host fills in only what it leaves.*
2. **A play with no owner.** A movie's event sounds and a skipped `puppetspeak`
   line ran on after the thing that started them was gone. *Rule: whoever starts
   a sound ends it — by handle, since channels are shared with room ambience.*
3. **State the engine believes but the host never delivered.** Loops started
   before the AudioContext existed were dropped while `currentThemeName` said
   they were playing; a set-swap with no `closeset` behind it left the previous
   room's scheduled work running. *Rule: if the engine records it as running,
   something must actually be running — or the record has to go.*
4. **A once-per-session step run per room.** Booting the session re-fired
   `house.shp`'s `openshop` on every activation — a LAYOUT pass (`propxy("bag",
   256, 324)`, the interface band), where putting the bag on the C73 bed is
   `initprops`' one-time job. So the bag stopped being a world prop as soon as
   any later set opened, and leaving the cabin and coming back through the door
   lost it. `boot()` opens those shops once and never again. The method is now
   `session.ensureBooted()` — no caller can know whether it is the first, so
   they state what they need and the session decides; naming it `load…` is what
   invited the repeat. *Rule: match the boot's cardinality, and say so in the
   name — a silent guard under an imperative name is a trap for the next
   caller.*

Each is cheap to re-check when adding host code: *does a script still have
something to say after this line, and who ends what this line starts?*

## The page, and going straight in

The game is its own page, `/play/` (`play/index.html`); the front page
(`index.html`) is welcome text and a Play button, and nothing else. They were
one document until the welcome had to be hidden the moment the boot had
something to draw — which put the sentence explaining that this is a
re-implementation on screen for exactly as long as the files took to load.
Splitting them means the front page can wait as long as the reader does, and the
play page can assume the decision was already made a navigation ago.

The play page reads the `gamefiles.json` manifest, settles an
**edition**, preloads everything the boot will want with a bar over the bytes, and
then **cold boots itself** — the real `boot()`, logos into the main menu. (What
"everything the boot will want" *is* comes from the game rather than from a list
here — see [the boot plan](#the-boot-plan-what-a-game-says-it-needs) below.) It used to show a landing screen first: cold
boot, **Load game**, three story-state shortcuts, and a clickable list of every
hosted `.SET`; a `#devstate` bar with jump buttons for every puzzle followed them
once a set was open. Everything except the cold boot was a shortcut for working on
the game rather than playing it, and the dev harness behind them is **gone** —
saves reach the same places through the in-game menu (the same modal `opengame`
uses) and any room through the editors, and what the harness was really for is
covered by [the playthrough](../verification.md), which plays the game rather than
jumping around inside it. What is left on the page before the framebuffer is
`#booting`: one paragraph — held invisible until the
catalogue has translated it, so a German reader is not shown the English first —
taken down when the stage appears, and left standing when no game files were
served, which is what an install with nothing in it looks like.

Under the canvas, in this order: what you can press (Fullscreen, Report bug),
how a swipe reads on a touch device, the keys, and — behind **X**, off until
asked for — the scene/view readout and the script log.

### Reporting a bug, and the one thing a URL cannot carry

**Report bug** opens `github.com/dhobi/taoot-web/issues/new` with `title` and
`body` prefilled ([`bug-report.ts`](https://github.com/dhobi/taoot-web/blob/master/src/bug-report.ts)):
the room, the edition, the page URL, the browser, the window size and the last
eight lines the engine logged — the three questions every report about this port
otherwise has to be asked. The title names the room, because that is what makes
an issue list readable.

The picture cannot go that way. GitHub has no query parameter for an attachment,
and the framebuffer is a **42 KB PNG** against a URL that starts answering 414
around 8 KB — the only route an image has into a comment box is the clipboard or
a drag. So the screen is written to the clipboard and the body says to paste it;
a browser that refuses an image on the clipboard downloads the PNG instead and
the line beside the button says which of the two happened.

Two orderings are load-bearing, and both are the same rule — a browser only does
these things *for a click*. `clipboard.write` is called first and from the
click's own task, because it refuses when the document is not focused and the new
tab is about to take the focus away; `window.open` follows immediately, still in
that task, because from a `.then()` it is a popup and a blocker may eat it. The
`ClipboardItem` is handed the *promise* of the blob rather than the blob, which
is what that form is for: the write is issued while the click is still the reason
for it, with the PNG encoding still to come.

Nothing is sent anywhere. The button opens a form; what the player submits is
whatever they can see in the box.

## The boot plan: what a game says it needs

Two things have to be known before a DreamFactory game can start over HTTP: which
files to have in hand so `boot()` never waits mid-sequence, and which room the
boot ends up in. Both used to be **hardcoded lists of TAOOT filenames** —
`bedsit1.set`, `logo.mov`, `gang.cst`, `house.shp`, sixteen of them — which is
knowledge about one game sitting in the layer that runs any of them. The 1996 demo
shares four of those names and needs a fifth the list had never heard of.

They are read instead, out of the game's own BOOTFILE
([`engine/bootplan.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/bootplan.ts)),
because every one of those files is named as a string literal by the boot's own
scripts — `opencastfile("gang.cst")`, `openshopfile("house.shp")`,
`opentrackfile("unilib.trk")`, `openstagefile("main.stg")`, `playmovie("logo.mov")`,
`initall("bedsit1")`. The scan walks calls out of `boot()` through the boot
library, which is what catches a resource the entry point opens *indirectly* (the
demo's `boot()` ends in `menuscreen()`, and that is what opens `demo.stg`), and it
yields four things:

| | |
|---|---|
| `resources` | every file the startup path names, in the order the boot reaches them — what `GameHost.preload` weighs and fetches behind the bar |
| `casts` | the cast files, held apart because a set change has to keep the story cast in hand while it swaps everything else out |
| `landingSet` | the room the day machine opens first, or **null** — which is not a degenerate case but the demo, whose `boot()` ends on a menu stage and whose `advanceday` lives in `main.stg`, opened three clicks later |
| `volumes` | the disc directories `setpath` mounts, in disc order (`["titanic1", "titanic2"]`), empty for a single-volume game |

Two boundaries are worth knowing. The scan **stops at the day machine**
(`advanceday`/`advancetour`): `boot()` ends with `sendtostage(advanceday())`, so a
walk that followed it would run on into the entire story — the full game's
`advanceday` names `ocredits.mov`, `leave.mov` and `credits.mov`, 85 MB of endgame
a player five seconds into a launch must not wait for. That is also exactly where
the host divides, since `coldBoot` runs `boot()` and then kicks the day advance
itself. And `fileexists` is deliberately **not** a resource call though it names a
file: the demo's `boot()` does `fileexists("gstair2.set")` as its "is the CD in the
drive?" check, and fetching 9 MB of grand staircase to answer a question about
presence would be the most expensive no-op in the boot.

The plan is fetched and parsed **once** and shared; an edition switch is a page
reload, so there is no live invalidation to get wrong. Three other places take
their answer from it rather than from a list: `loadServerSet` (an entry point that
may be reached without `boot()` ever running — a dev jump, a resumed save),
`session.ensureBooted`'s stand-in boot, which replays the plan's openings in the
boot's own order and skips movies because playing the intro is not what a stand-in
is for, and `FileStore.setVolumes`, where `discOfUrl` used to be a
`/titanic([12])/` regex — one title's CD labels in the layer that resolves any
title's files.

## Hosting it as static files

Nothing on this site needs a server. Two dev middlewares look like it and neither
is:

| | in dev | in a static deployment |
|---|---|---|
| the **listing** of `gamefiles/` | served live from a directory walk, so a tree that changes needs no rebuild | `gamefiles.json`, written into `dist/` by the same walk at build time (`tools/manifest.ts`) |
| the **bytes** | streamed by a middleware, because Vite's transform 500s on extension-less paths like `…/data/bootfile` | the host serves them. Every consumer reads `arrayBuffer()`, so no Content-Type matters, and nothing asks for a Range |

So a deployment is `npm run build`, then `dist/` and `gamefiles/` uploaded beside
each other — the manifest names paths as served, `gamefiles/en/…` and bare
`lang.stg`, and every consumer prefixes `/`. Where the game data is uploaded
separately from the pages, or a host carries fewer editions than the machine that
built them, regenerate the manifest where the tree actually lives:

```
cd /var/www/taoot
npx tsx …/tools/mkmanifest.ts . ./gamefiles .    # outDir, gamefilesDir, publicDir
```

Run it **from inside the deployment**, with those relative paths: the keys are
the walked paths as written, so an absolute `gamefilesDir` writes absolute keys
and nothing resolves. The third argument is where the authored DF files
(`lang.stg`, the intro movie) are — `public/` in a checkout, the deployment root
here, because that is where `public/` is served from.

The [deploy workflow](../reference/deploy.md) never uploads a manifest, for the
same reason: the machine that builds the pages has no rip to describe.

Two things to know before uploading: paths keep their case (`TITANIC1/data` beside
`Titanic2/DATA`, and object stores are case-sensitive), and an edition is
1.2–1.3 GB across ~670 files, of which ~260 MB is movies. A visitor pulls ~38 MB
before the game starts — that is what the preload bar counts — and movies after
that, on demand. The data never changes, so it takes a long `Cache-Control`; the
manifest should not.

Saved games are IndexedDB and were never server-side; the editors export by
download. There is no other moving part.

The click those buttons carried was also what unlocked audio; the window arms
the same `ensureAudio()` on the first pointerdown or keydown anywhere, so the
boot runs silently until the player touches something and `attach()` restarts
the theme already playing.

Loading a set lazy-loads it plus its siblings (`.shp`, `.trk`, `.sfx`,
`.11k`); anything scripts ask for later (`openshopfile("blkjack.shp")`) is
fetched on demand — a `FileStore` miss the dev server could satisfy kicks off
a background fetch. Production builds don't bundle or serve game files.

Audio needs a user gesture in a browser, so the `WebAudioSink` is created
lazily on the first pointer/key event ([see Audio](audio.md#sinks-browser-vs-headless)).
The session's dialog hooks map to native `alert`/`confirm`/`prompt`; save and
load route to [the save browser](saves.md#the-saved-games-ui). `window.dbg`
exposes the viewer and session to the console (and to the Playwright test).

## `SetViewer`: navigation and rendering

The viewer owns one parsed SET and is rebuilt on travel (sets are disposable,
[the session is not](../02-engine-architecture.md#the-gamesession-the-thing-that-persists)).

**Frames.** Turn/walk frames are decoded a **ring** at a time — one
standpoint's turn circle, or one road — and held in an LRU with a 24 MB budget.
Each carries its pixels, optional Z layer, and its **per-frame camera pose**,
so world sprites stay correctly projected *during* motion, not just at
standpoints.

The unit is the ring because the [delta codec](../formats/image-codec.md)
makes a frame a patch on the one before it: individual frames can't be decoded,
chains can. A ring, though, needs **nothing before it** — its first frame
repaints every pixel. Measured across the 20 largest sets, all 998 rings, each
decoded from a fresh buffer and from a poisoned one: every frame byte-identical.
So rings can be decoded on demand, in any order, with no priming.

That reading cost a while to arrive at, because a **codec** bug wore the costume
of an ordering bug. Run-mode-7 back-references shorter than their run must
*tile* what they just wrote; the port memmoved instead. Four such runs in a walk
down the boat deck were enough to poison every later frame in the chain, and the
damage landed in the flattest part of the picture — the night sky — as coloured
horizontal dashes that grew as the walk went on and vanished the moment you
stood still. Under that corruption 38 rings *looked* like they needed a
predecessor and roads *looked* like they needed the standpoint they departed;
both readings evaporated when the copy was fixed. The suite now pins the real
property (any ring, any buffer state, same bytes), which is the canary if it
ever regresses.

Everything used to be decoded at set-open instead: correct, and **366 MB** for
the boat deck (1420 frames, half of it Z planes). Now the same room holds
16 MB — where the player stands and where they can go. `tick` decodes one
reachable ring per idle frame, so turning costs ~0.1 ms in play; the visible
cost is a single ~70–90 ms frame when arriving somewhere whose ring nothing had
reason to warm yet. Frames on screen or queued in an animation are held by
reference, so an eviction can never blank them.

**Motion.** Turning walks the scene's ring to the next named view; walking
takes the first available road and picks the **arrival view nearest the
travel direction** (a road's endpoint view faces back along the road — see
[SET](../formats/set.md)). Turn/walk animation paces at ~90 ms per frame
(~11 fps, close to the original's feel). While animating, `currentview()`
returns the pseudo-view **`"moving"`** — scripts genuinely poll for it.
`jumpTo` tolerates the shipped data's one stale view name by falling back to
the nearest view by rotation.

An arrival's **own scripts may drive the camera**, and they are trusted to.
`currentscene()`/`currentview()` are unconditional setters in `TI.EXE`, but the
port armed them only inside a user gesture's script chain — and a walk's arrival
lifecycle runs *ticks* after the gesture ended, so an `openscene` that repositions
the camera fired into no-op hooks. They are armed around the walk-arrival
`closescene`/`openscene` now, scoped exactly as `keydown`'s and `press`'s are. The
demo's grand staircase is where it showed: it fakes three decks out of two set
files, and landing in `gstair2` runs `changeset(theset); currentscene(thescene);
currentview(theview)` off `savedeck` — the `changeset` fired, the jumps were
dropped, and every climb landed at the arriving set's *default* scene. A corpus
audit finds exactly three `openscene` handlers that move the camera and no
`closescene` that does.

**Rendering** asks one question per frame — `screenOwner()`: **movie**, **puppet**,
**faded**, **world** — instead of the three if-chains in an order nothing enforced
that it used to be. A movie is first, which is the rule the input path already
kept, and the two had drifted: the puppet branch had been taught to yield to a
movie and the fade branch never had. A movie carries its own palette and its own
pixels, so a fade the script left standing is not a layer over it — it is applied
*around* the rectangle the clip paints (see [`MoviePlayer`](#movieplayer)). The
demo's Smethells briefing is where that showed — `screentoblack("puppet", 15)`,
`puppetvisible(false)`, `playmovie("penote.mov")` with no `blackscreen()` between,
and `blackscreen()` is the one thing that drops the held snapshot — so the note
played, clickable, behind a black rectangle. `TI.EXE` settles what the black *is*:
`screentoblack` (id 12050 at `0x43e550`) is a blocking ramp that dims `steps` times
and returns, leaving nothing behind, so the black is simply what was last drawn and
the next thing to draw the screen owns it. Our persistent fade level is a fair
model of the ramp and a wrong model of what follows it. The shipped game has the
same shape twice (the darkroom's `photobox.mov`, the wireless portrait).

Within `world`, the path is: stage flat (with the set view composited in when
visible, then world sprites, then props) → bare set. On top: the persistent `drawstring` text
overlay (Courier New, colour 0 = black), the fade level, the optional hotspot
overlay, and the deck-plan minimap. The `clut`/`mixclut` palette dims (the
darkroom) rebuild the set/stage palettes through the same paths.

**A `clut` on the surface the screen is showing is its own reveal.** In `TI.EXE` a
fade *is* a palette ramp, so re-establishing the palette is what brings the picture
back, and a script that dims into place need issue no `blacktoscreen` at all.
`transtoflat("redphoto.stg")` is the case: `screentoblack("current")`, then
`mixclut("stage", "black", 0, 255, 245)` and nothing after it — so with an overlay
fade and nothing lifting it, Burns' darkroom sat pitch black, red lamp and trays and
all. It is the same shape as `visualeffect`'s reveal, one function up. Scoped to the
*showing* surface deliberately: `CTL`'s exit runs `clut("set")` between a stage's
`screentoblack` and its `blacktoscreen`, and lifting the black there would flash the
room in early.

`blackscreen()` is a **one-shot** paint in the original and a retained level
here, so a movie that ends over it would leave the screen black forever. The
end of a movie therefore only *arms* a reveal; the black is lifted a frame
later, and only once **no script dispatch is in flight** — the script that
played the movie almost always has more to say about the screen (the boot
opens the flat and plays the date caption under the black before
`advanceday`'s `blacktoscreen` fades it in), and any `blackscreen` /
`screentoblack` / `blacktoscreen` it runs cancels the pending reveal. Revealing
at movie end instead flashed the fully-lit room between the menu and the
fade-in. A flat whose intro movie is followed by no fade at all (the bomb's
`openstage`) still gets its reveal, as soon as the script falls quiet.

### The click priority chain

The host's part of a click is short, and everything modal comes first:

1. a **playing movie** (it owns the screen and its clicks, even over a suspended
   conversation);
2. a **visible puppet** (bevel hit-test; a hidden puppet lets clicks through);
3. `lockevents` — the scripts freeze the world while the game is doing something
   to you, and BOOTFILE's own `mousedown` exitcodes on it in exactly this
   position, after the puppet branch, so a conversation still answers while
   locked;
4. a click made while a script is **in flight** is *queued* rather than dispatched
   (`TI.EXE` queues it too — the shipped `premovie`/`playmovie`/`postmovie` call no
   `flushevents()`), unless a poll loop is reading the button right now, in which
   case this press *is* its input and a second copy would replay into whatever
   comes next.

Then the dispatch itself, which **the game does**: `BOOTFILE` 0001's `mousedown` is
`hittest` and a switch on `result()` over six cases into
`sendtoprop` / `sendtoactor` / `sendtobutton` / `sendtoscene` / `sendtopainting` /
`sendtoflat`. Where a title ships that handler it decides where a click goes; the
port's transcription stays as the fallback for a title that does not, in the order
`hitTestAt` answers in — the sprites (props front-to-back, opaque-pixel accurate,
then actors with occlusion), then the SET where its image is drawn (a hotspot is a
`"painting"`, smallest region first; else the scene itself, by name), then the
STAGE where that image is not (a named region is a `"button"`, else the current
flat). The argument a prop's `mousedown` receives is the **packed click point**,
not the prop name.

What counts as "there is a stage" is `GameSession.stageOpen` — the question the
game's own `stagevisible` asks (`stageName != "none"`), and both the hit test and
the dispatch use it. It used to be "does the stage have a **main script**?", and a
stage need not have one: TAOOT's `inven1.stg` does, the demo's `inven.stg` does
**not**, because there the *flat* carries the handlers. So in the demo a click on
the open bag's OK button answered `("", "none")` instead of `("ok", "button")`, the
boot's `mousedown` switch had no case to take, and nothing was dispatched at all —
a live-looking button under an empty engine log.

Hovering runs the **same** hit test and sends `setcursor` to whatever it answered,
through the same six dispatch paths — so the cursor and the click cannot promise
different things. The name comes back from the scripts, and the whole corpus emits
five of them: `touch` (809 times), `arrow` (75), `hand` (36), `watch` (18) and
`fist` (2), which `main.ts` maps to CSS cursors. What makes a takeable thing a hand
is `inven.shp`'s main and a person `gang.cst`'s, both gated on
`realdist(target) < hotdist()` ([characters](characters.md)); the port used to
choose the cursor itself and answered `talk` over a character, a name no script in
the game ever emits.

### Keys

`DF_KEY` maps arrows to the engine's `"leftarrow"`/`"rightarrow"`/
`"uparrow"`/`"downarrow"` events — remember
[keys are script events](../03-scripting-language.md#the-chain-and-how-an-event-is-consumed),
not direct movement. **Space** is forwarded too (the boot's `keydown` opens the
door you're facing).

**Escape** is forwarded, not acted on. `DF_KEY` maps it to the character `"."`
with the special-key marker set, which is exactly what TI.EXE's window proc
does, and the decision belongs further down: `SetViewer.keyDown` gives a
playing movie the key before anything else (the same precedence `click()`
gives it), and `MoviePlayer.key` is what knows that a marked `.` means abort —
see [escaping a movie](../formats/mov.md#escaping-a-movie). With no movie up
the key just goes down the script chain and is ignored. This host has no
"skip" verb of its own, deliberately.

A phone has no Escape, so **two taps in the same place within 320 ms** are
forwarded as one — `keyDown(".", true)`, the identical route the key takes, so a
live movie aborts and anything else ignores it exactly as the original does. Only
the *second* tap is swallowed: holding every tap back to see whether another
follows would put 320 ms of lag on every press in the game, and during a clip —
which is what this is for — the first tap reaches no region and does nothing. It
sits with the other touch gestures (a swipe is an arrow press, a quick lift a tap,
staying down a press for the drag loops) and after the same checks, so a drag or a
walk swipe can never be read as half a double-tap. Verified by hand on a device and
not covered by a test: Playwright's synthetic taps are separate round trips and
land further apart in page time than the window allows.

**A finger that goes down on a control is never a swipe.** The classifier holds the
mousedown back to tell a swipe (navigate) from a press (play) and resolves it by
*waiting* — which is right for a tap and wrong for a drag, because a drag moves
immediately. Travel 48 px inside 220 ms, as any real drag does, and the gesture was
ruled a swipe: no mousedown ever arrived and the camera walked instead. The drag
that matters is the inventory's — `INVEN.SHP`'s `stdmouse` carries a held item with
`propxy(handitem, pointx(arg), pointy(arg))` in a `while stilldown()` loop and drops
it on whatever `hittest` finds, which is how the trunk key is used. So a finger that
lands on a **prop** or a stage **button** takes the press at once and is never
reclassified; a finger on a room surface keeps the old behaviour, because swiping the
room is how a phone walks.

A phone has no arrow keys either, so a swipe presses the one it points at
([`swipeKey`](https://github.com/dhobi/taoot-web/blob/master/src/keys.ts), pure, so
the rule is testable without a device): leftwards turns left, rightwards turns
right, away from you walks on, back towards you sends `downarrow`. Both axes
can be flipped, independently, from a row of two checkboxes under the screen that
only a touch pointer is shown — a turn has a second reading with as much of a
claim (the finger pushes the *scene*, the panorama convention), and which one
feels right is a matter of the hand rather than of the game. The answers live in
`localStorage` under `taoot.swipe.invertturn` / `taoot.swipe.invertwalk`.

Down is a **plain key event** rather than a nav press, which is the keyboard's own
asymmetry (`ArrowDown` goes to the script chain and nothing in the engine acts on
it). It was left unbound entirely for a while on that reasoning, and the reasoning
was half right: almost nothing reads `downarrow`. The exceptions are `SMSTACK2` and
`SMSTACK3` views 43, 50, 54 and 56 — the false smokestack's ladder platforms, whose
scene `keydown` is the only way down a level — and since the way out of the
smokestack is at level 1, a player with no `downarrow` could climb the maze and
never leave it. A soft-lock, not a missing convenience (#100). Binding it also
makes "invert forward" swap a pair instead of moving walking onto a dead end.

Three host-only keys: **M** toggles the deck-plan minimap, **O** the hotspot
overlay, **X** the details pane under the bars — the scene/view readout and the
script log, which are off until asked for, because a running game should say
nothing the player did not ask about. The pane is opened by a log line *before*
the stage appears, though: a boot that never finishes has nothing else to say
for itself, and the first `showStage` shuts it again. A full-screen overlay stage
with a `keydown` target consumes all keys itself — the wireless telegraph key
needs raw letters, which is also what keeps X out of the Zeitel machine's way.

**The first `showStage`, and only that one.** It fires on every set activation,
so resetting the pane there emptied the log and shut it at every changeset — 28
rooms and at least 40 set changes over a full playthrough, which is what #22
reported as "resets on every set change". The page now resets on the two things
that really start a game from nothing (the cold boot, and `quit()`'s return to
the menu), and the pane's open/shut answer is remembered in `localStorage` under
`taoot.details.open` alongside the swipe and picture ones.

**Where the pane lives.** Beside the screen when the window is at least 1480 px
wide, under the bars below that — the *element* moves between the two homes
(`installRail`), so X, the log, the state list and the scroll position are the same
objects either way and there is nothing to keep in step. The body is padded by the
rail's width while it is up, so the screen re-centres in what is left instead of
sliding under it.

**What the state list is.** Every script global, rendered from `snapshotState` —
the same function the playthrough goldens are recorded with, so what a reporter
reads and what a golden compares are the same numbers. It is off until asked for
(the `state` box, or `?debug=1` in the URL) and it answers **what just moved**
rather than the whole table: 93 globals at boot and 161 by the credits, of which
121 ever move, but the median number that changes between two story beats is 5 and
the most ever is 30. `all` gives the table, a filter searches it, and the six the
game's own HELP button answers with (`Mission`, `Phase`, `Letter`, `Necklace`, and
`Maze`/`Level` in the smokestack) stay on top of both.

The clock is excluded from "what just moved" by
[`engine/masks.ts`](https://github.com/dhobi/taoot-web/blob/master/src/engine/masks.ts) —
the same predicate the trace comparisons drop, moved out of `tests/` when the panel
turned out to need the same answer. Without it the list was permanently `sec` and
`clockcount` and nothing else.

The list **patches** its rows rather than rebuilding them, because it polls (there
is no "a global changed" event to listen for) and a rebuilt list threw away 161
elements every 250 ms for a screen that had not changed. Measured with a
MutationObserver: a room standing still costs **0 mutations** over 16 refresh
ticks, one moved global costs 2 (its number and its highlight), and the only writes
left under `all` are the pocketwatch's own.

The lines themselves live in a bounded buffer
([`log-buffer.ts`](https://github.com/dhobi/taoot-web/blob/master/src/log-buffer.ts)),
not in the `<pre>`: the pane used to be its own storage and grew without end. A
whole game is 1141 lines / 40 923 bytes, so the 5000-line cap is not a budget for
playing — it is a ceiling for a session that never ends, where `movie click …`
arrives once per click inside an interactive movie. Past the cap the oldest tenth
goes at once, so a repaint costs once per batch rather than once per line, and
`dropped` counts what left so a follower (the browser gate's `ENGINELOG`) can
still tell where it got to.

### `quit()` goes back to the front door in place

The credits end `playmovie("credits.mov"); quit()`, so `quit` is called from
*inside* the dispatch that played them, and a boot re-entered underneath it would
be building sets while the old game was still talking. That was answered with a
page reload for a while, which is a poor front door: it throws the page away to
reach something the page can show, and it took the run with it (the browser suite's
segment 27 reported "Execution context was destroyed" and then read the theme off a
dead page). It is done in place now, in two halves that are not timing guesses:
`onQuit` returns immediately and continues on the next rendered frame through
`session.nextFrame` — the engine's own yield, the same primitive script poll loops
use — and `GameSession.prepareRestart` then awaits `settle()`, so nothing is torn
down until the dispatch that asked for it has unwound. What it puts down is what
would otherwise outlive the game: the scheduler (a finished game's loops firing at
scenes the new one has not built), every audio channel (a theme is a loop and
nothing else would stop it), a puppet, the fade the credits left pinned black, and
`ensureBooted`'s idempotence latch — a restart being precisely the case that has to
run it twice. Game state is deliberately *not* reset here: BOOTFILE's own
`clock = "startdisk1"` arm does that, and the data resetting itself beats this
layer guessing at the same list.

## `MoviePlayer`

Implements the MOV state machine [from the format doc](../formats/mov.md):
the seven type codes, region waits, and a **five-deep cross-movie call
stack** — one `playmovie()` promise is held across an entire chain, so the
script resumes only when the *last* chained movie closes. Event sounds resolve
from the movie's own chunk table first, then the open [audio banks](audio.md).
Entering a header-named action frame latches the `actionframe(n)` flag scripts
test afterwards.

**A file is a chain of segments, and the player walks it.** The per-picture
state — frames, palette, region metadata, cues, the screen origin — is the
*current segment's*, and `enterSegment` swaps the lot when a segment's type-1
exit leads to the next one; only the last segment's exit ends the film. Which is
why a **type-1 exit is not `finish()`**: `endSegment` decides. The soundtrack
follows the engine's own segment-reload rule (`0x44956f`) — a segment that brings
a bed **replaces** the playing one, a segment that brings none **inherits** it,
which is how one narration scores `TOUR.MOV`'s twenty segments. `MovSegment.cues`
are polled on every tick and **outside** the self-pacing gate, because a timed
jump fires out of any wait, a modal region wait included; each fires once, on the
segment's own clock.

**Pacing is the film's, not ours.** `frameHoldMs` — `max(frame hold, segment
floor)`, [recovered from the demo build](../formats/mov.md#a-movie-carries-its-own-pacing-solved-out-of-the-demo-builds-engine)
— decides every advance. `chooseFrameInterval` only decides *whether* a movie is
self-paced at all (0 = a click-through close-up); a frame authored to wait for the
spoken line holds until the movie's own event sounds are done. The soundtrack is
still assembled the recovered way: unique chunks for a length, every chunk
resampled up to the highest rate present, and **110%** of the predicted runtime
taken out of the authored order with a loop as the backstop, because the picture
always runs a little long against a tick-quantised prediction.

**A clip is a rectangle painted over the screen**, not a screen of its own. It
lands at the segment header's origin, and only the pixels it covers are written.
302 of TAOOT's 327 segments cover the whole 512×384 and make the distinction moot;
the 25 that do not divide in two, and both halves need it. The in-room transitions
— the lifts, the smokestack climbs — are 512×264 at (0,0), which is exactly the
room-view region, and they play straight out of a `keydown` with nothing hiding the
interface, so the band belongs *under* them rather than being cleared for the length
of the ride. The demo's letterboxed cutscenes are 512×264 at (0,60), centred, and
play behind a fade the script has already raised — so what belongs in their black
bands is that fade, showing around the clip. A live clip is never dimmed by the persistent fade level
(in `TI.EXE` the fade is the *palette*, and a movie carries its own) — the fade is
applied around it instead.

**Ending a movie puts down what it started.** The bed is halted with the film,
the same as `TI.EXE`'s no-next-segment teardown (`0x449d40`). Event sounds are
stopped only for a clip the *player* was driving (dismissed, or interactive at
all): a cutscene's frame-entry sound is often a spoken line timed to ring out
past the last frame, and cutting that is the bug — measured, 16 of the 52
region-less movies with audio fire a sound they leave no room for. And the frozen
frame a fade-out was holding is **voided**, because a movie outranks a held fade
in `screenOwner`: whatever a `screentoblack` snapshotted before the clip is not
what should come back after it, and leaving it deadlocks the reveal the movie's
end arms.

Back to the [runtime index](README.md) or the
[documentation home](../README.md).
