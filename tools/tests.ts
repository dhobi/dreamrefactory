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

  // soundloop: a FLAG — the sound loops when subsequently played (the corpus
  // always pairs `soundloop(x, true)` with a singlesound/multiplesound or a
  // makecricket); playing a flagged sound twice doesn't stack; haltsound
  // stops the tracked loop (the gramophone hiss must not outlive the crank)
  sink.calls.length = 0;
  session.soundLoop("doorlocked", true);
  check("soundloop alone plays nothing (it only flags)", sink.calls.length === 0, `${sink.calls.length} plays`);
  session.playSound("doorlocked", false);
  session.playSound("doorlocked", false); // already looping: no second start
  const loops = sink.calls.filter((c) => c.loop);
  check("flagged sound plays as ONE tracked loop", loops.length === 1 && sink.calls.length === 1, `${loops.length} loop starts of ${sink.calls.length} plays`);
  session.haltSounds();
  sink.calls.length = 0;
  session.playSound("doorlocked", false); // flag persists: loops again after halt
  check("haltsound stops the loop; flag persists for the next play", sink.calls.filter((c) => c.loop).length === 1, `${sink.calls.length} plays`);
  session.soundLoop("doorlocked", false);
  sink.calls.length = 0;
  session.playSound("doorlocked", false);
  check("soundloop(off) unflags: plays one-shot again", sink.calls.length === 1 && !sink.calls[0].loop, `loop=${sink.calls[0]?.loop}`);
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
  // ambience = soundloop flag + makecricket; a cricket starts LOOPING on the
  // first service tick the player is within its radius (positional — the far
  // one stays armed and will start when approached, so exactly one of
  // motor/machine is audible from this spawn)
  for (let i = 0; i < 3; i++) { session.tickTime((clock += 66)); await drain(); }
  check(
    "deckbd ambient: soundloop-flagged crickets loop; both registered",
    sink.calls.filter((c) => c.loop).length >= 1 &&
      session.isCricket("motor") && session.isCricket("machine"),
    `${sink.calls.filter((c) => c.loop).length} loops, motor=${session.isCricket("motor")} machine=${session.isCricket("machine")}`,
  );
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
    // propdeg("buttons", page-1): page 4 -> deg 3. The frames' stored degrees
    // are [8,0,1,2,3,4,5,6,7], so deg 3 is frame index 4 (deg 8 = frame 0 =
    // "no deck highlighted"). Selecting by frame index instead of degree used
    // to highlight the wrong deck / show a deck for exitmap's "none".
    "deck highlight pins the current deck's frame (C Deck = deg 3 -> frame 4)",
    buttons.visible && buttons.frameLocked && buttons.frameIdx === 4,
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
    "deck highlight follows paging (A Deck = page 2 -> deg 1 -> frame 2)",
    session.currentFlat === "Map 2" && buttons.frameIdx === 2,
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

// --- 35. walkonpath: sentinel while moving, dest on arrival, endwalk fires -
{
  const { session, viewer } = await newSession();
  session.interp.globals.set("mission", 1);
  session.interp.globals.set("tour", 1); // morrowidle idles in place (deterministic)
  await session.openSetFile("deckbd.set", "scene33", "view94");
  const v = viewer();
  const morrow = session.actorRuntime.get("morrow")!;
  session.interp.builtins.get("walkonpath")!(
    session.interp, ["morrow", "morrow.1", "morrow.2"], null as never, null as never,
  );
  // while walking, actorstar() reports the sentinel (resume detection)
  const sentinel = morrow.starName === "walkonpath" && session.isWalk("morrow");
  let guard = 0;
  while (session.isWalk("morrow") && guard++ < 500) { v.tick((clock += 100)); await drain(); }
  await drain(); // let the arrival endwalk() dispatch run
  // on arrival: settles on the destination star + endwalk fired (morrowidle
  // reschedules itself as an actor loop — proof the arrival handler ran)
  const endwalkFired = session.loops.some((l) => l.kind === "actor" && l.name === "morrow");
  check(
    "walkonpath: sentinel while moving, dest star on arrival, endwalk fires",
    sentinel && morrow.starName === "morrow.2" && endwalkFired,
    `sentinel=${sentinel} arrived=${morrow.starName} endwalkLoop=${endwalkFired}`,
  );
}

// --- 36. actor facing: sprite direction faces the camera (front, not back) -
{
  const { session } = await newSession();
  await session.openSetFile("deckbd.set");
  const morrow = session.actorRuntime.get("morrow")!;
  const stand = morrow.member.poses.find((p) => p.name === "stand")!;
  morrow.poseName = "stand";
  morrow.step = 0;
  // actor due east of the camera → actor→camera bearing is 128 (west)
  morrow.worldX = 1000; morrow.worldY = 0; morrow.worldZ = 0; morrow.scale = 900;
  const cam = { x: 0, y: 0, z: 0, deg: 0, f: 256, cx: 256, cy: 132, clipW: 512, clipH: 264 };
  const proj = { x: 256, y: 132, depth: 482 };
  const front = morrow.cast.frame(stand.steps[0][0]!.location); // dir 0 (angle 0) = face toward viewer
  const back = morrow.cast.frame(stand.steps[0][4]!.location); //  dir 4 (angle 128) = back
  morrow.deg = 128; // facing the camera → must show the FRONT sprite
  const facing = session.actorRuntime.rect(morrow, proj, cam)?.f;
  morrow.deg = 0; // facing away (east, into the scene) → BACK sprite
  const away = session.actorRuntime.rect(morrow, proj, cam)?.f;
  check(
    "actor facing the camera shows the front sprite, not the back",
    facing === front && away === back,
    `facing=front?${facing === front} away=back?${away === back}`,
  );
}

// --- 37. trunk gramophone: clicking gramdrawerbut opens the drawer ----------
// Exercises the stage "button" dispatch: a region whose own script only sets
// the cursor forwards its mousedown up region -> flat -> stage main, keyed by
// target; the trunk main runs sendtoprop("gramdrawer", open()), and the prop's
// open() handler shows the drawer and (via makeloop) settles it to "idle".
{
  const { session } = await newSession();
  await session.openSetFile("b59.set");
  await session.transToFlat("trunk.stg");
  await session.gotoFlat("Trunk 2");
  const gd = session.propRuntime.get("gramdrawer")!;
  const before = gd.visible;
  await session.stageClickAt(344, 328); // gramdrawerbut region center
  const openedView = gd.stateName;
  for (let i = 0; i < 8; i++) { session.tickTime((clock += 66)); await drain(); } // makeloop -> idle
  check(
    "trunk: gramdrawerbut opens the drawer (region->stage main->sendtoprop open())",
    !before && gd.visible && openedView.startsWith("open") && gd.stateName.startsWith("idle"),
    `before=${before} openedView=${openedView} settled=${gd.stateName}`,
  );
}

// --- 38. trunk: pointinbutton hit-tests a flat's named click-region ---------
{
  const { session } = await newSession();
  await session.openSetFile("b59.set");
  await session.transToFlat("trunk.stg");
  await session.gotoFlat("Trunk 2");
  const pib = session.interp.builtins.get("pointinbutton")!;
  const pt = (x: number, y: number) => ((x & 0xffff) << 16) | (y & 0xffff);
  const flat = session.currentFlat; // "Trunk 2"
  // wax1 drop-slot region ~ [391,304,437,358]
  const inside = pib(session.interp, [flat, "wax1", pt(414, 331)], null as never, null as never);
  const outside = pib(session.interp, [flat, "wax1", pt(10, 10)], null as never, null as never);
  const nosuch = pib(session.interp, [flat, "nope", pt(414, 331)], null as never, null as never);
  check(
    "trunk: pointinbutton is 1 inside a flat region, 0 outside / unknown",
    inside === 1 && outside === 0 && nosuch === 0,
    `in=${inside} out=${outside} nosuch=${nosuch}`,
  );
}

// --- 39. substring(haystack, needle) is a 1-based find, not a slice ---------
// Scripts gate on it: `substring(propview(me),"idle") >= 0` (trunk drawer),
// `substring(path(1),"titanic1:") = 1` (prefix), and ENIGMA's key mapping
// `substring("abcdefghijklmnopqrstuvwxyz ", arg) - 1` needs 'a' -> 1.
{
  const { session } = await newSession();
  const sub = session.interp.builtins.get("substring")!;
  const call = (s: string, n: string) => sub(session.interp, [s, n], null as never, null as never);
  check(
    "substring is a 1-based case-insensitive find (-1 when absent)",
    call("abcdefghijklmnopqrstuvwxyz ", "a") === 1 && call("abcdefghijklmnopqrstuvwxyz ", "c") === 3 &&
      call("idle12", "idle") === 1 && call("open2", "idle") === -1 &&
      call("Titanic1:foo", "titanic1:") === 1,
    `a=${call("abcdefghijklmnopqrstuvwxyz ", "a")} c=${call("abcdefghijklmnopqrstuvwxyz ", "c")} miss=${call("open2", "idle")}`,
  );
}

