/**
 * The front page credits the right studio for each game.
 *
 *   npx vitest run site/tests/front-doors.ts
 *
 * CyberFlix wrote the DreamFactory engine and made two of the three games on it.
 * *Timelapse* is GTE Interactive Media's, and for a long time nothing in this
 * project said so — the front page's lede came close to saying the opposite, and
 * this game's own documentation page opened with the words "CyberFlix, 1996".
 *
 * So the credit is now a field on the registry ({@link GameEditions.developer})
 * *and* a badge in the front page's markup, which is two statements of one fact.
 * The pages carry their own English inline on purpose — an English reader needs no
 * JavaScript, and `git diff` shows the sentence that changed — and the cost of
 * that decision is exactly this: a second copy, made safe only by a test that
 * fails when one of them moves. `site/tests/locales.ts` is the same bargain for
 * the translated strings.
 *
 * What it checks, and each is a way the two can drift apart:
 *
 *   - every game in the registry has a door, so adding a game to `GAMES` and
 *     forgetting the page is caught;
 *   - every door's `data-studio` is that game's `developer`, so a wrong or stale
 *     credit is caught;
 *   - the badge's visible TEXT is its own `data-studio`, so the attribute this
 *     test reads cannot agree with the registry while the reader sees something
 *     else.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GAMES } from "@dreamfactory/site/games";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const html = readFileSync(`${ROOT}/site/index.html`, "utf8");

/** one game door: the directory it points at, and the badge inside it */
interface Door {
  dir: string;
  studio: string | null;
  text: string | null;
}

/**
 * The doors, as authored. Deliberately not an HTML parser: the markup is written
 * by hand in one file and the shape being read is three attributes deep, so a
 * regex that fails loudly on a change is better than a dependency.
 */
function doorsIn(page: string): Door[] {
  const out: Door[] = [];
  const door = /<a class="door game" href="\.\/([a-z]+)\/">([\s\S]*?)<\/a>/g;
  for (const [, dir, body] of page.matchAll(door)) {
    const badge = /<span class="studio" data-studio="([^"]*)"[^>]*>([\s\S]*?)<\/span>/.exec(body);
    out.push({ dir, studio: badge?.[1] ?? null, text: badge?.[2]?.trim() ?? null });
  }
  return out;
}

test("the page has a door for every game, and only those", () => {
  const doors = doorsIn(html);
  expect(doors.length).toBeGreaterThan(2);
  expect(doors.map((d) => d.dir).sort()).toEqual(GAMES.map((g) => g.dir).sort());
});

test("every door credits the studio the registry names", () => {
  const doors = doorsIn(html);
  const wrong: string[] = [];
  for (const game of GAMES) {
    const door = doors.find((d) => d.dir === game.dir);
    if (!door) continue; // the test above says so
    if (door.studio !== game.developer) {
      wrong.push(`${game.dir}: the page says ${door.studio ?? "(no badge)"}, the registry says ${game.developer}`);
    }
  }
  expect(
    wrong,
    wrong.length
      ? `The front page and site/src/games.ts disagree about who made a game:\n  ${wrong.join("\n  ")}`
      : undefined,
  ).toEqual([]);
});

test("a badge shows the studio it claims in its attribute", () => {
  for (const door of doorsIn(html)) {
    expect(door.text, `${door.dir}: badge text`).toBe(door.studio);
  }
});

/**
 * And the one claim that is not per-game: the lede.
 *
 * It said "CyberFlix built an engine and shipped three adventures on it", which
 * is wrong about the third and is the sentence that made the badges necessary.
 * Pinned by the studio's name being IN it, rather than by the whole sentence,
 * because the wording is translated six ways and this is about the fact.
 */
test("the lede does not hand CyberFlix somebody else's game", () => {
  const lede = /<p class="lede"[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
  expect(lede, "no lede found").not.toBe("");
  const others = GAMES.map((g) => g.developer).filter((d) => d !== "CyberFlix");
  for (const studio of new Set(others)) {
    expect(lede.includes(studio), `the lede never names ${studio}`).toBe(true);
  }
});
