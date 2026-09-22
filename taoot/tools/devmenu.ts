/**
 * Extract TI.EXE's developer menu bar and emit it as TypeScript.
 *
 *   npx tsx taoot/tools/devmenu.ts
 *
 * `menuvisible (debugging)` is the second line of BOOTFILE's `boot()`, and in a
 * build where `debugging` was true it put a menu bar on the screen. The items it
 * carried are NOT in the game data: the corpus has no menu-defining command at
 * all — no `newmenu`, no `menuitem`, nothing — and a script only ever hears about
 * the menu when the engine calls `menuselect (name)` afterwards. So the menu
 * lived in the executable, and this reads it back out of there.
 *
 * It is a standard Win32 `RT_MENU` resource (type 4 in the PE resource tree), and
 * the format is the old MENUITEMTEMPLATE one:
 *
 *   MENUHEADER          { u16 version = 0, u16 headerSize = 0 }
 *   MENUITEMTEMPLATE[]  { u16 flags, [u16 id unless MF_POPUP], wchar text[] }
 *
 * with MF_POPUP (0x10) opening a submenu, MF_END (0x80) closing the current
 * level, and MF_SEPARATOR (0x800) meaning a rule with no text.
 *
 * ## Why the label decides the script name
 *
 * BOOTFILE's `menuselect` switches on lowercase names — "debug on/off", "painting
 * scripts", "volume 0" — and the engine derives them from the item's own label by
 * dropping the `&` accelerator marks and everything from the tab onward. That rule
 * is asserted rather than assumed: `taoot/tests/auto/devmode.ts` checks every name
 * this emits against the cases BOOTFILE actually has.
 */
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gameExePath } from "./gamefiles";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "devmode", "menu.gen.ts");

const RT_MENU = 4;
const MF_POPUP = 0x0010;
const MF_END = 0x0080;
const MF_SEPARATOR = 0x0800;

const exe = gameExePath();
const data = new Uint8Array(readFileSync(exe));
const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

// ---- the PE section table, so a resource RVA can be turned into a file offset ----
const peOff = view.getUint32(0x3c, true);
const numSections = view.getUint16(peOff + 6, true);
const optSize = view.getUint16(peOff + 20, true);
const secTable = peOff + 24 + optSize;
interface Sec { name: string; va: number; vsize: number; raw: number; rawSize: number }
const sections: Sec[] = [];
for (let i = 0; i < numSections; i++) {
  const o = secTable + i * 40;
  let name = "";
  for (let c = 0; c < 8 && data[o + c]; c++) name += String.fromCharCode(data[o + c]);
  sections.push({
    name,
    vsize: view.getUint32(o + 8, true),
    va: view.getUint32(o + 12, true),
    rawSize: view.getUint32(o + 16, true),
    raw: view.getUint32(o + 20, true),
  });
}
/**
 * Strictly bounded, both ways.
 *
 * A sloppy version of this — "the first section whose start is below the RVA,
 * plus a bit of slack" — reads whatever happens to sit at that file offset and
 * reports it as data, which is a fault that looks like a decoding bug for as long
 * as you care to look at the decoder. So an RVA must be inside the section's
 * VIRTUAL size and inside what the file actually stores for it.
 */
const rvaToFile = (rva: number): number | null => {
  for (const s of sections) {
    if (rva >= s.va && rva < s.va + s.vsize && rva - s.va < s.rawSize) return s.raw + (rva - s.va);
  }
  return null;
};

const rsrc = sections.find((s) => s.name === ".rsrc");
if (!rsrc) throw new Error(`${exe}: no .rsrc section`);
const rsrcFile = rsrc.raw;

// ---- walk the three-level resource tree: type -> name -> language ----
interface ResEntry { id: number; offset: number; isDir: boolean }
function dirEntries(at: number): ResEntry[] {
  const named = view.getUint16(rsrcFile + at + 12, true);
  const ided = view.getUint16(rsrcFile + at + 14, true);
  const out: ResEntry[] = [];
  for (let i = 0; i < named + ided; i++) {
    const e = rsrcFile + at + 16 + i * 8;
    const name = view.getUint32(e, true);
    const off = view.getUint32(e + 4, true);
    out.push({ id: name & 0x7fffffff, offset: off & 0x7fffffff, isDir: (off & 0x80000000) !== 0 });
  }
  return out;
}

