/**
 * The loading page's network meter (`src/meter.ts`): a rate over a rolling
 * window, and the caption it writes under the gauge.
 *
 *   npx vitest run --project timelapse timelapse/tests/meter.ts
 */
import { describe, expect, it } from "vitest";
import { NetMeter, fmtLeft, fmtRate, fmtSize } from "../src/meter";

const MB = 1024 * 1024;

describe("the figures", () => {
  it("say MB above a megabyte and KB below, never 0 KB", () => {
    expect(fmtRate(1.44 * MB)).toBe("1.4 MB/s");
    expect(fmtRate(830 * 1024)).toBe("830 KB/s");
    expect(fmtRate(10)).toBe("1 KB/s");
    expect(fmtSize(13.1 * MB)).toBe("13.1 MB");
    expect(fmtSize(412 * 1024)).toBe("412 KB");
    expect(fmtSize(1)).toBe("1 KB");
  });

  it("round the time left coarsely, and say nothing when it is no estimate", () => {
    expect(fmtLeft(2)).toBe("");
    expect(fmtLeft(Infinity)).toBe("");
    expect(fmtLeft(NaN)).toBe("");
    expect(fmtLeft(4 * 3600)).toBe("");
    expect(fmtLeft(3)).toBe("~5 s left");
    expect(fmtLeft(33)).toBe("~35 s left");
    expect(fmtLeft(89)).toBe("~85 s left");
    expect(fmtLeft(240)).toBe("~4 min left");
  });
});

describe("the meter", () => {
  it("gives no rate until the window has settled", () => {
    const m = new NetMeter();
    m.chunk(MB, 0);
    expect(m.rate(500)).toBe(0);
    expect(m.caption(500, 0)).toBeNull();
    expect(m.rate(1000)).toBeCloseTo(MB, 0);
  });

  it("forgets what fell out of the window, but keeps the total", () => {
    const m = new NetMeter(3000, 900);
    m.chunk(10 * MB, 0);
    m.chunk(MB, 4000);
    m.chunk(MB, 5000);
    // the 10 MB at t=0 is out of the window by t=5000
    expect(m.rate(5000)).toBeCloseTo(2 * MB, 0);
    expect(m.total).toBe(12 * MB);
    // and once every sample is old, there is no rate at all
    expect(m.rate(9000)).toBe(0);
  });

  it("writes a fraction and an estimate once the remainder is known", () => {
    const m = new NetMeter();
    m.chunk(MB, 0);
    m.chunk(MB, 1000);
    expect(m.caption(1000, 0)).toBe("2.0 MB/s · 2.0 MB so far");
    expect(m.caption(1000, 68 * MB)).toBe("2.0 MB/s · 2.0 MB of 70.0 MB · ~35 s left");
    // and drops the estimate when it is "any moment"
    expect(m.caption(1000, 1 * MB)).toBe("2.0 MB/s · 2.0 MB of 3.0 MB");
  });
});
