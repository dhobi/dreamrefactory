/**
 * Write the game window's dialogs out of RAVENRES.DLL as TypeScript.
 *
 *   npx tsx jumpraven/tools/dialogs.ts          (from the repository root)
 *
 * RAVEN.EXE opens them with `DialogBoxParamA(<ravenres.dll>, "dlog<n>")`: the
 * high score's name (dlog2), Settings ▸ Keys (dlog3, 0x422950), the Quit
 * question (dlog6, 0x422bda), Pause (dlog7, 0x422c76) and Sound (dlog8,
 * 0x422ce1). They are ordinary RT_DIALOG resources, read and emitted by
 * `tools/rtdialog.ts`; this picks those and emits them in the shape
 * `engine/src/web/window-dialog.ts` draws. (DLOG1, Message, and PROGRESS, the
 * mazes' copy, are left: Help ▸ Memory is a MessageBox, and nothing is copied.)
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeDialogModule } from "../../tools/rtdialog";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
writeDialogModule(
  { exe: "RAVEN.EXE", dll: "jumpraven/gamefiles/RAVEN/RAVEN/RAVENRES.DLL", tool: "jumpraven/tools/dialogs.ts", want: { DLOG2: "HIGH_SCORE", DLOG3: "EDIT_KEYS", DLOG6: "QUIT", DLOG7: "PAUSE", DLOG8: "SOUND" } },
  ROOT,
  join(ROOT, "jumpraven", "src", "dialogs.gen.ts"),
);
