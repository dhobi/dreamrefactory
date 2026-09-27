/**
 * RedJack's saved games on the page: the kind of file the shared dialog keeps
 * (engine/src/web/save-store.ts), and the seven saves in `gamefiles/save/`
 * put into its list once.
 *
 * Those seven are the port's, one at the start of each day, written by
 * `tools/mksaves.mts` while the machine suites play the game through. No save
 * made by the original is available yet, so they sit in a folder of their own
 * that says so, apart from the player's.
 */
import { isSaveV5 } from "@dreamfactory/engine/df/savegame-v5";
import { SaveKind, getMeta, putSave, setMeta } from "@dreamfactory/engine/web/save-store";

const DAYS = "days";

export const REDJACK_SAVES: SaveKind = {
  db: "redjack-saves",
  ext: ".save",
  game: "RedJack",
  folders: {
    "": "My Saves",
    [DAYS]: "The seven days (made by this port)",
  },
  order: ["", DAYS],
  valid: (bytes) => isSaveV5(bytes),
};

const SEEDED = "seededDays";

/**
 * Put `day1.save` … `day7.save` into the store, each once. `urlOf` is the
 * page's file index, which already serves everything under `gamefiles/`.
 * Answers how many were stored this time.
 */
export async function seedRedJackSaves(urlOf: (name: string) => string | null): Promise<number> {
  const seen = new Set((await getMeta<string[]>(SEEDED)) ?? []);
  let stored = 0;
  for (let day = 1; day <= 7; day++) {
    const base = `day${day}.save`;
    const rel = `${DAYS}/${base}`;
    const url = urlOf(base);
    if (!url || seen.has(rel)) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!REDJACK_SAVES.valid(bytes)) continue;
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