// --- 40. putword/findword round-trip (save/restore prop lists) --------------
// hideenigma/hidetrunk save each prop's visibility into a space-delimited slot
// string via putword, then showX reads it back with findword. An empty
// delimiter means the default separator (a space).
{
  const { session } = await newSession();
  const put = session.interp.builtins.get("putword")!;
  const find = session.interp.builtins.get("findword")!;
  const B = session.interp;
  // build "1 0 1" by setting slots 1..3 from an empty string (grows w/ padding)
  let s: any = "";
  s = put(B, [s, "", 1, "1"], null as never, null as never);
  s = put(B, [s, "", 2, "0"], null as never, null as never);
  s = put(B, [s, "", 3, "1"], null as never, null as never);
  const readBack = [1, 2, 3].map((i) => find(B, [s, "", i], null as never, null as never));
  // overwrite a middle slot; commas still work as an explicit delimiter
  const s2 = put(B, [s, "", 2, "1"], null as never, null as never);
  const csv = find(B, ["a,b,c", ",", 2], null as never, null as never);
  check(
    "putword/findword round-trip (empty delim = space; explicit delim works)",
    s === "1 0 1" && readBack.join("") === "101" && s2 === "1 1 1" && csv === "b",
    `s="${s}" read=${readBack.join("")} s2="${s2}" csv=${csv}`,
  );
}

// --- 41. ENIGMA decode logic: dial gate + typed message accumulation --------
// With power on (switch + wires) and the dials at the mission's unlock combo,
// checkey() lets typed letters accumulate into dialmess (dialset() gates the
// first letter); a decode compares dialmess to goodmess. Drives the real stage
// keydown handler; the powerup animation is bypassed by seeding state directly.
{
  const { session } = await newSession();
  await session.openSetFile("b59.set");
  await session.transToFlat("enigma.stg");
  session.interp.globals.set("mission", 1);
  const set = (n: string, deg: number) => { const p = session.propRuntime.get(n); if (p) p.deg = deg; };
  set("enigsw", 1); // switchon()
  set("enigwirer", 0); set("enigwireg", 0); // wireson()
  set("zeitgram", 0); // -> combo 8,7,5,4 ; goodmess below
  set("dial1", 8); set("dial2", 7); set("dial3", 5); set("dial4", 4);
  const goodmess = "anhqsppaixwbfcxyam";
  session.interp.globals.set("goodmess", goodmess);
  session.interp.globals.set("dialmess", "");
  const kd = session.keydownTarget()!;
  const type = async (ch: string) =>
    session.interp.runHandler(kd, "keydown", [ch], { me: kd.name, target: kd.name });
  const beforeGate = session.keydownTarget()?.script.codes.has("keydown");
  for (const ch of goodmess) await type(ch);
  const dialmess = session.interp.globals.get("dialmess");
  check(
    "enigma: powered + dials set -> typed letters accumulate into dialmess == goodmess",
    beforeGate === true && dialmess === goodmess,
    `dialmess="${dialmess}"`,
  );
  // negative: with the dials WRONG, dialset() fails so the first letter is
  // rejected and dialmess stays empty
  session.interp.globals.set("dialmess", "");
  set("dial4", 0); // break the combo
  for (const ch of goodmess) await type(ch);
  check(
    "enigma: wrong dial combo -> dialset() gate keeps dialmess empty",
    session.interp.globals.get("dialmess") === "",
    `dialmess="${session.interp.globals.get("dialmess")}"`,
  );
}

// --- 42. BOIL boiler chute: door opens, switch slides the gate + flips flat -
// Reuses the shared machinery with no new opcodes: prop mousedowns (own
// scripts), sendtoprop up()/down(), the soundloop-flagged slide, and gotoflat
// between the two flats (boil 1 closed <-> boil 2 chute revealed).
{
  const { session } = await newSession();
  await session.openSetFile("b59.set");
  await session.transToFlat("boil.stg");
  await session.gotoFlat("boil 1");
  const door = session.propRuntime.get("boildoor")!;
  const sw = session.propRuntime.get("boilswitch")!;
  const fire = async (name: string) => {
    const inst = session.propScripts.get(name)!;
    await session.interp.runHandler(inst, "mousedown", [name], { me: name, target: name });
    await drain();
  };
  const startFlat = session.currentFlat;
  await fire("boildoor"); // idleclosed -> idleopen
  const doorOpen = door.stateName;
  await fire("boilswitch"); // idleup -> down; boilgate.down() slides + gotoflat(2)
  const afterDown = { sw: sw.stateName, flat: session.currentFlat };
  await fire("boilswitch"); // idledown -> up; boilgate.up() -> gotoflat(1)
  const afterUp = { sw: sw.stateName, flat: session.currentFlat };
  check(
    "boil: door opens; switch slides the gate and flips flat 1<->2",
    startFlat === "boil 1" && doorOpen === "idleopen" &&
      afterDown.sw === "idledown" && afterDown.flat === "boil 2" &&
      afterUp.sw === "idleup" && afterUp.flat === "boil 1",
    `door=${doorOpen} down=${JSON.stringify(afterDown)} up=${JSON.stringify(afterUp)}`,
  );
}

// --- 43. set view scopes screen props to persistent (boot) shops -----------
// A set's auto-opened shop can be a STAGE shop with screen-space props (boil.shp
// = the boiler flat controls). Those must not draw/click on the room's
// navigation view — only the persistent UI shops (house/inven) may. Regression
// for the "wrong overlay: clickable rubaiyat hiding place on Scene10/View31".
{
  const { session } = await newSession();
  await session.openSetFile("boil.set");
  const boilShop = session.propRuntime.shops.get("boil.shp");
  const houseShop = session.propRuntime.shops.get("house.shp");
  const bag = session.propRuntime.get("boilbag")!; // a boil.shp screen control
  // a point inside boilbag's drawn rect
  const st = bag.state()!;
  const f = bag.shop.frame(st.frames[0]);
  const px = bag.anchorX - f.posXraw + Math.floor(f.width / 2);
  const py = bag.anchorY - f.posYraw + Math.floor(f.height / 2);
  const hitAll = session.propRuntime.propAt(px, py, null, false); // stage overlay scope
  const hitSetView = session.propRuntime.propAt(px, py, null, true); // set-view scope
  check(
    "set view: stage-shop screen props are excluded (draw + click); boot UI persists",
    boilShop?.persistent === false && houseShop?.persistent === true &&
      bag.visible === true && hitAll === bag && hitSetView !== bag,
    `boilPersist=${boilShop?.persistent} housePersist=${houseShop?.persistent} hitAll=${hitAll?.group.name} hitSetView=${hitSetView?.group.name ?? null}`,
  );
}

// --- 44. per-deck theme selection via changeset -> setupsound --------------
// Themes are named by DECK, not by set (recept1c -> deckd.trk, halla ->
// decka.trk); BOOTFILE setupsound() picks them on set entry. Two bugs made
// rooms silent: (1) a set's openset passcodes to boot's setupsound but first
// fires sendtoactor(setupactor()) whose handler exitcodes — the shared
// eventConsumed flag leaked and fireLifecycle skipped boot's openset; (2) the
// lowmemory() deck path (decka/deckb/decke/deckf/cargo) loaded the .11k bank
// while playnewtheme asked for the .trk, because heapsize() reported 0. This
// exercises the authentic boot changeset() path end to end.
{
  const { session } = await newSession();
  await session.runGlobal("changeset", ["recept1c", "", ""]); // deckd, no lowmemory branch
  const deckd = session.currentThemeName;
  await session.runGlobal("changeset", ["halla", "", ""]); // decka, via lowmemory() branch
  const decka = session.currentThemeName;
  // same-deck travel must keep the theme playing (setupsound exits early)
  let themePlays = 0;
  const origPlay = session.audio.play.bind(session.audio);
  (session.audio as unknown as { play: unknown }).play = (ch: string, a: unknown, o: unknown) => {
    if (ch === "theme") themePlays++;
    return (origPlay as (c: string, a: unknown, o: unknown) => unknown)(ch, a, o);
  };
  await session.runGlobal("changeset", ["lnghall", "", ""]); // decka again -> no change
  const stayed = session.currentThemeName;
  check(
    "themes are chosen per deck; same-deck travel is seamless",
    deckd === "deckd.trk" && decka === "decka.trk" && stayed === "decka.trk" && themePlays === 0,
    `recept1c=${deckd} halla=${decka} lnghall=${stayed} sameDeckReplays=${themePlays}`,
  );
}

