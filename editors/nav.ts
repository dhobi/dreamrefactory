/**
 * The editors' landing page has no editor to run, but it has the same top bar
 * as the seven that do — so it gets the same language picker, and the same
 * translation of the page's own words (src/locales/index.ts). Nothing else:
 * the page is a list of links.
 */
import { installLanguageMenu } from "../src/lang-menu";
import { installVersion } from "../src/version";
import { installI18n } from "../src/locales";

void installI18n();
void installLanguageMenu();
installVersion();
