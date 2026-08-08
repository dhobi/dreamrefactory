# Tools

The CLI utilities under
[`tools/`](https://github.com/dhobi/taoot-web/tree/master/tools). All run with
`npx tsx` against a local `gamefiles/` directory (not distributed — your own
copy of the game). They fall into three groups. The
**[browser editors](../editors/README.md)** are the other half of the tooling
and live in their own section — they are not CLIs and need no `gamefiles/`.

## Dumpers — decode a file so you can eyeball it

| Tool | What it does |
|------|--------------|
| [`dumpset.ts`](https://github.com/dhobi/taoot-web/blob/master/tools/dumpset.ts) | `npm run dump -- gamefiles/en/titanic2/DATA/b59.set out/` — prints a SET's structure (scenes, views, hotspots, roads) and writes the default scene's turn ring and both map images as PNGs |
| [`dumpshp.ts`](https://github.com/dhobi/taoot-web/blob/master/tools/dumpshp.ts) | prints a SHP's groups/states with frame counts and dumps sample frames as transparent PNGs with their stored offsets |
| [`dumpaudio.ts`](https://github.com/dhobi/taoot-web/blob/master/tools/dumpaudio.ts) | decodes a TRK/SFX/11K bank into WAVs (music = concatenated loop chunks, plus one-shots) with waveform PNGs; `--find <name>` scans **every** bank for a named sound |
| [`dumpscripts.ts`](https://github.com/dhobi/taoot-web/blob/master/tools/dumpscripts.ts) | decompiles every script container in the corpus to text under `out/scripts/`, plus an opcode-frequency table — the raw material for the [script docs](../03-scripting-language.md) |
| [`parse.ts`](https://github.com/dhobi/taoot-web/blob/master/tools/parse.ts) | parses the whole script corpus and reports coverage — the source of the ["100% of the corpus parses"](../formats/script-container.md) claim |
| [`navdump.ts`](https://github.com/dhobi/taoot-web/blob/master/tools/navdump.ts) | `npx tsx tools/navdump.ts gamefiles/en/titanic2/DATA/b59.set out/` — walks a set's navigation and writes a PNG per step |
| [`scandeg.mts`](https://github.com/dhobi/taoot-web/blob/master/tools/scandeg.mts) | scans every SHP for prop states that are *several* animations sharing one state — a variant per stored degree, like `house.shp`'s map holding six frames for normal play and six for the guided tour — as opposed to one animation whose frames each depict an angle. The two are told apart by the shape of the degree list, not by name |
| [`png.ts`](https://github.com/dhobi/taoot-web/blob/master/tools/png.ts) | not a CLI — the minimal RGBA PNG encoder the dumpers share, and now the matching decoder (8-bit, non-interlaced, colour types 0/2/4/6) that lets a generator read an authored asset back out, `public/globe.png` being the one that does |

## Reverse-engineering aids — mining `TI.EXE`

`TI.EXE` ships inside the installer rather than as game data, so it sits outside
the game-file index: CD1 carries it twice, as `INSTALL/BIN/ti.exe` and
`INSTALL/BINX/ti.exe` — the payloads of the 16- and 32-bit installers
(`[PROGRAM]` / `[PROGRAMX]` in `cfsetup.ini`). Both are PE32 x86 and they are
*different builds*. The addresses recorded throughout `src/engine` refer to the
**`en/` tree's `BIN`** one, which is what `gameExePath()` in
[`tools/gamefiles.ts`](https://github.com/dhobi/taoot-web/blob/master/tools/gamefiles.ts)
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
| [`exetable.ts`](https://github.com/dhobi/taoot-web/blob/master/tools/exetable.ts) | locates and extracts the command-name → opcode-ID table embedded in `TI.EXE` — the ground truth behind [`src/df/opcodes.ts`](../formats/script-container.md#command-ids-the-opcode-table) |
| [`disasmcmd.mts`](https://github.com/dhobi/taoot-web/blob/master/tools/disasmcmd.mts) | `npx tsx tools/disasmcmd.mts calcvectx calcdeg` — disassembles (via capstone-wasm) the `TI.EXE` handler for a named command, resolving it through the interpreter's recovered per-band jump tables and following one level of calls. It also takes a **raw address**, with an optional byte count: `disasmcmd.mts 0x4277f0:900` reads 900 bytes from there **linearly — through the `ret`s**, which is the point. A handler that answers several ways has a `ret` per answer, so stopping at the first one (what the named form does, deliberately) shows only its error path; `hittest`'s [six answers](../verification.md) needed the whole body. This is the workhorse for recovering [builtin semantics](builtins.md) one command at a time |
| [`scancmds.mts`](https://github.com/dhobi/taoot-web/blob/master/tools/scancmds.mts) | diffs the commands the shipped scripts *actually invoke* against the registered builtins (detecting no-op bodies) and regenerates `builtins_todo.md` — the work-remaining list, in three sections: unimplemented, stubbed, and stubs nothing calls |

## The flow map, and the graphs the navigator walks

| Tool | What it does |
|------|--------------|
| [`mapjumps.ts`](https://github.com/dhobi/taoot-web/blob/master/tools/mapjumps.ts) | `npx tsx tools/mapjumps.ts` — reads `MAP.STG`, decodes each deck plan's click regions and pulls the `jumpbaby(...)` out of the script behind each one, emitting `tests/playthrough/nav/mapjumps.gen.ts`. It reads the `if` above the jump too, which is the whole story of the deck map: [15 of the 32 red areas do nothing in a shipped game](../verification.md#taking-the-deck-map) |
| [`flowmap.ts`](https://github.com/dhobi/taoot-web/blob/master/tools/flowmap.ts) | `npx tsx tools/flowmap.ts gamefiles out/` — parses every script to an AST, walks it with the enclosing guard conditions, and emits the typed flow events behind **[the mission-flow doc](../04-mission-flow.md)**: `FLOW.md`, `globals.tsv`, `flow.json`, the phase/scene graphs, and the interactive Cytoscape map published into `docs/public/flow-map/`. Also emits `tests/playthrough/nav/shipgraph.gen.ts` — the travel graph distilled into standpoints, doors and guard comparisons for the [navigator](../04-mission-flow.md#reading-the-flow-as-a-map-you-can-walk) |

## Authoring and deployment — writing a file, not reading one

| Tool | What it does |
|------|--------------|
| [`mklangstg.ts`](https://github.com/dhobi/taoot-web/blob/master/tools/mklangstg.ts) | `npm run mklang` — builds `public/lang.stg`, the **language chooser**, as a real two-flat STG: its own palette, art, click regions and compiled scripts. Needs no `gamefiles/` and reads nothing from the game, which is why the result ships in the repository. Pass a directory to write somewhere else. See [writing a stage](../formats/stg.md#writing-a-stage) and [Languages & the chooser](../runtime/languages.md) |
| [`mkmanifest.ts`](https://github.com/dhobi/taoot-web/blob/master/tools/mkmanifest.ts) | `npm run manifest` (or `npx tsx tools/mkmanifest.ts <outDir> <gamefilesDir>`) — writes `gamefiles.json`, the one file a static deployment needs that a directory listing used to provide. `npm run build` already emits it, so this is for what the build plugin cannot cover: game data uploaded *after* the build, or a host carrying fewer editions than the machine that built the pages. The manifest describes the tree it sits next to, so it has to be generated where that tree finally lives — see [hosting it as static files](../runtime/host.md#hosting-it-as-static-files) |
| [`manifest.ts`](https://github.com/dhobi/taoot-web/blob/master/tools/manifest.ts) | not a CLI — the walk behind it, used three ways: served live by the dev server, written into `dist/` by the build, and regenerated by `mkmanifest`. A map of served path → byte size (4,065 files, 208 KB, 40 KB gzipped), because both things the pages want are in it: the keys are the listing, and the values are what the preload bar totals up |
| [`pixelart.ts`](https://github.com/dhobi/taoot-web/blob/master/tools/pixelart.ts) | not a CLI — the 5×8 pixel font and the rectangle/ramp/text primitives the generator draws indexed flat art with (capitals, digits, a little punctuation, and Ç; anything richer belongs in a PNG imported through [the stage editor](../editors/stages.md)) |

## The browser editors

Not CLIs, and not on this page — they need no `gamefiles/` at all, they take a
file you give them, and there are seven of them, so they have their own
section: **[the browser editors](../editors/README.md)**.

Back to the [reference index](README.md).
