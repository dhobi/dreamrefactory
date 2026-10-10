/**
 * Titanic's edition axis: the shared mechanism, bound to this game.
 *
 * The mechanism is `site/src/editions.ts`, and this is the binding:
 * {@link editionAxis} returns its functions, and the game-specific part — six
 * trees and a demo, their endonyms, their code pages, the two storage keys — is
 * `TITANIC` in `site/src/games.ts`.
 *
 * The mechanism lives in `site/` because eight format editors read this axis,
 * and the editors are the project's tooling rather than this game's: importing
 * it through Titanic would point a dependency from the shared package into one
 * of its own consumers. Only the table is Titanic's.
 */
import { TITANIC } from "@dreamfactory/site/games";
import { editionAxis } from "@dreamfactory/site/editions";

export const {
  editionsIn,
  chosenEdition,
  inChosenEdition,
  chosenEncoding,
  rememberEdition,
  switchEdition,
  markEdition,
  installEditionPicker,
} = editionAxis(TITANIC);

/** the manifest is the page's own, whatever game it belongs to */
export { gamefileManifest, gamefileSizes } from "@dreamfactory/site/editions";
export type { EditionPickerOptions } from "@dreamfactory/site/editions";
