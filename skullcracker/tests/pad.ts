/**
 * The touch pad's fingers, `padPress` / `padLift` / `padLiftAll` in `src/game.ts`.
 *
 *   npx vitest run skullcracker/tests/pad.ts
 *
 * The pad is the page's — its buttons, where they stand and when they hide are
 * the browser suite `tests/browser/pad.ts` — but what a finger on one DOES is the
 * game's, and ends in the same eight `held` flags and four press edges a key
 * sets. No machine suite has a finger, so this has, on stand-in buttons:
 *
 *   - a press sets the flag and the edge the keyboard's `keydown` would, and only
 *     the press: a held fist must not machine-gun;
 *   - a key is let go when the LAST finger on it lifts — a thumb rolling across
 *     the pad puts two pointers on one button for a moment;
 *   - while the keys are shut (`0x402be0`'s `cmp word ptr [0x46b1d4], 0`, the
 *     craft's `0x402e30(0)`) a finger lights its button and sets nothing.
 *
 * No rip: none of this touches a level.
 */
import { afterEach, describe, expect, it } from "vitest";
import * as game from "../src/game";

/** a pad button as far as the game looks at one: its action and its class list */
function button(act: keyof typeof game.held) {
  const classes = new Set<string>();
  return {
    dataset: { act },
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    lit: () => classes.has("on"),
  } as unknown as HTMLButtonElement & { lit(): boolean };
}

afterEach(() => {
  game.padLiftAll();
  game.setInput(true);
});

describe("a finger on the pad", () => {
  it("holds the key it presses, lights its button, and raises the press edge once", () => {
    const jump = button("jump");
    game.setInput(true);
    game.padPress(jump, 1);
    expect(game.held.jump).toBe(true);
    expect(game.jumpPressed).toBe(true);
    expect(jump.lit()).toBe(true);
    // a second finger on a key already down is not a second press
    game.dropKeys();
    game.held.jump = true;
    game.padPress(jump, 2);
    expect(game.jumpPressed).toBe(false);
  });

  it("raises each of the four edges a key's press does, and none for a walk", () => {
    game.setInput(true);
    for (const act of ["up", "punch", "kick"] as const) game.padPress(button(act), 10 + act.length);
    expect([game.upPressed, game.punchPressed, game.kickPressed]).toEqual([true, true, true]);
    game.dropKeys();
    game.padPress(button("right"), 20);
    expect(game.held.right).toBe(true);
    expect([game.upPressed, game.jumpPressed, game.punchPressed, game.kickPressed]).toEqual([false, false, false, false]);
  });

  it("lets a key go only when the last finger on it lifts", () => {
    game.setInput(true);
    const a = button("right");
    const b = button("right");
    game.padPress(a, 1);
    game.padPress(b, 2);
    game.padLift(1);
    expect(game.held.right).toBe(true);
    expect(a.lit()).toBe(false);
    expect(b.lit()).toBe(true);
    game.padLift(2);
    expect(game.held.right).toBe(false);
    // a pointer the pad never saw lifts nothing
    game.padPress(a, 3);
    game.padLift(99);
    expect(game.held.right).toBe(true);
  });

  it("lifts every finger at once when a film starts or the page loses them", () => {
    game.setInput(true);
    const left = button("left");
    const punch = button("punch");
    game.padPress(left, 1);
    game.padPress(punch, 2);
    game.padLiftAll();
    expect(game.padFingers.size).toBe(0);
    expect([game.held.left, game.held.punch]).toEqual([false, false]);
    expect([left.lit(), punch.lit()]).toEqual([false, false]);
  });

  it("only lights its button while the keys are shut", () => {
    game.setInput(false);
    const kick = button("kick");
    game.padPress(kick, 1);
    expect(kick.lit()).toBe(true);
    expect(game.held.kick).toBe(false);
    expect(game.kickPressed).toBe(false);
  });
});
