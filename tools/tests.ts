/**
 * Regression suite — runs headless against the original game files.
 *
 *   npx tsx tools/tests.ts [gamefilesDir]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readSetFile } from "../src/df/set";
import { readContainerFile } from "../src/df/container";
import { sniffScript } from "../src/df/script";
import { parseScript } from "../src/engine/parser";
import { GameSession } from "../src/engine/session";
import { ScriptInstance } from "../src/engine/interp";
import { NullAudioSink } from "../src/engine/audio";
import { SetViewer } from "../src/viewer";

const root = process.argv[2] ?? "gamefiles";
const provider = (name: string): Uint8Array | null => {
  for (const dir of [join(root, "LOCAL"), root]) {
    try {
      return new Uint8Array(readFileSync(join(dir, name.toUpperCase())));
    } catch {
      /* try next */
    }
  }
  return null;
};

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ""): void {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function newSession(): { session: GameSession; sink: NullAudioSink; viewer: () => SetViewer } {
  const sink = new NullAudioSink();
  const session = new GameSession(provider, sink);
  let current: SetViewer | null = null;
  session.onSetChange = (fileName, sceneName, viewName) => {
    const set = session.loadSet(fileName);
    if (!set) return;
    current = new SetViewer(set, session, sceneName, viewName);
    current.onHud = () => {};
  };
  session.loadCoreScripts();
  return { session, sink, viewer: () => current! };
}

function runAnimations(v: SetViewer): void {
  let clock = 0;
  let guard = 0;
  while (v.busy) {
    v.tick((clock += 100));
    if (++guard > 2000) throw new Error("animation never finished");
  }
}

// --- 1. hotspot alignment + cursor + click (B59 door) ---
{
  const { session, viewer } = newSession();
  session.openSetFile("b59.set");
  const v = viewer();
  const view = v.scene.views[v.viewIdx];
  const obj = view.objects[0];
  const cx = Math.floor((obj.startRegionX + obj.endRegionX) / 2);
  const cy = Math.floor((obj.startRegionY + obj.endRegionY) / 2);
  check("b59 door hotspot present", obj?.identifier === "door");
  check("hover returns touch cursor", v.hover(cx, cy) === "touch");
}

// --- 2. road arrival faces travel direction (user-reported bug) ---
{
  const { session, viewer } = newSession();
  session.openSetFile("turk.set");
  const v = viewer();
  v.jumpTo("scene11", "View116");
  v.walk();
  runAnimations(v);
  const scene = v.scene.sceneName;
  const view = v.scene.views[v.viewIdx].viewName;
  check("turk Road144 arrival", scene === "Scene134" && view === "View138", `${scene}/${view}`);
}

// --- 3. interpreter runs real game logic (blackjack winner()) ---
{
  const { session } = newSession();
  const file = readContainerFile(provider("blkjack.stg")!);
  let inst: ScriptInstance | null = null;
  for (const c of file.containers) {
    const tokens = sniffScript(c.data);
    if (!tokens) continue;
    const script = parseScript(tokens);
    if (script.codes.has("winner")) {
      inst = new ScriptInstance("blkjack", script);
      break;
    }
  }
  const winner = (p: number, d: number) => {
    session.interp.globals.set("playertotal", p);
    session.interp.globals.set("dealertotal", d);
    return session.interp.runHandler(inst!, "winner", [], { me: "blkjack", target: "" }).value;
  };
  check(
    "blackjack winner()",
    winner(20, 18) === "player" && winner(18, 20) === "dealer" && winner(19, 19) === "draw" &&
      winner(20, 22) === "player" && winner(21, 21) === "draw",
  );
}

// --- 4. audio: locked-door voice line through the script chain ---
{
  const { session, sink, viewer } = newSession();
  session.openSetFile("b59.set");
  const v = viewer();
  const main = v.scripts.findInstance("b59")!;
  session.interp.runHandler(main, "mousedown", ["locked"], { me: "b59", target: "locked" });
  const call = sink.calls.find((c) => c.channel === "voice");
  check("doorlocked voice plays", !!call && call.seconds > 0.5, `${call?.seconds.toFixed(2)}s`);
}

// --- 5. cross-set travel via stage gotospecial, globals persist ---
{
  const { session, viewer } = newSession();
  session.openSetFile("b59.set");
  session.interp.globals.set("testmarker", 42);
  session.interp.runHandler(session.stage!, "gotospecial", ["hallb", "scene29", "view41"], {
    me: "main.stg",
    target: "",
  });
  const v = viewer();
  check(
    "gotospecial b59 -> hallb",
    session.currentSetName === "hallb" &&
      v.scene.sceneName.toLowerCase() === "scene29" &&
      v.scene.views[v.viewIdx].viewName.toLowerCase() === "view41",
    `${session.currentSetName}/${v.scene.sceneName}/${v.scene.views[v.viewIdx].viewName}`,
  );
  check("globals persist across sets", session.interp.globals.get("testmarker") === 42);
}

// --- 6. props: shop loads, prop state machinery works (TURK) ---
{
  const { session, viewer } = newSession();
  session.openSetFile("turk.set");
  void viewer();
  const p = session.propRuntime.get("turkwater");
  check("turk.shp props loaded", !!p, session.propRuntime.shops.size + " shop(s)");
  if (p) {
    p.visible = true;
    p.stateName = "run";
    check("prop state has frames", (p.state()?.frames.length ?? 0) === 16);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
