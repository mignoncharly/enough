import { reportInteger, reportSum } from "@enough/shared";
import type { ProductReportDay } from "../workspace-data";

const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));

// Retain the existing Intl currency exponent contract, but only for supported
// currencies. Split integer/remainder with BigInt so formatting never loses cents.
export function formatPayment(amountMinor: number, currency: string, locale?: string): string {
  reportInteger(amountMinor);
  if (!supportedCurrencies.has(currency)) return `${amountMinor} minor units ${currency}`;
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 0;
  const divisor = 10n ** BigInt(digits);
  const minor = BigInt(amountMinor);
  const fraction = new Intl.NumberFormat(locale, {
    useGrouping: false,
    minimumIntegerDigits: Math.max(1, digits),
  }).format(minor % divisor);
  return formatter
    .formatToParts(minor / divisor)
    .map((part) => (part.type === "fraction" ? fraction : part.value))
    .join("");
}

export function formatReportUtc(instant: string): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant))} UTC`;
}

export function creditTrendSummary(days: Pick<ProductReportDay, "credits">[]) {
  return {
    hasActivity: days.some(({ credits }) => Object.values(credits).some((value) => value !== 0)),
    refunded: reportSum(days.map((day) => day.credits.refunded)),
    adjusted: reportSum(
      days.map((day) => day.credits.adjusted),
      true,
    ),
  };
}
