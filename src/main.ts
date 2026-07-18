import { readSetFile, SetFile } from "./df/set";
import { SetViewer } from "./viewer";

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
/** every dropped file by lowercase basename — scripts pull in siblings (.shp) */
const fileStore = new Map<string, Uint8Array>();
let viewer: SetViewer | null = null;

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

function activateSet(name: string): void {
  const set = loadedSets.get(name);
  if (!set) return;
  scriptlog.textContent = "";
  viewer = new SetViewer(set, (name) => fileStore.get(name) ?? null);
  viewer.onHud = (t) => (hud.textContent = t);
  viewer.onLog = log;
  viewer.refreshHud();
  drop.style.display = "none";
  stage.style.display = "block";
  help.style.display = "block";
  refreshMap();
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
  for (const f of files) {
    const data = new Uint8Array(await f.arrayBuffer());
    fileStore.set(f.name.toLowerCase(), data);
    if (!/\.set$/i.test(f.name)) continue;
    try {
      loadedSets.set(f.name, readSetFile(data));
      if (!firstNew) firstNew = f.name;
    } catch (e) {
      hud.textContent = `Failed to load ${f.name}: ${(e as Error).message}`;
      console.error(e);
    }
  }
  rebuildSetSelect();
  if (firstNew) activateSet(firstNew);
}

function rebuildSetSelect(): void {
  setSelectWrap.innerHTML = "";
  if (loadedSets.size < 1) return;
  const sel = document.createElement("select");
  for (const name of loadedSets.keys()) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => activateSet(sel.value));
  setSelectWrap.appendChild(sel);
  const add = document.createElement("button");
  add.textContent = "+ add sets";
  add.style.marginLeft = "0.5rem";
  add.addEventListener("click", () => fileInput.click());
  setSelectWrap.appendChild(add);
}

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

screen.addEventListener("click", (e) => {
  if (!viewer) return;
  const { x, y } = canvasCoords(e);
  viewer.click(x, y);
});

screen.addEventListener("mousemove", (e) => {
  if (!viewer) return;
  const { x, y } = canvasCoords(e);
  const name = viewer.hover(x, y);
  screen.style.cursor = name ? (CURSOR_CSS[name] ?? "pointer") : "default";
});

window.addEventListener("keydown", (e) => {
  if (!viewer) return;
  switch (e.key) {
    case "ArrowRight":
      viewer.turn(0);
      break;
    case "ArrowLeft":
      viewer.turn(1);
      break;
    case "ArrowUp":
      viewer.walk();
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
