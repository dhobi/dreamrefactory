/**
 * The Details column a workbench installs (`src/details.ts`): what it hands the
 * engine's state list, read in node with the list stood in for.
 *
 *   npx vitest run speedrun/tests/details.ts
 *
 * Moved here from Dust's page test with the block it checked, which Dust's,
 * Timelapse's and RedJack's workbench pages each carried until it was the
 * workbench's (`Workbench.details`).
 */
import { afterEach, expect, it, vi } from "vitest";

let stateList: Record<string, (...a: never[]) => unknown> | null = null;

vi.mock("@dreamfactory/engine/web/state-list", () => ({ installStateList: (o: typeof stateList) => void (stateList = o) }));
vi.mock("@dreamfactory/engine/runtime/trace", () => ({ snapshotState: (_s: unknown, v: unknown, how: string) => ({ viewer: v, how }) }));

afterEach(() => vi.unstubAllGlobals());

it("lists the game's variables in its own key space, live, once there is a game", async () => {
  vi.stubGlobal("window", {});
  const { installDetails } = await import("../src/details");
  installDetails("dust", [{ name: "day", label: "Day" }]);
  expect(stateList!.storageKey).toBe("dust.details.state");
  expect(stateList!.defaultOn).toBe(true);
  expect((stateList!.spine as unknown as { name: string }[]).map((v) => v.name)).toEqual(["day"]);
  // the pane waits for a game to snapshot, and then snapshots it live
  expect(stateList!.visible()).toBe(false);
  vi.stubGlobal("window", { dbg: { host: { session: {}, viewer: null } } });
  expect(stateList!.visible()).toBe(true);
  expect(stateList!.state()).toEqual({ viewer: null, how: "live" });
});
