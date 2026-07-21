import { readSetFile, SetFile } from "./df/set";
import { SetViewer } from "./viewer";
import { AudioSink, WebAudioSink } from "./engine/audio";
import { GameSession } from "./engine/session";

// AudioContext must be created after a user gesture; the sink proxies until then
let webAudio: WebAudioSink | null = null;
// channel master gains requested (volume settings) before the real sink exists,
// replayed onto it once a user gesture lets us create the AudioContext
const pendingVolume = new Map<string, number>();
const audioSink: AudioSink = {
  play: (c, a, o) => webAudio?.play(c, a, o) ?? { done: true, stop() {} },
  halt: (c) => webAudio?.halt(c),
  isDone: (c) => (webAudio ? webAudio.isDone(c) : true),
  setChannelVolume: (c, v) => (webAudio ? webAudio.setChannelVolume(c, v) : pendingVolume.set(c, v)),
};
function ensureAudio(): void {
  if (!webAudio) {
    try {
      webAudio = new WebAudioSink();
      for (const [c, v] of pendingVolume) webAudio.setChannelVolume(c as never, v);
    } catch {
      /* no audio available */
    }
    // theme playback requested before the AudioContext existed was dropped —
    // start it now that we can actually make noise
    viewer?.startTheme();
  }
}
window.addEventListener("pointerdown", ensureAudio, { once: true });
window.addEventListener("keydown", ensureAudio, { once: true });

const drop = document.getElementById("drop") as HTMLDivElement;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const stage = document.getElementById("stage") as HTMLDivElement;
const screen = document.getElementById("screen") as HTMLCanvasElement;
const minimap = document.getElementById("minimap") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const help = document.getElementById("help") as HTMLDivElement;
const setSelectWrap = document.getElementById("setSelectWrap") as HTMLSpanElement;
const devbar = document.getElementById("devbar") as HTMLDivElement;
const devstate = document.getElementById("devstate") as HTMLDivElement;

const ctx = screen.getContext("2d")!;
const mapCtx = minimap.getContext("2d")!;

const loadedSets = new Map<string, SetFile>();
/** every available file by lowercase basename — scripts pull in siblings (.shp) */
const fileStore = new Map<string, Uint8Array>();
/** lowercase basename -> server URL (dev server manifest); lazy-fetched */
const serverFiles = new Map<string, string>();
const pendingFetches = new Set<string>();
let viewer: SetViewer | null = null;

// debug handle for browser-automation tests (tools/browsertest.ts)
Object.defineProperty(window, "dbg", { get: () => ({ viewer, session }) });

/**
 * FileProvider used by the engine. Synchronous by contract: returns what is
 * loaded; on a miss that the dev server could satisfy, kicks off a background
 * fetch and wires the file into the running viewer once it arrives.
 */
function provideFile(name: string): Uint8Array | null {
  const key = name.toLowerCase();
  const hit = fileStore.get(key);
  if (hit) return hit;
  const url = serverFiles.get(key);
  if (url && !pendingFetches.has(key)) {
    pendingFetches.add(key);
    void fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((buf) => {
        fileStore.set(key, new Uint8Array(buf));
        viewer?.addResource(key, fileStore.get(key)!);
      })
      .catch(() => {})
      .finally(() => pendingFetches.delete(key));
  }
  return null;
}

/** fetch a server file into the store (await-able, for set activation) */
async function fetchIntoStore(key: string): Promise<Uint8Array | null> {
  const cached = fileStore.get(key);
  if (cached) return cached;
  const url = serverFiles.get(key);
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = new Uint8Array(await r.arrayBuffer());
    fileStore.set(key, data);
    return data;
  } catch {
    return null;
  }
}

const scriptlog = document.getElementById("scriptlog") as HTMLPreElement;

function log(line: string): void {
  scriptlog.style.display = "block";
  scriptlog.textContent += line + "\n";
  scriptlog.scrollTop = scriptlog.scrollHeight;
}

// DreamFactory cursor names -> CSS cursors (refined as more names show up)
const CURSOR_CSS: Record<string, string> = {
  touch: "pointer",
  hand: "grab",
  take: "grab",
  turn: "pointer",
  look: "zoom-in",
  talk: "help",
};

// one session for the whole browser tab: globals persist across sets
const session = new GameSession(provideFile, audioSink);
session.onLog = (l) => log(l);
// Script poll loops (forceupdate/stilldown) yield through this so a real frame
// renders and pending pointer events are delivered between iterations.
// hasRealFrames also relaxes the interpreter's while-loop runaway guard for
// such loops — only valid here, where each iteration really waits on a frame.
session.hasRealFrames = true;
session.nextFrame = () => new Promise<void>((res) => requestAnimationFrame(() => res()));
// on-demand loaders (puppets/casts/movies) await this so the first click
// works even before the file is cached (provideFile fetches lazily)
session.ensureFile = async (name) => {
  await fetchIntoStore(name.toLowerCase());
};
session.onSetChange = async (fileName, sceneName, viewName) => {
  const data = await fetchIntoStore(fileName) ?? fileStore.get(fileName) ?? null;
  if (!data) {
    log(`cannot travel to ${fileName}: file not available`);
    return;
  }
  try {
    loadedSets.set(fileName, readSetFile(data));
  } catch (e) {
    log(`cannot parse ${fileName}: ${(e as Error).message}`);
    return;
  }
  const base = fileName.replace(/\.set$/, "");
  await Promise.all(
    [`${base}.shp`, `${base}.trk`, `${base}.sfx`, `${base}.11k`, "gang.cst", "extra.cst"].map(
      fetchIntoStore,
    ),
  );
  rebuildSetSelect();
  await activateSet(fileName, sceneName, viewName);
};

