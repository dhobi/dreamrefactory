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

// --- 7. door opens: prop becomes visible, sound plays, uparrow travels ---
{
  const { session, sink, viewer } = newSession();
  session.openSetFile("b59.set");
  let v = viewer();
  // click the door hotspot in Scene14/View18
  const obj = v.scene.views[v.viewIdx].objects[0];
  v.click(
    Math.floor((obj.startRegionX + obj.endRegionX) / 2),
    Math.floor((obj.startRegionY + obj.endRegionY) / 2),
  );
  const door = session.propRuntime.get("door");
  check(
    "door prop opens on click",
    !!door && door.visible && door.stateName === "b59-hallb",
    `visible=${door?.visible} state=${door?.stateName}`,
  );
  const voice = sink.calls.find((c) => c.channel === "voice");
  check("dooropen sound plays", !!voice && voice.seconds > 0.1, `${voice?.seconds.toFixed(2)}s`);
  // with the door open, uparrow is intercepted by the scene script -> hallb
  const consumed = v.keyDown("uparrow");
  v = viewer();
  check(
    "uparrow through open door travels to hallb",
    consumed && session.currentSetName === "hallb",
    `consumed=${consumed} set=${session.currentSetName} ${v.scene.sceneName}/${v.scene.views[v.viewIdx].viewName}`,
  );
}

// --- 8. doors close on navigation (boot's default closescene) ---
{
  const { session, sink, viewer } = newSession();
  session.openSetFile("b59.set");
  let v = viewer();
  const obj = v.scene.views[v.viewIdx].objects[0];
  const cx = Math.floor((obj.startRegionX + obj.endRegionX) / 2);
  const cy = Math.floor((obj.startRegionY + obj.endRegionY) / 2);
  const door = session.propRuntime.get("door")!;

  // open door, then walk away to another scene in the same set
  v.click(cx, cy);
  sink.calls.length = 0;
  v.jumpTo("Scene14", "View19"); // View19 faces Road34 to Scene15
  v.walk();
  let clock = 0;
  while (v.busy) v.tick((clock += 100));
  const closedOnWalk = !door.visible;
  const closeSound = sink.calls.find((c) => c.channel === "voice");
  check("door closes when walking away", closedOnWalk, `visible=${door.visible}`);
  check("doorclose sound plays", !!closeSound, `${closeSound?.seconds.toFixed(2) ?? "-"}s`);

  // open again, then just turn: view change must also close the door
  v.jumpTo("Scene14", "View18");
  v.click(cx, cy);
  sink.calls.length = 0;
  v.turn(0);
  while (v.busy) v.tick((clock += 100));
  check("door closes on turn", !door.visible, `visible=${door.visible}`);
  check("doorclose sound on turn", sink.calls.some((c) => c.channel === "voice"));

  // open again, travel to another set: door must not survive the trip
  v.jumpTo("Scene14", "View18");
  v.click(cx, cy);
  session.interp.runHandler(session.stage!, "gotospecial", ["hallb", "scene29", "view41"], {
    me: "main.stg",
    target: "",
  });
  check("door closes on set change", !door.visible, `visible=${door.visible}`);
}

// --- 9. movies: boot's spotmovie -> playmovie builtin -> viewer playback ---
{
  const { session, viewer } = newSession();
  session.openSetFile("turk.set");
  const v = viewer();
  session.runGlobal("spotmovie", ["turknmes.mov"]);
  check("spotmovie starts playback", v.moviePlaying);
  let clock = 0;
  const settle9 = () => {
    for (let i = 0; i < 30 && v.moviePlaying; i++) v.tick((clock += 250));
  };
  settle9();
  check("interactive movie opens on a still", v.moviePlaying);
  v.click(10, 10); // anywhere except OK: starts playback
  settle9();
  check("click starts it, pauses at OK frame", v.moviePlaying);
  v.click(458, 350); // on the OK button (region 431..485 x 339..362)
  settle9();
  check("OK click resumes and movie ends", !v.moviePlaying);
}

// --- 10. movie zoom cycle (MENU.MOV): paper toggles zoom, only OK leaves ---
{
  const { session, viewer } = newSession();
  session.openSetFile("turk.set"); // any set; movie loads via provider
  const v = viewer();
  v.playMovie("menu.mov");
  let clock = 0;
  const settle = () => {
    for (let i = 0; i < 30 && v.moviePlaying; i++) v.tick((clock += 250));
  };
  settle();
  check("menu opens on a still", v.moviePlaying);
  v.click(460, 350); // OK on the initial still -> leave immediately
  check("OK on initial still leaves", !v.moviePlaying);

  v.playMovie("menu.mov");
  settle();
  v.click(100, 100); // start playback
  settle();
  check("menu pauses at first pause frame", v.moviePlaying);
  v.click(280, 210); // the menu paper -> zoom in
  settle();
  check("paper click zooms (still in movie)", v.moviePlaying);
  v.click(250, 200); // zoomed paper -> zoom back out
  settle();
  check("second paper click unzooms, does NOT leave", v.moviePlaying);
  v.click(460, 350); // OK button
  settle();
  check("OK leaves the menu movie", !v.moviePlaying);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
