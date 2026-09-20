import { describe, expect, it } from "vitest";
import { parseEntryLine, postEntry, type Ledger } from "../ledger";

const open: Ledger = { closedThrough: "2024-03-31", entries: [] };

describe("postEntry", () => {
  it("appends the entry and leaves the original ledger alone", () => {
    const result = postEntry(open, { date: "2024-04-02", amountCents: 1250, memo: "coffee" });
    expect(result.ok).toBe(true);
    expect(open.entries).toHaveLength(0);
  });

  it.each([12.5, Number.NaN, Number.POSITIVE_INFINITY])("refuses a non-integer amount (%s)", (amount) => {
    expect(() => postEntry(open, { date: "2024-04-02", amountCents: amount, memo: "" })).toThrow(TypeError);
  });
});

describe("parseEntryLine", () => {
  it("splits date, amount and the rest as memo", () => {
    expect(parseEntryLine("2024-04-02 12.50 coffee with Sam")).toEqual({
      date: "2024-04-02",
      amountCents: 1250,
      memo: "coffee with Sam",
    });
  });

  it("throws when the line has no amount", () => {
    expect(() => parseEntryLine("2024-04-02")).toThrow(/needs a date and an amount/);
  });

  it("throws when the amount is not in 0.00 form", () => {
    expect(() => parseEntryLine("2024-04-02 twelve coffee")).toThrow(/not in 0.00 form/);
  });
});