async function activateSet(name: string, startScene = "", startView = ""): Promise<void> {
  const set = loadedSets.get(name);
  if (!set) return;
  scriptlog.textContent = "";
  // direct activation (set list / drag-drop) bypasses openSetFile
  session.currentSetFile = name.toLowerCase().replace(/\.set$/, "");
  await session.loadCoreScripts();
  viewer = new SetViewer(set, session, startScene, startView);
  viewer.onHud = (t) => (hud.textContent = t);
  viewer.onLog = log;
  // movies aren't prefetched: fetch on demand, then play. Returns the play
  // promise so playmovie() blocks the script until the movie (chain) ends —
  // the modal behaviour interactive movies (the purser window) depend on.
  session.onPlayMovie = async (name, startFrame) => {
    const v = viewer;
    if (!v) return;
    const key = name.toLowerCase();
    if (!fileStore.has(key)) await fetchIntoStore(key);
    await v.playMovie(name, startFrame);
  };
  viewer.refreshHud();
  drop.style.display = "none";
  stage.style.display = "block";
  help.style.display = "block";
  refreshMap();
  if (webAudio) viewer.startTheme();
  await viewer.start();
}

function refreshMap(): void {
  if (viewer && viewer.showMap) {
    viewer.renderMap(mapCtx);
    minimap.style.display = "block";
  } else {
    minimap.style.display = "none";
  }
}

async function addFiles(files: FileList | File[]): Promise<void> {
  let firstNew: string | null = null;
  const lateResources: [string, Uint8Array][] = [];
  for (const f of files) {
    const data = new Uint8Array(await f.arrayBuffer());
    fileStore.set(f.name.toLowerCase(), data);
    if (!/\.set$/i.test(f.name)) {
      lateResources.push([f.name, data]);
      continue;
    }
    try {
      loadedSets.set(f.name, readSetFile(data));
      if (!firstNew) firstNew = f.name;
    } catch (e) {
      hud.textContent = `Failed to load ${f.name}: ${(e as Error).message}`;
      console.error(e);
    }
  }
  rebuildSetSelect();
  if (firstNew) {
    void activateSet(firstNew);
  } else if (viewer) {
    // banks/shops dropped after the set is already running
    let opened = false;
    for (const [name, data] of lateResources) {
      opened = viewer.addResource(name, data) || opened;
    }
    if (opened && webAudio) viewer.startTheme();
  }
}

function rebuildSetSelect(): void {
  setSelectWrap.innerHTML = "";
  const serverSets = [...serverFiles.keys()].filter((n) => n.endsWith(".set")).sort();
  if (loadedSets.size < 1 && serverSets.length < 1) return;
  const sel = document.createElement("select");
  const seen = new Set<string>();
  for (const name of loadedSets.keys()) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
    seen.add(name.toLowerCase());
  }
  for (const name of serverSets) {
    if (seen.has(name)) continue;
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = `${name} (server)`;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => {
    if (loadedSets.has(sel.value)) void activateSet(sel.value);
    else void loadServerSet(sel.value);
  });
  setSelectWrap.appendChild(sel);
  const add = document.createElement("button");
  add.textContent = "+ add sets";
  add.style.marginLeft = "0.5rem";
  add.addEventListener("click", () => fileInput.click());
  setSelectWrap.appendChild(add);
  buildDevTools();
}