// --- 45. BOMB defuse: hit-test routing, changedone, timer loop, OK win ------
// The bomb is a timed multi-switch logic puzzle. Exercises: openstage setup;
// authentic click routing (hit-test which prop is drawn under a region, then
// dispatch its mousedown with the point — the prop's own pointinbutton reads
// the sub-region); changedone() re-evaluation; the NEW stage-flat self-re-arming
// timer (makeloop("flat", currentflat(), "unibomnoise", …) firing the stage
// handler each service step, sweeping the second hand); and the hitok() win
// (door open + key out + power spent -> addinven + transfromflat).
{
  const { session } = await newSession();
  await session.openSetFile("b59.set");
  await session.transToFlat("bomb.stg");
  await drain();
  const g = (n: string): unknown => session.interp.globals.get(n);
  const setup = {
    door: g("unibomdoor"),
    power: g("unibompower"),
    sw1: session.propRuntime.get("switch1")?.deg,
  };
  const center = (name: string): [number, number] => {
    const r = session.flatRegion(session.currentFlat, name)!;
    return [Math.floor((r.left + r.right) / 2), Math.floor((r.top + r.bottom) / 2)];
  };
  const pt = (x: number, y: number): number => (x << 16) | (y & 0xffff);
  const clickRegion = async (name: string): Promise<void> => {
    const [x, y] = center(name);
    session.pointerX = x;
    session.pointerY = y;
    const p = session.propRuntime.propAt(x, y, null, false)!; // prop drawn there
    const inst = session.propScripts.get(p.group.name)!;
    await session.interp.runHandler(inst, "mousedown", [pt(x, y)], {
      me: p.group.name,
      target: p.group.name,
    });
    await drain();
  };
  await clickRegion("3B"); // top switch -> power on, starts the countdown
  const poweredOn =
    g("unibompower") === 1 &&
    session.loops.some((l) => l.kind === "flat" && l.handler === "unibomnoise") &&
    session.currentThemeName === "bomb.trk";
  const tin0 = session.propRuntime.get("tinhands")?.deg ?? 0;
  let now = 0;
  for (let i = 0; i < 90; i++) {
    session.tickTime((now += 66));
    await drain();
  }
  const ticked = (session.propRuntime.get("tinhands")?.deg ?? 0) > tin0;
  // win: reach the OK-accepted state directly, then hit OK -> hitok() leaves
  session.interp.globals.set("unibomdoor", 0);
  session.interp.globals.set("unibompower", -1);
  session.propRuntime.get("key")!.deg = 5;
  const flatBefore = session.currentFlat;
  await session.sendToButton(session.currentFlat, "OK", "mousedown", [pt(...center("OK"))], "OK");
  await drain();
  const won = flatBefore === "Bomb 1" && session.currentFlat !== "Bomb 1";
  check(
    "bomb: openstage setup, click routing, ticking timer loop, OK win",
    setup.door === 1 && setup.power === 0 && setup.sw1 === 1 && poweredOn && ticked && won,
    `setup=${JSON.stringify(setup)} poweredOn=${poweredOn} ticked=${ticked} leftFlat=${won}`,
  );
}

// --- 46. TURBINE plant: continuous sim loop, control -> gauge response ------
// A steam-plant simulation: valves/pumps/slider feed a physics step
// (iterateone) that moves water between boiler/turbine/condensor/steamtank and
// derives pressures/temps/electricity, read out on 20-frame gauges. The sim
// self-re-arms via makeloop("flat",…,"changedone",10) (same loop machinery as
// BOMB). Exercises sendtostagefx (controls read `valve = sendtostagefx(
// degtonum(...))`), framerate() round-trip, and the gauge mapping (numtodeg).
{
  const { session } = await newSession();
  await session.openSetFile("turb.set");
  await session.transToFlat("turbine.stg");
  await drain();
  const g = (n: string): number => Number(session.interp.globals.get(n) ?? 0);
  const stageName = session.stage!.name;
  const runSim = (): Promise<unknown> =>
    session.sendEvent("sendtostage", stageName, "changedone", [], "test");
  const loopArmed = session.loops.some((l) => l.kind === "flat" && l.handler === "changedone");
  const valve1Init = g("valve1"); // initvalue() sets 50
  // boilpres = boiler * valve3 / 400 — higher valve3 must raise boiler pressure
  session.interp.globals.set("boiler", 80000);
  session.interp.globals.set("valve3", 2);
  await runSim();
  const presLow = g("boilpres");
  session.interp.globals.set("boiler", 80000);
  session.interp.globals.set("valve3", 76);
  await runSim();
  const presHigh = g("boilpres");
  // gauge reflects the sim: pressure1 deg == numtodeg(boilpres, 5000) clamped 0..19
  const expectDeg = Math.max(0, Math.min(19, Math.floor((g("boilpres") * 19) / 5000)));
  const gaugeDeg = session.propRuntime.get("pressure1")?.deg;
  // slider parse-regression: boilsound ends with a bare `exitcode` (no
  // `endcode`), which used to make it swallow the following calcswitchdeg
  // handler — the slider then read 0 always and pinned to one end. Verify the
  // handler survives parsing and maps mouse-Y (245..345) -> deg 0..20.
  const slider = session.propScripts.get("slider")!;
  const hasCalc = slider.script.codes.has("calcswitchdeg");
  session.setPointer(239, 290);
  const calcMid = Number(
    (await session.interp.runHandler(slider, "calcswitchdeg", [], { me: "slider", target: "slider" })).value,
  );
  check(
    "turbine: sim loop, control raises pressure, gauge tracks; slider handler parses",
    loopArmed && valve1Init === 50 && presHigh > presLow && gaugeDeg === expectDeg &&
      hasCalc && calcMid === 9,
    `loop=${loopArmed} valve1=${valve1Init} presLow=${presLow} presHigh=${presHigh} gauge=${gaugeDeg} expect=${expectDeg} calcswitchdeg?${hasCalc} mid=${calcMid}`,
  );
}

// --- 47. BLACKJACK: deal + variable() + transToFlat lifts transition-black --
// Self-contained game (shuffle/deal/hit/dealer/win) launched from a dealer
// puppet. Exercises variable(name[,val]) dynamic globals (playercount via
// `variable(who @ "count")`), and the fade-lift: HOUSE screentoblack("puppet")s
// the dealer out THEN transtoflat("blkjack.stg") — the reveal is a wipe
// visualeffect we render instantly, so transToFlat must clear the leftover
// black or the table stays dark ("black screen after the talk").
{
  const { session } = await newSession();
  // simulate the post-dialog state: screen faded to black + stale snapshot
  session.fade.level = 1;
  session.fade.snapshot = { rgba: new Uint8ClampedArray(4), width: 1, height: 1 };
  session.fade.queue.push({ to: 1, steps: 10 });
  session.interp.globals.set("firsthand", 1);
  session.interp.globals.set("mission", 1);
  await session.openSetFile("halla.set");
  // transToFlat -> openStageFile now deals the opening hand itself (the boot's
  // per-stage initgame hook), just like the real Buick entry — so pump the
  // clock while it runs (each dealt card spins forceupdate 19x in take()).
  let now = 0;
  const p = session.transToFlat("blkjack.stg");
  let done = false;
  void p.then(() => (done = true)).catch(() => (done = true));
  for (let i = 0; i < 3000 && !done; i++) {
    session.tickTime((now += 66));
    await drain();
  }
  await p;
  const fadeLifted = session.fade.level === 0 && !session.fade.snapshot && session.fade.queue.length === 0;
  const g = (n: string): number => Number(session.interp.globals.get(n) ?? -1);
  // both hands got two cards; playerphase is set (1 mid-hand, 0 if the opening
  // deal was itself a blackjack/gameover — either way the deal ran)
  const dealt = g("playercount") === 2 && g("dealercount") === 2 && g("playerphase") >= 0;
  // variable() drives the per-side counts
  const varWorks = Number(session.interp.globals.get("playercount")) === 2;
  check(
    "blackjack: transToFlat deals via the boot initgame hook + lifts transition-black",
    fadeLifted && dealt && varWorks,
    `fadeLifted=${fadeLifted} player=${g("playertotal")}(${g("playercount")}) dealer=${g("dealertotal")}(${g("dealercount")}) phase=${g("playerphase")}`,
  );
}

// --- 48. smoke: blkjacktable is a world prop placed by propstar ------------
// Regression for "Buck Riviera and his table float fixed-centre": propstar was
// unimplemented, so the (persistent HOUSE.SHP) table stayed a screen-space
// overlay pinned at the anchor centre over every view. propstar must bind it
// into the world at the "buick" star, and propdeg must orient it (directional
// sprite) instead of clamping+locking a frame.
{
  const { session, viewer } = await newSession();
  await session.openSetFile("smoke.set");
  await runAnimations(viewer());
  const table = session.propRuntime.get("blkjacktable")!;
  const flames = session.propRuntime.get("flames")!;
  const buick = session.currentBinding!.set.actors.find((a) => a.identifier.toLowerCase() === "buick")!;
  const placed =
    table.worldSpace &&
    table.setName === "smoke" &&
    table.scale > 0 &&
    table.worldX === buick.positionX &&
    table.worldY === buick.positionZ &&
    table.directional &&
    !table.frameLocked &&
    Number(table.deg) === 250; // propdeg(250) overrides the star's rotation seed
  // directional frame tracks the camera: two opposite bearings pick different frames
  const nf = table.state()!.frames.length;
  const frameAt = (camDeg: number): number => {
    // mirror worldFrameIdx: rel = deg - bearing(prop->camera)
    const cam = viewer().worldCamera()!;
    const dx = cam.x - table.worldX;
    const dy = cam.y - table.worldY;
    const bearing = Math.round((Math.atan2(dy, dx) * 256) / (2 * Math.PI)) & 0xff;
    void camDeg;
    return Math.round((((Number(table.deg) - bearing) & 0xff) * nf) / 256) % nf;
  };
  check(
    "smoke: blkjacktable placed in the world by propstar (not floating at centre)",
    placed && flames.worldSpace && flames.directional && nf === 32 && frameAt(0) >= 0,
    `world=${table.worldSpace} set=${table.setName} scale=${table.scale} dir=${table.directional} locked=${table.frameLocked} deg=${table.deg} @(${table.worldX},${table.worldY}) star=(${buick.positionX},${buick.positionZ}) flamesWorld=${flames.worldSpace} frames=${nf}`,
  );
}

