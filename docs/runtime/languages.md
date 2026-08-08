# Languages, and the chooser that is a stage

*Prerequisite: [The browser host](host.md) for the page and the file source;
[STG — stage files & the UI](../formats/stg.md) for what a stage is.*

*Titanic: Adventure Out of Time* was localised — English, German, French,
Russian, Dutch, Japanese. A localised version is not a translation layer over one
set of data: subtitles live inside the PUP files, voices are recorded audio, and
the scripts that reference them ship in the BOOTFILE, so a localised release is
**its own pressing of both CDs** carrying the same filenames. The port therefore
keeps one directory tree per language and decides, once, which one a name means:

```
gamefiles/en/titanic1/…   gamefiles/en/titanic2/…   gamefiles/en/save/…
gamefiles/de/titanic1/…   gamefiles/de/titanic2/…   gamefiles/de/save/…
```

The original had nothing to decide — you installed one language and that was the
game. **The chooser is this port's own addition**, and it is deliberately built
so that nothing in the engine knows about it: no new opcode, no new builtin, no
special case in the interpreter. What it *is* is an authored DreamFactory stage.

## Editions, not languages

A tree under `gamefiles/` is an **edition**: one pressing of the game. Six of them
are the six localisations, and an edition need not be a translation of anything —
`gamefiles/demo/` is the 1996 demo, the same shape of tree with different content
in it. "Language" was the wrong name for this axis as soon as that was true, and
the name it has now is what the code says: `?edition=`, `taoot.edition`,
`FileStore.setEdition`, `src/editions.ts`.

## Two selectors on one basename

Scripts ask for files by bare name (`opensetfile("gstair2.set")`), which has two
axes of ambiguity, not one:

| Axis | Why the same name repeats | Who selects |
|------|---------------------------|-------------|
| **Disc** | 93 basenames ship on both CDs — the public rooms once per act (before and after the sinking) | BOOTFILE's `setpath(disk)`, via the `onDiscChange` host hook. Which *directories* the two discs are is read from the same handler (`currentcd("Titanic1")`) rather than matched by name: a game with no `setpath` — the demo — has one volume and nothing is on a disc |
| **Edition** | every file exists once per edition tree | the chooser, the edition row, or `?edition=` — via `FileStore.setEdition` |

Both resolve the same way — an active selection, then a documented fallback:

- **Edition first, across both discs**, then the *edition-neutral* tree. An
  edition's disc-2 copy is a better answer than another edition's disc-1 one.
- **Neutral** means a path whose directory under `gamefiles/` is not a known
  edition code: a flat single-edition dump (the layout the tools were first
  written against), and this port's own authored assets. `lang.stg` is neutral of
  necessity — it has to load before there is an edition to load it from. Matching
  against the known codes is also what lets `demo/` be an edition at all: while
  the rule was "any two-letter directory", a tree named `demo` read as neutral and
  would have had its files offered under every edition at once.

Switching edition drops every cached file that came from an edition tree, and
keeps the neutral ones. Node-side, the same decision is one function:
`TAOOT_LANG`, else `en` when that directory exists, else walk the tree whole
(`tools/gamefiles.ts`) — it takes a directory name, so `TAOOT_LANG=demo` selects
the demo. Before the axis existed, an unset `TAOOT_LANG` merged *all* editions
into one basename map and picked a winner per name — a route could read German
scenery for one room and English for the next.

## The code page is not in the data

A language tree differs from another in one more way than which files it holds:
**its text is in a different character set, and no DF file says which.** Every
string in a DF container is a Pascal string of *bytes*. Reading them one byte to
one character is right for identifiers — prop names, idents, file names, all ASCII
— and wrong for anything a player reads: a subtitle byte of `0xA7` is `ß` in
German and `§` if you assume Latin-1, and a Japanese line is not single-byte at
all.

Nothing was found to read the answer out of. The container and dialogue-record
headers are byte-identical across all six trees apart from offsets and sizes;
there is no charset field and no font name. The original did it the 1996 way —
`TI.EXE` calls `CreateFontA(…, iCharSet = DEFAULT_CHARSET, …)` and `TextOutA`, and
imports `GetACP`, so the bytes are simply in whatever ANSI code page the host
Windows was running. The one visible trace of a localiser's decision is the font
**face**: every build asks for "Arial" except the Japanese one, which is a separate
binary asking for "mspgothic". A hint, not a declaration, and only for Japanese.

So the tree is the only thing left to ask, and the table lives next to the
languages themselves (`src/languages.ts`). Measured over all **52 puppet files per
tree**:

