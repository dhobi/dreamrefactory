/**
 * The front page's one hidden door (taoot/src/konami.ts).
 *
 * Worth a test for a reason the feature's size does not suggest: the failure
 * mode of a key-sequence matcher is silence. A cursor-based one that resets on
 * a wrong key looks correct in every hand-test — you type the code, it works —
 * and is wrong for the person who steadies themselves with an extra `↑` first,
 * who then cannot open it at all and has nothing to report but "it doesn't
 * work". So the false starts are the interesting cases here, not the happy one.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { KONAMI, installKonami, konamiWatcher } from "../../src/konami";

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

/**
 * The listener the front page installs, fed the way the browser feeds it.
 *
 * The page is not in node, so `window` is a stand-in that holds the one handler;
 * the events are the fields the listener reads. What is pinned is which
 * keystrokes it lets through to the matcher — a held key, a chord, and an arrow
 * that belongs to the language menu are not the player typing the code.
 */
describe("the front page's listener", () => {
  let handler: ((e: Partial<KeyboardEvent>) => void) | null = null;
  afterEach(() => vi.unstubAllGlobals());

  /** install it on a stand-in window, and say how often it opened */
  function install(): { press: (e: Partial<KeyboardEvent>) => void; opened: () => number; remove: () => void } {
    handler = null;
    vi.stubGlobal("window", {
      addEventListener: (type: string, h: (e: Partial<KeyboardEvent>) => void) => {
        expect(type).toBe("keydown");
        handler = h;
      },
      removeEventListener: (_type: string, h: unknown) => {
        if (h === handler) handler = null;
      },
    });
    let opened = 0;
    const remove = installKonami(() => opened++);
    return {
      press: (e) => handler?.({ repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: null, ...e }),
      opened: () => opened,
      remove,
    };
  }
  const code = (press: (e: Partial<KeyboardEvent>) => void) => CODE.forEach((key) => press({ key }));

  test("typed on the page, the code opens it", () => {
    const page = install();
    code(page.press);
    expect(page.opened()).toBe(1);
  });

  test("auto-repeat is one press, so a held arrow is not two of the code's ups", () => {
    const page = install();
    page.press({ key: "ArrowUp" });
    page.press({ key: "ArrowUp", repeat: true });
    // had the repeat counted, it would have been the code's second up, and the
    // rest of the code would complete it
    CODE.slice(2).forEach((key) => page.press({ key }));
    expect(page.opened()).toBe(0);
  });

  test("a chord with ctrl, meta or alt is not part of the code", () => {
    const page = install();
    CODE.slice(0, 8).forEach((key) => page.press({ key }));
    page.press({ key: "b", ctrlKey: true });
    page.press({ key: "a", metaKey: true });
    expect(page.opened()).toBe(0);
  });

  test("arrows that work the language menu are the menu's, not the code's", () => {
    const page = install();
    const select = { tagName: "SELECT" } as unknown as EventTarget;
    CODE.forEach((key) => page.press({ key, target: select }));
    expect(page.opened()).toBe(0);
  });

  test("removing the listener stops it hearing anything", () => {
    const page = install();
    page.remove();
    code(page.press);
    expect(page.opened()).toBe(0);
  });
});
