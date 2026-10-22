/**
 * A game's home page (tools/vite-home.ts): no game on it, only the top bar,
 * where Play folds Original and Speedrunner into one menu for a game that has
 * a workbench (play-menu.ts) — and the shared look (home.css). In English: the
 * games these pages front are not translated.
 *
 * The version is filled into the bar's own `#ver`, as the play page fills it,
 * rather than by the shared `installVersion`: that one's title names CyberFlix's
 * Titanic release.
 */
import "./home.css";
import { installPlayMenu } from "./play-menu";
import { VERSION } from "./version";

const verEl = document.getElementById("ver");
if (verEl) verEl.textContent = `v${VERSION}`;
void installPlayMenu({ english: true });
