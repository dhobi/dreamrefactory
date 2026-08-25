/**
 * Every word the eleven pages say, in English — the source of truth the five
 * translations are checked against.
 *
 * This is the port's OWN chrome, not the game's. The game's text lives in the
 * DreamFactory files and is already translated six ways by CyberFlix
 * (engine/src/df/text.ts reads it, taoot/src/languages.ts says in which code page); nothing
 * here goes near it. What is here is the topbar, the front page, the boot
 * notice, and the editors' furniture — text this repository wrote, which
 * therefore only exists in the language it was written in until someone
 * translates it.
 *
 * ## Why English is in two places
 *
 * The English strings below are also sitting inline in the ten HTML files,
 * because a page whose copy is readable in its own source is worth more than
 * one saved duplication: English readers get the text with no JavaScript, no
 * fetch and no swap, and `git diff` on index.html still shows the sentence that
 * changed. The runtime (./index.ts) therefore does nothing at all when the page
 * language is English.
 *
 * The duplication is held together by site/tests/locales.ts, which parses the
 * markup and asserts every string here is character-for-character what the page
 * says. Edit one side without the other and the suite fails — which is the only
 * reason it is safe to have two copies.
 *
 * ## Two kinds of value
 *
 * `text` values are written to `textContent` and cannot contain markup.
 * `html` values are written to `innerHTML`, because the sentence has a `<code>`
 * or a link inside it that no amount of key-splitting improves. The test
 * enforces the tag allowlist and checks that a translation has not invented or
 * broken a link — see ALLOWED_TAGS there.
 *
 * ## What is deliberately NOT here
 *
 * **The strings TypeScript builds.** Everything the ten HTML documents say is
 * below; everything the editors *compute* — "3 flats", "no scripts in this set",
 * "(container does not decode as a script)" — is still English in the seven
 * tool modules. That is not squeamishness about the work: 45 of those strings pick a
 * plural with `n === 1 ? "" : "s"`, which is English grammar written into the
 * source, and Russian needs four forms where that offers two. They can be
 * translated once {@link t} can select a plural (`Intl.PluralRules`, no
 * dependency); doing it before then would bake the wrong grammar into five
 * languages.
 *
 * **The words that name a byte.** `x`, `y` and `k` are axis and scale notation,
 * `actionframe(1)` and `propdeg()` are engine calls, `.SHP` and `MAIN.STG` are
 * filenames, and "Titanic — Adventure Out Of Time RE" is a product. They read
 * the same in all six languages and are left alone on purpose; a translation
 * that localised them would be describing a different program.
 *
 * The front page's own heading is the exception, and not a contradiction of it:
 * the game itself was pressed under a different name in each language, so the
 * name on the box is what `home.h1` says (see its doc comment).
 */

/** a string written to `textContent` */
type Text = string;
/** a string written to `innerHTML` — see the tag allowlist in the test */
type Html = string;

/**
 * A counted string, in as many forms as the language has.
 *
 * `other` is the only one every language uses, so it is the only one required —
 * Japanese writes nothing else, English adds `one`, Russian adds `few` and
 * `many`. Which form a given count reads is `Intl.PluralRules`' business, not
 * ours (site/src/locales/index.ts); ours is only to supply the forms, and the test
 * holds each language to exactly the set that `Intl.PluralRules` reports for it.
 */