// Puzzle-jump buttons + the mission/phase state controls don't depend on the
// set list, so they're built once — into their own bars (#devbar / #devstate) —
// and persist across set changes. #help's button/select CSS styles them and the
// bars' flex `gap` handles spacing (no per-element margins needed).
let devToolsBuilt = false;
function buildDevTools(): void {
  if (devToolsBuilt) return;
  devToolsBuilt = true;

  const seclabel = (parent: HTMLElement, text: string): void => {
    const s = document.createElement("span");
    s.className = "seclabel";
    s.textContent = text;
    parent.appendChild(s);
  };
  const mkDevBtn = (label: string, onClick: () => unknown): void => {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", () => void onClick());
    devbar.appendChild(b);
  };

  seclabel(devbar, "jump to");

  // dev affordance: open the deck map (normally triggered by the inventory
  // map prop, which isn't wired into the dev harness yet)
  mkDevBtn("🗺 Deck Map", () => {
    if (!viewer) return;
    // Dev convenience: the game's mapdisabled() gate refuses deck-map jumps
    // until Frank owns the bag + watch. Setting the game's own `tour` flag
    // makes mapdisabled() return false, so jumps are testable from any set.
    session.interp.globals.set("tour", 1);
    void session.track(session.transToFlat("map.stg"));
  });

  // dev: open the Marconi wireless stage from any set (normally entered from
  // the wireless room). Its shop/track/stg are prefetched in loadServerSet.
  mkDevBtn("📻 Wireless", () => {
    if (!viewer) return;
    void session.track(session.transToFlat("wireless.stg"));
  });

  // dev: open the gramophone-in-a-trunk stage (normally reached from Frank's
  // stateroom). Its shop/track/stg are prefetched in loadServerSet.
  mkDevBtn("📦 Trunk", () => {
    if (!viewer) return;
    void session.track(session.transToFlat("trunk.stg"));
  });

  // dev: open the Enigma decoder stage (normally reached from the trunk's
  // "enigma" hotspot). Its shop/track/stg are prefetched in loadServerSet.
  mkDevBtn("🔐 Enigma", () => {
    if (!viewer) return;
    void session.track(session.transToFlat("enigma.stg"));
  });

  // dev: open the boiler-room chute stage (normally reached from a BOIL.SET
  // coal hotspot). Its shop/track/stg are prefetched in loadServerSet.
  mkDevBtn("🔥 Boiler", async () => {
    // Reproduce the Enigma clue's state: the Rubaiyat hidden in coal chute 4.
    // inchute() (boil.shp openshop) shows boilrubaiyat when savedeck="boil3",
    // propowner("rubaiyat")="coal4" and we're on that chute's scene (Scene13).
    session.interp.globals.set("savedeck", "boil3");
    session.interp.globals.set("mission", 1);
    const rub = session.propRuntime.get("rubaiyat");
    if (rub) rub.owner = "coal4";
    else log("boiler dev: no rubaiyat prop (inven.shp not loaded?)");
    if (session.currentSetName !== "boil") await loadServerSet("boil.set");
    // Scene13/View21 = coal chute 4; jump there so inchute() matches, then
    // open the boiler flat as the coal hotspot would (transtoflat)
    viewer?.jumpTo("Scene13", "View21");
    if (viewer) void session.track(session.transToFlat("boil.stg"));
  });

  // dev: open the bomb-defuse stage (normally reached from C59.SET in mission 4
  // when bombphase=1). openstage() is self-contained — it opens bomb.shp/.trk,
  // sets up the props + globals, and starts the ambient loop — so a bare
  // transToFlat reproduces the puzzle. Its shop/track/stg are prefetched in
  // loadServerSet; the movies fetch on demand via onPlayMovie.
  mkDevBtn("💣 Bomb", () => {
    if (!viewer) return;
    void session.track(session.transToFlat("bomb.stg"));
  });

  // dev: open the turbine-plant stage (normally reached from the engine room in
  // mission 4). openstage() is self-contained (opens turbine.shp/turbpuz.trk,
  // randomises the dials, starts the continuous sim loop). Prefetched below.
  mkDevBtn("⚙️ Turbine", () => {
    if (!viewer) return;
    void session.track(session.transToFlat("turbine.stg"));
  });

  // dev: play blackjack THROUGH Buick, exactly as the smoking room does — fire
  // the blkjacktable prop's mousedown (HOUSE.SHP 176), which opens the dealer
  // puppet (blkjack1.pup), runs the "want to play?" conversation, and on "yes"
  // transtoflats to the table; entering blkjack.stg now deals via the boot's
  // per-stage initgame hook, and after each hand Buick offers another. mission<4
  // selects the disk-1 dealer conversation.
  mkDevBtn("🃏 Blackjack", async () => {
    if (!viewer) return;
    if (session.interp.globals.get("mission") === undefined) session.interp.globals.set("mission", 1);
    await session.track(
      session.sendEvent("sendtoprop", "blkjacktable", "mousedown", [0], "dev"),
    );
  });

  // dev: give Frank the three band items he normally collects in his cabin
  // (C73) — the inventory bag, the pocket watch (clock), and the deck map. Each
  // HOUSE.SHP prop has its own "add" handler that docks it in the bottom band
  // (owner=frank, moved to 256,324); this is the same trio the bag's mousedown
  // adds under `if debugging`. addbag/addwatch assume the item is already
  // on-screen from the pickup, so force visibility afterwards.
  mkDevBtn("🎒 Give kit", async () => {
    if (!viewer) return;
    for (const [prop, handler] of [
      ["bag", "addbag"],
      ["map", "addmap"],
      ["watch", "addwatch"],
    ] as const) {
      await session.track(session.sendEvent("sendtoprop", prop, handler, [], "dev"));
      const inst = session.propRuntime.get(prop);
      if (inst) inst.visible = true;
    }
  });

  // dev: enter the fencing duel (FENCE.STG) the way SQUASH.SET's fence() does
  // after the Willie/Haderlitz conversation (WILFENC1.PUP) — seed the globals
  // that conversation would set (fencelevel = difficulty 5/15/25; willphase 201
  // = "playing"; fencewins/fencecount = match tallies) and transtoflat into the
  // stage. openstage then loads fence.shp/fence.trk, stands Willie + the player
  // on the 16-flat piste at centre (flat 8), and lights the "engage" button.
  mkDevBtn("🤺 Fence", async () => {
    if (!viewer) return;
    const g = session.interp.globals;
    g.set("fencelevel", 15);
    g.set("willphase", 201);
    if (g.get("fencewins") === undefined) g.set("fencewins", 0);
    if (g.get("fencecount") === undefined) g.set("fencecount", 0);
    if (g.get("mission") === undefined) g.set("mission", 2);
    await session.track(session.transToFlat("fence.stg"));
  });

  // dev: enter the Vlad fistfight (FIGHT.STG) the way GSTAIR1.SET's runfight()
  // does at mission 3 / phase 1 — transtoflat into the stage. openstage loads
  // fight.shp/fight.trk and openfight() stands Vlad + the first-person fists on
  // screen with both power bars full (512). Click Vlad to punch (type by where
  // you click); he counter-attacks on his idle loop; first to power < -50 loses.
  mkDevBtn("🥊 Fight", async () => {
    if (!viewer) return;
    const g = session.interp.globals;
    if (g.get("mission") === undefined) g.set("mission", 3);
    if (g.get("phase") === undefined) g.set("phase", 1);
    await session.track(session.transToFlat("fight.stg"));
  });

  // dev: stand at the A-deck fuse standpoint (HALLA scene52/view61, port side)
  // during the Sasha subplot — but do NOT open the fusebox overlay directly.
  // Seed the gate globals (neckphase 6 = subplot live; fusebox "1,1,1,1," = all
  // fuses lit; hallside port; mission 1/phase 4 so the boot's progress(1,4) door
  // gate passes). HALLA openset then spawns the officer (asea) at view61, so you
  // land facing Alex: click him to talk (send him off), then click the fuse
  // panel to transtoflat into FUSE.STG yourself.
  mkDevBtn("🔌 Fuse", async () => {
    if (!viewer) return;
    const g = session.interp.globals;
    g.set("neckphase", 6);
    g.set("hallside", "port");
    // force the exact story point: the door gate is progress(1,4), i.e. at least
    // mission 1 / phase 4 — a fresh load sits at mission 0, so seeding "if
    // undefined" wasn't enough (the door stayed shut).
    g.set("mission", 1);
    g.set("phase", 4);
    if (g.get("fusebox") === undefined) g.set("fusebox", "1,1,1,1,");
    await session.openSetFile("halla.set", "scene52", "view61");
    // ensure the officer is present even if openset didn't re-fire (clicking
    // the dev button while already standing in HALLA); setupactor is idempotent.
    await session.sendEvent("sendtoactor", "asea", "setupactor", ["fuse"], "fuse-dev");
  });

  // dev: the matryoshka-doll necklace swap (PATTY.STG). Normally reached from
  // the A14 cabin once neckphase = 8 (A14.SET object -> transtoflat "patty.stg").
  // The real necklace lives inside the doll (inven initprops does
  // giveinven("realneck","vlad") at mission 1); you carry the FAKE and swap them.
  // We reproduce the entry state: mission 1, neckphase 8, the doll's dials
  // pre-solved (solvedoll() honours the `debugging` flag), realneck stashed in
  // the doll, and the fake necklace in your hand/bag via addinven.
  mkDevBtn("🪆 Doll", async () => {
    const g = session.interp.globals;
    g.set("mission", 1);
    g.set("tour", 0);
    g.set("neckphase", 8);
    g.set("debugging", 1);
    // land in Sasha's cabin (A14) facing the doll — Scene1/View11 is where the
    // "patty" object lives — so exiting the puzzle drops back into the room.
    await loadServerSet("a14.set");
    await session.openSetFile("a14.set", "scene1", "view11");
    // the real necklace belongs in the doll (Vlad's); inven initprops seeds this
    // at mission 1, but force it so the dev button works from any prior state.
    await session.sendEvent("sendtoshop", "inven.shp", "giveinven", ["realneck", "vlad"], "doll-dev");
    // the fake necklace goes into the player's hand/bag to swap in.
    await session.sendEvent("sendtoshop", "inven.shp", "addinven", ["fakeneck"], "doll-dev");
    await session.track(session.transToFlat("patty.stg"));
    // pre-solve the combination dials so the doll can be opened straight away.
    await session.sendEvent("sendtostage", "patty.stg", "solvedoll", [], "doll-dev");
  });

  // dev: the darkroom photo-development puzzle (PHOTO.STG / REDPHOTO.STG),
  // normally reached from the C78.SET developing bench. You develop 3 negatives
  // (pic1/2/3) by dragging each from its case into the correct bath (the "start"
  // region develops it good, "stop" spoils it), working under the red lamp;
  // white light ruins them. photo.stg is the white-light view, redphoto.stg the
  // red-light view (props at deg 0 vs 1) — both share photo.shp + openphoto.
  mkDevBtn("📷 Photo", async () => {
    const g = session.interp.globals;
    g.set("mission", 1);
    g.set("tour", 0);
    // fresh negatives (undeveloped, not yet spoiled)
    for (const k of ["picone", "pictwo", "picthree", "badone", "badtwo", "badthree"]) g.set(k, 0);
    if (!viewer || session.currentSetName === "none") await loadServerSet("c78.set");
    await session.track(session.transToFlat("photo.stg"));
  });

  // dev: the cufflink clue pickup (CUFF.STG). Normally reached from RECEPT1C.SET
  // by clicking one of three chair hotspots (cufflink1/2/3), which sets the
  // `cuffchair` global and transtoflat("cuff.stg"). Only the cufflink1 chair
  // hides the real cufflink, and only during the mission-2 purser investigation:
  // cuff.shp openshop shows it when mission=2 & cufflink unowned & the purs actor
  // is on the "findcuff" task & cuffchair="cufflink1". You click the cufflink to
  // enlarge it (small->med->big) then take it into your bag; the OK button
  // (cuffok, a trackbut) leaves the flat. We reproduce that entry state.
  mkDevBtn("🔗 Cuff", async () => {
    const g = session.interp.globals;
    g.set("mission", 2);
    g.set("tour", 0);
    g.set("cuffchair", "cufflink1");
    // reception room, where the cufflink chairs live — exiting drops back here
    await loadServerSet("recept1c.set");
    // satisfy the openshop gate so the hidden cufflink appears
    const purs = session.actorRuntime.get("purs");
    if (purs) purs.owner = "findcuff";
    const link = session.propRuntime.get("cufflink");
    if (link) link.owner = "none";
    await session.track(session.transToFlat("cuff.stg"));
  });

  // dev: the ship's-wheel steering sim (BRIDGE.STG). Reached from BRIDGE.SET by
  // clicking the helm (BRIDGE.SET/0007 -> transtoflat "bridge.stg"). openstage
  // opens bridge.shp, places the bridge frame + wheel + the 4 tiling sky props
  // (sky3/sky4 are propinstance copies of sky1/sky2), and starts the self-
  // re-registering `skydrift` loop at framerate(2). Dragging the wheel turns it
  // and sets `driftdesire`; skydrift eases `drifttotal` toward it and scrolls
  // the sky, so the ship swings off course (driftpos != 256 -> drifthappen=1).
  // Clicking OK (oklit trackbut) leaves; if you drifted, Morrow's kickout fires.
  mkDevBtn("🛞 Bridge", async () => {
    session.interp.globals.set("tour", 0);
    if (session.currentSetName !== "bridge") await loadServerSet("bridge.set");
    await session.track(session.transToFlat("bridge.stg"));
  });

  // dev: the Purser's Office (GSTAIR3.SET, Scene14/View36). Normally reached by
  // pressing up-arrow at the purser's window on C Deck (GSTAIR3.SET/0234 keydown
  // -> dopurser -> dopuppet). dopuppet plays the INTERACTIVE mainc.mov: knock on
  // the window (or ring the bell) and it chains to pursopen.mov (the lid rising),
  // which passes through an action frame -> actionframe(1) true -> the purser
  // conversation (purs1.pup) opens. Needs mission < 4, savedeck "c", the door
  // prop visible, and the modal playmovie() the engine now blocks on.
  mkDevBtn("🛎 Purser", async () => {
    const g = session.interp.globals;
    g.set("tour", 0);
    g.set("mission", 2); // mission-2 purser has the fullest menu (Thayer, cargo…)
    g.set("phase", 0);
    g.set("savedeck", "c");
    if (session.currentSetName !== "gstair3") await loadServerSet("gstair3.set");
    if (viewer) {
      viewer.jumpTo("Scene14", "View36");
      const door = session.propRuntime.get("door");
      if (door) door.visible = true; // the keydown gate requires propvisible("door")
      await viewer.keyDown("uparrow"); // -> dopurser: knock the window to talk
    }
  });

  // dev: the endgame "what happened to history" slideshow (NAREND.STG). Normally
  // reached from BOOTFILE after the ship sinks (leave.mov/debris.mov -> transtoflat
  // "narend.stg" -> opennarend). Which newspaper flats + narration + final movie
  // play depends on who owns the four artifacts (rubaiyat, real necklace, painting,
  // notebook), via onehappens/twohappens/revhappens -> futures(). The selector
  // below sets that ownership to reach each distinct ending (one movie each);
  // mission goes "good" only for the Prozac future. We also hideinterface() first
  // because the real endgame closesetfile()s before narend, so no menuband shows
  // (otherwise the persistent band sits over the black transitions).
  //   one = rubaiyat|realneck == vlad ; two = painting != frank ; rev = notebook != frank
  const ENDINGS: Record<string, { painting: string; notebook: string; rubaiyat: string; realneck: string }> = {
    "Prozac (good) — proz": { painting: "frank", notebook: "frank", rubaiyat: "frank", realneck: "frank" }, // F,F,F
    "Soviet — rushend": { painting: "frank", notebook: "vlad", rubaiyat: "frank", realneck: "frank" }, // F,F,T
    "Nazi — germend": { painting: "hack", notebook: "frank", rubaiyat: "frank", realneck: "frank" }, // F,T,F
    "Nuke — nuke": { painting: "hack", notebook: "vlad", rubaiyat: "frank", realneck: "frank" }, // F,T,T
    "Nochange (worst) — boom": { painting: "hack", notebook: "vlad", rubaiyat: "vlad", realneck: "vlad" }, // T,T,T
  };
  const narWrap = document.createElement("span");
  narWrap.style.marginLeft = "0.5rem";
  const narSel = document.createElement("select");
  for (const label of Object.keys(ENDINGS)) {
    const o = document.createElement("option");
    o.value = label;
    o.textContent = label;
    narSel.appendChild(o);
  }
  const narBtn = document.createElement("button");
  narBtn.textContent = "🗞 Ending";
  narBtn.style.marginLeft = "0.3rem";
  narBtn.addEventListener("click", async () => {
    const e = ENDINGS[narSel.value] ?? ENDINGS["Prozac (good) — proz"];
    if (!viewer || session.currentSetName === "none") await loadServerSet("c78.set");
    // match the real flow (closesetfile) so no menuband sits over the slideshow
    // + black transitions. hideinterface only hides band props owned by "frank",
    // so in the dev harness (nothing acquired) force the whole band hidden.
    await session.sendEvent("sendtoshop", "house.shp", "hideinterface", [], "ending-dev");
    for (const n of ["bag", "watch", "map", "ship", "life", "navarrow", "lid",
      "hrs", "min", "sec", "light", "door", "signs", "baby", "invenhelp"]) {
      const p = session.propRuntime.get(n);
      if (p) p.visible = false;
    }
    const own = (n: string, o: string) => {
      const p = session.propRuntime.get(n);
      if (p) p.owner = o;
    };
    own("painting", e.painting);
    own("notebook", e.notebook);
    own("rubaiyat", e.rubaiyat);
    own("realneck", e.realneck);
    await session.track(session.transToFlat("narend.stg"));
    await session.sendEvent("sendtostage", "narend.stg", "opennarend", [], "ending-dev");
  });
  narWrap.append(narSel, narBtn);
  devbar.appendChild(narWrap);

  // dev: the in-game settings panel (the "life" pocketwatch prop in the menu
  // band → dolife() → transtoflat("ctl.stg")). The wave-volume dial and the
  // theme-volume slider live here; both drive the audio sink's channel gains.
  mkDevBtn("⚙ Settings", async () => {
    if (!viewer || session.currentSetName === "none") await loadServerSet("c78.set");
    await session.track(session.transToFlat("ctl.stg"));
  });

  // dev: mission/state panel. Puzzle screens are gated on the mission/phase
  // globals + prop/actor owners + tuning; these controls reproduce a testable
  // state in one click (the alternative is a long dbg incantation each time).
  const stateWrap = document.createElement("div");
  const label = document.createElement("span");
  label.className = "seclabel";
  label.textContent = "state";
  stateWrap.appendChild(label);

  // Story-state jumps: land at a fixed point in the game exactly the way
  // BOOTFILE advanceday() sets it up for that `clock` value — minus the intro
  // cutscene movies (datebed/datecab/datehit.mov). initall() = changeset +
  // initactors + initprops, so the scene comes up fully reset: fresh inventory,
  // actors at their marks, the set's openset() firing with the right mission/
  // phase. See BOOTFILE 0002 advanceday, clocks "startdisk1"/"bedsit"/"startdisk2".
  const gotoStoryState = async (o: {
    set: string; scene: string; view: string; mission: number; phase: number;
    resetGame: boolean; neckphase?: number; letterphase?: number;
    hrs: number; min: number; sink?: boolean;
  }): Promise<void> => {
    const g = session.interp.globals;
    g.set("tour", 0); // advanceday errors under tour; the whole date machine is off-tour
    g.set("mission", o.mission);
    g.set("phase", o.phase);
    g.set("handitem", "");
    g.set("sinkflag", 0); // 0/1 — the interp represents false/true as 0/1
    // ensure the set + its boot script are loaded so the boot helpers below resolve
    const base = o.set.replace(/\.set$/, "");
    if (session.currentSetName !== base) await loadServerSet(o.set);
    if (o.resetGame) await session.runGlobal("resetgamevars"); // startdisk2 keeps its story vars
    await session.runGlobal("resetpupvars");
    if (o.neckphase !== undefined) g.set("neckphase", o.neckphase);
    if (o.letterphase !== undefined) g.set("letterphase", o.letterphase);
    await session.runGlobal("initall", [base, o.scene, o.view]); // navigate + full reset + openset
    g.set("hrs", o.hrs);
    g.set("min", o.min);
    g.set("sec", 0);
    if (o.sink) {
      // the sinking endgame: mission 4 + sinkflag, with the sink ambient bank
      await fetchIntoStore("sink0.trk");
      await session.runGlobal("setupsinksound");
      g.set("sinkflag", 1);
    }
    await session.runGlobal("calctime"); // point the pocketwatch hands at the set time
  };
  const mkStateBtn = (text: string, run: () => Promise<void>): void => {
    const b = document.createElement("button");
    b.textContent = text;
    b.style.marginRight = "0.4rem";
    b.addEventListener("click", () => void session.track(run()));
    stateWrap.appendChild(b);
  };
  // 1) game start — Frank's London flat (advanceday clock "startdisk1" target)
  mkStateBtn("🏠 London flat", () => gotoStoryState({
    set: "bedsit1.set", scene: "scene2", view: "view14",
    mission: 0, phase: 0, resetGame: true, hrs: 9, min: 30,
  }));
  // 2) boarding the Titanic — cabin C73 with Smethells knocking, empty inventory
  //    (advanceday clock "bedsit": mission 1 / phase 0, 9:30)
  mkStateBtn("🛏 C73 (Smethells)", () => gotoStoryState({
    set: "c73.set", scene: "scene51", view: "view63",
    mission: 1, phase: 0, resetGame: true, hrs: 9, min: 30,
  }));
  // 3) the sinking endgame — back in C73 after Vlad's blow / Zeitel's shot
  //    (advanceday clock "startdisk2": mission 4 / phase 0, sinkflag, ~13:02)
  mkStateBtn("🌊 C73 (sinking)", () => gotoStoryState({
    set: "c73.set", scene: "scene51", view: "view63",
    mission: 4, phase: 0, resetGame: false, neckphase: -1, letterphase: -1,
    hrs: 13, min: 2, sink: true,
  }));

  const mkSelect = (title: string, global: string, values: number[]): HTMLSelectElement => {
    const s = document.createElement("select");
    s.title = title;
    s.style.marginRight = "0.4rem";
    for (const v of values) {
      const o = document.createElement("option");
      o.value = String(v);
      o.textContent = `${title} ${v}`;
      s.appendChild(o);
    }
    s.addEventListener("change", () => session.interp.globals.set(global, Number(s.value)));
    return s;
  };
  const missionSel = mkSelect("mission", "mission", [1, 2, 3, 4]);
  const phaseSel = mkSelect("phase", "phase", [0, 1, 2, 3]);
  stateWrap.append(missionSel, phaseSel);

  // find the flat that owns the wireless morse readout (RX receive / TX send)
  const wirelessReadoutFlat = (): string | null => {
    for (const fn of session.flatNames) {
      if (session.flatScripts.get(fn)?.script.codes.has("keydown")) return fn;
    }
    return null;
  };
  // arm the wireless RX/TX puzzle: sender on + tuner tuned + breaker in mode,
  // then jump to the readout flat so its openflat runs setuprx()/setuptx()
  const armWireless = async (mode: "rx" | "tx"): Promise<void> => {
    if (!viewer) return;
    session.interp.globals.set("mission", Number(missionSel.value));
    session.interp.globals.set("phase", Number(phaseSel.value));
    if (session.stageName !== "wireless.stg") await session.transToFlat("wireless.stg");
    const own = (n: string, o: string) => {
      const p = session.propRuntime.get(n);
      if (p) p.owner = o;
    };
    own("senderhandle", "on");
    own("tunerknob", "on");
    const needle = session.propRuntime.get("tunerneedle");
    if (mode === "rx") {
      own("breakerhandle", "rx");
      if (needle) { needle.anchorX = 256; needle.anchorY = 84; needle.value = 84; } // RX window 81-87
    } else {
      own("breakerhandle", "tx");
      if (needle) { needle.anchorX = 256; needle.anchorY = 37; needle.value = 37; } // TX window 34-40
      const purs = session.actorRuntime.get("purs"); // purser handed over the Thayer gram
      if (purs) purs.owner = "sendgram";
    }
    const flat = wirelessReadoutFlat();
    if (flat) await session.gotoFlat(flat);
  };
  const mkPreset = (text: string, mode: "rx" | "tx"): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = text;
    b.style.marginRight = "0.4rem";
    b.addEventListener("click", () => void session.track(armWireless(mode)));
    return b;
  };
  stateWrap.append(mkPreset("📻 RX armed", "rx"), mkPreset("📻 TX + Thayer gram", "tx"));

  // free-form scene/view jump within the current set. Combined with the set
  // dropdown and the mission/phase selects above, this reaches almost any point
  // in the game: pick the set, set the story flags, then jump to a standpoint.
  const sceneInput = document.createElement("input");
  sceneInput.type = "text";
  sceneInput.placeholder = "scene";
  sceneInput.size = 8;
  sceneInput.style.marginLeft = "0.5rem";
  sceneInput.style.marginRight = "0.3rem";
  const viewInput = document.createElement("input");
  viewInput.type = "text";
  viewInput.placeholder = "view";
  viewInput.size = 8;
  viewInput.style.marginRight = "0.3rem";
  const jumpBtn = document.createElement("button");
  jumpBtn.textContent = "⤳ Jump";
  const doJump = (): void => {
    if (!viewer) return;
    const scene = sceneInput.value.trim();
    const ok = viewer.jumpTo(scene, viewInput.value.trim());
    hud.textContent = ok ? `jumped to ${scene} ${viewInput.value.trim()}`.trim() : `no such scene: ${scene}`;
  };
  jumpBtn.addEventListener("click", doJump);
  for (const inp of [sceneInput, viewInput]) {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doJump();
      e.stopPropagation(); // keep the game's global keydown handler from stealing typed keys
    });
  }
  stateWrap.append(sceneInput, viewInput, jumpBtn);

  devstate.appendChild(stateWrap);
}