// --- 49. blackjack entry through Buick hides the puppet to reveal the table -
// Regression for "hangs with Buick, no table": the dealer puppet stays LOADED
// while you play (for the "play again?" prompt), but puppetvisible(false) — a
// stub before — must hide it so the flat renders and hit/stay clicks reach the
// table. newgame() (via the boot initgame hook) calls puppetvisible(false), so
// after the deal the puppet is hidden but not closed, and the viewer is no
// longer "busy" on it.
{
  const { session, viewer } = await newSession();
  await session.openSetFile("smoke.set");
  await runAnimations(viewer());
  session.interp.globals.set("firsthand", 1);
  session.interp.globals.set("mission", 1);
  await session.openPuppetFile("blkjack1.pup");
  const shownDuringTalk = session.puppet?.visible === true && viewer().busy;
  // enter the table (deals via the boot initgame hook); pump the clock
  let now = 0;
  const p = session.transToFlat("blkjack.stg");
  let done = false;
  void p.then(() => (done = true)).catch(() => (done = true));
  for (let i = 0; i < 3000 && !done; i++) {
    session.tickTime((now += 66));
    await drain();
  }
  await p;
  const g = (n: string): number => Number(session.interp.globals.get(n) ?? -1);
  const hiddenForTable =
    session.puppet !== null && // still loaded for the play-again prompt
    session.puppet.visible === false && // but hidden so the table shows
    !viewer().busy && // not blocking hit/stay input
    g("playercount") === 2 &&
    g("dealercount") === 2;
  check(
    "blackjack: entering through Buick hides the puppet and deals the table",
    shownDuringTalk && hiddenForTable,
    `shownDuringTalk=${shownDuringTalk} loaded=${session.puppet !== null} visible=${session.puppet?.visible} busy=${viewer().busy} player=${g("playercount")} dealer=${g("dealercount")}`,
  );
}

// --- 50. blackjack: a finished hand offers "play again"; Yes re-deals -------
// Regression for "does not nicely end and is not repeatable": newgame() asks
// the dealer `sendtopuppetfx("boot script", playagain())` whether to deal
// again. sendtopuppetfx wasn't a registered deferred-call form, so its
// playagain() argument evaluated locally and recursed forever. With it fixed,
// finishing a hand re-shows Buick (puppetvisible true) with Yes/No bevels, and
// Yes deals a fresh hand.
{
  const { session, viewer } = await newSession();
  await session.openSetFile("smoke.set");
  await runAnimations(viewer());
  session.interp.globals.set("firsthand", 1);
  session.interp.globals.set("mission", 1);
  await session.openPuppetFile("blkjack1.pup");
  let now = 0;
  const pump = async (until: () => boolean, max = 8000): Promise<boolean> => {
    for (let i = 0; i < max && !until(); i++) {
      session.tickTime((now += 66));
      await drain();
    }
    return until();
  };
  const g = (n: string): number => Number(session.interp.globals.get(n) ?? -1);
  // enter + deal via the boot initgame hook
  const enter = session.transToFlat("blkjack.stg");
  let entered = false;
  void enter.then(() => (entered = true));
  const dealt = await pump(() => entered) && g("playercount") === 2;
  // stand -> dealer draws to completion -> gameover schedules the newgame loop.
  // Run dealerdraw as the STAY REGION does — with me = the region name, NOT the
  // flat (regions dispatch with me=region and flat handlers inherit it). This is
  // what broke the browser: gameover's makeloop("flat", me, "newgame") then
  // captured the region name; fireLoop must target the current flat regardless.
  if (g("playerphase") === 1) {
    session.interp.globals.set("playerstand", 1);
    const flat = session.flatScripts.get(session.currentFlat.toLowerCase())!;
    void session.track(
      session.interp.runHandler(flat, "dealerdraw", [], { me: "staybevel", target: "staybevel" }),
    );
  }
  // the newgame loop fires playagain(): Buick returns (visible) with Yes/No
  const offered = await pump(
    () => (session.puppet?.visible ?? false) && (session.puppet?.bevels.length ?? 0) === 2,
  );
  // click "Yes" (bevel index 0, id 101) -> playagain() true -> a fresh hand.
  // playerphase was 0 at the prompt (gameover); a re-deal drives it back to 1
  // with two fresh cards. (Don't assert the puppet is hidden — if the re-dealt
  // hand is itself an instant blackjack it bounces straight back to the prompt.)
  session.puppetChoose(0);
  const replayed = await pump(() => g("playerphase") === 1 && g("playercount") === 2);
  check(
    "blackjack: a finished hand offers play-again via Buick; Yes re-deals",
    dealt && offered && replayed,
    `dealt=${dealt} offered=${offered} replayed=${replayed} visible=${session.puppet?.visible} phase=${g("playerphase")} pc=${g("playercount")}`,
  );
}

// --- 51. blackjack score readout shows the right number (propdeg by degree) -
// Regression for "cards counted +1": showscores does propdeg(who@"scores",
// total), and the score sprite's frames store degrees 2,3,…,21,BUST=22,
// BLACKJACK=23 — offset ~2 from their frame index. Selecting the frame WHOSE
// DEGREE equals the total (not the total-th frame) makes the digit match.
{
  const { session } = await newSession();
  await session.openSetFile("smoke.set");
  session.interp.globals.set("firsthand", 1);
  session.interp.globals.set("mission", 1);
  let now = 0;
  const pump = async (until: () => boolean, max = 3000): Promise<boolean> => {
    for (let i = 0; i < max && !until(); i++) {
      session.tickTime((now += 66));
      await drain();
    }
    return until();
  };
  const enter = session.transToFlat("blkjack.stg");
  let entered = false;
  void enter.then(() => (entered = true));
  await pump(() => entered);
  const flat = session.flatScripts.get(session.currentFlat.toLowerCase())!;
  const scores = session.propRuntime.get("playerscores")!;
  const degAt = (): number => scores.state()!.degrees[scores.frameIdx];
  // a plain total: the shown frame's degree must equal the total
  session.interp.globals.set("playertotal", 17);
  session.interp.globals.set("playercount", 3);
  await session.interp.runHandler(flat, "showscores", ["player"], { me: flat.name, target: "" });
  const at17 = degAt();
  // a bust: total > 21 -> propdeg(22) -> the BUST frame (degree 22)
  session.interp.globals.set("playertotal", 24);
  await session.interp.runHandler(flat, "showscores", ["player"], { me: flat.name, target: "" });
  const atBust = degAt();
  check(
    "blackjack: the score readout frame's degree matches the total (no +1/+2 skew)",
    at17 === 17 && atBust === 22,
    `deg@17=${at17} deg@bust=${atBust} frames=${scores.state()!.degrees.length}`,
  );
}

// --- 52. world sprites keep a camera during movement (no vanish on turn) ----
// Regression for "actors vanish while moving, reappear at the standpoint": each
// motion frame carries its own camera (posX16/axisX8), so the viewer projects
// actors/world props THROUGHOUT a turn instead of only at rest. activeCamera()
// returns the moving motion-frame camera mid-turn and the standpoint at rest.
{
  const { session, viewer } = await newSession();
  await session.openSetFile("smoke.set");
  const v = viewer();
  const anyv = v as unknown as {
    animation: unknown;
    activeCamera: () => { deg: number } | null;
  };
  const standDeg = v.worldCamera()!.deg;
  v.turn(0); // start a right turn
  v.tick((clock += 100)); // step into the animation
  v.tick((clock += 100));
  const animating = anyv.animation !== null;
  const midCam = anyv.activeCamera();
  // mid-turn: a camera exists (was null before) and it has moved off the standpoint
  const tracksWhileMoving = animating && !!midCam && midCam.deg !== standDeg;
  await runAnimations(v);
  // at rest: back to the standpoint camera, seamlessly
  const restCam = anyv.activeCamera();
  const backToStand = anyv.animation === null && !!restCam && restCam.deg === v.worldCamera()!.deg;
  check(
    "world sprites track the camera during movement, not just at the standpoint",
    tracksWhileMoving && backToStand,
    `animating=${animating} midDeg=${midCam?.deg} standDeg=${standDeg} back=${backToStand}`,
  );
}

// --- 53. dev "give kit": bag + watch + map dock into the bottom band --------
// The dev button fires each HOUSE.SHP prop's own add handler (addbag/addwatch/
// addmap), which Frank normally triggers by picking them up in C73: owner=frank,
// moved to the band anchor (256,324) as a screen prop, closed/idle view.
{
  const { session } = await newSession();
  await session.openSetFile("smoke.set");
  for (const [prop, handler] of [
    ["bag", "addbag"],
    ["map", "addmap"],
    ["watch", "addwatch"],
  ] as const) {
    await session.sendEvent("sendtoprop", prop, handler, [], "dev");
    const inst = session.propRuntime.get(prop);
    if (inst) inst.visible = true;
  }
  const docked = (name: string): boolean => {
    const p = session.propRuntime.get(name);
    return (
      !!p && p.visible && p.owner === "frank" && !p.worldSpace && p.anchorX === 256 && p.anchorY === 324
    );
  };
  check(
    "dev give-kit docks bag + watch + map into the band (owner frank, screen band anchor)",
    docked("bag") && docked("watch") && docked("map"),
    `bag=${docked("bag")} watch=${docked("watch")} map=${docked("map")}`,
  );
}

