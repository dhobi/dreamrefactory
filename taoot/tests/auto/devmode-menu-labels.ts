/**
 * TI.EXE's developer menu as data (`src/devmode/menu.ts`) on labels the
 * shipped resource does not carry: an `&` with nothing after it, a rule between
 * commands, a command with no accelerator.
 *
 *   npx vitest run taoot/tests/auto/devmode-menu-labels.ts
 *
 * The menu bar the page draws is built from these three readings, so a label
 * the resource could have held and does not — a trailing `&`, an item with no
 * `\tCtrl+X` — must still read as words, no access key and no accelerator,
 * and a rule must be no command at all.
 */
import { expect, test } from "vitest";
import { accelerators, commands, parseLabel, type DevMenu } from "../../src/devmode/menu";

test("an & at the very end marks no access key, and is not part of the words", () => {
  expect(parseLabel("Save&")).toEqual({ text: "Save", accessKey: "", hint: "" });
  expect(parseLabel("&Load\tCtrl+L")).toEqual({ text: "Load", accessKey: "l", hint: "Ctrl+L" });
  expect(parseLabel("Plain")).toEqual({ text: "Plain", accessKey: "", hint: "" });
});

test("a rule is no command, and a command with no hint has no accelerator", () => {
  const menus: DevMenu[] = [
    {
      label: "&Test",
      items: [
        { label: "&One\tCtrl+1", id: 1, select: "one" },
        { separator: true },
        { label: "&Two", id: 2, select: "two" },
      ],
    },
  ];
  expect(commands(menus)).toEqual([
    { menu: "Test", label: "&One\tCtrl+1", id: 1, select: "one" },
    { menu: "Test", label: "&Two", id: 2, select: "two" },
  ]);
  expect([...accelerators(menus)]).toEqual([["ctrl+1", "one"]]);
});
