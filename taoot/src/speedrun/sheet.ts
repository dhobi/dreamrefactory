/**
 * The speedrun sheet — the run as a list of actions, in text.
 *
 * A sheet is data, not code. That is the whole point of it: a speedrun is tuned
 * by moving one line, changing one bevel, shaving one wait, and running it again
 * — and none of that should mean editing TypeScript, recompiling, or reasoning
 * about whether a helper is shared with the route the playthrough suite asserts.
 * `taoot/tests/playthrough` is the ORACLE and does not move; this is the stopwatch.
 *
 * ## The grammar
 *
 * Every action is a CALL. One per line, `#` to the end of the line is a comment:
 *
 *     up()                              # a bare action
 *     right(); up(); space()            # three actions on one line
 *     clickAt(169, 311)                 # positional arguments, comma separated
 *     closeUp(memory, by: esc)          # ...and named ones after them
 *     talk(purser[1,3,5])               # bevel ids, in the order they're offered
 *     wait(set == c73, budget: 90000)   # a condition, then a named argument
 *     left(x3)                          # the same action three times
 *     split(flat scored)                # the whole inside is the name
 *
 * Four token shapes inside the brackets, separated by commas:
 *
 *   - a bare word is a positional argument (`click(cards)`)
 *   - `name: value` is a named argument (`by: esc`, `until: quiet`, `wait: none`)
 *   - `name == value` / `name.thing` is a CONDITION — never an argument
 *   - `xN` is a repeat count (`left(x3)`)
 *   - `word[1,3,5]` carries a bevel list, and its commas are its own — so
 *     `talk(purser[1,3,5])` is one conversation with three answers
 *
 * A value that needs a comma or a bracket of its own is quoted:
 * `wait(js == "a, b")`.
 *
 * Calls and not bare words because the two things a sheet does most are pass
 * arguments and pass none, and the older grammar made those look alike: `click
 * memory, obit` was three clicks while `clickAt 169 311` was one action with two
 * arguments, and only knowing the verb told you which. Brackets settle it — a
 * comma is always an argument separator now, and an action that wants doing three
 * times says `x3` rather than being written three times in a row.
 *
 * ## What the parser refuses
 *
 * Everything it can, as early as it can, naming the line. A speedrun sheet is
 * edited far more often than it is read, and the failure mode being designed
 * against is a typo that costs a twenty-minute run rather than a parse. So an
 * unknown verb, an unknown option, a bevel list on a verb that has no use for
 * one and a repeat count on a `split` are all parse errors with a line number
 * and the offending text — not something discovered at minute nineteen.
 *
 * The verb table itself lives in actions.ts, next to the code that executes it,
 * and is passed in. One list, so a verb cannot be executable and unparseable or
 * the other way round.
 */

/** one action, parsed */
export interface Step {
  /** the verb, lowercased — `up`, `click`, `talk`, `split` */
  verb: string;
  /** positional arguments, in order */
  args: string[];
  /** `key: value` options, keys lowercased */
  opts: Record<string, string>;
  /** the bevel list from `who[1,3,5]`, if the action carried one */
  bevels?: number[];
  /** how many times to do it — `x3`, default 1 */
  repeat: number;
  /** 1-based line in the sheet, for errors and for the report */
  line: number;
  /** the action as written, for the split table */
  source: string;
  /** the trailing `#` comment, if any — carried so the report can echo intent */
  note?: string;
}

/** what a verb accepts, so the parser can refuse a line rather than the runner */
export interface VerbSpec {
  /** how many positional arguments, `[min, max]`; max `Infinity` for any */
  args: [number, number];
  /** may this verb carry a `who[1,3,5]` bevel list? */
  bevels?: boolean;
  /**
   * Are this verb's arguments bracketed GROUPS — `combo([256,300], [256,210])`?
   *
   * `[…]` normally means a bevel list, and a bare one on a verb that takes none
   * is a mistake worth naming. But one verb takes a list of POINTS, and a point
   * is two numbers: the tokeniser splits on every top-level comma, so
   * `combo(256,300, 256,210)` arrives as four arguments and the pairing is left
   * to the spacing — which is not something a reader can check. Bracketing the
   * pairs puts it on the page.
   *
   * The group arrives at the verb with its brackets on, because what is inside
   * one is the verb's business and not the parser's.
   */
  groups?: boolean;
  /** option keys this verb understands, on top of the universal ones */
  opts?: string[];
  /** the rest of the line is one argument (`split`, `note`) — no token parsing */
  rest?: boolean;
  /** may not be repeated with `xN` — a split three times is meaningless */
  once?: boolean;
  /**
   * The verb as it is WRITTEN — `closeUp(memory, by: esc)`.
   *
   * Held rather than derived, because the two things a reader needs from a
   * signature are exactly the two things the rest of this interface does not
   * know: the camelCase spelling (the table is keyed lowercase, so `clickat` is
   * all it has) and what the arguments MEAN. `args: [2, 2]` cannot say `x, y`.
   *
   * It is one string per verb next to that verb's own `help`, so a signature
   * and the behaviour it describes are edited in the same place — the same
   * reason the verb table is shared with the parser rather than copied.
   */
  sig?: string;
  /** one line of help, printed by `--verbs` */
  help: string;
}

