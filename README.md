<!-- decorative: the heading below names the project, so alt text here would only
     make a screen reader say it twice (same reasoning as index.html's hero) -->
<p align="center">
  <img src="public/globe.png" alt="" width="220" />
</p>

# Titanic: Adventure Out of Time (RE)

Browser port of the CyberFlix **DreamFactory 4.0** engine, targeting *Titanic:
Adventure Out of Time* (1996) — no DOSBox, a native TypeScript reimplementation
running on canvas.

> 📖 **New here? Read the docs: <https://dhobi.github.io/taoot-web/>** — a
> guided tour from "how the game works" down to each DFile container format,
> written for readers who haven't done low-level reverse engineering. (Source
> in [`docs/`](docs/README.md); there's a [glossary](docs/glossary.md) if a
> word turns up before its page does.)

## Running

```
npm install
npm run dev          # then open http://localhost:5173/ and press Play
```

The sections that follow are the site's own top bar — Play, Editors, Collection,
Docs, Source — and then what a contributor needs behind it: the suites, the game
data, the tree.

## Play

The front page (`index.html`) says what this is and has one control on it, a
**Play** button; the game lives at **`/play/`** (`play/index.html`), which boots
as soon as it is opened. Two pages rather than one because the welcome text used
to be hidden the instant the boot had something to draw — it was on screen for
exactly as long as the files took to load.

If your `gamefiles/` holds more than one language, the first thing `/play/` shows is the
**language chooser** — which is itself a DreamFactory stage this repository
authored (`public/lang.stg`, built by `npm run mklang`): real flats, real click
regions, real compiled scripts, opened by the engine's own `openstagefile`. See
[Languages & the chooser](docs/runtime/languages.md). `?lang=de` skips it,
and the 🌐 picker in the page's top bar switches afterwards.

Once a language is settled the play page runs the cold boot itself — the shipped
`boot()`, logos into the main menu — rather than offering a screen of entry
points first. There is no dev harness on the page any more; the ways in it used
to offer are where you would look for them anyway, saves through the in-game
menu and any room through the editors.

In front of the **English** boot only, if the file is there, there is one more
screen: `public/nightdive.mov`, an intro film that ends by asking *do you own the
game?* — Yes boots, No leaves for the game's GOG page. It is a **MOV**, not a
piece of HTML over the canvas: `npm run mknightdive -- some.gif` turns an
animated GIF into a DreamFactory movie (`tools/mknightdive.ts`, on top of the
write half of the format in `src/df/mov-build.ts`), and appends the question as a
second segment whose two answers are the movie's own click regions and action
frames — so the answer comes back through `actionframe()` like any other movie's
does ([src/nightdive.ts](src/nightdive.ts)). English only because the question is
drawn *into* the frames and there is no catalogue behind a picture; the other
editions and the demo boot untouched. Escape presses past the film; the question
after it carries no skip flag and has to be answered. `assets/nightdive.gif` is
NightDive's own heading animation and is the tracked **source**; the MOV is
**generated** — a Vite plugin compiles it into `public/nightdive.mov` on the first
dev server or build, so a fresh clone has the intro without anyone running the
generator by hand, and the deploy ships it like `lang.stg`. Delete the GIF and the
build is still valid: no film served, no intro, and the boot is what it was.

Which files exist is one manifest, `gamefiles.json`: a map of served path to
byte size, walked live by the dev server ([vite.config.ts](vite.config.ts)),
written into `dist/` by a build, and regenerable against an uploaded tree with
`npm run manifest`. It is a file rather than an endpoint, which is the whole
reason the site can be hosted as static files — no game data is bundled either
way, so a deployment serves whatever tree is laid down beside it, or none.
Nor does a build name a host root: every URL is relative to the page that asks
for it, so `dist/` runs from a subdirectory (`example.com/taoot/`) as readily as
from a domain root. Vite rewrites what it emits; the URLs built in TypeScript
resolve against the `<meta name="site-root">` each page carries
([src/site.ts](src/site.ts)).
Loading a set pulls its siblings (`.shp`, `.trk`, `.sfx`, `.11k`, `unilib.trk`)
over HTTP, and anything scripts ask for later
(`openshopfile("blkjack.shp")`) is fetched on demand in the background.

