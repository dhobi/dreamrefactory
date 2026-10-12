/**
 * Nothing runs while a script is blocked in a fade ramp.
 *
 *   npx vitest run engine/tests/fade-ramp-runs-nothing.ts
 *
 * #541: lose the fistfight, open the deck map and close it again, and the map
 * on the panel rolls and unrolls over and over while the engine room takes its
 * 240-step fade back in. In the original it stands still until the fade is
 * over, then closes once.
 *
 * MAP.STG's `exitmap` is `transfromflat ()` then `sendtoprop ("map", close ())`,
 * so through the whole fade the map is still in the `open` view its `open()` put
 * it in before the map came up. A view goes round on every pass (TI.EXE
 * 0x418bf7) — but TI.EXE's ramp (`blacktoscreen` 0x43e5d0 -> 0x435be0) only
 * blends the palette (0x4359b0) and spins on the tick clock (0x41de90): no pass,
 * so no step, until the ramp is done.
 *
 * Nor does anything else: no pass, so no frame() count; no other script, so a
 * `delay` that comes due during the ramp ends only when the ramp does.
 *
 * No game data: one prop with a six-frame view, built here.
 */
import { test, expect } from "vitest";
import { buildShpBytes } from "@dreamfactory/engine/df/shp-build";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { ScreenDirector } from "@dreamfactory/engine/web/screen-director";

const frame = () => ({
  width: 4,
  height: 4,
  posXraw: 2,
  posYraw: 2,
  indexed: new Uint8Array(16).fill(1),
  opaque: new Uint8Array(16).fill(1),
});

const go = (session: GameSession, src: string) =>
  session.interp.runHandler(
    session.instanceFrom(compileScript(`code go ()\n${src}\nendcode\n`), "go")!,
    "go", [], { me: "go", target: "" },
  );

test("a blocking fade runs nothing else: no prop step, no pass, no other script (#541)", async () => {
  const shp = buildShpBytes({
    palette: [0, 0, 0, 255, 255, 255],
    groups: [{ name: "map", states: [{ identifier: "open", frames: Array.from({ length: 6 }, () => ({ art: frame() })) }] }],
  });
  const session = new GameSession((n) => (n === "test.shp" ? shp : null), new NullAudioSink());
  session.onLog = () => {};
  // a host that pumps frames, so the fade blocks its script as TI.EXE's does
  session.modalMovies = true;
  await session.openShop("test.shp");
  const dir = new ScreenDirector(session, { width: 64, height: 64 });
  await go(session, `\tpropview ("map", "open")\n\tpropxy ("map", 10, 10)\n\tpropvisible ("map", true)`);
  const map = session.propRuntime.get("map")!;

  let now = 0;
  const pass = () => dir.tick((now += 50));
  for (let i = 0; i < 3; i++) pass();
  const before = map.frameIdx;
  pass();
  expect(map.frameIdx, "the view goes round on its own").not.toBe(before);

  // another script, asleep for ten ticks when the ramp starts
  let slept = false;
  void go(session, `\tdelay (10)`).then(() => (slept = true));
  let faded = false;
  void go(session, `\tblacktoscreen ("current", 60)`).then(() => (faded = true));
  await new Promise((r) => setTimeout(r, 0)); // into the ramp
  expect(session.fade.ramping, "the script waits in the ramp").toBe(1);
  const held = map.frameIdx;
  const frames = session.frameCounter;
  // 60 ticks is a second: twenty passes, had any run
  for (let i = 0; i < 19; i++) {
    pass();
    await Promise.resolve();
    expect(map.frameIdx, `pass ${i} of the ramp`).toBe(held);
  }
  expect(session.frameCounter, "no pass counted a frame").toBe(frames);
  expect(slept, "the delay came due, and waits for the ramp").toBe(false);
  for (let i = 0; i < 4 && !faded; i++) {
    pass();
    await new Promise((r) => setTimeout(r, 0));
  }
  expect(faded, "the ramp ended").toBe(true);
  await new Promise((r) => setTimeout(r, 0));
  expect(slept, "and the delay with it").toBe(true);
  pass();
  pass();
  expect(map.frameIdx, "and the view goes round again").not.toBe(held);
});
