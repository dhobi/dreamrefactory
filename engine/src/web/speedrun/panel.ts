/**
 * The workbench's two panels as markup — the engine's, so a second game gets
 * them rather than a copy of them.
 *
 * ## Why a builder and not markup in the page
 *
 * The repository's habit is the other way round: `save-browser.ts` drives a
 * dialog whose `#saveModal` is written into each page that wants one, and that
 * is right for a handful of elements. This is not a handful. It is a hundred and
 * twenty lines of buttons with their icons drawn inline, and every id in it is
 * queried by one of the modules beside this file — so a page that carried its
 * own copy would be a second thing to keep in step with `editor.ts`,
 * `columns.ts`, `widths.ts`, `inputs.ts`, `recorder.ts` and the workbench page
 * itself, and a renamed id would go wrong in one game and not the other.
 *
 * That is the same argument `page-driver.ts` makes for driving the real play
 * page instead of a trimmed copy of it, and the same one that put `panel.css`
 * next door: the panel's structure, its styles and the code that works it are
 * one thing, and one thing should live in one place.
 *
 * ## Why `innerHTML` and not `createElement`
 *
 * Because the markup is the readable form. Written out node by node this would
 * be four hundred lines in which no button's shape can be seen, and the comments
 * that say WHY each control is the way it is would have nowhere to sit. The
 * string below is static and authored here — nothing from a sheet, a save or a
 * URL reaches it — so the usual reason to avoid `innerHTML` does not apply.
 *
 * The backticks in its comments are escaped because it is a template literal
 * now; they are inside HTML comments, so nothing renders either way.
 *
 * ## Where it goes
 *
 * The PAGE decides, by putting an empty element where it wants the panels and
 * handing it to {@link buildPanel}. That keeps the one genuinely per-page fact —
 * what order the columns start in, and what else shares the row — in the markup
 * a reader of that page can see, which is the part of the repository's habit
 * worth keeping.
 */

/**
 * The two sections, verbatim: `#srtimer` (what a run produced) and `#srpanel`
 * (what a run is written in).
 */
