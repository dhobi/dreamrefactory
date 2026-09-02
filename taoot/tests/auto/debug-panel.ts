/**
 * The state list behind X (taoot/src/debug-panel.ts), against a real recorded state.
 *
 * The fixture is a golden playthrough beat rather than a handful of made-up
 * variables, because the thing the panel has to survive is the SIZE of the real
 * table: 102 globals at the credits and 113 at its fullest, of which a handful move
 * between one beat and the next. A synthetic fixture of six would prove none of
 * that.
 *
 * Those counts used to be 161. They came down when `dumpglobal` was fixed to
 * destroy what it names (#85) — the game tears its puzzles' working variables down
 * as it leaves them, and a third of the table was scratch the session had been
 * holding on to.
 */
import { test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import type { StateTrace } from "@dreamfactory/engine/runtime/trace";
import { ChangeWatch, RowView, SPINE, StateRow, stateDump, stateView } from "../../src/debug-panel";

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), "../playthrough/golden");

/** the last beat of the last segment: the fullest state the game ever holds */
function endOfGame(): StateTrace {
  const files = readdirSync(GOLDEN)
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) => parseInt(a.match(/\d+/)![0]) - parseInt(b.match(/\d+/)![0]));
  const beats: StateTrace[] = JSON.parse(readFileSync(join(GOLDEN, files[files.length - 1]), "utf8"));
  return beats[beats.length - 1];
}

test("the game's own six come first, however big the table is", () => {
  const trace = endOfGame();
  expect(Object.keys(trace.globals).length, "the real table").toBeGreaterThan(90);

  const view = stateView(trace);
  // the spelling is the game's own dialog's, not the variable names
  expect(view.spine.map((r) => r.name)).toEqual([
    "Mission",
    "Phase",
    "Letter",
    "Necklace",
    "Maze",
    "Level",
  ]);
  // and every one of them is a global this game actually declares
  for (const n of SPINE) expect(n in trace.globals, `${n} is a real global`).toBe(true);
  expect(view.where).toContain(trace.set);
});

test("by default the list is what just moved, and says how much it is not showing", () => {
  const trace = endOfGame();
  const quiet = stateView(trace);
  expect(quiet.rest, "nothing has moved, so nothing is listed").toEqual([]);
  expect(quiet.hidden, "…and the count says how many are sitting still").toBeGreaterThan(90);

  const moved = stateView(trace, { changed: new Set(["bombphase", "coalchute"]) });
  expect(moved.rest.map((r) => r.name)).toEqual(["bombphase", "coalchute"]);
  expect(moved.rest.every((r) => r.changed)).toBe(true);
});

/**
 * The default list has to be worth reading, and the clock is what stops it being
 * so: `sec` and `clockcount` move every second the game is up, so they were the
 * whole list, forever. The trace comparison drops the same names for the same
 * reason (engine/src/runtime/masks.ts).
 */
test("the pocketwatch does not count as news", () => {
  const trace = endOfGame();
  const ticking = new Set(["sec", "clockcount", "bombphase"]);
  expect(stateView(trace, { changed: ticking }).rest.map((r) => r.name)).toEqual(["bombphase"]);
  // but a reader who names them gets them
  expect(
    stateView(trace, { changed: ticking, filter: "sec" }).rest.some((r) => r.name === "sec"),
  ).toBe(true);
  expect(stateView(trace, { changed: ticking, all: true }).rest.some((r) => r.name === "sec")).toBe(
    true,
  );
});

test("the room's own two facts are said where the globals cannot", () => {
  const trace = endOfGame();
  const head = stateView(trace).head;
  expect(head[0]).toEqual({ name: "theme", value: trace.theme, changed: false });
  // the last beat of the game is held black behind the credits, so it HAS a fade
  expect(trace.fade).toBe(1);
  expect(head.map((r) => r.name)).toEqual(["theme", "fade"]);
  // 0 is "fully visible", the ordinary case, and not worth a row
  expect(stateView({ ...trace, fade: 0 }).head.map((r) => r.name)).toEqual(["theme"]);
});