/**
 * Options every verb takes, because every action is a thing that happens and
 * then a wait — and the wait is what a speedrun tunes.
 *
 *   `wait:`   how much settling to do afterwards (driver.ts WaitMode)
 *   `after:`  extra milliseconds after the action, for a beat the engine does
 *             not expose a flag for. A last resort, and it shows up in the
 *             report as dead time so it stays honest.
 *   `budget:` how long this action’s own wait may take before it is called
 *             stuck. Ten seconds unless the line says otherwise, so a line that
 *             needs longer is a line that says so
 *   `gap:`    milliseconds between repeated presses inside a hammering verb
 */
export const UNIVERSAL_OPTS = ["wait", "after", "budget", "gap"] as const;

export class SheetError extends Error {
  constructor(readonly line: number, message: string, readonly text: string) {
    super(`sheet line ${line}: ${message}\n    ${text}`);
    this.name = "SheetError";
  }
}

/** `word[1,3,5]` — an argument and the bevels it carries */
const BEVELS = /^([A-Za-z0-9_.-]*)\[([0-9,\s]*)\]$/;
/** `x3` — a repeat count, never a bare argument */
const REPEAT = /^x(\d+)$/i;
/**
 * `key: value` — a named argument.
 *
 * A COLON and not an equals, because an equals already meant something else.
 * Conditions are `set == c73`, `global.mission == 1`, `owns.map` — and under the
 * old grammar a named argument wore the same `name=value` shape, so the two were
 * told apart by a lookup: known name wins, anything else is a condition. That
 * left a standing rule nothing enforced ("no condition may be called `budget`,
 * `gap`, `after` or `wait`") and it had already been broken — `stand(view55,
 * set == smstack3)` passes an OPTION called `set` to a language in which `set == c73`
 * is a CONDITION, and one sheet held both spellings three lines apart.
 *
 * With a colon the two grammars cannot be confused at all, so an unknown name
 * here is a typo and can be reported as one.
 */
const OPTION = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*([\s\S]*)$/;

/**
 * Strip a trailing `#` comment, respecting double quotes.
 *
 * Quotes matter for exactly one thing today — a `split` or `note` whose name has
 * a `#` in it — but the rule is cheaper to keep than to explain the absence of.
 */
function decomment(text: string): { code: string; note?: string } {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (c === "#" && !quoted) {
      return { code: text.slice(0, i), note: text.slice(i + 1).trim() || undefined };
    }
  }
  return { code: text };
}

/** split on `;`, respecting quotes, brackets and the call's own parentheses */
function statements(code: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let from = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "[" || c === "(")) depth++;
    else if (!quoted && (c === "]" || c === ")")) depth--;
    else if (c === ";" && !quoted && depth === 0) {
      out.push(code.slice(from, i));
      from = i + 1;
    }
  }
  out.push(code.slice(from));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** split arguments on top-level commas — `a, b, c` but never `a[1,2]` */
function commas(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "[" || c === "(")) depth++;
    else if (!quoted && (c === "]" || c === ")")) depth--;
    else if (c === "," && !quoted && depth === 0) {
      out.push(text.slice(from, i));
      from = i + 1;
    }
  }
  out.push(text.slice(from));
  return out.map((s) => s.trim()).filter(Boolean);
}

export interface ParseOptions {
  /** the verb table — actions.ts's, so parseable and executable are one list */
  verbs: Record<string, VerbSpec>;
}

/**
 * Parse a sheet into steps.
 *
 * Every error carries its line number and the line as written, and parsing does
 * not stop at the first one: a sheet with four typos should report four typos,
 * because the alternative is four edit-and-rerun cycles to find them.
 */
