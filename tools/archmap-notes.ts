/**
 * What the parts of the repository are, in words: the one half of the
 * architecture map (docs/engine/architecture-map.md) that cannot be read out of
 * the code. tools/archmap.mts reads the rest — the folders, the files, their
 * imports and their classes — and site/tests/archmap.ts fails when a folder
 * has no line here, or a line here names a folder that is gone.
 *
 * A file or a class needs no line: it is described by its own first doc comment.
 */

export interface ContainerNote {
  readonly name: string;
  readonly kind: "engine" | "game" | "site" | "tools";
  readonly title: string;
  readonly desc: string;
}
export interface ExternalNote {
  readonly name: string;
  readonly kind: "person" | "ext" | "docs";
  readonly title: string;
  readonly desc: string;
}

/** the workspaces, and tools/ */
export const CONTAINERS: Record<string, ContainerNote> = {
  engine: { name: "engine", kind: "engine", title: "The DreamFactory engine", desc: "The rebuilt engine every game page runs on: readers for each file format and engine version, the script interpreter and the running game session, and the browser presentation. Behaviour is read out of the original executables and cited by address." },
  taoot: { name: "taoot", kind: "game", title: "Titanic: Adventure Out of Time (1996)", desc: "DreamFactory 4. The play page, developer mode (the 1996 debug build put back), free roam, captions, and Titanic's speedrun verbs and route navigation." },
  dust: { name: "dust", kind: "game", title: "Dust: A Tale of the Wired West (1995)", desc: "DreamFactory 1. The page, the disc as a file host, saves, the set walker, and Dust's speedrun verbs including the blackjack table." },
  timelapse: { name: "timelapse", kind: "game", title: "Timelapse: Ancient Civilizations (1996)", desc: "The third DreamFactory game. Four discs as one file host, its region navigation, and where-you-are tracking (it ships no .SET)." },
  redjack: { name: "redjack", kind: "game", title: "RedJack: Revenge of the Brethren (1998)", desc: "DreamFactory 5, the only game on it (Villains' Revenge shares the engine). Three discs as one host, input, touch in rooms, saves, and the RedJack.exe disassembler." },
  skullcracker: { name: "skullcracker", kind: "game", title: "Skull Cracker (1996)", desc: "Not a DreamFactory game: SC.EXE's own engine, ported as a tick machine. The world, its fighters and props, and one state machine per creature class (brains)." },
  lunicus: { name: "lunicus", kind: "game", title: "Lunicus (1994)", desc: "DreamFactory 0. The whole game machine-played: the moon base, the cities and their vehicles and weapons, on the shared v0 machine." },
  jumpraven: { name: "jumpraven", kind: "game", title: "Jump Raven (1994)", desc: "DreamFactory 0. The story, the Mart, the copilots and the flying, with every enemy class of the combat ported from RAVEN.EXE." },
  chrome: { name: "chrome", kind: "site", title: "Shared page chrome", desc: "What every page shares, the front page, the editors and the games alike: the top bar and its menus, the version, the registry of games, editions, the bug report, and every word in English and five translations. Structure only; each page brings its own palette." },
  speedrun: { name: "speedrun", kind: "site", title: "Speedrun workbench", desc: "The /speedrun/ page any game can carry: the sheet language, the run loop, the drivers that play a sheet in the page or headless, the aim sweep and the panel. A game brings its own verbs and a few facts about itself." },
  site: { name: "site", kind: "site", title: "Front page and editors", desc: "The front page with its own palette, and the browser editors and inspectors for each file format." },
  tools: { name: "tools", kind: "tools", title: "Repository tools", desc: "Command-line tools shared by the games: format dumpers, executable and resource readers, the manifest and release scripts, the speedrun sheet runner." },
};
/** what sits outside the code: who uses it, and what it reads */
export const EXTERNALS: Record<string, ExternalNote> = {
  player: { name: "Player", kind: "person", title: "Player", desc: "Someone playing one of the games, or using an editor, in a browser on a computer or phone." },
  gamefiles: { name: "Original game files", kind: "ext", title: "Original game files", desc: "The CD rips of each game. They are not in git; the pages read them from beside themselves through a manifest, and the machine suites read them from gamefiles/." },
  exes: { name: "Original executables", kind: "ext", title: "Original executables", desc: "TI.EXE, DF.EXE, tl.exe, RedJack.exe, SC.EXE, LUNICUS.EXE and RAVEN.EXE. The disassembly tools read them to settle what the port must do." },
  docs: { name: "docs", kind: "docs", title: "Documentation site", desc: "The VitePress site under docs/: file formats, runtime notes and the per-game write-ups the code comments link to." },
  ci: { name: "GitHub Actions + SonarCloud", kind: "ext", title: "CI and code analysis", desc: "Every pull request runs the full suites and a browser playthrough, and SonarCloud's analysis; the Browser suite runs nightly per game." },
};
/** every folder that holds source, by its path from the repository's root */
export const COMPONENTS: Record<string, string> = {
  "engine/src/df": "File formats: a reader, and for some a writer, for every DreamFactory file (scripts, sets and setts, casts, shops, stages, movies, sound banks, puppets, saves), per engine version.",
  "engine/src/runtime": "The game as it runs, with no browser: the script interpreter, the game session, actors, props, rooms, the scheduler, audio, saves and the debugger.",
  "engine/src/runtime/builtins": "The script commands, registered by family. Each answers as the original engine's handler does; the DreamFactory 5 ones are gated on v5.",
  "engine/src/v0": "DreamFactory 0, shared by Lunicus and Jump Raven: the 1/60 s tick machine, the screen, films and conversations.",
  "engine/src/web": "The browser side of the engine: the game host, screen director and presenter, the set viewer, the movie player, puppets, rooms and input, and what every game page shares: reading the rip by its manifest, the loading bar, the start button and the pointer.",
  "chrome/src": "The top bar and its menus (games, language, play), the version, the games registry, editions, the bug report and where a page sits in the deployed tree.",
  "speedrun/src": "The speedrun workbench: the sheet language and its parser, verbs that name no game, the run loop, the drivers that play a sheet in the page or headless, the aim sweep and the panel.",
  "chrome/src/locales": "Every word the pages say, in English and five translations.",
  "site/src": "The front page and its palette.",
  "site/editors": "The browser editors and inspectors, one per file format: sets, setts, casts, shops, stages, movies, puppets, tracks, books.",
  "site/tools": "Front-page artwork generation.",
  "taoot/src": "Titanic's pages: play, captions editor, developer mode page, the file store, languages and editions.",
  "taoot/bedsit/src": "The bedsit: a 3D room built from Titanic's art, its meshes, baked lighting and the chimneys outside.",
  "taoot/bedsit/tools": "Tools that build the bedsit's meshes, pictures and sky.",
  "taoot/minigames/src": "The three minigames on their own pages: the fight, the fencing bout and blackjack, and the chooser in front of them.",
  "taoot/src/devmode": "Developer mode: TI.EXE's debug menu, the script console and the deck map's hidden areas.",
  "taoot/src/freeroam": "Free roam: every door in the ship opened regardless of the story.",
  "taoot/src/speedrun": "Titanic's own speedrun verbs, its blackjack, and the headless calculator.",
  "taoot/src/speedrun/nav": "Route navigation for the hard places: dials, the wireless set, the false smokestack, the deck map.",
  "taoot/speedrun": "What Titanic's speedrun workbench page is made of: which nodes of the play page are the game, and the switches its head carries.",
  "taoot/tools": "Titanic tools: the mission flow graph, the debug census, door extraction, generated menus.",
  "dust/src": "Dust's page, disc host, saves and the set walker.",
  "dust/src/speedrun": "Dust's speedrun verbs, the blackjack table and the save/load menu on the clock.",
  "dust/speedrun": "What Dust's speedrun workbench page is made of: which nodes of the play page are the game, and the Details column it adds.",
  "dust/tools": "Dust tools: the golden thread, run sheets and set diagnostics.",
  "timelapse/src": "Timelapse's page, its four-disc host, region input and location tracking.",
  "timelapse/src/speedrun": "Timelapse's speedrun workbench entry and its verbs — the engine's core table, nothing of its own yet.",
  "timelapse/speedrun": "What Timelapse's speedrun workbench page is made of: which nodes of the play page are the game, and the Details column it adds.",
  "timelapse/tools": "Indexes of Timelapse's stage flats and shop props.",
  "redjack/src": "RedJack's page, its three-disc host, keys, room touch and saves.",
  "redjack/src/play": "How RedJack is played by machine, shared by the day suites and the speedrun: the route walker, the fights, the cannons and ballista, the mine, the gems and the lava.",
  "redjack/src/speedrun": "RedJack's speedrun verbs (talkOut by line ids, duels, the minigames), the page's player and each day's moves.",
  "redjack/speedrun": "What RedJack's speedrun workbench page is made of: which nodes of the play page are the game, and the Details column it adds.",
  "redjack/tools": "rjdis.mts (the RedJack.exe disassembler), the day saves and the logo.",
  "skullcracker/src": "What the world is built from, read out of SC.EXE: foes, props, guns, effects, fights, missions, sound, films, the HUD, saves and scores.",
  "skullcracker/src/world": "The game itself, headless: the world's state and its tick, split by subsystem (motion, camera, rooms, boxes, blows, shots, fixtures, scenery, enemies, contact, hurt, death, level, loop). index.ts is its entry.",
  "skullcracker/src/page": "The two pages: the menu and film front end (main.ts) and the level bench (walk.ts).",
  "skullcracker/src/brains": "One state machine per creature class, each ported from SC.EXE's think function, on a shared kit.",
  "skullcracker/tools": "scdis.mts (the SC.EXE disassembler), saved-game and sprite-book readers, the suite runner.",
  "lunicus/src": "Lunicus's page, the game that runs its days (lunicus.ts), the player's input, its menu bar and dialogs out of LUNIRES.DLL.",
  "lunicus/src/game": "The game machine: the moon base, the maze view and the panel.",
  "lunicus/src/game/city": "The city and building levels: vehicles, weapons, drones and the wasp.",
  "lunicus/tools": "ludis.mts (the LUNICUS.EXE disassembler) and the resource generators.",
  "jumpraven/src": "Jump Raven's page, the fair whole-game player and the dialogs out of RAVENRES.DLL.",
  "jumpraven/src/game": "The game machine: the story, the Mart, pilots, music and the flight.",
  "jumpraven/src/game/core": "What both the story and the flight build on: the machine the game runs on, the records a game keeps, and the comms box.",
  "jumpraven/src/game/combat": "The flight's combat: the Raven, the HUD, the copilot and every enemy class.",
  "jumpraven/tools": "rvdis.mts (the RAVEN.EXE disassembler), the Lunicus function matcher and generators.",
  "tools": "Shared tools: format dumpers, executable and resource readers, the manifest, release and sheet runners.",
  "tools/native-sprite": "Cases for checking the sprite scaler against a native recording.",
};