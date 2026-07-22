/**
 * Interpreter smoke test: load the blackjack stage script straight from the
 * original BLKJACK.STG, run its pure `winner()` logic across a matrix of
 * player/dealer totals, and check the results against blackjack rules.
 *
 *   npx vitest run tests/interp.ts
 *   TAOOT_BLKJACK=/path/to/BLKJACK.STG npx vitest run tests/interp.ts
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readContainerFile } from "../src/df/container";
import { sniffScript } from "../src/df/script";
import { parseScript } from "../src/engine/parser";
import { Interpreter, ScriptInstance, registerCoreBuiltins, Value } from "../src/engine/interp";

const path = process.env.TAOOT_BLKJACK ?? "gamefiles/LOCAL/BLKJACK.STG";

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
