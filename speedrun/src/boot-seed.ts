/**
 * A seed a sheet's `reset(seed: N)` line pinned, waiting for the page its reload
 * brings up.
 *
 * On the workbench `reset(seed: N)` boots the game afresh the way `reset()` does — by
 * reloading the document — and the dice have to be pinned before the new page's
 * boot draws its first one. The run loop does not survive the reload, so the
 * seed is left in `sessionStorage` for the game's page to take as it starts
 * (taoot/src/main.ts). Taken once: a later reload by hand is a live boot again.
 */
const key = (game: string): string => `${game}:speedrun:seed`;

/** leave `seed` for the next boot of `game`'s page in this tab */
export function keepBootSeed(game: string, seed: number): void {
  try {
    sessionStorage.setItem(key(game), String(seed));
  } catch {
    /* storage denied: the boot is then unseeded, and the report says so */
  }
}

/** the seed a `reset(seed: N)` line left for this boot, if any — and forget it */
export function takeBootSeed(game: string): number | null {
  try {
    const raw = sessionStorage.getItem(key(game));
    sessionStorage.removeItem(key(game));
    const n = raw === null ? Number.NaN : Number(raw);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}
