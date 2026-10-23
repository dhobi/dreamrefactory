/**
 * The preferences panel's store and its two rules from `SC.EXE` — `src/prefs.ts`:
 * what `0x40e870` can name, what `0x45d810` will bind, the slider's clamp, and
 * what survives the walk from one page to the next.
 *
 *   npx vitest run skullcracker/tests/prefs.ts
 *
 * `tests/menupage.ts` drives the panel through the page; these are the pure
 * pieces under it, checked on their own: the joystick names and the space, a
 * character the panel cannot name, a key already bound elsewhere or to the
 * same action, and a stored record that is partly or wholly not ours.
 *
 * No rip.
 */
import { afterEach, describe, expect, it } from "vitest";
import { bindKey, clampVolume, defaultPrefs, keyName, loadPrefs, savePrefs, STICK_NAMES, VOLUME } from "../src/prefs";

/** a Map-backed localStorage, or one that throws, installed for one test */
function storage(map: Map<string, string> | "throws"): void {
  (globalThis as { localStorage?: unknown }).localStorage =
    map === "throws"
      ? { getItem: () => { throw new Error("off"); }, setItem: () => { throw new Error("off"); } }
      : { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("what 0x40e870 can name", () => {
  it("names letters and digits as themselves, the space as Sp, and the four joystick buttons by their table at 0x40e980", () => {
    expect(["a", "Z", "7", " "].map(keyName)).toEqual(["A", "Z", "7", "Sp"]);
    expect(Object.values(STICK_NAMES).map(keyName)).toEqual(["J4", "J3", "J2", "J1"]);
  });

  it("names nothing else: punctuation, an empty key, or a browser's long key name", () => {
    expect([";", "", "ArrowLeft"].map(keyName)).toEqual(["", "", ""]);
  });
});

describe("binding a key (0x45d810)", () => {
  it("binds a free character, the space as itself", () => {
    const p = defaultPrefs();
    expect(bindKey(p, 8, " ")).toBeNull();
    expect(p.keys[7]).toBe(" ");
  });

  it("refuses a character it cannot name, and one already spoken for (0x45d824)", () => {
    const p = defaultPrefs();
    expect(bindKey(p, 1, "?")).toBe('"?" is not a character 0x40e870 can name');
    expect(bindKey(p, 1, "p")).toBe("P is punch (0x45d824)");
    expect(bindKey(p, 5, "p")).toBe("P is already punch");
    expect(p.keys).toEqual(defaultPrefs().keys);
  });
});

describe("the slider and the store", () => {
  it("clamps the volume to 0…9 and reads a figure that is not one as full", () => {
    expect([clampVolume(-2), clampVolume(4.7), clampVolume(30), clampVolume(NaN)]).toEqual([0, 4, VOLUME.max, VOLUME.max]);
  });

  it("carries all five across pages, and takes only what it recognises out of a stored record", () => {
    const map = new Map<string, string>();
    storage(map);
    const p = { ...defaultPrefs(), volume: 3, music: false, difficulty: -1 as const, character: 1 as const };
    savePrefs(p);
    expect(loadPrefs()).toEqual(p);
    map.set("skullcracker.prefs", JSON.stringify({ keys: ["X"], volume: "loud", music: 1, difficulty: 2, character: 5 }));
    expect(loadPrefs()).toEqual(defaultPrefs());
    map.set("skullcracker.prefs", "{not json");
    expect(loadPrefs()).toEqual(defaultPrefs());
  });

  it("plays the shipped bindings with storage off, and the panel still works without saving", () => {
    storage("throws");
    expect(loadPrefs()).toEqual(defaultPrefs());
    expect(() => savePrefs(defaultPrefs())).not.toThrow();
  });
});
