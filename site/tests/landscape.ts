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
 * `src/main.ts` for the call, the way site/tests/deploy-lanes.ts reads the
 * workflow: what is checked is that the words are there.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GAMES } from "@dreamfactory/site/games";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

test.each(GAMES.map((g) => g.dir))("%s: a phone on its side goes fullscreen", (dir) => {
  const main = readFileSync(`${ROOT}/${dir}/src/main.ts`, "utf8");
  const call = /installFullscreen\(([\s\S]*?)\);/.exec(main)?.[1];
  expect(call, `${dir}/src/main.ts wires no Fullscreen button`).toBeDefined();
  expect(call, `${dir}/src/main.ts calls installFullscreen without landscape: true`).toMatch(/landscape:\s*true/);
});
