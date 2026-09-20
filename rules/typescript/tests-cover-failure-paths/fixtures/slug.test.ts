import { describe, expect, it } from "vitest";
import { parseDuration, slugify, truncateSlug } from "./slug";

describe("slugify", () => {
  it("lowercases and joins words with dashes", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
  });

  it("strips leading and trailing punctuation", () => {
    expect(slugify("--Hello--")).toBe("hello");
  });

  it("throws on an empty title", () => {
    expect(() => truncateSlug(slugify("hello"), 0)).toThrow();
  });
});

describe("truncateSlug", () => {
  it("cuts at the last dash inside the limit", () => {
    expect(truncateSlug("hello-wide-world", 12)).toBe("hello-wide");
  });

  it("returns a short slug unchanged", () => {
    expect(truncateSlug("hi", 12)).toBe("hi");
  });
});

describe("parseDuration", () => {
  it.each([
    ["250ms", 250],
    ["5s", 5000],
    ["2m", 120_000],
    ["1h", 3_600_000],
  ])("parses %s", (raw, expected) => {
    expect(parseDuration(raw)).toBe(expected);
  });

  it.each(["", "5", "5 parsecs", "-1s"])("rejects %j", (raw) => {
    expect(() => parseDuration(raw)).toThrow(/unrecognised duration/);
  });
});