test("`all` is the whole table, plus who owns what", () => {
  const trace = endOfGame();
  const all = stateView(trace, { all: true });
  const globals = Object.keys(trace.globals).length - SPINE.filter((n) => n in trace.globals).length;
  const owned = Object.keys(trace.props).length + Object.keys(trace.actors).length;
  expect(all.rest.length).toBe(globals + owned);
  expect(all.hidden, "nothing is being held back").toBe(0);
  // props and actors are named as such: `prop` and a global could share a name
  expect(all.rest.some((r) => r.name.startsWith("prop "))).toBe(true);
  expect(all.rest.some((r) => r.name.startsWith("actor "))).toBe(true);
});

test("a filter asks about the whole table, not just what moved", () => {
  const trace = endOfGame();
  const view = stateView(trace, { filter: "phase" });
  expect(view.rest.length, "there are plenty of phases").toBeGreaterThan(5);
  expect(view.rest.every((r) => r.name.includes("phase"))).toBe(true);
  // the point of this: none of them changed, and the reader still gets an answer
  expect(view.rest.some((r) => r.changed)).toBe(false);
});

/* ---------------------------------------------------------------- *
 * The filter, as a question with more than one term in it (#178)
 * ---------------------------------------------------------------- */

test("several terms are several questions, and | and , ask them the same way (#178)", () => {
  const trace = endOfGame();
  // the case it was asked for: a timer is three variables and it is the
  // RELATION between them that goes wrong (#126, #127), so one at a time is
  // none of them
  const bars = stateView(trace, { filter: "hrs|min|sec" }).rest.map((r) => r.name);
  const commas = stateView(trace, { filter: "hrs,min,sec" }).rest.map((r) => r.name);
  expect(bars).toEqual(commas);
  for (const term of ["hrs", "min", "sec"]) {
    expect(bars.some((n) => n.includes(term)), `${term} is in the list`).toBe(true);
  }
  // any-of, not all-of: a name cannot contain both, so all-of would answer
  // nothing at all
  expect(bars.every((n) => ["hrs", "min", "sec"].some((t) => n.includes(t)))).toBe(true);
  // ...and it is the union of asking separately, not something else
  const apart = new Set(
    ["hrs", "min", "sec"].flatMap((t) => stateView(trace, { filter: t }).rest.map((r) => r.name)),
  );
  expect(new Set(bars)).toEqual(apart);
});

test("a term is trimmed, an empty one is not a term (#178)", () => {
  const trace = endOfGame();
  const tidy = stateView(trace, { filter: "mission|phase" }).rest.map((r) => r.name);
  expect(stateView(trace, { filter: " mission | phase " }).rest.map((r) => r.name)).toEqual(tidy);
  // a trailing separator is somebody mid-typing, and must not read as "match
  // everything" — an empty term would do exactly that
  expect(stateView(trace, { filter: "mission|phase|" }).rest.map((r) => r.name)).toEqual(tidy);
  expect(stateView(trace, { filter: "|" }).rest, "no terms at all is no filter").toEqual(
    stateView(trace).rest,
  );
});

test("a space stays inside a term, because the types are spelled with one (#178)", () => {
  const trace = endOfGame();
  const [prop] = Object.keys(trace.props);
  expect(prop, "the fixture owns props").toBeTruthy();
  const rows = stateView(trace, { filter: `prop ${prop}` }).rest.map((r) => r.name);
  // one row: the prop named. Splitting on the space would have asked for every
  // prop OR anything called that, which is the opposite of narrowing
  expect(rows).toEqual([`prop ${prop}`]);
});

test("the filter searches a row's TYPE as well as its name (#178)", () => {
  const trace = endOfGame();
  const props = stateView(trace, { filter: "prop" }).rest;
  expect(props.length, "the fixture owns props").toBeGreaterThan(0);
  // What this used to answer, and the reason it is a bug: `saveprops`,
  // `saveprops1` and `saveprops2` are the globals that ENCODE the props, which
  // is the last thing somebody looking for the props wants. They match "prop"
  // as names and are still here — what changed is that the props themselves are
  // here too, and they are the majority.
  expect(props.some((r) => r.name.startsWith("prop ")), "the props themselves").toBe(true);
  expect(props.filter((r) => r.name.startsWith("prop ")).length).toBe(
    Object.keys(trace.props).length,
  );
  const actors = stateView(trace, { filter: "actor" }).rest;
  expect(actors.filter((r) => r.name.startsWith("actor ")).length).toBe(
    Object.keys(trace.actors).length,
  );
});

