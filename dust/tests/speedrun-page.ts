/**
 * The speedrun workbench's page (`src/speedrun/page.ts`): what it hands the
 * shared workbench, read in node with it stood in for.
 *
 *   npx vitest run --project dust dust/tests/speedrun-page.ts
 *
 * The workbench itself is the speedrun workspace's and has its own suites; what is Dust's
 * here is the wiring — this game's key space, its own actions, the route the
 * build publishes beside the page, and the spine its Details column leads with
 * (the column itself is the workbench's: speedrun/tests/details.ts).
 */
import { afterEach, expect, it, vi } from "vitest";

let workbench: Record<string, unknown> | null = null;

vi.mock("@dreamfactory/speedrun/workbench", () => ({ startWorkbench: (o: Record<string, unknown>) => void (workbench = o) }));
vi.mock("@dreamfactory/chrome/site", () => ({ siteUrl: (p: string) => `/site/${p}` }));

afterEach(() => vi.unstubAllGlobals());

it("starts the workbench in Dust's own key space, with Dust's actions and route", async () => {
  vi.stubGlobal("window", {});
  await import("../src/speedrun/page");
  const { ACTIONS } = await import("../src/speedrun/actions");
  expect(workbench!.game).toBe("dust");
  expect(workbench!.actions).toBe(ACTIONS);
  expect(workbench!.fixtureSheet).toBe("/site/speedrun/run.sheet.txt");
  expect(workbench!.contributedSheets).toBe("/site/speedrun/sheets.json");
  const details = workbench!.details as { spine: { name: string }[] };
  expect(details.spine.map((v) => v.name)).toEqual(["day", "clock"]);
});
