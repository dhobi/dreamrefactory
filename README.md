<img src="docs/globe-mark.svg" alt="" width="120" align="right">

# dreamREfactory

CyberFlix built a game engine. Bill Appleton's **DreamFactory** was a CD-ROM
authoring system, and it carried *Lunicus*, *Jump Raven*, *Redjack* and the
studio's adventures, and was licensed to studios outside CyberFlix besides.
**dreamREfactory is that engine written again in TypeScript, from the files rather
than from the source** — every container format decoded, the script language
parsed and interpreted, and the games played in a browser with nothing installed.
No DOSBox, no emulator.

Four of its games are here. Three are adventures the interpreter runs:

| | | |
|---|---|---|
| **[Titanic: Adventure Out of Time](taoot/)** | 1996 | DreamFactory 4 — six languages, the 1996 demo, a timed endgame |
| **[Dust: A Tale of the Wired West](dust/)** | 1995 | DreamFactory 1 — one disc, and the engine two years earlier |
| **[Timelapse: Ancient Civilizations](timelapse/)** | 1996 | DreamFactory 4 on four discs, and **no `.SET` anywhere** — its rooms are stage flats, and it navigates by the shape of the cursor |

…and the fourth has no interpreter to run, because it has nothing to interpret:

| | | |
|---|---|---|
| **[Skull Cracker](skullcracker/)** | 1996 | DreamFactory 4 with **every integer the other way round** — big-endian, where every other disc here is little. A beat-'em-up with no BOOTFILE and no script: its logic is compiled into the executable. Its 66 films and its own menu play, and a level is **walkable** — the levels, the moves, the fights, the sounds and the mission read out of `SC.EXE` with a disassembler rather than scripted in the data |

**RE is for reverse-engineered.** This is a best-effort re-implementation and not
a re-release: it needs a copy of a game's own data files, which it does not
supply, and it is not affiliated with CyberFlix, GTE Entertainment or any current
rights holder.

## Running it

```bash
npm install
npm run dev          # the front door, on http://localhost:5173/
```

Six sites build out of this one repository, each from its own root and its own
port, so they can run at once. **The two that are about the whole project come
first, then one port per game in the order the engine shipped them** — so the next
game to be ported takes 5179 and nothing has to move:

| | | |
|---|---|---|
| `npm run dev` | 5173 | the front door and the format editors |
| `npm run docs:dev` | 5174 | the documentation |
| `npm run dev:taoot` | 5175 | Titanic |
| `npm run dev:dust` | 5176 | Dust |
| `npm run dev:timelapse` | 5177 | Timelapse |
| `npm run dev:skullcracker` | 5178 | Skull Cracker (experimental) |

Add `-- --host` to reach one from another machine. A link from one site to
another **404s in dev with a page telling you which server serves it** — six
Vite roots cannot be one origin, and the deployed tree has no such problem
(`tools/vite-siblings.ts` explains why a proxy cannot fix it).

No game is playable without its data. See **[Game data](taoot/README.md#game-data)**
for what a rip has to look like; nothing distributable is in this repository and
`gamefiles/` is gitignored forever.

## Layout

Eight directories, and each of them a thing rather than a kind of file.

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
- **`dust/`** — Dust: two pages, its own disc, its own tools
- **`timelapse/`** — Timelapse: one page, four discs, and its own palette. The
  engine's screen with no room on it (`engine/src/web/screen-director.ts`) is what
  made it possible at all
- **`skullcracker/`** — Skull Cracker: two pages — the films and its own menu, and
  a walkable level beside them — one big-endian disc, and its own disassembler
  under `tools/`. It is why `engine/src/df/byte-order.ts` exists
- **`site/`** — the project's own web presence: the front door, the eight format
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

Nothing shared imports a game. The five palettes — Titanic's abyss-and-brass,
Dust's dusk-and-ember, Timelapse's glass-and-chrome, Skull Cracker's
gore-and-bone, the project's black-and-green — are five implementations of one
39-role contract in `site/src/chrome.css`, which is structure and not a single
colour.

## Where it goes

Published under **<https://www.danielhobi.ch/dreamrefactory/>**, six things
sharing one directory:

| | |
|---|---|
| `/dreamrefactory/` | the front door and the editors — tag `site-v*` |
| `/dreamrefactory/taoot/` | Titanic — tag `taoot-v*` |
| `/dreamrefactory/dust/` | Dust — tag `dust-v*` |
| `/dreamrefactory/timelapse/` | Timelapse — tag `timelapse-v*` |
| `/dreamrefactory/skullcracker/` | Skull Cracker — tag `skullcracker-v*` |
| `/dreamrefactory/docs/` | the documentation — on any push that touches it |

Each tag is checked against its own package's version. Sharing one directory is
safe because the upload only ever adds and overwrites — see
[Releasing and deploying](docs/reference/deploy.md), and
`.github/actions/ftp-mirror`, which every deploy goes through.

## Tests

```bash
npm test                 # the automatic suite
npm run test:playthrough # the game played end to end, by the clock it runs on
npm run test:browser     # Playwright against a live dev server
```

Most of it reads the original game files, which is why the full suite runs on a
self-hosted runner and only the portable part runs on GitHub's
([Continuous integration](docs/reference/ci.md)). The inventory of what each suite
covers is in [Tests](docs/reference/tests.md).

## Credits

**[DFET](https://github.com/M3tox/DFET) by M3tox** is why this project exists.
The container formats were already legible when this repository started, because
that tool had worked them out and written them down. The file-reading layer here
is a port of that C++ code, and the format docs lean on M3tox's own plain-English
notes. Where a doc knows something, it tries to say where the knowledge came from.

Reverse-engineering credit: **M3tox** (DFET) and **MRXstudios**. Built with the
support of Claude Opus and Claude Fable.

## Licensing

The port and its documentation are **GPL-3.0**, because the decoder is a port of
DFET and DFET is GPL-3.0. The game data is **© CyberFlix** and is not included,
not distributable, and not in this repository.
