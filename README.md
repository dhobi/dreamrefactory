<img src="docs/globe-mark.svg" alt="" width="120" align="right">

# dreamREfactory

CyberFlix built a game engine and shipped three adventures on it. **dreamREfactory
is that engine written again in TypeScript, from the files rather than from the
source** — every container format decoded, the script language parsed and
interpreted, and the games played in a browser with nothing installed. No DOSBox,
no emulator.

Two of the three are here:

| | | |
|---|---|---|
| **[Titanic: Adventure Out of Time](taoot/)** | 1996 | DreamFactory 4 — six languages, the 1996 demo, a timed endgame |
| **[Dust: A Tale of the Wired West](dust/)** | 1995 | DreamFactory 1 — one disc, and the engine two years earlier |

**RE is for reverse-engineered.** This is a best-effort re-implementation and not
a re-release: it needs a copy of a game's own data files, which it does not
supply, and it is not affiliated with CyberFlix, GTE Entertainment or any current
rights holder.

## Running it

```bash
npm install
npm run dev          # the front door, on http://localhost:5173/
```

Three sites build out of this one repository, each from its own root and its own
port, so they can run at once:

| | | |
|---|---|---|
| `npm run dev` | 5173 | the front door and the format editors |
| `npm run dev:taoot` | 5174 | Titanic |
| `npm run dev:dust` | 5175 | Dust |
| `npm run docs:dev` | 5176 | the documentation |

Add `-- --host` to reach one from another machine. A link from one site to
another **404s in dev with a page telling you which server serves it** — three
Vite roots cannot be one origin, and the deployed tree has no such problem
(`tools/vite-siblings.ts` explains why a proxy cannot fix it).

Neither game is playable without its data. See **[Game data](taoot/README.md#game-data)**
for what a rip has to look like; nothing distributable is in this repository and
`gamefiles/` is gitignored forever.

## Layout

Six directories, and each of them a thing rather than a kind of file.

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
- **`dust/`** — Dust: one page, its own disc, its own tools
- **`site/`** — the project's own web presence: the front door, the seven format
  editors, the chrome every page shares, and the UI-language axis
- **`tools/`** — tools that work on any DreamFactory rip because they take one as
  an argument. A tool that knows which game it is looking at lives in that game's
  `tools/` instead
- **`docs/`** — the long half of this project ([start here](docs/README.md))

Dependencies point one way only, and there is a test that says so
(`site/tests/layering.ts`):

    engine  ←  nothing
    site    ←  engine
    taoot   ←  engine, site
    dust    ←  engine, site

Nothing shared imports a game. The three palettes — Titanic's abyss-and-brass,
Dust's dusk-and-ember, the project's black-and-green — are three implementations
of one 39-role contract in `site/src/chrome.css`, which is structure and not a
single colour.

## Where it goes

Published under **<https://www.danielhobi.ch/dreamrefactory/>**, four things
sharing one directory:

| | |
|---|---|
| `/dreamrefactory/` | the front door and the editors — tag `site-v*` |
| `/dreamrefactory/taoot/` | Titanic — tag `taoot-v*` |
| `/dreamrefactory/dust/` | Dust — tag `dust-v*` |
| `/dreamrefactory/docs/` | the documentation — on any push that touches it |

Each tag is checked against its own package's version. Sharing one directory is
safe because the upload only ever adds and overwrites — see
[Releasing and deploying](docs/reference/deploy.md), and
`.github/actions/ftp-mirror`, which every deploy goes through.

## Tests

```bash
npm test                 # 36 files, 524 tests — the automatic suite
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
