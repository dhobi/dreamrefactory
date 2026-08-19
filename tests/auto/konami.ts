/**
 * The front page's one hidden door (src/konami.ts).
 *
 * Worth a test for a reason the feature's size does not suggest: the failure
 * mode of a key-sequence matcher is silence. A cursor-based one that resets on
 * a wrong key looks correct in every hand-test — you type the code, it works —
 * and is wrong for the person who steadies themselves with an extra `↑` first,
 * who then cannot open it at all and has nothing to report but "it doesn't
 * work". So the false starts are the interesting cases here, not the happy one.
 */
import { describe, expect, test } from "vitest";
import { KONAMI, konamiWatcher } from "../../src/konami";

/** feed a whole sequence, and say how many times the door opened */
function type(keys: readonly string[]): number {
  let opened = 0;
  const feed = konamiWatcher(() => opened++);
  for (const k of keys) feed(k);
  return opened;
}

const CODE = [...KONAMI];

describe("the Konami code", () => {
  test("the code opens it", () => {
    expect(type(CODE)).toBe(1);
  });

  test("the code is the arcade ten, in order", () => {
    expect(CODE).toEqual([
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
    ]);
  });

  test("nothing else does", () => {
    expect(type([])).toBe(0);
    expect(type(CODE.slice(0, -1)), "nine of the ten").toBe(0);
    expect(type([...CODE].reverse()), "backwards").toBe(0);
    expect(type(CODE.slice(1)), "missing the first key").toBe(0);
    // the one wrong key is in the middle, so every other key is right
    const swapped = [...CODE];
    swapped[5] = "ArrowLeft";
    expect(type(swapped)).toBe(0);
  });

  /**
   * The case a cursor gets wrong, and the reason this is a rolling buffer.
   *
   * A matcher that resets its index on an unexpected key sees the third `↑` as
   * a mistake, goes back to zero, and then reads the REST of the code as if it
   * started at `↓` — so it never matches, and typing the code perfectly from
   * that point on does nothing.
   */
  test("a false start does not poison the sequence", () => {
    expect(type(["ArrowUp", "ArrowUp", ...CODE]), "two extra ups in front").toBe(1);
    expect(type(["x", "ArrowDown", "Enter", ...CODE]), "junk in front").toBe(1);
    expect(type([...CODE.slice(0, 6), ...CODE]), "six keys of a first attempt").toBe(1);
  });

  test("the letters are case-insensitive, the arrows are not", () => {
    expect(type([...CODE.slice(0, 8), "B", "A"]), "caps lock on").toBe(1);
    expect(type([...CODE.slice(0, 8), "B", "a"]), "shift on one of them").toBe(1);
    // `key` for the arrows is a name, not a character, so nothing folds it
    expect(type(["arrowup", ...CODE.slice(1)]), "a lowercased arrow name").toBe(0);
  });

  /**
   * Typing it twice opens it twice — and, more to the point, typing it once and
   * then leaning on the `a` does not. The buffer is cleared on a match, so the
   * eleventh keystroke starts a fresh attempt instead of re-matching the last
   * ten every time.
   */
  test("it fires once per completion", () => {
    expect(type([...CODE, "a", "a", "a"])).toBe(1);
    expect(type([...CODE, ...CODE])).toBe(2);
  });
});
