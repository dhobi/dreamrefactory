import { readFileSync } from "node:fs";
import { readSetFile } from "../src/df/set";
import { planWithin } from "../tests/playthrough/nav/setpath";
import { gamefilePath } from "./gamefiles";
const set = readSetFile(new Uint8Array(readFileSync(gamefilePath("decka.set"))));
console.log(`decka: ${set.scenes.length} scenes`);
set.scenes.forEach((s, i) => console.log(`  [${i}] ${s.sceneName}: ${s.views.map((v) => v.viewName).join(",")}`));
const find = (v: string) => {
  for (let s = 0; s < set.scenes.length; s++) {
    const i = set.scenes[s].views.findIndex((x) => x.viewName.toLowerCase() === v.toLowerCase());
    if (i >= 0) return { sceneIdx: s, viewIdx: i };
  }
  return null;
};
const goal = find("view373")!;
console.log(`view373 is at scene[${goal.sceneIdx}] view[${goal.viewIdx}]`);
for (const from of [{ sceneIdx: 10, viewIdx: 1 }, { sceneIdx: 4, viewIdx: 1 }, { sceneIdx: 3, viewIdx: 0 }]) {
  const plan = planWithin(set, from as any, (scene, viewIdx) =>
    set.scenes.indexOf(scene) === goal.sceneIdx && viewIdx === goal.viewIdx);
  console.log(`from scene${from.sceneIdx}/view${from.viewIdx} -> view373: ${plan ? plan.length + " gestures" : "NO PATH"}`);
}