/** activate a set that lives on the dev server: fetch it + its siblings */
async function loadServerSet(setName: string): Promise<void> {
  hud.textContent = `loading ${setName}…`;
  const data = await fetchIntoStore(setName);
  if (!data) {
    hud.textContent = `could not fetch ${setName}`;
    return;
  }
  const base = setName.replace(/\.set$/, "");
  // prefetch siblings so the viewer finds them synchronously at construction
  await Promise.all(
    [`${base}.shp`, `${base}.trk`, `${base}.sfx`, `${base}.11k`,
     "unilib.trk", "bootfile", "main.stg", "map.stg", "inven1.stg", "inven2.stg",
     "wireless.stg", "wireless.shp", "wireless.sfx",
     "trunk.stg", "trunk.shp", "grammy.sfx", "oldtune.trk", "oldboss.trk",
     "enigma.stg", "enigma.shp", "enigma.sfx",
     "boil.stg", "boil.shp", "boilflat.trk", "boil.trk",
     "bomb.stg", "bomb.shp", "bomb.trk",
     "turbine.stg", "turbine.shp", "turbpuz.trk",
     "blkjack.stg", "blkjack.shp", "blkjack.trk",
     "house.shp", "inven.shp", "inven.trk", "gang.cst", "extra.cst"].map(fetchIntoStore),
  );
  try {
    loadedSets.set(setName, readSetFile(data));
  } catch (e) {
    hud.textContent = `failed to parse ${setName}: ${(e as Error).message}`;
    return;
  }
  rebuildSetSelect();
  await activateSet(setName);
}