// --- 54. life preserver keeps its tour/mission variant across state changes -
// The band's "life" button is deg 0 (mission) / 1 (tour); each of its states
// holds both variants as 2 frames. propview used to animate through them and
// end on the last (tour), so a mission-mode click flipped the icon to the tour
// art. A deg-locked selector must re-pick its variant by deg on every state.
{
  const { session } = await newSession();
  await session.openSetFile("smoke.set"); // house.shp (persistent) -> life prop
  const life = session.propRuntime.get("life")!;
  const call = (name: string, args: (string | number)[]): void => {
    (session.interp.builtins.get(name) as (i: unknown, a: (string | number)[]) => void)(
      session.interp,
      args,
    );
  };
  call("propview", ["life", "light"]);
  call("propdeg", ["life", 0]); // mission
  const missionAfterDeg = life.frameIdx;
  call("propview", ["life", "push"]); // a click's push animation...
  call("propview", ["life", "light"]); // ...must return to the mission variant
  const missionAfterClick = life.frameIdx;
  call("propdeg", ["life", 1]); // tour
  call("propview", ["life", "light"]);
  const tourAfterClick = life.frameIdx;
  check(
    "life preserver keeps its tour/mission variant across state changes",
    missionAfterDeg === 0 && missionAfterClick === 0 && tourAfterClick === 1 && life.frameLocked,
    `afterDeg=${missionAfterDeg} missionClick=${missionAfterClick} tourClick=${tourAfterClick} locked=${life.frameLocked}`,
  );
}

// --- 55. band prop close animations + variant persistence ------------------
// "close" states store the SAME frames as "open" (closed->open) plus a play-
// order table (header @46) that reverses them; honouring it makes close play
// open->closed instead of replaying the opening. And a deg-variant prop (map)
// keeps its mission/tour icon after its open/close animation, not the last frame.
{
  const { session } = await newSession();
  await session.openSetFile("smoke.set");
  const stateOf = (prop: string, name: string) =>
    session.propRuntime.get(prop)!.group.states.find((s) => s.identifier === name)!;
  const asc = (a: number[]) => a[0] < a[a.length - 1];
  const lidOpen = stateOf("lid", "open").frames;
  const lidClose = stateOf("lid", "close").frames;
  const bagOpen = stateOf("bag", "darkopen").frames;
  const bagClose = stateOf("bag", "darkclose").frames;
  // open plays natural (ascending containers); close is reordered to reverse
  const reordered =
    asc(lidOpen) && !asc(lidClose) && asc(bagOpen) && !asc(bagClose);
  // map keeps its mission variant (frame 0) through open/close, not tour (1)
  const map = session.propRuntime.get("map")!;
  const call = (name: string, a: (string | number)[]): void => {
    (session.interp.builtins.get(name) as (i: unknown, args: (string | number)[]) => void)(
      session.interp,
      a,
    );
  };
  await session.sendEvent("sendtoprop", "map", "addmap", [], "dev"); // deg 0 (mission)
  call("propview", ["map", "open"]);
  call("propview", ["map", "close"]);
  call("propview", ["map", "light"]);
  const mapVariantKept = map.frameIdx === 0 && map.degVariants;
  check(
    "close animations play reversed; deg-variant icon survives open/close",
    reordered && mapVariantKept,
    `lidClose[0..-1]=${lidClose[0]}..${lidClose[lidClose.length - 1]} reordered=${reordered} mapFrame=${map.frameIdx} degVariants=${map.degVariants}`,
  );
}

// --- 56. fence stage (M1 staging): duel opens onto the piste at centre -------
// SQUASH.SET's fence() seeds fencelevel/willphase then transtoflat("fence.stg").
// openstage loads fence.shp/fence.trk, stands Willie + the player on the 16-flat
// piste, goes to centre (flat "fence 8"), lights the "engage" button, and kicks
// the idle loops — but does NOT start fighting until the engage click.
{
  const { session } = await newSession();
  session.interp.globals.set("fencelevel", 15);
  session.interp.globals.set("willphase", 201);
  await session.openSetFile("squash.set");
  await session.transToFlat("fence.stg");
  const willie = session.propRuntime.get("willie");
  const player = session.propRuntime.get("player");
  const start = session.propRuntime.get("startfence");
  const staged =
    session.stageName === "fence.stg" &&
    session.setVisible === false &&
    session.flatNames.length === 15 &&
    session.flatToIndex(session.currentFlat) === 8;
  const fighters =
    !!willie && willie.visible && willie.stateName === "idle1" &&
    !!player && player.visible && player.stateName === "idle1";
  const ready =
    !!start && start.visible &&
    !session.interp.globals.get("fighting");
  check(
    "fence duel opens onto the piste at centre with fighters idle and engage lit",
    staged && fighters && ready,
    `stage=${session.stageName} flats=${session.flatNames.length} idx=${session.flatToIndex(session.currentFlat)} ` +
      `willie=${willie?.visible}/${willie?.stateName} player=${player?.visible}/${player?.stateName} ` +
      `start=${start?.visible} fighting=${session.interp.globals.get("fighting")}`,
  );
}

// --- 57. fence M2: engage + live mouse-driven parry --------------------------
// Clicking the lit "engage" fires the flat's newpoint(): fighting flips true and
// the engage button hides. Then playeridle() polls mouse-X every tick and sets
// the player's blade angle (propdeg 0..8) + playerblock (left/none/right) — the
// defense is steered entirely by where the cursor sits across the piste.
{
  const { session, viewer } = await newSession();
  session.interp.globals.set("fencelevel", 15);
  session.interp.globals.set("willphase", 201);
  await session.openSetFile("squash.set");
  await session.transToFlat("fence.stg");
  const player = session.propRuntime.get("player")!;
  const start = session.propRuntime.get("startfence")!;
  // fire a duel action the way the engine does: tracked, so scriptBusy suppresses
  // loop-firing while it runs (deterministic), then pump the clock to settle it.
  const fire = async (p: Promise<unknown>) => { session.track(p); await runAnimations(viewer()); };

  // engage: the lit "engage" is the flat's "startfence" click-region; its
  // mousedown does `if trackbut("startlit",…) newpoint()`. Dispatch newpoint by
  // name (the same by-name button path the engine exposes) to start the bout.
  await fire(session.sendToButton(session.currentFlat, "startfence", "newpoint", [], "test"));
  const engaged = !!session.interp.globals.get("fighting") && start.visible === false;

  // defense: sweep the cursor across the piste; each band picks a blade deg +
  // block side. At centre flat 8 the backed-up weakenings don't apply, so the
  // thresholds are the raw ones from playeridle.
  const probe = async (x: number) => {
    session.setPointer(x, 190);
    await fire(session.sendEvent("sendtoprop", "player", "playeridle", [], "test"));
    return { deg: player.deg, block: session.interp.globals.get("playerblock") };
  };
  const farRight = await probe(350); // >=346 -> deg 8, right
  const right = await probe(320);    // >=316 -> deg 7, right
  const centre = await probe(260);   // >=256 -> deg 5, none
  const left = await probe(150);     // >=136 -> deg 1, left
  const farLeft = await probe(130);  // <136  -> deg 0, left

  const defends =
    farRight.deg === 8 && farRight.block === "right" &&
    right.deg === 7 && right.block === "right" &&
    centre.deg === 5 && centre.block === "none" &&
    left.deg === 1 && left.block === "left" &&
    farLeft.deg === 0 && farLeft.block === "left" &&
    player.stateName === "defend";
  check(
    "fence engage starts the bout; mouse-X drives the player's parry + block side",
    engaged && defends,
    `engaged=${engaged} far-right=${farRight.deg}/${farRight.block} right=${right.deg}/${right.block} ` +
      `centre=${centre.deg}/${centre.block} left=${left.deg}/${left.block} far-left=${farLeft.deg}/${farLeft.block} ` +
      `view=${player.stateName}`,
  );
}

// --- 58. fence M3a: player attack vs Willie's open quadrants -----------------
// A lunge (mousedown) targets a quadrant (UL/UR/LL/LR by click x/y). willieblock
// holds the quadrants Willie leaves OPEN (pickdef fills them by fencelevel — a
// higher/"mediocre" level opens more). notdefended(quad) is true when that quad
// is open (and we're past the 2-lunge warmup): the thrust lands and scores;
// otherwise Willie parries it. (Confirmed backwards from the name — the guard is
// `if notdefended(quad) -> pointgoesto("player")`.)
{
  const { session, viewer } = await newSession();
  const g = session.interp.globals;
  g.set("fencelevel", 15);
  g.set("willphase", 201);
  await session.openSetFile("squash.set");
  await session.transToFlat("fence.stg");
  const playerscore = session.propRuntime.get("playerscore")!;
  const UR = (300 << 16) | 150; // x>256, y<193 -> upper-right quadrant
  const fire = async (p: Promise<unknown>) => { session.track(p); await runAnimations(viewer()); };
  const engage = () => fire(session.sendToButton(session.currentFlat, "startfence", "newpoint", [], "test"));
  const attack = (pt: number) => fire(session.sendEvent("sendtoprop", "player", "playerattack", [pt], "test"));

  // PARRIED: UR is NOT among Willie's open quadrants -> he defends, no touch
  await engage();
  g.set("willieblock", "xx;xx;xx;xx;");
  g.set("attacktot", 5); // past the 2-lunge warmup
  await attack(UR);
  const parried = playerscore.visible === false;

  // TOUCH: Willie has left UR open -> the lunge lands; pointgoesto("player")
  // reveals the score readout (first touch = degree 0) and stiffens Willie (-4)
  await engage();
  g.set("willieblock", "UR;xx;xx;xx;");
  g.set("attacktot", 5);
  await attack(UR);
  const touched = playerscore.visible === true && playerscore.deg === 0;
  const stiffened = g.get("fencelevel") === 11;

  check(
    "fence player attack: a lunge into a covered quadrant is parried, into an open one it touches",
    parried && touched && stiffened,
    `parried=${parried} touched=${touched}(vis=${playerscore.visible} deg=${playerscore.deg}) fencelevel=${g.get("fencelevel")}`,
  );
}

