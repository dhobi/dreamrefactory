/**
 * Which hotspot a point is on, as TI.EXE answers it (engine/src/web/viewer.ts
 * hitTest): the view's paintings from the LAST to the first, the first whose
 * half-open rectangle holds the point (0x409910 -> 0x435410, en build).
 *
 *   npx vitest run taoot/tests/auto/hit-order.ts
 *
 * RECEPT1C's Scene11 View25 is the one view in the English sets where a hotspot
 * lies under a LARGER one listed after it: cufflink2 (#0) under the Painting (#3).
 * In their overlap the Painting takes the click; the smallest-area rule the port
 * had gave it to the cufflink.
 */
import { test, expect } from "vitest";
import { newHost } from "../harness";

test("the later painting wins the overlap, and a rectangle's far edges are outside it", async () => {
  const { session, viewer } = await newHost();
  await session.openSetFile("recept1c.set");
  const v = viewer();
  const s = v.set.scenes.findIndex((sc) => sc.sceneName.toLowerCase() === "scene11");
  expect(s, "recept1c has Scene11").toBeGreaterThanOrEqual(0);
  const w = v.set.scenes[s].views.findIndex((vw) => vw.viewName.toLowerCase() === "view25");
  expect(w, "Scene11 has View25").toBeGreaterThanOrEqual(0);
  v.sceneIdx = s;
  v.viewIdx = w;
  const objs = v.set.scenes[s].views[w].objects;
  const cuff = objs.findIndex((o) => o.identifier.toLowerCase() === "cufflink2");
  const paint = objs.findIndex((o) => o.identifier.toLowerCase() === "painting");
  expect(cuff).toBeLessThan(paint);
  const a = objs[cuff];
  const b = objs[paint];
  const x = Math.max(a.startRegionX, b.startRegionX);
  const y = Math.max(a.startRegionY, b.startRegionY);
  expect(v.hitTest(x, y)?.obj.identifier.toLowerCase(), "the overlap belongs to the later one").toBe("painting");
  // half-open: the right and bottom edges are the next rectangle's
  const only = objs[paint];
  expect(v.hitTest(only.endRegionX, only.startRegionY)?.objIdx).not.toBe(paint);
  expect(v.hitTest(only.startRegionX, only.endRegionY)?.objIdx).not.toBe(paint);
});
