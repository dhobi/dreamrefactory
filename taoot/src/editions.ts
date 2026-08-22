/**
 * Titanic's edition axis: the shared mechanism, bound to this game.
 *
 * The 200 lines that used to be here are `site/src/editions.ts` now, and what is
 * left is the binding. Nothing that imports this changed: {@link editionAxis}
 * returns the same functions with the same signatures, and the game-specific part
 * — six trees and a demo, their endonyms, their code pages, the two storage keys
 * — is `TITANIC` in `site/src/games.ts`.
 *
 * Why it moved: seven format editors read this axis, and the editors are the
 * project's tooling rather than this game's. They were importing it through
 * Titanic, which pointed a dependency from the shared package into one of its own
 * consumers. The mechanism was never Titanic's; only the table was.
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
