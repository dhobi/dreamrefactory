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
import { existsSync } from "node:fs";
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
 * And the two claims that are not per-game, both in the lede.
 *
 * It began as "CyberFlix built an engine and shipped three adventures on it",
 * which was wrong twice. Wrong about the third — *Timelapse* is not CyberFlix's,
 * and that half is the sentence that made the badges necessary. And wrong about
 * the number: DreamFactory was Bill Appleton's authoring system and it carried
 * *Lunicus* and *Jump Raven* as well, besides being licensed to studios outside
 * CyberFlix altogether. THREE is how many of them this port plays, which is a
 * fact about this project and not about the engine.
 *
 * Pinned by the names being IN the sentence rather than by the sentence itself,
 * because the wording is translated six ways and these are about the facts.
 */
const lede = (): string => /<p class="lede"[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";

test("the lede does not hand CyberFlix somebody else's game", () => {
  const text = lede();
  expect(text, "no lede found").not.toBe("");
  const others = GAMES.map((g) => g.developer).filter((d) => d !== "CyberFlix");
  for (const studio of new Set(others)) {
    expect(text.includes(studio), `the lede never names ${studio}`).toBe(true);
  }
});

test("the lede does not make the engine's games only the ones this port plays", () => {
  // Games built on DreamFactory that are NOT in this port. Naming some of them
  // is what stops the sentence collapsing back into a count of what happens to
  // be playable here — the mistake it shipped with, which reads as though the
  // engine had three games rather than the port having three.
  const elsewhere = ["Lunicus", "Jump Raven", "Redjack"];
  const named = elsewhere.filter((title) => lede().includes(title));
  expect(
    named.length,
    `the lede names none of ${elsewhere.join(", ")} — a reader is left thinking ` +
      `DreamFactory's games are exactly the ones with a door on this page`,
  ).toBeGreaterThanOrEqual(2);
});

/**
 * And the same fact once more, in the nine editor pages' top bar.
 *
 * Those pages belong to no game and link to every one of them, which means
 * adding a game to the registry leaves nine hand-written navs to update. It was
 * missed: Skull Cracker had a door on the front page, a book editor of its own and
 * a track editor that would not open its banks, and eight of the nine top bars
 * stopped at Timelapse — so from inside the editors the game did not exist.
 *
 * The nav is authored inline in each page for the same reason the doors are, so
 * this is the same bargain as the badges above: a copy per page, made safe by a
 * test that fails when one of them drifts.
 */
const EDITOR_PAGES = [
  "index",
  "books",
  "casts",
  "movies",
  "puppets",
  "sets",
  "shops",
  "stages",
  "tracks",
];

test("every editor page's top bar links to every game", () => {
  const missing: string[] = [];
  for (const page of EDITOR_PAGES) {
    const src = readFileSync(`${ROOT}/site/editors/${page}.html`, "utf8");
    const nav = /<nav class="topnav">([\s\S]*?)<\/nav>/.exec(src)?.[1];
    if (!nav) {
      missing.push(`${page}.html: no topnav`);
      continue;
    }
    for (const game of GAMES) {
      if (!nav.includes(`href="../${game.dir}/"`)) missing.push(`${page}.html: no link to ${game.dir}`);
    }
  }
  expect(missing, missing.length ? `an editor page's nav is missing a game:\n  ${missing.join("\n  ")}` : undefined).toEqual(
    [],
  );
});

/**
 * And the marks the games menu draws, which are copies.
 *
 * `site/public/mark-*` is each game's own favicon copied into the site's public
 * directory, because the pages that carry that menu — the front page and the nine
 * editors — are served by the SITE build, and a game's own public directory is
 * behind its own port on the dev server. The copy is what makes the icon appear in
 * development as well as in production; this is what stops it going stale.
 */
test("every game's mark in site/public is the game's own file, byte for byte", () => {
  for (const game of GAMES) {
    const copy = `${ROOT}/site/public/${game.mark}`;
    expect(existsSync(copy), `${game.mark} is missing from site/public`).toBe(true);
    // the original keeps the game's own naming: <dir>/public/<dir>-mark.<ext>
    const ext = game.mark.split(".").pop();
    const original = `${ROOT}/${game.dir}/public/${game.dir}-mark.${ext}`;
    expect(existsSync(original), `${original} is missing`).toBe(true);
    expect(
      readFileSync(copy).equals(readFileSync(original)),
      `site/public/${game.mark} has drifted from ${game.dir}/public/${game.dir}-mark.${ext}`,
    ).toBe(true);
  }
});
