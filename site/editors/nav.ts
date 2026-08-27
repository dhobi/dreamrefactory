/**
 * The editors' landing page has no editor to run, but it has the same top bar
 * as the seven that do — so it gets the same language picker, and the same
 * translation of the page's own words (site/src/locales/index.ts). Nothing else:
 * the page is a list of links.
 */
import { installGamesMenu } from "@dreamfactory/site/games-menu";
import { installLanguageMenu } from "@dreamfactory/site/lang-menu";
import { installVersion } from "@dreamfactory/site/version";
import { installI18n } from "@dreamfactory/site/locales";

void installI18n();
installGamesMenu();
void installLanguageMenu();
installVersion();
