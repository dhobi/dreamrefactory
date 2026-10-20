# Speedrun sheets

Run sheets for *Timelapse: Ancient Civilizations*, contributed by pull request. Each one appears in the speedrun workbench under **Contributed sheets…**, where anyone can copy it and play it or change it.

## Adding a sheet

1. Write and test your route in the workbench (`/timelapse/speedrun/`). `SHEET=timelapse/speedrun/sheets/<file> npm run speedrun -w timelapse` plays it headless and tells you its in-game time, or the line it stops at.
2. Save it here as `<something>.sheet.txt`: lowercase, words joined with `-`, for example `any-percent.sheet.txt`.
3. Open a pull request with that one file.

## The header

The **first line must be the title**. Everything else is optional and goes in the comment lines before the first action:

```
# title: Any% — seed 360
# author: your name or GitHub handle
# notes: one line about the route
reset(seed: 360)
...
```

| Key | | |
|---|---|---|
| `title` | required, line 1 | the name shown in the workbench's list |
| `author` | optional | shown after the title |
| `notes` | optional | shown when you hover over the sheet in the list |

Any other comment is just a comment.

## Where you are, in this game

Timelapse has no rooms: every picture is a stage's flat. So a sheet's idea of "the world moved" is the stage and the flat on screen changing, and "settled" is the game's own idle (the world on screen, nothing running but the idle loop). The arrows and a click on a named region (`click(down)`) work as they do in the other games.

## What the check does

Nothing yet. Dust and Titanic have a CI check that plays every sheet in their folder to its last line; Timelapse does not have one. Until it does, play your sheet headless with the command above before you open the pull request, and say in it that it finishes.

A sheet that starts with `reset(seed: N)` is one run on that seed. A seeded time is its own category and is not compared with unseeded ones.
