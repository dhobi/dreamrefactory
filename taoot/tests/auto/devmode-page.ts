/**
 * Developer mode's page (`src/devmode-page.ts`, taoot/devmode/), in node: its
 * real page parsed by linkedom and a stand-in for the `window.dbg` handle the
 * game publishes, so no game boots.
 *
 *   npx vitest run --project taoot taoot/tests/auto/devmode-page.ts
 *
 * What the game does with the flag is `tests/auto/devmode.ts`'s, against the
 * rip. What is pinned here is the page around it: the flag raised once the
 * game is up and PUT BACK when a load takes it down (#337's reason for
 * `wanted`), the status switch, the menu bar running TI.EXE's commands through
 * `menuselect` — Debug On/Off supplying the half the script lacks — one menu
 * open at a time, the greyed commands, the accelerators, the modifier latches
 * and `setloc`, the map overlay's switch, and the console with its history.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDom, type TestPage } from "../page-dom";

const calls: string[] = [];
let overlayOn: boolean[] = [];
let consoleAnswer: { ok: boolean; value?: unknown; error?: string } = { ok: true, value: 7 };

vi.mock("../../src/devmode/map-overlay", () => ({
  installMapOverlay: () => ({ enabled: (on: boolean) => void overlayOn.push(on) }),
}));
vi.mock("../../src/devmode/console", async (orig) => ({
  ...(await orig<typeof import("../../src/devmode/console")>()),
  run: async (_s: unknown, line: string) => (calls.push(`console ${line}`), consoleAnswer),
}));

function fakeSession() {
  const globals = new Map<string, unknown>([["debugging", 0]]);
  return {
    globals,
    session: {
      interp: { globals: { get: (k: string) => globals.get(k), set: (k: string, v: number | string) => void globals.set(k, v) } },
      runGlobal: async (h: string, args: (string | number)[] = []) => {
        calls.push(`${h} ${args.join(",")}`);
        // the script's own case: `if debugging → debugging = false`
        if (h === "menuselect" && args[0] === "debug on/off") globals.set("debugging", 0);
      },
      altDown: false,
      metaDown: false,
      stageName: "bedsit1.set",
      currentFlat: "",
      instanceFrom: () => null,
    },
  };
}

let game: ReturnType<typeof fakeSession>;

async function openDevmode(): Promise<TestPage> {
  vi.resetModules();
  calls.length = 0;
  overlayOn = [];
  consoleAnswer = { ok: true, value: 7 };
  const p = openDom("devmode/index.html");
  game = fakeSession();
  (globalThis as { dbg?: unknown }).dbg = { viewer: {}, session: game.session };
  await import("../../src/devmode-page");
  await vi.waitFor(() => expect(p.el("devstatus")).toBeTruthy());
  return p;
}

const button = (p: TestPage, select: string): HTMLButtonElement =>
  p.document.querySelector(`button[data-select="${select}"]`) as HTMLButtonElement;
const flag = (): unknown => game.globals.get("debugging");

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { dbg?: unknown }).dbg;
});

describe("the flag", () => {
  it("is raised once the game is up, and said so", async () => {
    const p = await openDevmode();
    expect(flag()).toBe(1);
    expect(p.el("devstatus").textContent).toBe("● debugging on");
    expect(p.el("devbar").classList.contains("dim")).toBe(false);
  });

  it("is put back when a load takes it down, and not when the page turned it off", async () => {
    const p = await openDevmode();
    game.globals.set("debugging", 0);
    p.frame();
    expect(flag()).toBe(1);
    // the status is a switch, and its OFF holds
    p.click("devstatus");
    expect(flag()).toBe(0);
    expect(p.el("devstatus").textContent).toBe("○ debugging off");
    expect(p.el("devstatus").classList.contains("off")).toBe(true);
    p.frame();
    expect(flag()).toBe(0);
    p.click("devstatus");
    expect(flag()).toBe(1);
  });
});

describe("the menu bar", () => {
  it("runs a command through the game's own menuselect", async () => {
    const p = await openDevmode();
    p.on(button(p, "message"), "click");
    await vi.waitFor(() => expect(calls).toContain("menuselect message"));
  });

  it("turns the flag off by the script's case, and on again by the page's", async () => {
    const p = await openDevmode();
    p.on(button(p, "debug on/off"), "click");
    await vi.waitFor(() => expect(flag()).toBe(0));
    expect(calls).toContain("menuselect debug on/off");
    // the script's answer is the new intent: the frame loop leaves it down
    p.frame();
    expect(flag()).toBe(0);
    calls.length = 0;
    p.on(button(p, "debug on/off"), "click");
    await vi.waitFor(() => expect(flag()).toBe(1));
    expect(calls).toEqual([]);
  });

  it("greys the commands the disc never ran, and says why", async () => {
    const p = await openDevmode();
    const report = button(p, "report");
    expect(report.disabled).toBe(true);
    expect(report.title).toContain("no case for this one");
    expect(button(p, "message").title).toBe('menuselect ("message") — command 200');
    expect(button(p, "message").querySelector("kbd")!.textContent).toBe("Ctrl+M");
  });

  it("keeps one menu down at a time, and shuts it on a click away", async () => {
    const p = await openDevmode();
    const [a, b] = [...p.document.querySelectorAll("details.devmenu")] as HTMLDetailsElement[];
    a.open = true;
    p.on(a, "toggle");
    b.open = true;
    p.on(b, "toggle");
    expect(a.open).toBe(false);
    // a toggle that closed does nothing
    b.open = false;
    p.on(b, "toggle");
    b.open = true;
    p.on(b, "toggle");
    p.on(b.querySelector("summary")!, "click");
    expect(b.open).toBe(true);
    p.on(p.el("devgame"), "click");
    expect(b.open).toBe(false);
  });

  it("answers TI.EXE's accelerators, and not the greyed ones or another modifier", async () => {
    const p = await openDevmode();
    const [menu] = [...p.document.querySelectorAll("details.devmenu")] as HTMLDetailsElement[];
    menu.open = true;
    p.on(menu, "toggle");
    p.fire("keydown", { key: "m", ctrlKey: true });
    await vi.waitFor(() => expect(calls).toContain("menuselect message"));
    expect(menu.open).toBe(false);
    calls.length = 0;
    p.fire("keydown", { key: "r", ctrlKey: true });
    p.fire("keydown", { key: "m", ctrlKey: true, altKey: true });
    p.fire("keydown", { key: "m" });
    p.fire("keydown", { key: "j", ctrlKey: true });
    await Promise.resolve();
    expect(calls).toEqual([]);
  });
});

describe("the latches", () => {
  it("hold option and command for every press, and a real key too", async () => {
    const p = await openDevmode();
    const [option, command, place, areas] = [...p.document.querySelectorAll("#devlatches input")] as HTMLInputElement[];
    option.checked = true;
    p.on(option, "change");
    expect(game.session.altDown).toBe(true);
    command.checked = true;
    p.on(command, "change");
    expect(game.session.metaDown).toBe(true);
    // a press with neither held keeps the latches
    p.fire("pointerdown");
    expect([game.session.altDown, game.session.metaDown]).toEqual([true, true]);
    option.checked = false;
    p.on(option, "change");
    command.checked = false;
    p.on(command, "change");
    p.fire("pointerdown", { altKey: true, metaKey: false });
    expect([game.session.altDown, game.session.metaDown]).toEqual([true, false]);
    // `setloc`, the placement mode
    place.checked = true;
    p.on(place, "change");
    expect(game.globals.get("setloc")).toBe(1);
    place.checked = false;
    p.on(place, "change");
    expect(game.globals.get("setloc")).toBe(0);
    // the map's areas are drawn by default, and can be put away
    expect(areas.checked).toBe(true);
    areas.checked = false;
    p.on(areas, "change");
    expect(overlayOn).toEqual([false]);
  });
});

describe("the console", () => {
  const submit = (p: TestPage, line: string): void => {
    const prompt = p.document.querySelector("#devconsole input") as HTMLInputElement;
    prompt.value = line;
    p.on(p.el("devconsole"), "submit");
  };

  it("sits at the foot of the scrollback, and runs a line of script", async () => {
    const p = await openDevmode();
    expect(p.el("devpromptslot").querySelector("#devconsole")).toBeTruthy();
    submit(p, "return (3 + 4)");
    expect(calls).toContain("console return (3 + 4)");
    await vi.waitFor(() => expect(p.el("devanswer").textContent).toBe("7"));
    consoleAnswer = { ok: true };
    submit(p, "beep ()");
    await vi.waitFor(() => expect(p.el("devanswer").textContent).toBe("ok"));
    consoleAnswer = { ok: false, error: "parse error at line 1" };
    submit(p, "return (");
    await vi.waitFor(() => expect(p.el("devanswer").className).toBe("bad"));
    expect(p.el("devanswer").textContent).toBe("parse error at line 1");
    consoleAnswer = { ok: false };
    submit(p, "x");
    await vi.waitFor(() => expect(p.el("devanswer").textContent).toBe("failed"));
    // a blank line is not run
    calls.length = 0;
    submit(p, "   ");
    expect(calls).toEqual([]);
  });

  it("walks its history with the arrows", async () => {
    const p = await openDevmode();
    submit(p, "first ()");
    submit(p, "second ()");
    const prompt = p.document.querySelector("#devconsole input") as HTMLInputElement;
    prompt.setSelectionRange = () => {};
    p.on(prompt, "keydown", { key: "ArrowUp" });
    expect(prompt.value).toBe("second ()");
    p.on(prompt, "keydown", { key: "ArrowUp" });
    expect(prompt.value).toBe("first ()");
    p.on(prompt, "keydown", { key: "ArrowDown" });
    expect(prompt.value).toBe("second ()");
    p.on(prompt, "keydown", { key: "Enter" });
    expect(prompt.value).toBe("second ()");
  });
});
