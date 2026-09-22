/**
 * What the room is set to, checked without a room.
 *
 * `bedsit/src/bedsit-settings.ts` exists so that the panel is not the only way
 * into the room, and the whole of that claim is in two behaviours: that a
 * change reaches everybody who is listening, and that a NON-change reaches
 * nobody. The second is the one worth a suite. Taking a piece of furniture out
 * re-bakes three shadow cubes — eighteen passes over the room — so a store that
 * announced a set-to-what-it-already-was would turn a slider dragged across its
 * own value into a hitch per mouse pixel, and the symptom would be "the room
 * stutters sometimes", which is nobody's idea of a bug report.
 *
 * There is no DOM here and no GL, which is the point of the module: this is the
 * one piece of the bedsit that can be checked at the speed of a unit test.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  cycleSkin, onSettings, set, settings, type SettingKey, takeOut, takeOutAll,
} from "../../bedsit/src/bedsit-settings";

/** every announcement since the last reset, as the sets of keys they carried */
const heard: ReadonlySet<SettingKey>[] = [];
onSettings((changed) => { heard.push(changed); });

/** the keys of one announcement, sorted, for comparing against a literal */
const keys = (i: number): string[] => [...heard[i]].sort();

describe("what the room is set to", () => {
  beforeEach(() => {
    heard.length = 0;
    // back to the module's own opening state, since the store is a singleton
    // and a suite that left it changed would be testing the previous test
    set({ lamp: [1, 1, 1, 1, 1], fill: 1, shadowTaps: 5, skin: "painted", smoke: true, detail: 1 });
    takeOutAll(settings.out, false);
    heard.length = 0;
  });

  it("tells the listeners which settings moved, and only those", () => {
    set({ fill: 0.4 });
    expect(heard).toHaveLength(1);
    expect(keys(0)).toEqual(["fill"]);
    expect(settings.fill).toBe(0.4);
  });

  it("carries several settings in one announcement", () => {
    set({ smoke: false, detail: 0.5 });
    expect(heard).toHaveLength(1);
    expect(keys(0)).toEqual(["detail", "smoke"]);
  });

  /**
   * The one that pays for the module.
   *
   * A slider fires an `input` event per pixel of travel, and several of those
   * land on the value it already had — the drag that starts before it moves,
   * the one that comes back. Every one of them used to reach `applyLights`, and
   * one of them reaching `bakeAll` is eighteen passes over the room for nothing.
   */
  it("says nothing when a setting is set to what it already was", () => {
    set({ fill: 0.4 });
    heard.length = 0;
    set({ fill: 0.4 });
    expect(heard).toHaveLength(0);
  });

  /** and the same for the lamps, which are an array: a NEW array of the same
   *  five numbers is the same setting, and comparing the references would have
   *  called every one of them a change */
  it("compares the lamps by their numbers and not by their array", () => {
    set({ lamp: [0, 0.55, 0.55, 0.1, 0.1] });
    expect(heard).toHaveLength(1);
    set({ lamp: [0, 0.55, 0.55, 0.1, 0.1] });
    expect(heard).toHaveLength(1);         // still the one
    set({ lamp: [0, 0.55, 0.55, 0.1, 0.2] });
    expect(heard).toHaveLength(2);
  });

  /** the store keeps its own copy: a caller that goes on using the array it
   *  passed must not be able to move the room's lights by doing so */
  it("does not hand the room's lamps back to whoever set them", () => {
    const mine = [0.1, 0.2, 0.3, 0.4, 0.5];
    set({ lamp: mine });
    mine[0] = 2.5;
    expect(settings.lamp[0]).toBe(0.1);
  });

  it("takes a piece out, puts it back, and says nothing for either done twice", () => {
    takeOut("armchair", true);
    expect(settings.out.has("armchair")).toBe(true);
    expect(heard).toHaveLength(1);
    expect(keys(0)).toEqual(["out"]);

    takeOut("armchair", true);
    expect(heard).toHaveLength(1);         // already out

    takeOut("armchair", false);
    expect(settings.out.has("armchair")).toBe(false);
    expect(heard).toHaveLength(2);
  });

  /** fifteen boxes, ONE bake: the whole reason this is not fifteen calls */
  it("takes everything out in one announcement", () => {
    takeOutAll(["armchair", "desk", "bed"], true);
    expect(heard).toHaveLength(1);
    expect(settings.out.size).toBe(3);

    takeOutAll(["armchair", "desk", "bed"], true);
    expect(heard).toHaveLength(1);         // all of them already out
  });

  it("cycles the skin round and comes back", () => {
    expect(settings.skin).toBe("painted");
    cycleSkin();
    expect(settings.skin).toBe("plaster");
    cycleSkin();
    expect(settings.skin).toBe("painted");
    expect(heard).toHaveLength(2);
  });
});