| Tree | Encoding | How it is told apart |
|------|----------|----------------------|
| en, de, fr, nl | **Mac OS Roman** | Latin with accents: `0xA7` `ß`, `0x9F` `ü`, `0x89` `â`, `0xD1` en-dash — and only 0.00–1.85% of dialogue bytes are high at all |
| ru | **Windows-1251** | 78.48% of dialogue bytes are high, and they are not legal Shift-JIS sequences |
| ja | **Shift-JIS (CP932)** | 78.33% high, and every one of them is part of a legal lead/trail pair (or half-width katakana) |

English is on that list deliberately. It has no accents, but its punctuation is
Mac curly quotes and dashes, so reading it as Latin-1 puts `Ñ` in the middle of
"the end of a world Ñ my world" in the credits. Mac OS Roman is the **default**
because DreamFactory was Mac authoring software: even the Windows-only French disc
carries Mac-encoded text, and the hybrid German and Dutch discs ship one shared
copy of the data that the Windows build renders slightly wrong.

**Where the decoding happens: where text stops being data.** Three places, and
deliberately not a fourth — the PUP dialogue field, and the two opcodes whose
argument is human text (`puppetbevel`, `drawstring`). Script **string pools keep
their bytes**, so a disassembly still round-trips. The session asks the file source
for the live language (`session.textEncoding()`) rather than being handed a value,
so a switch cannot leave it decoding the tree it used to be reading. All three
encodings agree with ASCII below `0x80`, which is what lets every identifier go on
being read a byte at a time.

