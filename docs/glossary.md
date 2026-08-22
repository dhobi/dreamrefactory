# Glossary

*Prerequisite: none — this page exists so you can arrive in the middle.*

DreamFactory named things its own way, and this port kept those names rather
than inventing better ones: a prop file is a "shop", a positional ambient sound
is a "cricket". A few more terms are the port's own. Every entry here is one
sentence and a link to where it is explained properly.

If you are reading start to finish, you don't need this page —
[How the game works](taoot/how-the-game-works.md) introduces the important words in
order. It's for the reader who landed on `savegame.md` from a search and hit the
word "flat".

## The world on screen

| Term | What it means |
|------|---------------|
| **Set** | One room or section of the ship — the Lounge, cabin B59 — stored as one file. [→ SET](engine/formats/set.md) |
| **Scene** | A *standpoint* inside a set: a spot the player can stand on. [→ the hierarchy](engine/formats/set.md#the-hierarchy) |
| **View** | One *direction you can face* from a scene. A scene has several, plus the frames between them. [→ SET](engine/formats/set.md#the-hierarchy) |
| **Turn ring** | The sequence of in-between frames that animates rotating in place, from one view round to the next. [→ SET](engine/formats/set.md#the-hierarchy) |
| **Road** | A walking animation carrying you from one scene to the next, arriving at a defined facing. The game's own word is *transition*. [→ Roads](engine/formats/set.md#roads-getting-from-scene-to-scene-facing-the-right-way) |
| **Hotspot** | A clickable rectangle attached to a view — the doorway, the painting. [→ Hotspots](engine/formats/set.md#hotspots-where-you-can-click) |
| **Prop** | A movable image drawn *over* the current view: a door, a teacup, a button. [→ SHP](engine/formats/shp.md) |
| **Shop** | DreamFactory's name for a file of props (`.SHP`), organised as groups → states → frames. Nothing to do with shopping. [→ SHP](engine/formats/shp.md) |
| **Actor** | A character sprite standing or walking in the room, drawn from a CST file. [→ Actors](engine/runtime/characters.md#actors-sprites-in-the-world) |
| **Star / actor mark** | A named world-point in a SET's actor table where an actor can be placed. [→ Actors](engine/runtime/characters.md#actors-sprites-in-the-world) |
| **Z layer** | The hidden depth image shipped alongside a background, recording how far away each pixel is — which is how a character gets hidden behind a chair. [→ the Z layer](engine/formats/image-codec.md#the-z-layer-a-hidden-depth-map) |
| **Flat** | One full-screen 512×384 screen inside a stage file, with its own scripts and click regions. [→ Flats](engine/formats/stg.md#flats-full-screen-background-images) |
| **Stage** | An `.STG` file: the deck map, the inventory, the UI band, the mini-games. Holds one or more flats. [→ STG](engine/formats/stg.md) |
| **Overlay** | A flat pushed on top of another rather than replacing it — how the inventory opens over what's behind it. [→ the overlay stack](engine/runtime/stage-ui.md#the-overlay-stack-transtoflat-transfromflat) |
| **UI band** | The strip below the picture holding the menu button, your held item and the watch. The view fills 512×264 of a 512×384 screen; the band is the rest. [→ the UI band](engine/formats/stg.md#the-ui-band-and-inventory) |

## Characters and conversation

| Term | What it means |
|------|---------------|
| **Puppet** | A character's *brains* — a `.PUP` file: dialogue, voice lines, and the facial animation for a conversation close-up. [→ PUP](engine/formats/pup-cst.md#pup-—-dialogue-voice-and-faces) |
| **Cast** | A character's *body* — a `.CST` file of sprites for walking around the world. [→ CST](engine/formats/pup-cst.md#cst-—-the-body-that-scales-with-distance) |
| **Stance** | A puppet's facial state, assembled from up to 11 layers of frames. [→ Stances](engine/formats/pup-cst.md#stances-and-animation-logic-the-face-as-11-layers) |
| **Pose** | A cast member's sprite set for one activity (`stand`, `walk`), stored as steps × 8 directions. [→ CST](engine/formats/pup-cst.md#cst-—-the-body-that-scales-with-distance) |
| **Bevel** | A labelled plaque you click to choose a reply in a conversation. Routes name them by the id the PUP script switches on. [→ Puppets](engine/runtime/characters.md#puppets-the-conversation-close-up) |

## The files

| Term | What it means |
|------|---------------|
| **DFile** | The one container format every DreamFactory data file uses — a 1024-byte header, a position table, and numbered containers. [→ the container format](engine/formats/README.md) |
| **Container** | One numbered "drawer" inside a DFile, holding a palette, an image, a script or a chunk of audio. Which index holds what is convention per format. [→ a single container](engine/formats/README.md#a-single-container) |
| **Gap** | A reserved container index with nothing in it, kept so that later indices don't shift. [→ the position table](engine/formats/README.md#the-position-table-starts-at-byte-1024) |
| **Pascal string** | Text stored as a length byte followed by that many characters, with no terminator — often inside a larger fixed-size field. [→ Pascal strings](engine/formats/README.md#pascal-strings-—-length-first-no-terminator) |
| **BOOTFILE** | The script bundle that starts the game *and* acts as its shared standard library — how doors work, how you move, how the menu behaves. [→ BOOTFILE](engine/formats/bootfile.md) |
| **Bank** | An audio file (`.TRK`, `.SFX`, `.11K`) holding an ordered looping theme plus named one-shots. [→ Banks](engine/formats/audio.md#banks-ordered-loops-vs-named-one-shots) |
| **Chunk** | One sound inside a bank — itself split across several containers, because audio is the format that doesn't fit one drawer. [→ Audio](engine/formats/audio.md#why-audio-is-the-odd-one-out) |
| **Code page** | Which character encoding the game's text is in. No DF file declares it; it has to be inferred per language tree. [→ the code page](taoot/languages.md#the-code-page-is-not-in-the-data) |
| **Tree** | One `gamefiles/` directory per language, each a full copy of the data. A bare filename resolves through a disc selector and a language selector. [→ two selectors](taoot/languages.md#two-selectors-on-one-basename) |

## Scripts and events

| Term | What it means |
|------|---------------|
| **Handler** | A named block in a script that runs when an event fires — `openset`, `mousedown`, `keydown`. [→ the event model](engine/scripting-language.md#the-event-model-objects-handlers-and-the-chain) |
| **The chain** | The ordered list of objects an event is offered to, innermost first, until one consumes it. [→ the chain](engine/scripting-language.md#the-chain-and-how-an-event-is-consumed) |
| **`exitcode` / consumed** | A handler calling `exitcode` stops the event travelling further — but only a handler *of the event under dispatch* counts. [→ the chain](engine/scripting-language.md#the-chain-and-how-an-event-is-consumed) |
| **`passcode`** | The opposite: hand the event on, so the engine's own default behaviour still runs. [→ the chain](engine/scripting-language.md#the-chain-and-how-an-event-is-consumed) |
| **Builtin** | A command implemented by the engine rather than in script — about 250 of them, plus 22 `sendto*` special forms. [→ the builtin reference](reference/builtins.md) |
| **Mission / phase** | The two globals that encode where you are in the plot. Nearly the whole story is a state machine over these. [→ the mission flow](taoot/mission-flow.md#the-whole-plot-is-a-handful-of-variables) |
| **Guard** | The `if` in front of a story beat, deciding whether it can fire yet. The vocabulary of guards turns out to be small. [→ the guard vocabulary](taoot/mission-flow.md#the-guard-vocabulary-is-small) |

## Time and sound

| Term | What it means |
|------|---------------|
| **Heartbeat** | The engine's service pass, which fires due timers and advances the clock. [→ two time bases](engine/runtime/timing.md#two-time-bases) |
| **`makeloop`** | The game's timer: a one-shot that re-arms itself, not a loop in the usual sense. [→ makeloop](engine/runtime/timing.md#makeloop-a-loop-that-isn-t-a-loop) |
| **Cricket** | A sound with a position in the room, panned and attenuated by where you're standing. Named for the ambient insect noise it was first used for. [→ Crickets](engine/runtime/timing.md#crickets-sound-with-a-position) |
| **Walk** | An actor moving between marks over time, as opposed to the player's own road animation. [→ Walks](engine/runtime/timing.md#walks) |
| **Sink** | Where audio actually goes — a real output in the browser, a recorder in tests. [→ Sinks](engine/runtime/audio.md#sinks-browser-vs-headless) |

## This port's own vocabulary

These aren't DreamFactory words; they're names for parts of this project.

| Term | What it means |
|------|---------------|
| **Host** | Everything under `src/` that is neither format knowledge (`engine/src/df/`) nor recovered engine behaviour (`engine/src/runtime/`) — the page, the canvas, input, the dev toolbar. [→ the browser host](engine/runtime/host.md#the-split-and-why-it-is-where-it-is) |
| **GameSession** | The object that survives a set change: globals, inventory, the interpreter's state. [→ the GameSession](engine/architecture.md#the-gamesession-the-thing-that-persists) |
| **Trace** | A snapshot of every script global, the current room and who owns what, taken at a story beat. [→ the playthrough](taoot/verification.md#the-playthrough-the-game-played-not-probed) |
| **Golden** | A recorded trace a later run is diffed against. [→ what a golden speaks for](taoot/verification.md#one-game-carried-not-a-chain-of-loads) |
| **Segment** | One stretch of the playthrough route — 29 of them cover the boot to the ending. [→ the playthrough](taoot/verification.md#the-playthrough-the-game-played-not-probed) |
| **Carried / loaded** | Whether a segment continued the live game or resumed a `.ti` checkpoint. The two produce different traces, which is why a golden only speaks for one. [→ one game carried](taoot/verification.md#one-game-carried-not-a-chain-of-loads) |
| **Editor** | One of seven browser pages that opens a container format with the engine's own reader, lets you change what's safe, and exports the repacked file. [→ the browser editors](editors/README.md) |

Back to the [documentation home](README.md).
