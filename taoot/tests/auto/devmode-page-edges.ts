/**
 * Developer mode's page (`src/devmode-page.ts`) at its edges: a shell that
 * leaves out a slot, a game that never comes up or comes up with no room, a
 * flag the scripts left as the text "0", and the keys with nothing to act on.
 *
 *   npx vitest run --project taoot taoot/tests/auto/devmode-page-edges.ts
 *
 * `devmode-page.ts` holds the page to what it does with a game that is up;
 * this holds it to waiting for one. The wait gives up after a minute and
 * raises the flag anyway, because an edition that opens no set (the 1996 demo)
 * would otherwise wait for ever — and with no game at all it says so rather
 * than raising a flag on nothing. The page is the real devmode/index.html,
 * parsed by linkedom; the game is a stand-in for `window.dbg`.
 */
import { afterEach, expect, test, vi } from "vitest";
import { openDom, type TestPage } from "../page-dom";

const calls: string[] = [];

vi.mock("../../src/devmode/map-overlay", () => ({
  installMapOverlay: () => ({ enabled: () => {} }),
}));
vi.mock("../../src/devmode/console", async (orig) => ({
  ...(await orig<typeof import("../../src/devmode/console")>()),
  run: async (_s: unknown, line: string) => (calls.push(`console ${line}`), { ok: true }),
}));

function fakeSession(debugging: unknown = 0) {
  const globals = new Map<string, unknown>([["debugging", debugging]]);
  return {
    globals,
    session: {
      interp: { globals: { get: (k: string) => globals.get(k), set: (k: string, v: unknown) => void globals.set(k, v) } },
      runGlobal: async (h: string, args: (string | number)[] = []) => void calls.push(`${h} ${args.join(",")}`),
      altDown: false,
      metaDown: false,
      stageName: "bedsit1.set",
      currentFlat: "",
      instanceFrom: () => null,
    },
  };
}

/** the page, with these elements taken out of it before the module runs */
function page(without: string[] = []): TestPage {
  vi.resetModules();
  calls.length = 0;
  const p = openDom("devmode/index.html");
  for (const id of without) p.el(id)?.remove();
  return p;
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

const load = (): Promise<unknown> => import("../../src/devmode-page");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (globalThis as { dbg?: unknown }).dbg;
});

test("a shell with no slot for the bar is refused at once", async () => {
  page(["devslot"]);
  await expect(load()).rejects.toThrow(/^devmode: the page has no #devslot$/);
});

test("a game that never comes up is said after the wait, and no flag is raised", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  page();
  const loading = load();
  await waitOut(loading);
  await expect(loading).rejects.toThrow(/^devmode: the game never came up$/);
});

test("a game that comes up with no room is given the flag after the wait all the same", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const p = page();
  const game = fakeSession("0");
  (globalThis as { dbg?: unknown }).dbg = { session: game.session };
  const loading = load();
  await waitOut(loading);
  await loading;
  // "0" was the scripts' off, which the page reads as off and raises
  expect(game.globals.get("debugging")).toBe(true);
  expect(p.el("devstatus").textContent).toBe("● debugging on");
});

test("a shell with no picture has no map switch, and one with no prompt slot keeps the prompt in the bar", async () => {
  const p = page(["screen", "devpromptslot"]);
  (globalThis as { dbg?: unknown }).dbg = { viewer: {}, session: fakeSession().session };
  await load();
  const latches = [...p.document.querySelectorAll("#devlatches input")];
  expect(latches).toHaveLength(3);
  expect(p.el("devslot").querySelector("#devconsole")).toBeTruthy();
});

test("an accelerator with no menu open runs its command, and an empty history leaves the prompt alone", async () => {
  const p = page();
  (globalThis as { dbg?: unknown }).dbg = { viewer: {}, session: fakeSession().session };
  await load();
  p.fire("keydown", { key: "m", ctrlKey: true });
  await vi.waitFor(() => expect(calls).toContain("menuselect message"));
  const prompt = p.document.querySelector("#devconsole input") as HTMLInputElement;
  prompt.value = "half typed";
  const e = p.on(prompt, "keydown", { key: "ArrowUp" });
  expect(prompt.value).toBe("half typed");
  expect(e.defaultPrevented).toBe(false);
});