**Line breaking had the matching assumption.** Splitting on `" "` gave a Japanese
subtitle one unbreakable 40-character word, which ran off both ends of the
subtitle band. `wrapText`
([`src/fonts.ts`](https://github.com/dhobi/taoot-web/blob/master/src/fonts.ts))
breaks between CJK characters as well as at spaces, and refuses to start a line
with closing punctuation (`。`, `？`, the small kana, the closing brackets) —
breaking before one of those is the one break that reads as broken rather than
merely tight. Both canvas font stacks (the subtitle serif and `drawstring`'s
monospace) fall through to a gothic for the same reason, in the original's own
order.

And **a line with no voice audio is paced by its byte count**, not its character
count: `raw.length / 15` seconds, minimum 1 s. That is what a 1996 `strlen()` saw,
and it is what stops a Japanese line — half as many characters as its English
original — being given half the time to be said.

The table is a claim about the data rather than something read out of it, and a
wrong entry does not fail, it mojibakes. So `tests/auto/text.ts` **re-derives every
entry** from the shipped puppet files by an independent sniff over their dialogue,
skips languages that are not installed, and fails if it ended up checking nothing.

## The chooser is `lang.stg`

The screen the player sees is a two-flat stage — `choose` and `wait` — built by
[`tools/mklangstg.ts`](https://github.com/dhobi/taoot-web/blob/master/tools/mklangstg.ts)
and shipped in `public/`, so it is served at `/lang.stg` in dev and bundled into a
production build. Nothing in it derives from the game's data (its own palette, its
own art drawn with a 5×8 pixel font, its own scripts), which is why it can live in
the repository while `gamefiles/` cannot.

Each language is a **click region** named for its directory, carrying a compiled
`mousedown` handler:

```
code mousedown()
	global taootlang
	taootlang = "de"
	gotoflat("wait")
endcode
```

That is real bytecode in the file — see
[writing a stage](../formats/stg.md#writing-a-stage) — and it runs in the
interpreter through the engine's ordinary stage click routing. The keyboard
shortcuts are the `choose` flat's own `keydown` handler (a `switch` over "1".."6"),
because a stage's keys go to its current flat when it has one.

Setting a global rather than calling something is the crux: **there is no builtin
for "pick a language"**, and inventing an opcode the 1996 engine never had would
make the file unopenable by anything but this port. So the script states the
choice and the host reads it back — `LangChooser.chosen()` in
[`src/lang-chooser.ts`](https://github.com/dhobi/taoot-web/blob/master/src/lang-chooser.ts).

Closing the chooser then **deletes** that global, which is not tidiness:
`snapshotSave` writes every script global into the `.ti`, and a base save has only
a handful of free variable slots and a finite string pool
([saving & loading](saves.md)) — the route has already had globals dropped for want
of one. A language choice belongs to the page, so it must not compete for that
space.

## What the host has to lend it

A stage normally borrows two things from the room behind it: something to draw it,
and something to deliver input. The chooser can't borrow either the usual way,
because `SetViewer` needs a SET — and every SET is inside a language tree, which
is the question this screen exists to answer. So it runs on an engine session with
nothing in it at all:

- **no set** — `setVisible` is off; the flat owns the whole 512×384 frame;
- **no BOOTFILE** — the boot library is per-language too, so the stage's scripts
  must stand alone (they do: `global`, an assignment, `gotoflat`);
- **no theme, no props, no cast**.

`openStageFile`, `stageClickAt`, `flatImage` and `keydownTarget` are all willing
to work in that state, which is what makes the whole approach possible. The page
supplies a small draw loop (`LangChooser.render`) and forwards pointer and key
events; that is the entire host side.

## Languages you don't have

The art has six buttons; an install may have two. The host reads the STG's **own
region rectangles** and dims the ones with no directory behind them, so the layout
lives in exactly one place — move a button in the stage editor and the dimming
follows it. A click on a dimmed button is refused before the script runs; a
*keypress* for one can only be undone after (the script has already set the global
and switched flat), so it is: clear the global, put the menu back.

## The order of operations

Nothing may be read from an edition tree before the choice is settled — the
32 MB of boot resources most of all, since `bootfile` and `main.stg` are
per-edition. So `main.ts` does, in this order:

1. fetch `gamefiles.json`, register every path (bucketed by edition and disc),
   and register `/lang.stg` as neutral;
2. resolve the edition: `?edition=` → `localStorage` → the chooser — and skip the
   screen entirely when the install offers only one edition, because that is not
   a choice worth a screen;
3. `FileStore.setEdition(code)`, and mark that edition on the page's own row;
4. read this game's **volumes** out of its BOOTFILE and hand them to
   `FileStore.setVolumes`, which re-indexes every registered path by disc. The
   order is forced and harmless: the volume names live in the BOOTFILE
   ([the boot plan](host.md#the-boot-plan-what-a-game-says-it-needs)) and the
   BOOTFILE is one of the files being registered, so nothing can know them during
   registration — until this runs, every path indexes as disc 1, which is where
   `bootfile` genuinely is on every multi-CD title. So the one lookup that has to
   work before the answer is known is the lookup that fetches the answer. It has
   to come after step 3 too, since the plan must come from the tree that is about
   to boot;
5. **then** warm the boot resources and seed the shipped saves.

The `wait` flat is what the player looks at during step 5, which is why the
chooser holds the screen until the resources land instead of flashing the landing
page over its own "loading" art.

## The shipped saves follow the edition

`gamefiles/<edition>/save/` holds each tree's own copies of the shipped saves, at
the same relative paths (`1/`, `2/`, `ENDGAME1/`, `ENDGAME2/`) with localised names
inside. The IndexedDB store therefore holds **one edition's** shipped saves at a
time: switching replaces them rather than merging, and a marker records which is
in there. Player-made saves are untouched.

## Escape hatches

| You want | Do this |
|----------|---------|
| skip the screen | `?edition=de` — a link carries it, and it is remembered |
| change your mind | the **Edition** row on the play page, the editors and the collection ([`src/editions.ts`](https://github.com/dhobi/taoot-web/blob/master/src/editions.ts)) — one choice, carried between all three. Switching is a reload on the two that have read data: a live session is holding boot scripts, shops and sound banks from the edition being left |
| a different page language | the 🌐 dropdown in the top bar, which is that and nothing else ([`src/lang-menu.ts`](https://github.com/dhobi/taoot-web/blob/master/src/lang-menu.ts)) |
| pin it for tests | `TAOOT_LANG` (Node), which the browser suites pass through as `?edition=` |
| rebuild the stage | `npm run mklang` — then, if you like, restyle it in [the stage editor](../editors/stages.md) |

## The pages' own language

Everything above is about the **game's** text, which CyberFlix already translated
six ways and which this port only has to decode. The port's own chrome — the top
bar, the front page, the boot notice, the editors' furniture — is a separate
problem with a separate answer in [`src/locales/`](https://github.com/dhobi/taoot-web/blob/master/src/locales/en.ts),
and, deliberately, a **separate setting**.

Separate because which editions an install carries is a fact about the reader's
disc rather than about the reader: someone with the English pressing who reads
German would be locked out of a German page forever if the two were one control.
And the reverse is just as wrong — a reader who wants to see the German box, or
play the demo, has not asked for a German site.

So the two axes are two controls, and each owns its own parameter and its own
storage key:

| | The **UI language** | The **edition** |
|---|---|---|
| what it changes | the words on every page | what a page's content is read from |
| control | the 🌐 dropdown in the top bar, on all eleven pages | the button row on Play, the Editors and the Collection |
| parameter / storage | `?lang=` / `taoot.lang` | `?edition=` / `taoot.edition` |
| the list | the six the site is translated into, always | the editions that page can actually offer |
| module | `src/lang-menu.ts` | `src/editions.ts` |

Neither writes the other's key. The page's language resolves as `?lang=`, then
`taoot.lang`, then the browser's own preference, then English (`?uilang=` and
`taoot.uilang` are still read: they are what this parameter was called for the few
weeks the two axes were one). The edition resolves as `?edition=`, then
`taoot.edition`, then — and this is the one place they touch — **the reader's UI
language, where that edition exists**. That default is what keeps two controls
from reading as two chores: a German reader gets the German game without being
asked, and the moment they pick an edition the two part company for good.

On the page that BOOTS one, the authored chooser still has the last word on a
first visit: the row above the stage is drawn before the boot resolves, so what it
marks afterwards is what the game actually opened. The chooser can only offer what
its art has buttons for — the six languages — so an edition outside that (the
demo) is reached from the row or from `?edition=`.

The English lives **twice**: inline in the ten HTML files, so that an English
reader needs no JavaScript and a `git diff` still shows the sentence that changed,
and again in `src/locales/en.ts`, so that a translator has a list and the
translations have a shape. Two copies of a string is normally a bug waiting to
happen; what makes it safe here is `tests/auto/locales.ts`, which parses the
markup and fails if the two ever disagree by so much as a word. It also refuses a
key no page uses, a value with markup in it that is written as text, an HTML value
using a tag outside the allowlist, and a language directory added without being
registered.

Two things are deliberately **not** translated. The documentation you are reading
— and the strings the editors *build* rather than declare. Everything the ten HTML
documents say is translated, down to the panel headings and the tooltips; what is
still English is the text the seven tool modules compute, like "3 flats" or
"(container does not decode as a script)". The reason is grammatical rather than
budgetary: 45 of those strings choose a plural with `n === 1 ? "" : "s"`, which is
English written into the source, and Russian needs four forms where that offers
two. They can be translated as soon as `t()` can select a plural — `Intl.PluralRules`,
no dependency needed — and not before, or five languages inherit English grammar.

The words that name a byte stay put in every language: `x`, `y` and `k` are axis
and scale notation, `actionframe(1)` and `propdeg()` are engine calls, `MAIN.STG`
is a filename. A translation that localised those would be describing a different
program.

A translation is a directory of JSON — one file per namespace, which is the unit
a translator or a translation-management system reads and returns — plus an
`index.ts` that assembles them and holds the result to `Catalogue`, so a missing
key is a compile error rather than a blank label. All five are present.

They are **machine translations, unreviewed by a native speaker**, and the risk
in them is not the prose but the vocabulary: `set`, `flat`, `shop`, `puppet` and
`cast` are DreamFactory's words before they are English ones, and each language
had to decide whether to translate the concept or keep the format's name. The
choices are visible in one place per language (`<code>/editors.json`), which is
where to start if a term reads wrong.

Japanese needed two things beyond the words. The display face is Georgia, which
carries no CJK at all, so both stacks in `src/theme.css` now end in the same
families [`src/fonts.ts`](https://github.com/dhobi/taoot-web/blob/master/src/fonts.ts)
hands the canvas — page and game text agree on a face instead of each falling
through to a different generic. And the sheet's tracking, which is what makes a
spaced small-caps line read as a label, does the opposite to kana: a `:lang(ja)`
rule at the end of the sheet takes it back off. Cyrillic keeps it, wanting the
same treatment Latin does.

## What has not been tested

The chooser and the two selectors are exercised by `npm test` (three suites, no
game data needed) and were watched end to end in a real browser — but against a
**synthetic** second language tree, so what those runs prove is *which files get
asked for*.

The **data** is a different matter now: real trees for all six languages have been
read by this port's own code, which is where the encoding table and the mixed
sample rates came from. That is 52 puppet files and every loop chunk per tree, not
a boot. What has still not happened is **playing** a localised pressing: nobody has
booted the game in German, French, Russian, Dutch or Japanese and walked around in
it. Four specific things a real second pressing could break, none of which the
synthetic tree exercises: the localised discs might not use the same **basenames**
(the lookup is case-insensitive and per-disc, so `BEDSIT1.SET` vs `bedsit1.set` is
handled, but a renamed room file would miss); `save/` might not be called `save/`,
in which case nothing seeds and the save browser is empty, which looks like a bug
and isn't; a tree missing `LOCAL/BOOTFILE` fails at the cold boot rather than at the
chooser, so the error points at the wrong place; and voice/subtitle pacing differs
per language. `npm run test:browser:lang` settles the first three and needs two or
more real trees — it skips with a reason when the install has only one.
Voice and subtitle *pacing* is no longer only-English by assumption — a
missing-audio line is paced by its stored byte count for exactly that reason — but
it has not been watched in another language either.

Next: the people — **[Characters at runtime](characters.md)**.
