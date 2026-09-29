/**
 * Write the game window's dialogs out of RAVENRES.DLL as TypeScript.
 *
 *   npx tsx jumpraven/tools/dialogs.ts          (from the repository root)
 *
 * RAVEN.EXE opens them with `DialogBoxParamA(<ravenres.dll>, "dlog<n>")`: the
 * high score's name (dlog2), Settings ▸ Keys (dlog3, 0x422950), the Quit
 * question (dlog6, 0x422bda), Pause (dlog7, 0x422c76) and Sound (dlog8,
 * 0x422ce1). They are ordinary RT_DIALOG resources, read by
 * `tools/rtdialog.ts`; this picks those and emits them in the shape
 * `engine/src/web/window-dialog.ts` draws. (DLOG1, Message, and PROGRESS, the
 * mazes' copy, are left: Help ▸ Memory is a MessageBox, and nothing is copied.)
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readDialogs, type RawControl } from "../../tools/rtdialog";

const HERE = dirname(fileURLToPath(import.meta.url));
const DLL = join(HERE, "..", "gamefiles", "RAVEN", "RAVEN", "RAVENRES.DLL");
const OUT = join(HERE, "..", "src", "dialogs.gen.ts");
const WANT: Record<string, string> = { DLOG2: "HIGH_SCORE", DLOG3: "EDIT_KEYS", DLOG6: "QUIT", DLOG7: "PAUSE", DLOG8: "SOUND" };

const BS_DEFPUSHBUTTON = 1;
const BS_AUTOCHECKBOX = 3;
const BS_AUTORADIOBUTTON = 9;
const SS_CENTER = 1;
const control = (c: RawControl): string => {
  if (c.cls !== "button" && c.cls !== "edit" && c.cls !== "static") throw new Error(`a ${c.cls} control, which the dialog does not draw`);
  const style = c.style & 0xf;
  const kind = c.cls === "button" && style === BS_AUTORADIOBUTTON ? "radio" : c.cls === "button" && style === BS_AUTOCHECKBOX ? "check" : c.cls;
  const flags = [
    c.cls === "button" && (c.style & 0xf) === BS_DEFPUSHBUTTON && "default: true",
    c.cls === "static" && (c.style & 0xf) === SS_CENTER && "center: true",
  ].filter(Boolean);
  return `    { id: ${c.id}, kind: "${kind}", text: ${JSON.stringify(c.text)}, x: ${c.x}, y: ${c.y}, w: ${c.w}, h: ${c.h}${flags.map((f) => `, ${f}`).join("")} },`;
};

const dialogs = readDialogs(DLL).filter((d) => d.name in WANT);
if (dialogs.length !== Object.keys(WANT).length) throw new Error(`${DLL}: expected ${Object.keys(WANT).join(", ")}`);
for (const d of dialogs) if (d.font) throw new Error(`${d.name} has a font of its own; the page draws the system font's units`);

const out = `/**
 * RAVEN.EXE's dialogs — GENERATED, do not edit.
 *
 * Regenerate with \`npx tsx jumpraven/tools/dialogs.ts\`: the RT_DIALOG resources
 * ${dialogs.map((d) => d.name).join(", ")} of gamefiles/RAVEN/RAVEN/RAVENRES.DLL, in dialog units of the
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
