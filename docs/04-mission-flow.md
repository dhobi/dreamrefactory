# The mission flow

*Prerequisite: [How the game works](01-how-the-game-works.md) and
[The scripting language](03-scripting-language.md).*

A natural question once the engine runs is: **can we see the whole game, start
to finish, from the data we already have?** The answer is yes — and it needs no
extra reverse engineering of `TI.EXE`. The plot does not live in the engine
binary. It lives entirely in the **scripts**, which we already decode. This page
explains how the story is encoded, and shows the mission graph reconstructed
straight from the shipped scripts.

## The whole plot is a handful of variables

The engine has no idea what "the story" is. It just runs scripts and remembers
some **global variables**. A few of those globals *are* the story: the scripts
branch on them to decide who is standing where, which door is unlocked, what a
character says, and where a click takes you.

Two globals matter most:

| Global | Meaning | Values |
|--------|---------|--------|
| `mission` | Which chapter of the plot you're in | `1`, `2`, `3`, then `4` (endgame), and finally `"good"` / `"bad"` |
| `phase` | How far through the current chapter | `0` … `4` |

Everything else keys off these. A script that places a character typically reads
like this (real example, from `BOIL.SET`):

```
if mission = 3 & phase = 1 & actorowner ("csea") != "thanks2"
    sendtoactor ("bsea", setupactor ("boil5"))
endif
```

That single `if` is the entire "flow logic" — a guard on `mission`/`phase` (plus
some puzzle state), and an effect. Multiply it across ~2000 script blocks and you
have the game.

### `progress()` is a *question*, not a command

Scripts constantly call `progress(m, p)`. It's easy to assume this *advances* the
story, but the BOOTFILE definition shows it only **asks** whether you've reached
at least mission `m`, phase `p`:

```
code progress (themission, thephase)
    global mission, phase
    if mission > themission
        return true
    endif
    if mission < themission
        return false
    endif
    if phase < thephase
        return false
    endif
    return true
endif
```

So `if progress(2, 3)` means *"have I reached mission 2 phase 3 or later?"* — a
gate, never a state change.

### What actually advances the story

The state is only ever moved forward by three BOOTFILE helpers:

- `advancephase()` — step to the next phase (and roll over into the next mission
  when the current one is done);
- `advanceday()` — jump to the start of a new mission/day;
- `advancetour()` — the guided-tour (demo) path.

Everywhere else, a script simply **calls one of these** when you finish a puzzle
or reach a story beat — most often at the end of a conversation. Those call sites
are the concrete moments the plot moves. We call them *beats* below.

## The mission spine

`advancephase` is one big switch on the current `mission`/`phase`. Reading it
gives the exact skeleton of the game:

```mermaid
graph LR
  START(["clock = bedsit<br/>game begins"]) --> M10

  subgraph M1["Mission 1"]
    M10["1.0"] --> M11["1.1"] --> M12["1.2"] --> M13["1.3"] --> M14["1.4"]
  end
  subgraph M2["Mission 2"]
    M20["2.0"] --> M21["2.1"] --> M22["2.2"] --> M23["2.3"]
  end
  subgraph M3["Mission 3"]
    M30["3.0"] --> M31["3.1"] --> M32["3.2"] --> M33["3.3"]
  end

  M14 -->|"advancephase"| M20
  M23 -->|"advancephase"| M30
  M33 -->|"advanceday"| ENDG

  ENDG(["mission 4<br/>endgame"]) --> ENDING["futures() contains<br/>'proz'?"]
  ENDING -->|yes| GOOD(["mission = good<br/>🏆 good ending"])
  ENDING -->|no| BAD(["mission = bad<br/>credits / play more"])
```

A few things this makes plain:

- The plot is a **linear spine** — mission 1 → 2 → 3 → endgame. There is no
  branching *chapter* structure; the freedom is inside each phase, not between
  them.
- A `mission` bump resets `phase` to `0`. When mission 3 finishes its last phase,
  `advancephase` doesn't go to a "mission 4 phase 1" — it calls `advanceday`,
  which is how the game crosses into the endgame.
- The ending is decided in one place (`opennarend`): you get `mission = "good"`
  only if your list of predicted `futures()` contains `"proz"`; otherwise
  `mission = "bad"`.

### Where the game starts (and restarts)

`advanceday` keys off a `clock` global, which is how the two-disc release and the
demo pick an entry point:

| `clock` | Sets | Meaning |
|---------|------|---------|
| `"startdisk1"` | `mission = 0` | Framing story / intro |
| `"bedsit"` | `mission = 1` | **Main game begins** (your cabin) |
| `"startdisk2"` | `mission = 4` | Disc 2 boots straight into the endgame |
| `"endgame"` (not "good") | `mission = 1` | Loop back after a failed ending |

## The scene-travel map

The spine above is the *plot*. The **geography** — which room leads to which — is
a separate, much denser graph, reconstructed from every `changeset` /
`gotospecial` / `opensetfile` / `jumppapa` call in the scripts. It's too big for
a static diagram, so it's rendered as an interactive map you can pan, zoom and
filter:

