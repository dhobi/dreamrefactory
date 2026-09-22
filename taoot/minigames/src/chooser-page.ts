/**
 * The door to the three minigames — which has no game on it.
 *
 * Its whole job is the chrome every other Titanic page gets: the page text in
 * whichever of the six languages the reader has chosen, the language picker in
 * the top bar, and the version. Same three calls `taoot/src/home.ts` makes for
 * the front page, and for the same reason — a page with nothing to run still has
 * the same top bar as the ones that do.
 */
import { installI18n } from "@dreamfactory/site/locales";
import { installLanguageMenu } from "@dreamfactory/site/lang-menu";
import { installPlayMenu } from "@dreamfactory/site/play-menu";
import { installVersion } from "@dreamfactory/site/version";

void installI18n();
void installLanguageMenu();
void installPlayMenu();
installVersion();
