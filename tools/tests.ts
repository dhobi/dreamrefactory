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
import { projectPoint } from "../src/engine/props";
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

async function newSession(): Promise<{
  session: GameSession;
  sink: NullAudioSink;
  viewer: () => SetViewer;
}> {
  const sink = new NullAudioSink();
  const session = new GameSession(provider, sink);
  let current: SetViewer | null = null;
  session.onSetChange = async (fileName, sceneName, viewName) => {
    const set = session.loadSet(fileName);
    if (!set) return;
    current = new SetViewer(set, session, sceneName, viewName);
    current.onHud = () => {};
    await current.start();
  };
  await session.loadCoreScripts();
  return { session, sink, viewer: () => current! };
}

// one monotonic virtual clock for the whole suite (sessions each track their
// own offsets; time must never run backwards for delay()/loop service)
let clock = 0;

/** let suspended scripts (await points, resolved delays) continue */
const drain = () => new Promise<void>((resolve) => setImmediate(resolve));

async function runAnimations(v: SetViewer): Promise<void> {
  let guard = 0;
  while (v.busy || v.session.scriptBusy) {
    v.tick((clock += 100));
    await drain();
    if (++guard > 2000) throw new Error("animation never finished");
  }
}

// --- 1. hotspot alignment + cursor + click (B59 door) ---
{
  const { session, viewer } = await newSession();
  await session.openSetFile("b59.set");
  const v = viewer();
  const view = v.scene.views[v.viewIdx];
  const obj = view.objects[0];
  const cx = Math.floor((obj.startRegionX + obj.endRegionX) / 2);
  const cy = Math.floor((obj.startRegionY + obj.endRegionY) / 2);
  check("b59 door hotspot present", obj?.identifier === "door");
  check("hover returns touch cursor", (await v.hover(cx, cy)) === "touch");
}

// --- 2. road arrival faces travel direction (user-reported bug) ---
{
  const { session, viewer } = await newSession();
  await session.openSetFile("turk.set");
  const v = viewer();
  v.jumpTo("scene11", "View116");
  v.walk();
  await runAnimations(v);
  const scene = v.scene.sceneName;
  const view = v.scene.views[v.viewIdx].viewName;
  check("turk Road144 arrival", scene === "Scene134" && view === "View138", `${scene}/${view}`);
}

// --- 3. interpreter runs real game logic (blackjack winner()) ---
{
  const { session } = await newSession();
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
  const winner = async (p: number, d: number) => {
    session.interp.globals.set("playertotal", p);
    session.interp.globals.set("dealertotal", d);
    return (await session.interp.runHandler(inst!, "winner", [], { me: "blkjack", target: "" }))
      .value;
  };
  check(
    "blackjack winner()",
    (await winner(20, 18)) === "player" && (await winner(18, 20)) === "dealer" &&
      (await winner(19, 19)) === "draw" && (await winner(20, 22)) === "player" &&
      (await winner(21, 21)) === "draw",
  );
}

// --- 4. audio: locked-door voice line through the script chain ---
{
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("b59.set");
  const v = viewer();
  const main = v.scripts.findInstance("b59")!;
  await session.interp.runHandler(main, "mousedown", ["locked"], { me: "b59", target: "locked" });
  const call = sink.calls.find((c) => c.channel === "voice");
  check("doorlocked voice plays", !!call && call.seconds > 0.5, `${call?.seconds.toFixed(2)}s`);
}