- **Nodes** are sets (rooms); diamonds are non-`SET` scripts (conversations,
  props) that trigger travel.
- **Edges** are travel calls, coloured by the `mission`/`phase` they're gated on
  (grey = ungated, i.e. an always-available door).
- **Click a room** to see everywhere you can go from it and how you get back —
  each with the exact guard condition.
- Use the **mission chips** to isolate a chapter, the **search box** to find a
  set, and the **scripts** toggle to include conversation/prop triggers.

<iframe src="./flow-map/index.html" title="Interactive scene-travel map"
  style="width:100%; height:640px; border:1px solid var(--vp-c-divider); border-radius:8px; margin:8px 0;"
  loading="lazy"></iframe>

*Not loading? <a href="./flow-map/index.html" target="_blank" rel="noopener">open the map in its own tab</a>.*
It's a self-contained page generated by the same tool (below).

## Story beats — what pushes the plot forward

Because every real advance is an `advancephase()`/`advanceday()` **call**,
listing those call sites (with their guards) gives a plain-language walkthrough of
the story spine. A sample of what the extractor pulls out:

| Where | Fires when | Beat |
|-------|-----------|------|
| `CSEA1.PUP` (conversation) | `mission = 1 & phase = 2 & actorowner("csea") = "thanks1"` | thank the character → advance |
| `BOIL.SET` `openset` | `mission = 1 & phase = 3` and you've fed Vlad (`vladfood`) and placed the Rubaiyat at the coal chute | boiler-room puzzle solved |
| `BINL.SET` `mousedown` | `not tour & carlights & propowner("painting") = "none"` | the painting swap |
| `BSEA1.PUP` | `mission = 2 & phase = 0` | conversation → travel to the cargo hold |
| `DECKBD.SET` `keydown` | `mission = 4 & phase < 2 & clock = "endgame"` | walking forward on the boat deck at the climax |

Most beats live inside **`.PUP` conversation scripts** — the game advances when
you say (or hear) the right thing — which is exactly what you'd expect from a
talk-driven adventure.

## Sub-plots: the per-puzzle state machines

Alongside `mission`/`phase`, the scripts use ~140 secondary flow globals. Almost
all of them are little state machines for individual puzzles or characters, and
they follow an obvious naming convention (`…phase`):

| Global | Thread |
|--------|--------|
| `neckphase` | the necklace puzzle |
| `letterphase` | the letter puzzle |
| `cashphase` | money / the purser |
| `morrowphase` | Colonel Morrow's thread |
| `maxphase` | Max Seidelmann's thread |
| `pennyphase` | Penny Pringle's thread |
| `bombphase` | defusing the bomb (endgame) |
| `jonesphase` | the endgame chase on deck |

These are why two players at the "same" `mission.phase` can see different things:
the chapter gate is shared, but each sub-plot tracks its own progress.

## Regenerate it yourself

All of the above is produced mechanically by
[`tools/flowmap.ts`](https://github.com/dhobi/taoot-web/blob/master/tools/flowmap.ts):

```sh
npx tsx tools/flowmap.ts gamefiles out/
```

It parses every script container into the AST (see
[the scripting language](03-scripting-language.md)), walks each statement while
carrying the stack of enclosing `if` / `switch` / `while` conditions, and emits
typed **flow events** — each with its location *and* the guard path that reaches
it:

| Event | Extracted from |
|-------|----------------|
| `state` | writes to a flow-state global (`mission = 2`) |
| `beat` | calls to `advanceday` / `advancephase` / `advancetour` |
| `travel` | `changeset` / `gotospecial` / `jump*` — the scene graph |
| `actor` | `setupactor` / `sendtoactor` — character placement |
| `movie` | `playmovie` / `spotmovie` — cutscenes |
| `puppet` | conversation entry points |
| `gate` | `progress(m, p)` checks |

It writes these files under `out/flow/`:

- **`FLOW.md`** — the full readable report (this page is a curated summary of it),
  including a Mermaid mission graph;
- **`globals.tsv`** — every flow-state global ranked by how often it gates a
  branch, with the literal values written to it;
- **`flow.json`** — every event, for further tooling;
- **`phase-graph.json`** — the derived `mission.phase → mission.phase` edges;
- **`scene-graph.json`** — the nodes and edges behind the interactive map above.

It also publishes the interactive map straight into the docs site:
`docs/public/flow-map/index.html` (a self-contained [Cytoscape.js](https://js.cytoscape.org/)
page, `fcose` layout) plus its vendored libraries under `docs/public/flow-map/vendor/`.
That's the same map embedded above — regenerating the report keeps the published
map in sync. (It's served as a directory index so VitePress's `cleanUrls` doesn't
redirect it away.)

Across the corpus it parses **~2050 scripts with zero failures** and extracts
**~2500 flow events** (the scene map alone is ~60 rooms and ~140 travel edges) —
so the report is a complete, data-derived map of the game, and doubles as a
coverage checklist for the engine port.
