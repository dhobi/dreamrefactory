/**
 * TI.EXE's F12 About box (runtime/about-box.ts) and its hidden script debugger
 * (runtime/debugger.ts).
 *
 *   npx vitest run engine/tests/about-box-debugger.ts
 */
import { expect, test } from "vitest";
import { aboutBoxText, wordWrapText } from "@dreamfactory/engine/runtime/about-box";
import { scriptErrorBoxText } from "@dreamfactory/engine/runtime/script-errors";
import { ScriptDebugger, debuggerButtonRect } from "@dreamfactory/engine/runtime/debugger";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";

test("the About box says what 0x41b920 formats, with the edition's build stamp", () => {
  const text = aboutBoxText({ compiled: "Oct  7 1996 at 08:42:02", heapZoneBytes: 64 * 1024 * 1024, heapFreeBytes: 4 * 1024 * 1024 + 1023 });
  expect(text).toBe(
    "DreamFactory v4.0\n(C) Copyright 1993-1996 CyberFlix, Inc.\nAll rights reserved.\n\n" +
      "Windows RT4 engine, standard version\nCompiled Oct  7 1996 at 08:42:02\n\n" +
      "Windows 95, build 950\nHeap zone is 65536K\n4096K is currently free\n" +
      "Joystick disabled\nAudio is 16-bit stereo via WinMM",
  );
  // every line is under 40 characters, so the wrap leaves it alone
  expect(wordWrapText(text)).toBe(text);
});

test("the wrap breaks a 40-character run at its last space and drops the spaces after", () => {
  const long = "aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj";
  // 40 copied ("…hhhh " ends at 40); the next is "i", so it backs up onto the
  // space, dropping it, breaks there and skips that space
  expect(wordWrapText(long)).toBe("aaaa bbbb cccc dddd eeee ffff gggg hhhh\niiii jjjj");
  expect(wordWrapText("x".repeat(39) + "  y")).toBe("x".repeat(39) + " \ny");
  // a newline inside the 40 ends the line without a break of the wrap's own
  expect(wordWrapText("ab\ncd")).toBe("ab\ncd");
});

test("the script error box is wrapped too, as 0x4211a0 wraps it", () => {
  expect(wordWrapText(scriptErrorBoxText(9))).toBe(
    'A scripting error has occured.  Choose\n"Yes" to try ignoring the error, or "No"\nto quit.  [No such variable.]',
  );
});

test("the Debug window opens hidden on the scene, 220 x 200, and closes at the session's end", () => {
  const d = new ScriptDebugger();
  d.init({ top: 0, left: 0, bottom: 480, right: 640 });
  expect(d.open).toBe(true);
  expect(d.visible).toBe(false);
  expect(d.viewport).toEqual({ top: 180, left: 310, bottom: 380, right: 530 });
  expect(() => d.init({ top: 0, left: 0, bottom: 480, right: 640 })).toThrow(/4395/); // 0x112b
  d.message(4);
  expect(d.open).toBe(false);
  expect(() => d.message(4)).toThrow(/4393/); // 0x1129
  expect(() => d.message(6)).toThrow(/4394/); // 0x112a
});

test("its keys and buttons set the run and step modes as 0x40be20 and 0x40c1b0 do; message 9 resets them", () => {
  const d = new ScriptDebugger();
  d.init({ top: 0, left: 0, bottom: 480, right: 640 });
  d.key("i".charCodeAt(0));
  expect([d.stepMode, d.targetDepth]).toEqual([2, 1]);
  d.key("E".charCodeAt(0));
  expect([d.stepMode, d.runMode]).toEqual([0, 0xffff]);
  const stepOut = debuggerButtonRect(1, 2);
  d.click({ x: stepOut.left + 5, y: stepOut.top + 5 });
  expect([d.stepMode, d.targetDepth, d.runMode]).toEqual([3, -1, 0]);
  d.message(9);
  expect([d.stepMode, d.runMode, d.pane, d.caretOffset]).toEqual([0, 0, 2, -1]);
});

test("only DreamFactory 4 has the window: TI.EXE and tl.exe, not DF.EXE or RedJack.exe", () => {
  const s = new GameSession(() => null, new NullAudioSink());
  expect(s.hasDebugChannel).toBe(true);
  s.dfVersion = 1;
  expect(s.hasDebugChannel).toBe(false);
  s.dfVersion = 4;
  s.isV5 = true;
  expect(s.hasDebugChannel).toBe(false);
});

test("heapsize() and the About box read one zone", () => {
  const s = new GameSession(() => null, new NullAudioSink());
  expect(s.heapZoneBytes).toBe(64 * 1024 * 1024);
  s.lowMemory = true;
  expect(s.heapZoneBytes).toBeLessThan(6144000);
});
