/**
 * A small code editor for the sheet — highlighting, line numbers, and nothing else.
 *
 * ## Why not an editor library
 *
 * CodeMirror would do this and much more, and "much more" is the problem: it is a
 * large dependency for a page that needs three colours and a gutter, in a
 * repository that has no runtime dependencies at all. So this is the old overlay
 * trick — a `<pre>` painted underneath a transparent `<textarea>`, scrolled in
 * step — which keeps every native behaviour that matters (undo, autocorrect off,
 * the mobile keyboard, selection, drag-and-drop of a file) because the textarea
 * is still a real textarea holding the real value. Nothing here touches the text;
 * it only draws it a second time, in colour.
 *
 * ## Why not JavaScript highlighting
 *
 * The sheet grammar *looks* like JavaScript and is not, and the places it differs
 * are exactly the places a highlighter earns its keep. `#` starts a comment, not
 * `//`. `wait(set == c73)` is a named argument, not an assignment. `purser[1,3,5]`
 * is a bevel list, not an index. And `#|` is not a comment at all — it is a
 * DRAFT line, code that is deliberately switched off, which a JavaScript
 * highlighter would paint identically to prose. Telling those two apart is the
 * whole point of colouring this file, so the highlighter knows the real grammar.
 *
 * ## No soft wrap
 *
 * Deliberate, and the gutter is why. Every error the runner prints cites a line
 * number — "line 233: accost(penny)" — and a wrapped line makes the numbers in
 * the gutter stop matching the numbers in the report, which is worse than no
 * gutter at all. Long lines scroll sideways instead.
 */

/** one coloured run of text */
interface Span {
  text: string;
  cls: string;
}

const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ESCAPE[c]);

/** `verb(` at the head of a statement */
const VERB = /^(\s*)([A-Za-z][A-Za-z0-9_]*)(\s*\()/;
/**
 * A named argument: `by: esc`, `until: quiet` — a COLON, never an equals.
 *
 * The two used to share the `name=value` shape and this highlighter could not
 * tell them apart either; it painted a condition as if it were an argument. Now
 * the grammar does the telling (sheet.ts) and so can the colour.
 */
const NAMED = /^([A-Za-z][A-Za-z0-9_-]*)(\s*:)/;
/**
 * A condition: `set == c73`, `global.mission == 1`, `owns.map`.
 *
 * Painted as one token — name, dot-path and operator together — because what a
 * reader needs to see at a glance is "this is a question about the world", not
 * its three parts.
 */
const CONDITION = /^([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_.-]+)?)(\s*(?:==|!=|>=|<=|>|<))/;
const NUMBER = /^-?\d+(\.\d+)?/;
const STRING = /^"(?:[^"\\]|\\.)*"/;
const BEVELS = /^\[[\d,\s]*\]/;
const WORD = /^[A-Za-z0-9_.$-]+/;

/**
 * Split a line's code from its trailing `#` comment.
 *
 * Quote-aware, because a `#` inside a quoted value is part of the value and not
 * the start of prose — rare, but the alternative is a line that silently paints
 * half of itself as a comment and leaves the author hunting for a typo that is
 * not there.
 */
function splitComment(line: string): [string, string] {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === "#" && !quoted) return [line.slice(0, i), line.slice(i)];
  }
  return [line, ""];
}