/** dev-server mode: offer all hosted .SET files as a clickable list */
async function initServerBrowser(): Promise<void> {
  let paths: string[];
  try {
    const r = await fetch("/api/gamefiles");
    if (!r.ok) return;
    paths = await r.json();
  } catch {
    return; // production / no dev server: drag-and-drop only
  }
  for (const p of paths) {
    serverFiles.set(p.split("/").pop()!.toLowerCase(), "/" + p);
  }
  const sets = [...serverFiles.keys()].filter((n) => n.endsWith(".set")).sort();
  if (!sets.length) return;
  const list = document.createElement("div");
  list.style.cssText = "margin-top:1rem;display:flex;flex-wrap:wrap;gap:0.4rem;max-width:1024px;justify-content:center";
  for (const s of sets) {
    const b = document.createElement("button");
    b.textContent = s.replace(/\.set$/, "");
    b.style.cssText = "background:#1c1b16;color:#d8d4c8;border:1px solid #3a3428;font-family:inherit;cursor:pointer;padding:0.2rem 0.6rem";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      void loadServerSet(s);
    });
    list.appendChild(b);
  }
  drop.appendChild(list);
  const note = document.createElement("div");
  note.style.cssText = "margin-top:0.6rem;font-size:0.75rem;color:#6c6759";
  note.textContent = "sets found on the dev server — click to play (siblings load automatically)";
  drop.appendChild(note);
}
void initServerBrowser();

