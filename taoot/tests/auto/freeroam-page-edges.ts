/**
 * The guided tour's page (`src/freeroam-page.ts`) waiting for its game, and
 * its forward key when the boot has not named one.
 *
 *   npx vitest run --project taoot taoot/tests/auto/freeroam-page-edges.ts
 *
 * `pages.ts` holds the tour's glue to what it does with a game that is up.
 * This is the wait before it: the page installs its door hooks once there is a
 * room, gives up waiting after a minute and installs them anyway (an edition
 * that opens no set has no doors, and a hook on an empty ship costs nothing),
 * and with no game at all says so. A page without the line under the screen
 * still works, silently; and before `boot()` has set `keynorth`, the forward
 * letter is the shipped one, W.
 */
import { afterEach, expect, test, vi } from "vitest";
import { parseHTML } from "linkedom";

const calls: string[] = [];
vi.mock("../../src/freeroam/doors", () => ({
  isDoorHotspot: (paint: string) => paint === "door",
  doorSpot: (set: string, _sc: string, _v: string, paint: string, disc: number) => {
    calls.push(`spot ${set} ${paint} disc ${disc}`);
    return paint === "door" ? { paint } : null;
  },
  stepIfRefused: async () => (calls.push("step"), { skipped: "no-block" }),
  openIfRefused: async () => ({ skipped: "already-open" }),
  pickDoorway: () => null,
}));

interface Session {
  onSetKey: null | ((p: { key: string; set: string; scene: string; view: string; consumed: boolean }) => void);
  onHotspotClick: null | ((h: { paint: string; consumed: boolean }) => void);
}

function page(html: string, dbg?: unknown): { document: Document } {
  vi.resetModules();
  calls.length = 0;
  const { document } = parseHTML(html);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", Object.assign(Object.create(globalThis), dbg ? { dbg } : {}));
  return { document: document as unknown as Document };
}

function session(): Session & Record<string, unknown> {
  return {
    currentSetName: "b59",
    currentSceneName: () => "scene14",
    currentViewName: () => "view18",
    mountedCd: "Titanic2",
    interp: { globals: new Map<string, unknown>() },
    onHotspotClick: null,
    onSetKey: null,
  };
}

/**
 * Run the page's minute of waiting on fake time until its import settles. Real
 * turns of the event loop in between, because the import itself (compiling the
 * module) is real I/O that fake time does not move.
 */
async function waitOut(loading: Promise<unknown>): Promise<void> {
  let settled = false;
  loading.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let i = 0; i < 100_000 && !settled; i++) {
    await vi.advanceTimersByTimeAsync(50);
    await new Promise((r) => setImmediate(r));
  }
}

const load = (): Promise<unknown> => import("../../src/freeroam-page");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("before the boot names a forward letter it is W, and a page with no line under the screen stays quiet", async () => {
  const s = session();
  page("<html><body></body></html>", { session: s, viewer: {} });
  await load();
  s.onSetKey!({ key: "a", set: "b59", scene: "scene14", view: "view18", consumed: false });
  expect(calls).toEqual([]);
  s.onSetKey!({ key: "W", set: "b59", scene: "scene14", view: "view18", consumed: false });
  expect(calls).toEqual(["spot b59 door disc 2", "step"]);
  // a click on a door that is already open says nothing anywhere
  s.onHotspotClick!({ paint: "door", consumed: false });
});

test("no game at all is said after the wait, and nothing is installed", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  page("<html><body></body></html>");
  const loading = load();
  await waitOut(loading);
  await expect(loading).rejects.toThrow(/^freeroam: the game never came up$/);
});

test("a game with no room is given the door hooks after the wait all the same", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const s = session();
  const { document } = page('<html><body><span id="roamnote"></span></body></html>', { session: s });
  const loading = load();
  await waitOut(loading);
  await loading;
  expect(s.onSetKey).toBeTypeOf("function");
  expect(document.getElementById("roamnote")!.textContent).toBe("guided tour — every door opens");
});
