/**
 * A Dust save names the prop and cast files it had open by the name the SCRIPT
 * opened them with (engine/src/df/savegame-v1.ts, withExtension).
 *
 *   npx vitest run dust/tests/save-file-names.ts
 *
 * Every room opens its shop by its bare name (`openshopfile ("house")`) except
 * HUB.SET, whose openset says `openshopfile ("hub.prp")` — so the three shipped
 * saves taken in the hub list "hub.prp", and the reader made that "hub.prp.prp".
 * A load then reopened no hub shop, and the hub's openscene, which shows the
 * season props (`propview ("autumn1", "fade")`), met error 0xa — "No such
 * object" — where DF.EXE finds the shop the save names.
 */
import { test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSaveV1 } from "@dreamfactory/engine/df/savegame-v1";

const SAVE_DIR = fileURLToPath(new URL("../gamefiles/save", import.meta.url));
const HUB_SAVES = ["D4MINES.RTD", "MSKPZL.RTD", "ENDPZL.RTD"];
const have = HUB_SAVES.every((f) => existsSync(`${SAVE_DIR}/${f}`));
if (!have) console.warn(`no ${SAVE_DIR} hub saves — skipping (needs the Dust rip)`);

test.skipIf(!have)("a save taken in the hub reopens hub.prp, not hub.prp.prp", () => {
  for (const f of HUB_SAVES) {
    const save = parseSaveV1(new Uint8Array(readFileSync(`${SAVE_DIR}/${f}`)));
    expect(save.propFiles, f).toContain("hub.prp");
    expect(save.propFiles.some((n) => /\.prp\.prp$/.test(n)), f).toBe(false);
    // the bare names still get theirs
    expect(save.propFiles, f).toContain("house.prp");
  }
});
