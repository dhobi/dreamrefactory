/**
 * The front page has no game on it and nothing to run — but it has the same
 * top bar as the nine pages that do, so it gets the same language picker. A
 * choice made here is written to storage and carried into /play/, which means
 * you can pick a language before the game asks (site/src/lang-menu.ts).
 *
 * The other language is the page's own: which of the six the chrome is written
 * in, a separate setting for a separate question (site/src/locales/index.ts).
 *
 * And one thing that is not on the page at all: the Konami code opens the
 * speedrun workbench (taoot/src/konami.ts), which is built and deployed but unlisted
 * and staying that way.
 */
import { installLanguageMenu } from "@dreamfactory/site/lang-menu";
import { installVersion } from "@dreamfactory/site/version";
import { installI18n } from "@dreamfactory/site/locales";
import { installKonami } from "./konami";
import { siteUrl } from "@dreamfactory/site/site";

void installI18n();
void installLanguageMenu();
installVersion();

/**
 * The globe acknowledges the code, and then we go.
 *
 * A cue rather than a bare jump because a page that navigates the instant you
 * finish typing looks like a page that crashed — and a cue with no words in it
 * because every visible string on this site is a key in six locale files
 * (site/tests/locales.ts), which is a lot of ceremony for a joke.
 *
 * The wait is on the ANIMATIONS THEMSELVES rather than on a timer, and that is
 * not only a matter of taste: `src/` may not read the wall clock outside the
 * handful of files that are the boundary with the real world, `setTimeout`
 * included (taoot/tests/auto/reproducible.ts). `getAnimations()` gives the exact
 * thing to wait for, and it also answers the case a timer would get wrong —
 * `prefers-reduced-motion` turns the animation off, so there is nothing running,
 * so the jump happens immediately instead of after a pause with nothing in it.
 */
installKonami(() => {
  const go = (): void => {
    location.href = siteUrl("speedrun/");
  };
  const mark = document.querySelector<HTMLElement>("#home .hero-mark");
  if (!mark || typeof mark.getAnimations !== "function") return go();
  mark.classList.add("unlocked");
  const running = mark.getAnimations();
  if (!running.length) return go();
  // `go, go` — a cancelled animation rejects, and a cancelled cue is still a
  // typed code. The door opens either way.
  void Promise.all(running.map((a) => a.finished)).then(go, go);
});