const menuType = dirEntries(0).find((e) => e.id === RT_MENU && e.isDir);
if (!menuType) throw new Error(`${exe}: no RT_MENU resource`);

/** every MENU resource in the file, as { id, bytes } */
const menus: { id: number; bytes: Uint8Array }[] = [];
for (const named of dirEntries(menuType.offset)) {
  if (!named.isDir) continue;
  for (const lang of dirEntries(named.offset)) {
    if (lang.isDir) continue;
    const dataRva = view.getUint32(rsrcFile + lang.offset, true);
    const size = view.getUint32(rsrcFile + lang.offset + 4, true);
    const at = rvaToFile(dataRva);
    if (at === null) continue;
    menus.push({ id: named.id, bytes: data.subarray(at, at + size) });
  }
}
if (!menus.length) throw new Error(`${exe}: RT_MENU directory is empty`);

// ---- the MENUITEMTEMPLATE walk ----
export interface RawItem {
  /** the label as the resource stores it, `&` marks and accelerator and all */
  label: string;
  /** the command id, or -1 for a popup or a separator */
  id: number;
  separator: boolean;
  children: RawItem[];
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
      const item: RawItem = {
        label,
        id,
        separator: (flags & MF_SEPARATOR) !== 0 || (label === "" && !(flags & MF_POPUP)),
        children: flags & MF_POPUP ? level() : [],
      };
      out.push(item);
      if (flags & MF_END) return out;
    }
  };
  return level();
}

/**
 * The label, as `menuselect` hears it.
 *
 * `&` marks the keyboard accelerator and is not part of the name; everything from
 * the tab onward is the shortcut hint ("\tCtrl+D") and is not either. What is
 * left, lowercased, is the string BOOTFILE's switch compares against.
 */
const selectName = (label: string): string =>
  label.split("\t")[0].replace(/&/g, "").trim().toLowerCase();

// The game's menu is the one with items the BOOTFILE knows: pick by content
// rather than by resource id, so a rebuilt exe with a renumbered resource still
// resolves. (There is exactly one in this build, and the test says so.)
const isGameMenu = (items: RawItem[]): boolean =>
  items.some((t) => t.children.some((c) => selectName(c.label) === "debug on/off"));
const menu = menus.find((m) => isGameMenu(parseMenu(m.bytes)));
if (!menu) throw new Error(`${exe}: no RT_MENU carries a "Debug On/Off" item`);
const tree = parseMenu(menu.bytes);

// ---- emit ----
const esc = (s: string): string => JSON.stringify(s);
const lines: string[] = [];
let items = 0;
for (const top of tree) {
  lines.push(`  {`);
  lines.push(`    label: ${esc(top.label)},`);
  lines.push(`    items: [`);
  for (const it of top.children) {
    if (it.separator) {
      lines.push(`      { separator: true },`);
    } else {
      items++;
      lines.push(
        `      { label: ${esc(it.label)}, id: ${it.id}, select: ${esc(selectName(it.label))} },`,
      );
    }
  }
  lines.push(`    ],`);
  lines.push(`  },`);
}

const out = `/**
 * TI.EXE's developer menu bar — GENERATED, do not edit.
 *
 * Regenerate with \`npx tsx taoot/tools/devmenu.ts\`, which reads the RT_MENU
 * resource out of the executable and explains the format. What it is FOR is in
 * \`taoot/src/devmode/menu.ts\` beside this.
 *
 * Read from resource ${menu.id} of ${exe.replace(/^.*gamefiles\//, "gamefiles/")}.
 */

/** one command on a menu, or a rule between two of them */
export type DevMenuEntry =
  | { separator: true }
  | {
      /** the label as TI.EXE stores it — \`&\` accelerator marks and \`\\tCtrl+X\` hint */
      label: string;
      /** the Win32 command id the resource gives it */
      id: number;
      /** the name BOOTFILE's \`menuselect\` switches on */
      select: string;
      separator?: false;
    };

/** one title on the bar, and what drops down from it */
export interface DevMenu {
  label: string;
  items: DevMenuEntry[];
}

export const DEV_MENU: readonly DevMenu[] = [
${lines.join("\n")}
];
`;

writeFileSync(OUT, out);
console.log(
  `${OUT}: ${tree.length} menus, ${items} commands, from resource ${menu.id} of ${exe}`,
);
