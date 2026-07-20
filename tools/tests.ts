/**
 * Regression suite — runs headless against the original game files.
 *
 *   npx tsx tools/tests.ts [gamefilesDir]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readSetFile } from "../src/df/set";
import { readStgRegions } from "../src/df/stg";
import { readContainerFile } from "../src/df/container";
import { sniffScript, scriptToText } from "../src/df/script";
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
  // the projected anchor must sit on the bed. Camera z comes from the
  // view's stand FRAME (posY16 = 2190 here) — scale-free across sets;
  // the earlier fitted cameraHeight×512 (2351) gave y=200, the frame
  // camera gives y=177 at the same x/depth (both on the bed)
  const proj = projectPoint(cam, bag.worldX, bag.worldY, bag.worldZ);
  check(
    "projection matches TI.EXE math",
    !!proj && proj.x === 314 && proj.y === 177 && proj.depth === 1755,
    proj ? `${proj.x},${proj.y} d=${proj.depth}` : "behind camera",
  );
  // depth scaling reads the frame's refScale (i16 @+42), not a fitted constant:
  // uniformly 96 in the shipped shops, matching GANG.CST (the old 180 ballooned
  // near props like the wireless message slips)
  check(
    "world prop refScale comes from the frame record (96, not the fitted 180)",
    bag.state()?.refScales[0] === 96,
    `ref=${bag.state()?.refScales[0]}`,
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
  // find the view where morrow projects LARGEST while fully on screen — the
  // conversational view you actually approach him in (not a distant/empty one)
  let seen = "";
  let bestH = 0;
  for (let s = 0; s < v.set.scenes.length; s++) {
    for (let vi = 0; vi < v.set.scenes[s].views.length; vi++) {
      v.sceneIdx = s;
      v.viewIdx = vi;
      const cam = v.worldCamera()!;
      const list = session.actorRuntime.drawList(cam);
      const hit = list.find((e) => e.a === morrow);
      if (!hit) continue;
      const r = session.actorRuntime.rect(morrow, hit.proj, cam);
      if (r && r.x >= 0 && r.x + r.w <= 512 && r.h > 20 && r.h < 400 && r.h > bestH) {
        bestH = r.h;
        seen = `${v.set.scenes[s].sceneName}/${v.set.scenes[s].views[vi].viewName} rect ${r.x},${r.y} ${r.w}x${r.h}`;
      }
    }
  }
  check("morrow projects into a deckbd view at person size", seen !== "", seen);

  // --- actor Z-occlusion (SET Z image): scenery hides world sprites ---------
  // fraction of an actor's sprite bbox NOT occluded by the SET depth map;
  // null when the actor isn't in the draw list / has no rect
  const notOccludedFrac = (actor: typeof morrow): number | null => {
    const cam = v.worldCamera();
    if (!cam) return null;
    const hit = session.actorRuntime.drawList(cam).find((e) => e.a === actor);
    if (!hit) return null;
    const r = session.actorRuntime.rect(actor, hit.proj, cam);
    const cur = (v as unknown as { current?: { z?: Uint8Array; width: number; height: number } })
      .current;
    const z = cur?.z;
    if (!r || !cur || !z) return null;
    const scale = v.set.zFarMax / (v.set.zLevelCount || 24);
    const level = Math.max(0, Math.floor(hit.proj.depth / Math.max(1, scale)));
    let vis = 0;
    let tot = 0;
    for (let ty = Math.max(0, r.y); ty < Math.min(cur.height, r.y + r.h); ty++) {
      for (let tx = Math.max(0, r.x); tx < Math.min(cur.width, r.x + r.w); tx++) {
        tot++;
        if (z[ty * cur.width + tx] >= level) vis++;
      }
    }
    return tot ? vis / tot : null;
  };

  check(
    "deckbd SET carries depth quantization (SCDO)",
    v.set.zLevelCount === 24 && v.set.zFarMax === 2750,
    `levels=${v.set.zLevelCount} farMax=${v.set.zFarMax}`,
  );
  // asea stands far down the promenade, behind the deckhouse wall (all near
  // levels) — the ship must hide him (user-reported occlusion bug)
  const asea = session.actorRuntime.get("asea")!;
  v.jumpTo("Scene33", "View94");
  const aseaFrac = asea ? notOccludedFrac(asea) : null;
  check(
    "asea is occluded by the deckhouse on Scene33/View94",
    aseaFrac === 0,
    `notOccludedFrac=${aseaFrac}`,
  );
  // but morrow, at conversational distance where he projects at person size,
  // must NOT be wrongly hidden by his own scenery
  const [msc, mvw] = seen.split(" ")[0].split("/");
  v.jumpTo(msc, mvw);
  const morrowFrac = notOccludedFrac(morrow);
  check(
    "morrow is not over-occluded where he faces the player",
    morrowFrac !== null && morrowFrac > 0.5,
    `notOccludedFrac=${morrowFrac} at ${msc}/${mvw}`,
  );
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

// --- 20. puppet frame cache is per-pup (switching characters, no overlap) --
{
  const { session, viewer } = await newSession();
  await session.openSetFile("c73.set");
  const v = viewer();
  await session.openPuppetFile("morrow1.pup");
  const mpup = session.puppet!.pup;
  const locs = [
    ...new Set(mpup.stances.flatMap((s) => s.layers.flatMap((l) => l.frames))),
  ].filter((n) => n > 0);
  const aByLoc = new Map<number, ReturnType<SetViewer["puppetLayerFrame"]>>();
  for (const loc of locs) {
    try {
      aByLoc.set(loc, v.puppetLayerFrame(loc));
    } catch {
      /* undecodable under morrow — skip */
    }
  }
  session.closePuppetFile();
  // a DIFFERENT character: the same container loc must not return morrow's
  // cached sprite (the reported "leftover data overlaps" bug)
  await session.openPuppetFile("smeth1.pup");
  const spup = session.puppet!.pup;
  let tested = 0;
  let stale = 0;
  for (const loc of locs) {
    const a = aByLoc.get(loc);
    if (!a || !spup.file.containers[loc]) continue;
    let b: ReturnType<SetViewer["puppetLayerFrame"]> = null;
    try {
      b = v.puppetLayerFrame(loc);
    } catch {
      continue;
    }
    if (!b) continue;
    tested++;
    if (a === b) stale++; // same object => cache reused morrow's frame
  }
  check(
    "puppet frames are cached per-pup (no cross-character sprite reuse)",
    tested > 0 && stale === 0,
    `checked ${tested} shared locs, ${stale} reused the previous character`,
  );
}

