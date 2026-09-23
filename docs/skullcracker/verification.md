# How it is checked

The game is checked HEADLESS: the port's own game code, loaded in node on the
rip read from disk, stepped a frame at a time as fast as the CPU goes, and asked
directly what happened. Titanic keeps the same page under the same name
([How we know it's right](../taoot/verification.md)) and for the same reason:
"how was this checked?" is a headline question for a project like this, not
lookup material.

## The game has no page in it

`skullcracker/src/game.ts` is the whole game — the world's state, `tick()`, the
level loader, every class's machine — and it touches no DOM. `src/walk.ts` is
the page around it: the canvas, the drawing, the HUD, the keys, the films. The
two meet in a few places only:

- **the switches** — `?level=`, `?x=`, `?damage=` and the rest are read through
  one `QUERY`, which a headless run supplies as a string (`setQuery`);
- **the files** — `SkullFiles` reads the rip by `fetch` in a page and from disk
  headless (`SkullFiles.fromReader`), through the same manifest rules;
- **what only a page can do** — films, the status line, the level picker and
  the end of a game go through the `ui` hooks, which the page fills in and a
  headless run leaves as they are, so the game goes straight on past each one.

## The dice are the executable's

`src/random.ts` is `SC.EXE`'s own generator, `0x434560` — a lagged Fibonacci
table of 55 words — and every level reseeds it with the same constant as it
starts (`0x4036ff`), exactly as the original does. So the game is
deterministic: the same inputs from the same start give the same result every
time, and a suite asserts exact numbers — the walk is 180px a second, not
"about 180".

## Machine suites

`skullcracker/tests/machine/*.ts`, one per subject. Each stands the game up with
`headless(query)` from `tests/machine/harness.ts` — the same query string a URL
would carry — then holds keys the way the page's handler does
(`h.hold("right", true)`), steps engine frames (`h.frame(n)`, fifteen to a
second), waits on STATE rather than a clock (`h.until(done, maxFrames)`), and
reads the answer straight off `game.p`, `game.stats`, `game.spawnedHere()` and
the rest.

```
npm test -w skullcracker                              every suite
npx tsx tools/runmachine.mts speed foes               just these (from skullcracker/)
```

The runner gives each suite a process of its own — the game keeps its world in
module state, one per process — and runs several at once. The whole set takes
about twenty seconds; the browser suites it replaced took about an hour and
still needed a retry pass to tell flakes from regressions.

Two things carry across `h.load()` in one process, because the game carries
them from level to level: the score and lives (a suite that wants a clean start
passes `score=` and `lives=`, the game's own saved-game switches), and what the
player is holding.

## Page suites

What only a page can show stays in a browser: the front end's films and buttons
(`menu`), the touch pad (`pad`, `touch`) and the pause panel (`pause`), in
`skullcracker/tests/browser`, each a short check against the dev server.

```
npm run test:browser:all -w skullcracker
```

`tools/runsuites.mts` runs them in one process against one shared Chromium,
closes whatever a suite left open after it (`harness.sweep()`), and re-runs a
failed suite once in a fresh browser: passing the second time prints `FLAKE`,
failing twice is a `FAIL`.
