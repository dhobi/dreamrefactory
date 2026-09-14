/**
 * A rung's gestures, as sheet lines.
 *
 *     npx tsx dust/tools/rung2sheet.ts d2a006          one rung, to stdout
 *     npx tsx dust/tools/rung2sheet.ts --all           every rung, in ladder order
 *
 * ## Why this can work at all
 *
 * Because the route is already written down as gestures. The playthrough's rungs
 * are 679 calls to fourteen helpers (dust/tests/playthrough/route.ts), and the
 * arguments are LITERAL — cells, bevel ids, even door rectangles:
 *
 *     walkTo(p, town, { x: 6, z: 7, view: "west" })   ->  goto(6, 7, west, set: town)
 *     answer(p, 102, "These shops seem out of...")    ->  say([102])   # These shops...
 *     openDoor(p, [241, 92, 307, 201], "saloon", ...) ->  doorAt(241, 92, 307, 201, owner: saloon)
 *
 * So this reads them and writes the lines, in source order. It is a TRANSCRIBER
 * and not a compiler: what it cannot express it emits as a `# TODO` naming the
 * call it came from, so the output always parses and never pretends.
 *
 * ## What it deliberately loses
 *
 * The rungs are code, and code has parts a sheet has no grammar for. Loops,
 * conditionals and locally computed arguments are the obvious ones; the subtler
 * losses are worth naming because they are where a transcribed leg will fail:
 *
 *   - `walkTo`'s `stopWhen` predicate — "arrive, and do not complain about the
 *     facing" — has no spelling here. A leg that relied on it will report a
 *     facing it did not get.
 *   - `openDoor`'s `from` standpoint, which it re-takes before every try. The
 *     `goto` on the line before is usually the same thing, but not always.
 *   - `talkOut`'s quiet windows. `say(..., then: leave)` answers and leaves; it
 *     does not watch for somebody who has not started speaking yet.
 *
 * Which is the honest summary of the whole tool: it gets a leg most of the way
 * in a second, and the last part is read off the report.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RUNGS = fileURLToPath(new URL("../tests/playthrough/rungs", import.meta.url));
const LADDER = fileURLToPath(new URL("../../docs/dust/thread.md", import.meta.url));
const SEGMENTS = fileURLToPath(new URL("../tests/playthrough/segments.ts", import.meta.url));

/** the helpers worth transcribing, longest first so `clickActor` beats `click` */
const CALLS = [
  "walkTo", "openDoor", "clickActor", "clickProp", "clickThrough", "offerInTalk",
  "takeInHand", "offerTo", "talkOut", "excuseUs", "converse", "dropOn", "answer", "meet",
  // and the raw press, which is a gesture like any other. Leaving it out was
  // worse than leaving it as a TODO: the whole thing that fetches the help
  // character into the street — an uparrow into the dog — simply was not in the
  // transcription, and the leg failed two lines later on a character who had
  // never been asked to appear.
  "p.press",
  /*
   * AND THE RAW CLICK, which was the largest silent drop of the lot.
   *
   * 105 of them across the harness, and every one simply absent from the
   * transcription. Dust knocks on doors: `SALUPPER.SET/0034` runs
   * `runpuppet ("ruby.pup")` for a click inside `pointinruby`, so the knock IS
   * the conversation and Ruby is never an actor on that landing at all. Without
   * it a leg walked to her door, said nothing, and `talkOut([301,201,...])`
   * reported a conversation that had never been started — a symptom three
   * gestures away from its cause.
   *
   * `clickAt(x, y)` is the core verb for exactly this: "a raw canvas pixel,
   * 512x384 — for movie buttons with no name". The rungs' coordinates are mostly
   * rectangle centres written as arithmetic, which folds here.
   */
  "p.fire",
];

/** what the game calls a key, and what a sheet calls it */
const KEYS: Record<string, string> = {
  uparrow: "ArrowUp",
  downarrow: "ArrowDown",
  leftarrow: "ArrowLeft",
  rightarrow: "ArrowRight",
  ".": "Escape",
};

/**
 * Split on a JS operator that is not inside brackets, quotes or parens.
 *
 * Hand-rolled because the operands are expressions: `num("x") >= 1` has parens
 * and quotes of its own, and a plain `split("||")` on a condition that contains
 * a string with two pipes in it would cut it in half.
 */
