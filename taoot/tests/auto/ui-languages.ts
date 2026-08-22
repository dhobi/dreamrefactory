/**
 * The chrome's six languages and this game's six editions are the same six.
 *
 *   npx vitest run taoot/tests/auto/ui-languages.ts
 *
 * They are two different facts that happen to agree, and the agreement is worth
 * a test precisely BECAUSE it is a coincidence rather than a constraint. The
 * chrome is translated into six languages because the game shipped in six; if
 * Dust ever ships a seventh, or a chrome translation is added ahead of a data
 * tree, this fails and says which side moved instead of letting a language
 * chooser offer a page nobody wrote or a page offer data nobody has.
 *
 * The direction of the import is the point too: a GAME may read the shared site
 * package, and this is the only place that comparison can live without pointing
 * an edge the wrong way. `site/tests/locales.ts` therefore checks the catalogues
 * against themselves and says nothing about any game.
 */
import { test, expect } from "vitest";
import { UI_LANGUAGES, DEFAULT_UI_LANGUAGE } from "@dreamfactory/site/ui-languages";
import { LANGUAGES, DEFAULT_LANGUAGE } from "../../src/languages";

test("the chrome is written in exactly the languages the game ships in", () => {
  expect(
    UI_LANGUAGES.map((l) => l.code).sort(),
    "site/src/ui-languages.ts and taoot/src/languages.ts disagree",
  ).toEqual(LANGUAGES.map((l) => l.code).sort());
});

test("and both call the same one the default", () => {
  expect(DEFAULT_UI_LANGUAGE).toBe(DEFAULT_LANGUAGE);
});

test("the endonym a menu shows is the endonym the chooser art is named for", () => {
  // `label` is the capitals-only pixel text drawn into lang.stg and may differ
  // (Russian, Japanese); `name` is the real endonym, and THAT is the pair which
  // has to match, because both sides show it to a reader in a real font.
  for (const l of LANGUAGES) {
    const ui = UI_LANGUAGES.find((u) => u.code === l.code);
    expect(ui?.name, `${l.code}: endonym`).toBe(l.name);
  }
});
