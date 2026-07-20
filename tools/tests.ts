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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
