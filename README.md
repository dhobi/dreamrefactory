<img src="docs/globe-mark.svg" alt="" width="120" align="right">

# dreamREfactory

[![engine coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fdhobi%2Fdreamrefactory%2Fbadges%2Fcoverage-engine.json)](https://www.danielhobi.ch/dreamrefactory/docs/reference/ci.html#coverage)
[![Titanic coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fdhobi%2Fdreamrefactory%2Fbadges%2Fcoverage-taoot.json)](https://www.danielhobi.ch/dreamrefactory/docs/reference/ci.html#coverage)
[![Dust coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fdhobi%2Fdreamrefactory%2Fbadges%2Fcoverage-dust.json)](https://www.danielhobi.ch/dreamrefactory/docs/reference/ci.html#coverage)
[![Timelapse coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fdhobi%2Fdreamrefactory%2Fbadges%2Fcoverage-timelapse.json)](https://www.danielhobi.ch/dreamrefactory/docs/reference/ci.html#coverage)
[![RedJack coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fdhobi%2Fdreamrefactory%2Fbadges%2Fcoverage-redjack.json)](https://www.danielhobi.ch/dreamrefactory/docs/reference/ci.html#coverage)
[![Skull Cracker coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fdhobi%2Fdreamrefactory%2Fbadges%2Fcoverage-skullcracker.json)](https://www.danielhobi.ch/dreamrefactory/docs/reference/ci.html#coverage)
[![Lunicus coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fdhobi%2Fdreamrefactory%2Fbadges%2Fcoverage-lunicus.json)](https://www.danielhobi.ch/dreamrefactory/docs/reference/ci.html#coverage)
[![Jump Raven coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fdhobi%2Fdreamrefactory%2Fbadges%2Fcoverage-jumpraven.json)](https://www.danielhobi.ch/dreamrefactory/docs/reference/ci.html#coverage)

[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=dhobi_dreamrefactory&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=dhobi_dreamrefactory)
[![Reliability](https://sonarcloud.io/api/project_badges/measure?project=dhobi_dreamrefactory&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=dhobi_dreamrefactory)
[![Security](https://sonarcloud.io/api/project_badges/measure?project=dhobi_dreamrefactory&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=dhobi_dreamrefactory)
[![Maintainability](https://sonarcloud.io/api/project_badges/measure?project=dhobi_dreamrefactory&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=dhobi_dreamrefactory)
[![Duplicated lines](https://sonarcloud.io/api/project_badges/measure?project=dhobi_dreamrefactory&metric=duplicated_lines_density)](https://sonarcloud.io/summary/new_code?id=dhobi_dreamrefactory)

CyberFlix built a game engine. Bill Appleton's **DreamFactory** was a CD-ROM
authoring system, and it carried *Lunicus*, *Jump Raven* and the studio's
adventures, and was licensed to studios outside CyberFlix besides.
**dreamREfactory is that engine written again in TypeScript, from the files rather
than from the source** — every container format decoded, the script language
parsed and interpreted, and the games played in a browser with nothing installed.
No DOSBox, no emulator.

Its games here are of two kinds. The adventures the interpreter runs:

| | | |
|---|---|---|
| **[Titanic: Adventure Out of Time](taoot/)** | 1996 | DreamFactory 4 — six languages, the 1996 demo, a timed endgame |
| **[Dust: A Tale of the Wired West](dust/)** | 1995 | DreamFactory 1 — one disc, and the engine two years earlier |
| **[Timelapse: Ancient Civilizations](timelapse/)** | 1996 | DreamFactory 4 on four discs, and **no `.SET` anywhere** — its rooms are stage flats, and it navigates by the shape of the cursor |
| **[RedJack: Revenge of the Brethren](redjack/)** | 1998 | DreamFactory 5, CyberFlix's last game, and the first with a real camera: rooms are points you look round from in every direction, joined by films |

…and the games with no interpreter to run, because they have nothing to interpret:

| | | |
|---|---|---|
| **[Skull Cracker](skullcracker/)** | 1996 | DreamFactory 4 with **no BOOTFILE and no script**: a beat-'em-up whose logic is compiled into the executable rather than authored in the data. It **plays** — films, menu, chooser, sixteen levels, the weapons, the bosses, the board and the credits — with the levels, the moves, the fights, the sounds and the mission read out of `SC.EXE` with a disassembler rather than scripted in the data |
| **[Lunicus](lunicus/)** | 1994 | CyberFlix's first game, on what this port calls **DreamFactory 0**: no scripts at all. The whole game is ported from `LUNICUS.EXE` — the moon base, the cities, the engine rooms, the hive and the queen |
| **[Jump Raven](jumpraven/)** | 1994 | CyberFlix's second game, on the same **DreamFactory 0**: a hovercraft shooter over a drowned New York, ported whole from `RAVEN.EXE` — the briefings, the Mart, six copilots, three days' flying and their bosses, to the copilot's ending. It saves, and it can play itself |

**RE is for reverse-engineered.** This is a best-effort re-implementation and not
a re-release: it needs a copy of a game's own data files, which it does not
supply, and it is not affiliated with CyberFlix, GTE Entertainment or any current
rights holder.

## Running it

```bash
npm install
npm run dev          # the front door, on http://localhost:5173/
```

Every site builds out of this one repository, each from its own root and its own
port, so they can run at once. **The two that are about the whole project come
first, then one port per game in the order it was ported** — so the next game
to be ported takes 5182 and nothing has to move:

| | | |
|---|---|---|
| `npm run dev` | 5173 | the front door and the format editors |
| `npm run docs:dev` | 5174 | the documentation |
| `npm run dev -w taoot` | 5175 | Titanic |
| `npm run dev -w dust` | 5176 | Dust |
| `npm run dev -w timelapse` | 5177 | Timelapse |
| `npm run dev -w skullcracker` | 5178 | Skull Cracker |
| `npm run dev -w redjack` | 5179 | RedJack, DreamFactory 5 |
| `npm run dev -w lunicus` | 5180 | Lunicus, DreamFactory 0 |
| `npm run dev -w jumpraven` | 5181 | Jump Raven, DreamFactory 0 |

Each package owns its own commands. `-w <package>` runs one of them — `npm run
speedrun -w taoot`, `npm run test:browser -w skullcracker` — and the root has only
the work that crosses packages (`build`, `test`, `typecheck`, the docs), which it
fans out over the workspaces rather than naming a game. A new game brings its own
scripts and the root does not change.

Add `-- --host` to reach one from another machine. A link from one site to
another **404s in dev with a page telling you which server serves it** — separate
Vite roots cannot be one origin, and the deployed tree has no such problem
(`tools/vite-siblings.ts` explains why a proxy cannot fix it).

No game is playable without its data. See **[Game data](taoot/README.md#game-data)**
for what a rip has to look like; nothing distributable is in this repository and
`gamefiles/` is gitignored forever.

## Layout

Each top-level directory is a thing rather than a kind of file.

- **`engine/`** — the DreamFactory engine, knowing about no particular game. Its
  own package, and its own suite that runs with no game data anywhere.
  - `src/df/` — the container formats and their write path, ported from the
    decoding logic in [DFET](https://github.com/M3tox/DFET)
  - `src/runtime/` — the script interpreter, scheduler, props, actors, puppets,
    stage layer, save and load
  - `src/web/` — how a session is presented in a browser: the host, the viewer,
    the screen, the save store
- **`taoot/`** — Titanic: its four pages, six editions and the demo, its own
  tools, and the suites that play it through to the end
- **`dust/`** — Dust: three pages (the game, the collection, the speedrun), its
  own disc, its own tools
- **`timelapse/`** — Timelapse: one page, four discs, and its own palette. The
  engine's screen with no room on it (`engine/src/web/screen-director.ts`) is what
  makes it possible
- **`skullcracker/`** — Skull Cracker: the game on one page (the films, the menu,
  the chooser and the levels, which the chooser hands the canvas to) with
  `walk.html` beside it as the bench a level is opened on one at a time — and
  its own disassembler under `tools/`, because this game's logic is in `SC.EXE`
  and not in the data
- **`redjack/`** — RedJack: one page on three discs. Its rooms (`.sett`) have
  their own reader and runtime in `engine/`, and its machine suites are under
  `tests/machine/`
- **`lunicus/`** — Lunicus: one page and its own palette. No scripts at all: the
  game is in `LUNICUS.EXE` and was ported from its disassembly, with the
  machine suites under `tests/machine/` playing it through to the end
- **`jumpraven/`** — Jump Raven: the same kind of package on the same engine,
  ported from `RAVEN.EXE`; its machine suites play it through, once with the
  game set up and once by `src/player.ts`, which wins it with no shortcuts and
  is what the page's `?autoplay` plays
- **`site/`** — the project's own web presence: the front door, the format
  editors, the chrome every page shares, and the UI-language axis
- **`tools/`** — tools that work on any DreamFactory rip because they take one as
  an argument. A tool that knows which game it is looking at lives in that game's
  `tools/` instead
- **`docs/`** — the long half of this project ([start here](docs/README.md))

Dependencies point one way only, and there is a test that says so
(`site/tests/layering.ts`):

    engine        ←  nothing
    site          ←  engine
    taoot         ←  engine, site
    dust          ←  engine, site
    timelapse     ←  engine, site
    skullcracker  ←  engine, site
    redjack       ←  engine, site
    lunicus       ←  engine, site
    jumpraven     ←  engine, site

Nothing shared imports a game. The palettes — Titanic's abyss-and-brass,
Dust's dusk-and-ember, Timelapse's glass-and-chrome, Skull Cracker's
gore-and-bone, RedJack's wood-and-brass, Lunicus's navy, chrome and fire, Jump Raven's
night, bronze and sunset, the
project's black-and-green — are implementations of one role contract in
`site/src/chrome.css`, which is structure and not a single colour.

## Where it goes

Published under **<https://www.danielhobi.ch/dreamrefactory/>**, one site per
package and the documentation, sharing one directory:

| | |
|---|---|
| `/dreamrefactory/` | the front door and the editors — tag `site-v*` |
| `/dreamrefactory/taoot/` | Titanic — tag `taoot-v*` |
| `/dreamrefactory/dust/` | Dust — tag `dust-v*` |
| `/dreamrefactory/timelapse/` | Timelapse — tag `timelapse-v*` |
| `/dreamrefactory/skullcracker/` | Skull Cracker — tag `skullcracker-v*` |
| `/dreamrefactory/redjack/` | RedJack — tag `redjack-v*` |
| `/dreamrefactory/lunicus/` | Lunicus — tag `lunicus-v*` |
| `/dreamrefactory/jumpraven/` | Jump Raven — tag `jumpraven-v*` |
| `/dreamrefactory/docs/` | the documentation — on any push that touches it |

Each tag is checked against its own package's version. Sharing one directory is
safe because the upload only ever adds and overwrites — see
[Releasing and deploying](docs/reference/deploy.md), and
`.github/actions/ftp-mirror`, which every deploy goes through.

## Tests

```bash
npm test                        # the automatic suite
npm run test:machine            # every game played end to end, headless
npm run test:machine -w lunicus # one game's
npm run test:browser -w taoot   # Playwright against a live dev server
```

Most of it reads the original game files, which is why the full suite runs on a
self-hosted runner, where each game's machine suites run when a change can
reach that game, and only the portable part runs on GitHub's
([Continuous integration](docs/reference/ci.md)). The inventory of what each suite
covers is in [Tests](docs/reference/tests.md).

## Credits

**[DFET](https://github.com/M3tox/DFET) by M3tox** is why this project exists:
it worked out the container formats and wrote them down. The file-reading layer here
is a port of that C++ code, and the format docs lean on M3tox's own plain-English
notes. Where a doc knows something, it tries to say where the knowledge came from.

Reverse-engineering credit: **M3tox** (DFET) and **MRXstudios**. Built with the
support of Claude Opus and Claude Fable — how a human and a machine make it
together is in [Collaboration](docs/collaboration.md).

## Licensing

The port and its documentation are **GPL-3.0**, because the decoder is a port of
DFET and DFET is GPL-3.0. The game data is **© CyberFlix** and is not included,
not distributable, and not in this repository.
