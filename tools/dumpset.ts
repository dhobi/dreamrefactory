/**
 * Verification tool: parse a SET file with the TypeScript decoder and dump
 * structure info + a handful of decoded frames as PNGs.
 *
 *   npm run dump -- gamefiles/en/titanic2/DATA/b59.set out/
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readSetFile, RIGHTTURNS, LEFTTURNS } from "@dreamfactory/engine/df/set";
import { FrameBuffer, decodeFrame, paletteToRGBA, indexedToRGBA } from "@dreamfactory/engine/df/image";
import { encodePNG } from "./png";

const [, , setPath, outDir = "out"] = process.argv;
if (!setPath) {
  console.error("usage: npm run dump -- <file.SET> [outDir]");
  process.exit(1);
}

const data = new Uint8Array(readFileSync(setPath));
const set = readSetFile(data);
mkdirSync(outDir, { recursive: true });

console.log(`Set name:        ${set.setName}`);
console.log(`Containers:      ${set.file.header.containerCount} (type ${set.file.header.type})`);
console.log(`Viewport:        ${set.viewPortWidth}x${set.viewPortHeight}`);
console.log(`Map:             ${set.mapWidth}x${set.mapHeight} (light @${set.mapLight}, dark @${set.mapDark})`);
console.log(`Default start:   scene "${set.defaultSceneName}", view "${set.defaultViewName}"`);
console.log(`Scenes:          ${set.scenes.length}`);
console.log(`Transitions:     ${set.transitions.length}`);
console.log(`Actors:          ${set.actors.length} ${set.actors.map((a) => a.identifier).join(", ")}`);

for (const scene of set.scenes) {
  const right = scene.turns[RIGHTTURNS];
  const left = scene.turns[LEFTTURNS];
  console.log(
    `  scene ${scene.index} "${scene.sceneName}": ${scene.views.length} views ` +
      `(${scene.views.map((v) => `${v.viewName}#${v.viewID}${v.objects.length ? `+${v.objects.length}obj` : ""}`).join(", ")}), ` +
      `turnframes R=${right.frames.length} L=${left.frames.length}`,
  );
}
for (const t of set.transitions) {
  console.log(
    `  road "${t.transitionName}": view ${t.viewIDstart} -> ${t.viewIDend}, ` +
      `frames A->B=${t.frameRegisters[0].frames.length}, B->A=${t.frameRegisters[1].frames.length}`,
  );
}

// decode: full right-turn ring of the default scene, in order (delta frames!)
const palette = paletteToRGBA(set.paletteRaw, set.colorCount);
const scene =
  set.scenes.find((s) => s.sceneName === set.defaultSceneName) ?? set.scenes[0];
const fb = new FrameBuffer();
let dumped = 0;
for (let i = 0; i < scene.turns[RIGHTTURNS].frames.length; i++) {
  const fi = scene.turns[RIGHTTURNS].frames[i];
  if (!fi.frameContainerLoc) continue;
  const frame = decodeFrame(set.file.containers[fi.frameContainerLoc].data, fb);
  const rgba = indexedToRGBA(fb.pixels, frame.width, frame.height, palette);
  writeFileSync(
    join(outDir, `${scene.sceneName}_R${String(i).padStart(3, "0")}_m${fi.motionInfo}_v${fi.viewID}.png`),
    encodePNG(rgba, frame.width, frame.height),
  );
  dumped++;
}
console.log(`\nDumped ${dumped} right-turn frames of scene "${scene.sceneName}" to ${outDir}/`);

// also decode the maps (256 colors there)
const mapPalette = paletteToRGBA(set.paletteRaw, 256);
for (const [name, loc] of [
  ["map_light", set.mapLight],
  ["map_dark", set.mapDark],
] as const) {
  const mfb = new FrameBuffer();
  const frame = decodeFrame(set.file.containers[loc].data, mfb);
  const rgba = indexedToRGBA(mfb.pixels, frame.width, frame.height, mapPalette);
  writeFileSync(join(outDir, `${name}.png`), encodePNG(rgba, frame.width, frame.height));
  console.log(`Dumped ${name} (${frame.width}x${frame.height})`);
}
