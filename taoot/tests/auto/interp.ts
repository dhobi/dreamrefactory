/**
 * Interpreter smoke test: load the blackjack stage script straight from the
 * original BLKJACK.STG, run its pure `winner()` logic across a matrix of
 * player/dealer totals, and check the results against blackjack rules.
 *
 *   npx vitest run taoot/tests/auto/interp.ts
 *   TAOOT_BLKJACK=/path/to/BLKJACK.STG npx vitest run taoot/tests/auto/interp.ts
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { sniffScript } from "@dreamfactory/engine/df/script";
import { parseScript } from "@dreamfactory/engine/runtime/parser";
import { Interpreter, ScriptInstance, Value } from "@dreamfactory/engine/runtime/interp";
import { registerCoreBuiltins } from "@dreamfactory/engine/runtime/builtins/core";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { gamefilePath } from "../../tools/gamefiles";

const path = process.env.TAOOT_BLKJACK ?? gamefilePath("blkjack.stg");

test("blackjack winner() matches the rules across a totals matrix", async () => {
  const file = readContainerFile(new Uint8Array(readFileSync(path)));

  // find the script container that defines winner()
  let inst: ScriptInstance | null = null;
  for (let i = 0; i < file.containers.length; i++) {
    const tokens = sniffScript(file.containers[i].data);
    if (!tokens) continue;
    const script = parseScript(tokens);
    if (script.codes.has("winner")) {
      inst = new ScriptInstance("blkjack", script);
      console.log(`winner() found in container ${i}; blocks: ${[...script.codes.keys()].join(", ")}`);
      break;
    }
  }
  expect(inst, "winner() block present in the file").not.toBeNull();

  const interp = new Interpreter();
  registerCoreBuiltins(interp);

  const winner = async (player: number, dealer: number): Promise<Value> => {
    interp.globals.set("playertotal", player);
    interp.globals.set("dealertotal", dealer);
    return (await interp.runHandler(inst!, "winner", [], { me: "blkjack", target: "" })).value;
  };

  // soft assertions: every case runs, so one wrong total doesn't hide the rest
  const check = async (player: number, dealer: number, want: Value): Promise<void> => {
    const got = await winner(player, dealer);
    const line = `player=${player} dealer=${dealer} -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`;
    expect.soft(got, line).toBe(want);
  };

  await check(20, 18, "player");
  await check(18, 20, "dealer");
  await check(19, 19, "draw");
  await check(20, 21, "dealer");
  await check(20, 22, "player");
  await check(21, 20, "player");
  await check(21, 21, "draw");
  await check(21, 22, "player");
});

/**
 * `variable (name)` reaches the same table a name written out in full does.
 *
 * `adjust4ace` is where Titanic's blackjack turns a hard ace soft and back, and
 * it says both halves of the contract in one block: the loops read and write
 * `variable (who @ "total")` / `variable (who @ "aceten")` by computed name, and
 * then the dealer's soft-17 rule reads `dealertotal` and `dealeraceten` written
 * out. So the computed writes must land in the globals the plain reads see.
 *
 * This is a guard, not a discovery: `variable` grew a locals-first lookup for
 * Dust's poker (its `hasxkind` counts faces into locals and reads them back by
 * name — dust/tests/salgames.ts), and the way that could have cost Titanic
 * anything is by resolving one of these names somewhere else.
 */
test("blackjack's adjust4ace moves the globals it names two ways", async () => {
  const file = readContainerFile(new Uint8Array(readFileSync(path)));

  let inst: ScriptInstance | null = null;
  for (let i = 0; i < file.containers.length; i++) {
    const tokens = sniffScript(file.containers[i].data);
    if (!tokens) continue;
    const script = parseScript(tokens);
    if (script.codes.has("adjust4ace")) {
      inst = new ScriptInstance("blkjack", script);
      break;
    }
  }
  expect(inst, "adjust4ace() block present in the file").not.toBeNull();

  // `variable` is a session-bound builtin; nothing here reads a game file
  const session = new GameSession(() => null, new NullAudioSink());
  session.onLog = () => {};
  const interp = session.interp;

  /** initgame()'s globals, then adjust4ace(who), then what it left behind */
  const adjust = async (
    who: string,
    state: Record<string, number>,
  ): Promise<Record<string, number>> => {
    const names = [
      "playertotal", "playerace", "playeraceten", "playerstand",
      "dealertotal", "dealerace", "dealeraceten", "dealerstand",
    ];
    for (const n of names) interp.globals.set(n, state[n] ?? 0);
    await interp.runHandler(inst!, "adjust4ace", [who], { me: "blkjack", target: "" });
    return Object.fromEntries(names.map((n) => [n, Number(interp.globals.get(n))]));
  };

  // an ace dealt to a 2: counted as 1 on the way in, worth 11 once it fits
  let after = await adjust("player", { playertotal: 3, playerace: 1 });
  expect.soft(after.playertotal, "A+2 is a soft 13").toBe(13);
  expect.soft(after.playeraceten, "and one ace is holding the ten").toBe(1);

  // idempotent: the soft hand re-adjusted is the same soft hand
  after = await adjust("player", { playertotal: 13, playerace: 1, playeraceten: 1 });
  expect.soft(after.playertotal, "a soft 13 re-adjusted").toBe(13);
  expect.soft(after.playeraceten, "still holding it").toBe(1);

  // A+6+K: the ten no longer fits, so the ace stays a one
  after = await adjust("player", { playertotal: 17, playerace: 1 });
  expect.soft(after.playertotal, "A+6+K is a hard 17").toBe(17);
  expect.soft(after.playeraceten, "no ace can take the ten").toBe(0);

  // the dealer's own rule, read off the plain globals the loops just wrote:
  // a soft 17 that only TIES the standing player is played as a 7 and hit again
  after = await adjust("dealer", {
    dealertotal: 17, dealerace: 1, dealeraceten: 1, playerstand: 1, playertotal: 17,
  });
  expect.soft(after.dealertotal, "the house drops back to 7 rather than tie").toBe(7);
  expect.soft(after.dealeraceten, "and the ace is a one again").toBe(0);

  // the same soft 17 against a player who is BEHIND is stood on
  after = await adjust("dealer", {
    dealertotal: 17, dealerace: 1, dealeraceten: 1, playerstand: 1, playertotal: 16,
  });
  expect.soft(after.dealertotal, "17 beats 16 — the house keeps it").toBe(17);
  expect.soft(after.dealeraceten, "the ace stays an eleven").toBe(1);
});
