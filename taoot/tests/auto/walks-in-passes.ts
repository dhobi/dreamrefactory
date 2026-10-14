/**
 * A walk is stepped by the pass and by nothing else (TI.EXE 0x442550 walks its
 * 16 slots, 0x443ba0, and has two callers: `forceupdate` and `visualeffect`).
 *
 *   npx vitest run taoot/tests/auto/walks-in-passes.ts
 *
 * So while a script holds the engine — a handler running, a conversation, a
 * `delay` — nobody takes a step; and a handler's own `forceupdate` is a pass,
 * which steps them inside it.
 */
import { test, expect } from "vitest";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { newHost, drain } from "../harness";

test("walks stand still while a script holds the engine, and step once a pass otherwise", async () => {
  const { session, viewer } = await newHost();
  session.interp.globals.set("mission", 1);
  await session.openSetFile("deckbd.set", "scene33", "view94");
  const v = viewer();
  let clock = 1_000_000;
  const ticks = async (n: number) => {
    for (let i = 0; i < n; i++) {
      v.tick((clock += 50));
      await drain();
    }
  };
  await ticks(2);
  // every idle held still, so nothing but this walk moves him
  session.scheduler.pauseLoop("actor", "all", true);
  const morrow = session.actorRuntime.get("morrow")!;
  morrow.speed = 30;
  morrow.deg = 0;
  session.scheduler.startWalk("morrow", morrow.worldX + 6000, morrow.worldY, morrow.worldZ);
  await ticks(4); // the turn phase, and into the walk
  const x0 = morrow.worldX;
  await ticks(3);
  expect(morrow.worldX - x0, "one actorspeed a pass, a pass a 50 ms tick").toBe(90);

  // a handler that holds the engine: not a step
  let release = () => {};
  void session.track(new Promise<void>((r) => (release = r)), "a conversation");
  await ticks(1); // the pass already under way finishes its wait
  const held = morrow.worldX;
  await ticks(20);
  expect(morrow.worldX, "no pass while it runs").toBe(held);

  // ...unless it yields one: forceupdate is the pass, inside the handler
  const go = session.instanceFrom(compileScript("code go ()\n\tforceupdate ()\n\tforceupdate ()\nendcode\n"), "go")!;
  await session.interp.runHandler(go, "go", [], { me: "go", target: "" });
  expect(morrow.worldX - held, "two forceupdates, two steps").toBe(60);
  release();
  await ticks(3);
  expect(morrow.worldX - held, "and the idle's passes take over again").toBeGreaterThanOrEqual(120);
});
