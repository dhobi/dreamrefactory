/**
 * The mixer's two one-shot calls that the playthroughs leave half-taken —
 * `src/sound.ts`'s `Mixer`, read out of `0x427c20` and `0x428000`.
 *
 *   npx vitest run skullcracker/tests/mixer.ts
 *
 * `tests/machine/sound.ts` pins the mixer whole; these are the two corners it
 * does not happen to reach: a RENEW of a sound nobody is playing, which takes
 * the lower channel like a plain mix would (`0x427c71`), and a record put to
 * loop on a channel already playing it, which then never empties
 * (`0x428059`).
 *
 * No rip: the mixer is a table of three channels.
 */
import { describe, expect, it } from "vitest";
import { BANK_RANK, Mixer, priorityOf } from "../src/sound";

const fx = (i: number) => priorityOf(BANK_RANK.chapter, i);

describe("the mixer (0x427c20, 0x428000)", () => {
  it("renews a sound nobody plays onto the lower channel, cutting what held it", () => {
    const cut: string[] = [];
    const voice = (name: string) => () => ({ stop: () => void cut.push(name) });
    const m = new Mixer();
    expect(m.play("mix", fx(5), 0, 1, voice("a"))).toBe(2);
    expect(m.play("mix", fx(3), 0, 1, voice("b"))).toBe(1);
    // 0x7 beats the lower channel's 0x3 and matches neither: it goes where 0x3 was
    expect(m.play("renew", fx(7), 0.5, 1, voice("c"))).toBe(1);
    expect(cut).toEqual(["b"]);
    expect(m.held(0.6)).toEqual([0, fx(7), fx(5)]);
  });

  it("puts a channel already playing a record to loop, and it holds for good (0x428059)", () => {
    const loops: boolean[] = [];
    const m = new Mixer();
    m.play("mix", fx(4), 0, 1, () => ({ stop: () => {}, setLoop: (on: boolean) => void loops.push(on) }));
    m.loop(fx(4), true, 0.5);
    expect(loops).toEqual([true]);
    expect(m.held(1_000)[2]).toBe(fx(4));
    // ...and letting go of a one-shot that never looped leaves its end where it was
    const once = new Mixer();
    once.play("mix", fx(4), 0, 1, () => ({ stop: () => {}, setLoop: (on: boolean) => void loops.push(on) }));
    once.loop(fx(4), false, 0.5);
    expect(loops).toEqual([true, false]);
    expect([once.held(0.9)[2], once.held(1)[2]]).toEqual([fx(4), 0]);
    // ...and a record that is not playing is not touched
    m.loop(fx(9), true, 0.5);
    expect(loops).toEqual([true, false]);
  });
});