function splitOn(src: string, op: "||" | "&&"): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (depth === 0 && src.startsWith(op, i)) {
      parts.push(src.slice(start, i));
      i += op.length - 1;
      start = i + 1;
    }
  }
  parts.push(src.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * A rung's own predicate, as a sheet condition — the few shapes that recur.
 *
 * Only the ones that are certain: a guess here becomes a line that waits for
 * the wrong thing, which is worse than a comment saying what the rung waited
 * for. Everything else comes out as its source text in a TODO.
 */
function asCondition(js: string): string | null {
  // a rung passes these as thunks — `() => num("trotterphase") >= 1` — so the
  // arrow comes off before the condition underneath can be read
  const t = js.trim().replace(/^\(\s*\)\s*=>\s*/, "");
  /*
   * A JOIN FIRST, because the rungs' stop-conditions are mostly joins.
   *
   * Every hammer against a character stops on "either they answered OR their
   * phase moved on" — `!!question(p) || num("trotterphase") === 4`. Read one
   * half at a time this returned null and the line became a TODO, which is how
   * seven of them got there. `||` binds loosest in JS and `or` does in a sheet,
   * so the split is the same split, and one unreadable half still makes the
   * whole thing a TODO rather than half a condition.
   */
  for (const [js2, word] of [["||", "or"], ["&&", "and"]] as const) {
    const parts = splitOn(t, js2);
    if (parts.length > 1) {
      const each = parts.map(asCondition);
      return each.every((c) => c) ? each.join(` ${word} `) : null;
    }
  }
  let neg = false;
  let body = t;
  while (body.startsWith("!")) {
    neg = !neg;
    body = body.slice(1).trim();
  }
  const not = (c: string): string => (neg ? `!${c}` : c);
  let m = /^visible\(\s*["'`]([^"'`]+)["'`]\s*\)$/.exec(body);
  if (m) return not(`visible.${m[1].toLowerCase()}`);
  m = /^walking\(\s*["'`]([^"'`]+)["'`]\s*\)$/.exec(body);
  if (m) return not(`walking.${m[1].toLowerCase()}`);
  // `puppet` and not `talking`: the rung tests that the object EXISTS, which is
  // the earliest sign the gesture was taken. `talking` is `puppet.visible`, a
  // second or two later, and every one of those is a click this would still be
  // sending.
  if (/^p\.session\.puppet$/.test(body)) return not("puppet");
  // `question(p)` reads the bevel list; the sheet's `choosing` reads the
  // `eventWaiter` that put it there, which is the same question asked better —
  // an answered list stays framed and this cannot mistake one for a question.
  if (/^question\(\s*p\s*\)(\s*!==?\s*["'`]{2})?$/.test(body)) return not("choosing");
  // `owner ("shootingstar") === "got money"` — a local wrapper on `propowner`,
  // and the sheet has the condition already: `prop.<name> == <owner>`
  m = /^owner\(\s*["'`]([^"'`]+)["'`]\s*\)\s*(===?|!==?)\s*["'`]([^"'`]*)["'`]$/.exec(body);
  if (m && !neg) return `prop.${m[1].toLowerCase()} ${m[2].startsWith("!") ? "!=" : "=="} ${m[3]}`;
  m = /^star\(\s*["'`]([^"'`]+)["'`]\s*\)\s*(===?|!==?)\s*["'`]([^"'`]*)["'`]$/.exec(body);
  if (m && !neg) return `star.${m[1].toLowerCase()} ${m[2].startsWith("!") ? "!=" : "=="} ${m[3]}`;
  // `>=`, `<=`, `>` and `<` as well as equality: a phase test is usually a
  // threshold (`num("trotterphase") >= 1`), and the sheet's `global.` condition
  // takes all five operators.
  // `!==` as well as the rest: `num("blackout") !== -1` is how the mine's dark
  // legs wait, and the sheet's `global.` takes `!=` — read as equality-only,
  // those came out as TODOs for a condition the grammar could already say.
  const cmp = (js: string): string => (js.startsWith("!") ? "!=" : js.startsWith("=") ? "==" : js);
  m = /^num\(\s*["'`]([^"'`]+)["'`]\s*\)\s*(!==?|===?|>=|<=|>|<)\s*(-?\d+)$/.exec(body);
  if (m && !neg) return `global.${m[1].toLowerCase()} ${cmp(m[2])} ${m[3]}`;
  m = /^str\(\s*["'`]([^"'`]+)["'`]\s*\)\s*(!==?|===?)\s*["'`]([^"'`]*)["'`]$/.exec(body);
  if (m && !neg) return `global.${m[1].toLowerCase()} ${cmp(m[2])} ${m[3]}`;
  return null;
}

/**
 * THE OPPOSITE OF A CONDITION ALREADY WRITTEN DOWN.
 *
 * `!` glued to the front of a string is the opposite only when the string is one
 * atom. Glued to a comparison it changes what the comparison is ABOUT:
 * `!global.blackout != -1` is the accessor form — "is blackout set at all" —
 * negated and then compared to a number, which is not the opposite of anything
 * and is never what the loop meant. A mine leg waited on exactly that and
 * pressed ArrowLeft 3675 times in its sixty seconds.
 *
 * So anything that is not a bare atom is parenthesised first, which the grammar
 * takes (`!(choosing or puppet)`, engine/tests/speedrun-condition.ts). And a
 * negation already there comes off rather than doubling, because `!!x` is a
 * sheet reader's puzzle and this is the one place that can spare them it.
 */
const ATOM = /^[A-Za-z][\w.]*$/;
function negate(c: string): string {
  if (ATOM.test(c.slice(1)) && c.startsWith("!")) return c.slice(1);
  if (c.startsWith("!(") && closes(c, 1) === c.length - 1) return c.slice(2, -1);
  return ATOM.test(c) ? `!${c}` : `!(${c})`;
}

/** the `}` (or `)`, `]`) that closes the bracket at `from` */
function closes(src: string, from: number): number {
  const open = src[from];
  const shut = open === "{" ? "}" : open === "(" ? ")" : "]";
  let depth = 0;
  let quote = "";
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === open) depth++;
    else if (ch === shut && --depth === 0) return i;
  }
  return -1;
}

/** the gestures, as a shape — used to ask whether a body DOES anything */
const GESTURES = new RegExp(
  `\\b(${["p\\.fire", "p\\.press", ...CALLS.filter((c) => !c.startsWith("p."))].join("|")})\\s*\\(`,
);

/**
 * A LOCAL HELPER IS A MACRO, and inlining it is the only way its gestures land
 * where they happen.
 *
 * The rungs define twenty-odd — `const knock = async (what) => { p.fire(...) }`
 * — and a scanner that reads calls by position got both halves wrong at once:
 * the body was transcribed at the DEFINITION, which is above the walk that
 * should precede it, and the `knock(...)` calls were transcribed not at all.
 * Ruby's leg is the case the sheet was failing on: it knocked once, before
 * walking to her door, and then `talkOut([301,201,...])` reported "conversation
 * ended before saying 999" for a conversation the knock is supposed to START.
 *
 * ## Which ones are inlined is read off the BODY
 *
 * Not from a list of names, because a list of names is the thing that keeps
 * being incomplete. A helper whose body reaches a gesture is inlined; one whose
 * body only READS is returned as a name to excuse — `const gunUp = (): boolean
 * => ask (p, "propvisible", ["gunhand"]) === "1"` is a question about the world
 * and belongs in no sheet line at all.
 *
 * That distinction is also why this handles the non-async and expression-bodied
 * forms. An earlier version matched only `const NAME = async (…) => {`, and the
 * accounting immediately found what it had been skipping: `pressProp`, `dial`,
 * `turnDial`, `gunUp`, `reload`, `notch`, `sight` and a dozen more, some of them
 * gesturing.
 *
 * Textual, and deliberately so: the parameters are substituted by name and the
 * body is re-scanned as if it had been written out. A substitution that does not
 * make an argument literal (`walkTo(p, town, BESIDE[star])`) still comes out a
 * marked gap, which is the same answer it gave before — just in the right place.
 */
function inlineLocals(src: string): { text: string; reads: Set<string> } {
  /*
   * Both spellings of a helper. The arrow form is what most rungs use, and
   * `async function turnDial (p, name, to)` is what the mine's dials and the
   * mask puzzle use — nine calls and five, none of them inlined until the
   * accounting named them, because this pattern only knew `const`.
   */
  const DEF =
    /const (\w+) = (?:async )?\(([^)]*)\)(?:\s*:\s*[^=]+?)?\s*=>\s*|(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*[^{]+?)?\s*(?=\{)/g;
  const reads = new Set<string>();
  const defs = new Map<string, { params: string[]; body: string }>();
  const cuts: [number, number][] = [];

  /*
   * The definitions are found ONCE and kept, which is the fix for a bug that
   * left half of them in place.
   *
   * They used to be re-derived every pass — and a pass strips them, so the
   * second pass found none, hit `if (!defs.size) break` and stopped. Anything
   * called from INSIDE another helper's body therefore survived: `station ()`
   * was inlined, and the `closeIn (who)` in the body it inserted was never
   * looked at again. The accounting is what surfaced it, by naming six calls to
   * a helper the tool believed it had already dealt with.
   */
  for (const m of src.matchAll(DEF)) {
    const declared = m[1] ?? m[3];
    const paramText = m[2] ?? m[4] ?? "";
    if (!declared) continue;
    const from = m.index! + m[0].length;
    let bodyStart = from;
    let bodyEnd: number;
    if (src[from] === "{") {
      bodyEnd = closes(src, from);
      if (bodyEnd < 0) continue;
      bodyStart = from + 1;
    } else {
      // an expression body — to the end of the statement, brackets balanced
      let depth = 0;
      let i = from;
      for (; i < src.length; i++) {
        const ch = src[i];
        if ("([{".includes(ch)) depth++;
        else if (")]}".includes(ch)) {
          if (depth === 0) break;
          depth--;
        } else if (depth === 0 && (ch === ";" || ch === "\n")) break;
      }
      bodyEnd = i;
    }
    const body = src.slice(bodyStart, bodyEnd);
    const params = paramText
      .split(",")
      .map((a) => a.split(":")[0].split("=")[0].trim())
      .filter((a) => /^\w+$/.test(a));
    cuts.push([m.index!, bodyEnd + (src[from] === "{" ? 1 : 0)]);
    // a body that reaches no gesture is a READ, and a read is not a sheet line.
    // Asked of the body AFTER the others are known, below — a helper that only
    // calls another helper reaches a gesture through it.
    defs.set(declared, { params, body });
  }

  /** does this body reach a gesture, through however many helpers? */
  const acts = (body: string, depth = 0): boolean => {
    if (GESTURES.test(body)) return true;
    if (depth > 4) return false;
    for (const [name, def] of defs) {
      if (new RegExp(`\\b${name}\\s*\\(`).test(body) && acts(def.body, depth + 1)) return true;
    }
    return false;
  };
  for (const [name, def] of [...defs]) {
    if (!acts(def.body)) {
      reads.add(name);
      defs.delete(name);
    }
  }

  // the definitions themselves say nothing about when anything happens
  let text = "";
  let at = 0;
  for (const [from, to] of cuts.sort((a, b) => a[0] - b[0])) {
    text += src.slice(at, from);
    at = Math.max(at, to);
  }
  text += src.slice(at);
  if (!defs.size) return { text, reads };

  const NAME = new RegExp(`\\b(${[...defs.keys()].join("|")})\\s*\\(`, "g");
  for (let pass = 0; pass < 6; pass++) {
    let out = "";
    let i = 0;
    let changed = false;
    NAME.lastIndex = 0;
    for (const m of text.matchAll(NAME)) {
      if (m.index! < i) continue;
      const open = m.index! + m[0].length - 1;
      const shut = closes(text, open);
      const def = defs.get(m[1])!;
      if (shut < 0) continue;
      const args = split(text.slice(open + 1, shut));
      let body = def.body;
      def.params.forEach((name, n) => {
        const to = (args[n] ?? "").trim();
        if (to) body = body.replace(new RegExp(`\\b${name}\\b`, "g"), to);
      });
      out += text.slice(i, m.index!) + `{${body}}`;
      i = shut + 1;
      changed = true;
    }
    out += text.slice(i);
    text = out;
    if (!changed) break;
  }
  return { text, reads };
}

/**
 * A LOOP OF A KNOWN LENGTH, written out.
 *
 * Ruby needs three knocks — `rubyphase` 0 → 1 → 2 and only the third reaches the
 * plaques — and two of them are `for (const want of [1, 2])`. She then answers
 * 999 six times, from `for (let i = 0; i < 6; i++)`. Read as calls rather than
 * as control flow, both came out as one gesture, which is a leg that stops in
 * the middle of a conversation it half-had.
 *
 * ONLY a literal bound, and never a compound condition: `for (...; i < 4 &&
 * !visible("help"); i++) await p.press(...)` is a press-until and already
 * transcribed as one, so unrolling it would turn a condition back into a guess.
 * Capped, because a count this cannot read is better left to a TODO than
 * multiplied by something wrong.
 */
function unroll(src: string): string {
  const LOOP = /for\s*\(\s*(?:const|let)\s+\w+\s+of\s*\[([^\][]*)\]\s*\)\s*|for\s*\(\s*let\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*(\d+)\s*;\s*\w+\+\+\s*\)\s*/g;
  let text = src;
  for (let pass = 0; pass < 3; pass++) {
    let out = "";
    let i = 0;
    let changed = false;
    for (const m of text.matchAll(new RegExp(LOOP))) {
      if (m.index! < i) continue;
      const times = m[1] !== undefined ? split(m[1]).length : Number(m[2]);
      if (!(times >= 1 && times <= 8)) continue;
      const bodyAt = m.index! + m[0].length;
      let end: number;
      if (text[bodyAt] === "{") {
        end = closes(text, bodyAt);
        if (end < 0) continue;
        end += 1;
      } else {
        // a one-statement body, which is how the `answer` ladders are written
        end = text.indexOf(";", bodyAt);
        if (end < 0) continue;
        end += 1;
      }
      const body = text.slice(bodyAt, end);
      // nothing to repeat, so leave the loop alone rather than growing the text
      if (!/\b(p\.fire|p\.press|walkTo|answer|talkOut|clickActor|clickProp|clickThrough|openDoor|offerInTalk|offerTo|takeInHand|meet|dropOn|excuseUs|converse)\s*\(/.test(body)) continue;
      out += text.slice(i, m.index!) + `{${body}}`.repeat(times);
      i = end;
      changed = true;
    }
    out += text.slice(i);
    text = out;
    if (!changed) break;
  }
  return text;
}

/**
 * The source with its COMMENTS BLANKED OUT, positions preserved.
 *
 * These files document themselves with code, and the examples in their prose
 * are written in the same helpers as the calls — so a scan over the raw text
 * transcribes the documentation. `opening.ts` is where it showed: its header
 * discusses `dropOn` and the leg came out with two `# TODO dropOn()` lines for
 * calls that are not in the body at all.
 *
 * Blanked rather than removed so every offset still points where it did, which
 * is what keeps the emitted lines in source order.
 */
function decomment(src: string): string {
  const out = src.split("");
  let i = 0;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const to = end < 0 ? src.length : end + 2;
      blank(i, to);
      i = to;
    } else if (ch === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      const to = end < 0 ? src.length : end;
      blank(i, to);
      i = to;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) i += src[i] === "\\" ? 2 : 1;
      i++;
    } else {
      i++;
    }
  }
  return out.join("");
}

/** the whole argument list of `await name(` at `from`, parens balanced */
function argsAt(src: string, from: number): { args: string; end: number } | null {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return { args: src.slice(from + 1, i), end: i };
    } else if (ch === '"' || ch === "'" || ch === "`") {
      // skip a string, so a bracket inside a reply does not unbalance us
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) i += src[i] === "\\" ? 2 : 1;
    }
  }
  return null;
}

/** split an argument list on top-level commas */
function split(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let at = 0;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < args.length && args[i] !== quote) i += args[i] === "\\" ? 2 : 1;
    } else if (ch === "," && depth === 0) {
      out.push(args.slice(at, i).trim());
      at = i + 1;
    }
  }
  out.push(args.slice(at).trim());
  return out.filter((a) => a.length > 0);
}

const unquote = (s: string): string => s.replace(/^["'`]|["'`]$/g, "");
/**
 * A quoted LITERAL, or null.
 *
 * The guard that keeps the output parseable: plenty of call sites pass a
 * variable (`clickActor(p, who)`, `answer(p, reply, ...)`) and a sheet has no
 * spelling for one. Those came out as `click()` and `say([undefined])`, which
 * are two lines that fail to parse — worse than a marked gap, because a sheet
 * that will not parse cannot be run at all.
 */
const lit = (a?: string): string | null =>
  a && /^["'`][^"'`]*["'`]$/.test(a.trim()) ? unquote(a.trim()) : null;
/**
 * Constant arithmetic, folded — `(138 + 327) / 2` is 232.
 *
 * Whitelisted to digits, the four operators, parens and dots, so a name cannot
 * reach the evaluation: this is a build tool over the repo's own source, and the
 * point of the whitelist is that a computed expression comes back null and
 * becomes a TODO rather than something plausible.
 */
const fold = (a?: string): number | null => {
  const t = (a ?? "").trim();
  if (!t || !/^[\d\s().+*/-]+$/.test(t)) return null;
  try {
    const v = Number(new Function(`return (${t});`)());
    return Number.isFinite(v) ? Math.round(v) : null;
  } catch {
    return null;
  }
};

/** a NUMBER literal, or null — same reason */
const num = (a?: string): string | null => (a && /^-?\d+$/.test(a.trim()) ? a.trim() : null);
const label = (s?: string): string => (s && /^["'`]/.test(s) ? `   # ${unquote(s)}` : "");

/** `{ x: 213, y: 160 }` — a screen point, which is not a cell */
function goalXY(text: string): { x: string; y: string } {
  const x = /\bx:\s*(-?\d+)/.exec(text);
  const y = /\by:\s*(-?\d+)/.exec(text);
  // the route's own default when a caller leaves it out (route.ts) — the middle
  // of the screen, which is inside the region of most films that park
  return { x: x ? x[1] : "256", y: y ? y[1] : "190" };
}

/** `{ x: 6, z: 7, view: "west" }` */
function goal(s: string): { x: string; z: string; view: string } | null {
  const x = /\bx:\s*(-?\d+)/.exec(s);
  const z = /\bz:\s*(-?\d+)/.exec(s);
  const v = /\bview:\s*["'`]([^"'`]+)/.exec(s);
  return x && z ? { x: x[1], z: z[1], view: v ? v[1] : "" } : null;
}

/** `const town = set("TOWN")` — which set a variable stands for */
function setVars(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/\b(?:const|let)\s+([A-Za-z_][\w]*)\s*=\s*set2?\(\s*["'`]([^"'`]+)/g)) {
    out.set(m[1], m[2].toLowerCase().replace(/\.set$/, ""));
  }
  return out;
}

/**
 * EVERY CALL IS ACCOUNTED FOR, and this table is the half that says "not a
 * gesture".
 *
 * The scan below used to look for calls it KNEW and emit nothing for the rest,
 * which is a translator that cannot tell "the rung does not do that" from "I do
 * not read that". Five separate bugs were the same bug wearing that hat: the raw
 * click was absent from the call list and 105 knocks vanished; a locally-defined
 * helper had its body transcribed at the definition and its call sites dropped;
 * a `for` of known length contributed one gesture instead of three. Each was
 * found by a run dying somewhere downstream, which is the most expensive way to
 * find anything.
 *
 * So it is inverted. Every call site in a rung's body is either transcribed, or
 * named HERE as something that reads or asserts, or it comes out as a marked
 * gap. A name earns a place in this list by not touching the game — a read
 * (`num`, `ask`, `room`), a wait the sheet expresses another way (`p.pump`,
 * `p.settle`), or an assertion (`expect`, `Error`). Nothing goes in it because
 * the output was noisy.
 *
 * The consequence is that the TODO count is now a MEASUREMENT rather than a
 * mood: it can only be reduced by transcribing something or by declaring it,
 * and a new construct in a rung raises it instead of disappearing.
 */
const NOT_A_GESTURE = new Set([
  // the harness's own pumping and waiting — a sheet says these with `wait`,
  // `after:` and the verbs' own settle, never as a line of its own
  "p.pump", "p.settle", "p.tick", "p.v", "p.host", "p.logs", "p.session",
  // reads: where we are, what is held, who is about, what a global says
  "ask", "num", "str", "number", "room", "set", "setFile", "owner", "global",
  "globals.get", "alive", "held", "talking", "walking", "question", "flat",
  "clock", "deg", "point", "cell", "cellOf", "cells", "view", "scene", "scenes",
  "at", "there", "g", "star", "sprite", "stage", "given", "want", "cash",
  "valueAt", "dialValueAt", "notchOf", "wayOutOf", "aimAt", "byValue",
  // the suite's assertions
  "expect", "Error", "console.log", "console.warn",
  // reading a script's own tables, to decide what to press — not a press
  "propScripts.get", "castScripts.get", "shopMains.get", "shops.get",
  "puppetScripts.get", "interp.builtins.get",
  // engine READS reached through the session — where we are, what is under a
  // point, which shop is open. `session.track`, `session.setPointer` and
  // `puppetCtrl.puppetChoose` are deliberately NOT here: those act.
  "currentSceneName", "currentViewName", "currentSetFile", "currentFlat",
  "hitTestAt", "shopMain", "propRuntime", "actorRuntime", "propUnder", "propAt",
  // TypeScript and arrow syntax the call scan cannot tell from a call:
  // `x as (…)` is a cast and `async (…) =>` is a function being written down
  "as", "async",
]);

/**
 * Language, rather than game: builtins and the methods any array or string
 * carries. A shape rather than a list because the list is unbounded and none of
 * it can reach the engine.
 *
 * Deliberately does NOT excuse a method on an engine object — `session.track`,
 * `session.openShop`, `interp.runHandler` and `puppetCtrl.puppetChoose` all poke
 * the game directly and a rung reaching for one is doing something a sheet has
 * no verb for, which is exactly what wants marking.
 */
const LANGUAGE_GLOBAL = /^(Math|JSON|Object|Array|Number|String|Boolean|Promise|Set|Map|Date)\b/;

/**
 * The methods any array, string or table carries. A set of NAMES rather than a
 * path pattern, because the name is the only part that says what it does: the
 * object in front of `.get` is a table whether it is `globals`, `propScripts` or
 * something the rung built for itself.
 *
 * Deliberately does NOT excuse a method that ACTS on the engine —
 * `session.track`, `session.openShop`, `interp.runHandler` and
 * `puppetCtrl.puppetChoose` are all a rung reaching past the vocabulary, which
 * is exactly what wants marking.
 */
const LANGUAGE_METHOD = new Set([
  "toLowerCase", "toUpperCase", "startsWith", "endsWith", "includes", "indexOf",
  "lastIndexOf", "slice", "splice", "split", "join", "trim", "replace",
  "replaceAll", "match", "map", "flatMap", "filter", "some", "every", "find",
  "findIndex", "forEach", "push", "pop", "shift", "unshift", "sort", "reverse",
  "has", "get", "set", "add", "delete", "entries", "keys", "values", "concat",
  "padStart", "padEnd", "repeat", "toFixed", "isFinite", "isInteger", "from",
  "round", "floor", "ceil", "abs", "min", "max", "hypot", "trunc", "cos", "sin",
  "sign", "pow", "sqrt", "flat", "at", "reduce", "flatMap",
]);

/**
 * A call the accounting may pass over in silence.
 *
 * Judged on the LAST segment of a dotted name, which is the fix for the first
 * version of this: it tested the whole path, so `room (p).toLowerCase ()` came
 * through as the bare name `toLowerCase` and matched nothing, and the sheet came
 * out with 892 marked gaps of which 500 were the string methods of the language.
 * A loud tool that is loud about everything says as little as a quiet one.
 *
 * `reads` is the set {@link inlineLocals} derived from the rung itself — local
 * helpers whose bodies reach no gesture.
 */
const excused = (name: string, reads: Set<string>): boolean => {
  const last = name.split(".").pop()!;
  if (reads.has(last) || reads.has(name)) return true;
  if (NOT_A_GESTURE.has(name) || NOT_A_GESTURE.has(last)) return true;
  if (LANGUAGE_GLOBAL.test(name)) return true;
  return LANGUAGE_METHOD.has(last);
};

/**
 * The spans of every string literal, so PROSE is not read as code.
 *
 * `decomment` blanks comments and steps over strings without touching them,
 * which is right for the transcription — a label is an argument. It is wrong for
 * the accounting: the rungs describe the game in their own error messages and
 * waits, in the game's own vocabulary, and `throw new Error("openfight () did
 * not arm us")` and `p.pump (…, "dotbird () to open the temple")` came out as
 * calls to something the tool did not recognise. Marking those is worse than
 * missing them — a gap that is not a gap teaches a reader to skim the list.
 */
function stringSpans(src: string): [number, number][] {
  const spans: [number, number][] = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch !== '"' && ch !== "'" && ch !== "`") continue;
    const from = i++;
    while (i < src.length && src[i] !== ch) i += src[i] === "\\" ? 2 : 1;
    spans.push([from, i]);
  }
  return spans;
}

/** every call site in the body, whatever it is — the other half of the accounting */
function callSites(src: string): { at: number; end: number; name: string; args: string }[] {
  const out: { at: number; end: number; name: string; args: string }[] = [];
  const spans = stringSpans(src);
  const inString = (at: number): boolean => spans.some(([from, to]) => at > from && at < to);
  const RE = /(?:\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\.\s*)?\b([A-Za-z_$][\w$]*)\s*\(/g;
  for (const m of src.matchAll(RE)) {
    if (inString(m.index!)) continue;
    const name = m[1] ? `${m[1]}.${m[2]}` : m[2];
    // keywords that take a parenthesis and are not calls at all
    if (/^(if|for|while|switch|catch|return|typeof|function|await|new|do|else)$/.test(m[2])) continue;
    // `async play (p) {` is the method being DEFINED, not a call to anything
    if (/\b(async|function)\s+$/.test(src.slice(Math.max(0, m.index! - 10), m.index!))) continue;
    const open = m.index! + m[0].length - 1;
    const got = argsAt(src, open);
    if (got) out.push({ at: m.index!, end: got.end, name, args: got.args });
  }
  return out;
}

export function transcribe(raw: string, inherited?: Map<string, string>): string[] {
  // control flow FIRST, then the scan: a local helper's gestures have to be
  // where the call is, and a loop of a known length has to be as long as it is
  const inlined = inlineLocals(decomment(raw));
  const src = unroll(inlined.text);
  const sets = new Map([...(inherited ?? []), ...setVars(src)]);
  const out: string[] = [];
  const seen: { at: number; end: number; name: string; args: string }[] = [];
  for (const name of CALLS) {
    const pattern = name.includes(".")
      ? name.replace(/\./g, "\\.") + "\\s*\\("
      : `\\b${name}\\s*\\(`;
    for (const m of src.matchAll(new RegExp(pattern, "g"))) {
      const open = m.index! + m[0].length - 1;
      const got = argsAt(src, open);
      if (got) seen.push({ at: m.index!, end: got.end, name, args: got.args });
    }
  }
  seen.sort((a, b) => a.at - b.at);
  /*
   * A NESTED CALL BELONGS TO THE ONE AROUND IT.
   *
   * `clickThrough(p, () => p.fire(x, y), ...)` is one gesture with a thunk
   * inside it, and matching both emitted the click twice — once on its own and
   * once inside whatever the outer helper became. Latent until `p.fire` was
   * transcribed at all, because until then nothing that appears as an argument
   * was in the list.
   */
  /*
   * ...and every call the list did NOT know, so it is marked rather than lost.
   * Merged into the same ordered walk so a gap appears where it happens, between
   * the gestures either side of it.
   */
  const known = new Set(seen.map((c) => `${c.at}`));
  for (const site of callSites(src)) {
    if (known.has(`${site.at}`) || excused(site.name, inlined.reads)) continue;
    seen.push({ ...site, name: "\u0000unaccounted" });
  }
  seen.sort((a, b) => a.at - b.at || b.end - a.end);
  const outermost: typeof seen = [];
  for (const call of seen) {
    const inside = outermost[outermost.length - 1];
    if (inside && call.at > inside.at && call.at < inside.end) continue;
    outermost.push(call);
  }

  for (const call of outermost) {
    if (call.name === "\u0000unaccounted") {
      // the SOURCE, not a summary: whoever closes this gap needs the line, and a
      // paraphrase of a call this tool did not understand is a paraphrase of
      // something nobody has read yet
      const text = src.slice(call.at, Math.min(call.end + 1, call.at + 120)).replace(/\s+/g, " ");
      out.push(`# TODO not transcribed: ${text}`);
      continue;
    }
    const a = split(call.args);
    // every helper takes the pump first; drop it
    const rest = a[0] === "p" ? a.slice(1) : a;
    switch (call.name) {
      case "walkTo": {
        const g = goal(rest[1] ?? "");
        const room = sets.get(rest[0]) ?? "";
        if (!g) { out.push(`# TODO walkTo with a computed goal: ${call.args.replace(/\s+/g, " ").slice(0, 80)}`); break; }
        out.push(
          `goto(${g.x}, ${g.z}${g.view ? `, ${g.view}` : ""}${room ? `, set: ${room}` : ""})` +
            (rest[2] ? `   # the rung also passes ${rest[2]}` : ""),
        );
        break;
      }
      case "answer": {
        const id = num(rest[0]);
        out.push(
          !id
            ? `# TODO answer(${rest[0]}) — a computed reply; the id is in the rung`
            : // -1 is not a plaque, it is ESC: answering -1 ENDS a conversation
              // (#131), which is the verb `bailOut` exists to be. The bevel
              // grammar takes no negative numbers for the same reason.
              Number(id) < 0
              ? `bailOut()${label(rest[1])}`
              : // `answer` waits for a question that is not the one just
                // answered; `say` on its own answers what is on screen. So the
                // wait comes with it, shorter than `talkOut`'s because a reply
                // mid-conversation is not waiting for somebody to walk over.
                //
                // Its FOURTH argument, the question just answered, is NOT
                // transcribed. The rung needs it because it reads the bevel
                // list, which stays framed after being answered; `converse`
                // reads `eventWaiter` and cannot see a spent plaque at all.
                // These lines get gathered into one `say` below, which is where
                // that wait properly lives.
                /*
                 * `then: stop` IS PART OF WHAT `answer` MEANS.
                 *
                 * It answers ONE plaque and returns, leaving the conversation
                 * standing for the next call. `say` without `then:` falls
                 * through to `otherwise:` when its list runs out, whose default
                 * is to THROW — so a faithful-looking `say([103])` answered 103,
                 * the conversation asked its next question, and the line failed
                 * on a plaque it was never meant to answer: "unplanned choice
                 * from help1.pup: ...". Seven legs of a sweep died that way, and
                 * the message did not print the ids, so it read like the reply
                 * having been spent by something else.
                 */
                `say([${id}], then: stop, patience: 20000)${label(rest[1])}`,
        );
        break;
      }
      case "talkOut": {
        /*
         * `LEAVING` is a name in the rungs and a list of numbers in a sheet, so
         * it is expanded here rather than passed through — the route's own
         * order of preference (route.ts): the high numbers first, because an
         * author reaching for 301 is reaching for a door.
         */
        const ids = (rest[0] ?? "")
          .replace(/[[\]\s]/g, "")
          .replace(/\bLEAVING\b/g, "301,201,104,102,101,103");
        /*
         * `patience:` IS PART OF THE TRANSCRIPTION, not a safety margin.
         *
         * `talkOut` waits for the first word before waiting for the last — its
         * own first act is to pump up to 120 times for a puppet to appear —
         * because somebody who has to walk to you is not talking yet when the
         * route reaches the line. `say` without `patience:` answers whoever is
         * talking NOW, so the wait has to be written down or it is lost.
         *
         * Reported from a real run at the boot's own first line: "conversation
         * ended before saying 104 (picked nothing)", standing at the standpoint
         * the boot leaves you on — the conversation the boot opens had not
         * opened yet.
         */
        /*
         * `talkOut` IS ITS OWN VERB, and `say([...], then: leave)` is not it.
         *
         * The list is an order of PREFERENCE — whichever of them the plaque
         * carries — and nobody talking is a normal outcome rather than a
         * failure. Transcribed as `say`, seven legs of a sweep failed in a row
         * with "conversation ended before saying 301,201,104,102,101,103
         * (picked nothing)".
         */
        out.push(
          /^-1$/.test(ids)
            ? `bailOut()${label(rest[1])}`
            : /^[\d,]+$/.test(ids)
              ? `talkOut([${ids}])${label(rest[1])}`
              : `# TODO talkOut with computed replies (${ids}) — read them off the rung`,
        );
        break;
      }
      case "clickActor": {
        /*
         * A PERSON IS ACCOSTED, not clicked.
         *
         * `clickActor` is one press and `accost` is "press until they are
         * actually talking, turning if they are not in reach" — and the second
         * is what these call sites mean. Clicking somebody starts a WALK to
         * them and the puppet only opens once they have been reached, so a
         * press can be taken, be aimed correctly, and produce no conversation
         * at all; and half of this game's characters are walking when a route
         * arrives, which is the case a single click cannot see.
         *
         * It is also faster than the alternative the rungs use. A Dust
         * character accosts YOU once you have stood in front of them long
         * enough — `GANG.CST`'s idle scripts arm `hasattention (n)`, whose
         * firing is `sendtoactor (target, mousedown (0))` — so waiting is
         * waiting out a timer for a gesture a run can simply make.
         */
        const who = lit(rest[0]);
        if (!who) {
          out.push(`# TODO clickActor(${rest[0]}) — a computed name; it is in the rung`);
          break;
        }
        /*
         * A `clickActor` WITH AN `until` IS A HAMMER, not one press.
         *
         * `clickActor(p, "trotter", "...", 40, () => num("trotterphase") >= 1)`
         * presses until a phase moves, and three of those in a row are three
         * knocks that each advance one step — Ruby's landing is the same shape.
         * `accost` returns the moment somebody is talking, so it would make the
         * first knock and skip the other two. `hammer` is the verb for "press
         * this thing until something is true".
         *
         * A BARE one is a `meet`: walk to wherever they have got to and press.
         * `accost` only turns where it stands, and the sweep found what that
         * costs — "accost(mwife) turned the whole ring and mwife never started
         * talking", with her in the room and three cells away.
         */
        const until = rest.length >= 4 ? asCondition(rest[3]) : null;
        out.push(
          until
            ? // `gap:` because a person is not a plaque. `hammer`'s default is
              // one press per frame, and the sweep caught it clicking Trotter
              // 173 times in ten seconds — the rung's own `clickActor` waits
              // between presses, and a character walking over to answer needs
              // that beat or every press after the first lands on the walk.
              `hammer(${who.toLowerCase()}, until: ${until}, gap: 1500, budget: 60000)${label(rest[1])}`
            : rest.length >= 4
              ? `# TODO clickActor(${who}) presses until \`${rest[3]}\` — say that as a condition${label(rest[1])}`
              : `meet(${who.toLowerCase()})${label(rest[1])}`,
        );
        break;
      }
      case "clickProp": {
        const what = lit(rest[0]);
        out.push(
          what
            ? `click(${what.toLowerCase()})${label(rest[1])}`
            : `# TODO clickProp(${rest[0]}) — a computed name; it is in the rung`,
        );
        break;
      }
      case "takeInHand": {
        const it = lit(rest[0]);
        out.push(
          it
            ? `takeInHand(${it.toLowerCase()})${label(rest[1])}`
            : `# TODO takeInHand(${rest[0]}) — a computed item`,
        );
        break;
      }
      case "offerInTalk": {
        const it = lit(rest[0]);
        out.push(
          it
            ? `offer(${it.toLowerCase()})${label(rest[1])}`
            : `# TODO offerInTalk(${rest[0]}) — a computed item`,
        );
        break;
      }
      case "openDoor": {
        const box = (rest[0] ?? "").replace(/[[\]]/g, "").split(",").map((n) => n.trim());
        const owner = unquote(rest[1] ?? "").toLowerCase();
        if (box.length !== 4) {
          out.push(`# TODO openDoor with a computed rectangle: ${call.args.replace(/\s+/g, " ").slice(0, 70)}`);
          break;
        }
        /*
         * THE STANDPOINT COMES FIRST, and dropping it was worth two whole legs.
         *
         * `openDoor`'s fourth argument is where the door is clicked from, and it
         * is RE-TAKEN before every try: "a click only reaches a door from the
         * cell and facing whose script owns it, and the world turns you around".
         * Every one of the twenty-nine doors in `segments.ts` carries one.
         *
         * Without it the sweep reported the hotel door twice over — "the door
         * did not open — its prop is not 'hotel', standing at nite Scene K11
         * south" — from a standpoint two cells and a facing away from the one
         * the rung walks to.
         *
         * The set is either a variable the file bound with `set("NITE")` or that
         * call written inline; both are read.
         */
        const from = rest[3] ?? "";
        const g = goal(from);
        const inline = /set2?\(\s*["'`]([^"'`]+)/.exec(from);
        const room =
          (inline ? inline[1].toLowerCase().replace(/\.set$/, "") : "") ||
          sets.get((/set:\s*([A-Za-z_][\w]*)/.exec(from) ?? [])[1] ?? "") ||
          "";
        if (g) {
          out.push(
            `goto(${g.x}, ${g.z}${g.view ? `, ${g.view}` : ""}${room ? `, set: ${room}` : ""})` +
              `   # the standpoint this door is opened from`,
          );
        }
        out.push(`doorAt(${box.join(", ")}${owner ? `, owner: ${owner}` : ""})${label(rest[2])}`);
        break;
      }
      case "excuseUs":
        out.push(`bailOut()${label(rest[0])}`);
        break;
      case "converse": {
        const who = lit(rest[0]);
        const id = num(rest[1]);
        if (!id) {
          out.push(`# TODO converse(${rest[0]}, ${rest[1]}) — a computed reply`);
        } else if (Number(id) < 0) {
          // -1 is ESC, which ANSWERS a plaque and ends the conversation
          out.push(`bailOut()${label(rest[3])}`);
        } else {
          out.push(who ? `talk(${who.toLowerCase()}[${id}])${label(rest[3])}` : `say([${id}])${label(rest[3])}`);
        }
        break;
      }
      case "meet": {
        // `meet` and `accost` are one idea: get through to somebody who may be
        // walking. The verb is the engine's now, so this is no longer a gap.
        // `meet` is its own verb now: `accost` turns the ring where it stands,
        // and this walks to wherever they have got to. Flattening one into the
        // other is what left `accost(jones)` turning four ways at an empty
        // street with Jones three cells up the town.
        const who = lit(rest[1]);
        out.push(
          who
            ? `meet(${who.toLowerCase()})${label(rest[2])}`
            : `# TODO meet(${rest[1]}) — a computed name`,
        );
        break;
      }
      case "dropOn": {
        /*
         * The target is a POINT in the rung and a NAME in a sheet — but the
         * point is usually aimed by name anyway: `dropOn(p, "bone",
         * aimAt("dog"), "the Bone")`. So when it is, that is the name `give`
         * wants, and the line comes out whole.
         */
        const it = lit(rest[0]);
        const named = /aimAt\w*\(\s*["'`]([^"'`]+)/.exec(rest[1] ?? "");
        out.push(
          it && named
            ? `give(${it.toLowerCase()}, to, ${named[1].toLowerCase()})${label(rest[2])}`
            : `# TODO dropOn(${rest[0]}, ${rest[1]}) — the target is a computed point, ` +
              `so who is standing there is in the rung`,
        );
        break;
      }
      case "offerTo":
        out.push(
          `# TODO offerTo(${unquote(rest[0] ?? "")}, ${unquote(rest[1] ?? "")}): the harness's ` +
            `shortcut, which runs offerobject() with no gesture. As a route this is ` +
            `give(${unquote(rest[1] ?? "").toLowerCase()}, to, ${unquote(rest[0] ?? "").toLowerCase()}) or offer(...)`,
        );
        break;
      case "clickThrough": {
        /*
         * A gesture, then clicks until something is done — and all three parts
         * are readable, which is why this stopped being a TODO.
         *
         *     clickThrough(p, () => p.fire(206, 220),
         *                  () => owner("shootingstar") === "got money",
         *                  "the dollar behind the poster", { x: 213, y: 160 })
         *
         * The gesture's own point is folded out of the thunk, the stop is read
         * as a condition, and the fifth argument is where the film is clicked if
         * it parks. `clickAt`'s `until:` is the same shape: it waits a beat for a
         * film that finishes by itself before pressing anything into it.
         *
         * Eleven of these, and the one in `D1E_006` is where a continuous run
         * stopped — `HOTLOWER.SET/0044`'s `playercash = playercash + 4` is the
         * only pay-out of its kind in the corpus, and the leg's own assertion
         * (`wait(global.playercash == 776)`) is what named it.
         */
        // balanced, not `[^)]*`: the point is written as arithmetic and the
        // arithmetic has parentheses of its own — `p.fire ((119 + 293) / 2, …)`
        const thunk = rest[0] ?? "";
        const opens = thunk.indexOf("(", thunk.indexOf("p.fire"));
        const got = thunk.includes("p.fire") && opens >= 0 ? argsAt(thunk, opens) : null;
        const gesture = got ? split(got.args).map(fold) : [null, null];
        const done = asCondition(rest[1] ?? "");
        const spot = rest[3] ? goalXY(rest[3]) : { x: "256", y: "190" };
        if (gesture.some((n) => n === null) || !done) {
          out.push(
            `# TODO clickThrough: ${!done ? `the stop \`${(rest[1] ?? "").replace(/\s+/g, " ").slice(0, 60)}\` is not a condition this reads` : "the gesture is not a plain point"}`,
          );
          break;
        }
        out.push(`clickAt(${gesture[0]}, ${gesture[1]}, wait: quiet)${label(rest[2])}`);
        out.push(
          `clickAt(${spot.x}, ${spot.y}, until: ${done}, gap: 500, budget: 45000)` +
            `   # click the film through, if it parks`,
        );
        break;
      }
      case "p.fire": {
        /*
         * The knock, and it is nearly always a rectangle's CENTRE written as
         * arithmetic — `p.fire((138 + 327) / 2, (2 + 263) / 2)`, straight off
         * the `pointinruby` bounds in the decompiled set script. So the two
         * arguments are folded rather than parsed: constant arithmetic only, and
         * anything with a name in it (`p.fire(aim.x, aim.y)`) is a TODO, because
         * a guess at where a computed point lands is a click somewhere else.
         */
        const at = [rest[0], rest[1]].map(fold);
        if (at.some((n) => n === null)) {
          out.push(`# TODO p.fire(${(rest.slice(0, 2).join(", ") || "").replace(/\s+/g, " ")}) — a computed point; it is in the rung`);
          break;
        }
        /*
         * `wait: quiet` because the rung's own next line is `p.settle`, and a
         * knock is not finished when the click is taken — `runpuppet` still has
         * to load. The sheet's `quiet` is `quiescent || conversing`, so it is
         * strictly more permissive than what the rung waits for and cannot hang
         * where the rung does not.
         */
        out.push(`clickAt(${at[0]}, ${at[1]}, wait: quiet)${label(rest[2])}`);
        break;
      }
      case "p.press": {
        const raw = lit(rest[0]);
        const name = raw ? (KEYS[raw.toLowerCase()] ?? raw) : null;
        if (!name) {
          out.push(`# TODO p.press(${rest[0]}) — a computed key`);
          break;
        }
        /*
         * A press in a LOOP is a press-until, and that is the whole gesture —
         * see the note on `key`'s `until:`. The loop's own condition is right
         * there in the `for (...)` on the same line, so it is read rather than
         * turned into a repeat count.
         */
        const before = src.slice(Math.max(0, call.at - 240), call.at);
        // `)` then `await` then the press, which is how the one-line form reads:
        //   for (let i = 0; i < 4 && !visible("help"); i++) await p.press(...)
        const loop = /for\s*\([^;]*;[^;]*?&&\s*([^;]+?);[^;]*\)\s*(?:await\s+)?$/.exec(before);
        /*
         * A LOOP'S CONDITION IS THE OPPOSITE OF AN `until:`.
         *
         * `for (...; i < 4 && !visible("help"); i++)` keeps pressing WHILE he is
         * not out; `until:` is where to stop, which is when he is. Transcribed
         * without the flip it came out `until: !visible.help` — a hammer that
         * stops immediately, on a condition that is already true, so the press
         * would have gone in once and the leg would have failed two lines later
         * exactly as it did before the press was transcribed at all.
         */
        const going = loop ? asCondition(loop[1]) : null;
        const cond = going ? negate(going) : null;
        /*
         * AND THEN GET PAST WHAT THE PRESS CAUSED.
         *
         * A press-until exists because the press does something other than move
         * you, and in this game that something is usually a film: the growl is
         * `spotmovie ("dog1.mov")` before it is anything else. The next gesture
         * must not land in it. A `spotmovie` suspends the puppet underneath, so
         * `conversing` reads neither yes nor no while it runs, and a click made
         * in that gap arrives on the plaque that appears afterwards — which is
         * how the help character's first reply came to be spent by the line that
         * was only trying to open his conversation ("unplanned choice from
         * help1.pup", with 103 already gone).
         *
         * `skipMovie(until: quiet)` is safe against an open conversation in a way
         * a bare ESC is not: the engine hands keys to a playing movie FIRST
         * (`SetViewer.keyDown`), and `quiet` counts a conversation as settled, so
         * it stops the moment somebody starts talking.
         */
        out.push(
          cond
            ? `key(${name}, until: ${cond}, budget: 60000)${label(rest[1])}\nskipMovie(until: quiet, budget: 60000)   # past what that press started`
            : loop
              ? `# TODO key(${name}) is pressed until \`${loop[1].trim()}\` — say that as a condition` +
                `${label(rest[1])}`
              : `key(${name})${label(rest[1])}`,
        );
        break;
      }
    }
  }
  return coalesce(out);
}

/**
 * Consecutive `say([n])` lines, gathered into one.
 *
 * `converse` walks a bevel LIST, waiting for each plaque in turn — which is what
 * three consecutive `answer` calls are, and saying it in one line is both
 * shorter and more robust than three lines each racing its own plaque. It is
 * also how a hand-written sheet says it: `talk(help[103,102,101])`.
 *
 * Only where nothing sits between them, and only where they carry no differing
 * options, so a `then:` or a `patience:` cannot be lost in the gathering.
 */
function coalesce(lines: string[]): string[] {
  const out: string[] = [];
  let run: { ids: string[]; labels: string[] } | null = null;
  const flush = (): void => {
    if (!run) return;
    out.push(
      `say([${run.ids.join(",")}], then: stop, patience: 20000)` +
        (run.labels.length ? `   # ${run.labels.join(" / ")}` : ""),
    );
    run = null;
  };
  for (const line of lines) {
    const m = /^say\(\[(\d+)\], then: stop, patience: 20000\)(?:   # (.*))?$/.exec(line);
    if (m) {
      /*
       * REPEATS GATHER TOO, and Gus is why it is worth saying so.
       *
       * `answer(p, 101, "I'm mighty thirsty, Gus.")` then `answer(p, 101,
       * "Whiskey...")` is `say([101,101])`, and that is correct: `converse`
       * holds for `!awaitingChoice` after every pick, so the second 101 can only
       * land on a plaque the engine parked AFTER the first was consumed.
       *
       * This split them for a while, on the theory that a list could answer one
       * plaque twice. It cannot. What actually failed was the missing `then:` —
       * the list ran out, Gus asked his main menu, and `otherwise:`'s default
       * threw: "unplanned choice from gus.pup: Care to chat? | Would you like
       * something...? | Bye, Gus." One line with `then: stop` is both shorter
       * and the fix.
       */
      run ??= { ids: [], labels: [] };
      run.ids.push(m[1]);
      // an unrolled loop repeats its label as well as its gesture, and six
      // copies of "Ruby, plaque set ${i + 1}" says less than one does
      if (m[2] && !run.labels.includes(m[2])) run.labels.push(m[2]);
      continue;
    }
    flush();
    out.push(line);
  }
  flush();
  return out;
}

/** the ladder's save order, so --all comes out as the route runs */
function ladderOrder(): string[] {
  const md = readFileSync(LADDER, "utf8");
  return md
    .split("\n")
    .filter((l) => /^\|\s*\d+\s*\|/.test(l))
    .map((l) => l.split("|")[2].trim().replace(/`/g, "").toLowerCase().replace(/_/g, ""));
}

/**
 * The first thirteen rungs live in `segments.ts` rather than in `rungs/`, one
 * exported `segmentN` each, and the file's set bindings are at its top rather
 * than inside any of them — so the whole file's `set(...)` map is handed to
 * every slice.
 */
export function segments(): { name: string; what: string; from: string; to: string; lines: string[] }[] {
  const src = readFileSync(SEGMENTS, "utf8");
  const shared = setVars(src);
  const marks = [...src.matchAll(/export const (segment\d+): Segment = \{/g)];
  return marks.map((m, i) => {
    const from = m.index!;
    const to = i + 1 < marks.length ? marks[i + 1].index! : src.length;
    const body = src.slice(from, to);
    // the quote is DOUBLE and the text has apostrophes in it — "the Mayor's wife
    // takes you home" was coming out as "the Mayor" against a looser class
    const what = /what:\s*"([^"]+)"/.exec(body);
    const a = /from:\s*"([^"]+)"/.exec(body);
    const b = /to:\s*"([^"]+)"/.exec(body);
    return {
      name: m[1] + (what ? ` — ${what[1]}` : ""),
      what: what ? what[1] : "",
      from: a ? a[1] : "",
      to: b ? b[1] : "",
      lines: transcribe(body, shared),
    };
  });
}

/** one rung, by the name of its file */
/**
 * The globals a rung CLAIMS, by name — its own `claims: [...]`.
 *
 * Lives here rather than in `mkrunsheet.ts` because `RUNGS` does, and reading a
 * rung is this file's job. Read with a regex for the reason everything else here
 * is: importing 55 modules to get one array from each would pull the whole
 * playthrough harness, and its disc, into a build tool.
 */
export function claims(name: string): string[] {
  let src = "";
  try {
    src = readFileSync(`${RUNGS}/${name}.ts`, "utf8");
  } catch {
    return [];
  }
  const m = /\bclaims:\s*\[([\s\S]*?)\]/.exec(src);
  if (!m) return [];
  return [...m[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((q) => q[1].toLowerCase());
}

export function rung(name: string): string[] | null {
  const file = `${RUNGS}/${name}.ts`;
  try {
    return transcribe(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const args = process.argv.slice(2);
const have = new Set(readdirSync(RUNGS).filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, "")));
const wanted =
  args[0] === "--all"
    ? ["opening", ...ladderOrder()].filter((n, i, all) => have.has(n) && all.indexOf(n) === i)
    : args.filter((a) => !a.startsWith("-"));

const DIRECT = process.argv[1]?.endsWith("rung2sheet.ts") ?? false;
if (DIRECT && !wanted.length && args[0] !== "--all" && args[0] !== "--segments") {
  console.error(`usage: npx tsx dust/tools/rung2sheet.ts <rung>|--all\n  rungs: ${[...have].sort().join(" ")}`);
  process.exit(1);
}
const emit = (name: string, lines: string[]): void => {
  console.log(`# ---- ${name} ${"-".repeat(Math.max(0, 62 - name.length))}`);
  console.log(lines.join("\n") || "# (nothing this tool can transcribe)");
  console.log(`split(${name.split(" ")[0]})`);
  console.log();
};

if (DIRECT && (args[0] === "--all" || args[0] === "--segments")) {
  for (const seg of segments()) emit(seg.name, seg.lines);
}
if (DIRECT && args[0] !== "--segments") {
  for (const name of wanted) {
    if (!have.has(name)) {
      console.log(`# no rung called ${name}`);
      continue;
    }
    emit(name, transcribe(readFileSync(`${RUNGS}/${name}.ts`, "utf8")));
  }
}