/** colour the code half of a line */
function code(text: string): Span[] {
  const out: Span[] = [];
  let rest = text;

  const verb = VERB.exec(rest);
  if (verb) {
    if (verb[1]) out.push({ text: verb[1], cls: "" });
    out.push({ text: verb[2], cls: "v" });
    out.push({ text: verb[3], cls: "p" });
    rest = rest.slice(verb[0].length);
  }

  while (rest) {
    const str = STRING.exec(rest);
    if (str) {
      out.push({ text: str[0], cls: "s" });
      rest = rest.slice(str[0].length);
      continue;
    }
    const bev = BEVELS.exec(rest);
    if (bev) {
      out.push({ text: bev[0], cls: "b" });
      rest = rest.slice(bev[0].length);
      continue;
    }
    // a condition FIRST: `set == c73` starts like a bare word, and `until: set
    // == c73` puts one directly after a named argument
    const cond = CONDITION.exec(rest);
    if (cond) {
      out.push({ text: cond[1], cls: "q" });
      out.push({ text: cond[2], cls: "p" });
      rest = rest.slice(cond[0].length);
      continue;
    }
    const named = NAMED.exec(rest);
    if (named) {
      out.push({ text: named[1], cls: "k" });
      out.push({ text: named[2], cls: "p" });
      rest = rest.slice(named[0].length);
      continue;
    }
    const num = NUMBER.exec(rest);
    if (num) {
      out.push({ text: num[0], cls: "n" });
      rest = rest.slice(num[0].length);
      continue;
    }
    const word = WORD.exec(rest);
    if (word) {
      out.push({ text: word[0], cls: "" });
      rest = rest.slice(word[0].length);
      continue;
    }
    // punctuation, whitespace, anything else — one character at a time so the
    // loop always makes progress and can never hang on an unexpected symbol
    const c = rest[0];
    out.push({ text: c, cls: /[(),;[\]=:.!<>]/.test(c) ? "p" : "" });
    rest = rest.slice(1);
  }
  return out;
}

/** colour one whole line */
function line(text: string): string {
  const trimmed = text.trimStart();

  // `#|` — a DRAFT line. Code that is switched off, and the one thing this
  // highlighter exists to make unmistakable: it must read as neither live code
  // nor prose.
  if (trimmed.startsWith("#|")) {
    const lead = text.slice(0, text.length - trimmed.length);
    const [c, comment] = splitComment(trimmed.slice(2));
    const inner = code(c)
      .map((s) => `<span class="${s.cls}">${esc(s.text)}</span>`)
      .join("");
    return (
      `<span class="d">${esc(lead)}#|</span><span class="d">${inner}` +
      (comment ? `<span class="c">${esc(comment)}</span>` : "") +
      `</span>`
    );
  }

  if (trimmed.startsWith("#")) return `<span class="c">${esc(text)}</span>`;

  const [c, comment] = splitComment(text);
  return (
    code(c)
      .map((s) => `<span class="${s.cls}">${esc(s.text)}</span>`)
      .join("") + (comment ? `<span class="c">${esc(comment)}</span>` : "")
  );
}

export interface Editor {
  /** repaint after the value was changed from outside (Load, Undo clear) */
  refresh(): void;
  /**
   * Show the execution pointer on a 1-based line, or nowhere for null.
   *
   * The pointer is the one piece of run state that cannot be read off the text,
   * and a sheet is long enough that "where would Play start" is a real question.
   * So it is drawn twice — a lit gutter number and a band across the line —
   * because the gutter can be scrolled out of sight and the band cannot.
   */
  mark(line: number | null): void;
  /**
   * Show the RECORDING point on a 1-based line, or nowhere for null.
   *
   * A second marker rather than a reuse of the first, because they are two
   * different places that are usually not the same one: the pointer is where the
   * run would resume and the record point is where the next gesture lands. And
   * it is drawn at all because the thing it replaces cannot be: the caret is the
   * browser's, and the browser hides it the moment the textarea blurs — which is
   * exactly what clicking on the game does. Recording without this is recording
   * blind.
   */
  markRecord(line: number | null): void;
  /** scroll a 1-based line into view, for a jump the user did not scroll to */
  reveal(line: number): void;
}

/**
 * Turn a plain textarea into the editor.
 *
 * Everything is created here rather than in the HTML, so the page keeps working
 * — as an ordinary textarea — if this module fails to load or is removed.
 */
