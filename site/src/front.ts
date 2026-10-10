/**
 * The front door's script: translate the page, offer the language picker, and put
 * the version in the top bar.
 *
 * Everything else about it is static, and deliberately — it is four links and a
 * paragraph, and nothing about it needs to wait for a module to run. The version
 * is drawn rather than written into the markup so it is bumped in one place
 * (site/package.json, substituted as `__APP_VERSION__`), the same as on every
 * other page that carries the bar.
 *
 * Its language menu works because the catalogues and the UI-language axis live
 * in this shared package rather than in Titanic's, and the page's own sentences
 * are in them (`front` in site/src/locales/), so the front door is read in the same six
 * languages as everything behind it.
 */
import { installI18n } from "./locales";
import { installGamesMenu } from "./games-menu";
import { installLanguageMenu } from "./lang-menu";
import { installVersion } from "./version";

installGamesMenu();
installLanguageMenu();
installVersion();
void installI18n();
