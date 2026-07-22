/**
 * Headless navigation test: drive SetViewer through turns and a road walk,
 * dumping the visible frame after each step.
 *
 *   npx tsx tests/nav.ts gamefiles/LOCAL/B59.SET out/
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { readSetFile } from "../src/df/set";
import { SetViewer } from "../src/viewer";
import { GameSession } from "../src/engine/session";
import { paletteToRGBA, indexedToRGBA } from "../src/df/image";
import { encodePNG } from "../tools/png";

const [, , setPath, outDir = "out"] = process.argv;
const set = readSetFile(new Uint8Array(readFileSync(setPath)));
mkdirSync(outDir, { recursive: true });

const gameDir = dirname(setPath);
const session = new GameSession((name) => {
  try {
    return new Uint8Array(readFileSync(join(gameDir, name.toUpperCase())));
  } catch {
    return null;
  }
});
const viewer = new SetViewer(set, session);
viewer.onHud = (t) => console.log(`HUD: ${t}`);
viewer.refreshHud();

const palette = paletteToRGBA(set.paletteRaw, set.colorCount);
let clock = 0;

function runAnimation(label: string): void {
  let frames = 0;
  while (viewer.busy) {
    clock += 100;
    viewer.tick(clock);
    frames++;
    if (frames > 1000) throw new Error("animation never finished");
  }
  console.log(`${label}: animation ran ${frames} ticks`);
}

function dump(name: string): void {
  clock += 100;
  const f = viewer.tick(clock);
  if (!f) {
    console.log(`${name}: NO FRAME`);
    return;
  }
  const rgba = indexedToRGBA(f.pixels, f.width, f.height, palette);
  writeFileSync(join(outDir, `${name}.png`), encodePNG(rgba, f.width, f.height));
  console.log(`${name}: ${f.width}x${f.height} scene=${viewer.scene.sceneName} view=${viewer.scene.views[viewer.viewIdx].viewName}`);
}

dump("nav0_start");
viewer.turn(0);
runAnimation("turn right");
dump("nav1_after_turn_right");
viewer.turn(1);
runAnimation("turn left");
dump("nav2_back_at_start");

// turn until a road is available, then walk it
for (let i = 0; i < 8 && !viewer.availableRoads().length; i++) {
  viewer.turn(0);
  runAnimation(`searching road, turn ${i}`);
}
const roads = viewer.availableRoads();
console.log(`roads here: ${roads.map((r) => r.road.transitionName).join(", ") || "none"}`);
if (roads.length) {
  dump("nav3_before_walk");
  viewer.walk();
  runAnimation("walk");
  dump("nav4_after_walk");
}
