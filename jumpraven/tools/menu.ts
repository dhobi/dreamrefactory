/**
 * Write the game window's menu bar out of RAVENRES.DLL as TypeScript.
 *
 *   npx tsx jumpraven/tools/menu.ts            (from the repository root)
 *
 * RAVEN.EXE loads it at 0x4224df — `LoadMenuA(<ravenres.dll>, "MENUS")` — and
 * puts it on its window at 0x422558. It is an ordinary RT_MENU resource, read by
 * `tools/rtmenu.ts`; this only picks the one named MENUS and emits it in the
 * shape `engine/src/web/window-bar.ts` draws, each command keyed by its Win32 id.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readMenus, type RawItem } from "../../tools/rtmenu";

const HERE = dirname(fileURLToPath(import.meta.url));
const DLL = join(HERE, "..", "gamefiles", "RAVEN", "RAVEN", "RAVENRES.DLL");
const OUT = join(HERE, "..", "src", "menu.gen.ts");

const menu = readMenus(DLL).find((m) => m.name === "MENUS");
if (!menu) throw new Error(`${DLL}: no RT_MENU named MENUS`);

const esc = (s: string): string => JSON.stringify(s);
const entry = (it: RawItem): string => {
  if (it.separator) return `      { separator: true },`;
  const flags = [it.grayed && "disabled: true", it.checked && "checked: true"].filter(Boolean);
  return `      { id: ${esc(String(it.id))}, label: ${esc(it.label)}${flags.map((f) => `, ${f}`).join("")} },`;
};

const out = `/**
 * RAVEN.EXE's menu bar — GENERATED, do not edit.
 *
 * Regenerate with \`npx tsx jumpraven/tools/menu.ts\`: the RT_MENU resource ${menu.name} of
 * gamefiles/RAVEN/RAVEN/RAVENRES.DLL. Each id is the command's Win32 id; the
 * disabled ones are the ones the resource greys. What each does is src/menu.ts.
 */
import type { WindowMenu } from "@dreamfactory/engine/web/window-bar";

export const MENUS: readonly WindowMenu[] = [
${menu.items
  .map((top) => `  {\n    label: ${esc(top.label)},\n    items: [\n${top.children.map(entry).join("\n")}\n    ],\n  },`)
  .join("\n")}
];
`;
writeFileSync(OUT, out);
console.log(`${OUT}: ${menu.items.length} menus, from ${menu.name} in ${DLL}`);
