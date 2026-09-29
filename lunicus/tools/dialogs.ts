/**
 * Write the game window's dialogs out of LUNIRES.DLL as TypeScript.
 *
 *   npx tsx lunicus/tools/dialogs.ts          (from the repository root)
 *
 * LUNICUS.EXE opens them with `DialogBoxParamA(<lunires.dll>, "dlog<n>")`: the
 * high score's name (dlog2, 0x4189c1) and Settings ▸ Keys (dlog3, 0x418b50).
 * They are ordinary RT_DIALOG resources, read by `tools/rtdialog.ts`; this picks
 * those two and emits them in the shape `engine/src/web/window-dialog.ts`
 * draws. (The DLL has more — Message, Quit, Pause, Sound, Progress — which no
 * code in the EXE opens.)
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readDialogs, type RawControl } from "../../tools/rtdialog";

const HERE = dirname(fileURLToPath(import.meta.url));
const DLL = join(HERE, "..", "gamefiles", "LUNICUS", "lunicus", "lunires.dll");
const OUT = join(HERE, "..", "src", "dialogs.gen.ts");
const WANT: Record<string, string> = { DLOG2: "HIGH_SCORE", DLOG3: "EDIT_KEYS" };

const BS_DEFPUSHBUTTON = 1;
const SS_CENTER = 1;
const control = (c: RawControl): string => {
  if (c.cls !== "button" && c.cls !== "edit" && c.cls !== "static") throw new Error(`a ${c.cls} control, which the dialog does not draw`);
  const flags = [
    c.cls === "button" && (c.style & 0xf) === BS_DEFPUSHBUTTON && "default: true",
    c.cls === "static" && (c.style & 0xf) === SS_CENTER && "center: true",
  ].filter(Boolean);
  return `    { id: ${c.id}, kind: "${c.cls}", text: ${JSON.stringify(c.text)}, x: ${c.x}, y: ${c.y}, w: ${c.w}, h: ${c.h}${flags.map((f) => `, ${f}`).join("")} },`;
};

const dialogs = readDialogs(DLL).filter((d) => d.name in WANT);
if (dialogs.length !== Object.keys(WANT).length) throw new Error(`${DLL}: expected ${Object.keys(WANT).join(", ")}`);
for (const d of dialogs) if (d.font) throw new Error(`${d.name} has a font of its own; the page draws the system font's units`);

const out = `/**
 * LUNICUS.EXE's dialogs — GENERATED, do not edit.
 *
 * Regenerate with \`npx tsx lunicus/tools/dialogs.ts\`: the RT_DIALOG resources
 * ${dialogs.map((d) => d.name).join(" and ")} of gamefiles/LUNICUS/lunicus/lunires.dll, in dialog units of the
 * system font (no DS_SETFONT). Each id is the control's Win32 id; what the
 * buttons do is src/dialogs.ts.
 */
import type { WindowDialogTemplate } from "@dreamfactory/engine/web/window-dialog";
${dialogs
  .map(
    (d) => `
/** ${d.name}, "${d.title}" */
export const ${WANT[d.name]}: WindowDialogTemplate = {
  title: ${JSON.stringify(d.title)},
  w: ${d.w},
  h: ${d.h},
  controls: [
${d.controls.map(control).join("\n")}
  ],
};`,
  )
  .join("\n")}
`;
writeFileSync(OUT, out);
console.log(`${OUT}: ${dialogs.map((d) => d.name).join(", ")} from ${DLL}`);