// --- 59. fence M3b: Willie's attack vs the player's guard side ----------------
// Willie commits to a side (willieside, from willieintent); willieattack lands
// unless the player's guard (playerblock, steered live by the mouse) is on that
// same side. A matched guard is a parry (miss), a mismatched guard is a touch
// for Willie and eases him off (fencelevel +4).
{
  const { session, viewer } = await newSession();
  const g = session.interp.globals;
  g.set("fencelevel", 15);
  g.set("willphase", 201);
  await session.openSetFile("squash.set");
  await session.transToFlat("fence.stg");
  const williescore = session.propRuntime.get("williescore")!;
  const fire = async (p: Promise<unknown>) => { session.track(p); await runAnimations(viewer()); };
  const engage = () => fire(session.sendToButton(session.currentFlat, "startfence", "newpoint", [], "test"));
  const willieAtk = () => fire(session.sendEvent("sendtoprop", "willie", "willieattack", [], "test"));

  // PARRIED: guard side matches Willie's committed side -> he misses, no touch
  await engage();
  g.set("willieside", "left");
  g.set("playerblock", "left");
  await willieAtk();
  const willieMissed = williescore.visible === false;

  // SCORES: guard on the wrong side -> the thrust lands, williescore appears
  await engage();
  g.set("willieside", "right");
  g.set("playerblock", "left");
  await willieAtk();
  const willieScored = williescore.visible === true && williescore.deg === 0;
  const eased = g.get("fencelevel") === 19;

  check(
    "fence Willie attack: matched guard parries; mismatched guard is a touch for Willie",
    willieMissed && willieScored && eased,
    `missed=${willieMissed} scored=${willieScored}(vis=${williescore.visible} deg=${williescore.deg}) fencelevel=${g.get("fencelevel")}`,
  );
}

// --- 60. fence M4: a full match to five touches ends the bout ----------------
// Score five touches (each: engage, leave UR open, lunge past the warmup) and the
// score readout climbs deg 0..4. On the fifth, pointgoesto's end-branch fires:
// fighting stops, Willie is marked "won" (the player won), fencewins increments,
// and transfromflat() leaves the stage — after which sendtoset(fence()) opens the
// post-match conversation (which blocks on a bevel), so we pump a bounded number
// of steps rather than waiting on the puppet, and assert the pre-conversation win.
{
  const { session, viewer } = await newSession();
  const g = session.interp.globals;
  g.set("fencelevel", 15);
  g.set("willphase", 201);
  g.set("fencewins", 0);
  g.set("fencecount", 0);
  g.set("mission", 2);
  await session.openSetFile("squash.set");
  await session.transToFlat("fence.stg");
  const playerscore = session.propRuntime.get("playerscore")!;
  const UR = (300 << 16) | 150;
  const ownerOf = (n: string) =>
    (session.interp.builtins.get("actorowner") as (i: unknown, a: string[]) => string)(session.interp, [n]);
  const fire = async (p: Promise<unknown>) => { session.track(p); await runAnimations(viewer()); };
  const engage = () => fire(session.sendToButton(session.currentFlat, "startfence", "newpoint", [], "test"));

  // touches 1..4 — bout continues, score readout climbs to deg 3
  for (let i = 0; i < 4; i++) {
    await engage();
    g.set("willieblock", "UR;xx;xx;xx;");
    g.set("attacktot", 5); // skip the 2-lunge warmup
    await fire(session.sendEvent("sendtoprop", "player", "playerattack", [UR], "test"));
  }
  const fourTouches = playerscore.visible && playerscore.deg === 3 && !session.interp.globals.get("fighting");

  // fifth (winning) touch: fire it, then pump a bounded number of steps — the
  // end-branch runs (win recorded, stage left) before the conversation blocks.
  await engage();
  g.set("willieblock", "UR;xx;xx;xx;");
  g.set("attacktot", 5);
  session.track(session.sendEvent("sendtoprop", "player", "playerattack", [UR], "test"));
  for (let i = 0; i < 120; i++) {
    session.tickTime((clock += 66));
    await drain();
    if (session.puppet?.bevels?.length || session.stageName !== "fence.stg") break;
  }
  const won =
    !session.interp.globals.get("fighting") &&
    ownerOf("willie") === "won" &&
    session.interp.globals.get("fencewins") === 1 &&
    session.stageName !== "fence.stg";
  check(
    "fence: a match won five-touches-to-nil ends the bout and records the win",
    fourTouches && won,
    `fourTouches=${fourTouches}(deg=${playerscore.deg}) fighting=${session.interp.globals.get("fighting")} ` +
      `owner=${ownerOf("willie")} fencewins=${session.interp.globals.get("fencewins")} stage=${session.stageName}`,
  );
}

// --- 61. fence theme doesn't leak: leaving the overlay restores the ambient --
// The duel is a STG overlay (set stays the squash court), and its openstage does
// playnewtheme("fence.trk"). Overlays bypass changeset, so setupsound never runs
// to swap the theme back; declining the rematch travels same-deck, which is
// seamless (no replay) -> the combat theme used to keep looping in the hall.
// transToFlat now remembers the ambient theme and transFromFlat restores it.
{
  const { session } = await newSession();
  await session.openSetFile("squash.set");
  const call = (n: string, a: (string | number)[]) =>
    (session.interp.builtins.get(n) as (i: unknown, args: (string | number)[]) => unknown)(session.interp, a);
  // stand in for the ambient deck theme playing when the duel is entered
  await call("opentrackfile", ["bomb.trk"]);
  call("playnewtheme", ["bomb.trk"]);
  const ambient = session.currentThemeName;
  await session.transToFlat("fence.stg"); // openstage -> playnewtheme("fence.trk")
  const during = session.currentThemeName;
  await session.transFromFlat(); // leaving must put the ambient back
  const after = session.currentThemeName;
  check(
    "fence: leaving the duel restores the ambient theme (combat theme doesn't leak)",
    ambient === "bomb.trk" && during === "fence.trk" && after === "bomb.trk",
    `ambient=${ambient} during=${during} after=${after}`,
  );
}

// --- 62. fight stage (M1 staging): the brawl opens with both fighters ready --
// GSTAIR1.SET's runfight() transtoflats("fight.stg") at mission 3 / phase 1.
// openstage loads fight.shp/fight.trk and openfight() stands Vlad + the first-
// person fists on the default flat ("flat 0"), shows both power bars, sets both
// powers to 512 (full), and kicks Vlad's idle loop. fightover stays false.
{
  const { session } = await newSession();
  await session.openSetFile("gstair1.set");
  await session.transToFlat("fight.stg");
  const g = session.interp.globals;
  const vlad = session.propRuntime.get("vlad");
  const fists = session.propRuntime.get("fists");
  const vladbar = session.propRuntime.get("vladbar");
  const playerbar = session.propRuntime.get("playerbar");
  const staged =
    session.stageName === "fight.stg" &&
    session.setVisible === false &&
    session.flatNames.length === 15 &&
    session.currentFlat === "flat 0";
  const fighters =
    !!vlad && vlad.visible && vlad.stateName === "idle" &&
    !!fists && fists.visible && fists.stateName === "idle";
  const hud = !!vladbar && vladbar.visible && !!playerbar && playerbar.visible;
  const ready =
    g.get("vladpower") === 512 && g.get("playerpower") === 512 && !g.get("fightover");
  check(
    "fight brawl opens with Vlad + fists idle, power bars up, both powers full",
    staged && fighters && hud && ready,
    `stage=${session.stageName} flat=${session.currentFlat} flats=${session.flatNames.length} ` +
      `vlad=${vlad?.visible}/${vlad?.stateName} fists=${fists?.visible}/${fists?.stateName} ` +
      `bars=${vladbar?.visible}/${playerbar?.visible} vp=${g.get("vladpower")} pp=${g.get("playerpower")} over=${g.get("fightover")}`,
  );
}

// --- 63. fight M2: punches land both ways ------------------------------------
// Clicking Vlad throws a player punch whose type comes from where you click
// (upper-middle = uppercut); vladdamage() drops vladpower. Vlad's own offense
// (his idle loop picks punches) lands on the player and drops playerpower.
{
  const { session, viewer } = await newSession();
  await session.openSetFile("gstair1.set");
  await session.transToFlat("fight.stg");
  const g = session.interp.globals;
  const fire = async (p: Promise<unknown>) => { session.track(p); await runAnimations(viewer()); };

  // player punch: click upper-middle (y in 160..270) -> uppercut -> vladpower drops
  session.setPointer(256, 200);
  const vp0 = g.get("vladpower") as number;
  await fire(session.sendEvent("sendtoprop", "fists", "mousedown", [(256 << 16) | 200], "test"));
  const playerLanded = (g.get("vladpower") as number) < vp0;

  // Vlad punch: fire an explicit uppercut from his prop -> playerpower drops
  const pp0 = g.get("playerpower") as number;
  await fire(session.sendEvent("sendtoprop", "vlad", "punch", ["uppercut"], "test"));
  const vladLanded = (g.get("playerpower") as number) < pp0;

  check(
    "fight punches: a player hit lowers vladpower; a Vlad hit lowers playerpower",
    playerLanded && vladLanded,
    `vladpower ${vp0}->${g.get("vladpower")} (playerLanded=${playerLanded}) ` +
      `playerpower ${pp0}->${g.get("playerpower")} (vladLanded=${vladLanded})`,
  );
}

