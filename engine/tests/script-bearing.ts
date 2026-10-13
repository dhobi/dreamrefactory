/**
 * The tools' one list of script-bearing files knows every engine's spelling —
 * RedJack's four-letter extensions and `bootfile.boot` included, which
 * `tools/parse.ts` read as no scripts at all.
 */
import { test, expect } from "vitest";
import { carriesScript } from "../../tools/script-bearing";

test("every engine's script-bearing names, and nothing else", () => {
  for (const name of ["TOWN.SET", "NEW.FLT", "HOUSE.PRP", "INTRO.MOV", "BOOTFILE", "c59.stg", "gang.cst"]) {
    expect(carriesScript(name), name).toBe(true);
  }
  for (const name of ["jail1.sett", "sCombat.shop", "intro.stag", "Hag.pupp", "rj01.move", "gang.cast", "bootfile.boot"]) {
    expect(carriesScript(name), name).toBe(true);
  }
  for (const name of ["TOWN.SND", "music.trak", "DF.EXE", "game.save", "bootfile.txt", "settings.ini", "x.settx"]) {
    expect(carriesScript(name), name).toBe(false);
  }
});
