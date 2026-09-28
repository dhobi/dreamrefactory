/**
 * The dialog boxes a Win32 executable carries, read out of its resources.
 *
 *   npx tsx tools/rtdialog.ts <exe-or-dll>      prints every dialog it finds
 *
 * A dialog is an `RT_DIALOG` resource (type 5) in the classic DLGTEMPLATE
 * format — not DLGTEMPLATEEX, which starts with the signature 0xffff:
 *
 *   DLGTEMPLATE   { u32 style, u32 exStyle, u16 count, i16 x, y, cx, cy }
 *                 then three sz_Or_Ord (menu, class, title) and, with DS_SETFONT
 *                 (0x40), u16 point size and a font name
 *   per control   DWORD-aligned { u32 style, u32 exStyle, i16 x, y, cx, cy,
 *                 u16 id } then class and text as sz_Or_Ord, u16 extra bytes
 *
 * A sz_Or_Ord is 0 (none), 0xffff then a u16 ordinal, or a NUL-ended UTF-16
 * string. The predefined classes' ordinals are 0x80 button, 0x81 edit, 0x82
 * static, 0x83 listbox, 0x84 scrollbar and 0x85 combobox. Positions and sizes
 * are dialog units, which the dialog's font turns into pixels.
 */
import { fileURLToPath } from "node:url";
import { readResources } from "./peres";

const RT_DIALOG = 5;
const DS_SETFONT = 0x40;
const CLASSES: Record<number, string> = { 0x80: "button", 0x81: "edit", 0x82: "static", 0x83: "listbox", 0x84: "scrollbar", 0x85: "combobox" };

export interface RawControl {
  id: number;
  /** a predefined class by name (`button`, `edit`, `static`, …) or the class's own */
  cls: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  style: number;
}

export interface RawDialog {
  /** the resource's name, or its number as a string */
  name: string;
  style: number;
  /** -32768 (CW_USEDEFAULT) for "where the program puts it" */
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  /** DS_SETFONT's font, if it names one; without it the dialog is in the system font */
  font: { points: number; face: string } | null;
  controls: RawControl[];
}

/** every RT_DIALOG resource in the file, parsed */
export function readDialogs(path: string): RawDialog[] {
  return readResources(path, RT_DIALOG).map((r) => ({ name: r.name, ...parseDialog(r.bytes, `${path}: ${r.name}`) }));
}

function parseDialog(bytes: Uint8Array, what: string): Omit<RawDialog, "name"> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const u16 = (): number => ((p += 2), v.getUint16(p - 2, true));
  const i16 = (): number => ((p += 2), v.getInt16(p - 2, true));
  const u32 = (): number => ((p += 4), v.getUint32(p - 4, true));
  /** a sz_Or_Ord: the ordinal as `#n`, or the string */
  const szOrOrd = (): string | number => {
    if (v.getUint16(p, true) === 0xffff) return (p += 2), u16();
    let s = "";
    for (let c = u16(); c; c = u16()) s += String.fromCharCode(c);
    return s;
  };
  if (v.getUint16(2, true) === 0xffff) throw new Error(`${what}: a DLGTEMPLATEEX, which this does not read`);
  const style = u32();
  u32(); // exStyle
  const count = u16();
  const [x, y, w, h] = [i16(), i16(), i16(), i16()];
  szOrOrd(); // menu
  szOrOrd(); // class
  const title = String(szOrOrd());
  let font: RawDialog["font"] = null;
  if (style & DS_SETFONT) {
    const points = u16();
    font = { points, face: String(szOrOrd()) };
  }
  const controls: RawControl[] = [];
  for (let i = 0; i < count; i++) {
    p = (p + 3) & ~3;
    const cstyle = u32();
    u32(); // exStyle
    const [cx, cy, cw, ch] = [i16(), i16(), i16(), i16()];
    const id = u16();
    const cls = szOrOrd();
    const text = szOrOrd();
    // the creation data's size; a linker may leave the last control's off the end
    if (p + 2 <= bytes.length) {
      const extra = u16();
      p += extra;
    }
    controls.push({
      id,
      cls: typeof cls === "number" ? (CLASSES[cls] ?? `#${cls}`) : cls,
      text: typeof text === "number" ? `#${text}` : text,
      x: cx,
      y: cy,
      w: cw,
      h: ch,
      style: cstyle,
    });
  }
  return { style, x, y, w, h, title, font, controls };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (!path) throw new Error("usage: npx tsx tools/rtdialog.ts <exe-or-dll>");
  const dialogs = readDialogs(path);
  if (!dialogs.length) console.log(`${path}: no RT_DIALOG resource`);
  for (const d of dialogs) {
    const font = d.font ? `${d.font.points}pt ${d.font.face}` : "system font";
    console.log(`${d.name} ${JSON.stringify(d.title)} ${d.w}x${d.h} dialog units, ${font}`);
    for (const c of d.controls) console.log(`  ${c.cls} #${c.id} ${JSON.stringify(c.text)} at ${c.x},${c.y} ${c.w}x${c.h} style ${c.style.toString(16)}`);
  }
}