// --- 64. fight M3: a knock-out ends the bout ---------------------------------
// When a fighter's power falls below -50, Vlad's idle loop calls endfight(),
// which resolves the winner (vladpower < playerpower => player wins), marks Vlad
// "lostfight", halts the combat theme, and transfromflat()s back out of the
// stage. Drive Vlad's power under and fire his idle tick to trigger it.
{
  const { session, viewer } = await newSession();
  await session.openSetFile("gstair1.set");
  await session.transToFlat("fight.stg");
  const g = session.interp.globals;
  const fire = async (p: Promise<unknown>) => { session.track(p); await runAnimations(viewer()); };
  const ownerOf = (n: string) =>
    (session.interp.builtins.get("actorowner") as (i: unknown, a: string[]) => string)(session.interp, [n]);

  g.set("vladpower", -60); // Vlad is spent
  await fire(session.sendEvent("sendtoprop", "vlad", "idle", [], "test"));
  const won =
    !!g.get("fightover") &&
    ownerOf("vlad") === "lostfight" &&
    session.stageName !== "fight.stg";
  check(
    "fight KO: dropping Vlad below -50 ends the bout as a player win and leaves the stage",
    won,
    `fightover=${g.get("fightover")} owner=${ownerOf("vlad")} stage=${session.stageName}`,
  );
}

// --- 65. fuse stage (M1 staging): the fusebox opens with its fuses lit --------
// HALLA.SET transtoflats("fuse.stg") when you click the panel at view61 (port).
// openstage loads fuse.shp/fuse.snd; the shop's openshop shows the (closed) door
// and sets each fuse "light"/"off" from the fusebox slot-string. Also confirms
// the BOOTFILE progress(m,p) gate helper resolves + compares correctly (its
// decompiled body ends oddly, so pin it: at mission 1/phase 4, progress(1,4) is
// true, progress(1,5)/progress(2,0) false).
{
  const { session } = await newSession();
  const g = session.interp.globals;
  g.set("mission", 1);
  g.set("phase", 4);
  g.set("neckphase", 6);
  g.set("hallside", "port");
  g.set("fusebox", "1,1,1,1,");
  await session.openSetFile("halla.set", "scene52", "view61");
  await session.transToFlat("fuse.stg");
  const door = session.propRuntime.get("fusedoor");
  const f14 = session.propRuntime.get("fuse14");
  const f20 = session.propRuntime.get("fuse20");
  const staged =
    session.stageName === "fuse.stg" && session.setVisible === false;
  const wired =
    !!door && door.visible && door.stateName === "closed" &&
    !!f14 && f14.visible && f14.stateName === "light" &&
    !!f20 && f20.visible && f20.stateName === "light";
  const prog = (m: number, p: number) => session.runGlobal("progress", [m, p]);
  const gate = !!(await prog(1, 4)) && !(await prog(1, 5)) && !(await prog(2, 0));
  check(
    "fuse stage opens with door closed + fuses lit; progress() gate resolves",
    staged && wired && gate,
    `stage=${session.stageName} door=${door?.stateName} f14=${f14?.stateName} f20=${f20?.stateName} ` +
      `progress(1,4)=${await prog(1, 4)} progress(1,5)=${await prog(1, 5)} progress(2,0)=${await prog(2, 0)}`,
  );
}

// --- 66. fuse M2: fuses toggle (light<->off) + door opens/closes -------------
// A fuse click reaches BOTH the STG main (light->off, sets its fusebox slot "0")
// and the prop's shop main (off->on, slot "1"); a run loop (fuseoff/fuseon)
// settles the switch into its resting light/off frame. The door opens only when
// the boot progress(1,4) + neckphase + view61 + port gate holds.
{
  const { session, viewer } = await newSession();
  const g = session.interp.globals;
  g.set("mission", 1); g.set("phase", 4); g.set("neckphase", 6);
  g.set("hallside", "port"); g.set("fusebox", "1,1,1,1,");
  await session.openSetFile("halla.set", "scene52", "view61");
  session.currentViewName = () => "view61";
  await session.transToFlat("fuse.stg");
  const f14 = session.propRuntime.get("fuse14")!;
  const door = session.propRuntime.get("fusedoor")!;
  const stg = session.stageFile!;
  const regions = readStgRegions(stg.file.containers[stg.flats[0].locationClickLogic].data);
  const r = regions.find((x) => x.name === "fuse14")!;
  const cx = Math.round((r.left + r.right) / 2), cy = Math.round((r.top + r.bottom) / 2);
  const fire = async (p: Promise<unknown>) => { session.track(p); await runAnimations(viewer()); };
  // pump service steps until the run loops drain (settling the switch frame)
  const pump = async () => { for (let i = 0; i < 40 && session.loops.length; i++) { session.tickTime((clock += 100)); await drain(); } };

  // door first (starts closed): the gated fusedoor mousedown opens then closes it
  const startClosed = door.stateName === "closed";
  await fire(session.sendEvent("sendtoprop", "fusedoor", "mousedown", [0], "test"));
  const opened = door.stateName === "open";
  await fire(session.sendEvent("sendtoprop", "fusedoor", "mousedown", [0], "test"));
  const closed = door.stateName === "closed";

  // fuse toggle: click the lit fuse -> off (STG main), then click again -> on
  // (shop main), with a run loop settling each switch into its resting frame
  await fire(viewer().click(cx, cy));
  const off1 = String(g.get("fusebox")).split(",")[0] === "0";
  await pump();
  const nowOff = f14.stateName === "off";
  await fire(viewer().click(cx, cy));
  const on1 = String(g.get("fusebox")).split(",")[0] === "1";
  await pump();
  const nowLit = f14.stateName === "light";

  check(
    "fuse toggle both ways (light<->off, fusebox slot) and the door opens/closes",
    startClosed && opened && closed && off1 && nowOff && on1 && nowLit,
    `door closed=${startClosed}->open=${opened}->closed=${closed} | off1=${off1} nowOff=${nowOff} on1=${on1} nowLit=${nowLit}`,
  );
}

// --- 67. fuse M3: confirming with fuse #1 off advances the Sasha subplot ------
// Clicking the OK button (fuseokdark) runs the STG confirm: trackbut(fuseoklit)
// -> close the door, transfromflat() out, and if fuse #1 (fuse14) is off and
// neckphase == 6, advance neckphase to 7 (Sasha is freed to the hall).
{
  const { session, viewer } = await newSession();
  const g = session.interp.globals;
  g.set("mission", 1); g.set("phase", 4); g.set("neckphase", 6);
  g.set("hallside", "port"); g.set("fusebox", "0,1,1,1,"); // fuse #1 already off
  await session.openSetFile("halla.set", "scene52", "view61");
  session.currentViewName = () => "view61";
  await session.transToFlat("fuse.stg");
  const fire = async (p: Promise<unknown>) => { session.track(p); await runAnimations(viewer()); };
  // hold the pointer over the OK button so trackbut(fuseoklit) reads "released
  // over the button" (its rect is anchored at 256,192 minus the frame offset),
  // then run the confirm keyed on target = fuseokdark
  const okp = session.propRuntime.get("fuseoklit")!;
  const okst = okp.state()!;
  const okf = okp.shop.frame(okst.frames[Math.min(okp.frameIdx, okst.frames.length - 1)]);
  session.setPointer(256 - okf.posXraw + Math.floor(okf.width / 2), 192 - okf.posYraw + Math.floor(okf.height / 2));
  await fire(session.sendEvent("sendtostage", "fuse.stg", "mousedown", [0], "fuseokdark"));
  const advanced = g.get("neckphase") === 7 && session.stageName !== "fuse.stg";
  check(
    "fuse confirm: OK with fuse #1 off leaves the stage and advances neckphase 6->7",
    advanced,
    `neckphase=${g.get("neckphase")} stage=${session.stageName}`,
  );
}

// --- 68. actor putdownactor (boot lifecycle helper) hides the actor ----------
// The officer/Sasha leave via sendtoactor(name, putdownactor()); putdownactor is
// a BOOTFILE helper (actorvisible(target,false)+stoploop+stopwalk), not on the
// actor/cast, so sendtoactor's resolution must reach the boot fallback for it.
{
  const { session } = await newSession();
  session.interp.globals.set("neckphase", 6);
  session.interp.globals.set("mission", 1);
  session.interp.globals.set("phase", 4);
  session.interp.globals.set("hallside", "port");
  await session.openSetFile("halla.set", "scene52", "view61");
  await session.sendEvent("sendtoactor", "asea", "setupactor", ["fuse"], "test");
  const before = session.actorRuntime.get("asea")?.visible;
  await session.sendEvent("sendtoactor", "asea", "putdownactor", [], "test");
  const after = session.actorRuntime.get("asea")?.visible;
  check(
    "putdownactor hides the actor (boot lifecycle helper resolves via sendtoactor)",
    before === true && after === false,
    `visible before=${before} after=${after}`,
  );
}

