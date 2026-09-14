/**
 * Joined conditions — `a or b`, `a and b`, `!a` (engine/src/web/speedrun/action.ts).
 *
 *   npx vitest run engine/tests/speedrun-condition.ts
 *
 * The grammar could say one condition at a time, and the routes being written
 * down do not stop on one. Every rung that clicks a character until they answer
 * stops on "either they are talking OR their phase moved on" — Trotter's third
 * click is `!!question(p) || num("trotterphase") === 4` — and a sheet with no
 * `or` has to drop one half. Dropping the half that fires turns a stop into a
 * timeout, so the line reads as broken when the route was right.
 *
 * `condition()` and not `predicate()` is the entry point every sheet-facing
 * `until:` and `wait()` uses, and this pins that too: a `predicate` still means
 * exactly one comparison, which is why `js ==` has to be handed through whole
 * rather than scanned for a joining word it is entitled to contain.
 */
import { test, expect } from "vitest";
import { condition, predicate } from "@dreamfactory/engine/web/speedrun/action";

/** true/false against a hand-made `window.dbg` — the expressions are strings */
const run = (expr: string, dbg: unknown): unknown => new Function("window", `return (${expr});`)({ dbg });

/**
 * A hand-made `window.dbg` — named flags rather than a spread, because a shallow
 * merge over a nested session is how this test first lied to itself.
 */
const world = (f: { puppet?: boolean; choosing?: boolean; globals?: Record<string, unknown> } = {}): unknown => ({
  session: {
    interp: { globals: new Map(Object.entries({ trotterphase: 2, dellphase: 0, ...(f.globals ?? {}) })) },
    puppet: f.puppet ? {} : null,
  },
  viewer: { conversing: false, awaitingChoice: !!f.choosing },
});

test("a bare condition still compiles on its own", () => {
  expect(run(condition("choosing"), world())).toBe(false);
  expect(run(condition("choosing"), world({ choosing: true }))).toBe(true);
  expect(run(condition("puppet"), world())).toBe(false);
  expect(run(condition("puppet"), world({ puppet: true }))).toBe(true);
});

test("or takes either half — Trotter's third click", () => {
  const stop = condition("choosing or global.trotterphase >= 4");
  expect(run(stop, world())).toBe(false);
  expect(run(stop, world({ choosing: true }))).toBe(true);
  expect(run(stop, world({ globals: { trotterphase: 4 } }))).toBe(true);
});

test("and takes both", () => {
  const both = condition("puppet and choosing");
  expect(run(both, world({ puppet: true }))).toBe(false);
  expect(run(both, world({ puppet: true, choosing: true }))).toBe(true);
});

test("or binds loosest, so and groups inside it", () => {
  // `puppet and choosing or global.dellphase == 1` is (puppet && choosing) || dell
  const mixed = condition("puppet and choosing or global.dellphase == 1");
  expect(run(mixed, world({ globals: { dellphase: 1 } }))).toBe(true);
  expect(run(mixed, world({ puppet: true }))).toBe(false);
});

test("parentheses regroup it", () => {
  const grouped = condition("puppet and (choosing or global.dellphase == 1)");
  expect(run(grouped, world({ globals: { dellphase: 1 } }))).toBe(false);
  expect(run(grouped, world({ puppet: true, globals: { dellphase: 1 } }))).toBe(true);
});

test("a leading ! negates the atom, not the whole join", () => {
  const one = condition("!choosing or puppet");
  expect(run(one, world())).toBe(true);
  expect(run(one, world({ choosing: true }))).toBe(false);
  expect(run(one, world({ choosing: true, puppet: true }))).toBe(true);
  // and it still negates a parenthesised group
  expect(run(condition("!(choosing or puppet)"), world())).toBe(true);
});

test("js == is handed through whole — its expression may contain the joining words", () => {
  const expr = condition("js == window.dbg.session.actor === 'organ or piano'");
  expect(run(expr, { session: { actor: "organ or piano" } })).toBe(true);
  // a `||` of its own is the point of the escape hatch
  expect(run(condition("js == 1 > 2 || 2 > 1"), world())).toBe(true);
});

test("predicate() is still one comparison, and says so when handed a join", () => {
  expect(() => predicate("choosing or puppet")).toThrow(/takes nothing after it/);
});

/**
 * The capitalisation case, which cost a leg its last assertion.
 *
 * Every other string condition in this grammar lowers both sides; `global.x ==
 * v` lowered only the sheet's half. Dust's route claims `handitem == cards` and
 * the engine answers "Cards", so a leg that had walked the whole way, taken the
 * dollar and picked the deck up failed on the letter C.
 */
test("a string global compares without regard to case, like set == and the rest", () => {
  const holding = (v: string): unknown => ({
    session: { interp: { globals: new Map([["handitem", v]]) }, puppet: null },
    viewer: { conversing: false, awaitingChoice: false },
  });
  expect(run(condition("global.handitem == cards"), holding("Cards"))).toBe(true);
  expect(run(condition("global.handitem == cards"), holding("cards"))).toBe(true);
  expect(run(condition("global.handitem == cards"), holding("CARDS"))).toBe(true);
  expect(run(condition("global.handitem == cards"), holding("jug"))).toBe(false);
  expect(run(condition("global.handitem != cards"), holding("Cards"))).toBe(false);
});

test("and the accessor form asks only whether it is set at all", () => {
  const holding = (v: string): unknown => ({
    session: { interp: { globals: new Map([["handitem", v]]) }, puppet: null },
    viewer: { conversing: false, awaitingChoice: false },
  });
  // "" is a real value in this game: an empty hand, no ambience, still alive
  expect(run(condition("global.handitem"), holding(""))).toBe(false);
  expect(run(condition("!global.handitem"), holding(""))).toBe(true);
  expect(run(condition("global.handitem"), holding("Cards"))).toBe(true);
  expect(run(condition("!global.handitem"), holding("Cards"))).toBe(false);
  // and `== ` with nothing after it says how to spell it instead
  expect(() => condition("global.handitem == ")).toThrow(/!global\.handitem/);
});

test("an unknown half is named rather than swallowed by the join", () => {
  expect(() => condition("choosing or nonsense.thing")).toThrow(/unknown condition/);
});
