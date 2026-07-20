import { readSetFile, SetFile } from "./df/set";
import { SetViewer } from "./viewer";
import { AudioSink, WebAudioSink } from "./engine/audio";
import { GameSession } from "./engine/session";

// AudioContext must be created after a user gesture; the sink proxies until then
let webAudio: WebAudioSink | null = null;
const audioSink: AudioSink = {
  play: (c, a, o) => webAudio?.play(c, a, o) ?? { done: true, stop() {} },
  halt: (c) => webAudio?.halt(c),
  isDone: (c) => (webAudio ? webAudio.isDone(c) : true),
};
function ensureAudio(): void {
  if (!webAudio) {
    try {
      webAudio = new WebAudioSink();
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
  // movies aren't prefetched: fetch on demand, then play
  session.onPlayMovie = (name, startFrame) => {
    const v = viewer;
    if (!v) return;
    if (fileStore.has(name.toLowerCase())) {
      void v.playMovie(name, startFrame);
    } else {
      void fetchIntoStore(name.toLowerCase()).then((d) => d && v.playMovie(name, startFrame));
    }
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
  // dev affordance: open the deck map (normally triggered by the inventory
  // map prop, which isn't wired into the dev harness yet)
  const mapBtn = document.createElement("button");
  mapBtn.textContent = "🗺 Deck Map (dev)";
  mapBtn.style.marginLeft = "0.5rem";
  mapBtn.addEventListener("click", () => {
    if (!viewer) return;
    // Dev convenience: the game's mapdisabled() gate refuses deck-map jumps
    // until Frank owns the bag + watch. Setting the game's own `tour` flag
    // makes mapdisabled() return false, so jumps are testable from any set.
    session.interp.globals.set("tour", 1);
    void session.track(session.transToFlat("map.stg"));
  });
  setSelectWrap.appendChild(mapBtn);

  // dev: open the Marconi wireless stage from any set (normally entered from
  // the wireless room). Its shop/track/stg are prefetched in loadServerSet.
  const wirelessBtn = document.createElement("button");
  wirelessBtn.textContent = "📻 Wireless (dev)";
  wirelessBtn.style.marginLeft = "0.5rem";
  wirelessBtn.addEventListener("click", () => {
    if (!viewer) return;
    void session.track(session.transToFlat("wireless.stg"));
  });
  setSelectWrap.appendChild(wirelessBtn);

  // dev: open the gramophone-in-a-trunk stage (normally reached from Frank's
  // stateroom). Its shop/track/stg are prefetched in loadServerSet.
  const trunkBtn = document.createElement("button");
  trunkBtn.textContent = "📦 Trunk (dev)";
  trunkBtn.style.marginLeft = "0.5rem";
  trunkBtn.addEventListener("click", () => {
    if (!viewer) return;
    void session.track(session.transToFlat("trunk.stg"));
  });
  setSelectWrap.appendChild(trunkBtn);

  // dev: open the Enigma decoder stage (normally reached from the trunk's
  // "enigma" hotspot). Its shop/track/stg are prefetched in loadServerSet.
  const enigmaBtn = document.createElement("button");
  enigmaBtn.textContent = "🔐 Enigma (dev)";
  enigmaBtn.style.marginLeft = "0.5rem";
  enigmaBtn.addEventListener("click", () => {
    if (!viewer) return;
    void session.track(session.transToFlat("enigma.stg"));
  });
  setSelectWrap.appendChild(enigmaBtn);

  // dev: mission/state panel. Puzzle screens are gated on the mission/phase
  // globals + prop/actor owners + tuning; these controls reproduce a testable
  // state in one click (the alternative is a long dbg incantation each time).
  const stateWrap = document.createElement("div");
  stateWrap.style.marginTop = "0.4rem";
  stateWrap.style.fontSize = "0.85em";
  const label = document.createElement("span");
  label.textContent = "dev state: ";
  label.style.opacity = "0.7";
  stateWrap.appendChild(label);

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
  setSelectWrap.appendChild(stateWrap);
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
     "house.shp", "inven.shp", "inven.trk", "gang.cst", "extra.cst"].map(fetchIntoStore),
  );
  try {
    loadedSets.set(setName, readSetFile(data));
  } catch (e) {
    hud.textContent = `failed to parse ${setName}: ${(e as Error).message}`;
    return;
  }
  rebuildSetSelect();
  void activateSet(setName);
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
