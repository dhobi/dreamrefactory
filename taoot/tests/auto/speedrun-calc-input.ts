/**
 * Titanic's half of the workbench's Calculate (#509): where a headless run's
 * input goes (`src/speedrun/input.ts`), and which shipped save a fresh game in
 * the worker borrows to write its own over (`src/speedrun/calc-worker.ts`).
 *
 *   npx vitest run taoot/tests/auto/speedrun-calc-input.ts
 *
 * The input is the page's routing in main.ts, minus the page: an arrow is a
 * walk in the room, the same arrow on an overlay stage that takes keys is that
 * stage's, ESC is the special "." either way, and an arrow with no room up
 * goes nowhere. The save template is main.ts's choice too: Mission 4 on takes
 * the second save the page sent (the later one), anything before takes the
 * first — and either falls back to the other when only one was sent.
 *
 * Against a stand-in host that records what it is told, and with the worker's
 * `serveCalculation` caught rather than started, so the request's
 * `prepare` can be run against a session of its own.
 */
import { beforeAll, expect, test, vi } from "vitest";
import type { GameHost } from "@dreamfactory/engine/web/host";
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import { deliverInput } from "../../src/speedrun/input";

const served = vi.hoisted(() => ({ factory: null as null | ((req: { game: unknown }) => { prepare: (s: GameSession) => void }) }));
vi.mock("@dreamfactory/speedrun/calc-worker", () => ({
  serveCalculation: (_actions: unknown, factory: typeof served.factory) => void (served.factory = factory),
}));

beforeAll(async () => {
  await import("../../src/speedrun/calc-worker");
});

/* ------------------------------------------------------------------ *
 * the save a fresh game borrows
 * ------------------------------------------------------------------ */

function templateFor(mission: unknown, templates: (Uint8Array | undefined)[]): Uint8Array | null | undefined {
  const { prepare } = served.factory!({ game: { files: [], edition: "en", templates } });
  const s = { interp: { globals: new Map([["mission", mission]]) } } as unknown as GameSession;
  prepare(s);
  return s.saveTemplate!();
}

test("Mission 4 on borrows the later save, anything before it the earlier one", () => {
  const early = new Uint8Array([1]);
  const late = new Uint8Array([4]);
  expect(templateFor(1, [early, late])).toBe(early);
  expect(templateFor(4, [early, late])).toBe(late);
  expect(templateFor(5, [early, late])).toBe(late);
  // before any mission is set, the earlier
  expect(templateFor(undefined, [early, late])).toBe(early);
});

test("with only one save sent, every mission borrows that one", () => {
  const only = new Uint8Array([7]);
  expect(templateFor(4, [only])).toBe(only);
  expect(templateFor(1, [undefined, only])).toBe(only);
});

/* ------------------------------------------------------------------ *
 * where a key goes
 * ------------------------------------------------------------------ */

function host(opts: { viewer?: boolean; overlay?: boolean; hidden?: boolean } = {}) {
  const told: string[] = [];
  const viewer = {
    keyDown: async (k: string) => void told.push(`viewer key ${k}`),
    pressNav: async (k: string) => void told.push(`walk ${k}`),
  };
  const session = {
    viewShowing: !opts.overlay && !opts.hidden,
    stageCtrl: { keydownTarget: () => (opts.overlay ? "stage" : null) },
    track: (p: Promise<unknown>) => p,
  };
  const director = { keyDown: async (k: string, special: boolean) => void told.push(`key ${k}${special ? " (special)" : ""}`) };
  return { h: { session, director, viewer: opts.viewer === false ? null : viewer } as unknown as GameHost, told };
}

test("in the room an arrow is a walk, the down arrow and letters are keys, ESC is the special dot", () => {
  const { h, told } = host();
  for (const key of ["ArrowUp", "ArrowLeft", "ArrowRight", "ArrowDown", "Escape", "Q", "Shift"]) deliverInput(h, { type: "keydown", key });
  deliverInput(h, { type: "keydown" });
  expect(told).toEqual(["walk uparrow", "walk leftarrow", "walk rightarrow", "key downarrow", "key . (special)", "key q"]);
});

test("on an overlay that takes keys, an arrow is the stage's and ESC still the special dot", () => {
  const { h, told } = host({ overlay: true });
  deliverInput(h, { type: "keydown", key: "Escape" });
  deliverInput(h, { type: "keydown", key: "Shift" });
  deliverInput(h, { type: "keydown", key: "a" });
  expect(told).toEqual(["key . (special)", "key a"]);
});

test("an arrow with no room up goes nowhere", () => {
  const { h, told } = host({ viewer: false });
  deliverInput(h, { type: "keydown", key: "ArrowUp" });
  expect(told).toEqual([]);
});

test("with the room hidden under a stage that takes no keys, an arrow is still a walk", () => {
  const { h, told } = host({ hidden: true });
  deliverInput(h, { type: "keydown", key: "ArrowLeft" });
  expect(told).toEqual(["walk leftarrow"]);
});