test("a filter reaches the props without `all`, the way it reaches the globals (#178)", () => {
  const trace = endOfGame();
  const [prop] = Object.keys(trace.props);
  // the whole reason `prop` could not be answered before: the props were behind
  // `all`, so filtering for them meant unfiltering everything else
  const view = stateView(trace, { filter: `prop ${prop}` });
  expect(view.rest.map((r) => r.name)).toEqual([`prop ${prop}`]);
  expect(view.rest[0].value).toBe(String(trace.props[prop]));
  // and with no filter and no `all` they stay out, which is what keeps the
  // default list a readout rather than a table
  expect(stateView(trace).rest.some((r) => r.name.startsWith("prop "))).toBe(false);
});

test("the spine is not filtered — it is the thing that is always true (#178)", () => {
  const trace = endOfGame();
  // pinned out of the scroll in the page (see #dbgState), and unfiltered here:
  // a filter narrows the LIST, and the six the game names are not in it
  expect(stateView(trace, { filter: "prop" }).spine.length).toBe(
    stateView(trace).spine.length,
  );
  expect(stateView(trace, { filter: "nothing matches this" }).spine.length).toBeGreaterThan(0);
});

test("a variable arriving is not a variable changing", () => {
  const watch = new ChangeWatch(1000);
  // 93 globals at boot and 161 by the credits: rooms declare their own as they
  // open, and lighting every new name would light the panel up at every door
  expect(watch.update({ mission: 1, phase: 0 }, 0).size, "the first sight of a table").toBe(0);
  expect(watch.update({ mission: 1, phase: 0, bombphase: 0 }, 10).size, "a room's own").toBe(0);

  const lit = watch.update({ mission: 1, phase: 1, bombphase: 0 }, 20);
  expect([...lit]).toEqual(["phase"]);
});

test("a change is lit for a moment and then is not", () => {
  const watch = new ChangeWatch(1000);
  watch.update({ phase: 0 }, 0);
  expect([...watch.update({ phase: 1 }, 100)]).toEqual(["phase"]);
  expect([...watch.update({ phase: 1 }, 900)], "still lit").toEqual(["phase"]);
  expect([...watch.update({ phase: 1 }, 1200)], "and out again").toEqual([]);
});

test("a fresh game has nothing lit and nothing remembered", () => {
  const watch = new ChangeWatch(1000);
  watch.update({ phase: 0 }, 0);
  watch.update({ phase: 1 }, 10);
  watch.reset();
  expect(watch.update({ phase: 1 }, 20).size, "the new game's first look").toBe(0);
});

/**
 * The dump is the artifact a report attaches. What matters is that it carries the
 * state at all, and that it is a PASTE rather than a link: the issue body travels
 * as a URL under a 4000-byte ceiling, and one snapshot is 3234 bytes of state on
 * its own (3333 at the fullest beat of the route) — before the script log it is
 * pasted with, which runs to 1141 lines and 40 kB over a whole game.
 */
test("the dump carries the state, the room and the log", () => {
  const trace = endOfGame();
  const text = stateDump(trace, ["movie: leave.mov (1/3 segments)", "disc 2 mounted"], [
    "taoot 0.9.7",
  ]);
  expect(text).toContain("taoot 0.9.7");
  expect(text).toContain(trace.set);
  expect(text).toContain("disc 2 mounted");
  // a global is a number OR a string — at the credits `mission` is "good"
  expect(text).toContain(`"mission": ${JSON.stringify(trace.globals.mission)}`);
  expect(text.length, "a snapshot alone is most of an issue URL's whole budget").toBeGreaterThan(2500);
});

// --- the list keeps its element in step by touching only what differs --------
// The panel POLLS, four times a second, because the engine has no "a global
// changed" event to listen for. Rebuilt lists (`replaceChildren` and a fresh row
// per variable) therefore discarded and re-made every one of 131 elements every 250 ms for a
// screen that had not changed — the whole rail repainting, and no text selection
// in it able to survive one tick. What these assert is the number that matters:
// an update over a quiet game writes NOTHING.