// --- 21. MAP.STG deck plan: opens, 8 deck flats, renders full-screen -------
{
  const { session } = await newSession();
  await session.openSetFile("c73.set");
  const ok = await session.openStageFile("map.stg");
  check("map.stg opens as a stage", ok && session.stageName === "map.stg");
  check(
    "map.stg has 8 deck flats (Boat..G)",
    session.stageFile?.flats.length === 8 &&
      session.stageFile.flats[0].name === "Map 1",
    `${session.stageFile?.flats.length} flats`,
  );
  session.setVisible = false;
  await session.gotoFlat("Map 1");
  const img = session.flatImage();
  check(
    "map.stg flat decodes to a full 512x384 deck plan",
    !!img && img.width === 512 && img.height === 384,
    img ? `${img.width}x${img.height}` : "no image",
  );
}

// --- 22. point + live pointer builtins (makepoint/pointx/pointy/mouse) -----
{
  const { session, viewer } = await newSession();
  // invoke a builtin by name (call/frame args are unused by these primitives)
  const inv = (name: string, args: number[] = []): number =>
    Number((session.interp.builtins.get(name) as unknown as (i: unknown, a: number[]) => number)(
      session.interp,
      args,
    ));
  const p = inv("makepoint", [353, 137]);
  check(
    "makepoint/pointx/pointy round-trip",
    inv("pointx", [p]) === 353 && inv("pointy", [p]) === 137,
    `p=${p} -> ${inv("pointx", [p])},${inv("pointy", [p])}`,
  );
  // mouse() reflects the live cursor the viewer publishes on move/click
  await session.openSetFile("c73.set");
  await viewer().hover(200, 150);
  const m = inv("mouse");
  check(
    "mouse() reflects the pointer the viewer set on hover",
    inv("pointx", [m]) === 200 && inv("pointy", [m]) === 150,
    `mouse=${inv("pointx", [m])},${inv("pointy", [m])}`,
  );
}

