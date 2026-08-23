# The runtime — how the port plays the game

*Prerequisite: [Engine architecture](../architecture.md).*

The [format docs](../formats/README.md) answer one question: **what is in the
bytes on disk**. This section answers the other one: **what the engine does
with them at runtime** — the behaviour that DFET never needed and that was
recovered from `TI.EXE` and from watching the real game.

Keeping the two apart is deliberate. A format page should stay true as long as
the 1996 files don't change (they won't); a runtime page describes living code
that gets refactored. When a format doc used to carry runtime detail ("how the
UI band is drawn", "how a cricket pans"), every refactor quietly made it stale.
Now the format pages stick to bytes and link here for behaviour.

## The pages

Read in any order — each names its own prerequisites.

1. **[Timing — the heartbeat, loops, crickets & walks](timing.md)** — the two
   time bases, `makeloop`'s one-shot-that-re-arms model, positional ambient
   sound, actor walks, and the game clock behind the pocketwatch.
2. **[The sinking — how mission 4's clock runs](../../taoot/sinking.md)** — the one level
   played against a clock, and why that clock counts engine passes rather than
   seconds: the heartbeat, the conversations, the phase timetable's hold, and the
   movement bump that makes turning in place cost you the ship.
3. **[Stage & UI — flats, overlays and the click order](stage-ui.md)** — the
   `StageController`: how a stage opens, the overlay stack behind the
   inventory, and exactly who gets a click first.
4. **[Characters — actors & puppets at runtime](characters.md)** — walking
   CST sprites in the world and PUP conversation close-ups: facing math,
   occlusion, speech pacing, subtitles and choice bevels.
5. **[Audio at runtime — channels, banks & volumes](audio.md)** — the three
   playback channels, how a name finds its bank, the two-slot `currentsound`
   model, and the volume controls (including one deliberate divergence).
6. **[Saving & loading at runtime](saves.md)** — what a save snapshot contains,
   the script-free load that restores the engine from the file rather than
   re-running the room, and the in-browser saved-games UI with its IndexedDB
   "file system".
7. **[The browser host](host.md)** — the part that is neither format knowledge
   nor recovered behaviour: the page and the cold boot it starts, the `SetViewer`
   navigation state machine, the movie player, input wiring, and the developer
   toolbar.
8. **[The low-memory game](../../taoot/low-memory.md)** — the smaller version of itself the
   game shipped with: what `BOOTFILE`'s own `lowmemory()` switches off, why
   `.11K` is not 11 kHz, and the one number the port moves to let a player hear
   it.
9. **[Languages & the chooser](../../taoot/languages.md)** — one data tree per language, how
   a bare filename resolves through two selectors (disc and language), the code
   page a tree's text turns out to be in, and the language chooser: this port's
   own DreamFactory stage, scripts and all.

## Where the code lives

Paths are relative to `engine/src/` — `runtime/` is the recovered engine,
`web/` is the browser layer around it, `df/` is the format library
([the architecture map](../architecture.md) has the full inventory). The last
two rows are a *game's* code rather than the engine's, and are named as such.

| Subsystem | Source | Page |
|-----------|--------|------|
| Heartbeat, loops, crickets, walks | [`runtime/scheduler.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/scheduler.ts), [`runtime/clock.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/clock.ts) | [Timing](timing.md) |
| The mission-4 clock and its phase timetable | [`runtime/scheduler.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/scheduler.ts) (`serviceGameClock`), [`runtime/setscripts.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/setscripts.ts) (`openScene`/`viewChanged`) | [The sinking](../../taoot/sinking.md) |
| Stage layer (STG at runtime) | [`runtime/stage.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/stage.ts) | [Stage & UI](stage-ui.md) |
| Actors (CST at runtime) | [`runtime/actors.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/actors.ts), [`runtime/geometry.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/geometry.ts) | [Characters](characters.md) |
| Puppets (PUP at runtime) | [`runtime/puppet.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/puppet.ts), [`web/puppet-view.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/puppet-view.ts) | [Characters](characters.md) |
| Props (SHP at runtime) | [`runtime/props.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/props.ts) | [Stage & UI](stage-ui.md), [SHP](../formats/shp.md) |
| Audio channels + bank library | [`runtime/audio.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/audio.ts) | [Audio](audio.md) |
| The `heapsize` answer the game's `lowmemory()` reads | [`runtime/builtins/helpers.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/builtins/helpers.ts) | [The low-memory game](../../taoot/low-memory.md) |
| Save/load orchestration | [`runtime/saveload.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/saveload.ts) (`.ti`), [`runtime/saveload-v1.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/saveload-v1.ts) (`.rtd`) | [Saves](saves.md) |
| Saved-games UI + storage | [`web/save-browser.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/save-browser.ts), [`web/save-store.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/save-store.ts), [`taoot/src/save-seed.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/src/save-seed.ts) | [Saves](saves.md) |
| Navigation + rendering | [`web/viewer.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/viewer.ts), [`web/ring-cache.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/ring-cache.ts) | [Browser host](host.md) |
| The screen everything composites into | [`web/screen-presenter.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/screen-presenter.ts), [`web/screen.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/screen.ts) | [Browser host](host.md) |
| Movie playback | [`web/movie-player.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/movie-player.ts), [`df/mov-pace.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/mov-pace.ts) | [Browser host](host.md), [MOV](../formats/mov.md) |
| Page + input | [`taoot/src/main.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/src/main.ts) | [Browser host](host.md) |
| What a launch has to have in hand | [`runtime/bootplan.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/runtime/bootplan.ts), [`web/host.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/web/host.ts) | [The boot plan](host.md#the-boot-plan-what-a-game-says-it-needs) |

The interpreter itself — scopes, operators, the event chain — is a language
topic and stays in **[the scripting doc](../scripting-language.md)**; the
full command list is in the **[builtin reference](../../reference/builtins.md)**.

Start with the one everything else leans on: **[Timing](timing.md)**.
