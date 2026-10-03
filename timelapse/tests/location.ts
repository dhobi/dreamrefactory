/**
 * The location readout (`src/location.ts`): the line a bug report carries, and
 * a stage's `getframeaction` answer in words.
 *
 *   npx vitest run --project timelapse timelapse/tests/location.ts
 */
import { describe, expect, it } from "vitest";
import { bugLine, exitText, exitsHtml, whereHtml } from "../src/location";

describe("one way out, in words", () => {
  it("reads every verb transitionaction switches on", () => {
    expect(exitText("J.104")).toBe("→104");
    expect(exitText("TL.101")).toBe("↺101");
    expect(exitText("TR.103")).toBe("↻103");
    expect(exitText("G.1.530")).toBe("region 1, frame 530");
    expect(exitText("G.1")).toBe("region 1, frame ?");
    expect(exitText("S.9.1.840")).toBe("stage 9.1.840");
  });

  it("says NO for a way the game refuses, and passes the rest through", () => {
    expect(exitText("X")).toBe("—");
    expect(exitText("")).toBe("—");
    expect(exitText("L2")).toBe("L2");
  });

  it("reads a verb caselessly, as the game's switch does (e002, m010)", () => {
    expect(exitText("s.1.1.137")).toBe("stage 1.1.137");
    expect(exitText("j.252")).toBe("→252");
  });
});

describe("the readout", () => {
  const place = { world: "I", stage: "i001", region: "1", frame: "330", flat: "i0001.330" };

  it("leads the bug report's line with the flat", () => {
    expect(bugLine(place)).toBe("flat i0001.330 · world I · stage i001 · region 1 · frame 330");
    expect(bugLine({ ...place, world: "" })).toContain("world ?");
  });

  it("escapes what it writes as HTML", () => {
    expect(whereHtml({ ...place, flat: "<a&b>" })).toContain("<i>&lt;a&amp;b&gt;</i>");
    expect(whereHtml(place)).toBe("<b>world I</b>  stage i001  region 1  <b>frame 330</b>  <i>i0001.330</i>");
  });

  it("lays the six ways out in the table's order, short tables padded with NO", () => {
    expect(exitsHtml("J.104 S.9.1.840 TL.101 TR.103 L2 R2 ")).toBe("↑ →104   ↓ stage 9.1.840   ← ↺101   → ↻103   ↙ L2   ↘ R2");
    expect(exitsHtml("")).toBe("↑ —   ↓ —   ← —   → —   ↙ —   ↘ —");
  });
});