// --- 23. deck map interactivity: transtoflat opens to the player's deck ----
{
  const { session } = await newSession();
  // player is in c73 = C Deck; currentpage() should map that to deck 4
  await session.openSetFile("c73.set");
  await session.transToFlat("map.stg");
  check(
    "transtoflat opens the map full-screen (setvisible off)",
    session.stageName === "map.stg" && session.setVisible === false,
    `stage=${session.stageName} setVisible=${session.setVisible}`,
  );
  check(
    "map opens to the player's current deck (c73 -> C Deck = Map 4)",
    session.currentFlat === "Map 4",
    session.currentFlat,
  );
  check("flattoindex resolves names and indices", session.flatToIndex("Map 4") === 4);
  // page to A Deck via the stage's gotopage (numeric gotoflat under the hood)
  await session.runGlobal("gotopage", [2]);
  check("gotopage pages decks (A Deck = Map 2)", session.currentFlat === "Map 2", session.currentFlat);
  // leaving the map restores the in-game stage
  await session.transFromFlat();
  check(
    "transfromflat restores the in-game stage",
    session.stageName === "main.stg" && session.setVisible === true,
    `stage=${session.stageName} setVisible=${session.setVisible}`,
  );
}

// --- 24. deck map click-logic regions: deck buttons + OK are clickable -----
{
  const { session } = await newSession();
  await session.openSetFile("c73.set");
  await session.transToFlat("map.stg"); // opens to Map 4 (C Deck)
  // regions decode with clean pascal names and in-bounds Y-first rects
  const stg = session.stageFile!;
  const flat = stg.flats.find((f) => f.name === session.currentFlat)!;
  const regions = readStgRegions(stg.file.containers[flat.locationClickLogic].data);
  check(
    "click-logic regions parse (count + clean names + in bounds)",
    regions.length === 12 &&
      regions.every((r) => /^[\x20-\x7e]*$/.test(r.name)) &&
      regions.every((r) => r.top >= 0 && r.left >= 0 && r.bottom <= 384 && r.right <= 512),
    `${regions.length} regions, names e.g. "${regions[0]?.name}"`,
  );
  // clicking the Boat Deck button (fixed bottom-panel position) pages the map
  const handled = await session.stageClickAt(123, 325);
  check(
    "clicking a deck button pages to that deck",
    handled && session.currentFlat === "Map 1",
    `handled=${handled} flat=${session.currentFlat}`,
  );
  // clicking OK runs exitmap -> transfromflat -> back to the in-game stage
  await session.stageClickAt(399, 340);
  check(
    "clicking OK closes the deck map",
    session.stageName === "main.stg" && session.setVisible === true,
    `stage=${session.stageName} setVisible=${session.setVisible}`,
  );
}

// --- 25. deck map red-area jump: click a zone -> travel to that location ---
{
  const { session } = await newSession();
  await session.openSetFile("c73.set");
  // mapdisabled() gates jumping on owning the bag + watch (and not mission 4)
  const bag = session.propRuntime.get("bag");
  const watch = session.propRuntime.get("watch");
  if (bag) bag.owner = "frank";
  if (watch) watch.owner = "frank";
  await session.transToFlat("map.stg"); // -> Map 4 (C Deck)
  // find a red-area (jumpbaby) region and click its centre
  const stg = session.stageFile!;
  const flat = stg.flats.find((f) => f.name === session.currentFlat)!;
  const regions = readStgRegions(stg.file.containers[flat.locationClickLogic].data);
  let jumped = "";
  for (const r of regions) {
    const toks = sniffScript(stg.file.containers[r.script].data);
    if (!toks || !scriptToText(toks).includes("jumpbaby")) continue;
    await session.stageClickAt(
      Math.round((r.left + r.right) / 2),
      Math.round((r.top + r.bottom) / 2),
    );
    jumped = session.currentSetName;
    break;
  }
  check(
    "clicking a red map area travels there and closes the map",
    jumped !== "" && jumped !== "c73" && session.stageName === "main.stg" && session.setVisible,
    `set=${jumped} stage=${session.stageName}`,
  );
}

