/**
 * The door to the three minigames — which has no game on it.
 *
 * Its whole job is the chrome every other Titanic page gets: the page text in
 * whichever of the six languages the reader has chosen, the language picker in
 * the top bar, and the version. Same three calls `taoot/src/home.ts` makes for
 * the front page, and for the same reason — a page with nothing to run still has
 * the same top bar as the ones that do.
 */
import { installI18n } from "@dreamfactory/chrome/locales";
import { installLanguageMenu } from "@dreamfactory/chrome/lang-menu";
import { installPlayMenu } from "@dreamfactory/chrome/play-menu";
import { installVersion } from "@dreamfactory/chrome/version";

void installI18n();
void installLanguageMenu();
void installPlayMenu();
installVersion();
