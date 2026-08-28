# Tools

The CLI utilities. Most run with `npx tsx` against a local `gamefiles/`
directory (not distributed — your own copy of the game); the authoring ones
need no game data at all.

**Where a tool lives says who it is for.**
[`tools/`](https://github.com/dhobi/dreamrefactory/tree/master/tools) is for
tools that work on *any* DreamFactory rip, because they take one as an
argument. A tool that knows which game it is looking at lives in that game's
own directory instead:

| | |
|---|---|
| [`tools/`](https://github.com/dhobi/dreamrefactory/tree/master/tools) | any rip: the dumpers, `parse`, `scancmds`, `scandeg`, the manifest, the shared encoders and the Vite plugins |
| [`taoot/tools/`](https://github.com/dhobi/dreamrefactory/tree/master/taoot/tools) | *Titanic*: the `TI.EXE` mining tools, the flow map, the deck-map extractor, the language chooser and the intro film |
| [`dust/tools/`](https://github.com/dhobi/dreamrefactory/tree/master/dust/tools) | *Dust*: the v1 SET sweep, the shipped-saves thread, and its title card |
| [`site/tools/`](https://github.com/dhobi/dreamrefactory/tree/master/site/tools) | the front door's artwork |

The **[browser editors](../editors/README.md)** are the other half of the
tooling and live in their own section — they are not CLIs and need no
`gamefiles/`.

## Dumpers — decode a file so you can eyeball it

| Tool | What it does |
|------|--------------|
| [`dumpset.ts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/dumpset.ts) | `npm run dump -- taoot/gamefiles/en/titanic2/DATA/b59.set out/` — prints a SET's structure (scenes, views, hotspots, roads) and writes the default scene's turn ring and both map images as PNGs |
| [`dumpshp.ts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/dumpshp.ts) | prints a SHP's groups/states with frame counts and dumps sample frames as transparent PNGs with their stored offsets |
| [`dumpaudio.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tools/dumpaudio.ts) | decodes a TRK/SFX/11K bank into WAVs (music = concatenated loop chunks, plus one-shots) with waveform PNGs; `--find <name>` scans **every** bank for a named sound |
| [`dumpscripts.ts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/dumpscripts.ts) | decompiles every script container in the corpus to text under `out/scripts/`, plus an opcode-frequency table — the raw material for the [script docs](../engine/scripting-language.md) |
| [`dumpcursors.ts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/dumpcursors.ts) | `npx tsx tools/dumpcursors.ts [<pe>] [--show]` — the mouse cursors out of a DreamFactory build's own `.EXE`. `cursor("touch")` is the engine composing a resource name (`"%s.%s"` over a `CURS` type tag, `tl.exe` 0x421060) and handing `CURS.TOUCH` to `LoadCursorA`, so the art is Windows cursor resources and the script's string *is* the name. `--show` prints them as ASCII; without it, a `cursor-art.ts` for the game named by `--out`/`--const` — two 1bpp planes per cursor, not PNGs, because the browser wants each one at whatever integer scale the canvas is being shown at ([`engine/src/web/cursors.ts`](../engine/architecture.md)). All three games have one: `tl.exe` 17, `ti.exe` 13, `DF.EXE` 10 (before the numeric duplicates are dropped). The set is per BUILD and that is the whole reason this is a tool rather than one table — Timelapse's includes four Titanic has never heard of and redraws `GODOWN`/`GOUP`, which are 11,031 of its 13,200 `cursor(...)` calls; Dust's v1 build has no `GODOWN`/`GOUP` at all and draws `CURS.TOUCH` differently |
| [`keylogo.ts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/keylogo.ts) | `npx tsx tools/keylogo.ts timelapse/assets/timelapse-full.png timelapse/public/timelapse-logo.png --width 900` — a page's title card out of a box render. Both full-size logos in this repository are 1990s renders on a field of pure black with no alpha channel, and a web page wants the opposite: a few hundred pixels, and a transparent ground, because the card is shown over the page's own dark and then over the picture frame's lit rail. Art composited over black carries its own coverage, so `max(r, g, b)` across a narrow window IS the alpha and the colour is left exactly as rendered — unpremultiplying, which is the textbook move, cannot tell a dark colour from a thin one and would brighten every shadow inside the letters. Then crop to the ink and box-filter down in premultiplied space |
| [`parse.ts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/parse.ts) | parses the whole script corpus and reports coverage — the source of the ["100% of the corpus parses"](../engine/formats/script-container.md) claim |
| [`navdump.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tools/navdump.ts) | `npx tsx taoot/tools/navdump.ts taoot/gamefiles/en/titanic2/DATA/b59.set out/` — walks a set's navigation and writes a PNG per step |
| [`scandeg.mts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/scandeg.mts) | scans every SHP for prop states that are *several* animations sharing one state — a variant per stored degree, like `house.shp`'s map holding six frames for normal play and six for the guided tour — as opposed to one animation whose frames each depict an angle. The two are told apart by the shape of the degree list, not by name |
| [`play.ts`](https://github.com/dhobi/dreamrefactory/blob/master/dust/tests/browser/play.ts) | `npm run play:dust -- <save>` — opens Dust in a real window at any rung of the disc's own playthrough, using `dbg.loadSave` (the panel's LOAD lever minus the modal it blocks on). `--list` prints the saves in the order they were made. Asserts nothing and never exits on its own: it is the companion to [the walkthrough](../dust/walkthrough.md), whose every step names the save that ends it. It says what it is waiting for BEFORE the three-minute boot, and logs the standpoint as you walk, because a window that has not finished booting and one that has hung look identical |
| [`rtdthread.ts`](https://github.com/dhobi/dreamrefactory/blob/master/dust/tools/rtdthread.ts) | `npx tsx dust/tools/rtdthread.ts [--spine] [--all] [--md] [--rung <name>]` — reads every `.rtd` beside the Dust disc, orders them by the service-pass counter, and diffs each against the one before it. What it establishes is that they are not examples: all but one are **a single continuous session** written by the shipped `DF.EXE`, from the town gate to the ending ([the golden thread](../dust/thread.md)). It proves the lineage rather than assuming it — frame order is not lineage, so the walk tracks the running maximum `day` and names what goes backwards — and it filters the engine's own counters through a named list with a reason each rather than a heuristic. A prop's `owner` field going `"none"` → `"stranger"` is the whole of "you picked it up", which is why [a walkthrough](../dust/walkthrough.md) falls out of it |
| [`dustsets.ts`](https://github.com/dhobi/dreamrefactory/blob/master/dust/tools/dustsets.ts) | `npx tsx dust/tools/dustsets.ts` — reads every SET on the Dust CD through the v1 reader and says what came out. The last line is the one that matters: `warnings` is everything the reader had to assume and could not confirm, which is how the [v1 model](../engine/formats/set.md#dreamfactory-1-dust) was settled |
| [`bevels.ts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/bevels.ts) | `npx tsx tools/bevels.ts taoot/gamefiles/en out/bevels.md` — every conversation choice in the game, by puppet. A [speedrun sheet](tests.md#the-speedrun) says `talk purser[1,3,5]` and those are the script's own bevel ids, which otherwise have to be found by hand across fifty PUP files |
| [`deckaprobe.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tools/deckaprobe.ts) | a one-off probe over `decka.set`: its scenes, their views, and where a named one is. Kept because the question it answers keeps coming back |
| [`blockmap.ts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/blockmap.ts) | `npx tsx tools/blockmap.ts [--as <slug>] <file>` — maps a file's bytes: the header, the position table and every container, each named by opening the file with the real reader and walking its structures. Every format in this section has an annotator — SET (v4 and Dust's v1), STG/FLT, MOV (both engines), TRK/SFX/11K, SND, SHP, PUP, CST, BOOTFILE and both save formats — and the walk records **which container named which**, so the published map carries the file's pointer graph and a hover can ring everything a table addresses. Whatever the walk misses is sniffed: an audio chunk, a script and a picture each announce themselves. Writes `docs/.vitepress/theme/bytemap/maps/<name>.json`, which is **committed** (its head comment lists the file each map came from) and rendered by `<ByteMap>` as the switchable table/block views on the format pages — offsets and roles only, so no game content ships. The hand-authored struct layouts beside it (`bytemap/layouts.ts`) are the same component fed by hand |
| [`png.ts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/png.ts) | not a CLI — the minimal RGBA PNG encoder the dumpers share, and now the matching decoder (8-bit, non-interlaced, colour types 0/2/4/6) that lets a generator read an authored asset back out, `taoot/assets/globe.png` being the one the language chooser and Titanic's mark are both cut from |

## Reverse-engineering aids — mining `TI.EXE`

`TI.EXE` ships inside the installer rather than as game data, so it sits outside
the game-file index: CD1 carries it twice, as `INSTALL/BIN/ti.exe` and
`INSTALL/BINX/ti.exe` — the payloads of the 16- and 32-bit installers
(`[PROGRAM]` / `[PROGRAMX]` in `cfsetup.ini`). Both are PE32 x86 and they are
*different builds*. The addresses recorded throughout `engine/src/runtime` refer to the
**`en/` tree's `BIN`** one, which is what `gameExePath()` in
[`taoot/tools/gamefiles.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tools/gamefiles.ts)
picks; `TAOOT_TIEXE` overrides it. (Cross-check: in `BIN`, `path` dispatches to
`0x427fb0` and `calcvectx`/`calcvecty` to the TRIG-table cores at
`0x43ad90`/`0x43adc0`, matching the comments in `builtins/helpers.ts`. Run
against `BINX` the same lookups find no handler at all — its jump tables live
elsewhere.) `titanic.exe` at the disc root is only a 16-bit NE launcher stub.

**The language matters as much as `BIN` over `BINX`,** and this is a trap worth
knowing because of how quietly it failed. Every localised disc ships its own build
— `de/BIN` is 463,872 bytes against `en/BIN`'s 461,312 — so a hardcoded VA lands
somewhere that is not code in any of them. Ranking on the path alone put `de/` first
alphabetically, and `disasmcmd.mts` then read garbage and reported *"no handler
found in dispatch tables"*: indistinguishable from a command nobody has located
yet, which is the worst way for a tool to be wrong. The sort now prefers `en/`
explicitly. Measured: `disasmcmd calcvectx` yields 35 instructions against
`en/BIN` and nothing at all against the other eleven candidates.

| Tool | What it does |
|------|--------------|
| [`exetable.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tools/exetable.ts) | locates and extracts the command-name → opcode-ID table embedded in `TI.EXE` — the ground truth behind [`engine/src/df/opcodes.ts`](../engine/formats/script-container.md#command-ids-the-opcode-table). It reads **any** DreamFactory build, which is how the v1/v4 divergence was settled: `npx tsx taoot/tools/exetable.ts dust/gamefiles/dustcd/INSTALL/ALT31/DF.EXE` gives DreamFactory 1's 302 commands against Titanic's 349, and twenty ids mean different things in the two (the table is in `opcodes.ts`) |
| [`disasmcmd.mts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tools/disasmcmd.mts) | `npx tsx taoot/tools/disasmcmd.mts calcvectx calcdeg` — disassembles (via capstone-wasm) the `TI.EXE` handler for a named command, resolving it through the interpreter's recovered per-band jump tables and following one level of calls. It also takes a **raw address**, with an optional byte count: `disasmcmd.mts 0x4277f0:900` reads 900 bytes from there **linearly — through the `ret`s**, which is the point. A handler that answers several ways has a `ret` per answer, so stopping at the first one (what the named form does, deliberately) shows only its error path; `hittest`'s [six answers](../taoot/verification.md) needed the whole body. This is the workhorse for recovering [builtin semantics](builtins.md) one command at a time |
| [`scancmds.mts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/scancmds.mts) | diffs the commands the shipped scripts *actually invoke* against the registered builtins (detecting no-op bodies) and regenerates `builtins_todo.md` — the work-remaining list, in three sections: unimplemented, stubbed, and stubs nothing calls |

## The flow map, and the graphs the navigator walks

| Tool | What it does |
|------|--------------|
| [`mapjumps.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tools/mapjumps.ts) | `npx tsx taoot/tools/mapjumps.ts` — reads `MAP.STG`, decodes each deck plan's click regions and pulls the `jumpbaby(...)` out of the script behind each one, emitting `taoot/tests/playthrough/nav/mapjumps.gen.ts`. It reads the `if` above the jump too, which is the whole story of the deck map: [15 of the 32 red areas do nothing in a shipped game](../taoot/verification.md#taking-the-deck-map) |
| [`flowmap.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tools/flowmap.ts) | `npx tsx taoot/tools/flowmap.ts` — parses every script to an AST, walks it with the enclosing guard conditions, and emits the typed flow events behind **[the mission-flow doc](../taoot/mission-flow.md)**: `FLOW.md`, `globals.tsv`, `flow.json`, the phase/scene graphs, and the interactive Cytoscape map published into `docs/public/flow-map/`. Also emits `taoot/tests/playthrough/nav/shipgraph.gen.ts` — the travel graph distilled into standpoints, doors and guard comparisons for the [navigator](../taoot/mission-flow.md#reading-the-flow-as-a-map-you-can-walk) |

## Authoring and deployment — writing a file, not reading one

| Tool | What it does |
|------|--------------|
| [`mklangstg.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tools/mklangstg.ts) | `npm run mklang` — builds `public/lang.stg`, the **language chooser**, as a real two-flat STG: its own palette, art, click regions and compiled scripts. Needs no `gamefiles/` and reads nothing from the game, which is why the result ships in the repository. Pass a directory to write somewhere else. See [writing a stage](../engine/formats/stg.md#writing-a-stage) and [Languages & the chooser](../taoot/languages.md) |
| [`mkmanifest.ts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/mkmanifest.ts) | `npm run manifest` (or `npx tsx tools/mkmanifest.ts <outDir> <gamefilesDir> <publicDir>`) — writes `gamefiles.json`, the one file a static deployment needs that a directory listing used to provide. `npm run build` already emits it, so this is for what the build plugin cannot cover: game data uploaded *after* the build, or a host carrying fewer editions than the machine that built the pages. The manifest describes the tree it sits next to, so it has to be generated where that tree finally lives — see [hosting it as static files](../engine/runtime/host.md#hosting-it-as-static-files) |
| [`mknightdive.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tools/mknightdive.ts) | `npm run mknightdive -- heading.gif` — builds `nightdive.mov`, the intro film and the ownership question after it, out of an animated GIF. Two halves, and they are the two halves a MOV can be. The film is generated at build time rather than committed ([why](deploy.md)) |
| [`mktaootlogo.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tools/mktaootlogo.ts) / [`mkdustlogo.ts`](https://github.com/dhobi/dreamrefactory/blob/master/dust/tools/mkdustlogo.ts) / [`mklogo.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/tools/mklogo.ts) | `npm run mktaootlogo`, `npm run mkdustlogo`, `npm run mklogo` — the page-sized title cards, derived from the full-size artwork rather than checked in beside it, so a page's asset is never a mystery. `mktaootlogo` also cuts Titanic's 30px mark, the porthole alone, out of the globe artwork |
| [`manifest.ts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/manifest.ts) | not a CLI — the walk behind it, used three ways: served live by the dev server, written into `dist/` by the build, and regenerated by `mkmanifest`. A map of served path → byte size — 4,172 entries and 212 KB (43 KB gzipped) for Titanic, 460 and 20 KB for Dust — because both things the pages want are in it: the keys are the listing, and the values are what the preload bar totals up |
| [`pixelart.ts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/pixelart.ts) | not a CLI — the 5×8 pixel font and the rectangle/ramp/text primitives the generator draws indexed flat art with (capitals, digits, a little punctuation, and Ç; anything richer belongs in a PNG imported through [the stage editor](../editors/stages.md)) |
| [`gif.ts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/gif.ts) | not a CLI — the GIF decoder `mknightdive` reads its source animation with. A decoder and nothing else: each frame already composited onto the logical screen as RGBA, plus the delay the file authored for it |
| [`logo-resize.ts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/logo-resize.ts) | not a CLI — trim artwork to what is actually drawn on it and downsample to the width a page shows it at. Shared, because two packages do this to a title card |

## Build plugins

Not CLIs either, and not optional: every package's `vite.config.ts` loads
both.

| Plugin | What it does |
|--------|--------------|
| [`vite-gamefiles.ts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/vite-gamefiles.ts) | the two things a page needs from its game's `gamefiles/` — the listing and the bytes. In dev it serves the manifest live, so a tree that changed needs no rebuild; in a build it writes the manifest into the output, so a deployment needs no server |
| [`vite-siblings.ts`](https://github.com/dhobi/dreamrefactory/blob/master/tools/vite-siblings.ts) | the dev-only signpost behind a cross-package link. Three sites share one deployed directory but have three Vite **roots**, which is what makes `/src/main.ts` in a page mean the right file — and what makes `../editors/` a path Titanic's server knows nothing about. Rather than 404, it answers with the command and the port that would serve it |

## The browser editors

Not CLIs, and not on this page — they need no `gamefiles/` at all, they take a
file you give them, and there are seven of them, so they have their own
section: **[the browser editors](../editors/README.md)**.

Back to the [reference index](README.md).
