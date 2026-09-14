/**
 * Losing at checkers, run — `CHECKERS.PRP`'s own `win ()`, against the disc.
 *
 *   npx vitest run dust/tests/checkers-script.ts
 *
 * Reported as "checkers works now but when I lose I think it locks up", and the
 * shape of that is the whole point of this file: the game was playable, Bolivar
 * moved, pieces came off — and the moment he WON it stopped dead with his gloat
 * half-said. Nothing threw.
 *
 * `win ()` is the only one of the two endings with a blocking wait in it:
 *
 *     if person = "him"
 *         …voicesound ("bol.99" | "bol.100" | "bol.101")…
 *         while currentvoice () != "none"
 *         endwhile
 *         voicesound ("bol.98")
 *         score = "lose"
 *         makeloop ("flat", "flat 0", "quitgame", 90)
 *
 * The `win ("me")` arm goes straight to `makeloop`. So the port answering ""
 * for an idle voice channel — rather than the `"none"` the scripts are written
 * against — was a loop with no exit on exactly one of the two paths out of a
 * game, and it was the losing one.
 *
 * Run rather than asserted about, because the thing worth pinning is that the
 * handler RETURNS. A unit test on `currentvoice` alone would have passed
 * throughout the bug: the builtin always answered correctly for "is a voice
 * playing", it just used the wrong word for no.
 *
 * Skipped, not failed, without the disc (the same bargain dust/tests/saves.ts
 * makes).
 */
import { test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { sniffScript } from "@dreamfactory/engine/df/script";
import { parseScript } from "@dreamfactory/engine/runtime/parser";
import { ScriptInstance } from "@dreamfactory/engine/runtime/interp";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";

const CHECKERS = fileURLToPath(new URL("../gamefiles/dustcd/CHECKERS/CHECKERS.PRP", import.meta.url));

/** the container that holds a named code block */
function handlerIn(path: string, want: string): ScriptInstance | null {
  const container = readContainerFile(new Uint8Array(readFileSync(path)));
  for (const [i, c] of container.containers.entries()) {
    const tokens = sniffScript(c.data);
    if (!tokens) continue;
    try {
      const script = parseScript(tokens);
      if (script.codes.has(want)) return new ScriptInstance(`checkers.prp:${i}`, script);
    } catch {
      /* a picture that sniffed as a script — the parse is the real filter */
    }
  }
  return null;
}

const have = (): boolean => existsSync(CHECKERS);

/**
 * A handler, with a deadline.
 *
 * `Promise.race` and not the suite timeout, because the two failures read
 * completely differently in a report: a hang here says "win() did not return in
 * 5s", and a hang left to vitest says the whole file timed out with no clue
 * which of its tests was spinning.
 */
async function within(ms: number, work: Promise<unknown>, what: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), ms);
  });
  try {
    const got = await Promise.race([work.then(() => "done" as const), late]);
    expect(got, `${what} did not return within ${ms}ms — a \`while\` with no exit`).toBe("done");
  } finally {
    clearTimeout(timer);
  }
}

test("win(\"him\") returns — losing does not hang on the voice wait", async () => {
  if (!have()) {
    console.warn(`no ${CHECKERS} — skipping (needs the Dust rip)`);
    return;
  }
  const inst = handlerIn(CHECKERS, "win");
  expect(inst, "CHECKERS.PRP carries a `win` block").not.toBeNull();

  const session = new GameSession(() => null, new NullAudioSink());
  session.onLog = () => {};
  // `lookahead` is what `win ("me")` turns into a score; `win ("him")` reads
  // only `counter`, and 0 is the arm that speaks two lines rather than one
  session.interp.globals.set("counter", 0);
  session.interp.globals.set("lookahead", 3);

  await within(
    5000,
    session.interp.runHandler(inst!, "win", ["him"], { me: "flat 0", target: "" }).then(() => {}),
    'win("him")',
  );
  expect(String(session.interp.globals.get("score")), "the loss is recorded").toBe("lose");
});

test('win("me") returns too — the arm that never had the wait', async () => {
  if (!have()) return;
  const inst = handlerIn(CHECKERS, "win");
  const session = new GameSession(() => null, new NullAudioSink());
  session.onLog = () => {};
  session.interp.globals.set("counter", 0);
  session.interp.globals.set("lookahead", 4);
  await within(
    5000,
    session.interp.runHandler(inst!, "win", ["me"], { me: "flat 0", target: "" }).then(() => {}),
    'win("me")',
  );
  // the three `lookahead` values are the game's three difficulties
  expect(String(session.interp.globals.get("score"))).toBe("winhard");
});

/**
 * And the same wait where the flute room opens it.
 *
 * Three of these loops are `currentsound ()` rather than `currentvoice ()`, and
 * they were found first — a rung of the playthrough monkeypatched the builtin so
 * it could play the room, which left the suite green and the browser hung. Same
 * cause, so it belongs in the same file as the fix.
 */
test("an idle channel says `none`, which is what every one of these loops waits for", async () => {
  const session = new GameSession(() => null, new NullAudioSink());
  const inst = new ScriptInstance(
    "waits",
    parseScript(
      (await import("@dreamfactory/engine/df/script-asm")).assembleScript(`
code waitvoice ()
	while currentvoice () != "none"
	endwhile
endcode

code waitsound ()
	while currentsound () != "none"
	endwhile
endcode
`),
    ),
  );
  for (const handler of ["waitvoice", "waitsound"]) {
    await within(
      5000,
      session.interp.runHandler(inst, handler, [], { me: "flat 0", target: "" }).then(() => {}),
      handler,
    );
  }
});