export function attachEditor(textarea: HTMLTextAreaElement): Editor {
  const wrap = document.createElement("div");
  wrap.className = "sr-editor";
  const gutter = document.createElement("div");
  gutter.className = "sr-gutter";
  const highlight = document.createElement("pre");
  highlight.className = "sr-highlight";
  highlight.setAttribute("aria-hidden", "true");

  // The band behind the pointer's line. A sibling rather than a class on the
  // text, because the text is repainted on every keystroke and the pointer is
  // not — and because a band has to span the full width whatever the line holds.
  const band = document.createElement("div");
  band.className = "sr-cursor";
  band.hidden = true;

  const recBand = document.createElement("div");
  recBand.className = "sr-cursor rec";
  recBand.hidden = true;

  textarea.parentNode!.insertBefore(wrap, textarea);
  wrap.append(gutter, highlight, textarea, band, recBand);
  // no soft wrap, so a gutter number means the same line the report means
  textarea.setAttribute("wrap", "off");

  let lastLines = -1;
  let at: number | null = null;
  let recAt: number | null = null;

  const paint = (): void => {
    const text = textarea.value;
    const rows = text.split("\n");
    // a trailing newline should still get a number; `split` gives the empty
    // string after it, which is exactly the line the caret is sitting on
    highlight.innerHTML = rows.map(line).join("\n") + "\n";
    if (rows.length !== lastLines) {
      lastLines = rows.length;
      // one span per number so the pointer can light exactly one of them
      gutter.innerHTML = rows.map((_, i) => `<span>${i + 1}</span>`).join("\n");
      lit();
    }
    sync();
  };

  /** the pixel height of one line, asked of the browser rather than assumed */
  const lineHeight = (): number => {
    const px = parseFloat(getComputedStyle(highlight).lineHeight);
    return Number.isFinite(px) && px > 0 ? px : 18;
  };

  /** put one band on its line, or take it off screen */
  const place = (el: HTMLElement, line: number | null, cls: string): void => {
    for (const n of gutter.querySelectorAll(`span.${cls}`)) n.classList.remove(cls);
    el.hidden = line === null;
    if (line === null) return;
    gutter.children[line - 1]?.classList.add(cls);
    const h = lineHeight();
    const pad = parseFloat(getComputedStyle(highlight).paddingTop) || 0;
    el.style.height = `${h}px`;
    el.style.top = `${pad + (line - 1) * h - textarea.scrollTop}px`;
    // a band drawn above the padding would sit on top of the row of numbers
    el.style.visibility = parseFloat(el.style.top) < pad - h ? "hidden" : "visible";
  };

  /** light the gutter numbers, and place both bands */
  const lit = (): void => {
    place(band, at, "cur");
    place(recBand, recAt, "rec");
  };

  const sync = (): void => {
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
    gutter.scrollTop = textarea.scrollTop;
    lit();
  };

  textarea.addEventListener("input", paint);
  textarea.addEventListener("scroll", sync);

  // Tab indents instead of leaving the field. Only when nothing is selected —
  // a Tab with a selection is far more likely to be someone trying to move on
  // than someone wanting two spaces, and trapping focus in a textarea with no
  // way out is a genuine accessibility failure rather than a quirk.
  textarea.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.shiftKey) return;
    if (textarea.selectionStart !== textarea.selectionEnd) return;
    e.preventDefault();
    const at = textarea.selectionStart;
    textarea.setRangeText("  ", at, at, "end");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });

  paint();
  return {
    refresh: paint,
    mark: (line) => {
      at = line;
      lit();
    },
    markRecord: (line) => {
      recAt = line;
      lit();
    },
    reveal: (line) => {
      const h = lineHeight();
      const top = (line - 1) * h;
      const view = textarea.clientHeight;
      // only scroll when it is actually out of sight, and land it a third of
      // the way down rather than at the very edge — the lines AFTER the pointer
      // are the ones being read
      if (top < textarea.scrollTop || top > textarea.scrollTop + view - h) {
        textarea.scrollTop = Math.max(0, top - view / 3);
        sync();
      }
    },
  };
}
