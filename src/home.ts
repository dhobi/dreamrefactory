/**
 * The front page has no game on it and nothing to run — but it has the same
 * top bar as the nine pages that do, so it gets the same language picker. A
 * choice made here is written to storage and carried into /play/, which means
 * you can pick a language before the game asks (src/lang-menu.ts).
 *
 * The other language is the page's own: which of the six the chrome is written
 * in, a separate setting for a separate question (src/locales/index.ts).
 */
import { installLanguageMenu } from "./lang-menu";
import { installI18n } from "./locales";

void installI18n();
void installLanguageMenu();
