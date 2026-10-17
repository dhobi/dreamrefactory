/**
 * A click on a picture stretched out of 4:3 (engine/src/web/stretch.ts) still
 * lands on the screen pixel under it — the claim that let the stretched
 * fullscreen be a CSS change and not an engine one.
 *
 *   npx vitest run speedrun/tests/stretch-click.ts
 */
import { test, expect } from "vitest";
import { clientPointFor } from "@dreamfactory/speedrun/driver";

test("a click on a picture stretched out of 4:3 lands on the pixel under it", () => {
  // 512x384 filling a 1920x1080 display: 3.75x across, 2.8125x down
  const canvas = { width: 512, height: 384 };
  const rect = { left: 0, top: 0, width: 1920, height: 1080 };
  // the shells' own conversion, per axis (taoot/src/main.ts canvasCoords)
  const toScreen = (cx: number, cy: number) => ({
    x: Math.floor(((cx - rect.left) / rect.width) * canvas.width),
    y: Math.floor(((cy - rect.top) / rect.height) * canvas.height),
  });
  for (const [x, y] of [
    [0, 0],
    [511, 383],
    [256, 192],
    [100, 300],
    [450, 20],
  ]) {
    const at = clientPointFor(x, y, rect, canvas);
    expect(toScreen(at.x, at.y)).toEqual({ x, y });
  }
});
