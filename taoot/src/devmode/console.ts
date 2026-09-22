/**
 * A DreamFactory console: type a line of the game's own script and run it.
 *
 * Developer mode reaches four handlers that no gesture in the game reaches —
 * `addallinven()`, `movies()`, `solvebomb()`, `solvedoll()`. On the disc they
 * were invoked from the in-engine script editor, which is the one part of the
 * debug build that cannot come back (TI.EXE gates it behind an "editor
 * available" flag that is clear in every shipping build). The language it drove
 * is still here, though, so this is what replaces it.
 *
 *     sendtoshop ("inven.shp", addallinven ())
 *     propowner ("bag", "frank")
 *     return (currentset () @ " " @ currentscene ())
 *
 * ## How a line becomes something that runs
 *
 * The line is wrapped in a handler, compiled by the same assembler the editors
 * and `mklangstg.ts` use, and handed to the session's own loader:
 *
 *     code console ()
 *         <the line>
 *     endcode
 *
 * `GameSession.instanceFrom` turns those bytes into a `ScriptInstance` exactly
 * as it does for a container read off the disc, and `Interpreter.runHandler`
 * runs it. So a console line is not a special case anywhere in the engine — it
 * resolves builtins, boot-library routines and globals by the same rules a
 * script in the game does, and `sendtoshop`, `sendtoactor` and the rest reach
 * the same places.
 *
 * ## Where the output goes
 *
 * Two places, and both matter. The handler's own return value comes back from
 * {@link run}, which is what `return (…)` is for. Anything the line *logs* —
 * `message ()`, and the engine's own complaints about an unknown command — goes
 * through the session's log to the Details pane, because a builtin's log line is
 * routed by the active binding (engine/src/runtime/builtins/context.ts) and not
 * by anything this module could intercept.
 */
import { compileScript } from "@dreamfactory/engine/df/script-asm";

/** what a session has to offer for a line to be runnable */
export interface ConsoleSession {
  instanceFrom(data: Uint8Array | undefined, owner: string): unknown;
  interp: {
    runHandler(
      inst: unknown,
      handler: string,
      args: unknown[],
      ctx: { me: string; target: string },
    ): Promise<{ value: unknown }>;
  };
}

export interface ConsoleResult {
  ok: boolean;
  /** the handler's return value, when it ran */
  value?: unknown;
  /** what went wrong, ready to show */
  error?: string;
}

/** the handler a line is wrapped in — also the instance name, so a parse error
 *  or an unknown command says "console" rather than naming a room */
export const CONSOLE_HANDLER = "console";

/** wrap a line as a handler, which is the only transformation applied to it */
export function wrap(line: string): string {
  return `code ${CONSOLE_HANDLER} ()\n\t${line}\nendcode`;
}

/**
 * Compile and run one line.
 *
 * Never throws: a console that throws is a console that loses the rest of the
 * session, and every interesting line typed into one is a line somebody is not
 * sure about. Compile faults, parse faults and anything the handler raises all
 * come back as `{ ok: false, error }`.
 */
export async function run(session: ConsoleSession, line: string): Promise<ConsoleResult> {
  const source = line.trim();
  if (!source) return { ok: true, value: undefined };
  let bytes: Uint8Array;
  try {
    bytes = compileScript(wrap(source));
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const inst = session.instanceFrom(bytes, CONSOLE_HANDLER);
  if (!inst) return { ok: false, error: "did not parse" };
  try {
    const res = await session.interp.runHandler(inst, CONSOLE_HANDLER, [], {
      me: CONSOLE_HANDLER,
      target: "",
    });
    return { ok: true, value: res.value };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * A recallable history of what has been typed.
 *
 * Kept here rather than in the page so the ↑/↓ behaviour can be tested without a
 * DOM. Duplicates of the last line are not pushed — typing the same command
 * three times while watching a value move should not mean pressing ↑ three times
 * to get past it.
 */
export class History {
  private readonly lines: string[] = [];
  /** how far back the cursor is; 0 means "not in the history" */
  private back = 0;

  add(line: string): void {
    const s = line.trim();
    this.back = 0;
    if (!s || this.lines[this.lines.length - 1] === s) return;
    this.lines.push(s);
  }

  /** the previous line, or null at the top */
  older(): string | null {
    if (this.back >= this.lines.length) return null;
    this.back++;
    return this.lines[this.lines.length - this.back];
  }

  /** the next line down, or "" once back at the empty prompt */
  newer(): string | null {
    if (this.back === 0) return null;
    this.back--;
    return this.back === 0 ? "" : this.lines[this.lines.length - this.back];
  }

  get all(): readonly string[] {
    return this.lines;
  }
}