// --- 26. deck map cosmetics: you-are-here dot, deck highlight, disable bar --
{
  const { session } = await newSession();
  await session.openSetFile("c73.set"); // C Deck = page 4
  // tour mode opens the map with jumps enabled (mapdisabled() -> false)
  session.interp.globals.set("tour", 1);
  await session.transToFlat("map.stg");
  const buttons = session.propRuntime.get("buttons")!;
  const spot = session.propRuntime.get("spot")!;
  const disable = session.propRuntime.get("disable")!;
  check(
    "map props default to their first state (no propview in scripts)",
    buttons.state()?.identifier === "untitled" &&
      spot.state()?.identifier === "blink" &&
      disable.state()?.identifier === "untitled",
    `buttons=${buttons.state()?.identifier} spot=${spot.state()?.identifier}`,
  );
  check(
    "deck highlight pins the current deck's frame (C Deck = page 4 -> frame 3)",
    buttons.visible && buttons.frameLocked && buttons.frameIdx === 3,
    `visible=${buttons.visible} locked=${buttons.frameLocked} frame=${buttons.frameIdx}`,
  );
  check(
    "you-are-here dot is placed off the default anchor (posdot ran)",
    spot.visible && !(spot.anchorX === 256 && spot.anchorY === 192),
    `visible=${spot.visible} anchor=(${spot.anchorX},${spot.anchorY})`,
  );
  check("tour mode hides the disable bar", disable.visible === false);
  // paging to another deck moves the highlight frame with it
  await session.runGlobal("gotopage", [2]); // A Deck
  check(
    "deck highlight follows paging (A Deck = page 2 -> frame 1)",
    session.currentFlat === "Map 2" && buttons.frameIdx === 1,
    `flat=${session.currentFlat} frame=${buttons.frameIdx}`,
  );
}

// --- 27. deck map disable bar shows when jumps are locked (no bag/watch) ----
{
  const { session } = await newSession();
  await session.openSetFile("c73.set");
  // fresh session: no bag, no watch, no tour -> mapdisabled() is true
  await session.transToFlat("map.stg");
  const disable = session.propRuntime.get("disable")!;
  check(
    "disable bar is shown + centred when the map is locked",
    disable.visible && disable.anchorX === 256 && disable.anchorY === 192,
    `visible=${disable.visible} anchor=(${disable.anchorX},${disable.anchorY})`,
  );
}

// --- 28. wireless stage: opens, sets up its props, zooms into a control -----
{
  const { session } = await newSession();
  await session.openSetFile("wireless.set");
  await session.transToFlat("wireless.stg");
  check(
    "wireless stage opens full-screen to its overview flat",
    session.stageName === "wireless.stg" && session.setVisible === false &&
      session.currentFlat === "wireless 1",
    `stage=${session.stageName} flat=${session.currentFlat} setVisible=${session.setVisible}`,
  );
  // openwireless() -> openshopfile("wireless.shp"); openshop() -> setupsmallprops()
  // makes the overview ("small") apparatus props visible on the stage
  const senderhandle = session.propRuntime.get("senderhandle")!;
  const tunerneedle = session.propRuntime.get("tunerneedle")!;
  const wirelessbag = session.propRuntime.get("wirelessbag")!;
  check(
    "openshop re-fires on stage entry -> overview props set up (setupsmallprops)",
    senderhandle.visible && senderhandle.stateName === "small" &&
      tunerneedle.visible && wirelessbag.visible,
    `sender=${senderhandle.visible}/${senderhandle.stateName} tuner=${tunerneedle.visible} bag=${wirelessbag.visible}`,
  );
  // the in-game interface band (house.shp) is hidden behind the full-screen stage
  check("in-game interface band hidden during the stage", session.propRuntime.get("life")?.visible === false);
  // clicking the "tuner" control region zooms into its big flat (openflat sets
  // tunerneedle to its "big" view)
  const stg = session.stageFile!;
  const flat = stg.flats.find((f) => f.name === session.currentFlat)!;
  const regions = readStgRegions(stg.file.containers[flat.locationClickLogic].data);
  const tuner = regions.find((r) => r.name === "tuner")!;
  await session.stageClickAt(
    Math.round((tuner.left + tuner.right) / 2),
    Math.round((tuner.top + tuner.bottom) / 2),
  );
  check(
    "clicking a control zooms into its flat (tuner -> big view)",
    session.currentFlat !== "wireless 1" && tunerneedle.stateName === "big",
    `flat=${session.currentFlat} tunerneedle=${tunerneedle.stateName}`,
  );
}