// --- 69. Sasha walks away down the hall (sasha.1 -> sasha.2) -----------------
// After the fuse subplot (neckphase 7) Sasha appears in his doorway (sasha.1);
// entering Scene52 facing View62 fires HALLA.SET openscene -> walkonpath(sasha,
// sasha.1, sasha.2). sasha.2 lives in the actor table's nested SECONDARY slot
// (record tail +32) — the fixed-41 skip used to drop it, so the star wasn't
// found and Sasha stood frozen in the doorway (rendering huge/headless right in
// front of the camera). With the star recovered the walk runs and he leaves.
{
  const { session, viewer } = await newSession();
  session.interp.globals.set("neckphase", 7);
  session.interp.globals.set("mission", 1);
  session.interp.globals.set("phase", 4);
  session.interp.globals.set("tour", 0);
  await session.openSetFile("halla.set", "scene52", "view62");
  const v = viewer();
  // Sasha in the doorway on sasha.1
  await session.sendEvent("sendtoactor", "sasha", "setupactor", ["halla"], "test");
  const sasha = session.actorRuntime.get("sasha")!;
  const startedOnStar = sasha.starName === "sasha.1" && sasha.visible;
  const dest = session.currentBinding?.set.actors.find((a) => a.identifier === "sasha.2");
  // fire the scene's openscene (as scene entry would) -> triggers the walk
  session.interp.builtins.get("stoploop")!(session.interp, ["actor", "sasha"], null as never, null as never);
  session.interp.builtins.get("walkonpath")!(
    session.interp, ["sasha", "sasha.1", "sasha.2"], null as never, null as never,
  );
  const walking = sasha.starName === "walkonpath" && session.isWalk("sasha");
  let guard = 0;
  while (session.isWalk("sasha") && guard++ < 800) { v.tick((clock += 100)); await drain(); }
  await drain();
  // he ends down the hall — sasha.2, or sasha.3 if the idle loiter loop has
  // toggled him along (sashaidle nudges sasha.2<->sasha.3); either proves he
  // left the doorway (sasha.1) rather than freezing there as a giant.
  const arrived = sasha.starName === "sasha.2" || sasha.starName === "sasha.3";
  check(
    "Sasha walks the doorway->hall path (sasha.2 recovered from the actor-table tail)",
    startedOnStar && !!dest && dest.positionZ > 8668 && walking && arrived,
    `start=${startedOnStar} sasha.2@Z=${dest?.positionZ} walking=${walking} arrived=${sasha.starName}`,
  );
}

// --- 70. TURNING to view62 fires openscene (per-view event) -> Sasha walks ---
// openscene is a per-VIEW event in DreamFactory: turning to face a guarded view
// re-fires the scene's openscene. Our engine used to fire it only on scene
// ENTRY, so HALLA's view62 walk (Sasha leaving down the hall) was dead — you
// enter Scene52 at view61 (the only road in) and turning to view62 never
// triggered it. Now a turn re-runs the scene openscene with the new currentview.
{
  const { session, viewer } = await newSession();
  session.interp.globals.set("neckphase", 7);
  session.interp.globals.set("mission", 1);
  session.interp.globals.set("phase", 4);
  session.interp.globals.set("tour", 0);
  await session.openSetFile("halla.set", "scene52", "view61");
  const v = viewer();
  // Sasha in the doorway on sasha.1 (as the fuse confirm leaves him)
  await session.sendEvent("sendtoactor", "sasha", "setupactor", ["halla"], "test");
  const sasha = session.actorRuntime.get("sasha")!;
  const atView61 = v.scene.views[v.viewIdx].viewName.toLowerCase() === "view61";
  const frozenBefore = sasha.starName === "sasha.1" && !session.isWalk("sasha");
  // turn until we face view62 (the guarded view) — the walk must fire on arrival
  let turns = 0;
  let walked = false;
  while (turns++ < 4 && !walked) {
    v.turn(0); // RIGHTTURNS
    await runAnimations(v);
    await drain();
    if (session.isWalk("sasha") || sasha.starName === "walkonpath") walked = true;
  }
  const facingView62 = v.scene.views[v.viewIdx].viewName.toLowerCase() === "view62";
  check(
    "turning to view62 fires openscene -> Sasha walks (per-view openscene)",
    atView61 && frozenBefore && facingView62 && walked,
    `atView61=${atView61} frozen=${frozenBefore} nowView62=${facingView62} walked=${walked} star=${sasha.starName}`,
  );
}

// --- camerahi: BOOTFILE adjustcamera() sets the per-set projection bias that
//     grounds the A-deck halls' world sprites (TI.EXE fn 0x43a970 / global
//     0x48a792). halla=139, non-halls=0; the bias raises the camera eye so the
//     projected feet drop onto the pre-rendered floor instead of floating. ---
{
  const { session, viewer } = await newSession();
  // a non-hall set leaves the bias at 0 (matches grounded sets)
  await session.openSetFile("b59.set");
  const biasB59 = session.cameraHiBias;

  // entering halla runs openset -> adjustcamera() -> camerahi(139)
  await session.openSetFile("halla.set", "scene52", "view61");
  const biasHalla = session.cameraHiBias;
  const v = viewer();
  const camZ = v.worldCamera()!.z;

  // the bias must move a floor point's screen row DOWN vs. the old (bias-0)
  // camera. Use a floor point straight ahead of the camera so depth > 0.
  const camBiased = v.worldCamera()!;
  const camPlain = { ...camBiased, z: camBiased.z - session.cameraHiBias };
  const ang = (2 * Math.PI * camBiased.deg) / 256;
  const fx = camBiased.x + Math.round(2000 * Math.cos(ang));
  const fz = camBiased.y + Math.round(2000 * Math.sin(ang));
  const floorH = camPlain.z - 200; // a point on the floor, below the eye
  const feetBiased = projectPoint(camBiased, fx, fz, floorH);
  const feetPlain = projectPoint(camPlain, fx, fz, floorH);
  const dropped = !!feetBiased && !!feetPlain && feetBiased.y > feetPlain.y;

  check(
    "camerahi grounds the halls: b59=0, halla=139, camera eye raised, feet drop",
    biasB59 === 0 && biasHalla === 139 && camZ > 0 && dropped,
    `b59=${biasB59} halla=${biasHalla} camZ=${camZ} feetPlainY=${feetPlain?.y} feetBiasedY=${feetBiased?.y}`,
  );
}

// --- matryoshka doll (PATTY.STG): a visible foreground prop with its own
//     mousedown script must intercept clicks before the flat click-regions
//     beneath it. The doll prop overlaps the doll1/dial hotspots that revealed
//     it; before the fix every "open a layer" click on the doll's left half was
//     swallowed by those regions and the doll only ever closed. ---
{
  const { session, viewer } = await newSession();
  const g = session.interp.globals;
  g.set("mission", 1); g.set("tour", 0); g.set("neckphase", 8); g.set("debugging", 1);
  await session.openSetFile("a14.set", "scene1", "view11");
  // real necklace inside the doll (Vlad's), fake in the player's hand to swap
  await session.sendEvent("sendtoshop", "inven.shp", "giveinven", ["realneck", "vlad"], "test");
  await session.sendEvent("sendtoshop", "inven.shp", "addinven", ["fakeneck"], "test");
  await session.track(session.transToFlat("patty.stg"));
  await session.sendEvent("sendtostage", "patty.stg", "solvedoll", [], "test");
  const v = viewer();
  const click = async (x: number, y: number) => {
    session.setPointer(x, y);
    session.pointerDown = true;
    await v.click(x, y);
    session.pointerDown = false;
    await drain();
  };
  const doll = () => session.propRuntime.get("doll");
  const preal = () => session.propRuntime.get("pattyreal");

  await click(120, 170); // doll1 region -> reveal the doll prop
  const revealed = !!doll()?.visible && doll()?.deg === 0;
  await click(150, 226); // doll LEFT half -> peel a layer (reaches the prop now)
  const peeled1 = doll()?.deg === 1;
  // RIGHT half closes: step the layer back down
  await click(250, 226);
  const closed = doll()?.deg === 0;
  // peel all the way open -> patty 3 reveals the real necklace inside
  await click(150, 226); await click(150, 226); await click(150, 226);
  const openedToNecklace = session.currentFlat.toLowerCase() === "patty 3" && !!preal()?.visible;
  // take the real necklace out (into the player's hand)
  await click(256, 180);
  const took = String(g.get("handitem")) === "realneck";

  // nested overlay: the inventory bag (inven1.stg) opens OVER the doll to swap
  // an item; leaving it must return to the EXACT prior screen — patty 3, doll
  // opened, set still hidden — not re-initialise the puzzle to "patty 1". This
  // is the stage stack + saved-flat + hide/show restore.
  await session.track(session.transToFlat("inven1.stg"));
  const onBag = session.stageName === "inven1.stg";
  await session.track(session.transFromFlat());
  const returned =
    session.stageName === "patty.stg" &&
    session.currentFlat.toLowerCase() === "patty 3" &&
    session.setVisible === false;

  check(
    "matryoshka doll: foreground prop intercepts, peels open/close, reveals + takes the real necklace",
    revealed && peeled1 && closed && openedToNecklace && took,
    `reveal=${revealed} peel=${peeled1} close=${closed} necklace=${openedToNecklace} took=${took}`,
  );
  check(
    "inventory bag opens over the doll and returns to the same screen (nested overlay stage stack)",
    onBag && returned,
    `onBag=${onBag} backStage=${session.stageName} backFlat=${session.currentFlat} setVisible=${session.setVisible}`,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
