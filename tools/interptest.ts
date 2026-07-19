/**
 * Interpreter smoke test: load the blackjack stage script straight from the
 * original BLKJACK.STG, run its pure `winner()` logic across a matrix of
 * player/dealer totals, and check the results against blackjack rules.
 *
 *   npx tsx tools/interptest.ts gamefiles/LOCAL/BLKJACK.STG
 */
import { readFileSync } from "node:fs";
import { readContainerFile } from "../src/df/container";
import { sniffScript } from "../src/df/script";
import { parseScript } from "../src/engine/parser";
import { Interpreter, ScriptInstance, registerCoreBuiltins, Value } from "../src/engine/interp";

const path = process.argv[2] ?? "gamefiles/LOCAL/BLKJACK.STG";
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
if (!inst) throw new Error("no winner() in this file");

const interp = new Interpreter();
registerCoreBuiltins(interp);

async function winner(player: number, dealer: number): Promise<Value> {
  interp.globals.set("playertotal", player);
  interp.globals.set("dealertotal", dealer);
  return (await interp.runHandler(inst!, "winner", [], { me: "blkjack", target: "" })).value;
}

let pass = 0;
let fail = 0;
async function expect(player: number, dealer: number, want: Value): Promise<void> {
  const got = await winner(player, dealer);
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} player=${player} dealer=${dealer} -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
}

await expect(20, 18, "player");
await expect(18, 20, "dealer");
await expect(19, 19, "draw");
await expect(20, 21, "dealer");
await expect(20, 22, "player");
await expect(21, 20, "player");
await expect(21, 21, "draw");
await expect(21, 22, "player");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
