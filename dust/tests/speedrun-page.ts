/**
 * The speedrun workbench's page (`src/speedrun-page.ts`): what it hands the
 * shared workbench and the state list, read in node with both stood in for.
 *
 *   npx vitest run --project dust dust/tests/speedrun-page.ts
 *
 * The workbench itself is the engine's and has its own suites; what is Dust's
 * here is the wiring — this game's key space, its own actions, the route the
 * build publishes beside the page, and a state pane that waits for a game.
 */
import { afterEach, expect, it, vi } from "vitest";

let workbench: Record<string, unknown> | null = null;
let stateList: Record<string, (...a: never[]) => unknown> | null = null;

vi.mock("@dreamfactory/engine/web/speedrun/workbench", () => ({ startWorkbench: (o: Record<string, unknown>) => void (workbench = o) }));
vi.mock("@dreamfactory/engine/web/state-list", () => ({ installStateList: (o: typeof stateList) => void (stateList = o) }));
vi.mock("@dreamfactory/engine/runtime/trace", () => ({ snapshotState: (_s: unknown, v: unknown, how: string) => ({ viewer: v, how }) }));
vi.mock("@dreamfactory/site/site", () => ({ siteUrl: (p: string) => `/site/${p}` }));

afterEach(() => vi.unstubAllGlobals());

it("starts the workbench in Dust's own key space, with Dust's actions and route", async () => {
  vi.stubGlobal("window", {});
  await import("../src/speedrun-page");
  const { ACTIONS } = await import("../src/speedrun/actions");
  expect(workbench!.game).toBe("dust");
  expect(workbench!.actions).toBe(ACTIONS);
  expect(workbench!.fixtureSheet).toBe("/site/speedrun/run.sheet.txt");
  expect(stateList!.storageKey).toBe("dust.details.state");
  expect(stateList!.defaultOn).toBe(true);
  // the pane waits for a game to snapshot, and then snapshots it live
  expect(stateList!.visible()).toBe(false);
  vi.stubGlobal("window", { dbg: { host: { session: {}, viewer: null } } });
  expect(stateList!.visible()).toBe(true);
  expect(stateList!.state()).toEqual({ viewer: null, how: "live" });
  expect((stateList!.spine as unknown as { name: string }[]).map((v) => v.name)).toEqual(["day", "clock"]);
});