drop.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => fileInput.files && addFiles(fileInput.files));
for (const [ev, cls] of [
  ["dragover", true],
  ["dragleave", false],
] as const) {
  document.body.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.toggle("hover", cls);
  });
}
document.body.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("hover");
  if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
});

/** map a mouse event to view-pixel coordinates on the canvas */
function canvasCoords(e: MouseEvent): { x: number; y: number } {
  const rect = screen.getBoundingClientRect();
  return {
    x: Math.floor(((e.clientX - rect.left) / rect.width) * screen.width),
    y: Math.floor(((e.clientY - rect.top) / rect.height) * screen.height),
  };
}

// Press/move/release so held-button drag loops work (`while stilldown()` in
// the wireless knobs). pointerdown routes the mousedown (which may enter a
// drag loop); pointermove keeps mouse() live; pointerup ends the loop.
screen.addEventListener("pointerdown", (e) => {
  if (!viewer) return;
  const { x, y } = canvasCoords(e);
  session.setPointer(x, y);
  session.pointerDown = true;
  void session.track(viewer.click(x, y));
});

// release anywhere ends a drag (the pointer may leave the canvas mid-drag)
window.addEventListener("pointerup", () => {
  session.pointerDown = false;
});

screen.addEventListener("mousemove", (e) => {
  if (!viewer) return;
  const v = viewer;
  const { x, y } = canvasCoords(e);
  // while dragging, just track the pointer — don't run hover's setcursor
  // scripts concurrently with the suspended drag handler
  if (session.pointerDown) {
    session.setPointer(x, y);
    return;
  }
  void v.hover(x, y).then((name) => {
    screen.style.cursor = name ? (CURSOR_CSS[name] ?? "pointer") : "default";
  });
});

