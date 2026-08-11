/**
 * Which keys belong to a focused control rather than to the game (src/keys.ts).
 *
 * The play page's shortcuts are LETTERS — M the map, O the hotspots, X the pane —
 * and every other character goes to the script chain, because TI.EXE hands scripts
 * their keys as literal characters. The page listens on `window`, so a text field
 * on the page and the game were hearing the same keystrokes: filtering the state
 * list for `mission` toggled the minimap on the M and the hotspot overlay on the O.
 */
import { test, expect } from "vitest";
import { parseHTML } from "linkedom";
import { focusOwnsKey } from "../../src/keys";

const { document } = parseHTML(`<!doctype html>
  <input id="filter" type="search">
  <input id="name" type="text">
  <input id="box" type="checkbox">
  <input id="radio" type="radio">
  <input id="bare">
  <textarea id="area"></textarea>
  <select id="pick"><option>a</option></select>
  <button id="btn">Fullscreen</button>
  <canvas id="screen"></canvas>
  <div id="plain"></div>`);

const el = (id: string): EventTarget => document.getElementById(id) as unknown as EventTarget;

test("a text field owns every key, so the game hears none of them", () => {
  for (const id of ["filter", "name", "bare", "area"]) {
    for (const key of ["m", "o", "x", "M", " ", "ArrowUp", "ArrowLeft", "Escape", "5"]) {
      expect(focusOwnsKey(el(id), key), `${id} should own ${JSON.stringify(key)}`).toBe(true);
    }
  }
});

test("the game's own keys still reach it from the canvas and the page", () => {
  for (const id of ["screen", "plain"]) {
    for (const key of ["m", "o", "x", " ", "ArrowUp", "Escape"]) {
      expect(focusOwnsKey(el(id), key), `${id} must not own ${JSON.stringify(key)}`).toBe(false);
    }
  }
  // and with nothing focused at all, which is the ordinary case
  expect(focusOwnsKey(null, "m")).toBe(false);
});

/**
 * A checkbox is the case that must NOT be a blanket guard. Clicking one focuses it,
 * so if it swallowed the arrows too, ticking "always land sharp" would leave the
 * player unable to walk until they clicked the canvas again.
 */
test("a checkbox owns only Space — the arrows still walk", () => {
  for (const id of ["box", "radio"]) {
    expect(focusOwnsKey(el(id), " "), "Space toggles the box").toBe(true);
    for (const key of ["m", "o", "x", "ArrowUp", "ArrowLeft", "ArrowRight", "Escape"]) {
      expect(focusOwnsKey(el(id), key), `${id} must not own ${key}`).toBe(false);
    }
  }
});

/**
 * SPACE is the game's door-opener, and it was taken on the way past: measured over
 * the Report button, Space then Enter gave 1 activation before this and 2 after, so
 * Space had never once pressed a button on this page.
 */
test("a button owns the two keys that press it", () => {
  expect(focusOwnsKey(el("btn"), " "), "Space presses a button").toBe(true);
  expect(focusOwnsKey(el("btn"), "Enter")).toBe(true);
  expect(focusOwnsKey(el("btn"), "m"), "…but M is still the map").toBe(false);
  expect(focusOwnsKey(el("btn"), "ArrowUp")).toBe(false);
});

test("a select owns its keys, arrows included", () => {
  for (const key of ["ArrowUp", "ArrowDown", " ", "m"]) {
    expect(focusOwnsKey(el("pick"), key)).toBe(true);
  }
});

test("an editable element owns everything, whatever it is made of", () => {
  const html = parseHTML(
    `<!doctype html><div id="rich" contenteditable="true"></div><div id="dead"></div>`,
  ).document;
  const rich = html.getElementById("rich") as unknown as EventTarget;
  const dead = html.getElementById("dead") as unknown as EventTarget;
  for (const key of ["m", "o", "x", " ", "ArrowUp"]) {
    expect(focusOwnsKey(rich, key), `a contenteditable div owns ${JSON.stringify(key)}`).toBe(true);
    expect(focusOwnsKey(dead, key), "…and a plain one owns nothing").toBe(false);
  }
});

/**
 * The box this exists for, spelled as the page spells it so a rename cannot quietly
 * drop it out of the guard. `type="search"` rather than `text` is the detail that
 * matters: an input type this predicate does not know about falls through to the
 * game, which is how the bug would come back.
 *
 * The save-name box is NOT here, and was never broken: the save browser stops the
 * event at its modal (src/save-browser.ts). Same fix, one container.
 */
test("the state list's own filter box is covered", () => {
  const html = parseHTML(`<!doctype html><input id="dbgFilter" type="search">`).document;
  const box = html.getElementById("dbgFilter") as unknown as EventTarget;
  for (const key of ["m", "o", "x", "M", "O", "X"]) {
    expect(focusOwnsKey(box, key), `the filter keeps its ${key}`).toBe(true);
  }
});
