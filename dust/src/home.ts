/**
 * The welcome page and the collection page: no game on either, only the top
 * bar, where Play and Speedrunner fold into one "Play" as they do on Titanic's
 * pages (chrome/src/play-menu.ts) — Original is the game at play/, Speedrunner
 * the workbench at speedrun/.
 *
 * The version is filled the way the play page fills it (main.ts), into the
 * bar's own `#ver`, rather than by the shared `installVersion`: that one's title
 * names Titanic's 1996 release.
 */
import { installPlayMenu } from "@dreamfactory/chrome/play-menu";
import { VERSION } from "@dreamfactory/chrome/version";

const verEl = document.getElementById("ver");
if (verEl) verEl.textContent = `v${VERSION}`;
void installPlayMenu({ english: true });