export type Plural = {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

/** what a catalogue entry can be: one string, or a set of counted forms */
export type Value = string | Plural;

export const en = {
  /**
   * The topbar, which every one of the eleven pages carries. The brand itself —
   * "Titanic", "Adventure Out Of Time RE" — is this port's name for itself and
   * stays put in all six languages; only the tooltip explaining what RE means is
   * text. The front page's `h1` is the *game's* name and does translate, which is
   * why the two now differ outside English (`home.h1`).
   */
  site: {
    brandTitle:
      "RE — reverse-engineered: a best-effort re-implementation of the DreamFactory engine, not the original 1996 release" as Text,
    navPlay: "Play" as Text,
    navEditors: "Editors" as Text,
    navCollection: "Collection" as Text,
    navDocs: "Docs" as Text,
    navSource: "Source" as Text,
    /** the label on the edition row — the play page, the editors and the
        collection all carry the same control (taoot/src/editions.ts), so they carry the
        same word for it */
    editionLabel: "Edition" as Text,
    /* The editors' row lists a GAME and an edition — "Dust", "Titanic ·
       Deutsch" — so "Edition" would name half of what it offers. Titanic's own
       play and collection pages still use `editionLabel`, where an edition is
       genuinely all it is. */
    sourceLabel: "Source" as Text,
  },

  /** site/index.html — the project's front door: what this is, and four ways in */
  front: {
    docTitle: "dreamREfactory — the CyberFlix DreamFactory engine, reimplemented" as Text,
    tagline: "the CyberFlix DreamFactory engine, reimplemented" as Text,
    lede: "CyberFlix built an engine, and <b>three</b> adventures shipped on it — two of them CyberFlix's own, the third GTE Interactive Media's. dreamREfactory is that engine written again in TypeScript, from the files rather than from the source — every container format decoded, the script language parsed and interpreted, and the games played in a browser with nothing installed. <b>All three are here.</b>" as Html,
    titanicBody: "The full game in six languages, plus the 1996 demo. A save browser, a language chooser, and the collection page for the physical release." as Text,
    dustBody: "The engine two years earlier, and a different shape of file. Opens on its films; the town is walkable. Smaller, and growing." as Text,
    timelapseBody: "Four discs and no rooms at all — a world of stage flats, navigated by the shape of the cursor. Opens on its film; the first world is walkable. Newest, and least finished." as Text,
    docsTitle: "Documentation" as Text,
    docsMeta: "formats · runtime · reference" as Text,
    docsBody: "How the engine works, container format by container format, and how each was recovered. The long half of this project." as Text,
    editorsTitle: "Format editors" as Text,
    editorsBody: "Open a room, a prop, a film or a stage out of the game data, look at what is inside it, change it and write it back." as Text,
    caveat: "RE is for reverse-engineered. This is a best-effort re-implementation and not a re-release: it needs a copy of the game's own data files, which it does not supply, and it is not affiliated with CyberFlix, GTE Entertainment or any current rights holder." as Text,
  },

  /**
   * index.html — what this is, and one way in.
   *
   * `h1` is the one place the game's title is not the English one: the 1996
   * release was pressed under a name per language ("Wettlauf gegen die Zeit",
   * "Une aventure hors du temps" — taoot/src/collection.ts's `RELEASE_TITLE` has the
   * set), and a reader of that edition should see the name on the box they own,
   * with this port's `RE` on the end. `Titanic:` comes off the front because the
   * topbar is already saying it two lines above.
   */
  home: {
    docTitle: "Titanic - Adventure Out Of Time RE" as Text,
    h1: "Adventure Out Of Time RE" as Text,
    intro:
      '<b>RE</b> is for reverse-engineered. This is not an emulation: it is a version of CyberFlix\'s DreamFactory engine implemented in JavaScript (TypeScript). Most of it already works, but this version is nowhere near the maturity of the original engine.<br>Play around, try the <a href="../editors/">editors</a> and report bugs straight to us on <a href="https://github.com/dhobi/dreamrefactory/issues/new">GitHub</a>.' as Html,
    play: "Play" as Text,
    playNote: "Get straight to it!" as Text,
    /** the small print at the foot of the page: what this port stands on */
    credits:
      'Made possible by <a href="https://github.com/M3tox/DFET">DFET</a> by M3tox — built with the support of Claude Opus and Claude Fable.' as Html,
  },

  /** play/index.html — the framebuffer, and what stands there until it draws */
  play: {
    docTitle: "Play — Titanic - Adventure Out Of Time RE" as Text,
    h1: "Starting" as Text,
    intro: "Loading the game's files…" as Text,
    introSub: 'Looking in the <code>gamefiles/</code> directory' as Html,
    keys:
      "<b>←</b> <b>→</b> turn &nbsp;·&nbsp; <b>↑</b> walk &nbsp;·&nbsp; <b>Esc</b> skip line &nbsp;·&nbsp; <b>M</b> map &nbsp;·&nbsp; <b>O</b> hotspots &nbsp;·&nbsp; <b>X</b> details &nbsp;·&nbsp; <b>0</b>–<b>9</b> sound &nbsp;·&nbsp; <b>F1</b> <b>F2</b> brightness" as Html,
    fullscreen: "⛶ Fullscreen" as Text,
    fullscreenTitle: "Fullscreen (letterboxed 4:3)" as Text,
    reportBug: "🪲 Report a bug" as Text,
    reportBugTitle: "Report something the port gets wrong" as Text,
    // what became of the screenshot the button took. GitHub accepts no image in
    // a prefilled issue URL, so the clipboard is the only way one gets there —
    // and a browser that will not take an image gets told to attach the file.
    bugShotClipboard: "The screen is on your clipboard — paste it into the issue." as Text,
    bugShotFile:
      "Your browser would not copy the screen, so it was downloaded — attach the PNG to the issue." as Text,
    // the two swipe options, which only a touch device is shown (taoot/src/main.ts).
    // Their default is the arrow keys' own reading — the swipe points where you
    // go — and each box flips one axis.
    swipeLabel: "Swipe" as Text,
    swipeInvertTurn: "invert left/right" as Text,
    swipeInvertTurnTitle: "a swipe from right to left turns right, not left" as Text,
    swipeInvertWalk: "invert forward" as Text,
    swipeInvertWalkTitle: "a swipe downwards walks on, not one upwards" as Text,
    pictureLabel: "Picture" as Text,
    // how a move lands on a standpoint (#75). The original's four-way asymmetry
    // is the default; the other three are one reading each of "the same
    // everywhere".
    landingLabel: "landing" as Text,
    landingTitle:
      "The game ships each standpoint twice, sharp and soft, and the original " +
      "shows the soft one for a moment as a right turn lands — a left turn and a " +
      "walk land sharp. The other three give every direction the same landing. " +
      "The movement itself stays soft whichever you pick: no sharp version of the " +
      "moving frames was ever made." as Text,
    landingOriginal: "original" as Text,
    landingSharp: "always sharp" as Text,
    landingTransition: "always transition" as Text,
    landingSoft: "always soft" as Text,
    brightnessLabel: "Brightness" as Text,
    brightnessTitle:
      "The original brightens every colour before it draws it, and lets you move " +
      "that with Ctrl+F1 and Ctrl+F2 — F1-F9 here, which also trim the colour " +
      "channels one at a time. These three are the same setting for a screen with " +
      "no keyboard, six keypresses either side of what the game ships with." as Text,
    brightnessDarker: "darker" as Text,
    brightnessOriginal: "original" as Text,
    brightnessBrighter: "brighter" as Text,
    // how fast the player's OWN moves animate (#222). `original` is the rate
    // measured out of TI.EXE (#205) and the default; the row exists because 20
    // fps of low-res transition makes some players motion-sick, and the
    // original's own `framerate(0)` — "don't wait" — is what `instant` is.
    movementLabel: "Movement" as Text,
    movementTitle:
      "How long each frame of a turn or a walk is held — your own moves only, " +
      "never the ones a script makes for you. The original holds a frame for 50 " +
      "ms and that is what `original` is; the others are the same move played " +
      "out slower or faster, over the same frames. `instant` holds none of them: " +
      "the picture goes straight to where you are standing next, which is the " +
      "setting to reach for if the movement makes you queasy." as Text,
    movementSlow: "slow" as Text,
    movementOriginal: "original" as Text,
    movementFast: "fast" as Text,
    movementInstant: "instant" as Text,
    // the small game a 1996 machine got — the game's own scripts do all of it
    // (GameSession.lowMemory), so the row is named for the CONDITION rather than
    // for the result, which is the game's answer and not ours
    lowMemoryLabel: "Low memory" as Text,
    lowMemory: "the reduced 1996 mode" as Text,
    lowMemoryTitle:
      "A machine with under 6 MB of memory got a smaller game, and the game's " +
      "own scripts decided that: the half-length deck and sinking themes, and no " +
      "crowd around you on the boat deck. Tick this to hear that version. It " +
      "takes effect in the next room." as Text,
    // The state list in the details pane (#22). Its CONTENTS are never
    // translated — `neckphase 4` is a name out of the game's own tables and the
    // same sentence in six languages — so only the words around it are here.
    // The pane's own heading, which is also its drag handle on the workbench
    // page (taoot/src/speedrun-columns.ts). "Details" because that is what the key row
    // above calls it — `X details`.
    debugHeading: "Details" as Text,
    debugState: "state" as Text,
    debugStateTitle:
      "Every script global, and the six the game's own debug readout names" as Text,
    debugAll: "all" as Text,
    debugAllTitle: "Every global, not just the ones that have just moved" as Text,
    debugFilter: "filter" as Text,
    debugCopy: "⧉ Copy details" as Text,
    debugCopyTitle: "Copy the state and the whole log, to attach to a bug report" as Text,
    debugCopied: "State and log copied — paste them into the issue." as Text,
    debugSaved: "Your browser would not copy, so the details were downloaded instead." as Text,
    // no key for the modal's heading: save-browser.ts always overwrites it with
    // "Load Game" or "Save Game", so the "Saved Games" in the markup is never
    // read. It gets translated when the TypeScript strings do.
    savesClose: "Close" as Text,
    savesNamePlaceholder: "save name" as Text,
    savesSave: "Save" as Text,
    savesUpload: "⬆ Upload .ti" as Text,
  },

  /**
   * collection/index.html — the physical release: box and disc art for the
   * five pressings that have any, the German booklet, and how to run the 1996
   * DOS original itself under DBGL. `taoot/src/collection.ts` turns the box and
   * swaps the edition; the six face-button labels are here rather than
   * computed because they are fixed regardless of which edition is mounted,
   * and the booklet's two arrow buttons for the same reason.
   *
   * What is NOT here, on purpose: the five endonyms in the edition picker
   * (English, Deutsch, Français, Nederlands, 日本語) are the same word this
   * port's own language menu already shows for those codes, not a sentence
   * this page wrote — taoot/src/collection.ts reads them off taoot/src/languages.ts. The
   * release titles ("Wettlauf gegen die Zeit", …), the seven archive
   * filenames and their printed sizes are the game's own names and numbers,
   * the same kind of thing `.SHP` and `1.1 GB` are — they live in the markup
   * and in taoot/src/collection.ts's own table, never in a catalogue.
   */
  collection: {
    docTitle: "Collection — Titanic - Adventure Out Of Time RE" as Text,
    h1: "The Collection" as Text,
    intro:
      "Here you will find scanned and published material about the game. At the bottom of the page are the archives that let you play it offline in several languages (DOSBox)." as Text,
    faceFront: "Front" as Text,
    faceBack: "Back" as Text,
    faceLeft: "Left spine" as Text,
    faceRight: "Right spine" as Text,
    faceTop: "Top" as Text,
    faceBottom: "Bottom" as Text,
    bookletHeading: "The booklet" as Text,
    bookletIntro:
      "Folded into the box was a 32-page booklet: the manual, the controls, and several pages of period detail about the ship. Only the German one was ever scanned, so this is the one edition that has it. Click either half to turn a page." as Text,
    bookletPrev: "Previous pages" as Text,
    bookletNext: "Next pages" as Text,
    bookletNone: "This pressing's booklet was never scanned — only the German one is here." as Text,
    offlineHeading: "Play it offline" as Text,
    offlineIntro:
      "The 1996 game, not this port: the original DOS executable, run through DOSBox behind a front end that manages the setup. Four steps get it running." as Text,
    step1:
      'Download and install <a href="https://dbgl.org/">DBGL</a> (DOSBox Game Launcher) — a front end for DOSBox.' as Html,
    step2: "Download one of the archives below. Do not unzip it — DBGL does that itself." as Text,
    step3: "In DBGL, choose Profiles → Import… and pick the file you downloaded." as Text,
    step4: "Select the imported profile and press Play." as Text,
    archivesHeading: "The archives" as Text,
    rightsNote:
      'Nightdive Studios is the publisher of Titanic: Adventure Out Of Time; the English version is sold on <a href="https://www.gog.com/game/titanic_adventure_out_of_time">GOG</a>. The other languages have never been re-released.' as Html,
  },

  /**
   * The editors: the landing page in full, and then the chrome the seven tools
   * share. `openBtn` differs per tool because it names the extension; the drop
   * note, the close button and the section headings are one string each because
   * all seven say the same thing.
   */
  editors: {
    docTitle: "File Editors — Titanic - Adventure Out Of Time RE" as Text,
    h1: "File Editors" as Text,
    intro:
      "Ever wondered how the game's own files are put together? Have a look for yourself! The editors also let you change files and export them again. Always dreamt of an edition in Portuguese or Chinese? Now is your chance!" as Html,
    note: "On every page you can look at the files that are already there. Uploading a file the DreamFactory engine can read is possible too." as Html,

    // the seven cards on the landing page
    puppetsWhat: "Puppet Editor" as Text,
    puppetsWhy: "The layered talking-head close-ups: stance art, anchors, subtitle text." as Text,
    castsWhat: "Cast Editor" as Text,
    castsWhy:
      "The bodies drawn in the room — poses as a step × direction grid, walk cycles at the engine's cadence." as Text,
    setsWhat: "Set Editor" as Text,
    setsWhy:
      "The pre-rendered rooms you walk between: scenes, views, hotspots, roads and actor marks." as Text,
    shopsWhat: "Shop Editor" as Text,
    shopsWhy:
      "The props drawn on top of a room — named states, their frames, and where each frame lands." as Text,
    stagesWhat: "Stage Editor" as Text,
    stagesWhy:
      "The screens that are not rooms: the UI band, the inventory, the deck plan, a mini-game board." as Text,
    moviesWhat: "Movie Editor" as Text,
    moviesWhy:
      "Cutscenes and close-ups — not video but a state machine of frames, each acting or waiting on a click." as Text,
    tracksWhat: "Track Editor" as Text,
    tracksWhy:
      "The audio banks: play a theme and its one-shot sounds, reorder the chunks it loops through." as Text,

    // shared by all seven tools
    dropNote: "or drop a file anywhere on this page" as Text,
    close: "✕ Close" as Text,
    scriptsHead: "Scripts" as Text,
    scriptsReadOnly: "decompiled, read-only" as Text,
    paletteHead: "Palette" as Text,
    // the panel furniture the tools share: the two PNG buttons that every
    // picture-bearing editor carries, and the field labels repeated across them
    exportPng: "⬇ Export PNG" as Text,
    replacePng: "⬆ Replace with PNG…" as Text,
    name: "name" as Text,
    filter: "filter" as Text,
    storedOffsetY: "stored offset y" as Text,
    framesHead: "Frames" as Text,
  },

  /**
   * The seven tools, one group each: the document title, the heading, the
   * sentence under it that says what the format is, and the two buttons that
   * name the extension.
   */
  puppets: {
    docTitle: "Puppet Editor — Titanic - Adventure Out Of Time RE" as Text,
    h1: "Puppet Editor" as Text,
    intro:
      "Load a DreamFactory <b>.PUP</b> conversation puppet — the layered talking-head close-ups (<code>SMETH1.PUP</code>, …). Browse and edit its parts — stance art, anchors, subtitle text — then export the repacked file." as Html,
    open: "📂 Open a .pup file…" as Text,
    export: "⬇ Export .pup" as Text,
    closeTitle: "Close this puppet" as Text,
    previewHead: "Preview" as Text,
    stance: "stance" as Text,
    line: "line" as Text,
    playLine: "▶ Play line" as Text,
    previewNote:
      "The composite of the selected stance in the selected line's opening pose. <b>Play line</b> runs the line's animLogic (lip sync, blinks) with its voice audio." as Html,
    stanceLayersHead: "Stance layers" as Text,
    anchorX: "anchor x" as Text,
    dialogueHead: "Dialogue" as Text,

    fileStats: "{containers} containers · {lines} dialogue lines · {scripts} scripts · {stances} stances ({frames} frames)" as Text,
    frameInfo: "<b>{layer}</b> frame {i}, container @{loc} — {w}×{h}px, {bytes} bytes packed" as Text,
    frameNotDecodable: "container @{loc}: not decodable as a frame" as Text,
    artEdit: "art @{loc} ← {file}" as Text,
    artReplaced: "replaced frame @{loc} with {file} ({w}×{h})" as Text,
    dlgInfo: "{n} lines — text is editable (255 chars max)" as Text,
    playThisLine: "select this line in the preview and play it" as Text,
  },

  casts: {
    docTitle: "Cast Editor — Titanic - Adventure Out Of Time RE" as Text,
    h1: "Cast Editor" as Text,
    intro:
      'Load a DreamFactory <b>.CST</b> cast — the <b>bodies</b> of the characters, the sprites drawn in the room while the <a href="./puppets.html">puppet editor</a>\'s <b>.PUP</b> holds their brains. <code>GANG.CST</code> is the 25 named story characters, <code>EXTRA.CST</code> the background passengers. Browse every member\'s poses as a step × direction grid, walk a cycle at the engine\'s cadence, rename members and poses, move a sprite\'s anchor, replace art via PNG round-trip — then export the repacked file.' as Html,
    open: "📂 Open a .cst file…" as Text,
    export: "⬇ Export .cst" as Text,
    closeTitle: "Close this cast" as Text,
    memberPoseHead: "Member & pose" as Text,
    member: "member" as Text,
    walkCycle: "▶ Walk the cycle" as Text,
    walkCycleTitle: "cycle this pose's steps at the engine's 50 ms tick" as Text,
    previewNote:
      "An actor is a <b>world-space</b> sprite: it draws at its projected world point minus its stored offset, both scaled by <code>k = actorscale × refScale / (1000 × depth)</code>. The cross is the world point; <b>k</b> is that scale, so 0.5 is roughly twice as far away." as Html,
    posesHead: "Poses" as Text,
    spritesHead: "Sprites" as Text,
    spriteAnchorNote: "— the point the sprite hangs off, scaled with it" as Text,

    previewHead: "<b>{name}</b> · pose “{pose}” · step {step}/{steps} · direction {dir} ({compass})" as Text,
    previewContainer: " · container @{loc}" as Text,
    previewSize: "<br>{w}×{h}px, stored offset {y},{x} (y,x)" as Text,
    previewPacked: "<br>{bytes} bytes packed · angle {angle}/256 · refScale {ref}" as Text,
    previewDrawn: "<br>at k={k}: drawn {w}×{h}px, top-left {x},{y}" as Text,
    previewNotSprite: "<br>this container does not decode as a sprite" as Text,
    previewNoSprite: "<br>this step has no sprite for that direction" as Text,
    noPoses: "this member has no poses" as Text,
    singleStepNotCycle: "this pose is a single step — a stand, not a cycle" as Text,
    fileStatsTail: "{poses} poses · {frames} sprite references" as Text,
    memberNameTitle: "the member's name — what actorpose/sendtoactor and a SET's actor marks address them by (max {max} characters)" as Text,
    memberNameEdit: "member {i} name → {name}" as Text,
    memberRenamed: "member {i} is now \"{name}\" — every script that reaches for them by name, and every actor mark in a set, has to say that too" as Text,
    memberInfo: "script @{script} (setupactor/idle/mousedown live there) · logic container @{logic} · sprites are stored as palette indexes and colourised through the ACTIVE SET's table, and depth-tested against its Z layer, which is what puts a character behind furniture" as Text,
    posesOf: " of \u201c{name}\u201d \u2014 " as Text,
    posesInfoTail: "the stored views of each animation step" as Text,
    showThisPose: "show this pose" as Text,
    poseNameTitle: "pose name — what actorpose() asks for (max {max} characters)" as Text,
    manySteps: "a play script with more than one step — a cycle the engine advances one step per 50 ms pass" as Text,
    oneStep: "a one-step play script: a standing pose, shown from whichever stored view you see it" as Text,
    missing: " ({n} missing)" as Text,
    setContainer: " · set container @{loc}" as Text,
    walkThisCycle: "select this pose and walk its cycle" as Text,
    noPoseMatches: "no pose matches “{filter}”" as Text,
    gridHead: "“{name}” · rows are animation steps, columns the stored views (0 = facing the viewer)" as Text,
    offsetEdit: "offset @{loc} → {y},{x}" as Text,
    offsetMoved: "sprite @{loc} now hangs off {x},{y} — the offset scales with the sprite, so this moves the character's feet at every distance" as Text,
    paletteInfo: "this file's own 256 colours — a sprite is colourised through the active room's table, so the same character can read differently from room to room" as Text,
    artEdit: "art @{loc} ← {file}" as Text,
    artReplaced: "replaced sprite @{loc} with {file} ({w}×{h}, {kb} KB packed, was {was} KB)" as Text,
    artSizeWarn: " — it was {w}×{h}, and the stored offset was kept, so the figure now stands differently against its world point" as Text,
  },

  sets: {
    docTitle: "Set Editor — Titanic - Adventure Out Of Time RE" as Text,
    h1: "Set Editor" as Text,
    intro:
      "Load a DreamFactory <b>.SET</b> room — the pre-rendered standpoints you walk between (<code>B59.SET</code>, <code>LOUNGE.SET</code>, …). Browse its scenes, views, hotspots, roads and actor marks, edit what is editable — names, hotspot rectangles, actor placement, view art via PNG round-trip — then export the repacked file." as Html,
    open: "📂 Open a .set file…" as Text,
    export: "⬇ Export .set" as Text,
    closeTitle: "Close this set" as Text,
    setHead: "Set" as Text,
    startsOnScene: "starts on scene" as Text,
    facing: "facing" as Text,
    sceneViewsHead: "Scene & views" as Text,
    scene: "scene" as Text,
    sceneName: "scene name" as Text,
    hotspotsBtn: "▦ Hotspots" as Text,
    hotspotsBtnTitle: "draw the view's hotspot rectangles over the picture" as Text,
    playTurn: "▶ Play turn" as Text,
    playTurnTitle: "play the right-turn ring from this view" as Text,
    previewNote:
      "The standpoint frame of the selected view, as the game shows it. Frames are delta-encoded per turn ring, so the whole ring is decoded together." as Html,
    hotspotsHead: "Hotspots" as Text,
    roadsHead: "Roads" as Text,
    actorMarksHead: "Actor marks" as Text,
    deckMapsHead: "Deck-plan maps" as Text,

    turnRightLabel: "{scene} turn right" as Text,
    turnLeftLabel: "{scene} turn left" as Text,
    previewContainer: "{label}<br>container @{loc}" as Text,
    previewSize: " — {w}×{h}px, {z} Z layer" as Text,
    zWith: "with" as Text,
    zNo: "no" as Text,
    previewUndecodable: " — undecodable" as Text,
    previewPacked: ", {bytes} bytes packed" as Text,
    previewView: "<br>view #{id} “{name}” — rotation {deg}° ({r8}/256), camera height {h}" as Text,
    previewCamera: "<br>camera {x},{z},{y} deg {axis}" as Text,
    noStandpointFrame: "this view has no standpoint frame" as Text,
    stopTurn: "◼ Stop" as Text,
    noneDecode: "nothing to play: none of these frames decode" as Text,
    notInRightRing: "view {i} is not a standpoint in this scene's right-turn ring" as Text,
    turningRight: "turning right: {n} frames to view “{name}”" as Text,
    setNameTitle: "the name a script's changeset knows this room by (max {max} characters)" as Text,
    setNameEdit: "set name → {name}" as Text,
    setNameNow: "set name is now \"{name}\"" as Text,
    defaultStartEdit: "default start → {scene}/{view}" as Text,
    defaultStartNow: "a fresh load of this set now starts on \"{scene}\" facing \"{view}\"" as Text,
    mainScriptAt: "main script @{loc}" as Text,
    noMainScript: "no main script" as Text,
    setInfo: "viewport {vw}×{vh} (the picture sits in the top of the 512×384 screen) · {script} · registers: scenes @{scenes}, roads @{roads}, actors @{actors}<br>set dimensions {sx}×{sy} · map {mw}×{mh} (light @{light}, dark @{dark}) · Z depth: {levels} levels to {far} far ({per} units/level)" as Text,
    sceneNameTitle: "the standpoint's name (max {max} characters)" as Text,
    showThisView: "show this view" as Text,
    viewNameTitle: "view name — what gotoview asks for (max {max} characters)" as Text,
    viewMeta: "#{id} · {deg}° ({r8}/256) · camera h {h} · " as Text,
    viewFrameAt: " · frame @{loc} (motion {motion})" as Text,
    viewNoFrame: " · no standpoint frame" as Text,
    objInfo: "hotspots in “{name}”: {n}" as Text,
    objContainer: " (container @{loc})" as Text,
    objRects: " — rectangles are view pixels, stored top/left/bottom/right" as Text,
    noHotspots: "this view has no hotspots" as Text,
    objIdTitle: "identifier — the name this hotspot's script sees (max {max} characters)" as Text,
    turnRight: "turn right" as Text,
    turnRightHint: "the ring that spins you clockwise past every view of this standpoint" as Text,
    turnLeft: "turn left" as Text,
    turnLeftHint: "the same ring the other way round" as Text,
    framesInfo: "scene “{scene}” · {right} right-turn, {left} left-turn frames · standpoints are the frames tagged motion 1/2" as Text,
    playRing: "▶ play ring" as Text,
    playRingHint: "animate the whole ring in the preview" as Text,
    roadsInfoTail: " — a road's start/end are GLOBAL view ids, unlike a turn ring's scene-local ones" as Text,
    noRoads: "this set has no roads — a single standpoint you only turn on" as Text,
    roadNameTitle: "road name — the label the HUD shows (max {max} characters)" as Text,
    walkForward: "walk the road forwards in the preview" as Text,
    walkBack: "walk it back" as Text,
    actorsInfoTail: " — the stars a script's walkonpath/placestar reaches by name" as Text,
    noActorMarks: "no actor marks — nobody stands in this set" as Text,
    starNameTitle: "star name (max {max} characters)" as Text,
    deckPlan: "{name} deck plan @{loc} — {w}×{h}, all 256 colours" as Text,
    deckPlanUndecodable: "{name} deck plan @{loc} — does not decode as an image" as Text,
    mainScriptLabel: "main script" as Text,
    noScripts: "no scripts in this set" as Text,
    paletteInfo: "the set's {n} view colours (outlined) inside the 256 the maps and props share" as Text,
    usedByViewFrames: " — used by view frames" as Text,
    artEdit: "art @{loc} ← {file}" as Text,
    artReplaced: "replaced frame @{loc} with {file} ({w}×{h}, {kb} KB packed, was {was} KB)" as Text,
    artSizeWarn: " — the view is {w}×{h}, and a different size drops the Z layer that hides actors behind scenery" as Text,
  },

  shops: {
    // the tab says "(prop)" where the heading does not: "shop" is the format's
    // own word for a prop file and means nothing to anyone reading a tab strip
    docTitle: "Shop (prop) Editor — Titanic - Adventure Out Of Time RE" as Text,
    h1: "Shop Editor" as Text,
    intro:
      'Load a DreamFactory <b>.SHP</b> "shop" — or a <b>.PRP</b>, which is the same format under DreamFactory 1\'s name for it — the <b>props</b> drawn on top of a room (<code>HOUSE.SHP</code>\'s ship-wide doors and UI furniture, <code>INVEN.SHP</code>\'s items, a puzzle\'s switches). Browse every prop, its named states and their frames, see where a frame lands on the screen, play an animation, edit names, stored offsets and degrees, replace art via PNG round-trip — then export the repacked file.' as Html,
    open: "📂 Open a .shp file…" as Text,
    export: "⬇ Export {ext}" as Text,
    closeTitle: "Close this shop" as Text,
    shopHead: "Shop" as Text,
    propStatesHead: "Prop & states" as Text,
    prop: "prop" as Text,
    playState: "▶ Play state" as Text,
    playStateTitle: "play the selected state at the game's rate" as Text,
    previewNote:
      "The game's whole screen. A prop draws at <b>anchor − stored offset</b>; the anchor is what <code>propxy</code> moves, so move it here to see where the prop would land." as Html,
    anchorX: "anchor x" as Text,
    reset: "reset" as Text,
    resetTitle: "back to the default (256,192)" as Text,
    statesHead: "States" as Text,
    degree: "degree" as Text,
    propdegNote: "— what propdeg() matches on" as Text,

    unnamedProp: "(unnamed prop)" as Text,
    previewHead: "<b>{name}</b> · state “{state}” frame {i}/{n}" as Text,
    previewContainer: " · container @{loc}" as Text,
    previewSize: "<br>{w}×{h}px, stored offset {y},{x} (y,x) → drawn at {dx},{dy}" as Text,
    previewPacked: "<br>{bytes} bytes packed · degree {deg} · refScale {ref}" as Text,
    previewNotFrame: "<br>this container does not decode as a frame" as Text,
    noStates: "this prop has no states" as Text,
    singleFrame: "this state is a single frame — nothing to animate" as Text,
    degSelector: "“{state}” is a deg-indexed selector, not an animation — the game holds the frame propdeg() matches instead of playing them. Playing anyway." as Text,
    fileStatsTail: "{states} states · {frames} frame references" as Text,
    shopNameTitle: "the shop's own stored name (max {max} characters) — scripts open a shop by FILENAME and a prop by its name, so this is a label" as Text,
    shopNameEdit: "shop name → {name}" as Text,
    shopNameNow: "the shop's stored name is now \"{name}\"" as Text,
    shopInfo: "main script @{loc} — a prop script's unqualified calls resolve through it · props are colourised at composite time through the ACTIVE SET's palette, so the colours here are this file's own table" as Text,
    propNameTitle: "the prop's name — what sendtoprop/propview address it by (max {max} characters)" as Text,
    statesInfoTail: "script @{script} · group container @{group}" as Text,
    showThisState: "show this state" as Text,
    stateIdTitle: "state identifier — what propview() asks for (max {max} characters)" as Text,
    onePose: "a single pose — the prop just sits in it" as Text,
    playsInOrder: "the frames play in order, once, and hold the last one" as Text,
    degPicksOne: "propdeg() picks ONE of these frames by its stored degree; they never play" as Text,
    degList: " · deg {degs} · state container @{loc}" as Text,
    playThisState: "select this state and play it" as Text,
    noStateMatches: "no state matches “{filter}”" as Text,
    framesHeadState: "“{state}” · " as Text,
    inPlayOrder: " in stored play order" as Text,
    degVariants: " — deg-indexed variants, not a sequence" as Text,
    offsetEdit: "offset @{loc} → {y},{x}" as Text,
    offsetMoved: "frame @{loc} now draws at anchor−({x},{y}) — every state that references this container moves with it" as Text,
    mainScriptLabel: "shop main script" as Text,
    paletteInfo: "this file's own 256 colours — a prop is stored as palette indexes and colourised through the active room's table, so in game the same art can look different" as Text,
    artEdit: "art @{loc} ← {file}" as Text,
    artReplaced: "replaced frame @{loc} with {file} ({w}×{h}, {kb} KB packed, was {was} KB)" as Text,
    artSizeWarn: " — the frame was {w}×{h}, and the stored offset was kept, so the art now sits differently against its anchor" as Text,
  },

  stages: {
    docTitle: "Stage Editor — Titanic - Adventure Out Of Time RE" as Text,
    h1: "Stage Editor" as Text,
    intro:
      "Load a DreamFactory <b>.STG</b> stage, or DreamFactory 1's <b>.FLT</b> — the screens that are not rooms: the UI band (<code>MAIN.STG</code>), the inventory (<code>INVEN1.STG</code>), the deck plan (<code>MAP.STG</code>), a mini-game board (<code>BLKJACK.STG</code>). Browse its flats, see each one's full-screen art with its clickable regions drawn over it, rename a flat or a region, move a region's rectangle, replace the art via PNG round-trip — then export the repacked file." as Html,
    open: "📂 Open a .stg file…" as Text,
    export: "⬇ Export {ext}" as Text,
    closeTitle: "Close this stage" as Text,
    flatHead: "Flat" as Text,
    flat: "flat" as Text,
    regionsBtn: "▦ Regions" as Text,
    regionsBtnTitle: "draw the flat's clickable regions over the picture" as Text,
    previewNote:
      "A flat is the whole screen, drawn behind the props and — unless it hides the room view with <code>setvisible(false)</code> — behind the view composited into its top." as Html,
    clickableRegionsHead: "Clickable regions" as Text,

    // what the tool itself says — the notation inside stays notation
    previewFlat: "flat “{name}” · art @{loc}" as Text,
    previewImage: " — {w}×{h}px, {bytes} bytes packed" as Text,
    previewZLayer: ", with a Z layer" as Text,
    previewNoImage: " — does not decode as an image" as Text,
    previewScript: "<br>script @{script} · click logic @{logic} · condition {cond} · record says {w}×{h}" as Text,
    noFlats: "this stage has no flats" as Text,
    flatNameTitle: "the flat's name — what gotoflat/transtoflat ask for and currentflat() answers (max {max} characters)" as Text,
    flatNameEdit: "flat {i} name → {name}" as Text,
    flatRenamed: "flat {i} is now \"{name}\" — the scripts that call gotoflat(\"{name}\") have to name it that too" as Text,
    stageInfo: "main script @{loc} by convention — a flat script's unqualified calls resolve through it · a flat is the whole {w}×{h} screen, and one that calls setvisible(false) covers the room view entirely" as Text,
    regionsIn: "regions in “{name}”: {n}" as Text,
    regionsLogic: " (click logic @{loc})" as Text,
    regionsRects: " — rectangles are screen pixels, stored top/left/bottom/right" as Text,
    noRegionsInLogic: "this flat's click-logic container holds no regions" as Text,
    noClickLogic: "this flat has no click logic — nothing on it is clickable" as Text,
    regionNameTitle: "region name — the \"button\" sendtobutton/pointinbutton reach (max {max} characters)" as Text,
    mainScriptLabel: "stage main script" as Text,
    flatScriptLabel: "flat “{name}”" as Text,
    paletteInfo: "all 256 colours — a flat is a full-screen image, so unlike a room view it uses the whole table" as Text,
    artEdit: "art @{loc} ← {file}" as Text,
    artReplaced: "replaced flat “{name}” art with {file} ({w}×{h}, {kb} KB packed, was {was} KB)" as Text,
    artSizeWarn: " — the flat was {w}×{h}, and the screen is {sw}×{sh}: a different size will not cover it" as Text,
  },

  movies: {
    docTitle: "Movie Editor — Titanic - Adventure Out Of Time RE" as Text,
    h1: "Movie Editor" as Text,
    intro:
      "Load a DreamFactory <b>.MOV</b> — a cutscene, an item close-up, or a clickable object. A movie is not a video: it is a <b>state machine of frames</b>, each of which either takes an action or waits for a click on one of its regions. Scrub the frames, follow the machine, click the regions and see where they go, hear the audio, and edit the logic — the action codes, the targets, the region rectangles, the action-frame slots. Frame <b>art is read-only</b>: the frames are delta-encoded in one chain, so replacing one would smear every frame after it." as Html,
    open: "📂 Open a .mov file…" as Text,
    export: "⬇ Export .mov" as Text,
    closeTitle: "Close this movie" as Text,
    playbackHead: "Playback" as Text,
    regionsBtn: "▦ Regions" as Text,
    regionsBtnTitle: "draw the frame's click regions over the picture" as Text,
    followMachine: "▶ Follow the machine" as Text,
    followMachineTitle: "play the movie the way its own logic says" as Text,
    // the OTHER button: the machine walk reads one segment's logic, this plays
    // the file — every segment, its holds, its bed (site/editors/mov-editor.ts)
    playFilm: "▶▶ Play the film" as Text,
    playFilmTitle: "play the whole file the way the game plays it — every segment in order, with its soundtrack" as Text,
    previewNote:
      "<b>Click the picture</b> and the movie does what it would do with that click — jump to a region's target frame, or report the exit or the chain to another file. A click outside every region does nothing, exactly as in game." as Html,
    readonlyNote:
      "Frames are <b>delta-encoded in one chain</b>, so this page decodes 0…N to show frame N — going back replays the chain from the start. It is also why art is read-only: a replaced frame would leave everything after it decoding against a picture that is gone." as Html,
    exportFramePng: "⬇ Export this frame as PNG" as Text,
    prevTitle: "the frame before this one" as Text,
    nextTitle: "the frame after this one" as Text,
    movieHead: "Movie" as Text,
    // the two actionframe slots and the ESC flag keep their engine names in the
    // label; only the sentence explaining what the slot IS gets translated
    actionFrame1Title: "the frame whose entry actionframe(1) reports" as Text,
    actionFrame2Title: "the frame whose entry actionframe(2) reports" as Text,
    escAborts: "ESC aborts this movie" as Text,
    escAbortsTitle: "header flag bit 0 — all 218 movies in the corpus set it" as Text,
    frameHead: "Frame" as Text,
    frameLogicNote: "the selected frame's own logic" as Text,
    clickRegionsHead: "Click regions" as Text,
    onlyWaits: "only frames that wait" as Text,
    audioHead: "Audio" as Text,

    unknownAction: "unknown action {type}" as Text,
    unnamed: "(unnamed)" as Text,
    none: "(none)" as Text,
    waitsForClick: "waits for a click on " as Text,
    previewHead: "frame {i} <b>“{name}”</b> — {action}" as Text,
    previewArt: "<br>art @{loc}" as Text,
    previewDecoded: ", decoded {w}×{h}" as Text,
    previewNotDecoded: ", not decoded" as Text,
    previewPacked: ", {bytes} bytes packed" as Text,
    previewDirty: ", dirty rect {w}×{h}" as Text,
    previewLogic: "<br>logic @{loc} · type {type}" as Text,
    logicNone: "none" as Text,
    previewSound: " · enters playing “{sound}”" as Text,
    previewActionFrame: "<br><b>actionframe({n})</b> — a script hangs a consequence off passing here" as Text,
    noFrames: "this movie has no frames" as Text,
    clickOutside: "({x},{y}) is outside every region — in game that click does nothing" as Text,
    type1: "{who}: type 1 — the movie closes here" as Text,
    type4: "{who}: type 4 — pushes (this movie, “{target}”) on the return stack and chains to “{event}”, which is a different file" as Text,
    type2NotFrame: "{who}: type 2 — target “{target}” is not a frame of this movie" as Text,
    type3: "{who}: type 3 — the movie closes and chains to “{event}”, which is a different file" as Text,
    type5: "{who}: type 5 — pops the return stack, which only exists mid-sequence" as Text,
    type6Last: "{who}: type 6 — advance, but this is the last frame: the movie ends" as Text,
    type7First: "{who}: type 7 — step back, but this is the first frame" as Text,
    typeUnknown: "{who}: type {type} is not one the engine knows" as Text,
    decodedCost: "decoded {n} frames to get here — the chain has to be replayed from the start" as Text,
    frameWaits: "frame {i} “{name}” waits for a click — " as Text,
    frameWaitsTail: ". Click the picture to take one." as Text,
    lastAdvances: "the last frame advances: the movie ends here" as Text,
    stoppedAfter: "stopped after {n} steps — this movie's logic loops (which is allowed)" as Text,
    filmStart: "playing the film: every segment in order, paced and scored as the game plays it" as Text,
    filmResume: "playing on from the frame you are on, paced and scored as the game plays it" as Text,
    filmSegment: "segment {n} of {total}: {frames} over {picture}s of picture{bed}" as Text,
    filmBed: " · {secs}s bed under it" as Text,
    filmEnd: "the film ends — {frames} shown in {secs}s" as Text,
    filmCue: "cue at tick {tick} → “{target}”" as Text,
    filmNoPacing: "nothing here advances a frame — no step action, no soundtrack, no regions: in game this is a close-up held until it is clicked away" as Text,
    fileStatsTail: "({waiting} wait for a click) · {regions} regions · {w}×{h}" as Text,
    // a film is a chain of segments played back to back; the picker shows one
    segmentLabel: "segment" as Text,
    segmentOption: "{n} of {total} — {frames} frames @{loc}" as Text,
    fileStatsSegments: "{n} segments, {frames} frames in all" as Text,
    audioInherited:
      " — this segment starts no bed of its own, so it keeps playing the one before it" as Text,
    noSuchFrame: "{value} (no such frame)" as Text,
    actionFramesEdit: "action frames → {a1}/{a2}" as Text,
    actionFramesNow: "actionframe(1) is now “{a1}”, actionframe(2) “{a2}” — what a script sees as “playback passed here”" as Text,
    escEdit: "ESC aborts → {value}" as Text,
    escOn: "ESC aborts this movie (flag bit 0 set) — an abort does NOT run the frame's action" as Text,
    escOff: "ESC no longer aborts this movie: it will play to its end" as Text,
    movieInfo: "flags 0x{flags} · frames are the full {w}×{h} picture, delta-encoded in one chain — the table's per-frame size is the dirty rectangle<br>audio: " as Text,
    audioInTheLoop: "<b>loop table</b> — a bed played under the whole movie" as Text,
    audioOneShot: "one-shot block" as Text,
    audioIn: " in the " as Text,
    audioEventNote: " — on an interactive movie these are event sounds, not music" as Text,
    // what the PLAYER will do with this file, from the shared rule (engine/src/df/mov-pace.ts):
    // the editor used to preview everything at the native rate and quietly disagree
    pacing: "<br>plays at {ms} ms a frame ({fps} fps)" as Text,
    pacingBed: " — its audio is a BED ({secs}s over a {picture}s picture), so the picture repeats and the bed ends the movie" as Text,
    pacingByAudio: " — paced by its {secs}s soundtrack" as Text,
    pacingLoops: " · its frames jump backwards: the picture is authored as a loop" as Text,
    pacingClicks: "<br>waits for clicks — no frame advances on its own" as Text,
    framesInfo: "{n} frames · a frame WITH regions waits for a click, one without takes its own action" as Text,
    showThisFrame: "show this frame" as Text,
    stopsHere: "playback stops here until a click lands in one of its regions" as Text,
    noFrameMatches: "no frame matches" as Text,
    showingFirst: "showing the first 400 of {n} matching frames — filter to see the rest" as Text,
    notACode: "{value} — not a code the engine knows" as Text,
    frameNameTitle: "the frame's name — what another frame's target jumps to and what the action-frame slots name (max {max} characters)" as Text,
    stillTargetTail: " still target “{was}”" as Text,
    slotsStillName: {"one":"actionframe({slots}) still names it","other":"actionframe({slots}) still name it"} as Plural,
    frameRenamed: "frame {i} is now “{name}”" as Text,
    frameRenamedBroken: " — {broken}: those are stored strings, so they now point at nothing" as Text,
    brokenJoin: ", and " as Text,
    noLogicContainer: "this frame has no logic container — a plain animation frame, which plays and advances. Its action and names cannot be set without adding one." as Text,
    actionLabel: "action " as Text,
    actionUnusedTitle: "this frame HAS regions, so the engine waits for a click and never takes this action" as Text,
    actionTitle: "what playback does on entering this frame" as Text,
    unusedWithRegions: "(unused while the frame has regions)" as Text,
    soundLabel: "sound" as Text,
    soundHint: "event sound played on entering the frame" as Text,
    eventLabel: "event movie" as Text,
    eventHint: "the movie types 3/4 chain to" as Text,
    targetLabel: "target frame" as Text,
    targetHint: "the frame types 2/4 jump to" as Text,
    regionsOnFrame: "regions on frame {i}: {n}" as Text,
    regionsLogic: " (logic @{loc})" as Text,
    regionsRects: " — rectangles are screen pixels, stored top/left/bottom/right" as Text,
    noRegions: "no regions — this frame takes its own action instead of waiting for a click" as Text,
    soundOnClickHint: "event sound played on click" as Text,
    doWhatClickDoes: "do what clicking this region does" as Text,
    notAudio: "{label}: does not decode as audio ({message})" as Text,
    audioLoopTable: "the loop table — a bed the engine plays under the whole movie, chunk after chunk" as Text,
    audioOneShotBlock: "the one-shot block — event sounds a frame or a region fires by name" as Text,
    noAudio: "this movie carries no audio" as Text,
    paletteInfo: "the movie's own 256 colours" as Text,
  },

  /**
   * What all seven tools say, said once.
   *
   * These are the strings the editors BUILD rather than declare — the first of
   * them to be translated, because they are the ones every tool repeats
   * verbatim: opening a file, failing to, listing what the dev server offers,
   * writing one back out.
   */
  common: {
    pickFromGamefiles: "or pick one from gamefiles/" as Text,
    // the movie editor warns as well, because a .MOV is not a small download
    pickFromGamefilesBig:
      "or pick one from gamefiles/ — the big cutscenes are tens of megabytes" as Text,
    loading: "loading {path}…" as Text,
    fetchFailed: "failed to fetch {path} ({status})" as Text,
    // `{ext}` is the extension with its dot, and stays Latin in every language
    notReadable: "not a readable {ext}: {message}" as Text,
    notAnImage: "{file}: not a decodable image" as Text,
    notAScript: "(container does not decode as a script)" as Text,
    exported: "exported {file} ({bytes} bytes" as Text,
    exportedUnmodified: ", unmodified)" as Text,
    exportedWithEdits: ", {n} edits: {edits})" as Text,
    exportFailed: "export failed self-check: {message}" as Text,
  },

  /**
   * The counted strings, which is why {@link Plural} exists.
   *
   * Every one of these used to be `${n} thing${n === 1 ? "" : "s"}` — English
   * grammar compiled into seven TypeScript files. They are a namespace of their
   * own because the tools share most of them, and because a translator wants
   * them in one place: they are the entries where getting the language right
   * takes more than knowing the word.
   */
  counts: {
    unexportedEdits: { one: "{n} unexported edit", other: "{n} unexported edits" } as Plural,
    discardEdits: {
      one: "Discard {n} unexported edit?",
      other: "Discard {n} unexported edits?",
    } as Plural,
    containers: { one: "{n} container", other: "{n} containers" } as Plural,
    flats: { one: "{n} flat", other: "{n} flats" } as Plural,
    clickableRegions: { one: "{n} clickable region", other: "{n} clickable regions" } as Plural,
    withArt: { one: "({n} with art)", other: "({n} with art)" } as Plural,

    loopChunks: {"one":"{n} loop chunk","other":"{n} loop chunks"} as Plural,
    oneShots: {"one":"{n} one-shot","other":"{n} one-shots"} as Plural,
    steps: {"one":"{n} step","other":"{n} steps"} as Plural,
    chunks: {"one":"{n} chunk","other":"{n} chunks"} as Plural,
    members: {"one": "{n} member", "other": "{n} members"} as Plural,
    poses: {"one": "{n} pose", "other": "{n} poses"} as Plural,
    sprites: {"one": "{n} sprite", "other": "{n} sprites"} as Plural,
    props: {"one":"{n} prop","other":"{n} props"} as Plural,
    states: {"one":"{n} state","other":"{n} states"} as Plural,
    frames: {"one":"{n} frame","other":"{n} frames"} as Plural,
    scenes: {"one":"{n} scene","other":"{n} scenes"} as Plural,
    views: {"one":"{n} view","other":"{n} views"} as Plural,
    hotspots: {"one":"{n} hotspot","other":"{n} hotspots"} as Plural,
    roads: {"one":"{n} road","other":"{n} roads"} as Plural,
    waypoints: {"one":"{n} waypoint","other":"{n} waypoints"} as Plural,
    actorMarks: {"one":"{n} actor mark","other":"{n} actor marks"} as Plural,
    namedSounds: {"one":"{n} named sound","other":"{n} named sounds"} as Plural,
  },

  tracks: {
    docTitle: "Track Editor — Titanic - Adventure Out Of Time RE" as Text,
    h1: "Track Editor" as Text,
    intro:
      "Load a DreamFactory audio bank — a <b>.TRK</b> music track (<code>BEDRAD1.TRK</code>, …), a <b>.SFX</b> effects bank, an <b>.11K</b> low-memory song, or a DreamFactory 1 <b>.SND</b>, which opens read-only. Play the theme and its one-shot sounds, rename them, reorder the chunks the theme loops through, drop your own audio in, then export the repacked file." as Html,
    open: "📂 Open a .trk / .sfx / .11k / .snd file…" as Text,
    export: "⬇ Export bank" as Text,
    closeTitle: "Close this bank" as Text,
    bankHead: "Bank" as Text,
    trackName: "track name" as Text,
    musicHead: "Music" as Text,
    playTheme: "▶ Play theme" as Text,
    playThemeTitle: "play the loop chunks in order, looped" as Text,
    themeWav: "⬇ WAV" as Text,
    themeWavTitle: "export the whole theme as one WAV" as Text,
    themeImport: "⬆ Replace all music…" as Text,
    themeImportTitle: "replace the theme with an audio file, split across its chunks" as Text,
    soundFilterPlaceholder: "filter…" as Text,
    oneShotHead: "One-shot sounds" as Text,

    notReadableBank: "not a readable audio bank: {message}" as Text,
    notABank: "{name} has neither loop chunks nor one-shots — not an audio bank?" as Text,
    noSuchContainer: "@{loc} — no such container (the table points past the file)" as Text,
    notDecodableSound: "@{loc} — {bytes} B, not decodable as sound" as Text,
    notAudio: "{file}: not a decodable audio file" as Text,
    audioEdit: "audio @{loc} ← {file}" as Text,
    audioReplaced: "{what}: replaced with {file} — {secs}s at {khz} kHz, {kb} KB packed (was {was} KB)" as Text,
    noLoopChunks: "this bank has no loop chunks — nothing to replace" as Text,
    themeEdit: "theme ← {file}" as Text,
    themeReplaced: "theme: replaced with {file} — {secs}s across " as Text,
    themeRepeats: "; the play order repeats {n} of them, so those stretches play twice" as Text,
    fileStatsTail: " · {n} chunks total" as Text,
    inStepOrder: " in a {n}-step order · " as Text,
    bankInfo: "the name a script's playnewtheme/opentrackfile knows this bank by; the runtime drops a \".wav\" suffix. {max} characters fit the field." as Text,
    trackNameEdit: "track name → {name}" as Text,
    trackNameNow: "track name is now \"{name}\"" as Text,
    musicIn: "{secs}s of music in " as Text,
    orderEmpty: "the play order is empty — this bank's theme is silent" as Text,
    nothingToPlay: "nothing to play: the play order is empty" as Text,
    emptyAddChunk: "empty — add a chunk below" as Text,
    movedStep: "moved step {from} to {to}" as Text,
    dropStep: "drop this step" as Text,
    droppedStep: "dropped step {n}" as Text,
    usedInOrder: "{n}× in the order" as Text,
    notInOrder: "not in the order" as Text,
    appendToOrder: "append to the play order" as Text,
    appendedChunk: "appended chunk {n} to the order" as Text,
    playOrderLog: "play order: {order}" as Text,
    playOrderEmpty: "(empty)" as Text,
    identTitle: "identifier — what a script asks for (max {max} characters)" as Text,
    playChunk: "play this chunk" as Text,
    chunkNotSound: "container @{loc} does not decode as sound" as Text,
    exportChunkWav: "export this chunk as a WAV" as Text,
    replaceChunkAudio: "replace this chunk's audio from an audio file" as Text,
  },
} as const;

/**
 * The shape every translation has to have. A `de.json` missing a key, or
 * carrying one that no longer exists, is a compile error where it is imported
 * and a test failure in site/tests/locales.ts — never a blank label at runtime.
 */
export type Catalogue = {
  [NS in keyof typeof en]: {
    // per key, not per namespace: a key English counts with has to be counted in
    // every language, and one it does not must not sprout forms elsewhere
    [K in keyof (typeof en)[NS]]: (typeof en)[NS][K] extends string ? string : Plural;
  };
};

/** the top-level groups, which are also the units the loader fetches */
export type Namespace = keyof typeof en;

/** `"home.intro"` — what a `data-i18n` attribute holds */
export type Key = {
  [NS in keyof typeof en]: `${NS & string}.${keyof (typeof en)[NS] & string}`;
}[keyof typeof en];

export default en;
