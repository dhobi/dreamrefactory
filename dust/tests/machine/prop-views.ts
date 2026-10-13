/**
 * A Dust prop's view goes round for as long as the prop is drawn in it.
 *
 *   npm run test:machine -w dust -- tests/machine/prop-views.ts
 *
 * DF.EXE's prop draw (0x41eab0) shows the play-list entry at the stored step
 * (0x41eb4f), stores step + 1 and wraps it to 0 at the view's count (+0x70,
 * 0x41eb67). The frame compose (0x4340d0 → 0x4346b0(1) → 0x41e630(1)) is what
 * hands it the live record; the point tests step a copy. Nothing in the engine
 * holds a view at its end — the scripts stop one with a `makeloop` timed to its
 * length (FIGHT.PRP's `drop` and `stop` 4) — and the port used to play every
 * Dust view once and hold the last frame. What DF.EXE does NOT do is step a prop
 * it does not draw: 0x41e760 returns before the draw for a hidden one (0x41e770),
 * and for a world prop outside the depth window (0x41e828, 0x41e834).
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SAVES, haveRip, newDustHost, pumped } from "../playthrough/harness";
import { snapshotSaveV1 } from "@dreamfactory/engine/runtime/saveload-v1";
import { parseSaveV1 } from "@dreamfactory/engine/df/savegame-v1";
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import { projectPoint } from "@dreamfactory/engine/runtime/geometry";

const run = haveRip() ? test : test.skip;

function call(s: GameSession, name: string, args: (string | number)[]): void {
  (s.interp.builtins.get(name) as (i: unknown, a: unknown[]) => void)(s.interp, args);
}

run("the badge's highlight goes round while it is shown, and waits while it is not", async () => {
  const { host, logs } = await newDustHost();
  const p = pumped(host, logs);
  const s = p.session;
  expect(await s.loadGame(new Uint8Array(readFileSync(`${SAVES}/D2A_009.RTD`)))).toBe(true);
  await p.settle("D2A_009");
  const badge = s.propRuntime.get("badge")!;
  expect(badge, "INVEN.PRP's badge").toBeTruthy();
  call(s, "propvisible", ["badge", 1]);
  call(s, "propview", ["badge", "hilite"]);
  const st = badge.state()!;
  expect(st.playOrder?.length, "an eight-step view").toBe(8);

  const shown: number[] = [];
  for (let i = 0; i < 20; i++) {
    await p.tick(1);
    shown.push(badge.frameIdx);
  }
  // propview put the step at 0 (0x41c13a), and every pass after takes one
  const from = shown[0];
  expect(shown, "round and round").toEqual(shown.map((_, i) => (from + i) % 8));
  expect(shown).toContain(7);

  // the save keeps the step the next draw shows, so the last step saves as 0
  while (badge.frameIdx !== 7) await p.tick(1);
  const saved = parseSaveV1(snapshotSaveV1(s)!).props.find((q) => q.name.toLowerCase() === "badge")!;
  expect(saved.step, "wrapped, as 0x41eb67 stores it").toBe(0);

  call(s, "propvisible", ["badge", 0]);
  await p.tick(5);
  expect(badge.frameIdx, "a hidden prop is not drawn and not stepped").toBe(7);
  call(s, "propvisible", ["badge", 1]);
  await p.tick(1);
  expect(badge.frameIdx, "and goes on from where it stood").toBe(0);
});

run("a world prop steps only inside the depth window the room draws it in (0x41e828, 0x41e834)", async () => {
  const { host, logs } = await newDustHost();
  const p = pumped(host, logs);
  const s = p.session;
  expect(await s.loadGame(new Uint8Array(readFileSync(`${SAVES}/D2A_009.RTD`)))).toBe(true);
  await p.settle("D2A_009");
  const badge = s.propRuntime.get("badge")!;
  call(s, "propvisible", ["badge", 1]);
  call(s, "propview", ["badge", "hilite"]);
  const cam = p.v().roomCamera()!;
  expect(cam.depthWindow, "Dust's window: from 32, to 0x600 less the ground bias").toEqual({ minDepth: 32, far: 1536, bias: 64 });

  // stand the badge `depth` units straight down the view from the camera the room draws with
  const th = (2 * Math.PI * (cam.deg & 0xff)) / 256;
  const at = async (depth: number): Promise<number> => {
    call(s, "propxyz", ["badge", Math.round(cam.x + depth * Math.cos(th)), Math.round(cam.y + depth * Math.sin(th)), cam.z]);
    const proj = projectPoint(cam, badge.worldX, badge.worldY, badge.worldZ);
    expect(Math.abs((proj?.depth ?? 0) - depth), `placed at depth ${depth}`).toBeLessThanOrEqual(1);
    await p.tick(1); // the first placement restarts the view (becomeWorldProp)
    const from = badge.frameIdx;
    await p.tick(3);
    return (badge.frameIdx - from + 8) % 8;
  };
  expect(badge.worldSpace).toBe(false);
  expect(await at(200), "drawn, so stepped").toBe(3);
  expect(badge.worldSpace).toBe(true);
  expect(await at(20), "nearer than 0x20: not drawn, not stepped").toBe(0);
  expect(await at(1400), "1400 + 64 is inside 0x600").toBe(3);
  expect(await at(1500), "1500 + 64 is past 0x600").toBe(0);
  // zclip moves the far end (+0x4c, 0x41e813)
  badge.zclip = 100;
  expect(await at(1500), "1500 − 100 + 64 is back inside").toBe(3);
});
