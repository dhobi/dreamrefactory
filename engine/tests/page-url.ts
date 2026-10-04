import { describe, expect, it } from "vitest";
import { pageUrl } from "../src/web/page-url";

describe("pageUrl", () => {
  const base = "https://example.org/dreamrefactory/lunicus/";
  const origin = "https://example.org";

  it("resolves a relative path against the page", () => {
    expect(pageUrl("gamefiles/LUNICUS/DAY1.LUN", base, origin)).toBe(
      "https://example.org/dreamrefactory/lunicus/gamefiles/LUNICUS/DAY1.LUN",
    );
    expect(pageUrl("../gamefiles.json", base, origin)).toBe("https://example.org/dreamrefactory/gamefiles.json");
  });

  it("refuses anything that leaves the site", () => {
    expect(() => pageUrl("https://evil.example/x", base, origin)).toThrow(/not on https:\/\/example.org/);
    expect(() => pageUrl("//evil.example/x", base, origin)).toThrow();
    expect(() => pageUrl("gamefiles.json", "https://other.example/", origin)).toThrow();
  });
});
