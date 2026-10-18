/**
 * The menu bars a Win32 executable carries, read out of its resources.
 *
 *   npx tsx tools/rtmenu.ts <exe-or-dll>        prints every menu it finds
 *
 * A game's menu bar is a standard `RT_MENU` resource (type 4 in the PE resource
 * tree), in the old MENUITEMTEMPLATE format:
 *
 *   MENUHEADER          { u16 version = 0, u16 headerSize = 0 }
 *   MENUITEMTEMPLATE[]  { u16 flags, [u16 id unless MF_POPUP], wchar text[] }
 *
 * with MF_POPUP (0x10) opening a submenu, MF_END (0x80) closing the current
 * level, MF_GRAYED (0x01) / MF_CHECKED (0x08) the item's first state, and
 * MF_SEPARATOR (0x800) a rule with no text.
 *
 * Used by `taoot/tools/devmenu.ts` (TI.EXE's developer menu), and by
 * `lunicus/tools/menu.ts` and `jumpraven/tools/menu.ts` through
 * {@link writeMenuModule}.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readResources } from "./peres";

const RT_MENU = 4;
const MF_GRAYED = 0x0001;
const MF_CHECKED = 0x0008;
const MF_POPUP = 0x0010;
const MF_END = 0x0080;
const MF_SEPARATOR = 0x0800;

export interface RawItem {
  /** the label as the resource stores it, `&` marks and `\t` hint and all */
  label: string;
  /** the command id, or -1 for a popup or a separator */
  id: number;
  separator: boolean;
  grayed: boolean;
  checked: boolean;
  children: RawItem[];
}

export interface RawMenu {
  /** the resource's name, or its number as a string */
  name: string;
  items: RawItem[];
}

/** every RT_MENU resource in the file, parsed; empty when it has none */
export function readMenus(path: string): RawMenu[] {
  return readResources(path, RT_MENU).map((r) => ({ name: r.name, items: parseMenu(r.bytes) }));
}

function parseMenu(bytes: Uint8Array): RawItem[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // MENUHEADER: version and header size, both 0 in every normal menu
  let p = 4;
  const level = (): RawItem[] => {
    const out: RawItem[] = [];
    for (;;) {
      if (p + 2 > bytes.length) return out;
      const flags = v.getUint16(p, true);
      p += 2;
      let id = -1;
      if (!(flags & MF_POPUP)) {
        id = v.getUint16(p, true);
        p += 2;
      }
      let label = "";
      for (;;) {
        if (p + 2 > bytes.length) break;
        const ch = v.getUint16(p, true);
        p += 2;
        if (ch === 0) break;
        label += String.fromCharCode(ch);
      }
      out.push({
        label,
        id,
        separator: (flags & MF_SEPARATOR) !== 0 || (label === "" && !(flags & MF_POPUP)),
        grayed: (flags & MF_GRAYED) !== 0,
        checked: (flags & MF_CHECKED) !== 0,
        children: flags & MF_POPUP ? level() : [],
      });
      if (flags & MF_END) return out;
    }
  };
  return level();
}

/** where a game's generated menu bar comes from, and what to call it in its header */
export interface MenuSource {
  /** the executable whose bar it is, e.g. "LUNICUS.EXE" */
  exe: string;
  /** the resource DLL, from the repository root */
  dll: string;
  /** the tool that regenerates it, from the repository root */
  tool: string;
}

/**
 * A DreamFactory 0 game's menu bar as a TypeScript module: the RT_MENU called
 * MENUS, in the shape `engine/src/web/window-bar.ts` draws, each command keyed by
 * its Win32 id. Written to `out`; used by lunicus/ and jumpraven/tools/menu.ts.
 */
export function writeMenuModule({ exe, dll, tool }: MenuSource, root: string, out: string): void {
  const path = join(root, dll);
  const menu = readMenus(path).find((m) => m.name === "MENUS");
  if (!menu) throw new Error(`${path}: no RT_MENU named MENUS`);
  const esc = (s: string): string => JSON.stringify(s);
  const entry = (it: RawItem): string => {
    if (it.separator) return `      { separator: true },`;
    const flags = [it.grayed && "disabled: true", it.checked && "checked: true"].filter(Boolean);
    const tail = flags.map((f) => ", " + f).join("");
    return `      { id: ${esc(String(it.id))}, label: ${esc(it.label)}${tail} },`;
  };
  writeFileSync(
    out,
    `/**
 * ${exe}'s menu bar — GENERATED, do not edit.
 *
 * Regenerate with \`npx tsx ${tool}\`: the RT_MENU resource ${menu.name} of
 * ${dll}. Each id is the command's Win32 id; the
 * disabled ones are the ones the resource greys. What each does is src/menu.ts.
 */
import type { WindowMenu } from "@dreamfactory/engine/web/window-bar";

export const MENUS: readonly WindowMenu[] = [
${menu.items
  .map((top) => `  {\n    label: ${esc(top.label)},\n    items: [\n${top.children.map(entry).join("\n")}\n    ],\n  },`)
  .join("\n")}
];
`,
  );
  console.log(`${out}: ${menu.items.length} menus, from ${menu.name} in ${path}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (!path) throw new Error("usage: npx tsx tools/rtmenu.ts <exe-or-dll>");
  const show = (items: RawItem[], depth: number): void => {
    for (const it of items) {
      const flags = [it.grayed && "grayed", it.checked && "checked"].filter(Boolean).join(" ");
      const text = it.separator ? "----" : JSON.stringify(it.label);
      console.log(`${"  ".repeat(depth)}${text}${it.id >= 0 ? ` #${it.id}` : ""}${flags ? ` (${flags})` : ""}`);
      show(it.children, depth + 1);
    }
  };
  const menus = readMenus(path);
  if (!menus.length) console.log(`${path}: no RT_MENU resource`);
  for (const m of menus) {
    console.log(`resource ${m.name}`);
    show(m.items, 1);
  }
}
