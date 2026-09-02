# The browser host

*Prerequisite: [Engine architecture](../architecture.md).*

The **host** is the code that is neither format knowledge (`engine/src/df/`)
nor recovered engine behaviour (`engine/src/runtime/`), but the glue that puts
the game on a canvas — the page, the navigation renderer, the movie player, and
input. If the engine is the recovered `TI.EXE`, this layer is the recovered
*Windows 95* around it.

It lives in two places, and the seam between them is the subject of the next
section. `engine/src/web/` is the reusable half — it knows about canvases and
key events but not about which game is running. A game's own `src/` is the
other half: the page, its DOM, and which disc it reads.

**The engine's browser layer** — `engine/src/web/`:

| File | Role |
|------|------|
| [`host.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/host.ts) | `GameHost` — what it means to *run* the game: set activation, prefetch, cold boot, resuming a save |
| [`viewer.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/viewer.ts) | `SetViewer` — navigation state machine + renderer |
| [`screen-presenter.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/screen-presenter.ts) | `ScreenPresenter` — the one persistent framebuffer everything composites into, and the "is this picture already on the canvas?" check. Owned by the host, so it **outlives the viewers** |
| [`screen-gamma.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/screen-gamma.ts) | the palette power curve `TI.EXE` applies before anything reaches the screen |
| [`ring-cache.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/ring-cache.ts) | the LRU of decoded turn/walk rings the viewer draws from |
| [`movie-player.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/movie-player.ts) | `MoviePlayer` — modal MOV playback |
| [`puppet-view.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/puppet-view.ts) | conversation rendering (see [Characters](characters.md)) |
| [`keys.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/keys.ts) | whether a keypress belongs to whatever has focus or to the game — see [Keys](#keys) |
| [`save-browser.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/save-browser.ts) / [`save-store.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/save-store.ts) | the saved-games UI and its IndexedDB store, parameterised on a `SaveKind` so each game gets its own database |

**The page around it** — a game's own `src/`. Titanic's is the fuller one and
is what this page's examples are drawn from; Dust's is three files, because one
volume and one edition need much less:

| File | Role |
|------|------|
| [`taoot/src/main.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/src/main.ts) | the page: DOM, the cold boot it starts, input, the rAF loop — nothing about the engine |
| [`taoot/src/files.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/src/files.ts) | `FileStore` — game files by lowercase basename, lazy dev-server fetching, six editions and two CDs |
| [`taoot/src/log-buffer.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/src/log-buffer.ts) | the lines behind X, bounded — and the tail a bug report carries |
| [`taoot/src/debug-panel.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/src/debug-panel.ts) | what state the game is in, as a list that patches rather than redraws |
| [`site/src/bug-report.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/src/bug-report.ts) | the Report bug button: a prefilled GitHub issue, and the screen on the clipboard. Shared, because both games carry it |
| [`dust/src/main.ts`](https://github.com/dhobi/dreamrefactory/blob/master/dust/src/main.ts) / [`dust/src/files.ts`](https://github.com/dhobi/dreamrefactory/blob/master/dust/src/files.ts) | the same two jobs for [Dust](../../dust/README.md), against one disc |

## The split, and why it is where it is

`GameHost` owns the session, the open set and the lifecycle between them; the
game's `main.ts` owns the browser. The host may not mention `document`,
`window` or WebAudio — the page passes its side in as a **file source**, five
**UI notifications** (`log`, `hud`, `showStage`, `mapChanged`, `setsChanged`)
and an `AudioSink`.

That line is not tidiness. The lifecycle used to live in `main.ts` purely
because the mutable `viewer` did, and the test suite — unable to import a module
that touches `document` — hand-rolled a seven-line `onSetChange` in its place.
It was therefore testing a stand-in that didn't prefetch, didn't start a theme
and didn't reset the scheduler, while three defects sat in the real thing.
`taoot/tests/auto/regression.ts` now builds the **same `GameHost`** over the on-disk
`gamefiles/` index and a recording sink, so activation and the cold boot are
ordinary tests. Anything a test could contradict belongs below the line.

It is also what lets one host run two games. `HostFiles` is the whole contract
for "where is the data", so Dust's 212-line `files.ts` and Titanic's
six-edition `FileStore` are interchangeable to everything above them — which is
why the second game cost a shell rather than a second engine.

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

Everything below is Titanic's shell, `taoot/`, which has four pages: the front
page, `/play/`, `/collection/`, and the unlisted `/speedrun/` workbench. Dust's
shell has two — the game and its own `/collection/` — and reaches the same
`GameHost` a shorter way, because one disc and one edition need no manifest
edition axis and no language chooser.

The game is its own page, `/play/` (`taoot/play/index.html`); the front page
(`taoot/index.html`) is welcome text and a Play button, and nothing else. They
were one document until the welcome had to be hidden the moment the boot had
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
covered by [the playthrough](../../taoot/verification.md), which plays the game rather than
jumping around inside it. What is left on the page before the framebuffer is
`#booting`: one paragraph — held invisible until the
catalogue has translated it, so a German reader is not shown the English first —
taken down when the stage appears, and left standing when no game files were
served, which is what an install with nothing in it looks like.

Under the canvas, in this order: what you can press (Fullscreen, Report bug),
how a swipe reads on a touch device, the keys, and — behind **X**, off until
asked for — the scene/view readout and the script log.

### Reporting a bug, and the one thing a URL cannot carry

**Report bug** opens `github.com/dhobi/dreamrefactory/issues/new` with `title` and
`body` prefilled ([`bug-report.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/src/bug-report.ts)):
the game, the room, the edition, the page URL, the browser, the window size and
the last eight lines the engine logged — the three questions every report about
this port otherwise has to be asked. The title names **the game and then the
room** — `[Dust] Bug in nite scene g15`, `[Timelapse] Bug in flat i0001.100.6` —
because that is what makes an issue list readable when one repository takes
reports about three games, and because `[Dust]` in the search box is then a
filter. The game comes from the page's own registry entry (`site/src/games.ts`),
so it has one spelling.

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
([`engine/bootplan.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/bootplan.ts)),
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

The [deploy workflow](../../reference/deploy.md) never uploads a manifest, for the
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
[the session is not](../architecture.md#the-gamesession-the-thing-that-persists)).

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
[SET](../formats/set.md)). Turn/walk animation paces at **50 ms per
frame** — one frame per service pass, which is TI.EXE's own frame period
(`framerate` defaults to 3 ticks of 50/3 ms, `0x429643`/`0x43a940`). It was 90 ms
until a player reported that the original in DosBox moves visibly faster; it does,
by 1.8x, and the rate was never a feel decision to make. A player may move their
OWN moves off it — see [the Movement setting](#the-movement-setting) — and a
script's stay here whatever they choose. While animating, `currentview()`
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
**held**, **faded**, **world** — instead of the three if-chains in an order nothing
enforced that it used to be. A movie is first, which is the rule the input path already
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
the next thing to draw the screen owns it. The shipped game has the
same shape twice (the darkroom's `photobox.mov`, the wireless portrait).

**held** is that last sentence made into a state: nobody owns the screen between a
movie ending and the next thing that draws. `playmovie` frees its buffers and
restores nothing (`0x448b00`, exit path `0x44969e`–`0x4496c7`) — the clip's final
frame is still in the framebuffer and its palette is still installed. Ours handed
the screen back to `world` on the frame the movie ended, and since the script
resumes a rAF later, that was one fully-lit frame of the room in between: measured
at exactly one 16 ms frame of the un-bombed London flat between `bedex.mov` and
`ocredits.mov` ([#209](https://github.com/dhobi/dreamrefactory/issues/209)). While held
the renderer composites nothing at all, which is the whole of what the original
does. It is also why the boot looks right: `boot()` plays `playmode.mov` and then
loads the cast, four shops and a stage before `advanceday` reaches `datebed.mov`,
with no screen statement anywhere in between — so the menu's last frame is what
stays up through the load, in `TI.EXE` and now here.

Within `world`, the path is: stage flat (with the set view composited in when
visible, then world sprites, then props) → bare set. On top: the persistent `drawstring` text
overlay (Courier New, colour 0 = black), the fade level, the optional hotspot
overlay, and the deck-plan minimap. The `clut`/`mixclut` palette dims (the
darkroom) rebuild the set/stage palettes through the same paths.

Every one of those palettes then goes through the **display gamma** on its way to
the canvas — `pow(c/255, 0.65) * 255` per channel, which is what TI.EXE puts between
a palette and the screen (`engine/src/web/screen-gamma.ts`, and
[the codec doc](../formats/image-codec.md#the-palette-bytes-are-not-the-colours-you-draw)).
It is the last step, after any `mixclut` dim, because in `TI.EXE` it is the only
route to the hardware palette. The set, prop and flat palettes, the puppet CLUT (art
and subtitle ink alike) and each movie segment's own palette all pass through it; the
Nightdive intro and the language chooser do not, since neither is the original
showing a room.

### Which keys the page keeps

The page's listener (`taoot/src/main.ts`) is the port's stand-in for TI.EXE's window proc,
and the original translates **every printable key** through its VK table and hands it
to the boot. So does this: past the page's own keys, a single character goes to
`viewer.keyDown` — which is what makes the control panel's rebindable movement keys
work at all (#14), and what lets a scene or flat bind a letter of its own (the deck
map's deck letters, the panel's own key-capture).

Kept by the page rather than passed on:

| | |
|---|---|
| **F1–F9** | the display gamma, handled ahead of everything (below) |
| **M / O / X** | the minimap, the hotspot overlay and the details pane |
| anything with **Ctrl / Alt / Meta** | Ctrl+R has to reload; the original's Ctrl marker only ever mattered to its movie key filter |
| a key typed into a page field | `focusOwnsKey` — typing stays typing |

M/O/X are a deliberate deviation, and the one place it can bite: a player who rebinds
a movement key to `m` will find the minimap takes it. Nothing else in the game binds
those three.

### The brightness controls

The original's are **F1–F9**: F1/F2 move all three exponents (the pair its manual
names as Ctrl+F1/F2 — the code tests the virtual key alone, so Ctrl makes no
difference), F3–F8 the channels one at a time, F9 resets. Each press is a factor of
1.05, and **F1 is the brighten key** because it *divides* the exponent.

Two things about where they sit:

- **They are handled first, and unconditionally.** In `TI.EXE` the arms are in the
  window proc ahead of the one that hands ordinary keys to scripts, so they work over
  a playing movie and under a full-screen overlay stage. The port's listener
  (`taoot/src/main.ts`) matches that — the only thing that takes precedence is the page's
  own focus (`focusOwnsKey`), so typing in a field is still typing.
- **Phones get three presets** — darker / original / brighter — in the play page's
  Picture options, because the original's answer here is keyboard-only. Their unit is
  the keypress: a preset is ±6 notches of the same 1.05, so it is the same control
  rather than a second setting that drifts, and the keys move the selection with them.
  Remembered under `taoot.picture.brightness`. A slider shipped first and was wrong on
  a phone — a 44 px target you can hit is worth more than granularity nobody wants.

### The picture setting

The other control in the play page's Picture bar, and the one thing there that the
original has no key for at all. Every standpoint ships **twice** — low-resolution in
the right-turn ring, high-resolution in the left-turn one, paired by `framePairID`
([set format](../formats/set.md)) — and the original's landings are not uniform:

| a move that | ends on | so it |
|---|---|---|
| turns right | its ring's low-res standpoint | lands soft and sharpens a beat later |
| turns left | the hi-res standpoint | lands sharp |
| walks a road | an in-motion frame (all 722 registers in `gamefiles/en`) | lands sharp, with no soft frame to see |

That asymmetry is what `original` reproduces, and it is the default. The other three
make every direction agree — `sharp`, `transition` (soft for one beat, then sharp),
and `soft`, which keeps the low-res standpoint for the settled view as well and so
leaves the whole room at the resolution the port drew before #68. Remembered under
`taoot.picture.landing`; a player who had ticked the old **always land sharp** box
(`taoot.picture.sharplanding`) starts on `sharp`.

The mechanism is one rule: **the animation's last frame is the one the settled view
will be drawn from**, because `showView` runs in the tick that draws it. So a soft
frame is only ever seen when a sharp one follows it in the same animation, and the
beat is exactly one animation interval. `transition` is the only setting that has to
lengthen an animation — a walk has no landing standpoint of its own, so one is
appended (`SetViewer.standpointFrames`).

None of the four touches the movement itself: in-motion frames are
quarter-resolution in both rings and no sharp version of them was ever made.

### The Movement setting

How long a frame of the player's **own** turn or walk is held. Four segments, and
the numbers are not the port's invention — three of them are values the original's
own `framerate` could be given (`0x489efe`, ticks of 50/3 ms between frames; see
[Timing](timing.md#framerate-and-frame-paced-by-the-clock-not-by-the-display)):

| setting | a frame lasts | which is |
|---|---|---|
| `slow` | 100 ms | `framerate(6)` |
| `original` | **50 ms** | `framerate(3)` — TI.EXE's shipped value, and the default |
| `fast` | 25 ms | 1.5 ticks: the one the original could not have asked for |
| `instant` | nothing at all | `framerate(0)`, which the original documents as *don't wait* |

The rate itself is still not a matter of taste — getting it wrong by 1.8× is what
[#205](https://github.com/dhobi/dreamrefactory/pull/205) was, and `original` is the
measured number. What this adds is the choice: the request
([#222](https://github.com/dhobi/dreamrefactory/issues/222)) is from players who find
20 fps of low-res transition makes them motion-sick and want either a slower walk
or, like Myst, no transition to watch. Remembered under `taoot.move.speed`.

Two things are deliberately outside it:

- **A script's move keeps the engine's rate**, whatever the player has chosen
  (`SetViewer.navigate` passes `FRAME_MS`, the player's path passes
  `SetViewer.playerPace`). Scripts budget *passes* for the moves they ask for and
  then carry on without waiting — BEDSIT1's air raid gives a 7-frame road ten
  passes — so a `slow` player would put the air raid back where
  [#40](https://github.com/dhobi/dreamrefactory/issues/40) found it.
- **`session.frameRate`**, the script-side `framerate()`, stays separate. Scripts
  *write* it (the fight stage asks for 5; the turbine drag loops drop it and put
  it back), and a preference a script can overwrite on the way past is not a
  preference.

`instant` needed one change to the frame loop rather than just a smaller number.
`tick` drew at most one animation frame per call, which is faithful — the original's
throttle waits out the period and then draws exactly one, so a machine that cannot
keep up stretches the move instead of dropping frames from it — but it also puts a
floor under the pace at whatever the host ticks: 50 ms headless, one display refresh
in a browser. `0` would have meant "a frame every rAF", which is neither instant nor
the same speed on a 60 Hz and a 120 Hz panel; `25` would have been 33 ms at 60 Hz.
So below the engine step the tick now advances by **elapsed time** and draws only the
frame it lands on. At or above the step nothing changed, frames are still never
skipped, and `instant` falls out of it: the whole ring is spent on one tick, the
settle runs inside that same tick, and the only picture that reaches the screen is
the standpoint arrived at.

### The Low memory box

The one setting on the page that the **game** decides rather than the port.
`BOOTFILE` defines its own `lowmemory()` — shadowing the engine builtin of that
name — as `heapsize() < 6144000`, and five script sites branch on it: half the
themes are swapped for their shorter `.11k` twins and mission 4's boat deck loses
its crowd. So the whole port-side implementation is one number, `heapsize()`
answering 4 MB instead of 64 when `GameSession.lowMemory` is set. It is re-read per
`openset`, so a change lands in the next room; remembered under
`taoot.sound.lowmemory`.

**[The low-memory game](../../taoot/low-memory.md)** is the whole account — the five sites,
what `.11K` actually is (not 11 kHz), why the two engine params it also zeroes are
invisible here, and where it is worth listening.

### The sound keys, and why the page has no sound control

`wavevolume` 0..9. Two things move it and they go through one setter
(`GameSession.setWaveVolume`), because `TI.EXE` funnels it the same way: `0x4249b0`
has twenty-one callers, `wavevolume(n)`'s own site plus the ten digit arms in each of
its two key filters.

- **0–9 while a character is speaking or a clip is playing**, which is where those
  filters live — see [skipping and repeating](characters.md#skipping-and-repeating)
  for why they are bound bare rather than as the original's Ctrl chords. They work
  over the logos and the menu too, which are movies played by the intro rather than
  by a viewer.
- **The game's own dial**, opened from the lifebuoy in the interface band. `CTL.STG`
  c2 seeds it from the live value (`propdeg("volume", wavevolume())`) and
  `HOUSE.SHP` c3's mousedown is a `while stilldown()` drag loop writing
  `wavevolume(propdeg(me))` on every frame, closing with a `voicesound("volume")`
  click.

**The play page deliberately adds nothing here**, and that is the opposite of the
brightness decision above. The difference is whether the game already answers the
question: brightness has *no* in-game control at all — the F-keys are the whole of
it, and a phone cannot press them, so the page had to supply presets. Volume has a
dial, and it is a **drag**, which a finger does as well as a mouse. A slider on the
page would have been a second control for a value the game already owns, drifting
from the dial the moment a savegame or a script moved it.

What that leaves uncovered is real and is the original's own gap: with a clip or a
conversation on screen the band is not reachable, so a player without a keyboard
cannot change the volume until it ends. `TI.EXE` leaves a mouse-only player in
exactly that position.

**Four caches hold post-gamma bytes**, and a live change has to reach all of them or
the picture changes in one place and not the others: the set/prop palettes, the stage
flat memo, the puppet's composited stance, and each movie segment's baked palette.
They all watch one integer — `screenGammaGeneration()` — rather than subscribing,
because viewers and puppet views come and go and a listener list would have to be
unsubscribed correctly at every teardown. The viewer rebuilds on the next `tick`, and
replacing the palette arrays is also what makes it visible: `buildSignature` refs
both by identity, so a new array *is* a repaint.

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
end of a movie therefore only *arms* a reveal; the black is lifted once **no
script dispatch is in flight** — the script that played the movie almost always
has more to say about the screen — and any `blackscreen` / `clut` /
`screentoblack` / `blacktoscreen` it runs cancels the pending reveal instead. A
flat whose intro movie is followed by no fade at all (the bomb's `openstage`)
still gets its reveal, as soon as the script falls quiet. That same armed flag is
what `screenOwner` reads to answer **held** above, and the two readings are one
fact: until the script says what the screen should look like, the screen is still
the movie's.

A **stage swap** arms the same flag rather than clearing the level, whenever the
black it finds is one a script blanked on (`fade.blanked` — `blackscreen` or
`clut("black")`, as against a `screentoblack` ramp, which it still lifts because
the palette that ramp was against is the one being replaced). See
[the stage layer](./stage-ui#what-a-swap-does-to-the-black).

**The fades BLOCK, and that is not a detail.** `screentoblack` and
`blacktoscreen` are a linear lerp between the named surface's palette and the
black one, and the loop that runs it (`0x435b90` / `0x435be0`) busy-waits one
60 Hz tick per step on `0x41de90` with no message pump and no scheduler pass
inside it. The interpreter is frozen for the whole ramp, so the statement after a
fade cannot run until the fade is over. Ours queued the ramp and returned, and
the game noticed: `gang.cst`'s `prepuppet` is `screentoblack("current", 10)`,
`openpuppetfile`, `visualeffect(plain, 0)`, `blacktoscreen("puppet", 10)`, and
only then does `runpuppet` send the puppet its boot script — which is what speaks
the first line. With the fade non-blocking the line started while the screen was
still black and rode the ramp up
([#6](https://github.com/dhobi/dreamrefactory/issues/6)). They now `await`
`Clock.sleep` for `steps` script ticks, the same primitive and the same unit
`delay(n)` uses.

**And `clut(name)` installs a palette**, right now: `0x43dfd0` resolves the name
through the table the fades share and hands it to `0x4363e0` — the very call the
last step of a `blacktoscreen` ramp makes. So `clut` is the un-ramped fade, and
`clut("black")` is the un-ramped `screentoblack`. It was a no-op here on the
reasoning that `blackscreen()` is always beside it; not always — `transtoflat`'s
`rub.stg` arm is `playmovie("rub.mov")` then `clut("black")` with no
`blackscreen` anywhere, and that black is what the stage is revealed *from* two
lines later. Where the pair does occur it is not redundant either: `blackscreen`
clears the buffer and `clut("black")` makes every subsequent draw invisible,
which is how the scripts hold a screen black across a swap that keeps repainting
underneath.

### The click priority chain

The host's part of a click is short, and everything modal comes first:

1. a **playing movie** (it owns the screen and its clicks, even over a suspended
   conversation);
2. a **visible puppet** (bevel hit-test on the answer band, and a
   [repeat](characters.md#skipping-and-repeating) on the picture above it; a hidden
   puppet lets clicks through);
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
[keys are script events](../scripting-language.md#the-chain-and-how-an-event-is-consumed),
not direct movement. **Space** is forwarded too (the boot's `keydown` opens the
door you're facing).

**A press made while a move is on screen is queued, not dropped** — one press per
key stays pending however long the key is held, which is what walks a corridor
instead of a room, and letting go leaves at most one more move to come (the
queue's own policies are TI.EXE's, recovered in `engine/input.ts`). The gate is in
`SetViewer.keyDown` and applies to **every** key, because that is where the
original keeps it: its window proc posts and its main loop pops, both above any
notion of *which* key it was, since the letter is only translated afterwards by
BOOTFILE's `keydown` reading `keynorth`/`keywest`/`keyeast` — W/A/D by default and
rebindable, so the engine cannot know which key means forward. The port had the
gate in the arrow-only path, so pressing W during a walk was thrown away while ↑
was kept: a burst of four Ws walked one room and four ↑s walked two (#207). A
playing movie and a suspended conversation stay ahead of the queue, because both
own their keys outright rather than deferring them.

**Escape** is forwarded, not acted on. `DF_KEY` maps it to the character `"."`
with the special-key marker set, which is exactly what TI.EXE's window proc
does, and the decision belongs further down: `SetViewer.keyDown` gives a
playing movie the key before anything else (the same precedence `click()`
gives it), and `MoviePlayer.key` is what knows that a marked `.` means abort —
see [escaping a movie](../formats/mov.md#escaping-a-movie). Behind the movie sits
a **suspended conversation**, which takes it for the same reason: in the original
the puppet's own wait is the loop popping the event queue, so ESC reaches the line
being spoken and not the scripts
([skipping and repeating](characters.md#skipping-and-repeating)). With neither up,
the key goes down the script chain and is ignored. This host has no "skip" verb of
its own, deliberately — both the skips it forwards are the original's.

A phone has no Escape, so **two taps in the same place within 320 ms** are
forwarded as one — `keyDown(".", true)`, the identical route the key takes, so a
live movie aborts, a spoken line is skipped, and anything else ignores it exactly
as the original does. That gesture is also what makes a conversation playable on a
phone at all, now that a click no longer skips a line. Only
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
([`swipeKey`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/keys.ts), pure, so
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

**Where the pane lives.** In the page, as the last column of the row that holds
the screen — beside it when the window is at least 1480 px wide (1740 px on the
speedrun page, which has the run sheet as a column of its own between them), and
stacked under everything below that. Nothing moves the element and nothing is
padded around it: the row wraps, so a window that is over the break but short of
holding every column drops the pane to its own line rather than squeezing what is
beside it.

It used to be a `position: fixed` rail at the right edge with the body padded by
the rail's width. #249 is what that cost: the speedrun page padded its own layout
for the rail as well, so at 1920 with the pane open the page gave away ~960 px to
a 480 px pane and the run sheet was left a few pixels wide.

**What the state list is.** Every script global, rendered from `snapshotState` —
the same function the playthrough goldens are recorded with, so what a reporter
reads and what a golden compares are the same numbers. It is off until asked for
on the play page (the `state` box, or `?debug=1` in the URL) — and on from the
first paint on the speedrun workbench, whose `<meta name="details-always">` says
the pane is part of the page rather than something to summon: X cannot shut it
there, and the `state` box starts checked. A route is read off the log and tuned
against the state list, so a column that has to be called up every time is a
column in the way of the thing it belongs to. It answers **what just moved**
rather than the whole table: 93 globals at boot and 102 by the credits — 143
distinct names over the whole route, of which 108 ever move — but the median number
that changes between two story beats is 5 and the most ever is 30.
`all` gives the table, a filter searches it, and the six the
game's own HELP button answers with (`Mission`, `Phase`, `Letter`, `Necklace`, and
`Maze`/`Level` in the smokestack) stay on top of both — **pinned** out of the
list's scroll, along with the filter box, so watching the props and the main
states at once is possible at all ([#178](https://github.com/dhobi/dreamrefactory/issues/178)).

A filter takes **more than one term**, `|` or `,` apart: `hrs|min|sec` is the
timer, and a timer is only worth watching whole ([#126](https://github.com/dhobi/dreamrefactory/issues/126),
[#127](https://github.com/dhobi/dreamrefactory/issues/127)) — any-of, since a name
cannot contain two of them. It matches a row's **type** as well as its name,
because a prop's row reads `prop bag`: `prop` now answers with the props, where
it used to answer with `saveprops`, `saveprops1` and `saveprops2` — the three
globals that *encode* them. A space is not a separator, so `prop bag` still means
that one prop. Under a filter the owned props and actors join the list without
`all`, for the same reason the unmoved globals do: the reader has named what they
want.

The clock is excluded from "what just moved" by
[`engine/masks.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/masks.ts) —
the same predicate the trace comparisons drop, moved out of `tests/` when the panel
turned out to need the same answer. Without it the list was permanently `sec` and
`clockcount` and nothing else.

The list **patches** its rows rather than rebuilding them, because it polls (there
is no "a global changed" event to listen for) and a rebuilt list threw away every
row it had, four times a second, for a screen that had not changed. Measured with a
MutationObserver: a room standing still costs **0 mutations** over 16 refresh
ticks, one moved global costs 2 (its number and its highlight), and the only writes
left under `all` are the pocketwatch's own.

The lines themselves live in a bounded buffer
([`log-buffer.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/src/log-buffer.ts)),
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
floor)`, [recovered from the demo build](../formats/mov.md#a-movie-carries-its-own-pacing)
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
[documentation home](../../README.md).
