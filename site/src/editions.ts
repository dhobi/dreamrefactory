/**
 * The EDITION axis: which copy of a game a page is showing.
 *
 * One of two axes, and the one that is about CONTENT — see
 * [ui-languages.ts](ui-languages.ts) for the other, which is about the words on
 * the page and shares nothing with this but a coincidence of authorship. An
 * edition is a `gamefiles/` tree: for Titanic, the six translations of the full
 * game and the cuts of it that are not translations.
 *
 * Page groups ask the question, and all of them ask it the same way, with the
 * button row this module builds:
 *
 *  - **play** — which tree the game boots from (`taoot/src/main.ts`)
 *  - **the editors** — which tree's files the page lists (`site/editors/*.ts`);
 *    an install with six languages offers six copies of every basename, and a
 *    list of all of them is the same file six times
 *  - **the collection** — which pressing's box and disc are on the turntable
 *    (`taoot/src/collection.ts`), the one page where the answer is an object
 *    rather than a body of data
 *
 * The choice is remembered per game, so picking the German game on the play page
 * leaves the editors listing German files and the collection turning the German
 * box. Switching is a RELOAD on the two pages that have read data (a live session
 * is holding boot scripts, shops and sound banks from the edition being left);
 * the collection swaps images in place, because nothing there is loaded that a
 * new `src` does not replace.
 *
 * ## Bound to a game once, not passed one every time
 *
 * Everything below is mechanism — the game-specific part is a list of codes, two
 * storage keys and a fallback, which is {@link GameEditions} in
 * [games.ts](games.ts). {@link editionAxis} binds one and returns the same
 * functions with the same signatures they had when this module belonged to
 * Titanic, which is why moving it here changed no call site:
 *
 * ```ts
 * export const { chosenEdition, installEditionPicker } = editionAxis(TITANIC);
 * ```
 */
import { DfEncoding } from "@dreamfactory/engine/df/text";
import { uiLanguage } from "./locales";
import { siteUrl } from "./site";
import { GameEditions, NEUTRAL, editionOfUrl } from "./games";

export { NEUTRAL } from "./games";

/**
 * Every game file the pages may fetch, and what it weighs: `gamefiles.json`,
 * fetched at most once per page.
 *
 * A FILE, not an endpoint. It is the only thing this site ever needed a server
 * for — the listing used to be `/api/gamefiles`, a directory walk per request —
 * and making it a build artifact (`tools/manifest.ts`; served live by the dev
 * server so a changed tree needs no rebuild) is what lets the whole site be
 * hosted as static files.
 *
 * A map rather than a list because both things the pages want are in it: the keys
 * are the listing, and the values are what the play page's preload bar totals up
 * before it fetches a byte. Empty where there is no manifest at all — every page
 * that reads it also takes a dropped file, and an empty manifest is how they find
 * out to offer only that.
 *
 * Not parameterised on a game: it is fetched from the page's own site root, and
 * each game's build writes its own at its own root.
 */
let manifest: Promise<Record<string, number>> | null = null;

function gamefileTable(): Promise<Record<string, number>> {
  return (manifest ??= (async () => {
    try {
      const r = await fetch(siteUrl("gamefiles.json"));
      return r.ok ? ((await r.json()) as Record<string, number>) : {};
    } catch {
      return {};
    }
  })());
}

/** the paths the manifest carries, as served (no leading slash) */
export async function gamefileManifest(): Promise<string[]> {
  return Object.keys(await gamefileTable());
}

/** what each of those paths weighs — the preload bar's totals */
export function gamefileSizes(): Promise<Record<string, number>> {
  return gamefileTable();
}

export interface EditionPickerOptions {
  /** codes to offer; the editions the manifest carries when left out */
  available?: string[];
  /** the one to mark; the chosen edition of `available` when left out */
  current?: string;
  /** what a click does; remember-and-reload when left out */
  onPick?: (code: string) => void;
}

/** everything the edition axis does, for one game */
export interface EditionAxis {
  editionsIn(paths: string[]): string[];
  chosenEdition(available: string[]): string;
  inChosenEdition(paths: string[], edition: string): string[];
  chosenEncoding(): Promise<DfEncoding>;
  rememberEdition(code: string): void;
  switchEdition(code: string): void;
  markEdition(mount: HTMLElement, code: string): void;
  installEditionPicker(mount: HTMLElement, opts?: EditionPickerOptions): Promise<string>;
}

