function clockMinute(value: string): number {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(value);
  if (!match) throw new Error("Quiet-hour times must use HH:mm.");
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function localMinute(value: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return hour * 60 + minute;
}

export function isWithinQuietHours(
  timezone: string,
  quietStart: string | null,
  quietEnd: string | null,
  now = new Date(),
): boolean {
  if (quietStart === null || quietEnd === null) return false;
  const start = clockMinute(quietStart);
  const end = clockMinute(quietEnd);
  if (start === end) return false;
  const current = localMinute(now, timezone);
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export function nextAllowedNotificationTime(
  timezone: string,
  quietStart: string | null,
  quietEnd: string | null,
  now = new Date(),
): Date | null {
  if (!isWithinQuietHours(timezone, quietStart, quietEnd, now) || quietEnd === null) return null;
  const firstMinute = Math.floor(now.getTime() / 60_000) * 60_000;
  for (let offset = 1; offset <= 1_620; offset += 1) {
    const candidate = new Date(firstMinute + offset * 60_000);
    if (!isWithinQuietHours(timezone, quietStart, quietEnd, candidate)) return candidate;
  }
  return new Date(now.getTime() + 24 * 60 * 60_000);
}
