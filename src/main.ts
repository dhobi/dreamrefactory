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
let viewer: SetViewer | null = null;

function activateSet(name: string): void {
  const set = loadedSets.get(name);
  if (!set) return;
  viewer = new SetViewer(set);
  viewer.onHud = (t) => (hud.textContent = t);
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
    if (!/\.set$/i.test(f.name)) continue;
    try {
      const set = readSetFile(new Uint8Array(await f.arrayBuffer()));
      loadedSets.set(f.name, set);
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
