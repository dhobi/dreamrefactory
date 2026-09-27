/**
 * Lunicus's saved games on the page: the kind of file the shared dialog keeps
 * (engine/src/web/save-store.ts), and the port's own saves in `gamefiles/save/`
 * — one at the start of each of days two to six, written by the machine route
 * (`SAVES=gamefiles/save npx tsx tests/machine/day6.ts`) — put into its list once.
 * No save made by the original is available, so they sit in a folder of their
 * own that says so, apart from the player's.
 */
import { isSaveV0 } from "@dreamfactory/engine/df/savegame-v0";
import { type SaveKind, getMeta, putSave, setMeta } from "@dreamfactory/engine/web/save-store";

const DAYS = "days";

export const LUNICUS_SAVES: SaveKind = {
  db: "lunicus-saves",
  // "Lunicus (.LUN)", the EXE's own dialog says (0x4187b3)
  ext: ".lun",
  game: "Lunicus",
  folders: {
    "": "My Saves",
    [DAYS]: "Days two to six (made by this port)",
  },
  order: ["", DAYS],
  valid: (bytes) => isSaveV0(bytes),
};

const SEEDED = "seededDays";

/** Put `day2.lun` … `day6.lun` into the store, each once; answers how many were stored this time */
export async function seedLunicusSaves(urlOf: (path: string) => string | null): Promise<number> {
  const seen = new Set((await getMeta<string[]>(SEEDED)) ?? []);
  let stored = 0;
  for (let day = 2; day <= 6; day++) {
    const base = `day${day}.lun`;
    const rel = `${DAYS}/${base}`;
    const url = urlOf(`save/${base}`);
    if (!url || seen.has(rel)) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!LUNICUS_SAVES.valid(bytes)) continue;
      await putSave({ path: rel, folder: DAYS, name: `Day ${day}`, bytes, builtin: true, mtime: Date.now() });
      seen.add(rel);
      stored++;
    } catch {
      /* a save that will not arrive or parse is not one to list */
    }
  }
  if (stored) await setMeta(SEEDED, [...seen]);
  return stored;
}
