/**
 * Write the game window's menu bar out of RAVENRES.DLL as TypeScript.
 *
 *   npx tsx jumpraven/tools/menu.ts            (from the repository root)
 *
 * RAVEN.EXE loads it at 0x4224df — `LoadMenuA(<ravenres.dll>, "MENUS")` — and
 * puts it on its window at 0x422558. It is an ordinary RT_MENU resource, read and emitted by
 * `tools/rtmenu.ts`; this only picks the one named MENUS and emits it in the
 * shape `engine/src/web/window-bar.ts` draws, each command keyed by its Win32 id.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeMenuModule } from "../../tools/rtmenu";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
writeMenuModule(
  { exe: "RAVEN.EXE", dll: "jumpraven/gamefiles/RAVEN/RAVEN/RAVENRES.DLL", tool: "jumpraven/tools/menu.ts" },
  ROOT,
  join(ROOT, "jumpraven", "src", "menu.gen.ts"),
);
