/**
 * The depths the DreamFactory 1 and 4 engines draw a world sprite at, at all.
 *
 *   npx vitest run engine/tests/depth-window.ts
 *
 * Outside the window the engines make no draw record, so the sprite is neither
 * seen, nor hit, nor `actordist`-present (see WorldCamera.depthWindow).
 */
import { expect, test } from "vitest";
import { inDepthWindow, type WorldCamera } from "@dreamfactory/engine/runtime/geometry";
import { ActorRuntime } from "@dreamfactory/engine/runtime/actors";

const camera = (depthWindow?: WorldCamera["depthWindow"]): WorldCamera => ({
  x: 0, y: 0, z: 0, deg: 0, f: 310, cx: 256, cy: 132, clipW: 512, clipH: 264, depthWindow,
});

test("Dust draws from depth 32 to its zFarMax, ground bias included (DF.EXE 0x41e828, 0x41e834)", () => {
  // every Dust set: zFarMax 24 * 64, and a ground bias of 128 less the setback 64
  const cam = camera({ minDepth: 32, far: 1536, bias: 64 });
  expect(inDepthWindow(cam, 31, 0)).toBe(false);
  expect(inDepthWindow(cam, 32, 0)).toBe(true);
  expect(inDepthWindow(cam, 1472, 0)).toBe(true); // 1472 + 64 = 1536, still in
  expect(inDepthWindow(cam, 1473, 0)).toBe(false);
  // zclip moves the far end and not the near one
  expect(inDepthWindow(cam, 1500, 32)).toBe(true);
  expect(inDepthWindow(cam, 31, -1000)).toBe(false);
});

test("Titanic draws past a quarter of its depth step, to its zFarMax (TI.EXE 0x411252, 0x411262)", () => {
  // a set of zFarMax 6000 in 24 levels: a step of 250, so drawn from depth 63
  const cam = camera({ minDepth: Math.trunc(Math.trunc(6000 / 24) / 4) + 1, far: 6000, bias: 0 });
  expect(inDepthWindow(cam, 62, 0)).toBe(false);
  expect(inDepthWindow(cam, 63, 0)).toBe(true);
  expect(inDepthWindow(cam, 6000, 0)).toBe(true);
  expect(inDepthWindow(cam, 6001, 0)).toBe(false);
  // depth less zclip is clamped at 0 before it is compared, so a large zclip never hides it
  expect(inDepthWindow(cam, 7000, 5000)).toBe(true);
});

test("a camera without a window (DreamFactory 5, or no set) draws at every depth", () => {
  expect(inDepthWindow(camera(), 1, 0)).toBe(true);
  expect(inDepthWindow(camera(), 1e6, 0)).toBe(true);
});

test("an actor outside the window is neither drawn, nor hit, nor on screen", () => {
  const R = new ActorRuntime();
  const opaque = new Uint8Array(16).fill(1);
  const frame = { width: 4, height: 4, posXraw: 2, posYraw: 4, indexed: new Uint8Array(16).fill(7), opaque };
  const actor = (y: number) => ({
    name: "a", visible: true, worldSpace: true, scale: 1000, zclip: 0, flip: 0, setName: "",
    worldX: 0, worldY: y, worldZ: 0, ink: 8, bright: [0, 0, 0],
    member: {}, pose: () => ({ steps: [[{ refScale: 96 }]] }),
  });
  // the private frame lookup is the only part of the runtime this does not exercise
  (R as unknown as { frameFor: () => typeof frame }).frameFor = () => frame;
  const actors = (R as unknown as { actors: Map<string, unknown> }).actors;
  const cam = { ...camera({ minDepth: 32, far: 1536, bias: 64 }), deg: 64 };
  actors.set("a", actor(20));
  expect(R.drawList(cam)).toHaveLength(0);
  expect(R.onScreen(actors.get("a") as never, cam)).toBe(false);
  actors.set("a", actor(100));
  expect(R.drawList(cam)).toHaveLength(1);
  expect(R.onScreen(actors.get("a") as never, cam)).toBe(true);
});
