// Reports retain safe integer JSON numbers. SQL bigint aggregates outside this
// range fail explicitly; they are never rounded, clamped or coerced to zero.
export function reportInteger(value: unknown, signed = false): number {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?\d+$/.test(value)))
    throw new Error("Invalid report integer.");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || (!signed && number < 0))
    throw new Error("Report integer exceeds its supported domain.");
  return number;
}

export function reportSum(values: number[], signed = false): number {
  const total = values.reduce((sum, value) => sum + BigInt(reportInteger(value, signed)), 0n);
  return reportInteger(total.toString(), signed);
}

// Round a bounded proportion without overflowing an intermediate multiplication.
export function reportPercent(part: number, total: number, tenths = false): number | null {
  reportInteger(part);
  reportInteger(total);
  if (part > total) throw new Error("Invalid report proportion.");
  if (total === 0) return null;
  const scale = tenths ? 1000n : 100n;
  return Number((BigInt(part) * scale + BigInt(total) / 2n) / BigInt(total)) / (tenths ? 10 : 1);
}

export const REPORT_VERIFICATION_NOTE =
  "Verified completions combine owner-reviewed and automatically verified statuses; this total does not mean every completion was independently verified by a provider. Awaiting evidence/review is counted separately.";
export const REPORT_ANALYTICS_NOTE =
  "Signals count authenticated normalized event records, not necessarily unique people or customers. Analytics daily records may summarize a positive provider reporting-day bucket as one record; its UTC marker is not an exact underlying event time.";
