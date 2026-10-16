/**
 * The editors' landing page has no editor to run, but it has the same top bar
 * as the seven that do — so it gets the same language picker, and the same
 * translation of the page's own words (chrome/src/locales/index.ts). Nothing else:
 * the page is a list of links.
 */
import { installGamesMenu } from "@dreamfactory/chrome/games-menu";
import { installLanguageMenu } from "@dreamfactory/chrome/lang-menu";
import { installVersion } from "@dreamfactory/chrome/version";
import { installI18n } from "@dreamfactory/chrome/locales";

void installI18n();
installGamesMenu();
void installLanguageMenu();
installVersion();
