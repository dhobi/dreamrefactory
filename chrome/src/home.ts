/**
 * A game's home page (tools/vite-home.ts): no game on it, only the top bar,
 * where Play folds Original and Speedrunner into one menu for a game that has
 * a workbench (play-menu.ts) — and the shared look (home.css). In English: the
 * games these pages front are not translated.
 */
import "./home.css";
import { installPlayMenu } from "./play-menu";
import { installVersion } from "./version";

installVersion();
void installPlayMenu({ english: true });