export function editionAxis(game: GameEditions): EditionAxis {
  const codes = game.editions.map((e) => e.code);
  const isCode = (c: string): boolean => codes.includes(c.toLowerCase());
  const nameOf = (c: string): string =>
    game.editions.find((e) => e.code === c.toLowerCase())?.name ?? c;
  const editionOf = (url: string): string => editionOfUrl(game, url);

  /** the editions a manifest actually carries, in the game's own order */
  function editionsIn(paths: string[]): string[] {
    const found = new Set<string>();
    for (const p of paths) {
      const edition = editionOf(p);
      if (edition !== NEUTRAL) found.add(edition);
    }
    return codes.filter((c) => found.has(c));
  }

  /**
   * Which edition a page is showing: `?edition=`, then what was picked last
   * time, then the reader's own UI language where that edition exists, then the
   * game's fallback, then whatever the install has.
   *
   * The UI-language step is the whole reason two controls do not read as two
   * chores: a German reader who has never touched the edition row gets the
   * German game, and the moment they DO touch it the two part company for good.
   */
  function chosenEdition(available: string[]): string {
    const has = (c: string | null | undefined): boolean =>
      !!c && isCode(c) && available.includes(c.toLowerCase());
    const query = new URLSearchParams(window.location.search).get("edition");
    if (has(query)) return query!.toLowerCase();
    let remembered: string | null = null;
    let legacy: string | null = null;
    try {
      remembered = window.localStorage.getItem(game.storageKey);
      legacy = game.legacyKey ? window.localStorage.getItem(game.legacyKey) : null;
    } catch {
      /* storage can be denied; the query parameter still works */
    }
    if (has(remembered)) return remembered!.toLowerCase();
    if (has(legacy)) return legacy!.toLowerCase();
    const ui = uiLanguage();
    if (has(ui)) return ui;
    return available.includes(game.fallback) ? game.fallback : (available[0] ?? game.fallback);
  }

  /**
   * The paths belonging to one edition, plus the edition-NEUTRAL ones.
   *
   * Neutral is not a leftover: a flat single-edition dump has no
   * `gamefiles/<code>/` level at all and lands entirely in it, and this port's
   * own assets (`lang.stg`) live there by design. Dropping it would empty the
   * editors for anyone whose install predates the split.
   */
  function inChosenEdition(paths: string[], edition: string): string[] {
    return paths.filter((p) => {
      const e = editionOf(p);
      return e === edition || e === NEUTRAL;
    });
  }

  /**
   * The code page this page should read text bytes in — the chosen edition's,
   * since no DF file records one (`engine/src/df/text.ts`).
   *
   * A promise because it depends on which editions the manifest offers, and
   * {@link gamefileManifest} caches, so this shares the fetch the picker already
   * makes. A file dropped in the fraction of a second before it resolves decodes
   * as the default, which is what four of Titanic's six trees are anyway.
   */
  async function chosenEncoding(): Promise<DfEncoding> {
    const paths = await gamefileManifest();
    const code = chosenEdition(editionsIn(paths));
    const found = game.editions.find((e) => e.code === code);
    return found?.encoding ?? game.editions[0].encoding;
  }

  /** remember an edition, and write it into the URL so a link can carry it */
  function rememberEdition(code: string): void {
    try {
      window.localStorage.setItem(game.storageKey, code);
    } catch {
      /* then the query parameter is carrying it alone */
    }
    const url = new URL(window.location.href);
    url.searchParams.set("edition", code);
    window.history.replaceState(null, "", url);
  }

  /**
   * Switch edition and start the page over.
   *
   * A reload rather than a re-render: the page that boots a game has a live
   * session holding that edition's scripts and banks, and an editor has a file
   * open from it. Nothing about the page's own language is touched — that is the
   * point of the two axes, and it is why this writes `?edition=` and nothing else.
   */
  function switchEdition(code: string): void {
    rememberEdition(code);
    window.location.reload();
  }

  /** mark the button of `code` as the one being shown */
  function markEdition(mount: HTMLElement, code: string): void {
    for (const btn of mount.querySelectorAll<HTMLButtonElement>("button[data-edition]")) {
      btn.classList.toggle("here", btn.dataset.edition === code);
    }
  }

  /**
   * Build the edition row into `mount`, which supplies its own label (the pages
   * carry that in markup, so it is translated with everything else).
   *
   * The row is HIDDEN outright when there is one edition to choose from or none:
   * a picker with a single answer is furniture, and a label with no buttons
   * beside it is worse. That is also the production build of the play page and
   * the editors, where there is no manifest to read at all — and it is what a
   * one-disc game like Dust gets for free.
   *
   * Returns the edition being shown, whether or not a control was drawn, so a
   * caller can use it unconditionally.
   */
  async function installEditionPicker(
    mount: HTMLElement,
    opts: EditionPickerOptions = {},
  ): Promise<string> {
    const available = opts.available ?? editionsIn(await gamefileManifest());
    const current = opts.current ?? chosenEdition(available);
    mount.hidden = available.length < 2;
    if (mount.hidden) return current;
    for (const code of available) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.edition = code;
      btn.textContent = nameOf(code);
      btn.addEventListener("click", () => (opts.onPick ?? switchEdition)(code));
      mount.appendChild(btn);
    }
    markEdition(mount, current);
    return current;
  }

  return {
    editionsIn,
    chosenEdition,
    inChosenEdition,
    chosenEncoding,
    rememberEdition,
    switchEdition,
    markEdition,
    installEditionPicker,
  };
}