export function parseSheet(text: string, { verbs }: ParseOptions): Step[] {
  const steps: Step[] = [];
  const errors: SheetError[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((raw, i) => {
    const line = i + 1;
    const { code, note } = decomment(raw);
    if (!code.trim()) return;

    for (const statement of statements(code)) {
      try {
        steps.push(...parseStatement(statement, line, note, verbs));
      } catch (e) {
        errors.push(e instanceof SheetError ? e : new SheetError(line, String(e), raw.trim()));
      }
    }
  });

  if (errors.length) {
    throw new Error(
      `${errors.length} error${errors.length === 1 ? "" : "s"} in the sheet:\n\n` +
        errors.map((e) => e.message).join("\n\n"),
    );
  }
  return steps;
}

/** `verb ( ... )` — the whole shape of a statement */
const CALL = /^([A-Za-z][A-Za-z0-9_]*)\s*\(([\s\S]*)\)$/;

function parseStatement(
  statement: string,
  line: number,
  note: string | undefined,
  verbs: Record<string, VerbSpec>,
): Step[] {
  const source = statement.trim();
  const call = CALL.exec(source);
  if (!call) {
    // Almost always the old grammar rather than a typo, so say which it is. A
    // sheet is a file people keep, and "unknown action" would send someone
    // looking for a missing verb that is sitting right there.
    const bare = /^([A-Za-z][A-Za-z0-9_]*)\b/.exec(source);
    const hint =
      bare && verbs[bare[1].toLowerCase()]
        ? ` — actions are calls now, so write \`${bare[1]}(...)\``
        : "";
    throw new SheetError(line, `not an action call${hint}`, source);
  }

  const verb = call[1].toLowerCase();
  const inside = call[2].trim();
  const spec = verbs[verb];
  if (!spec) {
    const near = Object.keys(verbs)
      .filter((v) => v.startsWith(verb.slice(0, 2)) || v.includes(verb))
      .slice(0, 3);
    throw new SheetError(
      line,
      `unknown action "${call[1]}"${near.length ? ` — did you mean ${near.join(", ")}?` : ""}`,
      source,
    );
  }

  // `split(flat scored)` — the whole inside is the name, untokenised, because a
  // split name is prose and should read like it in the sheet
  if (spec.rest) {
    const rest = inside.replace(/^"|"$/g, "").trim();
    if (!rest && spec.args[0] > 0) throw new SheetError(line, `${verb} needs a name`, source);
    return [{ verb, args: rest ? [rest] : [], opts: {}, repeat: 1, line, source, note }];
  }

  const opts: Record<string, string> = {};
  const args: string[] = [];
  let repeat = 1;
  let bevels: number[] | undefined;

  for (const raw of commas(inside)) {
    const token = raw.trim();
    if (!token) continue;

    const asRepeat = REPEAT.exec(token);
    if (asRepeat) {
      if (spec.once) throw new SheetError(line, `${verb} cannot be repeated`, source);
      repeat = Number(asRepeat[1]);
      if (repeat < 1) throw new SheetError(line, `a repeat count must be at least 1`, source);
      continue;
    }

    const asBevels = BEVELS.exec(token);
    if (asBevels) {
      // a verb whose arguments ARE brackets keeps them, contents untouched
      if (spec.groups && !asBevels[1]) {
        args.push(token);
        continue;
      }
      if (!spec.bevels) throw new SheetError(line, `${verb} does not take a bevel list`, source);
      if (bevels) throw new SheetError(line, `${verb} takes one bevel list, not two`, source);
      bevels = asBevels[2]
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean)
        .map((n) => {
          const v = Number(n);
          if (!Number.isFinite(v)) throw new SheetError(line, `"${n}" is not a bevel id`, source);
          return v;
        });
      if (asBevels[1]) args.push(asBevels[1]);
      continue;
    }

    const asNamed = OPTION.exec(token);
    if (asNamed) {
      const key = asNamed[1].toLowerCase();
      const known = [...UNIVERSAL_OPTS, ...(spec.opts ?? [])];
      if (!known.includes(key)) {
        throw new SheetError(line, `${verb} has no argument "${key}" (it takes ${known.join(", ")})`, source);
      }
      opts[key] = unquote(asNamed[2]);
      continue;
    }
    // The one mistake worth catching by hand, because it was the whole grammar
    // until it wasn't and every sheet ever written is full of it.
    const asOldOption = /^([A-Za-z][A-Za-z0-9_-]*)=(?!=)(.*)$/.exec(token);
    if (asOldOption && [...UNIVERSAL_OPTS, ...(spec.opts ?? [])].includes(asOldOption[1].toLowerCase())) {
      throw new SheetError(
        line,
        `named arguments take a colon now — ${verb}(${asOldOption[1]}: ${asOldOption[2]}), ` +
          `not ${asOldOption[1]}=${asOldOption[2]}. Conditions keep the equals, and double it: ` +
          `set == c73, global.mission == 1, owns.map`,
        source,
      );
    }

    args.push(unquote(token));
  }

  const [min, max] = spec.args;
  if (args.length < min || args.length > max) {
    const want = min === max ? `${min}` : max === Infinity ? `${min} or more` : `${min}-${max}`;
    throw new SheetError(
      line,
      `${verb} takes ${want} argument${max === 1 ? "" : "s"}, got ${args.length}`,
      source,
    );
  }
  if (spec.bevels && min > 0 && !bevels && !args.length) {
    throw new SheetError(line, `${verb} needs someone to talk to`, source);
  }

  return [{ verb, args, opts, bevels, repeat, line, source, note }];
}

const unquote = (s: string): string => s.replace(/^"([\s\S]*)"$/, "$1");

/** the sheet's own summary, for the top of a report */
export function describeSheet(steps: Step[]): string {
  const splits = steps.filter((s) => s.verb === "split").length;
  const actions = steps.length - splits;
  const gestures = steps.filter((s) => s.verb !== "split").reduce((n, s) => n + s.repeat, 0);
  return (
    `${actions} action${actions === 1 ? "" : "s"} (${gestures} gesture${gestures === 1 ? "" : "s"})` +
    ` over ${splits + 1} split${splits ? "s" : ""}`
  );
}