// --- 5. cross-set travel via stage gotospecial, globals persist ---
{
  const { session, viewer } = await newSession();
  await session.openSetFile("b59.set");
  session.interp.globals.set("testmarker", 42);
  await session.interp.runHandler(session.stage!, "gotospecial", ["hallb", "scene29", "view41"], {
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
  const { session, viewer } = await newSession();
  await session.openSetFile("turk.set");
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
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("b59.set");
  let v = viewer();
  // click the door hotspot in Scene14/View18
  const obj = v.scene.views[v.viewIdx].objects[0];
  await v.click(
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
  const consumed = await v.keyDown("uparrow");
  v = viewer();
  check(
    "uparrow through open door travels to hallb",
    consumed && session.currentSetName === "hallb",
    `consumed=${consumed} set=${session.currentSetName} ${v.scene.sceneName}/${v.scene.views[v.viewIdx].viewName}`,
  );
}

// --- 8. doors close on navigation (boot's default closescene) ---
{
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("b59.set");
  const v = viewer();
  const obj = v.scene.views[v.viewIdx].objects[0];
  const cx = Math.floor((obj.startRegionX + obj.endRegionX) / 2);
  const cy = Math.floor((obj.startRegionY + obj.endRegionY) / 2);
  const door = session.propRuntime.get("door")!;

  // open door, then walk away to another scene in the same set
  await v.click(cx, cy);
  sink.calls.length = 0;
  v.jumpTo("Scene14", "View19"); // View19 faces Road34 to Scene15
  v.walk();
  await runAnimations(v);
  const closedOnWalk = !door.visible;
  const closeSound = sink.calls.find((c) => c.channel === "voice");
  check("door closes when walking away", closedOnWalk, `visible=${door.visible}`);
  check("doorclose sound plays", !!closeSound, `${closeSound?.seconds.toFixed(2) ?? "-"}s`);

  // open again, then just turn: view change must also close the door
  v.jumpTo("Scene14", "View18");
  await v.click(cx, cy);
  sink.calls.length = 0;
  v.turn(0);
  await runAnimations(v);
  check("door closes on turn", !door.visible, `visible=${door.visible}`);
  check("doorclose sound on turn", sink.calls.some((c) => c.channel === "voice"));

  // open again, travel to another set: door must not survive the trip
  v.jumpTo("Scene14", "View18");
  await v.click(cx, cy);
  await session.interp.runHandler(session.stage!, "gotospecial", ["hallb", "scene29", "view41"], {
    me: "main.stg",
    target: "",
  });
  check("door closes on set change", !door.visible, `visible=${door.visible}`);
}

// --- 9. movies: boot's spotmovie -> playmovie builtin -> viewer playback ---
{
  const { session, viewer } = await newSession();
  await session.openSetFile("turk.set");
  const v = viewer();
  await session.runGlobal("spotmovie", ["turknmes.mov"]);
  check("spotmovie starts playback", v.moviePlaying);
  const settle9 = () => {
    for (let i = 0; i < 30 && v.moviePlaying; i++) v.tick((clock += 250));
  };
  settle9();
  check("movie pauses at the OK frame", v.moviePlaying);
  await v.click(10, 10); // not on a region: nothing happens
  settle9();
  check("click outside regions is ignored", v.moviePlaying);
  await v.click(458, 350); // on the OK button (region 431..485 x 339..362)
  settle9(); // OK jumps to the pressed-button frame, then the exit chain
  check("OK click closes the movie", !v.moviePlaying);
}

// --- 10. movie zoom cycle (MENU.MOV): paper toggles zoom, only OK leaves ---
{
  const { session, viewer } = await newSession();
  await session.openSetFile("turk.set"); // any set; movie loads via provider
  const v = viewer();
  v.playMovie("menu.mov");
  const settle = () => {
    for (let i = 0; i < 30 && v.moviePlaying; i++) v.tick((clock += 250));
  };
  settle();
  check("menu pauses on the closed view", v.moviePlaying);
  await v.click(460, 350); // OK -> pressed-button frame, then exit
  settle();
  check("OK leaves from the closed view", !v.moviePlaying);

  v.playMovie("menu.mov");
  settle();
  await v.click(280, 210); // the menu paper -> hard cut to "frame3" (zoomed)
  settle();
  check("paper click zooms (still in movie)", v.moviePlaying);
  await v.click(250, 200); // zoomed paper -> hard cut back to "frame1"
  settle();
  check("second paper click unzooms, does NOT leave", v.moviePlaying);
  await v.click(460, 350); // OK button
  settle();
  check("OK leaves the menu movie", !v.moviePlaying);
}

// --- 11. curtains (user-reported): silent open, endless toggle, OK exits ---
{
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  sink.calls.length = 0;
  v.playMovie("curtains.mov");
  const settle = () => {
    for (let i = 0; i < 40 && v.moviePlaying; i++) v.tick((clock += 250));
  };
  settle();
  check("curtains open silently on the closed view", v.moviePlaying && sink.calls.length === 0);
  await v.click(230, 200); // the curtain (frame 1: x116..350 y82..354) -> opens
  settle();
  const openSound = sink.calls.length;
  check("curtain click plays sound + open animation", v.moviePlaying && openSound > 0);
  await v.click(140, 250); // left curtain edge (frame 8) -> closes again
  settle();
  check("second click closes the curtain", v.moviePlaying && sink.calls.length > openSound);
  await v.click(230, 200); // closed again (frame 15) -> jumps back, reopens
  settle();
  check("toggle repeats endlessly", v.moviePlaying);
  await v.click(455, 350); // OK at the open view (frame 8) -> exit animation
  settle();
  check("OK plays the exit animation and closes", !v.moviePlaying);
}

// --- 12. faucet: water cycle with per-frame sounds, OK-position exits ---
{
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  sink.calls.length = 0;
  v.playMovie("faucet.mov");
  const settle = () => {
    for (let i = 0; i < 60 && v.moviePlaying; i++) v.tick((clock += 250));
  };
  settle();
  check("faucet opens silently on the off view", v.moviePlaying && sink.calls.length === 0);
  await v.click(220, 140); // the handle (frame 1: x171..274 y116..163) -> water runs
  settle();
  const sounds = sink.calls.filter((c) => c.channel === "sound").map((c) => c.seconds.toFixed(2));
  check(
    "water cycle fires on/babble/off sounds",
    v.moviePlaying && sounds.length === 3 && sounds[0] === "0.23" && sounds[1] === "3.62" && sounds[2] === "0.19",
    sounds.join(","),
  );
  await v.click(220, 140); // handle again (frame 38) -> the cycle replays
  settle();
  check(
    "handle replays the cycle",
    v.moviePlaying && sink.calls.filter((c) => c.channel === "sound").length === 6,
  );
  await v.click(455, 350); // bottom-right region on frame 38 -> steps out, exits
  settle();
  check("corner click leaves the faucet movie", !v.moviePlaying);
}

// --- 13. grand staircase: deck flips + cross-set travel (user-reported) ---
{
  const { session, viewer } = await newSession();
  const state = () => {
    const v = viewer();
    return `${session.currentSetName} ${v.scene.sceneName}/${v.scene.views[v.viewIdx].viewName}`;
  };
  // B deck, down the stairs: keydown interceptor lives in the SET MAIN
  // script (scene13 has no script container); its changeset targets the
  // shipped typo "view79" — facing-continuity fallback lands on View69
  await session.openSetFile("gstair3.set");
  session.interp.globals.set("savedeck", "b");
  viewer().jumpTo("Scene13", "View33");
  await viewer().keyDown("uparrow");
  await runAnimations(viewer());
  check(
    "gstair3 B-deck stairs flip to C deck",
    state() === "gstair3 Scene65/View69" && session.interp.globals.get("savedeck") === "c",
    `${state()} savedeck=${session.interp.globals.get("savedeck")}`,
  );
  // C deck, down again: leads to the reception set
  await session.openSetFile("gstair3.set");
  session.interp.globals.set("savedeck", "c");
  viewer().jumpTo("Scene13", "View33");
  await viewer().keyDown("uparrow");
  await runAnimations(viewer());
  check("gstair3 C-deck stairs reach recept1c", state() === "recept1c Scene102/View104", state());
  // B deck, walk UP: road to Scene64, arrival openscene forwards to gstair2
  await session.openSetFile("gstair3.set");
  session.interp.globals.set("savedeck", "b");
  viewer().jumpTo("Scene50", "View54");
  viewer().walk();
  await runAnimations(viewer());
  check("gstair3 walk up reaches gstair2", state() === "gstair2 Scene17/View49", state());
}

// --- 14. stage layer: main.stg UI, inventory pickup, inven1 flat ---
{
  const { session, viewer } = await newSession();
  await session.openSetFile("b59.set");
  const v = viewer();
  check(
    "main stage active with its flat",
    session.stageName === "main.stg" && session.currentFlat === "main 1",
    `${session.stageName}/${session.currentFlat}`,
  );
  check("flat image decodes 512x384", session.flatImage()?.width === 512 && session.flatImage()?.height === 384);
  check("UI band lifesaver visible", session.propRuntime.get("life")?.visible === true);
  // bag/watch live in the C73 world (propxyz) — they must NOT pile into
  // the band at their screen anchor (user-reported stacking)
  check(
    "world-space props stay out of the band",
    session.propRuntime.get("bag")?.worldSpace === true &&
      session.propRuntime.get("watch")?.worldSpace === true &&
      session.propRuntime.propAt(256, 324)?.group.name !== "bag",
  );

  // pick up an item: inven.shp's addinven puts it in Frank's hand
  session.interp.globals.set("mission", 1);
  void v;
  check("inven shop main resolvable", !!session.shopMain("inven.shp"));
  await session.interp.runHandler(session.shopMain("inven.shp")!, "addinven", ["carkeys"], {
    me: "inven.shp",
    target: "",
  });
  const keys = session.propRuntime.get("carkeys")!;
  check(
    "addinven puts carkeys in hand",
    session.interp.globals.get("handitem") === "carkeys" && keys.owner === "frank" && keys.visible,
    `handitem=${session.interp.globals.get("handitem")} owner=${keys.owner} visible=${keys.visible}`,
  );

  // open the inventory: boot's transtoflat swaps the stage
  await session.runGlobal("transtoflat", ["inven1.stg"]);
  check(
    "transtoflat opens inven1",
    session.stageName === "inven1.stg" && session.currentFlat === "inven 1",
    `${session.stageName}/${session.currentFlat}`,
  );
  check("set hidden behind inventory", !session.setVisible);
  check("carkeys shown highlighted", keys.visible && keys.stateName === "hilite1", keys.stateName);

  // and back
  await session.runGlobal("transfromflat", []);
  check(
    "transfromflat restores main.stg",
    session.stageName === "main.stg" && session.currentFlat === "main 1",
    `${session.stageName}/${session.currentFlat}`,
  );
}

// --- 15. world-space props: the bag on the C73 bed, projected + takeable ---
{
  const { session, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  v.jumpTo("Scene50", "View59");
  const bag = session.propRuntime.get("bag")!;
  check("bag is a visible world prop", bag.visible && bag.worldSpace, `vis=${bag.visible} ws=${bag.worldSpace}`);
  // scan the view for the bag under the cursor (projection + opaque mask)
  const cam = v.worldCamera()!;
  let hit: { x: number; y: number } | null = null;
  for (let y = 140; y < 264 && !hit; y += 4) {
    for (let x = 200; x < 400 && !hit; x += 4) {
      if (session.propRuntime.propAt(x, y, cam)?.group.name === "bag") hit = { x, y };
    }
  }
  check("bag projects into View59", !!hit, hit ? `${hit.x},${hit.y}` : "not found");
  // the projected anchor must sit on the bed (TI.EXE math: 314,200)
  const proj = projectPoint(cam, bag.worldX, bag.worldY, bag.worldZ);
  check(
    "projection matches TI.EXE math",
    !!proj && proj.x === 314 && proj.y === 200 && proj.depth === 1755,
    proj ? `${proj.x},${proj.y} d=${proj.depth}` : "behind camera",
  );
  if (hit) await v.click(hit.x, hit.y); // bag's mousedown -> addbag()
  check(
    "clicking the bag picks it up",
    bag.owner === "frank" && !bag.worldSpace && bag.anchorY === 324,
    `owner=${bag.owner} ws=${bag.worldSpace} anchor=${bag.anchorX},${bag.anchorY}`,
  );
  check("trunkkey comes along", session.propRuntime.get("trunkkey")?.owner === "frank");
}

// --- 16. timing model: makeloop/makecricket/starxyz/delay/soundloop -------
{
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  // C73's openset arms the Smethells door-knock loop on scene49
  // (makeloop("scene","scene49","smethknock",300) — actorvalue("smeth")=0)
  check("openset arms the knock loop", session.isLoop("scene", "scene49"));

  // fast-forward ~25 s of game time: the loop fires ONCE (loops are
  // self-clearing one-shots), plays a knock cricket at the buzzer star
  // (starxyz -> actor "buzzer" at 3787,1251), and re-arms itself
  sink.calls.length = 0;
  for (let i = 0; i < 380; i++) {
    v.tick((clock += 66));
    if (i % 10 === 0) await drain();
  }
  await session.settle();
  const knock = sink.calls.find((c) => c.channel === "sound" && c.volume < 1 && c.volume > 0);
  check(
    "knock cricket fires with positional volume",
    !!knock,
    knock ? `vol=${knock.volume.toFixed(2)} pan=${knock.pan.toFixed(2)}` : `${sink.calls.length} calls`,
  );
  check("one-shot cricket removed after firing", session.crickets.length === 0);
  check("knock loop re-armed itself", session.isLoop("scene", "scene49"));

  // delay(n) = n/60 s of game time; the script stays suspended (busy) while
  // the clock ticks and resumes exactly after the interval
  let resumed = false;
  const delayFn = session.interp.builtins.get("delay")!;
  void session.track(
    Promise.resolve(
      delayFn(session.interp, [60], null as never, null as never) as Promise<void>,
    ).then(() => {
      resumed = true;
    }),
  );
  v.tick((clock += 500));
  await drain();
  check("delay(60) still suspended after 0.5s", !resumed && v.inputLocked);
  v.tick((clock += 600));
  await drain();
  check("delay(60) resumes after 1s", resumed && !v.inputLocked);

  // soundloop: named looping ambient, on/off, no double-start
  sink.calls.length = 0;
  session.soundLoop("doorlocked", true);
  session.soundLoop("doorlocked", true); // already sounding: no second start
  const loops = sink.calls.filter((c) => c.loop);
  check("soundloop starts one looping sound", loops.length === 1, `${loops.length} loop starts`);
  session.soundLoop("doorlocked", false);
}

// --- 17. actors: GANG.CST loads, DECKBD openset places Morrow -------------
{
  const { session, sink, viewer } = await newSession();
  check("gang.cst cast loads at boot", session.actorRuntime.actors.size === 25,
    `${session.actorRuntime.actors.size} actors`);
  // mission state that makes DECKBD's openset place gang actors
  session.interp.globals.set("mission", 1);
  session.interp.globals.set("phase", 1);
  sink.calls.length = 0;
  // enter next to morrow's star (the default scene auto-forwards to DECKA —
  // the two decks chain like the grand staircase)
  await session.openSetFile("deckbd.set", "scene33", "view94");
  const v = viewer();
  check("still on deckbd (no auto-forward)", session.currentSetName === "deckbd",
    session.currentSetName);
  const morrow = session.actorRuntime.get("morrow")!;
  check(
    "setupactor places morrow on deckbd",
    morrow.visible && morrow.setName === "deckbd" && morrow.scale > 0 &&
      (morrow.worldX !== 0 || morrow.worldY !== 0),
    `vis=${morrow.visible} set=${morrow.setName} scale=${morrow.scale} @${morrow.worldX},${morrow.worldY} pose=${morrow.poseName}`,
  );
  check("deckbd ambient soundloops start", sink.calls.filter((c) => c.loop).length >= 2,
    `${sink.calls.filter((c) => c.loop).length} loops`);
  // find a view where morrow projects on screen and is clickable
  let seen = "";
  outer: for (let s = 0; s < v.set.scenes.length; s++) {
    for (let vi = 0; vi < v.set.scenes[s].views.length; vi++) {
      v.sceneIdx = s;
      v.viewIdx = vi;
      const cam = v.worldCamera()!;
      const list = session.actorRuntime.drawList(cam);
      const hit = list.find((e) => e.a === morrow);
      if (hit) {
        const r = session.actorRuntime.rect(morrow, hit.proj, cam);
        if (r && r.x + r.w > 0 && r.x < 512 && r.h > 20 && r.h < 400) {
          seen = `${v.set.scenes[s].sceneName}/${v.set.scenes[s].views[vi].viewName} rect ${r.x},${r.y} ${r.w}x${r.h}`;
          break outer;
        }
      }
    }
  }
  check("morrow projects into a deckbd view at person size", seen !== "", seen);
}

// --- 18. puppets: SMETH1 conversation — speaks, choices, branching --------
{
  const { session, sink, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  const conversation = session.track(
    (async () => {
      await session.openPuppetFile("smeth1.pup");
      await session.sendEvent("sendtopuppet", "before", "intro", [], "test");
      session.closePuppetFile();
    })(),
  );
  const pump = async (until: () => boolean, max = 3000): Promise<boolean> => {
    for (let i = 0; i < max && !until(); i++) {
      v.tick((clock += 100));
      await drain();
    }
    return until();
  };
  check("puppet file opens into puppet mode", await pump(() => session.puppet !== null));
  const line = (id: string) => session.puppet?.pup.dialogue.get(id)?.text ?? "?";
  check(
    "first line speaks with its subtitle",
    await pump(() => session.puppet?.subtitle === line("smeth1.031")),
  );
  const voice = sink.calls.find((c) => c.channel === "voice");
  check("line voice audio plays", !!voice && voice.seconds > 0.5, `${voice?.seconds.toFixed(2)}s`);
  check(
    "two choice bevels appear after the speeches",
    await pump(() => (session.puppet?.bevels.length ?? 0) === 2),
  );
  await v.click(256, 276 + 26 + 11); // second bevel, via real click routing
  check(
    "choice branches to the next line",
    await pump(() => session.puppet?.subtitle === line("smeth1.034")),
  );
  check(
    "second choice round appears",
    await pump(() => (session.puppet?.bevels.length ?? 0) === 2),
  );
  await v.click(256, 276 + 26 + 11); // decline help -> closing line
  check("conversation ends, puppet closes", await pump(() => session.puppet === null));
  await conversation;
  check("world display returns after the talk", !session.puppet && !v.moviePlaying);
}

// --- 19. actor walking: morrow strolls to his next deck star --------------
{
  const { session, viewer } = await newSession();
  session.interp.globals.set("mission", 1);
  session.interp.globals.set("phase", 1);
  await session.openSetFile("deckbd.set", "scene33", "view94");
  const v = viewer();
  const morrow = session.actorRuntime.get("morrow")!;
  const startX = morrow.worldX;
  // send him to morrow.2 (13045,551) through the real builtin path
  await session.interp.builtins.get("walktostar")!(
    session.interp, ["morrow", "morrow.2"], null as never, null as never,
  );
  check(
    "walk starts: walk pose, facing travel, iswalk true",
    session.isWalk("morrow") && morrow.poseName === "walk",
    `pose=${morrow.poseName} deg=${morrow.deg}`,
  );
  for (let i = 0; i < 4; i++) {
    v.tick((clock += 100));
    await drain();
  }
  const midX = morrow.worldX;
  const midStep = morrow.step;
  check(
    "mid-walk: position moved toward the target, cycle advancing",
    midX > startX && midX < 13045 && midStep > 0,
    `x ${startX} -> ${midX} (target 13045) step=${midStep}`,
  );
  let guard = 0;
  while (session.isWalk("morrow") && guard++ < 500) {
    v.tick((clock += 100));
    await drain();
  }
  check(
    "arrival: at the star, stand pose, walk slot freed",
    morrow.worldX === 13045 && morrow.worldY === 551 &&
      morrow.poseName === "stand" && !session.isWalk("morrow"),
    `@${morrow.worldX},${morrow.worldY} pose=${morrow.poseName}`,
  );
  check("actorstar getter reports the destination", morrow.starName === "morrow.2");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