Controls: `←`/`→` turn, `↑` walk a road, `Space` open the door you're facing,
`Esc` skip the movie playing, `M` deck-plan map, `O` hotspot overlay, `X` the
scene readout and script log.

## Editors

Seven **asset editors** live under `/editors/` (which is itself a page listing
them) — part of the built site, not a dev-only affair. Each loads a file by
upload or straight out of the manifest, and exports the repacked original
([docs section](docs/editors/README.md)):

- **`/editors/puppets.html`** (`editors/puppet-editor.ts`) — a `.PUP` conversation puppet:
  stance art via PNG export/import, frame anchor offsets, subtitle text, with
  voice + animLogic playback.
  ([reference](docs/editors/puppets.md))
- **`/editors/tracks.html`** (`editors/track-editor.ts`) — a `.TRK`/`.SFX`/`.11K` audio
  bank: play the theme and every one-shot, rename the bank and its chunks,
  reorder the chunks the theme loops through, and drop your own audio in
  (WAV/MP3/OGG, resampled and re-encoded).
  ([reference](docs/editors/tracks.md))
- **`/editors/sets.html`** (`editors/set-editor.ts`) — a `.SET` room: browse the scenes,
  views, turn rings, roads, actor marks, maps and scripts, play a turn or a
  walk, edit names/hotspot rectangles/actor placement, and replace view art via
  PNG round-trip. ([reference](docs/editors/sets.md))
- **`/editors/shops.html`** (`editors/shp-editor.ts`) — a `.SHP` shop, i.e. the props drawn
  on top of a room: every prop's states and frames, where a frame lands on the
  screen for a given `propxy` anchor, animation playback, editable prop/state
  names, stored offsets and `propdeg` degrees, art via PNG round-trip.
  ([reference](docs/editors/shops.md))
- **`/editors/stages.html`** (`editors/stg-editor.ts`) — a `.STG` stage: the UI band, the
  inventory, the deck plan, a mini-game board — each flat's full-screen art with
  its clickable regions drawn over it, editable flat/region names and region
  rectangles, art via PNG round-trip.
  ([reference](docs/editors/stages.md))
- **`/editors/casts.html`** (`editors/cst-editor.ts`) — a `.CST` cast, the other half of a
  character: every member's poses as a step × direction grid, a walk cycle played
  at the engine's tick, the depth scale that keeps feet on the floor, editable
  member/pose names and sprite anchors, art via PNG round-trip.
  ([reference](docs/editors/casts.md))
- **`/editors/movies.html`** (`editors/mov-editor.ts`) — a `.MOV` read as what it is, a
  **state machine of frames**: scrub the chain, follow the machine, click the
  regions and see where they go, edit the action codes, targets, region
  rectangles, action-frame slots and the ESC flag. Frame art is read-only, and
  the page says why. ([reference](docs/editors/movies.md))