const PANEL = `
<!-- What the run produced, beside what produced it. Its own section rather
     than the foot of the sheet's column: under 26rem of editor and four rows
     of controls, the clock and the splits were read by scrolling away from
     the picture being timed. -->
<section id="srtimer">
  <h2>Timer</h2>
  <!-- The stopwatch: seconds since Play, counting (taoot/src/speedrun-page.ts).
       Above the splits because it is what the splits are readings OF — while
       a leg with no split in it runs, this is the only thing on the page
       that moves. It keeps its last reading when the run stops.

       Load-removed, and it says so while it is stopped: a fetch that is
       coming over a LINK holds the reading still and marks it LOADING
       (#251), because a room fetched over the internet moves the clock by
       reasons that have nothing to do with the route. A cache hit or a read
       off this machine does not stop it — those are what the original did
       off its CD (#369). -->
  <div id="srclock">0.0s</div>
  <div id="srsplits"></div>
  <!-- What the run is pressing (taoot/src/speedrun-inputs.ts). A key lighting is
       the only thing that tells you the arrow was sent and not something the
       engine did on its own — which is why it used to be drawn on the canvas
       itself, and why this section is the one beside the canvas. -->
  <div id="inputs" aria-hidden="true"></div>
  <p id="srcaveat">
    A previewer, not the clock of record. Its input events are synthetic, so
    they skip the browser's real input pipeline and the same sheet finishes
    faster here than it does under Playwright. Tune here; take the time with
    <code>npm run speedrun -w taoot</code>. The pathfinding verbs
    (<code>travel</code>, <code>hunt</code>, <code>stand</code>) need the
    Node runner and will say so. Every time on this page has the
    <em>downloading</em> taken out of it — the clock stops while the game
    comes over a link, and the <code>load</code> column says how much came
    out. Against a dev server on <code>localhost</code> that is nothing at
    all, and rightly: a fetch off this machine is a disk read, which the
    original did too.
  </p>
</section>
<!-- /#srtimer -->

<section id="srpanel">
  <h2>Speedrun sheet</h2>
  <!-- The user's own sheets, then a chip per checkpoint \`save()\` has
       written. Both built at load and repainted as things change
       (taoot/src/speedrun-page.ts) — a save that has just run gets its chip
       without a reload. -->
  <div id="srsheets" hidden></div>
  <div id="srparts" hidden></div>
  <textarea id="srsheet" spellcheck="false" placeholder="# paste a run sheet here — same grammar as taoot/tests/speedrun/run.sheet.txt
intro()
skipMovie(until: awaiting)
clickAt(266, 254)
wait(nomovie, faded)
split(boot)"></textarea>
  <!-- Play resumes from the execution pointer; Pause leaves it where it is;
       Stop puts it back at the top. Nothing else moves it except a
       checkpoint, which moves the GAME at the same time.

       The three are a transport, so they are drawn as one: a player's
       ▶/⏸/⏹ rather than three words. What they do to a sheet is what those
       glyphs already mean to everyone, and the row beside them is verbs
       (Check, Clear, Record) which are not a transport and stay words.
       Every icon button carries a \`title\` and an \`aria-label\`, because a
       glyph is not a name. -->
  <div id="srrow">
    <button id="srrun" class="icon" type="button" title="Play" aria-label="Play"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 6.2 18.6 12 9 17.8Z"/></svg></button>
    <!-- One ACTION and stop again, which is not the same as one LINE:
         \`left(); up(); left()\` is three of them, and #252 asks to watch what
         each one does. The glyph is the transport's own for this — the play
         triangle with a bar against it, on the same 24-unit grid as the
         other three. -->
    <button id="srstep" class="icon" type="button" title="Step — run the next single action and stop again" aria-label="Step one action"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6.2 14.4 12 6 17.8Z"/><rect x="15.8" y="6.2" width="2.2" height="11.6" rx="1"/></svg></button>
    <button id="srpause" class="icon" type="button" disabled title="Pause" aria-label="Pause"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.4 6.3h2.9v11.4H8.4zm4.3 0h2.9v11.4h-2.9z"/></svg></button>
    <button id="srstop" class="icon" type="button" title="Stop — put the pointer back at the top" aria-label="Stop"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="7.15" y="7.15" width="9.7" height="9.7" rx="1.4"/></svg></button>
    <button id="srcheck" type="button">Check</button>
    <button id="srclear" type="button">Clear</button>
    <!-- Pull the whole English tree through the browser cache before a run,
         so the route is timed against memory rather than against the wire
         (engine/src/web/cache-warmup.ts). A word rather than a glyph: it is not a
         transport control and it is not something to press by accident —
         it is 1.2 GB. -->
    <button id="srwarm" type="button" title="Fetch every file of the English edition so the run is not waiting on the network">Warm cache</button>
    <!-- Record watches the real input you make at the game and writes the
         line that would have made it. Passive: it never intercepts, so the
         game plays exactly as it would with this off. A red dot, which is
         what a record button is; the word is in the tooltip and the state is
         in the colour (see #srrec.on). -->
    <button id="srrec" class="icon" type="button" title="Record — write what you do at the game into the sheet" aria-label="Record"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="5"/></svg></button>
    <!-- The legend used to be a <details> under this row, open or shut. It
         is ~40 verbs and their options: shut it said nothing, open it pushed
         the status, the splits and the caveat off the bottom of a panel that
         is 26rem wide beside the game. A reference that long is looked UP,
         so it is behind this and comes back as a modal. -->
    <button id="srhelp" class="icon" type="button" title="What the commands mean" aria-label="What the commands mean"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.4a8.6 8.6 0 1 0 0 17.2 8.6 8.6 0 0 0 0-17.2Zm0 1.9a6.7 6.7 0 1 1 0 13.4 6.7 6.7 0 0 1 0-13.4Z"/><circle cx="12" cy="8.1" r="1.15"/><rect x="11.05" y="10.4" width="1.9" height="6.4" rx=".95"/></svg></button>
  </div>
  <!-- The warmup's bar. Ice like the play page's preload bar and for the
       same reason — it is the live thing on the panel, and brass here is
       for what has changed or commits. Hidden until there is something to
       report; it keeps its final reading afterwards, because "how long did
       that take and how fast was it" is the question asked immediately
       after it finishes. -->
  <div id="srwarmbar" hidden>
    <div id="srwarmtrack"><div id="srwarmfill"></div></div>
    <div id="srwarmnum"></div>
  </div>
  <div id="srlegend" class="modal">
    <div class="modal-box">
      <div class="modal-head">
        <span>What the commands mean</span>
        <button id="srlegendclose" type="button" title="Close" aria-label="Close">✕</button>
      </div>
      <div id="srlegendbody"></div>
    </div>
  </div>
  <div id="srstatus"></div>
</section>
<!-- /#srpanel -->
`;

/**
 * Put the panels where `slot` is, and take `slot` away.
 *
 * Replaced rather than filled, so the page's placeholder does not survive as a
 * wrapper around them: `#srlayout` lays its children out as columns and an extra
 * `<div>` in the middle would be a third one that no module knows how to move.
 *
 * Must run BEFORE anything queries the ids inside — the workbench page's own
 * module reads them at import time, so it calls this first (see
 * `taoot/src/speedrun-page.ts`).
 *
 * `createContextualFragment` and not `insertAdjacentHTML`, because the markup is
 * two siblings rather than one root and a fragment is the thing that can carry
 * both to a `replaceWith`.
 */
export function buildPanel(slot: HTMLElement): void {
  slot.replaceWith(document.createRange().createContextualFragment(PANEL));
}
