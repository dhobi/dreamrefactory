/**
 * TI.EXE's hidden Debug window as state (engine/src/runtime/debugger.ts): every
 * message its channel handler answers, every key of DispatchDebuggerKey and
 * every button of the 3×3 grid, and the faults it raises.
 *
 *   npx vitest run engine/tests/debugger-window.ts
 *
 * Needs no game data.
 */
import { expect, test } from "vitest";
import { DebuggerFault, ScriptDebugger, debuggerButtonRect } from "@dreamfactory/engine/runtime/debugger";

const scene = { top: 0, left: 0, bottom: 480, right: 640 };
/** a point inside a button of the grid */
const at = (row: number, column: number) => {
  const r = debuggerButtonRect(row, column);
  return { x: r.left + 5, y: r.top + 5 };
};

test("the window's messages: refs, placing, centring, reset and close", () => {
  const d = new ScriptDebugger();
  d.init(scene);
  expect(() => d.init(scene)).toThrow(DebuggerFault);
  expect(() => d.message(6)).toThrowError(/4394/);
  d.message(5);
  d.message(5);
  d.message(6);
  expect(d.windowRefs).toBe(1);
  d.message(7, { top: 1, left: 2, bottom: 3, right: 4 });
  expect(d.viewport).toEqual({ top: 1, left: 2, bottom: 3, right: 4 });
  d.message(0x10, scene);
  expect(d.viewport).toEqual({ top: 180, left: 310, bottom: 380, right: 530 });
  d.visible = true;
  d.depth = 4;
  d.message(9);
  expect([d.visible, d.depth]).toEqual([false, 0]);
  // draw, refresh and idle do nothing without a screen
  d.message(1);
  d.message(8);
  d.message(4);
  expect(d.open).toBe(false);
  expect(() => d.message(4)).toThrow(DebuggerFault);
});

test("keys, case-blind: steps, go, until-error, clear, and the scripts pane", () => {
  const d = new ScriptDebugger();
  d.depth = 5;
  d.message(2, "s".charCodeAt(0));
  expect([d.stepMode, d.targetDepth]).toEqual([1, 5]);
  d.message(2, "I".charCodeAt(0));
  expect([d.stepMode, d.targetDepth]).toEqual([2, 6]);
  d.message(2, "o".charCodeAt(0));
  expect([d.stepMode, d.targetDepth]).toEqual([3, 4]);
  d.visible = true;
  d.message(2, "e".charCodeAt(0));
  expect([d.visible, d.stepMode, d.runMode]).toEqual([false, 0, 0xffff]);
  d.message(2, "G".charCodeAt(0));
  expect(d.runMode).toBe(0);
  d.breakpointCount = 3;
  d.watchCount = 2;
  d.message(2, "a".charCodeAt(0));
  expect([d.breakpointCount, d.watchCount]).toEqual([0, 0]);
  // 3 on the scripts pane leaves it; from another pane it ends on LOCALS
  d.message(2, 3);
  expect(d.pane).toBe(2);
  d.pane = 0;
  d.message(2, 3);
  expect(d.pane).toBe(1);
  // any other key does nothing
  d.message(2, "z".charCodeAt(0));
  expect(d.pane).toBe(1);
});

test("clicks: the pane row, the step row, go / error / clear, and the listing below", () => {
  const d = new ScriptDebugger();
  d.depth = 2;
  d.message(0, at(0, 1));
  expect(d.pane).toBe(1);
  d.message(0, at(0, 0));
  expect(d.pane).toBe(0);
  d.message(0, at(1, 0));
  expect([d.stepMode, d.targetDepth]).toEqual([1, 2]);
  d.message(0, at(1, 1));
  expect([d.stepMode, d.targetDepth]).toEqual([2, 3]);
  d.message(0, at(1, 2));
  expect([d.stepMode, d.targetDepth]).toEqual([3, 1]);
  d.visible = true;
  d.message(0, at(2, 1));
  expect([d.visible, d.stepMode, d.runMode]).toEqual([false, 0, 0xffff]);
  d.message(0, at(2, 0));
  expect(d.runMode).toBe(0);
  d.breakpointCount = 1;
  d.message(0, at(2, 2));
  expect(d.breakpointCount).toBe(0);
  // between buttons, and on the listing: nothing
  d.stepMode = 7;
  d.message(0, { x: 3, y: 2 });
  d.message(0, { x: 10, y: 100 });
  expect(d.stepMode).toBe(7);
  // a button's one-pixel edge does not count
  const r = debuggerButtonRect(1, 0);
  d.message(0, { x: r.left, y: r.top + 5 });
  expect(d.stepMode).toBe(7);
});