The stage editor's file list also holds one file CyberFlix never shipped:
**`lang.stg`**, the language chooser this repository *wrote* (`npm run mklang`) —
palette, flats, click regions and compiled scripts. Read → edit → export, on a
file whose every byte we chose ([writing a stage](docs/formats/stg.md#writing-a-stage)).

## Collection

**`/collection/`** is about the physical release rather than the game itself:
box and CD artwork for the five pressings that have any (English, German,
French, Dutch, Japanese — the Russian release has an offline archive below
but no box or disc scans), and, underneath that, the steps for running the
original 1996 DOS release under DBGL for anyone who wants the game exactly as
it shipped rather than this reimplementation of it. The artwork is carried
over unchanged from the old site at danielhobi.ch/taoot. The DBGL archives
themselves are not in this repository — they run to roughly 1 GB apiece and
stay linked at that site — which is the same rule this repo already applies
to `gamefiles/`: no game data is shipped here, and `gamefiles/` is gitignored.

## Docs

The prose that explains the *engine* rather than this repository is a site of
its own — <https://dhobi.github.io/taoot-web/>, built from [`docs/`](docs/README.md)
with VitePress (`npm run docs:dev` to read it locally):

- [How the game works](docs/01-how-the-game-works.md) — the guided tour, from the
  outside in, for a reader who has never opened a DFile
- [Formats](docs/formats/README.md) — each container, block by block
- [Runtime](docs/runtime/README.md) — the recovered engine behaviour: timing, the
  stage layer, characters, audio, saves
- [Editors](docs/editors/README.md) — what the seven pages show, and why
- [Reference](docs/reference/README.md) — the tools, the test inventory, the
  playthrough route, the recovered builtins
- [Verification](docs/verification.md) — what the playthrough is *for*, with the
  bugs it caught that nothing else would
- [Glossary](docs/glossary.md) — for a word that turns up before its page does

## Source

<https://github.com/dhobi/taoot-web> — the last thing the top bar points at, and
where you already are if you are reading this on GitHub.

```
git clone https://github.com/dhobi/taoot-web
```

Bugs and findings belong in the issue tracker, and both pages hand you a link to
it: the front page in its opening paragraph, the play page through the 🪲 button
beside the game, which fills the issue in first — the page, the edition, the room
and the last scripts to run, with a screenshot on your clipboard to paste in
(`src/bug-report.ts`).

Everything after this section is about the repository rather than the site.

## Tests

```
npm test                 # the fast gate: scenarios, savegames, recovered builtins,
                         # the editors' write path, text/audio encodings
npm run test:watch       # vitest in watch mode
npm run test:playthrough # the game played, not probed (headless, virtual clock)
npm run test:browser     # Playwright against a live dev server (needs npm run dev)
npm run test:browser:lang # pick a language in a real browser (needs 2+ language trees)
```

Three categories, because they have different budgets. The **gate** jumps to a
state and probes it, and runs on every commit. A **playthrough** plays the game
from the boot — the menu, the objects, the rooms, the conversations — and
asserts a recorded state trace; it runs to the ending in 27 segments, carried as
one continuous session, and covers minutes of game time per segment.
The **browser** suites replay the same routes through real mouse and keyboard
events against the same golden traces, and cost what the game costs in real
time.

The suite is headless and file-based (Node environment, no DOM), and reads the
game data straight out of `gamefiles/` (see [Game data](#game-data)).

The playthrough asserts a recorded state trace (every script global, the room,
prop ownership) at each story beat, so a route is written as inputs and a
divergence names the beat that caused it. Routes name destinations rather than
coordinates — `goto("gym")` works out the nine rooms and the gestures itself
(see [tests/playthrough/nav/](tests/playthrough/nav/)). Re-record with
`TAOOT_RECORD=1 npm run test:playthrough`; the suite inventory and the commands
are in [docs/reference/tests.md](docs/reference/tests.md), and what the
playthrough is *for* — with the bugs it has caught that nothing else would — is
in [docs/verification.md](docs/verification.md). The route itself — what its
twenty-seven segments cross, how much of it to run while you work, and the
conventions a new one will trip on — is in
[docs/reference/route.md](docs/reference/route.md).

`tests/` is split by category: `auto/` is the gate, `playthrough/` plays the
game, `browser/` drives a real page. The corpus/inspection scripts live under
`tools/` and run directly with `tsx`:

```
npx tsx tools/navdump.ts gamefiles/en/titanic1/data/bedsit1.set out/   # navigation dump
npx tsx tools/parse.ts                                            # script AST coverage
# tests/browser/menu-movie.ts and tests/browser/playthrough.ts need a live dev server
# (the latter replays the playthrough route against the same golden trace)
```

CLI verification tool (dump structure + frames as PNG):

```
npm run dump -- gamefiles/en/titanic2/DATA/b59.set out/
```

### The speedrun

`tests/speedrun/` is not a test and gates nothing. It plays the game against
the clock, and it is driven by a **sheet** — one action per line, in text, so a
route is tuned by editing data rather than TypeScript:

```
npm run dev
npm run speedrun                 # run it, print the splits
npm run speedrun:watch           # the same run in a real window, not slowed down
npm run speedrun:lint            # parse the sheet and say nothing else
npm run speedrun -- --verbs      # every verb a sheet may use
```

The route lives in [`tests/speedrun/run.sheet.txt`](tests/speedrun/run.sheet.txt):

```
skipMovie(until: awaiting)      # hammer ESC, but never at a movie that is ASKING
closeUp(memory, by: esc)        # click it; the points are banked before the film
left(x3)                       # View14 -> View18 -> View13 -> View17
talk(purser[1,3,5])            # open a conversation and answer it by bevel id
mapJump(gstair3, deck: b)       # the deck plan, as literal clicks
wait(global.phase == 1, budget: 60000)
split(flat scored)             # a stopwatch split; does nothing to the game
```

Every action is a call. Positional arguments first, then named ones; `xN` inside
the brackets repeats it; `#` comments to the end of the line and `;` separates
actions on one line. A value that needs a comma of its own is quoted
(`wait(js == "a, b")`).

Two things separate it from `tests/browser/playthrough.ts`, which stays exactly
as it is and remains the diff target for the headless oracle. First, the waits:
the browser suite pays a flat grace before every settle and then waits for full
quiescence, because a gesture landing a frame early is a divergence it would
have to explain. A speedrun compares nothing, so each action waits on the
minimum precondition instead (`wait=none|taken|ready|quiet`), and clicks are
buffered against the engine's own event queue rather than serialised.

Second, and the reason it is careful rather than merely fast: **keys are not
buffered across a fade.** `SetViewer.keyDown` queues on `movingCamera` but
refuses on `inputLocked`, and the two differ by exactly `session.fading` — a
press in that gap is silently discarded (the long note on `pressNav` in
`src/viewer.ts`). Pressing earlier than anything else ever has means meeting
that gap constantly, so every key is gated, and `left`/`right`/`up` confirm the
standpoint actually changed and press again if it did not.

The run is **human-legal**: every gesture is a real Playwright mouse or keyboard
event at the canvas, nothing writes to the engine, `framerate()` is untouched and
no fade is collapsed. The one concession is the seed, so that the smokestack
draws the same maze each time and two runs are comparable; `--noseed` opts out
and the report says which it was.

The report gives wall clock *and* `session.frameCounter`. Tune against frames —
they are immune to machine load — and quote the seconds.

**The workbench.** `/speedrun/` is an unlisted page — nothing links to it, it is
not in the top bar, it carries `noindex` — that puts an editor under the game:
write a sheet, press Play, watch it play, read which line broke. It is the play
page duplicated rather than the play page reused, because the two are meant to
diverge; the workbench has no need of the memory or picture options, and it skips
the Nightdive film (`<meta name="skip-intro">`) because it is reloaded to get a
clean game far more often than it is opened to play one.

It shares the parser, the action table and the run loop with the CLI
(`src/speedrun/`), so a sheet cannot mean one thing there and another here. What
differs is only delivery: the CLI drives real OS-level input over Playwright,
while the page synthesizes `PointerEvent`/`KeyboardEvent` against the canvas.
`main.ts` never asks `isTrusted`, so the engine cannot tell — but the synthetic
path skips the browser's real input pipeline, so **the page is a previewer and
the CLI is the clock of record**. Measured over the boot and the London flat the
two agree to within 1% on engine frames (216 against 218) and about 6% on wall
clock, which is the useful way round: same game, slightly different stopwatch.

`pause()` is a breakpoint: the run stops and the pointer lands on the line
*after* it, because a breakpoint you cannot get past is a deadlock rather than a
tool. The CLI has nobody to press Resume, so it steps over one with a note —
which is what makes it safe to leave breakpoints in a sheet while a leg is being
worked on and still time the whole thing under `npm run speedrun`.

The workbench booted with the **music off** for a while (`<meta
name="mute-theme">`, applied as the cold boot's theme mix) on the grounds that the
same twenty seconds of a room play a hundred times over while a route is tuned.
It plays the music now: a run is read by its sound as much as by its picture, and
the theme is part of knowing where you are. The tag still works if you want it
back — one line in `speedrun/index.html`'s head.

**Record mode** is the other half of writing one. Arm it and every key and click
you make at the game is written into the sheet at the caret, one action per line:
`left()`, `space()`, `key(e)`, and a click as `click(memory)` when the engine's
own hit test can name what was under it or `clickAt(x, y)` when it cannot — the
same division the hand-written sheet makes, because a movie region has no name to
aim at. It watches and never intercepts: capture-phase listeners, no
`preventDefault`, so the game plays exactly as it would with record off. A run's
own gestures are filtered out by `isTrusted`, the one bit script cannot forge, so
pressing Play while armed does not fill the sheet with a copy of itself; and
typing in the editor is filtered by the engine's own `focusOwnsKey`, so writing a
sheet is not recorded as playing one.

Where the next action lands is held by the page rather than read off the caret,
and that is not a refinement — recording means clicking on the game, clicking on
the game blurs the textarea, and a blurred textarea has no caret. The offset is
advanced by exactly what was inserted and re-adopted from the caret whenever the
editor is actually touched, so "put the cursor there and record into it" still
works. A red band marks it, for the same reason: the thing it replaces is
invisible for the whole of a recording session.

**The sheet is a program, and the pointer is where it is.** Sheets are the
user's — several of them, named, kept in localStorage, autosaved — because a
route gets tried three ways and a leg gets pulled out to be worked on alone, and
with one box those are the same box. The **execution pointer** says where Play
would start; Pause leaves it, Stop and reaching the end put it back to the top,
and a failure leaves it on the line that broke so a fix can be retried from
itself. It is a LINE and not an index into a parse, so it survives the editing
that goes on between runs.

**Checkpoints.** A run sheet is tuned a leg at a time, and nobody debugging the
walk to the gym wants to replay the London flat and four minutes of crossing
first. `save(m1p1)` writes a checkpoint — the engine's own `.ti`, through
`snapshotSave`/`loadSavedGame`, not a parallel mechanism — and the workbench puts
a chip on the row above the editor for every checkpoint that exists: click the
name to restore that game AND move the pointer to the line after its `save()`,
the ✕ to forget it. The list comes off storage rather than off the sheet, so a
`save()` that has just run shows up without a reload and a point made from a
scratch sheet is not hidden.

`reset()` is the same idea for the earliest state there is — the beginning,
which needs no `save()` to exist. It is a reload, because only a reload is
honestly a cold boot (re-running `coldBoot` over a played game would leave that
game's globals, cast, open shops and scheduler tables underneath), and it is
idempotent: on a page that has just loaded it does nothing, so it costs a
replayable sheet nothing to open with it. The workbench shows it as a chip
beside the checkpoints and the CLI simply reloads the page mid-run.

That pairing is why a checkpoint is the only jump the page allows. The game's
state and the pointer are one fact: a pointer you could drop anywhere would let
you run a sheet from a place the game was never brought to, and the run that
followed would be nonsense that takes an expert to recognise.

`save()` settles before it snapshots, and that is the verb's correctness rather
than a nicety — `snapshotSave` reads the live engine at the instant it is called,
so a save taken one action after a click whose script is still running records a
game that had taken the bag but not yet been given it. Measured, saving at the
same point with and without the settle and reloading each: `held=[trunkkey,bag,map]`
either way carried, `held=[map]` loaded without it.

Times measured from a checkpoint are not run times, and the reason is in the
file format: a `.ti`'s variable table is fixed-size so globals that do not fit
are dropped, `actorvalue` has no record at all, and the room is rebuilt by
re-running its own `openset`/`openscene` at the restored progress. Faithful —
the original reloads the same way — but a game reached by loading is not the game
a player would be standing in. Route with it, time with the full sheet. Measured:
reloading at `m1p0` comes back in c73's Scene49/View52, the set's rebuilt
opening, rather than the Scene51/View63 the save was taken in; and the watch
comes back owned by nobody.

The pathfinding verbs (`travel`, `hunt`, `stand`) exist only in the CLI — they
run the real `Navigator`, which parses `.SET` files off disk. The page says so
rather than pretending. That is no great loss: all three are escape hatches that
print the literal gestures they used precisely so a sheet can stop needing them.

## Releases

The version is `version` in `package.json` — **0.9.17**, semver, shown in the top
bar of every page and carried into a bug report. Tagging is what publishes, and
`master` is protected (the two `tests.yml` jobs are required checks, admins
included), so the bump goes through a pull request like anything else:

```
git switch -c release/0.9.17
npm version 0.9.17 --no-git-tag-version   # package.json + the lockfile
git commit -am "Version 0.9.17" && git push -u origin release/0.9.17
gh pr create --fill && gh pr merge --rebase --delete-branch   # once checks are green

git switch master && git pull
git tag v0.9.17 && git push --tags
```

The tag must sit on a commit whose `package.json` already says that version —
`deploy.yml` compares the two and fails the deploy rather than announce a version
nobody tagged.

`.github/workflows/deploy.yml` builds that commit and uploads `dist/` to
www.danielhobi.ch/taoot over FTP. It only ever adds and overwrites — the CD rip,
the DBGL archives and `gamefiles.json` on the host are never written over and
never deleted. [Releasing and deploying](docs/reference/deploy.md)
says why, and how to regenerate the manifest when the game data on the host
changes.

## Game data

Not distributable — supply it from your own copy, laid out one directory per
CD, per language:

```
gamefiles/en/titanic1/{data,movies,puppets2,trunk,wireless,blkjack,…}
gamefiles/en/titanic2/{DATA,MOVIES,PUPPETS1,TRUNK,WIRELESS,BLKJACK,…}
gamefiles/en/save/{1,2,ENDGAME1,ENDGAME2}
gamefiles/de/…  gamefiles/fr/…  gamefiles/ru/…  gamefiles/nl/…  gamefiles/ja/…
```

**Case is not part of the layout.** The two CDs use no single convention between
them (`titanic1/data` is lowercase, `titanic2/DATA` mostly is not) and a rip may
have re-cased either, so every lookup normalises — name your directories however
your copy came off the disc.

The two-letter directory is the **language**, and it is a real axis, not a label:
a localised release is its own pressing of both CDs, so `bedsit1.set` exists once
per language. Which one a bare filename means is decided once, at startup, by the
chooser — or by `?lang=`/`TAOOT_LANG` — and everything else follows from that
([Languages & the chooser](docs/runtime/languages.md)). A tree with no language
directory at all still works: it is treated as the only one there is.

Two things besides the filenames come with the tree, because no file declares
them: the **character set** its text is stored in (Mac OS Roman for en/de/fr/nl,
Windows-1251 for ru, Shift-JIS for ja — measured, since `TI.EXE` just used
whatever code page Windows was running) and, per bank, **which chunks are at
which sample rate**, which differs per language and has to be resampled at the
join.

Those are the volumes BOOTFILE's `setpath(disk)` installs into the engine's
9-slot resource search path — `titanic1:data:`, `titanic1:puppets2:`,
`titanic2:puppets1:` and a per-room folder in slot 7 (`path(7, mainpath @
"trunk:")`). The `puppets2`-on-disc-1 / `PUPPETS1`-on-disc-2 crossover is
genuinely how the discs ship. `TAOOT_GAMEFILES` overrides the root and
`TAOOT_LANG` picks the language directory (defaulting to `en` when that
directory exists, so a route can never silently mix two languages' data).

Two properties of the real data that the lookup has to handle, and does
identically on both sides — `FileStore` in [`src/files.ts`](src/files.ts) for the
browser, [`tools/gamefiles.ts`](tools/gamefiles.ts) for the tools and tests:

- **No single filename case.** `TITANIC1/data` is all lowercase; `Titanic2/DATA`
  is mostly uppercase but also holds `b59.set`, `bridge.set`, `a14.Set`. Scripts
  ask for whatever the author typed (`openshopfile("blkjack.shp")`), so every
  lookup normalises to a lowercase basename.
- **93 basenames ship on both discs.** These aren't duplicates: the public rooms
  appear once per act, so `gstair2.set` on TITANIC1 and `GSTAIR2.SET` on Titanic2
  are the grand staircase before and after the sinking. The active disc follows
  `setpath(disk)` through the `onDiscChange` host hook, with the other disc as a
  fallback for the rooms that exist on only one.

A CD rip also carries trees that are not game data and are skipped outright:
`install/` (the Windows installer plus bundled DirectX/vendor drivers),
`support/`, `shots/` (press-kit JPEGs), and `sneak/` — a separate sneak-preview
demo which ships its **own** `bootfile` that would otherwise boot instead of the
game.

## Layout

- `src/df/` — DreamFactory file format library (TypeScript port of the
  decoding logic in [DFET](https://github.com/M3tox/DFET), GPL-3.0):
  - `container.ts` — the common container/block structure of all DF files
  - `image.ts` — frame decompression (delta-encoded RLE) + Z-depth layer, palette
  - `set.ts` — SET structures: scenes, views, turn rings, roads, actors, hotspots
  - `*-build.ts` — the write path: a builder per format over the shared
    `build.ts` scaffolding, so a DF file can be produced and not only patched
    (`public/lang.stg` is one; the editors' test fixtures are the rest)
- `src/engine/` — the runtime: script interpreter, builtins, scheduler,
  props/actors/puppets, stage layer, save/load
- `src/viewer.ts` — navigation state machine + rendering
- `editors/` — the asset editors: one HTML page and one module each, plus the
  `editor.css` they share and an `index.html` that lists them. They are
  separate Vite entry points and import `src/df/` and `src/screen.ts` only —
  never the engine, which is why they build as pages that happen to share a
  file-format library
- `tools/` — Node-side dump/verification tools, plus the `TI.EXE` mining
  tools (`exetable`, `disasmcmd`, `scancmds`), the mission flow-map
  generator (`flowmap`) and `mklangstg` — which writes a DreamFactory stage
  instead of reading one — see the [tool reference](docs/reference/tools.md)
- `index.html` — the front page: what this is, and a Play button
- `play/` — the game page itself, the only one that runs `src/main.ts`
- `public/` — everything served at the root because none of it comes from the
  game: `lang.stg` (the language chooser this port authored), the globe logo,
  and `collection/` — the box, disc and booklet scans the collection page turns
- `gamefiles/` — original game data (not distributable; user-supplied)
- `dfet/` — reference C++ extraction tool (GPL-3.0, by M3tox), gitignored like
  `gamefiles/`: clone it there yourself when you want the original beside the port

## Credits

**[DFET](https://github.com/M3tox/DFET) by M3tox** is why this port exists. The
container formats were already legible when this repository started, because that
tool had worked them out first; `src/df/` is a TypeScript port of its decoding
logic, and the GPL-3.0 below is inherited from it.

The reimplementation itself — the engine, the editors, the test harness and the
docs — was built with the support of **Claude Opus** and **Claude Fable**.

## Licensing

The decoder is a port of GPL-3.0 code (DFET), so this project is GPL-3.0.
Game assets remain copyright CyberFlix Incorporated and must be supplied by
the user from their own copy.
