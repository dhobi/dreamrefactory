/**
 * Every game's page goes fullscreen when a phone is turned on its side.
 *
 *   npx vitest run site/tests/landscape.ts
 *
 * `installFullscreen` does it only when asked (`landscape: true`,
 * engine/src/web/fullscreen.ts), because the speedrun pages share the module
 * and have no game to be playing. So each game's page has to ask, and one that
 * came later did not: Lunicus's page wired the button without it and kept the
 * postage-stamp picture on a phone turned sideways. This reads each game's
 * `src/main.ts` (or `src/page/main.ts`) for the call, the way site/tests/deploy-lanes.ts reads the
 * workflow: what is checked is that the words are there. Lunicus and Jump
 * Raven build their page from engine/src/web/v0-page.ts, so for them the call
 * is read there.
 */
import { test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GAMES } from "@dreamfactory/chrome/games";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

test.each(GAMES.map((g) => g.dir))("%s: a phone on its side goes fullscreen", (dir) => {
  // a game keeps its page at src/main.ts, or with its other page in src/page/ (Skull Cracker)
  const at = [`${dir}/src/main.ts`, `${dir}/src/page/main.ts`].find((p) => existsSync(`${ROOT}/${p}`)) ?? `${dir}/src/main.ts`;
  let main = readFileSync(`${ROOT}/${at}`, "utf8");
  if (/new V0Page\(/.test(main)) main = readFileSync(`${ROOT}/engine/src/web/v0-page.ts`, "utf8");
  const call = /installFullscreen\(([\s\S]*?)\);/.exec(main)?.[1];
  expect(call, `${at} wires no Fullscreen button`).toBeDefined();
  expect(call, `${at} calls installFullscreen without landscape: true`).toMatch(/landscape:\s*true/);
});
