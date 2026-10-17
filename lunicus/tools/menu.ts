/**
 * Write the game window's menu bar out of LUNIRES.DLL as TypeScript.
 *
 *   npx tsx lunicus/tools/menu.ts            (from the repository root)
 *
 * LUNICUS.EXE loads it at 0x4186db — `LoadMenuA(<lunires.dll>, "MENUS")` — and
 * puts it on its window at 0x418758. It is an ordinary RT_MENU resource, read and emitted by
 * `tools/rtmenu.ts`; this only picks the one named MENUS and emits it in the
 * shape `engine/src/web/window-bar.ts` draws, each command keyed by its Win32 id.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeMenuModule } from "../../tools/rtmenu";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
writeMenuModule(
  { exe: "LUNICUS.EXE", dll: "lunicus/gamefiles/LUNICUS/lunicus/lunires.dll", tool: "lunicus/tools/menu.ts" },
  ROOT,
  join(ROOT, "lunicus", "src", "menu.gen.ts"),
);
