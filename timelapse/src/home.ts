/**
 * The welcome page: no game on it, only the top bar, where Play and
 * Speedrunner fold into one "Play" as they do on Titanic's and Dust's pages
 * (chrome/src/play-menu.ts) — Original is the game at play/, Speedrunner the
 * workbench at speedrun/. In English: Timelapse is not translated.
 *
 * The version is filled the way the play page fills it, into the bar's own
 * `#ver`, rather than by the shared `installVersion`: that one's title names
 * CyberFlix's Titanic release.
 */
import { installPlayMenu } from "@dreamfactory/chrome/play-menu";
import { VERSION } from "@dreamfactory/chrome/version";

const verEl = document.getElementById("ver");
if (verEl) verEl.textContent = `v${VERSION}`;
void installPlayMenu({ english: true });
