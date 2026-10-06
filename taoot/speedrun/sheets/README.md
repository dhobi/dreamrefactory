# Speedrun sheets

Run sheets for *Titanic: Adventure Out of Time* (the English edition, which the workbench plays), contributed by pull request. Each one appears in the speedrun workbench under **Contributed sheets…**, where anyone can copy it and play it or change it.

## Adding a sheet

1. Write and test your route in the workbench (`/taoot/speedrun/`). **Calculate** plays it headless and tells you its in-game time, or the line it stops at.
2. Save it here as `<something>.sheet.txt`: lowercase, words joined with `-`, for example `any-percent-glitchless.sheet.txt`.
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

## What the check does

CI plays every sheet in this folder to its last line, headless, on the same clock as **Calculate**. The pull request fails if a sheet:

- has no `# title:` on line 1;
- does not parse (the error names the line);
- stops before its last line (the error names the line and the in-game time it got to).

A sheet that starts with `reset(seed: N)` is one run on that seed. Without it, the sheet is played on three seeds and must finish on each, because an unseeded route has to survive the dice. A seeded time is its own category and is not compared with unseeded ones.

The times are listed in the job summary of the check.

## For maintainers: a pull request from a fork

The check needs the game files, and the CI job that has them never runs a fork's pull request: a sheet's conditions are compiled to JavaScript, so a sheet is code on that machine. Read the sheet, then push it to a branch of this repository so the check plays it:

```
gh pr checkout <number>
git push origin HEAD:sheet/<number>
```

The check's result shows on that branch's run; merge the original pull request once it is green.