// --- 29. wireless knob drag: held-button (stilldown) rotates a control ------
{
  const { session, viewer } = await newSession();
  await session.openSetFile("wireless.set");
  await session.transToFlat("wireless.stg");
  await session.gotoFlat("wireless 2"); // breaker big flat
  const v = viewer();
  const breaker = session.propRuntime.get("breakerhandle")!;
  // the breaker lever's clickable pivot sits near (200,85); its big-view
  // mousedown enters a `while stilldown()` loop that sets propdeg from the
  // live pointer x — x>198 selects deg 4 -> owner "rx"
  session.setPointer(200, 85);
  session.pointerDown = true;
  const drag = session.track(v.click(200, 85));
  // pump the clock so stilldown()'s per-frame yield resolves, then release
  let done = false;
  drag.then(() => (done = true));
  for (let i = 0; i < 6 && !done; i++) {
    v.tick((clock += 50));
    await drain();
  }
  const draggedDeg = breaker.deg;
  session.pointerDown = false; // release ends the loop
  for (let i = 0; i < 8 && !done; i++) {
    v.tick((clock += 50));
    await drain();
  }
  await drag;
  check(
    "held-button drag rotates the breaker knob and commits on release",
    draggedDeg === 4 && breaker.owner === "rx",
    `deg-during=${draggedDeg} owner-after=${breaker.owner}`,
  );
}

// --- 30. wireless OK button: trackbut commits only if released over it ------
for (const [label, releaseX, releaseY, expectExit] of [
  ["released over OK -> exits the stage", 457, 350, true],
  ["released off OK -> stays in the stage", 100, 100, false],
] as [string, number, number, boolean][]) {
  const { session } = await newSession();
  await session.openSetFile("wireless.set");
  await session.transToFlat("wireless.stg");
  // OK button rect ~ (428..485, 338..363); press inside it
  session.setPointer(457, 350);
  session.pointerDown = true;
  const p = session.track(session.stageClickAt(457, 350));
  let done = false;
  p.then(() => (done = true));
  for (let i = 0; i < 4 && !done; i++) {
    session.tickTime((clock += 50));
    await drain();
  }
  session.setPointer(releaseX, releaseY); // move to release point
  session.tickTime((clock += 50));
  await drain();
  session.pointerDown = false; // release
  for (let i = 0; i < 8 && !done; i++) {
    session.tickTime((clock += 50));
    await drain();
  }
  await p;
  const exited = session.stageName === "main.stg" && session.setVisible === true;
  check(`wireless OK: ${label}`, exited === expectExit, `stage=${session.stageName} setVisible=${session.setVisible}`);
}

// --- 31. wireless message readout: drawstring text layer accumulates/clears -
{
  const { session } = await newSession();
  await session.openSetFile("wireless.set");
  await session.transToFlat("wireless.stg");
  // find the flat whose script owns the morse readout (drawtext/clearmessagebox)
  let readoutFlat: string | null = null;
  for (const fn of session.flatNames) {
    if (session.flatScripts.get(fn)?.script.codes.has("drawtext")) {
      readoutFlat = fn;
      break;
    }
  }
  await session.gotoFlat(readoutFlat!);
  const inst = session.flatScripts.get(session.currentFlat)!;
  const ctx = { me: session.currentFlat, target: "" };
  const call = (h: string, a: (string | number)[] = []) =>
    session.interp.runHandler(inst, h, a, ctx);

  // clearmessagebox() resets the pen to 75 and flashes messageboxclear, whose
  // visibility hook wipes the text layer
  await call("clearmessagebox");
  const clearedFirst = session.textOverlay.length === 0;

  // each drawtext(letter) paints one glyph at the pen and advances the pen by
  // its stringwidth — so the layer grows and the x coordinates increase
  for (const ch of ["h", "e", "l", "l", "o"]) await call("drawtext", [ch]);
  const ov = session.textOverlay;
  const grew = ov.length === 5;
  const advancing = ov.every((e, i) => i === 0 || e.x > ov[i - 1].x);
  // the pen advanced past the left margin (messagebox value tracks the x pen)
  const penMoved = (session.propRuntime.get("messagebox")!.value as number) > 75;
  check(
    "wireless readout: drawtext lays out glyphs left-to-right",
    clearedFirst && grew && advancing && penMoved,
    `cleared=${clearedFirst} n=${ov.length} advancing=${advancing} pen=${session.propRuntime.get("messagebox")!.value}`,
  );

  // clearmessagebox() again empties the layer (messageboxclear shown -> hook)
  await call("clearmessagebox");
  check(
    "wireless readout: clearmessagebox() wipes the text layer",
    session.textOverlay.length === 0,
    `n=${session.textOverlay.length}`,
  );

  // a full line (pen past 340) auto-wraps: the next drawtext clears then draws
  // one glyph back at the left margin
  session.propRuntime.get("messagebox")!.value = 345;
  await call("drawtext", ["z"]);
  const wrapped = session.textOverlay.length === 1 && session.textOverlay[0].x < 100;
  check(
    "wireless readout: pen past the right edge wraps to a fresh line",
    wrapped,
    `n=${session.textOverlay.length} x=${session.textOverlay[0]?.x}`,
  );
}

