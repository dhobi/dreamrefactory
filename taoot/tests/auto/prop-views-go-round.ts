/**
 * A prop's view goes round for as long as the prop stands in it.
 *
 * User-reported (#472): "Played the gramophone in the trunk in C-73. The handle
 * moved one frame, I think, then stopped. It is supposed to spin (cycle
 * animation) while playing the message."
 *
 * TRUNK.STG's `mousedown` only SHOWS the handle — `propvisible ("crank", true)`,
 * then `forceupdate ()` until the player clicks — and no script anywhere names a
 * view for `crank`. Its one view, `untitled`, is nine pictures and an 18-step
 * play list (1,1,2,2,…,9,9). TI.EXE turns it because nothing in it holds: every
 * displayed frame `0x43a8b2` calls the prop pass `0x418bb0`, which adds one to
 * every prop's step and wraps it to 0 at the view's step count (`0x418beb–
 * 0x418bf7`), and the shop opener starts each prop in its first view with that
 * count (`0x415a0b–0x415a3b`). The port played a view once and held its last
 * frame, and a view nobody propview'd not at all.
 *
 * The same rule is the oddity #485 left open: the deck map's `open` keeps
 * rolling while the map flat is up, so `exitmap`'s `transfromflat ()` brings the
 * room back on a part-rolled map before `close ()` rolls it up from fully open.
 */
import { test, expect } from "vitest";
import { ENGINE_STEP_MS } from "@dreamfactory/engine/runtime/clock";
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import type { GameHost } from "@dreamfactory/engine/web/host";
import { newHost } from "../harness";

let clock = 1_000_000;

function call(session: GameSession, name: string, args: (string | number | boolean)[]): void {
  (session.interp.builtins.get(name) as (i: unknown, a: unknown[]) => void)(session.interp, args);
}

/** the frame drawn on each of `passes` service passes, through the host's own frame loop */
function play(host: GameHost, session: GameSession, prop: string, passes: number): number[] {
  const p = session.propRuntime.get(prop)!;
  const shown: number[] = [];
  for (let i = 0; i < passes; i++) {
    host.director.tick((clock += ENGINE_STEP_MS));
    shown.push(p.currentFrameIdx(p.state()!));
  }
  return shown;
}

test("the gramophone's handle turns while the record plays, round and round (#472)", async () => {
  const { host, session } = await newHost();
  await host.loadServerSet("c73.set");
  expect(await session.openShop("trunk.shp")).toBe(true);
  const crank = session.propRuntime.get("crank")!;
  const view = crank.state()!;
  expect(view.playOrder, "the crank's one view: nine pictures, two steps each").toEqual(
    [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8],
  );

  // TRUNK.STG mousedown: shown, never propview'd, then forceupdate until a click
  call(session, "propvisible", ["crank", true]);
  // the first pass draws step 0 and each pass after takes a step
  const shown = play(host, session, "crank", 36);
  const round = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8];
  expect(shown, "two turns of the handle, the second from the top").toEqual([...round, ...round]);
});

test("the deck map's open keeps rolling until a script changes its view (#485)", async () => {
  const { host, session } = await newHost();
  await host.loadServerSet("c73.set");
  const map = session.propRuntime.get("map")!;
  call(session, "propvisible", ["map", true]);
  call(session, "propview", ["map", "open"]);
  // house.shp's map `open ()`: makeloop ("prop", me, "domap", 5), then the map
  // flat — and nothing names another view until `close ()` after the flat
  const shown = play(host, session, "map", 14);
  const groups = shown.map((i) => map.state()!.groups![i]);
  // six steps (groups 0..5, shut to fully open), then round again
  expect(groups, "open goes round").toEqual([0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5, 0, 1]);
});

test("Dust's views still play once and hold — DF.EXE has not been checked", async () => {
  const { host, session } = await newHost();
  await host.loadServerSet("c73.set");
  await session.openShop("trunk.shp");
  session.dfVersion = 1;
  call(session, "propvisible", ["crank", true]);
  const shown = play(host, session, "crank", 10);
  expect(new Set(shown), "a view no script named stands still").toEqual(new Set([0]));
});