function list(): { host: HTMLElement; view: RowView } {
  const { document } = parseHTML("<!doctype html><div id=host></div>");
  const host = document.getElementById("host") as unknown as HTMLElement;
  return { host, view: new RowView(host) };
}

const row = (name: string, value: string, changed = false): StateRow => ({ name, value, changed });

test("a quiet game costs no writes at all", () => {
  const { host, view } = list();
  const rows = [row("mission", "1"), row("bombphase", "0"), row("coalchute", "3")];
  expect(view.apply(rows)).toEqual({ added: 3, removed: 0, updated: 6, moved: 3 });
  expect(host.children.length).toBe(3);

  // the same values again, and again: nothing is touched
  expect(view.apply(rows), "second pass").toEqual({ added: 0, removed: 0, updated: 0, moved: 0 });
  expect(view.apply([...rows]), "and a fresh array of the same values").toEqual({
    added: 0,
    removed: 0,
    updated: 0,
    moved: 0,
  });
});

test("a value that moves is the only thing rewritten", () => {
  const { host, view } = list();
  view.apply([row("mission", "1"), row("phase", "0")]);
  const before = [...host.children];

  const patch = view.apply([row("mission", "1"), row("phase", "1", true)]);
  // one for the number, one for the highlight coming on
  expect(patch).toEqual({ added: 0, removed: 0, updated: 2, moved: 0 });
  expect([...host.children], "the same elements, patched in place").toEqual(before);
  expect(host.children[1].className).toBe("row lit");
  expect(host.children[1].textContent).toBe("phase 1");

  // and the highlight going off again is one write, not a rebuild
  expect(view.apply([row("mission", "1"), row("phase", "1")])).toEqual({
    added: 0,
    removed: 0,
    updated: 1,
    moved: 0,
  });
});

test("rows that go, go — and a reorder moves rather than rebuilds", () => {
  const { host, view } = list();
  view.apply([row("a", "1"), row("b", "2"), row("c", "3")]);
  const kept = host.children[2];

  // taking the middle row out closes the gap by itself, so the survivors do not
  // even count as moved
  expect(view.apply([row("a", "1"), row("c", "3")])).toEqual({
    added: 0,
    removed: 1,
    updated: 0,
    moved: 0,
  });
  expect(host.children.length).toBe(2);
  expect(host.children[1], "c is the element it always was").toBe(kept);

  // what a filter does: the same rows, different order
  const patch = view.apply([row("c", "3"), row("a", "1")]);
  expect(patch.added + patch.removed + patch.updated).toBe(0);
  expect(patch.moved).toBeGreaterThan(0);
  expect([...host.children].map((e) => e.textContent)).toEqual(["c 3", "a 1"]);
});

test("the strip above the list is the same machinery, spelled differently", () => {
  const { document } = parseHTML("<!doctype html><div id=host></div>");
  const host = document.getElementById("host") as unknown as HTMLElement;
  const view = new RowView(host, { row: "span", name: "span", value: "span" }, "");
  view.apply([row("Mission", "1"), row("Phase", "4")]);
  expect(host.children[0].tagName.toLowerCase()).toBe("span");
  expect(host.children[0].className, "no row class to carry here").toBe("");
  expect(host.textContent).toBe("Mission 1Phase 4");
  expect(view.apply([row("Mission", "1"), row("Phase", "4")])).toEqual({
    added: 0,
    removed: 0,
    updated: 0,
    moved: 0,
  });
});

test("the whole real table, twice, writes nothing the second time", () => {
  const { host, view } = list();
  const trace = endOfGame();
  const rows = stateView(trace, { all: true }).rest;
  expect(rows.length, "the real thing, not a sample").toBeGreaterThan(120);
  view.apply(rows);
  expect(host.children.length).toBe(rows.length);
  expect(view.apply(stateView(trace, { all: true }).rest)).toEqual({
    added: 0,
    removed: 0,
    updated: 0,
    moved: 0,
  });
});
