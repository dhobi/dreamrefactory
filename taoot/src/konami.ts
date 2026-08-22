/**
 * The Konami code, and the one door it opens.
 *
 * The speedrun workbench (speedrun/index.html) is built and deployed but
 * deliberately unlisted — nothing links to it, it carries `noindex`, and it is
 * meant to stay that way: it is a tool for driving the game with a script, not
 * a feature of the site. But "unlisted" and "unreachable" are different things,
 * and typing a URL from memory is a poor way to reach a page you use often.
 *
 * So the front page listens for ↑ ↑ ↓ ↓ ← → ← → B A. It costs nothing to anyone
 * who does not know it is there, which is the whole point of the shape: nobody
 * arrives at it by accident, and nobody who wants it has to be told twice.
 *
 * ## Why a rolling buffer rather than a cursor
 *
 * The obvious version keeps an index into the sequence and resets it on a wrong
 * key, and it gets one case wrong that people actually hit: `↑ ↑ ↑ ↑ ↓ ↓ …`. A
 * cursor at position 2 sees a third `↑`, calls it wrong, and resets to 0 — so
 * the sequence that follows is one key short forever. A buffer of the last ten
 * keystrokes has no state to get wrong; it matches whenever the last ten ARE the
 * code, however many false starts came before. It is also less code.
 *
 * ## No timer
 *
 * The classic implementations time out between keys, and there is no reason to:
 * the only thing a timeout adds is a way to fail after typing it correctly. It
 * would also have to be a wall clock, which `src/` may not touch outside the few
 * files that are the boundary with the real world (taoot/tests/auto/reproducible.ts).
 */
import { focusOwnsKey } from "@dreamfactory/engine/web/keys";

/**
 * The code, in `KeyboardEvent.key` values.
 *
 * The ten-key arcade form, not the NES one — no Start. There is nothing here to
 * start, and an eleventh key is one more thing to remember for no gain.
 */
export const KONAMI: readonly string[] = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

/**
 * A matcher fed one key at a time, which calls back when the last ten were it.
 *
 * Split out from {@link installKonami} because this half is the part with a
 * decision in it and the other half is three lines of DOM. It is a plain
 * function over strings, so it can be tested without a document.
 *
 * `b` and `a` are compared case-insensitively — Caps Lock and Shift are not
 * meant to be part of the puzzle — and every other key is compared exactly,
 * because `ArrowUp` has no case to fold.
 */
export function konamiWatcher(onUnlock: () => void): (key: string) => void {
  const seen: string[] = [];
  return (key: string): void => {
    seen.push(key.length === 1 ? key.toLowerCase() : key);
    if (seen.length > KONAMI.length) seen.shift();
    if (seen.length === KONAMI.length && KONAMI.every((k, i) => k === seen[i])) {
      // Cleared, so holding the last key or typing the code twice fires once
      // per completion rather than once per keystroke afterwards.
      seen.length = 0;
      onUnlock();
    }
  };
}

/**
 * Listen on the window until the code is typed.
 *
 * `focusOwnsKey` is the same courtesy every other keyboard handler on this site
 * pays (engine/src/web/keys.ts): a control that uses a key gets it. The front page has one
 * — the language picker — and a `<select>` takes the arrows, because that is how
 * a dropdown is worked without a mouse. Without this, arrowing through the six
 * languages would be typing the first four keys of the code.
 *
 * Auto-repeat is ignored for the same reason the buffer is cleared above: a held
 * `↑` is one press as far as anybody typing this is concerned.
 *
 * Returns a function that removes the listener, which nothing on the front page
 * needs and every listener should offer anyway.
 */
export function installKonami(onUnlock: () => void): () => void {
  const feed = konamiWatcher(onUnlock);
  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (focusOwnsKey(e.target, e.key)) return;
    feed(e.key);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
