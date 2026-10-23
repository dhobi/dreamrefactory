/**
 * Clicks on a stage's regions, by position and by name
 * (engine/src/runtime/stage.ts StageController.stageClickAt / sendToButton):
 * a bare hotspot handed to the flat script by target, a scripted region that
 * gives the click up to a scripted prop over it, and the names that are not
 * there.
 *
 *   npx vitest run engine/tests/stage-clicks.ts
 *
 * Needs no game data: the stage and shop are written with the engine's own builders.
 */
import { expect, test } from "vitest";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { buildShpBytes } from "@dreamfactory/engine/df/shp-build";
import { buildStgBytes } from "@dreamfactory/engine/df/stg-build";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";

const FLAT = `code mousedown (what)
\tglobal flathit
\tflathit = what
endcode
`;
const OK = `code mousedown (what)
\tglobal okhit
\tokhit = okhit + 1
endcode
`;
const PROP = `code mousedown (pt)
\tglobal prophit
\tprophit = 1
endcode
`;

async function rig() {
  const W = 64;
  const stg = buildStgBytes({
    palette: [0, 0, 0],
    flats: [{
      name: "front",
      art: { pixels: new Uint8Array(W * W), width: W, height: W },
      script: compileScript(FLAT),
      regions: [
        { name: "ok", top: 0, left: 0, bottom: 10, right: 10, script: compileScript(OK) },
        { name: "bare", top: 20, left: 20, bottom: 30, right: 30 },
      ],
    }],
  });
  const art = { width: 4, height: 4, posXraw: 0, posYraw: 0, indexed: new Uint8Array(16), opaque: new Uint8Array(16).fill(1) };
  const shp = buildShpBytes({
    palette: [0, 0, 0],
    groups: [{ name: "doll", script: compileScript(PROP), states: [{ identifier: "still", frames: [{ art }] }] }],
  });
  const byName: Record<string, Uint8Array> = { "p.stg": stg, "t.shp": shp };
  const session = new GameSession((n) => byName[n] ?? null, new NullAudioSink());
  const log: string[] = [];
  session.onLog = (m: string) => log.push(m);
  const g = (n: string) => session.interp.globals.get(n);
  return { session, log, g };
}

test("with no stage open a click is nobody's", async () => {
  const { session } = await rig();
  expect(await session.stageCtrl.stageClickAt(5, 5)).toBe(false);
  expect(await session.stageCtrl.sendToButton("front", "ok", "mousedown", [], "t")).toBe(0);
});

test("a bare hotspot goes to the flat script by target, and the click goes on to the props", async () => {
  const { session, g } = await rig();
  await session.stageCtrl.openStageFile("p.stg");
  await session.stageCtrl.gotoFlat("front");
  expect(await session.stageCtrl.stageClickAt(25, 25)).toBe(false);
  expect(g("flathit")).toBe("bare");
  // nothing there at all
  expect(await session.stageCtrl.stageClickAt(50, 50)).toBe(false);
});

test("a scripted region takes the click, unless a scripted prop is drawn over it", async () => {
  const { session, g } = await rig();
  await session.stageCtrl.openStageFile("p.stg");
  await session.stageCtrl.gotoFlat("front");
  expect(await session.stageCtrl.stageClickAt(5, 5)).toBe(true);
  expect(g("okhit")).toBe(1);
  await session.openShop("t.shp");
  const doll = session.propRuntime.get("doll")!;
  Object.assign(doll, { visible: true, anchorX: 4, anchorY: 4 });
  expect(await session.stageCtrl.stageClickAt(5, 5)).toBe(false);
  expect(g("okhit")).toBe(1);
  // beside the prop, the region still takes it
  expect(await session.stageCtrl.stageClickAt(1, 1)).toBe(true);
  expect(g("okhit")).toBe(2);
});

test("sendtobutton to a region that is not there logs and answers 0", async () => {
  const { session, log } = await rig();
  await session.stageCtrl.openStageFile("p.stg");
  await session.stageCtrl.gotoFlat("front");
  expect(await session.stageCtrl.sendToButton("front", "nope", "mousedown", [], "t")).toBe(0);
  expect(log.at(-1)).toBe('sendtobutton: no region "nope" in flat front');
  expect(await session.stageCtrl.sendToButton("front", "ok", "mousedown", [0], "t")).toBe(0);
  expect(session.interp.globals.get("okhit")).toBe(1);
});
