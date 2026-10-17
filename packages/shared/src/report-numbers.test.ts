import { describe, expect, it } from "vitest";
import { reportInteger, reportPercent, reportSum } from "./report-numbers";

describe("Report numeric domains and exact arithmetic", () => {
  it.each([0, 1, Number.MAX_SAFE_INTEGER])("preserves accepted integer %s", (value) => {
    expect(reportInteger(value)).toBe(value);
    expect(reportInteger(String(value))).toBe(value);
  });
  it.each([
    undefined,
    null,
    "",
    " ",
    "1.0",
    "1e3",
    "NaN",
    "Infinity",
    "9007199254740992",
    "9007199254740993",
    1.1,
    NaN,
    Infinity,
    -1,
    true,
  ])("rejects corrupt or non-domain input %s", (value) => {
    expect(() => reportInteger(value)).toThrow();
  });
  it("allows negative values only in signed domains", () => {
    expect(reportInteger(String(Number.MIN_SAFE_INTEGER), true)).toBe(Number.MIN_SAFE_INTEGER);
    expect(() => reportInteger("-9007199254740992", true)).toThrow();
  });
  it("rejects overflow in derived sums rather than rounding", () => {
    expect(reportSum([Number.MAX_SAFE_INTEGER, 0])).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => reportSum([Number.MAX_SAFE_INTEGER, 1])).toThrow();
    expect(() => reportSum([Number.MIN_SAFE_INTEGER, -1], true)).toThrow();
    expect(reportSum([Number.MAX_SAFE_INTEGER, 2, -2], true)).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => reportSum([-1])).toThrow();
  });
  it("calculates null/rounded percentages without unsafe intermediate multiplication", () => {
    expect(reportPercent(0, 0)).toBeNull();
    expect(reportPercent(1, 2)).toBe(50);
    expect(reportPercent(1, 3, true)).toBe(33.3);
    expect(reportPercent(2, 3)).toBe(67);
    expect(reportPercent(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, true)).toBe(100);
    expect(reportPercent(Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER, true)).toBe(100);
    expect(() => reportPercent(2, 1)).toThrow();
    expect(() => reportPercent(-1, 2)).toThrow();
  });
});
