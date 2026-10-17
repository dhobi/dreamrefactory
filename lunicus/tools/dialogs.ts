/**
 * Write the game window's dialogs out of LUNIRES.DLL as TypeScript.
 *
 *   npx tsx lunicus/tools/dialogs.ts          (from the repository root)
 *
 * LUNICUS.EXE opens them with `DialogBoxParamA(<lunires.dll>, "dlog<n>")`: the
 * high score's name (dlog2, 0x4189c1) and Settings ▸ Keys (dlog3, 0x418b50).
 * They are ordinary RT_DIALOG resources, read and emitted by `tools/rtdialog.ts`; this picks
 * those two and emits them in the shape `engine/src/web/window-dialog.ts`
 * draws. (The DLL has more — Message, Quit, Pause, Sound, Progress — which no
 * code in the EXE opens.)
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeDialogModule } from "../../tools/rtdialog";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
writeDialogModule(
  { exe: "LUNICUS.EXE", dll: "lunicus/gamefiles/LUNICUS/lunicus/lunires.dll", tool: "lunicus/tools/dialogs.ts", want: { DLOG2: "HIGH_SCORE", DLOG3: "EDIT_KEYS" } },
  ROOT,
  join(ROOT, "lunicus", "src", "dialogs.gen.ts"),
);