// --- 32. wireless tuner gating: propxy getter + tuned() -> tunerknob "on" ----
{
  const { session } = await newSession();
  await session.openSetFile("wireless.set");
  await session.transToFlat("wireless.stg");
  const needle = session.propRuntime.get("tunerneedle")!;
  const knob = session.propScripts.get("tunerknob")!;
  const runKnob = (h: string, a: any[] = []) =>
    session.interp.runHandler(knob, h, a, { me: "tunerknob", target: "" });

  // the needle's screen Y IS the frequency. adjustneedle() reads it via the
  // propxy(name,2) GETTER and writes it back via the setter — exercising both.
  needle.anchorX = 256;
  needle.anchorY = 100;
  await runKnob("adjustneedle", [2]);
  const movedY = needle.anchorY; // 100 -> 102 iff the propxy getter works

  // RX puzzle preconditions: sender on, breaker rx, needle in the 81-87 window
  session.propRuntime.get("senderhandle")!.owner = "on";
  session.propRuntime.get("breakerhandle")!.owner = "rx";
  session.propRuntime.get("tunerneedle")!.value = 84;
  const tunedIn = (await runKnob("tuned")).value;

  // off-window -> not tuned
  session.propRuntime.get("tunerneedle")!.value = 100;
  const tunedOut = (await runKnob("tuned")).value;

  // tuneron() latches the knob "on" and lights the tuner
  session.propRuntime.get("tunerneedle")!.value = 84;
  await runKnob("tuneron", ["big"]);
  const knobOwner = session.propRuntime.get("tunerknob")!.owner;
  const lit = session.propRuntime.get("tunerlight1")!.visible;

  check(
    "wireless tuner: propxy getter moves needle; tuned() gates; tuneron latches on",
    movedY === 102 && !!tunedIn && !tunedOut && knobOwner === "on" && lit,
    `movedY=${movedY} in=${tunedIn} out=${tunedOut} owner=${knobOwner} lit=${lit}`,
  );
}

// --- 33. wireless TX keydown routes to the flat script (not the stage main) --
{
  const { session } = await newSession();
  await session.openSetFile("wireless.set");
  await session.transToFlat("wireless.stg");
  // the deck-map-style stage routes keydown to the stage main; wireless routes
  // to the current FLAT (its keydown/tx lives there). On the readout flat the
  // target is that flat; the stage main has no keydown of its own.
  let readoutFlat: string | null = null;
  for (const fn of session.flatNames) {
    if (session.flatScripts.get(fn)?.script.codes.has("keydown")) { readoutFlat = fn; break; }
  }
  await session.gotoFlat(readoutFlat!);
  const target = session.keydownTarget();
  const isFlat = target === session.flatScripts.get(session.currentFlat);
  const stageHasNoKeydown = !session.stage!.script.codes.has("keydown");
  check(
    "wireless TX: keydown routes to the readout flat, not the stage main",
    isFlat && stageHasNoKeydown && target !== null,
    `target=${target?.name} stageKeydown=${!stageHasNoKeydown}`,
  );
}

// --- 34. puppetbase seats the character in a line's resting pose ----------
{
  const { session } = await newSession();
  await session.openPuppetFile("bx2.pup");
  const hands1 = () => session.puppetFrame()?.layers[8]?.frame; // hands1 layer
  session.puppetBase("bx2.07"); // baby present -> hands1 holds it (frame 2)
  const withBaby = hands1();
  session.puppetBase("bx2.01"); // no baby -> hands1 hidden (-1)
  const noBaby = hands1();
  session.puppetBase(""); // revert to the neutral opening pose
  const reverted = session.puppetFrame() === session.puppet?.defaultPose;
  check(
    "puppetbase seats the character in a line's resting pose (bx2 baby)",
    withBaby === 2 && noBaby === -1 && reverted,
    `withBaby=${withBaby} noBaby=${noBaby} reverted=${reverted}`,
  );
  session.closePuppetFile();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
