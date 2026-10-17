import { describe, expect, it, vi } from "vitest";
import { creditTrendSummary, formatPayment, formatReportUtc } from "./report-presentation";

describe("Exact report money display", () => {
  it.each([
    [12345, "EUR", "€123.45"],
    [12345, "USD", "$123.45"],
    [12345, "JPY", "¥12,345"],
    [12345, "KWD", "KWD 12.345"],
    [0, "EUR", "€0.00"],
    [0, "JPY", "¥0"],
    [0, "KWD", "KWD 0.000"],
    [Number.MAX_SAFE_INTEGER, "USD", "$90,071,992,547,409.91"],
    [Number.MAX_SAFE_INTEGER, "EUR", "€90,071,992,547,409.91"],
    [Number.MAX_SAFE_INTEGER, "JPY", "¥9,007,199,254,740,991"],
    [Number.MAX_SAFE_INTEGER, "KWD", "KWD 9,007,199,254,740.991"],
    [12345, "ZZZ", "12345 minor units ZZZ"],
    [12345, "XXX", "12345 minor units XXX"],
    [12345, "EURO", "12345 minor units EURO"],
  ])("formats %s %s exactly", (minor, currency, expected) => {
    expect(formatPayment(minor, currency, "en-US")).toBe(expected);
  });
  it("retains exact fractional digits with locale-specific placement/separators", () => {
    expect(formatPayment(Number.MAX_SAFE_INTEGER, "EUR", "de-DE")).toBe("90.071.992.547.409,91 €");
  });
  it("keeps localized fraction digits consistent with the integer digits", () => {
    expect(formatPayment(12345, "USD", "ar-EG")).toBe(
      new Intl.NumberFormat("ar-EG", { style: "currency", currency: "USD" }).format(123.45),
    );
  });
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid/non-domain amount %s",
    (minor) => {
      // Payment rows are nonnegative; credit refunds are separate credit movements.
      expect(() => formatPayment(minor, "USD")).toThrow();
    },
  );
  it("displays unlike currencies independently without a product currency or FX", () => {
    expect(
      [
        [100, "EUR"],
        [200, "USD"],
      ].map(([minor, code]) => formatPayment(Number(minor), String(code), "en-US")),
    ).toEqual(["€1.00", "$2.00"]);
  });
});

describe("UTC stage history display", () => {
  it("does not follow the machine timezone across UTC midnight", () => {
    try {
      for (const zone of ["Europe/Berlin", "America/Los_Angeles", "Pacific/Auckland"]) {
        vi.stubEnv("TZ", zone);
        expect(formatReportUtc("2024-03-01T00:00:01Z")).toBe("01 Mar 2024, 00:00:01 UTC");
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it.each([
    ["2024-02-29T23:59:59Z", "29 Feb 2024, 23:59:59 UTC"],
    ["2024-03-01T00:00:00Z", "01 Mar 2024, 00:00:00 UTC"],
    ["2024-03-01T01:00:00+01:00", "01 Mar 2024, 00:00:00 UTC"],
    ["2025-01-01T00:00:00Z", "01 Jan 2025, 00:00:00 UTC"],
  ])("formats %s in explicit UTC", (instant, expected) => {
    expect(formatReportUtc(instant)).toBe(expected);
  });
});

describe("Credit trend activity", () => {
  const base = { earned: 0, spent: 0, refunded: 0, adjusted: 0 };
  it.each([
    ["earned", { earned: 5 }],
    ["spent", { spent: 5 }],
    ["refund", { refunded: 5 }],
    ["reversal adjustment", { adjusted: -5 }],
    ["mixed", { earned: 5, spent: 3, refunded: 2, adjusted: -1 }],
  ])("recognizes %s without changing ledger meaning", (_label, movement) => {
    const credits = { ...base, ...movement };
    expect(creditTrendSummary([{ credits }])).toEqual({
      hasActivity: true,
      refunded: credits.refunded,
      adjusted: credits.adjusted,
    });
  });
  it("identifies a genuinely empty series", () => {
    expect(creditTrendSummary([{ credits: base }])).toEqual({
      hasActivity: false,
      refunded: 0,
      adjusted: 0,
    });
    expect(creditTrendSummary([]).hasActivity).toBe(false);
  });
  it("adds signed net adjustments exactly even when large intermediate totals would round", () => {
    expect(
      creditTrendSummary(
        [Number.MAX_SAFE_INTEGER, 2, -2].map((adjusted) => ({ credits: { ...base, adjusted } })),
      ).adjusted,
    ).toBe(Number.MAX_SAFE_INTEGER);
  });
});
