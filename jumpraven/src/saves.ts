/**
 * Jump Raven's saved games on the page: the kind of file the shared dialog
 * keeps (engine/src/web/save-store.ts). "Jump Raven (.RVN)", the EXE's own
 * dialogs say (0x4225b3, 0x4226ef).
 */
import type { SaveKind } from "@dreamfactory/engine/web/save-store";
import { isRvn } from "./game/rvn";

export const JUMPRAVEN_SAVES: SaveKind = {
  db: "jumpraven-saves",
  ext: ".rvn",
  game: "Jump Raven",
  folders: { "": "My Saves" },
  order: [""],
  valid: (bytes) => isRvn(bytes),
};