const DF_KEY: Record<string, string> = {
  ArrowLeft: "leftarrow",
  ArrowRight: "rightarrow",
  ArrowUp: "uparrow",
  ArrowDown: "downarrow",
};

window.addEventListener("keydown", (e) => {
  if (!viewer) return;
  const v = viewer;
  // a full-screen overlay stage (the deck map) consumes all keys itself
  if (!session.setVisible && session.keydownTarget()) {
    const df = DF_KEY[e.key] ?? (e.key.length === 1 ? e.key.toLowerCase() : "");
    if (df) {
      void session.track(v.keyDown(df));
      e.preventDefault();
    }
    return;
  }
  switch (e.key) {
    case "ArrowRight":
      viewer.turn(0);
      break;
    case "ArrowLeft":
      viewer.turn(1);
      break;
    case "ArrowUp":
      // scripts may intercept walking (e.g. doors leading to other sets)
      void session.track(v.keyDown("uparrow").then((consumed) => consumed || v.walk()));
      break;
    case "ArrowDown":
      void session.track(v.keyDown("downarrow"));
      break;
    case "m":
    case "M":
      viewer.showMap = !viewer.showMap;
      refreshMap();
      break;
    case "o":
    case "O":
      viewer.showHotspots = !viewer.showHotspots;
      break;
    default:
      return;
  }
  e.preventDefault();
});

function loop(now: number): void {
  if (viewer) {
    viewer.tick(now);
    viewer.render(ctx);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// debug handle for driving the app from the console / automated tests
(window as unknown as Record<string, unknown>).__taoot = {
  session,
  get viewer() {
    return viewer;
  },
};
